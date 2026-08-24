import { useState, useCallback } from 'react';
import TriageInput from '../components/TriageInput';
import TriagePanel from '../components/TriagePanel';
import { detectInput } from '../lib/input-detector';
import { loadRegistry, routeByAreaPath } from '../lib/product-registry';
import { fetchWorkItem } from '../lib/ado-client';
import { fetchSnowTask, fetchSnowWorkNotes, fetchSnowAttachments, snowVal } from '../lib/snow-client';
import { useSettingsStore } from '../store/settings';
import { useTriageStore } from '../store/triage';
import type { TriageSession, SessionPhase } from '../types';

function newSession(raw: string): TriageSession {
  const { type, id } = detectInput(raw);
  return {
    id: crypto.randomUUID(),
    inputRaw: raw,
    inputType: type,
    currentPhase: 'preflight',
    workItemId: (type === 'DA' || type === 'TFS') ? parseInt(id, 10) : undefined,
    snowTaskNumber: type === 'TASK' ? id : undefined,
    snowIncidentNumber: type === 'INC' ? id : undefined,
    snowCaseNumber: type === 'CS' ? id : undefined,
    status: 'loading',
    startedAt: new Date().toISOString(),
  };
}

function phase(s: TriageSession, p: SessionPhase): TriageSession {
  return { ...s, currentPhase: p };
}

export default function TriagePage() {
  const { adoPat } = useSettingsStore();
  const { sessions, active, upsert } = useTriageStore();
  const [loading, setLoading] = useState(false);

  const activeSession = sessions.find((s) => s.id === active);

  const handleSubmit = useCallback(async (raw: string) => {
    if (!adoPat) {
      alert('Set your Azure DevOps PAT in Settings first.');
      return;
    }
    setLoading(true);
    let s = newSession(raw);
    upsert(s);

    try {
      const registry = await loadRegistry();

      // ── Phase 0c: Read DA from ADO ───────────────────────────────────────────
      if (s.workItemId) {
        s = phase(s, 'reading');
        upsert(s);
        const adoItem = await fetchWorkItem(s.workItemId!, adoPat);
        const areaPath = adoItem.fields['System.AreaPath'] ?? '';
        const product = routeByAreaPath(areaPath, registry);
        s = { ...s, adoItem, product };

        // ── Phase 0d: Route + derive SNOW task number from DA field ───────────
        s = phase(s, 'routing');
        upsert(s);
        const taskNum = adoItem.fields['Allscripts.Field.IncidentTaskID'] as string | undefined;
        if (taskNum) s = { ...s, snowTaskNumber: taskNum };
      }

      // ── Phase 0e: Pull SNOW task + work notes + attachments ──────────────────
      if (s.snowTaskNumber) {
        s = phase(s, 'snow');
        upsert(s);
        try {
          const taskResp = await fetchSnowTask(s.snowTaskNumber!);
          const taskRecord = Array.isArray(taskResp?.result) ? taskResp.result[0] : taskResp?.result;
          s = { ...s, snowTask: taskRecord, snowTaskTable: taskResp?.table };

          const sysId = snowVal(taskRecord?.sys_id);
          if (sysId) {
            // Fetch work notes separately (richer than embedded work_notes field)
            const [notesResp, attachResp] = await Promise.allSettled([
              fetchSnowWorkNotes(sysId),
              fetchSnowAttachments(sysId),
            ]);
            if (notesResp.status === 'fulfilled' && notesResp.value?.result) {
              // Merge work notes back into the task record for display
              s = { ...s, snowTask: { ...s.snowTask!, _workNotes: notesResp.value.result } };
            }
            if (attachResp.status === 'fulfilled' && attachResp.value?.result) {
              const attachments = Array.isArray(attachResp.value.result)
                ? attachResp.value.result
                : [attachResp.value.result];
              s = { ...s, attachments };
            }
          }
        } catch {
          // Bridge offline or VPN — non-fatal, mark as degraded
        }
      }

      // ── Phase 1: Clarity — derive gaps from missing required fields ──────────
      s = phase(s, 'clarity');
      upsert(s);
      const gaps: string[] = [];
      const f = s.adoItem?.fields;
      if (f) {
        if (!f['Allscripts.Field.SupportVersion']) gaps.push('Release/version not specified');
        if (!f['Allscripts.Field.CustomerName'])  gaps.push('Customer name missing');
        if (!f['System.Description'] && !f['Allscripts.Field.DevAssistDetail']) {
          gaps.push('Problem description empty — check Description and DevAssistDetail fields');
        }
        if (!s.snowTask) gaps.push('SNOW task not fetched — bridge offline or not on VPN');
      }
      s = { ...s, clarityGaps: gaps };

      // ── Phase 2+: Artifacts ledger (skeleton — full analysis is manual/AI) ───
      s = phase(s, 'artifacts');
      upsert(s);
      const analyzed = s.attachments?.map((a) => ({
        source: `TASK ${s.snowTaskNumber ?? ''}`,
        file: snowVal(a.file_name),
        type: snowVal(a.content_type),
        finding: '— pending review',
      })) ?? [];
      s = {
        ...s,
        artifactLedger: {
          analyzed,
          notAnalyzed: [],
          coverageTimeframe: analyzed.length > 0 ? 'pending review' : 'no attachments',
          coverageSubject: 'pending review',
        },
      };

      upsert({ ...s, currentPhase: 'done', status: 'ready' });
    } catch (err: any) {
      upsert({ ...s, status: 'error', error: err.message });
    } finally {
      setLoading(false);
    }
  }, [adoPat, upsert]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
      {/* Left: input + session list */}
      <aside className="space-y-4">
        <TriageInput onSubmit={handleSubmit} loading={loading} />

        {sessions.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-gray-600 px-1">Recent</p>
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => useTriageStore.getState().setActive(s.id)}
                className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                  s.id === active
                    ? 'bg-gray-800 text-gray-100'
                    : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono">{s.inputRaw}</span>
                  <span className={`text-[10px] ${
                    s.status === 'error' ? 'text-red-400' :
                    s.status === 'loading' ? 'text-yellow-400' :
                    'text-emerald-500'
                  }`}>
                    {s.inputType}
                  </span>
                </div>
                {s.adoItem && (
                  <p className="text-gray-600 truncate mt-0.5">
                    {s.adoItem.fields['System.Title']}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* Right: triage panel */}
      <section>
        {activeSession ? (
          <TriagePanel
            session={activeSession}
            onAnalysisComplete={(analysis) =>
              upsert({ ...activeSession, analysis })
            }
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-gray-600 text-sm space-y-2">
            <p>Paste a DA ID, SNOW number, or TFS work item ID above.</p>
            <p className="text-xs">Supports: DA 9358329 · INC1234567 · TASK0001234 · CS7654321 · 9358329</p>
          </div>
        )}
      </section>
    </div>
  );
}
