# -*- coding: utf-8 -*-
"""بازتولید مشکلات منطقی گزارش‌شده توسط شورای منتقد — قبل از اصلاح."""
import sys, math
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from kabir.core.costing import (CostingEngine, Material, Page, UnitRow, DoorRow,
                                DrawerRow, ServiceRow)

MATS = [
    Material(1, "ورق بدنه", "body_sheet", "sheet", 4_800_000, 183, 366, 16),
    Material(2, "فیبر پشت", "back_sheet", "sheet", 1_600_000, 122, 244, 3),
    Material(3, "ورق در", "door_sheet", "sheet", 9_000_000, 183, 366, 16),
    Material(4, "لولا", "hinge", "piece", 100_000),
    Material(7, "نوار", "banding", "lm", 20_000),
]

def base_page(services=(), **kw):
    door = DoorRow(qty=2, w_cm=45, h_cm=70, material_id=3, hinge_id=4, banding_id=7)
    unit = UnitRow(label="زمینی", unit_type="ground", qty=1, length_cm=90,
                   height_cm=72, depth_cm=55, shelves=1, doors=[door],
                   body_id=1, back_id=2, banding_id=7)
    defaults = dict(waste_percent=10, overhead_percent=0,
                    banding_body_factor=2.2, banding_waste_percent=8)
    defaults.update(kw)
    return Page(name="تست", units=[unit], services=list(services), **defaults)

print("=" * 72)
print("باگ ۱: خدمات غیردرصدی دوبار در جمع بخش شمرده می‌شود")
eng = CostingEngine(MATS, {})
p0 = base_page()
r0 = eng.calc_page(p0)
p1 = base_page(services=[ServiceRow("حمل و نصب", "fixed", 1, 5_000_000)])
r1 = eng.calc_page(p1)
delta = r1.subtotal - r0.subtotal
print(f"  جمع بدون خدمت: {r0.subtotal:,.0f}")
print(f"  جمع با خدمت ۵٬۰۰۰٬۰۰۰ ثابت: {r1.subtotal:,.0f}")
print(f"  اختلاف: {delta:,.0f}  (انتظار: ۵٬۰۰۰٬۰۰۰ — اگر دوبار شمرده شود: ۱۰٬۰۰۰٬۰۰۰)")
print(f"  labor_cost={r1.labor_cost:,.0f}  service_cost={r1.service_cost:,.0f}")
bug1 = math.isclose(delta, 10_000_000)
print(f"  → دوباره‌شماری تأیید شد؟ {bug1}")

print("=" * 72)
print("باگ ۲: مبنای «مترمربع» (sqm) برای خدمات همیشه صفر است")
eng = CostingEngine(MATS, {})
p2 = base_page(services=[ServiceRow("اجرت ساخت متری", "sqm", 1, 900_000)])
r2 = eng.calc_project([p2])
svc_items = [i for i in r2.items if i.key == "service"]
for i in svc_items:
    print(f"  qty={i.qty} × unit_price={i.unit_price:,.0f} → amount={i.amount:,.0f}")
print(f"  مساحت کل پروژه (body+door+back): "
      f"{r2.stats['total_body_area'] + r2.stats['total_door_area'] + r2.stats['total_back_area']:.3f} م²")
bug2 = all(i.amount == 0 for i in svc_items)
print(f"  → مبلغ خدمت مترمربعی صفر شد؟ {bug2}")

print("=" * 72)
print("باگ ۳: یونیت با تعداد ۰ (یا منفی) به‌جای حذف، یک عدد حساب می‌شود")
eng = CostingEngine(MATS, {})
door = DoorRow(qty=2, w_cm=45, h_cm=70, material_id=3, hinge_id=4)
u0 = UnitRow(unit_type="ground", qty=0, length_cm=90, height_cm=72, depth_cm=55,
             body_id=1, back_id=2, doors=[door])
r3 = eng.calc_project([Page(name="q0", units=[u0], waste_percent=10)])
print(f"  qty=0 → total_cost={r3.total_cost:,.0f} (انتظار: ۰)")
u_neg = UnitRow(unit_type="ground", qty=-3, length_cm=90, height_cm=72, depth_cm=55,
                body_id=1, back_id=2, doors=[door])
