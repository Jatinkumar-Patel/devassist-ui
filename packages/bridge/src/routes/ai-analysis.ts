import { Router, Request, Response } from 'express';
import https from 'https';

export const aiAnalysisRouter = Router();

// GitHub Copilot Chat API — works on corp network with standard GitHub PAT
const GH_MODELS_URL = 'https://api.githubcopilot.com/chat/completions';
const MODEL = 'gpt-4o';

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

function callGitHubModels(pat: string, messages: object[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: MODEL, messages, temperature: 0.1, max_tokens: 1200 });

    const req = https.request(
      GH_MODELS_URL,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pat}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode === 401) return reject(new Error('GitHub PAT rejected — ensure it has access to github.com/marketplace/models'));
          if (res.statusCode === 429) return reject(new Error('Rate limited by GitHub Models API — try again in a moment'));
          if ((res.statusCode ?? 0) >= 400) return reject(new Error(`GitHub Models API ${res.statusCode}: ${data.slice(0, 200)}`));
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.choices?.[0]?.message?.content ?? '(no response)');
          } catch {
            reject(new Error('Invalid JSON from GitHub Models API'));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
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
