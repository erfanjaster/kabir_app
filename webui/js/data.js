/* ==========================================================================
   کبیر ۲ — data.js
   ابزارها، داده‌های نمونه (هم‌شکل با پاسخ سرور)، لایه‌ی اتصال به API
   شکل داده‌ها دقیقاً همان چیزی است که kabir/web/server.py برمی‌گرداند،
   بنابراین در حالت متصل/نمایشی فقط منبع داده فرق می‌کند.
   ========================================================================== */
"use strict";

/* ---------------------------------------------------------------- ابزارها */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const el = (id) => document.getElementById(id);

let DIGITS_FA = true;                 /* از تنظیمات persian_digits */
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function fa(v) {
  const s = String(v);
  return DIGITS_FA ? s.replace(/\d/g, (d) => FA_DIGITS[+d]) : s;
}
function toEn(s) {
  return String(s)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/٫/g, ".").replace(/−/g, "-").replace(/،|٬/g, "");
}
function parseNum(s) {
  const n = parseFloat(toEn(s).replace(/[^\d.\-]/g, ""));
  return isFinite(n) ? n : 0;
}
function fmt(n, dec) {
  n = Number(n) || 0;
  n = dec ? Math.round(n * 10) / 10 : Math.round(n);
  let s = dec ? n.toFixed(1) : String(Math.round(n));
  let [int, frac] = s.split(".");
  const neg = int.startsWith("-");
  if (neg) int = int.slice(1);
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, "٬");
  return fa((neg ? "-" : "") + (frac ? int + "٫" + frac : int));
}

/* ------------------------------------------------- جداکننده‌ی هزارگان هنگام تایپ
   ورودی‌های عددی را «همزمان با تایپ» مرتب می‌کند:
     * فقط رقم، یک جداکننده‌ی اعشار و منفیِ ابتدای عدد مجاز است؛
     * بخش صحیح سه‌رقم‌سه‌رقم با «٬» جدا می‌شود؛
     * رقم‌ها طبق تنظیمات «نمایش اعداد فارسی» تبدیل می‌شوند؛
     * جای نشانگر (caret) با شمارش رقم‌ها حفظ می‌شود.                     */
function sanitizeNumStr(en) {
  let out = "";
  let seenDot = false;
  for (const ch of String(en)) {
    if (ch >= "0" && ch <= "9") out += ch;
    else if ((ch === "-" || ch === "−") && !out.length) out += "-";
    else if ((ch === "." || ch === "٫") && !seenDot && out.length && out !== "-") {
      seenDot = true; out += ".";
    }
  }
  return out;
}
function groupNumStr(en) {
  /* ورودی: عدد نرمال‌شده با رقم انگلیسی — خروجی: با ٬ و ٫ (بدون تبدیل رقم) */
  const neg = en.startsWith("-");
  if (neg) en = en.slice(1);
  let [int, frac] = en.split(".");
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, "٬");
  return (neg ? "-" : "") + int + (frac !== undefined ? "٫" + frac : "");
}
/* مقدار آماده‌ی نمایش داخل فیلدهای ورودی (گروه‌شده + رقم فارسی طبق تنظیمات) */
function fmtInp(v) {
  if (v === null || v === undefined || v === "") return "";
  const cleaned = sanitizeNumStr(toEn(v));
  if (!cleaned || cleaned === "-") return "";
  const g = groupNumStr(cleaned);
  return DIGITS_FA ? fa(g) : g;
}
/* آرایش زنده‌ی یک فیلد ورودی عددی با حفظ جای نشانگر */
function formatNumberInput(inp) {
  const raw = inp.value;
  const caret = (inp.selectionStart === null || inp.selectionStart === undefined)
    ? raw.length : inp.selectionStart;
  const cleaned = sanitizeNumStr(toEn(raw));
  if (!cleaned && raw) { inp.value = ""; return; }
  if (!cleaned) return;
  const g = groupNumStr(cleaned);
  const grouped = DIGITS_FA ? fa(g) : g;
  if (grouped === raw) return;
  /* رقم‌های پیش از نشانگر در مقدار قبلی شمرده می‌شود تا جای آن بپرد */
  const before = toEn(raw.slice(0, caret));
  let digits = 0, dotBefore = false;
  for (const ch of before) {
    if (ch >= "0" && ch <= "9") digits++;
    else if (ch === ".") dotBefore = true;
  }
  inp.value = grouped;
  let d = 0, pos = grouped.length;
  for (let i = 0; i < grouped.length; i++) {
    const ch = toEn(grouped[i]);
    if (ch >= "0" && ch <= "9") { d++; if (d === digits) { pos = i + 1; break; } }
  }
  if (digits === 0) pos = grouped.startsWith("-") ? 1 : 0;
  if (dotBefore && toEn(grouped[pos] || "") === ".") pos++;
  try { inp.setSelectionRange(pos, pos); } catch (e) { /* برخی مرورگرها */ }
}
/* آیا این فیلد باید جداکننده‌ی هزارگان بگیرد؟ (درصدها و فیلدهای کوچک نه) */
function isGroupedNumField(t) {
  if (!t || !t.matches) return false;
  if (t.tagName !== "INPUT") return false;
  if (t.type === "checkbox" || t.type === "radio" || t.type === "range") return false;
  const im = t.getAttribute("inputmode") || "";
  if (im !== "numeric" && im !== "decimal") return false;
  if (t.hasAttribute("data-no-sep") || t.classList.contains("no-sep")) return false;
  return true;
}

