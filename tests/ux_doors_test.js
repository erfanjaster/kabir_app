/* ═══════════════════════════════════════════════════════════════════════
   تستِ P4 — جدولِ درها: ۱۱ ستون → ۵ ستون + لایه‌ی دومِ تاشو
   -----------------------------------------------------------------------
   هدفِ اصلیِ این تست «نگهبانی از رگرسیون» است: ثابت کند هیچ فیلدی در
   بازآرایی گم نشده (همه‌ی ۶ فیلدِ متریال هنوز در DOM‌اند، فقط پشتِ
   expander) و اینکه میانبرها/فوکوس/کپی/حذف روی ردیفِ در هنوز کار می‌کنند.
   ═══════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs"), path = require("path");
/* jsdom با همان الگوی تست‌های موجودِ مخزن: اگر نصب نباشد، با SKIP خارج می‌شود
   نه با شکست — تا `node tests/...` روی ماشینِ بدونِ jsdom هم بی‌صدا نترکد.
     نصب محلی:  mkdir ../jsdom-test && cd ../jsdom-test && npm install jsdom   */
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); }
catch (e) {
  try { ({ JSDOM, VirtualConsole } = require(path.join(__dirname, "..", "..", "jsdom-test", "node_modules", "jsdom"))); }
  catch (e2) {
    try { ({ JSDOM, VirtualConsole } = require(path.join(__dirname, "..", "node_modules", "jsdom"))); }
    catch (e3) { console.log("SKIP: jsdom not installed"); process.exit(0); }
  }
}
const ROOT = path.join(__dirname, "..", "webui");
const ORDER = ["js/data.js", "js/engine.js", "js/ui-modal.js", "js/ui.js"];
const out = [];
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; out.push(`  ✅ ${n}`); } else { fail++; out.push(`  ❌ ${n}${x ? " — " + x : ""}`); } };

