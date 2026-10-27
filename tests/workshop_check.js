/* بررسی قابلیت‌های کارگاهیِ سمت مرورگر (engine.js + بخش‌های غیرDOMِ ui.js)
   اجرا:  node tests/workshop_check.js                                             */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const noop = () => {};
const stubEl = () => ({
  style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  dataset: {}, value: "", textContent: "", innerHTML: "", hidden: false, checked: false,
  addEventListener: noop, appendChild: noop, remove: noop, focus: noop, select: noop,
  querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  options: [], scrollIntoView: noop, disabled: false, title: "",
});

const sandbox = {
  console, JSON, Math, Date, Number, String, Object, Array, Set, Map, Boolean,
  isFinite, parseFloat, parseInt, RegExp, Error, Promise,
  document: {
    addEventListener: noop, getElementById: () => null, querySelector: () => null,
    querySelectorAll: () => [], createElement: () => stubEl(),
    documentElement: { dataset: {}, style: { setProperty: noop } },
    body: { classList: { remove: noop, toggle: noop, add: noop }, style: {}, appendChild: noop },
    activeElement: { tagName: "BODY" },
  },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  location: { protocol: "file:", hash: "", href: "" },
  history: { replaceState: noop },
  fetch: () => { throw new Error("no fetch"); },
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: noop,
  URL: { createObjectURL: () => "", revokeObjectURL: noop },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const code =
  fs.readFileSync(path.join(ROOT, "webui/js/data.js"), "utf8") + "\n" +
  fs.readFileSync(path.join(ROOT, "webui/js/engine.js"), "utf8") + "\n" +
  fs.readFileSync(path.join(ROOT, "webui/js/ui.js"), "utf8") + "\n" +
  `;loadDemoData();
   window.__t = { calcProjectLocal, buildCutListLocal, buildWorkshopLocal, doorLeafFitsSheet,
                  doorSheetCell,
                  summarizeSheetsLocal, buildShoppingLocal, shoppingGroupsLocal,
                  quickUnitsLocal, panelsOfUnit, leafWidth, leavesForLength,
                  fitDoorsToUnit, defaultUnit, defaultDoor, defaultDrawer,
                  defaultPage, applyStyleToPage, normalizeProject, matById,
                  MATERIALS: () => MATERIALS, STYLES: () => STYLES, SETTINGS: () => SETTINGS,
                  SHEET_KEYS: SHEET_ITEM_KEYS };`;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "combined.js" });
const T = sandbox.window.__t;

let fail = 0, pass = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; process.exitCode = 1; console.log(`  ❌ ${name}${extra ? " — " + extra : ""}`); }
}
const near = (a, b, t) => Math.abs(Number(a) - Number(b)) <= (t === undefined ? 0.05 : t);

/* ------------------------------------------------------------------ داده‌ی نمونه */
const MATS = T.MATERIALS();
const idOf = (n) => (MATS.find((m) => m.name === n) || {}).id || 0;
const MDF = idOf("ام‌دی‌اف سفید صدفی ۱۶ میل");
const FIBER = idOf("فیبر (MDF 3 میل) پشت سفید");
const HG = idOf("هایگلاس ایرانی ۱۶ میل");
const BAND = idOf("نوار PVC ۲۲ میل سفید");

function sampleProject() {
  const u = (label, type, L, H, D, qty, shelves, doors) => Object.assign(T.defaultUnit(type), {
    label, length_cm: L, height_cm: H, depth_cm: D, qty: qty || 1, shelves: shelves || 0,
    body_id: MDF, back_id: FIBER, banding_id: BAND, legs_per_unit: 4, pins_per_shelf: 4,
    doors: doors || [], drawers: [],
  });
  const door = (qty, w, h) => Object.assign(T.defaultDoor(), {
    qty, w_cm: w, h_cm: h, material_id: HG, banding_id: BAND,
    hinge_id: idOf("لولا آرام‌بند معمولی"), handle_id: idOf("دستگیره میله‌ای ۱۲٫۸ سانت"),
  });
  const pg = T.defaultPage(0, "بخش ۱");
  pg.units = [
    u("زمینی ۹۰", "ground", 90, 72, 55, 1, 1, [door(2, 44.5, 71.7)]),
    u("زمینی ۶۰", "ground", 60, 72, 55, 3, 1, [door(1, 59.1, 71.7)]),
    u("دیواری ۶۰", "wall", 60, 70, 30, 4, 1, [door(2, 29.5, 69.7)]),
    u("کمد ۶۰", "tall", 60, 220, 58, 1, 2, [door(2, 29.5, 219.7)]),
  ];
  pg.waste_percent = 10;
  return T.normalizeProject({ id: 1, code: "T-1", title: "تست", pages: [pg] });
}

