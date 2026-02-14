@echo off
REM Allow phone on same WiFi to reach dev server (3000) and Metro (8082).
REM Right-click this file -> Run as administrator

echo Adding firewall rules for ports 3000 and 8082...

netsh advfirewall firewall add rule name="Node Dev 3000" dir=in action=allow protocol=tcp localport=3000
netsh advfirewall firewall add rule name="Expo Metro 8082" dir=in action=allow protocol=tcp localport=8082

echo.
echo Done. If you see "already exists" above, the rules were already there - that is OK.
echo.
pause
