# -*- coding: utf-8 -*-
"""صفحه‌ی صدور فاکتور / پیش‌فاکتور با فیلتر ردیف‌ها و خروجی PDF/چاپ/اکسل."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from PySide6.QtCore import Qt
from PySide6.QtGui import QDesktopServices
from PySide6.QtCore import QUrl
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDialog, QFileDialog, QFrame, QGridLayout, QGroupBox,
    QHBoxLayout, QHeaderView, QLabel, QLineEdit, QListWidget, QListWidgetItem,
    QMessageBox, QRadioButton, QSplitter, QTableWidget, QVBoxLayout, QWidget,
)

from ... import config
from ...core import invoice as inv
from ...core import invoice_pdf, persian as fa
from ...core.costing import CostingEngine
from ...core.exporters import attach_units, export_invoice_xlsx
from ...data.dao import InvoiceRepo, MaterialRepo, ProjectRepo
from ..widgets import (Banner, Card, DictCombo, make_button, make_table,
                       selected_row, set_row, cell_text, ask_confirm)


class InvoicePage(QWidget):
    def __init__(self, ctx, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.db = ctx.db
        self.prepo = ProjectRepo(self.db)
        self.irepo = InvoiceRepo(self.db)
        self.result = None
        self.project_id: Optional[int] = None
        self.data: Optional[Dict[str, Any]] = None
        self.hidden_keys: set = set()

        outer = QVBoxLayout(self)
        outer.setContentsMargins(18, 16, 18, 12)
        outer.setSpacing(10)

        head = QHBoxLayout()
        t = QLabel("فاکتور و پیش‌فاکتور")
        t.setObjectName("PageTitle")
        head.addWidget(t)
        sub = QLabel("فیلتر ردیف‌ها، چاپ و خروجی PDF حرفه‌ای")
        sub.setObjectName("PageSubtitle")
        head.addWidget(sub)
        head.addStretch(1)
        outer.addLayout(head)

        # ---------------- نوار انتخاب پروژه ----------------
        sel = QGroupBox("پروژه و نوع سند")
        sg = QGridLayout(sel)
        sg.setSpacing(8)
        sg.addWidget(QLabel("پروژه:"), 0, 0)
        self.proj_combo = QComboBox()
        self.proj_combo.currentIndexChanged.connect(self._on_project)
        sg.addWidget(self.proj_combo, 0, 1, 1, 3)
        sg.addWidget(QLabel("نوع سند:"), 0, 4)
        self.kind = DictCombo({"quote": "پیش‌فاکتور", "invoice": "فاکتور فروش"},
                              selected="quote")
        sg.addWidget(self.kind, 0, 5)
        sg.addWidget(QLabel("شماره:"), 1, 0)
        self.number = QLineEdit()
        sg.addWidget(self.number, 1, 1)
        sg.addWidget(QLabel("سطح نمایش:"), 1, 2)
        self.mode = DictCombo({"grouped": "گروه‌بندی‌شده (تمیز برای مشتری)",
                               "detailed": "ریز اقلام (شفاف برای کارگاه)",
                               "summary": "خلاصه‌ی کل"}, selected="grouped")
        sg.addWidget(self.mode, 1, 3, 1, 3)
        outer.addWidget(sel)

        splitter = QSplitter(Qt.Horizontal, self)

        # ---------------- فیلترها ----------------
        left = Card("فیلتر ردیف‌های فاکتور", "گروه‌ها و ردیف‌هایی که نمی‌خواهید نمایش دهید")
        lv = left.layout_
        self.opts = QVBoxLayout()
        self.chk_cost = QCheckBox("نمایش ستون هزینه‌ی تمام‌شده (فقط نسخه‌ی داخلی)")
        self.chk_stats = QCheckBox("نمایش جدول آمار فنی (متراژ، ورق، نوار)")
        self.chk_stats.setChecked(True)
        self.chk_zero = QCheckBox("حذف ردیف‌های با مبلغ صفر")
        self.chk_zero.setChecked(True)
        for w in (self.chk_cost, self.chk_stats, self.chk_zero):
            self.opts.addWidget(w)
        lv.addLayout(self.opts)
        lv.addWidget(QLabel("گروه‌های هزینه:"))
        self.groups_list = QListWidget()
        lv.addWidget(self.groups_list, 1)
        lbar = QHBoxLayout()
        self.groups_list.itemChanged.connect(self._on_group_toggle)
        lbar.addWidget(make_button("همه روشن", "Ghost", on_click=lambda: self._set_groups(True)))
        lbar.addWidget(make_button("همه خاموش", "Ghost", on_click=lambda: self._set_groups(False)))
        lv.addLayout(lbar)
        splitter.addWidget(left)

        # ---------------- جدول ردیف‌ها ----------------
        right = QWidget()
        rv = QVBoxLayout(right)
        rv.setContentsMargins(0, 0, 0, 0)
        rv.setSpacing(10)
        self.items_table = make_table(["نمایش", "گروه", "شرح", "تعداد", "واحد", "فی", "مبلغ کل"],
                                      widths=[48, 130, 300, 70, 70, 120, 140])
        self.items_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        self.items_table.itemChanged.connect(self._on_item_toggle)
        rv.addWidget(self.items_table, 1)

        self.totals_lbl = QLabel("")
        self.totals_lbl.setObjectName("TotalBar")
        self.totals_lbl.setStyleSheet("padding: 10px 14px;")
        self.totals_lbl.setWordWrap(True)
        rv.addWidget(self.totals_lbl)

        bar = QHBoxLayout()
        bar.addWidget(make_button("به‌روزرسانی فاکتور", "Primary", "🔄", on_click=self.rebuild))
        bar.addWidget(make_button("پیش‌نمایش و چاپ", "", "🖨", on_click=self.preview_print))
        bar.addWidget(make_button("خروجی PDF", "Success", "▣", on_click=self.export_pdf))
        bar.addWidget(make_button("خروجی اکسل", "Ghost", "📊", on_click=self.export_excel))
        bar.addWidget(make_button("ذخیره در بایگانی", "Ghost", "💾", on_click=self.save_invoice))
        bar.addStretch(1)
        rv.addLayout(bar)
        splitter.addWidget(right)
        splitter.setStretchFactor(0, 1)
        splitter.setStretchFactor(1, 3)
        splitter.setSizes([280, 800])
        outer.addWidget(splitter, 1)

        # ---------------- بایگانی ----------------
        arch = Card("بایگانی فاکتورهای صادرشده", "")
        self.arch_table = make_table(["شماره", "نوع", "مشتری", "مبلغ", "تاریخ", ""],
                                     widths=[140, 100, 200, 150, 130, 40])
        arch.add_widget(self.arch_table)
        abar = QHBoxLayout()
        abar.addWidget(make_button("بازکردن PDF", "Ghost", "▣", on_click=self._open_archived))
        abar.addWidget(make_button("حذف از بایگانی", "Ghost", "🗑", on_click=self._del_archived))
        abar.addStretch(1)
        arch.add_layout(abar)
        outer.addWidget(arch)

    # ==================================================================
    def refresh(self) -> None:
        self.proj_combo.blockSignals(True)
        self.proj_combo.clear()
        for p in self.prepo.all():
            label = f"{p.get('code', '')} — {p.get('customer_name') or p.get('title') or '—'}"
            self.proj_combo.addItem(label, p["id"])
        self.proj_combo.blockSignals(False)
        if self.project_id:
            i = self.proj_combo.findData(self.project_id)
            if i >= 0:
                self.proj_combo.setCurrentIndex(i)
        if self.proj_combo.currentIndex() < 0 and self.proj_combo.count():
            self.proj_combo.setCurrentIndex(0)
        if self.proj_combo.count():
            self._on_project()
        self._refresh_archive()

    def set_project(self, pid: int, result=None) -> None:
        self.project_id = pid
        if result is not None:
            self.result = result
        i = self.proj_combo.findData(pid)
        if i >= 0:
            self.proj_combo.setCurrentIndex(i)
        self.rebuild()

    def _on_project(self) -> None:
        pid = self.proj_combo.currentData()
        if not pid:
            return
        self.project_id = int(pid)
        self.result = None
        self.rebuild()

    # ------------------------------------------------------------------
    def _calc(self):
        pages = self.prepo.load_pages(self.project_id)
        p = self.prepo.get(self.project_id) or {}
        repo = MaterialRepo(self.db)
        engine = CostingEngine(repo.all(active_only=False), self.db.all_settings())
        result = engine.calc_project(
            pages,
            install_mode=p.get("install_mode", "fixed"),
            install_value=float(p.get("install_value") or 0),
            profit_mode=p.get("profit_mode", "markup"),
            profit_percent=float(p.get("profit_percent") or 0),
            discount_percent=float(p.get("discount_percent") or 0),
            discount_amount=float(p.get("discount_amount") or 0),
            vat_enabled=bool(p.get("vat_enabled")),
            vat_percent=float(p.get("vat_percent") or 10),
            extra_fixed_amount=float(p.get("extra_fixed_amount") or 0),
        )
        attach_units(result, pages)
        return result

    def rebuild(self) -> None:
        if not self.project_id:
            return
        if self.result is None:
            self.result = self._calc()
        p = self.prepo.get(self.project_id) or {}
        if not self.number.text().strip():
            self.number.setText(self.irepo.next_number(self.kind.key()))
        project = dict(p)
        project["show_cost"] = self.chk_cost.isChecked()
        project["show_stats"] = self.chk_stats.isChecked()
        hidden = list(self.hidden_keys)
        data = inv.build_invoice_data(self.result, project, self.db.all_settings(),
                                      mode=self.mode.key(), hidden=hidden,
                                      invoice_number=self.number.text().strip(),
                                      kind=self.kind.key())
        if self.chk_zero.isChecked():
            data["items"] = [it for it in data["items"] if abs(it["amount"]) > 0.001]
        self.data = data
        self._fill_table(data)
        self._fill_totals(data)

    def _on_group_toggle(self, item) -> None:
        key = item.data(Qt.UserRole)
        if item.checkState() == Qt.Checked:
            self.hidden_keys.discard(key)
        else:
            self.hidden_keys.add(key)
        self.rebuild()

    def _set_groups(self, on: bool) -> None:
        for i in range(self.groups_list.count()):
            key = self.groups_list.item(i).data(Qt.UserRole)
            self.groups_list.item(i).setCheckState(Qt.Checked if on else Qt.Unchecked)
            if on:
                self.hidden_keys.discard(key)
            else:
                self.hidden_keys.add(key)
        self.rebuild()

    def _fill_table(self, data: Dict[str, Any]) -> None:
        t = self.items_table
        t.blockSignals(True)
        t.setRowCount(0)
        # بازسازی فهرست گروه‌ها (همگام با مجموعه‌ی ردیف‌های پنهان)
        groups = inv.group_titles(data) or list(dict.fromkeys(
            [it.group for it in self.result.items]))
        self.groups_list.blockSignals(True)
        self.groups_list.clear()
        for g in dict.fromkeys(groups):
            it = QListWidgetItem(g)
            it.setFlags(it.flags() | Qt.ItemIsUserCheckable)
            it.setCheckState(Qt.Unchecked if g in self.hidden_keys else Qt.Checked)
            it.setData(Qt.UserRole, g)
            self.groups_list.addItem(it)
        self.groups_list.blockSignals(False)
        cur = self.db.get_setting("currency", "ریال")
        scale = self.db.get_num("currency_scale", 1)
        for row in data["items"]:
            r = t.rowCount()
            t.insertRow(r)
            chk = QCheckBox()
            chk.setChecked(row["key"] not in self.hidden_keys)
            chk.setProperty("k", row["key"])
            set_row(t, r, [chk, row["group"], row["title"] +
                           (f" — {row['detail']}" if row.get("detail") else ""),
                           fa.fmt_number(row["qty"], 2), row.get("unit", ""),
                           fa.fmt_number(row["unit_price"] / scale),
                           fa.fmt_number(row["amount"] / scale)],
                    align_center=[0, 3, 4, 5, 6])
        t.blockSignals(False)

    def _on_item_toggle(self, item) -> None:
        if item.column() != 0:
            return
        widget = self.items_table.cellWidget(item.row(), 0)
        if not widget:
            return
        key = widget.property("k")
        if widget.isChecked():
            self.hidden_keys.discard(key)
        else:
            self.hidden_keys.add(key)
        for i in range(self.groups_list.count()):
            if self.groups_list.item(i).data(Qt.UserRole) == key:
                self.groups_list.item(i).setCheckState(
                    Qt.Checked if widget.isChecked() else Qt.Unchecked)
        self.rebuild()

    def _fill_totals(self, data: Dict[str, Any]) -> None:
        tt = data["totals"]
        cur = data.get("currency", "ریال")
        scale = float(data.get("scale", 1) or 1)
        self.totals_lbl.setText(
            f"جمع هزینه: <b>{fa.fmt_money(tt['total_cost'], cur, scale)}</b>   •   "
            f"سود: <b>{fa.fmt_money(tt['profit_amount'], cur, scale)}</b>   •   "
            f"تخفیف: <b>{fa.fmt_money(tt['discount_amount'], cur, scale)}</b>   •   "
            f"مالیات: <b>{fa.fmt_money(tt['vat_amount'], cur, scale)}</b>   •   "
            f"قابل پرداخت: <b style='font-size:15px'>{fa.fmt_money(tt['final_price'], cur, scale)}</b>")

    # ------------------------------------------------------------------
    def preview_print(self) -> None:
        if not self.data:
            self.rebuild()
        if not self.data:
            return
        path = inv.temp_html(self.data)
        QDesktopServices.openUrl(QUrl.fromLocalFile(path))
        self.ctx.status("پیش‌نمایش در مرورگر باز شد؛ با Ctrl+P چاپ کنید.")

    def export_pdf(self) -> Optional[Path]:
        if not self.data:
            self.rebuild()
        if not self.data:
            return None
        try:
            path = invoice_pdf.default_pdf_path(self.data)
            invoice_pdf.build_pdf(self.data, path)
        except Exception as exc:
            QMessageBox.critical(self, "خطا در ساخت PDF", str(exc))
            return None
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(path)))
        self.ctx.status(f"PDF ذخیره شد: {path}")
        return path

    def export_excel(self) -> None:
        if not self.data:
            self.rebuild()
        path, _ = QFileDialog.getSaveFileName(self, "خروجی اکسل فاکتور",
                                              f"invoice-{self.number.text()}.xlsx",
                                              "Excel (*.xlsx)")
        if not path:
            return
        try:
            export_invoice_xlsx(self.data, path)
            self.ctx.status(f"اکسل ذخیره شد: {path}")
        except Exception as exc:
            QMessageBox.critical(self, "خطا", str(exc))

    def save_invoice(self) -> None:
        if not self.data:
            self.rebuild()
        if not self.data:
            return
        iid = self.irepo.save(self.project_id, self.data["number"], self.data,
                              self.data["totals"]["final_price"], self.kind.key())
        self.ctx.db.log("invoice", f"صدور {self.data['number']}")
        self._refresh_archive()
        self.ctx.status(f"فاکتور {self.data['number']} در بایگانی ذخیره شد.")

    # ------------------------------------------------------------------
    def _refresh_archive(self) -> None:
        t = self.arch_table
        t.setRowCount(0)
        cur = self.db.get_setting("currency", "ریال")
        scale = self.db.get_num("currency_scale", 1)
        for row in self.irepo.all()[:40]:
            r = t.rowCount()
            t.insertRow(r)
            del_btn = make_button("🗑", "Icon", on_click=lambda _=False, iid=row["id"]: self._del_arch(iid))
            set_row(t, r, [row.get("number", ""), "پیش‌فاکتور" if row.get("kind") == "quote" else "فاکتور",
                           row.get("customer_name", ""), fa.fmt_money(row.get("total", 0), cur, scale),
                           fa.jdatetime_str(row["created_at"]) if row.get("created_at") else "", del_btn],
                    align_center=[1, 3, 4])
            t.item(r, 0).setData(Qt.UserRole, row["id"])

    def _del_arch(self, iid: int) -> None:
        if ask_confirm(self, "حذف از بایگانی", "این فاکتور از بایگانی حذف شود؟"):
            self.irepo.delete(iid)
            self._refresh_archive()

    def _del_archived(self) -> None:
        r = selected_row(self.arch_table)
        if r < 0:
            return
        it = self.arch_table.item(r, 0)
        if it:
            self._del_arch(it.data(Qt.UserRole))

    def _open_archived(self) -> None:
        r = selected_row(self.arch_table)
        if r < 0:
            return
        it = self.arch_table.item(r, 0)
        if not it:
            return
        row = self.irepo.get(it.data(Qt.UserRole))
        if not row:
            return
        data = row["data"]
        try:
            path = invoice_pdf.default_pdf_path(data)
            invoice_pdf.build_pdf(data, path)
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(path)))
        except Exception as exc:
            QMessageBox.critical(self, "خطا", str(exc))
