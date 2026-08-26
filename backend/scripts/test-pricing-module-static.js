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

function assertContiguousPostgresPlaceholders(sql, label = 'SQL') {
  const numbers = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
  if (!numbers.length) return;
  const used = new Set(numbers);
  const max = Math.max(...numbers);
  for (let index = 1; index <= max; index += 1) {
    assert(used.has(index), `${label} skips PostgreSQL placeholder $${index}`);
  }
}

async function testPricingSqlPlaceholdersAreContiguous() {
  const service = read('backend/services/pricingService.js');
  const queryTemplates = [...service.matchAll(/\.query\(\s*`([\s\S]*?)`/g)];
  assert(queryTemplates.length > 20, 'pricing service SQL template queries are inspected');
  for (const [index, match] of queryTemplates.entries()) {
    assertContiguousPostgresPlaceholders(match[1], `pricingService query template #${index + 1}`);
  }
  assert(service.includes('WHERE id = $11 AND store_id = $1 AND supplier_id = $2'), 'existing supplier mapping update scopes supplier_id and types $2');
}

async function testMigrationContract() {
  const sql = read('backend/db/gestion-commerciale/108_pricing_daily_tariffs.sql');
  const decisionSql = read('backend/db/gestion-commerciale/109_supplier_import_human_decisions.sql');
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
  for (const column of ['user_decision', 'decided_by', 'decided_at', 'decision_source', 'raw_source_text', 'source_page', 'source_filename']) {
    assert(decisionSql.includes(column), `supplier import decision column ${column}`);
  }
  assert(decisionSql.includes("user_decision IN ('pending', 'confirmed', 'overridden', 'ignored')"), 'human decision statuses are separated from algorithmic matching');
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
    'list_supplier_price_import_lines',
    'search_supplier_import_unresolved_lines',
    'search_articles_for_supplier_mapping',
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
    'pricing.supplier_import_line.confirm',
    'pricing.supplier_import_line.override',
    'pricing.supplier_import_line.ignore',
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

async function testSupplierImportHumanWorkflowContracts() {
  const service = read('backend/services/pricingService.js');
  assert(service.includes("'known_mapping'"), 'known mappings are detected explicitly');
  assert(service.includes("'pending'") && service.includes('decision_source') && service.includes('null'), 'known mappings stay pending until human confirmation');
  assert(!service.includes('ON CONFLICT (store_id, supplier_id, supplier_designation_normalized)'), 'supplier mapping upsert avoids fragile partial-index ON CONFLICT');
  assert(service.includes('FOR UPDATE'), 'supplier mapping override locks the existing mapping transactionally');
  assert(service.includes("user_decision = 'confirmed'"), 'confirmation records a human decision');
  assert(service.includes("user_decision = 'overridden'"), 'override records a human decision');
  assert(service.includes("user_decision = 'ignored'"), 'ignore records a human decision');
  assert(service.includes("['confirmed', 'overridden'].includes(line.user_decision)"), 'apply only uses validated lines');
  assert(service.includes('searchArticlesForSupplierMapping'), 'service exposes article search for supplier matching');
  assert(service.includes('mapping_source: \'human_validation\''), 'confirmed mappings are memorized as human validation');
  assert(service.includes('mapping_source: \'human_override\''), 'overridden mappings replace supplier-specific mapping');
}

async function testKnownSupplierMappingRequiresImportConfirmation() {
  const importLines = [];
  const pricingLineUpdates = [];
  const events = [];
  let connectCount = 0;
  const client = {
    async query(sql, params = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        events.push(sql);
        return { rows: [] };
      }
      if (sql.includes('FROM suppliers') && sql.includes('COALESCE(status')) return { rows: [{ id: params[0], name: 'Sogelmer' }] };
      if (sql.includes('INSERT INTO supplier_price_imports')) return { rows: [{ id: 'import-1', supplier_id: 'supplier-1', status: 'parsed' }] };
      if (sql.includes('FROM supplier_article_mappings sam') && sql.includes('sam.supplier_designation_normalized = $3')) {
        return { rows: [{ id: 'mapping-1', article_id: 'article-1', article_plu: '3013', article_designation: 'Filet julienne' }] };
      }
      if (sql.includes('FROM supplier_article_mappings') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'mapping-1' }] };
      }
      if (sql.includes('INSERT INTO supplier_price_import_lines')) {
        importLines.push({
          id: 'import-line-1',
          import_id: 'import-1',
          supplier_id: params[2],
          row_number: params[3],
          supplier_designation_original: params[4],
          supplier_designation_normalized: params[5],
          purchase_price_ht: params[9],
          matched_article_id: params[11],
          mapping_id: params[12],
          match_status: params[13],
          match_method: params[14],
          confidence_score: params[15],
          user_decision: params[16],
          decided_by: params[17],
          decided_at: params[18],
          decision_source: params[19],
          article_plu: '3013',
          article_designation: 'Filet julienne',
        });
        return { rows: [] };
      }
      if (sql.includes('SELECT * FROM supplier_price_imports WHERE id = $1 AND store_id = $2')) {
        return { rows: [{ id: params[0], supplier_id: 'supplier-1', status: 'parsed' }] };
      }
      if (sql.includes('FROM supplier_price_import_lines spil') && sql.includes('LEFT JOIN articles')) return { rows: importLines };
      if (sql.includes('FROM pricing_sessions') && sql.includes('FOR UPDATE')) return { rows: [{ id: params[0], status: 'draft', pricing_date: '2026-08-26' }] };
      if (sql.includes('FROM supplier_price_imports') && sql.includes('FOR UPDATE')) return { rows: [{ id: params[0], supplier_id: 'supplier-1', status: 'parsed' }] };
      if (sql.includes('UPDATE supplier_price_imports SET status')) return { rows: [] };
      if (sql.includes('SELECT * FROM pricing_sessions WHERE store_id = $1')) return { rows: [{ id: 'session-1', status: 'draft' }] };
      if (sql.includes('FROM pricing_lines pl')) return { rows: [{ id: 'pricing-line-1' }] };
      if (sql.includes('JOIN supplier_price_imports spi') && sql.includes('FOR UPDATE OF spil')) return { rows: [{ ...importLines[0], import_status: 'parsed' }] };
      if (sql.includes('FROM articles') && sql.includes('WHERE id = $1')) {
        return { rows: [{ id: params[0], plu: '3013', designation: 'Filet julienne', sale_unit: 'kg', unit: 'kg' }] };
      }
      if (sql.includes('UPDATE supplier_article_mappings') && sql.includes('RETURNING id')) {
        assertContiguousPostgresPlaceholders(sql, 'existing supplier mapping confirm update');
        assert(sql.includes('AND supplier_id = $2'), 'existing supplier mapping confirm update uses supplier_id placeholder');
        events.push('mapping_update');
        return { rows: [{ id: 'mapping-1' }] };
      }
      if (sql.includes('INSERT INTO supplier_article_mappings')) return { rows: [{ id: 'mapping-1' }] };
      if (sql.includes('FROM supplier_article_mappings sam') && sql.includes('LEFT JOIN suppliers')) {
        return { rows: [{ id: 'mapping-1', article_id: 'article-1', article_plu: '3013', article_designation: 'Filet julienne' }] };
      }
      if (sql.includes("SET matched_article_id = $3, mapping_id = $4, user_decision = 'confirmed'")) {
        importLines[0] = {
          ...importLines[0],
          matched_article_id: params[2],
          mapping_id: params[3],
          user_decision: 'confirmed',
          decided_by: params[4],
          decision_source: 'human_confirmed',
        };
        return { rows: [importLines[0]] };
      }
      if (sql.includes('SELECT id FROM pricing_lines')) return { rows: [] };
      if (sql.includes('SELECT COALESCE(MAX(display_order)')) return { rows: [{ n: 1 }] };
      if (sql.includes('INSERT INTO pricing_lines')) return { rows: [{ id: 'pricing-line-1' }] };
      if (sql.includes('UPDATE supplier_price_import_lines SET applied_pricing_line_id')) {
        pricingLineUpdates.push(params);
        importLines[0].applied_pricing_line_id = params[0];
        return { rows: [] };
      }
      return { rows: [] };
    },
    async connect() {
      throw new Error('transaction client connect should not be called');
    },
    release() {
      events.push('release');
    },
  };
  const db = {
    async connect() {
      connectCount += 1;
      events.push('pool_connect');
      return client;
    },
  };

  const created = await pricing.createSupplierPriceImport(db, 'store-1', {
    supplier_id: 'supplier-1',
    lines: [{ supplier_designation_original: 'F JULIENNE', purchase_price_ht: 10.5 }],
  }, { user_id: 'user-1' });

  assert.equal(created.lines[0].matched_article_id, 'article-1');
  assert.equal(created.lines[0].mapping_id, 'mapping-1');
  assert.equal(created.lines[0].match_method, 'known_mapping');
  assert.equal(created.lines[0].user_decision, 'pending');
  assert.equal(created.lines[0].decided_by, null);
  assert.equal(created.lines[0].decided_at, null);
  assert.equal(created.lines[0].decision_source, null);

  const beforeConfirm = await pricing.applySupplierImportToSession(db, 'store-1', { import_id: 'import-1', pricing_session_id: 'session-1' });
  assert.equal(beforeConfirm.applied_line_count, 0);
  assert.equal(beforeConfirm.pending_line_count, 1);

  const confirmed = await pricing.confirmSupplierImportLineMapping(db, 'store-1', { import_line_id: 'import-line-1' }, { user_id: 'user-1' });
  assert.equal(confirmed.user_decision, 'confirmed');
  assert.equal(confirmed.matched_article_id, 'article-1');
  assert.equal(confirmed.mapping_id, 'mapping-1');
  assert(events.includes('mapping_update'), 'confirm updates the existing supplier mapping without 42P18');

  const afterConfirm = await pricing.applySupplierImportToSession(db, 'store-1', { import_id: 'import-1', pricing_session_id: 'session-1' });
  assert.equal(afterConfirm.applied_line_count, 1);
  assert.equal(pricingLineUpdates.length, 1);
  assert.equal(connectCount, 4, 'create/apply/confirm/apply each open only their outer transaction');
  assert.equal(events.filter((event) => event === 'pool_connect').length, 4, 'nested confirm/apply calls do not reconnect the transaction client');
}

