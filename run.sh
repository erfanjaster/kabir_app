#!/usr/bin/env bash
# اجرای کبیر
cd "$(dirname "$0")"
PY=$(command -v python3 || command -v python)
exec "$PY" main.py "$@"
