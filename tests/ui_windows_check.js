/* آزمونِ «مدیرِ پنجره‌های ویرایشگر» (webui/js/ui-windows.js)
   ----------------------------------------------------------------------------
   خواسته‌ی کاربر: هر پنلِ ویرایشگر با موس جابه‌جا و اندازه‌گیری شود، چیدمان
   بینِ نشست‌ها بماند، و یک حالتِ پیش‌فرضِ قابلِ بازگشت داشته باشد.

   دو لایه آزمون می‌شود:
     الف) هندسه‌یِ خالص (require مستقیم در node — بدونِ DOM)
     ب) رفتارِ واقعی در jsdom: ساختِ پنجره‌ها، کشیدن، تغییرِ اندازه،
        کوچک/بزرگ/بستن، ماندگاری در localStorage، بازنشانی، و بی‌اثر بودنِ
        «حالتِ مرتب» روی چیدمانِ پیشین.

   اجرا:  node tests/ui_windows_check.js
*/
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

let fail = 0, pass = 0;
function check(name, cond, extra) {
  console.log(`${cond ? "✅" : "❌"} ${name}${cond ? "" : "  →  " + (extra === undefined ? "" : extra)}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
function section(t) { console.log(`\n══ ${t} ${"═".repeat(Math.max(2, 58 - t.length))}`); }

/* ═════════════════════════ الف) هندسه‌یِ خالص ═════════════════════════ */
const W = require(path.join(ROOT, "webui/js/ui-windows.js"));

section("۱) هندسه — resizeGeom");
{
  const base = { x: 100, y: 50, w: 400, h: 300 };   /* x منطقی = فاصله از لبه‌ی راستِ بوم */
  const opt = { minW: 200, minH: 100, rtl: true };
  /* ★ قراردادِ RTL: «لبه‌ی فیزیکیِ راست» در چیدمانِ راست‌به‌چپ همان «لبه‌ی
     شروعِ منطقی» است (چون x منطقی از راست شمرده می‌شود). پس کشیدنِ آن به راست
     پنجره را بزرگ می‌کند و x منطقی را کوچک — و برعکس برایِ لبه‌ی چپ.
     این دقیقاً همان حسی است که کاربرِ فارسی‌زبان از یک پنجره‌ی RTL دارد. */
  const east = W.resizeGeom(base, "e", 60, 0, opt);
  check("RTL: کشیدنِ لبه‌ی راست به راست ⇒ پهن‌تر، x منطقی کوچک‌تر (لبه‌ی چپِ منطقی ثابت)",
    east.w === 460 && east.x === 40, JSON.stringify(east));
  const eastIn = W.resizeGeom(base, "e", -60, 0, opt);
  check("RTL: کشیدنِ لبه‌ی راست به چپ ⇒ باریک‌تر، x منطقی بزرگ‌تر",
    eastIn.w === 340 && eastIn.x === 160, JSON.stringify(eastIn));
  const west = W.resizeGeom(base, "w", 60, 0, opt);
  check("RTL: کشیدنِ لبه‌ی چپ به راست ⇒ باریک‌تر، x منطقی ثابت (لبه‌ی پایان ثابت)",
    west.w === 340 && west.x === 100, JSON.stringify(west));
  const westOut = W.resizeGeom(base, "w", -60, 0, opt);
  check("RTL: کشیدنِ لبه‌ی چپ به چپ ⇒ پهن‌تر، x منطقی ثابت",
    westOut.w === 460 && westOut.x === 100, JSON.stringify(westOut));
  const south = W.resizeGeom(base, "s", 0, 40, opt);
  check("کشیدنِ لبه‌ی جنوب ⇒ فقط ارتفاع عوض می‌شود",
    south.h === 340 && south.w === 400 && south.y === 50, JSON.stringify(south));
  const north = W.resizeGeom(base, "n", 0, -40, opt);
  check("کشیدنِ لبه‌ی شمال به بالا ⇒ ارتفاع بزرگ، y کوچک", north.h === 340 && north.y === 10, JSON.stringify(north));
  const se = W.resizeGeom(base, "se", 30, 20, opt);
  check("گوشه‌ی جنوب‌شرقی در RTL: موس به راست و پایین ⇒ پهن‌تر و بلندتر",
    se.w === 430 && se.h === 320 && se.x === 70, JSON.stringify(se));
  const tiny = W.resizeGeom(base, "e", -900, 0, opt);
  check("هرگز زیرِ حداقلِ عرض نمی‌رود", tiny.w === opt.minW && tiny.h === base.h, JSON.stringify(tiny));
  const tiny2 = W.resizeGeom(base, "s", 0, -900, opt);
  check("هرگز زیرِ حداقلِ ارتفاع نمی‌رود", tiny2.h === opt.minH && tiny2.w === base.w, JSON.stringify(tiny2));
  const autoH = W.resizeGeom({ x: 100, y: 50, w: 400, h: null }, "s", 0, 80, opt);
  check("ارتفاعِ خودکار (h=null) در تغییرِ اندازه از حداقل مبنا می‌گیرد و عدد می‌شود",
    autoH.h === opt.minH + 80, JSON.stringify(autoH));
  const ltrE = W.resizeGeom(base, "e", 60, 0, { minW: 200, minH: 100, rtl: false });
  check("LTR: کشیدنِ لبه‌ی راست به راست ⇒ عرض بزرگ می‌شود (وارونِ RTL)",
    ltrE.w === 460 && ltrE.x === 100, JSON.stringify(ltrE));
  const ltrW = W.resizeGeom(base, "w", -60, 0, { minW: 200, minH: 100, rtl: false });
  check("LTR: کشیدنِ لبه‌ی چپ به چپ ⇒ عرض بزرگ و x کوچک می‌شود",
    ltrW.w === 460 && ltrW.x === 40, JSON.stringify(ltrW));
  const capped = W.resizeGeom(base, "s", 0, 5000, Object.assign({ maxH: 500 }, opt));
  const autoN = W.resizeGeom({ x: 100, y: 50, w: 400, h: null }, "n", 0, -80, opt);
  check("کشیدنِ لبه‌ی شمال با ارتفاعِ خودکار، y را منفیِ بی‌معنا نمی‌کند",
    autoN.h === opt.minH + 80 && autoN.y === 50 - 80, JSON.stringify(autoN));
  check("سقفِ maxH رعایت می‌شود", capped.h === 500, JSON.stringify(capped));
}

section("۲) هندسه — logicalRect / physOf");
{
  const phys = { x: 300, y: 40, w: 500, h: 200 };
  const log = W.logicalRect(phys, 1400, "rtl");
  check("RTL: x منطقی = پهنا − x فیزیکی − عرض", log.x === 600 && log.y === 40, JSON.stringify(log));
  const back = W.physOf(log, 1400, "rtl");
  check("رفت‌وبرگشتِ RTL بدونِ خطا (round-trip)", back.x === phys.x && back.w === phys.w, JSON.stringify(back));
  const l2 = W.logicalRect({ x: 300, y: 40, w: 500, h: 200 }, 1400, "ltr");
  check("LTR: x منطقی همان x فیزیکی است", l2.x === 300, JSON.stringify(l2));
}

section("۳) هندسه — clampWin");
{
  const far = W.clampWin({ x: -5000, y: -5000, w: 400, h: 300 }, 1400, 900, {});
  check("پنجره‌ی فرارکرده مهار می‌شود: ≥۴۴px از لبه‌یِ شروع و ≥۴۴px از لبه‌یِ پایان دیده می‌شود",
    far.x + far.w >= 44 && far.x <= 1400 - 12 - 44 && far.y >= 12, JSON.stringify(far));
  const wide = W.clampWin({ x: -5000, y: 100, w: 4000, h: 300 }, 1400, 900, {});
  check("پنجره‌ی پهن‌تر از بوم هم از لبه بیرون نمی‌افتد (≥۴۴px دیده می‌شود)",
    wide.x >= 12 - 4000 + 44, JSON.stringify(wide));
  const keep = W.clampWin({ x: 5000, y: 40, w: 400, h: 300 }, 1400, 900, {});
  check("حداقلِ لبه‌ی دیده‌شونده حفظ می‌شود (x ≤ پهنا−۴۴)", keep.x <= 1400 - 44, JSON.stringify(keep));
  const tall = W.clampWin({ x: 100, y: -800, w: 400, h: 2000 }, 1400, 900, {});
  check("پنجره‌ی بلندتر از بوم: نوارِ عنوانش دیده می‌ماند", tall.y <= 900 - 34 - 12 && tall.y >= -2000 + 44, JSON.stringify(tall));
  const autoH = W.clampWin({ x: 100, y: 100000, w: 400, h: null }, 1400, 900, {});
  check("ارتفاعِ خودکار (h=null) حفظ می‌شود و y مهار می‌گردد", autoH.h === null && autoH.y < 900, JSON.stringify(autoH));
}

section("۴) هندسه — defaultLayout (حالتِ پیش‌فرض)");
{
  const wide = W.defaultLayout(1400, 900, {});
  check("هر چهار پنجره در چیدمانِ پیش‌فرض حاضرند",
    ["edbar", "info", "sec", "total"].every((k) => wide[k] && wide[k].w > 0), JSON.stringify(Object.keys(wide)));
  check("در صفحه‌ی پهن، «مشخصات» و «بخش‌ها» کنارِ هم‌اند (y یکسان)", wide.info.y === wide.sec.y, JSON.stringify(wide));
  check("هیچ پنجره‌ای از بوم بیرون نمی‌زند",
    Object.values(wide).every((g) => g.x >= 0 && g.x + g.w <= 1400), JSON.stringify(wide));
  check("نوارِ «جمع و مالی» پایین‌ترین پنجره است",
    wide.total.y + wide.total.h >= wide.sec.y + wide.sec.h, JSON.stringify(wide));
  const narrow = W.defaultLayout(700, 900, {});
  check("در صفحه‌ی باریک، پنجره‌ها زیرِ هم می‌روند (y متفاوت)", narrow.info.y !== narrow.sec.y, JSON.stringify(narrow));
  check("در صفحه‌ی باریک، هر دو تمام‌عرض‌اند", narrow.info.w === narrow.sec.w, JSON.stringify(narrow));
}

section("۵) ماندگاری — sanitize (ورودیِ خراب نباید برنامه را بخواباند)");
{
  const bad = W.sanitize({ mode: "weird", wins: { info: { x: "abc", w: -50, h: 1e9 }, nope: {} } });
  check("mode ناشناخته → «free»", bad.mode === "free", bad.mode);
  check("x رشته‌ای → null (بعداً از پیش‌فرض seed می‌شود)", bad.wins.info.x === null, String(bad.wins.info.x));
  check("y رشته‌ای هم → null", W.sanitize({ wins: { sec: { y: "50px", x: 30 } } }).wins.sec.y === null);
  check("عرضِ منفی به حداقلِ پنل می‌رسد", bad.wins.info.w >= 330 - 330 && bad.wins.info.w !== -50, String(bad.wins.info.w));
  check("ارتفاعِ نجومی مهار می‌شود", bad.wins.info.h <= 8000, String(bad.wins.info.h));
  check("کلیدِ ناشناخته نادیده گرفته می‌شود", bad.wins.nope === undefined || bad.wins.nope.x === null);
  check("sanitize(null) حالتِ پیش‌فرضِ سالم می‌دهد", W.sanitize(null).mode === "free" && !!W.sanitize(null).wins.sec);
}

/* ═════════════════════════ ب) رفتار در jsdom ═════════════════════════ */
let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) {
  try { JSDOM = require(path.join(__dirname, "..", "..", "jsdom-test", "node_modules", "jsdom")).JSDOM; }
  catch (e2) {
    console.log("\n⚠ jsdom نصب نیست — بخشِ رفتاری رد شد (SKIP)");
    console.log(`\n${pass} پاس · ${fail} شکست`);
    process.exit(fail ? 1 : 0);
  }
}

const RUNTIME = [];
const STORE = new Map();                                   /* localStorage جعلی */
const html = fs.readFileSync(path.join(ROOT, "webui/index.html"), "utf8");
const VW = 1600, VH = 1000;          /* اندازه‌ی نمایشگرِ فرضیِ آزمون */
const setViewport = (w2) => {
  Object.defineProperty(w2, "innerWidth", { value: VW, configurable: true });
  Object.defineProperty(w2, "innerHeight", { value: VH, configurable: true });
};
const dom = new JSDOM(html, { url: "http://localhost:8080/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
setViewport(window);
const { document } = window;
window.Element.prototype.scrollIntoView = function () {};
window.scrollTo = () => {};
if (!window.matchMedia) window.matchMedia = () => ({ matches: false });
window.fetch = () => Promise.reject(new Error("offline"));
window.addEventListener("error", (e) => RUNTIME.push((e.error && e.error.stack) || e.message));
const origErr = window.console.error;
window.console.error = (...a) => RUNTIME.push("console.error: " + a.map(String).join(" "));

const jsCode = ["data.js", "engine.js", "ui-modal.js", "ui-windows.js", "ui.js"]
  .map((f) => fs.readFileSync(path.join(ROOT, "webui/js", f), "utf8"))
  .join("\n") + `\n;window.__k = { init, navigate, openProjectEditor, recalcTotals, clearDirty,
  openModal, closeModal, anyModalOpen,
  get PROJECTS() { return PROJECTS; }, get state() { return state; } };`;
window.eval(jsCode);
const K = window.__k;

/* localStorage: در jsdom هست، ولی برایِ دیدنِ «بینِ نشست‌ها» یک کپیِ بیرونی
   هم نگه می‌داریم تا بتوانیم نشستِ دوم را با همان داده بالا بیاوریم. */
const realLS = window.localStorage;
const captured = {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
function rectOf(sel) {
  const s = $(sel).style;
  const num = (v) => (v == null || v === "" ? null : parseFloat(String(v)));
  return {
    top: num(s.top), start: num(s.insetInlineStart), w: num(s.width),
    h: num(s.height), pos: s.position || "", z: num(s.zIndex),
  };
}
/* ماژول اگر PointerEvent داشته باشد با pointer* کار می‌کند، وگرنه با mouse*.
   آزمون باید همان مسیری را بزند که مرورگرِ واقعی می‌رود. */
const HAS_POINTER = typeof window.PointerEvent === "function";
const evName = (base) => (HAS_POINTER ? "pointer" + base : "mouse" + base);
function mouse(base, target, x, y) {
  const Ctor = HAS_POINTER ? window.PointerEvent : window.MouseEvent;
  const ev = new Ctor(evName(base), {
    bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1,
  });
  target.dispatchEvent(ev);
}

(async () => {
  await K.init();
  await sleep(120);
  const KW = window.KabirWindows;
  check("ماژول بالا آمده و API می‌دهد", !!KW && typeof KW.setMode === "function");

  /* یک پروژه‌ی نمونه باز کن تا ویرایشگر از حالت hidden درآید */
  const id = K.PROJECTS[0].id;
  K.navigate("projects");
  K.openProjectEditor(id);
  await sleep(150);
  check("ویرایشگر باز شد", !$("#projectEditor").hidden);

  section("۶) ساختِ پنجره‌ها");
  const PANELS = [["#editorBar", "edbar"], ["#edInfoCard", "info"], ["#edSecCard", "sec"], ["#totalBar", "total"]];
  PANELS.forEach(([sel, key]) => {
    const el = $(sel);
    check(`${sel} پنجره شد (.win + data-win=${key})`,
      !!el && el.classList.contains("win") && el.getAttribute("data-win") === key);
    check(`${sel} نوارِ عنوان و بدنه گرفت`,
      !!el.querySelector(":scope > .win-bar") && !!el.querySelector(":scope > .win-body"));
    check(`${sel} هشت دستگیره‌ی تغییرِ اندازه دارد`,
      el.querySelectorAll(":scope > .win-rz").length === 8,
      el.querySelectorAll(":scope > .win-rz").length);
    check(`${sel} سه دکمه‌ی کوچک/بزرگ/بستن دارد`,
      ["min", "max", "close"].every((a) => !!el.querySelector(`.win-btn[data-win="${a}"]`)));
  });
  check("بدنه‌ی هر پنجره محتوای قبلی‌اش را نگه داشته (مثلاً جدولِ یونیت‌ها)",
    !!$("#edSecCard > .win-body #tblUnits") && !!$("#edInfoCard > .win-body #edTitle") &&
    !!$("#totalBar > .win-body #tbFinal") && !!$("#editorBar > .win-body #btnSaveProject"));

  section("۷) حالتِ پیش‌فرض (free) — موقعیت و اندازه");
  check("بوم کلاسِ win-free گرفت", $("#projectEditor").classList.contains("win-free"));
  const rEd = rectOf("#editorBar"), rSec = rectOf("#edSecCard"), rTotal = rectOf("#totalBar");
  check("پنجره‌ها position:absolute شدند", rEd.pos === "absolute" && rSec.pos === "absolute");
  check("عرضِ پنجره‌ها تعیین شده", rSec.w > 300 && rEd.w > 300, JSON.stringify(rSec));
  check("«بخش‌ها» ارتفاعِ ثابت گرفت (قابلِ اسکرول)", rSec.h > 200, JSON.stringify(rSec));
  check("نوارِ فرمان بالاترین z را دارد (منوی ⋯ رویش نپرد)",
    rEd.z === 29 && rSec.z >= 22 && rSec.z <= 28, `${rEd.z} / ${rSec.z}`);
  check("نوارِ «جمع و مالی» پایین‌ترین پنجره است", rTotal.top > rSec.top, `${rTotal.top} vs ${rSec.top}`);
  check("هر پنجره از همان نخست z در بازه‌ی ۲۲…۲۸ دارد (زیرِ نوارِ بالا/مودال، بالای نوارِ چسبان)",
    [rSec.z, rTotal.z].every((z) => z >= 22 && z <= 28), `${rSec.z}, ${rTotal.z}`);
  check("بوم (minHeight) به‌خاطرِ محتوای بلندِ یک پنجره، چند برابرِ نمایشگر نمی‌شود",
    parseFloat($("#projectEditor").style.minHeight) <= window.innerHeight * 1.6 + 1,
    $("#projectEditor").style.minHeight);

  section("۸) جابه‌جایی با موس");
  {
    const before = rectOf("#edSecCard");
    const bar = $("#edSecCard > .win-bar");
    mouse("down", bar, 600, 300);
    check("هنگامِ کشیدن، کلاسِ dragging می‌نشیند", $("#edSecCard").classList.contains("dragging"));
    mouse("move", document, 600 - 120, 300 + 70);
    mouse("up", document, 600 - 120, 300 + 70);
    const after = rectOf("#edSecCard");
    check("RTL: حرکتِ موس به چپ ⇒ x منطقی بزرگ‌تر می‌شود",
      after.start === before.start + 120, `${before.start} → ${after.start}`);
    check("حرکتِ موس به پایین ⇒ top بزرگ می‌شود (یا اگر پنجره از بوم بلندتر است، در لبه‌ی پایین مهار می‌شود)",
      after.top === before.top + 70 || after.top === 768 - before.h - 12,
      `${before.top} → ${after.top}`);
    check("پس از رهاکردن، کلاسِ dragging برمی‌دارد", !$("#edSecCard").classList.contains("dragging"));
    check("عرض/ارتفاع هنگامِ جابه‌جایی دست‌نخورده می‌ماند",
      after.w === before.w && after.h === before.h, JSON.stringify(after));
  }
  {
    /* کشیدن از روی دکمه نباید پنجره را تکان دهد */
    const before = rectOf("#edSecCard");
    const btn = $("#edSecCard .win-btn[data-win='min']");
    mouse("down", btn, 500, 200);
    mouse("move", document, 300, 400);
    mouse("up", document, 300, 400);
    const after = rectOf("#edSecCard");
    check("کشیدن از روی دکمه‌های نوارِ عنوان، پنجره را جابه‌جا نمی‌کند",
      after.start === before.start && after.top === before.top, JSON.stringify(after));
  }

  section("۹) تغییرِ اندازه با موس");
  {
    /* گوشه‌ی جنوب‌شرقی (پایین-راستِ فیزیکی). در RTL این گوشه روی «لبه‌ی
       شروعِ منطقی» است، پس کشیدنش به چپ ⇒ پنجره باریک‌تر و x منطقی بزرگ‌تر،
       در حالی که لبه‌ی چپِ فیزیکی (پایانِ منطقی) سرِ جایش می‌ماند. */
    const before = rectOf("#edSecCard");
    const h = $("#edSecCard .win-rz-se");
    mouse("down", h, 500, 500);
    check("هنگامِ تغییرِ اندازه، کلاسِ resizing می‌نشیند", $("#edSecCard").classList.contains("resizing"));
    mouse("move", document, 500 - 90, 500 + 60);
    mouse("up", document, 500 - 90, 500 + 60);
    const after = rectOf("#edSecCard");
    check("کشیدنِ گوشه‌ی جنوب‌شرقی به پایین ⇒ بلندتر می‌شود",
      after.h === before.h + 60, `${before.h} → ${after.h}`);
    check("… و به چپ ⇒ باریک‌تر می‌شود", after.w === before.w - 90, `${before.w} → ${after.w}`);
    check("لبه‌یِ مقابل (چپِ فیزیکی) سرِ جایش می‌ماند ⇒ x منطقی به همان اندازه بزرگ می‌شود",
      after.start === before.start + 90, `${before.start} → ${after.start}`);
    /* اگر پنجره آن‌قدر بلند شود که در بوم جا نشود، clampWin آن را بالا
       می‌کشد تا کامل دیده شود — پس «ثابت» یا «دقیقاً لبه‌ی مهار» هر دو درست‌اند. */
    check("بالای پنجره هنگامِ کشیدنِ لبه‌ی جنوب ثابت می‌ماند (مگر آن‌که بوم مهارش کند)",
      after.top === before.top || after.top === Math.max(12, (VH - 140) - after.h - 12),
      `${before.top} → ${after.top} (h=${after.h})`);
    check("کلاسِ resizing پس از رهاکردن برداشته می‌شود", !$("#edSecCard").classList.contains("resizing"));
  }
  {
    /* لبه‌ی راستِ فیزیکی = لبه‌ی شروعِ منطقی در RTL */
    const before = rectOf("#edSecCard");
    mouse("down", $("#edSecCard .win-rz-e"), 300, 400);
    mouse("move", document, 300 + 80, 400);
    mouse("up", document, 300 + 80, 400);
    const after = rectOf("#edSecCard");
    check("RTL: کشیدنِ لبه‌ی راست به راست ⇒ پنجره پهن‌تر می‌شود",
      after.w === before.w + 80, `${before.w} → ${after.w}`);
    check("… و x منطقی کوچک‌تر (لبه‌ی چپِ فیزیکی ثابت)", after.start === before.start - 80,
      `${before.start} → ${after.start}`);
    check("ارتفاع در کشیدنِ لبه‌ی عمودی دست‌نخورده می‌ماند", after.h === before.h,
      `${before.h} → ${after.h}`);
  }
  {
    /* لبه‌ی چپِ فیزیکی = لبه‌ی پایانِ منطقی: کشیدنش به چپ ⇒ پهن‌تر، x ثابت */
    const before = rectOf("#edSecCard");
    mouse("down", $("#edSecCard .win-rz-w"), 300, 400);
    mouse("move", document, 300 - 70, 400);
    mouse("up", document, 300 - 70, 400);
    const after = rectOf("#edSecCard");
    check("RTL: کشیدنِ لبه‌ی چپ به چپ ⇒ پهن‌تر، x منطقی ثابت",
      after.w === Math.min(before.w + 70, VW - 24) && after.start === before.start,
      JSON.stringify({ before, after }));
  }
  {
    const before = rectOf("#edSecCard");
    mouse("down", $("#edSecCard .win-rz-nw"), 500, 500);
    mouse("move", document, 500 - 3000, 500 - 3000);
    mouse("up", document, 500 - 3000, 500 - 3000);
    const after = rectOf("#edSecCard");
    check("هرگز زیرِ حداقلِ تعریف‌شده کوچک نمی‌شود",
      after.w >= 460 && after.h >= 200, JSON.stringify(after));
    check("پنجره هیچ‌وقت از بوم بیرون نمی‌افتد (لبه‌هایش مهار می‌شوند)",
      after.start >= -after.w + 44 && after.top >= -after.h + 44, JSON.stringify(after));
  }

  section("۱۰) کوچک / بزرگ / بستن");
  {
    const before = rectOf("#edSecCard");
    check("ارتفاعِ «بخش‌ها» پیش از کوچک‌کردن ثابت است", typeof before.h === "number" && before.h > 0, JSON.stringify(before));
    $("#edSecCard .win-btn[data-win='min']").click();
    await sleep(10);
    check("کوچک‌کردن: کلاسِ min می‌نشیند", $("#edSecCard").classList.contains("min"));
    check("کوچک‌کردن: ارتفاعِ ثابت برمی‌دارد تا فقط نوارِ عنوان بماند",
      $("#edSecCard").style.height === "auto", $("#edSecCard").style.height);
    check("کوچک‌کردن: ارتفاعِ پنجره در state هم null می‌شود (تا CSS !important تنها حاکم نباشد)",
      KW.getState().wins.sec.h === null, String(KW.getState().wins.sec.h));
    $("#edSecCard .win-btn[data-win='min']").click();
    await sleep(10);
    check("بازکردنِ دوباره: کلاسِ min می‌رود", !$("#edSecCard").classList.contains("min"));
    check("بازکردنِ دوباره: ارتفاعِ پیشین برمی‌گردد", rectOf("#edSecCard").h === before.h,
      JSON.stringify(rectOf("#edSecCard")) + " ≠ " + before.h);
    /* رفت‌وبرگشتِ حالت (stacked → free) معادلِ applyAllِ دوباره است: باز/بستنِ
       ویرایشگر یا تغییرِ اندازه‌ی صفحه. این رفت‌وبرگشت نباید «کوچک‌بودن» را
       بشکند و ارتفاعِ دستی را برگرداند (باگِ واقعیِ applyAll که این‌جا گرفته شد). */
    $("#edSecCard .win-btn[data-win='min']").click();
    await sleep(10);
    KW.setMode("stacked", true);
    KW.setMode("free", true);
    check("پسِ رفت‌وبرگشتِ حالت، پنجره‌ی کوچک‌شده کوچک می‌ماند (ارتفاع auto)",
      $("#edSecCard").style.height === "auto" && $("#edSecCard").classList.contains("min"),
      $("#edSecCard").style.cssText);
    $("#edSecCard .win-btn[data-win='min']").click();
    await sleep(10);

    $("#edSecCard .win-btn[data-win='max']").click();
    await sleep(10);
    const mx = rectOf("#edSecCard");
    check("بزرگ‌نمایی: پنجره بوم را پُر می‌کند", mx.start === 12 && mx.top === 12 && mx.w > 900, JSON.stringify(mx));
    check("بزرگ‌نمایی: کلاسِ max و آیکونِ «بازگردانی»", $("#edSecCard").classList.contains("max"));
    $("#edSecCard .win-btn[data-win='max']").click();
    await sleep(10);
    const rs = rectOf("#edSecCard");
    check("بازگردانی: هندسه‌ی پیش از بزرگ‌نمایی دقیقاً برمی‌گردد",
      rs.start === before.start && rs.top === before.top && rs.w === before.w && rs.h === before.h,
      JSON.stringify(rs) + " ≠ " + JSON.stringify(before));

    $("#edInfoCard .win-btn[data-win='close']").click();
    await sleep(10);
    check("بستنِ پنجره: گره hidden می‌شود", $("#edInfoCard").hidden === true);
    KW.restoreAll();
    await sleep(10);
    check("«بازگردانیِ پنجره‌های بسته» پیدایش می‌کند", $("#edInfoCard").hidden === false);
  }

  section("۱۱) منوی ⋯ — کنش‌های چیدمان");
  {
    const menu = $("#ovfEditor .ovf-menu");
    const items = $$("[data-winmenu]").map((b) => b.getAttribute("data-winmenu"));
    check("چهار کنشِ چیدمان در منو نشست (free/stacked/reset/restore)",
      ["free", "stacked", "reset", "restore"].every((k) => items.indexOf(k) >= 0), JSON.stringify(items));
    check("ترتیبِ منو: جداکننده ← برچسب ← کنش‌ها",
      menu.children[0].className.indexOf("ovf-sep") >= 0 &&
      menu.children[1].className.indexOf("ovf-label") >= 0 &&
      menu.children[2].getAttribute("data-winmenu") === "free",
      Array.from(menu.children).slice(0, 4).map((c) => c.className || c.getAttribute("data-winmenu")).join(" | "));
    const wFree = rectOf("#edSecCard").w;
    menu.querySelector("[data-winmenu='stacked']").click();
    await sleep(10);
    check("«حالتِ مرتب» → بوم win-stacked می‌گیرد", $("#projectEditor").classList.contains("win-stacked"));
    const flat = rectOf("#edSecCard");
    check("در حالتِ مرتب، هیچ style خطیِ موقعیت/اندازه نمی‌ماند (چیدمانِ پیشینِ برنامه)",
      flat.pos === "" && flat.top === null && flat.w === null && flat.h === null, JSON.stringify(flat));
    menu.querySelector("[data-winmenu='free']").click();
    await sleep(10);
    check("بازگشت به «حالتِ پنجره‌ای» → همان هندسه‌ی ذخیره‌شده",
      $("#projectEditor").classList.contains("win-free") && rectOf("#edSecCard").w === wFree,
      rectOf("#edSecCard").w + " ≠ " + wFree);
  }

  section("۱۲) ماندگاری بینِ نشست‌ها (localStorage)");
  {
    const raw = realLS.getItem(W.STORE_KEY);
    check("چیدمان در localStorage نوشته شده", !!raw && raw.length > 20, String(raw).slice(0, 60));
    const saved = JSON.parse(raw || "{}");
    check("کلیدِ نسخه‌دار است (v) تا تغییرِ ساختار، چیدمانِ کهنه را قاطی نکند", saved.v === W.SCHEMA, String(saved.v));
    const dragged = rectOf("#edSecCard");
    check("موقعیتِ کشیده‌شده در state ذخیره شده",
      saved.wins && saved.wins.sec && saved.wins.sec.x === dragged.start && saved.wins.sec.w === dragged.w,
      JSON.stringify(saved.wins && saved.wins.sec));

    /* --- نشستِ دوم: DOM تازه، همان localStorage --- */
    const dom2 = new JSDOM(html, { url: "http://localhost:8080/", runScripts: "outside-only", pretendToBeVisual: true });
    dom2.window.Element.prototype.scrollIntoView = function () {};
    dom2.window.scrollTo = () => {};
    setViewport(dom2.window);
    if (!dom2.window.matchMedia) dom2.window.matchMedia = () => ({ matches: false });
    dom2.window.fetch = () => Promise.reject(new Error("offline"));
    dom2.window.localStorage.setItem(W.STORE_KEY, raw);
    dom2.window.eval(jsCode);
    await dom2.window.__k.init();
    await sleep(120);
    dom2.window.__k.navigate("projects");
    dom2.window.__k.openProjectEditor(id);
    await sleep(150);
    const s2 = dom2.window.document.querySelector("#edSecCard").style;
    const restored = { start: parseFloat(s2.insetInlineStart), top: parseFloat(s2.top), w: parseFloat(s2.width), h: parseFloat(s2.height) };
    check("در نشستِ دوم، پنجره دقیقاً همان‌جا و همان‌اندازه باز می‌شود",
      restored.start === dragged.start && restored.top === dragged.top &&
      restored.w === dragged.w && restored.h === dragged.h,
      JSON.stringify(restored) + " ≠ " + JSON.stringify(dragged));
    check("حالتِ پنجره‌ای هم در نشستِ دوم برقرار است",
      dom2.window.document.querySelector("#projectEditor").classList.contains("win-free"));

    /* --- بازنشانی به حالتِ پیش‌فرض --- */
    dom2.window.KabirWindows.resetLayout();
    await sleep(30);
    const d = W.defaultLayout(VW, VH - 140, {});   /* همان ابعادی که ماژول می‌بیند */
    const s3 = dom2.window.document.querySelector("#edSecCard").style;
    check("بازنشانی: «بخش‌ها» به خانه‌ی پیش‌فرض برمی‌گردد",
      parseFloat(s3.insetInlineStart) === d.sec.x && parseFloat(s3.top) === d.sec.y,
      `${s3.insetInlineStart}/${s3.top} ≠ ${d.sec.x}/${d.sec.y}`);
    const raw3 = JSON.parse(dom2.window.localStorage.getItem(W.STORE_KEY) || "{}");
    check("بازنشانی در localStorage هم می‌نشیند (دفعه‌ی بعد همان پیش‌فرض است)",
      raw3.wins.sec.x === d.sec.x && raw3.wins.sec.w === d.sec.w, JSON.stringify(raw3.wins.sec));
    check("بازنشانی، پنجره‌های بسته/کوچک را هم برمی‌گرداند",
      Object.keys(raw3.wins).every((k) => !raw3.wins[k].hidden && !raw3.wins[k].min));
    dom2.window.close();
  }

  section("۱۳) کلیدهای میان‌بر");
  {
    const before = KW.getMode();
    const ev = new window.KeyboardEvent("keydown", { key: "w", code: "KeyW", altKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    await sleep(10);
    check("Alt+W حالت را جابه‌جا می‌کند", KW.getMode() !== before, `${before} → ${KW.getMode()}`);
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "w", code: "KeyW", altKey: true, bubbles: true, cancelable: true }));
    await sleep(10);
    check("Alt+W دوباره → حالتِ نخست", KW.getMode() === before, KW.getMode());
    $("#edSecCard").style.top = "777px";
    KW.getState().wins.sec.y = 777;
    KW.persist();
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "0", code: "Digit0", altKey: true, bubbles: true, cancelable: true }));
    await sleep(20);
    check("Alt+0 چیدمان را به پیش‌فرض برمی‌گرداند", parseFloat($("#edSecCard").style.top) !== 777,
      $("#edSecCard").style.top);
  }

  section("۱۴) پنجره‌های گفتگو (مودال)");
  {
    const ids = KW.modalList();
    const domModals = Array.from(document.querySelectorAll(".modal")).filter((m) => m.id).length;
    check("همه‌ی مودال‌های سند تزیین شدند (۱۲ تا، از جمله tpl-save و keys)",
      ids.length === domModals && ids.length === 12, JSON.stringify(ids));
    check("هیچ مودالی بیرونِ پس‌زمینه نمانده (وگرنه open نمی‌گیرد — باگِ «؟»)",
      ids.every((id) => document.querySelector("#modal-" + id).closest("#modalBackdrop") !== null));
    check("هر مودال ۸ دستگیره‌ی تغییرِ اندازه گرفت",
      ids.every((id) => document.querySelectorAll(`#modal-${id} > .win-rz`).length === 8));
    check("نوارِ عنوانِ هر مودال دستگیره‌ی کشیدن شد (.win-drag)",
      ids.every((id) => !!document.querySelector(`#modal-${id} .modal-head.win-drag`)));
    check("پیش از بازکردن، هیچ هندسه‌ی دستی روی مودال نیست (ظاهرِ پیش‌فرضِ قبلی)",
      ids.every((id) => {
        const st = document.querySelector(`#modal-${id}`).style;
        return !st.left && !st.top && !st.height && !document.querySelector(`#modal-${id}`).classList.contains("win-modal");
      }));
    check("عرضِ خطیِ اصلیِ مودال نگه داشته شده (برای بازنشانی)",
      document.querySelector("#modal-keys").getAttribute("data-win-w0") === "min(34rem,100%)",
      document.querySelector("#modal-keys").getAttribute("data-win-w0"));

    K.openModal("keys");
    await sleep(60);
    const mk = $("#modal-keys");
    check("مودالِ باز، پنجره شد (.win-modal + left/top/width)",
      mk.classList.contains("win-modal") && !!mk.style.left && !!mk.style.width, mk.style.cssText);
    const g0 = { left: parseFloat(mk.style.left), top: parseFloat(mk.style.top), w: parseFloat(mk.style.width) };
    check("در نبودِ اندازه‌گیری (jsdom)، وسط‌چینِ جایگزین به‌کار می‌رود",
      g0.w === 680 && Math.abs(g0.left - (VW - 680) / 2) < 1, JSON.stringify(g0));
    check("ارتفاع «خودکار» می‌ماند تا محتوا جا داشته باشد",
      mk.style.height === "auto", mk.style.height);
    const z0 = mk.style.zIndex;

    /* کشیدن — مودال با left/top فیزیکی است، پس جهتِ RTL وارونه نمی‌شود */
    mouse("down", mk.querySelector(".modal-head"), 700, 200);
    check("هنگامِ کشیدنِ مودال، کلاسِ dragging می‌نشیند", mk.classList.contains("dragging"));
    mouse("move", document, 700 + 150, 200 + 90);
    mouse("up", document, 700 + 150, 200 + 90);
    const g1 = { left: parseFloat(mk.style.left), top: parseFloat(mk.style.top) };
    check("کشیدنِ نوارِ عنوان: موس به راست ⇒ left بزرگ‌تر (فیزیکی، بدونِ وارونگیِ RTL)",
      g1.left === g0.left + 150, `${g0.left} → ${g1.left}`);
    check("… و موس به پایین ⇒ top بزرگ‌تر", g1.top === g0.top + 90, `${g0.top} → ${g1.top}`);
    check("کشیدن، عمقِ پشته‌ی مودال را عوض نمی‌کند (z کارِ syncInert است)",
      mk.style.zIndex === z0, `${z0} → ${mk.style.zIndex}`);
    check("کلاسِ dragging پس از رهاکردن برداشته می‌شود", !mk.classList.contains("dragging"));

    /* کشیدن از روی دکمه‌ی بستن نباید جابه‌جا کند */
    const closeBtn = mk.querySelector(".modal-head .icon-btn");
    const g2 = { left: parseFloat(mk.style.left), top: parseFloat(mk.style.top) };
    mouse("down", closeBtn, 500, 150);
    mouse("move", document, 200, 500);
    mouse("up", document, 200, 500);
    check("کشیدن از روی دکمه‌ی «بستن»، مودال را جابه‌جا نمی‌کند",
      parseFloat(mk.style.left) === g2.left && parseFloat(mk.style.top) === g2.top,
      JSON.stringify({ g2, now: mk.style.left + "/" + mk.style.top }));

    /* تغییرِ اندازه */
    const w0 = parseFloat(mk.style.width);
    mouse("down", mk.querySelector(".win-rz-se"), 400, 400);
    mouse("move", document, 400 + 120, 400 + 80);
    mouse("up", document, 400 + 120, 400 + 80);
    check("کشیدنِ گوشه‌ی جنوب‌شرقی ⇒ پهن‌تر", parseFloat(mk.style.width) === w0 + 120,
      `${w0} → ${mk.style.width}`);
    check("… و بلندتر (ارتفاعِ دستی می‌نشیند)", parseFloat(mk.style.height) >= 240 + 80, mk.style.height);
    check("با ارتفاعِ دستی، max-height مزاحم نمی‌شود", mk.style.maxHeight === "none", mk.style.maxHeight);

    /* ماندگاری */
    const saved = JSON.parse(window.localStorage.getItem(W.STORE_KEY) || "{}");
    check("چیدمانِ مودال هم در localStorage می‌نشیند",
      !!(saved.modals && saved.modals.keys && saved.modals.keys.w), JSON.stringify(saved.modals));
    const geo = { left: mk.style.left, top: mk.style.top, w: mk.style.width, h: mk.style.height };

    /* بستن ⇒ هندسه‌ی دستی برداشته می‌شود؛ بازکردنِ دوباره ⇒ همان چیدمان */
    K.closeModal("keys");
    await sleep(30);
    check("پسِ بستن، مودال به حالتِ معمولی برمی‌گردد (بی .win-modal)",
      !mk.classList.contains("win-modal") && !mk.style.left, mk.style.cssText);
    K.openModal("keys");
    await sleep(60);
    check("بازکردنِ دوباره ⇒ همان جا و همان اندازه (نه مرکز‌چینِ تازه)",
      mk.style.left === geo.left && mk.style.top === geo.top &&
      mk.style.width === geo.w && mk.style.height === geo.h,
      JSON.stringify({ geo, now: mk.style.cssText }));

    /* دوبار کلیک روی نوارِ عنوان = بازنشانیِ همان مودال */
    mk.querySelector(".modal-head").dispatchEvent(
      new window.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    await sleep(40);
    check("دوبار کلیک روی نوارِ عنوان ⇒ اندازه/جای مودال به پیش‌فرض برمی‌گردد",
      parseFloat(mk.style.width) === 680 && Math.abs(parseFloat(mk.style.left) - (VW - 680) / 2) < 1,
      mk.style.cssText);

    /* حالتِ مرتب ⇒ مودال‌ها هم مثلِ روزِ اول */
    KW.setMode("stacked", true);
    await sleep(20);
    check("در حالتِ مرتب، مودال هیچ هندسه‌ی دستی ندارد",
      !mk.classList.contains("win-modal") && !mk.style.left && !mk.style.top, mk.style.cssText);
    /* نکته: باید *صفتِ* style را سنجید نه `mk.style.width` را — cssstyle در
       jsdom مقدارِ `min(34rem,100%)` را در CSSOM نگه نمی‌دارد (دقیقاً همان دامی
       که unplaceModal را به setAttribute واداشت). در مرورگر هر دو یکی‌اند. */
    check("… و استایلِ خطیِ اصلی‌اش (width:min(34rem,100%)) بایت‌به‌بایت برگشته",
      /width:\s*min\(34rem,\s*100%\)/.test(mk.getAttribute("style") || ""),
      mk.getAttribute("style"));
    KW.setMode("free", true);
    await sleep(20);
    check("بازگشت به حالتِ پنجره‌ای ⇒ مودالِ باز دوباره پنجره است",
      mk.classList.contains("win-modal") && !!mk.style.left, mk.style.cssText);
    K.closeModal("keys");
    await sleep(30);
  }

  section("۱۵) سلامتِ رابط (رگرسیون)");
  check("CSS پنجره‌ها در styles.css هست",
    /\.win-bar\s*\{/.test(fs.readFileSync(path.join(ROOT, "webui/css/styles.css"), "utf8")));
  check("CSS مودالِ پنجره‌شده هست (.modal.win-modal.open → flex)",
    /\.modal\.win-modal\.open\s*\{\s*display: flex/.test(
      fs.readFileSync(path.join(ROOT, "webui/css/styles.css"), "utf8")));
  check("CSS چاپ، پنجره‌ها را به حالتِ مستندی برمی‌گرداند",
    /@media print[\s\S]{0,900}\.editor-stack\.win-free \.win \{ position: static/.test(
      fs.readFileSync(path.join(ROOT, "webui/css/styles.css"), "utf8")));
  check("index.html ماژول را پیش از ui.js بار می‌کند",
    html.indexOf("ui-windows.js") > 0 && html.indexOf("ui-windows.js") < html.indexOf("js/ui.js"));
  check("بدونِ خطای زمانِ اجرا", RUNTIME.length === 0, RUNTIME.slice(0, 3).join(" | "));

  console.log(`\n${fail ? "❌" : "✅"} ${pass} پاس · ${fail} شکست`);
  window.close();
  process.exit(fail ? 1 : 0);
})();
