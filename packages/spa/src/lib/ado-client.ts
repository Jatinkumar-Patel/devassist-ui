import { bridgeApi } from './bridge-url';

const ADO_ORG = 'https://alm-prod-app1.rd.allscripts.com/tfs/boc_projects';
const API_VER = '7.0';

function adoHeaders(pat: string): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const trimmed = pat.trim();
  if (trimmed) {
    const token = btoa(`:${trimmed}`);
    headers.Authorization = `Basic ${token}`;
  }
  return headers;
}

export async function fetchWorkItem(id: number, pat: string) {
  const url = bridgeApi(`/api/ado/SR/_apis/wit/workitems/${id}?api-version=${API_VER}`);
  const res = await fetch(url, { headers: adoHeaders(pat) });
  if (!res.ok) throw new Error(`ADO ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function searchCode(
  pat: string,
  query: string,
  repos: string[]
): Promise<unknown> {
  // ADO code search REST endpoint
  const url = bridgeApi('/api/ado/_apis/search/codesearchresults?api-version=7.1-preview.1');
  const body = {
    searchText: query,
    $skip: 0,
    $top: 20,
    filters: { Project: ['SR'], Repository: repos },
    includeFacets: false,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: adoHeaders(pat),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ADO search ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function fetchMtmTestPlan(planId: number, pat: string) {
  const url = bridgeApi(`/api/ado/SR/_apis/testplan/plans/${planId}?api-version=${API_VER}`);
  const res = await fetch(url, { headers: adoHeaders(pat) });
  if (!res.ok) throw new Error(`MTM ${res.status}: ${await res.text()}`);
  return res.json();
}

export function workItemUrl(id: number): string {
  return `${ADO_ORG}/SR/_workitems/edit/${id}`;
}

export interface RelatedItem {
  id: number;
  title: string;
  state: string;
  type: string;
  url: string;
  supportVersion?: string;
  reportedRelease?: string;
  changedDate?: string;
}

async function runWiql(pat: string, query: string): Promise<number[]> {
  return runWiqlLimited(pat, query, 15);
}

async function runWiqlLimited(pat: string, query: string, limit: number): Promise<number[]> {
  const url = bridgeApi('/api/ado/SR/_apis/wit/wiql?api-version=7.0');
  const res = await fetch(url, {
    method: 'POST',
    headers: adoHeaders(pat),
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) return [];
  const data = await res.json() as { workItems?: Array<{ id: number }> };
  return (data.workItems ?? []).map(w => w.id).slice(0, limit);
}

async function fetchReleaseFieldBatch(ids: number[], pat: string): Promise<string[]> {
  if (!ids.length) return [];
  const url = bridgeApi(`/api/ado/SR/_apis/wit/workItems?ids=${ids.join(',')}&fields=Allscripts.Field.ReportedinRelease&api-version=7.0`);
  const res = await fetch(url, { headers: adoHeaders(pat), signal: AbortSignal.timeout(45000) });
  if (!res.ok) return [];
  const data = await res.json() as { value?: Array<{ fields: Record<string, string> }> };
  return (data.value ?? [])
    .map(w => (w.fields['Allscripts.Field.ReportedinRelease'] ?? '').trim())
    .filter(Boolean);
}

async function fetchItemsBatch(ids: number[], pat: string): Promise<RelatedItem[]> {
  if (!ids.length) return [];
  const fields = 'System.Id,System.Title,System.State,System.WorkItemType';
  const url = bridgeApi(`/api/ado/SR/_apis/wit/workItems?ids=${ids.join(',')}&fields=${fields}&api-version=7.0`);
  const res = await fetch(url, { headers: adoHeaders(pat), signal: AbortSignal.timeout(6000) });
  if (!res.ok) return [];
  const data = await res.json() as { value?: Array<{ id: number; fields: Record<string, string> }> };
  return (data.value ?? []).map(w => ({
    id: w.id,
    title: w.fields['System.Title'] ?? '',
    state: w.fields['System.State'] ?? '',
    type: w.fields['System.WorkItemType'] ?? '',
    url: workItemUrl(w.id),
  }));
}

async function fetchItemsBatchDetailed(ids: number[], pat: string): Promise<RelatedItem[]> {
  if (!ids.length) return [];
  const fields = [
    'System.Id',
    'System.Title',
    'System.State',
    'System.WorkItemType',
    'System.ChangedDate',
    'Allscripts.Field.SupportVersion',
    'Allscripts.Field.ReportedinRelease',
  ].join(',');

  const url = bridgeApi(`/api/ado/SR/_apis/wit/workItems?ids=${ids.join(',')}&fields=${fields}&api-version=7.0`);
  const res = await fetch(url, { headers: adoHeaders(pat), signal: AbortSignal.timeout(25000) });
  if (!res.ok) return [];
  const data = await res.json() as { value?: Array<{ id: number; fields: Record<string, string> }> };

  return (data.value ?? []).map((w) => ({
    id: w.id,
    title: w.fields['System.Title'] ?? '',
    state: w.fields['System.State'] ?? '',
    type: w.fields['System.WorkItemType'] ?? '',
    url: workItemUrl(w.id),
    supportVersion: w.fields['Allscripts.Field.SupportVersion'] ?? '',
    reportedRelease: w.fields['Allscripts.Field.ReportedinRelease'] ?? '',
    changedDate: w.fields['System.ChangedDate'] ?? '',
  }));
}

/** Open bugs in the same area path created in the last 90 days */
export async function fetchRelatedBugs(areaPaths: string | string[], pat: string): Promise<RelatedItem[]> {
  const paths = Array.isArray(areaPaths) ? areaPaths : [areaPaths];
  const normalized = Array.from(new Set(paths.map((p) => p.trim()).filter(Boolean)));
  if (!normalized.length) return [];
  const underClause = normalized.map((p) => `[System.AreaPath] UNDER '${p.replace(/\\/g, '\\\\')}'`).join(' OR ');
  const query = `SELECT [System.Id] FROM WorkItems WHERE (${underClause}) AND [System.WorkItemType] IN ('Bug','Task') AND [System.State] NOT IN ('Removed') AND [System.CreatedDate] > @today - 90 ORDER BY [System.ChangedDate] DESC`;
  const ids = await runWiql(pat, query);
  return fetchItemsBatch(ids, pat);
}

/** Test cases for the area path(s) */
export async function fetchTestCases(areaPaths: string | string[], pat: string): Promise<RelatedItem[]> {
  const paths = Array.isArray(areaPaths) ? areaPaths : [areaPaths];
  const normalized = Array.from(new Set(paths.map((p) => p.trim()).filter(Boolean)));
  if (!normalized.length) return [];
  const underClause = normalized.map((p) => `[System.AreaPath] UNDER '${p.replace(/\\/g, '\\\\')}'`).join(' OR ');
  const query = `SELECT [System.Id] FROM WorkItems WHERE (${underClause}) AND [System.WorkItemType] = 'Test Case' ORDER BY [System.ChangedDate] DESC`;
  const ids = await runWiql(pat, query);
  return fetchItemsBatch(ids.slice(0, 10), pat);
}

/** Recent area items across defect/bug/task/story regardless of open/closed state. */
export async function fetchAreaItems(areaPath: string, pat: string): Promise<RelatedItem[]> {
  const escaped = areaPath.replace(/\\/g, '\\\\');
  const query = `SELECT [System.Id] FROM WorkItems WHERE [System.AreaPath] UNDER '${escaped}' AND [System.WorkItemType] IN ('Bug','Defect','Task','User Story') AND [System.ChangedDate] > @today - 365 ORDER BY [System.ChangedDate] DESC`;
  const ids = await runWiql(pat, query);
  return fetchItemsBatchDetailed(ids.slice(0, 80), pat);
}

export async function fetchAreaItemsByPaths(areaPaths: string[], pat: string): Promise<RelatedItem[]> {
  const normalized = Array.from(new Set(areaPaths.map((x) => x.trim()).filter(Boolean)));
  if (!normalized.length) return [];

  const results = await Promise.all(normalized.map((areaPath) => fetchAreaItems(areaPath, pat).catch(() => [])));
  const merged = results.flat();
  const seen = new Set<number>();
  const deduped: RelatedItem[] = [];
  for (const item of merged) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }
  return deduped;
}

/** Area evidence filtered by release/version hints (e.g. 25.1, 25.1 PR3). */
export async function fetchAreaVersionEvidence(areaPath: string, pat: string, versionHints: string[]): Promise<RelatedItem[]> {
  const hints = versionHints
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (!hints.length) return [];

  const all = await fetchAreaItems(areaPath, pat);
  const filtered = all.filter((item) => {
    const hay = `${item.title} ${item.supportVersion ?? ''} ${item.reportedRelease ?? ''}`.toLowerCase();
    return hints.some((h) => hay.includes(h));
  });

  return filtered.slice(0, 25);
}

export async function fetchAreaVersionEvidenceByPaths(areaPaths: string[], pat: string, versionHints: string[]): Promise<RelatedItem[]> {
  const normalized = Array.from(new Set(areaPaths.map((x) => x.trim()).filter(Boolean)));
  if (!normalized.length) return [];

  const results = await Promise.all(
    normalized.map((areaPath) => fetchAreaVersionEvidence(areaPath, pat, versionHints).catch(() => []))
  );

  const merged = results.flat();
  const seen = new Set<number>();
  const deduped: RelatedItem[] = [];
  for (const item of merged) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }
  return deduped.slice(0, 50);
}

function compareReleaseOptions(a: string, b: string): number {
  const parse = (value: string) => {
    const normalized = value.replace(/\s+/g, ' ').trim().toUpperCase();
    const match = normalized.match(/\b(\d+)\.(\d+)\b/);
    const major = match ? parseInt(match[1], 10) : -1;
    const minor = match ? parseInt(match[2], 10) : -1;
    const productRank = normalized.startsWith('SE ') ? 0 : normalized.startsWith('POH ') ? 1 : 2;
    const prereleaseRank = /(^|[\s-])PR\b/.test(normalized) ? 0 : 1;
    return { major, minor, productRank, prereleaseRank, normalized };
  };

  const left = parse(a);
  const right = parse(b);
  if (left.major !== right.major) return right.major - left.major;
  if (left.minor !== right.minor) return right.minor - left.minor;
  if (left.prereleaseRank !== right.prereleaseRank) return left.prereleaseRank - right.prereleaseRank;
  if (left.productRank !== right.productRank) return left.productRank - right.productRank;
  return left.normalized.localeCompare(right.normalized);
}

async function fetchReportedReleaseOptionsFromScope(areaPaths: string[], pat: string): Promise<string[]> {
  const normalized = Array.from(new Set(areaPaths.map((x) => x.trim()).filter(Boolean)));
  const areaClause = normalized.length
    ? ` AND (${normalized
        .map((areaPath) => `[System.AreaPath] UNDER '${areaPath.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`)
        .join(' OR ')})`
    : '';

  const query = `SELECT [System.Id] FROM WorkItems WHERE [Allscripts.Field.ReportedinRelease] <> '' AND [System.WorkItemType] IN ('Bug','Defect','Task','User Story') AND [System.ChangedDate] > @today - 540${areaClause} ORDER BY [System.ChangedDate] DESC`;
  const ids = await runWiqlLimited(pat, query, 200);
  if (!ids.length) return [];
  // Fetch only the release field in chunks to keep URLs short
  const chunkSize = 100;
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));
  const results = await Promise.all(chunks.map(chunk => fetchReleaseFieldBatch(chunk, pat)));
  const allValues = Array.from(new Set(results.flat()));
  return allValues.sort(compareReleaseOptions);
}

const RELEASE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RELEASE_CACHE_STALE_MS = 60 * 60 * 1000;   // refresh after 1 hour

function releasesCacheKey(areaPaths: string[]): string {
  return `devassist:releaseOptions:${areaPaths.slice().sort().join('|')}`;
}

function readReleasesCache(key: string): { options: string[]; fetchedAt: number } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { options: string[]; fetchedAt: number };
    if (Date.now() - parsed.fetchedAt > RELEASE_CACHE_TTL_MS) { localStorage.removeItem(key); return null; }
    return parsed;
  } catch { return null; }
}

function writeReleasesCache(key: string, options: string[]): void {
  try { localStorage.setItem(key, JSON.stringify({ options, fetchedAt: Date.now() })); } catch { /* quota */ }
}

export async function fetchReportedReleaseOptions(areaPaths: string[], pat: string): Promise<string[]> {
  const key = releasesCacheKey(areaPaths);
  const cached = readReleasesCache(key);

  if (cached) {
    // Return cached value immediately; refresh in background if stale
    if (Date.now() - cached.fetchedAt > RELEASE_CACHE_STALE_MS) {
      void (async () => {
        try {
          const fresh = await fetchReportedReleaseOptionsFromScope(areaPaths, pat)
            .then(r => r.length ? r : fetchReportedReleaseOptionsFromScope([], pat));
          if (fresh.length) writeReleasesCache(key, fresh);
        } catch { /* background refresh failed, keep cache */ }
      })();
    }
    return cached.options;
  }

  const scoped = await fetchReportedReleaseOptionsFromScope(areaPaths, pat);
  const result = scoped.length ? scoped : await fetchReportedReleaseOptionsFromScope([], pat);
  if (result.length) writeReleasesCache(key, result);
  return result;
}

export async function findWorkItemBySnowTask(taskNumber: string, pat: string) {
  const escaped = taskNumber.replace(/'/g, "''");
  const query = `SELECT [System.Id] FROM WorkItems WHERE [Allscripts.Field.IncidentTaskID] = '${escaped}' ORDER BY [System.ChangedDate] DESC`;
  const ids = await runWiql(pat, query);
  if (!ids.length) return null;
  return fetchWorkItem(ids[0], pat);
}

export async function findWorkItemByCase(caseNumber: string, pat: string) {
  const escaped = caseNumber.replace(/'/g, "''");
  const query = `SELECT [System.Id] FROM WorkItems WHERE [Allscripts.Field.CaseId] = '${escaped}' ORDER BY [System.ChangedDate] DESC`;
  const ids = await runWiql(pat, query);
  if (!ids.length) return null;
  return fetchWorkItem(ids[0], pat);
}
