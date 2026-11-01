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
"""پنجره‌ی اصلی کبیر با نوار کناری راست‌به‌چپ."""

from __future__ import annotations

from typing import Any, Dict, Optional

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import (
    QButtonGroup, QApplication, QFrame, QHBoxLayout, QLabel, QMainWindow,
    QPushButton, QSizePolicy, QStackedWidget, QStatusBar, QVBoxLayout, QWidget,
)

from .. import config
from ..core import persian as fa
from ..data import backup as bk
from ..data.db import Database
from . import themes
from .pages.dashboard import DashboardPage
from .pages.invoice_page import InvoicePage
from .pages.materials import MaterialsPage
from .pages.projects import ProjectsPage
from .pages.settings_page import SettingsPage
from .pages.styles import StylesPage

NAV_ITEMS = [
    ("dashboard", "داشبورد", "▦"),
    ("projects", "پروژه‌ها", "🗂"),
    ("materials", "متریال و خدمات", "▤"),
    ("styles", "سبک‌ها", "✦"),
    ("invoice", "فاکتور", "🧾"),
    ("settings", "تنظیمات", "⚙"),
]


class AppContext:
    """زمینه‌ی مشترک بین صفحه‌ها (دسترسی به دیتابیس و ناوبری)."""

    def __init__(self, window: "MainWindow"):
        self.window = window
        self.db = Database.instance()

    # --- ناوبری ---
    def goto(self, key: str) -> None:
        self.window.show_page(key)

    def status(self, msg: str, timeout: int = 6000) -> None:
        self.window.statusBar().showMessage(msg, timeout)

    def palette(self) -> Dict[str, str]:
        return themes.palette(self.db.get_setting("theme", "light"))

    # --- پروژه‌ها ---
    def open_new_project(self) -> None:
        self.window.show_page("projects")
        self.window.pages_page.new_project()

    def open_project(self, pid: int) -> None:
        self.window.show_page("projects")
        self.window.pages_page.load_project(pid)

    def new_page_from_style(self, sid: int) -> None:
        self.window.show_page("projects")
        self.window.pages_page.new_page_from_style(sid)

    def open_invoice_for(self, pid: int, result) -> None:
        self.window.show_page("invoice")
        self.window.invoice_page.set_project(pid, result)

    def apply_theme(self) -> None:
        self.window.apply_theme()

    def refresh_all(self) -> None:
        self.window.refresh_current()


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.ctx = AppContext(self)
        self.setWindowTitle(f"{config.APP_NAME} — محاسبه‌گر قیمت تمام‌شده‌ی کابینت")
        self.resize(1380, 860)
        self.setMinimumSize(1080, 700)

        central = QWidget()
        self.setCentralWidget(central)
        root = QHBoxLayout(central)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # ---------------- نوار کناری ----------------
        sidebar = QFrame()
        sidebar.setObjectName("Sidebar")
        sidebar.setFixedWidth(218)
        sv = QVBoxLayout(sidebar)
        sv.setContentsMargins(12, 18, 12, 14)
        sv.setSpacing(4)

        brand = QLabel("🗄 کبیر")
        brand.setObjectName("SidebarBrand")
        brand.setAlignment(Qt.AlignCenter)
        sv.addWidget(brand)
        sub = QLabel("محاسبه‌گر قیمت تمام‌شده‌ی کابینت")
        sub.setObjectName("SidebarSub")
        sub.setAlignment(Qt.AlignCenter)
        sv.addWidget(sub)

        self.nav_group = QButtonGroup(self)
        self.nav_group.setExclusive(True)
        self.nav_buttons: Dict[str, QPushButton] = {}
        for i, (key, label, icon) in enumerate(NAV_ITEMS):
            btn = QPushButton(f"{icon}   {label}")
            btn.setObjectName("NavButton")
            btn.setCheckable(True)
            btn.setCursor(Qt.PointingHandCursor)
            btn.clicked.connect(lambda _=False, k=key: self.show_page(k))
            self.nav_group.addButton(btn, i)
            self.nav_buttons[key] = btn
            sv.addWidget(btn)
        sv.addStretch(1)

        foot = QLabel(f"نسخه {fa.to_fa_digits(config.APP_VERSION)}  •  {fa.jdate_long()}")
        foot.setObjectName("SidebarFooter")
        foot.setAlignment(Qt.AlignCenter)
        sv.addWidget(foot)
        root.addWidget(sidebar)

        # ---------------- محتوا ----------------
        self.stack = QStackedWidget()
        root.addWidget(self.stack, 1)

        self.dashboard = DashboardPage(self.ctx)
        self.projects_page = ProjectsPage(self.ctx)
        self.materials_page = MaterialsPage(self.ctx)
        self.styles_page = StylesPage(self.ctx)
        self.invoice_page = InvoicePage(self.ctx)
        self.settings_page = SettingsPage(self.ctx)

        self.pages: Dict[str, QWidget] = {
            "dashboard": self.dashboard,
            "projects": self.projects_page,
            "materials": self.materials_page,
            "styles": self.styles_page,
            "invoice": self.invoice_page,
            "settings": self.settings_page,
        }
        for w in self.pages.values():
            self.stack.addWidget(w)

        self.status = QStatusBar()
        self.setStatusBar(self.status)
        self.apply_theme()
        self.show_page("dashboard")

        # پشتیبان‌گیری خودکار هنگام اجرا
        QTimer.singleShot(400, self._auto_backup)

    # ------------------------------------------------------------------
    def apply_theme(self) -> None:
        theme = self.ctx.db.get_setting("theme", "light")
        size = int(self.ctx.db.get_num("font_size", 12))
        app = QApplication.instance()
        fam = app.font().family() if app else config.FONT_FAMILY
        self.setStyleSheet(themes.get_qss(theme, font_family=fam, font_size=size))

    def show_page(self, key: str) -> None:
        w = self.pages.get(key)
        if not w:
            return
        self.stack.setCurrentWidget(w)
        btn = self.nav_buttons.get(key)
        if btn:
            btn.setChecked(True)
        self.refresh_current()

    def refresh_current(self) -> None:
        w = self.stack.currentWidget()
        if hasattr(w, "refresh"):
            try:
                w.refresh()
            except Exception as exc:           # noqa: BLE001
                self.statusBar().showMessage(f"خطا در به‌روزرسانی: {exc}")

    def _auto_backup(self) -> None:
        try:
            bk.auto_backup_if_needed(self.ctx.db)
        except Exception:                      # noqa: BLE001
            pass

    def closeEvent(self, event) -> None:
        try:
            bk.auto_backup_if_needed(self.ctx.db)
        except Exception:                      # noqa: BLE001
            pass
        super().closeEvent(event)
