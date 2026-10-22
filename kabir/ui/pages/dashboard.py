# -*- coding: utf-8 -*-
"""صفحه‌ی داشبورد: آمار، نمودار و دسترسی سریع."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from PySide6.QtCore import Qt, QRectF, QSize
from PySide6.QtGui import QColor, QPainter, QPen
from PySide6.QtWidgets import (
    QFrame, QGridLayout, QHBoxLayout, QHeaderView, QLabel, QPushButton,
    QSizePolicy, QTableWidget, QVBoxLayout, QWidget,
)

from ...core import persian as fa
from ...data.dao import MaterialRepo, ProjectRepo
from ..widgets import Card, StatCard, make_button


class BarChart(QWidget):
    """نمودار میله‌ای ساده‌ی ترسیم‌شده با QPainter (بدون وابستگی خارجی)."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.values: List[float] = []
        self.labels: List[str] = []
        self.setMinimumHeight(190)
        self.accent = QColor("#0f766e")
        self.muted = QColor("#8b97a8")
        self.grid = QColor("#dde3ec")

    def set_data(self, labels: List[str], values: List[float]) -> None:
        self.labels = labels
        self.values = values
        self.update()

    def set_colors(self, accent: str, muted: str, grid: str) -> None:
        self.accent = QColor(accent)
        self.muted = QColor(muted)
        self.grid = QColor(grid)
        self.update()

    def paintEvent(self, event) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        w, h = self.width(), self.height()
        pad_l, pad_r, pad_t, pad_b = 14, 14, 18, 30
        cw = w - pad_l - pad_r
        ch = h - pad_t - pad_b
        if not self.values:
            p.setPen(self.muted)
            p.drawText(QRectF(0, 0, w, h), Qt.AlignCenter, "داده‌ای برای نمایش نیست")
            p.end()
            return
        vmax = max(self.values) or 1
        # خطوط راهنما
        pen = QPen(self.grid)
        pen.setStyle(Qt.DashLine)
        p.setPen(pen)
        for i in range(4):
            y = pad_t + ch * i / 3.0
            p.drawLine(int(pad_l), int(y), int(w - pad_r), int(y))
        n = len(self.values)
        slot = cw / n
        bw = min(58.0, slot * 0.55)
        for i, v in enumerate(self.values):
            bh = ch * (v / vmax) if vmax else 0
            x = pad_l + slot * i + (slot - bw) / 2
            y = pad_t + ch - bh
            p.setPen(Qt.NoPen)
            p.setBrush(self.accent if i == n - 1 else self.accent.lighter(140))
            p.drawRoundedRect(QRectF(x, y, bw, max(2.0, bh)), 5, 5)
            # برچسب مقدار
            p.setPen(self.muted)
            txt = fa.fmt_number(v / 1_000_000, 1) + " م"
            p.drawText(QRectF(x - 10, y - 16, bw + 20, 14), Qt.AlignCenter, txt)
            # برچسب محور
            lbl = self.labels[i] if i < len(self.labels) else ""
            p.drawText(QRectF(pad_l + slot * i, pad_t + ch + 6, slot, 20),
                       Qt.AlignCenter, lbl)
        p.end()

    def sizeHint(self) -> QSize:
        return QSize(420, 200)


