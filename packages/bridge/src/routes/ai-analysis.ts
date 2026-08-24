import { Router, Request, Response } from 'express';
import { execPowerShell } from '../utils/powershell';

export const aiAnalysisRouter = Router();

// GitHub Models API via PowerShell — Node.js DNS can't resolve it on corp network, PS can
const MODELS_API_URL = 'https://models.inference.ai.azure.com/chat/completions';
const MODEL = 'gpt-4o-mini';

interface AnalysisRequest {
  githubPat: string;
  da: {
    id: number;
    title: string;
    areaPath: string;
    customer: string;
    release: string;
    severity: string;
    description?: string;
  };
  snowTask: {
    number: string;
    shortDescription: string;
    state: string;
    workNotes?: string;
  } | null;
  logHits: Array<{ file: string; line: number; seed: string; text: string }>;
  topSeeds: Record<string, number>;
  patternName?: string;
  patternFixDirection?: string;
  repos: string[];
}

// System prompt built from references/reasoning-framework.md
const SYSTEM_PROMPT = `You are a Sunrise product support engineer performing Level-2 triage on a DevAssist work item.
Use the provided DA fields, SNOW evidence, and HWS log evidence to produce a structured assessment.

Follow this exact output format:

Assessment: <CODE BUG | CONFIG / INSTALL | INTENDED BEHAVIOR | ENHANCEMENT | NEED MORE INFO>
Client reported: <1-2 sentences restating the problem>

SNOW evidence:
  - <quote the most diagnostic work notes / log lines>

Log analysis:
  - Op: <operation name>  Duration: <computed duration if start/complete timestamps found>
  - Pattern: <what the log sequence shows>
  - Server health: <healthy/slow/erroring based on timing>

Code analysis:
  - Direction: <which repo/layer to look in>
  - Code path: <what code path is implicated>
  - Observed vs expected: <what the logs show vs what should happen>

Gap: <one paragraph — exactly what differs between what the code does and what it should>
Confidence: <High|Medium|Low> — <rationale>

Blind spots / to raise confidence:
  - <specific artifact or step that would confirm the root cause>

Recommended next step: <single most important action>

Rules:
- Never claim a confirmed fix. Facts and lines of investigation only.
- No PHI. Patient scope: all/specific/random/unknown only.
- If log timing shows server completed quickly, the hang is CLIENT-SIDE, not server.
- If LockWithTimeout appears with long hold times, focus on IIS web-garden worker count.`;

function buildUserPrompt(req: AnalysisRequest): string {
  const logSample = req.logHits
    .slice(0, 30)
    .map((h) => `  [${h.file}:${h.line}] (${h.seed}) ${h.text}`)
    .join('\n');

  const seedSummary = Object.entries(req.topSeeds)
    .map(([s, c]) => `  ${s}: ${c}×`)
    .join('\n');

  return `## DA ${req.da.id} — ${req.da.title}

Area: ${req.da.areaPath}
Customer: ${req.da.customer}
Release: ${req.da.release}
Severity: ${req.da.severity}
${req.da.description ? `\nDescription:\n${req.da.description.slice(0, 800)}` : ''}

## SNOW Task: ${req.snowTask?.number ?? 'not available'}
State: ${req.snowTask?.state ?? '—'}
Short description: ${req.snowTask?.shortDescription ?? '—'}
${req.snowTask?.workNotes ? `\nWork notes (excerpt):\n${req.snowTask.workNotes.slice(0, 600)}` : ''}

## Mapped repos
${req.repos.join(', ')}

## Pattern pre-match
${req.patternName ? `Keyword match: "${req.patternName}"` : 'No keyword pattern matched'}
${req.patternFixDirection ? `Pre-match fix direction: ${req.patternFixDirection}` : ''}

## Log signal summary
${seedSummary || 'No signals found'}

## Key log lines (up to 30)
${logSample || 'No log evidence available'}

Based on all of the above, produce the structured assessment.`;
}

/** Call GitHub Models API via PowerShell — uses Windows DNS which resolves on corp network */
function callGitHubModels(pat: string, messages: object[]): Promise<string> {
  const os = require('os');
  const fs = require('fs');
  const { exec } = require('child_process');

  const ts = Date.now();
  const bodyFile   = `${os.tmpdir()}\\devassist-body-${ts}.json`;
  const scriptFile = `${os.tmpdir()}\\devassist-ai-${ts}.ps1`;

  // Write body to temp file — avoids all PS string-escaping issues
  fs.writeFileSync(bodyFile, JSON.stringify({ model: MODEL, messages, temperature: 0.1, max_tokens: 1200 }), 'utf-8');

  // Write full PS script to a .ps1 file — run with -File so newlines are preserved
  const script = `
$body = Get-Content -Path '${bodyFile}' -Raw -Encoding UTF8
$headers = @{
    Authorization = 'Bearer ${pat}'
    'Content-Type' = 'application/json'
}
$r = Invoke-WebRequest -Uri '${MODELS_API_URL}' -Method POST -Headers $headers -Body $body -UseBasicParsing -TimeoutSec 60
$r.Content
`;
  fs.writeFileSync(scriptFile, script, 'utf-8');

  return new Promise((resolve, reject) => {
    exec(
      `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptFile}"`,
      { maxBuffer: 5 * 1024 * 1024, timeout: 90_000 },
      (err: Error | null, stdout: string, stderr: string) => {
        // Clean up temp files
        try { fs.unlinkSync(bodyFile); } catch { /* ignore */ }
        try { fs.unlinkSync(scriptFile); } catch { /* ignore */ }

        if (err) return reject(new Error(stderr || err.message));
        try {
          const data = JSON.parse(stdout.trim());
          if (data.error) return reject(new Error(String(data.error.message ?? data.error)));
          resolve(data.choices?.[0]?.message?.content ?? '(no response)');
        } catch {
          reject(new Error(`Invalid response: ${stdout.slice(0, 200)}`));
        }
      }
    );
  });
}

// POST /api/ai-analyze — call GitHub Models API with full triage context
aiAnalysisRouter.post('/', async (req: Request, res: Response) => {
  const body = req.body as AnalysisRequest;
  if (!body.githubPat) return res.status(401).json({ error: 'Missing githubPat in request body' });

  try {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(body) },
    ];
    const assessment = await callGitHubModels(body.githubPat, messages);
    return res.json({ assessment });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});
