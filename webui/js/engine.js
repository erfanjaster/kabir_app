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

function engineItem(key, group, title, detail, qty, unit_label, unit_price, amount, visible) {
  return { key, group, title, detail: detail || "", qty: _n(qty), unit_label: unit_label || "",
           unit_price: _n(unit_price), amount: _n(amount), visible: visible !== false };
}

function calcProjectLocal(project) {
  const S = SETTINGS;

  const items = [];
  const stats = { total_units: 0, total_doors: 0, total_drawers: 0, total_ground_lm: 0,
                  total_wall_lm: 0, total_body_area: 0, total_door_area: 0, total_back_area: 0,
                  total_banding_m: 0, total_sheets: 0 };
  const pageResults = [];
  let pagesCost = 0;

  for (const page of project.pages || []) {
    const pItems = [];
    let subtotal = 0, overhead = 0, detailCost = 0;
    const pr = { name: page.name, items: pItems, total_units: 0, total_doors: 0, total_drawers: 0,
                 total_ground_lm: 0, total_wall_lm: 0, total_sheets: 0, total_body_area: 0,
                 total_door_area: 0, total_back_area: 0, total_banding_m: 0,
                 subtotal: 0, overhead_amount: 0, total_cost: 0 };
    const waste = _n(page.waste_percent, 8);
    const BAND_BODY_F = _n(page.banding_body_factor, _n(S.banding_body_factor, 2.2));
    const BAND_WASTE = _n(page.banding_waste_percent, _n(S.banding_waste_percent, 8));

    for (const u of page.units || []) {
      const n = Math.max(1, _n(u.qty, 1));
      const L = _n(u.length_cm), H = _n(u.height_cm), D = _n(u.depth_cm);
      const bodyM = matById(u.body_id), backM = matById(u.back_id);
      const t = bodyM && bodyM.thickness_mm ? bodyM.thickness_mm / 10 : 0; // cm

      /* --- پنل‌های بدنه (مثل default_panels) --- */
      let bodyArea = 0, backArea = 0;
      bodyArea += 2 * (D / 100) * (H / 100);                       // دو بغل
      if (u.has_bottom_panel !== false) bodyArea += ((L - 2 * t) / 100) * (D / 100);
      if (u.has_top_panel !== false && u.unit_type !== "ground") bodyArea += ((L - 2 * t) / 100) * (D / 100);
      if (u.unit_type === "tall") bodyArea += ((L - 2 * t) / 100) * (D / 100);
      if (_n(u.shelves) > 0) bodyArea += _n(u.shelves) * ((L - 2 * t) / 100) * (D / 100);
      if (u.back_id) backArea += (L / 100) * (H / 100);

      /* ورق بدنه */
      if (bodyArea > 0 && bodyM) {
        const per = bodyArea * (1 + waste / 100);
        const sheetArea = (bodyM.sheet_width_cm * bodyM.sheet_height_cm) / 10000;
        if (sheetArea > 0) {
          const sheets = Math.ceil((per * n) / sheetArea);
          pItems.push(engineItem("body_sheet", "ورق بدنه", bodyM.name,
            `${fmt(sheets)} ورق — مساحت خالص ${fmt(bodyArea * n, 1)} م² (با ${fmt(waste)}٪ پرت)`,
            sheets, "ورق", bodyM.price, sheets * bodyM.price));
          pr.total_sheets += sheets;
        }
      }
      pr.total_body_area += bodyArea * n;

      /* فیبر پشت */
      if (backArea > 0 && backM) {
        const per = backArea * (1 + waste / 100);
        const sheetArea = (backM.sheet_width_cm * backM.sheet_height_cm) / 10000;
        const sheets = sheetArea > 0 ? Math.ceil((per * n) / sheetArea) : 0;
        if (sheets) {
          pItems.push(engineItem("back_sheet", "فیبر پشت", backM.name,
            `${fmt(sheets)} ورق — ${fmt(backArea * n, 1)} م²`, sheets, "ورق", backM.price, sheets * backM.price));
          pr.total_sheets += sheets;
        } else if (sheetArea <= 0) {
          const amt = per * n * pricePerSqm(backM);
          pItems.push(engineItem("back_sheet", "فیبر پشت", backM.name, "", per * n, "م²", pricePerSqm(backM), amt));
        }
        pr.total_back_area += backArea * n;
      }

      /* نوار PVC بدنه */
      if (bodyArea > 0 && u.banding_id) {
        const bm = matById(u.banding_id);
        const meters = bodyArea * n * BAND_BODY_F * (1 + BAND_WASTE / 100);
        if (bm) {
          pItems.push(engineItem("banding_body", "نوار PVC بدنه", bm.name,
            `ضریب ${fa(BAND_BODY_F)} × مساحت بدنه + ${fmt(BAND_WASTE)}٪ پرت`,
            meters, "متر", bm.price, meters * bm.price));
          pr.total_banding_m += meters;
        }
      }

      /* --- درها --- */
      for (const dr of u.doors || []) {
        const leaves = _n(dr.qty) * n;
        if (leaves <= 0) continue;
        const area = leaves * (_n(dr.w_cm) / 100) * (_n(dr.h_cm) / 100);
        pr.total_door_area += area;
        const dmat = matById(dr.material_id);
        if (dmat) {
          const sa = (dmat.sheet_width_cm * dmat.sheet_height_cm) / 10000;
          if (dmat.unit === "sheet" && sa > 0) {
            const sheets = Math.ceil((area * 1.08) / sa);
            pItems.push(engineItem("door_sheet", "ورق در", dmat.name,
              `${fmt(leaves)} لنگه — ${fmt(area, 1)} م² — ${fmt(sheets)} ورق`, sheets, "ورق", dmat.price, sheets * dmat.price));
            pr.total_sheets += sheets;
          } else {
            const pp = pricePerSqm(dmat);
            pItems.push(engineItem("door_sheet", "ورق در", dmat.name, `${fmt(leaves)} لنگه — ${fmt(area, 1)} م²`, area, "م²", pp, area * pp));
          }
        }
        const dmodel = matById(dr.door_model_id);
        if (dmodel) {
          pItems.push(engineItem("door_model", "مدل و اجرت در", dmodel.name, `${fmt(leaves)} لنگه`,
            leaves, "لنگه", dmodel.price, leaves * dmodel.price));
        }
        if (dr.banding_id) {
          const bm = matById(dr.banding_id);
          const per = 2 * ((_n(dr.w_cm) + _n(dr.h_cm)) / 100);
          const meters = per * leaves;
          if (bm) {
            pItems.push(engineItem("banding_door", "نوار PVC در", bm.name,
              `محیط ${fmt(per, 1)} متر × ${fmt(leaves)} لنگه`, meters, "متر", bm.price, meters * bm.price));
            pr.total_banding_m += meters;
          }
        }
        const hinge = matById(dr.hinge_id);
        if (hinge) {
          const q = _n(dr.hinges_per_leaf, 2) * leaves;
          pItems.push(engineItem("hinge", "لولا", hinge.name, `${fmt(_n(dr.hinges_per_leaf, 2))} عدد در هر لنگه`, q, "عدد", hinge.price, q * hinge.price));
        }
        if (dr.gas_spring_id && _n(dr.gas_springs_per_leaf) > 0) {
          const g = matById(dr.gas_spring_id);
          const q = _n(dr.gas_springs_per_leaf) * leaves;
          if (g) pItems.push(engineItem("gas_spring", "گازور / جک", g.name, "", q, "عدد", g.price, q * g.price));
        }
        const handle = matById(dr.handle_id);
        if (handle) {
          const q = _n(dr.handles_per_leaf, 1) * leaves;
          pItems.push(engineItem("handle", "دستگیره", handle.name, "", q, "عدد", handle.price, q * handle.price));
        }
        const asm = matById(dr.assembly_id);
        if (asm) pItems.push(engineItem("assembly_door", "مونتاژ و خدمات", asm.name, `${fmt(leaves)} لنگه در`, leaves, "لنگه", asm.price, leaves * asm.price));
        const pk = matById(dr.packaging_id);
        if (pk) pItems.push(engineItem("packaging_door", "مونتاژ و خدمات", pk.name, `${fmt(leaves)} لنگه در`, leaves, "لنگه", pk.price, leaves * pk.price));
        pr.total_doors += leaves;
      }

      /* --- کشوها --- */
      for (const dw of u.drawers || []) {
        const count = _n(dw.qty) * n;
        if (count <= 0) continue;
        const w = _n(dw.w_cm) / 100, h = _n(dw.h_cm) / 100, d = _n(dw.d_cm) / 100;
        const sheetM = matById(dw.sheet_id);
        if (sheetM) {
          const boxArea = (2 * d * h) + (w * d) + (w * h);
          const pp = pricePerSqm(sheetM);
          pItems.push(engineItem("drawer_box", "جعبه‌ی کشو", sheetM.name,
            `${fmt(count)} عدد × ${fmt(boxArea, 1)} م²`, boxArea * count, "م²", pp, boxArea * count * pp));
        }
        const frontM = matById(dw.front_id);
        if (frontM) {
          const fa2 = w * h;
          const pp = pricePerSqm(frontM);
          pItems.push(engineItem("drawer_front", "تیره‌ی کشو", frontM.name, `${fmt(count)} عدد × ${fmt(fa2, 1)} م²`, fa2 * count, "م²", pp, fa2 * count * pp));
          pr.total_door_area += fa2 * count;
        }
        const slide = matById(dw.slide_id);
        if (slide) pItems.push(engineItem("drawer_slide", "ریل کشو", slide.name, `${fmt(count)} عدد کشو`, count, "ست", slide.price, count * slide.price));
        if (dw.banding_id) {
          const bm = matById(dw.banding_id);
          const meters = (2 * (2 * (d + h)) + 2 * (w + d) + 2 * (w + h)) * count;
          if (bm) {
            pItems.push(engineItem("banding_drawer", "نوار PVC کشو", bm.name, "", meters, "متر", bm.price, meters * bm.price));
            pr.total_banding_m += meters;
          }
        }
        const dh = matById(dw.handle_id);
        if (dh) pItems.push(engineItem("handle", "دستگیره", dh.name, `${fmt(count)} عدد کشو`, count, "عدد", dh.price, count * dh.price));
        const da = matById(dw.assembly_id);
        if (da) pItems.push(engineItem("assembly_drawer", "مونتاژ و خدمات", da.name, `${fmt(count)} عدد کشو`, count, "عدد", da.price, count * da.price));
        pr.total_drawers += count;
      }

      /* --- صفحه / تاج / زیرچراغ / پاخور / پایه / خار / مونتاژ --- */
      if (u.countertop_id) {
        const cm = matById(u.countertop_id);
        if (cm) {
          const lm = (L / 100) * n;
          pItems.push(engineItem("countertop", "صفحه کابینت", cm.name, `${fmt(lm, 1)} متر طول`, lm, "متر", cm.price, lm * cm.price));
        }
      }
      if (u.crown_id && u.unit_type !== "ground") {
        const cm = matById(u.crown_id);
        if (cm) { const lm = (L / 100) * n; pItems.push(engineItem("crown", "تاج", cm.name, `${fmt(lm, 1)} متر طول`, lm, "متر", cm.price, lm * cm.price)); }
      }
      if (u.underlight_id && u.unit_type === "wall") {
        const cm = matById(u.underlight_id);
        if (cm) { const lm = (L / 100) * n; pItems.push(engineItem("underlight", "زیرچراغ", cm.name, `${fmt(lm, 1)} متر طول`, lm, "متر", cm.price, lm * cm.price)); }
      }
      if (u.kickboard_id && u.unit_type !== "wall") {
        const cm = matById(u.kickboard_id);
        if (cm) { const lm = (L / 100) * n; pItems.push(engineItem("kickboard", "پاخور", cm.name, `${fmt(lm, 1)} متر طول`, lm, "متر", cm.price, lm * cm.price)); }
      }
      if (u.leg_id && u.unit_type !== "wall") {
        const lm2 = matById(u.leg_id);
        if (lm2) { const q = _n(u.legs_per_unit, 4) * n; pItems.push(engineItem("leg", "پایه", lm2.name, `${fmt(q)} عدد`, q, "عدد", lm2.price, q * lm2.price)); }
      }
      if (u.shelf_pin_id && _n(u.shelves) > 0) {
        const sp = matById(u.shelf_pin_id);
        if (sp) { const q = _n(u.pins_per_shelf, 4) * _n(u.shelves) * n; pItems.push(engineItem("shelf_pin", "خار طبقه", sp.name, "", q, "عدد", sp.price, q * sp.price)); }
      }
      if (u.assembly_id) {
        const am = matById(u.assembly_id);
        if (am) pItems.push(engineItem("assembly_unit", "مونتاژ و خدمات", am.name, `${fmt(n)} یونیت`, n, "یونیت", am.price, n * am.price));
      }

      pr.total_units += n;
      if (u.unit_type === "wall") pr.total_wall_lm += (L / 100) * n;
      else pr.total_ground_lm += (L / 100) * n;
    }

    /* صفحه‌ی کابینت کلی بخش */
    if (_n(page.countertop_lm) > 0) {
      const used = (page.units || []).find((u) => u.countertop_id);
      const cm = used ? matById(used.countertop_id) : null;
      if (cm) {
        const lm = _n(page.countertop_lm);
        pItems.push(engineItem("countertop", "صفحه کابینت", cm.name, `${fmt(lm, 1)} متر طول (ورودی کلی)`, lm, "متر", cm.price, lm * cm.price));
      }
    }

    /* درنما */
    if (page.detail_mode === "detailed") {
      for (const r of page.detail_rows || []) {
        const area = _n(r.qty) * (_n(r.w_cm) / 100) * (_n(r.h_cm) / 100);
        if (area <= 0) continue;
        detailCost += area * _n(r.price_per_sqm);
        pItems.push(engineItem("darna", "درنما", r.label || "درنما",
          `${fmt(_n(r.qty))} × ${fmt(_n(r.w_cm))}×${fmt(_n(r.h_cm))} سانتی‌متر = ${fmt(area, 1)} م²`,
          area, "م²", _n(r.price_per_sqm), area * _n(r.price_per_sqm)));
      }
    } else if (page.detail_mode === "total") {
      const sqm = _n(page.detail_total_sqm), pp = _n(page.detail_price_per_sqm);
      if (sqm > 0) {
        detailCost += sqm * pp;
        pItems.push(engineItem("darna", "درنما", "درنما (متراژ کلی)", `${fmt(sqm, 1)} م² × قیمت واحد`, sqm, "م²", pp, sqm * pp));
      }
    }

    /* اضافات */
    for (const ex of page.extras || []) {
      if (!ex.label && !_n(ex.price)) continue;
      const amt = _n(ex.qty, 1) * _n(ex.price);
      pItems.push(engineItem("extra", "اضافات و اکسسوری", ex.label || "قلم متفرقه", ex.note || "",
        _n(ex.qty, 1), UNITS[ex.unit] || ex.unit || "", _n(ex.price), amt, ex.visible !== false));
    }

    /* خدمات (مبنا خودکار) */
    const ctx = {
      unit: pr.total_units, door: pr.total_doors, shelf: 0, sqm: 0,
      lm: pr.total_ground_lm + pr.total_wall_lm, fixed: 1, percent: 0,
    };
    for (const u of page.units || []) ctx.shelf += _n(u.shelves) * Math.max(1, _n(u.qty, 1));
    const pctServices = [];
    let fixedSvcTotal = 0;
    for (const s of page.services || []) {
      if (!s.label && !_n(s.price)) continue;
      if (s.basis === "percent") { pctServices.push(s); continue; }
      const basis = ctx[s.basis] !== undefined ? s.basis : "fixed";
      const q = ctx[basis];
      const amt = q * _n(s.price);
      fixedSvcTotal += amt;
      pItems.push(engineItem("service", "خدمات", s.label || "خدمات", `مبنای محاسبه: ${SERVICE_BASIS[basis] || basis}`, q, "", _n(s.price), amt));
    }

    /* نکته: موتور دسکتاپ مبلغ خدمات غیردرصدی را دو بار در جمع بخش
       لحاظ می‌کند (یک‌بار در labor_cost و یک‌بار در service_cost).
       برای یکی بودن اعداد وب و دسکتاپ، همان رفتار اینجا بازتولید شده است. */
    /* نکته: موتور دسکتاپ (kabir/core/costing.py) مبلغ خدمات غیردرصدی را
       دو بار در جمع بخش لحاظ می‌کند (یک‌بار در labor_cost از راه group_map
       و یک‌بار در service_cost). برای اینکه قیمت‌های رابط وب و دسکتاپ
       مو‌به‌مو یکی باشد، همان رفتار اینجا بازتولید شده است. */
    subtotal = pItems.reduce((a, it) => a + it.amount, 0) + fixedSvcTotal;
    /* خدمات درصدی */
    for (const s of pctServices) {
      const amt = subtotal * _n(s.price) / 100;
      pItems.push(engineItem("service", "خدمات", s.label || "خدمات درصدی", `${fmt(_n(s.price), 1)}٪ از جمع بخش`, 1, "", _n(s.price), amt));
      subtotal += amt;
    }
    overhead = subtotal * _n(page.overhead_percent) / 100;
    pr.subtotal = subtotal;
    pr.overhead_amount = overhead;
    pr.total_cost = subtotal + overhead;
    pr.items = pItems;
    pageResults.push(pr);
    pagesCost += pr.total_cost;
    items.push(...pItems);
    for (const k of Object.keys(stats)) stats[k] += pr[k] || 0;
  }

  /* مبلغ ثابت اضافه */
  const extraFixed = _n(project.extra_fixed_amount);
  if (extraFixed) {
    const it = engineItem("extra_fixed", "اضافات و اکسسوری", "مبلغ ثابت بابت تفاوت نوع در / اقلام کلی", "", 1, "موردی", extraFixed, extraFixed);
    items.push(it);
    pagesCost += extraFixed;
    stats.extra_fixed = extraFixed;
  }

  /* نصب */
  let install = 0;
  const im = project.install_mode || "none", iv = _n(project.install_value);
  if (im === "fixed") install = iv;
  else if (im === "per_meter") install = iv * (stats.total_ground_lm || 0);
  else if (im === "percent") install = pagesCost * iv / 100;
  if (install > 0) {
    items.push(engineItem("installation", "نصب و حمل", "هزینه‌ی نصب",
      im === "per_meter" ? `${fmt(iv)} × ${fmt(stats.total_ground_lm, 1)} متر طول کابینت زمینی` : im === "percent" ? `${fmt(iv, 1)}٪ از جمع هزینه‌ها` : "مبلغ ثابت",
      1, "موردی", install, install));
  }
  const totalCost = pagesCost + install;

  /* سود */
  const pMode = project.profit_mode || "markup";
  const pPct = _n(project.profit_percent);
  let profit;
  if (pMode === "margin") profit = pPct >= 100 ? 0 : totalCost * pPct / (100 - pPct);
  else profit = totalCost * pPct / 100;
  const gross = totalCost + profit;

  /* تخفیف و مالیات */
  const discount = Math.min(gross * _n(project.discount_percent) / 100 + _n(project.discount_amount), gross);
  const net = gross - discount;
  const vatPct = project.vat_enabled ? _n(project.vat_percent) : 0;
  const vat = net * vatPct / 100;
  const final = net + vat;

  return {
    pages: pageResults,
    pages_cost: pagesCost, installation_cost: install, total_cost: totalCost,
    profit_mode: pMode, profit_percent: pPct, profit_amount: profit,
    gross_price: gross, discount_percent: _n(project.discount_percent), discount_amount: discount,
    net_price: net, vat_percent: vatPct, vat_amount: vat, final_price: final,
    total_profit: final - totalCost - vat,
    stats, items,
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
      final_price: result.final_price, stats: result.stats,
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
