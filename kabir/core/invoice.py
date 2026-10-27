# -*- coding: utf-8 -*-
"""
صدور فاکتور / پیش‌فاکتور حرفه‌ای
================================
سه خروجی:
  ۱) داده‌ی ساخت‌یافته (برای نمایش در رابط کاربری با قابلیت فیلتر ردیف‌ها)
  ۲) HTML (برای چاپ و پیش‌نمایش)
  ۳) PDF (با فونت فارسی وزیرمتن، راست‌به‌چپ) — در ماژول invoice_pdf
"""

from __future__ import annotations

import html as html_lib
import os
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import persian as fa
from .costing import LineItem, ProjectResult

GROUP_ORDER = [
    "ورق بدنه", "فیبر پشت", "ورق در", "مدل و اجرت در", "جعبه‌ی کشو", "تیره‌ی کشو",
    "صفحه کابینت", "تاج", "زیرچراغ", "پاخور",
    "نوار PVC بدنه", "نوار PVC در", "نوار PVC کشو",
    "لولا", "گازور / جک", "خار طبقه", "دستگیره", "پایه", "ریل کشو",
    "درنما", "اضافات و اکسسوری", "مونتاژ و خدمات", "خدمات", "نصب و حمل",
]

KIND_LABELS = {"quote": "پیش‌فاکتور", "invoice": "فاکتور فروش", "proforma": "پیش‌فاکتور رسمی"}


# ===========================================================================
# ۱) ساخت داده‌ی فاکتور
# ===========================================================================

def build_invoice_data(result: ProjectResult, project: Dict[str, Any],
                       settings: Dict[str, str], *,
                       mode: str = "grouped",
                       hidden: Optional[List[str]] = None,
                       invoice_number: str = "",
                       kind: str = "quote") -> Dict[str, Any]:
    """
    ساخت ساختار فاکتور.

    mode:
      grouped  → ردیف‌ها بر اساس نوع هزینه تجمیع می‌شوند (مناسب مشتری)
      detailed → هر قلم جداگانه با سرتیتر گروه (مناسب بررسی داخلی)
      summary  → فقط جمع‌های کل
    """
    hidden = set(hidden or [])
    items: List[Dict[str, Any]] = []

    def add(key, title, detail, qty, unit, unit_price, amount, group=""):
        if key in hidden:
            return
        items.append({"key": key, "title": title, "detail": detail, "qty": float(qty or 0),
                      "unit": unit or "", "unit_price": float(unit_price or 0),
                      "amount": float(amount or 0), "group": group or title})

    groups = _group_items(result.items)

    if mode == "detailed":
        for it in result.items:
            if not it.visible or it.key in hidden:
                continue
            add(it.key, it.title, it.detail, it.qty, it.unit_label,
                it.unit_price, it.amount, it.group)
    elif mode == "summary":
        for gname, rows in groups.items():
            add(gname, gname, f"{len(rows)} قلم", sum(r.qty for r in rows), "",
                0.0, sum(r.amount for r in rows), gname)
    else:
        for gname, rows in groups.items():
            if gname in hidden:
                continue
            names = _unique([r.title for r in rows])
            title = " / ".join(names[:3]) + ("…" if len(names) > 3 else "")
            amount = sum(r.amount for r in rows)
            qty = _smart_qty(rows)
            units = _unique([r.unit_label for r in rows])
            add(gname, title or gname, _merge_details(rows), qty,
                units[0] if len(units) == 1 else "",
                (amount / qty) if qty else 0.0, amount, gname)

    totals = {
        "pages_cost": result.pages_cost,
        "installation": result.installation_cost,
        "total_cost": result.total_cost,
        "profit_mode": result.profit_mode,
        "profit_percent": result.profit_percent,
        "profit_amount": result.profit_amount,
        "gross_price": result.gross_price,
        "discount_percent": result.discount_percent,
        "discount_amount": result.discount_amount,
        "net_price": result.net_price,
        "vat_percent": result.vat_percent,
        "vat_amount": result.vat_amount,
        "final_price": result.final_price,
        "stats": result.stats,
    }

    return {
        "kind": kind,
        "kind_label": KIND_LABELS.get(kind, "پیش‌فاکتور"),
        "number": invoice_number or "",
        "date_fa": fa.jdate_str(),
        "date_en": datetime.now().strftime("%Y-%m-%d"),
        "time": datetime.now().strftime("%H:%M"),
        "valid_until": project.get("valid_until", "") or "",
        "title": settings.get("invoice_title", "پیش‌فاکتور"),
        "project_title": project.get("title", "") or "",
        "project_code": project.get("code", "") or "",
        "customer": {
            "name": project.get("customer_name", "") or "",
            "phone": project.get("customer_phone", "") or "",
            "mobile": project.get("customer_mobile", "") or "",
            "address": project.get("customer_address", "") or "",
        },
        "seller": {
            "name": settings.get("company_name", "") or "",
            "manager": settings.get("company_manager", "") or "",
            "phone": settings.get("company_phone", "") or "",
            "mobile": settings.get("company_mobile", "") or "",
            "address": settings.get("company_address", "") or "",
            "email": settings.get("company_email", "") or "",
            "web": settings.get("company_web", "") or "",
            "logo": settings.get("company_logo", "") or "",
        },
        "mode": mode,
        "currency": settings.get("currency", "ریال"),
        "scale": float(settings.get("currency_scale", "1") or 1),
        "items": items,
        "totals": totals,
        "footer_note": settings.get("invoice_footer_note", ""),
        "show_cost": bool(project.get("show_cost", False)),
        "show_stats": bool(project.get("show_stats", True)),
        "note": project.get("note", "") or "",
        "persian_digits": str(settings.get("persian_digits", "1")) == "1",
        "generated_by": "نرم‌افزار کبیر — محاسبه‌گر قیمت تمام‌شده‌ی کابینت",
    }


