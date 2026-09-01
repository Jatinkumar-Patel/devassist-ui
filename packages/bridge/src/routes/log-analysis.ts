import { Router, Request, Response } from 'express';
import { execPowerShell } from '../utils/powershell';
import fs from 'fs';
import path from 'path';
import os from 'os';
import * as XLSX from 'xlsx';

export const logAnalysisRouter = Router();

const SNOW_BASE = 'https://servicenowviewer.allscripts.com/api/SNData';

// Key patterns from areas/sunrise-mobile/logs.md + analysis-playbook.md
const GREP_SEEDS = [
  'progress indicator has timed out',
  'LogTraceInfo',
  'LockWithTimeout',
  'Client service error',
  'timed out',
  'GetPatientVisit',
  'GetSelectedVisitDataAndObservations',
  'GetPatientList',
  'lock granted',
  'lock released',
  'Application_Start',
  'ERROR',
  'FATAL',
  'Exception',
  'overlay',
  'spinner',
  'RecycleClient',
  'WARNING',
  'warn',
  'Timeout',
  'SqlException',
  'UnauthorizedAccessException',
  'OutOfMemoryException',
  'StackOverflow',
  'NullReferenceException',
  'ArgumentException',
];

const SEED_CATEGORY: Record<string, 'error' | 'warning' | 'lock' | 'ops' | 'other'> = {
  'ERROR':                              'error',
  'FATAL':                              'error',
  'Exception':                          'error',
  'SqlException':                       'error',
  'UnauthorizedAccessException':        'error',
  'OutOfMemoryException':               'error',
  'StackOverflow':                      'error',
  'NullReferenceException':             'error',
  'ArgumentException':                  'error',
  'WARNING':                            'warning',
  'warn':                               'warning',
  'progress indicator has timed out':   'warning',
  'Client service error':               'warning',
  'timed out':                          'warning',
  'Timeout':                            'warning',
  'LogTraceInfo':                       'warning',
  'LockWithTimeout':                    'lock',
  'lock granted':                       'lock',
  'lock released':                      'lock',
  'GetPatientVisit':                    'ops',
  'GetSelectedVisitDataAndObservations':'ops',
  'GetPatientList':                     'ops',
  'Application_Start':                  'other',
  'overlay':                            'other',
  'spinner':                            'other',
  'RecycleClient':                      'other',
};

interface LogHit {
  file: string;
  line: number;
  text: string;
  seed: string;
  category: 'error' | 'warning' | 'lock' | 'ops' | 'other';
}

interface SpreadsheetSummary {
  file: string;
  sheet: string;
  rowCount: number;
  columnCount: number;
  headers: string[];
  sampleRows: string[];
  findings?: string[];
}

interface ImageSummary {
  file: string;
  textPreview: string;
  charCount: number;
  findings?: string[];
  hitCount: number;
}

interface ConversionInsight {
  findings: string[];
  syntheticHits: LogHit[];
}

interface LogAnalysisResult {
  totalAttachments: number;
  scannableAttachments: number;
  analyzed: string[];
  skipped: string[];
  totalHits: number;
  hits: LogHit[];
  byCategory: Record<string, LogHit[]>;
  lockPairs: LogHit[];
  topSeeds: Record<string, number>;
  spreadsheetSummaries: SpreadsheetSummary[];
  imageSummaries: ImageSummary[];
  suggestions: CodeSuggestion[];
  cached?: boolean;
}

interface LogAnalysisCacheEntry {
  fingerprint: string;
  expiresAt: number;
  result: LogAnalysisResult;
}

const LOG_ANALYSIS_CACHE_TTL_MS = 10 * 60 * 1000;
const LOG_ANALYSIS_PARSER_VERSION = '4';
const logAnalysisCache = new Map<string, LogAnalysisCacheEntry>();
let ocrWorkerPromise: Promise<any> | null = null;

const MAX_PLAIN_BYTES  = 50 * 1024 * 1024;  // 50 MB — read whole file
const MAX_CHUNK_BYTES  = 200 * 1024 * 1024; // 200 MB — read last N lines
const TAIL_LINES       = 5000;               // lines to tail on very large files
const MAX_SKIP_BYTES   = 500 * 1024 * 1024; // 500 MB — truly skip
const MAX_OCR_IMAGE_BYTES = 15 * 1024 * 1024;

