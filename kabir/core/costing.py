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
from typing import Any, Dict, List, Optional

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
        if self.sheet_width_cm and self.sheet_height_cm:
            return (self.sheet_width_cm / 100.0) * (self.sheet_height_cm / 100.0)
        return 0.0

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
        if not self.enabled:
            return 0.0
        return self.qty * (self.w_cm / 100.0) * (self.h_cm / 100.0)


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

    @property
    def leaves(self) -> int:
        return int(self.qty)

    @property
    def area_sqm(self) -> float:
        return self.leaves * (self.w_cm / 100.0) * (self.h_cm / 100.0)

    @property
    def perimeter_m(self) -> float:
        return 2 * ((self.w_cm + self.h_cm) / 100.0)

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "DoorRow":
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in (d or {}).items() if k in known})


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
        """مساحت بدنه‌ی جعبه‌ی کشو: ۲ بغل + کف + پشت"""
        w, h, d = self.w_cm / 100.0, self.h_cm / 100.0, self.d_cm / 100.0
        return (2 * d * h) + (w * d) + (w * h)

    @property
    def front_area_sqm(self) -> float:
        return (self.w_cm / 100.0) * (self.h_cm / 100.0)

    @property
    def banding_m(self) -> float:
        """متراژ نوار لبه‌ی جعبه‌ی کشو (دور تا دور قطعات)."""
        w, h, d = self.w_cm / 100.0, self.h_cm / 100.0, self.d_cm / 100.0
        return 2 * (2 * (d + h)) + 2 * (w + d) + 2 * (w + h)

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "DrawerRow":
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in (d or {}).items() if k in known})


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
        return self.qty * (self.w_cm / 100.0) * (self.h_cm / 100.0)

    @property
    def cost(self) -> float:
        return self.area_sqm * self.price_per_sqm

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "DetailRow":
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in (d or {}).items() if k in known})


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
        return self.qty * self.price

    def unit_label(self) -> str:
        return PRICE_UNITS.get(self.unit, self.unit)

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "ExtraRow":
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in (d or {}).items() if k in known})


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
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in (d or {}).items() if k in known})


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
    legs_per_unit: float = 2
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
        known = {f for f in cls.__dataclass_fields__}
        obj = cls(**{k: v for k, v in d.items() if k in known})
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
        known = {f for f in cls.__dataclass_fields__}
        obj = cls(**{k: v for k, v in d.items() if k in known})
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

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "LineItem":
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in (d or {}).items() if k in known})


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
    # آمار تجمیعی
    stats: Dict[str, float] = field(default_factory=dict)
    items: List[LineItem] = field(default_factory=list)

    @property
    def total_profit(self) -> float:
        return self.final_price - self.total_cost - self.vat_amount


# ---------------------------------------------------------------------------
# توابع کمکی
# ---------------------------------------------------------------------------