def _group_items(items: List[LineItem]) -> "Dict[str, List[LineItem]]":
    groups: Dict[str, List[LineItem]] = {}
    for it in items:
        if not it.visible or abs(it.amount) < 0.0001:
            continue
        groups.setdefault(it.group or it.title, []).append(it)
    ordered: Dict[str, List[LineItem]] = {}
    for g in GROUP_ORDER:
        if g in groups:
            ordered[g] = groups.pop(g)
    for g, rows in groups.items():
        ordered[g] = rows
    return ordered


def _unique(seq: List[str]) -> List[str]:
    out: List[str] = []
    for x in seq:
        if x and x not in out:
            out.append(x)
    return out


def _smart_qty(rows: List[LineItem]) -> float:
    units = _unique([r.unit_label for r in rows])
    if len(units) == 1:
        return sum(r.qty for r in rows)
    return float(len(rows))


def _merge_details(rows: List[LineItem], limit: int = 2) -> str:
    ds = _unique([r.detail for r in rows if r.detail])
    if not ds:
        return ""
    if len(ds) == 1:
        return ds[0]
    joined = "؛ ".join(ds[:limit])
    return f"{len(rows)} قلم — {joined}" + ("…" if len(ds) > limit else "")


def group_titles(data: Dict[str, Any]) -> List[str]:
    """لیست گروه‌های موجود در فاکتور (برای فیلتر کردن ردیف‌ها)."""
    return _unique([it["group"] for it in data.get("items", [])])


# ===========================================================================
# ابزارهای قالب‌بندی
# ===========================================================================

def num(v: float, data: Dict[str, Any], decimals: int = 0) -> str:
    return fa.fmt_number(float(v or 0) / float(data.get("scale", 1) or 1),
                         decimals=decimals, persian=bool(data.get("persian_digits", True)))


def money(v: float, data: Dict[str, Any], with_unit: bool = True) -> str:
    s = num(v, data)
    return f"{s} {data.get('currency', '')}".strip() if with_unit else s


def qty_str(v: float, data: Dict[str, Any]) -> str:
    decimals = 2 if abs(float(v or 0) % 1) > 1e-9 else 0
    return num(v, data, decimals)


