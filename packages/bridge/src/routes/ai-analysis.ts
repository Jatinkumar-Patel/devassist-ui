import { Router, Request, Response } from 'express';
import https from 'https';
import http from 'http';
import { execPowerShell } from '../utils/powershell';
import { readMcpSecrets } from '../utils/mcp-secrets';

export const aiAnalysisRouter = Router();

const MODELS_API_URLS = [
  'https://api.githubcopilot.com/chat/completions',
  'https://models.inference.ai.azure.com/chat/completions',
  'https://models.github.ai/inference/chat/completions',
] as const;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OLLAMA_API_URL = 'http://localhost:11434/api/chat';  // local, no auth needed
const MODEL_GH    = 'gpt-4o-mini';
const MODEL_OAPI  = 'gpt-4o-mini';
const MODEL_OLLAMA = 'llama3.2';  // change to any model you have pulled

interface AnalysisRequest {
  githubPat?: string;
  openaiKey?: string;   // user's personal OpenAI API key
  aiProvider?: 'auto' | 'github-models' | 'openai' | 'ollama';
  aiModel?: string;
  aiAgent?: AiAgentSelection;
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

type ProviderSelection = 'auto' | 'github-models' | 'openai' | 'ollama';
type AiAgentSelection = 'triage-l2' | 'root-cause' | 'log-forensics' | 'l2-commentary';

const AGENT_MODE_CATALOG: Array<{ id: AiAgentSelection; label: string; description: string }> = [
  { id: 'triage-l2', label: 'L2 Triage Agent', description: 'Balanced triage with verdict, confidence, and next step.' },
  { id: 'root-cause', label: 'Root Cause Agent', description: 'Prioritizes causality chain and failure path isolation.' },
  { id: 'log-forensics', label: 'Log Forensics Agent', description: 'Prioritizes stack traces, timelines, and repeated signatures.' },
  { id: 'l2-commentary', label: 'L2 Commentary Agent', description: 'Generates concise stakeholder-ready L2 summary text.' },
];

const MODEL_CATALOG: Record<'github-models' | 'openai', string[]> = {
  'github-models': ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1'],
  openai: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1'],
};

// System prompt built from references/reasoning-framework.md
const BASE_SYSTEM_PROMPT = `You are a Sunrise product support engineer performing Level-2 triage on a DevAssist work item.
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

function requestedAgent(value: unknown): AiAgentSelection {
  const normalized = String(value ?? 'triage-l2').trim().toLowerCase();
  if (normalized === 'root-cause') return 'root-cause';
  if (normalized === 'log-forensics') return 'log-forensics';
  if (normalized === 'l2-commentary') return 'l2-commentary';
  return 'triage-l2';
}

function buildSystemPromptForAgent(agent: AiAgentSelection): string {
  if (agent === 'root-cause') {
    return `${BASE_SYSTEM_PROMPT}\n\nAgent mode: Root Cause Agent\nPriority:\n- Build explicit observed -> component -> cause chain.\n- Separate trigger, failure mechanism, and user-visible impact.\n- Prefer one strongest hypothesis and two falsification checks.`;
  }
  if (agent === 'log-forensics') {
    return `${BASE_SYSTEM_PROMPT}\n\nAgent mode: Log Forensics Agent\nPriority:\n- Weight stack traces, repeated signatures, and timeline delays over narrative assumptions.\n- Quote exact seed names and exception signatures.\n- Call out missing timestamps, correlation IDs, or window gaps explicitly.`;
  }
  if (agent === 'l2-commentary') {
    return `${BASE_SYSTEM_PROMPT}\n\nAgent mode: L2 Commentary Agent\nPriority:\n- Produce concise stakeholder-ready language with evidence-backed statements only.\n- Always include observed vs expected and one owner-ready next action.\n- Avoid generic filler (e.g., "insufficient evidence") when any concrete signal exists.`;
  }
  return `${BASE_SYSTEM_PROMPT}\n\nAgent mode: L2 Triage Agent\nPriority:\n- Balanced technical triage with clear verdict, confidence, blind spots, and next step.`;
}

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

function shouldUseLocalFallback(message: string): boolean {
  const text = String(message ?? '').toLowerCase();
  return /unreachable|unavailable|no ai backend|selected provider|timed out|econn|enotfound|eai_again|network|github models/.test(text);
}

function heuristicVerdict(topSeeds: Record<string, number>): 'CODE BUG' | 'CONFIG / INSTALL' | 'NEED MORE INFO' {
  const deadlock = (topSeeds['Deadlock'] ?? 0) + (topSeeds['deadlock victim'] ?? 0);
  const auth = (topSeeds['Authentication failed'] ?? 0) + (topSeeds['Login failed'] ?? 0) + (topSeeds['UnauthorizedAccessException'] ?? 0);
  const runtime = (topSeeds['ERROR'] ?? 0) + (topSeeds['FATAL'] ?? 0) + (topSeeds['Exception'] ?? 0) + (topSeeds['NullReferenceException'] ?? 0);

  if (deadlock > 0 || runtime > 0) return 'CODE BUG';
  if (auth > 0) return 'CONFIG / INSTALL';
  return 'NEED MORE INFO';
}

function buildHeuristicAssessment(req: AnalysisRequest, fallbackReason: string): string {
  const verdict = heuristicVerdict(req.topSeeds ?? {});
  const topSignals = Object.entries(req.topSeeds ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([seed, count]) => `${seed} (${count}x)`);
  const evidence = req.logHits.slice(0, 5).map((hit) => `[${hit.file}:${hit.line}] (${hit.seed}) ${hit.text}`);

  return [
    `Assessment: ${verdict}`,
    `Client reported: ${req.da.title}`,
    '',
    'SNOW evidence:',
    `  - ${req.snowTask?.shortDescription || 'No SNOW short description provided.'}`,
    `  - ${req.snowTask?.state ? `Current state: ${req.snowTask.state}` : 'State not provided.'}`,
    '',
    'Log analysis:',
    `  - Top signals: ${topSignals.length ? topSignals.join(', ') : 'none'}`,
    `  - Evidence lines: ${evidence.length ? 'captured' : 'none captured'}`,
    '',
    'Code analysis:',
    `  - Direction: ${req.repos.length ? req.repos.join(', ') : 'Mapped repos unavailable'}`,
    '  - Observed vs expected: Use top signal and first failing call path to validate behavior against product contract.',
    '',
    `Gap: External AI provider was unavailable (${fallbackReason}). Deterministic triage used local evidence only; verify with additional incident-window logs to raise confidence.`,
    `Confidence: ${evidence.length || topSignals.length ? 'Medium' : 'Low'} — based on deterministic seed and evidence extraction without external LLM synthesis.`,
    '',
    'Blind spots / to raise confidence:',
    '  - Attach exact incident-window logs with timestamps and correlation IDs.',
    '  - Confirm environment/build and whether issue is user-specific or environment-wide.',
    '',
    'Recommended next step: Run focused log and DB validation using the SQL and metadata tools, then re-run AI summary when provider connectivity is restored.',
  ].join('\n');
}

function buildHeuristicFollowUp(req: FollowUpRequest, fallbackReason: string): string {
  const question = req.question.trim();
  const lower = question.toLowerCase();
  const signals = Object.entries(req.topSeeds ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (/next|what should i do|action|validate/.test(lower)) {
    return [
      `External AI provider unavailable (${fallbackReason}). Deterministic follow-up response:`,
      `1) Validate top signal path first: ${signals[0] ? `${signals[0][0]} (${signals[0][1]}x)` : 'No dominant signal yet'}.`,
      '2) Use SQL metadata explorer to confirm object mapping (tables/views/SP) tied to failing workflow.',
      '3) Run a read-only SQL query for recent rows correlated to incident time window.',
      '4) Re-run log analysis after adding missing attachments/screenshots.',
    ].join('\n');
  }

  if (/why|root cause|reason/.test(lower)) {
    return [
      `External AI provider unavailable (${fallbackReason}). Deterministic root-cause guidance:`,
      `Most likely direction is based on seeds: ${signals.map(([s, c]) => `${s} (${c}x)`).join(', ') || 'none'}.`,
      'This is evidence-weighted guidance, not a final root-cause confirmation. Confirm with incident-window logs and DB correlation.',
    ].join('\n');
  }

  return [
    `External AI provider unavailable (${fallbackReason}).`,
    `Question received: ${question}`,
    'Deterministic response mode is active. Continue using follow-up prompts; responses will stay evidence-based from DA/SNOW/log context.',
  ].join('\n');
}

function getGitHubModelToken(body: { githubPat?: string }, bridgeSecrets: ReturnType<typeof readMcpSecrets>) {
  return (body.githubPat || bridgeSecrets.githubPat || '').trim();
}

function getOpenAiKey(body: { openaiKey?: string }) {
  return (body.openaiKey || process.env.OPENAI_API_KEY || '').trim();
}

/** Call GitHub Models API directly from Node.js — avoids brittle PowerShell parsing and noisy stderr output */
function callGitHubModelsAtEndpoint(endpoint: string, pat: string, messages: object[], model = MODEL_GH): Promise<string> {
  const payload = JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 1200 });

  return new Promise((resolve, reject) => {
    const req = https.request(
      endpoint,
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
              return reject(new Error(`GitHub Models error (${res.statusCode}) [${endpoint}]: ${message}`));
            } catch {
              return reject(new Error(`GitHub Models error (${res.statusCode}) [${endpoint}]: ${data.slice(0, 400) || 'empty response'}`));
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

            return reject(new Error(`GitHub Models returned no usable content [${endpoint}]. Response: ${data.slice(0, 400) || 'empty response'}`));
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

            reject(new Error(`GitHub Models returned an unexpected response [${endpoint}]: ${data.slice(0, 400) || 'empty response'}`));
          }
        });
      }
    );

    req.on('error', (e) => reject(new Error(`GitHub Models request failed [${endpoint}]: ${e.message}`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`GitHub Models request timed out [${endpoint}]`));
    });

    req.write(payload);
    req.end();
  });
}

function shouldTryAlternateGitHubEndpoint(errorMessage: string): boolean {
  const text = String(errorMessage ?? '').toLowerCase();
  return (
    /enotfound|eai_again|econnrefused|econnreset|timed out|getaddrinfo|network/.test(text) ||
    /error \(404\)|error \(408\)|error \(429\)|error \(500\)|error \(502\)|error \(503\)|error \(504\)/.test(text)
  );
}

async function callGitHubModels(pat: string, messages: object[], model = MODEL_GH): Promise<string> {
  const errors: string[] = [];

  for (let i = 0; i < MODELS_API_URLS.length; i++) {
    const endpoint = MODELS_API_URLS[i];
    try {
      return await callGitHubModelsAtEndpoint(endpoint, pat, messages, model);
    } catch (error: any) {
      const message = String(error?.message ?? error ?? 'GitHub Models request failed');
      errors.push(message);

      if (i === MODELS_API_URLS.length - 1) break;
      if (!shouldTryAlternateGitHubEndpoint(message)) break;
    }
  }

  throw new Error(errors.join(' | '));
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
  const bridgeSecrets = readMcpSecrets();
  const githubReady = Boolean(process.env.GITHUB_PERSONAL_ACCESS_TOKEN?.trim() || bridgeSecrets.githubPat);
  const openaiReady = Boolean(process.env.OPENAI_API_KEY?.trim());
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

  res.json({
    ollama,
    ollamaModels: models,
    modelCatalog: {
      'github-models': MODEL_CATALOG['github-models'],
      openai: MODEL_CATALOG.openai,
      ollama: models,
    },
    agentModes: AGENT_MODE_CATALOG,
    defaultModels: {
      'github-models': MODEL_GH,
      openai: MODEL_OAPI,
      ollama: MODEL_OLLAMA,
    },
    githubReady,
    openaiReady,
    anyBackendReady: ollama || githubReady || openaiReady,
  });
});

function requestedProvider(value: unknown): ProviderSelection {
  const normalized = String(value ?? 'github-models').trim().toLowerCase();
  if (normalized === 'github-models' || normalized === 'openai' || normalized === 'ollama') return normalized;
  return 'github-models';
}

function providerAttemptOrder(selection: ProviderSelection): Array<'github-models' | 'openai' | 'ollama'> {
  if (selection === 'github-models') return ['github-models'];
  if (selection === 'openai') return ['openai'];
  if (selection === 'ollama') return ['ollama'];
  return ['github-models', 'openai', 'ollama'];
}

async function runAiProviderSelection(
  body: AnalysisRequest,
  messages: object[]
): Promise<{ assessment: string; source: string }> {
  const bridgeSecrets = readMcpSecrets();
  const githubToken = getGitHubModelToken(body, bridgeSecrets);
  const openaiKey = getOpenAiKey(body);
  const ollamaUp = await isOllamaRunning();
  const provider = requestedProvider(body.aiProvider);
  const desiredModel = (body.aiModel ?? '').trim();

  for (const candidate of providerAttemptOrder(provider)) {
    if (candidate === 'github-models') {
      if (!githubToken) continue;
      const assessment = await callGitHubModels(githubToken, messages, desiredModel || MODEL_GH);
      return { assessment, source: 'github-models' };
    }
    if (candidate === 'openai') {
      if (!openaiKey) continue;
      const assessment = await callOpenAI(openaiKey, messages, desiredModel || MODEL_OAPI);
      return { assessment, source: 'openai' };
    }
    if (candidate === 'ollama') {
      if (!ollamaUp) continue;
      const assessment = await callOllama(messages, desiredModel || MODEL_OLLAMA);
      return { assessment, source: 'ollama' };
    }
  }

  if (provider !== 'auto') {
    throw new Error(`Selected provider '${provider}' is not available. Choose Auto or configure credentials/runtime for that provider.`);
  }

  throw new Error('No AI backend is available. Configure one backend: GitHub PAT (Settings), OpenAI key (Settings), or local Ollama on localhost:11434.');
}

// POST /api/ai-analyze — auto-selects: Ollama (local) → OpenAI → GitHub Models
aiAnalysisRouter.post('/', async (req: Request, res: Response) => {
  const body = req.body as AnalysisRequest;
  const agent = requestedAgent(body.aiAgent);

  const messages = [
    { role: 'system', content: buildSystemPromptForAgent(agent) },
    { role: 'user',   content: buildUserPrompt(body) },
  ];

  try {
    const { assessment, source } = await runAiProviderSelection(body, messages);
    return res.json({ assessment, source });
  } catch (err: any) {
    const normalized = normalizeAiProviderError(err.message);
    if (shouldUseLocalFallback(normalized)) {
      return res.json({
        assessment: buildHeuristicAssessment(body, normalized),
        source: 'deterministic-fallback',
        warning: normalized,
      });
    }
    const status = /No AI backend is available|Selected provider/i.test(normalized) ? 503 : 502;
    return res.status(status).json({ error: normalized });
  }
});

// Follow-up route: continues the same investigation using the previous assessment and evidence
aiAnalysisRouter.post('/continue', async (req: Request, res: Response) => {
  const body = req.body as FollowUpRequest;
  if (!body.question || !body.question.trim()) {
    return res.status(400).json({ error: 'Question is required.' });
  }
  const agent = requestedAgent(body.aiAgent);

  const messages = [
    {
      role: 'system',
      content: `${buildSystemPromptForAgent(agent)}\n\nYou are continuing a DevAssist investigation for the same work item. Use the prior assessment, evidence, and user question. Answer directly, stay grounded in facts, and clearly state uncertainty or missing evidence when needed.`,
    },
    { role: 'user', content: buildFollowUpPrompt(body) },
  ];

  try {
    const { assessment, source } = await runAiProviderSelection(body, messages);
    return res.json({ assessment, source });
  } catch (err: any) {
    const normalized = normalizeAiProviderError(err.message);
    if (shouldUseLocalFallback(normalized)) {
      return res.json({
        assessment: buildHeuristicFollowUp(body, normalized),
        source: 'deterministic-fallback',
        warning: normalized,
      });
    }
    const status = /No AI backend is available|Selected provider/i.test(normalized) ? 503 : 502;
    return res.status(status).json({ error: normalized });
  }
});
