function validIsoDate(value) {
  if (!value) return null;
  const candidate = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate ? null : candidate;
}

function resolveDeliveryNoteDocumentDate(explicitDate, sourceOrderDate) {
  return validIsoDate(explicitDate) || validIsoDate(sourceOrderDate) || null;
}

module.exports = {
  resolveDeliveryNoteDocumentDate,
  validIsoDate,
};
