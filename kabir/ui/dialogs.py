# -*- coding: utf-8 -*-
"""گفتگوهای ویرایش موجودیت‌ها: متریال، در، کشو، یونیت، سبک و تغییر دسته‌جمعی قیمت."""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDialog, QDoubleSpinBox, QFormLayout, QGridLayout,
    QGroupBox, QHBoxLayout, QHeaderView, QLabel, QLineEdit, QPushButton,
    QRadioButton, QSpinBox, QTabWidget, QTableWidget, QVBoxLayout, QWidget,
)

from ..core import persian as fa
from ..core.costing import (
    CATEGORY_LABELS, DOOR_MODELS, PRICE_UNITS, SHEET_CATEGORIES, UNIT_TYPES,
    DoorRow, DrawerRow, Material, PanelRow, UnitRow,
)
from .widgets import (
    DictCombo, Dialog, FaDoubleSpinBox, FaMoneySpinBox, FaSpinBox, MaterialCombo,
    ask_confirm, form_row, make_button, make_table, selected_row, set_row, cell_text,
)


# ===========================================================================
# متریال / خدمت
# ===========================================================================

class MaterialDialog(Dialog):
    def __init__(self, repo, parent=None, material: Optional[Material] = None,
                 default_category: str = "body_sheet"):
        super().__init__("افزودن متریال / خدمت جدید" if not material else
                         f"ویرایش: {material.name}", parent, width=560)
        self.repo = repo
        self.material = material
        cats = {c["key"]: c["title"] for c in repo.cats.all()}
        body = QWidget(self)
        grid = QGridLayout(body)
        grid.setSpacing(10)

        self.category = DictCombo(cats, selected=(material.category if material else default_category))
        self.category.currentIndexChanged.connect(self._on_category)
        self.name = QLineEdit()
        self.name.setPlaceholderText("نام تجاری قلم")
        self.unit = DictCombo(PRICE_UNITS)
        self.price = FaMoneySpinBox()
        self.sheet_w = FaDoubleSpinBox(decimals=0, maximum=1000, suffix=" سانتی‌متر")
        self.sheet_h = FaDoubleSpinBox(decimals=0, maximum=1000, suffix=" سانتی‌متر")
        self.thickness = FaDoubleSpinBox(decimals=1, maximum=100, suffix=" میل", step=0.5)
        self.width_cm = FaDoubleSpinBox(decimals=0, maximum=1000, suffix=" سانتی‌متر")
        self.supplier = QLineEdit()
        self.note = QLineEdit()

        r = 0
        grid.addLayout(form_row("دسته:", self.category), r, 0, 1, 2); r += 1
        grid.addLayout(form_row("نام:", self.name), r, 0, 1, 2); r += 1
        grid.addLayout(form_row("واحد قیمت:", self.unit), r, 0)
        grid.addLayout(form_row("قیمت:", self.price), r, 1); r += 1
        grid.addLayout(form_row("عرض ورق:", self.sheet_w), r, 0)
        grid.addLayout(form_row("ارتفاع ورق:", self.sheet_h), r, 1); r += 1
        grid.addLayout(form_row("ضخامت:", self.thickness), r, 0)
        grid.addLayout(form_row("عرض مؤثر:", self.width_cm), r, 1); r += 1
        grid.addLayout(form_row("تأمین‌کننده:", self.supplier), r, 0)
        grid.addLayout(form_row("یادداشت:", self.note), r, 1); r += 1

        self.hint = QLabel("")
        self.hint.setObjectName("Tiny")
        self.hint.setWordWrap(True)
        grid.addWidget(self.hint, r, 0, 1, 2); r += 1

        if material:
            self.category.set_key(material.category)
            self.name.setText(material.name)
            self.unit.set_key(material.unit)
            self.price.setValue(material.price)
            self.sheet_w.setValue(material.sheet_width_cm)
            self.sheet_h.setValue(material.sheet_height_cm)
            self.thickness.setValue(material.thickness_mm)
            self.width_cm.setValue(material.width_cm)
            self.supplier.setText(material.supplier)
            self.note.setText(material.note)
        else:
            self.sheet_w.setValue(183)
            self.sheet_h.setValue(366)
            self.thickness.setValue(16)
            self.width_cm.setValue(60)
        self._on_category()
        self.scroll_body(body)
        self.add_buttons()
        self.buttons.accepted.disconnect()
        self.buttons.accepted.connect(self._save)

    def _on_category(self) -> None:
        cat = self.category.key()
        is_sheet = cat in SHEET_CATEGORIES
        is_lm = CATEGORY_LABELS.get(cat) in ("صفحه کابینت", "تاج", "زیرچراغ", "پاخور") or \
            self.repo.cats.labels().get(cat, "") in ("صفحه کابینت", "تاج", "زیرچراغ", "پاخور")
        for w in (self.sheet_w, self.sheet_h, self.thickness):
            w.setVisible(is_sheet)
        self.width_cm.setVisible(cat == "countertop" or self.unit.key() == "lm")
        if is_sheet:
            self.unit.set_key("sheet")
            self.hint.setText("قیمت به‌ازای «هر ورق» وارد می‌شود؛ نرم‌افزار قیمت هر مترمربع را "
                              "خودکار محاسبه می‌کند.")
        else:
            self.hint.setText("")

    def _save(self) -> None:
        if not self.name.text().strip():
            self.name.setProperty("invalid", "true")
            self.name.style().unpolish(self.name)
            self.name.style().polish(self.name)
            return
        m = self.material or Material()
        m.category = self.category.key()
        m.name = self.name.text().strip()
        m.unit = self.unit.key()
        m.price = self.price.value()
        m.sheet_width_cm = self.sheet_w.value() if m.unit == "sheet" else 0
        m.sheet_height_cm = self.sheet_h.value() if m.unit == "sheet" else 0
        m.thickness_mm = self.thickness.value() if m.unit == "sheet" else 0
        m.width_cm = self.width_cm.value() if self.width_cm.isVisible() else 0
        m.supplier = self.supplier.text().strip()
        m.note = self.note.text().strip()
        if self.material:
            self.repo.update(m)
        else:
            m.id = self.repo.add(m)
        self.accept()


