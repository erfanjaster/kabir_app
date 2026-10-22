# -*- coding: utf-8 -*-
"""صفحه‌ی پروژه‌ها: تعریف پروژه، بخش‌ها (سبک‌ها)، یونیت‌ها، اضافات و محاسبه‌ی زنده."""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QButtonGroup, QCheckBox, QComboBox, QDialog, QDoubleSpinBox, QFrame,
    QGridLayout, QGroupBox, QHBoxLayout, QHeaderView, QLabel, QLineEdit,
    QListWidget, QListWidgetItem, QRadioButton, QScrollArea, QSplitter,
    QTabWidget, QTableWidget, QVBoxLayout, QWidget,
)

from ...core import persian as fa
from ...core.costing import (
    CostingEngine, DOOR_MODELS, ExtraRow, Material, Page, PageResult,
    PRICE_UNITS, ServiceRow, UNIT_TYPES, UnitRow,
)
from ...data.dao import MaterialRepo, ProjectRepo, StyleRepo
from ..dialogs import UnitDialog
from ..widgets import (
    Banner, Card, DictCombo, FaDoubleSpinBox, FaMoneySpinBox, FaSpinBox,
    make_button, make_table, selected_row, set_row, cell_text,
    ask_confirm, wrap_with_button,
)

SERVICE_BASES = {
    "unit": "به ازای هر یونیت",
    "door": "به ازای هر لنگه در",
    "shelf": "به ازای هر طبقه",
    "lm": "به ازای هر متر طول",
    "sqm": "به ازای هر مترمربع",
    "fixed": "مبلغ ثابت",
    "percent": "درصدی از جمع بخش",
}

EXTRA_UNITS = {"piece": "عدد", "lm": "متر طول", "sqm": "مترمربع", "set": "ست",
               "job": "موردی", "kg": "کیلوگرم"}


# ===========================================================================
# ویرایشگر یک بخش (صفحه)
# ===========================================================================

