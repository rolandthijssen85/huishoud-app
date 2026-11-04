@echo off
rem Dubbelklik om automatisch bijwerken aan te zetten (elk kwartier kijken naar GitHub).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\automatisch-aanzetten.ps1" %*
echo.
pause
