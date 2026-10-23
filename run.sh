#!/usr/bin/env bash
# اجرای کبیر — رابط وب (مرورگر به‌صورت خودکار باز می‌شود)
cd "$(dirname "$0")"
PY=$(command -v python3 || command -v python)
echo "🗄  کبیر — در حال راه‌اندازی رابط وب…"
echo "   نشانی: http://localhost:8080   (Ctrl+C برای توقف)"
exec "$PY" main.py "$@"
