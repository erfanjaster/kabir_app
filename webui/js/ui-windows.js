/* ==========================================================================
   کبیر — ui-windows.js
   --------------------------------------------------------------------------
   «مدیرِ پنجره‌ها»ی بخشِ ویرایشِ پروژه.

   خواسته‌ی کاربر: هر پنجره/پنلِ ویرایشگر با موس **جابه‌جا** و **اندازه‌گیری**
   شود، چیدمانِ به‌دست‌آمده **بین نشست‌ها بماند**، و یک **حالتِ پیش‌فرض** هم
   وجود داشته باشد که با یک کنش برگردد.

   طراحی (سه لایه، تا هیچ‌کدام در دیگری نشت نکند):

   ۱) هندسه‌یِ خالص — توابعِ بدونِ DOM (logicalRect / resizeGeom / defaultLayout
      / clampWin). چون RTL هستیم، همه‌ی مختصات‌ها «منطقی»‌اند: x = فاصله از
      لبه‌یِ *شروع* (در فارسی = راست). تبدیل به فیزیکی فقط در یک جا انجام
      می‌شود (physOf) تا منطقِ کشیدن/تغییرِ اندازه RTL-آگاه بماند و آزمون‌پذیر.

   ۲) DOM — هر پنل یک `.win` می‌شود با یک نوارِ عنوان (`.win-bar`) و بدنه‌یِ
      پیچیده (`.win-body`) و ۸ دستگیره‌یِ تغییرِ اندازه. در حالتِ «مرتب»
      همان چیدمانِ جریانِ سندِ قبلی برمی‌گردد (بدنه `display:contents`) تا
      رفتارِ پیشینِ برنامه ذره‌ای عوض نشود — این «حالتِ پیش‌فرض»ی امن است.

   ۳) ماندگاری — localStorage با کلیدِ نسخه‌دار `kabir.win.layout.v1`.
      اگر مرورگر localStorage نداد (حالتِ خصوصی/فایلِ محلیِ سخت‌گیرانه) یا
      JSON خراب بود، بی‌صدا به حالتِ پیش‌فرض برمی‌گردیم؛ هرگز استثنا پرت
      نمی‌شود که ویرایشگر را بخواباند.

   ⚠ این فایل هیچ تابعی از ui.js/ui-modal.js را مستقیم صدا نمی‌زند (آن‌ها
     `"use strict"` هستند و توابعشان جهانی نمی‌شود). آنچه لازم دارد توسط
     ui.js از طریقِ `KabirWindows.inject({...})` تزریق می‌شود؛ در نبودِ آن،
     `host()` جایگزینِ بی‌خطر می‌دهد.
   ========================================================================== */
"use strict";

