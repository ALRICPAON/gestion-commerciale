const DOTS_PER_MM_300_DPI = 300 / 25.4;
const LABEL_MM = 100;
const LABEL_DOTS = Math.round(LABEL_MM * DOTS_PER_MM_300_DPI);

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
  if (value === true) return true;
  if (value === 1) return true;
  const text = clean(value);
  if (!text) return false;
  return ['true', '1', 'yes', 'oui', 'o', 'decongele'].includes(
    text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  );
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
  }));
}

function pickTrace(line, lots) {
  const snapshot = line.traceability_snapshot && typeof line.traceability_snapshot === 'object' ? line.traceability_snapshot : {};
  const primaryLot = lots[0] || {};
  const lotTrace = primaryLot.traceability || {};
  return {
    lot_code: firstValue(snapshot.lot_code, primaryLot.lot_code, primaryLot.supplier_lot_number),
    supplier_lot_number: firstValue(snapshot.supplier_lot_number, primaryLot.supplier_lot_number),
    dlc: snapshot.dlc || primaryLot.dlc || null,
    latin_name: firstValue(snapshot.latin_name, lotTrace.latin_name, primaryLot.latin_name, line.latin_name),
    fao_zone: firstValue(snapshot.fao_zone, lotTrace.fao_zone, primaryLot.fao_zone, line.fao_zone),
    sous_zone: firstValue(snapshot.sous_zone, lotTrace.sous_zone, primaryLot.sous_zone, line.sous_zone),
    fishing_gear: firstValue(snapshot.fishing_gear, snapshot.engin, lotTrace.fishing_gear, primaryLot.fishing_gear, line.fishing_gear),
    production_method: firstValue(snapshot.production_method, snapshot.category, lotTrace.production_method, primaryLot.production_method, line.production_method),
    allergens: firstValue(snapshot.allergens, snapshot.allergenes, lotTrace.allergens, primaryLot.allergens, line.allergens),
    caliber: firstValue(snapshot.caliber, snapshot.calibre, line.caliber, line.calibre),
    conservation: firstValue(snapshot.conservation, snapshot.storage_conditions, line.storage_conditions),
    packaging_date: snapshot.packaging_date || snapshot.conditioning_date || line.packaging_date || null,
    origin: firstValue(snapshot.origin_label, snapshot.origin, lotTrace.origin_label, line.origin_label),
    defrosted: isDefrosted(snapshot, lotTrace, line),
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

function buildHealthLabelModels({ document, lines, storeSettings, lineNumber = null, copies = null }) {
  const settings = storeSettings || {};
  const selectedLineNumber = lineNumber === null || lineNumber === undefined || lineNumber === '' ? null : Number(lineNumber);
  const labels = [];

  (lines || [])
    .filter((line) => selectedLineNumber === null || Number(line.line_number) === selectedLineNumber)
    .forEach((line) => {
      const lots = normalizeLots(line.lots || line.allocations);
      const trace = pickTrace(line, lots);
      const linePackageCount = packageCountForLine(line);
      const labelCount = copies ? positiveInt(copies, linePackageCount) : linePackageCount;
      const netWeight = netWeightForPackage(line);
      const clientName = deliveredName(document, line);
      const storeIdentifier = deliveredStoreIdentifier(document, line);
      const clientDisplay = [clientName, storeIdentifier ? `N° ${storeIdentifier}` : null].filter(Boolean).join(' - ');

      for (let index = 1; index <= labelCount; index += 1) {
        labels.push({
          label_id: `${document.id || 'delivery-note'}-${line.id || line.line_number}-${index}`,
          delivery_note_id: document.id,
          delivery_note_reference: document.reference_number,
          document_date: document.document_date,
          line_id: line.id,
          line_number: line.line_number,
          copy_index: index,
          copy_count: labelCount,
          package_count: linePackageCount,
          printer: {
            model: 'Zebra ZT231',
            dpi: 300,
            language: 'ZPL II',
            width_mm: LABEL_MM,
            height_mm: LABEL_MM,
            width_dots: LABEL_DOTS,
            height_dots: LABEL_DOTS,
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
          traceability: trace,
          lots,
          zpl: null,
        });
      }
    });

  return labels.map((label) => ({ ...label, zpl: renderHealthLabelZpl(label) }));
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

function zplBlock(x, y, width, fontHeight, text, maxLines = 1) {
  if (!clean(text)) return '';
  return `^FO${x},${y}^A0N,${fontHeight},${Math.max(18, Math.round(fontHeight * 0.75))}^FB${width},${maxLines},4,L,0^FD${zplText(text)}^FS\n`;
}

function renderHealthLabelZpl(label) {
  const trace = label.traceability || {};
  const company = label.company || {};
  const lot = firstValue(trace.lot_code, trace.supplier_lot_number);
  const approval = clean(company.sanitary_approval_number);
  const lines = [
    '^XA',
    `^PW${LABEL_DOTS}`,
    `^LL${LABEL_DOTS}`,
    '^CI28',
    '^LH0,0',
    '^FO24,24^GB1133,1133,3^FS',
    '^FO24,146^GB1133,0,3^FS',
    '^FO24,340^GB1133,0,4^FS',
    '^FO24,610^GB1133,0,2^FS',
    '^FO24,895^GB1133,0,2^FS',
  ];

  lines.push(zplBlock(54, 48, 430, 34, company.name || 'ALTA MAREE', 1));
  lines.push(zplBlock(54, 92, 430, 24, [company.address_line1, [company.postal_code, company.city].filter(Boolean).join(' ')].filter(Boolean).join(' - '), 1));
  if (approval) {
    lines.push('^FO852,38^GE230,88,3^FS');
    lines.push(zplBlock(888, 58, 160, 30, approval, 1));
  }

  lines.push(zplBlock(54, 168, 1040, 56, 'POUR', 1));
  lines.push(zplBlock(54, 224, 1040, 68, label.delivered_client_display || label.delivered_client_name || '-', 2));

  lines.push(zplBlock(54, 366, 1040, 54, label.article_label || '-', 2));
  lines.push(zplBlock(54, 474, 500, 34, field('PLU', label.article_plu), 1));
  lines.push(zplBlock(590, 452, 500, 54, `POIDS NET: ${label.net_weight_label}`, 1));
  lines.push(zplBlock(54, 536, 500, 32, field('Calibre', label.caliber), 1));
  lines.push(zplBlock(590, 532, 500, 32, field('Lot', lot), 1));

  lines.push(zplBlock(54, 638, 1040, 32, trace.latin_name, 1));
  lines.push(zplBlock(54, 684, 500, 28, field('Methode', trace.production_method), 1));
  lines.push(zplBlock(590, 684, 500, 28, field('FAO', trace.fao_zone), 1));
  lines.push(zplBlock(54, 728, 500, 28, field('Sous-zone', trace.sous_zone), 1));
  lines.push(zplBlock(590, 728, 500, 28, field('Engin', trace.fishing_gear), 1));
  lines.push(zplBlock(54, 774, 500, 28, field('DLC/DDM', formatDate(trace.dlc)), 1));
  lines.push(zplBlock(590, 774, 500, 28, field('Conditionne le', formatDate(trace.packaging_date)), 1));
  lines.push(zplBlock(54, 820, 1040, 28, field('Origine', trace.origin), 1));
  lines.push(zplBlock(54, 920, 1040, 28, field('Allergenes', trace.allergens), 1));
  if (trace.defrosted) lines.push(zplBlock(54, 968, 1040, 34, 'DECONGELE', 1));
  lines.push(zplBlock(54, 1036, 640, 26, `BL ${label.delivery_note_reference || ''} - Ligne ${label.line_number || ''}`, 1));
  lines.push(zplBlock(780, 1036, 300, 26, `Colis ${label.copy_index}/${label.copy_count}`, 1));
  lines.push('^XZ');

  return lines.join('\n').replace(/\n{2,}/g, '\n');
}

function combineZpl(labels) {
  return (labels || []).map((label) => label.zpl).filter(Boolean).join('\n');
}

module.exports = {
  LABEL_DOTS,
  LABEL_MM,
  buildHealthLabelModels,
  combineZpl,
  formatDate,
  formatWeight,
  renderHealthLabelZpl,
};
