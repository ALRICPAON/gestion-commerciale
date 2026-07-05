const ZONE_STATUSES = Object.freeze(['active', 'inactive', 'archived']);
const EQUIPMENT_STATUSES = Object.freeze(['active', 'inactive', 'maintenance', 'out_of_service', 'archived']);
const EQUIPMENT_CRITICALITIES = Object.freeze(['low', 'medium', 'high', 'critical']);

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function cleanCode(value) {
  const text = cleanText(value);
  return text ? text.toUpperCase().replace(/\s+/g, '-') : null;
}

function cleanNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function cleanBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function cleanDate(value) {
  const text = cleanText(value);
  if (!text) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function cleanEnum(value, allowed, fallback) {
  const text = cleanText(value);
  if (!text) return fallback;
  return allowed.includes(text) ? text : fallback;
}

function cleanUuid(value) {
  const text = cleanText(value);
  if (!text) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function mapZonePayload(body = {}) {
  return {
    code: cleanCode(body.code),
    name: cleanText(body.name),
    type: cleanText(body.type) || 'atelier',
    description: cleanText(body.description),
    surface_area: cleanNumber(body.surface_area),
    capacity: cleanText(body.capacity),
    status: cleanEnum(body.status, ZONE_STATUSES, 'active'),
    responsible_user_id: cleanUuid(body.responsible_user_id),
  };
}

function mapEquipmentPayload(body = {}) {
  return {
    zone_id: cleanUuid(body.zone_id),
    code: cleanCode(body.code),
    name: cleanText(body.name),
    type: cleanText(body.type) || 'equipment',
    description: cleanText(body.description),
    manufacturer: cleanText(body.manufacturer),
    model: cleanText(body.model),
    serial_number: cleanText(body.serial_number),
    supplier_name: cleanText(body.supplier_name),
    purchase_date: cleanDate(body.purchase_date),
    warranty_end_date: cleanDate(body.warranty_end_date),
    status: cleanEnum(body.status, EQUIPMENT_STATUSES, 'active'),
    is_food_contact: cleanBoolean(body.is_food_contact),
    is_temperature_controlled: cleanBoolean(body.is_temperature_controlled),
    requires_cleaning: cleanBoolean(body.requires_cleaning),
    requires_maintenance: cleanBoolean(body.requires_maintenance),
    requires_calibration: cleanBoolean(body.requires_calibration),
    criticality: cleanEnum(body.criticality, EQUIPMENT_CRITICALITIES, 'medium'),
  };
}

module.exports = {
  ZONE_STATUSES,
  EQUIPMENT_STATUSES,
  EQUIPMENT_CRITICALITIES,
  cleanUuid,
  mapZonePayload,
  mapEquipmentPayload,
};
