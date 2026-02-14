@echo off
REM Run this OUTSIDE of Cursor - double-click this file in File Explorer
REM Or: Win+R, cmd, then: cd /d "c:\Users\jesus\INW Community" and run this file
REM Cursor's terminal may block Node from spawning - running outside fixes it.

cd /d "%~dp0"

REM Kill any process using port 3000 (fixes 404 when stale server is running)
echo Checking for processes using port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING" 2^>nul') do (
  echo Killing process %%a on port 3000...
  taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak >nul

echo.
echo Northwest Community - Starting dev server on http://localhost:3000
echo (If you see spawn EPERM, add this folder to Windows Defender exclusions)
echo.

pnpm --filter main dev

echo.
pause
