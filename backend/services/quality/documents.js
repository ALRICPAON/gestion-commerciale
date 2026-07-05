const { logQualityEvent } = require('./eventLogger');

function ownerColumns(ownerType, ownerId) {
  return {
    zone_id: ownerType === 'zone' ? ownerId : null,
    equipment_id: ownerType === 'equipment' ? ownerId : null,
  };
}

async function assertOwner(db, storeId, ownerType, ownerId) {
  const table = ownerType === 'zone' ? 'quality_zones' : 'quality_equipments';
  const result = await db.query(
    `SELECT id, name, status FROM ${table} WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [ownerId, storeId]
  );
  if (!result.rows[0]) {
    const err = new Error('Objet qualité introuvable pour ce magasin');
    err.status = 400;
    throw err;
  }
  return result.rows[0];
}

function listWhere(query, alias, params) {
  const where = [`${alias}.store_id = $1`];
  if (!['true', '1', 'yes'].includes(String(query.include_archived || '').toLowerCase())) {
    where.push(`${alias}.archived_at IS NULL`);
  }
  if (query.owner_type && query.owner_id) {
    params.push(String(query.owner_type), String(query.owner_id));
    where.push(`${alias}.owner_type = $${params.length - 1}`, `${alias}.owner_id = $${params.length}`);
  }
  return where;
}

async function listDocuments(db, storeId, query = {}) {
  const params = [storeId];
  const where = listWhere(query, 'd', params);
  const result = await db.query(`SELECT d.* FROM quality_documents d WHERE ${where.join(' AND ')} ORDER BY d.archived_at NULLS FIRST, d.created_at DESC`, params);
  return result.rows;
}

async function getDocument(db, storeId, id) {
  const result = await db.query('SELECT * FROM quality_documents WHERE id = $1 AND store_id = $2 LIMIT 1', [id, storeId]);
  return result.rows[0] || null;
}

async function createDocument(db, storeId, userId, payload, file) {
  await assertOwner(db, storeId, payload.owner_type, payload.owner_id);
  const owner = ownerColumns(payload.owner_type, payload.owner_id);
  const result = await db.query(
    `INSERT INTO quality_documents (
      store_id, owner_type, owner_id, zone_id, equipment_id, type_code, name, description,
      version, document_date, author, original_filename, storage_path, file_size, mime_type,
      created_by, updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16) RETURNING *`,
    [storeId, payload.owner_type, payload.owner_id, owner.zone_id, owner.equipment_id, payload.type_code, payload.name || file.originalname, payload.description, payload.version, payload.document_date, payload.author, file.originalname, file.path, file.size, file.mimetype, userId]
  );
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.document.created', targetType: 'quality_document', targetId: result.rows[0].id, after: result.rows[0] });
  return result.rows[0];
}

async function archiveDocument(db, storeId, userId, id) {
  const before = await getDocument(db, storeId, id);
  if (!before) return null;
  const result = await db.query('UPDATE quality_documents SET archived_at = COALESCE(archived_at, now()), updated_by = $3, updated_at = now() WHERE id = $1 AND store_id = $2 RETURNING *', [id, storeId, userId]);
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.document.archived', targetType: 'quality_document', targetId: id, before, after: result.rows[0] });
  return result.rows[0];
}

async function restoreDocument(db, storeId, userId, id) {
  const before = await getDocument(db, storeId, id);
  if (!before) return null;
  const result = await db.query('UPDATE quality_documents SET archived_at = NULL, updated_by = $3, updated_at = now() WHERE id = $1 AND store_id = $2 RETURNING *', [id, storeId, userId]);
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.document.restored', targetType: 'quality_document', targetId: id, before, after: result.rows[0] });
  return result.rows[0];
}

async function listPhotos(db, storeId, query = {}) {
  const params = [storeId];
  const where = listWhere(query, 'p', params);
  const result = await db.query(`SELECT p.* FROM quality_photos p WHERE ${where.join(' AND ')} ORDER BY p.archived_at NULLS FIRST, p.is_primary DESC, p.display_order ASC, p.created_at DESC`, params);
  return result.rows;
}

async function getPhoto(db, storeId, id) {
  const result = await db.query('SELECT * FROM quality_photos WHERE id = $1 AND store_id = $2 LIMIT 1', [id, storeId]);
  return result.rows[0] || null;
}

async function createPhoto(db, storeId, userId, payload, file) {
  await assertOwner(db, storeId, payload.owner_type, payload.owner_id);
  const owner = ownerColumns(payload.owner_type, payload.owner_id);
  const result = await db.query(
    `INSERT INTO quality_photos (
      store_id, owner_type, owner_id, zone_id, equipment_id, caption, photo_date, author,
      display_order, is_primary, original_filename, storage_path, file_size, mime_type,
      created_by, updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING *`,
    [storeId, payload.owner_type, payload.owner_id, owner.zone_id, owner.equipment_id, payload.caption, payload.photo_date, payload.author, payload.display_order, payload.is_primary, file.originalname, file.path, file.size, file.mimetype, userId]
  );
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.photo.created', targetType: 'quality_photo', targetId: result.rows[0].id, after: result.rows[0] });
  return result.rows[0];
}

async function archivePhoto(db, storeId, userId, id) {
  const before = await getPhoto(db, storeId, id);
  if (!before) return null;
  const result = await db.query('UPDATE quality_photos SET archived_at = COALESCE(archived_at, now()), updated_by = $3, updated_at = now() WHERE id = $1 AND store_id = $2 RETURNING *', [id, storeId, userId]);
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.photo.archived', targetType: 'quality_photo', targetId: id, before, after: result.rows[0] });
  return result.rows[0];
}

async function restorePhoto(db, storeId, userId, id) {
  const before = await getPhoto(db, storeId, id);
  if (!before) return null;
  const result = await db.query('UPDATE quality_photos SET archived_at = NULL, updated_by = $3, updated_at = now() WHERE id = $1 AND store_id = $2 RETURNING *', [id, storeId, userId]);
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.photo.restored', targetType: 'quality_photo', targetId: id, before, after: result.rows[0] });
  return result.rows[0];
}

module.exports = {
  listDocuments,
  getDocument,
  createDocument,
  archiveDocument,
  restoreDocument,
  listPhotos,
  getPhoto,
  createPhoto,
  archivePhoto,
  restorePhoto,
};
