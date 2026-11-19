"use strict";
/* ==========================================================================
   نمای فنی ۲D یونیت (کاغذ آبی)
   ==========================================================================
   هدف: کارگاه قبل از ارّه، «تصویرِ بزرگِ ذهنی» از همان یونیتِ تعریف‌شده
   ببیند — درها، کشوها، طبقات، پاخور و ابعاد، همان‌طور که موتور محاسبه
   فاکتور را روی آن‌ها بسته است. هیچ عددی از خودمان نمی‌سازیم؛ همه‌چیز از
   ردیف‌های یونیتِ ویرایشگر می‌آید.

   این فایل عمداً «بدون DOM» نوشته شده (تولیدِ رشته‌ی SVG خالص) تا در
   تست‌های Node (tests/blueprint_check.js) هم بدون مرورگر قابل بررسی باشد.
   فقط در انتهای فایل سه تابعِ DOM-دار (بازکردن مودال، پرکردنش، چاپ) آمده
   که در Node بی‌اثرند.                                                     */

/* رنگ‌های کاغذِ آبی — ثابت و مستقل از تم؛ «کاغذِ آبی» باید همیشه آبی بماند */
const BP = {
  paper: "#123a5c",
  paperDeep: "#0d2c47",
  grid: "rgba(255,255,255,0.07)",
  ink: "#dcecff",
  inkThin: "rgba(220,236,255,0.55)",
  inkFaint: "rgba(220,236,255,0.28)",
  fill: "rgba(255,255,255,0.055)",
  fillDeep: "rgba(255,255,255,0.11)",
  dim: "#ffd98a",
  accent: "#7fd8c4",
};

const BP_LEG_H = 10;          /* ارتفاعِ فرضِ پاخور/پایه (سانتی‌متر)      */
const BP_GAP = 0.25;          /* فاصله‌ی بین لنگه‌ها (سانتی‌متر)           */
const BP_WALL = 1.8;          /* ضخامتِ صفحه‌ی در (سانتی‌متر) — نمایی      */

let _bpUid = 0;

/* ابزارهای عددی محلی — از fa() و esc() داده‌بارگذاری‌شده‌ی data.js استفاده می‌کنیم */
function _bpN(v, dflt) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : (dflt || 0);
}
function _bpFmt(v) {
  /* بدون جداکننده‌ی هزارگان — ابعاد است، نه قیمت */
  const n = Number(v);
  const s = isFinite(n) ? String(Math.round(n * 10) / 10) : "۰";
  return (typeof fa === "function" ? fa(s) : s);
}
function _bpEsc(s) { return typeof esc === "function" ? esc(s) : String(s); }

function _bpClampDims(u) {
  return {
    L: _bpN(u.length_cm, 60),
    H: _bpN(u.height_cm, 72),
    D: _bpN(u.depth_cm, 55),
    shelves: Math.max(0, Math.round(_bpN(u.shelves, 0))),
    qty: Math.max(1, Math.round(_bpN(u.qty, 1))),
    legs: (u.unit_type === "ground" || u.unit_type === "tall" || u.unit_type === "drawer"),
  };
}

/* --------------------------- اجزای مشترکِ SVG --------------------------- */

function _bpDefs(uid) {
  /* پترنِ نقطه‌چینِ کاغذ آبی + سرِ فلشِ خطوط اندازه */
  return `<defs>
    <pattern id="bpgrid-${uid}" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="${BP.grid}" stroke-width="1"/>
    </pattern>
    <marker id="bpar-${uid}" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="${BP.dim}"/>
    </marker>
  </defs>`;
}

