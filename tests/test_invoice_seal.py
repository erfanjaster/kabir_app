# -*- coding: utf-8 -*-
"""
تست‌های واحدِ «مُهرِ مالیِ پروژه‌های قطعی» — رفع باگ F-02
==========================================================
اجرا:  python3 -m unittest tests.test_invoice_seal -v
       pytest tests/test_invoice_seal.py -v

باگ چه بود؟
-----------
``recalc_all_projects`` با ``repo.all()`` کار می‌کرد و **هیچ** فیلترِ وضعیتی
نداشت؛ جدول ``projects`` هم هیچ ستونِ قفل/بایگانی نداشت. در نتیجه با یک
«+۵۰٪» روی قیمت ورق:

    پروژه‌ی done :  14,025,000  →  21,037,500   (بازنویسی شد ❌)
    فاکتور قطعی  :  14,025,000  →  14,025,000   (snapshot، ثابت ✅)

یعنی **دو عددِ متناقضِ همیشگی** برای یک کار: سندِ چاپ‌شده‌ی دستِ مشتری یک
مبلغ می‌گفت و ``ProjectRepo.stats()`` (که ``Σ final_price`` همه‌ی پروژه‌هاست)
مبلغی دیگر → گزارش درآمد و سود عملاً جعلی می‌شد.

این تست‌ها روی یک پایگاه‌داده‌ی موقتِ جدا اجرا می‌شوند (بدون دست‌زدن به
singletonِ ``Database.instance()`` تا بین تست‌ها نشت نکند).
"""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from kabir.core import costing, invoice as inv        # noqa: E402
from kabir.data import dao, recalc as rc              # noqa: E402
from kabir.data.dao import InvoiceRepo, MaterialRepo, ProjectRepo  # noqa: E402
from kabir.data.db import Database                    # noqa: E402


