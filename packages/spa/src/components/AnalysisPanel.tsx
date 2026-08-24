import { useState } from 'react';
import { ClipboardCopy, Code2, Loader2, CheckCircle2, AlertTriangle, HelpCircle, Wrench, Lightbulb, Sparkles } from 'lucide-react';
import type { TriageAnalysis, TriageSession } from '../types';
import { matchPattern, runCodeSearch, buildAssessment } from '../lib/analysis';
import { useSettingsStore } from '../store/settings';
import { snowVal } from '../lib/snow-client';

/** Build structured prompt â€” fetches actual skill files from bridge for the area */
async function buildAiPromptWithSkills(session: TriageSession): Promise<string> {
  const { adoItem, snowTask, product, analysis } = session;
  if (!adoItem) return '';

  const BRIDGE = (window as any).__BRIDGE_URL__ ?? 'http://localhost:7447';
  const f = adoItem.fields;
  const logHits: Array<{ seed: string; text: string }> = (snowTask as any)?._logHits ?? [];
  const topSeeds: Record<string, number> = (snowTask as any)?._topSeeds ?? {};
  const areaPath = String(f['System.AreaPath'] ?? '').toLowerCase();

  // Map area path to skill area ID
  const areaId = areaPath.includes('mobilex') ? 'sunrise-mobile'
    : areaPath.includes('shm') ? null   // SHM not in skills yet
    : areaPath.includes('compass') ? 'compass-scm'
    : areaPath.includes('clindoc') ? 'clindoc-scm'
    : null;

  // Load skill files from bridge
  let skillContext = '';
  if (areaId) {
    try {
      const r = await fetch(`${BRIDGE}/api/skills/area/${areaId}`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        const data = await r.json() as { files: Record<string, string> };
        // Include the most analysis-relevant files
        const relevant = ['analysis-playbook.md', 'logs.md', 'profile.md', 'references/reasoning-framework.md'];
        for (const key of relevant) {
          if (data.files[key]) {
            skillContext += `\n\n### Skill: ${key}\n${data.files[key].slice(0, 1500)}`;
          }
        }
      }
    } catch { /* non-fatal */ }
  }

  const evidence = `## DA ${adoItem.id} â€” ${f['System.Title']}
Area: ${f['System.AreaPath']} | Customer: ${f['Allscripts.Field.CustomerName'] ?? 'â€”'} | Release: ${f['Allscripts.Field.SupportVersion'] ?? 'â€”'} | Severity: ${f['Microsoft.VSTS.Common.Severity'] ?? 'â€”'}
${product ? `Product: ${product.displayName}` : ''}
${analysis?.verdict ? `Rule-based pre-analysis: ${analysis.verdict} (${analysis.confidence}) â€” ${analysis.gap}` : ''}

## Description
${String(f['System.Description'] ?? f['Allscripts.Field.DevAssistDetail'] ?? '').replace(/<[^>]+>/g, ' ').slice(0, 600)}

## SNOW: ${snowTask ? snowVal(snowTask.number) + ' (' + snowVal(snowTask.state) + ')' : 'not fetched'}
${snowTask ? snowVal(snowTask.short_description) : ''}

## Log signals (from HWS logs)
${Object.entries(topSeeds).map(([s, c]) => `${s}: ${c}Ã—`).join(' | ') || '(none â€” no log files attached or logs not yet scanned)'}

## Key log lines
${logHits.slice(0, 15).map(h => `[${h.seed}] ${h.text}`).join('\n') || '(none)'}`;

  return `You are a Sunrise product support engineer doing Level-2 DevAssist triage.
${skillContext ? 'Use the skill files below as your domain reference.' : ''}

Produce this structured output:
Assessment: <CODE BUG | CONFIG / INSTALL | INTENDED BEHAVIOR | ENHANCEMENT | NEED MORE INFO>
Client reported: <1-2 sentences restating the problem â€” confirm understanding>
SNOW evidence: <quote the most diagnostic log lines / work notes>
Code analysis: <file + method + the code path + observed vs expected>
Gap: <exactly what differs between what the code does and what it should>
Confidence: <High|Medium|Low> â€” <rationale â€” if Medium/Low, name what specific evidence would raise it>
Blind spots: <what artifacts are missing that limit certainty>
Recommended next step: <single most important action>

Rules: No PHI. Facts + lines of investigation only â€” no confirmed fixes. Human review before L2 post.
${skillContext}
---

${evidence}`;
}

