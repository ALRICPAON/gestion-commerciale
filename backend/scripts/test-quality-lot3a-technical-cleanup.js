const assert = require('assert');

const { updateSection } = require('../services/quality/qualityDocumentationService');
const {
  T2_C20_ATTACHMENT_ID,
  T4_C17_NEW_TEXT,
  T4_C17_OLD_TEXT,
  cleanupLot3aTechnicalDebt,
} = require('../services/quality/qualityLot3aTechnicalCleanupService');

const STORE_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000101';
const COLLECTION_ID = '00000000-0000-4000-8000-000000000201';
const T2_SECTION_ID = '00000000-0000-4000-8000-000000000220';
const T4_SECTION_ID = '00000000-0000-4000-8000-000000000417';
const T9_SECTION_ID = '00000000-0000-4000-8000-000000000906';
const TABLE_ID = '00000000-0000-4000-8000-000000000517';
const BLOCK_ID = '00000000-0000-4000-8000-000000000620';
const OTHER_ATTACHMENT_ID = '00000000-0000-4000-8000-000000000621';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseTableData() {
  return {
    schema_version: 1,
    title: 'Maitrise fournisseurs',
    header: true,
    columns: [
      { id: 'point', label: 'Point' },
      { id: 'action', label: 'Action' },
      { id: 'preuve', label: 'Preuve' },
    ],
    rows: [
      { id: 'row-1', cells: { point: 'Fournisseur actif', action: T4_C17_OLD_TEXT, preuve: 'ENR-021' } },
      { id: 'row-2', cells: { point: 'Historique', action: 'Conserver les historiques existants', preuve: 'Dossier fournisseur' } },
    ],
  };
}

class FakeDb {
  constructor() {
    this.sections = [
      { id: T2_SECTION_ID, store_id: STORE_ID, collection_id: COLLECTION_ID, code: 'T2-C20', title: 'Nuisibles', section_type: 'chapter', status: 'draft', version: '1.0', display_order: 220, content_html: '<p>Nuisibles</p>', content_text: 'Nuisibles', include_in_export: true, archived_at: null },
      { id: T4_SECTION_ID, store_id: STORE_ID, collection_id: COLLECTION_ID, code: 'T4-C17', title: 'Fournisseurs', section_type: 'chapter', status: 'draft', version: '1.0', display_order: 417, content_html: '<figure data-table-id="old"></figure>', content_text: 'old', include_in_export: true, archived_at: null },
      { id: T9_SECTION_ID, store_id: STORE_ID, collection_id: COLLECTION_ID, code: 'T9-C06', title: 'Ancien titre', section_type: 'chapter', status: 'validated', version: '1.0', display_order: 906, content_html: '<p>Texte</p>', content_text: 'Texte', include_in_export: true, validated_at: new Date('2026-08-12T15:28:14.000Z'), applicable_from: new Date('2026-08-01T00:00:00.000Z'), revision_due_at: new Date('2026-12-31T00:00:00.000Z'), archived_at: null },
    ];
    this.attachments = [
      { id: T2_C20_ATTACHMENT_ID, store_id: STORE_ID, section_id: T2_SECTION_ID, document_id: 'document-cci-nuisibles', filename: 'CCI nuisibles.pdf', original_filename: 'CCI nuisibles.pdf', file_path: 'private/cci.pdf', archived_at: null },
      { id: OTHER_ATTACHMENT_ID, store_id: STORE_ID, section_id: 'other-section', document_id: 'document-cci-nuisibles', filename: 'CCI nuisibles.pdf', original_filename: 'CCI nuisibles.pdf', file_path: 'private/cci.pdf', archived_at: null },
    ];
    this.blocks = [
      { id: BLOCK_ID, store_id: STORE_ID, collection_id: COLLECTION_ID, chapter_id: T2_SECTION_ID, block_type: 'attachment', position: 20, title: 'CCI nuisibles', content: { attachment_id: T2_C20_ATTACHMENT_ID }, is_visible: false },
    ];
    this.tables = [
      { id: TABLE_ID, store_id: STORE_ID, collection_id: COLLECTION_ID, section_id: T4_SECTION_ID, block_id: 'table-fournisseurs', title: 'Maitrise fournisseurs', table_type: 'haccp', table_data: baseTableData(), archived_at: null },
    ];
    this.versions = [];
    this.auditEvents = [];
    this.sectionUpdateParams = [];
  }

