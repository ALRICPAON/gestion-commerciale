const inventory = require('../services/quality/qualityStructuredObjectInventoryService');
const registry = require('../services/agent/agentToolRegistry');
const mcpServer = require('../routes/mcpServer');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeRow(overrides = {}) {
  return {
    id: overrides.id || 'item-1',
    store_id: overrides.store_id || 'store-a',
    collection_id: overrides.collection_id || 'collection-1',
    section_id: overrides.section_id === undefined ? 'section-1' : overrides.section_id,
    block_id: overrides.block_id === undefined ? 'block-legacy-1' : overrides.block_id,
    title: overrides.title || 'Objet structure',
    table_type: overrides.table_type || 'generic',
    diagram_type: overrides.diagram_type || 'flowchart',
    orientation: overrides.orientation || 'TB',
    schema_version: overrides.schema_version || 1,
    table_data: overrides.table_data || { columns: [{ id: 'c1', label: 'Controle' }], rows: [{ c1: 'OK' }] },
    diagram_data: overrides.diagram_data || { source: 'graph TD\nA-->B', rendered_svg: '<svg />' },
    section_ref_id: overrides.section_ref_id === undefined ? 'section-1' : overrides.section_ref_id,
    section_code: overrides.section_code || 'Q-01',
    section_title: overrides.section_title || 'Chapitre qualite',
    section_archived_at: overrides.section_archived_at || null,
    block_ref_id: overrides.block_ref_id === undefined ? 'block-1' : overrides.block_ref_id,
    block_chapter_id: overrides.block_chapter_id === undefined ? 'section-1' : overrides.block_chapter_id,
    block_position: overrides.block_position === undefined ? 3 : overrides.block_position,
    block_is_visible: overrides.block_is_visible === undefined ? true : overrides.block_is_visible,
    block_ref_count: overrides.block_ref_count === undefined ? 1 : overrides.block_ref_count,
    total_count: overrides.total_count || 1,
    created_at: overrides.created_at || '2026-01-01T00:00:00.000Z',
    updated_at: overrides.updated_at || '2026-01-02T00:00:00.000Z',
    archived_at: overrides.archived_at || null,
  };
}

function makeDb(rowsByKind = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      assert(/^\s*(WITH|SELECT)\b/i.test(sql), `requete non read-only refusee: ${sql.slice(0, 40)}`);
      assert(!/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i.test(sql), 'mutation detectee dans le listing global');
      if (sql.includes('WITH tables AS')) {
        return {
          rows: rowsByKind.diagnostic || [
            { object_type: 'tables', total: 168, active: 150, archived: 18, active_with_section: 74, active_referenced_by_block: 74, referenced_by_block: 74, missing_section: 5, missing_block: 89, mismatched_block_section: 0, hidden_block: 2 },
            { object_type: 'diagrams', total: 27, active: 25, archived: 2, active_with_section: 11, active_referenced_by_block: 11, referenced_by_block: 11, missing_section: 1, missing_block: 15, mismatched_block_section: 0, hidden_block: 1 },
          ],
        };
      }
      if (sql.includes('quality_document_tables')) return { rows: rowsByKind.tables || [] };
      if (sql.includes('quality_document_diagrams')) return { rows: rowsByKind.diagrams || [] };
      return { rows: [] };
    },
  };
}

