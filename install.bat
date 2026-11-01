@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title Kabir - Install

echo ============================================
echo   Kabir - Dependency Installer
echo ============================================
echo.

rem --- Locate Python 3 -----------------------------------------------
rem Prefer the "py" launcher; fall back to "python" on PATH.
rem The Microsoft Store stub fails --version, so it is detected too.
set "PY="
py -3 --version >nul 2>&1 && set "PY=py -3"
if not defined PY (
    python --version >nul 2>&1 && set "PY=python"
)
if not defined PY (
    echo [ERROR] Python 3 was not found on this system.
    echo.
    echo   1. Download Python 3.10 or newer from https://www.python.org/downloads/
    echo   2. During setup, check the box "Add python.exe to PATH".
    echo   3. Run install.bat again.
    echo.
    pause
    exit /b 1
)

echo Using Python:
%PY% --version
echo.

echo [1/2] Upgrading pip ...
%PY% -m pip install --upgrade pip
if errorlevel 1 echo [WARN] pip upgrade failed - continuing with the existing pip.

echo.
echo [2/2] Installing dependencies from requirements.txt ...
%PY% -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo [ERROR] Dependency installation failed - see the messages above.
    echo         The core app only needs the Python standard library.
    echo         reportlab / openpyxl are needed for PDF and Excel export.
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   [OK] Installation complete.
echo   Run "run.bat" to start Kabir in your browser.
echo ============================================
echo.
pause
