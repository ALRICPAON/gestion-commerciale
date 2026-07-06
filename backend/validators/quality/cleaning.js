const CLEANING_RECORD_STATUSES = Object.freeze(['done', 'partial', 'not_done', 'issue']);

function cleanUuid(value) {
  const text = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function nullableText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function booleanValue(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return !(value === false || value === 'false' || value === '0' || value === 0);
}

function mapPlanPayload(body = {}) {
  return {
    title: nullableText(body.title),
    description: nullableText(body.description),
    zone_id: cleanUuid(body.zone_id),
    equipment_id: cleanUuid(body.equipment_id),
    product_name: nullableText(body.product_name),
    method: nullableText(body.method),
    safety_instructions: nullableText(body.safety_instructions),
    expected_duration_minutes: nullableInteger(body.expected_duration_minutes),
    quality_task_id: cleanUuid(body.quality_task_id),
    active: booleanValue(body.active, true),
  };
}

function validatePlanPayload(payload) {
  if (!payload.title) return 'Titre du plan obligatoire';
  if (payload.expected_duration_minutes !== null && payload.expected_duration_minutes <= 0) return 'Durée prévue invalide';
  return null;
}

function mapRecordPayload(body = {}) {
  const status = nullableText(body.status) || 'done';
  return {
    cleaning_plan_id: cleanUuid(body.cleaning_plan_id),
    quality_task_id: cleanUuid(body.quality_task_id),
    performed_at: nullableText(body.performed_at) || new Date().toISOString(),
    performed_by: cleanUuid(body.performed_by),
    status: CLEANING_RECORD_STATUSES.includes(status) ? status : 'done',
    comment: nullableText(body.comment),
  };
}

function validateRecordPayload(payload) {
  if (!payload.cleaning_plan_id) return 'Plan de nettoyage obligatoire';
  if (!payload.performed_at || Number.isNaN(new Date(payload.performed_at).getTime())) return 'Date de réalisation invalide';
  if (!CLEANING_RECORD_STATUSES.includes(payload.status)) return 'Statut de nettoyage invalide';
  return null;
}

module.exports = {
  CLEANING_RECORD_STATUSES,
  cleanUuid,
  mapPlanPayload,
  mapRecordPayload,
  validatePlanPayload,
  validateRecordPayload,
};
