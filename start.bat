@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo         DevAssist UI Launcher
echo ========================================
echo.

where npm >nul 2>&1
if errorlevel 1 (
	echo [ERROR] npm is not available.
	echo Install Node.js LTS from https://nodejs.org and try again.
	echo.
	pause
	exit /b 1
)

if not exist "node_modules" (
	echo [1/2] Installing dependencies (first run only)...
	call npm install
	if errorlevel 1 (
		echo.
		echo [ERROR] npm install failed.
		pause
		exit /b 1
	)
)

echo [2/2] Starting DevAssist (bridge + UI)...
echo.
echo Local app URL: http://localhost:5173/triage
echo Press Ctrl+C to stop.
echo.
call npm run dev

echo.
echo DevAssist stopped.
pause