  async query(sql, params = []) {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    if (compact === 'SAVEPOINT sp_quality_audit_test') return { rows: [] };
    if (compact.startsWith('SAVEPOINT') || compact.startsWith('RELEASE SAVEPOINT') || compact.startsWith('ROLLBACK TO SAVEPOINT')) return { rows: [] };
    if (compact.startsWith('SELECT * FROM quality_documentation_sections WHERE store_id = $1 AND code = $2')) {
      return { rows: this.sections.filter((row) => row.store_id === params[0] && row.code === params[1] && !row.archived_at).map(clone) };
    }
    if (compact.startsWith('SELECT * FROM quality_documentation_attachments WHERE id = $1')) {
      return { rows: this.attachments.filter((row) => row.id === params[0] && row.store_id === params[1] && row.section_id === params[2]).map(clone) };
    }
    if (compact.startsWith('SELECT b.id, s.code FROM quality_document_blocks')) {
      return { rows: this.blocks.filter((block) => block.store_id === params[0] && block.content?.attachment_id === params[1] && block.chapter_id !== params[2]).map((block) => ({ id: block.id, code: this.sections.find((section) => section.id === block.chapter_id)?.code })) };
    }
    if (compact.startsWith('SELECT id FROM quality_document_blocks')) {
      return { rows: this.blocks.filter((block) => block.store_id === params[0] && block.chapter_id === params[1] && block.content?.attachment_id === params[2]).map(({ id }) => ({ id })) };
    }
    if (compact.startsWith('SELECT COUNT(*)::int AS count FROM quality_documentation_attachments')) {
      return { rows: [{ count: this.attachments.filter((row) => row.store_id === params[0] && row.document_id === params[1] && row.id !== params[2] && !row.archived_at).length }] };
    }
    if (compact.startsWith('DELETE FROM quality_document_blocks')) {
      this.blocks = this.blocks.filter((block) => !(block.store_id === params[0] && block.chapter_id === params[1] && block.content?.attachment_id === params[2]));
      return { rows: [] };
    }
    if (compact.startsWith('UPDATE quality_documentation_attachments SET archived_at')) {
      const row = this.attachments.find((item) => item.id === params[0] && item.store_id === params[1] && item.section_id === params[2]);
      row.archived_at = row.archived_at || '2026-08-23T10:00:00.000Z';
      return { rows: [clone(row)] };
    }
    if (compact.startsWith('SELECT * FROM quality_document_tables WHERE store_id = $1 AND section_id = $2 AND archived_at IS NULL ORDER BY')) {
      return { rows: this.tables.filter((table) => table.store_id === params[0] && table.section_id === params[1] && !table.archived_at).map(clone) };
    }
    if (compact.startsWith('SELECT * FROM quality_document_tables WHERE id = $1')) {
      return { rows: this.tables.filter((table) => table.id === params[0] && table.store_id === params[1] && !table.archived_at).map(clone) };
    }
    if (compact.startsWith('SELECT * FROM quality_documentation_sections WHERE id = $1 AND store_id = $2')) {
      return { rows: this.sections.filter((section) => section.id === params[0] && section.store_id === params[1] && !section.archived_at).map(clone) };
    }
    if (compact.startsWith('UPDATE quality_document_tables')) {
      const table = this.tables.find((row) => row.id === params[0] && row.store_id === params[1]);
      table.title = params[2];
      table.table_type = params[3];
      table.table_data = JSON.parse(params[4]);
      table.updated_by = params[5];
      return { rows: [clone(table)] };
    }
    if (compact.startsWith('UPDATE quality_documentation_sections')) {
      const section = this.sections.find((row) => row.id === params[0] && row.store_id === params[1]);
      this.sectionUpdateParams.push(params);
      if (compact.includes('SET parent_id = $3')) {
        section.parent_id = params[2];
        section.section_type = params[3];
        section.code = params[4];
        section.title = params[5];
        section.content_html = params[6];
        section.content_text = params[7];
        section.display_order = params[8];
        section.status = params[9];
        section.version = params[10];
        section.include_in_export = params[11];
        section.comment_internal = params[12];
        section.regulatory_references = params[13];
        section.validated_at = params[14];
        section.updated_by = params[15];
        section.applicable_from = params[16];
        section.revision_due_at = params[17];
      } else {
        section.content_html = params[2];
        section.content_text = params[3];
        section.updated_by = params[4];
      }
      return { rows: [clone(section)] };
    }
    if (compact.startsWith('INSERT INTO quality_documentation_versions')) {
      const version = { id: `version-${this.versions.length + 1}`, section_id: params[0], store_id: params[1], change_type: params[7] };
      this.versions.push(version);
      return { rows: [clone(version)] };
    }
    if (compact.startsWith('SELECT client_key FROM stores')) return { rows: [{ client_key: 'alta' }] };
    if (compact.startsWith('INSERT INTO user_audit_events')) {
      this.auditEvents.push({ action: params[3], entity_id: params[5] });
      return { rows: [] };
    }
    throw new Error(`Query non geree: ${compact}`);
  }
}

