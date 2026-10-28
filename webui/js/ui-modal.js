/* ==========================================================================
   کبیر — ui-modal.js
   --------------------------------------------------------------------------
   لایه‌ی مشترک «مودال و فرم» برای کل نرم‌افزار.

   این فایل پاسخ مستقیم به سه قانون مطلق توسعه است:

   ۱) جلوگیری از از دست رفتن داده (Data Loss)
      — هیچ مودالی با کلیکِ بیرون، Esc یا «انصراف» بسته نمی‌شود مگر اینکه
        «تمیز» باشد (هیچ فیلدی نسبت به لحظه‌ی بازشدن تغییر نکرده باشد).
      — اگر کثیف باشد، لایه‌ی «تغییرات ذخیره‌نشده» با سه کنش باز می‌شود:
        ذخیره و بستن / ادامه‌ی ویرایش / دور ریختن (دور ریختن دور و کوچک).

   ۲) کیبورد نخست
      — Enter یا Ctrl+Enter = ثبتِ فرمِ باز (بدونِ نیاز به موس).
      — Ctrl+S = ثبتِ زمینه‌ی فعال (مودالِ باز، وگرنه صفحه).
      — Esc = فقط بالاترین لایه، و فقط با رعایتِ شرطِ ۱.
      — Tab همیشه داخل بالاترین مودال می‌چرخد (تله‌ی فوکوسِ واقعی: مودال‌های
        بسته «inert» می‌شوند تا فوکوس هرگز به DOMِ نامرئی فرار نکند).

   ۳) ثبات رویه + پشته‌ی مودال
      — مودال‌ها در یک پشته (MODALS.stack) نگه داشته می‌شوند؛ بازکردنِ یک
        مودال از داخل مودال دیگر (مثلاً «تأیید حذف الگو» از داخل «لیست
        الگوها») دیگر کل لایه را فرو نمی‌ریزد: هر کنشِ خروج فقط یک لایه
        را برمی‌دارد.
      — جای کنش‌ها در همه‌ی مودال‌ها یکسان می‌ماند: کنشِ اصلی راست،
        «انصراف» چپ، کنشِ خطرناک جدا و در دورترین نقطه.

   این فایل هیچ DOM‑رندری نمی‌سازد؛ فقط «لایه‌ی کنترل» است تا با ui.js
   (رندرها و سیم‌کشی) و data.js (ابزارها) جدا بماند و قابل تست باشد.
   ========================================================================== */
"use strict";

/* ------------------------------------------------------------------ توست */
const TOAST_LIFE = 3600;

function toast(msg, type, action) {
  type = type || "info";
  const ic = type === "success" ? ICONS.check : type === "error" ? ICONS.x : type === "warn" ? ICONS.warn : ICONS.info;
  const box = el("toasts");
  if (!box) return;
  /* حداکثر ۴ توست هم‌زمان — قدیمی‌ترین حذف می‌شود */
  while (box.children.length >= 4) box.firstElementChild.remove();
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.setAttribute("role", type === "error" ? "alert" : "status");
  /* ★ اکشنِ اختیاری (مثل «بازگردانی» بعد از حذف ردیف) — یک کلیکِ نجات‌بخش
     به‌جای حسرتِ «ای کاش حذف نکرده بودم».                                       */
  const actHtml = action && action.label
    ? `<button class="t-action" type="button">${esc(action.label)}</button>` : "";
  t.innerHTML = `<span class="t-ic">${ic}</span><span>${msg}</span>` + actHtml +
    `<button class="t-close" type="button" aria-label="بستن پیام">${ICONS.x}</button>` +
    `<span class="t-bar" aria-hidden="true"></span>`;
  const kill = () => {
    if (!t.isConnected) return;
    t.classList.add("out");
    setTimeout(() => t.remove(), 260);
  };
  if (action && action.label) {
    t.querySelector(".t-action").addEventListener("click", () => {
      kill();
      if (action.cb) action.cb();
    });
  }
  t.querySelector(".t-close").addEventListener("click", kill);
  box.appendChild(t);
  setTimeout(kill, action && action.label ? Math.max(TOAST_LIFE, 7000) : TOAST_LIFE);
}

