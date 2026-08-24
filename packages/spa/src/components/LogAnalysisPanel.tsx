import { useState } from 'react';
import { FileSearch, Loader2, ChevronDown } from 'lucide-react';
import type { SnowTask } from '../types';
import { snowVal } from '../lib/snow-client';

interface LogHit {
  file: string;
  line: number;
  text: string;
  seed: string;
}

interface LogAnalysisResult {
  analyzed: string[];
  skipped: string[];
  totalHits: number;
  hits: LogHit[];
  lockPairs: LogHit[];
  topSeeds: Record<string, number>;
}

interface Props {
  snowTask: SnowTask;
}

// Seed → color for display
const SEED_COLOR: Record<string, string> = {
  'progress indicator has timed out': 'text-red-400',
  'Client service error': 'text-red-400',
  'LockWithTimeout': 'text-orange-400',
  'lock granted': 'text-yellow-400',
  'lock released': 'text-yellow-400',
  'LogTraceInfo': 'text-blue-400',
  'ERROR': 'text-red-400',
  'FATAL': 'text-red-400',
  'Exception': 'text-orange-400',
  'GetPatientVisit': 'text-purple-400',
  'GetPatientList': 'text-purple-400',
  'GetSelectedVisitDataAndObservations': 'text-purple-400',
};

const BRIDGE = (): string => (window as any).__BRIDGE_URL__ ?? 'http://localhost:7447';

export default function LogAnalysisPanel({ snowTask }: Props) {
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
      setResult(await r.json());
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
          <FileSearch size={13} /> Log Analysis (Phase 2 — artifact scan)
        </p>
        <button
          onClick={analyze}
          disabled={running || !sysId}
          className="flex items-center gap-1.5 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40
                     border border-gray-600 text-gray-300 px-3 py-1.5 rounded font-medium"
        >
          {running ? <Loader2 size={11} className="animate-spin" /> : <FileSearch size={11} />}
          {running ? 'Analyzing logs…' : 'Analyze logs'}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {result && (
        <div className="space-y-3">
          {/* Coverage summary */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-gray-800 rounded p-2">
              <p className="text-gray-500">Analyzed</p>
              {result.analyzed.map((f, i) => (
                <p key={i} className="text-gray-300 font-mono truncate">{f}</p>
              ))}
              {result.analyzed.length === 0 && <p className="text-gray-600">none</p>}
            </div>
            <div className="bg-gray-800 rounded p-2">
              <p className="text-gray-500">Not analyzed</p>
              {result.skipped.map((f, i) => (
                <p key={i} className="text-yellow-500/70 font-mono truncate">{f}</p>
              ))}
              {result.skipped.length === 0 && <p className="text-gray-600">none</p>}
            </div>
          </div>

          {/* Top signals */}
          {Object.keys(result.topSeeds).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Signal summary ({result.totalHits} total hits)</p>
              <div className="space-y-0.5">
                {Object.entries(result.topSeeds).map(([seed, count]) => (
                  <div key={seed} className="flex items-center justify-between text-xs">
                    <span className={`font-mono ${SEED_COLOR[seed] ?? 'text-gray-400'}`}>{seed}</span>
                    <span className="text-gray-500 tabular-nums">{count}×</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Key log lines */}
          {result.hits.length > 0 && (
            <details className="group">
              <summary className="flex items-center gap-1 cursor-pointer text-xs text-gray-500 hover:text-gray-300 select-none list-none">
                <ChevronDown size={12} className="group-open:rotate-180 transition-transform" />
                Key log lines ({result.hits.length})
              </summary>
              <div className="mt-2 space-y-1 max-h-80 overflow-auto">
                {result.hits.map((h, i) => (
                  <div key={i} className="text-xs border-l-2 border-gray-700 pl-2 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-600 font-mono shrink-0">{h.file}:{h.line}</span>
                      <span className={`text-[10px] px-1 rounded ${SEED_COLOR[h.seed] ? SEED_COLOR[h.seed] + ' bg-gray-800' : 'text-gray-500'}`}>
                        {h.seed}
                      </span>
                    </div>
                    <p className="text-gray-400 font-mono leading-relaxed break-all">{h.text}</p>
                  </div>
                ))}
              </div>
            </details>
          )}

          {result.hits.length === 0 && result.analyzed.length > 0 && (
            <p className="text-xs text-gray-600">No key signals found in analyzed logs.</p>
          )}
        </div>
      )}
    </div>
  );
}
