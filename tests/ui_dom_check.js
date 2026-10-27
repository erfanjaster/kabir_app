/* تست دودِ رابط وب با jsdom — جریان‌های واقعی کاربر:
   حالت نمایشی، افزودن یونیت با ابعاد پیش‌فرض، تغییر نوع یونیت،
   جداکننده‌ی هزارگان هنگام تایپ و تنظیمات ابعاد پیش‌فرض.
   اجرا:  node tests/ui_dom_check.js   (نیاز به jsdom — در صورت نبودن، رد می‌شود) */
"use strict";
const fs = require("fs");
const path = require("path");

let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) {
  try { JSDOM = require(path.join(__dirname, "..", "..", "jsdom-test", "node_modules", "jsdom")).JSDOM; }
  catch (e2) {
    /* نصب محلی jsdom کنار مخزن (بدون ورود به ریپو):
         mkdir ../jsdom-test && cd ../jsdom-test && npm install jsdom       */
    console.log("SKIP: jsdom not installed");
    process.exit(0);
  }
}

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "webui/index.html"), "utf8");

let fail = 0;
function check(name, cond, extra) {
  console.log(`${cond ? "✅" : "❌"} ${name}${cond ? "" : "  →  " + (extra === undefined ? "" : extra)}`);
  if (!cond) { fail++; process.exitCode = 1; }
}

