import { Router, Request, Response } from 'express';
import https from 'https';
import http from 'http';
import { execPowerShell } from '../utils/powershell';
import { readMcpSecrets } from '../utils/mcp-secrets';

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

interface FollowUpRequest extends AnalysisRequest {
  question: string;
  history?: Array<{ question: string; answer: string }>;
  priorAssessment?: string;
  priorVerdict?: string;
  priorConfidence?: string;
  priorGap?: string;
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

function buildFollowUpPrompt(req: FollowUpRequest): string {
  const prior = [
    req.priorVerdict ? `Prior verdict: ${req.priorVerdict}` : '',
    req.priorConfidence ? `Prior confidence: ${req.priorConfidence}` : '',
    req.priorAssessment ? `Prior assessment:\n${req.priorAssessment.slice(0, 2000)}` : '',
    req.priorGap ? `Prior gap:\n${req.priorGap.slice(0, 1500)}` : '',
  ].filter(Boolean).join('\n\n');

  const history = (req.history ?? []).slice(-8).map((entry, idx) => `Previous turn ${idx + 1}:\nQ: ${entry.question}\nA: ${entry.answer.slice(0, 1200)}`).join('\n\n');

  return `User follow-up question: ${req.question}\n\nUse the prior assessment and evidence as your starting point. Answer directly and stay anchored to the facts.\n\nPrior context:\n${prior || 'No prior assessment was supplied.'}\n\nConversation history:\n${history || 'No prior follow-up history exists yet.'}\n\n## DA ${req.da.id} — ${req.da.title}\nArea: ${req.da.areaPath}\nCustomer: ${req.da.customer}\nRelease: ${req.da.release}\nSeverity: ${req.da.severity}\n${req.da.description ? `Description:\n${req.da.description.slice(0, 800)}` : ''}\n\n## SNOW Task\n${req.snowTask?.number ?? 'not available'}\nState: ${req.snowTask?.state ?? '—'}\nShort description: ${req.snowTask?.shortDescription ?? '—'}\n${req.snowTask?.workNotes ? `Work notes excerpt:\n${req.snowTask.workNotes.slice(0, 600)}` : ''}\n\n## Key signals\n${Object.entries(req.topSeeds).map(([s,c]) => `- ${s}: ${c}x`).join('\n') || 'No signal summary available'}\n\n## Log evidence\n${req.logHits.slice(0, 20).map((h) => `[${h.file}:${h.line}] (${h.seed}) ${h.text}`).join('\n') || 'No log evidence available'}\n\nAnswer the user's question using the above context and be explicit about missing evidence if needed.`;
}

function normalizeAiProviderError(message: string): string {
  const text = String(message ?? '').trim();
  if (!text) return 'AI request failed. Use the VS Code/GitHub-managed model route or add a GitHub PAT in Settings. Local Ollama/OpenAI are fallback-only options.';

  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|timed out|network|fetch failed|getaddrinfo/i.test(text)) {
    return 'The configured AI provider is unreachable from this environment. Use the VS Code/GitHub-managed model route or add a GitHub PAT in Settings. Local Ollama/OpenAI are fallback-only options.';
  }

  if (/GitHub Models/i.test(text)) {
    return 'GitHub Models is unavailable from this environment. Use the VS Code/GitHub-managed model route or add a GitHub PAT in Settings. Local Ollama/OpenAI are fallback-only options.';
  }

  return text;
}

function getGitHubModelToken(body: { githubPat?: string }, bridgeSecrets: ReturnType<typeof readMcpSecrets>) {
  return (body.githubPat || bridgeSecrets.githubPat || '').trim();
}

function getOpenAiKey(body: { openaiKey?: string }) {
  return (body.openaiKey || '').trim();
}

