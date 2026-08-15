const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

const EVENT_STATUSES = Object.freeze(['recorded', 'processed', 'ignored', 'failed', 'archived']);
const EVIDENCE_STATUSES = Object.freeze(['draft', 'recorded', 'validated', 'rejected', 'archived']);
const EVIDENCE_SOURCE_TYPES = Object.freeze(['human', 'automatic', 'import', 'agent', 'system']);

function text(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
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

function positiveInteger(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function requiredText(value, message) {
  const normalized = text(value);
  if (normalized) return normalized;
  const err = new Error(message);
  err.status = 400;
  throw err;
}

function enumValue(value, allowed, fallback, message) {
  const normalized = text(value, fallback);
  if (allowed.includes(normalized)) return normalized;
  const err = new Error(message);
  err.status = 400;
  throw err;
}

function normalizeDate(value, fallback = new Date()) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isNaN(date.getTime())) return date;
  const err = new Error('Date qualite invalide');
  err.status = 400;
  throw err;
}

function normalizeEventPayload(input = {}) {
  return {
    storeId: requiredText(input.storeId || input.store_id, 'Magasin obligatoire'),
    eventType: requiredText(input.eventType || input.event_type, 'Type evenement qualite obligatoire'),
    sourceTable: requiredText(input.sourceTable || input.source_table, 'Table source obligatoire'),
    sourceId: requiredText(input.sourceId || input.source_id, 'Identifiant source obligatoire'),
    sourceLineId: text(input.sourceLineId || input.source_line_id),
    sourceDiscriminator: text(input.sourceDiscriminator || input.source_discriminator, ''),
    occurredAt: normalizeDate(input.occurredAt || input.occurred_at || new Date()),
    triggeredBy: text(input.triggeredBy || input.triggered_by || input.userId || input.user_id),
    eventStatus: enumValue(
      input.eventStatus || input.event_status,
      EVENT_STATUSES,
      'recorded',
      'Statut evenement qualite invalide'
    ),
    payloadVersion: positiveInteger(input.payloadVersion || input.payload_version, 1),
    payload: jsonObject(input.payload),
    userId: text(input.userId || input.user_id || input.triggeredBy || input.triggered_by),
  };
}

function normalizeEvidencePayload(input = {}) {
  return {
    storeId: requiredText(input.storeId || input.store_id, 'Magasin obligatoire'),
    qualityEventId: text(input.qualityEventId || input.quality_event_id),
    evidenceType: requiredText(input.evidenceType || input.evidence_type, 'Type preuve qualite obligatoire'),
    evidenceReference: text(input.evidenceReference || input.evidence_reference),
    evidenceStatus: enumValue(
      input.evidenceStatus || input.evidence_status,
      EVIDENCE_STATUSES,
      'recorded',
      'Statut preuve qualite invalide'
    ),
    evidenceAt: normalizeDate(input.evidenceAt || input.evidence_at || new Date()),
    recordedBy: text(input.recordedBy || input.recorded_by || input.userId || input.user_id),
    sourceType: enumValue(
      input.sourceType || input.source_type,
      EVIDENCE_SOURCE_TYPES,
      'human',
      'Source preuve qualite invalide'
    ),
    sourceRecordType: text(input.sourceRecordType || input.source_record_type),
    sourceRecordId: text(input.sourceRecordId || input.source_record_id),
    qualityTaskId: text(input.qualityTaskId || input.quality_task_id),
    occurrenceId: text(input.occurrenceId || input.occurrence_id),
    nonConformityId: text(input.nonConformityId || input.non_conformity_id),
    documentId: text(input.documentId || input.document_id),
    photoId: text(input.photoId || input.photo_id),
    masterDocumentId: text(input.masterDocumentId || input.master_document_id),
    payloadVersion: positiveInteger(input.payloadVersion || input.payload_version, 1),
    payload: jsonObject(input.payload),
    userId: text(input.userId || input.user_id || input.recordedBy || input.recorded_by),
  };
}

function assertDb(db) {
  if (!db?.query) {
    const err = new Error('Client base de donnees obligatoire');
    err.status = 500;
    throw err;
  }
}

function mapDbError(err) {
  if (err?.code === '23503') {
    err.status = 400;
    err.publicMessage = 'Reference qualite invalide pour ce magasin';
  }
  if (err?.code === '23505') {
    err.status = 409;
    err.publicMessage = 'Evenement qualite deja enregistre';
  }
  return err;
}

async function getQualityEventById({ db, storeId, eventId } = {}) {
  assertDb(db);
  const result = await db.query(
    `SELECT *
     FROM quality_events
     WHERE id = $1::uuid
       AND store_id = $2::uuid
       AND archived_at IS NULL
     LIMIT 1`,
    [eventId, storeId]
  );
  return result.rows[0] || null;
}