class SealTestBase(unittest.TestCase):
    """پایه‌ی مشترک: یک DB موقت + یک پروژه‌ی باز + یک پروژه‌ی قطعی."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="kabir-seal-"))
        # ★ عمدلاً Database.instance() صدا زده نمی‌شود: مسیرِ صریح می‌دهیم تا
        #   singletonِ سراسریِ تست‌های دیگر (test_server/test_migration) آلوده نشود.
        self.db = Database(self.tmp / "kabir.db")
        dao.bootstrap(self.db)
        self.mrepo = MaterialRepo(self.db)
        self.prepo = ProjectRepo(self.db)
        self.irepo = InvoiceRepo(self.db)
        self.body = next(m for m in self.mrepo.all() if m.category == "body_sheet")

    def tearDown(self):
        try:
            self.db.close()
        except Exception:                              # noqa: BLE001
            pass
        shutil.rmtree(self.tmp, ignore_errors=True)

    # --- ابزارها ---
    def make_project(self, title="پروژه", status="draft"):
        """پروژه را **پیش‌نویس** می‌سازد، بازمحاسبه می‌کند، بعد وضعیت را می‌گذارد.

        همان ترتیبِ واقعیِ کار: تا پروژه قیمتِ محاسبه‌شده نداشته باشد،
        «قطعی»‌کردنش بی‌معنی است (و مُهر هم از همان اول جلوی نوشتنِ قیمت را
        می‌گیرد — که درست است).
        """
        pid = self.prepo.create({
            "title": title, "status": "draft",
            "profit_mode": "markup", "profit_percent": 30,
        })
        page = {"id": 1, "name": "بخش ۱", "waste_percent": 10,
                "units": [{"id": "u1", "label": "زمینی ۹۰", "unit_type": "ground",
                           "qty": 1, "length_cm": 90, "height_cm": 72, "depth_cm": 55,
                           "shelves": 1, "body_id": self.body.id}],
                "extras": [], "services": [], "detail_mode": "none", "detail_rows": []}
        self.prepo.add_page(pid, "بخش ۱", 0, page, 0)
        rc.recalc_project(self.db, self.prepo.get(pid))
        if status != "draft":
            self.prepo.update(pid, {"status": status})
        return pid

    def issue_invoice(self, pid, kind="invoice"):
        """یک سندِ قطعی/پیش‌فاکتور واقعاً صادر می‌کند (همان مسیرِ سرور)."""
        pages = self.prepo.load_pages(pid)
        row = self.prepo.get(pid)
        eng = costing.CostingEngine(self.mrepo.all(), self.db.all_settings())
        res = eng.calc_project(pages, profit_mode=row["profit_mode"],
                               profit_percent=row["profit_percent"])
        data = inv.build_invoice_data(
            res, {"title": row["title"], "customer_name": "مشتری"},
            self.db.all_settings(), kind=kind)
        return self.irepo.save(pid, self.irepo.next_number(kind), data,
                               res.final_price, kind), res.final_price

    def bump_body_price(self, factor=1.5):
        self.mrepo.set_price(self.body.id, self.body.price * factor)
        rc.bump_prices_rev(self.db)
        return rc.recalc_all_projects(self.db)

    def price(self, pid):
        return float(self.prepo.get(pid)["final_price"] or 0)


# ===========================================================================
# تشخیصِ مُهر
# ===========================================================================

class TestSealDetection(SealTestBase):

    def test_draft_project_is_not_sealed(self):
        pid = self.make_project(status="draft")
        self.assertFalse(self.prepo.is_sealed(pid))
        self.assertIsNone(self.prepo.seal_reason(pid))

    def test_open_project_is_not_sealed(self):
        pid = self.make_project(status="open")
        self.assertFalse(self.prepo.is_sealed(pid))

    def test_done_project_is_sealed(self):
        pid = self.make_project(status="draft")
        self.prepo.update(pid, {"status": "done"})
        self.assertTrue(self.prepo.is_sealed(pid))
        self.assertIn("done", self.prepo.seal_reason(pid))

    def test_final_invoice_seals_even_when_status_is_draft(self):
        pid = self.make_project(status="draft")
        self.issue_invoice(pid, kind="invoice")
        self.assertTrue(self.prepo.is_sealed(pid))

    def test_quote_does_not_seal(self):
        """پیش‌فاکتور سندِ قیمتِ روز است و باید با نرخ تازه به‌روز بماند."""
        pid = self.make_project(status="draft")
        self.issue_invoice(pid, kind="quote")
        self.assertFalse(self.prepo.is_sealed(pid))

    def test_proforma_does_not_seal(self):
        pid = self.make_project(status="draft")
        self.issue_invoice(pid, kind="proforma")
        self.assertFalse(self.prepo.is_sealed(pid))

    def test_sealed_project_ids_lists_only_final_invoices(self):
        a = self.make_project("قطعی")
        b = self.make_project("پیش‌فاکتور")
        self.issue_invoice(a, kind="invoice")
        self.issue_invoice(b, kind="quote")
        self.assertEqual(self.irepo.sealed_project_ids(), {a})

    def test_final_invoice_for_returns_latest(self):
        pid = self.make_project()
        self.issue_invoice(pid, kind="invoice")
        iid2, _ = self.issue_invoice(pid, kind="invoice")
        got = self.irepo.final_invoice_for(pid)
        self.assertEqual(int(got["id"]), iid2)

    def test_missing_project_is_not_sealed(self):
        self.assertIsNone(self.prepo.seal_reason(999999))


# ===========================================================================
# هسته‌ی F-02 — جداسازیِ «پروژه‌ی قطعی» از «پروژه‌ی باز»
# ===========================================================================

class TestPriceChangeIsolation(SealTestBase):

    def test_sealed_project_survives_price_change(self):
        pid = self.make_project(status="draft")
        self.issue_invoice(pid, kind="invoice")
        self.prepo.update(pid, {"status": "done"})
        before = self.price(pid)

        self.bump_body_price(1.5)

        self.assertAlmostEqual(self.price(pid), before, delta=0.01,
                               msg="پروژه‌ی قطعی با تغییر نرخ بازنویسی شد (F-02)")

    def test_open_project_follows_price_change(self):
        pid = self.make_project(status="open")
        before = self.price(pid)
        self.bump_body_price(1.5)
        self.assertGreater(self.price(pid), before * 1.4,
                           "پروژه‌ی باز با نرخ تازه به‌روز نشد")

    def test_draft_project_follows_price_change(self):
        pid = self.make_project(status="draft")
        before = self.price(pid)
        self.bump_body_price(1.5)
        self.assertGreater(self.price(pid), before * 1.4)

    def test_invoice_and_project_never_contradict(self):
        """ریشه‌ی شکایت: سندِ چاپ‌شده و عددِ داشبورد باید یکی بمانند."""
        pid = self.make_project(status="done")
        iid, total = self.issue_invoice(pid, kind="invoice")
        self.bump_body_price(1.5)
        self.assertAlmostEqual(float(self.irepo.get(iid)["total"]), total, delta=0.01)
        self.assertAlmostEqual(self.price(pid), total, delta=0.01,
                               msg="پروژه و فاکتورِ قطعی‌اش از هم جدا شدند")

    def test_total_cost_is_sealed_too(self):
        pid = self.make_project(status="done")
        cost_before = float(self.prepo.get(pid)["total_cost"])
        self.bump_body_price(1.5)
        self.assertAlmostEqual(float(self.prepo.get(pid)["total_cost"]),
                               cost_before, delta=0.01)

    def test_dashboard_no_longer_reports_fake_profit(self):
        """`stats()` جمع final_price همه‌ی پروژه‌هاست → با مُهر، عدد درست می‌ماند."""
        sealed = self.make_project("قطعی", status="done")
        self.issue_invoice(sealed, kind="invoice")
        openp = self.make_project("باز", status="open")
        before = self.prepo.stats()["sum_price"]
        self.bump_body_price(1.5)
        after = self.prepo.stats()["sum_price"]
        # فقط پروژه‌ی باز باید رشد کند، نه پروژه‌ی مُهرشده
        self.assertLess(after - before, self.price(openp) * 0.6,
                        "داشبورد رشدِ پروژه‌ی مُهرشده را هم شمرده است")

    def test_rates_rev_still_written_so_sealed_project_is_not_flagged_stale(self):
        """تصمیمِ مستند: rates_rev نوشته می‌شود تا پروژه‌ی مُهرشده برای همیشه
        «نرخ قدیمی» نخورد و هر بار بازمحاسبه‌ی بی‌نتیجه نشود."""
        pid = self.make_project(status="done")
        self.bump_body_price(1.5)
        row = self.prepo.get(pid)
        self.assertEqual(int(row["rates_rev"]), rc.current_prices_rev(self.db))
        self.assertFalse(rc.project_is_stale(self.db, row))

    def test_seal_is_logged_for_audit(self):
        pid = self.make_project(status="done")
        self.bump_body_price(1.5)
        rows = self.db.q("SELECT message FROM activity_log WHERE kind='seal'")
        self.assertGreater(len(rows), 0, "هیچ ردیفِ حسابرسی‌ای ثبت نشد")
        self.assertIn(str(pid), rows[0]["message"])

    def test_repeated_price_changes_stay_sealed(self):
        pid = self.make_project(status="done")
        self.issue_invoice(pid, kind="invoice")
        before = self.price(pid)
        for f in (1.1, 0.9, 2.0, 0.5):
            self.bump_body_price(f)
            self.assertAlmostEqual(self.price(pid), before, delta=0.01)


# ===========================================================================
# راهِ عبور و راهِ رفعِ مُهر
# ===========================================================================

class TestSealOverride(SealTestBase):

    def test_force_true_bypasses_the_seal(self):
        pid = self.make_project(status="done")
        applied = self.prepo.update(pid, {"final_price": 12345.0}, force=True)
        self.assertTrue(applied)
        self.assertAlmostEqual(self.price(pid), 12345.0, delta=0.01)

    def test_update_returns_false_when_blocked(self):
        pid = self.make_project(status="done")
        self.assertFalse(self.prepo.update(pid, {"final_price": 12345.0}))
        self.assertTrue(self.prepo.update(pid, {"note": "یادداشت آزاد است"}))

    def test_non_financial_fields_are_never_blocked(self):
        """مُهر فقط روی «مبلغِ محاسبه‌شده» است، نه روی داده‌ی توصیفی."""
        pid = self.make_project(status="done")
        self.prepo.update(pid, {"customer_name": "مشتری تازه", "note": "یادداشت",
                                "title": "عنوان تازه", "valid_until": "1405/09/01"})
        row = self.prepo.get(pid)
        self.assertEqual(row["customer_name"], "مشتری تازه")
        self.assertEqual(row["title"], "عنوان تازه")

    def test_status_can_be_changed_while_sealed(self):
        pid = self.make_project(status="done")
        self.prepo.update(pid, {"status": "open"})
        self.assertEqual(self.prepo.get(pid)["status"], "open")

    def test_voiding_the_invoice_unseals_a_non_done_project(self):
        pid = self.make_project(status="draft")
        iid, _ = self.issue_invoice(pid, kind="invoice")
        self.assertTrue(self.prepo.is_sealed(pid))
        self.irepo.delete(iid)
        self.assertFalse(self.prepo.is_sealed(pid))
        before = self.price(pid)
        self.bump_body_price(1.5)
        self.assertGreater(self.price(pid), before * 1.4)

    def test_unseal_requires_both_status_and_invoice(self):
        """پروژه‌ی done + فاکتور قطعی → هر دو باید برداشته شوند."""
        pid = self.make_project(status="done")
        iid, _ = self.issue_invoice(pid, kind="invoice")
        self.prepo.update(pid, {"status": "open"})
        self.assertTrue(self.prepo.is_sealed(pid), "فقط با تغییر وضعیت باز شد")
        self.irepo.delete(iid)
        self.assertFalse(self.prepo.is_sealed(pid))

    def test_unsealed_project_recalculates_normally(self):
        pid = self.make_project(status="done")
        iid, _ = self.issue_invoice(pid, kind="invoice")
        self.prepo.update(pid, {"status": "open"})
        self.irepo.delete(iid)
        before = self.price(pid)
        self.bump_body_price(1.5)
        self.assertAlmostEqual(self.price(pid), before * 1.5, delta=before * 0.06)

    def test_same_value_write_is_not_reported_as_blocked(self):
        """نوشتنِ همان مبلغِ مُهرشده «تلاش برای تغییر» نیست."""
        pid = self.make_project(status="done")
        cur = self.price(pid)
        self.assertTrue(self.prepo.update(pid, {"final_price": cur}))


# ===========================================================================
# مُهر نباید مسیرهای عادی را بشکند
# ===========================================================================

class TestSealDoesNotBreakNormalFlows(SealTestBase):

    def test_new_project_recalculates(self):
        pid = self.make_project()
        before = self.price(pid)
        self.assertGreater(before, 0)
        self.bump_body_price(1.5)
        self.assertGreater(self.price(pid), before)

    def test_duplicate_of_sealed_project_is_editable(self):
        """کپیِ یک پروژه‌ی قطعی باید «پیش‌نویس» و قابل بازمحاسبه باشد."""
        pid = self.make_project(status="done")
        self.issue_invoice(pid, kind="invoice")
        new_id = self.prepo.duplicate(pid)
        self.assertIsNotNone(new_id)
        self.assertEqual(self.prepo.get(new_id)["status"], "draft")
        self.assertFalse(self.prepo.is_sealed(new_id))
        before = self.price(new_id)
        self.bump_body_price(1.5)
        self.assertGreater(self.price(new_id), before * 1.4)

    def test_pages_are_still_editable_while_sealed(self):
        """مُهر فقط «مبلغ» را قفل می‌کند، نه ساختارِ داده‌ی پروژه."""
        pid = self.make_project(status="done")
        pages = self.prepo.pages_of(pid)
        self.prepo.save_page(int(pages[0]["id"]), "بخش ۱ (ویرایش)", 0,
                             {"units": [], "extras": [], "services": []})
        self.assertEqual(self.prepo.pages_of(pid)[0]["name"], "بخش ۱ (ویرایش)")

    def test_project_delete_still_works_while_sealed(self):
        pid = self.make_project(status="done")
        self.issue_invoice(pid, kind="invoice")
        self.prepo.delete(pid)
        self.assertIsNone(self.prepo.get(pid))

    def test_client_sent_final_price_cannot_forge_a_sealed_project(self):
        """مسیرِ ``api_project_update`` هم ``final_price`` کلاینت را می‌فرستد."""
        pid = self.make_project(status="done")
        sealed = self.price(pid)
        self.prepo.update(pid, {"final_price": 1.0, "customer_name": "هکر"})
        self.assertAlmostEqual(self.price(pid), sealed, delta=0.01)
        self.assertEqual(self.prepo.get(pid)["customer_name"], "هکر")

    def test_seal_check_is_cheap_and_repeatable(self):
        pid = self.make_project(status="done")
        for _ in range(50):
            self.assertTrue(self.prepo.is_sealed(pid))


if __name__ == "__main__":
    unittest.main(verbosity=2)
