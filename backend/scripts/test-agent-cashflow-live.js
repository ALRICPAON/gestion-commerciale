const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
});

const { getDefaultPool, closeAllPools } = require('../dbRegistry');
const { executeAgentTool } = require('../services/agent/agentToolExecutor');

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

async function main() {
  const storeId = argValue('store-id') || process.env.ALTA_AGENT_STORE_ID;
  if (!storeId) {
    throw new Error('store_id requis: fournir --store-id=<uuid> ou ALTA_AGENT_STORE_ID');
  }

  const db = getDefaultPool();
  try {
    const result = await executeAgentTool({
      db,
      name: 'prepare_cashflow_plan',
      input: {
        days: 30,
        scenario: 'realiste',
      },
      context: {
        store_id: storeId,
        role: 'agent',
        user_permissions: ['cashflow.read'],
        agent_permissions: ['cashflow.read'],
        source: 'manual_test',
      },
    });

    const data = result.data || {};
    const supplierPayments = data.expected_supplier_payments || [];
    const otherOutflows = data.other_outflows || [];
    console.log(JSON.stringify({
      ok: Boolean(result.ok),
      tool: result.tool,
      period: data.period || null,
      opening_balance: number(data.opening_balance),
      customer_receipts_count: (data.expected_customer_receipts || []).length,
      supplier_payments_count: supplierPayments.length,
      other_outflows_count: otherOutflows.length,
      outflows_count: supplierPayments.length + otherOutflows.length,
      closing_balance: number(data.closing_balance),
      lowest_projected_balance: number(data.lowest_projected_balance),
      lowest_projected_balance_date: data.lowest_projected_balance_date || null,
      warnings: data.warnings || result.warnings || [],
      missing_information: data.missing_information || result.missing_information || [],
      sources: data.data_sources || [],
      source_freshness: data.source_freshness || result.source_freshness || null,
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      ok: false,
      error: error.expose ? error.message : 'Erreur test cashflow live',
      status: error.status || 500,
      code: error.code || null,
    }, null, 2));
    process.exitCode = 1;
  } finally {
    await closeAllPools();
  }
}

main();
