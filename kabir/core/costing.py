# -*- coding: utf-8 -*-
"""
موتور محاسبه‌ی قیمت تمام‌شده‌ی کابینت
=====================================
این ماژول قلب نرم‌افزار است: ابعاد یونیت‌ها + متریال انتخابی را می‌گیرد و
ریز هزینه‌ها را با فرمول‌های فنی و قابل‌دفاع محاسبه می‌کند.

فرمول‌های کلیدی
---------------
مساحت بدنه هر یونیت (بدون پرت):
    ۲ × عمق × ارتفاع          (دو بدنه‌ی کناری)
  + ۲ × عرض × عمق            (کف و سقف یونیت)
  + عرض × ارتفاع             (فیبر پشت)
  + n × عرض × عمق            (طبقات داخلی)

مساحت در:
    Σ (عرض در × ارتفاع در)

متراژ نوار PVC بدنه:
    مساحت بدنه × ضریب نوار (پیش‌فرض ۲٫۲ متر به ازای هر مترمربع)
متراژ نوار در:
    محیط در × تعداد × ضریب (پیش‌فرض ۱)

تعداد ورق مصرفی:
    ceil( مساحت کل با احتساب پرت / مساحت مفید ورق )

سود:
    مارکاپ : فروش = هزینه × (۱ + درصد/۱۰۰)
    مارجین : فروش = هزینه / (۱ − درصد/۱۰۰)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# ثابت‌ها
# ---------------------------------------------------------------------------

#: انواع یونیت
UNIT_TYPES = {
    "ground": "زمینی",
    "wall": "دیواری",
    "tall": "کمد ایستاده",
    "drawer": "پکیج کشو",
    "open": "شلف / قفسه باز",
}

#: مدل‌های در
DOOR_MODELS = {
    "single": "یک‌لنگه",
    "double": "دولنگه",
    "flap": "جکی (افقی بازشو)",
    "lift": "آسانسوری / تاشو",
    "glass": "شیشه‌ای (قاب آلومینیوم)",
    "none": "بدون در (باز)",
}

#: واحدهای اندازه‌گیری متریال
PRICE_UNITS = {
    "sheet": "ورق",
    "sqm": "متر مربع",
    "lm": "متر طول",
    "piece": "عدد",
    "set": "ست",
    "kg": "کیلوگرم",
    "job": "موردی",
}

#: دسته‌های متریال
CATEGORIES = [
    ("body_sheet", "ورق بدنه", "sheet"),
    ("door_sheet", "ورق در", "sheet"),
    ("back_sheet", "فیبر پشت", "sheet"),
    ("drawer_sheet", "ورق بدنه‌ی کشو", "sheet"),
    ("door_model", "مدل در", "piece"),
    ("countertop", "صفحه کابینت", "lm"),
    ("crown", "تاج", "lm"),
    ("underlight", "زیرچراغ", "lm"),
    ("kickboard", "پاخور", "lm"),
    ("banding", "نوار بدنه و در", "lm"),
    ("hinge", "لولا", "piece"),
    ("gas_spring", "گازور / جک", "piece"),
    ("shelf_pin", "خار طبقه", "piece"),
    ("handle", "دستگیره", "piece"),
    ("leg", "پایه", "piece"),
    ("drawer_slide", "ریل کشو", "set"),
    ("accessory", "سایر اکسسوری", "piece"),
    ("service", "خدمات", "job"),
]

CATEGORY_LABELS = {k: v for k, v, _ in CATEGORIES}
CATEGORY_UNITS = {k: u for k, _, u in CATEGORIES}

#: دسته‌هایی که قیمتشان بر اساس ورق است و نیاز به تبدیل به مترمربع دارند
SHEET_CATEGORIES = {"body_sheet", "door_sheet", "back_sheet", "drawer_sheet"}


# ---------------------------------------------------------------------------
# ساختارهای داده
# ---------------------------------------------------------------------------

@dataclass
class Material:
    """یک قلم متریال/خدمت از کتابخانه‌ی قیمت‌ها."""
    id: int = 0
    name: str = ""
    category: str = "accessory"
    unit: str = "piece"
    price: float = 0.0
    # مشخصات ورق
    sheet_width_cm: float = 0.0
    sheet_height_cm: float = 0.0
    thickness_mm: float = 0.0
    # مشخصات صفحه / تاج / پاخور (عرض مؤثر برای تبدیل متر طول به مترمربع)
    width_cm: float = 0.0
    supplier: str = ""
    note: str = ""

    # --- محاسبات کمکی ---
    @property
    def sheet_area_sqm(self) -> float:
        w, h = _pos(self.sheet_width_cm), _pos(self.sheet_height_cm)
        if w > 0 and h > 0:
            return (w / 100.0) * (h / 100.0)
        return 0.0

    @property
    def has_sheet_dims(self) -> bool:
        """آیا ابعادِ ورق ثبت شده است؟

        ★ این پرچم برای تشخیص حالت «ورقِ بی‌ابعاد» اضافه شد: چنین قلمی
          ``price_per_sqm = 0`` می‌داد و در نتیجه **کل بدنه رایگان** و بی‌صدا
          محاسبه می‌شد. اکنون موتور می‌تواند این حالت را تشخیص دهد و هشدار
          صریح بدهد (به‌جای عدد صفرِ بی‌صدا)."""
        return self.sheet_area_sqm > 0.0

    @property
    def price_per_sqm(self) -> float:
        """قیمت هر مترمربع؛ برای ورق‌ها از قیمت ورق محاسبه می‌شود."""
        if self.unit == "sheet":
            a = self.sheet_area_sqm
            return self.price / a if a > 0 else 0.0
        if self.unit == "sqm":
            return self.price
        if self.unit == "lm" and self.width_cm:
            return self.price / (self.width_cm / 100.0)
        return self.price

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class PanelRow:
    """یک قلم از ریزِ بدنه‌ی یونیت (قابل ویرایش دستی توسط کاربر)."""
    label: str
    qty: float
    w_cm: float
    h_cm: float
    material_key: str = "body"       # body | back | drawer
    banding: bool = True
    enabled: bool = True

    @property
    def area_sqm(self) -> float:
        """
        مساحت یک پنل (م²).

        ★ کرانِ صفر: یک پنلِ منفی (``qty=-3`` یا ``w_cm=-40``) پیش‌تر مساحت
          منفی می‌ساخت و مساحتِ پنلِ مثبتِ کنارش را **خنثی** می‌کرد؛ نتیجه
          ورقِ کم‌تر و قیمتِ کم‌تر از واقعیت بود، بدون هیچ هشداری. ابعاد منفی
          معنای فیزیکی ندارد، پس کفِ صفر دارد (هشدارش در ``calc_unit`` صادر
          می‌شود تا بی‌صدا نماند).
        """
        if not self.enabled:
            return 0.0
        a = _f(self.qty) * (_pos(self.w_cm) / 100.0) * (_pos(self.h_cm) / 100.0)
        return a if a > 0.0 else 0.0


@dataclass
class DoorRow:
    """یک لنگه در."""
    label: str = "در"
    qty: int = 2
    w_cm: float = 45.0
    h_cm: float = 70.0
    model: str = "single"
    material_id: int = 0
    material_name: str = ""
    door_model_id: int = 0
    door_model_name: str = ""
    door_model_price: float = 0.0
    hinge_id: int = 0
    hinge_name: str = ""
    hinge_price: float = 0.0
    hinges_per_leaf: int = 2
    gas_spring_id: int = 0
    gas_spring_name: str = ""
    gas_spring_price: float = 0.0
    gas_springs_per_leaf: int = 0
    handle_id: int = 0
    handle_name: str = ""
    handle_price: float = 0.0
    handles_per_leaf: int = 1
    banding_id: int = 0
    banding_name: str = ""
    banding_price: float = 0.0
    assembly_id: int = 0
    assembly_name: str = ""
    assembly_price: float = 0.0
    packaging_id: int = 0
    packaging_name: str = ""
    packaging_price: float = 0.0
    glass: bool = False
    note: str = ""
    #: ★ «در از ورق بدنه» — اگر تیک خورده باشد، لنگه‌ها به‌جای ورقِ جداگانه‌ی در،
    #:   از همان ورقی برش می‌خورند که بدنه‌ی یونیت از آن است. این‌طور مساحت در
    #:   با مساحت بدنه یک‌جا گرد می‌شود و ورق کم‌تری خریداری می‌شود.
    from_body: bool = False

    @property
    def leaves(self) -> int:
        """
        تعداد لنگه‌ها.

        ★ ``int(self.qty)`` روی ``None`` → ``TypeError`` و روی ``"2"`` →
          ``ValueError`` می‌داد: یعنی یک در با «تعداد» خالی یا متنی، کل موتور
          را می‌خواباند. اکنون تبدیلِ امن + کرانِ صفر (لنگه‌ی منفی نداریم).
        """
        return max(0, _i(self.qty))

    @property
    def area_sqm(self) -> float:
        return self.leaves * (_pos(self.w_cm) / 100.0) * (_pos(self.h_cm) / 100.0)

    @property
    def perimeter_m(self) -> float:
        return 2 * ((_pos(self.w_cm) + _pos(self.h_cm)) / 100.0)

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "DoorRow":
        return cls(**_coerce(cls, d))


@dataclass
class DrawerRow:
    """یک ردیف کشو."""
    label: str = "کشو"
    qty: int = 3
    w_cm: float = 80.0
    h_cm: float = 18.0
    d_cm: float = 45.0
    slide_id: int = 0
    slide_name: str = ""
    slide_price: float = 0.0
    handle_id: int = 0
    handle_name: str = ""
    handle_price: float = 0.0
    sheet_id: int = 0
    sheet_name: str = ""
    sheet_price_per_sqm: float = 0.0
    front_id: int = 0                 # متریال تیره‌ی کشو (معمولاً همان ورق در)
    front_name: str = ""
    front_price_per_sqm: float = 0.0
    banding_id: int = 0
    banding_name: str = ""
    banding_price: float = 0.0
    assembly_id: int = 0
    assembly_name: str = ""
    assembly_price: float = 0.0
    note: str = ""

    @property
    def box_area_sqm(self) -> float:
        """مساحت بدنه‌ی جعبه‌ی کشو: ۲ بغل + کف + پشت (کرانِ صفر — ابعاد منفی
        پیش‌تر مساحت منفی و در نتیجه «کشوی منفی/رایگان» می‌ساخت)."""
        w, h, d = _pos(self.w_cm) / 100.0, _pos(self.h_cm) / 100.0, _pos(self.d_cm) / 100.0
        return (2 * d * h) + (w * d) + (w * h)

    @property
    def front_area_sqm(self) -> float:
        return (_pos(self.w_cm) / 100.0) * (_pos(self.h_cm) / 100.0)

    @property
    def banding_m(self) -> float:
        """متراژ نوار لبه‌ی جعبه‌ی کشو (دور تا دور قطعات)."""
        w, h, d = _pos(self.w_cm) / 100.0, _pos(self.h_cm) / 100.0, _pos(self.d_cm) / 100.0
        return 2 * (2 * (d + h)) + 2 * (w + d) + 2 * (w + h)

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "DrawerRow":
        return cls(**_coerce(cls, d))


@dataclass
class DetailRow:
    """یک قلم درنما به حالت «ریز»."""
    label: str = ""
    qty: float = 1
    w_cm: float = 0.0
    h_cm: float = 0.0
    price_per_sqm: float = 0.0

    @property
    def area_sqm(self) -> float:
        return _f(self.qty) * (_pos(self.w_cm) / 100.0) * (_pos(self.h_cm) / 100.0)

    @property
    def cost(self) -> float:
        return self.area_sqm * _pos(self.price_per_sqm)

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "DetailRow":
        return cls(**_coerce(cls, d))


@dataclass
class ExtraRow:
    """یک قلم اضافه/اکسسوری جانبی (مثل نورپردازی، سینک، هود)."""
    label: str = ""
    qty: float = 1
    unit: str = "piece"
    price: float = 0.0
    note: str = ""
    visible: bool = True

    @property
    def cost(self) -> float:
        """
        ★ کرانِ صفر: قلمِ اضافه با تعداد/قیمت منفی پیش‌تر بی‌صدا از جمع کل
          **کم** می‌کرد (تخفیفِ پنهان و غیرمجاز روی سند مالی). اکسسوری با
          تعداد یا بهای منفی وجود خارجی ندارد.
        """
        return _pos(self.qty) * _pos(self.price)

    def unit_label(self) -> str:
        return PRICE_UNITS.get(self.unit, self.unit)

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "ExtraRow":
        return cls(**_coerce(cls, d))


@dataclass
class ServiceRow:
    """هزینه‌ی خدمات (مونتاژ، بسته‌بندی، حمل، طراحی و ...)."""
    label: str = ""
    basis: str = "unit"          # unit | door | shelf | sqm | lm | fixed | percent
    qty: float = 1
    price: float = 0.0
    note: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "ServiceRow":
        return cls(**_coerce(cls, d))


@dataclass
class UnitRow:
    """یک یونیت کابینت با ابعاد و تجهیزات کامل."""
    id: str = ""
    label: str = "یونیت زمینی"
    unit_type: str = "ground"
    qty: int = 1
    length_cm: float = 90.0
    height_cm: float = 72.0
    depth_cm: float = 55.0
    shelves: int = 1
    doors: List[DoorRow] = field(default_factory=list)
    drawers: List[DrawerRow] = field(default_factory=list)
    # متریال‌ها (شناسه + کپی قیمت برای ثبت در تاریخچه)
    body_id: int = 0
    body_name: str = ""
    back_id: int = 0
    back_name: str = ""
    countertop_id: int = 0
    countertop_name: str = ""
    crown_id: int = 0
    crown_name: str = ""
    underlight_id: int = 0
    underlight_name: str = ""
    kickboard_id: int = 0
    kickboard_name: str = ""
    leg_id: int = 0
    leg_name: str = ""
    leg_price: float = 0.0
    #: تعداد پایه در هر یونیت — پیش‌فرض ۴ (دو جلو، دو عقب)؛ با رابط وب و
    #: موتور JS هم‌تراز شد (پیش‌تر این‌جا ۲ بود و قیمت پایه‌ها نصف می‌شد).
    legs_per_unit: float = 4
    banding_id: int = 0
    banding_name: str = ""
    banding_price: float = 0.0
    shelf_pin_id: int = 0
    shelf_pin_name: str = ""
    shelf_pin_price: float = 0.0
    pins_per_shelf: int = 4
    assembly_id: int = 0
    assembly_name: str = ""
    assembly_price: float = 0.0
    # تنظیمات
    has_top_panel: bool = True
    has_bottom_panel: bool = True
    custom_panels: Optional[List[Dict[str, Any]]] = None   # اگر کاربر ریز بدنه را دستی عوض کرد
    note: str = ""

    def to_dict(self) -> Dict[str, Any]:
        d = dict(self.__dict__)
        d["doors"] = [x.to_dict() for x in self.doors]
        d["drawers"] = [x.to_dict() for x in self.drawers]
        return d

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "UnitRow":
        d = dict(d or {})
        doors = [DoorRow.from_dict(x) for x in d.pop("doors", []) or []]
        drawers = [DrawerRow.from_dict(x) for x in d.pop("drawers", []) or []]
        obj = cls(**_coerce(cls, d))
        obj.doors = doors
        obj.drawers = drawers
        return obj


@dataclass
class Page:
    """یک «صفحه»/بخش پروژه با یک سبک مشخص (پشتیبانی از پروژه‌های ترکیبی)."""
    id: int = 0
    project_id: int = 0
    name: str = "بخش ۱"
    style_id: int = 0
    style_name: str = ""
    units: List[UnitRow] = field(default_factory=list)
    extras: List[ExtraRow] = field(default_factory=list)
    services: List[ServiceRow] = field(default_factory=list)
    # درنما
    detail_mode: str = "none"        # none | detailed | total
    detail_rows: List[DetailRow] = field(default_factory=list)
    detail_total_sqm: float = 0.0
    detail_price_per_sqm: float = 0.0
    # ضرایب
    waste_percent: float = 10.0
    overhead_percent: float = 0.0
    banding_body_factor: float = 2.2
    banding_door_factor: float = 1.0
    banding_waste_percent: float = 8.0
    # صفحه‌ی کابینت به‌صورت کلی
    countertop_lm: float = 0.0
    # طول اندازه‌گیری‌شده‌ی دیوار (سانتی‌متر) — فقط برای کنترل خطا در ویرایشگر؛
    # در محاسبه‌ی قیمت اثری ندارد.
    wall_length_cm: float = 0.0
    note: str = ""

    def to_dict(self) -> Dict[str, Any]:
        d = dict(self.__dict__)
        d["units"] = [u.to_dict() for u in self.units]
        d["extras"] = [e.to_dict() for e in self.extras]
        d["services"] = [s.to_dict() for s in self.services]
        d["detail_rows"] = [r.to_dict() for r in self.detail_rows]
        return d

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Page":
        d = dict(d or {})
        units = [UnitRow.from_dict(x) for x in d.pop("units", []) or []]
        extras = [ExtraRow.from_dict(x) for x in d.pop("extras", []) or []]
        services = [ServiceRow.from_dict(x) for x in d.pop("services", []) or []]
        details = [DetailRow.from_dict(x) for x in d.pop("detail_rows", []) or []]
        obj = cls(**_coerce(cls, d))
        obj.units, obj.extras, obj.services, obj.detail_rows = units, extras, services, details
        return obj


@dataclass
class LineItem:
    """یک ردیف در ریز هزینه‌ها / فاکتور."""
    key: str
    group: str
    title: str
    detail: str = ""
    qty: float = 0.0
    unit_label: str = ""
    unit_price: float = 0.0
    amount: float = 0.0
    visible: bool = True
    # --- داده‌های کمکی برای تجمیع ورق، برش‌نامه و لیست خرید ---
    mat_id: int = 0                 # شناسه‌ی متریال (برای گروه‌بندی/لیست خرید)
    mat_cat: str = ""               # دسته‌ی متریال
    area_sqm: float = 0.0           # مساحت مصرفی با احتساب پرت (م²)
    sheet_area_sqm: float = 0.0     # مساحت یک ورقِ این متریال (م²)
    sheets: float = 0.0             # سهم این ردیف از ورق‌های خریداری‌شده

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "LineItem":
        return cls(**_coerce(cls, d))


@dataclass
class UnitResult:
    """نتیجه‌ی محاسبه‌ی یک یونیت."""
    label: str
    qty: int
    body_area: float = 0.0
    back_area: float = 0.0
    door_area: float = 0.0
    total_doors: int = 0
    total_drawers: int = 0
    banding_m: float = 0.0
    sheets: float = 0.0
    countertop_area: float = 0.0
    countertop_lm: float = 0.0
    cost: float = 0.0
    items: List[LineItem] = field(default_factory=list)
    #: هشدارهای محاسباتی (مثلاً «تیکِ در از ورق بدنه زده شد ولی لنگه جا نمی‌شود»)
    warnings: List[str] = field(default_factory=list)


@dataclass
class PageResult:
    """نتیجه‌ی محاسبه‌ی یک صفحه (سبک)."""
    name: str = ""
    items: List[LineItem] = field(default_factory=list)
    unit_results: List[UnitResult] = field(default_factory=list)
    # آمار فنی
    total_body_area: float = 0.0
    total_back_area: float = 0.0
    total_door_area: float = 0.0
    total_countertop_area: float = 0.0
    total_banding_m: float = 0.0
    total_sheets: float = 0.0
    total_units: int = 0
    total_doors: int = 0
    total_drawers: int = 0
    total_ground_lm: float = 0.0
    total_wall_lm: float = 0.0
    total_area_sqm: float = 0.0
    # مبالغ
    material_cost: float = 0.0
    door_cost: float = 0.0
    accessory_cost: float = 0.0
    detail_cost: float = 0.0
    labor_cost: float = 0.0
    service_cost: float = 0.0
    extra_cost: float = 0.0
    subtotal: float = 0.0
    waste_amount: float = 0.0
    overhead_amount: float = 0.0
    total_cost: float = 0.0
    warnings: List[str] = field(default_factory=list)


@dataclass
class ProjectResult:
    """نتیجه‌ی نهایی کل پروژه."""
    pages: List[PageResult] = field(default_factory=list)
    pages_cost: float = 0.0
    installation_cost: float = 0.0
    total_cost: float = 0.0
    profit_mode: str = "markup"
    profit_percent: float = 0.0
    profit_amount: float = 0.0
    gross_price: float = 0.0
    discount_percent: float = 0.0
    discount_amount_input: float = 0.0
    discount_amount: float = 0.0
    net_price: float = 0.0
    vat_percent: float = 0.0
    vat_amount: float = 0.0
    final_price: float = 0.0
    # پیش‌پرداخت / باقی‌مانده (فقط نمایشی — در محاسبه‌ی سود اثر ندارد)
    deposit_percent: float = 0.0
    deposit_amount: float = 0.0
    remaining_amount: float = 0.0
    # قیمت هر متر طول (زبان رایج بازار کابینت)
    price_per_ground_lm: float = 0.0
    price_per_total_lm: float = 0.0
    cost_per_ground_lm: float = 0.0
    # آمار تجمیعی
    stats: Dict[str, float] = field(default_factory=dict)
    items: List[LineItem] = field(default_factory=list)
    #: هشدارهای محاسباتی کل پروژه (بدون اثر روی مبلغ — فقط اطلاع به کاربر)
    warnings: List[str] = field(default_factory=list)

    @property
    def total_profit(self) -> float:
        return self.final_price - self.total_cost - self.vat_amount


# ---------------------------------------------------------------------------
# توابع کمکی
# ---------------------------------------------------------------------------

def _f(v, default=0.0) -> float:
    """
    تبدیل امن به ``float``.

    ★ چرا سخت‌گیرانه‌تر شد:
    نسخه‌ی پیشین فقط ``TypeError``/``ValueError`` را می‌گرفت. در نتیجه:
      • ``float("nan")``  → سالم رد می‌شد و تا انتهای زنجیره می‌رفت؛ خروجی API
        به ``{"final_price": NaN}`` تبدیل می‌شد که **JSON نامعتبر** است و
        ``JSON.parse`` در مرورگر می‌ترکد. در SQLite هم ستون REAL آن را NULL
        ذخیره می‌کرد و قیمت بی‌صدا «صفر» می‌شد.
      • ``float("1e999")`` → ``inf`` می‌داد و در ضرب‌های بعدی ``OverflowError``.
      • ``float(10**400)`` → مستقیماً ``OverflowError`` می‌داد (کرش موتور).
    اکنون هر مقدار «غیرمتناهی» معادل «ناموجود» است و مقدار پیش‌فرض برمی‌گردد.
    """
    try:
        x = float(v)
    except (TypeError, ValueError, OverflowError):
        return float(default)
    if x != x or x == math.inf or x == -math.inf:      # NaN / ±inf
        return float(default)
    return x


def _i(v, default: int = 0) -> int:
    """
    تبدیل امن به ``int`` با **برش** (truncate) — هم‌تراز با ``Math.trunc`` در
    موتور JS.

    ★ چرا لازم بود: در چند جا ``int(...)`` مستقیم روی ورودیِ کاربر صدا زده
      می‌شد. ``int("2.7")`` → ``ValueError`` و ``int(None)`` → ``TypeError``؛
      یعنی یک رشته‌ی ساده در فیلد «تعداد کشو» کل موتور را می‌خواباند و چون
      ``recalc`` استثنا را می‌بلعد، پروژه برای همیشه روی ۵۰۰ می‌ماند.
    """
    return int(math.trunc(_f(v, default)))


def _pos(v, default: float = 0.0) -> float:
    """
    ``float`` **نامنفی** — برای ابعاد، تعدادها و ضرایب فیزیکی.

    ★ چرا: مقدار منفی برای «عمق»، «تعداد طبقه» یا «ضریب نوار» هیچ معنای
      فیزیکی ندارد، ولی پیش‌تر بی‌صدا در فرمول ضرب می‌شد و:
        depth_cm = -55   → مساحت منفی → **قیمت کل منفی** (−380,820 ریال)
        shelves  = -3    → قیمت 1,000,000 می‌شد 400,000 (تخفیف پنهان)
        banding_body_factor = -2.2 → ردیف نوار با مبلغ منفی
      منفی‌ها یکدیگر را خنثی می‌کردند و سند مالیِ غلط تولید می‌شد.
    """
    x = _f(v, default)
    return x if x > 0.0 else 0.0


# ---------------------------------------------------------------------------
# لایه‌ی «نرمال‌سازی نوع» ورودی‌ها
# ---------------------------------------------------------------------------
#: نوعِ اعلام‌شده‌ی فیلدهای عددی هر dataclass.
#: ★ چرا لازم است: همه‌ی ``from_dict``ها پیش‌تر مقادیر خامِ JSON را بدون هیچ
#:   تبدیلی داخل dataclass می‌ریختند (``cls(**{k: v ...})``). یعنی رشته‌ی
#:   ``"2.7"``، ``null``، ``"1"`` و ``"nan"`` دست‌نخورده به عملگرهای حسابی
#:   می‌رسیدند و موتور با ``TypeError``/``ValueError`` می‌ترکید. چون
#:   ``recalc_all_projects`` استثنا را می‌بلعد، یک پروژه‌ی آلوده برای همیشه
#:   قیمت کهنه/خطای ۵۰۰ تولید می‌کرد. اکنون همه‌ی ورودی‌ها در همان مرزِ
#:   ورود به موتور به نوعِ درست تبدیل می‌شوند.
_FIELD_KINDS: Dict[str, Dict[str, Tuple[str, ...]]] = {
    "PanelRow": {
        "float": ("qty", "w_cm", "h_cm"),
        "bool": ("banding", "enabled"),
    },
    "DoorRow": {
        "int": ("qty", "material_id", "door_model_id", "hinge_id", "hinges_per_leaf",
                "gas_spring_id", "gas_springs_per_leaf", "handle_id", "handles_per_leaf",
                "banding_id", "assembly_id", "packaging_id"),
        "float": ("w_cm", "h_cm", "door_model_price", "hinge_price", "gas_spring_price",
                  "handle_price", "banding_price", "assembly_price", "packaging_price"),
        "bool": ("glass", "from_body"),
    },
    "DrawerRow": {
        "int": ("qty", "slide_id", "handle_id", "sheet_id", "front_id", "banding_id",
                "assembly_id"),
        "float": ("w_cm", "h_cm", "d_cm", "slide_price", "handle_price",
                  "sheet_price_per_sqm", "front_price_per_sqm", "banding_price",
                  "assembly_price"),
    },
    "DetailRow": {
        "float": ("qty", "w_cm", "h_cm", "price_per_sqm"),
    },
    "ExtraRow": {
        "float": ("qty", "price"),
        "bool": ("visible",),
    },
    "ServiceRow": {
        "float": ("qty", "price"),
    },
    "UnitRow": {
        "int": ("qty", "shelves", "body_id", "back_id", "countertop_id", "crown_id",
                "underlight_id", "kickboard_id", "leg_id", "banding_id", "shelf_pin_id",
                "pins_per_shelf", "assembly_id"),
        "float": ("length_cm", "height_cm", "depth_cm", "leg_price", "legs_per_unit",
                  "banding_price", "shelf_pin_price", "assembly_price"),
        "bool": ("has_top_panel", "has_bottom_panel"),
    },
    "Page": {
        "int": ("id", "project_id", "style_id"),
        "float": ("waste_percent", "overhead_percent", "banding_body_factor",
                  "banding_door_factor", "banding_waste_percent", "countertop_lm",
                  "wall_length_cm", "detail_total_sqm", "detail_price_per_sqm"),
    },
    "LineItem": {
        "int": ("mat_id",),
        "float": ("qty", "unit_price", "amount", "area_sqm", "sheet_area_sqm", "sheets"),
        "bool": ("visible",),
    },
}


def _coerce(cls, d: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    پاک‌سازی یک dict پیش از ساخت dataclass: کلیدهای ناشناخته دور ریخته و
    فیلدهای عددی/منطقی به نوعِ اعلام‌شده تبدیل می‌شوند.

    ★ قاعده‌ی مهم: اگر مقدار «ناموجود/خراب» باشد (``None``، ``""``، ``"abc"``،
      ``NaN``) کلید **حذف** می‌شود تا پیش‌فرضِ خودِ dataclass اعمال شود — نه
      صفرِ دلخواه. این‌طور یک فیلد خالی، «تعداد ۰» معنی نمی‌شود و هم‌زمان با
      موتور JS (که از ``defaultUnit()``/``normalizePage()`` همان پیش‌فرض‌ها را
      تزریق می‌کند) هم‌راستا می‌ماند.
    """
    kinds = _FIELD_KINDS.get(cls.__name__, {})
    ints = set(kinds.get("int", ()))
    floats = set(kinds.get("float", ()))
    bools = set(kinds.get("bool", ()))
    known = set(cls.__dataclass_fields__)
    out: Dict[str, Any] = {}
    for k, v in (d or {}).items():
        if k not in known or v is None:
            continue
        if k in bools:
            if isinstance(v, str):
                if v.strip().lower() in ("", "0", "false", "no", "off"):
                    v = False
                else:
                    v = True
            out[k] = bool(v)
        elif k in ints:
            if isinstance(v, str) and not v.strip():
                continue
            out[k] = _i(v)
        elif k in floats:
            if isinstance(v, str) and not v.strip():
                continue
            out[k] = _f(v)
        else:
            out[k] = v
    return out