def _f(v, default=0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def round_up_sheets(area_sqm: float, sheet_area: float, waste_percent: float = 0.0) -> float:
    """تعداد ورق لازم (با گرد کردن به بالا)."""
    if sheet_area <= 0:
        return 0.0
    a = area_sqm * (1 + _f(waste_percent) / 100.0)
    return math.ceil(round(a / sheet_area, 6))


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
        """ساخت ریز استاندارد بدنه‌ی یونیت بر اساس ابعاد."""
        t = 0.0
        bm = self.mat(u.body_id)
        if bm and bm.thickness_mm:
            t = bm.thickness_mm / 10.0          # تبدیل به سانتی‌متر
        L, H, D = _f(u.length_cm), _f(u.height_cm), _f(u.depth_cm)
        rows: List[PanelRow] = []

        rows.append(PanelRow("بدنه کناری (چپ و راست)", 2, D, H, "body"))
        if u.has_bottom_panel:
            rows.append(PanelRow("کف یونیت", 1, L - 2 * t, D, "body"))
        if u.has_top_panel and u.unit_type != "ground":
            rows.append(PanelRow("سقف یونیت", 1, L - 2 * t, D, "body"))
        if u.unit_type == "tall":
            rows.append(PanelRow("طبقه‌ی ثابت وسط", 1, L - 2 * t, D, "body"))

        # طبقات داخلی
        if u.shelves and u.shelves > 0:
            rows.append(PanelRow(f"طبقه‌ی داخلی ({int(u.shelves)} عدد)", _f(u.shelves), L - 2 * t, D, "body"))

        # فیبر پشت
        bm_back = self.mat(u.back_id)
        if bm_back is not None or u.back_id:
            rows.append(PanelRow("فیبر پشت", 1, L, H, "back"))

        # کشوها: کف و پشتِ جعبه (بغل‌ها در ردیف کشو محاسبه می‌شوند)
        return rows

    def panels_of(self, u: UnitRow) -> List[PanelRow]:
        if u.custom_panels:
            return [PanelRow(**{k: v for k, v in d.items()
                                if k in PanelRow.__dataclass_fields__}) for d in u.custom_panels]
        return self.default_panels(u)

    # ------------------------------------------------------------------
    # محاسبه‌ی یک یونیت
    # ------------------------------------------------------------------
    def calc_unit(self, u: UnitRow, page: Page) -> UnitResult:
        res = UnitResult(label=u.label or "یونیت", qty=int(u.qty or 1))
        n = max(1, res.qty)
        items: List[LineItem] = []

        body_mat = self.mat(u.body_id)
        back_mat = self.mat(u.back_id)
        body_ppsqm = _f(body_mat.price_per_sqm) if body_mat else 0.0
        back_ppsqm = _f(back_mat.price_per_sqm) if back_mat else 0.0

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

        waste = _f(page.waste_percent)

        # --- ورق بدنه ---
        if body_area > 0 and body_mat is not None:
            per_unit_area = body_area * (1 + waste / 100.0)
            sheet_area = _f(body_mat.sheet_area_sqm)
            if sheet_area > 0:
                sheets = math.ceil(per_unit_area / sheet_area) if n == 1 else \
                    math.ceil(per_unit_area * n / sheet_area)
                unit_price = _f(body_mat.price)
                amount = sheets * unit_price
                detail = (f"{sheets} ورق {body_mat.sheet_width_cm:.0f}×{body_mat.sheet_height_cm:.0f}"
                          f" — مساحت خالص {body_area * n:.3f} م² (با پرت {waste:.0f}٪: {per_unit_area * n:.3f} م²)")
                items.append(LineItem("body_sheet", "ورق بدنه", body_mat.name, detail,
                                      sheets, "ورق", unit_price, amount))
                res.sheets += sheets
            else:
                amount = per_unit_area * n * body_ppsqm
                items.append(LineItem("body_sheet", "ورق بدنه", body_mat.name,
                                      f"{per_unit_area * n:.3f} م² با احتساب {waste:.0f}٪ پرت",
                                      per_unit_area * n, "م²", body_ppsqm, amount))
            res.body_area += body_area * n

        # --- فیبر پشت ---
        if back_area > 0 and back_mat is not None:
            per_unit_area = back_area * (1 + waste / 100.0)
            sheet_area = _f(back_mat.sheet_area_sqm)
            if sheet_area > 0:
                sheets = math.ceil(per_unit_area * n / sheet_area)
                amount = sheets * _f(back_mat.price)
                items.append(LineItem("back_sheet", "فیبر پشت", back_mat.name,
                                      f"{sheets} ورق — {back_area * n:.3f} م²",
                                      sheets, "ورق", _f(back_mat.price), amount))
                res.sheets += sheets
            else:
                amount = per_unit_area * n * _f(back_mat.price_per_sqm)
                items.append(LineItem("back_sheet", "فیبر پشت", back_mat.name,
                                      f"{per_unit_area * n:.3f} م²",
                                      per_unit_area * n, "م²",
                                      _f(back_mat.price_per_sqm), amount))
            res.back_area += back_area * n

        # --- نوار PVC بدنه ---
        if body_area > 0 and u.banding_id:
            bmat = self.mat(u.banding_id)
            factor = _f(page.banding_body_factor, 2.2)
            meters = body_area * n * factor
            meters *= (1 + _f(page.banding_waste_percent) / 100.0)
            price = _f(bmat.price) if bmat else _f(u.banding_price)
            items.append(LineItem("banding_body", "نوار PVC بدنه",
                                  bmat.name if bmat else (u.banding_name or "نوار PVC"),
                                  f"ضریب {factor} × مساحت بدنه + {page.banding_waste_percent:.0f}٪ پرت",
                                  meters, "متر", price, meters * price))
            res.banding_m += meters

        # --- درب‌ها ---
        for dr in u.doors:
            self._calc_door(dr, n, res, items)

        # --- کشوها ---
        for dw in u.drawers:
            self._calc_drawer(dw, n, res, items)

        # --- صفحه‌ی کابینت ---
        if u.countertop_id:
            cm = self.mat(u.countertop_id)
            if cm is not None:
                lm = _f(u.length_cm) / 100.0 * n
                price = _f(cm.price)
                width = _f(cm.width_cm) or 60.0
                items.append(LineItem("countertop", "صفحه کابینت", cm.name,
                                      f"{lm:.2f} متر طول × عرض {width:g} سانتی‌متر",
                                      lm, "متر", price, lm * price))
                res.countertop_area += lm * width / 100.0
                res.countertop_lm += lm

        # --- تاج ---
        if u.crown_id and u.unit_type in ("wall", "tall"):
            cm = self.mat(u.crown_id)
            if cm is not None:
                lm = _f(u.length_cm) / 100.0 * n
                items.append(LineItem("crown", "تاج", cm.name, f"{lm:.2f} متر طول",
                                      lm, "متر", _f(cm.price), lm * _f(cm.price)))

        # --- زیرچراغ ---
        if u.underlight_id and u.unit_type == "wall":
            cm = self.mat(u.underlight_id)
            if cm is not None:
                lm = _f(u.length_cm) / 100.0 * n
                items.append(LineItem("underlight", "زیرچراغ", cm.name, f"{lm:.2f} متر طول",
                                      lm, "متر", _f(cm.price), lm * _f(cm.price)))

        # --- پاخور ---
        if u.kickboard_id and u.unit_type in ("ground", "tall"):
            cm = self.mat(u.kickboard_id)
            if cm is not None:
                lm = _f(u.length_cm) / 100.0 * n
                items.append(LineItem("kickboard", "پاخور", cm.name, f"{lm:.2f} متر طول",
                                      lm, "متر", _f(cm.price), lm * _f(cm.price)))

        # --- پایه ---
        if u.leg_id and u.unit_type in ("ground", "tall"):
            legs = _f(u.legs_per_unit, 2) * n
            price = self.price_of(u.leg_id, u.leg_price)
            items.append(LineItem("leg", "پایه", (self.mat(u.leg_id).name if self.mat(u.leg_id)
                                                  else u.leg_name) or "پایه",
                                  f"{legs:.0f} عدد", legs, "عدد", price, legs * price))

        # --- خار طبقه ---
        if u.shelf_pin_id and u.shelves:
            pins = _f(u.pins_per_shelf, 4) * _f(u.shelves) * n
            price = self.price_of(u.shelf_pin_id, u.shelf_pin_price)
            items.append(LineItem("shelf_pin", "خار طبقه",
                                  (self.mat(u.shelf_pin_id).name if self.mat(u.shelf_pin_id)
                                   else u.shelf_pin_name) or "خار طبقه",
                                  f"{pins:.0f} عدد ({int(u.shelves)} طبقه × {int(u.pins_per_shelf)} خار)",
                                  pins, "عدد", price, pins * price))

        # --- مونتاژ یونیت ---
        if u.assembly_id or u.assembly_price:
            price = self.price_of(u.assembly_id, u.assembly_price)
            name = (self.mat(u.assembly_id).name if self.mat(u.assembly_id)
                    else u.assembly_name) or "مونتاژ یونیت"
            items.append(LineItem("assembly_unit", "مونتاژ و خدمات", name,
                                  f"{n} یونیت", n, "یونیت", price, n * price))

        # --- اکسسوری‌های اختصاصی یونیت ---
        res.cost = sum(i.amount for i in items)
        res.items = items
        return res

    # ------------------------------------------------------------------
    def _calc_door(self, dr: DoorRow, unit_qty: int, res: UnitResult,
                   items: List[LineItem]) -> None:
        leaves = dr.leaves * unit_qty
        if leaves <= 0:
            return
        area = dr.area_sqm * unit_qty
        res.door_area += area

        # ورق / متریال در
        dmat = self.mat(dr.material_id)
        if dmat is not None:
            ppsqm = _f(dmat.price_per_sqm)
            if dmat.unit == "sheet" and dmat.sheet_area_sqm > 0:
                sheets = math.ceil(area * 1.08 / dmat.sheet_area_sqm)
                items.append(LineItem("door_sheet", "ورق در", dmat.name,
                                      f"{leaves} لنگه — {area:.3f} م² — {sheets} ورق",
                                      sheets, "ورق", _f(dmat.price), sheets * _f(dmat.price)))
                res.sheets += sheets
            else:
                items.append(LineItem("door_sheet", "ورق در", dmat.name,
                                      f"{leaves} لنگه — {area:.3f} م²",
                                      area, "م²", ppsqm, area * ppsqm))

        # هزینه‌ی ساخت/ CNC مدل در (مثلاً ممبران، هایگلاس، رنگ)
        if dr.door_model_id or dr.door_model_price:
            price = self.price_of(dr.door_model_id, dr.door_model_price)
            name = (self.mat(dr.door_model_id).name if self.mat(dr.door_model_id)
                    else dr.door_model_name) or "اجرت ساخت در"
            items.append(LineItem("door_model", "مدل و اجرت در", name,
                                  f"{leaves} لنگه", leaves, "لنگه", price, leaves * price))

        # نوار در
        if dr.banding_id:
            bmat = self.mat(dr.banding_id)
            if bmat is not None:
                meters = dr.perimeter_m * leaves
                price = _f(bmat.price)
                items.append(LineItem("banding_door", "نوار PVC در", bmat.name,
                                      f"محیط {dr.perimeter_m:.2f} متر × {leaves} لنگه",
                                      meters, "متر", price, meters * price))
                res.banding_m += meters

        # لولا
        if dr.hinge_id or dr.hinge_price:
            qty = _f(dr.hinges_per_leaf, 2) * leaves
            price = self.price_of(dr.hinge_id, dr.hinge_price)
            name = (self.mat(dr.hinge_id).name if self.mat(dr.hinge_id) else dr.hinge_name) or "لولا"
            items.append(LineItem("hinge", "لولا", name,
                                  f"{int(dr.hinges_per_leaf)} عدد در هر لنگه × {leaves} لنگه",
                                  qty, "عدد", price, qty * price))

        # گازور / جک
        if (dr.gas_spring_id or dr.gas_spring_price) and dr.gas_springs_per_leaf:
            qty = _f(dr.gas_springs_per_leaf) * leaves
            price = self.price_of(dr.gas_spring_id, dr.gas_spring_price)
            name = (self.mat(dr.gas_spring_id).name if self.mat(dr.gas_spring_id)
                    else dr.gas_spring_name) or "گازور"
            items.append(LineItem("gas_spring", "گازور / جک", name,
                                  f"{int(dr.gas_springs_per_leaf)} عدد در هر لنگه",
                                  qty, "عدد", price, qty * price))

        # دستگیره
        if dr.handle_id or dr.handle_price:
            qty = _f(dr.handles_per_leaf, 1) * leaves
            price = self.price_of(dr.handle_id, dr.handle_price)
            name = (self.mat(dr.handle_id).name if self.mat(dr.handle_id) else dr.handle_name) or "دستگیره"
            items.append(LineItem("handle", "دستگیره", name, f"{leaves} لنگه",
                                  qty, "عدد", price, qty * price))

        # مونتاژ و بسته‌بندی هر لنگه
        if dr.assembly_id or dr.assembly_price:
            price = self.price_of(dr.assembly_id, dr.assembly_price)
            name = (self.mat(dr.assembly_id).name if self.mat(dr.assembly_id)
                    else dr.assembly_name) or "مونتاژ در"
            items.append(LineItem("assembly_door", "مونتاژ و خدمات", name,
                                  f"{leaves} لنگه در", leaves, "لنگه", price, leaves * price))
        if dr.packaging_id or dr.packaging_price:
            price = self.price_of(dr.packaging_id, dr.packaging_price)
            name = (self.mat(dr.packaging_id).name if self.mat(dr.packaging_id)
                    else dr.packaging_name) or "بسته‌بندی در"
            items.append(LineItem("packaging_door", "مونتاژ و خدمات", name,
                                  f"{leaves} لنگه در", leaves, "لنگه", price, leaves * price))

        res.total_doors = getattr(res, "total_doors", 0) + leaves

    # ------------------------------------------------------------------
    def _calc_drawer(self, dw: DrawerRow, unit_qty: int, res: UnitResult,
                     items: List[LineItem]) -> None:
        count = int(dw.qty or 0) * unit_qty
        if count <= 0:
            return

        # بدنه‌ی جعبه‌ی کشو
        if dw.sheet_id or dw.sheet_price_per_sqm:
            m = self.mat(dw.sheet_id)
            ppsqm = _f(m.price_per_sqm) if m else _f(dw.sheet_price_per_sqm)
            name = m.name if m else (dw.sheet_name or "ورق بدنه‌ی کشو")
            area = dw.box_area_sqm * count
            items.append(LineItem("drawer_box", "جعبه‌ی کشو", name,
                                  f"{count} عدد × {dw.box_area_sqm:.3f} م²",
                                  area, "م²", ppsqm, area * ppsqm))

        # تیره‌ی کشو
        if dw.front_id or dw.front_price_per_sqm:
            m = self.mat(dw.front_id)
            ppsqm = _f(m.price_per_sqm) if m else _f(dw.front_price_per_sqm)
            name = m.name if m else (dw.front_name or "تیره‌ی کشو")
            area = dw.front_area_sqm * count
            items.append(LineItem("drawer_front", "تیره‌ی کشو", name,
                                  f"{count} عدد × {dw.front_area_sqm:.3f} م²",
                                  area, "م²", ppsqm, area * ppsqm))
            res.door_area += area

        # ریل
        if dw.slide_id or dw.slide_price:
            price = self.price_of(dw.slide_id, dw.slide_price)
            name = (self.mat(dw.slide_id).name if self.mat(dw.slide_id) else dw.slide_name) or "ریل کشو"
            items.append(LineItem("drawer_slide", "ریل کشو", name, f"{count} عدد کشو",
                                  count, "ست", price, count * price))

        # نوار
        if dw.banding_id:
            m = self.mat(dw.banding_id)
            if m is not None:
                meters = dw.banding_m * count
                items.append(LineItem("banding_drawer", "نوار PVC کشو", m.name,
                                      f"{dw.banding_m:.2f} متر در هر کشو",
                                      meters, "متر", _f(m.price), meters * _f(m.price)))
                res.banding_m += meters

        # دستگیره
        if dw.handle_id or dw.handle_price:
            price = self.price_of(dw.handle_id, dw.handle_price)
            name = (self.mat(dw.handle_id).name if self.mat(dw.handle_id)
                    else dw.handle_name) or "دستگیره"
            items.append(LineItem("handle", "دستگیره", name, f"{count} عدد کشو",
                                  count, "عدد", price, count * price))

        # مونتاژ
        if dw.assembly_id or dw.assembly_price:
            price = self.price_of(dw.assembly_id, dw.assembly_price)
            name = (self.mat(dw.assembly_id).name if self.mat(dw.assembly_id)
                    else dw.assembly_name) or "مونتاژ کشو"
            items.append(LineItem("assembly_drawer", "مونتاژ و خدمات", name,
                                  f"{count} عدد کشو", count, "عدد", price, count * price))

        res.total_drawers = getattr(res, "total_drawers", 0) + count

    # ------------------------------------------------------------------
    # محاسبه‌ی یک صفحه (سبک)
    # ------------------------------------------------------------------
    def calc_page(self, page: Page) -> PageResult:
        pr = PageResult(name=page.name or "بخش")
        countertop_items: List[LineItem] = []

        for u in page.units:
            ur = self.calc_unit(u, page)
            pr.unit_results.append(ur)
            pr.items.extend(ur.items)
            pr.total_units += max(0, int(u.qty or 0))
            pr.total_doors += sum(d.leaves for d in u.doors) * max(1, int(u.qty or 1))
            pr.total_drawers += sum(int(d.qty or 0) for d in u.drawers) * max(1, int(u.qty or 1))
            if u.unit_type in ("ground", "tall"):
                pr.total_ground_lm += _f(u.length_cm) / 100.0 * max(1, int(u.qty or 1))
            if u.unit_type == "wall":
                pr.total_wall_lm += _f(u.length_cm) / 100.0 * max(1, int(u.qty or 1))

        # صفحه‌ی کابینت کلی صفحه (اگر کاربر متراژ کلی داده باشد)
        if page.countertop_lm > 0:
            used = [u for u in page.units if u.countertop_id]
            if used:
                cm = self.mat(used[0].countertop_id)
                if cm is not None:
                    price = _f(cm.price)
                    countertop_items.append(LineItem(
                        "countertop", "صفحه کابینت", cm.name,
                        f"{page.countertop_lm:.2f} متر طول (ورودی کلی)",
                        page.countertop_lm, "متر", price, page.countertop_lm * price))

        pr.items.extend(countertop_items)

        # درنما
        pr.detail_cost = self._calc_detail(page, pr)

        # اضافات
        for ex in page.extras:
            if not ex.label and not ex.price:
                continue
            pr.items.append(LineItem("extra", "اضافات و اکسسوری", ex.label or "قلم متفرقه",
                                     ex.note or "", _f(ex.qty), ex.unit_label(),
                                     _f(ex.price), _f(ex.cost), visible=bool(ex.visible)))
            pr.extra_cost += _f(ex.cost)

        # خدمات سطح صفحه
        pr.service_cost = self._calc_services(page, pr)

        # جمع‌بندی
        group_map = {
            "material_cost": {"body_sheet", "back_sheet", "countertop", "crown",
                              "underlight", "kickboard", "banding_body", "banding_drawer",
                              "drawer_box"},
            "door_cost": {"door_sheet", "door_model", "banding_door", "drawer_front"},
            "accessory_cost": {"hinge", "gas_spring", "shelf_pin", "handle", "leg",
                               "drawer_slide", "accessory"},
            "labor_cost": {"assembly_unit", "assembly_door", "assembly_drawer",
                           "packaging_door", "service"},
        }
        for it in pr.items:
            for attr, keys in group_map.items():
                if it.key in keys:
                    setattr(pr, attr, getattr(pr, attr) + _f(it.amount))
                    break

        pr.subtotal = (pr.material_cost + pr.door_cost + pr.accessory_cost +
                       pr.detail_cost + pr.labor_cost + pr.service_cost + pr.extra_cost)
        pr.waste_amount = 0.0     # پرت ورق داخل محاسبه‌ی ورق اعمال شده
        pr.overhead_amount = pr.subtotal * _f(page.overhead_percent) / 100.0
        pr.total_cost = pr.subtotal + pr.overhead_amount

        # آمار تجمیعی
        for ur in pr.unit_results:
            pr.total_body_area += ur.body_area
            pr.total_back_area += ur.back_area
            pr.total_door_area += ur.door_area
            pr.total_banding_m += ur.banding_m
            pr.total_sheets += ur.sheets
        for ur in pr.unit_results:
            pr.total_countertop_area += ur.countertop_area
        pr.total_area_sqm = pr.total_body_area + pr.total_door_area + pr.total_back_area
        return pr

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
            "sqm": 0.0,
            "lm": pr.total_ground_lm + pr.total_wall_lm,
            "fixed": 1.0,
            "percent": 0.0,
        }
        for u in page.units:
            ctx["shelf"] += _f(u.shelves) * max(1, int(u.qty or 1))
        for s in page.services:
            if not s.label and not s.price:
                continue
            if s.basis == "percent":
                continue        # در سطح پروژه و پس از محاسبه‌ی جمع اعمال می‌شود
            basis = s.basis if s.basis in ctx else "fixed"
            qty = ctx[basis] if basis != "percent" else 1.0
            amount = _f(qty) * _f(s.price)
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
                     extra_fixed_amount: float = 0.0) -> ProjectResult:
        out = ProjectResult()
        out.profit_mode = profit_mode
        out.profit_percent = _f(profit_percent)
        out.discount_percent = _f(discount_percent)
        out.discount_amount_input = _f(discount_amount)
        out.vat_percent = _f(vat_percent) if vat_enabled else 0.0

        stats = dict(total_units=0, total_doors=0, total_drawers=0, total_ground_lm=0.0,
                     total_wall_lm=0.0, total_body_area=0.0, total_door_area=0.0,
                     total_back_area=0.0, total_banding_m=0.0, total_sheets=0.0)

        for page in pages:
            pr = self.calc_page(page)
            # خدمات درصدی
            pct_services = [s for s in page.services if s.basis == "percent"]
            for s in pct_services:
                amt = pr.subtotal * _f(s.price) / 100.0
                pr.items.append(LineItem("service", "خدمات", s.label or "خدمات درصدی",
                                         f"{_f(s.price):g}٪ از جمع بخش", 1, "", _f(s.price), amt))
                pr.service_cost += amt
                pr.subtotal += amt
                pr.overhead_amount = pr.subtotal * _f(page.overhead_percent) / 100.0
                pr.total_cost = pr.subtotal + pr.overhead_amount
            out.pages.append(pr)
            out.pages_cost += pr.total_cost
            out.items.extend(pr.items)
            for k in stats:
                stats[k] += getattr(pr, k, 0) or 0

        if extra_fixed_amount:
            out.items.append(LineItem("extra_fixed", "اضافات و اکسسوری",
                                      "مبلغ ثابت بابت تفاوت نوع در / اقلام کلی", "",
                                      1, "موردی", _f(extra_fixed_amount), _f(extra_fixed_amount)))
            out.pages_cost += _f(extra_fixed_amount)
            stats["extra_fixed"] = _f(extra_fixed_amount)

        # هزینه‌ی نصب
        install = self._calc_installation(install_mode, install_value, out.pages_cost, stats)
        out.installation_cost = install
        if install > 0:
            out.items.append(LineItem("installation", "نصب و حمل", "هزینه‌ی نصب",
                                      self._install_detail(install_mode, install_value, stats),
                                      1, "موردی", install, install))
        out.total_cost = out.pages_cost + install

        # سود
        out.profit_amount = self.calc_profit(out.total_cost, profit_mode, _f(profit_percent))
        out.gross_price = out.total_cost + out.profit_amount

        # تخفیف
        disc = out.gross_price * _f(discount_percent) / 100.0 + _f(discount_amount)
        out.discount_amount = min(disc, out.gross_price)
        out.net_price = out.gross_price - out.discount_amount

        # مالیات
        out.vat_amount = out.net_price * out.vat_percent / 100.0
        out.final_price = out.net_price + out.vat_amount
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
            if p >= 100:
                return 0.0
            return cost * p / (100.0 - p)
        return cost * p / 100.0

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