/* اجرای یک کار ناهمزمان با نمایش اسپینر روی دکمه (حالت تجاری) */
async function busy(btn, fn, opts) {
  opts = opts || {};
  if (!btn) return fn();
  btn.classList.add("busy");
  btn.disabled = true;
  const old = btn.getAttribute("aria-busy");
  btn.setAttribute("aria-busy", "true");
  try {
    return await fn();
  } finally {
    btn.classList.remove("busy");
    btn.disabled = false;
    if (old === null) btn.removeAttribute("aria-busy");
    else btn.setAttribute("aria-busy", old);
    if (opts.doneMsg) toast(opts.doneMsg, "success");
  }
}

/* ==========================================================================
   پشته‌ی مودال‌ها
   ========================================================================== */
const MODALS = {
  stack: [],            /* [{ id, focus, snapshot, saveBtn, savedDirty }] */
  backdrop: null,
  confirmCb: null,
  confirmDismiss: null,
  confirmAlt: null,
  registry: {},         /* per-modal: { label, save, saveBtn, alwaysDirty, dirty } */
};

const MODAL_GUARD_ID = "unsaved";   /* خودِ لایه‌ی هشدار هرگز guard نمی‌خواهد */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type=hidden])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(",");

function modalBackdrop() {
  if (!MODALS.backdrop) MODALS.backdrop = el("modalBackdrop");
  return MODALS.backdrop;
}
function modalNode(id) { return el("modal-" + id); }
function topFrame() { return MODALS.stack.length ? MODALS.stack[MODALS.stack.length - 1] : null; }
function topModalId() { const f = topFrame(); return f ? f.id : null; }
function isModalOpen(id) { return MODALS.stack.some((f) => f.id === id); }
function anyModalOpen() { return MODALS.stack.length > 0; }

/* ------------------------------------------------------------------ ثبتِ پیکربندی مودال
   ui.js هنگام راه‌اندازی برای هر مودالِ دارای فرم یک «شناسنامه» ثبت می‌کند:
     label      → نامی که در هشدارِ «تغییرات ذخیره‌نشده» نشان داده می‌شود
     save       → تابعِ ثبت (async)؛ اگر `false` برگرداند مودال باز می‌ماند
     saveBtn    → id دکمه‌ی اصلی (برای اسپینر و بزرگ‌نماییِ فیتز)
     alwaysDirty→ مودالی که محتوایش با فرمِ ثابت سنجیده نمی‌شود (مثل برش‌نامه)
   ------------------------------------------------------------------------ */
function registerModal(id, cfg) { MODALS.registry[id] = Object.assign({}, MODALS.registry[id], cfg); }
function modalCfg(id) { return MODALS.registry[id] || {}; }

/* ==========================================================================
   تشخیص کثیفی فرم (Dirty State Check)
   --------------------------------------------------------------------------
   در لحظه‌ی بازشدن، «اثر انگشت» همه‌ی کنترل‌های فرم گرفته می‌شود (value /
   checked / selected + ترتیب گزینه‌ها). هر کنترل بدونِ id هم با مسیرِ DOM
   شناسایی می‌شود تا ردیف‌های پویا (مثل جدولِ الگوها) از قلم نیفتند.
   مقایسه با اثر انگشت = دقیق، ارزان و بدونِ نیاز به نگهداریِ مدلِ دوم.
   ========================================================================== */
function formControls(root) {
  return Array.from(root.querySelectorAll("input, select, textarea"))
    .filter((n) => n.type !== "hidden" && !n.closest("[data-no-dirty]"));
}

function controlKey(n, i) {
  if (n.id) return "#" + n.id;
  if (n.name) return "@" + n.name + ":" + i;
  return "$" + i;
}

function fingerprint(root) {
  const fp = {};
  formControls(root).forEach((n, i) => {
    const k = controlKey(n, i);
    if (n.type === "checkbox" || n.type === "radio") fp[k] = n.checked ? "1" : "0";
    else if (n.tagName === "SELECT") {
      /* ترتیب و تعداد گزینه‌ها هم مقایسه می‌شود: پرشدنِ یک select با داده‌ی
         تازه، خودش یک «تغییر» است که نباید بی‌خبر بسته شود. */
      fp[k] = n.value + "|" + Array.from(n.options).map((o) => o.value).join(",");
    } else fp[k] = String(n.value);
  });
  return fp;
}

