const assert = require('assert');

const { executeExecutableActionDirect } = require('../services/agent/agentActionOrchestratorService');
const { getExecutableAction } = require('../services/agent/agentExecutableActionRegistry');
const { authorizeTool } = require('../services/agent/agentAuthorizationService');
const { updateDocumentBlock, withTransaction } = require('../services/quality/qualityDocumentBlockService');

const STORE_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_STORE_ID = '00000000-0000-4000-8000-000000000002';
const USER_ID = '00000000-0000-4000-8000-000000000101';
const COLLECTION_ID = '00000000-0000-4000-8000-000000000201';
const SECTION_ID = '00000000-0000-4000-8000-000000000301';
const BLOCK_ID = '00000000-0000-4000-8000-000000000401';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pgError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

class FakePool {
  constructor(options = {}) {
    this.options = options;
    this.auditEvents = [];
    this.rollbacks = 0;
    this.commits = 0;
    this.sections = [{
      id: SECTION_ID,
      store_id: STORE_ID,
      collection_id: COLLECTION_ID,
      code: 'TEST-C01',
      title: 'Chapitre test',
      content_html: '<p>Avant</p>',
      content_text: 'Avant',
      version: '1.0',
      archived_at: null,
    }];
    this.blocks = [{
      id: BLOCK_ID,
      store_id: STORE_ID,
      collection_id: COLLECTION_ID,
      chapter_id: SECTION_ID,
      block_type: 'rich_text',
      position: 10,
      title: 'Texte',
      content: { html: '<p>Avant</p>' },
      is_visible: true,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
    }];
    this.versions = [];
  }

  async connect() {
    return new FakeClient(this);
  }

  async query(sql, params) {
    const client = await this.connect();
    return client.query(sql, params);
  }
}

class FakeClient {
  constructor(pool) {
    this.pool = pool;
    this.inTransaction = false;
    this.aborted = false;
    this.savepoints = [];
    this.released = false;
  }

  release() {
    this.released = true;
  }

