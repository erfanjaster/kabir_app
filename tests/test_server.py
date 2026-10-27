# -*- coding: utf-8 -*-
"""تست دود سرویس‌دهنده‌ی وب کبیر — اجرا:  pytest tests -v

سرور واقعی را روی یک پورت آزاد و با پایگاه‌داده‌ی موقت بالا می‌آورد و
مسیرهای اصلی API و سرو فایل‌های استاتیک را بررسی می‌کند.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

_TMP = tempfile.mkdtemp(prefix="kabir-test-")
os.environ["KABIR_DATA_DIR"] = _TMP

from kabir.web import server as srv  # noqa: E402
from kabir.core import invoice as inv  # noqa: E402


def _get(path: str, timeout: float = 10):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.headers, r.read()


def _json(path: str, method: str = "GET", body=None, timeout: float = 10):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        f"http://127.0.0.1:{PORT}{path}", data=data, method=method,
        headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


PORT = 8123
_httpd = None


def setUpModule():
    global _httpd
    from http.server import ThreadingHTTPServer
    from kabir.data import dao
    from kabir.data.db import Database
    db = Database.instance()
    dao.bootstrap(db)
    _httpd = ThreadingHTTPServer(("127.0.0.1", PORT), srv.KabirHandler)
    _httpd.daemon_threads = True
    threading.Thread(target=_httpd.serve_forever, daemon=True).start()


def tearDownModule():
    if _httpd:
        _httpd.shutdown()
        _httpd.server_close()


class TestStatic(unittest.TestCase):
    def test_index_served(self):
        status, headers, raw = _get("/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", headers.get("Content-Type"))
        self.assertIn("کبیر".encode("utf-8"), raw)

    def test_security_headers(self):
        status, headers, _ = _get("/")
        self.assertEqual(headers.get("X-Content-Type-Options"), "nosniff")
        self.assertEqual(headers.get("Referrer-Policy"), "same-origin")

    def test_etag_304(self):
        status, headers, _ = _get("/css/styles.css")
        etag = headers.get("ETag")
        self.assertTrue(etag)
        req = urllib.request.Request(f"http://127.0.0.1:{PORT}/css/styles.css",
                                     headers={"If-None-Match": etag})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                code = r.status
        except urllib.error.HTTPError as e:
            code = e.code
        self.assertEqual(code, 304)

    def test_path_traversal_blocked(self):
        req = urllib.request.Request(f"http://127.0.0.1:{PORT}/../kabir/config.py")
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                code = r.status
        except urllib.error.HTTPError as e:
            code = e.code
        self.assertIn(code, (403, 404))

    def test_manifest_and_icon(self):
        for path in ("/manifest.webmanifest", "/assets/favicon.svg", "/assets/icon-192.png"):
            status, _, _ = _get(path)
            self.assertEqual(status, 200, path)


class TestApi(unittest.TestCase):
    def test_health(self):
        status, body = _json("/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["status"], "ok")
        self.assertIn("version", body)

    def test_bootstrap(self):
        status, body = _json("/api/bootstrap")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertIn("materials", body)
        self.assertIn("projects", body)
        self.assertIn("settings", body)
        self.assertGreater(len(body["materials"]), 0)

    def test_settings_roundtrip(self):
        status, body = _json("/api/settings", "PUT",
                             {"settings": {"company_name": "تست کبیر"}})
        self.assertEqual(status, 200)
        self.assertEqual(body["settings"]["company_name"], "تست کبیر")

    def test_project_crud_and_calc(self):
        status, body = _json("/api/projects", "POST",
                             {"title": "پروژه‌ی تست دود", "customer": "مشتری تست"})
        self.assertEqual(status, 200)
        pid = body["project"]["id"]

        status, one = _json(f"/api/projects/{pid}")
        self.assertEqual(status, 200)
        self.assertEqual(one["project"]["title"], "پروژه‌ی تست دود")

        status, calc = _json("/api/calc", "POST",
                             {"project": {"id": pid, "profit_mode": "markup",
                                          "profit_percent": 25},
                              "pages": [{"name": "بخش ۱", "style_id": 0,
                                         "units": [], "extras": [], "services": []}]})
        self.assertEqual(status, 200)
        self.assertIn("final_price", calc)

        status, _ = _json(f"/api/projects/{pid}", "DELETE")
        self.assertEqual(status, 200)

    def test_material_create_requires_name(self):
        status, body = _json("/api/materials", "POST", {"price": 100})
        self.assertEqual(status, 400)
        self.assertFalse(body["ok"])

    def test_unknown_route_404(self):
        status, body = _json("/api/nope")
        self.assertEqual(status, 404)
        self.assertFalse(body["ok"])


class TestWorkshopApi(unittest.TestCase):
    """مسیرهای تازه‌ی کارگاهی: برش‌نامه، لیست خرید، قیمت‌گیری سریع، الگوی یونیت"""

    def _make_project(self, title="تست کارگاهی"):
        status, body = _json("/api/projects", "POST",
                             {"title": title, "customer": "مشتری کارگاهی"})
        self.assertEqual(status, 200)
        return int(body["project"]["id"])

    _mats = None

    def _mat_ids(self):
        """شناسه‌ی چند متریال واقعی از پایگاه‌داده (بدون قیمت، هزینه صفر می‌شود)"""
        if TestWorkshopApi._mats is None:
            _, body = _json("/api/materials")
            rows = body.get("materials") or []
            pick = {}
            for cat in ("body_sheet", "back_sheet", "door_sheet", "banding", "hinge"):
                row = next((m for m in rows
                            if m.get("cat") == cat or m.get("category") == cat), None)
                pick[cat] = int(row["id"]) if row else 0
            TestWorkshopApi._mats = pick
        return TestWorkshopApi._mats

    def _pages_with_units(self, with_materials=True):
        m = self._mat_ids() if with_materials else {}
        return [{"name": "بخش ۱", "style_id": 0, "units": [
            {"label": "زمینی ۹۰", "unit_type": "ground", "qty": 2,
             "length_cm": 90, "height_cm": 72, "depth_cm": 55, "shelves": 1,
             "body_id": m.get("body_sheet", 0), "back_id": m.get("back_sheet", 0),
             "banding_id": m.get("banding", 0),
             "doors": [{"qty": 2, "w_cm": 44.5, "h_cm": 71.7,
                        "material_id": m.get("door_sheet", 0),
                        "hinge_id": m.get("hinge", 0),
                        "banding_id": m.get("banding", 0)}],
             "drawers": []}],
            "extras": [], "services": []}]

    # ------------------------------------------------------------- برش‌نامه
    def test_workshop_pack(self):
        pid = self._make_project()
        status, pack = _json("/api/workshop", "POST",
                             {"project": {"id": pid, "profit_percent": 30},
                              "pages": self._pages_with_units()})
        self.assertEqual(status, 200)
        for key in ("cut_parts", "sheet_summary", "shopping", "shopping_groups",
                    "by_category", "stats", "project"):
            self.assertIn(key, pack)
        self.assertTrue(pack["cut_parts"], "برش‌نامه خالی برگشت")
        st = pack["stats"]
        self.assertEqual(st["part_kinds"], len(pack["cut_parts"]))
        self.assertEqual(st["total_pieces"], sum(p["qty"] for p in pack["cut_parts"]))
        self.assertEqual(int(pack["project"]["id"]), pid)
        _json(f"/api/projects/{pid}", "DELETE")

    def test_workshop_cut_parts_are_millimetres_and_ordered(self):
        pid = self._make_project()
        _, pack = _json("/api/workshop", "POST",
                        {"project": {"id": pid}, "pages": self._pages_with_units()})
        for p in pack["cut_parts"]:
            self.assertGreaterEqual(p["length_mm"], p["width_mm"])
            self.assertGreater(p["length_mm"], 0)
        self.assertTrue(any(abs(p["length_mm"] - 720) < 0.01
                            for p in pack["cut_parts"]))
        _json(f"/api/projects/{pid}", "DELETE")

    def test_workshop_lists_body_even_without_material(self):
        """متریال انتخاب‌نشده نباید بدنه را از برش‌نامه حذف کند"""
        pid = self._make_project()
        _, pack = _json("/api/workshop", "POST",
                        {"project": {"id": pid},
                         "pages": self._pages_with_units(with_materials=False)})
        cats = {p["mat_cat"] for p in pack["cut_parts"]}
        self.assertIn("body_sheet", cats)
        self.assertTrue(any("بدنه کناری" in p["part"] for p in pack["cut_parts"]))
        _json(f"/api/projects/{pid}", "DELETE")

    def test_workshop_uses_saved_project_when_no_pages(self):
        """اگر صفحات ارسال نشود، از پروژه‌ی ذخیره‌شده خوانده می‌شود"""
        pid = self._make_project()
        _json(f"/api/projects/{pid}", "PUT", {"pages": self._pages_with_units()})
        status, pack = _json("/api/workshop", "POST", {"project": {"id": pid}})
        self.assertEqual(status, 200)
        self.assertTrue(pack["cut_parts"])
        _json(f"/api/projects/{pid}", "DELETE")

    def test_workshop_xlsx_download(self):
        pid = self._make_project()
        data = json.dumps({"project": {"id": pid}, "pages": self._pages_with_units()}).encode()
        req = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/workshop/xlsx",
                                     data=data, method="POST",
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            ctype = r.headers.get("Content-Type", "")
            disp = r.headers.get("Content-Disposition", "")
        # با openpyxl → xlsx؛ بدون آن → CSV (کاربر دستِ خالی نمی‌ماند)
        self.assertTrue("sheet" in ctype or "csv" in ctype, ctype)
        self.assertIn("boresh-nameh", disp)
        self.assertTrue(len(raw) > 100)
        _json(f"/api/projects/{pid}", "DELETE")

    # ------------------------------------------------------- قیمت‌گیری سریع
    def test_quick_project_builds_units(self):
        status, body = _json("/api/quick-project", "POST",
                             {"ground_lm": 3.6, "wall_lm": 3.0, "drawers": 3,
                              "tall": 1, "title": "تماس مشتری", "customer": "آقای رضایی",
                              "mobile": "09120000000", "install_mode": "per_meter",
                              "install_value": 850_000})
        self.assertEqual(status, 200)
        self.assertIn("project", body)
        self.assertIn("calc", body)
        pid = int(body["project"]["id"])
        self.assertGreater(body["calc"]["final_price"], 0)
        self.assertGreater(body["calc"]["price_per_ground_lm"], 0)
        status, one = _json(f"/api/projects/{pid}")
        pages = one["project"].get("pages") or []
        self.assertTrue(pages)
        units = pages[0].get("units") or []
        self.assertGreaterEqual(len(units), 10)
        _json(f"/api/projects/{pid}", "DELETE")

    def test_quick_project_falls_back_to_a_style(self):
        """بدون سبک، برآورد نباید به «فقط اجرت» سقوط کند"""
        _, body = _json("/api/quick-project", "POST",
                        {"ground_lm": 3.6, "wall_lm": 3.0, "style_id": 0,
                         "title": "بدون سبک", "install_mode": "per_meter",
                         "install_value": 850_000})
        pid = int(body["project"]["id"])
        try:
            self.assertGreater(body["calc"]["total_cost"], 1_000_000)
            self.assertGreater(body["calc"]["stats"]["total_sheets"], 0)
            _, one = _json(f"/api/projects/{pid}")
            page = one["project"]["pages"][0]
            self.assertTrue(int(page.get("style_id") or 0) > 0,
                            "سبکِ برگشتی روی پروژه ثبت نشده")
        finally:
            _json(f"/api/projects/{pid}", "DELETE")

    def test_quick_project_requires_metres(self):
        status, body = _json("/api/quick-project", "POST", {"ground_lm": 0, "wall_lm": 0})
        self.assertEqual(status, 400)
        self.assertFalse(body.get("ok", True))

    def test_quick_project_respects_total_length(self):
        """جمع طول یونیت‌های زمینی ≈ متراژ ورودی"""
        _, body = _json("/api/quick-project", "POST",
                        {"ground_lm": 2.4, "wall_lm": 0, "title": "کنترل متراژ"})
        pid = int(body["project"]["id"])
        _, one = _json(f"/api/projects/{pid}")
        units = (one["project"]["pages"][0].get("units") or [])
        ground = sum(u["length_cm"] * int(u.get("qty") or 1)
                     for u in units if u["unit_type"] != "wall") / 100.0
        self.assertAlmostEqual(ground, 2.4, delta=0.7)
        _json(f"/api/projects/{pid}", "DELETE")

    # ------------------------------------------------------ الگوی یونیت (CRUD)
    def test_unit_template_crud(self):
        status, body = _json("/api/unit-templates")
        self.assertEqual(status, 200)
        self.assertIn("templates", body)
        before = len(body["templates"])

        status, body = _json("/api/unit-templates", "POST",
                             {"name": "زمینی ۹۰ دو لنگه", "note": "الگوی پرکاربرد",
                              "data": {"label": "زمینی ۹۰", "unit_type": "ground",
                                       "length_cm": 90, "height_cm": 72, "depth_cm": 55}})
        self.assertEqual(status, 200)
        tid = int(body["id"])
        self.assertEqual(len(body["templates"]), before + 1)
        self.assertEqual(body["templates"][-1]["data"]["length_cm"], 90)

        status, body = _json(f"/api/unit-templates/{tid}", "PUT",
                             {"name": "زمینی ۹۰ (ویرایش‌شده)"})
        self.assertEqual(status, 200)
        self.assertTrue(any(t["id"] == tid and "ویرایش" in t["name"]
                            for t in body["templates"]))

        status, body = _json(f"/api/unit-templates/{tid}", "DELETE")
        self.assertEqual(status, 200)
        self.assertFalse(any(t["id"] == tid for t in body["templates"]))

    def test_unit_template_requires_name_and_data(self):
        status, body = _json("/api/unit-templates", "POST", {"name": "", "data": {}})
        self.assertEqual(status, 400)
        status, body = _json("/api/unit-templates", "POST", {"name": "بی‌داده"})
        self.assertEqual(status, 400)

    def test_unit_template_missing_404(self):
        status, body = _json("/api/unit-templates/999999", "DELETE")
        self.assertEqual(status, 404)

    # ------------------------------------------------------- پیش‌پرداخت در وب
    def test_deposit_roundtrip_over_api(self):
        pid = self._make_project()
        _json(f"/api/projects/{pid}", "PUT",
              {"deposit_percent": 40, "pages": self._pages_with_units()})
        status, one = _json(f"/api/projects/{pid}")
        self.assertAlmostEqual(float(one["project"]["deposit_percent"]), 40.0, delta=0.01)

        status, calc = _json("/api/calc", "POST", {"project": {"id": pid}})
        self.assertEqual(status, 200)
        self.assertIn("deposit_amount", calc)
        self.assertIn("remaining_amount", calc)
        self.assertIn("price_per_ground_lm", calc)
        self.assertAlmostEqual(calc["deposit_amount"] + calc["remaining_amount"],
                               calc["final_price"], delta=1.0)
        self.assertAlmostEqual(calc["deposit_amount"], calc["final_price"] * 0.4, delta=1.0)
        _json(f"/api/projects/{pid}", "DELETE")

    def test_deposit_amount_field_roundtrip(self):
        """مبلغِ پیش‌پرداختِ ذخیره‌شده حتی وقتی کلاینت آن را نفرستد، اعمال می‌شود"""
        pid = self._make_project()
        _json(f"/api/projects/{pid}", "PUT",
              {"deposit_amount": 5_000_000, "pages": self._pages_with_units()})
        _, one = _json(f"/api/projects/{pid}")
        self.assertAlmostEqual(float(one["project"]["deposit_amount"]), 5_000_000.0, delta=1.0)
        _, calc = _json("/api/calc", "POST", {"project": {"id": pid}})
        self.assertGreater(calc["final_price"], 5_000_000.0)
        self.assertAlmostEqual(calc["deposit_amount"], 5_000_000.0, delta=1.0)
        self.assertAlmostEqual(calc["remaining_amount"],
                               calc["final_price"] - 5_000_000.0, delta=1.0)
        _json(f"/api/projects/{pid}", "DELETE")

    def test_deposit_reaches_invoice_preview(self):
        """پیش‌پرداخت در پیش‌نمایش فاکتور هم دیده می‌شود (نه فقط در محاسبه)"""
        pid = self._make_project()
        _json(f"/api/projects/{pid}", "PUT",
              {"deposit_percent": 30, "pages": self._pages_with_units()})
        status, data = _json("/api/invoice/preview", "POST", {"project": {"id": pid}})
        self.assertEqual(status, 200)
        tot = data["data"]["totals"]
        self.assertGreater(tot["deposit_amount"], 0)
        self.assertAlmostEqual(tot["deposit_amount"], tot["final_price"] * 0.3, delta=1.0)
        self.assertIn("باقی‌مانده", data["html"])
        self.assertIn("پیش‌پرداخت", data["html"])
        _json(f"/api/projects/{pid}", "DELETE")

    def test_bootstrap_exposes_unit_templates(self):
        status, body = _json("/api/bootstrap")
        self.assertEqual(status, 200)
        self.assertIn("unit_templates", body)
        self.assertIsInstance(body["unit_templates"], list)


if __name__ == "__main__":
    unittest.main()
