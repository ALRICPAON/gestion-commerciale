const { cleanQualityText, isQualityUuid } = require('./common');
const { VALID_FREQUENCY_UNITS } = require('../../services/quality/taskScheduler');

const VALID_STATUSES = Object.freeze(['planned', 'due', 'overdue', 'completed', 'paused', 'cancelled']);
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
    module_key: cleanQualityText(body.module_key || body.moduleKey),
    entity_type: cleanQualityText(body.entity_type || body.entityType),
    entity_id: cleanUuid(body.entity_id || body.entityId),
    responsible_user_id: cleanUuid(body.responsible_user_id || body.responsibleUserId),
    frequency_value: cleanInteger(body.frequency_value || body.frequencyValue),
    frequency_unit: cleanQualityText(body.frequency_unit || body.frequencyUnit),
    target_time: normalizeTime(body.target_time || body.targetTime),
    next_due_at: cleanQualityText(body.next_due_at || body.nextDueAt),
    status: cleanQualityText(body.status) || 'planned',
    active: cleanBoolean(body.active, true),
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
