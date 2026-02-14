@echo off
REM Clean build cache and start dev server - use when you see:
REM   "Cannot find module './xxxx.js'", HTTP 500, or "missing required error components, refreshing..."
REM Run this OUTSIDE of Cursor - double-click in File Explorer or run from cmd

cd /d "%~dp0"

REM Kill any process using port 3000 or 3001 (fixes 404 when stale server is running)
echo Checking for processes using ports 3000 and 3001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING" 2^>nul') do (
  echo Killing process %%a on port 3000...
  taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING" 2^>nul') do (
  echo Killing process %%a on port 3001...
  taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak >nul

echo.

echo Cleaning Next.js build cache...
if exist "apps\main\.next" (
  rmdir /s /q "apps\main\.next"
  echo Deleted apps\main\.next
) else (
  echo No .next folder found
)

echo.
echo Starting dev server on http://localhost:3000
echo.

pnpm --filter main dev

echo.
pause
