@echo off
chcp 65001 >nul
echo ============================================
echo   Kabir - نصب وابستگی‌ها
echo ============================================
python --version >nul 2>&1 || (echo Python نصب نیست! از python.org نصب کنید. & pause & exit /b 1)
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
echo.
echo نصب کامل شد. حالا run.bat را اجرا کنید.
pause
