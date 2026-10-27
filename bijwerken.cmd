@echo off
rem Dubbelklik om de app bij te werken naar de nieuwste versie op GitHub.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bijwerken.ps1" %*
echo.
pause
