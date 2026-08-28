import { useState, useCallback, useEffect } from 'react';
import { ChevronDown, PanelLeftClose, PanelLeftOpen, ExternalLink } from 'lucide-react';
import TriageInput from '../components/TriageInput';
import TriagePanel from '../components/TriagePanel';
import { detectInput } from '../lib/input-detector';
import { loadRegistry, routeByAreaPath } from '../lib/product-registry';
import { fetchWorkItem, findWorkItemBySnowTask, findWorkItemByCase } from '../lib/ado-client';
import { fetchSnowTask, fetchSnowWorkNotes, fetchSnowAttachments, fetchSnowCase, fetchSnowIncident, fetchSnowIncidentByCase, fetchSnowTasksByIncident, escalateSnowTask, snowVal } from '../lib/snow-client';
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

function snowGapMessage(taskNumber: string | undefined, fetchError: string | undefined): string {
  if (!taskNumber) return 'SNOW task number missing in work item';
  if (!fetchError) return `SNOW task ${taskNumber} not fetched`;

  if (/Unable to connect|Failed to fetch|NetworkError|Load failed/i.test(fetchError)) {
    return `SNOW task ${taskNumber} not fetched — bridge is offline or blocked`;
  }
  if (/\b401\b|\b403\b|Access is denied|Unauthorized/i.test(fetchError)) {
    return `SNOW task ${taskNumber} not fetched — authorization/policy blocked bridge access`;
  }
  if (/\b404\b|not found/i.test(fetchError)) {
    return `SNOW task ${taskNumber} not found in SNOW task tables`;
  }

  return `SNOW task ${taskNumber} not fetched — ${fetchError.slice(0, 180)}`;
}

