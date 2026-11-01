# -*- coding: utf-8 -*-
#
# ⚠️  کدِ مرده (DEAD CODE) — نگه داشته شده، ولی در اجرای فعلی استفاده نمی‌شود.
#     چرا مرده است:
#       • main.py / web.py فقط سرویس‌دهنده‌ی وب (kabir/web/server.py) را بالا می‌آورند
#       • هیچ فایلی بیرون از این پوشه، این پوشه را import نمی‌کند (grep -rn "kabir.ui" → صفر)
#       • MainWindow هرگز instantiate نمی‌شود
#       • PySide6 در requirements.txt و pyproject.toml نیست → import بدون نصب دستی می‌ترکد
#     🔴 تغییرات رابط/UX را در `webui/` اعمال کنید، نه اینجا.
#        این فایل‌ها با سیستم طراحی، میانبرها و لایه‌بندیِ رابط وب همگام نیستند و
#        ویرایش‌شان روی محصولی که کاربر می‌بیند هیچ اثری ندارد.
#     📄 راهنمای UX رابط وب: docs/UX_PLAYBOOK_v2.md
#     منبع: README.md «یادداشت نسخه» • docs/UX_AUDIT_v1.md «یافته‌ی ساختاری»
#
"""ویجت‌های قابل‌استفاده‌ی مجدد رابط کاربری کبیر."""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QFont
from PySide6.QtWidgets import (
    QAbstractItemView, QCheckBox, QComboBox, QDialog, QDialogButtonBox,
    QDoubleSpinBox, QFormLayout, QFrame, QGridLayout, QGroupBox, QHBoxLayout,
    QHeaderView, QLabel, QLineEdit, QPlainTextEdit, QPushButton, QScrollArea,
    QSizePolicy, QSpinBox, QTableWidget, QTableWidgetItem, QTextEdit,
    QVBoxLayout, QWidget,
)

from ..core import persian as fa
from ..core.costing import Material


# ---------------------------------------------------------------------------
# ورودی‌های عددی با نمایش فارسی
# ---------------------------------------------------------------------------

class FaDoubleSpinBox(QDoubleSpinBox):
    """اسپین‌باکس اعشاری که اعداد را فارسی نمایش می‌دهد و ورودی فارسی را هم می‌پذیرد."""

    def __init__(self, parent=None, decimals: int = 2, minimum: float = 0.0,
                 maximum: float = 10_000_000.0, suffix: str = "", step: float = 1.0):
        super().__init__(parent)
        self.setDecimals(decimals)
        self.setRange(minimum, maximum)
        self.setSingleStep(step)
        self.setSuffix(suffix)
        self.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)
        self.setButtonSymbols(QDoubleSpinBox.UpDownArrows)

    def textFromValue(self, value: float) -> str:
        return fa.to_fa_digits(f"{value:,.{self.decimals()}f}")

    def valueFromText(self, text: str) -> float:
        return fa.parse_number(text)

    def validate(self, text: str, pos: int):
        from PySide6.QtGui import QValidator
        clean = fa.to_en_digits(text).replace(",", "")
        suffix = self.suffix()
        if suffix and clean.endswith(suffix):
            clean = clean[: -len(suffix)]
        clean = clean.strip()
        if clean in ("", "-", ".", "-."):
            return QValidator.Intermediate, text, pos
        try:
            float(clean)
            return QValidator.Acceptable, text, pos
        except ValueError:
            return QValidator.Invalid, text, pos


class FaSpinBox(QSpinBox):
    """اسپین‌باکس صحیح با ارقام فارسی."""

    def __init__(self, parent=None, minimum: int = 0, maximum: int = 100_000,
                 suffix: str = "", step: int = 1):
        super().__init__(parent)
        self.setRange(minimum, maximum)
        self.setSingleStep(step)
        self.setSuffix(suffix)
        self.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)

    def textFromValue(self, value: int) -> str:
        return fa.to_fa_digits(f"{value:,}")

    def valueFromText(self, text: str) -> int:
        return int(fa.parse_number(text))

    def validate(self, text: str, pos: int):
        from PySide6.QtGui import QValidator
        clean = fa.to_en_digits(text).replace(",", "").strip()
        suffix = self.suffix()
        if suffix and clean.endswith(suffix):
            clean = clean[: -len(suffix)]
        if clean in ("", "-"):
            return QValidator.Intermediate, text, pos
        try:
            int(clean)
            return QValidator.Acceptable, text, pos
        except ValueError:
            return QValidator.Invalid, text, pos


