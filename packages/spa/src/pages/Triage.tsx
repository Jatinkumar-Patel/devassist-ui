import { useState, useCallback } from 'react';
import TriageInput from '../components/TriageInput';
import TriagePanel from '../components/TriagePanel';
import { detectInput } from '../lib/input-detector';
import { loadRegistry, routeByAreaPath } from '../lib/product-registry';
import { fetchWorkItem } from '../lib/ado-client';
import { fetchSnowTask, fetchSnowWorkNotes, fetchSnowAttachments, fetchSnowCase, fetchSnowIncident, snowVal } from '../lib/snow-client';
import { matchPattern, runCodeSearch, buildSkillDrivenAssessment } from '../lib/analysis';
import { fetchRelatedBugs, fetchTestCases } from '../lib/ado-client';
import { searchCommits } from '../lib/github-client';
import { useSettingsStore } from '../store/settings';
import { useTriageStore } from '../store/triage';
import { getBridgeInstallCommands } from '../lib/bridge-install';
import type { TriageSession, SessionPhase, Product } from '../types';

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

function isLocalBridgeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function bridgeHelpMessage(bridgeUrl: string): string {
  if (window.location.protocol === 'https:' && isLocalBridgeUrl(bridgeUrl)) {
    return `Cannot reach local bridge (${bridgeUrl}) from HTTPS due browser security. Open the app from bridge URL ${bridgeUrl} and retry.`;
  }
  return `Bridge is unreachable at ${bridgeUrl}. Start bridge from Settings using the one-command setup, then retry.`;
}

async function ensureBridgeReachable(bridgeUrl: string): Promise<void> {
  try {
    const res = await fetch(`${bridgeUrl}/api/status`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error('Bridge status endpoint returned non-OK');
  } catch {
    throw new Error(bridgeHelpMessage(bridgeUrl));
  }
}

function toUserFacingError(err: unknown, bridgeUrl: string): string {
  const message = err instanceof Error ? err.message : String(err);

  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return bridgeHelpMessage(bridgeUrl);
  }
  if (/\b401\b/.test(message)) {
    return 'Authentication failed (401). Update your Azure DevOps PAT in Settings and retry.';
  }
  if (/\b403\b/.test(message)) {
    return 'Access denied (403). Verify PAT scopes (Work Items Read, Code Read) and permissions.';
  }
  return message;
}

function buildSelectedScope(selectedProducts: Product[]): Product | undefined {
  if (selectedProducts.length === 0) return undefined;
  if (selectedProducts.length === 1) return selectedProducts[0];

  const repoMap = new Map<string, Product['repos'][number]>();
  selectedProducts.forEach((p) => {
    p.repos.forEach((r) => {
      const key = `${r.owner}/${r.repo}`.toLowerCase();
      if (!repoMap.has(key)) repoMap.set(key, r);
    });
  });

  const primary = selectedProducts[0];
  const allPrefixes = selectedProducts
    .flatMap((p) => [p.areaPathPrefix, ...(p.areaPathPrefixes ?? [])])
    .filter(Boolean);

  return {
    id: `selected-${selectedProducts.map((p) => p.id).join('-')}`,
    displayName: `${selectedProducts.length} selected products`,
    areaPathPrefix: primary.areaPathPrefix,
    areaPathPrefixes: Array.from(new Set(allPrefixes)),
    snowProduct: selectedProducts.map((p) => p.snowProduct).join(' / '),
    snowTaskTable: primary.snowTaskTable,
    repos: Array.from(repoMap.values()),
    mtmPlans: selectedProducts.flatMap((p) => p.mtmPlans),
    skillPaths: selectedProducts.flatMap((p) => p.skillPaths ?? []),
    notes: `User-selected scope: ${selectedProducts.map((p) => p.displayName).join(', ')}`,
  };
}

