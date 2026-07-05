const { logQualityEvent } = require('./eventLogger');

function dbError(err, message) {
  if (err && err.code === '23503') {
    err.status = 400;
    err.publicMessage = message;
  }
  return err;
}

function addFilter(where, params, value, sql) {
  if (value !== undefined && value !== null && value !== '') {
    params.push(value);
    where.push(sql(params.length));
  }
}

async function logEvent(db, storeId, actorId, eventType, targetType, targetId, before, after) {
  await logQualityEvent({ dbPool: db, storeId, actorId, eventType, targetType, targetId, before, after });
}

async function listTemperatureTypes(db) {
  const result = await db.query(
    `SELECT code, label, default_unit, category, is_active
     FROM quality_temperature_types
     WHERE is_active = true
     ORDER BY label ASC`
  );
  return result.rows;
}

async function listTemperatureLimits(db, storeId, query = {}) {
  const params = [storeId];
  const where = ['l.store_id = $1'];
  addFilter(where, params, query.type || query.type_code, (i) => `l.type_code = $${i}`);
  addFilter(where, params, query.zone_id, (i) => `l.zone_id = $${i}`);
  addFilter(where, params, query.equipment_id, (i) => `l.equipment_id = $${i}`);
  if (query.active_only !== 'false') where.push('l.is_active = true');
  const result = await db.query(
    `SELECT l.*, t.label AS type_label, z.name AS zone_name, e.name AS equipment_name,
            lr.id AS last_record_id, lr.recorded_at AS last_recorded_at, lr.value AS last_value,
            lr.unit AS last_unit, lr.alert_status AS last_alert_status,
            CASE
              WHEN l.expected_frequency_value IS NULL OR lr.recorded_at IS NULL THEN NULL
              WHEN l.expected_frequency_unit = 'hours' THEN lr.recorded_at + (l.expected_frequency_value || ' hours')::interval
              WHEN l.expected_frequency_unit = 'days' THEN lr.recorded_at + (l.expected_frequency_value || ' days')::interval
              ELSE NULL
            END AS next_expected_at,
            CASE
              WHEN l.is_active = false THEN 'inactive'
              WHEN lr.id IS NULL THEN 'missing'
              WHEN l.expected_frequency_value IS NOT NULL
                AND l.expected_frequency_unit IN ('hours', 'days')
                AND (
                  CASE
                    WHEN l.expected_frequency_unit = 'hours' THEN lr.recorded_at + (l.expected_frequency_value || ' hours')::interval
                    WHEN l.expected_frequency_unit = 'days' THEN lr.recorded_at + (l.expected_frequency_value || ' days')::interval
                  END
                ) < now() THEN 'missing'
              WHEN lr.alert_status = 'out_of_limits' THEN 'out_of_limits'
              WHEN lr.alert_status = 'warning' THEN 'warning'
              ELSE 'compliant'
            END AS followup_status
     FROM quality_temperature_limits l
     INNER JOIN quality_temperature_types t ON t.code = l.type_code
     LEFT JOIN quality_zones z ON z.id = l.zone_id AND z.store_id = l.store_id
     LEFT JOIN quality_equipments e ON e.id = l.equipment_id AND e.store_id = l.store_id
     LEFT JOIN LATERAL (
       SELECT r.*
       FROM quality_temperature_records r
       WHERE r.store_id = l.store_id
         AND r.type_code = l.type_code
         AND r.deleted_at IS NULL
         AND (l.zone_id IS NULL OR r.zone_id = l.zone_id)
         AND (l.equipment_id IS NULL OR r.equipment_id = l.equipment_id)
       ORDER BY r.recorded_at DESC
       LIMIT 1
     ) lr ON true
     WHERE ${where.join(' AND ')}
     ORDER BY l.is_active DESC, t.label ASC, z.name ASC, e.name ASC, l.created_at DESC`,
    params
  );
  return result.rows;
}

async function getTemperatureLimit(db, storeId, limitId) {
  const result = await db.query('SELECT * FROM quality_temperature_limits WHERE id = $1 AND store_id = $2 LIMIT 1', [limitId, storeId]);
  return result.rows[0] || null;
}

