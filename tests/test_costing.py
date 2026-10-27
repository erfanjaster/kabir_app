# -*- coding: utf-8 -*-
"""تست‌های واحد موتور محاسبه — اجرا:  pytest tests -v"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from kabir.core.costing import (                     # noqa: E402
    CostingEngine, DoorRow, DrawerRow, ExtraRow, Material, Page, ServiceRow, UnitRow,
)
from kabir.core import persian as fa                  # noqa: E402
from kabir.core import invoice as inv                 # noqa: E402

MATS = [
    Material(1, "ورق بدنه", "body_sheet", "sheet", 4_800_000, 183, 366, 16),
    Material(2, "فیبر پشت", "back_sheet", "sheet", 1_600_000, 122, 244, 3),
    Material(3, "ورق در", "door_sheet", "sheet", 9_000_000, 183, 366, 16),
    Material(4, "لولا", "hinge", "piece", 100_000),
    Material(5, "دستگیره", "handle", "piece", 90_000),
    Material(6, "پایه", "leg", "piece", 25_000),
    Material(7, "نوار", "banding", "lm", 20_000),
    Material(8, "ریل", "drawer_slide", "set", 800_000),
    Material(9, "خار", "shelf_pin", "piece", 3_000),
    Material(10, "صفحه", "countertop", "lm", 3_000_000, 0, 0, 0, 60),
]


def make_engine() -> CostingEngine:
    return CostingEngine(MATS, {})


def make_page() -> Page:
    door = DoorRow(qty=2, w_cm=45, h_cm=70, material_id=3, hinge_id=4,
                   hinges_per_leaf=2, handle_id=5, banding_id=7)
    unit = UnitRow(label="زمینی", unit_type="ground", qty=2, length_cm=90,
                   height_cm=72, depth_cm=55, shelves=1, doors=[door],
                   body_id=1, back_id=2, banding_id=7, leg_id=6,
                   shelf_pin_id=9, countertop_id=10)
    return Page(name="تست", units=[unit], waste_percent=0, overhead_percent=0,
                banding_body_factor=2.0, banding_door_factor=1.0,
                banding_waste_percent=0)


# ---------------------------------------------------------------------------
def test_body_area_formula():
    """مساحت بدنه = ۲(عمق×ارتفاع) + ۲(عرض×عمق) + طبقات + فیبر"""
    eng = make_engine()
    u = UnitRow(unit_type="ground", qty=1, length_cm=100, height_cm=70,
                depth_cm=50, shelves=1, body_id=1, back_id=2)
    panels = eng.default_panels(u)
    body = sum(p.area_sqm for p in panels if p.material_key == "body")
    back = sum(p.area_sqm for p in panels if p.material_key == "back")
    t = 1.6  # ضخامت ورق بدنه بر حسب سانتی‌متر
    # یونیت زمینی سقف ندارد (صفحه رویش قرار می‌گیرد): بدنه‌ها + کف + طبقه
    expect_body = (2 * 0.5 * 0.7) + ((1.0 - 2 * t / 100) * 0.5) + (1 * (1.0 - 2 * t / 100) * 0.5)
    assert math.isclose(body, expect_body, rel_tol=1e-9)
    assert math.isclose(back, 1.0 * 0.7, rel_tol=1e-9)
    # کمد ایستاده سقف هم دارد
    u2 = UnitRow(unit_type="tall", qty=1, length_cm=100, height_cm=200,
                 depth_cm=60, shelves=3, body_id=1)
    p2 = eng.default_panels(u2)
    body2 = sum(p.area_sqm for p in p2 if p.material_key == "body")
    assert body2 > body


def test_sheet_count_rounds_up():
    eng = make_engine()
    page = make_page()
    res = eng.calc_page(page)
    # مساحت بدنه ۲ یونیت با پرت صفر باید سقف تعداد ورق بدهد
    sheet_area = (1.83 * 3.66)
    assert res.total_sheets >= math.ceil(res.total_body_area / sheet_area)


def test_banding_meters():
    eng = make_engine()
    page = make_page()
    res = eng.calc_page(page)
    # نوار بدنه = مساحت × ضریب ۲  +  نوار در = محیط × تعداد
    door_perim = 2 * (0.45 + 0.70)
    expected_door_band = door_perim * 2 * 2          # ۲ لنگه در هر یونیت × ۲ یونیت
    assert res.total_banding_m > expected_door_band - 1e-9


def test_profit_markup_and_margin():
    e = CostingEngine
    assert math.isclose(e.calc_profit(1_000_000, "markup", 30), 300_000)
    # مارجین ۳۰٪ یعنی سود ۳۰٪ از فروش → فروش = ۱/۰٫۷ ≈ ۱٫۴۲۸۵۷
    profit = e.calc_profit(1_000_000, "margin", 30)
    sell = 1_000_000 + profit
    assert math.isclose(profit / sell, 0.30, rel_tol=1e-9)


def test_installation_modes():
    eng = make_engine()
    page = make_page()
    r1 = eng.calc_project([page], install_mode="fixed", install_value=500_000)
    assert r1.installation_cost == 500_000
    r2 = eng.calc_project([page], install_mode="per_meter", install_value=100_000)
    lm = r2.stats["total_ground_lm"]
    assert math.isclose(r2.installation_cost, lm * 100_000)
    r3 = eng.calc_project([page], install_mode="percent", install_value=10)
    assert math.isclose(r3.installation_cost, r3.pages_cost * 0.10)


def test_discount_and_vat():
    eng = make_engine()
    page = make_page()
    r = eng.calc_project([page], profit_mode="markup", profit_percent=0,
                         discount_percent=10, vat_enabled=True, vat_percent=10)
    assert math.isclose(r.net_price, r.gross_price * 0.9)
    assert math.isclose(r.vat_amount, r.net_price * 0.10)
    assert math.isclose(r.final_price, r.net_price + r.vat_amount)


def test_extras_and_darna():
    eng = make_engine()
    page = make_page()
    page.extras = [ExtraRow("نور", 2, "lm", 100_000)]
    page.detail_mode = "total"
    page.detail_total_sqm = 3
    page.detail_price_per_sqm = 500_000
    r = eng.calc_page(page)
    assert math.isclose(r.extra_cost, 200_000)
    assert math.isclose(r.detail_cost, 1_500_000)
    assert math.isclose(r.total_cost, r.subtotal)


def test_services_percent_basis():
    eng = make_engine()
    page = make_page()
    page.services = [ServiceRow("حمل درصدی", "percent", 1, 5)]
    r = eng.calc_project([page])
    base = r.pages[0].subtotal - r.pages[0].service_cost
    assert math.isclose(r.pages[0].service_cost, base * 0.05, rel_tol=1e-6)


def test_multi_page_combined_project():
    eng = make_engine()
    p1, p2 = make_page(), make_page()
    p2.name = "سبک دوم"
    r = eng.calc_project([p1, p2])
    assert len(r.pages) == 2
    assert math.isclose(r.pages_cost, r.pages[0].total_cost + r.pages[1].total_cost)


def test_drawer_box_area():
    d = DrawerRow(qty=1, w_cm=80, h_cm=18, d_cm=45)
    expect = 2 * 0.45 * 0.18 + 0.80 * 0.45 + 0.80 * 0.18
    assert math.isclose(d.box_area_sqm, expect, rel_tol=1e-9)


def test_persian_tools():
    assert fa.to_en_digits("۱۲۳٫۵") == "123.5"
    assert fa.to_fa_digits("123") == "۱۲۳"
    assert fa.parse_number("۱,۲۰۰") == 1200.0
    assert fa.gregorian_to_jalali(2025, 3, 21) == (1404, 1, 1)
    assert fa.jalali_to_gregorian(1404, 1, 1) == (2025, 3, 21)
    assert fa.jalali_to_gregorian(1403, 12, 30) == (2025, 3, 20)
    assert fa.gregorian_to_jalali(*fa.jalali_to_gregorian(1404, 7, 15)) == (1404, 7, 15)
    assert "هزار" in fa.number_to_words(2000)
    assert fa.money_to_words(1_000_000, "ریال") == "یک میلیون ریال"


def test_invoice_build_modes():
    eng = make_engine()
    page = make_page()
    r = eng.calc_project([page], profit_percent=20)
    proj = {"customer_name": "تست", "code": "PR-1"}
    settings = {"currency": "ریال", "currency_scale": "1", "persian_digits": "1"}
    for mode in ("grouped", "detailed", "summary"):
        d = inv.build_invoice_data(r, proj, settings, mode=mode)
        assert d["items"] or mode == "summary"
        assert d["totals"]["final_price"] == r.final_price
    hidden = [g for g in inv.group_titles(inv.build_invoice_data(r, proj, settings))]
    d2 = inv.build_invoice_data(r, proj, settings, hidden=hidden[:1])
    assert all(it["group"] != hidden[0] for it in d2["items"])


def test_pdf_export(tmp_path):
    eng = make_engine()
    r = eng.calc_project([make_page()], profit_percent=25)
    from kabir.core import invoice_pdf
    d = inv.build_invoice_data(r, {"customer_name": "pdf تست"}, {"currency": "ریال"})
    out = invoice_pdf.build_pdf(d, tmp_path / "t.pdf")
    assert out.exists() and out.stat().st_size > 5000


def test_excel_export(tmp_path):
    pytest = __import__("pytest")
    pytest.importorskip("openpyxl")
    eng = make_engine()
    page = make_page()
    r = eng.calc_project([page])
    from kabir.core import exporters
    exporters.attach_units(r, [page])
    p = exporters.export_project_xlsx(r, {"title": "t"}, tmp_path / "t.xlsx", {})
    assert p.exists()
