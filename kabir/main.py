# -*- coding: utf-8 -*-
"""اجرای کبیر با:  python -m kabir.main  (معادل python main.py — رابط وب)"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from main import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
