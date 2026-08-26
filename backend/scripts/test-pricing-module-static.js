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

async function testDuplicatePricingSessionUsesSourceLineMap() {
  const insertedTariffs = [];
  let copiedLineIndex = 0;
  const sourceLines = [
    {
      id: 'source-line-a',
      article_id: 'article-same',
      supplier_id: 'supplier-1',
      plu_snapshot: 'PLU',
      designation_snapshot: 'Same fish',
      family_code: 'F',
      family_name: 'Fish',
      sale_unit: 'kg',
      price_unit: 'kg',
      purchase_price_ht: 5,
      supplier_designation_original: 'Same fish',
      transport_cost_ht: 0.1,
      transport_cost_source: 'manual',
      transport_cost_forced: false,
      display_order: 1,
      exclude_from_mercuriale: false,
      notes: null,
    },
    {
      id: 'source-line-b',
      article_id: 'article-same',
      supplier_id: 'supplier-1',
      plu_snapshot: 'PLU',
      designation_snapshot: 'Same fish',
      family_code: 'F',
      family_name: 'Fish',
      sale_unit: 'kg',
      price_unit: 'kg',
      purchase_price_ht: 6,
      supplier_designation_original: 'Same fish',
      transport_cost_ht: 0.2,
      transport_cost_source: 'manual',
      transport_cost_forced: false,
      display_order: 1,
      exclude_from_mercuriale: false,
      notes: null,
    },
  ];
  const client = {
    async query(sql, params = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('WHERE store_id = $1 AND pricing_date = $2::date')) return { rows: [{ version: 2 }] };
      if (sql.includes('SELECT * FROM pricing_sessions') && sql.includes('WHERE id = $1 AND store_id = $2')) {
        return { rows: [{ id: params[0], store_id: params[1], pricing_date: '2026-08-25', status: 'published' }] };
      }
      if (sql.includes('INSERT INTO pricing_sessions')) return { rows: [{ id: 'new-session' }] };
      if (sql.includes('FROM pricing_lines') && sql.includes('ORDER BY display_order ASC, created_at ASC, id ASC')) return { rows: sourceLines };
      if (sql.includes('INSERT INTO pricing_lines') && sql.includes('RETURNING id')) {
        copiedLineIndex += 1;
        return { rows: [{ id: `dest-line-${copiedLineIndex}` }] };
      }
      if (sql.includes('FROM pricing_line_tariffs') && sql.includes('WHERE store_id = $1 AND pricing_line_id = $2')) {
        return {
          rows: params[1] === 'source-line-a'
            ? [
              { tariff_level_id: 'tariff-1', price_ht: 10 },
              { tariff_level_id: 'tariff-2', price_ht: 11 },
            ]
            : [
              { tariff_level_id: 'tariff-1', price_ht: 20 },
              { tariff_level_id: 'tariff-2', price_ht: 21 },
            ],
        };
      }
      if (sql.includes('INSERT INTO pricing_line_tariffs')) {
        insertedTariffs.push({ pricing_line_id: params[1], tariff_level_id: params[2], price_ht: params[3] });
        return { rows: [] };
      }
      if (sql.includes('SELECT * FROM pricing_sessions WHERE store_id = $1')) return { rows: [{ id: 'new-session' }] };
      if (sql.includes('FROM pricing_lines pl')) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  };
  const db = { async connect() { return client; } };
  const duplicated = await pricing.duplicatePricingSession(db, 'store-1', {
    source_session_id: 'source-session',
    pricing_date: '2026-08-26',
  }, { user_id: 'user-1' });

  assert.equal(duplicated.duplicated_line_count, 2);
  assert.deepEqual(insertedTariffs, [
    { pricing_line_id: 'dest-line-1', tariff_level_id: 'tariff-1', price_ht: 10 },
    { pricing_line_id: 'dest-line-1', tariff_level_id: 'tariff-2', price_ht: 11 },
    { pricing_line_id: 'dest-line-2', tariff_level_id: 'tariff-1', price_ht: 20 },
    { pricing_line_id: 'dest-line-2', tariff_level_id: 'tariff-2', price_ht: 21 },
  ]);
}

