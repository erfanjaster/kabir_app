# -*- coding: utf-8 -*-
"""
سناریوهای لبه‌ای برای سنجشِ هم‌ارزیِ دو موتور (پایتون ↔ JS)
=============================================================
این فایل **۳۰ سناریوی لبه‌ای** را روی موتور پایتون (``kabir/core/costing.py``)
اجرا می‌کند و ورودی + خروجی را در ``/tmp/parity-edge-cases.json`` می‌نویسد.
سپس ``tests/parity_edge_check.js`` همان ورودی‌ها را به ``webui/js/engine.js``
می‌دهد و دو خروجی را ریال‌به‌ریال مقایسه می‌کند.

چرا لازم است؟
-------------
``tests/parity_check.js`` فقط **یک** پروژه‌ی طلایی را مقایسه می‌کند؛ یعنی
واگراییِ دو موتور در حالت‌های لبه‌ای دیده نمی‌شد. در بازرسی، ۸ واگرایی از ۳۰
سناریو پیدا شد (تا ۲ برابر اختلاف قیمت روی یک داده‌ی یکسان، و حتی یک قیمتِ
**منفی** در JS). همه‌ی آن ۸ مورد برطرف شد و این فایل همان ۳۰ سناریو را به
یک «درِ بازگشت» (regression gate) تبدیل می‌کند.

اجرا:
    python3 tests/parity_edge_export.py
    node    tests/parity_edge_check.js
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from kabir.core import costing as C                   # noqa: E402

OUT_PATH = Path("/tmp/parity-edge-cases.json")

MATERIALS = [
    C.Material(id=1, name="ورق بدنه", category="body_sheet", unit="sheet",
               price=1_000_000, sheet_width_cm=183, sheet_height_cm=366, thickness_mm=16),
    C.Material(id=2, name="ورق در", category="door_sheet", unit="sheet",
               price=2_000_000, sheet_width_cm=183, sheet_height_cm=366, thickness_mm=16),
    C.Material(id=3, name="ورق بدنه کوچک", category="body_sheet", unit="sheet",
               price=1_000_000, sheet_width_cm=100, sheet_height_cm=120, thickness_mm=16),
    C.Material(id=4, name="ام‌دی‌اف طرح چوب راش", category="body_sheet", unit="sheet",
               price=1_000_000, sheet_width_cm=183, sheet_height_cm=366, thickness_mm=16),
    C.Material(id=5, name="نوار", category="banding", unit="lm", price=20_000),
    C.Material(id=6, name="لولا", category="hinge", unit="piece", price=50_000),
    C.Material(id=7, name="ورق بدون ابعاد", category="body_sheet", unit="sheet",
               price=1_000_000, sheet_width_cm=0, sheet_height_cm=0, thickness_mm=16),
    C.Material(id=8, name="ورق با واحدِ عددی", category="body_sheet", unit="piece",
               price=1_000_000, sheet_width_cm=0, sheet_height_cm=0, thickness_mm=16),
]

SETTINGS = {"default_waste_percent": "10", "persian_digits": "0"}


def U(**kw):
    d = dict(id="u1", label="یونیت", unit_type="ground", qty=1, length_cm=90,
             height_cm=72, depth_cm=55, shelves=1, body_id=1, has_top_panel=False,
             has_bottom_panel=True, legs_per_unit=4, pins_per_shelf=4)
    d.update(kw)
    return C.UnitRow.from_dict(d)


def DR(**kw):
    d = dict(label="در", qty=2, w_cm=45, h_cm=70, material_id=2,
             hinges_per_leaf=2, handles_per_leaf=1, from_body=False)
    d.update(kw)
    return d


def DW(**kw):
    d = dict(label="کشو", qty=3, w_cm=80, h_cm=18, d_cm=45, sheet_id=1)
    d.update(kw)
    return d


def PG(units, **kw):
    d = dict(name="بخش ۱", units=units, waste_percent=10.0, overhead_percent=0.0,
             banding_body_factor=2.2, banding_door_factor=1.0, banding_waste_percent=8.0)
    d.update(kw)
    return C.Page(**d)


CASES = {}


def add(name, pages, **proj):
    CASES[name] = {"pages": [p.to_dict() for p in pages], "project": proj}


# ── حالتِ پایه و ابعادِ صفر/منفی ─────────────────────────────────────────
add("base", [PG([U()])])
add("depth_zero", [PG([U(depth_cm=0)])])
add("depth_neg", [PG([U(depth_cm=-55)])])
add("height_zero", [PG([U(height_cm=0)])])
add("length_tiny", [PG([U(length_cm=1, shelves=2)])])

# ── شمارنده‌های منفی ─────────────────────────────────────────────────────
add("shelves_neg", [PG([U(shelves=-3, shelf_pin_id=6)])])
add("legs_neg", [PG([U(legs_per_unit=-4)])])

# ── تعدادِ غیرصحیح (پیش‌تر کرش) ─────────────────────────────────────────
add("unit_qty_float", [PG([U(qty=2.9)])])
add("drawer_qty_float", [PG([U(drawers=[DW(qty=2.7)])])])
add("drawer_qty_zero", [PG([U(drawers=[DW(qty=0)])])])

# ── «در از ورق بدنه» ────────────────────────────────────────────────────
add("door_frombody_ok", [PG([U(doors=[DR(from_body=True, material_id=0)])])])
add("door_frombody_big",
    [PG([U(doors=[DR(from_body=True, material_id=0, qty=1, w_cm=400, h_cm=60)])])])
add("door_frombody_small_sheet",
    [PG([U(body_id=3, doors=[DR(from_body=True, material_id=0)])])])
add("door_frombody_grain",
    [PG([U(body_id=4, doors=[DR(from_body=True, material_id=0, qty=1, w_cm=250, h_cm=60)])])])

# ── ورقِ بی‌ابعاد (F-05) ────────────────────────────────────────────────
add("sheet_no_dims", [PG([U(body_id=7)])])
add("sheet_wrong_unit", [PG([U(body_id=8)])])

# ── بولین‌های falsy (ریشه‌ی واگراییِ `!== false` در JS) ──────────────────
add("has_bottom_null", [PG([U(has_bottom_panel=None)])])
add("has_bottom_zero", [PG([U(has_bottom_panel=0)])])
add("bottom_panel_zero_qty5", [PG([U(qty=5, has_bottom_panel=0)])])
add("bottom_panel_true_qty5", [PG([U(qty=5, has_bottom_panel=True)])])

# ── اقلامِ اضافه با تعدادِ خراب ─────────────────────────────────────────
add("extra_qty_empty", [PG([U()])])
CASES["extra_qty_empty"]["pages"][0]["extras"] = [
    {"label": "نورپردازی", "qty": "", "unit": "piece", "price": 500_000, "visible": True}]
add("extra_qty_null", [PG([U()])])
CASES["extra_qty_null"]["pages"][0]["extras"] = [
    {"label": "نورپردازی", "qty": None, "unit": "piece", "price": 500_000, "visible": True}]
add("extra_qty_neg", [PG([U()])])
CASES["extra_qty_neg"]["pages"][0]["extras"] = [
    {"label": "برگشت", "qty": -2, "unit": "piece", "price": 500_000, "visible": True}]

# ── خدمات ───────────────────────────────────────────────────────────────
add("svc_sqm", [PG([U()])])
CASES["svc_sqm"]["pages"][0]["services"] = [
    {"label": "رنگ", "basis": "sqm", "qty": 1, "price": 300_000}]
add("svc_neg_price", [PG([U()])])
CASES["svc_neg_price"]["pages"][0]["services"] = [
    {"label": "تخفیف نصب", "basis": "fixed", "qty": 1, "price": -200_000}]
add("svc_percent", [PG([U()])])
CASES["svc_percent"]["pages"][0]["services"] = [
    {"label": "مدیریت", "basis": "percent", "qty": 1, "price": 10}]

# ── عمق منفی + خدمت مترمربعی (F-04: قیمتِ منفی) ─────────────────────────
_p = PG([U(depth_cm=-55)])
_p.services = [C.ServiceRow(label="نصب", basis="sqm", price=300_000)]
add("depth_neg_sqm_svc", [_p])
_p2 = PG([U(depth_cm=55)])
_p2.services = [C.ServiceRow(label="نصب", basis="sqm", price=300_000)]
add("depth_pos_sqm_svc", [_p2])

# ── تجمیع ورق در سطح پروژه (F-01) ───────────────────────────────────────
add("two_pages_same_mat", [PG([U()], name="بخش ۱"), PG([U()], name="بخش ۲")])
add("kitchen_1_section", [PG([U(qty=8, length_cm=90, shelves=1)])])
add("kitchen_4_sections",
    [PG([U(qty=2, length_cm=90, shelves=1)], name=f"بخش {i}") for i in range(1, 5)])
add("kitchen_8_sections",
    [PG([U(qty=1, length_cm=90, shelves=1)], name=f"بخش {i}") for i in range(1, 9)])
add("exact_one_sheet_waste0",
    [PG([U(qty=1, length_cm=1000, height_cm=1000, depth_cm=1000, shelves=0,
           has_top_panel=False, has_bottom_panel=False)], waste_percent=0)])

# ── صفحه‌ی دو جنس (وابستگی به ترتیب یونیت‌ها) ───────────────────────────
add("mixed_countertop",
    [PG([U(label="a", length_cm=200, countertop_id=5),
         U(label="b", length_cm=200, countertop_id=6)], countertop_lm=4.0)])


def main() -> int:
    engine = C.CostingEngine(MATERIALS, SETTINGS)
    out = {}
    for name, case in CASES.items():
        pages = [C.Page.from_dict(dict(p)) for p in case["pages"]]
        pr = case["project"]
        try:
            r = engine.calc_project(
                pages,
                install_mode=pr.get("install_mode", "none"),
                install_value=pr.get("install_value", 0),
                profit_mode=pr.get("profit_mode", "markup"),
                profit_percent=pr.get("profit_percent", 0),
                discount_percent=pr.get("discount_percent", 0),
                discount_amount=pr.get("discount_amount", 0),
                vat_enabled=bool(pr.get("vat_enabled", False)),
                vat_percent=pr.get("vat_percent", 0),
                extra_fixed_amount=pr.get("extra_fixed_amount", 0))
            out[name] = {
                "ok": True,
                "total_cost": r.total_cost,
                "final_price": r.final_price,
                "stats": {k: v for k, v in r.stats.items()},
                "n_items": len(r.items),
                "item_sum": sum(i.amount for i in r.items),
                "warnings": len(r.warnings),
            }
        except Exception as exc:                       # noqa: BLE001
            out[name] = {"ok": False, "err": f"{type(exc).__name__}: {exc}"}

    payload = {
        "materials": [
            {"id": m.id, "name": m.name, "cat": m.category, "unit": m.unit,
             "price": m.price, "sheet_width_cm": m.sheet_width_cm,
             "sheet_height_cm": m.sheet_height_cm, "thickness_mm": m.thickness_mm,
             "width_cm": m.width_cm, "note": m.note or "", "active": True}
            for m in MATERIALS],
        "settings": SETTINGS,
        "cases": CASES,
        "py": out,
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    crashed = [k for k, v in out.items() if not v["ok"]]
    print(f"{len(CASES)} سناریوی لبه‌ای روی موتور پایتون اجرا شد → {OUT_PATH}")
    if crashed:
        print(f"⚠ {len(crashed)} سناریو کرش کرد: {crashed}")
        for k in crashed:
            print(f"   {k}: {out[k]['err']}")
        return 1
    print("✅ هیچ سناریویی کرش نکرد")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
