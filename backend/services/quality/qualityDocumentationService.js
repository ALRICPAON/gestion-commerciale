const { logQualityEvent } = require('./eventLogger');
const { initializeDefaultDocumentation, stripHtml } = require('./qualityDocumentationTemplateService');
const { recordSectionVersion } = require('./qualityDocumentationVersionService');

const STATUSES = new Set(['draft', 'to_complete', 'ready_for_review', 'validated', 'archived']);

function cleanText(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text === '' ? fallback : text;
}

function sanitizeHtml(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '');
}

function sectionPayload(body = {}) {
  const contentHtml = sanitizeHtml(body.content_html || '');
  return {
    parent_id: cleanText(body.parent_id),
    section_type: cleanText(body.section_type, 'chapter'),
    code: cleanText(body.code),
    title: cleanText(body.title, 'Sans titre'),
    content_html: contentHtml,
    content_text: cleanText(body.content_text, stripHtml(contentHtml)),
    display_order: Number.isFinite(Number(body.display_order)) ? Number(body.display_order) : 0,
    status: STATUSES.has(body.status) ? body.status : 'draft',
    version: cleanText(body.version, '1.0'),
    include_in_export: body.include_in_export !== false && body.include_in_export !== 'false',
    comment_internal: cleanText(body.comment_internal),
    regulatory_references: cleanText(body.regulatory_references),
    validated_by: cleanText(body.validated_by),
    validated_at: cleanText(body.validated_at),
    applicable_from: cleanText(body.applicable_from),
    revision_due_at: cleanText(body.revision_due_at),
  };
}

async function getOrCreateDefaultDocumentation(db, storeId, userId) {
  const collection = await initializeDefaultDocumentation(db, storeId, userId);
  return getDocumentation(db, storeId, collection.id);
}

async function listDocumentation(db, storeId) {
  const result = await db.query(
    `SELECT c.*,
      (SELECT COUNT(*)::int FROM quality_documentation_sections s WHERE s.collection_id = c.id AND s.store_id = c.store_id AND s.archived_at IS NULL AND s.section_type = 'tome') AS tome_count,
      (SELECT COUNT(*)::int FROM quality_documentation_sections s WHERE s.collection_id = c.id AND s.store_id = c.store_id AND s.archived_at IS NULL AND s.section_type <> 'tome') AS chapter_count
     FROM quality_documentation_collections c
     WHERE c.store_id = $1
     ORDER BY c.updated_at DESC`,
    [storeId]
  );
  return result.rows;
}

async function getDocumentation(db, storeId, id) {
  const collectionResult = await db.query(
    'SELECT * FROM quality_documentation_collections WHERE id = $1 AND store_id = $2 LIMIT 1',
    [id, storeId]
  );
  const collection = collectionResult.rows[0];
  if (!collection) return null;

  const [sections, missing, attachments, exports] = await Promise.all([
    db.query(
      `SELECT * FROM quality_documentation_sections
       WHERE collection_id = $1 AND store_id = $2
       ORDER BY display_order ASC, created_at ASC`,
      [id, storeId]
    ),
    db.query(
      `SELECT m.*, s.title AS section_title, s.code AS section_code
       FROM quality_documentation_missing_items m
       JOIN quality_documentation_sections s ON s.id = m.section_id AND s.store_id = m.store_id
       WHERE m.store_id = $1 AND s.collection_id = $2
       ORDER BY m.status ASC, m.due_at NULLS LAST, m.created_at DESC`,
      [storeId, id]
    ),
    db.query(
      `SELECT a.*, s.title AS section_title
       FROM quality_documentation_attachments a
       JOIN quality_documentation_sections s ON s.id = a.section_id AND s.store_id = a.store_id
       WHERE a.store_id = $1 AND s.collection_id = $2
       ORDER BY a.archived_at NULLS FIRST, a.display_order ASC, a.created_at DESC`,
      [storeId, id]
    ),
    db.query(
      `SELECT * FROM quality_documentation_exports
       WHERE collection_id = $1 AND store_id = $2
       ORDER BY generated_at DESC
       LIMIT 10`,
      [id, storeId]
    ),
  ]);

  const activeSections = sections.rows.filter((section) => !section.archived_at);
  const chapters = activeSections.filter((section) => section.section_type !== 'tome');
  const validated = chapters.filter((section) => section.status === 'validated').length;
  const openMissing = missing.rows.filter((item) => item.status !== 'resolved').length;
  const completion = chapters.length === 0 ? 0 : Math.max(0, Math.round(((validated / chapters.length) * 100) - Math.min(openMissing * 2, 30)));

  return {
    collection,
    sections: sections.rows,
    missing_items: missing.rows,
    attachments: attachments.rows,
    exports: exports.rows,
    dashboard: {
      tome_count: activeSections.filter((section) => section.section_type === 'tome').length,
      chapter_count: chapters.length,
      validated_count: validated,
      to_complete_count: chapters.filter((section) => section.status === 'to_complete').length,
      attachment_count: attachments.rows.filter((item) => !item.archived_at).length,
      last_modification: activeSections.map((section) => section.updated_at).sort().pop() || collection.updated_at,
      last_export: exports.rows[0]?.generated_at || null,
      completion_percent: completion,
    },
  };
}

