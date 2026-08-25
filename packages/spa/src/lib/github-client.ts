import { bridgeApi } from './bridge-url';
const GH_API = 'https://api.github.com';
export interface CommitHit {
  sha: string;
  message: string;
  date: string;
  url: string;
}

/** Search recent commits in a repo via the bridge (avoids CORS) */
export async function searchCommits(githubPat: string, repo: string, keywords: string[]): Promise<CommitHit[]> {
  const q = encodeURIComponent(`repo:${repo} ${keywords.slice(0, 3).join(' ')}`);
  const res = await fetch(
    bridgeApi(`/api/gh-search/commits?q=${q}&per_page=10`),
    { headers: { 'X-GitHub-Token': githubPat }, signal: AbortSignal.timeout(5000) }
  );
  if (!res.ok) return [];
  const data = await res.json() as {
    items?: Array<{ sha: string; commit: { message: string; author: { date: string } }; html_url: string }>
  };
  return (data.items ?? []).map(c => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split('\n')[0].slice(0, 100),
    date: c.commit.author.date.slice(0, 10),
    url: c.html_url,
  }));
}


function ghHeaders(pat: string): HeadersInit {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export async function searchCode(pat: string, query: string, repos: string[]) {
  // Build "repo:owner/name" qualifiers
  const repoQ = repos.map((r) => `repo:${r}`).join(' ');
  const q = encodeURIComponent(`${query} ${repoQ}`);
  const res = await fetch(`${GH_API}/search/code?q=${q}&per_page=10`, {
    headers: ghHeaders(pat),
  });
  if (!res.ok) throw new Error(`GitHub search ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function fetchFileContent(pat: string, owner: string, repo: string, path: string) {
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${path}`, {
    headers: ghHeaders(pat),
  });
  if (!res.ok) throw new Error(`GitHub file ${res.status}`);
  const data = await res.json() as { content?: string; encoding?: string };
  if (data.content && data.encoding === 'base64') {
    return atob(data.content.replace(/\n/g, ''));
  }
  return '';
}
