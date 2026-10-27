# -*- coding: utf-8 -*-
"""لایه‌ی دسترسی به داده (DAO) — CRUD برای متریال، سبک، پروژه و فاکتور."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from ..core.costing import Material, Page
from . import seed
from .db import Database


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


# ===========================================================================
# راه‌اندازی اولیه
# ===========================================================================

def bootstrap(db: Optional[Database] = None) -> bool:
    """اگر پایگاه‌داده خالی بود، دسته‌ها و متریال‌های نمونه را درج می‌کند."""
    db = db or Database.instance()
    first_run = db.get_bool("first_run_done", False)
    n_cat = db.scalar("SELECT COUNT(*) FROM material_categories", default=0) or 0
    n_mat = db.scalar("SELECT COUNT(*) FROM materials", default=0) or 0
    if n_cat == 0:
        db.executemany(
            "INSERT OR IGNORE INTO material_categories(key,title,unit,sort_order) VALUES(?,?,?,?)",
            [(k, t, u, s) for k, t, u, s in seed.CATEGORIES],
        )
    if n_mat == 0:
        db.executemany(
            "INSERT INTO materials(category,name,unit,price,sheet_width,sheet_height,"
            "thickness_mm,width_cm,supplier,note,active,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?)",
            [(m[1], m[0], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], _now(), _now())
             for m in seed.MATERIALS],
        )
    n_styles = db.scalar("SELECT COUNT(*) FROM styles", default=0) or 0
    if n_styles == 0:
        for i, st in enumerate(seed.SAMPLE_STYLES):
            db.execute(
                "INSERT INTO styles(name,note,data,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                (st["name"], st.get("note", ""), json.dumps(st["data"], ensure_ascii=False),
                 i, _now(), _now()),
            )
    if not first_run:
        db.set_setting("first_run_done", "1")
    return not first_run


# ===========================================================================
# دسته‌بندی‌ها
# ===========================================================================

class CategoryRepo:
    def __init__(self, db: Optional[Database] = None):
        self.db = db or Database.instance()

    def all(self) -> List[Dict[str, Any]]:
        return [dict(r) for r in self.db.q(
            "SELECT * FROM material_categories ORDER BY sort_order, id")]

    def labels(self) -> Dict[str, str]:
        return {r["key"]: r["title"] for r in self.db.q("SELECT key,title FROM material_categories")}

    def add(self, key: str, title: str, unit: str = "piece") -> int:
        return self.db.execute(
            "INSERT OR IGNORE INTO material_categories(key,title,unit,sort_order) VALUES(?,?,?,?)",
            (key, title, unit, 99))

    def rename(self, key: str, title: str) -> None:
        self.db.execute("UPDATE material_categories SET title=? WHERE key=?", (title, key))


# ===========================================================================
# متریال و خدمات
# ===========================================================================

class MaterialRepo:
    def __init__(self, db: Optional[Database] = None):
        self.db = db or Database.instance()
        self.cats = CategoryRepo(self.db)

    # --- خواندن ---
    def all(self, active_only: bool = False) -> List[Material]:
        sql = "SELECT * FROM materials"
        if active_only:
            sql += " WHERE active=1"
        sql += " ORDER BY category, name"
        return [self._to_obj(r) for r in self.db.q(sql)]

    def by_category(self, category: str, active_only: bool = True) -> List[Material]:
        sql = "SELECT * FROM materials WHERE category=?"
        if active_only:
            sql += " AND active=1"
        sql += " ORDER BY name"
        return [self._to_obj(r) for r in self.db.q(sql, (category,))]

    def get(self, mid: int) -> Optional[Material]:
        row = self.db.one("SELECT * FROM materials WHERE id=?", (mid,))
        return self._to_obj(row) if row else None

    def find_by_name(self, name: str, category: Optional[str] = None) -> Optional[Material]:
        if category:
            row = self.db.one("SELECT * FROM materials WHERE name=? AND category=?", (name, category))
        else:
            row = self.db.one("SELECT * FROM materials WHERE name=?", (name,))
        return self._to_obj(row) if row else None

    def search(self, text: str) -> List[Material]:
        like = f"%{text}%"
        return [self._to_obj(r) for r in self.db.q(
            "SELECT * FROM materials WHERE name LIKE ? OR note LIKE ? OR supplier LIKE ? "
            "ORDER BY category, name", (like, like, like))]

    def categories_with_counts(self) -> List[Dict[str, Any]]:
        rows = self.db.q(
            "SELECT c.key, c.title, c.unit, COUNT(m.id) AS cnt, COALESCE(SUM(m.active),0) AS act "
            "FROM material_categories c LEFT JOIN materials m ON m.category=c.key "
            "GROUP BY c.key ORDER BY c.sort_order, c.id")
        return [dict(r) for r in rows]

    @staticmethod
    def _to_obj(row) -> Material:
        return Material(
            id=row["id"], name=row["name"], category=row["category"], unit=row["unit"],
            price=float(row["price"] or 0), sheet_width_cm=float(row["sheet_width"] or 0),
            sheet_height_cm=float(row["sheet_height"] or 0), thickness_mm=float(row["thickness_mm"] or 0),
            width_cm=float(row["width_cm"] or 0), note=row["note"] or "",
            supplier=row["supplier"] or "",
        )

    # --- نوشتن ---
    def add(self, m: Material) -> int:
        return self.db.execute(
            "INSERT INTO materials(category,name,unit,price,sheet_width,sheet_height,"
            "thickness_mm,width_cm,supplier,note,active,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?)",
            (m.category, m.name, m.unit, m.price, m.sheet_width_cm, m.sheet_height_cm,
             m.thickness_mm, m.width_cm, getattr(m, "supplier", ""), m.note, _now(), _now()))

    def update(self, m: Material) -> None:
        old = self.get(m.id)
        self.db.execute(
            "UPDATE materials SET category=?, name=?, unit=?, price=?, sheet_width=?, "
            "sheet_height=?, thickness_mm=?, width_cm=?, supplier=?, note=?, updated_at=? WHERE id=?",
            (m.category, m.name, m.unit, m.price, m.sheet_width_cm, m.sheet_height_cm,
             m.thickness_mm, m.width_cm, getattr(m, "supplier", ""), m.note, _now(), m.id))
        if old and abs(float(old.price) - float(m.price)) > 0.001:
            self.log_price(m.id, float(old.price), float(m.price), "ویرایش دستی")

    def set_price(self, mid: int, price: float, reason: str = "تغییر قیمت") -> None:
        old = self.get(mid)
        self.db.execute("UPDATE materials SET price=?, updated_at=? WHERE id=?", (price, _now(), mid))
        if old:
            self.log_price(mid, float(old.price), float(price), reason)

    def log_price(self, mid: int, old: float, new: float, reason: str = "") -> None:
        pct = ((new - old) / old * 100.0) if old else 0.0
        self.db.execute(
            "INSERT INTO price_history(material_id,old_price,new_price,change_pct,reason,created_at) "
            "VALUES(?,?,?,?,?,?)", (mid, old, new, pct, reason, _now()))

    def bulk_change_price(self, category: Optional[str], percent: float,
                          only_ids: Optional[List[int]] = None, reason: str = "به‌روزرسانی دسته‌جمعی") -> int:
        """افزایش/کاهش درصدی قیمت‌ها — با ثبت تاریخچه."""
        rows = self.all()
        count = 0
        for m in rows:
            if only_ids is not None and m.id not in only_ids:
                continue
            if category and m.category != category:
                continue
            new_price = round(float(m.price) * (1 + percent / 100.0), 2)
            self.set_price(m.id, new_price, reason)
            count += 1
        return count

    def toggle_active(self, mid: int) -> bool:
        cur = self.db.scalar("SELECT active FROM materials WHERE id=?", (mid,), 1)
        new = 0 if cur else 1
        self.db.execute("UPDATE materials SET active=?, updated_at=? WHERE id=?", (new, _now(), mid))
        return bool(new)

    def delete(self, mid: int) -> None:
        self.db.execute("DELETE FROM price_history WHERE material_id=?", (mid,))
        self.db.execute("DELETE FROM materials WHERE id=?", (mid,))

    def history(self, mid: Optional[int] = None, limit: int = 200) -> List[Dict[str, Any]]:
        sql = ("SELECT h.*, m.name AS material_name FROM price_history h "
               "LEFT JOIN materials m ON m.id=h.material_id ")
        params: tuple = ()
        if mid:
            sql += "WHERE h.material_id=? "
            params = (mid,)
        sql += "ORDER BY h.id DESC LIMIT ?"
        return [dict(r) for r in self.db.q(sql, params + (limit,))]

    def duplicates(self) -> List[Dict[str, Any]]:
        rows = self.db.q("SELECT name, category, COUNT(*) c FROM materials "
                         "GROUP BY name, category HAVING c > 1")
        return [dict(r) for r in rows]


# ===========================================================================
# سبک‌های پروژه
# ===========================================================================

class StyleRepo:
    def __init__(self, db: Optional[Database] = None):
        self.db = db or Database.instance()

    def all(self) -> List[Dict[str, Any]]:
        out = []
        for r in self.db.q("SELECT * FROM styles ORDER BY sort_order, name"):
            d = dict(r)
            try:
                d["data"] = json.loads(d.get("data") or "{}")
            except json.JSONDecodeError:
                d["data"] = {}
            out.append(d)
        return out

    def get(self, sid: int) -> Optional[Dict[str, Any]]:
        r = self.db.one("SELECT * FROM styles WHERE id=?", (sid,))
        if not r:
            return None
        d = dict(r)
        try:
            d["data"] = json.loads(d.get("data") or "{}")
        except json.JSONDecodeError:
            d["data"] = {}
        return d

    def count(self) -> int:
        return int(self.db.scalar("SELECT COUNT(*) FROM styles", default=0) or 0)

    def add(self, name: str, data: Dict[str, Any], note: str = "") -> int:
        return self.db.execute(
            "INSERT INTO styles(name,note,data,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?)",
            (name, note, json.dumps(data, ensure_ascii=False), self.count(), _now(), _now()))

    def update(self, sid: int, name: str, data: Dict[str, Any], note: str = "") -> None:
        self.db.execute(
            "UPDATE styles SET name=?, note=?, data=?, updated_at=? WHERE id=?",
            (name, note, json.dumps(data, ensure_ascii=False), _now(), sid))

    def duplicate(self, sid: int) -> Optional[int]:
        st = self.get(sid)
        if not st:
            return None
        return self.add(f"{st['name']} (کپی)", st["data"], st.get("note", ""))

    def delete(self, sid: int) -> None:
        self.db.execute("DELETE FROM styles WHERE id=?", (sid,))


# ===========================================================================
# پروژه‌ها و صفحه‌ها
# ===========================================================================

class ProjectRepo:
    def __init__(self, db: Optional[Database] = None):
        self.db = db or Database.instance()

    # --- پروژه ---
    def all(self) -> List[Dict[str, Any]]:
        return [dict(r) for r in self.db.q("SELECT * FROM projects ORDER BY id DESC")]

    def get(self, pid: int) -> Optional[Dict[str, Any]]:
        r = self.db.one("SELECT * FROM projects WHERE id=?", (pid,))
        return dict(r) if r else None

    def create(self, data: Dict[str, Any]) -> int:
        cols = ["code", "customer_name", "customer_phone", "customer_mobile", "customer_address",
                "title", "status", "install_mode", "install_value", "profit_mode", "profit_percent",
                "discount_percent", "discount_amount", "vat_enabled", "vat_percent",
                "extra_fixed_amount", "deposit_percent", "deposit_amount",
                "valid_until", "note", "final_price", "total_cost", "rates_rev"]
        vals = [data.get(c) for c in cols]
        vals[0] = vals[0] or self.next_code()
        if vals[-1] is None:
            vals[-1] = 0
        sql = (f"INSERT INTO projects({','.join(cols)},created_at,updated_at) "
               f"VALUES({','.join(['?'] * len(cols))},?,?)")
        pid = self.db.execute(sql, vals + [_now(), _now()])
        return int(pid)

    def update(self, pid: int, data: Dict[str, Any]) -> None:
        allowed = ["code", "customer_name", "customer_phone", "customer_mobile", "customer_address",
                   "title", "status", "install_mode", "install_value", "profit_mode", "profit_percent",
                   "discount_percent", "discount_amount", "vat_enabled", "vat_percent",
                   "extra_fixed_amount", "deposit_percent", "deposit_amount",
                   "valid_until", "note", "final_price", "total_cost", "rates_rev"]
        sets, vals = [], []
        for k in allowed:
            if k in data:
                sets.append(f"{k}=?")
                vals.append(data[k])
        if not sets:
            return
        sets.append("updated_at=?")
        vals += [_now(), pid]
        self.db.execute(f"UPDATE projects SET {','.join(sets)} WHERE id=?", vals)

    def delete(self, pid: int) -> None:
        self.db.execute("DELETE FROM pages WHERE project_id=?", (pid,))
        self.db.execute("DELETE FROM invoices WHERE project_id=?", (pid,))
        self.db.execute("DELETE FROM projects WHERE id=?", (pid,))

    def duplicate(self, pid: int) -> Optional[int]:
        p = self.get(pid)
        if not p:
            return None
        new = dict(p)
        new.pop("id", None)
        new["code"] = self.next_code()
        new["title"] = f"{p.get('title') or ''} (کپی)".strip()
        new["status"] = "draft"
        new_id = self.create(new)
        for pg in self.pages_of(pid):
            self.add_page(new_id, pg["name"], pg.get("style_id", 0),
                          json.loads(pg.get("data") or "{}"), pg.get("sort_order", 0))
        return new_id

    def next_code(self) -> str:
        n = int(self.db.scalar("SELECT COUNT(*) FROM projects", default=0) or 0) + 1
        from ..core.persian import jdate_str
        return f"PR-{jdate_str(persian=False).replace('/', '')}-{n:03d}"

    # --- صفحه‌ها ---
    def pages_of(self, pid: int) -> List[Dict[str, Any]]:
        return [dict(r) for r in self.db.q(
            "SELECT * FROM pages WHERE project_id=? ORDER BY sort_order, id", (pid,))]

    def add_page(self, pid: int, name: str, style_id: int = 0,
                 data: Optional[Dict[str, Any]] = None, sort_order: int = 0) -> int:
        return int(self.db.execute(
            "INSERT INTO pages(project_id,name,style_id,data,sort_order) VALUES(?,?,?,?,?)",
            (pid, name, style_id, json.dumps(data or {}, ensure_ascii=False), sort_order)))

    def save_page(self, page_id: int, name: str, style_id: int, data: Dict[str, Any]) -> None:
        self.db.execute(
            "UPDATE pages SET name=?, style_id=?, data=? WHERE id=?",
            (name, style_id, json.dumps(data, ensure_ascii=False), page_id))

    def get_page(self, page_id: int) -> Optional[Dict[str, Any]]:
        r = self.db.one("SELECT * FROM pages WHERE id=?", (page_id,))
        return dict(r) if r else None

    def delete_page(self, page_id: int) -> None:
        self.db.execute("DELETE FROM pages WHERE id=?", (page_id,))

    def reorder_pages(self, pid: int, ordered_ids: List[int]) -> None:
        for i, pgid in enumerate(ordered_ids):
            self.db.execute("UPDATE pages SET sort_order=? WHERE id=? AND project_id=?", (i, pgid, pid))

    # --- بارگذاری کامل به آبجکت ---
    def load_pages(self, pid: int) -> List[Page]:
        out: List[Page] = []
        for row in self.pages_of(pid):
            try:
                data = json.loads(row.get("data") or "{}")
            except json.JSONDecodeError:
                data = {}
            data["id"] = row["id"]
            data["project_id"] = row["project_id"]
            data["name"] = row.get("name") or data.get("name") or "بخش"
            data["style_id"] = row.get("style_id") or 0
            out.append(Page.from_dict(data))
        return out

    def save_page_obj(self, page: Page) -> None:
        data = page.to_dict()
        if page.id:
            self.save_page(page.id, page.name, page.style_id, data)
        else:
            page.id = self.add_page(page.project_id, page.name, page.style_id, data)

    # --- آمار ---
    def stats(self) -> Dict[str, Any]:
        total = int(self.db.scalar("SELECT COUNT(*) FROM projects", default=0) or 0)
        done = int(self.db.scalar("SELECT COUNT(*) FROM projects WHERE status='done'", default=0) or 0)
        sum_price = float(self.db.scalar(
            "SELECT COALESCE(SUM(final_price),0) FROM projects", default=0) or 0)
        sum_cost = float(self.db.scalar(
            "SELECT COALESCE(SUM(total_cost),0) FROM projects", default=0) or 0)
        n_mat = int(self.db.scalar("SELECT COUNT(*) FROM materials", default=0) or 0)
        n_styles = int(self.db.scalar("SELECT COUNT(*) FROM styles", default=0) or 0)
        n_inv = int(self.db.scalar("SELECT COUNT(*) FROM invoices", default=0) or 0)
        return {
            "projects": total, "done": done, "draft": total - done,
            "sum_price": sum_price, "sum_cost": sum_cost,
            "sum_profit": sum_price - sum_cost,
            "materials": n_mat, "styles": n_styles, "invoices": n_inv,
        }

    def monthly(self, months: int = 6) -> List[Dict[str, Any]]:
        rows = self.db.q(
            "SELECT substr(created_at,1,7) AS ym, COUNT(*) AS cnt, "
            "COALESCE(SUM(final_price),0) AS total FROM projects "
            "GROUP BY ym ORDER BY ym DESC LIMIT ?", (months,))
        out = [dict(r) for r in rows]
        out.reverse()
        return out


# ===========================================================================
# فاکتورها
# ===========================================================================

class InvoiceRepo:
    def __init__(self, db: Optional[Database] = None):
        self.db = db or Database.instance()

    def all(self) -> List[Dict[str, Any]]:
        out = []
        for r in self.db.q("SELECT * FROM invoices ORDER BY id DESC"):
            d = dict(r)
            try:
                d["data"] = json.loads(d.get("data") or "{}")
            except json.JSONDecodeError:
                d["data"] = {}
            out.append(d)
        return out

    def get(self, iid: int) -> Optional[Dict[str, Any]]:
        r = self.db.one("SELECT * FROM invoices WHERE id=?", (iid,))
        if not r:
            return None
        d = dict(r)
        try:
            d["data"] = json.loads(d.get("data") or "{}")
        except json.JSONDecodeError:
            d["data"] = {}
        return d

    def save(self, project_id: int, number: str, data: Dict[str, Any],
             total: float, kind: str = "quote") -> int:
        return int(self.db.execute(
            "INSERT INTO invoices(project_id,number,kind,customer_name,data,total,created_at) "
            "VALUES(?,?,?,?,?,?,?)",
            (project_id, number, kind, data.get("customer_name", ""),
             json.dumps(data, ensure_ascii=False), total, _now())))

    def delete(self, iid: int) -> None:
        self.db.execute("DELETE FROM invoices WHERE id=?", (iid,))

    def next_number(self, kind: str = "quote") -> str:
        from ..core.persian import jdate_str
        n = int(self.db.scalar("SELECT COUNT(*) FROM invoices WHERE kind=?", (kind,), default=0) or 0) + 1
        prefix = "PI" if kind == "quote" else "INV"
        return f"{prefix}-{jdate_str(persian=False).replace('/', '')}-{n:04d}"


# ===========================================================================
# الگوهای یونیت — «یونیت آماده» برای استفاده‌ی مجدد در پروژه‌های بعدی
# ===========================================================================

class UnitTemplateRepo:
    """
    کابینت‌کار در هر پروژه همان یونیت‌های تکراری را می‌سازد (یونیت سینک ۹۰،
    یونیت گاز، کمد ایستاده و …). این‌جا یک یونیتِ کامل — با متریال، درها و
    کشوها — یک‌بار ذخیره می‌شود و بعد با یک کلیک در هر پروژه‌ای قرار می‌گیرد.
    """

    def __init__(self, db: Optional[Database] = None):
        self.db = db or Database.instance()

    def all(self) -> List[Dict[str, Any]]:
        rows = self.db.q("SELECT * FROM unit_templates ORDER BY sort_order, id")
        out = []
        for r in rows:
            d = dict(r)
            try:
                d["data"] = json.loads(d.get("data") or "{}")
            except json.JSONDecodeError:
                d["data"] = {}
            out.append(d)
        return out

    def get(self, tid: int) -> Optional[Dict[str, Any]]:
        r = self.db.one("SELECT * FROM unit_templates WHERE id=?", (tid,))
        if not r:
            return None
        d = dict(r)
        try:
            d["data"] = json.loads(d.get("data") or "{}")
        except json.JSONDecodeError:
            d["data"] = {}
        return d

    def add(self, name: str, data: Dict[str, Any], note: str = "") -> int:
        n = int(self.db.scalar("SELECT COUNT(*) FROM unit_templates", default=0) or 0)
        return int(self.db.execute(
            "INSERT INTO unit_templates(name,note,data,sort_order,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?)",
            (name, note, json.dumps(data or {}, ensure_ascii=False), n, _now(), _now())))

    def update(self, tid: int, name: str, data: Dict[str, Any], note: str = "") -> None:
        self.db.execute(
            "UPDATE unit_templates SET name=?, note=?, data=?, updated_at=? WHERE id=?",
            (name, note, json.dumps(data or {}, ensure_ascii=False), _now(), tid))

    def delete(self, tid: int) -> None:
        self.db.execute("DELETE FROM unit_templates WHERE id=?", (tid,))
