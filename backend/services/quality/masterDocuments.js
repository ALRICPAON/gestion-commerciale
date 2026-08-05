const fs = require('fs');
const crypto = require('crypto');

const { logQualityEvent } = require('./eventLogger');

const STATUSES = new Set(['draft', 'valid', 'expired', 'replaced', 'archived']);
const SOURCE_TYPES = new Set(['CCI', 'laboratoire', 'prestataire', 'administration', 'fournisseur', 'interne']);
const ATTACHMENT_SOURCES = Object.freeze({
  quality_documentation_attachment: {
    table: 'quality_documentation_attachments',
    idColumn: 'id',
    titleColumn: 'filename',
    originalFilenameColumn: 'original_filename',
    pathColumn: 'file_path',
    mimeColumn: 'mime_type',
    sizeColumn: 'file_size',
    extraSelect: 'section_id',
  },
  quality_document: {
    table: 'quality_documents',
    idColumn: 'id',
    titleColumn: 'name',
    originalFilenameColumn: 'original_filename',
    pathColumn: 'storage_path',
    mimeColumn: 'mime_type',
    sizeColumn: 'file_size',
    extraSelect: 'owner_type, owner_id',
  },
  quality_photo: {
    table: 'quality_photos',
    idColumn: 'id',
    titleColumn: 'caption',
    originalFilenameColumn: 'original_filename',
    pathColumn: 'storage_path',
    mimeColumn: 'mime_type',
    sizeColumn: 'file_size',
    extraSelect: 'owner_type, owner_id',
  },
});

