@echo off
REM اجرای کبیر — رابط وب (مرورگر به‌صورت خودکار باز می‌شود)
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo    Kabir - http://localhost:8080  (Ctrl+C to stop)
echo.
where python >nul 2>nul
if %errorlevel%==0 (
    python main.py %*
) else (
    py -3 main.py %*
)
pause
