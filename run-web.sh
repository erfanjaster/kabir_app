#!/usr/bin/env bash
# اجرای رابط وب کابینت سازی عرفان (نسخه‌ی ۲) — مرورگر به‌صورت خودکار باز می‌شود
set -e
cd "$(dirname "$0")"

if command -v python3 >/dev/null 2>&1; then
  PY=python3
else
  PY=python
fi

echo "🗄  کابینت سازی عرفان — رابط وب"
echo "   در حال اجرا روی http://localhost:8080  (Ctrl+C برای توقف)"
exec "$PY" web.py "$@"