/** Read up to TAIL_LINES from the end of a large log file */
function readTail(filePath: string, maxLines: number): string {
  const stat = fs.statSync(filePath);
  // For large files: read last ~2 MB as bytes and decode
  const chunkSize = Math.min(stat.size, 2 * 1024 * 1024);
  const buf = Buffer.alloc(chunkSize);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buf, 0, chunkSize, stat.size - chunkSize);
  fs.closeSync(fd);
  const text = buf.toString('utf-8');
  const lines = text.split('\n');
  // Drop the first line (likely partial) and take the last maxLines
  return lines.slice(Math.max(1, lines.length - maxLines)).join('\n');
}

interface AttachmentMeta {
  file_name: { value: string } | string;
  sys_id: { value: string } | string;
  content_type: { value: string } | string;
  size_bytes: { value: string } | string;
}

const TEXT_EXTENSIONS = ['.log', '.txt', '.csv', '.json', '.xml'];
const SPREADSHEET_EXTENSIONS = ['.xlsx', '.xls'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff'];
const SCANNABLE_EXTENSIONS = ['.log', '.txt', '.zip', '.csv', '.json', '.xml', '.xlsx', '.xls', '.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff'];
const MAX_XLSX_BYTES = 30 * 1024 * 1024;

function extensionOf(fileName: string): string {
  const lower = fileName.toLowerCase();
  const idx = lower.lastIndexOf('.');
  return idx >= 0 ? lower.slice(idx) : '';
}

function attachmentFingerprint(attachments: AttachmentMeta[]): string {
  const parts = attachments
    .map((att) => [val(att.sys_id), val(att.file_name), val(att.content_type), val(att.size_bytes)].join(':'))
    .sort((a, b) => a.localeCompare(b));
  return `${LOG_ANALYSIS_PARSER_VERSION}|${parts.join('|')}`;
}

function val(f: unknown): string {
  if (!f) return '';
  if (typeof f === 'string') return f;
  if (typeof f === 'object' && 'value' in (f as object)) return (f as any).value ?? '';
  return String(f);
}

function countPrintable(text: string): number {
  return Array.from(text).filter((char) => {
    const code = char.charCodeAt(0);
    return char === '\n' || char === '\r' || char === '\t' || (code >= 32 && code <= 126);
  }).length;
}

function readTextFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  if (buf.length === 0) return '';

  if (buf.length >= 2) {
    if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').replace(/^\uFEFF/, '');
    if (buf[0] === 0xfe && buf[1] === 0xff) {
      const swapped = Buffer.from(buf);
      for (let i = 0; i < swapped.length - 1; i += 2) {
        const first = swapped[i];
        swapped[i] = swapped[i + 1];
        swapped[i + 1] = first;
      }
      return swapped.toString('utf16le').replace(/^\uFEFF/, '');
    }
  }

  const utf8 = buf.toString('utf8').replace(/^\uFEFF/, '');
  const utf16 = buf.toString('utf16le').replace(/^\uFEFF/, '');
  const latin1 = buf.toString('latin1');

  const candidates = [utf8, utf16, latin1].map((text) => ({ text, score: countPrintable(text) }));
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.text ?? utf8;
}

function walkFilesRecursive(rootDir: string): string[] {
  const out: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }

  return out;
}

async function getOcrWorker(): Promise<any> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const tesseract = await import('tesseract.js');
      return (tesseract as any).createWorker('eng', 1, { logger: () => undefined });
    })();
  }
  return ocrWorkerPromise;
}

async function analyzeImage(filePath: string, fileName: string): Promise<{ hits: LogHit[]; summary: ImageSummary }> {
  const worker = await getOcrWorker();
  const recognized = await worker.recognize(filePath);
  const text = String(recognized?.data?.text ?? '').replace(/\s+/g, ' ').trim();
  const findings: string[] = [];
  const preview = text.slice(0, 240);
  if (text) {
    findings.push(`OCR extracted ${text.length} characters`);
    if (/error|exception|timeout|failed|missing|invalid|denied|cannot|unable/i.test(text)) {
      findings.push('Image text contains diagnostic keywords');
    }
  } else {
    findings.push('No OCR text detected');
  }

  const hits = text ? parseHwsLog(text, fileName) : [];
  return {
    hits,
    summary: {
      file: fileName,
      textPreview: preview,
      charCount: text.length,
      findings,
      hitCount: hits.length,
    },
  };
}

