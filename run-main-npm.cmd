@echo off
REM Run dev server using npm instead of pnpm - bypasses pnpm spawn chain
REM Use if pnpm causes spawn EPERM errors

cd /d "%~dp0apps\main"

echo.
echo Northwest Community - Starting on http://localhost:3000
echo.

call npm run dev

echo.
pause
