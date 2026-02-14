@echo off
REM ============================================================
REM  START THE DEV SERVER - RUN THIS OUTSIDE CURSOR
REM ============================================================
REM
REM  The spawn EPERM error often happens when running from
REM  Cursor's built-in terminal. To fix:
REM
REM  1. Close Cursor (or at least don't use its terminal)
REM  2. Double-click this file in File Explorer
REM     OR open Command Prompt (Win+R, type cmd, Enter)
REM     and run:  cd /d "c:\Users\jesus\INW Community"
REM     then:     START-SERVER-HERE.bat
REM
REM  3. If it still fails, add this folder to Windows Defender:
REM     Windows Security - Virus protection - Exclusions
REM     Add: C:\Users\jesus\INW Community
REM
REM ============================================================

cd /d "%~dp0"

echo.
echo Starting Northwest Community...
echo Open http://localhost:3000 in your browser when ready.
echo (If port in use, run: pnpm dev:main:3001  for port 3001)
echo.
echo Press Ctrl+C to stop the server.
echo.

pnpm dev:main

pause