function parseHwsLog(content: string, fileName: string): LogHit[] {
  const hits: LogHit[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const seed of GREP_SEEDS) {
      if (line.toLowerCase().includes(seed.toLowerCase())) {
        hits.push({
          file: fileName,
          line: i + 1,
          text: line.trim().slice(0, 300),
          seed,
          category: SEED_CATEGORY[seed] ?? 'other',
        });
        break;
      }
    }
  }
  return hits;
}

function parseSpreadsheet(filePath: string, fileName: string): { hits: LogHit[]; summaries: SpreadsheetSummary[] } {
  const hits: LogHit[] = [];
  const summaries: SpreadsheetSummary[] = [];
  const wb = XLSX.readFile(filePath, { dense: true, cellDates: false });

  const norm = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const parseBoolish = (value: string): boolean | undefined => {
    const v = value.trim().toLowerCase();
    if (!v) return undefined;
    if (v === '1' || v === 'true' || v === 'active' || v === 'yes' || v === 'y') return true;
    if (v === '0' || v === 'false' || v === 'inactive' || v === 'no' || v === 'n') return false;
    return undefined;
  };

  for (const sheetName of wb.SheetNames.slice(0, 10)) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as unknown[];
    const visibleRows = rows
      .map((row) => Array.isArray(row) ? row.map((v) => String(v ?? '').trim()) : [String(row ?? '').trim()])
      .filter((cells) => cells.some((c) => c.length > 0));

    if (visibleRows.length > 0) {
      const headers = visibleRows[0]
        .map((x) => String(x ?? '').trim())
        .filter(Boolean)
        .slice(0, 20);
      const columnCount = Math.max(...visibleRows.map((r) => r.length));
      const sampleRows = visibleRows
        .slice(1, 6)
        .map((r) => r.slice(0, 20).join(' | ').slice(0, 300));

      const headerRow = visibleRows[0].map((x) => String(x ?? '').trim());
      const headerMap = new Map<string, number>();
      headerRow.forEach((h, idx) => {
        if (h) headerMap.set(norm(h), idx);
      });
      const indexOfAny = (aliases: string[]): number => {
        for (const alias of aliases) {
          const idx = headerMap.get(norm(alias));
          if (typeof idx === 'number') return idx;
        }
        return -1;
      };
      const idxDisplayName = indexOfAny(['DisplayName']);
      const idxFirstName = indexOfAny(['FirstName']);
      const idxLastName = indexOfAny(['LastName']);
      const idxPersonGuid = indexOfAny(['PersonGUID', 'PersonGuid']);
      const idxGuid = indexOfAny(['GUID', 'Guid']);
      const idxNameType = indexOfAny(['NameTypeCode']);
      const idxActive = indexOfAny(['Active']);
      const idxStatus = indexOfAny(['Status']);

      const rows = visibleRows.slice(1).filter((row) => {
        if (!row.length) return false;
        const joined = row.slice(0, Math.min(row.length, 10)).map((x) => String(x ?? '').trim().toLowerCase()).join('|');
        // Skip repeated header lines embedded in exports.
        return !(joined.includes('siteid') && joined.includes('repflags') && (joined.includes('firstname') || joined.includes('displayname')));
      });

      const conversionInsight = analyzeConversionRows(fileName, sheetName, headerRow, rows);

      const displayNameCounts = new Map<string, number>();
      const personGuidSet = new Set<string>();
      const guidSet = new Set<string>();
      const nameTypeCounts = new Map<string, number>();
      const personGuidToNameTypes = new Map<string, Set<string>>();
      let activeTrue = 0;
      let activeFalse = 0;
      let statusActive = 0;
      let statusInactive = 0;

      for (const row of rows) {
        const val = (idx: number): string => (idx >= 0 ? String(row[idx] ?? '').trim() : '');
        const first = val(idxFirstName);
        const last = val(idxLastName);
        const displayName = val(idxDisplayName) || [last, first].filter(Boolean).join(', ');
        const personGuid = val(idxPersonGuid);
        const guid = val(idxGuid);
        const nameType = val(idxNameType);
        const activeVal = val(idxActive);
        const status = val(idxStatus);

        if (displayName) displayNameCounts.set(displayName, (displayNameCounts.get(displayName) ?? 0) + 1);
        if (personGuid) personGuidSet.add(personGuid);
        if (guid) guidSet.add(guid);
        if (nameType) nameTypeCounts.set(nameType, (nameTypeCounts.get(nameType) ?? 0) + 1);

        if (personGuid && nameType) {
          const set = personGuidToNameTypes.get(personGuid) ?? new Set<string>();
          set.add(nameType);
          personGuidToNameTypes.set(personGuid, set);
        }

        const active = parseBoolish(activeVal);
        if (active === true) activeTrue += 1;
        if (active === false) activeFalse += 1;

        if (status) {
          const s = status.trim().toLowerCase();
          if (s === 'active') statusActive += 1;
          if (s === 'inactive') statusInactive += 1;
        }
      }

      const duplicateDisplayNames = Array.from(displayNameCounts.entries())
        .filter(([, count]) => count > 1)
        .sort((a, b) => b[1] - a[1]);
      const multiTypePersons = Array.from(personGuidToNameTypes.entries())
        .filter(([, types]) => types.size > 1)
        .slice(0, 3)
        .map(([pg, types]) => `${pg}: ${Array.from(types).join('/')}`);

      const findings: string[] = [];
      findings.push(`Rows analyzed: ${rows.length}; unique GUIDs: ${guidSet.size}; unique PersonGUIDs: ${personGuidSet.size}`);
      if (duplicateDisplayNames.length) {
        findings.push(`Duplicate display names: ${duplicateDisplayNames.slice(0, 3).map(([name, count]) => `${name} (${count})`).join(', ')}`);
      }
      if (nameTypeCounts.size) {
        findings.push(`NameTypeCode distribution: ${Array.from(nameTypeCounts.entries()).map(([type, count]) => `${type}:${count}`).join(', ')}`);
      }
      if (activeTrue || activeFalse) {
        findings.push(`Active flag counts: true=${activeTrue}, false=${activeFalse}`);
      }
      if (statusActive || statusInactive) {
        findings.push(`Status counts: Active=${statusActive}, Inactive=${statusInactive}`);
      }
      if (multiTypePersons.length) {
        findings.push(`PersonGUIDs with multiple NameTypeCode values: ${multiTypePersons.join(' | ')}`);
      }
      findings.push(...conversionInsight.findings);

      summaries.push({
        file: fileName,
        sheet: sheetName,
        rowCount: visibleRows.length,
        columnCount,
        headers,
        sampleRows,
        findings,
      });

      hits.push(...conversionInsight.syntheticHits);
    }

    const maxRows = Math.min(rows.length, 20000);

    for (let i = 0; i < maxRows; i++) {
      const row = rows[i];
      const rowText = Array.isArray(row)
        ? row.map((v) => String(v ?? '')).join(' | ')
        : String(row ?? '');
      if (!rowText.trim()) continue;

      for (const seed of GREP_SEEDS) {
        if (rowText.toLowerCase().includes(seed.toLowerCase())) {
          hits.push({
            file: `${fileName}#${sheetName}`,
            line: i + 1,
            text: rowText.trim().slice(0, 300),
            seed,
            category: SEED_CATEGORY[seed] ?? 'other',
          });
          break;
        }
      }
    }
  }

  return { hits, summaries };
}

