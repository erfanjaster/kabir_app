# -*- coding: utf-8 -*-
"""تست مهاجرت پایگاه‌داده و بازمحاسبه‌ی خودکار قیمت پروژه‌ها.

هر سناریو در یک زیرفرایند جدا اجرا می‌شود تا وضعیت ماژول‌ها
(KABIR_DATA_DIR و Database singleton) بین تست‌ها نشت نکند.

اجرا:  pytest tests/test_migration.py -v
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _make_old_db(db_path: Path) -> None:
    """ساخت پایگاه‌داده‌ی نسخه‌ی قدیمی (user_version=3، بدون rates_rev) با داده‌ی نمونه."""
    conn = sqlite3.connect(str(db_path))
    conn.executescript("""
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, name TEXT NOT NULL,
        unit TEXT DEFAULT 'piece', price REAL DEFAULT 0, sheet_width REAL DEFAULT 0,
        sheet_height REAL DEFAULT 0, thickness_mm REAL DEFAULT 0, width_cm REAL DEFAULT 0,
        supplier TEXT DEFAULT '', note TEXT DEFAULT '', active INTEGER DEFAULT 1,
        created_at TEXT, updated_at TEXT);
    CREATE TABLE price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, material_id INTEGER, old_price REAL,
        new_price REAL, change_pct REAL, reason TEXT, created_at TEXT);
    CREATE TABLE material_categories (
        id INTEGER PRIMARY KEY, key TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
        unit TEXT DEFAULT 'piece', sort_order INTEGER DEFAULT 0);
    CREATE TABLE styles (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, note TEXT DEFAULT '',
        data TEXT, sort_order INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
    CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, customer_name TEXT DEFAULT '',
        customer_phone TEXT DEFAULT '', customer_mobile TEXT DEFAULT '',
        customer_address TEXT DEFAULT '', title TEXT DEFAULT '', status TEXT DEFAULT 'draft',
        install_mode TEXT DEFAULT 'fixed', install_value REAL DEFAULT 0,
        profit_mode TEXT DEFAULT 'markup', profit_percent REAL DEFAULT 30,
        discount_percent REAL DEFAULT 0, discount_amount REAL DEFAULT 0,
        vat_enabled INTEGER DEFAULT 0, vat_percent REAL DEFAULT 10,
        extra_fixed_amount REAL DEFAULT 0, valid_until TEXT DEFAULT '', note TEXT DEFAULT '',
        final_price REAL DEFAULT 0, total_cost REAL DEFAULT 0,
        created_at TEXT, updated_at TEXT);
    CREATE TABLE pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
        name TEXT DEFAULT '', style_id INTEGER DEFAULT 0, data TEXT,
        sort_order INTEGER DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE);
    CREATE TABLE invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, number TEXT,
        kind TEXT DEFAULT 'quote', customer_name TEXT DEFAULT '', data TEXT,
        total REAL DEFAULT 0, created_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL);
    CREATE TABLE activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, message TEXT, created_at TEXT);
    PRAGMA user_version = 3;
    """)
    conn.execute(
        "INSERT INTO materials(category,name,unit,price,sheet_width,sheet_height,"
        "thickness_mm,width_cm,supplier,note,active,created_at,updated_at) "
        "VALUES('body_sheet','ورق تست','sheet',1000000,183,366,16,0,'','','1','','')")
    conn.execute(
        "INSERT INTO projects(code,title,status,profit_mode,profit_percent,install_mode,"
        "install_value,vat_enabled,vat_percent,final_price,total_cost,created_at,updated_at) "
        "VALUES('PR-OLD-001','پروژه‌ی قدیمی','open','markup',25,'none',0,0,10,1250000,1000000,'','')")
    conn.execute(
        "INSERT INTO pages(project_id,name,style_id,data,sort_order) VALUES(1,'بخش ۱',0,?,0)",
        (json.dumps({
            "name": "بخش ۱", "style_id": 0, "units": [{
                "label": "یونیت زمینی", "unit_type": "ground", "qty": 1,
                "length_cm": 90, "height_cm": 72, "depth_cm": 55, "shelves": 1,
                "body_id": 1, "doors": [], "drawers": [],
            }], "extras": [], "services": [], "detail_mode": "none", "detail_rows": [],
        }, ensure_ascii=False),))
    conn.commit()
    conn.close()


#: سناریوی اجرا در زیرفرایند — نتیجه به‌صورت JSON روی stdout
_SCENARIO = r"""
import json, sys
from kabir.data.db import Database
from kabir.data import dao
from kabir.data import recalc as rc
from kabir.data.migrate import migrate_conn, SCHEMA_VERSION

db = Database.instance()
out = {}
cols = [r[1] for r in db.conn.execute("PRAGMA table_info(projects)").fetchall()]
out["has_rates_rev"] = "rates_rev" in cols
out["user_version"] = db.conn.execute("PRAGMA user_version").fetchone()[0]
out["schema_version"] = SCHEMA_VERSION

p = dao.ProjectRepo(db).get(1)
out["title_kept"] = p["title"] == "پروژه‌ی قدیمی"
out["final_price_kept"] = float(p["final_price"]) == 1250000.0
out["pages_kept"] = len(dao.ProjectRepo(db).pages_of(1)) == 1
m = dao.MaterialRepo(db).get(1)
out["material_kept"] = (m is not None and m.name == "ورق تست")

# مهاجرت دوباره — باید بی‌اثر باشد
out["second_migration_notes"] = migrate_conn(db.conn)["notes"]

