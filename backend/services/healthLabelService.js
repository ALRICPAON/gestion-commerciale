const DOTS_PER_MM_300_DPI = 300 / 25.4;
const LABEL_WIDTH_MM = 70;
const LABEL_HEIGHT_MM = 150;
const LABEL_VISUAL_WIDTH_MM = LABEL_HEIGHT_MM;
const LABEL_VISUAL_HEIGHT_MM = LABEL_WIDTH_MM;
const LABEL_WIDTH_DOTS = Math.round(LABEL_WIDTH_MM * DOTS_PER_MM_300_DPI);
const LABEL_HEIGHT_DOTS = Math.round(LABEL_HEIGHT_MM * DOTS_PER_MM_300_DPI);
const LABEL_VISUAL_WIDTH_DOTS = LABEL_HEIGHT_DOTS;
const LABEL_VISUAL_HEIGHT_DOTS = LABEL_WIDTH_DOTS;
const SAFE_MARGIN_MM = 2;
const SAFE_MARGIN = Math.round(SAFE_MARGIN_MM * DOTS_PER_MM_300_DPI);
const TAB_X_START_MM = 30;
const TAB_X_END_MM = 148;
const TAB_WIDTH_MM = TAB_X_END_MM - TAB_X_START_MM;
const TAB_PHYSICAL_Y_START_MM = 34;
const TAB_PHYSICAL_HEIGHT_MM = 20;
const TAB_SAFE_Y_START_MM = 35;
const TAB_SAFE_HEIGHT_MM = 18;
const TAB_SAFE_TOP_MARGIN_MM = TAB_SAFE_Y_START_MM - TAB_PHYSICAL_Y_START_MM;
const TAB_SAFE_BOTTOM_MARGIN_MM = TAB_PHYSICAL_Y_START_MM + TAB_PHYSICAL_HEIGHT_MM - TAB_SAFE_Y_START_MM - TAB_SAFE_HEIGHT_MM;
const TAB_Y_START_MM = TAB_SAFE_Y_START_MM;
const TAB_HEIGHT_MM = TAB_SAFE_HEIGHT_MM;
const TAB_TOP_MARGIN_MM = TAB_SAFE_Y_START_MM;
const TAB_BOTTOM_MARGIN_MM = LABEL_VISUAL_HEIGHT_MM - TAB_SAFE_Y_START_MM - TAB_SAFE_HEIGHT_MM;

function mm(value) {
  return Math.round(value * DOTS_PER_MM_300_DPI);
}

