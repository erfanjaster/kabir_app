/* ==========================================================================
   هم‌ارزیِ دو موتور در **حالت‌های لبه‌ای** — درِ بازگشتِ باگ F-06
   --------------------------------------------------------------------------
   اجرا:
       python3 tests/parity_edge_export.py     # ۳۴ سناریو → /tmp/parity-edge-cases.json
       node    tests/parity_edge_check.js      # مقایسه با engine.js

   چرا این فایل لازم است؟
   `tests/parity_check.js` فقط **یک** پروژه‌ی طلایی را مقایسه می‌کند، پس
   واگراییِ دو موتور در حالت‌های لبه‌ای دیده نمی‌شد. در بازرسی، ۸ واگرایی از
   ۳۰ سناریو پیدا شد — تا ۲ برابر اختلاف قیمت روی یک داده‌ی یکسان، و حتی یک
   قیمتِ **منفی** (−380,820) در موتور JS. همه برطرف شدند و این فایل همان
   سناریوها را قفل می‌کند تا دوباره برنگردند.

   ریشه‌های واگرا که این‌جا پایشان می‌شود:
     ۱) مقدارِ پیش‌فرضِ متفاوت برای «ناموجود»  → `_f(x,0)` در برابر `_n(x,1)`
     ۲) `truthy` در برابر `!== false`           → `has_bottom_panel: 0`
     ۳) `and x` در برابر `> 0`                  → ضریب/تعدادِ منفی
     ۴) سطحِ تجمیع ورق (بخش در برابر پروژه)     → F-01

   کدِ خروجی: ۰ = همه هم‌ارز، ۱ = دست‌کم یک واگرایی.
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const CASES_PATH = "/tmp/parity-edge-cases.json";

if (!fs.existsSync(CASES_PATH)) {
  console.error("✖ اول این را اجرا کنید:  python3 tests/parity_edge_export.py");
  process.exit(2);
}
const payload = JSON.parse(fs.readFileSync(CASES_PATH, "utf8"));

/* --- sandboxِ بدون DOM (همان روشِ tests/parity_check.js) --- */
const noop = () => {};
const sandbox = {
  console, JSON, Math, Date, Number, String, Object, Array, Set, Map,
  isFinite, parseFloat, parseInt,
  document: {
    addEventListener: noop, getElementById: () => null, querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop } }),
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

const code =
  fs.readFileSync(path.join(ROOT, "webui/js/data.js"), "utf8") + "\n" +
  fs.readFileSync(path.join(ROOT, "webui/js/engine.js"), "utf8") + `
;MATERIALS = __payload.materials;
SETTINGS = __payload.settings;
DIGITS_FA = false;
var __out = {};
for (const [name, c] of Object.entries(__payload.cases)) {
  try {
    const proj = Object.assign({ pages: c.pages }, c.project);
    const r = calcProjectLocal(proj);
    __out[name] = {
      ok: true,
      total_cost: r.total_cost,
      final_price: r.final_price,
      stats: r.stats,
      n_items: r.items.length,
      item_sum: r.items.reduce((a, i) => a + i.amount, 0),
      warnings: r.warnings.length,
    };
  } catch (e) {
    __out[name] = { ok: false, err: (e && e.constructor ? e.constructor.name : "Error") + ": " + e.message };
  }
}
`;

sandbox.__payload = payload;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "combined.js" });

const js = sandbox.__out;
const py = payload.py;

const f = (x) => (Number.isFinite(x)
  ? x.toLocaleString("en-US", { maximumFractionDigits: 2 })
  : String(x));

let divergent = 0;
let crashed = 0;
const names = Object.keys(py);

console.log(`مقایسه‌ی ${names.length} سناریوی لبه‌ای — موتور پایتون ↔ engine.js\n`);

