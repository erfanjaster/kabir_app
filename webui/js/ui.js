/* ==========================================================================
   کبیر ۲ — ui.js
   رندرها، ویرایشگر پروژه، فاکتور، تنظیمات و سیم‌کشی رویدادها.
   حالت متصل: داده از API (kabir/web/server.py) و محاسبه با موتور واقعی.
   حالت نمایشی: داده‌های نمونه و موتور محلی (engine.js) — بدون سرور.
   ========================================================================== */
"use strict";

/* ------------------------------------------------------------- توست و مودال
   ★ لایه‌ی «مودال و فرم» به فایلِ اختصاصیِ js/ui-modal.js منتقل شد:
   توست، busy()، پشته‌ی مودال‌ها، تشخیصِ تغییراتِ ذخیره‌نشده، تله‌ی فوکوس،
   قراردادِ Enter/Ctrl+S/Esc و مودالِ تأییدِ Promise‑محور.
   دلیل: یک مکانیزمِ مشترک برای همه‌ی ۱۰ مودال و ۶ فرم، به‌جای ۲۰ نقطه‌ی
   پراکنده‌ی خروجِ بی‌قید. (نگاه کنید به docs/UX_AUDIT_v1.md — C‑1 تا C‑6)   */

/* ------------------------------------------------------------------ مرتب‌سازی جدول‌ها */
const SORT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m6 11 6-6 6 6"/></svg>`;

function thSort(tableKey, key, label, extra) {
  const st = state.sort[tableKey];
  const cls = "sortable" + (st && st.key === key ? " sorted" + (st.dir < 0 ? " desc" : "") : "");
  return `<th class="${cls}" data-sortkey="${key}" ${extra || ""} title="مرتب‌سازی بر اساس ${label}">${label}<span class="sort-ic">${SORT_ICON}</span></th>`;
}

function cmpVals(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "fa");
}

function applySort(rows, tableKey, getters) {
  const st = state.sort[tableKey];
  if (!st || !getters[st.key]) return rows;
  const g = getters[st.key];
  return rows.slice().sort((x, y) => cmpVals(g(x), g(y)) * st.dir);
}

function wireTableSort(tableEl, tableKey, rerender) {
  if (!tableEl) return;
  tableEl.addEventListener("click", (e) => {
    const th = e.target.closest("th.sortable");
    if (!th || !tableEl.contains(th)) return;
    const st = state.sort[tableKey];
    const k = th.dataset.sortkey;
    if (st.key === k) st.dir = -st.dir;
    else { st.key = k; st.dir = 1; }
    rerender();
  });
}

const MAT_SORT = {
  id: (m) => m.id, name: (m) => m.name, cat: (m) => catLabel(m.cat),
  price: (m) => m.price, supplier: (m) => m.supplier || "",
};
const PROJ_SORT = {
  id: (p) => p.id, code: (p) => p.code, title: (p) => p.title,
  customer: (p) => p.customer || "", status: (p) => p.status,
  date: (p) => p.date || "", final: (p) => p.final_price || 0,
};
const ARCH_SORT = {
  id: (a) => a.id, number: (a) => a.number, kind: (a) => a.kind_label || "",
  project: (a) => a.project || "", customer: (a) => a.customer || "",
  date: (a) => a.date || "", amount: (a) => a.amount || 0,
};

/* ------------------------------------------------------------------ شمارنده‌ی متحرک */
function countUp(node, target, fmtFn) {
  if (!node) return;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const from = Number(node.dataset.v || 0);
  node.dataset.v = String(target);
  if (reduce || from === target) { node.innerHTML = fmtFn(target); return; }
  const t0 = performance.now(), dur = 650;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    node.innerHTML = fmtFn(from + (target - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ------------------------------------------------------------------ ساعت نوار بالا */
function startClock() {
  const tick = () => {
    const d = el("clockTime");
    if (!d) return;
    try { d.textContent = new Date().toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }); }
    catch (e) { d.textContent = ""; }
    const dt = el("clockDate");
    if (dt) dt.textContent = TODAY_FA || "";
  };
  tick();
  setInterval(tick, 20000);
}

/* ------------------------------------------------------------------ پوسته */
function applyTheme(theme, silent) {
  document.documentElement.dataset.theme = theme;
  el("btnTheme").innerHTML = theme === "dark" ? ICONS.sun : ICONS.moon;
  $$("#setTheme button").forEach((b) => b.classList.toggle("active", b.dataset.themeV === theme));
  SETTINGS.theme = theme;
  storeSet("kabir-theme", theme);
  if (API.ok) { API.req("PUT", "/api/settings", { settings: { theme } }).catch(() => {}); }
  if (!silent) toast(theme === "dark" ? "پوسته‌ی تاریک فعال شد" : "پوسته‌ی روشن فعال شد");
}

/* ------------------------------------------------------------------ ناوبری */
const PAGES = {
  dashboard: ["داشبورد", "نمای کلی کارگاه و پروژه‌ها"],
  projects: ["پروژه‌ها", "تعریف پروژه‌ی ترکیبی، محاسبه‌ی دقیق و صدور فاکتور"],
  materials: ["متریال و خدمات", "کتابخانه‌ی قیمت‌ها برای استفاده‌ی همیشگی"],
  styles: ["سبک‌ها", "ترکیب‌های آماده‌ی متریال برای فراخوانی سریع در پروژه"],
  invoice: ["فاکتور", "پیش‌نمایش، چاپ، PDF و اکسل — نسخه‌ی داخلی یا مشتری"],
  settings: ["تنظیمات", "اطلاعات فروشگاه، پیش‌فرض‌های محاسبه و پشتیبان‌گیری"],
};

/* نامِ داخلی: ناوبریِ «واقعی». تابعِ navigate که بقیه‌ی برنامه صدا می‌کنند
   یک لایه گاردِ «تغییرات ذخیره‌نشده» دورِ آن دارد (پایین‌تر را ببینید).      */
function navigateNow(page, sub, silentScroll) {
  state.page = page;
  MODAL_KEYS.currentPage = page;
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === "page-" + page));
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  const [t, s] = PAGES[page] || PAGES.dashboard;
  el("pageTitle").textContent = t;
  el("pageSub").textContent = s;
  document.body.classList.remove("nav-open");
  if (!silentScroll) window.scrollTo({ top: 0, behavior: "smooth" });
  try { history.replaceState(null, "", "#/" + page + (sub ? "/" + sub : "")); } catch (e) { /* sandbox */ }
  if (page === "invoice") {
    renderInvRowChecks();
    refreshInvoice().catch((err) => toast("خطا در پیش‌نمایش فاکتور: " + esc(err.message), "error"));
  }
}

/* ------------------------------------------------------ تأیید و گاردهای خروج
   لایه‌ی اصلی در js/ui-modal.js است (پشته‌ی مودال، Dirty Check، کلیدها).
   این دو تابع فقط «پل» هستند تا ۱۴ نقطه‌ی فراخوانیِ موجود دست‌نخورده بمانند. */

/** پرسشِ تأییدِ عملیات — لحنِ پیش‌فرض «خطرناک» است (حذف و جایگزینی داده) */
function askConfirm(text, cb, title, okLabel) {
  confirmAction(text, cb, { title, okLabel, tone: "danger" });
}

/** پرسشِ اطلاع‌رسانی که به «ادامه» نیاز دارد — بدونِ رنگِ خطر.
 *  قبلاً خطای ۴۰۹ سرور هم با دکمه‌ی قرمزِ «حذف» نشان داده می‌شد و کاربر
 *  شرطی می‌شد که قرمز = ادامه؛ این همان ثباتِ رویه‌ای است که قانون می‌خواهد. */
function askInfo(text, cb, title, okLabel) {
  confirmAction(text, cb, { title, okLabel, tone: "neutral" });
}

/* گاردِ «ویرایشگر پروژه»: اگر داده‌ی ذخیره‌نشده باشد، خروج از صفحه باید
   یا با ذخیره انجام شود یا با پرسشِ صریح از کاربر.                              */
let _navLeaving = false;
let _saveGuardBusy = false;
/* ★ سیاستِ سخت‌گیرانه (به درخواستِ کارفرما):
   تا وقتی ویرایشگر داده‌ی ذخیره‌نشده دارد، **هیچ** خروجی بی‌صدا انجام نمی‌شود —
   نه با کلیکِ منو، نه با Alt+1..6، نه با جست‌وجو. هر بار صریحاً می‌پرسیم و
   سه کنشِ ثابت می‌دهیم:
     «ذخیره و رفتن» (سبز، امن)  •  «دور ریختن و رفتن» (قرمز، خطرناک)
     «ماندن» / Esc              (بازگشت به کار)
   دلیل: در نرم‌افزارِ صنعتی، «ذخیره‌ی بی‌صدا» همان‌قدر خطرناک است که «دور
   ریختنِ بی‌صدا» — چون اپراتور نمی‌داند کدام نسخه روی سرور نشسته است.         */
async function editorExitGuard(ctx) {
  if (_navLeaving || _saveGuardBusy) return null;
  if (!state.editingProject || !state.dirty) return null;
  /* ویرایشگر «داخلِ» صفحه‌ی پروژه‌هاست؛ پس جابه‌جایی در همان صفحه (مثلاً
     Alt+2) داده‌ای را گم نمی‌کند و نباید مزاحم کاربر شود.                    */
  const to = ctx && ctx.to;
  if (!to || to === "projects") return null;
  _saveGuardBusy = true;
  try {
    const leave = await confirmDiscard(
      "ویرایشگر پروژه تغییراتِ <b>ذخیره‌نشده</b> دارد.<br>" +
      "پیش از رفتن از این صفحه تکلیفشان را روشن کنید.",
      {
        title: "ترکِ ویرایشگر با داده‌ی ذخیره‌نشده",
        okLabel: "دور ریختن و رفتن",
        okTone: "danger",
        altLabel: "ذخیره و رفتن",
        altTone: "success",
        cancelLabel: "ماندن و ادامه‌ی ویرایش",
        onAlt: async () => {
          const saver = MODAL_KEYS.saveActiveContext || (() => saveProject());
          const ok = await saver();
          if (ok === false) return;           /* خطا قبلاً گزارش شده — بمان */
          forceCloseEditor();
          _navLeaving = true;
          try { navigateNow(to); } finally { _navLeaving = false; }
        },
      });
    if (leave) { forceCloseEditor(); return null; }
    /* «ماندن» → ویرایشگر جلوی چشم کاربر باشد تا ادامه دهد */
    if (state.page !== "projects") navigateNow("projects");
    el("projectEditor").scrollIntoView({ block: "start" });
    return false;
  } finally { _saveGuardBusy = false; }
}

/** بستنِ ویرایشگر بدونِ پرسش — فقط از مسیرهایی که تکلیفِ داده روشن شده */
function forceCloseEditor() {
  if (state.editingProject) clearDraft(state.editingProject.id);
  clearTimeout(_draftTimer);
  state.editingProject = null;
  state.dirty = false;
  paintDirtyState2();
  el("projectEditor").hidden = true;
  undoReset();
}

/** ناوبریِ محافظت‌شده: هر کلیکِ منو، Alt+1..6، جست‌وجو و hash از این‌جا می‌گذرد */
async function navigate(page, sub, silentScroll) {
  if (state.page === page && !sub) { navigateNow(page, sub, silentScroll); return; }
  if (anyModalOpen()) await requestCloseModal();     /* مودالِ کثیف = هشدارِ ذخیره */
  /* گاردها: ویرایشگرِ کثیف، و هر زمینه‌ی دیگری که بعداً ثبت شود */
  if (!(await allowLeave({ to: page, from: MODAL_KEYS.currentPage }))) return;
  _navLeaving = true;
  try { navigateNow(page, sub, silentScroll); }
  finally { _navLeaving = false; }
}

/* ============================================================== داشبورد */
function buildDash() {
  if (API.ok && DASH) {
    const b = DASH.by_status || {};
    return {
      projects: DASH.projects,
      sub: `${fa(b.open || 0)} در جریان • ${fa(b.draft || 0)} پیش‌نویس • ${fa(b.done || 0)} انجام‌شده`,
      sales: DASH.month_amount, growth: DASH.month_growth,
      profit: DASH.profit, materials: DASH.materials,
      chart: (DASH.monthly || []).map((m) => ({ label: m.label, v: scaled(m.amount) / 1e6 })),
      recent: DASH.recent_projects || [],
      changes: (HISTORY || []).slice(0, 5),
    };
  }
  const by = { draft: 0, open: 0, done: 0, canceled: 0 };
  PROJECTS.forEach((p) => { by[p.status] = (by[p.status] || 0) + 1; });
  const arr = SALES_DEMO;
  const last = arr[arr.length - 1] || { amount: 0 };
  const prev = arr[arr.length - 2] || { amount: 0 };
  const growth = prev.amount ? ((last.amount - prev.amount) / prev.amount) * 100 : 0;
  const profit = PROJECTS.filter((p) => p.status !== "canceled")
    .reduce((a, p) => a + (p.final_price - p.total_cost), 0);
  return {
    projects: PROJECTS.length,
    sub: `${fa(by.open)} در جریان • ${fa(by.draft)} پیش‌نویس • ${fa(by.done)} انجام‌شده`,
    sales: last.amount, growth, profit, materials: MATERIALS.length,
    chart: arr.map((s) => ({ label: s.label, v: scaled(s.amount) / 1e6 })),
    recent: PROJECTS.slice(0, 4).map((p) => ({
      id: p.id, title: p.title, customer: p.customer, code: p.code,
      date: p.date, status: p.status, final_price: p.final_price,
    })),
    changes: (HISTORY || []).slice(0, 5),
  };
}

function renderDashboard() {
  const d = buildDash();
  countUp(el("statProjects"), d.projects, (v) => fa(Math.round(v)));
  el("statProjectsSub").textContent = d.sub;
  countUp(el("statSales"), d.sales, (v) => `${fmt(scaled(v) / 1e6)} <small>میلیون ${CUR.name}</small>`);
  const tr = el("statSalesTrend");
  tr.className = "stat-trend " + (d.growth >= 0 ? "up" : "down");
  tr.textContent = (d.growth >= 0 ? "▲ +" : "▼ ") + fmt(Math.abs(d.growth), true) + "٪";
  countUp(el("statProfit"), d.profit, (v) => `${fmt(scaled(v) / 1e6)} <small>میلیون ${CUR.name}</small>`);
  countUp(el("statMaterials"), d.materials, (v) => fa(Math.round(v)));
  const act = MATERIALS.filter((m) => m.active).length;
  el("statMaterialsSub").textContent = `در ${fa(CATS.length)} دسته‌بندی • ${fa(act)} قلم فعال`;
  el("chartUnit").textContent = `میلیون ${CUR.name}`;

  const chart = d.chart.length ? d.chart : [{ label: "—", v: 0 }];
  const max = Math.max(...chart.map((c) => c.v), 1);
  el("salesChart").innerHTML = chart.map((c, i) => `
    <div class="chart-col${i === chart.length - 1 ? " hl" : ""}">
      <div class="chart-bar-wrap">
        <div class="chart-bar" style="height:${Math.max(4, (c.v / max) * 100)}%;animation-delay:${i * 60}ms">
          <span class="chart-tip">${fmt(c.v, 1)} میلیون ${CUR.name}</span>
        </div>
      </div>
      <span class="chart-label">${esc(c.label)}</span>
    </div>`).join("");
  el("chartBadge").textContent = chart.length > 1
    ? `رشد ${fmt(d.growth, true)}٪ نسبت به ماه قبل` : "";

  el("recentProjects").innerHTML = d.recent.length ? d.recent.map((p) => `
    <button class="mini-item" type="button" data-open-project="${p.id}">
      <span class="mi-main">
        <span class="mi-title">${esc(p.customer)} — ${esc(p.title)}</span>
        <span class="mi-sub">${esc(p.code)} • ${esc(p.date)}</span>
      </span>
      <span class="badge ${STATUS_CLASS[p.status] || "b-draft"}">${STATUS_LABEL[p.status] || p.status}</span>
      <span class="mi-side"><span class="mi-amount">${p.status === "canceled" ? "—" : fmt(scaled(p.final_price))}</span></span>
    </button>`).join("")
    : `<div class="empty">${ICONS.inbox}<div>هنوز پروژه‌ای ندارید — از دکمه‌ی «پروژه‌ی جدید» شروع کنید.</div></div>`;

  el("priceChanges").innerHTML = d.changes.length ? d.changes.map((h) => {
    const pct = h.pct !== undefined ? h.pct : (h.old ? ((h.price - h.old) / h.old) * 100 : 0);
    const cls = pct > 0 ? "price-up" : "price-down";
    return `<div class="mini-item" style="cursor:default">
      <span class="mi-main">
        <span class="mi-title">${esc(h.name)}</span>
        <span class="mi-sub">${esc(h.date)} • ${esc(h.reason || "")}</span>
      </span>
      <span class="mi-side">
        <span class="${cls}">${pct > 0 ? "+" : ""}${fmt(pct, true)}٪</span><br>
        <span class="mi-amount" style="font-size:.75rem">${fmt(scaled(h.price))}</span>
      </span>
    </div>`;
  }).join("") : `<div class="empty">تغییری ثبت نشده است.</div>`;
}

/* ============================================================ متریال و خدمات */
function renderChips() {
  const counts = {};
  MATERIALS.forEach((m) => { counts[m.cat] = (counts[m.cat] || 0) + 1; });
  let html = `<button type="button" class="chip${state.matCat === "all" ? " active" : ""}" data-cat="all">همه‌ی اقلام <span class="cnt">${fa(MATERIALS.length)}</span></button>`;
  html += CATS.filter((c) => counts[c[0]]).map(([k, label]) =>
    `<button type="button" class="chip${state.matCat === k ? " active" : ""}" data-cat="${k}">${esc(label)} <span class="cnt">${fa(counts[k])}</span></button>`
  ).join("");
  el("matChips").innerHTML = html;
  el("matCurBadge").textContent = `واحد پول: ${CUR.name}`;
}

function filteredMaterials() {
  const q = el("matSearch").value.trim();
  return MATERIALS.filter((m) =>
    (state.matCat === "all" || m.cat === state.matCat) &&
    (!q || m.name.includes(q) || (m.supplier || "").includes(q) || catLabel(m.cat).includes(q)));
}

/* ── ناوبریِ Tab در «ویرایش سریعِ قیمت» ────────────────────────────────────
   ثبتِ قیمت جدول را از نو می‌رندد و فوکوس را می‌کشد. این متغیر مقصدِ Tab را
   نگه می‌دارد تا بلافاصله پس از رندر، سلولِ بعدی باز و فوکوس شود — یعنی
   اپراتور می‌تواند ده‌ها نرخ را پشتِ سر هم و فقط با Tab به‌روز کند.          */
