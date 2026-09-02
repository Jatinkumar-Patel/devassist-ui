@echo off
setlocal
cd /d "%~dp0"

rem Self-heal launcher script from main so VM users do not stay on stale local copy.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $repo = $env:USERPROFILE + '\\source\\repos\\devassist-ui'; $url = 'https://raw.githubusercontent.com/Jatinkumar-Patel/devassist-ui/main/launch-devassist.bat'; Invoke-WebRequest -Uri $url -OutFile (Join-Path $repo 'launch-devassist.bat') -UseBasicParsing } catch {}" >nul 2>&1

call "%~dp0launch-devassist.bat"
