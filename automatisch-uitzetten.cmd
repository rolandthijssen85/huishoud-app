@echo off
rem Dubbelklik om automatisch bijwerken weer uit te zetten.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\automatisch-aanzetten.ps1" -Uit
echo.
pause
