#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
کبیر — اجرای رابط وب (نام سازگار با نسخه‌های قبل)
==================================================
نقطه‌ی ورود اصلی نرم‌افزار ``main.py`` است؛ این فایل فقط برای سازگاری با
عادت‌های قبلی نگه داشته شده و همان سرویس‌دهنده‌ی وب را اجرا می‌کند.

اجرا:
    python web.py               # معادل python main.py
    python web.py --port 9000
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from main import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
