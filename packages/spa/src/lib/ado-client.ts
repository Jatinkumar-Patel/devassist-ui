const ADO_ORG = 'https://alm-prod-app1.rd.allscripts.com/tfs/boc_projects';
const API_VER = '7.0';

// All ADO calls go through the local bridge to avoid CORS with on-prem TFS
const BRIDGE = (): string =>
  (window as any).__BRIDGE_URL__ ?? 'http://localhost:7447';

function adoHeaders(pat: string): HeadersInit {
  const token = btoa(`:${pat}`);
  return {
    Authorization: `Basic ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function fetchWorkItem(id: number, pat: string) {
  const url = `${BRIDGE()}/api/ado/SR/_apis/wit/workitems/${id}?$expand=all&api-version=${API_VER}`;
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
  const url = `${BRIDGE()}/api/ado/_apis/search/codesearchresults?api-version=7.1-preview.1`;
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
  const url = `${BRIDGE()}/api/ado/SR/_apis/testplan/plans/${planId}?api-version=${API_VER}`;
  const res = await fetch(url, { headers: adoHeaders(pat) });
  if (!res.ok) throw new Error(`MTM ${res.status}: ${await res.text()}`);
  return res.json();
}

export function workItemUrl(id: number): string {
  return `${ADO_ORG}/SR/_workitems/edit/${id}`;
}