function _bpDimH(uid, x1, x2, y, label) {
  const a = Math.min(x1, x2), b = Math.max(x1, x2);
  const cw = label.length * 7 + 14;
  return `<g>
    <line x1="${a}" y1="${y}" x2="${b}" y2="${y}" stroke="${BP.dim}" stroke-width="1.3"
          marker-start="url(#bpar-${uid})" marker-end="url(#bpar-${uid})"/>
    <line x1="${a}" y1="${y - 5}" x2="${a}" y2="${y + 5}" stroke="${BP.dim}" stroke-width="1"/>
    <line x1="${b}" y1="${y - 5}" x2="${b}" y2="${y + 5}" stroke="${BP.dim}" stroke-width="1"/>
    <rect x="${(a + b) / 2 - cw / 2}" y="${y - 9}" width="${cw}" height="18"
          rx="3" fill="${BP.paper}"/>
    <text x="${(a + b) / 2}" y="${y + 4}" text-anchor="middle" fill="${BP.dim}"
          font-size="12" font-weight="600">${label}</text>
  </g>`;
}

function _bpDimV(uid, y1, y2, x, label) {
  const a = Math.min(y1, y2), b = Math.max(y1, y2);
  const mid = (a + b) / 2;
  const cw = label.length * 7.6 + 12;
  /* خطِ عمودی با فلش — برچسب فقط چرخیده، قراردادِ نقشه‌کشی */
  return `<g>
    <line x1="${x}" y1="${a}" x2="${x}" y2="${b}" stroke="${BP.dim}" stroke-width="1.3"
          marker-start="url(#bpar-${uid})" marker-end="url(#bpar-${uid})"/>
    <line x1="${x - 5}" y1="${a}" x2="${x + 5}" y2="${a}" stroke="${BP.dim}" stroke-width="1"/>
    <line x1="${x - 5}" y1="${b}" x2="${x + 5}" y2="${b}" stroke="${BP.dim}" stroke-width="1"/>
    <g transform="rotate(-90 ${x} ${mid})">
      <rect x="${x - cw / 2}" y="${mid - 9}" width="${cw}" height="18"
            rx="3" fill="${BP.paper}"/>
      <text x="${x}" y="${mid + 4}" text-anchor="middle" fill="${BP.dim}"
            font-size="12" font-weight="600">${label}</text>
    </g>
  </g>`;
}

function _bpSvgOpen(w, h, uid, title) {
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${_bpEsc(title || "")}"
    font-family="Vazirmatn, Tahoma, sans-serif" style="background:${BP.paper};border-radius:10px">
    ${_bpDefs(uid)}
    <rect x="0" y="0" width="${w}" height="${h}" fill="url(#bpgrid-${uid})"/>`;
}

/* یک مستطیلِ قطعه با گوشه‌ی صاف و پرکننده‌ی ملایم */
function _bpRect(x, y, w, h, opts) {
  opts = opts || {};
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${opts.rx || 0}"
    fill="${opts.fill || BP.fill}" stroke="${opts.stroke || BP.ink}" stroke-width="${opts.sw || 1.6}"/>`;
}

/* --------------------------- نمای روبه‌رو --------------------------- */
/**
 * نمای روبه‌روی یونیت: درها/کشوها/طبقات/پاخور + اندازه‌های طول و ارتفاع.
 * @param {object} u ردیف یونیت (UnitRow شکل JS)
 * @returns {string} رشته‌ی SVG
 */
