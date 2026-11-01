/* مقایسه‌ی خروجی engine.js با خروجی موتور پایتون (parity_export.py).
   اجرا:  node tests/parity_check.js   (پس از  python3 tests/parity_export.py) */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const payload = JSON.parse(fs.readFileSync("/tmp/parity-project.json", "utf8"));
const py = JSON.parse(fs.readFileSync("/tmp/parity-py.json", "utf8"));

const noop = () => {};
const sandbox = {
  console,
  JSON, Math, Date, Number, String, Object, Array, Set, Map, isFinite, parseFloat, parseInt,
  document: { addEventListener: noop, getElementById: () => null, querySelector: () => null,
              querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop } }),
              documentElement: { dataset: {}, style: { setProperty: noop } },
              body: { classList: { remove: noop, toggle: noop }, style: {}, appendChild: noop },
              activeElement: { tagName: "BODY" } },
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
const proj = Object.assign({}, __payload.project, { pages: __payload.pages });
var __result = calcProjectLocal(proj);
`;
sandbox.__payload = payload;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "combined.js" });
const r = sandbox.__result;

let fail = 0;
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1.0 : tol);
function check(name, js, pyv, tol) {
  const ok = close(Number(js), Number(pyv), tol);
  console.log(`${ok ? "✅" : "❌"} ${name}: js=${Number(js).toLocaleString("en-US", { maximumFractionDigits: 2 })} py=${Number(pyv).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
  if (!ok) { fail++; process.exitCode = 1; }
}

check("pages_cost", r.pages_cost, py.pages_cost);
check("installation_cost", r.installation_cost, py.installation_cost);
check("total_cost", r.total_cost, py.total_cost);
check("profit_amount", r.profit_amount, py.profit_amount);
check("gross_price", r.gross_price, py.gross_price);
check("discount_amount", r.discount_amount, py.discount_amount);
check("vat_amount", r.vat_amount, py.vat_amount);
check("final_price", r.final_price, py.final_price);

console.log("--- آمار فنی ---");
for (const k of Object.keys(py.stats)) {
  check(`stats.${k}`, r.stats[k], py.stats[k], 0.01);
}

console.log("--- جمع گروه‌ها ---");
const groups = {};
for (const it of r.items) groups[it.group] = (groups[it.group] || 0) + it.amount;
const allKeys = new Set([...Object.keys(groups), ...Object.keys(py.groups)]);
for (const k of allKeys) {
  check(`group «${k}»`, groups[k] || 0, py.groups[k] || 0, 1.0);
}

console.log(fail ? `\n❌ ${fail} اختلاف` : "\nموتور JS == موتور پایتون ✅");
