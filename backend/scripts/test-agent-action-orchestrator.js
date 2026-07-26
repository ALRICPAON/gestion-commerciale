const assert = require('assert');
const qualityDocumentation = require('../services/quality/qualityDocumentationService');
const { buildHtml } = require('../services/quality/qualityDocumentationExportService');
const { payloadHash } = require('../services/agent/agentPendingActionService');
const { executeAgentTool } = require('../services/agent/agentToolExecutor');
const { listAgentTools } = require('../services/agent/agentToolRegistry');
const {
  createExecutablePendingAction,
  executeExecutableActionDirect,
  executeExecutablePendingAction,
  listExecutableActions,
} = require('../services/agent/agentActionOrchestratorService');

function makePending(overrides = {}) {
  const payload = overrides.frozen_payload || {
    collection_id: 'collection-1',
    updates: [
      { section_id: 'section-1', content_html: '<p>Nouveau 1</p>' },
      { section_id: 'section-2', content_html: '<p>Nouveau 2</p>' },
    ],
  };
  return {
    id: 'pending-1',
    store_id: 'store-1',
    status: 'awaiting_confirmation',
    action_type: 'quality.documentation.apply_section_updates',
    final_tool_name: 'quality.documentation.apply_section_updates',
    frozen_payload: payload,
    payload_hash: payloadHash(payload),
    ...overrides,
  };
}

function makeContext(overrides = {}) {
  return {
    store_id: 'store-1',
    user_id: 'user-1',
    role: 'responsable',
    user_permissions: ['agent.use', 'mcp.execute', 'quality.documentation.edit'],
    agent_permissions: ['agent.use', 'mcp.execute', 'quality.documentation.edit'],
    source: 'mcp',
    ...overrides,
  };
}

function makeCreateDb() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return {
        rows: [{
          id: 'pending-created',
          store_id: params[0],
          action_type: params[2],
          payload: JSON.parse(params[4]),
          frozen_payload: JSON.parse(params[4]),
          domain: params[5],
          module: params[5],
          final_tool_name: params[6],
          payload_hash: params[10],
        }],
      };
    },
  };
}

