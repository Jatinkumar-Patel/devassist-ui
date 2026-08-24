import { useState } from 'react';
import { ClipboardCopy, Code2, Loader2, CheckCircle2, AlertTriangle, HelpCircle, Wrench, Lightbulb, Sparkles } from 'lucide-react';
import type { TriageAnalysis, TriageSession } from '../types';
import { matchPattern, runCodeSearch, buildAssessment } from '../lib/analysis';
import { useSettingsStore } from '../store/settings';
import { snowVal } from '../lib/snow-client';

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

const BRIDGE = (): string => (window as any).__BRIDGE_URL__ ?? 'http://localhost:7447';

export default function AnalysisPanel({ session, onAnalysisComplete }: Props) {
  const { githubPat } = useSettingsStore();
  const [running, setRunning] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [aiError, setAiError] = useState('');

  const runAiAnalysis = async () => {
    const { adoItem, product } = session;
    if (!adoItem || !githubPat) return;
    setAiRunning(true);
    setAiError('');
    try {
      const f = adoItem.fields;
      const logHits = (session.snowTask as any)?._logHits ?? [];
      const topSeeds = (session.snowTask as any)?._topSeeds ?? {};
      const pattern = product ? matchPattern(adoItem) : null;

      const body = {
        githubPat,
        da: {
          id: adoItem.id,
          title: f['System.Title'],
          areaPath: f['System.AreaPath'],
          customer: String(f['Allscripts.Field.CustomerName'] ?? ''),
          release: String(f['Allscripts.Field.SupportVersion'] ?? ''),
          severity: String(f['Microsoft.VSTS.Common.Severity'] ?? ''),
          description: String(f['System.Description'] ?? f['Allscripts.Field.DevAssistDetail'] ?? ''),
        },
        snowTask: session.snowTask ? {
          number: snowVal(session.snowTask.number),
          shortDescription: snowVal(session.snowTask.short_description),
          state: snowVal(session.snowTask.state),
          workNotes: String((session.snowTask as any)._workNotes
            ? JSON.stringify((session.snowTask as any)._workNotes).slice(0, 500)
            : snowVal(session.snowTask.work_notes)),
        } : null,
        logHits,
        topSeeds,
        patternName: pattern?.name,
        patternFixDirection: pattern?.fixDirection,
        repos: (product?.repos ?? []).map((r: { owner: string; repo: string }) => `${r.owner}/${r.repo}`),
      };

      const r = await fetch(`${BRIDGE()}/api/ai-analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setAiResult(data.assessment);
    } catch (e: any) {
      setAiError(e.message);
    } finally {
      setAiRunning(false);
    }
  };

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

      {/* AI Assessment — GitHub Models (GPT-4o) with full skill reasoning prompt */}
      <div className="rounded-lg border border-purple-800/40 bg-purple-950/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-purple-300 flex items-center gap-1.5">
            <Sparkles size={13} /> AI Assessment (GitHub Models · GPT-4o)
          </p>
          <button
            onClick={runAiAnalysis}
            disabled={aiRunning || !githubPat}
            title={!githubPat ? 'Add GitHub PAT in Settings' : ''}
            className="flex items-center gap-1.5 text-xs bg-purple-900/50 hover:bg-purple-900/80
                       disabled:opacity-40 border border-purple-700 text-purple-200
                       px-3 py-1.5 rounded font-medium"
          >
            {aiRunning ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {aiRunning ? 'Analyzing…' : aiResult ? 'Re-run AI' : 'Ask AI'}
          </button>
        </div>
        {!githubPat && (
          <p className="text-xs text-gray-600">Add your GitHub PAT in Settings to enable AI analysis.</p>
        )}
        {aiError && (
          <p className="text-xs text-red-400">{aiError}</p>
        )}
        {aiResult && (
          <pre className="text-xs text-gray-200 whitespace-pre-wrap font-mono leading-relaxed
                          bg-gray-950 rounded p-3 max-h-96 overflow-auto border border-gray-800">
            {aiResult}
          </pre>
        )}
        {!aiResult && !aiError && !aiRunning && (
          <p className="text-xs text-gray-600">
            Sends DA fields, SNOW work notes, and log evidence to GPT-4o with the devassist-triage
            reasoning prompt. Human review required before using output.
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
