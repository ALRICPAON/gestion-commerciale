const {
  createOrGetQualityEvent,
  createOrGetQualityEvidenceRecord,
} = require('./events');

const RESULTS = new Set(['conform', 'non_conform']);

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function makeError(message, status = 400, code = null) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function normalizeTraceability(row = {}) {
  return {
    latin_name: row.latin_name || null,
    fao_zone: row.fao_zone || null,
    sous_zone: row.sous_zone || null,
    fishing_gear: row.fishing_gear || null,
    production_method: row.production_method || null,
    origin_label: row.origin_label || null,
    allergens: row.allergens || null,
  };
}

function mapLot(row = {}) {
  return {
    lot_id: row.lot_id,
    lot_code: row.lot_code || null,
    supplier_lot_number: row.supplier_lot_number || null,
    source_type: row.source_type || null,
    qty_initial: toNumber(row.qty_initial),
    qty_remaining: toNumber(row.qty_remaining),
    dlc: row.dlc || null,
    created_at: row.created_at || null,
  };
}

function mapArticle(row = {}) {
  return {
    article_id: row.article_id || null,
    plu: row.article_plu || null,
    designation: row.article_label || null,
    unit: row.article_unit || null,
    family_name: row.family_name || null,
  };
}

function mapUpstream(row = {}) {
  return {
    supplier_id: row.supplier_id || null,
    supplier_code: row.supplier_code || null,
    supplier_name: row.supplier_name || null,
    purchase_id: row.purchase_id || null,
    purchase_line_id: row.purchase_line_id || null,
    purchase_date: row.purchase_date || null,
    receipt_date: row.receipt_date || null,
    bl_number: row.bl_number || null,
    invoice_number: row.invoice_number || null,
    purchase_line_number: row.purchase_line_number || null,
    supplier_reference: row.supplier_reference || null,
    supplier_label: row.supplier_label || null,
    received_quantity: toNumber(row.qty_initial),
    traceability: normalizeTraceability(row),
  };
}

function lotSelectSql() {
  return `
    SELECT
      l.id AS lot_id,
      l.lot_code,
      l.supplier_lot_number,
      l.source_type,
      l.qty_initial,
      l.qty_remaining,
      l.dlc,
      l.created_at,
      l.article_id,
      a.plu AS article_plu,
      a.designation AS article_label,
      a.unit AS article_unit,
      a.family_name,
      l.purchase_id,
      l.purchase_line_id,
      p.purchase_date,
      p.receipt_date,
      p.bl_number,
      p.invoice_number,
      pl.line_number AS purchase_line_number,
      pl.supplier_reference,
      pl.supplier_label,
      l.supplier_id,
      s.code AS supplier_code,
      s.name AS supplier_name,
      COALESCE(plm.latin_name, l.traceability_data->>'latin_name', a.latin_name) AS latin_name,
      COALESCE(plm.fao_zone, l.traceability_data->>'fao_zone', a.fao_zone) AS fao_zone,
      COALESCE(plm.sous_zone, l.traceability_data->>'sous_zone', a.sous_zone) AS sous_zone,
      COALESCE(plm.fishing_gear, l.traceability_data->>'fishing_gear', a.fishing_gear) AS fishing_gear,
      COALESCE(plm.production_method, l.traceability_data->>'production_method', a.production_method) AS production_method,
      COALESCE(plm.origin_label, l.traceability_data->>'origin_label') AS origin_label,
      COALESCE(plm.allergens, l.traceability_data->>'allergens', a.allergens) AS allergens
    FROM lots l
    JOIN articles a ON a.id = l.article_id AND a.store_id = l.store_id
    LEFT JOIN suppliers s ON s.id = l.supplier_id AND s.store_id = l.store_id
    LEFT JOIN purchases p ON p.id = l.purchase_id AND p.store_id = l.store_id
    LEFT JOIN purchase_lines pl ON pl.id = l.purchase_line_id AND pl.store_id = l.store_id
    LEFT JOIN LATERAL (
      SELECT
        (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.latin_name, '') ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST), NULL))[1] AS latin_name,
        (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.fao_zone, '') ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST), NULL))[1] AS fao_zone,
        (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.sous_zone, '') ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST), NULL))[1] AS sous_zone,
        (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.fishing_gear, '') ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST), NULL))[1] AS fishing_gear,
        (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.production_method, '') ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST), NULL))[1] AS production_method,
        (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.origin_label, '') ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST), NULL))[1] AS origin_label,
        (ARRAY_REMOVE(ARRAY_AGG(NULLIF(m.allergens, '') ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST), NULL))[1] AS allergens
      FROM purchase_line_metadata m
      WHERE m.purchase_line_id = l.purchase_line_id
    ) plm ON true
    WHERE l.store_id = $1::uuid
      AND l.id = $2::uuid
    LIMIT 1`;
}