function pricingOverrideFakeDb({ articleFound = true, existingMapping = true, mappingFails = false } = {}) {
  const events = [];
  let connectCount = 0;
  const importLine = {
    id: 'import-line-1',
    import_id: 'import-1',
    supplier_id: 'supplier-1',
    supplier_designation_original: 'F JULIENNE',
    supplier_designation_normalized: 'f julienne',
    purchase_price_ht: 10.5,
    matched_article_id: null,
    mapping_id: null,
    match_status: 'unrecognized',
    match_method: 'none',
    user_decision: 'pending',
    import_status: 'parsed',
  };
  const client = {
    events,
    async query(sql, params = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        events.push(sql);
        return { rows: [] };
      }
      if (sql.includes('JOIN supplier_price_imports spi') && sql.includes('FOR UPDATE OF spil')) return { rows: [importLine] };
      if (sql.includes('FROM articles') && sql.includes('WHERE id = $1')) {
        return { rows: articleFound ? [{ id: params[0], plu: '3013', designation: 'Filet julienne 200/400', sale_unit: 'kg', unit: 'kg' }] : [] };
      }
      if (sql.includes('FROM suppliers') && sql.includes('COALESCE(status')) return { rows: [{ id: 'supplier-1', name: 'Sogelmer' }] };
      if (sql.includes('FROM supplier_article_mappings') && sql.includes('FOR UPDATE')) return { rows: existingMapping ? [{ id: 'mapping-1' }] : [] };
      if (sql.includes('UPDATE supplier_article_mappings') && sql.includes('RETURNING id')) {
        assertContiguousPostgresPlaceholders(sql, 'existing supplier mapping override update');
        assert(sql.includes('AND supplier_id = $2'), 'existing supplier mapping override update uses supplier_id placeholder');
        if (mappingFails) {
          const error = new Error('duplicate key value violates unique constraint');
          error.code = '23505';
          error.constraint = 'uq_supplier_article_mappings_store_supplier_normalized_active';
          throw error;
        }
        events.push('mapping_update');
        return { rows: [{ id: 'mapping-1' }] };
      }
      if (sql.includes('INSERT INTO supplier_article_mappings')) {
        if (mappingFails) {
          const error = new Error('there is no unique or exclusion constraint matching the ON CONFLICT specification');
          error.code = '42P10';
          throw error;
        }
        events.push('mapping_insert');
        return { rows: [{ id: 'mapping-new' }] };
      }
      if (sql.includes('UPDATE supplier_article_mappings') && sql.includes('SET is_active = false')) {
        events.push('mapping_dedupe');
        return { rows: [] };
      }
      if (sql.includes('FROM supplier_article_mappings sam') && sql.includes('LEFT JOIN suppliers')) {
        return { rows: [{ id: existingMapping ? 'mapping-1' : 'mapping-new', article_id: 'article-2', article_plu: '3013', article_designation: 'Filet julienne 200/400' }] };
      }
      if (sql.includes("SET matched_article_id = $3, mapping_id = $4, user_decision = 'overridden'")) {
        events.push('import_line_update');
        importLine.matched_article_id = params[2];
        importLine.mapping_id = params[3];
        importLine.user_decision = 'overridden';
        return { rows: [{ ...importLine }] };
      }
      if (sql.includes('FROM supplier_price_import_lines spil') && sql.includes('LEFT JOIN articles')) {
        return { rows: [{ ...importLine, article_plu: '3013', article_designation: 'Filet julienne 200/400' }] };
      }
      return { rows: [] };
    },
    async connect() {
      throw new Error('transaction client connect should not be called');
    },
    release() {
      events.push('release');
    },
  };
  const db = {
    async connect() {
      connectCount += 1;
      events.push('pool_connect');
      return client;
    },
    get connectCount() {
      return connectCount;
    },
  };
  return { db, client };
}

