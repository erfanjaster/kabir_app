#!/usr/bin/env bash
# ============================================================
#  کبیر — اسکریپت به‌روزرسانی (مک)
# ============================================================
#  این فایل را می‌توانید در Finder دوبار کلیک کنید.
#  همان کارهای update.sh را انجام می‌دهد و در پایان پنجره
#  باز می‌ماند تا نتیجه را ببینید.
#
#  داده‌های شما خارج از پوشه‌ی برنامه نگهداری می‌شوند و با
#  به‌روزرسانی از بین نمی‌روند:
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

"$PY" update.py "$@"
status=$?

echo
if [ "$status" -eq 0 ]; then
  echo "[OK] Update complete. Run ./run.sh (or double-click run.command if present) to start Kabir."
else
  echo "[ERROR] Update failed with exit code $status - see the messages above."
fi
echo
read -r -p "Press Enter to close..." _
exit "$status"