class FaMoneySpinBox(FaDoubleSpinBox):
    """اسپین‌باکس مخصوص مبالغ (گام بزرگ، بدون اعشار)."""

    def __init__(self, parent=None, maximum: float = 100_000_000_000.0):
        super().__init__(parent, decimals=0, minimum=0.0, maximum=maximum, step=10_000)
        self.setGroupSeparatorShown(False)


# ---------------------------------------------------------------------------
# کارت‌ها و بنرها
# ---------------------------------------------------------------------------

class Card(QFrame):
    """کارت سفید با سربرگ عنوان."""

    def __init__(self, title: str = "", subtitle: str = "", parent=None,
                 stretch_content: bool = True):
        super().__init__(parent)
        self.setObjectName("Card")
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)
        if title:
            head = QFrame(self)
            head.setObjectName("CardHeader")
            hl = QHBoxLayout(head)
            hl.setContentsMargins(16, 10, 16, 10)
            ttl = QLabel(title)
            ttl.setObjectName("CardTitle")
            hl.addWidget(ttl)
            if subtitle:
                sub = QLabel(subtitle)
                sub.setObjectName("CardSub")
                hl.addWidget(sub)
            hl.addStretch(1)
            self.header_layout = hl
            outer.addWidget(head)
        self.body = QWidget(self)
        self.layout_ = QVBoxLayout(self.body)
        self.layout_.setContentsMargins(14, 14, 14, 14)
        self.layout_.setSpacing(10)
        outer.addWidget(self.body, 1 if stretch_content else 0)

    def add_widget(self, w: QWidget) -> None:
        self.layout_.addWidget(w)

    def add_layout(self, lay) -> None:
        self.layout_.addLayout(lay)


class StatCard(QFrame):
    """کارت آماری داشبورد."""

    def __init__(self, label: str, value: str = "۰", hint: str = "",
                 icon: str = "", parent=None):
        super().__init__(parent)
        self.setObjectName("StatCard")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(16, 14, 16, 14)
        lay.setSpacing(2)
        top = QHBoxLayout()
        self.icon_lbl = QLabel(icon)
        self.icon_lbl.setStyleSheet("font-size: 22px;")
        top.addWidget(self.icon_lbl)
        top.addStretch(1)
        lbl = QLabel(label)
        lbl.setObjectName("StatLabel")
        top.addWidget(lbl)
        lay.addLayout(top)
        self.value_lbl = QLabel(value)
        self.value_lbl.setObjectName("StatValue")
        self.value_lbl.setTextInteractionFlags(Qt.TextSelectableByMouse)
        lay.addWidget(self.value_lbl)
        self.hint_lbl = QLabel(hint)
        self.hint_lbl.setObjectName("StatHint")
        lay.addWidget(self.hint_lbl)

    def set_value(self, value: str, hint: str = "") -> None:
        self.value_lbl.setText(value)
        if hint:
            self.hint_lbl.setText(hint)


class Banner(QFrame):
    """بنر اطلاع‌رسانی رنگی."""

    def __init__(self, kind: str = "info", text: str = "", parent=None):
        super().__init__(parent)
        names = {"info": "BannerInfo", "warn": "BannerWarn",
                 "ok": "BannerOk", "bad": "BannerBad"}
        tnames = {"info": "BannerTextInfo", "warn": "BannerTextWarn",
                  "ok": "BannerTextOk", "bad": "BannerTextBad"}
        icons = {"info": "ⓘ", "warn": "⚠", "ok": "✔", "bad": "⛔"}
        self.setObjectName(names.get(kind, "BannerInfo"))
        lay = QHBoxLayout(self)
        lay.setContentsMargins(12, 8, 12, 8)
        ic = QLabel(icons.get(kind, "ⓘ"))
        lay.addWidget(ic)
        self.label = QLabel(text)
        self.label.setObjectName(tnames.get(kind, "BannerTextInfo"))
        self.label.setWordWrap(True)
        self.label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        lay.addWidget(self.label, 1)

    def set_text(self, text: str) -> None:
        self.label.setText(text)


