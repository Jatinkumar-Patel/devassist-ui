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
  cmdDaily: string;
  powershellDaily: string;
  verifyUrl: string;
  repoSlug: string;
  localFolder: string;
} {
  const repoSlug = getRepoSlug();
  const localFolder = getLocalFolder(repoSlug);

  const baseDirCmd = '%USERPROFILE%\\source';
  const baseDirPs = '$env:USERPROFILE\\source';

  const cmdDaily = `cd /d "${baseDirCmd}\\${localFolder}" && npm run bridge`;
  const powershellDaily = `Set-Location "${baseDirPs}\\${localFolder}"; npm run bridge`;

  // --force so re-running when the folder already exists (e.g. ran from System32 before) just works
  const cmd =
    `mkdir "${baseDirCmd}" 2>nul && cd /d "${baseDirCmd}" && ` +
    `(if exist "${localFolder}\\node_modules" (cd "${localFolder}" && npm run bridge) else ` +
    `(if exist "${localFolder}" (npx --yes degit ${repoSlug} "${localFolder}" --force && cd "${localFolder}" && npm install && npm run bridge) else ` +
    `(npx --yes degit ${repoSlug} "${localFolder}" && cd "${localFolder}" && npm install && npm run bridge)))`;

  const powershell =
    `New-Item -ItemType Directory -Force -Path "${baseDirPs}" | Out-Null; ` +
    `Set-Location "${baseDirPs}"; ` +
    `if (Test-Path "${localFolder}\\node_modules") { Set-Location "${localFolder}"; npm run bridge } ` +
    `elseif (Test-Path "${localFolder}") { npx --yes degit ${repoSlug} "${localFolder}" --force; Set-Location "${localFolder}"; npm install; npm run bridge } ` +
    `else { npx --yes degit ${repoSlug} "${localFolder}"; Set-Location "${localFolder}"; npm install; npm run bridge }`;

  return {
    cmd,
    powershell,
    cmdDaily,
    powershellDaily,
    verifyUrl: 'http://localhost:7447/api/status',
    repoSlug,
    localFolder,
  };
}
