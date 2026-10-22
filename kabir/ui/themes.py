# -*- coding: utf-8 -*-
"""پوسته‌های روشن و تاریک (QSS) با پشتیبانی کامل راست‌به‌چپ."""

from __future__ import annotations

LIGHT = {
    "bg": "#f4f6fb",
    "surface": "#ffffff",
    "surface2": "#f7f9fc",
    "surface3": "#eef1f7",
    "text": "#1e2633",
    "text2": "#5c6a80",
    "text3": "#8b97a8",
    "border": "#dde3ec",
    "border2": "#c8d1de",
    "accent": "#0f766e",
    "accent_hover": "#0d9488",
    "accent_pressed": "#115e59",
    "accent_soft": "#e0f2f1",
    "accent_text": "#ffffff",
    "sidebar": "#10222e",
    "sidebar_text": "#c8d6e0",
    "sidebar_active": "#0f766e",
    "sidebar_hover": "#1b3543",
    "danger": "#dc2626",
    "danger_soft": "#fee2e2",
    "warning": "#d97706",
    "warning_soft": "#fef3c7",
    "success": "#16a34a",
    "success_soft": "#dcfce7",
    "info": "#2563eb",
    "info_soft": "#dbeafe",
    "grid": "#e7ecf3",
    "header": "#eef2f8",
    "selection": "#0f766e",
}

DARK = {
    "bg": "#11151c",
    "surface": "#181e27",
    "surface2": "#1e2530",
    "surface3": "#252d3a",
    "text": "#e6ebf2",
    "text2": "#a5b1c2",
    "text3": "#737f91",
    "border": "#2a3341",
    "border2": "#3a4557",
    "accent": "#14b8a6",
    "accent_hover": "#2dd4bf",
    "accent_pressed": "#0d9488",
    "accent_soft": "#12332f",
    "accent_text": "#06231f",
    "sidebar": "#0d1117",
    "sidebar_text": "#9fb0c0",
    "sidebar_active": "#14b8a6",
    "sidebar_hover": "#1a212b",
    "danger": "#f87171",
    "danger_soft": "#3a1d1d",
    "warning": "#fbbf24",
    "warning_soft": "#3a2f14",
    "success": "#4ade80",
    "success_soft": "#14351f",
    "info": "#60a5fa",
    "info_soft": "#14293f",
    "grid": "#232b37",
    "header": "#1e2530",
    "selection": "#14b8a6",
}

PALETTES = {"light": LIGHT, "dark": DARK}

# آیکون‌های متنی (بدون نیاز به فایل تصویر)
ICONS = {
    "dashboard": "▦",
    "materials": "▤",
    "styles": "✦",
    "projects": "🗂",
    "invoice": "🧾",
    "settings": "⚙",
    "backup": "🛡",
    "plus": "＋",
    "save": "💾",
    "trash": "🗑",
    "edit": "✎",
    "copy": "⧉",
    "pdf": "▣",
    "print": "🖨",
    "excel": "📊",
    "calc": "🧮",
    "search": "🔍",
    "refresh": "⟳",
    "home": "⌂",
    "info": "ⓘ",
    "check": "✔",
    "close": "✕",
    "down": "▾",
    "left": "◂",
    "right": "▸",
    "folder": "🗀",
    "money": "💰",
    "chart": "📈",
    "box": "📦",
    "door": "🚪",
    "tool": "🔧",
}


