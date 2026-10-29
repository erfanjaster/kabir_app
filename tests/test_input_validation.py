# -*- coding: utf-8 -*-
"""
تست‌های واحدِ «اعتبارسنجی ورودی‌های صفر/منفی/خراب»
====================================================
اجرا:  python3 -m unittest tests.test_input_validation -v
       pytest tests/test_input_validation.py -v

این فایل دقیقاً همان ۳۲ سناریوی لبه‌ایِ گزارشِ بازرسی را پوشش می‌دهد:
  F-04 · عمق منفی + خدمت مترمربعی → **قیمت کل منفی** (−380,820)
  F-08 · ۷ مسیر کرش (TypeError/ValueError/OverflowError)
  F-09 · نبودِ کران روی شمارنده‌ها → ردیف منفی و تخفیف پنهان
  F-16 · NaN → JSON نامعتبر در خروجی API و NULL در SQLite
  F-17 · مارجین ~۱۰۰٪ → قیمت ۹۹۹٬۹۹۹٬۹۹۹٬۹۶۶
  F-31 · depth = 0 → بدنه‌ی رایگان با فاکتورِ معتبر و بدون هشدار
  F-32 · پنل منفی، پنل مثبت را خنثی می‌کرد
"""

from __future__ import annotations

import json
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from kabir.core.costing import (                     # noqa: E402
    CostingEngine, DoorRow, DrawerRow, ExtraRow, Material, Page, PanelRow,
    ServiceRow, UnitRow, _coerce, _f, _i, _pos,
)

MATS = [
    Material(1, "ورق بدنه", "body_sheet", "sheet", 1_000_000, 183, 366, 16),
    Material(2, "لولا", "hinge", "piece", 100_000),
    Material(3, "ورق کشو", "drawer_sheet", "sheet", 900_000, 183, 366, 16),
]
ENGINE = CostingEngine(MATS, {})


def _page(unit_dict=None, page_dict=None):
    u = dict(label="یونیت", unit_type="ground", qty=1, length_cm=90,
             height_cm=72, depth_cm=55, shelves=1, body_id=1)
    if unit_dict:
        u.update(unit_dict)
    d = dict(id=1, name="بخش ۱", units=[u], waste_percent=10.0)
    if page_dict:
        d.update(page_dict)
    return Page.from_dict(d)


def _calc(unit_dict=None, page_dict=None, **proj):
    return ENGINE.calc_project([_page(unit_dict, page_dict)], **proj)


def _finite(res) -> bool:
    vals = [res.total_cost, res.final_price, res.gross_price, res.net_price,
            res.discount_amount, res.vat_amount, res.profit_amount,
            res.deposit_amount, res.remaining_amount, res.pages_cost,
            res.installation_cost]
    vals += [i.amount for i in res.items] + [i.qty for i in res.items]
    vals += [float(v) for v in res.stats.values()]
    return all(isinstance(v, (int, float)) and math.isfinite(float(v)) for v in vals)


# ===========================================================================
# لایه‌ی تبدیلِ امن (پایه‌ی همه‌ی اصلاحات)
# ===========================================================================

