# -*- coding: utf-8 -*-
"""
تست‌های بازگشتیِ «شورای منتقد» — هر باگِ منطقی که اصلاح شد، یک تست دارد.

پوشش:
  * موتور محاسبه (kabir.core.costing): دوباره‌شماری خدمات، مبنای مترمربع،
    یونیت با تعداد ≤ ۰، ضریب نوار در، متریالِ حذف‌شده، اعتبارسنجی درصدها،
    ردیفِ شفافِ سربار، خدمات درصدیِ غیرمرکب، پرتِ نوار کشو، همگامی هزینه‌ی یونیت.
  * لایه‌ی داده (dao/backup): یکتایی شماره‌ی فاکتور و کد پروژه بعد از حذف،
    ماه‌های بدون داده در آمار ماهانه، تغییر قیمتِ بی‌اثر، ورودِ JSON مقاوم،
    نام مشتریِ فاکتور، حضور unit_templates در خروجی.
  * سرور (web/server): نگهبانِ حذفِ متریالِ در حال استفاده، بازمحاسبه‌ی
    سمتِ سرور هنگام ذخیره‌ی پروژه، اعتبارسنجی Host (ضد DNS-rebinding)،
    CORS مبدأ-آگاه، تبدیل تاریخِ میلادیِ پیش از ۲۰۰۰.
  * کارگاه (workshop): هم‌خوانی ورقِ خلاصه با ورقِ فاکتور، حذف یونیتِ صفر
    از برش‌نامه.

اجرا:  pytest tests/test_critic_fixes.py -v
"""

from __future__ import annotations

import json
import math
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

_TMP = os.environ.get("KABIR_DATA_DIR") or tempfile.mkdtemp(prefix="kabir-critic-")
os.environ["KABIR_DATA_DIR"] = _TMP

from kabir.core.costing import (                                   # noqa: E402
    CostingEngine, DoorRow, DrawerRow, Material, Page, ServiceRow, UnitRow,
)
from kabir.core import invoice as inv                              # noqa: E402
from kabir.core import persian as fa                               # noqa: E402
from kabir.core import workshop as ws                              # noqa: E402
from kabir.data.db import Database                                 # noqa: E402
from kabir.data import backup as bk                                # noqa: E402
from kabir.data import dao                                         # noqa: E402
from kabir.data.dao import InvoiceRepo, MaterialRepo, ProjectRepo  # noqa: E402

MATS = [
    Material(1, "ورق بدنه", "body_sheet", "sheet", 4_800_000, 183, 366, 16),
    Material(2, "فیبر پشت", "back_sheet", "sheet", 1_600_000, 122, 244, 3),
    Material(3, "ورق در", "door_sheet", "sheet", 9_000_000, 183, 366, 16),
    Material(4, "لولا", "hinge", "piece", 100_000),
    Material(7, "نوار", "banding", "lm", 20_000),
]


def _engine():
    return CostingEngine(MATS, {})


def _page(services=(), **kw) -> Page:
    door = DoorRow(qty=2, w_cm=45, h_cm=70, material_id=3, hinge_id=4, banding_id=7)
    unit = UnitRow(label="زمینی", unit_type="ground", qty=1, length_cm=90,
                   height_cm=72, depth_cm=55, shelves=1, doors=[door],
                   body_id=1, back_id=2, banding_id=7)
    defaults = dict(waste_percent=10, overhead_percent=0,
                    banding_body_factor=2.2, banding_door_factor=1.0,
                    banding_waste_percent=0)
    defaults.update(kw)
    return Page(name="تست", units=[unit], services=list(services), **defaults)


# ===========================================================================
# موتور محاسبه
# ===========================================================================

