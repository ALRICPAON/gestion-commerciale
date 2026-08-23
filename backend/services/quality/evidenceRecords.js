const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const EVIDENCE_TYPE_LABELS = Object.freeze({
  reception_record: 'Reception fournisseur',
  traceability_test_record: 'Test de tracabilite',
});

const EVIDENCE_STATUS_LABELS = Object.freeze({
  draft: 'Brouillon',
  recorded: 'Enregistre',
  validated: 'Valide',
  rejected: 'Rejete',
  archived: 'Archive',
});

function text(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function jsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
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

function limit(value) {
  const parsed = Number(value);
  return Math.min(Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_LIMIT, MAX_LIMIT);
}

function offset(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function humanizeCode(value) {
  return text(value, '-')
    .split(/[_:.-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function evidenceTypeLabel(type) {
  return EVIDENCE_TYPE_LABELS[type] || humanizeCode(type);
}

function evidenceStatusLabel(status) {
  return EVIDENCE_STATUS_LABELS[status] || humanizeCode(status);
}

function firstProductSummary(products = []) {
  const product = Array.isArray(products) ? products[0] : null;
  if (!product) return null;
  const label = product.article_designation || product.supplier_label || product.article_plu || product.supplier_reference;
  const quantity = product.received_quantity ?? product.stock_quantity;
  const unit = product.price_unit === 'piece' ? 'piece(s)' : product.price_unit === 'colis' ? 'colis' : 'kg';
  return [label, quantity !== null && quantity !== undefined ? `${quantity} ${unit}` : null].filter(Boolean).join(' - ');
}

function evidenceReference(row, payload) {
  const identification = jsonObject(payload.identification);
  if (row.evidence_type === 'traceability_test_record') {
    return text(jsonObject(payload.lot).lot_code) || text(row.evidence_reference) || 'Test de tracabilite';
  }
  return text(row.evidence_reference)
    || text(identification.supplier_name)
    || text(identification.bl_number)
    || text(row.source_record_type)
    || text(row.source_table)
    || '-';
}

function evidenceOrigin(row, payload) {
  const identification = jsonObject(payload.identification);
  if (row.evidence_type === 'reception_record') return 'Achat / reception';
  if (row.evidence_type === 'traceability_test_record') return 'Tracabilite';
  return text(identification.record_type) || text(row.source_record_type) || text(row.event_type) || '-';
}

function evidenceSummary(row, payload) {
  if (row.evidence_type === 'traceability_test_record') {
    const lot = jsonObject(payload.lot);
    const article = jsonObject(payload.article);
    const result = payload.result === 'non_conform' ? 'Non conforme' : payload.result === 'conform' ? 'Conforme' : null;
    return [
      article.designation || article.plu,
      lot.lot_code,
      result,
      payload.duration_seconds !== undefined && payload.duration_seconds !== null ? `${payload.duration_seconds} s` : null,
    ].filter(Boolean).join(' - ') || 'Test de tracabilite';
  }
  if (row.evidence_type === 'reception_record') {
    return firstProductSummary(payload.received_products) || text(jsonObject(payload.identification).bl_number) || 'Reception fournisseur';
  }
  return text(row.evidence_reference) || text(row.source_record_type) || evidenceTypeLabel(row.evidence_type);
}

function publicEvidence(row) {
  const payload = jsonObject(row.payload);
  return {
    ...row,
    payload,
    type_label: evidenceTypeLabel(row.evidence_type),
    status_label: evidenceStatusLabel(row.evidence_status),
    reference_label: evidenceReference(row, payload),
    origin_label: evidenceOrigin(row, payload),
    summary_label: evidenceSummary(row, payload),
  };
}

function receptionLotIds(payload = {}) {
  const products = Array.isArray(payload.received_products) ? payload.received_products : [];
  return [...new Set(products.map((product) => text(product.lot_id)).filter(Boolean))];
}

async function listReceptionDownstreamDeliveries(db, storeId, payload = {}) {
  const lotIds = receptionLotIds(payload);
  if (!lotIds.length) return [];

  const result = await db.query(
    `SELECT
       l.lot_code,
       l.supplier_lot_number,
       sd.reference_number AS delivery_note_reference,
       sd.document_date AS delivery_date,
       COALESCE(sl.delivered_client_name_snapshot, sd.delivered_client_name_snapshot, delivered.name) AS delivered_client_name,
       COALESCE(sl.delivered_client_code_snapshot, sd.delivered_client_code_snapshot, delivered.code) AS delivered_client_code,
       COALESCE(sl.delivered_client_store_identifier_snapshot, sd.delivered_client_store_identifier, delivered.store_identifier) AS delivered_client_store_identifier,
       SUM(sla.quantity)::numeric AS delivered_quantity
     FROM sale_line_allocations sla
     JOIN sales_lines sl
       ON sl.id = sla.sales_line_id
      AND sl.store_id = $1::uuid
     JOIN sales_documents sd
       ON sd.id = sl.sales_document_id
      AND sd.store_id = sl.store_id
      AND sd.document_type = 'DELIVERY_NOTE'
     LEFT JOIN clients delivered
       ON delivered.id = COALESCE(sl.delivered_client_id, sd.client_id)
      AND delivered.store_id = sd.store_id
     LEFT JOIN lots l
       ON l.id = sla.lot_id
      AND l.store_id = sd.store_id
     WHERE sla.lot_id = ANY($2::uuid[])
     GROUP BY
       l.lot_code,
       l.supplier_lot_number,
       sd.reference_number,
       sd.document_date,
       COALESCE(sl.delivered_client_name_snapshot, sd.delivered_client_name_snapshot, delivered.name),
       COALESCE(sl.delivered_client_code_snapshot, sd.delivered_client_code_snapshot, delivered.code),
       COALESCE(sl.delivered_client_store_identifier_snapshot, sd.delivered_client_store_identifier, delivered.store_identifier)
     ORDER BY sd.document_date ASC NULLS LAST, sd.reference_number ASC NULLS LAST, delivered_client_name ASC NULLS LAST, l.lot_code ASC NULLS LAST`,
    [storeId, lotIds]
  );

  return result.rows.map((row) => ({
    delivery_note_reference: text(row.delivery_note_reference),
    delivery_date: row.delivery_date || null,
    delivered_client_name: text(row.delivered_client_name),
    delivered_client_code: text(row.delivered_client_code),
    delivered_client_store_identifier: text(row.delivered_client_store_identifier),
    lot_code: text(row.lot_code),
    supplier_lot_number: text(row.supplier_lot_number),
    delivered_quantity: row.delivered_quantity === undefined || row.delivered_quantity === null ? null : Number(row.delivered_quantity),
  }));
}

async function enrichReceptionLinkedDocuments(db, storeId, record) {
  if (!record || record.evidence_type !== 'reception_record') return record;
  const payload = jsonObject(record.payload);
  const identification = jsonObject(payload.identification);
  const downstream = await listReceptionDownstreamDeliveries(db, storeId, payload);
  return {
    ...record,
    payload: {
      ...payload,
      linked_documents: {
        ...jsonObject(payload.linked_documents),
        supplier_delivery_note: text(identification.bl_number),
        downstream_delivery_notes: downstream,
      },
    },
  };
}

function addFilter(where, params, value, sql) {
  if (value !== undefined && value !== null && value !== '') {
    params.push(value);
    where.push(sql(params.length));
  }
}

async function listQualityEvidenceRecords(db, storeId, query = {}) {
  const params = [storeId];
  const where = ['er.store_id = $1::uuid', 'er.archived_at IS NULL'];

  addFilter(where, params, query.evidence_type, (i) => `er.evidence_type = $${i}::text`);
  addFilter(where, params, query.status || query.evidence_status, (i) => `er.evidence_status = $${i}::text`);
  addFilter(where, params, query.date_from || query.start_date, (i) => `er.evidence_at >= $${i}::date`);
  addFilter(where, params, query.date_to || query.end_date, (i) => `er.evidence_at < ($${i}::date + INTERVAL '1 day')`);
  if (query.search) {
    params.push(`%${String(query.search).trim()}%`);
    where.push(`(
      er.evidence_reference ILIKE $${params.length}
      OR er.evidence_type ILIKE $${params.length}
      OR er.source_record_type ILIKE $${params.length}
      OR qe.event_type ILIKE $${params.length}
      OR er.payload::text ILIKE $${params.length}
    )`);
  }

  params.push(limit(query.limit));
  const limitIndex = params.length;
  params.push(offset(query.offset));
  const offsetIndex = params.length;

  const result = await db.query(
    `SELECT er.*,
            qe.event_type,
            qe.source_table,
            qe.source_id,
            qe.occurred_at,
            u.email AS recorded_by_email
     FROM quality_evidence_records er
     LEFT JOIN quality_events qe
       ON qe.id = er.quality_event_id
      AND qe.store_id = er.store_id
     LEFT JOIN users u
       ON u.id = er.recorded_by
      AND u.store_id = er.store_id
     WHERE ${where.join(' AND ')}
     ORDER BY er.evidence_at DESC, er.recorded_at DESC, er.created_at DESC
     LIMIT $${limitIndex}::integer OFFSET $${offsetIndex}::integer`,
    params
  );
  return result.rows.map(publicEvidence);
}

async function getQualityEvidenceRecord(db, storeId, evidenceId) {
  const result = await db.query(
    `SELECT er.*,
            qe.event_type,
            qe.source_table,
            qe.source_id,
            qe.occurred_at,
            u.email AS recorded_by_email
     FROM quality_evidence_records er
     LEFT JOIN quality_events qe
       ON qe.id = er.quality_event_id
      AND qe.store_id = er.store_id
     LEFT JOIN users u
       ON u.id = er.recorded_by
      AND u.store_id = er.store_id
     WHERE er.id = $1::uuid
       AND er.store_id = $2::uuid
       AND er.archived_at IS NULL
     LIMIT 1`,
    [evidenceId, storeId]
  );
  if (!result.rows[0]) return null;
  return enrichReceptionLinkedDocuments(db, storeId, publicEvidence(result.rows[0]));
}

module.exports = {
  EVIDENCE_STATUS_LABELS,
  EVIDENCE_TYPE_LABELS,
  evidenceStatusLabel,
  evidenceTypeLabel,
  enrichReceptionLinkedDocuments,
  getQualityEvidenceRecord,
  listReceptionDownstreamDeliveries,
  listQualityEvidenceRecords,
  publicEvidence,
  receptionLotIds,
};
