const assert = require('assert');
const { searchArticles } = require('../services/agentToolsService');
const { getAgentTool } = require('../services/agent/agentToolRegistry');
const {
  createExecutablePendingAction,
  executeExecutablePendingAction,
  listExecutableActions,
} = require('../services/agent/agentActionOrchestratorService');
const { payloadHash } = require('../services/agent/agentPendingActionService');

function makeContext(overrides = {}) {
  return {
    store_id: 'store-1',
    user_id: 'user-1',
    role: 'admin',
    user_permissions: ['agent.use', 'mcp.execute', 'articles.read', 'articles.write'],
    agent_permissions: ['agent.use', 'mcp.execute', 'articles.read', 'articles.write'],
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
          summary: params[3],
          payload: JSON.parse(params[4]),
          frozen_payload: JSON.parse(params[4]),
          domain: params[5],
          module: params[5],
          final_tool_name: params[6],
          impact_summary: params[7],
          target_objects: JSON.parse(params[8]),
          payload_hash: params[10],
        }],
      };
    },
  };
}

function makePending(payload, overrides = {}) {
  return {
    id: 'pending-1',
    store_id: 'store-1',
    status: 'awaiting_confirmation',
    action_type: 'articles.update_storage_conditions',
    final_tool_name: 'articles.update_storage_conditions',
    frozen_payload: payload,
    payload_hash: payloadHash(payload),
    ...overrides,
  };
}

function makeArticle(overrides = {}) {
  return {
    id: 'article-1',
    store_id: 'store-1',
    plu: 'ART-001',
    designation: 'Huitres speciales',
    article_category: 'product',
    storage_temperature_min: null,
    storage_temperature_max: null,
    storage_instruction: null,
    ...overrides,
  };
}