class TestEngineFixes(unittest.TestCase):

    def test_service_counted_once(self):
        """باگ ۱: خدمات غیردرصدی باید دقیقاً یک‌بار در جمع بخش بیاید."""
        eng = _engine()
        r0 = eng.calc_page(_page())
        r1 = eng.calc_page(_page(services=[ServiceRow("حمل", "fixed", 1, 5_000_000)]))
        self.assertAlmostEqual(r1.subtotal - r0.subtotal, 5_000_000, delta=1)
        self.assertAlmostEqual(r1.service_cost, 5_000_000, delta=1)
        # ردیفِ خدمت فقط یک‌بار در اقلام هست
        svc_items = [i for i in r1.items if i.key == "service"]
        self.assertEqual(len(svc_items), 1)
        self.assertAlmostEqual(sum(i.amount for i in r1.items), r1.total_cost, delta=1)

    def test_sqm_service_basis(self):
        """باگ ۲: مبنای مترمربع باید مساحت کل قطعات بخش × قیمت باشد."""
        eng = _engine()
        page = _page(services=[ServiceRow("اجرت متری", "sqm", 1, 900_000)])
        r = eng.calc_page(page)
        svc = next(i for i in r.items if i.key == "service")
        expected_area = r.total_area_sqm
        self.assertGreater(expected_area, 0)
        self.assertAlmostEqual(expected_area,
                               r.total_body_area + r.total_door_area + r.total_back_area,
                               delta=1e-9)
        self.assertAlmostEqual(svc.qty, expected_area, delta=1e-9)
        self.assertAlmostEqual(svc.amount, expected_area * 900_000, delta=1)

    def test_zero_and_negative_qty_units_skipped(self):
        """باگ ۳: یونیت با تعداد ۰ یا منفی باید بدون هزینه رد شود + هشدار."""
        eng = _engine()
        for q in (0, -3):
            u = UnitRow(label="u", unit_type="ground", qty=q, length_cm=90,
                        height_cm=72, depth_cm=55, body_id=1, back_id=2)
            res = eng.calc_project([Page(name="p", units=[u], waste_percent=10)])
            self.assertEqual(res.total_cost, 0.0, f"qty={q} نباید هزینه داشته باشد")
            self.assertEqual(res.stats["total_units"], 0)
            self.assertTrue(any("نادیده گرفته شد" in w for w in res.warnings),
                            f"qty={q} باید هشدار بدهد")

    def test_banding_door_factor_applied(self):
        """باگ ۴: ضریب نوار در باید واقعاً در متراژ ضرب شود."""
        eng = _engine()
        f1 = _page(banding_door_factor=1.0)
        f3 = _page(banding_door_factor=3.0)
        a1 = next(i.amount for i in eng.calc_page(f1).items if i.key == "banding_door")
        a3 = next(i.amount for i in eng.calc_page(f3).items if i.key == "banding_door")
        self.assertAlmostEqual(a3, a1 * 3, delta=1)

    def test_missing_material_warns(self):
        """باگ ۵: متریال حذف‌شده باید هشدار صریح تولید کند (نه بدنه‌ی رایگانِ بی‌صدا)."""
        eng = CostingEngine([m for m in MATS if m.id != 1], {})
        res = eng.calc_project([_page()])
        self.assertFalse(any(i.key == "body_sheet" for i in res.items))
        self.assertTrue(any("ورق بدنه" in w and "محاسبه نشد" in w for w in res.warnings),
                        f"هشدارِ ورق بدنه پیدا نشد: {res.warnings}")

    def test_page_countertop_without_material_warns(self):
        eng = _engine()
        page = _page(countertop_lm=3.0)     # هیچ یونیتی countertop_id ندارد
        res = eng.calc_project([page])
        self.assertFalse(any(i.key == "countertop" for i in res.items))
        self.assertTrue(any("صفحه‌ی کابینت" in w for w in res.warnings))

    def test_margin_over_100_and_negative_discount(self):
        """باگ ۶: مارجین ≥ ۱۰۰ هشدار می‌گیرد؛ تخفیف منفی دیگر قیمت را بالا نمی‌برد."""
        eng = _engine()
        r = eng.calc_project([_page()], profit_mode="margin", profit_percent=100,
                             discount_percent=-20, discount_amount=-500_000)
        self.assertEqual(r.profit_amount, 0.0)
        self.assertTrue(any("مارجین" in w for w in r.warnings))
        self.assertEqual(r.discount_amount, 0.0)
        self.assertAlmostEqual(r.net_price, r.gross_price, delta=1)
        self.assertAlmostEqual(r.final_price, r.gross_price, delta=1)
        # درصدِ گزارش‌شده هم باید محدود شده باشد
        self.assertEqual(r.discount_percent, 0.0)

    def test_overhead_itemized_and_totals_consistent(self):
        """سربار باید ردیفِ شفاف داشته باشد و جمع اقلام == هزینه‌ی تمام‌شده."""
        eng = _engine()
        page = _page(overhead_percent=15)
        res = eng.calc_project([page], install_mode="fixed", install_value=500_000,
                               profit_percent=0, extra_fixed_amount=250_000)
        overhead_items = [i for i in res.items if i.key == "overhead"]
        self.assertEqual(len(overhead_items), 1)
        self.assertAlmostEqual(overhead_items[0].amount, res.pages[0].overhead_amount, delta=1)
        self.assertAlmostEqual(sum(i.amount for i in res.items), res.total_cost, delta=1)
        self.assertIn("سربار", inv.GROUP_ORDER)

    def test_unit_cost_synced_after_sheet_batching(self):
        """باگ ۷: هزینه‌ی هر یونیت باید با مبالغِ تجمیع‌شده‌ی ورق همگام باشد."""
        eng = _engine()
        pr = eng.calc_page(_page())
        self.assertAlmostEqual(sum(ur.cost for ur in pr.unit_results), pr.subtotal, delta=1)
        for ur in pr.unit_results:
            self.assertAlmostEqual(ur.cost, sum(i.amount for i in ur.items), delta=1e-6)

    def test_percent_services_not_compounding(self):
        """دو خدمت درصدی باید هر دو نسبت به جمعِ پایه حساب شوند (نه مرکب)."""
        eng = _engine()
        base = eng.calc_page(_page()).subtotal
        page = _page(services=[ServiceRow("الف", "percent", 1, 10),
                               ServiceRow("ب", "percent", 1, 10)])
        res = eng.calc_project([page])
        pr = res.pages[0]
        # مرکب می‌شد: base*(1.1*1.1-1)=0.21*base ؛ درست: 0.20*base
        self.assertAlmostEqual(pr.service_cost, base * 0.20, delta=1)
        svc_items = [i for i in pr.items if i.key == "service"]
        self.assertEqual(len(svc_items), 2)

    def test_drawer_banding_includes_waste(self):
        """نوار کشو هم مثل نوار بدنه/در باید پرت داشته باشد."""
        eng = _engine()
        dw = DrawerRow(label="کشو", qty=2, w_cm=80, h_cm=18, d_cm=45, banding_id=7)
        u = UnitRow(unit_type="ground", qty=1, length_cm=90, height_cm=72,
                    depth_cm=55, body_id=1, drawers=[dw])
        page = Page(name="p", units=[u], waste_percent=0, banding_waste_percent=8)
        r = eng.calc_page(page)
        item = next(i for i in r.items if i.key == "banding_drawer")
        self.assertAlmostEqual(item.qty, dw.banding_m * 2 * 1.08, delta=1e-9)

    def test_legs_default_aligned_with_web(self):
        """پیش‌فرض پایه‌ها در هسته باید ۴ باشد (مثل رابط وب) نه ۲."""
        self.assertEqual(UnitRow().legs_per_unit, 4)
        eng = _engine()
        u = UnitRow(unit_type="ground", qty=1, length_cm=60, height_cm=72,
                    depth_cm=55, body_id=1, leg_id=4)   # leg_id=4 → «لولا» فقط برای تست تعداد
        r = eng.calc_unit(u, Page(name="p"))
        leg_item = next(i for i in r.items if i.key == "leg")
        self.assertEqual(leg_item.qty, 4)


