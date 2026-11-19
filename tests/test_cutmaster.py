# -*- coding: utf-8 -*-
"""تست خواندن فایل CutMaster 2D و مقایسه با برش‌نامه — اجرا:  pytest tests -v

فایلِ نمونه‌ی واقعی (samples/cutmaster_sample.xml) مبناست: ۳ ورق مصرف،
۲۹ نوع قطعه، ۵۲ قطعه، بازده ۹۰٫۴۹٪. اگر قالبِ خروجی CutMaster تغییر کند،
این تست‌ها اول‌از‌همه خبر می‌دهند.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from kabir.core import cutmaster as cm2d  # noqa: E402

SAMPLE = (ROOT / "samples" / "cutmaster_sample.xml").read_text(encoding="utf-8")


class TestParse:
    def setup_method(self):
        self.cm = cm2d.parse_cm2d(SAMPLE)

    def test_type_and_version(self):
        assert self.cm["type"] == "Pro"
        assert self.cm["version"] == "1.3"

    def test_stats(self):
        st = self.cm["stats"]
        assert st["used_sheets"] == 3
        assert st["parts"] == 52
        assert abs(st["average_yield"] - 90.49) < 0.01
        assert abs(st["part_area_sqm"] - 14.627) < 0.01

    def test_sheets(self):
        assert len(self.cm["sheets"]) == 2
        s2 = self.cm["sheets"][1]
        assert abs(s2["len_cm"] - 364) < 0.01
        assert abs(s2["wid_cm"] - 181) < 0.01

    def test_parts_normalized_big_small(self):
        parts = self.cm["parts"]
        assert len(parts) == 29
        first = parts[0]
        assert abs(first["len_cm"] - 91.8) < 0.01
        assert abs(first["wid_cm"] - 96) < 0.01
        # قطعه‌ی ۹۱٫۸×۹۶ → (بزرگ، کوچک) = (۹۶۰، ۹۱۸) میلی‌متر
        assert first["big_mm"] == 960
        assert first["small_mm"] == 918

    def test_diagrams_and_offcuts(self):
        dg = self.cm["diagrams"]
        assert len(dg) == 3                     # سه ورقِ مصرف‌شده
        assert dg[0]["tnb"] == 1
        assert len(dg[0]["pieces"]) > 0
        assert len(dg[0]["offcuts"]) > 0
        # مختصات دهم‌میلی‌متر → میلی‌متر: 9183 → 918.3
        assert abs(dg[0]["pieces"][0]["x_mm"] - 0) < 0.1
        assert abs(dg[0]["pieces"][0]["w_mm"] - 918.3) < 0.1
        assert dg[0]["len_mm"] == 1810          # ورق ۱۸۱ سانتی
        assert dg[0]["wid_mm"] == 1810

    def test_total_pieces_in_diagrams(self):
        n = sum(len(d["pieces"]) for d in self.cm["diagrams"])
        assert n == 52                          # هر قطعه یک placement

    def test_every_used_sheet_has_dims(self):
        """tnb=3 در tab_sheets نیست — اندازه‌اش از مختصات باید در بیاید."""
        for d in self.cm["diagrams"]:
            assert d["len_mm"] > 0 and d["wid_mm"] > 0, f"ورق {d['tnb']} بی‌ابعاد"

    def test_corrupt_xml_raises_friendly(self):
        import pytest
        with pytest.raises(cm2d.CutMasterError):
            cm2d.parse_cm2d("not xml at all")
        with pytest.raises(cm2d.CutMasterError):
            cm2d.parse_cm2d("<other_root/>")


class TestCompare:
    def setup_method(self):
        self.cm = cm2d.parse_cm2d(SAMPLE)

    def test_exact_match(self):
        our = [{"part": "بدنه", "unit": "ی۱", "qty": 1,
                "length_mm": 960.0, "width_mm": 918.0}]
        c = cm2d.compare_with_our_parts(self.cm, our)
        assert c["ours_only"] == []
        assert c["matched_pieces"] == 1

    def test_full_agreement_is_ok(self):
        """همه‌ی ۲۹ نوعِ قطعه را با همان تعداد ادعا کنیم → نباید مغایرتی بماند."""
        our = [{"part": f"p{p['idx']}", "unit": "ی۱", "qty": p["qty"],
                "length_mm": float(p["big_mm"]), "width_mm": float(p["small_mm"])}
               for p in self.cm["parts"]]
        c = cm2d.compare_with_our_parts(self.cm, our)
        assert c["ok"] is True
        assert c["ours_only"] == [] and c["cm_only"] == []
        assert c["matched_pieces"] == 52
        assert c["total_ours"] == 52 and c["total_cm"] == 52

    def test_orientation_agnostic(self):
        our = [{"part": "بدنه", "unit": "ی۱", "qty": 1,
                "length_mm": 918.0, "width_mm": 960.0}]
        c = cm2d.compare_with_our_parts(self.cm, our)
        assert c["matched_pieces"] == 1
        assert c["ours_only"] == []

    def test_tolerance_half_mm(self):
        our = [{"part": "قلم", "unit": "ی۱", "qty": 1,
                "length_mm": 961.2, "width_mm": 919.1}]
        c = cm2d.compare_with_our_parts(self.cm, our)
        assert c["matched_pieces"] == 1

    def test_ours_only_detected(self):
        our = [{"part": "قطعه‌ی نایاب", "unit": "ی۱", "qty": 3,
                "length_mm": 1234.0, "width_mm": 321.0}]
        c = cm2d.compare_with_our_parts(self.cm, our)
        assert c["ok"] is False
        assert len(c["ours_only"]) == 1
        assert c["ours_only"][0]["qty"] == 3

    def test_partial_qty_match(self):
        # در فایل نمونه «۹۰×۳۰» با تعداد ۱۰ هست — ما ۱۲ تا ادعا کنیم
        our = [{"part": "طبقه", "unit": "ی۱", "qty": 12,
                "length_mm": 900.0, "width_mm": 300.0}]
        c = cm2d.compare_with_our_parts(self.cm, our)
        assert c["matched_pieces"] == 10
        assert c["ours_only"][0]["qty"] == 2