def round_up_sheets(area_sqm: float, sheet_area: float, waste_percent: float = 0.0) -> float:
    """تعداد ورق لازم (با گرد کردن به بالا)."""
    sheet_area = _f(sheet_area)
    if sheet_area <= 0:
        return 0.0
    a = _pos(area_sqm) * (1 + _pos(waste_percent) / 100.0)
    return float(math.ceil(round(a / sheet_area, 6)))


#: کلیدواژه‌هایی که نشان می‌دهند ورق «راستای طرح» دارد (چرخاندنِ قطعه روی آن
#: نقش چوب/راه‌راه را خراب می‌کند). همان فهرستی که برش‌نامه برای علامتِ
#: «راستا» استفاده می‌کند — یکی بودنِ این دو، رفتار را در کل برنامه هم‌راستا
#: نگه می‌دارد.
GRAIN_KEYWORDS = ("طرح چوب", "راه‌راه", "راشه", "گردو", "طرح‌دار")


def material_has_grain(mat: Optional["Material"]) -> bool:
    """آیا ورق راستای طرح دارد؟ (بر اساس نام/یادداشتِ قلم در کتابخانه قیمت)"""
    if mat is None:
        return False
    hay = f"{mat.name} {mat.note or ''}"
    return any(k in hay for k in GRAIN_KEYWORDS)


