$ErrorActionPreference = 'Stop'

$repoRoot = Join-Path $env:USERPROFILE 'source\repos\devassist-ui'
$bootstrapPath = Join-Path $repoRoot 'bootstrap.ps1'
$startupFolder = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$startupCmd = Join-Path $startupFolder 'DevAssist Bridge.cmd'
$desktopUrl = Join-Path ([Environment]::GetFolderPath('Desktop')) 'DevAssist.url'
$appUrl = 'https://jatinkumar-patel.github.io/devassist-ui/?bridgeUrl=http%3A%2F%2Flocalhost%3A7447#/triage'

if (-not (Test-Path $bootstrapPath)) {
  throw "bootstrap.ps1 not found at $bootstrapPath"
}

if (-not (Test-Path $startupFolder)) {
  New-Item -ItemType Directory -Force -Path $startupFolder | Out-Null
}

$startupLines = @(
  '@echo off',
  'set "REPO=%USERPROFILE%\source\repos\devassist-ui"',
  'if not exist "%REPO%\bootstrap.ps1" exit /b 1',
  'powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%REPO%\bootstrap.ps1" -NoBrowser'
)
[System.IO.File]::WriteAllLines($startupCmd, $startupLines, [System.Text.Encoding]::ASCII)

$urlLines = @(
  '[InternetShortcut]',
  "URL=$appUrl",
  'IconFile=%SystemRoot%\system32\SHELL32.dll',
  'IconIndex=220'
)
[System.IO.File]::WriteAllLines($desktopUrl, $urlLines, [System.Text.Encoding]::ASCII)

Write-Host 'One-time setup complete.'
Write-Host "1) Startup auto-run created: $startupCmd"
Write-Host "2) Desktop shortcut created: $desktopUrl"
Write-Host '3) Starting bridge now...'

& $bootstrapPath