function equalFingerprint(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

/** تعداد کنترل‌های تغییریافته — برای نمایشِ «۳ فیلد پر کرده‌اید» در هشدار */
function countDiff(a, b) {
  let n = 0;
  const keys = new Set(Object.keys(a).concat(Object.keys(b)));
  for (const k of keys) if (a[k] !== b[k]) n += 1;
  return n;
}

function isModalDirty(id) {
  const frame = MODALS.stack.find((f) => f.id === id);
  const cfg = modalCfg(id);
  if (!frame) return !!cfg.dirty;
  if (cfg.alwaysDirty) return !!cfg.dirty;
  const node = modalNode(id);
  if (!node || !frame.snapshot) return false;
  return !equalFingerprint(frame.snapshot, fingerprint(node));
}

function markModalDirty(id, on) {
  const cfg = MODALS.registry[id] || (MODALS.registry[id] = {});
  cfg.dirty = on === undefined ? true : !!on;
  const frame = MODALS.stack.find((f) => f.id === id);
  if (frame) frame.savedDirty = cfg.dirty;
  paintDirtyState();
}

function anyModalDirty() { return MODALS.stack.some((f) => isModalDirty(f.id)); }

/* نشانِ بصریِ «پر شده» روی خودِ مودال — کاربر می‌داند که خروج بی‌هشدار نیست */
function paintDirtyState() {
  const back = modalBackdrop();
  if (!back) return;
  const top = topModalId();
  const dirty = top ? isModalDirty(top) : false;
  back.classList.toggle("has-dirty", dirty);
  MODALS.stack.forEach((f) => {
    const n = modalNode(f.id);
    if (n) n.classList.toggle("is-dirty", isModalDirty(f.id));
  });
}

/* ==========================================================================
   باز و بسته کردن
   ========================================================================== */

/** مودال‌هایی که در پشته نیستند از دسترسِ Tab و صفحه‌خوان بیرون می‌روند.
 *  بدون این، فوکوس با Tab به DOMِ نامرئی فرار می‌کرد (باگِ واقعیِ نسخه‌ی قبل). */
function syncInert() {
  const back = modalBackdrop();
  if (!back) return;
  Array.from(back.querySelectorAll(".modal")).forEach((m) => {
    const id = m.id.replace(/^modal-/, "");
    const inStack = MODALS.stack.some((f) => f.id === id);
    m.classList.toggle("open", inStack);
    if (inStack) { m.removeAttribute("aria-hidden"); m.removeAttribute("inert"); }
    else { m.setAttribute("aria-hidden", "true"); if ("inert" in m) m.inert = true; else m.setAttribute("inert", ""); }
  });
  back.hidden = MODALS.stack.length === 0;
  if (MODALS.stack.length === 0) back.removeAttribute("aria-hidden");
  else back.setAttribute("aria-hidden", "false");
  /* عمقِ لایه‌ها: مودالِ بالایی سایه‌ی بیشتری می‌گیرد تا سلسله‌مراتب دیده شود */
  MODALS.stack.forEach((f, i) => {
    const n = modalNode(f.id);
    if (!n) return;
    n.style.zIndex = String(100 + i * 2);
    /* لایه‌های زیرین کمی کم‌رنگ‌تر — کاربر می‌فهمد کجای پشته است */
    n.classList.toggle("beneath", i < MODALS.stack.length - 1);
  });
}

function lockScroll(on) {
  document.body.classList.toggle("modal-open", !!on);
  document.body.style.overflow = on ? "hidden" : "";
}

function focusablesOf(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE))
    .filter((n) => !n.disabled && n.offsetParent !== null && n.tabIndex !== -1);
}

function focusFirst(node) {
  const auto = node.querySelector("[data-autofocus]");
  const target = auto || node.querySelector('input:not([type=hidden]):not([readonly]), textarea, select') ||
    node.querySelector("button:not([data-close])") || node.querySelector("button");
  if (target) { try { target.focus(); if (target.select && target.type === "text") target.select(); } catch (e) { /* noop */ } }
  else { node.setAttribute("tabindex", "-1"); try { node.focus(); } catch (e) { /* noop */ } }
}