class DashboardPage(QWidget):
    def __init__(self, app_ctx, parent=None):
        super().__init__(parent)
        self.ctx = app_ctx
        outer = QVBoxLayout(self)
        outer.setContentsMargins(18, 16, 18, 16)
        outer.setSpacing(14)

        # --- سربرگ ---
        head = QHBoxLayout()
        t = QLabel("داشبورد")
        t.setObjectName("PageTitle")
        head.addWidget(t)
        sub = QLabel("نمای کلی کسب‌وکار کابینت شما")
        sub.setObjectName("PageSubtitle")
        head.addWidget(sub)
        head.addStretch(1)
        self.btn_new_project = make_button("پروژه‌ی جدید", "Primary", "＋",
                                           on_click=lambda: self.ctx.open_new_project())
        head.addWidget(self.btn_new_project)
        self.btn_new_invoice = make_button("صدور فاکتور", "", "🧾",
                                           on_click=lambda: self.ctx.goto("invoice"))
        head.addWidget(self.btn_new_invoice)
        outer.addLayout(head)

        # --- کارت‌های آماری ---
        stats = QGridLayout()
        stats.setSpacing(12)
        self.st_projects = StatCard("پروژه‌های ثبت‌شده", "۰", "", "🗂")
        self.st_revenue = StatCard("جمع قیمت فروش", "۰", "", "💰")
        self.st_profit = StatCard("سود تقریبی", "۰", "", "📈")
        self.st_materials = StatCard("اقلام متریال", "۰", "", "▤")
        for i, w in enumerate((self.st_projects, self.st_revenue, self.st_profit, self.st_materials)):
            stats.addWidget(w, 0, i)
        outer.addLayout(stats)

        mid = QHBoxLayout()
        mid.setSpacing(12)

        # --- نمودار ---
        chart_card = Card("فروش ماه‌های اخیر", "مجموع قیمت فروش پروژه‌ها به میلیون")
        self.chart = BarChart()
        chart_card.add_widget(self.chart)
        mid.addWidget(chart_card, 3)

        # --- آخرین پروژه‌ها ---
        recent = Card("آخرین پروژه‌ها", "")
        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["کد", "مشتری / عنوان", "وضعیت", "قیمت نهایی"])
        self.table.verticalHeader().setVisible(False)
        self.table.setAlternatingRowColors(True)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.table.setColumnWidth(0, 130)
        self.table.setColumnWidth(2, 80)
        self.table.setColumnWidth(3, 150)
        self.table.doubleClicked.connect(self._open_selected)
        recent.add_widget(self.table)
        mid.addWidget(recent, 4)
        outer.addLayout(mid, 1)

        # --- پایین: تغییرات قیمت و پشتیبان ---
        bottom = QHBoxLayout()
        bottom.setSpacing(12)
        hist = Card("آخرین تغییرات قیمت متریال", "")
        self.hist_table = QTableWidget(0, 4)
        self.hist_table.setHorizontalHeaderLabels(["متریال", "قیمت قبل", "قیمت جدید", "تغییر"])
        self.hist_table.verticalHeader().setVisible(False)
        self.hist_table.setAlternatingRowColors(True)
        self.hist_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.hist_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        hist.add_widget(self.hist_table)
        bottom.addWidget(hist, 3)

        tips = Card("راهنمای سریع", "")
        tips_text = QLabel(
            "۱) ابتدا در صفحه‌ی «متریال و خدمات» قیمت‌های روز را وارد کنید.\n"
            "۲) در «سبک‌ها» ترکیب متریال پرکاربرد خود را ذخیره کنید (تا ۲۰ سبک).\n"
            "۳) در «پروژه‌ها» ابعاد یونیت‌ها را وارد کنید؛ هزینه دقیق خودکار محاسبه می‌شود.\n"
            "۴) درصد سود (مارکاپ/مارجین)، نصب و تخفیف را تنظیم کنید.\n"
            "۵) در «فاکتور» ردیف‌های دلخواه را فیلتر و PDF/چاپ بگیرید.")
        tips_text.setWordWrap(True)
        tips_text.setObjectName("Muted")
        tips_text.setStyleSheet("line-height: 1.9;")
        tips.add_widget(tips_text)
        self.backup_lbl = QLabel("")
        self.backup_lbl.setObjectName("Tiny")
        tips.add_widget(self.backup_lbl)
        bottom.addWidget(tips, 2)
        outer.addLayout(bottom, 1)

    # ------------------------------------------------------------------
    def refresh(self) -> None:
        db = self.ctx.db
        prepo = ProjectRepo(db)
        mrepo = MaterialRepo(db)
        st = prepo.stats()
        cur = db.get_setting("currency", "ریال")
        scale = db.get_num("currency_scale", 1)
        self.st_projects.set_value(fa.fmt_number(st["projects"]),
                                   f"{fa.fmt_number(st['done'])} انجام‌شده / {fa.fmt_number(st['draft'])} در جریان")
        self.st_revenue.set_value(fa.fmt_money(st["sum_price"], cur, scale),
                                  f"در {fa.fmt_number(st['projects'])} پروژه")
        self.st_profit.set_value(fa.fmt_money(st["sum_profit"], cur, scale),
                                  "اختلاف قیمت فروش و هزینه‌ی ثبت‌شده")
        self.st_materials.set_value(fa.fmt_number(st["materials"]),
                                    f"{fa.fmt_number(st['styles'])} سبک آماده • {fa.fmt_number(st['invoices'])} فاکتور")

        monthly = prepo.monthly(6)
        labels, values = [], []
        for row in monthly:
            ym = row["ym"]
            try:
                y, m = ym.split("-")
                gy, gm, gd = int(y), int(m), 15
                jy, jm, jd = fa.gregorian_to_jalali(gy, gm, gd)
                labels.append(fa.jalali_month_name(jm))
            except Exception:
                labels.append(ym)
            values.append(float(row["total"]))
        self.chart.set_data(labels, values)
        pal = self.ctx.palette()
        self.chart.set_colors(pal["accent"], pal["text3"], pal["grid"])

        rows = prepo.all()[:8]
        self.table.setRowCount(0)
        status_lbl = {"draft": "در جریان", "done": "انجام‌شده", "canceled": "لغوشده"}
        for p in rows:
            r = self.table.rowCount()
            self.table.insertRow(r)
            title = p.get("customer_name") or p.get("title") or "—"
            if p.get("title") and p.get("customer_name"):
                title = f"{p['customer_name']} — {p['title']}"
            from PySide6.QtWidgets import QTableWidgetItem
            it_price = QTableWidgetItem(fa.fmt_money(p.get("final_price", 0), cur, scale))
            it_price.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
            self.table.setItem(r, 0, QTableWidgetItem(p.get("code", "")))
            self.table.setItem(r, 1, QTableWidgetItem(title))
            self.table.setItem(r, 2, QTableWidgetItem(status_lbl.get(p.get("status", ""), p.get("status", ""))))
            self.table.setItem(r, 3, it_price)
            self.table.item(r, 0).setData(Qt.UserRole, p["id"])

        hist = mrepo.history(limit=8)
        self.hist_table.setRowCount(0)
        for hrow in hist:
            r = self.hist_table.rowCount()
            self.hist_table.insertRow(r)
            pct = float(hrow.get("change_pct") or 0)
            sign = "+" if pct > 0 else ""
            from PySide6.QtWidgets import QTableWidgetItem
            it = QTableWidgetItem(f"{sign}{fa.fmt_number(pct, 1)}٪")
            it.setForeground(QColor("#16a34a") if pct > 0 else QColor("#dc2626"))
            self.hist_table.setItem(r, 0, QTableWidgetItem(hrow.get("material_name", "")))
            self.hist_table.setItem(r, 1, QTableWidgetItem(fa.fmt_number(hrow.get("old_price", 0))))
            self.hist_table.setItem(r, 2, QTableWidgetItem(fa.fmt_number(hrow.get("new_price", 0))))
            self.hist_table.setItem(r, 3, it)

        from ...data import backup as bk
        backups = bk.list_backups()
        if backups:
            last = backups[0]
            self.backup_lbl.setText(f"آخرین پشتیبان: {last['name']} — "
                                    f"{fa.jdatetime_str(last['mtime'])}")
        else:
            self.backup_lbl.setText("هنوز پشتیبانی ساخته نشده است.")

    def _open_selected(self) -> None:
        r = self.table.currentRow()
        if r < 0:
            return
        it = self.table.item(r, 0)
        pid = it.data(Qt.UserRole) if it else None
        if pid:
            self.ctx.open_project(int(pid))
