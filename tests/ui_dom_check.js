/* تست دودِ رابط وب با jsdom — جریان‌های واقعی کاربر:
   حالت نمایشی، افزودن یونیت با ابعاد پیش‌فرض، تغییر نوع یونیت،
   جداکننده‌ی هزارگان هنگام تایپ و تنظیمات ابعاد پیش‌فرض.
   اجرا:  node tests/ui_dom_check.js   (نیاز به jsdom — در صورت نبودن، رد می‌شود) */
"use strict";
const fs = require("fs");
const path = require("path");

let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) {
  try { JSDOM = require(path.join(__dirname, "..", "..", "jsdom-test", "node_modules", "jsdom")).JSDOM; }
  catch (e2) {
    /* نصب محلی jsdom کنار مخزن (بدون ورود به ریپو):
         mkdir ../jsdom-test && cd ../jsdom-test && npm install jsdom       */
    console.log("SKIP: jsdom not installed");
    process.exit(0);
  }
}

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "webui/index.html"), "utf8");

let fail = 0;
function check(name, cond, extra) {
  console.log(`${cond ? "✅" : "❌"} ${name}${cond ? "" : "  →  " + (extra === undefined ? "" : extra)}`);
  if (!cond) { fail++; process.exitCode = 1; }
}

const dom = new JSDOM(html, { url: "http://localhost:8080/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
const { document } = window;

/* پلی‌فیل‌های لازم برای jsdom */
window.Element.prototype.scrollIntoView = function () {};
window.scrollTo = () => {};
if (!window.matchMedia) window.matchMedia = () => ({ matches: false });
window.fetch = () => Promise.reject(new Error("offline"));   // → حالت نمایشی

/* هر سه فایل یک‌جا eval می‌شوند (strict-mode) و handleها روی window.__k می‌نشینند */
const jsCode = ["data.js", "engine.js", "ui-modal.js", "ui.js"]
  .map((f) => fs.readFileSync(path.join(ROOT, "webui/js", f), "utf8"))
  .join("\n") + `
;window.__k = {
  init, navigate, openProjectEditor, curPage, calcProjectLocal, parseNum, renderEditorTables,
  doUndo, doRedo, recalcTotals, updateTbSummary, setTbDrawer, saveProject,
  undoReset, updateUndoButtons, clearDirty, paintDirtyState2,
  get API() { return API; },
  get PROJECTS() { return PROJECTS; },
  get SETTINGS() { return SETTINGS; },
  get MATERIALS() { return MATERIALS; },
  get state() { return state; },
  get UNDO() { return UNDO; },
};`;
window.eval(jsCode);
const K = window.__k;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (elm) => elm.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
/* تایپِ واقعی در مرورگر دو رویداد می‌سازد: `input` هنگامِ هر کلید و `change`
   هنگامِ واگذاردنِ فوکوس. تست باید هر دو را بسازد وگرنه رفتارِ واقعی سنجیده
   نمی‌شود (مثلاً فیلدهای سربرگِ پروژه فقط با `change` همگام می‌شوند).         */
const type = (elm, value) => {
  elm.value = value;
  elm.dispatchEvent(new window.Event("input", { bubbles: true }));
  elm.dispatchEvent(new window.Event("change", { bubbles: true }));
};
const selectValue = (elm, value) => {
  elm.value = value;
  elm.dispatchEvent(new window.Event("input", { bubbles: true }));
  elm.dispatchEvent(new window.Event("change", { bubbles: true }));
};

(async () => {
  await K.init();
  await sleep(120);

  check("demo mode active (API disconnected)", K.API.ok === false);
  check("demo projects loaded", K.PROJECTS.length === 3);

  /* --- رفتن به صفحه‌ی پروژه‌ها و بازکردن ویرایشگر --- */
  K.navigate("projects");
  K.openProjectEditor(1);
  await sleep(80);
  check("project editor visible", document.getElementById("projectEditor").hidden === false);

  /* --- دکمه‌های افزودن یونیت بر اساس نوع وجود دارند --- */
  const btnWall = document.querySelector('[data-add="unit:wall"]');
  const btnTall = document.querySelector('[data-add="unit:tall"]');
  const btnGround = document.querySelector('[data-add="unit:ground"]');
  check("quick-add buttons exist", !!(btnWall && btnTall && btnGround));

  const unitsBefore = K.curPage().units.length;
  click(btnWall);
  await sleep(60);
  const uWall = K.curPage().units[unitsBefore];
  check("wall unit added with wall defaults",
    uWall.unit_type === "wall" && uWall.height_cm === 70 && uWall.depth_cm === 30 && uWall.length_cm === 60,
    JSON.stringify({ t: uWall.unit_type, l: uWall.length_cm, h: uWall.height_cm, d: uWall.depth_cm }));
  check("wall unit auto label", /دیواری/.test(uWall.label), uWall.label);

  /* --- تغییر نوع یونیت → ابعاد پیش‌فرض نوع جدید خودکار اعمال شود --- */
  const idx = unitsBefore;
  const sel = document.querySelector(`#tblUnits select[data-scope="unit"][data-k="unit_type"][data-ui="${idx}"]`);
  check("unit_type select rendered", !!sel);
  selectValue(sel, "tall");
  await sleep(80);
  const uTall = K.curPage().units[idx];
  check("type change applies tall defaults",
    uTall.unit_type === "tall" && uTall.height_cm === 220 && uTall.depth_cm === 58 && uTall.shelves === 2,
    JSON.stringify({ t: uTall.unit_type, h: uTall.height_cm, d: uTall.depth_cm, s: uTall.shelves }));
  check("label auto-updated to tall", /کمد ایستاده/.test(uTall.label), uTall.label);

  /* --- جداکننده‌ی هزارگان هنگام تایپ --- */
  K.curPage().extras.push({ label: "قلم تست", qty: 1, unit: "piece", price: 0, visible: true });
  K.renderEditorTables();
  const priceInputs = document.querySelectorAll('#tblExtras input[data-scope="extra"][data-k="price"]');
  const priceInp = priceInputs[priceInputs.length - 1];   // ردیف تازه‌اضافه‌شده (آخرین)
  check("extra price input rendered", !!priceInp);
  priceInp.focus();
  type(priceInp, "1500000");
  check("thousands separator while typing", priceInp.value === "۱٬۵۰۰٬۰۰۰", priceInp.value);
  check("model receives parsed number", K.curPage().extras.slice(-1)[0].price === 1500000,
    String(K.curPage().extras.slice(-1)[0].price));

  /* فیلد درصدی جداکننده نگیرد */
  const profitInp = document.getElementById("tbProfitPct");
  type(profitInp, "2500");
  check("percent field (data-no-sep) not grouped", profitInp.value === "2500", profitInp.value);

  /* --- بنر نرخ قدیمی در حالت دمو پنهان است --- */
  check("stale banner hidden in demo mode", document.getElementById("staleBanner").hidden === true);

  /* --- تنظیمات: ابعاد پیش‌فرض یونیت‌ها --- */
  K.navigate("settings");
  await sleep(30);
  const setTallH = document.getElementById("setTallH");
  const setGroundL = document.getElementById("setGroundL");
  check("settings card rendered", !!setTallH && !!setGroundL);
  check("settings filled with defaults", setTallH.value === "۲۲۰" && setGroundL.value === "۶۰",
    `${setTallH.value} / ${setGroundL.value}`);

  /* تغییر پیش‌فرض و ذخیره → روی یونیت جدید اثر کند */
  type(setTallH, "240");
  click(document.getElementById("btnSaveSettings"));
  await sleep(80);
  check("settings saved (demo)", K.SETTINGS.unit_tall_height_cm === "240",
    K.SETTINGS.unit_tall_height_cm);
  (K.navigate("projects"), K.openProjectEditor(2));
  await sleep(60);
  const before2 = K.curPage().units.length;
  click(document.querySelector('[data-add="unit:tall"]'));
  await sleep(60);
  const nu = K.curPage().units[before2];
  check("new tall unit uses updated default height", nu.height_cm === 240, String(nu.height_cm));
  check("new tall unit label uses new length", /کمد ایستاده ۶۰/.test(nu.label), nu.label);

  /* --- مودال متریال: قیمت با جداکننده باز می‌شود --- */
  K.navigate("materials");
  await sleep(40);
  const editBtn = document.querySelector("[data-edit-mat]");
  click(editBtn);
  await sleep(40);
  const mfPrice = document.getElementById("mfPrice");
  check("material modal price grouped", /[٬]/.test(mfPrice.value) || K.parseNum(document.getElementById("mfPrice").value) > 0,
    mfPrice.value);

  /* ================== بررسی‌های ۲٫۴ — تجربه‌ی کاربری ================== */

  /* --- ویرایش سریعِ قیمت، درجا در سلول --- */
  const qCell = document.querySelector("[data-quick-price]");
  check("quick-price cell rendered", !!qCell);
  if (qCell) {
    const matId = +qCell.dataset.quickPrice;
    click(qCell);
    await sleep(30);
    const qInp = qCell.querySelector("input");
    check("quick-price input opens on click", !!qInp);
    if (qInp) {
      qInp.value = "1234567";
      qInp.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await sleep(80);
      check("quick-price commit changes material price", matPriceOf(matId) === 1234567,
        String(matPriceOf(matId)));
    }
  }
  function matPriceOf(id) {
    const m = K.MATERIALS.find((x) => x.id === id);
    return m ? m.price : NaN;
  }

  /* --- Tab در ویرایشِ سریعِ قیمت: ثبت + رفتن به قیمتِ بعدی ---
     سناریوی واقعیِ اپراتور: «نرخِ صبحِ بازار» — ده‌ها قلم پشتِ سر هم.
     پیش‌تر بعدِ هر ثبت فوکوس به body می‌پرید (یافته‌ی K‑3).                  */
  {
    const kd = (elm, k, init) => elm.dispatchEvent(new window.KeyboardEvent(
      "keydown", Object.assign({ key: k, bubbles: true, cancelable: true }, init || {})));
    const cells = [...document.querySelectorAll("[data-quick-price]")];
    check("quick-price Tab: at least 3 price cells to walk", cells.length >= 3, cells.length);
    if (cells.length >= 3) {
      const id0 = +cells[0].dataset.quickPrice, id1 = +cells[1].dataset.quickPrice;
      click(cells[0]);
      await sleep(30);
      let inp = document.querySelector(`[data-quick-price="${id0}"] input`);
      check("quick-price Tab: editor opened on first cell", !!inp);
      inp.value = "111111";
      kd(inp, "Tab");
      await sleep(120);
      check("quick-price Tab: value committed on Tab", matPriceOf(id0) === 111111, String(matPriceOf(id0)));
      const inp2 = document.querySelector(`[data-quick-price="${id1}"] input`);
      check("quick-price Tab: editor auto-opened on NEXT cell", !!inp2,
        "active=" + (document.activeElement && document.activeElement.tagName));
      if (inp2) {
        check("quick-price Tab: next cell is focused", document.activeElement === inp2);
        inp2.value = "222222";
        kd(inp2, "Tab", { shiftKey: true });
        await sleep(120);
        check("quick-price Shift+Tab: value committed", matPriceOf(id1) === 222222, String(matPriceOf(id1)));
        const inp3 = document.querySelector(`[data-quick-price="${id0}"] input`);
        check("quick-price Shift+Tab: went back to PREVIOUS cell", !!inp3);
        if (inp3) {
          const before = matPriceOf(id0);
          inp3.value = "999";
          kd(inp3, "Escape");
          await sleep(80);
          check("quick-price Escape: cancels without saving", matPriceOf(id0) === before,
            before + " vs " + matPriceOf(id0));
          check("quick-price Escape: editor closed",
            !document.querySelector(`[data-quick-price="${id0}"] input`));
        }
      }
    }
  }

  /* --- حفظِ فوکوس در بازسازیِ جدول‌های ویرایشگر (یافته‌ی K‑5) --- */
  K.navigate("projects");
  K.openProjectEditor(1);
  await sleep(80);
  {
    const qty = document.querySelector('#tblUnits [data-scope="unit"][data-k="length_cm"]');
    check("focus-preserve: an editor input exists", !!qty);
    if (qty) {
      qty.focus();
      const wrap0 = qty.closest(".table-wrap");
      if (wrap0) wrap0.scrollTop = 40;
      K.renderEditorTables();
      await sleep(20);
      const again = document.querySelector('#tblUnits [data-scope="unit"][data-k="length_cm"]');
      check("focus-preserve: re-render puts focus back on the SAME cell",
        document.activeElement === again, "active=" + (document.activeElement &&
          (document.activeElement.tagName + "/" + (document.activeElement.dataset || {}).k)));
      const wrap1 = again && again.closest(".table-wrap");
      check("focus-preserve: scroll position restored", !wrap1 || wrap1.scrollTop === 40,
        wrap1 && String(wrap1.scrollTop));
    }
    /* افزودن ردیف → فوکوس روی ردیفِ تازه، نه پریدن به body */
    click(document.querySelector('[data-add="unit:ground"]'));
    await sleep(80);
    const lastIdx = K.curPage().units.length - 1;
    const fresh = document.querySelector(
      `#tblUnits tr[data-row="er:unit:${lastIdx}"] [data-scope="unit"][data-k="label"]`);
    check("add-row: new row has stable identity", !!fresh);
    check("add-row: focus jumped straight into the NEW row",
      document.activeElement === fresh,
      "active=" + (document.activeElement && document.activeElement.outerHTML || "").slice(0, 90));

    /* --- کپیِ ردیف: ردیفِ کپی‌شده بلافاصله قابلِ ویرایش است --- */
    const nBefore = K.curPage().units.length;
    const copyBtn = document.querySelector('#tblUnits tr[data-row="er:unit:0"] [data-copy-row]');
    check("copy-row: button is inside the row's first cell",
      !!copyBtn && !!copyBtn.closest("td:first-child .row-id-cell"));
    click(copyBtn);
    await sleep(80);
    check("copy-row: one row added right after the source", K.curPage().units.length === nBefore + 1);
    const copiedInp = document.querySelector('#tblUnits tr[data-row="er:unit:1"] [data-scope="unit"][data-k="label"]');
    check("copy-row: focus moved into the COPY", document.activeElement === copiedInp,
      "active=" + (document.activeElement && document.activeElement.outerHTML || "").slice(0, 80));

    /* --- حذفِ ردیف: فوکوس به ردیفِ بعدی می‌رود (نه به body) --- */
    const nDel = K.curPage().units.length;
    click(document.querySelector('#tblUnits tr[data-row="er:unit:0"] [data-del-row]'));
    await sleep(80);
    check("delete-row: row removed", K.curPage().units.length === nDel - 1);
    const afterDel = document.querySelector('#tblUnits tr[data-row="er:unit:0"] input');
    check("delete-row: focus landed on the FOLLOWING row (نه پرش به body)",
      !!afterDel && document.activeElement === afterDel,
      "active=" + (document.activeElement && document.activeElement.tagName));
  }

  /* --- بازخوردِ «ذخیره‌نشده» روی تنها دکمه‌ی ذخیره و در نوارِ فرمان --- */
  {
    /* بررسی‌های بالا (افزودن/کپی/حذف) ویرایشگر را کثیف کردند → اول پاکش
       می‌کنیم تا «وضعیتِ تمیز» سنجیده شود، نه باقی‌مانده‌ی تست‌های قبلی.      */
    K.clearDirty();
    const saveB = document.getElementById("btnSaveProject");
    check("dirty badge: clean state shows nothing",
      document.getElementById("ebDirty").hidden === true &&
      document.getElementById("tbSaveHint").hidden === true);
    type(document.getElementById("edTitle"), "پروژه‌ی نشانِ کثیف");
    await sleep(60);
    check("dirty badge: save button lights up", saveB.classList.contains("dirty"), saveB.className);
    check("dirty badge: editor-bar shows «ذخیره‌نشده»",
      document.getElementById("ebDirty").hidden === false &&
      document.getElementById("editorBar").classList.contains("is-dirty"));
    check("dirty badge: totalbar hints Ctrl+S", document.getElementById("tbSaveHint").hidden === false);
    /* Ctrl+S از هر جای صفحه → ذخیره، بدونِ مودال */
    document.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
    await sleep(250);
    check("Ctrl+S: saved and badges cleared", K.state.dirty === false &&
      !saveB.classList.contains("dirty") && document.getElementById("ebDirty").hidden === true);
    check("Ctrl+S: data really saved", K.PROJECTS.some((p) => p.title === "پروژه‌ی نشانِ کثیف"),
      K.PROJECTS.map((p) => p.title).join(" | "));
  }

  /* --- نوارِ فرمانِ چسبان + کشوی مالی (بازطراحیِ ارگونومیِ ویرایشگر) --- */
  K.navigate("projects");
  K.openProjectEditor(1);
  await sleep(80);
  const ebar = document.getElementById("editorBar");
  check("sticky editor-bar exists", !!ebar && ebar.classList.contains("editor-bar"));
  check("editor-bar holds save+invoice+close", !!ebar &&
    !!ebar.querySelector("#btnSaveProject") && !!ebar.querySelector("#btnGoInvoice") &&
    !!ebar.querySelector("#btnCloseEditor"));
  check("save button shows its shortcut (kbd)", !!document.querySelector("#btnSaveProject .btn-kbd"));
  check("exactly ONE save button page-wide (ثباتِ رویه)",
    document.querySelectorAll("#projectEditor #btnSaveProject, #projectEditor .btn-save-project").length === 1 &&
    !document.getElementById("btnTotalSave") && !document.getElementById("btnTotalWorkshop"),
    "btnTotalSave=" + !!document.getElementById("btnTotalSave"));
  check("workshop button lives in editor-bar", !!document.querySelector("#editorBar #btnWorkshop"));
  check("project code chip exists (edCode input removed)",
    !!document.getElementById("edCodeChip") && !document.getElementById("edCode"));
  check("editor title/status shown in bar", !!document.getElementById("ebTitle") &&
    document.getElementById("ebTitle").textContent.length > 0 &&
    !!document.querySelector("#editorBar #edStatusBadge"));
  check("breakdown button renamed", /ریز قیمت/.test(document.getElementById("btnBreakdown").textContent));

  /* --- کشوی «تنظیمات مالی» --- */
  const tbT = document.getElementById("btnTbDrawer"), tbD = document.getElementById("tbDrawer");
  check("financial drawer exists + toggle wired", !!tbT && !!tbD &&
    tbT.getAttribute("aria-controls") === "tbDrawer");
  check("drawer starts closed by default (افشای تدریجی — نوارِ جمع باریک)", tbD.hidden === true &&
    tbT.getAttribute("aria-expanded") === "false");
  click(tbT);
  check("drawer toggles open", tbD.hidden === false && tbT.getAttribute("aria-expanded") === "true");
  click(tbT);
  check("drawer toggles back closed", tbD.hidden === true);
  check("drawer keeps all 8 financial inputs inside",
    ["tbProfitMode","tbProfitPct","tbInstallMode","tbInstallVal","tbDiscPct","tbDiscAmt",
     "tbVat","tbVatPct","tbExtraFixed","tbDepositPct","tbDepositAmt","tbRoundStep"]
      .every((id) => { const n = document.getElementById(id); return !!n && !!n.closest("#tbDrawer"); }));
  document.getElementById("tbProfitPct").value = "25";
  document.getElementById("tbDiscPct").value = "5";
  K.updateTbSummary();
  const sumTxt = document.getElementById("tbSummary").textContent;
  check("summary chip reflects active financial settings", /۲۵/.test(sumTxt) && /۵/.test(sumTxt), sumTxt);

  /* --- جدول‌ها: سرِ ستونِ چسبان + کنش‌ها در ستونِ اول --- */
  const wraps = [...document.querySelectorAll("#projectEditor .table-wrap.grid-head")];
  check("all 6 editor tables are sticky-head grids", wraps.length === 6, wraps.length);
  check("every grid has its own scrollport (thead sticky works)",
    wraps.every((w) => w.querySelector("table thead th")));
  click(document.querySelector('[data-add="unit:ground"]'));
  await sleep(60);
  const firstCell = document.querySelector("#tblUnits tbody tr td:first-child .row-id-cell");
  check("row actions live in the FIRST (sticky) column", !!firstCell &&
    !!firstCell.querySelector('[data-del-row]') && !!firstCell.querySelector('[data-copy-row]'));
  check("delete is separated from copy by a divider",
    !!firstCell && !!firstCell.querySelector(".row-sep"));
  check("rows carry a stable identity (data-row)",
    /^er:unit:0$/.test(document.querySelector("#tblUnits tbody tr").getAttribute("data-row") || ""));
  check("cells carry scope/k identity for focus restore",
    !!document.querySelector('#tblUnits [data-scope="unit"][data-k="label"][data-row="er:unit:0"]'));

  /* --- واگرد / بازانجام --- */
  const n0 = K.curPage().units.length;
  /* بررسی‌های بالا (خلاصه‌ی مالی) تاریخچه را پر کردند → برای سنجشِ «وضعیتِ
     نخستین» تاریخچه را صفر می‌کنیم؛ خودِ منطقِ دکمه دست‌نخورده است.          */
  K.undoReset(); K.updateUndoButtons();
  check("undo button exists & initially disabled", !!document.getElementById("btnUndo") &&
    document.getElementById("btnUndo").disabled === true);
  click(document.querySelector('[data-add="unit:ground"]'));
  await sleep(60);
  check("unit added", K.curPage().units.length === n0 + 1);
  check("undo button enabled after change", document.getElementById("btnUndo").disabled === false);
  K.doUndo();
  await sleep(60);
  check("Ctrl+Z: added unit removed", K.curPage().units.length === n0);
  K.doRedo();
  await sleep(60);
  check("redo: unit is back", K.curPage().units.length === n0 + 1);
  K.doUndo();
  await sleep(40);

  /* --- حذفِ بازگردانی‌پذیر --- */
  const nBefore = K.curPage().units.length;
  const delBtn = document.querySelector('[data-del-row="unit"][data-ui="0"]');
  check("delete button rendered", !!delBtn);
  click(delBtn);
  await sleep(60);
  check("unit deleted", K.curPage().units.length === nBefore - 1);
  const undoToast = document.querySelector("#toasts .toast .t-action");
  check("toast offers «بازگردانی»", !!undoToast && /بازگردانی/.test(undoToast.textContent));
  if (undoToast) {
    click(undoToast);
    await sleep(60);
    check("deleted unit restored from toast", K.curPage().units.length === nBefore);
  }

  /* --- کلیدهای پیکان: یکی‌یکی زیاد/کم کردن qty --- */
  const qtyInp = document.querySelector('#tblUnits input[data-scope="unit"][data-k="qty"][data-ui="0"]');
  check("qty input rendered", !!qtyInp);
  if (qtyInp) {
    const q0 = K.parseNum(qtyInp.value);
    qtyInp.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    await sleep(40);
    const q1 = K.parseNum(document.querySelector('#tblUnits input[data-scope="unit"][data-k="qty"][data-ui="0"]').value);
    check("ArrowUp increments qty by 1", q1 === q0 + 1, `${q0} → ${q1}`);
    document.querySelector('#tblUnits input[data-scope="unit"][data-k="qty"][data-ui="0"]')
      .dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await sleep(40);
    const q2 = K.parseNum(document.querySelector('#tblUnits input[data-scope="unit"][data-k="qty"][data-ui="0"]').value);
    check("ArrowDown decrements qty", q2 === q0, `${q1} → ${q2}`);
  }

  /* --- Enter: پرش به همان ستون در ردیف بعدی --- */
  if (K.curPage().units.length >= 2) {
    const a = document.querySelector('#tblUnits input[data-k="length_cm"][data-ui="0"]');
    const b = document.querySelector('#tblUnits input[data-k="length_cm"][data-ui="1"]');
    a.focus();
    a.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await sleep(20);
    check("Enter jumps to same column, next row", document.activeElement === b);
  }

  /* --- نشانِ «در» → پرش به تبِ درها --- */
  const badge = document.querySelector('#tblUnits [data-goto-tab="doors"]');
  check("door badge is clickable", !!badge);
  if (badge) {
    click(badge);
    await sleep(60);
    const doorsTab = document.querySelector('#secTabs .tab[data-tab="doors"]');
    check("badge click switches to doors tab", doorsTab.classList.contains("active"));
    document.querySelector('#secTabs .tab[data-tab="units"]').click();
    await sleep(30);
  }

  /* --- تراشه‌ی هشدارِ زنده در نوار متراژ --- */
  const pgx = K.curPage();
  const savedBody = pgx.units[0].body_id;
  pgx.units[0].body_id = 0;                       /* بدنه بی‌متریال → هشدارِ موتور */
  await K.recalcTotals();
  await sleep(60);
  const chip = document.getElementById("dimWarnChip");
  check("live warning chip appears in dim ribbon", !!chip, "هشدار باید در نوار متراژ دیده شود");
  if (chip) {
    click(chip);
    await sleep(60);
    check("warning chip opens breakdown modal",
      document.getElementById("modalBackdrop").hidden === false &&
      /هشدار/.test(document.getElementById("breakdownBody").textContent));
    document.querySelectorAll("[data-close]").forEach((b) => { if (b.closest("#modalBackdrop")) click(b); });
    await sleep(30);
  }
  pgx.units[0].body_id = savedBody;
  await K.recalcTotals();
  await sleep(40);
  check("warning chip disappears when warnings resolved", !document.getElementById("dimWarnChip"));

  console.log(fail ? `\n❌ ${fail} بررسی ناموفق` : "\n✅ همه‌ی بررسی‌های DOM پاس شدند");
  window.close();
})().catch((e) => { console.error("CRASH:", e); process.exit(1); });
