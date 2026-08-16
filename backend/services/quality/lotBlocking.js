const BLOCKED_CODE = 'LOT_QUALITY_BLOCKED';
const STATUS_AVAILABLE = 'available';
const STATUS_BLOCKED = 'blocked';

function clean(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function availableLotCondition(alias = 'l') {
  return `COALESCE(${alias}.quality_status, '${STATUS_AVAILABLE}') <> '${STATUS_BLOCKED}'`;
}

function lotBlockedError(lot = {}) {
  const error = new Error('Lot bloque pour non-conformite qualite');
  error.status = 409;
  error.code = BLOCKED_CODE;
  error.details = {
    lot_id: lot.id || lot.lot_id || null,
    lot_code: lot.lot_code || null,
    motif: lot.quality_block_reason || lot.quality_block_reason_type || null,
    quality_non_conformity_id: lot.quality_non_conformity_id || null,
  };
  return error;
}

function isLotBlocked(lot = {}) {
  return clean(lot.quality_status, STATUS_AVAILABLE) === STATUS_BLOCKED;
}

function assertLotRowUsable(lot = {}) {
  if (isLotBlocked(lot)) throw lotBlockedError(lot);
  return lot;
}

async function getLotQualityStatus(db, storeId, lotId) {
  const result = await db.query(
    `SELECT id, store_id, lot_code, quality_status, quality_block_reason,
            quality_block_reason_type, quality_block_comment, quality_blocked_at,
            quality_blocked_by, quality_released_at, quality_released_by,
            quality_non_conformity_id
     FROM lots
     WHERE id = $1::uuid AND store_id = $2::uuid
     LIMIT 1`,
    [lotId, storeId]
  );
  return result.rows[0] || null;
}

async function assertLotUsable(db, storeId, lotId) {
  if (!lotId) return null;
  const lot = await getLotQualityStatus(db, storeId, lotId);
  if (!lot) return null;
  return assertLotRowUsable(lot);
}

async function insertHistory(db, {
  storeId,
  lotId,
  previousStatus,
  newStatus,
  reasonType = null,
  reason = null,
  comment = null,
  sourceType = null,
  sourceId = null,
  qualityNonConformityId = null,
  userId = null,
}) {
  const result = await db.query(
    `INSERT INTO quality_lot_status_history (
      store_id, lot_id, previous_status, new_status, reason_type, reason, comment,
      source_type, source_id, quality_non_conformity_id, changed_by
    ) VALUES ($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::uuid,$10::uuid,$11::uuid)
    RETURNING *`,
    [storeId, lotId, previousStatus, newStatus, reasonType, reason, comment, sourceType, sourceId, qualityNonConformityId, userId]
  );
  return result.rows[0];
}

async function blockLotForQuality(db, {
  storeId,
  lotId,
  userId,
  reason,
  reasonType,
  comment = null,
  sourceType = 'traceability_manual',
  sourceId = null,
  qualityNonConformityId = null,
}) {
  const before = await getLotQualityStatus(db, storeId, lotId);
  if (!before) {
    const error = new Error('Lot introuvable pour ce magasin');
    error.status = 404;
    throw error;
  }

  const result = await db.query(
    `UPDATE lots
     SET quality_status = 'blocked',
         quality_block_reason = $3::text,
         quality_block_reason_type = $4::text,
         quality_block_comment = $5::text,
         quality_blocked_at = COALESCE(quality_blocked_at, now()),
         quality_blocked_by = COALESCE(quality_blocked_by, $6::uuid),
         quality_released_at = NULL,
         quality_released_by = NULL,
         quality_release_reason = NULL,
         quality_release_comment = NULL,
         quality_non_conformity_id = COALESCE($7::uuid, quality_non_conformity_id),
         updated_at = now()
     WHERE id = $1::uuid AND store_id = $2::uuid
     RETURNING *`,
    [lotId, storeId, reason, reasonType, comment, userId, qualityNonConformityId]
  );

  const lot = result.rows[0];
  const history = await insertHistory(db, {
    storeId,
    lotId,
    previousStatus: before.quality_status || STATUS_AVAILABLE,
    newStatus: STATUS_BLOCKED,
    reasonType,
    reason,
    comment,
    sourceType,
    sourceId,
    qualityNonConformityId,
    userId,
  });
  return { lot, history };
}

async function releaseLotForQuality(db, {
  storeId,
  lotId,
  userId,
  reason,
  comment,
  sourceType = 'traceability_manual_release',
  sourceId = null,
}) {
  if (!clean(reason) || !clean(comment)) {
    const error = new Error('Motif et commentaire obligatoires pour liberer un lot');
    error.status = 400;
    throw error;
  }

  const before = await getLotQualityStatus(db, storeId, lotId);
  if (!before) {
    const error = new Error('Lot introuvable pour ce magasin');
    error.status = 404;
    throw error;
  }

  const result = await db.query(
    `UPDATE lots
     SET quality_status = 'available',
         quality_released_at = now(),
         quality_released_by = $3::uuid,
         quality_release_reason = $4::text,
         quality_release_comment = $5::text,
         updated_at = now()
     WHERE id = $1::uuid AND store_id = $2::uuid
     RETURNING *`,
    [lotId, storeId, userId, reason, comment]
  );

  const lot = result.rows[0];
  const history = await insertHistory(db, {
    storeId,
    lotId,
    previousStatus: before.quality_status || STATUS_AVAILABLE,
    newStatus: STATUS_AVAILABLE,
    reasonType: 'release',
    reason,
    comment,
    sourceType,
    sourceId,
    qualityNonConformityId: before.quality_non_conformity_id || null,
    userId,
  });
  return { lot, history };
}

function errorBody(error, fallback = 'Erreur blocage qualite lot') {
  return {
    error: error.message || fallback,
    ...(error.code ? { code: error.code } : {}),
    ...(error.details ? { details: error.details } : {}),
  };
}

module.exports = {
  BLOCKED_CODE,
  STATUS_AVAILABLE,
  STATUS_BLOCKED,
  assertLotRowUsable,
  assertLotUsable,
  availableLotCondition,
  blockLotForQuality,
  errorBody,
  getLotQualityStatus,
  isLotBlocked,
  lotBlockedError,
  releaseLotForQuality,
};