# ---------------------------------------------------------------------------
# فرم‌ها
# ---------------------------------------------------------------------------

def form_row(label: str, widget: QWidget, tooltip: str = "") -> QHBoxLayout:
    lay = QHBoxLayout()
    lay.setSpacing(8)
    lb = QLabel(label)
    lb.setMinimumWidth(110)
    if tooltip:
        lb.setToolTip(tooltip)
        widget.setToolTip(tooltip)
    lay.addWidget(lb)
    lay.addWidget(widget, 1)
    return lay


def hline() -> QFrame:
    f = QFrame()
    f.setFrameShape(QFrame.HLine)
    f.setStyleSheet("color: palette(mid);")
    return f


def make_button(text: str, obj_name: str = "", icon: str = "",
                tooltip: str = "", on_click: Optional[Callable] = None) -> QPushButton:
    btn = QPushButton((icon + "  " if icon else "") + text)
    if obj_name:
        btn.setObjectName(obj_name)
    if tooltip:
        btn.setToolTip(tooltip)
    if on_click:
        btn.clicked.connect(on_click)
    return btn


# ---------------------------------------------------------------------------
# جدول‌ها
# ---------------------------------------------------------------------------

def make_table(headers: List[str], widths: Optional[List[int]] = None,
               editable: bool = False, min_h: int = 34) -> QTableWidget:
    t = QTableWidget(0, len(headers))
    t.setHorizontalHeaderLabels(headers)
    t.setAlternatingRowColors(True)
    t.setSelectionBehavior(QAbstractItemView.SelectRows)
    t.setSelectionMode(QAbstractItemView.SingleSelection)
    t.setEditTriggers(QAbstractItemView.DoubleClicked |
                      QAbstractItemView.SelectedClicked |
                      QAbstractItemView.EditKeyPressed)
    if not editable:
        t.setEditTriggers(QAbstractItemView.NoEditTriggers)
    t.verticalHeader().setVisible(False)
    t.verticalHeader().setDefaultSectionSize(min_h)
    t.horizontalHeader().setStretchLastSection(True)
    t.setWordWrap(True)
    if widths:
        for i, w in enumerate(widths):
            t.setColumnWidth(i, w)
    t.setStyleSheet(f"QTableWidget::item {{ padding: 4px; }}")
    return t


def set_row(table: QTableWidget, r: int, values: List[Any],
            align_center: Optional[List[int]] = None) -> None:
    align_center = align_center or []
    for c, v in enumerate(values):
        if isinstance(v, QWidget):
            table.setCellWidget(r, c, v)
            continue
        item = QTableWidgetItem(str(v))
        if c in align_center:
            item.setTextAlignment(Qt.AlignCenter)
        else:
            item.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
        table.setItem(r, c, item)


def cell_text(table: QTableWidget, r: int, c: int) -> str:
    it = table.item(r, c)
    return it.text() if it else ""


def selected_row(table: QTableWidget) -> int:
    rows = table.selectionModel().selectedRows()
    if rows:
        return rows[0].row()
    idx = table.selectionModel().selectedIndexes()
    return idx[0].row() if idx else -1


# ---------------------------------------------------------------------------
# کمبوباکس متریال
# ---------------------------------------------------------------------------

