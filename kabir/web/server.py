# -*- coding: utf-8 -*-
"""
سرویس‌دهنده‌ی وب کبیر
=====================
رابط HTML/CSS (پوشه‌ی ``webui``) را سرو می‌کند و یک API ساده برای کار با
پایگاه‌داده‌ی SQLite، موتور محاسبه و صدور فاکتور در اختیارش می‌گذارد.

فقط از کتابخانه‌ی استاندارد پایتون استفاده می‌کند (بدون وابستگی جدید).

اجرا:  python main.py  [--port 8080]  [--no-browser]  [--version]
"""

from __future__ import annotations

import hashlib
import importlib
import json
import mimetypes
import os
import re
import socket
import threading
import traceback
import webbrowser
from datetime import datetime
from email.utils import formatdate
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, unquote, urlparse

from .. import __version__
from .. import config
from ..core import costing, invoice as inv, persian as fa
from ..data import backup as bk
from ..data import dao
from ..data import recalc as rc
from ..data.dao import InvoiceRepo, MaterialRepo, ProjectRepo, StyleRepo
from ..data.db import Database

APP_VERSION = __version__
WEBUI_DIR = Path(__file__).resolve().parents[2] / "webui"
EXPORT_DIR = Path(getattr(config, "EXPORT_DIR", Path(config.data_dir()) / "exports"))

_lock = threading.RLock()
_START_TIME = datetime.now()

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".ttf": "font/ttf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
}


# ===========================================================================
# ابزارها
# ===========================================================================

def _num(v: Any, default: float = 0.0) -> float:
    try:
        if isinstance(v, str):
            v = fa.parse_number(v)
        return float(v)
    except (TypeError, ValueError):
        return default


def _int(v: Any, default: int = 0) -> int:
    try:
        return int(_num(v, default))
    except (TypeError, ValueError):
        return default


def _str(v: Any, default: str = "") -> str:
    return default if v is None else str(v)


def _bool(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "on", "بله")
    return False


def _jdate(value: Any) -> str:
    """تبدیل متن تاریخ (ISO یا شمسی) به تاریخ شمسی کوتاه."""
    if not value:
        return ""
    s = str(value).strip()
    if re.match(r"^\d{4}[/-]\d{1,2}[/-]\d{1,2}", s) and not s.startswith("20"):
        return s.replace("-", "/")
    try:
        d = datetime.fromisoformat(s.replace("Z", ""))
    except ValueError:
        return s
    return fa.jdate_str(d)


def _jmonth(ym: str) -> str:
    try:
        y, m = (int(x) for x in str(ym)[:7].split("-"))
        jy, jm, _ = fa.gregorian_to_jalali(y, m, 15)
        return f"{fa.jalali_month_name(jm)} {fa.to_fa_digits(jy % 100)}"
    except Exception:                                       # noqa: BLE001
        return str(ym)


def _round2(v: Any) -> float:
    return round(_num(v), 2)