let _qpNavTarget = null;
function applyQuickPriceNav() {
  if (_qpNavTarget === null) return;
  const id = _qpNavTarget;
  _qpNavTarget = null;
  const cell = document.querySelector(`[data-quick-price="${id}"]`);
  if (!cell) return;
  if (cell.scrollIntoView) cell.scrollIntoView({ block: "nearest" });
  /* همان مسیرِ کلیک — تا رفتارِ Tab و ماوس دقیقاً یکی بماند (ثباتِ رویه) */
  cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function renderMaterials() {
  renderChips();
  const rows = applySort(filteredMaterials(), "materials", MAT_SORT);
  if (!rows.length) {
    el("matTable").innerHTML = `<tbody><tr><td><div class="empty">${ICONS.inbox}<div>موردی یافت نشد.</div></div></td></tr></tbody>`;
  } else {
    el("matTable").innerHTML = `
      <thead><tr>
        ${thSort("materials", "id", "شناسه")}
        ${thSort("materials", "name", "نام")}
        ${thSort("materials", "cat", "دسته‌بندی")}
        <th>مشخصات</th><th>واحد</th>
        ${thSort("materials", "price", `قیمت (${CUR.name})`)}
        ${thSort("materials", "supplier", "تأمین‌کننده")}
        <th>وضعیت</th><th>عملیات</th>
      </tr></thead>
      <tbody>${rows.map((m) => `
        <tr>
          <td class="sub">${fa(m.id)}</td>
          <td><b>${esc(m.name)}</b>${m.note ? `<div class="sub">${esc(m.note)}</div>` : ""}</td>
          <td><span class="badge b-final" style="font-weight:500">${esc(catLabel(m.cat))}</span></td>
          <td class="sub nowrap">${m.thickness_mm ? fa(m.thickness_mm) + " میل" : "—"}${m.sheet_width_cm ? " • " + fa(m.sheet_width_cm) + "×" + fa(m.sheet_height_cm) : ""}${m.width_cm ? " • عرض " + fa(m.width_cm) : ""}</td>
          <td>${UNITS[m.unit] || m.unit}</td>
          <td class="num price-cell" data-quick-price="${m.id}" title="ویرایش سریعِ قیمت — کلیک کنید، عدد را بزنید، Enter">${fmt(m.price)}</td>
          <td class="sub">${esc(m.supplier || "—")}</td>
          <td>${m.active ? '<span class="badge b-done">فعال</span>' : '<span class="badge b-cancel">غیرفعال</span>'}</td>
          <td><div class="actions">
            ${iconBtn("", "edit", "ویرایش", `data-edit-mat="${m.id}"`)}
            ${iconBtn("", "power", m.active ? "غیرفعال‌سازی" : "فعال‌سازی", `data-toggle-mat="${m.id}"`)}
            ${iconBtn("del", "trash", "حذف", `data-del-mat="${m.id}"`)}
          </div></td>
        </tr>`).join("")}
      </tbody>`;
  }
  el("matCount").innerHTML = `${fa(rows.length)} قلم نمایش داده شد${rows.length !== MATERIALS.length ? ` از ${fa(MATERIALS.length)}` : ""}`;
  /* ناوبریِ Tab باید «پس از» نشستنِ DOMِ تازه اجرا شود؛ اگر پیش از آن باشد،
     همان innerHTMLِ پایین ویرایشگرِ تازه‌بازشده را پاک می‌کند.              */
  applyQuickPriceNav();
}

function renderHistory() {
  const rows = HISTORY || [];
  el("historyTable").innerHTML = rows.length ? `
    <thead><tr><th>تاریخ</th><th>قلم</th><th>قیمت قبل</th><th>قیمت جدید</th><th>درصد تغییر</th><th>دلیل</th></tr></thead>
    <tbody>${rows.map((h) => `
      <tr>
        <td class="sub nowrap">${esc(h.date)}</td>
        <td><b>${esc(h.name)}</b></td>
        <td class="num" style="color:var(--text-3)">${fmt(scaled(h.old))}</td>
        <td class="num">${fmt(scaled(h.price))}</td>
        <td><span class="${h.pct > 0 ? "price-up" : "price-down"}">${h.pct > 0 ? "+" : ""}${fmt(h.pct, true)}٪</span></td>
        <td class="sub">${esc(h.reason || "—")}</td>
      </tr>`).join("")}
    </tbody>`
    : `<tbody><tr><td><div class="empty">تاریخچه‌ای ثبت نشده است.</div></td></tr></tbody>`;
}

/* ================================================================== سبک‌ها */
const STYLE_FIELDS = [
  ["body", "بدنه"], ["door", "ورق در"], ["back", "فیبر پشت"], ["banding", "نوار"],
  ["hinge", "لولا"], ["handle", "دستگیره"], ["leg", "پایه"], ["shelf_pin", "خار طبقه"],
  ["countertop", "صفحه"], ["door_model", "اجرت/مدل در"], ["slide", "ریل کشو"],
  ["drawer_sheet", "ورق جعبه‌ی کشو"], ["crown", "تاج"], ["underlight", "زیرچراغ"],
  ["kickboard", "پاخور"],
];
const STYLE_SELECTS = {
  sfBody: ["body", "body_sheet"], sfDoor: ["door", "door_sheet"], sfBack: ["back", "back_sheet"],
  sfBanding: ["banding", "banding"], sfHinge: ["hinge", "hinge"], sfHandle: ["handle", "handle"],
  sfLeg: ["leg", "leg"], sfShelfPin: ["shelf_pin", "shelf_pin"], sfCountertop: ["countertop", "countertop"],
  sfDoorModel: ["door_model", "door_model"], sfSlide: ["slide", "drawer_slide"],
  sfDrawerSheet: ["drawer_sheet", "drawer_sheet"], sfCrown: ["crown", "crown"],
  sfUnderlight: ["underlight", "underlight"], sfKickboard: ["kickboard", "kickboard"],
};

function matOptions(cat, selectedName, withNone) {
  const names = catNames(cat);
  return (withNone ? `<option value="">— هیچ —</option>` : "") +
    names.map((n) => `<option value="${esc(n)}"${n === selectedName ? " selected" : ""}>${esc(n)}</option>`).join("");
}

function fillStyleSelects() {
  for (const [id, [, cat]] of Object.entries(STYLE_SELECTS)) {
    const sel = el(id);
    const cur = sel.value;
    sel.innerHTML = matOptions(cat, null, true);
    if (cur) sel.value = cur;
  }
  el("mfCat").innerHTML = CATS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("");
}

function renderStyles() {
  const max = 20;
  el("stylesLimitNote").textContent = `حداکثر ${fa(max)} سبک — ${fa(STYLES.length)} تعریف‌شده.`;
  el("stylesGrid").innerHTML = STYLES.map((st) => {
    const rows = STYLE_FIELDS.filter(([k]) => st.data && st.data[k]).slice(0, 8);
    const more = STYLE_FIELDS.filter(([k]) => st.data && st.data[k]).length - rows.length;
    return `
    <div class="style-card">
      <div class="style-head">
        <span class="st-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.9 5.6 5.6 1.9-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9z"/></svg></span>
        <div><h4>${esc(st.name)}</h4><p>${esc(st.note || "")}</p></div>
      </div>
      <div class="style-body">
        ${rows.map(([k, label]) => `<div class="style-row"><span class="k">${label}:</span><span class="v">${esc(st.data[k])}</span></div>`).join("")}
        ${more > 0 ? `<div class="style-row"><span class="k"></span><span class="v tiny muted">+ ${fa(more)} مورد دیگر</span></div>` : ""}
        ${st.data && st.data.waste_percent ? `<div class="style-row"><span class="k">پرت/سربار:</span><span class="v tiny">${fa(st.data.waste_percent)}٪ / ${fa(st.data.overhead_percent || 0)}٪</span></div>` : ""}
      </div>
      <div class="style-foot">
        <button class="btn primary sm" data-use-style="${st.id}" type="button">استفاده در پروژه</button>
        <button class="btn ghost sm" data-edit-style="${st.id}" type="button" title="ویرایش">ویرایش</button>
        <button class="btn ghost sm" data-copy-style="${st.id}" type="button" title="کپی">کپی</button>
        <button class="btn ghost sm" data-del-style="${st.id}" type="button" title="حذف">حذف</button>
      </div>
    </div>`;
  }).join("") + `
    <div class="style-card" style="border-style:dashed;box-shadow:none">
      <button class="btn ghost" data-new-style type="button" style="margin:2.2rem 1.1rem;flex:1;border-style:dashed">
        ＋ تعریف سبک جدید
      </button>
    </div>`;
}

/* ================================================================= پروژه‌ها */
/* بنر هشدار «پروژه‌های مانده با نرخ قدیمی» */
function renderStaleBanner() {
  const b = el("staleBanner");
  if (!b) return;
  const stale = API.ok ? PROJECTS.filter((p) => p.stale && p.status !== "canceled") : [];
  b.hidden = !stale.length;
  if (stale.length) {
    const n = el("staleCount");
    if (n) n.textContent = fa(stale.length);
  }
}

/* ادغام فهرست سبک پروژه‌ها (فقط فیلدهای مالی) بدون دست‌زدن به پروژه‌ی
   در حال ویرایش — پس از به‌روزرسانی نرخ متریال، سرور این فهرست را برمی‌گرداند */
function mergeProjectsLight(list) {
  if (!Array.isArray(list) || !list.length) return 0;
  let n = 0;
  for (const q of list) {
    const p = PROJECTS.find((x) => x.id === Number(q.id));
    if (!p) continue;
    if (q.final_price !== undefined) p.final_price = q.final_price;
    if (q.total_cost !== undefined) p.total_cost = q.total_cost;
    if (q.rates_rev !== undefined) p.rates_rev = q.rates_rev;
    if (q.stale !== undefined) p.stale = q.stale;
    n++;
  }
  return n;
}

/* پاسخِ رویدادهای تغییر نرخ متریال را روی کل رابط اعمال می‌کند */
function ingestPriceRefresh(resp) {
  if (!resp || !Array.isArray(resp.projects)) return 0;
  const n = mergeProjectsLight(resp.projects);
  if (resp.dashboard) DASH = resp.dashboard;
  renderProjects();
  renderDashboard();
  fillInvoiceProjects();
  return resp.recalced !== undefined ? resp.recalced : n;
}

function renderProjects() {
  renderStaleBanner();
  const q = el("projSearch").value.trim();
  const f = el("projFilter").value;
  const rows = applySort(PROJECTS.filter((p) =>
    (f === "all" || p.status === f) &&
    (!q || p.title.includes(q) || (p.customer || "").includes(q) || p.code.includes(q))),
    "projects", PROJ_SORT);
  if (!rows.length) {
    el("projectsTable").innerHTML = `<tbody><tr><td><div class="empty">${ICONS.inbox}<div>پروژه‌ای یافت نشد.</div></div></td></tr></tbody>`;
    return;
  }
  el("projectsTable").innerHTML = `
    <thead><tr>
      ${thSort("projects", "code", "کد")}
      ${thSort("projects", "title", "عنوان")}
      ${thSort("projects", "customer", "مشتری")}
      ${thSort("projects", "status", "وضعیت")}
      <th>سبک</th>
      ${thSort("projects", "date", "تاریخ")}
      ${thSort("projects", "final", `مبلغ نهایی (${CUR.name})`)}
      <th>عملیات</th>
    </tr></thead>
    <tbody>${rows.map((p) => {
      const amt = p.final_price || (p.status !== "canceled" ? calcProjectLocal(p).final_price : 0);
      return `<tr>
        <td class="sub nowrap ltr">${esc(p.code)}</td>
        <td><b>${esc(p.title)}</b></td>
        <td>${esc(p.customer || "—")}</td>
        <td><span class="badge ${STATUS_CLASS[p.status] || "b-draft"}">${STATUS_LABEL[p.status] || p.status}</span></td>
        <td class="sub">${esc(p.style || (p.pages[0] && p.pages[0].style_name) || "—")}</td>
        <td class="sub nowrap">${esc(p.date || "")}</td>
        <td class="num">${p.status === "canceled" ? "—" : fmt(scaled(amt))}${
          p.stale && API.ok && p.status !== "canceled"
            ? `<div><span class="badge b-warn" title="قیمت متریال تغییر کرده — این پروژه با نرخ قدیمی محاسبه شده. از نوار بالا «بازمحاسبه‌ی همه» را بزنید یا پروژه را باز و ذخیره کنید.">نرخ قدیمی</span></div>`
            : ""
        }</td>
        <td><div class="actions">
          ${iconBtn("", "eye", "بازکردن", `data-open-project="${p.id}"`)}
          ${iconBtn("", "invoice", "صدور فاکتور", `data-invoice-project="${p.id}"`)}
          ${iconBtn("del", "trash", "حذف", `data-del-project="${p.id}"`)}
        </div></td>
      </tr>`;
    }).join("")}
    </tbody>`;
}

/* ------------------------------------------------------------ ویرایشگر */
function curPage() {
  const p = state.editingProject;
  if (!p) return null;
  state.pageIdx = Math.min(state.pageIdx, p.pages.length - 1);
  return p.pages[state.pageIdx];
}

function matSelect(cat, selectedId, attrs) {
  const mats = MATERIALS.filter((m) => m.cat === cat);
  return `<select class="cell-select" ${attrs}>
    <option value="0">—</option>
    ${mats.map((m) => `<option value="${m.id}"${Number(selectedId) === m.id ? " selected" : ""}>${esc(m.name)}${m.price ? ` — ${fmt(m.price)}` : ""}</option>`).join("")}
  </select>`;
}

function renderSectionPills() {
  const p = state.editingProject;
  if (!p) return;
  el("secPills").innerHTML = p.pages.map((pg, i) => `
    <button type="button" class="sec-pill${i === state.pageIdx ? " active" : ""}" data-sec="${i}">
      ${esc(pg.name || `بخش ${fa(i + 1)}`)}
      ${p.pages.length > 1 ? `<span class="pill-x" data-sec-del="${i}" title="حذف بخش">✕</span>` : ""}
    </button>`).join("") +
    `<button type="button" class="sec-pill sec-pill-add" id="btnAddSection2">＋ بخش</button>`;
}

function renderSectionBar() {
  const pg = curPage();
  if (!pg) return;
  el("secName").value = pg.name || "";
  el("secStyle").innerHTML =
    `<option value="0">— بدون سبک —</option>` +
    STYLES.map((s) => `<option value="${s.id}"${Number(pg.style_id) === s.id ? " selected" : ""}>✦ ${esc(s.name)}</option>`).join("");
  el("secWaste").value = fa(pg.waste_percent ?? 8);
  el("secOverhead").value = fa(pg.overhead_percent ?? 0);
  const firstCounter = (pg.units.find((u) => u.countertop_id) || {}).countertop_id || 0;
  el("secCounter").innerHTML =
    `<option value="0">— بدون صفحه —</option>` +
    MATERIALS.filter((m) => m.cat === "countertop").map((m) =>
      `<option value="${m.id}"${Number(firstCounter) === m.id ? " selected" : ""}>${esc(m.name)}</option>`).join("");
  el("secCounterLm").value = pg.countertop_lm ? fa(pg.countertop_lm) : "";
  if (el("secWallLen")) el("secWallLen").value = pg.wall_length_cm ? fa(Math.round((+pg.wall_length_cm / 100) * 100) / 100) : "";
  el("facadeMode").value = pg.detail_mode || "none";
  el("facadeTotalWrap").classList.toggle("hidden", pg.detail_mode !== "total");
  el("facadeRowsWrap").classList.toggle("hidden", pg.detail_mode !== "detailed");
  el("facadeTotalSqm").value = pg.detail_total_sqm ? fa(pg.detail_total_sqm) : "";
  el("facadeTotalPrice").value = pg.detail_price_per_sqm ? fmtInp(pg.detail_price_per_sqm) : "";
}

function unitArea(u) {
  const L = +u.length_cm || 0, H = +u.height_cm || 0, D = +u.depth_cm || 0;
  const t = (matById(u.body_id) || {}).thickness_mm || 0;
  const tc = t / 10;
  let a = 2 * (D / 100) * (H / 100);
  if (u.has_bottom_panel !== false) a += ((L - 2 * tc) / 100) * (D / 100);
  if (u.has_top_panel !== false && u.unit_type !== "ground") a += ((L - 2 * tc) / 100) * (D / 100);
  if (u.unit_type === "tall") a += ((L - 2 * tc) / 100) * (D / 100);
  if (+u.shelves > 0) a += (+u.shelves) * ((L - 2 * tc) / 100) * (D / 100);
  return a;
}

/* ================================================================ نوار متراژ
   کابینت‌کار دیوار را اندازه گرفته (مثلاً ۴٫۲۰ متر) و می‌خواهد همان‌طور که
   یونیت‌ها را وارد می‌کند ببیند چقدرش پر شده و چقدر مانده — بدون ماشین‌حساب. */
function renderDimRibbon() {
  const host = el("dimRibbon");
  if (!host) return;
  const pg = curPage();
  if (!pg) { host.innerHTML = ""; return; }

  let ground = 0, wall = 0, tall = 0, leaves = 0, drawers = 0;
  for (const u of pg.units || []) {
    const n = Math.max(1, Math.round(+u.qty || 1));
    const L = (+u.length_cm || 0) * n / 100;
    if (u.unit_type === "wall") wall += L;
    else if (u.unit_type === "tall") tall += L;
    else ground += L;
    leaves += (u.doors || []).reduce((a, d) => a + (+d.qty || 0), 0) * n;
    drawers += (u.drawers || []).reduce((a, d) => a + (+d.qty || 0), 0) * n;
  }
  const r = state.lastResult;
  const sheets = r && r.stats ? Math.round(r.stats.total_sheets || 0) : 0;

  const cell = (label, value, cls, title) =>
    `<span class="dim-cell${cls ? " " + cls : ""}"${title ? ` title="${title}"` : ""}>` +
    `<b>${value}</b>${label}</span>`;

  /* مقایسه با طول دیواری که اندازه گرفته شده */
  const wallCm = +pg.wall_length_cm || 0;
  let diffCell = "";
  if (wallCm > 0) {
    const filled = ground * 100;
    const diff = wallCm - filled;                      /* مثبت = جا مانده */
    const pct = Math.min(100, Math.round((filled / wallCm) * 100));
    const cls = Math.abs(diff) < 1 ? "ok" : (diff < 0 ? "over" : "under");
    const txt = Math.abs(diff) < 0.5
      ? "کامل پر شد"
      : (diff > 0 ? `${fmt(diff / 100, true)} متر جا مانده` : `${fmt(-diff / 100, true)} متر اضافه است!`);
    diffCell = `<span class="dim-cell dim-gauge ${cls}" title="مقایسه‌ی جمع طول یونیت‌های زمینی با طول دیواری که وارد کرده‌اید">
        <span class="gauge"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></span>
        <b>${txt}</b>دیوار ${fmt(wallCm / 100, true)} م</span>`;
  }

  /* ★ هشدارهای موتور محاسبه دیگر در مودالِ «ریز قیمت‌ها» پنهان نمی‌مانند —
     همان‌جا که کاربر دارد ابعاد را تایپ می‌کند، یک تراشه‌ی هشدار زنده
     ظاهر می‌شود (مثلاً «بدنه رایگان شد!» یا «تیکِ در از ورق بدنه نادیده
     گرفته شد»). کلیک = دیدنِ فهرست کامل هشدارها.                              */
  const warns = (r && r.warnings) || [];
  const warnCell = warns.length
    ? `<button class="dim-cell warn-chip" type="button" id="dimWarnChip" title="${esc(warns.slice(0, 3).join("\n"))}${warns.length > 3 ? "\n…" : ""}">⚠ <b>${fa(warns.length)}</b> هشدار محاسبه — ببینید</button>`
    : "";

  host.innerHTML =
    cell("متر طول زمینی", fmt(ground, true), "", "جمع طول یونیت‌های زمینی و کمد ایستاده") +
    cell("متر طول دیواری", fmt(wall, true)) +
    (tall ? cell("کمد ایستاده", fmt(tall, true)) : "") +
    cell("لنگه در", fa(leaves)) +
    cell("کشو", fa(drawers)) +
    (sheets ? cell("ورق لازم", fa(sheets), "accent", "تعداد ورق کاملی که باید بخرید — با تجمیع قطعات هم‌جنس محاسبه شده") : "") +
    warnCell +
    diffCell;
}

/* ============================================== ساخت/هم‌اندازه‌سازی خودکار در
   وقتی یونیت ۹۰ سانتی می‌سازم، خودم می‌دانم دو لنگه‌ی ۴۴٫۵ در ۶۹٫۷ می‌خواهد
   (با درز ۳ میلی‌متر). نرم‌افزار باید این حساب را خودش انجام بدهد. */
const DOOR_REVEAL_CM = 0.3;      /* درز ۳ میلی‌متر بین لنگه‌ها و لبه‌ها */

function r1(x) { return Math.round((+x || 0) * 10) / 10; }

/* عرض هر لنگه از روی طول یونیت و تعداد لنگه‌ها */
function leafWidth(lengthCm, leaves) {
  const n = Math.max(1, Math.round(+leaves || 1));
  return r1(((+lengthCm || 0) - DOOR_REVEAL_CM * (n + 1)) / n);
}

/* تعداد لنگه‌ی مناسب برای یک عرض یونیت */
function leavesForLength(lengthCm) { return (+lengthCm || 0) >= 70 ? 2 : 1; }

/* عرض لنگه‌های موجود را با طول فعلی یونیت دوباره اندازه می‌کند */
function fitDoorsToUnit(u) {
  const doors = u.doors || [];
  const leaves = doors.reduce((a, d) => a + (+d.qty || 0), 0);
  if (!leaves) return false;
  const totalW = doors.reduce((a, d) => a + (+d.qty || 0) * (+d.w_cm || 0), 0);
  const avail = (+u.length_cm || 0) - DOOR_REVEAL_CM * (leaves + 1);
  const h = r1((+u.height_cm || 0) - DOOR_REVEAL_CM);
  doors.forEach((d) => {
    const share = totalW > 0 ? ((+d.qty || 0) * (+d.w_cm || 0)) / totalW : 1 / doors.length;
    d.w_cm = r1((avail * share) / Math.max(1, +d.qty || 1));
    /* ★ ارتفاعِ دستیِ معتبر حفظ می‌شود (مثلاً درِ کوتاهِ بالای ردیف کشو) —
       پیش‌تر هر دو شاخه‌ی شرط یک مقدار می‌دادند و ارتفاعِ دلخواه همیشه با
       ارتفاع یونیت بازنویسی می‌شد (شرطِ مرده). فقط ارتفاعِ خالی یا بزرگ‌تر
       از یونیت اصلاح می‌شود.                                                     */
    const dh = +d.h_cm || 0;
    if (!dh || dh > h) d.h_cm = h;
  });
  return true;
}

/* ★ سلول «ورق در» با تیکِ «در از ورق بدنه»
   اگر لنگه روی ورقِ بدنه جا شود، کاربر می‌تواند تیک بزند تا لنگه‌ها از همان
   ورقِ بدنه برش بخورند: ورقِ جداگانه خریداری نمی‌شود و مساحتِ در با مساحتِ
   بدنه یک‌جا گرد می‌شود (پس تعداد ورق و قیمت کم‌تر می‌شود).
   ★ اگر جنسِ در از قبل همان ورقِ بدنه باشد، ورق‌ها «همین حالا هم» یک‌جا گرد
   می‌شوند و تیک، قیمت را عوض نمی‌کند — راهنما باید راستش را بگوید: فایده‌ی
   تیک در این حالت، یکی‌شدن ردیف‌های فاکتور/برش‌نامه/خلاصه‌ی ورق است.        */
function doorSheetCell(u, dr, ui, di) {
  const bodyM = matById(u.body_id);
  const fit = doorLeafFitsSheet(dr, bodyM);
  const on = !!dr.from_body;
  const attrs = `data-scope="door" data-k="from_body" data-ui="${ui}" data-di="${di}"`;
  const tip = fit.ok
    ? "لنگه‌ها از همان ورقِ بدنه‌ی یونیت برش می‌خورند — ورقِ جداگانه خریداری نمی‌شود و بهای در به نرخ ورق بدنه حساب می‌شود"
    : fit.why;
  let html = `<label class="check fb-check${fit.ok ? "" : " bad"}" title="${esc(tip)}">
      <input type="checkbox" ${attrs}${on ? " checked" : ""}${fit.ok ? "" : " disabled"}>
      <span>از ورق بدنه</span></label>`;
  if (on && fit.ok) {
    html += `<div class="fb-note ok">🪵 ${esc(bodyM ? bodyM.name : "ورق بدنه")} — ورقِ جدا نمی‌خرد</div>`;
  } else if (on && !fit.ok) {
    html += `<div class="fb-note bad">⚠ ${esc(fit.why)} — تیک نادیده گرفته شد</div>`;
  } else if (!on && fit.ok && bodyM && +dr.material_id === +u.body_id) {
    html += `<div class="fb-note hint">💡 جنسِ در با ورق بدنه یکی است — ورق‌ها همین حالا هم یک‌جا شمرده می‌شوند؛ با تیک، ردیفِ «ورق در» در فاکتور و برش‌نامه با بدنه یکی می‌شود</div>`;
  }
  if (!(on && fit.ok)) {
    html += matSelect("door_sheet", dr.material_id,
      `data-scope="door" data-k="material_id" data-ui="${ui}" data-di="${di}"`);
  }
  return `<div class="fb-wrap">${html}</div>`;
}

/* برای یونیت‌هایی که در ندارند، درِ هم‌اندازه می‌سازد (متریال از سبک بخش) */
function autoDoorsForUnit(u, styleData) {
  const d = styleData || {};
  const leaves = leavesForLength(u.length_cm);
  const dr = defaultDoor();
  dr.label = "در";
  dr.qty = leaves;
  dr.w_cm = leafWidth(u.length_cm, leaves);
  dr.h_cm = r1((+u.height_cm || 0) - DOOR_REVEAL_CM);
  dr.hinges_per_leaf = (+u.height_cm || 0) >= 150 ? 4 : 2;
  if (d.door) dr.material_id = midByName(d.door);
  if (d.door_model) dr.door_model_id = midByName(d.door_model);
  if (d.hinge) dr.hinge_id = midByName(d.hinge);
  if (d.handle) dr.handle_id = midByName(d.handle);
  if (d.banding) dr.banding_id = midByName(d.banding);
  if (d.assembly_door) dr.assembly_id = midByName(d.assembly_door);
  if (d.packaging_door) dr.packaging_id = midByName(d.packaging_door);
  u.doors = u.doors || [];
  u.doors.push(dr);
  return dr;
}

/* واحد‌های اندازه‌گیری — برای برچسبِ داخل قابِ ورودی */
const U_CM = "سم", U_QTY = "عدد", U_LEAF = "لنگه", U_M = "م", U_SQM = "م²";
const uMoney = () => CUR.name;

/* ورودی عددی استاندارد: قاب هم‌اندازه + برچسب واحد + عرض متناسب با نوع داده
   مقدار با جداکننده‌ی هزارگان نمایش داده می‌شود (هنگام تایپ هم حفظ می‌شود) */
function inp(scope, k, val, extra, unit, wcls) {
  const cls = "cell-input" + (wcls ? " " + wcls : "") + (unit ? " has-u" : "");
  const u = unit ? `<i class="cell-u" aria-hidden="true">${unit}</i>` : "";
  return `<span class="cell-wrap"><input class="${cls}" type="text" inputmode="numeric" data-scope="${scope}" data-k="${k}" value="${fmtInp(val ?? 0)}" ${extra || ""}>${u}</span>`;
}
function inpT(scope, k, val, extra) {
  return `<input class="cell-input w-label" type="text" data-scope="${scope}" data-k="${k}" value="${esc(val ?? "")}" ${extra || ""}>`;
}

const UNIT_MAT_FIELDS = [
  ["body_id", "ورق بدنه", "body_sheet"], ["back_id", "فیبر پشت", "back_sheet"],
  ["banding_id", "نوار PVC", "banding"], ["countertop_id", "صفحه کابینت", "countertop"],
  ["crown_id", "تاج", "crown"], ["underlight_id", "زیرچراغ", "underlight"],
  ["kickboard_id", "پاخور", "kickboard"], ["leg_id", "پایه", "leg"],
  ["shelf_pin_id", "خار طبقه", "shelf_pin"], ["assembly_id", "مونتاژ یونیت", "service"],
];

/* ══════════════════════════════════════════════════════════════════════════
   حفظِ فوکوس و اسکرول در بازسازیِ جدول‌ها
   --------------------------------------------------------------------------
   مشکلِ قبلی (K‑5/K‑6): `innerHTML` کل جدول را عوض می‌کند، پس عنصرِ دارای
   فوکوس نابود می‌شود و مکان‌نما به `body` می‌پرد؛ کاربر باید دوباره ردیفش را
   پیدا کند. راه‌حل: «هویتِ سلول» (data-scope/data-k/data-ui/data-di/data-ri)
   را پیش از بازسازی نگه می‌داریم و بعد همان سلول را پیدا و فوکوس می‌کنیم —
   چون DOM عوض می‌شود ولی هویتِ سلول نه. به‌علاوه جای اسکرولِ هر ظرف هم
   بازگردانده می‌شود.                                                          */
const EDITOR_TABLE_IDS = ["tblUnits", "tblDoors", "tblDrawers", "tblFacade", "tblExtras", "tblServices"];
let _pendingFocus = null;    /* {row, scope, k} — مثلاً پس از «افزودن ردیف» */

function cellIdentity(node) {
  const ds = node && node.dataset ? node.dataset : null;
  if (!ds || !ds.scope || !ds.k) return null;
  return { scope: ds.scope, k: ds.k, ui: ds.ui ?? "", di: ds.di ?? "", ri: ds.ri ?? "" };
}

function captureCellFocus() {
  const ae = document.activeElement;
  const wrap = ae && ae.closest ? ae.closest(".table-wrap") : null;
  return {
    ident: cellIdentity(ae),
    wasSelStart: ae && ae.selectionStart !== undefined && ae.selectionStart !== null ? ae.selectionStart : null,
    scroll: wrap ? { el: wrap, left: wrap.scrollLeft, top: wrap.scrollTop } : null,
  };
}

function findCellNode(ident) {
  if (!ident) return null;
  /* نکته: `[data-di=""]` با «نبودِ صفت» فرق دارد — صفتی که چاپ نشده را نباید
     در گزینش‌گر خواست، وگرنه سلول پیدا نمی‌شود و فوکوس می‌پرد.               */
  let q = `#projectEditor [data-scope="${ident.scope}"][data-k="${ident.k}"]`;
  ["ui", "di", "ri"].forEach((k) => {
    if (ident[k] !== "" && ident[k] !== null && ident[k] !== undefined) q += `[data-${k}="${ident[k]}"]`;
  });
  return document.querySelector(q);
}

function restoreCellFocus(keep) {
  keep = keep || {};
  /* اسکرولِ افقی/عمودی هر ظرف سرِ جایش برگردد */
  EDITOR_TABLE_IDS.forEach((id) => {
    const t = el(id);
    if (!t) return;
    const w = t.closest(".table-wrap");
    if (w && keep.scroll && keep.scroll.el && keep.scroll.el.classList.contains("grid-head")) {
      /* ظرفِ همان جدول — اگر همان است، مقدارها را برگردان */
      if (keep.scroll.el === w) { w.scrollLeft = keep.scroll.left; w.scrollTop = keep.scroll.top; }
    }
  });
  if (keep.scroll && keep.scroll.el && keep.scroll.el.isConnected) {
    keep.scroll.el.scrollLeft = keep.scroll.left;
    keep.scroll.el.scrollTop = keep.scroll.top;
  }
  const target = _pendingFocus ? document.querySelector(`#projectEditor tr[data-row="${_pendingFocus.row}"]`) : null;
  let node = null;
  if (target) {
    node = (_pendingFocus.scope && _pendingFocus.k)
      ? target.querySelector(`[data-scope="${_pendingFocus.scope}"][data-k="${_pendingFocus.k}"]`)
      : target.querySelector("input, select, textarea, button");
  }
  if (!node) node = findCellNode(keep.ident);
  if (!node || node.disabled || !node.isConnected) { _pendingFocus = null; return; }
  try {
    node.focus({ preventScroll: true });
    if (node.select && (node.type === "text")) {
      if (keep.wasSelStart !== null && keep.wasSelStart !== undefined && node === findCellNode(keep.ident)) {
        node.setSelectionRange(keep.wasSelStart, keep.wasSelStart);
      } else node.select();
    }
  } catch (e) { /* مرورگرِ بدونِ پشتیبانی */ }
  _pendingFocus = null;
}

/** پس از «افزودن/کپی/حذف ردیف» فوکوس را به ردیفِ مربوطه ببر (K‑6) */
function focusRowAfter(kind, idx, scope, k) {
  _pendingFocus = { row: "er:" + kind + ":" + idx, scope: scope || null, k: k || null };
}

function renderEditorTables() {
  const p = state.editingProject;
  const pg = curPage();
  if (!p || !pg) return;

  /* ═══ حفظِ فوکوس و اسکرول ═══
     هر بازسازیِ جدول پیش از این فوکوس و جای اسکرول را می‌کشت (یافته‌ی K‑5):
     کاربر وسطِ تایپ، با یک تغییرِ انتخاب به ابتدای جدول پرت می‌شد. حالا
     «هویتِ سلول» (scope/k/ui/di/ri) پیش از بازسازی گرفته و بعد بازگردانده
     می‌شود — چون DOM عوض می‌شود ولی هویتِ سلول نه.                            */
  const keep = captureCellFocus();

  /* ── کنش‌های ردیف ──
     سه تغییر نسبت به قبل (یافته‌های F‑1 و F‑3):
       ۱) کنش‌ها به «ستونِ اولِ چسبان» آمدند؛ پیش‌تر در آخرین سلولِ یک جدولِ
          تا ۱۲۰۰ پیکسل بودند و برای هر حذف باید افقی اسکرول می‌شد.
       ۲) هدف‌ها از ۳۲ به ۳۹ پیکسل رسیدند.
       ۳) پیش از «حذف» جداکننده آمد تا از «کپیِ» پرتکرار فاصله بگیرد.        */
  const actBtn = (cls, icon, title, attrs) =>
    `<button class="row-actions ${cls}" type="button" title="${title}" aria-label="${title}" ${attrs}>${ICONS[icon]}</button>`;
  const delBtn = (kind, ui, di, ri) =>
    actBtn("del", "trash", "حذف ردیف", `data-del-row="${kind}" data-ui="${ui ?? ""}" data-di="${di ?? ""}" data-ri="${ri ?? ""}"`);
  const dupBtn = (kind, ui, di, ri) =>
    actBtn("", "copy", "کپی ردیف", `data-copy-row="${kind}" data-ui="${ui ?? ""}" data-di="${di ?? ""}" data-ri="${ri ?? ""}"`);
  const tplBtn = (ui) =>
    actBtn("", "tpl", "ذخیره به‌عنوان الگو", `data-tpl-save="${ui}"`);
  const SEP = `<span class="row-sep" aria-hidden="true"></span>`;
  const acts = (inner) => `<div class="row-btns">${inner}</div>`;
  /* هویتِ ردیف روی خودِ <tr> — برای «پس از بازسازی، فوکوس را به ردیفِ تازه
     اضافه‌شده ببر» (K‑6) و برای برگرداندنِ فوکوس پس از حذف/کپی.              */
  /* پیشوندِ «er:» تا هویتِ ردیف‌های ویرایشگر با `data-row` در جاهای دیگر
     (مثلاً مودالِ ساختِ فاکتور) قاطی نشود.                                  */
  const rowAttrs = (kind, i) => ` class="erow" data-row="er:${kind}:${i}"`;
  const withRow = (extra, kind, i) =>
    `data-row="er:${kind}:${i}" ${extra || ""}`.trim();

  /* --- یونیت‌ها --- */
  let uRows = "";
  pg.units.forEach((u, i) => {
    const open = state.expanded.has(`${p.id}:${state.pageIdx}:${i}`);
    const a = (extra) => withRow(extra, "unit", i);
    uRows += `
      <tr${rowAttrs("unit", i)}>
        <td><div class="row-id-cell">
          ${inpT("unit", "label", u.label, a(`data-ui="${i}"`))}
          ${acts(`${tplBtn(i)}${dupBtn("unit", i)}${SEP}${delBtn("unit", i)}`)}
        </div></td>
        <td><select class="cell-select" data-scope="unit" data-k="unit_type" data-ui="${i}" ${a("")}>
          ${Object.entries(UNIT_TYPES).map(([k, l]) => `<option value="${k}"${u.unit_type === k ? " selected" : ""}>${l}</option>`).join("")}
        </select></td>
        <td>${inp("unit", "length_cm", u.length_cm, a(`data-ui="${i}"`), U_CM, "w-dim")}</td>
        <td>${inp("unit", "height_cm", u.height_cm, a(`data-ui="${i}"`), U_CM, "w-dim")}</td>
        <td>${inp("unit", "depth_cm", u.depth_cm, a(`data-ui="${i}"`), U_CM, "w-dim")}</td>
        <td>${inp("unit", "qty", u.qty, a(`data-ui="${i}"`), U_QTY, "w-qty")}</td>
        <td>${inp("unit", "shelves", u.shelves, a(`data-ui="${i}"`), U_QTY, "w-qty")}</td>
        <td><span class="cell-badges">
              <button type="button" class="count-badge badge-btn" data-goto-tab="doors" data-ui="${i}" title="پرش به ردیف‌های درِ همین یونیت در تب «درها»">در ${fa(u.doors.reduce((s, d) => s + (+d.qty || 0), 0) * (+u.qty || 1))}</button>
              <button type="button" class="count-badge badge-btn" data-goto-tab="drawers" data-ui="${i}" title="پرش به ردیف‌های کشوی همین یونیت در تب «کشوها»">کشو ${fa(u.drawers.reduce((s, d) => s + (+d.qty || 0), 0) * (+u.qty || 1))}</button>
            </span></td>
        <td><button class="expander${open ? " open" : ""}" type="button" data-expand="${i}" title="متریال و یراق یونیت" aria-expanded="${open ? "true" : "false"}">${ICONS.chev}</button></td>
      </tr>`;
    if (open) {
      uRows += `
      <tr class="unit-detail-row" data-detail-of="unit:${i}"><td colspan="9">
        <div class="unit-detail">
          ${UNIT_MAT_FIELDS.map(([k, label, cat]) => `
            <div class="field"><label>${label}</label>
              ${matSelect(cat, u[k], `data-scope="unit" data-k="${k}" data-ui="${i}" ${a("")}`)}
            </div>`).join("")}
          <div class="field"><label>تعداد پایه در یونیت</label>${inp("unit", "legs_per_unit", u.legs_per_unit, a(`data-ui="${i}"`), U_QTY, "w-qty")}</div>
          <div class="field"><label>خار در هر طبقه</label>${inp("unit", "pins_per_shelf", u.pins_per_shelf, a(`data-ui="${i}"`), U_QTY, "w-qty")}</div>
          <div class="ud-checks">
            <label class="check"><input type="checkbox" data-scope="unit" data-k="has_top_panel" data-ui="${i}" ${a("")}${u.has_top_panel !== false ? " checked" : ""}> سقف یونیت</label>
            <label class="check"><input type="checkbox" data-scope="unit" data-k="has_bottom_panel" data-ui="${i}" ${a("")}${u.has_bottom_panel !== false ? " checked" : ""}> کف یونیت</label>
            <span class="tiny muted">مساحت بدنه‌ی این یونیت: <b>${fmt(unitArea(u) * (+u.qty || 1), true)}</b> م² (بدون فیبر پشت)</span>
          </div>
        </div>
      </td></tr>`;
    }
  });
  el("tblUnits").innerHTML = `
    <thead><tr><th class="th-row">ردیف</th><th>نوع</th><th>طول (سم)</th><th>ارتفاع (سم)</th><th>عمق (سم)</th><th>تعداد (عدد)</th><th>طبقات (عدد)</th><th>در/کشو</th><th>جزئیات</th></tr></thead>
    <tbody>${uRows || `<tr><td colspan="9"><div class="empty">یونیتی تعریف نشده — «＋ افزودن یونیت» را بزنید.</div></td></tr>`}</tbody>`;

  /* --- درها (سطح بخش، وابسته به یونیت) --- */
  let dRows = "";
  pg.units.forEach((u, ui) => u.doors.forEach((dr, di) => {
    const a = (extra) => withRow(extra, "door", `${ui}:${di}`);
    dRows += `
      <tr${rowAttrs("door", `${ui}:${di}`)}>
        <td><div class="row-id-cell">
          <select class="cell-select" data-scope="doormove" data-ui="${ui}" data-di="${di}" ${a("")}
                  aria-label="یونیتِ 소속ِ این در" title="در به کدام یونیت تعلق دارد">
            ${pg.units.map((x, i2) => `<option value="${i2}"${i2 === ui ? " selected" : ""}>${esc(x.label || `یونیت ${i2 + 1}`)}</option>`).join("")}
          </select>
          ${acts(`${dupBtn("door", ui, di)}${SEP}${delBtn("door", ui, di)}`)}
        </div></td>
        <td>${inpT("door", "label", dr.label, a(`data-ui="${ui}" data-di="${di}"`))}</td>
        <td>${inp("door", "qty", dr.qty, a(`data-ui="${ui}" data-di="${di}"`), U_LEAF, "w-qty")}</td>
        <td>${inp("door", "w_cm", dr.w_cm, a(`data-ui="${ui}" data-di="${di}"`), U_CM, "w-dim")}</td>
        <td>${inp("door", "h_cm", dr.h_cm, a(`data-ui="${ui}" data-di="${di}"`), U_CM, "w-dim")}</td>
        <td>${doorSheetCell(u, dr, ui, di)}</td>
        <td>${matSelect("door_model", dr.door_model_id, `data-scope="door" data-k="door_model_id" data-ui="${ui}" data-di="${di}" ${a("")}`)}</td>
        <td>${matSelect("hinge", dr.hinge_id, `data-scope="door" data-k="hinge_id" data-ui="${ui}" data-di="${di}" ${a("")}`)}</td>
        <td>${matSelect("handle", dr.handle_id, `data-scope="door" data-k="handle_id" data-ui="${ui}" data-di="${di}" ${a("")}`)}</td>
        <td>${matSelect("service", dr.assembly_id, `data-scope="door" data-k="assembly_id" data-ui="${ui}" data-di="${di}" ${a("")}`)}</td>
        <td>${matSelect("service", dr.packaging_id, `data-scope="door" data-k="packaging_id" data-ui="${ui}" data-di="${di}" ${a("")}`)}</td>
      </tr>`;
  }));
  el("tblDoors").innerHTML = `
    <thead><tr><th class="th-row">یونیت</th><th>برچسب</th><th>لنگه (عدد)</th><th>عرض (سم)</th><th>ارتفاع (سم)</th><th>ورق در</th><th>مدل/اجرت</th><th>لولا</th><th>دستگیره</th><th>مونتاژ</th><th>بسته‌بندی</th></tr></thead>
    <tbody>${dRows || `<tr><td colspan="11"><div class="empty">دری تعریف نشده است.</div></td></tr>`}</tbody>`;

  /* --- کشوها --- */
  let wRows = "";
  pg.units.forEach((u, ui) => u.drawers.forEach((dw, di) => {
    const a = (extra) => withRow(extra, "drawer", `${ui}:${di}`);
    wRows += `
      <tr${rowAttrs("drawer", `${ui}:${di}`)}>
        <td><div class="row-id-cell">
          <select class="cell-select" data-scope="drawermove" data-ui="${ui}" data-di="${di}" ${a("")}
                  aria-label="یونیتِ 소속ِ این کشو" title="کشو به کدام یونیت تعلق دارد">
            ${pg.units.map((x, i2) => `<option value="${i2}"${i2 === ui ? " selected" : ""}>${esc(x.label || `یونیت ${i2 + 1}`)}</option>`).join("")}
          </select>
          ${acts(`${dupBtn("drawer", ui, di)}${SEP}${delBtn("drawer", ui, di)}`)}
        </div></td>
        <td>${inpT("drawer", "label", dw.label, a(`data-ui="${ui}" data-di="${di}"`))}</td>
        <td>${inp("drawer", "qty", dw.qty, a(`data-ui="${ui}" data-di="${di}"`), U_QTY, "w-qty")}</td>
        <td>${inp("drawer", "w_cm", dw.w_cm, a(`data-ui="${ui}" data-di="${di}"`), U_CM, "w-dim")}</td>
        <td>${inp("drawer", "h_cm", dw.h_cm, a(`data-ui="${ui}" data-di="${di}"`), U_CM, "w-dim")}</td>
        <td>${inp("drawer", "d_cm", dw.d_cm, a(`data-ui="${ui}" data-di="${di}"`), U_CM, "w-dim")}</td>
        <td>${matSelect("drawer_slide", dw.slide_id, `data-scope="drawer" data-k="slide_id" data-ui="${ui}" data-di="${di}" ${a("")}`)}</td>
        <td>${matSelect("drawer_sheet", dw.sheet_id, `data-scope="drawer" data-k="sheet_id" data-ui="${ui}" data-di="${di}" ${a("")}`)}</td>
        <td>${matSelect("door_sheet", dw.front_id, `data-scope="drawer" data-k="front_id" data-ui="${ui}" data-di="${di}" ${a("")}`)}</td>
        <td>${matSelect("handle", dw.handle_id, `data-scope="drawer" data-k="handle_id" data-ui="${ui}" data-di="${di}" ${a("")}`)}</td>
      </tr>`;
  }));
  el("tblDrawers").innerHTML = `
    <thead><tr><th class="th-row">یونیت</th><th>برچسب</th><th>تعداد (عدد)</th><th>عرض (سم)</th><th>ارتفاع (سم)</th><th>عمق (سم)</th><th>ریل</th><th>ورق جعبه</th><th>تیره‌ی کشو</th><th>دستگیره</th></tr></thead>
    <tbody>${wRows || `<tr><td colspan="10"><div class="empty">کشویی تعریف نشده است.</div></td></tr>`}</tbody>`;

  /* --- درنما --- */
  if (pg.detail_mode === "detailed") {
    el("tblFacade").innerHTML = `
      <thead><tr><th class="th-row">ردیف</th><th>تعداد (عدد)</th><th>عرض (سم)</th><th>ارتفاع (سم)</th><th>قیمت هر م² (${CUR.name})</th><th>مساحت (م²)</th><th>جمع (${CUR.name})</th></tr></thead>
      <tbody>${pg.detail_rows.map((r, i) => {
        const area = (+r.qty || 0) * ((+r.w_cm || 0) / 100) * ((+r.h_cm || 0) / 100);
        const a = (extra) => withRow(extra, "facade", i);
        return `<tr${rowAttrs("facade", i)}>
          <td><div class="row-id-cell">
            ${inpT("facade", "label", r.label, a(`data-ri="${i}"`))}
            ${acts(`${dupBtn("facade", null, null, i)}${SEP}${delBtn("facade", null, i)}`)}
          </div></td>
          <td>${inp("facade", "qty", r.qty, a(`data-ri="${i}"`), U_QTY, "w-qty")}</td>
          <td>${inp("facade", "w_cm", r.w_cm, a(`data-ri="${i}"`), U_CM, "w-dim")}</td>
          <td>${inp("facade", "h_cm", r.h_cm, a(`data-ri="${i}"`), U_CM, "w-dim")}</td>
          <td>${inp("facade", "price_per_sqm", r.price_per_sqm, a(`data-ri="${i}"`), uMoney(), "w-money")}</td>
          <td class="num f-area" data-ri="${i}">${fmt(area, 1)}</td>
          <td class="num f-sum" data-ri="${i}">${fmt(scaled(area * (+r.price_per_sqm || 0)))}</td>
        </tr>`;
      }).join("") || `<tr><td colspan="7"><div class="empty">ردیفی نیست — «＋ افزودن ردیف درنما» را بزنید.</div></td></tr>`}
      </tbody>`;
  } else {
    el("tblFacade").innerHTML = "";
  }

  /* --- اضافات --- */
  el("tblExtras").innerHTML = `
    <thead><tr><th class="th-row">ردیف</th><th>تعداد (عدد)</th><th>واحد</th><th>فی (${CUR.name})</th><th>جمع (${CUR.name})</th><th>در فاکتور</th></tr></thead>
    <tbody>${pg.extras.map((r, i) => {
      const a = (extra) => withRow(extra, "extra", i);
      return `
      <tr${rowAttrs("extra", i)}>
        <td><div class="row-id-cell">
          ${inpT("extra", "label", r.label, a(`data-ri="${i}" style="min-width:11rem"`))}
          ${acts(`${dupBtn("extra", null, null, i)}${SEP}${delBtn("extra", null, i)}`)}
        </div></td>
        <td>${inp("extra", "qty", r.qty, a(`data-ri="${i}"`), U_QTY, "w-qty")}</td>
        <td><select class="cell-select" data-scope="extra" data-k="unit" data-ri="${i}" ${a("")}>
          ${Object.entries(UNITS).map(([k, l]) => `<option value="${k}"${r.unit === k ? " selected" : ""}>${l}</option>`).join("")}
        </select></td>
        <td>${inp("extra", "price", r.price, a(`data-ri="${i}"`), uMoney(), "w-money")}</td>
        <td class="num x-sum" data-ri="${i}">${fmt(scaled((+r.qty || 0) * (+r.price || 0)))}</td>
        <td><label class="check" style="justify-content:center"><input type="checkbox" data-scope="extra" data-k="visible" data-ri="${i}" ${a("")}${r.visible !== false ? " checked" : ""}></label></td>
      </tr>`;
    }).join("") || `<tr><td colspan="6"><div class="empty">قلمی نیست.</div></td></tr>`}
    </tbody>`;

  /* --- خدمات --- */
  el("svcLibrary").innerHTML = `<option value="">— انتخاب کنید —</option>` +
    catNames("service").map((n) => {
      const sv = mat(n);
      return `<option value="${esc(n)}">${esc(n)}${sv && sv.price ? ` — ${fmt(sv.price)}` : ""}</option>`;
    }).join("");
  el("tblServices").innerHTML = `
    <thead><tr><th class="th-row">شرح خدمت</th><th>مبنا</th><th>نرخ (${CUR.name})</th></tr></thead>
    <tbody>${pg.services.map((s, i) => {
      const a = (extra) => withRow(extra, "service", i);
      return `
      <tr${rowAttrs("service", i)}>
        <td><div class="row-id-cell">
          ${inpT("service", "label", s.label, a(`data-ri="${i}" style="min-width:13rem"`))}
          ${acts(`${dupBtn("service", null, null, i)}${SEP}${delBtn("service", null, i)}`)}
        </div></td>
        <td><select class="cell-select" data-scope="service" data-k="basis" data-ri="${i}" ${a("")}>
          ${Object.entries(SERVICE_BASIS).map(([k, l]) => `<option value="${k}"${s.basis === k ? " selected" : ""}>${l}</option>`).join("")}
        </select></td>
        <td>${inp("service", "price", s.price, a(`data-ri="${i}"`), uMoney(), "w-money")}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="3"><div class="empty">خدمتی نیست — از کتابخانه اضافه کنید.</div></td></tr>`}
    </tbody>`;

  /* شمارنده‌ی تب‌ها */
  const cntDoors = pg.units.reduce((a, u) => a + u.doors.length, 0);
  const cntDrawers = pg.units.reduce((a, u) => a + u.drawers.length, 0);
  el("cntUnits").textContent = fa(pg.units.length);
  el("cntDoors").textContent = fa(cntDoors);
  el("cntDrawers").textContent = fa(cntDrawers);
  el("cntFacade").textContent = fa(pg.detail_mode === "detailed" ? pg.detail_rows.length : pg.detail_mode === "total" ? 1 : 0);
  el("cntExtras").textContent = fa(pg.extras.length);
  el("cntServices").textContent = fa(pg.services.length);
  renderDimRibbon();

  restoreCellFocus(keep);
}

function updateComputedCells() {
  const pg = curPage();
  if (!pg) return;
  $$("#tblFacade .f-area").forEach((td) => {
    const r = pg.detail_rows[+td.dataset.ri];
    if (r) td.textContent = fmt((+r.qty || 0) * ((+r.w_cm || 0) / 100) * ((+r.h_cm || 0) / 100), 1);
  });
  $$("#tblFacade .f-sum").forEach((td) => {
    const r = pg.detail_rows[+td.dataset.ri];
    if (r) td.textContent = fmt(scaled((+r.qty || 0) * ((+r.w_cm || 0) / 100) * ((+r.h_cm || 0) / 100) * (+r.price_per_sqm || 0)));
  });
  $$("#tblExtras .x-sum").forEach((td) => {
    const r = pg.extras[+td.dataset.ri];
    if (r) td.textContent = fmt(scaled((+r.qty || 0) * (+r.price || 0)));
  });
}

/* ---------------------------------------------------------- واحدهای نوار جمع */
/* برچسب واحدِ فیلدهای نوار جمع را با حالت/واحد پول همگام می‌کند */
function refreshTbUnits() {
  const set = (id, txt) => {
    const n = el(id);
    if (!n) return;
    n.textContent = txt || "";
    n.style.display = txt ? "" : "none";
  };
  const mode = el("tbInstallMode") ? el("tbInstallMode").value : "none";
  set("uProfitPct", "٪");
  set("uInstallVal", mode === "percent" ? "٪" : mode === "per_meter" ? CUR.name + "/متر" : mode === "fixed" ? CUR.name : "");
  set("uDiscPct", "٪");
  set("uDiscAmt", CUR.name);
  set("uVatPct", "٪");
  set("uExtraFixed", CUR.name);
  set("uDepositPct", "٪");
  set("uDepositAmt", CUR.name);
  /* کلاس has-u فقط وقتی واحد نمایشی وجود دارد */
  [["tbInstallVal", "uInstallVal"], ["tbDiscAmt", "uDiscAmt"], ["tbExtraFixed", "uExtraFixed"],
   ["tbDepositAmt", "uDepositAmt"]].forEach(([i, u]) => {
    const inEl = el(i), uEl = el(u);
    if (inEl && uEl) inEl.classList.toggle("has-u", !!uEl.textContent);
  });
}

/* راهنمای واحدِ قیمت در مودال متریال */
function setMfPriceHint() {
  const h = el("mfPriceHint");
  if (!h) return;
  const uSel = el("mfUnit");
  const uLbl = uSel && uSel.selectedOptions[0] ? uSel.selectedOptions[0].textContent : "";
  h.textContent = `قیمت به «${CUR.name}» به ازای هر «${uLbl}»`;
}

/* ---------------------------------------------------------- محاسبه‌ی زنده */
function calcFields(p) {
  return {
    id: p.id, install_mode: p.install_mode, install_value: +p.install_value || 0,
    profit_mode: p.profit_mode, profit_percent: +p.profit_percent || 0,
    discount_percent: +p.discount_percent || 0, discount_amount: +p.discount_amount || 0,
    vat_enabled: p.vat_enabled ? 1 : 0, vat_percent: +p.vat_percent || 0,
    extra_fixed_amount: +p.extra_fixed_amount || 0,
    deposit_percent: +p.deposit_percent || 0, deposit_amount: +p.deposit_amount || 0,
  };
}
function invPayload(p) {
  return Object.assign(calcFields(p), {
    code: p.code, title: p.title, customer: p.customer, mobile: p.mobile,
    phone: p.phone, address: p.address, valid_until: p.valid_until, note: p.note || "",
  });
}

let _calcTimer = null;
function paintDirtyState2() {
  const on = !!state.dirty;
  const b = el("btnSaveProject");
  if (b) b.classList.toggle("dirty", on);
  /* نشانِ «ذخیره‌نشده» در نوارِ فرمان و در نوارِ جمع — بازخوردِ مداوم بدونِ
     مزاحمت: فقط وقتی لازم است دیده می‌شود.                                     */
  const chip = el("ebDirty");
  if (chip) chip.hidden = !on;
  const hint = el("tbSaveHint");
  if (hint) hint.hidden = !on;
  const bar = el("editorBar");
  if (bar) bar.classList.toggle("is-dirty", on);
}
function markDirty(undoKey) {
  if (!state.dirty) {
    state.dirty = true;
  }
  paintDirtyState2();
  undoCommit(undoKey);          /* هر تغییر = یک گام در تاریخچه‌ی واگرد */
  scheduleDraftSave();          /* پیش‌نویسِ خودکار برای نسیدنِ کار */
}
function clearDirty() {
  state.dirty = false;
  paintDirtyState2();
}

/* ================================================================== واگرد
   تاریخچه‌ی وضعیتِ ویرایشگر پروژه (بخش‌ها + یونیت‌ها + درها + کشوها…) با
   Ctrl+Z / Ctrl+Shift+Z یا دکمه‌های نوار ویرایشگر. حذفِ اشتباهِ یک یونیت با
   همه‌ی متریال‌هایش دیگر فاجعه نیست — یک کلید کافی است.                        */
const UNDO = { stack: [], idx: -1, max: 80, lastKey: "", lastAt: 0, applying: false };

function undoSnapshot() {
  const p = state.editingProject;
  if (!p) return "";
  try { return JSON.stringify({ pages: p.pages, pageIdx: state.pageIdx }); }
  catch (e) { return ""; }
}
function undoReset() {
  UNDO.stack = [];
  UNDO.idx = -1;
  UNDO.lastKey = ""; UNDO.lastAt = 0;
  const s = undoSnapshot();
  if (s) { UNDO.stack.push(s); UNDO.idx = 0; }
  updateUndoButtons();
}
function undoCommit(key) {
  if (UNDO.applying) return;
  const p = state.editingProject;
  if (!p) return;
  const now = Date.now();
  /* ویرایشِ پیاپیِ یک فیلد = یک گام واگرد (تا ۹۰۰ میلی‌ثانیه) */
  if (key && key === UNDO.lastKey && now - UNDO.lastAt < 900) { UNDO.lastAt = now; return; }
  UNDO.lastKey = key || ""; UNDO.lastAt = now;
  const s = undoSnapshot();
  if (!s || (UNDO.idx >= 0 && UNDO.stack[UNDO.idx] === s)) return;
  UNDO.stack = UNDO.stack.slice(0, UNDO.idx + 1);
  UNDO.stack.push(s);
  if (UNDO.stack.length > UNDO.max) UNDO.stack.shift();
  UNDO.idx = UNDO.stack.length - 1;
  updateUndoButtons();
}
function undoApplySnap() {
  const p = state.editingProject;
  const s = UNDO.stack[UNDO.idx];
  if (!p || !s) return;
  UNDO.applying = true;
  try {
    const d = JSON.parse(s);
    p.pages = d.pages || [];
    state.pageIdx = Math.min(Math.max(0, +d.pageIdx || 0), Math.max(0, p.pages.length - 1));
    state.dirty = true;
    paintDirtyState2();
    renderSectionPills(); renderSectionBar(); renderEditorTables();
    scheduleRecalc(50);
    scheduleDraftSave();
  } finally { UNDO.applying = false; }
  updateUndoButtons();
}
function doUndo() {
  if (UNDO.idx <= 0) return false;
  UNDO.idx--; undoApplySnap();
  return true;
}
function doRedo() {
  if (UNDO.idx < 0 || UNDO.idx >= UNDO.stack.length - 1) return false;
  UNDO.idx++; undoApplySnap();
  return true;
}
function updateUndoButtons() {
  const u = el("btnUndo"), r = el("btnRedo");
  if (u) u.disabled = UNDO.idx <= 0;
  if (r) r.disabled = UNDO.idx < 0 || UNDO.idx >= UNDO.stack.length - 1;
}

/* ================================================== پیش‌نویسِ خودکار (درافت)
   هر چند ثانیه یک‌بار، پروژه‌ی در حال ویرایش در localStorage ذخیره می‌شود؛
   اگر مرورگر/برق برود، هنگام بازکردنِ دوباره‌ی پروژه پیشنهادِ بازیابی می‌دهیم.
   با ذخیره‌ی موفق یا بستنِ ویرایشگر، پیش‌نویس پاک می‌شود.                     */
const DRAFT_PREFIX = "kabir.draft.v1.";
let _draftTimer = null;
function scheduleDraftSave() {
  if (!API.ok) return;                 /* حالت نمایشی ذخیره‌سازی کامل خودش را دارد */
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(saveDraftNow, 4000);
}
function saveDraftNow() {
  const p = state.editingProject;
  if (!p || !state.dirty || !API.ok) return;
  try {
    readEditorFieldsInto(p);
    localStorage.setItem(DRAFT_PREFIX + p.id,
      JSON.stringify({ ts: Date.now(), pageIdx: state.pageIdx, project: p }));
  } catch (e) { /* حافظه پر بود — بی‌سروصدا رد شو */ }
}
function clearDraft(id) {
  try { localStorage.removeItem(DRAFT_PREFIX + id); } catch (e) { /* ignore */ }
}
function readDraft(id) {
  try { return JSON.parse(localStorage.getItem(DRAFT_PREFIX + id) || "null"); }
  catch (e) { return null; }
}
function scheduleRecalc(delay) {
  clearTimeout(_calcTimer);
  _calcTimer = setTimeout(recalcTotals, delay === undefined ? (API.ok ? 450 : 30) : delay);
}

async function recalcTotals() {
  const p = state.editingProject;
  if (!p) return;
  readTotalbarInto(p);
  let r;
  if (API.ok) {
    try {
      r = await API.req("POST", "/api/calc", { project: calcFields(p), pages: p.pages });
    } catch (e) {
      toast("خطا در محاسبه‌ی سرور: " + esc(e.message), "error");
      r = calcProjectLocal(p);
    }
  } else {
    r = calcProjectLocal(p);
  }
  state.lastResult = r;
  p.final_price = r.final_price;
  p.total_cost = r.total_cost;
  el("tbCost").innerHTML = money(r.total_cost);
  el("tbGross").innerHTML = money(r.gross_price);
  el("tbFinal").innerHTML = fmt(scaled(r.final_price));

  /* «متری چند؟» — زبان رایج بازار کابینت */
  const ppm = el("tbPerMeter");
  if (ppm) {
    ppm.innerHTML = r.price_per_ground_lm
      ? `${fmt(scaled(r.price_per_ground_lm))} <small>${CUR.name}/متر</small>`
      : "—";
    ppm.title = r.price_per_ground_lm
      ? `مبلغ نهایی ÷ ${fmt((r.stats || {}).total_ground_lm || 0, true)} متر طول زمینی`
        + (r.price_per_total_lm ? ` • هر متر طول کل (زمینی+دیواری): ${fmt(scaled(r.price_per_total_lm))}` : "")
      : "";
  }
  /* باقی‌مانده پس از پیش‌پرداخت */
  const dueWrap = el("tbDueWrap");
  if (dueWrap) {
    const has = (r.deposit_amount || 0) > 0;
    dueWrap.hidden = !has;
    if (has) el("tbDue").innerHTML = fmt(scaled(r.remaining_amount));
  }
  renderDimRibbon();
  updateComputedCells();
  updateTbSummary();
}

/* ══════════════════════════════════════════════════════════════════════════
   کشوی «تنظیمات مالی» در نوارِ جمع
   --------------------------------------------------------------------------
   پیش‌تر نوارِ جمع ۸ ورودی مالی را یک‌جا و همیشه باز نشان می‌داد؛ یعنی نیمی از
   ارتفاعِ صفحه صرفِ چیزهایی می‌شد که در ۹۰٪ مواقع دست‌نخورده می‌مانند
   (یافته‌ی F‑2). حالا نوار فقط «خلاصه» دارد و ورودی‌ها پشتِ یک کشو هستند.
   ولی خلاصه نباید پنهان‌کاری کند: آنچه فعال است همان‌جا دیده می‌شود.        */
function tbSummaryParts() {
  const parts = [];
  const mode = el("tbProfitMode") ? el("tbProfitMode").value : "markup";
  const pct = parseNum(el("tbProfitPct") ? el("tbProfitPct").value : "");
  if (pct) parts.push((mode === "margin" ? "مارجین " : "سود ") + fa(pct) + "٪");
  const im = el("tbInstallMode") ? el("tbInstallMode").value : "none";
  const iv = parseNum(el("tbInstallVal") ? el("tbInstallVal").value : "");
  if (im !== "none" && iv) {
    const lbl = { fixed: "نصب ", per_meter: "نصب متری ", percent: "نصب " }[im] || "نصب ";
    parts.push(lbl + fa(iv) + (im === "percent" ? "٪" : ""));
  }
  const dp = parseNum(el("tbDiscPct") ? el("tbDiscPct").value : "");
  const da = parseNum(el("tbDiscAmt") ? el("tbDiscAmt").value : "");
  if (dp) parts.push("تخفیف " + fa(dp) + "٪");
  else if (da) parts.push("تخفیف " + fmtInp(da));
  if (el("tbVat") && el("tbVat").checked) {
    parts.push("مالیات " + fa(parseNum(el("tbVatPct") ? el("tbVatPct").value : "") || 10) + "٪");
  }
  const ef = parseNum(el("tbExtraFixed") ? el("tbExtraFixed").value : "");
  if (ef) parts.push("ثابت " + fmtInp(ef));
  const dep = parseNum(el("tbDepositAmt") ? el("tbDepositAmt").value : "");
  const depp = parseNum(el("tbDepositPct") ? el("tbDepositPct").value : "");
  if (dep) parts.push("پیش‌پرداخت " + fmtInp(dep));
  else if (depp) parts.push("پیش‌پرداخت " + fa(depp) + "٪");
  const rs = +(el("tbRoundStep") ? el("tbRoundStep").value : 0);
  if (rs) parts.push("رُند به " + fmtInp(rs));
  return parts;
}
function updateTbSummary() {
  const host = el("tbSummary");
  if (!host) return;
  const parts = tbSummaryParts();
  host.textContent = parts.length ? parts.join(" • ") : "بدون تعدیل";
  host.title = parts.length ? parts.join(" • ") : "هیچ تعدیلِ مالی فعال نیست";
}
function setTbDrawer(open, persist) {
  const d = el("tbDrawer"), b = el("btnTbDrawer");
  if (!d || !b) return;
  d.hidden = !open;
  b.setAttribute("aria-expanded", open ? "true" : "false");
  b.classList.toggle("open", !!open);
  if (persist !== false) { try { localStorage.setItem("kabir.tbDrawer", open ? "1" : "0"); } catch (e) {} }
}
function readTotalbarInto(p) {
  p.profit_mode = el("tbProfitMode").value;
  p.profit_percent = parseNum(el("tbProfitPct").value);
  p.install_mode = el("tbInstallMode").value;
  p.install_value = parseNum(el("tbInstallVal").value);
  p.discount_percent = parseNum(el("tbDiscPct").value);
  p.discount_amount = parseNum(el("tbDiscAmt").value);
  p.vat_enabled = el("tbVat").checked;
  p.vat_percent = parseNum(el("tbVatPct").value);
  p.extra_fixed_amount = parseNum(el("tbExtraFixed").value);
  p.deposit_percent = parseNum(el("tbDepositPct").value);
  p.deposit_amount = parseNum(el("tbDepositAmt").value);
}

function readSectionBarInto() {
  const pg = curPage();
  if (!pg) return;
  pg.name = el("secName").value.trim() || pg.name;
  pg.waste_percent = parseNum(el("secWaste").value);
  pg.overhead_percent = parseNum(el("secOverhead").value);
  pg.countertop_lm = parseNum(el("secCounterLm").value);
  if (el("secWallLen")) pg.wall_length_cm = parseNum(el("secWallLen").value) * 100;
  pg.detail_mode = el("facadeMode").value;
  pg.detail_total_sqm = parseNum(el("facadeTotalSqm").value);
  pg.detail_price_per_sqm = parseNum(el("facadeTotalPrice").value);
}

function readEditorFieldsInto(p) {
  p.title = el("edTitle").value.trim() || p.title;
  p.status = el("edStatus").value;
  p.customer = el("edCustomer").value.trim();
  p.mobile = el("edMobile").value.trim();
  p.phone = el("edPhone").value.trim();
  p.address = el("edAddress").value.trim();
  p.valid_until = el("edValid").value.trim();
  readSectionBarInto();
  readTotalbarInto(p);
}

function openProjectEditor(id, withDraft) {
  /* ★ اگر کاربر وسطِ ویرایشِ پروژه‌ی دیگری باشد، بازکردنِ یک پروژه‌ی جدید
     نباید بی‌صدا کارِ قبلی را دور بریزد (نقضِ «جلوگیری از از دست رفتن داده»).
     مسیرِ async: ابتدا ذخیره‌ی بی‌صدا، و در صورتِ شکست، پرسشِ صریح.            */
  const cur = state.editingProject;
  if (cur && Number(cur.id) !== Number(id) && state.dirty && !withDraft) {
    (async () => {
      /* سیاستِ سخت‌گیرانه: حتی جابه‌جایی بین دو پروژه هم بی‌صدا نیست */
      const go = async () => { forceCloseEditor(); openProjectEditor(id, withDraft); };
      const act = await confirmDiscard(
        `پروژه‌ی «<b>${esc(cur.title)}</b>» تغییراتِ <b>ذخیره‌نشده</b> دارد.<br>` +
        "پیش از بازکردنِ پروژه‌ی دیگر تکلیفشان را روشن کنید.",
        {
          title: "جابه‌جایی با داده‌ی ذخیره‌نشده",
          okLabel: "دور ریختن و بازکردن",
          okTone: "danger",
          altLabel: "ذخیره و بازکردن",
          altTone: "success",
          cancelLabel: "ماندن روی همین پروژه",
          onAlt: async () => {
            const saver = MODAL_KEYS.saveActiveContext || (() => saveProject(true));
            const ok = await saver();
            if (ok !== false) await go();
          },
        });
      if (act) await go();
      else {
        if (state.page !== "projects") navigateNow("projects");
        el("projectEditor").scrollIntoView({ block: "start" });
      }
    })();
    return;
  }
  let p = PROJECTS.find((x) => x.id === Number(id));
  if (!p) return;
  /* ★ بازیابی پیش‌نویسِ ذخیره‌نشده (بعد از بسته‌شدنِ مرورگر/قطع برق) */
  if (withDraft && withDraft.project) {
    try {
      const np = normalizeProject(withDraft.project);
      Object.assign(p, np);
      p.id = Number(id);
      state.pageIdx = Math.min(Math.max(0, +withDraft.pageIdx || 0), Math.max(0, (p.pages || []).length - 1));
    } catch (e) { toast("بازیابی پیش‌نویس ناموفق بود", "error"); }
  }
  state.editingProject = p;
  if (!withDraft) state.pageIdx = 0;
  state.expanded.clear();
  el("projectEditor").hidden = false;
  /* کد و عنوانِ پروژه حالا در نوارِ فرمانِ چسبان دیده می‌شوند تا کاربر هنگام
     اسکرول در جدولِ بلند همیشه بداند «روی کدام پروژه» کار می‌کند.             */
  if (el("edCodeChip")) el("edCodeChip").textContent = p.code || "—";
  if (el("ebTitle")) el("ebTitle").textContent = p.title || "—";
  el("edTitle").value = p.title || "";
  el("edStatus").value = p.status || "draft";
  el("edStatusBadge").textContent = STATUS_LABEL[p.status] || p.status;
  el("edStatusBadge").className = "badge " + (STATUS_CLASS[p.status] || "b-draft");
  el("edCustomer").value = p.customer || "";
  el("edMobile").value = p.mobile || "";
  el("edPhone").value = p.phone || "";
  el("edAddress").value = p.address || "";
  el("edValid").value = p.valid_until || "";
  el("tbProfitMode").value = p.profit_mode || "markup";
  el("tbProfitPct").value = fa(p.profit_percent ?? 25);
  el("tbInstallMode").value = p.install_mode || "none";
  el("tbInstallVal").value = p.install_value ? fmtInp(p.install_value) : "";
  el("tbDiscPct").value = p.discount_percent ? fa(p.discount_percent) : "";
  el("tbDiscAmt").value = p.discount_amount ? fmtInp(p.discount_amount) : "";
  el("tbVat").checked = !!p.vat_enabled;
  el("tbVatPct").value = fa(p.vat_percent ?? 10);
  el("tbExtraFixed").value = p.extra_fixed_amount ? fmtInp(p.extra_fixed_amount) : "";
  if (el("tbDepositPct")) el("tbDepositPct").value = p.deposit_percent ? fa(p.deposit_percent) : "";
  if (el("tbDepositAmt")) el("tbDepositAmt").value = p.deposit_amount ? fmtInp(p.deposit_amount) : "";
  if (el("tbRoundStep")) el("tbRoundStep").value = "0";
  /* وضعیتِ کشوی مالی سلیقه‌ی کاربر است، نه ویژگیِ پروژه → از localStorage */
  {
    let openD = true;
    try { openD = localStorage.getItem("kabir.tbDrawer") !== "0"; } catch (e) {}
    setTbDrawer(openD, false);
  }
  updateTbSummary();
  clearDirty();
  renderSectionPills();
  renderSectionBar();
  renderTemplateSelect();
  renderEditorTables();
  refreshTbUnits();
  undoReset();
  recalcTotals();
  if (withDraft && withDraft.project) {
    markDirty("draft-restore");
    toast("پیش‌نویسِ ذخیره‌نشده بازیابی شد — برای قطعی‌شدن «ذخیره‌ی تغییرات» را بزنید", "warn");
  } else if (API.ok) {
    const d = readDraft(p.id);
    if (d && d.project && d.ts) {
      const when = new Date(d.ts);
      const hh = String(when.getHours()).padStart(2, "0"), mm = String(when.getMinutes()).padStart(2, "0");
      toast(`یک پیش‌نویسِ ذخیره‌نشده از ${hh}:${mm} پیدا شد — تغییراتی که ذخیره نکرده بودید`, "warn",
        { label: "بازیابی پیش‌نویس", cb: () => openProjectEditor(id, d) });
    }
  }
  if (p.stale && API.ok) {
    toast("این پروژه با نرخ‌های قدیمی متریال ذخیره شده بود — مبالغ زیر با نرخ روز بازمحاسبه شد. برای قطعی‌شدن، پروژه را ذخیره کنید.", "warn");
  }
  el("projectEditor").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeProjectEditor() {
  /* سه کنشِ ثابت (همان قراردادِ لایه‌ی مودال): ذخیره و بستن / ماندن / دور ریختن.
     کنشِ خطرناک عمداً قرمز و در کنارِ کنشِ امنِ سبز است تا انتخابِ درست آسان باشد. */
  if (!state.dirty) { forceCloseEditor(); return; }
  confirmDiscard(
    "ویرایشگر پروژه تغییراتِ <b>ذخیره‌نشده</b> دارد.<br>پیش از بستن تکلیفشان را روشن کنید.",
    {
      title: "بستنِ ویرایشگر",
      okLabel: "دور ریختن و بستن",
      okTone: "danger",
      altLabel: "ذخیره و بستن",
      altTone: "success",
      cancelLabel: "ماندن و ادامه‌ی ویرایش",
      onAlt: async () => {
        const ok = await saveProject();
        if (ok !== false) { forceCloseEditor(); toast("ذخیره شد و ویرایشگر بسته شد", "success"); }
      },
    }).then((discard) => {
      if (discard) { forceCloseEditor(); toast("تغییرات ذخیره‌نشده دور ریخته شد", "warn"); }
    });
}

async function saveProject(silentToast) {
  const p = state.editingProject;
  if (!p) return false;
  readEditorFieldsInto(p);
  await recalcTotals();
  if (API.ok) {
    try {
      const payload = Object.assign(invPayload(p), {
        status: p.status, final_price: p.final_price, total_cost: p.total_cost,
        pages: p.pages.map((pg) => ({ id: pg.id || undefined, name: pg.name, style_id: pg.style_id, data: pg })),
      });
      const resp = await API.req("PUT", `/api/projects/${p.id}`, payload);
      const np = normalizeProject(resp.project);
      PROJECTS[PROJECTS.indexOf(p)] = np;
      state.editingProject = np;
      state.pageIdx = Math.min(state.pageIdx, np.pages.length - 1);
      clearDirty();
      clearDraft(p.id);
      undoReset();
      renderSectionPills(); renderSectionBar(); renderEditorTables();
      renderProjects(); renderDashboard(); fillInvoiceProjects();
      if (!silentToast) toast("تغییرات پروژه در پایگاه‌داده ذخیره شد", "success");
      return true;
    } catch (e) {
      toast("ذخیره ناموفق: " + esc(e.message), "error");
      return false;
    }
  }
  clearDirty();
  renderProjects(); renderDashboard(); fillInvoiceProjects();
  demoSave();
  if (!silentToast) toast("تغییرات ذخیره شد (حالت نمایشی)", "success");
  return true;
}

function renderBreakdown() {
  const p = state.editingProject;
  const r = state.lastResult;
  if (!p || !r) return;
  const byGroup = new Map();
  for (const it of r.items) {
    if (!byGroup.has(it.group)) byGroup.set(it.group, { sum: 0, titles: new Set() });
    const g = byGroup.get(it.group);
    g.sum += it.amount;
    g.titles.add(it.title);
  }
  const ordered = [...byGroup.entries()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a[0]), ib = GROUP_ORDER.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const overheadSum = (r.pages || []).reduce((a, pg) => a + (pg.overhead_amount || 0), 0);
  /* ★ هشدارهای موتور محاسبه — مثلاً تیکِ «در از ورق بدنه» که به‌دلیلِ جا نشدنِ
     لنگه نادیده گرفته شده. بی‌سروصدا عددِ اشتباه نشان نمی‌دهیم.               */
  const warns = r.warnings || [];
  const warnHtml = warns.length ? `
    <div class="warn-box" role="status">
      <b>⚠ ${fa(String(warns.length))} هشدار در محاسبه</b>
      <ul>${warns.map((w) => `<li>${esc(String(w))}</li>`).join("")}</ul>
    </div>` : "";
  el("breakdownBody").innerHTML = warnHtml + `
    <table class="data">
      <thead><tr><th>گروه هزینه</th><th>اقلام</th><th>مبلغ (${CUR.name})</th></tr></thead>
      <tbody>
        ${ordered.map(([g, v]) => `
          <tr><td><b>${esc(g)}</b></td>
          <td class="sub">${esc([...v.titles].slice(0, 3).join(" • "))}${v.titles.size > 3 ? "…" : ""}</td>
          <td class="num">${fmt(scaled(v.sum))}</td></tr>`).join("")}
        ${overheadSum > 0 ? `<tr><td><b>سربار کارگاه</b></td><td class="sub">${(r.pages || []).filter((pg) => pg.overhead_amount > 0).map((pg) => `${esc(pg.name)}: ${fmt(pg.overhead_amount ? scaled(pg.overhead_amount) : 0)}`).join(" • ")}</td><td class="num">${fmt(scaled(overheadSum))}</td></tr>` : ""}
        <tr><td colspan="3" style="background:var(--surface-2);padding:.3rem"></td></tr>
        <tr><td><b>جمع هزینه‌ی تمام‌شده</b></td><td class="sub">شامل نصب: ${fmt(scaled(r.installation_cost))}</td><td class="num">${fmt(scaled(r.total_cost))}</td></tr>
        <tr><td><b>سود</b></td><td class="sub">${r.profit_mode === "margin" ? "مارجین" : "مارکاپ"} ${fmt(r.profit_percent, true)}٪</td><td class="num" style="color:var(--success)">${fmt(scaled(r.profit_amount))}</td></tr>
        <tr><td><b>قیمت ناخالص</b></td><td></td><td class="num">${fmt(scaled(r.gross_price))}</td></tr>
        ${r.discount_amount > 0 ? `<tr><td><b>تخفیف</b></td><td class="sub">${fmt(r.discount_percent)}٪ + ${fmt(scaled(p.discount_amount || 0))}</td><td class="num" style="color:var(--danger)">− ${fmt(scaled(r.discount_amount))}</td></tr>` : ""}
        ${r.vat_amount > 0 ? `<tr><td><b>مالیات بر ارزش افزوده</b></td><td class="sub">${fmt(r.vat_percent)}٪</td><td class="num">${fmt(scaled(r.vat_amount))}</td></tr>` : ""}
        <tr><td style="background:var(--accent);color:var(--on-accent)"><b>مبلغ قابل پرداخت</b></td>
            <td style="background:var(--accent)"></td>
            <td class="num" style="background:var(--accent);color:var(--on-accent);font-size:1.05rem">${fmt(scaled(r.final_price))} ${CUR.name}</td></tr>
        ${r.deposit_amount > 0 ? `
        <tr><td><b>پیش‌پرداخت</b></td><td class="sub">${fmt(r.deposit_percent, true)}٪ + ${fmt(scaled(p.deposit_amount || 0))}</td>
            <td class="num" style="color:var(--danger)">− ${fmt(scaled(r.deposit_amount))}</td></tr>
        <tr><td><b>باقی‌مانده (هنگام تحویل/نصب)</b></td><td></td>
            <td class="num"><b>${fmt(scaled(r.remaining_amount))} ${CUR.name}</b></td></tr>` : ""}
      </tbody>
    </table>
    <div class="stats-inline tiny muted" style="margin-top:.8rem">
      آمار فنی: ${fa(r.stats.total_units || 0)} یونیت •
      ${fmt(r.stats.total_ground_lm || 0, true)} متر زمینی •
      ${fmt(r.stats.total_wall_lm || 0, true)} متر دیواری •
      ${fa(Math.round(r.stats.total_sheets || 0))} ورق •
      ${fa(r.stats.total_doors || 0)} لنگه در •
      ${fa(r.stats.total_drawers || 0)} کشو •
      ${fmt(r.stats.total_body_area || 0, true)} م² بدنه
    </div>
    ${r.price_per_ground_lm ? `
    <div class="per-meter">
      <span>💬 چیزی که مشتری می‌پرسد:</span>
      <b>هر متر طول زمینی ${fmt(scaled(r.price_per_ground_lm))} ${CUR.name}</b>
      ${r.price_per_total_lm ? `<span class="sep">•</span><span>هر متر طول کل (زمینی+دیواری) <b>${fmt(scaled(r.price_per_total_lm))} ${CUR.name}</b></span>` : ""}
      ${r.cost_per_ground_lm ? `<span class="sep">•</span><span class="tiny muted">بهای تمام‌شده‌ی هر متر: ${fmt(scaled(r.cost_per_ground_lm))}</span>` : ""}
    </div>` : ""}`;
}

/* ================================================================ فاکتور */
function fillInvoiceProjects() {
  const cur = el("invProject").value;
  el("invProject").innerHTML = PROJECTS.filter((p) => p.status !== "canceled")
    .map((p) => `<option value="${p.id}">${esc(p.customer || "—")} — ${esc(p.title)} (${esc(p.code)})</option>`).join("");
  if (cur && [...el("invProject").options].some((o) => o.value === cur)) el("invProject").value = cur;
}
function invProject() {
  return PROJECTS.find((p) => p.id === Number(el("invProject").value)) || null;
}

function renderInvRowChecks() {
  const p = invProject();
  if (!p) { el("invRows").innerHTML = ""; return; }
  const r = calcProjectLocal(p);
  const groups = [...new Set(r.items.filter((i) => i.visible).map((i) => i.group))]
    .sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  el("invRows").innerHTML = groups.map((g) =>
    `<label class="check"><input type="checkbox" data-row="${esc(g)}"${state.inv.hidden.has(g) ? "" : " checked"}> ${esc(g)}</label>`).join("");
}

function readInvOptions() {
  state.inv.kind = el("invType").value;
  state.inv.mode = ($("#invLevel .active") || { dataset: { level: "grouped" } }).dataset.level;
  state.inv.hidden = new Set($$('#invRows input[type=checkbox]:not(:checked)').map((i) => i.dataset.row));
  state.inv.showCost = el("invShowCost").checked;
  state.inv.showStats = el("invShowStats").checked;
}

function demoInvoiceNumber(kind) {
  const prefix = kind === "invoice" ? "INV" : kind === "proforma" ? "PF" : "PI";
  return `${prefix}-1405-${fa(String(ARCHIVE.length + 5).padStart(4, "0"))}`;
}

async function refreshInvoice(forceNumberReset) {
  const p = invProject();
  readInvOptions();
  if (forceNumberReset) state.inv.number = "";
  if (!p) {
    el("invoiceSheet").innerHTML = `<div class="empty">${ICONS.inbox}<div>پروژه‌ای برای صدور فاکتور انتخاب نشده است.</div></div>`;
    el("invoiceSheet").classList.remove("hidden");
    el("invFrame").classList.add("hidden");
    return;
  }
  el("invValid").value = p.valid_until || "";
  el("invDate").value = TODAY_FA;
  if (API.ok) {
    const payload = {
      project: invPayload(p), pages: p.pages,
      kind: state.inv.kind, mode: state.inv.mode,
      hidden: [...state.inv.hidden], show_cost: state.inv.showCost, show_stats: state.inv.showStats,
    };
    if (state.inv.number) payload.number = state.inv.number;
    try {
      const resp = await API.req("POST", "/api/invoice/preview", payload);
      state.inv.payload = payload;
      state.inv.number = resp.data.number || "";
      el("invNumber").value = state.inv.number;
      el("invoiceSheet").classList.add("hidden");
      const f = el("invFrame");
      f.classList.remove("hidden");
      f.srcdoc = resp.html;
    } catch (e) {
      toast("خطا در ساخت فاکتور: " + esc(e.message), "error");
    }
  } else {
    const r = calcProjectLocal(p);
    if (!state.inv.number) state.inv.number = demoInvoiceNumber(state.inv.kind);
    el("invNumber").value = state.inv.number;
    const data = buildInvoiceDataDemo(r, p, {
      kind: state.inv.kind, mode: state.inv.mode, hidden: [...state.inv.hidden],
      show_cost: state.inv.showCost, show_stats: state.inv.showStats, number: state.inv.number,
    });
    state.inv.payload = null;
    el("invFrame").classList.add("hidden");
    const s = el("invoiceSheet");
    s.classList.remove("hidden");
    s.innerHTML = renderInvoiceSheet(data);
  }
}

function renderArchive() {
  const rows = applySort(ARCHIVE, "archive", ARCH_SORT);
  el("archiveTable").innerHTML = rows.length ? `
    <thead><tr>
      ${thSort("archive", "number", "شماره")}
      ${thSort("archive", "kind", "نوع")}
      ${thSort("archive", "project", "پروژه")}
      ${thSort("archive", "customer", "مشتری")}
      ${thSort("archive", "date", "تاریخ")}
      ${thSort("archive", "amount", `مبلغ (${CUR.name})`)}
      <th>عملیات</th>
    </tr></thead>
    <tbody>${rows.map((a) => `
      <tr>
        <td class="sub nowrap ltr">${esc(a.number)}</td>
        <td><span class="badge ${a.kind === "invoice" ? "b-done" : "b-final"}">${esc(a.kind_label || "پیش‌فاکتور")}</span></td>
        <td><b>${esc(a.project || "—")}</b></td>
        <td>${esc(a.customer || "—")}</td>
        <td class="sub nowrap">${esc(a.date)}</td>
        <td class="num">${fmt(scaled(a.amount))}</td>
        <td><div class="actions">
          ${iconBtn("", "eye", "مشاهده", `data-view-arch="${a.id}"`)}
          ${API.ok ? iconBtn("", "download", "PDF", `data-pdf-arch="${a.id}"`) : ""}
          ${iconBtn("del", "trash", "حذف از بایگانی", `data-del-arch="${a.id}"`)}
        </div></td>
      </tr>`).join("")}
    </tbody>`
    : `<tbody><tr><td><div class="empty">${ICONS.inbox}<div>فاکتوری صادر نشده است.</div></div></td></tr></tbody>`;
}

/* =============================================================== تنظیمات */
const SETTING_MAP = {
  setCompanyName: "company_name", setManager: "company_manager", setPhone: "company_phone",
  setMobile: "company_mobile", setEmail: "company_email", setWeb: "company_web",
  setAddress: "company_address", setInvTitle: "invoice_title", setInvFooter: "invoice_footer_note",
  setProfitMode: "default_profit_mode", setProfitPct: "default_profit_percent",
  setOverhead: "default_overhead_percent", setWaste: "default_waste_percent",
  setInstallMode: "default_install_mode", setInstallVal: "default_install_value",
  setSheetW: "sheet_width_cm", setSheetH: "sheet_height_cm",
  setFiberW: "fiber_sheet_width_cm", setFiberH: "fiber_sheet_height_cm",
  setBandBody: "banding_body_factor", setBandDoor: "banding_door_factor",
  setCurrency: "currency", setScale: "currency_scale", setVatPct: "vat_percent",
  /* ابعاد پیش‌فرض یونیت‌ها به تفکیک نوع */
  setGroundL: "unit_ground_length_cm", setGroundH: "unit_ground_height_cm",
  setGroundD: "unit_ground_depth_cm", setGroundS: "unit_ground_shelves",
  setWallL: "unit_wall_length_cm", setWallH: "unit_wall_height_cm",
  setWallD: "unit_wall_depth_cm", setWallS: "unit_wall_shelves",
  setTallL: "unit_tall_length_cm", setTallH: "unit_tall_height_cm",
  setTallD: "unit_tall_depth_cm", setTallS: "unit_tall_shelves",
};
const NUMERIC_SETTINGS = new Set(["setProfitPct", "setOverhead", "setWaste", "setInstallVal",
  "setSheetW", "setSheetH", "setFiberW", "setFiberH", "setBandBody", "setBandDoor",
  "setVatPct", "setBackupKeep",
  "setGroundL", "setGroundH", "setGroundD", "setGroundS",
  "setWallL", "setWallH", "setWallD", "setWallS",
  "setTallL", "setTallH", "setTallD", "setTallS"]);
/* مقادیر پیش‌فرض کارخانه — برای دکمه‌ی «بازنشانی پیش‌فرض‌ها» */
const FACTORY_NUM_SETTINGS = {
  setProfitPct: "30", setOverhead: "0", setWaste: "10", setInstallVal: "0", setVatPct: "10",
  setGroundL: "60", setGroundH: "72", setGroundD: "55", setGroundS: "1",
  setWallL: "60", setWallH: "70", setWallD: "30", setWallS: "1",
  setTallL: "60", setTallH: "220", setTallD: "58", setTallS: "2",
};

function fillSettings() {
  for (const [id, key] of Object.entries(SETTING_MAP)) {
    const v = SETTINGS[key];
    if (v === undefined || el(id) == null) continue;
    if (NUMERIC_SETTINGS.has(id)) el(id).value = fmtInp(v);
    else el(id).value = String(v);
  }
  el("swVatSet").checked = String(SETTINGS.vat_enabled) === "1";
  el("swFaDigits").checked = String(SETTINGS.persian_digits ?? "1") === "1";
  el("swAutoBackup").checked = String(SETTINGS.auto_backup ?? "1") === "1";
  el("setBackupKeep").value = fa(SETTINGS.backup_keep ?? 30);
  $$("#setTheme button").forEach((b) => b.classList.toggle("active", b.dataset.themeV === (SETTINGS.theme || "light")));
  const fs = SETTINGS.web_font_size || storeGet("kabir-fs", "14");
  el("setFontSize").value = fs;
  el("setFontSizeVal").textContent = fa(fs) + " پیکسل";
  el("dataDirNote").textContent = API.ok && DATA_DIR
    ? `مسیر داده‌ها: ${DATA_DIR}` : "در حالت نمایشی، داده‌ها فقط در حافظه‌ی مرورگر ذخیره می‌شوند.";
}

function collectSettings() {
  const out = {};
  for (const [id, key] of Object.entries(SETTING_MAP)) {
    if (el(id) == null) continue;
    out[key] = NUMERIC_SETTINGS.has(id) ? toEn(el(id).value) : el(id).value;
  }
  out.vat_enabled = el("swVatSet").checked ? "1" : "0";
  out.persian_digits = el("swFaDigits").checked ? "1" : "0";
  out.auto_backup = el("swAutoBackup").checked ? "1" : "0";
  out.backup_keep = toEn(el("setBackupKeep").value);
  out.theme = document.documentElement.dataset.theme;
  out.web_font_size = String(el("setFontSize").value);
  return out;
}

function applySettingsToUI() {
  DIGITS_FA = String(SETTINGS.persian_digits ?? "1") === "1";
  CUR.name = SETTINGS.currency === "ریال" ? "ریال" : "تومان";
  CUR.scale = Number(SETTINGS.currency_scale || 1) || 1;
  const fs = SETTINGS.web_font_size || storeGet("kabir-fs", null);
  if (fs) {
    document.documentElement.style.setProperty("--app-fs", fs + "px");
  }
  refreshTbUnits();
  setMfPriceHint();
}

function renderBackups() {
  el("backupsTable").innerHTML = BACKUPS.length ? `
    <thead><tr><th>نام نسخه</th><th>تاریخ</th><th>حجم</th><th>نوع</th><th>عملیات</th></tr></thead>
    <tbody>${BACKUPS.map((b) => `
      <tr>
        <td class="sub ltr">${esc(b.name)}</td>
        <td class="sub nowrap">${esc(b.date)}</td>
        <td class="sub">${esc(b.size)}</td>
        <td><span class="badge ${b.auto ? "b-done" : "b-draft"}">${b.auto ? "خودکار" : "دستی"}</span></td>
        <td><div class="actions">
          ${iconBtn("", "check", "بازیابی", `data-restore-bk="${esc(b.name)}"`)}
          ${iconBtn("del", "trash", "حذف", `data-del-bk="${esc(b.name)}"`)}
        </div></td>
      </tr>`).join("")}
    </tbody>`
    : `<tbody><tr><td><div class="empty">نسخه‌ی پشتیبانی وجود ندارد.</div></td></tr></tbody>`;
}

/* ------------------------------------------------------------ جست‌وجو */
function renderSearchDrop(q) {
  const drop = el("searchDrop");
  q = q.trim();
  if (!q) { drop.hidden = true; return; }
  const mats = MATERIALS.filter((m) => m.name.includes(q)).slice(0, 4);
  const projs = PROJECTS.filter((p) => p.title.includes(q) || (p.customer || "").includes(q) || p.code.includes(q)).slice(0, 4);
  const pages = Object.entries(PAGES).filter(([, v]) => v[0].includes(q) || v[1].includes(q));
  let html = "";
  if (pages.length) {
    html += `<div class="sd-group"><div class="sd-title">صفحه‌ها</div>` +
      pages.map(([k, v]) => `<button class="sd-item" type="button" data-sd-page="${k}">${v[0]}<span class="sd-meta">${v[1].slice(0, 28)}…</span></button>`).join("") + `</div>`;
  }
  if (projs.length) {
    html += `<div class="sd-group"><div class="sd-title">پروژه‌ها</div>` +
      projs.map((p) => `<button class="sd-item" type="button" data-sd-project="${p.id}">${esc(p.customer || "")} — ${esc(p.title)}<span class="sd-meta">${esc(p.code)}</span></button>`).join("") + `</div>`;
  }
  if (mats.length) {
    html += `<div class="sd-group"><div class="sd-title">متریال و خدمات</div>` +
      mats.map((m) => `<button class="sd-item" type="button" data-sd-mat="${esc(m.name)}">${esc(m.name)}<span class="sd-meta">${fmt(m.price)}</span></button>`).join("") + `</div>`;
  }
  if (!html) html = `<div class="sd-group"><div class="sd-title">نتیجه‌ای نیست</div><div style="padding:.4rem .9rem" class="tiny muted">عبارت دیگری را امتحان کنید.</div></div>`;
  drop.innerHTML = html;
  drop.hidden = false;
}

/* ------------------------------------------------------ ذخیره‌ی حالت نمایشی */
function demoSave() {
  if (API.ok) return;
  /* درزِ آزمون: «ذخیره‌ی واقعی» در حالت نمایشی هم باید قابلِ شمردن باشد تا
     تست‌ها بتوانند «دور ریختن» را از «ذخیره‌ی بی‌صدا» تشخیص دهند.            */
  try { window.__demoSaveCount = (window.__demoSaveCount || 0) + 1; } catch (e) {}
  try {
    localStorage.setItem("kabir-demo-db", JSON.stringify({
      materials: MATERIALS, styles: STYLES, projects: PROJECTS,
      history: HISTORY, archive: ARCHIVE, settings: SETTINGS,
      unit_templates: UNIT_TEMPLATES,
    }));
  } catch (e) { /* حافظه پر یا حالت خصوصی */ }
}

/* ================================================================ الگوی یونیت
   کابینت‌کار در هر پروژه همان یونیت‌های تکراری را می‌سازد. این‌جا یک یونیتِ
   کامل (ابعاد + متریال + درها + کشوها) یک‌بار ذخیره می‌شود و بعد با یک کلیک
   در هر پروژه‌ای قرار می‌گیرد. */
let _tplPendingUnit = null;

function renderTemplateSelect() {
  const sel = el("tplSelect");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">— انتخاب کنید —</option>` +
    UNIT_TEMPLATES.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("");
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function openTemplateSaveModal(unitIdx) {
  const pg = curPage();
  const u = pg && pg.units[unitIdx];
  if (!u) return;
  _tplPendingUnit = JSON.parse(JSON.stringify(u));
  el("tplName").value = u.label || "یونیت";
  el("tplNote").value = "";
  const doors = (u.doors || []).reduce((a, d) => a + (+d.qty || 0), 0);
  const drawers = (u.drawers || []).reduce((a, d) => a + (+d.qty || 0), 0);
  el("tplSummary").innerHTML =
    `${esc(UNIT_TYPES[u.unit_type] || u.unit_type)} • ` +
    `${fa(u.length_cm)}×${fa(u.height_cm)}×${fa(u.depth_cm)} سم • ` +
    `${fa(doors)} لنگه در • ${fa(drawers)} کشو • ${fa(u.shelves || 0)} طبقه` +
    `<br>متریال و یراق این یونیت هم همراه الگو ذخیره می‌شود.`;
  openModal("tpl-save");
  setTimeout(() => el("tplName").select(), 60);
}

async function saveUnitTemplate() {
  if (!_tplPendingUnit) return false;
  clearFieldErrors(el("modal-tpl-save"));
  const name = el("tplName").value.trim();
  if (!validateForm([
    ["tplName", (v) => !!v.trim(), "نام الگو را وارد کنید — در فهرستِ الگوها با همین نام می‌آید."],
  ])) return false;
  const note = el("tplNote").value.trim();
  const data = JSON.parse(JSON.stringify(_tplPendingUnit));
  data.label = name;
  if (API.ok) {
    try {
      const r = await API.req("POST", "/api/unit-templates", { name, note, data });
      UNIT_TEMPLATES = r.templates || [];
    } catch (e) { toast("ذخیره‌ی الگو ناموفق: " + esc(e.message), "error"); return false; }
  } else {
    const id = Math.max(0, ...UNIT_TEMPLATES.map((t) => +t.id || 0)) + 1;
    UNIT_TEMPLATES.push({ id, name, note, data, sort_order: UNIT_TEMPLATES.length });
    demoSave();
  }
  _tplPendingUnit = null;
  renderTemplateSelect();
  renderTemplatesTable();
  toast(`الگوی «${esc(name)}» ذخیره شد`, "success");
  return true;
}

function useTemplate() {
  const pg = curPage();
  const id = Number(el("tplSelect").value);
  const t = UNIT_TEMPLATES.find((x) => +x.id === id);
  if (!pg) return;
  if (!t) { toast("ابتدا یک الگو انتخاب کنید", "warn"); return; }
  const u = Object.assign(defaultUnit(t.data.unit_type), JSON.parse(JSON.stringify(t.data)));
  u.doors = (u.doors || []).map((d) => Object.assign(defaultDoor(), d));
  u.drawers = (u.drawers || []).map((d) => Object.assign(defaultDrawer(), d));
  pg.units.push(u);
  markDirty();
  renderEditorTables();
  scheduleRecalc(50);
  toast(`الگوی «${esc(t.name)}» اضافه شد`, "success");
}

function renderTemplatesTable() {
  const tbl = el("tplTable");
  if (!tbl) return;
  if (!UNIT_TEMPLATES.length) {
    tbl.innerHTML = `<tbody><tr><td><div class="empty">${ICONS.inbox}<div>الگویی ذخیره نشده — در جدول یونیت‌ها روی دکمه‌ی «الگو» بزنید.</div></div></td></tr></tbody>`;
    return;
  }
  tbl.innerHTML = `
    <thead><tr><th>نام الگو</th><th>نوع</th><th>ابعاد (سم)</th><th>در/کشو</th><th>یادداشت</th><th>عملیات</th></tr></thead>
    <tbody>${UNIT_TEMPLATES.map((t) => {
      const d = t.data || {};
      const doors = (d.doors || []).reduce((a, x) => a + (+x.qty || 0), 0);
      const drawers = (d.drawers || []).reduce((a, x) => a + (+x.qty || 0), 0);
      return `<tr>
        <td><b>${esc(t.name)}</b></td>
        <td class="sub">${esc(UNIT_TYPES[d.unit_type] || d.unit_type || "—")}</td>
        <td class="sub nowrap">${fa(d.length_cm)}×${fa(d.height_cm)}×${fa(d.depth_cm)}</td>
        <td class="sub nowrap">${fa(doors)} در / ${fa(drawers)} کشو</td>
        <td class="sub">${esc(t.note || "—")}</td>
        <td><div class="row-btns">
          <button class="row-actions" type="button" title="افزودن به بخش جاری" data-tpl-use="${t.id}">${ICONS.copy}</button>
          <button class="row-actions del" type="button" title="حذف الگو" data-tpl-del="${t.id}">${ICONS.trash}</button>
        </div></td>
      </tr>`; }).join("")}
    </tbody>`;
}

async function deleteTemplate(id) {
  if (API.ok) {
    try { const r = await API.req("DELETE", `/api/unit-templates/${id}`); UNIT_TEMPLATES = r.templates || []; }
    catch (e) { toast("حذف ناموفق: " + esc(e.message), "error"); return; }
  } else {
    UNIT_TEMPLATES = UNIT_TEMPLATES.filter((t) => +t.id !== +id);
    demoSave();
  }
  renderTemplatesTable(); renderTemplateSelect();
  toast("الگو حذف شد");
}

/* ============================================================== برش‌نامه
   همان چیزی که اپراتور ارّه و دستگاه نوارچسبان لازم دارد + برگه‌ی خرید. */
let _wsData = null;
let _wsTab = "cut";

async function openWorkshopModal() {
  const p = state.editingProject;
  if (!p) return;
  readEditorFieldsInto(p);
  const host = el("ws-cut");
  el("wsProjectName").textContent = `${p.title || ""} — ${p.code || ""}`.trim();
  openModal("workshop");
  host.innerHTML = `<div class="empty">در حال آماده‌سازی برش‌نامه…</div>`;
  el("ws-sheets").innerHTML = ""; el("ws-shop").innerHTML = "";
  let pack;
  if (API.ok) {
    try {
      pack = await API.req("POST", "/api/workshop",
        { project: calcFields(p), pages: p.pages });
    } catch (e) {
      host.innerHTML = `<div class="empty">خطا: ${esc(e.message)}</div>`;
      return;
    }
  } else {
    pack = buildWorkshopLocal(p);
  }
  _wsData = pack;
  renderWorkshop();
}

function renderWorkshop() {
  const d = _wsData;
  if (!d) return;
  const st = d.stats || {};
  el("wsStats").innerHTML = `
    <span class="dim-cell"><b>${fa(st.part_kinds || 0)}</b>نوع قطعه</span>
    <span class="dim-cell"><b>${fa(st.total_pieces || 0)}</b>قطعه برای برش</span>
    <span class="dim-cell"><b>${fmt(st.total_area_sqm || 0, true)}</b>مترمربع</span>
    <span class="dim-cell accent"><b>${fa(Math.round(st.total_sheets || 0))}</b>ورق لازم</span>
    <span class="dim-cell"><b>${fa(st.banding_pieces || 0)}</b>قطعه نوارخور</span>
    <span class="dim-cell"><b>${fmt(st.banding_perimeter_m || 0, true)}</b>متر نوار (محیط)</span>`;
  el("wsCntCut").textContent = fa(st.part_kinds || 0);
  el("wsCntSheets").textContent = fa((d.sheet_summary || []).length);
  el("wsCntShop").textContent = fa((d.shopping || []).length);

  /* --- برش‌نامه --- */
  const catLbl = { body_sheet: "بدنه", back_sheet: "فیبر پشت", door_sheet: "در", drawer_sheet: "جعبه کشو" };
  let lastKey = null;
  const rows = (d.cut_parts || []).map((c, i) => {
    const key = `${c.section}|${c.unit}`;
    const head = key !== lastKey
      ? `<tr class="cut-group"><td colspan="10">${esc(c.section)} — <b>${esc(c.unit)}</b></td></tr>` : "";
    lastKey = key;
    return `${head}<tr>
      <td class="sub">${fa(i + 1)}</td>
      <td>${esc(c.part)}</td>
      <td class="num"><b>${fa(c.qty)}</b></td>
      <td class="num ltr">${fa(Math.round(c.length_mm))}</td>
      <td class="num ltr">${fa(Math.round(c.width_mm))}</td>
      <td class="num">${fa(c.thickness_mm)} میل</td>
      <td class="sub">${esc(c.material)}</td>
      <td class="sub">${esc(catLbl[c.mat_cat] || c.mat_cat || "—")}</td>
      <td class="sub">${c.banding ? `<span class="chip-ok">${esc(c.banding_sides || "بله")}</span>` : `<span class="muted">—</span>`}</td>
      <td class="num sub">${fmt(c.area_sqm, true)}</td>
    </tr>`;
  }).join("");
  el("ws-cut").innerHTML = `
    <div class="table-wrap sticky-head"><table class="data cut-table">
      <thead><tr><th>#</th><th>قطعه</th><th>تعداد</th><th>طول (mm)</th><th>عرض (mm)</th>
      <th>ضخامت</th><th>متریال</th><th>نوع</th><th>نوار لبه</th><th>مساحت (م²)</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="10"><div class="empty">قطعه‌ای نیست.</div></td></tr>`}</tbody>
    </table></div>`;

  /* --- خلاصه‌ی ورق --- */
  el("ws-sheets").innerHTML = `
    <div class="table-wrap"><table class="data">
      <thead><tr><th>متریال / ورق</th><th>نوع</th><th>ضخامت</th><th>ابعاد ورق (سم)</th>
      <th>مساحت قطعات (م²)</th><th>تعداد قطعه</th><th>ورق لازم</th><th>بهای هر ورق</th><th>جمع</th></tr></thead>
      <tbody>${(d.sheet_summary || []).map((r) => `<tr>
        <td><b>${esc(r.material)}</b></td>
        <td class="sub">${esc(r.cats_label || catLbl[r.cat] || r.cat)}</td>
        <td class="num">${fa(r.thickness_mm)} میل</td>
        <td class="num ltr">${esc(r.sheet_size || "—")}</td>
        <td class="num">${fmt(r.area_sqm, true)}</td>
        <td class="num">${fa(r.pieces || 0)}</td>
        <td class="num"${r.note ? ` title="${esc(r.note)}"` : ""}><b class="sheet-badge">${fa(r.sheets)}</b></td>
        <td class="num">${r.price ? fmt(scaled(r.price)) : "—"}</td>
        <td class="num">${r.cost ? fmt(scaled(r.cost)) : "—"}</td>
      </tr>`).join("") || `<tr><td colspan="9"><div class="empty">ورقی لازم نیست.</div></td></tr>`}
      </tbody>
    </table></div>
    <p class="tiny muted" style="margin-top:.5rem">
      هر ردیف = یک متریالِ خریدنی؛ قطعاتِ هم‌جنس (مثلاً بدنه و در از یک ورق)
      در یک ردیف جمع می‌شوند. تعداد ورق با تجمیع در سطح هر بخش، احتساب پرت و
      یک‌بار گردکردن به بالا محاسبه می‌شود — دقیقاً همان چیزی که در فاکتور
      پولش گرفته شده و از انبار برمی‌دارید.
    </p>`;

  /* --- لیست خرید --- */
  el("ws-shop").innerHTML = (d.shopping_groups || []).map((g) => `
    <div class="shop-group">
      <div class="shop-head">
        <h4>${esc(g.label)}</h4>
        <span class="shop-sum">${fmt(scaled(g.total))} ${esc(CUR.name)}</span>
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>متریال / خدمت</th><th>مقدار</th><th>واحد</th><th>برآورد بها</th><th class="chk-col">خرید شد</th></tr></thead>
        <tbody>${g.rows.map((r) => `<tr>
          <td><b>${esc(r.name)}</b>${r.note ? `<div class="tiny muted">${esc(r.note)}</div>` : ""}</td>
          <td class="num"><b>${fmt(r.qty, true)}</b></td>
          <td class="sub">${esc(r.unit_label || "—")}</td>
          <td class="num">${fmt(scaled(r.amount))}</td>
          <td class="chk-col"><label class="check"><input type="checkbox" class="shop-check"></label></td>
        </tr>`).join("")}</tbody>
      </table></div>
    </div>`).join("") || `<div class="empty">قلمی برای خرید نیست.</div>`;

  /* تب فعال */
  $$("#wsTabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.wstab === _wsTab));
  $$(".ws-panel").forEach((pn) => pn.classList.toggle("active", pn.id === "ws-" + _wsTab));
}

async function downloadWorkshopExcel() {
  const p = state.editingProject;
  if (!p) return;
  if (!API.ok) { toast("خروجی اکسل فقط با سرور کبیر ممکن است (حالت نمایشی)", "warn"); return; }
  try {
    const blob = await API.blob("POST", "/api/workshop/xlsx", { project: calcFields(p), pages: p.pages });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `boresh-nameh-${p.code || p.id}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("فایل اکسل برش‌نامه و لیست خرید دانلود شد", "success");
  } catch (e) { toast("خطا در ساخت اکسل: " + esc(e.message), "error"); }
}

/* ============================================================== رند کردن
   هیچ‌کس فاکتور ۲۵۳٬۳۷۴٬۱۶۵ ریال نمی‌دهد. این تابع تخفیف را طوری تنظیم
   می‌کند که «مبلغ قابل پرداخت» دقیقاً به گام انتخابی گرد شود. */
function roundFinalPrice() {
  const p = state.editingProject;
  const r = state.lastResult;
  const step = Number(el("tbRoundStep").value || 0);
  if (!p || !r) return;
  if (!step) { toast("ابتدا گام رندکردن را انتخاب کنید", "warn"); return; }
  const final = r.final_price || 0;
  if (final <= 0) { toast("هنوز مبلغی محاسبه نشده", "warn"); return; }
  const target = Math.round(final / step) * step;
  if (target === Math.round(final)) { toast("مبلغ از قبل رُند است", "success"); return; }
  /* final = (gross − discount) × (۱ + vat) → discount = gross − final/(۱+vat) */
  const vatRate = 1 + (r.vat_percent || 0) / 100;
  const needDisc = r.gross_price - target / vatRate;
  if (needDisc < 0) {
    toast("برای رسیدن به این مبلغ باید تخفیف منفی بدهید — گام کوچک‌تری انتخاب کنید", "warn");
    return;
  }
  /* سهم تخفیف درصدی ثابت می‌ماند؛ بقیه در «مبلغ تخفیف» جبران می‌شود */
  const pctPart = r.gross_price * (r.discount_percent || 0) / 100;
  p.discount_amount = Math.max(0, Math.round(needDisc - pctPart));
  el("tbDiscAmt").value = p.discount_amount ? fmtInp(p.discount_amount) : "";
  markDirty();
  scheduleRecalc(30);
  toast(`مبلغ قابل پرداخت به ${fmt(scaled(target))} ${CUR.name} رُند شد (از راه تخفیف)`, "success");
}

/* ========================================================= قیمت‌گیری سریع
   مشتری زنگ زده و قیمت می‌خواهد — به‌جای ساختن دستیِ ۱۲ یونیت، فقط متراژ
   و سبک را می‌دهیم و یک پروژه‌ی واقعی ساخته می‌شود. */
function openQuickModal() {
  const st = el("qkStyle");
  /* گزینه‌ی «بدون سبک» عمداً حذف شده: بدون سبک هیچ متریالی به یونیت نمی‌چسبد
     و برآورد به «فقط اجرت» سقوط می‌کند. همیشه یک سبکِ واقعی انتخاب است. */
  st.innerHTML = STYLES.map((s) => `<option value="${s.id}">✦ ${esc(s.name)}</option>`).join("");
  if (STYLES.length) st.value = String(STYLES[0].id);
  el("qkCounter").innerHTML = `<option value="0">— بدون صفحه —</option>` +
    MATERIALS.filter((m) => m.cat === "countertop").map((m) =>
      `<option value="${m.id}">${esc(m.name)} — ${fmt(m.price)}/متر</option>`).join("");
  const prev = el("qkPreview");
  if (prev) { prev.hidden = true; prev.innerHTML = ""; }
  openModal("quick");
  setTimeout(() => el("qkTitle").focus(), 60);
}

function quickPayload() {
  return {
    title: el("qkTitle").value.trim(),
    customer: el("qkCustomer").value.trim(),
    mobile: el("qkMobile").value.trim(),
    ground_lm: parseNum(el("qkGround").value),
    wall_lm: parseNum(el("qkWall").value),
    style_id: Number(el("qkStyle").value) || 0,
    countertop_id: Number(el("qkCounter").value) || 0,
    countertop_lm: parseNum(el("qkCounterLm").value),
    drawers: parseNum(el("qkDrawers").value),
    tall: parseNum(el("qkTall").value),
  };
}

async function buildQuickProject() {
  const q = quickPayload();
  clearFieldErrors(el("modal-quick"));
  if (q.ground_lm <= 0 && q.wall_lm <= 0) {
    setFieldError("qkGround", "حداقل یکی از متراژهای زمینی یا دیواری لازم است.");
    setFieldError("qkWall", "حداقل یکی از متراژهای زمینی یا دیواری لازم است.");
    focusFirstError(el("modal-quick"));
    return false;
  }
  try {
    if (API.ok) {
      const r = await API.req("POST", "/api/quick-project", q);
      const np = normalizeProject(r.project);
      PROJECTS.unshift(np);
      renderProjects(); fillInvoiceProjects(); renderDashboard();
      closeModal("quick");
      openProjectEditor(np.id);
      const c = r.calc || {};
      toast(`پروژه ساخته شد — مبلغ برآوردی: ${fmt(scaled(c.final_price || 0))} ${CUR.name} • ابعاد را با اندازه‌ی واقعی چک کنید`, "success");
    } else {
      /* حالت نمایشی: همان منطق، محلی */
      let st = STYLES.find((x) => +x.id === +q.style_id);
      if (!st) st = STYLES[0] || {};          /* هم‌راستا با سمت سرور */
      const sid = st.id || q.style_id;
      const p = normalizeProject({
        id: Math.max(0, ...PROJECTS.map((x) => x.id)) + 1,
        code: `PR-DEMO-${fa(String(PROJECTS.length + 1).padStart(3, "0"))}`,
        title: q.title || "قیمت‌گیری سریع", customer: q.customer, mobile: q.mobile,
        status: "draft", date: TODAY_FA,
        profit_mode: (st.data || {}).profit_mode || "markup",
        profit_percent: (st.data || {}).profit_percent ?? 30,
        note: "ساخته‌شده با «قیمت‌گیری سریع» — ابعاد را با اندازه‌ی واقعی چک کنید.",
      });
      const pg = defaultPage(sid, "بخش ۱");
      pg.units = quickUnitsLocal(Object.assign({}, q, { style_id: sid }));
      pg.countertop_lm = q.countertop_id ? (q.countertop_lm || q.ground_lm) : 0;
      pg.wall_length_cm = q.ground_lm * 100;
      applyStyleToPage(pg, sid);
      p.pages = [pg];
      PROJECTS.unshift(p); demoSave();
      renderProjects(); fillInvoiceProjects(); renderDashboard();
      closeModal("quick");
      openProjectEditor(p.id);
      toast("پروژه ساخته شد (حالت نمایشی)", "success");
    }
    return true;
  } catch (e) {
    toast("خطا: " + esc(e.message), "error");
    return false;
  }
}

/* واسطه‌ی ثبتِ «قیمت‌گیری سریع» برای لایه‌ی مودال — اگر مودال بسته نشده باشد
   یعنی ساختِ پروژه ناموفق بوده و فرم باید باز بماند.                          */
async function buildQuickProjectGuarded() {
  await buildQuickProject();
  return !isModalOpen("quick");
}

/* ============================================================== سیم‌کشی */
function wire() {
  /* --- جداکننده‌ی هزارگان هنگام تایپ در همه‌ی فیلدهای عددی ---
     (قیمت‌ها، ابعاد، تعداد… — به‌جز فیلدهای درصدی با data-no-sep) */
  document.addEventListener("input", (e) => {
    if (isGroupedNumField(e.target)) formatNumberInput(e.target);
  });
  /* در focus هم مقدار برنامه‌نویسی‌شده‌ی گروه‌نیافته مرتب شود */
  document.addEventListener("focusin", (e) => {
    const t = e.target;
    if (isGroupedNumField(t) && t.value && !/[٬,]/.test(t.value)) {
      const g = fmtInp(t.value);
      if (g && g !== t.value) {
        const atEnd = t.selectionStart === t.value.length;
        t.value = g;
        if (atEnd) { try { t.setSelectionRange(g.length, g.length); } catch (err) { /* ignore */ } }
      }
    }
  });

  /* --- ناوبری --- */
  $$(".nav-btn").forEach((b) => b.addEventListener("click", () => navigate(b.dataset.page)));
  el("btnMenu").addEventListener("click", () => document.body.classList.toggle("nav-open"));
  el("scrim").addEventListener("click", () => document.body.classList.remove("nav-open"));
  $$("[data-goto]").forEach((a) => a.addEventListener("click", () => navigate(a.dataset.goto)));

  /* --- مرتب‌سازی جدول‌ها --- */
  wireTableSort(el("matTable"), "materials", renderMaterials);
  wireTableSort(el("projectsTable"), "projects", renderProjects);
  wireTableSort(el("archiveTable"), "archive", renderArchive);

  /* --- ساعت و به‌روزرسانی --- */
  startClock();
  el("btnRefresh").addEventListener("click", () => busy(el("btnRefresh"), async () => {
    if (API.ok) {
      const ok = await tryConnect(true);
      if (ok) { setConnBadge(); renderAll(); toast("داده‌ها از پایگاه‌داده به‌روزرسانی شد", "success"); }
      else { setConnBadge(); toast("اتصال به سرور قطع شد — حالت نمایشی فعال است", "warn"); }
    } else {
      await reconnectNow(null);
      if (API.ok) renderAll();
    }
  }));
  const br = el("btnBannerReconnect");
  if (br) br.addEventListener("click", () => busy(br, () => reconnectNow(null)));

  /* --- پوسته و قلم --- */
  el("btnTheme").addEventListener("click", () =>
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  $$("#setTheme button").forEach((b) => b.addEventListener("click", () => applyTheme(b.dataset.themeV)));
  el("setFontSize").addEventListener("input", (e) => {
    const v = e.target.value;
    document.documentElement.style.setProperty("--app-fs", v + "px");
    el("setFontSizeVal").textContent = fa(v) + " پیکسل";
    storeSet("kabir-fs", v);
    SETTINGS.web_font_size = v;
  });

  /* --- جست‌وجوی سراسری --- */
  const gs = el("globalSearch");
  gs.addEventListener("input", () => renderSearchDrop(gs.value));
  gs.addEventListener("focus", () => { if (gs.value.trim()) renderSearchDrop(gs.value); });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) el("searchDrop").hidden = true;
  });
  el("searchDrop").addEventListener("click", (e) => {
    const b = e.target.closest(".sd-item");
    if (!b) return;
    el("searchDrop").hidden = true;
    gs.value = "";
    if (b.dataset.sdPage) navigate(b.dataset.sdPage);
    else if (b.dataset.sdProject) { navigate("projects"); openProjectEditor(b.dataset.sdProject); }
    else if (b.dataset.sdMat !== undefined) {
      navigate("materials");
      el("matSearch").value = b.dataset.sdMat;
      state.matCat = "all";
      renderMaterials();
    }
  });

  /* --- میان‌برها و لایه‌ی مودال -------------------------------------------------
     یک هندلرِ سراسری با اولویتِ روشن:
       ۱) اگر مودالی باز است → Escape/Enter/Ctrl+S/Tab فقط به لایه‌ی مودال می‌رسد
          (contract در js/ui-modal.js: handleModalKeys).
       ۲) وگرنه → میان‌برهای صفحه: جست‌وجو، ناوبری، ذخیره، واگرد.
     نکته: ناوبری دیگر بی‌قید نیست؛ navigate() گاردِ «تغییرات ذخیره‌نشده» دارد.  */
  wireModalLayer();
  registerExitGuard(editorExitGuard);

  document.addEventListener("keydown", (e) => {
    /* جست‌وجوی سراسری با «/» — فقط وقتی تایپ نمی‌کنید و مودالی باز نیست */
    if (e.key === "/" && !anyModalOpen() && !isTypingTarget(document.activeElement)) {
      e.preventDefault(); gs.focus();
      return;
    }
    if (anyModalOpen()) {
      if (handleModalKeys(e)) return;         /* رویداد مصرف شد */
    } else {
      /* Ctrl+S در زمینه‌ی صفحه (بدونِ مودال) */
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "s") {
        if (handleModalKeys(e)) return;
      }
      if (e.key === "Escape") {
        el("searchDrop").hidden = true;
        document.body.classList.remove("nav-open");
        return;
      }
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-6]$/.test(e.key)) {
      e.preventDefault();
      navigate(Object.keys(PAGES)[Number(e.key) - 1]);
      return;
    }
    /* ★ واگرد/بازانجامِ ویرایشگر — وقتی فوکوس داخل فیلد متنی نیست
       (داخل فیلد، واگردِ خودِ مرورگر برای تایپ کار می‌کند). */
    if ((e.ctrlKey || e.metaKey) && state.editingProject &&
        !el("projectEditor").hidden && !anyModalOpen()) {
      const ae = document.activeElement;
      const inText = ae && /input|textarea/i.test(ae.tagName) && ae.type !== "checkbox";
      if (!inText && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) {
        const did = (e.key.toLowerCase() === "y" || e.shiftKey) ? doRedo() : doUndo();
        if (did) e.preventDefault();
      }
    }
  });

  /* ★ بستنِ تب/مرورگر: هم در حالت متصل و هم نمایشی هشدار می‌دهیم.
     قبلاً در حالت نمایشی بی‌صدا کارِ کاربر می‌رفت.                            */
  window.addEventListener("beforeunload", (e) => {
    if (state.dirty || anyModalDirty()) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ثبتِ «شناسنامه‌ی» هر مودالِ دارای فرم: چه چیزی ثبت می‌کند، با کدام دکمه،
     چه برچسبی در هشدارِ «تغییرات ذخیره‌نشده» داشته باشد و راهنمای کلیدش چه باشد.
     توابع با «ارجاع» پاس داده می‌شوند نه با نام روی window — چون اسکریپت‌ها
     strict اجرا می‌شوند و در strict تابعِ سطح‌بالا به window نمی‌چسبد.          */
  registerModalForms({
    saveMaterialForm, applyBulkPrices, saveStyleForm, createProjectForm,
    buildQuickProjectGuarded, saveUnitTemplate,
  });

  /* کنشِ «ثبت» با Enter/Ctrl+S در زمینه‌ی صفحه (وقتی مودالی باز نیست) */
  MODAL_KEYS.contextSave = () => {
    if (state.editingProject && !el("projectEditor").hidden && state.page === "projects") return saveProject();
    if (state.page === "settings") return el("btnSaveSettings").click();
    return null;
  };

  /* ---------------- داشبورد ---------------- */
  el("btnDashHistory").addEventListener("click", async () => {
    navigate("materials");
    el("historyCard").hidden = false;
    if (API.ok) { try { HISTORY = (await API.req("GET", "/api/price-history")).history; } catch (e) { /* ignore */ } }
    renderHistory();
  });
  el("recentProjects").addEventListener("click", (e) => {
    const b = e.target.closest("[data-open-project]");
    if (b) { navigate("projects"); openProjectEditor(b.dataset.openProject); }
  });
  el("btnQuickProject").addEventListener("click", () => { navigate("projects"); openNewProjectModal(); });

  /* ---------------- متریال ---------------- */
  el("matSearch").addEventListener("input", renderMaterials);
  el("matChips").addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    state.matCat = c.dataset.cat;
    renderMaterials();
  });
  el("btnMatHistory").addEventListener("click", async () => {
    el("historyCard").hidden = !el("historyCard").hidden;
    if (!el("historyCard").hidden) {
      if (API.ok) { try { HISTORY = (await API.req("GET", "/api/price-history")).history; } catch (e) { /* ignore */ } }
      renderHistory();
    }
  });
  el("btnCloseHistory").addEventListener("click", () => (el("historyCard").hidden = true));
  el("btnMatExcel").addEventListener("click", async () => {
    if (!API.ok) { toast("خروجی اکسل در حالت نمایشی فعال نیست — کبیر را اجرا کنید: python main.py", "warn"); return; }
    try {
      const f = await API.blob("GET", "/api/materials/export");
      downloadBlob(f.bytes, f.name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      toast("خروجی اکسل دانلود شد", "success");
    } catch (e) { toast("خطا: " + esc(e.message), "error"); }
  });

  el("btnNewMaterial").addEventListener("click", () => {
    state.editingMaterial = null;
    el("matModalTitle").textContent = "قلم جدید";
    ["mfName", "mfPrice", "mfThick", "mfSheetW", "mfSheetH", "mfWidth", "mfSupplier", "mfNote"].forEach((i) => (el(i).value = ""));
    el("mfCat").value = state.matCat !== "all" ? state.matCat : "body_sheet";
    el("mfUnit").value = "sheet";
    el("mfStatus").checked = true;
    setMfPriceHint();
    openModal("material");
  });

  function matPayload() {
    return {
      name: el("mfName").value.trim(),
      cat: el("mfCat").value,
      unit: el("mfUnit").value,
      price: parseNum(el("mfPrice").value),
      thickness_mm: parseNum(el("mfThick").value),
      sheet_width_cm: parseNum(el("mfSheetW").value),
      sheet_height_cm: parseNum(el("mfSheetH").value),
      width_cm: parseNum(el("mfWidth").value),
      supplier: el("mfSupplier").value.trim(),
      note: el("mfNote").value.trim(),
      active: el("mfStatus").checked,
    };
  }

  el("matTable").addEventListener("click", async (e) => {
    const edit = e.target.closest("[data-edit-mat]");
    const del = e.target.closest("[data-del-mat]");
    const tog = e.target.closest("[data-toggle-mat]");
    if (edit) {
      const m = MATERIALS.find((x) => x.id === +edit.dataset.editMat);
      state.editingMaterial = m;
      el("matModalTitle").textContent = "ویرایش: " + m.name;
      el("mfName").value = m.name;
      el("mfCat").value = m.cat;
      el("mfUnit").value = m.unit;
      el("mfPrice").value = fmtInp(m.price);
      el("mfThick").value = m.thickness_mm ? fa(m.thickness_mm) : "";
      el("mfSheetW").value = m.sheet_width_cm ? fa(m.sheet_width_cm) : "";
      el("mfSheetH").value = m.sheet_height_cm ? fa(m.sheet_height_cm) : "";
      el("mfWidth").value = m.width_cm ? fa(m.width_cm) : "";
      el("mfSupplier").value = m.supplier || "";
      el("mfNote").value = m.note || "";
      el("mfStatus").checked = !!m.active;
      setMfPriceHint();
      openModal("material");
    } else if (del) {
      const m = MATERIALS.find((x) => x.id === +del.dataset.delMat);
      const finishDelete = (resp) => {
        /* قلم حذف‌شده ممکن است در پروژه‌ها بوده باشد — سرور بازمحاسبه می‌کند */
        const nRecalc = ingestPriceRefresh(resp);
        afterMaterialsChanged();
        toast("متریال حذف شد" + (nRecalc ? ` — قیمت ${fa(nRecalc)} پروژه بازمحاسبه شد` : ""), "success");
      };
      askConfirm(`«<b>${esc(m.name)}</b>» برای همیشه حذف شود؟`, async () => {
        if (!API.ok) {
          MATERIALS.splice(MATERIALS.indexOf(m), 1);
          demoSave();
          finishDelete(null);
          return;
        }
        try {
          const resp = await API.req("DELETE", `/api/materials/${m.id}`);
          MATERIALS = resp.materials;
          finishDelete(resp);
        } catch (err) {
          if (err && err.status === 409) {
            /* ★ قلم در پروژه‌ها استفاده شده — سرور بدون تأییدِ صریح حذف نمی‌کند
               (حذفِ بی‌صدا یعنی قیمت پروژه‌ها بی‌خبر ارزان می‌شد!) */
            askInfo(esc(err.message), async () => {
              try {
                const resp2 = await API.req("DELETE", `/api/materials/${m.id}`, { force: true });
                MATERIALS = resp2.materials;
                finishDelete(resp2);
              } catch (err2) {
                toast("حذف ناموفق: " + esc(err2.message), "error");
              }
            }, "حذف اجباری");
            return;
          }
          toast("حذف ناموفق: " + esc(err.message), "error");
        }
      }, "حذف متریال");
    } else if (tog) {
      const m = MATERIALS.find((x) => x.id === +tog.dataset.toggleMat);
      if (API.ok) {
        try { MATERIALS = (await API.req("POST", `/api/materials/${m.id}/toggle`)).materials; }
        catch (err) { toast("خطا: " + esc(err.message), "error"); return; }
      } else { m.active = !m.active; demoSave(); }
      afterMaterialsChanged();
      toast(`«${esc(m.name)}» ${m.active ? "فعال" : "غیرفعال"} شد`);
    }

    /* ★ ویرایش سریعِ قیمت، درجا در همان سلول — پرتکرارترین کارِ روزمره
       (نرخِ صبحِ بازار) بدونِ بازشدنِ مودال و گشتن دنبال فیلد قیمت.
       کلیک → عدد را بزنید → Enter. سرور خودش همه‌ی پروژه‌ها را با نرخِ
       جدید بازمحاسبه می‌کند و قیمت‌های کهنه هشدار می‌گیرند.                   */
    const qp = e.target.closest("[data-quick-price]");
    if (qp && !qp.querySelector("input")) {
      const m = MATERIALS.find((x) => x.id === +qp.dataset.quickPrice);
      if (!m) return;
      const old = m.price;
      qp.textContent = "";
      const inp2 = document.createElement("input");
      inp2.type = "text";
      inp2.inputMode = "numeric";
      inp2.value = String(Math.round(+old || 0));
      inp2.setAttribute("aria-label", `قیمت ${m.name}`);
      qp.appendChild(inp2);
      inp2.focus();
      inp2.select();
      let done = false;
      const cancel = () => { if (done) return; done = true; renderMaterials(); };
      const commit = async () => {
        if (done) return;
        done = true;
        const nv = parseNum(inp2.value);
        if (!(nv > 0)) { toast("قیمت معتبر وارد کنید", "error"); renderMaterials(); return; }
        if (Math.abs(nv - old) < 0.005) { renderMaterials(); return; }
        if (API.ok) {
          try {
            const resp = await API.req("PUT", `/api/materials/${m.id}`, { price: nv });
            MATERIALS = resp.materials;
            const nRecalc = ingestPriceRefresh(resp);
            afterMaterialsChanged();
            toast(`«${esc(m.name)}»: ${fmt(old)} ← <b>${fmt(nv)}</b> ${CUR.name}`
              + (nRecalc ? ` — قیمت ${fa(nRecalc)} پروژه هم به‌روز شد` : ""), "success");
          } catch (err) {
            toast("ذخیره ناموفق: " + esc(err.message), "error");
            renderMaterials();
          }
        } else {
          HISTORY.unshift({ id: Date.now(), date: TODAY_FA, name: m.name, old, price: nv,
            pct: (nv - old) / (old || 1) * 100, reason: "ویرایش سریع" });
          m.price = nv;
          demoSave();
          afterMaterialsChanged();
          toast(`«${esc(m.name)}»: ${fmt(old)} ← <b>${fmt(nv)}</b> ${CUR.name}`, "success");
        }
      };
      /* ناوبریِ کیبوردیِ «نرخِ صبحِ بازار»:
         اپراتور صبح ده‌ها قیمت را پشتِ سر هم به‌روز می‌کند. پس Tab باید مثلِ
         یک جدولِ ورودِ داده کار کند: ثبت + رفتن به قیمتِ بعدی. Shift+Tab به
         قبلی، Enter ثبت و ماندن، Escape انصراف. بدونِ این، بعدِ هر ثبت کل
         جدول از نو رندر می‌شد و فوکوس به body می‌پرید — یعنی هر قلم یک
         «برگشت به اولِ صفحه» هزینه داشت (یافته‌ی K‑3).                        */
      /* مقصدِ Tab را «پیش از» ثبت نگه می‌داریم: ثبت جدول را از نو رندر
         می‌کند، پس سلولِ فعلی از DOM بیرون می‌رود و باید مقصد را از روی
         فهرستِ «پیش از رندر» پیدا کنیم.                                       */
      const planNext = (dir) => {
        const cells = [...document.querySelectorAll("[data-quick-price]")];
        const here = cells.findIndex((c) => +c.dataset.quickPrice === +m.id);
        if (here < 0) return null;
        const i = here + dir;
        return (i >= 0 && i < cells.length) ? +cells[i].dataset.quickPrice : null;
      };
      const moveTo = async (dir) => {
        const target = planNext(dir);
        _qpNavTarget = target;
        if (target === null) {
          toast(dir > 0 ? "به آخرین قیمتِ فهرست رسیدید" : "به اولین قیمتِ فهرست رسیدید", "info");
          _qpNavTarget = null;
        }
        await commit();
      };
      inp2.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); commit(); }
        else if (ev.key === "Escape") { ev.preventDefault(); _qpNavTarget = null; cancel(); }
        else if (ev.key === "Tab") { ev.preventDefault(); moveTo(ev.shiftKey ? -1 : 1); }
        ev.stopPropagation();
      });
      inp2.addEventListener("blur", () => setTimeout(commit, 120));
      return;
    }
  });

  el("mfUnit").addEventListener("change", setMfPriceHint);

  /* ★ ثبتِ فرمِ متریال — هم با کلیک، هم با Enter/Ctrl+S (از لایه‌ی مودال).
     خطای اعتبارسنجی کنارِ خودِ فیلد نشان داده می‌شود و فوکوس روی اولین
     فیلدِ خطادار می‌رود؛ دیگر لازم نیست کاربر دنبالِ توست بگردد.             */
  async function saveMaterialForm() {
    clearFieldErrors(el("modal-material"));
    const payload = matPayload();
    if (!validateForm([
      ["mfName", (v) => !!v.trim(), "نام قلم را وارد کنید — بدون نام، در فهرست‌ها پیدا نمی‌شود."],
      ["mfPrice", (v) => parseNum(v) > 0, "قیمت باید عددی بزرگ‌تر از صفر باشد."],
    ])) return false;
    let resp = null;
    if (API.ok) {
      try {
        resp = state.editingMaterial
          ? await API.req("PUT", `/api/materials/${state.editingMaterial.id}`, payload)
          : await API.req("POST", "/api/materials", payload);
        MATERIALS = resp.materials;
      } catch (err) { toast("ذخیره ناموفق: " + esc(err.message), "error"); return false; }
    } else {
      if (state.editingMaterial) {
        const m = state.editingMaterial;
        if (m.price !== payload.price) {
          HISTORY.unshift({ id: Date.now(), date: TODAY_FA, name: m.name, old: m.price, price: payload.price, pct: (payload.price - m.price) / (m.price || 1) * 100, reason: "ویرایش دستی" });
        }
        Object.assign(m, payload);
      } else {
        MATERIALS.push(Object.assign({ id: Math.max(0, ...MATERIALS.map((m) => m.id)) + 1 }, payload));
      }
      demoSave();
    }
    /* اگر قیمت تغییر کرده باشد، سرور همه‌ی پروژه‌ها را بازمحاسبه کرده است */
    const nRecalc = ingestPriceRefresh(resp);
    afterMaterialsChanged();
    toast(state.editingMaterial
      ? "تغییرات قلم ذخیره شد" + (nRecalc ? ` — قیمت ${fa(nRecalc)} پروژه هم با نرخ جدید به‌روز شد` : "")
      : "قلم جدید ذخیره شد", "success");
    return true;      /* لایه‌ی مودال خودش می‌بندد و نشانِ «ذخیره‌نشده» را پاک می‌کند */
  }
  el("btnSaveMaterial").addEventListener("click", () => submitModal("material"));
  function afterMaterialsChanged() {
    renderMaterials();
    fillStyleSelects();
    if (!API.ok) {
      /* حالت نمایشی: مبلغ پروژه‌ها با نرخ‌های جاری بازخوانی شود */
      for (const p of PROJECTS) {
        const r = calcProjectLocal(p);
        p.final_price = r.final_price;
        p.total_cost = r.total_cost;
        p.stale = false;
      }
      renderProjects();
    }
    renderDashboard();
    if (state.editingProject) { renderSectionBar(); renderEditorTables(); scheduleRecalc(100); }
  }

  /* --- تغییر دسته‌جمعی --- */
  el("btnBulkPrice").addEventListener("click", () => {
    el("bulkPct").value = "";
    el("bulkReason").value = "";
    $$(".pct-chip").forEach((c) => c.classList.remove("active"));
    openModal("bulk");
  });
  $$(".pct-chip").forEach((chip) => chip.addEventListener("click", () => {
    $$(".pct-chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    el("bulkPct").value = fa(chip.dataset.pct);
  }));
  async function applyBulkPrices() {
    clearFieldErrors(el("modal-bulk"));
    const pct = parseNum(el("bulkPct").value);
    if (!validateForm([
      ["bulkPct", (v) => parseNum(v) !== 0, "درصد تغییر را وارد کنید (مثلاً ۱۰ یا ۵−)."],
    ])) return false;
    const scope = ($("input[name=bulkScope]:checked") || {}).value;
    const reason = el("bulkReason").value.trim() || "به‌روزرسانی نرخ بازار";
    const cat = scope === "cat" && state.matCat !== "all" ? state.matCat : null;
    if (API.ok) {
      try {
        const resp = await API.req("POST", "/api/materials/bulk", { cat, percent: pct, reason });
        MATERIALS = resp.materials;
        HISTORY = resp.history || HISTORY;
        /* پروژه‌ها هم با نرخ جدید بازمحاسبه شده‌اند — نتایج ادغام شود */
        const nRecalc = ingestPriceRefresh(resp);
        afterMaterialsChanged();
        renderHistory();
        toast(`قیمت ${fa(resp.count)} قلم به‌روز شد (${pct > 0 ? "+" : ""}${fmt(pct, true)}٪)` +
          (nRecalc ? ` — قیمت ${fa(nRecalc)} پروژه هم خودکار با نرخ جدید بازمحاسبه شد` : ""), "success");
      } catch (err) { toast("خطا: " + esc(err.message), "error"); return false; }
      return true;
    }
    let count = 0;
    MATERIALS.forEach((m) => {
      if (cat && m.cat !== cat) return;
      const old = m.price;
      m.price = Math.round((old * (1 + pct / 100)) / 1000) * 1000;
      if (m.price !== old) {
        HISTORY.unshift({ id: Date.now() + count, date: TODAY_FA, name: m.name, old, price: m.price, pct, reason });
        count++;
      }
    });
    demoSave();
    afterMaterialsChanged();
    renderHistory();
    toast(`قیمت ${fa(count)} قلم به‌روز شد (${pct > 0 ? "+" : ""}${fmt(pct, true)}٪)`, "success");
    return true;
  }
  el("btnApplyBulk").addEventListener("click", () => submitModal("bulk"));
  /* ---------------- سبک‌ها ---------------- */
  function openStyleModal(st) {
    if (!st && STYLES.length >= 20) { toast("حداکثر ۲۰ سبک مجاز است", "warn"); return; }
    state.editingStyle = st || null;
    el("styleModalTitle").textContent = st ? "ویرایش سبک: " + st.name : "تعریف سبک";
    fillStyleSelects();
    el("sfName").value = st ? st.name : "";
    el("sfNote").value = st ? (st.note || "") : "";
    el("sfWaste").value = fa(st && st.data.waste_percent ? st.data.waste_percent : 8);
    el("sfOverhead").value = fa(st && st.data.overhead_percent ? st.data.overhead_percent : 5);
    for (const [id, [key]] of Object.entries(STYLE_SELECTS)) {
      el(id).value = (st && st.data && st.data[key]) || "";
    }
    openModal("style");
  }
  el("btnNewStyle").addEventListener("click", () => openStyleModal(null));

  function stylePayload() {
    const data = {};
    for (const [id, [key]] of Object.entries(STYLE_SELECTS)) {
      const v = el(id).value;
      if (v) data[key] = v;
    }
    data.waste_percent = parseNum(el("sfWaste").value);
    data.overhead_percent = parseNum(el("sfOverhead").value);
    return { name: el("sfName").value.trim(), note: el("sfNote").value.trim(), data };
  }

  async function saveStyleForm() {
    clearFieldErrors(el("modal-style"));
    const payload = stylePayload();
    if (!validateForm([
      ["sfName", (v) => !!v.trim(), "نام سبک را وارد کنید — در فهرستِ بخش‌ها با همین نام پیدا می‌شود."],
    ])) return false;
    if (API.ok) {
      try {
        const resp = state.editingStyle
          ? await API.req("PUT", `/api/styles/${state.editingStyle.id}`, payload)
          : await API.req("POST", "/api/styles", payload);
        STYLES = resp.styles;
      } catch (err) { toast("ذخیره ناموفق: " + esc(err.message), "error"); return false; }
    } else {
      if (state.editingStyle) Object.assign(state.editingStyle, payload);
      else STYLES.push(Object.assign({ id: Math.max(0, ...STYLES.map((s) => s.id)) + 1 }, payload));
      demoSave();
    }
    renderStyles();
    if (state.editingProject) renderSectionBar();
    toast("سبک ذخیره شد", "success");
    return true;
  }
  el("btnSaveStyle").addEventListener("click", () => submitModal("style"));
  el("stylesGrid").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-use-style],button[data-edit-style],button[data-copy-style],button[data-del-style],button[data-new-style]");
    if (!btn) return;
    if (btn.hasAttribute("data-new-style")) { openStyleModal(null); return; }
    const id = +(btn.dataset.useStyle || btn.dataset.editStyle || btn.dataset.copyStyle || btn.dataset.delStyle);
    const st = STYLES.find((x) => x.id === id);
    if (!st) return;
    if (btn.dataset.useStyle !== undefined) {
      navigate("projects");
      openNewProjectModal(st.id);
    } else if (btn.dataset.editStyle !== undefined) {
      openStyleModal(st);
    } else if (btn.dataset.copyStyle !== undefined) {
      if (STYLES.length >= 20) { toast("حداکثر ۲۰ سبک مجاز است", "warn"); return; }
      if (API.ok) {
        try { STYLES = (await API.req("POST", `/api/styles/${id}/duplicate`)).styles; }
        catch (err) { toast("خطا: " + esc(err.message), "error"); return; }
      } else {
        STYLES.push({ id: Math.max(0, ...STYLES.map((x) => x.id)) + 1, name: st.name + " (کپی)", note: st.note, data: JSON.parse(JSON.stringify(st.data)) });
        demoSave();
      }
      renderStyles();
      toast("سبک کپی شد", "success");
    } else if (btn.dataset.delStyle !== undefined) {
      askConfirm(`سبک «<b>${esc(st.name)}</b>» حذف شود؟`, async () => {
        if (API.ok) {
          try { STYLES = (await API.req("DELETE", `/api/styles/${id}`)).styles; }
          catch (err) { toast("خطا: " + esc(err.message), "error"); return; }
        } else {
          STYLES.splice(STYLES.indexOf(st), 1);
          demoSave();
        }
        renderStyles();
        toast("سبک حذف شد", "success");
      }, "حذف سبک");
    }
  });

  /* ---------------- پروژه‌ها ---------------- */
  el("projSearch").addEventListener("input", renderProjects);
  el("projFilter").addEventListener("change", renderProjects);
  el("btnNewProject").addEventListener("click", () => openNewProjectModal());
  const btnRecalc = el("btnRecalcAll");
  if (btnRecalc) btnRecalc.addEventListener("click", () => busy(btnRecalc, async () => {
    if (!API.ok) { toast("بازمحاسبه در حالت نمایشی لازم نیست — مبلغ‌ها همیشه با نرخ جاری‌اند", "info"); return; }
    try {
      const resp = await API.req("POST", "/api/projects/recalc-all", {});
      ingestPriceRefresh(resp);
      toast(`قیمت ${fa(resp.count)} پروژه با نرخ‌های جاری بازمحاسبه شد`, "success");
    } catch (e) { toast("خطا در بازمحاسبه: " + esc(e.message), "error"); }
  }));

  function openNewProjectModal(preStyleId) {
    ["pfTitle", "pfCustomer", "pfMobile"].forEach((i) => (el(i).value = ""));
    el("pfStyle").innerHTML = STYLES.length
      ? STYLES.map((s) => `<option value="${s.id}">✦ ${esc(s.name)}</option>`).join("")
      : `<option value="0">— بدون سبک —</option>`;
    if (preStyleId) el("pfStyle").value = String(preStyleId);
    el("pfStatus").value = "draft";
    openModal("project");
  }

  async function createProjectForm() {
    clearFieldErrors(el("modal-project"));
    const title = el("pfTitle").value.trim();
    if (!validateForm([
      ["pfTitle", (v) => !!v.trim(), "عنوان پروژه را وارد کنید — در فهرست و فاکتور با همین عنوان دیده می‌شود."],
    ])) return false;
    const styleId = Number(el("pfStyle").value) || 0;
    const body = {
      title, customer: el("pfCustomer").value.trim(), mobile: el("pfMobile").value.trim(),
      status: el("pfStatus").value, style_id: styleId,
    };
    let np;
    if (API.ok) {
      try { np = normalizeProject((await API.req("POST", "/api/projects", body)).project); }
      catch (err) { toast("ایجاد ناموفق: " + esc(err.message), "error"); return false; }
    } else {
      const id = Math.max(0, ...PROJECTS.map((p) => p.id)) + 1;
      np = normalizeProject({
        id, code: `PR-1405-${fa(String(id).padStart(3, "0"))}`, title,
        customer: body.customer || "—", mobile: body.mobile, status: body.status,
        date: TODAY_FA,
        profit_mode: SETTINGS.default_profit_mode, profit_percent: +SETTINGS.default_profit_percent || 25,
        install_mode: SETTINGS.default_install_mode, install_value: +SETTINGS.default_install_value || 0,
        vat_enabled: SETTINGS.vat_enabled === "1", vat_percent: +SETTINGS.vat_percent || 10,
        pages: [defaultPage(styleId)],
      });
      PROJECTS.unshift(np);
      demoSave();
    }
    if (!PROJECTS.includes(np)) PROJECTS.unshift(np);
    closeModal("project");
    renderProjects(); renderDashboard(); fillInvoiceProjects();
    openProjectEditor(np.id);
    toast("پروژه‌ی جدید ایجاد شد — یونیت‌ها را وارد کنید", "success");
    return true;
  }
  el("btnCreateProject").addEventListener("click", () => submitModal("project"));
  el("projectsTable").addEventListener("click", async (e) => {
    const open = e.target.closest("[data-open-project]");
    const inv = e.target.closest("[data-invoice-project]");
    const del = e.target.closest("[data-del-project]");
    if (open) openProjectEditor(open.dataset.openProject);
    else if (inv) {
      el("invProject").value = inv.dataset.invoiceProject;
      navigate("invoice");
      state.inv.number = "";
      renderInvRowChecks();
      await refreshInvoice(true);
      toast("فاکتور برای پروژه بارگذاری شد");
    } else if (del) {
      const p = PROJECTS.find((x) => x.id === +del.dataset.delProject);
      askConfirm(`پروژه‌ی «<b>${esc(p.title)}</b>» و همه‌ی داده‌های آن حذف شود؟`, async () => {
        if (API.ok) {
          try { await API.req("DELETE", `/api/projects/${p.id}`); }
          catch (err) { toast("حذف ناموفق: " + esc(err.message), "error"); return; }
        } else demoSave();
        PROJECTS.splice(PROJECTS.indexOf(p), 1);
        if (state.editingProject === p) { state.editingProject = null; el("projectEditor").hidden = true; }
        renderProjects(); renderDashboard(); fillInvoiceProjects();
        toast("پروژه حذف شد", "success");
      }, "حذف پروژه");
    }
  });

  el("btnCloseEditor").addEventListener("click", closeProjectEditor);
  el("btnSaveProject").addEventListener("click", () => busy(el("btnSaveProject"), () => saveProject()));
  el("btnDupProject").addEventListener("click", () => busy(el("btnDupProject"), async () => {
    const p = state.editingProject;
    if (!p) return;
    /* ★ قبلاً کپی از «نسخه‌ی روی سرور» ساخته می‌شد و تغییراتِ ذخیره‌نشده‌ی
       کاربر بی‌صدا از دست می‌رفت. حالا اول ذخیره، بعد کپی.                      */
    if (state.dirty) {
      const ok = await saveProject(true);
      if (!ok) { toast("ابتدا تغییرات را ذخیره کنید، بعد پروژه را کپی کنید", "warn"); return; }
    }
    let np;
    if (API.ok) {
      try { np = normalizeProject((await API.req("POST", `/api/projects/${p.id}/duplicate`)).project); }
      catch (err) { toast("خطا: " + esc(err.message), "error"); return; }
    } else {
      np = normalizeProject(JSON.parse(JSON.stringify(p)));
      np.id = Math.max(0, ...PROJECTS.map((x) => x.id)) + 1;
      np.code = `PR-1405-${fa(String(np.id).padStart(3, "0"))}`;
      np.title += " (کپی)";
      np.status = "draft";
      np.pages.forEach((pg) => { pg.id = 0; });
      demoSave();
    }
    PROJECTS.unshift(np);
    renderProjects(); fillInvoiceProjects(); renderDashboard();
    openProjectEditor(np.id);
    toast("کپی پروژه ایجاد شد", "success");
  }));
  ["edTitle", "edStatus", "edCustomer", "edMobile", "edPhone", "edAddress", "edValid"].forEach((id) =>
    el(id).addEventListener("change", () => {
      const p = state.editingProject;
      if (!p) return;
      readEditorFieldsInto(p);
      el("edStatusBadge").textContent = STATUS_LABEL[p.status];
      el("edStatusBadge").className = "badge " + STATUS_CLASS[p.status];
      markDirty();
      scheduleRecalc();
    }));

  /* --- بخش‌ها --- */
  el("secPills").addEventListener("click", (e) => {
    const x = e.target.closest("[data-sec-del]");
    if (x) {
      e.stopPropagation();
      const p = state.editingProject;
      const i = +x.dataset.secDel;
      askConfirm(`بخش «<b>${esc(p.pages[i].name)}</b>» و همه‌ی یونیت‌هایش حذف شود؟`, () => {
        p.pages.splice(i, 1);
        state.pageIdx = Math.max(0, state.pageIdx - (i <= state.pageIdx ? 1 : 0));
        markDirty();
        renderSectionPills(); renderSectionBar(); renderEditorTables(); scheduleRecalc(50);
      }, "حذف بخش");
      return;
    }
    const pill = e.target.closest("[data-sec]");
    if (pill) {
      readSectionBarInto();
      state.pageIdx = +pill.dataset.sec;
      state.expanded.clear();
      renderSectionPills(); renderSectionBar(); renderEditorTables(); scheduleRecalc(50);
    } else if (e.target.closest("#btnAddSection2")) {
      const p = state.editingProject;
      readSectionBarInto();
      p.pages.push(defaultPage(p.pages[0] ? p.pages[0].style_id : 0, `بخش ${fa(p.pages.length + 1)}`));
      state.pageIdx = p.pages.length - 1;
      markDirty();
      renderSectionPills(); renderSectionBar(); renderEditorTables(); scheduleRecalc(50);
      toast("بخش جدید اضافه شد — سبک و یونیت‌ها را وارد کنید");
    }
  });
  el("btnAddSection").addEventListener("click", () => el("btnAddSection2").click());
  el("btnDelSection").addEventListener("click", () => {
    const p = state.editingProject;
    if (!p) return;
    if (p.pages.length <= 1) { toast("حداقل یک بخش باید باقی بماند", "warn"); return; }
    const x = $(`#secPills [data-sec-del="${state.pageIdx}"]`);
    if (x) x.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  el("secName").addEventListener("change", () => { readSectionBarInto(); markDirty(); renderSectionPills(); });
  el("secStyle").addEventListener("change", () => {
    const pg = curPage();
    if (!pg) return;
    pg.style_id = Number(el("secStyle").value) || 0;
    const st = STYLES.find((s) => s.id === pg.style_id);
    pg.style_name = st ? st.name : "";
    markDirty();
    scheduleRecalc();
  });
  /* ★ حذفِ یک کلیکِ اضافه: این عملیات کاملاً برگشت‌پذیر است (Undo دارد و
     پیش‌نویسِ خودکار هم ذخیره می‌شود)، پس مودالِ تأییدِ خطرناک‌نما لازم نبود.
     به‌جایش بلافاصله اعمال می‌شود و در توست، «بازگردانی» یک‌کلیکی دارد.        */
  el("btnApplyStyle").addEventListener("click", () => {
    const pg = curPage();
    if (!pg) return;
    if (!pg.style_id) { toast("ابتدا یک سبک انتخاب کنید", "warn"); return; }
    const st = STYLES.find((s) => s.id === Number(pg.style_id));
    const before = undoSnapshot();          /* وضعیتِ پیش از اعمال — برای بازگردانی */
    applyStyleToPage(pg, pg.style_id);
    markDirty();
    renderSectionBar(); renderEditorTables(); scheduleRecalc(50);
    toast(`متریالِ سبک «<b>${esc(st.name)}</b>» روی همه‌ی یونیت‌ها، درها و کشوهای این بخش اعمال شد`,
      "success", {
        label: "بازگردانی",
        cb: () => {
          if (UNDO.applying) return;
          const p = state.editingProject;
          if (!p || !before) { doUndo(); return; }
          UNDO.applying = true;
          try {
            const d = JSON.parse(before);
            p.pages = d.pages || [];
            state.pageIdx = Math.min(Math.max(0, +d.pageIdx || 0), Math.max(0, p.pages.length - 1));
            state.dirty = true;
            paintDirtyState2();
            renderSectionPills(); renderSectionBar(); renderEditorTables();
            scheduleRecalc(50); scheduleDraftSave();
          } finally { UNDO.applying = false; }
          updateUndoButtons();
          toast("اعمالِ سبک بازگردانده شد", "info");
        },
      });
  });
  ["secWaste", "secOverhead", "secCounterLm", "secWallLen", "facadeTotalSqm", "facadeTotalPrice"].forEach((id) =>
    el(id) && el(id).addEventListener("input", () => { readSectionBarInto(); markDirty("sec." + id); renderDimRibbon(); scheduleRecalc(); }));
  el("secCounter").addEventListener("change", () => {
    const pg = curPage();
    if (!pg) return;
    const cid = Number(el("secCounter").value) || 0;
    pg.units.forEach((u) => { u.countertop_id = cid; });
    readSectionBarInto();
    markDirty();
    renderEditorTables();
    scheduleRecalc();
  });
  el("facadeMode").addEventListener("change", () => {
    readSectionBarInto();
    markDirty();
    renderSectionBar();
    renderEditorTables();
    scheduleRecalc();
  });

  /* --- تب‌ها --- */
  el("secTabs").addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (!t) return;
    $$("#secTabs .tab").forEach((x) => x.classList.toggle("active", x === t));
    $$(".tab-panel").forEach((pn) => pn.classList.toggle("active", pn.id === "tab-" + t.dataset.tab));
  });

  /* --- افزودن ردیف --- */
  function styleDataOf(pg) {
    const st = STYLES.find((s) => s.id === Number(pg.style_id));
    return (st && st.data) || {};
  }
  function applyStyleToUnit(u, d) {
    for (const [role, attr] of [["body", "body_id"], ["back", "back_id"], ["banding", "banding_id"],
      ["countertop", "countertop_id"], ["leg", "leg_id"], ["shelf_pin", "shelf_pin_id"],
      ["crown", "crown_id"], ["underlight", "underlight_id"], ["kickboard", "kickboard_id"],
      ["assembly", "assembly_id"]]) {
      if (d[role]) u[attr] = midByName(d[role]);
    }
    if (!u.assembly_id) u.assembly_id = midByName("سوراخ‌کاری و مونتاژ (هر یونیت)");
  }
  $$(".add-row").forEach((b) => b.addEventListener("click", () => {
    const p = state.editingProject;
    const pg = curPage();
    if (!p || !pg) return;
    const kind = b.dataset.add;
    const d = styleDataOf(pg);
    const keep = captureCellFocus();
    let focusKind = null, focusIdx = null;
    if (kind === "units" || (kind && kind.startsWith("unit:"))) {
      const type = kind.startsWith("unit:") ? kind.slice("unit:".length) : "ground";
      const u = defaultUnit(type);
      applyStyleToUnit(u, d);
      pg.units.push(u);
      focusKind = "unit"; focusIdx = pg.units.length - 1;
      state.lastUnitIdx = focusIdx;
    } else if (kind === "doors") {
      if (!pg.units.length) { toast("ابتدا یک یونیت بسازید", "warn"); return; }
      const dr = defaultDoor();
      if (d.door) dr.material_id = midByName(d.door);
      if (d.door_model) dr.door_model_id = midByName(d.door_model);
      if (d.hinge) dr.hinge_id = midByName(d.hinge);
      if (d.handle) dr.handle_id = midByName(d.handle);
      if (d.banding) dr.banding_id = midByName(d.banding);
      if (d.assembly_door) dr.assembly_id = midByName(d.assembly_door);
      if (d.packaging_door) dr.packaging_id = midByName(d.packaging_door);
      pg.units[state.lastUnitIdx || 0].doors.push(dr);
      focusKind = "door"; focusIdx = (state.lastUnitIdx || 0) + ":" + (pg.units[state.lastUnitIdx || 0].doors.length - 1);
    } else if (kind === "drawers") {
      if (!pg.units.length) { toast("ابتدا یک یونیت بسازید", "warn"); return; }
      const dw = defaultDrawer();
      if (d.slide) dw.slide_id = midByName(d.slide);
      if (d.drawer_sheet) dw.sheet_id = midByName(d.drawer_sheet);
      if (d.door) dw.front_id = midByName(d.door);
      if (d.handle) dw.handle_id = midByName(d.handle);
      if (d.banding) dw.banding_id = midByName(d.banding);
      pg.units[state.lastUnitIdx || 0].drawers.push(dw);
      focusKind = "drawer"; focusIdx = (state.lastUnitIdx || 0) + ":" + (pg.units[state.lastUnitIdx || 0].drawers.length - 1);
    } else if (kind === "facade") {
      if (pg.detail_mode !== "detailed") {
        pg.detail_mode = "detailed";
        renderSectionBar();
      }
      pg.detail_rows.push({ label: "ردیف درنما", qty: 1, w_cm: 100, h_cm: 60, price_per_sqm: 300000 });
      focusKind = "facade"; focusIdx = pg.detail_rows.length - 1;
    } else if (kind === "extras") {
      pg.extras.push({ label: "قلم جدید", qty: 1, unit: "piece", price: 500000, visible: true });
      focusKind = "extra"; focusIdx = pg.extras.length - 1;
    } else if (kind === "services") {
      pg.services.push({ label: "خدمت جدید", basis: "fixed", qty: 1, price: 300000 });
      focusKind = "service"; focusIdx = pg.services.length - 1;
    }
    markDirty();
    /* فوکوس مستقیم روی ردیفِ تازه — کاربر بدونِ یک کلیکِ اضافه تایپ را شروع
       می‌کند (یافته‌ی K‑6: پیش‌تر پس از «افزودن» مکان‌نما گم می‌شد).          */
    if (focusKind !== null) focusRowAfter(focusKind, focusIdx);
    renderEditorTables();
    if (!focusKind) restoreCellFocus(keep);
    scheduleRecalc(50);
    toast("ردیف اضافه شد — مقادیر را ویرایش کنید");
  }));

  /* --- ویرایش زنده‌ی جدول‌ها --- */
  const NUM_KEYS = new Set(["qty", "length_cm", "height_cm", "depth_cm", "shelves", "legs_per_unit",
    "pins_per_shelf", "w_cm", "h_cm", "d_cm", "price", "price_per_sqm", "hinges_per_leaf",
    "gas_springs_per_leaf", "handles_per_leaf"]);
  const BOOL_KEYS = new Set(["glass", "has_top_panel", "has_bottom_panel", "visible",
                             "from_body"]);

  function rowOf(pg, scope, ds) {
    const ui = ds.ui !== undefined && ds.ui !== "" ? +ds.ui : null;
    const di = ds.di !== undefined && ds.di !== "" ? +ds.di : null;
    const ri = ds.ri !== undefined && ds.ri !== "" ? +ds.ri : null;
    if (scope === "unit") return pg.units[ui];
    if (scope === "door") return pg.units[ui] && pg.units[ui].doors[di];
    if (scope === "drawer") return pg.units[ui] && pg.units[ui].drawers[di];
    if (scope === "facade") return pg.detail_rows[ri];
    if (scope === "extra") return pg.extras[ri];
    if (scope === "service") return pg.services[ri];
    return null;
  }

  el("projectEditor").addEventListener("input", (e) => {
    const t = e.target;
    const p = state.editingProject;
    const pg = curPage();
    if (!t.dataset || !t.dataset.scope || !p || !pg) return;
    const scope = t.dataset.scope;
    if (scope === "doormove" || scope === "drawermove") return; /* change */
    const row = rowOf(pg, scope, t.dataset);
    if (!row) return;
    const k = t.dataset.k;
    if (t.type === "checkbox") row[k] = t.checked;
    else if (NUM_KEYS.has(k)) row[k] = parseNum(t.value);
    else if (k.endsWith("_id")) row[k] = Number(t.value) || 0;
    else row[k] = t.value;
    if (scope === "unit" && t.dataset.ui !== undefined) state.lastUnitIdx = +t.dataset.ui;
    markDirty(`${scope}.${k}.${t.dataset.ui ?? ""}.${t.dataset.di ?? ""}.${t.dataset.ri ?? ""}`);
    scheduleRecalc();
    updateComputedCells();
  });

  /* ★ ناوبری صفحه‌کلیدیِ جدول‌ها (مثل اسپرده‌یت):
     — Enter: پرش به همان ستون در ردیف بعدی
     — ArrowUp/ArrowDown: یکی‌یکی زیاد/کم کردن مقدار عددی (با Shift ده‌تا)
     کارِ تکراریِ «تعداد را از ۳ بکن ۵» یا «ارتفاع همه‌ی یونیت‌ها ۷۲» با
     دو کلید انجام می‌شود، بدونِ گرفتنِ موس و انتخابِ متن.                     */
  el("projectEditor").addEventListener("keydown", (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.scope || !t.dataset.k) return;
    const k = t.dataset.k;
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && NUM_KEYS.has(k) && t.type === "text") {
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
      const cur = parseNum(t.value);
      const nv = Math.max(0, Math.round((cur + step) * 1000) / 1000);
      t.value = String(nv);
      t.dispatchEvent(new Event("input", { bubbles: true }));
      /* کارشناسِ جداکننده‌ی هزارگان مقدار را بازنمایش می‌کند؛ مکان‌نما انتها */
      if (t.setSelectionRange) { try { t.setSelectionRange(t.value.length, t.value.length); } catch (err) { /* noop */ } }
      return;
    }
    if (e.key === "Enter" && (t.tagName === "INPUT" || t.tagName === "SELECT")) {
      e.preventDefault();
      const scope = t.dataset.scope;
      if (scope === "doormove" || scope === "drawermove") return;
      const list = Array.from(document.querySelectorAll(
        `#projectEditor [data-scope="${scope}"][data-k="${k}"]`));
      const i = list.indexOf(t);
      if (i >= 0 && i + 1 < list.length) { list[i + 1].focus(); if (list[i + 1].select) list[i + 1].select(); }
      else t.blur();
    }
  });

  el("projectEditor").addEventListener("change", (e) => {
    const t = e.target;
    const pg = curPage();
    if (!t.dataset || !pg) return;
    if (t.dataset.scope === "doormove" || t.dataset.scope === "drawermove") {
      const from = +t.dataset.ui, to = +t.selectedOptions[0].value, di = +t.dataset.di;
      if (from !== to) {
        const arr = t.dataset.scope === "doormove" ? "doors" : "drawers";
        const row = pg.units[from][arr].splice(di, 1)[0];
        pg.units[to][arr].push(row);
        markDirty();
        renderEditorTables();
        scheduleRecalc(50);
      }
      return;
    }
    /* تیکِ «در از ورق بدنه» → جدول بازآرایی می‌شود تا سلول، وضعیتِ درست را نشان دهد */
    if (t.dataset.scope === "door" && t.dataset.k === "from_body") {
      markDirty();
      renderEditorTables();
      scheduleRecalc(50);
      return;
    }
    /* تغییر نوع یونیت → ابعاد پیش‌فرضِ همان نوع خودکار اعمال می‌شود
       (رویداد change فقط وقتی مقدار واقعاً عوض شده باشد شلیک می‌شود) */
    if (t.dataset.scope === "unit" && t.dataset.k === "unit_type") {
      const u = pg.units[+t.dataset.ui];
      if (!u) return;
      applyUnitTypeDefaults(u, u.unit_type);
      state.lastUnitIdx = +t.dataset.ui;
      markDirty();
      renderEditorTables();
      scheduleRecalc(50);
      toast(`ابعاد پیش‌فرض «${UNIT_TYPES[u.unit_type] || u.unit_type}» اعمال شد — در صورت نیاز ویرایش کنید`);
    }
  });

  el("projectEditor").addEventListener("click", (e) => {
    const p = state.editingProject;
    const pg = curPage();
    if (!p || !pg) return;
    const ex = e.target.closest("[data-expand]");
    if (ex) {
      const key = `${p.id}:${state.pageIdx}:${ex.dataset.expand}`;
      if (state.expanded.has(key)) state.expanded.delete(key); else state.expanded.add(key);
      renderEditorTables();
      return;
    }
    /* کپی ردیف — دقیقاً کنار ردیف فعلی قرار می‌گیرد */
    const c = e.target.closest("[data-copy-row]");
    if (c) {
      const keepF = captureCellFocus();
      const kind = c.dataset.copyRow;
      const ui = c.dataset.ui !== "" ? +c.dataset.ui : null;
      const di = c.dataset.di !== "" ? +c.dataset.di : null;
      const ri = c.dataset.ri !== "" ? +c.dataset.ri : null;
      const clone = (o) => JSON.parse(JSON.stringify(o));
      let msg = "ردیف کپی شد";
      if (kind === "unit") {
        const src = pg.units[ui]; if (!src) return;
        const copy = clone(src);
        copy.label = `${src.label || "یونیت"} (کپی)`;
        pg.units.splice(ui + 1, 0, copy);
        msg = "یونیت کپی شد — ابعاد را عوض کنید";
      } else if (kind === "door") {
        const src = pg.units[ui].doors[di]; if (!src) return;
        pg.units[ui].doors.splice(di + 1, 0, clone(src));
        msg = "در کپی شد";
      } else if (kind === "drawer") {
        const src = pg.units[ui].drawers[di]; if (!src) return;
        pg.units[ui].drawers.splice(di + 1, 0, clone(src));
        msg = "کشو کپی شد";
      } else if (kind === "facade") {
        const src = pg.detail_rows[ri]; if (!src) return;
        pg.detail_rows.splice(ri + 1, 0, clone(src));
      } else if (kind === "extra") {
        const src = pg.extras[ri]; if (!src) return;
        pg.extras.splice(ri + 1, 0, clone(src));
      } else if (kind === "service") {
        const src = pg.services[ri]; if (!src) return;
        pg.services.splice(ri + 1, 0, clone(src));
      }
      /* فوکوس به ردیفِ کپی‌شده برود تا بلافاصله قابل ویرایش باشد */
      const focusOf = {
        unit: ["unit", ui + 1], door: ["door", ui + ":" + (di + 1)], drawer: ["drawer", ui + ":" + (di + 1)],
        facade: ["facade", ri + 1], extra: ["extra", ri + 1], service: ["service", ri + 1],
      }[kind];
      markDirty();
      if (focusOf) focusRowAfter(focusOf[0], focusOf[1]);
      renderEditorTables();
      if (!focusOf) restoreCellFocus(keepF);
      scheduleRecalc(50);
      toast(msg, "success");
      return;
    }
    /* ذخیره‌ی یونیت به‌عنوان الگو */
    const tp = e.target.closest("[data-tpl-save]");
    if (tp) { openTemplateSaveModal(+tp.dataset.tplSave); return; }

    const d = e.target.closest("[data-del-row]");
    if (d) {
      const kind = d.dataset.delRow;
      const ui = d.dataset.ui !== "" ? +d.dataset.ui : null;
      const di = d.dataset.di !== "" ? +d.dataset.di : null;
      const riD = d.dataset.ri !== "" ? +d.dataset.ri : null;
      const keepF = captureCellFocus();
      /* ★ حذفِ قابلِ بازگردانی: ردیف را نگه می‌داریم تا با یک کلیکِ «بازگردانی»
         در توست، سرِ جایش برگردد — حذفِ اشتباهِ یک یونیتِ پرمتریال دیگر
         یعنی دوباره‌کاریِ ده‌دقیقه‌ای.                                        */
      let arr = null, idx = -1, removed = null;
      if (kind === "unit") { arr = pg.units; idx = ui; }
      else if (kind === "door") { arr = pg.units[ui] && pg.units[ui].doors; idx = di; }
      else if (kind === "drawer") { arr = pg.units[ui] && pg.units[ui].drawers; idx = di; }
      else if (kind === "facade") { arr = pg.detail_rows; idx = riD !== null ? riD : di; }
      else if (kind === "extra") { arr = pg.extras; idx = riD !== null ? riD : di; }
      else if (kind === "service") { arr = pg.services; idx = riD !== null ? riD : di; }
      if (arr && idx !== null && idx >= 0 && idx < arr.length) removed = arr.splice(idx, 1)[0];
      const labelOf = { unit: "یونیت", door: "در", drawer: "کشو", facade: "ردیف درنما", extra: "قلم", service: "خدمت" };
      /* هویتِ ردیفِ «بعدی» — چون پس از حذف، شاخص‌ها یکی به عقب می‌آیند */
      const nextIdOf = {
        unit: () => ["unit", Math.min(idx, pg.units.length - 1)],
        door: () => ["door", ui + ":" + Math.min(idx, (pg.units[ui] && pg.units[ui].doors.length || 1) - 1)],
        drawer: () => ["drawer", ui + ":" + Math.min(idx, (pg.units[ui] && pg.units[ui].drawers.length || 1) - 1)],
        facade: () => ["facade", Math.min(idx, pg.detail_rows.length - 1)],
        extra: () => ["extra", Math.min(idx, pg.extras.length - 1)],
        service: () => ["service", Math.min(idx, pg.services.length - 1)],
      }[kind];
      markDirty();
      const nxt = nextIdOf ? nextIdOf() : null;
      if (nxt && nxt[1] >= 0) focusRowAfter(nxt[0], nxt[1]);
      renderEditorTables();
      if (!nxt || nxt[1] < 0) restoreCellFocus(keepF);
      scheduleRecalc(50);
      toast(`ردیفِ «${esc(labelOf[kind] || "")}» حذف شد`, "info", removed && arr ? {
        label: "بازگردانی",
        cb: () => {
          arr.splice(Math.min(idx, arr.length), 0, removed);
          markDirty();
          /* ردیفِ برگشته زیرِ انگشت بماند — کاربر معمولاً می‌خواهد ویرایشش کند */
          const backKey = (kind === "door" || kind === "drawer") ? (ui + ":" + idx) : idx;
          focusRowAfter(kind, backKey);
          renderEditorTables();
          scheduleRecalc(50);
          toast("ردیف برگشت", "success");
        },
      } : null);
      return;
    }

    /* ★ پرش از نشانِ «در/کشو»ِ ردیف یونیت به همان ردیف‌ها در تب مربوطه —
       به‌جای گشتن دستی بین تب‌ها و پیدا کردن یونیت در کشوی بلند.            */
    const gotoTab = e.target.closest("[data-goto-tab]");
    if (gotoTab) {
      const tab = gotoTab.dataset.gotoTab;
      const ui = +gotoTab.dataset.ui;
      const tabBtn = document.querySelector(`#secTabs .tab[data-tab="${tab}"]`);
      if (tabBtn) tabBtn.click();
      const tblId = tab === "doors" ? "tblDoors" : "tblDrawers";
      requestAnimationFrame(() => {
        const first = document.querySelector(`#${tblId} [data-scope="${tab === "doors" ? "door" : "drawer"}"][data-ui="${ui}"]`);
        const row = first && first.closest("tr");
        if (row) {
          row.classList.add("hl-row");
          if (row.scrollIntoView) row.scrollIntoView({ block: "center", behavior: "smooth" });
          setTimeout(() => row.classList.remove("hl-row"), 2600);
        }
      });
    }
  });

  el("svcLibrary").addEventListener("change", () => {
    const pg = curPage();
    const name = el("svcLibrary").value;
    if (!pg || !name) return;
    const m = mat(name) || MATERIALS.find((x) => x.name === name);
    pg.services.push({ label: name, basis: "fixed", qty: 1, price: m ? m.price : 0, note: "" });
    el("svcLibrary").value = "";
    markDirty();
    renderEditorTables();
    scheduleRecalc(50);
    toast(`خدمت «${esc(name)}» اضافه شد — مبنا را در صورت نیاز تغییر دهید`);
  });

  /* --- نوار جمع --- */
  ["tbProfitMode", "tbProfitPct", "tbInstallMode", "tbInstallVal",
    "tbDiscPct", "tbDiscAmt", "tbVat", "tbVatPct", "tbExtraFixed"].forEach((id) => {
    el(id).addEventListener("input", () => { markDirty("tb." + id); scheduleRecalc(); refreshTbUnits(); });
    el(id).addEventListener("change", () => { markDirty("tb." + id); scheduleRecalc(); refreshTbUnits(); });
  });
  el("btnBreakdown").addEventListener("click", async () => {
    if (!state.editingProject) return;
    await recalcTotals();
    renderBreakdown();
    openModal("breakdown");
  });

  /* ★ تراشه‌ی هشدارِ نوار متراژ → همان مودالِ ریزِ قیمت‌ها (با فهرست هشدارها) */
  el("dimRibbon").addEventListener("click", (e) => {
    if (e.target.closest("#dimWarnChip")) {
      renderBreakdown();
      openModal("breakdown");
    }
  });

  /* ★ ثباتِ رویه: «ذخیره» و «برش‌نامه» فقط یک جای ثابت دارند — نوارِ فرمانِ
     چسبانِ بالای ویرایشگر. پیش‌تر هر دو در نوارِ جمع هم تکرار می‌شدند؛ یعنی
     دو دکمه‌ی هم‌وزن برای یک کنش، که هم قانونِ فیتز را می‌شکست و هم یادگیریِ
     جایِ دکمه را. نوارِ جمع حالا فقط «عدد» و «تنظیمات مالی» دارد.            */

  /* کشوی تنظیمات مالی — جمع‌شده تا ارتفاعِ صفحه خرجِ ورودی‌های کم‌مصرف نشود */
  const btnTbDrawer = el("btnTbDrawer");
  if (btnTbDrawer) {
    let saved = null;
    try { saved = localStorage.getItem("kabir.tbDrawer"); } catch (e) {}
    setTbDrawer(saved === null ? true : saved === "1", false);
    btnTbDrawer.addEventListener("click", () => {
      const d = el("tbDrawer");
      setTbDrawer(!!d && d.hidden);
      updateTbSummary();
    });
  }

  /* ★ واگرد/بازانجامِ تغییراتِ ویرایشگر (Ctrl+Z / Ctrl+Shift+Z) */
  const btnUndo = el("btnUndo");
  if (btnUndo) btnUndo.addEventListener("click", () => { doUndo(); });
  const btnRedo = el("btnRedo");
  if (btnRedo) btnRedo.addEventListener("click", () => { doRedo(); });

  el("btnBreakdownInvoice").addEventListener("click", async () => {
    await requestCloseModal("breakdown");   /* فقط همین لایه بسته می‌شود، نه همه */
    await gotoInvoiceForCurrent();
  });
  el("btnGoInvoice").addEventListener("click", gotoInvoiceForCurrent);

  async function gotoInvoiceForCurrent() {
    const p = state.editingProject;
    if (!p) return;
    if (state.dirty) {
      const ok = await saveProject(true);
      if (!ok) return;
    }
    el("invProject").value = String(p.id);
    navigate("invoice");
    state.inv.number = "";
    renderInvRowChecks();
    await refreshInvoice(true);
  }

  /* ---------------- فاکتور ---------------- */
  el("invProject").addEventListener("change", async () => {
    state.inv.number = "";
    renderInvRowChecks();
    await refreshInvoice(true);
  });
  ["invType", "invShowCost", "invShowStats"].forEach((id) =>
    el(id).addEventListener("change", async () => {
      if (id === "invType") state.inv.number = "";
      await refreshInvoice();
    }));
  el("invRows").addEventListener("change", async () => { await refreshInvoice(); });
  el("invLevel").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    $$("#invLevel button").forEach((x) => x.classList.toggle("active", x === b));
    await refreshInvoice();
  });
  el("btnRefreshInv").addEventListener("click", () => busy(el("btnRefreshInv"), async () => {
    renderInvRowChecks();
    await refreshInvoice();
    toast("فاکتور به‌روزرسانی شد", "success");
  }));
  el("btnPrintInv").addEventListener("click", () => {
    const f = el("invFrame");
    if (!f.classList.contains("hidden") && f.contentWindow) {
      f.contentWindow.focus();
      f.contentWindow.print();
    } else window.print();
  });
  el("btnPdfInv").addEventListener("click", () => busy(el("btnPdfInv"), async () => {
    if (!API.ok) { toast("خروجی PDF در حالت نمایشی فعال نیست — کبیر را اجرا کنید: python main.py", "warn"); return; }
    if (!state.inv.payload) { await refreshInvoice(); }
    try {
      const body = Object.assign({}, state.inv.payload, { number: state.inv.number });
      const f = await API.blob("POST", "/api/invoice/pdf", body);
      downloadBlob(f.bytes, f.name, "application/pdf");
      toast(`PDF ذخیره شد: ${esc(f.name)}`, "success");
    } catch (e) { toast("خطا: " + esc(e.message), "error"); }
  }));
  el("btnXlsInv").addEventListener("click", () => busy(el("btnXlsInv"), async () => {
    if (!API.ok) { toast("خروجی اکسل در حالت نمایشی فعال نیست — کبیر را اجرا کنید: python main.py", "warn"); return; }
    if (!state.inv.payload) { await refreshInvoice(); }
    try {
      const body = Object.assign({}, state.inv.payload, { number: state.inv.number });
      const f = await API.blob("POST", "/api/invoice/xlsx", body);
      downloadBlob(f.bytes, f.name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      toast(`اکسل ذخیره شد: ${esc(f.name)}`, "success");
    } catch (e) { toast("خطا: " + esc(e.message), "error"); }
  }));
  el("btnSaveInv").addEventListener("click", () => busy(el("btnSaveInv"), async () => {
    const p = invProject();
    if (!p) { toast("پروژه‌ای انتخاب نشده است", "warn"); return; }
    if (API.ok) {
      if (!state.inv.payload) await refreshInvoice();
      try {
        const body = Object.assign({}, state.inv.payload, { number: state.inv.number });
        const resp = await API.req("POST", "/api/invoice/save", body);
        ARCHIVE = resp.invoices;
        renderArchive();
        toast(`فاکتور ${esc(resp.number)} در بایگانی ثبت شد`, "success");
      } catch (e) { toast("خطا: " + esc(e.message), "error"); }
    } else {
      const r = calcProjectLocal(p);
      const number = state.inv.number || demoInvoiceNumber(state.inv.kind);
      ARCHIVE.unshift({
        id: Date.now(), number, kind: state.inv.kind,
        kind_label: { quote: "پیش‌فاکتور", invoice: "فاکتور فروش", proforma: "پیش‌فاکتور رسمی" }[state.inv.kind],
        project: p.title, customer: p.customer, date: TODAY_FA, amount: r.final_price,
      });
      demoSave();
      renderArchive();
      toast(`فاکتور ${esc(number)} در بایگانی ثبت شد (نمایشی)`, "success");
    }
  }));
  el("archiveTable").addEventListener("click", async (e) => {
    const v = e.target.closest("[data-view-arch]");
    const pdf = e.target.closest("[data-pdf-arch]");
    const d = e.target.closest("[data-del-arch]");
    if (v) {
      const a = ARCHIVE.find((x) => String(x.id) === v.dataset.viewArch);
      if (API.ok) {
        try {
          const resp = await API.req("GET", `/api/invoices/${a.id}`);
          el("invoiceSheet").classList.add("hidden");
          const f = el("invFrame");
          f.classList.remove("hidden");
          f.srcdoc = resp.html;
          state.inv.number = a.number;
          el("invNumber").value = a.number;
          f.scrollIntoView({ behavior: "smooth" });
        } catch (err) { toast("خطا: " + esc(err.message), "error"); }
      } else {
        const p = PROJECTS.find((x) => x.title === a.project);
        if (p) {
          el("invProject").value = String(p.id);
          renderInvRowChecks();
          await refreshInvoice(true);
          toast("فاکتور بایگانی‌شده از روی پروژه بازسازی شد (نمایشی)");
        } else toast("پروژه‌ی این فاکتور یافت نشد", "warn");
      }
    } else if (pdf) {
      try {
        const f = await API.blob("GET", `/api/invoices/${pdf.dataset.pdfArch}/pdf`);
        downloadBlob(f.bytes, f.name, "application/pdf");
        toast("PDF دانلود شد", "success");
      } catch (err) { toast("خطا: " + esc(err.message), "error"); }
    } else if (d) {
      const id = +d.dataset.delArch;
      const a = ARCHIVE.find((x) => x.id === id);
      askConfirm(`فاکتور <b class="ltr">${esc(a.number)}</b> از بایگانی حذف شود؟`, async () => {
        if (API.ok) {
          try { ARCHIVE = (await API.req("DELETE", `/api/invoices/${id}`)).invoices; }
          catch (err) { toast("خطا: " + esc(err.message), "error"); return; }
        } else {
          ARCHIVE.splice(ARCHIVE.indexOf(a), 1);
          demoSave();
        }
        renderArchive();
        toast("از بایگانی حذف شد", "success");
      }, "حذف از بایگانی");
    }
  });

  /* ---------------- تنظیمات ---------------- */
  el("btnSaveSettings").addEventListener("click", () => busy(el("btnSaveSettings"), async () => {
    const patch = collectSettings();
    if (API.ok) {
      try {
        SETTINGS = (await API.req("PUT", "/api/settings", { settings: patch })).settings;
      } catch (e) { toast("ذخیره ناموفق: " + esc(e.message), "error"); return; }
    } else {
      Object.assign(SETTINGS, patch);
      demoSave();
    }
    applySettingsToUI();
    renderAll();
    toast("تنظیمات ذخیره شد", "success");
  }));
  el("btnResetSettings").addEventListener("click", () =>
    askConfirm("پیش‌فرض‌های محاسبه (سود، پرت، سربار، نصب، مالیات و ابعاد پیش‌فرض یونیت‌ها) به حالت اولیه برگردانده شود؟", () => {
      el("setProfitPct").value = fa(FACTORY_NUM_SETTINGS.setProfitPct);
      el("setOverhead").value = fa(FACTORY_NUM_SETTINGS.setOverhead);
      el("setWaste").value = fa(FACTORY_NUM_SETTINGS.setWaste);
      el("setInstallMode").value = "fixed";
      el("setInstallVal").value = fa(FACTORY_NUM_SETTINGS.setInstallVal);
      el("setVatPct").value = fa(FACTORY_NUM_SETTINGS.setVatPct);
      for (const [id, v] of Object.entries(FACTORY_NUM_SETTINGS)) {
        if (/^set(Ground|Wall|Tall)/.test(id) && el(id)) el(id).value = fa(v);
      }
      toast("پیش‌فرض‌ها بازنشانی شد — «ذخیره‌ی تنظیمات» را بزنید", "success");
    }, "بازنشانی", "بازنشانی"));

  el("btnBackupNow").addEventListener("click", () => busy(el("btnBackupNow"), async () => {
    if (!API.ok) { toast("پشتیبان‌گیری در حالت نمایشی فعال نیست", "warn"); return; }
    try {
      const resp = await API.req("POST", "/api/backups", { tag: "web" });
      BACKUPS = resp.backups;
      renderBackups();
      toast("پشتیبان‌گیری انجام شد", "success");
    } catch (e) { toast("خطا: " + esc(e.message), "error"); }
  }));
  el("btnExportJson").addEventListener("click", () => busy(el("btnExportJson"), async () => {
    if (!API.ok) { toast("خروجی JSON در حالت نمایشی فعال نیست", "warn"); return; }
    try {
      const f = await API.blob("GET", "/api/backups/export");
      downloadBlob(f.bytes, f.name, "application/json");
      toast("خروجی JSON دانلود شد", "success");
    } catch (e) { toast("خطا: " + esc(e.message), "error"); }
  }));
  el("btnImportJson").addEventListener("click", () => el("fileImportJson").click());
  el("fileImportJson").addEventListener("change", async () => {
    const f = el("fileImportJson").files[0];
    el("fileImportJson").value = "";
    if (!f) return;
    if (!API.ok) { toast("ورود JSON در حالت نمایشی فعال نیست", "warn"); return; }
    askConfirm(`محتوای «<b>${esc(f.name)}</b>» جایگزین داده‌های فعلی شود؟`, async () => {
      try {
        const text = await f.text();
        const resp = await API.req("POST", "/api/backups/import", { content: text });
        ingestBootstrap(resp);
        applySettingsToUI();
        renderAll();
        toast(resp.message || "داده‌ها وارد شد", "success");
      } catch (e) { toast("خطا: " + esc(e.message), "error"); }
    }, "ورود داده", "ورود");
  });
  el("backupsTable").addEventListener("click", (e) => {
    const r = e.target.closest("[data-restore-bk]");
    const d = e.target.closest("[data-del-bk]");
    if (!API.ok) { toast("مدیریت پشتیبان‌ها در حالت نمایشی فعال نیست", "warn"); return; }
    if (r) {
      const name = r.dataset.restoreBk;
      askConfirm(`بازیابی از «<b class="ltr">${esc(name)}</b>»؟<br>داده‌های فعلی جایگزین می‌شوند (ابتدا پشتیبانِ وضعیت فعلی گرفته می‌شود).`, async () => {
        try {
          const resp = await API.req("POST", "/api/backups/restore", { name });
          ingestBootstrap(resp);
          applySettingsToUI();
          renderAll();
          toast(resp.message || "بازیابی انجام شد", "success");
        } catch (err) { toast("خطا: " + esc(err.message), "error"); }
      }, "بازیابی نسخه‌ی پشتیبان", "بازیابی");
    } else if (d) {
      const name = d.dataset.delBk;
      askConfirm(`«<b class="ltr">${esc(name)}</b>» حذف شود؟`, async () => {
        try {
          BACKUPS = (await API.req("DELETE", "/api/backups", { name })).backups;
          renderBackups();
          toast("نسخه حذف شد", "success");
        } catch (err) { toast("خطا: " + esc(err.message), "error"); }
      }, "حذف نسخه");
    }
  });

  /* ═════════════════════ قابلیت‌های کارگاهی (افزوده‌شده) ═════════════════════ */

  /* --- ساخت خودکار درها برای همه‌ی یونیت‌های بدون در --- */
  const btnAuto = el("btnAutoDoors");
  if (btnAuto) btnAuto.addEventListener("click", () => {
    const pg = curPage();
    if (!pg) return;
    const styleData = (STYLES.find((s) => s.id === Number(pg.style_id)) || {}).data || {};
    let made = 0;
    pg.units.forEach((u) => {
      if ((u.doors || []).length) return;
      if ((u.drawers || []).length) return;            /* یونیت کشودار در نمی‌خواهد */
      autoDoorsForUnit(u, styleData);
      made += 1;
    });
    if (!made) { toast("همه‌ی یونیت‌ها از قبل در یا کشو دارند", "warn"); return; }
    markDirty(); renderEditorTables(); scheduleRecalc(50);
    toast(`${fa(made)} یونیت درِ هم‌اندازه گرفت (درز ۳ میلی‌متر) — تعداد لنگه و ابعاد را چک کنید`, "success");
  });

  /* --- هم‌اندازه‌سازی درهای موجود با طول/ارتفاع فعلی یونیت --- */
  const btnFit = el("btnFitDoors");
  if (btnFit) btnFit.addEventListener("click", () => {
    const pg = curPage();
    if (!pg) return;
    let n = 0;
    pg.units.forEach((u) => { if (fitDoorsToUnit(u)) n += 1; });
    if (!n) { toast("هیچ یونیتی در ندارد — ابتدا «ساخت خودکار درها» را بزنید", "warn"); return; }
    markDirty(); renderEditorTables(); scheduleRecalc(50);
    toast(`عرض لنگه‌های درِ ${fa(n)} یونیت با ابعاد فعلی هم‌اندازه شد`, "success");
  });

  /* --- الگوهای یونیت --- */
  const btnUseTpl = el("btnUseTpl");
  if (btnUseTpl) btnUseTpl.addEventListener("click", useTemplate);
  const btnManageTpl = el("btnManageTpl");
  if (btnManageTpl) btnManageTpl.addEventListener("click", () => {
    renderTemplatesTable(); openModal("templates");
  });
  const btnTplSave = el("btnTplSave");
  if (btnTplSave) btnTplSave.addEventListener("click", () => submitModal("tpl-save"));
  const tplTable = el("tplTable");
  if (tplTable) tplTable.addEventListener("click", (e) => {
    const use = e.target.closest("[data-tpl-use]");
    if (use) {
      const t = UNIT_TEMPLATES.find((x) => +x.id === +use.dataset.tplUse);
      if (!t) return;
      closeModal();
      el("tplSelect").value = String(t.id);
      useTemplate();
      return;
    }
    const del = e.target.closest("[data-tpl-del]");
    if (del) {
      const t = UNIT_TEMPLATES.find((x) => +x.id === +del.dataset.tplDel);
      askConfirm(`الگوی «<b>${esc(t ? t.name : "")}</b>» حذف شود؟`,
        () => deleteTemplate(del.dataset.tplDel), "حذف الگو");
    }
  });

  /* --- برش‌نامه و لیست خرید --- */
  const btnWs = el("btnWorkshop");
  if (btnWs) btnWs.addEventListener("click", () => busy(btnWs, openWorkshopModal));
  const wsTabs = el("wsTabs");
  if (wsTabs) wsTabs.addEventListener("click", (e) => {
    const t = e.target.closest("[data-wstab]");
    if (!t) return;
    _wsTab = t.dataset.wstab;
    renderWorkshop();
  });
  const btnWsXls = el("btnWsExcel");
  if (btnWsXls) btnWsXls.addEventListener("click", () => busy(btnWsXls, downloadWorkshopExcel));
  const btnWsPrint = el("btnWsPrint");
  if (btnWsPrint) btnWsPrint.addEventListener("click", () => {
    document.body.classList.add("printing-ws");
    const done = () => document.body.classList.remove("printing-ws");
    setTimeout(() => { window.print(); setTimeout(done, 400); }, 60);
  });

  /* --- رند کردن مبلغ نهایی --- */
  const btnRound = el("btnRoundPrice");
  if (btnRound) btnRound.addEventListener("click", () => roundFinalPrice());

  /* --- پیش‌پرداخت --- */
  ["tbDepositPct", "tbDepositAmt"].forEach((id) => {
    const n = el(id);
    if (!n) return;
    n.addEventListener("input", () => { markDirty("tb." + id); scheduleRecalc(); refreshTbUnits(); updateTbSummary(); });
    n.addEventListener("change", () => { markDirty("tb." + id); scheduleRecalc(); refreshTbUnits(); updateTbSummary(); });
  });

  /* --- گامِ رُندکردن: فقط خلاصه را تازه می‌کند (تا وقتی «رند کن» زده نشود
         مبلغی عوض نمی‌شود؛ پس «dirty» نمی‌شود و کاربر الکی هشدار نمی‌گیرد) --- */
  {
    const rs = el("tbRoundStep");
    if (rs) rs.addEventListener("change", updateTbSummary);
  }

  /* --- قیمت‌گیری سریع --- */
  const btnQk = el("btnQuickQuote");
  if (btnQk) btnQk.addEventListener("click", openQuickModal);
  /* ثبت با کلیکِ دکمه، با Enter و با Ctrl+S — هر سه از یک مسیر (submitModal)
     تا رفتار و پیام‌ها دقیقاً یکسان بماند.                                    */
  const btnQkBuild = el("btnQuickBuild");
  if (btnQkBuild) btnQkBuild.addEventListener("click", () => submitModal("quick"));
}

