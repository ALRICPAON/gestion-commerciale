function normalizeText(raw) {
  return String(raw || '')
    .replace(/[\u00A0\u202F\u2009\u2002\u2003]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(raw) {
  if (raw === undefined || raw === null || raw === '') return 0;
  let s = String(raw).trim();
  s = s.replace(/[\u00A0\u202F\u2009\u2002\u2003]/g, ' ');
  s = s.replace(/\s+/g, '').replace(/€/g, '');
  if (s.includes('.') && s.includes(',')) {
    s = s.indexOf('.') < s.indexOf(',') ? s.replace(/\./g, '').replace(/,/g, '.') : s.replace(/,/g, '');
  } else if (s.includes(',') && !s.includes('.')) {
    s = s.replace(/,/g, '.');
  }
  s = s.replace(/[^\d.\-]/g, '');
  const value = Number.parseFloat(s);
  return Number.isFinite(value) ? value : 0;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
}

function parseDate(raw) {
  const match = String(raw || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function splitLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
}

function findDesignation(lines, ref) {
  const index = lines.findIndex((line) => line === ref);
  if (index === -1) return '';
  return lines[index + 1] || '';
}

function parseHeader(text) {
  const normalized = normalizeText(text);
  const invoiceNumber = normalized.match(/\b(551\d{9})\b/)?.[1] || null;
  const customerCode = normalized.match(/\b(C\d{7})\b/)?.[1] || null;
  const blNumber = normalized.match(/BL\s*N[°º]?\s*([0-9-]+)\s+du/i)?.[1] || null;
  const invoiceDate = invoiceNumber
    ? parseDate(normalized.match(new RegExp(`${invoiceNumber}\\s+(\\d{2}\\/\\d{2}\\/\\d{4})`))?.[1])
    : null;
  const dueDate = parseDate(normalized.match(/30\s+Jours\s+Date\s+Facture\s+(\d{2}\/\d{2}\/\d{4})/i)?.[1]);
  const productTotal = parseNumber(normalized.match(/TOTAL\s+\d+\s+colis\s+pour\s+[\d,.]+\s+([\d,.]+)\s*€/i)?.[1]);
  const vat = normalized.match(/\b(5,5|5\.5)\s+([\d,.]+)\s*€\s+([\d,.]+)\s*€/i);
  const totalIncVat = parseNumber(normalized.match(/Montant\s+TTC\s+([\d,.]+)\s*€/i)?.[1]);

  return {
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    due_date: dueDate,
    supplier_code: '10002',
    supplier_name: 'DISTRIMER',
    customer_code: customerCode,
    supplier_invoice_bl_number: blNumber,
    product_total_ex_vat: productTotal,
    total_ex_vat: productTotal,
    vat_rate: vat ? parseNumber(vat[1]) : 0,
    vat_amount: vat ? parseNumber(vat[3]) : 0,
    total_inc_vat: totalIncVat,
  };
}

function parseLines(text) {
  const lines = splitLines(text);
  const normalized = normalizeText(text);
  const refs = ['LANGGL304', 'LANGV2535', 'LANGV510/'];
  const numericGroups = [...normalized.matchAll(/(\d+)\s+(\d+[,.]\d{2})\s+(\d+[,.]\d{2})\s+KG\s+(\d{8,})\s+([\d,.]+)\s*€\s+([\d,.]+)\s*€\s+1/g)];

  return refs.map((ref, index) => {
    const group = numericGroups[index];
    if (!group) return null;
    const orderedColis = parseNumber(group[1]);
    const unitWeight = parseNumber(group[2]);
    const quantityKg = parseNumber(group[3]);
    const lineAmount = parseNumber(group[6]);
    const vatRate = 5.5;
    const vatAmount = round(lineAmount * vatRate / 100, 2);

    return {
      supplier_reference: ref,
      supplier_label: findDesignation(lines, ref),
      designation: findDesignation(lines, ref),
      quantity: quantityKg,
      quantity_kg: quantityKg,
      colis: orderedColis,
      ordered_colis: orderedColis,
      price_unit: 'kg',
      unit_price_ex_vat: parseNumber(group[5]),
      line_amount_ex_vat: lineAmount,
      vat_rate: vatRate,
      vat_amount: vatAmount,
      line_amount_inc_vat: round(lineAmount + vatAmount, 2),
      parsed_payload: {
        unit_weight_kg: unitWeight,
        supplier_lot_number: group[4],
      },
    };
  }).filter(Boolean);
}

function canParse(document) {
  const text = document?.text || '';
  return /DISTRIMER\s+SAS/i.test(text) && /FACTURE/i.test(text) && /\b551\d{9}\b/.test(text);
}

async function parse(document) {
  if (!canParse(document)) return null;
  const header = parseHeader(document.text);
  const lines = parseLines(document.text);

  return {
    parser: 'distrimer',
    message: 'Facture Distrimer lue automatiquement',
    ...header,
    lines,
    parsed_payload: {
      parser: 'distrimer',
      original_name: document.originalName || null,
      customer_code: header.customer_code,
      supplier_invoice_bl_number: header.supplier_invoice_bl_number,
    },
  };
}

module.exports = {
  canParse,
  parse,
};