class ApiError(Exception):
    """خطای قابل‌گزارش به کاربر."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


# ===========================================================================
# لایه‌ی داده — تبدیل رکوردها به شکل موردنیاز رابط وب
# ===========================================================================

def _material_json(m: costing.Material) -> Dict[str, Any]:
    return {
        "id": int(m.id),
        "name": m.name,
        "cat": m.category,
        "unit": m.unit,
        "price": _round2(m.price),
        "sheet_width_cm": _num(m.sheet_width_cm),
        "sheet_height_cm": _num(m.sheet_height_cm),
        "thickness_mm": _num(m.thickness_mm),
        "width_cm": _num(m.width_cm),
        "supplier": m.supplier or "",
        "note": m.note or "",
        "active": True,
        "sheet_area_sqm": round(m.sheet_area_sqm, 4),
        "price_per_sqm": round(m.price_per_sqm, 2),
    }


def _materials_with_active(db: Database) -> List[Dict[str, Any]]:
    """فهرست متریال با وضعیت فعال/غیرفعال (خارج از dataclass)."""
    act = {int(r["id"]): bool(r["active"])
           for r in db.q("SELECT id, active FROM materials")}
    out = []
    for m in MaterialRepo(db).all():
        d = _material_json(m)
        d["active"] = act.get(int(m.id), True)
        out.append(d)
    return out


def _category_list(db: Database) -> List[Dict[str, Any]]:
    return [{"key": c["key"], "label": c["title"], "unit": c["unit"]}
            for c in dao.CategoryRepo(db).all()]


def _style_json(st: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": int(st["id"]), "name": st.get("name", ""),
            "note": st.get("note", ""), "data": st.get("data") or {}}


def _page_json(row: Dict[str, Any]) -> Dict[str, Any]:
    try:
        data = json.loads(row.get("data") or "{}")
    except json.JSONDecodeError:
        data = {}
    data["id"] = int(row["id"])
    data["project_id"] = int(row["project_id"])
    data["name"] = row.get("name") or data.get("name") or "بخش"
    data["style_id"] = int(row.get("style_id") or 0)
    return data


def _project_json(db: Database, p: Dict[str, Any], with_pages: bool = True) -> Dict[str, Any]:
    rates_rev = _int(p.get("rates_rev"))
    out = {
        "id": int(p["id"]),
        "code": p.get("code") or "",
        "title": p.get("title") or "",
        "customer": p.get("customer_name") or "",
        "mobile": p.get("customer_mobile") or "",
        "phone": p.get("customer_phone") or "",
        "address": p.get("customer_address") or "",
        "status": p.get("status") or "draft",
        "date": _jdate(p.get("created_at")),
        "valid_until": p.get("valid_until") or "",
        "note": p.get("note") or "",
        "final_price": _round2(p.get("final_price")),
        "total_cost": _round2(p.get("total_cost")),
        "rates_rev": rates_rev,
        "stale": rates_rev < rc.current_prices_rev(db),
        "profit_mode": p.get("profit_mode") or "markup",
        "profit_percent": _num(p.get("profit_percent")),
        "install_mode": p.get("install_mode") or "none",
        "install_value": _num(p.get("install_value")),
        "discount_percent": _num(p.get("discount_percent")),
        "discount_amount": _num(p.get("discount_amount")),
        "vat_enabled": _bool(p.get("vat_enabled")),
        "vat_percent": _num(p.get("vat_percent")),
        "extra_fixed_amount": _round2(p.get("extra_fixed_amount")),
        "style": "",
        "pages": [],
    }
    if with_pages:
        pages = [_page_json(r) for r in ProjectRepo(db).pages_of(out["id"])]
        out["pages"] = pages
        if pages:
            out["style"] = pages[0].get("style_name") or ""
    return out


def _projects_json(db: Database) -> List[Dict[str, Any]]:
    out = []
    for p in ProjectRepo(db).all():
        d = _project_json(db, p)
        if not d["style"]:
            st = StyleRepo(db).get(int((d["pages"][0].get("style_id") or 0))) if d["pages"] else None
            d["style"] = st["name"] if st else ""
        out.append(d)
    return out


def _result_json(res: costing.ProjectResult) -> Dict[str, Any]:
    return {
        "pages_cost": _round2(res.pages_cost),
        "installation_cost": _round2(res.installation_cost),
        "total_cost": _round2(res.total_cost),
        "profit_mode": res.profit_mode,
        "profit_percent": _num(res.profit_percent),
        "profit_amount": _round2(res.profit_amount),
        "gross_price": _round2(res.gross_price),
        "discount_percent": _num(res.discount_percent),
        "discount_amount": _round2(res.discount_amount),
        "net_price": _round2(res.net_price),
        "vat_percent": _num(res.vat_percent),
        "vat_amount": _round2(res.vat_amount),
        "final_price": _round2(res.final_price),
        "total_profit": _round2(res.total_profit),
        "stats": {k: _round2(v) for k, v in (res.stats or {}).items()},
        "items": [it.to_dict() for it in res.items],
    }


def _pages_from_payload(payload: Any) -> List[costing.Page]:
    """ساخت آبجکت‌های Page از داده‌ی ارسالی رابط وب."""
    pages = []
    for pg in (payload or []):
        data = dict(pg.get("data") or pg)
        data.setdefault("name", pg.get("name", "بخش"))
        data["style_id"] = int(pg.get("style_id", data.get("style_id", 0)) or 0)
        pages.append(costing.Page.from_dict(data))
    return pages


def _calc(db: Database, project: Dict[str, Any],
          pages: List[costing.Page]) -> costing.ProjectResult:
    engine = costing.CostingEngine(MaterialRepo(db).all(), db.all_settings())
    return engine.calc_project(
        pages,
        install_mode=_str(project.get("install_mode"), "none"),
        install_value=_num(project.get("install_value")),
        profit_mode=_str(project.get("profit_mode"), "markup"),
        profit_percent=_num(project.get("profit_percent")),
        discount_percent=_num(project.get("discount_percent")),
        discount_amount=_num(project.get("discount_amount")),
        vat_enabled=_bool(project.get("vat_enabled")),
        vat_percent=_num(project.get("vat_percent")),
        extra_fixed_amount=_num(project.get("extra_fixed_amount")),
    )


def _calc_payload(db: Database, body: Dict[str, Any]) -> Tuple[costing.ProjectResult, Dict[str, Any]]:
    project = dict(body.get("project") or {})
    pages = _pages_from_payload(body.get("pages"))
    if not pages and project.get("id"):
        pages = ProjectRepo(db).load_pages(int(project["id"]))
        row = ProjectRepo(db).get(int(project["id"]))
        if row:
            for k in ("install_mode", "install_value", "profit_mode", "profit_percent",
                      "discount_percent", "discount_amount", "vat_enabled", "vat_percent",
                      "extra_fixed_amount"):
                project.setdefault(k, row.get(k))
    return _calc(db, project, pages), project


def _invoice_payload(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    """ساخت داده‌ی فاکتور از پروژه‌ی ذخیره‌شده یا داده‌ی ارسالی."""
    result, project = _calc_payload(db, body)
    pid = int(project.get("id") or 0)
    row = ProjectRepo(db).get(pid) if pid else None
    proj_dict = dict(row or {})
    proj_dict.update({
        "title": _str(project.get("title"), proj_dict.get("title", "")),
        "code": _str(project.get("code"), proj_dict.get("code", "")),
        "customer_name": _str(project.get("customer"), proj_dict.get("customer_name", "")),
        "customer_mobile": _str(project.get("mobile"), proj_dict.get("customer_mobile", "")),
        "customer_phone": _str(project.get("phone"), proj_dict.get("customer_phone", "")),
        "customer_address": _str(project.get("address"), proj_dict.get("customer_address", "")),
        "valid_until": _str(project.get("valid_until"), proj_dict.get("valid_until", "")),
        "note": _str(project.get("note"), proj_dict.get("note", "")),
        "show_cost": _bool(body.get("show_cost")),
        "show_stats": _bool(body.get("show_stats", True)),
    })
    kind = _str(body.get("kind"), "quote")
    if kind not in inv.KIND_LABELS:
        kind = "quote"
    mode = _str(body.get("mode"), "grouped")
    hidden = [str(x) for x in (body.get("hidden") or [])]
    if mode == "detailed" and hidden:
        # در حالت ریز، ردیف‌ها با کلید شناخته می‌شوند؛ نام گروه‌های پنهان
        # به کلید ردیف‌های همان گروه نگاشت می‌شود.
        keys = {str(it.key) for it in result.items
                if it.visible and (str(it.group) in hidden or str(it.key) in hidden)}
        hidden = sorted(set(hidden) | keys)
    data = inv.build_invoice_data(
        result, proj_dict, db.all_settings(),
        mode=mode, hidden=hidden,
        invoice_number=_str(body.get("number")) or InvoiceRepo(db).next_number(kind),
        kind=kind,
    )
    data["result"] = _result_json(result)
    return data


def _backup_list() -> List[Dict[str, Any]]:
    out = []
    for b in bk.list_backups():
        out.append({
            "name": b["name"],
            "date": fa.jdatetime_str(b["mtime"]),
            "size": f"{fa.fmt_number(b['size'] / 1024, 1)} کیلوبایت",
            "auto": "auto" in b["name"],
            "mtime": b["mtime"].isoformat(timespec="seconds"),
        })
    return out


def _invoice_list(db: Database) -> List[Dict[str, Any]]:
    repo = InvoiceRepo(db)
    out = []
    for r in repo.all():
        data = r.get("data") or {}
        out.append({
            "id": int(r["id"]),
            "number": r.get("number") or "",
            "kind": r.get("kind") or "quote",
            "kind_label": inv.KIND_LABELS.get(r.get("kind"), "پیش‌فاکتور"),
            "project": (data.get("project_title") or ""),
            "customer": r.get("customer_name") or (data.get("customer") or {}).get("name", ""),
            "date": _jdate(r.get("created_at")),
            "amount": _round2(r.get("total")),
        })
    return out


def _dashboard(db: Database) -> Dict[str, Any]:
    st = ProjectRepo(db).stats()
    projects = _projects_json(db)
    by_status = {"draft": 0, "open": 0, "done": 0, "canceled": 0}
    for p in projects:
        by_status[p["status"]] = by_status.get(p["status"], 0) + 1
    monthly = [{"label": _jmonth(r["ym"]), "amount": _round2(r["total"]), "count": int(r["cnt"])}
               for r in ProjectRepo(db).monthly(6)]
    changes = []
    for h in MaterialRepo(db).history(limit=6):
        changes.append({
            "date": _jdate(h.get("created_at")),
            "name": h.get("material_name") or "—",
            "old": _round2(h.get("old_price")),
            "price": _round2(h.get("new_price")),
            "pct": _num(h.get("change_pct")),
            "reason": h.get("reason") or "",
        })
    return {
        "projects": int(st["projects"]),
        "by_status": by_status,
        "materials": int(st["materials"]),
        "styles": int(st["styles"]),
        "invoices": int(st["invoices"]),
        "month_amount": monthly[-1]["amount"] if monthly else 0.0,
        "month_growth": (round((monthly[-1]["amount"] - monthly[-2]["amount"])
                               / monthly[-2]["amount"] * 100, 1)
                         if len(monthly) > 1 and monthly[-2]["amount"] else 0.0),
        "profit": _round2(st["sum_profit"]),
        "monthly": monthly,
        "recent_projects": [
            {"id": p["id"], "title": p["title"], "customer": p["customer"],
             "code": p["code"], "date": p["date"], "status": p["status"],
             "final_price": p["final_price"]}
            for p in projects[:5]
        ],
        "price_changes": changes,
    }


# ===========================================================================
# API
# ===========================================================================

def api_bootstrap(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    settings = db.all_settings()
    return {
        "version": APP_VERSION,
        "today": fa.jdate_str(),
        "settings": settings,
        "currency": settings.get("currency", "ریال"),
        "currency_scale": _num(settings.get("currency_scale", 1), 1) or 1,
        "units": costing.PRICE_UNITS,
        "categories": _category_list(db),
        "materials": _materials_with_active(db),
        "styles": [_style_json(s) for s in StyleRepo(db).all()],
        "projects": _projects_json(db),
        "invoices": _invoice_list(db),
        "backups": _backup_list(),
        "dashboard": _dashboard(db),
        "prices_rev": rc.current_prices_rev(db),
        "max_styles": config.MAX_STYLES,
        "kind_labels": inv.KIND_LABELS,
        "data_dir": str(config.data_dir()),
    }


def api_health(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    """بررسی سلامت سرویس (برای پایش و تشخیص اتصال از سمت رابط وب)."""
    ok_deps, missing = _preflight()
    return {
        "status": "ok",
        "version": APP_VERSION,
        "uptime_seconds": int((datetime.now() - _START_TIME).total_seconds()),
        "server_time": fa.jdatetime_str(datetime.now()),
        "database": str(getattr(db, "path", "")),
        "exports": {
            "pdf": "reportlab" not in missing,
            "excel": "خروجی اکسل" not in missing,
        },
        "missing_deps": missing,
    }


# ------------------------------- متریال -------------------------------

#: فیلدهایی از متریال که در محاسبه‌ی قیمت پروژه اثر دارند
_PRICE_SENSITIVE_FIELDS = ("price", "sheet_width_cm", "sheet_height_cm",
                           "thickness_mm", "width_cm", "unit", "category")


def _material_affects_pricing(old: costing.Material, new: costing.Material) -> bool:
    """آیا تغییرات این قلم روی قیمت پروژه‌ها اثر می‌گذارد؟"""
    for f in _PRICE_SENSITIVE_FIELDS:
        a, b = getattr(old, f, None), getattr(new, f, None)
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            if abs(float(a) - float(b)) > 0.001:
                return True
        elif a != b:
            return True
    return False


def _price_refresh(db: Database) -> Dict[str, Any]:
    """
    پس از تغییر نرخ متریال:
      ۱) نسخه‌ی نرخ‌ها (prices_rev) افزایش می‌یابد؛
      ۲) همه‌ی پروژه‌ها به‌صورت خودکار با نرخ جدید بازمحاسبه می‌شوند؛
      ۳) فهرست سبک پروژه‌ها و داشبورد برای به‌روزرسانی رابط وب برمی‌گردد.
    """
    rev = rc.bump_prices_rev(db)
    changed = rc.recalc_all_projects(db)
    return {
        "prices_rev": rev,
        "recalced": len(changed),
        "projects": rc.light_projects(db),
        "dashboard": _dashboard(db),
    }


def api_materials_list(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    return {"materials": _materials_with_active(db)}


def api_material_create(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    name = _str(body.get("name")).strip()
    if not name:
        raise ApiError("نام قلم را وارد کنید.")
    if _num(body.get("price")) <= 0:
        raise ApiError("قیمت معتبر وارد کنید.")
    m = costing.Material(
        name=name,
        category=_str(body.get("cat"), "accessory"),
        unit=_str(body.get("unit"), "piece"),
        price=_round2(body.get("price")),
        sheet_width_cm=_num(body.get("sheet_width_cm")),
        sheet_height_cm=_num(body.get("sheet_height_cm")),
        thickness_mm=_num(body.get("thickness_mm")),
        width_cm=_num(body.get("width_cm")),
        supplier=_str(body.get("supplier")),
        note=_str(body.get("note")),
    )
    repo = MaterialRepo(db)
    mid = repo.add(m)
    if not _bool(body.get("active", True)):
        repo.toggle_active(mid)
    db.log("material", f"افزودن قلم: {name}")
    return {"id": int(mid), "materials": _materials_with_active(db)}


def api_material_update(db: Database, body: Dict[str, Any], mid: int) -> Dict[str, Any]:
    repo = MaterialRepo(db)
    old = repo.get(mid)
    if not old:
        raise ApiError("قلم یافت نشد.", 404)
    m = costing.Material(
        id=mid,
        name=_str(body.get("name"), old.name).strip() or old.name,
        category=_str(body.get("cat"), old.category),
        unit=_str(body.get("unit"), old.unit),
        price=_round2(body.get("price", old.price)),
        sheet_width_cm=_num(body.get("sheet_width_cm", old.sheet_width_cm)),
        sheet_height_cm=_num(body.get("sheet_height_cm", old.sheet_height_cm)),
        thickness_mm=_num(body.get("thickness_mm", old.thickness_mm)),
        width_cm=_num(body.get("width_cm", old.width_cm)),
        supplier=_str(body.get("supplier"), old.supplier),
        note=_str(body.get("note"), old.note),
    )
    repo.update(m)
    if "active" in body:
        act = {int(r["id"]): bool(r["active"]) for r in db.q("SELECT id, active FROM materials")}
        if act.get(mid, True) != _bool(body["active"]):
            repo.toggle_active(mid)
    out: Dict[str, Any] = {"materials": _materials_with_active(db)}
    if _material_affects_pricing(old, m):
        # قیمت/مشخصات مؤثر تغییر کرد — همه‌ی پروژه‌ها خودکار بازمحاسبه می‌شوند
        db.log("material", f"تغییر نرخ قلم: {m.name} — بازمحاسبه‌ی خودکار پروژه‌ها")
        out.update(_price_refresh(db))
    return out


def api_material_toggle(db: Database, body: Dict[str, Any], mid: int) -> Dict[str, Any]:
    repo = MaterialRepo(db)
    if not repo.get(mid):
        raise ApiError("قلم یافت نشد.", 404)
    active = repo.toggle_active(mid)
    return {"id": mid, "active": active, "materials": _materials_with_active(db)}


def api_material_delete(db: Database, body: Dict[str, Any], mid: int) -> Dict[str, Any]:
    repo = MaterialRepo(db)
    m = repo.get(mid)
    if not m:
        raise ApiError("قلم یافت نشد.", 404)
    repo.delete(mid)
    db.log("material", f"حذف قلم: {m.name}")
    out: Dict[str, Any] = {"id": mid, "materials": _materials_with_active(db)}
    # قلم حذف‌شده ممکن است در پروژه‌ها استفاده شده باشد — بازمحاسبه‌ی خودکار
    out.update(_price_refresh(db))
    return out


def api_material_bulk(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    pct = _num(body.get("percent"))
    if not pct:
        raise ApiError("درصد تغییر را وارد کنید.")
    cat = _str(body.get("cat")) or None
    if cat == "all":
        cat = None
    reason = _str(body.get("reason")).strip() or "به‌روزرسانی دسته‌جمعی از رابط وب"
    repo = MaterialRepo(db)
    count = repo.bulk_change_price(cat, pct, reason=reason)
    db.log("material", f"تغییر دسته‌جمعی {pct:+g}٪ روی {count} قلم")
    out: Dict[str, Any] = {"count": count, "materials": _materials_with_active(db),
                           "history": api_price_history(db, {})["history"]}
    if count:
        # همه‌ی پروژه‌ها خودکار با نرخ جدید بازمحاسبه می‌شوند
        out.update(_price_refresh(db))
    return out


def api_price_history(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    limit = _int(body.get("limit", 60), 60)
    rows = MaterialRepo(db).history(limit=max(1, min(limit, 500)))
    return {"history": [{
        "id": int(r["id"]),
        "date": _jdate(r.get("created_at")),
        "name": r.get("material_name") or "—",
        "old": _round2(r.get("old_price")),
        "price": _round2(r.get("new_price")),
        "pct": _num(r.get("change_pct")),
        "reason": r.get("reason") or "",
    } for r in rows]}


# -------------------------------- سبک‌ها --------------------------------

def api_styles_list(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    return {"styles": [_style_json(s) for s in StyleRepo(db).all()]}


def _check_style_limit(db: Database) -> None:
    if StyleRepo(db).count() >= config.MAX_STYLES:
        raise ApiError(f"حداکثر {fa.to_fa_digits(config.MAX_STYLES)} سبک مجاز است.")


def api_style_create(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    _check_style_limit(db)
    name = _str(body.get("name")).strip()
    if not name:
        raise ApiError("نام سبک را وارد کنید.")
    sid = StyleRepo(db).add(name, body.get("data") or {}, _str(body.get("note")))
    return {"id": int(sid), "styles": [_style_json(s) for s in StyleRepo(db).all()]}


def api_style_update(db: Database, body: Dict[str, Any], sid: int) -> Dict[str, Any]:
    repo = StyleRepo(db)
    st = repo.get(sid)
    if not st:
        raise ApiError("سبک یافت نشد.", 404)
    repo.update(sid, _str(body.get("name"), st["name"]).strip() or st["name"],
                body.get("data") if isinstance(body.get("data"), dict) else st["data"],
                _str(body.get("note"), st.get("note", "")))
    return {"styles": [_style_json(s) for s in repo.all()]}


def api_style_duplicate(db: Database, body: Dict[str, Any], sid: int) -> Dict[str, Any]:
    _check_style_limit(db)
    repo = StyleRepo(db)
    new_id = repo.duplicate(sid)
    if not new_id:
        raise ApiError("سبک یافت نشد.", 404)
    return {"id": int(new_id), "styles": [_style_json(s) for s in repo.all()]}


def api_style_delete(db: Database, body: Dict[str, Any], sid: int) -> Dict[str, Any]:
    repo = StyleRepo(db)
    if not repo.get(sid):
        raise ApiError("سبک یافت نشد.", 404)
    repo.delete(sid)
    return {"id": sid, "styles": [_style_json(s) for s in repo.all()]}


# ------------------------------- پروژه‌ها -------------------------------

def _project_or_404(db: Database, pid: int) -> Dict[str, Any]:
    p = ProjectRepo(db).get(pid)
    if not p:
        raise ApiError("پروژه یافت نشد.", 404)
    return p


PROJECT_IN_FIELDS = ("title", "customer", "mobile", "phone", "address", "status",
                     "valid_until", "note", "profit_mode", "profit_percent",
                     "install_mode", "install_value", "discount_percent", "discount_amount",
                     "vat_enabled", "vat_percent", "extra_fixed_amount")


def _project_to_row(body: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "title": _str(body.get("title")),
        "customer_name": _str(body.get("customer")),
        "customer_mobile": _str(body.get("mobile")),
        "customer_phone": _str(body.get("phone")),
        "customer_address": _str(body.get("address")),
        "status": _str(body.get("status"), "draft"),
        "valid_until": _str(body.get("valid_until")),
        "note": _str(body.get("note")),
        "install_mode": _str(body.get("install_mode"), "none"),
        "install_value": _num(body.get("install_value")),
        "profit_mode": _str(body.get("profit_mode"), "markup"),
        "profit_percent": _num(body.get("profit_percent"), 30),
        "discount_percent": _num(body.get("discount_percent")),
        "discount_amount": _num(body.get("discount_amount")),
        "vat_enabled": 1 if _bool(body.get("vat_enabled")) else 0,
        "vat_percent": _num(body.get("vat_percent"), 10),
        "extra_fixed_amount": _round2(body.get("extra_fixed_amount")),
    }


def api_projects_list(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    return {"projects": _projects_json(db)}


def api_project_get(db: Database, body: Dict[str, Any], pid: int) -> Dict[str, Any]:
    return {"project": _project_json(db, _project_or_404(db, pid))}


def api_project_create(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    if not _str(body.get("title")).strip():
        raise ApiError("عنوان پروژه را وارد کنید.")
    settings = db.all_settings()
    repo = ProjectRepo(db)
    row = _project_to_row(body)
    row["profit_mode"] = _str(body.get("profit_mode"), settings.get("default_profit_mode", "markup"))
    row["profit_percent"] = _num(body.get("profit_percent"),
                                 _num(settings.get("default_profit_percent", 30), 30))
    row["install_mode"] = _str(body.get("install_mode"), settings.get("default_install_mode", "none"))
    row["install_value"] = _num(body.get("install_value"), _num(settings.get("default_install_value")))
    row["vat_enabled"] = (1 if _bool(body.get("vat_enabled",
                                              _bool(settings.get("vat_enabled")))) else 0)
    row["vat_percent"] = _num(body.get("vat_percent"), _num(settings.get("vat_percent", 10), 10))
    row["rates_rev"] = rc.current_prices_rev(db)
    pid = repo.create(row)

    # بخش اول
    sid = _int(body.get("style_id"))
    style = StyleRepo(db).get(sid) if sid else None
    page = costing.Page(name="بخش ۱", style_id=sid,
                        style_name=style["name"] if style else "")
    page.waste_percent = _num(settings.get("default_waste_percent", 10), 10)
    page.overhead_percent = _num(settings.get("default_overhead_percent", 0), 0)
    for k in ("banding_body_factor", "banding_door_factor", "banding_waste_percent"):
        setattr(page, k, _num(settings.get(k), getattr(page, k)))
    if style:
        d = style.get("data") or {}
        page.waste_percent = _num(d.get("waste_percent"), page.waste_percent)
        page.overhead_percent = _num(d.get("overhead_percent"), page.overhead_percent)
    repo.add_page(pid, page.name, page.style_id, page.to_dict(), 0)
    db.log("project", f"ایجاد پروژه: {row['title']}")
    return {"project": _project_json(db, _project_or_404(db, pid))}


def api_project_update(db: Database, body: Dict[str, Any], pid: int) -> Dict[str, Any]:
    _project_or_404(db, pid)
    repo = ProjectRepo(db)
    row = {k: v for k, v in _project_to_row(body).items() if k in body or True}
    # فقط میدان‌هایی که ارسال شده‌اند به‌روز شوند
    mapping = {"title": "title", "customer": "customer_name", "mobile": "customer_mobile",
               "phone": "customer_phone", "address": "customer_address", "status": "status",
               "valid_until": "valid_until", "note": "note", "profit_mode": "profit_mode",
               "profit_percent": "profit_percent", "install_mode": "install_mode",
               "install_value": "install_value", "discount_percent": "discount_percent",
               "discount_amount": "discount_amount", "vat_enabled": "vat_enabled",
               "vat_percent": "vat_percent", "extra_fixed_amount": "extra_fixed_amount"}
    patch: Dict[str, Any] = {}
    for src, dst in mapping.items():
        if src in body:
            patch[dst] = row[dst]
    if "final_price" in body:
        patch["final_price"] = _round2(body["final_price"])
    if "total_cost" in body:
        patch["total_cost"] = _round2(body["total_cost"])
    # پروژه با نرخ‌های جاری محاسبه/ذخیره شد — نسخه‌ی نرخ ثبت می‌شود
    patch["rates_rev"] = rc.current_prices_rev(db)
    if patch:
        repo.update(pid, patch)

    pages = body.get("pages")
    if isinstance(pages, list):
        existing = [r["id"] for r in repo.pages_of(pid)]
        seen: List[int] = []
        for i, pg in enumerate(pages):
            data = dict(pg.get("data") or pg)
            data.pop("id", None)
            data.pop("project_id", None)
            name = _str(pg.get("name"), data.get("name", "بخش"))
            sid = _int(pg.get("style_id", data.get("style_id", 0)))
            pgid = _int(pg.get("id"))
            if pgid and pgid in existing:
                repo.save_page(pgid, name, sid, data)
                seen.append(pgid)
            else:
                new_id = repo.add_page(pid, name, sid, data, i)
                seen.append(new_id)
        for old_id in existing:
            if old_id not in seen:
                repo.delete_page(old_id)
        repo.reorder_pages(pid, seen)
    db.log("project", f"به‌روزرسانی پروژه #{pid}")
    return {"project": _project_json(db, _project_or_404(db, pid))}


def api_project_duplicate(db: Database, body: Dict[str, Any], pid: int) -> Dict[str, Any]:
    _project_or_404(db, pid)
    new_id = ProjectRepo(db).duplicate(pid)
    if not new_id:
        raise ApiError("کپی پروژه ناموفق بود.")
    return {"project": _project_json(db, _project_or_404(db, new_id))}


def api_project_delete(db: Database, body: Dict[str, Any], pid: int) -> Dict[str, Any]:
    p = _project_or_404(db, pid)
    ProjectRepo(db).delete(pid)
    db.log("project", f"حذف پروژه: {p.get('title')}")
    return {"id": pid}


def api_project_calc(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    result, project = _calc_payload(db, body)
    out = _result_json(result)
    out["project_id"] = _int(project.get("id"))
    return out


def api_projects_recalc_all(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    """بازمحاسبه‌ی قیمت همه‌ی پروژه‌ها با نرخ‌های جاری متریال."""
    only_stale = _bool(body.get("only_stale", False))
    changed = rc.recalc_all_projects(db, only_stale=only_stale)
    db.log("recalc", f"بازمحاسبه‌ی دستی {len(changed)} پروژه از رابط وب")
    return {
        "count": len(changed),
        "prices_rev": rc.current_prices_rev(db),
        "projects": rc.light_projects(db),
        "dashboard": _dashboard(db),
    }


# -------------------------------- فاکتور --------------------------------

def api_invoice_preview(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    data = _invoice_payload(db, body)
    return {"data": data, "html": inv.render_html(data)}


def api_invoice_html(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    data = _invoice_payload(db, body)
    return {"html": inv.render_html(data)}


def _invoice_bytes(db: Database, body: Dict[str, Any], fmt: str) -> Tuple[bytes, str, str]:
    # اگر داده‌ی فاکتور آماده (مثلاً فاکتور بایگانی‌شده) ارسال شده، مستقیم استفاده می‌شود
    pre = body.get("data")
    if isinstance(pre, dict) and pre.get("items") is not None:
        data = pre
    else:
        data = _invoice_payload(db, body)
    number = re.sub(r"[^\w\-.]+", "-", data.get("number") or "invoice")
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    if fmt == "pdf":
        from ..core import invoice_pdf
        path = EXPORT_DIR / f"{number}.pdf"
        invoice_pdf.build_pdf(data, path)
        return path.read_bytes(), f"{number}.pdf", "application/pdf"
    from ..core import exporters
    path = EXPORT_DIR / f"{number}.xlsx"
    exporters.export_invoice_xlsx(data, path)
    return (path.read_bytes(), f"{number}.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def api_invoice_pdf(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    raw, name, ctype = _invoice_bytes(db, body, "pdf")
    return {"__file__": (raw, name, ctype)}


def api_invoice_xlsx(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    raw, name, ctype = _invoice_bytes(db, body, "xlsx")
    return {"__file__": (raw, name, ctype)}


def api_invoice_save(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    data = _invoice_payload(db, body)
    number = _str(body.get("number")) or InvoiceRepo(db).next_number(data.get("kind", "quote"))
    data["number"] = number
    pid = _int((body.get("project") or {}).get("id"))
    total = _round2((data.get("totals") or {}).get("final_price"))
    iid = InvoiceRepo(db).save(pid or None, number, data, total, data.get("kind", "quote"))
    db.log("invoice", f"صدور فاکتور {number}")
    return {"id": int(iid), "number": number, "invoices": _invoice_list(db)}


def api_invoices_list(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    return {"invoices": _invoice_list(db)}


def api_invoice_archived(db: Database, body: Dict[str, Any], iid: int) -> Dict[str, Any]:
    r = InvoiceRepo(db).get(iid)
    if not r:
        raise ApiError("فاکتور یافت نشد.", 404)
    return {"data": r.get("data") or {}, "html": inv.render_html(r.get("data") or {}),
            "invoice": r}


def api_invoice_delete(db: Database, body: Dict[str, Any], iid: int) -> Dict[str, Any]:
    if not InvoiceRepo(db).get(iid):
        raise ApiError("فاکتور یافت نشد.", 404)
    InvoiceRepo(db).delete(iid)
    return {"id": iid, "invoices": _invoice_list(db)}


def api_invoice_archived_file(db: Database, body: Dict[str, Any], iid: int,
                              fmt: str) -> Dict[str, Any]:
    r = InvoiceRepo(db).get(iid)
    if not r:
        raise ApiError("فاکتور یافت نشد.", 404)
    raw, name, ctype = _invoice_bytes(db, {"data": r.get("data") or {}}, fmt)
    return {"__file__": (raw, name, ctype)}


def api_materials_export(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    from ..core import exporters
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = EXPORT_DIR / f"materials-{datetime.now():%Y%m%d-%H%M}.xlsx"
    exporters.export_materials_xlsx(MaterialRepo(db).all(), path,
                                    dao.CategoryRepo(db).labels())
    return {"__file__": (path.read_bytes(), path.name,
                         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}


# ------------------------------ تنظیمات و پشتیبان ------------------------------

SETTING_KEYS = (
    "company_name", "company_manager", "company_phone", "company_mobile", "company_address",
    "company_email", "company_web", "company_logo", "invoice_title", "invoice_footer_note",
    "currency", "currency_scale", "vat_enabled", "vat_percent",
    "default_waste_percent", "default_overhead_percent", "default_profit_mode",
    "default_profit_percent", "default_install_mode", "default_install_value",
    "sheet_width_cm", "sheet_height_cm", "sheet_thickness_mm",
    "fiber_sheet_width_cm", "fiber_sheet_height_cm",
    "unit_ground_length_cm", "unit_ground_height_cm", "unit_ground_depth_cm", "unit_ground_shelves",
    "unit_wall_length_cm", "unit_wall_height_cm", "unit_wall_depth_cm", "unit_wall_shelves",
    "unit_tall_length_cm", "unit_tall_height_cm", "unit_tall_depth_cm", "unit_tall_shelves",
    "banding_body_factor", "banding_door_factor", "banding_waste_percent", "banding_width_mm",
    "theme", "font_size", "table_row_height", "persian_digits", "show_decimals",
    "auto_backup", "backup_keep", "web_font_size",
)


def api_settings_get(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    return {"settings": db.all_settings()}


def api_settings_save(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    incoming = body.get("settings") if isinstance(body.get("settings"), dict) else body
    patch = {k: _str(v) for k, v in incoming.items() if k in SETTING_KEYS}
    if not patch:
        raise ApiError("تنظیمی برای ذخیره ارسال نشد.")
    db.set_settings(patch)
    db.log("settings", f"ذخیره‌ی {len(patch)} تنظیم از رابط وب")
    return {"settings": db.all_settings()}


def api_backups_list(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    return {"backups": _backup_list()}


def api_backup_create(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    ok, msg = bk.create_backup(db, tag=_str(body.get("tag"), "web"))
    if not ok:
        raise ApiError(msg, 500)
    keep = _int(db.get_setting("backup_keep", 30), 30)
    if keep > 0:
        bk.prune_backups(keep)
    return {"path": str(Path(msg).name), "backups": _backup_list()}


def api_backup_restore(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    name = _str(body.get("name")).strip()
    target = None
    for b in bk.list_backups():
        if b["name"] == name:
            target = Path(b["path"])
            break
    if not target:
        raise ApiError("نسخه‌ی پشتیبان یافت نشد.", 404)
    ok, msg = bk.restore_backup(target, db)
    if not ok:
        raise ApiError(msg, 500)
    new_db = Database.instance()
    out = api_bootstrap(new_db, {})
    out["message"] = msg
    return out


def api_backup_delete(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    name = _str(body.get("name")).strip()
    target = None
    for b in bk.list_backups():
        if b["name"] == name:
            target = Path(b["path"])
            break
    if not target:
        raise ApiError("نسخه‌ی پشتیبان یافت نشد.", 404)
    target.unlink(missing_ok=True)
    return {"name": name, "backups": _backup_list()}


def api_backup_export(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = EXPORT_DIR / f"kabir-data-{datetime.now():%Y%m%d-%H%M}.json"
    ok, msg = bk.export_json(path, db)
    if not ok:
        raise ApiError(msg, 500)
    return {"__file__": (path.read_bytes(), path.name, "application/json")}


def api_backup_import(db: Database, body: Dict[str, Any]) -> Dict[str, Any]:
    content = body.get("content")
    if isinstance(content, str) and content.strip():
        raw = content.encode("utf-8")
    elif isinstance(content, dict):
        raw = json.dumps(content, ensure_ascii=False).encode("utf-8")
    else:
        raise ApiError("محتوای JSON ارسال نشد.")
    try:
        json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ApiError(f"فایل JSON معتبر نیست: {exc}") from exc
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    tmp = EXPORT_DIR / f"import-{datetime.now():%Y%m%d-%H%M%S}.json"
    tmp.write_bytes(raw)
    ok, msg = bk.import_json(tmp, replace=_bool(body.get("replace", True)), db=db)
    tmp.unlink(missing_ok=True)
    if not ok:
        raise ApiError(msg, 500)
    out = api_bootstrap(Database.instance(), {})
    out["message"] = msg
    return out


# ===========================================================================
# جدول مسیرها
# ===========================================================================

Route = Tuple[str, re.Pattern, Callable[..., Any]]

ROUTES: List[Route] = [
    ("GET", re.compile(r"^/api/health$"), lambda h, b, m: api_health(h.db, b)),
    ("GET", re.compile(r"^/api/bootstrap$"), lambda h, b, m: api_bootstrap(h.db, b)),
    ("GET", re.compile(r"^/api/settings$"), lambda h, b, m: api_settings_get(h.db, b)),
    ("PUT", re.compile(r"^/api/settings$"), lambda h, b, m: api_settings_save(h.db, b)),
    ("POST", re.compile(r"^/api/settings$"), lambda h, b, m: api_settings_save(h.db, b)),

    ("GET", re.compile(r"^/api/materials$"), lambda h, b, m: api_materials_list(h.db, b)),
    ("POST", re.compile(r"^/api/materials$"), lambda h, b, m: api_material_create(h.db, b)),
    ("GET", re.compile(r"^/api/materials/export$"), lambda h, b, m: api_materials_export(h.db, b)),
    ("POST", re.compile(r"^/api/materials/bulk$"), lambda h, b, m: api_material_bulk(h.db, b)),
    ("GET", re.compile(r"^/api/price-history$"), lambda h, b, m: api_price_history(h.db, b)),
    ("PUT", re.compile(r"^/api/materials/(?P<mid>\d+)$"),
     lambda h, b, m: api_material_update(h.db, b, int(m["mid"]))),
    ("POST", re.compile(r"^/api/materials/(?P<mid>\d+)/toggle$"),
     lambda h, b, m: api_material_toggle(h.db, b, int(m["mid"]))),
    ("DELETE", re.compile(r"^/api/materials/(?P<mid>\d+)$"),
     lambda h, b, m: api_material_delete(h.db, b, int(m["mid"]))),

    ("GET", re.compile(r"^/api/styles$"), lambda h, b, m: api_styles_list(h.db, b)),
    ("POST", re.compile(r"^/api/styles$"), lambda h, b, m: api_style_create(h.db, b)),
    ("PUT", re.compile(r"^/api/styles/(?P<sid>\d+)$"),
     lambda h, b, m: api_style_update(h.db, b, int(m["sid"]))),
    ("POST", re.compile(r"^/api/styles/(?P<sid>\d+)/duplicate$"),
     lambda h, b, m: api_style_duplicate(h.db, b, int(m["sid"]))),
    ("DELETE", re.compile(r"^/api/styles/(?P<sid>\d+)$"),
     lambda h, b, m: api_style_delete(h.db, b, int(m["sid"]))),

    ("GET", re.compile(r"^/api/projects$"), lambda h, b, m: api_projects_list(h.db, b)),
    ("POST", re.compile(r"^/api/projects$"), lambda h, b, m: api_project_create(h.db, b)),
    ("POST", re.compile(r"^/api/projects/recalc-all$"),
     lambda h, b, m: api_projects_recalc_all(h.db, b)),
    ("POST", re.compile(r"^/api/calc$"), lambda h, b, m: api_project_calc(h.db, b)),
    ("GET", re.compile(r"^/api/projects/(?P<pid>\d+)$"),
     lambda h, b, m: api_project_get(h.db, b, int(m["pid"]))),
    ("PUT", re.compile(r"^/api/projects/(?P<pid>\d+)$"),
     lambda h, b, m: api_project_update(h.db, b, int(m["pid"]))),
    ("POST", re.compile(r"^/api/projects/(?P<pid>\d+)/duplicate$"),
     lambda h, b, m: api_project_duplicate(h.db, b, int(m["pid"]))),
    ("DELETE", re.compile(r"^/api/projects/(?P<pid>\d+)$"),
     lambda h, b, m: api_project_delete(h.db, b, int(m["pid"]))),

    ("POST", re.compile(r"^/api/invoice/preview$"), lambda h, b, m: api_invoice_preview(h.db, b)),
    ("POST", re.compile(r"^/api/invoice/html$"), lambda h, b, m: api_invoice_html(h.db, b)),
    ("POST", re.compile(r"^/api/invoice/save$"), lambda h, b, m: api_invoice_save(h.db, b)),
    ("POST", re.compile(r"^/api/invoice/pdf$"), lambda h, b, m: api_invoice_pdf(h.db, b)),
    ("POST", re.compile(r"^/api/invoice/xlsx$"), lambda h, b, m: api_invoice_xlsx(h.db, b)),
    ("GET", re.compile(r"^/api/invoices$"), lambda h, b, m: api_invoices_list(h.db, b)),
    ("GET", re.compile(r"^/api/invoices/(?P<iid>\d+)$"),
     lambda h, b, m: api_invoice_archived(h.db, b, int(m["iid"]))),
    ("GET", re.compile(r"^/api/invoices/(?P<iid>\d+)/pdf$"),
     lambda h, b, m: api_invoice_archived_file(h.db, b, int(m["iid"]), "pdf")),
    ("GET", re.compile(r"^/api/invoices/(?P<iid>\d+)/xlsx$"),
     lambda h, b, m: api_invoice_archived_file(h.db, b, int(m["iid"]), "xlsx")),
    ("DELETE", re.compile(r"^/api/invoices/(?P<iid>\d+)$"),
     lambda h, b, m: api_invoice_delete(h.db, b, int(m["iid"]))),

    ("GET", re.compile(r"^/api/backups$"), lambda h, b, m: api_backups_list(h.db, b)),
    ("POST", re.compile(r"^/api/backups$"), lambda h, b, m: api_backup_create(h.db, b)),
    ("POST", re.compile(r"^/api/backups/restore$"), lambda h, b, m: api_backup_restore(h.db, b)),
    ("GET", re.compile(r"^/api/backups/export$"), lambda h, b, m: api_backup_export(h.db, b)),
    ("POST", re.compile(r"^/api/backups/import$"), lambda h, b, m: api_backup_import(h.db, b)),
    ("DELETE", re.compile(r"^/api/backups$"), lambda h, b, m: api_backup_delete(h.db, b)),
]


# ===========================================================================
# هندلر HTTP
# ===========================================================================

class KabirHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = f"Kabir/{APP_VERSION}"

    # ---------------- پاسخ‌ها ----------------
    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _security(self) -> None:
        """هدرهای امنیتی پایه (نرم‌افزار محلی، سخت‌گیری متعادل)."""
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("X-XSS-Protection", "1; mode=block")

    def _json(self, obj: Any, status: int = 200) -> None:
        raw = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self._security()
        self.end_headers()
        self.wfile.write(raw)

    def _file(self, raw: bytes, name: str, ctype: str) -> None:
        from urllib.parse import quote
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(name)}")
        self._cors()
        self._security()
        self.end_headers()
        self.wfile.write(raw)

    def _static(self, rel: str) -> None:
        rel = unquote(rel).lstrip("/")
        if not rel:
            rel = "index.html"
        base = WEBUI_DIR.resolve()
        target = (base / rel).resolve()
        if base not in target.parents and target != base:
            self._json({"ok": False, "error": "مسیر نامعتبر"}, 403)
            return
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            # مسیرهای کلاینت‌ساید (هش) به پوسته‌ی اصلی برمی‌گردند
            if not rel.startswith(("api/", "assets/", "css/", "js/")):
                target = base / "index.html"
            if not target.is_file():
                self._json({"ok": False, "error": "یافت نشد"}, 404)
                return
        st = target.stat()
        etag = '"{:x}-{:x}"'.format(int(st.st_size), int(st.st_mtime))
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Content-Length", "0")
            self._cors()
            self._security()
            self.end_headers()
            return
        raw = target.read_bytes()
        ctype = MIME.get(target.suffix.lower()) or mimetypes.guess_type(str(target))[0] \
            or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("ETag", etag)
        self.send_header("Last-Modified",
                         formatdate(st.st_mtime, usegmt=True))
        self._cors()
        self._security()
        self.end_headers()
        self.wfile.write(raw)

    # ---------------- بدنه‌ی درخواست ----------------
    def _body(self) -> Dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ApiError(f"بدنه‌ی JSON نامعتبر: {exc}") from exc
        return data if isinstance(data, dict) else {"value": data}

    # ---------------- روش‌ها ----------------
    def do_OPTIONS(self) -> None:                              # noqa: N802
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:                                    # noqa: N802
        self._dispatch("GET")

    def do_POST(self) -> None:                                   # noqa: N802
        self._dispatch("POST")

    def do_PUT(self) -> None:                                    # noqa: N802
        self._dispatch("PUT")

    def do_DELETE(self) -> None:                                 # noqa: N802
        self._dispatch("DELETE")

    def _dispatch(self, method: str) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        try:
            if not path.startswith("/api/"):
                if method != "GET":
                    raise ApiError("مسیر نامعتبر", 405)
                self._static(path)
                return
            query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
            for m, pattern, handler in ROUTES:
                if m != method:
                    continue
                match = pattern.match(path)
                if not match:
                    continue
                body = self._body()
                body.update({k: v for k, v in query.items() if k not in body})
                with _lock:
                    self.db = Database.instance()
                    result = handler(self, body, match.groupdict())
                if isinstance(result, dict) and "__file__" in result:
                    self._file(*result["__file__"])
                else:
                    payload = dict(result or {})
                    payload["ok"] = True
                    self._json(payload)
                return
            raise ApiError(f"مسیر API یافت نشد: {path}", 404)
        except ApiError as exc:
            self._json({"ok": False, "error": exc.message}, exc.status)
        except BrokenPipeError:
            pass
        except Exception as exc:                                 # noqa: BLE001
            msg = traceback.format_exc()
            print(msg)
            _log_error(f"{method} {path}\n{msg}")
            try:
                self._json({"ok": False, "error": f"خطای سرور: {exc}"}, 500)
            except Exception:                                    # noqa: BLE001
                pass

    def log_message(self, fmt: str, *args: Any) -> None:         # noqa: A003
        if os.environ.get("KABIR_WEB_LOG"):
            super().log_message(fmt, *args)


def _log_error(msg: str) -> None:
    """افزودن خطا به فایل لاگ برنامه (kabir.log) برای گزارش‌گیری."""
    try:
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(config.LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(f"\n===== [{stamp}] =====\n{msg}\n")
    except OSError:
        pass


# ===========================================================================
# راه‌اندازی
# ===========================================================================

BANNER = r"""
   ╔═══════════════════════════════════════════════════════════╗
   ║   🗄  کـبـیـر  —  قیمت تمام‌شده و فاکتور صنعت کابینت       ║
   ╚═══════════════════════════════════════════════════════════╝