# ===========================================================================
# در
# ===========================================================================

class DoorDialog(Dialog):
    def __init__(self, repo, parent=None, door: Optional[DoorRow] = None):
        super().__init__("ویرایش لنگه در" if door else "افزودن لنگه در", parent, width=640)
        self.repo = repo
        self.door = door or DoorRow()
        d = self.door
        body = QWidget(self)
        grid = QGridLayout(body)
        grid.setSpacing(10)

        self.label = QLineEdit(d.label)
        self.qty = FaSpinBox(minimum=0, maximum=60, suffix=" لنگه")
        self.qty.setValue(d.qty)
        self.w = FaDoubleSpinBox(decimals=1, maximum=400, suffix=" سانتی‌متر")
        self.w.setValue(d.w_cm)
        self.h = FaDoubleSpinBox(decimals=1, maximum=400, suffix=" سانتی‌متر")
        self.h.setValue(d.h_cm)
        self.model = DictCombo(DOOR_MODELS, selected=d.model)
        self.material = MaterialCombo("door_sheet")
        self.door_model = MaterialCombo("door_model")
        self.banding = MaterialCombo("banding")
        self.hinge = MaterialCombo("hinge")
        self.hinges_per = FaSpinBox(minimum=0, maximum=12, suffix=" عدد/لنگه")
        self.hinges_per.setValue(d.hinges_per_leaf)
        self.gas = MaterialCombo("gas_spring")
        self.gas_per = FaSpinBox(minimum=0, maximum=8, suffix=" عدد/لنگه")
        self.gas_per.setValue(d.gas_springs_per_leaf)
        self.handle = MaterialCombo("handle")
        self.handles_per = FaSpinBox(minimum=0, maximum=6, suffix=" عدد/لنگه")
        self.handles_per.setValue(d.handles_per_leaf)
        self.assembly = MaterialCombo("service", none_label="— بدون مونتاژ —")
        self.packaging = MaterialCombo("service", none_label="— بدون بسته‌بندی —")
        self.glass = QCheckBox("در شیشه‌ای / قاب‌دار")
        self.glass.setChecked(d.glass)
        self.note = QLineEdit(d.note)

        r = 0
        grid.addLayout(form_row("برچسب:", self.label), r, 0)
        grid.addLayout(form_row("مدل بازشو:", self.model), r, 1); r += 1
        grid.addLayout(form_row("تعداد لنگه:", self.qty), r, 0)
        grid.addLayout(form_row("ابعاد هر لنگه:", self.w), r, 1); r += 1
        grid.addWidget(QLabel("ارتفاع لنگه:"), r, 0)
        grid.addWidget(self.h, r, 1); r += 1
        grid.addLayout(form_row("متریال در:", self.material), r, 0, 1, 2); r += 1
        grid.addLayout(form_row("مدل/اجرت ساخت:", self.door_model), r, 0, 1, 2); r += 1
        grid.addLayout(form_row("نوار لبه:", self.banding), r, 0, 1, 2); r += 1
        grid.addLayout(form_row("لولا:", self.hinge), r, 0)
        grid.addLayout(form_row("تعداد لولا:", self.hinges_per), r, 1); r += 1
        grid.addLayout(form_row("گازور/جک:", self.gas), r, 0)
        grid.addLayout(form_row("تعداد جک:", self.gas_per), r, 1); r += 1
        grid.addLayout(form_row("دستگیره:", self.handle), r, 0)
        grid.addLayout(form_row("تعداد دستگیره:", self.handles_per), r, 1); r += 1
        grid.addLayout(form_row("مونتاژ هر لنگه:", self.assembly), r, 0)
        grid.addLayout(form_row("بسته‌بندی هر لنگه:", self.packaging), r, 1); r += 1
        grid.addWidget(self.glass, r, 0)
        grid.addLayout(form_row("یادداشت:", self.note), r, 1); r += 1

        self.area_lbl = QLabel("")
        self.area_lbl.setObjectName("Muted")
        grid.addWidget(self.area_lbl, r, 0, 1, 2)
        for w in (self.qty, self.w, self.h):
            w.valueChanged.connect(self._update_area)

        # بارگذاری مقادیر
        self.material.load(repo, selected_id=d.material_id)
        self.door_model.load(repo, selected_id=d.door_model_id, allow_none=True)
        self.banding.load(repo, selected_id=d.banding_id)
        self.hinge.load(repo, selected_id=d.hinge_id)
        self.gas.load(repo, selected_id=d.gas_spring_id)
        self.handle.load(repo, selected_id=d.handle_id)
        self.assembly.load(repo, selected_id=d.assembly_id)
        self.packaging.load(repo, selected_id=d.packaging_id)
        self._update_area()
        self.scroll_body(body)
        self.add_buttons()

    def _update_area(self) -> None:
        a = self.qty.value() * (self.w.value() / 100) * (self.h.value() / 100)
        self.area_lbl.setText(f"مساحت کل درها: {fa.fmt_area(a)}   |   "
                              f"محیط هر لنگه: {fa.fmt_length(2 * (self.w.value() + self.h.value()) / 100)}")

    def result(self) -> DoorRow:
        d = self.door
        d.label = self.label.text().strip() or "در"
        d.qty = self.qty.value()
        d.w_cm = self.w.value()
        d.h_cm = self.h.value()
        d.model = self.model.key()
        d.material_id = self.material.material_id()
        d.material_name = self.material.currentText()
        d.door_model_id = self.door_model.material_id()
        d.door_model_name = self.door_model.currentText()
        d.banding_id = self.banding.material_id()
        d.banding_name = self.banding.currentText()
        d.hinge_id = self.hinge.material_id()
        d.hinge_name = self.hinge.currentText()
        d.hinges_per_leaf = self.hinges_per.value()
        d.gas_spring_id = self.gas.material_id()
        d.gas_spring_name = self.gas.currentText()
        d.gas_springs_per_leaf = self.gas_per.value()
        d.handle_id = self.handle.material_id()
        d.handle_name = self.handle.currentText()
        d.handles_per_leaf = self.handles_per.value()
        d.assembly_id = self.assembly.material_id()
        d.assembly_name = self.assembly.currentText()
        d.packaging_id = self.packaging.material_id()
        d.packaging_name = self.packaging.currentText()
        d.glass = self.glass.isChecked()
        d.note = self.note.text().strip()
        return d