export default function TriagePage() {
  const { adoPat, githubPat, bridgeUrl } = useSettingsStore();
  const { sessions, active, upsert } = useTriageStore();
  const installCmds = getBridgeInstallCommands();
  const [quickStartOpen, setQuickStartOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem('devassist-quickstart-open');
    return saved !== '0';
  });
  const [loading, setLoading] = useState(false);

  const toggleQuickStart = () => {
    setQuickStartOpen((prev) => {
      const next = !prev;
      localStorage.setItem('devassist-quickstart-open', next ? '1' : '0');
      return next;
    });
  };

  const activeSession = sessions.find((s) => s.id === active);

  const handleSubmit = useCallback(async (raw: string, selectedProductIds: string[]) => {
    if (!adoPat) {
      alert('Set your Azure DevOps PAT in Settings first.');
      return;
    }
    setLoading(true);
    let s = newSession(raw);
    upsert(s);

    try {
      await ensureBridgeReachable(bridgeUrl);

      const registry = await loadRegistry();
      const selectedProducts = selectedProductIds.length > 0
        ? registry.products.filter((p) => selectedProductIds.includes(p.id))
        : [];
      const selectedScope = buildSelectedScope(selectedProducts);
      if (selectedScope) {
        s = { ...s, product: selectedScope };
        upsert(s);
      }

      // ── Phase 0c: Read DA from ADO ───────────────────────────────────────────
      if (s.workItemId) {
        s = phase(s, 'reading');
        upsert(s);
        const adoItem = await fetchWorkItem(s.workItemId!, adoPat);
        const areaPath = adoItem.fields['System.AreaPath'] ?? '';
        const autoProduct = routeByAreaPath(areaPath, registry, adoItem.fields['System.Title']);
        const product = selectedScope ?? autoProduct;
        s = { ...s, adoItem, product };

        // ── Phase 0d: Route + derive SNOW task number from DA field ───────────
        s = phase(s, 'routing');
        upsert(s);
        const taskNum = adoItem.fields['Allscripts.Field.IncidentTaskID'] as string | undefined;
        if (taskNum) s = { ...s, snowTaskNumber: taskNum };

        // ── Fetch repo/MTM comparison data in parallel with SNOW ──────────────
        const routedProduct = s.product;
        if (routedProduct) {
          const [relatedBugs, testCases] = await Promise.allSettled([
            fetchRelatedBugs(areaPath, adoPat),
            fetchTestCases(areaPath, adoPat),
          ]);
          if (relatedBugs.status === 'fulfilled') s = { ...s, relatedItems: relatedBugs.value };
          if (testCases.status === 'fulfilled')   s = { ...s, testCases: testCases.value };
          // GitHub recent commits for primary repos
          if (githubPat && routedProduct.repos.length) {
            const repo = routedProduct.repos.find(r => r.required);
            if (repo) {
              const keywords = [
                adoItem.fields['System.Title']?.split(' ').slice(0, 4).join(' ') ?? '',
                routedProduct.displayName,
              ].filter(Boolean);
              const commits = await searchCommits(githubPat, `${repo.owner}/${repo.repo}`, keywords).catch(() => []);
              if (commits.length) s = { ...s, recentCommits: commits };
            }
          }
          upsert(s);
        }
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
            const [notesResp, attachResp] = await Promise.allSettled([
              fetchSnowWorkNotes(sysId),
              fetchSnowAttachments(sysId),
            ]);
            if (notesResp.status === 'fulfilled' && notesResp.value?.result) {
              s = { ...s, snowTask: { ...s.snowTask!, _workNotes: notesResp.value.result } };
            }
            if (attachResp.status === 'fulfilled' && attachResp.value?.result) {
              const attachments = Array.isArray(attachResp.value.result)
                ? attachResp.value.result
                : [attachResp.value.result];
              s = { ...s, attachments };
            }

            // ── Escalation: Task → Incident → Case (per snow-viewer-api.md) ───
            // Escalate if the task has a linked incident field
            const incidentSysId = snowVal(taskRecord?.['incident']);
            if (incidentSysId && incidentSysId !== '0') {
              try {
                const incResp = await fetchSnowIncident(incidentSysId);
                const incRecord = Array.isArray(incResp?.result) ? incResp.result[0] : incResp?.result;
                if (incRecord) s = { ...s, snowIncident: incRecord };
              } catch { /* non-fatal */ }
            }

            // Also fetch the Case directly from DA's CaseId field
            const caseId = s.adoItem?.fields['Allscripts.Field.CaseId'] as string | undefined;
            if (caseId) {
              try {
                const caseResp = await fetchSnowCase(caseId);
                const caseRecord = Array.isArray(caseResp?.result) ? caseResp.result[0] : caseResp?.result;
                if (caseRecord) s = { ...s, snowCase: caseRecord };
              } catch { /* non-fatal */ }
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

      // ── Phase 2: Auto log scan — download + grep SNOW attachments ────────────
      const snowSysId = s.snowTask ? snowVal(s.snowTask.sys_id) : '';
      if (snowSysId) {
        s = phase(s, 'artifacts');
        upsert(s);
        try {
          const logResp = await fetch(`${bridgeUrl}/api/log-analysis/${snowSysId}`);
          if (logResp.ok) {
            const logData = await logResp.json();
            // Store log hits on the snowTask so AnalysisPanel and AI can use them
            s = {
              ...s,
              snowTask: {
                ...s.snowTask!,
                _logHits: logData.hits ?? [],
                _topSeeds: logData.topSeeds ?? {},
                _logAnalysis: logData,
              },
            };
          }
        } catch { /* bridge offline — non-fatal */ }
      }

      // ── Phase 3/4: Auto root cause analysis ──────────────────────────────────
      s = phase(s, 'analysis');
      upsert(s);
      if (s.adoItem && s.product) {
        try {
          const pattern = matchPattern(s.adoItem);
          const codeHits = pattern && githubPat
            ? await runCodeSearch(githubPat, s.product, pattern)
            : [];
          const workNotes = s.snowTask
            ? String((s.snowTask as any)._workNotes
                ? JSON.stringify((s.snowTask as any)._workNotes)
                : snowVal(s.snowTask.work_notes))
            : undefined;
          const logHits = (s.snowTask as any)?._logHits ?? [];
          const topSeeds = (s.snowTask as any)?._topSeeds ?? {};
          // Use skill-driven analysis — reads skill files, derives verdict from SNOW evidence
          const analysis = await buildSkillDrivenAssessment(s.adoItem, s.product, workNotes, logHits, topSeeds, codeHits);
          s = { ...s, analysis };
        } catch { /* non-fatal */ }
      }

      upsert({ ...s, currentPhase: 'done', status: 'ready' });
    } catch (err: any) {
      upsert({ ...s, status: 'error', error: toUserFacingError(err, bridgeUrl) });
    } finally {
      setLoading(false);
    }
  }, [adoPat, bridgeUrl, githubPat, upsert]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5 sm:gap-7 items-start">
      {/* Left: input + session list */}
      <aside className="space-y-5 xl:sticky xl:top-24">
        <div className="glass-panel rounded-2xl p-3 sm:p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">Quick Start (End Users)</h3>
            <button
              type="button"
              onClick={toggleQuickStart}
              className="text-xs px-2 py-1 rounded-md border border-white/20 text-gray-200 hover:bg-white/10"
            >
              {quickStartOpen ? 'Collapse' : 'Open'}
            </button>
          </div>
          {quickStartOpen && (
            <>
              <p className="text-xs text-gray-300">Run one command below and keep that terminal open:</p>
              <div className="text-xs font-mono text-cyan-200 bg-gray-950/70 border border-white/10 rounded-lg p-2 overflow-x-auto space-y-2">
                <p className="text-[11px] text-gray-400 font-sans">Command Prompt (cmd)</p>
                <p className="break-all">{installCmds.cmd}</p>
                <p className="text-[11px] text-gray-400 font-sans">PowerShell</p>
                <p className="break-all">{installCmds.powershell}</p>
              </div>
              <p className="text-xs text-gray-400">Then open:</p>
              <a
                href="https://jatinkumar-patel.github.io/devassist-ui/#/triage"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-cyan-300 hover:text-cyan-200 break-all"
              >
                https://jatinkumar-patel.github.io/devassist-ui/#/triage
              </a>
            </>
          )}
        </div>

        <TriageInput onSubmit={handleSubmit} loading={loading} />

        {sessions.length > 0 && (
          <div className="glass-panel rounded-2xl p-3 space-y-2">
            <p className="text-xs text-gray-400 px-1 font-medium">Recent</p>
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => useTriageStore.getState().setActive(s.id)}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-xs transition-colors border ${
                  s.id === active
                    ? 'bg-sky-600/20 border-sky-300/40 text-gray-100'
                    : 'border-white/10 text-gray-300 hover:bg-white/5 hover:text-gray-100'
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
      <section className="min-w-0">
        {activeSession ? (
          <TriagePanel
            session={activeSession}
            onAnalysisComplete={(analysis) =>
              upsert({ ...activeSession, analysis })
            }
          />
        ) : (
          <div className="glass-panel rounded-2xl p-8 sm:p-10 min-h-[340px] flex flex-col items-center justify-center text-center text-gray-300 space-y-3">
            <h2 className="text-xl sm:text-2xl font-semibold text-white">Start Smart Triage</h2>
            <p className="text-sm text-gray-300 max-w-xl">
              Select product scope on the left, enter a DA/SNOW/TFS identifier, then run Analyze to generate findings.
            </p>
            <p className="text-xs text-gray-400">Supports: DA 9358329 · INC1234567 · TASK0001234 · CS7654321 · 9358329</p>
          </div>
        )}
      </section>
    </div>
  );
}