async function fetchLotSnapshot(db, storeId, lotId) {
  const result = await db.query(lotSelectSql(), [storeId, lotId]);
  return result.rows[0] || null;
}

async function fetchDeliveredClients(db, storeId, lotId) {
  const result = await db.query(
    `SELECT
       sd.id AS delivery_note_id,
       sd.reference_number AS delivery_note_reference,
       sd.document_date AS delivery_note_date,
       sd.document_type,
       COALESCE(sl.delivered_client_id, sd.client_id) AS delivered_client_id,
       COALESCE(sl.delivered_client_name_snapshot, sd.delivered_client_name_snapshot, delivered.name) AS delivered_client_name,
       COALESCE(sl.delivered_client_code_snapshot, sd.delivered_client_code_snapshot, delivered.code) AS delivered_client_code,
       COALESCE(sl.delivered_client_store_identifier_snapshot, sd.delivered_client_store_identifier, delivered.store_identifier) AS delivered_store_identifier,
       billed.id AS billed_client_id,
       COALESCE(sd.billed_client_name_snapshot, billed.name) AS billed_client_name,
       COALESCE(sd.billed_client_code_snapshot, billed.code) AS billed_client_code,
       SUM(sla.quantity) AS delivered_quantity,
       MIN(sla.created_at) AS allocated_at
     FROM sale_line_allocations sla
     JOIN sales_lines sl ON sl.id = sla.sales_line_id AND sl.store_id = $1::uuid
     JOIN sales_documents sd ON sd.id = sl.sales_document_id AND sd.store_id = sl.store_id
     LEFT JOIN clients delivered ON delivered.id = COALESCE(sl.delivered_client_id, sd.client_id) AND delivered.store_id = sd.store_id
     LEFT JOIN clients billed ON billed.id = COALESCE(sd.billed_client_id, delivered.billed_client_id, sd.client_id) AND billed.store_id = sd.store_id
     WHERE sla.lot_id = $2::uuid
       AND sd.store_id = $1::uuid
     GROUP BY
       sd.id,
       sd.reference_number,
       sd.document_date,
       sd.document_type,
       sd.client_id,
       sl.delivered_client_id,
       sl.delivered_client_name_snapshot,
       sl.delivered_client_code_snapshot,
       sl.delivered_client_store_identifier_snapshot,
       sd.delivered_client_name_snapshot,
       sd.delivered_client_code_snapshot,
       sd.delivered_client_store_identifier,
       sd.billed_client_name_snapshot,
       sd.billed_client_code_snapshot,
       delivered.id,
       delivered.name,
       delivered.code,
       delivered.store_identifier,
       billed.id,
       billed.name,
       billed.code
     ORDER BY sd.document_date ASC, sd.reference_number ASC NULLS LAST`,
    [storeId, lotId]
  );
  return result.rows.map((row) => ({
    delivery_note_id: row.delivery_note_id,
    delivery_note_reference: row.delivery_note_reference || null,
    delivery_note_date: row.delivery_note_date || null,
    document_type: row.document_type || null,
    delivered_client_id: row.delivered_client_id || null,
    delivered_client_name: row.delivered_client_name || null,
    delivered_client_code: row.delivered_client_code || null,
    delivered_store_identifier: row.delivered_store_identifier || null,
    billed_client_id: row.billed_client_id || null,
    billed_client_name: row.billed_client_name || null,
    billed_client_code: row.billed_client_code || null,
    delivered_quantity: toNumber(row.delivered_quantity),
    allocated_at: row.allocated_at || null,
  }));
}