async function main() {
  const dryRunDb = new FakeDb();
  const dryRun = await cleanupLot3aTechnicalDebt(dryRunDb, STORE_ID, USER_ID, {});
  assert.equal(dryRun.dry_run, true, 'Le script doit etre en dry-run par defaut');
  assert.equal(dryRun.attachment.residual_block_count, 1, 'Le bloc residuel T2-C20 doit etre detecte');
  assert.equal(dryRun.attachment.preserved_same_document_references, 1, 'Les autres rattachements du document maitre doivent etre conserves');
  assert.equal(dryRun.table_cell.replacements, 1, 'Une seule cellule T4-C17 doit etre candidate');
  assert.equal(dryRunDb.attachments[0].archived_at, null, 'Dry-run ne doit pas archiver la piece');
  assert.equal(dryRunDb.tables[0].table_data.rows[0].cells.action, T4_C17_OLD_TEXT, 'Dry-run ne doit pas modifier la cellule');

  const applyDb = new FakeDb();
  const applied = await cleanupLot3aTechnicalDebt(applyDb, STORE_ID, USER_ID, { apply: true });
  assert.equal(applied.attachment.mode, 'applied', 'Le detachement doit etre applique');
  assert(applyDb.attachments[0].archived_at, 'La reference T2-C20 doit etre archivee');
  assert.equal(applyDb.attachments[1].archived_at, null, 'Les autres rattachements du document doivent rester actifs');
  assert.equal(applyDb.blocks.length, 0, 'Le bloc residuel T2-C20 pointant la piece doit etre retire');
  assert.equal(applyDb.tables[0].table_data.rows[0].cells.action, T4_C17_NEW_TEXT, 'La cellule cible doit etre modifiee');
  assert.equal(applyDb.tables[0].table_data.rows[0].cells.preuve, 'ENR-021', 'Le renvoi ENR-021 doit etre conserve');
  assert.equal(applyDb.tables[0].table_data.rows[1].cells.action, 'Conserver les historiques existants', 'Les autres cellules ne doivent pas changer');

  const timestampDb = new FakeDb();
  const renamed = await updateSection(timestampDb, STORE_ID, T9_SECTION_ID, USER_ID, {
    title: 'Dispositif de lutte contre les nuisibles — Criée / CCI',
    change_summary: 'Renommage T9-C06',
  });
  assert.equal(renamed.title, 'Dispositif de lutte contre les nuisibles — Criée / CCI', 'Le renommage du chapitre doit passer');
  const updateParams = timestampDb.sectionUpdateParams.find((params) => params[0] === T9_SECTION_ID && params.length >= 18);
  assert.equal(updateParams[14], '2026-08-12T15:28:14.000Z', 'validated_at doit etre serialise en ISO 8601');
  assert.equal(updateParams[16], '2026-08-01', 'applicable_from doit rester une date PostgreSQL valide');
  assert.equal(updateParams[17], '2026-12-31', 'revision_due_at doit rester une date PostgreSQL valide');

  console.log(JSON.stringify({
    ok: true,
    attachment_detach_without_file_delete: true,
    other_document_references_preserved: true,
    targeted_table_cell_update: true,
    other_cells_preserved: true,
    chapter_timestamp_serialization: true,
    chapter_rename_supported_by_versioned_data: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
