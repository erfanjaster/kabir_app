# -*- coding: utf-8 -*-
"""
مهاجرت پایگاه‌داده — ارتقای امن طرح (Schema) بدون از دست رفتن داده
====================================================================
هنگام به‌روزرسانی نرم‌افزار، ساختار پایگاه‌داده ممکن است تغییر کند.
این ماژول مهاجرت‌ها را به‌صورت **گام‌به‌گام و توان‌دوس (idempotent)**
اعمال می‌کند تا داده‌های کاربر (پروژه‌ها، متریال‌ها، فاکتورها و تنظیمات)
دست‌نخورده باقی بماند.

هر مهاجرت باید:
  * فقط بر اساس «نسخه‌ی فعلی» (PRAGMA user_version) اجرا شود؛
  * در برابر اجرای دوباره مقاوم باشد (بررسی وجود ستون/جدول پیش از تغییر)؛
  * هیچ داده‌ای را حذف نکند (فقط افزودن ستون/جدول یا مقداردهی پیش‌فرض).

اجرای دستی (مثلاً از اسکریپت‌های به‌روزرسانی):
    python -m kabir.data.migrate            # پشتیبان + مهاجرت
    python -m kabir.data.migrate --recalc   # + بازمحاسبه‌ی قیمت پروژه‌ها
"""

from __future__ import annotations

import sqlite3
from typing import Any, Callable, Dict, List

# آخرین نسخه‌ی طرح پایگاه‌داده.
# 3 → نسخه‌های ۲٫۱٫۰ و قبل‌تر
# 4 → افزودن projects.rates_rev (نسخه‌ی نرخ‌های متریال هنگام آخرین محاسبه)
#      و کلید تنظیمات prices_rev برای تشخیص «پروژه‌ی مانده با نرخ قدیمی»
SCHEMA_VERSION = 4


# ---------------------------------------------------------------------------
# ابزارها
# ---------------------------------------------------------------------------

def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    return row is not None


def column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    if not table_exists(conn, table):
        return False
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    return column in cols


def user_version(conn: sqlite3.Connection) -> int:
    try:
        return int(conn.execute("PRAGMA user_version").fetchone()[0] or 0)
    except (sqlite3.Error, TypeError, ValueError):
        return 0


# ---------------------------------------------------------------------------
# مهاجرت‌ها — هر ورودی: نسخه‌ی مقصد → فهرست توابع
# ---------------------------------------------------------------------------

def _m4_add_rates_rev(conn: sqlite3.Connection) -> List[str]:
    """
    افزودن ستون rates_rev به جدول projects (بدون دست‌زدن به داده‌ها).

    همچنین برای پایگاه‌های داده‌ای که از نسخه‌های قدیمی مهاجرت می‌شوند و
    پروژه‌ی ذخیره‌شده دارند، prices_rev روی ۱ مقداردهی می‌شود تا آن پروژه‌ها
    یک‌بار «نیازمند بازمحاسبه با نرخ روز» علامت بخورند (نسخه‌های قدیمی
    نسخه‌ی نرخ‌ها را ثبت نمی‌کردند، پس قابل استنتاج نیست).
    """
    notes: List[str] = []
    if table_exists(conn, "projects") and not column_exists(conn, "projects", "rates_rev"):
        conn.execute("ALTER TABLE projects ADD COLUMN rates_rev INTEGER DEFAULT 0")
        notes.append("projects.rates_rev column added")
    if table_exists(conn, "settings") and table_exists(conn, "projects"):
        n_projects = conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
        has_rev = conn.execute(
            "SELECT 1 FROM settings WHERE key='prices_rev'").fetchone()
        if n_projects and not has_rev:
            from datetime import datetime
            conn.execute(
                "INSERT INTO settings(key,value,updated_at) VALUES('prices_rev','1',?)",
                (datetime.now().isoformat(timespec="seconds"),))
            notes.append("prices_rev initialized - existing projects flagged for one recalculation")
    return notes