/* ============================================================ ۱) تجمیع ورق */
console.log("\n— تجمیع ورق (مهم‌ترین اصلاح) —");
{
  const p = sampleProject();
  const r = T.calcProjectLocal(p);
  const bodyItems = r.items.filter((i) => i.key === "body_sheet");
  const totalArea = bodyItems.reduce((a, i) => a + i.area_sqm, 0);
  const sheetArea = (183 * 366) / 10000;
  const expectSheets = Math.ceil(totalArea / sheetArea);
  const gotSheets = bodyItems.reduce((a, i) => a + i.sheets, 0);
  ok("ورق بدنه یک‌بار گرد می‌شود (نه برای هر یونیت)",
     near(gotSheets, expectSheets, 0.01), `${gotSheets} در برابر انتظار ${expectSheets}`);
  ok("تعداد ورق از شمار ردیف‌ها کمتر است (تجمیع واقعی)",
     expectSheets < bodyItems.length, `${expectSheets} ورق برای ${bodyItems.length} یونیت`);
  const bodyCost = bodyItems.reduce((a, i) => a + i.amount, 0);
  const mat = T.matById(MDF);
  ok("جمع بهای ورق = تعداد ورق × قیمت ورق",
     near(bodyCost, expectSheets * mat.price, 1), `${bodyCost} vs ${expectSheets * mat.price}`);
  ok("qty ردیف‌ها بر حسب مترمربع است (خوانا در فاکتور)",
     bodyItems.every((i) => i.unit_label === "م²"));
  ok("amount هر ردیف = qty × unit_price",
     bodyItems.every((i) => near(i.amount, i.qty * i.unit_price, 1)));
  ok("total_sheets آمار با ردیف‌ها یکی است",
     near(r.stats.total_sheets, r.items.filter((i) => T.SHEET_KEYS.includes(i.key)).reduce((a, i) => a + i.sheets, 0), 0.01));
}

/* ============================================== ۲) جلوگیری از دوباره‌شماری صفحه */
console.log("\n— صفحه‌ی کابینت —");
{
  const p = sampleProject();
  p.pages[0].units.forEach((u) => { if (u.unit_type === "ground") u.countertop_id = idOf("صفحه ۵ سنت ایرانی") || idOf("صفحه ۵ سانت ایرانی"); });
  p.pages[0].countertop_lm = 4.2;
  const r = T.calcProjectLocal(p);
  const tops = r.items.filter((i) => i.key === "countertop");
  ok("با ورود «متر طول صفحه»، دیگر برای هر یونیت صفحه حساب نمی‌شود",
     tops.length === 1, `${tops.length} ردیف صفحه`);
  ok("همان متراژ کلی ملاک است", near(tops[0] ? tops[0].qty : 0, 4.2, 0.01));
}