function makePool({ pending, article = makeArticle() } = {}) {
  const state = {
    committed: false,
    rolledBack: false,
    failedMarked: false,
    statusUpdates: [],
    article: { ...article },
    calls: [],
  };

  const client = {
    async query(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      state.calls.push({ sql: compact, params });
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
      if (compact.startsWith('UPDATE agent_pending_actions') && compact.includes("status = 'executing'")) {
        state.statusUpdates.push('executing');
        return { rows: [{ ...pending, status: 'executing' }] };
      }
      if (compact.startsWith('UPDATE agent_pending_actions') && compact.includes("status = 'executed'")) {
        state.statusUpdates.push('executed');
        return { rows: [{ ...pending, status: 'executed', execution_result: JSON.parse(params[2]) }] };
      }
      if (compact.includes('FROM articles') && compact.includes('WHERE id = $1 AND store_id = $2')) {
        const row = state.article.id === params[0] && state.article.store_id === params[1] ? state.article : null;
        return { rows: row ? [{ ...row }] : [] };
      }
      if (compact.startsWith('UPDATE articles')) {
        if (state.article.id === params[0] && state.article.store_id === params[1]) {
          state.article.storage_temperature_min = params[2];
          state.article.storage_temperature_max = params[3];
          state.article.storage_instruction = params[4];
        }
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${compact}`);
    },
    release() {},
  };

  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (sql.includes('UPDATE agent_pending_actions')) {
        state.failedMarked = true;
        return { rows: [] };
      }
      throw new Error(`Unexpected pool SQL: ${sql}`);
    },
    async connect() {
      return client;
    },
  };
}

async function testArticleSearchExposesStorageFields() {
  let capturedSql = '';
  const db = {
    async query(sql) {
      capturedSql = sql;
      return {
        rows: [{
          id: 'article-1',
          designation: 'Huitres',
          article_category: 'product',
          storage_temperature_min: 0,
          storage_temperature_max: 2,
          storage_instruction: 'Conserver vivant',
        }],
      };
    },
  };
  const result = await searchArticles(db, 'store-1', { query: 'article-1', limit: 1 });
  assert.equal(result.results[0].storage_temperature_min, 0, 'search_articles doit exposer min=0');
  assert.equal(result.results[0].storage_temperature_max, 2, 'search_articles doit exposer max=2');
  assert.equal(result.results[0].storage_instruction, 'Conserver vivant', 'search_articles doit exposer instruction');
  assert(capturedSql.includes('a.id'), 'search_articles/get_article_profile doit pouvoir chercher par id');
  assert(capturedSql.includes('a.storage_temperature_min'), 'search_articles doit selectionner storage_temperature_min');
  assert(capturedSql.includes('a.storage_temperature_max'), 'search_articles doit selectionner storage_temperature_max');
  assert(capturedSql.includes('a.storage_instruction'), 'search_articles doit selectionner storage_instruction');
}

async function testPrepareArticleUpdate() {
  const tool = getAgentTool('prepare_article_update');
  assert(tool, 'prepare_article_update manquant');
  assert.equal(tool.inputSchema.additionalProperties, false, 'prepare_article_update ne doit pas accepter de cles arbitraires');
  assert(tool.inputSchema.properties.changes.properties.storage_temperature_min, 'schema min manquant');
  assert(tool.inputSchema.properties.changes.properties.storage_temperature_max, 'schema max manquant');
  assert(tool.inputSchema.properties.changes.properties.storage_instruction, 'schema instruction manquant');

  const result = await tool.execute({
    context: makeContext(),
    input: {
      article_id: 'article-1',
      changes: {
        storage_temperature_min: 3,
        storage_temperature_max: 5,
        storage_instruction: 'Ce produit doit etre vendu vivant',
      },
    },
    tool,
  });
  assert.equal(result.data.action_type, 'articles.update_storage_conditions', 'action_type canonique attendu');
  assert.deepEqual(result.data.payload, {
    article_id: 'article-1',
    changes: {
      storage_temperature_min: 3,
      storage_temperature_max: 5,
      storage_instruction: 'Ce produit doit etre vendu vivant',
    },
  });
  assert(result.data.prepared_action.required_permissions.includes('mcp.execute'), 'mcp.execute requis');
  assert(result.data.prepared_action.required_permissions.includes('articles.write'), 'articles.write requis');

  let refused = false;
  try {
    await tool.execute({
      context: makeContext(),
      input: { article_id: 'article-1', changes: { storage_temperature_min: 5, storage_temperature_max: 3 } },
      tool,
    });
  } catch (error) {
    refused = error.status === 400 && error.message.includes('superieure');
  }
  assert.equal(refused, true, 'prepare_article_update doit refuser min > max');

  refused = false;
  try {
    await tool.execute({
      context: makeContext(),
      input: { article_id: 'article-1', article_category: 'service', changes: { storage_temperature_min: 3 } },
      tool,
    });
  } catch (error) {
    refused = error.status === 400 && error.message.includes('prepare_article_update');
  }
  assert.equal(refused, true, 'prepare_article_update doit refuser les cles racine arbitraires');

  refused = false;
  try {
    await createExecutablePendingAction({
      db: makeCreateDb(),
      context: makeContext(),
      input: {
        action_type: 'articles.update_storage_conditions',
        summary: 'Tentative champ interdit',
        payload: {
          article_id: 'article-1',
          article_category: 'service',
          changes: { storage_temperature_min: 3 },
        },
      },
    });
  } catch (error) {
    refused = error.status === 400 && error.message.includes('non autorisee');
  }
  assert.equal(refused, true, 'create_pending_action doit refuser les cles racine arbitraires');
}

async function testPendingCreationPreservesZero() {
  const db = makeCreateDb();
  const pending = await createExecutablePendingAction({
    db,
    context: makeContext(),
    input: {
      action_type: 'articles.update_storage_conditions',
      summary: 'Maj conservation 0/2',
      payload: {
        article_id: 'article-1',
        changes: {
          storage_temperature_min: 0,
          storage_temperature_max: 2,
        },
      },
    },
  });
  assert.equal(pending.frozen_payload.changes.storage_temperature_min, 0, 'pending action doit conserver min=0');
  assert.equal(pending.frozen_payload.changes.storage_temperature_max, 2, 'pending action doit conserver max=2');
}

async function testExecutionAndReread() {
  const payload = {
    article_id: 'article-1',
    changes: {
      storage_temperature_min: 3,
      storage_temperature_max: 5,
      storage_instruction: 'Ce produit doit etre vendu vivant',
    },
  };
  const pool = makePool({
    pending: makePending(payload),
    article: makeArticle({ article_category: 'seafood' }),
  });
  const result = await executeExecutablePendingAction({
    dbPool: pool,
    context: makeContext(),
    input: { id: 'pending-1', confirmation: 'human_confirmed' },
  });
  assert.equal(pool.state.committed, true, 'transaction doit etre committee');
  assert.equal(pool.state.rolledBack, false, 'transaction ne doit pas rollback');
  assert.equal(result.execution_result.article.article_category, 'seafood', 'article_category doit rester inchangee');
  assert.deepEqual(result.execution_result.after, {
    storage_temperature_min: 3,
    storage_temperature_max: 5,
    storage_instruction: 'Ce produit doit etre vendu vivant',
  });
  assert.equal(pool.state.article.article_category, 'seafood', 'la categorie Article ne doit pas etre modifiee');
}

async function testZeroTwoAndNullInstruction() {
  const payload = {
    article_id: 'article-1',
    changes: {
      storage_temperature_min: 0,
      storage_temperature_max: 2,
      storage_instruction: null,
    },
  };
  const pool = makePool({
    pending: makePending(payload),
    article: makeArticle({ article_category: 'packaging', storage_instruction: 'Ancienne consigne' }),
  });
  const result = await executeExecutablePendingAction({
    dbPool: pool,
    context: makeContext(),
    input: { id: 'pending-1', confirmation: 'human_confirmed' },
  });
  assert.equal(result.execution_result.after.storage_temperature_min, 0, 'min=0 doit rester 0');
  assert.equal(result.execution_result.after.storage_temperature_max, 2, 'max=2 attendu');
  assert.equal(result.execution_result.after.storage_instruction, null, 'instruction null explicite attendue');
  assert.equal(result.execution_result.article.article_category, 'packaging', 'categorie inchangee pour 0/2');
}

async function testStoreIsolation() {
  const payload = { article_id: 'article-1', changes: { storage_temperature_min: 3 } };
  const pool = makePool({
    pending: makePending(payload),
    article: makeArticle({ store_id: 'other-store' }),
  });
  let refused = false;
  try {
    await executeExecutablePendingAction({
      dbPool: pool,
      context: makeContext(),
      input: { id: 'pending-1', confirmation: 'human_confirmed' },
    });
  } catch (error) {
    refused = error.status === 404 && error.message.includes('Article introuvable');
  }
  assert.equal(refused, true, 'un Article hors magasin doit etre refuse');
  assert.equal(pool.state.committed, false, 'isolation magasin refusee sans commit');
  assert.equal(pool.state.rolledBack, true, 'isolation magasin doit rollback');
}

async function main() {
  const actions = listExecutableActions();
  const action = actions.find((item) => item.name === 'articles.update_storage_conditions');
  assert(action, 'articles.update_storage_conditions absent de list_executable_actions');
  assert(action.permissions_required.includes('mcp.execute'), 'mcp.execute doit etre requis');
  assert(action.permissions_required.includes('articles.write'), 'articles.write doit etre requis');
  assert.equal(action.payload_schema.additionalProperties, false, 'payload action ne doit pas accepter de cles arbitraires');
  assert.equal(action.payload_schema.properties.changes.additionalProperties, false, 'changes ne doit pas accepter de cles arbitraires');

  await testArticleSearchExposesStorageFields();
  await testPrepareArticleUpdate();
  await testPendingCreationPreservesZero();
  await testExecutionAndReread();
  await testZeroTwoAndNullInstruction();
  await testStoreIsolation();

  console.log(JSON.stringify({
    ok: true,
    tests: [
      'search_articles/get_article_profile exposes storage fields',
      'prepare_article_update creates articles.update_storage_conditions payload',
      'min/max 5/3 refused before pending action',
      'arbitrary root input keys refused by prepare_article_update',
      'arbitrary root payload keys refused before pending action',
      'pending action preserves 0/2',
      'confirmed execution persists 3/5/instruction and rereads article_category unchanged',
      'confirmed execution persists 0/2/null instruction and rereads article_category unchanged',
      'store isolation rejects cross-store article without commit',
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
