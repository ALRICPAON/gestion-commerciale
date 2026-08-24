'use strict';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;

function clampLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function normalizeOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function normalizeFilter(input = {}) {
  const status = input.status || input.filter || 'all';
  return ['all', 'active', 'archived', 'attached', 'unattached', 'hidden'].includes(status) ? status : 'all';
}

function normalizeQuery(value) {
  const query = String(value || '').trim();
  return query || null;
}

function tablePreview(tableData = {}) {
  const columns = Array.isArray(tableData.columns) ? tableData.columns : [];
  const rows = Array.isArray(tableData.rows) ? tableData.rows : [];
  const columnLabels = columns.map((column) => column?.label || column?.name || column?.id).filter(Boolean).slice(0, 4);
  const rowValues = rows.slice(0, 2).flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    return Object.values(row).map((value) => {
      if (value && typeof value === 'object') return value.value || value.label || '';
      return value;
    });
  }).filter((value) => value !== null && value !== undefined && String(value).trim()).slice(0, 6);
  return [...columnLabels, ...rowValues].map((value) => String(value).trim()).join(' | ').slice(0, 500);
}

function diagramPreview(diagramData = {}) {
  const source = diagramData.source || diagramData.mermaid || diagramData.code || '';
  if (source) return String(source).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 4).join(' / ').slice(0, 500);
  const nodes = Array.isArray(diagramData.nodes) ? diagramData.nodes : [];
  return nodes.map((node) => node?.label || node?.text || node?.id).filter(Boolean).slice(0, 8).join(' | ').slice(0, 500);
}

function attachmentStatus(row) {
  if (row.archived_at) return 'archived';
  if (!row.section_id || !row.section_ref_id) return 'missing_section';
  if (!row.block_ref_id) return 'missing_block';
  if (row.block_chapter_id && row.block_chapter_id !== row.section_id) return 'mismatched_block_section';
  if (row.block_is_visible === false) return 'hidden';
  return 'attached';
}

function summarizeCommon(row) {
  const status = attachmentStatus(row);
  return {
    id: row.id,
    store_id: row.store_id,
    collection_id: row.collection_id,
    section_id: row.section_id,
    section: row.section_ref_id ? {
      id: row.section_ref_id,
      code: row.section_code,
      title: row.section_title,
      archived_at: row.section_archived_at || null,
    } : null,
    block_id: row.block_id || null,
    block: row.block_ref_id ? {
      id: row.block_ref_id,
      chapter_id: row.block_chapter_id,
      position: row.block_position,
      is_visible: row.block_is_visible,
      ref_count: Number(row.block_ref_count || 0),
    } : null,
    attachment_status: status,
    is_attached: status === 'attached' || status === 'hidden',
    is_archived: Boolean(row.archived_at),
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at || null,
  };
}

function summarizeTable(row, { includeData = false } = {}) {
  const tableData = row.table_data || {};
  const columns = Array.isArray(tableData.columns) ? tableData.columns : [];
  const rows = Array.isArray(tableData.rows) ? tableData.rows : [];
  return {
    ...summarizeCommon(row),
    title: row.title,
    table_type: row.table_type,
    schema_version: row.schema_version,
    dimensions: { columns: columns.length, rows: rows.length },
    preview: tablePreview(tableData),
    ...(includeData ? { table_data: tableData } : {}),
  };
}

function summarizeDiagram(row, { includeData = false } = {}) {
  const diagramData = row.diagram_data || {};
  return {
    ...summarizeCommon(row),
    title: row.title,
    diagram_type: row.diagram_type,
    orientation: row.orientation,
    schema_version: row.schema_version,
    has_mermaid_source: Boolean(diagramData.source || diagramData.mermaid || diagramData.code),
    has_rendered_svg: Boolean(diagramData.rendered_svg || diagramData.svg),
    preview: diagramPreview(diagramData),
    ...(includeData ? { diagram_data: diagramData } : {}),
  };
}

