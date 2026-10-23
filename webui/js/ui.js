/* ==========================================================================
   کبیر ۲ — ui.js
   رندرها، ویرایشگر پروژه، فاکتور، تنظیمات و سیم‌کشی رویدادها.
   حالت متصل: داده از API (kabir/web/server.py) و محاسبه با موتور واقعی.
   حالت نمایشی: داده‌های نمونه و موتور محلی (engine.js) — بدون سرور.
   ========================================================================== */
"use strict";

/* ------------------------------------------------------------- توست و مودال */
function toast(msg, type) {
  type = type || "info";
  const ic = type === "success" ? ICONS.check : type === "error" ? ICONS.x : type === "warn" ? ICONS.warn : ICONS.info;
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.innerHTML = `<span class="t-ic">${ic}</span><span>${msg}</span>`;
  el("toasts").appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 260); }, 3600);
}

function openModal(id) {
  el("modalBackdrop").hidden = false;
  $$(".modal").forEach((m) => m.classList.toggle("open", m.id === "modal-" + id));
  document.body.style.overflow = "hidden";
}
function closeModal() {
  el("modalBackdrop").hidden = true;
  $$(".modal").forEach((m) => m.classList.remove("open"));
  document.body.style.overflow = "";
}
function confirmAction(text, cb, title, okLabel) {
  el("confirmText").innerHTML = text;
  el("confirmTitle").textContent = title || "تأیید عملیات";
  el("btnConfirmOk").textContent = okLabel || "حذف";
  state.confirmCb = cb;
  openModal("confirm");
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

function navigate(page, sub, silentScroll) {
  state.page = page;
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
  el("statProjects").innerHTML = fa(d.projects);
  el("statProjectsSub").textContent = d.sub;
  el("statSales").innerHTML = `${fmt(scaled(d.sales) / 1e6)} <small>میلیون ${CUR.name}</small>`;
  const tr = el("statSalesTrend");
  tr.className = "stat-trend " + (d.growth >= 0 ? "up" : "down");
  tr.textContent = (d.growth >= 0 ? "▲ +" : "▼ ") + fmt(Math.abs(d.growth), true) + "٪";
  el("statProfit").innerHTML = `${fmt(scaled(d.profit) / 1e6)} <small>میلیون ${CUR.name}</small>`;
  el("statMaterials").innerHTML = fa(d.materials);
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

function renderMaterials() {
  renderChips();
  const rows = filteredMaterials();
  if (!rows.length) {
    el("matTable").innerHTML = `<tbody><tr><td><div class="empty">${ICONS.inbox}<div>موردی یافت نشد.</div></div></td></tr></tbody>`;
  } else {
    el("matTable").innerHTML = `
      <thead><tr>
        <th>شناسه</th><th>نام</th><th>دسته‌بندی</th><th>مشخصات</th><th>واحد</th>
        <th>قیمت (${CUR.name})</th><th>تأمین‌کننده</th><th>وضعیت</th><th>عملیات</th>
      </tr></thead>
      <tbody>${rows.map((m) => `
        <tr>
          <td class="sub">${fa(m.id)}</td>
          <td><b>${esc(m.name)}</b>${m.note ? `<div class="sub">${esc(m.note)}</div>` : ""}</td>
          <td><span class="badge b-final" style="font-weight:500">${esc(catLabel(m.cat))}</span></td>
          <td class="sub nowrap">${m.thickness_mm ? fa(m.thickness_mm) + " میل" : "—"}${m.sheet_width_cm ? " • " + fa(m.sheet_width_cm) + "×" + fa(m.sheet_height_cm) : ""}${m.width_cm ? " • عرض " + fa(m.width_cm) : ""}</td>
          <td>${UNITS[m.unit] || m.unit}</td>
          <td class="num">${fmt(m.price)}</td>
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
function renderProjects() {
  const q = el("projSearch").value.trim();
  const f = el("projFilter").value;
  const rows = PROJECTS.filter((p) =>
    (f === "all" || p.status === f) &&
    (!q || p.title.includes(q) || (p.customer || "").includes(q) || p.code.includes(q)));
  if (!rows.length) {
    el("projectsTable").innerHTML = `<tbody><tr><td><div class="empty">${ICONS.inbox}<div>پروژه‌ای یافت نشد.</div></div></td></tr></tbody>`;
    return;
  }
  el("projectsTable").innerHTML = `
    <thead><tr>
      <th>کد</th><th>عنوان</th><th>مشتری</th><th>وضعیت</th><th>سبک</th>
      <th>تاریخ</th><th>مبلغ نهایی (${CUR.name})</th><th>عملیات</th>
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
        <td class="num">${p.status === "canceled" ? "—" : fmt(scaled(amt))}</td>
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
    ${mats.map((m) => `<option value="${m.id}"${Number(selectedId) === m.id ? " selected" : ""}>${esc(m.name)}</option>`).join("")}
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
  el("facadeMode").value = pg.detail_mode || "none";
  el("facadeTotalWrap").classList.toggle("hidden", pg.detail_mode !== "total");
  el("facadeRowsWrap").classList.toggle("hidden", pg.detail_mode !== "detailed");
  el("facadeTotalSqm").value = pg.detail_total_sqm ? fa(pg.detail_total_sqm) : "";
  el("facadeTotalPrice").value = pg.detail_price_per_sqm ? fa(pg.detail_price_per_sqm) : "";
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

function inp(scope, k, val, extra) {
  return `<input class="cell-input" type="text" inputmode="numeric" data-scope="${scope}" data-k="${k}" value="${fa(val ?? 0)}" ${extra || ""}>`;
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

function renderEditorTables() {
  const p = state.editingProject;
  const pg = curPage();
  if (!p || !pg) return;
  const del = (kind, ui, di) =>
    iconBtn("del", "trash", "حذف", `data-del-row="${kind}" data-ui="${ui ?? ""}" data-di="${di ?? ""}"`);

  /* --- یونیت‌ها --- */
  let uRows = "";
  pg.units.forEach((u, i) => {
    const open = state.expanded.has(`${p.id}:${state.pageIdx}:${i}`);
    uRows += `
      <tr>
        <td>${inpT("unit", "label", u.label, `data-ui="${i}"`)}</td>
        <td><select class="cell-select" data-scope="unit" data-k="unit_type" data-ui="${i}">
          ${Object.entries(UNIT_TYPES).map(([k, l]) => `<option value="${k}"${u.unit_type === k ? " selected" : ""}>${l}</option>`).join("")}
        </select></td>
        <td>${inp("unit", "length_cm", u.length_cm, `data-ui="${i}"`)}</td>
        <td>${inp("unit", "height_cm", u.height_cm, `data-ui="${i}"`)}</td>
        <td>${inp("unit", "depth_cm", u.depth_cm, `data-ui="${i}"`)}</td>
        <td>${inp("unit", "qty", u.qty, `data-ui="${i}"`)}</td>
        <td>${inp("unit", "shelves", u.shelves, `data-ui="${i}"`)}</td>
        <td><span class="count-badge" title="لنگه در">${fa(u.doors.reduce((a, d) => a + (+d.qty || 0), 0) * (+u.qty || 1))}</span>
            <span class="count-badge" title="کشو">${fa(u.drawers.reduce((a, d) => a + (+d.qty || 0), 0) * (+u.qty || 1))}</span></td>
        <td><button class="expander${open ? " open" : ""}" type="button" data-expand="${i}" title="متریال و یراق یونیت">${ICONS.chev}</button></td>
        <td>${del("unit", i)}</td>
      </tr>`;
    if (open) {
      uRows += `
      <tr class="unit-detail-row"><td colspan="10">
        <div class="unit-detail">
          ${UNIT_MAT_FIELDS.map(([k, label, cat]) => `
            <div class="field"><label>${label}</label>
              ${matSelect(cat, u[k], `data-scope="unit" data-k="${k}" data-ui="${i}"`)}
            </div>`).join("")}
          <div class="field"><label>تعداد پایه در یونیت</label>${inp("unit", "legs_per_unit", u.legs_per_unit, `data-ui="${i}"`)}</div>
          <div class="field"><label>خار در هر طبقه</label>${inp("unit", "pins_per_shelf", u.pins_per_shelf, `data-ui="${i}"`)}</div>
          <div class="ud-checks">
            <label class="check"><input type="checkbox" data-scope="unit" data-k="has_top_panel" data-ui="${i}"${u.has_top_panel !== false ? " checked" : ""}> سقف یونیت</label>
            <label class="check"><input type="checkbox" data-scope="unit" data-k="has_bottom_panel" data-ui="${i}"${u.has_bottom_panel !== false ? " checked" : ""}> کف یونیت</label>
            <span class="tiny muted">مساحت بدنه‌ی این یونیت: <b>${fmt(unitArea(u) * (+u.qty || 1), true)}</b> م² (بدون فیبر پشت)</span>
          </div>
        </div>
      </td></tr>`;
    }
  });
  el("tblUnits").innerHTML = `
    <thead><tr><th>برچسب</th><th>نوع</th><th>طول</th><th>ارتفاع</th><th>عمق</th><th>تعداد</th><th>طبقات</th><th>در/کشو</th><th>جزئیات</th><th></th></tr></thead>
    <tbody>${uRows || `<tr><td colspan="10"><div class="empty">یونیتی تعریف نشده — «＋ افزودن یونیت» را بزنید.</div></td></tr>`}</tbody>`;

  /* --- درها (سطح بخش، وابسته به یونیت) --- */
  let dRows = "";
  pg.units.forEach((u, ui) => u.doors.forEach((dr, di) => {
    dRows += `
      <tr>
        <td><select class="cell-select" data-scope="doormove" data-ui="${ui}" data-di="${di}">
          ${pg.units.map((x, i2) => `<option value="${i2}"${i2 === ui ? " selected" : ""}>${esc(x.label || `یونیت ${i2 + 1}`)}</option>`).join("")}
        </select></td>
        <td>${inpT("door", "label", dr.label, `data-ui="${ui}" data-di="${di}"`)}</td>
        <td>${inp("door", "qty", dr.qty, `data-ui="${ui}" data-di="${di}"`)}</td>
        <td>${inp("door", "w_cm", dr.w_cm, `data-ui="${ui}" data-di="${di}"`)}</td>
        <td>${inp("door", "h_cm", dr.h_cm, `data-ui="${ui}" data-di="${di}"`)}</td>
        <td>${matSelect("door_sheet", dr.material_id, `data-scope="door" data-k="material_id" data-ui="${ui}" data-di="${di}"`)}</td>
        <td>${matSelect("door_model", dr.door_model_id, `data-scope="door" data-k="door_model_id" data-ui="${ui}" data-di="${di}"`)}</td>
        <td>${matSelect("hinge", dr.hinge_id, `data-scope="door" data-k="hinge_id" data-ui="${ui}" data-di="${di}"`)}</td>
        <td>${matSelect("handle", dr.handle_id, `data-scope="door" data-k="handle_id" data-ui="${ui}" data-di="${di}"`)}</td>
        <td>${matSelect("service", dr.assembly_id, `data-scope="door" data-k="assembly_id" data-ui="${ui}" data-di="${di}"`)}</td>
        <td>${matSelect("service", dr.packaging_id, `data-scope="door" data-k="packaging_id" data-ui="${ui}" data-di="${di}"`)}</td>
        <td>${del("door", ui, di)}</td>
      </tr>`;
  }));
  el("tblDoors").innerHTML = `
    <thead><tr><th>یونیت</th><th>برچسب</th><th>لنگه</th><th>عرض</th><th>ارتفاع</th><th>ورق در</th><th>مدل/اجرت</th><th>لولا</th><th>دستگیره</th><th>مونتاژ</th><th>بسته‌بندی</th><th></th></tr></thead>
    <tbody>${dRows || `<tr><td colspan="12"><div class="empty">دری تعریف نشده است.</div></td></tr>`}</tbody>`;

  /* --- کشوها --- */
  let wRows = "";
  pg.units.forEach((u, ui) => u.drawers.forEach((dw, di) => {
    wRows += `
      <tr>
        <td><select class="cell-select" data-scope="drawermove" data-ui="${ui}" data-di="${di}">
          ${pg.units.map((x, i2) => `<option value="${i2}"${i2 === ui ? " selected" : ""}>${esc(x.label || `یونیت ${i2 + 1}`)}</option>`).join("")}
        </select></td>
        <td>${inpT("drawer", "label", dw.label, `data-ui="${ui}" data-di="${di}"`)}</td>
        <td>${inp("drawer", "qty", dw.qty, `data-ui="${ui}" data-di="${di}"`)}</td>
        <td>${inp("drawer", "w_cm", dw.w_cm, `data-ui="${ui}" data-di="${di}"`)}</td>
        <td>${inp("drawer", "h_cm", dw.h_cm, `data-ui="${ui}" data-di="${di}"`)}</td>
        <td>${inp("drawer", "d_cm", dw.d_cm, `data-ui="${ui}" data-di="${di}"`)}</td>
        <td>${matSelect("drawer_slide", dw.slide_id, `data-scope="drawer" data-k="slide_id" data-ui="${ui}" data-di="${di}"`)}</td>
        <td>${matSelect("drawer_sheet", dw.sheet_id, `data-scope="drawer" data-k="sheet_id" data-ui="${ui}" data-di="${di}"`)}</td>
        <td>${matSelect("door_sheet", dw.front_id, `data-scope="drawer" data-k="front_id" data-ui="${ui}" data-di="${di}"`)}</td>
        <td>${matSelect("handle", dw.handle_id, `data-scope="drawer" data-k="handle_id" data-ui="${ui}" data-di="${di}"`)}</td>
        <td>${del("drawer", ui, di)}</td>
      </tr>`;
  }));
  el("tblDrawers").innerHTML = `
    <thead><tr><th>یونیت</th><th>برچسب</th><th>تعداد</th><th>عرض</th><th>ارتفاع</th><th>عمق</th><th>ریل</th><th>ورق جعبه</th><th>تیره‌ی کشو</th><th>دستگیره</th><th></th></tr></thead>
    <tbody>${wRows || `<tr><td colspan="11"><div class="empty">کشویی تعریف نشده است.</div></td></tr>`}</tbody>`;

  /* --- درنما --- */
  if (pg.detail_mode === "detailed") {
    el("tblFacade").innerHTML = `
      <thead><tr><th>عنوان</th><th>تعداد</th><th>عرض (cm)</th><th>ارتفاع (cm)</th><th>قیمت هر م²</th><th>مساحت (م²)</th><th>جمع</th><th></th></tr></thead>
      <tbody>${pg.detail_rows.map((r, i) => {
        const area = (+r.qty || 0) * ((+r.w_cm || 0) / 100) * ((+r.h_cm || 0) / 100);
        return `<tr>
          <td>${inpT("facade", "label", r.label, `data-ri="${i}"`)}</td>
          <td>${inp("facade", "qty", r.qty, `data-ri="${i}"`)}</td>
          <td>${inp("facade", "w_cm", r.w_cm, `data-ri="${i}"`)}</td>
          <td>${inp("facade", "h_cm", r.h_cm, `data-ri="${i}"`)}</td>
          <td>${inp("facade", "price_per_sqm", r.price_per_sqm, `data-ri="${i}"`)}</td>
          <td class="num f-area" data-ri="${i}">${fmt(area, 1)}</td>
          <td class="num f-sum" data-ri="${i}">${fmt(scaled(area * (+r.price_per_sqm || 0)))}</td>
          <td>${del("facade", null, i)}</td>
        </tr>`;
      }).join("") || `<tr><td colspan="8"><div class="empty">ردیفی نیست — «＋ افزودن ردیف درنما» را بزنید.</div></td></tr>`}
      </tbody>`;
  } else {
    el("tblFacade").innerHTML = "";
  }

  /* --- اضافات --- */
  el("tblExtras").innerHTML = `
    <thead><tr><th>عنوان</th><th>تعداد</th><th>واحد</th><th>فی (${CUR.name})</th><th>جمع</th><th>در فاکتور</th><th></th></tr></thead>
    <tbody>${pg.extras.map((r, i) => `
      <tr>
        <td>${inpT("extra", "label", r.label, `data-ri="${i}" style="min-width:11rem"`)}</td>
        <td>${inp("extra", "qty", r.qty, `data-ri="${i}"`)}</td>
        <td><select class="cell-select" data-scope="extra" data-k="unit" data-ri="${i}">
          ${Object.entries(UNITS).map(([k, l]) => `<option value="${k}"${r.unit === k ? " selected" : ""}>${l}</option>`).join("")}
        </select></td>
        <td>${inp("extra", "price", r.price, `data-ri="${i}"`)}</td>
        <td class="num x-sum" data-ri="${i}">${fmt(scaled((+r.qty || 0) * (+r.price || 0)))}</td>
        <td><label class="check" style="justify-content:center"><input type="checkbox" data-scope="extra" data-k="visible" data-ri="${i}"${r.visible !== false ? " checked" : ""}></label></td>
        <td>${del("extra", null, i)}</td>
      </tr>`).join("") || `<tr><td colspan="7"><div class="empty">قلمی نیست.</div></td></tr>`}
    </tbody>`;

  /* --- خدمات --- */
  el("svcLibrary").innerHTML = `<option value="">— انتخاب کنید —</option>` +
    catNames("service").map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
  el("tblServices").innerHTML = `
    <thead><tr><th>شرح خدمت</th><th>مبنا</th><th>نرخ (${CUR.name})</th><th></th></tr></thead>
    <tbody>${pg.services.map((s, i) => `
      <tr>
        <td>${inpT("service", "label", s.label, `data-ri="${i}" style="min-width:13rem"`)}</td>
        <td><select class="cell-select" data-scope="service" data-k="basis" data-ri="${i}">
          ${Object.entries(SERVICE_BASIS).map(([k, l]) => `<option value="${k}"${s.basis === k ? " selected" : ""}>${l}</option>`).join("")}
        </select></td>
        <td>${inp("service", "price", s.price, `data-ri="${i}"`)}</td>
        <td>${del("service", null, i)}</td>
      </tr>`).join("") || `<tr><td colspan="4"><div class="empty">خدمتی نیست — از کتابخانه اضافه کنید.</div></td></tr>`}
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

/* ---------------------------------------------------------- محاسبه‌ی زنده */
function calcFields(p) {
  return {
    id: p.id, install_mode: p.install_mode, install_value: +p.install_value || 0,
    profit_mode: p.profit_mode, profit_percent: +p.profit_percent || 0,
    discount_percent: +p.discount_percent || 0, discount_amount: +p.discount_amount || 0,
    vat_enabled: p.vat_enabled ? 1 : 0, vat_percent: +p.vat_percent || 0,
    extra_fixed_amount: +p.extra_fixed_amount || 0,
  };
}
function invPayload(p) {
  return Object.assign(calcFields(p), {
    code: p.code, title: p.title, customer: p.customer, mobile: p.mobile,
    phone: p.phone, address: p.address, valid_until: p.valid_until, note: p.note || "",
  });
}

let _calcTimer = null;
function markDirty() {
  if (!state.dirty) {
    state.dirty = true;
    const b = el("btnSaveProject");
    if (b) b.classList.add("dirty");
  }
}
function clearDirty() {
  state.dirty = false;
  const b = el("btnSaveProject");
  if (b) b.classList.remove("dirty");
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
  updateComputedCells();
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
}

function readSectionBarInto() {
  const pg = curPage();
  if (!pg) return;
  pg.name = el("secName").value.trim() || pg.name;
  pg.waste_percent = parseNum(el("secWaste").value);
  pg.overhead_percent = parseNum(el("secOverhead").value);
  pg.countertop_lm = parseNum(el("secCounterLm").value);
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

function openProjectEditor(id) {
  const p = PROJECTS.find((x) => x.id === Number(id));
  if (!p) return;
  state.editingProject = p;
  state.pageIdx = 0;
  state.expanded.clear();
  el("projectEditor").hidden = false;
  el("edCode").value = p.code || "—";
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
  el("tbInstallVal").value = fa(p.install_value || "");
  el("tbDiscPct").value = p.discount_percent ? fa(p.discount_percent) : "";
  el("tbDiscAmt").value = p.discount_amount ? fa(p.discount_amount) : "";
  el("tbVat").checked = !!p.vat_enabled;
  el("tbVatPct").value = fa(p.vat_percent ?? 10);
  el("tbExtraFixed").value = p.extra_fixed_amount ? fa(p.extra_fixed_amount) : "";
  clearDirty();
  renderSectionPills();
  renderSectionBar();
  renderEditorTables();
  recalcTotals();
  el("projectEditor").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeProjectEditor() {
  const doClose = () => {
    state.editingProject = null;
    el("projectEditor").hidden = true;
  };
  if (state.dirty && API.ok) {
    confirmAction("تغییرات ذخیره‌نشده دارید. بدون ذخیره بستن؟", doClose, "بستن ویرایشگر", "بستن");
  } else doClose();
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
  el("breakdownBody").innerHTML = `
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
    </div>`;
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
  el("archiveTable").innerHTML = ARCHIVE.length ? `
    <thead><tr><th>شماره</th><th>نوع</th><th>پروژه</th><th>مشتری</th><th>تاریخ</th><th>مبلغ (${CUR.name})</th><th>عملیات</th></tr></thead>
    <tbody>${ARCHIVE.map((a) => `
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
};
const NUMERIC_SETTINGS = new Set(["setProfitPct", "setOverhead", "setWaste", "setInstallVal",
  "setSheetW", "setSheetH", "setFiberW", "setFiberH", "setBandBody", "setBandDoor",
  "setVatPct", "setBackupKeep"]);

function fillSettings() {
  for (const [id, key] of Object.entries(SETTING_MAP)) {
    const v = SETTINGS[key];
    if (v === undefined || el(id) == null) continue;
    if (NUMERIC_SETTINGS.has(id)) el(id).value = fa(v);
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
  try {
    localStorage.setItem("kabir-demo-db", JSON.stringify({
      materials: MATERIALS, styles: STYLES, projects: PROJECTS,
      history: HISTORY, archive: ARCHIVE, settings: SETTINGS,
    }));
  } catch (e) { /* حافظه پر یا حالت خصوصی */ }
}

/* ============================================================== سیم‌کشی */
function wire() {
  /* --- ناوبری --- */
  $$(".nav-btn").forEach((b) => b.addEventListener("click", () => navigate(b.dataset.page)));
  el("btnMenu").addEventListener("click", () => document.body.classList.toggle("nav-open"));
  el("scrim").addEventListener("click", () => document.body.classList.remove("nav-open"));
  $$("[data-goto]").forEach((a) => a.addEventListener("click", () => navigate(a.dataset.goto)));

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

  /* --- میان‌برها --- */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      el("searchDrop").hidden = true;
      document.body.classList.remove("nav-open");
    }
    if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      e.preventDefault(); gs.focus();
    }
    if (e.altKey && /^[1-6]$/.test(e.key)) {
      navigate(Object.keys(PAGES)[Number(e.key) - 1]);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && state.editingProject && state.page === "projects") {
      e.preventDefault();
      saveProject();
    }
  });
  window.addEventListener("beforeunload", (e) => {
    if (state.dirty && API.ok) { e.preventDefault(); e.returnValue = ""; }
  });

  /* --- مودال‌ها --- */
  el("modalBackdrop").addEventListener("click", (e) => { if (e.target === el("modalBackdrop")) closeModal(); });
  $$("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
  el("btnConfirmOk").addEventListener("click", () => {
    closeModal();
    if (state.confirmCb) { state.confirmCb(); state.confirmCb = null; }
  });

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
    if (!API.ok) { toast("خروجی اکسل در حالت نمایشی فعال نیست — `python web.py` را اجرا کنید", "warn"); return; }
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
      el("mfPrice").value = fa(m.price);
      el("mfThick").value = m.thickness_mm ? fa(m.thickness_mm) : "";
      el("mfSheetW").value = m.sheet_width_cm ? fa(m.sheet_width_cm) : "";
      el("mfSheetH").value = m.sheet_height_cm ? fa(m.sheet_height_cm) : "";
      el("mfWidth").value = m.width_cm ? fa(m.width_cm) : "";
      el("mfSupplier").value = m.supplier || "";
      el("mfNote").value = m.note || "";
      el("mfStatus").checked = !!m.active;
      openModal("material");
    } else if (del) {
      const m = MATERIALS.find((x) => x.id === +del.dataset.delMat);
      confirmAction(`«<b>${esc(m.name)}</b>» برای همیشه حذف شود؟`, async () => {
        if (API.ok) {
          try { MATERIALS = (await API.req("DELETE", `/api/materials/${m.id}`)).materials; }
          catch (err) { toast("حذف ناموفق: " + esc(err.message), "error"); return; }
        } else {
          MATERIALS.splice(MATERIALS.indexOf(m), 1);
          demoSave();
        }
        afterMaterialsChanged();
        toast("متریال حذف شد", "success");
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
  });

  el("btnSaveMaterial").addEventListener("click", async () => {
    const payload = matPayload();
    if (!payload.name) { toast("نام قلم را وارد کنید", "error"); return; }
    if (payload.price <= 0) { toast("قیمت معتبر وارد کنید", "error"); return; }
    if (API.ok) {
      try {
        const resp = state.editingMaterial
          ? await API.req("PUT", `/api/materials/${state.editingMaterial.id}`, payload)
          : await API.req("POST", "/api/materials", payload);
        MATERIALS = resp.materials;
      } catch (err) { toast("ذخیره ناموفق: " + esc(err.message), "error"); return; }
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
    closeModal();
    afterMaterialsChanged();
    toast(state.editingMaterial ? "تغییرات قلم ذخیره شد" : "قلم جدید ذخیره شد", "success");
  });

  function afterMaterialsChanged() {
    renderMaterials();
    renderDashboard();
    fillStyleSelects();
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
  el("btnApplyBulk").addEventListener("click", async () => {
    const pct = parseNum(el("bulkPct").value);
    if (!pct) { toast("درصد تغییر را وارد کنید", "error"); return; }
    const scope = ($("input[name=bulkScope]:checked") || {}).value;
    const reason = el("bulkReason").value.trim() || "به‌روزرسانی نرخ بازار";
    const cat = scope === "cat" && state.matCat !== "all" ? state.matCat : null;
    if (API.ok) {
      try {
        const resp = await API.req("POST", "/api/materials/bulk", { cat, percent: pct, reason });
        MATERIALS = resp.materials;
        HISTORY = resp.history || HISTORY;
        closeModal();
        afterMaterialsChanged();
        renderHistory();
        toast(`قیمت ${fa(resp.count)} قلم به‌روز شد (${pct > 0 ? "+" : ""}${fmt(pct, true)}٪)`, "success");
      } catch (err) { toast("خطا: " + esc(err.message), "error"); }
      return;
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
    closeModal();
    afterMaterialsChanged();
    renderHistory();
    toast(`قیمت ${fa(count)} قلم به‌روز شد (${pct > 0 ? "+" : ""}${fmt(pct, true)}٪)`, "success");
  });

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

  el("btnSaveStyle").addEventListener("click", async () => {
    const payload = stylePayload();
    if (!payload.name) { toast("نام سبک را وارد کنید", "error"); return; }
    if (API.ok) {
      try {
        const resp = state.editingStyle
          ? await API.req("PUT", `/api/styles/${state.editingStyle.id}`, payload)
          : await API.req("POST", "/api/styles", payload);
        STYLES = resp.styles;
      } catch (err) { toast("ذخیره ناموفق: " + esc(err.message), "error"); return; }
    } else {
      if (state.editingStyle) Object.assign(state.editingStyle, payload);
      else STYLES.push(Object.assign({ id: Math.max(0, ...STYLES.map((s) => s.id)) + 1 }, payload));
      demoSave();
    }
    closeModal();
    renderStyles();
    if (state.editingProject) renderSectionBar();
    toast("سبک ذخیره شد", "success");
  });

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
      confirmAction(`سبک «<b>${esc(st.name)}</b>» حذف شود؟`, async () => {
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

  function openNewProjectModal(preStyleId) {
    ["pfTitle", "pfCustomer", "pfMobile"].forEach((i) => (el(i).value = ""));
    el("pfStyle").innerHTML = STYLES.length
      ? STYLES.map((s) => `<option value="${s.id}">✦ ${esc(s.name)}</option>`).join("")
      : `<option value="0">— بدون سبک —</option>`;
    if (preStyleId) el("pfStyle").value = String(preStyleId);
    el("pfStatus").value = "draft";
    openModal("project");
  }

  el("btnCreateProject").addEventListener("click", async () => {
    const title = el("pfTitle").value.trim();
    if (!title) { toast("عنوان پروژه را وارد کنید", "error"); return; }
    const styleId = Number(el("pfStyle").value) || 0;
    const body = {
      title, customer: el("pfCustomer").value.trim(), mobile: el("pfMobile").value.trim(),
      status: el("pfStatus").value, style_id: styleId,
    };
    let np;
    if (API.ok) {
      try { np = normalizeProject((await API.req("POST", "/api/projects", body)).project); }
      catch (err) { toast("ایجاد ناموفق: " + esc(err.message), "error"); return; }
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
    closeModal();
    renderProjects(); renderDashboard(); fillInvoiceProjects();
    openProjectEditor(np.id);
    toast("پروژه‌ی جدید ایجاد شد — یونیت‌ها را وارد کنید", "success");
  });

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
      confirmAction(`پروژه‌ی «<b>${esc(p.title)}</b>» و همه‌ی داده‌های آن حذف شود؟`, async () => {
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
  el("btnSaveProject").addEventListener("click", () => saveProject());
  el("btnDupProject").addEventListener("click", async () => {
    const p = state.editingProject;
    if (!p) return;
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
  });

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
      confirmAction(`بخش «<b>${esc(p.pages[i].name)}</b>» و همه‌ی یونیت‌هایش حذف شود؟`, () => {
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
  el("btnApplyStyle").addEventListener("click", () => {
    const pg = curPage();
    if (!pg) return;
    if (!pg.style_id) { toast("ابتدا یک سبک انتخاب کنید", "warn"); return; }
    const st = STYLES.find((s) => s.id === Number(pg.style_id));
    confirmAction(`متریالِ سبک «<b>${esc(st.name)}</b>» روی همه‌ی یونیت‌ها، درها و کشوهای این بخش اعمال شود؟`, () => {
      applyStyleToPage(pg, pg.style_id);
      markDirty();
      renderSectionBar(); renderEditorTables(); scheduleRecalc(50);
      toast(`سبک «${esc(st.name)}» روی بخش اعمال شد`, "success");
    }, "اعمال سبک", "اعمال");
  });
  ["secWaste", "secOverhead", "secCounterLm", "facadeTotalSqm", "facadeTotalPrice"].forEach((id) =>
    el(id).addEventListener("input", () => { readSectionBarInto(); markDirty(); scheduleRecalc(); }));
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
    if (kind === "units") {
      const u = defaultUnit();
      applyStyleToUnit(u, d);
      pg.units.push(u);
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
    } else if (kind === "drawers") {
      if (!pg.units.length) { toast("ابتدا یک یونیت بسازید", "warn"); return; }
      const dw = defaultDrawer();
      if (d.slide) dw.slide_id = midByName(d.slide);
      if (d.drawer_sheet) dw.sheet_id = midByName(d.drawer_sheet);
      if (d.door) dw.front_id = midByName(d.door);
      if (d.handle) dw.handle_id = midByName(d.handle);
      if (d.banding) dw.banding_id = midByName(d.banding);
      pg.units[state.lastUnitIdx || 0].drawers.push(dw);
    } else if (kind === "facade") {
      if (pg.detail_mode !== "detailed") {
        pg.detail_mode = "detailed";
        renderSectionBar();
      }
      pg.detail_rows.push({ label: "ردیف درنما", qty: 1, w_cm: 100, h_cm: 60, price_per_sqm: 300000 });
    } else if (kind === "extras") {
      pg.extras.push({ label: "قلم جدید", qty: 1, unit: "piece", price: 500000, visible: true });
    } else if (kind === "services") {
      pg.services.push({ label: "خدمت جدید", basis: "fixed", qty: 1, price: 300000 });
    }
    markDirty();
    renderEditorTables();
    scheduleRecalc(50);
    toast("ردیف اضافه شد — مقادیر را ویرایش کنید");
  }));

  /* --- ویرایش زنده‌ی جدول‌ها --- */
  const NUM_KEYS = new Set(["qty", "length_cm", "height_cm", "depth_cm", "shelves", "legs_per_unit",
    "pins_per_shelf", "w_cm", "h_cm", "d_cm", "price", "price_per_sqm", "hinges_per_leaf",
    "gas_springs_per_leaf", "handles_per_leaf"]);
  const BOOL_KEYS = new Set(["glass", "has_top_panel", "has_bottom_panel", "visible"]);

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
    markDirty();
    scheduleRecalc();
    updateComputedCells();
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
    const d = e.target.closest("[data-del-row]");
    if (d) {
      const kind = d.dataset.delRow;
      const ui = d.dataset.ui !== "" ? +d.dataset.ui : null;
      const di = d.dataset.di !== "" ? +d.dataset.di : null;
      if (kind === "unit") pg.units.splice(ui, 1);
      else if (kind === "door") pg.units[ui].doors.splice(di, 1);
      else if (kind === "drawer") pg.units[ui].drawers.splice(di, 1);
      else if (kind === "facade") pg.detail_rows.splice(di, 1);
      else if (kind === "extra") pg.extras.splice(di, 1);
      else if (kind === "service") pg.services.splice(di, 1);
      markDirty();
      renderEditorTables();
      scheduleRecalc(50);
      toast("ردیف حذف شد");
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
    el(id).addEventListener("input", () => { markDirty(); scheduleRecalc(); });
    el(id).addEventListener("change", () => { markDirty(); scheduleRecalc(); });
  });
  el("btnBreakdown").addEventListener("click", async () => {
    if (!state.editingProject) return;
    await recalcTotals();
    renderBreakdown();
    openModal("breakdown");
  });
  el("btnBreakdownInvoice").addEventListener("click", async () => {
    closeModal();
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
  el("btnRefreshInv").addEventListener("click", async () => {
    renderInvRowChecks();
    await refreshInvoice();
    toast("فاکتور به‌روزرسانی شد", "success");
  });
  el("btnPrintInv").addEventListener("click", () => {
    const f = el("invFrame");
    if (!f.classList.contains("hidden") && f.contentWindow) {
      f.contentWindow.focus();
      f.contentWindow.print();
    } else window.print();
  });
  el("btnPdfInv").addEventListener("click", async () => {
    if (!API.ok) { toast("خروجی PDF در حالت نمایشی فعال نیست — `python web.py` را اجرا کنید", "warn"); return; }
    if (!state.inv.payload) { await refreshInvoice(); }
    try {
      const body = Object.assign({}, state.inv.payload, { number: state.inv.number });
      const f = await API.blob("POST", "/api/invoice/pdf", body);
      downloadBlob(f.bytes, f.name, "application/pdf");
      toast(`PDF ذخیره شد: ${esc(f.name)}`, "success");
    } catch (e) { toast("خطا: " + esc(e.message), "error"); }
  });
  el("btnXlsInv").addEventListener("click", async () => {
    if (!API.ok) { toast("خروجی اکسل در حالت نمایشی فعال نیست — `python web.py` را اجرا کنید", "warn"); return; }
    if (!state.inv.payload) { await refreshInvoice(); }
    try {
      const body = Object.assign({}, state.inv.payload, { number: state.inv.number });
      const f = await API.blob("POST", "/api/invoice/xlsx", body);
      downloadBlob(f.bytes, f.name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      toast(`اکسل ذخیره شد: ${esc(f.name)}`, "success");
    } catch (e) { toast("خطا: " + esc(e.message), "error"); }
  });
  el("btnSaveInv").addEventListener("click", async () => {
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
  });

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
      confirmAction(`فاکتور <b class="ltr">${esc(a.number)}</b> از بایگانی حذف شود؟`, async () => {
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
  el("btnSaveSettings").addEventListener("click", async () => {
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
  });
  el("btnResetSettings").addEventListener("click", () =>
    confirmAction("پیش‌فرض‌های محاسبه به حالت اولیه برگردانده شود؟", () => {
      el("setProfitPct").value = "۳۰"; el("setOverhead").value = "۰"; el("setWaste").value = "۱۰";
      el("setInstallMode").value = "fixed"; el("setInstallVal").value = "۰";
      el("setVatPct").value = "۱۰";
      toast("پیش‌فرض‌ها بازنشانی شد — «ذخیره‌ی تنظیمات» را بزنید", "success");
    }, "بازنشانی", "بازنشانی"));

  el("btnBackupNow").addEventListener("click", async () => {
    if (!API.ok) { toast("پشتیبان‌گیری در حالت نمایشی فعال نیست", "warn"); return; }
    try {
      const resp = await API.req("POST", "/api/backups", { tag: "web" });
      BACKUPS = resp.backups;
      renderBackups();
      toast("پشتیبان‌گیری انجام شد", "success");
    } catch (e) { toast("خطا: " + esc(e.message), "error"); }
  });
  el("btnExportJson").addEventListener("click", async () => {
    if (!API.ok) { toast("خروجی JSON در حالت نمایشی فعال نیست", "warn"); return; }
    try {
      const f = await API.blob("GET", "/api/backups/export");
      downloadBlob(f.bytes, f.name, "application/json");
      toast("خروجی JSON دانلود شد", "success");
    } catch (e) { toast("خطا: " + esc(e.message), "error"); }
  });
  el("btnImportJson").addEventListener("click", () => el("fileImportJson").click());
  el("fileImportJson").addEventListener("change", async () => {
    const f = el("fileImportJson").files[0];
    el("fileImportJson").value = "";
    if (!f) return;
    if (!API.ok) { toast("ورود JSON در حالت نمایشی فعال نیست", "warn"); return; }
    confirmAction(`محتوای «<b>${esc(f.name)}</b>» جایگزین داده‌های فعلی شود؟`, async () => {
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
      confirmAction(`بازیابی از «<b class="ltr">${esc(name)}</b>»؟<br>داده‌های فعلی جایگزین می‌شوند (ابتدا پشتیبانِ وضعیت فعلی گرفته می‌شود).`, async () => {
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
      confirmAction(`«<b class="ltr">${esc(name)}</b>» حذف شود؟`, async () => {
        try {
          BACKUPS = (await API.req("DELETE", "/api/backups", { name })).backups;
          renderBackups();
          toast("نسخه حذف شد", "success");
        } catch (err) { toast("خطا: " + esc(err.message), "error"); }
      }, "حذف نسخه");
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

  const ok = await tryConnect(true);
  setConnBadge();
  applyTheme(storeGet("kabir-theme", null) || SETTINGS.theme || "light", true);
  applySettingsToUI();
  fillStyleSelects();
  renderAll();
  wire();

  const route = () => {
    const h = (location.hash || "").replace(/^#\/?/, "").split("/");
    const page = PAGES[h[0]] ? h[0] : "dashboard";
    navigate(page, h[1], true);
    if (page === "projects" && h[1]) openProjectEditor(h[1]);
  };
  window.addEventListener("hashchange", route);
  route();
  if (!ok) {
    setTimeout(() => toast("سرور کبیر در دسترس نیست — رابط در <b>حالت نمایشی</b> با داده‌های نمونه اجرا شد. برای اتصال واقعی <b class='ltr'>python web.py</b> را اجرا کنید.", "warn"), 600);
  }
}

document.addEventListener("DOMContentLoaded", init);

/* صادرات برای تست (در مرورگر بی‌اثر است) */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { calcProjectLocal, buildInvoiceDataDemo, num2words, parseNum, fmt, toEn, unitArea };
}
