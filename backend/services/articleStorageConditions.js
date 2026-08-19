function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function nullableTemperature(value, fieldLabel = 'temperature') {
  const text = clean(value);
  if (text === null) return null;
  const parsed = Number(text.replace(',', '.'));
  if (!Number.isFinite(parsed)) {
    const error = new Error(`${fieldLabel} doit etre un nombre`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

function storagePayload(body = {}) {
  return {
    storage_temperature_min: nullableTemperature(body.storage_temperature_min, 'Temperature minimale de conservation'),
    storage_temperature_max: nullableTemperature(body.storage_temperature_max, 'Temperature maximale de conservation'),
    storage_instruction: clean(body.storage_instruction),
  };
}

function validateStorageRange(payload) {
  const min = payload.storage_temperature_min;
  const max = payload.storage_temperature_max;
  if (min !== null && max !== null && min > max) {
    const error = new Error('Temperature minimale de conservation superieure a la temperature maximale');
    error.status = 400;
    throw error;
  }
  return payload;
}

function normalizeStoragePayload(body = {}) {
  return validateStorageRange(storagePayload(body));
}

function hasStorageField(body = {}, field) {
  return Object.prototype.hasOwnProperty.call(body, field) && body[field] !== undefined;
}

function mergeStoragePatch(current = {}, body = {}) {
  const next = {
    storage_temperature_min: hasStorageField(body, 'storage_temperature_min')
      ? nullableTemperature(body.storage_temperature_min, 'Temperature minimale de conservation')
      : current.storage_temperature_min ?? null,
    storage_temperature_max: hasStorageField(body, 'storage_temperature_max')
      ? nullableTemperature(body.storage_temperature_max, 'Temperature maximale de conservation')
      : current.storage_temperature_max ?? null,
    storage_instruction: hasStorageField(body, 'storage_instruction')
      ? clean(body.storage_instruction)
      : current.storage_instruction ?? null,
  };
  return validateStorageRange(next);
}

module.exports = {
  clean,
  hasStorageField,
  mergeStoragePatch,
  normalizeStoragePayload,
  nullableTemperature,
  validateStorageRange,
};
