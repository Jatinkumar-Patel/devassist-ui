import { useEffect, useRef, useState } from 'react';
import { FileSearch, Loader2, ChevronDown, AlertTriangle, AlertCircle, Lock, Activity, Code2, ExternalLink } from 'lucide-react';
import type { SnowTask } from '../types';
import { snowVal } from '../lib/snow-client';
import { bridgeApi } from '../lib/bridge-url';

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
  totalAttachments?: number;
  scannableAttachments?: number;
  analyzed: string[];
  skipped: string[];
  totalHits: number;
  hits: LogHit[];
  byCategory: Record<string, LogHit[]>;
  topSeeds: Record<string, number>;
  spreadsheetSummaries?: Array<{
    file: string;
    sheet: string;
    rowCount: number;
    columnCount: number;
    headers?: string[];
    sampleRows?: string[];
    findings?: string[];
  }>;
  imageSummaries?: Array<{
    file: string;
    textPreview: string;
    charCount: number;
    findings?: string[];
    hitCount: number;
  }>;
  suggestions: CodeSuggestion[];
  cached?: boolean;
}

interface Props {
  snowTask?: SnowTask | null;
  snowIncident?: Record<string, unknown> | null;
  snowCase?: Record<string, unknown> | null;
  snowTaskNumber?: string;
  autoResult?: LogAnalysisResult | null;
  onResult?: (hits: LogHit[], topSeeds: Record<string, number>) => void;
  blockedReason?: string | null;
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

export default function LogAnalysisPanel({ snowTask, snowIncident, snowCase, snowTaskNumber, autoResult, onResult, blockedReason }: Props) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<LogAnalysisResult | null>(autoResult ?? null);
  const [error, setError] = useState('');
  const [manualSysId, setManualSysId] = useState('');
  const autoAttemptedForSysIdRef = useRef<string>('');

  useEffect(() => {
    setResult(autoResult ?? null);
  }, [autoResult]);

  const autoSysId = snowTask ? snowVal(snowTask.sys_id) : '';
  const sysId = autoSysId || manualSysId.trim();
  const waitingForSnowCheck = blockedReason?.includes('still being verified') ?? false;

  const readSysId = (record: any): string => {
    if (!record) return '';
    const raw = record.sys_id;
    return typeof raw === 'string' ? raw : snowVal(raw);
  };

  const mergeResults = (items: LogAnalysisResult[]): LogAnalysisResult => {
    const analyzed = items.flatMap((x) => x.analyzed ?? []);
    const skipped = items.flatMap((x) => x.skipped ?? []);
    const hits = items.flatMap((x) => x.hits ?? []);
    const spreadsheetSummaries = items.flatMap((x) => x.spreadsheetSummaries ?? []);
    const imageSummaries = items.flatMap((x) => x.imageSummaries ?? []);

    const topSeeds: Record<string, number> = {};
    for (const item of items) {
      for (const [seed, count] of Object.entries(item.topSeeds ?? {})) {
        topSeeds[seed] = (topSeeds[seed] ?? 0) + (count ?? 0);
      }
    }

    const byCategory: Record<string, LogHit[]> = { error: [], warning: [], lock: [], ops: [], other: [] };
    for (const hit of hits) {
      byCategory[hit.category] = [...(byCategory[hit.category] ?? []), hit].slice(0, 30);
    }

    return {
      totalAttachments: items.reduce((sum, x) => sum + (x.totalAttachments ?? 0), 0),
      scannableAttachments: items.reduce((sum, x) => sum + (x.scannableAttachments ?? 0), 0),
      analyzed,
      skipped,
      totalHits: hits.length,
      hits,
      byCategory,
      topSeeds,
      spreadsheetSummaries,
      imageSummaries,
      suggestions: items.flatMap((x) => x.suggestions ?? []),
      cached: items.every((x) => x.cached),
    };
  };

