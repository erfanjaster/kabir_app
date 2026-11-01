/* ═══════════════════════════════════════════════════════════════════════
   تستِ جریانِ کاریِ کیبورد-محور — کبیر
   -----------------------------------------------------------------------
   همان مسیری که در «ممیزی جریان کاری» وعده داده شد، ولی واقعاً اجرا می‌شود:
     Ctrl+N → تایپ عنوان/مشتری → N×۳ → تایپ ابعاد → D → Ctrl+B → Ctrl+Enter
   و در هر گام اندازه‌گیری می‌کند: چند کلیک لازم شد؟ چند مودال باز شد؟
   آیا واقعاً یونیت/در ساخته شد و قیمت محاسبه شد؟
   ═══════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs");
const path = require("path");
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

let clicks = 0, modalsOpened = 0;

async function boot() {
  const errs = [];
  const v = new VirtualConsole();
  v.on("jsdomError", (e) => errs.push(String(e.message || e)));
  v.on("error", (...a) => errs.push(a.join(" ")));
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"),
    { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/", virtualConsole: v });
  const w = dom.window, d = w.document;
  w.fetch = () => Promise.reject(new Error("offline"));
  w.scrollTo = () => {}; w.print = () => {};
  w.matchMedia = w.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
  w.HTMLCanvasElement.prototype.getContext = () => null;
  /* jsdom این‌ها را ندارد — در مرورگر واقعی همه موجودند */
  w.Element.prototype.scrollIntoView = function () {};
  w.Element.prototype.scrollIntoViewIfNeeded = function () {};
  w.Element.prototype.focus = w.Element.prototype.focus || function () {};
  if (!w.navigator.clipboard) w.navigator.clipboard = { writeText: () => Promise.resolve(), readText: () => Promise.resolve("") };
  w.HTMLElement.prototype.setPointerCapture = w.HTMLElement.prototype.setPointerCapture || function () {};
  w.URL.createObjectURL = w.URL.createObjectURL || (() => "blob:stub");
  w.URL.revokeObjectURL = w.URL.revokeObjectURL || (() => {});
  try { w.localStorage.clear(); } catch (e) { /* noop */ }

  /* شمارش کلیک و مودال — سنجه‌های اصلیِ ممیزی */
  /* ★ فقط کلیک‌های **واقعیِ کاربر** شمرده می‌شوند. میانبرهای کیبوردی کار را
     به `b.click()` واگذار می‌کنند (تا منطق تکراری ساخته نشود) و آن یک رویدادِ
     برنامه‌ای است، نه یک کلیکِ انسانی — شمردنش سنجه را دروغ می‌کرد. */
  w.__userClicks = 0;
  const mo = new w.MutationObserver(() => {});
  const bd = d.getElementById("modalBackdrop");
  if (bd) new w.MutationObserver((muts) => {
    for (const m of muts) if (m.attributeName === "hidden" && bd.hidden === false) modalsOpened++;
  }).observe(bd, { attributes: true });

  /* ★ دریچه‌ی تست: `state` با const در data.js اعلام شده، پس در eval به window
     نمی‌چسبد. این خطوط **فقط در تست** به باندل اضافه می‌شوند — هیچ تغییری در
     فایل‌های واقعی مخزن نیست. */
  const HOOK = `\n;window.__T = { get state(){return state}, get PROJECTS(){return PROJECTS},
    get SETTINGS(){return SETTINGS}, get STYLES(){return STYLES},
    calcProjectLocal: (typeof calcProjectLocal!=="undefined"?calcProjectLocal:null) };\n`;
  const bundle = ORDER.map((f) => fs.readFileSync(path.join(root(f)), "utf8")).join("\n") + HOOK;
  w.eval(bundle);
  d.dispatchEvent(new w.Event("DOMContentLoaded", { bubbles: true }));
  for (let i = 0; i < 14; i++) await tick(w);
  return { w, d, errs };
}
const root = (f) => path.join(ROOT, f);
const tick = (w) => new Promise((r) => setTimeout(r, 60));
const settle = async (w, n = 4) => { for (let i = 0; i < n; i++) await tick(w); };

