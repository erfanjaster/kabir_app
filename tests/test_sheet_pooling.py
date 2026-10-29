# -*- coding: utf-8 -*-
"""
تست‌های واحدِ «محاسبه‌ی ورق» — رفع باگ‌های F-01 و F-05
========================================================
اجرا:  python3 -m unittest tests.test_sheet_pooling -v
       pytest tests/test_sheet_pooling.py -v

هر تست دقیقاً برای یکی از فرمول‌هایی نوشته شده که در این فاز تغییر کرد، تا
در آینده بی‌صدا برنگردند.

F-01 · سطحِ تجمیعِ ورق «بخش» بود نه «پروژه»:
       یک آشپزخانه‌ی ۸ یونیتی که به ۸ بخش تقسیم شده بود ۸ ورق قیمت می‌خورد
       در حالی که ۳ ورق لازم داشت (+۱۶۷٪ روی گران‌ترین قلم فاکتور).
F-05 · ورقِ با واحد «sheet» و بدون ابعاد → price_per_sqm = 0 → بدنه‌ی رایگان
       و کاملاً بی‌صدا (بدون هیچ هشداری).
"""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from kabir.core.costing import (                     # noqa: E402
    CostingEngine, Material, Page, UnitRow, round_up_sheets,
)

# ورق ۱۸۳×۳۶۶ = ۶٫۶۹۷۸ م²  —  هر ورق ۱٬۰۰۰٬۰۰۰
SHEET_W, SHEET_H = 183, 366
SHEET_AREA = (SHEET_W / 100.0) * (SHEET_H / 100.0)

MATS = [
    Material(1, "ورق بدنه", "body_sheet", "sheet", 1_000_000, SHEET_W, SHEET_H, 16),
    Material(2, "ورق بی‌ابعاد", "body_sheet", "sheet", 1_000_000, 0, 0, 16),
    Material(3, "ورق با واحدِ عددی", "body_sheet", "piece", 1_000_000, 0, 0, 16),
    Material(4, "ورق در", "door_sheet", "sheet", 2_000_000, SHEET_W, SHEET_H, 16),
    Material(5, "ورق بدنه‌ی دوم", "body_sheet", "sheet", 1_000_000, SHEET_W, SHEET_H, 16),
]

ENGINE = CostingEngine(MATS, {})


def _unit(body_id: int = 1, **kw) -> UnitRow:
    d = dict(label="زمینی ۹۰", unit_type="ground", qty=1,
             length_cm=90, height_cm=72, depth_cm=55, shelves=1, body_id=body_id)
    d.update(kw)
    return UnitRow(**d)


def _page(units, **kw) -> Page:
    d = dict(id=1, name="بخش ۱", units=units, waste_percent=10.0)
    d.update(kw)
    return Page(**d)


def _sheets(res, key="body_sheet"):
    return sum(i.sheets for i in res.items if i.key == key)


def _amount(res, key="body_sheet"):
    return sum(i.amount for i in res.items if i.key == key)


# ===========================================================================
# F-01 · سطحِ تجمیع ورق
# ===========================================================================

class TestSheetCeilingWithinOneSection(unittest.TestCase):
    """رفتاری که از قبل سالم بود و **نباید** در فاز اصلاح خراب شود."""

    def test_one_point_two_sheets_buys_two_not_three(self):
        """سناریوی ۱: ۱٫۲ ورق با پرتِ ≤ ۱۵٪ باید ۲ ورق بخرد، نه ۳."""
        # مساحت خالصِ دقیقاً ۱٫۲ ورق
        net = 1.2 * SHEET_AREA
        for waste in (0, 5, 10, 15):
            got = round_up_sheets(net, SHEET_AREA, waste)
            self.assertEqual(got, 2.0, f"پرت {waste}٪ → {got} ورق (باید ۲ باشد)")

    def test_exactly_one_sheet_is_not_rounded_up(self):
        """گاردِ خطای شناور: دقیقاً ۱ ورق باید ۱ بماند، نه ۲."""
        self.assertEqual(round_up_sheets(SHEET_AREA, SHEET_AREA, 0), 1.0)
        # خطای شناورِ زیرِ آستانه‌ی گارد (1e-6) نباید یک ورقِ اضافه بخرد
        self.assertEqual(round_up_sheets(SHEET_AREA + 1e-9, SHEET_AREA, 0), 1.0)
        # ولی واقعاً بیش‌تر از یک ورق → ۲ ورق
        self.assertEqual(round_up_sheets(SHEET_AREA * 1.001, SHEET_AREA, 0), 2.0)

    def test_waste_applied_once_before_division(self):
        """پرت باید **قبل** از تقسیم بر مساحت ورق اعمال شود (یک‌بار)."""
        self.assertEqual(round_up_sheets(1.95 * SHEET_AREA, SHEET_AREA, 10), 3.0)

    def test_negative_waste_is_clamped_to_zero(self):
        """پرتِ منفی پیش‌تر ورق را کمتر از نیاز گرد می‌کرد."""
        self.assertEqual(round_up_sheets(SHEET_AREA, SHEET_AREA, -50), 1.0)

    def test_zero_sheet_area_returns_zero_not_crash(self):
        self.assertEqual(round_up_sheets(5.0, 0.0, 10), 0.0)


