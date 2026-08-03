const CLEANING_RECORD_STATUSES = Object.freeze(['done', 'partial', 'not_done', 'issue']);
const CONFIGURATION_STATUSES = Object.freeze(['draft', 'pending_review', 'active', 'inactive', 'archived']);
const FREQUENCY_UNITS = Object.freeze(['hours', 'days', 'weeks', 'months', 'events']);

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

function nullableBoolean(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  if (value === false || value === 'false' || value === '0' || value === 0) return false;
  return null;
}

function booleanValue(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return !(value === false || value === 'false' || value === '0' || value === 0);
}

function cleanUuidArray(value) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  return [...new Set(items.map((item) => cleanUuid(typeof item === 'object' && item ? item.id : item)).filter(Boolean))];
}

function cleanStringArray(value) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))];
}

function mapPlanPayload(body = {}) {
  const hasZoneIds = body.zone_ids !== undefined || body.zoneIds !== undefined;
  const hasEquipmentIds = body.equipment_ids !== undefined || body.equipmentIds !== undefined;
  const zoneIds = cleanUuidArray(hasZoneIds ? (body.zone_ids || body.zoneIds) : (body.zones || body.zone_id));
  const equipmentIds = cleanUuidArray(hasEquipmentIds ? (body.equipment_ids || body.equipmentIds) : (body.equipments || body.equipment_id));
  const zoneId = zoneIds[0] || (hasZoneIds ? null : cleanUuid(body.zone_id)) || null;
  const equipmentId = equipmentIds[0] || (hasEquipmentIds ? null : cleanUuid(body.equipment_id)) || null;
  return {
    title: nullableText(body.title),
    description: nullableText(body.description),
    zone_id: zoneId,
    equipment_id: equipmentId,
    zone_ids: zoneIds.length ? zoneIds : [zoneId].filter(Boolean),
    equipment_ids: equipmentIds.length ? equipmentIds : [equipmentId].filter(Boolean),
    product_name: nullableText(body.product_name),
    dosage_concentration: nullableText(body.dosage_concentration || body.dosage),
    usage_temperature: nullableText(body.usage_temperature || body.temperature),
    contact_time_minutes: nullableInteger(body.contact_time_minutes || body.contactTimeMinutes),
    rinse_required: nullableBoolean(body.rinse_required || body.rinseRequired),
    material_used: nullableText(body.material_used || body.material),
    post_cleaning_check: nullableText(body.post_cleaning_check || body.control_after_cleaning),
    expected_proof: nullableText(body.expected_proof || body.proof),
    corrective_action: nullableText(body.corrective_action || body.correctiveAction),
    method: nullableText(body.method),
    safety_instructions: nullableText(body.safety_instructions),
    expected_duration_minutes: nullableInteger(body.expected_duration_minutes),
    responsible_user_id: cleanUuid(body.responsible_user_id || body.responsibleUserId),
    frequency_value: nullableInteger(body.frequency_value || body.frequencyValue),
    frequency_unit: nullableText(body.frequency_unit || body.frequencyUnit),
    target_time: nullableText(body.target_time || body.targetTime),
    scheduled_days: cleanStringArray(body.scheduled_days || body.scheduledDays),
    quality_task_id: cleanUuid(body.quality_task_id),
    active: booleanValue(body.active, true),
    configuration_status: nullableText(body.configuration_status || body.configurationStatus),
    validation_required: booleanValue(body.validation_required || body.validationRequired, false),
    created_source: nullableText(body.created_source || body.createdSource),
    created_by_agent: booleanValue(body.created_by_agent || body.createdByAgent, false),
    agent_action_id: nullableText(body.agent_action_id || body.agentActionId),
  };
}

function validatePlanPayload(payload) {
  if (!payload.title) return 'Titre du plan obligatoire';
  if (payload.expected_duration_minutes !== null && payload.expected_duration_minutes <= 0) return 'Duree prevue invalide';
  if (payload.contact_time_minutes !== null && payload.contact_time_minutes <= 0) return 'Temps de contact invalide';
  if (payload.frequency_value !== null && payload.frequency_value <= 0) return 'Frequence invalide';
  if (payload.frequency_unit && !FREQUENCY_UNITS.includes(payload.frequency_unit)) return 'Unite de frequence invalide';
  if ((payload.frequency_value && !payload.frequency_unit) || (!payload.frequency_value && payload.frequency_unit)) return 'La frequence doit avoir une valeur et une unite';
  if (payload.configuration_status && !CONFIGURATION_STATUSES.includes(payload.configuration_status)) return 'Statut de configuration invalide';
  return null;
}

function mapRecordPayload(body = {}) {
  const status = nullableText(body.status) || 'done';
  return {
    cleaning_plan_id: cleanUuid(body.cleaning_plan_id),
    quality_task_id: cleanUuid(body.quality_task_id),
    occurrence_id: cleanUuid(body.occurrence_id),
    performed_at: nullableText(body.performed_at) || new Date().toISOString(),
    started_at: nullableText(body.started_at || body.startedAt),
    ended_at: nullableText(body.ended_at || body.endedAt),
    performed_by: cleanUuid(body.performed_by),
    status: CLEANING_RECORD_STATUSES.includes(status) ? status : 'done',
    visual_check_status: nullableText(body.visual_check_status || body.visualCheckStatus),
    anomaly_comment: nullableText(body.anomaly_comment || body.anomalyComment),
    corrective_action: nullableText(body.corrective_action || body.correctiveAction),
    evidence_photo_id: cleanUuid(body.evidence_photo_id),
    evidence_document_id: cleanUuid(body.evidence_document_id),
    source: nullableText(body.source) || 'scheduled',
    exceptional_reason: nullableText(body.exceptional_reason || body.reason),
    comment: nullableText(body.comment),
  };
}

function validateRecordPayload(payload) {
  if (!payload.cleaning_plan_id) return 'Plan de nettoyage obligatoire';
  if (!payload.performed_at || Number.isNaN(new Date(payload.performed_at).getTime())) return 'Date de realisation invalide';
  if (!CLEANING_RECORD_STATUSES.includes(payload.status)) return 'Statut de nettoyage invalide';
  return null;
}

module.exports = {
  CLEANING_RECORD_STATUSES,
  FREQUENCY_UNITS,
  cleanUuid,
  cleanUuidArray,
  mapPlanPayload,
  mapRecordPayload,
  validatePlanPayload,
  validateRecordPayload,
};