/* ============================================ ۳-الف) «در از ورق بدنه» */
console.log("\n— در از ورق بدنه —");
{
  const BODY = MATS.find((m) => m.cat === "body_sheet");
  const DSHEET = MATS.find((m) => m.cat === "door_sheet");
  const mk = (fromBody, w, h, bodyId, doorMat) => {
    const dr = Object.assign(T.defaultDoor(), {
      qty: 2, w_cm: w === undefined ? 44.55 : w, h_cm: h === undefined ? 71.7 : h,
      material_id: doorMat === undefined ? DSHEET.id : doorMat,
      hinge_id: (MATS.find((m) => m.cat === "hinge") || {}).id || 0,
      hinges_per_leaf: 2,
      banding_id: (MATS.find((m) => m.cat === "banding") || {}).id || 0,
      from_body: !!fromBody,
    });
    const u = Object.assign(T.defaultUnit("ground"), {
      label: "زمینی ۹۰", length_cm: 90, height_cm: 72, depth_cm: 55, qty: 2,
      shelves: 1, body_id: bodyId === undefined ? BODY.id : bodyId,
      doors: [dr], drawers: [],
    });
    const pg = T.defaultPage(0, "بخش ۱");
    pg.units = [u]; pg.waste_percent = 10;
    return T.normalizeProject({ id: 5, title: "تست در", pages: [pg], profit_percent: 30 });
  };

  ok("امکان‌سنجی: لنگه‌ی ۴۴٫۵×۷۱٫۷ روی ورق ۱۸۳×۳۶۶ جا می‌شود",
     T.doorLeafFitsSheet({ w_cm: 44.5, h_cm: 71.7 }, BODY).ok === true);
  ok("امکان‌سنجی: لنگه‌ی ۲۰۰×۲۵۰ جا نمی‌شود",
     T.doorLeafFitsSheet({ w_cm: 200, h_cm: 250 }, BODY).ok === false);
  ok("امکان‌سنجی: بدون ورق بدنه رد می‌شود",
     T.doorLeafFitsSheet({ w_cm: 44.5, h_cm: 71.7 }, null).ok === false);

  const rOff = T.calcProjectLocal(mk(false));
  const rOn = T.calcProjectLocal(mk(true));
  ok("بدون تیک، ردیف «ورق در» هست", rOff.items.some((i) => i.key === "door_sheet"));
  ok("با تیک، ردیف «ورق در» حذف می‌شود", !rOn.items.some((i) => i.key === "door_sheet"));
  ok("با تیک، مساحت در به «ورق بدنه» می‌رود",
     rOn.items.filter((i) => i.key === "body_sheet").length === 2,
     String(rOn.items.filter((i) => i.key === "body_sheet").length));
  ok("با تیک ارزان‌تر می‌شود", rOn.total_cost < rOff.total_cost,
     `${Math.round(rOn.total_cost)} در برابر ${Math.round(rOff.total_cost)}`);
  const areaOff = rOff.items.filter((i) => T.SHEET_KEYS.includes(i.key))
    .reduce((a, i) => a + i.area_sqm, 0);
  const areaOn = rOn.items.filter((i) => T.SHEET_KEYS.includes(i.key))
    .reduce((a, i) => a + i.area_sqm, 0);
  ok("مساحتِ ورق گم نمی‌شود (فقط دسته‌اش عوض می‌شود)", near(areaOff, areaOn, 1e-6));
  ok("آمار مساحت در دست‌نخورده می‌ماند",
     near(rOff.stats.total_door_area, rOn.stats.total_door_area, 1e-9));
  ok("بدون تیک هشداری تولید نمی‌شود", (rOff.warnings || []).length === 0);

  const rBig = T.calcProjectLocal(mk(true, 200, 250));
  ok("لنگه‌ی بزرگ‌تر از ورق → تیک نادیده + هشدار",
     (rBig.warnings || []).length === 1 && rBig.warnings[0].includes("جا نمی‌شود"),
     JSON.stringify(rBig.warnings));
  ok("در حالت نادیده‌گرفتن، ورقِ در سرِ جایش می‌ماند",
     rBig.items.some((i) => i.key === "door_sheet"));
  const rNoBody = T.calcProjectLocal(mk(true, 44.55, 71.7, 0));
  ok("بدون ورق بدنه → هشدار", (rNoBody.warnings || []).length === 1);

  /* برش‌نامه هم باید همان ورق بدنه را نشان دهد */
  const cutOn = T.buildCutListLocal(mk(true));
  const cutOff = T.buildCutListLocal(mk(false));
  const lvOn = cutOn.filter((c) => c.part.includes("(لنگه)"));
  const lvOff = cutOff.filter((c) => c.part.includes("(لنگه)"));
  ok("برش‌نامه با تیک: لنگه در دسته‌ی ورق بدنه است",
     lvOn.length > 0 && lvOn.every((c) => c.mat_cat === "body_sheet"));
  ok("برش‌نامه با تیک: نام ورق، ورقِ بدنه است",
     lvOn.every((c) => c.material === BODY.name));
  ok("برش‌نامه با تیک: برچسب «از ورق بدنه» دارد",
     lvOn.every((c) => c.part.includes("از ورق بدنه")));
  ok("برش‌نامه بدون تیک: لنگه در دسته‌ی ورق در است",
     lvOff.every((c) => c.mat_cat === "door_sheet"));

  /* ★ بازگشتی: مساحت ردیف لنگه باید ضرب در «تعداد لنگه» باشد (پیش‌تر جا افتاده بود) */
  ok("مساحت لنگه = مساحت یک لنگه × تعداد لنگه",
     lvOff.every((c) => near(c.area_sqm, (44.55 / 100) * (71.7 / 100) * c.qty, 1e-6)),
     String(lvOff[0] && lvOff[0].area_sqm));
  /* خلاصه‌ی ورق: با تیک، یک ردیف (بدنه) نه دو تا */
  const packOn = T.buildWorkshopLocal(mk(true));
  const cats = packOn.sheet_summary.map((r) => r.cat);
  ok("خلاصه‌ی ورق با تیک: فقط ردیف ورق بدنه", cats.includes("body_sheet") && !cats.includes("door_sheet"),
     JSON.stringify(cats));
  const bodyRow = packOn.sheet_summary.find((r) => r.cat === "body_sheet");
  const cutArea = packOn.cut_parts.filter((c) => c.mat_cat === "body_sheet")
    .reduce((a, c) => a + c.area_sqm, 0);
  ok("مساحت خلاصه‌ی ورق = جمع مساحت قطعات برش‌نامه", near(bodyRow.area_sqm, cutArea, 1e-3),
     `${bodyRow.area_sqm} vs ${cutArea}`);
}