async function saveTemperatureLimit(db, storeId, userId, payload, limitId = null) {
  const before = limitId ? await getTemperatureLimit(db, storeId, limitId) : null;
  if (limitId && !before) return null;
  try {
    const result = limitId
      ? await db.query(
        `UPDATE quality_temperature_limits
         SET type_code=$3, zone_id=$4, equipment_id=$5, min_value=$6, max_value=$7, unit=$8,
             expected_frequency_value=$9, expected_frequency_unit=$10, target_time=$11,
             is_active=$12, valid_from=$13, valid_until=$14, updated_by=$15, updated_at=now()
         WHERE id=$1 AND store_id=$2
         RETURNING *`,
        [limitId, storeId, payload.type_code, payload.zone_id, payload.equipment_id, payload.min_value, payload.max_value, payload.unit, payload.expected_frequency_value, payload.expected_frequency_unit, payload.target_time, payload.is_active, payload.valid_from, payload.valid_until, userId]
      )
      : await db.query(
        `INSERT INTO quality_temperature_limits (
          store_id, type_code, zone_id, equipment_id, min_value, max_value, unit,
          expected_frequency_value, expected_frequency_unit, target_time,
          is_active, valid_from, valid_until, created_by, updated_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
        RETURNING *`,
        [storeId, payload.type_code, payload.zone_id, payload.equipment_id, payload.min_value, payload.max_value, payload.unit, payload.expected_frequency_value, payload.expected_frequency_unit, payload.target_time, payload.is_active, payload.valid_from, payload.valid_until, userId]
      );
    await logEvent(db, storeId, userId, limitId ? 'quality.temperature.limit.updated' : 'quality.temperature.limit.created', 'quality_temperature_limit', result.rows[0].id, before, result.rows[0]);
    return result.rows[0];
  } catch (err) {
    throw dbError(err, 'Référence zone, équipement ou type de température invalide');
  }
}

async function deleteTemperatureLimit(db, storeId, userId, limitId) {
  const before = await getTemperatureLimit(db, storeId, limitId);
  if (!before) return null;
  const result = await db.query(
    `UPDATE quality_temperature_limits
     SET is_active=false, updated_by=$3, updated_at=now()
     WHERE id=$1 AND store_id=$2
     RETURNING *`,
    [limitId, storeId, userId]
  );
  await logEvent(db, storeId, userId, 'quality.temperature.limit.archived', 'quality_temperature_limit', limitId, before, result.rows[0]);
  return result.rows[0];
}

async function findApplicableLimit(db, storeId, payload) {
  const result = await db.query(
    `SELECT *
     FROM quality_temperature_limits
     WHERE store_id = $1
       AND type_code = $2
       AND is_active = true
       AND valid_from <= ($3::timestamptz)::date
       AND (valid_until IS NULL OR valid_until >= ($3::timestamptz)::date)
       AND (equipment_id IS NULL OR equipment_id = $4)
       AND (zone_id IS NULL OR zone_id = $5)
     ORDER BY CASE WHEN equipment_id = $4 THEN 0 WHEN zone_id = $5 THEN 1 ELSE 2 END, created_at DESC
     LIMIT 1`,
    [storeId, payload.type_code, payload.recorded_at, payload.equipment_id, payload.zone_id]
  );
  return result.rows[0] || null;
}

function evaluateAlert(value, limit) {
  if (!limit) return { alert_status: 'warning', alert_reason: 'Aucune limite configurée', min_limit: null, max_limit: null };
  const below = limit.min_value !== null && Number(value) < Number(limit.min_value);
  const above = limit.max_value !== null && Number(value) > Number(limit.max_value);
  if (below || above) {
    return {
      alert_status: 'out_of_limits',
      alert_reason: below ? 'Température sous la limite minimale' : 'Température au-dessus de la limite maximale',
      min_limit: limit.min_value,
      max_limit: limit.max_value,
    };
  }
  return { alert_status: 'compliant', alert_reason: null, min_limit: limit.min_value, max_limit: limit.max_value };
}

