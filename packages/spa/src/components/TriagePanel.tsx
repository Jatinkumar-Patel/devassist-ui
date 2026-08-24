import { ExternalLink, GitBranch, Package, AlertTriangle, CheckCircle2, Paperclip, ChevronDown } from 'lucide-react';
import type { TriageSession, TriageAnalysis } from '../types';
import { workItemUrl } from '../lib/ado-client';
import { snowTaskUrl, snowVal } from '../lib/snow-client';
import AnalysisPanel from './AnalysisPanel';
import LogAnalysisPanel from './LogAnalysisPanel';

// Phase label for the progress indicator
const PHASE_LABELS: Record<string, string> = {
  preflight: 'Preflight',
  reading:   'Reading DA',
  routing:   'Routing',
  snow:      'Pulling SNOW',
  clarity:   'Clarity check',
  artifacts: 'Artifacts',
  analysis:  'Analysis',
  done:      'Done',
};

interface Props {
  session: TriageSession;
  onAnalysisComplete: (analysis: TriageAnalysis) => void;
}

export default function TriagePanel({ session, onAnalysisComplete }: Props) {
  const { adoItem, snowTask, product, error, currentPhase, clarityGaps, attachments, artifactLedger } = session;

  if (error) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-950/30 p-4 flex items-start gap-3">
        <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
        <p className="text-red-300 text-sm">{error}</p>
      </div>
    );
  }

  // Show phase progress while loading
  if (session.status === 'loading') {
    return (
      <div className="space-y-2 animate-pulse">
        <p className="text-xs text-altera-teal">
          {PHASE_LABELS[currentPhase] ?? currentPhase}â€¦
        </p>
        <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
          <div className="h-1 bg-altera-teal rounded-full w-1/3 transition-all" />
        </div>
      </div>
    );
  }

  if (!adoItem) return null;

  const fields = adoItem.fields;
  const snowNum = fields['Allscripts.Field.IncidentTaskID'];

  return (
    <div className="space-y-4">
      {/* â”€â”€ Run header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-xs text-gray-500 font-mono">
              {fields['System.WorkItemType']} #{adoItem.id}
            </span>
            <h2 className="text-gray-100 font-semibold mt-0.5 leading-snug">
              {fields['System.Title']}
            </h2>
          </div>
          <a href={workItemUrl(adoItem.id)} target="_blank" rel="noreferrer" className="text-altera-teal hover:text-white shrink-0">
            <ExternalLink size={14} />
          </a>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge label="Area"     value={fields['System.AreaPath']} />
          <Badge label="State"    value={fields['System.State']} />
          {fields['Allscripts.Field.SupportVersion'] && <Badge label="Release"  value={String(fields['Allscripts.Field.SupportVersion'])} />}
          {fields['Allscripts.Field.CustomerName']   && <Badge label="Customer" value={String(fields['Allscripts.Field.CustomerName'])} />}
          {fields['Microsoft.VSTS.Common.Severity']  && <Badge label="Severity" value={String(fields['Microsoft.VSTS.Common.Severity'])} />}
          {fields['Allscripts.Field.SupportPriority']&& <Badge label="Priority" value={String(fields['Allscripts.Field.SupportPriority'])} />}
        </div>
        {/* SNOW link */}
        {snowNum && (
          <div className="text-xs">
            <span className="text-gray-500">SNOW task: </span>
            <a href={snowTaskUrl(String(snowNum))} target="_blank" rel="noreferrer"
               className="text-altera-teal hover:text-white font-mono">{String(snowNum)}</a>
            {session.snowTaskTable && <span className="text-gray-600 ml-1">({session.snowTaskTable})</span>}
          </div>
        )}
      </div>

      {/* â”€â”€ Phase 1: Clarity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {clarityGaps !== undefined && (
        <div className={`rounded-lg border p-3 text-sm ${
          clarityGaps.length === 0
            ? 'border-emerald-800 bg-emerald-950/20'
            : 'border-yellow-800/60 bg-yellow-950/20'
        }`}>
          <div className="flex items-center gap-1.5 font-medium mb-1.5">
            {clarityGaps.length === 0
              ? <><CheckCircle2 size={13} className="text-emerald-400" /> <span className="text-emerald-300">Clarity: CLEAR</span></>
              : <><AlertTriangle size={13} className="text-yellow-400" /> <span className="text-yellow-300">Clarity: GAPS ({clarityGaps.length})</span></>
            }
          </div>
          {clarityGaps.map((g, i) => (
            <p key={i} className="text-xs text-yellow-200 ml-5">â€¢ {g}</p>
          ))}
        </div>
      )}

      {/* â”€â”€ Product routing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {product ? (
        <div className="rounded-lg border border-altera-blue/40 bg-altera-blue/10 p-4 space-y-3">
          <div className="flex items-center gap-2 text-altera-teal text-sm font-medium">
            <Package size={14} />
            Routed to: {product.displayName}
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <InfoRow label="SNOW Product" value={product.snowProduct} />
            <InfoRow label="TASK table"   value={product.snowTaskTable} />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-gray-500 font-medium">Repos</p>
            {product.repos.map((r) => (
              <a key={r.key} href={`https://github.com/${r.owner}/${r.repo}`}
                 target="_blank" rel="noreferrer"
                 className="flex items-center gap-1.5 text-xs text-altera-teal hover:text-white">
                <GitBranch size={11} />
                {r.owner}/{r.repo}
                {r.required && <span className="text-gray-500">(primary)</span>}
              </a>
            ))}
          </div>
        </div>
      ) : adoItem && (
        <div className="rounded-lg border border-yellow-800/50 bg-yellow-950/20 p-3 text-xs text-yellow-300">
          âš  No product match for "{fields['System.AreaPath']}" â€” add it in the Registry.
        </div>
      )}

      {/* â”€â”€ SNOW data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {snowTask && (
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-400">
              ServiceNow â€” {snowVal(snowTask.number)}
              <span className="text-gray-600 ml-1">({snowVal(snowTask.state)})</span>
            </p>
            <a href={snowTaskUrl(snowVal(snowTask.number))} target="_blank" rel="noreferrer"
               className="text-altera-teal hover:text-white"><ExternalLink size={12} /></a>
          </div>
          <p className="text-sm text-gray-200">{snowVal(snowTask.short_description)}</p>
          {!!snowTask['_workNotes'] && (
            <Collapsible label="Work notes">
              <pre className="text-xs font-mono text-gray-400 whitespace-pre-wrap leading-relaxed max-h-64 overflow-auto">
                {JSON.stringify(snowTask['_workNotes'], null, 2)}
              </pre>
            </Collapsible>
          )}
          {snowVal(snowTask.close_notes) && (
            <Collapsible label="Close notes">
              <p className="text-xs text-gray-400 whitespace-pre-wrap">{snowVal(snowTask.close_notes)}</p>
            </Collapsible>
          )}
        </div>
      )}

      {/* â”€â”€ Phase 2: Attachments ledger â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {attachments && attachments.length > 0 && (
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 space-y-2">
          <p className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
            <Paperclip size={12} /> Attachments ({attachments.length})
          </p>
          <div className="space-y-1">
            {attachments.map((a, i) => (
              <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-gray-800 last:border-0">
                <span className="text-gray-300 font-mono truncate max-w-xs">{snowVal(a.file_name)}</span>
                <span className="text-gray-600 shrink-0 ml-2">{snowVal(a.content_type)}</span>
              </div>
            ))}
          </div>
          {artifactLedger && (
            <div className="text-xs text-gray-600 pt-1">
              Coverage: timeframe <span className={artifactLedger.coverageTimeframe === 'ok' ? 'text-emerald-400' : 'text-yellow-400'}>
                {artifactLedger.coverageTimeframe}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Workaround / dev notes from DA */}
      {fields['Allscripts.Field.WorkaroundInstructions'] && (
        <Collapsible label="Workaround instructions">
          <p className="text-xs text-gray-400 whitespace-pre-wrap">
            {String(fields['Allscripts.Field.WorkaroundInstructions'])}
          </p>
        </Collapsible>
      )}

      {/* ── Phase 3/4: Root Cause Analysis ───────────────────────────────── */}
      {session.status === 'ready' && product && (
        <AnalysisPanel session={session} onAnalysisComplete={onAnalysisComplete} />
      )}

      {/* ── Log Scan — download + grep SNOW attachments ─────────────────────── */}
      {session.status === 'ready' && snowTask && (
        <LogAnalysisPanel
          snowTask={snowTask}
          onResult={(hits, topSeeds) => {
            // Store log evidence in snowTask so AI analysis can use it
            (snowTask as any)._logHits = hits;
            (snowTask as any)._topSeeds = topSeeds;
          }}
        />
      )}
    </div>
  );
}

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <span className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-gray-300">
      <span className="text-gray-500">{label}: </span>{value}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-gray-500">{label}: </span>
      <span className="text-gray-200">{value}</span>
    </div>
  );
}

function Collapsible({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="flex items-center gap-1 cursor-pointer text-xs text-gray-500 hover:text-gray-300 select-none list-none">
        <ChevronDown size={12} className="group-open:rotate-180 transition-transform" />
        {label}
      </summary>
      <div className="mt-2 pl-4">{children}</div>
    </details>
  );
}