  async query(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (this.aborted && !compact.startsWith('ROLLBACK')) {
      throw pgError('25P02', 'current transaction is aborted, commands ignored until end of transaction block');
    }
    if (compact === 'BEGIN') {
      this.inTransaction = true;
      return { rows: [] };
    }
    if (compact === 'COMMIT') {
      this.pool.commits += 1;
      this.inTransaction = false;
      return { rows: [] };
    }
    if (compact === 'ROLLBACK') {
      this.pool.rollbacks += 1;
      this.aborted = false;
      this.inTransaction = false;
      return { rows: [] };
    }
    if (compact.startsWith('SAVEPOINT')) {
      if (!this.inTransaction) throw pgError('25P01', 'SAVEPOINT can only be used in transaction blocks');
      this.savepoints.push(compact.split(' ')[1]);
      return { rows: [] };
    }
    if (compact.startsWith('ROLLBACK TO SAVEPOINT')) {
      this.aborted = false;
      return { rows: [] };
    }
    if (compact.startsWith('RELEASE SAVEPOINT')) return { rows: [] };

    if (compact.startsWith('SELECT * FROM quality_document_blocks WHERE id = $1 AND store_id = $2')) {
      return { rows: this.pool.blocks.filter((block) => block.id === params[0] && block.store_id === params[1]).map(clone) };
    }
    if (compact.startsWith('SELECT * FROM quality_documentation_sections WHERE id = $1 AND store_id = $2')) {
      return { rows: this.pool.sections.filter((section) => section.id === params[0] && section.store_id === params[1] && !section.archived_at).map(clone) };
    }
    if (compact.startsWith('SELECT id, block_type, position, title, content, is_visible FROM quality_document_blocks')) {
      return { rows: this.pool.blocks.filter((block) => block.store_id === params[0] && block.chapter_id === params[1]).map(clone) };
    }
    if (compact.startsWith('SELECT * FROM quality_document_blocks WHERE store_id = $1 AND chapter_id = $2')) {
      return { rows: this.pool.blocks.filter((block) => block.store_id === params[0] && block.chapter_id === params[1]).map(clone) };
    }
    if (compact.startsWith('SELECT * FROM quality_document_tables')) return { rows: [] };
    if (compact.startsWith('SELECT * FROM quality_document_diagrams')) return { rows: [] };
    if (compact.startsWith('SELECT * FROM quality_documentation_attachments')) return { rows: [] };
    if (compact.startsWith('UPDATE quality_document_blocks')) {
      if (this.pool.options.failBlockUpdate) {
        this.aborted = true;
        throw pgError('23514', 'violates check constraint "quality_document_blocks_type_check"');
      }
      const block = this.pool.blocks.find((row) => row.id === params[0] && row.store_id === params[1]);
      if (!block) return { rows: [] };
      block.title = params[2] || block.title;
      block.content = JSON.parse(params[3]);
      block.is_visible = params[4] ?? block.is_visible;
      block.updated_by = params[5];
      block.updated_at = '2026-08-13T12:00:00.000Z';
      return { rows: [clone(block)] };
    }
    if (compact.startsWith('UPDATE quality_documentation_sections')) {
      const section = this.pool.sections.find((row) => row.id === params[0] && row.store_id === params[1]);
      section.content_html = params[2];
      section.content_text = params[3];
      section.updated_by = params[4];
      section.updated_at = '2026-08-13T12:00:00.000Z';
      return { rows: [clone(section)] };
    }
    if (compact.startsWith('INSERT INTO quality_documentation_versions')) {
      const version = {
        id: `version-${this.pool.versions.length + 1}`,
        section_id: params[0],
        store_id: params[1],
        version: params[3],
        content_html: params[4],
        content_text: params[5],
        change_type: params[7],
      };
      this.pool.versions.push(version);
      return { rows: [clone(version)] };
    }
    if (compact.startsWith('UPDATE quality_documentation_versions SET blocks_snapshot')) {
      this.aborted = true;
      throw pgError('42703', 'column "blocks_snapshot" of relation "quality_documentation_versions" does not exist');
    }
    if (compact.startsWith('SELECT client_key FROM stores')) {
      return { rows: [{ client_key: 'scorpa' }] };
    }
    if (compact.startsWith('INSERT INTO user_audit_events')) {
      if (this.pool.options.failAuditInsert) {
        this.aborted = true;
        throw pgError('22P02', 'invalid input syntax for type uuid');
      }
      this.pool.auditEvents.push({ action: params[3], entity_id: params[5] });
      return { rows: [] };
    }

    throw new Error(`Query non geree dans FakeClient: ${compact}`);
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
  const baseContext = {
    store_id: STORE_ID,
    user_id: USER_ID,
    role: 'agent',
    user_permissions: ['mcp.execute', 'quality.documentation.edit'],
    agent_permissions: ['mcp.execute', 'quality.documentation.edit'],
    source: 'test',
  };

  const pool = new FakePool();
  const direct = await executeExecutableActionDirect({
    dbPool: pool,
    context: baseContext,
    actionType: 'quality.documentation.update_text_block',
    payload: { block_id: BLOCK_ID, html: '<p>Apres contenu seul</p>' },
  });
  assert.strictEqual(direct.ok, true, 'update_text_block doit reussir');
  assert.strictEqual(pool.blocks[0].content.html, '<p>Apres contenu seul</p>', 'le contenu doit etre enregistre');
  assert.strictEqual(pool.commits, 1, 'la transaction doit etre committee');
  assert.strictEqual(pool.rollbacks, 0, 'aucun rollback attendu sur update normal');
  assert(pool.versions.length === 1, 'une version doit etre creee');
  assert(pool.auditEvents.some((event) => event.action === 'quality.documentation.block.updated'), 'audit attendu');

  const noTitlePool = new FakePool();
  await withTransaction(noTitlePool, (client) => updateDocumentBlock(client, STORE_ID, BLOCK_ID, USER_ID, { content: { html: '<p>Sans titre</p>' } }));
  assert.strictEqual(noTitlePool.blocks[0].title, 'Texte', 'le titre doit rester inchange si absent');

  const titlePool = new FakePool();
  await withTransaction(titlePool, (client) => updateDocumentBlock(client, STORE_ID, BLOCK_ID, USER_ID, { title: 'Nouveau titre', content: { html: '<p>Titre et contenu</p>' } }));
  assert.strictEqual(titlePool.blocks[0].title, 'Nouveau titre', 'le titre doit etre modifiable');

  const missingPool = new FakePool();
  const missing = await withTransaction(missingPool, (client) => updateDocumentBlock(client, STORE_ID, '00000000-0000-4000-8000-000000000999', USER_ID, { content: { html: '<p>x</p>' } }));
  assert.strictEqual(missing, null, 'bloc inexistant doit retourner null');

  const wrongStorePool = new FakePool();
  const wrongStore = await withTransaction(wrongStorePool, (client) => updateDocumentBlock(client, OTHER_STORE_ID, BLOCK_ID, USER_ID, { content: { html: '<p>x</p>' } }));
  assert.strictEqual(wrongStore, null, 'mauvais store doit retourner null');

  await assertRejectsStatus(
    () => executeExecutableActionDirect({ dbPool: new FakePool(), context: baseContext, actionType: 'quality.documentation.update_text_block', payload: { html: '<p>missing id</p>' } }),
    400,
    'payload sans block_id doit etre refuse'
  );

  const tool = { name: 'quality.documentation.update_text_block', requiredPermission: 'quality.documentation.edit', status: 'available' };
  await assertRejectsStatus(
    () => Promise.resolve(authorizeTool(tool, { store_id: STORE_ID, role: 'agent', user_permissions: [], agent_permissions: ['quality.documentation.edit'] })),
    403,
    'permission utilisateur manquante doit etre refusee'
  );

  const rollbackPool = new FakePool({ failBlockUpdate: true });
  let rollbackError = null;
  try {
    await executeExecutableActionDirect({
      dbPool: rollbackPool,
      context: baseContext,
      actionType: 'quality.documentation.update_text_block',
      payload: { block_id: BLOCK_ID, html: '<p>Doit rollback</p>' },
    });
  } catch (error) {
    rollbackError = error;
  }
  assert.strictEqual(rollbackError?.code, '23514', 'la premiere erreur SQL doit etre retournee');
  assert.strictEqual(rollbackPool.rollbacks, 1, 'une erreur SQL doit provoquer ROLLBACK');
  assert.strictEqual(rollbackPool.blocks[0].content.html, '<p>Avant</p>', 'aucune modification partielle attendue apres rollback simule');

  const afterErrorPool = new FakePool();
  await executeExecutableActionDirect({
    dbPool: afterErrorPool,
    context: baseContext,
    actionType: 'quality.documentation.update_text_block',
    payload: { block_id: BLOCK_ID, html: '<p>Connexion reutilisable</p>' },
  });
  assert.strictEqual(afterErrorPool.blocks[0].content.html, '<p>Connexion reutilisable</p>', 'une nouvelle operation doit fonctionner apres erreur');

  const auditFailurePool = new FakePool({ failAuditInsert: true });
  await executeExecutableActionDirect({
    dbPool: auditFailurePool,
    context: baseContext,
    actionType: 'quality.documentation.update_text_block',
    payload: { block_id: BLOCK_ID, html: '<p>Audit optionnel protege</p>' },
  });
  assert.strictEqual(auditFailurePool.commits, 1, 'un echec audit optionnel protege par savepoint ne doit pas aborter la transaction');

  assert(getExecutableAction('quality.documentation.update_text_block'), 'action executable update_text_block manquante');

  console.log(JSON.stringify({
    ok: true,
    update_content_only: true,
    update_title_and_content: true,
    missing_block: true,
    wrong_store: true,
    permission_refused: true,
    invalid_payload: true,
    first_sql_error_preserved: rollbackError.code,
    rollback_confirmed: true,
    connection_reusable_after_error: true,
    optional_snapshot_42703_savepoint: true,
    optional_audit_savepoint: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
