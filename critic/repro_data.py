# -*- coding: utf-8 -*-
"""بازتولید مشکلات لایه‌ی داده و سرور — قبل از اصلاح."""
import os, sys, json, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["KABIR_DATA_DIR"] = tempfile.mkdtemp(prefix="kabir-critic-")

from kabir.data.db import Database
from kabir.data import dao
from kabir.data.dao import InvoiceRepo, ProjectRepo, MaterialRepo
from kabir.core import invoice as inv
from kabir.core.costing import ProjectResult

db = Database.instance()
dao.bootstrap(db)

print("=" * 72)
print("باگ ۸: شماره‌ی فاکتور/کد پروژه بعد از حذف، تکراری می‌شود (COUNT+1)")
inv_repo, proj_repo = InvoiceRepo(db), ProjectRepo(db)
p1 = proj_repo.create({"title": "پروژه ۱"})
p2 = proj_repo.create({"title": "پروژه ۲"})
n1 = inv_repo.next_number("quote"); inv_repo.save(p1, n1, {"customer": {"name": "علی"}}, 100)
n2 = inv_repo.next_number("quote"); inv_repo.save(p2, n2, {"customer": {"name": "رضا"}}, 200)
print(f"  شماره‌ها: {n1} ، {n2}")
inv_repo.delete(1)  # حذف اولین فاکتور
n3 = inv_repo.next_number("quote")
print(f"  بعد از حذف فاکتور اول، شماره‌ی بعدی: {n3}")
bug8 = n3 == n2
print(f"  → با شماره‌ی فاکتور موجود ({n2}) collide می‌کند؟ {bug8}")
# ستون customer_name همیشه خالی است:
row = db.one("SELECT number, customer_name FROM invoices LIMIT 1")
print(f"  ستون customer_name در DB: «{row['customer_name']}» (انتظار: «علی»)")

print("=" * 72)
print("باگ ۹: کد پروژه بعد از حذف تکراری می‌شود")
c1 = proj_repo.get(p1)["code"]; c2 = proj_repo.get(p2)["code"]
proj_repo.delete(p1)
c3 = proj_repo.next_code()
print(f"  کدها: {c1} ، {c2} → کد بعدی: {c3}")
bug9 = c3 == c2
print(f"  → collide می‌کند؟ {bug9}")

print("=" * 72)
print("باگ ۱۰: داشبورد — «فروش این ماه» آخرین ماهِ دارای داده است نه ماه جاری")
from kabir.data import backup as bk
rows = proj_repo.monthly(6)
print(f"  monthly() → {[ (r['ym'], r['cnt']) for r in rows ]}")
print("  اگر ۶ ماه پیش پروژه باشد و این ماه هیچ، monthly[-1] ماهِ ۶ ماه پیش است")
# ساخت رکورد قدیمی برای اثبات
db.execute("INSERT INTO projects(title,status,final_price,created_at) VALUES('قدیمی','done',500,'2020-01-15T10:00:00')")
rows = proj_repo.monthly(6)
print(f"  بعد از افزودن رکورد ۲۰۲۰: {[ (r['ym'], r['total']) for r in rows ]}")
from kabir.web import server as srv
dash = srv._dashboard(db)
print(f"  dashboard.month_amount = {dash['month_amount']:,.0f} ← «این ماه» ولی واقعاً ماهِ آخرین داده است")

print("=" * 72)
print("باگ ۱۱: import_json با ستون ناشناخته → استثنای خام (۵۰۰) به‌جای پیام تمیز")
payload = {"app": "KabirCabinet", "settings": {},
           "tables": {"materials": [{"id": 999, "category": "hinge", "name": "x",
                                     "column_that_does_not_exist": 1}]}}
tmp = Path(os.environ["KABIR_DATA_DIR"]) / "bad-import.json"
tmp.write_text(json.dumps(payload), encoding="utf-8")
try:
    ok, msg = bk.import_json(tmp)
    print(f"  نتیجه: ok={ok} msg={msg}")
except Exception as exc:
    print(f"  → استثنا پرتاب شد: {type(exc).__name__}: {exc}")

print("=" * 72)
print("باگ ۱۲: نرخ‌های متریال — تغییر ۰٪ هم تاریخچه رد می‌کند و «تغییر» می‌شمارد")
repo = MaterialRepo(db)
m = repo.get(1)
before = len(repo.history())
cnt = repo.bulk_change_price(None, 0.0)
after = len(repo.history())
print(f"  bulk_change_price(0%) → count={cnt} (همه‌ی اقلام!)، تاریخچه +{after - before} رکورد پوچ")

print("=" * 72)
print("باگ ۱۳: summarize_sheets پرت را حساب نمی‌کند → کمتر از ورقِ فاکتور")
from kabir.core.costing import CostingEngine, Material, Page, UnitRow, DoorRow
from kabir.core import workshop as ws
MATS = [Material(1, "ورق بدنه", "body_sheet", "sheet", 4_800_000, 183, 366, 16),
        Material(2, "فیبر پشت", "back_sheet", "sheet", 1_600_000, 122, 244, 3)]
eng = CostingEngine(MATS, {})
u = UnitRow(unit_type="ground", qty=3, length_cm=90, height_cm=72, depth_cm=55,
            shelves=1, body_id=1, back_id=2)
pg = Page(name="s", units=[u], waste_percent=10)
res = eng.calc_project([pg])
pack = ws.build_workshop_pack(eng, [pg], res, {})
invoice_sheets = sum(i.sheets for i in res.items if i.key == "body_sheet")
ws_sheets = next((s["sheets"] for s in pack["sheet_summary"] if s["cat"] == "body_sheet"), None)
print(f"  ورق بدنه در فاکتور (با پرت و گرد شدن): {invoice_sheets}")
print(f"  ورق بدنه در خلاصه‌ی کارگاه (بدون پرت): {ws_sheets}")
bug13 = invoice_sheets != ws_sheets
print(f"  → ناهمخوانی؟ {bug13}")