function analyzeConversionRows(
  fileName: string,
  sheetName: string,
  headers: string[],
  rows: string[][]
): ConversionInsight {
  const out: ConversionInsight = { findings: [], syntheticHits: [] };
  if (!headers.length || !rows.length) return out;

  const norm = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const headerMap = new Map<string, number>();
  headers.forEach((h, idx) => {
    const key = norm(String(h ?? ''));
    if (key) headerMap.set(key, idx);
  });

  const findIndex = (aliases: string[]): number => {
    for (const alias of aliases) {
      const idx = headerMap.get(norm(alias));
      if (typeof idx === 'number') return idx;
    }
    return -1;
  };

  const idxOld = findIndex(['OldValue', 'Old', 'SourceValue', 'Source', 'Before', 'From']);
  const idxNew = findIndex(['NewValue', 'New', 'TargetValue', 'Target', 'After', 'To']);
  const idxStatus = findIndex(['Status', 'Result', 'Outcome', 'State']);
  const idxReason = findIndex(['Reason', 'Message', 'Comments', 'Note']);

  let changed = 0;
  let unchanged = 0;
  let blankTargets = 0;
  const statusCounts = new Map<string, number>();
  const conversionExamples: string[] = [];
  const issueExamples: string[] = [];

  const maxRows = Math.min(rows.length, 20000);
  for (let i = 0; i < maxRows; i++) {
    const row = rows[i];
    const valueAt = (idx: number): string => (idx >= 0 ? String(row[idx] ?? '').trim() : '');
    const oldVal = valueAt(idxOld);
    const newVal = valueAt(idxNew);
    const status = valueAt(idxStatus);
    const reason = valueAt(idxReason);

    if (oldVal || newVal) {
      if (oldVal && newVal) {
        if (oldVal !== newVal) {
          changed += 1;
          if (conversionExamples.length < 3) conversionExamples.push(`${oldVal} -> ${newVal}`);
        } else {
          unchanged += 1;
        }
      } else if (oldVal && !newVal) {
        blankTargets += 1;
        if (issueExamples.length < 3) issueExamples.push(`missing target for ${oldVal}`);
      }
    }

    if (status) {
      const key = status.toLowerCase();
      statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);
      if (/fail|error|reject|invalid|missing|not found|unmapped/i.test(status) || /fail|error|reject|invalid|missing|not found|unmapped/i.test(reason)) {
        out.syntheticHits.push({
          file: `${fileName}#${sheetName}`,
          line: i + 2,
          text: `${status}${reason ? ` | ${reason}` : ''}`.slice(0, 300),
          seed: 'SpreadsheetDataSignal',
          category: 'other',
        });
      }
    }
  }

  if (changed > 0 || blankTargets > 0 || statusCounts.size > 0) {
    out.findings.push(`Conversion summary: changed=${changed}, unchanged=${unchanged}, missing_target=${blankTargets}`);
  }
  if (conversionExamples.length > 0) {
    out.findings.push(`Conversion examples: ${conversionExamples.join(' | ')}`);
  }
  if (issueExamples.length > 0) {
    out.findings.push(`Potential mapping gaps: ${issueExamples.join(' | ')}`);
  }
  if (statusCounts.size > 0) {
    const topStatuses = Array.from(statusCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([status, count]) => `${status}:${count}`)
      .join(', ');
    out.findings.push(`Status distribution: ${topStatuses}`);
  }

  out.syntheticHits = out.syntheticHits.slice(0, 40);
  return out;
}

