const assert = require('assert');
const { payloadHash } = require('../services/agent/agentPendingActionService');
const {
  createExecutablePendingAction,
  executeExecutablePendingAction,
  listExecutableActions,
} = require('../services/agent/agentActionOrchestratorService');
const {
  createArticle,
  normalizeAgentArticleCreatePayload,
} = require('../services/articleCreationService');
const { getAgentTool } = require('../services/agent/agentToolRegistry');
const mcpRouter = require('../routes/mcpServer');

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

function validPayload(overrides = {}) {
  return {
    plu: 'BAR-SAUVAGE-12KG',
    designation: 'Bar sauvage 1/2 kg',
    unit: 'kg',
    article_category: 'product',
    family_code: 'MAREE',
    vat_rate: 5.5,
    ...overrides,
  };
}

function makePending(payload, overrides = {}) {
  return {
    id: 'pending-1',
    store_id: 'store-1',
    status: 'awaiting_confirmation',
    action_type: 'articles.create',
    final_tool_name: 'articles.create',
    frozen_payload: payload,
    payload_hash: payloadHash(payload),
    ...overrides,
  };
}

function makeCreateDb() {
  return {
    async query(sql, params = []) {
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
          payload_hash: params[10],
        }],
      };
    },
  };
}

function makePool({ pending = null, duplicate = null, badDepartment = false } = {}) {
  const state = {
    committed: false,
    rolledBack: false,
    failedMarked: false,
    statusUpdates: [],
    nextArticleId: 'article-new',
    nextArticleDepartmentId: 'article-dept-new',
    departments: new Map([['dept-1', { id: 'dept-1', store_id: 'store-1' }]]),
    sectors: new Map([['MAREE', { id: 'sector-1' }]]),
    article: null,
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
      if (compact.startsWith('UPDATE agent_pending_actions') && compact.includes("status = 'executed'")) {
        state.statusUpdates.push('executed');
        return { rows: [{ ...pending, status: 'executed', execution_result: JSON.parse(params[2]) }] };
      }
      if (compact.startsWith('UPDATE agent_pending_actions') && compact.includes("status = 'executing'")) {
        state.statusUpdates.push('executing');
        return { rows: [{ ...pending, status: 'executing' }] };
      }
      if (compact.includes('FROM departments') && compact.includes('WHERE id = $1')) {
        if (badDepartment) return { rows: [] };
        const department = state.departments.get(params[0]);
        return { rows: department && department.store_id === params[1] ? [department] : [] };
      }
      if (compact.includes('FROM departments') && compact.includes('ORDER BY created_at ASC')) {
        return { rows: [state.departments.get('dept-1')] };
      }
      if (
        compact.includes('FROM articles')
        && compact.includes('WHERE store_id = $1')
        && compact.includes('AND plu = $2')
      ) {
        return { rows: duplicate && duplicate.plu === params[1] ? [duplicate] : [] };
      }
      if (compact.includes('generate_series') && compact.includes('product_plu')) {
        return { rows: [{ plu: '3895' }] };
      }
      if (compact.includes('FROM articles') && compact.includes('lower(trim')) {
        return { rows: duplicate ? [duplicate] : [] };
      }
      if (compact.includes('FROM department_sectors')) {
        return { rows: state.sectors.has(params[1]) ? [state.sectors.get(params[1])] : [] };
      }
      if (compact.startsWith('INSERT INTO articles')) {
        state.article = {
          id: state.nextArticleId,
          store_id: params[0],
          plu: params[1],
          designation: params[2],
          ean: params[3],
          unit: params[4],
          article_category: params[5],
          is_active: params[6],
          source_origin: params[7],
          storage_temperature_min: params[8],
          storage_temperature_max: params[9],
          storage_instruction: params[10],
        };
        return { rows: [{ id: state.nextArticleId }] };
      }
      if (compact.startsWith('INSERT INTO article_departments')) {
        state.article.department_id = params[1];
        state.article.department_sector_id = params[2];
        state.article.display_name = params[3];
        state.article.purchase_unit = params[4];
        state.article.stock_unit = params[5];
        state.article.sale_unit = params[6];
        state.article.vat_rate = params[7];
        state.article.purchase_price_ex_vat = params[8];
        state.article.sale_price_ex_vat = params[9];
        state.article.sale_price_inc_vat = params[10];
        return { rows: [{ id: state.nextArticleDepartmentId }] };
      }
      if (compact.startsWith('INSERT INTO article_department_metadata')) {
        state.article.category = params[1];
        state.article.latin_name = params[2];
        state.article.fao_zone = params[3];
        state.article.sous_zone = params[4];
        state.article.engin = params[5];
        state.article.allergenes = params[6];
        return { rows: [] };
      }
      if (compact.includes('FROM articles a') && compact.includes('WHERE a.id = $1')) {
        return { rows: state.article && state.article.id === params[0] && state.article.store_id === params[1]
          ? [{ ...state.article, article_department_id: state.nextArticleDepartmentId, family_code: 'MAREE', family_name: 'Maree' }]
          : [] };
      }
      throw new Error(`Unexpected SQL: ${compact}`);
    },
    release() {},
  };

  return {
    state,
    async query(sql) {
      state.calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params: [] });
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