class TestProjectLevelPooling(unittest.TestCase):
    """F-01 — ورقِ یک متریال باید در سطح **پروژه** یک‌جا گرد شود."""

    def _kitchen(self, sections: int):
        """۸ یونیت یکسان، تقسیم‌شده به `sections` بخش."""
        per = 8 // sections
        return [_page([_unit() for _ in range(per)], id=i + 1, name=f"بخش {i+1}")
                for i in range(sections)]

    def test_physical_requirement_is_three_sheets(self):
        """مبنای آزمون: ۸ یونیت با پرت ۱۰٪ = ۲٫۲۹۶ ورق → ۳ ورق لازم است."""
        res = ENGINE.calc_project(self._kitchen(1))
        gross = sum(i.area_sqm for i in res.items if i.key == "body_sheet")
        self.assertAlmostEqual(gross / SHEET_AREA, 2.296, places=2)
        self.assertEqual(math.ceil(gross / SHEET_AREA), 3)

    def test_splitting_into_sections_does_not_inflate_sheets(self):
        """هسته‌ی F-01: ۱/۲/۴/۸ بخش باید **همه** ۳ ورق بدهند (پیش‌تر ۳/۳/۴/۸)."""
        counts, costs = {}, {}
        for sections in (1, 2, 4, 8):
            res = ENGINE.calc_project(self._kitchen(sections))
            counts[sections] = _sheets(res)
            costs[sections] = res.total_cost
        # ⚠ جمعِ «سهم» ردیف‌ها یک عددِ شناور است (۲٫۹۹۹۹۹۹۹۹۹۹۹۹۹۹۶)؛
        #   تعداد ورقِ **خریدنی** که batch_sheets گرد کرده همان ۳ است.
        for sections, got in counts.items():
            self.assertAlmostEqual(got, 3.0, places=6,
                                   msg=f"{sections} بخش → {got} ورق (باید ۳ باشد)")
        self.assertEqual(len(set(costs.values())), 1,
                         f"قیمت با تقسیم‌بندی عوض شد: {costs}")

    def test_eight_sections_used_to_cost_167_percent_more(self):
        """عددِ اندازه‌گیری‌شده‌ی باگ: ۸ بخش پیش‌تر ۸٬۰۰۰٬۰۰۰ بود، حالا ۳٬۰۰۰٬۰۰۰."""
        res = ENGINE.calc_project(self._kitchen(8))
        self.assertAlmostEqual(res.total_cost, 3_000_000, delta=1)

    def test_pooling_never_costs_more_than_per_section(self):
        """ceil(Σ) ≤ Σ ceil  →  پاسِ پروژه هرگز قیمت را **افزایش** نمی‌دهد."""
        one = ENGINE.calc_project(self._kitchen(1)).total_cost
        for sections in (2, 3, 4, 6, 8):
            many = ENGINE.calc_project(self._kitchen(sections)).total_cost
            self.assertLessEqual(many, one + 1e-6,
                                 f"{sections} بخش گران‌تر از ۱ بخش شد")

    def test_different_materials_still_round_separately(self):
        """دو متریال **مختلف** در دو بخش باید جدا گرد شوند (نه با هم).

        تجمیعِ سطح پروژه فقط برای «یک متریال» است؛ ورقِ جنسِ دیگر را نمی‌توان
        با ورقِ جنسِ اول قاطی کرد. هر دو بخش زیرِ یک ورق‌اند ولی جنسشان فرق
        دارد → باید ۲ ورق شود، نه ۱.
        """
        p1 = _page([_unit(body_id=1)], id=1, name="بخش ۱")
        p2 = _page([_unit(body_id=5, height_cm=30)], id=2, name="بخش ۲")
        res = ENGINE.calc_project([p1, p2])
        self.assertAlmostEqual(_sheets(res), 2.0, places=6)

    def test_same_material_across_sections_pools_into_one_sheet(self):
        """نقطه‌ی مقابلِ تست قبل: همان دو بخش با **یک** متریال → ۱ ورق."""
        p1 = _page([_unit(body_id=1)], id=1, name="بخش ۱")
        p2 = _page([_unit(body_id=1, height_cm=30)], id=2, name="بخش ۲")
        res = ENGINE.calc_project([p1, p2])
        self.assertAlmostEqual(_sheets(res), 1.0, places=6)
        self.assertAlmostEqual(res.total_cost, 1_000_000, delta=1)

    def test_stats_total_sheets_matches_item_sheets(self):
        res = ENGINE.calc_project(self._kitchen(4))
        self.assertAlmostEqual(res.stats["total_sheets"], _sheets(res), places=6)
        self.assertAlmostEqual(res.stats["total_sheets"], 3.0, places=6)

    def test_qty_times_unit_price_equals_amount_after_pooling(self):
        """نامساویِ حسابداری باید بعد از پاسِ دوم هم برقرار بماند."""
        res = ENGINE.calc_project(self._kitchen(4))
        for it in res.items:
            if it.key == "body_sheet":
                self.assertAlmostEqual(it.qty * it.unit_price, it.amount, places=4,
                                       msg=f"ردیف «{it.title}»: qty×price ≠ amount")

    def test_item_amounts_sum_to_total_cost(self):
        """جمع ردیف‌ها باید دقیقاً برابر هزینه‌ی تمام‌شده بماند."""
        for sections in (1, 4, 8):
            res = ENGINE.calc_project(self._kitchen(sections))
            self.assertAlmostEqual(sum(i.amount for i in res.items),
                                   res.total_cost, places=2,
                                   msg=f"{sections} بخش: جمع ردیف‌ها ≠ total_cost")

    def test_unit_costs_sum_to_page_total(self):
        """جمع هزینه‌ی یونیت‌ها باید با جمع بخش یکی بماند (پاسِ دوم همگام است)."""
        res = ENGINE.calc_project(self._kitchen(4))
        for pr in res.pages:
            self.assertAlmostEqual(sum(ur.cost for ur in pr.unit_results),
                                   sum(i.amount for i in pr.items), places=4)

    def test_detail_suffix_not_duplicated(self):
        """`batch_sheets` حالا دو بار صدا زده می‌شود → عبارت نباید تکرار شود."""
        res = ENGINE.calc_project(self._kitchen(4))
        for it in res.items:
            if it.key == "body_sheet":
                self.assertEqual(it.detail.count("— از "), 1,
                                 f"detail دو بار پسوند گرفت: {it.detail!r}")
                self.assertIn("کل پروژه", it.detail)

    def test_percent_service_uses_corrected_subtotal(self):
        """خدمت درصدی باید روی جمعِ **اصلاح‌شده** بنشیند، نه جمعِ بادکرده."""
        pages = self._kitchen(4)
        for pg in pages:
            from kabir.core.costing import ServiceRow
            pg.services.append(ServiceRow(label="مدیریت پروژه", basis="percent", price=10))
        res = ENGINE.calc_project(pages)
        svc = sum(i.amount for i in res.items if i.key == "service")
        self.assertAlmostEqual(svc, 3_000_000 * 0.10, delta=1,
                               msg="خدمت درصدی روی جمعِ اشتباه نشسته است")