function bpFrontSVG(u) {
  const { L, H, shelves, legs } = _bpClampDims(u);
  const uid = ++_bpUid;
  const s = Math.max(1.1, Math.min(4.6, 330 / H, 560 / L));
  const w = L * s, h = H * s;
  const DIM = 30;                       /* نوارِ خطوط اندازه */
  const MLEFT = 26, MRIGHT = 12;        /* چپ برای خطِ ارتفاع */
  const W = MLEFT + w + MRIGHT, Ht = y0pad() + h + DIM;
  const x0 = MLEFT, y0 = y0pad();
  let g = _bpSvgOpen(W, Ht, uid, "نمای روبه‌رو");

  /* جعبه‌ی اصلی — کامل از بالا */
  const boxH = legs ? h - BP_LEG_H * s : h;
  g += _bpRect(x0, y0, w, boxH, { fill: "none", stroke: BP.ink, sw: 2 });

  /* پاخورِ فرورفته و پایه‌ها — زیرِ جعبه (زمینی/کمد/پکیج کشو) */
  if (legs) {
    const kbY = y0 + boxH;
    g += _bpRect(x0 + 2.5 * s, kbY, w - 5 * s, BP_LEG_H * s, { fill: BP.fillDeep, stroke: BP.inkThin, sw: 1.2 });
    const legW = Math.max(3, 5 * s);
    g += _bpRect(x0 + 1, kbY + 1, legW, BP_LEG_H * s - 2, { fill: BP.fill, stroke: BP.inkThin, sw: 1 });
    g += _bpRect(x0 + w - legW - 1, kbY + 1, legW, BP_LEG_H * s - 2, { fill: BP.fill, stroke: BP.inkThin, sw: 1 });
  }

  const drawers = (u.drawers || []).map((d) => ({ qty: Math.max(0, Math.round(_bpN(d.qty, 0))), h_cm: _bpN(d.h_cm, 15) })).filter((d) => d.qty > 0);
  const doors = (u.doors || []).map((d) => ({
    qty: Math.max(0, Math.round(_bpN(d.qty, 0))),
    w_cm: _bpN(d.w_cm, 45),
    h_cm: _bpN(d.h_cm, 60),
    glass: !!d.glass,
  })).filter((d) => d.qty > 0);
  const boxY = y0;

  /* کشوها از بالا */
  let cursorY = boxY;
  let drawerZoneH = 0;
  drawers.forEach((d) => {
    const rowH = Math.min(d.h_cm * s, Math.max(4, boxH - drawerZoneH));
    for (let k = 0; k < d.qty; k++) {
      if (drawerZoneH + rowH > boxH) break;
      g += _bpRect(x0 + 0.6 * s, cursorY, w - 1.2 * s, rowH - BP_GAP * s, { fill: BP.fill, stroke: BP.ink, sw: 1.4, rx: 2 });
      /* دستگیره‌ی افقی وسطِ کشو */
      const hw = Math.min(w * 0.3, 24);
      g += `<rect x="${x0 + (w - hw) / 2}" y="${cursorY + rowH / 2 - 2}" width="${hw}" height="4" rx="2" fill="${BP.inkThin}"/>`;
      cursorY += rowH;
      drawerZoneH += rowH;
    }
  });

  /* درها زیرِ کشوها — لنگه‌ها از راست (RTL) چیده می‌شوند */
  let doorZoneTop = boxY + drawerZoneH;
  let doorZoneH = boxH - drawerZoneH;
  doors.forEach((d) => {
    const rowH = Math.min(d.h_cm * s, Math.max(4, doorZoneH));
    const total = d.qty * d.w_cm * s + (d.qty - 1) * BP_GAP * s;
    const startX = x0 + Math.max(0, (w - total) / 2);   /* وسط‌چین */
    let cx = startX + total;                            /* از راست شروع */
    for (let k = 0; k < d.qty; k++) {
      const lw = d.w_cm * s;
      cx -= lw;
      if (cx < x0 - 0.5 || doorZoneH < 1) break;
      g += _bpRect(cx, doorZoneTop, lw, rowH - BP_GAP * s, { fill: BP.fill, stroke: BP.ink, sw: 1.4, rx: 2 });
      if (d.glass) {
        /* درِ شیشه‌دار: دو خطِ قطریِ کوتاه در گوشه — رسمِ متداولِ شیشه */
        g += `<line x1="${cx + lw * 0.12}" y1="${doorZoneTop + (rowH - BP_GAP * s) * 0.85}" x2="${cx + lw * 0.35}" y2="${doorZoneTop + (rowH - BP_GAP * s) * 0.6}" stroke="${BP.inkThin}" stroke-width="1.4"/>`;
      }
      /* دستگیره‌ی عمودی سمتِ داخل (سمتِ لولا مقابل) */
      const hx = (k === 0 && d.qty > 1) ? cx + lw - 3 : (k === d.qty - 1 && d.qty > 1) ? cx + 3 : cx + lw - 3;
      g += `<rect x="${hx}" y="${doorZoneTop + rowH * 0.3}" width="3" height="${Math.min(rowH * 0.4, 14)}" rx="1.5" fill="${BP.inkThin}"/>`;
      cx -= BP_GAP * s;
    }
    doorZoneTop += rowH;
    doorZoneH -= rowH;
  });

  /* بدونِ در: شلفِ باز — خطوط طبقات روی خودِ نما */
  if (!doors.length && !drawers.length && shelves > 0) {
    for (let k = 1; k <= shelves; k++) {
      const sy = boxY + (boxH * k) / (shelves + 1);
      g += `<line x1="${x0}" y1="${sy}" x2="${x0 + w}" y2="${sy}" stroke="${BP.inkThin}" stroke-width="1.2"/>`;
    }
  }

  /* برچسبِ نوع یونیت گوشه‌ی بالا-راست */
  const typeLbl = (typeof UNIT_TYPES !== "undefined" && UNIT_TYPES[u.unit_type]) || u.unit_type || "";
  g += `<text x="${W - 10}" y="${y0 + 16}" text-anchor="end" fill="${BP.accent}" font-size="12" font-weight="700">${_bpEsc(typeLbl)}</text>`;

  /* اندازه‌ها */
  g += _bpDimH(uid, x0, x0 + w, y0 + h + 14, `طول ${_bpFmt(L)} سم`);
  g += _bpDimV(uid, y0, y0 + h, 14, `ارتفاع ${_bpFmt(H)} سم`);

  g += `</svg>`;
  return g;
}

