const { cleanQualityText, isQualityUuid } = require('./common');
const { VALID_FREQUENCY_UNITS } = require('../../services/quality/taskScheduler');

const VALID_STATUSES = Object.freeze(['draft', 'pending_review', 'planned', 'due', 'overdue', 'completed', 'paused', 'cancelled', 'archived']);
const VALID_CONFIGURATION_STATUSES = Object.freeze(['draft', 'pending_review', 'active', 'inactive', 'archived']);
const VALID_CRITICALITIES = Object.freeze(['low', 'medium', 'high', 'critical']);
const VALID_TASK_ORIGINS = Object.freeze(['SYSTEM', 'MANUAL']);
const MODULE_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,48}$/;
const ENTITY_TYPE_PATTERN = /^[a-z][a-z0-9_-]{1,48}$/;
const TARGET_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function cleanUuid(value) {
  return isQualityUuid(value) ? String(value).trim() : null;
}

function cleanBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  if (value === false || value === 'false' || value === '0' || value === 0) return false;
  return fallback;
}

function cleanInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : NaN;
}

function normalizeTime(value) {
  const text = cleanQualityText(value);
  if (!text) return null;
  if (!TARGET_TIME_PATTERN.test(text)) return text;
  return text.length === 5 ? `${text}:00` : text;
}

function mapTaskPayload(body = {}) {
  return {
    title: cleanQualityText(body.title),
    description: cleanQualityText(body.description),
    category: cleanQualityText(body.category),
    module_key: cleanQualityText(body.module_key || body.moduleKey),
    entity_type: cleanQualityText(body.entity_type || body.entityType),
    entity_id: cleanUuid(body.entity_id || body.entityId),
    responsible_user_id: cleanUuid(body.responsible_user_id || body.responsibleUserId),
    responsible_role: cleanQualityText(body.responsible_role || body.responsibleRole),
    frequency_value: cleanInteger(body.frequency_value || body.frequencyValue),
    frequency_unit: cleanQualityText(body.frequency_unit || body.frequencyUnit),
    target_time: normalizeTime(body.target_time || body.targetTime),
    next_due_at: cleanQualityText(body.next_due_at || body.nextDueAt),
    status: cleanQualityText(body.status) || 'planned',
    active: cleanBoolean(body.active, true),
    criticality: cleanQualityText(body.criticality),
    execution_method: cleanQualityText(body.execution_method || body.executionMethod || body.method),
    verification_method: cleanQualityText(body.verification_method || body.verificationMethod),
    proof_required: cleanBoolean(body.proof_required || body.proofRequired, false),
    photo_required: cleanBoolean(body.photo_required || body.photoRequired, false),
    instructions: cleanQualityText(body.instructions),
    acceptance_criteria: cleanQualityText(body.acceptance_criteria || body.acceptanceCriteria),
    deviation_action: cleanQualityText(body.deviation_action || body.deviationAction),
    configuration_status: cleanQualityText(body.configuration_status || body.configurationStatus),
    created_source: cleanQualityText(body.created_source || body.createdSource),
    created_by_agent: cleanBoolean(body.created_by_agent || body.createdByAgent, false),
    agent_action_id: cleanQualityText(body.agent_action_id || body.agentActionId),
    task_origin: cleanQualityText(body.task_origin || body.taskOrigin),
    source_entity_type: cleanQualityText(body.source_entity_type || body.sourceEntityType),
    source_entity_id: cleanUuid(body.source_entity_id || body.sourceEntityId),
    source_locked: cleanBoolean(body.source_locked || body.sourceLocked, false),
  };
}

function validateTaskPayload(payload) {
  if (!payload.title) return 'Le titre est obligatoire';
  if (!payload.module_key || !MODULE_KEY_PATTERN.test(payload.module_key)) return 'Module invalide';
  if (payload.entity_type && !ENTITY_TYPE_PATTERN.test(payload.entity_type)) return 'Type de rattachement invalide';
  if (Number.isNaN(payload.frequency_value) || (payload.frequency_value !== null && payload.frequency_value <= 0)) return 'Fréquence invalide';
  if (payload.frequency_unit && !VALID_FREQUENCY_UNITS.includes(payload.frequency_unit)) return 'Unité de fréquence invalide';
  if ((payload.frequency_value && !payload.frequency_unit) || (!payload.frequency_value && payload.frequency_unit)) return 'La fréquence doit avoir une valeur et une unité';
  if (payload.target_time && !TARGET_TIME_PATTERN.test(payload.target_time)) return 'Heure cible invalide';
  if (payload.next_due_at && Number.isNaN(new Date(payload.next_due_at).getTime())) return 'Prochaine échéance invalide';
  if (!VALID_STATUSES.includes(payload.status)) return 'Statut invalide';
  if (payload.criticality && !VALID_CRITICALITIES.includes(payload.criticality)) return 'Criticite invalide';
  if (payload.configuration_status && !VALID_CONFIGURATION_STATUSES.includes(payload.configuration_status)) return 'Statut de configuration invalide';
  if (payload.task_origin && !VALID_TASK_ORIGINS.includes(String(payload.task_origin).toUpperCase())) return 'Origine de tache invalide';
  return null;
}

function mapStatusPayload(body = {}) {
  return {
    status: cleanQualityText(body.status),
    comment: cleanQualityText(body.comment),
    next_due_at: cleanQualityText(body.next_due_at || body.nextDueAt),
  };
}

function validateStatusPayload(payload) {
  if (!payload.status || !VALID_STATUSES.includes(payload.status)) return 'Statut invalide';
  if (payload.next_due_at && Number.isNaN(new Date(payload.next_due_at).getTime())) return 'Nouvelle échéance invalide';
  return null;
}

module.exports = {
  cleanUuid,
  mapStatusPayload,
  mapTaskPayload,
  validateStatusPayload,
  validateTaskPayload,
};
