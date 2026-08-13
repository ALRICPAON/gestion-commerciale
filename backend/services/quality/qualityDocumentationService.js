const { logQualityEvent } = require('./eventLogger');
const { initializeDefaultDocumentation, stripHtml } = require('./qualityDocumentationTemplateService');
const { recordSectionVersion } = require('./qualityDocumentationVersionService');
const { ensureDefaultFabricationDiagram } = require('./qualityDocumentationDiagramService');
const { ensureDefaultProductTables } = require('./qualityDocumentationTableService');
const { hydrateBlocks, syncRichTextBlockFromContentHtml } = require('./qualityDocumentBlockService');

const STATUSES = new Set(['draft', 'to_complete', 'ready_for_review', 'validated', 'archived']);
const MISSING_ITEM_STATUSES = new Set(['open', 'resolved']);
const MISSING_ITEM_SEVERITIES = new Set([
  'normal',
  'blocking',
  'low',
  'medium',
  'high',
  'critical',
  'before_submission',
  'before_opening',
  'future',
  'after_instruction',
  'to_confirm',
  'external_pending',
]);

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

function assertAllowed(value, allowed, label) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = cleanText(value);
  if (!allowed.has(normalized)) {
    const err = new Error(`${label} invalide: ${normalized}`);
    err.status = 400;
    throw err;
  }
  return normalized;
}

function cleanDate(value, label) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const normalized = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    const err = new Error(`${label} invalide: utiliser YYYY-MM-DD`);
    err.status = 400;
    throw err;
  }
  return normalized;
}

async function getMissingItem(db, storeId, id) {
  if (!cleanText(id)) {
    const err = new Error('missing_item_id requis');
    err.status = 400;
    throw err;
  }
  const result = await db.query(
    `SELECT m.*, s.collection_id, s.title AS section_title, s.code AS section_code
     FROM quality_documentation_missing_items m
     JOIN quality_documentation_sections s ON s.id = m.section_id AND s.store_id = m.store_id
     WHERE m.id = $1 AND m.store_id = $2
     LIMIT 1`,
    [id, storeId]
  );
  return result.rows[0] || null;
}

async function assertMissingItemScope(db, storeId, item, body = {}) {
  if (!item) return;
  if (body.section_id && String(body.section_id) !== String(item.section_id)) {
    const err = new Error('Information manquante hors chapitre demande');
    err.status = 400;
    throw err;
  }
  if (body.collection_id && String(body.collection_id) !== String(item.collection_id)) {
    const err = new Error('Information manquante hors collection demandee');
    err.status = 400;
    throw err;
  }
  if (body.responsible_user_id) {
    const user = await db.query('SELECT id FROM users WHERE id = $1 AND store_id = $2 AND is_active = true LIMIT 1', [body.responsible_user_id, storeId]);
    if (!user.rows[0]) {
      const err = new Error('Responsable introuvable pour ce magasin');
      err.status = 400;
      throw err;
    }
  }
}

