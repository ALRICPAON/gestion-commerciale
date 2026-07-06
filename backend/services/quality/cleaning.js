const { logQualityEvent } = require('./eventLogger');
const { completeQualityTask } = require('./tasks');
const { enrichTask } = require('./taskScheduler');

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
    targetType: 'quality_cleaning_plan',
    targetId,
    before,
    after,
  });
}

function taskSelectSql() {
  return `qt.id AS task_id, qt.title AS task_title, qt.frequency_value AS task_frequency_value,
          qt.frequency_unit AS task_frequency_unit, qt.target_time AS task_target_time,
          qt.next_due_at AS task_next_due_at, qt.last_completed_at AS task_last_completed_at,
          qt.status AS task_status, qt.active AS task_active, qtu.email AS task_responsible_email`;
}

function attachTask(row) {
  if (!row) return null;
  if (!row.task_id) return { ...row, quality_task: null };
  return {
    ...row,
    quality_task: enrichTask({
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
    }),
  };
}

function planSelectSql(whereSql) {
  return `SELECT p.*, z.code AS zone_code, z.name AS zone_name,
                 e.code AS equipment_code, e.name AS equipment_name,
                 ${taskSelectSql()}
          FROM quality_cleaning_plans p
          LEFT JOIN quality_zones z ON z.id = p.zone_id AND z.store_id = p.store_id
          LEFT JOIN quality_equipments e ON e.id = p.equipment_id AND e.store_id = p.store_id
          LEFT JOIN quality_tasks qt ON qt.id = p.quality_task_id AND qt.store_id = p.store_id
          LEFT JOIN users qtu ON qtu.id = qt.responsible_user_id
          WHERE ${whereSql}`;
}

async function assertCleaningTask(db, storeId, taskId) {
  if (!taskId) return null;
  const result = await db.query(
    `SELECT id FROM quality_tasks
     WHERE id = $1 AND store_id = $2 AND module_key = 'cleaning'
     LIMIT 1`,
    [taskId, storeId]
  );
  if (result.rows[0]) return taskId;
  const err = new Error('Tâche qualité nettoyage introuvable');
  err.status = 400;
  throw err;
}

async function listCleaningPlans(db, storeId, query = {}) {
  const params = [storeId];
  const where = ['p.store_id = $1'];
  addFilter(where, params, query.zone_id, (i) => `p.zone_id = $${i}`);
  addFilter(where, params, query.equipment_id, (i) => `p.equipment_id = $${i}`);
  addFilter(where, params, query.quality_task_id, (i) => `p.quality_task_id = $${i}`);
  if (query.active !== undefined && query.active !== '') {
    params.push(query.active === 'true' || query.active === true);
    where.push(`p.active = $${params.length}`);
  }
  const result = await db.query(
    `${planSelectSql(where.join(' AND '))}
     ORDER BY p.active DESC, qt.next_due_at ASC NULLS LAST, p.title ASC`,
    params
  );
  return result.rows.map(attachTask);
}

async function getCleaningPlan(db, storeId, planId) {
  const result = await db.query(
    `${planSelectSql('p.id = $1 AND p.store_id = $2')} LIMIT 1`,
    [planId, storeId]
  );
  return attachTask(result.rows[0] || null);
}

async function saveCleaningPlan(db, storeId, userId, payload, planId = null) {
  const before = planId ? await getCleaningPlan(db, storeId, planId) : null;
  if (planId && !before) return null;
  const taskId = await assertCleaningTask(db, storeId, payload.quality_task_id);
  const result = planId
    ? await db.query(
      `UPDATE quality_cleaning_plans
       SET title=$3, description=$4, zone_id=$5, equipment_id=$6, product_name=$7,
           method=$8, safety_instructions=$9, expected_duration_minutes=$10,
           quality_task_id=$11, active=$12, updated_by=$13, updated_at=now()
       WHERE id=$1 AND store_id=$2
       RETURNING *`,
      [planId, storeId, payload.title, payload.description, payload.zone_id, payload.equipment_id, payload.product_name, payload.method, payload.safety_instructions, payload.expected_duration_minutes, taskId, payload.active, userId]
    )
    : await db.query(
      `INSERT INTO quality_cleaning_plans (
        store_id, title, description, zone_id, equipment_id, product_name,
        method, safety_instructions, expected_duration_minutes, quality_task_id,
        active, created_by, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
      RETURNING *`,
      [storeId, payload.title, payload.description, payload.zone_id, payload.equipment_id, payload.product_name, payload.method, payload.safety_instructions, payload.expected_duration_minutes, taskId, payload.active, userId]
    );
  const plan = await getCleaningPlan(db, storeId, result.rows[0].id);
  await logEvent(db, storeId, userId, planId ? 'quality.cleaning.plan.updated' : 'quality.cleaning.plan.created', plan.id, before, plan);
  return plan;
}