/* ====================================== ۳-ب) رندرِ سلول «ورق در» در رابط */
console.log("\n— سلول «ورق در» (تیک در رابط کاربری) —");
{
  const BODY = MATS.find((m) => m.cat === "body_sheet");
  const DSHEET = MATS.find((m) => m.cat === "door_sheet");
  const uOf = (bodyId) => ({ body_id: bodyId });
  const drOf = (fb, w, h, mat) => Object.assign(T.defaultDoor(), {
    qty: 2, w_cm: w, h_cm: h, material_id: mat, from_body: fb,
  });
  const cell = (u, dr) => T.doorSheetCell(u, dr, 0, 0);

  const c1 = cell(uOf(BODY.id), drOf(false, 44.55, 71.7, DSHEET.id));
  ok("حالت عادی: تیک هست و انتخاب متریال هم",
     c1.includes("fb-check") && c1.includes("data-k=\"from_body\"") && c1.includes("cell-select"));
  ok("حالت عادی: تیک نخورده", !/type="checkbox"[^>]*checked/.test(c1));
  ok("حالت عادی: بدون هشدار", !c1.includes("fb-note bad"));

  const c2 = cell(uOf(BODY.id), drOf(true, 44.55, 71.7, DSHEET.id));
  ok("با تیک: چک‌باکس فعال است", /type="checkbox"[^>]*checked/.test(c2));
  ok("با تیک: نام ورق بدنه نشان داده می‌شود", c2.includes(BODY.name));
  ok("با تیک: دیگر لیست متریالِ در نشان داده نمی‌شود",
     !c2.includes("data-k=\"material_id\""));
  ok("با تیک: یادداشت سبز دارد", c2.includes("fb-note ok"));

  const c3 = cell(uOf(BODY.id), drOf(true, 200, 250, DSHEET.id));
  ok("تیکِ ناممکن: هشدار قرمز نشان می‌دهد", c3.includes("fb-note bad") && c3.includes("جا نمی‌شود"));
  ok("تیکِ ناممکن: چک‌باکس غیرفعال می‌شود", c3.includes("disabled"));
  ok("تیکِ ناممکن: لیست متریال برمی‌گردد تا کاربر درستش کند",
     c3.includes("data-k=\"material_id\""));

  const c4 = cell(uOf(0), drOf(true, 44.55, 71.7, DSHEET.id));
  ok("بدون ورق بدنه: هشدار می‌دهد", c4.includes("fb-note bad") && c4.includes("ورق بدنه"));

  const c5 = cell(uOf(BODY.id), drOf(false, 44.55, 71.7, BODY.id));
  ok("وقتی جنسِ در == ورق بدنه: راهنما پیشنهاد می‌دهد تیک بزند",
     c5.includes("fb-note hint") && c5.includes("یکی است"));

  ok("شناسه‌های ردیف برای ذخیره‌سازی درست‌اند",
     c1.includes("data-ui=\"0\"") && c1.includes("data-di=\"0\""));
}

