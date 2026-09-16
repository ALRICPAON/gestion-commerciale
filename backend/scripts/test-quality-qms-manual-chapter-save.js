const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { updateSection } = require('../services/quality/qualityDocumentationService');

const STORE_ID = 'store-qms-manual';
const USER_ID = 'user-qms-manual';
const SECTION_ID = 'section-t1-c04';
const COLLECTION_ID = 'collection-qms-manual';
const BLOCK_ID = 'block-t1-c04-rich-text';
const OLD_HTML = '<p>Formation prevue avant ouverture.</p>';
const MANUAL_HTML = '<p>Formation realisee le 15/09/2026 et enregistree par l utilisateur.</p>';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeDb {
  constructor({ withBlock = true } = {}) {
    this.sections = [{
      id: SECTION_ID,
      store_id: STORE_ID,
      collection_id: COLLECTION_ID,
      parent_id: 'tome-1',
      section_type: 'chapter',
      code: 'T1-C04',
      title: 'Organisation',
      content_html: withBlock ? MANUAL_HTML : OLD_HTML,
      content_text: withBlock ? 'Formation realisee le 15/09/2026 et enregistree par l utilisateur.' : 'Formation prevue avant ouverture.',
      display_order: 1004,
      status: 'draft',
      version: '1.0',
      include_in_export: true,
      comment_internal: null,
      regulatory_references: null,
      validated_by: null,
      validated_at: null,
      applicable_from: null,
      revision_due_at: null,
      archived_at: null,
    }, {
      id: 'tome-1',
      store_id: STORE_ID,
      collection_id: COLLECTION_ID,
      parent_id: null,
      section_type: 'tome',
      code: 'T1',
      title: 'Tome 1 - Presentation de l entreprise',
      content_html: '',
      content_text: 'Presentation de l entreprise',
      display_order: 1000,
      status: 'draft',
      version: '1.0',
      include_in_export: true,
      archived_at: null,
    }];
    this.blocks = withBlock ? [{
      id: BLOCK_ID,
      store_id: STORE_ID,
      collection_id: COLLECTION_ID,
      chapter_id: SECTION_ID,
      block_type: 'rich_text',
      position: 10,
      title: 'Texte du chapitre',
      content: { html: MANUAL_HTML, source: 'legacy_content_html' },
      is_visible: true,
      created_at: '2026-09-15T09:00:00.000Z',
    }] : [];
    this.versions = [];
    this.auditEvents = [];
  }

  async query(sql, params = []) {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    if (compact.startsWith('SAVEPOINT') || compact.startsWith('RELEASE SAVEPOINT') || compact.startsWith('ROLLBACK TO SAVEPOINT')) {
      return { rows: [] };
    }
    if (compact.startsWith('SELECT client_key FROM stores')) return { rows: [{ client_key: 'alta-maree' }] };
    if (compact.startsWith('INSERT INTO user_audit_events')) {
      this.auditEvents.push({ action: params[3], entity_id: params[5] });
      return { rows: [] };
    }
    if (compact.startsWith('SELECT * FROM quality_documentation_sections WHERE id = $1 AND store_id = $2')) {
      return { rows: this.sections.filter((section) => section.id === params[0] && section.store_id === params[1]).map(clone) };
    }
    if (compact.startsWith('SELECT id FROM quality_document_blocks')) {
      return { rows: this.blocks.filter((block) => block.store_id === params[0] && block.chapter_id === params[1]).slice(0, 1).map(({ id }) => ({ id })) };
    }
    if (compact.startsWith('SELECT * FROM quality_document_blocks WHERE store_id = $1 AND chapter_id = $2')) {
      return { rows: this.blocks.filter((block) => block.store_id === params[0] && block.chapter_id === params[1]).map(clone) };
    }
    if (compact.startsWith('UPDATE quality_documentation_sections')) {
      const section = this.sections.find((row) => row.id === params[0] && row.store_id === params[1]);
      if (!section) return { rows: [] };
      Object.assign(section, {
        parent_id: params[2],
        section_type: params[3],
        code: params[4],
        title: params[5],
        content_html: params[6],
        content_text: params[7],
        display_order: params[8],
        status: params[9],
        version: params[10],
        include_in_export: params[11],
        comment_internal: params[12],
        regulatory_references: params[13],
        validated_at: params[14],
        updated_by: params[15],
        applicable_from: params[16],
        revision_due_at: params[17],
      });
      return { rows: [clone(section)] };
    }
    if (compact.startsWith('INSERT INTO quality_documentation_versions')) {
      const version = { id: `version-${this.versions.length + 1}`, section_id: params[0], content_html: params[4] };
      this.versions.push(version);
      return { rows: [clone(version)] };
    }
    throw new Error(`Unexpected query in FakeDb: ${compact}`);
  }
}

async function assertRejectsStatus(fn, status, message) {
  let error = null;
  try {
    await fn();
  } catch (err) {
    error = err;
  }
  assert.strictEqual(error?.status, status, message);
}

async function main() {
  const db = new FakeDb({ withBlock: true });
  await assertRejectsStatus(
    () => updateSection(db, STORE_ID, SECTION_ID, USER_ID, {
      content_html: OLD_HTML,
      change_summary: 'PATCH chapitre stale apres modification manuelle T1-C04',
    }),
    409,
    'un ancien content_html ne doit pas ecraser T1-C04 quand un bloc riche existe'
  );
  assert.strictEqual(db.sections[0].content_html, MANUAL_HTML, 'le miroir du chapitre conserve la modification manuelle');
  assert.strictEqual(db.blocks[0].content.html, MANUAL_HTML, 'le bloc riche conserve la modification manuelle');
  assert.strictEqual(db.versions.length, 0, 'aucune version obsolete ne doit etre creee sur refus');

  const metadata = await updateSection(db, STORE_ID, SECTION_ID, USER_ID, {
    title: 'Organisation et responsabilites',
    change_summary: 'Renommage sans toucher au contenu',
  });
  assert.strictEqual(metadata.title, 'Organisation et responsabilites', 'les metadonnees restent persistantes');
  assert.strictEqual(db.blocks[0].content.html, MANUAL_HTML, 'un renommage de chapitre ne touche pas au contenu manuel du bloc');
  assert.strictEqual(db.versions.length, 1, 'le renommage conserve l historique prevu');

  const legacyDb = new FakeDb({ withBlock: false });
  const legacy = await updateSection(legacyDb, STORE_ID, SECTION_ID, USER_ID, {
    content_html: MANUAL_HTML,
    change_summary: 'Edition chapitre legacy sans blocs',
  });
  assert.strictEqual(legacy.content_html, MANUAL_HTML, 'un chapitre sans blocs reste editable via content_html');

  const frontend = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'quality', 'js', 'documentation.js'), 'utf8');
  assert(frontend.includes('async function persistVisibleBlockEditors()'), 'le bouton Enregistrer doit pousser les blocs visibles avant le PATCH chapitre');
  assert(frontend.includes('if (!hasBlocks) body.content_html = editorContentHtml();'), 'le payload chapitre avec blocs ne doit plus envoyer content_html');
  assert(frontend.includes('await persistVisibleBlockEditors();'), 'save() doit attendre la persistance des blocs');

  console.log(JSON.stringify({
    ok: true,
    chapter: 'T1-C04 Organisation',
    stale_section_content_rejected: true,
    manual_block_content_preserved: true,
    metadata_still_editable: true,
    legacy_without_blocks_still_editable: true,
    frontend_flushes_blocks_before_section_patch: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