async function createOrGetQualityEvent(input = {}) {
  const db = input.db;
  assertDb(db);
  const event = normalizeEventPayload(input);

  try {
    const inserted = await db.query(
      `INSERT INTO quality_events (
        store_id, event_type, source_table, source_id, source_line_id,
        source_discriminator, occurred_at, triggered_by, event_status,
        payload_version, payload, created_by, updated_by
      ) VALUES (
        $1::uuid, $2::text, $3::text, $4::uuid, $5::uuid,
        $6::text, $7::timestamptz, $8::uuid, $9::text,
        $10::integer, $11::jsonb, $12::uuid, $12::uuid
      )
      ON CONFLICT (
        store_id,
        event_type,
        source_table,
        source_id,
        COALESCE(source_line_id, '00000000-0000-0000-0000-000000000000'::uuid),
        source_discriminator
      )
      WHERE archived_at IS NULL
      DO NOTHING
      RETURNING *`,
      [
        event.storeId,
        event.eventType,
        event.sourceTable,
        event.sourceId,
        event.sourceLineId,
        event.sourceDiscriminator,
        event.occurredAt,
        event.triggeredBy,
        event.eventStatus,
        event.payloadVersion,
        event.payload,
        event.userId,
      ]
    );

    if (inserted.rows[0]) return { event: inserted.rows[0], created: true };

    const existing = await db.query(
      `SELECT *
       FROM quality_events
       WHERE store_id = $1::uuid
         AND event_type = $2::text
         AND source_table = $3::text
         AND source_id = $4::uuid
         AND COALESCE(source_line_id, $7::uuid) = COALESCE($5::uuid, $7::uuid)
         AND source_discriminator = $6::text
         AND archived_at IS NULL
       LIMIT 1`,
      [
        event.storeId,
        event.eventType,
        event.sourceTable,
        event.sourceId,
        event.sourceLineId,
        event.sourceDiscriminator,
        ZERO_UUID,
      ]
    );
    return { event: existing.rows[0] || null, created: false };
  } catch (err) {
    throw mapDbError(err);
  }
}

async function createQualityEvidenceRecord(input = {}) {
  const db = input.db;
  assertDb(db);
  const evidence = normalizeEvidencePayload(input);

  if (evidence.qualityEventId) {
    const linkedEvent = await getQualityEventById({
      db,
      storeId: evidence.storeId,
      eventId: evidence.qualityEventId,
    });
    if (!linkedEvent) {
      const err = new Error('Evenement qualite introuvable pour ce magasin');
      err.status = 400;
      throw err;
    }
  }

  try {
    const result = await db.query(
      `INSERT INTO quality_evidence_records (
        store_id, quality_event_id, evidence_type, evidence_reference,
        evidence_status, evidence_at, recorded_by, source_type,
        source_record_type, source_record_id, quality_task_id, occurrence_id,
        non_conformity_id, document_id, photo_id, master_document_id,
        payload_version, payload, created_by, updated_by
      ) VALUES (
        $1::uuid, $2::uuid, $3::text, $4::text,
        $5::text, $6::timestamptz, $7::uuid, $8::text,
        $9::text, $10::uuid, $11::uuid, $12::uuid,
        $13::uuid, $14::uuid, $15::uuid, $16::uuid,
        $17::integer, $18::jsonb, $19::uuid, $19::uuid
      )
      RETURNING *`,
      [
        evidence.storeId,
        evidence.qualityEventId,
        evidence.evidenceType,
        evidence.evidenceReference,
        evidence.evidenceStatus,
        evidence.evidenceAt,
        evidence.recordedBy,
        evidence.sourceType,
        evidence.sourceRecordType,
        evidence.sourceRecordId,
        evidence.qualityTaskId,
        evidence.occurrenceId,
        evidence.nonConformityId,
        evidence.documentId,
        evidence.photoId,
        evidence.masterDocumentId,
        evidence.payloadVersion,
        evidence.payload,
        evidence.userId,
      ]
    );
    return result.rows[0] || null;
  } catch (err) {
    throw mapDbError(err);
  }
}

async function listEvidenceForEvent({ db, storeId, eventId } = {}) {
  assertDb(db);
  const result = await db.query(
    `SELECT *
     FROM quality_evidence_records
     WHERE store_id = $1::uuid
       AND quality_event_id = $2::uuid
       AND archived_at IS NULL
     ORDER BY evidence_at DESC, recorded_at DESC, created_at DESC`,
    [storeId, eventId]
  );
  return result.rows;
}

module.exports = {
  EVENT_STATUSES,
  EVIDENCE_STATUSES,
  EVIDENCE_SOURCE_TYPES,
  createOrGetQualityEvent,
  createQualityEvidenceRecord,
  getQualityEventById,
  listEvidenceForEvent,
  normalizeEventPayload,
  normalizeEvidencePayload,
};