function makePool({ pending = makePending(), failSectionId = null } = {}) {
  const state = {
    auditStarted: false,
    auditCompleted: false,
    committed: false,
    rolledBack: false,
    failedMarked: false,
    statusUpdates: [],
    versions: [],
    tableId: 1,
    blockId: 2,
    tables: new Map(),
    blocks: new Map([
      ['block-1', { id: 'block-1', store_id: 'store-1', collection_id: 'collection-1', chapter_id: 'section-1', block_type: 'rich_text', position: 10, title: 'Texte du chapitre', content: { html: '<p>Ancien bloc</p>', source: 'legacy_content_html' }, is_visible: true }],
    ]),
    sections: new Map([
      ['section-1', { id: 'section-1', store_id: 'store-1', collection_id: 'collection-1', code: 'T1-C1', title: 'Chapitre 1', content_html: '<p>Ancien 1</p>', content_text: 'Ancien 1', status: 'draft', version: '1.0', section_type: 'chapter', include_in_export: true }],
      ['section-2', { id: 'section-2', store_id: 'store-1', collection_id: 'collection-1', code: 'T1-C2', title: 'Chapitre 2', content_html: '<p>Ancien 2</p>', content_text: 'Ancien 2', status: 'draft', version: '1.0', section_type: 'chapter', include_in_export: true }],
    ]),
  };

  const client = {
    async query(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      if (compact === 'BEGIN') return { rows: [] };
      if (compact === 'COMMIT') {
        state.committed = true;
        return { rows: [] };
      }
      if (compact === 'ROLLBACK') {
        state.rolledBack = true;
        return { rows: [] };
      }
      if (compact.includes('FROM agent_pending_actions') && compact.includes('FOR UPDATE')) {
        return { rows: pending && pending.store_id === params[1] ? [pending] : [] };
      }
      if (compact.startsWith('UPDATE agent_pending_actions') && compact.includes("status = 'executed'")) {
        state.statusUpdates.push('executed');
        return { rows: [{ ...pending, status: 'executed', execution_result: JSON.parse(params[2]) }] };
      }
      if (compact.startsWith('UPDATE agent_pending_actions') && compact.includes("status = 'executing'")) {
        state.statusUpdates.push('executing');
        return { rows: [{ ...pending, status: 'executing' }] };
      }
      if (compact.includes('FROM quality_documentation_sections') && compact.includes('id = $1 AND store_id = $2')) {
        const section = state.sections.get(params[0]);
        return { rows: section && section.store_id === params[1] ? [section] : [] };
      }
      if (compact.includes('FROM quality_documentation_sections') && compact.includes('COALESCE(code')) {
        const exact = String(params[1] || '').toLowerCase();
        const like = String(params[2] || params[1] || '').replace(/%/g, '').toLowerCase();
        return { rows: [...state.sections.values()].filter((section) => section.store_id === params[0] && (
          String(section.id).toLowerCase() === exact ||
          String(section.code || '').toLowerCase() === exact ||
          [section.title, section.content_text].join(' ').toLowerCase().includes(like)
        )).slice(0, 1) };
      }
      if (compact.startsWith('SELECT COALESCE(MAX(position)')) {
        const max = [...state.blocks.values()]
          .filter((block) => block.store_id === params[0] && block.chapter_id === params[1])
          .reduce((value, block) => Math.max(value, Number(block.position || 0)), 0);
        return { rows: [{ next_position: max + 10 }] };
      }
      if (compact.startsWith('SELECT') && compact.includes('FROM quality_document_blocks') && compact.includes('chapter_id = $2')) {
        return { rows: [...state.blocks.values()].filter((block) => block.store_id === params[0] && block.chapter_id === params[1]).sort((a, b) => a.position - b.position) };
      }
      if (compact.startsWith('SELECT') && compact.includes('FROM quality_document_blocks') && compact.includes('id = $1')) {
        const block = state.blocks.get(params[0]);
        return { rows: block && block.store_id === params[1] ? [block] : [] };
      }
      if (compact.startsWith('UPDATE quality_document_blocks SET position')) {
        const block = state.blocks.get(params[0]);
        if (block && block.store_id === params[1]) {
          state.blocks.set(block.id, { ...block, position: params[2] });
        }
        return { rows: [] };
      }
      if (compact.startsWith('UPDATE quality_document_blocks')) {
        const block = state.blocks.get(params[0]);
        const contentParamIndex = compact.includes('title = COALESCE') ? 3 : 2;
        const content = JSON.parse(params[contentParamIndex]);
        const updated = { ...block, content, title: compact.includes('title = COALESCE') ? (params[2] || block.title) : block.title };
        state.blocks.set(block.id, updated);
        return { rows: [updated] };
      }
      if (compact.startsWith('INSERT INTO quality_document_blocks')) {
        const id = `block-${state.blockId++}`;
        const block = {
          id,
          store_id: params[0],
          collection_id: params[1],
          chapter_id: params[2],
          block_type: params[3],
          position: params[4],
          title: params[5],
          content: JSON.parse(params[6]),
          is_visible: params[7],
        };
        state.blocks.set(id, block);
        return { rows: [block] };
      }
      if (compact.startsWith('DELETE FROM quality_document_blocks')) {
        const block = state.blocks.get(params[0]);
        if (block && block.store_id === params[1]) state.blocks.delete(params[0]);
        return { rows: [] };
      }
      if (compact.startsWith('UPDATE quality_documentation_sections') && compact.includes('content_html = $3') && compact.includes('content_text = $4')) {
        const before = state.sections.get(params[0]);
        const after = { ...before, content_html: params[2], content_text: params[3] };
        state.sections.set(params[0], after);
        return { rows: [after] };
      }
      if (compact.startsWith('UPDATE quality_documentation_sections')) {
        const sectionId = params[0];
        if (sectionId === failSectionId) throw new Error('Erreur metier chapitre');
        const before = state.sections.get(sectionId);
        const after = {
          ...before,
          parent_id: params[2],
          section_type: params[3],
          code: params[4],
          title: params[5],
          content_html: params[6],
          content_text: params[7],
          status: params[9],
          version: params[10],
        };
        state.sections.set(sectionId, after);
        return { rows: [after] };
      }
      if (compact.startsWith('INSERT INTO quality_documentation_versions')) {
        const version = { id: `version-${state.versions.length + 1}`, section_id: params[0] };
        state.versions.unshift(version);
        return { rows: [version] };
      }
      if (compact.startsWith('UPDATE quality_documentation_versions')) {
        return { rows: [] };
      }
      if (compact.includes('FROM quality_documentation_versions')) {
        return { rows: state.versions.filter((version) => version.section_id === params[1]) };
      }
      if (compact.startsWith('INSERT INTO quality_document_tables')) {
        const table = {
          id: `table-${state.tableId++}`,
          store_id: params[0],
          collection_id: params[1],
          section_id: params[2],
          block_id: params[3],
          title: params[4],
          table_type: params[5],
          schema_version: 1,
          table_data: JSON.parse(params[6]),
        };
        state.tables.set(table.id, table);
        return { rows: [table] };
      }
      if (compact.includes('FROM quality_document_tables')) {
        return { rows: [...state.tables.values()].filter((table) => table.store_id === params[0] && table.section_id === params[1]) };
      }
      if (compact.includes('FROM quality_document_diagrams') || compact.includes('FROM quality_documentation_attachments')) {
        return { rows: [] };
      }
      if (compact.startsWith('INSERT INTO quality_event_logs')) return { rows: [{ id: 'event-1' }] };
      throw new Error(`Requete non simulee: ${compact}`);
    },
    release() {},
  };

  return {
    state,
    async connect() {
      return client;
    },
    async query(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      if (compact.startsWith('INSERT INTO agent_tool_audit_logs')) {
        state.auditStarted = true;
        return { rows: [{ id: 'audit-1' }] };
      }
      if (compact.startsWith('UPDATE agent_tool_audit_logs')) {
        state.auditCompleted = true;
        return { rows: [] };
      }
      if (compact.includes('FROM quality_documentation_collections')) {
        return { rows: [] };
      }
      if (compact.startsWith('UPDATE agent_pending_actions')) {
        state.failedMarked = true;
        return { rows: [] };
      }
      return client.query(sql, params);
    },
  };
}

