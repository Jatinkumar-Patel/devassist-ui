const DEFAULT_REPO = 'Jatinkumar-Patel/devassist-ui';

function parseGithubPagesRepo(): string | null {
  if (typeof window === 'undefined') return null;

  const { hostname, pathname } = window.location;
  if (!hostname.endsWith('.github.io')) return null;

  const owner = hostname.replace(/\.github\.io$/i, '').trim();
  const firstPathSegment = pathname.split('/').filter(Boolean)[0]?.trim();

  if (!owner || !firstPathSegment) return null;
  return `${owner}/${firstPathSegment}`;
}

function getRepoSlug(): string {
  return parseGithubPagesRepo() ?? DEFAULT_REPO;
}

function getLocalFolder(repoSlug: string): string {
  const parts = repoSlug.split('/');
  return parts[1] || 'devassist-ui';
}

export function getBridgeInstallCommands(): {
  cmd: string;
  powershell: string;
  repoSlug: string;
  localFolder: string;
} {
  const repoSlug = getRepoSlug();
  const localFolder = getLocalFolder(repoSlug);

  return {
    cmd: `npx --yes degit ${repoSlug} ${localFolder} && cd ${localFolder} && npm install && npm run bridge`,
    powershell: `npx --yes degit ${repoSlug} ${localFolder}; Set-Location ${localFolder}; npm install; npm run bridge`,
    repoSlug,
    localFolder,
  };
}
