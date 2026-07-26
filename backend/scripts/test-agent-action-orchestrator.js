const assert = require('assert');
const { payloadHash } = require('../services/agent/agentPendingActionService');
const {
  createExecutablePendingAction,
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

function makePool({ pending = makePending(), failSectionId = null } = {}) {
  const state = {
    committed: false,
    rolledBack: false,
    failedMarked: false,
    statusUpdates: [],
    versions: [],
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
        return { rows: pending ? [pending] : [] };
      }
      if (compact.startsWith('UPDATE agent_pending_actions') && compact.includes("status = 'executed'")) {
        state.statusUpdates.push('executed');
        return { rows: [{ ...pending, status: 'executed', execution_result: JSON.parse(params[2]) }] };
      }
      if (compact.startsWith('UPDATE agent_pending_actions') && compact.includes("status = 'executing'")) {
        state.statusUpdates.push('executing');
        return { rows: [{ ...pending, status: 'executing' }] };
      }
      if (compact.includes('FROM quality_documentation_sections') && compact.includes('LIMIT 1')) {
        return { rows: state.sections.has(params[0]) ? [state.sections.get(params[0])] : [] };
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
      if (compact.includes('FROM quality_documentation_versions')) {
        return { rows: state.versions.filter((version) => version.section_id === params[1]) };
      }
      throw new Error(`Requete non simulee: ${compact}`);
    },
    release() {},
  };

  return {
    state,
    async connect() {
      return client;
    },
    async query(sql) {
      if (sql.replace(/\s+/g, ' ').trim().startsWith('UPDATE agent_pending_actions')) {
        state.failedMarked = true;
        return { rows: [] };
      }
      throw new Error('Pool query inattendue');
    },
  };
}

async function main() {
  const actions = listExecutableActions();
  assert(actions.some((action) => action.name === 'quality.documentation.apply_section_updates'), 'action qualite absente');

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

  console.log(JSON.stringify({ ok: true }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