def door_leaf_fits_sheet(dr: "DoorRow", mat: Optional["Material"]) -> Tuple[bool, str]:
    """
    ★ آیا یک لنگه‌ی در روی این ورق جا می‌شود؟

    شرطِ لازم (نه کافی) برای «در از ورق بدنه»: بزرگ‌ترین لنگه باید در یکی از دو
    جهت روی ورق بنشیند. چیدمان بهینه‌ی برش مسئله‌ی دیگری است، ولی اگر همین شرط
    ساده برقرار نباشد، ساختنِ در از آن ورق قطعاً ممکن نیست و نباید تیک بخورد.

    ★ ورقِ طرح‌دار (راستای نقش) استثنا دارد: قطعه فقط «بدون چرخش» قابل برش است،
    وگرنه نقشِ در کج می‌افتد. پیش‌تر چرخش برای همه‌ی ورق‌ها مجاز بود و برنامه
    برای ورق طرح چوب، تیکی را مجاز می‌کرد که در عمل نقش را خراب می‌کرد.

    خروجی: (امکان‌پذیر است؟، دلیلِ فارسی در صورت رد)
    """
    if mat is None:
        return False, "ورق بدنه‌ی یونیت انتخاب نشده است."
    if mat.unit != "sheet":
        return False, f"«{mat.name}» ورق نیست (واحد: {mat.unit})."
    sw, sh = _f(mat.sheet_width_cm), _f(mat.sheet_height_cm)
    if sw <= 0 or sh <= 0:
        return False, f"ابعاد ورقِ «{mat.name}» در کتابخانه قیمت ثبت نشده است."
    w, h = _f(dr.w_cm), _f(dr.h_cm)
    if w <= 0 or h <= 0:
        return False, "ابعاد لنگه‌ی در وارد نشده است."
    if w <= sw and h <= sh:
        return True, ""
    if w <= sh and h <= sw:
        if material_has_grain(mat):
            return False, (f"«{mat.name}» راستای طرح دارد؛ لنگه‌ی {w:g}×{h:g} سانت فقط "
                           f"با چرخاندن روی ورق {sw:g}×{sh:g} جا می‌شود و طرح کج می‌افتد.")
        return True, ""
    return False, (f"لنگه‌ی {w:g}×{h:g} سانت روی ورق {sw:g}×{sh:g} سانت جا نمی‌شود.")


# ---------------------------------------------------------------------------
# موتور اصلی
# ---------------------------------------------------------------------------

