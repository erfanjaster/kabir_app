@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Kabir - Update

echo ============================================================
echo   Kabir - Standalone Updater
echo ============================================================
echo   Downloads and installs the latest version of Kabir,
echo   then backs up and upgrades your database safely.
echo   Your projects, materials, invoices and settings are kept.
echo ============================================================
echo.

rem ---------- 1) Locate Python 3 ----------
rem Prefer the py launcher; the Microsoft Store stub fails --version.
set "PY="
py -3 --version >nul 2>&1 && set "PY=py -3"
if not defined PY (
    python --version >nul 2>&1 && set "PY=python"
)
if not defined PY (
    echo [ERROR] Python 3 was not found on this system.
    echo.
    echo   1. Install Python 3.10 or newer from https://www.python.org/downloads/
    echo   2. During setup, check the box "Add python.exe to PATH".
    echo   3. Run this file again.
    echo.
    pause
    exit /b 1
)

rem ---------- 2) Locate the Kabir application folder ----------
cd /d "%~dp0"
set "APPDIR="
if exist "%~dp0main.py" set "APPDIR=%~dp0"
if exist "%~dp0update.py" set "APPDIR=%~dp0"
if defined APPDIR goto :have_app

rem Not inside the app folder - probe the usual places.
call :probe "%~dp0kabir_app"
call :probe "%USERPROFILE%\kabir_app"
call :probe "%USERPROFILE%\Desktop\kabir_app"
call :probe "%USERPROFILE%\Downloads\kabir_app"
call :probe "%USERPROFILE%\Documents\kabir_app"
if not defined APPDIR for /d %%D in ("%USERPROFILE%\Desktop\kabir*") do call :probe "%%~D"
if not defined APPDIR for /d %%D in ("%USERPROFILE%\Downloads\kabir*") do call :probe "%%~D"
if defined APPDIR goto :have_app

echo Kabir was not found next to this file or in the usual folders.
echo.
echo   1 - Install a fresh copy of Kabir into: %~dp0kabir_app
echo   2 - Type the path to your existing Kabir folder
echo   3 - Cancel
echo.
set "CH=1"
set /p "CH=Choose 1, 2 or 3 and press Enter [default 1]: "
if "%CH%"=="3" goto :cancel
if "%CH%"=="2" goto :ask_path
set "APPDIR=%~dp0kabir_app\"
goto :have_app

:ask_path
set /p "APPDIR=Full path to your Kabir folder, then press Enter: "
if not defined APPDIR goto :cancel
set "APPDIR=%APPDIR:"=%"
if not exist "%APPDIR%\main.py" if not exist "%APPDIR%\update.py" (
    echo.
    echo [WARN] That folder does not look like a Kabir folder - main.py not found.
    echo        The latest version will be downloaded into it anyway.
    echo.
)

:have_app
if "%APPDIR:~-1%"=="\" goto :appdir_ok
set "APPDIR=%APPDIR%\"
:appdir_ok
if not exist "%APPDIR%" mkdir "%APPDIR%"
echo.
echo Kabir folder: %APPDIR%
echo.

rem ---------- 3) Refresh the updater core - always. ----------
rem This makes the updater self-healing: even an old installation that
rem already has update.py receives the newest updater logic before running.
echo [INFO] Fetching the latest updater core ...
%PY% -c "import urllib.request,shutil; r=urllib.request.urlopen('https://raw.githubusercontent.com/erfanjaster/kabir_app/main/update.py',timeout=60); f=open(r'%APPDIR%update.py.new','wb'); shutil.copyfileobj(r,f); f.close()"
if errorlevel 1 goto :core_failed
move /y "%APPDIR%update.py.new" "%APPDIR%update.py" >nul
if errorlevel 1 goto :core_failed
goto :run_update

:core_failed
if exist "%APPDIR%update.py.new" del "%APPDIR%update.py.new"
if exist "%APPDIR%update.py" (
    echo [WARN] Could not refresh the updater core - using the copy on disk.
    goto :run_update
)
echo.
echo [ERROR] Could not download the updater. Check your internet connection,
echo         or download the latest ZIP manually from:
echo         https://github.com/erfanjaster/kabir_app
echo.
pause
exit /b 1

rem ---------- 4) Run the updater ----------
:run_update
cd /d "%APPDIR%"
%PY% update.py %*
if errorlevel 1 goto :failed
echo.
echo [OK] Update complete. Start Kabir with run.bat in the app folder.
echo.
pause
exit /b 0

:failed
echo.
echo [ERROR] The update did not finish successfully - see the messages above.
echo         Your data is safe; a database backup is taken before any change.
echo.
pause
exit /b 1

:cancel
echo Cancelled. Nothing was changed.
pause
exit /b 0

:probe
if not defined APPDIR if exist "%~1\main.py" set "APPDIR=%~1\"
exit /b 0