# ===========================================================================
# کشو
# ===========================================================================

class DrawerDialog(Dialog):
    def __init__(self, repo, parent=None, drawer: Optional[DrawerRow] = None):
        super().__init__("ویرایش ردیف کشو" if drawer else "افزودن ردیف کشو", parent, width=600)
        self.repo = repo
        self.drawer = drawer or DrawerRow()
        d = self.drawer
        body = QWidget(self)
        grid = QGridLayout(body)
        grid.setSpacing(10)

        self.label = QLineEdit(d.label)
        self.qty = FaSpinBox(minimum=0, maximum=40, suffix=" عدد")
        self.qty.setValue(d.qty)
        self.w = FaDoubleSpinBox(decimals=1, maximum=300, suffix=" سانتی‌متر")
        self.w.setValue(d.w_cm)
        self.h = FaDoubleSpinBox(decimals=1, maximum=80, suffix=" سانتی‌متر")
        self.h.setValue(d.h_cm)
        self.dep = FaDoubleSpinBox(decimals=1, maximum=100, suffix=" سانتی‌متر")
        self.dep.setValue(d.d_cm)
        self.slide = MaterialCombo("drawer_slide")
        self.handle = MaterialCombo("handle")
        self.sheet = MaterialCombo("drawer_sheet", extra_categories=["body_sheet"])
        self.front = MaterialCombo("door_sheet", none_label="— همان ورق در —")
        self.banding = MaterialCombo("banding")
        self.assembly = MaterialCombo("service", none_label="— بدون مونتاژ —")
        self.note = QLineEdit(d.note)

        r = 0
        grid.addLayout(form_row("برچسب:", self.label), r, 0)
        grid.addLayout(form_row("تعداد کشو:", self.qty), r, 1); r += 1
        grid.addLayout(form_row("عرض:", self.w), r, 0)
        grid.addLayout(form_row("ارتفاع تیره:", self.h), r, 1); r += 1
        grid.addLayout(form_row("عمق:", self.dep), r, 0)
        grid.addLayout(form_row("ریل:", self.slide), r, 1); r += 1
        grid.addLayout(form_row("ورق جعبه‌ی کشو:", self.sheet), r, 0, 1, 2); r += 1
        grid.addLayout(form_row("ورق تیره‌ی کشو:", self.front), r, 0, 1, 2); r += 1
        grid.addLayout(form_row("نوار لبه:", self.banding), r, 0, 1, 2); r += 1
        grid.addLayout(form_row("دستگیره:", self.handle), r, 0)
        grid.addLayout(form_row("مونتاژ هر کشو:", self.assembly), r, 1); r += 1
        grid.addLayout(form_row("یادداشت:", self.note), r, 0, 1, 2); r += 1

        self.sheet.load(repo, selected_id=d.sheet_id)
        self.front.load(repo, selected_id=d.front_id)
        self.slide.load(repo, selected_id=d.slide_id)
        self.handle.load(repo, selected_id=d.handle_id)
        self.banding.load(repo, selected_id=d.banding_id)
        self.assembly.load(repo, selected_id=d.assembly_id)
        self.scroll_body(body)
        self.add_buttons()

    def result(self) -> DrawerRow:
        d = self.drawer
        d.label = self.label.text().strip() or "کشو"
        d.qty = self.qty.value()
        d.w_cm = self.w.value()
        d.h_cm = self.h.value()
        d.d_cm = self.dep.value()
        d.slide_id = self.slide.material_id()
        d.slide_name = self.slide.currentText()
        d.handle_id = self.handle.material_id()
        d.handle_name = self.handle.currentText()
        d.sheet_id = self.sheet.material_id()
        d.sheet_name = self.sheet.currentText()
        d.front_id = self.front.material_id()
        d.front_name = self.front.currentText()
        d.banding_id = self.banding.material_id()
        d.banding_name = self.banding.currentText()
        d.assembly_id = self.assembly.material_id()
        d.assembly_name = self.assembly.currentText()
        d.note = self.note.text().strip()
        return d