async function createSection(db, storeId, collectionId, userId, body) {
  const payload = sectionPayload(body);
  const result = await db.query(
    `INSERT INTO quality_documentation_sections
     (collection_id, store_id, parent_id, section_type, code, title, content_html, content_text, display_order, status, version, include_in_export, comment_internal, regulatory_references, revision_due_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
     RETURNING *`,
    [collectionId, storeId, payload.parent_id, payload.section_type, payload.code, payload.title, payload.content_html, payload.content_text, payload.display_order, payload.status, payload.version, payload.include_in_export, payload.comment_internal, payload.regulatory_references, payload.revision_due_at, userId]
  );
  await recordSectionVersion(db, storeId, result.rows[0], userId, 'Creation du chapitre', 'create');
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.documentation.section.created', targetType: 'quality_documentation_section', targetId: result.rows[0].id, after: result.rows[0] });
  return result.rows[0];
}

async function updateSection(db, storeId, sectionId, userId, body) {
  const beforeResult = await db.query('SELECT * FROM quality_documentation_sections WHERE id = $1 AND store_id = $2 LIMIT 1', [sectionId, storeId]);
  const before = beforeResult.rows[0];
  if (!before) return null;
  const payload = sectionPayload({ ...before, ...body });
  const validatedAt = payload.status === 'validated' && !before.validated_at ? new Date().toISOString() : payload.validated_at;
  const result = await db.query(
    `UPDATE quality_documentation_sections
     SET parent_id = $3,
         section_type = $4,
         code = $5,
         title = $6,
         content_html = $7,
         content_text = $8,
         display_order = $9,
         status = $10,
         version = $11,
         include_in_export = $12,
         comment_internal = $13,
         regulatory_references = $14,
         validated_by = CASE WHEN $10 = 'validated' THEN COALESCE(validated_by, $16) ELSE validated_by END,
         validated_at = $15,
         applicable_from = $17,
         revision_due_at = $18,
         updated_by = $16,
         updated_at = now(),
         archived_at = CASE WHEN $10 = 'archived' THEN COALESCE(archived_at, now()) ELSE archived_at END
     WHERE id = $1 AND store_id = $2
     RETURNING *`,
    [sectionId, storeId, payload.parent_id, payload.section_type, payload.code, payload.title, payload.content_html, payload.content_text, payload.display_order, payload.status, payload.version, payload.include_in_export, payload.comment_internal, payload.regulatory_references, validatedAt, userId, payload.applicable_from, payload.revision_due_at]
  );
  await recordSectionVersion(db, storeId, result.rows[0], userId, body.change_summary || 'Modification du chapitre', 'update', before);
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.documentation.section.updated', targetType: 'quality_documentation_section', targetId: sectionId, before, after: result.rows[0] });
  return result.rows[0];
}

async function deleteSection(db, storeId, sectionId, userId) {
  return updateSection(db, storeId, sectionId, userId, { status: 'archived', change_summary: 'Archivage du chapitre' });
}

async function listMissingItems(db, storeId, query = {}) {
  const params = [storeId];
  const where = ['m.store_id = $1'];
  if (query.status) {
    params.push(query.status);
    where.push(`m.status = $${params.length}`);
  }
  if (query.severity) {
    params.push(query.severity);
    where.push(`m.severity = $${params.length}`);
  }
  if (query.overdue === 'true') {
    where.push("m.status <> 'resolved' AND m.due_at < CURRENT_DATE");
  }
  const result = await db.query(
    `SELECT m.*, s.title AS section_title, s.code AS section_code, s.collection_id
     FROM quality_documentation_missing_items m
     JOIN quality_documentation_sections s ON s.id = m.section_id AND s.store_id = m.store_id
     WHERE ${where.join(' AND ')}
     ORDER BY m.status ASC, m.due_at NULLS LAST, m.created_at DESC`,
    params
  );
  return result.rows;
}

async function createMissingItem(db, storeId, userId, body) {
  const result = await db.query(
    `INSERT INTO quality_documentation_missing_items
     (section_id, store_id, description, severity, responsible_user_id, due_at, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [body.section_id, storeId, cleanText(body.description, 'Information a completer'), cleanText(body.severity, 'normal'), cleanText(body.responsible_user_id), cleanText(body.due_at), cleanText(body.status, 'open')]
  );
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.documentation.missing.created', targetType: 'quality_documentation_missing_item', targetId: result.rows[0].id, after: result.rows[0] });
  return result.rows[0];
}

async function updateMissingItem(db, storeId, id, userId, body) {
  const result = await db.query(
    `UPDATE quality_documentation_missing_items
     SET description = COALESCE($3, description),
         severity = COALESCE($4, severity),
         responsible_user_id = COALESCE($5, responsible_user_id),
         due_at = COALESCE($6, due_at),
         status = COALESCE($7, status),
         resolved_at = CASE WHEN $7 = 'resolved' THEN COALESCE(resolved_at, now()) ELSE resolved_at END,
         resolved_by = CASE WHEN $7 = 'resolved' THEN COALESCE(resolved_by, $8) ELSE resolved_by END,
         updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING *`,
    [id, storeId, cleanText(body.description), cleanText(body.severity), cleanText(body.responsible_user_id), cleanText(body.due_at), cleanText(body.status), userId]
  );
  return result.rows[0] || null;
}

module.exports = {
  createMissingItem,
  createSection,
  deleteSection,
  getDocumentation,
  getOrCreateDefaultDocumentation,
  listDocumentation,
  listMissingItems,
  sanitizeHtml,
  updateMissingItem,
  updateSection,
};