  const analyze = async () => {
    if (!sysId || blockedReason) return;
    setRunning(true);
    setError('');
    try {
      let data: LogAnalysisResult;

      if (snowTask && autoSysId) {
        const sysIds = new Set<string>([autoSysId]);

        const incidentFromSession = readSysId(snowIncident as any);
        const caseFromSession = readSysId(snowCase as any);
        if (incidentFromSession) sysIds.add(incidentFromSession);
        if (caseFromSession) sysIds.add(caseFromSession);

        try {
          const esc = await fetch(bridgeApi(`/api/snow/escalate/${autoSysId}`));
          if (esc.ok) {
            const chain = await esc.json() as { incident?: any; case?: any };
            const incidentSysId = readSysId(chain.incident);
            const caseSysId = readSysId(chain.case);
            if (incidentSysId) sysIds.add(incidentSysId);
            if (caseSysId) sysIds.add(caseSysId);
          }
        } catch {
          // Non-fatal: fall back to task-only scan.
        }

        const scans = await Promise.all(
          Array.from(sysIds).map(async (id) => {
            const r = await fetch(bridgeApi(`/api/log-analysis/${id}`));
            if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
            return r.json() as Promise<LogAnalysisResult>;
          })
        );

        data = mergeResults(scans);
      } else {
        const r = await fetch(bridgeApi(`/api/log-analysis/${sysId}`));
        if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
        data = await r.json();
      }

      setResult(data);
      onResult?.(data.hits, data.topSeeds);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (!sysId || running || result || autoResult || blockedReason) return;
    if (autoAttemptedForSysIdRef.current === sysId) return;
    autoAttemptedForSysIdRef.current = sysId;
    void analyze();
  }, [autoResult, blockedReason, result, running, sysId]);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
          <FileSearch size={13} /> Log Scan
          {snowTaskNumber && <span className="text-gray-600 font-mono">{snowTaskNumber}</span>}
          {autoSysId && <span className="text-gray-600 font-mono text-[10px]">sysId: {autoSysId.slice(0, 8)}…</span>}
        </p>
        <button onClick={analyze} disabled={running || !sysId || !!blockedReason}
          className="flex items-center gap-1.5 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40
                     border border-gray-600 text-gray-300 px-3 py-1.5 rounded font-medium">
          {running ? <Loader2 size={11} className="animate-spin" /> : <FileSearch size={11} />}
          {running ? 'Analyzing…' : result ? 'Re-run' : 'Analyze logs'}
        </button>
      </div>