const FIXED_TOP_ZONE = {
  x: mm(2),
  y: mm(2),
  width: mm(146),
  height: mm(16),
};
const FIXED_TRACE_TOP_ZONE = {
  x: mm(2),
  y: mm(19),
  width: mm(146),
  height: mm(14),
};
const DETACHABLE_TAB_PHYSICAL = {
  x: mm(TAB_X_START_MM),
  y: mm(TAB_PHYSICAL_Y_START_MM),
  width: mm(TAB_WIDTH_MM),
  height: mm(TAB_PHYSICAL_HEIGHT_MM),
};
const DETACHABLE_TAB_SAFE = {
  x: mm(TAB_X_START_MM),
  y: mm(TAB_SAFE_Y_START_MM),
  width: mm(TAB_WIDTH_MM),
  height: mm(TAB_SAFE_HEIGHT_MM),
};
const DETACHABLE_TAB = DETACHABLE_TAB_SAFE;
const FIXED_TRACE_BOTTOM_ZONE = {
  x: mm(2),
  y: mm(54),
  width: mm(146),
  height: mm(14.5),
};
const FOOTER_ZONE = {
  x: mm(2),
  y: mm(64),
  width: mm(146),
  height: mm(3),
};
const MAIN_ZONE = {
  x: SAFE_MARGIN,
  y: SAFE_MARGIN,
  width: LABEL_VISUAL_WIDTH_DOTS - (SAFE_MARGIN * 2),
  height: LABEL_VISUAL_HEIGHT_DOTS - (SAFE_MARGIN * 2),
};
const TAB_INSET = mm(1);
const FAO_AREA_LABELS = new Map([
  ['27', 'Atlantique Nord-Est'],
]);

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function number(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInt(value, fallback = 0) {
  const parsed = Math.floor(number(value, fallback));
  return parsed > 0 ? parsed : fallback;
}

function firstValue(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return null;
}

function boolTrue(value) {
  if (value === true || value === 1) return true;
  const text = clean(value);
  if (!text) return false;
  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return ['true', '1', 'yes', 'oui', 'o', 'decongele'].includes(normalized);
}

function isDefrosted(...sources) {
  return sources.some((source) => {
    if (!source || typeof source !== 'object') return false;
    return boolTrue(source.defrosted)
      || boolTrue(source.is_defrosted)
      || boolTrue(source.decongele)
      || boolTrue(source.is_decongele)
      || boolTrue(source.was_frozen)
      || boolTrue(source.previously_frozen);
  });
}

function formatWeight(value) {
  return number(value).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return clean(value);
  return date.toLocaleDateString('fr-FR');
}

function normalizeFaoCode(value) {
  const text = clean(value);
  if (!text) return null;
  return text.replace(/^FAO\s*/i, '').trim().toUpperCase();
}

function formatFishingArea(value) {
  const text = clean(value);
  const code = normalizeFaoCode(text);
  if (!code) return null;
  const label = FAO_AREA_LABELS.get(code);
  return label ? `${label} - FAO ${code}` : text;
}

function formatAllergen(value) {
  const text = clean(value);
  return text ? text.toLocaleUpperCase('fr-FR') : null;
}

function formatTemperature(value) {
  const parsed = nullableNumber(value);
  if (parsed === null) return null;
  return parsed.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function formatStorageTemperatureRange(min, max) {
  const minText = formatTemperature(min);
  const maxText = formatTemperature(max);
  if (!minText || !maxText) return null;
  if (minText === maxText) return `${minText} °C`;
  return `${minText} à ${maxText} °C`;
}

function normalizeLots(rawLots) {
  if (!Array.isArray(rawLots)) return [];
  return rawLots.filter(Boolean).map((lot) => ({
    lot_id: lot.lot_id || lot.id || null,
    lot_code: clean(lot.lot_code),
    supplier_lot_number: clean(lot.supplier_lot_number),
    dlc: lot.dlc || null,
    quantity: number(lot.quantity, 0),
    traceability: lot.traceability_data && typeof lot.traceability_data === 'object' ? lot.traceability_data : {},
    latin_name: clean(lot.latin_name),
    fao_zone: clean(lot.fao_zone),
    sous_zone: clean(lot.sous_zone),
    fishing_gear: clean(lot.fishing_gear || lot.engin),
    production_method: clean(lot.production_method),
    allergens: clean(lot.allergens || lot.allergenes),
    storage_temperature_min: nullableNumber(lot.storage_temperature_min),
    storage_temperature_max: nullableNumber(lot.storage_temperature_max),
    storage_instruction: clean(lot.storage_instruction),
  }));
}

function parseHealthMark(value) {
  const raw = clean(value);
  if (!raw) return null;
  const approvalNumber = raw
    .replace(/\bFR\b/gi, ' ')
    .replace(/\bCE\b/gi, ' ')
    .replace(/\bUE\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!approvalNumber) return null;
  return { country: 'FR', approval_number: approvalNumber, authority: 'UE', raw };
}

function pickTrace(line, lot = null) {
  const snapshot = line.traceability_snapshot && typeof line.traceability_snapshot === 'object' ? line.traceability_snapshot : {};
  const lotTrace = lot?.traceability || {};
  return {
    lot_id: lot?.lot_id || null,
    lot_code: lot ? firstValue(lot.lot_code, lot.supplier_lot_number, snapshot.lot_code) : null,
    supplier_lot_number: lot ? firstValue(lot.supplier_lot_number, snapshot.supplier_lot_number) : null,
    dlc: lot?.dlc || snapshot.dlc || null,
    latin_name: firstValue(lotTrace.latin_name, lot?.latin_name, snapshot.latin_name, line.latin_name),
    fao_zone: firstValue(lotTrace.fao_zone, lot?.fao_zone, snapshot.fao_zone, line.fao_zone),
    sous_zone: firstValue(lotTrace.sous_zone, lot?.sous_zone, snapshot.sous_zone, line.sous_zone),
    fishing_gear: firstValue(lotTrace.fishing_gear, lot?.fishing_gear, snapshot.fishing_gear, snapshot.engin, line.fishing_gear),
    production_method: firstValue(lotTrace.production_method, lot?.production_method, snapshot.production_method, snapshot.category, line.production_method),
    allergens: firstValue(lotTrace.allergens, lot?.allergens, snapshot.allergens, snapshot.allergenes, line.allergens),
    storage_temperature_min: nullableNumber(
      lotTrace.storage_temperature_min ?? lot?.storage_temperature_min ?? snapshot.storage_temperature_min ?? line.storage_temperature_min
    ),
    storage_temperature_max: nullableNumber(
      lotTrace.storage_temperature_max ?? lot?.storage_temperature_max ?? snapshot.storage_temperature_max ?? line.storage_temperature_max
    ),
    storage_instruction: firstValue(lotTrace.storage_instruction, lot?.storage_instruction, snapshot.storage_instruction, line.storage_instruction),
    caliber: firstValue(snapshot.caliber, snapshot.calibre, line.caliber, line.calibre),
    conservation: firstValue(snapshot.conservation, snapshot.storage_conditions, line.storage_conditions),
    packaging_date: snapshot.packaging_date || snapshot.conditioning_date || line.packaging_date || null,
    origin: firstValue(lotTrace.origin_label, snapshot.origin_label, snapshot.origin, line.origin_label),
    defrosted: isDefrosted(lotTrace, lot, snapshot, line),
  };
}

function deliveredName(document, line) {
  return firstValue(
    line.delivered_client_name,
    line.delivered_client_name_snapshot,
    document.delivered_client_name,
    document.delivered_client_name_snapshot,
    document.client_name
  );
}

function deliveredStoreIdentifier(document, line) {
  return firstValue(
    line.delivered_client_store_identifier,
    line.delivered_client_store_identifier_snapshot,
    document.delivered_client_store_identifier,
    document.client_store_identifier
  );
}

function packageCountForLine(line) {
  return positiveInt(line.package_count, 0) || 1;
}

function netWeightForPackage(line) {
  const perPackage = number(line.weight_per_package, 0);
  if (perPackage > 0) return perPackage;
  const packages = packageCountForLine(line);
  const total = number(line.total_weight || line.sold_quantity, 0);
  return packages > 0 && total > 0 ? Number((total / packages).toFixed(3)) : total;
}

function isWholePackageQuantity(quantity, netWeight) {
  if (netWeight <= 0 || quantity <= 0) return false;
  const packages = quantity / netWeight;
  return Math.abs(packages - Math.round(packages)) < 0.001;
}

function buildPackagePlan(line, lots, netWeight, linePackageCount) {
  if (!lots.length) {
    return {
      assignments: Array.from({ length: linePackageCount }, () => null),
      warnings: [`missing_lot_traceability: Ligne ${line.line_number}: aucun lot associe, etiquette generee avec les donnees article/snapshot disponibles.`],
    };
  }
  if (lots.length === 1) return { assignments: Array.from({ length: linePackageCount }, () => lots[0]), warnings: [] };

  if (netWeight <= 0) {
    return {
      assignments: [],
      warnings: [`Ligne ${line.line_number}: poids par colis manquant, repartition multi-lots impossible.`],
    };
  }

  const warnings = [];
  const assignments = [];
  lots.forEach((lot) => {
    if (!isWholePackageQuantity(lot.quantity, netWeight)) {
      warnings.push(`Ligne ${line.line_number}: allocation ${lot.lot_code || lot.supplier_lot_number || lot.lot_id || 'lot'} (${formatWeight(lot.quantity)} kg) non divisible par ${formatWeight(netWeight)} kg/colis.`);
      return;
    }
    const packageCount = Math.round(lot.quantity / netWeight);
    for (let index = 0; index < packageCount; index += 1) assignments.push(lot);
  });

  if (warnings.length || assignments.length !== linePackageCount) {
    return {
      assignments: [],
      warnings: warnings.length ? warnings : [`Ligne ${line.line_number}: ${assignments.length} colis reconstruits depuis les allocations, ${linePackageCount} attendus.`],
    };
  }

  return { assignments, warnings: [] };
}

function buildHealthLabelModels({ document, lines, storeSettings, lineNumber = null, copies = null, lotId = null }) {
  const settings = storeSettings || {};
  const selectedLineNumber = lineNumber === null || lineNumber === undefined || lineNumber === '' ? null : Number(lineNumber);
  const labels = [];
  const warnings = [];

  (lines || [])
    .filter((line) => selectedLineNumber === null || Number(line.line_number) === selectedLineNumber)
    .forEach((line) => {
      const lots = normalizeLots(line.lots || line.allocations);
      const linePackageCount = packageCountForLine(line);
      const netWeight = netWeightForPackage(line);
      const plan = buildPackagePlan(line, lots, netWeight, linePackageCount);
      warnings.push(...plan.warnings);
      if (!plan.assignments.length && plan.warnings.length) return;

      const filteredAssignments = lotId
        ? plan.assignments.filter((lot) => String(lot?.lot_id || '') === String(lotId))
        : plan.assignments;
      const requestedCount = copies ? positiveInt(copies, filteredAssignments.length) : filteredAssignments.length;
      const selectedAssignments = filteredAssignments.slice(0, requestedCount);
      const clientName = deliveredName(document, line);
      const storeIdentifier = deliveredStoreIdentifier(document, line);
      const clientDisplay = [clientName, storeIdentifier ? `N° ${storeIdentifier}` : null].filter(Boolean).join(' - ');
      const healthMark = parseHealthMark(settings.sanitary_approval_number);

      selectedAssignments.forEach((assignedLot, assignmentIndex) => {
        const trace = pickTrace(line, assignedLot);
        const copyIndex = assignmentIndex + 1;
        const conditioningDate = document.document_date || null;
        labels.push({
          label_id: `${document.id || 'delivery-note'}-${line.id || line.line_number}-${copyIndex}`,
          delivery_note_id: document.id,
          delivery_note_reference: document.reference_number,
          document_date: document.document_date,
          line_id: line.id,
          line_number: line.line_number,
          copy_index: copyIndex,
          copy_count: selectedAssignments.length,
          package_count: linePackageCount,
          allocation_lot_id: assignedLot?.lot_id || null,
          printer: {
            model: 'Zebra ZT231',
            dpi: 300,
            language: 'ZPL II',
            width_mm: LABEL_WIDTH_MM,
            height_mm: LABEL_HEIGHT_MM,
            width_dots: LABEL_WIDTH_DOTS,
            height_dots: LABEL_HEIGHT_DOTS,
            visual_width_mm: LABEL_VISUAL_WIDTH_MM,
            visual_height_mm: LABEL_VISUAL_HEIGHT_MM,
            visual_width_dots: LABEL_VISUAL_WIDTH_DOTS,
            visual_height_dots: LABEL_VISUAL_HEIGHT_DOTS,
            fixed_top_zone: FIXED_TOP_ZONE,
            fixed_trace_top_zone: FIXED_TRACE_TOP_ZONE,
            main_zone: MAIN_ZONE,
            detachable_tab_physical: DETACHABLE_TAB_PHYSICAL,
            detachable_tab: DETACHABLE_TAB,
            detachable_tab_safe: DETACHABLE_TAB_SAFE,
            fixed_trace_bottom_zone: FIXED_TRACE_BOTTOM_ZONE,
            footer_zone: FOOTER_ZONE,
          },
          company: {
            name: clean(settings.company_name),
            logo_url: clean(settings.logo_url),
            address_line1: clean(settings.address_line1),
            address_line2: clean(settings.address_line2),
            postal_code: clean(settings.postal_code),
            city: clean(settings.city),
            country: clean(settings.country),
            phone: clean(settings.phone),
            email: clean(settings.email),
            sanitary_approval_number: clean(settings.sanitary_approval_number),
            health_mark: healthMark,
          },
          delivered_client_name: clientName,
          delivered_client_code: firstValue(line.delivered_client_code, document.delivered_client_code),
          delivered_client_store_identifier: storeIdentifier,
          delivered_client_display: clientDisplay,
          article_label: firstValue(line.article_label, line.article_name),
          article_plu: clean(line.article_plu),
          unit: clean(line.sale_unit) || 'kg',
          quantity: netWeight,
          net_weight: netWeight,
          net_weight_label: `${formatWeight(netWeight)} ${clean(line.sale_unit) || 'kg'}`,
          caliber: trace.caliber,
          fishing_area_label: formatFishingArea(trace.fao_zone),
          conditioning_date: conditioningDate,
          conditioning_date_label: formatDate(conditioningDate),
          allergen_label: formatAllergen(trace.allergens),
          storage_temperature_label: formatStorageTemperatureRange(trace.storage_temperature_min, trace.storage_temperature_max),
          storage_instruction_label: clean(trace.storage_instruction),
          traceability: trace,
          lots: assignedLot ? [assignedLot] : [],
          zpl: null,
        });
      });
    });

  const renderedLabels = labels.map((label) => ({ ...label, zpl: renderHealthLabelZpl(label) }));
  renderedLabels.warnings = warnings;
  return renderedLabels;
}

function zplText(value) {
  return clean(value)
    ? String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\^~]/g, ' ').replace(/[^\x20-\x7E]/g, ' ')
    : '';
}

