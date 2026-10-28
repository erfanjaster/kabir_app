# -*- coding: utf-8 -*-
"""
خروجی‌های کارگاهی — برش‌نامه و لیست خرید
=========================================
این ماژول دو چیزی را می‌سازد که کابینت‌کار **بعد از** قیمت‌گیری به آن‌ها نیاز
دارد و تا پیش از این در رابط وب هیچ راهی برای گرفتنشان وجود نداشت:

۱) **برش‌نامه (Cut list)** — فهرست تک‌تک قطعات با ابعاد دقیق، تعداد، ضخامت،
   نوع ورق و اینکه لبه‌ها نوار می‌خورند یا نه. این همان برگه‌ای است که به
   اپراتور ارّه‌ی پنل‌بر و دستگاه نوارچسبان و CNC داده می‌شود.

۲) **لیست خرید (Shopping list)** — جمع‌بندی همه‌ی مصرفی‌ها بر اساس متریال:
   چند ورق، چند متر نوار، چند لولا، چند دستگیره… یعنی همان برگه‌ای که با آن
   به بازار/انبار می‌رویم.

هر دو از همان داده‌ای ساخته می‌شوند که موتور محاسبه تولید کرده، پس عددی
که این‌جا می‌بینید با عدد فاکتور **یکی** است.

واحد ابعاد در برش‌نامه **میلی‌متر** است (زبان مشترک دستگاه‌های برش و CNC) و
طبق قرارداد، «طول» همیشه بزرگ‌تر از «عرض» نوشته می‌شود.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from . import costing
from .costing import CostingEngine, DrawerRow, Page

#: ضخامت ورق پیش‌فرض وقتی متریال ضخامت ندارد (میلی‌متر)
DEFAULT_THICKNESS_MM = 16.0

#: برچسب فارسی دسته‌ها (برای گروه‌بندی لیست خرید)
CAT_ORDER = [
    "body_sheet", "door_sheet", "back_sheet", "drawer_sheet", "door_model",
    "countertop", "crown", "underlight", "kickboard", "banding", "hinge",
    "gas_spring", "shelf_pin", "handle", "leg", "drawer_slide", "accessory",
    "service",
]

#: ترتیب نمایش گروه‌ها در لیست خرید
SHOP_GROUPS = [
    ("sheet", "ورق و پنل"),
    ("banding", "نوار لبه (PVC)"),
    ("profile", "صفحه، تاج، زیرچراغ و پاخور"),
    ("hardware", "یراق‌آلات"),
    ("service", "خدمات و اجرت"),
    ("other", "سایر"),
]

#: نگاشت کلید ردیف → گروه لیست خرید
_KEY_TO_SHOP_GROUP = {
    "body_sheet": "sheet", "back_sheet": "sheet", "door_sheet": "sheet",
    "drawer_box": "sheet", "drawer_front": "sheet",
    "banding_body": "banding", "banding_door": "banding", "banding_drawer": "banding",
    "countertop": "profile", "crown": "profile", "underlight": "profile",
    "kickboard": "profile",
    "hinge": "hardware", "gas_spring": "hardware", "handle": "hardware",
    "leg": "hardware", "shelf_pin": "hardware", "drawer_slide": "hardware",
    "accessory": "hardware",
    "door_model": "service", "assembly_unit": "service", "assembly_door": "service",
    "assembly_drawer": "service", "packaging_door": "service", "service": "service",
    "extra": "other", "extra_fixed": "other", "installation": "other",
    "darna": "other",
}


# ---------------------------------------------------------------------------
@dataclass
class CutPart:
    """یک قطعه در برش‌نامه."""
    section: str = ""          # نام بخش
    unit: str = ""             # برچسب یونیت
    part: str = ""             # نام قطعه
    qty: int = 1
    length_mm: float = 0.0     # بُعد بزرگ‌تر
    width_mm: float = 0.0      # بُعد کوچک‌تر
    thickness_mm: float = DEFAULT_THICKNESS_MM
    material: str = ""         # نام ورق/متریال
    mat_cat: str = ""          # دسته (body_sheet / back_sheet / door_sheet …)
    banding: bool = True       # نوار لبه می‌خواهد؟
    banding_sides: str = ""    # کدام لبه‌ها (راهنمای اپراتور نوارچسبان)
    area_sqm: float = 0.0
    grain: bool = False        # راستای طرح دارد؟ (ورق‌های طرح چوب/راه‌راه)

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class ShopLine:
    """یک قلم در لیست خرید."""
    name: str = ""
    cat: str = ""
    group: str = "other"
    qty: float = 0.0
    unit: str = ""
    unit_label: str = ""
    amount: float = 0.0
    sheets: float = 0.0        # فقط برای ورق‌ها: تعداد ورق کاملِ خریدنی
    note: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)


# ---------------------------------------------------------------------------
# برش‌نامه
# ---------------------------------------------------------------------------

def _ordered(w: float, h: float) -> Tuple[float, float]:
    """(طول، عرض) بر حسب میلی‌متر — طول همیشه بزرگ‌تر."""
    a, b = float(w or 0.0) * 10.0, float(h or 0.0) * 10.0
    return (max(a, b), min(a, b))


def _banding_sides_for(label: str, unit_type: str) -> str:
    """راهنمای لبه‌های نوارخور — بر اساس نقش قطعه در یونیت."""
    lbl = (label or "").lower()
    if "بدنه کناری" in label or "کناری" in label:
        return "۱ طول (لبه‌ی جلو)"
    if "کف" in label or "سقف" in label or "طبقه" in label:
        return "۲ طول + ۱ عرض (لبه‌ی جلو و دو بغل)"
    if "فیبر" in label:
        return "—"
    if "تیره" in label or "در" in label:
        return "دور تا دور"
    return "لبه‌های نمایان"


def build_cut_list(engine: CostingEngine, pages: List[Page]) -> List[CutPart]:
    """
    ساخت برش‌نامه‌ی کامل پروژه.

    قطعات بدنه از `engine.panels_of(unit)` می‌آیند (یعنی همان ریزی که کاربر در
    تب «جزئیات» یونیت می‌بیند و می‌تواند دستی عوض کند)، به‌علاوه‌ی لنگه‌های در،
    تیره‌ی کشو و قطعات جعبه‌ی کشو.
    """
    out: List[CutPart] = []

    def thickness_of(mid: int, default: float = DEFAULT_THICKNESS_MM) -> float:
        m = engine.mat(mid)
        if m is not None and m.thickness_mm:
            return float(m.thickness_mm)
        return default

    def name_of(mid: int, fallback: str = "") -> str:
        m = engine.mat(mid)
        return m.name if m is not None else (fallback or "—")

    def grain_of(mid: int) -> bool:
        m = engine.mat(mid)
        if m is None:
            return False
        hay = f"{m.name} {m.note or ''}"
        return any(k in hay for k in ("طرح چوب", "راه‌راه", "راشه", "گردو", "طرح‌دار"))

    for page in pages:
        sec = page.name or "بخش"
        for u in page.units:
            # یونیت با تعداد ≤ ۰ در قیمت هم شمرده نمی‌شود، پس در برش‌نامه هم
            # نباید قطعه‌ای برایش صادر شود (پیش‌تر max(1,..) یک عدد می‌ساخت!)
            n = int(float(u.qty or 0))
            if n <= 0:
                continue
            u_label = u.label or "یونیت"

            # --- پنل‌های بدنه و فیبر پشت ---
            for pn in engine.panels_of(u):
                if not pn.enabled:
                    continue
                is_back = (pn.material_key == "back")
                mid = u.back_id if is_back else u.body_id
                # اگر متریال انتخاب نشده باشد هم قطعه در برش‌نامه می‌ماند؛
                # اپراتورِ ارّه به «ابعاد» نیاز دارد، نه به اسم ورق. (حذفش
                # باعث می‌شد کل بدنه‌ی پروژه‌های هنوز قیمت‌نگرفته ناپدید شود)
                ln, wd = _ordered(pn.w_cm, pn.h_cm)
                qty = int(round(float(pn.qty) * n))
                out.append(CutPart(
                    section=sec, unit=u_label, part=pn.label or "قطعه",
                    qty=qty, length_mm=ln, width_mm=wd,
                    thickness_mm=thickness_of(mid, 3.0 if is_back else DEFAULT_THICKNESS_MM),
                    material=name_of(mid),
                    mat_cat="back_sheet" if is_back else "body_sheet",
                    banding=bool(pn.banding) and not is_back,
                    banding_sides=_banding_sides_for(pn.label or "", u.unit_type),
                    area_sqm=round(pn.area_sqm * n, 4),
                    grain=grain_of(mid),
                ))

            # --- لنگه‌های در ---
            for dr in u.doors:
                leaves = int(dr.leaves) * n
                if leaves <= 0:
                    continue
                # ★ «در از ورق بدنه»: لنگه از همان ورقِ بدنه برش می‌خورد، پس در
                #   برش‌نامه هم باید با نام/دسته‌ی ورق بدنه بیفتد تا اپراتورِ ارّه
                #   سراغ ورقِ اشتباه نرود و خلاصه‌ی ورق درست جمع شود.
                from_body = bool(getattr(dr, "from_body", False)) and bool(u.body_id) \
                    and costing.door_leaf_fits_sheet(dr, engine.mat(u.body_id))[0]
                mid = u.body_id if from_body else (dr.material_id or u.body_id)
                ln, wd = _ordered(dr.w_cm, dr.h_cm)
                out.append(CutPart(
                    section=sec, unit=u_label,
                    part=(dr.label or "در") + " (لنگه)" + (" — از ورق بدنه" if from_body else ""),
                    qty=leaves, length_mm=ln, width_mm=wd,
                    thickness_mm=thickness_of(mid),
                    material=name_of(mid, dr.material_name),
                    mat_cat="body_sheet" if from_body else "door_sheet",
                    banding=True,
                    banding_sides="دور تا دور",
                    area_sqm=round(dr.area_sqm * n, 4),
                    grain=grain_of(mid),
                ))

            # --- کشوها: تیره + قطعات جعبه ---
            for dw in u.drawers:
                out.extend(_drawer_parts(sec, u_label, dw, n, engine))

    # مرتب‌سازی: بخش → یونیت → طول → عرض (ترتیبی که اپراتور برش راحت است)
    out.sort(key=lambda p: (p.section, p.unit, -p.length_mm, -p.width_mm))
    return out


def _drawer_parts(sec: str, u_label: str, dw: DrawerRow, n: int,
                  engine: CostingEngine) -> List[CutPart]:
    """قطعات یک ردیف کشو: تیره، دو بغل، کف و پشت."""
    cnt = int(dw.qty or 0) * n
    if cnt <= 0:
        return []
    w, h, d = float(dw.w_cm or 0), float(dw.h_cm or 0), float(dw.d_cm or 0)
    label = dw.label or "کشو"
    parts: List[CutPart] = []

    def thickness_of(mid: int, default: float = DEFAULT_THICKNESS_MM) -> float:
        m = engine.mat(mid)
        return float(m.thickness_mm) if (m is not None and m.thickness_mm) else default

    def name_of(mid: int, fb: str) -> str:
        m = engine.mat(mid)
        return m.name if m is not None else (fb or "—")

    # تیره‌ی کشو (نما) — معمولاً هم‌جنس درها
    front_mid = dw.front_id or dw.sheet_id
    ln, wd = _ordered(w, h)
    parts.append(CutPart(
        section=sec, unit=u_label, part=f"تیره‌ی {label}", qty=cnt,
        length_mm=ln, width_mm=wd, thickness_mm=thickness_of(front_mid),
        material=name_of(front_mid, dw.front_name), mat_cat="door_sheet",
        banding=True, banding_sides="دور تا دور",
        area_sqm=round(cnt * (w / 100.0) * (h / 100.0), 4),
    ))
    # دو بغل
    ln, wd = _ordered(d, h)
    parts.append(CutPart(
        section=sec, unit=u_label, part=f"بغل {label}", qty=cnt * 2,
        length_mm=ln, width_mm=wd, thickness_mm=thickness_of(dw.sheet_id),
        material=name_of(dw.sheet_id, dw.sheet_name), mat_cat="drawer_sheet",
        banding=True, banding_sides="۱ طول (لبه‌ی بالا)",
        area_sqm=round(cnt * 2 * (d / 100.0) * (h / 100.0), 4),
    ))
    # ضخامت واقعیِ ورقِ جعبه (پیش‌تر ۱٫۶ سانتِ ثابت فرض می‌شد حتی برای ورق ۱۸)
    t_cm = thickness_of(dw.sheet_id, 16.0) / 10.0
    # پشت جعبه
    ln, wd = _ordered(w - 2 * t_cm, h)
    parts.append(CutPart(
        section=sec, unit=u_label, part=f"پشت {label}", qty=cnt,
        length_mm=ln, width_mm=wd, thickness_mm=thickness_of(dw.sheet_id),
        material=name_of(dw.sheet_id, dw.sheet_name), mat_cat="drawer_sheet",
        banding=False, banding_sides="—",
        area_sqm=round(cnt * max(0.0, (w - 2 * t_cm) / 100.0) * (h / 100.0), 4),
    ))
    # کف جعبه (معمولاً فیبر ۳ میل)
    ln, wd = _ordered(w - 2 * t_cm, d)
    parts.append(CutPart(
        section=sec, unit=u_label, part=f"کف {label}", qty=cnt,
        length_mm=ln, width_mm=wd, thickness_mm=3.0,
        material="فیبر ۳ میل (کف کشو)", mat_cat="back_sheet",
        banding=False, banding_sides="—",
        area_sqm=round(cnt * max(0.0, (w - 2 * t_cm) / 100.0) * (d / 100.0), 4),
    ))
    return parts


def summarize_sheets(parts: List[CutPart], engine: CostingEngine,
                     settings: Optional[Dict[str, str]] = None,
                     result: Optional[costing.ProjectResult] = None) -> List[Dict[str, Any]]:
    """
    چند ورق از هر متریال لازم است؟

    اگر نتیجه‌ی محاسبه‌ی قیمت (result) در دسترس باشد، تعداد ورق «همان عددی»
    است که در فاکتور پولش گرفته شده (با پرت و گردشدن در سطح بخش) — پیش‌تر
    این خلاصه بدون پرت محاسبه می‌شد و می‌توانست کمتر از ورقِ فاکتور بگوید
    (کارگاه یک ورق کمتر می‌خرید و کار می‌خوابید!). در غیر این صورت، بر
    اساس مساحت قطعات برش‌نامه تقریب زده می‌شود.
    """
    st = settings or {}

    # ورق‌های «فاکتورشده» به تفکیک نام متریال (از ردیف‌های محاسبه)
    invoiced_sheets: Dict[str, float] = {}
    if result is not None:
        per_mid: Dict[int, float] = {}
        for it in result.items:
            if it.key in CostingEngine.SHEET_ITEM_KEYS and it.mat_id:
                per_mid[int(it.mat_id)] = per_mid.get(int(it.mat_id), 0.0) + float(it.sheets or 0.0)
        for mid, sheets in per_mid.items():
            m = engine.mat(mid)
            if m is not None:
                invoiced_sheets[m.name] = invoiced_sheets.get(m.name, 0.0) + sheets

    def _num(key: str, d: float) -> float:
        try:
            return float(st.get(key, d))
        except (TypeError, ValueError):
            return float(d)

    # ابعاد ورق پیش‌فرض برای متریال‌هایی که در کتابخانه قیمت نیستند
    fallback = {
        "body_sheet": (_num("sheet_width_cm", 183), _num("sheet_height_cm", 366)),
        "door_sheet": (_num("sheet_width_cm", 183), _num("sheet_height_cm", 366)),
        "drawer_sheet": (_num("sheet_width_cm", 183), _num("sheet_height_cm", 366)),
        "back_sheet": (_num("fiber_sheet_width_cm", 122), _num("fiber_sheet_height_cm", 244)),
    }

    agg: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for p in parts:
        k = (p.material, p.mat_cat)
        a = agg.setdefault(k, {"material": p.material, "cat": p.mat_cat,
                               "area_sqm": 0.0, "thickness_mm": p.thickness_mm,
                               "parts": 0, "pieces": 0, "sheets": 0.0,
                               "sheet_size": "", "price": 0.0, "cost": 0.0})
        a["area_sqm"] += p.area_sqm
        a["parts"] += 1
        a["pieces"] += p.qty
    for a in agg.values():
        a["area_sqm"] = round(a["area_sqm"], 3)
        mid = _find_material_id(engine, a["material"], a["cat"])
        m = engine.mat(mid) if mid else None
        if m is not None and m.sheet_area_sqm > 0:
            sa, size, price = m.sheet_area_sqm, \
                f"{m.sheet_width_cm:.0f}×{m.sheet_height_cm:.0f}", float(m.price)
        elif a["cat"] in fallback:
            fw, fh = fallback[a["cat"]]
            sa, size, price = (fw / 100.0) * (fh / 100.0), f"{fw:.0f}×{fh:.0f}", 0.0
        else:
            sa, size, price = 0.0, "", 0.0
        a["sheet_size"] = size
        a["price"] = price
        if a["material"] in invoiced_sheets:
            a["sheets"] = round(invoiced_sheets[a["material"]], 3)
            a["cost"] = a["sheets"] * price
            a["note"] = "همان تعداد ورقِ فاکتورشده (با پرت و تجمیع بخش)"
        elif sa > 0:
            a["sheets"] = float(costing.round_up_sheets(a["area_sqm"], sa, 0.0))
            a["cost"] = a["sheets"] * price
    rows = sorted(agg.values(), key=lambda x: (CAT_ORDER.index(x["cat"])
                                               if x["cat"] in CAT_ORDER else 99,
                                               -x["area_sqm"]))
    return rows


def _find_material_id(engine: CostingEngine, name: str, cat: str) -> int:
    # اول هم‌نامِ هم‌دسته (دقیق‌تر)؛ بعد هر هم‌نام — پیش‌تر دسته نادیده گرفته
    # می‌شد و دو قلمِ هم‌نام در دسته‌های مختلف به هم قاطی می‌شدند.
    fallback = 0
    for mid, m in engine.materials.items():
        if m.name == name:
            if m.category == cat:
                return int(mid)
            fallback = fallback or int(mid)
    return fallback


# ---------------------------------------------------------------------------
# لیست خرید
# ---------------------------------------------------------------------------

def build_shopping_list(result: costing.ProjectResult,
                        engine: Optional[CostingEngine] = None) -> List[ShopLine]:
    """
    جمع‌بندی همه‌ی ردیف‌های محاسبه بر اساس متریال → «چه چیزی بخرم؟»

    ردیف‌هایی که متریال مشخص ندارند (اضافات دستی، نصب، درنما) هم با نام خودشان
    در گروه «سایر» می‌آیند تا لیست خرید چیزی را جا نیندازد.
    """
    agg: Dict[Tuple[str, str, str], ShopLine] = {}
    unit_of = {}
    if engine is not None:
        unit_of = {int(m.id): (m.unit, m.name) for m in engine.materials.values()}

    for it in result.items:
        if not it.visible:
            continue
        if it.key in ("installation", "extra_fixed"):
            continue                      # این‌ها خرید نیستند
        group = _KEY_TO_SHOP_GROUP.get(it.key, "other")
        key = (str(it.mat_id or 0), it.title, group)
        line = agg.get(key)
        if line is None:
            munit = ""
            if it.mat_id and it.mat_id in unit_of:
                munit = unit_of[int(it.mat_id)][0]
            line = ShopLine(name=it.title, cat=it.mat_cat or "", group=group,
                            unit=munit, unit_label=it.unit_label or "")
            agg[key] = line
        line.qty += float(it.qty or 0.0)
        line.amount += float(it.amount or 0.0)
        line.sheets += float(it.sheets or 0.0)
        if not line.unit_label and it.unit_label:
            line.unit_label = it.unit_label

    # ورق‌ها: تعداد «ورق کامل» همان چیزی است که می‌خریم
    out: List[ShopLine] = []
    for line in agg.values():
        if line.group == "sheet" and line.sheets > 0:
            line.qty = round(line.sheets, 3)
            line.unit_label = "ورق"
            line.unit = "sheet"
            line.note = "تعداد ورق کاملِ خریدنی (تجمیع‌شده در سطح بخش)"
        elif line.unit == "sheet":
            line.unit_label = line.unit_label or "ورق"
        out.append(line)

    order = {g: i for i, (g, _) in enumerate(SHOP_GROUPS)}
    out.sort(key=lambda x: (order.get(x.group, 99),
                            CAT_ORDER.index(x.cat) if x.cat in CAT_ORDER else 99,
                            -x.amount))
    return out


def shopping_groups(lines: List[ShopLine]) -> List[Dict[str, Any]]:
    """گروه‌بندی لیست خرید برای نمایش در رابط."""
    out = []
    for gkey, glabel in SHOP_GROUPS:
        rows = [ln for ln in lines if ln.group == gkey]
        if not rows:
            continue
        out.append({
            "key": gkey, "label": glabel,
            "total": round(sum(r.amount for r in rows), 2),
            "count": len(rows),
            "rows": [r.to_dict() for r in rows],
        })
    return out


# ---------------------------------------------------------------------------
# بسته‌ی کامل خروجی
# ---------------------------------------------------------------------------

def build_workshop_pack(engine: CostingEngine, pages: List[Page],
                        result: costing.ProjectResult,
                        settings: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """یک‌جا: برش‌نامه + خلاصه‌ی ورق + لیست خرید (برای ارسال به رابط وب)."""
    parts = build_cut_list(engine, pages)
    sheets = summarize_sheets(parts, engine, settings, result=result)
    lines = build_shopping_list(result, engine)

    # آمار سرجمع برش‌نامه
    by_cat: Dict[str, Dict[str, float]] = {}
    for p in parts:
        c = by_cat.setdefault(p.mat_cat, {"parts": 0, "pieces": 0, "area_sqm": 0.0})
        c["parts"] += 1
        c["pieces"] += p.qty
        c["area_sqm"] += p.area_sqm

    total_pieces = sum(p.qty for p in parts)
    total_area = round(sum(p.area_sqm for p in parts), 3)
    banding_pieces = sum(p.qty for p in parts if p.banding)
    banding_m = round(sum(
        (2 * (p.length_mm + p.width_mm) / 1000.0) * p.qty for p in parts if p.banding), 2)

    return {
        "cut_parts": [p.to_dict() for p in parts],
        "sheet_summary": [{k: v for k, v in s.items()} for s in sheets],
        "shopping": [ln.to_dict() for ln in lines],
        "shopping_groups": shopping_groups(lines),
        "by_category": by_cat,
        "stats": {
            "part_kinds": len(parts),
            "total_pieces": int(total_pieces),
            "total_area_sqm": total_area,
            "banding_pieces": int(banding_pieces),
            "banding_perimeter_m": banding_m,
            "total_sheets": round(sum(float(s.get("sheets") or 0) for s in sheets), 2),
            "shopping_total": round(sum(ln.amount for ln in lines), 2),
        },
    }