/**
 * بازکردنِ یک مودال — همیشه روی پشته سوار می‌شود (نه جایگزینِ کل لایه).
 * @param {string} id        شناسه بدونِ پیشوند (مثلاً "material")
 * @param {object} [opts]    { dirty: boolean, focus: Element }
 */
function openModal(id, opts) {
  opts = opts || {};
  const node = modalNode(id);
  if (!node) { console.warn("[modal] ناشناخته:", id); return false; }
  const back = modalBackdrop();
  if (!back) return false;

  /* اگر همین مودال از قبل باز است، فقط بالای پشته می‌آید (جلوگیری از تکرار) */
  const existing = MODALS.stack.findIndex((f) => f.id === id);
  if (existing >= 0) {
    const fr = MODALS.stack.splice(existing, 1)[0];
    MODALS.stack.push(fr);
  } else {
    MODALS.stack.push({
      id,
      focus: opts.focus || document.activeElement,
      snapshot: id === MODAL_GUARD_ID ? null : fingerprint(node),
      savedDirty: false,
    });
  }

  if (id !== MODAL_GUARD_ID) markModalDirty(id, !!opts.dirty);
  syncInert();
  lockScroll(true);
  back.classList.add("stacked-" + Math.min(3, MODALS.stack.length));
  /* فوکوس پس از یک فریم تا انیمیشنِ باز شدن پرش نداشته باشد */
  setTimeout(() => { if (topModalId() === id) focusFirst(node); }, 50);
  return true;
}

/**
 * بستنِ «بدونِ پرسش» — فقط برای مسیرهای کد که خودشان تکلیفِ داده را روشن
 * کرده‌اند (ثبتِ موفق، یا لایه‌ی «دور ریختن»). کنش‌های کاربر باید
 * requestCloseModal() را صدا بزنند.
 */
function closeModal(id) {
  if (!MODALS.stack.length) { syncInert(); lockScroll(false); return false; }
  let idx = id ? MODALS.stack.findIndex((f) => f.id === id) : MODALS.stack.length - 1;
  if (idx < 0) return false;
  const frame = MODALS.stack.splice(idx, 1)[0];
  const cfg = MODALS.registry[frame.id] || {};
  if (cfg.onClose) { try { cfg.onClose(false); } catch (e) { /* noop */ } }

  if (!MODALS.stack.length) {
    lockScroll(false);
    const back = modalBackdrop();
    if (back) back.className = "modal-backdrop";
    /* فوکوس به همان‌جا که کاربر بود برمی‌گردد — حافظه‌ی عضلانی و Tabِ پیوسته */
    const f = frame.focus;
    if (f && f.isConnected && f.focus) { try { f.focus(); } catch (e) { /* noop */ } }
  } else {
    const top = topFrame();
    const n = modalNode(top.id);
    if (n) setTimeout(() => focusFirst(n), 30);
  }
  syncInert();
  paintDirtyState();
  return true;
}

/** بستنِ همه‌ی لایه‌ها (خروج از برنامه‌ی کاری، ناوبریِ صفحه) */
function closeAllModals() {
  while (MODALS.stack.length) closeModal();
}

/**
 * بسته‌شدن به‌دستِ کاربر (✕ / «انصراف» / Esc / کلیکِ بیرون).
 * اگر فرم کثیف باشد، لایه‌ی «تغییرات ذخیره‌نشده» باز می‌شود.
 * @returns {Promise<boolean>} آیا واقعاً بسته شد؟
 */
async function requestCloseModal(id) {
  const target = id || topModalId();
  if (!target) return false;
  if (target !== MODAL_GUARD_ID && isModalDirty(target)) {
    const act = await askUnsaved(target);
    if (act === "stay") return false;
    if (act === "save") {
      const ok = await submitModal(target);
      return ok;                     /* ثبت ناموفق = مودال باز می‌ماند */
    }
    /* "discard" */
    closeModal(target);
    toast("تغییرات ذخیره‌نشده دور ریخته شد", "warn");
    return true;
  }
  const cfg = modalCfg(target);
  if (cfg.onClose) { try { cfg.onClose(true); } catch (e) { /* noop */ } }
  return closeModal(target);
}