async function testSalesLinePricingSnapshotDecisions() {
  const pricedLine = {
    pricing_session_id: 'session-old',
    pricing_line_id: 'line-old',
    tariff_level_id: 'tariff-1',
    source_tariff_price_ht: 8.5,
    royale_maree_commission_ht: 0.75,
    final_unit_price_ht: 9.25,
    unit_sale_price_ht: 9.25,
  };
  assert.equal(pricing.shouldResolveSalesLinePricing({}, pricedLine), false);
  assert.equal(pricing.shouldResolveSalesLinePricing({ unit_sale_price_ht: 10.5 }, pricedLine), false);
  assert.equal(pricing.shouldResolveSalesLinePricing({ reprice_from_pricing: true }, pricedLine), true);
  assert.equal(pricing.shouldResolveSalesLinePricing({}, { unit_sale_price_ht: 0 }), true);

  const preserved = pricing.buildSalesLinePricingTrace({}, pricedLine, { found: false }, 9.25);
  assert.equal(preserved.mode, 'preserved');
  assert.equal(preserved.pricing_session_id, 'session-old');
  assert.equal(preserved.final_unit_price_ht, 9.25);

  const manual = pricing.buildSalesLinePricingTrace({ unit_sale_price_ht: 10.5 }, pricedLine, { found: false }, 10.5);
  assert.equal(manual.mode, 'manual_override');
  assert.equal(manual.pricing_session_id, null);
  assert.equal(manual.pricing_line_id, null);
  assert.equal(manual.final_unit_price_ht, 10.5);
}

async function testSupplierImportHeaderAndSupplierStoreValidation() {
  const appliedStatusUpdates = [];
  const missingImportClient = {
    async query(sql, params = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM pricing_sessions') && sql.includes('FOR UPDATE')) return { rows: [{ id: params[0], status: 'draft' }] };
      if (sql.includes('FROM supplier_price_imports') && sql.includes('FOR UPDATE')) return { rows: [] };
      if (sql.includes("SET status = 'applied'")) appliedStatusUpdates.push(params);
      return { rows: [] };
    },
    release() {},
  };
  await assert.rejects(
    () => pricing.applySupplierImportToSession({ async connect() { return missingImportClient; } }, 'store-1', {
      pricing_session_id: 'session-1',
      import_id: 'foreign-import',
    }),
    /Import fournisseur introuvable/
  );
  assert.equal(appliedStatusUpdates.length, 0, 'foreign import is never marked applied');

  const missingSupplierClient = {
    async query(sql) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM suppliers')) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  };
  await assert.rejects(
    () => pricing.createSupplierPriceImport({ async connect() { return missingSupplierClient; } }, 'store-1', {
      supplier_id: 'supplier-from-other-store',
      lines: [{ supplier_designation_original: 'Bar', purchase_price_ht: 4 }],
    }),
    /Fournisseur introuvable/
  );

  const lineSupplierClient = {
    async query(sql, params = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM pricing_sessions') && sql.includes('FOR UPDATE')) return { rows: [{ id: params[0], status: 'draft' }] };
      if (sql.includes('FROM articles')) return { rows: [] };
      if (sql.includes('FROM suppliers')) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  };
  await assert.rejects(
    () => pricing.addPricingLine({ async connect() { return lineSupplierClient; } }, 'store-1', {
      pricing_session_id: 'session-1',
      supplier_id: 'supplier-from-other-store',
      designation: 'Bar',
    }),
    /Fournisseur introuvable/
  );
}

async function testPublicationReplacementContract() {
  const service = read('backend/services/pricingService.js');
  assert(service.includes("SET status = 'superseded', is_active_publication = false"), 'old publication is superseded');
  assert(service.includes("status = 'published' AND is_active_publication = true AND id <> $3"), 'only previous active publication is replaced');
  assert(service.includes('id <> $3'), 'newly published session is not overwritten during replacement');
}

async function testIntegrationFilesReferencePricing() {
  const customerPriceLists = read('backend/routes/customerPriceLists.js');
  assert(customerPriceLists.includes('fetchPublishedPricingProducts'), 'mercuriale reads pricing first');
  assert(customerPriceLists.includes('quick_order_sheet_legacy_fallback'), 'mercuriale documents legacy fallback');

  const sales = read('backend/routes/sales.js');
  assert(sales.includes('resolvePublishedPrice'), 'sales lines resolve published pricing');
  assert(sales.includes('shouldResolveSalesLinePricing'), 'sales line patch avoids implicit repricing of snapshotted lines');
  assert(sales.includes('buildSalesLinePricingTrace'), 'sales line patch writes explicit pricing trace decisions');
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
  await testDuplicatePricingSessionUsesSourceLineMap();
  await testSalesLinePricingSnapshotDecisions();
  await testSupplierImportHeaderAndSupplierStoreValidation();
  await testPublicationReplacementContract();
  await testIntegrationFilesReferencePricing();
  console.log('OK pricing module static contract tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
