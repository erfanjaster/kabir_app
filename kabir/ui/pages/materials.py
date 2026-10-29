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
"""صفحه‌ی مدیریت متریال و خدمات."""

from __future__ import annotations

from typing import List, Optional

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractItemView, QDoubleSpinBox, QFileDialog, QHBoxLayout, QHeaderView,
    QLabel, QLineEdit, QListWidget, QListWidgetItem, QMessageBox, QRadioButton,
    QSplitter, QTableWidget, QVBoxLayout, QWidget, QDialog, QGroupBox,
    QGridLayout, QButtonGroup,
)

from ...core import persian as fa
from ...core.costing import CATEGORY_LABELS, Material, SHEET_CATEGORIES
from ...core.exporters import export_materials_csv, export_materials_xlsx
from ...data.dao import MaterialRepo
from ..dialogs import MaterialDialog
from ..widgets import (Card, Dialog, FaDoubleSpinBox, make_button, make_table,
                       selected_row, set_row, cell_text)


def _is_active(m) -> bool:
    return bool(getattr(m, "active", 1))


class BulkPriceDialog(Dialog):
    """تغییر دسته‌جمعی قیمت‌ها با درصد دلخواه (مثبت/منفی)."""

    def __init__(self, repo: MaterialRepo, category: Optional[str], parent=None):
        super().__init__("به‌روزرسانی دسته‌جمعی قیمت‌ها", parent, width=480)
        self.repo = repo
        self.category = category
        body = QWidget(self)
        v = QVBoxLayout(body)
        v.setSpacing(12)

        self.scope = QButtonGroup(self)
        self.rb_all = QRadioButton("همه‌ی اقلام")
        self.rb_cat = QRadioButton(f"فقط دسته‌ی: {CATEGORY_LABELS.get(category, category) if category else '—'}")
        if not category:
            self.rb_cat.setEnabled(False)
        self.rb_all.setChecked(True)
        self.scope.addButton(self.rb_all, 1)
        self.scope.addButton(self.rb_cat, 2)
        v.addWidget(self.rb_all)
        v.addWidget(self.rb_cat)

        row = QHBoxLayout()
        row.addWidget(QLabel("درصد تغییر:"))
        self.pct = FaDoubleSpinBox(decimals=2, minimum=-90, maximum=500, suffix=" ٪", step=1)
        self.pct.setValue(10)
        row.addWidget(self.pct, 1)
        v.addLayout(row)
        for lbl, val in (("＋۵٪", 5), ("＋۱۰٪", 10), ("＋۲۵٪", 25), ("−۱۰٪", -10)):
            b = make_button(lbl, "Ghost", on_click=lambda _=False, v=val: self.pct.setValue(v))
            row.addWidget(b)

        row2 = QHBoxLayout()
        row2.addWidget(QLabel("دلیل (ثبت در تاریخچه):"))
        self.reason = QLineEdit("به‌روزرسانی نرخ بازار")
        row2.addWidget(self.reason, 1)
        v.addLayout(row2)

        self.preview = QLabel("")
        self.preview.setObjectName("Muted")
        self.preview.setWordWrap(True)
        v.addWidget(self.preview)
        self.pct.valueChanged.connect(self._preview)
        self._preview()
        v.addStretch(1)
        self.scroll_body(body)
        self.add_buttons()
        self.buttons.button(self.buttons.Save).setText("اعمال تغییر")

    def _preview(self) -> None:
        mats = self.repo.all()
        if self.rb_cat.isChecked() and self.category:
            mats = [m for m in mats if m.category == self.category]
        self.preview.setText(f"{fa.fmt_number(len(mats))} قلم شامل تغییر می‌شود. "
                             f"نمونه: {mats[0].name} ← {fa.fmt_number(mats[0].price * (1 + self.pct.value() / 100))}"
                             if mats else "موردی یافت نشد.")

    def apply(self) -> int:
        cat = self.category if self.rb_cat.isChecked() else None
        return self.repo.bulk_change_price(cat, self.pct.value(), reason=self.reason.text().strip())