function y0pad() { return 6; }

/* --------------------------- نمای جانبی --------------------------- */
function bpSideSVG(u) {
  const { H, D, shelves, legs } = _bpClampDims(u);
  const uid = ++_bpUid;
  const s = Math.max(1.1, Math.min(4.6, 300 / H, 300 / Math.max(D, 20)));
  const w = Math.max(D, 20) * s, h = H * s;
  const MLEFT = 26, MRIGHT = 26;
  const W = MLEFT + w + MRIGHT, Ht = y0pad() + h + 34;
  const x0 = MLEFT, y0 = y0pad();
  const boxY = y0;
  const boxH = legs ? h - BP_LEG_H * s : h;
  let g = _bpSvgOpen(W, Ht, uid, "نمای جانبی");

  g += _bpRect(x0, boxY, w, boxH, { fill: "none", stroke: BP.ink, sw: 2 });
  /* پاخورِ فرورفته — زیرِ جعبه */
  if (legs) {
    const kbY = boxY + boxH;
    g += _bpRect(x0 + w * 0.3, kbY, w * 0.55, BP_LEG_H * s - 1, { fill: BP.fillDeep, stroke: BP.inkThin, sw: 1.2 });
  }

  /* صفحه‌ی در — نوارِ ضخیم جلو */
  g += _bpRect(x0 + w - BP_WALL * s, boxY, BP_WALL * s, boxH, { fill: BP.fillDeep, stroke: BP.inkThin, sw: 1 });
  /* دستگیره — بیرون‌زدگی جلو */
  g += `<rect x="${x0 + w - 2}" y="${boxY + boxH * 0.3}" width="4" height="${Math.min(boxH * 0.4, 14)}" rx="2" fill="${BP.inkThin}"/>`;

  /* طبقات: خطوطِ خط‌چین (پشتِ در دیده نمی‌شوند ولی نقشه باید بداند) */
  if (shelves > 0) {
    for (let k = 1; k <= shelves; k++) {
      const sy = boxY + (boxH * k) / (shelves + 1);
      g += `<line x1="${x0 + 2}" y1="${sy}" x2="${x0 + w - BP_WALL * s - 2}" y2="${sy}" stroke="${BP.inkFaint}" stroke-width="1.2" stroke-dasharray="5 4"/>`;
    }
  }
  /* فیبر پشت */
  g += _bpRect(x0, boxY, Math.max(2, 0.3 * s), boxH, { fill: BP.fill, stroke: BP.inkFaint, sw: 1 });

  g += `<text x="${W - 8}" y="${y0 + 16}" text-anchor="end" fill="${BP.accent}" font-size="12" font-weight="700">جانبی</text>`;
  g += _bpDimH(uid, x0, x0 + w, y0 + h + 14, `عمق ${_bpFmt(D)} سم`);
  g += `</svg>`;
  return g;
}

