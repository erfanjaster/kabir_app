/* ==========================================================================
   کبیر ۲ — engine.js
   موتور محاسبه‌ی محلی (آینه‌ی kabir/core/costing.py) برای:
     ۱) حالت نمایشی (بدون سرور)
     ۲) بازخورد فوری تا رسیدن پاسخ سرور
   خروجی دقیقاً هم‌شکل ProjectResult سرور است:
     {total_cost, gross_price, final_price, items[], stats{}, ...}
   ========================================================================== */
"use strict";

function _n(v, d) { const x = parseFloat(v); return isFinite(x) ? x : (d || 0); }

/* ★ سه هلپرِ تازه — آینه‌ی `_f` / `_i` / `_pos` در kabir/core/costing.py.
   `_n` به‌تنهایی کافی نبود چون «مقدار ناموجود» و «مقدارِ موجود ولی خراب» را
   یکسان به پیش‌فرض می‌برد؛ موتور پایتون این دو را جدا می‌کند:
     ناموجود (undefined/null/"")  → پیش‌فرضِ خودِ فیلد
     خراب     (NaN / Infinity)    → صفر (و در calc_unit هشدار می‌گیرد)
   بدون این تفکیک، یک فیلد خالی در مرورگر قیمت می‌خورد و روی سرور حذف می‌شد. */
function _co(v, miss, bad) {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return miss;
  const x = parseFloat(v);
  return isFinite(x) ? x : (bad === undefined ? 0 : bad);
}
function _ci(v, miss, bad) { return Math.trunc(_co(v, miss, bad === undefined ? 0 : bad)); }
/* عددِ نامنفی — برای ابعاد/تعدادها/ضرایب فیزیکی. منفی‌ها پیش‌تر مساحت منفی و
   در نتیجه «قیمت کل منفی» می‌ساختند (−380,820 روی سند مالی). */
function _pos(v, d) { const x = _n(v, d === undefined ? 0 : d); return x > 0 ? x : 0; }
/* ★ بولین — آینه‌ی شاخه‌ی `bools` در `_coerce` پایتون.
   «ناموجود» → پیش‌فرض (معمولاً true)؛ «موجود» → ارزشِ درستیِ خودش.
   پیش‌تر از `!== false` استفاده می‌شد که `0` و `""` را **درست** می‌گرفت، در
   حالی که پایتون `if u.has_bottom_panel:` آن‌ها را **نادرست** می‌گرفت. نتیجه:
   با `has_bottom_panel: 0` موتور JS یک ورقِ اضافه و ۲ برابر قیمت می‌داد. */
function _bool(v, d) {
  if (v === undefined || v === null) return d !== false;
  if (typeof v === "string") { const t = v.trim().toLowerCase(); return !(t === "" || t === "0" || t === "false" || t === "no" || t === "off"); }
  return !!v;
}

/* ثبتِ متنِ پایه‌ی «detail» هر ردیفِ ورقی — برای idempotent بودنِ
   batchSheetsLocal وقتی دو بار (بخش، سپس کل پروژه) صدا زده می‌شود. */
const SHEET_DETAIL_BASE = new Map();

function engineItem(key, group, title, detail, qty, unit_label, unit_price, amount, visible, extra) {
  return Object.assign({
    key, group, title, detail: detail || "", qty: _n(qty), unit_label: unit_label || "",
    unit_price: _n(unit_price), amount: _n(amount), visible: visible !== false,
    mat_id: 0, mat_cat: "", area_sqm: 0, sheet_area_sqm: 0, sheets: 0,
  }, extra || {});
}

/* ---------------------------------------------------------------------------
   تجمیع ورق‌ها — آینه‌ی CostingEngine.batch_sheets در kabir/core/costing.py
   همه‌ی قطعات هم‌جنسِ یک بخش روی ورق‌های مشترک برش می‌خورند، پس تعداد ورق
   یک‌بار گرد می‌شود (نه برای هر یونیت). دورریزِ یک یونیت تکه‌ی یونیت بعدی است.
   --------------------------------------------------------------------------- */
const SHEET_ITEM_KEYS = ["body_sheet", "back_sheet", "door_sheet", "drawer_front", "drawer_box"];

function batchSheetsLocal(pItems, scope) {
  const SCOPE = scope || "این بخش";
  const groups = new Map();
  for (const it of pItems) {
    if (SHEET_ITEM_KEYS.includes(it.key) && it.mat_id && _n(it.sheet_area_sqm) > 0) {
      if (!groups.has(it.mat_id)) groups.set(it.mat_id, []);
      groups.get(it.mat_id).push(it);
    }
  }
  let total = 0;
  for (const [mid, its] of groups) {
    const m = matById(mid);
    const gross = its.reduce((a, i) => a + _pos(i.area_sqm), 0);
    const net = its.reduce((a, i) => a + _pos(i.qty), 0);
    const sa = _n(its[0].sheet_area_sqm);
    if (gross <= 0 || sa <= 0) continue;
    const sheets = Math.ceil(Math.round((gross / sa) * 1e6) / 1e6);
    const price = m ? _n(m.price) : 0;
    const cost = sheets * price;
    const eff = net > 0 ? cost / net : 0;
    const size = m ? `${fmt(_n(m.sheet_width_cm))}×${fmt(_n(m.sheet_height_cm))}` : "";
    for (const i of its) {
      const share = gross ? _pos(i.area_sqm) / gross : 0;
      i.sheets = sheets * share;
      i.unit_label = "م²";
      i.unit_price = eff;
      i.amount = cost * share;
      let base = SHEET_DETAIL_BASE.get(i);
      if (base === undefined) { base = i.detail || ""; SHEET_DETAIL_BASE.set(i, base); }
      i.detail = base + ` — از ${fa(sheets)} ورق ${size}ِ ${SCOPE}`;
    }
    total += sheets;
  }
  return total;
}

/* ★ پاسِ دومِ تجمیع ورق در سطح **کل پروژه** (آینه‌ی repool_sheets_project در
   costing.py — رفع باگ F-01). ورقِ یک متریال در کارگاه یک‌جا برش می‌خورد، نه
   بخش‌بخش؛ بدون این پاس، تقسیمِ یک آشپزخانه به N بخش تعداد ورق را تا N برابر
   باد می‌کرد. چون ceil(Σ) ≤ Σ ceil است، این پاس هرگز قیمت را بالا نمی‌برد. */
function repoolSheetsProjectLocal(pageResults) {
  if (pageResults.length < 2) return false;
  const all = [];
  for (const pr of pageResults) for (const i of pr.items) all.push(i);
  const before = new Map(all.map((i) => [i, [i.amount, i.sheets]]));
  batchSheetsLocal(all, "کل پروژه");
  for (const i of all) {
    const b = before.get(i);
    if (b && (Math.abs(b[0] - i.amount) > 1e-6 || Math.abs(b[1] - i.sheets) > 1e-9)) return true;
  }
  return false;
}

/* دسته‌هایی که قیمتشان بر مبنای ورق است — هم‌راستا با SHEET_CATEGORIES پایتون */
const SHEET_CATS = ["body_sheet", "door_sheet", "back_sheet", "drawer_sheet"];

/* ★ آینه‌ی CostingEngine._sheet_price_check در costing.py.
   قلمی که واحدش «ورق» است ولی ابعاد ورق ندارد، pricePerSqm = 0 می‌دهد و در
   نتیجه کل بدنه **رایگان و بی‌صدا** محاسبه می‌شد. حالتِ معکوسش هم بود: قلمی
   با دسته‌ی ورق و واحد «عدد»، قیمتِ هر عدد را به‌جای قیمتِ هر مترمربع ضرب
   می‌کرد. هر دو حالا هشدارِ صریح می‌گیرند. */
function sheetPriceCheck(m, what, areaTotal, warns) {
  const pp = pricePerSqm(m);
  if (!m) return pp;
  const warnings = warns || [];
  const hasDims = _pos(m.sheet_width_cm) > 0 && _pos(m.sheet_height_cm) > 0;
  if (m.unit === "sheet" && !hasDims) {
    warnings.push(`«${m.name}» به‌عنوان ${what} انتخاب شده ولی ابعاد ورقِ آن ثبت نشده است — قیمتِ هر مترمربع صفر به دست می‌آید و ${fmt(areaTotal, 1)} م² ${what} رایگان محاسبه شد! ابعاد ورق را در کتابخانه‌ی قیمت‌ها کامل کنید.`);
  } else if (SHEET_CATS.includes(m.cat || m.category) && m.unit !== "sheet" && m.unit !== "sqm") {
    /* ⚠ کلیدِ دسته در رابط وب و در JSON سرور ``cat`` است (نه ``category``) —
       هر دو پذیرفته می‌شوند تا این هشدار در مرورگر هم واقعاً اجرا شود. */
    warnings.push(`«${m.name}» در دسته‌ی ${what} است ولی واحدش «${m.unit}» ثبت شده — قیمتِ هر عدد به‌جای قیمتِ هر مترمربع در محاسبه می‌رود و مبلغ درست نیست.`);
  } else if (pp <= 0) {
    warnings.push(`«${m.name}» (${what}) قیمتِ مؤثرِ صفر دارد — ${fmt(areaTotal, 1)} م² بدون هزینه ثبت شد.`);
  }
  return pp;
}

/* ★ آیا یک لنگه‌ی در روی این ورق جا می‌شود؟ (شرطِ لازم برای «در از ورق بدنه»)
   هم‌راستا با costing.door_leaf_fits_sheet در موتور پایتون.
   ورقِ طرح‌دار (راستای نقش) فقط «بدون چرخش» قابل برش است — وگرنه نقش کج
   می‌افتد؛ پس چرخاندنِ لنگه روی آن مجاز نیست.                                */
function doorLeafFitsSheet(dr, mat) {
  if (!mat) return { ok: false, why: "ورق بدنه‌ی یونیت انتخاب نشده است." };
  if (mat.unit !== "sheet") return { ok: false, why: `«${mat.name}» ورق نیست.` };
  const sw = _n(mat.sheet_width_cm), sh = _n(mat.sheet_height_cm);
  if (sw <= 0 || sh <= 0) return { ok: false, why: `ابعاد ورقِ «${mat.name}» ثبت نشده است.` };
  const w = _n(dr.w_cm), h = _n(dr.h_cm);
  if (w <= 0 || h <= 0) return { ok: false, why: "ابعاد لنگه‌ی در وارد نشده است." };
  if (w <= sw && h <= sh) return { ok: true, why: "" };
  if (w <= sh && h <= sw) {
    if (_isGrain(mat)) return { ok: false, why: `«${mat.name}» راستای طرح دارد؛ لنگه‌ی ${fmt(w)}×${fmt(h)} سانت فقط با چرخاندن روی ورق ${fmt(sw)}×${fmt(sh)} جا می‌شود و طرح کج می‌افتد.` };
    return { ok: true, why: "" };
  }
  return { ok: false, why: `لنگه‌ی ${fmt(w)}×${fmt(h)} سانت روی ورق ${fmt(sw)}×${fmt(sh)} سانت جا نمی‌شود.` };
}

