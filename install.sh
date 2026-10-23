#!/usr/bin/env bash
# نصب وابستگی‌های کبیر (لینوکس / مک)
set -e
cd "$(dirname "$0")"
echo "============================================"
echo "  کبیر — نصب وابستگی‌ها"
echo "============================================"
PY=$(command -v python3 || command -v python)
[ -z "$PY" ] && { echo "پایتون نصب نیست."; exit 1; }
"$PY" -m pip install --upgrade pip
"$PY" -m pip install -r requirements.txt
echo
echo "نصب کامل شد. حالا ./run.sh را اجرا کنید تا کبیر در مرورگر باز شود."