function buildSelectedScope(selectedProducts: Product[]): Product | undefined {
  if (selectedProducts.length === 0) return undefined;

  const normalizeSkillEntries = <T extends { role: 'primary' | 'secondary'; enabled?: boolean }>(entries: T[] | undefined, getKey: (entry: T) => string): T[] => {
    const ordered = (entries ?? [])
      .filter((entry) => entry.enabled !== false)
      .filter((entry) => getKey(entry).trim())
      .sort((a, b) => (a.role === b.role ? 0 : a.role === 'primary' ? -1 : 1));

    const seen = new Set<string>();
    return ordered.filter((entry) => {
      const key = getKey(entry).trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const normalizeProduct = (product: Product): Product => {
    const githubSkills = normalizeSkillEntries(product.githubSkills ?? (product.githubSkillPaths ?? []).map((path, index) => ({
      path,
      role: index === 0 ? 'primary' as const : 'secondary' as const,
      enabled: true,
    })), (x) => x.path);

    const localSkills = normalizeSkillEntries(product.localSkills ?? (product.skillPaths ?? []).map((path, index) => ({
      path,
      role: index === 0 ? 'primary' as const : 'secondary' as const,
      enabled: true,
    })), (x) => x.path);

    const pastedSkillMd = normalizeSkillEntries(product.pastedSkillMd ?? [], (x) => `${x.title}\n${x.content}`);

    return {
      ...product,
      githubSkills,
      githubSkillPaths: githubSkills.map((x) => x.path),
      localSkills,
      skillPaths: localSkills.map((x) => x.path),
      pastedSkillMd,
    };
  };

  if (selectedProducts.length === 1) return normalizeProduct(selectedProducts[0]);

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

  const githubSkillsOrdered = selectedProducts.flatMap((p) => normalizeProduct(p).githubSkills ?? []);
  const localSkillsOrdered = selectedProducts.flatMap((p) => normalizeProduct(p).localSkills ?? []);
  const pastedSkillMdOrdered = selectedProducts.flatMap((p) => normalizeProduct(p).pastedSkillMd ?? []);

  return {
    id: `selected-${selectedProducts.map((p) => p.id).join('-')}`,
    displayName: `${selectedProducts.length} selected products`,
    areaPathPrefix: primary.areaPathPrefix,
    areaPathPrefixes: Array.from(new Set(allPrefixes)),
    snowProduct: selectedProducts.map((p) => p.snowProduct).join(' / '),
    snowTaskTable: primary.snowTaskTable,
    repos: Array.from(repoMap.values()),
    mtmPlans: selectedProducts.flatMap((p) => p.mtmPlans),
    skillPaths: localSkillsOrdered.map((x) => x.path),
    localSkills: localSkillsOrdered,
    githubSkills: githubSkillsOrdered,
    githubSkillPaths: githubSkillsOrdered.map((x) => x.path),
    pastedSkillMd: pastedSkillMdOrdered,
    notes: `User-selected scope: ${selectedProducts.map((p) => p.displayName).join(', ')}`,
  };
}

function getIncidentCaseNumber(incident: any): string | undefined {
  const candidates = [
    snowVal(incident?.u_case_number),
    snowVal(incident?.u_customer_case),
    snowVal(incident?.['u_case_number.display_value']),
    snowVal(incident?.['u_customer_case.display_value']),
    snowVal(incident?.parent),
    snowVal(incident?.['parent.number']),
  ].filter(Boolean);

  return candidates.find((v) => /^CS\d+$/i.test(v));
}

function deriveSnowLinkedWorkItemId(...records: Array<any | undefined>): number | undefined {
  const candidateFields = [
    'u_devid',
    'u_dev_id',
    'u_vsts_id',
    'u_tfs_id',
    'u_work_item_id',
    'u_workitem_id',
    'u_tfs_workitem',
    'u_vsts_workitem',
    'u_da_number',
    'u_devassist_id',
  ];

  const tryParse = (value: string): number | undefined => {
    const normalized = value.trim().toUpperCase();
    const m = normalized.match(/(?:DA[-\s]?)?(\d{6,9})/);
    if (!m) return undefined;
    const id = parseInt(m[1], 10);
    return Number.isFinite(id) ? id : undefined;
  };

  for (const rec of records) {
    if (!rec) continue;

    for (const field of candidateFields) {
      const value = snowVal(rec[field]);
      if (!value) continue;
      const parsed = tryParse(value);
      if (parsed) return parsed;
    }

    const fromSummary = [snowVal(rec.short_description), snowVal(rec.description)]
      .map((v) => tryParse(v))
      .find(Boolean);
    if (fromSummary) return fromSummary;
  }

  return undefined;
}

function CopyableCommand({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="rounded-lg border border-white/10 bg-gray-950 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-white/5 border-b border-white/10">
        <span className="text-[11px] text-gray-400 font-medium font-sans">{label}</span>
        <button
          type="button"
          onClick={copy}
          className={`shrink-0 text-[11px] px-2.5 py-1 rounded font-medium font-sans transition-colors ${
            copied
              ? 'bg-emerald-700/60 text-emerald-200 border border-emerald-600/50'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-200 border border-gray-600'
          }`}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <div className="relative">
        <pre className="px-3 py-2.5 text-xs text-cyan-300 font-mono overflow-x-auto whitespace-pre leading-relaxed">{value}</pre>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-gray-950 to-transparent" />
      </div>
    </div>
  );
}

function BridgeOfflineBanner({ installCmds, bridgeUrl }: { installCmds: ReturnType<typeof getBridgeInstallCommands>; bridgeUrl: string }) {
  const isHttps = window.location.protocol === 'https:';
  const [showManual, setShowManual] = useState(false);

  return (
    <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 space-y-3">
      <p className="text-sm text-amber-100 font-semibold">⚡ Bridge not running</p>

      {/* ── Recommended: register auto-start so this never happens again ── */}
      <div className="rounded-lg border border-emerald-700/60 bg-emerald-950/40 p-3 space-y-2">
        <p className="text-[11px] font-semibold text-emerald-300">Permanent fix — register bridge as Windows auto-start (do once, never see this again):</p>
        <div className="bg-gray-950/80 rounded-lg p-2 space-y-2 text-xs font-mono">
          {/* First-time install */}
          <CopyableCommand label="Step 1 — Install bridge once (PowerShell)" value={installCmds.powershell} />
          <CopyableCommand label="Step 2 — Register auto-start (PowerShell, run after Step 1)" value={installCmds.autoStartPowershell} />
        </div>
        <p className="text-[11px] text-gray-400">After Step 2: bridge auto-starts at Windows login. Just bookmark <span className="font-mono text-cyan-300">{installCmds.appUrl}</span></p>
      </div>

      {/* ── Manual daily start fallback ── */}
      <button
        type="button"
        onClick={() => setShowManual(v => !v)}
        className="text-[11px] text-amber-200/70 hover:text-amber-200 underline"
      >
        {showManual ? 'Hide' : 'Already installed? Just start it for today instead'}
      </button>
      {showManual && (
        <div className="bg-gray-950/70 rounded-lg border border-white/10 p-3 space-y-2 text-xs font-mono">
          <CopyableCommand label="Start today — PowerShell" value={installCmds.powershellDaily} />
          <CopyableCommand label="Start today — cmd" value={installCmds.cmdDaily} />
        </div>
      )}

      {isHttps && (
        <div className="space-y-1">
          <p className="text-[11px] text-amber-200/60">After bridge starts, open the app here (not GitHub Pages):</p>
          <a
            href={bridgeUrl}
            className="inline-flex items-center gap-2 bg-amber-500/20 border border-amber-500/60 hover:bg-amber-500/30 text-amber-100 px-4 py-2 rounded-lg text-sm font-medium w-full justify-center"
          >
            <ExternalLink size={14} />
            Open app at {bridgeUrl}
          </a>
        </div>
      )}
    </div>
  );
}

async function enrichSnowTaskArtifacts(s: TriageSession, taskRecord: any): Promise<TriageSession> {
  let next = { ...s, snowTask: taskRecord };
  const sysId = snowVal(taskRecord?.sys_id);
  if (!sysId) return next;

  const [notesResp, attachResp] = await Promise.allSettled([
    fetchSnowWorkNotes(sysId),
    fetchSnowAttachments(sysId),
  ]);

  if (notesResp.status === 'fulfilled' && notesResp.value?.result) {
    next = { ...next, snowTask: { ...next.snowTask!, _workNotes: notesResp.value.result } };
  }

  if (attachResp.status === 'fulfilled' && attachResp.value?.result) {
    const attachments = Array.isArray(attachResp.value.result)
      ? attachResp.value.result
      : [attachResp.value.result];
    next = { ...next, attachments };
  }

  return next;
}

export default function TriagePage() {
  const { adoPat, githubPat, bridgeUrl } = useSettingsStore();
  const { sessions, active, upsert } = useTriageStore();
  const installCmds = getBridgeInstallCommands();
  const [bridgeHint, setBridgeHint] = useState<string | null>(null);
  const [quickStartOpen, setQuickStartOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem('devassist-quickstart-open');
    return saved !== '0';
  });
  const [recentOpen, setRecentOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem('devassist-recent-open');
    return saved !== '0';
  });
  const [leftPaneHidden, setLeftPaneHidden] = useState<boolean>(() => {
    const saved = localStorage.getItem('devassist-left-pane-hidden');
    return saved === '1';
  });
  const [loading, setLoading] = useState(false);

  const toggleQuickStart = () => {
    setQuickStartOpen((prev) => {
      const next = !prev;
      localStorage.setItem('devassist-quickstart-open', next ? '1' : '0');
      return next;
    });
  };

  const toggleRecent = () => {
    setRecentOpen((prev) => {
      const next = !prev;
      localStorage.setItem('devassist-recent-open', next ? '1' : '0');
      return next;
    });
  };

  const toggleLeftPane = () => {
    setLeftPaneHidden((prev) => {
      const next = !prev;
      localStorage.setItem('devassist-left-pane-hidden', next ? '1' : '0');
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`${bridgeUrl}/api/status`, { signal: AbortSignal.timeout(2500) });
        if (!cancelled) setBridgeHint(res.ok ? null : bridgeHelpMessage(bridgeUrl));
      } catch {
        if (!cancelled) setBridgeHint(bridgeHelpMessage(bridgeUrl));
      }
    };
    check();
    return () => { cancelled = true; };
  }, [bridgeUrl]);

  const activeSession = sessions.find((s) => s.id === active);

  const handleSubmit = useCallback(async (raw: string, selectedProductIds: string[]) => {
    const preview = newSession(raw);

    setLoading(true);
    let s = preview;
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

            // Preferred path: use bridge escalation endpoint to fetch parent incident/case.
            try {
              const escalated = await escalateSnowTask(sysId);
              if (escalated.incident) s = { ...s, snowIncident: escalated.incident as any };
              if (escalated.case) s = { ...s, snowCase: escalated.case as any };
            } catch {
              // non-fatal fallback paths below
            }

            // ── Escalation: Task → Incident → Case (per snow-viewer-api.md) ───
            // Escalate if the task has a linked incident field
            const incidentSysId = snowVal(taskRecord?.['incident']);
            if (incidentSysId && incidentSysId !== '0') {
              try {
                const incResp = await fetchSnowIncident(incidentSysId);
                const incRecord = Array.isArray(incResp?.result) ? incResp.result[0] : incResp?.result;
                if (incRecord) {
                  s = { ...s, snowIncident: incRecord };
                  if (!s.snowCase) {
                    const caseNum = getIncidentCaseNumber(incRecord);
                    if (caseNum) {
                      try {
                        const caseResp = await fetchSnowCase(caseNum);
                        const caseRecord = Array.isArray(caseResp?.result) ? caseResp.result[0] : caseResp?.result;
                        if (caseRecord) s = { ...s, snowCase: caseRecord };
                      } catch { /* non-fatal */ }
                    }
                  }
                }
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
        } catch (e) {
          // Non-fatal degraded mode; capture real cause for user-facing clarity gaps.
          const fetchError = e instanceof Error ? e.message : String(e);
          s = { ...s, snowFetchError: fetchError };
        }
      }

      // ── SNOW-only path: direct INC input ────────────────────────────────────
      if (s.snowIncidentNumber) {
        const incidentNumber = s.snowIncidentNumber;
        s = phase(s, 'snow');
        upsert(s);
        try {
          const incResp = await fetchSnowIncident(incidentNumber);
          const incRecord = Array.isArray(incResp?.result) ? incResp.result[0] : incResp?.result;
          if (incRecord) {
            s = { ...s, snowIncident: incRecord };

            const incNum = snowVal(incRecord?.number) || incidentNumber;
            try {
              const taskResp = await fetchSnowTasksByIncident(incNum);
              const firstTask = Array.isArray(taskResp?.result) ? taskResp.result[0] : taskResp?.result;
              if (firstTask) {
                s = { ...s, snowTaskTable: taskResp?.table ?? s.snowTaskTable };
                s = await enrichSnowTaskArtifacts(s, firstTask);
                const taskNumber = snowVal(firstTask?.number);
                if (taskNumber) s = { ...s, snowTaskNumber: taskNumber };
              }
            } catch {
              // non-fatal degraded mode
            }

            const caseNum = getIncidentCaseNumber(incRecord);
            if (caseNum) {
              try {
                const caseResp = await fetchSnowCase(caseNum);
                const caseRecord = Array.isArray(caseResp?.result) ? caseResp.result[0] : caseResp?.result;
                if (caseRecord) s = { ...s, snowCase: caseRecord };
              } catch { /* non-fatal */ }
            }
          }
        } catch {
          // non-fatal degraded mode
        }
      }

      // ── SNOW-only path: direct CS input ─────────────────────────────────────
      if (s.snowCaseNumber) {
        const caseNumber = s.snowCaseNumber;
        s = phase(s, 'snow');
        upsert(s);
        try {
          const caseResp = await fetchSnowCase(caseNumber);
          const caseRecord = Array.isArray(caseResp?.result) ? caseResp.result[0] : caseResp?.result;
          if (caseRecord) {
            s = { ...s, snowCase: caseRecord };
            try {
              const incResp = await fetchSnowIncidentByCase(caseNumber);
              const incRecord = Array.isArray(incResp?.result) ? incResp.result[0] : incResp?.result;
              if (incRecord) {
                s = { ...s, snowIncident: incRecord };

                const incNum = snowVal(incRecord?.number);
                if (incNum) {
                  try {
                    const taskResp = await fetchSnowTasksByIncident(incNum);
                    const firstTask = Array.isArray(taskResp?.result) ? taskResp.result[0] : taskResp?.result;
                    if (firstTask) {
                      s = { ...s, snowTaskTable: taskResp?.table ?? s.snowTaskTable };
                      s = await enrichSnowTaskArtifacts(s, firstTask);
                      const taskNumber = snowVal(firstTask?.number);
                      if (taskNumber) s = { ...s, snowTaskNumber: taskNumber };
                    }
                  } catch {
                    // non-fatal degraded mode
                  }
                }
              }
            } catch {
              // non-fatal degraded mode
            }
          }
        } catch {
          // non-fatal degraded mode
        }
      }

      // ── Bridge from SNOW records back to DA/TFS for full analysis ──────────
      if (!s.adoItem && adoPat) {
        const hydrateFromAdoItem = async (adoItem: any): Promise<void> => {
          const areaPath = adoItem.fields['System.AreaPath'] ?? '';
          const autoProduct = routeByAreaPath(areaPath, registry, adoItem.fields['System.Title']);
          const product = s.product ?? autoProduct;
          s = { ...s, workItemId: adoItem.id, adoItem, product };

          s = phase(s, 'routing');
          upsert(s);

          const routedProduct = s.product;
          if (routedProduct) {
            const [relatedBugs, testCases] = await Promise.allSettled([
              fetchRelatedBugs(areaPath, adoPat),
              fetchTestCases(areaPath, adoPat),
            ]);
            if (relatedBugs.status === 'fulfilled') s = { ...s, relatedItems: relatedBugs.value };
            if (testCases.status === 'fulfilled') s = { ...s, testCases: testCases.value };
            if (githubPat && routedProduct.repos.length) {
              const repo = routedProduct.repos.find((r) => r.required);
              if (repo) {
                const keywords = [
                  adoItem.fields['System.Title']?.split(' ').slice(0, 4).join(' ') ?? '',
                  routedProduct.displayName,
                ].filter(Boolean);
                const commits = await searchCommits(githubPat, `${repo.owner}/${repo.repo}`, keywords).catch(() => []);
                if (commits.length) s = { ...s, recentCommits: commits };
              }
            }
          }
          upsert(s);
        };

        const linkedWorkItemId = deriveSnowLinkedWorkItemId(s.snowTask, s.snowIncident, s.snowCase);
        if (linkedWorkItemId) {
          try {
            s = phase(s, 'reading');
            upsert(s);
            const adoItem = await fetchWorkItem(linkedWorkItemId, adoPat);
            await hydrateFromAdoItem(adoItem);
          } catch {
            // non-fatal; keep SNOW-only output if DA lookup fails
          }
        }

        if (!s.adoItem && s.snowTaskNumber) {
          const taskNumber = s.snowTaskNumber;
          try {
            s = phase(s, 'reading');
            upsert(s);
            const adoItem = await findWorkItemBySnowTask(taskNumber, adoPat);
            if (adoItem) await hydrateFromAdoItem(adoItem);
          } catch {
            // non-fatal fallback
          }
        }

        if (!s.adoItem) {
          const caseNumber = s.snowCaseNumber || snowVal((s.snowCase as any)?.number);
          if (caseNumber) {
            try {
              s = phase(s, 'reading');
              upsert(s);
              const adoItem = await findWorkItemByCase(caseNumber, adoPat);
              if (adoItem) await hydrateFromAdoItem(adoItem);
            } catch {
              // non-fatal fallback
            }
          }
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
        if (!s.snowTask) gaps.push(snowGapMessage(s.snowTaskNumber, s.snowFetchError));
      }
      s = { ...s, clarityGaps: gaps };

      // ── Phase 2: Auto log scan — download + grep all SNOW attachments ──────
      // Run against TASK sysId first, then also INCIDENT + CASE sysIds
      // so attachments at any level of the chain are captured.
      const snowSysId        = s.snowTask     ? snowVal(s.snowTask.sys_id)          : '';
      const incidentSysId2   = s.snowIncident ? snowVal((s.snowIncident as any).sys_id) : '';
      const caseSysId2       = s.snowCase     ? snowVal((s.snowCase as any).sys_id)    : '';

      const sysIdsToScan = [...new Set([snowSysId, incidentSysId2, caseSysId2].filter(Boolean))];

      if (sysIdsToScan.length) {
        s = phase(s, 'artifacts');
        upsert(s);

        const allLogData: Record<string, any> = {};
        await Promise.allSettled(sysIdsToScan.map(async (sid) => {
          try {
            const logResp = await fetch(`${bridgeUrl}/api/log-analysis/${sid}`);
            if (logResp.ok) allLogData[sid] = await logResp.json();
          } catch { /* bridge offline — non-fatal */ }
        }));

        // Merge all hits — primary sysId first
        const primaryLogData = allLogData[snowSysId] ?? Object.values(allLogData)[0];
        const allHits = Object.values(allLogData).flatMap((d: any) => d.hits ?? []);
        const allTopSeeds: Record<string, number> = {};
        for (const d of Object.values(allLogData) as any[]) {
          for (const [k, v] of Object.entries(d.topSeeds ?? {})) {
            allTopSeeds[k] = ((allTopSeeds[k] ?? 0) as number) + (v as number);
          }
        }

        if (primaryLogData || allHits.length) {
          const mergedLogAnalysis = { ...primaryLogData, hits: allHits.slice(0, 200), topSeeds: allTopSeeds };
          s = {
            ...s,
            snowTask: s.snowTask ? {
              ...s.snowTask,
              _logHits: allHits,
              _topSeeds: allTopSeeds,
              _logAnalysis: mergedLogAnalysis,
            } : s.snowTask,
          };
        }

        // ── Update artifact ledger with real findings ─────────────────────────
        const hitsByFile: Record<string, string[]> = {};
        for (const h of allHits as any[]) {
          if (!hitsByFile[h.file]) hitsByFile[h.file] = [];
          hitsByFile[h.file].push(`[${h.category}] ${h.text.slice(0, 120)}`);
        }
        const analyzedFiles = s.attachments?.map((a) => {
          const fname = snowVal(a.file_name);
          const fileHits = hitsByFile[fname] ?? [];
          return {
            source: `TASK ${s.snowTaskNumber ?? ''}`,
            file: fname,
            type: snowVal(a.content_type),
            finding: fileHits.length
              ? `${fileHits.length} hit(s): ${fileHits.slice(0, 2).join(' | ').slice(0, 200)}`
              : 'No pattern matches',
          };
        }) ?? [];

        // Also add any files analyzed from incident/case that weren't in the task attachment list
        for (const [fname, hits] of Object.entries(hitsByFile)) {
          if (!analyzedFiles.find((a) => a.file === fname)) {
            analyzedFiles.push({
              source: 'INC/CS',
              file: fname,
              type: '',
              finding: `${hits.length} hit(s): ${hits.slice(0, 2).join(' | ').slice(0, 200)}`,
            });
          }
        }

        const totalHits = allHits.length;
        s = {
          ...s,
          artifactLedger: {
            analyzed: analyzedFiles,
            notAnalyzed: Object.values(allLogData).flatMap((d: any) => d.skipped ?? []),
            coverageTimeframe: totalHits > 0 ? `${totalHits} log matches across ${sysIdsToScan.length} record(s)` : analyzedFiles.length > 0 ? 'scanned — no matches' : 'no attachments',
            coverageSubject: totalHits > 0 ? `Errors: ${(allTopSeeds['ERROR'] ?? 0) + (allTopSeeds['FATAL'] ?? 0)} | Warnings: ${allTopSeeds['WARNING'] ?? 0} | Timeouts: ${allTopSeeds['Timeout'] ?? 0}` : 'no log hits',
          },
        };
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
    <div className="space-y-3">
      {bridgeHint && (
        <BridgeOfflineBanner installCmds={installCmds} bridgeUrl={bridgeUrl} />
      )}

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={toggleLeftPane}
          className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-cyan-400/70 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30 font-medium"
          aria-label={leftPaneHidden ? 'Show input pane' : 'Hide input pane'}
          title={leftPaneHidden ? 'Show input pane' : 'Hide input pane'}
        >
          {leftPaneHidden ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          {leftPaneHidden ? 'Show input pane' : 'Hide input pane'}
        </button>
      </div>

      <div className={`grid grid-cols-1 ${leftPaneHidden ? '' : 'xl:grid-cols-[420px_1fr]'} gap-5 sm:gap-7 items-start xl:h-[calc(100vh-10rem)] xl:overflow-hidden`}>
      {/* Left: input + session list */}
      <aside className={`${leftPaneHidden ? 'hidden' : 'space-y-5 xl:h-full xl:overflow-y-auto xl:pr-1'}`}>
        <div className="glass-panel rounded-2xl p-3 sm:p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">Quick Start (End Users)</h3>
            <button
              type="button"
              onClick={toggleQuickStart}
              className="text-xs px-2.5 py-1 rounded-md border border-cyan-400/70 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30 font-medium"
              aria-label={quickStartOpen ? 'Collapse quick start card' : 'Expand quick start card'}
            >
              <ChevronDown size={14} className={`transition-transform ${quickStartOpen ? '' : '-rotate-90'}`} />
            </button>
          </div>
          {quickStartOpen && (
            <>
              {isLocalBridgeUrl(bridgeUrl) ? (
                <>
                  <p className="text-xs text-gray-300 font-medium">New machine? Do these two steps once:</p>
                  <div className="bg-gray-950/70 border border-white/10 rounded-lg p-2 space-y-2 text-xs font-mono">
                    <CopyableCommand label="Step 1 — Install (PowerShell)" value={installCmds.powershell} />
                    <CopyableCommand label="Step 2 — Register auto-start (PowerShell, after Step 1)" value={installCmds.autoStartPowershell} />
                  </div>
                  <p className="text-[11px] text-emerald-300/80">After Step 2 — bridge starts automatically at every Windows login. No daily commands needed.</p>
                  <p className="text-[11px] text-gray-400">Bookmark this URL and share with your team:</p>
                </>
              ) : (
                <p className="text-xs text-gray-300">Managed bridge — end users only need the URL below.</p>
              )}
              <CopyableCommand label="App URL (bookmark this)" value={installCmds.appUrl} />
            </>
          )}
        </div>

        <TriageInput onSubmit={handleSubmit} loading={loading} />

        {sessions.length > 0 && (
          <div className="glass-panel rounded-2xl p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-gray-400 px-1 font-medium">Recent</p>
              <button
                type="button"
                onClick={toggleRecent}
                className="text-xs px-2.5 py-1 rounded-md border border-cyan-400/70 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30 font-medium"
                aria-label={recentOpen ? 'Collapse recent card' : 'Expand recent card'}
              >
                <ChevronDown size={14} className={`transition-transform ${recentOpen ? '' : '-rotate-90'}`} />
              </button>
            </div>
            {recentOpen && sessions.map((s) => (
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
      <section className="min-w-0 xl:h-full xl:overflow-y-auto xl:pr-1">
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
    </div>
  );
}
