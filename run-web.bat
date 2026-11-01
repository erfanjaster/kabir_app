@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title Kabir Web

echo.
echo    Kabir Web UI - starting on http://localhost:8080
echo    Your browser opens automatically. Press Ctrl+C to stop the server.
echo.

set "PY="
py -3 --version >nul 2>&1 && set "PY=py -3"
if not defined PY (
    python --version >nul 2>&1 && set "PY=python"
)
if not defined PY (
    echo [ERROR] Python 3 was not found. Install it from https://www.python.org/downloads/
    echo         with "Add python.exe to PATH" checked, then run install.bat.
    echo.
    pause
    exit /b 1
)

%PY% web.py %*

echo.
if errorlevel 1 (
    echo [ERROR] Kabir stopped with an error - see the messages above.
    echo         If a module is missing, run install.bat first.
) else (
    echo Kabir stopped.
)
pause
