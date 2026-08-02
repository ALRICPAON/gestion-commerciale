const {
  getQualityTask,
  saveQualityTask,
  deactivateQualityTask,
} = require('./tasks');
const {
  changeCleaningPlanStatus,
  getCleaningPlan,
  saveCleaningPlan,
} = require('./cleaning');
const { mapTaskPayload, validateTaskPayload } = require('../../validators/quality/tasks');
const { mapPlanPayload, validatePlanPayload } = require('../../validators/quality/cleaning');

function businessError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function compactConfiguration(item) {
  if (!item) return null;
  return {
    id: item.id,
    code: item.code || item.category || item.module_key || null,
    name: item.name || item.title || null,
    title: item.title || item.name || null,
    status: item.configuration_status || item.status || (item.active === false ? 'inactive' : 'active'),
    active: item.active,
  };
}

async function assertStore(db, storeId) {
  const result = await db.query('SELECT id FROM stores WHERE id = $1 LIMIT 1', [storeId]);
  if (!result.rows[0]) throw businessError('Magasin introuvable', 404);
}

async function assertZone(db, storeId, zoneId) {
  if (!zoneId) return null;
  const result = await db.query(
    'SELECT id, code, name, status FROM quality_zones WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL LIMIT 1',
    [zoneId, storeId]
  );
  if (!result.rows[0]) throw businessError('Zone qualite introuvable pour ce magasin', 400);
  return result.rows[0];
}

async function assertEquipment(db, storeId, equipmentId, zoneId = null) {
  if (!equipmentId) return null;
  const result = await db.query(
    'SELECT id, code, name, zone_id, status FROM quality_equipments WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL LIMIT 1',
    [equipmentId, storeId]
  );
  const equipment = result.rows[0];
  if (!equipment) throw businessError('Equipement qualite introuvable pour ce magasin', 400);
  if (zoneId && String(equipment.zone_id) !== String(zoneId)) {
    throw businessError('Association refusee: equipement et zone ne correspondent pas');
  }
  return equipment;
}

async function assertZones(db, storeId, zoneIds = []) {
  for (const zoneId of zoneIds || []) await assertZone(db, storeId, zoneId);
}

async function assertEquipments(db, storeId, equipmentIds = [], zoneIds = []) {
  const allowedZones = new Set((zoneIds || []).filter(Boolean).map(String));
  for (const equipmentId of equipmentIds || []) {
    const equipment = await assertEquipment(db, storeId, equipmentId);
    if (allowedZones.size && equipment.zone_id && !allowedZones.has(String(equipment.zone_id))) {
      throw businessError('Association refusee: un equipement selectionne n appartient pas aux zones selectionnees');
    }
  }
}

function normalizeTaskInput(input = {}, context = {}) {
  const zoneId = input.zone_id || input.zoneId || null;
  const equipmentId = input.equipment_id || input.equipmentId || null;
  const payload = mapTaskPayload({
    ...input,
    module_key: input.module_key || input.category || 'quality',
    entity_type: input.entity_type || (equipmentId ? 'equipment' : zoneId ? 'zone' : null),
    entity_id: input.entity_id || equipmentId || zoneId || null,
    status: input.status || 'pending_review',
    active: input.active === true,
    configuration_status: input.configuration_status || 'pending_review',
    created_source: input.created_source || 'agent_alta',
    created_by_agent: true,
    agent_action_id: input.agent_action_id || context.request_id || null,
  });
  return { payload, zoneId, equipmentId };
}

function normalizePlanInput(input = {}, context = {}) {
  return mapPlanPayload({
    ...input,
    active: input.active === true,
    configuration_status: input.configuration_status || 'pending_review',
    validation_required: input.validation_required !== false,
    created_source: input.created_source || 'agent_alta',
    created_by_agent: true,
    agent_action_id: input.agent_action_id || context.request_id || null,
  });
}

function assertTaskEditable(task) {
  if (!task) throw businessError('Tache qualite introuvable', 404);
  if (task.last_completed_at || task.status === 'completed') {
    throw businessError('Modification refusee: une tache deja executee ne peut pas etre modifiee');
  }
}

async function assertTaskHasNoHistory(db, storeId, taskId) {
  const result = await db.query(
    'SELECT id FROM quality_task_history WHERE store_id = $1 AND task_id = $2 LIMIT 1',
    [storeId, taskId]
  );
  if (result.rows[0]) throw businessError('Modification refusee: historique de tache deja produit');
}

function assertPlanOperational(plan) {
  if (!plan.product_name || !plan.dosage_concentration || !plan.contact_time_minutes || !plan.frequency_value || !plan.frequency_unit) {
    throw businessError('Activation refusee: produit, dosage/concentration, temps de contact et frequence du plan sont obligatoires');
  }
}

