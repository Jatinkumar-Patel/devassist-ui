const GH_API = 'https://api.github.com';

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
