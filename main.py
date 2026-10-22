# -*- coding: utf-8 -*-
"""
نقطه‌ی ورود نرم‌افزار کبیر
==========================
اجرا:
    python main.py            (از پوشه‌ی kabir_app)
    یا: python -m kabir.main

برنامه به‌صورت خودکار:
  ۱) فونت فارسی وزیرمتن را پیدا/دانلود و ثبت می‌کند
  ۲) پایگاه‌داده‌ی محلی را می‌سازد و داده‌های نمونه را درج می‌کند
  ۳) رابط راست‌به‌چپ فارسی را بالا می‌آورد
"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

# اجازه‌ی اجرای مستقیم اسکریپت از هر مسیری
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _excepthook(exc_type, exc_value, exc_tb):
    msg = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
    try:
        from kabir import config
        config.LOG_PATH.write_text(msg, encoding="utf-8")
    except Exception:                          # noqa: BLE001
        pass
    print(msg, file=sys.stderr)
    try:
        from PySide6.QtWidgets import QMessageBox
        QMessageBox.critical(None, "خطای غیرمنتظره",
                             "جزئیات خطا در فایل لاگ ذخیره شد:\n" + str(exc_value))
    except Exception:                          # noqa: BLE001
        pass


def main() -> int:
    sys.excepthook = _excepthook

    from PySide6.QtCore import Qt, QTimer
    from PySide6.QtGui import QFont
    from PySide6.QtWidgets import QApplication, QSplashScreen, QLabel, QVBoxLayout, QWidget

    from kabir import config
    from kabir.core import fonts as fonts_mod
    from kabir.data import backup as bk
    from kabir.data.dao import bootstrap
    from kabir.data.db import Database
    from kabir.ui.main_window import MainWindow

    # High-DPI و RTL
    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)
    app = QApplication(sys.argv)
    app.setApplicationName(config.APP_NAME_EN)
    app.setApplicationDisplayName(config.APP_NAME)
    app.setOrganizationName(config.ORG_NAME)
    app.setLayoutDirection(Qt.RightToLeft)

    # ---------------- اسپلش ----------------
    splash_box = QWidget()
    splash_box.setObjectName("splash")
    splash_box.setStyleSheet(
        "#splash { background: #0f766e; border-radius: 0px; }"
        " QLabel { color: white; background: transparent; }")
    sv = QVBoxLayout(splash_box)
    sv.setContentsMargins(40, 34, 40, 30)
    t = QLabel("🗄  کبیر")
    t.setStyleSheet("font-size: 34px; font-weight: 800;")
    sv.addWidget(t)
    s = QLabel("محاسبه‌گر قیمت تمام‌شده و صدور فاکتور صنعت کابینت")
    s.setStyleSheet("font-size: 14px;")
    sv.addWidget(s)
    step = QLabel("در حال آماده‌سازی…")
    step.setStyleSheet("font-size: 11px; color: #d1fae5;")
    sv.addWidget(step)
    splash = QSplashScreen(splash_box.grab())
    splash.show()
    app.processEvents()

    # ---------------- فونت ----------------
    step.setText("بارگذاری فونت فارسی…")
    app.processEvents()
    ok_font, font_msg = fonts_mod.ensure_fonts(app, download=True)

    # ---------------- پایگاه‌داده ----------------
    step.setText("آماده‌سازی پایگاه‌داده…")
    app.processEvents()
    db = Database.instance()
    bootstrap(db)

    # اندازه‌ی قلم از تنظیمات
    size = int(db.get_num("font_size", 12))
    f = app.font()
    f.setPointSize(size)
    app.setFont(f)

    # ---------------- پنجره ----------------
    step.setText("ساخت رابط کاربری…")
    app.processEvents()
    win = MainWindow()
    win.apply_theme()
    win.show()
    splash.finish(win)

    if not ok_font:
        QTimer.singleShot(800, lambda: win.statusBar().showMessage(
            "⚠ فونت فارسی دانلود نشد؛ " + font_msg, 15000))
    else:
        win.statusBar().showMessage("فونت فعال: " + font_msg, 8000)

    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
