const assert = require('assert');

const { getExecutableAction } = require('../services/agent/agentExecutableActionRegistry');
const { listMcpTools } = require('../services/agent/agentToolRegistry');
const {
  normalizeTableData,
  relinkTable,
  updateTableCell,
  updateTableDataCell,
} = require('../services/quality/qualityDocumentationTableService');
const {
  normalizeDiagramData,
  patchDiagram,
  patchDiagramData,
  relinkDiagram,
} = require('../services/quality/qualityDocumentationDiagramService');
const {
  PUBLIC_QUALITY_BLOCK_TOOL_ALIASES,
  buildPublicMcpTools,
} = require('../routes/mcpServer')._private;

const STORE_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_STORE_ID = '00000000-0000-4000-8000-000000000002';
const USER_ID = '00000000-0000-4000-8000-000000000101';
const COLLECTION_ID = '00000000-0000-4000-8000-000000000201';
const SOURCE_SECTION_ID = '00000000-0000-4000-8000-000000000301';
const TARGET_SECTION_ID = '00000000-0000-4000-8000-000000000302';
const TABLE_ID = '00000000-0000-4000-8000-000000000401';
const DIAGRAM_ID = '00000000-0000-4000-8000-000000000501';
const TABLE_BLOCK_REF_ID = '00000000-0000-4000-8000-000000000601';
const DIAGRAM_BLOCK_REF_ID = '00000000-0000-4000-8000-000000000602';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function tableData() {
  return normalizeTableData({
    title: 'Tableau test',
    columns: [
      { id: 'controle', label: 'Controle' },
      { id: 'action', label: 'Action' },
    ],
    rows: [
      { id: 'row-1', cells: { controle: 'Ancien libelle', action: 'Action conservee' } },
      { id: 'row-2', cells: { controle: 'Autre cellule', action: 'Autre action' } },
    ],
  });
}

function diagramData() {
  return normalizeDiagramData({
    title: 'Diagramme test',
    orientation: 'vertical',
    nodes: [
      { id: 'start', label: 'Depart', type: 'start', x: 0, y: 0 },
      { id: 'step', label: 'Ancienne etape', type: 'process', x: 120, y: 0 },
      { id: 'end', label: 'Fin', type: 'end', x: 240, y: 0 },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'step', label: 'suite' },
      { id: 'e2', from: 'step', to: 'end', label: 'fin' },
    ],
  });
}

class FakeDb {
  constructor(options = {}) {
    this.options = options;
    this.auditEvents = [];
    this.versions = [];
    this.sections = [
      {
        id: SOURCE_SECTION_ID,
        store_id: STORE_ID,
        collection_id: COLLECTION_ID,
        code: 'T-OLD',
        title: 'Source',
        content_html: '<p>Source</p>',
        content_text: 'Source',
        version: '1.0',
        archived_at: null,
      },
      {
        id: TARGET_SECTION_ID,
        store_id: STORE_ID,
        collection_id: COLLECTION_ID,
        code: 'T-NEW',
        title: 'Cible',
        content_html: '<p>Cible</p>',
        content_text: 'Cible',
        version: '1.0',
        archived_at: null,
      },
    ];
    this.tables = [{
      id: TABLE_ID,
      store_id: STORE_ID,
      collection_id: COLLECTION_ID,
      section_id: SOURCE_SECTION_ID,
      block_id: 'table-block-old',
      title: 'Tableau test',
      table_type: 'generic',
      table_data: tableData(),
      archived_at: null,
    }];
    this.diagrams = [{
      id: DIAGRAM_ID,
      store_id: STORE_ID,
      collection_id: COLLECTION_ID,
      section_id: SOURCE_SECTION_ID,
      block_id: 'diagram-block-old',
      title: 'Diagramme test',
      diagram_type: 'process',
      orientation: 'vertical',
      diagram_data: diagramData(),
      archived_at: null,
    }];
    this.blocks = [
      {
        id: TABLE_BLOCK_REF_ID,
        store_id: STORE_ID,
        collection_id: COLLECTION_ID,
        chapter_id: SOURCE_SECTION_ID,
        block_type: 'document_table',
        position: 10,
        title: 'Tableau test',
        content: { table_id: TABLE_ID, source: 'quality_document_tables' },
        is_visible: true,
        created_at: '2026-08-01T00:00:00.000Z',
      },
      {
        id: DIAGRAM_BLOCK_REF_ID,
        store_id: STORE_ID,
        collection_id: COLLECTION_ID,
        chapter_id: SOURCE_SECTION_ID,
        block_type: 'mermaid_diagram',
        position: 20,
        title: 'Diagramme test',
        content: { diagram_id: DIAGRAM_ID, source: 'quality_document_diagrams' },
        is_visible: true,
        created_at: '2026-08-01T00:00:00.000Z',
      },
    ];
    this.sections[0].content_html = [
      '<p>Source</p>',
      '<figure class="quality-table-block" data-table-id="' + TABLE_ID + '" data-block-id="table-block-old"><figcaption>Tableau test</figcaption></figure>',
      '<figure class="quality-diagram-block" data-diagram-id="' + DIAGRAM_ID + '" data-block-id="diagram-block-old"><figcaption>Diagramme test</figcaption></figure>',
    ].join('\n');
  }