(function () {

  /* ------------------------------------------------------------ ثابت‌ها */
  const STORE_KEY = "kabir.win.layout.v1";
  const SCHEMA = 1;                 /* اگر ساختارِ state عوض شد، این را بالا ببر */
  const GAP = 12;                   /* فاصله‌یِ پیش‌فرضِ پنجره‌ها */
  const PAD = 12;                   /* حاشیه‌یِ امنِ بوم */
  const BAR_H = 34;                 /* ارتفاعِ نوارِ عنوانِ پنجره (برآوردِ jsdom) */
  const EDGE_KEEP = 44;             /* حداقلِ پیکسلی که باید از هر پنجره دیده شود */
  /* باندِ z پنجره‌ها: ۲۲…۲۸ — پایین‌تر از نوارِ بالایِ صفحه (۳۰) و نوارِ
     کناری (۴۰) و مودال (۱۰۰)؛ بالاتر از نوارِ جمعِ چسبان (۲۰) و نوارِ افزودن
     (۲۱). پنجره‌ی «نوارِ فرمان» استثناست و همیشه ۳۹ می‌گیرد، چون منویِ
     سرریزش (.ovf-menu با z=۶۰) باید رویِ همه‌ی پنجره‌ها بماند. */
  const Z_BASE = 22, Z_MAX = 28, Z_BAR = 29;
  /* باندِ z پنجره‌ها: ۲۲…۲۸ — پایین‌تر از نوارِ بالایِ صفحه (۳۰)، نوارِ
     کناری (۴۰)، سرریزِ جست‌وجو (۶۰) و مودال (۱۰۰)؛ بالاتر از نوارِ جمعِ
     چسبان (۲۰) و نوارِ افزودن (۲۱). پنجره‌ی «نوارِ فرمان» ۲۹ می‌گیرد:
     بالاتر از همه‌ی پنجره‌ها (تا منویِ سرریزش با z=۶۰ همیشه دیده شود) ولی
     زیرِ نوارِ عنوانِ برنامه (۳۰) تا سلسله‌مراتبِ کلیِ صفحه نشکند. */

  /* ثبتِ پنجره‌ها. `sel` باید به گره‌ای **پایدار** اشاره کند: یعنی گره‌ای که
     رندرهای دوباره‌ی ویرایشگر بازش نمی‌سازند (رندرها درونِ این پنل‌ها را
     عوض می‌کنند، نه خودشان را). */
  const REG = [
    { key: "edbar",  sel: "#editorBar",  label: "نوارِ فرمان",     minW: 420, minH: 46,  gripH: false },
    { key: "info",   sel: "#edInfoCard", label: "مشخصاتِ پروژه",  minW: 330, minH: 140, gripH: true },
    { key: "sec",    sel: "#edSecCard",  label: "بخش‌ها و ردیف‌ها", minW: 460, minH: 200, gripH: true },
    { key: "total",  sel: "#totalBar",   label: "جمع و مالی",      minW: 430, minH: 96,  gripH: true, bottom: true },
  ];

  /* لبه‌ها **فیزیکی**‌اند: جهتِ موس (clientX/clientY) و نشانگرِ موسِ CSS
     (ew/ns/nwse/nesw) هر دو فیزیکی‌اند. تبدیل به «منطقی» (که در RTL محورِ x
     وارونه است) فقط درونِ resizeGeom و با یک علامت انجام می‌شود. */
  const EDGES = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

  /* --------------------------------------------------------- وضعیتِ جاری */
  let S = null;                     /* {mode, wins:{key:{x,y,w,h,min,max,hidden}}} */
  let wins = [];                    /* [{def, el, bar, body, handles}] */
  let zTop = Z_BASE;
  let booted = false;
  let hooks = null;                 /* تزریقِ ui.js */

  /* --------------------------------------------------------- ابزارِ کوچک */
  const n = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  const rd = (v) => Math.round(v * 10) / 10;
  const clampNum = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function host() {
    if (hooks) return hooks;
    const back = document.getElementById("modalBackdrop");
    return {
      isModalOpen: () => !!(back && !back.hidden),
      editorOpen: () => {
        const p = document.getElementById("projectEditor");
        return !!(p && !p.hidden);
      },
      toast: () => {},
      isCoarse: () => false,
      save: () => {}, load: () => null,
    };
  }

  /* =======================================================================
     لایه‌ی ۱ — هندسه‌یِ خالص (بدونِ DOM، آزمون‌پذیر با node)
     ======================================================================= */

  /** راست‌به‌چپ هستیم؟ (یک‌جا، تا بقیه‌ی کد حدس نزند) */
  function isRTL(doc) {
    const d = doc || document;
    if (!d || !d.documentElement) return true;
    return (d.documentElement.getAttribute("dir") || d.body && d.body.getAttribute("dir") || "rtl")
      .toLowerCase() !== "ltr";
  }

  /**
   * مستطیلِ «منطقی»: x از لبه‌یِ شروعِ بوم (در RTL = راست)، y از بالا.
   * `dir` فقط همین‌جا به هندسه راه پیدا می‌کند.
   */
  function logicalRect(phys, canvasW, dir) {
    const rtl = (dir === undefined ? true : dir !== "ltr");
    const w = n(phys && phys.w, 0), h = n(phys && phys.h, 0);
    const left = n(phys && phys.x, 0);
    return { x: rtl ? canvasW - left - w : left, y: n(phys && phys.y, 0), w: w, h: h };
  }

  /** وارونِ logicalRect — برایِ نوشتنِ style. */
  function physOf(log, canvasW, dir) {
    const rtl = (dir === undefined ? true : dir !== "ltr");
    return { x: rtl ? canvasW - log.x - log.w : log.x, y: log.y, w: log.w, h: log.h };
  }

  /**
   * تغییرِ اندازه از یک لبه/گوشه.
   * @param {object} r        مستطیلِ منطقیِ کنونی {x,y,w,h}
   * @param {string} edge     یکی از EDGES
   * @param {number} dx       جابه‌جاییِ فیزیکیِ افقیِ موس (پیکسل)
   * @param {number} dy       جابه‌جاییِ فیزیکیِ عمودیِ موس
   * @param {object} o        {minW,minH,maxW,maxH,rtl}
   * @returns {object} مستطیلِ منطقیِ تازه
   *
   * نکته‌ی RTL: در RTL کشیدنِ دستگیره‌یِ «شرق» (فیزیکیِ راست) یعنی بزرگ‌شدنِ
   * `x` منطقیِ … نه — یعنی *کوچک‌شدنِ* عرض، چون لبه‌یِ شرق = لبه‌یِ شروعِ منطقی.
   * این تبدیل دقیقاً همان چیزی است که این تابع یک‌جا انجام می‌دهد.
   */
  function resizeGeom(r, edge, dx, dy, o) {
    o = o || {};
    const rtl = o.rtl !== false;
    const minW = n(o.minW, 120), minH = n(o.minH, 60);
    const maxW = o.maxW ? Math.max(minW, o.maxW) : Infinity;
    const maxH = o.maxH ? Math.max(minH, o.maxH) : Infinity;
    /* دو تبدیل، هر دو لازم:
       ۱) لبه‌ی *فیزیکی* «e» (راست) در RTL همان لبه‌ی *منطقیِ* «شروع» است،
          چون x منطقی از راست شمرده می‌شود → نقشِ دو لبه‌ی افقی عوض می‌شود.
       ۲) خودِ دلتایِ افقیِ موس هم در محورِ منطقی وارونه است (ldx = -dx). */
    const ldx = rtl ? -dx : dx;
    const growEnd = (edge.indexOf("e") >= 0) !== !!rtl;   /* رشدِ لبه‌ی پایانِ منطقی */
    const growStart = (edge.indexOf("w") >= 0) !== !!rtl;  /* رشدِ لبه‌ی شروعِ منطقی */
    let x = r.x, y = r.y, w = r.w;
    /* ارتفاعِ «خودکار» (h=null) یعنی هنوز اندازه‌ی دستی ندارد؛ برایِ محاسبه،
       حداقلِ مجاز را مبنا می‌گیریم تا اولین کشیدن از یک عددِ معنادار شروع شود. */
    let h = r.h == null ? minH : r.h;
    const right = r.x + r.w, bottom = r.y + h;

    if (growEnd) { w = clampNum(w + ldx, minW, maxW); }
    if (growStart) {
      const nw = clampNum(w - ldx, minW, maxW);
      x = right - nw; w = nw;
    }
    if (edge.indexOf("s") >= 0) { h = clampNum(h + dy, minH, maxH); }
    if (edge.indexOf("n") >= 0) {
      const nh = clampNum(h - dy, minH, maxH);
      y = bottom - nh; h = nh;
    }
    return { x: rd(x), y: rd(y), w: rd(w), h: rd(h) };
  }

  /** نگه‌داشتنِ پنجره درونِ بوم — طوری که همیشه «قابلِ گرفتن» بماند. */
  function clampWin(g, cw, ch, o) {
    o = o || {};
    const pad = n(o.pad, PAD), keep = n(o.keep, EDGE_KEEP);
    let x = n(g.x, 0), y = n(g.y, 0);
    const w = Math.max(n(g.w, 200), n(o.minW, 120));
    const h = g.h == null ? null : Math.max(n(g.h, 120), n(o.minH, 60));
    /* افقی: لبه‌یِ شروع حداقل `keep` پیکسل درونِ بوم بماند تا نوارِ عنوان
       همیشه «قابلِ گرفتن» باشد؛ و لبه‌یِ پایان هم از بوم بیرونِ کامل نرود. */
    x = clampNum(x, pad - w + keep, Math.max(pad, cw - pad) - keep);
    /* عمودی: اگر پنجره کوتاه‌تر از بوم است، کامل درونِ آن بماند؛ اگر بلندتر
       است، فقط نوارِ عنوانش باید دیده شود (ورنه کاربر انتهایش را گم می‌کند). */
    if (h == null) {
      y = clampNum(y, pad, Math.max(pad, ch - BAR_H - pad));
    } else if (h + 2 * pad <= ch) {
      /* کوتاه‌تر از بوم → کامل درونِ آن بماند */
      y = clampNum(y, pad, Math.max(pad, ch - h - pad));
    } else {
      y = clampNum(y, pad - h + keep, Math.max(pad, ch - BAR_H - pad));
    }
    return { x: rd(x), y: rd(y), w: rd(w), h: h == null ? null : rd(h) };
  }

  /**
   * چیدمانِ پیش‌فرض («حالتِ پیش‌فرض»ی کاربر).
   * عمداً شبیهِ همان چیدمانِ مستندیِ پیشین است، با یک تفاوتِ مفید: کارتِ
   * «مشخصاتِ پروژه» کنارِ «بخش‌ها» می‌نشیند تا در صفحه‌هایِ پهن، ردیف‌ها
   * بدونِ اسکرولِ عمودی دیده شوند. در عرضِ کم، دوباره زیرِ هم می‌روند.
   * @returns {object} نگاشتِ key → مستطیلِ منطقی
   */
  function defaultLayout(cw, ch, o) {
    o = o || {};
    const pad = n(o.pad, PAD), gap = n(o.gap, GAP);
    const meas = (o.heights && typeof o.heights === "object") ? o.heights : {};
    const barH = Math.max(28, n(meas.edbar, n(o.barH, BAR_H)));
    const inner = Math.max(320, cw - pad * 2);
    const narrow = inner < n(o.narrow, 1040);
    const out = {};

    out.edbar = { x: pad, y: pad, w: inner, h: null };

    const y0 = pad + barH + gap;
    if (narrow) {
      out.info = { x: pad, y: y0, w: inner, h: null };
      const infoH = Math.max(120, n(meas.info, n(o.infoH, 220)));
      out.sec = { x: pad, y: y0 + infoH + gap, w: inner, h: n(o.secH, 520) };
    } else {
      const wInfo = Math.max(300, Math.round(inner * 0.32));
      const wSec = Math.max(360, inner - wInfo - gap);
      out.info = { x: pad, y: y0, w: wInfo, h: null };
      out.sec = { x: pad + wInfo + gap, y: y0, w: wSec, h: n(o.secH, 520) };
    }

    /* نوارِ «جمع و مالی» پایینِ بوم لنگر می‌خورد — همان حسی که sticky-bottom
       پیش‌تر می‌داد، اما حالا خودش یک پنجره‌یِ جداست. */
    const totalH = Math.max(90, n(meas.total, n(o.totalH, 128)));
    /* «کفِ» بوم: هرچه بلندتر باشد؛ ولی نه بیشتر از ۱٫۵ برابرِ نمایشگر،
       وگرنه نوارِ «جمع و مالی» در صفحه‌هایِ بلند به‌قدرِ یک اسکرول دور می‌افتد. */
    const floor = Math.min(Math.max(ch, out.sec.y + out.sec.h + gap + totalH + pad), ch * 1.5);
    out.total = { x: pad, y: floor - totalH - pad, w: inner, h: totalH };
    return out;
  }

  /* =======================================================================
     لایه‌ی ۳ — ماندگاری
     ======================================================================= */

  function defaultState() {
    const st = { v: SCHEMA, mode: "free", wins: {}, modals: {} };
    REG.forEach((d) => {
      st.wins[d.key] = { x: null, y: null, w: null, h: null, min: false, max: false, hidden: false };
    });
    return st;
  }

  function sanitize(raw) {
    const st = defaultState();
    if (!raw || typeof raw !== "object") return st;
    st.mode = raw.mode === "stacked" ? "stacked" : "free";
    const w = (raw.wins && typeof raw.wins === "object") ? raw.wins : {};
    REG.forEach((d) => {
      const s = w[d.key];
      if (!s || typeof s !== "object") return;
      const t = st.wins[d.key];
      /* عددِ نامعتبر = «نداریم» → null، تا seedDefault مقدارِ پیش‌فرض بگذارد
         (صفرِ تصادفی، پنجره را به گوشه‌ی بوم می‌چسباند و کاربر گم می‌کند). */
      const opt = (v, lo) => (typeof v === "number" && isFinite(v) && v >= lo ? rd(v) : null);
      t.x = opt(s.x, -1e6);
      t.y = opt(s.y, -1e6);
      t.w = s.w == null ? null : rd(clampNum(n(s.w, 0), d.minW, 8000));
      t.h = s.h == null ? null : rd(clampNum(n(s.h, 0), d.minH, 8000));
      t.hiddenH = (typeof s.hiddenH === "number" && isFinite(s.hiddenH)) ? rd(s.hiddenH) : null;
      t.min = !!s.min; t.max = !!s.max; t.hidden = !!s.hidden;
    });
    /* مودال‌ها: شناسه‌ها از پیش شناخته‌شده نیستند (در HTML ساخته می‌شوند)،
       پس فقط شکلِ داده را اعتبارسنجی می‌کنیم و جلوی انفجار را می‌گیریم. */
    const md = (raw.modals && typeof raw.modals === "object") ? raw.modals : {};
    const num = (v, lo, hi) => (typeof v === "number" && isFinite(v) ? rd(clampNum(v, lo, hi)) : null);
    let count = 0;
    Object.keys(md).forEach((k) => {
      if (count >= 40 || !/^[a-z0-9][a-z0-9_-]{0,40}$/i.test(k)) return;
      const m = md[k];
      if (!m || typeof m !== "object") return;
      st.modals[k] = {
        x: num(m.x, -1e5, 1e5), y: num(m.y, -1e5, 1e5),
        w: m.w == null ? null : rd(clampNum(n(m.w, 0), MODAL_MIN_W, 8000)),
        h: m.h == null ? null : rd(clampNum(n(m.h, 0), MODAL_MIN_H, 8000)),
      };
      count++;
    });
    return st;
  }

  function load() {
    const fromHost = host().load();
    if (fromHost) { S = sanitize(fromHost); return; }
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { raw = null; }
    S = sanitize(raw);
  }

  function persist() {
    if (!S) return;
    const payload = { v: SCHEMA, mode: S.mode, wins: {}, modals: {} };
    REG.forEach((d) => {
      const s = S.wins[d.key] || {};
      payload.wins[d.key] = {
        x: s.x == null ? null : rd(s.x), y: s.y == null ? null : rd(s.y),
        w: s.w == null ? null : rd(s.w), h: s.h == null ? null : rd(s.h),
        hiddenH: s.hiddenH == null ? null : rd(s.hiddenH),
        min: !!s.min, max: !!s.max, hidden: !!s.hidden,
      };
    });
    if (S.modals) {
      Object.keys(S.modals).forEach((k) => {
        const m = S.modals[k] || {};
        if (m.x == null && m.y == null && m.w == null && m.h == null) return;
        payload.modals[k] = {
          x: m.x == null ? null : rd(m.x), y: m.y == null ? null : rd(m.y),
          w: m.w == null ? null : rd(m.w), h: m.h == null ? null : rd(m.h),
        };
      });
    }
    let ok = false;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(payload)); ok = true; } catch (e) { ok = false; }
    const h = host();
    if (h.save) { try { h.save(payload); } catch (e) {} }
    return ok;
  }

  /* =======================================================================
     لایه‌ی ۲ — DOM
     ======================================================================= */

  const ICO = {
    grip: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="8" cy="6" r="1.6"/><circle cx="16" cy="6" r="1.6"/><circle cx="8" cy="12" r="1.6"/><circle cx="16" cy="12" r="1.6"/><circle cx="8" cy="18" r="1.6"/><circle cx="16" cy="18" r="1.6"/></svg>',
    min: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    max: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><rect x="4.5" y="4.5" width="15" height="15" rx="2.5"/></svg>',
    res: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><rect x="4" y="9" width="11" height="11" rx="2"/><path d="M9 5.5A1.5 1.5 0 0 1 10.5 4h8A1.5 1.5 0 0 1 20 5.5v8A1.5 1.5 0 0 1 18.5 15"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
  };

  function mk(tag, cls, html, title) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (title) e.title = title;
    return e;
  }

  function mkBtn(cls, label, title, ico) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "win-btn " + cls;
    b.setAttribute("aria-label", label);
    b.title = title;
    b.innerHTML = ico;
    return b;
  }

  function findWindow(el) {
    if (!el || !el.closest) return null;
    const w = el.closest(".win");
    if (!w) return null;
    for (const it of wins) if (it.el === w) return it;
    return null;
  }

  /** اندازه‌ی بومِ ویرایشگر (با جایگزینِ امن برایِ jsdom که چیدمان ندارد). */
  function canvasSize() {
    const ed = document.getElementById("projectEditor");
    let w = 0, h = 0;
    if (ed) {
      w = ed.clientWidth || (ed.getBoundingClientRect ? Math.round(ed.getBoundingClientRect().width) : 0);
      h = ed.clientHeight || (ed.getBoundingClientRect ? Math.round(ed.getBoundingClientRect().height) : 0);
    }
    if (!w) w = (typeof window !== "undefined" && window.innerWidth) || 1280;
    const vh = (typeof window !== "undefined" && window.innerHeight) || 800;
    if (!h) h = vh;
    return { w: Math.max(320, w), h: Math.max(240, Math.max(h, vh - 140)), vh: vh };
  }

  /** مستطیلِ منطقیِ کنونیِ یک پنجره (اول اندازه‌ی واقعی، بعد حالتِ ذخیره‌شده). */
  function readGeom(it) {
    const c = canvasSize();
    const st = S.wins[it.def.key] || {};
    const r = it.el.getBoundingClientRect ? it.el.getBoundingClientRect() : null;
    let w = st.w, h = st.h;
    if (!w && r && r.width) w = Math.round(r.width);
    if (!h && r && r.height) h = Math.round(r.height);
    if (!w) w = Math.max(it.def.minW, Math.round(c.w * 0.5));
    if (!h) h = Math.max(it.def.minH, 160);
    return { x: n(st.x, 0), y: n(st.y, 0), w: w, h: h, cw: c.w, ch: c.h };
  }

  function writeGeom(it, g, opt) {
    const st = S.wins[it.def.key] || (S.wins[it.def.key] = {});
    const c = canvasSize();
    const rtl = isRTL(document);
    const keepH = !(opt && opt.autoHeight);
    if (g.x != null) st.x = rd(g.x);
    if (g.y != null) st.y = rd(g.y);
    if (g.w != null) st.w = rd(g.w);
    st.h = keepH && g.h != null ? rd(g.h) : null;
    const log = { x: n(st.x, 0), y: n(st.y, 0), w: n(st.w, Math.max(it.def.minW, c.w * 0.5)), h: st.h };
    const p = physOf(log, c.w, rtl ? "rtl" : "ltr");
    const s = it.el.style;
    s.position = "absolute";
    s.top = rd(log.y) + "px";
    if (rtl) { s.insetInlineStart = rd(log.x) + "px"; s.left = ""; s.right = ""; }
    else { s.left = rd(log.x) + "px"; s.right = ""; s.insetInlineStart = ""; }
    s.width = rd(log.w) + "px";
    s.height = st.h == null ? "auto" : rd(st.h) + "px";
    it.el.setAttribute("data-win-h", st.h == null ? "auto" : "fixed");
    return p;
  }

  function syncCanvas() {
    const ed = document.getElementById("projectEditor");
    if (!ed) return;
    const c = canvasSize();
    let bottom = 0;
    if (S.mode === "free") {
      wins.forEach((it) => {
        const st = S.wins[it.def.key] || {};
        if (st.hidden || st.min) return;               /* دیده نمی‌شود → بوم را بزرگ نکن */
        const h = st.h != null ? st.h
          : (it.el.getBoundingClientRect ? it.el.getBoundingClientRect().height : 0);
        bottom = Math.max(bottom, n(st.y, 0) + n(h, 0));
      });
    }
    if (S.mode !== "free") { ed.style.minHeight = ""; return; }
    /* سقفِ منطقی: بوم نباید به‌خاطرِ یک پنجره‌ی بلندِ «ارتفاعِ خودکار» چند برابرِ
       نمایشگر شود؛ کاربر خودش می‌تواند پنجره را پایین‌تر بکشد و بوم با او رشد کند. */
    ed.style.minHeight = Math.max(c.vh - 150, Math.min(bottom + PAD * 2, c.vh * 1.6)) + "px";
  }

  function applyAll() {
    const ed = document.getElementById("projectEditor");
    if (!ed) return;
    const free = S.mode === "free" && !forceStacked();
    ed.classList.toggle("win-free", free);
    ed.classList.toggle("win-stacked", !free);
    wins.forEach((it) => {
      const st = S.wins[it.def.key] || {};
      it.el.classList.toggle("min", !!st.min && free);
      it.el.classList.toggle("max", !!st.max && free);
      it.el.hidden = !!st.hidden;
      if (free && !st.hidden) {
        if (st.x == null || st.w == null) seedDefault(it);
        /* پنجره‌ی کوچک‌شده ارتفاعِ دستی ندارد — وگرنه هر applyAll ارتفاعِ
           h=2580 را بازمی‌نشاند و CSSِ `height:auto !important` تنها می‌ماند. */
        writeGeom(it, { x: st.x, y: st.y, w: st.w, h: st.h }, { autoHeight: !!st.min });
      } else {
        it.el.style.position = "";
        it.el.style.top = ""; it.el.style.left = ""; it.el.style.right = "";
        it.el.style.insetInlineStart = ""; it.el.style.width = ""; it.el.style.height = "";
        it.el.style.zIndex = "";
      }
      /* پشته‌یِ z: نوارِ فرمان همیشه بالا؛ بقیه به ترتیبِ ثبت (و بعد از آن،
         ترتیبی که bringToFront ساخته). بدونِ این خط، پنجره‌ها تا نخستین کلیک
         هیچ z نمی‌گرفتند و ترتیبِ دیده‌شدن‌شان به ترتیبِ DOM وابسته می‌ماند. */
      if (free) it.el.style.zIndex = String(zOf(it));
      syncBtn(it);
    });
    syncCanvas();
  }

  function zOf(it) {
    if (it.def.key === "edbar") return Z_BAR;
    if (!it.el.style.zIndex) it.el.style.zIndex = String(Math.min(Z_MAX, ++zTop));
    return parseInt(it.el.style.zIndex, 10) || Z_BASE;
  }

  function syncBtn(it) {
    const st = S.wins[it.def.key] || {};
    const bMax = it.bar.querySelector("[data-win='max']");
    if (bMax) {
      bMax.innerHTML = st.max ? ICO.res : ICO.max;
      bMax.title = st.max ? "بازگردانی اندازه" : "پُرکردنِ بوم";
      bMax.setAttribute("aria-label", st.max ? "بازگردانی اندازه" : "بزرگ‌نمایی");
    }
    const bMin = it.bar.querySelector("[data-win='min']");
    if (bMin) {
      bMin.innerHTML = st.min ? ICO.res : ICO.min;
      bMin.title = st.min ? "بازکردنِ پنجره" : "کوچک‌کردن (فقط نوارِ عنوان)";
    }
  }

  /** ارتفاعِ واقعیِ اندازه‌گیری‌شده‌ی پنجره‌ها (برایِ چیدمانِ پیش‌فرضِ دقیق). */
  function measuredHeights() {
    const h = {};
    wins.forEach((it) => {
      if (it.el.hidden) return;
      const r = it.el.getBoundingClientRect ? it.el.getBoundingClientRect() : null;
      if (r && r.height > 4) h[it.def.key] = Math.round(r.height);
    });
    return h;
  }

  function seedDefault(it) {
    const c = canvasSize();
    const d = defaultLayout(c.w, c.h, { heights: measuredHeights() });
    const g = d[it.def.key];
    if (!g) return;
    const st = S.wins[it.def.key];
    if (st.x == null) st.x = g.x;
    if (st.y == null) st.y = g.y;
    if (st.w == null) st.w = g.w;
    if (st.h == null && g.h != null && it.def.gripH) st.h = g.h;
  }

  /* ------------------------------------------------------- زدن روی هم */
  function bringToFront(it) {
    if (!it || S.mode !== "free") return;
    if (it.def.key === "edbar") { it.el.style.zIndex = String(Z_BAR); return; }
    const cur = parseInt(it.el.style.zIndex, 10) || Z_BASE;
    if (cur === zTop) return;                      /* همین حالا هم بالاست */
    if (zTop >= Z_MAX) {                           /* باند پر شد → فشرده‌سازیِ ترتیب */
      const order = wins.filter((w) => w.def.key !== "edbar")
        .sort((a, b) => (parseInt(a.el.style.zIndex, 10) || Z_BASE) - (parseInt(b.el.style.zIndex, 10) || Z_BASE));
      let z = Z_BASE;
      order.forEach((w) => { w.el.style.zIndex = String(z++); });
      zTop = z - 1;
    }
    it.el.style.zIndex = String(++zTop);
  }

  /* --------------------------------------------------- کشیدن و اندازه‌گیری */
  const HAS_POINTER = (typeof window !== "undefined") && !!window.PointerEvent;
  const EV_DOWN = HAS_POINTER ? "pointerdown" : "mousedown";
  const EV_MOVE = HAS_POINTER ? "pointermove" : "mousemove";
  const EV_UP = HAS_POINTER ? "pointerup" : "mouseup";

  /** آیا رویِ چیزی هستیم که نباید پنجره را بکشد؟ (ورودی/دکمه/پیوند/…) */
  function isInteractive(t) {
    return !!(t && t.closest && t.closest(
      "button, input, select, textarea, a, [role='button'], kbd, summary, label, .win-btn, .win-grip-i"));
  }

  function dragify(it) {
    const start = (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      if (S.mode !== "free" || forceStacked()) return;
      if (isInteractive(ev.target)) return;
      if (host().isModalOpen()) return;
      ev.preventDefault();
      bringToFront(it);
      const g = readGeom(it);
      const sx = ev.clientX, sy = ev.clientY;
      const rtl = isRTL(document);
      const st = S.wins[it.def.key];
      if (st.max) { st.max = false; syncBtn(it); }
      it.el.classList.add("dragging");
      document.body.classList.add("win-dragging");
      if (it.el.setPointerCapture && ev.pointerId != null) {
        try { it.el.setPointerCapture(ev.pointerId); } catch (e) {}
      }
      const move = (e2) => {
        const c = canvasSize();
        /* در RTL حرکتِ موس به چپ یعنی دورشدن از لبه‌یِ «شروعِ منطقی» (راست)،
           پس x منطقی بزرگ می‌شود → علامتِ دلتا وارونه است. */
        const ldx = rtl ? (sx - e2.clientX) : (e2.clientX - sx);
        const ng = clampWin({ x: g.x + ldx, y: g.y + (e2.clientY - sy), w: g.w, h: st.h },
          c.w, c.h, { minW: it.def.minW, minH: it.def.minH });
        st.x = ng.x; st.y = ng.y;
        writeGeom(it, { x: ng.x, y: ng.y, w: g.w, h: st.h });
        syncCanvas();
      };
      const up = () => {
        document.removeEventListener(EV_MOVE, move, true);
        document.removeEventListener(EV_UP, up, true);
        it.el.classList.remove("dragging");
        document.body.classList.remove("win-dragging");
        syncCanvas(); persist();
      };
      document.addEventListener(EV_MOVE, move, true);
      document.addEventListener(EV_UP, up, true);
    };
    it.bar.addEventListener(EV_DOWN, start);
    if (HAS_POINTER) it.bar.style.touchAction = "none";
    /* دوبار کلیک روی نوارِ عنوان = ارتفاعِ خودکار ↔ همان ارتفاعِ دستی */
    it.bar.addEventListener("dblclick", (ev) => {
      if (isInteractive(ev.target) || S.mode !== "free") return;
      ev.preventDefault(); toggleMax(it);
    });
  }

  function resizeify(it) {
    EDGES.forEach((edge) => {
      const h = mk("span", "win-rz win-rz-" + edge);
      h.setAttribute("data-edge", edge);
      h.setAttribute("aria-hidden", "true");
      if (HAS_POINTER) h.style.touchAction = "none";
      it.el.appendChild(h);
      h.addEventListener(EV_DOWN, (ev) => {
        if (ev.button !== undefined && ev.button !== 0) return;
        if (S.mode !== "free" || forceStacked() || host().isModalOpen()) return;
        ev.preventDefault(); ev.stopPropagation();
        bringToFront(it);
        const st = S.wins[it.def.key];
        if (st.max) { st.max = false; syncBtn(it); }
        const c = canvasSize();
        const rtl = isRTL(document);
        const cur = { x: n(st.x, 0), y: n(st.y, 0), w: n(st.w, it.def.minW), h: n(st.h, it.def.minH) };
        if (st.h == null) {
          /* ارتفاعِ «خودکار» هنوز در state نیست — از اندازه‌ی واقعی بخوان تا
             اولین کشیدنِ لبه از همان ارتفاعِ دیده‌شده شروع شود، نه از minH. */
          const r = it.el.getBoundingClientRect();
          if (r && r.height) cur.h = Math.round(r.height);
        }
        const sx = ev.clientX, sy = ev.clientY;
        const base = { x: cur.x, y: cur.y, w: cur.w, h: cur.h };
        it.el.classList.add("resizing");
        document.body.classList.add("win-dragging");
        const move = (e2) => {
          const c2 = canvasSize();
          const ng = resizeGeom(base, edge, e2.clientX - sx, e2.clientY - sy,
            { minW: it.def.minW, minH: it.def.minH, maxW: c2.w - PAD * 2, maxH: 8000, rtl: rtl });
          writeGeom(it, clampWin(ng, c2.w, c2.h, { minW: it.def.minW, minH: it.def.minH }));
          syncCanvas();
        };
        const up = () => {
          document.removeEventListener(EV_MOVE, move, true);
          document.removeEventListener(EV_UP, up, true);
          it.el.classList.remove("resizing");
          document.body.classList.remove("win-dragging");
          syncCanvas(); persist();
        };
        document.addEventListener(EV_MOVE, move, true);
        document.addEventListener(EV_UP, up, true);
      });
    });
  }

  /* ------------------------------------------------------------ کنش‌ها */
  function setMin(it, on) {
    const st = S.wins[it.def.key];
    if (st.min === on) return;
    /* ارتفاعِ دستی را نگه می‌داریم: در حالتِ کوچک‌شده `h` را null می‌کنیم تا
       CSS تنها نوارِ عنوان را نشان دهد، و هنگامِ بازکردن همان ارتفاعِ پیشین
       برگردد (نه «خودکار» و نه صفر). */
    if (on) { st.hiddenH = st.h == null ? null : st.h; st.h = null; st.max = false; }
    else { if (st.hiddenH != null) st.h = st.hiddenH; st.hiddenH = null; }
    st.min = on;
    applyOne(it); syncCanvas(); persist();
  }
  function toggleMax(it) {
    const st = S.wins[it.def.key];
    const c = canvasSize();
    if (st.max) {
      st.max = false;
      if (st.prev) { Object.assign(st, st.prev); st.prev = null; }
      else st.h = null;
    } else {
      st.prev = { x: st.x, y: st.y, w: st.w, h: st.h };
      st.max = true; st.min = false;
      st.x = PAD; st.y = PAD;
      st.w = Math.max(it.def.minW, c.w - PAD * 2);
      st.h = Math.max(it.def.minH, c.h - PAD * 2);
    }
    applyOne(it); persist();
  }
  function setHidden(it, on) {
    const st = S.wins[it.def.key];
    st.hidden = on; if (on) st.min = false;
    applyOne(it); syncCanvas(); persist();
  }
  function applyOne(it) {
    const free = S.mode === "free" && !forceStacked();
    const st = S.wins[it.def.key];
    it.el.classList.toggle("min", !!st.min && free);
    it.el.classList.toggle("max", !!st.max && free);
    it.el.hidden = !!st.hidden;
    if (free && !st.hidden) {
      writeGeom(it, { x: st.x, y: st.y, w: st.w, h: st.h }, { autoHeight: !!st.min });
      if (free && it.def.key === "edbar") it.el.style.zIndex = String(Z_BAR);
      else if (free) zOf(it);
    }
    syncBtn(it);
  }

  /** صفحه‌کلید/لمسِ درشت یا عرضِ کم → چیدمانِ مرتب (پنجره‌ی شناور معنا ندارد). */
  function forceStacked() {
    const h = host();
    if (h.isCoarse && h.isCoarse()) return true;
    try {
      if (window.matchMedia && window.matchMedia("(max-width: 860px)").matches) return true;
    } catch (e) {}
    return false;
  }

  function setMode(mode, quiet) {
    const want = mode === "stacked" ? "stacked" : "free";
    if (forceStacked() && want === "free") {
      host().toast("در این اندازه‌ی صفحه، چیدمانِ مرتب بهتر کار می‌کند — حالتِ پنجره‌ای روی صفحه‌هایِ بزرگ فعال است.", "info");
      return false;
    }
    S.mode = want;
    applyAll(); refreshModals(); persist();
    if (!quiet) {
      host().toast(want === "free"
        ? "حالتِ <b>پنجره‌ای</b>: هر پنل را با نوارِ عنوانش بکش و از لبه‌هایش اندازه‌اش را عوض کن. <kbd>Alt+0</kbd> = بازگشت به پیش‌فرض."
        : "حالتِ <b>مرتب</b>: پنل‌ها مثلِ قبل زیرِ هم در جریانِ صفحه‌اند.", "success");
    }
    return true;
  }

  function resetLayout(msg) {
    const c = canvasSize();
    const d = defaultLayout(c.w, c.h, { heights: measuredHeights() });
    S.wins = {};
    REG.forEach((def) => {
      const g = d[def.key] || { x: PAD, y: PAD, w: c.w - PAD * 2, h: null };
      S.wins[def.key] = {
        x: g.x, y: g.y, w: g.w, h: (def.gripH ? g.h : null),
        min: false, max: false, hidden: false, prev: null,
      };
    });
    S.modals = {};
    zTop = Z_BASE;
    S.mode = forceStacked() ? "stacked" : "free";
    applyAll(); refreshModals(); persist();
    host().toast(msg === undefined ? "چیدمانِ پنجره‌ها (و پنجره‌های گفتگو) به <b>حالتِ پیش‌فرض</b> برگشت." : msg, "success");
  }

  /* --------------------------------------------------------- ساختِ پنجره‌ها */
  function buildWindow(def) {
    const el = document.querySelector(def.sel);
    if (!el) return null;
    el.classList.add("win");
    el.setAttribute("data-win", def.key);
    el.setAttribute("data-win-role", "window");

    const bar = mk("div", "win-bar");
    bar.innerHTML = '<span class="win-grip" aria-hidden="true">' + ICO.grip + "</span>" +
      '<span class="win-title">' + def.label + "</span>";
    const actions = mk("div", "win-actions");
    const bMin = mkBtn("", "کوچک‌کردن", "کوچک‌کردن (فقط نوارِ عنوان)", ICO.min);
    bMin.setAttribute("data-win", "min");
    const bMax = mkBtn("", "بزرگ‌نمایی", "پُرکردنِ بوم", ICO.max);
    bMax.setAttribute("data-win", "max");
    const bClose = mkBtn("", "بستنِ پنجره", "بستنِ این پنجره (از منوی ⋯ برمی‌گردد)", ICO.close);
    bClose.setAttribute("data-win", "close");
    actions.append(bMin, bMax, bClose);
    bar.appendChild(actions);
    el.insertBefore(bar, el.firstChild);

    const body = mk("div", "win-body");
    while (bar.nextSibling) body.appendChild(bar.nextSibling);
    el.appendChild(body);

    const it = { def: def, el: el, bar: bar, body: body };
    bar.addEventListener("mousedown", () => bringToFront(it));
    el.addEventListener("mousedown", () => { if (S && S.mode === "free") bringToFront(it); });
    actions.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-win]");
      if (!b) return;
      ev.preventDefault(); ev.stopPropagation();
      const act = b.getAttribute("data-win");
      if (act === "min") setMin(it, !(S.wins[it.def.key] || {}).min);
      else if (act === "max") toggleMax(it);
      else if (act === "close") {
        setHidden(it, true);
        host().toast("پنجره‌ی «" + def.label + "» بسته شد — از منوی ⋯ ← «بازگردانیِ پنجره‌های بسته» برمی‌گردد.", "info");
      }
    });
    dragify(it);
    resizeify(it);
    return it;
  }

  /* ------------------------------------------------- سیم‌کشیِ منو و کلیدها */
  function wireMenu() {
    const menu = document.querySelector("#ovfEditor .ovf-menu");
    if (!menu || menu.querySelector("[data-winmenu]")) return;
    const sep = mk("div", "ovf-sep"); sep.setAttribute("role", "none");
    const label = mk("div", "ovf-label", "چیدمانِ پنجره‌ها"); label.setAttribute("role", "presentation");
    const b1 = mk("button", "ovf-item", "حالتِ پنجره‌ای (جابه‌جایی و تغییرِ اندازه با موس) — <kbd>Alt+W</kbd>");
    b1.type = "button"; b1.setAttribute("role", "menuitem"); b1.setAttribute("data-winmenu", "free");
    const b2 = mk("button", "ovf-item", "حالتِ مرتب (چیدمانِ مستندیِ ساده)");
    b2.type = "button"; b2.setAttribute("role", "menuitem"); b2.setAttribute("data-winmenu", "stacked");
    const b3 = mk("button", "ovf-item", "بازنشانیِ چیدمانِ پیش‌فرض (پنل‌ها و گفتگوها) — <kbd>Alt+0</kbd>");
    b3.type = "button"; b3.setAttribute("role", "menuitem"); b3.setAttribute("data-winmenu", "reset");
    const b4 = mk("button", "ovf-item", "بازگردانیِ پنجره‌های بسته/کوچک‌شده");
    b4.type = "button"; b4.setAttribute("role", "menuitem"); b4.setAttribute("data-winmenu", "restore");
    menu.insertBefore(sep, menu.firstChild);
    menu.insertBefore(label, menu.firstChild ? menu.firstChild.nextSibling : null);
    /* درجِ معکوس تا ترتیبِ نهایی بشود: [sep][label][b1][b2][b3][b4]… */
    [b4, b3, b2, b1].forEach((b) => menu.insertBefore(b, menu.children[2]));
    menu.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-winmenu]");
      if (!b) return;
      const act = b.getAttribute("data-winmenu");
      if (act === "free") setMode("free");
      else if (act === "stacked") setMode("stacked");
      else if (act === "reset") resetLayout();
      else if (act === "restore") restoreAll();
      markMode(menu);
    });
    markMode(menu);
  }

  function markMode(menu) {
    if (!menu) return;
    const free = menu.querySelector("[data-winmenu='free']");
    const stacked = menu.querySelector("[data-winmenu='stacked']");
    if (free) free.classList.toggle("active", S.mode === "free");
    if (stacked) stacked.classList.toggle("active", S.mode === "stacked");
  }

  function restoreAll() {
    let k = 0;
    wins.forEach((it) => {
      const st = S.wins[it.def.key];
      if (st.hidden || st.min) { st.hidden = false; st.min = false; k++; }
    });
    applyAll(); persist();
    host().toast(k ? k + " پنجره برگشت." : "همه‌ی پنجره‌ها همین حالا پیدایند.", "success");
  }

  function wireKeys() {
    document.addEventListener("keydown", (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const h = host();
      if (h.isModalOpen() || !h.editorOpen()) return;
      const t = document.activeElement;
      const typing = t && /input|textarea|select/i.test(t.tagName) && !t.readOnly;
      const k = String(e.key || "").toLowerCase();
      const code = String(e.code || "");
      if ((k === "w" || code === "KeyW") && !typing) {
        e.preventDefault(); setMode(S.mode === "free" ? "stacked" : "free");
        const menu = document.querySelector("#ovfEditor .ovf-menu"); markMode(menu);
      } else if ((k === "0" || code === "Digit0") && !typing) {
        e.preventDefault(); resetLayout();
      }
    });
    /* چاپ: پنجره‌هایِ مطلق رویِ کاغذ بی‌معنا هستند → موقتاً چیدمانِ مرتب. */
    if (typeof window !== "undefined") {
      let before = null;
      window.addEventListener("beforeprint", () => {
        if (S.mode !== "free") return;
        before = "free"; S.mode = "stacked"; applyAll(); refreshModals();
      });
      window.addEventListener("afterprint", () => {
        if (before !== "free") return;
        before = null; S.mode = "free"; applyAll(); refreshModals();
      });
      let rt = 0;
      window.addEventListener("resize", () => {
        clearTimeout(rt);
        rt = setTimeout(() => {
          if (!booted) return;
          applyAll();
          /* مودالِ باز با تغییرِ اندازه‌ی نمایشگر باید درونِ کادر بماند */
          modals.forEach((r) => { if (r.open && windowed()) applyModalGeom(r.id); });
        }, 180);
      });
    }
  }

  /* ------------------------------------------------------------- راه‌اندازی */
  function init() {
    if (booted) return true;
    if (!document.getElementById("projectEditor")) return false;
    load();
    wins = [];
    REG.forEach((def) => {
      const it = buildWindow(def);
      if (it) wins.push(it);
    });
    if (!wins.length) return false;
    wireMenu();
    wireKeys();
    /* مودال‌ها در همه‌ی صفحه‌ها هستند، نه فقط ویرایشگر — ولی همین ماژول
       مالکِ «پنجره» است، پس این‌جا یک‌بار تزیینشان می‌کنیم. */
    decorateModals();
    /* ویرایشگر با `hidden` باز/بسته می‌شود؛ هر بار که دیده شد چیدمان را
       تازه کن (چون اندازه‌ی بوم در حالتِ hidden صفر است و seed اشتباه می‌شود). */
    const ed = document.getElementById("projectEditor");
    if (window.MutationObserver) {
      const mo = new MutationObserver(() => {
        if (ed.hidden) return;
        wins.forEach((it) => { if (S.wins[it.def.key].x == null) seedDefault(it); });
        applyAll();
      });
      mo.observe(ed, { attributes: true, attributeFilter: ["hidden"] });
    }
    if (!ed.hidden) {
      wins.forEach((it) => { if (S.wins[it.def.key].x == null) seedDefault(it); });
      applyAll();
    }
    booted = true;
    return true;
  }

  /* =======================================================================
     لایه‌ی ۲ب — مودال‌ها هم پنجره‌اند
     -----------------------------------------------------------------------
     همان خواسته‌ی کاربر، برای پنجره‌هایِ گفتگو (ریزِ قیمت‌ها، برش‌نامه،
     مدیریتِ الگو، متریال، سبک، پروژه، قیمت‌گیری سریع، راهنمای کلیدها…).

     سه تفاوتِ مهم با پنل‌های ویرایشگر:

     ۱) **موقعیت فیزیکی است، نه منطقی.** مودال را با `left/top` جابه‌جا
        می‌کنیم نه `inset-inline-start`؛ چون `transform` در دسترس نیست
        (`.modal` انیمیشنِ `modalIn` با `fill-mode:both` دارد که مقدارِ
        `transform:none` را *بر* استایلِ خطی اولویت می‌دهد) و از سوی دیگر
        `left/top` در هر دو جهتِ نوشتاری یک معنا دارند → وارونگیِ RTL
        این‌جا بی‌معناست. به همین دلیل `resizeGeom` را با `rtl:false`
        صدا می‌زنیم.

     ۲) **اندازه‌ی طبیعی = همان چیزی که CSS می‌سازد.** مودال‌ها در
        `.modal-backdrop` با grid مرکز می‌شوند و عرضشان `min(38rem,100%)`
        (یا `.wide`/عرضِ خطیِ خودشان) است. تا وقتی کاربر دست نزده، ما
        هیچ استایلِ خطی نمی‌گذاریم؛ با نخستین کشیدن/تغییرِ اندازه، یک‌بار
        «جای‌گذاری» می‌کنیم: همان مستطیلِ مرکزشده را اندازه می‌گیریم و
        به `position:absolute` با `left/top/width` تبدیل می‌کنیم. یعنی
        **ظاهرِ پیش‌فرض بایت‌به‌بایت همانِ قبل است** و فقط از آن لحظه
        پنجره قابلِ گرفتن می‌شود. عرضِ خطیِ اصلی (`data-win-w0`) نگه
        داشته می‌شود تا «بازنشانی» همان `min(26rem,100%)` را برگرداند.

     ۳) **z را دست نمی‌زنیم.** `syncInert()` در ui-modal.js عمقِ پشته را
        با `z=100+i*2` می‌سازد؛ اگر این‌جا z را عوض می‌کردیم، لایه‌ی
        «تغییراتِ ذخیره‌نشده» می‌توانست *زیرِ* مودالی برود که خودش
        باز کرده است — یعنی بن‌بستِ داده. کلیک روی مودالِ زیرین فقط
        جابه‌جایش می‌کند، نه تقدیمش.
     ======================================================================= */

  const MODAL_MIN_W = 280, MODAL_MIN_H = 140, MODAL_PAD = 8;
  const HINT_KEY = "kabir.win.modalhint";
  let modals = [];                    /* [{id, el, head, open}] */
  let hinted = false;

  function viewportSize() {
    const w = (typeof window !== "undefined" && window.innerWidth) || 1280;
    const h = (typeof window !== "undefined" && window.innerHeight) || 800;
    return { w: Math.max(320, w), h: Math.max(240, h) };
  }
  function windowed() { return !!S && S.mode === "free" && !forceStacked(); }
  function modalEl(id) { return document.getElementById("modal-" + id); }
  function mst(id) {
    if (!S.modals) S.modals = {};
    return S.modals[id] || (S.modals[id] = { x: null, y: null, w: null, h: null });
  }
  function findModal(el) {
    if (!el || !el.closest) return null;
    const m = el.closest(".modal");
    if (!m) return null;
    for (const r of modals) if (r.el === m) return r;
    return null;
  }

  /** نوشتنِ هندسه‌ی دستی روی مودال (با مهار به درونِ نمایشگر). */
  function applyModalGeom(id) {
    const el = modalEl(id);
    if (!el) return null;
    const st = mst(id);
    const v = viewportSize();
    const g = clampWin({ x: st.x, y: st.y, w: st.w, h: st.h }, v.w, v.h,
      { pad: MODAL_PAD, keep: 48, minW: MODAL_MIN_W, minH: MODAL_MIN_H });
    st.x = g.x; st.y = g.y; st.w = g.w; st.h = g.h;
    const s = el.style;
    s.left = rd(g.x) + "px";
    s.top = rd(g.y) + "px";
    s.right = "auto";
    s.width = rd(g.w) + "px";
    s.height = g.h == null ? "auto" : rd(g.h) + "px";
    /* اگر ارتفاعِ دستی داده‌ایم، `max-height` دیگر نباید رویش سقف بگذارد */
    s.maxHeight = g.h == null ? "" : "none";
    el.classList.add("win-modal");
    return g;
  }

  /**
   * برداشتنِ هندسه‌ی دستی → مودال دقیقاً مثلِ روزِ اول مرکز می‌نشیند.
   *
   * ★ ترفند: استایلِ اصلی را با `setAttribute("style", …)` برمی‌گردانیم، نه با
   *   `el.style.width = …`. دلیلش یک دامِ واقعی است: بعضی پارسرهای CSS
   *   (cssstyle که jsdom به‌کار می‌برد) مقدارهای نوین مثلِ `min(34rem,100%)`
   *   را *بی‌صدا رد می‌کنند*؛ یعنی `style.width = "min(34rem,100%)"` در jsdom
   *   هیچ اثری ندارد و عرضِ دستیِ قبلی سرِ جایش می‌ماند. نوشتنِ صفت، متن را
   *   بایت‌به‌بایت نگه می‌دارد — در مرورگر هم که هر دو راه درست است.
   *   `z-index` را دوباره می‌گذاریم چون کارِ `syncInert()` در ui-modal.js است
   *   (عمقِ پشته‌ی مودال‌ها) و ما نباید پاکش کنیم — ولی *متنی* می‌گذاریم، نه
   *   با `el.style.zIndex = …`: هر نوشتن روی CSSOM در jsdom کلِ صفتِ style را
   *   از نو سریال می‌کند و همان مقدارهای ناشناخته (min()) را می‌اندازد.
   */
  function unplaceModal(id) {
    const el = modalEl(id);
    if (!el) return;
    const z = el.style.zIndex || "";
    const orig = el.getAttribute("data-win-style0") || "";
    const s = z ? spliceZIndex(orig, z) : orig;
    if (s) el.setAttribute("style", s);
    else el.removeAttribute("style");
    el.classList.remove("win-modal");
  }

  /** زدنِ z-index در متنِ صفتِ style، بی‌آنکه بقیه‌ی اعلان‌ها دست بخورند. */
  function spliceZIndex(styleAttr, z) {
    const s = String(styleAttr || "").trim();
    const rx = /(^|;)\s*z-index\s*:[^;]*/i;
    if (rx.test(s)) return s.replace(rx, "$1 z-index:" + z).replace(/^\s+/, "").replace(/\s{2,}/g, " ");
    return s ? s.replace(/;\s*$/, "") + ";z-index:" + z : "z-index:" + z;
  }

  /**
   * جای‌گذاریِ مودال: اگر هندسه‌ی ذخیره‌شده دارد همان را بگذار، وگرنه یک‌بار
   * مستطیلِ مرکزشده‌ی طبیعی‌اش را اندازه بگیر و ثبت کن.
   */
  function placeModal(id, opt) {
    const el = modalEl(id);
    if (!el) return null;
    if (!windowed()) { unplaceModal(id); return null; }
    const st = mst(id);
    const v = viewportSize();
    const hasGeom = st.x != null && st.w != null && !(opt && opt.remeasure);
    unplaceModal(id);                        /* یک فریمِ «طبیعی» برایِ اندازه‌گیری */
    if (!hasGeom) {
      const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      if (r && r.width > 4) {
        st.x = Math.round(r.left); st.y = Math.round(r.top);
        st.w = Math.round(r.width);
        if (!(opt && opt.keepH)) st.h = null;   /* ارتفاع: خودکار تا محتوا جا داشته باشد */
      } else {
        /* jsdom چیدمان ندارد (rect صفر) → جایگزینِ عددیِ مرکزی */
        const w = Math.min(680, v.w - 2 * MODAL_PAD);
        st.x = Math.round((v.w - w) / 2);
        st.y = Math.round(Math.max(MODAL_PAD, v.h * 0.1));
        st.w = w; st.h = null;
      }
    }
    return applyModalGeom(id);
  }

  function resetModal(id, quiet) {
    const st = mst(id);
    st.x = null; st.y = null; st.w = null; st.h = null;
    const rec = findModal(modalEl(id));
    if (rec && rec.open) placeModal(id, { remeasure: true });
    else unplaceModal(id);
    if (!quiet) host().toast("اندازه و جای این پنجره به <b>حالتِ پیش‌فرض</b> برگشت (دوبار کلیک روی نوارِ عنوان).", "success");
  }

  function resetAllModals(quiet) {
    if (!S.modals) return 0;
    const k = Object.keys(S.modals).length;
    S.modals = {};
    modals.forEach((r) => { if (r.open) placeModal(r.id, { remeasure: true }); else unplaceModal(r.id); });
    persist();
    if (!quiet && k) host().toast("چیدمانِ " + k + " پنجره‌ی گفتگو به پیش‌فرض برگشت.", "success");
    return k;
  }

  function refreshModals() {
    modals.forEach((r) => {
      if (!windowed()) { unplaceModal(r.id); return; }
      if (r.open) {
        const st = S.modals && S.modals[r.id];
        if (st && st.x != null && st.w != null) applyModalGeom(r.id);
        else placeModal(r.id, { remeasure: true });
      } else unplaceModal(r.id);
    });
  }

  /** ارتفاعِ مبنای تغییرِ اندازه وقتی ارتفاع «خودکار» است. */
  function modalBaseH(el, st) {
    if (st.h != null) return st.h;
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (r && r.height > 4) return Math.round(r.height);
    return 240;                                  /* جایگزینِ jsdom */
  }

  function hintOnce() {
    if (hinted) return;
    let seen = false;
    try { seen = localStorage.getItem(HINT_KEY) === "1"; } catch (e) { seen = true; }
    hinted = true;
    try { localStorage.setItem(HINT_KEY, "1"); } catch (e) {}
    if (!seen) {
      host().toast("این پنجره را با نوارِ عنوانش جابه‌جا کن و از لبه‌هایش اندازه‌اش را عوض کن — <b>دوبار کلیک</b> روی نوارِ عنوان = بازگشت به پیش‌فرض.", "info");
    }
  }

  function modalDragify(rec) {
    const start = (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      if (!windowed()) return;
      if (isInteractive(ev.target)) return;
      ev.preventDefault();
      const st = mst(rec.id);
      if (st.x == null || st.w == null) placeModal(rec.id);
      hintOnce();
      const base = { x: n(st.x, 0), y: n(st.y, 0) };
      const sx = ev.clientX, sy = ev.clientY;
      rec.el.classList.add("dragging");
      document.body.classList.add("win-dragging");
      if (rec.el.setPointerCapture && ev.pointerId != null) {
        try { rec.el.setPointerCapture(ev.pointerId); } catch (e) {}
      }
      const move = (e2) => {
        /* left/top فیزیکی‌اند ⇒ بدونِ وارونگیِ RTL */
        st.x = base.x + (e2.clientX - sx);
        st.y = base.y + (e2.clientY - sy);
        applyModalGeom(rec.id);
      };
      const up = () => {
        document.removeEventListener(EV_MOVE, move, true);
        document.removeEventListener(EV_UP, up, true);
        rec.el.classList.remove("dragging");
        document.body.classList.remove("win-dragging");
        persist();
      };
      document.addEventListener(EV_MOVE, move, true);
      document.addEventListener(EV_UP, up, true);
    };
    rec.head.addEventListener(EV_DOWN, start);
    if (HAS_POINTER) rec.head.style.touchAction = "none";
    rec.head.addEventListener("dblclick", (ev) => {
      if (isInteractive(ev.target) || !windowed()) return;
      ev.preventDefault();
      resetModal(rec.id);
      persist();
    });
  }

  function modalResizeify(rec) {
    EDGES.forEach((edge) => {
      const h = mk("span", "win-rz win-rz-" + edge);
      h.setAttribute("data-edge", edge);
      h.setAttribute("aria-hidden", "true");
      if (HAS_POINTER) h.style.touchAction = "none";
      rec.el.appendChild(h);
      h.addEventListener(EV_DOWN, (ev) => {
        if (ev.button !== undefined && ev.button !== 0) return;
        if (!windowed()) return;
        ev.preventDefault(); ev.stopPropagation();
        const st = mst(rec.id);
        if (st.x == null || st.w == null) placeModal(rec.id);
        hintOnce();
        const v = viewportSize();
        const base = {
          x: n(st.x, 0), y: n(st.y, 0), w: n(st.w, MODAL_MIN_W),
          h: modalBaseH(rec.el, st),
        };
        const sx = ev.clientX, sy = ev.clientY;
        rec.el.classList.add("resizing");
        document.body.classList.add("win-dragging");
        const move = (e2) => {
          const v2 = viewportSize();
          const ng = resizeGeom(base, edge, e2.clientX - sx, e2.clientY - sy, {
            /* مودال با left/top فیزیکی است ⇒ rtl:false */
            rtl: false, minW: MODAL_MIN_W, minH: MODAL_MIN_H,
            maxW: v2.w - MODAL_PAD * 2, maxH: v2.h - MODAL_PAD * 2,
          });
          st.x = ng.x; st.y = ng.y; st.w = ng.w; st.h = ng.h;
          applyModalGeom(rec.id);
        };
        const up = () => {
          document.removeEventListener(EV_MOVE, move, true);
          document.removeEventListener(EV_UP, up, true);
          rec.el.classList.remove("resizing");
          document.body.classList.remove("win-dragging");
          persist();
        };
        document.addEventListener(EV_MOVE, move, true);
        document.addEventListener(EV_UP, up, true);
      });
    });
  }

  function decorateModals() {
    /* سند-محور (نه فقط داخلِ #modalBackdrop): با syncInert در ui-modal.js
       هم‌داستان است تا مودالی که بیرونِ پس‌زمینه نشست هم پنجره شود.
       به همین دلیل CSS این پنجره‌ها position:fixed است، نه absolute —
       تا مبنا در هر دو حالت یکسان (نمایشگر) بماند. */
    const list = Array.from(document.querySelectorAll(".modal")).filter((m) => !!m.id);
    if (!list.length) return 0;
    list.forEach((el) => {
      if (el.classList.contains("win-modal-deco")) return;
      const id = (el.id || "").replace(/^modal-/, "");
      if (!id) return;
      const head = el.querySelector(".modal-head");
      el.classList.add("win-modal-deco");
      /* عرضِ خطیِ اصلی را از *صفتِ* style می‌خوانیم نه از el.style.width:
         مقدارهایی مثل min(34rem,100%) را بعضی پارسرهای CSS (cssstyle در
         jsdom) تجزیه نمی‌کنند و style.width خالی برمی‌گردد، یعنی «بازنشانی»
         عرضِ اصلیِ مودال را گم می‌کرد. */
      const styleAttr = el.getAttribute("style") || "";
      el.setAttribute("data-win-style0", styleAttr);      /* برایِ بازنشانیِ بایت‌به‌بایت */
      const rawW = /(?:^|;)\s*width\s*:\s*([^;]+)/i.exec(styleAttr);
      el.setAttribute("data-win-w0", rawW ? rawW[1].trim() : "");
      const rec = { id: id, el: el, head: head || null, open: el.classList.contains("open") };
      modals.push(rec);
      if (head) {
        head.classList.add("win-drag");
        modalDragify(rec);
      }
      modalResizeify(rec);
      /* باز/بسته‌شدنِ مودال با کلاسِ `.open` است (نه `hidden`) — پس همان را
         می‌پاییم. تغییرِ کلاسِ `win-modal` که کارِ خودمان است، `.open` را
         عوض نمی‌کند، پس حلقه‌ی بی‌پایان نمی‌سازد. */
      if (window.MutationObserver) {
        const mo = new MutationObserver(() => {
          const open = el.classList.contains("open");
          if (open === rec.open) return;
          rec.open = open;
          if (open) placeModal(rec.id);
          else unplaceModal(rec.id);
        });
        mo.observe(el, { attributes: true, attributeFilter: ["class"] });
      }
    });
    return modals.length;
  }
  /* ------------------------------------------------------------- صادرات */
  const api = {
    /* لایه‌ی خالص — برای آزمون */
    logicalRect, physOf, resizeGeom, clampWin, defaultLayout, isRTL,
    REG, EDGES, STORE_KEY, SCHEMA,
    /* لایه‌ی DOM */
    init, sanitize,
    inject(h) { hooks = Object.assign({}, hooks, h); },
    getState() { return S; },
    getMode() { return S ? S.mode : null; },
    windows() { return wins.slice(); },
    setMode, resetLayout, restoreAll,
    persist, load,
    /* لایه‌ی مودال‌ها */
    decorateModals, placeModal, unplaceModal, resetModal, resetAllModals,
    applyModalGeom, refreshModals,
    modalState: mst, modalList: () => modals.map((r) => r.id),
  };

  if (typeof window !== "undefined") window.KabirWindows = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  /* راه‌اندازیِ خودکار در مرورگر. در node (آزمونِ هندسه) document وجود ندارد
     → `typeof` تنها شکلِ امنِ این پرسش است. */
  if (typeof document !== "undefined" && document) {
    const boot = () => { try { init(); } catch (e) { /* رابط بدونِ پنجره‌ای‌سازی هم کار می‌کند */ } };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})();
