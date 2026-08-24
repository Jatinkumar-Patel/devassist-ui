import { useState } from 'react';
import { FileSearch, Loader2, ChevronDown, AlertTriangle, AlertCircle, Lock, Activity, Code2, ExternalLink } from 'lucide-react';
import type { SnowTask } from '../types';
import { snowVal } from '../lib/snow-client';

interface LogHit {
  file: string;
  line: number;
  text: string;
  seed: string;
  category: 'error' | 'warning' | 'lock' | 'ops' | 'other';
}

interface CodeSuggestion {
  title: string;
  severity: 'critical' | 'high' | 'medium';
  observation: string;
  codeDirection: string;
  repo: string;
  searchTerms: string[];
}

interface LogAnalysisResult {
  analyzed: string[];
  skipped: string[];
  totalHits: number;
  hits: LogHit[];
  byCategory: Record<string, LogHit[]>;
  topSeeds: Record<string, number>;
  suggestions: CodeSuggestion[];
}

interface Props {
  snowTask: SnowTask;
  onResult?: (hits: LogHit[], topSeeds: Record<string, number>) => void;
}

const CATEGORY_CONFIG = {
  error:   { label: 'Errors & Fatals',       icon: <AlertCircle size={13} />, color: 'text-red-400 border-red-800 bg-red-950/20' },
  warning: { label: 'Warnings & Timeouts',   icon: <AlertTriangle size={13} />, color: 'text-yellow-400 border-yellow-800 bg-yellow-950/20' },
  lock:    { label: 'Lock Contention',        icon: <Lock size={13} />, color: 'text-orange-400 border-orange-800 bg-orange-950/20' },
  ops:     { label: 'Patient Operations',     icon: <Activity size={13} />, color: 'text-blue-400 border-blue-800 bg-blue-950/20' },
  other:   { label: 'Other',                 icon: <FileSearch size={13} />, color: 'text-gray-400 border-gray-700 bg-gray-800' },
};

const SEVERITY_COLOR = {
  critical: 'border-red-700 bg-red-950/30 text-red-300',
  high:     'border-orange-700 bg-orange-950/20 text-orange-300',
  medium:   'border-yellow-700 bg-yellow-950/20 text-yellow-300',
};

const BRIDGE = (): string => (window as any).__BRIDGE_URL__ ?? 'http://localhost:7447';