class TestSafeCoercion(unittest.TestCase):
    """`_f` / `_i` / `_pos` — مرزِ ورودی به موتور."""

    def test_f_rejects_nan(self):
        self.assertEqual(_f(float("nan"), 7.0), 7.0)
        self.assertEqual(_f("nan"), 0.0)

    def test_f_rejects_infinity(self):
        self.assertEqual(_f(float("inf"), 5.0), 5.0)
        self.assertEqual(_f("-inf", 5.0), 5.0)

    def test_f_rejects_overflow_string(self):
        """`float("1e999")` = inf و `float(10**400)` = OverflowError."""
        self.assertEqual(_f("1e999", 3.0), 3.0)
        self.assertEqual(_f(10 ** 400, 3.0), 3.0)

    def test_f_rejects_garbage(self):
        self.assertEqual(_f("abc", 2.0), 2.0)
        self.assertEqual(_f(None, 2.0), 2.0)
        self.assertEqual(_f("", 2.0), 2.0)

    def test_i_truncates_like_js_math_trunc(self):
        self.assertEqual(_i("2.7"), 2)
        self.assertEqual(_i(-2.7), -2)
        self.assertEqual(_i(None, 4), 4)
        self.assertEqual(_i("abc", 4), 4)

    def test_pos_floors_at_zero(self):
        self.assertEqual(_pos(-55), 0.0)
        self.assertEqual(_pos(-0.001), 0.0)
        self.assertEqual(_pos(12.5), 12.5)
        self.assertEqual(_pos("nan", 3.0), 3.0)

    def test_coerce_drops_missing_and_defaults_to_dataclass(self):
        """«ناموجود» → پیش‌فرضِ dataclass؛ «خراب» → صفر. این تفکیک عمدی است."""
        d = _coerce(UnitRow, {"qty": None, "depth_cm": 55})
        u = UnitRow(**d)
        self.assertEqual(u.qty, 1)            # پیش‌فرضِ فیلد
        d2 = _coerce(UnitRow, {"qty": "nan"})
        self.assertEqual(UnitRow(**d2).qty, 0)  # موجود ولی خراب → صفر + هشدار

    def test_coerce_fixes_wrong_types(self):
        u = UnitRow(**_coerce(UnitRow, {"qty": "2.7", "shelves": "3",
                                        "depth_cm": "55.5", "has_top_panel": "false"}))
        self.assertEqual(u.qty, 2)
        self.assertEqual(u.shelves, 3)
        self.assertAlmostEqual(u.depth_cm, 55.5)
        self.assertIs(u.has_top_panel, False)

    def test_coerce_ignores_unknown_keys(self):
        u = UnitRow(**_coerce(UnitRow, {"qty": 1, "not_a_field": 9}))
        self.assertEqual(u.qty, 1)


# ===========================================================================
# F-08 · مسیرهای کرش
# ===========================================================================

class TestNoCrashOnBadInput(unittest.TestCase):
    """هیچ ورودیِ خرابی نباید موتور را بخواباند (پیش‌تر ۷ مسیر کرش داشت)."""

    BAD_CASES = [
        ("DoorRow.qty=None", {"doors": [{"label": "در", "qty": None, "w_cm": 45,
                                         "h_cm": 70, "material_id": 1}]}),
        ("DoorRow.qty=''", {"doors": [{"label": "در", "qty": "", "w_cm": 45,
                                       "h_cm": 70, "material_id": 1}]}),
        ("DrawerRow.qty='2.7'", {"drawers": [{"label": "کشو", "qty": "2.7", "w_cm": 80,
                                              "h_cm": 18, "d_cm": 45, "sheet_id": 3}]}),
        ("shelves='1'", {"shelves": "1"}),
        ("shelves=None", {"shelves": None}),
        ("qty='nan'", {"qty": "nan"}),
        ("qty='1e999'", {"qty": "1e999"}),
        ("depth='nan'", {"depth_cm": "nan"}),
        ("length='abc'", {"length_cm": "abc"}),
        ("legs_per_unit='x'", {"legs_per_unit": "x", "leg_id": 2}),
        ("pins_per_shelf='2'", {"pins_per_shelf": "2"}),
        ("custom_panels qty='2'", {"custom_panels": [{"label": "پنل", "qty": "2",
                                                      "w_cm": "40", "h_cm": 70}]}),
    ]

    def test_none_of_them_crash(self):
        for name, ud in self.BAD_CASES:
            with self.subTest(name):
                try:
                    res = _calc(ud, {"extras": [{"label": "قلم", "qty": None, "price": 500_000}],
                                     "services": [{"label": "حمل", "basis": "fixed",
                                                   "qty": "x", "price": 100_000}]})
                except Exception as exc:                 # noqa: BLE001
                    self.fail(f"{name} → کرش: {type(exc).__name__}: {exc}")
                self.assertTrue(_finite(res), f"{name} → عدد غیرمتناهی در خروجی")

    def test_door_qty_none_uses_dataclass_default(self):
        """پیش‌فرضِ DoorRow.qty برابر ۲ است — باید ۲ لنگه قیمت بخورد."""
        res = _calc({"doors": [{"label": "در", "qty": None, "w_cm": 45, "h_cm": 70,
                                "material_id": 1}]})
        self.assertEqual(res.stats["total_doors"], 2)

    def test_drawer_qty_string_truncates(self):
        res = _calc({"drawers": [{"label": "کشو", "qty": "2.7", "w_cm": 80, "h_cm": 18,
                                  "d_cm": 45, "sheet_id": 3}]})
        self.assertEqual(res.stats["total_drawers"], 2)

    def test_leaves_never_negative(self):
        self.assertEqual(DoorRow(qty=-5).leaves, 0)
        self.assertEqual(DoorRow(qty="abc").leaves, 0)


