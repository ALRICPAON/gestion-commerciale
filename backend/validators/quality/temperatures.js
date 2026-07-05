const TEMPERATURE_SOURCES = Object.freeze(['manual', 'iot', 'import', 'api']);
const TEMPERATURE_ALERT_STATUSES = Object.freeze(['compliant', 'warning', 'out_of_limits']);

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

function mapRecordPayload(body = {}) {
  const source = nullableText(body.source) || 'manual';
  return {
    zone_id: cleanUuid(body.zone_id),
    equipment_id: cleanUuid(body.equipment_id),
    type_code: nullableText(body.type_code || body.type),
    value: nullableNumber(body.value),
    unit: nullableText(body.unit) || '°C',
    recorded_at: nullableText(body.recorded_at) || new Date().toISOString(),
    source: TEMPERATURE_SOURCES.includes(source) ? source : 'manual',
    operator_user_id: cleanUuid(body.operator_user_id),
    comment: nullableText(body.comment),
    evidence_photo_id: cleanUuid(body.evidence_photo_id),
    evidence_document_id: cleanUuid(body.evidence_document_id),
  };
}

function mapLimitPayload(body = {}) {
  return {
    type_code: nullableText(body.type_code || body.type),
    zone_id: cleanUuid(body.zone_id),
    equipment_id: cleanUuid(body.equipment_id),
    min_value: nullableNumber(body.min_value),
    max_value: nullableNumber(body.max_value),
    unit: nullableText(body.unit) || '°C',
    is_active: body.is_active !== false && body.is_active !== 'false',
    valid_from: nullableText(body.valid_from) || new Date().toISOString().slice(0, 10),
    valid_until: nullableText(body.valid_until),
  };
}

function validateRecordPayload(payload) {
  if (!payload.type_code) return 'Type de relevé obligatoire';
  if (payload.value === null) return 'Valeur de température obligatoire';
  if (!payload.recorded_at) return 'Date/heure de relevé obligatoire';
  return null;
}

function validateLimitPayload(payload) {
  if (!payload.type_code) return 'Type de température obligatoire';
  if (payload.min_value === null && payload.max_value === null) return 'Au moins une limite mini ou maxi est obligatoire';
  if (payload.min_value !== null && payload.max_value !== null && payload.min_value > payload.max_value) {
    return 'La limite mini ne peut pas dépasser la limite maxi';
  }
  return null;
}

module.exports = {
  TEMPERATURE_SOURCES,
  TEMPERATURE_ALERT_STATUSES,
  cleanUuid,
  mapRecordPayload,
  mapLimitPayload,
  validateRecordPayload,
  validateLimitPayload,
};