class MaterialCombo(QComboBox):
    """کمبوباکس انتخاب متریال از یک دسته‌ی مشخص."""

    def __init__(self, category: Optional[str] = None, parent=None,
                 allow_none: bool = True, none_label: str = "— بدون / انتخاب کنید —"):
        super().__init__(parent)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self._category = category
        self._allow_none = allow_none
        self._none_label = none_label
        self._items: List[Material] = []

    def load(self, repo, category: Optional[str] = None,
             selected_id: int = 0, extra_categories: Optional[List[str]] = None) -> None:
        cat = category if category is not None else self._category
        if cat:
            cats = [cat] + (extra_categories or [])
            mats: List[Material] = []
            for c in cats:
                mats.extend(repo.by_category(c, active_only=False))
        else:
            mats = repo.all(active_only=False)
        self.blockSignals(True)
        self.clear()
        self._items = []
        if self._allow_none:
            self.addItem(self._none_label, 0)
        for m in mats:
            label = m.name
            if not m.id:
                continue
            suffix = ""
            if m.unit == "sheet" and m.sheet_area_sqm:
                suffix = f" — {fa.fmt_number(m.price):,} / ورق ({m.sheet_width_cm:g}×{m.sheet_height_cm:g})"
            elif m.price:
                suffix = f" — {fa.fmt_number(m.price):,}"
            self.addItem(label + suffix, int(m.id))
            self._items.append(m)
        if selected_id:
            i = self.findData(int(selected_id))
            if i >= 0:
                self.setCurrentIndex(i)
        self.blockSignals(False)

    def material_id(self) -> int:
        return int(self.currentData() or 0)

    def set_material_id(self, mid: int) -> None:
        i = self.findData(int(mid or 0))
        if i >= 0:
            self.setCurrentIndex(i)


class DictCombo(QComboBox):
    """کمبوباکس ساخته‌شده از یک دیکشنری کلید→برچسب."""

    def __init__(self, mapping: Dict[str, str], parent=None, selected: str = ""):
        super().__init__(parent)
        for k, v in mapping.items():
            self.addItem(v, k)
        if selected:
            i = self.findData(selected)
            if i >= 0:
                self.setCurrentIndex(i)

    def key(self) -> str:
        return str(self.currentData() or "")

    def set_key(self, k: str) -> None:
        i = self.findData(k)
        if i >= 0:
            self.setCurrentIndex(i)


# ---------------------------------------------------------------------------
# گفتگوها
# ---------------------------------------------------------------------------

