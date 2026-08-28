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
  autoStartPowershell: string;
  autoStartCmd: string;
  verifyUrl: string;
  appUrl: string;
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

  // ── Auto-start via Windows Task Scheduler ─────────────────────────────────
  // Run once after first-time install. Bridge will start automatically at every Windows login.
  // No admin required — registers task for current user only.
  const bridgeFolder = `$env:USERPROFILE\\source\\${localFolder}`;
  const runValueName = 'DevAssistBridge';
  const runCmd = `cmd /c cd /d \"%USERPROFILE%\\source\\${localFolder}\" && npm run bridge >> \"%USERPROFILE%\\devassist-bridge.log\" 2>&1`;
  const autoStartPowershell = [
    // 1. Ensure the repo is installed first
    `$f="${bridgeFolder}";`,
    `if (-not (Test-Path "$f\\node_modules")) { Write-Error "Run the first-time install command first, then register auto-start."; exit 1 };`,
    // 2. Register current-user startup entry (no admin, no Task Scheduler permissions required)
    `$runName = '${runValueName}';`,
    `$runCmd = "cmd /c cd /d \"$f\" && npm run bridge >> \"$env:USERPROFILE\\devassist-bridge.log\" 2>&1";`,
    `New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Force | Out-Null;`,
    `Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name $runName -Value $runCmd;`,
    // 3. Start it now without waiting for next login
    `Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' -ArgumentList '/c', "cd /d \"$f\" && npm run bridge >> \"$env:USERPROFILE\\devassist-bridge.log\" 2>&1";`,
    `Write-Host 'Auto-start registered and bridge started. Open https://${repoSlug.split('/')[0]}.github.io/${localFolder}/#/triage in your browser.'`,
  ].join(' ');

  // cmd equivalent (registers in HKCU Run)
  const autoStartCmd = [
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${runValueName}" /t REG_SZ /d "${runCmd}" /f`,
    `&& start "" /min cmd /c "cd /d \"%USERPROFILE%\\source\\${localFolder}\" && npm run bridge >> \"%USERPROFILE%\\devassist-bridge.log\" 2>&1"`,
    `&& echo Auto-start registered. Bridge started.`,
  ].join(' ');

  return {
    cmd,
    powershell,
    cmdDaily,
    powershellDaily,
    autoStartPowershell,
    autoStartCmd,
    verifyUrl: 'http://localhost:7447/api/status',
    appUrl: `https://jatinkumar-patel.github.io/${localFolder}/#/triage`,
    repoSlug,
    localFolder,
  };
}
