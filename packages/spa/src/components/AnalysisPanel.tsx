import { useState } from 'react';
import { ClipboardCopy, Code2, Loader2, CheckCircle2, AlertTriangle, HelpCircle, Wrench, Lightbulb, Sparkles, MessageSquare } from 'lucide-react';
import type { TriageAnalysis, TriageSession } from '../types';
import { matchPattern, runCodeSearch, buildAssessment } from '../lib/analysis';
import { useSettingsStore } from '../store/settings';
import { snowVal } from '../lib/snow-client';
function buildCopilotPrompt(session: TriageSession): string {
  const { adoItem, snowTask, product } = session;
  if (!adoItem) return '';
  const f = adoItem.fields;
  const logHits: Array<{ seed: string; text: string }> = (snowTask as any)?._logHits ?? [];
  const topSeeds: Record<string, number> = (snowTask as any)?._topSeeds ?? {};
  const pattern = product ? matchPattern(adoItem) : null;

  return `You are a Sunrise product support engineer performing Level-2 triage.
Use the evidence below to produce a structured assessment following this format:

Assessment: <CODE BUG | CONFIG / INSTALL | INTENDED BEHAVIOR | ENHANCEMENT | NEED MORE INFO>
Client reported: <1-2 sentences>
SNOW evidence: <key log lines / work notes>
Code analysis: <file + method + what the code does vs should do>
Gap: <one paragraph>
Confidence: <High|Medium|Low> — <rationale>
Blind spots: <what would raise confidence>
Recommended next step: <single most important action>

Rules: No PHI. Facts only — no confirmed fixes. Human review before any L2 post.

---

## DA ${adoItem.id} — ${f['System.Title']}

Area: ${f['System.AreaPath']}
Customer: ${f['Allscripts.Field.CustomerName'] ?? '—'}
Release: ${f['Allscripts.Field.SupportVersion'] ?? '—'}
Severity: ${f['Microsoft.VSTS.Common.Severity'] ?? '—'}
State: ${f['System.State']}
${product ? `Product: ${product.displayName}\nSNOW Product: ${product.snowProduct}` : 'Product: not mapped'}

## Description
${String(f['System.Description'] ?? f['Allscripts.Field.DevAssistDetail'] ?? '(empty)').replace(/<[^>]+>/g, ' ').slice(0, 800)}

## SNOW Task: ${snowTask ? snowVal(snowTask.number) : 'not fetched'}
State: ${snowTask ? snowVal(snowTask.state) : '—'}
${snowTask?.work_notes ? `Work notes: ${snowVal(snowTask.work_notes).slice(0, 400)}` : ''}

## Log signal summary
${Object.entries(topSeeds).map(([s, c]) => `  ${s}: ${c}×`).join('\n') || 'No log signals (bridge offline or no attachments)'}

## Key log lines (top 15)
${logHits.slice(0, 15).map(h => `  [${h.seed}] ${h.text}`).join('\n') || '(none)'}

## Pre-matched pattern
${pattern ? `"${pattern.name}" — ${pattern.fixDirection}` : 'No keyword pattern matched'}

## Mapped repos
${product?.repos.map(r => `${r.owner}/${r.repo}`).join(', ') ?? '(none)'}
`;
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
  const [aiResult] = useState<string | null>(null);

  const { adoItem, product, snowTask, analysis } = session;

  const runAnalysis = async () => {
    if (!adoItem || !product) return;
    setRunning(true);
    try {
      const pattern = matchPattern(adoItem);
      const codeHits = pattern && githubPat
        ? await runCodeSearch(githubPat, product, pattern)
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
            {running ? 'Analyzing…' : 'Analyze'}
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
              <p key={i} className="text-xs text-gray-400 font-mono leading-relaxed">• {e}</p>
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
              <p key={i} className="text-xs text-yellow-500/80">• {b}</p>
            ))}
          </div>
        )}
      </div>

      {/* AI Assessment — copy prompt to Copilot Chat (no API key needed) */}
      <div className="rounded-lg border border-purple-800/40 bg-purple-950/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-purple-300 flex items-center gap-1.5">
            <Sparkles size={13} /> AI Assessment — Copilot Chat
          </p>
          <CopilotCopyButton session={session} />
        </div>
        {aiResult && (
          <pre className="text-xs text-gray-200 whitespace-pre-wrap font-mono leading-relaxed
                          bg-gray-950 rounded p-3 max-h-96 overflow-auto border border-gray-800">
            {aiResult}
          </pre>
        )}
        {!aiResult && (
          <p className="text-xs text-gray-600">
            Click <strong className="text-gray-400">Copy prompt</strong> then paste into{' '}
            <strong className="text-gray-400">Copilot Chat</strong> in VS Code (Ctrl+Shift+I).
            All evidence is pre-formatted — just paste and send.
          </p>
        )}
      </div>

      {/* L2 draft — human-gated, never auto-posted */}      {analysis.l2Draft && (
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
          <p className="text-xs text-gray-600">⚠ Human-gated — paste into DA field <code>Allscripts.Field.CommentaryforL2</code> after review. Never auto-posted.</p>
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

function CopilotCopyButton({ session }: { session: TriageSession }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const prompt = buildCopilotPrompt(session);
    if (!prompt) return;
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };
  return (
    <button onClick={copy}
      className="flex items-center gap-1.5 text-xs bg-purple-900/50 hover:bg-purple-900/80
                 border border-purple-700 text-purple-200 px-3 py-1.5 rounded font-medium">
      {copied
        ? <><CheckCircle2 size={11} className="text-emerald-400" /> Copied — paste in Copilot Chat</>
        : <><MessageSquare size={11} /> Copy prompt</>
      }
    </button>
  );
}
