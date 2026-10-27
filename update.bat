@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title Kabir - Update

echo ============================================
echo   Kabir - Update
echo ============================================
echo   Your projects, materials, invoices and
echo   settings are kept safe: a database backup
echo   is created automatically before updating.
echo ============================================
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

%PY% update.py %*
if errorlevel 1 (
    echo.
    echo [ERROR] The update did not finish successfully - see the messages above.
    echo.
    pause
    exit /b 1
)

echo.
echo [OK] Update complete. Run "run.bat" to start Kabir.
echo.
pause
