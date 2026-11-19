# -*- coding: utf-8 -*-
"""پیکربندی مسیرها و تنظیمات سراسری کابینت سازی عرفان (رابط وب) — مستقل از سیستم‌عامل."""

from __future__ import annotations

import os
import platform
import sys
from pathlib import Path

from . import __version__ as APP_VERSION

APP_NAME = "کابینت سازی عرفان"
APP_NAME_EN = "ErfanCabinet"
ORG_NAME = "Erfan Cabinet"
#: نامِ پیشینِ پوشه‌ی داده — برای مهاجرتِ بی‌دردسرِ نسخه‌های قبلی
LEGACY_APP_NAME_EN = "KabirCabinet"

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
      ویندوز : %APPDATA%\\ErfanCabinet
      لینوکس : ~/.local/share/ErfanCabinet   (یا $XDG_DATA_HOME)
      مک     : ~/Library/Application Support/ErfanCabinet
    """
    override = os.environ.get("ERFAN_DATA_DIR") or os.environ.get("KABIR_DATA_DIR")
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

    # مهاجرتِ یک‌باره: اگر پوشه‌ی نامِ قدیمی وجود دارد و پوشه‌ی تازه ساخته
    # نشده، همان داده‌ها (متریال، پروژه‌ها، فاکتورها) به مسیر تازه منتقل
    # می‌شوند تا کاربر نسخه‌ی جدید را با پایگاه‌داده‌ی خالی شروع نکند.
    if not override and not p.exists():
        legacy = p.with_name(LEGACY_APP_NAME_EN)
        if legacy.is_dir():
            try:
                legacy.rename(p)
            except OSError:
                import shutil
                shutil.copytree(legacy, p, dirs_exist_ok=True)

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
    "company_name": "کارگاه کابینت سازی عرفان",
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
    "currency": "تومان",
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

    # ابعاد پیش‌فرض یونیت‌ها (به تفکیک نوع) — هنگام ساخت یونیت جدید یا
    # تغییر نوع یونیت در ویرایشگر پروژه به‌صورت خودکار اعمال می‌شوند.
    "unit_ground_length_cm": "60",     # زمینی
    "unit_ground_height_cm": "72",
    "unit_ground_depth_cm": "55",
    "unit_ground_shelves": "1",
    "unit_wall_length_cm": "60",       # دیواری
    "unit_wall_height_cm": "70",
    "unit_wall_depth_cm": "30",
    "unit_wall_shelves": "1",
    "unit_tall_length_cm": "60",       # کمد ایستاده
    "unit_tall_height_cm": "220",
    "unit_tall_depth_cm": "58",
    "unit_tall_shelves": "2",

    # ابعاد پیش‌فرض در و کشو — هنگام «افزودن در/کشو» در ویرایشگر اعمال می‌شوند
    "default_door_qty": "1",           # تعداد لنگه در هر ردیف در
    "default_door_w_cm": "45",         # عرض هر لنگه
    "default_door_h_cm": "70",         # ارتفاع در
    "default_door_gas_springs_per_leaf": "0",
    "default_door_glass": "0",
    "default_door_from_body": "0",
    "default_door_label": "در",
    "default_drawer_qty": "1",
    "default_drawer_label": "کشو",
    "default_unit_qty": "1",
    "default_drawer_w_cm": "60",
    "default_drawer_h_cm": "18",
    "default_drawer_d_cm": "45",
    "default_facade_label": "ردیف درنما",
    "default_facade_qty": "1",
    "default_facade_w_cm": "100",
    "default_facade_h_cm": "60",
    "default_facade_price_per_sqm": "300000",
    "default_extra_label": "قلم جدید",
    "default_extra_qty": "1",
    "default_extra_unit": "piece",
    "default_extra_price": "500000",
    "default_service_label": "خدمت جدید",
    "default_service_basis": "fixed",
    "default_service_qty": "1",
    "default_service_price": "300000",

    # ── پیش‌فرضِ متریال و یراقِ «جزئیات» ────────────────────────────────
    # شناسه‌ی قلم‌های کتابخانه (۰ = خالی). یونیت/در/کشوی تازه با همین‌ها
    # پر می‌شود تا کاربر مجبور نباشد هر بار ۶ انتخاب تکرار کند.
    # یونیت
    "default_unit_body_id": "",
    "default_unit_back_id": "",
    "default_unit_banding_id": "",
    "default_unit_countertop_id": "",
    "default_unit_crown_id": "",
    "default_unit_underlight_id": "",
    "default_unit_kickboard_id": "",
    "default_unit_leg_id": "",
    "default_unit_shelf_pin_id": "",
    "default_unit_assembly_id": "",
    "default_unit_banding_mode": "auto",
    "default_unit_legs_per_unit": "4",
    "default_unit_pins_per_shelf": "4",
    "default_unit_has_top_panel": "1",
    "default_unit_has_bottom_panel": "1",
    # در
    "default_door_material_id": "",
    "default_door_model_id": "",
    "default_door_hinge_id": "",
    "default_door_gas_spring_id": "",
    "default_door_handle_id": "",
    "default_door_banding_id": "",
    "default_door_assembly_id": "",
    "default_door_packaging_id": "",
    "default_door_hinges_per_leaf": "2",
    "default_door_handles_per_leaf": "1",
    # کشو
    "default_drawer_slide_id": "",
    "default_drawer_sheet_id": "",
    "default_drawer_front_id": "",
    "default_drawer_handle_id": "",
    "default_drawer_banding_id": "",
    "default_drawer_assembly_id": "",
    #: ★ اولویتِ پیش‌فرض‌های من بر متریالِ «سبک» (قابل تغییر در تنظیمات)
    #:   ۱ (پیش‌فرض) = انتخاب‌های تنظیمات روی سبک می‌نشینند؛ سبک فقط جاهای خالی را
    #:   ۰ = متریالِ سبک اولویت دارد و پیش‌فرض‌ها فقط جاهای خالیِ سبک را پر می‌کنند
    "defaults_beat_style": "1",

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
