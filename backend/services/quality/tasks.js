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
  const nextDueAt = resolveNextDue(payload);

  const result = taskId
    ? await db.query(
      `UPDATE quality_tasks
       SET title=$3, description=$4, module_key=$5, entity_type=$6, entity_id=$7,
           responsible_user_id=$8, frequency_value=$9, frequency_unit=$10,
           target_time=$11, next_due_at=$12, status=$13, active=$14, updated_at=now()
       WHERE id=$1 AND store_id=$2
       RETURNING *`,
      [
        taskId,
        storeId,
        payload.title,
        payload.description,
        payload.module_key,
        payload.entity_type,
        payload.entity_id,
        payload.responsible_user_id,
        payload.frequency_value,
        payload.frequency_unit,
        payload.target_time,
        nextDueAt,
        payload.status,
        payload.active,
      ]
    )
    : await db.query(
      `INSERT INTO quality_tasks (
        store_id, title, description, module_key, entity_type, entity_id,
        responsible_user_id, frequency_value, frequency_unit, target_time,
        next_due_at, status, active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *`,
      [
        storeId,
        payload.title,
        payload.description,
        payload.module_key,
        payload.entity_type,
        payload.entity_id,
        payload.responsible_user_id,
        payload.frequency_value,
        payload.frequency_unit,
        payload.target_time,
        nextDueAt,
        payload.status,
        payload.active,
      ]
    );

  const task = await getQualityTask(db, storeId, result.rows[0].id);
  await logEvent(db, storeId, userId, taskId ? 'quality.task.updated' : 'quality.task.created', task.id, before, task);
  return task;
}

async function updateQualityTaskStatus(db, storeId, userId, taskId, payload) {
  const before = await getQualityTask(db, storeId, taskId);
  if (!before) return null;

  const completedAt = payload.status === 'completed' ? new Date() : before.last_completed_at;
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
    ) VALUES ($1,$2,$3,now(),$4,$5,$6,$7)`,
    [storeId, taskId, userId, payload.comment, payload.status, before.next_due_at, nextDueAt]
  );

  const task = await getQualityTask(db, storeId, result.rows[0].id);
  await logEvent(db, storeId, userId, 'quality.task.status.updated', task.id, before, task);
  return task;
}

async function deactivateQualityTask(db, storeId, userId, taskId) {
  const before = await getQualityTask(db, storeId, taskId);
  if (!before) return null;
  const result = await db.query(
    `UPDATE quality_tasks
     SET active=false, status='paused', updated_at=now()
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
  deactivateQualityTask,
  getQualityTask,
  getQualityTaskSummary,
  listQualityTasks,
  saveQualityTask,
  updateQualityTaskStatus,
};
