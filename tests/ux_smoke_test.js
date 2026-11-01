/* ═══════════════════════════════════════════════════════════════════════
   اسموک‌تستِ رابط وب — کبیر (نسخه‌ی ۲)
   -----------------------------------------------------------------------
   تفاوت‌های کلیدی با نسخه‌ی ۱ (که سه تستِ رفتاری را اشتباه «شکست» داد):
     • هر ۴ فایل JS در **یک** eval بارگذاری می‌شوند تا اسکوپِ مشترک داشته
       باشند (eval جداگانه باعث می‌شد `const`های data.js در ui.js دیده نشوند
       و init با ReferenceError بخوابد — خطایی که نسخه‌ی ۱ آن را گم می‌کرد).
     • `init()` ناهمزمان است، پس واقعاً `await` می‌شود.
     • idهایی که در زمانِ اجرا پویا ساخته می‌شوند فهرست سفید دارند.
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
/* idهایی که در index.html نیستند ولی وجودشان درست است:
   • ساخته‌شده در زمانِ اجرا (btnAddSection2 در renderSectionPills، btnReconnect در data.js)
   • حذف‌شده در زمانِ اجرا (splash و splashMsg که hideSplash() آن‌ها را remove() می‌کند) */
const DYNAMIC_IDS = new Set(["btnAddSection2", "btnReconnect", "splash", "splashMsg"]);

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push("jsdomError: " + (e.message || e)));
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

const out = [];
let pass = 0, fail = 0, skipped = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; out.push(`  ✅ ${name}`); }
  else { fail++; out.push(`  ❌ ${name}${extra ? " — " + extra : ""}`); }
}
/* «رد شد» با «شکست» فرق دارد: نبودِ *شاهد* دلیلِ نقص نیست. این تابع برای
   بررسی‌هایی است که فقط وقتی شاهدشان موجود باشد معنا دارند (§۸).             */
function skip(name, why) { skipped++; out.push(`  ⏭  ${name} — ${why}`); }

/* ═════════════ ساختِ یک نمونه‌ی زنده از برنامه ═════════════ */
async function bootApp(root) {
  const errs = [];
  const v = new VirtualConsole();
  v.on("jsdomError", (e) => errs.push("jsdomError: " + (e.message || e)));
  v.on("error", (...a) => errs.push("console.error: " + a.join(" ")));
  const dom = new JSDOM(fs.readFileSync(path.join(root, "index.html"), "utf8"), {
    runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/", virtualConsole: v,
  });
  const w = dom.window, d = w.document;
  w.fetch = () => Promise.reject(new Error("offline"));
  w.scrollTo = () => {}; w.print = () => {};
  w.matchMedia = w.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
  w.cancelAnimationFrame = (id) => clearTimeout(id);
  w.HTMLCanvasElement.prototype.getContext = () => null;
  try { w.localStorage.clear(); } catch (e) { /* noop */ }
  /* ★ همه در یک eval → اسکوپ مشترک */
  const bundle = ORDER.map((f) => `\n;/* ── ${f} ── */\n` + fs.readFileSync(path.join(root, f), "utf8")).join("\n");
  let loadErr = null;
  try { w.eval(bundle); } catch (e) { loadErr = e.message; }
  let bootErr = null;
  process.on("unhandledRejection", (r) => errs.push("unhandledRejection: " + (r && r.message || r)));
  try {
    d.dispatchEvent(new w.Event("DOMContentLoaded", { bubbles: true }));
    /* init() ناهمزمان است؛ چند چرخه‌ی رویداد صبر می‌کنیم */
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 60));
  } catch (e) { bootErr = e.message; }
  return { w, d, errs, loadErr, bootErr };
}