(async () => {
  const errs = [];
  const v = new VirtualConsole();
  v.on("jsdomError", (e) => errs.push(String(e.message || e)));
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"),
    { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/", virtualConsole: v });
  const w = dom.window, d = w.document;
  w.fetch = () => Promise.reject(new Error("x"));
  w.scrollTo = () => {}; w.print = () => {};
  w.Element.prototype.scrollIntoView = function () {};
  w.matchMedia = w.matchMedia || ((q) => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
  w.HTMLCanvasElement.prototype.getContext = () => null;
  const HOOK = `\n;window.__T={get state(){return state}};\n`;
  w.eval(ORDER.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n") + HOOK);
  d.dispatchEvent(new w.Event("DOMContentLoaded", { bubbles: true }));
  const t = (n) => new Promise((r) => setTimeout(r, n || 60));
  for (let i = 0; i < 14; i++) await t();
  const key = (k, o) => d.dispatchEvent(new w.KeyboardEvent("keydown",
    Object.assign({ key: k, bubbles: true, cancelable: true }, o || {})));
  const click = (e) => e.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
  const leaveField = () => { const a = d.activeElement; if (a && a.blur) a.blur(); };

  /* پروژه بساز و یک در خودکار بساز */
  key("n", { ctrlKey: true }); for (let i = 0; i < 10; i++) await t();
  const pg = w.__T.state.editingProject.pages[0];
  leaveField(); await t();
  key("d"); for (let i = 0; i < 8; i++) await t();
  const doors = pg.units.reduce((s, u) => s + (u.doors || []).length, 0);

  out.push("\n════ P4: ساختارِ دو‌لایه‌ی جدولِ درها ════");
  ok("پیش‌نیاز: در ساخته شد تا چیزی برای سنجش باشد", doors > 0, `doors=${doors}`);

  const heads = [...d.querySelectorAll("#tblDoors thead th")].map((h) => h.textContent.trim());
  ok(`لایه‌ی ۱ فقط ${heads.length} ستون دارد (پیش‌تر ۱۱ بود)`, heads.length === 6,
     `${heads.length}: ${heads.join(" | ")}`);
  for (const h of ["یونیت", "برچسب", "لنگه", "عرض", "ارتفاع"]) {
    ok(`  ستونِ «${h}» در لایه‌ی ۱ باقی است`, heads.some((x) => x.includes(h)));
  }
  for (const gone of ["ورق در", "لولا", "دستگیره", "مونتاژ", "بسته‌بندی", "مدل"]) {
    ok(`  ستونِ «${gone}» از لایه‌ی ۱ بیرون رفت`, !heads.some((x) => x.includes(gone)));
  }

  /* ★ مهم‌ترین نگهبانِ رگرسیون: هیچ فیلدی گم نشده باشد */
  out.push("\n════ نگهبانِ رگرسیون: هیچ فیلدی گم نشد ════");
  const DOOR_FIELDS = ["door_model_id", "hinge_id", "handle_id", "assembly_id", "packaging_id"];
  const expBtn = d.querySelector('#tblDoors [data-expand^="d:"]');
  ok("expander در ردیفِ در وجود دارد", !!expBtn);
  ok("expander پیش‌فرض بسته است (aria-expanded=false)",
     expBtn && expBtn.getAttribute("aria-expanded") === "false");
  /* پیش از بازکردن، فیلدهای لایه‌ی ۲ نباید در DOM باشند */
  const beforeOpen = DOOR_FIELDS.filter((k) => d.querySelector(`#tblDoors [data-scope="door"][data-k="${k}"]`));
  ok("پیش از بازکردن، فیلدهای متریال در DOM نیستند (افشای تدریجیِ واقعی)",
     beforeOpen.length === 0, beforeOpen.join(","));

  click(expBtn); for (let i = 0; i < 4; i++) await t();
  const afterOpen = DOOR_FIELDS.filter((k) => d.querySelector(`#tblDoors [data-scope="door"][data-k="${k}"]`));
  ok("پس از بازکردن، همه‌ی ۵ فیلدِ متریال/یراق در DOM‌اند",
     afterOpen.length === DOOR_FIELDS.length, `${afterOpen.length}/${DOOR_FIELDS.length}: ${afterOpen.join(",")}`);
  ok("«ورق در» هم در لایه‌ی ۲ هست (doorSheetCell گم نشد)",
     !!d.querySelector('#tblDoors [data-detail-of^="door:"] select, #tblDoors [data-detail-of^="door:"] .cell-wrap'));
  ok("expander باز شد (aria-expanded=true)",
     d.querySelector('#tblDoors [data-expand^="d:"]').getAttribute("aria-expanded") === "true");
  ok("کلیدِ expanderِ در با پیشوندِ d: نام‌گذاری شده (برخورد با کلیدِ یونیت ندارد)",
     !!d.querySelector('#tblDoors [data-expand^="d:"]') &&
     [...d.querySelectorAll("#tblUnits [data-expand]")].every((b) => /^\d+$/.test(b.dataset.expand)));

  /* باز/بسته شدنِ مستقل از یونیت‌ها */
  const unitExp = d.querySelector('#tblUnits [data-expand]');
  click(unitExp); for (let i = 0; i < 3; i++) await t();
  ok("بازکردنِ expanderِ یونیت، expanderِ در را نمی‌بندد (دو لایه‌ی مستقل)",
     d.querySelector('#tblDoors [data-expand^="d:"]').getAttribute("aria-expanded") === "true" &&
     d.querySelector('#tblUnits [data-expand]').getAttribute("aria-expanded") === "true");
  click(d.querySelector('#tblDoors [data-expand^="d:"]')); for (let i = 0; i < 3; i++) await t();
  ok("بستنِ expanderِ در، فیلدهایش را از DOM می‌برد",
     DOOR_FIELDS.every((k) => !d.querySelector(`#tblDoors [data-scope="door"][data-k="${k}"]`)));

  /* ── کنش‌های ردیفِ در هنوز کار می‌کنند؟ ── */
  out.push("\n════ کنش‌های ردیفِ در پس از بازآرایی ════");
  click(d.querySelector('#tblDoors [data-expand^="d:"]')); await t(60);
  const wCell = d.querySelector('#tblDoors [data-scope="door"][data-k="w_cm"]');
  ok("سلولِ «عرض» هنوز قابل ویرایش است", !!wCell);
  if (wCell) {
    wCell.value = "45";
    wCell.dispatchEvent(new w.Event("input", { bubbles: true }));
    wCell.dispatchEvent(new w.Event("change", { bubbles: true }));
    for (let i = 0; i < 4; i++) await t();
    ok("ویرایشِ عرض در مدل نشست", pg.units[0].doors[0].w_cm === 45,
       String(pg.units[0].doors[0].w_cm));
  }
  const dup = d.querySelector('#tblDoors [data-copy-row="door"]');
  ok("دکمه‌ی «کپی ردیف» در هنوز هست", !!dup);
  const nBefore = pg.units[0].doors.length;
  if (dup) { click(dup); for (let i = 0; i < 5; i++) await t(); }
  ok("کپی ردیفِ در کار می‌کند", pg.units[0].doors.length === nBefore + 1,
     `${nBefore} → ${pg.units[0].doors.length}`);
  const del = d.querySelector('#tblDoors [data-del-row="door"]');
  ok("دکمه‌ی «حذف ردیف» در هنوز هست", !!del);
  if (del) { click(del); for (let i = 0; i < 5; i++) await t(); }
  ok("حذف ردیفِ در کار می‌کند", pg.units[0].doors.length === nBefore,
     `${pg.units[0].doors.length}`);

  /* ── Tab در لایه‌ی ۱ نباید در اسکرولِ افقی گم شود ── */
  out.push("\n════ نتیجه‌ی قانون فیتز/بارِ شناختی ════");
  ok("عرضِ ستون‌های لایه‌ی ۱: ۶ به‌جای ۱۱ → اسکرولِ افقی لازم نیست", heads.length <= 6);
  ok("بدون خطای jsdom در کل تست", errs.length === 0, errs.slice(0, 2).join(" | "));

  console.log(out.join("\n"));
  console.log("\n" + "═".repeat(66));
  console.log(`  نتیجه: ${pass} پاس  ·  ${fail} شکست`);
  console.log("═".repeat(66));
  process.exit(fail ? 1 : 0);
})();
