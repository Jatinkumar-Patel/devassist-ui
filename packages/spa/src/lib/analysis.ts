import type { AdoWorkItem, Product, TriageAnalysis } from '../types';
import { bridgeApi, getBridgeUrl } from './bridge-url';

interface SpreadsheetSummaryInput {
  file: string;
  sheet: string;
  rowCount: number;
  columnCount: number;
  headers?: string[];
  sampleRows?: string[];
  findings?: string[];
}

interface ImageSummaryInput {
  file: string;
  textPreview: string;
  charCount: number;
  findings?: string[];
  hitCount: number;
}

interface SnowContextInput {
  snowTask?: Record<string, unknown> | null;
  snowIncident?: Record<string, unknown> | null;
  snowCase?: Record<string, unknown> | null;
}

// ── Pattern definitions from areas/sunrise-mobile/analysis-playbook.md ───────

interface Pattern {
  id: string;
  name: string;
  keywords: string[];         // match against DA title + description (case-insensitive)
  verdict: TriageAnalysis['verdict'];
  searchSeeds: string[];      // GitHub code search terms
  fixDirection: string;
  confidence: TriageAnalysis['confidence'];
}

const SUNRISE_MOBILE_PATTERNS: Pattern[] = [
  {
    id: 'sm-1',
    name: 'SCMLib lock contention (med-pass)',
    keywords: ['lock', 'med-pass', 'medication', 'spinning wheel', 'slow', 'LockWithTimeout', 'GetTaskForm', 'MarkTaskDone'],
    verdict: 'CODE BUG',
    searchSeeds: ['LockWithTimeout', 'SCMLibServiceManager', 'lock granted', 'GetTaskForm'],
    fixDirection: 'Increase IIS web-garden worker count (e.g. 4→6) to reduce lock contention.',
    confidence: 'Medium',
  },
  {
    id: 'sm-2',
    name: 'Client timeout + duplicate retry',
    keywords: ['timeout', 'timed out', 'duplicate', 'retry', 'progress indicator', 'Client service error'],
    verdict: 'CODE BUG',
    searchSeeds: ['LogTraceInfo', 'progress indicator', 'RecycleClient', 'timed out'],
    fixDirection: 'Connection recycle + backoff + longer timeout + idempotent retry (RecycleClient on transport error).',
    confidence: 'Medium',
  },
  {
    id: 'sm-3',
    name: 'Patient-select client hang (spinning wheel)',
    keywords: ['spinning wheel', 'spinner', 'patient list', 'patient select', 'GetPatientVisit', 'endless', 'hang'],
    verdict: 'CODE BUG',
    searchSeeds: ['overlay', 'spinner', 'watchdog', 'GetPatientVisit', 'progress indicator'],
    fixDirection: 'Client-side overlay/spinner code — spinner can be left stuck. See Defect 9377813.',
    confidence: 'High',
  },
  {
    id: 'sm-4',
    name: 'App-domain / cold-start stall',
    keywords: ['app-domain', 'cold start', 'app pool', 'recycle', 'warm', 'Application_Start', 'startup'],
    verdict: 'CONFIG / INSTALL',
    searchSeeds: ['Application_Start', 'preloadEnabled', 'startMode', 'LoadAzureAppConfigKeyVaultSecrets'],
    fixDirection: 'IIS warmup: set app pool startMode=AlwaysRunning, site preloadEnabled=true.',
    confidence: 'Medium',
  },
  {
    id: 'sm-5',
    name: 'Barcode scanner / device hardware',
    keywords: ['barcode', 'scanner', 'scan', 'Zebra', 'Honeywell', 'AsReader', 'device'],
    verdict: 'CODE BUG',
    searchSeeds: ['AsReaderBarcodeScannerPlugin', 'ConnectBarcodeScanner', 'barcode'],
    fixDirection: 'Check scanner heartbeat/connect timing. Review device-specific plugin code.',
    confidence: 'Low',
  },
  {
    id: 'sm-6',
    name: 'Auth / logout / SSO',
    keywords: ['logout', 'login', 'SSO', 'Imprivata', 'SecureAuth', 'MSAL', 'Azure AD', 'token', 'session expired'],
    verdict: 'CODE BUG',
    searchSeeds: ['MSAL', 'logout', 'Imprivata', 'SecureAuth', 'substituteUserSession'],
    fixDirection: 'Review MSAL/OIDC logout path and federated sign-out flow.',
    confidence: 'Low',
  },
];

// ── Pattern matching ──────────────────────────────────────────────────────────

/** Match against ALL patterns (mobile + SHM + future areas) */
export function matchPattern(adoItem: AdoWorkItem): Pattern | null {
  const text = [
    adoItem.fields['System.Title'] ?? '',
    adoItem.fields['System.Description'] ?? '',
    adoItem.fields['Allscripts.Field.DevAssistDetail'] ?? '',
  ].join(' ').toLowerCase();

  let best: Pattern | null = null;
  let bestScore = 0;

  for (const p of ALL_PATTERNS) {
    const score = p.keywords.filter((k) => text.includes(k.toLowerCase())).length;
    if (score > bestScore) { bestScore = score; best = p; }
  }

  // Require at least 2 keyword hits to avoid false-positives from product-name-only matches
  return bestScore >= 2 ? best : null;
}

// ── Phase 3: Code search ──────────────────────────────────────────────────────

export interface CodeHit {
  repo: string;
  path: string;
  url: string;
  snippet?: string;
}

function parseGithubTreePath(url: string): { repo: string; path: string } | null {
  const m = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/tree\/[^/]+\/(.+)$/i);
  if (!m) return null;
  return { repo: m[1], path: m[2] };
}

// ── SHM Patterns ──────────────────────────────────────────────────────────────
const SHM_PATTERNS: Pattern[] = [
  {
    id: 'shm-1',
    name: 'SHM Send button disabled / grayed out',
    keywords: ['send button', 'send is disabled', 'grayed out', 'grey', 'disabled', 'compose', 'secure health message', 'recipient'],
    verdict: 'CODE BUG',
    searchSeeds: ['SendButton', 'isDisabled', 'SHM', 'ComposeMessage', 'recipient'],
    fixDirection: 'Check the Send button enabled/disabled state logic. The button should enable after a valid recipient is selected. Look for the condition that evaluates recipient validity.',
    confidence: 'Medium',
  },
  {
    id: 'shm-2',
    name: 'SHM reply thread formatting lost (line breaks / spacing)',
    keywords: ['formatting', 'line break', 'line breaks', 'spacing', 'single block', 'loses formatting', 'reply thread', 'message content', 'whitespace', 'newline'],
    verdict: 'CODE BUG',
    searchSeeds: ['replyThread', 'formatMessage', 'whitespace', 'innerHTML', 'innerText', 'nl2br', 'sanitize', 'DOMParser', 'quill', 'rich text'],
    fixDirection: 'HTML/text serialisation strips whitespace on reply-thread read-back. Check the message rendering component for how newlines/\\n are converted to <br> or preserved in the text model. Look for innerHTML vs innerText usage and any sanitizer that collapses whitespace.',
    confidence: 'Medium',
  },
  {
    id: 'shm-3',
    name: 'SHM message not delivered / stuck in outbox',
    keywords: ['not delivered', 'stuck', 'outbox', 'pending', 'failed to send', 'delivery failed', 'message missing'],
    verdict: 'CODE BUG',
    searchSeeds: ['SHMDelivery', 'MessageQueue', 'sendMessage', 'outbox', 'retry'],
    fixDirection: 'Check the SHM delivery queue and retry logic. Look for stuck messages in the outbox and the error state that prevents re-delivery.',
    confidence: 'Low',
  },
];

