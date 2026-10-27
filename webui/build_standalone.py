#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ساخت kabir-ui-standalone.html — نسخه‌ی تک‌فایلی رابط وب با CSS/JS/فونت درون‌خطی.

اجرا:  python3 build_standalone.py   (از پوشه‌ی webui یا هرجای دیگر)
"""
import base64
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent

css = (HERE / "css/styles.css").read_text(encoding="utf-8")
js = "".join(
    (HERE / f"js/{name}.js").read_text(encoding="utf-8") + "\n"
    for name in ("data", "engine", "ui")
)
html = (HERE / "index.html").read_text(encoding="utf-8")


def datauri(rel: str) -> str:
    raw = (HERE / rel).read_bytes()
    return f"url(data:font/ttf;base64,{base64.b64encode(raw).decode()})"


# فونت Light استفاده نمی‌شود — بلوکش حذف و بقیه embed می‌شوند
css = re.sub(r"@font-face\s*\{[^}]*Vazirmatn-Light\.ttf[^}]*\}\s*", "", css)
for name in ("Vazirmatn-Regular.ttf", "Vazirmatn-Medium.ttf", "Vazirmatn-Bold.ttf"):
    css = css.replace(f'url("../assets/fonts/{name}")', datauri(f"assets/fonts/{name}"))

assert "</script" not in js, "JS نباید تگ بسته‌شدن اسکریپت داشته باشد"
assert "</style" not in css, "CSS نباید تگ بسته‌شدن style داشته باشد"

html = html.replace('<link rel="stylesheet" href="css/styles.css">', f"<style>\n{css}\n</style>")
first = True
for name in ("data", "engine", "ui"):
    tag = f'<script src="js/{name}.js" defer></script>'
    if first:
        html = html.replace(tag, f"<script>\n{js}\n</script>")
        first = False
    else:
        html = html.replace(tag, "")

out = HERE / "kabir-ui-standalone.html"
out.write_text(html, encoding="utf-8")
print(f"✅ {out.name} ساخته شد — {out.stat().st_size // 1024} کیلوبایت")
