@echo off
REM Run this OUTSIDE of Cursor - close Cursor first, then double-click in File Explorer
REM EPERM happens when Cursor or the dev server has Prisma files locked.
REM This project uses "prisma db push" (not migrate deploy). If you see P3005
REM "database schema is not empty", use this script instead of migrate deploy.

cd /d "%~dp0"

echo.
echo Northwest Community - Database Update
echo.
echo IMPORTANT: Close Cursor and stop the dev server before running this.
echo (Otherwise you may get EPERM errors)
echo.
pause

echo [1/2] Pushing schema to database...
cd packages\database
call pnpm exec prisma db push
if errorlevel 1 (
    echo db push failed.
    cd ..
    pause
    exit /b 1
)
echo Done.

echo.
echo [2/2] Generating Prisma client...
call pnpm exec prisma generate
if errorlevel 1 (
    echo prisma generate failed with EPERM.
    echo.
    echo Try: 1) Close Cursor completely
    echo      2) End any node.exe in Task Manager
    echo      3) Right-click this file - Run as Administrator
    echo      4) Add this folder to Windows Defender exclusions
    echo.
    cd ..
    pause
    exit /b 1
)
cd ..
echo Done.

echo.
echo Database update complete!
echo You can reopen Cursor and run run-main.cmd
echo.
pause
