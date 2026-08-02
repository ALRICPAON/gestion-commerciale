const { logQualityEvent } = require('./eventLogger');
const { completeQualityTask, deactivateQualityTask, saveQualityTask } = require('./tasks');
const { enrichTask } = require('./taskScheduler');

function addFilter(where, params, value, sql) {
  if (value !== undefined && value !== null && value !== '') {
    params.push(value);
    where.push(sql(params.length));
  }
}

function uniqueIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map(String))];
}

function legacyAwareIds(payload = {}, key, legacyKey) {
  return uniqueIds([payload[legacyKey], ...(payload[key] || [])]);
}

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

function attachTargets(row) {
  if (!row) return null;
  const zones = jsonArray(row.zones);
  const equipments = jsonArray(row.equipments);
  const zone = zones[0] || null;
  const equipment = equipments[0] || null;
  return {
    ...row,
    zones,
    equipments,
    zone_id: row.zone_id || zone?.id || null,
    zone_code: row.zone_code || zone?.code || null,
    zone_name: row.zone_name || zone?.name || null,
    equipment_id: row.equipment_id || equipment?.id || null,
    equipment_code: row.equipment_code || equipment?.code || null,
    equipment_name: row.equipment_name || equipment?.name || null,
  };
}

function targetSummary(plan) {
  const zones = (plan.zones || []).map((zone) => zone.name || zone.code || zone.id);
  const equipments = (plan.equipments || []).map((equipment) => equipment.name || equipment.code || equipment.id);
  return [
    zones.length ? `Zones: ${zones.join(', ')}` : null,
    equipments.length ? `Equipements: ${equipments.join(', ')}` : null,
  ].filter(Boolean).join(' | ');
}

function synchronizedTaskPayload(plan) {
  const equipmentId = plan.equipment_id || plan.equipments?.[0]?.id || null;
  const zoneId = plan.zone_id || plan.zones?.[0]?.id || null;
  const active = plan.active === true && plan.configuration_status !== 'archived';
  const status = plan.configuration_status === 'archived'
    ? 'archived'
    : active
      ? 'planned'
      : 'paused';
  const summary = targetSummary(plan);
  return {
    title: `Nettoyage - ${plan.title}`,
    description: [
      'Tache synchronisee automatiquement depuis le plan de nettoyage PMS.',
      summary,
      plan.expected_duration_minutes ? `Duree estimee: ${plan.expected_duration_minutes} min` : null,
    ].filter(Boolean).join(' '),
    module_key: 'cleaning',
    entity_type: equipmentId ? 'equipment' : zoneId ? 'zone' : null,
    entity_id: equipmentId || zoneId || null,
    responsible_user_id: plan.responsible_user_id || null,
    frequency_value: plan.frequency_value || null,
    frequency_unit: plan.frequency_unit || null,
    target_time: plan.target_time || null,
    status,
    active,
    category: 'cleaning_plan',
    execution_method: plan.method || null,
    verification_method: plan.post_cleaning_check || null,
    proof_required: Boolean(plan.expected_proof),
    instructions: plan.safety_instructions || plan.method || null,
    acceptance_criteria: plan.expected_proof || null,
    deviation_action: plan.corrective_action || null,
    configuration_status: plan.configuration_status === 'archived' ? 'archived' : active ? 'active' : 'inactive',
    created_source: 'cleaning_plan',
    created_by_agent: false,
    agent_action_id: plan.agent_action_id || null,
  };
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
  const plan = attachTargets(row);
  if (!plan.task_id) return { ...plan, quality_task: null };
  return {
    ...plan,
    quality_task: enrichTask({
      id: plan.task_id,
      title: plan.task_title,
      frequency_value: plan.task_frequency_value,
      frequency_unit: plan.task_frequency_unit,
      target_time: plan.task_target_time,
      next_due_at: plan.task_next_due_at,
      last_completed_at: plan.task_last_completed_at,
      status: plan.task_status,
      active: plan.task_active,
      responsible_email: plan.task_responsible_email,
    }),
  };
}

