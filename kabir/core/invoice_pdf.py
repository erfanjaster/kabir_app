# -*- coding: utf-8 -*-
"""خروجی PDF فاکتور با ReportLab — راست‌به‌چپ و با فونت فارسی وزیرمتن."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import re

from .. import config
from . import persian as fa
from .invoice import KIND_LABELS, num, qty_str

ACCENT = (0.059, 0.463, 0.431)        # #0f766e
ACCENT_SOFT = (0.902, 0.965, 0.957)   # #e6f4f2
DARK_TEXT = (0.118, 0.149, 0.200)
MUTED = (0.361, 0.416, 0.502)
BORDER = (0.867, 0.890, 0.925)
ZEBRA = (0.976, 0.984, 0.992)

_FONT: Dict[str, str] = {}


# ---------------------------------------------------------------------------
# فونت PDF
# ---------------------------------------------------------------------------

def _find_ttf() -> List[Tuple[str, Path]]:
    """پیدا کردن فایل‌های TTF فونت فارسی (همراه برنامه → کشو → سیستم)."""
    names = {
        "regular": ["Vazirmatn-Regular.ttf", "Vazirmatn.ttf", "Vazir.ttf"],
        "bold": ["Vazirmatn-Bold.ttf", "Vazirmatn-Bold.ttf"],
    }
    roots = [config.BUNDLED_FONTS_DIR, config.FONTS_CACHE_DIR]
    out: List[Tuple[str, Path]] = []
    for style, candidates in names.items():
        for root in roots:
            for cand in candidates:
                p = root / cand
                if p.exists() and p.stat().st_size > 1000:
                    out.append((style, p))
                    break
            else:
                continue
            break
    return out


def register_fonts() -> Tuple[str, str]:
    """ثبت فونت فارسی در ReportLab. خروجی: (نام فونت عادی، نام فونت پررنگ)."""
    global _FONT
    if _FONT:
        return _FONT.get("regular", "Helvetica"), _FONT.get("bold", "Helvetica-Bold")
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    reg = bold = None
    for style, path in _find_ttf():
        try:
            if style == "regular" and reg is None:
                pdfmetrics.registerFont(TTFont("KabirFa", str(path)))
                reg = "KabirFa"
            elif style == "bold" and bold is None:
                pdfmetrics.registerFont(TTFont("KabirFa-Bold", str(path)))
                bold = "KabirFa-Bold"
        except Exception:                       # noqa: BLE001
            continue
    if reg and not bold:
        bold = reg
    if not reg:
        # تلاش آخر: هر فونت فارسی روی سیستم
        for p in Path("/usr/share/fonts").rglob("*NaskhArabic*.ttf") if Path("/usr/share/fonts").exists() else []:
            try:
                from reportlab.pdfbase import pdfmetrics as pm
                from reportlab.pdfbase.ttfonts import TTFont as TTF
                pm.registerFont(TTF("KabirFa", str(p)))
                reg = bold = "KabirFa"
                break
            except Exception:                   # noqa: BLE001
                continue
    _FONT = {"regular": reg or "Helvetica", "bold": bold or reg or "Helvetica-Bold"}
    if reg and bold:
        try:
            from reportlab.pdfbase.pdfmetrics import registerFontFamily
            registerFontFamily(reg, normal=reg, bold=bold, italic=reg, boldItalic=bold)
        except Exception:                       # noqa: BLE001
            pass
    return _FONT["regular"], _FONT["bold"]


def shape(text: Any) -> str:
    """
    چسباندن حروف عربی/فارسی و معکوس‌سازی برای نمایش درست در PDF.

    نکته: اجراهای لاتین/رقمی (مثل شماره تلفن 021-12345678) با نشانه‌های
    RLM (U+200F) ایزوله می‌شوند تا ترتیبشان در متن راست‌به‌چپ حفظ شود؛
    کتابخانه‌ی python-bidi بدون این ایزوله‌سازی، ترتیب رقم‌ها را به‌هم می‌ریزد.
    """
    s = "" if text is None else str(text)
    if not s.strip():
        return s
    s = re.sub(r"[0-9A-Za-z][0-9A-Za-z._/@#+*\-]*",
               lambda m: "\u200f" + m.group(0) + "\u200f", s)
    try:
        import arabic_reshaper
        from bidi.algorithm import get_display
        return get_display(arabic_reshaper.reshape(s))
    except Exception:                           # noqa: BLE001
        return s


def _esc(text: Any) -> str:
    s = "" if text is None else str(text)
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def P(text: Any, bold: bool = False) -> str:
    """
    ساخت قطعه‌ی پاراگراف فارسی.
    نکته‌ی مهم: bidi باید «پیش از» افزودن تگ‌های HTML اعمال شود، وگرنه
    ترتیب تگ‌ها به‌هم می‌ریزد.
    """
    shaped = shape(_esc(text))
    return f"<b>{shaped}</b>" if bold else shaped


# ---------------------------------------------------------------------------
# ساخت PDF
# ---------------------------------------------------------------------------

def build_pdf(data: Dict[str, Any], out_path: Path, *, accent: Tuple[float, float, float] = ACCENT,
              paper: str = "A4") -> Path:
    """ساخت فایل PDF فاکتور."""
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate, Paragraph,
                                    SimpleDocTemplate, Spacer, Table, TableStyle)

    regular, bold = register_fonts()
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    pagesize = landscape(A4) if paper == "A4L" else A4
    doc = SimpleDocTemplate(str(out_path), pagesize=pagesize,
                            rightMargin=10 * mm, leftMargin=10 * mm,
                            topMargin=12 * mm, bottomMargin=14 * mm,
                            title=f"{data.get('kind_label', 'فاکتور')} {data.get('number', '')}",
                            author=data.get("seller", {}).get("name", "Kabir"))

    base = getSampleStyleSheet()

    def st(name: str, font: str, size: float, color=DARK_TEXT, align=TA_RIGHT,
           leading: Optional[float] = None, space_after: float = 0) -> ParagraphStyle:
        return ParagraphStyle(name, parent=base["Normal"], fontName=font, fontSize=size,
                              textColor=colors.Color(*color), alignment=align,
                              leading=leading or size * 1.55, spaceAfter=space_after,
                              wordWrap="RTL")

    S = {
        "brand": st("brand", bold, 16, accent, TA_RIGHT),
        "brandsub": st("BrandSub", regular, 7.6, MUTED, TA_RIGHT, leading=11),
        "doctitle": st("DocTitle", bold, 13, (1, 1, 1), TA_CENTER),
        "meta": st("meta", regular, 8.4, DARK_TEXT, TA_LEFT, leading=13),
        "metabold": st("MetaBold", bold, 8.4, DARK_TEXT, TA_LEFT, leading=13),
        "partytitle": st("PartyTitle", bold, 9, accent, TA_RIGHT),
        "party": st("party", regular, 8.4, DARK_TEXT, TA_RIGHT, leading=13),
        "partyb": st("partyb", bold, 8.8, DARK_TEXT, TA_RIGHT, leading=13),
        "partymuted": st("PartyMuted", regular, 8, MUTED, TA_RIGHT, leading=12),
        "th": st("th", bold, 8.6, (0.043, 0.365, 0.341), TA_CENTER, leading=12),
        "td": st("td", regular, 8.3, DARK_TEXT, TA_RIGHT, leading=12),
        "tdc": st("tdc", regular, 8.3, DARK_TEXT, TA_CENTER, leading=12),
        "tdbc": st("tdbc", bold, 8.4, DARK_TEXT, TA_CENTER, leading=12),
        "tdb": st("tdb", bold, 8.4, DARK_TEXT, TA_RIGHT, leading=12),
        "tiny": st("tiny", regular, 6.8, MUTED, TA_RIGHT, leading=10),
        "grp": st("grp", bold, 8.4, (0.043, 0.365, 0.341), TA_RIGHT, leading=12),
        "lbl": st("lbl", regular, 9, MUTED, TA_RIGHT, leading=14),
        "val": st("val", bold, 9, DARK_TEXT, TA_LEFT, leading=14),
        "final_lbl": st("FinalLbl", bold, 10.5, (1, 1, 1), TA_RIGHT, leading=16),
        "final_val": st("FinalVal", bold, 11.5, (1, 1, 1), TA_LEFT, leading=16),
        "words": st("words", bold, 9, (0.043, 0.365, 0.341), TA_RIGHT, leading=15),
        "statv": st("statv", bold, 8.8, (0.043, 0.365, 0.341), TA_CENTER, leading=12),
        "statk": st("statk", regular, 6.9, MUTED, TA_CENTER, leading=10),
        "note": st("note", regular, 8, MUTED, TA_RIGHT, leading=13),
        "sign": st("sign", regular, 8, MUTED, TA_CENTER, leading=13),
    }

    story: List[Any] = []
    W = pagesize[0] - 20 * mm
    totals = data.get("totals", {})
    seller = data.get("seller", {})
    customer = data.get("customer", {})
    cur = data.get("currency", "ریال")

    # ---------------- سربرگ ----------------
    seller_bits = [p for p in [seller.get("address"),
                               ("تلفن: " + seller["phone"]) if seller.get("phone") else "",
                               ("همراه: " + seller["mobile"]) if seller.get("mobile") else "",
                               " ".join([x for x in [seller.get("email"), seller.get("web")] if x])] if p]

    logo_flow = None
    logo_path = seller.get("logo")
    if logo_path and Path(logo_path).exists():
        try:
            from reportlab.platypus import Image as RLImage
            logo_flow = RLImage(str(logo_path), width=20 * mm, height=20 * mm, kind="proportional")
        except Exception:                       # noqa: BLE001
            logo_flow = None

    left_meta = [
        Paragraph(shape(data.get("number") or "—"), S["metabold"]),
        Paragraph(shape(data.get("date_fa", "")), S["meta"]),
    ]
    if data.get("valid_until"):
        left_meta.append(Paragraph(shape("اعتبار تا: " + str(data["valid_until"])), S["meta"]))

    doc_title = data.get("kind_label") or data.get("title") or KIND_LABELS.get(data.get("kind"), "پیش‌فاکتور")
    title_cell = Table([[Paragraph(shape(doc_title), S["doctitle"])]],
                       colWidths=[52 * mm], rowHeights=[9 * mm])
    title_cell.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.Color(*accent)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("ROUNDEDCORNERS", [3, 3, 3, 3]),
    ]))

    brand_name = Paragraph(shape(seller.get("name") or "—"), S["brand"])
    brand_sub = Paragraph(shape(" — ".join(seller_bits)), S["brandsub"])
    brand_text = Table([[brand_name], [brand_sub]], colWidths=[W * 0.55 - (22 * mm if logo_flow else 0)])
    brand_text.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0),
                                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                                    ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]))
    if logo_flow is not None:
        # در حالت RTL ستون اول سمت راست قرار می‌گیرد
        left_cell = Table([[brand_text, logo_flow]],
                          colWidths=[W * 0.55 - 22 * mm, 22 * mm])
        left_cell.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                       ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                       ("RIGHTPADDING", (0, 0), (-1, -1), 4)]))
    else:
        left_cell = brand_text

    right_cell = Table([[title_cell], [Table([[x] for x in left_meta], colWidths=[W * 0.33])]],
                       colWidths=[W * 0.42])
    right_cell.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "LEFT"),
                                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                    ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                                    ("TOPPADDING", (0, 0), (-1, -1), 0)]))

    # در RTL: ستون اول = سمت راست صفحه
    header = Table([[right_cell, left_cell]], colWidths=[W * 0.44, W * 0.56])
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 1.4, colors.Color(*accent)),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(header)
    story.append(Spacer(1, 5 * mm))

    # ---------------- طرفین ----------------
    cust_rows = [[Paragraph(shape("مشتری"), S["partytitle"])],
                 [Paragraph(shape(customer.get("name") or "مشتری گرامی"), S["partyb"])]]
    for label, key in (("تلفن", "phone"), ("همراه", "mobile"), ("نشانی", "address")):
        if customer.get(key):
            cust_rows.append([Paragraph(shape(f"{label}: {customer[key]}"), S["partymuted"])])
    cust_tbl = Table(cust_rows, colWidths=[W * 0.47])

    prj_rows = [[Paragraph(shape("اطلاعات پروژه"), S["partytitle"])],
                [Paragraph(shape(data.get("project_title") or "—"), S["partyb"])],
                [Paragraph(shape("کد پروژه: " + (data.get("project_code") or "—")), S["partymuted"])]]
    if data.get("mode"):
        mode_lbl = {"grouped": "گروه‌بندی‌شده", "detailed": "ریز اقلام", "summary": "خلاصه"}.get(data["mode"], "")
        prj_rows.append([Paragraph(shape("سطح نمایش: " + mode_lbl), S["partymuted"])])
    prj_tbl = Table(prj_rows, colWidths=[W * 0.47])

    for t in (cust_tbl, prj_tbl):
        t.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.8, colors.Color(*BORDER)),
            ("BACKGROUND", (0, 0), (-1, -1), colors.Color(0.980, 0.984, 0.992)),
            ("ROUNDEDCORNERS", [6, 6, 6, 6]),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))

    parties = Table([[prj_tbl, cust_tbl]], colWidths=[W * 0.5, W * 0.5])
    parties.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                 ("LEFTPADDING", (0, 0), (-1, -1), 3),
                                 ("RIGHTPADDING", (0, 0), (-1, -1), 3)]))
    story.append(parties)
    story.append(Spacer(1, 5 * mm))

    # ---------------- جدول اقلام ----------------
    # ترتیب ستون‌ها راست‌به‌چپ: ردیف | شرح | تعداد | واحد | فی | مبلغ کل
    header_row = [Paragraph(shape("ردیف"), S["th"]), Paragraph(shape("شرح کالا / خدمات"), S["th"]),
                  Paragraph(shape("تعداد"), S["th"]), Paragraph(shape("واحد"), S["th"]),
                  Paragraph(shape(f"فی ({cur})"), S["th"]),
                  Paragraph(shape(f"مبلغ کل ({cur})"), S["th"])]
    col_widths = [11 * mm, W - (11 + 18 + 16 + 30 + 34) * mm, 18 * mm, 16 * mm, 30 * mm, 34 * mm]
    rows: List[List[Any]] = [header_row]
    style_cmds: List[Tuple] = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.Color(*ACCENT_SOFT)),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.Color(*BORDER)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]
    r = 1
    idx = 0
    detailed = data.get("mode") == "detailed"
    last_group = None
    items = data.get("items", [])
    for it in items:
        title = str(it.get("title", ""))
        detail = str(it.get("detail", ""))
        cell_txt = P(title, bold=True)
        if detail:
            cell_txt += f"<br/><font size=6.6 color='#6b7a8d'>{P(detail)}</font>"
        if detailed and it.get("group") and it["group"] != last_group:
            last_group = it["group"]
            rows.append([Paragraph(shape(last_group), S["grp"]), "", "", "", "", ""])
            style_cmds.append(("SPAN", (0, r), (-1, r)))
            style_cmds.append(("BACKGROUND", (0, r), (-1, r), colors.Color(0.937, 0.957, 0.953)))
            r += 1
        idx += 1
        rows.append([
            Paragraph(shape(str(fa.to_fa_digits(idx) if data.get("persian_digits") else idx)), S["tdc"]),
            Paragraph(cell_txt, S["td"]),
            Paragraph(shape(qty_str(it.get("qty", 0), data)), S["tdc"]),
            Paragraph(shape(str(it.get("unit", ""))), S["tdc"]),
            Paragraph(shape(num(it.get("unit_price", 0), data)), S["tdc"]),
            Paragraph(shape(num(it.get("amount", 0), data)), S["tdbc"]),
        ])
        if idx % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, r), (-1, r), colors.Color(*ZEBRA)))
        r += 1

    if idx == 0:
        rows.append([Paragraph(shape("ردیفی برای نمایش انتخاب نشده است."), S["tdc"]), "", "", "", "", ""])
        style_cmds.append(("SPAN", (0, r), (-1, r)))
        r += 1

    tbl = Table(rows, colWidths=col_widths, repeatRows=1)
    tbl.setStyle(TableStyle(style_cmds))
    story.append(tbl)
    story.append(Spacer(1, 5 * mm))

    # ---------------- جمع‌ها ----------------
    def trow(label: str, value: str, final: bool = False):
        ls = S["final_lbl"] if final else S["lbl"]
        vs = S["final_val"] if final else S["val"]
        return [Paragraph(shape(label), ls), Paragraph(shape(value), vs)]

    trows: List[List[Any]] = []
    tcmds: List[Tuple] = []
    if data.get("show_cost"):
        trows.append(trow("جمع هزینه‌ی تمام‌شده", f"{num(totals.get('total_cost', 0), data)} {cur}"))
    trows.append(trow("جمع کل اقلام", f"{num(totals.get('total_cost', 0), data)} {cur}"))
    mode_lbl = "مارکاپ" if totals.get("profit_mode") == "markup" else "مارجین"
    trows.append(trow(f"سود ({mode_lbl} {num(totals.get('profit_percent', 0), data)}٪)",
                      f"{num(totals.get('profit_amount', 0), data)} {cur}"))
    trows.append(trow("قیمت ناخالص", f"{num(totals.get('gross_price', 0), data)} {cur}"))
    if totals.get("discount_amount"):
        lbl = "تخفیف"
        if totals.get("discount_percent"):
            lbl += f" ({num(totals['discount_percent'], data)}٪)"
        trows.append(trow(lbl, f"− {num(totals.get('discount_amount', 0), data)} {cur}"))
    if totals.get("vat_percent"):
        trows.append(trow(f"مالیات بر ارزش افزوده ({num(totals['vat_percent'], data)}٪)",
                          f"{num(totals.get('vat_amount', 0), data)} {cur}"))
    final_idx = len(trows)
    trows.append(trow("مبلغ قابل پرداخت", f"{num(totals.get('final_price', 0), data)} {cur}", final=True))
    tcmds.append(("BACKGROUND", (0, final_idx), (-1, final_idx), colors.Color(*accent)))
    tcmds.append(("ROUNDEDCORNERS", [4, 4, 4, 4]))
    for i in range(len(trows)):
        tcmds.append(("TOPPADDING", (0, i), (-1, i), 3))
        tcmds.append(("BOTTOMPADDING", (0, i), (-1, i), 3))

    totals_tbl = Table(trows, colWidths=[42 * mm, 48 * mm])
    totals_tbl.setStyle(TableStyle(tcmds + [("LEFTPADDING", (0, 0), (-1, -1), 6),
                                            ("RIGHTPADDING", (0, 0), (-1, -1), 6)]))
    totals_wrap = Table([["", totals_tbl]], colWidths=[W - 92 * mm, 92 * mm])
    totals_wrap.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                     ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                     ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    story.append(totals_wrap)
    story.append(Spacer(1, 4 * mm))

    # ---------------- مبلغ به حروف ----------------
    words = fa.money_to_words(totals.get("final_price", 0), cur, float(data.get("scale", 1) or 1))
    wtbl = Table([[Paragraph(shape(f"مبلغ قابل پرداخت به حروف: {words}"), S["words"])]], colWidths=[W])
    wtbl.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.9, colors.Color(*accent)),
        ("BACKGROUND", (0, 0), (-1, -1), colors.Color(*ACCENT_SOFT)),
        ("ROUNDEDCORNERS", [6, 6, 6, 6]),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(wtbl)
    story.append(Spacer(1, 4 * mm))

    # ---------------- آمار فنی ----------------
    if data.get("show_stats", True):
        stt = totals.get("stats", {}) or {}
        p = bool(data.get("persian_digits", True))
        cells = [
            ("تعداد یونیت", fa.fmt_number(stt.get("total_units", 0), persian=p)),
            ("لنگه در", fa.fmt_number(stt.get("total_doors", 0), persian=p)),
            ("کشو", fa.fmt_number(stt.get("total_drawers", 0), persian=p)),
            ("متراژ زمینی", fa.fmt_number(stt.get("total_ground_lm", 0), 2, p) + " م"),
            ("متراژ دیواری", fa.fmt_number(stt.get("total_wall_lm", 0), 2, p) + " م"),
            ("ورق بدنه", fa.fmt_number(stt.get("total_body_area", 0), 2, p) + " م²"),
            ("مساحت درها", fa.fmt_number(stt.get("total_door_area", 0), 2, p) + " م²"),
            ("نوار PVC", fa.fmt_number(stt.get("total_banding_m", 0), 1, p) + " م"),
            ("ورق مصرفی", fa.fmt_number(stt.get("total_sheets", 0), persian=p)),
        ]
        n = len(cells)
        cw = W / n
        stat_tbl = Table([
            [Paragraph(shape(v), S["statv"]) for _, v in cells],
            [Paragraph(shape(k), S["statk"]) for k, _ in cells],
        ], colWidths=[cw] * n)
        scmds = [("GRID", (0, 0), (-1, -1), 0.5, colors.Color(*BORDER)),
                 ("BACKGROUND", (0, 0), (-1, -1), colors.Color(0.980, 0.984, 0.992)),
                 ("TOPPADDING", (0, 0), (-1, 0), 5), ("BOTTOMPADDING", (0, 1), (-1, 1), 5),
                 ("SPAN", (0, 0), (0, 0))]
        stat_tbl.setStyle(TableStyle(scmds))
        story.append(stat_tbl)
        story.append(Spacer(1, 4 * mm))

    # ---------------- توضیحات ----------------
    if data.get("note"):
        story.append(Paragraph(shape("توضیحات: " + str(data["note"])), S["note"]))
        story.append(Spacer(1, 3 * mm))

    # ---------------- امضا ----------------
    sign_tbl = Table([[Paragraph(shape("مهر و امضای فروشنده"), S["sign"]),
                       Paragraph(shape("امضای خریدار"), S["sign"])]],
                     colWidths=[W / 2, W / 2])
    sign_tbl.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 0.7, colors.Color(0.72, 0.77, 0.82)),
                                  ("TOPPADDING", (0, 0), (-1, -1), 22),
                                  ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story.append(sign_tbl)

    # ---------------- پانویس (در هر صفحه) ----------------
    footer_text = data.get("footer_note", "")
    gen_text = data.get("generated_by", "")

    def on_page(canvas, doc_):
        canvas.saveState()
        canvas.setFont(regular if regular else "Helvetica", 7)
        canvas.setFillColor(colors.Color(*MUTED))
        h = pagesize[1]
        if footer_text:
            canvas.drawRightString(pagesize[0] - 10 * mm, 8 * mm, shape(footer_text))
        if gen_text:
            canvas.drawString(10 * mm, 8 * mm, shape(gen_text))
        canvas.drawCentredString(pagesize[0] / 2, 4.5 * mm, shape(f"صفحه {doc_.page}"))
        canvas.setStrokeColor(colors.Color(*accent))
        canvas.setLineWidth(1)
        canvas.line(10 * mm, 11.5 * mm, pagesize[0] - 10 * mm, 11.5 * mm)
        canvas.restoreState()

    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return out_path


def default_pdf_path(data: Dict[str, Any], folder: Optional[Path] = None) -> Path:
    folder = Path(folder or config.EXPORT_DIR)
    num_txt = (data.get("number") or "invoice").replace("/", "-")
    cust = (data.get("customer", {}).get("name") or "").strip().replace("/", "-")
    name = f"{data.get('kind', 'quote')}-{num_txt}" + (f"-{cust}" if cust else "") + ".pdf"
    safe = "".join(ch for ch in name if ch.isalnum() or ch in "-_.() ")
    return folder / (safe or "invoice.pdf")
