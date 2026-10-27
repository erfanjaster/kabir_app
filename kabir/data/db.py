# -*- coding: utf-8 -*-
"""پایگاه‌داده‌ی SQLite — لایه‌ی اتصال، ساخت جداول و تنظیمات."""

from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from .. import config
from .migrate import SCHEMA_VERSION, migrate_conn

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS material_categories (
    id        INTEGER PRIMARY KEY,
    key       TEXT UNIQUE NOT NULL,
    title     TEXT NOT NULL,
    unit      TEXT DEFAULT 'piece',
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS materials (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    category      TEXT NOT NULL,
    name          TEXT NOT NULL,
    unit          TEXT DEFAULT 'piece',
    price         REAL DEFAULT 0,
    sheet_width   REAL DEFAULT 0,
    sheet_height  REAL DEFAULT 0,
    thickness_mm  REAL DEFAULT 0,
    width_cm      REAL DEFAULT 0,
    supplier      TEXT DEFAULT '',
    note          TEXT DEFAULT '',
    active        INTEGER DEFAULT 1,
    created_at    TEXT,
    updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_materials_cat ON materials(category);

CREATE TABLE IF NOT EXISTS price_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER,
    old_price   REAL,
    new_price   REAL,
    change_pct  REAL,
    reason      TEXT,
    created_at  TEXT
);

CREATE TABLE IF NOT EXISTS styles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    note       TEXT DEFAULT '',
    data       TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS projects (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT,
    customer_name TEXT DEFAULT '',
    customer_phone TEXT DEFAULT '',
    customer_mobile TEXT DEFAULT '',
    customer_address TEXT DEFAULT '',
    title         TEXT DEFAULT '',
    status        TEXT DEFAULT 'draft',
    install_mode  TEXT DEFAULT 'fixed',
    install_value REAL DEFAULT 0,
    profit_mode   TEXT DEFAULT 'markup',
    profit_percent REAL DEFAULT 30,
    discount_percent REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    vat_enabled   INTEGER DEFAULT 0,
    vat_percent   REAL DEFAULT 10,
    extra_fixed_amount REAL DEFAULT 0,
    deposit_percent REAL DEFAULT 0,
    deposit_amount REAL DEFAULT 0,
    valid_until   TEXT DEFAULT '',
    note          TEXT DEFAULT '',
    final_price   REAL DEFAULT 0,
    total_cost    REAL DEFAULT 0,
    rates_rev     INTEGER DEFAULT 0,
    created_at    TEXT,
    updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS pages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name       TEXT DEFAULT '',
    style_id   INTEGER DEFAULT 0,
    data       TEXT,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER,
    number      TEXT,
    kind        TEXT DEFAULT 'quote',
    customer_name TEXT DEFAULT '',
    data        TEXT,
    total       REAL DEFAULT 0,
    created_at  TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS unit_templates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    note       TEXT DEFAULT '',
    data       TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS activity_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT,
    message    TEXT,
    created_at TEXT
);
"""


class Database:
    """مدیر پایگاه‌داده (الگوی Singleton با قفل رشته‌ای)."""

    _instance: Optional["Database"] = None
    _lock = threading.RLock()

    def __init__(self, path: Optional[Path] = None):
        self.path = Path(path or config.DB_PATH)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._init_lock = threading.RLock()
        self._settings_cache: Dict[str, str] = {}
        self._connect()
        self._create_schema()
        self._load_settings_cache()

    # ------------------------------------------------------------------
    @classmethod
    def instance(cls, path: Optional[Path] = None) -> "Database":
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls(path)
            return cls._instance

    @classmethod
    def reset(cls) -> None:
        with cls._lock:
            cls._instance = None

    # ------------------------------------------------------------------
    def _connect(self) -> None:
        conn = sqlite3.connect(str(self.path), check_same_thread=False, timeout=20)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        self._conn = conn

    @property
    def conn(self) -> sqlite3.Connection:
        return self._conn

    @contextmanager
    def tx(self):
        """اجرای تراکنش اتمیک."""
        with self._init_lock:
            try:
                yield self._conn
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise

    def q(self, sql: str, params: Iterable = ()) -> List[sqlite3.Row]:
        with self._init_lock:
            cur = self._conn.execute(sql, tuple(params))
            rows = cur.fetchall()
            cur.close()
            return rows

    def one(self, sql: str, params: Iterable = ()) -> Optional[sqlite3.Row]:
        rows = self.q(sql, params)
        return rows[0] if rows else None

    def scalar(self, sql: str, params: Iterable = (), default=None):
        row = self.one(sql, params)
        if row is None:
            return default
        return row[0]

    def execute(self, sql: str, params: Iterable = ()) -> int:
        with self.tx() as conn:
            cur = conn.execute(sql, tuple(params))
            return cur.lastrowid or cur.rowcount

    def executemany(self, sql: str, seq: Iterable[Iterable]) -> None:
        with self.tx() as conn:
            conn.executemany(sql, [tuple(x) for x in seq])

    # ------------------------------------------------------------------
    def _create_schema(self) -> None:
        with self.tx() as conn:
            conn.executescript(SCHEMA)
        # مهاجرت گام‌به‌گام و امن — داده‌های موجود هرگز حذف نمی‌شوند
        result = migrate_conn(self._conn)
        if result["notes"]:
            self.log("migrate", "؛ ".join(result["notes"]))

    # ------------------------------------------------------------------
    # تنظیمات
    # ------------------------------------------------------------------
    def _load_settings_cache(self) -> None:
        self._settings_cache = {
            k: v for k, v in dict(config.DEFAULT_SETTINGS).items()
        }
        for row in self.q("SELECT key, value FROM settings"):
            self._settings_cache[row["key"]] = row["value"] or ""

    def get_setting(self, key: str, default: Any = "") -> str:
        if key in self._settings_cache:
            return self._settings_cache[key]
        row = self.one("SELECT value FROM settings WHERE key=?", (key,))
        val = row["value"] if row else str(default if default is not None else "")
        self._settings_cache[key] = val or ""
        return self._settings_cache[key]

    def get_num(self, key: str, default: float = 0.0) -> float:
        try:
            return float(self.get_setting(key, default))
        except (TypeError, ValueError):
            return float(default)

    def get_bool(self, key: str, default: bool = False) -> bool:
        return str(self.get_setting(key, "1" if default else "0")).strip() in ("1", "true", "True", "yes")

    def set_setting(self, key: str, value: Any) -> None:
        value = "" if value is None else str(value)
        self.execute(
            "INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (key, value, datetime.now().isoformat(timespec="seconds")),
        )
        self._settings_cache[key] = value

    def set_settings(self, mapping: Dict[str, Any]) -> None:
        for k, v in mapping.items():
            self.set_setting(k, v)

    def all_settings(self) -> Dict[str, str]:
        self._load_settings_cache()
        return dict(self._settings_cache)

    # ------------------------------------------------------------------
    def log(self, kind: str, message: str) -> None:
        try:
            self.execute("INSERT INTO activity_log(kind,message,created_at) VALUES(?,?,?)",
                         (kind, message, datetime.now().isoformat(timespec="seconds")))
        except Exception:                      # noqa: BLE001
            pass

    def dump_settings_json(self) -> str:
        return json.dumps(self.all_settings(), ensure_ascii=False, indent=2)
