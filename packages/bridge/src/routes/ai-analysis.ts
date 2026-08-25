import { Router, Request, Response } from 'express';
import https from 'https';
import http from 'http';
import { execPowerShell } from '../utils/powershell';

export const aiAnalysisRouter = Router();

const MODELS_API_URL = 'https://models.inference.ai.azure.com/chat/completions';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OLLAMA_API_URL = 'http://localhost:11434/api/chat';  // local, no auth needed
const MODEL_GH    = 'gpt-4o-mini';
const MODEL_OAPI  = 'gpt-4o-mini';
const MODEL_OLLAMA = 'llama3.2';  // change to any model you have pulled

interface AnalysisRequest {
  githubPat?: string;
  openaiKey?: string;   // user's personal OpenAI API key
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
  fs.writeFileSync(bodyFile, JSON.stringify({ model: MODEL_GH, messages, temperature: 0.1, max_tokens: 1200 }), 'utf-8');

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

/** Call Ollama local LLM — no auth, no internet, runs at localhost:11434 */
function callOllama(messages: object[], model = MODEL_OLLAMA): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({ model, messages, stream: false }));
    const req = http.request(
      OLLAMA_API_URL,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }, timeout: 120_000 },
      (res) => {
        let data = '';
        res.on('data', (c: Buffer) => { data += c.toString(); });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error));
            resolve(json.message?.content ?? json.response ?? '(no response)');
          } catch {
            reject(new Error(`Ollama parse error: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', (e) => reject(new Error(`Ollama not running — install from ollama.com: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Ollama timed out (model may be loading, try again)')); });
    req.write(body);
    req.end();
  });
}

/** Probe whether Ollama is running locally */
async function isOllamaRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:11434/', { timeout: 1000 }, () => resolve(true));
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/** Call OpenAI directly from Node.js — no PowerShell needed */
function callOpenAI(apiKey: string, messages: object[], model = MODEL_OAPI): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 1500 }));
    const req = https.request(
      OPENAI_API_URL,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': body.length,
        },
        timeout: 60_000,
      },
      (res) => {
        let data = '';
        res.on('data', (c: Buffer) => { data += c.toString(); });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error.message ?? JSON.stringify(json.error)));
            resolve(json.choices?.[0]?.message?.content ?? '(no response)');
          } catch {
            reject(new Error(`OpenAI response parse error: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', (e) => reject(new Error(`OpenAI request failed: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('OpenAI request timed out')); });
    req.write(body);
    req.end();
  });
}

// GET /api/ai-status — tells the SPA which AI backends are reachable
aiAnalysisRouter.get('/status', async (_req: Request, res: Response) => {
  const ollama = await isOllamaRunning();
  const models = ollama
    ? await new Promise<string[]>((resolve) => {
        const r = http.get('http://localhost:11434/api/tags', { timeout: 2000 }, (resp) => {
          let d = ''; resp.on('data', (c: Buffer) => { d += c; }); resp.on('end', () => {
            try { resolve((JSON.parse(d).models ?? []).map((m: {name:string}) => m.name)); }
            catch { resolve([]); }
          });
        });
        r.on('error', () => resolve([]));
      })
    : [];
  res.json({ ollama, ollamaModels: models });
});

// POST /api/ai-analyze — auto-selects: Ollama (local) → OpenAI → GitHub Models
aiAnalysisRouter.post('/', async (req: Request, res: Response) => {
  const body = req.body as AnalysisRequest;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: buildUserPrompt(body) },
  ];

  try {
    let assessment: string;
    let source: string;

    const ollamaUp = await isOllamaRunning();
    if (ollamaUp) {
      // Prefer local Ollama — no internet, no auth, no firewall
      assessment = await callOllama(messages);
      source = 'ollama';
    } else if (body.openaiKey) {
      assessment = await callOpenAI(body.openaiKey, messages);
      source = 'openai';
    } else if (body.githubPat) {
      assessment = await callGitHubModels(body.githubPat, messages);
      source = 'github-models';
    } else {
      return res.status(503).json({
        error: 'No AI available. Options:\n1. Install Ollama (free, local): ollama.com → run "ollama pull llama3.2"\n2. Add OpenAI API key in Settings\n3. Ensure GitHub PAT has Models access',
      });
    }

    return res.json({ assessment, source });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});
