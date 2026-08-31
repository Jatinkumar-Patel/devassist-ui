import { ExternalLink, GitBranch, Package, AlertTriangle, Paperclip, ChevronDown } from 'lucide-react';
import type { TriageSession, TriageAnalysis } from '../types';
import { workItemUrl } from '../lib/ado-client';
import { snowTaskUrl, snowVal } from '../lib/snow-client';
import AnalysisPanel from './AnalysisPanel';
import LogAnalysisPanel from './LogAnalysisPanel';
import { useSettingsStore } from '../store/settings';

// Phase label for the progress indicator
const PHASE_LABELS: Record<string, string> = {
  preflight: 'Preflight check...',
  reading:   'Reading DA from ADO...',
  routing:   'Routing to product...',
  snow:      'Fetching SNOW data...',
  clarity:   'Clarity check...',
  artifacts: 'Scanning logs...',
  analysis:  'Running root cause analysis...',
  done:      'Done',
};

interface Props {
  session: TriageSession;
  onAnalysisComplete: (analysis: TriageAnalysis) => void;
}

function isLocalBridgeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function friendlyErrorMessage(error: string, bridgeUrl: string): string {
  if (/Failed to fetch|NetworkError|Load failed/i.test(error)) {
    if (window.location.protocol === 'https:' && isLocalBridgeUrl(bridgeUrl)) {
      return 'Secure Connector is not available from this page. Open DevAssist from your desktop launch and retry.';
    }
    return 'Secure Connector is not running. Open Settings, run one-time setup, then retry.';
  }
  return error;
}

