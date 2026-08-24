import { Router, Request, Response } from 'express';
import { execPowerShell } from '../utils/powershell';
import fs from 'fs';
import path from 'path';
import os from 'os';

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

const MAX_PLAIN_BYTES  = 50 * 1024 * 1024;  // 50 MB — read whole file
const MAX_CHUNK_BYTES  = 200 * 1024 * 1024; // 200 MB — read last N lines
const TAIL_LINES       = 5000;               // lines to tail on very large files
const MAX_SKIP_BYTES   = 500 * 1024 * 1024; // 500 MB — truly skip

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

function val(f: unknown): string {
  if (!f) return '';
  if (typeof f === 'string') return f;
  if (typeof f === 'object' && 'value' in (f as object)) return (f as any).value ?? '';
  return String(f);
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

    const logFiles = attachments.filter((a) => {
      const name = val(a.file_name).toLowerCase();
      return name.endsWith('.log') || name.endsWith('.txt') || name.endsWith('.zip');
    });

    const allHits: LogHit[] = [];
    const analyzed: string[] = [];
    const skipped: string[] = [];

    for (const att of logFiles) {
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
          const extracted = fs.readdirSync(extractDir);
          for (const inner of extracted) {
            if (inner.toLowerCase().endsWith('.log') || inner.toLowerCase().endsWith('.txt')) {
              const innerPath = path.join(extractDir, inner);
              const innerStat = fs.statSync(innerPath);
              let content: string;
              let note = '';
              if (innerStat.size > MAX_SKIP_BYTES) {
                skipped.push(`${fileName}/${inner} (too large: ${Math.round(innerStat.size / 1024 / 1024)}MB)`);
                continue;
              } else if (innerStat.size > MAX_PLAIN_BYTES) {
                content = readTail(innerPath, TAIL_LINES);
                note = ` [last ${TAIL_LINES} lines of ${Math.round(innerStat.size / 1024 / 1024)}MB]`;
              } else {
                content = fs.readFileSync(innerPath, 'utf-8');
              }
              const hits = parseHwsLog(content, `${fileName}/${inner}`);
              allHits.push(...hits);
              analyzed.push(`${fileName}/${inner}${note} (${hits.length} hits)`);
            }
          }
        } else {
          let content: string;
          let note = '';
          const rawStat = fs.statSync(outPath);
          if (rawStat.size > MAX_PLAIN_BYTES) {
            content = readTail(outPath, TAIL_LINES);
            note = ` [last ${TAIL_LINES} lines of ${Math.round(rawStat.size / 1024 / 1024)}MB]`;
          } else {
            content = fs.readFileSync(outPath, 'utf-8');
          }
          const hits = parseHwsLog(content, fileName);
          allHits.push(...hits);
          analyzed.push(`${fileName}${note} (${hits.length} hits)`);
        }
      } catch (e: any) {
        skipped.push(`${fileName} (${e.message.slice(0, 80)})`);
      }
    }

    // Build op-duration summary from lock granted/released pairs (per analysis-playbook.md tooling)
    const lockPairs = extractLockPairs(allHits);
    const byCategory = groupByCategory(allHits);
    const suggestions = buildSuggestions(allHits);

    return res.json({
      analyzed,
      skipped,
      totalHits: allHits.length,
      hits: allHits.slice(0, 100), // cap display at 100
      byCategory,
      lockPairs: lockPairs.slice(0, 20),
      topSeeds: summariseBySeeds(allHits),
      suggestions,
    });

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