async function fetchTransformations(db, storeId, lotId) {
  const result = await db.query(
    `SELECT
       sm.id AS movement_id,
       sm.movement_type,
       sm.quantity,
       sm.source_table,
       sm.source_id,
       sm.notes,
       sm.created_at
     FROM stock_movements sm
     WHERE sm.store_id = $1::uuid
       AND sm.lot_id = $2::uuid
       AND sm.movement_type IN ('transformation_in', 'transformation_out', 'fabrication_in', 'fabrication_out')
     ORDER BY sm.created_at ASC, sm.id ASC`,
    [storeId, lotId]
  );
  return result.rows.map((row) => ({
    movement_id: row.movement_id,
    movement_type: row.movement_type,
    quantity: toNumber(row.quantity),
    source_table: row.source_table || null,
    source_id: row.source_id || null,
    notes: row.notes || null,
    created_at: row.created_at || null,
  }));
}

function buildSummary({ lot, downstream, transformations }) {
  return {
    stock_initial: toNumber(lot.qty_initial),
    stock_remaining: toNumber(lot.qty_remaining),
    clients_delivered_count: new Set(downstream.map((row) => row.delivered_client_id).filter(Boolean)).size,
    delivery_notes_count: downstream.length,
    delivered_quantity: downstream.reduce((sum, row) => sum + toNumber(row.delivered_quantity), 0),
    transformations_count: transformations.length,
  };
}

async function buildTraceabilityTestSnapshot({ db, storeId, lotId } = {}) {
  if (!db || typeof db.query !== 'function') throw makeError('Connexion base invalide', 500, 'INVALID_DB');
  if (!isUuid(storeId)) throw makeError('Magasin invalide', 400, 'INVALID_STORE');
  if (!isUuid(lotId)) throw makeError('ID lot invalide', 400, 'INVALID_LOT');

  const lotRow = await fetchLotSnapshot(db, storeId, lotId);
  if (!lotRow) throw makeError('Lot introuvable pour ce magasin', 404, 'LOT_NOT_FOUND');

  const [downstream, transformations] = await Promise.all([
    fetchDeliveredClients(db, storeId, lotId),
    fetchTransformations(db, storeId, lotId),
  ]);

  const lot = mapLot(lotRow);
  const article = mapArticle(lotRow);
  return {
    lot,
    article,
    upstream: mapUpstream(lotRow),
    transformations,
    downstream,
    summary: buildSummary({ lot, downstream, transformations }),
  };
}

async function searchTraceabilityTestLots({ db, storeId, search = null, limit = 20 } = {}) {
  if (!db || typeof db.query !== 'function') throw makeError('Connexion base invalide', 500, 'INVALID_DB');
  if (!isUuid(storeId)) throw makeError('Magasin invalide', 400, 'INVALID_STORE');
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const term = clean(search);
  const params = [storeId];
  let where = 'l.store_id = $1::uuid';
  if (term) {
    params.push(`%${term}%`);
    where += ` AND (
      l.lot_code ILIKE $2
      OR COALESCE(l.supplier_lot_number, '') ILIKE $2
      OR COALESCE(a.plu, '') ILIKE $2
      OR COALESCE(a.designation, '') ILIKE $2
    )`;
  }
  params.push(safeLimit);
  const result = await db.query(
    `SELECT
       l.id AS lot_id,
       l.lot_code,
       l.supplier_lot_number,
       l.qty_initial,
       l.qty_remaining,
       COALESCE(p.receipt_date, p.purchase_date, l.created_at::date) AS receipt_date,
       a.plu AS article_plu,
       a.designation AS article_label,
       s.name AS supplier_name
     FROM lots l
     JOIN articles a ON a.id = l.article_id AND a.store_id = l.store_id
     LEFT JOIN purchases p ON p.id = l.purchase_id AND p.store_id = l.store_id
     LEFT JOIN suppliers s ON s.id = l.supplier_id AND s.store_id = l.store_id
     WHERE ${where}
     ORDER BY COALESCE(p.receipt_date, p.purchase_date, l.created_at::date) DESC NULLS LAST, l.created_at DESC, l.id DESC
     LIMIT $${params.length}::integer`,
    params
  );
  return result.rows.map((row) => ({
    lot_id: row.lot_id,
    lot_code: row.lot_code || null,
    supplier_lot_number: row.supplier_lot_number || null,
    qty_initial: toNumber(row.qty_initial),
    qty_remaining: toNumber(row.qty_remaining),
    receipt_date: row.receipt_date || null,
    article_plu: row.article_plu || null,
    article_label: row.article_label || null,
    supplier_name: row.supplier_name || null,
  }));
}