function planSelectSql(whereSql) {
  return `SELECT p.*, z.code AS zone_code, z.name AS zone_name,
                 e.code AS equipment_code, e.name AS equipment_name,
                 COALESCE(z_targets.zones, CASE WHEN p.zone_id IS NOT NULL THEN json_build_array(json_build_object('id', z.id, 'code', z.code, 'name', z.name, 'status', z.status)) ELSE '[]'::json END) AS zones,
                 COALESCE(e_targets.equipments, CASE WHEN p.equipment_id IS NOT NULL THEN json_build_array(json_build_object('id', e.id, 'code', e.code, 'name', e.name, 'zone_id', e.zone_id, 'zone_name', ez.name, 'status', e.status)) ELSE '[]'::json END) AS equipments,
                 ${taskSelectSql()}
          FROM quality_cleaning_plans p
          LEFT JOIN quality_zones z ON z.id = p.zone_id AND z.store_id = p.store_id
          LEFT JOIN quality_equipments e ON e.id = p.equipment_id AND e.store_id = p.store_id
          LEFT JOIN quality_zones ez ON ez.id = e.zone_id AND ez.store_id = p.store_id
          LEFT JOIN LATERAL (
            SELECT json_agg(json_build_object('id', lz.id, 'code', lz.code, 'name', lz.name, 'status', lz.status) ORDER BY lz.name ASC) AS zones
            FROM quality_cleaning_plan_zones pz
            INNER JOIN quality_zones lz ON lz.id = pz.zone_id AND lz.store_id = p.store_id
            WHERE pz.plan_id = p.id AND pz.deleted_at IS NULL
          ) z_targets ON true
          LEFT JOIN LATERAL (
            SELECT json_agg(json_build_object('id', le.id, 'code', le.code, 'name', le.name, 'zone_id', le.zone_id, 'zone_name', lez.name, 'status', le.status) ORDER BY lez.name ASC, le.name ASC) AS equipments
            FROM quality_cleaning_plan_equipments pe
            INNER JOIN quality_equipments le ON le.id = pe.equipment_id AND le.store_id = p.store_id
            LEFT JOIN quality_zones lez ON lez.id = le.zone_id AND lez.store_id = p.store_id
            WHERE pe.plan_id = p.id AND pe.deleted_at IS NULL
          ) e_targets ON true
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

async function assertTargetIds(db, storeId, zoneIds = [], equipmentIds = []) {
  const zones = uniqueIds(zoneIds);
  const equipments = uniqueIds(equipmentIds);
  if (zones.length) {
    const result = await db.query(
      `SELECT id FROM quality_zones
       WHERE store_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
      [storeId, zones]
    );
    const found = new Set(result.rows.map((row) => String(row.id)));
    const missing = zones.filter((id) => !found.has(String(id)));
    if (missing.length) {
      const err = new Error(`Zone qualite introuvable pour ce magasin: ${missing.join(', ')}`);
      err.status = 400;
      throw err;
    }
  }
  if (equipments.length) {
    const result = await db.query(
      `SELECT id, zone_id FROM quality_equipments
       WHERE store_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
      [storeId, equipments]
    );
    const found = new Map(result.rows.map((row) => [String(row.id), row]));
    const missing = equipments.filter((id) => !found.has(String(id)));
    if (missing.length) {
      const err = new Error(`Equipement qualite introuvable pour ce magasin: ${missing.join(', ')}`);
      err.status = 400;
      throw err;
    }
    if (zones.length) {
      const zoneSet = new Set(zones.map(String));
      const outside = result.rows.filter((row) => row.zone_id && !zoneSet.has(String(row.zone_id)));
      if (outside.length) {
        const err = new Error('Association refusee: un equipement selectionne n appartient pas aux zones selectionnees');
        err.status = 400;
        throw err;
      }
    }
  }
}

async function syncPlanTargets(db, storeId, userId, planId, payload = {}) {
  const zoneIds = legacyAwareIds(payload, 'zone_ids', 'zone_id');
  const equipmentIds = legacyAwareIds(payload, 'equipment_ids', 'equipment_id');
  await assertTargetIds(db, storeId, zoneIds, equipmentIds);
  await db.query(
    `UPDATE quality_cleaning_plan_zones
     SET deleted_at = now(), deleted_by = $4
     WHERE plan_id = $1 AND deleted_at IS NULL AND NOT (zone_id = ANY($2::uuid[]))`,
    [planId, zoneIds, storeId, userId]
  );
  for (const zoneId of zoneIds) {
    await db.query(
      `INSERT INTO quality_cleaning_plan_zones (plan_id, zone_id, created_by, deleted_at, deleted_by)
       VALUES ($1, $2, $3, NULL, NULL)
       ON CONFLICT (plan_id, zone_id)
       DO UPDATE SET deleted_at = NULL, deleted_by = NULL`,
      [planId, zoneId, userId]
    );
  }
  await db.query(
    `UPDATE quality_cleaning_plan_equipments
     SET deleted_at = now(), deleted_by = $4
     WHERE plan_id = $1 AND deleted_at IS NULL AND NOT (equipment_id = ANY($2::uuid[]))`,
    [planId, equipmentIds, storeId, userId]
  );
  for (const equipmentId of equipmentIds) {
    await db.query(
      `INSERT INTO quality_cleaning_plan_equipments (plan_id, equipment_id, created_by, deleted_at, deleted_by)
       VALUES ($1, $2, $3, NULL, NULL)
       ON CONFLICT (plan_id, equipment_id)
       DO UPDATE SET deleted_at = NULL, deleted_by = NULL`,
      [planId, equipmentId, userId]
    );
  }
}

async function syncCleaningPlanTask(db, storeId, userId, plan) {
  if (!plan) return null;
  if (plan.quality_task_id && plan.configuration_status === 'archived') {
    await deactivateQualityTask(db, storeId, userId, plan.quality_task_id);
    return plan.quality_task_id;
  }
  const task = await saveQualityTask(
    db,
    storeId,
    userId,
    synchronizedTaskPayload(plan),
    plan.quality_task_id || null
  );
  if (!plan.quality_task_id && task?.id) {
    await db.query(
      `UPDATE quality_cleaning_plans
       SET quality_task_id=$3, updated_by=$4, updated_at=now()
       WHERE id=$1 AND store_id=$2`,
      [plan.id, storeId, task.id, userId]
    );
  }
  return task?.id || plan.quality_task_id || null;
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

async function listCleaningPlans(db, storeId, query = {}) {
  const params = [storeId];
  const where = ['p.store_id = $1'];
  addFilter(where, params, query.zone_id, (i) => `(p.zone_id = $${i} OR EXISTS (SELECT 1 FROM quality_cleaning_plan_zones pz WHERE pz.plan_id = p.id AND pz.zone_id = $${i} AND pz.deleted_at IS NULL))`);
  addFilter(where, params, query.equipment_id, (i) => `(p.equipment_id = $${i} OR EXISTS (SELECT 1 FROM quality_cleaning_plan_equipments pe WHERE pe.plan_id = p.id AND pe.equipment_id = $${i} AND pe.deleted_at IS NULL))`);
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

async function saveCleaningPlanInTransaction(db, storeId, userId, payload, planId = null) {
  const before = planId ? await getCleaningPlan(db, storeId, planId) : null;
  if (planId && !before) return null;
  const zoneIds = legacyAwareIds(payload, 'zone_ids', 'zone_id');
  const equipmentIds = legacyAwareIds(payload, 'equipment_ids', 'equipment_id');
  await assertTargetIds(db, storeId, zoneIds, equipmentIds);
  const legacyZoneId = zoneIds[0] || null;
  const legacyEquipmentId = equipmentIds[0] || null;
  const taskId = await assertCleaningTask(db, storeId, payload.quality_task_id);
  const result = planId
    ? await db.query(
      `UPDATE quality_cleaning_plans
       SET title=$3, description=$4, zone_id=$5, equipment_id=$6, product_name=$7,
           method=$8, safety_instructions=$9, expected_duration_minutes=$10,
           quality_task_id=$11, active=$12, updated_by=$13,
           dosage_concentration=$14, usage_temperature=$15, contact_time_minutes=$16,
           rinse_required=$17, material_used=$18, post_cleaning_check=$19,
           expected_proof=$20, corrective_action=$21, configuration_status=$22,
           validation_required=$23, created_source=$24, created_by_agent=$25,
           agent_action_id=$26, responsible_user_id=$27, frequency_value=$28,
           frequency_unit=$29, target_time=$30, scheduled_days=$31::jsonb,
           updated_at=now()
       WHERE id=$1 AND store_id=$2
       RETURNING *`,
      [planId, storeId, payload.title, payload.description, legacyZoneId, legacyEquipmentId, payload.product_name, payload.method, payload.safety_instructions, payload.expected_duration_minutes, taskId, payload.active, userId, payload.dosage_concentration ?? before.dosage_concentration, payload.usage_temperature ?? before.usage_temperature, payload.contact_time_minutes ?? before.contact_time_minutes, payload.rinse_required ?? before.rinse_required, payload.material_used ?? before.material_used, payload.post_cleaning_check ?? before.post_cleaning_check, payload.expected_proof ?? before.expected_proof, payload.corrective_action ?? before.corrective_action, payload.configuration_status || before.configuration_status || 'active', payload.validation_required === true || before.validation_required === true, payload.created_source || before.created_source || 'human', payload.created_by_agent === true || before.created_by_agent === true, payload.agent_action_id || before.agent_action_id, payload.responsible_user_id ?? before.responsible_user_id, payload.frequency_value ?? before.frequency_value, payload.frequency_unit ?? before.frequency_unit, payload.target_time ?? before.target_time, JSON.stringify(payload.scheduled_days ?? before.scheduled_days ?? [])]
    )
    : await db.query(
      `INSERT INTO quality_cleaning_plans (
        store_id, title, description, zone_id, equipment_id, product_name,
        method, safety_instructions, expected_duration_minutes, quality_task_id,
        active, created_by, updated_by, dosage_concentration, usage_temperature,
        contact_time_minutes, rinse_required, material_used, post_cleaning_check,
        expected_proof, corrective_action, configuration_status, validation_required,
        created_source, created_by_agent, agent_action_id, responsible_user_id,
        frequency_value, frequency_unit, target_time, scheduled_days
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb)
      RETURNING *`,
      [storeId, payload.title, payload.description, legacyZoneId, legacyEquipmentId, payload.product_name, payload.method, payload.safety_instructions, payload.expected_duration_minutes, taskId, payload.active, userId, payload.dosage_concentration, payload.usage_temperature, payload.contact_time_minutes, payload.rinse_required, payload.material_used, payload.post_cleaning_check, payload.expected_proof, payload.corrective_action, payload.configuration_status || 'active', payload.validation_required === true, payload.created_source || 'human', payload.created_by_agent === true, payload.agent_action_id, payload.responsible_user_id, payload.frequency_value, payload.frequency_unit, payload.target_time, JSON.stringify(payload.scheduled_days || [])]
    );
  await syncPlanTargets(db, storeId, userId, result.rows[0].id, { ...payload, zone_ids: zoneIds, equipment_ids: equipmentIds, zone_id: legacyZoneId, equipment_id: legacyEquipmentId });
  const savedPlan = await getCleaningPlan(db, storeId, result.rows[0].id);
  await syncCleaningPlanTask(db, storeId, userId, savedPlan);
  const plan = await getCleaningPlan(db, storeId, result.rows[0].id);
  await logEvent(db, storeId, userId, planId ? 'quality.cleaning.plan.updated' : 'quality.cleaning.plan.created', plan.id, before, plan);
  return plan;
}

async function saveCleaningPlan(db, storeId, userId, payload, planId = null) {
  return withTransaction(db, (client) => saveCleaningPlanInTransaction(client, storeId, userId, payload, planId));
}

async function changeCleaningPlanStatusInTransaction(db, storeId, userId, planId, active) {
  const before = await getCleaningPlan(db, storeId, planId);
  if (!before) return null;
  if (active && (!before.product_name || !before.dosage_concentration || !before.contact_time_minutes || !before.frequency_value || !before.frequency_unit)) {
    const err = new Error('Activation refusee: produit, dosage/concentration, temps de contact et frequence du plan sont obligatoires');
    err.status = 400;
    throw err;
  }
  const result = await db.query(
    `UPDATE quality_cleaning_plans
     SET active=$3, configuration_status=$5, updated_by=$4, updated_at=now()
     WHERE id=$1 AND store_id=$2
     RETURNING *`,
    [planId, storeId, active, userId, active ? 'active' : 'inactive']
  );
  const changedPlan = await getCleaningPlan(db, storeId, result.rows[0].id);
  await syncCleaningPlanTask(db, storeId, userId, changedPlan);
  const plan = await getCleaningPlan(db, storeId, result.rows[0].id);
  await logEvent(db, storeId, userId, 'quality.cleaning.plan.status_changed', plan.id, before, plan);
  return plan;
}

async function changeCleaningPlanStatus(db, storeId, userId, planId, active) {
  return withTransaction(db, (client) => changeCleaningPlanStatusInTransaction(client, storeId, userId, planId, active));
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
      zones: plan.zones,
      equipment_id: plan.equipment_id,
      equipment_name: plan.equipment_name,
      equipments: plan.equipments,
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
            z.name AS zone_name, e.name AS equipment_name,
            COALESCE(z_targets.zones, CASE WHEN p.zone_id IS NOT NULL THEN json_build_array(json_build_object('id', z.id, 'code', z.code, 'name', z.name, 'status', z.status)) ELSE '[]'::json END) AS zones,
            COALESCE(e_targets.equipments, CASE WHEN p.equipment_id IS NOT NULL THEN json_build_array(json_build_object('id', e.id, 'code', e.code, 'name', e.name, 'zone_id', e.zone_id, 'zone_name', ez.name, 'status', e.status)) ELSE '[]'::json END) AS equipments,
            u.email AS performed_by_email
     FROM quality_cleaning_records r
     INNER JOIN quality_cleaning_plans p ON p.id = r.cleaning_plan_id AND p.store_id = r.store_id
     LEFT JOIN quality_zones z ON z.id = p.zone_id AND z.store_id = p.store_id
     LEFT JOIN quality_equipments e ON e.id = p.equipment_id AND e.store_id = p.store_id
     LEFT JOIN quality_zones ez ON ez.id = e.zone_id AND ez.store_id = p.store_id
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object('id', lz.id, 'code', lz.code, 'name', lz.name, 'status', lz.status) ORDER BY lz.name ASC) AS zones
       FROM quality_cleaning_plan_zones pz
       INNER JOIN quality_zones lz ON lz.id = pz.zone_id AND lz.store_id = p.store_id
       WHERE pz.plan_id = p.id AND pz.deleted_at IS NULL
     ) z_targets ON true
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object('id', le.id, 'code', le.code, 'name', le.name, 'zone_id', le.zone_id, 'zone_name', lez.name, 'status', le.status) ORDER BY lez.name ASC, le.name ASC) AS equipments
       FROM quality_cleaning_plan_equipments pe
       INNER JOIN quality_equipments le ON le.id = pe.equipment_id AND le.store_id = p.store_id
       LEFT JOIN quality_zones lez ON lez.id = le.zone_id AND lez.store_id = p.store_id
       WHERE pe.plan_id = p.id AND pe.deleted_at IS NULL
     ) e_targets ON true
     LEFT JOIN users u ON u.id = r.performed_by
     WHERE ${where.join(' AND ')}
     ORDER BY r.performed_at DESC, r.created_at DESC
     LIMIT 500`,
    params
  );
  return result.rows.map(attachTargets);
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
