@echo off
REM Run this in a SEPARATE terminal. Keep it open while testing mobile sign-in.
REM Requires: pnpm dev:main running on port 3000

cd /d "%~dp0"

echo.
echo Starting tunnel for port 3000...
echo.
echo COPY THE URL BELOW (e.g. https://xxx.loca.lt)
echo Then update apps/mobile/.env: EXPO_PUBLIC_API_URL=<that-url>
echo Restart Expo (pnpm dev:app) after updating .env
echo.
echo Keep this window open. Press Ctrl+C to stop.
echo.

npx --yes localtunnel --port 3000

pause