/** Sync fallback prompt — used when skill load fails */
function buildAiPromptSync(session: TriageSession): string {
  const { adoItem, snowTask, product, analysis } = session;
  if (!adoItem) return '';
  const f = adoItem.fields;
  const logHits: Array<{ seed: string; text: string }> = (snowTask as any)?._logHits ?? [];
  const topSeeds: Record<string, number> = (snowTask as any)?._topSeeds ?? {};
  const pattern = product ? matchPattern(adoItem) : null;
  const systemPrompt = `You are a Sunrise product support engineer doing Level-2 triage.
Produce a structured assessment:
Assessment: <CODE BUG | CONFIG / INSTALL | INTENDED BEHAVIOR | ENHANCEMENT | NEED MORE INFO>
Client reported: <1-2 sentences>
SNOW evidence: <key log lines>
Code analysis: <file + method + logic>
Gap: <one paragraph>
Confidence: <High|Medium|Low> â€” <rationale>
Blind spots: <what would confirm>
Next step: <single action>
Rules: No PHI. Facts only. Human review before any L2 post.`;

  const userContent = `## DA ${adoItem.id} â€” ${f['System.Title']}
Area: ${f['System.AreaPath']} | Customer: ${f['Allscripts.Field.CustomerName'] ?? 'â€”'} | Release: ${f['Allscripts.Field.SupportVersion'] ?? 'â€”'} | Severity: ${f['Microsoft.VSTS.Common.Severity'] ?? 'â€”'}
${product ? `Product: ${product.displayName}` : ''}
${analysis?.verdict ? `Pre-analysis verdict: ${analysis.verdict} (${analysis.confidence}) â€” ${analysis.gap}` : ''}

## Description
${String(f['System.Description'] ?? f['Allscripts.Field.DevAssistDetail'] ?? '').replace(/<[^>]+>/g, ' ').slice(0, 600)}

## SNOW: ${snowTask ? snowVal(snowTask.number) + ' (' + snowVal(snowTask.state) + ')' : 'not fetched'}
${snowTask ? snowVal(snowTask.short_description) : ''}

## Log signals
${Object.entries(topSeeds).map(([s, c]) => `${s}: ${c}Ã—`).join(' | ') || '(none)'}

## Key log lines
${logHits.slice(0, 12).map(h => `[${h.seed}] ${h.text}`).join('\n') || '(none)'}

## Pattern: ${pattern ? `"${pattern.name}" â€” ${pattern.fixDirection}` : 'none matched'}
## Repos: ${product?.repos.map(r => `${r.owner}/${r.repo}`).join(', ') ?? '(none)'}`;

  return `${systemPrompt}\n\n---\n\n${userContent}`;
}

interface Props {
  session: TriageSession;
  onAnalysisComplete: (analysis: TriageAnalysis) => void;
}

const VERDICT_STYLE: Record<string, { icon: React.ReactNode; color: string }> = {
  'CODE BUG':         { icon: <Wrench size={14} />,       color: 'text-red-400 border-red-800 bg-red-950/30' },
  'CONFIG / INSTALL': { icon: <Wrench size={14} />,       color: 'text-yellow-400 border-yellow-800 bg-yellow-950/30' },
  'INTENDED BEHAVIOR':{ icon: <CheckCircle2 size={14} />, color: 'text-blue-400 border-blue-800 bg-blue-950/30' },
  'ENHANCEMENT':      { icon: <Lightbulb size={14} />,    color: 'text-purple-400 border-purple-800 bg-purple-950/30' },
  'NEED MORE INFO':   { icon: <HelpCircle size={14} />,   color: 'text-gray-400 border-gray-700 bg-gray-800' },
};

