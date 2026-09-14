const TRANSPORT_COMPONENT_REFERENCES = {
  base_transport: 'TRANSPORT',
  fuel_surcharge: 'CARBURANT',
  admin_fee: 'ADMIN',
  logistics_service: 'SERVICES',
};

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeMetaValue(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return {};
  }
}

function transportReference(line) {
  const meta = normalizeMetaValue(line.transport_component_meta_value ?? line.meta_value);
  const componentCode = meta.component_code || line.transport_component_code;
  return TRANSPORT_COMPONENT_REFERENCES[componentCode] || null;
}

function purchaseLineDisplayReference(line) {
  return (!line.article_id ? transportReference(line) : null)
    || line.article_plu
    || line.article_code
    || line.plu
    || line.supplier_reference
    || null;
}

function purchaseLineDisplayLabel(line) {
  return line.article_name
    || line.article_designation
    || line.designation
    || line.supplier_label
    || null;
}

function sanitizePurchaseLineForDisplay(line, sanitizeLine) {
  const sanitized = typeof sanitizeLine === 'function' ? sanitizeLine(line) : { ...line };
  return {
    ...sanitized,
    article_plu: purchaseLineDisplayReference(sanitized),
    article_name: purchaseLineDisplayLabel(sanitized),
    is_service_line: !sanitized.article_id,
  };
}

function sumPurchaseLinesExVat(lines) {
  return Number((Array.isArray(lines) ? lines : []).reduce((sum, line) => (
    sum + number(line.line_amount_ex_vat)
  ), 0).toFixed(4));
}

module.exports = {
  purchaseLineDisplayLabel,
  purchaseLineDisplayReference,
  sanitizePurchaseLineForDisplay,
  sumPurchaseLinesExVat,
};