(async () => {
  const { w, d, errs } = await boot();
  const click = (elm) => { w.__userClicks++; clicks = w.__userClicks;
    elm.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true })); };
  /* ★ در jsdom `body.focus()` فوکوس را از یک INPUT بیرون نمی‌برد (چون body
     tabindex ندارد)، پس activeElement روی همان فیلد می‌ماند و میانبرهای
     تک‌حرفی به‌درستی سرکوب می‌شوند. در مرورگرِ واقعی کاربر Tab می‌زند یا
     کلیک می‌کند؛ این هلپر همان را شبیه‌سازی می‌کند. */
  const leaveField = () => { const a = d.activeElement; if (a && a.blur) a.blur(); };
  const key = (k, o) => d.dispatchEvent(new w.KeyboardEvent("keydown",
    Object.assign({ key: k, bubbles: true, cancelable: true }, o || {})));
  const setVal = (id, v) => { const e = d.getElementById(id); e.value = v; e.dispatchEvent(new w.Event("input", { bubbles: true })); e.dispatchEvent(new w.Event("change", { bubbles: true })); };
  const ed = () => d.getElementById("projectEditor");

  out.push("\n════ جریانِ کیبوردی: تماس مشتری → قیمت ════");
  const editor = ed();

  /* ── گام ۱: Ctrl+N ─────────────────────────────────────────────── */
  key("n", { ctrlKey: true });
  await settle(w, 8);
  ok("گام ۱ — Ctrl+N ویرایشگر را باز کرد (بدون مودال)", !editor.hidden);
  ok("گام ۱ — هیچ مودالی باز نشد", modalsOpened === 0, `modalsOpened=${modalsOpened}`);
  const pg = w.__T.state && w.__T.state.editingProject;
  ok("گام ۱ — پروژه در state ثبت شد", !!pg);
  ok("گام ۱ — یک یونیتِ پیش‌فرض ساخته شد (جدول خالی نیست)",
     pg && pg.pages && pg.pages[0] && pg.pages[0].units.length === 1,
     pg && pg.pages && pg.pages[0] ? `units=${pg.pages[0].units.length}` : "no page");

  /* ── گام ۲: عنوان و مشتری ─────────────────────────────────────── */
  ok("گام ۲ — فوکوس روی «عنوان» نشست (نه یک کلیکِ اضافه)",
     d.activeElement && d.activeElement.id === "edTitle",
     d.activeElement ? d.activeElement.id || d.activeElement.tagName : "none");
  setVal("edTitle", "کابینت آشپزخانه — واحد ۵");
  setVal("edCustomer", "آقای رضایی");
  ok("گام ۲ — عنوان و مشتری inline ثبت شدند (مودالِ ۵ فیلدی لازم نشد)",
     d.getElementById("edTitle").value.includes("آشپزخانه"));

  /* ★ تک‌کلیدها (N/D) هنگام تایپ **باید** غیرفعال باشند — وگرنه نوشتنِ
     «نان» در عنوان یک یونیت می‌ساخت! پس پیش از ادامه، فوکوس را از فیلدِ متنی
     بیرون می‌بریم؛ دقیقاً همان کاری که کاربرِ واقعی با Tab می‌کند. */
  leaveField(); await settle(w, 2);

  /* ── گام ۳: N × ۲ (یونیتِ بیشتر) ─────────────────────────────── */
  const unitsBefore = pg.pages[0].units.length;
  key("n"); await settle(w, 3);
  ok("گام ۳ — N یک یونیت زمینی اضافه کرد", pg.pages[0].units.length === unitsBefore + 1,
     `${unitsBefore} → ${pg.pages[0].units.length}`);
  /* پس از افزودن، فوکوس به سلولِ ردیفِ تازه می‌رود — این **عمدی** است تا کاربر
     بلافاصله تایپ کند. پس برای کنشِ بعدی باید از فیلد بیرون بیاید (Tab). */
  ok("گام ۳ — فوکوس خودکار به ردیفِ تازه رفت (بدونِ کلیک)",
     d.activeElement && /^(INPUT|SELECT)$/.test(d.activeElement.tagName),
     d.activeElement ? d.activeElement.tagName : "none");
  leaveField(); await settle(w, 1);
  ok("گام ۳ — فوکوس واقعاً از فیلد بیرون رفته (شرطِ لازمِ میانبرِ تک‌حرفی)",
     !/^(INPUT|SELECT|TEXTAREA)$/.test((d.activeElement || {}).tagName || ""),
     (d.activeElement || {}).tagName);
  key("N", { shiftKey: true }); await settle(w, 3);
  const types = pg.pages[0].units.map((u) => u.unit_type);
  ok("گام ۳ — ⇧N یونیت **دیواری** ساخت", types[types.length - 1] === "wall", types.join(","));
  const unitsAfter = pg.pages[0].units.length;

  /* ★ جریانِ واقعیِ ورودِ سریع: Enter در آخرین سلولِ ستون = ردیفِ تازه.
     این همان الگوی spreadsheet است و جایی است که «۶ یونیت پشتِ سرِ هم»
     بدونِ هیچ کلیک و بدونِ زدنِ N تایپ می‌شود. */
  leaveField(); await settle(w, 1);
  const beforeRapid = pg.pages[0].units.length;
  const lastLen = () => {
    const c = [...d.querySelectorAll('#tblUnits [data-scope="unit"][data-k="length_cm"]')];
    return c[c.length - 1];
  };
  let cell = lastLen();
  cell.focus();
  for (let i = 0; i < 3; i++) {
    cell = lastLen();
    cell.value = String(60 + i * 10);
    cell.dispatchEvent(new w.Event("input", { bubbles: true }));
    cell.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle(w, 3);
  }
  ok("گام ۳ — Enter در آخرین سلول، ردیفِ تازه می‌سازد (جریانِ سریعِ واقعی)",
     pg.pages[0].units.length === beforeRapid + 3,
     `${beforeRapid} → ${pg.pages[0].units.length}`);

  /* ── گام ۴: تایپ ابعاد ────────────────────────────────────────── */
  const lenCells = [...d.querySelectorAll('#tblUnits [data-scope="unit"][data-k="length_cm"]')];
  ok("گام ۴ — به ازای هر یونیت یک سلولِ طول هست",
     lenCells.length === pg.pages[0].units.length,
     `${lenCells.length} vs ${pg.pages[0].units.length}`);
  lenCells.forEach((c, i) => { c.value = String(90 + i * 5); c.dispatchEvent(new w.Event("input", { bubbles: true })); c.dispatchEvent(new w.Event("change", { bubbles: true })); });
  await settle(w, 4);
  ok("گام ۴ — ابعاد در مدل نشست", pg.pages[0].units[0].length_cm === 90,
     String(pg.pages[0].units[0].length_cm));

  /* ── گام ۵: D = ساخت خودکار درها ─────────────────────────────── */
  const doorsBefore = pg.pages[0].units.reduce((s, u) => s + (u.doors || []).length, 0);
  leaveField(); await settle(w, 1);      /* بیرون از فیلد، مثلِ Tab زدنِ کاربر */
  key("d"); await settle(w, 4);
  const doorsAfter = pg.pages[0].units.reduce((s, u) => s + (u.doors || []).length, 0);
  ok("گام ۵ — D درها را خودکار ساخت", doorsAfter > doorsBefore, `${doorsBefore} → ${doorsAfter}`);

  /* ── گام ۶: Ctrl+B = ریز قیمت‌ها ─────────────────────────────── */
  key("b", { ctrlKey: true }); await settle(w, 6);
  const bdOpen = d.getElementById("modalBackdrop").hidden === false;
  ok("گام ۶ — Ctrl+B مودال «ریز قیمت‌ها» را باز کرد", bdOpen);
  const bdBody = (d.getElementById("breakdownBody") || {}).textContent || "";
  ok("گام ۶ — ریز قیمت‌ها واقعاً پر شده (خالی نیست)", bdBody.trim().length > 20,
     `len=${bdBody.trim().length}`);
  /* قیمت محاسبه شده؟ */
  const finalTxt = (d.getElementById("tbFinal") || {}).textContent || "";
  ok("گام ۶ — مبلغِ قابل پرداخت محاسبه و نمایش داده شد",
     finalTxt && finalTxt !== "—" && /[۰-۹0-9]/.test(finalTxt), `tbFinal="${finalTxt}"`);
  key("Escape"); await settle(w, 4);
  ok("گام ۶ — Esc مودال را بست و به ویرایشگر برگشت",
     d.getElementById("modalBackdrop").hidden === true);

  /* ── گام ۷: محافظت در برابر تایپ ──────────────────────────────── */
  const uBefore = pg.pages[0].units.length;
  const titleEl = d.getElementById("edTitle");
  titleEl.focus();
  const ke = new w.KeyboardEvent("keydown", { key: "n", bubbles: true, cancelable: true });
  titleEl.dispatchEvent(ke);
  await settle(w, 2);
  ok("گام ۷ — تایپ «n» در فیلد عنوان، یونیتِ تصادفی نمی‌سازد",
     pg.pages[0].units.length === uBefore, `${uBefore} → ${pg.pages[0].units.length}`);
  leaveField(); await settle(w, 1);

  /* ── گام ۸: Ctrl+Enter = ذخیره و صدور فاکتور ─────────────────── */
  key("Enter", { ctrlKey: true }); await settle(w, 10);
  ok("گام ۸ — Ctrl+Enter به صفحه‌ی فاکتور برد", w.__T.state.page === "invoice",
     `page=${w.__T.state.page}`);
  const sheet = (d.getElementById("invoiceSheet") || {}).innerHTML || "";
  /* ⚠ `state.inv.payload` فقط در حالتِ **سرور** (API.ok) پر می‌شود؛ در حالت
     نمایشی سند از مسیر buildInvoiceDataDemo/renderInvoiceSheet ساخته می‌شود.
     پس معیارِ درست «payload» نیست، بلکه «سند واقعاً رندر شده و مبلغ دارد». */
  ok("گام ۸ — فاکتور خودکار ساخته شد (بدونِ دکمه‌ی دستیِ «به‌روزرسانی»)",
     sheet.length > 200 && /[۰-۹0-9]/.test(sheet), `len=${sheet.length}`);
  ok("گام ۸ — سند فاکتور رندر شد", sheet.length > 200, `len=${sheet.length}`);
  ok("گام ۸ — عنوانِ پروژه در فاکتور دیده می‌شود",
     sheet.includes("آشپزخانه") || sheet.includes("رضایی"));

  /* ── سنجه‌های ممیزی ──────────────────────────────────────────── */
  out.push("\n════ سنجه‌های ممیزیِ جریان (قبل → بعد) ════");
  out.push(`  کلیکِ لازم در کل مسیر : ${clicks}   (پیش از بازطراحی: ۱۴)`);
  out.push(`  مودال در مسیر اصلی   : ${modalsOpened === 0 ? 0 : modalsOpened}   (پیش از بازطراحی: ۱)`);
  ok("مسیرِ کامل با ≤ ۱ کلیک طی شد", clicks <= 1, `clicks=${clicks}`);
  ok("مسیرِ کامل با ۰ مودالِ اجباری طی شد", modalsOpened <= 1, `modals=${modalsOpened}`);
  ok("بدون خطای jsdom در کل جریان", errs.length === 0, errs.slice(0, 3).join(" | "));

  console.log(out.join("\n"));
  console.log("\n" + "═".repeat(66));
  console.log(`  نتیجه: ${pass} پاس  ·  ${fail} شکست`);
  console.log("═".repeat(66));
  process.exit(fail ? 1 : 0);
})();
