const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const EVIDENCE_TYPE_LABELS = Object.freeze({
  reception_record: 'Reception fournisseur',
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
  return text(identification.record_type) || text(row.source_record_type) || text(row.event_type) || '-';
}

function evidenceSummary(row, payload) {
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
  return result.rows[0] ? publicEvidence(result.rows[0]) : null;
}

module.exports = {
  EVIDENCE_STATUS_LABELS,
  EVIDENCE_TYPE_LABELS,
  evidenceStatusLabel,
  evidenceTypeLabel,
  getQualityEvidenceRecord,
  listQualityEvidenceRecords,
  publicEvidence,
};