class PageEditor(QWidget):
    def __init__(self, ctx, page: Page, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.page = page
        self.last_result: Optional[PageResult] = None

        outer = QVBoxLayout(self)
        outer.setContentsMargins(10, 10, 10, 10)
        outer.setSpacing(10)

        scroll = QScrollArea(self)
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        host = QWidget()
        v = QVBoxLayout(host)
        v.setContentsMargins(2, 2, 2, 2)
        v.setSpacing(12)

        # ---------------- سربرگ بخش ----------------
        top = QGroupBox("مشخصات بخش و سبک")
        g = QGridLayout(top)
        g.setSpacing(8)
        g.addWidget(QLabel("نام بخش:"), 0, 0)
        self.name = QLineEdit(page.name)
        g.addWidget(self.name, 0, 1)
        g.addWidget(QLabel("سبک:"), 0, 2)
        self.style_combo = QComboBox()
        self.style_combo.addItem("— بدون سبک —", 0)
        for st in StyleRepo(ctx.db).all():
            self.style_combo.addItem(f"✦ {st['name']}", st["id"])
        if page.style_id:
            i = self.style_combo.findData(page.style_id)
            if i >= 0:
                self.style_combo.setCurrentIndex(i)
        self.style_combo.currentIndexChanged.connect(self._apply_style)
        g.addWidget(self.style_combo, 0, 3)
        g.addWidget(QLabel("پرت ورق:"), 1, 0)
        self.waste = FaDoubleSpinBox(decimals=1, maximum=60, suffix=" ٪")
        self.waste.setValue(page.waste_percent)
        g.addWidget(self.waste, 1, 1)
        g.addWidget(QLabel("سربار کارگاه:"), 1, 2)
        self.overhead = FaDoubleSpinBox(decimals=1, maximum=60, suffix=" ٪")
        self.overhead.setValue(page.overhead_percent)
        g.addWidget(self.overhead, 1, 3)
        g.addWidget(QLabel("ضریب نوار بدنه:"), 2, 0)
        self.bb_factor = FaDoubleSpinBox(decimals=2, maximum=10, step=0.1)
        self.bb_factor.setValue(page.banding_body_factor)
        g.addWidget(self.bb_factor, 2, 1)
        g.addWidget(QLabel("ضریب نوار در:"), 2, 2)
        self.bd_factor = FaDoubleSpinBox(decimals=2, maximum=10, step=0.1)
        self.bd_factor.setValue(page.banding_door_factor)
        g.addWidget(self.bd_factor, 2, 3)
        g.addWidget(QLabel("پرت نوار:"), 3, 0)
        self.bw = FaDoubleSpinBox(decimals=1, maximum=50, suffix=" ٪")
        self.bw.setValue(page.banding_waste_percent)
        g.addWidget(self.bw, 3, 1)
        g.addWidget(QLabel("صفحه‌کابینت کلی:"), 3, 2)
        self.ct_lm = FaDoubleSpinBox(decimals=2, maximum=200, suffix=" متر")
        self.ct_lm.setValue(page.countertop_lm)
        g.addWidget(self.ct_lm, 3, 3)
        v.addWidget(top)

        # ---------------- یونیت‌ها ----------------
        units_card = Card("یونیت‌های کابینت", "زمینی، دیواری، کمد ایستاده، پکیج کشو")
        self.units_table = make_table(
            ["برچسب", "نوع", "تعداد", "ابعاد (طول×ارتفاع×عمق)", "طبقات", "در", "کشو", "ورق بدنه", "ورق در"],
            widths=[150, 92, 52, 168, 52, 44, 48, 150, 150])
        self.units_table.doubleClicked.connect(self.edit_unit)
        units_card.add_widget(self.units_table)
        bar = QHBoxLayout()
        bar.addWidget(make_button("افزودن یونیت", "Primary", "＋", on_click=self.add_unit))
        bar.addWidget(make_button("ویرایش یونیت", "", "✎", on_click=self.edit_unit))
        bar.addWidget(make_button("تکثیر", "Ghost", "⧉", on_click=self.dup_unit))
        bar.addWidget(make_button("حذف", "Ghost", "🗑", on_click=self.del_unit))
        bar.addStretch(1)
        units_card.add_layout(bar)
        v.addWidget(units_card)

        # ---------------- درنما ----------------
        darna = QGroupBox("درنما (درب‌های نمای خاص)")
        dv = QVBoxLayout(darna)
        self.darna_mode = QButtonGroup(self)
        row = QHBoxLayout()
        self.rb_none = QRadioButton("بدون درنما")
        self.rb_detail = QRadioButton("ریز (اندازه‌ی دقیق هر قسمت)")
        self.rb_total = QRadioButton("کلی (متراژ و قیمت کل)")
        for i, rb in enumerate((self.rb_none, self.rb_detail, self.rb_total)):
            self.darna_mode.addButton(rb, i)
            row.addWidget(rb)
        row.addStretch(1)
        dv.addLayout(row)
        self.detail_table = make_table(["عنوان", "تعداد", "عرض (سانتی‌متر)",
                                        "ارتفاع (سانتی‌متر)", "قیمت هر م²", "مبلغ"],
                                       widths=[180, 60, 110, 120, 130, 130], editable=True)
        dv.addWidget(self.detail_table)
        dbar = QHBoxLayout()
        dbar.addWidget(make_button("افزودن ردیف درنما", "Ghost", "＋", on_click=self._add_detail))
        dbar.addWidget(make_button("حذف ردیف", "Ghost", "🗑", on_click=self._del_detail))
        dbar.addStretch(1)
        dbar.addWidget(QLabel("متراژ کل:"))
        self.dt_sqm = FaDoubleSpinBox(decimals=2, maximum=500, suffix=" م²")
        self.dt_sqm.setValue(page.detail_total_sqm)
        dbar.addWidget(self.dt_sqm)
        dbar.addWidget(QLabel("قیمت هر م²:"))
        self.dt_price = FaMoneySpinBox()
        self.dt_price.setValue(page.detail_price_per_sqm)
        dbar.addWidget(self.dt_price)
        dv.addLayout(dbar)
        v.addWidget(darna)
        {"none": self.rb_none, "detailed": self.rb_detail,
         "total": self.rb_total}.get(page.detail_mode, self.rb_none).setChecked(True)

        # ---------------- اضافات ----------------
        extras = Card("اضافات و اکسسوری‌های جانبی", "نورپردازی، سینک، جاکفشی و هر قلم متفرقه")
        self.extras_table = make_table(["شرح", "تعداد", "واحد", "فی", "مبلغ کل", ""],
                                       widths=[260, 62, 92, 130, 140, 40], editable=True)
        extras.add_widget(self.extras_table)
        ebar = QHBoxLayout()
        ebar.addWidget(make_button("افزودن ردیف", "Ghost", "＋", on_click=self._add_extra))
        ebar.addWidget(make_button("حذف ردیف", "Ghost", "🗑", on_click=self._del_extra))
        ebar.addStretch(1)
        extras.add_layout(ebar)
        v.addWidget(extras)

        # ---------------- خدمات ----------------
        services = Card("خدمات این بخش", "مونتاژ، بسته‌بندی، حمل، طراحی و…")
        self.services_table = make_table(["شرح خدمت", "مبنای محاسبه", "نرخ", ""],
                                         widths=[300, 190, 150, 40], editable=True)
        services.add_widget(self.services_table)
        sbar = QHBoxLayout()
        sbar.addWidget(make_button("افزودن ردیف", "Ghost", "＋", on_click=self._add_service))
        sbar.addWidget(make_button("حذف ردیف", "Ghost", "🗑", on_click=self._del_service))
        sbar.addStretch(1)
        services.add_layout(sbar)
        v.addWidget(services)

        # ---------------- خلاصه ----------------
        self.summary = QLabel("")
        self.summary.setObjectName("Card")
        self.summary.setStyleSheet("padding: 12px; font-size: 12px;")
        self.summary.setWordWrap(True)
        v.addWidget(self.summary)
        v.addStretch(1)

        scroll.setWidget(host)
        outer.addWidget(scroll, 1)

        self._refresh_units()
        self._refresh_extras()
        self._refresh_services()
        self._refresh_details()

    # ---------------- سبک ----------------
    def _apply_style(self) -> None:
        sid = int(self.style_combo.currentData() or 0)
        if not sid:
            return
        st = StyleRepo(self.ctx.db).get(sid)
        if not st:
            return
        d = st["data"]
        self.page.style_id = sid
        self.page.style_name = st["name"]
        self.waste.setValue(float(d.get("waste_percent", self.waste.value())))
        self.overhead.setValue(float(d.get("overhead_percent", self.overhead.value())))
        repo = MaterialRepo(self.ctx.db)

        def mid(name):
            m = repo.find_by_name(name) if name else None
            return m.id if m else 0

        for u in self.page.units:
            for role, attr in (("body", "body_id"), ("back", "back_id"),
                               ("banding", "banding_id"), ("countertop", "countertop_id"),
                               ("leg", "leg_id"), ("shelf_pin", "shelf_pin_id")):
                if d.get(role):
                    setattr(u, attr, mid(d[role]))
            for dr in u.doors:
                if d.get("door"):
                    dr.material_id = mid(d["door"])
                if d.get("hinge"):
                    dr.hinge_id = mid(d["hinge"])
                if d.get("handle"):
                    dr.handle_id = mid(d["handle"])
                if d.get("banding"):
                    dr.banding_id = mid(d["banding"])
                if d.get("door_model"):
                    dr.door_model_id = mid(d["door_model"])
                if d.get("assembly_door"):
                    dr.assembly_id = mid(d["assembly_door"])
                if d.get("packaging_door"):
                    dr.packaging_id = mid(d["packaging_door"])
            for dw in u.drawers:
                if d.get("slide"):
                    dw.slide_id = mid(d["slide"])
                if d.get("drawer_sheet"):
                    dw.sheet_id = mid(d["drawer_sheet"])
                if d.get("handle"):
                    dw.handle_id = mid(d["handle"])
        self._refresh_units()
        self.ctx.status(f"سبک «{st['name']}» روی بخش «{self.page.name}» اعمال شد.")

    # ---------------- یونیت‌ها ----------------
    def _style_data(self) -> Dict[str, Any]:
        sid = int(self.style_combo.currentData() or 0)
        if sid:
            st = StyleRepo(self.ctx.db).get(sid)
            if st:
                return st["data"]
        return {}

    def add_unit(self) -> None:
        d = UnitDialog(MaterialRepo(self.ctx.db), self, style_data=self._style_data())
        if d.exec() == QDialog.Accepted:
            self.page.units.append(d.result())
            self._refresh_units()

    def edit_unit(self) -> None:
        r = selected_row(self.units_table)
        if r < 0:
            return
        d = UnitDialog(MaterialRepo(self.ctx.db), self, self.page.units[r])
        if d.exec() == QDialog.Accepted:
            self.page.units[r] = d.result()
            self._refresh_units()

    def dup_unit(self) -> None:
        r = selected_row(self.units_table)
        if r < 0:
            return
        import copy
        u = copy.deepcopy(self.page.units[r])
        u.id = uuid.uuid4().hex[:8]
        u.label = u.label + " (کپی)"
        self.page.units.append(u)
        self._refresh_units()

    def del_unit(self) -> None:
        r = selected_row(self.units_table)
        if r >= 0 and ask_confirm(self, "حذف یونیت", f"«{self.page.units[r].label}» حذف شود؟"):
            self.page.units.pop(r)
            self._refresh_units()

    def _refresh_units(self) -> None:
        t = self.units_table
        t.setRowCount(0)
        repo = MaterialRepo(self.ctx.db)
        for u in self.page.units:
            r = t.rowCount()
            t.insertRow(r)
            body = repo.get(u.body_id)
            door_mat = ""
            if u.doors:
                dm = repo.get(u.doors[0].material_id)
                door_mat = dm.name if dm else u.doors[0].material_name
            set_row(t, r, [
                u.label, UNIT_TYPES.get(u.unit_type, u.unit_type), fa.to_fa_digits(u.qty),
                fa.ltr_runs(f"{u.length_cm:g} × {u.height_cm:g} × {u.depth_cm:g}"),
                fa.to_fa_digits(u.shelves), fa.to_fa_digits(sum(d.qty for d in u.doors)),
                fa.to_fa_digits(sum(d.qty for d in u.drawers)),
                body.name if body else u.body_name, door_mat,
            ], align_center=[1, 2, 3, 4, 5, 6])

    # ---------------- درنما ----------------
    def _add_detail(self) -> None:
        t = self.detail_table
        r = t.rowCount()
        t.insertRow(r)
        set_row(t, r, ["قسمت درنما", 1, 60, 90, 1_500_000, "—"], align_center=[1, 2, 3, 4, 5])
        self.rb_detail.setChecked(True)

    def _del_detail(self) -> None:
        r = selected_row(self.detail_table)
        if r >= 0:
            self.detail_table.removeRow(r)

    def _refresh_details(self) -> None:
        t = self.detail_table
        t.setRowCount(0)
        for row in self.page.detail_rows:
            r = t.rowCount()
            t.insertRow(r)
            set_row(t, r, [row.label, row.qty, row.w_cm, row.h_cm, row.price_per_sqm,
                           fa.fmt_number(row.cost)], align_center=[1, 2, 3, 4, 5])

    # ---------------- اضافات ----------------
    def _add_extra(self) -> None:
        t = self.extras_table
        r = t.rowCount()
        t.insertRow(r)
        combo = QComboBox()
        for k, v in EXTRA_UNITS.items():
            combo.addItem(v, k)
        combo.setCurrentIndex(0)
        del_btn = make_button("🗑", "Icon", on_click=lambda _=False, tbl=t: self._del_row(tbl))
        set_row(t, r, ["قلم جدید (مثلاً نورپردازی)", 1, combo, 0, "—", del_btn],
                align_center=[1, 3, 4])

    def _del_extra(self) -> None:
        self._del_row(self.extras_table)

    @staticmethod
    def _del_row(tbl: QTableWidget) -> None:
        r = selected_row(tbl)
        if r >= 0:
            tbl.removeRow(r)

    def _refresh_extras(self) -> None:
        t = self.extras_table
        t.setRowCount(0)
        for ex in self.page.extras:
            r = t.rowCount()
            t.insertRow(r)
            combo = QComboBox()
            for k, v in EXTRA_UNITS.items():
                combo.addItem(v, k)
            i = combo.findData(ex.unit)
            combo.setCurrentIndex(max(0, i))
            del_btn = make_button("🗑", "Icon", on_click=lambda _=False: self._del_row(t))
            set_row(t, r, [ex.label, ex.qty, combo, ex.price, fa.fmt_number(ex.cost), del_btn],
                    align_center=[1, 3, 4])

    # ---------------- خدمات ----------------
    def _add_service(self) -> None:
        t = self.services_table
        r = t.rowCount()
        t.insertRow(r)
        combo = DictCombo(SERVICE_BASES, selected="fixed")
        del_btn = make_button("🗑", "Icon", on_click=lambda _=False: self._del_row(t))
        set_row(t, r, ["خدمت جدید", combo, 0, del_btn], align_center=[2])

    def _del_service(self) -> None:
        self._del_row(self.services_table)

    def _refresh_services(self) -> None:
        t = self.services_table
        t.setRowCount(0)
        for s in self.page.services:
            r = t.rowCount()
            t.insertRow(r)
            combo = DictCombo(SERVICE_BASES, selected=s.basis)
            del_btn = make_button("🗑", "Icon", on_click=lambda _=False: self._del_row(t))
            set_row(t, r, [s.label, combo, s.price, del_btn], align_center=[2])

    # ---------------- جمع‌آوری داده ----------------
    def collect(self) -> Page:
        p = self.page
        p.name = self.name.text().strip() or "بخش"
        p.style_id = int(self.style_combo.currentData() or 0)
        p.waste_percent = self.waste.value()
        p.overhead_percent = self.overhead.value()
        p.banding_body_factor = self.bb_factor.value()
        p.banding_door_factor = self.bd_factor.value()
        p.banding_waste_percent = self.bw.value()
        p.countertop_lm = self.ct_lm.value()

        # درنما
        if self.rb_detail.isChecked():
            p.detail_mode = "detailed"
        elif self.rb_total.isChecked():
            p.detail_mode = "total"
        else:
            p.detail_mode = "none"
        p.detail_total_sqm = self.dt_sqm.value()
        p.detail_price_per_sqm = self.dt_price.value()
        rows = []
        t = self.detail_table
        for r in range(t.rowCount()):
            rows.append({
                "label": cell_text(t, r, 0),
                "qty": fa.parse_number(cell_text(t, r, 1)),
                "w_cm": fa.parse_number(cell_text(t, r, 2)),
                "h_cm": fa.parse_number(cell_text(t, r, 3)),
                "price_per_sqm": fa.parse_number(cell_text(t, r, 4)),
            })
        from ...core.costing import DetailRow
        p.detail_rows = [DetailRow.from_dict(d) for d in rows]

        # اضافات
        ex_rows: List[ExtraRow] = []
        t = self.extras_table
        for r in range(t.rowCount()):
            combo: QComboBox = t.cellWidget(r, 2)
            ex_rows.append(ExtraRow(
                label=cell_text(t, r, 0), qty=fa.parse_number(cell_text(t, r, 1)),
                unit=str(combo.currentData()) if combo else "piece",
                price=fa.parse_number(cell_text(t, r, 3))))
        p.extras = ex_rows

        # خدمات
        sv_rows: List[ServiceRow] = []
        t = self.services_table
        for r in range(t.rowCount()):
            combo: QComboBox = t.cellWidget(r, 1)
            sv_rows.append(ServiceRow(
                label=cell_text(t, r, 0),
                basis=str(combo.currentData()) if combo else "fixed",
                price=fa.parse_number(cell_text(t, r, 2))))
        p.services = sv_rows
        return p

    def show_summary(self, pr: PageResult) -> None:
        self.last_result = pr
        txt = (
            f"<b>یونیت:</b> {fa.fmt_number(pr.total_units)} عدد &nbsp;•&nbsp; "
            f"<b>لنگه در:</b> {fa.fmt_number(pr.total_doors)} &nbsp;•&nbsp; "
            f"<b>کشو:</b> {fa.fmt_number(pr.total_drawers)}<br>"
            f"<b>مساحت ورق بدنه:</b> {fa.fmt_area(pr.total_body_area)} &nbsp;•&nbsp; "
            f"<b>فیبر پشت:</b> {fa.fmt_area(pr.total_back_area)} &nbsp;•&nbsp; "
            f"<b>مساحت درها:</b> {fa.fmt_area(pr.total_door_area)}<br>"
            f"<b>نوار PVC:</b> {fa.fmt_length(pr.total_banding_m)} &nbsp;•&nbsp; "
            f"<b>ورق مصرفی:</b> {fa.fmt_number(pr.total_sheets)} ورق &nbsp;•&nbsp; "
            f"<b>متراژ:</b> زمینی {fa.fmt_number(pr.total_ground_lm, 2)} م / دیواری {fa.fmt_number(pr.total_wall_lm, 2)} م<br>"
            f"<b>هزینه‌ی مواد:</b> {fa.fmt_number(pr.material_cost)} &nbsp;•&nbsp; "
            f"<b>در:</b> {fa.fmt_number(pr.door_cost)} &nbsp;•&nbsp; "
            f"<b>یراق:</b> {fa.fmt_number(pr.accessory_cost)} &nbsp;•&nbsp; "
            f"<b>درنما:</b> {fa.fmt_number(pr.detail_cost)}<br>"
            f"<b>خدمات/مونتاژ:</b> {fa.fmt_number(pr.labor_cost + pr.service_cost)} &nbsp;•&nbsp; "
            f"<b>اضافات:</b> {fa.fmt_number(pr.extra_cost)} &nbsp;•&nbsp; "
            f"<b>سربار:</b> {fa.fmt_number(pr.overhead_amount)}<br>"
            f"<span style='font-size:14px'><b>جمع هزینه‌ی این بخش: {fa.fmt_number(pr.total_cost)}</b></span>"
        )
        self.summary.setText(txt)


# ===========================================================================
# صفحه‌ی پروژه‌ها
# ===========================================================================

class ProjectsPage(QWidget):
    def __init__(self, ctx, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.db = ctx.db
        self.repo = ProjectRepo(self.db)
        self.style_repo = StyleRepo(self.db)
        self.current_pid: Optional[int] = None
        self.editors: List[PageEditor] = []
        self.pages: List[Page] = []

        outer = QVBoxLayout(self)
        outer.setContentsMargins(18, 16, 18, 12)
        outer.setSpacing(10)

        head = QHBoxLayout()
        t = QLabel("پروژه‌ها")
        t.setObjectName("PageTitle")
        head.addWidget(t)
        sub = QLabel("تعریف پروژه‌ی ترکیبی، محاسبه‌ی دقیق و صدور فاکتور")
        sub.setObjectName("PageSubtitle")
        head.addWidget(sub)
        head.addStretch(1)
        self.search = QLineEdit()
        self.search.setPlaceholderText("🔍 جست‌وجوی پروژه…")
        self.search.setFixedWidth(200)
        self.search.textChanged.connect(lambda _: self.refresh_list())
        head.addWidget(self.search)
        outer.addLayout(head)

        splitter = QSplitter(Qt.Horizontal, self)

        # ---------- فهرست پروژه‌ها ----------
        left = Card("فهرست پروژه‌ها", "")
        lv = left.layout_
        self.proj_list = QListWidget()
        self.proj_list.currentItemChanged.connect(self._on_select)
        lv.addWidget(self.proj_list, 1)
        lbar = QHBoxLayout()
        lbar.addWidget(make_button("پروژه جدید", "Primary", "＋", on_click=self.new_project))
        lbar.addWidget(make_button("کپی", "Ghost", "⧉", on_click=self.dup_project))
        lbar.addWidget(make_button("حذف", "Ghost", "🗑", on_click=self.del_project))
        lv.addLayout(lbar)
        splitter.addWidget(left)

        # ---------- ویرایشگر ----------
        right = QWidget()
        rv = QVBoxLayout(right)
        rv.setContentsMargins(0, 0, 0, 0)
        rv.setSpacing(10)

        info = QGroupBox("مشخصات پروژه و مشتری")
        ig = QGridLayout(info)
        ig.setSpacing(8)
        self.f_title = QLineEdit()
        self.f_title.setPlaceholderText("مثلاً: کابینت آشپزخانه منزل آقای احمدی")
        self.f_code = QLineEdit()
        self.f_code.setReadOnly(True)
        self.f_customer = QLineEdit()
        self.f_phone = QLineEdit()
        self.f_mobile = QLineEdit()
        self.f_address = QLineEdit()
        self.f_status = DictCombo({"draft": "در جریان", "done": "انجام‌شده",
                                   "canceled": "لغوشده"}, selected="draft")
        self.f_valid = QLineEdit()
        self.f_valid.setPlaceholderText("۱۴۴/۰۸/۱۵")
        ig.addWidget(QLabel("عنوان:"), 0, 0)
        ig.addWidget(self.f_title, 0, 1, 1, 3)
        ig.addWidget(QLabel("کد:"), 0, 4)
        ig.addWidget(self.f_code, 0, 5)
        ig.addWidget(QLabel("مشتری:"), 1, 0)
        ig.addWidget(self.f_customer, 1, 1)
        ig.addWidget(QLabel("تلفن:"), 1, 2)
        ig.addWidget(self.f_phone, 1, 3)
        ig.addWidget(QLabel("همراه:"), 1, 4)
        ig.addWidget(self.f_mobile, 1, 5)
        ig.addWidget(QLabel("نشانی:"), 2, 0)
        ig.addWidget(self.f_address, 2, 1, 1, 3)
        ig.addWidget(QLabel("وضعیت:"), 2, 4)
        ig.addWidget(self.f_status, 2, 5)
        ig.addWidget(QLabel("اعتبار تا:"), 3, 4)
        ig.addWidget(wrap_with_button(self.f_valid), 3, 5)
        rv.addWidget(info)

        fin = QGroupBox("محاسبه‌ی سود، نصب و تخفیف")
        fg = QGridLayout(fin)
        fg.setSpacing(8)
        self.profit_mode = DictCombo({"markup": "مارکاپ (درصدی از هزینه)",
                                      "margin": "مارجین (درصدی از فروش)"},
                                     selected=self.db.get_setting("default_profit_mode", "markup"))
        self.profit_pct = FaDoubleSpinBox(decimals=2, maximum=500, suffix=" ٪")
        self.profit_pct.setValue(self.db.get_num("default_profit_percent", 30))
        self.install_mode = DictCombo({"fixed": "نصب: مبلغ ثابت",
                                       "per_meter": "نصب: به ازای متر طول زمینی",
                                       "percent": "نصب: درصدی از هزینه"},
                                      selected=self.db.get_setting("default_install_mode", "fixed"))
        self.install_val = FaMoneySpinBox()
        self.install_val.setValue(self.db.get_num("default_install_value", 0))
        self.disc_pct = FaDoubleSpinBox(decimals=2, maximum=100, suffix=" ٪")
        self.disc_amt = FaMoneySpinBox()
        self.vat_chk = QCheckBox("مالیات بر ارزش افزوده")
        self.vat_chk.setChecked(self.db.get_bool("vat_enabled", False))
        self.vat_pct = FaDoubleSpinBox(decimals=2, maximum=100, suffix=" ٪")
        self.vat_pct.setValue(self.db.get_num("vat_percent", 10))
        self.extra_amt = FaMoneySpinBox()
        self.profit_mode.currentIndexChanged.connect(self._live)
        self.profit_pct.valueChanged.connect(self._live)
        self.install_mode.currentIndexChanged.connect(self._live)
        self.install_val.valueChanged.connect(self._live)
        self.disc_pct.valueChanged.connect(self._live)
        self.disc_amt.valueChanged.connect(self._live)
        self.vat_chk.toggled.connect(self._live)
        self.vat_pct.valueChanged.connect(self._live)
        self.extra_amt.valueChanged.connect(self._live)

        fg.addWidget(QLabel("روش سود:"), 0, 0)
        fg.addWidget(self.profit_mode, 0, 1)
        fg.addWidget(QLabel("درصد سود:"), 0, 2)
        fg.addWidget(self.profit_pct, 0, 3)
        fg.addWidget(QLabel("تخفیف ٪:"), 0, 4)
        fg.addWidget(self.disc_pct, 0, 5)
        fg.addWidget(QLabel("تخفیف مبلغ:"), 1, 0)
        fg.addWidget(self.disc_amt, 1, 1)
        fg.addWidget(QLabel("حالت نصب:"), 1, 2)
        fg.addWidget(self.install_mode, 1, 3)
        fg.addWidget(QLabel("مقدار نصب:"), 1, 4)
        fg.addWidget(self.install_val, 1, 5)
        fg.addWidget(self.vat_chk, 2, 0)
        fg.addWidget(self.vat_pct, 2, 1)
        fg.addWidget(QLabel("مبلغ ثابت اضافه (تفاوت نوع در و…):"), 2, 2, 1, 2)
        fg.addWidget(self.extra_amt, 2, 4, 1, 2)
        rv.addWidget(fin)

        # ---------- تب بخش‌ها ----------
        self.tabs = QTabWidget()
        self.tabs.setTabsClosable(True)
        self.tabs.tabCloseRequested.connect(self._close_tab)
        rv.addWidget(self.tabs, 1)
        tbar = QHBoxLayout()
        tbar.addWidget(make_button("افزودن بخش (سبک)", "Primary", "＋", on_click=self.add_page))
        tbar.addWidget(make_button("نام بخش", "Ghost", "✎", on_click=self.rename_page))
        tbar.addStretch(1)
        tbar.addWidget(make_button("محاسبه‌ی دقیق", "Success", "🧮", on_click=self.calculate))
        tbar.addWidget(make_button("ذخیره‌ی پروژه", "", "💾", on_click=self.save))
        tbar.addWidget(make_button("صدور فاکتور", "", "🧾", on_click=self.goto_invoice))
        rv.addLayout(tbar)

        # ---------- نوار جمع ----------
        self.total_bar = QFrame()
        self.total_bar.setObjectName("TotalBar")
        tb = QHBoxLayout(self.total_bar)
        tb.setContentsMargins(16, 10, 16, 10)
        self.t_cost = QLabel("هزینه‌ی تمام‌شده: —")
        self.t_profit = QLabel("سود: —")
        self.t_price = QLabel("قیمت فروش: —")
        self.t_final = QLabel("—")
        self.t_final.setObjectName("BigNumber")
        for w in (self.t_cost, self.t_profit, self.t_price):
            w.setStyleSheet("font-weight:700;")
        tb.addWidget(self.t_cost)
        tb.addWidget(self.t_profit)
        tb.addWidget(self.t_price)
        tb.addStretch(1)
        tb.addWidget(QLabel("قابل پرداخت:"))
        tb.addWidget(self.t_final)
        rv.addWidget(self.total_bar)

        splitter.addWidget(right)
        splitter.setStretchFactor(0, 1)
        splitter.setStretchFactor(1, 4)
        splitter.setSizes([230, 820])
        outer.addWidget(splitter, 1)

        self.last_result = None

    # ==================================================================
    def refresh(self) -> None:
        self.refresh_list()

    def refresh_list(self) -> None:
        txt = self.search.text().strip()
        self.proj_list.blockSignals(True)
        self.proj_list.clear()
        for p in self.repo.all():
            label = f"{p.get('code', '')} — {p.get('customer_name') or p.get('title') or 'بدون نام'}"
            if txt and txt not in label:
                continue
            it = QListWidgetItem(label)
            it.setData(Qt.UserRole, p["id"])
            price = p.get("final_price") or 0
            if price:
                it.setToolTip(f"قیمت نهایی: {fa.fmt_number(price)}")
            self.proj_list.addItem(it)
        self.proj_list.blockSignals(False)
        if self.current_pid:
            for i in range(self.proj_list.count()):
                if self.proj_list.item(i).data(Qt.UserRole) == self.current_pid:
                    self.proj_list.setCurrentRow(i)
                    break

    def _on_select(self, current: QListWidgetItem, _prev=None) -> None:
        if not current:
            return
        pid = current.data(Qt.UserRole)
        self.load_project(int(pid))

    # ------------------------------------------------------------------
    def new_project(self) -> None:
        self.current_pid = None
        self.pages = []
        self._clear_tabs()
        self.f_title.setText("")
        self.f_code.setText(self.repo.next_code())
        self.f_customer.setText("")
        self.f_phone.setText("")
        self.f_mobile.setText("")
        self.f_address.setText("")
        self.f_status.set_key("draft")
        self.f_valid.setText("")
        self.profit_mode.set_key(self.db.get_setting("default_profit_mode", "markup"))
        self.profit_pct.setValue(self.db.get_num("default_profit_percent", 30))
        self.install_mode.set_key(self.db.get_setting("default_install_mode", "fixed"))
        self.install_val.setValue(self.db.get_num("default_install_value", 0))
        self.disc_pct.setValue(0)
        self.disc_amt.setValue(0)
        self.extra_amt.setValue(0)
        self.add_page()
        self._totals(0, 0, 0, 0)
        self.ctx.status("پروژه‌ی جدید آماده شد؛ پس از تکمیل، ذخیره کنید.")

    def load_project(self, pid: int) -> None:
        p = self.repo.get(pid)
        if not p:
            return
        self.current_pid = pid
        self.f_title.setText(p.get("title") or "")
        self.f_code.setText(p.get("code") or "")
        self.f_customer.setText(p.get("customer_name") or "")
        self.f_phone.setText(p.get("customer_phone") or "")
        self.f_mobile.setText(p.get("customer_mobile") or "")
        self.f_address.setText(p.get("customer_address") or "")
        self.f_status.set_key(p.get("status") or "draft")
        self.f_valid.setText(fa.to_fa_digits(p.get("valid_until") or ""))
        self.profit_mode.set_key(p.get("profit_mode") or "markup")
        self.profit_pct.setValue(float(p.get("profit_percent") or 0))
        self.install_mode.set_key(p.get("install_mode") or "fixed")
        self.install_val.setValue(float(p.get("install_value") or 0))
        self.disc_pct.setValue(float(p.get("discount_percent") or 0))
        self.disc_amt.setValue(float(p.get("discount_amount") or 0))
        self.vat_chk.setChecked(bool(p.get("vat_enabled")))
        self.vat_pct.setValue(float(p.get("vat_percent") or 10))
        self.extra_amt.setValue(float(p.get("extra_fixed_amount") or 0))
        self._clear_tabs()
        self.pages = self.repo.load_pages(pid)
        if not self.pages:
            self.pages = [Page(project_id=pid, name="بخش ۱")]
        for pg in self.pages:
            self._add_tab(pg)
        self.calculate(silent=True)

    def _clear_tabs(self) -> None:
        while self.tabs.count():
            self.tabs.widget(0).deleteLater()
            self.tabs.removeTab(0)
        self.editors = []

    def _add_tab(self, page: Page) -> PageEditor:
        ed = PageEditor(self.ctx, page)
        self.tabs.addTab(ed, page.name or "بخش")
        self.editors.append(ed)
        return ed

    def add_page(self) -> None:
        if len(self.editors) >= 12:
            return
        pg = Page(project_id=self.current_pid or 0, name=f"بخش {fa.to_fa_digits(len(self.editors) + 1)}",
                  waste_percent=self.db.get_num("default_waste_percent", 10),
                  overhead_percent=self.db.get_num("default_overhead_percent", 0),
                  banding_body_factor=self.db.get_num("banding_body_factor", 2.2),
                  banding_door_factor=self.db.get_num("banding_door_factor", 1.0),
                  banding_waste_percent=self.db.get_num("banding_waste_percent", 8))
        ed = self._add_tab(pg)
        self.pages.append(pg)
        self.tabs.setCurrentWidget(ed)

    def new_page_from_style(self, sid: int) -> None:
        self.add_page()
        ed = self.editors[-1]
        i = ed.style_combo.findData(sid)
        if i >= 0:
            ed.style_combo.setCurrentIndex(i)
        self.ctx.goto("projects")

    def rename_page(self) -> None:
        ed = self.tabs.currentWidget()
        if not ed:
            return
        from PySide6.QtWidgets import QInputDialog
        name, ok = QInputDialog.getText(self, "نام بخش", "نام جدید بخش:",
                                        text=ed.name.text())
        if ok and name.strip():
            ed.name.setText(name.strip())
            self.tabs.setTabText(self.tabs.currentIndex(), name.strip())

    def _close_tab(self, index: int) -> None:
        if self.tabs.count() <= 1:
            self.ctx.status("حداقل یک بخش باید باقی بماند.")
            return
        if not ask_confirm(self, "حذف بخش", f"بخش «{self.tabs.tabText(index)}» و تمام یونیت‌هایش حذف شود؟"):
            return
        ed = self.tabs.widget(index)
        if ed in self.editors:
            pg = ed.page
            self.editors.remove(ed)
            if pg in self.pages:
                self.pages.remove(pg)
            if pg.id:
                self.repo.delete_page(pg.id)
        ed.deleteLater()
        self.tabs.removeTab(index)

    # ------------------------------------------------------------------
    def _collect(self) -> List[Page]:
        for ed in self.editors:
            ed.collect()
            idx = self.tabs.indexOf(ed)
            self.tabs.setTabText(idx, ed.page.name)
        return [ed.page for ed in self.editors]

    def calculate(self, silent: bool = False):
        pages = self._collect()
        repo = MaterialRepo(self.db)
        engine = CostingEngine(repo.all(active_only=False), self.db.all_settings())
        result = engine.calc_project(
            pages,
            install_mode=self.install_mode.key(),
            install_value=self.install_val.value(),
            profit_mode=self.profit_mode.key(),
            profit_percent=self.profit_pct.value(),
            discount_percent=self.disc_pct.value(),
            discount_amount=self.disc_amt.value(),
            vat_enabled=self.vat_chk.isChecked(),
            vat_percent=self.vat_pct.value(),
            extra_fixed_amount=self.extra_amt.value(),
        )
        from ...core.exporters import attach_units
        attach_units(result, pages)
        self.last_result = result
        for ed, pr in zip(self.editors, result.pages):
            ed.show_summary(pr)
        cur = self.db.get_setting("currency", "ریال")
        scale = self.db.get_num("currency_scale", 1)
        self._totals(result.total_cost, result.profit_amount, result.gross_price,
                     result.final_price)
        if not silent:
            self.ctx.status(f"محاسبه انجام شد — هزینه: {fa.fmt_money(result.total_cost, cur, scale)} | "
                            f"قابل پرداخت: {fa.fmt_money(result.final_price, cur, scale)}")
        return result

    def _live(self, *_a) -> None:
        if self.last_result is not None:
            self.calculate(silent=True)

    def _totals(self, cost, profit, gross, final) -> None:
        cur = self.db.get_setting("currency", "ریال")
        scale = self.db.get_num("currency_scale", 1)
        self.t_cost.setText(f"هزینه‌ی تمام‌شده: {fa.fmt_money(cost, cur, scale)}")
        self.t_profit.setText(f"سود: {fa.fmt_money(profit, cur, scale)}")
        self.t_price.setText(f"قیمت فروش: {fa.fmt_money(gross, cur, scale)}")
        self.t_final.setText(fa.fmt_money(final, cur, scale))

    # ------------------------------------------------------------------
    def _project_dict(self) -> Dict[str, Any]:
        return {
            "title": self.f_title.text().strip(),
            "customer_name": self.f_customer.text().strip(),
            "customer_phone": self.f_phone.text().strip(),
            "customer_mobile": self.f_mobile.text().strip(),
            "customer_address": self.f_address.text().strip(),
            "status": self.f_status.key(),
            "install_mode": self.install_mode.key(),
            "install_value": self.install_val.value(),
            "profit_mode": self.profit_mode.key(),
            "profit_percent": self.profit_pct.value(),
            "discount_percent": self.disc_pct.value(),
            "discount_amount": self.disc_amt.value(),
            "vat_enabled": 1 if self.vat_chk.isChecked() else 0,
            "vat_percent": self.vat_pct.value(),
            "extra_fixed_amount": self.extra_amt.value(),
            "valid_until": fa.to_en_digits(self.f_valid.text().strip()),
        }

    def save(self) -> None:
        result = self.calculate(silent=True)
        data = self._project_dict()
        data["code"] = self.f_code.text().strip() or self.repo.next_code()
        data["total_cost"] = result.total_cost
        data["final_price"] = result.final_price
        if self.current_pid:
            self.repo.update(self.current_pid, data)
        else:
            self.current_pid = self.repo.create(data)
            for pg in self.pages:
                pg.project_id = self.current_pid
        for i, ed in enumerate(self.editors):
            pg = ed.page
            pg.project_id = self.current_pid
            if pg.id:
                self.repo.save_page(pg.id, pg.name, pg.style_id, pg.to_dict())
            else:
                pg.id = self.repo.add_page(self.current_pid, pg.name, pg.style_id,
                                           pg.to_dict(), i)
        self.db.log("project", f"ذخیره‌ی پروژه {data['code']}")
        self.refresh_list()
        self.ctx.status(f"پروژه‌ی {data['code']} ذخیره شد.")

    def dup_project(self) -> None:
        if not self.current_pid:
            return
        nid = self.repo.duplicate(self.current_pid)
        if nid:
            self.refresh_list()
            self.load_project(nid)
            self.ctx.status("کپی پروژه ساخته شد.")

    def del_project(self) -> None:
        if not self.current_pid:
            return
        code = self.f_code.text()
        if ask_confirm(self, "حذف پروژه", f"پروژه‌ی {code} همراه بخش‌ها و فاکتورهایش حذف شود؟"):
            self.repo.delete(self.current_pid)
            self.current_pid = None
            self.refresh_list()

    def goto_invoice(self) -> None:
        if not self.last_result:
            self.calculate(silent=True)
        self.save()
        self.ctx.open_invoice_for(self.current_pid, self.last_result)