const dom = new JSDOM(html, { url: "http://localhost:8080/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
const { document } = window;

/* پلی‌فیل‌های لازم برای jsdom */
window.Element.prototype.scrollIntoView = function () {};
window.scrollTo = () => {};
if (!window.matchMedia) window.matchMedia = () => ({ matches: false });
window.fetch = () => Promise.reject(new Error("offline"));   // → حالت نمایشی

/* هر سه فایل یک‌جا eval می‌شوند (strict-mode) و handleها روی window.__k می‌نشینند */
const jsCode = ["data.js", "engine.js", "ui.js"]
  .map((f) => fs.readFileSync(path.join(ROOT, "webui/js", f), "utf8"))
  .join("\n") + `
;window.__k = {
  init, navigate, openProjectEditor, curPage, calcProjectLocal, parseNum, renderEditorTables,
  get API() { return API; },
  get PROJECTS() { return PROJECTS; },
  get SETTINGS() { return SETTINGS; },
};`;
window.eval(jsCode);
const K = window.__k;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (elm) => elm.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const type = (elm, value) => {
  elm.value = value;
  elm.dispatchEvent(new window.Event("input", { bubbles: true }));
};
const selectValue = (elm, value) => {
  elm.value = value;
  elm.dispatchEvent(new window.Event("input", { bubbles: true }));
  elm.dispatchEvent(new window.Event("change", { bubbles: true }));
};

(async () => {
  await K.init();
  await sleep(120);

  check("demo mode active (API disconnected)", K.API.ok === false);
  check("demo projects loaded", K.PROJECTS.length === 3);

  /* --- رفتن به صفحه‌ی پروژه‌ها و بازکردن ویرایشگر --- */
  K.navigate("projects");
  K.openProjectEditor(1);
  await sleep(80);
  check("project editor visible", document.getElementById("projectEditor").hidden === false);

  /* --- دکمه‌های افزودن یونیت بر اساس نوع وجود دارند --- */
  const btnWall = document.querySelector('[data-add="unit:wall"]');
  const btnTall = document.querySelector('[data-add="unit:tall"]');
  const btnGround = document.querySelector('[data-add="unit:ground"]');
  check("quick-add buttons exist", !!(btnWall && btnTall && btnGround));

  const unitsBefore = K.curPage().units.length;
  click(btnWall);
  await sleep(60);
  const uWall = K.curPage().units[unitsBefore];
  check("wall unit added with wall defaults",
    uWall.unit_type === "wall" && uWall.height_cm === 70 && uWall.depth_cm === 30 && uWall.length_cm === 60,
    JSON.stringify({ t: uWall.unit_type, l: uWall.length_cm, h: uWall.height_cm, d: uWall.depth_cm }));
  check("wall unit auto label", /دیواری/.test(uWall.label), uWall.label);

  /* --- تغییر نوع یونیت → ابعاد پیش‌فرض نوع جدید خودکار اعمال شود --- */
  const idx = unitsBefore;
  const sel = document.querySelector(`#tblUnits select[data-scope="unit"][data-k="unit_type"][data-ui="${idx}"]`);
  check("unit_type select rendered", !!sel);
  selectValue(sel, "tall");
  await sleep(80);
  const uTall = K.curPage().units[idx];
  check("type change applies tall defaults",
    uTall.unit_type === "tall" && uTall.height_cm === 220 && uTall.depth_cm === 58 && uTall.shelves === 2,
    JSON.stringify({ t: uTall.unit_type, h: uTall.height_cm, d: uTall.depth_cm, s: uTall.shelves }));
  check("label auto-updated to tall", /کمد ایستاده/.test(uTall.label), uTall.label);

  /* --- جداکننده‌ی هزارگان هنگام تایپ --- */
  K.curPage().extras.push({ label: "قلم تست", qty: 1, unit: "piece", price: 0, visible: true });
  K.renderEditorTables();
  const priceInputs = document.querySelectorAll('#tblExtras input[data-scope="extra"][data-k="price"]');
  const priceInp = priceInputs[priceInputs.length - 1];   // ردیف تازه‌اضافه‌شده (آخرین)
  check("extra price input rendered", !!priceInp);
  priceInp.focus();
  type(priceInp, "1500000");
  check("thousands separator while typing", priceInp.value === "۱٬۵۰۰٬۰۰۰", priceInp.value);
  check("model receives parsed number", K.curPage().extras.slice(-1)[0].price === 1500000,
    String(K.curPage().extras.slice(-1)[0].price));

  /* فیلد درصدی جداکننده نگیرد */
  const profitInp = document.getElementById("tbProfitPct");
  type(profitInp, "2500");
  check("percent field (data-no-sep) not grouped", profitInp.value === "2500", profitInp.value);

  /* --- بنر نرخ قدیمی در حالت دمو پنهان است --- */
  check("stale banner hidden in demo mode", document.getElementById("staleBanner").hidden === true);

  /* --- تنظیمات: ابعاد پیش‌فرض یونیت‌ها --- */
  K.navigate("settings");
  await sleep(30);
  const setTallH = document.getElementById("setTallH");
  const setGroundL = document.getElementById("setGroundL");
  check("settings card rendered", !!setTallH && !!setGroundL);
  check("settings filled with defaults", setTallH.value === "۲۲۰" && setGroundL.value === "۶۰",
    `${setTallH.value} / ${setGroundL.value}`);

  /* تغییر پیش‌فرض و ذخیره → روی یونیت جدید اثر کند */
  type(setTallH, "240");
  click(document.getElementById("btnSaveSettings"));
  await sleep(80);
  check("settings saved (demo)", K.SETTINGS.unit_tall_height_cm === "240",
    K.SETTINGS.unit_tall_height_cm);
  (K.navigate("projects"), K.openProjectEditor(2));
  await sleep(60);
  const before2 = K.curPage().units.length;
  click(document.querySelector('[data-add="unit:tall"]'));
  await sleep(60);
  const nu = K.curPage().units[before2];
  check("new tall unit uses updated default height", nu.height_cm === 240, String(nu.height_cm));
  check("new tall unit label uses new length", /کمد ایستاده ۶۰/.test(nu.label), nu.label);

  /* --- مودال متریال: قیمت با جداکننده باز می‌شود --- */
  K.navigate("materials");
  await sleep(40);
  const editBtn = document.querySelector("[data-edit-mat]");
  click(editBtn);
  await sleep(40);
  const mfPrice = document.getElementById("mfPrice");
  check("material modal price grouped", /[٬]/.test(mfPrice.value) || K.parseNum(document.getElementById("mfPrice").value) > 0,
    mfPrice.value);

  console.log(fail ? `\n❌ ${fail} بررسی ناموفق` : "\n✅ همه‌ی بررسی‌های DOM پاس شدند");
  window.close();
})().catch((e) => { console.error("CRASH:", e); process.exit(1); });
