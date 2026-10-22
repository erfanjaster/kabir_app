# -*- coding: utf-8 -*-
"""ابزارهای فارسی: اعداد، قالب‌بندی پول، تاریخ شمسی و تبدیل عدد به حروف."""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Union

FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
EN_DIGITS = "0123456789"
AR_DIGITS = "٠١٢٣٤٥٦٧٨٩"

Number = Union[int, float]

# ---------------------------------------------------------------------------
# اعداد
# ---------------------------------------------------------------------------


def to_en_digits(text: str) -> str:
    """تبدیل ارقام فارسی/عربی به لاتین (برای پردازش ورودی کاربر)."""
    if text is None:
        return ""
    text = str(text)
    for i, d in enumerate(FA_DIGITS):
        text = text.replace(d, EN_DIGITS[i])
    for i, d in enumerate(AR_DIGITS):
        text = text.replace(d, EN_DIGITS[i])
    text = text.replace("٫", ".").replace("،", ",").replace("٬", ",")
    return text


def to_fa_digits(text: Union[str, Number]) -> str:
    """تبدیل ارقام لاتین به فارسی."""
    s = str(text)
    return s.translate(str.maketrans(EN_DIGITS, FA_DIGITS))


def digits(text: str, persian: bool = True) -> str:
    return to_fa_digits(text) if persian else to_en_digits(text)


