const {
  createOrGetQualityEvent,
  createOrGetQualityEvidenceRecord,
} = require('./events');

function text(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function jsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return { ...value };
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }
  return {};
}

function jsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (error) {
      return value.trim() ? [value.trim()] : [];
    }
  }
  return [];
}

function evidenceDate(receiptDate = null) {
  if (!receiptDate) return new Date();
  const date = receiptDate instanceof Date ? receiptDate : new Date(receiptDate);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function buildReceptionEvidenceLine(line = {}) {
  const traceability = {
    latin_name: text(line.latin_name),
    production_method: text(line.production_method),
    fao_zone: text(line.fao_zone),
    sous_zone: text(line.sous_zone),
    fishing_gear: text(line.fishing_gear),
    origin_label: text(line.origin_label),
    allergens: text(line.allergens),
  };
  return {
    purchase_line_id: line.id,
    line_number: line.line_number,
    article_id: line.article_id,
    article_plu: text(line.plu || line.article_plu),
    article_designation: text(line.designation || line.article_name || line.supplier_label),
    supplier_reference: text(line.supplier_reference),
    supplier_label: text(line.supplier_label),
    price_unit: text(line.price_unit),
    received_colis: numberOrNull(line.received_colis),
    received_pieces: numberOrNull(line.received_pieces),
    received_quantity: numberOrNull(line.received_quantity),
    stock_quantity: numberOrNull(line.stock_quantity),
    unit_price_ex_vat: numberOrNull(line.unit_price_ex_vat),
    line_amount_ex_vat: numberOrNull(line.line_amount_ex_vat),
    lot_id: line.lot_id,
    lot_code: text(line.lot_code),
    supplier_lot_number: text(line.supplier_lot_number),
    dlc: line.dlc || null,
    sanitary_photo_url: text(line.sanitary_photo_url),
    sanitary_photo_urls: jsonArray(line.sanitary_photo_urls),
    traceability,
  };
}

function buildReceptionEvidencePayload({
  purchase,
  supplier = null,
  lines = [],
  userId = null,
  receiptDate = null,
  receivedAt = new Date(),
} = {}) {
  return {
    record_type: 'purchase_reception',
    record_version: 1,
    identification: {
      purchase_id: purchase.id,
      purchase_type: text(purchase.purchase_type),
      purchase_date: purchase.purchase_date || null,
      receipt_date: receiptDate || purchase.receipt_date || null,
      received_at: receivedAt instanceof Date ? receivedAt.toISOString() : receivedAt,
      validated_by: userId,
      store_id: purchase.store_id,
      supplier_id: purchase.supplier_id,
      supplier_code: text(supplier?.code),
      supplier_name: text(supplier?.name || purchase.supplier_name),
      bl_number: text(purchase.bl_number),
      invoice_number: text(purchase.invoice_number),
      source_document_url: text(purchase.source_document_url),
      source_document_original_name: text(purchase.source_document_original_name),
      source_document_mime_type: text(purchase.source_document_mime_type),
    },
    received_products: lines.map(buildReceptionEvidenceLine),
    documents: {
      purchase_document_url: text(purchase.source_document_url),
      purchase_document_original_name: text(purchase.source_document_original_name),
      sanitary_photo_urls: [
        ...new Set(lines.flatMap((line) => jsonArray(line.sanitary_photo_urls).concat(text(line.sanitary_photo_url)).filter(Boolean))),
      ],
    },
    controls: {
      temperature: { status: 'not_available_in_purchase_reception_flow' },
      freshness: { status: 'not_available_in_purchase_reception_flow' },
      packaging: { status: 'not_available_in_purchase_reception_flow' },
      label_conformity: { status: 'not_available_in_purchase_reception_flow' },
      observations: { status: 'partial', value: text(purchase.notes) },
    },
  };
}

function buildReceptionEventPayload({ purchase, supplier = null, lines = [] } = {}) {
  return {
    purchase_id: purchase.id,
    purchase_type: text(purchase.purchase_type),
    supplier_id: purchase.supplier_id,
    supplier_code: text(supplier?.code),
    supplier_name: text(supplier?.name || purchase.supplier_name),
    bl_number: text(purchase.bl_number),
    receipt_date: purchase.receipt_date || null,
    source_document_url: text(purchase.source_document_url),
    line_count: lines.length,
    received_line_ids: lines.map((line) => line.id).filter(Boolean),
  };
}

async function createReceptionQualityEvidence({
  db,
  purchase,
  supplier = null,
  lines = [],
  userId = null,
  receiptDate = null,
  receivedAt = new Date(),
} = {}) {
  const eventResult = await createOrGetQualityEvent({
    db,
    storeId: purchase.store_id,
    eventType: 'purchase_received',
    sourceTable: 'purchases',
    sourceId: purchase.id,
    occurredAt: evidenceDate(receivedAt),
    triggeredBy: userId,
    userId,
    payloadVersion: 1,
    payload: buildReceptionEventPayload({ purchase, supplier, lines }),
  });

  const evidenceResult = await createOrGetQualityEvidenceRecord({
    db,
    storeId: purchase.store_id,
    qualityEventId: eventResult.event.id,
    evidenceType: 'reception_record',
    evidenceStatus: 'recorded',
    evidenceAt: evidenceDate(receivedAt),
    recordedBy: userId,
    sourceType: 'automatic',
    sourceRecordType: 'purchases',
    sourceRecordId: purchase.id,
    sourceDiscriminator: 'reception_record',
    userId,
    payloadVersion: 1,
    payload: buildReceptionEvidencePayload({
      purchase,
      supplier,
      lines,
      userId,
      receiptDate,
      receivedAt,
    }),
  });

  return {
    event: eventResult.event,
    eventCreated: eventResult.created,
    evidence: evidenceResult.evidence,
    evidenceCreated: evidenceResult.created,
  };
}

module.exports = {
  buildReceptionEventPayload,
  buildReceptionEvidencePayload,
  buildReceptionEvidenceLine,
  createReceptionQualityEvidence,
  jsonObject,
};