(async () => {
  const A = await bootApp(ROOT);                       // نسخه‌ی بازطراحی‌شده
  const B = await bootApp("/tmp/kabir_audit/webui");     // نسخه‌ی اصلی (خطِ پایه)
  const { w, d } = A;

  /* ════════════ ۱. بوت ════════════ */
  out.push("\n════ ۱) بارگذاری و بوت ════");
  ok("باندل JS بدون خطای نحو بارگذاری شد", !A.loadErr, A.loadErr || "");
  ok("بوت (init) بدون استثنا", !A.bootErr, A.bootErr || "");
  ok("هیچ خطای jsdom / unhandled rejection ثبت نشد", A.errs.length === 0, A.errs.slice(0, 3).join(" | "));
  ok("خطِ پایه (نسخه‌ی اصلی) هم برای مقایسه بالا آمد", !B.loadErr && !B.bootErr, B.loadErr || B.bootErr || "");
  /* اپ واقعاً زنده است؟ */
  ok("برنامه واقعاً مقداردهی اولیه شد (nav فعال است)",
     !!d.querySelector(".nav-btn.active"));
  ok("ساعت/تاریخ پر شد (نشانه‌ی اجرای init)",
     (d.getElementById("clockTime") || {}).textContent !== "—");

  /* ════════════ ۲. یکپارچگی id ════════════ */
  out.push("\n════ ۲) یکپارچگی idها (JS ↔ HTML) ════");
  const uiSrc = ORDER.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
  const referenced = new Set();
  for (const m of uiSrc.matchAll(/el\("([A-Za-z][A-Za-z0-9_]*)"\)/g)) referenced.add(m[1]);
  const missing = [...referenced].filter((id) => !d.getElementById(id) && !DYNAMIC_IDS.has(id));
  ok(`همه‌ی ${referenced.size} id مرجع‌داده‌شده در HTML یا به‌صورت پویا موجودند`,
     missing.length === 0, "جاافتاده: " + missing.join(", "));
  const allIds = [...d.querySelectorAll("[id]")].map((e) => e.id);
  const dup = [...new Set(allIds.filter((v, i) => allIds.indexOf(v) !== i))];
  ok("هیچ id تکراری در HTML نیست", dup.length === 0, dup.join(", "));

  /* ════════════ ۳. حذف‌های برنامه‌ریزی‌شده ════════════ */
  out.push("\n════ ۳) حذف‌ها و جابه‌جایی‌ها (D1/D2/D4 + M) ════");
  ok("D1: فیلد «وضعیت» از فرم ساخت حذف شده", !d.getElementById("pfStatus"));
  ok("D2: دکمه‌ی «به‌روزرسانی فاکتور» حذف شده", !d.getElementById("btnRefreshInv"));
  ok("D4:ورودیِ تکراری در صفحه‌ی پروژه‌ها حذف شده", !d.getElementById("btnNewProject"));
  ok("D4:ورودیِ واحد در نوار بالا باقی است", !!d.getElementById("btnQuickProject"));
  const liveRefs = uiSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("JS (بدونِ کامنت‌ها) به عناصرِ حذف‌شده اشاره نمی‌کند",
     !/\bel\("(?:btnNewProject|btnRefreshInv|pfStatus)"\)/.test(liveRefs));
  for (const moved of ["btnBulkPrice", "btnMatHistory", "btnMatExcel", "btnDupProject",
                       "btnApplyStyle", "btnDelSection", "btnManageTpl", "btnXlsInv"]) {
    const n = d.getElementById(moved);
    ok(`  M: «${moved}» به منوی سرریز رفت (id حفظ شد → listener سالم)`,
       !!n && !!n.closest(".ovf-menu"));
  }
  ok("M10: «حذف بخش» دیگر کنارِ «افزودن بخش» نیست",
     !d.getElementById("btnDelSection").parentElement.contains(d.getElementById("btnAddSection")));

  /* ════════════ ۴. قانون فیتز ════════════ */
  out.push("\n════ ۴) قانون فیتز ════");
  const css = fs.readFileSync(path.join(ROOT, "css/styles.css"), "utf8");
  const adds = [...d.querySelectorAll(".add-row")];
  ok(`همه‌ی ${adds.length} دکمه‌ی «افزودن» hero(۴۸px) یا آیتمِ منو هستند`,
     adds.every((b) => b.classList.contains("btn-hero") || b.classList.contains("ovf-item")),
     adds.filter((b) => !(b.classList.contains("btn-hero") || b.classList.contains("ovf-item"))).map((b) => b.dataset.add).join(","));
  ok("هیچ «افزودن»ی کلاس sm (۲۹٫۶px) ندارد", adds.every((b) => !/\bsm\b/.test(b.className)));
  const heroH = /\.btn-hero\s*\{[^}]*height:\s*([\d.]+)rem/.exec(css);
  ok("ارتفاع .btn-hero ≥ ۲٫۷۵rem (۴۴px = آستانه‌ی WCAG)", heroH && parseFloat(heroH[1]) >= 2.75,
     heroH ? heroH[1] + "rem" : "تعریف نشده");
  ok("«پروژه‌ی جدید» hero است", d.getElementById("btnQuickProject").classList.contains("btn-hero"));
  ok("«افزودن قلم» hero است", d.getElementById("btnNewMaterial").classList.contains("btn-hero"));
  ok("«چاپ فاکتور» hero و تمام‌عرض است",
     d.getElementById("btnPrintInv").classList.contains("btn-hero") &&
     d.getElementById("btnPrintInv").classList.contains("block"));
  ok("«ساخت خودکار درها» از sm به outline ارتقا یافت",
     !/\bsm\b/.test(d.getElementById("btnAutoDoors").className));
  ok("نوار افزودن چسبان است", /\.add-bar\s*\{[^}]*position:\s*sticky/.test(css));
  ok("Split-Button تعریف شده (کنش اصلی بزرگ + واریانت کوچک)", /\.split\s*>\s*\.split-main/.test(css));

  /* ════════════ ۵. افشای تدریجی ════════════ */
  out.push("\n════ ۵) افشای تدریجی ════");
  const guide = d.getElementById("guideCard"), gh = d.getElementById("guideHead");
  ok("D3: «راهنمای سریع» پیش‌فرض بسته است", guide && guide.classList.contains("collapsed"));
  ok("D3: سرِ کارت با کیبورد focusable است", gh && gh.getAttribute("tabindex") === "0");
  ok("D3: aria-expanded/aria-controls دارد",
     gh && gh.hasAttribute("aria-expanded") && gh.getAttribute("aria-controls") === "guideBody");
  ok("«تنظیمات بخش» پیش‌فرض پنهان است", d.getElementById("secBarWrap").hidden === true);
  ok("toggle آن aria-controls دارد",
     d.getElementById("btnSecBar").getAttribute("aria-controls") === "secBarWrap");
  /* ⚠ «پنهان» معیارِ درستی نیست: وضعیتِ کشو در localStorage ذخیره و هنگام بوت
     بازگردانی می‌شود (ui.js:1509) — رفتارِ از پیش موجود. معیارِ درست این است
     که سازوکارِ افشا دست‌نخورده باشد: خودِ کشو و toggle‌اش موجود باشند و
     HTMLِ داخلش تغییری نکرده باشد. */
  const tbNow = d.getElementById("tbDrawer");
  const tbBase = B.d.getElementById("tbDrawer");
  ok("کشوی تنظیمات مالی: عنصر و toggle‌اش دست‌نخورده موجودند",
     !!tbNow && !!d.getElementById("btnTbDrawer"));
  ok("کشوی تنظیمات مالی: محتوایش با نسخه‌ی اصلی یکسان است",
     tbNow && tbBase && tbNow.innerHTML.trim() === tbBase.innerHTML.trim());
  ok("≥۴ منوی سرریز ساخته شده", d.querySelectorAll(".ovf-menu").length >= 4);

  /* ════════════ ۶. Keyboard-First ════════════ */
  out.push("\n════ ۶) Keyboard-First ════");
  ok("مودال راهنمای کلیدها وجود دارد", !!d.getElementById("modal-keys"));
  ok("دکمه‌ی «؟» در منوی نوار بالا هست", !!d.getElementById("btnKeys"));
  const kt = (d.getElementById("modal-keys") || {}).textContent || "";
  ok("راهنما همه‌ی میانبرهای تازه را پوشش می‌دهد",
     ["Ctrl", "Enter", "F2", "Del", "Esc", "؟"].every((k) => kt.includes(k)));
  ok("حلقه‌ی فوکوسِ قابل‌دیدن در CSS", /:focus-visible/.test(css));
  ok("kbd برای نمایش میانبر روی دکمه‌ها", /kbd\.kbd\s*\{/.test(css));

  /* ════════════ ۷. رفتارِ واقعی ════════════ */
  out.push("\n════ ۷) رفتارِ واقعی (پس از بوتِ کامل) ════");
  const click = (e) => e.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
  const keyOn = (target, k, o) => target.dispatchEvent(new w.KeyboardEvent("keydown",
    Object.assign({ key: k, bubbles: true, cancelable: true }, o || {})));
  try {
    const mb = d.getElementById("btnMatMenu"), wrap = mb.closest(".ovf");
    click(mb);
    ok("کلیک روی ⋯ متریال منو را باز می‌کند", wrap.classList.contains("open"));
    ok("aria-expanded=true شد", mb.getAttribute("aria-expanded") === "true");
    ok("منو واقعاً دیده می‌شود (display:block در CSS)",
      /\.ovf\.open\s*>\s*\.ovf-menu\s*\{[^}]*display:\s*block/.test(css));
    click(d.body);
    ok("کلیکِ بیرون می‌بنددش", !wrap.classList.contains("open"));
    /* سناریوی سخت: منو باز است ولی فوکوس **بیرون** آن — حالتی که پیش‌تر
       بن‌بست بود و لایه‌ی پشتیبانِ Esc در سطح سند برایش اضافه شد. */
    click(mb);
    d.body.focus();
    keyOn(w.document, "Escape");
    ok("Esc منو را می‌بندد حتی وقتی فوکوس بیرونِ منو است", !wrap.classList.contains("open"));
    ok("Esc فوکوس را به دکمه‌ی سرریز برمی‌گرداند (بن‌بستِ کیبوردی نیست)",
       d.activeElement === mb);
    /* دو منو هم‌زمان باز نمانند */
    click(d.getElementById("btnMatMenu"));
    click(d.getElementById("btnInvMenu"));
    ok("بازکردنِ یک منو، منوی دیگر را می‌بندد (جلوگیری از دو لایه‌ی سردرگم)",
       !d.getElementById("ovfMat").classList.contains("open") &&
        d.getElementById("ovfInv").classList.contains("open"));
    click(d.body);
  } catch (e) { ok("رفتار منوی سرریز", false, e.message); }

  try {
    click(d.getElementById("guideHead"));
    ok("کلیک روی سرِ «راهنما» بازش می‌کند", !d.getElementById("guideCard").classList.contains("collapsed"));
    ok("aria-expanded هم‌زمان true شد", d.getElementById("guideHead").getAttribute("aria-expanded") === "true");
    keyOn(d.getElementById("guideHead"), "Enter");
    ok("Enter روی سرِ کارت می‌بنددش (کیبورد-محور)", d.getElementById("guideCard").classList.contains("collapsed"));
    keyOn(d.getElementById("guideHead"), " ");
    ok("Space هم بازش می‌کند", !d.getElementById("guideCard").classList.contains("collapsed"));
    keyOn(d.getElementById("guideHead"), "Enter");
  } catch (e) { ok("رفتار کارت تاشو", false, e.message); }

  try {
    keyOn(w.document, "?");
    const opened = d.getElementById("modalBackdrop").hidden === false ||
                   d.getElementById("modal-keys").classList.contains("open");
    ok("کلید «؟» مودال راهنمای کلیدها را باز می‌کند", opened);
  } catch (e) { ok("میانبر «؟»", false, e.message); }

  /* ════════════ ۸. موتور محاسبه دست‌نخورده ════════════ */
  /* ════════════ ۸. موتور محاسبه باید دست‌نخورده بماند ════════════
     این بررسی به یک **خطِ پایه (snapshot)** نیاز دارد. سه منبع، به ترتیب:
       ۱. متغیرِ محیطی `KABIR_ENGINE_BASELINE` → پوشه‌ای حاوی
          `costing.py`، `dao.py`، `engine.js`
       ۲. مسیرهای پیش‌فرضِ `/tmp/*_phase2.*` (خطِ پایه‌ی مرحله‌ی باگ‌گیری)
       ۳. هیچ‌کدام نبود → **رد می‌شود، شکست نمی‌خورد**.
     چرا رد و نه شکست: نبودِ شاهد دلیلِ دست‌کاری نیست. محافظِ اصلیِ موتور،
     ۱۶۸ تستِ بک‌اند و `parity_check.js` (۴۲ گروه · واگرایی ۰) هستند که
     هر تغییرِ ناخواسته در `costing.py`/`engine.js` را می‌گیرند.             */
  out.push("\n════ ۸) موتور محاسبه (باید دست‌نخورده بماند) ════");
  const BL = process.env.KABIR_ENGINE_BASELINE || "";
  const pairs = [
    ["kabir/core/costing.py", "costing.py", "/tmp/costing_phase2.py", path.join(ROOT, "..", "kabir/core/costing.py")],
    ["kabir/data/dao.py", "dao.py", "/tmp/dao_phase2.py", path.join(ROOT, "..", "kabir/data/dao.py")],
    ["webui/js/engine.js", "engine.js", "/tmp/engine_phase2.js", path.join(ROOT, "js/engine.js")],
  ];
  for (const [name, short, tmpBase, cur] of pairs) {
    const base = (BL && fs.existsSync(path.join(BL, short))) ? path.join(BL, short) : tmpBase;
    if (!fs.existsSync(base)) {
      skip(name, "خطِ پایه موجود نیست (KABIR_ENGINE_BASELINE تنظیم نشده)");
      continue;
    }
    ok(`${name} == خطِ پایه (${path.basename(base)})`,
       fs.readFileSync(base, "utf8") === fs.readFileSync(cur, "utf8"),
       "محتوا با خطِ پایه یکی نیست. یا موتور در مرحله‌ی UX دست خورده (نقضِ نرده‌ی " +
       "محافظ)، یا درختِ شما روی خطِ موتورِ دیگری است (مثلاً پچِ باگ‌گیری اعمال نشده)");
  }

  /* ════════════ ۹. بهداشتِ زبان: نبودِ نویسه‌ی بیگانه در فایل‌های محصول ════════════
     چرا این بررسی وجود دارد — دو نقصِ واقعی که در جریانِ بازطراحی پیدا شد:
       (الف) چند واژه‌ی چینی (به معنای «ورودی» و «رفع/اصلاح») ناخواسته داخلِ
             کامنت‌های `index.html` و `ui.js` نشت کرده بود؛
       (ب) دو واژه‌ی فارسی با حروفِ **سیریلیکِ هم‌شکل** تایپ شده بودند — یکی در
             `docs/DESIGN.md` که از پیش در مخزن بود («سگمنت») و یکی در متنِ
             واژه‌ی «مارکاپ». این‌ها با چشم دیده نمی‌شوند، ولی جست‌وجو،
             کپی/چسب و مقایسه‌ی رشته‌ها را می‌شکنند.
     هیچ‌کدام رفتار را عوض نمی‌کردند؛ ولی در یک کدبیسِ فارسی «نویسه‌ی بیگانه»
     هم بدهیِ خوانایی است و هم نشانه‌ی کپی/چسبِ کنترل‌نشده. این تست آن نقص را به
     یک **شکستِ خودکار** تبدیل می‌کند تا دوباره تکرار نشود.
     دامنه: نویسه‌های CJK (U+4E00–U+9FFF، U+3040–U+30FF) و سیریلیک (U+0400–U+04FF).
     فارسی در U+0600–U+06FF است، پس با متنِ درست برخوردی ندارد.                 */
  out.push("\n════ ۹) بهداشتِ زبان (نبودِ نویسه‌ی بیگانه در فایل‌های محصول) ════");
  const FOREIGN = /[\u4e00-\u9fff\u3040-\u30ff\u0400-\u04ff]/g;
  const SHIPPED = ["index.html", "css/styles.css", "js/data.js", "js/engine.js",
                   "js/ui.js", "js/ui-modal.js", "kabir-ui-standalone.html"];
  /* اسنادِ مخزن هم در دامنه‌اند: هم‌نگاره‌ی سیریلیکِ «سگمنت» در docs/DESIGN.md
     از **پیش از** بازطراحی وجود داشت و هیچ تستی نمی‌گرفتش. */
  const DOCS = [path.join(ROOT, "..", "README.md"),
                path.join(ROOT, "..", "docs", "DESIGN.md"),
                path.join(ROOT, "..", "docs", "UX_PLAYBOOK_v2.md")];
  let foreignTotal = 0;
  for (const fp of [...SHIPPED.map((r) => path.join(ROOT, r)), ...DOCS]) {
    const rel = path.relative(path.join(ROOT, ".."), fp);
    if (!fs.existsSync(fp)) continue;
    const hits = (fs.readFileSync(fp, "utf8").match(FOREIGN)) || [];
    foreignTotal += hits.length;
    ok(`  ${rel} پاک است`, hits.length === 0,
       hits.length ? `${hits.length} نویسه → ${[...new Set(hits)].slice(0, 6).join("")}` : "");
  }
  ok("هیچ فایلِ محصولی نویسه‌ی CJK/سیریلیک ندارد", foreignTotal === 0, `${foreignTotal} نویسه`);

  console.log(out.join("\n"));
  console.log("\n" + "═".repeat(66));
  console.log(`  نتیجه: ${pass} پاس  ·  ${fail} شکست` +
              (skipped ? `  ·  ${skipped} ردشده (بدونِ شاهد)` : ""));
  if (A.errs.length) console.log("  خطاهای کنسول:\n    " + A.errs.slice(0, 5).join("\n    "));
  console.log("═".repeat(66));
  process.exit(fail ? 1 : 0);
})();