/* ========================================================= ۳) برش‌نامه */
console.log("\n— برش‌نامه —");
{
  const p = sampleProject();
  const parts = T.buildCutListLocal(p);
  ok("قطعات تولید شدند", parts.length > 15, `${parts.length} قطعه`);
  ok("طول همیشه بزرگ‌تر یا مساوی عرض است (قرارداد دستگاه برش)",
     parts.every((c) => c.length_mm >= c.width_mm));
  ok("ابعاد میلی‌متری‌اند (۱۰ برابر سانتی‌متر)",
     parts.some((c) => c.length_mm === 2200), "کمد ۲۲۰ سم باید ۲۲۰۰ میل باشد");
  ok("تعداد = تعداد پنل × تعداد یونیت",
     parts.filter((c) => c.unit === "زمینی ۶۰" && c.part.includes("بدنه کناری"))
          .every((c) => c.qty === 2 * 3));
  ok("فیبر پشت نوار نمی‌خواهد",
     parts.filter((c) => c.part === "فیبر پشت").every((c) => c.banding === false));
  ok("لنگه‌های در در برش‌نامه هستند",
     parts.some((c) => c.part.includes("(لنگه)")));
  ok("مساحت کل قطعات > ۰ است", parts.reduce((a, c) => a + c.area_sqm, 0) > 10);
  ok("هر قطعه material و mat_cat دارد",
     parts.every((c) => c.material && c.mat_cat));
}

/* ====================================================== ۴) خلاصه‌ی ورق */
console.log("\n— خلاصه‌ی ورق و لیست خرید —");
{
  const p = sampleProject();
  const pack = T.buildWorkshopLocal(p);
  const sh = pack.sheet_summary;
  ok("خلاصه‌ی ورق برای هر متریال یک ردیف دارد", sh.length >= 2, `${sh.length} ردیف`);
  ok("تعداد ورق ≥ ۱ است", sh.every((s) => s.sheets >= 1));
  ok("مساحت ورق با ابعاد ورق می‌خواند",
     sh.every((s) => !s.sheet_size || /^\d+×\d+$/.test(s.sheet_size)));

  const lines = pack.shopping;
  ok("لیست خرید خالی نیست", lines.length > 5, `${lines.length} قلم`);
  ok("ورق‌ها در لیست خرید با واحد «ورق» آمده‌اند",
     lines.filter((l) => l.group === "sheet").every((l) => l.unit_label === "ورق" || l.unit === "sheet"));
  ok("نصب و مبلغ ثابت در لیست خرید نیستند (خریدنی نیستند)",
     !lines.some((l) => l.name === "هزینه‌ی نصب"));
  const groups = pack.shopping_groups;
  ok("گروه‌بندی لیست خرید درست است", groups.length >= 2 && groups.every((g) => g.rows.length));
  ok("جمع گروه‌ها = جمع ردیف‌ها",
     near(groups.reduce((a, g) => a + g.total, 0),
          lines.reduce((a, l) => a + l.amount, 0), 1));
  ok("یراق‌آلات با تعداد صحیح", (groups.find((g) => g.key === "hardware") || { rows: [] }).rows
        .some((r) => r.qty > 0));
}

