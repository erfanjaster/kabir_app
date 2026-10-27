#!/usr/bin/env bash
# ============================================================
#  کبیر — نصب وابستگی‌ها (لینوکس / مک)
# ============================================================
#  هسته‌ی نرم‌افزار فقط به کتابخانه‌ی استاندارد پایتون نیاز دارد؛
#  وابستگی‌های requirements.txt فقط برای خروجی PDF و اکسل لازم‌اند.
# ============================================================
set -e
cd "$(dirname "$0")"

echo "============================================"
echo "  کبیر — نصب وابستگی‌ها"
echo "============================================"

if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "[ERROR] Python 3 not found."
  echo "        Linux: sudo apt install python3   |   macOS: brew install python3"
  exit 1
fi

echo "Python: $("$PY" --version 2>&1)"
echo

"$PY" -m pip install --upgrade pip || echo "[WARN] pip upgrade failed - continuing."

# تلاش برای نصب؛ اگر محیط پایتون «مدیریت‌شده» بود (Debian/Ubuntu جدید)
# به نصب کاربری (--user) و در نهایت به --break-system-packages می‌افتد.
if "$PY" -m pip install -r requirements.txt; then
  :
elif "$PY" -m pip install --user -r requirements.txt; then
  echo "[OK] Dependencies installed for the current user (--user)."
elif "$PY" -m pip install --break-system-packages -r requirements.txt; then
  echo "[OK] Dependencies installed (--break-system-packages)."
else
  echo
  echo "[WARN] نصب وابستگی‌ها ناموفق بود."
  echo "       نگران نباشید: هسته‌ی کبیر بدون آن‌ها کار می‌کند؛"
  echo "       فقط خروجی PDF و اکسل محدود می‌شود."
  echo "       راهنما: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
fi

echo
echo "نصب کامل شد. حالا ./run.sh را اجرا کنید تا کبیر در مرورگر باز شود."