      {/* Manual sysId entry when SNOW task not auto-fetched */}
      {!autoSysId && (
        <div className="rounded-lg border border-amber-800/50 bg-amber-950/20 p-3 space-y-2">
          <p className="text-[11px] text-amber-300">
            SNOW task not auto-fetched (task may be in an unlisted table or VPN issue).
            Paste the SNOW record <strong>sys_id</strong> manually to run log analysis:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualSysId}
              onChange={(e) => setManualSysId(e.target.value)}
              placeholder="e.g. 1a2b3c4d5e6f7890abcdef1234567890"
              className="flex-1 bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-600"
            />
            <button
              onClick={analyze}
              disabled={running || !manualSysId.trim() || !!blockedReason}
              className="text-xs bg-cyan-800/50 hover:bg-cyan-700/60 border border-cyan-700/60 text-cyan-200 px-3 py-1 rounded disabled:opacity-40 font-medium"
            >
              {running ? 'Running…' : 'Run'}
            </button>
          </div>
          <p className="text-[10px] text-gray-600">Find sys_id: open the SNOW task → right-click → Copy sys_id, or from the SNOW URL.</p>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {blockedReason && (
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-3 space-y-1">
          <p className="text-xs font-medium text-amber-300">{waitingForSnowCheck ? 'Log scan pending' : 'Log scan unavailable'}</p>
          <p className="text-xs text-amber-200/90">{blockedReason}</p>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-gray-800 rounded p-2">
              <p className="text-gray-500 font-medium">Attachments found</p>
              <p className="text-gray-200 font-mono">{result.totalAttachments ?? 0}</p>
            </div>
            <div className="bg-gray-800 rounded p-2">
              <p className="text-gray-500 font-medium">Scannable</p>
              <p className="text-gray-200 font-mono">{result.scannableAttachments ?? 0}</p>
            </div>
            <div className="bg-gray-800 rounded p-2">
              <p className="text-gray-500 font-medium">Pattern hits</p>
              <p className="text-gray-200 font-mono">{result.totalHits ?? 0}</p>
            </div>
          </div>

          {(result.totalAttachments ?? 0) === 0 && (
            <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
              <p className="text-xs font-medium text-gray-300">No SNOW attachments found for this record chain</p>
              <p className="text-xs text-gray-500 mt-1">There is nothing for DevAssist to scan yet. Use Raw evidence to confirm whether the task, incident, or case actually has attachments.</p>
            </div>
          )}

          {(result.totalAttachments ?? 0) > 0 && (result.scannableAttachments ?? 0) === 0 && (
            <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
              <p className="text-xs font-medium text-gray-300">Attachments found, but none are processable yet</p>
              <p className="text-xs text-gray-500 mt-1">Supported scan types are `.log`, `.txt`, `.zip`, `.csv`, `.json`, `.xml`, `.xlsx`, `.xls`, `.png`, `.jpg`, `.jpeg`, `.bmp`, `.tif`, and `.tiff`.</p>
            </div>
          )}

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

          {result.spreadsheetSummaries && result.spreadsheetSummaries.length > 0 && (
            <details className="rounded-lg border border-cyan-900/60 bg-cyan-950/20 p-3 group" open>
              <summary className="flex items-center justify-between cursor-pointer list-none select-none">
                <span className="text-xs font-medium text-cyan-200">Spreadsheet Data Extracted ({result.spreadsheetSummaries.length})</span>
                <ChevronDown size={11} className="group-open:rotate-180 transition-transform text-cyan-300" />
              </summary>
              <div className="mt-2 space-y-2 max-h-56 overflow-auto">
                {result.spreadsheetSummaries.slice(0, 20).map((s, i) => (
                  <div key={`${s.file}-${s.sheet}-${i}`} className="text-xs rounded border border-cyan-900/50 bg-black/20 p-2 space-y-1">
                    <p className="text-cyan-200 font-mono break-all">{s.file}#{s.sheet}</p>
                    <p className="text-gray-300">Rows: {s.rowCount} | Columns: {s.columnCount}</p>
                    {s.headers && s.headers.length > 0 && (
                      <p className="text-gray-400">Headers: {s.headers.slice(0, 8).join(', ')}</p>
                    )}
                    {s.sampleRows && s.sampleRows.length > 0 && (
                      <p className="text-gray-500 font-mono break-all">Sample: {s.sampleRows[0]}</p>
                    )}
                    {s.findings && s.findings.length > 0 && (
                      <div className="space-y-0.5 pt-1 border-t border-cyan-900/50">
                        {s.findings.slice(0, 4).map((f, idx) => (
                          <p key={idx} className="text-gray-300">- {f}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}

          {result.imageSummaries && result.imageSummaries.length > 0 && (
            <details className="rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3 group" open>
              <summary className="flex items-center justify-between cursor-pointer list-none select-none">
                <span className="text-xs font-medium text-emerald-200">Image OCR Extracted ({result.imageSummaries.length})</span>
                <ChevronDown size={11} className="group-open:rotate-180 transition-transform text-emerald-300" />
              </summary>
              <div className="mt-2 space-y-2 max-h-56 overflow-auto">
                {result.imageSummaries.slice(0, 20).map((image, i) => (
                  <div key={`${image.file}-${i}`} className="text-xs rounded border border-emerald-900/50 bg-black/20 p-2 space-y-1">
                    <p className="text-emerald-200 font-mono break-all">{image.file}</p>
                    <p className="text-gray-300">OCR chars: {image.charCount} | Pattern hits: {image.hitCount}</p>
                    {image.textPreview && (
                      <p className="text-gray-400 font-mono break-all">Preview: {image.textPreview}</p>
                    )}
                    {image.findings && image.findings.length > 0 && (
                      <div className="space-y-0.5 pt-1 border-t border-emerald-900/50">
                        {image.findings.slice(0, 4).map((finding, idx) => (
                          <p key={idx} className="text-gray-300">- {finding}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}

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
