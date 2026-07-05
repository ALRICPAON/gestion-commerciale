const DOCUMENT_TYPES = Object.freeze(['NOTICE', 'FACTURE', 'CERTIFICAT', 'GARANTIE', 'PLAN', 'PHOTO', 'VIDEO', 'PROCEDURE', 'FDS', 'CONTRAT', 'AUTRE']);
const OWNER_TYPES = Object.freeze(['zone', 'equipment']);

function text(value) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).trim();
  return cleaned === '' ? null : cleaned;
}

function uuid(value) {
  const cleaned = text(value);
  if (!cleaned) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleaned) ? cleaned : null;
}

function date(value) {
  const cleaned = text(value);
  return cleaned && /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : null;
}

function integer(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

function owner(body = {}) {
  const ownerType = text(body.owner_type);
  const ownerId = uuid(body.owner_id);
  if (!OWNER_TYPES.includes(ownerType) || !ownerId) return null;
  return { owner_type: ownerType, owner_id: ownerId };
}

function documentPayload(body = {}) {
  const type = text(body.type || body.type_code) || 'AUTRE';
  const target = owner(body) || {};
  return {
    ...target,
    type_code: DOCUMENT_TYPES.includes(type) ? type : 'AUTRE',
    name: text(body.name),
    description: text(body.description),
    version: text(body.version),
    document_date: date(body.document_date),
    author: text(body.author),
  };
}

function photoPayload(body = {}) {
  const target = owner(body) || {};
  return {
    ...target,
    caption: text(body.caption),
    photo_date: date(body.photo_date),
    author: text(body.author),
    display_order: integer(body.display_order),
    is_primary: bool(body.is_primary),
  };
}

module.exports = {
  documentPayload,
  photoPayload,
  owner,
};