async function testSupplierMappingUpsertReusesTransactionalClient() {
  const { client } = pricingOverrideFakeDb({ existingMapping: true });
  delete client.release;
  const mapping = await pricing.upsertSupplierArticleMapping(client, 'store-1', {
    supplier_id: 'supplier-1',
    article_id: 'article-2',
    supplier_designation_original: 'F JULIENNE',
    mapping_source: 'human_validation',
    confidence_score: 100,
  }, { user_id: 'user-1' });
  assert.equal(mapping.id, 'mapping-1');
  assert.equal(mapping.article_plu, '3013');
  assert(!client.events.includes('BEGIN'), 'existing transaction client is reused without opening a nested transaction');
  assert(!client.events.includes('ROLLBACK'), 'transaction client upsert does not rollback outside its owner');
}

async function testSupplierImportOverrideUpdatesExistingMapping() {
  const { db, client } = pricingOverrideFakeDb({ existingMapping: true });
  const updated = await pricing.overrideSupplierImportLineMapping(db, 'store-1', {
    import_line_id: 'import-line-1',
    article_id: 'article-2',
  }, { user_id: 'user-1' });
  assert.equal(updated.matched_article_id, 'article-2');
  assert.equal(updated.mapping_id, 'mapping-1');
  assert.equal(updated.article_plu, '3013');
  assert.equal(updated.article_designation, 'Filet julienne 200/400');
  assert.equal(updated.user_decision, 'overridden');
  assert.equal(db.connectCount, 1, 'override opens a single pool transaction');
  assert(client.events.includes('mapping_update'), 'existing mapping is updated without unique error');
  assert(client.events.includes('import_line_update'), 'import line is updated after mapping');
  assert(client.events.includes('COMMIT'), 'override commits atomically');
}

