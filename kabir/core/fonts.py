# -*- coding: utf-8 -*-
"""مدیریت فونت فارسی: پیدا کردن، دانلود خودکار و نصب روی سیستم‌عامل.

فونت «وزیرمتن» برای دو مصرف لازم است:
  ۱) رابط وب — فایل‌های TTF از پوشه‌ی ``webui/assets/fonts`` سرو می‌شوند.
  ۲) خروجی PDF — ماژول :mod:`kabir.core.invoice_pdf` فونت را از پوشه‌ی
     ``assets/fonts`` (یا فونت‌های سیستم) در ReportLab ثبت می‌کند.

این ماژول هیچ وابستگی به کتابخانه‌ی رابط گرافیکی ندارد و روی هر
سیستم‌عاملی (ویندوز/لینوکس/مک) کار می‌کند.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import traceback
import urllib.request
from pathlib import Path

from .. import config

# نام‌های فونت فارسی که ممکن است از قبل روی سیستم کاربر نصب باشند
KNOWN_PERSIAN_FAMILIES = [
    "Vazirmatn", "Vazir", "Vazir Code", "IRANSans", "IRANYekanX", "IRANYekan",
    "Sahel", "Samim", "Shabnam", "Parastoo", "Gandom", "Tanha", "Nahid",
    "Noto Naskh Arabic", "Noto Sans Arabic", "Tahoma", "IranNastaliq",
]


def _bundled_font_paths() -> list[Path]:
    return [config.BUNDLED_FONTS_DIR / name for name, _ in config.FONT_FILES]


def has_local_fonts() -> bool:
    """آیا فایل فونت داخل پوشه‌ی برنامه موجود است؟"""
    return any(p.exists() and p.stat().st_size > 1000 for p in _bundled_font_paths())


def download_fonts(progress_cb=None, timeout: int = 25) -> tuple[bool, str]:
    """
    دانلود فونت وزیرمتن از اینترنت در پوشه‌ی assets برنامه.
    خروجی: (موفقیت, پیام)
    """
    config.BUNDLED_FONTS_DIR.mkdir(parents=True, exist_ok=True)
    ok_count = 0
    last_error = ""
    total = len(config.FONT_FILES)
    for idx, (name, _) in enumerate(config.FONT_FILES):
        target = config.BUNDLED_FONTS_DIR / name
        if target.exists() and target.stat().st_size > 1000:
            ok_count += 1
            if progress_cb:
                progress_cb(idx + 1, total, name, True)
            continue
        for base in config.FONT_URLS:
            url = base.format(name=name)
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 KabirApp"})
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    data = resp.read()
                if len(data) > 1000:
                    target.write_bytes(data)
                    ok_count += 1
                    if progress_cb:
                        progress_cb(idx + 1, total, name, True)
                    break
            except Exception as exc:            # noqa: BLE001
                last_error = f"{url} → {exc}"
                continue
        else:
            if progress_cb:
                progress_cb(idx + 1, total, name, False)
    success = ok_count >= 2
    msg = (f"{ok_count}/{total} فایل فونت آماده شد." if success
           else f"خطا در دانلود فونت: {last_error}")
    return success, msg


def install_to_user_font_dir() -> tuple[int, str]:
    """
    کپی فونت‌ها در پوشه‌ی فونت کاربرِ سیستم‌عامل تا سایر برنامه‌ها
    (مثل LibreOffice یا چاپگرهای سیستمی) هم به آن دسترسی داشته باشند.
    """
    if not has_local_fonts():
        return 0, "فایلی برای نصب وجود ندارد."
    dest = config.user_font_dir()
    try:
        dest.mkdir(parents=True, exist_ok=True)
    except Exception as exc:                   # noqa: BLE001
        return 0, f"ساخت پوشه‌ی فونت ناموفق: {exc}"
    count = 0
    for src in _bundled_font_paths():
        if not src.exists():
            continue
        try:
            shutil.copy2(src, dest / src.name)
            count += 1
        except Exception:                      # noqa: BLE001
            pass
    if not config.IS_WINDOWS and count:
        try:
            subprocess.run(["fc-cache", "-f", str(dest)], check=False, timeout=30,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:                      # noqa: BLE001
            pass
    return count, str(dest)


def ensure_fonts(download: bool = True, quiet: bool = True) -> tuple[bool, str]:
    """
    اطمینان از وجود فونت فارسی در پوشه‌ی برنامه (برای خروجی PDF و سرو وب)؛
    در صورت نبود، یک‌بار دانلود خودکار انجام می‌شود.
    """
    if has_local_fonts():
        return True, f"{len(_bundled_font_paths())} فایل فونت آماده است."
    if not download:
        return False, "فونت محلی موجود نیست."
    try:
        ok, msg = download_fonts()
        if not ok and not quiet:
            print("[fonts] " + msg, file=sys.stderr)
        return ok, msg
    except Exception:                          # noqa: BLE001
        traceback.print_exc()
        return False, "دانلود فونت ناموفق بود."