r3n = eng.calc_project([Page(name="qneg", units=[u_neg], waste_percent=10)])
print(f"  qty=-3 → total_cost={r3n.total_cost:,.0f} (انتظار: ۰ یا خطا)")
bug3 = r3.total_cost > 0 or r3n.total_cost > 0
print(f"  → یونیت صفر/منفی قیمت خورد؟ {bug3}")

print("=" * 72)
print("باگ ۴: ضریب نوار در (banding_door_factor) در محاسبه اثر ندارد")
eng = CostingEngine(MATS, {})
pa = base_page(banding_door_factor=1.0)
pb = base_page(banding_door_factor=3.0)
ra, rb = eng.calc_page(pa), eng.calc_page(pb)
print(f"  نوار با ضریب ۱: {ra.total_banding_m:.3f} م — با ضریب ۳: {rb.total_banding_m:.3f} م")
ia = next(i.amount for i in ra.items if i.key == "banding_door")
ib = next(i.amount for i in rb.items if i.key == "banding_door")
print(f"  مبلغ نوار در: ضریب ۱ → {ia:,.0f} | ضریب ۳ → {ib:,.0f}")
bug4 = math.isclose(ia, ib)
print(f"  → ضریب نادیده گرفته شد (دو مبلغ یکسان)؟ {bug4}")

print("=" * 72)
print("باگ ۵: متریال حذف‌شده → هزینه‌ی ورق بدنه بی‌صدا صفر می‌شود")
eng_missing = CostingEngine([m for m in MATS if m.id != 1], {})  # ورق بدنه حذف شده
r5 = eng_missing.calc_project([base_page()])
body_items = [i for i in r5.items if i.key == "body_sheet"]
print(f"  ردیف‌های ورق بدنه وقتی متریال وجود ندارد: {len(body_items)} (بدنه ~۴ م² رایگان شد!)")
bug5 = len(body_items) == 0 and not r5.warnings
print(f"  → بدون هیچ هشداری حذف شد؟ {bug5}")

print("=" * 72)
print("باگ ۶: مارجین ≥ ۱۰۰٪ بی‌صدا سود صفر می‌دهد؛ درصدهای منفی هم پذیرفته می‌شوند")
print(f"  calc_profit(1e6, 'margin', 100) = {CostingEngine.calc_profit(1e6, 'margin', 100):,.0f}")
print(f"  calc_profit(1e6, 'margin', 140) = {CostingEngine.calc_profit(1e6, 'margin', 140):,.0f}")
r6 = eng.calc_project([base_page()], profit_mode="margin", profit_percent=100,
                      discount_percent=-20)
print(f"  مارجین ۱۰۰٪ + تخفیف −۲۰٪ → final={r6.final_price:,.0f}, gross={r6.gross_price:,.0f}")
bug6 = r6.final_price > r6.gross_price
print(f"  → تخفیف منفی قیمت را از ناخالص بالاتر برد؟ {bug6}")

print("=" * 72)
print("باگ ۷: برچسب «با پرت ٪۱۰» روی ردیفی که مبلغش بدون پرت است (قبل از batch)")
u = base_page().units[0]
res7 = eng.calc_unit(u, base_page())
it = next(i for i in res7.items if i.key == "body_sheet")
print(f"  detail=«{it.detail}»  qty={it.qty:.3f} unit_price={it.unit_price:,.0f} amount={it.amount:,.0f}")
print(f"  amount بر مبنای خالص است ولی detail ادعای پرت دارد؛ بعد از batch_sheets درست می‌شود")
print(f"  ولی UnitResult.cost (={res7.cost:,.0f}) هرگز با amounts نهایی همگام نمی‌شود")

print("=" * 72)
print("جمع‌بندی:", "باگ‌ها تأیید شدند" if all([bug1, bug2, bug3, bug4, bug5, bug6]) else "برخی تأیید نشدند!")
