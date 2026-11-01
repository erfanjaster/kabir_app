#!/usr/bin/env bash
# ============================================================
#  کبیر — اسکریپت به‌روزرسانی (لینوکس) — خودبسنده
# ============================================================
#  حتی اگر این فایل را «تنها» دریافت کرده باشید کار می‌کند:
#    ۱) اگر update.py کنارش نباشد، هسته‌ی به‌روزرسان را از گیت‌هاب می‌گیرد
#    ۲) نسخه‌ی جدید را دانلود/نصب می‌کند (git pull یا ZIP از گیت‌هاب)
#    ۳) وابستگی‌ها را به‌روز می‌کند
#    ۴) از پایگاه‌داده پشتیبان می‌گیرد و مهاجرت امن را اعمال می‌کند
#    ۵) قیمت پروژه‌ها را با نرخ‌های جاری بازمحاسبه می‌کند
#
#  داده‌های شما خارج از پوشه‌ی برنامه نگهداری می‌شوند و با
#  به‌روزرسانی از بین نمی‌روند:
#    ~/.local/share/KabirCabinet
#
#  اجرا:  ./update.sh
# ============================================================
set -e
cd "$(dirname "$0")"

if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "[ERROR] Python 3 not found."
  echo "        Linux: sudo apt install python3   |   macOS: brew install python3"
  exit 1
fi

RAW_URL="https://raw.githubusercontent.com/erfanjaster/kabir_app/main/update.py"

# بازیابی/تازه‌سازی هسته‌ی به‌روزرسان — همیشه، حتی اگر از قبل وجود داشته باشد
echo "[INFO] Fetching the latest updater core ..."
if "$PY" - "$RAW_URL" <<'PYEOF'
import shutil, sys, urllib.request
url = sys.argv[1]
with urllib.request.urlopen(url, timeout=60) as r, open("update.py.new", "wb") as f:
    shutil.copyfileobj(r, f)
PYEOF
then
  mv -f update.py.new update.py
  chmod +x update.py 2>/dev/null || true
else
  rm -f update.py.new
  if [ ! -f update.py ]; then
    echo "[ERROR] Could not download the updater and no local copy exists."
    echo "        Check your internet connection, or download the latest ZIP from:"
    echo "        https://github.com/erfanjaster/kabir_app"
    exit 1
  fi
  echo "[WARN] Could not refresh the updater core - using the copy on disk."
fi

exec "$PY" update.py "$@"