class Dialog(QDialog):
    """گفتگوی پایه با چیدمان ستونی و دکمه‌های استاندارد."""

    def __init__(self, title: str, parent=None, width: int = 620, height: int = 0):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.setModal(True)
        self.resize(width, height or int(width * 0.75))
        self.main_layout = QVBoxLayout(self)
        self.main_layout.setContentsMargins(16, 16, 16, 14)
        self.main_layout.setSpacing(12)
        head = QLabel(title)
        head.setObjectName("SectionTitle")
        self.main_layout.addWidget(head)
        self.buttons = QDialogButtonBox(self)
        self.buttons.setStandardButtons(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        self.buttons.button(QDialogButtonBox.Save).setText("ذخیره")
        self.buttons.button(QDialogButtonBox.Cancel).setText("انصراف")
        self.buttons.accepted.connect(self.accept)
        self.buttons.rejected.connect(self.reject)

    def add_buttons(self) -> QDialogButtonBox:
        self.main_layout.addWidget(self.buttons)
        return self.buttons

    def scroll_body(self, inner: QWidget) -> None:
        sa = QScrollArea(self)
        sa.setWidgetResizable(True)
        sa.setFrameShape(QFrame.NoFrame)
        sa.setWidget(inner)
        self.main_layout.addWidget(sa, 1)


class ConfirmDialog(QDialog):
    def __init__(self, title: str, message: str, parent=None,
                 ok_text: str = "تأیید", danger: bool = True):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.setModal(True)
        self.resize(440, 190)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(18, 18, 18, 16)
        lay.setSpacing(14)
        t = QLabel(title)
        t.setObjectName("SectionTitle")
        lay.addWidget(t)
        m = QLabel(message)
        m.setWordWrap(True)
        m.setStyleSheet("font-size: 13px;")
        lay.addWidget(m, 1)
        bb = QDialogButtonBox(self)
        bb.setStandardButtons(QDialogButtonBox.Yes | QDialogButtonBox.Cancel)
        b_ok = bb.button(QDialogButtonBox.Yes)
        b_ok.setText(ok_text)
        if danger:
            b_ok.setObjectName("Danger")
        bb.button(QDialogButtonBox.Cancel).setText("انصراف")
        bb.accepted.connect(self.accept)
        bb.rejected.connect(self.reject)
        lay.addWidget(bb)


def ask_confirm(parent, title: str, message: str, ok_text: str = "حذف",
                danger: bool = True) -> bool:
    d = ConfirmDialog(title, message, parent, ok_text=ok_text, danger=danger)
    return d.exec() == QDialog.Accepted


class JalaliDateDialog(QDialog):
    """انتخاب تاریخ شمسی با سه کمبوباکس."""

    def __init__(self, parent=None, initial: str = ""):
        super().__init__(parent)
        self.setWindowTitle("انتخاب تاریخ شمسی")
        self.setModal(True)
        self.resize(360, 170)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(18, 16, 18, 14)
        lay.setSpacing(12)
        t = QLabel("تاریخ شمسی")
        t.setObjectName("SectionTitle")
        lay.addWidget(t)
        row = QHBoxLayout()
        jy, jm, jd = fa.today_jalali()
        if initial:
            parts = fa.to_en_digits(initial).replace("-", "/").split("/")
            if len(parts) == 3:
                try:
                    jy, jm, jd = int(parts[0]), int(parts[1]), int(parts[2])
                except ValueError:
                    pass
        self.year = QComboBox()
        for y in range(jy - 5, jy + 6):
            self.year.addItem(fa.to_fa_digits(y), y)
        self.year.setCurrentIndex(5)
        self.month = QComboBox()
        for m in range(1, 13):
            self.month.addItem(fa.jalali_month_name(m), m)
        self.day = QComboBox()
        self._fill_days(jy, jm, jd)
        self.year.currentIndexChanged.connect(lambda _: self._fill_days())
        self.month.currentIndexChanged.connect(lambda _: self._fill_days())
        row.addWidget(QLabel("سال:"))
        row.addWidget(self.year, 1)
        row.addWidget(QLabel("ماه:"))
        row.addWidget(self.month, 1)
        row.addWidget(QLabel("روز:"))
        row.addWidget(self.day, 1)
        lay.addLayout(row)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.button(QDialogButtonBox.Ok).setText("تأیید")
        bb.button(QDialogButtonBox.Cancel).setText("انصراف")
        bb.accepted.connect(self.accept)
        bb.rejected.connect(self.reject)
        lay.addWidget(bb)

    def _fill_days(self, jy: int = 0, jm: int = 0, keep: int = 0) -> None:
        y = int(self.year.currentData() or jy)
        m = int(self.month.currentData() or jm)
        cur = keep or int(self.day.currentData() or 1)
        self.day.blockSignals(True)
        self.day.clear()
        for d in range(1, fa.jalali_month_days(y, m) + 1):
            self.day.addItem(fa.to_fa_digits(d), d)
        i = self.day.findData(cur)
        self.day.setCurrentIndex(max(0, i))
        self.day.blockSignals(False)

    def value(self) -> str:
        return f"{self.year.currentData():04d}/{self.month.currentData():02d}/{self.day.currentData():02d}"


def wrap_with_button(field: QLineEdit) -> QWidget:
    w = QWidget()
    lay = QHBoxLayout(w)
    lay.setContentsMargins(0, 0, 0, 0)
    lay.setSpacing(3)
    lay.addWidget(field, 1)
    btn = QPushButton("📅")
    btn.setObjectName("Icon")
    btn.setFixedSize(32, 28)
    btn.clicked.connect(lambda: _pick_date(field))
    lay.addWidget(btn)
    return w


def _pick_date(field: QLineEdit) -> None:
    d = JalaliDateDialog(field.window(), field.text())
    if d.exec() == QDialog.Accepted:
        field.setText(fa.to_fa_digits(d.value()))


# ---------------------------------------------------------------------------
# متن چندخطی کوچک
# ---------------------------------------------------------------------------

class NoteEdit(QPlainTextEdit):
    def __init__(self, parent=None, placeholder: str = "", max_h: int = 74):
        super().__init__(parent)
        self.setPlaceholderText(placeholder)
        self.setMaximumHeight(max_h)
