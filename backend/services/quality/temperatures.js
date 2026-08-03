const { logQualityEvent } = require('./eventLogger');
const { archiveQualityTask, completeQualityTask, saveQualityTask } = require('./tasks');
const { enrichTask } = require('./taskScheduler');

function dbError(err, message) {
  if (err && err.code === '23503') {
    err.status = 400;
    err.publicMessage = message;
  }
  return err;
}

const DAY_ORDER = Object.freeze(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
const TEMPERATURE_ACTIVE_DAYS = Object.freeze(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);

function jsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function normalizeTime(value) {
  if (!value) return null;
  const text = String(value).trim();
  return text.length === 5 ? `${text}:00` : text.slice(0, 8);
}

function scheduleDayLabel(day) {
  return {
    monday: 'lundi',
    tuesday: 'mardi',
    wednesday: 'mercredi',
    thursday: 'jeudi',
    friday: 'vendredi',
    saturday: 'samedi',
    any: 'tous jours',
  }[day] || day;
}

function scheduleEntries(limit) {
  const days = jsonArray(limit.scheduled_days).filter((day) => TEMPERATURE_ACTIVE_DAYS.includes(day));
  const times = jsonArray(limit.target_times).map(normalizeTime).filter(Boolean);
  const effectiveDays = days.length ? days : ['any'];
  const effectiveTimes = times.length ? times : [normalizeTime(limit.target_time) || '00:00:00'];
  const entries = [];
  for (const day of effectiveDays) {
    for (const targetTime of effectiveTimes) {
      entries.push({ scheduled_day: day, target_time: targetTime });
    }
  }
  return entries;
}

function nextScheduledDueAt(entry, active) {
  if (!active || !entry?.target_time || entry.target_time === '00:00:00') return null;
  const [hours, minutes, seconds] = entry.target_time.split(':').map((part) => Number(part || 0));
  const now = new Date();
  const wantedDay = entry.scheduled_day === 'any' ? null : DAY_ORDER.indexOf(entry.scheduled_day);
  for (let offset = 0; offset <= 14; offset += 1) {
    const candidate = new Date(now.getTime());
    candidate.setDate(now.getDate() + offset);
    if (wantedDay !== null && candidate.getDay() !== wantedDay) continue;
    candidate.setHours(hours, minutes, seconds || 0, 0);
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  return null;
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

function taskSelectSql() {
  return `qt.id AS task_id, qt.title AS task_title, qt.frequency_value AS task_frequency_value,
          qt.frequency_unit AS task_frequency_unit, qt.target_time AS task_target_time,
          qt.next_due_at AS task_next_due_at, qt.last_completed_at AS task_last_completed_at,
          qt.status AS task_status, qt.active AS task_active, qt.task_origin AS task_origin,
          qt.source_entity_type AS task_source_entity_type, qt.source_entity_id AS task_source_entity_id,
          qt.source_locked AS task_source_locked, qtu.email AS task_responsible_email`;
}

function attachTask(limit) {
  if (!limit) return null;
  const base = {
    ...limit,
    scheduled_days: jsonArray(limit.scheduled_days),
    target_times: jsonArray(limit.target_times).map(normalizeTime).filter(Boolean),
    schedule_tasks: jsonArray(limit.schedule_tasks),
  };
  if (!limit.task_id) return { ...base, quality_task: null };
  const task = enrichTask({
    id: limit.task_id,
    title: limit.task_title,
    frequency_value: limit.task_frequency_value,
    frequency_unit: limit.task_frequency_unit,
    target_time: limit.task_target_time,
    next_due_at: limit.task_next_due_at,
    last_completed_at: limit.task_last_completed_at,
    status: limit.task_status,
    active: limit.task_active,
    task_origin: limit.task_origin,
    source_entity_type: limit.task_source_entity_type,
    source_entity_id: limit.task_source_entity_id,
    source_locked: limit.task_source_locked,
    responsible_email: limit.task_responsible_email,
  });
  return { ...base, quality_task: task };
}

function targetLabel(limit) {
  return limit.equipment_name || limit.zone_name || limit.type_label || limit.type_code || 'temperature';
}

function synchronizedTemperatureTaskPayload(limit, entry = null) {
  const active = limit.is_active === true;
  const schedule = entry || { scheduled_day: 'any', target_time: normalizeTime(limit.target_time) };
  const scheduleLabel = [
    schedule.scheduled_day && schedule.scheduled_day !== 'any' ? scheduleDayLabel(schedule.scheduled_day) : null,
    schedule.target_time && schedule.target_time !== '00:00:00' ? schedule.target_time.slice(0, 5) : null,
  ].filter(Boolean).join(' ');
  const nextDueAt = nextScheduledDueAt(schedule, active);
  return {
    title: `Releve temperature - ${targetLabel(limit)}${scheduleLabel ? ` - ${scheduleLabel}` : ''}`,
    description: [
      'Tache synchronisee automatiquement depuis le parametre temperature ALTA.',
      limit.type_label ? `Type: ${limit.type_label}` : null,
      limit.min_value !== null || limit.max_value !== null ? `Plage: ${limit.min_value ?? '-'} a ${limit.max_value ?? '-'} ${limit.unit || 'C'}` : null,
    ].filter(Boolean).join(' '),
    module_key: 'temperature',
    entity_type: limit.equipment_id ? 'equipment' : limit.zone_id ? 'zone' : null,
    entity_id: limit.equipment_id || limit.zone_id || null,
    responsible_user_id: limit.responsible_user_id || null,
    frequency_value: limit.expected_frequency_value || null,
    frequency_unit: limit.expected_frequency_unit || null,
    target_time: schedule.target_time === '00:00:00' ? null : schedule.target_time || null,
    next_due_at: nextDueAt,
    status: active ? 'planned' : 'paused',
    active,
    category: 'temperature_parameter',
    execution_method: 'Relever la temperature et enregistrer la valeur dans ALTA.',
    verification_method: limit.min_value !== null || limit.max_value !== null ? 'Comparer la valeur aux seuils du parametre temperature.' : null,
    proof_required: false,
    photo_required: false,
    instructions: 'Utiliser le parametre temperature comme source de verite.',
    acceptance_criteria: limit.min_value !== null || limit.max_value !== null ? `Entre ${limit.min_value ?? '-'} et ${limit.max_value ?? '-'} ${limit.unit || 'C'}` : null,
    deviation_action: 'Declencher une action corrective en cas de temperature hors limites.',
    configuration_status: active ? 'active' : 'inactive',
    created_source: 'temperature_parameter',
    created_by_agent: false,
    task_origin: 'SYSTEM',
    source_entity_type: 'temperature_parameter',
    source_entity_id: limit.id,
    source_locked: true,
  };
}

function followupSql(alias = 'qt') {
  return `CASE
    WHEN l.is_active = false THEN 'inactive'
    WHEN ${alias}.id IS NULL THEN 'unplanned'
    WHEN ${alias}.active = false THEN 'inactive'
    WHEN ${alias}.next_due_at < now() THEN 'missing'
    ELSE 'compliant'
  END`;
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

async function assertTemperatureType(db, typeCode) {
  const types = await listTemperatureTypes(db);
  const type = types.find((item) => item.code === typeCode);
  if (type) return type;
  const allowedCodes = types.map((item) => item.code).join(', ') || 'aucun type actif';
  const err = new Error(`Type de temperature invalide: ${typeCode || '(vide)'}. Codes autorises: ${allowedCodes}`);
  err.status = 400;
  err.publicMessage = err.message;
  err.expose = true;
  throw err;
}

async function listTemperatureLimits(db, storeId, query = {}) {
  const params = [storeId];
  const where = ['l.store_id = $1'];
  addFilter(where, params, query.type || query.type_code, (i) => `l.type_code = $${i}`);
  addFilter(where, params, query.zone_id, (i) => `l.zone_id = $${i}`);
  addFilter(where, params, query.equipment_id, (i) => `l.equipment_id = $${i}`);
  addFilter(where, params, query.quality_task_id, (i) => `l.quality_task_id = $${i}`);
  if (query.active_only !== 'false') where.push('l.is_active = true');

  const result = await db.query(
    `SELECT l.*, t.label AS type_label, t.default_unit AS type_default_unit,
            t.category AS type_category, t.is_active AS type_active,
            z.name AS zone_name, e.name AS equipment_name,
            lr.id AS last_record_id, lr.recorded_at AS last_recorded_at, lr.value AS last_value,
            lr.unit AS last_unit, lr.alert_status AS last_alert_status,
            qt.next_due_at AS next_expected_at,
            ${followupSql('qt')} AS followup_status,
            COALESCE(schedule_targets.schedule_tasks, '[]'::json) AS schedule_tasks,
            ${taskSelectSql()}
     FROM quality_temperature_limits l
     INNER JOIN quality_temperature_types t ON t.code = l.type_code
     LEFT JOIN quality_zones z ON z.id = l.zone_id AND z.store_id = l.store_id
     LEFT JOIN quality_equipments e ON e.id = l.equipment_id AND e.store_id = l.store_id
     LEFT JOIN quality_tasks qt ON qt.id = l.quality_task_id AND qt.store_id = l.store_id
     LEFT JOIN users qtu ON qtu.id = qt.responsible_user_id
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
         'task_id', ltt.task_id,
         'scheduled_day', NULLIF(ltt.scheduled_day, 'any'),
         'target_time', NULLIF(ltt.target_time, '00:00'::time),
         'task_title', st.title,
         'task_status', st.status,
         'task_active', st.active,
         'next_due_at', st.next_due_at
       ) ORDER BY ltt.scheduled_day ASC, ltt.target_time ASC) AS schedule_tasks
       FROM quality_temperature_limit_tasks ltt
       INNER JOIN quality_tasks st ON st.id = ltt.task_id AND st.store_id = l.store_id
       WHERE ltt.limit_id = l.id AND ltt.deleted_at IS NULL
     ) schedule_targets ON true
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
     ORDER BY l.is_active DESC, qt.next_due_at ASC NULLS LAST, t.label ASC, z.name ASC, e.name ASC`,
    params
  );
  return result.rows.map(attachTask);
}

async function listDueTemperatureReadings(db, storeId, query = {}) {
  const includeUpcoming = ['true', '1', 'yes'].includes(String(query.include_upcoming || '').toLowerCase());
  const result = await db.query(
    `SELECT l.id AS limit_id, l.id AS parameter_id, l.quality_task_id,
            schedule_link.scheduled_day, schedule_link.scheduled_target_time,
            l.type_code, t.label AS type_label,
            l.zone_id, z.code AS zone_code, z.name AS zone_name,
            l.equipment_id, e.code AS equipment_code, e.name AS equipment_name,
            l.min_value, l.max_value, l.unit,
            ${taskSelectSql()}
     FROM quality_temperature_limits l
     INNER JOIN quality_temperature_types t ON t.code = l.type_code
     LEFT JOIN LATERAL (
       SELECT ltt.task_id, NULLIF(ltt.scheduled_day, 'any') AS scheduled_day, NULLIF(ltt.target_time, '00:00'::time) AS scheduled_target_time
       FROM quality_temperature_limit_tasks ltt
       WHERE ltt.limit_id = l.id AND ltt.deleted_at IS NULL
       UNION ALL
       SELECT l.quality_task_id, NULL::text, NULL::time
       WHERE l.quality_task_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM quality_temperature_limit_tasks existing
           WHERE existing.limit_id = l.id AND existing.deleted_at IS NULL
         )
     ) schedule_link ON true
     INNER JOIN quality_tasks qt ON qt.id = schedule_link.task_id AND qt.store_id = l.store_id
     LEFT JOIN users qtu ON qtu.id = qt.responsible_user_id
     LEFT JOIN quality_zones z ON z.id = l.zone_id AND z.store_id = l.store_id
     LEFT JOIN quality_equipments e ON e.id = l.equipment_id AND e.store_id = l.store_id
     WHERE l.store_id = $1
       AND l.is_active = true
       AND qt.active = true
       AND ($2::boolean = true OR qt.next_due_at::date <= CURRENT_DATE)
     ORDER BY qt.next_due_at ASC NULLS LAST, t.label ASC, z.name ASC, e.name ASC`,
    [storeId, includeUpcoming]
  );

  return result.rows
    .map((row) => {
      const task = enrichTask({
        id: row.task_id,
        title: row.task_title,
        frequency_value: row.task_frequency_value,
        frequency_unit: row.task_frequency_unit,
        target_time: row.task_target_time,
        next_due_at: row.task_next_due_at,
        last_completed_at: row.task_last_completed_at,
        status: row.task_status,
        active: row.task_active,
        responsible_email: row.task_responsible_email,
      });
      return {
        quality_task_id: row.task_id || row.quality_task_id,
        limit_id: row.limit_id,
        parameter_id: row.parameter_id,
        type_code: row.type_code,
        type_label: row.type_label,
        scheduled_day: row.scheduled_day,
        zone_id: row.zone_id,
        zone_code: row.zone_code,
        zone_name: row.zone_name,
        equipment_id: row.equipment_id,
        equipment_code: row.equipment_code,
        equipment_name: row.equipment_name,
        min_value: row.min_value,
        max_value: row.max_value,
        unit: row.unit,
        task_title: task.title,
        target_time: row.scheduled_target_time || task.target_time,
        next_due_at: task.next_due_at,
        computed_status: task.computed_status,
        last_completed_at: task.last_completed_at,
      };
    })
    .filter((item) => includeUpcoming || ['due', 'overdue'].includes(item.computed_status));
}

async function getTemperatureLimit(db, storeId, limitId) {
  const result = await db.query(
    `SELECT l.*, t.label AS type_label, t.default_unit AS type_default_unit,
            t.category AS type_category, t.is_active AS type_active,
            COALESCE(schedule_targets.schedule_tasks, '[]'::json) AS schedule_tasks,
            ${taskSelectSql()}
     FROM quality_temperature_limits l
     INNER JOIN quality_temperature_types t ON t.code = l.type_code
     LEFT JOIN quality_tasks qt ON qt.id = l.quality_task_id AND qt.store_id = l.store_id
     LEFT JOIN users qtu ON qtu.id = qt.responsible_user_id
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
         'task_id', ltt.task_id,
         'scheduled_day', NULLIF(ltt.scheduled_day, 'any'),
         'target_time', NULLIF(ltt.target_time, '00:00'::time),
         'task_title', st.title,
         'task_status', st.status,
         'task_active', st.active,
         'next_due_at', st.next_due_at
       ) ORDER BY ltt.scheduled_day ASC, ltt.target_time ASC) AS schedule_tasks
       FROM quality_temperature_limit_tasks ltt
       INNER JOIN quality_tasks st ON st.id = ltt.task_id AND st.store_id = l.store_id
       WHERE ltt.limit_id = l.id AND ltt.deleted_at IS NULL
     ) schedule_targets ON true
     WHERE l.id = $1 AND l.store_id = $2 LIMIT 1`,
    [limitId, storeId]
  );
  return attachTask(result.rows[0] || null);
}

async function assertTemperatureTask(db, storeId, taskId) {
  if (!taskId) return null;
  const result = await db.query(
    `SELECT id FROM quality_tasks
     WHERE id = $1 AND store_id = $2 AND module_key = 'temperature'
     LIMIT 1`,
    [taskId, storeId]
  );
  if (result.rows[0]) return taskId;
  const err = new Error('Tâche qualité température introuvable');
  err.status = 400;
  throw err;
}

async function listTemperatureLimitTaskLinks(db, limitId) {
  const result = await db.query(
    `SELECT limit_id, scheduled_day, target_time, task_id
     FROM quality_temperature_limit_tasks
     WHERE limit_id = $1::uuid AND deleted_at IS NULL`,
    [limitId]
  );
  return result.rows.map((row) => ({
    ...row,
    target_time: normalizeTime(row.target_time),
  }));
}

async function upsertTemperatureLimitTaskLink(db, userId, limitId, entry, taskId) {
  await db.query(
    `INSERT INTO quality_temperature_limit_tasks (limit_id, scheduled_day, target_time, task_id, created_by, deleted_at, deleted_by)
     VALUES ($1::uuid, $2::text, $3::time, $4::uuid, $5::uuid, NULL, NULL)
     ON CONFLICT (limit_id, scheduled_day, target_time)
     DO UPDATE SET task_id = EXCLUDED.task_id, deleted_at = NULL, deleted_by = NULL`,
    [limitId, entry.scheduled_day || 'any', entry.target_time || '00:00:00', taskId, userId]
  );
}

async function archiveRemovedTemperatureScheduleTasks(db, storeId, userId, limitId, activeKeys) {
  const links = await listTemperatureLimitTaskLinks(db, limitId);
  for (const link of links) {
    const key = `${link.scheduled_day}|${normalizeTime(link.target_time) || '00:00:00'}`;
    if (activeKeys.has(key)) continue;
    await db.query(
      `UPDATE quality_temperature_limit_tasks
       SET deleted_at = now(), deleted_by = $4::uuid
       WHERE limit_id = $1::uuid AND scheduled_day = $2::text AND target_time = $3::time AND deleted_at IS NULL`,
      [limitId, link.scheduled_day, normalizeTime(link.target_time) || '00:00:00', userId]
    );
    await archiveQualityTask(db, storeId, userId, link.task_id);
  }
}

async function syncTemperatureLimitTask(db, storeId, userId, limit) {
  if (!limit) return null;
  const entries = scheduleEntries(limit);
  const existingLinks = await listTemperatureLimitTaskLinks(db, limit.id);
  const linkByKey = new Map(existingLinks.map((link) => [`${link.scheduled_day}|${normalizeTime(link.target_time) || '00:00:00'}`, link]));
  const activeKeys = new Set();
  let primaryTaskId = limit.quality_task_id || null;
  let firstActiveTaskId = null;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const key = `${entry.scheduled_day}|${entry.target_time || '00:00:00'}`;
    activeKeys.add(key);
    const linked = linkByKey.get(key);
    const taskId = linked?.task_id || (index === 0 ? primaryTaskId : null);
    const task = await saveQualityTask(
      db,
      storeId,
      userId,
      synchronizedTemperatureTaskPayload(limit, entry),
      taskId
    );
    if (!primaryTaskId && index === 0 && task?.id) {
      primaryTaskId = task.id;
    }
    if (index === 0 && task?.id) firstActiveTaskId = task.id;
    if (task?.id) await upsertTemperatureLimitTaskLink(db, userId, limit.id, entry, task.id);
  }

  if (firstActiveTaskId && firstActiveTaskId !== limit.quality_task_id) {
    primaryTaskId = firstActiveTaskId;
    await db.query(
      `UPDATE quality_temperature_limits
       SET quality_task_id=$3::uuid, updated_by=$4::uuid, updated_at=now()
       WHERE id=$1::uuid AND store_id=$2::uuid`,
      [limit.id, storeId, firstActiveTaskId, userId]
    );
  }

  await archiveRemovedTemperatureScheduleTasks(db, storeId, userId, limit.id, activeKeys);
  return primaryTaskId;
}

async function withTransaction(db, work) {
  if (typeof db.connect !== 'function') return work(db);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function saveTemperatureLimitInTransaction(db, storeId, userId, payload, limitId = null) {
  const before = limitId ? await getTemperatureLimit(db, storeId, limitId) : null;
  if (limitId && !before) return null;
  await assertTemperatureType(db, payload.type_code);
  const qualityTaskId = await assertTemperatureTask(db, storeId, payload.quality_task_id);
  try {
    const result = limitId
      ? await db.query(
        `UPDATE quality_temperature_limits
         SET type_code=$3, zone_id=$4, equipment_id=$5, min_value=$6, max_value=$7, unit=$8,
             expected_frequency_value=$9, expected_frequency_unit=$10, target_time=$11,
             responsible_user_id=$12, quality_task_id=$13, is_active=$14, valid_from=$15, valid_until=$16,
             scheduled_days=$17::jsonb, target_times=$18::jsonb, updated_by=$19::uuid, updated_at=now()
         WHERE id=$1 AND store_id=$2
         RETURNING *`,
        [limitId, storeId, payload.type_code, payload.zone_id, payload.equipment_id, payload.min_value, payload.max_value, payload.unit, payload.expected_frequency_value, payload.expected_frequency_unit, payload.target_time, payload.responsible_user_id, qualityTaskId, payload.is_active, payload.valid_from, payload.valid_until, JSON.stringify(payload.scheduled_days || []), JSON.stringify(payload.target_times || []), userId]
      )
      : await db.query(
        `INSERT INTO quality_temperature_limits (
          store_id, type_code, zone_id, equipment_id, min_value, max_value, unit,
          expected_frequency_value, expected_frequency_unit, target_time, responsible_user_id, quality_task_id,
          is_active, valid_from, valid_until, scheduled_days, target_times, created_by, updated_by
        ) VALUES ($1::uuid,$2::text,$3::uuid,$4::uuid,$5::numeric,$6::numeric,$7::text,$8::integer,$9::text,$10::time,$11::uuid,$12::uuid,$13::boolean,$14::date,$15::date,$16::jsonb,$17::jsonb,$18::uuid,$18::uuid)
        RETURNING *`,
        [storeId, payload.type_code, payload.zone_id, payload.equipment_id, payload.min_value, payload.max_value, payload.unit, payload.expected_frequency_value, payload.expected_frequency_unit, payload.target_time, payload.responsible_user_id, qualityTaskId, payload.is_active, payload.valid_from, payload.valid_until, JSON.stringify(payload.scheduled_days || []), JSON.stringify(payload.target_times || []), userId]
      );
    const savedLimit = await getTemperatureLimit(db, storeId, result.rows[0].id);
    await syncTemperatureLimitTask(db, storeId, userId, savedLimit);
    const limit = await getTemperatureLimit(db, storeId, result.rows[0].id);
    await logEvent(db, storeId, userId, limitId ? 'quality.temperature.limit.updated' : 'quality.temperature.limit.created', 'quality_temperature_limit', limit.id, before, limit);
    return limit;
  } catch (err) {
    if (err.status) throw err;
    throw dbError(err, 'Référence zone, équipement, type de température ou tâche qualité invalide');
  }
}

async function saveTemperatureLimit(db, storeId, userId, payload, limitId = null) {
  return withTransaction(db, (client) => saveTemperatureLimitInTransaction(client, storeId, userId, payload, limitId));
}

async function deleteTemperatureLimitInTransaction(db, storeId, userId, limitId) {
  const before = await getTemperatureLimit(db, storeId, limitId);
  if (!before) return null;
  const result = await db.query(
    `UPDATE quality_temperature_limits
     SET is_active=false, updated_by=$3, updated_at=now()
     WHERE id=$1 AND store_id=$2
     RETURNING *`,
    [limitId, storeId, userId]
  );
  const links = await listTemperatureLimitTaskLinks(db, limitId);
  const archived = new Set();
  for (const link of links) {
    if (archived.has(String(link.task_id))) continue;
    archived.add(String(link.task_id));
    await archiveQualityTask(db, storeId, userId, link.task_id);
  }
  if (before.quality_task_id && !archived.has(String(before.quality_task_id))) {
    await archiveQualityTask(db, storeId, userId, before.quality_task_id);
  }
  const limit = await getTemperatureLimit(db, storeId, result.rows[0].id);
  await logEvent(db, storeId, userId, 'quality.temperature.limit.archived', 'quality_temperature_limit', limitId, before, limit);
  return limit;
}

async function deleteTemperatureLimit(db, storeId, userId, limitId) {
  return withTransaction(db, (client) => deleteTemperatureLimitInTransaction(client, storeId, userId, limitId));
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

async function completeLinkedTemperatureTask(db, storeId, userId, limit, payload) {
  const taskId = payload.quality_task_id || limit?.quality_task_id || null;
  if (!taskId) return;
  await completeQualityTask(
    db,
    storeId,
    userId,
    taskId,
    `Relevé température ${payload.value}${payload.unit || '°C'}`,
    payload.recorded_at
  );
}

async function saveTemperatureRecord(db, storeId, userId, payload, recordId = null) {
  const before = recordId ? await getTemperatureRecord(db, storeId, recordId) : null;
  if (recordId && (!before || before.deleted_at)) return null;
  const limit = await findApplicableLimit(db, storeId, payload);
  const alert = evaluateAlert(payload.value, limit);
  const ownsTransaction = typeof db.connect === 'function';
  const client = ownsTransaction ? await db.connect() : db;
  if (ownsTransaction) await client.query('BEGIN');
  try {
    const result = recordId
      ? await client.query(
        `UPDATE quality_temperature_records
         SET zone_id=$3, equipment_id=$4, type_code=$5, value=$6, unit=$7, recorded_at=$8,
             source=$9, operator_user_id=$10, quality_task_id=$11::uuid, occurrence_id=$12::uuid,
             comment=$13, method_used=$14, evidence_photo_id=$15::uuid, evidence_document_id=$16::uuid,
             temperature_limit_id=$17::uuid, min_limit=$18, max_limit=$19, alert_status=$20, alert_reason=$21,
             exceptional_reason=$22::text, updated_by=$23, updated_at=now()
         WHERE id=$1 AND store_id=$2 AND deleted_at IS NULL
         RETURNING *`,
        [recordId, storeId, payload.zone_id, payload.equipment_id, payload.type_code, payload.value, payload.unit, payload.recorded_at, payload.source, payload.operator_user_id || userId, payload.quality_task_id || null, payload.occurrence_id || null, payload.comment, payload.method_used, payload.evidence_photo_id || null, payload.evidence_document_id || null, limit?.id || null, alert.min_limit, alert.max_limit, alert.alert_status, alert.alert_reason, payload.exceptional_reason || null, userId]
      )
      : await client.query(
        `INSERT INTO quality_temperature_records (
          store_id, zone_id, equipment_id, type_code, value, unit, recorded_at, source,
          operator_user_id, quality_task_id, occurrence_id, comment, method_used, evidence_photo_id, evidence_document_id,
          temperature_limit_id, min_limit, max_limit, alert_status, alert_reason, exceptional_reason, created_by, updated_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11::uuid,$12,$13,$14::uuid,$15::uuid,$16::uuid,$17,$18,$19,$20,$21::text,$22,$22)
        RETURNING *`,
        [storeId, payload.zone_id, payload.equipment_id, payload.type_code, payload.value, payload.unit, payload.recorded_at, payload.source, payload.operator_user_id || userId, payload.quality_task_id || null, payload.occurrence_id || null, payload.comment, payload.method_used, payload.evidence_photo_id || null, payload.evidence_document_id || null, limit?.id || null, alert.min_limit, alert.max_limit, alert.alert_status, alert.alert_reason, payload.exceptional_reason || null, userId]
      );
    if (!recordId) await completeLinkedTemperatureTask(client, storeId, userId, limit, payload);
    await logEvent(client, storeId, userId, recordId ? 'quality.temperature.record.updated' : 'quality.temperature.record.created', 'quality_temperature_record', result.rows[0].id, before, result.rows[0]);
    if (ownsTransaction) await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    if (ownsTransaction) await client.query('ROLLBACK');
    throw dbError(err, 'RÃ©fÃ©rence zone, Ã©quipement, type, photo, document ou tÃ¢che qualitÃ© invalide');
  } finally {
    if (ownsTransaction) client.release();
  }
}

async function saveTemperatureRecordLegacy(db, storeId, userId, payload, recordId = null) {
  const before = recordId ? await getTemperatureRecord(db, storeId, recordId) : null;
  if (recordId && (!before || before.deleted_at)) return null;
  const limit = await findApplicableLimit(db, storeId, payload);
  const alert = evaluateAlert(payload.value, limit);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = recordId
      ? await client.query(
        `UPDATE quality_temperature_records
         SET zone_id=$3, equipment_id=$4, type_code=$5, value=$6, unit=$7, recorded_at=$8,
             source=$9, operator_user_id=$10, quality_task_id=$11::uuid, occurrence_id=$12::uuid,
             comment=$13, method_used=$14, evidence_photo_id=$15, evidence_document_id=$16,
             temperature_limit_id=$17::uuid, min_limit=$18, max_limit=$19, alert_status=$20, alert_reason=$21,
             updated_by=$22, updated_at=now()
         WHERE id=$1 AND store_id=$2 AND deleted_at IS NULL
         RETURNING *`,
        [recordId, storeId, payload.zone_id, payload.equipment_id, payload.type_code, payload.value, payload.unit, payload.recorded_at, payload.source, payload.operator_user_id || userId, payload.quality_task_id || null, payload.occurrence_id || null, payload.comment, payload.method_used, payload.evidence_photo_id, payload.evidence_document_id, limit?.id || null, alert.min_limit, alert.max_limit, alert.alert_status, alert.alert_reason, userId]
      )
      : await client.query(
        `INSERT INTO quality_temperature_records (
          store_id, zone_id, equipment_id, type_code, value, unit, recorded_at, source,
          operator_user_id, quality_task_id, occurrence_id, comment, method_used, evidence_photo_id, evidence_document_id,
          temperature_limit_id, min_limit, max_limit, alert_status, alert_reason, created_by, updated_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11::uuid,$12,$13,$14,$15,$16::uuid,$17,$18,$19,$20,$21,$21)
        RETURNING *`,
        [storeId, payload.zone_id, payload.equipment_id, payload.type_code, payload.value, payload.unit, payload.recorded_at, payload.source, payload.operator_user_id || userId, payload.quality_task_id || null, payload.occurrence_id || null, payload.comment, payload.method_used, payload.evidence_photo_id, payload.evidence_document_id, limit?.id || null, alert.min_limit, alert.max_limit, alert.alert_status, alert.alert_reason, userId]
      );
    if (!recordId) await completeLinkedTemperatureTask(client, storeId, userId, limit, payload);
    await logEvent(client, storeId, userId, recordId ? 'quality.temperature.record.updated' : 'quality.temperature.record.created', 'quality_temperature_record', result.rows[0].id, before, result.rows[0]);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw dbError(err, 'Référence zone, équipement, type, photo, document ou tâche qualité invalide');
  } finally {
    client.release();
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
    `WITH settings AS (
       SELECT l.*, qt.next_due_at, qt.active AS task_active
       FROM quality_temperature_limits l
       LEFT JOIN quality_tasks qt ON qt.id = l.quality_task_id AND qt.store_id = l.store_id
       WHERE l.store_id = $1 AND l.is_active = true
     ),
     missing_settings AS (
       SELECT * FROM settings
       WHERE quality_task_id IS NOT NULL AND task_active = true AND next_due_at < now()
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
       '[]'::json AS latest,
       (SELECT count FROM alerts) AS out_of_limits_count,
       (SELECT count(*)::int FROM missing_settings) AS missing_count,
       ((SELECT count FROM alerts) + (SELECT count(*)::int FROM missing_settings)) AS alert_count,
       COALESCE((SELECT json_agg(missing_settings ORDER BY missing_settings.next_due_at NULLS FIRST) FROM missing_settings), '[]'::json) AS missing_items,
       (SELECT row_to_json(latest_critical) FROM latest_critical) AS latest_critical`,
    [storeId]
  );
  return result.rows[0] || { latest: [], alert_count: 0, out_of_limits_count: 0, missing_count: 0, missing_items: [], latest_critical: null };
}

module.exports = {
  listTemperatureTypes,
  assertTemperatureType,
  listTemperatureLimits,
  getTemperatureLimit,
  listDueTemperatureReadings,
  saveTemperatureLimit,
  deleteTemperatureLimit,
  listTemperatureRecords,
  getTemperatureRecord,
  saveTemperatureRecord,
  deleteTemperatureRecord,
  getTemperatureSummary,
};