/* ==========================================================================
   ثبتِ فرم (Submit)
   — Enter / Ctrl+Enter / Ctrl+S / کلیک روی کنشِ اصلی همه از همین‌جا می‌روند
     تا «یک راه برای ثبت» وجود داشته باشد (ثباتِ رویه).
   ========================================================================== */
async function submitModal(id) {
  const target = id || topModalId();
  if (!target) return false;
  const cfg = modalCfg(target);
  if (!cfg.save) {
    /* مودالِ بدونِ فرم (برش‌نامه، ریز قیمت‌ها، تأیید) → همان بستن */
    return requestCloseModal(target);
  }
  const btn = cfg.saveBtn ? el(cfg.saveBtn) : null;
  if (btn && btn.classList.contains("busy")) return false;   /* جلوگیری از ثبتِ دوباره */
  let ok = false;
  try {
    ok = await busy(btn || null, () => cfg.save());
  } catch (e) {
    toast("خطا در ثبت: " + esc(e && e.message ? e.message : String(e)), "error");
    return false;
  }
  /* قرارداد: `false` یعنی «نگه دار» (اعتبارسنجی رد شد). `undefined` یعنی موفق. */
  if (ok === false) return false;
  markModalDirty(target, false);
  closeModal(target);
  return true;
}

/* ==========================================================================
   لایه‌ی «تغییرات ذخیره‌نشده دارید»
   --------------------------------------------------------------------------
   سه کنش، با جای ثابت در همه‌ی فرم‌های نرم‌افزار:
     راست (در دسترس‌ترین نقطه در RTL): «ادامه‌ی ویرایش» = امن‌ترین کنش
     وسط: «ذخیره و بستن» = فقط وقتی فرم ثبت‌شدنی داشته باشد
     چپِ دور، کوچک و کم‌رنگ: «دور ریختن تغییرات» = خطرناک، عمداً پرت
   ========================================================================== */
let _unsavedResolve = null;

function askUnsaved(id) {
  return new Promise((resolve) => {
    const cfg = modalCfg(id);
    const node = modalNode(MODAL_GUARD_ID);
    if (!node) { resolve("stay"); return; }
    if (_unsavedResolve) _unsavedResolve("stay");

    const frame = MODALS.stack.find((f) => f.id === id);
    const n = frame && frame.snapshot ? countDiff(frame.snapshot, fingerprint(modalNode(id))) : 0;
    const label = cfg.label || "این فرم";

    el("unsavedTitle").textContent = "تغییرات ذخیره‌نشده دارید";
    el("unsavedText").innerHTML =
      `«<b>${esc(label)}</b>» بسته نشده است` +
      (n ? ` — <b>${fa(n)}</b> فیلد تغییر کرده.` : ".") +
      ` اگر ببندید، این اطلاعات از بین می‌رود.`;

    const saveBtn = el("btnUnsavedSave");
    saveBtn.hidden = !cfg.save;
    saveBtn.textContent = cfg.saveLabel || "ذخیره و بستن";

    MODALS.confirmCb = null;
    _unsavedResolve = resolve;
    openModal(MODAL_GUARD_ID, { dirty: false });
  });
}

function resolveUnsaved(action) {
  const r = _unsavedResolve;
  _unsavedResolve = null;
  closeModal(MODAL_GUARD_ID);
  if (r) r(action);
}

/**
 * پرسشِ تأییدِ عمومی که Promise برمی‌گرداند (برای گاردهای ناوبری).
 * @param {object} [opts] { title, okLabel, okTone, cancelLabel, altLabel, altTone, onAlt }
 *        `altLabel` یک کنشِ سومِ امن‌تر اضافه می‌کند (مثلاً «ذخیره و رفتن»).
 */
function confirmDiscard(message, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    confirmAction(message, () => done(true), {
      title: opts.title || "تغییرات ذخیره‌نشده",
      okLabel: opts.okLabel || "دور ریختن",
      okTone: opts.okTone || "danger",
      cancelLabel: opts.cancelLabel || "ماندن و ادامه‌ی ویرایش",
      onDismiss: () => done(false),
      altLabel: opts.altLabel || null,
      altTone: opts.altTone || "success",
      onAlt: opts.onAlt ? () => { done(false); opts.onAlt(); } : null,
    });
  });
}