  async query(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact.startsWith('SAVEPOINT') || compact.startsWith('RELEASE SAVEPOINT') || compact.startsWith('ROLLBACK TO SAVEPOINT')) {
      return { rows: [] };
    }
    if (compact.startsWith('SELECT client_key FROM stores')) return { rows: [{ client_key: 'scorpa' }] };
    if (compact.startsWith('INSERT INTO user_audit_events')) {
      this.auditEvents.push({ action: params[3], entity_id: params[5] });
      return { rows: [] };
    }
    if (compact.startsWith('SELECT * FROM quality_documentation_sections WHERE id = $1 AND store_id = $2')) {
      return { rows: this.sections.filter((row) => row.id === params[0] && row.store_id === params[1]).map(clone) };
    }
    if (compact.startsWith('SELECT COALESCE(MAX(position), 0) + 10 AS position')) {
      const max = this.blocks
        .filter((row) => row.store_id === params[0] && row.chapter_id === params[1])
        .reduce((value, row) => Math.max(value, Number(row.position || 0)), 0);
      return { rows: [{ position: max + 10 }] };
    }
    if (compact.startsWith('SELECT * FROM quality_document_tables WHERE id = $1 AND store_id = $2')) {
      return { rows: this.tables.filter((row) => row.id === params[0] && row.store_id === params[1] && !row.archived_at).map(clone) };
    }
    if (compact.startsWith('SELECT * FROM quality_document_diagrams WHERE id = $1 AND store_id = $2')) {
      return { rows: this.diagrams.filter((row) => row.id === params[0] && row.store_id === params[1] && !row.archived_at).map(clone) };
    }
    if (compact.includes("content->>'table_id' = $2")) {
      if (this.options.duplicateTableRefs) return { rows: [clone(this.blocks[0]), { ...clone(this.blocks[0]), id: 'duplicate-ref' }] };
      return { rows: this.blocks.filter((row) => row.store_id === params[0] && row.content?.table_id === params[1]).map(clone) };
    }
    if (compact.includes("content->>'diagram_id' = $2")) {
      if (this.options.duplicateDiagramRefs) return { rows: [clone(this.blocks[1]), { ...clone(this.blocks[1]), id: 'duplicate-ref' }] };
      return { rows: this.blocks.filter((row) => row.store_id === params[0] && row.content?.diagram_id === params[1]).map(clone) };
    }
    if (compact.startsWith('UPDATE quality_document_tables SET title = $3')) {
      const table = this.tables.find((row) => row.id === params[0] && row.store_id === params[1]);
      if (!table) return { rows: [] };
      table.title = params[2];
      table.table_type = params[3];
      table.table_data = JSON.parse(params[4]);
      return { rows: [clone(table)] };
    }
    if (compact.startsWith('UPDATE quality_document_tables SET section_id = $3')) {
      const table = this.tables.find((row) => row.id === params[0] && row.store_id === params[1]);
      if (!table) return { rows: [] };
      table.section_id = params[2];
      table.collection_id = params[3];
      table.block_id = params[4];
      return { rows: [clone(table)] };
    }
    if (compact.startsWith('UPDATE quality_document_diagrams SET title = $3')) {
      const diagram = this.diagrams.find((row) => row.id === params[0] && row.store_id === params[1]);
      if (!diagram) return { rows: [] };
      diagram.title = params[2];
      diagram.diagram_type = params[3];
      diagram.orientation = params[4];
      diagram.diagram_data = JSON.parse(params[5]);
      return { rows: [clone(diagram)] };
    }
    if (compact.startsWith('UPDATE quality_document_diagrams SET section_id = $3')) {
      const diagram = this.diagrams.find((row) => row.id === params[0] && row.store_id === params[1]);
      if (!diagram) return { rows: [] };
      diagram.section_id = params[2];
      diagram.collection_id = params[3];
      diagram.block_id = params[4];
      return { rows: [clone(diagram)] };
    }
    if (compact.startsWith('UPDATE quality_document_blocks SET collection_id = $3')) {
      const block = this.blocks.find((row) => row.id === params[0] && row.store_id === params[1]);
      if (!block) return { rows: [] };
      block.collection_id = params[2];
      block.chapter_id = params[3];
      block.position = params[4];
      block.title = params[5];
      block.content = JSON.parse(params[6]);
      block.is_visible = params[7] ?? block.is_visible;
      return { rows: [clone(block)] };
    }
    if (compact.startsWith('INSERT INTO quality_document_blocks')) {
      const block = {
        id: params[0],
        store_id: params[1],
        collection_id: params[2],
        chapter_id: params[3],
        block_type: compact.includes("'document_table'") ? 'document_table' : 'mermaid_diagram',
        position: params[4],
        title: params[5],
        content: JSON.parse(params[6]),
        is_visible: params[7],
      };
      this.blocks.push(block);
      return { rows: [clone(block)] };
    }
    if (compact.startsWith('UPDATE quality_documentation_sections SET content_html = $3')) {
      const section = this.sections.find((row) => row.id === params[0] && row.store_id === params[1]);
      section.content_html = params[2];
      section.content_text = params[3];
      return { rows: [clone(section)] };
    }
    if (compact.startsWith('INSERT INTO quality_documentation_versions')) {
      this.versions.push({ section_id: params[0], change_type: params[7] });
      return { rows: [clone(this.versions[this.versions.length - 1])] };
    }
    if (compact.startsWith('UPDATE quality_documentation_versions SET blocks_snapshot')) return { rows: [] };
    throw new Error(`Requete non geree: ${compact}`);
  }
}

