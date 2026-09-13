const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  applyDerivedContentToSection,
  deriveSectionContentFromBlocks,
  isPlaceholderContentText,
  resyncSectionContentTextFromBlocks,
} = require('../services/quality/qualityDocumentBlockService');

const ROOT = path.join(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const STORE_ID = 'store-qms';
const SECTION_ID = 'section-qms';
const USER_ID = 'user-qms';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeDb {
  constructor() {
    this.versionsInserted = 0;
    this.sections = [{
      id: SECTION_ID,
      store_id: STORE_ID,
      collection_id: 'collection-qms',
      code: 'T1-C03',
      title: 'Chapitre complet',
      section_type: 'chapter',
      status: 'validated',
      version: '1.4',
      content_html: '<p>Ancien miroir HTML obsolete.</p>',
      content_text: 'Information a completer.',
      archived_at: null,
    }];
    this.blocks = [
      {
        id: 'archived-hidden-block',
        store_id: STORE_ID,
        collection_id: 'collection-qms',
        chapter_id: SECTION_ID,
        block_type: 'rich_text',
        position: 5,
        title: 'Archive',
        content: { html: '<p>Bloc archive masque a exclure.</p>' },
        is_visible: false,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'rich-late',
        store_id: STORE_ID,
        collection_id: 'collection-qms',
        chapter_id: SECTION_ID,
        block_type: 'rich_text',
        position: 20,
        title: 'Texte',
        content: { html: '<p>Procedure officielle validee.</p><p>Responsable qualite identifie.</p>' },
        is_visible: true,
        created_at: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'table-first',
        store_id: STORE_ID,
        collection_id: 'collection-qms',
        chapter_id: SECTION_ID,
        block_type: 'document_table',
        position: 10,
        title: 'Tableau',
        content: { table_id: 'table-1' },
        is_visible: true,
        created_at: '2026-01-03T00:00:00.000Z',
      },
      {
        id: 'old-diagram',
        store_id: STORE_ID,
        collection_id: 'collection-qms',
        chapter_id: SECTION_ID,
        block_type: 'mermaid_diagram',
        position: 30,
        title: 'Diagramme',
        content: { diagram_id: 'diagram-archived' },
        is_visible: true,
        created_at: '2026-01-04T00:00:00.000Z',
      },
    ];
    this.tables = [{
      id: 'table-1',
      store_id: STORE_ID,
      section_id: SECTION_ID,
      title: 'Controles officiels',
      archived_at: null,
      table_data: {
        title: 'Controles officiels',
        columns: [
          { id: 'point', label: 'Point controle' },
          { id: 'preuve', label: 'Preuve' },
        ],
        rows: [
          { id: 'row-1', cells: { point: 'Temperature reception', preuve: 'Enregistrement reception' } },
          { id: 'row-2', cells: { point: 'Etiquette sanitaire', preuve: 'Photo fournisseur' } },
        ],
      },
    }];
    this.diagrams = [{
      id: 'diagram-archived',
      store_id: STORE_ID,
      section_id: SECTION_ID,
      title: 'Ancien diagramme',
      archived_at: '2026-01-05T00:00:00.000Z',
      diagram_data: { title: 'Ne doit pas apparaitre' },
    }];
    this.attachments = [];
  }

  async query(sql, params = []) {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    if (compact.includes('INSERT INTO quality_documentation_versions')) this.versionsInserted += 1;
    if (compact.startsWith('SELECT * FROM quality_documentation_sections WHERE id = $1 AND store_id = $2 AND archived_at IS NULL')) {
      return { rows: this.sections.filter((section) => section.id === params[0] && section.store_id === params[1] && !section.archived_at).map(clone) };
    }
    if (compact.startsWith('SELECT * FROM quality_document_blocks WHERE store_id = $1 AND chapter_id = $2')) {
      return { rows: this.blocks.filter((block) => block.store_id === params[0] && block.chapter_id === params[1]).map(clone) };
    }
    if (compact.startsWith('SELECT * FROM quality_document_tables WHERE store_id = $1 AND section_id = $2 AND archived_at IS NULL')) {
      return { rows: this.tables.filter((table) => table.store_id === params[0] && table.section_id === params[1] && !table.archived_at).map(clone) };
    }
    if (compact.startsWith('SELECT * FROM quality_document_diagrams WHERE store_id = $1 AND section_id = $2 AND archived_at IS NULL')) {
      return { rows: this.diagrams.filter((diagram) => diagram.store_id === params[0] && diagram.section_id === params[1] && !diagram.archived_at).map(clone) };
    }
    if (compact.startsWith('SELECT * FROM quality_documentation_attachments WHERE store_id = $1 AND section_id = $2 AND archived_at IS NULL')) {
      return { rows: this.attachments.filter((attachment) => attachment.store_id === params[0] && attachment.section_id === params[1] && !attachment.archived_at).map(clone) };
    }
    if (compact.startsWith('UPDATE quality_documentation_sections SET content_text = $3')) {
      const section = this.sections.find((row) => row.id === params[0] && row.store_id === params[1] && !row.archived_at);
      if (!section) return { rows: [] };
      section.content_text = params[2];
      section.updated_by = params[3] || section.updated_by || null;
      return { rows: [clone(section)] };
    }
    throw new Error(`Unexpected query: ${compact}`);
  }
}

async function main() {
  assert.strictEqual(isPlaceholderContentText('Information a completer.'), true, 'placeholder historique attendu');

  const db = new FakeDb();
  const dryRun = await resyncSectionContentTextFromBlocks(db, STORE_ID, SECTION_ID, USER_ID, { dry_run: true });
  assert.strictEqual(dryRun.changed, true, 'dry-run doit detecter le content_text obsolete');
  assert.strictEqual(db.sections[0].content_text, 'Information a completer.', 'dry-run ne doit pas ecrire');
  assert.strictEqual(dryRun.before.status, dryRun.after.status, 'dry-run ne change pas le statut');
  assert.strictEqual(dryRun.before.version, dryRun.after.version, 'dry-run ne change pas la version');
  assert(dryRun.after.content_text.indexOf('Controles officiels') < dryRun.after.content_text.indexOf('Procedure officielle'), 'ordre officiel des blocs respecte');
  assert(dryRun.after.content_text.includes('Point controle | Preuve'), 'tableau structure converti en texte exploitable');
  assert(!dryRun.after.content_text.includes('Bloc archive masque'), 'bloc masque exclu');
  assert(!dryRun.after.content_text.includes('Ne doit pas apparaitre'), 'diagramme archive exclu');
  assert(!dryRun.after.content_text.includes('Ancien miroir HTML obsolete'), 'ancien HTML miroir non reinjecte');

  const applied = await resyncSectionContentTextFromBlocks(db, STORE_ID, SECTION_ID, USER_ID, { dry_run: false });
  assert.strictEqual(applied.changed, true, 'apply doit corriger le miroir texte');
  assert.strictEqual(db.sections[0].status, 'validated', 'statut inchange');
  assert.strictEqual(db.sections[0].version, '1.4', 'version metier inchangee');
  assert.strictEqual(db.versionsInserted, 0, 'aucune nouvelle version metier ne doit etre creee');

  const secondPass = await resyncSectionContentTextFromBlocks(db, STORE_ID, SECTION_ID, USER_ID, { dry_run: false });
  assert.strictEqual(secondPass.changed, false, 'second passage idempotent');

  const effective = applyDerivedContentToSection(
    { ...db.sections[0], content_text: 'Information a completer.' },
    [{
      id: 'b1',
      block_type: 'rich_text',
      position: 10,
      content: { html: '<p>Contenu officiel actif.</p>' },
      is_visible: true,
    }]
  );
  assert.strictEqual(effective.content_text, 'Contenu officiel actif.', 'les interfaces doivent privilegier le texte derive fiable');

  const derived = deriveSectionContentFromBlocks([{
    id: 'b2',
    block_type: 'document_table',
    position: 10,
    is_visible: true,
    table: db.tables[0],
  }]);
  assert(derived.content_html.includes('quality-table-block'), 'export HTML/DDPP conserve le rendu visuel des blocs');

  const script = read('backend/scripts/resync-quality-content-text.js');
  ['T1-C03', 'T1-C07', 'T1-C08', 'T2-C01', 'T2-C07', 'T3-C05', 'T3-C06', 'T3-C07', 'T3-C11', 'T3-C12']
    .forEach((code) => assert(script.includes(code), `code de non-regression manquant: ${code}`));
  assert(script.includes('default_mode') && script.includes('dry-run'), 'script doit documenter le dry-run');
  assert(script.includes('archived_at IS NULL'), 'script ne doit pas modifier les chapitres archives');

  const agentContext = read('backend/services/quality/agentQualityContextService.js');
  assert(agentContext.includes('effectiveSection'), 'le contexte agent doit utiliser le texte effectif derive');

  const agentTools = read('backend/services/agent/agentToolRegistry.js');
  assert(agentTools.includes('FROM quality_document_blocks b'), 'la recherche agent doit interroger les blocs actifs');
  assert(agentTools.includes('b.is_visible IS DISTINCT FROM false'), 'la recherche agent doit ignorer les blocs masques');

  console.log(JSON.stringify({
    ok: true,
    placeholder_with_complete_blocks: true,
    resync_updates_content_text: true,
    status_unchanged: true,
    no_business_version_created: true,
    hidden_or_archived_blocks_excluded: true,
    block_order_respected: true,
    structured_table_to_text: true,
    stale_html_not_reinjected: true,
    ddpp_export_html_preserved: true,
    idempotent_second_pass: true,
    ten_chapter_codes_covered: true,
    agent_reads_effective_content: true,
    agent_search_reads_active_blocks: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