/* --------------------------- نمای از بالا --------------------------- */
function bpTopSVG(u) {
  const { L, D, legs } = _bpClampDims(u);
  const uid = ++_bpUid;
  const s = Math.max(1.1, Math.min(4.6, 220 / Math.max(D, 20), 460 / L));
  const w = L * s, h = Math.max(D, 20) * s;
  const MLEFT = 26, MRIGHT = 12;
  const W = MLEFT + w + MRIGHT, Ht = y0pad() + h + 34;
  const x0 = MLEFT, y0 = y0pad();
  let g = _bpSvgOpen(W, Ht, uid, "نمای از بالا");

  g += _bpRect(x0, y0, w, h, { fill: "none", stroke: BP.ink, sw: 2 });
  /* جلوِ یونیت = پایینِ نقشه؛ صفحه‌ی در جلو */
  g += _bpRect(x0, y0 + h - BP_WALL * s, w, BP_WALL * s, { fill: BP.fillDeep, stroke: BP.inkThin, sw: 1 });
  /* دیوار (پشت) هشورِ خطی */
  g += `<line x1="${x0}" y1="${y0}" x2="${x0 + w}" y2="${y0}" stroke="${BP.inkFaint}" stroke-width="3" stroke-dasharray="2 3"/>`;

  g += `<text x="${W - 8}" y="${y0 + 15}" text-anchor="end" fill="${BP.accent}" font-size="12" font-weight="700">از بالا</text>`;
  g += _bpDimH(uid, x0, x0 + w, y0 + h + 14, `طول ${_bpFmt(L)} سم`);
  g += _bpDimV(uid, y0, y0 + h, 14, `عمق ${_bpFmt(D)} سم`);
  g += `</svg>`;
  return g;
}

/* --------------------------- کلاهکِ DOM --------------------------- */

/** عنوانِ خوانا برای هدرِ مودال */
function bpUnitTitle(u) {
  const type = (typeof UNIT_TYPES !== "undefined" && UNIT_TYPES[u.unit_type]) || u.unit_type || "یونیت";
  const qty = Math.max(1, Math.round(_bpN(u.qty, 1)));
  const label = (u.label || "").trim() || type;
  return `${_bpEsc(label)} — ${_bpEsc(type)}${qty > 1 ? ` × ${fa(qty)}` : ""}`;
}

/**
 * پرکردن مودال نمای فنی برای یونیتِ شاخصِ ui از بخشِ جاریِ ویرایشگر.
 * مقادیرِ هنوز ذخیره‌نشده هم دیده می‌شوند (readEditorFieldsInto قبلش صدا زده می‌شود).
 */
