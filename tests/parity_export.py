# -*- coding: utf-8 -*-
"""مقایسه‌ی موتور JS (engine.js) با موتور پایتون (kabir.core.costing) روی یک پروژه‌ی یکسان.

خروجی: /tmp/parity-py.json (نتیجه‌ی پایتون) و /tmp/parity-project.json (ورودی مشترک)
سپس با node همین پروژه را به engine.js می‌دهیم و اعداد را مقایسه می‌کنیم.
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("KABIR_DATA_DIR", str(ROOT / ".parity-data"))
os.makedirs(os.environ["KABIR_DATA_DIR"], exist_ok=True)

from kabir.core import costing                      # noqa: E402
from kabir.data import dao                           # noqa: E402
from kabir.data.dao import MaterialRepo              # noqa: E402
from kabir.data.db import Database                   # noqa: E402

db = Database.instance()
dao.bootstrap(db)
mats = MaterialRepo(db).all()
mid = {m.name: m.id for m in mats}

page = costing.Page(
    name="بخش ۱", style_id=0, style_name="",
    waste_percent=8, overhead_percent=5,
    banding_body_factor=2.2, banding_door_factor=1.0, banding_waste_percent=8,
    countertop_lm=4.5,
    detail_mode="detailed",
    detail_rows=[costing.DetailRow(label="زیرچراغ", qty=3, w_cm=10, h_cm=100, price_per_sqm=2450000)],
    units=[
        costing.UnitRow(
            label="زمینی ۹۰", unit_type="ground", qty=2, length_cm=90, height_cm=72,
            depth_cm=55, shelves=1,
            body_id=mid["ام‌دی‌اف سفید برفی ۱۶ میل"],
            back_id=mid["فیبر (MDF 3 میل) پشت سفید"],
            banding_id=mid["نوار ABS هایگلاس"],
            leg_id=mid["پایه فلزی تنظیم‌دار ۱۵ سانت"],
            shelf_pin_id=mid["خار طبقه فلزی"],
            assembly_id=mid["سوراخ‌کاری و مونتاژ (هر یونیت)"],
            countertop_id=mid["صفحه ۵ سانت ترک (ضدخش)"],
            kickboard_id=mid["پاخور آلومینیومی"],
            doors=[costing.DoorRow(
                label="در", qty=2, w_cm=44, h_cm=70,
                material_id=mid["هایگلاس ترک سفید ۱۶ میل"],
                door_model_id=mid["اجرت ساخت در هایگلاس (هر لنگه)"],
                hinge_id=mid["لولا آرام‌بند آلمانی (Blum)"],
                handle_id=mid["دستگیره مخفی (پروفیلی)"],
                banding_id=mid["نوار ABS هایگلاس"],
                assembly_id=mid["مونتاژ و رگلاژ در (هر لنگه)"],
                packaging_id=mid["بسته‌بندی هر لنگه در"])],
            drawers=[costing.DrawerRow(
                label="کشو", qty=3, w_cm=56, h_cm=18, d_cm=45,
                slide_id=mid["ریل تاندم آرام‌بند (جفت)"],
                sheet_id=mid["ام‌دی‌اف سفید ۱۶ میل (جعبه کشو)"],
                handle_id=mid["دستگیره مخفی (پروفیلی)"],
                front_id=mid["هایگلاس ترک سفید ۱۶ میل"],
                banding_id=mid["نوار ABS هایگلاس"])]),
        costing.UnitRow(
            label="دیواری ۶۰", unit_type="wall", qty=3, length_cm=60, height_cm=70,
            depth_cm=30, shelves=1,
            body_id=mid["ام‌دی‌اف سفید برفی ۱۶ میل"],
            back_id=mid["فیبر (MDF 3 میل) پشت سفید"],
            banding_id=mid["نوار ABS هایگلاس"],
            underlight_id=mid["زیرچراغ با جای SMD"],
            assembly_id=mid["سوراخ‌کاری و مونتاژ (هر یونیت)"],
            doors=[costing.DoorRow(
                label="در", qty=1, w_cm=59, h_cm=69,
                material_id=mid["هایگلاس ترک سفید ۱۶ میل"],
                hinge_id=mid["لولا آرام‌بند آلمانی (Blum)"],
                handle_id=mid["دستگیره مخفی (پروفیلی)"],
                banding_id=mid["نوار ABS هایگلاس"])]),
    ],
    extras=[costing.ExtraRow(label="سطل زباله ریلی دو مخزن", qty=1, unit="piece", price=1980000)],
    services=[costing.ServiceRow(label="حمل تا محل (سرویس)", basis="fixed", qty=1, price=850000),
              costing.ServiceRow(label="نصب درصدی", basis="percent", qty=1, price=2)],
)

# بخش دوم: همان یونیت‌ها ولی با تیکِ «در از ورق بدنه» — تا مسیرِ تجمیعِ لنگه
# با ورقِ بدنه هم در هر دو موتور سنجیده شود.
page2 = costing.Page.from_dict(page.to_dict())
page2.name = "بخش ۲ (در از ورق بدنه)"
for u in page2.units:
    for d in u.doors:
        d.from_body = True

engine = costing.CostingEngine(mats, db.all_settings())
py = engine.calc_project(
    [page, page2], install_mode="per_meter", install_value=350000,
    profit_mode="markup", profit_percent=25,
    discount_percent=3, discount_amount=0,
    vat_enabled=True, vat_percent=10, extra_fixed_amount=500000)

# --- ورودی مشترک برای سمت JS ---
materials_for_js = [{
    "id": m.id, "name": m.name, "cat": m.category, "unit": m.unit, "price": m.price,
    "sheet_width_cm": m.sheet_width_cm, "sheet_height_cm": m.sheet_height_cm,
    "thickness_mm": m.thickness_mm, "width_cm": m.width_cm, "active": True,
} for m in mats]

payload = {
    "materials": materials_for_js,
    "settings": {"banding_body_factor": "2.2", "banding_door_factor": "1",
                 "banding_waste_percent": "8"},
    "project": {"install_mode": "per_meter", "install_value": 350000,
                "profit_mode": "markup", "profit_percent": 25,
                "discount_percent": 3, "discount_amount": 0,
                "vat_enabled": True, "vat_percent": 10, "extra_fixed_amount": 500000},
    "pages": [json.loads(json.dumps(pg.to_dict(), default=str)) for pg in (page, page2)],
}
Path("/tmp/parity-project.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

groups = {k: round(v, 2) for k, v in engine.summarize(py).items()}
py_out = {
    "total_cost": round(py.total_cost, 2), "gross_price": round(py.gross_price, 2),
    "discount_amount": round(py.discount_amount, 2), "vat_amount": round(py.vat_amount, 2),
    "final_price": round(py.final_price, 2), "installation_cost": round(py.installation_cost, 2),
    "pages_cost": round(py.pages_cost, 2), "profit_amount": round(py.profit_amount, 2),
    "stats": {k: round(float(v), 3) for k, v in py.stats.items()},
    "groups": groups,
}
Path("/tmp/parity-py.json").write_text(json.dumps(py_out, ensure_ascii=False, indent=1), encoding="utf-8")
print("python  final:", f"{py_out['final_price']:,.0f}",
      "| total_cost:", f"{py_out['total_cost']:,.0f}",
      "| install:", f"{py_out['installation_cost']:,.0f}",
      "| items:", len(py.items))