/* ==========================================================================
   شناسنامه‌ی مودال‌های دارای فرم
   --------------------------------------------------------------------------
   برای هر مودال: چه چیزی ثبت می‌کند (save)، با کدام دکمه (saveBtn)، چه
   برچسبی در هشدارِ «تغییرات ذخیره‌نشده» داشته باشد (label) و متنِ راهنمای
   کلید چه باشد (hint). این تنها جایی است که باید برای افزودنِ فرمِ جدید
   دست خورد — بقیه‌ی رفتار (Esc، کلیک بیرون، Enter، تله‌ی فوکوس) خودکار است.
   ========================================================================== */
const MODAL_FORMS = {
  material: { label: "فرمِ متریال", save: "saveMaterialForm", saveBtn: "btnSaveMaterial",
              hint: "Enter = ذخیره‌ی قلم" },
  bulk:     { label: "تغییر دسته‌جمعی قیمت‌ها", save: "applyBulkPrices", saveBtn: "btnApplyBulk",
              hint: "Enter = اعمال تغییر روی قیمت‌ها" },
  style:    { label: "فرمِ سبک", save: "saveStyleForm", saveBtn: "btnSaveStyle",
              hint: "Enter = ذخیره‌ی سبک" },
  project:  { label: "پروژه‌ی جدید", save: "createProjectForm", saveBtn: "btnCreateProject",
              hint: "Enter = ایجاد پروژه" },
  quick:    { label: "قیمت‌گیری سریع", save: "buildQuickProjectGuarded", saveBtn: "btnQuickBuild",
              hint: "Enter = ساخت پروژه و دیدن قیمت" },
  "tpl-save": { label: "الگوی یونیت", save: "saveUnitTemplate", saveBtn: "btnTplSave",
              hint: "Enter = ذخیره‌ی الگو" },
  /* مودال‌های بدونِ فرم: خروجشان بی‌خطر است، ولی برچسب برای هشدارها لازم است */
  breakdown: { label: "ریز محاسبه" },
  workshop:  { label: "بسته‌ی کارگاهی", alwaysDirty: false },
  templates: { label: "فهرست الگوها" },
};

