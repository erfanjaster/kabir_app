#!/usr/bin/env bash
# ============================================================
#  کبیر — اسکریپت به‌روزرسانی (مک) — خودبسنده
# ============================================================
#  این فایل را می‌توانید در Finder دوبار کلیک کنید.
#  حتی اگر «تنها» همین فایل را دریافت کرده باشید کار می‌کند:
#  هسته‌ی به‌روزرسان را از گیت‌هاب می‌گیرد، نسخه‌ی جدید را نصب،
#  از پایگاه‌داده پشتیبان و آن را مهاجرت می‌کند و قیمت پروژه‌ها
#  را با نرخ روز بازمحاسبه می‌کند.
#
#  داده‌های شما خارج از پوشه‌ی برنامه نگهداری می‌شوند:
#    ~/Library/Application Support/KabirCabinet
# ============================================================
cd "$(dirname "$0")" || exit 1

if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "[ERROR] Python 3 not found."
  echo "        Install it from https://www.python.org/downloads/ (or: brew install python3)"
  echo
  read -r -p "Press Enter to close..." _
  exit 1
fi

RAW_URL="https://raw.githubusercontent.com/erfanjaster/kabir_app/main/update.py"

echo "[INFO] Fetching the latest updater core ..."
if "$PY" - "$RAW_URL" <<'PYEOF'
import shutil, sys, urllib.request
url = sys.argv[1]
with urllib.request.urlopen(url, timeout=60) as r, open("update.py.new", "wb") as f:
    shutil.copyfileobj(r, f)
PYEOF
then
  mv -f update.py.new update.py
else
  rm -f update.py.new
  if [ ! -f update.py ]; then
    echo "[ERROR] Could not download the updater and no local copy exists."
    echo "        Check your internet connection, or download the latest ZIP from:"
    echo "        https://github.com/erfanjaster/kabir_app"
    echo
    read -r -p "Press Enter to close..." _
    exit 1
  fi
  echo "[WARN] Could not refresh the updater core - using the copy on disk."
fi

"$PY" update.py "$@"
status=$?

echo
if [ "$status" -eq 0 ]; then
  echo "[OK] Update complete. Run ./run.sh to start Kabir."
else
  echo "[ERROR] Update failed with exit code $status - see the messages above."
  echo "        Your data is safe; a database backup is taken before any change."
fi
echo
read -r -p "Press Enter to close..." _
exit "$status"
