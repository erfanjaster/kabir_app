/* نگهبانِ باگ‌های تعمیرشده‌ی «ویرایش پروژه» (وب‌یوآی)
   ----------------------------------------------------------------------------
   هر بلوک یکی از ایرادهایی است که در گزارشِ `docs/EDITOR_UI_FIX_v2.md` آمده
   و پیش‌تر هیچ آزمودنی‌ای آن را نمی‌گرفت. این فایل **رفتارِ کاربر** را با
   jsdom اجرا می‌کند (کلیک/تایپ/کلید واقعی)، نه متنِ کد را.

   اجرا:  node tests/ui_editor_bugs_check.js   (نیاز به jsdom — در صورت نبودن رد می‌شود)
*/
"use strict";
const fs = require("fs");
const path = require("path");

let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) {
  try { JSDOM = require(path.join(__dirname, "..", "..", "jsdom-test", "node_modules", "jsdom")).JSDOM; }
  catch (e2) { console.log("SKIP: jsdom not installed"); process.exit(0); }
}

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "webui/index.html"), "utf8");

let fail = 0, pass = 0;
function check(name, cond, extra) {
  console.log(`${cond ? "✅" : "❌"} ${name}${cond ? "" : "  →  " + (extra === undefined ? "" : extra)}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const RUNTIME = [];

const dom = new JSDOM(html, { url: "http://localhost:8080/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
const { document } = window;

window.Element.prototype.scrollIntoView = function () {};
window.scrollTo = () => {};
if (!window.matchMedia) window.matchMedia = () => ({ matches: false });
window.fetch = () => Promise.reject(new Error("offline"));       /* → حالت نمایشی */
window.addEventListener("error", (e) => RUNTIME.push((e.error && e.error.stack) || e.message));
window.console.error = (...a) => RUNTIME.push("console.error: " + a.map(String).join(" "));

const jsCode = ["data.js", "engine.js", "ui-modal.js", "ui-windows.js", "ui.js"]
  .map((f) => fs.readFileSync(path.join(ROOT, "webui/js", f), "utf8"))
  .join("\n") + `
;window.__k = {
  init, navigate, openProjectEditor, curPage, recalcTotals, saveProject, renderEditorTables,
  doUndo, doRedo, clearDirty, readEditorFieldsInto, demoSave,
  get API() { return API; },
  get PROJECTS() { return PROJECTS; },
  get state() { return state; },
  get MODALS() { return MODALS; },
  anyModalOpen, topModalId, requestCloseModal, closeModal,
  get expanded() { return state.expanded; },
  get lastUnitIdx() { return state.lastUnitIdx; },
};`;
window.eval(jsCode);
const K = window.__k;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const click = (elm) => { if (!elm) throw new Error("click روی عنصرِ نیافته"); elm.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })); };
const type = (elm, value) => { elm.value = value; elm.dispatchEvent(new window.Event("input", { bubbles: true })); elm.dispatchEvent(new window.Event("change", { bubbles: true })); };
const key = (elm, k, opt) => elm.dispatchEvent(new window.KeyboardEvent("keydown", Object.assign({ key: k, bubbles: true, cancelable: true }, opt || {})));
const toEn = (s) => String(s).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
/* هر بار که جدول بازسازی می‌شود گره‌ها دور ریخته می‌شوند؛ پس همیشه DOM را
   دوباره بپرسید و به گره‌ی قدیمی تکیه نکنید (خودِ این یکی از دام‌های تست است). */
const q = (s) => document.querySelector(s);

const blurAll = () => { const a = document.activeElement; if (a && a.blur) a.blur(); };

async function openEditor(id) {
  blurAll();                      /* فوکوسِ مانده از بخشِ قبلیِ آزمون مزاحمِ F2/Del می‌شود */
  /* مودالِ بازِ مانده از بخشِ قبلی هم همین‌طور: تا مودالی باز است کلیدها
     متعلقِ همان‌اند (و این درست است)، پس هر بخش را از میزِ تمیز شروع می‌کنیم. */
  for (let i = 0; i < 4 && K.anyModalOpen(); i++) {
    const cancel = $$(".modal.open button").find((b) => /انصراف|ماندن|بستن/.test(b.textContent));
    if (cancel) click(cancel); else K.closeModal();
    await sleep(60);
  }
  K.navigate("projects");
  K.openProjectEditor(id);
  await sleep(120);
  await K.recalcTotals();
  K.clearDirty();
}
const openDetailRows = () => $$("#tblUnits tr.unit-detail-row").map((r) => r.dataset.detailOf).sort();

(async () => {
  await K.init();
  await sleep(150);
  check("حالت نمایشی فعال است", K.API.ok === false);

  /* ══════════════════════════════════════════════════════════════════════
     ۱) «افزودن در/کشو» پسِ حذفِ یونیت یا جابه‌جاییِ بخش — کرشِ بی‌صدا
     --------------------------------------------------------------------------
     `state.lastUnitIdx` کهنه می‌ماند و `pg.units[i].doors` روی `undefined`
     `TypeError` می‌داد. در مرورگر یعنی: دکمه را می‌زنید و **هیچ اتفاقی
     نمی‌افتد** (خطا فقط در کنسول).                                          */
  await openEditor(1);
  const lastIdx = K.curPage().units.length - 1;
  const cell = q(`#tblUnits [data-k="length_cm"][data-ui="${lastIdx}"]`);
  cell.focus(); type(cell, "88");                       /* یونیتِ جاری = آخرین */
  await sleep(40);
  check("یونیتِ جاری روی آخرین ردیف نشسته است", K.lastUnitIdx === lastIdx, String(K.lastUnitIdx));
  click(q(`#tblUnits [data-del-row="unit"][data-ui="${lastIdx}"]`));
  await sleep(80);
  let errAt = RUNTIME.length;
  click(q('#tab-doors [data-add="doors"]'));
  await sleep(80);
  check("افزودن در پسِ حذفِ یونیتِ جاری کرش نمی‌کند", RUNTIME.length === errAt, RUNTIME.slice(errAt).join(" | "));
  check("در به یک یونیتِ واقعی اضافه شد",
    K.curPage().units.some((u) => u.doors.length > 0), JSON.stringify(K.curPage().units.map((u) => u.doors.length)));
  errAt = RUNTIME.length;
  click(q('#tab-drawers [data-add="drawers"]'));
  await sleep(80);
  check("افزودن کشو پسِ حذفِ یونیتِ جاری کرش نمی‌کند", RUNTIME.length === errAt, RUNTIME.slice(errAt).join(" | "));

  /* بخشِ تازه (بدون یونیت) → باید راهنما بدهد، نه کرش */
  click(q("#btnAddSection2"));
  await sleep(90);
  errAt = RUNTIME.length;
  click(q('#tab-doors [data-add="doors"]'));
  await sleep(80);
  check("افزودن در در بخشِ بدون یونیت کرش نمی‌کند", RUNTIME.length === errAt, RUNTIME.slice(errAt).join(" | "));
  check("پیامِ راهنما داده می‌شود", /یک یونیت بسازید/.test($("#toasts").textContent), $("#toasts").textContent.slice(-60));

  /* بخشِ کوچک‌تر از بخشِ قبلی */
  await openEditor(2);
  const bigSec = K.state.editingProject.pages[0];
  for (let i = 0; i < 2; i++) { click(q('#tab-units [data-add="unit:ground"]')); await sleep(50); }
  const c1 = q('#tblUnits [data-k="length_cm"][data-ui="1"]');
  c1.focus(); type(c1, "90"); await sleep(40);
  click(q("#btnAddSection2")); await sleep(80);
  click(q('#tab-units [data-add="unit:ground"]')); await sleep(60);
  click(q('#secPills [data-sec="0"]')); await sleep(90);   /* بازگشت به بخشِ کوچک‌تر */
  errAt = RUNTIME.length;
  click(q('#tab-doors [data-add="doors"]'));
  await sleep(80);
  check("پسِ جابه‌جایی به بخشِ کوچک‌تر هم افزودن در کرش نمی‌کند", RUNTIME.length === errAt, RUNTIME.slice(errAt).join(" | "));

  /* ══════════════════════════════════════════════════════════════════════
     ۲) پنلِ «جزئیاتِ» باز به ردیفِ همسایه می‌چسبید
     --------------------------------------------------------------------------
     کلیدِ بازبودن، شاخصِ ردیف است؛ با حذفِ ردیفِ بالایی، متریالِ یونیتِ
     **دیگری** جلوی چشم کاربر می‌آمد.                                         */
  await openEditor(1);
  click(q("#tblUnits [data-expand='1']")); await sleep(60);
  click(q("#tblUnits [data-expand='2']")); await sleep(60);
  check("دو پنلِ جزئیات باز شد", openDetailRows().join() === "unit:1,unit:2", openDetailRows().join());
  const bodyBefore = q("#tblUnits tr[data-detail-of='unit:2'] select[data-k='body_id']").value;
  click(q("#tblUnits [data-del-row='unit'][data-ui='0']"));
  await sleep(90);
  check("پسِ حذفِ ردیفِ بالایی، پنل‌ها با یونیت‌های خودشان جابه‌جا شدند",
    openDetailRows().join() === "unit:0,unit:1", openDetailRows().join());
  check("همان متریال دیده می‌شود (نه متریالِ همسایه)",
    q("#tblUnits tr[data-detail-of='unit:1'] select[data-k='body_id']").value === bodyBefore,
    q("#tblUnits tr[data-detail-of='unit:1'] select[data-k='body_id']").value + " ≠ " + bodyBefore);
  const restore = $$("#toasts button").find((b) => /بازگردانی/.test(b.textContent));
  check("توستِ «بازگردانی» هست", !!restore);
  click(restore); await sleep(120);
  check("بازگردانیِ ردیف، پنل‌ها را دقیقاً به وضعیتِ پیشِ حذف برمی‌گرداند",
    openDetailRows().join() === "unit:1,unit:2", openDetailRows().join());

  /* ══════════════════════════════════════════════════════════════════════
     ۳) Ctrl+Z فقط جدول‌ها را برمی‌گرداند؛ سربرگ و اعدادِ مالی را نه
     --------------------------------------------------------------------------
     بدتر از «واگردِ بی‌اثر»: ورودیِ مالی سرِ مقدارِ تازه می‌ماند و
     `readTotalbarInto` در محاسبه‌ی بعدی همان مقدارِ کهنه را در مدل
     بازنویسی می‌کرد (واگراییِ مدل و DOM).                                    */
  await openEditor(1);
  const profit0 = K.state.editingProject.profit_percent;
  const title0 = K.state.editingProject.title;
  type(q("#tbProfitPct"), "77"); await sleep(40);
  type(q("#edTitle"), "عنوانِ تازه"); await sleep(40);
  check("نوارِ فرمانِ چسبان عنوانِ در حالِ تایپ را نشان می‌دهد",
    q("#ebTitle").textContent.trim() === "عنوانِ تازه", q("#ebTitle").textContent.trim());
  /* نکته‌ی اصلی این دو گام: **مدل و ورودی با هم** برمی‌گردند. پیش‌تر واگرد
     فقط `pages` را برمی‌گرداند؛ یعنی ورودی‌های مالی سرِ مقدارِ تازه
     می‌ماندند و `readTotalbarInto` در محاسبه‌ی بعدی همان مقدارِ کهنه را
     دوباره در مدل می‌نوشت — واگرد عملاً بی‌اثر می‌شد.                      */
  K.doUndo(); await sleep(140);                     /* گامِ ۱ = عنوان */
  check("واگردِ عنوان در مدل و ورودی و نوارِ فرمان",
    K.state.editingProject.title === title0 && q("#edTitle").value === title0 && q("#ebTitle").textContent.trim() === title0,
    `model=${K.state.editingProject.title} input=${q("#edTitle").value} bar=${q("#ebTitle").textContent.trim()}`);
  K.doUndo(); await sleep(140);                     /* گامِ ۲ = درصدِ سود */
  check("واگردِ درصدِ سود در مدل **و** ورودیِ نوارِ جمع",
    K.state.editingProject.profit_percent === profit0 && toEn(q("#tbProfitPct").value) === String(profit0),
    `model=${K.state.editingProject.profit_percent} dom=${q("#tbProfitPct").value}`);
  K.doRedo(); await sleep(140);
  check("بازانجام، درصدِ سود را در مدل و ورودی برمی‌گرداند",
    K.state.editingProject.profit_percent === 77 && toEn(q("#tbProfitPct").value) === "77",
    `model=${K.state.editingProject.profit_percent} dom=${q("#tbProfitPct").value}`);

  /* ══════════════════════════════════════════════════════════════════════
     ۴) کلیدهای F2 / Del وقتی فوکوس داخلِ خانه‌ی جدول است
     --------------------------------------------------------------------------
     گاردِ «تایپ» پیش از بلوکِ کنشِ ردیف می‌نشست، پس F2 دقیقاً در همان
     حالتی کار نمی‌کرد که کاربر هست (وسطِ جدول).                              */
  await openEditor(1);
  const n0 = K.curPage().units.length;
  q('#tblUnits [data-k="label"]').focus();
  check("فوکوس روی خانه‌ی جدول است", document.activeElement === q('#tblUnits [data-k="label"]'), document.activeElement.id || document.activeElement.tagName);
  key(document.activeElement, "F2"); await sleep(90);
  check("F2 داخلِ خانه‌ی جدول ردیف را کپی می‌کند", K.curPage().units.length === n0 + 1,
    `${n0} → ${K.curPage().units.length}`);
  q('#tblUnits [data-k="label"]').focus();
  key(document.activeElement, "Delete"); await sleep(70);
  check("Deleteِ تنها داخلِ خانه ردیف را حذف نمی‌کند (نویسه‌پاک‌کن است)",
    K.curPage().units.length === n0 + 1, String(K.curPage().units.length));
  key(document.activeElement, "Delete", { ctrlKey: true }); await sleep(90);
  check("Ctrl+Delete داخلِ خانه ردیف را حذف می‌کند", K.curPage().units.length === n0,
    `${n0 + 1} → ${K.curPage().units.length}`);
  K.doUndo(); await sleep(120);
  q('#tblUnits tr.erow button.row-actions').focus();
  const n1 = K.curPage().units.length;
  key(document.activeElement, "Delete"); await sleep(90);
  check("Delete بیرونِ خانه (روی دکمه‌ی ردیف) ردیف را حذف می‌کند", K.curPage().units.length === n1 - 1,
    `${n1} → ${K.curPage().units.length}`);

  /* ══════════════════════════════════════════════════════════════════════
     ۵) Alt+۱..۶ با رقمِ فارسی و «؟» فارسی
     --------------------------------------------------------------------------
     کیبوردِ کاربرِ فارسی‌زبان رقمِ `۱` (U+06F1) و `؟` (U+061F) می‌سازد؛
     تستِ `/^[1-6]$/` و `e.key === "?"` هیچ‌کدام را نمی‌گرفت، یعنی میانبرها
     روی همان چیدمانی که محصول برایش ساخته شده کار نمی‌کردند.               */
  K.clearDirty();
  K.navigate("dashboard"); await sleep(70);
  const order = ["dashboard", "projects", "materials", "styles", "invoice", "settings"];
  const faDigits = ["۱", "۲", "۳", "۴", "۵", "۶"];
  for (let i = 0; i < 6; i++) {
    key(document.body, faDigits[i], { altKey: true }); await sleep(60);
    check(`Alt+${faDigits[i]} → صفحه‌ی «${order[i]}»`, K.state.page === order[i], K.state.page);
  }
  for (let i = 0; i < 6; i++) {
    key(document.body, String(i + 1), { altKey: true }); await sleep(60);
    check(`Alt+${i + 1} → صفحه‌ی «${order[i]}»`, K.state.page === order[i], K.state.page);
  }
  /* چیدمانِ مک: `Alt+4` نویسه‌ی «€» می‌سازد و فقط `e.code` رقم را می‌گوید */
  key(document.body, "€", { altKey: true, code: "Digit5" }); await sleep(60);
  check("Alt+Digit5 با e.code (چیدمانِ مک) کار می‌کند", K.state.page === "invoice", K.state.page);
  /* ★ دامِ خودِ آزمون: رویداد را روی document.body می‌فرستیم، ولی
     `document.activeElement` هنوز یک INPUTِ خانه‌ی جدول است — پس گاردِ «تایپ»
     به‌درستی «؟» را نمی‌گیرد (در مرورگر هم همین است: وسطِ تایپ، راهنما باز
     نمی‌شود). پیش‌تر این دو بررسی *الکی* پاس می‌شدند، چون #modal-keys بیرونِ
     #modalBackdrop نشسته بود و syncInert هرگز به آن inert نمی‌داد (کلیدِ مرده!).
     حالا هم رفتارِ گارد را می‌سنجیم، هم با blurAll مسیرِ واقعیِ کلید را. */
  key(document.body, "؟"); await sleep(70);
  check("«؟» هنگامِ تایپ در خانه، راهنما را باز نمی‌کند (گاردِ تایپ)",
    !q("#modal-keys").classList.contains("open"));
  blurAll();
  key(document.body, "؟"); await sleep(70);
  check("«؟» فارسی راهنمای کلیدها را باز می‌کند",
    q("#modal-keys").hasAttribute("inert") === false && q("#modal-keys").classList.contains("open"),
    q("#modal-keys").className);
  key(document, "Escape"); await sleep(90);
  check("Escape راهنمای کلیدها را می‌بندد", !q("#modal-keys").classList.contains("open"));
  key(document.body, "?", { shiftKey: true }); await sleep(70);
  check("«?» لاتین راهنمای کلیدها را باز می‌کند",
    q("#modal-keys").hasAttribute("inert") === false && q("#modal-keys").classList.contains("open"),
    q("#modal-keys").className);
  check("راهنمای کلیدها Ctrl+Del را هم گفته است", /Del/.test(q("#modal-keys").textContent));

  /* ══════════════════════════════════════════════════════════════════════
     ۶) حذف/کپی پروژه در حالت نمایشی واقعاً ذخیره شود
     --------------------------------------------------------------------------
     `demoSave()` **پیش از** `splice` صدا زده می‌شد؛ یعنی پایگاهِ نمایشی
     همان فهرستِ شاملِ پروژه‌ی حذف‌شده را نگه می‌داشت و پروژه با یک بار
     تازه‌کردنِ صفحه برمی‌گشت.                                                */
  K.clearDirty();
  K.navigate("projects"); await sleep(70);
  const idsBefore = K.PROJECTS.map((p) => p.id);
  const victim = idsBefore[idsBefore.length - 1];
  click(q(`#projectsTable [data-del-project="${victim}"]`)); await sleep(70);
  click($$("#modal-confirm button").find((b) => /تأیید/.test(b.textContent))); await sleep(140);
  const stored = JSON.parse(window.localStorage.getItem("kabir-demo-db") || "null");
  check("پروژه از فهرست حذف شد", !K.PROJECTS.some((p) => p.id === victim));
  check("حذف در پایگاهِ نمایشی هم نشست (با رفرش برنمی‌گردد)",
    stored && !stored.projects.some((p) => p.id === victim),
    JSON.stringify(stored && stored.projects.map((p) => p.id)));

  /* ══════════════════════════════════════════════════════════════════════
     ۷) پروژه‌ی تازه در حالت نمایشی: یونیتِ پیش‌فرض و کپیِ پروژه
     --------------------------------------------------------------------------
     هر دو مسیر `demoSave()` را **پیش از** کامل‌شدنِ پروژه صدا می‌زدند.     */
  K.clearDirty();
  const cntBefore = K.PROJECTS.length;
  key(document.body, "n", { ctrlKey: true }); await sleep(200);      /* Ctrl+N = پروژه‌ی فوری */
  const fresh = K.PROJECTS[0];
  check("پروژه‌ی فوری ساخته شد", K.PROJECTS.length === cntBefore + 1, `${cntBefore} → ${K.PROJECTS.length}`);
  check("پروژه‌ی فوری یک یونیتِ پیش‌فرض دارد", fresh.pages[0].units.length === 1,
    String(fresh.pages[0].units.length));
  const stored2 = JSON.parse(window.localStorage.getItem("kabir-demo-db") || "null");
  const persisted = stored2 && stored2.projects.find((p) => p.id === fresh.id);
  check("همان یونیتِ پیش‌فرض در پایگاهِ نمایشی هم هست",
    persisted && persisted.pages && persisted.pages[0] && persisted.pages[0].units.length === 1,
    JSON.stringify(persisted && persisted.pages && persisted.pages[0] && (persisted.pages[0].units || []).length));

  K.clearDirty();
  const cnt2 = K.PROJECTS.length;
  click(q("#btnDupProject")); await sleep(220);
  const dup = K.PROJECTS[0];
  check("کپیِ پروژه ساخته شد", K.PROJECTS.length === cnt2 + 1, `${cnt2} → ${K.PROJECTS.length}`);
  const stored3 = JSON.parse(window.localStorage.getItem("kabir-demo-db") || "null");
  check("کپیِ پروژه در پایگاهِ نمایشی نشست",
    stored3 && stored3.projects.some((p) => p.id === dup.id), JSON.stringify(stored3 && stored3.projects.map((p) => p.id)));

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("");
  console.log(`${pass} بررسی پاس شد${fail ? ` · ${fail} شکست` : ""} ${fail ? "❌" : "✅"}`);
  if (RUNTIME.length) {
    console.log("خطاهای زمانِ اجرا:");
    console.log(RUNTIME.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("بدونِ هیچ خطای زمانِ اجرا ✅");
  }
  process.exit(0);
})().catch((e) => { console.error("خطای آزمون:", e); process.exit(1); });