function assertThrowsStatus(fn, status, pattern) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.status, status);
    if (pattern) assert(pattern.test(error.message), error.message);
    return;
  }
  throw new Error('Exception attendue');
}

async function assertRejectsStatus(promiseFactory, status, pattern) {
  try {
    await promiseFactory();
  } catch (error) {
    assert.equal(error.status, status);
    if (pattern) assert(pattern.test(error.message), error.message);
    return error;
  }
  throw new Error('Rejet attendu');
}

async function main() {
  const action = listExecutableActions().find((item) => item.name === 'articles.create');
  assert(action, 'articles.create absent des actions executables');
  assert(action.aliases.includes('articles_create'), 'alias articles_create absent');
  assert.deepEqual(action.permissions_required, ['mcp.execute', 'articles.write']);
  assert.equal(action.preview_required, true);

  assertThrowsStatus(() => normalizeAgentArticleCreatePayload({ designation: 'Sans PLU' }), 400, /plu et designation/);
  assertThrowsStatus(() => normalizeAgentArticleCreatePayload(validPayload({ article_category: 'bad' })), 400, /Cat.gorie article invalide/);
  assertThrowsStatus(() => normalizeAgentArticleCreatePayload(validPayload({ store_id: 'store-2' })), 400, /non autorisee/);

  const createdDirectPool = makePool();
  const directClient = await createdDirectPool.connect();
  const created = await createArticle(directClient, {
    storeId: 'store-1',
    userId: 'user-1',
    payload: validPayload({ unit: undefined, vat_rate: undefined, is_active: undefined }),
    sourceOrigin: 'manual',
  });
  assert.equal(created.id, 'article-new');
  assert.equal(created.article.unit, 'kg');
  assert.equal(Number(created.article.vat_rate), 5.5);
  assert.equal(created.article.is_active, true);
  assert.equal(created.defaults_applied.unit, 'kg');

  await assertRejectsStatus(async () => createArticle(await makePool({ badDepartment: true }).connect(), {
    storeId: 'store-1',
    userId: 'user-1',
    payload: validPayload({ department_id: 'dept-other' }),
  }), 400, /Service invalide/);

  const duplicateArticle = { id: 'article-existing', plu: 'BAR-SAUVAGE-12KG', designation: 'Bar sauvage 1/2 kg' };
  const duplicateError = await assertRejectsStatus(async () => createArticle(await makePool({ duplicate: duplicateArticle }).connect(), {
    storeId: 'store-1',
    userId: 'user-1',
    payload: validPayload(),
  }), 409, /PLU BAR-SAUVAGE-12KG/);
  assert.equal(duplicateError.duplicate.id, 'article-existing');
  assert.equal(duplicateError.next_plu, '3895');

  const pendingPayload = validPayload();
  const pending = makePending(pendingPayload);
  const pool = makePool({ pending });
  const executed = await executeExecutablePendingAction({
    dbPool: pool,
    context: makeContext(),
    input: { id: 'pending-1', confirmation: 'human_confirmed' },
  });
  assert.equal(pool.state.committed, true);
  assert.deepEqual(pool.state.statusUpdates, ['executing', 'executed']);
  assert.equal(executed.execution_result.article_id, 'article-new');
  assert.equal(executed.execution_result.article.designation, 'Bar sauvage 1/2 kg');

  await assertRejectsStatus(async () => executeExecutablePendingAction({
    dbPool: makePool({ pending }),
    context: makeContext({ user_permissions: ['agent.use', 'articles.write'], agent_permissions: ['agent.use', 'articles.write'] }),
    input: { id: 'pending-1', confirmation: 'human_confirmed' },
  }), 403, /mcp.execute/);

  await assertRejectsStatus(async () => executeExecutablePendingAction({
    dbPool: makePool({ pending }),
    context: makeContext({ user_permissions: ['agent.use', 'mcp.execute'], agent_permissions: ['agent.use', 'mcp.execute'] }),
    input: { id: 'pending-1', confirmation: 'human_confirmed' },
  }), 403, /articles.write/);

  const createDb = makeCreateDb();
  const prepared = await createExecutablePendingAction({
    db: createDb,
    context: makeContext(),
    input: {
      action_type: 'articles.create',
      summary: 'Creer Bar sauvage 1/2 kg',
      payload: pendingPayload,
    },
  });
  assert.equal(prepared.action.name, 'articles.create');
  assert.equal(prepared.payload.designation, 'Bar sauvage 1/2 kg');

  const prepareTool = getAgentTool('prepare_article_create');
  const preparedToolResult = await prepareTool.execute({
    context: makeContext(),
    input: pendingPayload,
    tool: prepareTool,
  });
  assert.equal(preparedToolResult.data.action_type, 'articles.create');
  assert.equal(preparedToolResult.data.prepared_action.requires_confirmation, true);

  const publicTools = mcpRouter._private.buildPublicMcpTools();
  const alias = publicTools.find((tool) => tool.name === 'articles_create');
  assert(alias, 'articles_create absent du catalogue MCP public');
  assert.equal(alias._meta.internalToolName, 'prepare_article_create');
  assert.equal(alias._meta.requiredPermission, 'articles.write');

  console.log(JSON.stringify({
    ok: true,
    action: 'articles.create',
    public_alias: 'articles_create',
    created_article_id: executed.execution_result.article_id,
    no_real_article_created: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
