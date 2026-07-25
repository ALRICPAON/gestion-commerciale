const assert = require('assert');

const cashflow = require('../services/cashflow/service');
const { executeAgentTool, normalizeContext } = require('../services/agent/agentToolExecutor');
const { _private } = require('../services/ai/aiToolFirstAgentService');

function makeDb() {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(String(sql));
      if (String(sql).includes('agent_tool_audit_logs')) return { rows: [{ id: '00000000-0000-4000-8000-000000000101' }] };
      return { rows: [] };
    },
  };
}

async function expectForbidden(action, message) {
  let refused = false;
  try {
    await action();
  } catch (error) {
    refused = error.status === 403 && /Permission requise/.test(error.message);
  }
  assert.equal(refused, true, message);
}

async function main() {
  const normalized = normalizeContext({
    store_id: 'store-test',
    role: 'responsable',
    permissions: [],
    userPermissions: { 'cashflow.read': true },
    agentPermissions: ['cashflow.read'],
  });
  assert.deepEqual(normalized.user_permissions, ['cashflow.read']);
  assert.deepEqual(normalized.agent_permissions, ['cashflow.read']);

  let db = makeDb();
  const allowed = await executeAgentTool({
    db,
    name: 'search_sales',
    input: { query: 'CMD', limit: 1 },
    context: {
      store_id: 'store-test',
      user_id: 'user-test',
      role: 'responsable',
      user_permissions: ['sales.read'],
      agent_permissions: ['sales.read'],
      source: 'mcp',
    },
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.tool, 'search_sales');
  assert(db.calls.some((sql) => sql.includes('FROM sales_documents')), 'handler search_sales non appele');

  await expectForbidden(() => executeAgentTool({
    db: makeDb(),
    name: 'search_sales',
    input: { query: 'CMD' },
    context: {
      store_id: 'store-test',
      user_id: 'user-test',
      role: 'responsable',
      user_permissions: [],
      agent_permissions: ['sales.read'],
      source: 'mcp',
    },
  }), 'responsable sans permission utilisateur doit etre refuse');

  db = makeDb();
  const adminAllowed = await executeAgentTool({
    db,
    name: 'search_sales',
    input: { query: 'CMD', limit: 1 },
    context: {
      store_id: 'store-test',
      user_id: 'user-test',
      role: 'admin',
      user_permissions: [],
      agent_permissions: ['sales.read'],
      source: 'mcp',
    },
  });
  assert.equal(adminAllowed.ok, true);

  await expectForbidden(() => executeAgentTool({
    db: makeDb(),
    name: 'prepare_cashflow_plan',
    input: { days: 30 },
    context: {
      store_id: 'store-test',
      user_id: 'user-test',
      role: 'admin',
      user_permissions: [],
      agent_permissions: ['quality.read'],
      source: 'mcp',
    },
  }), 'ALTA_AGENT_PERMISSIONS doit restreindre un admin');

  const originalProjection = cashflow.buildCashflowProjection;
  cashflow.buildCashflowProjection = async () => ({
    period: { from: '2026-07-25', to: '2026-08-23' },
    opening_balance: 100,
    opening_balance_source: 'test',
    expected_customer_receipts: [],
    expected_supplier_payments: [],
    bank_accounts: [],
    data_sources: [{ source: 'Pennylane', name: 'pennylane_supplier_invoices' }],
    daily_forecast: [],
    closing_balance: 100,
    lowest_projected_balance: 100,
    lowest_projected_balance_date: '2026-07-25',
    risks: [],
    warnings: [],
    missing_information: [],
    source_freshness: { generated_at: '2026-07-25T00:00:00.000Z', last_pennylane_sync_at: null },
  });
  try {
    const result = await _private.executeRegisteredAgentTool({
      db: makeDb(),
      user: {
        id: 'user-test',
        store_id: 'store-test',
        role: 'admin',
        permissions: [],
      },
      args: { days: 30 },
      name: 'prepare_cashflow_plan',
    });
    assert.equal(result.ok, true);
    assert.equal(result.tool, 'prepare_cashflow_plan');
  } finally {
    cashflow.buildCashflowProjection = originalProjection;
  }

  assert.equal(_private.isCashflowPlanIntent('Fais-moi une prevision de tresorerie a 30 jours'), true);
  assert.equal(_private.isCashflowPlanIntent('plan de tresorerie'), true);
  assert.equal(_private.isCashflowPlanIntent('projection de tresorerie'), true);
  assert.equal(_private.isCashflowPlanIntent('cashflow sur 30 jours'), true);
  assert.equal(_private.extractCashflowDays('tresorerie sur 45 jours'), 45);

  console.log(JSON.stringify({ ok: true }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
