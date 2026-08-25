import { useEffect, useState } from 'react';
import { ClipboardCopy, Code2, Loader2, CheckCircle2, AlertTriangle, HelpCircle, Wrench, Lightbulb, Sparkles, GitCommit, Bug, TestTube } from 'lucide-react';
import type { TriageAnalysis, TriageSession } from '../types';
import { matchPattern, runCodeSearch, buildSkillDrivenAssessment } from '../lib/analysis';
import { useSettingsStore } from '../store/settings';
import { snowVal } from '../lib/snow-client';
import { getBridgeUrl } from '../lib/bridge-url';

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
        ? JSON.stringify(snowTask['_workNotes'])
        : snowVal(snowTask?.work_notes);
      const logHits: Array<{ seed: string; text: string; file: string }> = (snowTask as any)?._logHits ?? [];
      const topSeeds: Record<string, number> = (snowTask as any)?._topSeeds ?? {};
      // Use skill-driven analysis (reads analysis-playbook.md, reasoning-framework.md etc. from bridge)
      const result = await buildSkillDrivenAssessment(adoItem, product, workNotes || undefined, logHits, topSeeds, codeHits);
      onAnalysisComplete(result);
    } finally {
      setRunning(false);
    }
  };

  if (!adoItem || !product) return null;

  if (!analysis) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-sm font-medium text-gray-300 flex items-center gap-1.5">
            <Code2 size={14} /> Root Cause Analysis
          </p>
          <button
            onClick={runAnalysis}
            disabled={running}
            className="flex items-center gap-2 bg-altera-blue hover:bg-altera-blue/80 disabled:opacity-50
                       text-white px-3 py-1.5 rounded text-xs font-medium w-full sm:w-auto justify-center"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Code2 size={12} />}
            {running ? 'Analyzing...' : 'Analyze'}
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
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
              <p key={i} className="text-xs text-gray-400 font-mono leading-relaxed">- {e}</p>
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
              <p key={i} className="text-xs text-yellow-500/80">- {b}</p>
            ))}
          </div>
        )}
      </div>

      {/* Repo / MTM Comparison */}
      {(session.relatedItems?.length || session.testCases?.length || session.recentCommits?.length) && (
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 space-y-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Repo / MTM Comparison</p>

          {/* Related open bugs */}
          {(session.relatedItems?.length ?? 0) > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                <Bug size={11} className="text-red-400" />
                Open bugs — same area (last 90 days) · {session.relatedItems!.length} found
              </p>
              {session.relatedItems!.slice(0, 8).map(item => (
                <div key={item.id} className="flex items-center justify-between text-xs py-0.5 border-b border-gray-800 last:border-0">
                  <a href={item.url} target="_blank" rel="noreferrer"
                     className="text-altera-teal hover:text-white font-mono shrink-0 mr-2">#{item.id}</a>
                  <span className="text-gray-300 truncate flex-1">{item.title}</span>
                  <span className={`shrink-0 ml-2 px-1.5 py-0.5 rounded text-xs ${
                    item.state === 'Active'     ? 'bg-blue-950 text-blue-400' :
                    item.state === 'New'        ? 'bg-green-950 text-green-400' :
                    item.state === 'In Progress'? 'bg-yellow-950 text-yellow-400' :
                                                  'bg-gray-800 text-gray-500'
                  }`}>{item.state}</span>
                </div>
              ))}
              {session.relatedItems!.length === 0 && (
                <p className="text-xs text-gray-600">No open bugs found in this area — this may be a new/unreported issue</p>
              )}
            </div>
          )}
          {(session.relatedItems?.length ?? 0) === 0 && session.relatedItems !== undefined && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                <Bug size={11} className="text-red-400" /> Open bugs — same area (last 90 days)
              </p>
              <p className="text-xs text-emerald-600">✓ No open bugs found — this may be a new/unreported issue</p>
            </div>
          )}

          {/* Test cases */}
          {(session.testCases?.length ?? 0) > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                <TestTube size={11} className="text-purple-400" />
                MTM Test cases — same area · {session.testCases!.length} found
              </p>
              {session.testCases!.slice(0, 6).map(tc => (
                <div key={tc.id} className="flex items-center justify-between text-xs py-0.5 border-b border-gray-800 last:border-0">
                  <a href={tc.url} target="_blank" rel="noreferrer"
                     className="text-altera-teal hover:text-white font-mono shrink-0 mr-2">#{tc.id}</a>
                  <span className="text-gray-300 truncate flex-1">{tc.title}</span>
                  <span className="shrink-0 ml-2 px-1.5 py-0.5 rounded text-xs bg-purple-950 text-purple-400">{tc.state}</span>
                </div>
              ))}
            </div>
          )}
          {(session.testCases?.length ?? 0) === 0 && session.testCases !== undefined && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                <TestTube size={11} className="text-purple-400" /> MTM Test cases — same area
              </p>
              <p className="text-xs text-yellow-600">⚠ No test cases found — coverage gap for this area</p>
            </div>
          )}

          {/* Recent commits */}
          {(session.recentCommits?.length ?? 0) > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                <GitCommit size={11} className="text-altera-teal" />
                Recent commits — {session.product?.repos.find(r=>r.required)?.repo ?? 'primary repo'}
              </p>
              {session.recentCommits!.slice(0, 5).map(c => (
                <div key={c.sha} className="flex items-center gap-2 text-xs py-0.5 border-b border-gray-800 last:border-0">
                  <a href={c.url} target="_blank" rel="noreferrer"
                     className="text-altera-teal font-mono shrink-0">{c.sha}</a>
                  <span className="text-gray-400 shrink-0">{c.date}</span>
                  <span className="text-gray-300 truncate">{c.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AI Assessment — calls OpenAI via bridge, shows response inline */}
      <AiAssessmentPanel session={session} />

      {/* L2 draft — human-gated, never auto-posted */}
      {analysis.l2Draft && (
        <div className="rounded-lg border border-altera-blue/40 bg-altera-blue/10 p-4 space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <p className="text-xs font-medium text-altera-teal">L2 Commentary Draft (review before posting)</p>
            <button onClick={copyL2}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-2 py-1 rounded">
              {copied ? <><CheckCircle2 size={11} className="text-emerald-400" /> Copied</> : <><ClipboardCopy size={11} /> Copy</>}
            </button>
          </div>
          <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-auto">
            {analysis.l2Draft}
          </pre>
          <p className="text-xs text-gray-600">Warning: Human-gated - paste into DA field <code>Allscripts.Field.CommentaryforL2</code> after review. Never auto-posted.</p>
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

function AiAssessmentPanel({ session }: { session: TriageSession }) {
  const { openaiKey, githubPat } = useSettingsStore();
  const [running, setRunning]   = useState(false);
  const [result, setResult]     = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [copied, setCopied]     = useState(false);
  const [aiSource, setAiSource] = useState<string | null>(null);
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);

  const BRIDGE = getBridgeUrl();

  // Check which AI backend is available on mount
  useEffect(() => {
    fetch(`${BRIDGE}/api/ai-analyze/status`, { signal: AbortSignal.timeout(2000) })
      .then(r => r.ok ? r.json() : null)
      .then((d: { ollama?: boolean; ollamaModels?: string[] } | null) => setOllamaOk(d?.ollama ?? false))
      .catch(() => setOllamaOk(false));
  }, [BRIDGE]);

  const canRun = ollamaOk || !!(openaiKey || githubPat);

  const runAi = async () => {
    if (!session.adoItem) return;
    setRunning(true); setError(null); setResult(null); setAiSource(null);
    try {
      const f = session.adoItem.fields;
      const logHits: Array<{file:string;line:number;seed:string;text:string}> = (session.snowTask as any)?._logHits ?? [];
      const topSeeds: Record<string, number> = (session.snowTask as any)?._topSeeds ?? {};
      const body = {
        openaiKey: openaiKey || undefined,
        githubPat: githubPat || undefined,
        da: {
          id: session.adoItem.id,
          title: f['System.Title'],
          areaPath: f['System.AreaPath'],
          customer: String(f['Allscripts.Field.CustomerName'] ?? ''),
          release: String(f['Allscripts.Field.SupportVersion'] ?? ''),
          severity: String(f['Microsoft.VSTS.Common.Severity'] ?? ''),
          description: String(f['System.Description'] ?? f['Allscripts.Field.DevAssistDetail'] ?? '').replace(/<[^>]+>/g,' ').slice(0, 800),
        },
        snowTask: session.snowTask ? {
          number: String((session.snowTask as any).number?.display_value ?? (session.snowTask as any).number ?? ''),
          shortDescription: String((session.snowTask as any).short_description?.display_value ?? ''),
          state: String((session.snowTask as any).state?.display_value ?? ''),
          workNotes: JSON.stringify((session.snowTask as any)._workNotes ?? '').slice(0, 1200),
        } : null,
        logHits,
        topSeeds,
        repos: session.product?.repos.map(r => `${r.owner}/${r.repo}`) ?? [],
        patternName: session.analysis?.codeAnalysis?.match(/Keyword pattern: "([^"]+)"/)?.[1],
        patternFixDirection: session.analysis?.gap?.slice(0, 200),
      };
      const res = await fetch(`${BRIDGE}/api/ai-analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      const data = await res.json() as { assessment?: string; error?: string; source?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult(data.assessment ?? '');
      setAiSource(data.source ?? null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const copyResult = () => {
    if (result) { navigator.clipboard.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const sourceLabel: Record<string, string> = {
    'ollama': '🦙 Ollama (local)',
    'openai': '🤖 OpenAI',
    'github-models': '⚡ GitHub Models',
  };

  return (
    <div className="rounded-lg border border-purple-800/40 bg-purple-950/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs font-medium text-purple-300 flex items-center gap-1.5">
            <Sparkles size={13} /> AI Assessment
          </p>
          {ollamaOk === true && (
            <span className="text-xs text-emerald-400 border border-emerald-800 rounded px-1.5 py-0.5">🦙 Ollama ready</span>
          )}
          {ollamaOk === false && !openaiKey && (
            <span className="text-xs text-yellow-600 border border-yellow-900 rounded px-1.5 py-0.5">No local AI</span>
          )}
          {aiSource && <span className="text-xs text-gray-500">{sourceLabel[aiSource] ?? aiSource}</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {result && (
            <button onClick={copyResult}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-white border border-gray-700 px-2 py-1 rounded">
              {copied ? <><CheckCircle2 size={11} className="text-emerald-400"/> Copied</> : <><ClipboardCopy size={11}/> Copy</>}
            </button>
          )}
          <button onClick={runAi} disabled={running || !canRun}
            className="flex items-center justify-center gap-1.5 text-xs bg-purple-900/60 hover:bg-purple-900/90 disabled:opacity-40 border border-purple-600 text-purple-100 px-3 py-1.5 rounded font-medium w-full sm:w-auto">
            {running ? <><Loader2 size={11} className="animate-spin"/> Asking AI...</>
            : result  ? <><Sparkles size={11}/> Re-run</>
            : <><Sparkles size={11}/> Ask AI</>}
          </button>
        </div>
      </div>

      {!canRun && (
        <div className="text-xs text-yellow-600 space-y-1">
          <p>No AI available. Options:</p>
          <p>• <strong className="text-yellow-400">Free & local</strong>: Install <a href="https://ollama.com" target="_blank" rel="noreferrer" className="underline">Ollama</a>, then run: <code className="bg-gray-800 px-1 rounded">ollama pull llama3.2</code></p>
          <p>• <strong className="text-yellow-400">OpenAI key</strong>: Add in <a href={`${import.meta.env.BASE_URL}settings`} className="underline text-yellow-400">Settings</a></p>
        </div>
      )}
      {error && <p className="text-xs text-red-400 font-mono whitespace-pre-wrap">Error: {error}</p>}
      {result && (
        <pre className="text-xs text-gray-200 whitespace-pre-wrap font-mono leading-relaxed bg-gray-900/60 rounded p-3 max-h-96 overflow-auto border border-gray-700">
          {result}
        </pre>
      )}
      {!result && !error && canRun && !running && (
        <p className="text-xs text-gray-600">
          {ollamaOk ? 'Ollama detected — click "Ask AI" to run locally.' : 'Click "Ask AI" to analyze with OpenAI.'}
        </p>
      )}
    </div>
  );
}