# ===========================================================================
# F-04 / F-09 / F-31 / F-32 · صفر و منفی
# ===========================================================================

class TestZeroAndNegativeInputs(unittest.TestCase):

    def test_negative_depth_with_sqm_service_is_not_negative_price(self):
        """F-04 — عددِ اندازه‌گیری‌شده‌ی باگ: −380,820 روی سند مالی."""
        res = _calc({"depth_cm": -55},
                    {"services": [{"label": "نصب", "basis": "sqm", "price": 300_000}]})
        self.assertGreaterEqual(res.final_price, 0.0)
        self.assertGreaterEqual(res.total_cost, 0.0)
        self.assertTrue(all(i.amount >= 0 for i in res.items))
        self.assertTrue(any("منفی" in w for w in res.warnings))

    def test_negative_depth_warns(self):
        res = _calc({"depth_cm": -55})
        self.assertTrue(any("عمق یونیت منفی" in w for w in res.warnings))

    def test_zero_depth_is_not_a_silent_free_body(self):
        """F-31 — پیش‌تر بدنه رایگان می‌شد و فاکتور «معتبر» صادر می‌شد."""
        res = _calc({"depth_cm": 0})
        self.assertTrue(any("عمق یونیت صفر" in w for w in res.warnings))

    def test_zero_height_warns(self):
        res = _calc({"height_cm": 0})
        self.assertTrue(any("ارتفاع یونیت صفر" in w for w in res.warnings))

    def test_negative_shelves_does_not_discount(self):
        """F-09 — پیش‌تر ۱٬۰۰۰٬۰۰۰ می‌شد ۴۰۰٬۰۰۰ (تخفیف پنهان)."""
        base = _calc({}).total_cost
        res = _calc({"shelves": -3})
        self.assertAlmostEqual(res.total_cost, base, delta=1)
        self.assertTrue(any("تعداد طبقه منفی" in w for w in res.warnings))

    def test_negative_legs_does_not_create_negative_row(self):
        base = _calc({"leg_id": 2}).total_cost
        res = _calc({"leg_id": 2, "legs_per_unit": -4})
        self.assertTrue(all(i.amount >= 0 for i in res.items))
        self.assertLess(res.total_cost, base)      # پایه‌ها صفر شدند، نه منفی
        self.assertTrue(any("تعداد پایه منفی" in w for w in res.warnings))

    def test_negative_banding_factor_clamped(self):
        res = _calc({"banding_id": 1}, {"banding_body_factor": -2.2})
        self.assertTrue(all(i.amount >= 0 for i in res.items))
        self.assertTrue(any("ضریب نوار بدنه منفی" in w for w in res.warnings))

    def test_negative_waste_clamped(self):
        base = _calc({}, {"waste_percent": 0}).total_cost
        res = _calc({}, {"waste_percent": -50})
        self.assertAlmostEqual(res.total_cost, base, delta=1)
        self.assertTrue(any("پرتِ ورق منفی" in w for w in res.warnings))

    def test_negative_extra_does_not_reduce_total(self):
        """F-09 — قلمِ اضافه با تعداد منفی، تخفیفِ پنهان می‌ساخت."""
        base = _calc({}).total_cost
        res = _calc({}, {"extras": [{"label": "تخفیف دستی", "qty": -2, "price": 500_000}]})
        self.assertAlmostEqual(res.total_cost, base, delta=1)
        self.assertTrue(any("منفی" in w for w in res.warnings))

    def test_negative_extra_price_does_not_reduce_total(self):
        base = _calc({}).total_cost
        res = _calc({}, {"extras": [{"label": "برگشت از فروش", "qty": 1, "price": -500_000}]})
        self.assertAlmostEqual(res.total_cost, base, delta=1)

    def test_negative_service_price_clamped(self):
        base = _calc({}).total_cost
        res = _calc({}, {"services": [{"label": "تخفیف نصب", "basis": "fixed",
                                       "price": -200_000}]})
        self.assertAlmostEqual(res.total_cost, base, delta=1)

    def test_negative_percent_service_clamped(self):
        base = _calc({}).total_cost
        res = _calc({}, {"services": [{"label": "تخفیف درصدی", "basis": "percent",
                                       "price": -10}]})
        self.assertAlmostEqual(res.total_cost, base, delta=1)
        self.assertTrue(any("درصدِ منفی" in w for w in res.warnings))

    def test_negative_fixed_extra_amount_clamped(self):
        base = _calc({}).total_cost
        res = _calc({}, extra_fixed_amount=-500_000)
        self.assertAlmostEqual(res.total_cost, base, delta=1)

    def test_negative_panel_does_not_cancel_positive_panel(self):
        """F-32 — پنل منفی، پنل مثبت را خنثی می‌کرد."""
        good = _calc({"custom_panels": [{"label": "پنل", "qty": 2, "w_cm": 40, "h_cm": 70}]}).total_cost
        res = _calc({"custom_panels": [{"label": "پنل", "qty": 2, "w_cm": 40, "h_cm": 70},
                                       {"label": "پنل خراب", "qty": -2, "w_cm": 40, "h_cm": 70}]})
        self.assertAlmostEqual(res.total_cost, good, delta=1)
        self.assertEqual(PanelRow("p", -2, 40, 70).area_sqm, 0.0)

    def test_panel_area_never_negative(self):
        self.assertEqual(PanelRow("p", 1, -40, 70).area_sqm, 0.0)
        self.assertEqual(PanelRow("p", 1, 40, -70).area_sqm, 0.0)
        self.assertGreater(PanelRow("p", 1, 40, 70).area_sqm, 0)

    def test_inner_width_never_negative(self):
        """عرضِ یونیت کوچک‌تر از دو برابرِ ضخامت ورق → کف/سقف با مساحت منفی."""
        res = _calc({"length_cm": 2, "body_id": 1})       # ضخامت ۱۶میل = ۱٫۶سانتی‌متر
        self.assertTrue(all(i.amount >= 0 for i in res.items))
        self.assertTrue(_finite(res))

    def test_unit_qty_zero_still_skipped_with_warning(self):
        """رفتارِ سالمِ قبلی (qty ≤ 0 = حذف + هشدار) نباید از بین برود."""
        res = _calc({"qty": 0})
        self.assertEqual(res.total_cost, 0.0)
        self.assertTrue(any("تعداد یونیت" in w for w in res.warnings))

    def test_drawer_and_door_areas_never_negative(self):
        """بعد منفیِ یک بُعد کرانِ صفر می‌گیرد؛ بقیه‌ی ابعاد سالم می‌مانند."""
        bad = DrawerRow(qty=1, w_cm=-80, h_cm=18, d_cm=45)
        zeroed = DrawerRow(qty=1, w_cm=0, h_cm=18, d_cm=45)
        self.assertGreaterEqual(bad.box_area_sqm, 0.0)
        self.assertAlmostEqual(bad.box_area_sqm, zeroed.box_area_sqm, places=9)
        self.assertEqual(bad.front_area_sqm, 0.0)      # فقط به w و h وابسته است
        self.assertGreaterEqual(bad.banding_m, 0.0)
        self.assertEqual(DoorRow(qty=2, w_cm=-45, h_cm=70).area_sqm, 0.0)
        self.assertEqual(DoorRow(qty=2, w_cm=-45, h_cm=70).perimeter_m,
                         DoorRow(qty=2, w_cm=0, h_cm=70).perimeter_m)