function field(label, value) {
  const text = zplText(value);
  return text ? `${label}: ${text}` : null;
}

function visualToPrinter(x, y) {
  return { x: Math.round(y), y: Math.round(x) };
}

function zplVisualBox(x, y, width, height, thickness = 2) {
  const point = visualToPrinter(x, y);
  return `^FO${point.x},${point.y}^GB${Math.round(height)},${Math.round(width)},${thickness}^FS`;
}

function zplVisualLine(x, y, width, thickness = 2) {
  return zplVisualBox(x, y, width, thickness, thickness);
}

function zplBlock(x, y, width, fontHeight, text, maxLines = 1, align = 'L') {
  if (!clean(text)) return '';
  const point = visualToPrinter(x, y);
  return `^FO${point.x},${point.y}^A0R,${fontHeight},${Math.max(18, Math.round(fontHeight * 0.75))}^FB${width},${maxLines},4,${align},0^FD${zplText(text)}^FS\n`;
}

function inZone(zone, x, y) {
  return { x: zone.x + x, y: zone.y + y };
}

function zplZoneBlock(zone, x, y, width, fontHeight, text, maxLines = 1, align = 'L') {
  const point = inZone(zone, x, y);
  return zplBlock(point.x, point.y, width, fontHeight, text, maxLines, align);
}

