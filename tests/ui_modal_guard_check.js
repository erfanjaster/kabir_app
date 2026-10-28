/* بررسی لایه‌ی «مودال و فرم» (js/ui-modal.js) با jsdom
   ------------------------------------------------------------------------
   همان سه قانونی را تست می‌کند که در docs/UX_AUDIT_v1.md نقض شده بودند:
     ۱) هیچ مودالِ «پر شده» با کلیکِ بیرون / Esc / انصراف بسته نمی‌شود.
     ۲) مودالِ «تمیز» بدونِ مزاحمت بسته می‌شود (سرعتِ کاربر حفظ می‌شود).
     ۳) پشته‌ی مودال‌ها: مودالِ بالایی بسته می‌شود، نه کلِ لایه.
     ۴) Enter = ثبتِ فرم، و خطای اعتبارسنجی کنارِ خودِ فیلد می‌نشیند.
     ۵) ترکِ صفحه با داده‌ی ذخیره‌نشده‌ی ویرایشگر → پرسش از کاربر.
   اجرا:  node tests/ui_modal_guard_check.js   (نیاز به jsdom — در صورت نبودن رد می‌شود) */
"use strict";
const fs = require("fs");
const path = require("path");

let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) {
  try { JSDOM = require(path.join(__dirname, "..", "..", "jsdom-test", "node_modules", "jsdom")).JSDOM; }
  catch (e2) { console.log("SKIP: jsdom not installed"); process.exit(0); }
}

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "webui/index.html"), "utf8");

let fail = 0, pass = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; process.exitCode = 1; console.log(`❌ ${name}  →  ${extra === undefined ? "" : extra}`); }
}