function registerModalForms(fns) {
  fns = fns || {};
  Object.keys(MODAL_FORMS).forEach((id) => {
    const cfg = MODAL_FORMS[id];
    const saveFn = cfg.save ? (fns[cfg.save] || (typeof window !== "undefined" ? window[cfg.save] : null)) : null;
    registerModal(id, {
      label: cfg.label,
      saveBtn: cfg.saveBtn || null,
      save: saveFn ? () => saveFn() : null,
    });
    /* راهنمای کلید پایینِ مودال — کشف‌پذیریِ Enter برای کاربرِ کیبوردی */
    const foot = document.querySelector("#modal-" + id + " .modal-foot");
    if (foot && cfg.hint && !foot.querySelector(".kbd-hint")) {
      const h = document.createElement("span");
      h.className = "kbd-hint";
      h.innerHTML = "<kbd>Enter</kbd> " + esc(cfg.hint.replace(/^Enter = /, ""));
      foot.insertBefore(h, foot.firstChild);
    }
  });
}

/* helper برای svcLibrary */
function mat(name) { return MATERIALS.find((m) => m.name === name) || null; }

/* ---------------------------------------------------------------- اجرا */
function renderAll() {
  renderDashboard();
  renderMaterials();
  renderHistory();
  renderStyles();
  renderProjects();
  renderTemplateSelect();
  fillInvoiceProjects();
  renderInvRowChecks();
  renderArchive();
  renderBackups();
  fillSettings();
  if (state.editingProject && !PROJECTS.includes(state.editingProject)) {
    state.editingProject = null;
    el("projectEditor").hidden = true;
  }
}