# ===========================================================================
# ۲) خروجی HTML (پیش‌نمایش و چاپ)
# ===========================================================================

CSS = """
  @page { size: A4; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Vazirmatn","Vazir","Tahoma","Segoe UI",sans-serif;
    background:#fff; color:#16202c; margin:0; padding:18px;
    font-size:12.5px; line-height:1.75; direction:rtl;
  }
  .sheet { max-width: 210mm; margin:auto; background:#fff; }
  .head { display:flex; justify-content:space-between; align-items:flex-start;
          border-bottom:3px solid __ACCENT__; padding-bottom:12px; gap:16px; }
  .brand h1 { margin:0; font-size:21px; color:__ACCENT__; font-weight:800; }
  .brand .sub { color:#5c6a80; font-size:11px; margin-top:4px; max-width:110mm; }
  .meta { text-align:left; font-size:11.5px; color:#33414f; white-space:nowrap; }
  .meta .doc { background:__ACCENT__; color:#fff; padding:4px 14px; border-radius:8px;
               font-weight:800; font-size:15px; display:inline-block; margin-bottom:6px; }
  .parties { display:flex; gap:12px; margin:14px 0; }
  .party { flex:1; border:1px solid #dde3ec; border-radius:10px; padding:10px 12px; background:#fafbfd; }
  .party h3 { margin:0 0 6px; font-size:12px; color:__ACCENT__; font-weight:800;
              border-bottom:1px dashed #cfd8e4; padding-bottom:5px; }
  .party p { margin:2px 0; font-size:11.5px; }
  table.items { width:100%; border-collapse:collapse; margin-top:6px; }
  table.items th, table.items td { border:1px solid #dfe6ef; padding:7px 8px;
                                   text-align:center; vertical-align:middle; }
  table.items th { background:__SOFT__; color:__DARK__; font-weight:800; font-size:11.5px; }
  table.items td.r { text-align:right; }
  table.items tbody tr:nth-child(even) { background:#fafbfd; }
  .detail { font-size:10.5px; color:#6b7a8d; }
  .grp td { background:__GROUPBG__; font-weight:800; color:__DARK__; text-align:right; }
  .totals { display:flex; justify-content:flex-end; margin-top:12px; }
  .totals table { width:64%; border-collapse:collapse; }
  .totals td { border:none; padding:5px 10px; font-size:12.5px; }
  .totals td.lbl { color:#5c6a80; text-align:right; }
  .totals td.val { text-align:left; font-weight:700; min-width:140px; }
  tr.final td { background:__ACCENT__; color:#fff !important; font-size:15px; font-weight:800; }
  .words { margin-top:10px; border:1px dashed __ACCENT__; border-radius:10px;
           padding:8px 12px; background:__SOFT__; font-weight:700; color:__DARK__; }
  .stats { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
  .stat { border:1px solid #dde3ec; border-radius:9px; padding:6px 12px; background:#fafbfd;
          font-size:11px; text-align:center; }
  .stat b { color:__DARK__; font-size:13px; display:block; }
  .foot { margin-top:18px; border-top:2px solid __ACCENT__; padding-top:10px;
          font-size:10.5px; color:#5c6a80; display:flex; justify-content:space-between; gap:12px; }
  .sign { display:flex; justify-content:space-between; margin-top:30px; gap:20px; }
  .sign div { flex:1; text-align:center; border-top:1px solid #b9c4d2; padding-top:6px;
              font-size:11px; color:#5c6a80; }
  .note { margin-top:10px; font-size:11px; color:#5c6a80; }
  @media print { body { padding:0; } .noprint { display:none; } }
"""


def _esc(s: Any) -> str:
    return html_lib.escape("" if s is None else str(s))


