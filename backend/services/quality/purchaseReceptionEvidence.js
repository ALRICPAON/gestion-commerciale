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

const CONTROL_STATUSES = new Set(['conform', 'non_conform']);
const OVERALL_STATUSES = new Set(['conform', 'non_conform']);
const CORRECTIVE_ACTIONS = new Set(['supplier_return', 'lot_isolation', 'accepted_with_reservation', 'destruction', 'other']);

function evidenceDate(receiptDate = null) {
  if (!receiptDate) return new Date();
  const date = receiptDate instanceof Date ? receiptDate : new Date(receiptDate);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function qualityControlError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function normalizeControlStatus(raw, field) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw qualityControlError(`Controle qualite manquant pour ${field}`);
  }
  const status = text(raw.status);
  if (!CONTROL_STATUSES.has(status)) {
    throw qualityControlError(`Statut qualite invalide pour ${field}`);
  }
  return status;
}

function normalizeReceptionQualityControl(input, { required = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    if (required) throw qualityControlError('Controle qualite reception obligatoire');
    return null;
  }

  const overallStatus = text(input.overall_status);
  if (!OVERALL_STATUSES.has(overallStatus)) {
    throw qualityControlError('Statut global qualite invalide');
  }

  const temperatureStatus = normalizeControlStatus(input.temperature, 'temperature');
  const temperatureValue = numberOrNull(input.temperature?.value_c);
  if (input.temperature?.value_c !== undefined && input.temperature?.value_c !== null && input.temperature?.value_c !== '' && temperatureValue === null) {
    throw qualityControlError('Temperature mesuree invalide');
  }

  const freshnessStatus = normalizeControlStatus(input.freshness, 'freshness');
  const packagingStatus = normalizeControlStatus(input.packaging, 'packaging');
  const labelStatus = normalizeControlStatus(input.label_conformity, 'label_conformity');
  const observation = text(input.observation);
  const correctiveAction = text(input.corrective_action);
  const correctiveActionComment = text(input.corrective_action_comment);

  if (overallStatus === 'non_conform') {
    if (!observation) throw qualityControlError('Observation obligatoire pour une reception non conforme');
    if (!correctiveAction || !CORRECTIVE_ACTIONS.has(correctiveAction)) {
      throw qualityControlError('Action corrective obligatoire pour une reception non conforme');
    }
    if (correctiveAction === 'other' && !correctiveActionComment) {
      throw qualityControlError('Commentaire obligatoire pour une action corrective Autre');
    }
  } else if (correctiveAction && !CORRECTIVE_ACTIONS.has(correctiveAction)) {
    throw qualityControlError('Action corrective invalide');
  }

  return {
    overall_status: overallStatus,
    temperature: {
      status: temperatureStatus,
      value_c: temperatureValue,
    },
    freshness: { status: freshnessStatus },
    packaging: { status: packagingStatus },
    label_conformity: { status: labelStatus },
    observation: overallStatus === 'non_conform' ? observation : null,
    corrective_action: overallStatus === 'non_conform' ? correctiveAction : null,
    corrective_action_comment: overallStatus === 'non_conform' ? correctiveActionComment : null,
  };
}

function fallbackReceptionControls(purchase) {
  return {
    temperature: { status: 'not_available_in_purchase_reception_flow' },
    freshness: { status: 'not_available_in_purchase_reception_flow' },
    packaging: { status: 'not_available_in_purchase_reception_flow' },
    label_conformity: { status: 'not_available_in_purchase_reception_flow' },
    observations: { status: 'partial', value: text(purchase.notes) },
  };
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
  qualityControl = null,
} = {}) {
  const normalizedQualityControl = normalizeReceptionQualityControl(qualityControl);
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
    controls: normalizedQualityControl || fallbackReceptionControls(purchase),
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
  qualityControl = null,
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
      qualityControl,
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
  normalizeReceptionQualityControl,
};
