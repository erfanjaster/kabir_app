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
"""صفحه‌ی سبک‌های پروژه (تا ۲۰ سبک قابل ذخیره)."""

from __future__ import annotations

from typing import Any, Dict, Optional

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QFrame, QGridLayout, QHBoxLayout, QLabel, QMessageBox, QScrollArea,
    QVBoxLayout, QWidget, QDialog,
)

from ...config import MAX_STYLES
from ...core import persian as fa
from ...data.dao import StyleRepo
from ..dialogs import StyleDialog
from ..widgets import Banner, Card, make_button


class StyleCard(QFrame):
    edit_requested = Signal(int)
    dup_requested = Signal(int)
    del_requested = Signal(int)
    use_requested = Signal(int)

    def __init__(self, style: Dict[str, Any], parent=None):
        super().__init__(parent)
        self.setObjectName("Card")
        self.style_id = style["id"]
        lay = QVBoxLayout(self)
        lay.setContentsMargins(14, 12, 14, 12)
        lay.setSpacing(6)

        top = QHBoxLayout()
        name = QLabel(f"✦ {style['name']}")
        name.setStyleSheet("font-weight: 800; font-size: 14px;")
        top.addWidget(name)
        top.addStretch(1)
        lay.addLayout(top)

        if style.get("note"):
            note = QLabel(style["note"])
            note.setObjectName("Tiny")
            note.setWordWrap(True)
            lay.addWidget(note)

        d = style.get("data", {})
        bits = []
        for key, label in (("body", "بدنه"), ("door", "در"), ("banding", "نوار"),
                           ("hinge", "لولا"), ("handle", "دستگیره"), ("countertop", "صفحه")):
            if d.get(key):
                bits.append(f"<b>{label}:</b> {d[key]}")
        chips = QLabel("  •  ".join(bits) or "—")
        chips.setWordWrap(True)
        chips.setStyleSheet("color: palette(text); font-size: 11px;")
        chips.setTextInteractionFlags(Qt.TextSelectableByMouse)
        lay.addWidget(chips)

        extra = (f"پرت {fa.fmt_number(d.get('waste_percent', 0), 1)}٪ • "
                 f"سربار {fa.fmt_number(d.get('overhead_percent', 0), 1)}٪ • "
                 f"سود {'مارکاپ' if d.get('profit_mode') == 'markup' else 'مارجین'} "
                 f"{fa.fmt_number(d.get('profit_percent', 0), 1)}٪")
        el = QLabel(extra)
        el.setObjectName("Muted")
        lay.addWidget(el)

        bar = QHBoxLayout()
        bar.addWidget(make_button("استفاده در پروژه", "Primary", "▸",
                                  on_click=lambda: self.use_requested.emit(self.style_id)))
        bar.addWidget(make_button("ویرایش", "Ghost", "✎",
                                  on_click=lambda: self.edit_requested.emit(self.style_id)))
        bar.addWidget(make_button("کپی", "Ghost", "⧉",
                                  on_click=lambda: self.dup_requested.emit(self.style_id)))
        bar.addWidget(make_button("حذف", "Ghost", "🗑",
                                  on_click=lambda: self.del_requested.emit(self.style_id)))
        bar.addStretch(1)
        lay.addLayout(bar)


class StylesPage(QWidget):
    def __init__(self, app_ctx, parent=None):
        super().__init__(parent)
        self.ctx = app_ctx
        self.repo = StyleRepo(app_ctx.db)

        outer = QVBoxLayout(self)
        outer.setContentsMargins(18, 16, 18, 16)
        outer.setSpacing(12)

        head = QHBoxLayout()
        t = QLabel("سبک‌های پروژه")
        t.setObjectName("PageTitle")
        head.addWidget(t)
        self.count_lbl = QLabel("")
        self.count_lbl.setObjectName("PageSubtitle")
        head.addWidget(self.count_lbl)
        head.addStretch(1)
        head.addWidget(make_button("سبک جدید", "Primary", "＋", on_click=self.add_style))
        outer.addLayout(head)

        self.banner = Banner("info", "هر سبک ترکیبی از متریال‌های پرکاربرد شماست؛ با یک کلیک "
                                     "در صفحه‌ی پروژه اعمال می‌شود و تمام یونیت‌های جدید همان "
                                     "متریال را می‌گیرند.")
        outer.addWidget(self.banner)

        scroll = QScrollArea(self)
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        self.grid_host = QWidget()
        self.grid = QGridLayout(self.grid_host)
        self.grid.setSpacing(14)
        scroll.setWidget(self.grid_host)
        outer.addWidget(scroll, 1)

    def refresh(self) -> None:
        while self.grid.count():
            item = self.grid.takeAt(0)
            w = item.widget()
            if w:
                w.deleteLater()
        styles = self.repo.all()
        self.count_lbl.setText(f"{fa.fmt_number(len(styles))} از {fa.fmt_number(MAX_STYLES)} سبک")
        for i, st in enumerate(styles):
            card = StyleCard(st)
            card.edit_requested.connect(lambda sid: self.edit_style(sid))
            card.dup_requested.connect(lambda sid: self.dup_style(sid))
            card.del_requested.connect(lambda sid: self.del_style(sid))
            card.use_requested.connect(lambda sid: self.use_style(sid))
            self.grid.addWidget(card, i // 3, i % 3)
        # سلول خالی برای افزودن
        adder = QFrame()
        adder.setObjectName("Card")
        al = QVBoxLayout(adder)
        btn = make_button("＋  تعریف سبک جدید", "Ghost", on_click=self.add_style)
        btn.setMinimumHeight(90)
        al.addWidget(btn)
        self.grid.addWidget(adder, len(styles) // 3, len(styles) % 3)

    # ------------------------------------------------------------------
    def add_style(self) -> None:
        if self.repo.count() >= MAX_STYLES:
            QMessageBox.warning(self, "محدودیت سبک",
                                f"حداکثر {MAX_STYLES} سبک قابل ذخیره است؛ ابتدا یکی را حذف کنید.")
            return
        d = StyleDialog(self.repo, self)
        if d.exec() == QDialog.Accepted:
            name, note, data = d.result()
            self.repo.add(name, data, note)
            self.ctx.db.log("style", f"سبک جدید: {name}")
            self.refresh()

    def edit_style(self, sid: int) -> None:
        st = self.repo.get(sid)
        if not st:
            return
        d = StyleDialog(self.repo, self, style=st)
        if d.exec() == QDialog.Accepted:
            name, note, data = d.result()
            self.repo.update(sid, name, data, note)
            self.refresh()

    def dup_style(self, sid: int) -> None:
        if self.repo.count() >= MAX_STYLES:
            QMessageBox.warning(self, "محدودیت سبک", f"حداکثر {MAX_STYLES} سبک.")
            return
        self.repo.duplicate(sid)
        self.refresh()

    def del_style(self, sid: int) -> None:
        from ..widgets import ask_confirm
        st = self.repo.get(sid)
        if st and ask_confirm(self, "حذف سبک", f"سبک «{st['name']}» حذف شود؟"):
            self.repo.delete(sid)
            self.refresh()

    def use_style(self, sid: int) -> None:
        self.ctx.new_page_from_style(sid)

    def data_of(self, sid: int) -> Dict[str, Any]:
        st = self.repo.get(sid)
        return (st or {}).get("data", {})
