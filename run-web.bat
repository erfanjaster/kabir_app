@echo off
REM اجرای رابط وب کبیر (نسخه‌ی ۲) — مرورگر به‌صورت خودکار باز می‌شود
cd /d "%~dp0"
echo.
echo    Kabir Web UI - http://localhost:8080  (Ctrl+C to stop)
echo.
where python >nul 2>nul
if %errorlevel%==0 (
    python web.py %*
) else (
    py -3 web.py %*
)
pause