function cleanText(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function cleanDate(value) {
  const text = cleanText(value);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function cleanInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function normalizeStatus(value, fallback = 'draft') {
  const status = cleanText(value, fallback);
  return STATUSES.has(status) ? status : fallback;
}

function normalizeSourceType(value, fallback = 'interne') {
  const sourceType = cleanText(value, fallback);
  return SOURCE_TYPES.has(sourceType) ? sourceType : fallback;
}

function masterPayload(body = {}) {
  return {
    title: cleanText(body.title, 'Document maitre qualite'),
    document_type: cleanText(body.document_type || body.type, 'external_evidence'),
    category: cleanText(body.category),
    source_type: normalizeSourceType(body.source_type),
    issuer_name: cleanText(body.issuer_name),
    reference_number: cleanText(body.reference_number),
    issue_date: cleanDate(body.issue_date),
    valid_from: cleanDate(body.valid_from),
    valid_until: cleanDate(body.valid_until),
    version: cleanText(body.version, '1.0'),
    status: normalizeStatus(body.status),
    original_filename: cleanText(body.original_filename),
    storage_path: cleanText(body.storage_path || body.file_path),
    mime_type: cleanText(body.mime_type),
    file_size: body.file_size === undefined || body.file_size === null || body.file_size === '' ? null : Number(body.file_size),
    checksum_sha256: cleanText(body.checksum_sha256)?.toLowerCase() || null,
    description: cleanText(body.description),
    source_attachment_table: cleanText(body.source_attachment_table),
    source_attachment_id: cleanText(body.source_attachment_id),
  };
}

function referencePayload(body = {}) {
  return {
    document_id: cleanText(body.document_id || body.master_document_id),
    target_type: cleanText(body.target_type),
    target_id: cleanText(body.target_id),
    relation_type: cleanText(body.relation_type, 'reference'),
    label: cleanText(body.label),
    sort_order: cleanInteger(body.sort_order, 0),
  };
}

async function checksumFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function getExistingAttachment(db, storeId, sourceType, sourceId) {
  const source = ATTACHMENT_SOURCES[sourceType];
  if (!source || !sourceId) {
    const err = new Error('Source de piece jointe invalide');
    err.status = 400;
    throw err;
  }
  const result = await db.query(
    `SELECT ${source.idColumn} AS id,
            ${source.titleColumn} AS title,
            ${source.originalFilenameColumn} AS original_filename,
            ${source.pathColumn} AS storage_path,
            ${source.mimeColumn} AS mime_type,
            ${source.sizeColumn} AS file_size,
            ${source.extraSelect}
     FROM ${source.table}
     WHERE ${source.idColumn} = $1::uuid AND store_id = $2::uuid
     LIMIT 1`,
    [sourceId, storeId]
  );
  if (!result.rows[0]) {
    const err = new Error('Piece jointe existante introuvable pour ce magasin');
    err.status = 404;
    throw err;
  }
  return { ...result.rows[0], source_attachment_table: source.table, source_attachment_id: sourceId };
}

async function listMasterDocuments(db, storeId, query = {}) {
  const params = [storeId];
  const where = ['d.store_id = $1::uuid'];
  if (!['true', '1', 'yes'].includes(String(query.include_archived || '').toLowerCase())) {
    where.push('d.archived_at IS NULL');
  }
  if (query.status) {
    params.push(query.status);
    where.push(`d.status = $${params.length}::text`);
  }
  if (query.document_type) {
    params.push(query.document_type);
    where.push(`d.document_type = $${params.length}::text`);
  }
  if (query.category) {
    params.push(query.category);
    where.push(`d.category = $${params.length}::text`);
  }
  if (query.query) {
    params.push(`%${String(query.query).trim()}%`);
    where.push(`(d.title ILIKE $${params.length} OR d.reference_number ILIKE $${params.length} OR d.issuer_name ILIKE $${params.length})`);
  }
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  params.push(limit);
  const result = await db.query(
    `SELECT d.*,
            COUNT(r.id) FILTER (WHERE r.archived_at IS NULL)::int AS active_reference_count
     FROM quality_master_documents d
     LEFT JOIN quality_document_references r ON r.document_id = d.id AND r.store_id = d.store_id
     WHERE ${where.join(' AND ')}
     GROUP BY d.id
     ORDER BY d.archived_at NULLS FIRST, d.updated_at DESC
     LIMIT $${params.length}::int`,
    params
  );
  return result.rows;
}

async function getMasterDocument(db, storeId, id) {
  const result = await db.query(
    'SELECT * FROM quality_master_documents WHERE id = $1::uuid AND store_id = $2::uuid LIMIT 1',
    [id, storeId]
  );
  const document = result.rows[0] || null;
  if (!document) return null;
  const references = await listDocumentReferences(db, storeId, { document_id: id, include_archived: true });
  return { ...document, references };
}

async function createMasterDocument(db, storeId, userId, body = {}) {
  const payload = masterPayload(body);
  if (!payload.title) throw Object.assign(new Error('Titre du document maitre obligatoire'), { status: 400 });
  if (payload.storage_path && !payload.checksum_sha256) payload.checksum_sha256 = await checksumFile(payload.storage_path);
  const result = await db.query(
    `INSERT INTO quality_master_documents (
      store_id, title, document_type, category, source_type, issuer_name, reference_number,
      issue_date, valid_from, valid_until, version, status, original_filename, storage_path,
      mime_type, file_size, checksum_sha256, description, source_attachment_table,
      source_attachment_id, created_by, updated_by
    ) VALUES (
      $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,
      $8::date,$9::date,$10::date,$11::text,$12::text,$13::text,$14::text,
      $15::text,$16::bigint,$17::text,$18::text,$19::text,$20::uuid,$21::uuid,$21::uuid
    )
    RETURNING *`,
    [
      storeId, payload.title, payload.document_type, payload.category, payload.source_type,
      payload.issuer_name, payload.reference_number, payload.issue_date, payload.valid_from,
      payload.valid_until, payload.version, payload.status, payload.original_filename,
      payload.storage_path, payload.mime_type, payload.file_size, payload.checksum_sha256,
      payload.description, payload.source_attachment_table, payload.source_attachment_id, userId,
    ]
  );
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.master_document.created', targetType: 'quality_master_document', targetId: result.rows[0].id, after: result.rows[0] });
  return result.rows[0];
}

async function updateMasterDocument(db, storeId, id, userId, body = {}) {
  const before = await getMasterDocument(db, storeId, id);
  if (!before) return null;
  const payload = masterPayload({ ...before, ...body });
  if (payload.storage_path && !payload.checksum_sha256) payload.checksum_sha256 = await checksumFile(payload.storage_path);
  const result = await db.query(
    `UPDATE quality_master_documents
     SET title=$3::text, document_type=$4::text, category=$5::text, source_type=$6::text,
         issuer_name=$7::text, reference_number=$8::text, issue_date=$9::date,
         valid_from=$10::date, valid_until=$11::date, version=$12::text, status=$13::text,
         original_filename=$14::text, storage_path=$15::text, mime_type=$16::text,
         file_size=$17::bigint, checksum_sha256=$18::text, description=$19::text,
         source_attachment_table=$20::text, source_attachment_id=$21::uuid,
         updated_by=$22::uuid, updated_at=now(),
         archived_at=CASE WHEN $13::text = 'archived' THEN COALESCE(archived_at, now()) ELSE archived_at END,
         archived_by=CASE WHEN $13::text = 'archived' THEN COALESCE(archived_by, $22::uuid) ELSE archived_by END
     WHERE id=$1::uuid AND store_id=$2::uuid
     RETURNING *`,
    [
      id, storeId, payload.title, payload.document_type, payload.category, payload.source_type,
      payload.issuer_name, payload.reference_number, payload.issue_date, payload.valid_from,
      payload.valid_until, payload.version, payload.status, payload.original_filename,
      payload.storage_path, payload.mime_type, payload.file_size, payload.checksum_sha256,
      payload.description, payload.source_attachment_table, payload.source_attachment_id, userId,
    ]
  );
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.master_document.updated', targetType: 'quality_master_document', targetId: id, before, after: result.rows[0] });
  return result.rows[0];
}

async function archiveMasterDocument(db, storeId, id, userId) {
  return updateMasterDocument(db, storeId, id, userId, { status: 'archived' });
}

async function linkExistingAttachmentToMasterDocument(db, storeId, userId, body = {}) {
  const sourceType = cleanText(body.source_type || body.attachment_source_type || body.attachment_type);
  const sourceId = cleanText(body.source_id || body.attachment_id);
  const attachment = await getExistingAttachment(db, storeId, sourceType, sourceId);
  const checksum = body.checksum_sha256 || await checksumFile(attachment.storage_path);
  const existing = checksum
    ? await db.query('SELECT * FROM quality_master_documents WHERE store_id=$1::uuid AND checksum_sha256=$2::text AND archived_at IS NULL LIMIT 1', [storeId, checksum])
    : { rows: [] };
  const document = existing.rows[0] || await createMasterDocument(db, storeId, userId, {
    title: body.title || attachment.title || attachment.original_filename || 'Document maitre qualite',
    document_type: body.document_type || 'external_evidence',
    category: body.category,
    source_type: body.source_type_master || body.document_source_type || 'interne',
    issuer_name: body.issuer_name,
    reference_number: body.reference_number,
    issue_date: body.issue_date,
    valid_from: body.valid_from,
    valid_until: body.valid_until,
    version: body.version || '1.0',
    status: body.status || 'draft',
    original_filename: attachment.original_filename,
    storage_path: attachment.storage_path,
    mime_type: attachment.mime_type,
    file_size: attachment.file_size,
    checksum_sha256: checksum,
    description: body.description,
    source_attachment_table: attachment.source_attachment_table,
    source_attachment_id: attachment.source_attachment_id,
  });
  return { document, reused_existing: Boolean(existing.rows[0]), attachment };
}

async function addDocumentReference(db, storeId, userId, body = {}) {
  const payload = referencePayload(body);
  if (!payload.document_id || !payload.target_type) {
    throw Object.assign(new Error('Document maitre et cible obligatoires'), { status: 400 });
  }
  const document = await getMasterDocument(db, storeId, payload.document_id);
  if (!document || document.archived_at) {
    throw Object.assign(new Error('Document maitre introuvable ou archive'), { status: 404 });
  }
  const existing = await db.query(
    `SELECT *
     FROM quality_document_references
     WHERE store_id = $1::uuid
       AND document_id = $2::uuid
       AND target_type = $3::text
       AND COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($4::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
       AND relation_type = $5::text
       AND archived_at IS NULL
     LIMIT 1`,
    [storeId, payload.document_id, payload.target_type, payload.target_id, payload.relation_type]
  );
  if (existing.rows[0]) {
    const updated = await db.query(
      `UPDATE quality_document_references
       SET label = $3::text, sort_order = $4::int
       WHERE id = $1::uuid AND store_id = $2::uuid
       RETURNING *`,
      [existing.rows[0].id, storeId, payload.label, payload.sort_order]
    );
    return updated.rows[0];
  }
  const result = await db.query(
    `INSERT INTO quality_document_references (
      store_id, document_id, target_type, target_id, relation_type, label, sort_order, created_by
    ) VALUES ($1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::text,$7::int,$8::uuid)
    RETURNING *`,
    [storeId, payload.document_id, payload.target_type, payload.target_id, payload.relation_type, payload.label, payload.sort_order, userId]
  );
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.master_document.reference.linked', targetType: payload.target_type, targetId: payload.target_id, after: result.rows[0] });
  return result.rows[0];
}

async function archiveDocumentReference(db, storeId, userId, referenceId) {
  const result = await db.query(
    `UPDATE quality_document_references
     SET archived_at = COALESCE(archived_at, now()), archived_by = COALESCE(archived_by, $3::uuid)
     WHERE id = $1::uuid AND store_id = $2::uuid
     RETURNING *`,
    [referenceId, storeId, userId]
  );
  if (result.rows[0]) {
    await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.master_document.reference.archived', targetType: 'quality_document_reference', targetId: referenceId, after: result.rows[0] });
  }
  return result.rows[0] || null;
}

async function listDocumentReferences(db, storeId, query = {}) {
  const params = [storeId];
  const where = ['r.store_id = $1::uuid'];
  if (query.document_id) {
    params.push(query.document_id);
    where.push(`r.document_id = $${params.length}::uuid`);
  }
  if (query.target_type) {
    params.push(query.target_type);
    where.push(`r.target_type = $${params.length}::text`);
  }
  if (query.target_id) {
    params.push(query.target_id);
    where.push(`r.target_id = $${params.length}::uuid`);
  }
  if (!['true', '1', 'yes'].includes(String(query.include_archived || '').toLowerCase())) {
    where.push('r.archived_at IS NULL');
  }
  const result = await db.query(
    `SELECT r.*, d.title AS document_title, d.status AS document_status, d.valid_until,
            d.document_type, d.category, d.source_type, d.original_filename
     FROM quality_document_references r
     JOIN quality_master_documents d ON d.id = r.document_id AND d.store_id = r.store_id
     WHERE ${where.join(' AND ')}
     ORDER BY r.archived_at NULLS FIRST, r.sort_order ASC, r.created_at DESC`,
    params
  );
  return result.rows;
}

async function listIncomingReferences(db, storeId, documentId) {
  return listDocumentReferences(db, storeId, { document_id: documentId, include_archived: true });
}

async function getDocumentsForTarget(db, storeId, targetType, targetId = null) {
  return listDocumentReferences(db, storeId, { target_type: targetType, target_id: targetId });
}

async function compareDocuments(db, storeId, firstId, secondId) {
  const [first, second] = await Promise.all([
    getMasterDocument(db, storeId, firstId),
    getMasterDocument(db, storeId, secondId),
  ]);
  if (!first || !second) throw Object.assign(new Error('Documents a comparer introuvables'), { status: 404 });
  return {
    first,
    second,
    same_checksum: Boolean(first.checksum_sha256 && second.checksum_sha256 && first.checksum_sha256 === second.checksum_sha256),
    same_filename: Boolean(first.original_filename && second.original_filename && first.original_filename === second.original_filename),
    same_size: first.file_size !== null && first.file_size !== undefined && Number(first.file_size) === Number(second.file_size),
    merge_allowed_automatically: false,
    warning: 'Aucune fusion automatique: seul un checksum identique prouve un doublon exact.',
  };
}

async function diagnoseDuplicates(db, storeId) {
  const docs = await listMasterDocuments(db, storeId, { include_archived: true, limit: 500 });
  const byChecksum = new Map();
  const byNameSize = new Map();
  docs.forEach((doc) => {
    if (doc.checksum_sha256) {
      const list = byChecksum.get(doc.checksum_sha256) || [];
      list.push(doc);
      byChecksum.set(doc.checksum_sha256, list);
    }
    const nameKey = `${doc.original_filename || ''}::${doc.file_size || ''}`;
    if (doc.original_filename || doc.file_size) {
      const list = byNameSize.get(nameKey) || [];
      list.push(doc);
      byNameSize.set(nameKey, list);
    }
  });
  return {
    documents: docs,
    exact_duplicates: [...byChecksum.values()].filter((items) => items.length > 1),
    potential_duplicates: [...byNameSize.values()].filter((items) => items.length > 1),
    rule: 'Les noms identiques ne suffisent jamais pour fusionner deux fichiers.',
  };
}

async function inventoryExistingAttachments(db, storeId) {
  const queries = [
    db.query(
      `SELECT 'quality_documentation_attachment' AS source_type, a.id, a.section_id AS target_id,
              'documentation_section' AS target_type, a.filename AS name, a.original_filename,
              a.file_path AS storage_path, a.mime_type, a.file_size, a.created_at, s.code AS target_code, s.title AS target_title
       FROM quality_documentation_attachments a
       LEFT JOIN quality_documentation_sections s ON s.id = a.section_id AND s.store_id = a.store_id
       WHERE a.store_id=$1::uuid`,
      [storeId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT 'quality_document' AS source_type, id, owner_id AS target_id, owner_type AS target_type,
              name, original_filename, storage_path, mime_type, file_size, created_at, owner_type AS target_code, owner_id::text AS target_title
       FROM quality_documents WHERE store_id=$1::uuid`,
      [storeId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT 'quality_photo' AS source_type, id, owner_id AS target_id, owner_type AS target_type,
              caption AS name, original_filename, storage_path, mime_type, file_size, created_at, owner_type AS target_code, owner_id::text AS target_title
       FROM quality_photos WHERE store_id=$1::uuid`,
      [storeId]
    ).catch(() => ({ rows: [] })),
  ];
  const results = await Promise.all(queries);
  const attachments = results.flatMap((result) => result.rows);
  const enriched = [];
  for (const attachment of attachments) {
    enriched.push({ ...attachment, checksum_sha256: await checksumFile(attachment.storage_path) });
  }
  return enriched;
}

module.exports = {
  ATTACHMENT_SOURCES,
  checksumFile,
  inventoryExistingAttachments,
  listMasterDocuments,
  getMasterDocument,
  createMasterDocument,
  updateMasterDocument,
  archiveMasterDocument,
  linkExistingAttachmentToMasterDocument,
  addDocumentReference,
  archiveDocumentReference,
  listDocumentReferences,
  listIncomingReferences,
  getDocumentsForTarget,
  compareDocuments,
  diagnoseDuplicates,
};