function validateCompletion({ result, observation, correctiveAction }) {
  const normalizedResult = clean(result);
  const normalizedObservation = clean(observation);
  const normalizedCorrectiveAction = clean(correctiveAction);
  if (!RESULTS.has(normalizedResult)) throw makeError('Resultat du test obligatoire', 400, 'TRACEABILITY_TEST_RESULT_REQUIRED');
  if (normalizedResult === 'non_conform' && !normalizedObservation) {
    throw makeError('Observation obligatoire pour un test non conforme', 400, 'TRACEABILITY_TEST_OBSERVATION_REQUIRED');
  }
  if (normalizedResult === 'non_conform' && !normalizedCorrectiveAction) {
    throw makeError('Action corrective obligatoire pour un test non conforme', 400, 'TRACEABILITY_TEST_CORRECTIVE_ACTION_REQUIRED');
  }
  return {
    result: normalizedResult,
    observation: normalizedObservation,
    corrective_action: normalizedResult === 'non_conform' ? normalizedCorrectiveAction : normalizedCorrectiveAction,
  };
}

async function completeTraceabilityTest({
  db,
  storeId,
  lotId,
  userId,
  result,
  observation,
  correctiveAction,
  startedAt,
  completedAt = new Date(),
} = {}) {
  if (!isUuid(userId)) throw makeError('Utilisateur invalide', 400, 'INVALID_USER');
  const normalized = validateCompletion({ result, observation, correctiveAction });
  const started = startedAt ? new Date(startedAt) : new Date();
  const completed = completedAt instanceof Date ? completedAt : new Date(completedAt);
  if (Number.isNaN(started.getTime())) throw makeError('Date de debut invalide', 400, 'INVALID_STARTED_AT');
  if (Number.isNaN(completed.getTime())) throw makeError('Date de fin invalide', 400, 'INVALID_COMPLETED_AT');
  if (started.getTime() > completed.getTime()) {
    throw makeError('Date de debut posterieure a la validation', 400, 'STARTED_AT_AFTER_COMPLETED_AT');
  }
  const durationSeconds = Math.max(0, Math.round((completed.getTime() - started.getTime()) / 1000));
  const testIdResult = await db.query('SELECT gen_random_uuid() AS id');
  const testId = testIdResult.rows[0].id;
  const snapshot = await buildTraceabilityTestSnapshot({ db, storeId, lotId });
  const payload = {
    test_id: testId,
    lot: snapshot.lot,
    article: snapshot.article,
    started_at: toIso(started),
    completed_at: toIso(completed),
    duration_seconds: durationSeconds,
    result: normalized.result,
    observation: normalized.observation,
    corrective_action: normalized.corrective_action,
    upstream: snapshot.upstream,
    transformations: snapshot.transformations,
    downstream: snapshot.downstream,
    summary: snapshot.summary,
  };

  const eventResult = await createOrGetQualityEvent({
    db,
    storeId,
    eventType: 'traceability_test_completed',
    sourceTable: 'lots',
    sourceId: lotId,
    sourceDiscriminator: `traceability-test-${testId}`,
    occurredAt: completed,
    triggeredBy: userId,
    eventStatus: 'recorded',
    payloadVersion: 1,
    payload,
    userId,
  });
  const evidenceResult = await createOrGetQualityEvidenceRecord({
    db,
    storeId,
    qualityEventId: eventResult.event.id,
    evidenceType: 'traceability_test_record',
    evidenceStatus: 'recorded',
    evidenceAt: completed,
    recordedBy: userId,
    sourceType: 'human',
    sourceRecordType: 'lots',
    sourceRecordId: lotId,
    sourceDiscriminator: `traceability-test-${testId}`,
    payloadVersion: 1,
    payload,
    userId,
  });

  return {
    ok: true,
    test_id: testId,
    snapshot,
    quality_event: eventResult.event,
    quality_evidence_record: evidenceResult.evidence,
  };
}

module.exports = {
  RESULTS,
  buildTraceabilityTestSnapshot,
  completeTraceabilityTest,
  searchTraceabilityTestLots,
  validateCompletion,
};