export default function AnalysisPanel({ session, onAnalysisComplete }: Props) {
  const { githubPat } = useSettingsStore();
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  const { adoItem, product, snowTask, analysis } = session;

  const runAnalysis = async () => {
    if (!adoItem || !product) return;
    setRunning(true);
    try {
      const pattern = matchPattern(adoItem);
      const codeHits = pattern
        ? await runCodeSearch(githubPat ?? '', product, pattern)
        : [];
      const workNotes = snowTask?.['_workNotes']
        ? JSON.stringify(snowTask['_workNotes']).slice(0, 500)
        : snowVal(snowTask?.work_notes);
      const result = buildAssessment(adoItem, pattern, codeHits, workNotes || undefined);
      onAnalysisComplete(result);
    } finally {
      setRunning(false);
    }
  };

  if (!adoItem || !product) return null;

  if (!analysis) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-300 flex items-center gap-1.5">
            <Code2 size={14} /> Root Cause Analysis
          </p>
          <button
            onClick={runAnalysis}
            disabled={running}
            className="flex items-center gap-2 bg-altera-blue hover:bg-altera-blue/80 disabled:opacity-50
                       text-white px-3 py-1.5 rounded text-xs font-medium"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Code2 size={12} />}
            {running ? 'Analyzingâ€¦' : 'Analyze'}
          </button>
        </div>
        <p className="text-xs text-gray-600">
          Matches symptom against known patterns, searches mapped repos, and generates root cause assessment.
        </p>
      </div>
    );
  }

  const verdictStyle = VERDICT_STYLE[analysis.verdict ?? 'NEED MORE INFO'] ?? VERDICT_STYLE['NEED MORE INFO'];

  const copyL2 = () => {
    if (analysis.l2Draft) {
      navigator.clipboard.writeText(analysis.l2Draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-3">
      {/* Verdict */}
      <div className={`rounded-lg border p-4 space-y-3 ${verdictStyle.color}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-sm">
            {verdictStyle.icon}
            Assessment: {analysis.verdict}
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${
            analysis.confidence === 'High'   ? 'border-emerald-700 text-emerald-400' :
            analysis.confidence === 'Medium' ? 'border-yellow-700 text-yellow-400' :
                                               'border-gray-700 text-gray-400'
          }`}>
            Confidence: {analysis.confidence}
          </span>
        </div>
        <p className="text-xs opacity-80">{analysis.clientReported}</p>
      </div>

      {/* Reasoning chain */}
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 space-y-3 text-sm">
        {analysis.snowEvidence.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">SNOW Evidence</p>
            {analysis.snowEvidence.map((e, i) => (
              <p key={i} className="text-xs text-gray-400 font-mono leading-relaxed">â€¢ {e}</p>
            ))}
          </div>
        )}

        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Code Analysis</p>
          <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap leading-relaxed">{analysis.codeAnalysis}</pre>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Gap</p>
          <p className="text-xs text-gray-300">{analysis.gap}</p>
        </div>

        {analysis.blindSpots.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1">
              <AlertTriangle size={10} /> Blind Spots
            </p>
            {analysis.blindSpots.map((b, i) => (
              <p key={i} className="text-xs text-yellow-500/80">â€¢ {b}</p>
            ))}
          </div>
        )}
      </div>

      {/* AI Assessment â€” one-click opens VS Code Copilot Chat with full prompt */}
      <div className="rounded-lg border border-purple-800/40 bg-purple-950/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-purple-300 flex items-center gap-1.5">
            <Sparkles size={13} /> AI Assessment
          </p>
          <AiLaunchButton session={session} />
        </div>
        <p className="text-xs text-gray-500">
          Opens VS Code Copilot Chat with the full skill prompt pre-loaded â€” just press Enter.
          Uses the actual <code className="text-gray-400">devassist-triage</code> skill files from your workspace.
        </p>
      </div>

      {/* L2 draft â€” human-gated, never auto-posted */}      {analysis.l2Draft && (
        <div className="rounded-lg border border-altera-blue/40 bg-altera-blue/10 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-altera-teal">L2 Commentary Draft (review before posting)</p>
            <button onClick={copyL2}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-2 py-1 rounded">
              {copied ? <><CheckCircle2 size={11} className="text-emerald-400" /> Copied</> : <><ClipboardCopy size={11} /> Copy</>}
            </button>
          </div>
          <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-auto">
            {analysis.l2Draft}
          </pre>
          <p className="text-xs text-gray-600">âš  Human-gated â€” paste into DA field <code>Allscripts.Field.CommentaryforL2</code> after review. Never auto-posted.</p>
        </div>
      )}

      {/* Re-run */}
      <button onClick={runAnalysis} disabled={running}
        className="text-xs text-gray-600 hover:text-gray-400 flex items-center gap-1">
        {running ? <Loader2 size={11} className="animate-spin" /> : <Code2 size={11} />}
        Re-analyze
      </button>
    </div>
  );
}

function AiLaunchButton({ session }: { session: TriageSession }) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'opened' | 'copied'>('idle');

  const launch = async () => {
    setLoading(true);
    try {
      const prompt = await buildAiPromptWithSkills(session);

      // Write prompt to clipboard first (fallback)
      await navigator.clipboard.writeText(prompt);

      // Try to open VS Code Copilot Chat via vscode:// URI with the prompt
      // The GitHub Copilot Chat extension registers this command handler
      const encoded = encodeURIComponent(prompt);
      const vscodeUri = `vscode://GitHub.copilot-chat/openChat?query=${encoded}`;

      // Open the URI â€” if VS Code is running it will handle it
      window.open(vscodeUri, '_blank');
      setStatus('opened');
      setTimeout(() => setStatus('idle'), 4000);
    } catch {
      // fallback to sync prompt if skill load fails
      const p = buildAiPromptSync(session);
      await navigator.clipboard.writeText(p);
      window.open(`vscode://GitHub.copilot-chat/openChat?query=${encodeURIComponent(p)}`, '_blank');
      setStatus('opened');
      setTimeout(() => setStatus('idle'), 4000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button onClick={launch} disabled={loading}
      className="flex items-center gap-1.5 text-xs bg-purple-900/60 hover:bg-purple-900/90
                 disabled:opacity-40 border border-purple-600 text-purple-100 px-3 py-1.5 rounded font-medium">
      {loading ? <><Loader2 size={11} className="animate-spin" /> Loading skills...</>
      : status === 'opened' ? <><CheckCircle2 size={11} className="text-emerald-400" /> Opened in VS Code</>
      : status === 'copied' ? <><CheckCircle2 size={11} className="text-emerald-400" /> Copied (paste in Copilot Chat)</>
      : <><Sparkles size={11} /> Ask AI in VS Code</>
      }
    </button>
  );
}

