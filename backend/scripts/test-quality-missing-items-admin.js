const assert = require('assert');

const qualityDocumentation = require('../services/quality/qualityDocumentationService');
const { buildHtml } = require('../services/quality/qualityDocumentationExportService');
const { listMcpTools } = require('../services/agent/agentToolRegistry');
const { authorizeTool } = require('../services/agent/agentAuthorizationService');

const STORE_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_STORE_ID = '00000000-0000-4000-8000-000000000002';
const USER_ID = '00000000-0000-4000-8000-000000000101';
const COLLECTION_ID = '00000000-0000-4000-8000-000000000201';
const SECTION_ID = '00000000-0000-4000-8000-000000000301';
const ITEM_ID = '00000000-0000-4000-8000-000000000401';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeDb {
  constructor() {
    this.sections = [{
      id: SECTION_ID,
      store_id: STORE_ID,
      collection_id: COLLECTION_ID,
      code: 'T1-C01',
      title: 'Identite',
      archived_at: null,
    }];
    this.users = [{ id: USER_ID, store_id: STORE_ID, is_active: true }];
    this.stores = [{ id: STORE_ID, client_key: 'scorpa' }, { id: OTHER_STORE_ID, client_key: 'other' }];
    this.missingItems = [{
      id: ITEM_ID,
      section_id: SECTION_ID,
      store_id: STORE_ID,
      description: 'Numero agrement a confirmer',
      severity: 'before_submission',
      responsible_user_id: null,
      due_at: null,
      status: 'open',
      resolved_at: null,
      resolved_by: null,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
    }];
    this.auditEvents = [];
  }

  async query(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact.startsWith('SELECT client_key FROM stores')) {
      return { rows: this.stores.filter((store) => store.id === params[0]) };
    }
    if (compact.startsWith('INSERT INTO user_audit_events')) {
      this.auditEvents.push({ store_id: params[0], user_id: params[1], action: params[3], details: params[6] });
      return { rows: [] };
    }
    if (compact.startsWith('SELECT * FROM quality_documentation_sections')) {
      return { rows: this.sections.filter((section) => section.id === params[0] && section.store_id === params[1]) };
    }
    if (compact.startsWith('SELECT id FROM users')) {
      return { rows: this.users.filter((user) => user.id === params[0] && user.store_id === params[1] && user.is_active) };
    }
    if (compact.startsWith('SELECT m.*, s.collection_id')) {
      const item = this.missingItems.find((row) => row.id === params[0] && row.store_id === params[1]);
      if (!item) return { rows: [] };
      const section = this.sections.find((row) => row.id === item.section_id && row.store_id === item.store_id);
      return { rows: section ? [{ ...clone(item), collection_id: section.collection_id, section_title: section.title, section_code: section.code }] : [] };
    }
    if (compact.startsWith('UPDATE quality_documentation_missing_items')) {
      const item = this.missingItems.find((row) => row.id === params[0] && row.store_id === params[1]);
      if (!item) return { rows: [] };
      Object.assign(item, {
        description: params[2],
        severity: params[3],
        responsible_user_id: params[4],
        due_at: params[5],
        status: params[6],
        resolved_at: params[6] === 'resolved' ? (item.resolved_at || '2026-08-13T12:00:00.000Z') : null,
        resolved_by: params[6] === 'resolved' ? (item.resolved_by || params[7]) : null,
        updated_at: '2026-08-13T12:00:00.000Z',
      });
      return { rows: [clone(item)] };
    }
    throw new Error(`Query non geree dans FakeDb: ${compact}`);
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
  const db = new FakeDb();

  const updated = await qualityDocumentation.updateMissingItem(db, STORE_ID, ITEM_ID, USER_ID, {
    collection_id: COLLECTION_ID,
    severity: 'future',
    responsible_user_id: USER_ID,
    due_at: '2026-09-01',
    reason: 'Test temporalite',
  });
  assert.strictEqual(updated.severity, 'future', 'la temporalite doit etre modifiable');
  assert.strictEqual(updated.responsible_user_id, USER_ID, 'le responsable doit etre affectable');
  assert.strictEqual(updated.status, 'open', 'un update simple ne doit pas resoudre le point');

  const resolved = await qualityDocumentation.resolveMissingItem(db, STORE_ID, ITEM_ID, USER_ID, { reason: 'Document recu' });
  assert.strictEqual(resolved.status, 'resolved', 'resolve doit passer le point en resolved');
  assert.strictEqual(resolved.resolved_by, USER_ID, 'resolve doit tracer resolved_by');

  const reopened = await qualityDocumentation.reopenMissingItem(db, STORE_ID, ITEM_ID, USER_ID, { reason: 'Controle manuel' });
  assert.strictEqual(reopened.status, 'open', 'reopen doit remettre le point en open');
  assert.strictEqual(reopened.resolved_at, null, 'reopen doit retirer resolved_at');

  await assertRejectsStatus(
    () => qualityDocumentation.updateMissingItem(db, STORE_ID, ITEM_ID, USER_ID, { severity: 'invented' }),
    400,
    'une temporalite inconnue doit etre refusee'
  );
  const crossStore = await qualityDocumentation.updateMissingItem(db, OTHER_STORE_ID, ITEM_ID, USER_ID, { severity: 'future' });
  assert.strictEqual(crossStore, null, 'un point hors magasin doit etre introuvable');
  assert(db.auditEvents.some((event) => event.action === 'quality.documentation.missing.resolved'), 'resolve doit persister un audit');
  assert(db.auditEvents.some((event) => event.details?.before && event.details?.after), 'audit doit contenir avant/apres');

  const html = buildHtml({
    collection: { title: 'Manuel Qualite', version: '1.0' },
    sections: [{ id: SECTION_ID, code: 'T1-C01', title: 'Identite', section_type: 'chapter', status: 'draft', version: '1.0', include_in_export: true }],
    missing_items: [
      { section_code: 'T1-C01', section_title: 'Identite', description: 'Actif', severity: 'future', status: 'open' },
      { section_code: 'T1-C02', section_title: 'Annexe', description: 'Resolu', severity: 'before_opening', status: 'resolved' },
    ],
    attachments: [],
    blocks: [],
  }, { company_name: 'ALTA MAREE' }, { include_missing: true });
  assert(html.includes('Futur'), 'le PDF doit libeller la temporalite future');
  assert(!html.includes('Resolu'), 'un point resolu ne doit pas apparaitre dans les informations a completer');

  const mcpTools = listMcpTools();
  for (const name of ['list_quality_missing_items', 'update_quality_missing_item', 'resolve_quality_missing_item', 'reopen_quality_missing_item', 'export_quality_documentation_pdf']) {
    assert(mcpTools.some((tool) => tool.name === name), `${name} doit etre expose au MCP`);
  }
  const updateTool = mcpTools.find((tool) => tool.name === 'update_quality_missing_item');
  assert.strictEqual(updateTool._meta.requiresConfirmation, true, 'update MCP doit exiger confirmation');
  const exportTool = mcpTools.find((tool) => tool.name === 'export_quality_documentation_pdf');
  assert.strictEqual(exportTool._meta.requiredPermission, 'quality.document.export', 'export MCP doit utiliser la permission export reelle');
  authorizeTool(exportTool, {
    store_id: STORE_ID,
    role: 'responsable',
    user_permissions: ['quality.document.export'],
    agent_permissions: ['quality.documentation.export'],
  });

  console.log(JSON.stringify({
    ok: true,
    missing_item_update: true,
    resolve: true,
    reopen: true,
    invalid_value_rejected: true,
    cross_store_rejected: true,
    audit: true,
    pdf_active_temporalities: true,
    mcp_tools: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