# پروژه‌ی قدیمی پس از مهاجرت → باید یک‌بار stale علامت بخورد (rev=1)
out["rev0"] = rc.current_prices_rev(db)
row = dao.ProjectRepo(db).get(1)
out["stale_after_migration"] = rc.project_is_stale(db, row)
rev = rc.bump_prices_rev(db)
row = dao.ProjectRepo(db).get(1)
out["stale_after_bump"] = rc.project_is_stale(db, row)
changed = rc.recalc_all_projects(db)
out["recalced_count"] = len(changed)
row = dao.ProjectRepo(db).get(1)
out["stale_after_recalc"] = rc.project_is_stale(db, row)
out["rates_rev"] = int(row["rates_rev"])
out["recalc_total_cost"] = float(row["total_cost"])
out["recalc_final_price"] = float(row["final_price"])
out["light"] = rc.light_projects(db)
print("RESULT:" + json.dumps(out, ensure_ascii=False))
"""


class TestMigration(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="kabir-mig-")
        self.db_path = Path(self.tmp) / "kabir.db"
        _make_old_db(self.db_path)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run_scenario(self):
        env = dict(os.environ)
        env["KABIR_DATA_DIR"] = self.tmp
        env["PYTHONIOENCODING"] = "utf-8"
        proc = subprocess.run(
            [sys.executable, "-c", _SCENARIO],
            cwd=str(ROOT), env=env, capture_output=True, text=True, timeout=120,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr[-2000:])
        marker = "RESULT:"
        idx = proc.stdout.rfind(marker)
        self.assertGreaterEqual(idx, 0, msg=proc.stdout[-1000:])
        return json.loads(proc.stdout[idx + len(marker):].strip().splitlines()[0])

    def test_migration_preserves_data_and_upgrades_schema(self):
        r = self._run_scenario()
        self.assertTrue(r["has_rates_rev"], "ستون rates_rev باید اضافه شود")
        self.assertEqual(r["user_version"], 4)
        self.assertEqual(r["schema_version"], 4)
        self.assertTrue(r["title_kept"], "عنوان پروژه‌ی قدیمی باید حفظ شود")
        self.assertTrue(r["final_price_kept"], "قیمت ذخیره‌شده پیش از بازمحاسبه حفظ شود")
        self.assertTrue(r["pages_kept"], "بخش‌های پروژه باید حفظ شوند")
        self.assertTrue(r["material_kept"], "متریال کاربر باید حفظ شود")
        self.assertEqual(r["second_migration_notes"], [], "مهاجرت باید توان‌دوس باشد")

    def test_stale_detection_and_auto_recalc(self):
        r = self._run_scenario()
        self.assertEqual(r["rev0"], 1, "مهاجرت باید prices_rev را برای دیتابیس قدیمی روی ۱ بگذارد")
        self.assertTrue(r["stale_after_migration"],
                        "پروژه‌های نسخه‌ی قدیمی باید پس از مهاجرت یک‌بار stale علامت بخورند")
        self.assertTrue(r["stale_after_bump"], "پس از تغییر نرخ هم پروژه باید stale بماند")
        self.assertEqual(r["recalced_count"], 1)
        self.assertFalse(r["stale_after_recalc"], "پس از بازمحاسبه نباید stale بماند")
        self.assertEqual(r["rates_rev"], 2)
        # قیمت با موتور واقعی و نرخ جاری بازمحاسبه شده (نه مقدار دستی قدیمی)
        self.assertNotEqual(r["recalc_final_price"], 0.0)
        self.assertEqual(r["light"][0]["stale"], False)

    def test_migrate_cli_runs(self):
        env = dict(os.environ)
        env["KABIR_DATA_DIR"] = self.tmp
        env["PYTHONIOENCODING"] = "utf-8"
        proc = subprocess.run(
            [sys.executable, "-m", "kabir.data.migrate", "--recalc"],
            cwd=str(ROOT), env=env, capture_output=True, text=True, timeout=120,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr[-2000:])
        self.assertIn("Migration finished successfully", proc.stdout)
        self.assertIn("Backup created", proc.stdout)
        # فایل پشتیبان پیش از مهاجرت ساخته شده
        self.assertTrue(list((Path(self.tmp) / "backups").glob("kabir-pre-update-*.db")))


class TestScriptsSanity(unittest.TestCase):
    """اسکریپت‌های ویندوز: بدون نویسه‌ی فارسی (ASCII خالص) و با پایان خط CRLF."""

    def test_bat_files_ascii_only(self):
        for name in ("install.bat", "run.bat", "run-web.bat", "update.bat"):
            raw = (ROOT / name).read_bytes()
            for i, byte in enumerate(raw):
                self.assertLess(byte, 128, f"{name} has non-ASCII byte at offset {i}")

    def test_bat_files_crlf(self):
        for name in ("install.bat", "run.bat", "run-web.bat", "update.bat"):
            raw = (ROOT / name).read_bytes()
            for ln in raw.split(b"\n")[:-1]:
                self.assertTrue(ln.endswith(b"\r"), f"{name} has LF-only line: {ln[:40]!r}")

    def test_bat_files_cd_to_script_dir(self):
        for name in ("install.bat", "update.bat"):
            text = (ROOT / name).read_text(encoding="ascii")
            self.assertIn("cd /d \"%~dp0\"", text,
                          f"{name} must cd to its own directory")

    def test_shell_scripts_executable_and_lf(self):
        for name in ("install.sh", "run.sh", "update.sh"):
            p = ROOT / name
            raw = p.read_bytes()
            self.assertNotIn(b"\r\n", raw, f"{name} should use LF endings")
            self.assertTrue(os.access(p, os.X_OK), f"{name} is not executable")

    def test_update_py_parses(self):
        proc = subprocess.run([sys.executable, "-m", "py_compile", str(ROOT / "update.py")],
                              capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)


if __name__ == "__main__":
    unittest.main()
