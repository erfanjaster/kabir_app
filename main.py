#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
کبیر — نقطه‌ی ورود نرم‌افزار (رابط وب)
=======================================
سرویس‌دهنده‌ی وب را روی http://localhost:8080 بالا می‌آورد و مرورگر را باز
می‌کند. تمام رابط کاربری نرم‌افزار تحت وب است و داده‌ها در پایگاه‌داده‌ی
محلی SQLite نگهداری می‌شوند.

اجرا:
    python main.py                  # اجرای عادی (مرورگر خودکار باز می‌شود)
    python main.py --port 9000      # پورت دلخواه
    python main.py --no-browser     # بدون باز کردن مرورگر
    python main.py --version        # نمایش نسخه
"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _excepthook(exc_type, exc_value, exc_tb):
    """ثبت خطاهای غیرمنتظره در فایل لاگ برای گزارش‌گیری."""
    msg = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
    try:
        from kabir import config
        config.LOG_PATH.write_text(msg, encoding="utf-8")
    except Exception:                          # noqa: BLE001
        pass
    print(msg, file=sys.stderr)


def main() -> int:
    sys.excepthook = _excepthook
    from kabir.web.server import main as serve_main
    return serve_main(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