function appendInventoryFilters({ sqlParts, params, input, kind }) {
  const status = normalizeFilter(input);
  if (input.section_id) {
    params.push(input.section_id);
    sqlParts.push(`item.section_id = $${params.length}`);
  }
  if (input.collection_id) {
    params.push(input.collection_id);
    sqlParts.push(`item.collection_id = $${params.length}`);
  }
  const query = normalizeQuery(input.query);
  if (query) {
    params.push(`%${query}%`);
    const dataColumn = kind === 'table' ? 'item.table_data' : 'item.diagram_data';
    sqlParts.push(`(item.title ILIKE $${params.length} OR ${dataColumn}::text ILIKE $${params.length})`);
  }
  if (status === 'active') sqlParts.push('item.archived_at IS NULL');
  if (status === 'archived') sqlParts.push('item.archived_at IS NOT NULL');
  if (status === 'attached') sqlParts.push('section_ref.id IS NOT NULL AND block_ref.id IS NOT NULL AND (block_ref.chapter_id IS NULL OR block_ref.chapter_id = item.section_id)');
  if (status === 'unattached') sqlParts.push('(section_ref.id IS NULL OR block_ref.id IS NULL OR (block_ref.chapter_id IS NOT NULL AND block_ref.chapter_id <> item.section_id))');
  if (status === 'hidden') sqlParts.push('block_ref.id IS NOT NULL AND block_ref.is_visible = FALSE');
}

function inventorySql({ tableName, blockType, contentKey, dataColumn, typeColumn }) {
  return `
    SELECT
      item.*,
      item.${dataColumn} AS structured_data,
      item.${typeColumn} AS structured_type,
      section_ref.id AS section_ref_id,
      section_ref.code AS section_code,
      section_ref.title AS section_title,
      section_ref.archived_at AS section_archived_at,
      block_ref.id AS block_ref_id,
      block_ref.chapter_id AS block_chapter_id,
      block_ref.position AS block_position,
      block_ref.is_visible AS block_is_visible,
      COALESCE(block_count.ref_count, 0)::int AS block_ref_count,
      COUNT(*) OVER()::int AS total_count
    FROM ${tableName} item
    LEFT JOIN quality_documentation_sections section_ref
      ON section_ref.store_id = item.store_id
      AND section_ref.id = item.section_id
    LEFT JOIN LATERAL (
      SELECT block.id, block.chapter_id, block.position, block.is_visible
      FROM quality_document_blocks block
      WHERE block.store_id = item.store_id
        AND block.block_type = '${blockType}'
        AND block.content->>'${contentKey}' = item.id::text
      ORDER BY
        CASE WHEN block.chapter_id = item.section_id THEN 0 ELSE 1 END,
        CASE WHEN block.is_visible THEN 0 ELSE 1 END,
        block.position ASC,
        block.created_at ASC
      LIMIT 1
    ) block_ref ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS ref_count
      FROM quality_document_blocks block
      WHERE block.store_id = item.store_id
        AND block.block_type = '${blockType}'
        AND block.content->>'${contentKey}' = item.id::text
    ) block_count ON TRUE
  `;
}

