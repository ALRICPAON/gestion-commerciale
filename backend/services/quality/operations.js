const { createCleaningRecord, listDueCleaningRecords, listCleaningRecords } = require('./cleaning');
const { completeQualityTask, getQualityTask, listQualityTasks, updateQualityTaskStatus } = require('./tasks');
const { listDueTemperatureReadings, listTemperatureRecords, saveTemperatureRecord } = require('./temperatures');
const { logQualityEvent } = require('./eventLogger');

const RECORD_TYPES = Object.freeze({
  temperature: 'quality_temperature_record',
  cleaning: 'quality_cleaning_record',
  manual_task: 'quality_manual_task_record',
  manual: 'quality_manual_task_record',
  control: 'quality_manual_task_record',
});

function startOfDay(value = new Date()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value = new Date()) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

async function withTransaction(db, work) {
  if (typeof db.connect !== 'function' || typeof db.release === 'function' || db._connected === true) return work(db);
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

function dueStatus(dueAt, completed = false) {
  if (completed) return 'completed';
  const due = dueAt ? new Date(dueAt) : null;
  if (!due || Number.isNaN(due.getTime())) return 'planned';
  const now = new Date();
  if (due < now) return 'late';
  if (due.toDateString() === now.toDateString()) return 'due';
  return 'planned';
}

function taskType(task = {}) {
  if (isTemperatureLikeTask(task)) return 'temperature';
  if (task.module_key === 'temperature' || task.source_entity_type === 'temperature_parameter') return 'temperature';
  if (task.module_key === 'cleaning' || task.source_entity_type === 'cleaning_plan') return 'cleaning';
  if (task.task_origin === 'MANUAL') return 'manual';
  return 'control';
}

function isTemperatureLikeTask(task = {}) {
  if (task.module_key === 'temperature' || task.source_entity_type === 'temperature_parameter') return true;
  const text = `${task.title || ''} ${task.task_title || ''} ${task.record_title || ''} ${task.description || ''} ${task.category || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return /\b(temp|temperature|releve temperature|chambre froide|frigo|froid)\b/.test(text)
    && !/\b(nettoyage|cleaning|lavage|desinfection)\b/.test(text);
}

function actionLabel(type) {
  return {
    temperature: 'Saisir le releve',
    cleaning: 'Realiser le nettoyage',
    manual: 'Realiser la tache',
    control: 'Effectuer le controle',
  }[type] || 'Effectuer le controle';
}

function periodFromQuery(query = {}) {
  return {
    start: query.start_date || startOfDay().toISOString(),
    end: query.end_date || endOfDay().toISOString(),
  };
}

function recordTypeFromPublicType(type) {
  return RECORD_TYPES[String(type || '').trim()] || null;
}

function publicTypeFromRecordType(type) {
  if (type === 'quality_temperature_record') return 'temperature';
  if (type === 'quality_cleaning_record') return 'cleaning';
  if (type === 'quality_manual_task_record') return 'manual_task';
  return type || null;
}

function publicDetailTypeFromRecordType(type, fallback) {
  if (type === 'quality_temperature_record') return 'temperature';
  if (type === 'quality_cleaning_record') return 'cleaning';
  if (type === 'quality_manual_task_record') return 'manual_task';
  return fallback || null;
}

function parseTemperatureValue(value) {
  const match = String(value || '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeWorkItem(source, item, task = {}) {
  const type = source || taskType(task);
  const recordType = item.record_type || item.source_record_type || null;
  const recordId = item.source_record_id || item.record_id || null;
  const dueAt = item.next_due_at || task.next_due_at || null;
  return {
    id: item.occurrence_id || item.quality_task_id || item.task_id || item.cleaning_plan_id || item.limit_id || task.id,
    occurrence_id: item.occurrence_id || null,
    quality_task_id: item.quality_task_id || item.task_id || task.id || null,
    record_type: type === 'manual' ? 'manual' : type,
    record_id: recordId,
    detail_type: publicDetailTypeFromRecordType(recordType, type === 'manual' ? 'manual_task' : type),
    source_record_type: recordType,
    source_record_id: recordId,
    type,
    title: item.task_title || item.title || task.title || 'Controle qualite',
    source_entity_type: item.source_entity_type || task.source_entity_type || (type === 'temperature' ? 'temperature_parameter' : type === 'cleaning' ? 'cleaning_plan' : null),
    source_entity_id: item.parameter_id || item.limit_id || item.cleaning_plan_id || item.plan_id || task.source_entity_id || null,
    zone_id: item.zone_id || (task.entity_type === 'zone' ? task.entity_id : null),
    zone_name: item.zone_name || null,
    equipment_id: item.equipment_id || (task.entity_type === 'equipment' ? task.entity_id : null),
    equipment_name: item.equipment_name || null,
    operator_email: item.operator_email || item.performed_by_email || item.completed_by_email || null,
    result_status: item.result_status || item.alert_status || item.status || null,
    conformity_status: item.conformity_status || (item.alert_status ? (item.alert_status === 'out_of_limits' ? 'non_conform' : 'conform') : null),
    value: item.value ?? null,
    unit: item.unit || null,
    comment: item.comment || item.observation || null,
    corrective_action: item.corrective_action || null,
    evidence_photo_id: item.evidence_photo_id || item.proof_photo_id || null,
    evidence_document_id: item.evidence_document_id || item.proof_document_id || null,
    target_time: item.target_time || task.target_time || null,
    frequency_unit: item.frequency_unit || task.frequency_unit || null,
    next_due_at: dueAt,
    status: item.computed_status || dueStatus(dueAt),
    criticality: task.criticality || (type === 'temperature' ? 'high' : 'medium'),
    responsible_email: item.responsible_email || task.responsible_email || null,
    task_origin: task.task_origin || item.task_origin || (type === 'manual' ? 'MANUAL' : 'SYSTEM'),
    source_locked: task.source_locked === true,
    primary_action: actionLabel(type),
    raw: item,
  };
}

function completedWorkItem(record, task = {}) {
  const type = record.record_type === 'quality_temperature_record'
    ? 'temperature'
    : record.record_type === 'quality_cleaning_record'
      ? 'cleaning'
      : taskType(task);
  return normalizeWorkItem(type, {
    ...record,
    computed_status: 'completed',
    next_due_at: record.completed_at || record.recorded_at || record.performed_at,
    title: record.record_title || task.title,
  }, task);
}

async function upsertOccurrence(db, storeId, taskId, dueAt, source = {}) {
  if (!taskId || !dueAt) return null;
  const due = new Date(dueAt);
  const result = await db.query(
    `INSERT INTO quality_task_occurrences (
      store_id, task_id, due_at, due_date, due_time, status, source_entity_type, source_entity_id
    ) VALUES ($1::uuid,$2::uuid,$3::timestamptz,($3::timestamptz)::date,($3::timestamptz)::time,$4::text,$5::text,$6::uuid)
    ON CONFLICT (task_id, due_at)
    DO UPDATE SET status = CASE
      WHEN quality_task_occurrences.status = 'completed' THEN quality_task_occurrences.status
      ELSE EXCLUDED.status
    END,
    source_entity_type = COALESCE(EXCLUDED.source_entity_type, quality_task_occurrences.source_entity_type),
    source_entity_id = COALESCE(EXCLUDED.source_entity_id, quality_task_occurrences.source_entity_id),
    updated_at = now()
    RETURNING *`,
    [storeId, taskId, due.toISOString(), dueStatus(due), source.source_entity_type || null, source.source_entity_id || null]
  );
  return result.rows[0] || null;
}

async function completeOccurrence(db, storeId, userId, occurrenceId, recordType, recordId, resultStatus, comment) {
  if (!occurrenceId) return null;
  const result = await db.query(
    `UPDATE quality_task_occurrences
     SET status='completed', completed_at=now(), completed_by=$3::uuid,
         source_record_type=$4::text, source_record_id=$5::uuid, result_status=$6::text,
         comment=$7::text, updated_at=now()
     WHERE id=$1::uuid AND store_id=$2::uuid
     RETURNING *`,
    [occurrenceId, storeId, userId, recordType, recordId, resultStatus, comment || null]
  );
  return result.rows[0] || null;
}

async function listOpenNonConformities(db, storeId) {
  const result = await db.query(
    `SELECT nc.*, z.name AS zone_name, e.name AS equipment_name, u.email AS responsible_email
     FROM quality_non_conformities nc
     LEFT JOIN quality_zones z ON z.id = nc.zone_id AND z.store_id = nc.store_id
     LEFT JOIN quality_equipments e ON e.id = nc.equipment_id AND e.store_id = nc.store_id
     LEFT JOIN users u ON u.id = nc.responsible_user_id
     WHERE nc.store_id = $1::uuid AND nc.status IN ('open', 'in_progress')
     ORDER BY CASE nc.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, nc.created_at DESC
     LIMIT 200`,
    [storeId]
  );
  return result.rows;
}

async function listDdppNonConformities(db, storeId, query = {}) {
  const period = periodFromQuery(query);
  const params = [storeId, period.start, period.end];
  const where = [
    'nc.store_id = $1::uuid',
    `(nc.status IN ('open', 'in_progress')
      OR (nc.closed_at >= $2::timestamptz AND nc.closed_at <= $3::timestamptz)
      OR (nc.created_at >= $2::timestamptz AND nc.created_at <= $3::timestamptz)
      OR (o.completed_at >= $2::timestamptz AND o.completed_at <= $3::timestamptz))`,
  ];
  const recordType = recordTypeFromPublicType(query.type);
  if (recordType) {
    params.push(recordType);
    where.push(`(nc.origin_type = $${params.length} OR o.source_record_type = $${params.length})`);
  }
  if (query.zone_id) {
    params.push(query.zone_id);
    where.push(`nc.zone_id = $${params.length}::uuid`);
  }
  if (query.equipment_id) {
    params.push(query.equipment_id);
    where.push(`nc.equipment_id = $${params.length}::uuid`);
  }
  if (query.nc_status) {
    params.push(query.nc_status);
    where.push(`nc.status = $${params.length}::text`);
  }
  if (query.severity) {
    params.push(query.severity);
    where.push(`nc.severity = $${params.length}::text`);
  }
  if (query.operator_user_id || query.operator) {
    params.push(query.operator_user_id || query.operator);
    where.push(`(nc.created_by = $${params.length}::uuid OR nc.responsible_user_id = $${params.length}::uuid)`);
  }
  const result = await db.query(
    `SELECT nc.*, nc.origin_type AS source_record_type, nc.origin_record_id AS source_record_id,
            z.name AS zone_name, e.name AS equipment_name,
            ru.email AS responsible_email, cu.email AS created_by_email, clu.email AS closed_by_email,
            t.title AS task_title, o.completed_at AS occurrence_completed_at,
            o.source_record_type AS occurrence_record_type, o.source_record_id AS occurrence_record_id
     FROM quality_non_conformities nc
     LEFT JOIN quality_task_occurrences o ON o.id = nc.occurrence_id AND o.store_id = nc.store_id
     LEFT JOIN quality_tasks t ON t.id = nc.quality_task_id AND t.store_id = nc.store_id
     LEFT JOIN quality_zones z ON z.id = nc.zone_id AND z.store_id = nc.store_id
     LEFT JOIN quality_equipments e ON e.id = nc.equipment_id AND e.store_id = nc.store_id
     LEFT JOIN users ru ON ru.id = nc.responsible_user_id
     LEFT JOIN users cu ON cu.id = nc.created_by
     LEFT JOIN users clu ON clu.id = nc.closed_by
     WHERE ${where.join(' AND ')}
     ORDER BY CASE nc.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
              CASE nc.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
              nc.created_at DESC
     LIMIT 500`,
    params
  );
  return result.rows.map((row) => ({
    ...row,
    record_type: publicTypeFromRecordType(row.source_record_type || row.occurrence_record_type),
    source_record_type: row.source_record_type || row.occurrence_record_type || null,
    source_record_id: row.source_record_id || row.occurrence_record_id || null,
  }));
}

async function listCorrectiveActions(db, storeId, query = {}) {
  const params = [storeId];
  const where = ['a.store_id = $1'];
  if (query.status) {
    params.push(query.status);
    where.push(`a.status = $${params.length}`);
  }
  const result = await db.query(
    `SELECT a.*, nc.title AS non_conformity_title, u.email AS responsible_email
     FROM quality_corrective_actions a
     LEFT JOIN quality_non_conformities nc ON nc.id = a.non_conformity_id AND nc.store_id = a.store_id
     LEFT JOIN users u ON u.id = a.responsible_user_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.due_at ASC NULLS LAST, a.created_at DESC
     LIMIT 200`,
    params
  );
  return result.rows;
}

async function listDdppCorrectiveActions(db, storeId, query = {}) {
  const period = periodFromQuery(query);
  const params = [storeId, period.start, period.end];
  const where = [
    'a.store_id = $1::uuid',
    `(a.status IN ('open', 'in_progress')
      OR (a.completed_at >= $2::timestamptz AND a.completed_at <= $3::timestamptz)
      OR (a.due_at >= $2::timestamptz AND a.due_at <= $3::timestamptz)
      OR (nc.created_at >= $2::timestamptz AND nc.created_at <= $3::timestamptz)
      OR (nc.closed_at >= $2::timestamptz AND nc.closed_at <= $3::timestamptz)
      OR (o.completed_at >= $2::timestamptz AND o.completed_at <= $3::timestamptz))`,
  ];
  const recordType = recordTypeFromPublicType(query.type);
  if (recordType) {
    params.push(recordType);
    where.push(`(nc.origin_type = $${params.length} OR o.source_record_type = $${params.length})`);
  }
  if (query.action_status) {
    params.push(query.action_status);
    where.push(`a.status = $${params.length}::text`);
  }
  if (query.nc_status) {
    params.push(query.nc_status);
    where.push(`nc.status = $${params.length}::text`);
  }
  if (query.severity) {
    params.push(query.severity);
    where.push(`nc.severity = $${params.length}::text`);
  }
  if (query.zone_id) {
    params.push(query.zone_id);
    where.push(`nc.zone_id = $${params.length}::uuid`);
  }
  if (query.equipment_id) {
    params.push(query.equipment_id);
    where.push(`nc.equipment_id = $${params.length}::uuid`);
  }
  if (query.operator_user_id || query.operator) {
    params.push(query.operator_user_id || query.operator);
    where.push(`(a.responsible_user_id = $${params.length}::uuid OR a.completed_by = $${params.length}::uuid)`);
  }
  const result = await db.query(
    `SELECT a.*, nc.title AS non_conformity_title, nc.status AS non_conformity_status,
            nc.severity AS non_conformity_severity, nc.origin_type AS source_record_type,
            nc.origin_record_id AS source_record_id, nc.occurrence_id,
            z.name AS zone_name, e.name AS equipment_name,
            ru.email AS responsible_email, cu.email AS completed_by_email
     FROM quality_corrective_actions a
     LEFT JOIN quality_non_conformities nc ON nc.id = a.non_conformity_id AND nc.store_id = a.store_id
     LEFT JOIN quality_task_occurrences o ON o.id = nc.occurrence_id AND o.store_id = nc.store_id
     LEFT JOIN quality_zones z ON z.id = nc.zone_id AND z.store_id = nc.store_id
     LEFT JOIN quality_equipments e ON e.id = nc.equipment_id AND e.store_id = nc.store_id
     LEFT JOIN users ru ON ru.id = a.responsible_user_id
     LEFT JOIN users cu ON cu.id = a.completed_by
     WHERE ${where.join(' AND ')}
     ORDER BY CASE a.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
              a.due_at ASC NULLS LAST, a.created_at DESC
     LIMIT 500`,
    params
  );
  return result.rows.map((row) => ({
    ...row,
    record_type: publicTypeFromRecordType(row.source_record_type),
  }));
}

async function listCompletedWorkItems(db, storeId, query = {}) {
  const start = query.start_date || startOfDay().toISOString();
  const end = query.end_date || endOfDay().toISOString();
  const params = [storeId, start, end];
  const typeFilter = query.type ? String(query.type) : null;
  const zoneFilter = query.zone_id ? String(query.zone_id) : null;
  const equipmentFilter = query.equipment_id ? String(query.equipment_id) : null;
  const conformityFilter = query.conformity_status ? String(query.conformity_status) : null;
  const operatorFilter = query.operator_user_id || query.operator ? String(query.operator_user_id || query.operator) : null;
  const result = await db.query(
    `SELECT o.id AS occurrence_id, o.task_id AS quality_task_id, o.completed_at, o.completed_by, o.result_status,
            o.source_record_type AS record_type, o.source_record_id, o.comment,
            t.title AS task_title, t.module_key, t.task_origin, t.source_entity_type, t.source_entity_id,
            t.entity_type, t.entity_id, t.target_time, t.criticality, t.source_locked,
            z.name AS zone_name, e.name AS equipment_name, u.email AS completed_by_email,
            tr.value, tr.unit, tr.alert_status, tr.method_used, tr.type_code, tr.operator_user_id, tt.label AS type_label,
            cr.status AS cleaning_status, cr.visual_check_status, cr.anomaly_comment, cr.corrective_action AS cleaning_corrective_action, cr.performed_by AS cleaning_performed_by,
            mr.result_status AS manual_result_status, mr.conformity_status AS manual_conformity_status,
            mr.observation AS manual_observation, mr.corrective_action AS manual_corrective_action, mr.performed_by AS manual_performed_by,
            COALESCE(tr.evidence_photo_id, cr.evidence_photo_id, mr.evidence_photo_id) AS evidence_photo_id,
            COALESCE(tr.evidence_document_id, cr.evidence_document_id, mr.evidence_document_id) AS evidence_document_id,
            COALESCE(tr.comment, cr.comment, mr.observation, o.comment) AS record_comment,
            COALESCE(cr.corrective_action, mr.corrective_action) AS record_corrective_action,
            COALESCE(tt.label, t.title) AS record_title
     FROM quality_task_occurrences o
     INNER JOIN quality_tasks t ON t.id = o.task_id AND t.store_id = o.store_id
     LEFT JOIN quality_zones z ON z.id = CASE WHEN t.entity_type = 'zone' THEN t.entity_id ELSE NULL END AND z.store_id = o.store_id
     LEFT JOIN quality_equipments e ON e.id = CASE WHEN t.entity_type = 'equipment' THEN t.entity_id ELSE NULL END AND e.store_id = o.store_id
     LEFT JOIN users u ON u.id = o.completed_by
     LEFT JOIN quality_temperature_records tr ON tr.id = o.source_record_id AND o.source_record_type = 'quality_temperature_record'
     LEFT JOIN quality_temperature_types tt ON tt.code = tr.type_code
     LEFT JOIN quality_cleaning_records cr ON cr.id = o.source_record_id AND o.source_record_type = 'quality_cleaning_record'
     LEFT JOIN quality_manual_task_records mr ON mr.id = o.source_record_id AND o.source_record_type = 'quality_manual_task_record'
     WHERE o.store_id = $1::uuid AND o.status = 'completed'
       AND o.completed_at >= $2::timestamptz AND o.completed_at <= $3::timestamptz
     ORDER BY o.completed_at DESC
     LIMIT 500`,
    params
  );
  return result.rows
    .map((row) => completedWorkItem({
      ...row,
      value: isTemperatureLikeTask(row) && row.record_type === 'quality_manual_task_record' ? parseTemperatureValue(row.manual_observation || row.record_comment) : row.value,
      unit: isTemperatureLikeTask(row) && row.record_type === 'quality_manual_task_record' ? (row.unit || 'C') : row.unit,
      status: row.cleaning_status || row.manual_result_status || row.result_status,
      conformity_status: row.manual_conformity_status || (row.alert_status ? (row.alert_status === 'out_of_limits' ? 'non_conform' : 'conform') : row.visual_check_status),
      comment: row.record_comment,
      corrective_action: row.record_corrective_action,
      title: row.record_title || row.task_title,
    }, row))
    .filter((item) => !typeFilter || item.type === typeFilter)
    .filter((item) => !zoneFilter || String(item.zone_id || '') === zoneFilter)
    .filter((item) => !equipmentFilter || String(item.equipment_id || '') === equipmentFilter)
    .filter((item) => !operatorFilter || String(item.raw?.completed_by || item.raw?.operator_user_id || item.raw?.cleaning_performed_by || item.raw?.manual_performed_by || '') === operatorFilter)
    .filter((item) => !conformityFilter || String(item.conformity_status || '') === conformityFilter);
}

async function listQualityTodayWork(db, storeId, query = {}) {
  const includeUpcoming = query.include_upcoming !== 'false';
  const [temperatureDue, cleaningDue, tasks, completedItems, nonConformities] = await Promise.all([
    listDueTemperatureReadings(db, storeId, { include_upcoming: includeUpcoming ? 'true' : 'false' }),
    listDueCleaningRecords(db, storeId, { include_upcoming: includeUpcoming ? 'true' : 'false' }),
    listQualityTasks(db, storeId, { active: 'true' }),
    listCompletedWorkItems(db, storeId, query),
    listOpenNonConformities(db, storeId),
  ]);

  const taskById = new Map(tasks.map((task) => [String(task.id), task]));
  const work = [];
  for (const item of temperatureDue) {
    const task = taskById.get(String(item.quality_task_id)) || {};
    const occurrence = await upsertOccurrence(db, storeId, item.quality_task_id, item.next_due_at, { source_entity_type: 'temperature_parameter', source_entity_id: item.parameter_id });
    work.push(normalizeWorkItem('temperature', { ...item, occurrence_id: occurrence?.id || null }, task));
  }
  for (const item of cleaningDue) {
    const task = taskById.get(String(item.quality_task_id)) || {};
    const occurrence = await upsertOccurrence(db, storeId, item.quality_task_id, item.next_due_at, { source_entity_type: 'cleaning_plan', source_entity_id: item.cleaning_plan_id });
    work.push(normalizeWorkItem('cleaning', { ...item, occurrence_id: occurrence?.id || null }, task));
  }
  for (const task of tasks) {
    const type = taskType(task);
    if (task.source_entity_type === 'temperature_parameter' || task.source_entity_type === 'cleaning_plan') continue;
    if (!includeUpcoming && !['due', 'overdue'].includes(task.computed_status)) continue;
    const occurrence = await upsertOccurrence(db, storeId, task.id, task.next_due_at, { source_entity_type: task.source_entity_type, source_entity_id: task.source_entity_id });
    work.push(normalizeWorkItem(type, { occurrence_id: occurrence?.id || null }, task));
  }

  return {
    generated_at: new Date().toISOString(),
    sections: {
      today: work.filter((item) => item.status === 'due'),
      overdue: work.filter((item) => item.status === 'overdue' || item.status === 'late'),
      upcoming: work.filter((item) => item.status === 'planned' && item.frequency_unit !== 'events'),
      event_controls: work.filter((item) => item.frequency_unit === 'events'),
      completed_today: [
        ...completedItems,
      ],
      non_conformities: nonConformities,
    },
    summary: {
      today: work.filter((item) => item.status === 'due').length,
      overdue: work.filter((item) => item.status === 'overdue' || item.status === 'late').length,
      upcoming: work.filter((item) => item.status === 'planned' && item.frequency_unit !== 'events').length,
      event_controls: work.filter((item) => item.frequency_unit === 'events').length,
      completed_today: completedItems.length,
      open_non_conformities: nonConformities.length,
      critical_missing: work.filter((item) => ['high', 'critical'].includes(item.criticality) && ['overdue', 'late'].includes(item.status)).length,
    },
  };
}

async function getDdppDashboard(db, storeId, query = {}) {
  const period = periodFromQuery(query);
  const requestedType = String(query.type || '').trim();
  const includeTemperatures = !requestedType || requestedType === 'temperature';
  const includeCleaning = !requestedType || requestedType === 'cleaning';
  const [today, rawTemperatureRecords, rawCleaningRecords, completedItems, nonConformities, correctiveActions] = await Promise.all([
    listQualityTodayWork(db, storeId, query),
    includeTemperatures ? listTemperatureRecords(db, storeId, { start_date: period.start, end_date: period.end, zone_id: query.zone_id, equipment_id: query.equipment_id, operator_user_id: query.operator_user_id || query.operator, alert_status: query.alert_status }) : Promise.resolve([]),
    includeCleaning ? listCleaningRecords(db, storeId, { start_date: period.start, end_date: period.end, zone_id: query.zone_id, equipment_id: query.equipment_id, operator_user_id: query.operator_user_id || query.operator, status: query.cleaning_status }) : Promise.resolve([]),
    listCompletedWorkItems(db, storeId, query),
    listDdppNonConformities(db, storeId, query),
    listDdppCorrectiveActions(db, storeId, query),
  ]);
  const conformityFilter = String(query.conformity_status || '').trim();
  const temperatureRecords = conformityFilter
    ? rawTemperatureRecords.filter((record) => (record.alert_status === 'out_of_limits' ? 'non_conform' : 'conform') === conformityFilter)
    : rawTemperatureRecords;
  const cleaningRecords = conformityFilter
    ? rawCleaningRecords.filter((record) => String(record.visual_check_status || (['issue', 'not_done'].includes(record.status) ? 'non_conform' : 'conform')) === conformityFilter)
    : rawCleaningRecords;
  const legacyManualTemperatureRecords = completedItems
    .filter((item) => item.type === 'temperature' && item.source_record_type === 'quality_manual_task_record' && item.record_id)
    .map((item) => ({
      id: item.record_id,
      record_id: item.record_id,
      detail_type: item.detail_type || 'manual_task',
      record_type: item.record_type,
      source_record_type: item.source_record_type,
      source_record_id: item.source_record_id,
      occurrence_id: item.occurrence_id,
      quality_task_id: item.quality_task_id,
      recorded_at: item.next_due_at,
      type_label: item.title,
      type_code: 'LEGACY_QF',
      zone_name: item.zone_name,
      equipment_name: item.equipment_name,
      value: item.value,
      unit: item.unit || 'C',
      alert_status: item.conformity_status === 'non_conform' ? 'out_of_limits' : 'compliant',
      comment: item.comment,
      operator_email: item.operator_email,
      legacy_manual_task: true,
    }));
  const ddppTemperatureRecords = [...temperatureRecords, ...legacyManualTemperatureRecords];
  const immediateCorrectiveActions = completedItems
    .filter((item) => item.corrective_action && item.record_id)
    .map((item) => ({
      id: `immediate-${item.record_id}`,
      synthetic: true,
      action: item.corrective_action,
      status: 'completed',
      completed_at: item.next_due_at,
      completed_by_email: item.operator_email,
      quality_task_id: item.quality_task_id,
      occurrence_id: item.occurrence_id,
      non_conformity_title: item.title,
      source_record_type: item.source_record_type,
      source_record_id: item.source_record_id,
      record_type: item.detail_type || item.type,
      responsible_email: item.operator_email,
      effectiveness_check: null,
      due_at: null,
      proof_document_id: item.evidence_document_id,
      proof_photo_id: item.evidence_photo_id,
      created_at: item.next_due_at,
    }));
  const ddppCorrectiveActions = [...correctiveActions, ...immediateCorrectiveActions];
  const openNc = nonConformities.filter((item) => ['open', 'in_progress'].includes(item.status));
  const overdueActions = ddppCorrectiveActions.filter((item) => ['open', 'in_progress'].includes(item.status) && item.due_at && new Date(item.due_at) < new Date());
  const nonCompliantRecords = [
    ...ddppTemperatureRecords.filter((record) => ['out_of_limits', 'warning'].includes(record.alert_status)),
    ...cleaningRecords.filter((record) => ['issue', 'not_done', 'non_conform'].includes(record.status) || record.visual_check_status === 'non_conform'),
    ...completedItems.filter((item) => item.conformity_status === 'non_conform'),
  ].length;
  const expectedControls = today.summary.today + today.summary.overdue + today.summary.upcoming + today.summary.event_controls + completedItems.length;
  const red = today.summary.critical_missing > 0 || openNc.some((item) => ['high', 'critical'].includes(item.severity)) || overdueActions.length > 0;
  const orange = today.summary.overdue > 0 || openNc.length > 0 || nonCompliantRecords > 0;
  return {
    status: red ? 'red' : orange ? 'orange' : 'green',
    period,
    summary: {
      expected_controls: expectedControls,
      completed: completedItems.length,
      overdue: today.summary.overdue,
      non_compliant: nonCompliantRecords,
      open_non_conformities: openNc.length,
      overdue_corrective_actions: overdueActions.length,
    },
    today,
    completed_items: completedItems,
    temperature_records: ddppTemperatureRecords,
    cleaning_records: cleaningRecords,
    non_conformities: nonConformities,
    corrective_actions: ddppCorrectiveActions,
  };
}

async function getLinkedNonConformities(db, storeId, link = {}) {
  const result = await db.query(
    `SELECT nc.*, nc.origin_type AS source_record_type, nc.origin_record_id AS source_record_id,
            z.name AS zone_name, e.name AS equipment_name, ru.email AS responsible_email,
            cu.email AS created_by_email, clu.email AS closed_by_email
     FROM quality_non_conformities nc
     LEFT JOIN quality_zones z ON z.id = nc.zone_id AND z.store_id = nc.store_id
     LEFT JOIN quality_equipments e ON e.id = nc.equipment_id AND e.store_id = nc.store_id
     LEFT JOIN users ru ON ru.id = nc.responsible_user_id
     LEFT JOIN users cu ON cu.id = nc.created_by
     LEFT JOIN users clu ON clu.id = nc.closed_by
     WHERE nc.store_id = $1::uuid
       AND (
         ($2::text IS NOT NULL AND $3::uuid IS NOT NULL AND nc.origin_type = $2::text AND nc.origin_record_id = $3::uuid)
         OR ($4::uuid IS NOT NULL AND nc.occurrence_id = $4::uuid)
         OR ($5::uuid IS NOT NULL AND nc.quality_task_id = $5::uuid)
       )
     ORDER BY nc.created_at DESC
     LIMIT 100`,
    [storeId, link.recordType || null, link.recordId || null, link.occurrenceId || null, link.taskId || null]
  );
  return result.rows;
}

async function getLinkedCorrectiveActions(db, storeId, link = {}, nonConformities = []) {
  const ncIds = nonConformities.map((item) => item.id).filter(Boolean);
  const result = await db.query(
    `SELECT a.*, nc.title AS non_conformity_title, nc.origin_type AS source_record_type,
            nc.origin_record_id AS source_record_id, ru.email AS responsible_email,
            cu.email AS completed_by_email
     FROM quality_corrective_actions a
     LEFT JOIN quality_non_conformities nc ON nc.id = a.non_conformity_id AND nc.store_id = a.store_id
     LEFT JOIN users ru ON ru.id = a.responsible_user_id
     LEFT JOIN users cu ON cu.id = a.completed_by
     WHERE a.store_id = $1::uuid
       AND (
         (cardinality($2::uuid[]) > 0 AND a.non_conformity_id = ANY($2::uuid[]))
         OR ($3::uuid IS NOT NULL AND a.quality_task_id = $3::uuid)
         OR ($4::text IS NOT NULL AND $5::uuid IS NOT NULL AND nc.origin_type = $4::text AND nc.origin_record_id = $5::uuid)
       )
     ORDER BY CASE a.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
              a.due_at ASC NULLS LAST, a.created_at DESC
     LIMIT 100`,
    [storeId, ncIds, link.taskId || null, link.recordType || null, link.recordId || null]
  );
  return result.rows;
}

async function getDdppRecordBase(db, storeId, type, id) {
  if (type === 'temperature') {
    const result = await db.query(
      `SELECT r.*, tt.label AS type_label, z.name AS zone_name, z.code AS zone_code,
              e.name AS equipment_name, e.code AS equipment_code, u.email AS operator_email,
              o.id AS occurrence_id, o.due_at AS occurrence_due_at, o.completed_at AS occurrence_completed_at,
              o.status AS occurrence_status, o.result_status AS occurrence_result_status,
              t.id AS task_id, t.title AS task_title, t.status AS task_status, t.task_origin,
              l.id AS parameter_id
       FROM quality_temperature_records r
       INNER JOIN quality_temperature_types tt ON tt.code = r.type_code
       LEFT JOIN quality_zones z ON z.id = r.zone_id AND z.store_id = r.store_id
       LEFT JOIN quality_equipments e ON e.id = r.equipment_id AND e.store_id = r.store_id
       LEFT JOIN users u ON u.id = r.operator_user_id
       LEFT JOIN quality_task_occurrences o ON o.id = r.occurrence_id AND o.store_id = r.store_id
       LEFT JOIN quality_tasks t ON t.id = r.quality_task_id AND t.store_id = r.store_id
       LEFT JOIN quality_temperature_limits l ON l.id = r.temperature_limit_id AND l.store_id = r.store_id
       WHERE r.id = $1::uuid AND r.store_id = $2::uuid AND r.deleted_at IS NULL
       LIMIT 1`,
      [id, storeId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      record_type: 'quality_temperature_record',
      public_type: 'temperature',
      record: row,
      occurrence: row.occurrence_id ? { id: row.occurrence_id, due_at: row.occurrence_due_at, completed_at: row.occurrence_completed_at, status: row.occurrence_status, result_status: row.occurrence_result_status } : null,
      task: row.task_id ? { id: row.task_id, title: row.task_title, status: row.task_status, task_origin: row.task_origin } : null,
      link: { recordType: 'quality_temperature_record', recordId: row.id, occurrenceId: row.occurrence_id, taskId: row.quality_task_id },
    };
  }
  if (type === 'cleaning') {
    const result = await db.query(
      `SELECT r.*, p.title AS plan_title, p.method, p.product_name, p.dosage_concentration, p.contact_time_minutes,
              p.material_used, p.expected_proof, z.name AS zone_name, e.name AS equipment_name,
              u.email AS performed_by_email, o.id AS occurrence_id, o.due_at AS occurrence_due_at,
              o.completed_at AS occurrence_completed_at, o.status AS occurrence_status,
              t.id AS task_id, t.title AS task_title, t.status AS task_status, t.task_origin,
              COALESCE(z_targets.zones, '[]'::json) AS zones,
              COALESCE(e_targets.equipments, '[]'::json) AS equipments
       FROM quality_cleaning_records r
       INNER JOIN quality_cleaning_plans p ON p.id = r.cleaning_plan_id AND p.store_id = r.store_id
       LEFT JOIN quality_zones z ON z.id = p.zone_id AND z.store_id = p.store_id
       LEFT JOIN quality_equipments e ON e.id = p.equipment_id AND e.store_id = p.store_id
       LEFT JOIN users u ON u.id = r.performed_by
       LEFT JOIN quality_task_occurrences o ON o.id = r.occurrence_id AND o.store_id = r.store_id
       LEFT JOIN quality_tasks t ON t.id = r.quality_task_id AND t.store_id = r.store_id
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('id', lz.id, 'code', lz.code, 'name', lz.name) ORDER BY lz.name ASC) AS zones
         FROM quality_cleaning_plan_zones pz
         INNER JOIN quality_zones lz ON lz.id = pz.zone_id AND lz.store_id = p.store_id
         WHERE pz.plan_id = p.id AND pz.deleted_at IS NULL
       ) z_targets ON true
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('id', le.id, 'code', le.code, 'name', le.name, 'zone_id', le.zone_id) ORDER BY le.name ASC) AS equipments
         FROM quality_cleaning_plan_equipments pe
         INNER JOIN quality_equipments le ON le.id = pe.equipment_id AND le.store_id = p.store_id
         WHERE pe.plan_id = p.id AND pe.deleted_at IS NULL
       ) e_targets ON true
       WHERE r.id = $1::uuid AND r.store_id = $2::uuid
       LIMIT 1`,
      [id, storeId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      record_type: 'quality_cleaning_record',
      public_type: 'cleaning',
      record: row,
      occurrence: row.occurrence_id ? { id: row.occurrence_id, due_at: row.occurrence_due_at, completed_at: row.occurrence_completed_at, status: row.occurrence_status } : null,
      task: row.task_id ? { id: row.task_id, title: row.task_title, status: row.task_status, task_origin: row.task_origin } : null,
      link: { recordType: 'quality_cleaning_record', recordId: row.id, occurrenceId: row.occurrence_id, taskId: row.quality_task_id },
    };
  }
  if (type === 'manual_task' || type === 'manual' || type === 'control') {
    const result = await db.query(
      `SELECT r.*, u.email AS performed_by_email,
              o.id AS occurrence_id, o.due_at AS occurrence_due_at, o.completed_at AS occurrence_completed_at,
              o.status AS occurrence_status, t.id AS task_id, t.title AS task_title, t.status AS task_status,
              t.task_origin, t.module_key, z.name AS zone_name, e.name AS equipment_name
       FROM quality_manual_task_records r
       INNER JOIN quality_tasks t ON t.id = r.quality_task_id AND t.store_id = r.store_id
       LEFT JOIN quality_task_occurrences o ON o.id = r.occurrence_id AND o.store_id = r.store_id
       LEFT JOIN users u ON u.id = r.performed_by
       LEFT JOIN quality_zones z ON z.id = CASE WHEN t.entity_type = 'zone' THEN t.entity_id ELSE NULL END AND z.store_id = r.store_id
       LEFT JOIN quality_equipments e ON e.id = CASE WHEN t.entity_type = 'equipment' THEN t.entity_id ELSE NULL END AND e.store_id = r.store_id
       WHERE r.id = $1::uuid AND r.store_id = $2::uuid
       LIMIT 1`,
      [id, storeId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      record_type: 'quality_manual_task_record',
      public_type: 'manual_task',
      record: row,
      occurrence: row.occurrence_id ? { id: row.occurrence_id, due_at: row.occurrence_due_at, completed_at: row.occurrence_completed_at, status: row.occurrence_status } : null,
      task: row.task_id ? { id: row.task_id, title: row.task_title, status: row.task_status, task_origin: row.task_origin, module_key: row.module_key } : null,
      link: { recordType: 'quality_manual_task_record', recordId: row.id, occurrenceId: row.occurrence_id, taskId: row.quality_task_id },
    };
  }
  return null;
}

async function getDdppRecordDetail(db, storeId, type, id) {
  const base = await getDdppRecordBase(db, storeId, type, id);
  if (!base) return null;
  const nonConformities = await getLinkedNonConformities(db, storeId, base.link);
  const correctiveActions = await getLinkedCorrectiveActions(db, storeId, base.link, nonConformities);
  if (base.record.corrective_action && !correctiveActions.some((item) => String(item.action || '') === String(base.record.corrective_action))) {
    correctiveActions.push({
      id: `immediate-${base.record.id}`,
      synthetic: true,
      action: base.record.corrective_action,
      status: 'completed',
      completed_at: base.record.performed_at || base.record.recorded_at || base.occurrence?.completed_at || null,
      completed_by_email: base.record.performed_by_email || base.record.operator_email || null,
      quality_task_id: base.task?.id || null,
      occurrence_id: base.occurrence?.id || null,
      proof_document_id: base.record.evidence_document_id || base.record.proof_document_id || null,
      proof_photo_id: base.record.evidence_photo_id || base.record.proof_photo_id || null,
      non_conformity_title: base.task?.title || null,
    });
  }
  return {
    type: base.public_type,
    record_type: base.record_type,
    record: base.record,
    occurrence: base.occurrence,
    task: base.task,
    source: {
      record_type: base.record_type,
      record_id: base.record.id,
      occurrence_id: base.occurrence?.id || null,
      quality_task_id: base.task?.id || null,
    },
    non_conformities: nonConformities,
    corrective_actions: correctiveActions,
    attachments: {
      photo_id: base.record.evidence_photo_id || base.record.proof_photo_id || null,
      document_id: base.record.evidence_document_id || base.record.proof_document_id || null,
    },
    operator: base.record.operator_email || base.record.performed_by_email || null,
  };
}

async function getOccurrence(db, storeId, occurrenceId) {
  if (!occurrenceId) return null;
  const result = await db.query(
    `SELECT * FROM quality_task_occurrences WHERE id = $1::uuid AND store_id = $2::uuid LIMIT 1`,
    [occurrenceId, storeId]
  );
  return result.rows[0] || null;
}

async function assertOccurrenceOpen(occurrence) {
  if (!occurrence) return;
  if (occurrence.status === 'completed' || occurrence.source_record_id) {
    throw Object.assign(new Error('Cette occurrence est deja completee'), { status: 409, expose: true });
  }
}

async function resolveOpenOccurrenceForTask(db, storeId, taskId, when, source = {}) {
  if (!taskId) return null;
  const existing = await db.query(
    `SELECT *
     FROM quality_task_occurrences
     WHERE store_id = $1::uuid AND task_id = $2::uuid
       AND status IN ('planned', 'due', 'late')
       AND due_date = ($3::timestamptz)::date
     ORDER BY ABS(EXTRACT(EPOCH FROM (due_at - $3::timestamptz))) ASC
     LIMIT 2`,
    [storeId, taskId, when || new Date().toISOString()]
  );
  if (existing.rows.length > 1) {
    throw Object.assign(new Error('Plusieurs occurrences correspondent: selectionnez le controle attendu'), { status: 409, expose: true });
  }
  if (existing.rows[0]) return existing.rows[0];
  return upsertOccurrence(db, storeId, taskId, when || new Date().toISOString(), source);
}

async function recordTemperatureControl(db, storeId, userId, payload) {
  if (payload.value === undefined || payload.value === null || payload.value === '') {
    throw Object.assign(new Error('Valeur temperature obligatoire'), { status: 400, expose: true });
  }
  return withTransaction(db, async (client) => {
    const occurrence = await getOccurrence(client, storeId, payload.occurrence_id);
    await assertOccurrenceOpen(occurrence);
    const taskId = payload.quality_task_id || occurrence?.task_id || null;
    const task = taskId ? await getQualityTask(client, storeId, taskId) : null;
    if (taskId && task?.task_origin === 'SYSTEM' && task.source_entity_type !== 'temperature_parameter') {
      throw Object.assign(new Error('Cette tache SYSTEM doit etre executee par son formulaire metier'), { status: 409, expose: true });
    }
    const requestedSource = payload.source || (taskId ? 'api' : 'manual');
    const isDirectManualEntry = !taskId && ['exceptional', 'manual'].includes(requestedSource);
    if (!taskId && requestedSource === 'exceptional' && !payload.exceptional_reason && !payload.comment) {
      throw Object.assign(new Error('Motif obligatoire pour une saisie temperature exceptionnelle'), { status: 400, expose: true });
    }
    if (!taskId && !isDirectManualEntry) {
      throw Object.assign(new Error('Tache ou occurrence temperature obligatoire hors saisie exceptionnelle'), { status: 400, expose: true });
    }
    const effectiveOccurrence = occurrence || await resolveOpenOccurrenceForTask(client, storeId, taskId, payload.recorded_at || new Date().toISOString(), { source_entity_type: task?.source_entity_type, source_entity_id: task?.source_entity_id });
    const record = await saveTemperatureRecord(client, storeId, userId, {
      ...payload,
      source: requestedSource,
      quality_task_id: taskId,
      occurrence_id: effectiveOccurrence?.id || null,
      operator_user_id: payload.operator_user_id || userId,
      recorded_at: payload.recorded_at || new Date().toISOString(),
      exceptional_reason: payload.exceptional_reason || payload.comment || null,
    });
    if (effectiveOccurrence?.id) await completeOccurrence(client, storeId, userId, effectiveOccurrence.id, 'quality_temperature_record', record.id, record.alert_status, payload.comment);
    return { record, occurrence: effectiveOccurrence?.id ? await getOccurrence(client, storeId, effectiveOccurrence.id) : null };
  });
}

async function recordCleaningExecution(db, storeId, userId, payload) {
  if (!payload.cleaning_plan_id) throw Object.assign(new Error('Plan de nettoyage obligatoire'), { status: 400, expose: true });
  if (['not_done', 'issue'].includes(payload.status) && !payload.comment && !payload.anomaly_comment) {
    throw Object.assign(new Error('Observation obligatoire pour un nettoyage non conforme ou non realise'), { status: 400, expose: true });
  }
  return withTransaction(db, async (client) => {
    const occurrence = await getOccurrence(client, storeId, payload.occurrence_id);
    await assertOccurrenceOpen(occurrence);
    const taskId = payload.quality_task_id || occurrence?.task_id || null;
    if (!taskId && payload.source === 'exceptional' && !payload.exceptional_reason && !payload.comment) {
      throw Object.assign(new Error('Motif obligatoire pour une saisie nettoyage exceptionnelle'), { status: 400, expose: true });
    }
    const effectiveOccurrence = occurrence || (taskId ? await resolveOpenOccurrenceForTask(client, storeId, taskId, payload.performed_at || new Date().toISOString(), { source_entity_type: 'cleaning_plan', source_entity_id: payload.cleaning_plan_id }) : null);
    const record = await createCleaningRecord(client, storeId, userId, {
      ...payload,
      source: payload.source || (effectiveOccurrence ? 'scheduled' : 'exceptional'),
      skip_task_completion: !effectiveOccurrence,
      quality_task_id: taskId || null,
      occurrence_id: effectiveOccurrence?.id || null,
      performed_by: payload.performed_by || userId,
      performed_at: payload.performed_at || new Date().toISOString(),
      exceptional_reason: payload.exceptional_reason || payload.comment || null,
    });
    if (effectiveOccurrence?.id) await completeOccurrence(client, storeId, userId, effectiveOccurrence.id, 'quality_cleaning_record', record.id, record.status, payload.comment);
    return { record, occurrence: effectiveOccurrence?.id ? await getOccurrence(client, storeId, effectiveOccurrence.id) : null };
  });
}

async function executeTemperatureOccurrence(db, storeId, userId, payload) {
  return recordTemperatureControl(db, storeId, userId, payload);
}

async function executeCleaningOccurrence(db, storeId, userId, payload) {
  return recordCleaningExecution(db, storeId, userId, payload);
}

async function executeManualOccurrence(db, storeId, userId, payload) {
  return withTransaction(db, async (client) => {
    const occurrence = await getOccurrence(client, storeId, payload.occurrence_id);
    const taskId = payload.quality_task_id || occurrence?.task_id || null;
    if (!taskId) throw Object.assign(new Error('Tache manuelle obligatoire'), { status: 400, expose: true });
    const task = await getQualityTask(client, storeId, taskId);
    if (task?.task_origin === 'SYSTEM' && task.source_locked) {
      throw Object.assign(new Error('Une tache SYSTEM verrouillee doit utiliser son formulaire metier'), { status: 409, expose: true });
    }
    const completedAt = payload.completed_at || new Date().toISOString();
    const effectiveOccurrence = occurrence || await upsertOccurrence(client, storeId, taskId, completedAt, { source_entity_type: task?.source_entity_type, source_entity_id: task?.source_entity_id });
    const recordResult = await client.query(
      `INSERT INTO quality_manual_task_records (
        store_id, quality_task_id, occurrence_id, performed_at, performed_by, result_status,
        conformity_status, observation, corrective_action, evidence_photo_id, evidence_document_id
      ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,$5::uuid,$6::text,$7::text,$8::text,$9::text,$10::uuid,$11::uuid)
      RETURNING *`,
      [storeId, taskId, effectiveOccurrence?.id || null, completedAt, payload.performed_by || userId, payload.result_status || 'completed', payload.conformity_status || 'conform', payload.comment || payload.observation || null, payload.corrective_action || null, payload.evidence_photo_id || null, payload.evidence_document_id || null]
    );
    const record = recordResult.rows[0];
    const updated = await updateQualityTaskStatus(client, storeId, userId, taskId, { status: 'completed', comment: payload.comment || payload.observation, completed_at: completedAt });
    if (effectiveOccurrence?.id) await completeOccurrence(client, storeId, userId, effectiveOccurrence.id, 'quality_manual_task_record', record.id, record.conformity_status, payload.comment || payload.observation);
    return { task: updated, record, occurrence: effectiveOccurrence?.id ? await getOccurrence(client, storeId, effectiveOccurrence.id) : null };
  });
}

async function createNonConformity(db, storeId, userId, payload = {}) {
  const originType = payload.origin_type || payload.source_record_type || 'manual';
  const originRecordId = payload.origin_record_id || payload.source_record_id || null;
  const result = await db.query(
    `INSERT INTO quality_non_conformities (
      store_id, origin_type, origin_record_id, quality_task_id, occurrence_id, source_entity_type, source_entity_id,
      zone_id, equipment_id, severity, title, description, immediate_action, responsible_user_id,
      due_at, closure_validation_required, created_by, updated_by
    ) VALUES ($1::uuid,$2::text,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::uuid,$8::uuid,$9::uuid,$10::text,$11::text,$12::text,$13::text,$14::uuid,$15::timestamptz,$16::boolean,$17::uuid,$17::uuid)
    RETURNING *`,
    [storeId, originType, originRecordId, payload.quality_task_id || null, payload.occurrence_id || null, payload.source_entity_type || null, payload.source_entity_id || null, payload.zone_id || null, payload.equipment_id || null, payload.severity || 'medium', payload.title || 'Non-conformite qualite', payload.description, payload.immediate_action || null, payload.responsible_user_id || null, payload.due_at || null, payload.closure_validation_required === true, userId]
  );
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.non_conformity.created', targetType: 'quality_non_conformity', targetId: result.rows[0].id, after: result.rows[0] });
  return result.rows[0];
}

async function createCorrectiveAction(db, storeId, userId, payload = {}) {
  const result = await db.query(
    `INSERT INTO quality_corrective_actions (
      store_id, non_conformity_id, quality_task_id, action, responsible_user_id, due_at,
      proof_document_id, proof_photo_id, effectiveness_check, validation_comment, created_by, updated_by
    ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::timestamptz,$7::uuid,$8::uuid,$9::text,$10::text,$11::uuid,$11::uuid)
    RETURNING *`,
    [storeId, payload.non_conformity_id || null, payload.quality_task_id || null, payload.action, payload.responsible_user_id || null, payload.due_at || null, payload.proof_document_id || null, payload.proof_photo_id || null, payload.effectiveness_check || null, payload.validation_comment || null, userId]
  );
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.corrective_action.created', targetType: 'quality_corrective_action', targetId: result.rows[0].id, after: result.rows[0] });
  return result.rows[0];
}

async function closeNonConformity(db, storeId, userId, id, payload = {}) {
  const result = await db.query(
    `UPDATE quality_non_conformities
     SET status='closed', closed_at=now(), closed_by=$3::uuid, closure_comment=$4::text,
         updated_by=$3::uuid, updated_at=now()
     WHERE id=$1::uuid AND store_id=$2::uuid
     RETURNING *`,
    [id, storeId, userId, payload.closure_comment || payload.comment || null]
  );
  if (!result.rows[0]) return null;
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.non_conformity.closed', targetType: 'quality_non_conformity', targetId: result.rows[0].id, after: result.rows[0] });
  return result.rows[0];
}

module.exports = {
  closeNonConformity,
  createCorrectiveAction,
  createNonConformity,
  executeCleaningOccurrence,
  executeManualOccurrence,
  executeTemperatureOccurrence,
  getDdppDashboard,
  getDdppRecordDetail,
  listCompletedWorkItems,
  listCorrectiveActions,
  listDdppCorrectiveActions,
  listDdppNonConformities,
  listOpenNonConformities,
  listQualityTodayWork,
  recordCleaningExecution,
  recordTemperatureControl,
  upsertOccurrence,
};
