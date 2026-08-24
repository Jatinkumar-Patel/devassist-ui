@echo off
echo Starting DevAssist Bridge...
cd /d "%~dp0"
node packages\bridge\dist\index.js
pause