async function assertRejectsStatus(fn, status, message) {
  let rejected = false;
  try {
    await fn();
  } catch (error) {
    rejected = error.status === status;
  }
  assert(rejected, message);
}

async function main() {
  const tablePatch = updateTableDataCell(tableData(), {
    row_id: 'row-1',
    column_id: 'controle',
    expected_value: 'Ancien libelle',
    value: 'Nouveau libelle',
  });
  assert.strictEqual(tablePatch.after.value, 'Nouveau libelle');
  assert.strictEqual(tablePatch.table_data.rows[0].cells.action, 'Action conservee', 'les autres cellules de la ligne doivent rester intactes');
  assert.strictEqual(tablePatch.table_data.rows[1].cells.controle, 'Autre cellule', 'les autres lignes doivent rester intactes');
  assert.throws(
    () => updateTableDataCell(tableData(), { row_id: 'row-1', column_id: 'controle', expected_value: 'Valeur absente', value: 'x' }),
    /inattendue/,
    'un expected_value incorrect doit etre refuse'
  );

  const diagramPatch = patchDiagramData(diagramData(), {
    node_id: 'step',
    field: 'label',
    expected_value: 'Ancienne etape',
    value: 'Nouvelle etape',
  });
  assert.strictEqual(diagramPatch.after.node.value, 'Nouvelle etape');
  assert.strictEqual(diagramPatch.diagram_data.nodes.find((node) => node.id === 'start').label, 'Depart', 'les autres noeuds doivent rester intacts');
  assert.strictEqual(diagramPatch.diagram_data.edges[0].label, 'suite', 'les liaisons doivent rester intactes');
  assert.throws(
    () => patchDiagramData(diagramData(), { node_id: 'step', field: 'label', expected_value: 'Mauvaise valeur', value: 'x' }),
    /inattendue/,
    'un expected_value diagramme incorrect doit etre refuse'
  );

  const mermaidPatch = patchDiagramData({
    editor_mode: 'mermaid',
    title: 'Mermaid',
    source: 'flowchart TD\nA[Ancien] --> B[Fin]',
    rendered_svg: '<svg></svg>',
  }, {
    source: 'flowchart TD\nA[Nouveau] --> B[Fin]',
    expected_value: 'flowchart TD\nA[Ancien] --> B[Fin]',
    rendered_svg: '<svg></svg>',
  });
  assert(mermaidPatch.diagram_data.source.includes('Nouveau'), 'la source Mermaid doit pouvoir etre mise a jour de facon ciblee');

  const tableDb = new FakeDb();
  const serviceTablePatch = await updateTableCell(tableDb, STORE_ID, TABLE_ID, USER_ID, {
    row_index: 0,
    column_label: 'Controle',
    expected_value: 'Ancien libelle',
    value: 'Libelle service',
  });
  assert.strictEqual(serviceTablePatch.table.id, TABLE_ID);
  assert.strictEqual(tableDb.tables[0].table_data.rows[0].cells.controle, 'Libelle service');
  assert.strictEqual(tableDb.tables[0].table_data.rows[0].cells.action, 'Action conservee');
  assert.strictEqual(await updateTableCell(new FakeDb(), OTHER_STORE_ID, TABLE_ID, USER_ID, { row_index: 0, column_index: 0, value: 'x' }), null, 'un mauvais store ne doit pas modifier le tableau');

  const relinkTableDb = new FakeDb();
  const tableDryRun = await relinkTable(relinkTableDb, STORE_ID, TABLE_ID, USER_ID, { chapter_id: TARGET_SECTION_ID, dry_run: true });
  assert.strictEqual(tableDryRun.dry_run, true);
  assert.strictEqual(relinkTableDb.tables[0].section_id, SOURCE_SECTION_ID, 'dry_run ne doit rien modifier');
  const tableRelink = await relinkTable(relinkTableDb, STORE_ID, TABLE_ID, USER_ID, { chapter_id: TARGET_SECTION_ID, position: 30 });
  assert.strictEqual(tableRelink.table_id, TABLE_ID);
  assert.strictEqual(relinkTableDb.tables[0].section_id, TARGET_SECTION_ID);
  assert.strictEqual(relinkTableDb.tables.length, 1, 'le tableau ne doit pas etre duplique');
  assert.strictEqual(relinkTableDb.blocks.filter((block) => block.content?.table_id === TABLE_ID).length, 1, 'le bloc de reference tableau ne doit pas etre duplique');
  assert(!relinkTableDb.sections[0].content_html.includes(`data-table-id="${TABLE_ID}"`), 'l ancien chapitre ne doit plus afficher le tableau');
  assert(relinkTableDb.sections[1].content_html.includes(`data-table-id="${TABLE_ID}"`), 'le chapitre cible doit afficher le tableau');
  await assertRejectsStatus(
    () => relinkTable(new FakeDb({ duplicateTableRefs: true }), STORE_ID, TABLE_ID, USER_ID, { chapter_id: TARGET_SECTION_ID }),
    409,
    'un tableau deja rattache plusieurs fois doit etre refuse'
  );

  const diagramDb = new FakeDb();
  const serviceDiagramPatch = await patchDiagram(diagramDb, STORE_ID, DIAGRAM_ID, USER_ID, {
    edge_id: 'e1',
    field: 'label',
    expected_value: 'suite',
    value: 'continuer',
  });
  assert.strictEqual(serviceDiagramPatch.diagram.id, DIAGRAM_ID);
  assert.strictEqual(diagramDb.diagrams[0].diagram_data.edges[0].label, 'continuer');
  assert.strictEqual(diagramDb.diagrams[0].diagram_data.nodes[1].label, 'Ancienne etape', 'les noeuds doivent rester intacts');
  assert.strictEqual(await patchDiagram(new FakeDb(), OTHER_STORE_ID, DIAGRAM_ID, USER_ID, { title: 'x' }), null, 'un mauvais store ne doit pas modifier le diagramme');

  const relinkDiagramDb = new FakeDb();
  const diagramDryRun = await relinkDiagram(relinkDiagramDb, STORE_ID, DIAGRAM_ID, USER_ID, { chapter_id: TARGET_SECTION_ID, dry_run: true });
  assert.strictEqual(diagramDryRun.dry_run, true);
  assert.strictEqual(relinkDiagramDb.diagrams[0].section_id, SOURCE_SECTION_ID, 'dry_run diagramme ne doit rien modifier');
  const diagramRelink = await relinkDiagram(relinkDiagramDb, STORE_ID, DIAGRAM_ID, USER_ID, { chapter_id: TARGET_SECTION_ID, position: 40 });
  assert.strictEqual(diagramRelink.diagram_id, DIAGRAM_ID);
  assert.strictEqual(relinkDiagramDb.diagrams[0].section_id, TARGET_SECTION_ID);
  assert.strictEqual(relinkDiagramDb.diagrams.length, 1, 'le diagramme ne doit pas etre duplique');
  assert.strictEqual(relinkDiagramDb.blocks.filter((block) => block.content?.diagram_id === DIAGRAM_ID).length, 1, 'le bloc de reference diagramme ne doit pas etre duplique');
  assert.strictEqual(relinkDiagramDb.diagrams[0].diagram_data.nodes[0].label, 'Depart', 'le contenu source du diagramme doit etre preserve');
  assert(!relinkDiagramDb.sections[0].content_html.includes(`data-diagram-id="${DIAGRAM_ID}"`), 'l ancien chapitre ne doit plus afficher le diagramme');
  assert(relinkDiagramDb.sections[1].content_html.includes(`data-diagram-id="${DIAGRAM_ID}"`), 'le chapitre cible doit afficher le diagramme');
  await assertRejectsStatus(
    () => relinkDiagram(new FakeDb({ duplicateDiagramRefs: true }), STORE_ID, DIAGRAM_ID, USER_ID, { chapter_id: TARGET_SECTION_ID }),
    409,
    'un diagramme deja rattache plusieurs fois doit etre refuse'
  );

  const canonicalTools = [
    'quality.documentation.update_table_cell',
    'quality.documentation.relink_table',
    'quality.documentation.update_diagram',
    'quality.documentation.relink_diagram',
  ];
  const mcpNames = new Set(listMcpTools().map((tool) => tool.name));
  for (const name of canonicalTools) {
    assert(getExecutableAction(name), `${name} absent du registre executable`);
    assert(mcpNames.has(name), `${name} absent du catalogue MCP canonique`);
  }
  for (const name of [
    'quality_documentation_update_table_cell',
    'quality_documentation_relink_table',
    'quality_documentation_update_diagram',
    'quality_documentation_relink_diagram',
  ]) {
    assert.strictEqual(PUBLIC_QUALITY_BLOCK_TOOL_ALIASES[name]?.startsWith('quality.documentation.'), true, `${name} doit mapper vers une action canonique`);
    assert(buildPublicMcpTools().some((tool) => tool.name === name), `${name} absent du catalogue MCP public`);
  }

  console.log('quality structured edit tools tests ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
