$ErrorActionPreference = 'Stop'

$repoRoot = Join-Path $env:USERPROFILE 'source\repos\devassist-ui'
$repoUrl = 'https://github.com/Jatinkumar-Patel/devassist-ui.git'
$bridgeUrl = 'http://localhost:7447'
$pagesUrl = 'https://jatinkumar-patel.github.io/devassist-ui/'

Write-Host '================================================'
Write-Host '             DevAssist Starter'
Write-Host '================================================'
Write-Host 'This window can take a few minutes on first run.'
Write-Host ''

if (-not (Test-Path $repoRoot)) {
  New-Item -ItemType Directory -Path (Split-Path $repoRoot -Parent) -Force | Out-Null
}

function Invoke-GitSync {
  if (Get-Command git -ErrorAction SilentlyContinue) {
    if (-not (Test-Path (Join-Path $repoRoot '.git'))) {
      if (Test-Path $repoRoot) {
        Remove-Item $repoRoot -Recurse -Force -ErrorAction SilentlyContinue
      }
      git clone $repoUrl $repoRoot
      return
    }

    git -C $repoRoot fetch origin main --prune
    git -C $repoRoot checkout main
    git -C $repoRoot reset --hard origin/main
    return
  }

  Write-Host '[INFO] Git not found. Refreshing latest source via npm package mirror...'
  if (Test-Path $repoRoot) {
    Remove-Item $repoRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  npx --yes degit Jatinkumar-Patel/devassist-ui $repoRoot --force
}

try {
  if (-not (Test-Path (Join-Path $repoRoot '.git'))) {
    Write-Host '[2/7] First-time setup: downloading DevAssist...'
  }

  Push-Location $repoRoot

  Write-Host '[3/7] Updating to latest version...'
  Invoke-GitSync

  Write-Host '[4/7] Installing dependencies (if needed)...'
  npm install
  if ($LASTEXITCODE -ne 0) {
    throw 'Dependency install failed. Start cancelled.'
  }

  Write-Host '[5/7] Building app...'
  npm run build --workspace=packages/spa
  if ($LASTEXITCODE -ne 0) {
    throw 'SPA build failed. Start cancelled to avoid opening stale UI.'
  }

  Write-Host '[6/7] Building bridge...'
  npm run build --workspace=packages/bridge
  if ($LASTEXITCODE -ne 0) {
    throw 'Bridge build failed. Start cancelled.'
  }

  Write-Host '[7/7] Starting DevAssist...'

  $listener = Get-NetTCPConnection -LocalPort 7447 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped old bridge PID $($listener.OwningProcess)"
  }

  $bridgeProcess = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'node packages/bridge/dist/index.js --no-open' -WorkingDirectory $repoRoot -PassThru

  Write-Host 'Waiting for startup...'
  $ready = $false
  for ($i = 0; $i -lt 15; $i++) {
    try {
      $status = Invoke-RestMethod 'http://localhost:7447/api/status' -TimeoutSec 3
      if ($status.bridge -eq 'ok') {
        $ready = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 800
    }
  }

  if ($ready) {
    Write-Host 'READY'
  } else {
    Write-Host 'NOT_READY'
  }

  $runningVersion = 'unknown'
  try {
    $runningVersion = (Invoke-RestMethod 'http://localhost:7447/api/status' -TimeoutSec 5).version
  } catch {
  }

  Write-Host "Running Bridge version: $runningVersion"
  Write-Host 'Expected minimum version: 0.2.0'
  Write-Host ''
  Write-Host 'Opening DevAssist in browser...'
  $browserUrl = "$bridgeUrl/index.html?bridgeUrl=$([uri]::EscapeDataString($bridgeUrl))&v=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())#/triage"
  Start-Process -FilePath 'explorer.exe' -ArgumentList $browserUrl
  Write-Host ''
  Write-Host 'Tip: Connect VPN before running this launcher.'
  Write-Host 'If you see SNOW: FAIL in Settings, close bridge window and run this file again.'
}
finally {
  Pop-Location
}