async function listTemperatureRecords(db, storeId, query = {}) {
  const params = [storeId];
  const where = ['r.store_id = $1', 'r.deleted_at IS NULL'];
  addFilter(where, params, query.type || query.type_code, (i) => `r.type_code = $${i}`);
  addFilter(where, params, query.zone_id, (i) => `r.zone_id = $${i}`);
  addFilter(where, params, query.equipment_id, (i) => `r.equipment_id = $${i}`);
  addFilter(where, params, query.alert || query.alert_status, (i) => `r.alert_status = $${i}`);
  addFilter(where, params, query.operator_user_id || query.operator, (i) => `r.operator_user_id = $${i}`);
  addFilter(where, params, query.source, (i) => `r.source = $${i}`);
  addFilter(where, params, query.start_date, (i) => `r.recorded_at >= $${i}::timestamptz`);
  addFilter(where, params, query.end_date, (i) => `r.recorded_at <= $${i}::timestamptz`);
  if (query.search && String(query.search).trim()) {
    params.push(`%${String(query.search).trim()}%`);
    where.push(`(COALESCE(r.comment, '') ILIKE $${params.length} OR COALESCE(z.name, '') ILIKE $${params.length} OR COALESCE(e.name, '') ILIKE $${params.length})`);
  }
  const result = await db.query(
    `SELECT r.*, t.label AS type_label, z.name AS zone_name, z.code AS zone_code,
            e.name AS equipment_name, e.code AS equipment_code, u.email AS operator_email
     FROM quality_temperature_records r
     INNER JOIN quality_temperature_types t ON t.code = r.type_code
     LEFT JOIN quality_zones z ON z.id = r.zone_id AND z.store_id = r.store_id
     LEFT JOIN quality_equipments e ON e.id = r.equipment_id AND e.store_id = r.store_id
     LEFT JOIN users u ON u.id = r.operator_user_id
     WHERE ${where.join(' AND ')}
     ORDER BY r.recorded_at DESC, r.created_at DESC
     LIMIT 500`,
    params
  );
  return result.rows;
}

async function getTemperatureRecord(db, storeId, recordId) {
  const result = await db.query(
    `SELECT r.*, t.label AS type_label, z.name AS zone_name, e.name AS equipment_name
     FROM quality_temperature_records r
     INNER JOIN quality_temperature_types t ON t.code = r.type_code
     LEFT JOIN quality_zones z ON z.id = r.zone_id AND z.store_id = r.store_id
     LEFT JOIN quality_equipments e ON e.id = r.equipment_id AND e.store_id = r.store_id
     WHERE r.id = $1 AND r.store_id = $2 LIMIT 1`,
    [recordId, storeId]
  );
  return result.rows[0] || null;
}

async function saveTemperatureRecord(db, storeId, userId, payload, recordId = null) {
  const before = recordId ? await getTemperatureRecord(db, storeId, recordId) : null;
  if (recordId && (!before || before.deleted_at)) return null;
  const limit = await findApplicableLimit(db, storeId, payload);
  const alert = evaluateAlert(payload.value, limit);
  try {
    const result = recordId
      ? await db.query(
        `UPDATE quality_temperature_records
         SET zone_id=$3, equipment_id=$4, type_code=$5, value=$6, unit=$7, recorded_at=$8,
             source=$9, operator_user_id=$10, comment=$11, evidence_photo_id=$12, evidence_document_id=$13,
             min_limit=$14, max_limit=$15, alert_status=$16, alert_reason=$17,
             updated_by=$18, updated_at=now()
         WHERE id=$1 AND store_id=$2 AND deleted_at IS NULL
         RETURNING *`,
        [recordId, storeId, payload.zone_id, payload.equipment_id, payload.type_code, payload.value, payload.unit, payload.recorded_at, payload.source, payload.operator_user_id || userId, payload.comment, payload.evidence_photo_id, payload.evidence_document_id, alert.min_limit, alert.max_limit, alert.alert_status, alert.alert_reason, userId]
      )
      : await db.query(
        `INSERT INTO quality_temperature_records (
          store_id, zone_id, equipment_id, type_code, value, unit, recorded_at, source,
          operator_user_id, comment, evidence_photo_id, evidence_document_id,
          min_limit, max_limit, alert_status, alert_reason, created_by, updated_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)
        RETURNING *`,
        [storeId, payload.zone_id, payload.equipment_id, payload.type_code, payload.value, payload.unit, payload.recorded_at, payload.source, payload.operator_user_id || userId, payload.comment, payload.evidence_photo_id, payload.evidence_document_id, alert.min_limit, alert.max_limit, alert.alert_status, alert.alert_reason, userId]
      );
    await logEvent(db, storeId, userId, recordId ? 'quality.temperature.record.updated' : 'quality.temperature.record.created', 'quality_temperature_record', result.rows[0].id, before, result.rows[0]);
    return result.rows[0];
  } catch (err) {
    throw dbError(err, 'Référence zone, équipement, type, photo ou document invalide');
  }
}

async function deleteTemperatureRecord(db, storeId, userId, recordId) {
  const before = await getTemperatureRecord(db, storeId, recordId);
  if (!before || before.deleted_at) return null;
  const result = await db.query(
    `UPDATE quality_temperature_records
     SET deleted_at=now(), updated_by=$3, updated_at=now()
     WHERE id=$1 AND store_id=$2 AND deleted_at IS NULL
     RETURNING *`,
    [recordId, storeId, userId]
  );
  await logEvent(db, storeId, userId, 'quality.temperature.record.archived', 'quality_temperature_record', recordId, before, result.rows[0]);
  return result.rows[0];
}