async function changeCleaningPlanStatus(db, storeId, userId, planId, active) {
  const before = await getCleaningPlan(db, storeId, planId);
  if (!before) return null;
  const result = await db.query(
    `UPDATE quality_cleaning_plans
     SET active=$3, updated_by=$4, updated_at=now()
     WHERE id=$1 AND store_id=$2
     RETURNING *`,
    [planId, storeId, active, userId]
  );
  const plan = await getCleaningPlan(db, storeId, result.rows[0].id);
  await logEvent(db, storeId, userId, 'quality.cleaning.plan.status_changed', plan.id, before, plan);
  return plan;
}

async function listDueCleaningRecords(db, storeId, query = {}) {
  const includeUpcoming = ['true', '1', 'yes'].includes(String(query.include_upcoming || '').toLowerCase());
  const result = await db.query(
    `${planSelectSql(`p.store_id = $1 AND p.active = true AND qt.active = true
      AND ($2::boolean = true OR qt.next_due_at::date <= CURRENT_DATE)`)}
     ORDER BY qt.next_due_at ASC NULLS LAST, p.title ASC`,
    [storeId, includeUpcoming]
  );
  return result.rows
    .map(attachTask)
    .map((plan) => ({
      plan_id: plan.id,
      cleaning_plan_id: plan.id,
      quality_task_id: plan.quality_task_id,
      title: plan.title,
      zone_id: plan.zone_id,
      zone_name: plan.zone_name,
      equipment_id: plan.equipment_id,
      equipment_name: plan.equipment_name,
      product_name: plan.product_name,
      method: plan.method,
      safety_instructions: plan.safety_instructions,
      expected_duration_minutes: plan.expected_duration_minutes,
      task_title: plan.quality_task?.title || null,
      target_time: plan.quality_task?.target_time || null,
      next_due_at: plan.quality_task?.next_due_at || null,
      computed_status: plan.quality_task?.computed_status || 'planned',
      last_completed_at: plan.quality_task?.last_completed_at || null,
    }))
    .filter((item) => includeUpcoming || ['due', 'overdue'].includes(item.computed_status));
}

async function createCleaningRecord(db, storeId, userId, payload) {
  const plan = await getCleaningPlan(db, storeId, payload.cleaning_plan_id);
  if (!plan || !plan.active) {
    const err = new Error('Plan de nettoyage introuvable ou inactif');
    err.status = 404;
    throw err;
  }
  const taskId = payload.quality_task_id || plan.quality_task_id || null;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO quality_cleaning_records (
        store_id, cleaning_plan_id, quality_task_id, performed_at, performed_by, status, comment
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *`,
      [storeId, plan.id, taskId, payload.performed_at, payload.performed_by || userId, payload.status, payload.comment]
    );
    if (taskId) {
      await completeQualityTask(client, storeId, userId, taskId, `Nettoyage ${payload.status}`, payload.performed_at);
    }
    await logQualityEvent({
      dbPool: client,
      storeId,
      actorId: userId,
      eventType: 'quality.cleaning.record.created',
      targetType: 'quality_cleaning_record',
      targetId: result.rows[0].id,
      after: result.rows[0],
    });
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listCleaningRecords(db, storeId, query = {}) {
  const params = [storeId];
  const where = ['r.store_id = $1'];
  addFilter(where, params, query.cleaning_plan_id, (i) => `r.cleaning_plan_id = $${i}`);
  addFilter(where, params, query.status, (i) => `r.status = $${i}`);
  addFilter(where, params, query.start_date, (i) => `r.performed_at >= $${i}::timestamptz`);
  addFilter(where, params, query.end_date, (i) => `r.performed_at <= $${i}::timestamptz`);
  const result = await db.query(
    `SELECT r.*, p.title AS plan_title, p.product_name, p.method,
            z.name AS zone_name, e.name AS equipment_name, u.email AS performed_by_email
     FROM quality_cleaning_records r
     INNER JOIN quality_cleaning_plans p ON p.id = r.cleaning_plan_id AND p.store_id = r.store_id
     LEFT JOIN quality_zones z ON z.id = p.zone_id AND z.store_id = p.store_id
     LEFT JOIN quality_equipments e ON e.id = p.equipment_id AND e.store_id = p.store_id
     LEFT JOIN users u ON u.id = r.performed_by
     WHERE ${where.join(' AND ')}
     ORDER BY r.performed_at DESC, r.created_at DESC
     LIMIT 500`,
    params
  );
  return result.rows;
}

async function getCleaningSummary(db, storeId) {
  const due = await listDueCleaningRecords(db, storeId);
  const done = await db.query(
    `SELECT count(*)::int AS count
     FROM quality_cleaning_records
     WHERE store_id = $1 AND performed_at::date = CURRENT_DATE`,
    [storeId]
  );
  return {
    due: due.filter((item) => item.computed_status === 'due').length,
    overdue: due.filter((item) => item.computed_status === 'overdue').length,
    done_today: done.rows[0]?.count || 0,
  };
}

module.exports = {
  changeCleaningPlanStatus,
  createCleaningRecord,
  getCleaningPlan,
  getCleaningSummary,
  listCleaningPlans,
  listCleaningRecords,
  listDueCleaningRecords,
  saveCleaningPlan,
};
