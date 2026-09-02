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
  const repoSlugLower = repoSlug.toLowerCase();
  const localFolder = getLocalFolder(repoSlug);

  const baseDirCmd = '%USERPROFILE%\\source';
  const baseDirPs = '$env:USERPROFILE\\source';
  const stopExistingBridgePs = `$existing = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 7447 -State Listen -ErrorAction SilentlyContinue; if ($existing) { $procId = $existing.OwningProcess; if ($procId) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } }`;

  const cmdDaily = `cd /d "${baseDirCmd}\\${localFolder}" && npm run bridge`;
  const powershellDaily = `${stopExistingBridgePs}; Set-Location "${baseDirPs}\\${localFolder}"; npm run bridge`;

  // --force so re-running when the folder already exists (e.g. ran from System32 before) just works
  const cmd =
    `mkdir "${baseDirCmd}" 2>nul && cd /d "${baseDirCmd}" && ` +
    `(if exist "${localFolder}" (npx --yes degit ${repoSlug} "${localFolder}" --force && cd "${localFolder}" && npm install && npm run bridge) else ` +
    `(npx --yes degit ${repoSlug} "${localFolder}" && cd "${localFolder}" && npm install && npm run bridge))`;

  const powershell =
    `New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\source" | Out-Null; ` +
    `$existing = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 7447 -State Listen -ErrorAction SilentlyContinue; ` +
    `if ($existing) { $procId = $existing.OwningProcess; if ($procId) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } }; ` +
    `Set-Location "$env:USERPROFILE\\source"; ` +
    `if (Test-Path "${localFolder}") { npx --yes degit ${repoSlugLower} "${localFolder}" --force; Set-Location "${localFolder}"; npm install; npm run bridge } else { npx --yes degit ${repoSlugLower} "${localFolder}"; Set-Location "${localFolder}"; npm install; npm run bridge }`;

  // ── Auto-start via current-user Startup folder ────────────────────────────
  // Run once after first-time install. Bridge will start automatically at every Windows login.
  // No admin required — saves a .cmd file into the user's Startup folder.
  const bridgeFolder = `$env:USERPROFILE\\source\\${localFolder}`;
  const startupCmdPath = `%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\DevAssist Bridge.cmd`;
  const autoStartPowershell = [
    `$f="${bridgeFolder}";`,
    `if (-not (Test-Path "$f\\node_modules")) { Write-Error "Run the first-time install command first, then register auto-start."; exit 1 };`,
    `$startup = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Startup\\DevAssist Bridge.cmd';`,
    `$lines = @('@echo off','set "APP1=%USERPROFILE%\\source\\repos\\${localFolder}"','set "APP2=%USERPROFILE%\\source\\${localFolder}"','if exist "%APP1%\\node_modules" (','  cd /d "%APP1%"',') else (','  cd /d "%APP2%"',')','call "C:\\Program Files\\nodejs\\npm.cmd" run bridge >> "%USERPROFILE%\\devassist-bridge.log" 2>&1');`,
    `[System.IO.File]::WriteAllLines($startup, $lines, [System.Text.Encoding]::ASCII);`,
    `Start-Process -WindowStyle Hidden -FilePath $startup;`,
    `Write-Host 'Auto-start registered and bridge started. Open https://${repoSlug.split('/')[0]}.github.io/${localFolder}/#/triage in your browser.'`,
  ].join(' ');

  // cmd equivalent (registers Startup folder script)
  const autoStartCmd = [
    `set "S=${startupCmdPath}"`,
    `&& (echo @echo off)>"%S%"`,
    `&& (echo set "APP1=%%USERPROFILE%%\\source\\repos\\${localFolder}")>>"%S%"`,
    `&& (echo set "APP2=%%USERPROFILE%%\\source\\${localFolder}")>>"%S%"`,
    `&& (echo if exist "%%APP1%%\\node_modules" ^(cd /d "%%APP1%%"^) else ^(cd /d "%%APP2%%"^))>>"%S%"`,
    `&& (echo call "C:\\Program Files\\nodejs\\npm.cmd" run bridge ^>^> "%%USERPROFILE%%\\devassist-bridge.log" 2^>^&1)>>"%S%"`,
    `&& start "" /min "%S%"`,
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
