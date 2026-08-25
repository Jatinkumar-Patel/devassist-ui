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
  const url = bridgeApi(`/api/ado/SR/_apis/wit/workitems/${id}?$expand=all&api-version=${API_VER}`);
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
}

async function runWiql(pat: string, query: string): Promise<number[]> {
  const url = bridgeApi('/api/ado/SR/_apis/wit/wiql?api-version=7.0');
  const res = await fetch(url, {
    method: 'POST',
    headers: adoHeaders(pat),
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const data = await res.json() as { workItems?: Array<{ id: number }> };
  return (data.workItems ?? []).map(w => w.id).slice(0, 15);
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

/** Open bugs in the same area path created in the last 90 days */
export async function fetchRelatedBugs(areaPath: string, pat: string): Promise<RelatedItem[]> {
  const escaped = areaPath.replace(/\\/g, '\\\\');
  const query = `SELECT [System.Id] FROM WorkItems WHERE [System.AreaPath] UNDER '${escaped}' AND [System.WorkItemType] IN ('Bug','Task') AND [System.State] NOT IN ('Closed','Resolved','Done') AND [System.CreatedDate] > @today - 90 ORDER BY [System.ChangedDate] DESC`;
  const ids = await runWiql(pat, query);
  return fetchItemsBatch(ids, pat);
}

/** Test cases for the area path */
export async function fetchTestCases(areaPath: string, pat: string): Promise<RelatedItem[]> {
  const escaped = areaPath.replace(/\\/g, '\\\\');
  const query = `SELECT [System.Id] FROM WorkItems WHERE [System.AreaPath] UNDER '${escaped}' AND [System.WorkItemType] = 'Test Case' ORDER BY [System.ChangedDate] DESC`;
  const ids = await runWiql(pat, query);
  return fetchItemsBatch(ids.slice(0, 10), pat);
}
