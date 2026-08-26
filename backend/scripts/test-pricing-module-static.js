const assert = require('assert');
const fs = require('fs');
const path = require('path');

const pricing = require('../services/pricingService');
const { listAgentTools } = require('../services/agent/agentToolRegistry');
const { listExecutableActions } = require('../services/agent/agentExecutableActionRegistry');

const root = path.join(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

async function testMigrationContract() {
  const sql = read('backend/db/gestion-commerciale/108_pricing_daily_tariffs.sql');
  for (const table of [
    'tariff_levels',
    'pricing_sessions',
    'pricing_lines',
    'pricing_line_tariffs',
    'supplier_price_imports',
    'supplier_price_import_lines',
  ]) {
    assert(sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `migration creates ${table}`);
  }
  assert(sql.includes('uq_pricing_sessions_active_publication'), 'single active publication index exists');
  assert(sql.includes('ADD COLUMN IF NOT EXISTS tariff_level_id uuid REFERENCES tariff_levels'), 'clients transition tariff_level_id exists');
  for (const column of ['pricing_session_id', 'pricing_line_id', 'source_tariff_price_ht', 'royale_maree_commission_ht', 'final_unit_price_ht']) {
    assert(sql.includes(column), `sales_lines snapshot column ${column}`);
  }
  assert(sql.includes('supplier_designation_normalized'), 'mapping normalized key exists');
}

async function testAgentContracts() {
  const tools = listAgentTools();
  const toolNames = new Set(tools.map((tool) => tool.name));
  for (const name of [
    'list_pricing_sessions',
    'get_pricing_session',
    'get_current_pricing_session',
    'search_pricing_lines',
    'get_article_pricing_history',
    'list_tariff_levels',
    'list_supplier_price_imports',
    'get_supplier_price_import',
    'list_supplier_article_mappings',
    'prepare_pricing_line_update',
    'prepare_pricing_session_publish',
  ]) {
    assert(toolNames.has(name), `agent tool ${name} registered`);
  }
  const updateTool = tools.find((tool) => tool.name === 'prepare_pricing_line_update');
  assert(updateTool.inputSchema.required.includes('pricing_line_id'), 'pricing update schema requires pricing_line_id');
  assert(updateTool.inputSchema.properties.tariffs, 'pricing update schema exposes dynamic tariffs');

  const actionNames = new Set(listExecutableActions().map((action) => action.name));
  for (const name of [
    'pricing.session.create',
    'pricing.session.duplicate',
    'pricing.line.add',
    'pricing.line.update',
    'pricing.supplier_import.create',
    'pricing.supplier_import.apply',
    'pricing.supplier_mapping.upsert',
    'pricing.session.publish',
  ]) {
    assert(actionNames.has(name), `executable action ${name} registered`);
  }
}

async function testServiceHelpers() {
  assert.equal(pricing.normalizeSupplierDesignation(' F  JULIENNÉ 10/20 '), 'f julienne 10/20');
  assert.equal(pricing.normalizeSupplierDesignation('MERLU 1,2 / 1,8'), 'merlu 1,2/1,8');
}

async function testResolvePublishedPriceWithCommission() {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM clients c')) {
        return { rows: [{ id: params[1], tariff_level: 1, resolved_legacy_level: 1, is_royale_maree_member: true }] };
      }
      if (sql.includes('FROM tariff_levels') && sql.includes('legacy_level')) {
        return { rows: [{ id: 'tariff-1', store_id: params[0], code: 'T1', name: 'Tarif 1', legacy_level: 1 }] };
      }
      if (sql.includes('FROM pricing_sessions ps')) {
        return {
          rows: [{
            pricing_session_id: 'session-1',
            pricing_line_id: 'line-1',
            tariff_level_id: 'tariff-1',
            source_tariff_price_ht: '8.50',
            royale_maree_commission_eur_per_kg: '0.75',
          }],
        };
      }
      return { rows: [] };
    },
  };
  const resolved = await pricing.resolvePublishedPrice(db, 'store-1', {
    client_id: 'client-1',
    article_id: 'article-1',
    date: '2026-08-26',
  });
  assert.equal(resolved.found, true);
  assert.equal(resolved.source_tariff_price_ht, 8.5);
  assert.equal(resolved.royale_maree_commission_ht, 0.75);
  assert.equal(resolved.final_unit_price_ht, 9.25);
  assert(calls.length >= 3, 'service uses database lookups rather than hardcoded price');
}

async function testIntegrationFilesReferencePricing() {
  const customerPriceLists = read('backend/routes/customerPriceLists.js');
  assert(customerPriceLists.includes('fetchPublishedPricingProducts'), 'mercuriale reads pricing first');
  assert(customerPriceLists.includes('quick_order_sheet_legacy_fallback'), 'mercuriale documents legacy fallback');

  const sales = read('backend/routes/sales.js');
  assert(sales.includes('resolvePublishedPrice'), 'sales lines resolve published pricing');
  assert(sales.includes('final_unit_price_ht'), 'sales lines write final_unit_price_ht trace');

  const quickOrderSheets = read('backend/routes/quickOrderSheets.js');
  assert(quickOrderSheets.includes('pricing_session_id'), 'call sheet mirror carries pricing_session_id');
  assert(quickOrderSheets.includes('tariff_prices'), 'call sheet mirror carries dynamic tariffs');
}

(async () => {
  await testMigrationContract();
  await testAgentContracts();
  await testServiceHelpers();
  await testResolvePublishedPriceWithCommission();
  await testIntegrationFilesReferencePricing();
  console.log('OK pricing module static contract tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