/* پول: با مقیاس/واحد پول از تنظیمات */
const CUR = { name: "تومان", scale: 1 };
function scaled(v) { return (Number(v) || 0) / (CUR.scale || 1); }
function money(v) { return fmt(scaled(v)) + `<span class="money-unit">${CUR.name}</span>`; }
function moneyPlain(v) { return fmt(scaled(v)); }

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const svg = (path, extra) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra || ""}>${path}</svg>`;
const ICONS = {
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'),
  eye: svg('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>'),
  copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  invoice: svg('<path d="M5 3h14v18l-2.4-1.6L14 21l-2-1.6L10 21l-2.6-1.6L5 21z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/>'),
  check: svg('<polyline points="20 6 9 17 4 12"/>'),
  x: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="8.01"/><line x1="12" y1="11" x2="12" y2="16"/>'),
  warn: svg('<path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17.01"/>'),
  sun: svg('<circle cx="12" cy="12" r="4.5"/><line x1="12" y1="1.5" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22.5"/><line x1="4.2" y1="4.2" x2="6" y2="6"/><line x1="18" y1="18" x2="19.8" y2="19.8"/><line x1="1.5" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22.5" y2="12"/><line x1="4.2" y1="19.8" x2="6" y2="18"/><line x1="18" y1="6" x2="19.8" y2="4.2"/>'),
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  inbox: svg('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>'),
  power: svg('<path d="M18.4 6.6a9 9 0 1 1-12.8 0"/><line x1="12" y1="2" x2="12" y2="11"/>'),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  table: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>'),
  chev: svg('<polyline points="9 6 15 12 9 18"/>'),
  tpl: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>'),
  bolt: svg('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  saw: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.1-.6-.6-2.1z"/>'),
  cart: svg('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 7H6"/>'),
  ruler: svg('<path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><line x1="3" y1="12" x2="21" y2="12"/>'),
  spark: svg('<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),
};

function iconBtn(cls, icon, title, attrs) {
  return `<button class="row-actions ${cls}" type="button" title="${title}" ${attrs || ""}>${ICONS[icon]}</button>`;
}

/* عدد به حروف فارسی (برای حالت نمایشی — سرور نسخه‌ی خودش را دارد) */
const W1 = ["", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه", "ده",
  "یازده", "دوازده", "سیزده", "چهارده", "پانزده", "شانزده", "هفده", "هجده", "نوزده"];
const W2 = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"];
const W3 = ["", "یکصد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد"];
function words3(n) {
  const parts = [];
  const h = Math.floor(n / 100), r = n % 100;
  if (h) parts.push(W3[h]);
  if (r > 0 && r < 20) parts.push(W1[r]);
  else if (r >= 20) { parts.push(W2[Math.floor(r / 10)]); if (r % 10) parts.push(W1[r % 10]); }
  return parts.join(" و ");
}
function num2words(n) {
  n = Math.abs(Math.round(Number(n) || 0));
  if (!n) return "صفر";
  const parts = [];
  for (const [v, name] of [[1e9, "میلیارد"], [1e6, "میلیون"], [1e3, "هزار"]]) {
    const q = Math.floor(n / v);
    if (q) { parts.push(words3(q) + " " + name); n %= v; }
  }
  if (n) parts.push(words3(n));
  return parts.join(" و ");
}

function storeGet(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } }
function storeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private */ } }

function downloadBlob(bytes, filename, ctype) {
  const blob = new Blob([bytes], { type: ctype || "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ------------------------------------------------------- ثابت‌های دامنه */
const UNITS = { sheet: "ورق", sqm: "متر مربع", lm: "متر طول", piece: "عدد", set: "ست", kg: "کیلوگرم", job: "موردی" };
const STATUS_LABEL = { draft: "پیش‌نویس", open: "در جریان", done: "انجام‌شده", canceled: "لغوشده" };
const STATUS_CLASS = { draft: "b-draft", open: "b-open", done: "b-done", canceled: "b-cancel" };
const UNIT_TYPES = { ground: "زمینی", wall: "دیواری", tall: "کمد ایستاده" };

/* ابعاد پیش‌فرض یونیت‌ها به تفکیک نوع — از تنظیمات خوانده می‌شود
   (کلیدها: unit_<type>_length_cm / height_cm / depth_cm / shelves)
   و در نبود مقدار معتبر، به این پیش‌فرض‌های صنعتی برمی‌گردد. */
const UNIT_DEFAULTS_FALLBACK = {
  ground: { length_cm: 60, height_cm: 72, depth_cm: 55, shelves: 1 },
  wall: { length_cm: 60, height_cm: 70, depth_cm: 30, shelves: 1 },
  tall: { length_cm: 60, height_cm: 220, depth_cm: 58, shelves: 2 },
};
function unitDefaults(type) {
  const f = UNIT_DEFAULTS_FALLBACK[type] || UNIT_DEFAULTS_FALLBACK.ground;
  const get = (k) => {
    const v = parseFloat(toEn(SETTINGS["unit_" + type + "_" + k]));
    return isFinite(v) && v >= 0 ? v : f[k];
  };
  return {
    length_cm: get("length_cm"), height_cm: get("height_cm"),
    depth_cm: get("depth_cm"), shelves: get("shelves"),
  };
}
/* برچسب پیشنهادی یونیت بر اساس نوع و طول */
function unitLabel(type, lengthCm) {
  const L = fmt(lengthCm);
  if (type === "tall") return `کمد ایستاده ${L}`;
  if (type === "wall") return `یونیت دیواری ${L}`;
  return `یونیت زمینی ${L}`;
}
/* آیا برچسب، همان برچسب پیش‌فرض (قابل‌جایگزینی خودکار) است؟ */
function isDefaultUnitLabel(label) {
  return !label || /^(یونیت زمینی|یونیت دیواری|کمد ایستاده)(\s*[\d۰-۹٬]*)?$/.test(String(label).trim());
}
const SERVICE_BASIS = { fixed: "موردی (ثابت)", unit: "هر یونیت", door: "هر لنگه در", shelf: "هر طبقه", sqm: "هر م²", lm: "هر متر طول", percent: "درصدی از جمع" };

let CATS = [
  ["body_sheet", "ورق بدنه"], ["door_sheet", "ورق در"], ["back_sheet", "فیبر پشت"],
  ["drawer_sheet", "ورق بدنه‌ی کشو"], ["door_model", "مدل در"], ["countertop", "صفحه کابینت"],
  ["crown", "تاج"], ["underlight", "زیرچراغ"], ["kickboard", "پاخور"],
  ["banding", "نوار بدنه و در"], ["hinge", "لولا"], ["gas_spring", "گازور / جک"],
  ["shelf_pin", "خار طبقه"], ["handle", "دستگیره"], ["leg", "پایه"],
  ["drawer_slide", "ریل کشو"], ["accessory", "سایر اکسسوری"], ["service", "خدمات"],
];
const catLabel = (k) => (CATS.find((c) => c[0] === k) || [, k])[1];

/* ترتیب گروه‌های فاکتور (مثل GROUP_ORDER سرور) */
const GROUP_ORDER = [
  "ورق بدنه", "فیبر پشت", "ورق در", "مدل و اجرت در", "جعبه‌ی کشو", "تیره‌ی کشو",
  "صفحه کابینت", "تاج", "زیرچراغ", "پاخور",
  "نوار PVC بدنه", "نوار PVC در", "نوار PVC کشو",
  "لولا", "گازور / جک", "خار طبقه", "دستگیره", "پایه", "ریل کشو",
  "درنما", "اضافات و اکسسوری", "مونتاژ و خدمات", "خدمات", "نصب و حمل",
];

/* ============================================================== داده‌ی نمونه
   (فقط برای حالت نمایشی وقتی سرور در دسترس نیست — هم‌شکل با پاسخ API)     */

const DEMO_SETTINGS = {
  company_name: "کارگاه کابینت‌سازی کبیر", company_manager: "ارفع جاستری",
  company_phone: "۰۲۱-۸۸۷۷۶۶۵۵", company_mobile: "۰۹۱۲۳۴۵۶۷۸۹",
  company_address: "تهران، خیابان آزادی، پاساژ چوب، پلاک ۱۲",
  company_email: "info@kabir.example", company_web: "kabir.example", company_logo: "",
  invoice_title: "پیش‌فاکتور",
  invoice_footer_note: "این پیش‌فاکتور تا تاریخ اعتبار ذکرشده معتبر است. پیش‌پرداخت: ۶۰٪ هنگام عقد قرارداد.",
  currency: "تومان", currency_scale: "1", vat_enabled: "1", vat_percent: "10",
  default_waste_percent: "8", default_overhead_percent: "5",
  default_profit_mode: "markup", default_profit_percent: "25",
  default_install_mode: "per_meter", default_install_value: "350000",
  sheet_width_cm: "183", sheet_height_cm: "366", sheet_thickness_mm: "16",
  fiber_sheet_width_cm: "122", fiber_sheet_height_cm: "244",
  unit_ground_length_cm: "60", unit_ground_height_cm: "72", unit_ground_depth_cm: "55", unit_ground_shelves: "1",
  unit_wall_length_cm: "60", unit_wall_height_cm: "70", unit_wall_depth_cm: "30", unit_wall_shelves: "1",
  unit_tall_length_cm: "60", unit_tall_height_cm: "220", unit_tall_depth_cm: "58", unit_tall_shelves: "2",
  banding_body_factor: "2.2", banding_door_factor: "1", banding_waste_percent: "8",
  theme: "light", font_size: "12", persian_digits: "1", web_font_size: "14",
  auto_backup: "1", backup_keep: "14",
};

/* name, cat, unit, price, w, h, thick, width_cm, supplier */
const _DM = [
  ["ام‌دی‌اف سفید صدفی ۱۶ میل", "body_sheet", "sheet", 4850000, 183, 366, 16, 0, "بازرگانی چوب آراد"],
  ["ام‌دی‌اف سفید برفی ۱۶ میل", "body_sheet", "sheet", 5100000, 183, 366, 16, 0, "بازرگانی چوب آراد"],
  ["ام‌دی‌اف کرم/نسکافه‌ای ۱۶ میل", "body_sheet", "sheet", 5250000, 183, 366, 16, 0, ""],
  ["ام‌دی‌اف طوسی ۱۶ میل", "body_sheet", "sheet", 5400000, 183, 366, 16, 0, ""],
  ["ام‌دی‌اف طرح چوب راش ۱۶ میل", "body_sheet", "sheet", 6300000, 183, 366, 16, 0, "چوب و صنعت البرز"],
  ["ام‌دی‌اف ضدآب (MR) ۱۶ میل", "body_sheet", "sheet", 7200000, 183, 366, 16, 0, ""],
  ["نئوپان ملامینه ۱۶ میل (اقتصادی)", "body_sheet", "sheet", 3100000, 183, 366, 16, 0, ""],
  ["هایگلاس ترک سفید ۱۶ میل", "door_sheet", "sheet", 9500000, 183, 366, 16, 0, "آستارا چوب"],
  ["هایگلاس ترک طرح‌دار ۱۶ میل", "door_sheet", "sheet", 10800000, 183, 366, 16, 0, "آستارا چوب"],
  ["هایگلاس ایرانی ۱۶ میل", "door_sheet", "sheet", 6900000, 183, 366, 16, 0, ""],
  ["ام‌دی‌اف ملامینه (در هم‌رنگ بدنه)", "door_sheet", "sheet", 5250000, 183, 366, 16, 0, ""],
  ["ورق پایه ممبران (خام CNC)", "door_sheet", "sheet", 5900000, 183, 366, 18, 0, ""],
  ["ورق پایه پلی‌اورتان", "door_sheet", "sheet", 6400000, 183, 366, 18, 0, ""],
  ["فیبر (MDF 3 میل) پشت سفید", "back_sheet", "sheet", 1650000, 122, 244, 3, 0, ""],
  ["فیبر (MDF 3 میل) پشت طرح چوب", "back_sheet", "sheet", 1850000, 122, 244, 3, 0, ""],
  ["ام‌دی‌اف سفید ۱۶ میل (جعبه کشو)", "drawer_sheet", "sheet", 4850000, 183, 366, 16, 0, ""],
  ["بدنه‌ی کشو تاندم باکس آماده", "drawer_sheet", "set", 2400000, 0, 0, 0, 0, ""],
  ["اجرت ساخت در ملامینه (هر لنگه)", "door_model", "piece", 180000, 0, 0, 0, 0, ""],
  ["اجرت ساخت در هایگلاس (هر لنگه)", "door_model", "piece", 320000, 0, 0, 0, 0, ""],
  ["اجرت CNC در ممبران (هر م²)", "door_model", "sqm", 1450000, 0, 0, 0, 0, ""],
  ["اجرت رنگ پلی‌اورتان (هر م²)", "door_model", "sqm", 2600000, 0, 0, 0, 0, ""],
  ["در شیشه‌ای قاب آلومینیوم (هر لنگه)", "door_model", "piece", 850000, 0, 0, 0, 0, ""],
  ["صفحه ۳ سانت ایرانی (طرح‌دار)", "countertop", "lm", 1350000, 0, 0, 30, 60, ""],
  ["صفحه ۵ سانت ایرانی", "countertop", "lm", 2150000, 0, 0, 50, 60, "صفحه‌سازی پایتخت"],
  ["صفحه ۵ سانت ترک (ضدخش)", "countertop", "lm", 3900000, 0, 0, 50, 60, "صفحه‌سازی پایتخت"],
  ["صفحه کورین (Corian)", "countertop", "lm", 6800000, 0, 0, 12, 60, ""],
  ["تاج ام‌دی‌اف ساده", "crown", "lm", 185000, 0, 0, 0, 8, ""],
  ["تاج ابزارخور (CNC)", "crown", "lm", 420000, 0, 0, 0, 12, ""],
  ["زیرچراغ با جای SMD", "underlight", "lm", 245000, 0, 0, 0, 10, ""],
  ["پاخور پی‌وی‌سی (PVC)", "kickboard", "lm", 135000, 0, 0, 0, 15, ""],
  ["پاخور آلومینیومی", "kickboard", "lm", 295000, 0, 0, 0, 15, ""],
  ["نوار PVC ۲۲ میل سفید", "banding", "lm", 18500, 0, 0, 0, 0, ""],
  ["نوار PVC ۲۲ میل طرح چوب", "banding", "lm", 26000, 0, 0, 0, 0, ""],
  ["نوار ABS هایگلاس", "banding", "lm", 64000, 0, 0, 0, 0, ""],
  ["لولا آرام‌بند معمولی", "hinge", "piece", 68000, 0, 0, 0, 0, ""],
  ["لولا آرام‌بند ترک", "hinge", "piece", 125000, 0, 0, 0, 0, "یراق‌سرای شرق"],
  ["لولا آرام‌بند آلمانی (Blum)", "hinge", "piece", 285000, 0, 0, 0, 0, "یراق‌سرای شرق"],
  ["گازور ساده ۱۰۰N", "gas_spring", "piece", 145000, 0, 0, 0, 0, ""],
  ["جک آرام‌بند تاشو", "gas_spring", "piece", 680000, 0, 0, 0, 0, ""],
  ["خار طبقه فلزی", "shelf_pin", "piece", 6500, 0, 0, 0, 0, ""],
  ["دستگیره میله‌ای ۱۲٫۸ سانت", "handle", "piece", 85000, 0, 0, 0, 0, ""],
  ["دستگیره میله‌ای ۱۶ سانت", "handle", "piece", 115000, 0, 0, 0, 0, ""],
  ["دستگیره مخفی (پروفیلی)", "handle", "piece", 165000, 0, 0, 0, 0, ""],
  ["دستگیره دکمه‌ای", "handle", "piece", 62000, 0, 0, 0, 0, ""],
  ["پایه پلاستیکی تنظیم‌دار ۱۰ سانت", "leg", "piece", 28000, 0, 0, 0, 0, ""],
  ["پایه فلزی تنظیم‌دار ۱۵ سانت", "leg", "piece", 65000, 0, 0, 0, 0, ""],
  ["ریل ساچمه‌ای معمولی (جفت)", "drawer_slide", "set", 165000, 0, 0, 0, 0, ""],
  ["ریل تاندم آرام‌بند (جفت)", "drawer_slide", "set", 890000, 0, 0, 0, 0, ""],
  ["تاندم‌باکس کامل (ست)", "drawer_slide", "set", 2450000, 0, 0, 0, 0, ""],
  ["سطل زباله ریلی دو مخزن", "accessory", "piece", 1980000, 0, 0, 0, 0, ""],
  ["آبچکان استیل داخل کابینت", "accessory", "piece", 1250000, 0, 0, 0, 0, ""],
  ["نورپردازی SMD هر متر (با ترانس)", "accessory", "lm", 385000, 0, 0, 0, 0, ""],
  ["برش و CNC (هر ورق)", "service", "sheet", 480000, 0, 0, 0, 0, ""],
  ["سوراخ‌کاری و مونتاژ (هر یونیت)", "service", "job", 220000, 0, 0, 0, 0, ""],
  ["مونتاژ و رگلاژ در (هر لنگه)", "service", "job", 85000, 0, 0, 0, 0, ""],
  ["بسته‌بندی هر لنگه در", "service", "job", 45000, 0, 0, 0, 0, ""],
  ["حمل تا محل (سرویس)", "service", "job", 850000, 0, 0, 0, 0, ""],
  ["طراحی سه‌بعدی", "service", "job", 1500000, 0, 0, 0, 0, ""],
  ["بازدید و اندازه‌گیری", "service", "job", 350000, 0, 0, 0, 0, ""],
];

/* ============================================================== وضعیت برنامه */
let MATERIALS = [];
let STYLES = [];
let PROJECTS = [];
let HISTORY = [];
let ARCHIVE = [];
let BACKUPS = [];
let SETTINGS = {};
let DASH = null;                 /* داشبورد سرور (در حالت متصل) */
let DATA_DIR = "";
let KABIR_VERSION = "";          /* نسخه‌ی سرویس (از bootstrap) */
let TODAY_FA = "۱۴۰۵/۰۸/۰۱";
let SALES_DEMO = [
  { label: "اردیبهشت", amount: 310e6, count: 2 }, { label: "خرداد", amount: 425e6, count: 3 },
  { label: "تیر", amount: 380e6, count: 2 }, { label: "مرداد", amount: 560e6, count: 4 },
  { label: "شهریور", amount: 640e6, count: 3 }, { label: "مهر", amount: 720e6, count: 5 },
];

const state = {
  page: "dashboard",
  matCat: "all",
  editingProject: null,
  pageIdx: 0,
  dirty: false,
  expanded: new Set(),
  editingMaterial: null,
  editingStyle: null,
  confirmCb: null,
  lastResult: null,
  sort: {
    materials: { key: "id", dir: 1 },
    projects: { key: "id", dir: -1 },
    archive: { key: "id", dir: -1 },
  },
  inv: { kind: "quote", mode: "grouped", hidden: new Set(), showCost: false, showStats: true, number: "", payload: null, html: "", demoHtml: "" },
};

/* --------------------------------------------------------- دسترسی متریال */
const matById = (id) => MATERIALS.find((m) => m.id === Number(id)) || null;
const midByName = (name) => (MATERIALS.find((m) => m.name === name) || {}).id || 0;
const catNames = (cat) => MATERIALS.filter((m) => m.cat === cat && m.active).map((m) => m.name);
function pricePerSqm(m) {
  if (!m) return 0;
  if (m.unit === "sheet") {
    const a = (m.sheet_width_cm * m.sheet_height_cm) / 10000;
    return a > 0 ? m.price / a : 0;
  }
  if (m.unit === "sqm") return m.price;
  if (m.unit === "lm" && m.width_cm) return m.price / (m.width_cm / 100);
  return m.price;
}

/* ------------------------------------------------- کارخانه‌های مدل داده */
function defaultUnit(type) {
  type = UNIT_TYPES[type] ? type : "ground";
  const d = unitDefaults(type);
  return {
    label: unitLabel(type, d.length_cm), unit_type: type, qty: 1,
    length_cm: d.length_cm, height_cm: d.height_cm, depth_cm: d.depth_cm, shelves: d.shelves,
    body_id: 0, back_id: 0, countertop_id: 0, crown_id: 0, underlight_id: 0,
    kickboard_id: 0, leg_id: 0, legs_per_unit: 4, banding_id: 0,
    shelf_pin_id: 0, pins_per_shelf: 4, assembly_id: 0,
    has_top_panel: true, has_bottom_panel: true,
    doors: [], drawers: [], note: "",
  };
}
/* اعمال ابعاد پیش‌فرضِ نوع روی یونیت — هنگام تغییر نوع در ویرایشگر */
function applyUnitTypeDefaults(u, type) {
  const d = unitDefaults(type);
  u.unit_type = type;
  u.length_cm = d.length_cm;
  u.height_cm = d.height_cm;
  u.depth_cm = d.depth_cm;
  u.shelves = d.shelves;
  if (isDefaultUnitLabel(u.label)) u.label = unitLabel(type, d.length_cm);
  return u;
}
function defaultDoor() {
  return {
    label: "در", qty: 1, w_cm: 45, h_cm: 70, model: "single",
    material_id: 0, door_model_id: 0, hinge_id: 0, hinges_per_leaf: 2,
    gas_spring_id: 0, gas_springs_per_leaf: 0, handle_id: 0, handles_per_leaf: 1,
    banding_id: 0, assembly_id: 0, packaging_id: 0, glass: false, note: "",
    from_body: false,      /* ★ در از ورق بدنه‌ی همان یونیت برش بخورد */
  };
}
function defaultDrawer() {
  return {
    label: "کشو", qty: 1, w_cm: 60, h_cm: 18, d_cm: 45,
    slide_id: 0, handle_id: 0, sheet_id: 0, front_id: 0, banding_id: 0, assembly_id: 0, note: "",
  };
}
function defaultPage(styleId, name) {
  const st = STYLES.find((s) => s.id === Number(styleId));
  const n = Number;
  return {
    id: 0, project_id: 0, name: name || `بخش ${fa(1)}`, style_id: n(styleId) || 0,
    style_name: st ? st.name : "",
    units: [], extras: [], services: [],
    detail_mode: "none", detail_rows: [], detail_total_sqm: 0, detail_price_per_sqm: 0,
    waste_percent: n(SETTINGS.default_waste_percent || 8),
    overhead_percent: n(SETTINGS.default_overhead_percent || 0),
    banding_body_factor: n(SETTINGS.banding_body_factor || 2.2),
    banding_door_factor: n(SETTINGS.banding_door_factor || 1),
    banding_waste_percent: n(SETTINGS.banding_waste_percent || 8),
    countertop_lm: 0,
    /* طول اندازه‌گیری‌شده‌ی دیوار — فقط برای کنترل خطا در ویرایشگر */
    wall_length_cm: 0,
    note: "",
  };
}

/* اعمال سبک روی بخش — دقیقاً مثل _apply_style در نسخه‌ی رومیزی */
function applyStyleToPage(page, styleId) {
  const st = STYLES.find((s) => s.id === Number(styleId));
  if (!st) return false;
  const d = st.data || {};
  page.style_id = st.id;
  page.style_name = st.name;
  if (d.waste_percent) page.waste_percent = Number(d.waste_percent);
  if (d.overhead_percent) page.overhead_percent = Number(d.overhead_percent);
  for (const u of page.units) {
    for (const [role, attr] of [["body", "body_id"], ["back", "back_id"], ["banding", "banding_id"],
      ["countertop", "countertop_id"], ["leg", "leg_id"], ["shelf_pin", "shelf_pin_id"],
      ["crown", "crown_id"], ["underlight", "underlight_id"], ["kickboard", "kickboard_id"]]) {
      if (d[role]) u[attr] = midByName(d[role]);
    }
    for (const dr of u.doors) {
      if (d.door) dr.material_id = midByName(d.door);
      if (d.hinge) dr.hinge_id = midByName(d.hinge);
      if (d.handle) dr.handle_id = midByName(d.handle);
      if (d.banding) dr.banding_id = midByName(d.banding);
      if (d.door_model) dr.door_model_id = midByName(d.door_model);
      if (d.assembly_door) dr.assembly_id = midByName(d.assembly_door);
      if (d.packaging_door) dr.packaging_id = midByName(d.packaging_door);
    }
    for (const dw of u.drawers) {
      if (d.slide) dw.slide_id = midByName(d.slide);
      if (d.drawer_sheet) dw.sheet_id = midByName(d.drawer_sheet);
      if (d.handle) dw.handle_id = midByName(d.handle);
      if (d.door) dw.front_id = midByName(d.door);
      if (d.banding) dw.banding_id = midByName(d.banding);
    }
  }
  return true;
}

function normalizePage(pg) {
  const base = defaultPage(pg.style_id || 0, pg.name);
  const p = Object.assign(base, pg);
  p.units = (pg.units || []).map((u) => Object.assign(defaultUnit(), u, {
    doors: (u.doors || []).map((d) => Object.assign(defaultDoor(), d)),
    drawers: (u.drawers || []).map((d) => Object.assign(defaultDrawer(), d)),
  }));
  p.extras = (pg.extras || []).map((x) => Object.assign({ label: "", qty: 1, unit: "piece", price: 0, note: "", visible: true }, x));
  p.services = (pg.services || []).map((s) => Object.assign({ label: "", basis: "fixed", qty: 1, price: 0, note: "" }, s));
  p.detail_rows = (pg.detail_rows || []).map((r) => Object.assign({ label: "", qty: 1, w_cm: 0, h_cm: 0, price_per_sqm: 0 }, r));
  return p;
}

function normalizeProject(p) {
  const proj = Object.assign({
    id: 0, code: "", title: "", customer: "", mobile: "", phone: "", address: "",
    status: "draft", date: "", valid_until: "", note: "",
    final_price: 0, total_cost: 0, rates_rev: 0, stale: false,
    profit_mode: "markup", profit_percent: 25, install_mode: "none", install_value: 0,
    discount_percent: 0, discount_amount: 0, vat_enabled: false, vat_percent: 10,
    extra_fixed_amount: 0, deposit_percent: 0, deposit_amount: 0,
    style: "", pages: [],
  }, p);
  proj.pages = (p.pages || []).map(normalizePage);
  if (!proj.pages.length) proj.pages = [defaultPage(0)];
  return proj;
}

/* ------------------------------------------------- الگوهای یونیت (دمو) */
let UNIT_TEMPLATES = [];

/* --------------------------------------------------------- لایه‌ی اتصال */
const API = {
  ok: false,
  base: "",
  async req(method, url, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) {
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(body);
    }
    const r = await fetch(API.base + url, opt);
    let j;
    try { j = await r.json(); } catch (e) { throw new Error("پاسخ سرور معتبر نیست"); }
    if (!r.ok || !j.ok) throw new Error(j.error || `خطای سرور (${r.status})`);
    return j;
  },
  async blob(method, url, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) {
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(body);
    }
    const r = await fetch(API.base + url, opt);
    if (!r.ok) {
      let msg = "خطا در دریافت فایل";
      try { msg = (await r.json()).error || msg; } catch (e) { /* ignore */ }
      throw new Error(msg);
    }
    const cd = r.headers.get("Content-Disposition") || "";
    const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
    return { bytes: await r.arrayBuffer(), name: m ? decodeURIComponent(m[1]) : "download" };
  },
};

/* بررسی سلامت سرویس — سبک و بی‌خطر (برای پایش اتصال) */
async function healthPing(timeoutMs) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs || 2500);
  try {
    const r = await fetch(API.base + "/api/health", { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(to);
  }
}

function ingestBootstrap(b) {
  SETTINGS = b.settings || {};
  DIGITS_FA = String(SETTINGS.persian_digits ?? "1") === "1";
  CUR.name = SETTINGS.currency === "ریال" ? "ریال" : "تومان";
  CUR.scale = Number(SETTINGS.currency_scale || 1) || 1;
  if (b.categories && b.categories.length) CATS = b.categories.map((c) => [c.key, c.label]);
  MATERIALS = b.materials || [];
  STYLES = b.styles || [];
  UNIT_TEMPLATES = b.unit_templates || [];
  PROJECTS = (b.projects || []).map(normalizeProject);
  ARCHIVE = b.invoices || [];
  BACKUPS = b.backups || [];
  HISTORY = b.history || [];
  DASH = b.dashboard || null;
  if (DASH && DASH.monthly && DASH.monthly.length) SALES_DEMO = DASH.monthly;
  TODAY_FA = b.today || TODAY_FA;
  DATA_DIR = b.data_dir || "";
  if (b.version) KABIR_VERSION = String(b.version);
}

async function tryConnect(silent) {
  API.base = location.protocol === "file:" ? "http://localhost:8080" : "";
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 2500);
  try {
    const r = await fetch(API.base + "/api/bootstrap", { signal: ctrl.signal });
    const b = await r.json();
    if (!b || !b.ok) throw new Error("bad payload");
    ingestBootstrap(b);
    /* تاریخچه‌ی قیمت‌ها در bootstrap نیست؛ جدا بگیر */
    try { HISTORY = (await API.req("GET", "/api/price-history")).history || []; } catch (e) { /* ignore */ }
    API.ok = true;
    return true;
  } catch (e) {
    API.ok = false;
    loadDemoData();
    return false;
  } finally {
    clearTimeout(to);
    if (!silent) setConnBadge();
  }
}

function setConnBadge() {
  const b = el("connBadge");
  const banner = el("demoBanner");
  const ver = el("appVer");
  if (ver) ver.textContent = KABIR_VERSION
    ? `کبیر ${fa(KABIR_VERSION)} — رابط وب` : "کبیر — رابط وب";
  if (banner) banner.hidden = API.ok;
  if (!b) return;
  if (API.ok) {
    b.className = "conn ok";
    b.innerHTML = `<span class="dot"></span> متصل به پایگاه‌داده‌ی محلی`;
    b.title = DATA_DIR || "سرور وب کبیر در حال اجراست";
  } else {
    b.className = "conn demo";
    b.innerHTML = `<span class="dot"></span> حالت نمایشی (سرور در دسترس نیست) <button class="conn-retry" id="btnReconnect" type="button">اتصال</button>`;
    const r = el("btnReconnect");
    if (r) r.addEventListener("click", () => reconnectNow(r));
  }
}

/* تلاش مجدد برای اتصال (از نشانگر نوار کناری یا بنر بالای صفحه) */
async function reconnectNow(btn) {
  if (btn) { btn.disabled = true; btn.textContent = "…"; }
  const ok = await tryConnect(true);
  if (ok) {
    toast("به سرور کبیر متصل شد — داده‌ها واقعی هستند", "success");
    if (typeof renderAll === "function") renderAll();
  } else if (btn) {
    btn.disabled = false;
    btn.textContent = "اتصال";
    toast("سرور در دسترس نیست. کبیر را اجرا کنید: python main.py", "warn");
  }
  setConnBadge();
  return ok;
}

/* ------------------------------------------------------- داده‌ی نمایشی */
function loadDemoData() {
  SETTINGS = Object.assign({}, DEMO_SETTINGS);
  DIGITS_FA = String(SETTINGS.persian_digits) === "1";
  CUR.name = SETTINGS.currency === "ریال" ? "ریال" : "تومان";
  CUR.scale = Number(SETTINGS.currency_scale || 1) || 1;

  MATERIALS = _DM.map((r, i) => ({
    id: i + 1, name: r[0], cat: r[1], unit: r[2], price: r[3],
    sheet_width_cm: r[4], sheet_height_cm: r[5], thickness_mm: r[6], width_cm: r[7],
    supplier: r[8], note: "", active: true,
  }));
  const M = (n) => midByName(n);

  STYLES = [
    {
      id: 1, name: "هایگلاس اقتصادی", note: "بدنه ام‌دی‌اف سفید + در هایگلاس ایرانی، یراق معمولی",
      data: {
        body: "ام‌دی‌اف سفید صدفی ۱۶ میل", door: "هایگلاس ایرانی ۱۶ میل",
        back: "فیبر (MDF 3 میل) پشت سفید", banding: "نوار PVC ۲۲ میل سفید",
        hinge: "لولا آرام‌بند معمولی", handle: "دستگیره میله‌ای ۱۲٫۸ سانت",
        leg: "پایه پلاستیکی تنظیم‌دار ۱۰ سانت", shelf_pin: "خار طبقه فلزی",
        countertop: "صفحه ۳ سانت ایرانی (طرح‌دار)", door_model: "اجرت ساخت در هایگلاس (هر لنگه)",
        slide: "ریل ساچمه‌ای معمولی (جفت)", drawer_sheet: "ام‌دی‌اف سفید ۱۶ میل (جعبه کشو)",
        assembly_door: "مونتاژ و رگلاژ در (هر لنگه)", packaging_door: "بسته‌بندی هر لنگه در",
        waste_percent: 8, overhead_percent: 5,
      },
    },
    {
      id: 2, name: "هایگلاس ترک — یراق بلوم", note: "در هایگلاس ترک با لولا و ریل آرام‌بند Blum",
      data: {
        body: "ام‌دی‌اف سفید برفی ۱۶ میل", door: "هایگلاس ترک سفید ۱۶ میل",
        back: "فیبر (MDF 3 میل) پشت سفید", banding: "نوار ABS هایگلاس",
        hinge: "لولا آرام‌بند آلمانی (Blum)", handle: "دستگیره مخفی (پروفیلی)",
        leg: "پایه فلزی تنظیم‌دار ۱۵ سانت", shelf_pin: "خار طبقه فلزی",
        countertop: "صفحه ۵ سانت ترک (ضدخش)", door_model: "اجرت ساخت در هایگلاس (هر لنگه)",
        slide: "ریل تاندم آرام‌بند (جفت)", drawer_sheet: "ام‌دی‌اف سفید ۱۶ میل (جعبه کشو)",
        assembly_door: "مونتاژ و رگلاژ در (هر لنگه)", packaging_door: "بسته‌بندی هر لنگه در",
        waste_percent: 8, overhead_percent: 5,
      },
    },
    {
      id: 3, name: "ممبران کلاسیک", note: "در CNC ممبران با تاج ابزارخور",
      data: {
        body: "ام‌دی‌اف طرح چوب راش ۱۶ میل", door: "ورق پایه ممبران (خام CNC)",
        back: "فیبر (MDF 3 میل) پشت طرح چوب", banding: "نوار PVC ۲۲ میل طرح چوب",
        hinge: "لولا آرام‌بند ترک", handle: "دستگیره میله‌ای ۱۶ سانت",
        leg: "پایه فلزی تنظیم‌دار ۱۵ سانت", countertop: "صفحه کورین (Corian)",
        door_model: "اجرت CNC در ممبران (هر م²)", crown: "تاج ابزارخور (CNC)",
        slide: "ریل تاندم آرام‌بند (جفت)", drawer_sheet: "ام‌دی‌اف سفید ۱۶ میل (جعبه کشو)",
        waste_percent: 10, overhead_percent: 6,
      },
    },
    {
      id: 4, name: "بدنه و در هم‌رنگ (ملامینه)", note: "اقتصادی، مناسب سرویس و انباری",
      data: {
        body: "ام‌دی‌اف ضدآب (MR) ۱۶ میل", door: "ام‌دی‌اف ملامینه (در هم‌رنگ بدنه)",
        back: "فیبر (MDF 3 میل) پشت سفید", banding: "نوار PVC ۲۲ میل سفید",
        hinge: "لولا آرام‌بند ترک", handle: "دستگیره دکمه‌ای",
        leg: "پایه پلاستیکی تنظیم‌دار ۱۰ سانت", countertop: "صفحه ۵ سانت ایرانی",
        door_model: "اجرت ساخت در ملامینه (هر لنگه)", slide: "ریل ساچمه‌ای معمولی (جفت)",
        drawer_sheet: "ام‌دی‌اف سفید ۱۶ میل (جعبه کشو)", waste_percent: 8, overhead_percent: 4,
      },
    },
  ];

  const door = (qty, w, h, extra) => Object.assign(defaultDoor(), {
    qty, w_cm: w, h_cm: h, material_id: M("هایگلاس ترک سفید ۱۶ میل"),
    door_model_id: M("اجرت ساخت در هایگلاس (هر لنگه)"),
    hinge_id: M("لولا آرام‌بند آلمانی (Blum)"), handle_id: M("دستگیره مخفی (پروفیلی)"),
    banding_id: M("نوار ABS هایگلاس"), assembly_id: M("مونتاژ و رگلاژ در (هر لنگه)"),
    packaging_id: M("بسته‌بندی هر لنگه در"),
  }, extra || {});
  const unit = (label, type, w, h, d, qty, shelves, extra) => Object.assign(defaultUnit(), {
    label, unit_type: type, length_cm: w, height_cm: h, depth_cm: d, qty, shelves,
    body_id: M("ام‌دی‌اف سفید برفی ۱۶ میل"), back_id: M("فیبر (MDF 3 میل) پشت سفید"),
    banding_id: M("نوار ABS هایگلاس"), leg_id: type === "wall" ? 0 : M("پایه فلزی تنظیم‌دار ۱۵ سانت"),
    shelf_pin_id: M("خار طبقه فلزی"), assembly_id: M("سوراخ‌کاری و مونتاژ (هر یونیت)"),
  }, extra || {});

  PROJECTS = [
    normalizeProject({
      id: 1, code: "PR-1405-001", title: "کابینت آشپزخانه — واحد ۵", customer: "خانم رضایی",
      mobile: "۰۹۱۲۳۴۵۶۷۸۰", phone: "۰۲۱-۴۴۵۵۶۶۷۷", address: "تهران، سعادت‌آباد، بلوار دریا، پلاک ۴۲",
      status: "open", date: "۱۴۰۵/۰۷/۲۸", valid_until: "۱۴۰۵/۰۸/۱۵",
      profit_mode: "markup", profit_percent: 25, install_mode: "per_meter", install_value: 350000,
      discount_percent: 3, vat_enabled: true, vat_percent: 10,
      pages: [{
        name: "بخش ۱", style_id: 2, style_name: "هایگلاس ترک — یراق بلوم", countertop_lm: 4.5,
        detail_mode: "detailed",
        detail_rows: [{ label: "زیرچراغ با جای SMD", qty: 3, w_cm: 10, h_cm: 100, price_per_sqm: 2450000 }],
        units: [
          unit("یونیت زمینی ۹۰ (زیر سینک)", "ground", 90, 72, 55, 1, 0, {
            countertop_id: M("صفحه ۵ سانت ترک (ضدخش)"), kickboard_id: M("پاخور آلومینیومی"),
            doors: [door(2, 44, 70)],
            drawers: [],
          }),
          unit("یونیت زمینی ۶۰ — ۳ کشو", "ground", 60, 72, 55, 2, 0, {
            countertop_id: M("صفحه ۵ سانت ترک (ضدخش)"), kickboard_id: M("پاخور آلومینیومی"),
            doors: [],
            drawers: [Object.assign(defaultDrawer(), {
              qty: 3, w_cm: 56, h_cm: 18, d_cm: 45,
              slide_id: M("ریل تاندم آرام‌بند (جفت)"), sheet_id: M("ام‌دی‌اف سفید ۱۶ میل (جعبه کشو)"),
              front_id: M("هایگلاس ترک سفید ۱۶ میل"), handle_id: M("دستگیره مخفی (پروفیلی)"),
              banding_id: M("نوار ABS هایگلاس"),
            })],
          }),
          unit("یونیت دیواری ۶۰", "wall", 60, 70, 30, 3, 1, {
            underlight_id: M("زیرچراغ با جای SMD"),
            doors: [door(1, 59, 69)],
          }),
          unit("کمد ایستاده ۶۰ (فر و مایکرو)", "tall", 60, 220, 58, 1, 2, {
            crown_id: M("تاج ام‌دی‌اف ساده"),
            doors: [door(2, 59, 105, { handle_id: M("دستگیره میله‌ای ۱۶ سانت") })],
          }),
        ],
        extras: [
          { label: "سطل زباله ریلی دو مخزن", qty: 1, unit: "piece", price: 1980000, visible: true },
          { label: "نورپردازی SMD (با ترانس)", qty: 3, unit: "lm", price: 385000, visible: true },
          { label: "آبچکان استیل داخل کابینت", qty: 1, unit: "piece", price: 1250000, visible: true },
        ],
        services: [
          { label: "حمل تا محل (سرویس)", basis: "fixed", price: 850000 },
          { label: "بازدید و اندازه‌گیری", basis: "fixed", price: 350000 },
          { label: "طراحی سه‌بعدی", basis: "fixed", price: 1500000 },
        ],
      }],
    }),
    normalizeProject({
      id: 2, code: "PR-1405-002", title: "کمد دیواری و جاکفشی", customer: "آقای موسوی",
      mobile: "۰۹۳۵۱۱۱۲۲۳۳", address: "کرج، مهرویلا، خیابان دوازدهم",
      status: "open", date: "۱۴۰۵/۰۷/۲۰", valid_until: "۱۴۰۵/۰۸/۱۰",
      profit_mode: "markup", profit_percent: 30, install_mode: "fixed", install_value: 1800000,
      vat_enabled: false, extra_fixed_amount: 500000,
      pages: [{
        name: "بخش ۱", style_id: 4, style_name: "بدنه و در هم‌رنگ (ملامینه)",
        units: [
          Object.assign(unit("کمد دیواری ۹۰", "tall", 90, 240, 60, 2, 3, {
            body_id: M("ام‌دی‌اف ضدآب (MR) ۱۶ میل"), banding_id: M("نوار PVC ۲۲ میل سفید"),
          }), {
            doors: [Object.assign(defaultDoor(), {
              qty: 2, w_cm: 44, h_cm: 235, material_id: M("ام‌دی‌اف ملامینه (در هم‌رنگ بدنه)"),
              door_model_id: M("اجرت ساخت در ملامینه (هر لنگه)"), hinge_id: M("لولا آرام‌بند ترک"),
              handle_id: M("دستگیره میله‌ای ۱۶ سانت"), banding_id: M("نوار PVC ۲۲ میل سفید"),
            })],
          }),
          Object.assign(unit("جاکفشی ۸۰", "ground", 80, 45, 35, 1, 2, {
            body_id: M("ام‌دی‌اف ضدآب (MR) ۱۶ میل"), banding_id: M("نوار PVC ۲۲ میل سفید"),
            leg_id: M("پایه پلاستیکی تنظیم‌دار ۱۰ سانت"),
          }), {
            doors: [Object.assign(defaultDoor(), {
              qty: 2, w_cm: 39, h_cm: 43, material_id: M("ام‌دی‌اف ملامینه (در هم‌رنگ بدنه)"),
              hinge_id: M("لولا آرام‌بند ترک"), handle_id: M("دستگیره دکمه‌ای"),
              banding_id: M("نوار PVC ۲۲ میل سفید"),
            })],
          }),
        ],
        extras: [], services: [{ label: "حمل تا محل (سرویس)", basis: "fixed", price: 850000 }],
      }],
    }),
    normalizeProject({
      id: 3, code: "PR-1405-003", title: "آشپزخانه هایگلاس — بازسازی", customer: "آقای کریمی",
      mobile: "۰۹۱۲۷۷۷۸۸۹۹", address: "تهران، ونک، خیابان ملاصدرا",
      status: "done", date: "۱۴۰۵/۰۶/۱۲", valid_until: "۱۴۰۵/۰۷/۰۱",
      profit_mode: "markup", profit_percent: 25, install_mode: "per_meter", install_value: 300000,
      discount_percent: 5, vat_enabled: true, vat_percent: 10,
      pages: [{
        name: "بخش ۱", style_id: 1, style_name: "هایگلاس اقتصادی", countertop_lm: 3,
        units: [
          Object.assign(unit("یونیت زمینی ۸۰", "ground", 80, 72, 55, 2, 1, {
            body_id: M("ام‌دی‌اف سفید صدفی ۱۶ میل"), countertop_id: M("صفحه ۵ سانت ایرانی"),
            kickboard_id: M("پاخور پی‌وی‌سی (PVC)"), leg_id: M("پایه پلاستیکی تنظیم‌دار ۱۰ سانت"),
            banding_id: M("نوار PVC ۲۲ میل سفید"),
          }), {
            doors: [Object.assign(defaultDoor(), {
              qty: 2, w_cm: 39, h_cm: 70, material_id: M("هایگلاس ایرانی ۱۶ میل"),
              hinge_id: M("لولا آرام‌بند معمولی"), handle_id: M("دستگیره میله‌ای ۱۲٫۸ سانت"),
              banding_id: M("نوار PVC ۲۲ میل سفید"),
            })],
            drawers: [Object.assign(defaultDrawer(), {
              qty: 1, w_cm: 36, slide_id: M("ریل ساچمه‌ای معمولی (جفت)"),
              sheet_id: M("ام‌دی‌اف سفید ۱۶ میل (جعبه کشو)"), front_id: M("هایگلاس ایرانی ۱۶ میل"),
              handle_id: M("دستگیره میله‌ای ۱۲٫۸ سانت"),
            })],
          }),
          Object.assign(unit("یونیت دیواری ۸۰", "wall", 80, 70, 30, 2, 1, {
            body_id: M("ام‌دی‌اف سفید صدفی ۱۶ میل"), banding_id: M("نوار PVC ۲۲ میل سفید"),
          }), {
            doors: [Object.assign(defaultDoor(), {
              qty: 2, w_cm: 39, h_cm: 69, material_id: M("هایگلاس ایرانی ۱۶ میل"),
              hinge_id: M("لولا آرام‌بند معمولی"), handle_id: M("دستگیره میله‌ای ۱۲٫۸ سانت"),
              banding_id: M("نوار PVC ۲۲ میل سفید"),
            })],
          }),
        ],
        extras: [], services: [{ label: "حمل تا محل (سرویس)", basis: "fixed", price: 850000 }],
      }],
    }),
  ];
  HISTORY = [
    { id: 6, date: "۱۴۰۵/۰۷/۳۰", name: "هایگلاس ترک سفید ۱۶ میل", old: 8900000, price: 9500000, pct: 6.7, reason: "به‌روزرسانی نرخ بازار" },
    { id: 5, date: "۱۴۰۵/۰۷/۳۰", name: "هایگلاس ترک طرح‌دار ۱۶ میل", old: 10100000, price: 10800000, pct: 6.9, reason: "به‌روزرسانی نرخ بازار" },
    { id: 4, date: "۱۴۰۵/۰۷/۲۲", name: "لولا آرام‌بند آلمانی (Blum)", old: 265000, price: 285000, pct: 7.5, reason: "افزایش نرخ یراق وارداتی" },
    { id: 3, date: "۱۴۰۵/۰۷/۱۵", name: "نوار ABS هایگلاس", old: 60000, price: 64000, pct: 6.7, reason: "لیست جدید تأمین‌کننده" },
    { id: 2, date: "۱۴۰۵/۰۷/۰۲", name: "ام‌دی‌اف سفید صدفی ۱۶ میل", old: 5100000, price: 4850000, pct: -4.9, reason: "تخفیف فصلی تأمین‌کننده" },
  ];
  ARCHIVE = [
    { id: 4, number: "PI-1405-0004", kind: "quote", kind_label: "پیش‌فاکتور", project: "کابینت آشپزخانه — واحد ۵", customer: "خانم رضایی", date: "۱۴۰۵/۰۷/۲۹", amount: 214500000 },
    { id: 3, number: "INV-1405-0003", kind: "invoice", kind_label: "فاکتور فروش", project: "آشپزخانه هایگلاس — بازسازی", customer: "آقای کریمی", date: "۱۴۰۵/۰۶/۲۰", amount: 96400000 },
    { id: 2, number: "PI-1405-0002", kind: "quote", kind_label: "پیش‌فاکتور", project: "کمد دیواری و جاکفشی", customer: "آقای موسوی", date: "۱۴۰۵/۰۷/۲۱", amount: 78200000 },
  ];
  BACKUPS = [
    { name: "kabir-auto-14050801.db", date: "۱۴۰۵/۰۸/۰۱ — ۰۸:۱۲", size: "۱٬۲۴۰ کیلوبایت", auto: true },
    { name: "kabir-auto-14050731.db", date: "۱۴۰۵/۰۷/۳۱ — ۰۸:۰۵", size: "۱٬۲۳۸ کیلوبایت", auto: true },
    { name: "kabir-manual-14050728.db", date: "۱۴۰۵/۰۷/۲۸ — ۱۹:۴۳", size: "۱٬۲۳۰ کیلوبایت", auto: false },
  ];
  DASH = null;

  /* بازیابی داده‌های ذخیره‌شده‌ی حالت نمایشی (localStorage) */
  try {
    const saved = JSON.parse(localStorage.getItem("kabir-demo-db") || "null");
    if (saved) {
      if (saved.materials && saved.materials.length) MATERIALS = saved.materials;
      if (saved.styles && saved.styles.length) STYLES = saved.styles;
      if (saved.projects && saved.projects.length) PROJECTS = saved.projects.map(normalizeProject);
      if (saved.history) HISTORY = saved.history;
      if (saved.archive) ARCHIVE = saved.archive;
      if (saved.unit_templates) UNIT_TEMPLATES = saved.unit_templates;
      if (saved.settings) {
        SETTINGS = Object.assign({}, DEMO_SETTINGS, saved.settings);
        DIGITS_FA = String(SETTINGS.persian_digits) === "1";
        CUR.name = SETTINGS.currency === "ریال" ? "ریال" : "تومان";
        CUR.scale = Number(SETTINGS.currency_scale || 1) || 1;
      }
    }
  } catch (e) { /* داده‌ی خراب — همان نمونه‌ها */ }

  /* محاسبه‌ی مبلغ نهایی پروژه‌های نمایشی با نرخ‌های جاری */
  for (const p of PROJECTS) {
    const r = calcProjectLocal(p);
    p.final_price = r.final_price;
    p.total_cost = r.total_cost;
  }
}
