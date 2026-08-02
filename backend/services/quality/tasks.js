const { logQualityEvent } = require('./eventLogger');
const {
  calculateNextDueAt,
  enrichTask,
  resolveTaskStatus,
} = require('./taskScheduler');

function addFilter(where, params, value, sql) {
  if (value !== undefined && value !== null && value !== '') {
    params.push(value);
    where.push(sql(params.length));
  }
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function taskPayloadValue(payload, before, key, fallback = null) {
  if (hasOwn(payload, key)) return payload[key];
  if (before && hasOwn(before, key)) return before[key];
  return fallback;
}

function normalizeQualityTaskPayload(payload = {}, before = null) {
  return {
    title: taskPayloadValue(payload, before, 'title'),
    description: taskPayloadValue(payload, before, 'description'),
    module_key: taskPayloadValue(payload, before, 'module_key'),
    entity_type: taskPayloadValue(payload, before, 'entity_type'),
    entity_id: taskPayloadValue(payload, before, 'entity_id'),
    responsible_user_id: taskPayloadValue(payload, before, 'responsible_user_id'),
    frequency_value: taskPayloadValue(payload, before, 'frequency_value'),
    frequency_unit: taskPayloadValue(payload, before, 'frequency_unit'),
    target_time: taskPayloadValue(payload, before, 'target_time'),
    status: taskPayloadValue(payload, before, 'status', 'planned'),
    active: taskPayloadValue(payload, before, 'active', true),
    category: taskPayloadValue(payload, before, 'category'),
    responsible_role: taskPayloadValue(payload, before, 'responsible_role'),
    criticality: taskPayloadValue(payload, before, 'criticality'),
    execution_method: taskPayloadValue(payload, before, 'execution_method'),
    verification_method: taskPayloadValue(payload, before, 'verification_method'),
    proof_required: taskPayloadValue(payload, before, 'proof_required', false) === true,
    photo_required: taskPayloadValue(payload, before, 'photo_required', false) === true,
    instructions: taskPayloadValue(payload, before, 'instructions'),
    acceptance_criteria: taskPayloadValue(payload, before, 'acceptance_criteria'),
    deviation_action: taskPayloadValue(payload, before, 'deviation_action'),
    configuration_status: taskPayloadValue(payload, before, 'configuration_status', 'active'),
    created_source: taskPayloadValue(payload, before, 'created_source', 'human'),
    created_by_agent: taskPayloadValue(payload, before, 'created_by_agent', false) === true,
    agent_action_id: taskPayloadValue(payload, before, 'agent_action_id'),
  };
}

async function logEvent(db, storeId, actorId, eventType, targetId, before, after) {
  await logQualityEvent({
    dbPool: db,
    storeId,
    actorId,
    eventType,
    targetType: 'quality_task',
    targetId,
    before,
    after,
  });
}

function selectTaskSql(whereSql) {
  return `SELECT t.*, u.email AS responsible_email
          FROM quality_tasks t
          LEFT JOIN users u ON u.id = t.responsible_user_id
          WHERE ${whereSql}`;
}

async function listQualityTasks(db, storeId, query = {}) {
  const params = [storeId];
  const where = ['t.store_id = $1'];

  addFilter(where, params, query.module || query.module_key, (i) => `t.module_key = $${i}`);
  addFilter(where, params, query.responsible || query.responsible_user_id, (i) => `t.responsible_user_id = $${i}`);
  addFilter(where, params, query.status, (i) => `t.status = $${i}`);
  addFilter(where, params, query.entity_type, (i) => `t.entity_type = $${i}`);
  addFilter(where, params, query.entity_id, (i) => `t.entity_id = $${i}`);
  if (query.active !== undefined && query.active !== '') {
    params.push(query.active === 'true' || query.active === true);
    where.push(`t.active = $${params.length}`);
  }

  const result = await db.query(
    `${selectTaskSql(where.join(' AND '))}
     ORDER BY t.active DESC, t.next_due_at ASC NULLS LAST, t.created_at DESC
     LIMIT 500`,
    params
  );
  return result.rows.map((task) => enrichTask(task));
}

async function getQualityTask(db, storeId, taskId) {
  const result = await db.query(
    `${selectTaskSql('t.id = $1 AND t.store_id = $2')} LIMIT 1`,
    [taskId, storeId]
  );
  return enrichTask(result.rows[0] || null);
}

function resolveNextDue(payload) {
  if (payload.next_due_at) return new Date(payload.next_due_at);
  return calculateNextDueAt({
    fromDate: new Date(),
    frequencyValue: payload.frequency_value,
    frequencyUnit: payload.frequency_unit,
    targetTime: payload.target_time,
  });
}

async function saveQualityTask(db, storeId, userId, payload, taskId = null) {
  const before = taskId ? await getQualityTask(db, storeId, taskId) : null;
  if (taskId && !before) return null;
  const normalized = normalizeQualityTaskPayload(payload, before);
  const nextDueAt = resolveNextDue(normalized);

  const result = taskId
    ? await db.query(
      `UPDATE quality_tasks
       SET title=$3::text, description=$4::text, module_key=$5::text, entity_type=$6::text, entity_id=$7::uuid,
           responsible_user_id=$8::uuid, frequency_value=$9::integer, frequency_unit=$10::text,
           target_time=$11::time, next_due_at=$12::timestamptz, status=$13::text, active=$14::boolean,
           category=$15::text, responsible_role=$16::text, criticality=$17::text,
           execution_method=$18::text, verification_method=$19::text, proof_required=$20::boolean,
           photo_required=$21::boolean, instructions=$22::text, acceptance_criteria=$23::text,
           deviation_action=$24::text, configuration_status=$25::text, created_source=$26::text,
           created_by_agent=$27::boolean, agent_action_id=$28::text, updated_at=now()
       WHERE id=$1::uuid AND store_id=$2::uuid
       RETURNING *`,
      [
        taskId,
        storeId,
        normalized.title,
        normalized.description,
        normalized.module_key,
        normalized.entity_type,
        normalized.entity_id,
        normalized.responsible_user_id,
        normalized.frequency_value,
        normalized.frequency_unit,
        normalized.target_time,
        nextDueAt,
        normalized.status,
        normalized.active,
        normalized.category,
        normalized.responsible_role,
        normalized.criticality,
        normalized.execution_method,
        normalized.verification_method,
        normalized.proof_required,
        normalized.photo_required,
        normalized.instructions,
        normalized.acceptance_criteria,
        normalized.deviation_action,
        normalized.configuration_status,
        normalized.created_source,
        normalized.created_by_agent,
        normalized.agent_action_id,
      ]
    )
    : await db.query(
      `INSERT INTO quality_tasks (
        store_id, title, description, module_key, entity_type, entity_id,
        responsible_user_id, frequency_value, frequency_unit, target_time,
        next_due_at, status, active, category, responsible_role, criticality,
        execution_method, verification_method, proof_required, photo_required,
        instructions, acceptance_criteria, deviation_action, configuration_status,
        created_source, created_by_agent, agent_action_id
      ) VALUES (
        $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::uuid,$7::uuid,
        $8::integer,$9::text,$10::time,$11::timestamptz,$12::text,$13::boolean,
        $14::text,$15::text,$16::text,$17::text,$18::text,$19::boolean,
        $20::boolean,$21::text,$22::text,$23::text,$24::text,$25::text,
        $26::boolean,$27::text
      )
      RETURNING *`,
      [
        storeId,
        normalized.title,
        normalized.description,
        normalized.module_key,
        normalized.entity_type,
        normalized.entity_id,
        normalized.responsible_user_id,
        normalized.frequency_value,
        normalized.frequency_unit,
        normalized.target_time,
        nextDueAt,
        normalized.status,
        normalized.active,
        normalized.category,
        normalized.responsible_role,
        normalized.criticality,
        normalized.execution_method,
        normalized.verification_method,
        normalized.proof_required,
        normalized.photo_required,
        normalized.instructions,
        normalized.acceptance_criteria,
        normalized.deviation_action,
        normalized.configuration_status,
        normalized.created_source,
        normalized.created_by_agent,
        normalized.agent_action_id,
      ]
    );

  const task = await getQualityTask(db, storeId, result.rows[0].id);
  await logEvent(db, storeId, userId, taskId ? 'quality.task.updated' : 'quality.task.created', task.id, before, task);
  return task;
}

async function updateQualityTaskStatus(db, storeId, userId, taskId, payload) {
  const before = await getQualityTask(db, storeId, taskId);
  if (!before) return null;

  const completedAt = payload.status === 'completed' ? new Date(payload.completed_at || new Date()) : before.last_completed_at;
  const nextDueAt = payload.next_due_at
    ? new Date(payload.next_due_at)
    : payload.status === 'completed'
      ? calculateNextDueAt({
        fromDate: completedAt,
        frequencyValue: before.frequency_value,
        frequencyUnit: before.frequency_unit,
        targetTime: before.target_time,
      })
      : before.next_due_at;

  const storedStatus = payload.status === 'completed' && nextDueAt ? 'planned' : payload.status;
  const result = await db.query(
    `UPDATE quality_tasks
     SET status=$3, last_completed_at=$4, next_due_at=$5, updated_at=now()
     WHERE id=$1 AND store_id=$2
     RETURNING *`,
    [taskId, storeId, storedStatus, completedAt, nextDueAt]
  );

  await db.query(
    `INSERT INTO quality_task_history (
      store_id, task_id, user_id, completed_at, comment, status, previous_due_at, next_due_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [storeId, taskId, userId, completedAt, payload.comment, payload.status, before.next_due_at, nextDueAt]
  );

  const task = await getQualityTask(db, storeId, result.rows[0].id);
  await logEvent(db, storeId, userId, 'quality.task.status.updated', task.id, before, task);
  return task;
}

async function completeQualityTask(db, storeId, userId, taskId, comment = null, completedAt = new Date()) {
  return updateQualityTaskStatus(db, storeId, userId, taskId, {
    status: 'completed',
    comment,
    completed_at: completedAt,
  });
}

async function deactivateQualityTask(db, storeId, userId, taskId) {
  const before = await getQualityTask(db, storeId, taskId);
  if (!before) return null;
  const result = await db.query(
    `UPDATE quality_tasks
     SET active=false, status='paused', configuration_status='inactive', updated_at=now()
     WHERE id=$1 AND store_id=$2
     RETURNING *`,
    [taskId, storeId]
  );
  const task = await getQualityTask(db, storeId, result.rows[0].id);
  await logEvent(db, storeId, userId, 'quality.task.deactivated', task.id, before, task);
  return task;
}

async function getQualityTaskSummary(db, storeId) {
  const result = await db.query(
    `SELECT id, active, status, next_due_at
     FROM quality_tasks
     WHERE store_id = $1 AND active = true`,
    [storeId]
  );
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const rows = result.rows.map((task) => ({
    ...task,
    computed_status: resolveTaskStatus(task, today),
  }));

  return {
    today: rows.filter((task) => task.computed_status === 'due').length,
    overdue: rows.filter((task) => task.computed_status === 'overdue').length,
    upcoming: rows.filter((task) => {
      if (!task.next_due_at) return false;
      const dueAt = new Date(task.next_due_at);
      return dueAt >= tomorrow && task.computed_status === 'planned';
    }).length,
  };
}

module.exports = {
  completeQualityTask,
  deactivateQualityTask,
  getQualityTask,
  getQualityTaskSummary,
  listQualityTasks,
  saveQualityTask,
  normalizeQualityTaskPayload,
  updateQualityTaskStatus,
};