function comparableSection(section) {
  return {
    id: section.id,
    content_html: section.content_html,
    content_text: section.content_text,
    status: section.status,
    version: section.version,
  };
}

async function main() {
  assert.equal(payloadHash({ a: 1, b: { c: null, d: [2, 1] } }), payloadHash({ b: { d: [2, 1], c: undefined }, a: 1 }), 'hash canonique attendu');

  const actions = listExecutableActions();
  const qualityAction = actions.find((action) => action.action_type === 'quality.documentation.apply_section_updates');
  assert(qualityAction, 'action qualite absente');
  assert.equal(qualityAction.permissions_required.includes('mcp.execute'), true, 'mcp.execute doit etre expose');
  assert.equal(qualityAction.permissions_required.includes('quality.documentation.edit'), true, 'permission qualite doit etre exposee');
  assert(qualityAction.payload_schema?.properties?.updates, 'schema updates doit etre expose');
  assert.equal(qualityAction.example?.action_type, 'quality.documentation.apply_section_updates', 'exemple canonique attendu');

  const validPayload = {
    updates: [{ section_id: 'section-1', content_html: '<p>Nouveau</p>' }],
  };
  const createCanonicalDb = makeCreateDb();
  const canonical = await createExecutablePendingAction({
    db: createCanonicalDb,
    context: makeContext(),
    input: { action_type: 'quality.documentation.apply_section_updates', summary: 'Test canonique', payload: validPayload },
  });
  assert.equal(canonical.action_type, 'quality.documentation.apply_section_updates', 'type canonique accepte attendu');
  assert.equal(createCanonicalDb.calls[0].params[2], 'quality.documentation.apply_section_updates', 'type canonique conserve en base');

  const createAliasDb = makeCreateDb();
  const alias = await createExecutablePendingAction({
    db: createAliasDb,
    context: makeContext(),
    input: { action_type: 'versioned_update', summary: 'Test alias', payload: validPayload },
  });
  assert.equal(alias.action_type, 'quality.documentation.apply_section_updates', 'alias normalise attendu');
  assert.equal(createAliasDb.calls[0].params[2], 'quality.documentation.apply_section_updates', 'alias doit etre stocke en type canonique');

  let refused = false;
  try {
    await createExecutablePendingAction({
      db: { query: async () => ({ rows: [] }) },
      context: makeContext(),
      input: { action_type: 'unknown.action', summary: 'Test', payload: {} },
    });
  } catch (error) {
    refused = error.status === 400;
  }
  assert.equal(refused, true, 'une action inconnue doit etre refusee');

  refused = false;
  try {
    await createExecutablePendingAction({
      db: makeCreateDb(),
      context: makeContext(),
      input: { action_type: 'quality_section_update', summary: 'Payload invalide', payload: { section_id: 'section-1', content_html: '<p>Non lot</p>' } },
    });
  } catch (error) {
    refused = error.status === 400 && error.message.includes('updates');
  }
  assert.equal(refused, true, 'payload qualite sans updates doit etre refuse');

  const readResult = await executeAgentTool({
    db: makePool(),
    name: 'list_quality_documentation',
    input: {},
    context: {
      store_id: 'store-1',
      trusted_mode: true,
      user_permissions: [],
      agent_permissions: [],
    },
  });
  assert.equal(readResult.ok, true, 'lecture documentaire trusted sans permissions attendue');

  const previousTrustedEnv = process.env.ALTA_AGENT_TRUSTED_MODE;
  process.env.ALTA_AGENT_TRUSTED_MODE = 'true';
  const envTrustedRead = await executeAgentTool({
    db: makePool(),
    name: 'list_quality_documentation',
    input: {},
    context: {
      store_id: 'store-1',
      user_permissions: [],
      agent_permissions: [],
    },
  });
  if (previousTrustedEnv === undefined) delete process.env.ALTA_AGENT_TRUSTED_MODE;
  else process.env.ALTA_AGENT_TRUSTED_MODE = previousTrustedEnv;
  assert.equal(envTrustedRead.ok, true, 'lecture documentaire trusted via env attendue');

  const trustedDirectPool = makePool();
  const trustedDirectResult = await executeAgentTool({
    db: trustedDirectPool,
    name: 'quality.documentation.apply_section_updates',
    input: validPayload,
    context: {
      store_id: 'store-1',
      trusted_mode: true,
      user_permissions: [],
      agent_permissions: [],
    },
  });
  assert.equal(trustedDirectResult.ok, true, 'modification documentaire trusted sans permissions attendue');
  assert.equal(trustedDirectResult.data.execution_result.modified_count, 1, 'un chapitre modifie attendu');
  assert.equal(trustedDirectPool.state.versions.length, 1, 'version creee attendue');
  assert.equal(trustedDirectPool.state.auditStarted, true, 'audit demarre attendu');
  assert.equal(trustedDirectPool.state.auditCompleted, true, 'audit complete attendu');

  refused = false;
  try {
    await executeExecutablePendingAction({
      dbPool: makePool(),
      context: makeContext({ user_permissions: ['quality.documentation.edit'], agent_permissions: ['mcp.execute', 'quality.documentation.edit'] }),
      input: { id: 'pending-1', confirmation: 'human_confirmed' },
    });
  } catch (error) {
    refused = error.status === 403 && error.message.includes('mcp.execute');
  }
  assert.equal(refused, true, 'mcp.execute doit etre obligatoire');

  refused = false;
  try {
    await executeExecutablePendingAction({
      dbPool: makePool(),
      context: makeContext({ user_permissions: ['mcp.execute'], agent_permissions: ['mcp.execute', 'quality.documentation.edit'] }),
      input: { id: 'pending-1', confirmation: 'human_confirmed' },
    });
  } catch (error) {
    refused = error.status === 403 && error.message.includes('quality.documentation.edit');
  }
  assert.equal(refused, true, 'quality.documentation.edit doit etre obligatoire cote utilisateur');

  refused = false;
  try {
    await executeExecutablePendingAction({
      dbPool: makePool(),
      context: makeContext({ user_permissions: ['mcp.execute'], agent_permissions: ['mcp.execute'] }),
      input: { id: 'pending-1', confirmation: 'human_confirmed' },
    });
  } catch (error) {
    refused = error.status === 403 && error.message.includes('quality.documentation.edit');
  }
  assert.equal(refused, true, 'quality.documentation.edit doit etre obligatoire cote agent');

  refused = false;
  try {
    await executeExecutablePendingAction({
      dbPool: makePool(),
      context: makeContext(),
      input: { id: 'pending-1' },
    });
  } catch (error) {
    refused = error.status === 400 && error.message.includes('confirmation=human_confirmed');
  }
  assert.equal(refused, true, 'confirmation explicite obligatoire');

  refused = false;
  try {
    await executeExecutablePendingAction({
      dbPool: makePool({ pending: makePending({ status: 'executed' }) }),
      context: makeContext(),
      input: { id: 'pending-1', confirmation: 'human_confirmed' },
    });
  } catch (error) {
    refused = error.status === 409;
  }
  assert.equal(refused, true, 'une double execution doit etre refusee');

  const trustedBadHashPool = makePool({ pending: makePending({ payload_hash: 'bad-hash' }) });
  const trustedBadHash = await executeExecutablePendingAction({
    dbPool: trustedBadHashPool,
    context: makeContext({ trusted_mode: true, user_permissions: [], agent_permissions: [] }),
    input: { id: 'pending-1' },
  });
  assert.equal(trustedBadHash.execution_result.modified_count, 2, 'trusted doit ignorer empreinte invalide historique');

  refused = false;
  try {
    await executeExecutablePendingAction({
      dbPool: makePool({ pending: makePending({ store_id: 'other-store' }) }),
      context: makeContext({ store_id: 'store-1', trusted_mode: true }),
      input: { id: 'pending-1' },
    });
  } catch (error) {
    refused = error.status === 404;
  }
  assert.equal(refused, true, 'store_id autre magasin doit etre isole');

  const pool = makePool();
  const result = await executeExecutablePendingAction({
    dbPool: pool,
    context: makeContext(),
    input: { id: 'pending-1', confirmation: 'human_confirmed' },
  });
  assert.equal(pool.state.committed, true, 'transaction commit attendue');
  assert.equal(result.execution_result.modified_count, 2, 'deux chapitres doivent etre modifies');
  assert.equal(pool.state.versions.length, 2, 'une version par chapitre doit etre creee');
  assert(pool.state.statusUpdates.includes('executing'), 'statut executing attendu');
  assert(pool.state.statusUpdates.includes('executed'), 'statut executed attendu');

  const failingPool = makePool({ failSectionId: 'section-2' });
  refused = false;
  try {
    await executeExecutablePendingAction({
      dbPool: failingPool,
      context: makeContext(),
      input: { id: 'pending-1', confirmation: 'human_confirmed' },
    });
  } catch (error) {
    refused = error.message === 'Erreur metier chapitre';
  }
  assert.equal(refused, true, 'erreur metier attendue');
  assert.equal(failingPool.state.rolledBack, true, 'rollback attendu sur erreur metier');
  assert.equal(failingPool.state.failedMarked, true, 'pending action doit etre marquee failed');

  const directPool = makePool();
  const direct = await executeExecutableActionDirect({
    dbPool: directPool,
    context: makeContext({ trusted_mode: true, user_permissions: [], agent_permissions: [] }),
    actionType: 'quality.documentation.apply_section_updates',
    payload: validPayload,
  });
  assert.equal(direct.execution_result.modified_count, 1, 'execution directe allowlistee attendue');
  assert.equal(direct.execution_result.modified_sections[0].version_before, '1.0', 'version avant attendue');
  assert.equal(direct.execution_result.modified_sections[0].version_after, '1.0', 'version apres conservee attendue');
  assert.equal(direct.execution_result.modified_sections[0].status, 'draft', 'statut brouillon attendu');
  assert(direct.execution_result.modified_sections[0].version_behavior.includes('Modification de brouillon'), 'note version brouillon attendue');

  const servicePool = makePool();
  const mcpPool = makePool();
  const serviceClient = await servicePool.connect();
  const serviceSection = await qualityDocumentation.updateSection(
    serviceClient,
    'store-1',
    'section-1',
    'user-1',
    {
      content_html: '<p>Comparaison service</p>',
      change_summary: 'Comparaison service normal',
    }
  );
  const mcpResult = await executeExecutableActionDirect({
    dbPool: mcpPool,
    context: makeContext({ trusted_mode: true, user_permissions: [], agent_permissions: [] }),
    actionType: 'quality.documentation.apply_section_updates',
    payload: {
      updates: [{
        section_id: 'section-1',
        content_html: '<p>Comparaison service</p>',
        change_summary: 'Comparaison service normal',
      }],
    },
  });
  const mcpSection = mcpPool.state.sections.get('section-1');
  assert.deepEqual(
    comparableSection(mcpSection),
    comparableSection(serviceSection),
    `service normal et action MCP doivent produire la meme section: ${JSON.stringify({ service: comparableSection(serviceSection), mcp: comparableSection(mcpSection) })}`
  );
  assert.equal(servicePool.state.versions.length, mcpPool.state.versions.length, 'meme nombre de versions attendu');
  assert.equal(servicePool.state.versions.length, 1, 'historique version attendu');
  serviceClient.release();

  const blockPool = makePool();
  const blockResult = await executeExecutableActionDirect({
    dbPool: blockPool,
    context: makeContext({ trusted_mode: true, user_permissions: [], agent_permissions: [] }),
    actionType: 'quality.documentation.update_text_block',
    payload: {
      block_id: 'block-1',
      html: '<p>Adresse e-mail : commercial@altamaree.fr</p>',
    },
  });
  const updatedBlock = blockPool.state.blocks.get('block-1');
  const updatedSection = blockPool.state.sections.get('section-1');
  assert.equal(blockResult.execution_result.block.content.html.includes('commercial@altamaree.fr'), true, 'bloc retourne mis a jour attendu');
  assert.equal(updatedBlock.content.html.includes('commercial@altamaree.fr'), true, 'bloc rich_text mis a jour attendu');
  assert.equal(updatedSection.content_html.includes('commercial@altamaree.fr'), true, 'content_html miroir mis a jour attendu');
  const pdfHtml = buildHtml({
    collection: { title: 'Test', version: '1.0' },
    sections: [updatedSection],
    blocks: [updatedBlock],
    missing_items: [],
    attachments: [],
  }, { company_name: 'ALTA MAREE' }, {});
  assert.equal(pdfHtml.includes('commercial@altamaree.fr'), true, 'HTML PDF doit utiliser le bloc a jour');

  const publicBlockPool = makePool();
  const publicContext = makeContext({
    trusted_mode: true,
    user_permissions: ['agent.use', 'mcp.execute', 'quality.documentation.read', 'quality.documentation.edit'],
    agent_permissions: ['agent.use', 'mcp.execute', 'quality.documentation.read', 'quality.documentation.edit'],
  });
  const initialPublicBlocks = await executeAgentTool({
    db: publicBlockPool,
    context: publicContext,
    name: 'get_quality_section_blocks',
    input: { section_id: 'section-1' },
  });
  assert.equal(initialPublicBlocks.data.blocks.length, 1, 'nombre initial de blocs attendu');
  assert.equal(initialPublicBlocks.data.blocks[0].id, 'block-1', 'bloc initial attendu');
  assert.equal(initialPublicBlocks.data.blocks[0].content.html, '<p>Ancien bloc</p>', 'contenu initial inchange attendu');

  const textToolResult = await executeAgentTool({
    db: publicBlockPool,
    context: publicContext,
    name: 'quality.documentation.add_text_block',
    input: { section_code: 'T1-C1', html: '<p>Bloc test MCP public</p>', position: 20 },
    confirmed: true,
  });
  const afterTextAdd = await executeAgentTool({
    db: publicBlockPool,
    context: publicContext,
    name: 'get_quality_section_blocks',
    input: { section_id: 'section-1' },
  });
  assert.equal(afterTextAdd.data.blocks.length, 2, 'add_text_block doit creer un deuxieme bloc');
  assert.equal(afterTextAdd.data.blocks[0].content.html, '<p>Ancien bloc</p>', 'add_text_block ne doit pas modifier le bloc initial');

  const tableToolResult = await executeAgentTool({
    db: publicBlockPool,
    context: publicContext,
    name: 'quality.documentation.add_table_block',
    input: {
      chapter_id: 'section-1',
      title: 'Table test MCP public',
      position: 30,
      columns: ['Champ', 'Valeur'],
      rows: [['Test', 'OK']],
    },
    confirmed: true,
  });
  const textBlockId = textToolResult.data.execution_result.block.id;
  const tableBlockId = tableToolResult.data.execution_result.block.id;
  const listedBlocks = await executeAgentTool({
    db: publicBlockPool,
    context: publicContext,
    name: 'get_quality_section_blocks',
    input: { section_id: 'section-1' },
  });
  const blocks = listedBlocks.data.blocks;
  assert.equal(blocks.length, 3, 'add_table_block doit creer un troisieme bloc');
  assert.equal(new Set(blocks.map((block) => block.id)).size, 3, 'trois UUID de blocs distincts attendus');
  assert(blocks.some((block) => block.id === textBlockId && block.block_type === 'rich_text'), 'bloc texte public relu attendu');
  assert(blocks.some((block) => block.id === tableBlockId && block.block_type === 'document_table'), 'bloc tableau public relu attendu');
  assert.deepEqual(blocks.map((block) => block.id), ['block-1', textBlockId, tableBlockId], 'ordre blocs public attendu');
  assert.deepEqual(blocks.map((block) => block.block_type), ['rich_text', 'rich_text', 'document_table'], 'types blocs publics attendus');
  assert.deepEqual(blocks.map((block) => Number(block.position)), [10, 20, 30], 'positions blocs publiques attendues');
  assert.equal(blocks[0].content.html, '<p>Ancien bloc</p>', 'le bloc initial reste inchange apres creations');
  const tableBlock = blocks.find((block) => block.id === tableBlockId);
  assert.deepEqual(tableBlock.table.table_data.columns.map((column) => column.label), ['Champ', 'Valeur'], 'headers tableau MCP attendus');
  assert.deepEqual(tableBlock.table.table_data.rows[0].cells, { champ: 'Test', valeur: 'OK' }, 'premiere ligne tableau MCP attendue');
  const publicPdfHtml = buildHtml({
    collection: { title: 'Test', version: '1.0' },
    sections: [publicBlockPool.state.sections.get('section-1')],
    blocks,
    missing_items: [],
    attachments: [],
  }, { company_name: 'ALTA MAREE' }, {});
  assert.equal(publicPdfHtml.includes('Bloc test MCP public'), true, 'PDF public doit contenir le bloc texte ajoute');
  assert.equal(publicPdfHtml.includes('Champ'), true, 'PDF public doit contenir header Champ');
  assert.equal(publicPdfHtml.includes('Valeur'), true, 'PDF public doit contenir header Valeur');
  assert.equal(publicPdfHtml.includes('Test'), true, 'PDF public doit contenir cellule Test');
  assert.equal(publicPdfHtml.includes('OK'), true, 'PDF public doit contenir cellule OK');

  let invalidTableRefused = false;
  try {
    await executeAgentTool({
      db: publicBlockPool,
      context: publicContext,
      name: 'quality.documentation.add_table_block',
      input: { chapter_id: 'section-1', columns: ['Champ', 'Valeur'], rows: [['Test']] },
      confirmed: true,
    });
  } catch (error) {
    invalidTableRefused = error.status === 400 && /2 cellule/.test(error.message);
  }
  assert.equal(invalidTableRefused, true, 'add_table_block doit refuser une ligne au mauvais nombre de cellules');

  let structuredTextRefused = false;
  try {
    await executeAgentTool({
      db: publicBlockPool,
      context: publicContext,
      name: 'quality.documentation.update_text_block',
      input: { block_id: 'block-1', html: '<table><tbody><tr><td>Champ</td><td>Valeur</td></tr></tbody></table>' },
      confirmed: true,
    });
  } catch (error) {
    structuredTextRefused = error.status === 400 && /add_table_block/.test(error.message);
  }
  assert.equal(structuredTextRefused, true, 'update_text_block doit refuser un tableau HTML structure');

  const deleteTableResult = await executeAgentTool({
    db: publicBlockPool,
    context: publicContext,
    name: 'quality.documentation.delete_block',
    input: { block_id: tableBlockId },
    confirmed: true,
  });
  assert.equal(deleteTableResult.data.mode, 'executed', 'suppression tableau executee attendue');
  const deleteTextResult = await executeAgentTool({
    db: publicBlockPool,
    context: publicContext,
    name: 'quality.documentation.delete_block',
    input: { block_id: textBlockId },
    confirmed: true,
  });
  assert.equal(deleteTextResult.data.mode, 'executed', 'suppression texte executee attendue');
  const afterDelete = await executeAgentTool({
    db: publicBlockPool,
    context: publicContext,
    name: 'get_quality_section_blocks',
    input: { section_id: 'section-1' },
  });
  assert.equal(afterDelete.data.blocks.some((block) => block.id === textBlockId || block.id === tableBlockId), false, 'blocs de test supprimes attendus');

  const forbiddenNames = new Set(['execute_sql', 'call_any_route', 'delete_anything', 'update_any_table', 'run_shell_command', 'read_env', 'read_backend_env']);
  const names = new Set(listAgentTools().map((tool) => tool.name));
  for (const name of forbiddenNames) {
    assert.equal(names.has(name), false, `outil dangereux interdit present: ${name}`);
  }

  console.log(JSON.stringify({ ok: true }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
