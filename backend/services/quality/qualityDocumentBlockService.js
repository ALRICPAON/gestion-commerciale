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

async function recordBlockVersion(db, storeId, section, userId, summary, type, beforeSection = null, beforeBlocks = null) {
  const snapshot = await getBlocksSnapshot(db, storeId, section.id);
  const version = await recordSectionVersion(db, storeId, section, userId, summary, type, beforeSection || section);
  await db.query(
    `UPDATE quality_documentation_versions
     SET blocks_snapshot = $2::jsonb,
         previous_blocks_snapshot = $3::jsonb
     WHERE id = $1`,
    [version.id, JSON.stringify(snapshot), beforeBlocks ? JSON.stringify(beforeBlocks) : null]
  ).catch((err) => {
    if (err.code !== '42703') throw err;
  });
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
  const [blocks, tables, diagrams, attachments] = await Promise.all([
    db.query(
      `SELECT *
       FROM quality_document_blocks
       WHERE store_id = $1 AND chapter_id = $2
       ORDER BY position ASC, created_at ASC`,
      [storeId, chapterId]
    ),
    db.query('SELECT * FROM quality_document_tables WHERE store_id = $1 AND section_id = $2 AND archived_at IS NULL', [storeId, chapterId]).catch(() => ({ rows: [] })),
    db.query('SELECT * FROM quality_document_diagrams WHERE store_id = $1 AND section_id = $2 AND archived_at IS NULL', [storeId, chapterId]).catch(() => ({ rows: [] })),
    db.query('SELECT * FROM quality_documentation_attachments WHERE store_id = $1 AND section_id = $2 AND archived_at IS NULL', [storeId, chapterId]).catch(() => ({ rows: [] })),
  ]).catch((err) => {
    if (err.code === '42P01' || err.code === '42703') return [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];
    throw err;
  });
  const rows = blocks.rows.length
    ? blocks.rows
    : fallbackBlocks(section, tables.rows, diagrams.rows, attachments.rows);
  return hydrateBlocks(rows, tables.rows, diagrams.rows, attachments.rows);
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
  await db.query('UPDATE quality_documentation_sections SET updated_by = $3, updated_at = now() WHERE id = $1 AND store_id = $2', [chapterId, storeId, userId]);
  await recordBlockVersion(db, storeId, section, userId, 'Creation d un bloc documentaire', 'block_create', section, beforeBlocks);
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.documentation.block.created', targetType: 'quality_document_block', targetId: result.rows[0].id, after: result.rows[0] });
  return (await listChapterBlocks(db, storeId, chapterId)).find((block) => block.id === result.rows[0].id);
}

async function updateDocumentBlock(db, storeId, blockId, userId, body = {}) {
  const beforeResult = await db.query('SELECT * FROM quality_document_blocks WHERE id = $1 AND store_id = $2 LIMIT 1', [blockId, storeId]);
  const before = beforeResult.rows[0];
  if (!before) return null;
  const section = await getSection(db, storeId, before.chapter_id);
  if (!section) return null;
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
  await db.query('UPDATE quality_documentation_sections SET updated_by = $3, updated_at = now() WHERE id = $1 AND store_id = $2', [section.id, storeId, userId]);
  await recordBlockVersion(db, storeId, section, userId, 'Modification d un bloc documentaire', 'block_update', section, beforeBlocks);
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.documentation.block.updated', targetType: 'quality_document_block', targetId: blockId, before, after: result.rows[0] });
  return (await listChapterBlocks(db, storeId, section.id)).find((block) => block.id === blockId);
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
  await db.query('UPDATE quality_documentation_sections SET updated_by = $3, updated_at = now() WHERE id = $1 AND store_id = $2', [section.id, storeId, userId]);
  await recordBlockVersion(db, storeId, section, userId, 'Suppression d un bloc documentaire', 'block_delete', section, beforeBlocks);
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
  await db.query('UPDATE quality_documentation_sections SET updated_by = $3, updated_at = now() WHERE id = $1 AND store_id = $2', [chapterId, storeId, userId]);
  await recordBlockVersion(db, storeId, section, userId, 'Reorganisation des blocs documentaires', 'block_reorder', section, beforeBlocks);
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
  await recordBlockVersion(db, storeId, section, userId, 'Duplication d un bloc documentaire', 'block_duplicate', section, beforeBlocks);
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.documentation.block.duplicated', targetType: 'quality_document_block', targetId: result.rows[0].id, before: source, after: result.rows[0] });
  return (await listChapterBlocks(db, storeId, section.id)).find((block) => block.id === result.rows[0].id);
}

async function withTransaction(db, action) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
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
  updateDocumentBlock,
  withTransaction,
};