function calcProjectLocal(project) {
  const S = SETTINGS;

  const items = [];
  const stats = { total_units: 0, total_doors: 0, total_drawers: 0, total_ground_lm: 0,
                  total_wall_lm: 0, total_body_area: 0, total_door_area: 0, total_back_area: 0,
                  total_banding_m: 0, total_sheets: 0 };
  const pageResults = [];
  const warnings = [];
  let pagesCost = 0;
  /* متنِ پایه‌ی «detail» هر ردیفِ ورقی — چون batchSheetsLocal حالا دو بار
     صدا زده می‌شود (یک‌بار برای بخش، یک‌بار برای کل پروژه). */
  SHEET_DETAIL_BASE.clear();
  /* بخش‌هایی که جمع‌بندیشان به پاسِ ۲ موکول شده است. */
  const deferred = [];

  for (const page of project.pages || []) {
    const pItems = [];
    let detailCost = 0;   /* جمع/سربار در پاسِ ۲ ساخته می‌شود */
    const pr = { name: page.name, items: pItems, total_units: 0, total_doors: 0, total_drawers: 0,
                 total_ground_lm: 0, total_wall_lm: 0, total_sheets: 0, total_body_area: 0,
                 total_door_area: 0, total_back_area: 0, total_banding_m: 0,
                 subtotal: 0, overhead_amount: 0, total_cost: 0 };
    /* ★ پرت/ضریبِ منفی پیش‌تر مساحت و متراژ منفی می‌ساخت و بی‌صدا از جمع کل
       کم می‌شد. همه کرانِ صفر دارند و هشدارش به کاربر می‌رسد. */
    const _wasteRaw = _n(page.waste_percent, 10);
    const waste = _wasteRaw < 0 ? (warnings.push(`پرتِ ورق منفی (${fmt(_wasteRaw)}٪) بود — صفر در نظر گرفته شد.`), 0) : _wasteRaw;
    const _bbfRaw = _n(page.banding_body_factor, 2.2);
    const BAND_BODY_F = _bbfRaw < 0 ? (warnings.push(`ضریب نوار بدنه منفی (${fmt(_bbfRaw)}) بود — صفر در نظر گرفته شد.`), 0) : _bbfRaw;
    const BAND_WASTE = _pos(page.banding_waste_percent, 8);
    /* ★ ضریب نوار در — هم‌راستا با موتور پایتون (پیش‌تر در هیچ‌کدام اعمال
       نمی‌شد و تنظیمِ بی‌اثر بود). */
    const BAND_DOOR_F = (() => { const f = _n(page.banding_door_factor, 1); return f > 0 ? f : 1; })();

    for (const u of page.units || []) {
      /* ★ تعداد یونیت ≤ ۰ یعنی یونیت کنار گذاشته می‌شود (بدون هزینه) + هشدار.
         پیش‌تر qty=0 یا منفی «یک عدد» قیمت می‌خورد! (هم‌راستا با پایتون) */
      /* هم‌راستا با `_coerce` پایتون: «ناموجود» → پیش‌فرضِ فیلد (۱)،
         «موجود ولی خراب» (NaN/"abc") → ۰ = یونیت کنار گذاشته می‌شود + هشدار. */
      const q0 = _ci(u.qty, 1, 0);
      if (q0 <= 0) {
        warnings.push(`«${u.label || "یونیت"}»: تعداد یونیت ${q0} وارد شده — بدون هزینه نادیده گرفته شد. اگر این یونیت را می‌خواهید، تعداد را دست‌کم ۱ بگذارید.`);
        continue;
      }
      const n = q0;
      /* ★ ابعاد با کرانِ صفر (آینه‌ی `_pos`/`_input_warnings` در costing.py).
         `depth_cm = -55` پیش‌تر مساحت منفی می‌داد و با یک خدمتِ مترمربعی،
         قیمتِ کل پروژه **منفی** می‌شد (−380,820 روی سند مالی). */
      const _ul = u.label || "یونیت";
      [[u.length_cm, "طول"], [u.height_cm, "ارتفاع"], [u.depth_cm, "عمق"]].forEach(([v, nm]) => {
        const raw = _n(v, 0);
        if (raw < 0) warnings.push(`«${_ul}»: ${nm} یونیت منفی (${fmt(raw)} سانتی‌متر) بود — صفر در نظر گرفته شد. ابعاد منفی معنای فیزیکی ندارد و قیمت را خراب می‌کند.`);
        else if (raw === 0 && nm !== "طول") warnings.push(`«${_ul}»: ${nm} یونیت صفر است — مساحت قطعاتِ وابسته به آن صفر شد و هزینه‌ی ورق بدنه محاسبه نمی‌شود!`);
      });
      [["shelves", u.shelves, "تعداد طبقه"], ["legs_per_unit", u.legs_per_unit, "تعداد پایه"],
       ["pins_per_shelf", u.pins_per_shelf, "خار در هر طبقه"]].forEach(([k, v, nm]) => {
        if (v !== undefined && v !== null && _n(v, 0) < 0)
          warnings.push(`«${_ul}»: ${nm} منفی (${fmt(_n(v, 0))}) بود — صفر در نظر گرفته شد.`);
      });
      const L = _pos(u.length_cm), H = _pos(u.height_cm), D = _pos(u.depth_cm);
      const bodyM = matById(u.body_id), backM = matById(u.back_id);
      const t = bodyM ? _pos(bodyM.thickness_mm) / 10 : 0;   // cm
      const INNER = Math.max(0, L - 2 * t);   // عرض مؤثرِ قطعاتِ داخلی (هرگز منفی)
      const SHELVES = _pos(u.shelves);

      /* --- پنل‌های بدنه (مثل panels_of/default_panels پایتون) ---
         ★ اگر کاربر ریز بدنه را دستی عوض کرده باشد (custom_panels)، همان
         ملاک است — پیش‌تر این موتور ریز دستی را نادیده می‌گرفت. */
      let bodyArea = 0, backArea = 0;
      const cp = Array.isArray(u.custom_panels) && u.custom_panels.length ? u.custom_panels : null;
      if (cp) {
        for (const pn of cp) {
          if (!_bool(pn.enabled, true)) continue;
          /* کرانِ صفر: پنلِ منفی پیش‌تر پنلِ مثبتِ کنارش را خنثی می‌کرد. */
          const a = Math.max(0, _n(pn.qty) * (_pos(pn.w_cm) / 100) * (_pos(pn.h_cm) / 100));
          if ((pn.material_key || "body") === "back") backArea += a; else bodyArea += a;
        }
      } else {
        bodyArea += Math.max(0, 2 * (D / 100) * (H / 100));         // دو بغل
        if (_bool(u.has_bottom_panel, true)) bodyArea += (INNER / 100) * (D / 100);
        if (_bool(u.has_top_panel, true) && u.unit_type !== "ground") bodyArea += (INNER / 100) * (D / 100);
        if (u.unit_type === "tall") bodyArea += (INNER / 100) * (D / 100);
        if (SHELVES > 0) bodyArea += SHELVES * (INNER / 100) * (D / 100);
        if (u.back_id) backArea += (L / 100) * (H / 100);
      }

      /* ورق بدنه — تعداد ورق در batchSheetsLocal و در سطح کل بخش گرد می‌شود */
      if (bodyArea > 0 && !bodyM) {
        warnings.push(`«${u.label || "یونیت"}»: ورق بدنه ${u.body_id ? "حذف شده" : "انتخاب نشده"} است — هزینه‌ی ${fmt(bodyArea * n, 1)} م² بدنه محاسبه نشد!`);
      }
      if (bodyArea > 0 && bodyM) {
        const per = bodyArea * (1 + waste / 100);
        const sheetArea = (_pos(bodyM.sheet_width_cm) * _pos(bodyM.sheet_height_cm)) / 10000;
        const net = bodyArea * n, pp = sheetPriceCheck(bodyM, "ورق بدنه", bodyArea * n, warnings);
        if (sheetArea > 0) {
          pItems.push(engineItem("body_sheet", "ورق بدنه", bodyM.name,
            `${fmt(net, 1)} م² (با ${fmt(waste)}٪ پرت)`,
            net, "م²", pp, net * pp, true,
            { mat_id: bodyM.id, mat_cat: "body_sheet", area_sqm: per * n, sheet_area_sqm: sheetArea }));
        } else {
          /* ★ واگراییِ برطرف‌شده: وقتی مساحتِ ورق صفر است (قلمِ بدون ابعاد، یا
             واحدی غیر از «ورق»)، موتور پایتون مبلغ را روی **مساحت با پرت**
             می‌بندد و برچسبش هم همان را می‌گوید («با احتساب X٪ پرت»). این‌جا
             پیش‌تر «مساحت خالص» ضرب می‌شد در حالی که برچسب ادعای پرت داشت —
             یعنی هم عدد و هم توضیحش با هم نمی‌خواندند و ۱۰٪ ارزان‌تر از
             سرور تمام می‌شد. */
          const gross = per * n;
          pItems.push(engineItem("body_sheet", "ورق بدنه", bodyM.name,
            `${fmt(gross, 1)} م² با احتساب ${fmt(waste)}٪ پرت`, gross, "م²", pp, gross * pp, true,
            { mat_id: bodyM.id, mat_cat: "body_sheet", area_sqm: gross }));
        }
      }
      pr.total_body_area += bodyArea * n;

      /* فیبر پشت */
      if (backArea > 0 && !backM) {
        warnings.push(`«${u.label || "یونیت"}»: متریال فیبر پشت ${u.back_id ? "حذف شده" : "انتخاب نشده"} است — هزینه‌ی ${fmt(backArea * n, 1)} م² فیبر پشت محاسبه نشد!`);
      }
      if (backArea > 0 && backM) {
        const per = backArea * (1 + waste / 100);
        const sheetArea = (_pos(backM.sheet_width_cm) * _pos(backM.sheet_height_cm)) / 10000;
        const net = backArea * n, pp = sheetPriceCheck(backM, "فیبر پشت", backArea * n, warnings);
        if (sheetArea > 0) {
          pItems.push(engineItem("back_sheet", "فیبر پشت", backM.name,
            `${fmt(net, 1)} م² (با ${fmt(waste)}٪ پرت)`, net, "م²", pp, net * pp, true,
            { mat_id: backM.id, mat_cat: "back_sheet", area_sqm: per * n,
              sheet_area_sqm: sheetArea }));
        } else {
          /* هم‌سان با شاخه‌ی ورق بدنه: بدونِ مساحتِ ورق، مبلغ روی مساحتِ با پرت
             بسته می‌شود تا دو موتور یکی بمانند (پیش‌تر این شاخه در JS اصلاً
             وجود نداشت و همیشه «خالص» ضرب می‌شد). */
          const gross = per * n;
          pItems.push(engineItem("back_sheet", "فیبر پشت", backM.name,
            `${fmt(gross, 1)} م²`, gross, "م²", pp, gross * pp, true,
            { mat_id: backM.id, mat_cat: "back_sheet", area_sqm: gross }));
        }
      }
      pr.total_back_area += backArea * n;

      /* نوار PVC بدنه */
      if (bodyArea > 0 && u.banding_id) {
        const bm = matById(u.banding_id);
        const meters = bodyArea * n * BAND_BODY_F * (1 + BAND_WASTE / 100);
        const bprice = bm ? _n(bm.price) : _n(u.banding_price);
        const bname = bm ? bm.name : (u.banding_name || "نوار PVC");
        pItems.push(engineItem("banding_body", "نوار PVC بدنه", bname,
          `ضریب ${fa(BAND_BODY_F)} × مساحت بدنه + ${fmt(BAND_WASTE)}٪ پرت`,
          meters, "متر", bprice, meters * bprice));
        pr.total_banding_m += meters;
      }

      /* --- درها --- */
      for (const dr of u.doors || []) {
        /* هم‌راستا با `_coerce` پایتون: پیش‌فرضِ فیلدِ qty در DoorRow برابر ۲
           است (نه صفر) — پیش‌تر یک درِ بدونِ تعداد در مرورگر حذف و در سرور
           «۲ لنگه» قیمت می‌خورد. */
        const leaves = Math.max(0, _ci(dr.qty, 2, 0)) * n;
        if (leaves <= 0) continue;
        const area = leaves * (_pos(dr.w_cm) / 100) * (_pos(dr.h_cm) / 100);
        pr.total_door_area += area;
        /* ★ «در از ورق بدنه»: مساحت لنگه‌ها به دسته‌ی ورق بدنه می‌رود تا با
           بقیه‌ی قطعات یک‌جا گرد شود (ورق کم‌تر = قیمت کم‌تر). اگر لنگه روی ورق
           جا نشود، تیک نادیده گرفته می‌شود و هشدار می‌دهیم.                     */
        let dmat = matById(dr.material_id);
        let useBody = false;
        if (dr.from_body) {
          const fit = doorLeafFitsSheet(dr, bodyM);
          if (fit.ok) { useBody = true; dmat = bodyM; }
          else {
            warnings.push(`«${dr.label || "در"}»: تیکِ «در از ورق بدنه» نادیده گرفته شد — ${fit.why}`);
            /* ★ باگِ «لنگه‌ی درِ کاملاً رایگان»: در حالتِ پیش‌فرضِ رابط
               material_id = 0 است (و چون تیک خورده، انتخابگرِ متریالِ در هم
               پنهان می‌شود). پس نه ورقِ بدنه مصرف شد نه ورقِ در، و شاخه‌ی
               `else if (dr.material_id)` هم چون شناسه صفر بود هشدار نمی‌داد. */
            if (!dmat && !_n(dr.material_id)) {
              warnings.push(`«${dr.label || "در"}»: متریالی برای ${fmt(leaves)} لنگه در (${fmt(area, 1)} م²) انتخاب نشده — ورق در **رایگان** محاسبه شد! یا متریالِ در را انتخاب کنید یا ابعاد لنگه را کوچک‌تر از ورق بدنه بگیرید.`);
            }
          }
        }
        if (useBody && dmat) {
          const sa = (_pos(dmat.sheet_width_cm) * _pos(dmat.sheet_height_cm)) / 10000;
          const pp = sheetPriceCheck(dmat, "ورق بدنه (در)", area, warnings);
          if (sa > 0) {
            pItems.push(engineItem("body_sheet", "ورق بدنه", dmat.name,
              `در از ورق بدنه — ${fmt(leaves)} لنگه، ${fmt(area, 1)} م² (با ${fmt(waste)}٪ پرت)`,
              area, "م²", pp, area * pp, true,
              { mat_id: dmat.id, mat_cat: "body_sheet", area_sqm: area * (1 + waste / 100), sheet_area_sqm: sa }));
          } else {
            pItems.push(engineItem("body_sheet", "ورق بدنه", dmat.name,
              `در از ورق بدنه — ${fmt(leaves)} لنگه، ${fmt(area, 1)} م²`,
              area, "م²", pp, area * pp, true,
              { mat_id: dmat.id, mat_cat: "body_sheet", area_sqm: area }));
          }
        } else if (dmat) {
          const sa = (_pos(dmat.sheet_width_cm) * _pos(dmat.sheet_height_cm)) / 10000;
          const pp = sheetPriceCheck(dmat, "ورق در", area, warnings);
          if (dmat.unit === "sheet" && sa > 0) {
            pItems.push(engineItem("door_sheet", "ورق در", dmat.name,
              `${fmt(leaves)} لنگه — ${fmt(area, 1)} م² (با ${fmt(waste)}٪ پرت)`,
              area, "م²", pp, area * pp, true,
              { mat_id: dmat.id, mat_cat: "door_sheet", area_sqm: area * (1 + waste / 100), sheet_area_sqm: sa }));
          } else {
            pItems.push(engineItem("door_sheet", "ورق در", dmat.name, `${fmt(leaves)} لنگه — ${fmt(area, 1)} م²`, area, "م²", pp, area * pp, true,
              { mat_id: dmat.id, mat_cat: "door_sheet", area_sqm: area }));
          }
        } else if (dr.material_id) {
          warnings.push(`«${dr.label || "در"}»: متریال در (${dr.material_name || "شناسهٔ " + dr.material_id}) در کتابخانه قیمت پیدا نشد — هزینه‌ی ${fmt(area, 1)} م² ورق در محاسبه نشد!`);
        }
        const dmodel = matById(dr.door_model_id);
        if (dr.door_model_id || _n(dr.door_model_price)) {
          const dmp = dmodel ? _n(dmodel.price) : _n(dr.door_model_price);
          const dmn = dmodel ? dmodel.name : (dr.door_model_name || "اجرت ساخت در");
          /* اجرت‌های «مترمربعی» (CNC/رنگ) بر اساس مساحت در حساب می‌شوند */
          const bySqm = dmodel && dmodel.unit === "sqm";
          const dq = bySqm ? area : leaves;
          pItems.push(engineItem("door_model", "مدل و اجرت در", dmn,
            `${fmt(leaves)} لنگه` + (bySqm ? ` — ${fmt(area, 1)} م²` : ""),
            dq, bySqm ? "م²" : "لنگه", dmp, dq * dmp));
        }
        if (dr.banding_id) {
          const bm = matById(dr.banding_id);
          const per = 2 * ((_pos(dr.w_cm) + _pos(dr.h_cm)) / 100);
          const meters = per * leaves * BAND_DOOR_F * (1 + BAND_WASTE / 100);
          if (bm) {
            pItems.push(engineItem("banding_door", "نوار PVC در", bm.name,
              `محیط ${fmt(per, 1)} متر × ${fmt(leaves)} لنگه` + (BAND_DOOR_F !== 1 ? ` × ضریب ${fa(BAND_DOOR_F)}` : ""),
              meters, "متر", bm.price, meters * bm.price));
            pr.total_banding_m += meters;
          }
        }
        if (dr.hinge_id || _n(dr.hinge_price)) {
          const hinge = matById(dr.hinge_id);
          const q = _pos(dr.hinges_per_leaf, 2) * leaves;
          const price = hinge ? _n(hinge.price) : _n(dr.hinge_price);
          const name = hinge ? hinge.name : (dr.hinge_name || "لولا");
          pItems.push(engineItem("hinge", "لولا", name, `${fmt(_n(dr.hinges_per_leaf, 2))} عدد در هر لنگه × ${fmt(leaves)} لنگه`, q, "عدد", price, q * price));
        }
        if ((dr.gas_spring_id || _n(dr.gas_spring_price)) && _n(dr.gas_springs_per_leaf) > 0) {
          const g = matById(dr.gas_spring_id);
          const q = _pos(dr.gas_springs_per_leaf) * leaves;
          const price = g ? _n(g.price) : _n(dr.gas_spring_price);
          const name = g ? g.name : (dr.gas_spring_name || "گازور");
          pItems.push(engineItem("gas_spring", "گازور / جک", name, `${fmt(_n(dr.gas_springs_per_leaf))} عدد در هر لنگه`, q, "عدد", price, q * price));
        }
        if (dr.handle_id || _n(dr.handle_price)) {
          const handle = matById(dr.handle_id);
          const q = _pos(dr.handles_per_leaf, 1) * leaves;
          const price = handle ? _n(handle.price) : _n(dr.handle_price);
          const name = handle ? handle.name : (dr.handle_name || "دستگیره");
          pItems.push(engineItem("handle", "دستگیره", name, `${fmt(leaves)} لنگه`, q, "عدد", price, q * price));
        }
        if (dr.assembly_id || _n(dr.assembly_price)) {
          const asm = matById(dr.assembly_id);
          const price = asm ? _n(asm.price) : _n(dr.assembly_price);
          const name = asm ? asm.name : (dr.assembly_name || "مونتاژ در");
          pItems.push(engineItem("assembly_door", "مونتاژ و خدمات", name, `${fmt(leaves)} لنگه در`, leaves, "لنگه", price, leaves * price));
        }
        if (dr.packaging_id || _n(dr.packaging_price)) {
          const pk = matById(dr.packaging_id);
          const price = pk ? _n(pk.price) : _n(dr.packaging_price);
          const name = pk ? pk.name : (dr.packaging_name || "بسته‌بندی در");
          pItems.push(engineItem("packaging_door", "مونتاژ و خدمات", name, `${fmt(leaves)} لنگه در`, leaves, "لنگه", price, leaves * price));
        }
        pr.total_doors += leaves;
      }

      /* --- کشوها --- */
      for (const dw of u.drawers || []) {
        /* پیش‌فرضِ فیلدِ qty در DrawerRow برابر ۳ است (هم‌راستا با پایتون) */
        const count = Math.max(0, _ci(dw.qty, 3, 0)) * n;
        if (count <= 0) continue;
        const w = _pos(dw.w_cm) / 100, h = _pos(dw.h_cm) / 100, d = _pos(dw.d_cm) / 100;
        const sheetM = matById(dw.sheet_id);
        if (dw.sheet_id || _n(dw.sheet_price_per_sqm)) {
          const pp = sheetM ? sheetPriceCheck(sheetM, "ورق جعبه‌ی کشو", (2 * d * h + w * d + w * h) * count, warnings)
                              : Math.max(0, _n(dw.sheet_price_per_sqm));
          const dname = sheetM ? sheetM.name : (dw.sheet_name || "ورق بدنه‌ی کشو");
          if (!sheetM && pp <= 0 && dw.sheet_id) {
            warnings.push(`«${dw.label || "کشو"}»: متریال جعبه‌ی کشو در کتابخانه قیمت پیدا نشد و قیمت ثبت‌شده‌ای هم ندارد — هزینه‌ی ورق جعبه محاسبه نشد!`);
          }
          const boxArea = (2 * d * h) + (w * d) + (w * h);
          const sa = sheetM ? (sheetM.sheet_width_cm * sheetM.sheet_height_cm) / 10000 : 0;
          pItems.push(engineItem("drawer_box", "جعبه‌ی کشو", dname,
            `${fmt(count)} عدد × ${fmt(boxArea, 1)} م²`, boxArea * count, "م²", pp, boxArea * count * pp, true,
            { mat_id: _n(dw.sheet_id), mat_cat: "drawer_sheet", area_sqm: boxArea * count * (1 + waste / 100),
              sheet_area_sqm: sa > 0 ? sa : 0 }));
        }
        const frontM = matById(dw.front_id);
        if (dw.front_id || _n(dw.front_price_per_sqm)) {
          const pp = frontM ? sheetPriceCheck(frontM, "تیره‌ی کشو", w * h * count, warnings)
                              : Math.max(0, _n(dw.front_price_per_sqm));
          const fname = frontM ? frontM.name : (dw.front_name || "تیره‌ی کشو");
          if (!frontM && pp <= 0 && dw.front_id) {
            warnings.push(`«${dw.label || "کشو"}»: متریال تیره‌ی کشو در کتابخانه قیمت پیدا نشد و قیمت ثبت‌شده‌ای هم ندارد — هزینه‌ی تیره محاسبه نشد!`);
          }
          const fa2 = w * h;
          const sa = frontM ? (frontM.sheet_width_cm * frontM.sheet_height_cm) / 10000 : 0;
          pItems.push(engineItem("drawer_front", "تیره‌ی کشو", fname, `${fmt(count)} عدد × ${fmt(fa2, 1)} م²`, fa2 * count, "م²", pp, fa2 * count * pp, true,
            { mat_id: _n(dw.front_id), mat_cat: "door_sheet", area_sqm: fa2 * count * (1 + waste / 100),
              sheet_area_sqm: sa > 0 ? sa : 0 }));
          pr.total_door_area += fa2 * count;
        }
        if (dw.slide_id || _n(dw.slide_price)) {
          const slide = matById(dw.slide_id);
          const price = slide ? _n(slide.price) : _n(dw.slide_price);
          const name = slide ? slide.name : (dw.slide_name || "ریل کشو");
          pItems.push(engineItem("drawer_slide", "ریل کشو", name, `${fmt(count)} عدد کشو`, count, "ست", price, count * price));
        }
        if (dw.banding_id) {
          const bm = matById(dw.banding_id);
          /* پرت نوار برای کشو هم مثل بدنه و در اعمال می‌شود (هم‌راستا با پایتون) */
          const meters = (2 * (2 * (d + h)) + 2 * (w + d) + 2 * (w + h)) * count * (1 + BAND_WASTE / 100);
          if (bm) {
            pItems.push(engineItem("banding_drawer", "نوار PVC کشو", bm.name, "", meters, "متر", bm.price, meters * bm.price));
            pr.total_banding_m += meters;
          }
        }
        if (dw.handle_id || _n(dw.handle_price)) {
          const dh = matById(dw.handle_id);
          const price = dh ? _n(dh.price) : _n(dw.handle_price);
          const name = dh ? dh.name : (dw.handle_name || "دستگیره");
          pItems.push(engineItem("handle", "دستگیره", name, `${fmt(count)} عدد کشو`, count, "عدد", price, count * price));
        }
        if (dw.assembly_id || _n(dw.assembly_price)) {
          const da = matById(dw.assembly_id);
          const price = da ? _n(da.price) : _n(dw.assembly_price);
          const name = da ? da.name : (dw.assembly_name || "مونتاژ کشو");
          pItems.push(engineItem("assembly_drawer", "مونتاژ و خدمات", name, `${fmt(count)} عدد کشو`, count, "عدد", price, count * price));
        }
        pr.total_drawers += count;
      }

      /* --- صفحه / تاج / زیرچراغ / پاخور / پایه / خار / مونتاژ ---
         اگر «متر طول صفحه» در سطح بخش وارد شده باشد، همان ملاک است و برای
         هر یونیت جداگانه صفحه حساب نمی‌شود (جلوگیری از دوباره‌شماری). */
      if (u.countertop_id && _pos(page.countertop_lm) <= 0) {
        const cm = matById(u.countertop_id);
        if (cm) {
          const lm = (L / 100) * n;
          pItems.push(engineItem("countertop", "صفحه کابینت", cm.name, `${fmt(lm, 1)} متر طول`, lm, "متر", cm.price, lm * cm.price));
        } else {
          warnings.push(`«${u.label || "یونیت"}»: متریال صفحه‌ی کابینت در کتابخانه قیمت پیدا نشد (حذف شده؟) — هزینه‌ی صفحه محاسبه نشد!`);
        }
      }
      if (u.crown_id && (u.unit_type === "wall" || u.unit_type === "tall")) {
        const cm = matById(u.crown_id);
        if (cm) { const lm = (L / 100) * n; pItems.push(engineItem("crown", "تاج", cm.name, `${fmt(lm, 1)} متر طول`, lm, "متر", cm.price, lm * cm.price)); }
      }
      if (u.underlight_id && u.unit_type === "wall") {
        const cm = matById(u.underlight_id);
        if (cm) { const lm = (L / 100) * n; pItems.push(engineItem("underlight", "زیرچراغ", cm.name, `${fmt(lm, 1)} متر طول`, lm, "متر", cm.price, lm * cm.price)); }
      }
      if (u.kickboard_id && (u.unit_type === "ground" || u.unit_type === "tall")) {
        const cm = matById(u.kickboard_id);
        if (cm) { const lm = (L / 100) * n; pItems.push(engineItem("kickboard", "پاخور", cm.name, `${fmt(lm, 1)} متر طول`, lm, "متر", cm.price, lm * cm.price)); }
      }
      if (u.leg_id && (u.unit_type === "ground" || u.unit_type === "tall")) {
        const lm2 = matById(u.leg_id);
        if (lm2 || _n(u.leg_price)) {
          const q = _pos(u.legs_per_unit, 4) * n;
          const price = lm2 ? _n(lm2.price) : _n(u.leg_price);
          const name = lm2 ? lm2.name : (u.leg_name || "پایه");
          pItems.push(engineItem("leg", "پایه", name, `${fmt(q)} عدد`, q, "عدد", price, q * price));
        }
      }
      if (u.shelf_pin_id && SHELVES > 0) {
        const sp = matById(u.shelf_pin_id);
        if (sp || _n(u.shelf_pin_price)) {
          const q = _pos(u.pins_per_shelf, 4) * SHELVES * n;
          const price = sp ? _n(sp.price) : _n(u.shelf_pin_price);
          const name = sp ? sp.name : (u.shelf_pin_name || "خار طبقه");
          pItems.push(engineItem("shelf_pin", "خار طبقه", name, "", q, "عدد", price, q * price));
        }
      }
      if (u.assembly_id || _n(u.assembly_price)) {
        const am = matById(u.assembly_id);
        const price = am ? _n(am.price) : _n(u.assembly_price);
        const name = am ? am.name : (u.assembly_name || "مونتاژ یونیت");
        pItems.push(engineItem("assembly_unit", "مونتاژ و خدمات", name, `${fmt(n)} یونیت`, n, "یونیت", price, n * price));
      }

      pr.total_units += n;
      if (u.unit_type === "wall") pr.total_wall_lm += (L / 100) * n;
      else if (u.unit_type === "ground" || u.unit_type === "tall") pr.total_ground_lm += (L / 100) * n;
      /* انواع دیگر (کشو/شلف باز) متر طول زمینی/دیواری ندارند — هم‌راستا با پایتون */
    }

    /* ★ تجمیع ورق‌ها در سطح بخش */
    pr.total_sheets = batchSheetsLocal(pItems);

    /* صفحه‌ی کابینت کلی بخش */
    if (_pos(page.countertop_lm) > 0) {
      const used = (page.units || []).find((u) => u.countertop_id);
      const cm = used ? matById(used.countertop_id) : null;
      if (cm) {
        const lm = _pos(page.countertop_lm);
        pItems.push(engineItem("countertop", "صفحه کابینت", cm.name, `${fmt(lm, 1)} متر طول (ورودی کلی)`, lm, "متر", cm.price, lm * cm.price));
      } else {
        warnings.push(`«${page.name || "بخش"}»: متراژ صفحه‌ی کابینت (${fmt(_n(page.countertop_lm), 1)} متر) وارد شده ولی متریال صفحه در هیچ یونیتی انتخاب نشده (یا از کتابخانه حذف شده) — هزینه‌ی صفحه محاسبه نشد.`);
      }
    }

    /* درنما */
    if (page.detail_mode === "detailed") {
      for (const r of page.detail_rows || []) {
        const area = _n(r.qty) * (_pos(r.w_cm) / 100) * (_pos(r.h_cm) / 100);
        if (area <= 0) continue;
        detailCost += area * _pos(r.price_per_sqm);
        pItems.push(engineItem("darna", "درنما", r.label || "درنما",
          `${fmt(_n(r.qty))} × ${fmt(_n(r.w_cm))}×${fmt(_n(r.h_cm))} سانتی‌متر = ${fmt(area, 1)} م²`,
          area, "م²", _pos(r.price_per_sqm), area * _pos(r.price_per_sqm)));
      }
    } else if (page.detail_mode === "total") {
      const sqm = _pos(page.detail_total_sqm), pp = _pos(page.detail_price_per_sqm);
      if (sqm > 0) {
        detailCost += sqm * pp;
        pItems.push(engineItem("darna", "درنما", "درنما (متراژ کلی)", `${fmt(sqm, 1)} م² × قیمت واحد`, sqm, "م²", pp, sqm * pp));
      }
    }

    /* اضافات */
    for (const ex of page.extras || []) {
      if (!ex.label && !_n(ex.price)) continue;
      /* ★ قلمِ منفی پیش‌تر بی‌صدا از جمع کل کم می‌کرد (تخفیفِ پنهان).
         «ناموجود» → پیش‌فرضِ ۱ (هم‌راستا با dataclass پایتون)،
         «خراب»      → همان پیش‌فرضِ ۱ (نه صفر) تا دو موتور یکی بمانند. */
      const eq = _pos(_co(ex.qty, 1, 1));
      const eprice = _pos(ex.price);
      if (_n(ex.qty, 1) < 0 || _n(ex.price) < 0)
        warnings.push(`«${ex.label || "قلم متفرقه"}»: تعداد یا قیمت منفی بود — صفر در نظر گرفته شد.`);
      const amt = eq * eprice;
      pItems.push(engineItem("extra", "اضافات و اکسسوری", ex.label || "قلم متفرقه", ex.note || "",
        eq, UNITS[ex.unit] || ex.unit || "", eprice, amt, _bool(ex.visible, true)));
    }

    /* خدمات (مبنا خودکار)
       ★ مبنای «مترمربع» (sqm) پیش‌تر همیشه صفر بود و خدمات مترمربعی هیچ
       هزینه‌ای نمی‌گرفتند؛ اکنون از مساحت کل قطعات بخش پر می‌شود. */
    const ctx = {
      unit: pr.total_units, door: pr.total_doors, shelf: 0,
      sqm: pr.total_body_area + pr.total_door_area + pr.total_back_area,
      lm: pr.total_ground_lm + pr.total_wall_lm, fixed: 1, percent: 0,
    };
    for (const u of page.units || []) ctx.shelf += _pos(u.shelves) * Math.max(0, _ci(u.qty, 1, 0));
    const pctServices = [];
    for (const s of page.services || []) {
      if (!s.label && !_n(s.price)) continue;
      if (s.basis === "percent") { pctServices.push(s); continue; }
      const basis = ctx[s.basis] !== undefined ? s.basis : "fixed";
      /* ★ مبنای منفی/NaN پیش‌تر مبلغ خدمت را منفی می‌کرد و بی‌صدا از جمع کل
         کم می‌شد (مثلاً عمق منفی → مساحت منفی → خدمتِ مترمربعیِ منفی). */
      const q = Math.max(0, _n(ctx[basis]));
      const sp = _pos(s.price);
      if (_n(s.price) < 0)
        warnings.push(`«${s.label || "خدمات"}»: بهای خدمت منفی بود — صفر در نظر گرفته شد.`);
      const amt = q * sp;
      pItems.push(engineItem("service", "خدمات", s.label || "خدمات", `مبنای محاسبه: ${SERVICE_BASIS[basis] || basis}`, q, "", sp, amt));
    }

    /* ★ جمع‌بندیِ این بخش عمداً به **پاسِ ۲** موکول می‌شود: اول باید ورق‌های
       همه‌ی بخش‌ها یک‌جا گرد شوند (رفع باگ F-01)، بعد جمع/درصد/سربار ساخته
       شود — وگرنه خدمات درصدی و سربار روی جمعِ بادکرده‌ی بخش‌بخش می‌نشینند. */
    pr.items = pItems;
    pageResults.push(pr);
    deferred.push({ page, pr, pItems, pctServices });
  }

  /* ── پاسِ ۲ ─ تجمیع ورق در سطح کل پروژه، سپس جمع‌بندی بخش‌ها ─────────── */
  repoolSheetsProjectLocal(pageResults);
  for (const d of deferred) {
    const page = d.page, pr = d.pr, pItems = d.pItems, pctServices = d.pctServices;
    /* ★ باگ قدیمی برطرف شد: مبلغ خدمات غیردرصدی پیش‌تر «دو بار» در جمع بخش
       لحاظ می‌شد (یک‌بار داخل ردیف‌ها و یک‌بار با fixedSvcTotal) — و موتور
       دسکتاپ هم همان دوباره‌شماری را داشت. اکنون هر دو موتور خدمات را
       دقیقاً یک‌بار می‌شمارند. */
    let subtotal = pItems.reduce((a, it) => a + _n(it.amount), 0);
    /* خدمات درصدی — همه نسبت به جمعِ قبل از خدمات درصدی (بدون اثر مرکب) */
    if (pctServices.length) {
      const base = subtotal;
      for (const s of pctServices) {
        const raw = _n(s.price);
        if (raw < 0) warnings.push(`«${s.label || "خدمات درصدی"}»: درصدِ منفی بود — صفر در نظر گرفته شد.`);
        const pct = Math.max(0, raw);
        const amt = base * pct / 100;
        pItems.push(engineItem("service", "خدمات", s.label || "خدمات درصدی", `${fmt(pct, 1)}٪ از جمع بخش`, 1, "", pct, amt));
        subtotal += amt;
      }
    }
    /* سربار + ردیف شفافِ آن در اقلام (هم‌راستا با پایتون: جمع اقلام == هزینه‌ی تمام‌شده) */
    const ohPct = _pos(page.overhead_percent);
    const overhead = subtotal * ohPct / 100;
    for (let i = pItems.length - 1; i >= 0; i--) if (pItems[i].key === "overhead") pItems.splice(i, 1);
    if (overhead > 0) {
      pItems.push(engineItem("overhead", "سربار", `سربار کارگاه (${fmt(ohPct)}٪)`, `${fmt(ohPct)}٪ از جمع اقلام بخش`, 1, "موردی", overhead, overhead));
    }
    pr.subtotal = subtotal;
    pr.overhead_amount = overhead;
    pr.total_cost = subtotal + overhead;
    /* ورق‌ها حالا در سطح پروژه گرد شده‌اند → سهم هر بخش هم تازه می‌شود */
    pr.total_sheets = pItems.reduce((a, i) => a + _n(i.sheets), 0);
    pagesCost += pr.total_cost;
    items.push(...pItems);
    for (const k of Object.keys(stats)) stats[k] += _n(pr[k], 0);
  }

  /* مبلغ ثابت اضافه */
  const extraFixed = _n(project.extra_fixed_amount);
  if (extraFixed) {
    const it = engineItem("extra_fixed", "اضافات و اکسسوری", "مبلغ ثابت بابت تفاوت نوع در / اقلام کلی", "", 1, "موردی", extraFixed, extraFixed);
    items.push(it);
    pagesCost += extraFixed;
    stats.extra_fixed = extraFixed;
  }

  /* نصب — مبلغ منفی پذیرفته نمی‌شود */
  let install = 0;
  const im = project.install_mode || "none";
  let iv = _n(project.install_value);
  if (iv < 0) { warnings.push("مبلغ نصب منفی بود — صفر در نظر گرفته شد."); iv = 0; }
  if (im === "fixed") install = iv;
  else if (im === "per_meter") install = iv * (stats.total_ground_lm || 0);
  else if (im === "percent") install = pagesCost * iv / 100;
  if (install > 0) {
    items.push(engineItem("installation", "نصب و حمل", "هزینه‌ی نصب",
      im === "per_meter" ? `${fmt(iv)} × ${fmt(stats.total_ground_lm, 1)} متر طول کابینت زمینی` : im === "percent" ? `${fmt(iv, 1)}٪ از جمع هزینه‌ها` : "مبلغ ثابت",
      1, "موردی", install, install));
  }
  const totalCost = pagesCost + install;

  /* سود — اعتبارسنجی درصد (هم‌راستا با پایتون) */
  const pMode = project.profit_mode || "markup";
  let pPct = _n(project.profit_percent);
  if (pPct < 0) { warnings.push(`درصد سود منفی (${fmt(pPct)}٪) بود — صفر در نظر گرفته شد.`); pPct = 0; }
  if (pMode === "margin" && pPct >= 100) {
    warnings.push(`مارجین ${fmt(pPct)}٪ نامعتبر است (باید کمتر از ۱۰۰٪ باشد) — سود صفر محاسبه شد.`);
  }
  let profit;
  if (pMode === "margin") profit = pPct >= 100 ? 0 : totalCost * pPct / (100 - pPct);
  else profit = totalCost * pPct / 100;
  const gross = totalCost + profit;

  /* تخفیف و مالیات — درصدها محدود به بازه‌ی معتبر (تخفیف منفی پیش‌تر
     قیمت را از ناخالص «بالاتر» می‌برد!) */
  let dPct = _n(project.discount_percent);
  if (dPct < 0 || dPct > 100) {
    warnings.push(`درصد تخفیف (${fmt(dPct)}٪) خارج از بازه‌ی ۰ تا ۱۰۰ بود — به ${fmt(Math.min(Math.max(dPct, 0), 100))}٪ محدود شد.`);
    dPct = Math.min(Math.max(dPct, 0), 100);
  }
  let dAmt = _n(project.discount_amount);
  if (dAmt < 0) { warnings.push("مبلغ تخفیف منفی بود — صفر در نظر گرفته شد."); dAmt = 0; }
  const discount = Math.min(gross * dPct / 100 + dAmt, gross);
  const net = gross - discount;
  let vatPct = project.vat_enabled ? _n(project.vat_percent) : 0;
  if (vatPct < 0) { warnings.push("درصد مالیات منفی بود — صفر در نظر گرفته شد."); vatPct = 0; }
  const vat = net * vatPct / 100;
  const final = net + vat;

  /* پیش‌پرداخت (بیعانه) و باقی‌مانده */
  const depPct = Math.min(Math.max(_n(project.deposit_percent), 0), 100);
  const deposit = Math.max(0, Math.min(final * depPct / 100 + Math.max(0, _n(project.deposit_amount)), final));

  /* قیمت هر متر طول — «متری چند؟» */
  const glm = stats.total_ground_lm || 0;
  const tlm = glm + (stats.total_wall_lm || 0);

  return {
    pages: pageResults,
    pages_cost: pagesCost, installation_cost: install, total_cost: totalCost,
    profit_mode: pMode, profit_percent: pPct, profit_amount: profit,
    gross_price: gross, discount_percent: dPct, discount_amount: discount,
    net_price: net, vat_percent: vatPct, vat_amount: vat, final_price: final,
    total_profit: final - totalCost - vat,
    deposit_percent: depPct, deposit_amount: deposit, remaining_amount: final - deposit,
    price_per_ground_lm: glm > 0 ? final / glm : 0,
    price_per_total_lm: tlm > 0 ? final / tlm : 0,
    cost_per_ground_lm: glm > 0 ? totalCost / glm : 0,
    stats, items, warnings,
  };
}