export default function LogAnalysisPanel({ snowTask, onResult }: Props) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<LogAnalysisResult | null>(null);
  const [error, setError] = useState('');

  const sysId = snowVal(snowTask.sys_id);

  const analyze = async () => {
    if (!sysId) return;
    setRunning(true);
    setError('');
    try {
      const r = await fetch(`${BRIDGE()}/api/log-analysis/${sysId}`);
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      const data: LogAnalysisResult = await r.json();
      setResult(data);
      onResult?.(data.hits, data.topSeeds);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
          <FileSearch size={13} /> Log Scan (Phase 2)
        </p>
        <button onClick={analyze} disabled={running || !sysId}
          className="flex items-center gap-1.5 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40
                     border border-gray-600 text-gray-300 px-3 py-1.5 rounded font-medium">
          {running ? <Loader2 size={11} className="animate-spin" /> : <FileSearch size={11} />}
          {running ? 'Analyzing logs…' : result ? 'Re-run' : 'Analyze logs'}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {result && (
        <div className="space-y-4">
          {/* Coverage */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-gray-800 rounded p-2 space-y-0.5">
              <p className="text-gray-500 font-medium">Analyzed</p>
              {result.analyzed.map((f, i) => <p key={i} className="text-gray-300 font-mono truncate">{f}</p>)}
              {!result.analyzed.length && <p className="text-gray-600">none</p>}
            </div>
            <div className="bg-gray-800 rounded p-2 space-y-0.5">
              <p className="text-gray-500 font-medium">Not analyzed</p>
              {result.skipped.map((f, i) => <p key={i} className="text-yellow-500/70 font-mono truncate">{f}</p>)}
              {!result.skipped.length && <p className="text-gray-600">none</p>}
            </div>
          </div>

          {/* ── Categorized sections ── */}
          {(Object.entries(result.byCategory) as [string, LogHit[]][])
            .filter(([, hits]) => hits.length > 0)
            .map(([cat, hits]) => {
              const cfg = CATEGORY_CONFIG[cat as keyof typeof CATEGORY_CONFIG] ?? CATEGORY_CONFIG.other;
              const count = result.topSeeds ? Object.entries(result.topSeeds)
                .filter(([s]) => (SEED_CATEGORY_MAP[s] ?? 'other') === cat)
                .reduce((sum, [, n]) => sum + n, 0) : hits.length;
              return (
                <details key={cat} className={`group rounded-lg border p-3 ${cfg.color}`} open={cat === 'error' || cat === 'warning'}>
                  <summary className="flex items-center justify-between cursor-pointer list-none select-none">
                    <span className="flex items-center gap-1.5 text-xs font-medium">
                      {cfg.icon} {cfg.label}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs tabular-nums font-mono">{count}×</span>
                      <ChevronDown size={11} className="group-open:rotate-180 transition-transform" />
                    </span>
                  </summary>
                  <div className="mt-2 space-y-1 max-h-52 overflow-auto">
                    {hits.map((h, i) => (
                      <div key={i} className="text-xs border-l-2 border-current/30 pl-2 space-y-0.5 opacity-90">
                        <span className="text-gray-600 font-mono">{h.file}:{h.line}</span>
                        <p className="font-mono leading-relaxed break-all text-gray-300">{h.text}</p>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}

          {/* ── Code suggestions ── */}
          {result.suggestions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                <Code2 size={11} /> Code Analysis & Suggestions
              </p>
              {result.suggestions.map((s, i) => (
                <div key={i} className={`rounded-lg border p-3 space-y-2 ${SEVERITY_COLOR[s.severity]}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold">{s.title}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border uppercase tracking-wide
                      ${s.severity === 'critical' ? 'border-red-600 text-red-300' :
                        s.severity === 'high' ? 'border-orange-600 text-orange-300' :
                        'border-yellow-600 text-yellow-300'}`}>
                      {s.severity}
                    </span>
                  </div>
                  <p className="text-xs opacity-80">{s.observation}</p>
                  <div className="bg-black/20 rounded p-2 space-y-1">
                    <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">Code direction</p>
                    <p className="text-xs leading-relaxed">{s.codeDirection}</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <a href={`https://github.com/${s.repo}`} target="_blank" rel="noreferrer"
                       className="text-xs flex items-center gap-1 hover:underline opacity-70 hover:opacity-100">
                      <Code2 size={10} /> {s.repo} <ExternalLink size={10} />
                    </a>
                    <div className="flex gap-1 flex-wrap">
                      {s.searchTerms.map((t) => (
                        <code key={t} className="text-[10px] bg-black/30 px-1 rounded">{t}</code>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Mirrors the bridge SEED_CATEGORY_MAP for client-side count grouping
const SEED_CATEGORY_MAP: Record<string, string> = {
  'ERROR': 'error', 'FATAL': 'error', 'Exception': 'error',
  'SqlException': 'error', 'UnauthorizedAccessException': 'error',
  'OutOfMemoryException': 'error', 'NullReferenceException': 'error', 'ArgumentException': 'error',
  'WARNING': 'warning', 'warn': 'warning',
  'progress indicator has timed out': 'warning', 'Client service error': 'warning',
  'timed out': 'warning', 'Timeout': 'warning', 'LogTraceInfo': 'warning',
  'LockWithTimeout': 'lock', 'lock granted': 'lock', 'lock released': 'lock',
  'GetPatientVisit': 'ops', 'GetSelectedVisitDataAndObservations': 'ops', 'GetPatientList': 'ops',
};
