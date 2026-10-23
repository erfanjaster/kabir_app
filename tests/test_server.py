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


if __name__ == "__main__":
    unittest.main()
