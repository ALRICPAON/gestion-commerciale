const { logQualityEvent } = require('./eventLogger');
const { recordSectionVersion } = require('./qualityDocumentationVersionService');
const { stripHtml } = require('./qualityDocumentationTemplateService');
const { createTable, normalizeTableData, renderTableBlock } = require('./qualityDocumentationTableService');
const { createDiagram, renderDiagramBlock } = require('./qualityDocumentationDiagramService');

const BLOCK_TYPES = new Set([
  'rich_text',
  'document_table',
  'mermaid_diagram',
  'image',
  'attachment',
  'to_complete',
  'separator',
]);

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  throw err;
}

function cleanText(value, fallback = null, maxLength = 200) {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : fallback;
}

function sanitizeHtml(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '');
}

function logBlockTransaction(event, details = {}) {
  console.log('quality_document_block_transaction', {
    event,
    ...details,
  });
}

async function runOptionalTransactionStep(db, label, work, ignoredCodes = new Set()) {
  const savepoint = `sp_quality_block_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}`.replace(/[^a-zA-Z0-9_]/g, '_');
  try {
    await db.query(`SAVEPOINT ${savepoint}`);
  } catch (err) {
    try {
      return await work();
    } catch (workErr) {
      if (!ignoredCodes.has(workErr.code)) throw workErr;
      logBlockTransaction('optional_step_ignored', {
        step: label,
        pg_code: workErr.code,
        pg_message: workErr.message,
      });
      return null;
    }
  }

  try {
    const result = await work();
    await db.query(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (err) {
    await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => {});
    await db.query(`RELEASE SAVEPOINT ${savepoint}`).catch(() => {});
    if (!ignoredCodes.has(err.code)) throw err;
    logBlockTransaction('optional_step_ignored', {
      step: label,
      pg_code: err.code,
      pg_message: err.message,
    });
    return null;
  }
}

async function optionalRows(db, label, sql, params = []) {
  const result = await runOptionalTransactionStep(
    db,
    label,
    () => db.query(sql, params),
    new Set(['42P01', '42703'])
  );
  return result?.rows || [];
}

function normalizeContent(blockType, content = {}) {
  if (blockType === 'rich_text') {
    return { html: sanitizeHtml(content.html || content.content_html || '') };
  }
  if (blockType === 'to_complete') {
    return {
      text: cleanText(content.text || content.description, 'A completer', 1000),
      missing_item_id: cleanText(content.missing_item_id),
    };
  }
  if (blockType === 'document_table') {
    return {
      table_id: cleanText(content.table_id),
      table_template_key: cleanText(content.table_template_key),
      table_data: content.table_data || null,
    };
  }
  if (blockType === 'mermaid_diagram') {
    return {
      diagram_id: cleanText(content.diagram_id),
      diagram_template_key: cleanText(content.diagram_template_key),
      diagram_data: content.diagram_data || null,
      editor_mode: content.editor_mode || content.diagram_data?.editor_mode || 'mermaid',
    };
  }
  if (blockType === 'image' || blockType === 'attachment') {
    return {
      attachment_id: cleanText(content.attachment_id),
      caption: cleanText(content.caption, '', 500),
    };
  }
  return {};
}

async function getSection(db, storeId, chapterId) {
  const result = await db.query(
    'SELECT * FROM quality_documentation_sections WHERE id = $1 AND store_id = $2 AND archived_at IS NULL LIMIT 1',
    [chapterId, storeId]
  );
  return result.rows[0] || null;
}

async function getNextPosition(db, storeId, chapterId) {
  const result = await db.query(
    'SELECT COALESCE(MAX(position), 0) + 10 AS next_position FROM quality_document_blocks WHERE store_id = $1 AND chapter_id = $2',
    [storeId, chapterId]
  );
  return Number(result.rows[0]?.next_position || 10);
}

async function getBlocksSnapshot(db, storeId, chapterId) {
  const result = await db.query(
    `SELECT id, block_type, position, title, content, is_visible
     FROM quality_document_blocks
     WHERE store_id = $1 AND chapter_id = $2
     ORDER BY position ASC, created_at ASC`,
    [storeId, chapterId]
  ).catch((err) => {
    if (err.code === '42P01' || err.code === '42703') return { rows: [] };
    throw err;
  });
  return result.rows;
}

async function getHydratedChapterBlocks(db, storeId, chapterId) {
  const blocks = await db.query(
    `SELECT *
     FROM quality_document_blocks
     WHERE store_id = $1 AND chapter_id = $2
     ORDER BY position ASC, created_at ASC`,
    [storeId, chapterId]
  );
  const tables = await optionalRows(db, 'hydrate_tables', 'SELECT * FROM quality_document_tables WHERE store_id = $1 AND section_id = $2 AND archived_at IS NULL', [storeId, chapterId]);
  const diagrams = await optionalRows(db, 'hydrate_diagrams', 'SELECT * FROM quality_document_diagrams WHERE store_id = $1 AND section_id = $2 AND archived_at IS NULL', [storeId, chapterId]);
  const attachments = await optionalRows(db, 'hydrate_attachments', 'SELECT * FROM quality_documentation_attachments WHERE store_id = $1 AND section_id = $2 AND archived_at IS NULL', [storeId, chapterId]);
  return hydrateBlocks(blocks.rows, tables, diagrams, attachments);
}

async function syncSectionContentHtmlFromBlocks(db, storeId, chapterId, userId) {
  const blocks = await getHydratedChapterBlocks(db, storeId, chapterId);
  if (!blocks.length) return null;
  const html = blocks
    .filter((block) => block.is_visible !== false)
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
    .map((block) => renderDocumentBlock(block))
    .filter(Boolean)
    .join('\n');
  const result = await db.query(
    `UPDATE quality_documentation_sections
     SET content_html = $3,
         content_text = $4,
         updated_by = $5,
         updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING *`,
    [chapterId, storeId, html, stripHtml(html), userId]
  );
  return result.rows[0] || null;
}

async function syncRichTextBlockFromContentHtml(db, storeId, section, userId, contentHtml) {
  const blocksResult = await db.query(
    `SELECT *
     FROM quality_document_blocks
     WHERE store_id = $1 AND chapter_id = $2
     ORDER BY position ASC, created_at ASC`,
    [storeId, section.id]
  ).catch((err) => {
    if (err.code === '42P01' || err.code === '42703') return { rows: [] };
    throw err;
  });

  if (!blocksResult.rows.length) return section;

  const richText = blocksResult.rows.find((block) => block.block_type === 'rich_text');
  const content = { html: sanitizeHtml(contentHtml || ''), source: richText?.content?.source || 'content_html_sync' };
  if (richText) {
    await db.query(
      `UPDATE quality_document_blocks
       SET content = $3::jsonb,
           updated_by = $4,
           updated_at = now()
       WHERE id = $1 AND store_id = $2`,
      [richText.id, storeId, JSON.stringify({ ...(richText.content || {}), ...content }), userId]
    );
  } else {
    const position = Number(blocksResult.rows[0]?.position || 0) - 5 || 10;
    await db.query(
      `INSERT INTO quality_document_blocks
       (store_id, collection_id, chapter_id, block_type, position, title, content, is_visible, created_by, updated_by)
       VALUES ($1,$2,$3,'rich_text',$4,'Texte du chapitre',$5::jsonb,true,$6,$6)`,
      [storeId, section.collection_id, section.id, position, JSON.stringify(content), userId]
    );
  }
  return (await syncSectionContentHtmlFromBlocks(db, storeId, section.id, userId)) || section;
}

async function recordBlockVersion(db, storeId, section, userId, summary, type, beforeSection = null, beforeBlocks = null) {
  const snapshot = await getBlocksSnapshot(db, storeId, section.id);
  const version = await recordSectionVersion(db, storeId, section, userId, summary, type, beforeSection || section);
  await runOptionalTransactionStep(
    db,
    'version_blocks_snapshot',
    () => db.query(
      `UPDATE quality_documentation_versions
       SET blocks_snapshot = $2::jsonb,
           previous_blocks_snapshot = $3::jsonb
       WHERE id = $1`,
      [version.id, JSON.stringify(snapshot), beforeBlocks ? JSON.stringify(beforeBlocks) : null]
    ),
    new Set(['42703'])
  );
  return version;
}

function fallbackBlocks(section, tables = [], diagrams = [], attachments = []) {
  const blocks = [];
  if (String(section.content_html || '').trim()) {
    blocks.push({
      id: `legacy-rich-text-${section.id}`,
      chapter_id: section.id,
      block_type: 'rich_text',
      position: 10,
      title: 'Texte du chapitre',
      content: { html: section.content_html, legacy: true },
      is_visible: true,
      is_legacy: true,
    });
  }
  tables.filter((item) => item.section_id === section.id && !item.archived_at).forEach((table, index) => {
    blocks.push({
      id: `legacy-table-${table.id}`,
      chapter_id: section.id,
      block_type: 'document_table',
      position: 100 + index * 10,
      title: table.title,
      content: { table_id: table.id, legacy: true },
      is_visible: true,
      table,
      is_legacy: true,
    });
  });
  diagrams.filter((item) => item.section_id === section.id && !item.archived_at).forEach((diagram, index) => {
    blocks.push({
      id: `legacy-diagram-${diagram.id}`,
      chapter_id: section.id,
      block_type: 'mermaid_diagram',
      position: 500 + index * 10,
      title: diagram.title,
      content: { diagram_id: diagram.id, legacy: true },
      is_visible: true,
      diagram,
      is_legacy: true,
    });
  });
  attachments.filter((item) => item.section_id === section.id && !item.archived_at).forEach((attachment, index) => {
    blocks.push({
      id: `legacy-attachment-${attachment.id}`,
      chapter_id: section.id,
      block_type: String(attachment.mime_type || '').startsWith('image/') ? 'image' : 'attachment',
      position: 900 + index * 10,
      title: attachment.filename,
      content: { attachment_id: attachment.id, legacy: true },
      is_visible: attachment.include_in_export !== false,
      attachment,
      is_legacy: true,
    });
  });
  return blocks.sort((a, b) => a.position - b.position);
}

function hydrateBlocks(blocks, tables = [], diagrams = [], attachments = []) {
  const tableById = new Map(tables.map((item) => [String(item.id), item]));
  const diagramById = new Map(diagrams.map((item) => [String(item.id), item]));
  const attachmentById = new Map(attachments.map((item) => [String(item.id), item]));
  return blocks.map((block) => {
    const content = block.content || {};
    return {
      ...block,
      table: content.table_id ? tableById.get(String(content.table_id)) || null : null,
      diagram: content.diagram_id ? diagramById.get(String(content.diagram_id)) || null : null,
      attachment: content.attachment_id ? attachmentById.get(String(content.attachment_id)) || null : null,
    };
  });
}

async function listChapterBlocks(db, storeId, chapterId) {
  const section = await getSection(db, storeId, chapterId);
  if (!section) return null;
  const blocks = await db.query(
    `SELECT *
     FROM quality_document_blocks
     WHERE store_id = $1 AND chapter_id = $2
     ORDER BY position ASC, created_at ASC`,
    [storeId, chapterId]
  );
  const tables = await optionalRows(db, 'list_tables', 'SELECT * FROM quality_document_tables WHERE store_id = $1 AND section_id = $2 AND archived_at IS NULL', [storeId, chapterId]);
  const diagrams = await optionalRows(db, 'list_diagrams', 'SELECT * FROM quality_document_diagrams WHERE store_id = $1 AND section_id = $2 AND archived_at IS NULL', [storeId, chapterId]);
  const attachments = await optionalRows(db, 'list_attachments', 'SELECT * FROM quality_documentation_attachments WHERE store_id = $1 AND section_id = $2 AND archived_at IS NULL', [storeId, chapterId]);
  const rows = blocks.rows.length
    ? blocks.rows
    : fallbackBlocks(section, tables, diagrams, attachments);
  return hydrateBlocks(rows, tables, diagrams, attachments);
}

async function createReferencedObject(db, storeId, section, userId, blockType, content) {
  if (blockType === 'document_table' && !content.table_id) {
    const table = await createTable(db, storeId, section.id, userId, {
      template_key: content.table_template_key || undefined,
      table_data: content.table_data || undefined,
    });
    content.table_id = table.id;
    content.table_data = null;
  }
  if (blockType === 'mermaid_diagram' && !content.diagram_id) {
    const diagram = await createDiagram(db, storeId, section.id, userId, {
      template_key: content.diagram_template_key || undefined,
      diagram_data: content.diagram_data || undefined,
      editor_mode: content.editor_mode || 'mermaid',
    });
    content.diagram_id = diagram.id;
    content.diagram_data = null;
  }
  return content;
}

async function createChapterBlock(db, storeId, chapterId, userId, body = {}) {
  const section = await getSection(db, storeId, chapterId);
  if (!section) return null;
  const blockType = cleanText(body.block_type, 'rich_text');
  if (!BLOCK_TYPES.has(blockType)) badRequest('Type de bloc invalide');
  const beforeBlocks = await getBlocksSnapshot(db, storeId, chapterId);
  const content = await createReferencedObject(db, storeId, section, userId, blockType, normalizeContent(blockType, body.content || body));
  const position = Number.isFinite(Number(body.position)) ? Number(body.position) : await getNextPosition(db, storeId, chapterId);
  const result = await db.query(
    `INSERT INTO quality_document_blocks
     (store_id, collection_id, chapter_id, block_type, position, title, content, is_visible, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$9)
     RETURNING *`,
    [storeId, section.collection_id, chapterId, blockType, position, cleanText(body.title, null), JSON.stringify(content), body.is_visible !== false, userId]
  );
  const syncedSection = await syncSectionContentHtmlFromBlocks(db, storeId, chapterId, userId) || section;
  await recordBlockVersion(db, storeId, syncedSection, userId, 'Creation d un bloc documentaire', 'block_create', section, beforeBlocks);
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.documentation.block.created', targetType: 'quality_document_block', targetId: result.rows[0].id, after: result.rows[0] });
  return (await listChapterBlocks(db, storeId, chapterId)).find((block) => block.id === result.rows[0].id);
}

async function updateDocumentBlock(db, storeId, blockId, userId, body = {}) {
  logBlockTransaction('update_text_block_start', {
    block_id: blockId,
    store_id: storeId,
    operation: 'updateDocumentBlock',
    has_title: Object.prototype.hasOwnProperty.call(body, 'title'),
    has_content: Boolean(body.content),
  });
  const beforeResult = await db.query('SELECT * FROM quality_document_blocks WHERE id = $1 AND store_id = $2 LIMIT 1', [blockId, storeId]);
  const before = beforeResult.rows[0];
  if (!before) {
    logBlockTransaction('update_text_block_not_found', { block_id: blockId, store_id: storeId });
    return null;
  }
  const section = await getSection(db, storeId, before.chapter_id);
  if (!section) {
    logBlockTransaction('update_text_block_section_not_found', { block_id: blockId, store_id: storeId, chapter_id: before.chapter_id });
    return null;
  }
  const beforeBlocks = await getBlocksSnapshot(db, storeId, section.id);
  const blockType = before.block_type;
  const content = body.content ? normalizeContent(blockType, body.content) : before.content;
  const result = await db.query(
    `UPDATE quality_document_blocks
     SET title = COALESCE($3, title),
         content = $4::jsonb,
         is_visible = COALESCE($5, is_visible),
         updated_by = $6,
         updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING *`,
    [blockId, storeId, cleanText(body.title), JSON.stringify(content), body.is_visible, userId]
  );
  const syncedSection = await syncSectionContentHtmlFromBlocks(db, storeId, section.id, userId) || section;
  await recordBlockVersion(db, storeId, syncedSection, userId, 'Modification d un bloc documentaire', 'block_update', section, beforeBlocks);
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.documentation.block.updated', targetType: 'quality_document_block', targetId: blockId, before, after: result.rows[0] });
  const updated = (await listChapterBlocks(db, storeId, section.id)).find((block) => block.id === blockId);
  logBlockTransaction('update_text_block_success', { block_id: blockId, store_id: storeId, chapter_id: section.id });
  return updated;
}

async function deleteDocumentBlock(db, storeId, blockId, userId) {
  const beforeResult = await db.query('SELECT * FROM quality_document_blocks WHERE id = $1 AND store_id = $2 LIMIT 1', [blockId, storeId]);
  const before = beforeResult.rows[0];
  if (!before) return null;
  const section = await getSection(db, storeId, before.chapter_id);
  if (!section) return null;
  const beforeBlocks = await getBlocksSnapshot(db, storeId, section.id);
  await db.query('DELETE FROM quality_document_blocks WHERE id = $1 AND store_id = $2', [blockId, storeId]);
  await compactPositions(db, storeId, section.id);
  const syncedSection = await syncSectionContentHtmlFromBlocks(db, storeId, section.id, userId) || section;
  await recordBlockVersion(db, storeId, syncedSection, userId, 'Suppression d un bloc documentaire', 'block_delete', section, beforeBlocks);
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.documentation.block.deleted', targetType: 'quality_document_block', targetId: blockId, before });
  return before;
}

async function compactPositions(db, storeId, chapterId) {
  const current = await db.query(
    'SELECT id FROM quality_document_blocks WHERE store_id = $1 AND chapter_id = $2 ORDER BY position ASC, created_at ASC',
    [storeId, chapterId]
  );
  for (const [index, row] of current.rows.entries()) {
    await db.query('UPDATE quality_document_blocks SET position = $3 WHERE id = $1 AND store_id = $2', [row.id, storeId, (index + 1) * 10]);
  }
}

async function reorderChapterBlocks(db, storeId, chapterId, userId, blockIds = []) {
  const section = await getSection(db, storeId, chapterId);
  if (!section) return null;
  if (!Array.isArray(blockIds) || !blockIds.length) badRequest('Ordre des blocs invalide');
  const beforeBlocks = await getBlocksSnapshot(db, storeId, chapterId);
  const existing = await db.query('SELECT id FROM quality_document_blocks WHERE store_id = $1 AND chapter_id = $2', [storeId, chapterId]);
  const existingIds = existing.rows.map((row) => String(row.id));
  const requested = blockIds.map(String);
  if (requested.length !== existingIds.length || existingIds.some((id) => !requested.includes(id))) {
    badRequest('La liste doit contenir tous les blocs du chapitre');
  }
  for (const [index, id] of requested.entries()) {
    await db.query('UPDATE quality_document_blocks SET position = $3 WHERE id = $1 AND store_id = $2', [id, storeId, -100000 - index]);
  }
  for (const [index, id] of requested.entries()) {
    await db.query(
      'UPDATE quality_document_blocks SET position = $3, updated_by = $4, updated_at = now() WHERE id = $1 AND store_id = $2',
      [id, storeId, (index + 1) * 10, userId]
    );
  }
  const syncedSection = await syncSectionContentHtmlFromBlocks(db, storeId, chapterId, userId) || section;
  await recordBlockVersion(db, storeId, syncedSection, userId, 'Reorganisation des blocs documentaires', 'block_reorder', section, beforeBlocks);
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.documentation.block.reordered', targetType: 'quality_documentation_section', targetId: chapterId, before: beforeBlocks, after: await getBlocksSnapshot(db, storeId, chapterId) });
  return listChapterBlocks(db, storeId, chapterId);
}

async function duplicateSource(db, storeId, section, userId, block) {
  const content = { ...(block.content || {}) };
  if (block.block_type === 'document_table' && content.table_id) {
    const sourceResult = await db.query('SELECT * FROM quality_document_tables WHERE id = $1 AND store_id = $2 AND archived_at IS NULL LIMIT 1', [content.table_id, storeId]);
    const source = sourceResult.rows[0];
    if (source) {
      const data = normalizeTableData({ ...source.table_data, title: `${source.title} - copie` });
      const table = await createTable(db, storeId, section.id, userId, { table_data: data, table_type: source.table_type });
      content.table_id = table.id;
    }
  }
  if (block.block_type === 'mermaid_diagram' && content.diagram_id) {
    const sourceResult = await db.query('SELECT * FROM quality_document_diagrams WHERE id = $1 AND store_id = $2 AND archived_at IS NULL LIMIT 1', [content.diagram_id, storeId]);
    const source = sourceResult.rows[0];
    if (source) {
      const data = { ...source.diagram_data, title: `${source.title} - copie` };
      const diagram = await createDiagram(db, storeId, section.id, userId, { diagram_data: data, diagram_type: source.diagram_type, editor_mode: data.editor_mode || source.diagram_type });
      content.diagram_id = diagram.id;
    }
  }
  return content;
}

async function duplicateDocumentBlock(db, storeId, blockId, userId) {
  const sourceResult = await db.query('SELECT * FROM quality_document_blocks WHERE id = $1 AND store_id = $2 LIMIT 1', [blockId, storeId]);
  const source = sourceResult.rows[0];
  if (!source) return null;
  const section = await getSection(db, storeId, source.chapter_id);
  if (!section) return null;
  const beforeBlocks = await getBlocksSnapshot(db, storeId, section.id);
  const content = await duplicateSource(db, storeId, section, userId, source);
  const afterSource = await db.query(
    'SELECT id, position FROM quality_document_blocks WHERE store_id = $1 AND chapter_id = $2 AND position > $3 ORDER BY position DESC',
    [storeId, section.id, source.position]
  );
  for (const row of afterSource.rows) {
    await db.query('UPDATE quality_document_blocks SET position = $3 WHERE id = $1 AND store_id = $2', [row.id, storeId, -100000 - row.position]);
  }
  for (const row of afterSource.rows) {
    await db.query('UPDATE quality_document_blocks SET position = $3 WHERE id = $1 AND store_id = $2', [row.id, storeId, row.position + 10]);
  }
  const result = await db.query(
    `INSERT INTO quality_document_blocks
     (store_id, collection_id, chapter_id, block_type, position, title, content, is_visible, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$9)
     RETURNING *`,
    [storeId, section.collection_id, section.id, source.block_type, source.position + 10, source.title ? `${source.title} - copie` : null, JSON.stringify(content), source.is_visible, userId]
  );
  await compactPositions(db, storeId, section.id);
  const syncedSection = await syncSectionContentHtmlFromBlocks(db, storeId, section.id, userId) || section;
  await recordBlockVersion(db, storeId, syncedSection, userId, 'Duplication d un bloc documentaire', 'block_duplicate', section, beforeBlocks);
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.documentation.block.duplicated', targetType: 'quality_document_block', targetId: result.rows[0].id, before: source, after: result.rows[0] });
  return (await listChapterBlocks(db, storeId, section.id)).find((block) => block.id === result.rows[0].id);
}

async function withTransaction(db, action) {
  const client = await db.connect();
  try {
    logBlockTransaction('begin', { operation: 'quality_document_block' });
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    logBlockTransaction('commit', { operation: 'quality_document_block' });
    return result;
  } catch (err) {
    logBlockTransaction('rollback', {
      operation: 'quality_document_block',
      pg_code: err.code,
      pg_message: err.message,
    });
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function renderDocumentBlock(block, options = {}) {
  if (block.is_visible === false) return '';
  if (block.block_type === 'rich_text') return block.content?.html || '';
  if (block.block_type === 'to_complete') {
    if (options.include_missing === false) return '';
    return `<aside class="quality-to-complete-block"><strong>A completer :</strong> ${escapeHtml(block.content?.text || block.title || 'Information a completer')}</aside>`;
  }
  if (block.block_type === 'separator') return '<hr class="quality-document-separator">';
  if (block.block_type === 'document_table') return block.table ? renderTableBlock(block.table) : '';
  if (block.block_type === 'mermaid_diagram') return block.diagram ? renderDiagramBlock(block.diagram) : '';
  if (block.block_type === 'image' && block.attachment) {
    const caption = block.content?.caption || block.title || block.attachment.filename || '';
    return `<figure class="quality-image-block"><img src="${escapeHtml(block.attachment.file_path)}" alt="${escapeHtml(caption)}"><figcaption>${escapeHtml(caption)}</figcaption></figure>`;
  }
  if (block.block_type === 'attachment' && block.attachment) {
    return `<div class="quality-attachment-block"><strong>${escapeHtml(block.attachment.filename || block.title || 'Piece jointe')}</strong><span>${escapeHtml(block.attachment.mime_type || '')}</span></div>`;
  }
  return '';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]));
}

function blocksToText(blocks) {
  return stripHtml(blocks.map((block) => renderDocumentBlock(block)).join('\n'));
}

module.exports = {
  BLOCK_TYPES,
  blocksToText,
  createChapterBlock,
  deleteDocumentBlock,
  duplicateDocumentBlock,
  hydrateBlocks,
  listChapterBlocks,
  renderDocumentBlock,
  reorderChapterBlocks,
  syncRichTextBlockFromContentHtml,
  syncSectionContentHtmlFromBlocks,
  updateDocumentBlock,
  withTransaction,
};