# ===========================================================================
# F-05 · ورقِ بی‌ابعاد / واحدِ ناسازگار
# ===========================================================================

class TestSheetWithoutDimensions(unittest.TestCase):
    """F-05 — «بدنه‌ی رایگانِ بی‌صدا» باید به «هشدارِ صریح» تبدیل شود."""

    def test_sheet_without_dims_raises_explicit_warning(self):
        res = ENGINE.calc_project([_page([_unit(body_id=2)])])
        self.assertTrue(any("ابعاد ورق" in w for w in res.warnings),
                        f"هشداری صادر نشد: {res.warnings}")

    def test_sheet_without_dims_was_silent_before(self):
        """پیش‌تر warnings خالی بود و بدنه رایگان — این همان باگ است."""
        res = ENGINE.calc_project([_page([_unit(body_id=2)])])
        self.assertGreater(len(res.warnings), 0)

    def test_wrong_unit_in_sheet_category_warns(self):
        """قلمِ «ورق» با واحد piece → قیمت هر عدد به‌جای هر م² ضرب می‌شد."""
        res = ENGINE.calc_project([_page([_unit(body_id=3)])])
        self.assertTrue(any("واحدش" in w for w in res.warnings),
                        f"هشداری صادر نشد: {res.warnings}")

    def test_missing_material_still_warns(self):
        """رفتارِ سالمِ قبلی (متریال حذف‌شده) نباید از بین برود."""
        res = ENGINE.calc_project([_page([_unit(body_id=999)])])
        self.assertTrue(any("حذف شده" in w for w in res.warnings))

    def test_zero_price_sheet_warns(self):
        mats = MATS + [Material(77, "ورق رایگان", "body_sheet", "sheet", 0,
                                SHEET_W, SHEET_H, 16)]
        eng = CostingEngine(mats, {})
        res = eng.calc_project([_page([_unit(body_id=77)])])
        self.assertTrue(any("قیمتِ مؤثرِ صفر" in w for w in res.warnings))

    def test_has_sheet_dims_flag(self):
        self.assertTrue(MATS[0].has_sheet_dims)
        self.assertFalse(MATS[1].has_sheet_dims)

    def test_negative_sheet_dims_are_not_a_real_area(self):
        m = Material(88, "ورق منفی", "body_sheet", "sheet", 1_000_000, -183, 366, 16)
        self.assertEqual(m.sheet_area_sqm, 0.0)
        self.assertFalse(m.has_sheet_dims)


if __name__ == "__main__":
    unittest.main(verbosity=2)
