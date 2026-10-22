# -*- coding: utf-8 -*-
"""مدیریت فونت فارسی: پیدا کردن، دانلود خودکار، نصب و ثبت در Qt.

این ماژول باعث می‌شود برنامه روی هر سیستم‌عاملی (ویندوز/لینوکس/مک) با فونت
استاندارد فارسی «وزیرمتن» اجرا شود؛ حتی اگر آن فونت روی سیستم نصب نباشد.
"""

from __future__ import annotations

import shutil
import sys
import traceback
import urllib.request
from pathlib import Path
from typing import Optional

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
    msg = f"{ok_count}/{total} فایل فونت آماده شد." if success else f"خطا در دانلود فونت: {last_error}"
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
            import subprocess
            subprocess.run(["fc-cache", "-f", str(dest)], check=False, timeout=30,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:                      # noqa: BLE001
            pass
    return count, str(dest)


def _collect_system_fonts() -> dict[str, Path]:
    """جست‌وجوی فونت فارسی نصب‌شده روی سیستم."""
    import os

    roots: list[Path] = []
    if config.IS_WINDOWS:
        windir = os.environ.get("WINDIR", "C:\\Windows")
        localappdata = os.environ.get("LOCALAPPDATA", "")
        roots = [Path(windir) / "Fonts"]
        if localappdata:
            roots.append(Path(localappdata) / "Microsoft" / "Windows" / "Fonts")
    elif config.IS_MAC:
        roots = [Path("/Library/Fonts"), Path("/System/Library/Fonts"), Path.home() / "Library/Fonts"]
    else:
        roots = [Path("/usr/share/fonts"), Path("/usr/local/share/fonts"),
                 Path.home() / ".fonts", Path.home() / ".local/share/fonts"]
    found: dict[str, Path] = {}
    for root in roots:
        if not root or not root.exists():
            continue
        try:
            for p in root.rglob("*.ttf"):
                low = p.name.lower()
                if any(k.lower() in low for k in ("vazir", "sahel", "samim", "shabnam",
                                                  "iransans", "iranyekan", "naskh", "noto")):
                    found.setdefault(p.stem, p)
            for p in root.rglob("*.otf"):
                low = p.name.lower()
                if any(k.lower() in low for k in ("vazir", "iransans", "sahel")):
                    found.setdefault(p.stem, p)
        except Exception:                      # noqa: BLE001
            continue
    return found


def register_fonts(app=None) -> tuple[bool, str]:
    """
    ثبت فونت فارسی در Qt و تنظیم فونت پیش‌فرض برنامه.
    ترتیب تلاش: ۱) فونت همراه برنامه ۲) فونت دانلودشده در پوشه‌ی داده
                ۳) فونت نصب‌شده روی سیستم ۴) فونت پیش‌فرض Qt
    """
    from PySide6.QtGui import QFont, QFontDatabase
    from PySide6.QtWidgets import QApplication

    app = app or QApplication.instance()
    family = ""
    source = ""

    candidates: list[Path] = list(_bundled_font_paths())
    candidates += [config.FONTS_CACHE_DIR / n for n, _ in config.FONT_FILES]

    registered = 0
    for path in candidates:
        if path.exists() and path.stat().st_size > 1000:
            try:
                fid = QFontDatabase.addApplicationFont(str(path))
                if fid != -1:
                    fams = QFontDatabase.applicationFontFamilies(fid)
                    registered += 1
                    if fams and not family:
                        family = fams[0]
                        source = str(path)
            except Exception:                  # noqa: BLE001
                continue

    if not family:
        sys_fonts = set(QFontDatabase.families())
        for known in KNOWN_PERSIAN_FAMILIES:
            if known in sys_fonts:
                family = known
                source = "فونت نصب‌شده روی سیستم"
                break

    if not family:
        extra = _collect_system_fonts()
        for stem, path in extra.items():
            try:
                fid = QFontDatabase.addApplicationFont(str(path))
                if fid != -1:
                    fams = QFontDatabase.applicationFontFamilies(fid)
                    if fams:
                        family = fams[0]
                        source = str(path)
                        break
            except Exception:                  # noqa: BLE001
                continue

    if not family:
        family = config.FONT_FAMILY_FALLBACKS[-1]
        source = "فونت پیش‌فرض سیستم (فارسی ممکن است نازیبا نمایش داده شود)"

    if app is not None:
        size = int(config.DEFAULT_SETTINGS.get("font_size", "12"))
        try:
            from ..data.db import Database
            size = int(Database.instance().get_setting("font_size", size))
        except Exception:                      # noqa: BLE001
            pass
        f = QFont(family)
        f.setPointSize(max(8, size))
        f.setStyleStrategy(QFont.PreferAntialias)
        app.setFont(f)

    return (family != config.FONT_FAMILY_FALLBACKS[-1]), f"{family} — {source}"


def ensure_fonts(app=None, download: bool = True, progress_cb=None) -> tuple[bool, str]:
    """اطمینان از وجود فونت فارسی؛ در صورت نبود، دانلود خودکار انجام می‌شود."""
    if not has_local_fonts() and download:
        try:
            ok, msg = download_fonts(progress_cb=progress_cb)
            if not ok:
                print("[fonts] " + msg, file=sys.stderr)
        except Exception:                      # noqa: BLE001
            traceback.print_exc()
    return register_fonts(app)


def app_font(weight: str = "Regular", size: Optional[int] = None):
    """ساخت شیء QFont با وزن دلخواه از خانواده‌ی فعال برنامه."""
    from PySide6.QtGui import QFont
    from PySide6.QtWidgets import QApplication

    app = QApplication.instance()
    fam = app.font().family() if app else config.FONT_FAMILY
    f = QFont(fam)
    if size:
        f.setPointSize(size)
    weights = {"Light": QFont.Light, "Regular": QFont.Normal,
               "Medium": QFont.Medium, "Bold": QFont.Bold}
    f.setWeight(weights.get(weight, QFont.Normal))
    return f
