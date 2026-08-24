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

      // Skip very large files (> 5 MB) to avoid timeout
      if (sizeBytes > 5 * 1024 * 1024) {
        skipped.push(`${fileName} (too large: ${Math.round(sizeBytes / 1024)}KB)`);
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
              if (innerStat.size > 10 * 1024 * 1024) {
                skipped.push(`${fileName}/${inner} (too large)`);
                continue;
              }
              const content = fs.readFileSync(innerPath, 'utf-8');
              const hits = parseHwsLog(content, `${fileName}/${inner}`);
              allHits.push(...hits);
              analyzed.push(`${fileName}/${inner} (${hits.length} hits)`);
            }
          }
        } else {
          const content = fs.readFileSync(outPath, 'utf-8');
          const hits = parseHwsLog(content, fileName);
          allHits.push(...hits);
          analyzed.push(`${fileName} (${hits.length} hits)`);
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