# ===========================================================================
# F-16 / F-17 · NaN و مارجینِ پوچ
# ===========================================================================

class TestNonFiniteAndAbsurdValues(unittest.TestCase):

    def test_output_is_always_valid_json(self):
        """F-16 — `{"final_price": NaN}` یک JSON نامعتبر است و مرورگر می‌ترکد."""
        for proj in ({}, {"profit_percent": float("nan")},
                     {"discount_percent": float("inf")},
                     {"vat_percent": float("nan"), "vat_enabled": True},
                     {"install_value": float("nan"), "install_mode": "fixed"},
                     {"deposit_percent": float("nan")}):
            with self.subTest(proj):
                res = _calc({"depth_cm": float("nan")}, None, **proj)
                payload = {"final_price": res.final_price, "total_cost": res.total_cost,
                           "stats": res.stats}
                text = json.dumps(payload)               # allow_nan=True پیش‌فرض
                self.assertNotIn("NaN", text)
                self.assertNotIn("Infinity", text)
                json.loads(text)                         # باید برگردد

    def test_nan_dimension_warns_instead_of_silent_zero(self):
        res = _calc({"depth_cm": float("nan")})
        self.assertTrue(len(res.warnings) > 0)

    def test_nan_financial_input_warns(self):
        res = _calc(None, None, profit_percent=float("nan"))
        self.assertTrue(any("درصد سود" in w for w in res.warnings))

    def test_margin_100_gives_zero_profit(self):
        res = _calc(None, None, profit_mode="margin", profit_percent=100)
        self.assertEqual(res.profit_amount, 0.0)

    def test_margin_above_100_gives_zero_profit(self):
        res = _calc(None, None, profit_mode="margin", profit_percent=140)
        self.assertEqual(res.profit_amount, 0.0)
        self.assertGreaterEqual(res.final_price, 0.0)

    def test_infinite_margin_does_not_explode(self):
        """F-17 — `inf` پیش‌تر تا انتهای زنجیره می‌رفت."""
        res = _calc(None, None, profit_mode="margin", profit_percent=float("inf"))
        self.assertTrue(math.isfinite(res.final_price))
        self.assertGreaterEqual(res.final_price, 0.0)

    def test_calc_profit_never_returns_non_finite_or_negative(self):
        for mode in ("markup", "margin"):
            for pct in (0, 25, 99.9999, 100, 101, float("nan"), float("inf"), -5):
                with self.subTest(mode=mode, pct=pct):
                    v = CostingEngine.calc_profit(1_000_000, mode, pct)
                    self.assertTrue(math.isfinite(v))
                    self.assertGreaterEqual(v, 0.0)

    def test_price_never_negative_for_any_input_combination(self):
        """جمع‌بندی: هیچ ترکیبی از ورودی‌های خراب نباید قیمت منفی بسازد."""
        cases = [
            {"depth_cm": -55}, {"height_cm": -10}, {"length_cm": -90},
            {"shelves": -9}, {"qty": -1}, {"legs_per_unit": -4, "leg_id": 2},
            {"drawers": [{"qty": -2, "w_cm": -80, "h_cm": 18, "d_cm": 45, "sheet_id": 3}]},
            {"doors": [{"qty": -2, "w_cm": -45, "h_cm": -70, "material_id": 1}]},
        ]
        for ud in cases:
            with self.subTest(ud):
                res = _calc(ud, {"services": [{"label": "نصب", "basis": "sqm",
                                               "price": 300_000}]},
                            discount_percent=0, profit_mode="markup", profit_percent=25)
                self.assertGreaterEqual(res.final_price, 0.0)
                self.assertGreaterEqual(res.total_cost, 0.0)
                self.assertTrue(_finite(res))