/* ==========================================================================
   مودالِ تأیید (confirm)
   — حالا Promise‑محور است و «رد کردن» هم یک نتیجه‌ی صریح دارد، پس دیگر
     state.confirmCb معلق نمی‌ماند.
   ========================================================================== */
function confirmAction(text, cb, opts) {
  opts = opts || {};
  if (typeof opts === "string") opts = { title: opts, okLabel: arguments[3] };  /* سازگاری با امضای قدیمی */
  const node = modalNode("confirm");
  el("confirmText").innerHTML = text;
  el("confirmTitle").textContent = opts.title || "تأیید عملیات";
  const ok = el("btnConfirmOk");
  ok.textContent = opts.okLabel || "تأیید";
  /* لحنِ دکمه: danger (پیش‌فرض) / neutral / success — تا «قرمز» همیشه معنیِ
     خطر بدهد و کاربر شرطی نشود که قرمز = ادامه (یافته‌ی S‑1 ممیزی).        */
  const tone = opts.okTone || (opts.tone === "neutral" ? "primary" : "danger");
  ok.className = "btn " + tone + " btn-lg";
  ok.setAttribute("data-autofocus", "");
  const cancel = el("btnConfirmCancel");
  if (cancel) cancel.textContent = opts.cancelLabel || "انصراف";
  /* کنشِ سومِ اختیاری (مثلاً «ذخیره و رفتن») — امن‌تر از کنشِ خطرناک،
     پس کنارِ آن و هم‌اندازه‌ی آن قرار می‌گیرد تا انتخابِ درست آسان باشد.      */
  const alt = el("btnConfirmAlt");
  if (alt) {
    alt.hidden = !opts.altLabel;
    if (opts.altLabel) {
      alt.textContent = opts.altLabel;
      alt.className = "btn " + (opts.altTone || "success") + " btn-lg";
    }
    MODALS.confirmAlt = opts.onAlt || null;
  }
  MODALS.confirmCb = cb || null;
  MODALS.confirmDismiss = opts.onDismiss || null;
  registerModal("confirm", {
    label: opts.title || "تأیید عملیات",
    onClose: (dismissed) => {
      const d = MODALS.confirmDismiss;
      MODALS.confirmCb = null;
      MODALS.confirmDismiss = null;
      MODALS.confirmAlt = null;
      /* رد کردنِ تأیید (Esc/✕/انصراف) = نتیجه‌ی «نه» — دیگر حالتِ معلق نداریم */
      if (dismissed && d) { try { d(); } catch (e) { /* noop */ } }
    },
  });
  openModal("confirm", { dirty: false });
}

function runConfirmAlt() {
  const alt = MODALS.confirmAlt;
  MODALS.confirmCb = null;
  MODALS.confirmDismiss = null;
  MODALS.confirmAlt = null;
  closeModal("confirm");
  if (alt) { try { alt(); } catch (e) { toast("خطا: " + esc(e.message), "error"); } }
}

function runConfirm() {
  const cb = MODALS.confirmCb;
  MODALS.confirmCb = null;
  MODALS.confirmDismiss = null;
  MODALS.confirmAlt = null;
  closeModal("confirm");
  if (cb) { try { cb(); } catch (e) { toast("خطا: " + esc(e.message), "error"); } }
}

/* ==========================================================================
   تله‌ی فوکوس (Tab) — فقط داخل بالاترین لایه
   ========================================================================== */
function handleTab(e) {
  const top = topFrame();
  if (!top) return;
  const node = modalNode(top.id);
  if (!node) return;
  const items = focusablesOf(node);
  if (!items.length) { e.preventDefault(); return; }
  const first = items[0], last = items[items.length - 1];
  const ae = document.activeElement;
  /* اگر فوکوس بیرونِ مودال است (مثلاً روی body) → به اولِ مودال برگردان */
  if (!node.contains(ae)) { e.preventDefault(); first.focus(); return; }
  if (e.shiftKey && ae === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && ae === last) { e.preventDefault(); first.focus(); }
}

/* ==========================================================================
   صفحه‌کلید: قراردادِ سراسری
   ========================================================================== */