class CostingEngine:
    """محاسبه‌گر قیمت تمام‌شده."""

    def __init__(self, materials: Optional[List[Material]] = None,
                 settings: Optional[Dict[str, str]] = None):
        self.materials: Dict[int, Material] = {}
        for m in materials or []:
            self.materials[int(m.id)] = m
        self.s = settings or {}
        #: متنِ پایه‌ی «detail» هر ردیفِ ورقی — برای idempotent بودنِ
        #: ``batch_sheets`` وقتی دو بار (بخش، سپس پروژه) صدا زده می‌شود.
        #: کلید ``id(item)`` است و در هر ``calc_project`` خالی می‌شود.
        self._detail_base: Dict[int, str] = {}

    # --- دسترسی به متریال ---
    def mat(self, mid: int) -> Optional[Material]:
        return self.materials.get(int(mid)) if mid else None

    def setting(self, key: str, default: Any = "") -> str:
        return str(self.s.get(key, default))

    def num_setting(self, key: str, default: float = 0.0) -> float:
        return _f(self.s.get(key, default), default)

    def price_of(self, mid: int, fallback_field: float = 0.0) -> float:
        m = self.mat(mid)
        if m is not None:
            return _f(m.price)
        return _f(fallback_field)

    # ------------------------------------------------------------------
    # بدنه‌ی یونیت
    # ------------------------------------------------------------------
    def default_panels(self, u: UnitRow) -> List[PanelRow]:
        """
        ساخت ریز استاندارد بدنه‌ی یونیت بر اساس ابعاد.

        ★ همه‌ی ابعاد با کرانِ صفر خوانده می‌شوند:
          • ``depth_cm = -55`` پیش‌تر مساحتِ **منفی** می‌ساخت و اگر یونیت
            خدمتِ مترمربعی هم داشت، قیمتِ کل پروژه منفی می‌شد (−380,820).
          • ``L - 2*t`` اگر عرض یونیت از دو برابرِ ضخامت ورق کم‌تر بود منفی
            می‌شد و مساحت کف/سقف را منفی می‌کرد.
          • ``u.shelves > 0`` روی مقدارِ رشته‌ای (``"1"``) با ``TypeError``
            موتور را می‌خواباند.
        """
        t = 0.0
        bm = self.mat(u.body_id)
        if bm and _pos(bm.thickness_mm) > 0:
            t = _pos(bm.thickness_mm) / 10.0    # تبدیل به سانتی‌متر
        L, H, D = _pos(u.length_cm), _pos(u.height_cm), _pos(u.depth_cm)
        inner = max(0.0, L - 2 * t)             # عرض مؤثرِ قطعاتِ داخلی
        shelves = _pos(u.shelves)
        rows: List[PanelRow] = []

        rows.append(PanelRow("بدنه کناری (چپ و راست)", 2, D, H, "body"))
        if u.has_bottom_panel:
            rows.append(PanelRow("کف یونیت", 1, inner, D, "body"))
        if u.has_top_panel and u.unit_type != "ground":
            rows.append(PanelRow("سقف یونیت", 1, inner, D, "body"))
        if u.unit_type == "tall":
            rows.append(PanelRow("طبقه‌ی ثابت وسط", 1, inner, D, "body"))

        # طبقات داخلی
        if shelves > 0:
            rows.append(PanelRow(f"طبقه‌ی داخلی ({_i(shelves)} عدد)", shelves, inner, D, "body"))

        # فیبر پشت
        bm_back = self.mat(u.back_id)
        if bm_back is not None or u.back_id:
            rows.append(PanelRow("فیبر پشت", 1, L, H, "back"))

        # کشوها: کف و پشتِ جعبه (بغل‌ها در ردیف کشو محاسبه می‌شوند)
        return rows

    # ------------------------------------------------------------------
    @staticmethod
    def _input_warnings(u: UnitRow, res: UnitResult) -> None:
        """
        ★ هشدارِ صریح برای ورودی‌های نامعتبرِ یونیت.

        پیش‌تر ابعاد/شمارنده‌های منفی یا صفر **بی‌صدا** در فرمول می‌رفتند و
        خروجیِ ظاهراً معتبر می‌ساختند: ``depth_cm = 0`` بدنه‌ی رایگان می‌داد،
        ``shelves = -3`` قیمت را از ۱٬۰۰۰٬۰۰۰ به ۴۰۰٬۰۰۰ می‌رساند و
        ``legs_per_unit = -4`` ردیف پایه را منفی می‌کرد. اکنون همان مقادیر
        در محاسبه صفرِ مؤثرند (کرانِ صفر)، ولی کاربر **می‌بیند** که چرا.
        """
        label = u.label or "یونیت"
        for field, name in (("length_cm", "طول"), ("height_cm", "ارتفاع"),
                            ("depth_cm", "عمق")):
            raw = _f(getattr(u, field), 0.0)
            if raw < 0:
                res.warnings.append(
                    f"«{label}»: {name} یونیت منفی ({raw:g} سانتی‌متر) بود — صفر "
                    "در نظر گرفته شد. ابعاد منفی معنای فیزیکی ندارد و قیمت را "
                    "خراب می‌کند.")
            elif raw == 0 and field != "length_cm":
                res.warnings.append(
                    f"«{label}»: {name} یونیت صفر است — مساحت قطعاتِ وابسته به آن "
                    "صفر شد و هزینه‌ی ورق بدنه محاسبه نمی‌شود!")
        for field, name in (("shelves", "تعداد طبقه"), ("legs_per_unit", "تعداد پایه"),
                            ("pins_per_shelf", "خار در هر طبقه")):
            raw = _f(getattr(u, field), 0.0)
            if raw < 0:
                res.warnings.append(
                    f"«{label}»: {name} منفی ({raw:g}) بود — صفر در نظر گرفته شد "
                    "(مقدار منفی پیش‌تر بی‌صدا از قیمت کل کم می‌کرد).")

    def panels_of(self, u: UnitRow) -> List[PanelRow]:
        if u.custom_panels:
            return [PanelRow(**_coerce(PanelRow, d)) for d in u.custom_panels]
        return self.default_panels(u)

    # ------------------------------------------------------------------
    # محاسبه‌ی یک یونیت
    # ------------------------------------------------------------------
    def _sheet_price_check(self, mat: Optional[Material], res: UnitResult,
                           what: str, area_total: float) -> float:
        """
        ★ نرخِ قابل‌اتکای «هر مترمربع» برای یک قلمِ ورقی + هشدارِ صریح.

        چرا لازم بود (باگِ «بدنه‌ی رایگانِ بی‌صدا»):
        قلمی که واحدش ``sheet`` است ولی **ابعاد ورق** ندارد، در
        ``Material.price_per_sqm`` مقدار ``0`` برمی‌گرداند. در نتیجه کل بدنه
        با مساحتِ درست ولی مبلغِ صفر در فاکتور می‌نشست و چون هیچ هشداری هم
        صادر نمی‌شد، کاربر یک پیش‌فاکتورِ ظاهراً سالم و به‌شدت ارزان به مشتری
        می‌داد. فرمِ متریال فقط ``price > 0`` را چک می‌کند و ابعاد ورق اختیاری
        است، پس این حالت کاملاً قابل ساخت بود.

        همین‌جا حالتِ معکوس هم گرفته می‌شود: قلمی که دسته‌اش «ورق» است ولی
        واحدش ``piece``/``lm`` مانده، ``price_per_sqm`` را برابرِ خودِ ``price``
        برمی‌گرداند؛ یعنی «قیمتِ هر عدد» به‌جای «قیمتِ هر مترمربع» ضرب می‌شد و
        چند برابر **بیش‌گیری** می‌کرد.

        خروجی: نرخِ معتبر هر مترمربع (ممکن است صفر باشد) — این متد هرگز ردیف
        را حذف نمی‌کند، فقط آن را **قابل دیدن** می‌کند.
        """
        ppsqm = _f(mat.price_per_sqm) if mat is not None else 0.0
        if mat is None:
            return ppsqm
        if mat.unit == "sheet" and not mat.has_sheet_dims:
            res.warnings.append(
                f"«{mat.name}» به‌عنوان {what} انتخاب شده ولی ابعاد ورقِ آن ثبت "
                f"نشده است — قیمتِ هر مترمربع صفر به دست می‌آید و "
                f"{area_total:.3f} م² {what} رایگان محاسبه شد! ابعاد ورق را در "
                "کتابخانه‌ی قیمت‌ها کامل کنید.")
        elif mat.category in SHEET_CATEGORIES and mat.unit not in ("sheet", "sqm"):
            res.warnings.append(
                f"«{mat.name}» در دسته‌ی {what} است ولی واحدش «{mat.unit}» ثبت "
                "شده — قیمتِ هر عدد به‌جای قیمتِ هر مترمربع در محاسبه می‌رود و "
                "مبلغ درست نیست. واحدِ قلم را اصلاح کنید.")
        elif ppsqm <= 0:
            res.warnings.append(
                f"«{mat.name}» ({what}) قیمتِ مؤثرِ صفر دارد — "
                f"{area_total:.3f} م² بدون هزینه ثبت شد.")
        return ppsqm

    # ------------------------------------------------------------------
    def calc_unit(self, u: UnitRow, page: Page) -> UnitResult:
        # ⚠ تعداد یونیت: پیش‌تر qty=0 یا منفی به‌جای حذف، «یک عدد» قیمت می‌خورد
        #   (چون `int(u.qty or 1)` صفر را falsy می‌گرفت و max(1,..) منفی را ۱
        #   می‌کرد). اکنون تعداد مؤثر ≤ ۰ یعنی یونیت کنار گذاشته می‌شود +
        #   هشدار به کاربر (به‌جای قیمتِ بی‌صدا).
        # ★ تبدیل امن: پیش‌تر ``int("2.7")`` → ``ValueError`` و ``int(None)`` →
        #   ``TypeError`` کل موتور را می‌خواباند. اکنون مثل موتور JS با
        #   «برش» به عدد صحیح می‌رسد (۲٫۷ → ۲).
        qty = _i(u.qty, 0)
        res = UnitResult(label=u.label or "یونیت", qty=qty)
        if qty <= 0:
            res.warnings.append(
                f"«{u.label or 'یونیت'}»: تعداد یونیت {qty} وارد شده — بدون هزینه "
                "نادیده گرفته شد. اگر این یونیت را می‌خواهید، تعداد را دست‌کم ۱ "
                "بگذارید و اگر نمی‌خواهید، حذفش کنید.")
            return res
        n = qty
        items: List[LineItem] = []

        # ★ هشدارِ ورودی‌های نامعتبر (ابعاد/شمارنده‌های منفی یا صفر)
        self._input_warnings(u, res)

        body_mat = self.mat(u.body_id)
        back_mat = self.mat(u.back_id)

        panels = self.panels_of(u)
        body_area = 0.0
        back_area = 0.0
        for p in panels:
            if not p.enabled:
                continue
            if p.material_key == "back":
                back_area += p.area_sqm
            else:
                body_area += p.area_sqm

        # پرتِ منفی یعنی «مساحتِ کم‌تر از خالص» — بی‌معنی است و ورق را
        # کمتر از نیاز گرد می‌کرد. کرانِ صفر + هشدار.
        waste = _f(page.waste_percent, 10.0)
        if waste < 0:
            res.warnings.append(
                f"پرتِ ورق منفی ({waste:g}٪) بود — صفر در نظر گرفته شد.")
            waste = 0.0

        # --- ورق بدنه ---
        if body_area > 0 and body_mat is not None:
            body_ppsqm = self._sheet_price_check(body_mat, res, "ورق بدنه", body_area * n)
            per_unit_area = body_area * (1 + waste / 100.0)
            sheet_area = _f(body_mat.sheet_area_sqm)
            if sheet_area > 0:
                # ⚠ تعداد ورق در این‌جا گرد نمی‌شود! مساحت ثبت می‌شود و در
                # `_batch_sheets` کل ورق‌های همین متریال در سطح بخش یک‌جا گرد
                # می‌شوند (مثل برش واقعی کارگاه که دورریزِ یک یونیت، تکه‌ی
                # یونیت بعدی است).
                net = body_area * n
                items.append(LineItem(
                    "body_sheet", "ورق بدنه", body_mat.name,
                    f"{net:.3f} م² (با پرت {waste:.0f}٪)",
                    net, "م²", body_ppsqm, net * body_ppsqm,
                    mat_id=int(body_mat.id), mat_cat="body_sheet",
                    area_sqm=per_unit_area * n, sheet_area_sqm=sheet_area))
            else:
                amount = per_unit_area * n * body_ppsqm
                items.append(LineItem("body_sheet", "ورق بدنه", body_mat.name,
                                      f"{per_unit_area * n:.3f} م² با احتساب {waste:.0f}٪ پرت",
                                      per_unit_area * n, "م²", body_ppsqm, amount,
                                      mat_id=int(body_mat.id), mat_cat="body_sheet",
                                      area_sqm=per_unit_area * n))
            res.body_area += body_area * n
        elif body_area > 0 and body_mat is None:
            # ★ متریال بدنه انتخاب نشده یا از کتابخانه حذف شده — پیش‌تر بی‌صدا
            #   «بدنه‌ی رایگان» تولید می‌کرد! اکنون هشدار صریح می‌دهیم.
            why = "حذف شده" if u.body_id else "انتخاب نشده"
            res.warnings.append(
                f"«{u.label or 'یونیت'}»: ورق بدنه {why} است — هزینه‌ی "
                f"{body_area * n:.3f} م² بدنه محاسبه نشد!")
            res.body_area += body_area * n

        # --- فیبر پشت ---
        if back_area > 0 and back_mat is not None:
            back_ppsqm = self._sheet_price_check(back_mat, res, "فیبر پشت", back_area * n)
            per_unit_area = back_area * (1 + waste / 100.0)
            sheet_area = _f(back_mat.sheet_area_sqm)
            if sheet_area > 0:
                net = back_area * n
                items.append(LineItem("back_sheet", "فیبر پشت", back_mat.name,
                                      f"{net:.3f} م² (با پرت {waste:.0f}٪)", net, "م²",
                                      _f(back_mat.price_per_sqm),
                                      net * _f(back_mat.price_per_sqm),
                                      mat_id=int(back_mat.id), mat_cat="back_sheet",
                                      area_sqm=per_unit_area * n, sheet_area_sqm=sheet_area))
            else:
                amount = per_unit_area * n * _f(back_mat.price_per_sqm)
                items.append(LineItem("back_sheet", "فیبر پشت", back_mat.name,
                                      f"{per_unit_area * n:.3f} م²",
                                      per_unit_area * n, "م²",
                                      _f(back_mat.price_per_sqm), amount,
                                      mat_id=int(back_mat.id), mat_cat="back_sheet",
                                      area_sqm=per_unit_area * n))
            res.back_area += back_area * n
        elif back_area > 0 and back_mat is None:
            why = "حذف شده" if u.back_id else "انتخاب نشده"
            res.warnings.append(
                f"«{u.label or 'یونیت'}»: متریال فیبر پشت {why} است — هزینه‌ی "
                f"{back_area * n:.3f} م² فیبر پشت محاسبه نشد!")
            res.back_area += back_area * n

        # --- نوار PVC بدنه ---
        if body_area > 0 and u.banding_id:
            bmat = self.mat(u.banding_id)
            # ★ ضریبِ منفی پیش‌تر متراژ (و مبلغ) نوار را منفی می‌کرد و بی‌صدا
            #   از جمع کل کم می‌شد. ضریب نوار یک نسبتِ فیزیکی است → کرانِ صفر.
            factor = _f(page.banding_body_factor, 2.2)
            if factor < 0:
                res.warnings.append(
                    f"ضریب نوار بدنه منفی ({factor:g}) بود — صفر در نظر گرفته شد "
                    "(متراژ نوار منفی وجود ندارد).")
                factor = 0.0
            meters = body_area * n * factor
            meters *= (1 + _pos(page.banding_waste_percent) / 100.0)
            price = _f(bmat.price) if bmat else _f(u.banding_price)
            items.append(LineItem("banding_body", "نوار PVC بدنه",
                                  bmat.name if bmat else (u.banding_name or "نوار PVC"),
                                  f"ضریب {factor} × مساحت بدنه + {page.banding_waste_percent:.0f}٪ پرت",
                                  meters, "متر", price, meters * price,
                                  mat_id=int(u.banding_id), mat_cat="banding"))
            res.banding_m += meters

        # --- درب‌ها ---
        for dr in u.doors:
            self._calc_door(dr, n, res, items, page, body_mat)

        # --- کشوها ---
        for dw in u.drawers:
            self._calc_drawer(dw, n, res, items, page)

        # --- صفحه‌ی کابینت ---
        # اگر کاربر «متر طول صفحه» را در سطح بخش وارد کرده باشد، همان ملاک است
        # و دیگر برای هر یونیت جداگانه صفحه حساب نمی‌شود (جلوگیری از دوباره‌شماری).
        if u.countertop_id and _pos(page.countertop_lm) <= 0:
            cm = self.mat(u.countertop_id)
            if cm is not None:
                lm = _pos(u.length_cm) / 100.0 * n
                price = _f(cm.price)
                width = _f(cm.width_cm) or 60.0
                items.append(LineItem("countertop", "صفحه کابینت", cm.name,
                                      f"{lm:.2f} متر طول × عرض {width:g} سانتی‌متر",
                                      lm, "متر", price, lm * price,
                                      mat_id=int(u.countertop_id), mat_cat="countertop"))
                res.countertop_area += lm * width / 100.0
                res.countertop_lm += lm
            else:
                res.warnings.append(
                    f"«{u.label or 'یونیت'}»: متریال صفحه‌ی کابینت در کتابخانه قیمت "
                    "پیدا نشد (حذف شده؟) — هزینه‌ی صفحه محاسبه نشد!")

        # --- تاج ---
        if u.crown_id and u.unit_type in ("wall", "tall"):
            cm = self.mat(u.crown_id)
            if cm is not None:
                lm = _pos(u.length_cm) / 100.0 * n
                items.append(LineItem("crown", "تاج", cm.name, f"{lm:.2f} متر طول",
                                      lm, "متر", _f(cm.price), lm * _f(cm.price),
                                      mat_id=int(u.crown_id), mat_cat="crown"))

        # --- زیرچراغ ---
        if u.underlight_id and u.unit_type == "wall":
            cm = self.mat(u.underlight_id)
            if cm is not None:
                lm = _pos(u.length_cm) / 100.0 * n
                items.append(LineItem("underlight", "زیرچراغ", cm.name, f"{lm:.2f} متر طول",
                                      lm, "متر", _f(cm.price), lm * _f(cm.price),
                                      mat_id=int(u.underlight_id), mat_cat="underlight"))

        # --- پاخور ---
        if u.kickboard_id and u.unit_type in ("ground", "tall"):
            cm = self.mat(u.kickboard_id)
            if cm is not None:
                lm = _pos(u.length_cm) / 100.0 * n
                items.append(LineItem("kickboard", "پاخور", cm.name, f"{lm:.2f} متر طول",
                                      lm, "متر", _f(cm.price), lm * _f(cm.price),
                                      mat_id=int(u.kickboard_id), mat_cat="kickboard"))

        # --- پایه ---
        if u.leg_id and u.unit_type in ("ground", "tall"):
            legs = _pos(u.legs_per_unit, 4) * n
            price = self.price_of(u.leg_id, u.leg_price)
            items.append(LineItem("leg", "پایه", (self.mat(u.leg_id).name if self.mat(u.leg_id)
                                                  else u.leg_name) or "پایه",
                                  f"{legs:.0f} عدد", legs, "عدد", price, legs * price,
                                  mat_id=int(u.leg_id), mat_cat="leg"))

        # --- خار طبقه ---
        if u.shelf_pin_id and _pos(u.shelves) > 0:
            # ★ `_f(u.shelves)` منفی بود و `int(...)` روی رشته می‌ترکید؛
            #   تعداد منفیِ خار هم بی‌صدا از قیمت کل کم می‌کرد.
            pins = _pos(u.pins_per_shelf, 4) * _pos(u.shelves) * n
            price = self.price_of(u.shelf_pin_id, u.shelf_pin_price)
            items.append(LineItem("shelf_pin", "خار طبقه",
                                  (self.mat(u.shelf_pin_id).name if self.mat(u.shelf_pin_id)
                                   else u.shelf_pin_name) or "خار طبقه",
                                  f"{pins:.0f} عدد ({_i(u.shelves)} طبقه × {_i(u.pins_per_shelf, 4)} خار)",
                                  pins, "عدد", price, pins * price,
                                  mat_id=int(u.shelf_pin_id), mat_cat="shelf_pin"))

        # --- مونتاژ یونیت ---
        if u.assembly_id or u.assembly_price:
            price = self.price_of(u.assembly_id, u.assembly_price)
            name = (self.mat(u.assembly_id).name if self.mat(u.assembly_id)
                    else u.assembly_name) or "مونتاژ یونیت"
            items.append(LineItem("assembly_unit", "مونتاژ و خدمات", name,
                                  f"{n} یونیت", n, "یونیت", price, n * price,
                                  mat_id=int(u.assembly_id), mat_cat="service"))

        # --- اکسسوری‌های اختصاصی یونیت ---
        res.cost = sum(i.amount for i in items)
        res.items = items
        return res

    # ------------------------------------------------------------------
    def _calc_door(self, dr: DoorRow, unit_qty: int, res: UnitResult,
                   items: List[LineItem], page: Optional[Page] = None,
                   body_mat: Optional[Material] = None) -> None:
        leaves = dr.leaves * max(0, _i(unit_qty))
        if leaves <= 0:
            return
        area = dr.area_sqm * max(0, _i(unit_qty))
        res.door_area += area
        waste = _f(page.waste_percent, 10.0) if page is not None else 10.0
        if waste < 0:
            waste = 0.0

        # ★ «در از ورق بدنه»
        # اگر کاربر تیک زده باشد که لنگه‌ها از همان ورقِ بدنه برش بخورند،
        # مساحتِ در به‌جای دسته‌ی «ورق در»، به دسته‌ی «ورق بدنه» می‌رود تا با
        # بقیه‌ی قطعات بدنه یک‌جا گرد شود (دورریزِ بدنه، تکه‌ی در می‌شود).
        # اگر لنگه روی ورق جا نشود، تیک نادیده گرفته می‌شود و هشدار می‌دهیم —
        # بهتر از این است که بی‌سروصدا عددِ غلطِ ارزانی نشان دهیم.
        dmat = self.mat(dr.material_id)
        use_body = False
        if dr.from_body:
            fits, why = door_leaf_fits_sheet(dr, body_mat)
            if fits:
                use_body = True
                dmat = body_mat
            else:
                res.warnings.append(
                    f"«{dr.label or 'در'}»: تیکِ «در از ورق بدنه» نادیده گرفته شد — {why}")
                # ★ باگِ «لنگه‌ی درِ کاملاً رایگان»: وقتی تیک نادیده گرفته می‌شود
                #   موتور به متریالِ خودِ در برمی‌گردد، ولی در حالتِ پیش‌فرضِ
                #   رابط ``material_id = 0`` است (و چون تیک خورده، انتخابگرِ
                #   متریالِ در هم پنهان می‌شود). در نتیجه نه ورق بدنه مصرف شد،
                #   نه ورق در — و ``elif dr.material_id:`` هم چون شناسه صفر بود
                #   هشدار نمی‌داد. لنگه‌ها **بی‌صدا رایگان** می‌شدند.
                if dmat is None and not dr.material_id:
                    res.warnings.append(
                        f"«{dr.label or 'در'}»: متریالی برای {leaves} لنگه در "
                        f"({area:.3f} م²) انتخاب نشده — ورق در **رایگان** محاسبه "
                        "شد! یا متریالِ در را انتخاب کنید یا ابعاد لنگه را "
                        "کوچک‌تر از ورق بدنه بگیرید.")

        if use_body:
            sheet_area = _f(dmat.sheet_area_sqm)
            ppsqm = self._sheet_price_check(dmat, res, "ورق بدنه (در)", area)
            if sheet_area > 0:
                gross = area * (1 + waste / 100.0)
                items.append(LineItem(
                    "body_sheet", "ورق بدنه", dmat.name,
                    f"در از ورق بدنه — {leaves} لنگه، {area:.3f} م² (با پرت {waste:.0f}٪)",
                    area, "م²", ppsqm, area * ppsqm,
                    mat_id=int(dmat.id), mat_cat="body_sheet",
                    area_sqm=gross, sheet_area_sqm=sheet_area))
            else:
                items.append(LineItem(
                    "body_sheet", "ورق بدنه", dmat.name,
                    f"در از ورق بدنه — {leaves} لنگه، {area:.3f} م²",
                    area, "م²", ppsqm, area * ppsqm,
                    mat_id=int(dmat.id), mat_cat="body_sheet", area_sqm=area))
        elif dmat is not None:
            ppsqm = self._sheet_price_check(dmat, res, "ورق در", area)
            if dmat.unit == "sheet" and dmat.sheet_area_sqm > 0:
                # گردکردن به ورق کامل در `_batch_sheets` و در سطح کل بخش انجام
                # می‌شود (نه برای هر یونیت) — پرت هم از تنظیم بخش می‌آید نه ۸٪ ثابت.
                gross = area * (1 + waste / 100.0)
                items.append(LineItem(
                    "door_sheet", "ورق در", dmat.name,
                    f"{leaves} لنگه — {area:.3f} م² (با پرت {waste:.0f}٪)",
                    area, "م²", ppsqm, area * ppsqm,
                    mat_id=int(dmat.id), mat_cat="door_sheet",
                    area_sqm=gross, sheet_area_sqm=_f(dmat.sheet_area_sqm)))
            else:
                items.append(LineItem("door_sheet", "ورق در", dmat.name,
                                      f"{leaves} لنگه — {area:.3f} م²",
                                      area, "م²", ppsqm, area * ppsqm,
                                      mat_id=int(dmat.id), mat_cat="door_sheet",
                                      area_sqm=area))
        elif dr.material_id:
            # متریال در از کتابخانه حذف شده — بی‌صدا «درِ رایگان» ندهیم!
            res.warnings.append(
                f"«{dr.label or 'در'}»: متریال در ({dr.material_name or 'شناسهٔ ' + str(dr.material_id)}) "
                f"در کتابخانه قیمت پیدا نشد — هزینه‌ی {area:.3f} م² ورق در محاسبه نشد!")

        # هزینه‌ی ساخت/ CNC مدل در (مثلاً ممبران، هایگلاس، رنگ)
        if dr.door_model_id or dr.door_model_price:
            price = self.price_of(dr.door_model_id, dr.door_model_price)
            name = (self.mat(dr.door_model_id).name if self.mat(dr.door_model_id)
                    else dr.door_model_name) or "اجرت ساخت در"
            dm = self.mat(dr.door_model_id)
            # اجرت‌های «مترمربعی» (CNC/رنگ) باید بر اساس مساحت در حساب شوند
            qty, ulabel = leaves, "لنگه"
            if dm is not None and dm.unit == "sqm":
                qty, ulabel = area, "م²"
            items.append(LineItem("door_model", "مدل و اجرت در", name,
                                  f"{leaves} لنگه" + (f" — {area:.3f} م²" if ulabel == "م²" else ""),
                                  qty, ulabel, price, qty * price,
                                  mat_id=int(dr.door_model_id), mat_cat="door_model"))

        # نوار در
        if dr.banding_id:
            bmat = self.mat(dr.banding_id)
            if bmat is not None:
                # ★ ضریب نوار در: پیش‌تر فیلد `banding_door_factor` در تنظیمات و
                #   رابط کاربری وجود داشت ولی هرگز در محاسبه ضرب نمی‌شد!
                factor = _f(page.banding_door_factor, 1.0) if page is not None else 1.0
                if factor <= 0:
                    factor = 1.0
                meters = dr.perimeter_m * leaves * factor
                meters *= (1 + (_f(page.banding_waste_percent, 8.0) if page is not None else 0.0) / 100.0)
                price = _f(bmat.price)
                items.append(LineItem("banding_door", "نوار PVC در", bmat.name,
                                      f"محیط {dr.perimeter_m:.2f} متر × {leaves} لنگه"
                                      + (f" × ضریب {factor:g}" if factor != 1.0 else ""),
                                      meters, "متر", price, meters * price,
                                      mat_id=int(dr.banding_id), mat_cat="banding"))
                res.banding_m += meters

        # لولا
        if dr.hinge_id or dr.hinge_price:
            qty = _pos(dr.hinges_per_leaf, 2) * leaves
            price = self.price_of(dr.hinge_id, dr.hinge_price)
            name = (self.mat(dr.hinge_id).name if self.mat(dr.hinge_id) else dr.hinge_name) or "لولا"
            items.append(LineItem("hinge", "لولا", name,
                                  f"{_i(dr.hinges_per_leaf, 2)} عدد در هر لنگه × {leaves} لنگه",
                                  qty, "عدد", price, qty * price,
                                  mat_id=int(dr.hinge_id), mat_cat="hinge"))

        # گازور / جک
        if (dr.gas_spring_id or dr.gas_spring_price) and dr.gas_springs_per_leaf:
            qty = _pos(dr.gas_springs_per_leaf) * leaves
            price = self.price_of(dr.gas_spring_id, dr.gas_spring_price)
            name = (self.mat(dr.gas_spring_id).name if self.mat(dr.gas_spring_id)
                    else dr.gas_spring_name) or "گازور"
            items.append(LineItem("gas_spring", "گازور / جک", name,
                                  f"{_i(dr.gas_springs_per_leaf)} عدد در هر لنگه",
                                  qty, "عدد", price, qty * price,
                                  mat_id=int(dr.gas_spring_id), mat_cat="gas_spring"))

        # دستگیره
        if dr.handle_id or dr.handle_price:
            qty = _pos(dr.handles_per_leaf, 1) * leaves
            price = self.price_of(dr.handle_id, dr.handle_price)
            name = (self.mat(dr.handle_id).name if self.mat(dr.handle_id) else dr.handle_name) or "دستگیره"
            items.append(LineItem("handle", "دستگیره", name, f"{leaves} لنگه",
                                  qty, "عدد", price, qty * price,
                                  mat_id=int(dr.handle_id), mat_cat="handle"))

        # مونتاژ و بسته‌بندی هر لنگه
        if dr.assembly_id or dr.assembly_price:
            price = self.price_of(dr.assembly_id, dr.assembly_price)
            name = (self.mat(dr.assembly_id).name if self.mat(dr.assembly_id)
                    else dr.assembly_name) or "مونتاژ در"
            items.append(LineItem("assembly_door", "مونتاژ و خدمات", name,
                                  f"{leaves} لنگه در", leaves, "لنگه", price, leaves * price,
                                  mat_id=int(dr.assembly_id), mat_cat="service"))
        if dr.packaging_id or dr.packaging_price:
            price = self.price_of(dr.packaging_id, dr.packaging_price)
            name = (self.mat(dr.packaging_id).name if self.mat(dr.packaging_id)
                    else dr.packaging_name) or "بسته‌بندی در"
            items.append(LineItem("packaging_door", "مونتاژ و خدمات", name,
                                  f"{leaves} لنگه در", leaves, "لنگه", price, leaves * price,
                                  mat_id=int(dr.packaging_id), mat_cat="service"))

        res.total_doors += leaves

    # ------------------------------------------------------------------
    def _calc_drawer(self, dw: DrawerRow, unit_qty: int, res: UnitResult,
                     items: List[LineItem], page: Optional[Page] = None) -> None:
        # ★ ``int("2.7")`` → ``ValueError`` و ``int(None)`` → ``TypeError``:
        #   یک فیلدِ «تعداد کشو» با مقدار متنی/خالی، کل موتور را می‌خواباند و
        #   چون ``recalc`` استثنا را می‌بلعد، پروژه برای همیشه قیمت کهنه داشت.
        #   اکنون با «برش» به عدد صحیح می‌رسد (هم‌تراز با موتور JS).
        count = _i(dw.qty, 0) * max(0, _i(unit_qty))
        if count <= 0:
            return
        waste = _f(page.waste_percent, 10.0) if page is not None else 10.0
        if waste < 0:
            waste = 0.0

        # بدنه‌ی جعبه‌ی کشو
        if dw.sheet_id or _pos(dw.sheet_price_per_sqm):
            m = self.mat(dw.sheet_id)
            ppsqm = (self._sheet_price_check(m, res, "ورق جعبه‌ی کشو",
                                             dw.box_area_sqm * count)
                     if m else max(0.0, _f(dw.sheet_price_per_sqm)))
            name = m.name if m else (dw.sheet_name or "ورق بدنه‌ی کشو")
            if m is None and ppsqm <= 0 and dw.sheet_id:
                res.warnings.append(
                    f"«{dw.label or 'کشو'}»: متریال جعبه‌ی کشو در کتابخانه قیمت "
                    "پیدا نشد و قیمت ثبت‌شده‌ای هم ندارد — هزینه‌ی ورق جعبه "
                    "محاسبه نشد!")
            area = dw.box_area_sqm * count
            sa = _f(m.sheet_area_sqm) if m else 0.0
            items.append(LineItem("drawer_box", "جعبه‌ی کشو", name,
                                  f"{count} عدد × {dw.box_area_sqm:.3f} م²",
                                  area, "م²", ppsqm, area * ppsqm,
                                  mat_id=int(dw.sheet_id), mat_cat="drawer_sheet",
                                  area_sqm=area * (1 + waste / 100.0),
                                  sheet_area_sqm=sa))

        # تیره‌ی کشو
        if dw.front_id or _pos(dw.front_price_per_sqm):
            m = self.mat(dw.front_id)
            ppsqm = (self._sheet_price_check(m, res, "تیره‌ی کشو",
                                             dw.front_area_sqm * count)
                     if m else max(0.0, _f(dw.front_price_per_sqm)))
            name = m.name if m else (dw.front_name or "تیره‌ی کشو")
            if m is None and ppsqm <= 0 and dw.front_id:
                res.warnings.append(
                    f"«{dw.label or 'کشو'}»: متریال تیره‌ی کشو در کتابخانه قیمت "
                    "پیدا نشد و قیمت ثبت‌شده‌ای هم ندارد — هزینه‌ی تیره محاسبه نشد!")
            area = dw.front_area_sqm * count
            sa = _f(m.sheet_area_sqm) if m else 0.0
            items.append(LineItem("drawer_front", "تیره‌ی کشو", name,
                                  f"{count} عدد × {dw.front_area_sqm:.3f} م²",
                                  area, "م²", ppsqm, area * ppsqm,
                                  mat_id=int(dw.front_id), mat_cat="door_sheet",
                                  area_sqm=area * (1 + waste / 100.0),
                                  sheet_area_sqm=sa))
            res.door_area += area

        # ریل
        if dw.slide_id or dw.slide_price:
            price = self.price_of(dw.slide_id, dw.slide_price)
            name = (self.mat(dw.slide_id).name if self.mat(dw.slide_id) else dw.slide_name) or "ریل کشو"
            items.append(LineItem("drawer_slide", "ریل کشو", name, f"{count} عدد کشو",
                                  count, "ست", price, count * price,
                                  mat_id=int(dw.slide_id), mat_cat="drawer_slide"))

        # نوار
        if dw.banding_id:
            m = self.mat(dw.banding_id)
            if m is not None:
                # پرت نوار برای کشو هم مثل بدنه و در اعمال می‌شود (قبلاً فقط
                # نوار بدنه/در پرت داشتند و نوار کشو بدون پرت حساب می‌شد).
                bw = _f(page.banding_waste_percent, 8.0) if page is not None else 0.0
                meters = dw.banding_m * count * (1 + bw / 100.0)
                items.append(LineItem("banding_drawer", "نوار PVC کشو", m.name,
                                      f"{dw.banding_m:.2f} متر در هر کشو"
                                      + (f" + {bw:.0f}٪ پرت" if bw else ""),
                                      meters, "متر", _f(m.price), meters * _f(m.price),
                                      mat_id=int(dw.banding_id), mat_cat="banding"))
                res.banding_m += meters

        # دستگیره
        if dw.handle_id or dw.handle_price:
            price = self.price_of(dw.handle_id, dw.handle_price)
            name = (self.mat(dw.handle_id).name if self.mat(dw.handle_id)
                    else dw.handle_name) or "دستگیره"
            items.append(LineItem("handle", "دستگیره", name, f"{count} عدد کشو",
                                  count, "عدد", price, count * price,
                                  mat_id=int(dw.handle_id), mat_cat="handle"))

        # مونتاژ
        if dw.assembly_id or dw.assembly_price:
            price = self.price_of(dw.assembly_id, dw.assembly_price)
            name = (self.mat(dw.assembly_id).name if self.mat(dw.assembly_id)
                    else dw.assembly_name) or "مونتاژ کشو"
            items.append(LineItem("assembly_drawer", "مونتاژ و خدمات", name,
                                  f"{count} عدد کشو", count, "عدد", price, count * price,
                                  mat_id=int(dw.assembly_id), mat_cat="service"))

        res.total_drawers += count

    # ------------------------------------------------------------------
    # محاسبه‌ی یک صفحه (سبک)
    # ------------------------------------------------------------------
    #: کلیدهای ردیف‌هایی که از «ورق کامل» برش می‌خورند
    SHEET_ITEM_KEYS = ("body_sheet", "back_sheet", "door_sheet",
                       "drawer_front", "drawer_box")

    #: نگاشتِ «کلید ردیف → سطل هزینه‌ی بخش».
    #: ⚠ کلید ``"service"`` عمداً در هیچ سطلی نیست: ردیف‌های خدمات توسط
    #:   ``_calc_services`` ساخته می‌شوند و جمعشان یک‌بار در ``service_cost``
    #:   می‌آید. اگر این‌جا هم شمرده شوند، مبلغ خدمات دوبار در ``subtotal``
    #:   لحاظ می‌شود (باگ قدیمیِ دوباره‌شماری که برطرف شد).
    #: به‌صورت ویژگیِ کلاس بیرون آمده تا ``_rebuild_page_totals`` (پاسِ دومِ
    #: تجمیع ورق در سطح پروژه) دقیقاً همان سطل‌بندی را بازتولید کند.
    PAGE_GROUP_MAP: Dict[str, Any] = {
        "material_cost": {"body_sheet", "back_sheet", "countertop", "crown",
                          "underlight", "kickboard", "banding_body", "banding_drawer",
                          "drawer_box"},
        "door_cost": {"door_sheet", "door_model", "banding_door", "drawer_front"},
        "accessory_cost": {"hinge", "gas_spring", "shelf_pin", "handle", "leg",
                           "drawer_slide", "accessory"},
        "labor_cost": {"assembly_unit", "assembly_door", "assembly_drawer",
                       "packaging_door"},
    }

    def batch_sheets(self, items: List[LineItem], scope: str = "این بخش") -> Dict[int, float]:
        """
        ★ تجمیع مصرف ورق در سطح یک **محدوده** (بخش یا کل پروژه) — نه هر یونیت.

        پیش‌تر مساحت هر یونیت به‌تنهایی به «ورق کامل» گرد می‌شد؛ یعنی یک یونیت
        ۴۵ سانتی با ۱٫۲ مترمربع بدنه، یک ورق ۶٫۷ مترمربعی مصرف می‌کرد. در
        کارگاهِ واقعی دورریزِ یک یونیت تکه‌ی یونیت بعدی می‌شود و همه‌ی قطعاتِ
        هم‌جنس با هم روی ورق چیده می‌شوند.

        ★★ سطحِ تجمیع (رفع باگ F-01): این تابع پیش‌تر **فقط یک‌بار و برای
        ردیف‌های همان بخش** صدا زده می‌شد. یعنی همان استدلالِ بالا («دورریزِ یک
        یونیت، تکه‌ی یونیت بعدی است») دقیقاً بین دو بخش نقض می‌شد: یک
        آشپزخانه‌ی ۸ یونیتی که به ۸ بخش تقسیم شده بود **۸ ورق** قیمت می‌خورد
        در حالی که از نظر فیزیکی **۳ ورق** لازم داشت (+۱۶۷٪). اکنون
        ``calc_project`` یک‌بار هم همین تابع را روی **همه‌ی ردیف‌های همه‌ی
        بخش‌ها** صدا می‌زند (``repool_sheets_project``) تا ورقِ هر متریال در
        سطح پروژه یک‌جا گرد شود.

        ★ idempotent: صدا‌زدنِ چندباره‌اش روی یک ردیف، عبارتِ «— از N ورق …» را
        تکرار نمی‌کند (متنِ پایه‌ی هر ردیف یک‌بار ثبت می‌شود). این برای پاسِ
        دومِ سطح پروژه ضروری است.

        این تابع:
          ۱. ردیف‌های ورقی را بر اساس متریال گروه می‌کند؛
          ۲. مجموع مساحت (با پرت) را یک‌بار بر مساحت ورق تقسیم و به بالا گرد
             می‌کند → **تعداد واقعی ورقِ خریدنی**؛
          ۳. بهای همان ورق‌ها را به نسبت سهم مساحت، بین ردیف‌ها تقسیم می‌کند
             تا ریزِ هر یونیت در فاکتور دست‌نخورده باقی بماند.

        خروجی: {شناسه‌ی متریال → تعداد ورق}
        """
        groups: Dict[int, List[LineItem]] = {}
        for it in items:
            if it.key in self.SHEET_ITEM_KEYS and it.mat_id and _f(it.sheet_area_sqm) > 0:
                groups.setdefault(int(it.mat_id), []).append(it)

        sheets_by_material: Dict[int, float] = {}
        for mid, its in groups.items():
            m = self.materials.get(mid)
            total_gross = sum(_pos(i.area_sqm) for i in its)    # با پرت
            total_net = sum(_pos(i.qty) for i in its)           # بدون پرت (نمایشی)
            sheet_area = _f(its[0].sheet_area_sqm)
            if total_gross <= 0 or sheet_area <= 0:
                continue
            # ⚠ گاردِ ``round(..., 6)`` خطای شناور را خنثی می‌کند تا مثلاً
            #   ``2.0000000001`` سه ورق نشود. این رفتارِ سالم دست‌نخورده ماند.
            sheets = float(math.ceil(round(total_gross / sheet_area, 6)))
            sheets_by_material[mid] = sheets
            sheet_price = _f(m.price) if m is not None else 0.0
            total_cost = sheets * sheet_price
            # نرخ مؤثر هر مترمربع = بهای ورق‌های خریدنی ÷ مساحت خالص مصرفی.
            # این‌طور جمع ردیف‌ها دقیقاً برابر «تعداد ورق × قیمت ورق» می‌شود
            # و همزمان پرت و دورریزِ برش هم در قیمت دیده می‌شود.
            eff = (total_cost / total_net) if total_net > 0 else 0.0
            size = (f"{_f(m.sheet_width_cm):.0f}×{_f(m.sheet_height_cm):.0f}"
                    if m is not None else "")
            for i in its:
                share = (_pos(i.area_sqm) / total_gross) if total_gross else 0.0
                i.sheets = sheets * share
                i.unit_label = "م²"
                i.unit_price = eff
                i.amount = total_cost * share
                # متنِ پایه یک‌بار ثبت می‌شود تا پاسِ دوم (سطح پروژه) عبارت را
                # دو بار به ردیف نچسباند.
                base = self._detail_base.get(id(i))
                if base is None:
                    base = i.detail or ""
                    self._detail_base[id(i)] = base
                i.detail = base + f" — از {sheets:.0f} ورق {size}ِ {scope}"
        return sheets_by_material

    # ------------------------------------------------------------------
    def repool_sheets_project(self, page_results: List[PageResult]) -> bool:
        """
        ★ پاسِ دومِ تجمیع ورق در **سطح کل پروژه** (رفع باگ F-01).

        همه‌ی ردیف‌های ورقیِ همه‌ی بخش‌ها یک‌جا گروه می‌شوند و ورقِ هر متریال
        یک‌بار گرد می‌شود. چون ``ceil(Σ) ≤ Σ ceil`` است، این پاس هرگز قیمت را
        **افزایش** نمی‌دهد؛ فقط ورقِ اضافه‌ای را برمی‌دارد که در اثرِ تقسیمِ
        پروژه به چند بخش ساخته می‌شد. برای پروژه‌ی تک‌بخشی هیچ تغییری نمی‌دهد.

        خروجی: ``True`` اگر مبلغ/سهم ورقِ دست‌کم یک ردیف عوض شد (یعنی جمع‌های
        بخش باید دوباره ساخته شود).
        """
        if len(page_results) < 2:
            return False
        all_items = [i for pr in page_results for i in pr.items]
        snapshot = {id(i): (round(_f(i.amount), 6), round(_f(i.sheets), 9))
                    for i in all_items}
        self.batch_sheets(all_items, scope="کل پروژه")
        for i in all_items:
            old = snapshot.get(id(i))
            if old is None:
                continue
            if (abs(old[0] - round(_f(i.amount), 6)) > 1e-6
                    or abs(old[1] - round(_f(i.sheets), 9)) > 1e-9):
                return True
        return False

    # ------------------------------------------------------------------
    def _rebuild_page_totals(self, page: Page, pr: PageResult) -> None:
        """
        بازسازی جمع‌های یک بخش بعد از تغییرِ مبلغ ردیف‌ها (پاسِ دومِ ورق).

        فقط سطل‌های ``PAGE_GROUP_MAP`` از روی ردیف‌ها دوباره جمع می‌شوند؛
        ``detail_cost``/``service_cost``/``extra_cost`` دست‌نخورده می‌مانند، چون
        ردیف‌های ورقی هرگز در آن سطل‌ها نمی‌روند. ``_apply_overhead`` هم
        idempotent است (ردیف کهنه‌ی سربار را پاک و با مبلغ تازه می‌سازد).
        """
        for attr in ("material_cost", "door_cost", "accessory_cost", "labor_cost"):
            setattr(pr, attr, 0.0)
        for it in pr.items:
            for attr, keys in self.PAGE_GROUP_MAP.items():
                if it.key in keys:
                    setattr(pr, attr, getattr(pr, attr) + _f(it.amount))
                    break
        pr.subtotal = (pr.material_cost + pr.door_cost + pr.accessory_cost +
                       pr.detail_cost + pr.labor_cost + pr.service_cost + pr.extra_cost)
        pr.total_sheets = sum(_f(i.sheets) for i in pr.items)
        # هزینه‌ی هر یونیت هم با مبالغِ نهایی همگام می‌ماند تا نامساویِ
        # «جمع یونیت‌ها == جمع بخش» برقرار بماند.
        for ur in pr.unit_results:
            ur.cost = sum(_f(i.amount) for i in ur.items)
        self._apply_overhead(pr, page)

    # ------------------------------------------------------------------
    def calc_page(self, page: Page) -> PageResult:
        pr = PageResult(name=page.name or "بخش")
        countertop_items: List[LineItem] = []

        for u in page.units:
            ur = self.calc_unit(u, page)
            pr.unit_results.append(ur)
            pr.items.extend(ur.items)
            pr.warnings.extend(ur.warnings)
            # تعداد مؤثر یونیت: صفر/منفی یعنی یونیت کنار گذاشته شده (بدون هزینه)
            nq = max(0, _i(u.qty, 0))
            pr.total_units += nq
            pr.total_doors += sum(d.leaves for d in u.doors) * nq
            # ⚠ `int(d.qty or 0)` روی «تعداد کشو» با مقدارِ متنی (``"2.7"``) یا
            #   ``None`` با ValueError/TypeError موتور را می‌خواباند — و چون
            #   `recalc_all_projects` استثنا را می‌بلعد، پروژه برای همیشه روی
            #   خطای ۵۰۰/قیمت کهنه می‌ماند. تبدیلِ امن + کرانِ صفر.
            pr.total_drawers += sum(max(0, _i(d.qty, 0)) for d in u.drawers) * nq
            if u.unit_type in ("ground", "tall"):
                pr.total_ground_lm += _pos(u.length_cm) / 100.0 * nq
            if u.unit_type == "wall":
                pr.total_wall_lm += _pos(u.length_cm) / 100.0 * nq

        # آمار تجمیعی — «قبل از» خدمات محاسبه می‌شود چون مبنای «مترمربع»
        # (sqm) در خدماتِ صفحه به مساحت کل قطعات همین بخش نیاز دارد.
        for ur in pr.unit_results:
            pr.total_body_area += ur.body_area
            pr.total_back_area += ur.back_area
            pr.total_door_area += ur.door_area
            pr.total_banding_m += ur.banding_m
            pr.total_countertop_area += ur.countertop_area
        pr.total_area_sqm = pr.total_body_area + pr.total_door_area + pr.total_back_area

        # ★ تجمیع ورق‌ها: همه‌ی قطعات هم‌جنسِ این بخش روی ورق‌های مشترک برش
        #   می‌خورند، پس تعداد ورق یک‌بار (و نه برای هر یونیت) گرد می‌شود.
        self.batch_sheets(pr.items)
        pr.total_sheets = sum(_f(i.sheets) for i in pr.items)
        # batch_sheets مبلغ ردیف‌های ورقی را بازنویسی می‌کند؛ هزینه‌ی هر یونیت
        # هم با همان مبالغِ نهایی همگام می‌شود تا جمع یونیت‌ها == جمع بخش بماند.
        for ur in pr.unit_results:
            ur.cost = sum(_f(i.amount) for i in ur.items)

        # صفحه‌ی کابینت کلی صفحه (اگر کاربر متراژ کلی داده باشد)
        if page.countertop_lm > 0:
            used = [u for u in page.units if u.countertop_id]
            cm = self.mat(used[0].countertop_id) if used else None
            if cm is not None:
                price = _f(cm.price)
                countertop_items.append(LineItem(
                    "countertop", "صفحه کابینت", cm.name,
                    f"{page.countertop_lm:.2f} متر طول (ورودی کلی)",
                    page.countertop_lm, "متر", price, page.countertop_lm * price,
                    mat_id=int(used[0].countertop_id), mat_cat="countertop"))
            else:
                # متراژ داده‌اند ولی متریالِ صفحه هیچ‌جا انتخاب نشده/پیدا نشد —
                # بی‌صدا نادیده گرفتن یعنی پیش‌فاکتورِ ارزانِ غلط؛ هشدار می‌دهیم.
                pr.warnings.append(
                    f"«{page.name or 'بخش'}»: متراژ صفحه‌ی کابینت "
                    f"({page.countertop_lm:g} متر) وارد شده ولی متریال صفحه در هیچ "
                    "یونیتی انتخاب نشده (یا از کتابخانه حذف شده) — هزینه‌ی صفحه "
                    "محاسبه نشد.")

        pr.items.extend(countertop_items)

        # درنما
        pr.detail_cost = self._calc_detail(page, pr)

        # اضافات
        for ex in page.extras:
            if not ex.label and not _f(ex.price):
                continue
            # ★ قلمِ اضافه با تعداد/قیمت منفی پیش‌تر بی‌صدا از جمع کل کم می‌کرد
            #   (تخفیفِ پنهان روی سند مالی). اکنون کرانِ صفر دارد + هشدار.
            if _f(ex.qty) < 0 or _f(ex.price) < 0:
                pr.warnings.append(
                    f"«{ex.label or 'قلم متفرقه'}»: تعداد یا قیمت منفی بود — صفر در "
                    "نظر گرفته شد. قلمِ منفی پیش‌تر بی‌صدا از جمع کل کم می‌کرد.")
            pr.items.append(LineItem("extra", "اضافات و اکسسوری", ex.label or "قلم متفرقه",
                                     ex.note or "", _f(ex.qty), ex.unit_label(),
                                     _f(ex.price), _f(ex.cost), visible=bool(ex.visible)))
            pr.extra_cost += _f(ex.cost)

        # خدمات سطح صفحه
        pr.service_cost = self._calc_services(page, pr)

        # جمع‌بندی — سطل‌بندی در ``PAGE_GROUP_MAP`` تعریف شده است.
        for it in pr.items:
            for attr, keys in self.PAGE_GROUP_MAP.items():
                if it.key in keys:
                    setattr(pr, attr, getattr(pr, attr) + _f(it.amount))
                    break

        pr.subtotal = (pr.material_cost + pr.door_cost + pr.accessory_cost +
                       pr.detail_cost + pr.labor_cost + pr.service_cost + pr.extra_cost)
        pr.waste_amount = 0.0     # پرت ورق داخل محاسبه‌ی ورق اعمال شده
        self._apply_overhead(pr, page)
        return pr

    # ------------------------------------------------------------------
    @staticmethod
    def _apply_overhead(pr: "PageResult", page: "Page") -> None:
        """
        محاسبه‌ی سربار و ثبت آن به‌صورت یک ردیف شفاف.

        سربار پیش‌تر فقط در جمع‌ها وجود داشت و در ریزِ اقلام/فاکتور دیده
        نمی‌شد؛ در نتیجه «جمع ردیف‌های فاکتور» از «هزینه‌ی تمام‌شده» کمتر
        می‌شد. اکنون ردیف «سربار» اضافه می‌شود و اگر جمع بخش بعداً تغییر
        کند (مثلاً خدمات درصدی در سطح پروژه)، این متد دوباره صدا زده شده و
        مبلغ ردیف همگام می‌ماند (idempotent).
        """
        overhead_pct = max(0.0, _f(page.overhead_percent))
        pr.overhead_amount = pr.subtotal * overhead_pct / 100.0
        pr.total_cost = pr.subtotal + pr.overhead_amount
        # ردیف کهنه‌ی سربار (اگر هست) حذف و با مبلغ تازه جایگزین می‌شود
        pr.items[:] = [i for i in pr.items if i.key != "overhead"]
        if pr.overhead_amount > 0:
            pr.items.append(LineItem(
                "overhead", "سربار", f"سربار کارگاه ({overhead_pct:g}٪)",
                f"{overhead_pct:g}٪ از جمع اقلام بخش",
                1, "موردی", pr.overhead_amount, pr.overhead_amount))

    # ------------------------------------------------------------------
    def _calc_detail(self, page: Page, pr: PageResult) -> float:
        total = 0.0
        if page.detail_mode == "detailed":
            for r in page.detail_rows:
                if r.area_sqm <= 0:
                    continue
                pr.items.append(LineItem("darna", "درنما", r.label or "درنما",
                                         f"{r.qty:g} × {r.w_cm:g}×{r.h_cm:g} سانتی‌متر = {r.area_sqm:.3f} م²",
                                         r.area_sqm, "م²", _f(r.price_per_sqm), _f(r.cost)))
                total += _f(r.cost)
        elif page.detail_mode == "total":
            sqm = _f(page.detail_total_sqm)
            price = _f(page.detail_price_per_sqm)
            if sqm > 0:
                pr.items.append(LineItem("darna", "درنما", "درنما (متراژ کلی)",
                                         f"{sqm:.3f} م² × قیمت واحد", sqm, "م²", price, sqm * price))
                total = sqm * price
        return total

    def _calc_services(self, page: Page, pr: PageResult) -> float:
        total = 0.0
        ctx = {
            "unit": float(pr.total_units),
            "door": float(pr.total_doors),
            "shelf": 0.0,
            # مبنای «مترمربع»: مساحت کل قطعاتِ ورقی بخش (بدنه + در + پشت).
            # ⚠ پیش‌تر این مقدار همیشه صفر بود و خدماتِ مترمربعی هیچ هزینه‌ای
            #   نمی‌گرفتند؛ اکنون از آمار تجمیعیِ محاسبه‌شده پر می‌شود.
            "sqm": float(pr.total_area_sqm),
            "lm": pr.total_ground_lm + pr.total_wall_lm,
            "fixed": 1.0,
            "percent": 0.0,
        }
        for u in page.units:
            ctx["shelf"] += _pos(u.shelves) * max(0, _i(u.qty, 0))
        for s in page.services:
            if not s.label and not _f(s.price):
                continue
            if s.basis == "percent":
                continue        # در سطح پروژه و پس از محاسبه‌ی جمع اعمال می‌شود
            if _f(s.price) < 0:
                pr.warnings.append(
                    f"«{s.label or 'خدمات'}»: بهای خدمت منفی بود — صفر در نظر "
                    "گرفته شد (خدمتِ با بهای منفی از جمع کل کم می‌کرد).")
            basis = s.basis if s.basis in ctx else "fixed"
            # ★ مبنای منفی/NaN پیش‌تر مبلغ خدمت را منفی می‌کرد و بی‌صدا از
            #   جمع کل کم می‌شد (مثلاً عمق منفی → مساحت منفی → خدمت منفی).
            qty = max(0.0, _f(ctx[basis])) if basis != "percent" else 1.0
            amount = qty * _pos(s.price)
            pr.items.append(LineItem("service", "خدمات", s.label or "خدمات",
                                     s.note or f"مبنای محاسبه: {basis}", qty, "",
                                     _f(s.price), amount))
            total += amount
        # خدمات درصدی نسبت به جمع کل (در پایان اعمال می‌شود)
        return total

    # ------------------------------------------------------------------
    # محاسبه‌ی کل پروژه
    # ------------------------------------------------------------------
    def calc_project(self, pages: List[Page], *,
                     install_mode: str = "fixed", install_value: float = 0.0,
                     profit_mode: str = "markup", profit_percent: float = 30.0,
                     discount_percent: float = 0.0, discount_amount: float = 0.0,
                     vat_enabled: bool = False, vat_percent: float = 10.0,
                     extra_fixed_amount: float = 0.0,
                     deposit_percent: float = 0.0,
                     deposit_amount: float = 0.0) -> ProjectResult:
        out = ProjectResult()

        # --- اعتبارسنجی ورودی‌های مالی -------------------------------------
        # ورودی‌های نامعقول (درصد منفی، مارجین ≥ ۱۰۰ و …) پیش‌تر بی‌صدا
        # نتایج عجیب می‌ساختند (مثلاً تخفیف منفی قیمت را از ناخالص بالاتر
        # می‌برد). اکنون مقدارِ مؤثر محدود می‌شود و هشدارش به کاربر می‌رسد.
        # ★ ورودیِ غیرمتناهی (NaN/inf) پیش‌تر از ``_f`` سالم رد می‌شد و تا
        #   انتهای زنجیره می‌رفت: ``{"final_price": NaN}`` در خروجی API یک
        #   **JSON نامعتبر** است (``JSON.parse`` در مرورگر می‌ترکد) و در SQLite
        #   ستون REAL آن را NULL ذخیره می‌کرد → قیمت بی‌صدا «صفر» می‌شد.
        #   اکنون در همین مرز گرفته می‌شود و کاربر هم می‌فهمد چرا.
        for _nm, _v in (("درصد سود", profit_percent), ("درصد تخفیف", discount_percent),
                        ("مبلغ تخفیف", discount_amount), ("درصد مالیات", vat_percent),
                        ("مبلغ نصب", install_value), ("درصد بیعانه", deposit_percent),
                        ("مبلغ بیعانه", deposit_amount),
                        ("مبلغ ثابت اضافه", extra_fixed_amount)):
            try:
                _x = float(_v)
            except (TypeError, ValueError, OverflowError):
                continue
            if _x != _x or _x in (math.inf, -math.inf):
                out.warnings.append(f"{_nm} نامعتبر (غیرعددی/بی‌نهایت) بود — صفر در نظر گرفته شد.")
        profit_percent = _f(profit_percent)
        if profit_percent < 0:
            out.warnings.append(f"درصد سود منفی ({profit_percent:g}٪) بود — صفر در نظر گرفته شد.")
            profit_percent = 0.0
        if profit_mode == "margin" and profit_percent >= 100:
            out.warnings.append(
                f"مارجین {profit_percent:g}٪ نامعتبر است (باید کمتر از ۱۰۰٪ باشد) — "
                "سود صفر محاسبه شد.")
        discount_percent = _f(discount_percent)
        if not (0.0 <= discount_percent <= 100.0):
            out.warnings.append(
                f"درصد تخفیف ({discount_percent:g}٪) خارج از بازه‌ی ۰ تا ۱۰۰ بود — "
                f"به {min(max(discount_percent, 0.0), 100.0):g}٪ محدود شد.")
            discount_percent = min(max(discount_percent, 0.0), 100.0)
        discount_amount = _f(discount_amount)
        if discount_amount < 0:
            out.warnings.append("مبلغ تخفیف منفی بود — صفر در نظر گرفته شد.")
            discount_amount = 0.0
        vat_percent = _f(vat_percent)
        if vat_percent < 0:
            out.warnings.append("درصد مالیات منفی بود — صفر در نظر گرفته شد.")
            vat_percent = 0.0
        install_value = _f(install_value)
        if install_value < 0:
            out.warnings.append("مبلغ نصب منفی بود — صفر در نظر گرفته شد.")
            install_value = 0.0
        deposit_percent = _f(deposit_percent)
        if not (0.0 <= deposit_percent <= 100.0):
            deposit_percent = min(max(deposit_percent, 0.0), 100.0)
        deposit_amount = max(0.0, _f(deposit_amount))

        out.profit_mode = profit_mode
        out.profit_percent = profit_percent
        out.discount_percent = discount_percent
        out.discount_amount_input = discount_amount
        out.vat_percent = vat_percent if vat_enabled else 0.0

        stats = dict(total_units=0, total_doors=0, total_drawers=0, total_ground_lm=0.0,
                     total_wall_lm=0.0, total_body_area=0.0, total_door_area=0.0,
                     total_back_area=0.0, total_banding_m=0.0, total_sheets=0.0)

        # ── پاسِ ۱ ─ محاسبه‌ی هر بخش به‌تنهایی ────────────────────────────
        # (تجمیع ورق در سطح بخش این‌جا انجام می‌شود، مثل قبل)
        self._detail_base.clear()
        pairs: List[Tuple[Page, PageResult]] = []
        for page in pages:
            pairs.append((page, self.calc_page(page)))

        # ── پاسِ ۲ ─ تجمیع ورق در سطح **کل پروژه** (رفع باگ F-01) ─────────
        # ورقِ یک متریال در کارگاه یک‌جا برش می‌خورد، نه بخش‌بخش. بدون این پاس،
        # تقسیمِ یک آشپزخانه به N بخش، تعداد ورق (و مبلغ گران‌ترین قلم فاکتور)
        # را تا N برابر باد می‌کرد. چون ceil(Σ) ≤ Σ ceil است، این پاس فقط
        # مبلغ را **کم** می‌کند و هرگز از نیاز فیزیکی ورق پایین‌تر نمی‌رود.
        if self.repool_sheets_project([pr for _, pr in pairs]):
            for page, pr in pairs:
                self._rebuild_page_totals(page, pr)

        # ── پاسِ ۳ ─ خدمات درصدی و انباشت نتیجه ──────────────────────────
        for page, pr in pairs:
            # خدمات درصدی — همه نسبت به «جمع اقلامِ قبل از خدمات درصدی» حساب
            # می‌شوند (بدون اثر مرکب روی هم)؛ پیش‌تر هر خدمت درصدی روی جمعِ
            # شاملِ خدمت درصدیِ قبلی اعمال می‌شد.
            # ⚠ عمداً **بعد** از پاسِ ۲ اعمال می‌شود تا درصدِ خدمت روی جمعِ
            #   اصلاح‌شده‌ی ورق بنشیند، نه روی جمعِ بادکرده‌ی بخش‌بخش.
            pct_services = [s for s in page.services if s.basis == "percent"]
            if pct_services:
                base = pr.subtotal
                pct_total = 0.0
                for s in pct_services:
                    pct_raw = _f(s.price)
                    if pct_raw < 0:
                        out.warnings.append(
                            f"«{s.label or 'خدمات درصدی'}»: درصدِ منفی بود — صفر در "
                            "نظر گرفته شد.")
                    pct = max(0.0, pct_raw)
                    amt = base * pct / 100.0
                    pr.items.append(LineItem("service", "خدمات", s.label or "خدمات درصدی",
                                             f"{pct:g}٪ از جمع بخش", 1, "", pct, amt))
                    pct_total += amt
                pr.service_cost += pct_total
                pr.subtotal += pct_total
                self._apply_overhead(pr, page)
            out.pages.append(pr)
            out.pages_cost += pr.total_cost
            out.items.extend(pr.items)
            out.warnings.extend(pr.warnings)
            for k in stats:
                stats[k] += _f(getattr(pr, k, 0))

        extra_fixed_amount = _f(extra_fixed_amount)
        if extra_fixed_amount:
            # ★ کرانِ صفر: مبلغِ ثابتِ منفی پیش‌تر بی‌صدا از جمع کل کم می‌شد.
            if extra_fixed_amount < 0:
                out.warnings.append("مبلغ ثابتِ اضافه منفی بود — صفر در نظر گرفته شد.")
                extra_fixed_amount = 0.0
        if extra_fixed_amount:
            out.items.append(LineItem("extra_fixed", "اضافات و اکسسوری",
                                      "مبلغ ثابت بابت تفاوت نوع در / اقلام کلی", "",
                                      1, "موردی", extra_fixed_amount, extra_fixed_amount))
            out.pages_cost += extra_fixed_amount
            stats["extra_fixed"] = extra_fixed_amount

        # هزینه‌ی نصب
        install = self._calc_installation(install_mode, install_value, out.pages_cost, stats)
        out.installation_cost = install
        if install > 0:
            out.items.append(LineItem("installation", "نصب و حمل", "هزینه‌ی نصب",
                                      self._install_detail(install_mode, install_value, stats),
                                      1, "موردی", install, install))
        out.total_cost = out.pages_cost + install

        # سود
        out.profit_amount = self.calc_profit(out.total_cost, profit_mode, profit_percent)
        out.gross_price = out.total_cost + out.profit_amount

        # تخفیف (درصد و مبلغِ اعتبارسنجی‌شده)
        disc = out.gross_price * discount_percent / 100.0 + discount_amount
        out.discount_amount = min(disc, out.gross_price)
        out.net_price = out.gross_price - out.discount_amount

        # مالیات
        out.vat_amount = out.net_price * out.vat_percent / 100.0
        out.final_price = out.net_price + out.vat_amount

        # پیش‌پرداخت (بیعانه) و باقی‌مانده
        out.deposit_percent = deposit_percent
        dep = out.final_price * out.deposit_percent / 100.0 + deposit_amount
        out.deposit_amount = max(0.0, min(dep, out.final_price))
        out.remaining_amount = out.final_price - out.deposit_amount

        # قیمت هر متر طول — همان چیزی که مشتری و بازار می‌پرسند («متری چند؟»)
        glm = _f(stats.get("total_ground_lm", 0.0))
        tlm = glm + _f(stats.get("total_wall_lm", 0.0))
        out.price_per_ground_lm = (out.final_price / glm) if glm > 0 else 0.0
        out.price_per_total_lm = (out.final_price / tlm) if tlm > 0 else 0.0
        out.cost_per_ground_lm = (out.total_cost / glm) if glm > 0 else 0.0

        out.stats = stats
        return out

    # ------------------------------------------------------------------
    @staticmethod
    def _calc_installation(mode: str, value: float, cost: float, stats: Dict[str, float]) -> float:
        value = _f(value)
        if mode == "fixed":
            return value
        if mode == "per_meter":
            return value * _f(stats.get("total_ground_lm", 0.0))
        if mode == "percent":
            return _f(cost) * value / 100.0
        return 0.0

    @staticmethod
    def _install_detail(mode: str, value: float, stats: Dict[str, float]) -> str:
        if mode == "fixed":
            return "مبلغ ثابت"
        if mode == "per_meter":
            return f"{_f(value):,.0f} × {_f(stats.get('total_ground_lm', 0)):.2f} متر طول کابینت زمینی"
        if mode == "percent":
            return f"{_f(value):g}٪ از جمع هزینه‌ها"
        return ""

    @staticmethod
    def calc_profit(cost: float, mode: str, percent: float) -> float:
        """
        محاسبه‌ی سود به دو روش استاندارد حسابداری:
          markup  → درصدی از هزینه           : profit = cost × p/100
          margin  → درصدی از قیمت فروش نهایی : profit = cost × p / (100 − p)
        """
        cost = _f(cost)
        p = _f(percent)
        if mode == "margin":
            # ⚠ مارجین ≥ ۱۰۰٪ مخرج را صفر/منفی می‌کند: ۹۹٫۹۹۹۹٪ پیش‌تر قیمتِ
            #   نهایی ~۱۰^۱۲ می‌ساخت و ۱۰۰٪ تقسیم بر صفر بود. کران بسته شد.
            if p >= 100:
                return 0.0
            profit = cost * p / (100.0 - p)
        else:
            profit = cost * p / 100.0
        # ★ کرانِ سلامت: هر نتیجه‌ی غیرمتناهی (یا منفیِ ناشی از ورودی خراب)
        #   به صفر برمی‌گردد تا عددِ پوچ روی سند مالی نرود.
        if not math.isfinite(profit) or profit < 0:
            return 0.0
        return profit

    @staticmethod
    def sell_price(cost: float, mode: str, percent: float) -> float:
        return _f(cost) + CostingEngine.calc_profit(cost, mode, percent)

    @staticmethod
    def profit_from_prices(cost: float, sell: float, mode: str = "both") -> Dict[str, float]:
        """معکوس: از روی هزینه و فروش، درصد مارکاپ و مارجین را بده."""
        cost, sell = _f(cost), _f(sell)
        profit = sell - cost
        markup = (profit / cost * 100.0) if cost else 0.0
        margin = (profit / sell * 100.0) if sell else 0.0
        return {"profit": profit, "markup": markup, "margin": margin}

    # ------------------------------------------------------------------
    def summarize(self, result: ProjectResult) -> Dict[str, float]:
        """جمع هر گروه برای نمایش خلاصه."""
        groups: Dict[str, float] = {}
        for it in result.items:
            groups[it.group] = groups.get(it.group, 0.0) + _f(it.amount)
        return groups