# ===========================================================================
# لایه‌ی داده
# ===========================================================================

class TestDataFixes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = Database.instance()
        dao.bootstrap(cls.db)

    def test_invoice_number_unique_after_delete(self):
        """باگ ۸: شماره‌ی فاکتور بعد از حذفِ یک فاکتور تکراری نشود."""
        repo = InvoiceRepo(self.db)
        n1 = repo.next_number("quote")
        i1 = repo.save(None, n1, {"customer": {"name": "الف"}}, 10)
        n2 = repo.next_number("quote")
        i2 = repo.save(None, n2, {"customer": {"name": "ب"}}, 20)
        self.assertNotEqual(n1, n2)
        repo.delete(i1)
        n3 = repo.next_number("quote")
        self.assertNotEqual(n3, n2, "شماره‌ی تکراری صادر شد!")
        repo.delete(i2)

    def test_invoice_customer_name_persisted(self):
        """ستون customer_name باید از داده‌ی تودرتوی مشتری پر شود."""
        repo = InvoiceRepo(self.db)
        n = repo.next_number("invoice")
        iid = repo.save(None, n, {"customer": {"name": "مریم رضایی"}}, 5, kind="invoice")
        row = self.db.one("SELECT customer_name FROM invoices WHERE id=?", (iid,))
        self.assertEqual(row["customer_name"], "مریم رضایی")
        repo.delete(iid)

    def test_project_code_unique_after_delete(self):
        """باگ ۹: کد پروژه بعد از حذف تکراری نشود."""
        repo = ProjectRepo(self.db)
        p1 = repo.create({"title": "تست کد ۱"})
        p2 = repo.create({"title": "تست کد ۲"})
        c2 = repo.get(p2)["code"]
        repo.delete(p1)
        c3 = repo.next_code()
        self.assertNotEqual(c3, c2, "کد تکراری تولید شد!")
        repo.delete(p2)

    def test_monthly_zero_filled_and_current_last(self):
        """باگ ۱۰: آمار ماهانه باید ماه‌های خالی را صفر بزند و به ماه جاری ختم شود."""
        rows = ProjectRepo(self.db).monthly(6)
        self.assertEqual(len(rows), 6)
        now = datetime.now()
        self.assertEqual(rows[-1]["ym"], f"{now.year:04d}-{now.month:02d}")
        # ترتیب زمانی صعودی
        self.assertEqual([r["ym"] for r in rows], sorted(r["ym"] for r in rows))

    def test_bulk_zero_percent_is_noop(self):
        """باگ ۱۲: تغییر ۰٪ نباید تاریخچه‌ی پوچ بسازد یا قلمی را بشمارد."""
        repo = MaterialRepo(self.db)
        hist_before = len(repo.history())
        count = repo.bulk_change_price(None, 0.0)
        self.assertEqual(count, 0)
        self.assertEqual(len(repo.history()), hist_before)

    def test_import_json_filters_unknown_columns(self):
        """باگ ۱۱: ستون ناشناخته باید فیلتر شود، نه استثنای خام."""
        payload = {
            "app": "KabirCabinet", "settings": {},
            "tables": {"materials": [{
                "id": 987654, "category": "hinge", "name": "قلم تست منتقد",
                "unit": "piece", "price": 12345, "active": 1,
                "column_from_future_version": "x"}]},
        }
        tmp = Path(_TMP) / "critic-import.json"
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        ok, msg = bk.import_json(tmp, replace=False, db=self.db)
        self.assertTrue(ok, msg)
        self.assertIn("نادیده", msg)
        row = self.db.one("SELECT name FROM materials WHERE id=987654")
        self.assertIsNotNone(row)
        self.assertEqual(row["name"], "قلم تست منتقد")
        self.db.execute("DELETE FROM materials WHERE id=987654")

    def test_export_json_includes_unit_templates(self):
        """خروجی JSON باید الگوهای یونیت را هم ببرد (پیش‌تر جا می‌ماندند)."""
        tmp = Path(_TMP) / "critic-export.json"
        ok, _ = bk.export_json(tmp, self.db)
        self.assertTrue(ok)
        data = json.loads(tmp.read_text(encoding="utf-8"))
        self.assertIn("unit_templates", data["tables"])