async function listInventory(db, storeId, input = {}, config) {
  const params = [storeId];
  const filters = ['item.store_id = $1'];
  appendInventoryFilters({ sqlParts: filters, params, input, kind: config.kind });
  const limit = clampLimit(input.limit);
  const offset = normalizeOffset(input.offset);
  params.push(limit, offset);
  const sql = `
    ${inventorySql(config)}
    WHERE ${filters.join(' AND ')}
    ORDER BY item.archived_at NULLS FIRST, COALESCE(item.updated_at, item.created_at) DESC, item.id ASC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;
  const result = await db.query(sql, params);
  const total = result.rows[0]?.total_count ? Number(result.rows[0].total_count) : 0;
  return {
    items: result.rows.map((row) => config.summarize(row)),
    pagination: {
      limit,
      offset,
      total,
      has_more: offset + result.rows.length < total,
    },
    filters: {
      status: normalizeFilter(input),
      section_id: input.section_id || null,
      collection_id: input.collection_id || null,
      query: normalizeQuery(input.query),
    },
  };
}

async function getInventoryItem(db, storeId, id, config) {
  if (!id) {
    const error = new Error('Identifiant obligatoire');
    error.status = 400;
    error.expose = true;
    throw error;
  }
  const result = await db.query(`
    ${inventorySql(config)}
    WHERE item.store_id = $1 AND item.id = $2
    LIMIT 1
  `, [storeId, id]);
  return result.rows[0] ? config.summarize(result.rows[0], { includeData: true }) : null;
}

const tableConfig = {
  kind: 'table',
  tableName: 'quality_document_tables',
  blockType: 'document_table',
  contentKey: 'table_id',
  dataColumn: 'table_data',
  typeColumn: 'table_type',
  summarize: summarizeTable,
};

const diagramConfig = {
  kind: 'diagram',
  tableName: 'quality_document_diagrams',
  blockType: 'mermaid_diagram',
  contentKey: 'diagram_id',
  dataColumn: 'diagram_data',
  typeColumn: 'diagram_type',
  summarize: summarizeDiagram,
};

async function listAllTables(db, storeId, input = {}) {
  return listInventory(db, storeId, input, tableConfig);
}

async function getTable(db, storeId, id) {
  return getInventoryItem(db, storeId, id, tableConfig);
}

async function listAllDiagrams(db, storeId, input = {}) {
  return listInventory(db, storeId, input, diagramConfig);
}

async function getDiagram(db, storeId, id) {
  return getInventoryItem(db, storeId, id, diagramConfig);
}

async function diagnoseStructuredObjects(db, storeId) {
  const result = await db.query(`
    WITH tables AS (
      SELECT
        t.id,
        t.section_id,
        t.archived_at,
        section_ref.id AS section_ref_id,
        block_ref.id AS block_ref_id,
        block_ref.chapter_id AS block_chapter_id,
        block_ref.is_visible AS block_is_visible
      FROM quality_document_tables t
      LEFT JOIN quality_documentation_sections section_ref
        ON section_ref.store_id = t.store_id
        AND section_ref.id = t.section_id
      LEFT JOIN LATERAL (
        SELECT block.id, block.chapter_id, block.is_visible
        FROM quality_document_blocks block
        WHERE block.store_id = t.store_id
          AND block.block_type = 'document_table'
          AND block.content->>'table_id' = t.id::text
        ORDER BY CASE WHEN block.chapter_id = t.section_id THEN 0 ELSE 1 END, block.position ASC
        LIMIT 1
      ) block_ref ON TRUE
      WHERE t.store_id = $1
    ),
    diagrams AS (
      SELECT
        d.id,
        d.section_id,
        d.archived_at,
        section_ref.id AS section_ref_id,
        block_ref.id AS block_ref_id,
        block_ref.chapter_id AS block_chapter_id,
        block_ref.is_visible AS block_is_visible
      FROM quality_document_diagrams d
      LEFT JOIN quality_documentation_sections section_ref
        ON section_ref.store_id = d.store_id
        AND section_ref.id = d.section_id
      LEFT JOIN LATERAL (
        SELECT block.id, block.chapter_id, block.is_visible
        FROM quality_document_blocks block
        WHERE block.store_id = d.store_id
          AND block.block_type = 'mermaid_diagram'
          AND block.content->>'diagram_id' = d.id::text
        ORDER BY CASE WHEN block.chapter_id = d.section_id THEN 0 ELSE 1 END, block.position ASC
        LIMIT 1
      ) block_ref ON TRUE
      WHERE d.store_id = $1
    )
    SELECT 'tables' AS object_type, * FROM (
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE archived_at IS NULL)::int AS active,
        COUNT(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived,
        COUNT(*) FILTER (WHERE archived_at IS NULL AND section_ref_id IS NOT NULL)::int AS active_with_section,
        COUNT(*) FILTER (WHERE archived_at IS NULL AND section_ref_id IS NOT NULL AND block_ref_id IS NOT NULL AND (block_chapter_id IS NULL OR block_chapter_id = section_id))::int AS active_referenced_by_block,
        COUNT(*) FILTER (WHERE section_ref_id IS NOT NULL AND block_ref_id IS NOT NULL AND (block_chapter_id IS NULL OR block_chapter_id = section_id))::int AS referenced_by_block,
        COUNT(*) FILTER (WHERE section_ref_id IS NULL)::int AS missing_section,
        COUNT(*) FILTER (WHERE block_ref_id IS NULL)::int AS missing_block,
        COUNT(*) FILTER (WHERE block_ref_id IS NOT NULL AND block_chapter_id IS NOT NULL AND block_chapter_id <> section_id)::int AS mismatched_block_section,
        COUNT(*) FILTER (WHERE block_ref_id IS NOT NULL AND block_is_visible = FALSE)::int AS hidden_block
      FROM tables
    ) table_counts
    UNION ALL
    SELECT 'diagrams' AS object_type, * FROM (
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE archived_at IS NULL)::int AS active,
        COUNT(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived,
        COUNT(*) FILTER (WHERE archived_at IS NULL AND section_ref_id IS NOT NULL)::int AS active_with_section,
        COUNT(*) FILTER (WHERE archived_at IS NULL AND section_ref_id IS NOT NULL AND block_ref_id IS NOT NULL AND (block_chapter_id IS NULL OR block_chapter_id = section_id))::int AS active_referenced_by_block,
        COUNT(*) FILTER (WHERE section_ref_id IS NOT NULL AND block_ref_id IS NOT NULL AND (block_chapter_id IS NULL OR block_chapter_id = section_id))::int AS referenced_by_block,
        COUNT(*) FILTER (WHERE section_ref_id IS NULL)::int AS missing_section,
        COUNT(*) FILTER (WHERE block_ref_id IS NULL)::int AS missing_block,
        COUNT(*) FILTER (WHERE block_ref_id IS NOT NULL AND block_chapter_id IS NOT NULL AND block_chapter_id <> section_id)::int AS mismatched_block_section,
        COUNT(*) FILTER (WHERE block_ref_id IS NOT NULL AND block_is_visible = FALSE)::int AS hidden_block
      FROM diagrams
    ) diagram_counts
  `, [storeId]);
  const counts = {};
  for (const row of result.rows) {
    counts[row.object_type] = {
      total: Number(row.total || 0),
      active: Number(row.active || 0),
      archived: Number(row.archived || 0),
      active_with_section: Number(row.active_with_section || 0),
      active_referenced_by_block: Number(row.active_referenced_by_block || 0),
      referenced_by_block: Number(row.referenced_by_block || 0),
      missing_section: Number(row.missing_section || 0),
      missing_block: Number(row.missing_block || 0),
      mismatched_block_section: Number(row.mismatched_block_section || 0),
      hidden_block: Number(row.hidden_block || 0),
    };
  }
  return {
    counts,
    existing_section_scoped_filters: {
      tables: 'quality_document_tables WHERE store_id = $1 AND section_id = $2 AND archived_at IS NULL',
      diagrams: 'quality_document_diagrams WHERE store_id = $1 AND section_id = $2 AND archived_at IS NULL',
    },
    storage: {
      tables: 'quality_document_tables',
      diagrams: 'quality_document_diagrams',
      blocks: 'quality_document_blocks.content->>table_id / content->>diagram_id',
    },
  };
}

module.exports = {
  listAllTables,
  getTable,
  listAllDiagrams,
  getDiagram,
  diagnoseStructuredObjects,
  _private: {
    summarizeTable,
    summarizeDiagram,
    attachmentStatus,
    clampLimit,
    normalizeOffset,
  },
};