/* ------------------------------------------------------- داده‌ی فاکتور (دمو)
   آینه‌ی build_invoice_data در kabir/core/invoice.py                       */
function buildInvoiceDataDemo(result, project, opts) {
  opts = opts || {};
  const hidden = new Set(opts.hidden || []);
  const mode = opts.mode || "grouped";
  const byGroup = new Map();
  for (const it of result.items) {
    if (!it.visible) continue;
    if (!byGroup.has(it.group)) byGroup.set(it.group, []);
    byGroup.get(it.group).push(it);
  }
  const ordered = [...byGroup.entries()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a[0]), ib = GROUP_ORDER.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const items = [];
  const uniq = (arr) => [...new Set(arr)];
  if (mode === "detailed") {
    for (const it of result.items) {
      if (!it.visible || hidden.has(it.key) || hidden.has(it.group)) continue;
      items.push({ key: it.key, title: it.title, detail: it.detail, qty: it.qty, unit: it.unit_label, unit_price: it.unit_price, amount: it.amount, group: it.group });
    }
  } else if (mode === "summary") {
    for (const [g, rows] of ordered) {
      if (hidden.has(g)) continue;
      const amount = rows.reduce((a, r) => a + r.amount, 0);
      items.push({ key: g, title: g, detail: `${fa(rows.length)} قلم`, qty: rows.reduce((a, r) => a + (r.qty || 0), 0), unit: "", unit_price: 0, amount, group: g });
    }
  } else {
    for (const [g, rows] of ordered) {
      if (hidden.has(g)) continue;
      const names = uniq(rows.map((r) => r.title));
      const amount = rows.reduce((a, r) => a + r.amount, 0);
      const qty = uniq(rows.map((r) => r.unit_label)).length === 1 ? rows.reduce((a, r) => a + (r.qty || 0), 0) : 0;
      items.push({
        key: g, title: names.slice(0, 3).join(" / ") + (names.length > 3 ? "…" : ""),
        detail: uniq(rows.map((r) => r.detail).filter(Boolean)).slice(0, 2).join(" • "),
        qty, unit: uniq(rows.map((r) => r.unit_label)).length === 1 ? rows[0].unit_label : "",
        unit_price: qty ? amount / qty : 0, amount, group: g,
      });
    }
  }

  const kindLabel = { quote: "پیش‌فاکتور", invoice: "فاکتور فروش", proforma: "پیش‌فاکتور رسمی" }[opts.kind] || "پیش‌فاکتور";
  return {
    kind: opts.kind || "quote", kind_label: kindLabel,
    number: opts.number || "", date_fa: TODAY_FA,
    valid_until: project.valid_until || "",
    title: SETTINGS.invoice_title || "پیش‌فاکتور",
    project_title: project.title || "", project_code: project.code || "",
    customer: { name: project.customer || "", phone: project.phone || "", mobile: project.mobile || "", address: project.address || "" },
    seller: {
      name: SETTINGS.company_name || "", manager: SETTINGS.company_manager || "",
      phone: SETTINGS.company_phone || "", mobile: SETTINGS.company_mobile || "",
      address: SETTINGS.company_address || "", email: SETTINGS.company_email || "", web: SETTINGS.company_web || "",
    },
    mode, currency: CUR.name, scale: CUR.scale || 1,
    items, show_cost: !!opts.show_cost, show_stats: opts.show_stats !== false,
    totals: {
      pages_cost: result.pages_cost, installation: result.installation_cost, total_cost: result.total_cost,
      profit_mode: result.profit_mode, profit_percent: result.profit_percent, profit_amount: result.profit_amount,
      gross_price: result.gross_price, discount_percent: result.discount_percent, discount_amount: result.discount_amount,
      net_price: result.net_price, vat_percent: result.vat_percent, vat_amount: result.vat_amount,
      final_price: result.final_price,
      deposit_percent: result.deposit_percent, deposit_amount: result.deposit_amount,
      remaining_amount: result.remaining_amount,
      price_per_ground_lm: result.price_per_ground_lm, price_per_total_lm: result.price_per_total_lm,
      stats: result.stats,
    },
    footer_note: SETTINGS.invoice_footer_note || "",
  };
}