function openBlueprintModal(ui) {
  if (typeof openModal !== "function" || typeof curPage !== "function") return;
  const pg = curPage();
  const u = pg && pg.units ? pg.units[ui] : null;
  if (!u) return;
  if (typeof readEditorFieldsInto === "function") {
    try { readEditorFieldsInto(state.editingProject); } catch (e) { /* بی‌خطر */ }
  }
  const unit = curPage().units[ui];            /* پس از خواندنِ فیلدها، مقدارِ زنده */
  if (!unit) return;

  const front = bpFrontSVG(unit);
  const side = bpSideSVG(unit);
  const top = bpTopSVG(unit);

  el("bpTitle").innerHTML = bpUnitTitle(unit);
  const { shelves, qty } = _bpClampDims(unit);
  const doorsN = (unit.doors || []).reduce((a, d) => a + Math.round(_bpN(d.qty, 0)), 0);
  const drawersN = (unit.drawers || []).reduce((a, d) => a + Math.round(_bpN(d.qty, 0)), 0);
  el("bpMeta").innerHTML = `
    <span class="bp-chip">درها: <b>${fa(doorsN * qty)}</b></span>
    <span class="bp-chip">کشوها: <b>${fa(drawersN * qty)}</b></span>
    <span class="bp-chip">طبقات: <b>${fa(shelves)}</b></span>
    ${qty > 1 ? `<span class="bp-chip warn">تعداد: <b>${fa(qty)} نسخه</b> — هر نسخه همین نقشه را دارد</span>` : ""}`;
  el("bpViews").innerHTML = `
    <figure class="bp-fig bp-front">${front}<figcaption>نمای روبه‌رو</figcaption></figure>
    <div class="bp-pair">
      <figure class="bp-fig">${side}<figcaption>نمای جانبی</figcaption></figure>
      <figure class="bp-fig">${top}<figcaption>نمای از بالا</figcaption></figure>
    </div>
    <p class="tiny muted bp-note">
      این نقشه از همان ردیف‌هایی ساخته می‌شود که فاکتور از روی آن‌ها حساب شده است —
      درها و کشوها به‌ترتیبِ تب «درها/کشوها» چیده شده‌اند. برای تغییر ظاهر، همان‌جا
      ابعاد و تعداد را عوض کنید؛ این نقشه بلافاصله عوض می‌شود.
      خطِ خط‌چین در نمای جانبی = طبقه؛ ابعاد به سانتی‌متر است.
    </p>`;

  openModal("blueprint");
}

/** چاپِ فقط نقشه — پنجره‌ی جدید با خودِ SVGها */
function printBlueprint() {
  const views = el("bpViews");
  const title = el("bpTitle") ? el("bpTitle").textContent : "نمای فنی";
  if (!views) return;
  const w = window.open("", "_blank", "width=980,height=720");
  if (!w) { toast("مرورگر اجازه‌ی پنجره‌ی جدید نداد — از تنظیمات مرورگر اجازه بدهید.", "warn"); return; }
  w.document.write(`<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8">
<title>${_bpEsc(title)} — نمای فنی</title>
<style>
  body{font-family:Vazirmatn,Tahoma,sans-serif;margin:1.2rem;color:#123}
  h2{margin:0 0 .8rem}
  .bp-fig{margin:0 0 1rem;page-break-inside:avoid}
  .bp-fig svg{width:100%;height:auto}
  figcaption{font-size:.85rem;color:#567;margin-top:.3rem}
  .bp-pair{display:flex;gap:1rem}.bp-pair figure{flex:1}
  @media print{.bp-pair{display:flex}}
</style></head><body>
<h2>${_bpEsc(title)}</h2>
${views.querySelector(".bp-front") ? views.querySelector(".bp-front").outerHTML : ""}
${views.querySelector(".bp-pair") ? views.querySelector(".bp-pair").outerHTML : ""}
</body></html>`);
  w.document.close();
  try { w.focus(); w.print(); } catch (e) { /* کاربر خودش Ctrl+P می‌زند */ }
}

/* export برای تست‌های Node — در مرورگر بی‌اثر */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { bpFrontSVG, bpSideSVG, bpTopSVG, bpUnitTitle, BP };
}