/* ============================================= ۵) ساخت خودکار در از ابعاد یونیت */
console.log("\n— ساخت و هم‌اندازه‌سازی خودکار در —");
{
  ok("یونیت ۹۰ سم → دو لنگه", T.leavesForLength(90) === 2);
  ok("یونیت ۶۰ سم → یک لنگه", T.leavesForLength(60) === 1);
  ok("عرض لنگه‌ی یونیت ۹۰ دو لنگه ≈ ۴۴٫۶ سم (درز ۳ میل)",
     near(T.leafWidth(90, 2), 44.55, 0.06), String(T.leafWidth(90, 2)));
  ok("عرض لنگه‌ی یونیت ۶۰ تک‌لنگه ≈ ۵۹٫۴ سم",
     near(T.leafWidth(60, 1), 59.4, 0.01), String(T.leafWidth(60, 1)));
  ok("جمع عرض لنگه‌ها + درزها = طول یونیت",
     near(T.leafWidth(90, 2) * 2 + 0.3 * 3, 90, 0.11));

  const u = Object.assign(T.defaultUnit("ground"), { length_cm: 90, height_cm: 72, body_id: MDF });
  u.doors = [];
  const dr = sandbox.window.autoDoorsForUnit
    ? null : null; /* تابع در ui.js است و به DOM نیاز دارد؛ منطقش این‌جا بازتولید شد */
  /* هم‌اندازه‌سازی: اگر طول یونیت عوض شود، عرض لنگه‌ها باید دنبال آن برود */
  const u2 = Object.assign(T.defaultUnit("ground"), { length_cm: 90, height_cm: 72 });
  u2.doors = [Object.assign(T.defaultDoor(), { qty: 2, w_cm: 44.5, h_cm: 71.7 })];
  u2.length_cm = 80; u2.height_cm = 70;
  const fitted = T.fitDoorsToUnit(u2);
  ok("fitDoorsToUnit اجرا شد", fitted === true);
  ok("عرض لنگه با طول جدید یونیت هم‌اندازه شد",
     near(u2.doors[0].w_cm * 2 + 0.3 * 3, 80, 0.11), String(u2.doors[0].w_cm));
  ok("ارتفاع لنگه با ارتفاع جدید یونیت هم‌اندازه شد",
     near(u2.doors[0].h_cm, 69.7, 0.05), String(u2.doors[0].h_cm));
  const u3 = Object.assign(T.defaultUnit("ground"), { length_cm: 60 });
  u3.doors = [];
  ok("یونیت بدون در، چیزی برای هم‌اندازه‌سازی ندارد", T.fitDoorsToUnit(u3) === false);
}

/* ================================================= ۶) قیمت‌گیری سریع */
console.log("\n— قیمت‌گیری سریع —");
{
  const st = T.STYLES()[0];
  const units = T.quickUnitsLocal({
    ground_lm: 3.6, wall_lm: 3.0, style_id: st.id,
    countertop_id: 0, drawers: 3, tall: 1,
  });
  ok("یونیت‌ها ساخته شدند", units.length >= 10, `${units.length} یونیت`);
  const groundLm = units.filter((u) => u.unit_type !== "wall")
                        .reduce((a, u) => a + u.length_cm * (u.qty || 1), 0) / 100;
  ok("جمع طول زمینی ≈ متراژ ورودی", near(groundLm, 3.6 + 0.6, 0.7), String(groundLm));
  const wallLm = units.filter((u) => u.unit_type === "wall")
                      .reduce((a, u) => a + u.length_cm * (u.qty || 1), 0) / 100;
  ok("جمع طول دیواری ≈ متراژ ورودی", near(wallLm, 3.0, 0.05), String(wallLm));
  ok("یونیت کشودار، در ندارد و کشو دارد",
     units.some((u) => u.drawers.length === 3 && u.doors.length === 0));
  ok("کمد ایستاده ساخته شد", units.some((u) => u.unit_type === "tall"));
  ok("همه‌ی یونیت‌های دردار، درِ هم‌اندازه دارند",
     units.filter((u) => u.doors.length).every((u) =>
       near(u.doors.reduce((a, d) => a + d.w_cm * d.qty, 0) + 0.3 * (u.doors.reduce((a, d) => a + d.qty, 0) + 1),
            u.length_cm, 0.35)));
  ok("متریال از سبک برداشته شد", units.every((u) => u.body_id !== 0 || !st.data.body));
  /* ★ اگر سبک انتخاب نشود، باید به اولین سبک برگردد — وگرنه برآورد
        به «فقط اجرت» سقوط می‌کند و یک پیش‌فاکتورِ غلطِ فاحش به دست مشتری می‌رود */
  const noStyle = T.quickUnitsLocal({ ground_lm: 3.6, wall_lm: 3.0, style_id: 0,
                                      countertop_id: 0, drawers: 0, tall: 0 });
  ok("بدون سبک هم متریال بدنه به یونیت‌ها می‌چسبد",
     noStyle.length > 0 && noStyle.some((u) => u.body_id !== 0),
     "body_id همه صفر است");
  {
    const pg0 = T.defaultPage(0, "بخش ۱");
    pg0.units = noStyle;
    const r0 = T.calcProjectLocal(T.normalizeProject({ id: 91, title: "بدون سبک", pages: [pg0], profit_percent: 30 }));
    ok("پروژه‌ی «بدون سبک» هم قیمت معنادار دارد (نه فقط اجرت)",
       r0.total_cost > 1000000, String(r0.total_cost));
  }

  /* پروژه‌ی کامل باید قابل محاسبه باشد */
  const pg = T.defaultPage(st.id, "بخش ۱");
  pg.units = units;
  T.applyStyleToPage(pg, st.id);
  const proj = T.normalizeProject({ id: 9, title: "سریع", pages: [pg], profit_percent: 30 });
  const r = T.calcProjectLocal(proj);
  ok("پروژه‌ی سریع قیمت‌گذاری می‌شود", r.final_price > 0, String(r.final_price));
  ok("قیمت هر متر طول حساب می‌شود", r.price_per_ground_lm > 0);
}

