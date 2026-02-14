@echo off
REM Run this OUTSIDE of Cursor - close Cursor first, then double-click in File Explorer
REM Or: Win+R, cmd, cd to this folder, run CLEAN-REINSTALL.cmd

cd /d "%~dp0"

echo.
echo Northwest Community - Clean Reinstall
echo (Close Cursor first if you get EPERM errors)
echo.

echo [1/4] Removing node_modules...
if exist node_modules rmdir /s /q node_modules
if exist apps\main\node_modules rmdir /s /q apps\main\node_modules
if exist apps\admin\node_modules rmdir /s /q apps\admin\node_modules
if exist packages\database\node_modules rmdir /s /q packages\database\node_modules
if exist packages\design-tokens\node_modules rmdir /s /q packages\design-tokens\node_modules
if exist packages\types\node_modules rmdir /s /q packages\types\node_modules
echo Done.

echo.
echo [2/4] Installing dependencies...
call pnpm install
if errorlevel 1 (
    echo Install failed.
    pause
    exit /b 1
)
echo Done.

echo.
echo [3/4] Generating Prisma client...
cd packages\database
call pnpm exec prisma generate
if errorlevel 1 (
    echo Prisma generate failed. Try running this script as Administrator.
    cd ..
    pause
    exit /b 1
)
cd ..
echo Done.

echo.
echo [4/4] Verifying...
call pnpm --filter main build
if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)

echo.
echo ========================================
echo Clean reinstall complete!
echo Run run-main.cmd to start the dev server.
echo ========================================
echo.
pause
