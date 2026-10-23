#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
کبیر — اجرای رابط وب (نسخه‌ی ۲)
================================
سرویس‌دهنده را روی http://localhost:8080 بالا می‌آورد و مرورگر را باز می‌کند.
داده‌ها از همان پایگاه‌داده‌ی SQLite نسخه‌ی رومیزی خوانده/نوشته می‌شوند،
بنابراین هر دو رابط روی یک داده کار می‌کنند.

اجرا:
    python web.py               # اجرای عادی
    python web.py --port 9000   # پورت دلخواه
    python web.py --no-browser  # بدون باز کردن مرورگر
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> int:
    from kabir.web.server import main as serve_main
    return serve_main(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
