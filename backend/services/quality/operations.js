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

async function listCompletedWorkItems(db, storeId, query = {}) {
  const start = query.start_date || startOfDay().toISOString();
  const end = query.end_date || endOfDay().toISOString();
  const params = [storeId, start, end];
  const typeFilter = query.type ? String(query.type) : null;
  const zoneFilter = query.zone_id ? String(query.zone_id) : null;
  const equipmentFilter = query.equipment_id ? String(query.equipment_id) : null;
  const conformityFilter = query.conformity_status ? String(query.conformity_status) : null;
  const result = await db.query(
    `SELECT o.id AS occurrence_id, o.task_id AS quality_task_id, o.completed_at, o.result_status,
            o.source_record_type AS record_type, o.source_record_id, o.comment,
            t.title AS task_title, t.module_key, t.task_origin, t.source_entity_type, t.source_entity_id,
            t.entity_type, t.entity_id, t.target_time, t.criticality, t.source_locked,
            z.name AS zone_name, e.name AS equipment_name, u.email AS completed_by_email,
            tr.value, tr.unit, tr.alert_status, tr.method_used, tr.type_code, tt.label AS type_label,
            cr.status AS cleaning_status, cr.visual_check_status, cr.anomaly_comment, cr.corrective_action AS cleaning_corrective_action,
            mr.result_status AS manual_result_status, mr.conformity_status AS manual_conformity_status,
            mr.observation AS manual_observation, mr.corrective_action AS manual_corrective_action,
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
      status: row.cleaning_status || row.manual_result_status || row.result_status,
      conformity_status: row.manual_conformity_status || (row.alert_status ? (row.alert_status === 'out_of_limits' ? 'non_conform' : 'conform') : row.visual_check_status),
      comment: row.record_comment,
      corrective_action: row.record_corrective_action,
      title: row.record_title || row.task_title,
    }, row))
    .filter((item) => !typeFilter || item.type === typeFilter)
    .filter((item) => !zoneFilter || String(item.zone_id || '') === zoneFilter)
    .filter((item) => !equipmentFilter || String(item.equipment_id || '') === equipmentFilter)
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
  const [today, temperatureRecords, cleaningRecords, completedItems, correctiveActions] = await Promise.all([
    listQualityTodayWork(db, storeId, query),
    listTemperatureRecords(db, storeId, { start_date: query.start_date || startOfDay().toISOString(), end_date: query.end_date || endOfDay().toISOString() }),
    listCleaningRecords(db, storeId, { start_date: query.start_date || startOfDay().toISOString(), end_date: query.end_date || endOfDay().toISOString() }),
    listCompletedWorkItems(db, storeId, query),
    listCorrectiveActions(db, storeId, { status: query.action_status }),
  ]);
  const red = today.summary.critical_missing > 0 || today.sections.non_conformities.some((item) => ['high', 'critical'].includes(item.severity));
  const orange = today.summary.overdue > 0 || today.summary.open_non_conformities > 0;
  return {
    status: red ? 'red' : orange ? 'orange' : 'green',
    today,
    completed_items: completedItems,
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
    if (!taskId && payload.source === 'exceptional' && !payload.exceptional_reason && !payload.comment) {
      throw Object.assign(new Error('Motif obligatoire pour une saisie temperature exceptionnelle'), { status: 400, expose: true });
    }
    if (!taskId && payload.source !== 'exceptional') {
      throw Object.assign(new Error('Tache ou occurrence temperature obligatoire hors saisie exceptionnelle'), { status: 400, expose: true });
    }
    const effectiveOccurrence = occurrence || await resolveOpenOccurrenceForTask(client, storeId, taskId, payload.recorded_at || new Date().toISOString(), { source_entity_type: task?.source_entity_type, source_entity_id: task?.source_entity_id });
    const record = await saveTemperatureRecord(client, storeId, userId, {
      ...payload,
      source: payload.source || (effectiveOccurrence ? 'scheduled' : 'exceptional'),
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
  listCompletedWorkItems,
  listCorrectiveActions,
  listOpenNonConformities,
  listQualityTodayWork,
  recordCleaningExecution,
  recordTemperatureControl,
  upsertOccurrence,
};
