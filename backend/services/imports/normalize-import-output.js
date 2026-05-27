function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeLine(line) {
  return {
    supplier_reference: line.supplier_reference || null,
    supplier_label: line.supplier_label || null,
    article_plu: line.article_plu || null,
    designation: line.designation || null,
    latin_name: line.latin_name || null,
    fao_zone: line.fao_zone || null,
    sous_zone: line.sous_zone || null,
    fishing_gear: line.fishing_gear || null,
    origin_label: line.origin_label || null,
    line_kind: line.line_kind || null,
    needs_mapping: line.needs_mapping === true,
    allergens: line.allergens || null,
    ordered_colis: toNumberOrNull(line.ordered_colis),
    ordered_pieces: toNumberOrNull(line.ordered_pieces),
    ordered_quantity: toNumberOrNull(line.ordered_quantity),
    unit_price_ex_vat: toNumberOrNull(line.unit_price_ex_vat),
    price_unit: line.price_unit || "kg",
    line_amount_ex_vat: toNumberOrNull(line.line_amount_ex_vat),
    supplier_lot_number: line.supplier_lot_number || null,
    dlc: line.dlc || null,
  };
}

function normalizeImportOutput(raw) {
  return {
    supplier_code: raw?.supplier_code || null,
    supplier_name: raw?.supplier_name || null,
    purchase_type: raw?.purchase_type || "direct_bl",
    document_type: raw?.document_type || "supplier_bl",
    lines: Array.isArray(raw?.lines) ? raw.lines.map(normalizeLine) : [],
    warnings: Array.isArray(raw?.warnings) ? raw.warnings : [],
    meta: raw?.meta || {},
  };
}

module.exports = normalizeImportOutput;