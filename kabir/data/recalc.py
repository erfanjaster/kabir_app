# -*- coding: utf-8 -*-
"""
بازمحاسبه‌ی خودکار قیمت پروژه‌ها با نرخ‌های جاری متریال
=========================================================
هر بار قیمت (یا مشخصات مؤثر در قیمت) متریال‌ها تغییر کند، «نسخه‌ی نرخ‌ها»
(``prices_rev`` در تنظیمات) یکی افزایش می‌یابد. هر پروژه هم هنگام آخرین
محاسبه/ذخیره، نسخه‌ی نرخِ خود (``projects.rates_rev``) را ثبت می‌کند.

* اگر  ``rates_rev < prices_rev``  → پروژه با نرخ قدیمی مانده (stale)
  و باید بازمحاسبه شود (رابط وب هشدار می‌دهد).
* با هر تغییر قیمت متریال، همه‌ی پروژه‌ها به‌صورت خودکار با نرخ جدید
  بازمحاسبه می‌شوند (``recalc_all_projects``).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..core import costing
from .dao import MaterialRepo, ProjectRepo
from .db import Database

PRICES_REV_KEY = "prices_rev"


# ---------------------------------------------------------------------------
# نسخه‌ی نرخ‌ها
# ---------------------------------------------------------------------------

def current_prices_rev(db: Optional[Database] = None) -> int:
    """شماره‌ی نسخه‌ی جاری نرخ‌های متریال (۰ اگر هرگز تغییری ثبت نشده)."""
    db = db or Database.instance()
    try:
        return int(float(db.get_setting(PRICES_REV_KEY, "0") or 0))
    except (TypeError, ValueError):
        return 0


def bump_prices_rev(db: Optional[Database] = None) -> int:
    """افزایش نسخه‌ی نرخ‌ها پس از تغییر قیمت/مشخصات متریال."""
    db = db or Database.instance()
    rev = current_prices_rev(db) + 1
    db.set_setting(PRICES_REV_KEY, str(rev))
    return rev


def project_is_stale(db: Database, project_row: Dict[str, Any]) -> bool:
    """آیا پروژه با نرخ قدیمی محاسبه شده و نیاز به بازمحاسبه دارد؟"""
    try:
        rev = int(float(project_row.get("rates_rev") or 0))
    except (TypeError, ValueError):
        rev = 0
    return rev < current_prices_rev(db)


# ---------------------------------------------------------------------------
# بازمحاسبه
# ---------------------------------------------------------------------------

def _engine(db: Database) -> costing.CostingEngine:
    return costing.CostingEngine(MaterialRepo(db).all(), db.all_settings())


def recalc_project(db: Database, row: Dict[str, Any],
                   engine: Optional[costing.CostingEngine] = None,
                   rev: Optional[int] = None) -> Dict[str, Any]:
    """
    بازمحاسبه‌ی یک پروژه با نرخ‌های جاری و ذخیره‌ی نتیجه.

    خروجی: سبک (id, final_price, total_cost, rates_rev, stale=False)
    """
    engine = engine or _engine(db)
    rev = current_prices_rev(db) if rev is None else rev
    repo = ProjectRepo(db)
    pid = int(row["id"])
    pages = repo.load_pages(pid)

    def _f(key: str, default: float = 0.0) -> float:
        try:
            return float(row.get(key) or default)
        except (TypeError, ValueError):
            return float(default)

    res = engine.calc_project(
        pages,
        install_mode=str(row.get("install_mode") or "none"),
        install_value=_f("install_value"),
        profit_mode=str(row.get("profit_mode") or "markup"),
        profit_percent=_f("profit_percent"),
        discount_percent=_f("discount_percent"),
        discount_amount=_f("discount_amount"),
        vat_enabled=bool(int(_f("vat_enabled"))),
        vat_percent=_f("vat_percent"),
        extra_fixed_amount=_f("extra_fixed_amount"),
    )
    final_price = round(float(res.final_price), 2)
    total_cost = round(float(res.total_cost), 2)
    repo.update(pid, {
        "final_price": final_price,
        "total_cost": total_cost,
        "rates_rev": rev,
    })
    return {
        "id": pid, "final_price": final_price, "total_cost": total_cost,
        "rates_rev": rev, "stale": False,
    }


def recalc_all_projects(db: Optional[Database] = None,
                        only_stale: bool = False) -> List[Dict[str, Any]]:
    """
    بازمحاسبه‌ی همه‌ی پروژه‌ها با نرخ‌های جاری متریال.

    فقط قیمت نهایی و هزینه‌ی تمام‌شده به‌روز می‌شود؛ ساختار پروژه
    (یونیت‌ها، متریال‌های انتخابی، تخفیف، مالیات و…) دست‌نخورده می‌ماند.
    """
    db = db or Database.instance()
    repo = ProjectRepo(db)
    rows = repo.all()
    rev = current_prices_rev(db)
    if only_stale:
        rows = [r for r in rows if int(float(r.get("rates_rev") or 0)) < rev]
    if not rows:
        return []
    engine = _engine(db)
    out: List[Dict[str, Any]] = []
    for row in rows:
        try:
            out.append(recalc_project(db, row, engine=engine, rev=rev))
        except Exception:                            # noqa: BLE001
            # یک پروژه‌ی خراب نباید کل بازمحاسبه را متوقف کند
            db.log("error", f"بازمحاسبه‌ی پروژه #{row.get('id')} ناموفق بود")
    if out:
        db.log("recalc", f"بازمحاسبه‌ی {len(out)} پروژه با نرخ‌های جاری (rev={rev})")
    return out


def light_projects(db: Database) -> List[Dict[str, Any]]:
    """فهرست سبک پروژه‌ها (فقط فیلدهای مالی) برای به‌روزرسانی رابط وب."""
    rev = current_prices_rev(db)
    out = []
    for r in ProjectRepo(db).all():
        try:
            rates_rev = int(float(r.get("rates_rev") or 0))
        except (TypeError, ValueError):
            rates_rev = 0
        out.append({
            "id": int(r["id"]),
            "final_price": round(float(r.get("final_price") or 0), 2),
            "total_cost": round(float(r.get("total_cost") or 0), 2),
            "rates_rev": rates_rev,
            "stale": rates_rev < rev,
        })
    return out
