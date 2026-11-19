# -*- coding: utf-8 -*-
"""خواندن فایل پروژه‌ی CutMaster 2D (فرمت cm2d_root) و مقایسه با برش‌نامه‌ی ما
=================================================================================
چرا این فایل مهم است: کارگاه ورق‌ها را در CutMaster 2D بهینه می‌کند؛ اگر
فایلِ ذخیره‌شده‌ی همان پروژه را بتوانیم بخوانیم، دو چیز دست می‌دهد:

۱) **مغایرت‌گیری** — قطعاتِ CutMaster را با برش‌نامه‌ی خودمان سنجیده‌ایم؛
   هر قطعه‌ای که در یکی باشد و در دیگری نباشد = اشتباهِ تایپ که باید قبل
   از ارّه گرفته شود، نه بعد از آن.
۲) **واقعیتِ ورق** — تعداد ورقِ مصرف‌شده، بازده و نقشه‌ی واقعیِ چیده‌ماندن
   (diagrams) — تا قیمتِ فروش با واقعیتِ کارگاه سنجیده شود.

واحدها (از فایل نمونه و مستندات قالب):
  * ``measure=1`` → سانتی‌متر برای ``tab_sheets``/``tab_parts``
  * مختصاتِ ``diagrams`` بر حسب دهمِ میلی‌متر است (۹۱۸۳ = ۹۱۸٫۳ میلی‌متر)
  * ``enb`` در ``elements`` شماره‌ی قطعه در ``tab_parts`` است (از ۱)
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Any, Dict, List

#: تلورانسِ برابر دانستن دو قطعه (میلی‌متر) — اختلافِ گردکردنِ ۰٫۰۱ سانتی
CMP_TOL_MM = 1.5


class CutMasterError(Exception):
    """خطای قابل‌نمایش به کاربر در خواندن فایل CutMaster."""


def _f(node, tag: str, default: float = 0.0) -> float:
    try:
        return float(node.findtext(tag, "").strip() or default)
    except (TypeError, ValueError):
        return default


def _i(node, tag: str, default: int = 0) -> int:
    try:
        return int(float(node.findtext(tag, "").strip() or default))
    except (TypeError, ValueError):
        return default


def parse_cm2d(xml_text: str) -> Dict[str, Any]:
    """فایل cm2d_root را می‌خواند و به ساختارِ ساده‌ی JSON-پسند برمی‌گرداند."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise CutMasterError(f"فایل XML قابل خواندن نبود: {exc}") from exc
    if root.tag != "cm2d_root":
        raise CutMasterError("این فایل پروژه‌ی CutMaster 2D نیست (cm2d_root یافت نشد).")

    job = root.find("job")
    if job is None:
        raise CutMasterError("ساختار فایل ناقص است — «job» یافت نشد.")
    data = job.find("data")
    if data is None:
        raise CutMasterError("ساختار فایل ناقص است — «data» یافت نشد.")

    measure = _i(job, "measure", 1)

    # ---------------- آمار ----------------
    stats_node = data.find("stats")
    stats = {
        "parts": _i(stats_node, "parts") if stats_node is not None else 0,
        "used_sheets": _i(stats_node, "used_sheets") if stats_node is not None else 0,
        "average_yield": _f(stats_node, "average_yield") if stats_node is not None else 0.0,
        "last_sheet_yield": _f(stats_node, "last_sheet_yield") if stats_node is not None else 0.0,
        "cut_length_m": _f(stats_node, "cut_length") if stats_node is not None else 0.0,
        "part_area_sqm": round(
            (_f(stats_node, "part_area") if stats_node is not None else 0.0) / 10000.0, 3),
    }

    # ---------------- ورق‌ها ----------------
    sheets: List[Dict[str, Any]] = []
    tab_sheets = data.find("tab_sheets")
    if tab_sheets is not None:
        for sh in tab_sheets.findall("sheet"):
            sheets.append({
                "len_cm": _f(sh, "len"),
                "wid_cm": _f(sh, "wid"),
                "qty": _i(sh, "qty"),
                "descr": (sh.findtext("descr") or "").strip(),
            })

    # ---------------- قطعات (نوع‌های یکتا با تعداد) ----------------
    parts: List[Dict[str, Any]] = []
    tab_parts = data.find("tab_parts")
    if tab_parts is not None:
        for p in tab_parts.findall("part"):
            L, W = _f(p, "len"), _f(p, "wid")
            big, small = max(L, W), min(L, W)
            edges = []
            for tag in ("bl1", "bl2", "bw1", "bw2"):
                e = p.find(tag)
                if e is not None and (e.get("val") or "").strip() not in ("", "-"):
                    edges.append(tag)
            parts.append({
                "idx": len(parts) + 1,
                "len_cm": L, "wid_cm": W,
                "big_mm": round(big * 10), "small_mm": round(small * 10),
                "qty": _i(p, "qty", 1),
                "rot": _i(p, "rot"),
                "banding_edges": edges,
            })

    # ---------------- نقشه‌ی چیده‌ماندن ----------------
    diagrams: List[Dict[str, Any]] = []
    dg = data.find("diagrams")
    if dg is not None:
        per_sheet: Dict[int, List[Dict[str, Any]]] = {}
        els = dg.find("elements")
        if els is not None:
            for e in els.findall("e"):
                tnb = _i(e, "tnb", 1)
                x, y = _f(e, "x"), _f(e, "y")
                x1, y1 = _f(e, "x1"), _f(e, "y1")
                # دهمِ میلی‌متر → میلی‌متر
                pieces = per_sheet.setdefault(tnb, [])
                pieces.append({
                    "part": _i(e, "enb", 0),
                    "x_mm": round(x / 10, 1), "y_mm": round(y / 10, 1),
                    "w_mm": round((x1 - x) / 10, 1), "h_mm": round((y1 - y) / 10, 1),
                    "rot": _i(e, "rot"),
                })
        offcuts: Dict[int, List[Dict[str, Any]]] = {}
        ocs = dg.find("offcuts")
        if ocs is not None:
            for o in ocs.findall("o"):
                tnb = _i(o, "tnb", 1)
                x, y, x1, y1 = _f(o, "x"), _f(o, "y"), _f(o, "x1"), _f(o, "y1")
                lst = offcuts.setdefault(tnb, [])
                lst.append({
                    "x_mm": round(x / 10, 1), "y_mm": round(y / 10, 1),
                    "w_mm": round((x1 - x) / 10, 1), "h_mm": round((y1 - y) / 10, 1),
                })
        for tnb in sorted(per_sheet):
            sh = sheets[tnb - 1] if 0 < tnb <= len(sheets) else {}
            len_mm = round((sh.get("len_cm") or 0) * 10)
            wid_mm = round((sh.get("wid_cm") or 0) * 10)
            if not len_mm or not wid_mm:
                # ★ tab_sheets «نوعِ» ورق را نگه می‌دارد نه هر ورقِ مصرفی را؛
                #   اگر شماره‌ی ورق (tnb) به نوعی نیفتد، اندازه را از بیشینه‌ی
                #   مختصاتِ قطعات و پرت‌های همان ورق به دست می‌آوریم.
                xs, ys = [0.0], [0.0]
                for e in per_sheet[tnb]:
                    xs.append(e["x_mm"] + e["w_mm"]); ys.append(e["y_mm"] + e["h_mm"])
                for o in offcuts.get(tnb, []):
                    xs.append(o["x_mm"] + o["w_mm"]); ys.append(o["y_mm"] + o["h_mm"])
                len_mm, wid_mm = round(max(xs)), round(max(ys))
            diagrams.append({
                "tnb": tnb,
                "len_mm": len_mm,
                "wid_mm": wid_mm,
                "pieces": per_sheet[tnb],
                "offcuts": offcuts.get(tnb, []),
            })

    return {
        "type": (root.findtext("type") or "").strip(),
        "version": (root.findtext("version") or "").strip(),
        "client": (job.findtext("client_name") or "").strip(),
        "measure": measure,
        "stats": stats,
        "sheets": sheets,
        "parts": parts,
        "diagrams": diagrams,
    }