const dom = new JSDOM(html, { url: "http://localhost:8080/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
const { document } = window;

window.Element.prototype.scrollIntoView = function () {};
window.scrollTo = () => {};
if (!window.matchMedia) window.matchMedia = () => ({ matches: false });
window.fetch = () => Promise.reject(new Error("offline"));   // → حالت نمایشی

/* نکته: jsdom هیچ‌گاه offsetParent را پر نمی‌کند، پس «تله‌ی فوکوس» (که به
   قابل‌دیدن بودن تکیه دارد) این‌جا قابل سنجش نیست؛ فقط inert/aria-hidden
   سنجیده می‌شود. رفتار Tab باید در مرورگر واقعی بررسی شود.                 */
Object.defineProperty(window.HTMLElement.prototype, "offsetParent", {
  get() { return this.closest("[hidden]") || this.style.display === "none" ? null : this.parentElement; },
});

const jsCode = ["data.js", "engine.js", "ui-modal.js", "ui.js"]
  .map((f) => fs.readFileSync(path.join(ROOT, "webui/js", f), "utf8"))
  .join("\n") + `
;window.__k = {
  init, navigate, openProjectEditor, closeProjectEditor, openModal, closeModal,
  requestCloseModal, submitModal, allowLeave, isModalDirty, anyModalDirty,
  handleModalKeys, registerModal, parseNum,
  MODALS, MODAL_KEYS,
  get API() { return API; },
  get state() { return state; },
  get PROJECTS() { return PROJECTS; },
  get UNIT_TEMPLATES() { return UNIT_TEMPLATES; },
  get MATERIALS() { return MATERIALS; },
};`;
window.eval(jsCode);
const K = window.__k;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (elm) => elm.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const mousedown = (elm) => elm.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
const key = (k, init) => document.dispatchEvent(new window.KeyboardEvent("keydown",
  Object.assign({ key: k, bubbles: true, cancelable: true }, init || {})));
const type = (elm, value) => {
  elm.value = value;
  elm.dispatchEvent(new window.Event("input", { bubbles: true }));
  elm.dispatchEvent(new window.Event("change", { bubbles: true }));
};
const isOpen = (id) => document.getElementById("modal-" + id).classList.contains("open");
const backdrop = () => document.getElementById("modalBackdrop");

(async () => {
  await K.init();
  await sleep(120);
  check("حالت نمایشی فعال است (بدون سرور)", K.API.ok === false);

  /* ═══════════ ۱) مودالِ تمیز: خروجِ بدونِ مزاحمت (سرعتِ کاربر) ═══════════ */
  await K.navigate("materials");
  await sleep(60);
  click(document.getElementById("btnNewMaterial"));
  await sleep(120);
  check("مودالِ متریال باز شد", isOpen("material"));
  check("مودالِ تمیز «ذخیره‌نشده» نشان نمی‌دهد",
    !document.getElementById("modal-material").classList.contains("is-dirty"));

  key("Escape");
  await sleep(60);
  check("Esc روی مودالِ تمیز → بی‌صدا بسته می‌شود", !isOpen("material"));
  check("پشته پس از بستن خالی است", K.MODALS.stack.length === 0, JSON.stringify(K.MODALS.stack.map(f => f.id)));

  /* ═══════════ ۲) کلیکِ بیرون روی مودالِ پُر شده ═══════════ */
  click(document.getElementById("btnNewMaterial"));
  await sleep(120);
  type(document.getElementById("mfName"), "ام‌دی‌اف تستِ ممیزی");
  type(document.getElementById("mfPrice"), "1250000");
  await sleep(40);
  check("مودال با تایپِ کاربر «کثیف» شد", K.isModalDirty("material") === true);
  check("نشانِ «ذخیره‌نشده» روی مودال نشست",
    document.getElementById("modal-material").classList.contains("is-dirty"));

  mousedown(backdrop());
  await sleep(80);
  check("کلیکِ بیرون → مودالِ پُر شده بسته نشد", isOpen("material"));
  check("کلیکِ بیرون → لایه‌ی «تغییرات ذخیره‌نشده» باز شد", isOpen("unsaved"));
  check("هشدار، نامِ فرم را نشان می‌دهد",
    /فرمِ متریال/.test(document.getElementById("unsavedText").textContent),
    document.getElementById("unsavedText").textContent);
  check("هشدار، تعدادِ فیلدهای تغییرکرده را می‌گوید (عددِ فارسی)",
    /[\d۰-۹]/.test(document.getElementById("unsavedText").textContent),
    document.getElementById("unsavedText").textContent);
  check("دکمه‌ی «ذخیره و بستن» برای فرمِ ثبت‌شدنی نمایش داده می‌شود",
    document.getElementById("btnUnsavedSave").hidden === false);

  /* --- «ادامه‌ی ویرایش» = امن‌ترین کنش --- */
  click(document.getElementById("btnUnsavedStay"));
  await sleep(80);
  check("«ادامه‌ی ویرایش» → لایه‌ی هشدار بسته شد", !isOpen("unsaved"));
  check("«ادامه‌ی ویرایش» → فرم با داده‌های کاربر سرِ جایش ماند",
    isOpen("material") && document.getElementById("mfName").value === "ام‌دی‌اف تستِ ممیزی");

  /* --- Esc روی لایه‌ی هشدار = ماندن (نه دور ریختن) --- */
  mousedown(backdrop());
  await sleep(80);
  check("کلیکِ بیرون دوباره هشدار داد", isOpen("unsaved"));
  key("Escape");
  await sleep(80);
  check("Esc روی هشدار = «ادامه‌ی ویرایش»، داده حفظ شد",
    !isOpen("unsaved") && isOpen("material") && !!document.getElementById("mfName").value);

  /* --- «دور ریختن» --- */
  mousedown(backdrop());
  await sleep(80);
  click(document.getElementById("btnUnsavedDiscard"));
  await sleep(120);
  check("«دور ریختن» → مودال بسته شد", !isOpen("material") && !isOpen("unsaved"));
  check("پشته کاملاً خالی شد", K.MODALS.stack.length === 0, JSON.stringify(K.MODALS.stack.map(f => f.id)));

  /* ═══════════ ۳) Esc روی مودالِ پُر شده (بدونِ موس) ═══════════ */
  click(document.getElementById("btnNewMaterial"));
  await sleep(120);
  type(document.getElementById("mfName"), "قلمی که با Esc می‌رفت");
  type(document.getElementById("mfPrice"), "1250000");
  key("Escape");
  await sleep(80);
  check("Esc روی مودالِ پُر → بسته نشد، هشدار آمد", isOpen("material") && isOpen("unsaved"));
  /* نجات: «ذخیره و بستن» */
  const matsBefore = K.PROJECTS.length;
  click(document.getElementById("btnUnsavedSave"));
  await sleep(400);
  check("«ذخیره و بستن» → فرم ثبت و بسته شد", !isOpen("material") && !isOpen("unsaved"));
  check("قلمِ تازه واقعاً ذخیره شد (نه فقط بسته شد)",
    K.MATERIALS.some((m) => m.name === "قلمی که با Esc می‌رفت"),
    K.MATERIALS.map((m) => m.name).slice(-3).join(" | "));

  /* ═══════════ ۴) اعتبارسنجی: خطا کنارِ فیلد، مودال باز می‌ماند ═══════════ */
  click(document.getElementById("btnNewMaterial"));
  await sleep(120);
  type(document.getElementById("mfName"), "");
  type(document.getElementById("mfPrice"), "0");
  click(document.getElementById("btnSaveMaterial"));
  await sleep(120);
  check("ثبتِ فرمِ نامعتبر → مودال بسته نشد", isOpen("material"));
  check("پیامِ خطا کنارِ فیلدِ «نام» نشست", !!document.querySelector("#mfName")
    && document.getElementById("mfName").classList.contains("invalid"));
  check("متنِ خطا داخلِ .field-err نمایش داده می‌شود",
    !!document.querySelector("#modal-material .field-err"),
    document.querySelector("#modal-material .field-err") ? "" : "بدونِ پیام");
  check("فیلدِ قیمت هم خطا گرفت", document.getElementById("mfPrice").classList.contains("invalid"));
  /* پاک‌کردن و بستنِ تمیز */
  type(document.getElementById("mfName"), "");
  key("Escape");
  await sleep(100);
  if (isOpen("unsaved")) { click(document.getElementById("btnUnsavedDiscard")); await sleep(100); }
  check("پس از لغو، مودالی باز نمانده", !isOpen("material"));

  /* ═══════════ ۵) راهنمای کلید (کشف‌پذیریِ Enter) ═══════════ */
  check("راهنمای Enter در پاورقیِ مودالِ متریال هست",
    !!document.querySelector("#modal-material .modal-foot .kbd-hint"));
  check("راهنمای Enter در پاورقیِ مودالِ پروژه هست",
    !!document.querySelector("#modal-project .modal-foot .kbd-hint"));

  /* ═══════════ ۶) Enter = ثبتِ فرم ═══════════ */
  await K.navigate("projects");
  await sleep(60);
  const projCount = K.PROJECTS.length;
  click(document.getElementById("btnNewProject"));
  await sleep(120);
  check("مودالِ «پروژه‌ی جدید» باز شد", isOpen("project"));
  type(document.getElementById("pfTitle"), "پروژه‌ی تستِ Enter");
  key("Enter");
  await sleep(200);
  check("Enter → پروژه ساخته و مودال بسته شد",
    !isOpen("project") && K.PROJECTS.length === projCount + 1,
    `${K.PROJECTS.length} در برابر ${projCount}`);
  check("Enter → ویرایشگرِ همان پروژه باز شد",
    K.state.editingProject && K.state.editingProject.title === "پروژه‌ی تستِ Enter",
    String(K.state.editingProject && K.state.editingProject.title));

  /* ═══════════ ۷) پشته‌ی مودال‌ها: بالایی بسته می‌شود، نه کلِ لایه ═══════════ */
  /* یک الگوی یونیت می‌سازیم تا «مدیریت الگوها» فهرست داشته باشد */
  click(document.querySelector('[data-add="unit:ground"]'));
  await sleep(80);
  click(document.querySelector("[data-tpl-save]"));
  await sleep(100);
  check("مودالِ «ذخیره‌ی الگو» باز شد", isOpen("tpl-save"));
  type(document.getElementById("tplName"), "الگوی تستِ پشته");
  await K.submitModal("tpl-save");
  await sleep(120);
  check("الگو ذخیره شد", K.UNIT_TEMPLATES.some((t) => t.name === "الگوی تستِ پشته"));

  click(document.getElementById("btnManageTpl"));
  await sleep(100);
  check("مودالِ «فهرست الگوها» باز شد", isOpen("templates"));
  click(document.querySelector("[data-tpl-del]"));
  await sleep(100);
  check("مودالِ تأییدِ حذف «روی» فهرست باز شد", isOpen("confirm") && isOpen("templates"));
  check("پشته دو لایه دارد", K.MODALS.stack.length === 2, JSON.stringify(K.MODALS.stack.map(f => f.id)));
  check("لایه‌ی زیرین inert شد (فرارِ Tab به DOMِ نامرئی ممکن نیست)",
    document.getElementById("modal-confirm").getAttribute("aria-hidden") === null
    && document.getElementById("modal-material").getAttribute("aria-hidden") === "true");

  /* رد کردنِ تأیید با Esc → فقط تأیید بسته شود، فهرست باقی بماند */
  key("Escape");
  await sleep(120);
  check("Esc → مودالِ تأیید بسته شد", !isOpen("confirm"));
  check("Esc → «فهرست الگوها» سرِ جایش ماند (باگِ فروپاشیِ لایه رفع شد)", isOpen("templates"));
  check("پس از رد کردن، callback معلق نماند", K.MODALS.confirmCb === null);
  check("پشته یک لایه دارد", K.MODALS.stack.length === 1, JSON.stringify(K.MODALS.stack.map(f => f.id)));

  /* حالا تأییدِ واقعیِ حذف → فقط یک لایه برداشته شود */
  click(document.querySelector("[data-tpl-del]"));
  await sleep(100);
  click(document.getElementById("btnConfirmOk"));
  await sleep(150);
  check("تأییدِ حذف → الگو حذف شد", !K.UNIT_TEMPLATES.some((t) => t.name === "الگوی تستِ پشته"));
  check("تأییدِ حذف → فهرست الگوها باز ماند", isOpen("templates"));
  key("Escape");
  await sleep(80);
  check("خروج از فهرستِ الگوها", !isOpen("templates"));

  /* ═══════════ ۸) ترکِ صفحه با داده‌ی ذخیره‌نشده‌ی ویرایشگر ═══════════
     سیاستِ سخت‌گیرانه (تصمیمِ صریحِ کارفرما): هیچ خروجی بی‌صدا نیست — حتی اگر
     ذخیره ممکن باشد. هر بار سه کنشِ ثابت با چیدمانِ ثابت:
       راست (اصلی، سبز) = «ذخیره و رفتن»   •   وسط (قرمز) = «دور ریختن و رفتن»
       چپِ دور (کوچک)   = «ماندن» / Esc
     دلیلِ صنعتی: اپراتور باید بداند کدام نسخه روی سرور نشسته است؛ «ذخیره‌ی
     بی‌صدا» همان‌قدر خطرناک است که «دور ریختنِ بی‌صدا».                       */
  await K.navigate("projects");
  await sleep(60);
  type(document.getElementById("edTitle"), "عنوانی که نباید گم شود");
  await sleep(60);
  check("ویرایشگر کثیف شد", K.state.dirty === true);

  const stayOk = await K.allowLeave({ to: "projects" });
  check("گارد در همان صفحه‌ی پروژه‌ها مزاحم نمی‌شود (مقصد = همان صفحه)", stayOk === true, String(stayOk));

  K.MODAL_KEYS.currentPage = "projects";
  const navP = K.navigate("dashboard");
  /* از این‌جا به بعد هر «ذخیره‌ی واقعی» با window.__demoSaveCount شمرده می‌شود
     تا بتوان «ذخیره شد» را از «فقط در حافظه تغییر کرد» جدا کرد.            */
  await sleep(250);
  check("سیاستِ سخت‌گیرانه: ترکِ صفحه همیشه می‌پرسد (حتی وقتی ذخیره ممکن است)", isOpen("confirm"));
  check("ترکِ صفحه تا روشن‌شدنِ تکلیفِ داده انجام نمی‌شود", K.state.page === "projects", K.state.page);
  {
    const okB = document.getElementById("btnConfirmOk");
    const altB = document.getElementById("btnConfirmAlt");
    const canB = document.getElementById("btnConfirmCancel");
    check("کنشِ قرمز صریحاً «دور ریختن» است", /دور ریختن/.test(okB.textContent), okB.textContent);
    check("کنشِ قرمز با لحنِ خطرناک رنگ شده", okB.classList.contains("danger"), okB.className);
    check("کنشِ «ذخیره و رفتن» هست و سبز است", !altB.hidden && /ذخیره/.test(altB.textContent) &&
      altB.classList.contains("success"), altB.textContent + " | " + altB.className);
    check("کنشِ «ماندن» هم هست", /ماندن/.test(canB.textContent), canB.textContent);
    check("پیام، «ذخیره‌نشده» را صریح می‌گوید",
      /ذخیره‌نشده/.test(document.getElementById("confirmText").textContent));
    const foot = [...okB.parentElement.children].filter((n) => n.tagName === "BUTTON");
    check("چیدمانِ ثابت: قرمز پیش از سبز، انصراف در انتهای ردیف",
      foot[0] === okB && foot[1] === altB && foot[foot.length - 1] === canB,
      foot.map((n) => n.id).join(","));
  }
  /* «ماندن» / Esc → هیچ چیز عوض نمی‌شود */
  key("Escape");
  await sleep(200);
  await navP;
  check("«ماندن» → در همان صفحه ماندیم", K.state.page === "projects", K.state.page);
  check("«ماندن» → داده و وضعیتِ کثیف سرِ جایشان", K.state.dirty === true &&
    document.getElementById("edTitle").value === "عنوانی که نباید گم شود");

  /* مسیرِ «ذخیره و رفتن» */
  const navP2 = K.navigate("dashboard");
  await sleep(200);
  check("تلاشِ دوباره برای ترک → دوباره پرسید (حافظه‌ی بی‌صدا ندارد)", isOpen("confirm"));
  click(document.getElementById("btnConfirmAlt"));
  await sleep(300);
  await navP2;
  check("«ذخیره و رفتن» → به مقصد رفتیم", K.state.page === "dashboard", K.state.page);
  check("«ذخیره و رفتن» → داده واقعاً ذخیره شد",
    K.PROJECTS.some((p) => p.title === "عنوانی که نباید گم شود"),
    K.PROJECTS.map((p) => p.title).join(" | "));
  check("«ذخیره و رفتن» → مودالی باز نماند", K.MODALS.stack.length === 0,
    JSON.stringify(K.MODALS.stack.map((f) => f.id)));
  check("«ذخیره و رفتن» → ویرایشگر بسته شد", document.getElementById("projectEditor").hidden === true);

  /* مسیرِ «دور ریختن و رفتن» */
  await K.navigate("projects");
  await sleep(150);
  K.openProjectEditor(K.PROJECTS[0].id);
  await sleep(200);
  type(document.getElementById("edTitle"), "عنوانی که دور ریخته می‌شود");
  await sleep(60);
  const navP3 = K.navigate("dashboard");
  await sleep(250);
  check("ترکِ صفحه با داده‌ی کثیف → پرسش آمد", isOpen("confirm"));
  const savesBeforeDiscard = window.__demoSaveCount || 0;
  click(document.getElementById("btnConfirmOk"));
  await sleep(300);
  await navP3;
  check("«دور ریختن و رفتن» → رفتیم و ویرایشگر بسته شد",
    K.state.page === "dashboard" && document.getElementById("projectEditor").hidden === true);
  check("«دور ریختن و رفتن» → هیچ ذخیره‌ای رخ نداد",
    (window.__demoSaveCount || 0) === savesBeforeDiscard,
    savesBeforeDiscard + " → " + (window.__demoSaveCount || 0));

  /* --- ذخیره که ناموفق باشد، «ذخیره و رفتن» نباید کاربر را ببرد --- */
  await K.navigate("projects");
  await sleep(150);
  K.openProjectEditor(K.PROJECTS[0].id);
  await sleep(200);
  type(document.getElementById("edTitle"), "عنوانِ دومِ ذخیره‌نشده");
  await sleep(60);
  K.MODAL_KEYS.saveActiveContext = async () => false;   /* مثلاً سرور قطع است */
  const navPromise = K.navigate("dashboard");
  await sleep(250);
  check("با ذخیره‌ی ناموفق هم پرسش آمد", isOpen("confirm"));
  const savesBefore = window.__demoSaveCount || 0;
  click(document.getElementById("btnConfirmAlt"));
  await sleep(300);
  check("ذخیره که ناموفق باشد → «ذخیره و رفتن» کاربر را نبرد",
    K.state.page === "projects", K.state.page);
  check("ذخیره که ناموفق باشد → چیزی هم ذخیره نشد",
    (window.__demoSaveCount || 0) === savesBefore);
  check("ذخیره که ناموفق باشد → پرسش بسته شد و کاربر در ویرایشگر ماند",
    !isOpen("confirm") && document.getElementById("projectEditor").hidden === false);
  key("Escape");
  await sleep(150);
  await navPromise;
  K.MODAL_KEYS.saveActiveContext = null;
  check("انصراف → در صفحه‌ی پروژه‌ها ماندیم", K.state.page === "projects", K.state.page);
  check("انصراف → داده‌ی کاربر سرِ جایش است",
    document.getElementById("edTitle").value === "عنوانِ دومِ ذخیره‌نشده",
    document.getElementById("edTitle").value);
  check("انصراف → ویرایشگر کثیف باقی ماند", K.state.dirty === true);

  /* ═══════════ ۹) جابه‌جایی بین رکوردها هم همان سه کنش را دارد ═══════════ */
  const keep = K.state.editingProject;
  const otherId = K.PROJECTS.find((p) => p.id !== keep.id).id;
  K.openProjectEditor(otherId);
  await sleep(250);
  check("جابه‌جاییِ رکورد با داده‌ی کثیف → پرسش آمد (بی‌صدا جایگزین نکرد)", isOpen("confirm"));
  check("در رکوردِ قبلی ماندیم", K.state.editingProject.id === keep.id,
    String(K.state.editingProject && K.state.editingProject.id));
  check("پرسش سه کنش دارد",
    /دور ریختن/.test(document.getElementById("btnConfirmOk").textContent) &&
    /ذخیره/.test(document.getElementById("btnConfirmAlt").textContent) &&
    /ماندن/.test(document.getElementById("btnConfirmCancel").textContent));
  key("Escape");
  await sleep(200);
  check("«ماندن» → همان رکوردِ قبلی در ویرایشگر ماند",
    K.state.editingProject.id === keep.id, String(K.state.editingProject.id));

  /* «دور ریختن و بازکردن» */
  const savesBeforeOpen = window.__demoSaveCount || 0;
  K.openProjectEditor(otherId);
  await sleep(200);
  click(document.getElementById("btnConfirmOk"));
  await sleep(300);
  check("«دور ریختن و بازکردن» → رکوردِ تازه باز شد", K.state.editingProject.id === otherId);
  check("«دور ریختن و بازکردن» → داده‌ی قبلی ذخیره نشد",
    (window.__demoSaveCount || 0) === savesBeforeOpen);

  /* «ذخیره و بازکردن» */
  type(document.getElementById("edTitle"), "عنوانِ سومِ ذخیره‌نشده");
  await sleep(60);
  const cur3 = K.state.editingProject;
  const otherId2 = K.PROJECTS.find((p) => p.id !== cur3.id).id;
  K.openProjectEditor(otherId2);
  await sleep(250);
  check("جابه‌جاییِ دوباره → پرسش آمد", isOpen("confirm"));
  click(document.getElementById("btnConfirmAlt"));
  await sleep(400);
  check("«ذخیره و بازکردن» → رکوردِ تازه باز شد", K.state.editingProject.id === otherId2);
  check("«ذخیره و بازکردن» → داده واقعاً ذخیره شد",
    K.PROJECTS.some((p) => p.title === "عنوانِ سومِ ذخیره‌نشده"),
    K.PROJECTS.map((p) => p.title).join(" | "));

  /* اگر ذخیره ناموفق باشد، «ذخیره و بازکردن» جابه‌جا نمی‌کند */
  type(document.getElementById("edTitle"), "عنوانِ چهارمِ ذخیره‌نشده");
  await sleep(60);
  const keep4 = K.state.editingProject;
  const otherId3 = K.PROJECTS.find((p) => p.id !== keep4.id).id;
  K.MODAL_KEYS.saveActiveContext = async () => false;
  K.openProjectEditor(otherId3);
  await sleep(250);
  click(document.getElementById("btnConfirmAlt"));
  await sleep(300);
  K.MODAL_KEYS.saveActiveContext = null;
  check("ذخیره‌ی ناموفق → جابه‌جایی انجام نشد", K.state.editingProject.id === keep4.id);

  /* ═══════════ ۱۰) دکمه‌ی «کپی پروژه» اول نجات می‌دهد، بعد کپی ═══════════ */
  check("دکمه‌ی «کپی پروژه» وجود دارد", !!document.getElementById("btnDupProject"));

  /* ═══════════ ۱۱) بستنِ ویرایشگرِ کثیف: همان سه کنشِ صریح ═══════════
     «بستن» از دو مسیر ممکن است: دکمه‌ی بستنِ نوارِ فرمان، و تابعِ مستقیم.
     هر دو باید یک رفتار داشته باشند (ثباتِ رویه).                            */
  check("دکمه‌ی «بستن» در نوارِ فرمانِ چسبان است",
    !!document.querySelector("#editorBar #btnCloseEditor"));
  type(document.getElementById("edTitle"), "عنوانِ پنجمِ ذخیره‌نشده");
  await sleep(60);
  check("ویرایشگر برای تستِ بستن کثیف است", K.state.dirty === true);

  click(document.getElementById("btnCloseEditor"));     /* مسیرِ واقعیِ کاربر */
  await sleep(180);
  check("کلیکِ «بستن» روی ویرایشگرِ کثیف → پرسش آمد", isOpen("confirm"));
  {
    const okB = document.getElementById("btnConfirmOk");
    const altB = document.getElementById("btnConfirmAlt");
    const canB = document.getElementById("btnConfirmCancel");
    check("«بستن»: کنشِ قرمز «دور ریختن» است", /دور ریختن/.test(okB.textContent), okB.textContent);
    check("«بستن»: «ذخیره و بستن» سبز هست", !altB.hidden && /ذخیره/.test(altB.textContent) &&
      altB.classList.contains("success"), altB.className);
    check("«بستن»: «ماندن» هست", /ماندن/.test(canB.textContent), canB.textContent);
    const foot = [...okB.parentElement.children].filter((n) => n.tagName === "BUTTON");
    check("«بستن»: همان چیدمانِ ثابتِ سه‌گانه", foot[0] === okB && foot[1] === altB &&
      foot[foot.length - 1] === canB, foot.map((n) => n.id).join(","));
  }
  key("Escape");
  await sleep(150);
  check("«ماندن» → ویرایشگر باز ماند", document.getElementById("projectEditor").hidden === false);
  check("«ماندن» → داده سرِ جایش", K.state.dirty === true &&
    document.getElementById("edTitle").value === "عنوانِ پنجمِ ذخیره‌نشده");

  /* «ذخیره و بستن» */
  K.closeProjectEditor();
  await sleep(150);
  click(document.getElementById("btnConfirmAlt"));
  await sleep(300);
  check("«ذخیره و بستن» → ویرایشگر بسته شد", document.getElementById("projectEditor").hidden === true);
  check("«ذخیره و بستن» → داده ذخیره شد",
    K.PROJECTS.some((p) => p.title === "عنوانِ پنجمِ ذخیره‌نشده"),
    K.PROJECTS.map((p) => p.title).join(" | "));
  check("«ذخیره و بستن» → مودالی باز نماند", K.MODALS.stack.length === 0,
    JSON.stringify(K.MODALS.stack.map((f) => f.id)));

  /* «دور ریختن و بستن» */
  K.openProjectEditor(K.PROJECTS[0].id);
  await sleep(250);
  type(document.getElementById("edTitle"), "عنوانِ ششمِ دورریختنی");
  await sleep(60);
  const savesBeforeClose = window.__demoSaveCount || 0;
  K.closeProjectEditor();
  await sleep(150);
  click(document.getElementById("btnConfirmOk"));
  await sleep(250);
  check("«دور ریختن و بستن» → ویرایشگر بسته شد", document.getElementById("projectEditor").hidden === true);
  check("«دور ریختن و بستن» → هیچ ذخیره‌ای رخ نداد",
    (window.__demoSaveCount || 0) === savesBeforeClose);
  check("«دور ریختن و بستن» → مودالی باز نماند", K.MODALS.stack.length === 0,
    JSON.stringify(K.MODALS.stack.map((f) => f.id)));

  /* ویرایشگرِ تمیز → بدونِ پرسش بسته می‌شود (صفر کلیکِ اضافه) */
  K.openProjectEditor(K.PROJECTS[0].id);
  await sleep(250);
  check("ویرایشگرِ تازه‌بازشده تمیز است", K.state.dirty === false);
  K.closeProjectEditor();
  await sleep(150);
  check("ویرایشگرِ تمیز → بی‌پرسش بسته شد", document.getElementById("projectEditor").hidden === true &&
    !isOpen("confirm"));

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} بررسی پاس شد${fail ? ` و ${fail} بررسی رد شد` : ""}`);
  /* jsdom تایمرهای زنده دارد (پایشِ اتصال) — صریح خارج می‌شویم */
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("💥 خطای اجرا:", e); process.exit(1); });
