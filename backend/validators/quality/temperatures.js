const TEMPERATURE_SOURCES = Object.freeze(['scheduled', 'exceptional', 'manual', 'automatic', 'iot', 'import', 'api']);
const TEMPERATURE_ALERT_STATUSES = Object.freeze(['compliant', 'warning', 'out_of_limits']);
const TEMPERATURE_FREQUENCY_UNITS = Object.freeze(['hours', 'days', 'events']);
const TEMPERATURE_SCHEDULED_DAYS = Object.freeze(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
const TARGET_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function cleanUuid(value) {
  const text = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function nullableText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanStringArray(value) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))];
}

function normalizeTime(value) {
  const text = nullableText(value);
  if (!text) return null;
  return text.length === 5 && TARGET_TIME_PATTERN.test(text) ? `${text}:00` : text;
}

function cleanTimeArray(value) {
  return cleanStringArray(value).map(normalizeTime).filter(Boolean);
}

function mapRecordPayload(body = {}) {
  const source = nullableText(body.source) || 'manual';
  return {
    zone_id: cleanUuid(body.zone_id),
    equipment_id: cleanUuid(body.equipment_id),
    type_code: nullableText(body.type_code || body.type),
    value: nullableNumber(body.value),
    unit: nullableText(body.unit) || 'C',
    recorded_at: nullableText(body.recorded_at) || new Date().toISOString(),
    source: TEMPERATURE_SOURCES.includes(source) ? source : 'manual',
    parameter_id: cleanUuid(body.parameter_id || body.temperature_limit_id),
    operator_user_id: cleanUuid(body.operator_user_id),
    quality_task_id: cleanUuid(body.quality_task_id),
    occurrence_id: cleanUuid(body.occurrence_id),
    comment: nullableText(body.comment),
    method_used: nullableText(body.method_used || body.method),
    evidence_photo_id: cleanUuid(body.evidence_photo_id),
    evidence_document_id: cleanUuid(body.evidence_document_id),
    exceptional_reason: nullableText(body.exceptional_reason || body.reason),
  };
}

function mapLimitPayload(body = {}) {
  const frequencyUnit = nullableText(body.expected_frequency_unit);
  const hasTargetTimes = body.target_times !== undefined || body.targetTimes !== undefined;
  const targetTimes = hasTargetTimes ? cleanTimeArray(body.target_times || body.targetTimes) : [];
  const targetTime = normalizeTime(body.target_time || body.targetTime) || targetTimes[0] || null;
  return {
    type_code: nullableText(body.type_code || body.type),
    zone_id: cleanUuid(body.zone_id),
    equipment_id: cleanUuid(body.equipment_id),
    min_value: nullableNumber(body.min_value),
    max_value: nullableNumber(body.max_value),
    unit: nullableText(body.unit) || 'C',
    expected_frequency_value: nullableNumber(body.expected_frequency_value),
    expected_frequency_unit: TEMPERATURE_FREQUENCY_UNITS.includes(frequencyUnit) ? frequencyUnit : null,
    target_time: targetTime,
    target_times: hasTargetTimes ? targetTimes : [targetTime].filter(Boolean),
    scheduled_days: cleanStringArray(body.scheduled_days || body.scheduledDays),
    responsible_user_id: cleanUuid(body.responsible_user_id || body.responsibleUserId),
    quality_task_id: cleanUuid(body.quality_task_id),
    is_active: body.is_active !== false && body.is_active !== 'false',
    valid_from: nullableText(body.valid_from) || new Date().toISOString().slice(0, 10),
    valid_until: nullableText(body.valid_until),
  };
}

function validateRecordPayload(payload) {
  if (!payload.type_code) return 'Type de releve obligatoire';
  if (payload.value === null) return 'Valeur de temperature obligatoire';
  if (!payload.recorded_at) return 'Date/heure de releve obligatoire';
  return null;
}

function validateLimitPayload(payload) {
  if (!payload.type_code) return 'Type de temperature obligatoire';
  if (payload.min_value === null && payload.max_value === null) return 'Au moins une limite mini ou maxi est obligatoire';
  if (payload.min_value !== null && payload.max_value !== null && payload.min_value > payload.max_value) return 'La limite mini ne peut pas depasser la limite maxi';
  if (payload.scheduled_days?.some((day) => !TEMPERATURE_SCHEDULED_DAYS.includes(day))) return 'Jour de planification temperature invalide';
  if (payload.target_time && !TARGET_TIME_PATTERN.test(payload.target_time)) return 'Heure cible temperature invalide';
  if (payload.target_times?.some((time) => !TARGET_TIME_PATTERN.test(time))) return 'Horaire cible temperature invalide';
  return null;
}

module.exports = {
  TEMPERATURE_SOURCES,
  TEMPERATURE_ALERT_STATUSES,
  TEMPERATURE_FREQUENCY_UNITS,
  TEMPERATURE_SCHEDULED_DAYS,
  cleanUuid,
  mapRecordPayload,
  mapLimitPayload,
  validateRecordPayload,
  validateLimitPayload,
};