def _norm(mm: float) -> float:
    """قطعِ اعداد روی ۰٫۵ میلی‌متر برای مقایسه‌ی بی‌دردسر."""
    return round(float(mm) * 2) / 2


def compare_with_our_parts(cm: Dict[str, Any],
                           our_parts: List[Dict[str, Any]],
                           tol_mm: float = CMP_TOL_MM) -> Dict[str, Any]:
    """
    مقایسه‌ی قطعاتِ CutMaster با برش‌نامه‌ی خودمان.

    ``our_parts``: خروجیِ ``build_workshop_pack()["cut_parts"]`` — هر ردیف
    ``length_mm`` (بعد بزرگ) و ``width_mm`` دارد. قطعاتِ CM از قبل به
    (بزرگ، کوچک) نرمال شده‌اند؛ این‌جا فقط تطبیقِ با تلورانس می‌کنیم.
    """
    cm_pool = []            # [ [big, small, باقی‌مانده‌ی qty], ... ]
    for p in cm.get("parts", []):
        cm_pool.append([_norm(p["big_mm"]), _norm(p["small_mm"]), int(p["qty"]), p])

    matched: List[Dict[str, Any]] = []
    ours_only: List[Dict[str, Any]] = []
    total_ours = total_matched = 0

    for o in our_parts:
        qty = int(o.get("qty") or 0)
        total_ours += qty
        rawL, rawW = float(o.get("length_mm") or 0), float(o.get("width_mm") or 0)
        L, W = _norm(max(rawL, rawW)), _norm(min(rawL, rawW))
        left = qty
        # تطبیق با تلورانس — نزدیک‌ترین کاندید اول
        cands = sorted(
            (c for c in cm_pool if c[2] > 0
             and abs(c[0] - L) <= tol_mm and abs(c[1] - W) <= tol_mm),
            key=lambda c: abs(c[0] - L) + abs(c[1] - W))
        for c in cands:
            if left <= 0:
                break
            take = min(left, c[2])
            c[2] -= take
            left -= take
            total_matched += take
            matched.append({
                "part": o.get("part", ""), "unit": o.get("unit", ""),
                "length_mm": L, "width_mm": W, "our_qty": qty, "cm_qty": take,
                "diff": qty - take,
            })
        if left > 0:
            ours_only.append({
                "part": o.get("part", ""), "unit": o.get("unit", ""),
                "length_mm": L, "width_mm": W, "qty": left,
            })

    cm_only = [
        {"idx": c[3]["idx"], "length_mm": c[0], "width_mm": c[1], "qty": c[2]}
        for c in cm_pool if c[2] > 0
    ]
    total_cm = sum(int(p["qty"]) for p in cm.get("parts", []))
    return {
        "total_ours": total_ours,
        "total_cm": total_cm,
        "matched_pieces": total_matched,
        "matched": matched,
        "ours_only": ours_only,
        "cm_only": cm_only,
        "ok": not ours_only and not cm_only,
    }
