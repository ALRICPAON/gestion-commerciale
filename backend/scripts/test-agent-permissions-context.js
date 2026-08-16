const assert = require('assert');

const cashflow = require('../services/cashflow/service');
const { executeAgentTool, normalizeContext } = require('../services/agent/agentToolExecutor');
const { authorizeTool } = require('../services/agent/agentAuthorizationService');
const { getAgentTool } = require('../services/agent/agentToolRegistry');
const { getExecutableAction } = require('../services/agent/agentExecutableActionRegistry');
const { resolveAgentPermissions } = require('../services/agent/agentPermissionProfileService');
const { _private } = require('../services/ai/aiToolFirstAgentService');

function makeDb() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push(String(sql));
      if (String(sql).includes('agent_tool_audit_logs')) return { rows: [{ id: '00000000-0000-4000-8000-000000000101' }] };
      if (String(sql).includes('INSERT INTO agent_pending_actions')) {
        const payload = params[4] ? JSON.parse(params[4]) : {};
        return {
          rows: [{
            id: '00000000-0000-4000-8000-000000000201',
            store_id: params[0],
            created_by_source: params[1],
            action_type: params[2],
            summary: params[3],
            payload,
            status: 'awaiting_confirmation',
            domain: params[5],
            module: params[5],
            final_tool_name: params[6],
            frozen_payload: payload,
            human_summary: params[3],
            impact_summary: params[7],
            target_objects: params[8] ? JSON.parse(params[8]) : [],
            expires_at: params[9],
            payload_hash: params[10],
            idempotency_key: params[11],
            risk_level: 2,
            created_by_user_id: params[12],
          }],
        };
      }
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
  const configuredTrustedOwner = [
    'agent.use',
    'mcp.execute',
    'quality.read',
    'stock.read',
    'stock.write',
    'sales.read',
    'communications.send',
  ];
  const ownerPermissions = resolveAgentPermissions({
    role: 'trusted_owner',
    configuredPermissions: configuredTrustedOwner,
  });
  assert(ownerPermissions.includes('quality.record.create'), 'trusted_owner doit recevoir quality.record.create');
  for (const permission of [
    'supplies_materials.read',
    'supplies_materials.write',
    'supplies_materials.archive',
    'supplies_materials.documents',
  ]) {
    assert(ownerPermissions.includes(permission), `trusted_owner doit recevoir ${permission}`);
  }
  assert(!resolveAgentPermissions({
    role: 'agent',
    configuredPermissions: configuredTrustedOwner,
  }).includes('quality.record.create'), 'quality.record.create ne doit pas etre ajoute a un agent standard');
  assert(!resolveAgentPermissions({
    role: 'responsable',
    configuredPermissions: ['agent.use', 'quality.read'],
  }).includes('supplies_materials.write'), 'les permissions fournitures ne doivent pas etre ajoutees a tous les utilisateurs');

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

  const trustedOwnerContext = {
    store_id: 'store-test',
    user_id: 'owner-test',
    role: 'trusted_owner',
    user_permissions: ownerPermissions,
    agent_permissions: ownerPermissions,
    source: 'mcp',
    trusted_mode: false,
  };
  for (const name of [
    'prepare_traceability_test_completion',
    'prepare_quality_lot_block',
    'prepare_quality_lot_release',
    'prepare_product_recall',
    'prepare_product_recall_notifications',
    'list_supplies_materials',
    'create_supply_material',
    'archive_supply_material',
    'add_supply_material_document_reference',
  ]) {
    authorizeTool(getAgentTool(name), trustedOwnerContext);
  }

  await expectForbidden(() => executeAgentTool({
    db: makeDb(),
    name: 'prepare_traceability_test_completion',
    input: { lot_id: 'lot-1', result: 'conform' },
    context: {
      store_id: 'store-test',
      user_id: 'user-test',
      role: 'responsable',
      user_permissions: ['quality.read'],
      agent_permissions: ['quality.read'],
      source: 'mcp',
    },
  }), 'un utilisateur sans quality.record.create doit etre refuse');

  await expectForbidden(() => executeAgentTool({
    db: makeDb(),
    name: 'list_supplies_materials',
    input: {},
    context: {
      store_id: 'store-test',
      user_id: 'user-test',
      role: 'responsable',
      user_permissions: ['quality.read'],
      agent_permissions: ['quality.read'],
      source: 'mcp',
    },
  }), 'un utilisateur sans supplies_materials.read doit etre refuse');

  const pending = await executeAgentTool({
    db: makeDb(),
    name: 'create_pending_action',
    input: {
      action_type: 'quality.traceability_test.complete',
      summary: 'Valider le test de tracabilite',
      payload: { lot_id: 'lot-1', result: 'conform' },
    },
    context: trustedOwnerContext,
  });
  assert.equal(pending.ok, true);
  assert.equal(pending.data.action.name, 'quality.traceability_test.complete');
  assert.equal(pending.data.status, 'awaiting_confirmation');

  const traceabilityAction = getExecutableAction('quality.traceability_test.complete');
  assert.deepEqual(traceabilityAction.requiredPermissions, ['mcp.execute', 'quality.record.create']);
  assert.equal(traceabilityAction.confirmationLevel, 'explicit_human');
  assert.equal(traceabilityAction.previewRequired, true);

  let confirmationRefused = false;
  try {
    await executeAgentTool({
      db: makeDb(),
      name: 'execute_pending_action',
      input: { id: '00000000-0000-4000-8000-000000000201' },
      confirmed: true,
      context: trustedOwnerContext,
    });
  } catch (error) {
    confirmationRefused = error.status === 400 && /confirmation=human_confirmed/.test(error.message);
  }
  assert.equal(confirmationRefused, true, 'execute_pending_action doit conserver la confirmation humaine explicite');

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
