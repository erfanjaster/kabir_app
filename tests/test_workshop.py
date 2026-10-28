# -*- coding: utf-8 -*-
"""تست خروجی‌های کارگاهی، پیش‌پرداخت و قیمت متری

اجرا:  pytest tests/test_workshop.py -v
یا بدون pytest:  python3 /tmp/work/minitest.py tests.test_workshop
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from kabir.core.costing import (                     # noqa: E402
    CostingEngine, DoorRow, DrawerRow, Material, Page, UnitRow,
)
from kabir.core import workshop as ws                 # noqa: E402
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


def _unit(label="زمینی", utype="ground", L=90.0, H=72.0, D=55.0, qty=2,
          shelves=1, doors=None, drawers=None) -> UnitRow:
    door = DoorRow(qty=2, w_cm=44.5, h_cm=71.7, material_id=3, hinge_id=4,
                   hinges_per_leaf=2, handle_id=5, banding_id=7)
    return UnitRow(label=label, unit_type=utype, qty=qty, length_cm=L,
                   height_cm=H, depth_cm=D, shelves=shelves,
                   doors=doors if doors is not None else [door],
                   drawers=drawers or [],
                   body_id=1, back_id=2, banding_id=7, leg_id=6,
                   shelf_pin_id=9)


def make_pages() -> list:
    return [Page(name="بخش ۱", units=[_unit()], waste_percent=0, overhead_percent=0,
                 banding_body_factor=2.0, banding_door_factor=1.0, banding_waste_percent=0)]


def make_drawer_pages() -> list:
    dw = DrawerRow(qty=3, w_cm=50.0, h_cm=16.0, d_cm=45.0, front_id=3, sheet_id=1,
                   slide_id=8, handle_id=5, banding_id=7)
    return [Page(name="بخش ۱", units=[_unit(doors=[], drawers=[dw])],
                 waste_percent=0, overhead_percent=0,
                 banding_body_factor=2.0, banding_door_factor=1.0, banding_waste_percent=0)]


def calc(pages, **kw):
    return make_engine().calc_project(pages, **kw)


# ------------------------------------------------------- «در از ورق بدنه»
def _door_page(from_body, w=44.5, h=71.7, body_id=1, door_mat=3, qty=2, leaves=2):
    """یک بخش با یک یونیت زمینی و یک ردیف در."""
    dr = DoorRow(qty=leaves, w_cm=w, h_cm=h, material_id=door_mat, hinge_id=4,
                 hinges_per_leaf=2, banding_id=7, from_body=from_body)
    u = UnitRow(label="زمینی ۹۰", unit_type="ground", qty=qty, length_cm=90,
                height_cm=72, depth_cm=55, shelves=1, doors=[dr],
                body_id=body_id, back_id=2, banding_id=7, leg_id=6, shelf_pin_id=9)
    return [Page(name="بخش ۱", units=[u], waste_percent=10, overhead_percent=0,
                 banding_body_factor=2.0, banding_door_factor=1.0, banding_waste_percent=0)]


def test_door_from_body_merges_into_body_sheet():
    """با تیکِ «در از ورق بدنه»، ردیفِ «ورق در» باید ناپدید شود"""
    r_off = calc(_door_page(False), profit_percent=30)
    r_on = calc(_door_page(True), profit_percent=30)
    assert any(i.key == "door_sheet" for i in r_off.items), "حالت خاموش باید ورق در داشته باشد"
    assert not any(i.key == "door_sheet" for i in r_on.items), "با تیک، ورقِ جدا نباید بماند"
    assert any(i.key == "body_sheet" for i in r_on.items)


def test_door_from_body_is_cheaper():
    """مساحت در با بدنه یک‌جا گرد می‌شود → ورق کم‌تر → قیمت کم‌تر"""
    r_off = calc(_door_page(False), profit_percent=30)
    r_on = calc(_door_page(True), profit_percent=30)
    assert r_on.total_cost < r_off.total_cost, "در از ورق بدنه باید ارزان‌تر باشد"
    assert r_on.final_price < r_off.final_price


def test_door_from_body_area_is_conserved():
    """مساحت در نباید گم شود؛ فقط دسته‌اش عوض می‌شود"""
    r_off = calc(_door_page(False), profit_percent=30)
    r_on = calc(_door_page(True), profit_percent=30)
    off_area = sum(i.area_sqm for i in r_off.items if i.key in ("body_sheet", "door_sheet"))
    on_area = sum(i.area_sqm for i in r_on.items if i.key in ("body_sheet", "door_sheet"))
    assert abs(off_area - on_area) < 1e-6
    assert abs(r_off.stats["total_door_area"] - r_on.stats["total_door_area"]) < 1e-9


def test_door_from_body_batches_with_body():
    """ورق‌های بدنه و درِ هم‌جنس، یک‌جا گرد می‌شوند"""
    pages = _door_page(True)
    r = calc(pages, profit_percent=30)
    body = [i for i in r.items if i.key == "body_sheet"]
    gross = sum(i.area_sqm for i in body)
    expect = math.ceil(gross / (1.83 * 3.66) - 1e-9)
    assert abs(sum(i.sheets for i in body) - expect) < 1e-6
    assert expect < len(body), "باید تجمیع شده باشد نه گردکردنِ هر ردیف"


def test_door_from_body_infeasible_falls_back_with_warning():
    """لنگه‌ی بزرگ‌تر از ورق → تیک نادیده گرفته می‌شود + هشدار"""
    r = calc(_door_page(True, w=200, h=250), profit_percent=30)
    assert any(i.key == "door_sheet" for i in r.items), "باید به ورقِ در برگردد"
    assert r.warnings and "جا نمی‌شود" in r.warnings[0]


def test_door_from_body_without_body_material_warns():
    """بدون ورق بدنه، تیک معنا ندارد → هشدار"""
    r = calc(_door_page(True, body_id=0), profit_percent=30)
    assert r.warnings and "ورق بدنه" in r.warnings[0]
    assert any(i.key == "door_sheet" for i in r.items)


def test_no_warning_when_flag_off():
    """بدون تیک، هیچ هشداری نباید تولید شود"""
    assert calc(_door_page(False)).warnings == []


def test_door_from_body_flag_survives_serialisation():
    """تیک باید در ذخیره/بازیابیِ پروژه حفظ شود"""
    dr = DoorRow(from_body=True)
    assert dr.to_dict()["from_body"] is True
    assert DoorRow.from_dict({"from_body": True}).from_body is True
    # داده‌ی قدیمیِ بدون این فیلد هم باید کار کند (پیش‌فرض False)
    assert DoorRow.from_dict({"qty": 2, "w_cm": 45}).from_body is False


def test_door_from_body_in_cut_list():
    """برش‌نامه هم لنگه را با ورق بدنه نشان می‌دهد، نه ورق در"""
    eng = make_engine()
    on = ws.build_cut_list(eng, _door_page(True))
    off = ws.build_cut_list(eng, _door_page(False))
    leaves_on = [p for p in on if "(لنگه)" in p.part]
    leaves_off = [p for p in off if "(لنگه)" in p.part]
    assert leaves_on and leaves_off
    assert all(p.mat_cat == "body_sheet" for p in leaves_on)
    assert all(p.material == "ورق بدنه" for p in leaves_on)
    assert all("از ورق بدنه" in p.part for p in leaves_on)
    assert all(p.mat_cat == "door_sheet" for p in leaves_off)


def test_door_from_body_sheet_summary_merges():
    """در خلاصه‌ی ورق، لنگه‌ها با بدنه جمع می‌شوند (یک ردیف، نه دو تا)"""
    eng = make_engine()
    pages = _door_page(True)
    pack = ws.build_workshop_pack(eng, pages, calc(pages))
    cats = {r["cat"] for r in pack["sheet_summary"]}
    assert "body_sheet" in cats
    assert "door_sheet" not in cats
    # مساحت بدنه در خلاصه = بدنه + لنگه‌ها
    body_row = next(r for r in pack["sheet_summary"] if r["cat"] == "body_sheet")
    cut_area = sum(p["area_sqm"] for p in pack["cut_parts"]
                   if p["mat_cat"] == "body_sheet")
    assert abs(body_row["area_sqm"] - cut_area) < 1e-3


# --------------------------------------------------------------------------- برش‌نامه
def test_cut_list_has_every_panel():
    """هر پنل بدنه/در/فیبر باید در برش‌نامه باشد"""
    parts = ws.build_cut_list(make_engine(), make_pages())
    assert parts, "برش‌نامه خالی است"
    labels = {p.part for p in parts}
    assert any("بدنه کناری" in s for s in labels)
    assert any("فیبر پشت" in s for s in labels)
    assert any("(لنگه)" in s for s in labels)


def test_cut_list_length_ge_width():
    """قرارداد دستگاه برش: طول همیشه ≥ عرض"""
    for p in ws.build_cut_list(make_engine(), make_pages()):
        assert p.length_mm >= p.width_mm


def test_cut_list_uses_millimetres():
    """ابعاد برش‌نامه میلی‌متری است (۱۰× سانتی‌متر)"""
    parts = ws.build_cut_list(make_engine(), make_pages())
    assert any(p.length_mm == 2200 or p.length_mm == 720 for p in parts)


def test_cut_list_qty_multiplies_unit_qty():
    """تعداد قطعه = تعداد پنل × تعداد یونیت (این‌جا ۲ پنل × ۲ یونیت)"""
    parts = ws.build_cut_list(make_engine(), make_pages())
    side = [p for p in parts if "بدنه کناری" in p.part]
    assert side and all(p.qty == 4 for p in side)


def test_fibre_back_needs_no_banding():
    """فیبر پشت نوار نمی‌خورد — دستگاه نوارچسبان بیهوده کار نکند"""
    parts = ws.build_cut_list(make_engine(), make_pages())
    backs = [p for p in parts if p.part == "فیبر پشت"]
    assert backs and all(not p.banding for p in backs)


def test_drawer_parts_appear():
    """قطعات کشو (نما + جعبه) در برش‌نامه هست"""
    parts = ws.build_cut_list(make_engine(), make_drawer_pages())
    labels = " ".join(p.part for p in parts)
    assert "تیره‌ی کشو" in labels and "کف کشو" in labels
    assert "بغل کشو" in labels and "پشت کشو" in labels


# --------------------------------------------------------------------------- خلاصه ورق
def test_sheet_summary_one_row_per_material():
    """برای هر متریال یک ردیف خلاصه"""
    eng = make_engine()
    pages = make_pages()
    pack = ws.build_workshop_pack(eng, pages, calc(pages))
    mats = {s["material"] for s in pack["sheet_summary"]}
    assert "ورق بدنه" in mats and "ورق در" in mats
    assert len(mats) == len(pack["sheet_summary"])


def test_sheet_summary_sheets_are_whole():
    """تعداد ورق عدد صحیح است — نصف ورق نمی‌خریم"""
    pages = make_pages()
    pack = ws.build_workshop_pack(make_engine(), pages, calc(pages))
    for s in pack["sheet_summary"]:
        assert s["sheets"] == math.ceil(s["sheets"] - 1e-9)
        assert s["sheets"] >= 1


def test_sheet_summary_respects_settings():
    """ابعاد ورقِ تنظیمات برای متریال‌های بی‌قیمت هم رعایت می‌شود"""
    pages = make_pages()
    pages[0].units[0].body_id = 999          # متریال ناشناخته → ابعاد از تنظیمات
    res = calc(pages)
    eng = make_engine()
    big = ws.summarize_sheets(ws.build_cut_list(eng, pages), eng, {})
    small = ws.summarize_sheets(ws.build_cut_list(eng, pages), eng,
                                {"sheet_width_cm": "122", "sheet_height_cm": "244"})
    row_b = next(r for r in big if r["cat"] == "body_sheet")
    row_s = next(r for r in small if r["cat"] == "body_sheet")
    assert row_b["sheet_size"] == "183×366"
    assert row_s["sheet_size"] == "122×244"
    assert row_s["sheets"] >= row_b["sheets"]


# --------------------------------------------------------------------------- لیست خرید
def test_shopping_groups_are_complete():
    """جمع گروه‌ها = جمع ردیف‌ها؛ هیچ قلمی گم نشده"""
    pages = make_pages()
    pack = ws.build_workshop_pack(make_engine(), pages, calc(pages))
    lines = sum(l["amount"] for l in pack["shopping"])
    groups = sum(g["total"] for g in pack["shopping_groups"])
    assert abs(lines - groups) < 1.0
    assert abs(lines - pack["stats"]["shopping_total"]) < 1.0


def test_shopping_excludes_non_purchasables():
    """نصب/حمل/مالیات خریدنی نیستند و نباید در لیست خرید بیایند"""
    pages = make_pages()
    res = calc(pages, install_mode="per_meter", install_value=850_000,
               extra_fixed_amount=500_000)
    pack = ws.build_workshop_pack(make_engine(), pages, res)
    names = " ".join(l["name"] for l in pack["shopping"])
    assert "نصب" not in names and "مبلغ ثابت" not in names


def test_shopping_sheets_counted_as_sheets():
    """ورق در لیست خرید با واحد «ورق» و تعداد صحیح می‌آید"""
    pages = make_pages()
    pack = ws.build_workshop_pack(make_engine(), pages, calc(pages))
    sheet_lines = [l for l in pack["shopping"] if l["group"] == "sheet"]
    assert sheet_lines
    for l in sheet_lines:
        assert l["unit_label"] == "ورق"
        assert abs(l["qty"] - round(l["qty"])) < 1e-9


def test_shopping_banding_in_metres():
    """نوار با واحد متر طول می‌آید و بیشتر از صفر است"""
    pages = make_pages()
    pack = ws.build_workshop_pack(make_engine(), pages, calc(pages))
    band = [l for l in pack["shopping"] if l["group"] == "banding"]
    assert band and all(l["unit_label"] == "متر" and l["qty"] > 0 for l in band)


# --------------------------------------------------------------------------- آمار بسته
def test_pack_stats_are_consistent():
    """آمار سرجمع با محتوای بسته یکی است"""
    pages = make_pages()
    pack = ws.build_workshop_pack(make_engine(), pages, calc(pages))
    st = pack["stats"]
    assert st["part_kinds"] == len(pack["cut_parts"])
    assert st["total_pieces"] == sum(p["qty"] for p in pack["cut_parts"])
    assert st["total_sheets"] == sum(s["sheets"] for s in pack["sheet_summary"])
    assert st["banding_pieces"] <= st["total_pieces"]
    assert st["banding_perimeter_m"] > 0


def test_pack_area_matches_engine_area():
    """مساحت برش‌نامه ≈ مساحتی که موتور محاسبه کرده (دو موتور یکی‌اند)"""
    pages = make_pages()
    eng = make_engine()
    res = calc(pages)
    pack = ws.build_workshop_pack(eng, pages, res)
    engine_area = (res.stats["total_body_area"] + res.stats["total_door_area"]
                   + res.stats["total_back_area"])
    assert abs(pack["stats"]["total_area_sqm"] - engine_area) <= 3.0


# --------------------------------------------------------------------------- تجمیع ورق
def test_sheets_batched_once_per_material():
    """ورق‌های هم‌جنس یک‌بار گرد می‌شوند، نه برای هر یونیت جدا"""
    pages = [Page(name="P", units=[
        _unit(label="زمینی ۹۰", L=90),
        _unit(label="زمینی ۶۰", L=60, qty=3, shelves=0),
    ], waste_percent=0, overhead_percent=0,
        banding_body_factor=2.0, banding_door_factor=1.0, banding_waste_percent=0)]
    res = calc(pages)
    body = [i for i in res.items if i.key == "body_sheet"]
    area = sum(i.area_sqm for i in body)
    expect = math.ceil(area / (1.83 * 3.66) - 1e-9)
    assert abs(sum(i.sheets for i in body) - expect) < 1e-6
    # هر ردیف qty بر حسب مترمربع دارد و amount = qty × قیمت ورق
    for i in body:
        assert i.unit_label == "م²"
        assert abs(i.amount - i.qty * i.unit_price) < 1.0


def test_countertop_not_double_counted():
    """با ورود «متر طول صفحه»، برای هر یونیت جدا صفحه حساب نمی‌شود"""
    pages = make_pages()
    pages[0].units[0].countertop_id = 10
    pages[0].countertop_lm = 4.2
    res = calc(pages)
    tops = [i for i in res.items if i.key == "countertop"]
    assert len(tops) == 1
    assert abs(tops[0].qty - 4.2) < 0.01


# --------------------------------------------------------------------------- پیش‌پرداخت
def test_deposit_by_percent():
    pages = make_pages()
    res = calc(pages, profit_percent=30, deposit_percent=40)
    assert abs(res.deposit_amount - res.final_price * 0.4) < 1.0
    assert abs(res.remaining_amount - (res.final_price - res.deposit_amount)) < 1.0


def test_deposit_by_amount():
    pages = make_pages()
    res = calc(pages, profit_percent=30, deposit_amount=5_000_000)
    assert abs(res.deposit_amount - 5_000_000) < 1.0
    assert res.deposit_amount <= res.final_price


def test_deposit_capped_at_final_price():
    """پیش‌پرداخت هرگز از کل مبلغ بیشتر نمی‌شود (باقی‌مانده منفی ممنوع)"""
    pages = make_pages()
    res = calc(pages, profit_percent=30, deposit_percent=250)
    assert res.deposit_amount <= res.final_price + 1e-6
    assert res.remaining_amount >= -1e-6


def test_no_deposit_means_full_remaining():
    pages = make_pages()
    res = calc(pages, profit_percent=30)
    assert res.deposit_amount == 0
    assert abs(res.remaining_amount - res.final_price) < 1.0


# --------------------------------------------------------------------------- قیمت متری
def test_price_per_metre_fields():
    pages = make_pages()
    res = calc(pages, profit_percent=30)
    glm = res.stats["total_ground_lm"]
    assert glm > 0
    assert abs(res.price_per_ground_lm - res.final_price / glm) < 1.0
    tlm = glm + res.stats["total_wall_lm"]
    assert abs(res.price_per_total_lm - res.final_price / tlm) < 1.0
    assert res.cost_per_ground_lm < res.price_per_ground_lm


def test_price_per_metre_survives_zero_length():
    """پروژه‌ی بدون متراژ نباید تقسیم بر صفر بخورد"""
    pages = [Page(name="خالی", units=[], waste_percent=0, overhead_percent=0)]
    res = calc(pages, profit_percent=30)
    assert res.price_per_ground_lm == 0
    assert res.price_per_total_lm == 0


# --------------------------------------------------------------------------- فاکتور
def test_invoice_shows_deposit_and_remaining():
    """ردیف‌های پیش‌پرداخت/باقی‌مانده در جمع فاکتور دیده می‌شوند"""
    pages = make_pages()
    res = calc(pages, profit_percent=30, deposit_percent=40)
    payload = inv.build_invoice_data(res, {"customer_name": "تست"}, {"currency": "ریال"})
    html = inv.render_html(payload)
    assert "پیش‌پرداخت" in html and "باقی‌مانده" in html
    assert abs(payload["totals"]["deposit_amount"] - res.deposit_amount) < 1.0
    assert abs(payload["totals"]["remaining_amount"] - res.remaining_amount) < 1.0


def test_invoice_stats_show_price_per_metre():
    pages = make_pages()
    res = calc(pages, profit_percent=30)
    payload = inv.build_invoice_data(res, {"customer_name": "تست"}, {"currency": "ریال"})
    tot = payload["totals"]
    assert tot["price_per_ground_lm"] > 0
    assert tot["price_per_total_lm"] > 0
    assert tot["stats"]["total_ground_lm"] > 0


# ---------------------------------------------------------------------------
# ★ شورای منتقد ۲٫۴ — «در از ورق بدنه» و خلاصه‌ی ورق
# ---------------------------------------------------------------------------

GRAINY = Material(11, "ام‌دی‌اف طرح چوب راش ۱۶ میل", "body_sheet", "sheet",
                  6_300_000, 183, 366, 16)


def _engine_with_grain() -> CostingEngine:
    return CostingEngine(MATS + [GRAINY], {})


def _same_material_page(from_body):
    """در و بدنه از «یک» متریال (سناریوی پرتکرارِ کابینتِ یک‌رنگ)."""
    return _door_page(from_body, door_mat=1)


def test_sheet_summary_no_double_count_same_material():
    """🔴 بازگشتی: جنسِ در == ورقِ بدنه → خلاصه نباید دو برابرِ فاکتور ورق بگوید.

    پیش‌تر ردیف‌های (نام، دسته) جدا بودند و «ورقِ فاکتورشده» به هر دو ردیفِ
    هم‌نام تزریق می‌شد: فاکتور ۱ ورق، خلاصه ۲ ورق!
    """
    eng = make_engine()
    pages = _same_material_page(False)
    res = calc(pages, profit_percent=0)
    pack = ws.build_workshop_pack(eng, pages, res)
    body_rows = [r for r in pack["sheet_summary"] if r["material"] == "ورق بدنه"]
    assert len(body_rows) == 1, "یک متریال باید دقیقاً یک ردیفِ خرید داشته باشد"
    invoiced = res.stats["total_sheets"]
    assert abs(sum(r["sheets"] for r in pack["sheet_summary"]) - invoiced) < 1e-6, \
        "جمعِ ورقِ خلاصه باید با ورقِ فاکتور یکی باشد"
    sheet_cost = sum(r["cost"] for r in pack["sheet_summary"])
    invoiced_cost = sum(i.amount for i in res.items
                        if i.key in CostingEngine.SHEET_ITEM_KEYS)
    assert abs(sheet_cost - invoiced_cost) < 1.0, \
        "بهای ورق در خلاصه باید با فاکتور یکی باشد"


def test_sheet_summary_total_matches_invoice_mixed():
    """در پروژه‌ی ترکیبی (چند متریال)، جمعِ ورق و بهای خلاصه == فاکتور."""
    eng = make_engine()
    pages = make_pages()
    res = calc(pages, profit_percent=0)
    pack = ws.build_workshop_pack(eng, pages, res)
    assert abs(pack["stats"]["total_sheets"] - res.stats["total_sheets"]) < 0.01
    invoiced_cost = sum(i.amount for i in res.items
                        if i.key in CostingEngine.SHEET_ITEM_KEYS)
    assert abs(sum(r["cost"] for r in pack["sheet_summary"]) - invoiced_cost) < 1.0


def test_same_material_row_has_combined_label():
    """ردیفِ ادغام‌شده برچسب ترکیبی «بدنه + در» می‌گیرد تا کاربر بداند
    چه قطعاتی از این ورق برش می‌خورند."""
    eng = make_engine()
    pages = _same_material_page(False)
    pack = ws.build_workshop_pack(eng, pages, calc(pages))
    row = next(r for r in pack["sheet_summary"] if r["material"] == "ورق بدنه")
    assert "بدنه" in row["cats_label"] and "در" in row["cats_label"]


def test_from_body_on_same_material_keeps_invoice_identical():
    """با جنسِ یکسان، تیک قیمت را عوض نمی‌کند (ورق‌ها از قبل هم‌گروه‌اند) —
    فقط ردیف‌ها تمیزتر می‌شوند. راهنمای رابط هم باید همین راستش را بگوید."""
    off = calc(_same_material_page(False), profit_percent=30)
    on = calc(_same_material_page(True), profit_percent=30)
    assert abs(off.total_cost - on.total_cost) < 1.0
    assert abs(off.final_price - on.final_price) < 1.0
    assert not any(i.key == "door_sheet" for i in on.items)


def test_grain_sheet_forbids_rotation():
    """🔴 بازگشتی: ورقِ طرح‌دار را نمی‌شود چرخاند — لنگه فقط بدونِ چرخش جا
    می‌شود، وگرنه نقشِ در کج می‌افتد. پیش‌تر چرخش برای همه مجاز بود."""
    from kabir.core.costing import door_leaf_fits_sheet, material_has_grain
    assert material_has_grain(GRAINY)
    assert not material_has_grain(MATS[0])
    dr_rot = DoorRow(qty=1, w_cm=200, h_cm=100, material_id=11)  # فقط با چرخش جا می‌شود
    ok, why = door_leaf_fits_sheet(dr_rot, GRAINY)
    assert not ok and "راستای طرح" in why
    ok2, _ = door_leaf_fits_sheet(dr_rot, MATS[0])   # ورق بدون طرح: چرخش مجاز
    assert ok2
    dr_straight = DoorRow(qty=1, w_cm=100, h_cm=200, material_id=11)
    assert door_leaf_fits_sheet(dr_straight, GRAINY)[0]


def test_grain_from_body_ignored_with_warning():
    """تیکِ «در از ورق بدنه» روی ورقِ طرح‌دارِ ناسازگار → نادیده + هشدارِ
    دلیل‌دار (چرخاندن، طرح را خراب می‌کند)."""
    dr = DoorRow(qty=1, w_cm=200, h_cm=100, material_id=3, from_body=True)
    u = UnitRow(label="زمینی", unit_type="ground", qty=1, length_cm=210,
                height_cm=110, depth_cm=55, doors=[dr], body_id=11)
    pages = [Page(name="بخش ۱", units=[u], waste_percent=10, overhead_percent=0,
                  banding_body_factor=2.0, banding_waste_percent=0)]
    r = _engine_with_grain().calc_project(pages)
    assert any("راستای طرح" in w for w in r.warnings)
    assert any(i.key == "door_sheet" for i in r.items), "باید به ورقِ در برگردد"