function missingItemChanges(before, after) {
  const fields = ['description', 'severity', 'responsible_user_id', 'due_at', 'status', 'resolved_at', 'resolved_by'];
  return fields.reduce((changes, field) => {
    if (String(before?.[field] ?? '') !== String(after?.[field] ?? '')) {
      changes[field] = { before: before?.[field] ?? null, after: after?.[field] ?? null };
    }
    return changes;
  }, {});
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

async function getSection(db, storeId, sectionId) {
  const result = await db.query(
    'SELECT * FROM quality_documentation_sections WHERE id = $1 AND store_id = $2 LIMIT 1',
    [sectionId, storeId]
  );
  return result.rows[0] || null;
}

async function getOrCreateDefaultDocumentation(db, storeId, userId) {
  const collection = await initializeDefaultDocumentation(db, storeId, userId);
  try {
    await ensureDefaultFabricationDiagram(db, storeId, userId);
  } catch (err) {
    console.warn('Initialisation diagramme T3-C18 ignoree :', err.message);
  }
  try {
    await ensureDefaultProductTables(db, storeId, userId);
  } catch (err) {
    console.warn('Initialisation tableaux qualite ignoree :', err.message);
  }
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

  const [sections, missing, attachments, exports, diagrams, tables, blocks] = await Promise.all([
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
    db.query(
      `SELECT *
       FROM quality_document_diagrams
       WHERE collection_id = $1 AND store_id = $2
       ORDER BY archived_at NULLS FIRST, created_at ASC`,
      [id, storeId]
    ).catch((err) => {
      if (err.code === '42P01' || err.code === '42703') return { rows: [] };
      throw err;
    }),
    db.query(
      `SELECT *
       FROM quality_document_tables
       WHERE collection_id = $1 AND store_id = $2
       ORDER BY archived_at NULLS FIRST, created_at ASC`,
      [id, storeId]
    ).catch((err) => {
      if (err.code === '42P01' || err.code === '42703') return { rows: [] };
      throw err;
    }),
    db.query(
      `SELECT *
       FROM quality_document_blocks
       WHERE collection_id = $1 AND store_id = $2
       ORDER BY chapter_id ASC, position ASC, created_at ASC`,
      [id, storeId]
    ).catch((err) => {
      if (err.code === '42P01' || err.code === '42703') return { rows: [] };
      throw err;
    }),
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
    diagrams: diagrams.rows,
    tables: tables.rows,
    blocks: hydrateBlocks(blocks.rows, tables.rows, diagrams.rows, attachments.rows),
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
  const before = await getSection(db, storeId, sectionId);
  if (!before) return null;
  const payload = sectionPayload({ ...before, ...body });
  if (payload.parent_id === sectionId) {
    const err = new Error('Un chapitre ne peut pas etre son propre parent');
    err.status = 400;
    throw err;
  }
  if (payload.parent_id) {
    const parent = await getSection(db, storeId, payload.parent_id);
    if (!parent || parent.collection_id !== before.collection_id || parent.archived_at) {
      const err = new Error('Parent documentaire invalide');
      err.status = 400;
      throw err;
    }
    let cursor = parent;
    while (cursor?.parent_id) {
      if (cursor.parent_id === sectionId) {
        const err = new Error('Impossible de deplacer un chapitre dans un de ses sous-chapitres');
        err.status = 400;
        throw err;
      }
      cursor = await getSection(db, storeId, cursor.parent_id);
    }
  }
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
  let updated = result.rows[0];
  if (Object.prototype.hasOwnProperty.call(body, 'content_html')) {
    updated = await syncRichTextBlockFromContentHtml(db, storeId, updated, userId, payload.content_html);
  }
  await recordSectionVersion(db, storeId, updated, userId, body.change_summary || 'Modification du chapitre', 'update', before);
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.documentation.section.updated', targetType: 'quality_documentation_section', targetId: sectionId, before, after: updated });
  return updated;
}

async function deleteSection(db, storeId, sectionId, userId) {
  return updateSection(db, storeId, sectionId, userId, { status: 'archived', change_summary: 'Archivage du chapitre' });
}

async function mergeSections(db, storeId, sourceSectionId, targetSectionId, userId, body = {}) {
  if (sourceSectionId === targetSectionId) {
    const err = new Error('Selectionne deux chapitres differents pour fusionner');
    err.status = 400;
    throw err;
  }

  const source = await getSection(db, storeId, sourceSectionId);
  const target = await getSection(db, storeId, targetSectionId);
  if (!source || !target || source.collection_id !== target.collection_id) {
    const err = new Error('Chapitres a fusionner introuvables');
    err.status = 404;
    throw err;
  }
  if (source.archived_at || target.archived_at) {
    const err = new Error('Impossible de fusionner un chapitre archive');
    err.status = 400;
    throw err;
  }

  const separatorTitle = cleanText(body.separator_title, source.title);
  const mergedHtml = [
    target.content_html || '',
    '<hr>',
    `<h3>Fusion depuis ${separatorTitle.replace(/[&<>'"]/g, '')}</h3>`,
    source.content_html || '',
  ].join('\n');
  const mergedText = stripHtml(mergedHtml);
  const mergedReferences = [target.regulatory_references, source.regulatory_references]
    .filter(Boolean)
    .join('\n');
  const mergedComment = [
    target.comment_internal,
    `Fusion du chapitre ${source.code} - ${source.title}${body.reason ? ` : ${body.reason}` : ''}`,
    source.comment_internal,
  ].filter(Boolean).join('\n');

  const updatedTarget = await db.query(
    `UPDATE quality_documentation_sections
     SET content_html = $3,
         content_text = $4,
         regulatory_references = NULLIF($5, ''),
         comment_internal = NULLIF($6, ''),
         updated_by = $7,
         updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING *`,
    [targetSectionId, storeId, mergedHtml, mergedText, mergedReferences, mergedComment, userId]
  );

  await db.query(
    'UPDATE quality_documentation_missing_items SET section_id = $3, updated_at = now() WHERE section_id = $1 AND store_id = $2',
    [sourceSectionId, storeId, targetSectionId]
  );
  await db.query(
    'UPDATE quality_documentation_attachments SET section_id = $3 WHERE section_id = $1 AND store_id = $2',
    [sourceSectionId, storeId, targetSectionId]
  );
  await db.query(
    `UPDATE quality_documentation_sections
     SET status = 'archived',
         include_in_export = false,
         archived_at = COALESCE(archived_at, now()),
         updated_by = $3,
         updated_at = now()
     WHERE id = $1 AND store_id = $2`,
    [sourceSectionId, storeId, userId]
  );

  await recordSectionVersion(db, storeId, updatedTarget.rows[0], userId, `Fusion du chapitre ${source.code} - ${source.title}`, 'merge', target);
  await logQualityEvent({
    dbPool: db,
    storeId,
    actorId: userId,
    eventType: 'quality.documentation.section.merged',
    targetType: 'quality_documentation_section',
    targetId: targetSectionId,
    before: { source, target },
    after: updatedTarget.rows[0],
  });

  return updatedTarget.rows[0];
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
  const section = await getSection(db, storeId, body.section_id);
  if (!section || section.archived_at) {
    const err = new Error('Chapitre introuvable pour ce magasin');
    err.status = 404;
    throw err;
  }
  if (body.collection_id && String(body.collection_id) !== String(section.collection_id)) {
    const err = new Error('Chapitre hors collection demandee');
    err.status = 400;
    throw err;
  }
  const severity = assertAllowed(body.severity || 'normal', MISSING_ITEM_SEVERITIES, 'Temporalite/priorite');
  const status = assertAllowed(body.status || 'open', MISSING_ITEM_STATUSES, 'Statut');
  await assertMissingItemScope(db, storeId, { section_id: body.section_id, collection_id: section.collection_id }, body);
  const result = await db.query(
    `INSERT INTO quality_documentation_missing_items
     (section_id, store_id, description, severity, responsible_user_id, due_at, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [body.section_id, storeId, cleanText(body.description, 'Information a completer'), severity, cleanText(body.responsible_user_id), cleanDate(body.due_at, 'Echeance') ?? null, status]
  );
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.documentation.missing.created', targetType: 'quality_documentation_missing_item', targetId: result.rows[0].id, after: result.rows[0] });
  return result.rows[0];
}

async function updateMissingItem(db, storeId, id, userId, body) {
  const before = await getMissingItem(db, storeId, id);
  if (!before) return null;
  await assertMissingItemScope(db, storeId, before, body);
  const severity = Object.prototype.hasOwnProperty.call(body, 'severity') ? assertAllowed(body.severity, MISSING_ITEM_SEVERITIES, 'Temporalite/priorite') : undefined;
  const status = Object.prototype.hasOwnProperty.call(body, 'status') ? assertAllowed(body.status, MISSING_ITEM_STATUSES, 'Statut') : undefined;
  const dueAt = cleanDate(body.due_at, 'Echeance');
  if (status === 'resolved' && before.status === 'resolved') {
    const err = new Error('Information manquante deja resolue');
    err.status = 409;
    throw err;
  }

  const payload = {
    description: Object.prototype.hasOwnProperty.call(body, 'description') ? cleanText(body.description, before.description) : before.description,
    severity: severity ?? before.severity,
    responsible_user_id: Object.prototype.hasOwnProperty.call(body, 'responsible_user_id') ? cleanText(body.responsible_user_id) : before.responsible_user_id,
    due_at: dueAt !== undefined ? dueAt : before.due_at,
    status: status ?? before.status,
  };
  const result = await db.query(
    `UPDATE quality_documentation_missing_items
     SET description = $3,
         severity = $4,
         responsible_user_id = $5,
         due_at = $6,
         status = $7,
         resolved_at = CASE WHEN $7 = 'resolved' THEN COALESCE(resolved_at, now()) ELSE NULL END,
         resolved_by = CASE WHEN $7 = 'resolved' THEN COALESCE(resolved_by, $8) ELSE NULL END,
         updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING *`,
    [id, storeId, payload.description, payload.severity, payload.responsible_user_id, payload.due_at, payload.status, userId]
  );
  const updated = result.rows[0] || null;
  if (updated) {
    await logQualityEvent({
      dbPool: db,
      storeId,
      actorId: userId,
      eventType: payload.status === 'resolved' ? 'quality.documentation.missing.resolved' : 'quality.documentation.missing.updated',
      targetType: 'quality_documentation_missing_item',
      targetId: updated.id,
      reason: cleanText(body.reason),
      before,
      after: updated,
      metadata: { changes: missingItemChanges(before, updated) },
    });
  }
  return updated;
}

async function resolveMissingItem(db, storeId, id, userId, body = {}) {
  return updateMissingItem(db, storeId, id, userId, { ...body, status: 'resolved' });
}

async function reopenMissingItem(db, storeId, id, userId, body = {}) {
  const before = await getMissingItem(db, storeId, id);
  if (!before) return null;
  if (before.status !== 'resolved') {
    const err = new Error('Seule une information resolue peut etre rouverte');
    err.status = 409;
    throw err;
  }
  return updateMissingItem(db, storeId, id, userId, { ...body, status: 'open' });
}

module.exports = {
  createMissingItem,
  createSection,
  deleteSection,
  getDocumentation,
  getOrCreateDefaultDocumentation,
  mergeSections,
  getMissingItem,
  listDocumentation,
  listMissingItems,
  reopenMissingItem,
  resolveMissingItem,
  sanitizeHtml,
  updateMissingItem,
  updateSection,
};