# ===========================================================================
# یونیت
# ===========================================================================

class UnitDialog(Dialog):
    def __init__(self, repo, parent=None, unit: Optional[UnitRow] = None,
                 style_data: Optional[Dict[str, Any]] = None):
        super().__init__("ویرایش یونیت" if unit else "افزودن یونیت جدید", parent, width=860)
        self.repo = repo
        self.unit = unit or UnitRow(id=uuid.uuid4().hex[:8])
        u = self.unit
        self.style_data = style_data or {}

        tabs = QTabWidget(self)
        self.main_layout.addWidget(tabs, 1)

        # ---------------- تب ابعاد و متریال ----------------
        tab1 = QWidget()
        g = QGridLayout(tab1)
        g.setSpacing(10)
        self.label = QLineEdit(u.label)
        self.utype = DictCombo(UNIT_TYPES, selected=u.unit_type)
        self.qty = FaSpinBox(minimum=1, maximum=200, suffix=" عدد")
        self.qty.setValue(max(1, u.qty))
        self.length = FaDoubleSpinBox(decimals=1, maximum=1000, suffix=" سانتی‌متر")
        self.length.setValue(u.length_cm)
        self.height = FaDoubleSpinBox(decimals=1, maximum=400, suffix=" سانتی‌متر")
        self.height.setValue(u.height_cm)
        self.depth = FaDoubleSpinBox(decimals=1, maximum=120, suffix=" سانتی‌متر")
        self.depth.setValue(u.depth_cm)
        self.shelves = FaSpinBox(minimum=0, maximum=20, suffix=" طبقه")
        self.shelves.setValue(u.shelves)
        self.pins = FaSpinBox(minimum=0, maximum=12, suffix=" خار/طبقه")
        self.pins.setValue(u.pins_per_shelf)
        self.legs_per = FaDoubleSpinBox(decimals=0, maximum=20, suffix=" عدد")
        self.legs_per.setValue(u.legs_per_unit)
        self.has_top = QCheckBox("سقف یونیت")
        self.has_top.setChecked(u.has_top_panel)
        self.has_bottom = QCheckBox("کف یونیت")
        self.has_bottom.setChecked(u.has_bottom_panel)

        self.body = MaterialCombo("body_sheet")
        self.back = MaterialCombo("back_sheet", none_label="— بدون فیبر پشت —")
        self.countertop = MaterialCombo("countertop", none_label="— بدون صفحه —")
        self.crown = MaterialCombo("crown", none_label="— بدون تاج —")
        self.underlight = MaterialCombo("underlight", none_label="— بدون زیرچراغ —")
        self.kickboard = MaterialCombo("kickboard", none_label="— بدون پاخور —")
        self.leg = MaterialCombo("leg", none_label="— بدون پایه —")
        self.banding = MaterialCombo("banding")
        self.pin = MaterialCombo("shelf_pin")
        self.assembly = MaterialCombo("service", none_label="— بدون مونتاژ —")

        r = 0
        g.addLayout(form_row("برچسب یونیت:", self.label), r, 0, 1, 2)
        g.addLayout(form_row("نوع یونیت:", self.utype), r, 2, 1, 2); r += 1
        g.addLayout(form_row("تعداد:", self.qty), r, 0)
        g.addLayout(form_row("طول:", self.length), r, 1)
        g.addLayout(form_row("ارتفاع:", self.height), r, 2)
        g.addLayout(form_row("عمق:", self.depth), r, 3); r += 1
        g.addLayout(form_row("طبقات داخلی:", self.shelves), r, 0)
        g.addLayout(form_row("خار هر طبقه:", self.pins), r, 1)
        g.addLayout(form_row("پایه هر یونیت:", self.legs_per), r, 2)
        box = QHBoxLayout()
        box.addWidget(self.has_top)
        box.addWidget(self.has_bottom)
        g.addLayout(box, r, 3); r += 1

        gb = QGroupBox("متریال یونیت")
        gg = QGridLayout(gb)
        gg.setSpacing(8)
        combos = [("ورق بدنه:", self.body), ("فیبر پشت:", self.back),
                  ("صفحه کابینت:", self.countertop), ("تاج:", self.crown),
                  ("زیرچراغ:", self.underlight), ("پاخور:", self.kickboard),
                  ("پایه:", self.leg), ("نوار PVC:", self.banding),
                  ("خار طبقه:", self.pin), ("مونتاژ یونیت:", self.assembly)]
        for i, (lbl, w) in enumerate(combos):
            gg.addWidget(QLabel(lbl), i, 0)
            gg.addWidget(w, i, 1)
        g.addWidget(gb, r, 0, 1, 4); r += 1
        tabs.addTab(tab1, "ابعاد و متریال")

        # ---------------- تب درها ----------------
        tab2 = QWidget()
        v2 = QVBoxLayout(tab2)
        self.doors_table = make_table(["برچسب", "لنگه", "ابعاد (سانتی‌متر)", "مدل", "متریال",
                                       "لولا", "دستگیره", "مساحت (م²)"],
                                      widths=[110, 50, 110, 90, 150, 110, 100, 80])
        v2.addWidget(self.doors_table, 1)
        bar2 = QHBoxLayout()
        bar2.addWidget(make_button("افزودن در", "Primary", "＋", on_click=self._add_door))
        bar2.addWidget(make_button("ویرایش", "", "✎", on_click=self._edit_door))
        bar2.addWidget(make_button("حذف", "Danger", "🗑", on_click=self._del_door))
        bar2.addStretch(1)
        v2.addLayout(bar2)
        tabs.addTab(tab2, f"درها ({len(u.doors)})")

        # ---------------- تب کشوها ----------------
        tab3 = QWidget()
        v3 = QVBoxLayout(tab3)
        self.drawers_table = make_table(["برچسب", "تعداد", "ابعاد (سانتی‌متر)", "ریل",
                                         "ورق جعبه", "تیره", "دستگیره"],
                                        widths=[110, 60, 130, 150, 150, 130, 100])
        v3.addWidget(self.drawers_table, 1)
        bar3 = QHBoxLayout()
        bar3.addWidget(make_button("افزودن کشو", "Primary", "＋", on_click=self._add_drawer))
        bar3.addWidget(make_button("ویرایش", "", "✎", on_click=self._edit_drawer))
        bar3.addWidget(make_button("حذف", "Danger", "🗑", on_click=self._del_drawer))
        bar3.addStretch(1)
        v3.addLayout(bar3)
        tabs.addTab(tab3, f"کشوها ({len(u.drawers)})")

        # ---------------- تب ریز بدنه (دستی) ----------------
        tab4 = QWidget()
        v4 = QVBoxLayout(tab4)
        self.custom_check = QCheckBox("ریز بدنه را دستی وارد/ویرایش می‌کنم "
                                      "(به‌جای محاسبه‌ی خودکار از روی ابعاد)")
        self.custom_check.setChecked(bool(u.custom_panels))
        self.custom_check.toggled.connect(self._refresh_panels)
        v4.addWidget(self.custom_check)
        self.panels_table = make_table(["فعال", "عنوان قطعه", "تعداد", "عرض (سانتی‌متر)",
                                        "ارتفاع (سانتی‌متر)", "جنس", "نوار"],
                                       widths=[44, 200, 60, 110, 120, 90, 50], editable=True)
        v4.addWidget(self.panels_table, 1)
        bar4 = QHBoxLayout()
        bar4.addWidget(make_button("افزودن قطعه", "", "＋", on_click=self._add_panel))
        bar4.addWidget(make_button("حذف قطعه", "", "🗑", on_click=self._del_panel))
        bar4.addWidget(make_button("بازگشت به محاسبه‌ی خودکار", "Ghost", "⟳",
                                   on_click=self._reset_panels))
        bar4.addStretch(1)
        v4.addLayout(bar4)
        tabs.addTab(tab4, "ریز بدنه")

        # بارگذاری
        sd = self.style_data
        self.body.load(repo, selected_id=u.body_id or _mid(sd.get("body"), repo))
        self.back.load(repo, selected_id=u.back_id or _mid(sd.get("back"), repo))
        self.countertop.load(repo, selected_id=u.countertop_id or _mid(sd.get("countertop"), repo))
        self.crown.load(repo, selected_id=u.crown_id or _mid(sd.get("crown"), repo))
        self.underlight.load(repo, selected_id=u.underlight_id or _mid(sd.get("underlight"), repo))
        self.kickboard.load(repo, selected_id=u.kickboard_id or _mid(sd.get("kickboard"), repo))
        self.leg.load(repo, selected_id=u.leg_id or _mid(sd.get("leg"), repo))
        self.banding.load(repo, selected_id=u.banding_id or _mid(sd.get("banding"), repo))
        self.pin.load(repo, selected_id=u.shelf_pin_id or _mid(sd.get("shelf_pin"), repo))
        self.assembly.load(repo, selected_id=u.assembly_id or _mid(sd.get("assembly_unit"), repo))
        if not u.label:
            self.label.setText("یونیت " + UNIT_TYPES.get(self.utype.key(), ""))
        self._refresh_doors()
        self._refresh_drawers()
        self._refresh_panels()
        self.add_buttons()

    # ---- درها ----
    def _add_door(self) -> None:
        d = DoorDialog(self.repo, self)
        preset = self.style_data
        if preset:
            d.door.banding_id = d.door.banding_id or _mid(preset.get("banding"), self.repo)
            d.door.hinge_id = d.door.hinge_id or _mid(preset.get("hinge"), self.repo)
            d.door.handle_id = d.door.handle_id or _mid(preset.get("handle"), self.repo)
            d.door.material_id = d.door.material_id or _mid(preset.get("door"), self.repo)
            d.door.door_model_id = d.door.door_model_id or _mid(preset.get("door_model"), self.repo)
            d.door.assembly_id = d.door.assembly_id or _mid(preset.get("assembly_door"), self.repo)
            d.door.packaging_id = d.door.packaging_id or _mid(preset.get("packaging_door"), self.repo)
        if d.exec() == QDialog.Accepted:
            self.unit.doors.append(d.result())
            self._refresh_doors()

    def _edit_door(self) -> None:
        r = selected_row(self.doors_table)
        if r < 0:
            return
        d = DoorDialog(self.repo, self, self.unit.doors[r])
        if d.exec() == QDialog.Accepted:
            self.unit.doors[r] = d.result()
            self._refresh_doors()

    def _del_door(self) -> None:
        r = selected_row(self.doors_table)
        if r >= 0 and ask_confirm(self, "حذف در", "این لنگه در حذف شود؟"):
            self.unit.doors.pop(r)
            self._refresh_doors()

    def _refresh_doors(self) -> None:
        t = self.doors_table
        t.setRowCount(0)
        for d in self.unit.doors:
            r = t.rowCount()
            t.insertRow(r)
            area = d.area_sqm
            set_row(t, r, [d.label, fa.to_fa_digits(d.qty),
                           fa.ltr_runs(f"{d.w_cm:g} × {d.h_cm:g}"), DOOR_MODELS.get(d.model, d.model),
                           d.material_name, d.hinge_name, d.handle_name,
                           fa.fmt_number(area, 3)], align_center=[1, 2, 7])

    # ---- کشوها ----
    def _add_drawer(self) -> None:
        d = DrawerDialog(self.repo, self)
        if d.exec() == QDialog.Accepted:
            self.unit.drawers.append(d.result())
            self._refresh_drawers()

    def _edit_drawer(self) -> None:
        r = selected_row(self.drawers_table)
        if r < 0:
            return
        d = DrawerDialog(self.repo, self, self.unit.drawers[r])
        if d.exec() == QDialog.Accepted:
            self.unit.drawers[r] = d.result()
            self._refresh_drawers()

    def _del_drawer(self) -> None:
        r = selected_row(self.drawers_table)
        if r >= 0 and ask_confirm(self, "حذف کشو", "این ردیف کشو حذف شود؟"):
            self.unit.drawers.pop(r)
            self._refresh_drawers()

    def _refresh_drawers(self) -> None:
        t = self.drawers_table
        t.setRowCount(0)
        for d in self.unit.drawers:
            r = t.rowCount()
            t.insertRow(r)
            set_row(t, r, [d.label, fa.to_fa_digits(d.qty),
                           fa.ltr_runs(f"{d.w_cm:g} × {d.h_cm:g} × {d.d_cm:g}"), d.slide_name,
                           d.sheet_name, d.front_name, d.handle_name], align_center=[1, 2])

    # ---- ریز بدنه ----
    def _panels(self) -> List[PanelRow]:
        from ..core.costing import CostingEngine
        if self.unit.custom_panels:
            return [PanelRow(**{k: v for k, v in d.items()
                                if k in PanelRow.__dataclass_fields__})
                    for d in self.unit.custom_panels]
        tmp = UnitRow(**{k: v for k, v in self.unit.__dict__.items()
                         if k in UnitRow.__dataclass_fields__ and k not in ("doors", "drawers")})
        tmp.body_id = self.body.material_id()
        tmp.back_id = self.back.material_id()
        tmp.shelves = self.shelves.value()
        tmp.length_cm = self.length.value()
        tmp.height_cm = self.height.value()
        tmp.depth_cm = self.depth.value()
        tmp.has_top_panel = self.has_top.isChecked()
        tmp.has_bottom_panel = self.has_bottom.isChecked()
        tmp.qty = 1
        return CostingEngine([], {}).default_panels(tmp)

    def _refresh_panels(self) -> None:
        t = self.panels_table
        t.setRowCount(0)
        for p in self._panels():
            r = t.rowCount()
            t.insertRow(r)
            chk = QCheckBox()
            chk.setChecked(p.enabled)
            chk_b = QCheckBox()
            chk_b.setChecked(p.banding)
            set_row(t, r, [chk, p.label, p.qty, p.w_cm, p.h_cm,
                           {"body": "بدنه", "back": "فیبر", "drawer": "کشو"}.get(p.material_key, "بدنه"),
                           chk_b], align_center=[2, 3, 4, 5])

    def _add_panel(self) -> None:
        if not self.custom_check.isChecked():
            self.custom_check.setChecked(True)
        t = self.panels_table
        r = t.rowCount()
        t.insertRow(r)
        set_row(t, r, [QCheckBox(True), "قطعه‌ی جدید", 1, 90, 72, "بدنه", QCheckBox(True)],
                align_center=[2, 3, 4, 5])

    def _del_panel(self) -> None:
        r = selected_row(self.panels_table)
        if r >= 0:
            self.panels_table.removeRow(r)

    def _reset_panels(self) -> None:
        self.custom_check.setChecked(False)
        self._refresh_panels()

    def _read_panels(self) -> Optional[List[Dict[str, Any]]]:
        if not self.custom_check.isChecked():
            return None
        t = self.panels_table
        out = []
        for r in range(t.rowCount()):
            chk: QCheckBox = t.cellWidget(r, 0)
            chkb: QCheckBox = t.cellWidget(r, 6)
            key = {"بدنه": "body", "فیبر": "back", "کشو": "drawer"}.get(cell_text(t, r, 5), "body")
            out.append({
                "label": cell_text(t, r, 1),
                "qty": fa.parse_number(cell_text(t, r, 2)),
                "w_cm": fa.parse_number(cell_text(t, r, 3)),
                "h_cm": fa.parse_number(cell_text(t, r, 4)),
                "material_key": key,
                "banding": bool(chkb.isChecked()) if chkb else True,
                "enabled": bool(chk.isChecked()) if chk else True,
            })
        return out

    def result(self) -> UnitRow:
        u = self.unit
        u.label = self.label.text().strip() or "یونیت"
        u.unit_type = self.utype.key()
        u.qty = self.qty.value()
        u.length_cm = self.length.value()
        u.height_cm = self.height.value()
        u.depth_cm = self.depth.value()
        u.shelves = self.shelves.value()
        u.pins_per_shelf = self.pins.value()
        u.legs_per_unit = self.legs_per.value()
        u.has_top_panel = self.has_top.isChecked()
        u.has_bottom_panel = self.has_bottom.isChecked()
        u.body_id = self.body.material_id()
        u.body_name = self.body.currentText()
        u.back_id = self.back.material_id()
        u.back_name = self.back.currentText()
        u.countertop_id = self.countertop.material_id()
        u.countertop_name = self.countertop.currentText()
        u.crown_id = self.crown.material_id()
        u.crown_name = self.crown.currentText()
        u.underlight_id = self.underlight.material_id()
        u.underlight_name = self.underlight.currentText()
        u.kickboard_id = self.kickboard.material_id()
        u.kickboard_name = self.kickboard.currentText()
        u.leg_id = self.leg.material_id()
        u.leg_name = self.leg.currentText()
        u.banding_id = self.banding.material_id()
        u.banding_name = self.banding.currentText()
        u.shelf_pin_id = self.pin.material_id()
        u.shelf_pin_name = self.pin.currentText()
        u.assembly_id = self.assembly.material_id()
        u.assembly_name = self.assembly.currentText()
        u.custom_panels = self._read_panels()
        return u