def render_html(data: Dict[str, Any], accent: str = "#0f766e") -> str:
    """تولید HTML فاکتور (راست‌به‌چپ، آماده‌ی چاپ)."""
    currency = data.get("currency", "ریال")
    items = data.get("items", [])
    totals = data.get("totals", {})
    seller = data.get("seller", {})
    customer = data.get("customer", {})
    fa_digits = bool(data.get("persian_digits", True))

    # --- ردیف‌های جدول ---
    rows: List[str] = []
    idx = 0
    last_group = None
    detailed = data.get("mode") == "detailed"
    for it in items:
        title = _esc(it.get("title", ""))
        detail = _esc(it.get("detail", ""))
        detail_html = f"<div class='detail'>{detail}</div>" if detail else ""
        if detailed and it.get("group") and it["group"] != last_group:
            last_group = it["group"]
            rows.append(f"<tr class='grp'><td colspan='6'>{_esc(last_group)}</td></tr>")
        idx += 1
        n = fa.to_fa_digits(idx) if fa_digits else idx
        rows.append(
            "<tr>"
            f"<td>{n}</td>"
            f"<td class='r'><b>{title}</b>{detail_html}</td>"
            f"<td>{qty_str(it.get('qty', 0), data)}</td>"
            f"<td>{_esc(it.get('unit', ''))}</td>"
            f"<td>{num(it.get('unit_price', 0), data)}</td>"
            f"<td><b>{num(it.get('amount', 0), data)}</b></td>"
            "</tr>")
    if not rows:
        rows.append("<tr><td colspan='6' style='padding:22px;color:#8b97a8'>"
                    "ردیفی برای نمایش انتخاب نشده است.</td></tr>")

    # --- جمع‌ها ---
    def trow(label: str, value: str, cls: str = "") -> str:
        return f"<tr class='{cls}'><td class='lbl'>{_esc(label)}</td><td class='val'>{value}</td></tr>"

    total_rows: List[str] = []
    if data.get("show_cost"):
        total_rows.append(trow("جمع هزینه‌ی تمام‌شده", money(totals.get("total_cost", 0), data)))
    total_rows.append(trow("جمع کل اقلام", money(totals.get("total_cost", 0), data)))
    mode_lbl = "مارکاپ" if totals.get("profit_mode") == "markup" else "مارجین"
    total_rows.append(trow(f"سود ({mode_lbl} {num(totals.get('profit_percent', 0), data)}٪)",
                           money(totals.get("profit_amount", 0), data)))
    total_rows.append(trow("قیمت ناخالص", money(totals.get("gross_price", 0), data)))
    if totals.get("discount_amount"):
        lbl = "تخفیف"
        if totals.get("discount_percent"):
            lbl += f" ({num(totals['discount_percent'], data)}٪)"
        total_rows.append(trow(lbl, "− " + money(totals.get("discount_amount", 0), data)))
    if totals.get("vat_percent"):
        total_rows.append(trow(f"مالیات بر ارزش افزوده ({num(totals['vat_percent'], data)}٪)",
                               money(totals.get("vat_amount", 0), data)))
    total_rows.append(trow("مبلغ قابل پرداخت", money(totals.get("final_price", 0), data), "final"))

    # --- آمار فنی ---
    stats_block = ""
    if data.get("show_stats", True):
        st = totals.get("stats", {}) or {}
        stat_items = [
            ("تعداد یونیت", fa.fmt_number(st.get("total_units", 0), persian=fa_digits)),
            ("لنگه در", fa.fmt_number(st.get("total_doors", 0), persian=fa_digits)),
            ("کشو", fa.fmt_number(st.get("total_drawers", 0), persian=fa_digits)),
            ("متراژ زمینی", fa.fmt_number(st.get("total_ground_lm", 0), 2, fa_digits) + " م"),
            ("متراژ دیواری", fa.fmt_number(st.get("total_wall_lm", 0), 2, fa_digits) + " م"),
            ("ورق بدنه", fa.fmt_number(st.get("total_body_area", 0), 2, fa_digits) + " م²"),
            ("مساحت درها", fa.fmt_number(st.get("total_door_area", 0), 2, fa_digits) + " م²"),
            ("نوار PVC", fa.fmt_number(st.get("total_banding_m", 0), 1, fa_digits) + " م"),
            ("ورق مصرفی", fa.fmt_number(st.get("total_sheets", 0), persian=fa_digits) + " ورق"),
        ]
        stats_block = "<div class='stats'>" + "".join(
            f"<div class='stat'><b>{_esc(v)}</b>{_esc(k)}</div>" for k, v in stat_items) + "</div>"

    # --- سربرگ ---
    seller_bits = [p for p in [seller.get("address"),
                               ("تلفن: " + seller["phone"]) if seller.get("phone") else "",
                               ("همراه: " + seller["mobile"]) if seller.get("mobile") else "",
                               seller.get("email"), seller.get("web")] if p]
    customer_bits = [p for p in [("تلفن: " + customer["phone"]) if customer.get("phone") else "",
                                 ("همراه: " + customer["mobile"]) if customer.get("mobile") else "",
                                 ("نشانی: " + customer["address"]) if customer.get("address") else ""] if p]
    customer_html = "".join(f"<p>{_esc(b)}</p>" for b in customer_bits) or \
        "<p style='color:#8b97a8'>—</p>"
    valid_html = (f"<div>اعتبار تا: <b>{_esc(data['valid_until'])}</b></div>"
                  if data.get("valid_until") else "")
    note_html = f"<div class='note'>توضیحات: {_esc(data['note'])}</div>" if data.get("note") else ""

    css = (CSS.replace("__ACCENT__", accent)
              .replace("__SOFT__", "#e6f4f2")
              .replace("__DARK__", "#0b5d57")
              .replace("__GROUPBG__", "#eef4f3"))

    doc_title = _esc(data.get("kind_label") or data.get("title") or "پیش‌فاکتور")

    return f"""<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<title>{doc_title} — {_esc(data.get('number'))}</title>
<style>{css}</style>
</head>
<body>
<div class="sheet">
  <div class="head">
    <div class="brand">
      <h1>{_esc(seller.get('name') or '—')}</h1>
      <div class="sub">{_esc(' — '.join(seller_bits))}</div>
    </div>
    <div class="meta">
      <div class="doc">{doc_title}</div>
      <div>شماره: <b>{_esc(data.get('number') or '—')}</b></div>
      <div>تاریخ: <b>{_esc(data.get('date_fa'))}</b></div>
      {valid_html}
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <h3>مشتری</h3>
      <p><b>{_esc(customer.get('name') or 'مشتری گرامی')}</b></p>
      {customer_html}
    </div>
    <div class="party">
      <h3>اطلاعات پروژه</h3>
      <p><b>{_esc(data.get('project_title') or '—')}</b></p>
      <p>کد پروژه: {_esc(data.get('project_code') or '—')}</p>
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th style="width:36px">ردیف</th>
        <th>شرح کالا / خدمات</th>
        <th style="width:78px">تعداد</th>
        <th style="width:66px">واحد</th>
        <th style="width:120px">فی ({_esc(currency)})</th>
        <th style="width:140px">مبلغ کل ({_esc(currency)})</th>
      </tr>
    </thead>
    <tbody>
      {''.join(rows)}
    </tbody>
  </table>

  <div class="totals"><table>{''.join(total_rows)}</table></div>

  <div class="words">مبلغ قابل پرداخت به حروف:
    {_esc(fa.money_to_words(totals.get('final_price', 0), currency, float(data.get('scale', 1) or 1)))}
  </div>

  {stats_block}
  {note_html}

  <div class="sign">
    <div>مهر و امضای فروشنده</div>
    <div>امضای خریدار</div>
  </div>

  <div class="foot">
    <div>{_esc(data.get('footer_note'))}</div>
    <div>{_esc(data.get('generated_by'))}</div>
  </div>
</div>
</body>
</html>"""


def save_html(data: Dict[str, Any], path: Path, accent: str = "#0f766e") -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_html(data, accent), encoding="utf-8")
    return path


def temp_html(data: Dict[str, Any]) -> str:
    fd, p = tempfile.mkstemp(suffix=".html", prefix="kabir-invoice-")
    os.close(fd)
    Path(p).write_text(render_html(data), encoding="utf-8")
    return p