# ===========================================================================
# کارگاه
# ===========================================================================

class TestWorkshopFixes(unittest.TestCase):

    def test_sheet_summary_matches_invoice(self):
        """باگ ۱۳: ورقِ خلاصه‌ی کارگاه باید همان ورقِ فاکتورشده باشد (با پرت)."""
        eng = _engine()
        # مساحتِ خالص طوری انتخاب شده که «بدون پرت» ۱ ورق و «با پرت» ۲ ورق شود
        u = UnitRow(unit_type="ground", qty=4, length_cm=100, height_cm=75,
                    depth_cm=58, shelves=1, body_id=1)
        page = Page(name="s", units=[u], waste_percent=25)
        res = eng.calc_project([page])
        invoiced = sum(i.sheets for i in res.items if i.key == "body_sheet")
        pack = ws.build_workshop_pack(eng, [page], res, {})
        row = next(s for s in pack["sheet_summary"] if s["cat"] == "body_sheet")
        self.assertEqual(row["sheets"], invoiced)
        self.assertGreaterEqual(invoiced, 2, "سناریوی تست باید مرزی باشد")

    def test_cut_list_skips_zero_qty_units(self):
        eng = _engine()
        u = UnitRow(unit_type="ground", qty=0, length_cm=90, height_cm=72,
                    depth_cm=55, body_id=1)
        parts = ws.build_cut_list(eng, [Page(name="p", units=[u])])
        self.assertEqual(parts, [])