/* ============================================ ۷) پیش‌پرداخت و قیمت متری */
console.log("\n— پیش‌پرداخت و قیمت متری —");
{
  const p = sampleProject();
  p.profit_percent = 30; p.discount_percent = 0; p.discount_amount = 0;
  let r = T.calcProjectLocal(p);
  ok("بدون پیش‌پرداخت، باقی‌مانده = کل مبلغ", near(r.remaining_amount, r.final_price, 1));
  p.deposit_percent = 40;
  r = T.calcProjectLocal(p);
  ok("پیش‌پرداخت درصدی درست حساب می‌شود", near(r.deposit_amount, r.final_price * 0.4, 1));
  ok("باقی‌مانده = نهایی − پیش‌پرداخت", near(r.remaining_amount, r.final_price - r.deposit_amount, 1));
  p.deposit_percent = 0; p.deposit_amount = 5000000;
  r = T.calcProjectLocal(p);
  ok("پیش‌پرداخت مبلغی هم کار می‌کند", near(r.deposit_amount, 5000000, 1));
  ok("پیش‌پرداخت از مبلغ نهایی بیشتر نمی‌شود", r.deposit_amount <= r.final_price);
  p.deposit_amount = 0;
  r = T.calcProjectLocal(p);
  const glm = r.stats.total_ground_lm;
  ok("قیمت هر متر طول زمینی = نهایی ÷ متر زمینی", near(r.price_per_ground_lm, r.final_price / glm, 1));
  const tlm = glm + r.stats.total_wall_lm;
  ok("قیمت هر متر طول کل", near(r.price_per_total_lm, r.final_price / tlm, 1));
  ok("بهای تمام‌شده‌ی هر متر < قیمت فروش هر متر", r.cost_per_ground_lm < r.price_per_ground_lm);

  /* منطق رندکردن: تخفیف لازم برای رسیدن به مبلغ رُند */
  const step = 1000000, target = Math.round(r.final_price / step) * step;
  const vatRate = 1 + r.vat_percent / 100;
  const needDisc = r.gross_price - target / vatRate;
  const pctPart = r.gross_price * r.discount_percent / 100;
  const newDiscAmt = Math.max(0, Math.round(needDisc - pctPart));
  p.discount_amount = newDiscAmt;
  const r2 = T.calcProjectLocal(p);
  ok("رندکردن از راه تخفیف، مبلغ را دقیقاً رُند می‌کند",
     near(r2.final_price, target, 1.5), `${r2.final_price} vs ${target}`);
  ok("مبلغ رُندشده مثبت است", r2.final_price > 0);
}

/* ========================================= ۸) سازگاری با موتور پایتون */
console.log("\n— برابری آمار با موتور پایتون —");
{
  const p = sampleProject();
  const r = T.calcProjectLocal(p);
  const pack = T.buildWorkshopLocal(p);
  ok("total_pieces برش‌نامه = جمع تعداد قطعات",
     pack.stats.total_pieces === pack.cut_parts.reduce((a, c) => a + c.qty, 0));
  ok("total_area_sqm برش‌نامه ≈ مساحت بدنه+در+فیبر موتور",
     near(pack.stats.total_area_sqm,
          r.stats.total_body_area + r.stats.total_door_area + r.stats.total_back_area, 3),
     `${pack.stats.total_area_sqm} vs ${r.stats.total_body_area + r.stats.total_door_area + r.stats.total_back_area}`);
  ok("برش‌نامه خالی نیست وقتی پروژه یونیت دارد", pack.cut_parts.length > 0);
}

console.log(`\n${pass} بررسی پاس شد${fail ? `، ${fail} مورد ناموفق ❌` : " ✅"}`);