def _mid(name: Optional[str], repo) -> int:
    """شناسه‌ی متریال از روی نام (برای اعمال سبک)."""
    if not name:
        return 0
    m = repo.find_by_name(name)
    return m.id if m else 0


# ===========================================================================
# سبک
# ===========================================================================

STYLE_ROLES = [
    ("body", "ورق بدنه", "body_sheet"),
    ("door", "ورق در", "door_sheet"),
    ("back", "فیبر پشت", "back_sheet"),
    ("drawer_sheet", "ورق جعبه‌ی کشو", "drawer_sheet"),
    ("door_model", "مدل/اجرت در", "door_model"),
    ("countertop", "صفحه کابینت", "countertop"),
    ("crown", "تاج", "crown"),
    ("underlight", "زیرچراغ", "underlight"),
    ("kickboard", "پاخور", "kickboard"),
    ("banding", "نوار PVC", "banding"),
    ("hinge", "لولا", "hinge"),
    ("gas_spring", "گازور / جک", "gas_spring"),
    ("shelf_pin", "خار طبقه", "shelf_pin"),
    ("handle", "دستگیره", "handle"),
    ("leg", "پایه", "leg"),
    ("slide", "ریل کشو", "drawer_slide"),
    ("assembly_door", "مونتاژ در", "service"),
    ("packaging_door", "بسته‌بندی در", "service"),
]


