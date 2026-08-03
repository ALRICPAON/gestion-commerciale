const { createCleaningRecord, listDueCleaningRecords, listCleaningRecords } = require('./cleaning');
const { completeQualityTask, getQualityTask, listQualityTasks, updateQualityTaskStatus } = require('./tasks');
const { listDueTemperatureReadings, listTemperatureRecords, saveTemperatureRecord } = require('./temperatures');
const { logQualityEvent } = require('./eventLogger');

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
  if (task.module_key === 'temperature' || task.source_entity_type === 'temperature_parameter') return 'temperature';
  if (task.module_key === 'cleaning' || task.source_entity_type === 'cleaning_plan') return 'cleaning';
  if (task.task_origin === 'MANUAL') return 'manual';
  return 'control';
}

function actionLabel(type) {
  return {
    temperature: 'Saisir le releve',
    cleaning: 'Realiser le nettoyage',
    manual: 'Realiser la tache',
    control: 'Effectuer le controle',
  }[type] || 'Effectuer le controle';
}

function normalizeWorkItem(source, item, task = {}) {
  const type = source || taskType(task);
  const dueAt = item.next_due_at || task.next_due_at || null;
  return {
    id: item.occurrence_id || item.quality_task_id || item.task_id || item.cleaning_plan_id || item.limit_id || task.id,
    occurrence_id: item.occurrence_id || null,
    quality_task_id: item.quality_task_id || item.task_id || task.id || null,
    type,
    title: item.task_title || item.title || task.title || 'Controle qualite',
    source_entity_type: item.source_entity_type || task.source_entity_type || (type === 'temperature' ? 'temperature_parameter' : type === 'cleaning' ? 'cleaning_plan' : null),
    source_entity_id: item.parameter_id || item.limit_id || item.cleaning_plan_id || item.plan_id || task.source_entity_id || null,
    zone_id: item.zone_id || (task.entity_type === 'zone' ? task.entity_id : null),
    zone_name: item.zone_name || null,
    equipment_id: item.equipment_id || (task.entity_type === 'equipment' ? task.entity_id : null),
    equipment_name: item.equipment_name || null,
    target_time: item.target_time || task.target_time || null,
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

async function listQualityTodayWork(db, storeId, query = {}) {
  const includeUpcoming = query.include_upcoming !== 'false';
  const [temperatureDue, cleaningDue, tasks, temperatureRecords, cleaningRecords, nonConformities] = await Promise.all([
    listDueTemperatureReadings(db, storeId, { include_upcoming: includeUpcoming ? 'true' : 'false' }),
    listDueCleaningRecords(db, storeId, { include_upcoming: includeUpcoming ? 'true' : 'false' }),
    listQualityTasks(db, storeId, { active: 'true' }),
    listTemperatureRecords(db, storeId, { start_date: startOfDay().toISOString(), end_date: endOfDay().toISOString() }),
    listCleaningRecords(db, storeId, { start_date: startOfDay().toISOString(), end_date: endOfDay().toISOString() }),
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
    if (['temperature', 'cleaning'].includes(taskType(task))) continue;
    if (!includeUpcoming && !['due', 'overdue'].includes(task.computed_status)) continue;
    const occurrence = await upsertOccurrence(db, storeId, task.id, task.next_due_at, { source_entity_type: task.source_entity_type, source_entity_id: task.source_entity_id });
    work.push(normalizeWorkItem(taskType(task), { occurrence_id: occurrence?.id || null }, task));
  }

  return {
    generated_at: new Date().toISOString(),
    sections: {
      today: work.filter((item) => item.status === 'due'),
      overdue: work.filter((item) => item.status === 'overdue' || item.status === 'late'),
      upcoming: work.filter((item) => item.status === 'planned'),
      completed_today: [
        ...temperatureRecords.map((record) => normalizeWorkItem('temperature', { ...record, title: record.type_label, next_due_at: record.recorded_at, computed_status: 'completed' })),
        ...cleaningRecords.map((record) => normalizeWorkItem('cleaning', { ...record, title: record.plan_title, next_due_at: record.performed_at, computed_status: 'completed' })),
      ],
      non_conformities: nonConformities,
    },
    summary: {
      today: work.filter((item) => item.status === 'due').length,
      overdue: work.filter((item) => item.status === 'overdue' || item.status === 'late').length,
      upcoming: work.filter((item) => item.status === 'planned').length,
      completed_today: temperatureRecords.length + cleaningRecords.length,
      open_non_conformities: nonConformities.length,
      critical_missing: work.filter((item) => ['high', 'critical'].includes(item.criticality) && ['overdue', 'late'].includes(item.status)).length,
    },
  };
}

async function getDdppDashboard(db, storeId, query = {}) {
  const [today, temperatureRecords, cleaningRecords, correctiveActions] = await Promise.all([
    listQualityTodayWork(db, storeId, query),
    listTemperatureRecords(db, storeId, { start_date: query.start_date || startOfDay().toISOString(), end_date: query.end_date || endOfDay().toISOString() }),
    listCleaningRecords(db, storeId, { start_date: query.start_date || startOfDay().toISOString(), end_date: query.end_date || endOfDay().toISOString() }),
    listCorrectiveActions(db, storeId, { status: query.action_status }),
  ]);
  const red = today.summary.critical_missing > 0 || today.sections.non_conformities.some((item) => ['high', 'critical'].includes(item.severity));
  const orange = today.summary.overdue > 0 || today.summary.open_non_conformities > 0;
  return {
    status: red ? 'red' : orange ? 'orange' : 'green',
    today,
    temperature_records: temperatureRecords,
    cleaning_records: cleaningRecords,
    corrective_actions: correctiveActions,
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

async function executeTemperatureOccurrence(db, storeId, userId, payload) {
  const occurrence = await getOccurrence(db, storeId, payload.occurrence_id);
  const taskId = payload.quality_task_id || occurrence?.task_id || null;
  if (!taskId) throw Object.assign(new Error('Tache temperature obligatoire'), { status: 400, expose: true });
  const task = await getQualityTask(db, storeId, taskId);
  if (task?.task_origin === 'SYSTEM' && task.source_entity_type !== 'temperature_parameter') {
    throw Object.assign(new Error('Cette tache SYSTEM doit etre executee par son formulaire metier'), { status: 409, expose: true });
  }
  const record = await saveTemperatureRecord(db, storeId, userId, { ...payload, quality_task_id: taskId, occurrence_id: occurrence?.id || payload.occurrence_id || null });
  if (occurrence?.id) await completeOccurrence(db, storeId, userId, occurrence.id, 'quality_temperature_record', record.id, record.alert_status, payload.comment);
  return { record, occurrence: occurrence?.id ? await getOccurrence(db, storeId, occurrence.id) : null };
}

async function executeCleaningOccurrence(db, storeId, userId, payload) {
  const occurrence = await getOccurrence(db, storeId, payload.occurrence_id);
  const taskId = payload.quality_task_id || occurrence?.task_id || null;
  const record = await createCleaningRecord(db, storeId, userId, { ...payload, quality_task_id: taskId, occurrence_id: occurrence?.id || payload.occurrence_id || null });
  if (occurrence?.id) await completeOccurrence(db, storeId, userId, occurrence.id, 'quality_cleaning_record', record.id, record.status, payload.comment);
  return { record, occurrence: occurrence?.id ? await getOccurrence(db, storeId, occurrence.id) : null };
}

async function executeManualOccurrence(db, storeId, userId, payload) {
  const occurrence = await getOccurrence(db, storeId, payload.occurrence_id);
  const taskId = payload.quality_task_id || occurrence?.task_id || null;
  if (!taskId) throw Object.assign(new Error('Tache manuelle obligatoire'), { status: 400, expose: true });
  const task = await getQualityTask(db, storeId, taskId);
  if (task?.task_origin === 'SYSTEM' && task.source_locked) {
    throw Object.assign(new Error('Une tache SYSTEM verrouillee doit utiliser son formulaire metier'), { status: 409, expose: true });
  }
  const updated = await updateQualityTaskStatus(db, storeId, userId, taskId, { status: 'completed', comment: payload.comment, completed_at: payload.completed_at || new Date().toISOString() });
  if (occurrence?.id) await completeOccurrence(db, storeId, userId, occurrence.id, 'quality_task_history', null, payload.result_status || 'completed', payload.comment);
  return { task: updated, occurrence: occurrence?.id ? await getOccurrence(db, storeId, occurrence.id) : null };
}

async function createNonConformity(db, storeId, userId, payload = {}) {
  const result = await db.query(
    `INSERT INTO quality_non_conformities (
      store_id, origin_type, origin_record_id, quality_task_id, occurrence_id, source_entity_type, source_entity_id,
      zone_id, equipment_id, severity, title, description, immediate_action, responsible_user_id,
      due_at, closure_validation_required, created_by, updated_by
    ) VALUES ($1::uuid,$2::text,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::uuid,$8::uuid,$9::uuid,$10::text,$11::text,$12::text,$13::text,$14::uuid,$15::timestamptz,$16::boolean,$17::uuid,$17::uuid)
    RETURNING *`,
    [storeId, payload.origin_type || 'manual', payload.origin_record_id || null, payload.quality_task_id || null, payload.occurrence_id || null, payload.source_entity_type || null, payload.source_entity_id || null, payload.zone_id || null, payload.equipment_id || null, payload.severity || 'medium', payload.title || 'Non-conformite qualite', payload.description, payload.immediate_action || null, payload.responsible_user_id || null, payload.due_at || null, payload.closure_validation_required === true, userId]
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
  listCorrectiveActions,
  listOpenNonConformities,
  listQualityTodayWork,
  upsertOccurrence,
};