def build_qss(p: dict, font_family: str = "Vazirmatn", font_size: int = 12,
              row_height: int = 34) -> str:
    """ساخت stylesheet کامل برنامه از روی پالت رنگ."""
    fs = font_size
    return f"""
* {{
    font-family: "{font_family}", "Vazir", "Tahoma", "Noto Sans Arabic", sans-serif;
    font-size: {fs}pt;
    outline: none;
}}
QWidget {{
    background: transparent;
    color: {p['text']};

}}
QMainWindow, QDialog {{ background: {p['bg']}; }}

/* ---------------- نوار کناری ---------------- */
#Sidebar {{
    background: {p['sidebar']};
    border: none;
}}
#SidebarBrand {{
    color: #ffffff;
    font-size: {fs + 6}pt;
    font-weight: 800;
    padding: 6px;
}}
#SidebarSub {{
    color: {p['sidebar_text']};
    font-size: {fs - 2}pt;
    padding-bottom: 12px;
}}
#NavButton {{
    background: transparent;
    color: {p['sidebar_text']};
    border: none;
    border-radius: 10px;
    padding: 11px 14px;
    text-align: right;
    font-size: {fs}pt;
    font-weight: 500;
}}
#NavButton:hover {{ background: {p['sidebar_hover']}; color: #ffffff; }}
#NavButton:checked, #NavButton[active="true"] {{
    background: {p['sidebar_active']};
    color: {p['accent_text']};
    font-weight: 700;
}}
#SidebarFooter {{ color: {p['sidebar_text']}; font-size: {fs - 3}pt; padding: 8px; }}

/* ---------------- هدر ---------------- */
#PageHeader {{ background: {p['surface']}; border-bottom: 1px solid {p['border']}; }}
#PageTitle {{ font-size: {fs + 7}pt; font-weight: 800; color: {p['text']}; }}
#PageSubtitle {{ font-size: {fs - 1}pt; color: {p['text2']}; }}

/* ---------------- کارت‌ها ---------------- */
QFrame#Card, QWidget#Card {{
    background: {p['surface']};
    border: 1px solid {p['border']};
    border-radius: 14px;
}}
QFrame#CardHeader {{
    background: {p['surface2']};
    border: none;
    border-top-right-radius: 14px;
    border-top-left-radius: 14px;
}}
QLabel#CardTitle {{ font-size: {fs + 1}pt; font-weight: 700; color: {p['text']}; }}
QLabel#CardSub {{ font-size: {fs - 2}pt; color: {p['text2']}; }}

QFrame#StatCard {{
    background: {p['surface']};
    border: 1px solid {p['border']};
    border-left: 4px solid {p['accent']};
    border-radius: 14px;
}}
QLabel#StatValue {{ font-size: {fs + 9}pt; font-weight: 800; color: {p['accent']}; }}
QLabel#StatLabel {{ font-size: {fs - 1}pt; color: {p['text2']}; font-weight: 600; }}
QLabel#StatHint  {{ font-size: {fs - 3}pt; color: {p['text3']}; }}

QLabel#SectionTitle {{ font-size: {fs + 2}pt; font-weight: 800; color: {p['text']}; }}
QLabel#BigNumber {{ font-size: {fs + 10}pt; font-weight: 800; color: {p['accent']}; }}
QLabel#Muted {{ color: {p['text2']}; }}
QLabel#Tiny {{ color: {p['text3']}; font-size: {fs - 2}pt; }}
QLabel#SuccessText {{ color: {p['success']}; font-weight: 700; }}
QLabel#DangerText {{ color: {p['danger']}; font-weight: 700; }}
QLabel#WarnText {{ color: {p['warning']}; font-weight: 700; }}

/* ---------------- دکمه‌ها ---------------- */
QPushButton {{
    background: {p['surface2']};
    color: {p['text']};
    border: 1px solid {p['border2']};
    border-radius: 9px;
    padding: 7px 16px;
    font-weight: 600;
}}
QPushButton:hover {{ background: {p['surface3']}; border-color: {p['accent']}; }}
QPushButton:pressed {{ background: {p['border']}; }}
QPushButton:disabled {{ color: {p['text3']}; background: {p['surface2']}; border-color: {p['border']}; }}
QPushButton:default {{ background: {p['accent']}; color: {p['accent_text']}; border-color: {p['accent']}; }}

QPushButton#Primary {{
    background: {p['accent']}; color: {p['accent_text']}; border: none; font-weight: 700;
}}
QPushButton#Primary:hover {{ background: {p['accent_hover']}; }}
QPushButton#Primary:pressed {{ background: {p['accent_pressed']}; }}

QPushButton#Danger {{
    background: {p['danger']}; color: #ffffff; border: none; font-weight: 700;
}}
QPushButton#Danger:hover {{ background: {p['danger']}; color: #fff; opacity: .9; }}

QPushButton#Ghost {{ background: transparent; border: 1px solid {p['border2']}; }}
QPushButton#Ghost:hover {{ background: {p['surface2']}; border-color: {p['accent']}; }}

QPushButton#Success {{ background: {p['success']}; color: #ffffff; border: none; font-weight: 700; }}
QPushButton#Icon {{
    background: transparent; border: none; padding: 4px 8px; font-size: {fs + 1}pt;
}}
QPushButton#Icon:hover {{ background: {p['surface3']}; border-radius: 8px; }}
QPushButton#ToolButton {{ padding: 5px 10px; }}

QToolButton {{
    background: {p['surface2']}; border: 1px solid {p['border2']};
    border-radius: 8px; padding: 5px 10px;
}}
QToolButton:hover {{ background: {p['surface3']}; }}
QToolButton:checked {{ background: {p['accent_soft']}; border-color: {p['accent']}; }}

/* ---------------- ورودی‌ها ---------------- */
QLineEdit, QPlainTextEdit, QTextEdit, QSpinBox, QDoubleSpinBox, QComboBox, QDateEdit {{
    background: {p['surface']};
    color: {p['text']};
    border: 1px solid {p['border2']};
    border-radius: 9px;
    padding: 6px 10px;
    selection-background-color: {p['selection']};
    selection-color: {p['accent_text']};
}}
QLineEdit:focus, QPlainTextEdit:focus, QTextEdit:focus,
QSpinBox:focus, QDoubleSpinBox:focus, QComboBox:focus, QDateEdit:focus {{
    border: 2px solid {p['accent']};
    padding: 5px 9px;
}}
QLineEdit:disabled, QSpinBox:disabled, QDoubleSpinBox:disabled, QComboBox:disabled {{
    background: {p['surface3']}; color: {p['text3']};
}}
QLineEdit[invalid="true"] {{ border: 2px solid {p['danger']}; background: {p['danger_soft']}; }}

QComboBox::drop-down {{ border: none; width: 26px; }}
QComboBox::down-arrow {{
    image: none; border-left: 4px solid transparent; border-right: 4px solid transparent;
    border-top: 5px solid {p['text2']}; margin-left: 8px;
}}
QComboBox QAbstractItemView {{
    background: {p['surface']}; color: {p['text']};
    border: 1px solid {p['border2']}; border-radius: 8px;
    selection-background-color: {p['accent']}; selection-color: {p['accent_text']};
    padding: 4px; outline: none;
}}

QSpinBox::up-button, QDoubleSpinBox::up-button,
QSpinBox::down-button, QDoubleSpinBox::down-button {{
    background: {p['surface2']}; border: none; width: 16px;
}}
QSpinBox::up-button:hover, QDoubleSpinBox::up-button:hover,
QSpinBox::down-button:hover, QDoubleSpinBox::down-button:hover {{ background: {p['accent_soft']}; }}

/* ---------------- جداول ---------------- */
QTableWidget, QTableView, QTreeWidget, QTreeView {{
    background: {p['surface']};
    alternate-background-color: {p['surface2']};
    border: 1px solid {p['border']};
    border-radius: 10px;
    gridline-color: {p['grid']};
    selection-background-color: {p['accent_soft']};
    selection-color: {p['text']};
}}
QHeaderView::section {{
    background: {p['header']};
    color: {p['text']};
    padding: 8px 6px;
    border: none;
    border-left: 1px solid {p['border']};
    border-bottom: 2px solid {p['border2']};
    font-weight: 700;
}}
QTableWidget::item, QTableView::item {{ padding: 4px 6px; border: none; }}
QTableWidget::item:selected, QTableView::item:selected {{
    background: {p['accent_soft']}; color: {p['text']};
}}
QTableCornerButton::section {{ background: {p['header']}; border: none; }}

/* ---------------- تب‌ها ---------------- */
QTabWidget::pane {{ border: 1px solid {p['border']}; border-radius: 10px; background: {p['surface']}; top: -1px; }}
QTabBar {{ qproperty-drawBase: false; }}
QTabBar::tab {{
    background: transparent; color: {p['text2']};
    padding: 9px 18px; margin-left: 3px;
    border: 1px solid transparent;
    border-top-right-radius: 10px; border-top-left-radius: 10px;
    font-weight: 600;
}}
QTabBar::tab:hover {{ background: {p['surface2']}; color: {p['text']}; }}
QTabBar::tab:selected {{
    background: {p['surface']}; color: {p['accent']};
    border: 1px solid {p['border']}; border-bottom-color: {p['surface']};
    font-weight: 800;
}}

/* ---------------- سایر ---------------- */
QGroupBox {{
    background: {p['surface']};
    border: 1px solid {p['border']};
    border-radius: 12px;
    margin-top: 16px;
    padding-top: 14px;
    font-weight: 700;
}}
QGroupBox::title {{
    subcontrol-origin: margin; subcontrol-position: top right;
    right: 14px; padding: 2px 10px;
    background: {p['accent_soft']}; color: {p['accent']};
    border-radius: 8px; border: 1px solid {p['border']};
}}
QScrollArea {{ border: none; background: transparent; }}
QScrollBar:vertical {{ background: transparent; width: 11px; margin: 2px; }}
QScrollBar::handle:vertical {{ background: {p['border2']}; border-radius: 5px; min-height: 30px; }}
QScrollBar::handle:vertical:hover {{ background: {p['accent']}; }}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0; }}
QScrollBar:horizontal {{ background: transparent; height: 11px; margin: 2px; }}
QScrollBar::handle:horizontal {{ background: {p['border2']}; border-radius: 5px; min-width: 30px; }}
QScrollBar::handle:horizontal:hover {{ background: {p['accent']}; }}
QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{ width: 0; }}

QCheckBox {{ spacing: 8px; background: transparent; }}
QCheckBox::indicator {{
    width: 18px; height: 18px; border-radius: 5px;
    border: 2px solid {p['border2']}; background: {p['surface']};
}}
QCheckBox::indicator:hover {{ border-color: {p['accent']}; }}
QCheckBox::indicator:checked {{ background: {p['accent']}; border-color: {p['accent']}; }}
QRadioButton::indicator {{
    width: 18px; height: 18px; border-radius: 9px;
    border: 2px solid {p['border2']}; background: {p['surface']};
}}
QRadioButton::indicator:checked {{ background: {p['accent']}; border-color: {p['accent']}; }}

QProgressBar {{
    background: {p['surface3']}; border: none; border-radius: 7px;
    height: 14px; text-align: center; color: {p['text2']}; font-size: {fs - 3}pt;
}}
QProgressBar::chunk {{ background: {p['accent']}; border-radius: 7px; }}

QMenu {{
    background: {p['surface']}; border: 1px solid {p['border2']};
    border-radius: 10px; padding: 6px;
}}
QMenu::item {{ padding: 7px 22px; border-radius: 7px; }}
QMenu::item:selected {{ background: {p['accent']}; color: {p['accent_text']}; }}
QMenu::separator {{ height: 1px; background: {p['border']}; margin: 5px 8px; }}

QToolTip {{
    background: {p['sidebar']}; color: #ffffff; border: 1px solid {p['accent']};
    border-radius: 7px; padding: 6px 9px;
}}
QStatusBar {{ background: {p['surface']}; color: {p['text2']}; border-top: 1px solid {p['border']}; }}
QSplitter::handle {{ background: {p['border']}; width: 3px; height: 3px; }}

/* بنرهای رنگی */
QFrame#BannerInfo {{ background: {p['info_soft']}; border: 1px solid {p['info']}; border-radius: 10px; }}
QFrame#BannerWarn {{ background: {p['warning_soft']}; border: 1px solid {p['warning']}; border-radius: 10px; }}
QFrame#BannerOk   {{ background: {p['success_soft']}; border: 1px solid {p['success']}; border-radius: 10px; }}
QFrame#BannerBad  {{ background: {p['danger_soft']}; border: 1px solid {p['danger']}; border-radius: 10px; }}
QLabel#BannerTextInfo {{ color: {p['info']}; }}
QLabel#BannerTextWarn {{ color: {p['warning']}; }}
QLabel#BannerTextOk   {{ color: {p['success']}; }}
QLabel#BannerTextBad  {{ color: {p['danger']}; }}

QFrame#TotalBar {{ background: {p['accent_soft']}; border: 1px solid {p['accent']}; border-radius: 12px; }}
"""


def get_qss(theme: str = "light", font_family: str = "Vazirmatn",
            font_size: int = 12, row_height: int = 34) -> str:
    p = PALETTES.get(theme, LIGHT)
    return build_qss(p, font_family=font_family, font_size=font_size, row_height=row_height)


def palette(theme: str = "light") -> dict:
    return dict(PALETTES.get(theme, LIGHT))