async function main() {
  const tableRows = [
    makeRow({ id: 'table-attached', title: 'Plan HACCP', total_count: 4 }),
    makeRow({ id: 'table-no-block', title: 'Table sans bloc', block_ref_id: null, block_ref_count: 0, total_count: 4 }),
    makeRow({ id: 'table-no-section', title: 'Table sans section', section_id: null, section_ref_id: null, total_count: 4 }),
    makeRow({ id: 'table-archived', title: 'Table archivee', archived_at: '2026-01-03T00:00:00.000Z', total_count: 4 }),
  ];
  const diagramRows = [
    makeRow({ id: 'diagram-attached', title: 'Flux reception', total_count: 2 }),
    makeRow({ id: 'diagram-hidden', title: 'Diagramme masque', block_is_visible: false, total_count: 2 }),
  ];
  const db = makeDb({ tables: tableRows, diagrams: diagramRows });

  const tableList = await inventory.listAllTables(db, 'store-a', { status: 'all', limit: 2, offset: 1 });
  assert(tableList.items.length === 4, 'le listing global doit renvoyer les tableaux mockes');
  assert(tableList.items.find((item) => item.id === 'table-no-block').attachment_status === 'missing_block', 'un tableau sans bloc doit etre signale');
  assert(tableList.items.find((item) => item.id === 'table-no-section').attachment_status === 'missing_section', 'un tableau sans section doit etre signale');
  assert(tableList.items.find((item) => item.id === 'table-archived').attachment_status === 'archived', 'un tableau archive doit etre signale');
  assert(tableList.pagination.limit === 2 && tableList.pagination.offset === 1, 'pagination invalide');
  assert(db.calls.at(-1).params.includes('store-a'), 'le listing doit etre store-scoped');

  const table = await inventory.getTable(db, 'store-a', 'table-attached');
  assert(table?.table_data?.columns?.length === 1, 'getTable doit relire les donnees du tableau');

  let missingIdRejected = false;
  try {
    await inventory.getTable(db, 'store-a');
  } catch (error) {
    missingIdRejected = error.status === 400;
  }
  assert(missingIdRejected, 'getTable doit refuser un ID manquant');

  const diagramList = await inventory.listAllDiagrams(db, 'store-a', { status: 'hidden' });
  assert(diagramList.items.find((item) => item.id === 'diagram-hidden').attachment_status === 'hidden', 'un diagramme masque doit etre signale');
  const diagram = await inventory.getDiagram(db, 'store-a', 'diagram-attached');
  assert(diagram?.diagram_data?.source, 'getDiagram doit relire la source du diagramme');

  const wrongStoreDb = makeDb({ tables: [] });
  const wrongStoreResult = await inventory.getTable(wrongStoreDb, 'store-b', 'table-attached');
  assert(wrongStoreResult === null, 'un objet hors store ne doit pas etre relu');

  const diagnostic = await inventory.diagnoseStructuredObjects(makeDb(), 'store-a');
  assert(diagnostic.counts.tables.total === 168, 'diagnostic tables total invalide');
  assert(diagnostic.counts.diagrams.total === 27, 'diagnostic diagrammes total invalide');
  assert(diagnostic.counts.tables.active_with_section === 74, 'diagnostic doit exposer le compteur comparable aux outils existants');

  for (const name of [
    'quality.documentation.list_all_tables',
    'quality.documentation.get_table',
    'quality.documentation.list_all_diagrams',
    'quality.documentation.get_diagram',
    'quality.documentation.diagnose_structured_objects',
  ]) {
    const tool = registry.getAgentTool(name);
    assert(tool, `${name} absent du registre agent`);
    assert(tool.riskLevel === registry.RISK_LEVELS.READ, `${name} doit rester read-only`);
    assert(tool.requiredPermission === 'quality.documentation.read', `${name} doit exiger quality.documentation.read`);
    assert(tool.requiresConfirmation === false, `${name} ne doit pas exiger de confirmation d'ecriture`);
  }

  for (const alias of [
    'quality_documentation_list_all_tables',
    'quality_documentation_get_table',
    'quality_documentation_list_all_diagrams',
    'quality_documentation_get_diagram',
    'quality_documentation_diagnose_structured_objects',
  ]) {
    assert(mcpServer._private.PUBLIC_QUALITY_BLOCK_TOOL_ALIASES[alias], `${alias} absent des alias MCP publics`);
    assert(mcpServer._private.buildPublicMcpTools().some((tool) => tool.name === alias), `${alias} absent du catalogue MCP public`);
  }

  console.log(JSON.stringify({
    ok: true,
    tested: [
      'valid global listing',
      'missing block',
      'missing section',
      'archived object',
      'hidden object',
      'get by id',
      'wrong store',
      'missing id',
      'pagination',
      'diagnostic counts',
      'read-only SQL guard',
      'agent registry',
      'public MCP aliases',
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