function renderHealthLabelZpl(label) {
  const trace = label.traceability || {};
  const company = label.company || {};
  const lot = firstValue(trace.lot_code, trace.supplier_lot_number);
  const healthMark = company.health_mark || parseHealthMark(company.sanitary_approval_number);
  const lines = [
    '^XA',
    `^PW${LABEL_WIDTH_DOTS}`,
    `^LL${LABEL_HEIGHT_DOTS}`,
    '^CI28',
    '^LH0,0',
    zplVisualBox(MAIN_ZONE.x, MAIN_ZONE.y, MAIN_ZONE.width, MAIN_ZONE.height, 2),
  ];

  lines.push(zplZoneBlock(FIXED_TOP_ZONE, mm(1), mm(1), mm(45), 24, company.name || 'ALTA MAREE', 1));
  lines.push(zplZoneBlock(FIXED_TOP_ZONE, mm(1), mm(5), mm(62), 16, [company.address_line1, [company.postal_code, company.city].filter(Boolean).join(' ')].filter(Boolean).join(' - '), 1));
  if (healthMark) {
    const mark = visualToPrinter(FIXED_TOP_ZONE.x + mm(118), FIXED_TOP_ZONE.y + mm(1));
    lines.push(`^FO${mark.x},${mark.y}^GE${mm(7)},${mm(24)},2^FS`);
    lines.push(zplZoneBlock(FIXED_TOP_ZONE, mm(120), mm(2), mm(20), 16, healthMark.country, 1, 'C'));
    lines.push(zplZoneBlock(FIXED_TOP_ZONE, mm(119), mm(5), mm(22), 18, healthMark.approval_number, 1, 'C'));
    lines.push(zplZoneBlock(FIXED_TOP_ZONE, mm(120), mm(8), mm(20), 16, healthMark.authority, 1, 'C'));
  }

  lines.push(zplZoneBlock(FIXED_TOP_ZONE, mm(48), mm(1), mm(14), 18, 'POUR', 1));
  lines.push(zplZoneBlock(FIXED_TOP_ZONE, mm(63), mm(1), mm(52), 34, label.delivered_client_display || label.delivered_client_name || '-', 1));

  lines.push(zplZoneBlock(FIXED_TRACE_TOP_ZONE, mm(1), mm(0.5), mm(76), 24, label.article_label || '-', 2));
  lines.push(zplZoneBlock(FIXED_TRACE_TOP_ZONE, mm(1), mm(8.5), mm(76), 11, trace.latin_name, 1));
  lines.push(zplZoneBlock(FIXED_TRACE_TOP_ZONE, mm(1), mm(11.5), mm(76), 13, field('Methode', trace.production_method), 1));
  lines.push(zplZoneBlock(FIXED_TRACE_TOP_ZONE, mm(81), mm(4), mm(35), 12, field('ZONE DE PECHE', label.fishing_area_label || trace.fao_zone), 2));
  lines.push(zplZoneBlock(FIXED_TRACE_TOP_ZONE, mm(81), mm(12), mm(16), 11, field('Sous-zone', trace.sous_zone), 1));
  lines.push(zplZoneBlock(FIXED_TRACE_TOP_ZONE, mm(99), mm(12), mm(17), 11, field('Engin', trace.fishing_gear), 1));
  lines.push(zplZoneBlock(FIXED_TRACE_TOP_ZONE, mm(119), mm(1), mm(25), 11, field('Calibre', label.caliber), 1));
  lines.push(zplZoneBlock(FIXED_TRACE_TOP_ZONE, mm(119), mm(4), mm(25), 11, 'POIDS NET', 1));
  lines.push(zplZoneBlock(FIXED_TRACE_TOP_ZONE, mm(119), mm(7), mm(25), 32, label.net_weight_label, 1));

  const tab = DETACHABLE_TAB;
  const tabX = TAB_INSET;
  const tabCol1 = tabX;
  const tabCol2 = mm(40);
  const tabCol3 = mm(78);
  lines.push(zplZoneBlock(tab, tabCol1, mm(4.5), mm(36), 13, label.article_label || '-', 1));
  lines.push(zplZoneBlock(tab, tabCol1, mm(8), mm(36), 12, trace.latin_name, 1));
  lines.push(zplZoneBlock(tab, tabCol1, mm(11.5), mm(36), 12, field('Methode', trace.production_method), 1));
  lines.push(zplZoneBlock(tab, tabCol1, mm(15), mm(36), 12, field('ALLERGENE', label.allergen_label), 1));
  lines.push(zplZoneBlock(tab, tabCol2, mm(4.5), mm(36), 12, field('ZONE DE PECHE', label.fishing_area_label || trace.fao_zone), 2));
  lines.push(zplZoneBlock(tab, tabCol2, mm(12), mm(17), 12, field('Sous-zone', trace.sous_zone), 1));
  lines.push(zplZoneBlock(tab, mm(59), mm(12), mm(18), 12, field('Engin', trace.fishing_gear), 1));
  lines.push(zplZoneBlock(tab, tabCol2, mm(11.5), mm(36), 12, field('DLC/DDM', formatDate(trace.dlc)), 1));
  lines.push(zplZoneBlock(tab, mm(62), mm(4.5), mm(14), 12, field('Lot', lot), 1));
  lines.push(zplZoneBlock(tab, tabCol3, mm(4), mm(38), 12, field('DATE DE CONDITIONNEMENT', label.conditioning_date_label || formatDate(label.document_date)), 1));
  lines.push(zplZoneBlock(tab, tabCol3, mm(7.5), mm(38), 12, field('CONSERVATION', label.storage_temperature_label), 1));
  lines.push(zplZoneBlock(tab, tabCol3, mm(11), mm(38), 11, field('MENTION', label.storage_instruction_label), 1));
  if (trace.defrosted) lines.push(zplZoneBlock(tab, tabCol3, mm(14.5), mm(28), 12, 'DECONGELE', 1));

  lines.push(zplZoneBlock(FIXED_TRACE_BOTTOM_ZONE, mm(1), mm(1), mm(28), 13, field('Lot', lot), 2));
  lines.push(zplZoneBlock(FIXED_TRACE_BOTTOM_ZONE, mm(42), mm(9), mm(42), 13, field('DATE DE CONDITIONNEMENT', label.conditioning_date_label || formatDate(label.document_date)), 1));
  lines.push(zplZoneBlock(FIXED_TRACE_BOTTOM_ZONE, mm(84), mm(1), mm(28), 13, field('DLC/DDM', formatDate(trace.dlc)), 1));
  lines.push(zplZoneBlock(FIXED_TRACE_BOTTOM_ZONE, mm(116), mm(1), mm(28), 13, field('ALLERGENE', label.allergen_label), 1));
  lines.push(zplZoneBlock(FIXED_TRACE_BOTTOM_ZONE, mm(1), mm(13), mm(42), 13, field('CONSERVATION', label.storage_temperature_label), 1));
  lines.push(zplZoneBlock(FIXED_TRACE_BOTTOM_ZONE, mm(47), mm(13), mm(65), 12, field('MENTION', label.storage_instruction_label), 1));
  if (trace.defrosted) lines.push(zplZoneBlock(FIXED_TRACE_BOTTOM_ZONE, mm(116), mm(5), mm(28), 13, 'DECONGELE', 1));
  lines.push(zplZoneBlock(FOOTER_ZONE, mm(1), mm(0), mm(35), 11, `BL ${label.delivery_note_reference || ''} - L${label.line_number || ''}`, 1));
  lines.push(zplZoneBlock(FOOTER_ZONE, mm(86), mm(0), mm(58), 11, `Colis ${label.copy_index}/${label.copy_count}`, 1));
  lines.push('^XZ');

  return lines.join('\n').replace(/\n{2,}/g, '\n');
}