function splashMsg(txt) {
  const m = el("splashMsg");
  if (m) m.textContent = txt;
}
function hideSplash() {
  const s = el("splash");
  if (!s) return;
  s.classList.add("done");
  setTimeout(() => s.remove(), 700);
}

/* پایش سلامت اتصال: اگر سرور قطع شد بنر نمایشی، و اگر برگشت وصل می‌شود */
function startConnWatchdog() {
  let fails = 0;
  setInterval(async () => {
    if (document.hidden) return;
    if (API.ok) {
      const h = await healthPing(3000);
      if (!h) {
        fails++;
        if (fails >= 2) {
          API.ok = false;
          fails = 0;
          setConnBadge();
          toast("اتصال به سرور کبیر قطع شد — حالت نمایشی فعال است", "warn");
        }
      } else fails = 0;
    } else {
      const ok = await tryConnect(true);
      if (ok) {
        setConnBadge();
        renderAll();
        toast("دوباره به سرور کبیر متصل شد", "success");
      }
    }
  }, 20000);
}

async function init() {
  if (window.__kabirInit) return;      /* محافظ در برابر اجرای دوباره */
  window.__kabirInit = true;
  /* پوسته‌ی ذخیره‌شده فوراً اعمال شود */
  const savedTheme = storeGet("kabir-theme", null);
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  el("btnTheme").innerHTML = document.documentElement.dataset.theme === "dark" ? ICONS.sun : ICONS.moon;
  const savedFs = storeGet("kabir-fs", null);
  if (savedFs) document.documentElement.style.setProperty("--app-fs", savedFs + "px");

  el("invDate").value = TODAY_FA;

  splashMsg("اتصال به پایگاه‌داده‌ی محلی…");
  const ok = await tryConnect(true);
  setConnBadge();
  splashMsg("آماده‌سازی رابط کاربری…");
  applyTheme(storeGet("kabir-theme", null) || SETTINGS.theme || "light", true);
  applySettingsToUI();
  fillStyleSelects();
  renderAll();
  wire();
  startConnWatchdog();

  const route = () => {
    const h = (location.hash || "").replace(/^#\/?/, "").split("/");
    const page = PAGES[h[0]] ? h[0] : "dashboard";
    navigate(page, h[1], true);
    if (page === "projects" && h[1]) openProjectEditor(h[1]);
  };
  window.addEventListener("hashchange", route);
  route();
  hideSplash();
  if (!ok) {
    setTimeout(() => toast("سرور کبیر در دسترس نیست — رابط در <b>حالت نمایشی</b> با داده‌های نمونه اجرا شد. برای اتصال واقعی کبیر را اجرا کنید: <b class='ltr'>python main.py</b>", "warn"), 900);
  }
}

document.addEventListener("DOMContentLoaded", init);

/* صادرات برای تست (در مرورگر بی‌اثر است) */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { calcProjectLocal, buildInvoiceDataDemo, num2words, parseNum, fmt, toEn, unitArea };
}