def fmt_number(value: Number, decimals: int = 0, persian: bool = True, sep: bool = True) -> str:
    """قالب‌بندی عدد با جداکننده‌ی هزارگان."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return "۰" if persian else "0"
    if decimals <= 0:
        v = int(round(v))
        s = f"{v:,}" if sep else str(v)
    else:
        s = f"{v:,.{decimals}f}" if sep else f"{v:.{decimals}f}"
    return to_fa_digits(s) if persian else s


def fmt_money(value: Number, currency: str = "ریال", scale: float = 1.0,
              decimals: int = 0, persian: bool = True) -> str:
    """قالب‌بندی مبلغ با واحد پول (مقیاس ۱۰ یعنی نمایش به تومان)."""
    try:
        v = float(value) / (scale or 1.0)
    except (TypeError, ValueError, ZeroDivisionError):
        v = 0.0
    num = fmt_number(v, decimals=decimals, persian=persian)
    return f"{num} {currency}".strip()


def fmt_area(sq_m: Number, persian: bool = True, decimals: int = 3) -> str:
    """قالب‌بندی مساحت بر حسب مترمربع."""
    return f"{fmt_number(sq_m, decimals, persian)} م²"


def fmt_length(meters: Number, persian: bool = True, decimals: int = 2) -> str:
    """قالب‌بندی طول بر حسب متر."""
    return f"{fmt_number(meters, decimals, persian)} متر"


def ltr_runs(text) -> str:
    """
    ایزوله‌سازی هر «اجرای عددی» با نشانه‌ی RLM تا ترتیب اعداد و ابعاد
    (مثل ۱۸۳×۳۶۶) در چیدمان راست‌به‌چپ حفظ شود.
    """
    return re.sub(r"[0-9۰-۹]+(?:[.,][0-9۰-۹]+)?",
                  lambda m: "\u200f" + m.group(0) + "\u200f", str(text))


def parse_number(text) -> float:
    """تبدیل متن ورودی کاربر (فارسی/انگلیسی/دارای جداکننده) به عدد."""
    if text is None:
        return 0.0
    if isinstance(text, (int, float)):
        return float(text)
    s = to_en_digits(str(text)).replace(",", "").replace(" ", "").strip()
    if not s:
        return 0.0
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group()) if m else 0.0


# ---------------------------------------------------------------------------
# تاریخ شمسی (بدون وابستگی خارجی)
# ---------------------------------------------------------------------------

_JALALI_MONTHS = [
    "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
    "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
]
_WEEKDAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"]


def gregorian_to_jalali(gy: int, gm: int, gd: int) -> tuple[int, int, int]:
    """تبدیل تاریخ میلادی به شمسی (الگوریتم استاندارد jalaali)."""
    g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    gy2 = gy - 1600
    gm2 = gm - 1
    gd2 = gd - 1
    g_day_no = 365 * gy2 + (gy2 + 3) // 4 - (gy2 + 99) // 100 + (gy2 + 399) // 400
    g_day_no += g_d_m[gm2]
    if gm2 > 1 and ((gy % 4 == 0 and gy % 100 != 0) or (gy % 400 == 0)):
        g_day_no += 1
    g_day_no += gd2
    j_day_no = g_day_no - 79
    j_np = j_day_no // 12053
    j_day_no %= 12053
    jy = 979 + 33 * j_np + 4 * (j_day_no // 1461)
    j_day_no %= 1461
    if j_day_no >= 366:
        jy += (j_day_no - 1) // 365
        j_day_no = (j_day_no - 1) % 365
    if j_day_no < 186:
        jm = 1 + j_day_no // 31
        jd = 1 + j_day_no % 31
    else:
        jm = 7 + (j_day_no - 186) // 30
        jd = 1 + (j_day_no - 186) % 30
    return jy, jm, jd


def jalali_to_gregorian(jy: int, jm: int, jd: int) -> tuple[int, int, int]:
    """تبدیل تاریخ شمسی به میلادی (الگوریتم استاندارد jalaali)."""
    jy -= 979
    jm -= 1
    j_month_len = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29]
    j_day_no = 365 * jy + (jy // 33) * 8 + ((jy % 33) + 3) // 4
    j_day_no += sum(j_month_len[:jm])
    j_day_no += jd
    g_day_no = j_day_no + 79
    gy = 1600 + 400 * (g_day_no // 146097)
    g_day_no %= 146097
    leap = True
    if g_day_no >= 36525:
        g_day_no -= 1
        gy += 100 * (g_day_no // 36524)
        g_day_no %= 36524
        if g_day_no >= 365:
            g_day_no += 1
        else:
            leap = False
    gy += 4 * (g_day_no // 1461)
    g_day_no %= 1461
    if g_day_no >= 366:
        g_day_no -= 1
        gy += g_day_no // 365
        g_day_no %= 365
    g_leap = leap or ((gy % 4 == 0 and gy % 100 != 0) or (gy % 400 == 0))
    g_d_m = [31, 29 if g_leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    gm = 0
    while gm < 12 and g_day_no >= g_d_m[gm]:
        g_day_no -= g_d_m[gm]
        gm += 1
    return gy, gm + 1, g_day_no + 1


_JALALI_BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181,
                  1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178]


def _jal_cal(jy: int) -> tuple[int, int, int]:
    """محاسبه‌ی رسمی سال کبیسه‌ی شمسی (الگوریتم jalCal از jalaali)."""
    breaks = _JALALI_BREAKS
    gy = jy + 621
    leapJ = -14
    jp = breaks[0]
    jump = 0
    for i in range(1, len(breaks)):
        jm = breaks[i]
        jump = jm - jp
        if jy < jm:
            break
        leapJ = leapJ + 8 * (jump // 33) + (jump % 33) // 4
        jp = jm
    n = jy - jp
    leapJ = leapJ + 8 * (n // 33) + (n % 33 + 3) // 4
    if (jump % 33) == 4 and (jump - n) == 4:
        leapJ += 1
    leapG = gy // 4 - ((gy // 100 + 1) * 3) // 4 - 150
    march = 20 + leapJ - leapG
    if (jump - n) < 6:
        n = n - jump + ((jump + 4) // 33) * 33
    leap = (((n + 1) % 33) - 1) % 4
    if leap == -1:
        leap = 4
    return leap, gy, march


def is_jalali_leap(jy: int) -> bool:
    """آیا سال شمسی کبیسه است (اسفند ۳۰ روزه)؟"""
    return _jal_cal(jy)[0] == 0


def jalali_month_days(jy: int, jm: int) -> int:
    if jm <= 6:
        return 31
    if jm <= 11:
        return 30
    return 30 if is_jalali_leap(jy) else 29


def today_jalali() -> tuple[int, int, int]:
    n = datetime.now()
    return gregorian_to_jalali(n.year, n.month, n.day)


def jdate_str(d: Union[datetime, date, None] = None, persian: bool = True) -> str:
    """تاریخ شمسی به‌صورت ۱۴۰۴/۰۷/۳۰"""
    d = d or datetime.now()
    if isinstance(d, str):
        return d
    jy, jm, jd = gregorian_to_jalali(d.year, d.month, d.day)
    s = f"{jy:04d}/{jm:02d}/{jd:02d}"
    return to_fa_digits(s) if persian else s


def jdatetime_str(d: Union[datetime, None] = None, persian: bool = True) -> str:
    d = d or datetime.now()
    jy, jm, jd = gregorian_to_jalali(d.year, d.month, d.day)
    s = f"{jy:04d}/{jm:02d}/{jd:02d} - {d.hour:02d}:{d.minute:02d}"
    return to_fa_digits(s) if persian else s


def jdate_long(d: Union[datetime, date, None] = None, persian: bool = True) -> str:
    """تاریخ کامل: پنجشنبه ۳۰ مهر ۱۴۰۴"""
    d = d or datetime.now()
    jy, jm, jd = gregorian_to_jalali(d.year, d.month, d.day)
    wd = _WEEKDAYS[(d.weekday() + 1) % 7]
    s = f"{wd} {jd} {_JALALI_MONTHS[jm - 1]} {jy}"
    return to_fa_digits(s) if persian else s


def jalali_month_name(m: int) -> str:
    return _JALALI_MONTHS[(m - 1) % 12]


# ---------------------------------------------------------------------------
# عدد به حروف فارسی (برای فاکتور)
# ---------------------------------------------------------------------------

_ONES = ["", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه"]
_TEENS = ["ده", "یازده", "دوازده", "سیزده", "چهارده", "پانزده",
          "شانزده", "هفده", "هجده", "نوزده"]
_TENS = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"]
_HUNDREDS = ["", "صد", "دویست", "سیصد", "چهارصد", "پانصد",
             "ششصد", "هفتصد", "هشتصد", "نهصد"]
_SCALES = ["", "هزار", "میلیون", "میلیارد", "تریلیون", "کوادریلیون"]


def _three_digits_to_words(n: int) -> str:
    parts = []
    h, rem = divmod(n, 100)
    if h:
        parts.append(_HUNDREDS[h])
    if rem >= 10 and rem < 20:
        parts.append(_TEENS[rem - 10])
    else:
        t, o = divmod(rem, 10)
        if t:
            parts.append(_TENS[t])
        if o:
            parts.append(_ONES[o])
    return " و ".join(parts)


def number_to_words(n: Union[int, float]) -> str:
    """تبدیل عدد صحیح به حروف فارسی."""
    try:
        n = int(round(float(n)))
    except (TypeError, ValueError):
        return "صفر"
    if n == 0:
        return "صفر"
    if n < 0:
        return "منفی " + number_to_words(-n)
    groups = []
    while n > 0:
        n, r = divmod(n, 1000)
        groups.append(r)
    parts = []
    for i in range(len(groups) - 1, -1, -1):
        g = groups[i]
        if g == 0:
            continue
        w = _three_digits_to_words(g)
        if _SCALES[i]:
            w = f"{w} {_SCALES[i]}" if i else w
            if i == 1 and g == 1:
                w = "هزار"
        parts.append(w)
    return " و ".join(parts)


def money_to_words(amount: Number, currency: str = "ریال", scale: float = 1.0) -> str:
    """مبلغ به حروف — مناسب بخش «مبلغ به حروف» فاکتور."""
    try:
        v = int(round(float(amount) / (scale or 1.0)))
    except (TypeError, ValueError, ZeroDivisionError):
        v = 0
    if v == 0:
        return "صفر"
    return f"{number_to_words(v)} {currency}"
