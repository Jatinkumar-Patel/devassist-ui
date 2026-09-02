@echo off
setlocal EnableExtensions EnableDelayedExpansion

title DevAssist One-Click Launcher

set "REPO_URL=https://github.com/Jatinkumar-Patel/devassist-ui.git"
set "BASE_DIR=%USERPROFILE%\source\repos"
set "REPO_DIR=%BASE_DIR%\devassist-ui"

echo ================================================
echo              DevAssist Starter
echo ================================================
echo This window can take a few minutes on first run.
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo Please install Node.js LTS, then run this file again.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm is not available.
  echo Please reinstall Node.js LTS, then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "%BASE_DIR%" (
  echo [1/7] Creating local folder...
  mkdir "%BASE_DIR%" >nul 2>&1
)

if not exist "%REPO_DIR%\.git" (
  echo [2/7] First-time setup: downloading DevAssist...
  where git >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] Git is not installed.
    echo Please install Git for Windows, then run this file again.
    echo.
    pause
    exit /b 1
  )
  pushd "%BASE_DIR%"
  git clone "%REPO_URL%" devassist-ui
  if errorlevel 1 (
    popd
    echo.
    echo [ERROR] Could not download DevAssist.
    echo Check VPN/network access and try again.
    pause
    exit /b 1
  )
  popd
)

pushd "%REPO_DIR%"

echo [3/7] Updating to latest version...
where git >nul 2>&1
if not errorlevel 1 (
  git fetch origin >nul 2>&1
  git checkout main >nul 2>&1
  git pull origin main >nul 2>&1
)

echo [4/7] Installing dependencies (if needed)...
call npm install
if errorlevel 1 (
  echo.
  echo [ERROR] Dependency install failed.
  echo Please verify VPN/internet access and try again.
  popd
  pause
  exit /b 1
)

echo [5/7] Building app...
call npm run build --workspace=packages/spa
if errorlevel 1 (
  echo.
  echo [ERROR] SPA build failed.
  popd
  pause
  exit /b 1
)

echo [6/7] Building bridge...
call npm run build --workspace=packages/bridge
if errorlevel 1 (
  echo.
  echo [ERROR] Bridge build failed.
  popd
  pause
  exit /b 1
)

echo [7/7] Starting DevAssist...
start "DevAssist Bridge" cmd /k "node packages/bridge/dist/index.js --no-open"

echo Waiting for startup...
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 15;$i++){ try { $r=Invoke-RestMethod 'http://localhost:7447/api/status' -TimeoutSec 3; if($r.bridge -eq 'ok'){ $ok=$true; break } } catch {}; Start-Sleep -Milliseconds 800 }; if($ok){ 'READY' } else { 'NOT_READY' }"

echo.
echo Opening DevAssist in browser...
start "" "http://localhost:7447/"

echo.
echo Tip: Connect VPN before running this launcher.
echo If you see SNOW: FAIL in Settings, close bridge window and run this file again.

popd
exit /b 0
