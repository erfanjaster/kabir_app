/* بررسی تولیدکننده‌ی نمای فنی ۲D (کاغذ آبی) — اجرا:  node tests/blueprint_check.js
   blueprint.js عمداً بدونِ DOM است؛ اینجا در sandbox بارگذاری و خروجی SVG
   از نظر ساختار و محتوا چک می‌شود.                                            */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const noop = () => {};
const sandbox = {
  console, JSON, Math, Date, Number, String, Object, Array, Boolean,
  isFinite, parseFloat, parseInt, RegExp, Error,
  document: { addEventListener: noop, getElementById: () => null,
              querySelector: () => null, querySelectorAll: () => [] },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  location: { protocol: "file:", hash: "" },
  setTimeout, clearTimeout,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "webui/js/data.js"), "utf8") + "\n" +
                 fs.readFileSync(path.join(ROOT, "webui/js/blueprint.js"), "utf8"), sandbox);

const { bpFrontSVG, bpSideSVG, bpTopSVG, bpUnitTitle } = sandbox;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ✅ " + name); }
  else { fail++; console.log("  ❌ " + name + (extra ? " — " + extra : "")); }
}

/* ── یونیت کامل: ۱۰۰×۷۲ زمینی، ۲ در ۴۸×۷۰، ۱ کشو ── */
const unit = {
  label: "کابینت زمینی آزمایش", unit_type: "ground", qty: 2,
  length_cm: 100, height_cm: 72, depth_cm: 55, shelves: 1,
  doors: [{ qty: 2, w_cm: 48, h_cm: 70, glass: false }],
  drawers: [{ qty: 1, w_cm: 60, h_cm: 15 }],
};

console.log("نمای روبه‌رو:");
const front = bpFrontSVG(unit);
check("خروجی SVG معتبر است", front.startsWith("<svg") && front.trim().endsWith("</svg>"));
check("نقشه ابعاد طول را می‌نویسد", front.includes("طول ۱۰۰ سم"));
check("نقشه ابعاد ارتفاع را می‌نویسد", front.includes("ارتفاع ۷۲ سم"));
check("پاخورِ یونیت زمینی کشیده شده", front.includes("fill"));
check("دستگیره‌ی درها هست", (front.match(/rx="1\.5"/g) || []).length >= 2);
check("دستگیره‌ی کشو هست", front.includes('rx="2"'));
check("viewBox تعریف شده", front.includes("viewBox"));

console.log("نمای جانبی و از بالا:");
const side = bpSideSVG(unit);
check("عمق در نمای جانبی نوشته شده", side.includes("عمق ۵۵ سم"));
check("طبقه با خط‌چین است", side.includes("stroke-dasharray"));
const top = bpTopSVG(unit);
check("نمای از بالا طول را می‌نویسد", top.includes("طول ۱۰۰ سم"));

console.log("لبه‌ها:");
/* ابعاد صفر/منفی نباید نقشه را خرد کند */
const broken = bpFrontSVG({ unit_type: "ground", length_cm: -5, height_cm: 0, depth_cm: 55, doors: [{ qty: -2, w_cm: 0, h_cm: 0 }] });
check("ابعاد خراب نقشه را نمی‌خواباند", broken.startsWith("<svg"));
check("ابعاد خراب به کرانِ پیش‌فرض می‌رسد", broken.includes("طول ۶۰ سم"));
const empty = bpFrontSVG({ unit_type: "wall", length_cm: 60, height_cm: 70, depth_cm: 30, shelves: 2 });
check("یونیت بدون در: شلفِ باز با خطوط طبقه", empty.includes("stroke-dasharray") === false && empty.startsWith("<svg"));
/* شلفِ باز باید خطوط طبقه روی نما داشته باشد — اصلاح: نما خط طبقه می‌کشد */
check("شلفِ باز خطِ طبقه دارد", (empty.match(/stroke-width="1\.2"/g) || []).length >= 1);
const glass = bpFrontSVG({ unit_type: "wall", length_cm: 80, height_cm: 70, depth_cm: 30, doors: [{ qty: 1, w_cm: 40, h_cm: 65, glass: true }] });
check("درِ شیشه‌دار علامتِ قطری دارد", glass.includes('<line'));

console.log("عنوان و تعداد:");
const t = bpUnitTitle(unit);
check("نام و نوع و تعداد در عنوان هست", t.includes("کابینت زمینی آزمایش") && t.includes("×"));

console.log(`\n${pass} بررسی پاس شد${fail ? `, ${fail} شکست ❌` : " ✅"}`);
process.exit(fail ? 1 : 0);
