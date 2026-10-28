# -*- coding: utf-8 -*-
"""پشتیبان‌گیری خودکار و دستی + بازیابی + ورود/خروج JSON."""

from __future__ import annotations

import json
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .. import config
from .db import Database


def _stamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def create_backup(db: Optional[Database] = None, folder: Optional[Path] = None,
                  tag: str = "manual") -> Tuple[bool, str]:
    """ساخت نسخه‌ی پشتیبان با استفاده از API امنِ sqlite (backup)."""
    db = db or Database.instance()
    folder = Path(folder or config.BACKUP_DIR)
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"kabir-{tag}-{_stamp()}.db"
    try:
        src = sqlite3.connect(str(db.path))
        dst = sqlite3.connect(str(target))
        with dst:
            src.backup(dst)
        dst.close()
        src.close()
        return True, str(target)
    except Exception as exc:                   # noqa: BLE001
        return False, f"خطا در پشتیبان‌گیری: {exc}"


def auto_backup_if_needed(db: Optional[Database] = None) -> Optional[str]:
    """اگر از آخرین پشتیبان روزانه گذشته باشد، یکی می‌سازد."""
    db = db or Database.instance()
    if not db.get_bool("auto_backup", True):
        return None
    keep = max(1, int(db.get_num("backup_keep", 30)))
    today = datetime.now().strftime("%Y%m%d")
    existing = sorted(config.BACKUP_DIR.glob(f"kabir-auto-{today}*.db"))
    if existing:
        return str(existing[-1])
    ok, path = create_backup(db, tag="auto")
    if ok:
        prune_backups(keep)
        return path
    return None


def list_backups() -> List[Dict[str, Any]]:
    out = []
    for p in sorted(config.BACKUP_DIR.glob("kabir-*.db"), reverse=True):
        st = p.stat()
        out.append({
            "path": p, "name": p.name, "size": st.st_size,
            "mtime": datetime.fromtimestamp(st.st_mtime),
        })
    return out


def prune_backups(keep: int = 30) -> int:
    files = sorted(config.BACKUP_DIR.glob("kabir-*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    removed = 0
    for p in files[max(1, keep):]:
        try:
            p.unlink()
            removed += 1
        except OSError:
            pass
    return removed


def restore_backup(backup_path: Path, db: Optional[Database] = None) -> Tuple[bool, str]:
    """بازیابی یک نسخه‌ی پشتیبان (ابتدا از وضعیت فعلی پشتیبان می‌گیرد)."""
    db = db or Database.instance()
    backup_path = Path(backup_path)
    if not backup_path.exists():
        return False, "فایل پشتیبان پیدا نشد."
    ok, safety = create_backup(db, tag="before-restore")
    if not ok:
        return False, safety
    try:
        try:
            db.conn.close()
        except Exception:                      # noqa: BLE001
            pass
        for suffix in ("", "-wal", "-shm"):
            p = Path(str(db.path) + suffix)
            if p.exists():
                p.unlink()
        shutil.copy2(backup_path, db.path)
        Database.reset()
        Database.instance()
        return True, f"بازیابی انجام شد. نسخه‌ی قبلی در: {safety}"
    except Exception as exc:                   # noqa: BLE001
        return False, f"خطا در بازیابی: {exc}"


# ---------------------------------------------------------------------------
# خروجی / ورود JSON (برای انتقال بین سیستم‌ها)
# ---------------------------------------------------------------------------

def export_json(path: Path, db: Optional[Database] = None) -> Tuple[bool, str]:
    db = db or Database.instance()
    payload = {
        "app": config.APP_NAME_EN,
        "version": config.APP_VERSION,
        "exported_at": datetime.now().isoformat(timespec="seconds"),
        "settings": db.all_settings(),
        "tables": {},
    }
    # ⚠ unit_templates هم صادر می‌شود — پیش‌تر در خروجی جا می‌ماند و هنگام
    #   انتقال داده بین سیستم‌ها، الگوهای یونیت بی‌صدا از دست می‌رفتند.
    for table in ("material_categories", "materials", "styles", "projects",
                  "pages", "invoices", "unit_templates"):
        payload["tables"][table] = [dict(r) for r in db.q(f"SELECT * FROM {table}")]
    try:
        Path(path).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return True, str(path)
    except Exception as exc:                   # noqa: BLE001
        return False, f"خطا در خروجی: {exc}"


def import_json(path: Path, replace: bool = True, db: Optional[Database] = None) -> Tuple[bool, str]:
    """
    ورود داده از فایل JSON.
    replace=True  → داده‌های فعلی جایگزین می‌شوند
    replace=False → فقط رکوردهای جدید اضافه می‌شوند (بدون حذف)

    ★ ستون‌های ناشناخته (مثلاً از نسخه‌های قدیمی/جدیدتر) به‌جای پرتابِ خطای
      خام، با طرحِ فعلی پایگاه‌داده مقایسه و فیلتر می‌شوند و هر خطا با پیامِ
      تمیز برمی‌گردد (تراکنش به‌طور کامل rollback می‌شود).
    """
    db = db or Database.instance()
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception as exc:                   # noqa: BLE001
        return False, f"فایل نامعتبر: {exc}"

    if not isinstance(payload, dict):
        return False, "ساختار فایل نامعتبر است (باید یک شیء JSON باشد)."

    tables = payload.get("tables", {})
    if not isinstance(tables, dict) or not tables:
        return False, "هیچ داده‌ای در فایل پیدا نشد."

    allowed_tables = ("material_categories", "materials", "styles",
                      "projects", "pages", "invoices", "unit_templates")
    # ستون‌های واقعی هر جدول در طرحِ فعلی
    columns: Dict[str, set] = {}
    for t in allowed_tables:
        try:
            cols = db.q(f"PRAGMA table_info({t})")
            columns[t] = {r[1] for r in cols}
        except Exception:                      # noqa: BLE001
            columns[t] = set()

    create_backup(db, tag="before-import")
    inserted = 0
    skipped_cols = 0
    try:
        with db.tx() as conn:
            for table, rows in tables.items():
                if table not in allowed_tables or not isinstance(rows, list):
                    continue
                known = columns.get(table) or set()
                if replace and rows:
                    conn.execute(f"DELETE FROM {table}")
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    cols = [k for k in row.keys() if k in known]
                    skipped_cols += len(row) - len(cols)
                    if not cols:
                        continue
                    verb = "INSERT OR REPLACE" if replace else "INSERT OR IGNORE"
                    conn.execute(
                        f"{verb} INTO {table}({','.join(cols)}) VALUES({','.join(['?'] * len(cols))})",
                        [row[c] for c in cols])
                    inserted += 1
    except Exception as exc:                   # noqa: BLE001
        return False, f"ورود داده ناموفق بود (تغییری اعمال نشد): {exc}"
    for k, v in (payload.get("settings") or {}).items():
        if k not in ("first_run_done",):
            db.set_setting(k, v)
    msg = f"{inserted} رکورد وارد شد."
    if skipped_cols:
        msg += f" ({skipped_cols} ستونِ ناشناخته با طرح فعلی نادیده گرفته شد)"
    return True, msg
