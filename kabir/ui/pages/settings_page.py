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
"""صفحه‌ی تنظیمات: شرکت، مالی، محاسبات، ظاهر، فونت و پشتیبان‌گیری."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from PySide6.QtCore import Qt, QThread, Signal
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDialog, QFileDialog, QGridLayout, QGroupBox,
    QHBoxLayout, QLabel, QLineEdit, QListWidget, QListWidgetItem, QMessageBox,
    QProgressBar, QPushButton, QTabWidget, QTextEdit, QVBoxLayout, QWidget,
)

from ... import config
from ...core import fonts as fonts_mod
from ...core import persian as fa
from ...data import backup as bk
from ...data.dao import MaterialRepo
from ..widgets import (Banner, Card, DictCombo, FaDoubleSpinBox, FaSpinBox,
                       make_button, make_table, set_row, selected_row, ask_confirm)


class FontDownloadThread(QThread):
    done = Signal(bool, str)

    def run(self) -> None:
        try:
            ok, msg = fonts_mod.download_fonts()
            self.done.emit(ok, msg)
        except Exception as exc:               # noqa: BLE001
            self.done.emit(False, str(exc))


class SettingsPage(QWidget):
    def __init__(self, ctx, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.db = ctx.db
        outer = QVBoxLayout(self)
        outer.setContentsMargins(18, 16, 18, 12)
        outer.setSpacing(10)
        head = QHBoxLayout()
        t = QLabel("تنظیمات")
        t.setObjectName("PageTitle")
        head.addWidget(t)
        sub = QLabel("شخصی‌سازی کامل نرم‌افزار")
        sub.setObjectName("PageSubtitle")
        head.addWidget(sub)
        head.addStretch(1)
        head.addWidget(make_button("ذخیره‌ی تنظیمات", "Primary", "💾", on_click=self.save))
        outer.addLayout(head)

        self.tabs = QTabWidget()
        outer.addWidget(self.tabs, 1)

        # ================= تب شرکت =================
        w1 = QWidget()
        g1 = QGridLayout(w1)
        g1.setSpacing(8)
        self.c_name = QLineEdit()
        self.c_manager = QLineEdit()
        self.c_phone = QLineEdit()
        self.c_mobile = QLineEdit()
        self.c_email = QLineEdit()
        self.c_web = QLineEdit()
        self.c_address = QLineEdit()
        self.c_logo = QLineEdit()
        self.c_logo.setPlaceholderText("مسیر فایل لوگو (PNG/JPG)")
        self.c_title = QLineEdit()
        self.c_footer = QTextEdit()
        self.c_footer.setMaximumHeight(80)
        rows = [("نام کسب‌وکار:", self.c_name), ("نام مدیر:", self.c_manager),
                ("تلفن ثابت:", self.c_phone), ("تلفن همراه:", self.c_mobile),
                ("ایمیل:", self.c_email), ("وب‌سایت:", self.c_web),
                ("نشانی:", self.c_address)]
        for i, (lbl, w) in enumerate(rows):
            g1.addWidget(QLabel(lbl), i, 0)
            g1.addWidget(w, i, 1, 1, 3)
        g1.addWidget(QLabel("لوگو:"), len(rows), 0)
        g1.addWidget(self.c_logo, len(rows), 1, 1, 2)
        logo_btn = make_button("انتخاب تصویر…", "Ghost", on_click=self._pick_logo)
        g1.addWidget(logo_btn, len(rows), 3)
        g1.addWidget(QLabel("عنوان سند:"), len(rows) + 1, 0)
        g1.addWidget(self.c_title, len(rows) + 1, 1, 1, 3)
        g1.addWidget(QLabel("پانویس فاکتور:"), len(rows) + 2, 0)
        g1.addWidget(self.c_footer, len(rows) + 2, 1, 1, 3)
        self.tabs.addTab(w1, "مشخصات کسب‌وکار")

        # ================= تب مالی =================
        w2 = QWidget()
        g2 = QGridLayout(w2)
        g2.setSpacing(8)
        self.currency = DictCombo({"ریال": "ریال", "تومان": "تومان", "هزار ریال": "هزار ریال"},
                                  selected="ریال")
        self.scale = DictCombo({"1": "نمایش عادی (ریال)", "10": "تقسیم بر ۱۰ (تومان)",
                                "1000": "تقسیم بر ۱۰۰ (هزار ریال)"}, selected="1")
        self.vat_chk = QCheckBox("مالیات بر ارزش افزوده به‌صورت پیش‌فرض فعال باشد")
        self.vat_pct = FaDoubleSpinBox(decimals=2, maximum=100, suffix=" ٪")
        self.waste = FaDoubleSpinBox(decimals=1, maximum=60, suffix=" ٪")
        self.overhead = FaDoubleSpinBox(decimals=1, maximum=60, suffix=" ٪")
        self.profit_mode = DictCombo({"markup": "مارکاپ (درصدی از هزینه)",
                                      "margin": "مارجین (درصدی از فروش)"})
        self.profit_pct = FaDoubleSpinBox(decimals=2, maximum=500, suffix=" ٪")
        self.install_mode = DictCombo({"fixed": "نصب: مبلغ ثابت",
                                       "per_meter": "نصب: هر متر طول زمینی",
                                       "percent": "نصب: درصدی از هزینه"})
        self.install_val = FaDoubleSpinBox(decimals=0, maximum=1e12, step=10000)
        items2 = [("واحد پول:", self.currency), ("مقیاس نمایش:", self.scale),
                  ("درصد مالیات:", self.vat_pct), ("پرت پیش‌فرض ورق:", self.waste),
                  ("سربار پیش‌فرض:", self.overhead), ("روش سود پیش‌فرض:", self.profit_mode),
                  ("درصد سود پیش‌فرض:", self.profit_pct), ("حالت نصب پیش‌فرض:", self.install_mode),
                  ("مقدار نصب پیش‌فرض:", self.install_val)]
        for i, (lbl, w) in enumerate(items2):
            g2.addWidget(QLabel(lbl), i, 0)
            g2.addWidget(w, i, 1)
        g2.addWidget(self.vat_chk, len(items2), 0, 1, 2)
        g2.setColumnStretch(2, 1)
        hint = QLabel("مارکاپ: سود = هزینه × درصد  |  مارجین: سود به‌گونه‌ای که درصد آن از "
                      "قیمت فروش نهایی باشد (فروش = هزینه ÷ (۱ − درصد))")
        hint.setObjectName("Tiny")
        hint.setWordWrap(True)
        g2.addWidget(hint, len(items2) + 1, 0, 1, 3)
        self.tabs.addTab(w2, "مالی و سود")

        # ================= تب محاسبات =================
        w3 = QWidget()
        g3 = QGridLayout(w3)
        g3.setSpacing(8)
        self.sheet_w = FaDoubleSpinBox(decimals=0, maximum=500, suffix=" سانتی‌متر")
        self.sheet_h = FaDoubleSpinBox(decimals=0, maximum=500, suffix=" سانتی‌متر")
        self.fiber_w = FaDoubleSpinBox(decimals=0, maximum=500, suffix=" سانتی‌متر")
        self.fiber_h = FaDoubleSpinBox(decimals=0, maximum=500, suffix=" سانتی‌متر")
        self.bb = FaDoubleSpinBox(decimals=2, maximum=10, step=0.1)
        self.bd = FaDoubleSpinBox(decimals=2, maximum=10, step=0.1)
        self.bwaste = FaDoubleSpinBox(decimals=1, maximum=50, suffix=" ٪")
        items3 = [("عرض ورق استاندارد:", self.sheet_w), ("ارتفاع ورق استاندارد:", self.sheet_h),
                  ("عرض ورق فیبر:", self.fiber_w), ("ارتفاع ورق فیبر:", self.fiber_h),
                  ("ضریب نوار بدنه (متر بر م²):", self.bb),
                  ("ضریب نوار در (برابر محیط):", self.bd),
                  ("پرت نوار:", self.bwaste)]
        for i, (lbl, w) in enumerate(items3):
            g3.addWidget(QLabel(lbl), i, 0)
            g3.addWidget(w, i, 1)
        g3.setColumnStretch(2, 1)
        note3 = QLabel("ضریب نوار بدنه یعنی به‌ازای هر مترمربع قطعه‌ی برش‌خورده، چند متر نوار "
                       "PVC مصرف می‌شود (پیش‌فرض صنعتی: ۲٫۲).")
        note3.setObjectName("Tiny")
        note3.setWordWrap(True)
        g3.addWidget(note3, len(items3), 0, 1, 3)
        self.tabs.addTab(w3, "ضرایب محاسبات")

        # ================= تب ظاهر =================
        w4 = QWidget()
        g4 = QGridLayout(w4)
        g4.setSpacing(8)
        self.theme = DictCombo({"light": "روشن", "dark": "تاریک"}, selected="light")
        self.font_size = FaSpinBox(minimum=9, maximum=20, suffix=" pt")
        self.fa_digits = QCheckBox("نمایش اعداد به‌صورت فارسی (۱۲۳)")
        self.fa_digits.setChecked(True)
        items4 = [("پوسته:", self.theme), ("اندازه‌ی قلم:", self.font_size)]
        for i, (lbl, w) in enumerate(items4):
            g4.addWidget(QLabel(lbl), i, 0)
            g4.addWidget(w, i, 1)
        g4.addWidget(self.fa_digits, 2, 0, 1, 2)
        g4.setColumnStretch(2, 1)
        self.tabs.addTab(w4, "ظاهر")

        # ================= تب فونت =================
        w5 = QWidget()
        v5 = QVBoxLayout(w5)
        self.font_banner = Banner("info", "")
        v5.addWidget(self.font_banner)
        fbar = QHBoxLayout()
        fbar.addWidget(make_button("دانلود مجدد فونت وزیرمتن", "Primary", "⬇",
                                   on_click=self.download_font))
        fbar.addWidget(make_button("نصب فونت در سیستم‌عامل", "", "🅵",
                                   on_click=self.install_font))
        fbar.addStretch(1)
        v5.addLayout(fbar)
        self.font_progress = QProgressBar()
        self.font_progress.setVisible(False)
        v5.addWidget(self.font_progress)
        info = QLabel("فونت وزیرمتن همراه برنامه است و به‌صورت خودکار ثبت می‌شود. با نصب آن در "
                      "سیستم‌عامل، سایر برنامه‌ها (مثل LibreOffice و چاپگرها) نیز فارسی زیبا "
                      "نمایش می‌دهند. مسیر نصب:")
        info.setObjectName("Muted")
        info.setWordWrap(True)
        v5.addWidget(info)
        path_lbl = QLabel(str(config.user_font_dir()))
        path_lbl.setTextInteractionFlags(Qt.TextSelectableByMouse)
        path_lbl.setObjectName("Tiny")
        v5.addWidget(path_lbl)
        v5.addStretch(1)
        self.tabs.addTab(w5, "فونت فارسی")

        # ================= تب پشتیبان =================
        w6 = QWidget()
        v6 = QVBoxLayout(w6)
        bbar = QHBoxLayout()
        bbar.addWidget(make_button("پشتیبان‌گیری همین حالا", "Primary", "🛡",
                                   on_click=self.backup_now))
        bbar.addWidget(make_button("بازیابی از نسخه…", "", "⟲", on_click=self.restore_now))
        bbar.addWidget(make_button("خروجی JSON (انتقال به سیستم دیگر)", "Ghost", "⇩",
                                   on_click=self.export_json))
        bbar.addWidget(make_button("ورود JSON…", "Ghost", "⇧", on_click=self.import_json))
        bbar.addStretch(1)
        v6.addLayout(bbar)
        opt = QHBoxLayout()
        self.auto_backup = QCheckBox("پشتیبان‌گیری خودکار روزانه")
        self.auto_backup.setChecked(True)
        opt.addWidget(self.auto_backup)
        opt.addWidget(QLabel("تعداد نسخه‌های نگه‌داشتنی:"))
        self.keep = FaSpinBox(minimum=1, maximum=365)
        self.keep.setValue(30)
        opt.addWidget(self.keep)
        opt.addStretch(1)
        v6.addLayout(opt)
        self.backup_table = make_table(["نام فایل", "حجم", "تاریخ", ""],
                                       widths=[320, 100, 150, 40])
        v6.addWidget(self.backup_table, 1)
        db_lbl = QLabel("")
        db_lbl.setObjectName("Tiny")
        db_lbl.setText(f"مسیر پایگاه‌داده: {self.db.path}")
        db_lbl.setTextInteractionFlags(Qt.TextSelectableByMouse)
        v6.addWidget(db_lbl)
        self.tabs.addTab(w6, "پشتیبان و داده")

        # ================= تب درباره =================
        w7 = QWidget()
        v7 = QVBoxLayout(w7)
        about = QLabel(
            f"<h2 style='color:#0f766e'>کبیر — نسخه {config.APP_VERSION}</h2>"
            "نرم‌افزار محاسبه‌ی قیمت تمام‌شده و صدور پیش‌فاکتور صنعت کابینت<br><br>"
            "• محاسبه‌ی دقیق مساحت ورق، تعداد ورق مصرفی، متراژ نوار PVC و ریز هزینه‌ها<br>"
            "• پشتیبانی پروژه‌های ترکیبی (چند سبک در یک پروژه)<br>"
            "• سود به دو روش استاندارد مارکاپ و مارجین<br>"
            "• خروجی PDF/چاپ/اکسل با فونت فارسی وزیرمتن<br>"
            "• چندسکویی: ویندوز، لینوکس و مک<br><br>"
            "داده‌های شما فقط روی سیستم خودتان (پایگاه‌داده‌ی محلی) ذخیره می‌شود.")
        about.setWordWrap(True)
        about.setOpenExternalLinks(True)
        v7.addWidget(about)
        v7.addStretch(1)
        self.tabs.addTab(w7, "درباره")

        self.load()

    # ==================================================================
    def refresh(self) -> None:
        self.load()

    def load(self) -> None:
        g = self.db.get_setting
        self.c_name.setText(g("company_name"))
        self.c_manager.setText(g("company_manager"))
        self.c_phone.setText(g("company_phone"))
        self.c_mobile.setText(g("company_mobile"))
        self.c_email.setText(g("company_email"))
        self.c_web.setText(g("company_web"))
        self.c_address.setText(g("company_address"))
        self.c_logo.setText(g("company_logo"))
        self.c_title.setText(g("invoice_title"))
        self.c_footer.setPlainText(g("invoice_footer_note"))
        self.currency.set_key(g("currency", "ریال"))
        self.scale.set_key(g("currency_scale", "1"))
        self.vat_chk.setChecked(g("vat_enabled", "0") == "1")
        self.vat_pct.setValue(self.db.get_num("vat_percent", 10))
        self.waste.setValue(self.db.get_num("default_waste_percent", 10))
        self.overhead.setValue(self.db.get_num("default_overhead_percent", 0))
        self.profit_mode.set_key(g("default_profit_mode", "markup"))
        self.profit_pct.setValue(self.db.get_num("default_profit_percent", 30))
        self.install_mode.set_key(g("default_install_mode", "fixed"))
        self.install_val.setValue(self.db.get_num("default_install_value", 0))
        self.sheet_w.setValue(self.db.get_num("sheet_width_cm", 183))
        self.sheet_h.setValue(self.db.get_num("sheet_height_cm", 366))
        self.fiber_w.setValue(self.db.get_num("fiber_sheet_width_cm", 122))
        self.fiber_h.setValue(self.db.get_num("fiber_sheet_height_cm", 244))
        self.bb.setValue(self.db.get_num("banding_body_factor", 2.2))
        self.bd.setValue(self.db.get_num("banding_door_factor", 1.0))
        self.bwaste.setValue(self.db.get_num("banding_waste_percent", 8))
        self.theme.set_key(g("theme", "light"))
        self.font_size.setValue(int(self.db.get_num("font_size", 12)))
        self.fa_digits.setChecked(g("persian_digits", "1") == "1")
        self.auto_backup.setChecked(g("auto_backup", "1") == "1")
        self.keep.setValue(int(self.db.get_num("backup_keep", 30)))
        self._refresh_font_banner()
        self._refresh_backups()

    def save(self) -> None:
        m = {
            "company_name": self.c_name.text().strip(),
            "company_manager": self.c_manager.text().strip(),
            "company_phone": self.c_phone.text().strip(),
            "company_mobile": self.c_mobile.text().strip(),
            "company_email": self.c_email.text().strip(),
            "company_web": self.c_web.text().strip(),
            "company_address": self.c_address.text().strip(),
            "company_logo": self.c_logo.text().strip(),
            "invoice_title": self.c_title.text().strip() or "پیش‌فاکتور",
            "invoice_footer_note": self.c_footer.toPlainText().strip(),
            "currency": self.currency.key(),
            "currency_scale": self.scale.key(),
            "vat_enabled": "1" if self.vat_chk.isChecked() else "0",
            "vat_percent": str(self.vat_pct.value()),
            "default_waste_percent": str(self.waste.value()),
            "default_overhead_percent": str(self.overhead.value()),
            "default_profit_mode": self.profit_mode.key(),
            "default_profit_percent": str(self.profit_pct.value()),
            "default_install_mode": self.install_mode.key(),
            "default_install_value": str(self.install_val.value()),
            "sheet_width_cm": str(self.sheet_w.value()),
            "sheet_height_cm": str(self.sheet_h.value()),
            "fiber_sheet_width_cm": str(self.fiber_w.value()),
            "fiber_sheet_height_cm": str(self.fiber_h.value()),
            "banding_body_factor": str(self.bb.value()),
            "banding_door_factor": str(self.bd.value()),
            "banding_waste_percent": str(self.bwaste.value()),
            "theme": self.theme.key(),
            "font_size": str(self.font_size.value()),
            "persian_digits": "1" if self.fa_digits.isChecked() else "0",
            "auto_backup": "1" if self.auto_backup.isChecked() else "0",
            "backup_keep": str(self.keep.value()),
        }
        self.db.set_settings(m)
        self.ctx.apply_theme()
        self.ctx.status("تنظیمات ذخیره شد.")

    # ------------------------------------------------------------------
    def _pick_logo(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "انتخاب لوگو", "",
                                              "تصویر (*.png *.jpg *.jpeg *.svg)")
        if path:
            self.c_logo.setText(path)

    # ---------------- فونت ----------------
    def _refresh_font_banner(self) -> None:
        if fonts_mod.has_local_fonts():
            self.font_banner.label.setText("فونت وزیرمتن همراه برنامه موجود و ثبت‌شده است. ✔")
        else:
            self.font_banner.label.setText("فونت پیدا نشد؛ می‌توانید آن را دانلود کنید.")

    def download_font(self) -> None:
        self.font_progress.setVisible(True)
        self.font_progress.setRange(0, 0)
        self.th = FontDownloadThread()
        self.th.done.connect(self._font_done)
        self.th.start()

    def _font_done(self, ok: bool, msg: str) -> None:
        self.font_progress.setVisible(False)
        self._refresh_font_banner()
        QMessageBox.information(self, "فونت", msg + "\nبرای اعمال کامل، برنامه را دوباره اجرا کنید.")

    def install_font(self) -> None:
        n, dest = fonts_mod.install_to_user_font_dir()
        if n:
            QMessageBox.information(self, "نصب فونت",
                                    f"{fa.to_fa_digits(n)} فایل فونت در مسیر زیر نصب شد:\n{dest}")
        else:
            QMessageBox.warning(self, "نصب فونت", dest)

    # ---------------- پشتیبان ----------------
    def _refresh_backups(self) -> None:
        t = self.backup_table
        t.setRowCount(0)
        for b in bk.list_backups()[:30]:
            r = t.rowCount()
            t.insertRow(r)
            btn = make_button("🗑", "Icon", on_click=lambda _=False, p=b["path"]: self._del_backup(p))
            set_row(t, r, [b["name"], f"{fa.fmt_number(b['size'] / 1024, 1)} کیلوبایت",
                           fa.jdatetime_str(b["mtime"]), btn], align_center=[1, 2])
            t.item(r, 0).setData(Qt.UserRole, str(b["path"]))

    def backup_now(self) -> None:
        ok, msg = bk.create_backup(self.db, tag="manual")
        self._refresh_backups()
        (QMessageBox.information if ok else QMessageBox.critical)(self, "پشتیبان‌گیری", msg)

    def _del_backup(self, path: Path) -> None:
        if ask_confirm(self, "حذف پشتیبان", f"{Path(path).name} حذف شود؟"):
            Path(path).unlink(missing_ok=True)
            self._refresh_backups()

    def restore_now(self) -> None:
        r = selected_row(self.backup_table)
        if r < 0:
            QMessageBox.information(self, "بازیابی", "ابتدا یک نسخه را از فهرست انتخاب کنید.")
            return
        it = self.backup_table.item(r, 0)
        path = it.data(Qt.UserRole)
        if ask_confirm(self, "بازیابی", f"داده‌های فعلی با نسخه‌ی {Path(path).name} جایگزین شود؟",
                       ok_text="بازیابی"):
            ok, msg = bk.restore_backup(Path(path), self.db)
            QMessageBox.information(self, "بازیابی", msg + "\nبرنامه را دوباره اجرا کنید.")

    def export_json(self) -> None:
        path, _ = QFileDialog.getSaveFileName(self, "خروجی JSON", "kabir-data.json", "JSON (*.json)")
        if path:
            ok, msg = bk.export_json(Path(path), self.db)
            QMessageBox.information(self, "خروجی", msg)

    def import_json(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "ورود JSON", "", "JSON (*.json)")
        if not path:
            return
        replace = QMessageBox.question(
            self, "حالت ورود",
            "داده‌های فعلی جایگزین شوند؟\n(بله = جایگزینی کامل، خیر = فقط افزودن)")
        ok, msg = bk.import_json(Path(path), replace=replace == QMessageBox.Yes, db=self.db)
        QMessageBox.information(self, "ورود داده", msg)
        self.load()