for (const name of names) {
  const p = py[name];
  const j = js[name] || { ok: false, err: "MISSING" };
  const reasons = [];

  if (!p.ok || !j.ok) {
    crashed += 1;
    if (p.ok !== j.ok) reasons.push("یکی کرش کرد و دیگری نه");
    else reasons.push("هر دو کرش کردند (ورودی نباید تا موتور کرش ببرد)");
  } else {
    if (Math.abs(p.total_cost - j.total_cost) > 1) reasons.push(`total_cost py=${f(p.total_cost)} js=${f(j.total_cost)}`);
    if (Math.abs(p.final_price - j.final_price) > 1) reasons.push(`final_price py=${f(p.final_price)} js=${f(j.final_price)}`);
    if (Math.abs(p.item_sum - j.item_sum) > 1) reasons.push(`Σitems py=${f(p.item_sum)} js=${f(j.item_sum)}`);
    if (p.n_items !== j.n_items) reasons.push(`n_items py=${p.n_items} js=${j.n_items}`);
    if (p.warnings !== j.warnings) reasons.push(`warnings py=${p.warnings} js=${j.warnings}`);
    for (const k of Object.keys(p.stats)) {
      if (Math.abs((p.stats[k] || 0) - (j.stats[k] || 0)) > 1e-6) {
        reasons.push(`stats.${k} py=${f(p.stats[k])} js=${f(j.stats[k])}`);
      }
    }
  }

  if (reasons.length) {
    divergent += 1;
    console.log(`❌ ${name}`);
    reasons.forEach((r) => console.log(`     ${r}`));
  } else {
    const tail = p.ok
      ? `cost=${f(p.total_cost)}  items=${p.n_items}  warn=${p.warnings}  sheets=${f(p.stats.total_sheets)}`
      : "هر دو سالم";
    console.log(`✅ ${name.padEnd(26)} ${tail}`);
  }
}

console.log(`\nواگرایی: ${divergent} از ${names.length}   |   کرش: ${crashed}`);

/* --- سه نامساوی که مستقل از هم‌ارزی باید همیشه برقرار بمانند --- */
let invariantFail = 0;
for (const name of names) {
  const j = js[name];
  if (!j || !j.ok) continue;
  if (!(j.final_price >= 0)) {
    console.log(`❌ نامساوی: ${name} → قیمت نهایی منفی (${f(j.final_price)})`);
    invariantFail += 1;
  }
  if (!Number.isFinite(j.total_cost) || !Number.isFinite(j.final_price)) {
    console.log(`❌ نامساوی: ${name} → خروجی غیرمتناهی`);
    invariantFail += 1;
  }
  if (Math.abs(j.item_sum - j.total_cost) > 1) {
    console.log(`❌ نامساوی: ${name} → جمع ردیف‌ها (${f(j.item_sum)}) ≠ هزینه‌ی تمام‌شده (${f(j.total_cost)})`);
    invariantFail += 1;
  }
}

/* --- F-01: تقسیم به بخش نباید ورق را باد کند --- */
const kitchen = ["kitchen_1_section", "kitchen_4_sections", "kitchen_8_sections"]
  .filter((k) => py[k] && py[k].ok);
if (kitchen.length === 3) {
  const sheets = kitchen.map((k) => py[k].stats.total_sheets);
  const spread = Math.max(...sheets) - Math.min(...sheets);
  if (spread > 1e-6) {
    console.log(`❌ F-01: ورق با تقسیم‌بندی عوض شد → ${kitchen.map((k, i) => `${k}=${f(sheets[i])}`).join(", ")}`);
    invariantFail += 1;
  } else {
    console.log(`✅ F-01: ۱/۴/۸ بخش همه ${f(sheets[0])} ورق`);
  }
}

if (divergent || invariantFail || crashed) {
  console.log("\n✖ ناموفق");
  process.exit(1);
}
console.log("\n✅ دو موتور در همه‌ی حالت‌های لبه‌ای هم‌ارز‌اند");
process.exit(0);