# ===========================================================================
# فاکتور
# ===========================================================================

class TestInvoiceFixes(unittest.TestCase):

    def test_items_sum_equals_total_cost(self):
        eng = _engine()
        res = eng.calc_project([_page(overhead_percent=10)], profit_percent=20,
                               vat_enabled=True, vat_percent=9)
        data = inv.build_invoice_data(res, {"customer_name": "تست"}, {"currency": "ریال"})
        self.assertAlmostEqual(sum(i["amount"] for i in data["items"]),
                               data["totals"]["total_cost"], delta=1)

    def test_no_duplicate_total_row_with_show_cost(self):
        eng = _engine()
        res = eng.calc_project([_page()], profit_percent=0)
        data = inv.build_invoice_data(res, {}, {"currency": "ریال"})
        data["show_cost"] = True
        html = inv.render_html(data)
        self.assertIn("جمع هزینه‌ی تمام‌شده", html)
        self.assertNotIn("جمع کل اقلام", html)
        data["show_cost"] = False
        html = inv.render_html(data)
        self.assertIn("جمع کل اقلام", html)
        self.assertNotIn("جمع هزینه‌ی تمام‌شده", html)

    def test_single_timestamp_for_invoice(self):
        eng = _engine()
        res = eng.calc_project([_page()])
        data = inv.build_invoice_data(res, {}, {"currency": "ریال"})
        # تاریخ و ساعت از یک لحظه‌ی واحد آمده باشند (فقط وجودشان را می‌سنجیم)
        self.assertTrue(data["date_fa"] and data["date_en"] and data["time"])


# ===========================================================================
# سرور وب
# ===========================================================================

PORT = 8124
_httpd = None