const MODAL_KEYS = {
  /** میان‌برِ ثبت در زمینه‌ی صفحه (وقتی مودالی باز نیست) — ui.js پر می‌کند */
  contextSave: null,
  /** صفحه‌ی جاری — با هر ناوبری به‌روز می‌شود */
  currentPage: null,
  /** درزِ تست/گسترش: تابعِ ذخیره‌ای که گاردها صدا می‌زنند (ui.js جایگزین می‌کند) */
  saveActiveContext: null,
  /** گاردهای خروج: قبل از ناوبری/جایگزینیِ رکورد صدا زده می‌شوند.
   *  هر گارد باید `null` (بدونِ مانع) یا Promise<boolean> (true = برو) برگرداند. */
  exitGuards: [],
};

function registerExitGuard(fn) {
  if (typeof fn === "function" && MODAL_KEYS.exitGuards.indexOf(fn) < 0) MODAL_KEYS.exitGuards.push(fn);
}

/**
 * آیا خروج از زمینه‌ی فعلی مجاز است؟ (داده‌ی ذخیره‌نشده = پرسش از کاربر)
 * @param {{to?:string, from?:string}} [ctx] مقصد و مبدأی که گاردها می‌بینند.
 *        بدونِ مقصد، گارد باید «بدونِ قید» تصمیم بگیرد (مسیرهای غیرِ ناوبری).
 */
async function allowLeave(ctx) {
  ctx = ctx || {};
  for (const g of MODAL_KEYS.exitGuards) {
    let r;
    try { r = await g(ctx); } catch (e) { r = null; }
    if (r === false) return false;
  }
  return true;
}

function isTypingTarget(t) {
  if (!t || !t.tagName) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

/**
 * تنها هندلرِ سراسریِ Escape/Enter/Ctrl+S برای لایه‌ی مودال.
 * ui.js این را از هندلرِ کلیدیِ خودش صدا می‌زند.
 * @returns {boolean} اگر رویداد مصرف شد (دیگر نباید به چیز دیگری برسد)
 */
function handleModalKeys(e) {
  const key = e.key;
  const top = topModalId();

  /* --- Ctrl+S: ثبتِ زمینه‌ی فعال (مودالِ باز، وگرنه صفحه) --- */
  if ((e.ctrlKey || e.metaKey) && String(key).toLowerCase() === "s") {
    if (top) {
      e.preventDefault();
      if (top !== MODAL_GUARD_ID) submitModal(top);
      return true;
    }
    if (MODAL_KEYS.contextSave) { e.preventDefault(); MODAL_KEYS.contextSave(); return true; }
    return false;
  }

  if (!top) return false;

  /* --- Ctrl+Enter همیشه ثبت می‌کند --- */
  if ((e.ctrlKey || e.metaKey) && key === "Enter") {
    e.preventDefault();
    if (top === MODAL_GUARD_ID) resolveUnsaved("save");
    else if (top === "confirm") runConfirm();
    else submitModal(top);
    return true;
  }

  /* --- Enter: ثبتِ فرم (در textarea و روی دکمه نه) --- */
  if (key === "Enter" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    const t = e.target;
    if (t && t.tagName === "TEXTAREA") return false;
    if (t && t.tagName === "BUTTON") return false;         /* کلیکِ خودش انجام می‌شود */
    if (t && t.type === "file") return false;
    const cfg = modalCfg(top);
    if (!cfg.save && top !== MODAL_GUARD_ID && top !== "confirm") return false;
    e.preventDefault();
    if (top === MODAL_GUARD_ID) resolveUnsaved("save");
    else if (top === "confirm") runConfirm();
    else submitModal(top);
    return true;
  }

  /* --- Esc: فقط بالاترین لایه، با شرطِ کثیفی --- */
  if (key === "Escape") {
    e.preventDefault();
    if (top === MODAL_GUARD_ID) resolveUnsaved("stay");
    else requestCloseModal(top);
    return true;
  }

  if (key === "Tab") { handleTab(e); return true; }
  return false;
}

/* کلیکِ بیرون: فقط اگر واقعاً روی «پرده» باشد و فقط بالاترین لایه را هدف بگیرد */
function handleBackdropClick(e) {
  if (e.target !== modalBackdrop()) return;
  if (!MODALS.stack.length) return;
  requestCloseModal(topModalId());
}

/** سیم‌کشیِ یک‌باره‌ی لایه‌ی مودال (از init صدا زده می‌شود) */
function wireModalLayer() {
  const back = modalBackdrop();
  if (back && !back.dataset.wired) {
    back.dataset.wired = "1";
    back.addEventListener("mousedown", handleBackdropClick);
  }
  /* همه‌ی دکمه‌های [data-close] — از جمله آن‌هایی که بعداً رندر می‌شوند */
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-close]");
    if (!b) return;
    e.preventDefault();
    requestCloseModal();
  });
  /* نشانِ «ذخیره‌نشده» روی سربرگِ مودال با هر تغییرِ فرم زنده بماند */
  if (back) {
    ["input", "change"].forEach((ev) =>
      back.addEventListener(ev, () => { if (MODALS.stack.length) paintDirtyState(); }));
  }
  /* لایه‌ی «تغییرات ذخیره‌نشده» */
  const st = el("btnUnsavedStay");
  if (st) st.addEventListener("click", () => resolveUnsaved("stay"));
  const sv = el("btnUnsavedSave");
  if (sv) sv.addEventListener("click", () => resolveUnsaved("save"));
  const ds = el("btnUnsavedDiscard");
  if (ds) ds.addEventListener("click", () => resolveUnsaved("discard"));
  /* مودالِ تأیید */
  const ok = el("btnConfirmOk");
  if (ok) ok.addEventListener("click", runConfirm);
  const altBtn = el("btnConfirmAlt");
  if (altBtn) altBtn.addEventListener("click", runConfirmAlt);
  syncInert();
}