async function getTemperatureSummary(db, storeId) {
  const result = await db.query(
    `WITH latest AS (
       SELECT DISTINCT ON (COALESCE(r.equipment_id::text, r.zone_id::text, r.type_code))
         r.*, t.label AS type_label, z.name AS zone_name, e.name AS equipment_name
       FROM quality_temperature_records r
       INNER JOIN quality_temperature_types t ON t.code = r.type_code
       LEFT JOIN quality_zones z ON z.id = r.zone_id AND z.store_id = r.store_id
       LEFT JOIN quality_equipments e ON e.id = r.equipment_id AND e.store_id = r.store_id
       WHERE r.store_id = $1 AND r.deleted_at IS NULL
       ORDER BY COALESCE(r.equipment_id::text, r.zone_id::text, r.type_code), r.recorded_at DESC
     ),
     settings AS (
       SELECT l.*, t.label AS type_label, z.name AS zone_name, e.name AS equipment_name,
              lr.id AS last_record_id, lr.recorded_at AS last_recorded_at, lr.value AS last_value, lr.alert_status AS last_alert_status,
              CASE
                WHEN l.expected_frequency_value IS NULL OR lr.recorded_at IS NULL THEN NULL
                WHEN l.expected_frequency_unit = 'hours' THEN lr.recorded_at + (l.expected_frequency_value || ' hours')::interval
                WHEN l.expected_frequency_unit = 'days' THEN lr.recorded_at + (l.expected_frequency_value || ' days')::interval
                ELSE NULL
              END AS next_expected_at
       FROM quality_temperature_limits l
       INNER JOIN quality_temperature_types t ON t.code = l.type_code
       LEFT JOIN quality_zones z ON z.id = l.zone_id AND z.store_id = l.store_id
       LEFT JOIN quality_equipments e ON e.id = l.equipment_id AND e.store_id = l.store_id
       LEFT JOIN LATERAL (
         SELECT r.*
         FROM quality_temperature_records r
         WHERE r.store_id = l.store_id
           AND r.type_code = l.type_code
           AND r.deleted_at IS NULL
           AND (l.zone_id IS NULL OR r.zone_id = l.zone_id)
           AND (l.equipment_id IS NULL OR r.equipment_id = l.equipment_id)
         ORDER BY r.recorded_at DESC
         LIMIT 1
       ) lr ON true
       WHERE l.store_id = $1 AND l.is_active = true
     ),
     missing_settings AS (
       SELECT * FROM settings
       WHERE last_record_id IS NULL
          OR (expected_frequency_value IS NOT NULL AND expected_frequency_unit IN ('hours', 'days') AND next_expected_at < now())
     ),
     alerts AS (
       SELECT count(*)::int AS count
       FROM quality_temperature_records
       WHERE store_id = $1 AND deleted_at IS NULL AND alert_status = 'out_of_limits'
     ),
     latest_critical AS (
       SELECT *
       FROM quality_temperature_records
       WHERE store_id = $1 AND deleted_at IS NULL AND alert_status = 'out_of_limits'
       ORDER BY recorded_at DESC
       LIMIT 1
     )
     SELECT
       COALESCE((SELECT json_agg(latest ORDER BY latest.recorded_at DESC) FROM latest), '[]'::json) AS latest,
       (SELECT count FROM alerts) AS out_of_limits_count,
       (SELECT count(*)::int FROM missing_settings) AS missing_count,
       ((SELECT count FROM alerts) + (SELECT count(*)::int FROM missing_settings)) AS alert_count,
       COALESCE((SELECT json_agg(missing_settings ORDER BY missing_settings.next_expected_at NULLS FIRST) FROM missing_settings), '[]'::json) AS missing_items,
       (SELECT row_to_json(latest_critical) FROM latest_critical) AS latest_critical`,
    [storeId]
  );
  return result.rows[0] || { latest: [], alert_count: 0, out_of_limits_count: 0, missing_count: 0, missing_items: [], latest_critical: null };
}

module.exports = {
  listTemperatureTypes,
  listTemperatureLimits,
  saveTemperatureLimit,
  deleteTemperatureLimit,
  listTemperatureRecords,
  getTemperatureRecord,
  saveTemperatureRecord,
  deleteTemperatureRecord,
  getTemperatureSummary,
};
