@echo off
rem Stops Nexo: the installed/packaged app and any dev copy started from this folder.
taskkill /IM Nexo.exe /F >nul 2>&1
powershell -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'D:\nexo-pet\*' } | Stop-Process -Force"
