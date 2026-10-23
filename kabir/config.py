# -*- coding: utf-8 -*-
"""پیکربندی مسیرها و تنظیمات سراسری کبیر (رابط وب) — مستقل از سیستم‌عامل."""

from __future__ import annotations

import os
import platform
import sys
from pathlib import Path

from . import __version__ as APP_VERSION

APP_NAME = "کبیر"
APP_NAME_EN = "KabirCabinet"
ORG_NAME = "Kabir"

SYSTEM = platform.system()          # 'Windows' | 'Linux' | 'Darwin'
IS_WINDOWS = SYSTEM == "Windows"
IS_LINUX = SYSTEM == "Linux"
IS_MAC = SYSTEM == "Darwin"

# ---------------------------------------------------------------------------
# مسیرهای پایه
# ---------------------------------------------------------------------------


def _is_frozen() -> bool:
    """آیا برنامه به‌صورت exe بسته‌بندی‌شده در حال اجراست؟"""
    return getattr(sys, "frozen", False)


def app_dir() -> Path:
    """مسیر پوشه‌ی خود برنامه (برای دسترسی به assets)."""
    if _is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def resource_path(*parts: str) -> Path:
    """مسیر یک فایل در پوشه‌ی assets برنامه."""
    return app_dir().joinpath("assets", *parts)


def data_dir() -> Path:
    """
    مسیر ذخیره‌سازی داده‌های کاربر؛ طبق استاندارد هر سیستم‌عامل:
      ویندوز : %APPDATA%\\KabirCabinet
      لینوکس : ~/.local/share/KabirCabinet   (یا $XDG_DATA_HOME)
      مک     : ~/Library/Application Support/KabirCabinet
    """
    override = os.environ.get("KABIR_DATA_DIR")
    if override:
        p = Path(override).expanduser()
    elif IS_WINDOWS:
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        p = Path(base) / APP_NAME_EN
    elif IS_MAC:
        p = Path.home() / "Library" / "Application Support" / APP_NAME_EN
    else:
        base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
        p = Path(base) / APP_NAME_EN
    p.mkdir(parents=True, exist_ok=True)
    return p


def user_font_dir() -> Path:
    """پوشه‌ی نصب فونت کاربر (برای استفاده‌ی سایر برنامه‌ها مثل LibreOffice)."""
    if IS_WINDOWS:
        return Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "Microsoft" / "Windows" / "Fonts"
    if IS_MAC:
        return Path.home() / "Library" / "Fonts"
    return Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")) / "fonts"


DATA_DIR = data_dir()
DB_PATH = DATA_DIR / "kabir.db"
BACKUP_DIR = DATA_DIR / "backups"
EXPORT_DIR = DATA_DIR / "exports"
LOG_PATH = DATA_DIR / "kabir.log"
FONTS_CACHE_DIR = DATA_DIR / "fonts"

for _d in (BACKUP_DIR, EXPORT_DIR, FONTS_CACHE_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# فونت
# ---------------------------------------------------------------------------

FONT_FAMILY = "Vazirmatn"
FONT_FAMILY_FALLBACKS = [
    "Vazirmatn", "Vazir", "IRANSans", "IRANYekanX", "Sahel", "Noto Naskh Arabic",
    "Noto Sans Arabic", "Tahoma", "Segoe UI", "DejaVu Sans", "Arial",
]

BUNDLED_FONTS_DIR = resource_path("fonts")

FONT_FILES = [
    ("Vazirmatn-Light.ttf", "Light"),
    ("Vazirmatn-Regular.ttf", "Regular"),
    ("Vazirmatn-Medium.ttf", "Medium"),
    ("Vazirmatn-Bold.ttf", "Bold"),
]

# منابع دانلود فونت (به ترتیب تلاش می‌شوند)
FONT_URLS = [
    "https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@master/fonts/ttf/{name}",
    "https://raw.githubusercontent.com/rastikerdar/vazirmatn/master/fonts/ttf/{name}",
    "https://github.com/rastikerdar/vazirmatn/raw/master/fonts/ttf/{name}",
]

# ---------------------------------------------------------------------------
# مقادیر پیش‌فرض محاسباتی
# ---------------------------------------------------------------------------

DEFAULT_SETTINGS = {
    # مشخصات فروشگاه
    "company_name": "کارگاه کابینت‌سازی کبیر",
    "company_manager": "",
    "company_phone": "",
    "company_mobile": "",
    "company_address": "",
    "company_email": "",
    "company_web": "",
    "company_logo": "",
    "invoice_footer_note": "این پیش‌فاکتور تا ۷ روز اعتبار دارد. قیمت‌ها بر اساس نرخ روز متریال محاسبه شده است.",
    "invoice_title": "پیش‌فاکتور",

    # مالی
    "currency": "ریال",
    "currency_scale": "1",              # 1 = ریال ، 10 = تومان (نمایش تقسیم بر ۱۰)
    "vat_enabled": "0",
    "vat_percent": "10",

    # محاسبات
    "default_waste_percent": "10",      # پرت ورق
    "default_overhead_percent": "0",    # سربار کارگاه
    "default_profit_mode": "markup",    # markup | margin
    "default_profit_percent": "30",
    "default_install_mode": "fixed",    # fixed | per_meter | percent
    "default_install_value": "0",

    # ابعاد استاندارد ورق
    "sheet_width_cm": "183",
    "sheet_height_cm": "366",
    "sheet_thickness_mm": "16",
    "fiber_sheet_width_cm": "122",
    "fiber_sheet_height_cm": "244",

    # ضریب نوار PVC
    "banding_body_factor": "2.2",
    "banding_door_factor": "1.0",
    "banding_waste_percent": "8",
    "banding_width_mm": "22",

    # ظاهر
    "theme": "light",
    "font_size": "12",
    "web_font_size": "14",
    "table_row_height": "34",
    "persian_digits": "1",
    "show_decimals": "0",
    "lang_direction": "rtl",

    # پشتیبان‌گیری
    "auto_backup": "1",
    "backup_keep": "30",

    # متفرقه
    "last_project_id": "",
    "first_run_done": "0",
}

MAX_STYLES = 20
MAX_DOOR_MODELS = 25

# لینک‌های کمکی
HELP_URLS = {
    "vazirmatn": "https://rastikerdar.github.io/vazirmatn/",
}
