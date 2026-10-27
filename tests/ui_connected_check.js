/* تست یکپارچه‌ی رابط وب + سرویس‌دهنده‌ی واقعی پایتون (حالت متصل):
   - ساخت/ذخیره‌ی پروژه از طریق API
   - به‌روزرسانی قیمت متریال از طریق رابط → بازمحاسبه‌ی خودکار پروژه
   - شبیه‌سازی «پروژه‌ی مانده با نرخ قدیمی» پس از به‌روزرسانی نرم‌افزار
     (ری‌استارت سرویس + تغییر مستقیم پایگاه‌داده) → بنر هشدار → بازمحاسبه
   اجرا:  node tests/ui_connected_check.js   (نیاز به jsdom) */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) {
  try { JSDOM = require(path.join(__dirname, "..", "..", "jsdom-test", "node_modules", "jsdom")).JSDOM; }
  catch (e2) { console.log("SKIP: jsdom not installed"); process.exit(0); }
}

const ROOT = path.join(__dirname, "..");
const PORT = 8197;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "kabir-ui-e2e-"));

let fail = 0;
function check(name, cond, extra) {
  console.log(`${cond ? "✅" : "❌"} ${name}${cond ? "" : "  →  " + (extra === undefined ? "" : extra)}`);
  if (!cond) { fail++; process.exitCode = 1; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const py = process.env.PYTHON || "python3";
  const proc = spawn(py, ["main.py", "--port", String(PORT), "--no-browser", "--quiet"], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { KABIR_DATA_DIR: TMP, PYTHONIOENCODING: "utf-8" }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errBuf = "";
  proc.stderr.on("data", (d) => (errBuf += d));
  proc.on("exit", () => { if (errBuf) console.error("[server stderr]", errBuf.slice(-800)); });
  return proc;
}

async function waitHealth(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 20000)) {
    try {
      const r = await fetch(BASE + "/api/health");
      const j = await r.json();
      if (j && j.ok) return true;
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  return false;
}

function sqliteExec(sql) {
  execFileSync(process.env.PYTHON || "python3", ["-c",
    `import sqlite3,os;db=os.path.join(${JSON.stringify(TMP)}, "kabir.db");` +
    `c=sqlite3.connect(db);c.executescript(${JSON.stringify(sql)});c.commit();c.close()`],
    { stdio: "inherit" });
}

(async () => {
  /* --- راه‌اندازی سرویس‌دهنده --- */
  let server = startServer();
  if (!(await waitHealth())) { console.error("server failed to start"); process.exit(1); }

  const html = fs.readFileSync(path.join(ROOT, "webui/index.html"), "utf8");
  const dom = new JSDOM(html, { url: BASE + "/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;
  window.Element.prototype.scrollIntoView = function () {};
  window.scrollTo = () => {};
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false });
  window.AbortController = AbortController;
  /* fetch نسبی → مطلق (node fetch فقط مطلق قبول می‌کند) */
  window.fetch = (u, o) => fetch(typeof u === "string" ? new URL(u, BASE) : u, o);

  const jsCode = ["data.js", "engine.js", "ui.js"]
    .map((f) => fs.readFileSync(path.join(ROOT, "webui/js", f), "utf8"))
    .join("\n") + `
;window.__k = {
  init, navigate, openProjectEditor, curPage, renderEditorTables, renderAll,
  get API() { return API; },
  get MATERIALS() { return MATERIALS; },
  get PROJECTS() { return PROJECTS; },
  get DASH() { return DASH; },
};`;
  window.eval(jsCode);
  const K = window.__k;

  const click = (elm) => elm.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const type = (elm, value) => { elm.value = value; elm.dispatchEvent(new window.Event("input", { bubbles: true })); };

  await K.init();
  await sleep(400);
  check("connected to real server", K.API.ok === true);
  check("materials bootstrapped from server", K.MATERIALS.length > 50, String(K.MATERIALS.length));

  /* --- ساخت پروژه با یک یونیت واقعی از طریق API --- */
  const bodyMat = K.MATERIALS.find((m) => m.cat === "body_sheet");
  const created = await K.API.req("POST", "/api/projects", { title: "پروژه‌ی تست متصل", customer: "مشتری" });
  const pid = created.project.id;
  const page = {
    name: "بخش ۱", style_id: 0,
    data: {
      name: "بخش ۱", style_id: 0,
      units: [{ label: "یونیت زمینی ۹۰", unit_type: "ground", qty: 1,
                length_cm: 90, height_cm: 72, depth_cm: 55, shelves: 1,
                body_id: bodyMat.id, doors: [], drawers: [] }],
      extras: [], services: [], detail_mode: "none", detail_rows: [],
      waste_percent: 10, overhead_percent: 0,
    },
  };
  const calc = await K.API.req("POST", "/api/calc", {
    project: { id: pid, profit_mode: "markup", profit_percent: 25 }, pages: [page] });
  check("server calc produced a price", calc.final_price > 0, String(calc.final_price));
  await K.API.req("PUT", `/api/projects/${pid}`, {
    title: "پروژه‌ی تست متصل", customer: "مشتری", status: "open",
    profit_mode: "markup", profit_percent: 25, install_mode: "none", install_value: 0,
    discount_percent: 0, discount_amount: 0, vat_enabled: false, vat_percent: 10,
    extra_fixed_amount: 0, final_price: calc.final_price, total_cost: calc.total_cost,
    pages: [page],
  });

  /* رفرش رابط (مثل F5) تا پروژه در فهرست بیاید */
  click(document.getElementById("btnRefresh"));
  await sleep(700);
  let proj = K.PROJECTS.find((p) => p.id === pid);
  check("project listed after refresh", !!proj);
  check("fresh project not stale", proj && proj.stale === false);
  const priceBefore = proj ? proj.final_price : 0;

  /* --- ویرایش قیمت متریال از طریق رابط کاربری --- */
  K.navigate("materials");
  await sleep(60);
  const editBtn = document.querySelector(`[data-edit-mat="${bodyMat.id}"]`);
  check("edit button found for material", !!editBtn);
  click(editBtn);
  await sleep(60);
  const newPrice = String(Math.round(bodyMat.price * 1.1));
  type(document.getElementById("mfPrice"), newPrice);
  check("price input shows grouping while typing", /[٬]/.test(document.getElementById("mfPrice").value),
        document.getElementById("mfPrice").value);
  click(document.getElementById("btnSaveMaterial"));
  await sleep(800);

  proj = K.PROJECTS.find((p) => p.id === pid);
  check("project auto-recalculated after material price update", proj.final_price > priceBefore,
        `${priceBefore} -> ${proj.final_price}`);
  check("project not stale after auto recalc", proj.stale === false);
  check("stale banner hidden when nothing stale", document.getElementById("staleBanner").hidden === true);

  /* --- شبیه‌سازی به‌روزرسانی نرم‌افزار: پروژه با نرخ قدیمی می‌ماند --- */
  server.kill("SIGTERM");
  await new Promise((r) => server.on("exit", r));
  sqliteExec(`
    UPDATE projects SET rates_rev = 0;
    UPDATE settings SET value = '9' WHERE key = 'prices_rev';
  `);
  server = startServer();
  if (!(await waitHealth())) { console.error("server restart failed"); process.exit(1); }

  click(document.getElementById("btnRefresh"));
  await sleep(700);
  proj = K.PROJECTS.find((p) => p.id === pid);
  check("project flagged stale after app update", proj && proj.stale === true);
  const banner = document.getElementById("staleBanner");
  check("stale warning banner visible", banner.hidden === false);
  check("stale count shown", document.getElementById("staleCount").textContent !== "۰",
        document.getElementById("staleCount").textContent);
  K.navigate("projects");
  await sleep(60);
  check("stale badge rendered in projects table", !!document.querySelector("#projectsTable .b-warn"));

  /* --- کلیک «بازمحاسبه‌ی همه‌ی پروژه‌ها» --- */
  click(document.getElementById("btnRecalcAll"));
  await sleep(800);
  proj = K.PROJECTS.find((p) => p.id === pid);
  check("recalc-all cleared staleness", proj && proj.stale === false);
  check("banner hidden after recalc-all", document.getElementById("staleBanner").hidden === true);
  check("badge removed from table", !document.querySelector("#projectsTable .b-warn"));

  /* --- افزودن یونیت با ابعاد پیش‌فرض از تنظیمات سرور --- */
  await K.API.req("PUT", "/api/settings", { settings: { unit_wall_height_cm: "80" } });
  click(document.getElementById("btnRefresh"));
  await sleep(600);
  K.openProjectEditor(pid);
  await sleep(150);
  const n0 = K.curPage().units.length;
  click(document.querySelector('[data-add="unit:wall"]'));
  await sleep(120);
  const u = K.curPage().units[n0];
  check("server-side unit defaults applied in editor", u && u.height_cm === 80 && u.depth_cm === 30,
        u ? JSON.stringify({ h: u.height_cm, d: u.depth_cm }) : "no unit");

  console.log(fail ? `\n❌ ${fail} بررسی ناموفق` : "\n✅ همه‌ی بررسی‌های حالت متصل پاس شدند");
  window.close();
  server.kill("SIGTERM");
  await sleep(200);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("CRASH:", e); process.exit(1); });