"""


def _preflight() -> Tuple[bool, List[str]]:
    """بررسی وابستگی‌های اختیاری برای گزارش به کاربر."""
    missing = []
    for mod, label in (("reportlab", "خروجی PDF"), ("openpyxl", "خروجی اکسل"),
                       ("arabic_reshaper", "شکل‌دهی متن فارسی در PDF"),
                       ("bidi.algorithm", "راست‌به‌چپ کردن متن PDF")):
        try:
            importlib.import_module(mod)
        except ImportError:
            missing.append(label)
    return (not missing), missing


def _port_in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        return s.connect_ex((host if host != "0.0.0.0" else "127.0.0.1", port)) == 0


def serve(host: str = "127.0.0.1", port: int = 8080,
          open_browser: bool = True, quiet: bool = False) -> ThreadingHTTPServer:
    """اجرای سرویس‌دهنده (مسدودکننده)."""
    if not WEBUI_DIR.is_dir():
        raise RuntimeError(f"پوشه‌ی رابط وب یافت نشد: {WEBUI_DIR}")

    # اگر پورت اشغال بود و نرم‌افزار دیگری آن‌جا نیست، پورت آزاد بعدی انتخاب می‌شود
    if _port_in_use(host, port):
        if _is_kabir_running(host, port):
            print(f"  ✔ کبیر از قبل روی {port} در حال اجراست — مرورگر باز می‌شود.")
            if open_browser:
                webbrowser.open(f"http://{host}:{port}/")
            return None  # type: ignore[return-value]
        original = port
        for candidate in range(port + 1, port + 21):
            if not _port_in_use(host, candidate):
                port = candidate
                if not quiet:
                    print(f"  ⚠ پورت {original} اشغال بود — کبیر روی پورت {port} اجرا می‌شود.")
                break
        else:
            raise RuntimeError(f"پورت آزاد در بازه‌ی {original}..{original + 20} یافت نشد.")

    db = Database.instance()
    dao.bootstrap(db)
    if db.get_bool("auto_backup", True):
        bk.auto_backup_if_needed(db)

    ok_deps, missing = _preflight()
    httpd = ThreadingHTTPServer((host, port), KabirHandler)
    httpd.daemon_threads = True
    url = f"http://{'localhost' if host in ('127.0.0.1', '0.0.0.0') else host}:{port}/"

    if not quiet:
        print(BANNER)
        print(f"  نسخه: {fa.to_fa_digits(APP_VERSION)}")
        print(f"  نشانی: {url}")
        print(f"  پایگاه‌داده: {db.path}")
        print(f"  پوشه‌ی رابط وب: {WEBUI_DIR}")
        if not ok_deps:
            print(f"  ⚠ بدون این وابستگی‌ها برخی خروجی‌ها کار نمی‌کنند: {', '.join(missing)}")
            print("    نصب:  pip install -r requirements.txt")
        print("  برای توقف: Ctrl+C")
        print()

    if open_browser:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        if not quiet:
            print("\nدر حال بستن سرویس‌دهنده… خدانگهدار 👋")
    finally:
        httpd.server_close()
    return httpd


def _is_kabir_running(host: str, port: int) -> bool:
    """آیا سرویس در حال اجرا روی این پورت، خودِ کبیر است؟"""
    import urllib.error
    import urllib.request
    try:
        url = f"http://{'127.0.0.1' if host == '0.0.0.0' else host}:{port}/api/health"
        with urllib.request.urlopen(url, timeout=1.5) as r:
            data = json.loads(r.read().decode("utf-8"))
        return bool(data.get("ok")) and data.get("version") == APP_VERSION
    except Exception:                          # noqa: BLE001
        return False


def main(argv: Optional[List[str]] = None) -> int:
    import argparse
    ap = argparse.ArgumentParser(
        prog="kabir",
        description="کبیر — نرم‌افزار محاسبه‌ی قیمت تمام‌شده و صدور فاکتور کابینت (رابط وب)",
    )
    ap.add_argument("--host", default=os.environ.get("KABIR_WEB_HOST", "127.0.0.1"),
                    help="نشانی میزبان (پیش‌فرض: 127.0.0.1)")
    ap.add_argument("--port", type=int, default=int(os.environ.get("KABIR_WEB_PORT", "8080")),
                    help="شماره‌ی پورت (پیش‌فرض: 8080)")
    ap.add_argument("--no-browser", action="store_true", help="مرورگر باز نشود")
    ap.add_argument("--quiet", action="store_true", help="بدون پیام‌های راه‌اندازی")
    ap.add_argument("--version", action="version",
                    version=f"کبیر {APP_VERSION}")
    args = ap.parse_args(argv)
    serve(args.host, args.port, open_browser=not args.no_browser, quiet=args.quiet)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