async function createTask(db, context, input = {}) {
  await assertStore(db, context.store_id);
  const { payload, zoneId, equipmentId } = normalizeTaskInput(input, context);
  await assertZone(db, context.store_id, zoneId);
  await assertEquipment(db, context.store_id, equipmentId, zoneId);
  const validationError = validateTaskPayload(payload);
  if (validationError) throw businessError(validationError);
  const task = await saveQualityTask(db, context.store_id, context.user_id, payload);
  return { task, summary: compactConfiguration(task) };
}

async function updateTask(db, context, input = {}) {
  await assertStore(db, context.store_id);
  const taskId = input.task_id || input.id;
  if (!taskId) throw businessError('Identifiant de tache obligatoire');
  const before = await getQualityTask(db, context.store_id, taskId);
  assertTaskEditable(before);
  await assertTaskHasNoHistory(db, context.store_id, taskId);
  const { payload, zoneId, equipmentId } = normalizeTaskInput({ ...before, ...input }, context);
  await assertZone(db, context.store_id, zoneId);
  await assertEquipment(db, context.store_id, equipmentId, zoneId);
  const validationError = validateTaskPayload(payload);
  if (validationError) throw businessError(validationError);
  const task = await saveQualityTask(db, context.store_id, context.user_id, payload, taskId);
  return { task, summary: compactConfiguration(task) };
}

async function createCleaningPlan(db, context, input = {}) {
  await assertStore(db, context.store_id);
  const payload = normalizePlanInput(input, context);
  await assertZones(db, context.store_id, payload.zone_ids);
  await assertEquipments(db, context.store_id, payload.equipment_ids, payload.zone_ids);
  const validationError = validatePlanPayload(payload);
  if (validationError) throw businessError(validationError);
  if (payload.active) assertPlanOperational(payload);
  const plan = await saveCleaningPlan(db, context.store_id, context.user_id, payload);
  return { plan, summary: compactConfiguration(plan) };
}

async function updateCleaningPlan(db, context, input = {}) {
  await assertStore(db, context.store_id);
  const planId = input.cleaning_plan_id || input.plan_id || input.id;
  if (!planId) throw businessError('Identifiant du plan de nettoyage obligatoire');
  const before = await getCleaningPlan(db, context.store_id, planId);
  if (!before) throw businessError('Plan de nettoyage introuvable', 404);
  const payload = normalizePlanInput({ ...before, ...input }, context);
  await assertZones(db, context.store_id, payload.zone_ids);
  await assertEquipments(db, context.store_id, payload.equipment_ids, payload.zone_ids);
  const validationError = validatePlanPayload(payload);
  if (validationError) throw businessError(validationError);
  if (payload.active) assertPlanOperational(payload);
  const plan = await saveCleaningPlan(db, context.store_id, context.user_id, payload, planId);
  return { plan, summary: compactConfiguration(plan) };
}

async function assignTaskToTarget(db, context, input = {}, targetType) {
  const targetId = targetType === 'zone' ? input.zone_id || input.zoneId : input.equipment_id || input.equipmentId;
  if (!targetId) throw businessError(targetType === 'zone' ? 'Zone obligatoire' : 'Equipement obligatoire');
  const entity = targetType === 'zone'
    ? await assertZone(db, context.store_id, targetId)
    : await assertEquipment(db, context.store_id, targetId);
  const task = await updateTask(db, context, {
    ...input,
    task_id: input.task_id || input.id,
    entity_type: targetType,
    entity_id: entity.id,
    zone_id: targetType === 'zone' ? entity.id : null,
    equipment_id: targetType === 'equipment' ? entity.id : null,
  });
  return task;
}

async function changeConfigurationStatus(db, context, input = {}, active) {
  const type = input.type || input.resource_type || input.configuration_type;
  if (type === 'task' || type === 'quality_task') {
    const taskId = input.task_id || input.id;
    if (!active) {
      const task = await deactivateQualityTask(db, context.store_id, context.user_id, taskId);
      if (!task) throw businessError('Tache qualite introuvable', 404);
      return { task, summary: compactConfiguration(task) };
    }
    return updateTask(db, context, { ...input, task_id: taskId, status: 'planned', active: true, configuration_status: 'active' });
  }

  if (type === 'cleaning_plan' || type === 'plan') {
    const planId = input.cleaning_plan_id || input.plan_id || input.id;
    const before = await getCleaningPlan(db, context.store_id, planId);
    if (!before) throw businessError('Plan de nettoyage introuvable', 404);
    if (active) assertPlanOperational(before);
    const plan = await changeCleaningPlanStatus(db, context.store_id, context.user_id, planId, active);
    return { plan, summary: compactConfiguration(plan) };
  }

  throw businessError('Type de configuration invalide');
}

module.exports = {
  assertPlanOperational,
  createCleaningPlan,
  createTask,
  updateCleaningPlan,
  updateTask,
  assignTaskToTarget,
  changeConfigurationStatus,
};