function combineZpl(labels) {
  return (labels || []).map((label) => label.zpl).filter(Boolean).join('\n');
}

module.exports = {
  DETACHABLE_TAB,
  DETACHABLE_TAB_PHYSICAL,
  DETACHABLE_TAB_SAFE,
  FIXED_TRACE_BOTTOM_ZONE,
  FIXED_TRACE_TOP_ZONE,
  FOOTER_ZONE,
  FIXED_TOP_ZONE,
  LABEL_DOTS: LABEL_WIDTH_DOTS,
  LABEL_HEIGHT_DOTS,
  LABEL_HEIGHT_MM,
  LABEL_VISUAL_HEIGHT_MM,
  LABEL_MM: LABEL_WIDTH_MM,
  LABEL_VISUAL_HEIGHT_DOTS,
  LABEL_VISUAL_WIDTH_DOTS,
  LABEL_VISUAL_WIDTH_MM,
  LABEL_WIDTH_DOTS,
  LABEL_WIDTH_MM,
  MAIN_ZONE,
  SAFE_MARGIN,
  TAB_BOTTOM_MARGIN_MM,
  TAB_HEIGHT_MM,
  TAB_PHYSICAL_HEIGHT_MM,
  TAB_PHYSICAL_Y_START_MM,
  TAB_SAFE_BOTTOM_MARGIN_MM,
  TAB_SAFE_HEIGHT_MM,
  TAB_SAFE_TOP_MARGIN_MM,
  TAB_SAFE_Y_START_MM,
  TAB_TOP_MARGIN_MM,
  TAB_WIDTH_MM,
  TAB_X_END_MM,
  TAB_X_START_MM,
  TAB_Y_START_MM,
  buildHealthLabelModels,
  combineZpl,
  formatAllergen,
  formatDate,
  formatFishingArea,
  formatWeight,
  parseHealthMark,
  renderHealthLabelZpl,
};