/* ==========================================================================
   اعتبارسنجیِ فرم — پیام کنارِ خودِ فیلد، نه فقط توست
   (توست در پایینِ صفحه دیده می‌شود؛ کاربر باید بداند «کدام» فیلد ایراد دارد)
   ========================================================================== */
function setFieldError(id, msg) {
  const n = el(id);
  if (!n) return;
  const f = n.closest(".field");
  n.classList.toggle("invalid", !!msg);
  n.setAttribute("aria-invalid", msg ? "true" : "false");
  if (!f) return;
  let e = f.querySelector(".field-err");
  if (msg) {
    if (!e) {
      e = document.createElement("span");
      e.className = "field-err";
      e.setAttribute("role", "alert");
      f.appendChild(e);
    }
    e.textContent = msg;
  } else if (e) e.remove();
}

function clearFieldErrors(root) {
  (root || document).querySelectorAll(".field-err").forEach((n) => n.remove());
  (root || document).querySelectorAll(".invalid").forEach((n) => {
    n.classList.remove("invalid");
    n.setAttribute("aria-invalid", "false");
  });
}

/** اولین فیلدِ خطادار را فوکوس و اسکرول می‌کند */
function focusFirstError(root) {
  const n = (root || document).querySelector(".invalid");
  if (!n) return false;
  try { n.scrollIntoView({ block: "center", behavior: "smooth" }); n.focus(); } catch (e) { /* noop */ }
  return true;
}

/**
 * اجرای اعتبارسنجی: هر [id, test, message] که test مقدارِ فیلد را بگیرد.
 * @returns {boolean} true یعنی فرم معتبر است
 */
function validateForm(rules) {
  let ok = true, firstBad = null;
  rules.forEach((r) => {
    const n = el(r[0]);
    const pass = !!r[1](n ? n.value : "");
    setFieldError(r[0], pass ? "" : r[2]);
    if (!pass) { ok = false; if (!firstBad) firstBad = n; }
  });
  if (!ok && firstBad) {
    try { firstBad.scrollIntoView({ block: "center", behavior: "smooth" }); firstBad.focus(); } catch (e) { /* noop */ }
  }
  return ok;
}

/* صادرات برای تست (در مرورگر بی‌اثر است) */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    fingerprint, equalFingerprint, countDiff, MODALS, MODAL_KEYS,
    openModal, closeModal, requestCloseModal, submitModal, confirmAction,
    handleModalKeys, allowLeave, registerModal, registerExitGuard, isModalDirty,
  };
}