/** Call GitHub Models API directly from Node.js — avoids brittle PowerShell parsing and noisy stderr output */
function callGitHubModels(pat: string, messages: object[]): Promise<string> {
  const payload = JSON.stringify({ model: MODEL_GH, messages, temperature: 0.1, max_tokens: 1200 });

  return new Promise((resolve, reject) => {
    const req = https.request(
      MODELS_API_URL,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pat}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 90_000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            try {
              const json = JSON.parse(data || '{}');
              const message = json?.error?.message ?? json?.error ?? (data.slice(0, 400) || 'empty response');
              return reject(new Error(`GitHub Models error (${res.statusCode}): ${message}`));
            } catch {
              return reject(new Error(`GitHub Models error (${res.statusCode}): ${data.slice(0, 400) || 'empty response'}`));
            }
          }

          try {
            const parsed = JSON.parse(data || '{}');
            if (parsed.error) {
              return reject(new Error(String(parsed.error.message ?? parsed.error)));
            }

            const content = parsed.choices?.[0]?.message?.content;
            if (typeof content === 'string' && content.trim()) {
              return resolve(content);
            }

            return reject(new Error(`GitHub Models returned no usable content. Response: ${data.slice(0, 400) || 'empty response'}`));
          } catch {
            const match = data.match(/\{[\s\S]*\}/);
            if (match) {
              try {
                const parsed = JSON.parse(match[0]);
                const content = parsed.choices?.[0]?.message?.content;
                if (typeof content === 'string' && content.trim()) {
                  return resolve(content);
                }
              } catch {
                // fall through to the final error message below
              }
            }

            reject(new Error(`GitHub Models returned an unexpected response: ${data.slice(0, 400) || 'empty response'}`));
          }
        });
      }
    );

    req.on('error', (e) => reject(new Error(`GitHub Models request failed: ${e.message}`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('GitHub Models request timed out'));
    });

    req.write(payload);
    req.end();
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
    const bridgeSecrets = readMcpSecrets();
    const githubToken = getGitHubModelToken(body, bridgeSecrets);
    const openaiKey = getOpenAiKey(body);
    const ollamaUp = await isOllamaRunning();

    if (githubToken) {
      assessment = await callGitHubModels(githubToken, messages);
      source = 'github-models';
    } else if (openaiKey) {
      assessment = await callOpenAI(openaiKey, messages);
      source = 'openai';
    } else if (ollamaUp) {
      assessment = await callOllama(messages);
      source = 'ollama';
    } else {
      return res.status(503).json({
        error: 'No AI backend is available. Preferred path: use the VS Code/GitHub-managed model route or add a GitHub PAT in Settings. Local Ollama/OpenAI remain fallback options.',
      });
    }

    return res.json({ assessment, source });
  } catch (err: any) {
    return res.status(502).json({ error: normalizeAiProviderError(err.message) });
  }
});

// Follow-up route: continues the same investigation using the previous assessment and evidence
aiAnalysisRouter.post('/continue', async (req: Request, res: Response) => {
  const body = req.body as FollowUpRequest;
  if (!body.question || !body.question.trim()) {
    return res.status(400).json({ error: 'Question is required.' });
  }

  const messages = [
    {
      role: 'system',
      content: 'You are continuing a DevAssist investigation for the same work item. Use the prior assessment, evidence, and user question. Answer directly, stay grounded in facts, and clearly state uncertainty or missing evidence when needed.',
    },
    { role: 'user', content: buildFollowUpPrompt(body) },
  ];

  try {
    const bridgeSecrets = readMcpSecrets();
    const githubToken = getGitHubModelToken(body, bridgeSecrets);
    const openaiKey = getOpenAiKey(body);
    const ollamaUp = await isOllamaRunning();

    let assessment: string;
    let source: string;

    if (githubToken) {
      assessment = await callGitHubModels(githubToken, messages);
      source = 'github-models';
    } else if (openaiKey) {
      assessment = await callOpenAI(openaiKey, messages);
      source = 'openai';
    } else if (ollamaUp) {
      assessment = await callOllama(messages);
      source = 'ollama';
    } else {
      return res.status(503).json({
        error: 'No AI backend is available for follow-up. Preferred path: use the VS Code/GitHub-managed model route or add a GitHub PAT in Settings. Local Ollama/OpenAI remain fallback options.',
      });
    }

    return res.json({ assessment, source });
  } catch (err: any) {
    return res.status(502).json({ error: normalizeAiProviderError(err.message) });
  }
});