class HistoryDialog(Dialog):
    def __init__(self, repo: MaterialRepo, parent=None):
        super().__init__("تاریخچه‌ی تغییرات قیمت", parent, width=720)
        body = QWidget(self)
        v = QVBoxLayout(body)
        self.table = make_table(["تاریخ", "متریال", "قیمت قبل", "قیمت جدید", "درصد تغییر", "دلیل"],
                                widths=[120, 220, 110, 110, 90, 160])
        v.addWidget(self.table)
        rows = repo.history(limit=300)
        for h in rows:
            r = self.table.rowCount()
            self.table.insertRow(r)
            pct = float(h.get("change_pct") or 0)
            set_row(self.table, r, [fa.jdatetime_str(h["created_at"])[:10] if h.get("created_at") else "",
                                    h.get("material_name", ""),
                                    fa.fmt_number(h.get("old_price", 0)),
                                    fa.fmt_number(h.get("new_price", 0)),
                                    f"{fa.fmt_number(pct, 1)}٪", h.get("reason", "")],
                    align_center=[0, 2, 3, 4])
        self.scroll_body(body)
        bb = self.add_buttons()
        bb.button(bb.Save).setVisible(False)


class MaterialsPage(QWidget):
    def __init__(self, app_ctx, parent=None):
        super().__init__(parent)
        self.ctx = app_ctx
        self.repo = MaterialRepo(app_ctx.db)
        self.current_category: Optional[str] = None

        outer = QVBoxLayout(self)
        outer.setContentsMargins(18, 16, 18, 16)
        outer.setSpacing(12)

        head = QHBoxLayout()
        t = QLabel("متریال و خدمات")
        t.setObjectName("PageTitle")
        head.addWidget(t)
        sub = QLabel("کتابخانه‌ی قیمت‌ها برای استفاده‌ی همیشگی")
        sub.setObjectName("PageSubtitle")
        head.addWidget(sub)
        head.addStretch(1)
        self.search = QLineEdit()
        self.search.setPlaceholderText("🔍 جست‌وجوی نام متریال…")
        self.search.setFixedWidth(240)
        self.search.textChanged.connect(lambda _: self.refresh_table())
        head.addWidget(self.search)
        outer.addLayout(head)

        splitter = QSplitter(Qt.Horizontal, self)

        # --- فهرست دسته‌ها ---
        left = Card("دسته‌بندی‌ها", "")
        self.cat_list = QListWidget()
        self.cat_list.currentItemChanged.connect(self._on_cat)
        left.add_widget(self.cat_list)
        splitter.addWidget(left)

        # --- جدول متریال ---
        right = QWidget()
        rv = QVBoxLayout(right)
        rv.setContentsMargins(0, 0, 0, 0)
        rv.setSpacing(10)
        bar = QHBoxLayout()
        bar.addWidget(make_button("افزودن قلم", "Primary", "＋", on_click=self.add_item))
        bar.addWidget(make_button("ویرایش", "", "✎", on_click=self.edit_item))
        bar.addWidget(make_button("حذف", "Danger", "🗑", on_click=self.del_item))
        bar.addWidget(make_button("فعال/غیرفعال", "Ghost", "⊘", on_click=self.toggle_item))
        bar.addStretch(1)
        bar.addWidget(make_button("تغییر دسته‌جمعی قیمت", "", "٪", on_click=self.bulk_price))
        bar.addWidget(make_button("تاریخچه قیمت", "Ghost", "🕘", on_click=self.show_history))
        bar.addWidget(make_button("خروجی اکسل", "Ghost", "📊", on_click=self.export_xlsx))
        rv.addLayout(bar)

        self.table = make_table(["شناسه", "نام", "واحد", "قیمت", "قیمت هر م²",
                                 "ابعاد ورق", "ضخامت", "تأمین‌کننده", "وضعیت"],
                                widths=[52, 260, 74, 120, 120, 110, 62, 120, 70])
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.table.doubleClicked.connect(self.edit_item)
        rv.addWidget(self.table, 1)

        self.sum_lbl = QLabel("")
        self.sum_lbl.setObjectName("Muted")
        rv.addWidget(self.sum_lbl)
        splitter.addWidget(right)
        splitter.setStretchFactor(0, 1)
        splitter.setStretchFactor(1, 4)
        splitter.setSizes([220, 780])
        outer.addWidget(splitter, 1)

    # ------------------------------------------------------------------
    def refresh(self) -> None:
        self.cat_list.blockSignals(True)
        self.cat_list.clear()
        for c in self.repo.categories_with_counts():
            item = QListWidgetItem(f"{c['title']}  ({fa.to_fa_digits(c['cnt'])})")
            item.setData(Qt.UserRole, c["key"])
            self.cat_list.addItem(item)
        item = QListWidgetItem("همه‌ی اقلام")
        item.setData(Qt.UserRole, "__all__")
        self.cat_list.addItem(item)
        self.cat_list.blockSignals(False)
        if self.current_category:
            for i in range(self.cat_list.count()):
                if self.cat_list.item(i).data(Qt.UserRole) == self.current_category:
                    self.cat_list.setCurrentRow(i)
                    break
        else:
            self.cat_list.setCurrentRow(0)
        self.refresh_table()

    def _on_cat(self, current: QListWidgetItem, _prev=None) -> None:
        if not current:
            return
        key = current.data(Qt.UserRole)
        self.current_category = None if key == "__all__" else key
        self.refresh_table()

    def refresh_table(self) -> None:
        txt = self.search.text().strip()
        if txt:
            mats = self.repo.search(txt)
        elif self.current_category:
            mats = self.repo.by_category(self.current_category, active_only=False)
        else:
            mats = self.repo.all()
        self.table.setRowCount(0)
        cur = self.ctx.db.get_setting("currency", "ریال")
        active_ids = {r["id"]: bool(r["active"]) for r in
                      self.ctx.db.q("SELECT id, active FROM materials")}
        for m in mats:
            r = self.table.rowCount()
            status = "فعال" if active_ids.get(m.id, True) else "غیرفعال"
            self.table.insertRow(r)
            dims = fa.ltr_runs(f"{m.sheet_width_cm:g}×{m.sheet_height_cm:g}") if m.sheet_area_sqm else "—"
            ppm = fa.fmt_number(m.price_per_sqm) if m.price_per_sqm else "—"
            set_row(self.table, r, [
                fa.to_fa_digits(m.id), m.name,
                {"sheet": "ورق", "sqm": "مترمربع", "lm": "مترطول", "piece": "عدد",
                 "set": "ست", "kg": "کیلوگرم", "job": "موردی"}.get(m.unit, m.unit),
                fa.fmt_number(m.price),
                ppm, dims,
                f"{m.thickness_mm:g} میل" if m.thickness_mm else "—",
                m.supplier or "—",
                status,
            ], align_center=[0, 2, 3, 4, 5, 6, 8])
            self.table.item(r, 0).setData(Qt.UserRole, m.id)
        self.sum_lbl.setText(f"{fa.fmt_number(self.table.rowCount())} قلم نمایش داده شد."
                             + (f"  دسته: {CATEGORY_LABELS.get(self.current_category, '')}" if self.current_category else ""))

    # ------------------------------------------------------------------
    def _selected_id(self) -> Optional[int]:
        r = selected_row(self.table)
        if r < 0:
            return None
        it = self.table.item(r, 0)
        return it.data(Qt.UserRole) if it else None

    def add_item(self) -> None:
        d = MaterialDialog(self.repo, self, default_category=self.current_category or "body_sheet")
        if d.exec() == QDialog.Accepted:
            self.refresh_table()
            self.ctx.status("قلم جدید ذخیره شد.")

    def edit_item(self) -> None:
        mid = self._selected_id()
        if not mid:
            return
        m = self.repo.get(mid)
        if not m:
            return
        d = MaterialDialog(self.repo, self, material=m)
        if d.exec() == QDialog.Accepted:
            self.refresh_table()

    def del_item(self) -> None:
        mid = self._selected_id()
        if not mid:
            return
        m = self.repo.get(mid)
        from ..widgets import ask_confirm
        if m and ask_confirm(self, "حذف متریال", f"«{m.name}» برای همیشه حذف شود؟"):
            self.repo.delete(mid)
            self.refresh_table()

    def toggle_item(self) -> None:
        mid = self._selected_id()
        if mid:
            self.repo.toggle_active(mid)
            self.refresh_table()

    def bulk_price(self) -> None:
        d = BulkPriceDialog(self.repo, self.current_category, self)
        if d.exec() == QDialog.Accepted:
            n = d.apply()
            self.refresh_table()
            self.ctx.status(f"قیمت {fa.fmt_number(n)} قلم به‌روزرسانی شد.")

    def show_history(self) -> None:
        HistoryDialog(self.repo, self).exec()

    def export_xlsx(self) -> None:
        path, _ = QFileDialog.getSaveFileName(self, "خروجی اکسل", "materials.xlsx",
                                              "Excel (*.xlsx);;CSV (*.csv)")
        if not path:
            return
        try:
            if path.lower().endswith(".csv"):
                export_materials_csv(self.repo.all(), path, self.repo.cats.labels())
            else:
                export_materials_xlsx(self.repo.all(), path, self.repo.cats.labels())
            self.ctx.status(f"خروجی ذخیره شد: {path}")
        except Exception as exc:
            QMessageBox.critical(self, "خطا", str(exc))