MIGRATIONS: Dict[int, List[Callable[[sqlite3.Connection], List[str]]]] = {
    4: [_m4_add_rates_rev],
}


# ---------------------------------------------------------------------------
# اجرای مهاجرت
# ---------------------------------------------------------------------------

def migrate_conn(conn: sqlite3.Connection) -> Dict[str, Any]:
    """
    اجرای همه‌ی مهاجرت‌های لازم روی یک اتصال SQLite.

    خروجی: {"from": نسخه‌ی قبلی, "to": نسخه‌ی جدید, "notes": [...]}
    این تابع توان‌دوس است؛ اگر پایگاه‌داده از قبل به‌روز باشد هیچ کاری نمی‌کند.
    """
    old_ver = user_version(conn)
    notes: List[str] = []
    for ver in range(old_ver + 1, SCHEMA_VERSION + 1):
        for fn in MIGRATIONS.get(ver, []):
            notes.extend(fn(conn) or [])
    if old_ver != SCHEMA_VERSION:
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    conn.commit()
    return {"from": old_ver, "to": SCHEMA_VERSION, "notes": notes}


def backup_before_migrate() -> str:
    """
    پشتیبان‌گیری از فایل پایگاه‌داده پیش از مهاجرت (بدون نیاز به Database).

    اگر پایگاه‌داده وجود نداشته باشد (نصب تازه) بدون خطا رد می‌شود.
    خروجی: مسیر فایل پشتیبان یا رشته‌ی خالی.
    """
    from .. import config
    src_path = config.DB_PATH
    if not src_path.exists():
        return ""
    config.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    from datetime import datetime
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = config.BACKUP_DIR / f"kabir-pre-update-{stamp}.db"
    src = sqlite3.connect(str(src_path))
    try:
        dst = sqlite3.connect(str(target))
        try:
            with dst:
                src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    return str(target)


# ---------------------------------------------------------------------------
# CLI — مورد استفاده‌ی اسکریپت‌های به‌روزرسانی (update.bat / update.sh)
# ---------------------------------------------------------------------------

def main(argv: List[str] | None = None) -> int:
    import argparse

    ap = argparse.ArgumentParser(
        prog="python -m kabir.data.migrate",
        description="Kabir database migration (safe, non-destructive).",
    )
    ap.add_argument("--no-backup", action="store_true",
                    help="skip creating a pre-migration backup")
    ap.add_argument("--recalc", action="store_true",
                    help="recalculate all project prices with current material rates")
    args = ap.parse_args(argv)

    # خروجی کنسول به انگشتی/انگلیسی تا در همه‌ی ترمینال‌ها (از جمله cmd ویندوز)
    # بدون مشکل نمایش داده شود.
    print("Kabir - database migration")
    print("--------------------------")

    if not args.no_backup:
        path = backup_before_migrate()
        if path:
            print(f"[OK]      Backup created: {path}")
        else:
            print("[INFO]    No existing database found - nothing to back up (fresh install).")

    from .db import Database
    from .. import config

    db = Database.instance()          # مهاجرت داخل سازنده اعمال می‌شود
    print(f"[OK]      Database: {db.path}")
    print(f"[OK]      Schema version: {user_version(db.conn)} (target {SCHEMA_VERSION})")
    print(f"[INFO]    Data directory: {config.data_dir()}")

    counts = {
        "projects": db.scalar("SELECT COUNT(*) FROM projects", default=0),
        "materials": db.scalar("SELECT COUNT(*) FROM materials", default=0),
        "invoices": db.scalar("SELECT COUNT(*) FROM invoices", default=0),
    }
    print(f"[OK]      Data kept intact: {counts['projects']} projects, "
          f"{counts['materials']} materials, {counts['invoices']} invoices.")

    if args.recalc:
        from .recalc import recalc_all_projects
        changed = recalc_all_projects(db)
        print(f"[OK]      Recalculated {len(changed)} project(s) with current material rates.")

    print("[DONE]    Migration finished successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
