@echo off
setlocal
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0bc-containers.ps1" %*
exit /b %ERRORLEVEL%