/* --------------------------------------------- رندر برگه‌ی فاکتور (حالت دمو) */
function renderInvoiceSheet(data) {
  const sc = (v) => scaled(v);
  const rows = data.items.map((it, i) => `
    <tr${it.key === it.group ? ' class="grp"' : ""}>
      <td>${fa(i + 1)}</td>
      <td class="r"><b>${esc(it.title)}</b>${it.detail ? `<div class="detail">${esc(it.detail)}</div>` : ""}</td>
      <td>${it.qty ? fa(Math.round(it.qty * 10) / 10) : ""}</td>
      <td>${esc(it.unit || "")}</td>
      <td>${it.unit_price ? fmt(sc(it.unit_price)) : "—"}</td>
      <td><b>${fmt(sc(it.amount))}</b></td>
    </tr>`).join("");
  const t = data.totals;
  const st = t.stats || {};
  return `
    <div class="sh-head">
      <div class="sh-brand">
        <h1>🗄 ${esc(data.seller.name)}</h1>
        <div class="sub">مدیریت: ${esc(data.seller.manager)} • تلفن: ${esc(data.seller.phone)} • همراه: ${esc(data.seller.mobile)}<br>${esc(data.seller.address)}</div>
      </div>
      <div class="sh-meta">
        <span class="sh-doc">${esc(data.kind_label)}</span><br>
        شماره: <b class="ltr">${esc(data.number || "—")}</b><br>
        تاریخ: ${esc(data.date_fa)}<br>
        اعتبار تا: ${esc(data.valid_until || "—")}
      </div>
    </div>
    <div class="sh-parties">
      <div class="party">
        <h3>خریدار</h3>
        <p><b>${esc(data.customer.name || "—")}</b></p>
        ${data.customer.mobile ? `<p>همراه: ${esc(data.customer.mobile)}</p>` : ""}
        ${data.customer.phone ? `<p>تلفن: ${esc(data.customer.phone)}</p>` : ""}
        ${data.customer.address ? `<p>نشانی: ${esc(data.customer.address)}</p>` : ""}
      </div>
      <div class="party">
        <h3>مشخصات سند</h3>
        <p>پروژه: <b>${esc(data.project_title)}</b></p>
        <p>کد: <b class="ltr">${esc(data.project_code)}</b></p>
        <p>روش سود: ${t.profit_mode === "margin" ? "مارجین" : "مارکاپ"} ${fmt(t.profit_percent, true)}٪</p>
      </div>
    </div>
    <table class="items">
      <thead><tr><th style="width:7%">ردیف</th><th>شرح</th><th style="width:10%">مقدار</th><th style="width:10%">واحد</th><th style="width:16%">قیمت واحد</th><th style="width:17%">مبلغ (${esc(CUR.name)})</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6"><div class="empty">ردیفی برای نمایش نیست.</div></td></tr>`}</tbody>
    </table>
    <div class="totals">
      <table>
        <tr><td class="lbl">جمع کل اقلام</td><td class="val">${fmt(sc(t.gross_price))} ${esc(CUR.name)}</td></tr>
        ${data.show_cost ? `<tr><td class="lbl">جمع هزینه‌ی تمام‌شده (داخلی)</td><td class="val">${fmt(sc(t.total_cost))} ${esc(CUR.name)}</td></tr>` : ""}
        ${t.discount_amount > 0 ? `<tr><td class="lbl">تخفیف</td><td class="val" style="color:#dc2626">− ${fmt(sc(t.discount_amount))} ${esc(CUR.name)}</td></tr>` : ""}
        ${t.vat_amount > 0 ? `<tr><td class="lbl">مالیات بر ارزش افزوده (${fmt(t.vat_percent)}٪)</td><td class="val">${fmt(sc(t.vat_amount))} ${esc(CUR.name)}</td></tr>` : ""}
        <tr class="final"><td class="lbl" style="color:#fff">مبلغ قابل پرداخت</td><td class="val">${fmt(sc(t.final_price))} ${esc(CUR.name)}</td></tr>
      </table>
    </div>
    <div class="words">مبلغ قابل پرداخت: ${num2words(sc(t.final_price))} ${esc(CUR.name)}</div>
    ${data.show_stats ? `
    <div class="stats">
      <span class="stat">تعداد یونیت<b>${fa(st.total_units || 0)}</b></span>
      <span class="stat">متراژ زمینی<b>${fmt(st.total_ground_lm || 0, true)} متر</b></span>
      <span class="stat">متراژ دیواری<b>${fmt(st.total_wall_lm || 0, true)} متر</b></span>
      <span class="stat">ورق مصرفی<b>${fa(Math.round(st.total_sheets || 0))}</b></span>
      <span class="stat">لنگه در<b>${fa(st.total_doors || 0)}</b></span>
      <span class="stat">کشو<b>${fa(st.total_drawers || 0)}</b></span>
      <span class="stat">مساحت بدنه<b>${fmt(st.total_body_area || 0, true)} م²</b></span>
    </div>` : ""}
    <div class="sign">
      <div class="box"><div class="line"></div>مهر و امضای فروشنده</div>
      <div class="box"><div class="line"></div>امضای خریدار</div>
    </div>
    <div class="foot">
      <span style="max-width:70%">${esc(data.footer_note)}</span>
      <span>این سند توسط نرم‌افزار <b>کبیر</b> تولید شده است.</span>
    </div>`;
}

/* ==========================================================================
   بسته‌ی کارگاهی محلی — آینه‌ی kabir/core/workshop.py
   (برای حالت نمایشی و بازخورد فوری؛ وقتی سرور در دسترس باشد همان پاسخ
    سرور نشان داده می‌شود)
   ========================================================================== */

const SHOP_GROUPS_LOCAL = [
  ["sheet", "ورق و پنل"], ["banding", "نوار لبه (PVC)"],
  ["profile", "صفحه، تاج، زیرچراغ و پاخور"], ["hardware", "یراق‌آلات"],
  ["service", "خدمات و اجرت"], ["other", "سایر"],
];

const KEY_TO_SHOP_GROUP = {
  body_sheet: "sheet", back_sheet: "sheet", door_sheet: "sheet",
  drawer_box: "sheet", drawer_front: "sheet",
  banding_body: "banding", banding_door: "banding", banding_drawer: "banding",
  countertop: "profile", crown: "profile", underlight: "profile", kickboard: "profile",
  hinge: "hardware", gas_spring: "hardware", handle: "hardware", leg: "hardware",
  shelf_pin: "hardware", drawer_slide: "hardware", accessory: "hardware",
  door_model: "service", assembly_unit: "service", assembly_door: "service",
  assembly_drawer: "service", packaging_door: "service", service: "service",
  extra: "other", extra_fixed: "other", installation: "other", darna: "other",
};

const CAT_ORDER_LOCAL = ["body_sheet", "door_sheet", "back_sheet", "drawer_sheet", "door_model",
  "countertop", "crown", "underlight", "kickboard", "banding", "hinge", "gas_spring",
  "shelf_pin", "handle", "leg", "drawer_slide", "accessory", "service"];

/* پنل‌های استاندارد بدنه — آینه‌ی CostingEngine.panels_of/default_panels */
function panelsOfUnit(u) {
  /* ★ ریزِ دستیِ کاربر (custom_panels) مقدم بر فرمول پیش‌فرض است */
  if (Array.isArray(u.custom_panels) && u.custom_panels.length) {
    return u.custom_panels.map((p) => ({
      label: p.label || "قطعه", qty: _n(p.qty), w: _n(p.w_cm), h: _n(p.h_cm),
      mk: p.material_key || "body", banding: p.banding !== false,
      enabled: p.enabled !== false,
    })).filter((p) => p.enabled);
  }
  const bm = matById(u.body_id);
  const t = bm && bm.thickness_mm ? bm.thickness_mm / 10 : 0;   // cm
  const L = _n(u.length_cm), H = _n(u.height_cm), D = _n(u.depth_cm);
  const rows = [{ label: "بدنه کناری (چپ و راست)", qty: 2, w: D, h: H, mk: "body", banding: true }];
  if (u.has_bottom_panel !== false) rows.push({ label: "کف یونیت", qty: 1, w: L - 2 * t, h: D, mk: "body", banding: true });
  if (u.has_top_panel !== false && u.unit_type !== "ground") rows.push({ label: "سقف یونیت", qty: 1, w: L - 2 * t, h: D, mk: "body", banding: true });
  if (u.unit_type === "tall") rows.push({ label: "طبقه‌ی ثابت وسط", qty: 1, w: L - 2 * t, h: D, mk: "body", banding: true });
  if (_n(u.shelves) > 0) rows.push({ label: `طبقه‌ی داخلی (${fa(u.shelves)} عدد)`, qty: _n(u.shelves), w: L - 2 * t, h: D, mk: "body", banding: true });
  if (u.back_id) rows.push({ label: "فیبر پشت", qty: 1, w: L, h: H, mk: "back", banding: false });
  return rows;
}

function _ord(w, h) {
  const a = _n(w) * 10, b = _n(h) * 10;
  return [Math.max(a, b), Math.min(a, b)];
}

function _bandSides(label) {
  if (label.includes("کناری")) return "۱ طول (لبه‌ی جلو)";
  if (label.includes("کف") || label.includes("سقف") || label.includes("طبقه")) return "۲ طول + ۱ عرض";
  if (label.includes("فیبر")) return "—";
  if (label.includes("تیره") || label.includes("در")) return "دور تا دور";
  return "لبه‌های نمایان";
}

function _isGrain(m) {
  if (!m) return false;
  const hay = `${m.name} ${m.note || ""}`;
  return ["طرح چوب", "راه‌راه", "راشه", "گردو", "طرح‌دار"].some((k) => hay.includes(k));
}

function buildCutListLocal(project) {
  const out = [];
  const thOf = (mid, dflt) => { const m = matById(mid); return m && m.thickness_mm ? m.thickness_mm : (dflt || 16); };
  const nmOf = (mid, fb) => { const m = matById(mid); return m ? m.name : (fb || "—"); };

  for (const page of project.pages || []) {
    const sec = page.name || "بخش";
    for (const u of page.units || []) {
      const n = Math.trunc(_n(u.qty, 1));
      if (n <= 0) continue;   /* یونیت با تعداد صفر/منفی در برش‌نامه هم نمی‌آید */
      const uLabel = u.label || "یونیت";

      for (const pn of panelsOfUnit(u)) {
        const isBack = pn.mk === "back";
        const mid = isBack ? u.back_id : u.body_id;
        // متریال انتخاب‌نشده قطعه را حذف نمی‌کند (هم‌راستا با موتور پایتون)
        const [ln, wd] = _ord(pn.w, pn.h);
        const qty = Math.round(pn.qty * n);
        out.push({
          section: sec, unit: uLabel, part: pn.label, qty,
          length_mm: ln, width_mm: wd,
          thickness_mm: thOf(mid, isBack ? 3 : 16),
          material: nmOf(mid), mat_cat: isBack ? "back_sheet" : "body_sheet",
          banding: pn.banding && !isBack, banding_sides: _bandSides(pn.label),
          area_sqm: (pn.qty * (pn.w / 100) * (pn.h / 100)) * n,
          grain: _isGrain(matById(mid)),
        });
      }

      for (const dr of u.doors || []) {
        const leaves = Math.round(_n(dr.qty) * n);
        if (leaves <= 0) continue;
        /* ★ «در از ورق بدنه»: همان ورقِ بدنه، همان دسته — تا خلاصه‌ی ورق و
           برش‌نامه با فاکتور یکی بماند (هم‌راستا با موتور پایتون).            */
        const fromBody = !!dr.from_body && !!u.body_id
          && doorLeafFitsSheet(dr, matById(u.body_id)).ok;
        const mid = fromBody ? u.body_id : (dr.material_id || u.body_id);
        const [ln, wd] = _ord(dr.w_cm, dr.h_cm);
        out.push({
          section: sec, unit: uLabel,
          part: `${dr.label || "در"} (لنگه)` + (fromBody ? " — از ورق بدنه" : ""),
          qty: leaves,
          length_mm: ln, width_mm: wd, thickness_mm: thOf(mid),
          material: nmOf(mid, dr.material_name),
          mat_cat: fromBody ? "body_sheet" : "door_sheet",
          banding: true, banding_sides: "دور تا دور",
          /* مساحتِ کلِ این ردیف = مساحت یک لنگه × تعداد لنگه (پیش‌تر تعداد
             لنگه جا افتاده بود و مساحت در در برش‌نامه کم‌تر از واقع می‌آمد) */
          area_sqm: (_n(dr.w_cm) / 100) * (_n(dr.h_cm) / 100) * leaves,
          grain: _isGrain(matById(mid)),
        });
      }

      for (const dw of u.drawers || []) {
        const cnt = Math.round(_n(dw.qty) * n);
        if (cnt <= 0) continue;
        const w = _n(dw.w_cm), h = _n(dw.h_cm), d = _n(dw.d_cm);
        const lbl = dw.label || "کشو";
        const fmid = dw.front_id || dw.sheet_id;
        const push = (part, q, W, H, mid, cat, band, sides, thick) => {
          const [ln, wd] = _ord(W, H);
          out.push({ section: sec, unit: uLabel, part, qty: q, length_mm: ln, width_mm: wd,
            thickness_mm: thick || thOf(mid), material: nmOf(mid), mat_cat: cat,
            banding: band, banding_sides: sides, area_sqm: (W / 100) * (H / 100) * q, grain: false });
        };
        push(`تیره‌ی ${lbl}`, cnt, w, h, fmid, "door_sheet", true, "دور تا دور");
        push(`بغل ${lbl}`, cnt * 2, d, h, dw.sheet_id, "drawer_sheet", true, "۱ طول (لبه‌ی بالا)");
        push(`پشت ${lbl}`, cnt, w - 3.2, h, dw.sheet_id, "drawer_sheet", false, "—");
        push(`کف ${lbl}`, cnt, w - 3.2, d, dw.sheet_id, "back_sheet", false, "—", 3);
      }
    }
  }
  out.sort((a, b) => (a.section === b.section ? 0 : a.section < b.section ? -1 : 1)
    || (a.unit === b.unit ? 0 : a.unit < b.unit ? -1 : 1)
    || (b.length_mm - a.length_mm) || (b.width_mm - a.width_mm));
  return out;
}

const SHEET_CAT_LABELS_LOCAL = { body_sheet: "بدنه", door_sheet: "در", back_sheet: "فیبر پشت", drawer_sheet: "جعبه کشو" };

/* ★ خلاصه‌ی ورق — آینه‌ی workshop.summarize_sheets در موتور پایتون.
   یک ردیف به ازای هر «متریال» (نه هر دسته): ورقِ یک متریال در کارگاه یک‌جا
   خریداری و برش می‌خورد. اگر نتیجه‌ی محاسبه (result) در دسترس باشد، تعداد ورق
   «همان عددِ فاکتورشده» است (با پرت و تجمیعِ بخش) تا خلاصه و فاکتور هیچ‌وقت
   از هم جدا نیفتند — پیش‌تر وقتی جنسِ در با ورقِ بدنه یکی بود، این خلاصه دو
   برابرِ فاکتور ورق می‌گفت!                                                     */
function summarizeSheetsLocal(parts, result) {
  const invoiced = {};
  if (result && Array.isArray(result.items)) {
    for (const it of result.items) {
      if (!SHEET_ITEM_KEYS.includes(it.key) || !it.mat_id) continue;
      const m = matById(it.mat_id);
      const name = m ? m.name : it.title;
      if (!name) continue;
      invoiced[name] = (invoiced[name] || 0) + _n(it.sheets);
    }
  }
  const agg = new Map();
  const catArea = new Map();
  for (const p of parts) {
    const k = p.material;
    if (!agg.has(k)) agg.set(k, { material: p.material, cat: p.mat_cat, area_sqm: 0,
      thickness_mm: p.thickness_mm, parts: 0, pieces: 0, sheets: 0, sheet_size: "", price: 0, cost: 0 });
    const a = agg.get(k);
    a.area_sqm += p.area_sqm; a.parts += 1; a.pieces += p.qty;
    if (!catArea.has(k)) catArea.set(k, {});
    const ca = catArea.get(k);
    ca[p.mat_cat] = (ca[p.mat_cat] || 0) + p.area_sqm;
  }
  const fb = { body_sheet: [_n(SETTINGS.sheet_width_cm, 183), _n(SETTINGS.sheet_height_cm, 366)],
    door_sheet: [_n(SETTINGS.sheet_width_cm, 183), _n(SETTINGS.sheet_height_cm, 366)],
    drawer_sheet: [_n(SETTINGS.sheet_width_cm, 183), _n(SETTINGS.sheet_height_cm, 366)],
    back_sheet: [_n(SETTINGS.fiber_sheet_width_cm, 122), _n(SETTINGS.fiber_sheet_height_cm, 244)] };
  const rows = [];
  for (const [name, a] of agg) {
    a.area_sqm = Math.round(a.area_sqm * 1000) / 1000;
    /* دسته‌ی غالب (بیشترین مساحت) + برچسب ترکیبی مثل «بدنه + در» */
    const cats = Object.entries(catArea.get(name) || {}).sort((x, y) => y[1] - x[1]);
    if (cats.length) a.cat = cats[0][0];
    const labels = cats.map(([c]) => SHEET_CAT_LABELS_LOCAL[c] || c);
    a.cats_label = labels.length > 1 ? labels.join(" + ") : (labels[0] || "");
    const m = MATERIALS.find((x) => x.name === a.material);
    let sa = 0, size = "", price = 0;
    if (m && m.sheet_width_cm && m.sheet_height_cm) {
      sa = (m.sheet_width_cm * m.sheet_height_cm) / 10000;
      size = `${m.sheet_width_cm}×${m.sheet_height_cm}`; price = _n(m.price);
    } else if (fb[a.cat]) {
      const [fw, fh] = fb[a.cat]; sa = (fw * fh) / 10000; size = `${fw}×${fh}`; price = 0;
    }
    a.sheet_size = size; a.price = price;
    if (invoiced[name] !== undefined) {
      a.sheets = Math.round(invoiced[name] * 1000) / 1000;
      a.cost = a.sheets * price;
      a.note = "همان تعداد ورقِ فاکتورشده (با پرت و تجمیع بخش)";
    } else {
      a.sheets = sa > 0 ? Math.ceil(Math.round((a.area_sqm / sa) * 1e6) / 1e6) : 0;
      a.cost = a.sheets * price;
    }
    rows.push(a);
  }
  rows.sort((x, y) => {
    const ix = CAT_ORDER_LOCAL.indexOf(x.cat), iy = CAT_ORDER_LOCAL.indexOf(y.cat);
    return ((ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy)) || (y.area_sqm - x.area_sqm);
  });
  return rows;
}

function buildShoppingLocal(result) {
  const agg = new Map();
  for (const it of result.items || []) {
    if (it.visible === false) continue;
    if (it.key === "installation" || it.key === "extra_fixed") continue;
    const group = KEY_TO_SHOP_GROUP[it.key] || "other";
    const k = `${it.mat_id || 0}|${it.title}|${group}`;
    if (!agg.has(k)) {
      const m = it.mat_id ? matById(it.mat_id) : null;
      agg.set(k, { name: it.title, cat: it.mat_cat || "", group,
        unit: m ? m.unit : "", unit_label: it.unit_label || "",
        qty: 0, amount: 0, sheets: 0, note: "" });
    }
    const ln = agg.get(k);
    ln.qty += _n(it.qty); ln.amount += _n(it.amount); ln.sheets += _n(it.sheets);
    if (!ln.unit_label && it.unit_label) ln.unit_label = it.unit_label;
  }
  const lines = [];
  for (const ln of agg.values()) {
    if (ln.group === "sheet" && ln.sheets > 0) {
      ln.qty = Math.round(ln.sheets * 1000) / 1000; ln.unit_label = "ورق"; ln.unit = "sheet";
      ln.note = "تعداد ورق کاملِ خریدنی (تجمیع‌شده در سطح بخش)";
    }
    lines.push(ln);
  }
  const order = {}; SHOP_GROUPS_LOCAL.forEach(([g], i) => (order[g] = i));
  lines.sort((a, b) => ((order[a.group] ?? 99) - (order[b.group] ?? 99))
    || ((CAT_ORDER_LOCAL.indexOf(a.cat) < 0 ? 99 : CAT_ORDER_LOCAL.indexOf(a.cat))
      - (CAT_ORDER_LOCAL.indexOf(b.cat) < 0 ? 99 : CAT_ORDER_LOCAL.indexOf(b.cat)))
    || (b.amount - a.amount));
  return lines;
}

function shoppingGroupsLocal(lines) {
  const out = [];
  for (const [g, label] of SHOP_GROUPS_LOCAL) {
    const rows = lines.filter((r) => r.group === g);
    if (!rows.length) continue;
    out.push({ key: g, label, total: rows.reduce((a, r) => a + r.amount, 0),
      count: rows.length, rows });
  }
  return out;
}

function buildWorkshopLocal(project) {
  const result = calcProjectLocal(project);
  const parts = buildCutListLocal(project);
  /* ★ نتیجه‌ی محاسبه به خلاصه پاس داده می‌شود تا «ورق لازم» دقیقاً همان عددِ
     فاکتور باشد (با پرت و تجمیعِ بخش) — نه تقریبِ بدونِ پرت.                  */
  const sheets = summarizeSheetsLocal(parts, result);
  const lines = buildShoppingLocal(result);
  const byCat = {};
  for (const p of parts) {
    const c = byCat[p.mat_cat] || (byCat[p.mat_cat] = { parts: 0, pieces: 0, area_sqm: 0 });
    c.parts += 1; c.pieces += p.qty; c.area_sqm += p.area_sqm;
  }
  return {
    cut_parts: parts, sheet_summary: sheets, shopping: lines,
    shopping_groups: shoppingGroupsLocal(lines), by_category: byCat,
    stats: {
      part_kinds: parts.length,
      total_pieces: parts.reduce((a, p) => a + p.qty, 0),
      total_area_sqm: Math.round(parts.reduce((a, p) => a + p.area_sqm, 0) * 1000) / 1000,
      banding_pieces: parts.filter((p) => p.banding).reduce((a, p) => a + p.qty, 0),
      banding_perimeter_m: Math.round(parts.filter((p) => p.banding)
        .reduce((a, p) => a + (2 * (p.length_mm + p.width_mm) / 1000) * p.qty, 0) * 100) / 100,
      total_sheets: sheets.reduce((a, s) => a + (s.sheets || 0), 0),
      shopping_total: lines.reduce((a, l) => a + l.amount, 0),
    },
    calc: result,
  };
}

/* ------------------------------------------------- قیمت‌گیری سریع (محلی) */
function quickUnitsLocal(opts) {
  // اگر سبک انتخاب نشده/یافت نشد، به اولین سبک برمی‌گردیم؛ وگرنه هیچ متریالی
  // به یونیت‌ها نمی‌چسبد و قیمتِ کلِ کار به «فقط اجرت» سقوط می‌کند.
  let st = STYLES.find((s) => s.id === Number(opts.style_id));
  if (!st) st = STYLES[0] || {};
  const d = st.data || {};
  const idOf = (name) => { const m = MATERIALS.find((x) => x.name === name && x.active !== false); return m ? m.id : 0; };
  const dims = (k) => ({
    length_cm: _n(SETTINGS[`unit_${k}_length_cm`], 60),
    height_cm: _n(SETTINGS[`unit_${k}_height_cm`], 72),
    depth_cm: _n(SETTINGS[`unit_${k}_depth_cm`], 55),
    shelves: _n(SETTINGS[`unit_${k}_shelves`], 1),
  });
  const base = { body_id: idOf(d.body), back_id: idOf(d.back), banding_id: idOf(d.banding),
    kickboard_id: idOf(d.kickboard), leg_id: idOf(d.leg), shelf_pin_id: idOf(d.shelf_pin) };
  const doorM = { material_id: idOf(d.door), door_model_id: idOf(d.door_model), hinge_id: idOf(d.hinge),
    handle_id: idOf(d.handle), banding_id: idOf(d.banding), assembly_id: idOf(d.assembly_door),
    packaging_id: idOf(d.packaging_door) };
  const units = [];
  const gap = 0.3;
  const make = (kind, totalM, label) => {
    if (totalM <= 0) return;
    const dd = dims(kind);
    const std = Math.max(20, dd.length_cm);
    let rem = totalM * 100;
    while (rem > 15) {
      const ln = Math.min(std, rem);
      const u = Object.assign(defaultUnit(kind), {
        label: `${label} ${Math.round(ln)}`, length_cm: Math.round(ln * 10) / 10,
        height_cm: dd.height_cm, depth_cm: dd.depth_cm,
        shelves: kind === "ground" ? 1 : dd.shelves, legs_per_unit: 4, pins_per_shelf: 4,
      }, base);
      const leaves = ln >= 70 ? 2 : 1;
      const w = (ln - gap * (leaves + 1)) / leaves;
      const h = dd.height_cm - gap;
      u.doors = [Object.assign(defaultDoor(), { qty: leaves,
        w_cm: Math.round(w * 10) / 10, h_cm: Math.round(h * 10) / 10 }, doorM)];
      if (opts.countertop_id && kind === "ground") u.countertop_id = Number(opts.countertop_id);
      units.push(u);
      rem -= std;
    }
  };
  make("ground", _n(opts.ground_lm), "یونیت زمینی");
  make("wall", _n(opts.wall_lm), "یونیت دیواری");

  const nd = Math.max(0, Math.round(_n(opts.drawers)));
  if (nd && units.length) {
    const tgt = units.find((u) => u.unit_type === "ground") || units[0];
    tgt.doors = []; tgt.shelves = 0;
    const dd = dims("ground");
    for (let i = 0; i < nd; i++) {
      tgt.drawers.push(Object.assign(defaultDrawer(), {
        label: `کشو ${fa(i + 1)}`, qty: 1,
        w_cm: Math.round((_n(tgt.length_cm) - 4) * 10) / 10,
        h_cm: i === 0 ? 15 : 22, d_cm: Math.round((dd.depth_cm - 10) * 10) / 10,
        slide_id: idOf(d.slide), sheet_id: idOf(d.drawer_sheet) || base.body_id,
        front_id: doorM.material_id, handle_id: doorM.handle_id,
        banding_id: doorM.banding_id, assembly_id: doorM.assembly_id,
      }));
    }
  }
  for (let i = 0; i < Math.max(0, Math.round(_n(opts.tall))); i++) {
    const dd = dims("tall");
    const u = Object.assign(defaultUnit("tall"), {
      label: `کمد ایستاده ${fa(i + 1)}`, length_cm: dd.length_cm,
      height_cm: dd.height_cm, depth_cm: dd.depth_cm, shelves: dd.shelves,
      legs_per_unit: 4, pins_per_shelf: 4,
    }, base);
    u.doors = [Object.assign(defaultDoor(), { label: "در کمد", qty: 2,
      w_cm: Math.round(((dd.length_cm - 0.9) / 2) * 10) / 10,
      h_cm: Math.round((dd.height_cm - 2) * 10) / 10, hinges_per_leaf: 4 }, doorM)];
    units.push(u);
  }
  return units;
}