// GET /api/log-analysis/:recordSysId — download + parse all log attachments for a SNOW record
logAnalysisRouter.get('/:recordSysId', async (req: Request, res: Response) => {
  const { recordSysId } = req.params;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devassist-'));

  try {
    // 1. Get attachment list
    const attachListRaw = await execPowerShell(
      `(Invoke-WebRequest -Uri '${SNOW_BASE}/GetAttachments/?sysid=${recordSysId}' -UseDefaultCredentials -UseBasicParsing).Content`
    );
    const outer = JSON.parse(attachListRaw.trim());
    const parsed = typeof outer === 'string' ? JSON.parse(outer) : outer;
    const attachments: AttachmentMeta[] = Array.isArray(parsed?.result) ? parsed.result : [];
    const fingerprint = attachmentFingerprint(attachments);
    const cached = logAnalysisCache.get(recordSysId);
    if (cached && cached.fingerprint === fingerprint && cached.expiresAt > Date.now()) {
      return res.json({ ...cached.result, cached: true });
    }

    const scannableFiles: AttachmentMeta[] = [];

    const allHits: LogHit[] = [];
    const spreadsheetSummaries: SpreadsheetSummary[] = [];
    const imageSummaries: ImageSummary[] = [];
    const analyzed: string[] = [];
    const skipped: string[] = [];

    for (const att of attachments) {
      const fileName = val(att.file_name) || '(unnamed attachment)';
      const ext = extensionOf(fileName);
      if (SCANNABLE_EXTENSIONS.includes(ext)) {
        scannableFiles.push(att);
      } else {
        const ctype = val(att.content_type) || 'unknown type';
        skipped.push(`${fileName} (evidence-only attachment; manual review required: ${ctype})`);
      }
    }

    for (const att of scannableFiles) {
      const fileName = val(att.file_name);
      const sysId = val(att.sys_id);
      const contentType = val(att.content_type);
      const sizeBytesStr = val(att.size_bytes);
      const sizeBytes = parseInt(sizeBytesStr, 10) || 0;

      // Skip very large files (> 500 MB) entirely
      if (sizeBytes > MAX_SKIP_BYTES) {
        skipped.push(`${fileName} (too large to process: ${Math.round(sizeBytes / 1024 / 1024)}MB)`);
        continue;
      }

      const outPath = path.join(tmpDir, fileName.replace(/[^\w.\-]/g, '_'));

      try {
        // Suppress PS progress output (fixes transport errors on large downloads)
        await execPowerShell(
          `$ProgressPreference = 'SilentlyContinue'; ` +
          `Invoke-WebRequest -Uri '${SNOW_BASE}/GetAttachment/?sysid=${sysId}' ` +
          `-UseDefaultCredentials -UseBasicParsing -TimeoutSec 300 -OutFile '${outPath}'`
        );

        if (contentType.includes('zip') || fileName.endsWith('.zip')) {
          // Extract zip and parse each .log file inside
          const extractDir = outPath + '_extracted';
          fs.mkdirSync(extractDir, { recursive: true });
          await execPowerShell(
            `Expand-Archive -Path '${outPath}' -DestinationPath '${extractDir}' -Force`
          );
          const extracted = walkFilesRecursive(extractDir);
          for (const innerPath of extracted) {
            const relativeName = path.relative(extractDir, innerPath).replace(/\\/g, '/');
            const innerStat = fs.statSync(innerPath);
            const innerExt = extensionOf(relativeName);
            if (!SCANNABLE_EXTENSIONS.includes(innerExt)) continue;
            let note = '';
            if (innerStat.size > MAX_SKIP_BYTES) {
              skipped.push(`${fileName}/${relativeName} (too large: ${Math.round(innerStat.size / 1024 / 1024)}MB)`);
              continue;
            }

            let hits: LogHit[] = [];
            if (SPREADSHEET_EXTENSIONS.includes(innerExt)) {
              if (innerStat.size > MAX_XLSX_BYTES) {
                skipped.push(`${fileName}/${relativeName} (spreadsheet too large: ${Math.round(innerStat.size / 1024 / 1024)}MB)`);
                continue;
              }
              const parsed = parseSpreadsheet(innerPath, `${fileName}/${relativeName}`);
              hits = parsed.hits;
              spreadsheetSummaries.push(...parsed.summaries);
              analyzed.push(`${fileName}/${relativeName} (spreadsheet parsed: ${parsed.summaries.length} sheet(s), ${hits.length} log-pattern hit(s))`);
            } else if (IMAGE_EXTENSIONS.includes(innerExt)) {
              if (innerStat.size > MAX_OCR_IMAGE_BYTES) {
                skipped.push(`${fileName}/${relativeName} (image too large for OCR: ${Math.round(innerStat.size / 1024 / 1024)}MB)`);
                continue;
              }
              const parsed = await analyzeImage(innerPath, `${fileName}/${relativeName}`);
              hits = parsed.hits;
              imageSummaries.push(parsed.summary);
              analyzed.push(`${fileName}/${relativeName} (image OCR: ${parsed.summary.charCount} chars, ${hits.length} log-pattern hit(s))`);
            } else if (TEXT_EXTENSIONS.includes(innerExt)) {
              let content: string;
              if (innerStat.size > MAX_PLAIN_BYTES) {
                content = readTail(innerPath, TAIL_LINES);
                note = ` [last ${TAIL_LINES} lines of ${Math.round(innerStat.size / 1024 / 1024)}MB]`;
              } else {
                content = readTextFile(innerPath);
              }
              hits = parseHwsLog(content, `${fileName}/${relativeName}`);
              analyzed.push(`${fileName}/${relativeName}${note} (${hits.length} hit(s))`);
            }

            allHits.push(...hits);
          }
        } else {
          let note = '';
          const rawStat = fs.statSync(outPath);
          const ext = extensionOf(fileName);
          let hits: LogHit[] = [];
          if (SPREADSHEET_EXTENSIONS.includes(ext)) {
            if (rawStat.size > MAX_XLSX_BYTES) {
              skipped.push(`${fileName} (spreadsheet too large: ${Math.round(rawStat.size / 1024 / 1024)}MB)`);
              continue;
            }
            const parsed = parseSpreadsheet(outPath, fileName);
            hits = parsed.hits;
            spreadsheetSummaries.push(...parsed.summaries);
            analyzed.push(
              `${fileName} (spreadsheet parsed: ${parsed.summaries.length} sheet(s), ${hits.length} log-pattern hit(s))`
            );
          } else if (IMAGE_EXTENSIONS.includes(ext)) {
            if (rawStat.size > MAX_OCR_IMAGE_BYTES) {
              skipped.push(`${fileName} (image too large for OCR: ${Math.round(rawStat.size / 1024 / 1024)}MB)`);
              continue;
            }
            const parsed = await analyzeImage(outPath, fileName);
            hits = parsed.hits;
            imageSummaries.push(parsed.summary);
            analyzed.push(`${fileName} (image OCR: ${parsed.summary.charCount} chars, ${hits.length} log-pattern hit(s))`);
          } else {
            let content: string;
            if (rawStat.size > MAX_PLAIN_BYTES) {
              content = readTail(outPath, TAIL_LINES);
              note = ` [last ${TAIL_LINES} lines of ${Math.round(rawStat.size / 1024 / 1024)}MB]`;
            } else {
              content = readTextFile(outPath);
            }
            hits = parseHwsLog(content, fileName);
            analyzed.push(`${fileName}${note} (${hits.length} hit(s))`);
          }

          allHits.push(...hits);
        }
      } catch (e: any) {
        skipped.push(`${fileName} (${e.message.slice(0, 80)})`);
      }
    }

    // Build op-duration summary from lock granted/released pairs (per analysis-playbook.md tooling)
    const lockPairs = extractLockPairs(allHits);
    const byCategory = groupByCategory(allHits);
    const suggestions = buildSuggestions(allHits);

    const result: LogAnalysisResult = {
      totalAttachments: attachments.length,
      scannableAttachments: scannableFiles.length,
      analyzed,
      skipped,
      totalHits: allHits.length,
      hits: allHits.slice(0, 100), // cap display at 100
      byCategory,
      lockPairs: lockPairs.slice(0, 20),
      topSeeds: summariseBySeeds(allHits),
      spreadsheetSummaries: spreadsheetSummaries.slice(0, 60),
      imageSummaries: imageSummaries.slice(0, 40),
      suggestions,
      cached: false,
    };

    logAnalysisCache.set(recordSysId, {
      fingerprint,
      expiresAt: Date.now() + LOG_ANALYSIS_CACHE_TTL_MS,
      result,
    });

    return res.json(result);

  } finally {
    // Clean up temp files
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function extractLockPairs(hits: LogHit[]): LogHit[] {
  return hits.filter((h) =>
    h.seed === 'lock granted' || h.seed === 'lock released' ||
    h.seed === 'LockWithTimeout' || h.seed === 'progress indicator has timed out'
  );
}

function groupByCategory(hits: LogHit[]): Record<string, LogHit[]> {
  const groups: Record<string, LogHit[]> = { error: [], warning: [], lock: [], ops: [], other: [] };
  for (const h of hits) {
    groups[h.category].push(h);
  }
  // Cap each group to 30 lines for display
  for (const k of Object.keys(groups)) {
    groups[k] = groups[k].slice(0, 30);
  }
  return groups;
}

function summariseBySeeds(hits: LogHit[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const h of hits) {
    counts[h.seed] = (counts[h.seed] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([, a], [, b]) => b - a)
  );
}

interface CodeSuggestion {
  title: string;
  severity: 'critical' | 'high' | 'medium';
  observation: string;
  codeDirection: string;
  repo: string;
  searchTerms: string[];
}

function buildSuggestions(hits: LogHit[]): CodeSuggestion[] {
  const suggestions: CodeSuggestion[] = [];
  const counts = summariseBySeeds(hits);

  // progress indicator timed out → client-side overlay bug (Pattern #3)
  if (counts['progress indicator has timed out']) {
    suggestions.push({
      title: 'Client-side overlay/spinner left stuck',
      severity: 'critical',
      observation: `"progress indicator has timed out" found ${counts['progress indicator has timed out']}× — client gave up waiting while server was still processing.`,
      codeDirection: 'The overlay/spinner dismissal is tied to a server response that the client never received. Look for the spinner/overlay lifecycle: where it is set visible and where it is cleared. The clear path must handle the timeout case.',
      repo: 'allscriptshealthcare/SunriseMobile',
      searchTerms: ['overlay', 'spinner', 'progressIndicator', 'HideProgressIndicator', 'ShowProgressIndicator'],
    });
  }

  // High lock contention
  if ((counts['LockWithTimeout'] ?? 0) > 100) {
    suggestions.push({
      title: `SCMLib lock contention (${counts['LockWithTimeout']}× LockWithTimeout)`,
      severity: 'high',
      observation: `${counts['LockWithTimeout']} LockWithTimeout events — workers are queuing heavily. This is the IIS web-garden bottleneck described in the analysis playbook.`,
      codeDirection: 'Increase IIS app pool Maximum Worker Processes (e.g. 4 → 6). The SCMLibServiceManager lock is a known contention point; more workers reduce queue depth. Validated fix on similar DAs (DA 9358329 → Defect 9377813).',
      repo: 'allscriptshealthcare/sunrise-mobilewebservices',
      searchTerms: ['LockWithTimeout', 'SCMLibServiceManager', 'maxWorkerProcesses'],
    });
  }

  // LogTraceInfo client timeouts
  if ((counts['LogTraceInfo'] ?? 0) > 100) {
    suggestions.push({
      title: `High client timeout rate (${counts['LogTraceInfo']}× LogTraceInfo)`,
      severity: 'high',
      observation: `${counts['LogTraceInfo']} LogTraceInfo entries — these are anonymous client-side traces showing the mobile app logged errors/timeouts. Cannot tie to specific user (anonymization per Spike 9375402).`,
      codeDirection: 'Correlate LogTraceInfo timestamps with server-side op durations. If server ops complete in < client timeout threshold, the bug is in the client timeout/retry logic. Check HWS RecycleClient and connection backoff settings.',
      repo: 'allscriptshealthcare/sunrise-mobilewebservices',
      searchTerms: ['LogTraceInfo', 'RecycleClient', 'ClientTimeout'],
    });
  }

  // Raw errors in log
  if ((counts['ERROR'] ?? 0) > 0 || (counts['FATAL'] ?? 0) > 0) {
    const total = (counts['ERROR'] ?? 0) + (counts['FATAL'] ?? 0);
    suggestions.push({
      title: `${total} ERROR/FATAL entries in logs`,
      severity: total > 50 ? 'critical' : 'high',
      observation: `${counts['ERROR'] ?? 0} ERROR + ${counts['FATAL'] ?? 0} FATAL lines. Review the key log lines section for exact error messages — these are the primary diagnostic signals.`,
      codeDirection: 'Find the first ERROR/FATAL in the incident window and trace back the call stack. Match against known exception types (SqlException → DB, UnauthorizedException → auth, NullReferenceException → data model).',
      repo: 'allscriptshealthcare/sunrise-mobilewebservices',
      searchTerms: ['ERROR', 'FATAL', 'Exception', 'catch'],
    });
  }

  // App pool recycle
  if (counts['Application_Start']) {
    suggestions.push({
      title: 'App pool recycle during incident window',
      severity: 'medium',
      observation: `Application_Start found — app pool recycled during the log window. A cold-start stall right after recycle can cause slow responses (Pattern #5).`,
      codeDirection: 'Enable IIS warmup: set startMode=AlwaysRunning + preloadEnabled=true + applicationInitialization warmup URL. This prevents cold-start stalls from affecting active med-pass users.',
      repo: 'allscriptshealthcare/sunrise-mobilewebservices',
      searchTerms: ['Application_Start', 'preloadEnabled', 'startMode', 'LoadAzureAppConfigKeyVaultSecrets'],
    });
  }

  return suggestions;
}