# ===========================================================================
# F-03 · «در از ورق بدنه» و لنگه‌ی رایگان
# ===========================================================================

class TestDoorFromBodySheet(unittest.TestCase):
    """وقتی تیک نادیده گرفته می‌شود، در نباید بی‌صدا رایگان بماند."""

    def _door(self, w, h, **kw):
        d = {"label": "در", "qty": 2, "w_cm": w, "h_cm": h, "from_body": True,
             "material_id": 0}
        d.update(kw)
        return d

    def test_fitting_leaf_uses_body_sheet(self):
        res = _calc({"doors": [self._door(45, 70)]})
        self.assertTrue(any(i.key == "body_sheet" for i in res.items))
        self.assertFalse(any("رایگان" in w for w in res.warnings))

    def test_oversized_leaf_without_door_material_warns_free(self):
        """لنگه‌ی بزرگ‌تر از ورق بدنه + material_id=0 → پیش‌تر کاملاً بی‌صدا."""
        res = _calc({"doors": [self._door(300, 300)]})
        self.assertTrue(any("نادیده گرفته شد" in w for w in res.warnings))
        self.assertTrue(any("رایگان" in w for w in res.warnings),
                        f"هشدارِ «در رایگان» صادر نشد: {res.warnings}")

    def test_oversized_leaf_with_own_material_is_charged(self):
        res = _calc({"doors": [self._door(300, 300, material_id=1)]})
        self.assertTrue(any("نادیده گرفته شد" in w for w in res.warnings))
        self.assertFalse(any("رایگان" in w for w in res.warnings))
        self.assertGreater(res.total_cost, 0)

    def test_price_never_negative_when_leaf_does_not_fit(self):
        res = _calc({"doors": [self._door(500, 500)]})
        self.assertGreaterEqual(res.final_price, 0.0)
        self.assertTrue(all(i.amount >= 0 for i in res.items))


if __name__ == "__main__":
    unittest.main(verbosity=2)