class StyleDialog(Dialog):
    def __init__(self, repo, parent=None, style: Optional[Dict[str, Any]] = None,
                 initial_data: Optional[Dict[str, Any]] = None):
        title = "ویرایش سبک" if style else "تعریف سبک جدید"
        super().__init__(title, parent, width=700)
        self.repo = repo
        data = dict(initial_data or {})
        if style:
            data = {**style.get("data", {})}
            data["__name"] = style.get("name", "")
            data["__note"] = style.get("note", "")
        self.style_id = style.get("id") if style else None
        body = QWidget(self)
        v = QVBoxLayout(body)
        v.setSpacing(10)

        row = QHBoxLayout()
        row.addWidget(QLabel("نام سبک:"))
        self.name = QLineEdit(data.get("__name", ""))
        self.name.setPlaceholderText("مثلاً: هایگلاس لوکس، ممبران کلاسیک…")
        row.addWidget(self.name, 1)
        v.addLayout(row)
        row2 = QHBoxLayout()
        row2.addWidget(QLabel("توضیح:"))
        self.note = QLineEdit(data.get("__note", ""))
        row2.addWidget(self.note, 1)
        v.addLayout(row2)

        grp = QGroupBox("متریال پیش‌فرض این سبک")
        gg = QGridLayout(grp)
        gg.setSpacing(8)
        self.combos: Dict[str, MaterialCombo] = {}
        for i, (key, label, cat) in enumerate(STYLE_ROLES):
            c = MaterialCombo(cat)
            c.load(repo, selected_id=_mid(data.get(key), repo))
            self.combos[key] = c
            gg.addWidget(QLabel(label + ":"), i // 2, (i % 2) * 2)
            gg.addWidget(c, i // 2, (i % 2) * 2 + 1)
        v.addWidget(grp)

        grp2 = QGroupBox("ضرایب و سود پیش‌فرض")
        g2 = QGridLayout(grp2)
        g2.setSpacing(8)
        self.waste = FaDoubleSpinBox(decimals=1, maximum=60, suffix=" ٪")
        self.waste.setValue(float(data.get("waste_percent", 10)))
        self.overhead = FaDoubleSpinBox(decimals=1, maximum=60, suffix=" ٪")
        self.overhead.setValue(float(data.get("overhead_percent", 0)))
        self.profit_mode = DictCombo({"markup": "مارکاپ (درصدی از هزینه)",
                                      "margin": "مارجین (درصدی از فروش)"},
                                     selected=data.get("profit_mode", "markup"))
        self.profit = FaDoubleSpinBox(decimals=1, maximum=300, suffix=" ٪")
        self.profit.setValue(float(data.get("profit_percent", 30)))
        g2.addLayout(form_row("پرت ورق:", self.waste), 0, 0)
        g2.addLayout(form_row("سربار کارگاه:", self.overhead), 0, 1)
        g2.addLayout(form_row("روش سود:", self.profit_mode), 1, 0)
        g2.addLayout(form_row("درصد سود:", self.profit), 1, 1)
        v.addWidget(grp2)
        v.addStretch(1)

        self.scroll_body(body)
        self.add_buttons()

    def result(self) -> tuple[str, str, Dict[str, Any]]:
        data: Dict[str, Any] = {}
        for key, combo in self.combos.items():
            m = self.repo.get(combo.material_id())
            if m:
                data[key] = m.name
        data["waste_percent"] = self.waste.value()
        data["overhead_percent"] = self.overhead.value()
        data["profit_mode"] = self.profit_mode.key()
        data["profit_percent"] = self.profit.value()
        return self.name.text().strip() or "سبک بدون نام", self.note.text().strip(), data
