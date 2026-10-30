@echo off
rem Starts the room editor and opens it in the browser. Ctrl+C or closing this window stops it.
cd /d "%~dp0"

if not exist node_modules\ (
  call npm install || goto failed
)
call npm run editor || goto failed
exit /b 0

:failed
echo.
echo The room editor did not start or was stopped.
pause
exit /b 1