async function testSupplierImportOverrideRejectsOtherStoreArticle() {
  const { db } = pricingOverrideFakeDb({ articleFound: false });
  await assert.rejects(
    () => pricing.overrideSupplierImportLineMapping(db, 'store-1', {
      import_line_id: 'import-line-1',
      article_id: 'article-other-store',
    }, { user_id: 'user-1' }),
    /Article introuvable/
  );
}

async function testSupplierImportOverrideRollsBackOnMappingError() {
  const { db, client } = pricingOverrideFakeDb({ mappingFails: true });
  await assert.rejects(
    () => pricing.overrideSupplierImportLineMapping(db, 'store-1', {
      import_line_id: 'import-line-1',
      article_id: 'article-2',
    }, { user_id: 'user-1' }),
    /duplicate key|unique|constraint/
  );
  assert(client.events.includes('ROLLBACK'), 'mapping failure rolls back transaction');
  assert.equal(client.events.filter((event) => event === 'ROLLBACK').length, 1, 'mapping failure rolls back exactly once');
  assert(!client.events.includes('import_line_update'), 'import line is not partially modified');
}

async function testSupplierImportTextParserSkipsNonProductLines() {
  const inserted = [];
  const client = {
    async query(sql, params = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM suppliers') && sql.includes('COALESCE(status')) return { rows: [{ id: 'supplier-1', name: 'Sogelmer' }] };
      if (sql.includes('INSERT INTO supplier_price_imports')) return { rows: [{ id: 'import-1', supplier_id: 'supplier-1', status: 'parsed' }] };
      if (sql.includes('FROM supplier_article_mappings sam') && sql.includes('sam.supplier_designation_normalized = $3')) return { rows: [] };
      if (sql.includes('FROM articles') && sql.includes('regexp_replace')) return { rows: [] };
      if (sql.includes('FROM articles a') && sql.includes('lower(a.designation) LIKE')) return { rows: [] };
      if (sql.includes('INSERT INTO supplier_price_import_lines')) {
        inserted.push({ designation: params[4], price: params[9] });
        return { rows: [] };
      }
      if (sql.includes('SELECT * FROM supplier_price_imports WHERE id = $1 AND store_id = $2')) return { rows: [{ id: 'import-1', supplier_id: 'supplier-1' }] };
      if (sql.includes('FROM supplier_price_import_lines spil') && sql.includes('LEFT JOIN articles')) return { rows: inserted.map((row, index) => ({ id: `line-${index}`, supplier_designation_original: row.designation, purchase_price_ht: row.price, user_decision: 'pending' })) };
      return { rows: [] };
    },
    release() {},
  };
  const rawText = [
    'Bonjour',
    'Cours du jour :',
    'Poisson',
    '- Eperlans - 5,90',
    '- Merlu 1.2/1.8 - 5,50',
    'Filets',
    '- F julienne - 10,50',
  ].join('\n');
  await pricing.createSupplierPriceImport({ async connect() { return client; } }, 'store-1', {
    supplier_id: 'supplier-1',
    raw_text: rawText,
    source_type: 'text',
  }, { user_id: 'user-1' });
  assert.equal(inserted.length, 3);
  assert.deepEqual(inserted.map((row) => row.designation), ['Eperlans', 'Merlu 1.2/1.8', 'F julienne']);
}

async function testPricingFrontendImportWorkflowContracts() {
  const html = read('frontend/pricing.html');
  const js = read('frontend/js/pricing.js');
  assert(html.includes('id="import-file-input"'), 'frontend exposes supplier file input');
  assert(html.includes('.xlsx,.xls,.csv,.txt,.pdf'), 'frontend accepts Excel CSV TXT PDF');
  assert(js.includes('new FormData()'), 'frontend sends multipart form data for file imports');
  assert(js.includes('apiForm(\'/api/pricing/supplier-imports\''), 'file and text imports use same import endpoint');
  assert(js.includes('data-import-action="confirm"'), 'frontend exposes explicit confirm action');
  assert(js.includes('data-import-action="change"'), 'frontend exposes explicit change action');
  assert(js.includes('data-import-action="ignore"'), 'frontend exposes explicit ignore action');
  assert(js.includes('/supplier-import-lines/articles/search'), 'frontend searches ALTA articles in matching workflow');
  assert(html.includes('pricing-import-modal-content'), 'supplier import modal has dedicated wide workspace');
  assert(html.includes('id="import-article-panel"'), 'frontend uses a wide article picker panel');
  assert(html.includes('pricing.css?v=2') && html.includes('pricing.js?v=2'), 'pricing assets are cache-busted');
  assert(js.includes('matchLabel'), 'frontend translates technical matching labels');
  assert(js.includes('updateImportLine(updated)'), 'frontend updates selected import line after override');
  const css = read('frontend/css/pages/pricing.css');
  assert(css.includes('width: 95vw'), 'import modal is near full screen on desktop');
  assert(css.includes('position: sticky') && css.includes('right: 0'), 'actions column remains accessible');

  const saveDirtyBody = js.slice(js.indexOf('async function saveDirtyLines()'), js.indexOf('async function loadReferenceData()'));
  assert(!saveDirtyBody.includes('loadSession('), 'autosave updates local model without reloading the session');
  assert(saveDirtyBody.includes('refreshRowComputedCells'), 'autosave refreshes computed cells locally');
}

async function testPricingRouteFileParsingContracts() {
  const route = read('backend/routes/pricing.js');
  assert(route.includes("PDFParse") && route.includes("require('pdf-parse')"), 'pricing route uses local PDF text extraction');
  assert(route.includes("name.endsWith('.pdf')"), 'PDF files are routed to PDF parsing');
  assert(route.includes('rowsFromPdf'), 'PDF uses the same supplier row workflow');
  assert(route.includes('rowFromCells'), 'file parsing detects price-like cells instead of always using the last cell blindly');
  assert(route.includes("source_type: req.file.originalname.toLowerCase().endsWith('.pdf') ? 'pdf' : 'file'"), 'PDF source type is preserved');
  assert(route.includes('logPricingRouteError'), 'pricing routes log unexpected backend errors with context');
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
  await testPricingSqlPlaceholdersAreContiguous();
  await testMigrationContract();
  await testAgentContracts();
  await testServiceHelpers();
  await testResolvePublishedPriceWithCommission();
  await testDuplicatePricingSessionUsesSourceLineMap();
  await testSalesLinePricingSnapshotDecisions();
  await testSupplierImportHeaderAndSupplierStoreValidation();
  await testPublicationReplacementContract();
  await testSupplierImportHumanWorkflowContracts();
  await testKnownSupplierMappingRequiresImportConfirmation();
  await testSupplierMappingUpsertReusesTransactionalClient();
  await testSupplierImportOverrideUpdatesExistingMapping();
  await testSupplierImportOverrideRejectsOtherStoreArticle();
  await testSupplierImportOverrideRollsBackOnMappingError();
  await testSupplierImportTextParserSkipsNonProductLines();
  await testPricingFrontendImportWorkflowContracts();
  await testPricingRouteFileParsingContracts();
  await testIntegrationFilesReferencePricing();
  console.log('OK pricing module static contract tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
