/* تست ویژگی‌های جدید رابط وب: جداکننده‌ی هزارگان هنگام تایپ،
   ابعاد پیش‌فرض یونیت‌ها و اعمال خودکارشان با تغییر نوع.
   اجرا:  node tests/ui_features_check.js */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const noop = () => {};

function makeSandbox() {
  const sandbox = {
    console, JSON, Math, Date, Number, String, Object, Array, Set, Map,
    isFinite, parseFloat, parseInt, RegExp, Error,
    document: {
      addEventListener: noop, getElementById: () => null, querySelector: () => null,
      querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop } }),
      documentElement: { dataset: {}, style: { setProperty: noop } },
      body: { classList: { remove: noop, toggle: noop }, style: {}, appendChild: noop },
      activeElement: { tagName: "BODY" },
    },
    localStorage: { getItem: () => null, setItem: noop },
    location: { protocol: "file:", hash: "" },
    history: { replaceState: noop },
    fetch: () => { throw new Error("no fetch"); },
    setTimeout, clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

const code =
  fs.readFileSync(path.join(ROOT, "webui/js/data.js"), "utf8") + "\n" +
  fs.readFileSync(path.join(ROOT, "webui/js/engine.js"), "utf8") + `
;loadDemoData();
/* متغیرهای let در vm به global نمی‌چسبند — با getter صادرشان می‌کنیم */
var __t = {
  get SETTINGS() { return SETTINGS; },
  get MATERIALS() { return MATERIALS; },
  get PROJECTS() { return PROJECTS; },
};
`;

let fail = 0;
function check(name, cond, extra) {
  console.log(`${cond ? "✅" : "❌"} ${name}${cond ? "" : "  →  " + extra}`);
  if (!cond) { fail++; process.exitCode = 1; }
}

const sb = makeSandbox();
vm.runInContext(code, sb, { filename: "combined.js" });

/* --- ۱) قالب‌بندی عدد با جداکننده‌ی هزارگان --- */
const cases = [
  ["1234567", "۱٬۲۳۴٬۵۶۷"],
  ["4850000", "۴٬۸۵۰٬۰۰۰"],
  ["999", "۹۹۹"],
  ["1000", "۱٬۰۰۰"],
  ["12.5", "۱۲٫۵"],
  ["1234.56", "۱٬۲۳۴٫۵۶"],
  ["-1500", "-۱٬۵۰۰"],
  ["۱۲۳۴۵۶۷", "۱٬۲۳۴٬۵۶۷"],          // ورودی فارسی
  ["1234abc56", "۱۲۳٬۴۵۶"],              // نویسه‌های نامجاز حذف شوند
];
for (const [inp, want] of cases) {
  const got = sb.fmtInp(inp);
  check(`fmtInp(${inp}) = ${want}`, got === want, got);
}
/* رفت‌وبرگشت: مقدار گروه‌بندی‌شده باید درست پارس شود */
check("parseNum roundtrip", sb.parseNum("۴٬۸۵۰٬۰۰۰") === 4850000, sb.parseNum("۴٬۸۵۰٬۰۰۰"));
check("parseNum decimal roundtrip", Math.abs(sb.parseNum("۱٬۲۳۴٫۵") - 1234.5) < 1e-9, sb.parseNum("۱٬۲۳۴٫۵"));

/* --- ۲) رفتار تایپ‌مانند: formatNumberInput با حفظ جای نشانگر --- */
function fakeInput(value, caret) {
  return {
    value, selectionStart: caret, selectionEnd: caret,
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    type: "text", tagName: "INPUT",
    getAttribute: () => "numeric", classList: { contains: () => false },
    hasAttribute: () => false, matches: () => true,
  };
}
{
  const i1 = fakeInput("1234", 4);            // نشانگر انتهای عدد
  sb.formatNumberInput(i1);
  check("formatNumberInput value", i1.value === "۱٬۲۳۴", i1.value);
  check("formatNumberInput caret at end", i1.selectionStart === i1.value.length, i1.selectionStart);

  const i2 = fakeInput("1234", 2);            // نشانگر وسط: 12|34
  sb.formatNumberInput(i2);
  /* پس از قالب‌بندی «۱٬۲|۳۴» — نشانگر باید بعد از رقم دوم بماند */
  const upto = sb.toEn(i2.value.slice(0, i2.selectionStart));
  const digitsBefore = (upto.match(/\d/g) || []).length;
  check("formatNumberInput caret keeps 2 digits before", digitsBefore === 2, `${i2.value} caret=${i2.selectionStart} digits=${digitsBefore}`);
}

/* --- ۳) ابعاد پیش‌فرض یونیت‌ها به تفکیک نوع --- */
const g = sb.unitDefaults("ground"), w = sb.unitDefaults("wall"), t = sb.unitDefaults("tall");
check("ground defaults", g.length_cm === 60 && g.height_cm === 72 && g.depth_cm === 55 && g.shelves === 1, JSON.stringify(g));
check("wall defaults", w.height_cm === 70 && w.depth_cm === 30, JSON.stringify(w));
check("tall defaults", t.height_cm === 220 && t.depth_cm === 58 && t.shelves === 2, JSON.stringify(t));

/* تغییر تنظیمات → ابعاد پیش‌فرض عوض شود */
sb.__t.SETTINGS.unit_tall_height_cm = "240";
sb.__t.SETTINGS.unit_wall_depth_cm = "35";
const t2 = sb.unitDefaults("tall"), w2 = sb.unitDefaults("wall");
check("settings override tall height", t2.height_cm === 240, JSON.stringify(t2));
check("settings override wall depth", w2.depth_cm === 35, JSON.stringify(w2));
sb.__t.SETTINGS.unit_tall_height_cm = "220";
sb.__t.SETTINGS.unit_wall_depth_cm = "30";

/* --- ۴) defaultUnit بر اساس نوع + اعمال خودکار با تغییر نوع --- */
const uw = sb.defaultUnit("wall");
check("defaultUnit(wall) dims", uw.unit_type === "wall" && uw.height_cm === 70 && uw.depth_cm === 30, JSON.stringify(uw));
check("defaultUnit(wall) label", /دیواری/.test(uw.label), uw.label);

const u = sb.defaultUnit("ground");
u.label = "یونیت زمینی ۶۰";
sb.applyUnitTypeDefaults(u, "tall");
check("applyUnitTypeDefaults dims", u.height_cm === 220 && u.depth_cm === 58 && u.shelves === 2, JSON.stringify(u));
check("applyUnitTypeDefaults label auto", u.label === sb.unitLabel("tall", 60), u.label);

/* برچسب سفارشی کاربر نباید بازنویسی شود */
const u2 = sb.defaultUnit("ground");
u2.label = "زیر سینک";
sb.applyUnitTypeDefaults(u2, "wall");
check("custom label preserved", u2.label === "زیر سینک", u2.label);

/* --- ۵) پروژه‌ی دمو: تغییر نرخ متریال → مبلغ پروژه به‌روز می‌شود --- */
const p = sb.__t.PROJECTS[0];
const before = sb.calcProjectLocal(p).final_price;
const bodyMat = sb.__t.MATERIALS.find((m) => m.name === "ام‌دی‌اف سفید برفی ۱۶ میل");
bodyMat.price = Math.round(bodyMat.price * 1.1);
const after = sb.calcProjectLocal(p).final_price;
check("demo project reflects new material price", after > before, `${before} -> ${after}`);

console.log(fail ? `\n❌ ${fail} بررسی ناموفق` : "\n✅ همه‌ی بررسی‌های رابط وب پاس شدند");