def _req(path, method="GET", body=None, headers=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    hdrs = dict(headers or {})
    if data is not None:
        hdrs.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=data,
                                 method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read()
            try:
                return r.status, dict(r.headers), json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                return r.status, dict(r.headers), raw
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, dict(e.headers), json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return e.code, dict(e.headers), raw


def setUpModule():
    global _httpd
    from http.server import ThreadingHTTPServer
    from kabir.web import server as srv
    db = Database.instance()
    dao.bootstrap(db)
    _httpd = ThreadingHTTPServer(("127.0.0.1", PORT), srv.KabirHandler)
    _httpd.daemon_threads = True
    threading.Thread(target=_httpd.serve_forever, daemon=True).start()


def tearDownModule():
    if _httpd:
        _httpd.shutdown()
        _httpd.server_close()


class TestServerFixes(unittest.TestCase):

    def test_host_header_validation(self):
        """درخواست API با Host دامنه‌ی ناشناس (DNS-rebinding) باید ۴۰۳ شود."""
        status, _, body = _req("/api/health", headers={"Host": "evil.example.com"})
        self.assertEqual(status, 403)
        status, _, body = _req("/api/health")     # Host پیش‌فرض urllib → 127.0.0.1:PORT
        self.assertEqual(status, 200)

    def test_cors_not_wildcard(self):
        """CORS باید مبدأ-آگاه باشد: مبدأ بیگانه هیچ ACAO نمی‌گیرد."""
        _, headers, _ = _req("/api/health", headers={"Origin": "https://evil.example"})
        self.assertIsNone(headers.get("Access-Control-Allow-Origin"))
        _, headers, _ = _req("/api/health", headers={"Origin": "null"})
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "null")
        _, headers, _ = _req("/api/health",
                             headers={"Origin": f"http://127.0.0.1:{PORT}"})
        self.assertEqual(headers.get("Access-Control-Allow-Origin"),
                         f"http://127.0.0.1:{PORT}")

    def test_material_delete_guarded_when_in_use(self):
        """حذف متریالِ در حال استفاده باید ۴۰۹ بدهد و با force انجام شود."""
        _, _, body = _req("/api/materials", "POST",
                          {"name": "ورق تست منتقد", "cat": "body_sheet", "unit": "sheet",
                           "price": 5_000_000, "sheet_width_cm": 183, "sheet_height_cm": 366,
                           "thickness_mm": 16})
        mid = int(body["id"])
        _, _, body = _req("/api/projects", "POST", {"title": "پروژه‌ی تست منتقد"})
        pid = int(body["project"]["id"])
        _req(f"/api/projects/{pid}", "PUT", {"pages": [{
            "name": "بخش ۱",
            "units": [{"label": "u", "unit_type": "ground", "qty": 1, "length_cm": 60,
                       "height_cm": 72, "depth_cm": 55, "shelves": 0, "body_id": mid,
                       "doors": [], "drawers": []}],
        }]})
        status, _, body = _req(f"/api/materials/{mid}", "DELETE")
        self.assertEqual(status, 409, body)
        self.assertIn("استفاده", body.get("error", ""))
        status, _, body = _req(f"/api/materials/{mid}", "DELETE", {"force": True})
        self.assertEqual(status, 200, body)
        _req(f"/api/projects/{pid}", "DELETE")

    def test_project_update_recalculates_server_side(self):
        """ذخیره‌ی پروژه باید قیمت را سمت سرور بازمحاسبه کند (نه عدد کلاینت)."""
        _, _, body = _req("/api/projects", "POST", {"title": "پروژه‌ی بازمحاسبه"})
        pid = int(body["project"]["id"])
        _, _, body = _req("/api/materials", "POST",
                          {"name": "ورق بازمحاسبه", "cat": "body_sheet", "unit": "sheet",
                           "price": 4_000_000, "sheet_width_cm": 183, "sheet_height_cm": 366,
                           "thickness_mm": 16})
        mid = int(body["id"])
        # کلاینت قیمتِ اشتباهِ عمدی می‌فرستد؛ سرور باید آن را با مقدار درست جایگزین کند
        _, _, body = _req(f"/api/projects/{pid}", "PUT", {
            "final_price": 1, "total_cost": 1,
            "pages": [{"name": "بخش ۱", "units": [
                {"label": "u", "unit_type": "ground", "qty": 2, "length_cm": 90,
                 "height_cm": 72, "depth_cm": 55, "shelves": 1, "body_id": mid,
                 "doors": [], "drawers": []}],
            }],
        })
        proj = body["project"]
        self.assertGreater(proj["final_price"], 1_000_000,
                           "قیمت باید سمت سرور بازمحاسبه شود")
        self.assertFalse(proj["stale"])
        _req(f"/api/projects/{pid}", "DELETE")
        _req(f"/api/materials/{mid}", "DELETE", {"force": True})

    def test_jdate_converts_pre2000_iso(self):
        """باگ ۱۶: تاریخ ISO پیش از ۲۰۰۰ باید به شمسی تبدیل شود (نه عبور مستقیم)."""
        from kabir.web import server as srv
        out = srv._jdate("1998-05-05")
        self.assertNotEqual(out, "1998-05-05")
        self.assertEqual(out, fa.jdate_str(datetime(1998, 5, 5)))
        # ورودی شمسیِ آماده باید دست‌نخورده بماند
        self.assertEqual(srv._jdate("1404-07-30"), "1404/07/30")

    def test_quick_project_without_any_style_errors(self):
        """بدون هیچ سبکی، قیمت‌گیری سریع باید خطای صریح بدهد (نه عدد پوچ)."""
        from kabir.data.dao import StyleRepo
        repo = StyleRepo(Database.instance())
        styles = repo.all()
        deleted = []
        for st in styles:                       # موقتاً همه‌ی سبک‌ها را برمی‌داریم
            deleted.append(st)
            repo.delete(int(st["id"]))
        try:
            status, _, body = _req("/api/quick-project", "POST",
                                   {"ground_lm": 2, "wall_lm": 0})
            self.assertEqual(status, 400, body)
            self.assertIn("سبک", body.get("error", ""))
        finally:
            for st in deleted:                  # بازگردانی
                data = st.get("data") or {}
                repo.add(st["name"], data, st.get("note", ""))


if __name__ == "__main__":
    unittest.main()
