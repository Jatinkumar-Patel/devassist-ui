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
];

interface LogHit {
  file: string;
  line: number;
  text: string;
  seed: string;
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
        hits.push({ file: fileName, line: i + 1, text: line.trim().slice(0, 300), seed });
        break; // one hit per line
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
        // Download via PS
        await execPowerShell(
          `Invoke-WebRequest -Uri '${SNOW_BASE}/GetAttachment/?sysid=${sysId}' ` +
          `-UseDefaultCredentials -UseBasicParsing -OutFile '${outPath}'`
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

    return res.json({
      analyzed,
      skipped,
      totalHits: allHits.length,
      hits: allHits.slice(0, 100), // cap display at 100
      lockPairs: lockPairs.slice(0, 20),
      topSeeds: summariseBySeeds(allHits),
    });

  } finally {
    // Clean up temp files
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function extractLockPairs(hits: LogHit[]): Array<{ file: string; line: number; seed: string; text: string }> {
  return hits.filter((h) =>
    h.seed === 'lock granted' || h.seed === 'lock released' ||
    h.seed === 'LockWithTimeout' || h.seed === 'progress indicator has timed out'
  );
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