export default function TriagePanel({ session, onAnalysisComplete }: Props) {
  const bridgeUrl = useSettingsStore((s) => s.bridgeUrl);
  const { adoItem, snowTask, product, error, currentPhase, clarityGaps, attachments, artifactLedger } = session;
  if (error) {
    const message = friendlyErrorMessage(error, bridgeUrl);
    const isAuthError = /\b401\b|Authentication failed/i.test(message);

    return (
      <div className="rounded-lg border border-red-800 bg-red-950/30 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-red-300 text-sm">{message}</p>
        </div>
        <div className="flex flex-wrap gap-2 pl-7">
          {isAuthError ? (
            <a
              href="#/settings"
              className="text-xs px-3 py-1.5 rounded-md border border-red-600/70 text-red-100 hover:bg-red-900/40"
            >
              Open Settings to update PAT
            </a>
          ) : (
            <a
              href="#/settings"
              className="text-xs px-3 py-1.5 rounded-md border border-gray-600 text-gray-200 hover:bg-gray-800"
            >
              Open Settings
            </a>
          )}
          <button
            onClick={() => window.location.reload()}
            className="text-xs px-3 py-1.5 rounded-md border border-gray-600 text-gray-200 hover:bg-gray-800"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Show phase progress while loading
  if (session.status === 'loading') {
    const label = PHASE_LABELS[currentPhase] ?? currentPhase;
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-altera-teal">
          <div className="w-3 h-3 rounded-full border-2 border-altera-teal border-t-transparent animate-spin" />
          {label}
        </div>
        <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
          <div className="h-1 bg-altera-teal rounded-full w-1/3 transition-all animate-pulse" />
        </div>
      </div>
    );
  }

  const fields = adoItem?.fields;
  const snowNum = fields?.['Allscripts.Field.IncidentTaskID'];

  return (
    <div className="space-y-4">
      {/* Compact header */}
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-3">
        {adoItem && fields ? (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <span className="text-xs text-gray-500 font-mono">
                  {fields['System.WorkItemType']} #{adoItem.id}
                  {snowNum && (
                    <>
                      {' · '}
                      <a href={snowTaskUrl(String(snowNum))} target="_blank" rel="noreferrer"
                         className="text-altera-teal hover:text-white">{String(snowNum)}</a>
                      {session.snowTaskTable && <span className="text-gray-600 ml-1">({session.snowTaskTable})</span>}
                    </>
                  )}
                </span>
                <h2 className="text-gray-100 font-semibold mt-0.5 leading-snug text-sm">
                  {fields['System.Title']}
                </h2>
              </div>
              <a href={workItemUrl(adoItem.id)} target="_blank" rel="noreferrer"
                 className="text-altera-teal hover:text-white shrink-0 mt-1">
                <ExternalLink size={13} />
              </a>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs mt-2">
              <Badge label="State" value={fields['System.State']} />
              {fields['Allscripts.Field.SupportVersion'] && <Badge label="Release" value={String(fields['Allscripts.Field.SupportVersion'])} />}
              {!!fields['Allscripts.Field.ReportedinRelease'] && <Badge label="Reported In" value={String(fields['Allscripts.Field.ReportedinRelease'])} />}
              {fields['Allscripts.Field.CustomerName']   && <Badge label="Customer" value={String(fields['Allscripts.Field.CustomerName'])} />}
              {fields['Microsoft.VSTS.Common.Severity']  && <Badge label="Sev" value={String(fields['Microsoft.VSTS.Common.Severity'])} />}
              {product && <Badge label="Product" value={product.displayName} />}
              {clarityGaps !== undefined && (
                clarityGaps.length === 0
                  ? <span className="bg-emerald-950 border border-emerald-800 rounded px-2 py-0.5 text-emerald-300">Clarity OK</span>
                  : <span className="bg-yellow-950 border border-yellow-800 rounded px-2 py-0.5 text-yellow-300">Gaps: {clarityGaps.length}</span>
              )}
            </div>
            {(() => {
              const title = fields['System.Title'] ?? '';
              const ids = [...title.matchAll(/\b(CS\d{5,}|KB\d{4,}|PRB\d{5,}|INC\d{6,}|DA[-\s]?\d{6,})\b/gi)].map(m => m[1]);
              if (!ids.length) return null;
              return (
                <div className="flex flex-wrap gap-1 text-xs mt-1.5">
                  <span className="text-gray-500">Linked:</span>
                  {ids.map(id => (
                    <span key={id} className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 font-mono text-altera-teal">{id}</span>
                  ))}
                </div>
              );
            })()}
            {session.selectedReportedReleases && session.selectedReportedReleases.length > 0 && (
              <div className="flex flex-wrap gap-1 text-xs mt-1.5">
                <span className="text-gray-500">Release Filter:</span>
                {session.selectedReportedReleases.map((release) => (
                  <span key={release} className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 font-mono text-cyan-300">{release}</span>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="min-w-0">
              <span className="text-xs text-gray-500 font-mono">
                SNOW {session.inputType} · {session.inputRaw}
              </span>
              <h2 className="text-gray-100 font-semibold mt-0.5 leading-snug text-sm">
                {snowVal((session.snowTask as any)?.short_description)
                  || snowVal((session.snowIncident as any)?.short_description)
                  || snowVal((session.snowCase as any)?.short_description)
                  || 'SNOW session loaded'}
              </h2>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs mt-2">
              {session.snowTask && <Badge label="Task" value={snowVal((session.snowTask as any).number)} />}
              {session.snowIncident && <Badge label="Incident" value={snowVal((session.snowIncident as any).number)} />}
              {session.snowCase && <Badge label="Case" value={snowVal((session.snowCase as any).number)} />}
              {product && <Badge label="Product" value={product.displayName} />}
            </div>
          </>
        )}
      </div>

      {/* SNOW chain — Task → Incident → Case, always visible when any SNOW data present */}
      {(session.snowTask || session.snowIncident || session.snowCase) && session.status === 'ready' && (
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-400 mb-1">SNOW chain</p>
          {session.snowTask && (
            <SnowRecord
              label="Task"
              record={session.snowTask as any}
              tableUrl={snowTaskUrl(snowVal((session.snowTask as any).number))}
            />
          )}
          {session.snowIncident && (
            <SnowRecord
              label="Incident"
              record={session.snowIncident as any}
              tableUrl={snowTaskUrl(snowVal((session.snowIncident as any).number))}
            />
          )}
          {session.snowCase && (
            <SnowRecord
              label="Case"
              record={session.snowCase as any}
              tableUrl={snowTaskUrl(snowVal((session.snowCase as any).number))}
            />
          )}
        </div>
      )}

      {/* ROOT CAUSE ANALYSIS — primary section */}
      {session.status === 'ready' && adoItem && product && (
        <AnalysisPanel session={session} onAnalysisComplete={onAnalysisComplete} />
      )}

      {/* Log Scan — always show; manual sysId entry if SNOW task not auto-fetched */}
      {session.status === 'ready' && (
        <LogAnalysisPanel
          snowTask={snowTask ?? null}
          snowIncident={session.snowIncident as any}
          snowCase={session.snowCase as any}
          snowTaskNumber={session.snowTaskNumber ?? snowVal((snowTask as any)?.number)}
          autoResult={(snowTask as any)?._logAnalysis ?? null}
          onResult={(hits, topSeeds) => {
            if (snowTask) {
              (snowTask as any)._logHits = hits;
              (snowTask as any)._topSeeds = topSeeds;
            }
          }}
        />
      )}

      {/* Clarity gaps (if any) */}
      {clarityGaps !== undefined && clarityGaps.length > 0 && (
        <div className="rounded-lg border border-yellow-800/60 bg-yellow-950/20 p-3">
          <div className="flex items-center gap-1.5 font-medium mb-1.5 text-sm">
            <AlertTriangle size={13} className="text-yellow-400" />
            <span className="text-yellow-300">Info gaps ({clarityGaps.length}) — ask customer</span>
          </div>
          {clarityGaps.map((g, i) => (
            <p key={i} className="text-xs text-yellow-200 ml-5">• {g}</p>
          ))}
        </div>
      )}

      {/* Raw evidence — collapsed */}
      <details className="group">
        <summary className="flex items-center gap-2 cursor-pointer select-none list-none rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-400 hover:text-gray-200">
          <ChevronDown size={13} className="group-open:rotate-180 transition-transform" />
          Raw evidence — SNOW / TFS / Attachments
          {snowTask && <span className="text-gray-600 ml-1">({snowVal(snowTask.number)})</span>}
        </summary>
        <div className="mt-2 space-y-3 pl-1">

          {product ? (
            <div className="rounded-lg border border-altera-blue/30 bg-altera-blue/5 p-3 space-y-2">
              <div className="flex items-center gap-2 text-altera-teal text-xs font-medium">
                <Package size={12} /> {product.displayName} — {product.snowProduct}
              </div>
              <InfoRow label="Task table" value={product.snowTaskTable} />
              <div className="flex flex-wrap gap-x-3">
                {product.repos.map((r) => (
                  <a key={r.key} href={`https://github.com/${r.owner}/${r.repo}`}
                     target="_blank" rel="noreferrer"
                     className="flex items-center gap-1 text-xs text-altera-teal hover:text-white">
                    <GitBranch size={10} />{r.owner}/{r.repo}
                  </a>
                ))}
              </div>
            </div>
          ) : adoItem ? (
            <div className="rounded-lg border border-yellow-800/50 bg-yellow-950/20 p-3 text-xs text-yellow-300">
              No product match for "{fields?.['System.AreaPath']}"
            </div>
          ) : null}

          {snowTask && (
            <div className="rounded-lg border border-gray-700 bg-gray-900 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-400">
                  SNOW {snowVal(snowTask.number)} <span className="text-gray-600">({snowVal(snowTask.state)})</span>
                </p>
                <a href={snowTaskUrl(snowVal(snowTask.number))} target="_blank" rel="noreferrer"
                   className="text-altera-teal hover:text-white"><ExternalLink size={11} /></a>
              </div>
              <p className="text-xs text-gray-300">{snowVal(snowTask.short_description)}</p>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {snowVal(snowTask.priority)    && <Badge label="Priority" value={snowVal(snowTask.priority)} />}
                {snowVal(snowTask.assigned_to) && <Badge label="Assigned" value={snowVal(snowTask.assigned_to)} />}
                {snowVal(snowTask.opened_at)   && <Badge label="Opened"   value={snowVal(snowTask.opened_at).slice(0,10)} />}
                {snowVal(snowTask.company)     && <Badge label="Company"  value={snowVal(snowTask.company)} />}
                {snowVal((snowTask as any).u_task_type) && <Badge label="Task type" value={snowVal((snowTask as any).u_task_type)} />}
                {snowVal((snowTask as any).u_devid)     && <Badge label="Dev ID"    value={snowVal((snowTask as any).u_devid)} />}
              </div>
              {snowVal((snowTask as any).description) && (
                <Collapsible label="SNOW Description">
                  <p className="text-xs text-gray-400 whitespace-pre-wrap">{snowVal((snowTask as any).description).slice(0, 800)}</p>
                </Collapsible>
              )}
              {snowVal((snowTask as any).u_steps_to_reproduce) && (
                <Collapsible label="Steps to reproduce">
                  <p className="text-xs text-gray-400 whitespace-pre-wrap">{snowVal((snowTask as any).u_steps_to_reproduce)}</p>
                </Collapsible>
              )}
              {snowVal((snowTask as any).u_dev_assist_detail) && (
                <Collapsible label="Dev assist detail">
                  <p className="text-xs text-gray-400 whitespace-pre-wrap">{snowVal((snowTask as any).u_dev_assist_detail)}</p>
                </Collapsible>
              )}
              {snowVal(snowTask.close_notes) && (
                <Collapsible label="Close notes">
                  <p className="text-xs text-gray-400 whitespace-pre-wrap">{snowVal(snowTask.close_notes)}</p>
                </Collapsible>
              )}
            </div>
          )}

          {adoItem && fields && (fields['System.Description'] || fields['Allscripts.Field.DevAssistDetail'] || fields['Allscripts.Field.WorkaroundInstructions']) && (
            <div className="rounded-lg border border-gray-700 bg-gray-900 p-3 space-y-2">
              <p className="text-xs font-medium text-gray-500">TFS fields</p>
              {fields['System.Description'] && (
                <Collapsible label="Description">
                  <p className="text-xs text-gray-400 whitespace-pre-wrap">
                    {String(fields['System.Description']).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600)}
                  </p>
                </Collapsible>
              )}
              {fields['Allscripts.Field.DevAssistDetail'] && (
                <Collapsible label="DevAssist Detail">
                  <p className="text-xs text-gray-400 whitespace-pre-wrap">{String(fields['Allscripts.Field.DevAssistDetail']).slice(0, 600)}</p>
                </Collapsible>
              )}
              {fields['Allscripts.Field.WorkaroundInstructions'] && (
                <Collapsible label="Workaround">
                  <p className="text-xs text-gray-400 whitespace-pre-wrap">{String(fields['Allscripts.Field.WorkaroundInstructions'])}</p>
                </Collapsible>
              )}
            </div>
          )}

          {attachments && attachments.length > 0 && (
            <div className="rounded-lg border border-gray-700 bg-gray-900 p-3 space-y-1">
              <p className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
                <Paperclip size={11} /> Attachments ({attachments.length})
              </p>
              {attachments.map((a, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-0.5 border-b border-gray-800 last:border-0">
                  <span className="text-gray-300 font-mono truncate max-w-xs">{snowVal(a.file_name)}</span>
                  <span className="text-gray-600 shrink-0 ml-2">{snowVal(a.content_type)}</span>
                </div>
              ))}
              {artifactLedger && (
                <div className="text-xs text-gray-600 pt-1">
                  Coverage: <span className={artifactLedger.coverageTimeframe === 'ok' ? 'text-emerald-400' : 'text-yellow-400'}>
                    {artifactLedger.coverageTimeframe}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function SnowRecord({ label, record, tableUrl }: { label: string; record: any; tableUrl: string }) {
  const num   = snowVal(record.number);
  const state = snowVal(record.state);
  const desc  = snowVal(record.short_description);
  const fullDesc = snowVal(record.description);
  const priority = snowVal(record.priority);
  const assignedTo = snowVal(record.assigned_to);
  const openedAt = snowVal(record.opened_at)?.slice(0, 10);

  // Work notes: comes back as array of note objects or raw string
  const rawNotes = record._workNotes;
  const noteLines: string[] = [];
  if (rawNotes) {
    if (Array.isArray(rawNotes)) {
      for (const n of rawNotes.slice(0, 10)) {
        const who = snowVal(n.created_by ?? n.sys_created_by ?? '');
        const when = snowVal(n.sys_created_on ?? n.created_on ?? '').slice(0, 10);
        const value = snowVal(n.value ?? n.work_notes ?? n.comments ?? '');
        if (value) noteLines.push(`[${when}] ${who}: ${value.slice(0, 200)}`);
      }
    } else if (typeof rawNotes === 'string') {
      noteLines.push(...rawNotes.split('\n').filter(Boolean).slice(0, 10));
    } else if (typeof rawNotes === 'object') {
      const entries = Object.entries(rawNotes as object).slice(0, 6);
      for (const [k, v] of entries) {
        noteLines.push(`${k}: ${String(v).slice(0, 150)}`);
      }
    }
  }

  return (
    <div className="rounded border border-gray-800 bg-gray-950/50 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</span>
          <span className="font-mono text-xs text-altera-teal">{num}</span>
          {state  && <span className="text-[11px] text-gray-400 bg-gray-800 rounded px-1.5">{state}</span>}
          {priority && <span className="text-[11px] text-yellow-400 bg-yellow-950/40 border border-yellow-900/50 rounded px-1.5">P{priority}</span>}
          {assignedTo && <span className="text-[11px] text-gray-500">{assignedTo}</span>}
          {openedAt   && <span className="text-[11px] text-gray-600">{openedAt}</span>}
        </div>
        <a href={tableUrl} target="_blank" rel="noreferrer" className="text-altera-teal hover:text-white shrink-0">
          <ExternalLink size={11} />
        </a>
      </div>
      {desc && <p className="text-xs text-gray-300">{desc}</p>}
      {fullDesc && fullDesc !== desc && (
        <Collapsible label="Full description">
          <p className="text-xs text-gray-400 whitespace-pre-wrap">{fullDesc.slice(0, 800)}</p>
        </Collapsible>
      )}
      {noteLines.length > 0 && (
        <Collapsible label={`Work notes (${noteLines.length})`}>
          <div className="space-y-1">
            {noteLines.map((n, i) => (
              <p key={i} className="text-xs text-gray-400 whitespace-pre-wrap border-b border-gray-800 pb-1 last:border-0">{n}</p>
            ))}
          </div>
        </Collapsible>
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