const ALL_PATTERNS = [...SUNRISE_MOBILE_PATTERNS, ...SHM_PATTERNS];

/** Match pattern against any product — checks all known patterns */
export function matchPatternAny(adoItem: AdoWorkItem): Pattern | null {
  const text = [
    adoItem.fields['System.Title'] ?? '',
    adoItem.fields['System.Description'] ?? '',
    adoItem.fields['Allscripts.Field.DevAssistDetail'] ?? '',
  ].join(' ').toLowerCase();
  let best: Pattern | null = null;
  let bestScore = 0;
  for (const p of ALL_PATTERNS) {
    const score = p.keywords.filter((k) => text.includes(k.toLowerCase())).length;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  // Require 2+ keyword hits — single product-name match is not enough
  return bestScore >= 2 ? best : null;
}
const BRIDGE = (): string => getBridgeUrl();

export async function runCodeSearch(
  githubPat: string,
  product: Product,
  pattern: Pattern
): Promise<CodeHit[]> {
  const repos = product.repos
    .filter((r) => r.required)
    .map((r) => `${r.owner}/${r.repo}`);

  if (!repos.length || !githubPat) return [];

  const hits: CodeHit[] = [];

  for (const seed of pattern.searchSeeds.slice(0, 3)) {
    try {
      const repoQ = repos.map((r) => `repo:${r}`).join(' ');
      const q = encodeURIComponent(`${seed} ${repoQ}`);
      // Proxy through bridge to avoid CORS — bridge forwards with Bearer token
      const res = await fetch(
        bridgeApi(`/api/gh-search/code?q=${q}&per_page=10`),
        { headers: { 'X-GitHub-Token': githubPat } }
      );
      if (!res.ok) continue;
      const result = await res.json() as {
        items?: Array<{ repository: { full_name: string }; path: string; html_url: string }>;
      };
      for (const item of (result.items ?? []).slice(0, 3)) {
        hits.push({ repo: item.repository.full_name, path: item.path, url: item.html_url });
      }
    } catch { /* non-fatal */ }
  }

  const seen = new Set<string>();
  return hits.filter((h) => { if (seen.has(h.path)) return false; seen.add(h.path); return true; });
}

export async function runDatabaseRepoSearch(
  githubPat: string,
  databaseRepoPaths: string[],
  terms: string[]
): Promise<CodeHit[]> {
  if (!githubPat || !databaseRepoPaths.length || !terms.length) return [];

  const targets = databaseRepoPaths
    .map(parseGithubTreePath)
    .filter((v): v is { repo: string; path: string } => Boolean(v));

  if (!targets.length) return [];

  const hits: CodeHit[] = [];
  const searchTerms = terms.slice(0, 4);

  for (const target of targets) {
    for (const term of searchTerms) {
      try {
        const q = encodeURIComponent(`${term} repo:${target.repo} path:${target.path}`);
        const res = await fetch(
          bridgeApi(`/api/gh-search/code?q=${q}&per_page=5`),
          { headers: { 'X-GitHub-Token': githubPat } }
        );
        if (!res.ok) continue;
        const result = await res.json() as {
          items?: Array<{ repository: { full_name: string }; path: string; html_url: string }>;
        };
        for (const item of (result.items ?? []).slice(0, 2)) {
          hits.push({ repo: item.repository.full_name, path: item.path, url: item.html_url });
        }
      } catch {
        // non-fatal
      }
    }
  }

  const seen = new Set<string>();
  return hits.filter((h) => {
    const key = `${h.repo}/${h.path}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Phase 4: Build assessment with actual evidence ───────────────────────────

export function buildAssessment(
  adoItem: AdoWorkItem,
  pattern: Pattern | null,
  codeHits: CodeHit[],
  snowWorkNotes?: string,
  logHits?: Array<{ seed: string; text: string; file: string }>,
  topSeeds?: Record<string, number>
): TriageAnalysis {
  const f = adoItem.fields;
  const title = f['System.Title'] ?? '';
  const customer = f['Allscripts.Field.CustomerName'] ?? 'the client';
  const version = f['Allscripts.Field.SupportVersion'] ?? 'unknown';
  const description = String(f['System.Description'] ?? f['Allscripts.Field.DevAssistDetail'] ?? '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const summarizeSnowAuditJson = (raw: string): string[] => {
    const normalized = raw.trim().replace(/^[-*]\s*/, '');
    if (!normalized.startsWith('[') && !normalized.startsWith('{') && !normalized.startsWith('"')) return [];

    const parseCandidates: string[] = [normalized];

    // Handle escaped JSON blobs like [{\"fieldname\":...}] that often appear in work notes.
    if (normalized.includes('\\"')) {
      parseCandidates.push(normalized.replace(/\\"/g, '"'));
      parseCandidates.push(normalized.replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
    }

    // Handle wrapped JSON string payloads: "[{\"fieldname\":...}]"
    if (normalized.startsWith('"') && normalized.endsWith('"')) {
      try {
        const unwrapped = JSON.parse(normalized);
        if (typeof unwrapped === 'string') parseCandidates.push(unwrapped);
      } catch {
        // non-fatal
      }
    }

    const uniqueCandidates = Array.from(new Set(parseCandidates));

    for (const candidate of uniqueCandidates) {
      try {
        const parsed = JSON.parse(candidate);
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        const summaries = rows
          .slice(0, 5)
          .map((row: any) => {
            const field = row?.fieldname?.display_value ?? row?.fieldname?.value ?? row?.fieldname;
            const oldVal = row?.oldvalue?.display_value ?? row?.oldvalue?.value ?? row?.oldvalue;
            const newVal = row?.newvalue?.display_value ?? row?.newvalue?.value ?? row?.newvalue;
            const who = row?.user?.display_value ?? row?.user?.value ?? row?.user ?? row?.sys_created_by?.display_value;
            const when = row?.sys_created_on?.display_value ?? row?.sys_created_on?.value ?? row?.sys_created_on;

            if (!field && !oldVal && !newVal) return null;

            const transition = oldVal !== undefined && newVal !== undefined
              ? `${String(oldVal)} → ${String(newVal)}`
              : `${String(newVal ?? oldVal ?? '')}`;

            return `${String(field ?? 'field')} changed (${transition})${who ? ` by ${String(who)}` : ''}${when ? ` at ${String(when)}` : ''}`;
          })
          .filter((v): v is string => Boolean(v));

        if (rows.length > 5) summaries.push(`...and ${rows.length - 5} more audit updates`);
        if (summaries.length) return summaries;
      } catch {
        // try next parsing strategy
      }
    }

    return [];
  };

  const normalizeEvidenceLine = (line: string): string[] => {
    const stripped = line.replace(/\[.*?\]/g, '').trim();
    if (!stripped) return [];

    const jsonSummaries = summarizeSnowAuditJson(stripped);
    if (jsonSummaries.length) return jsonSummaries;

    if (stripped.length > 260) {
      return [`${stripped.slice(0, 260)}...`];
    }

    return [stripped];
  };

  // ── 1. Extract SNOW evidence — parse work notes for diagnostic signals ──────
  const snowEvidence: string[] = [];
  if (snowWorkNotes) {
    const text = String(snowWorkNotes);
    // Extract meaningful lines: errors, versions, reproduction steps, support actions.
    // Also parse SNOW audit-style JSON payloads into readable field-change summaries.
    const evidenceLines = text.split(/\n|\\n/)
      .flatMap(normalizeEvidenceLine)
      .filter(l => l.length > 15 && (
        /error|exception|fail|cannot|unable|version|repro|confirm|observed|occur|steps|workaround|found|checked|tested|changed|updated|priority|assigned|state/i.test(l)
      ))
      .slice(0, 8);
    snowEvidence.push(...evidenceLines);

    // Also extract version numbers mentioned
    const versions = text.match(/\d+\.\d+(\.\d+)?([\s.-]PR\d+)?/g)?.slice(0, 3) ?? [];
    if (versions.length) snowEvidence.push(`Versions mentioned: ${versions.join(', ')}`);
  }

  // ── 2. Extract log evidence — key signals from log scan ──────────────────────
  const logEvidence: string[] = [];
  if (topSeeds && Object.keys(topSeeds).length > 0) {
    const top3 = Object.entries(topSeeds).sort(([,a],[,b]) => b-a).slice(0,5);
    logEvidence.push(`Log signals: ${top3.map(([s,c]) => `${s} (${c}×)`).join(', ')}`);

    // Server health: if GetPatientVisit/GetSelected complete quickly vs client timeouts
    const hasTimeout = topSeeds['progress indicator has timed out'] ?? 0;
    const hasLock = topSeeds['LockWithTimeout'] ?? 0;
    const hasOps = (topSeeds['GetSelectedVisitDataAndObservations'] ?? 0) + (topSeeds['GetPatientVisit'] ?? 0);
    if (hasTimeout > 0) logEvidence.push(`CLIENT timeout confirmed: "progress indicator has timed out" found ${hasTimeout}×`);
    if (hasLock > 100)  logEvidence.push(`LOCK CONTENTION: LockWithTimeout ${hasLock}× — IIS worker queue is backing up`);
    if (hasOps > 0 && hasTimeout > 0) logEvidence.push(`Server completed ops (${hasOps}× hits) but client timed out → server is healthy, issue is CLIENT-SIDE`);
  }
  if (logHits && logHits.length > 0) {
    const keyHit = logHits.find(h => h.seed === 'progress indicator has timed out' || h.seed === 'FATAL' || h.seed === 'Exception');
    if (keyHit) logEvidence.push(`Key log line: "${keyHit.text.slice(0,150)}"`);
  }

  // ── 3. Code analysis ─────────────────────────────────────────────────────────
  let codeAnalysis: string;
  if (codeHits.length > 0) {
    codeAnalysis = codeHits.map(h => `${h.repo}: ${h.path}`).join('\n');
  } else if (pattern) {
    codeAnalysis = `Search seeds: ${pattern.searchSeeds.join(', ')}\nRepos to inspect: ${
      adoItem.fields['System.AreaPath']?.includes('SHM') ? 'plhlt-aimanager-npm (SHM component)' :
      adoItem.fields['System.AreaPath']?.includes('MobileX') ? 'SunriseMobile + sunrise-mobilewebservices' :
      'Check product registry for mapped repos'
    }`;
  } else {
    // No pattern — derive from symptom keywords
    const symptomTerms = title.match(/\b(button|disable|grey|spinner|slow|error|fail|cannot|send|compose)\b/gi) ?? [];
    codeAnalysis = `No pattern matched. Symptom keywords: ${[...new Set(symptomTerms)].join(', ')}\nSearch for these terms in mapped repos.`;
  }

  // ── 4. Gap: what the code does vs what it should ─────────────────────────────
  let gap: string;
  if (pattern) {
    gap = pattern.fixDirection;
    // Enrich gap with log evidence
    if (logEvidence.length > 0 && pattern.id.startsWith('sm-')) {
      gap += ` Log evidence supports this: ${logEvidence[0]}`;
    }
  } else {
    // Build gap from DA description + SNOW evidence
    const problemCore = description.slice(0, 200) || title;
    gap = `No pre-defined pattern matched. Problem: "${problemCore}". ` +
      (snowEvidence.length > 0
        ? `SNOW adds: ${snowEvidence[0]}`
        : 'Review SNOW work notes and logs for more context before drawing a conclusion.');
  }

  // ── 5. Confidence + blind spots ───────────────────────────────────────────────
  let confidence = pattern?.confidence ?? 'Low';
  const blindSpots: string[] = [];

  // Raise confidence if log evidence confirms pattern
  if (logEvidence.some(l => l.includes('CLIENT timeout confirmed')) && pattern?.id === 'sm-3') {
    confidence = 'High';
  }
  // Lower confidence if no logs and no SNOW evidence
  if (!snowWorkNotes && !logHits?.length) {
    confidence = confidence === 'High' ? 'Medium' : 'Low';
    blindSpots.push('No log files available — attach HWS logs for the incident window to raise confidence');
  }
  if (!codeHits.length) {
    blindSpots.push('Code search found no hits — clone the mapped repos locally for deeper inspection');
  }
  if (!pattern) {
    blindSpots.push('No pattern matched — this symptom class may need a new pattern added to analysis.ts');
    blindSpots.push('Consider escalating to the area dev (SHM/SCM team) for domain context');
  }
  if (!snowEvidence.length && snowWorkNotes) {
    blindSpots.push('Work notes present but no diagnostic evidence extracted — review them manually');
  }

  // ── 6. L2 draft ───────────────────────────────────────────────────────────────
  const verdict = pattern?.verdict ?? 'NEED MORE INFO';
  let l2Draft: string | undefined;
  if (verdict === 'NEED MORE INFO') {
    l2Draft = `Thank you for contacting Altera support.\n\n` +
      `We have reviewed the information provided. To proceed with analysis, please provide:\n\n` +
      `1. ${!logHits?.length ? 'Log files covering the exact incident window (see the area guide for which logs to collect)' : 'Additional log context if the attached logs do not cover the full incident window'}\n` +
      `2. Exact ${version} build version\n` +
      `3. Steps to reproduce on a test/dev environment\n` +
      `4. Whether this affects all users or specific users/sites`;
  } else if (verdict === 'CODE BUG') {
    l2Draft = `Thank you for contacting Altera support.\n\n` +
      `Issue identified: ${pattern?.name ?? title}\n\n` +
      `Analysis: ${gap}\n\n` +
      `Confidence: ${confidence}${blindSpots.length > 0 ? `\nNote: ${blindSpots[0]}` : ''}`;
  }

  return {
    verdict,
    confidence: confidence as TriageAnalysis['confidence'],
    clientReported: `${customer} reports (${version}): ${title}`,
    snowEvidence: [...snowEvidence, ...logEvidence],
    codeAnalysis,
    gap,
    blindSpots,
    l2Draft,
  };
}

// ── Skill-driven analysis (reads actual skill files from bridge) ──────────────

interface PlaybookPattern {
  num: number;
  name: string;
  signature: string;
  confirm: string;
  fixDirection: string;
}

function parsePlaybook(content: string): PlaybookPattern[] {
  const out: PlaybookPattern[] = [];
  // Each pattern starts with "## N) Name"
  const blocks = content.split(/(?=^## \d+\))/m);
  for (const block of blocks) {
    const header = block.match(/^## (\d+)\)\s+(.+)/m);
    if (!header) continue;
    const sig = block.match(/\*\*Signature:\*\*\s*([\s\S]+?)(?=\n\*\*Confirm|\n##|$)/)?.[1]?.trim() ?? '';
    const confirm = block.match(/\*\*Confirm:\*\*\s*([\s\S]+?)(?=\n\*\*Fix direction|\n##|$)/)?.[1]?.trim() ?? '';
    const fix = block.match(/\*\*Fix direction[^*]*\*\*\s*([\s\S]+?)(?=\n##|$)/)?.[1]?.trim() ?? '';
    out.push({ num: parseInt(header[1], 10), name: header[2].trim(), signature: sig, confirm, fixDirection: fix });
  }
  return out;
}

function scorePattern(p: PlaybookPattern, evidenceText: string, logSeeds: Record<string, number>): number {
  let score = 0;
  const text = evidenceText.toLowerCase();
  // Extract backtick and quoted terms from signature
  const terms = [...p.signature.matchAll(/`([^`]+)`|"([^"]+)"/g)].map(m => (m[1] ?? m[2]).toLowerCase());
  for (const t of terms) {
    if (text.includes(t)) score += 3;
    if (Object.keys(logSeeds).some(s => s.toLowerCase().includes(t))) score += 4;
  }
  // Also match on plain words from the pattern name
  for (const word of p.name.toLowerCase().split(/\W+/).filter(w => w.length > 4)) {
    if (text.includes(word)) score += 1;
  }
  return score;
}

// ── SNOW-evidence verdict derivation (used when no skills/pattern match) ─────

function deriveVerdictFromSnowEvidence(allSnowText: string): TriageAnalysis['verdict'] | null {
  const t = allSnowText.toLowerCase();
  if (/domain account|active directory|\bad\b|cannot be changed|resets.*login|resets.*sunrise|group policy|no.*parameter to (configure|override|set)|does not expose|mlm.*only sets|no.*way to configure|admin.*setting|cannot.*override/i.test(allSnowText))
    return 'CONFIG / INSTALL';
  if (/by design|as designed|working as designed|\bwad\b|expected behavior|intended behavior|this is how|always (worked|behaved)|working correctly/i.test(allSnowText))
    return 'INTENDED BEHAVIOR';
  if (/feature request|enhancement request|not (yet )?supported|not implemented|future (release|version)|product management|backlog|roadmap/i.test(allSnowText))
    return 'ENHANCEMENT';
  if (/null pointer|exception|stack trace|unhandled|crash|object reference|index out|ArgumentNull|NullRef/i.test(allSnowText))
    return 'CODE BUG';
  void t; // suppress unused warning
  return null;
}

function truncateEvidence(text: string, max = 180): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

function parseJsonCandidates(raw: string): unknown[] {
  const out: unknown[] = [];
  const normalized = raw.trim();
  const candidates = [normalized];

  if (normalized.includes('\\"')) {
    candidates.push(normalized.replace(/\\"/g, '"'));
  }

  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    try {
      const unwrapped = JSON.parse(normalized);
      if (typeof unwrapped === 'string') candidates.push(unwrapped);
    } catch {
      // ignore
    }
  }

  for (const c of Array.from(new Set(candidates))) {
    try {
      out.push(JSON.parse(c));
    } catch {
      // ignore
    }
  }
  return out;
}

const NOISE_AUDIT_FIELDS = new Set([
  'sys_updated_on',
  'sys_updated_by',
  'sys_created_on',
  'sys_created_by',
  'sys_mod_count',
  'u_updated_on',
  'u_updated_by',
  'u_vsts_row_id',
  'u_nct_internal_task',
  'u_nct_internal_incident',
  'u_nct_internal_case',
]);

function normalizeAuditFieldName(field: unknown): string {
  return String(field ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function prettifyAuditField(field: string): string {
  const map: Record<string, string> = {
    state: 'State',
    priority: 'Priority',
    impact: 'Impact',
    urgency: 'Urgency',
    assigned_to: 'Assigned To',
    assignment_group: 'Assignment Group',
    short_description: 'Short Description',
    description: 'Description',
    close_notes: 'Close Notes',
    work_notes: 'Work Notes',
    comments: 'Comments',
    incident: 'Incident',
    parent: 'Parent',
    u_case_number: 'Case Number',
    u_customer_case: 'Customer Case',
  };
  if (map[field]) return map[field];

  return field
    .replace(/^u_/, '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatAuditValue(value: unknown): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') return '-';
  if (text === 'JOURNAL FIELD ADDITION') return 'Note added';
  return truncateEvidence(text, 150);
}

const SNOW_STATE_LABELS: Record<string, string> = {
  '-5': 'Pending',
  '-4': 'Awaiting Evidence',
  '-3': 'Awaiting Vendor',
  '-2': 'Awaiting Customer',
  '-1': 'On Hold',
  '1': 'Open',
  '2': 'Work In Progress',
  '3': 'Closed Complete',
  '4': 'Closed Incomplete',
  '6': 'Resolved',
  '7': 'Closed',
  '8': 'Canceled',
};

function formatStateCode(value: string): string {
  const key = value.trim();
  const label = SNOW_STATE_LABELS[key];
  return label ? `${label} (${key})` : key;
}

function summarizeWorkNoteIntent(note: string): string | null {
  const text = note.toLowerCase();
  if (/please let us know|looking forward|awaiting your response|kindly confirm|need your assistance/i.test(text)) {
    return 'Support requested customer confirmation; this note is follow-up communication, not root-cause evidence.';
  }
  if (/logs? attached|attached|uploaded|screenshot/i.test(text)) {
    return 'Support indicated new evidence was attached; prioritize reviewing the latest attachments.';
  }
  if (/repro|reproduce|replicate/i.test(text)) {
    return 'Support documented reproduction context; compare this against product behavior and logs.';
  }
  if (/resolved|fixed|working now|closed/i.test(text)) {
    return 'Support note suggests a mitigation or closure path; verify if the underlying defect remains reproducible.';
  }
  return null;
}

function isNoiseAuditField(fieldName: string): boolean {
  if (NOISE_AUDIT_FIELDS.has(fieldName)) return true;
  if (fieldName.startsWith('u_vsts_')) return true;
  if (fieldName.startsWith('u_nct_')) return true;
  return false;
}

function summarizeSnowWorkNotes(raw: string): string[] {
  const summaries: string[] = [];

  const parsedCandidates = parseJsonCandidates(raw);
  for (const candidate of parsedCandidates) {
    const rows = Array.isArray(candidate) ? candidate : [candidate];

    // ServiceNow audit row shape: fieldname/newvalue/oldvalue/user/sys_created_on
    const auditRows = rows.filter((r: any) => r?.fieldname && (r?.newvalue || r?.oldvalue));
    if (auditRows.length > 0) {
      for (const row of auditRows) {
        const rawField = row?.fieldname?.display_value ?? row?.fieldname?.value ?? row?.fieldname ?? 'field';
        const fieldName = normalizeAuditFieldName(rawField);
        if (isNoiseAuditField(fieldName)) continue;

        const oldVal = formatAuditValue(row?.oldvalue?.display_value ?? row?.oldvalue?.value ?? row?.oldvalue);
        const newVal = formatAuditValue(row?.newvalue?.display_value ?? row?.newvalue?.value ?? row?.newvalue);
        const user = row?.user?.display_value ?? row?.user?.value ?? row?.sys_created_by?.display_value ?? row?.sys_created_by ?? '';
        const when = row?.sys_created_on?.display_value ?? row?.sys_created_on?.value ?? row?.sys_created_on ?? '';

        const oldState = fieldName === 'state' ? formatStateCode(oldVal) : oldVal;
        const newState = fieldName === 'state' ? formatStateCode(newVal) : newVal;

        if (oldState === newState) continue;

        const label = prettifyAuditField(fieldName || 'field');
        if (fieldName === 'work_notes' || fieldName === 'comments') {
          const journalText = newVal === 'Note added' ? 'Note added' : newVal;
          summaries.push(truncateEvidence(`${label}: ${journalText}${user ? ` | ${user}` : ''}${when ? ` | ${when}` : ''}`, 1400));
          const noteIntent = summarizeWorkNoteIntent(journalText);
          if (noteIntent) summaries.push(noteIntent);
        } else {
          summaries.push(truncateEvidence(`${label}: ${oldState} -> ${newState}${user ? ` | ${user}` : ''}${when ? ` | ${when}` : ''}`));
        }

        if (summaries.length >= 8) break;
      }
      if (summaries.length > 0) return summaries;
    }
  }

  // Fallback plain-text extraction for normal note/comment bodies
  const lines = raw.split(/\n|\\n/)
    .map(l => l.replace(/\[.*?\]/g, '').trim())
    .filter(l => l.length > 15 && /error|exception|fail|cannot|unable|version|repro|confirm|observed|occur|steps|workaround|found|tested|timed out|timeout|format|spacing|line break|missing|broken|incorrect|wrong|reproduc|screen|attach|upload|check|verify|investigat|customer|report|ticket|impact|updated|priority|assigned|state/i.test(l))
    .map(l => truncateEvidence(l, 900))
    .slice(0, 8);

  return lines;
}

/** Extract technical identifiers from SNOW notes (table names, field names, components) */
function extractTechTerms(snowText: string): string[] {
  return [...snowText.matchAll(/\b([A-Z][a-zA-Z]{2,}(?:\.[A-Z][a-zA-Z]+)+|CV3\w+|SXA\w+|SHM\w+|MLM\w+|HWS\w+|SCM\w+|eMAR\w*|KBMA\w*)\b/g)]
    .map(m => m[1])
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 8);
}

function summarizeSpreadsheetFindings(spreadsheetSummaries: SpreadsheetSummaryInput[]): string[] {
  const out: string[] = [];

  for (const sheet of spreadsheetSummaries.slice(0, 8)) {
    const source = `${sheet.file}#${sheet.sheet}`;
    const findings = (sheet.findings ?? []).map((f) => String(f).trim()).filter(Boolean);
    if (!findings.length) {
      out.push(`${source}: parsed ${sheet.rowCount} rows and ${sheet.columnCount} columns; no high-signal anomalies reported.`);
      continue;
    }

    const duplicate = findings.find((f) => /Duplicate display names/i.test(f));
    const statusMix = findings.find((f) => /Status counts|Active flag counts/i.test(f));
    const conversion = findings.find((f) => /Conversion summary|Potential mapping gaps/i.test(f));

    if (duplicate) out.push(`${source}: ${duplicate}`);
    if (statusMix) out.push(`${source}: ${statusMix}`);
    if (conversion) out.push(`${source}: ${conversion}`);

    if (!duplicate && !statusMix && !conversion) {
      out.push(`${source}: ${findings.slice(0, 2).join(' | ')}`);
    }
  }

  return Array.from(new Set(out)).slice(0, 8);
}

function tryExtractAreaIdFromPath(value: string): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;

  const normalized = text.replace(/\\/g, '/');
  const areaMatch = normalized.match(/\/areas\/([^\/\?#]+)/i);
  if (areaMatch?.[1]) return areaMatch[1].trim();

  return null;
}

function deriveSkillAreaCandidates(product: Product, areaPath: string): string[] {
  const candidates: string[] = [];

  const fromAreaPath = areaPath.includes('mobilex') ? 'sunrise-mobile'
    : areaPath.includes('compass') ? 'compass-scm'
    : areaPath.includes('clindoc') ? 'clindoc-scm'
    : '';
  if (fromAreaPath) candidates.push(fromAreaPath);

  for (const ref of product.localSkills ?? []) {
    const areaId = tryExtractAreaIdFromPath(ref.path);
    if (areaId) candidates.push(areaId);
  }
  for (const ref of product.githubSkills ?? []) {
    const areaId = tryExtractAreaIdFromPath(ref.path);
    if (areaId) candidates.push(areaId);
  }
  for (const value of product.skillPaths ?? []) {
    const areaId = tryExtractAreaIdFromPath(value);
    if (areaId) candidates.push(areaId);
  }
  for (const value of product.githubSkillPaths ?? []) {
    const areaId = tryExtractAreaIdFromPath(value);
    if (areaId) candidates.push(areaId);
  }
  if (product.skillPath) {
    const areaId = tryExtractAreaIdFromPath(product.skillPath);
    if (areaId) candidates.push(areaId);
  }

  if (product.id) candidates.push(product.id);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const value of candidates.map((x) => x.trim()).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }
  return deduped;
}

export async function buildSkillDrivenAssessment(
  adoItem: AdoWorkItem,
  product: Product,
  snowWorkNotes: string | undefined,
  logHits: Array<{ seed: string; text: string; file: string }> | undefined,
  topSeeds: Record<string, number> | undefined,
  codeHits: CodeHit[],
  areaEvidence: Array<{ id: number; title: string; state: string; type: string; supportVersion?: string }> = [],
  versionEvidence: Array<{ id: number; title: string; state: string; type: string; supportVersion?: string }> = [],
  databaseEvidence: CodeHit[] = [],
  spreadsheetSummaries: SpreadsheetSummaryInput[] = [],
  imageSummaries: ImageSummaryInput[] = [],
  snowContext: SnowContextInput = {}
): Promise<TriageAnalysis> {
  const snowField = (value: unknown): string => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      const rec = value as Record<string, unknown>;
      const dv = rec['display_value'];
      const vv = rec['value'];
      if (typeof dv === 'string' && dv.trim()) return dv;
      if (typeof vv === 'string' && vv.trim()) return vv;
    }
    return String(value);
  };

  const summarizeSnowRecord = (label: string, record?: Record<string, unknown> | null): string[] => {
    if (!record) return [];
    const id = snowField(record['number']) || snowField(record['sys_id']) || '(unknown)';
    const state = snowField(record['state']) || '-';
    const shortDesc = snowField(record['short_description']) || snowField(record['description']) || '-';
    const updated = snowField(record['sys_updated_on']) || '-';
    return [
      `${label}: ${id} | State: ${state} | Updated: ${updated}`,
      `${label} summary: ${shortDesc.slice(0, 220)}`,
    ];
  };

  const spreadsheetEvidenceLines = spreadsheetSummaries
    .slice(0, 12)
    .map((s) => {
      const headers = (s.headers ?? []).filter(Boolean).slice(0, 8).join(', ');
      const sample = (s.sampleRows ?? []).filter(Boolean)[0] ?? '';
      const findings = (s.findings ?? []).filter(Boolean).slice(0, 2).join(' | ');
      return `${s.file}#${s.sheet}: rows=${s.rowCount}, cols=${s.columnCount}${headers ? `, headers=[${headers}]` : ''}${sample ? `, sample=${sample.slice(0, 140)}` : ''}${findings ? `, findings=${findings}` : ''}`;
    });

  const imageEvidenceLines = imageSummaries
    .slice(0, 12)
    .map((image) => `${image.file}: chars=${image.charCount}, hits=${image.hitCount}${image.textPreview ? `, preview=${image.textPreview.slice(0, 140)}` : ''}${image.findings?.length ? `, findings=${image.findings.slice(0, 2).join(' | ')}` : ''}`);

  const bulletize = (items: Array<string | undefined | null>): string =>
    items
      .map((v) => String(v ?? '').trim())
      .filter(Boolean)
      .map((v) => `- ${v}`)
      .join('\n');

  const bridge = BRIDGE();
  const f = adoItem.fields;
  const areaPath = String(f['System.AreaPath'] ?? '').toLowerCase();
  const areaCandidates = deriveSkillAreaCandidates(product, areaPath);

  // Collect all evidence text for pattern scoring
  const allText = [
    f['System.Title'] ?? '',
    String(f['System.Description'] ?? '').replace(/<[^>]+>/g, ' '),
    String(f['Allscripts.Field.DevAssistDetail'] ?? ''),
    snowWorkNotes ?? '',
    (logHits ?? []).map(h => h.text).join(' '),
    spreadsheetEvidenceLines.join(' '),
    imageEvidenceLines.join(' '),
  ].join(' ').toLowerCase();

  const seeds = topSeeds ?? {};
  const title = f['System.Title'] ?? '';
  const customer = String(f['Allscripts.Field.CustomerName'] ?? 'the client');
  const version = String(f['Allscripts.Field.SupportVersion'] ?? 'unknown');

  // ── Step 1: fetch skill files ─────────────────────────────────────────────
  let playbook: PlaybookPattern[] = [];
  let reposMd = '';
  let profileMd = '';
  let resolvedAreaId = '';
  let loadedSkillFiles: string[] = [];

  for (const areaId of areaCandidates) {
    try {
      const r = await fetch(`${bridge}/api/skills/area/${encodeURIComponent(areaId)}`, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) continue;
      const data = await r.json() as { files: Record<string, string> };
      if (data.files['analysis-playbook.md']) playbook = parsePlaybook(data.files['analysis-playbook.md']);
      reposMd = data.files['repositories.md'] ?? '';
      profileMd = data.files['profile.md'] ?? '';
      loadedSkillFiles = Object.keys(data.files ?? {});
      resolvedAreaId = areaId;
      break;
    } catch {
      // Non-fatal: continue trying the next candidate.
    }
  }

  // ── Step 2: score playbook patterns ──────────────────────────────────────
  let best: PlaybookPattern | null = null;
  let bestScore = 0;
  for (const p of playbook) {
    const s = scorePattern(p, allText, seeds);
    if (s > bestScore) { bestScore = s; best = p; }
  }

  // Fall back to keyword-pattern if skill files have no match
  const keywordPattern = matchPatternAny(adoItem);
  const matchedPlaybookPattern = bestScore >= 3 ? best : null;

  // ── Step 3: client reported ───────────────────────────────────────────────
  const desc = String(f['System.Description'] ?? f['Allscripts.Field.DevAssistDetail'] ?? '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const clientReported = bulletize([
    `Customer: ${customer}`,
    `Version: ${version}`,
    `Issue: ${title}`,
    desc ? `Context: ${desc.slice(0, 220)}` : '',
  ]);

  // ── Step 4: SNOW evidence ─────────────────────────────────────────────────
  const snowEvidence: string[] = [];
  if (snowWorkNotes) {
    const lines = summarizeSnowWorkNotes(snowWorkNotes);
    snowEvidence.push(...lines);
    const vers = snowWorkNotes.match(/\b\d+\.\d+(\.\d+)+\b/g)?.slice(0, 3) ?? [];
    if (vers.length) snowEvidence.push(`Versions in SNOW: ${vers.join(', ')}`);
  }
  snowEvidence.push(...summarizeSnowRecord('SNOW Task', snowContext.snowTask));
  snowEvidence.push(...summarizeSnowRecord('SNOW Incident', snowContext.snowIncident));
  snowEvidence.push(...summarizeSnowRecord('SNOW Case', snowContext.snowCase));

  // Log evidence
  const logEvidence: string[] = [];
  if (Object.keys(seeds).length) {
    const top = Object.entries(seeds).sort(([,a],[,b]) => b-a).slice(0, 5);
    logEvidence.push(`Log signals: ${top.map(([s,c]) => `${s} (${c}×)`).join(', ')}`);
    const timeouts = seeds['progress indicator has timed out'] ?? 0;
    const locks    = seeds['LockWithTimeout'] ?? 0;
    if (timeouts > 0) logEvidence.push(`CLIENT timeout confirmed: "progress indicator has timed out" ×${timeouts}`);
    if (locks > 100)  logEvidence.push(`LOCK CONTENTION: LockWithTimeout ×${locks} — IIS worker queue backing up`);
    if (timeouts > 0 && locks > 0) logEvidence.push('Server side shows lock pressure; client gave up waiting → server-side fix needed');
  }
  const keyLogLine = (logHits ?? []).find(h =>
    /timed out|exception|FATAL|error/i.test(h.seed) || /timed out|exception|FATAL/i.test(h.text)
  );
  if (keyLogLine) logEvidence.push(`Key log line: "${keyLogLine.text.slice(0, 160)}"`);

  if (areaEvidence.length > 0) {
    const closedCount = areaEvidence.filter((i) => /closed|resolved|done|completed/i.test(i.state)).length;
    logEvidence.push(`ADO area evidence: ${areaEvidence.length} recent items reviewed (${closedCount} closed/resolved)`);
  }
  if (versionEvidence.length > 0) {
    const closedVersion = versionEvidence.filter((i) => /closed|resolved|done|completed/i.test(i.state)).length;
    logEvidence.push(`Version evidence: ${versionEvidence.length} area items mention release hints (closed/resolved: ${closedVersion})`);
  }
  if (databaseEvidence.length > 0) {
    logEvidence.push(`Database evidence: ${databaseEvidence.length} code hit(s) in configured DB repo paths`);
  }
  if (spreadsheetSummaries.length > 0) {
    logEvidence.push(`Spreadsheet evidence: ${spreadsheetSummaries.length} sheet summary row(s) extracted from attachments`);
    const spreadsheetInsights = summarizeSpreadsheetFindings(spreadsheetSummaries);
    if (spreadsheetInsights.length > 0) {
      logEvidence.push(`Spreadsheet analysis: ${spreadsheetInsights.join(' || ')}`);
    }
  }
  if (imageSummaries.length > 0) {
    logEvidence.push(`Image OCR evidence: ${imageSummaries.length} attachment(s) produced OCR text`);
    logEvidence.push(`Image OCR highlights: ${imageEvidenceLines.slice(0, 3).join(' || ')}`);
  }

  // ── Step 5: code analysis ─────────────────────────────────────────────────
  const snowTechTerms = extractTechTerms(snowWorkNotes ?? '');
  let codeAnalysis: string;
  if (matchedPlaybookPattern) {
    const repoRow = reposMd.match(/\|\s*(HWS|SunriseMobile)[^\|]*\|[^\|]*\|[^\|]*\|([^\|]+)\|/)?.[2]?.trim() ?? '';
    codeAnalysis = bulletize([
      `Pattern match: ${matchedPlaybookPattern.num} - ${matchedPlaybookPattern.name}`,
      `Signature: ${matchedPlaybookPattern.signature.slice(0, 300)}`,
      matchedPlaybookPattern.confirm ? `Confirm with: ${matchedPlaybookPattern.confirm.slice(0, 300)}` : '',
      repoRow ? `Priority code areas: ${repoRow}` : '',
      codeHits.length ? `Code hits: ${codeHits.map(h => h.path).slice(0,4).join(', ')}` : 'Code hits: none from API search',
      versionEvidence.length ? `Historical same-version items (context only): ${versionEvidence.slice(0, 4).map((i) => `#${i.id} (${i.state})`).join(', ')}` : '',
      databaseEvidence.length ? `Database repo hits: ${databaseEvidence.slice(0, 4).map((h) => `${h.repo}:${h.path}`).join(', ')}` : '',
    ]);
  } else if (keywordPattern) {
    codeAnalysis = bulletize([
      `Keyword pattern: ${keywordPattern.name}`,
      `Search seeds: ${keywordPattern.searchSeeds.join(', ')}`,
      `Repos: ${product.repos.filter(r => r.required).map(r => `${r.owner}/${r.repo}`).join(', ')}`,
      snowTechTerms.length ? `SNOW technical terms: ${snowTechTerms.join(', ')}` : '',
      codeHits.length ? `Code hits: ${codeHits.map(h => h.path).slice(0,4).join(', ')}` : 'Code hits: none (consider local clone search)',
      versionEvidence.length ? `Historical same-version items (context only): ${versionEvidence.slice(0, 4).map((i) => `#${i.id} ${i.type} (${i.state})`).join(', ')}` : '',
      databaseEvidence.length ? `Database repo hits: ${databaseEvidence.slice(0, 4).map((h) => `${h.repo}:${h.path}`).join(', ')}` : '',
    ]);
  } else {
    // Derive from SNOW evidence — most reliable when no pattern matches
    codeAnalysis = bulletize([
      `No pattern match for: ${title.slice(0, 100)}`,
      snowTechTerms.length ? `SNOW technical identifiers: ${snowTechTerms.join(', ')}` : '',
      `Repos: ${product.repos.map(r => `${r.owner}/${r.repo}`).join(', ')}`,
      resolvedAreaId
        ? `Skill area: ${resolvedAreaId} (${playbook.length} patterns loaded, none high-confidence)`
        : areaCandidates.length
          ? `No skill area matched from candidates: ${areaCandidates.join(', ')}`
          : `No skill-area mapping for this product/area path. Configure skill mapping in product registry or skill-area rules.`,
      codeHits.length ? `Code hits: ${codeHits.map(h => h.path).slice(0,4).join(', ')}` : 'Code hits: none',
      versionEvidence.length ? `Historical same-version items (context only): ${versionEvidence.slice(0, 4).map((i) => `#${i.id} ${i.type} (${i.state})`).join(', ')}` : '',
      databaseEvidence.length ? `Database repo hits: ${databaseEvidence.slice(0, 4).map((h) => `${h.repo}:${h.path}`).join(', ')}` : '',
    ]);
  }

  // ── Step 6: gap — prefer SNOW-derived over pattern fallback ──────────────
  let gap: string;
  if (matchedPlaybookPattern) {
    gap = bulletize([
      `Observed gap: behavior aligns to playbook pattern ${matchedPlaybookPattern.num}`,
      `Fix direction: ${matchedPlaybookPattern.fixDirection}`,
      'Confidence support: evidence aligns with playbook signature and confirm steps',
    ]);
  } else if (snowEvidence.length >= 2) {
    // Synthesise a gap statement from what SNOW support actually found
    gap = bulletize([
      `SNOW diagnosis: ${snowEvidence.slice(0, 3).map(e => truncateEvidence(e, 120)).join(' | ')}`,
      snowTechTerms.length ? `Impacted components: ${snowTechTerms.slice(0, 4).join(', ')}` : '',
      keywordPattern ? `Related fix direction: ${keywordPattern.fixDirection}` : 'No matching code pattern; inspect components above.',
    ]);
  } else if (keywordPattern) {
    gap = bulletize([
      `Observed gap: keyword pattern match (${keywordPattern.name})`,
      `Fix direction: ${keywordPattern.fixDirection}`,
    ]);
  } else {
    gap = bulletize([
      `Symptom: ${title.slice(0, 150)}`,
      'No matching analysis pattern detected.',
      `Inspect repos: ${product.repos.map(r=>r.repo).join(', ')}`,
    ]);
  }

  // ── Step 7: verdict — SNOW evidence overrides keyword pattern ────────────
  const snowDerivedVerdict = deriveVerdictFromSnowEvidence([...snowEvidence, title, desc].join(' '));
  const keywordVerdict: TriageAnalysis['verdict'] = matchedPlaybookPattern
    ? (keywordPattern?.verdict ?? 'CODE BUG')
    : (keywordPattern?.verdict ?? 'NEED MORE INFO');
  // SNOW evidence is more reliable than keyword pattern matching
  const rawVerdict: TriageAnalysis['verdict'] = snowDerivedVerdict ?? keywordVerdict;

  let confidence: TriageAnalysis['confidence'] = matchedPlaybookPattern
    ? (bestScore >= 8 ? 'High' : 'Medium')
    : snowDerivedVerdict ? 'Medium' : (keywordPattern ? 'Low' : null);

  // Raise/lower based on evidence quality
  if (logEvidence.some(l => l.includes('CLIENT timeout confirmed')) && confidence === 'Medium') confidence = 'High';
  if (!snowWorkNotes && !logHits?.length) confidence = confidence === 'High' ? 'Medium' : 'Low';

  // ── Step 8: blind spots (from profile.md clarity checklist) ──────────────
  const blindSpots: string[] = [];
  if (!logHits?.length) blindSpots.push('HWS logs not attached or not yet scanned — attach logs for the incident window to raise confidence');
  if (!codeHits.length) blindSpots.push('Code search found no hits — clone SunriseMobile + HWS repos locally for direct inspection');
  if (!snowWorkNotes)   blindSpots.push('SNOW work notes empty — review SNOW task for additional context from support engineer');
  if (!databaseEvidence.length) blindSpots.push('No direct DB repo hit found — broaden DB search terms (SP/view/table names) for deeper database verification');
  if (!spreadsheetSummaries.length) blindSpots.push('No spreadsheet evidence extracted from attachments — include PSS workbook exports when available');
  if (!imageSummaries.length) blindSpots.push('No image OCR evidence extracted from attachments — screenshots may still need manual review if OCR is poor');
  if (!matchedPlaybookPattern && playbook.length > 0) {
    blindSpots.push(`None of the ${playbook.length} playbook patterns matched with high confidence — this may be a new/unknown pattern`);
  }
  if (resolvedAreaId === 'sunrise-mobile') {
    blindSpots.push('Device-side logs unavailable — client traces in HWS are anonymous (Spike 9375402)');
    blindSpots.push('Cannot tie HWS log entries to specific users without session IDs');
  }
  // Extract "Blind spots" section from profile.md
  const profileBlind = profileMd.match(/## Blind spots[\s\S]+?(?=##|$)/)?.[0]
    ?.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim()).slice(0, 2) ?? [];
  blindSpots.push(...profileBlind.filter(b => !blindSpots.some(e => e.includes(b.slice(0, 20)))));

  // ── Step 9: L2 draft — derived from actual verdict + SNOW evidence ────────
  let l2Draft: string | undefined;
  const clarityItems = profileMd.match(/- \[ \] \*\*([^*]+)\*\*/g)?.map(l => l.replace(/- \[ \] \*\*|\*\*/g, '').trim()) ?? [];
  if (rawVerdict === 'CONFIG / INSTALL') {
    l2Draft = `Thank you for contacting Altera support.\n\nWe have reviewed DA ${adoItem.id} — ${title}\n\nBased on the information provided${snowEvidence.length ? ' and our SNOW review' : ''}:\n\nThis appears to be a configuration issue rather than a code defect. ${gap.slice(0, 400)}\n\nPlease work with your system administrator to review the domain/AD account configuration. If this does not resolve the issue, please provide additional details on the environment setup.`;
  } else if (rawVerdict === 'INTENDED BEHAVIOR') {
    l2Draft = `Thank you for contacting Altera support.\n\nWe have reviewed DA ${adoItem.id} — ${title}\n\nBased on our analysis, this appears to be working as designed. ${gap.slice(0, 400)}\n\nIf this is a business requirement to change the current behavior, please submit an enhancement request.`;
  } else if (rawVerdict === 'ENHANCEMENT') {
    l2Draft = `Thank you for contacting Altera support.\n\nWe have reviewed DA ${adoItem.id} — ${title}\n\nThis functionality is not currently supported. ${gap.slice(0, 400)}\n\nThis has been noted as a potential enhancement request for future consideration.`;
  } else if (rawVerdict === 'NEED MORE INFO' || confidence === 'Low') {
    l2Draft = `Thank you for contacting Altera support.\n\nWe have reviewed the information provided for DA ${adoItem.id}.\n\nTo proceed with root cause analysis, please provide:\n${
      clarityItems.length
        ? clarityItems.slice(0, 5).map((c, i) => `${i+1}. ${c}`).join('\n')
        : `1. Log files covering the exact incident window\n2. Exact version (SCM / HWS / app build)\n3. Steps to reproduce on test/dev\n4. Whether this affects all users or specific users`
    }`;
  } else if (rawVerdict === 'CODE BUG') {
    const confText = confidence === 'High' ? 'High confidence' : `${confidence} confidence${blindSpots.length ? ` — ${blindSpots[0]}` : ''}`;
    l2Draft = `Thank you for contacting Altera support.\n\nWe have completed initial root cause analysis for DA ${adoItem.id}.\n\nFindings:\n${
      matchedPlaybookPattern
        ? `Pattern: ${matchedPlaybookPattern.name}\nFix direction: ${matchedPlaybookPattern.fixDirection.slice(0, 300)}`
        : gap.slice(0, 300)
    }\n\n${confText}.`;
  }

  const skillSections = {
    preflightChecks: [
      `Input type: ${String((adoItem as any)?.id ? 'DA/TFS' : 'Direct SNOW')}`,
      `Bridge endpoint: ${bridge}`,
      `Skill root status: ${resolvedAreaId ? 'matched' : 'not matched'}`,
      `Playbook patterns loaded: ${playbook.length}`,
    ],
    routingDecision: [
      `Product selected: ${product.displayName} (${product.id})`,
      `ADO area path: ${String(f['System.AreaPath'] ?? '-')}`,
      `Skill area candidates: ${areaCandidates.join(', ') || '-'}`,
      `Resolved skill area: ${resolvedAreaId || 'none'}`,
    ],
    skillFilesUsed: loadedSkillFiles.length
      ? loadedSkillFiles.sort((a, b) => a.localeCompare(b))
      : ['No skill files loaded for current area mapping'],
    evidenceQuality: [
      `SNOW evidence rows: ${snowEvidence.length}`,
      `Log hit rows: ${logHits?.length ?? 0}`,
      `Code hits: ${codeHits.length}`,
      `Spreadsheet summaries: ${spreadsheetSummaries.length}`,
      `Image OCR summaries: ${imageSummaries.length}`,
      blindSpots.length ? `Primary gap: ${blindSpots[0]}` : 'No major evidence gap detected',
    ],
  };

  return {
    verdict: rawVerdict,
    confidence,
    clientReported,
    snowEvidence: [...snowEvidence, ...logEvidence],
    codeAnalysis,
    gap,
    blindSpots,
    skillSections,
    l2Draft,
  };
}
