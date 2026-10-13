import { snowVal } from './snow-client';

// GetCommentsAndWorkNotes returns sys_audit rows; only these fields carry narrative.
const NARRATIVE_FIELDS = /^(work_notes|comments|additional comments|close_notes)$/i;

const PER_NOTE_MAX = 1200;

function stripHtml(value: string): string {
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Format raw GetCommentsAndWorkNotes audit rows into a chronological
 * `[date] author: text` transcript, dropping non-narrative audit rows
 * (u_updated_on, time_worked, state flips, etc.).
 */
export function formatSnowNotes(rows: unknown, maxChars = 6000): string {
  if (!rows) return '';
  const list = Array.isArray(rows) ? rows : [rows];

  const notes = list
    .map((r: any) => ({
      field: snowVal(r?.fieldname),
      when: snowVal(r?.sys_created_on),
      who: snowVal(r?.sys_created_by ?? r?.user),
      text: stripHtml(snowVal(r?.newvalue)),
    }))
    .filter((n) => NARRATIVE_FIELDS.test(n.field) && n.text);

  if (!notes.length) return '';

  notes.sort((a, b) => a.when.localeCompare(b.when));

  const lines = notes.map((n) => {
    const text = n.text.length > PER_NOTE_MAX ? `${n.text.slice(0, PER_NOTE_MAX)}...` : n.text;
    return `[${n.when}] ${n.who}: ${text}`;
  });

  let out = lines.join('\n');
  if (out.length > maxChars) {
    // keep the most recent notes — that's where the investigation lives
    out = `...(earlier notes truncated)\n${out.slice(out.length - maxChars)}`;
  }
  return out;
}

/**
 * Combine task + escalated incident/case notes into one labeled transcript.
 * Falls back to the record's inline work_notes field when audit rows are absent.
 */
export function combineSnowNotes(
  task: any,
  incident: any,
  snowCase: any,
  maxCharsPerSource = 5000
): string {
  const sections: string[] = [];

  const add = (label: string, record: any) => {
    if (!record) return;
    const formatted =
      formatSnowNotes(record._workNotes, maxCharsPerSource) ||
      stripHtml(snowVal(record.work_notes)).slice(0, maxCharsPerSource);
    if (formatted) sections.push(`--- ${label} (${snowVal(record.number) || 'n/a'}) ---\n${formatted}`);
  };

  add('Task notes', task);
  add('Incident notes', incident);
  add('Case notes', snowCase);
  return sections.join('\n\n');
}

const FRAMEWORK_FRAME = /^(System\.|MS\.|Microsoft\.|mscorlib|EO\.Base\.Runtime)/;

/**
 * Pull exception messages and the top application stack frames out of free text
 * (DA description, work notes, log excerpts) so they can be first-class evidence.
 */
export function extractExceptionSignatures(text: string, maxSignatures = 5): string[] {
  const source = String(text ?? '');
  const signatures: string[] = [];

  const msgRe = /Exception message\s*:\s*(.{5,220}?)(?=\s*(?:Inner exception|Exception Stack|Code Stack|$))/gi;
  for (const m of source.matchAll(msgRe)) {
    const msg = m[1].replace(/\s+/g, ' ').trim();
    if (msg && !signatures.includes(`Exception: ${msg}`)) signatures.push(`Exception: ${msg}`);
  }

  const frameRe = /\bat\s+([\w.`<>+]+\.[\w<>_]+)\s*\(/g;
  const appFrames: string[] = [];
  for (const m of source.matchAll(frameRe)) {
    const frame = m[1];
    if (FRAMEWORK_FRAME.test(frame)) continue;
    if (!appFrames.includes(frame)) appFrames.push(frame);
    if (appFrames.length >= 8) break;
  }
  if (appFrames.length) signatures.push(`Top app frames: ${appFrames.slice(0, 5).join(' <- ')}`);

  return signatures.slice(0, maxSignatures);
}
