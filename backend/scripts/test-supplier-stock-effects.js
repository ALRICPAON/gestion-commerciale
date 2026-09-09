const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  createSupplierStockEffect,
  listStockEffectsForExpectedCreditNote,
  normalizeStockEffectPayload,
} = require('../services/supplierStockEffectService');

const root = path.join(__dirname, '../..');
const servicePath = path.join(root, 'backend/services/supplierStockEffectService.js');
const expectedServicePath = path.join(root, 'backend/services/supplierExpectedCreditNoteService.js');
const routePath = path.join(root, 'backend/routes/supplierControl.js');
const purchaseRoutePath = path.join(root, 'backend/routes/purchases.js');
const migrationPath = path.join(root, 'backend/db/gestion-commerciale/117_supplier_control_stock_effects.sql');
const rollbackPath = path.join(root, 'backend/db/gestion-commerciale/117_supplier_control_stock_effects_rollback.sql');
const previousConstraintPath = path.join(root, 'backend/db/gestion-commerciale/116_supplier_expected_credit_notes.sql');
const supplierControlJsPath = path.join(root, 'frontend/js/supplier-control.js');
const purchaseHtmlPath = path.join(root, 'frontend/purchase-detail.html');
const purchaseJsPath = path.join(root, 'frontend/js/purchase-detail.js');
const dashboardTestPath = path.join(root, 'backend/scripts/test-dashboard-supplier-credit-notes.js');

const ids = {
  store: '11111111-1111-4111-8111-111111111111',
  purchase: '22222222-2222-4222-8222-222222222222',
  purchaseLine: '33333333-3333-4333-8333-333333333333',
  lot: '44444444-4444-4444-8444-444444444444',
  article: '55555555-5555-4555-8555-555555555555',
  supplier: '66666666-6666-4666-8666-666666666666',
  expected: '77777777-7777-4777-8777-777777777777',
  credit: '88888888-8888-4888-8888-888888888888',
  user: '99999999-9999-4999-8999-999999999999',
};

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function assertContains(source, pattern, message) {
  assert.match(source, pattern, message || `Missing ${pattern}`);
}

function assertNotContains(source, pattern, message) {
  assert.ok(!pattern.test(source), message || `Unexpected ${pattern}`);
}

function extractSupplierControlEventTypes(sql) {
  const constraintBlock = sql.match(/ALTER TABLE supplier_control_events[\s\S]*?ADD CONSTRAINT chk_supplier_control_events_type CHECK \(\s*event_type IN \(([\s\S]*?)\)\s*\);/);
  assert.ok(constraintBlock, 'supplier_control_events event_type CHECK constraint not found');
  return [...constraintBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
}

function createMockDb({
  lotOverrides = {},
  expectedOverrides = {},
  creditOverrides = {},
  existingMovement = null,
  uniqueViolationMovement = null,
  updateSucceeds = true,
} = {}) {
  const calls = [];
  const state = {
    committed: false,
    rolledBack: false,
    lotQty: Number(lotOverrides.qty_remaining ?? 12),
    movements: [],
    events: [],
    uniqueViolationTriggered: false,
  };
  const lot = {
    id: ids.lot,
    store_id: ids.store,
    client_key: 'gc-test',
    article_id: ids.article,
    purchase_id: ids.purchase,
    purchase_line_id: ids.purchaseLine,
    supplier_id: ids.supplier,
    purchase_supplier_id: ids.supplier,
    qty_remaining: state.lotQty,
    unit_cost_ex_vat: 10,
    ...lotOverrides,
  };
  const expected = {
    id: ids.expected,
    store_id: ids.store,
    supplier_id: ids.supplier,
    source_purchase_id: ids.purchase,
    source_purchase_line_id: ids.purchaseLine,
    source_pennylane_supplier_invoice_id: null,
    ...expectedOverrides,
  };
  const credit = {
    id: ids.credit,
    store_id: ids.store,
    supplier_id: ids.supplier,
    document_type: 'credit_note',
    pennylane_deleted_at: null,
    ...creditOverrides,
  };
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      const compact = sql.replace(/\s+/g, ' ');
      if (/^BEGIN$/i.test(sql.trim())) return { rows: [] };
      if (/^COMMIT$/i.test(sql.trim())) {
        state.committed = true;
        return { rows: [] };
      }
      if (/^ROLLBACK$/i.test(sql.trim())) {
        state.rolledBack = true;
        return { rows: [] };
      }
      if (/FROM stock_movements\s+WHERE store_id = \$1 AND idempotency_key = \$2/i.test(compact)) {
        const movement = existingMovement || (state.uniqueViolationTriggered ? uniqueViolationMovement : null);
        return { rows: movement ? [movement] : [] };
      }
      if (/FROM supplier_expected_credit_notes/i.test(sql)) {
        return { rows: params[0] === ids.expected ? [expected] : [] };
      }
      if (/FROM pennylane_supplier_invoices/i.test(sql)) {
        return { rows: params[0] === ids.credit ? [credit] : [] };
      }
      if (/FROM purchases\s+WHERE id = \$1 AND store_id = \$2\s+FOR UPDATE/i.test(compact)) {
        return { rows: [{ id: ids.purchase, store_id: ids.store, supplier_id: ids.supplier }] };
      }
      if (/FROM lots l\s+JOIN purchase_lines pl/i.test(sql)) {
        return { rows: [lot] };
      }
      if (/UPDATE lots\s+SET qty_remaining = qty_remaining - \$1::numeric/i.test(compact)) {
        if (!updateSucceeds) return { rows: [], rowCount: 0 };
        state.lotQty = Number((state.lotQty - Number(params[0])).toFixed(3));
        return { rows: [{ ...lot, qty_remaining: state.lotQty }], rowCount: 1 };
      }
      if (/INSERT INTO stock_movements/i.test(sql)) {
        if (uniqueViolationMovement) {
          state.uniqueViolationTriggered = true;
          const error = new Error('duplicate key value violates unique constraint');
          error.code = '23505';
          throw error;
        }
        const movement = {
          id: 'movement-1',
          store_id: params[0],
          article_id: params[2],
          lot_id: params[3],
          movement_type: params[4],
          quantity: params[5],
          unit_cost_ex_vat: params[6],
          supplier_expected_credit_note_id: params[7],
          pennylane_credit_note_id: params[8],
          notes: params[9],
          purchase_id: params[11],
          purchase_line_id: params[12],
          supplier_id: params[13],
          idempotency_key: params[16],
        };
        state.movements.push(movement);
        return { rows: [movement], rowCount: 1 };
      }
      if (/INSERT INTO supplier_control_events/i.test(sql)) {
        state.events.push({ event_type: params[2], payload: JSON.parse(params[4]) });
        return { rows: [], rowCount: 1 };
      }
      if (/SELECT\s+COALESCE\(SUM\(qty_remaining\)/i.test(sql)) {
        return { rows: [{ qty: state.lotQty, value: state.lotQty * 10, next_dlc: null }] };
      }
      if (/INSERT INTO stock_summary/i.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return {
    calls,
    state,
    async connect() {
      return client;
    },
    async query(sql, params = []) {
      return client.query(sql, params);
    },
  };
}

async function assertRejectsWithCode(code, fn) {
  let error = null;
  try {
    await fn();
  } catch (err) {
    error = err;
  }
  assert.ok(error, `Expected rejection ${code}`);
  assert.strictEqual(error.code, code);
}

function payload(overrides = {}) {
  return {
    purchase_id: ids.purchase,
    purchase_line_id: ids.purchaseLine,
    lot_id: ids.lot,
    article_id: ids.article,
    supplier_id: ids.supplier,
    supplier_expected_credit_note_id: ids.expected,
    pennylane_credit_note_id: ids.credit,
    quantity: 5,
    notes: 'Action physique explicite',
    idempotency_key: 'stock-effect-1',
    ...overrides,
  };
}

async function testDestructionCreatesNegativeMovementAndRecomputesStock() {
  const db = createMockDb();
  const result = await createSupplierStockEffect(db, {
    storeId: ids.store,
    type: 'destruction',
    payload: payload(),
    userId: ids.user,
  });
  assert.strictEqual(result.idempotent, false);
  assert.strictEqual(db.state.lotQty, 7);
  assert.strictEqual(db.state.movements[0].movement_type, 'destruction');
  assert.strictEqual(db.state.movements[0].quantity, -5);
  assert.strictEqual(db.state.movements[0].supplier_expected_credit_note_id, ids.expected);
  assert.strictEqual(db.state.movements[0].pennylane_credit_note_id, ids.credit);
  assert.strictEqual(db.state.events[0].event_type, 'supplier_stock_destruction_created');
  const allSql = db.calls.map((call) => call.sql).join('\n');
  assertContains(allSql, /FROM purchases[\s\S]*FOR UPDATE/);
  assertContains(allSql, /FOR UPDATE OF l/);
  assert.ok(
    db.calls.findIndex((call) => /FROM purchases[\s\S]*FOR UPDATE/i.test(call.sql)) <
      db.calls.findIndex((call) => /FROM lots l[\s\S]*FOR UPDATE OF l/i.test(call.sql)),
    'Supplier stock effect must lock purchase before lot to match purchase rebuild ordering'
  );
  assertContains(allSql, /UPDATE lots\s+SET qty_remaining = qty_remaining - \$1::numeric/);
  assertContains(allSql, /INSERT INTO stock_summary/);
  assertNotContains(allSql, /UPDATE\s+purchases|UPDATE\s+purchase_lines|INSERT INTO supplier_invoices/i);
  assertNotContains(allSql, /UPDATE\s+pennylane_supplier_invoices|syncValidatedSupplierInvoiceStatusToPennylane/i);
}

async function testSupplierReturnCreatesNegativeMovementWithoutLegacyBlMutation() {
  const db = createMockDb();
  const result = await createSupplierStockEffect(db, {
    storeId: ids.store,
    type: 'supplier_return',
    payload: payload({ quantity: 3, idempotency_key: 'stock-effect-return' }),
    userId: ids.user,
  });
  assert.strictEqual(result.movement.movement_type, 'supplier_return');
  assert.strictEqual(result.movement.quantity, -3);
  assert.strictEqual(db.state.lotQty, 9);
  assert.strictEqual(db.state.events[0].event_type, 'supplier_stock_return_created');
}

async function testIdempotentRetryDoesNotDecrementTwice() {
  const existing = { id: 'movement-existing', quantity: -5, movement_type: 'destruction' };
  const db = createMockDb({ existingMovement: existing });
  const result = await createSupplierStockEffect(db, {
    storeId: ids.store,
    type: 'destruction',
    payload: payload(),
    userId: ids.user,
  });
  assert.strictEqual(result.idempotent, true);
  assert.deepStrictEqual(result.movement, existing);
  assert.strictEqual(db.state.movements.length, 0);
  assert.ok(!db.calls.some((call) => /UPDATE lots/i.test(call.sql)));
}

async function testConcurrentIdempotentRetryAfterUniqueViolationDoesNotReturn500() {
  const existing = { id: 'movement-concurrent', quantity: -5, movement_type: 'destruction', idempotency_key: 'stock-effect-1' };
  const db = createMockDb({ uniqueViolationMovement: existing });
  const result = await createSupplierStockEffect(db, {
    storeId: ids.store,
    type: 'destruction',
    payload: payload(),
    userId: ids.user,
  });
  assert.strictEqual(result.idempotent, true);
  assert.deepStrictEqual(result.movement, existing);
  assert.ok(db.state.rolledBack, 'The failed concurrent insert transaction must rollback before reading existing movement');
}

async function testValidationRejectsNegativeStockAndIncoherentLinks() {
  await assertRejectsWithCode('SUPPLIER_STOCK_EFFECT_QUANTITY_REQUIRED', () => createSupplierStockEffect(createMockDb(), {
    storeId: ids.store,
    type: 'destruction',
    payload: payload({ quantity: 0 }),
  }));
  await assertRejectsWithCode('SUPPLIER_STOCK_EFFECT_STOCK_INSUFFICIENT', () => createSupplierStockEffect(createMockDb({ lotOverrides: { qty_remaining: 2 } }), {
    storeId: ids.store,
    type: 'destruction',
    payload: payload({ quantity: 5 }),
  }));
  await assertRejectsWithCode('SUPPLIER_STOCK_EFFECT_ARTICLE_MISMATCH', () => createSupplierStockEffect(createMockDb({ lotOverrides: { article_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }), {
    storeId: ids.store,
    type: 'destruction',
    payload: payload(),
  }));
  await assertRejectsWithCode('SUPPLIER_STOCK_EFFECT_SUPPLIER_MISMATCH', () => createSupplierStockEffect(createMockDb({ lotOverrides: { supplier_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } }), {
    storeId: ids.store,
    type: 'supplier_return',
    payload: payload(),
  }));
  await assertRejectsWithCode('SUPPLIER_STOCK_EFFECT_EXPECTED_PURCHASE_MISMATCH', () => createSupplierStockEffect(createMockDb({ expectedOverrides: { source_purchase_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } }), {
    storeId: ids.store,
    type: 'destruction',
    payload: payload(),
  }));
  await assertRejectsWithCode('SUPPLIER_STOCK_EFFECT_CONCURRENT_STOCK_INSUFFICIENT', () => createSupplierStockEffect(createMockDb({ updateSucceeds: false }), {
    storeId: ids.store,
    type: 'destruction',
    payload: payload({ quantity: 5 }),
  }));
}

async function testOptionalFinancialLinksAreReallyOptional() {
  const db = createMockDb();
  await createSupplierStockEffect(db, {
    storeId: ids.store,
    type: 'destruction',
    payload: payload({
      supplier_expected_credit_note_id: null,
      pennylane_credit_note_id: null,
      idempotency_key: 'stock-effect-without-financial-link',
    }),
    userId: ids.user,
  });
  assert.strictEqual(db.state.movements[0].supplier_expected_credit_note_id, null);
  assert.strictEqual(db.state.movements[0].pennylane_credit_note_id, null);
  assert.strictEqual(db.state.events.length, 0);
}

async function testExpectedCreditNoteFromPurchaseWithoutPennylaneStillCreatesDestruction() {
  const db = createMockDb({
    expectedOverrides: {
      source_pennylane_supplier_invoice_id: null,
    },
  });
  await createSupplierStockEffect(db, {
    storeId: ids.store,
    type: 'destruction',
    payload: payload({
      pennylane_credit_note_id: null,
      idempotency_key: 'stock-effect-expected-without-pennylane',
    }),
    userId: ids.user,
  });
  assert.strictEqual(db.state.movements.length, 1);
  assert.strictEqual(db.state.movements[0].supplier_expected_credit_note_id, ids.expected);
  assert.strictEqual(db.state.movements[0].pennylane_credit_note_id, null);
  assert.strictEqual(db.state.events.length, 0);
  const allSql = db.calls.map((call) => call.sql).join('\n');
  assertContains(allSql, /INSERT INTO stock_movements/);
  assertContains(allSql, /INSERT INTO stock_summary/);
  assertNotContains(allSql, /INSERT INTO supplier_control_events/i);
}

async function testListStockEffectsForExpectedCreditNote() {
  const db = {
    async query(sql, params) {
      assertContains(sql, /supplier_expected_credit_note_id = \$2/);
      assert.deepStrictEqual(params, [ids.store, ids.expected]);
      return {
        rows: [
          { movement_type: 'destruction', quantity: -2 },
          { movement_type: 'supplier_return', quantity: -3 },
        ],
      };
    },
  };
  const result = await listStockEffectsForExpectedCreditNote(db, {
    storeId: ids.store,
    expectedCreditNoteId: ids.expected,
  });
  assert.strictEqual(result.totals.total_quantity, 5);
  assert.strictEqual(result.totals.destruction_quantity, 2);
  assert.strictEqual(result.totals.supplier_return_quantity, 3);
}

function testStaticContracts() {
  const service = read(servicePath);
  const expectedService = read(expectedServicePath);
  const route = read(routePath);
  const purchaseRoute = read(purchaseRoutePath);
  const migration = read(migrationPath);
  const rollback = read(rollbackPath);
  const supplierControlJs = read(supplierControlJsPath);
  const purchaseHtml = read(purchaseHtmlPath);
  const purchaseJs = read(purchaseJsPath);
  const dashboardTest = read(dashboardTestPath);

  assertContains(service, /FOR UPDATE OF l/);
  assertContains(service, /FROM purchases[\s\S]*FOR UPDATE/);
  assertContains(service, /ON CONFLICT DO NOTHING/);
  assertNotContains(service, /ON CONFLICT \(store_id, pennylane_supplier_invoice_id, event_key\)/);
  assertContains(service, /error\.code === '23505'/);
  assertContains(service, /if \(effect\.expectedCreditNoteId && eventDocumentId\)/);
  assertContains(service, /qty_remaining \+ 0\.0001 >= \$1::numeric/);
  assertContains(service, /movement_type IN \('destruction', 'supplier_return'\)/);
  assertContains(read(path.join(root, 'frontend/supplier-control.html')), /supplier-control\.js\?v=5/);
  assertContains(route, /\/supplier-control\/stock-effects\/destruction'.+requireAdminOrManager/s);
  assertContains(route, /\/supplier-control\/stock-effects\/supplier-return'.+requireAdminOrManager/s);
  assertContains(route, /\/supplier-control\/expected-credit-notes\/:id\/stock-effects/);
  assertContains(purchaseRoute, /stock_qty_remaining/);
  assertContains(purchaseHtml, /supplier-stock-effect-modal/);
  assertContains(purchaseHtml, /purchase-detail\.js\?v=12/);
  assertContains(purchaseJs, /openSupplierStockEffectModal/);
  assertContains(purchaseJs, /\/api\/supplier-control\/stock-effects\/.+destruction/);
  assertContains(supplierControlJs, /stock_effects/);
  assertContains(supplierControlJs, /stockEffectLineCandidatesForExpectedCreditNote/);
  assertContains(supplierControlJs, /stockEffectLine\.innerHTML = candidates\.map/);
  assertNotContains(supplierControlJs, /findStockEffectLineForExpectedCreditNote\(note\)[\s\S]{0,200}payload/);
  assertContains(migration, /supplier_expected_credit_note_id uuid REFERENCES supplier_expected_credit_notes/);
  assertContains(migration, /pennylane_credit_note_id uuid REFERENCES pennylane_supplier_invoices/);
  assertContains(migration, /ux_stock_movements_supplier_control_idempotency/);
  assertContains(rollback, /DROP COLUMN IF EXISTS supplier_expected_credit_note_id/);
  assertContains(dashboardTest, /gross_purchases_ht, 100/);
  assertContains(dashboardTest, /supplier_credit_notes_applied_ht, 150/);
  assertContains(dashboardTest, /purchases_ht, -50/);
  assertNotContains(expectedService, /supplierStockEffectService|createSupplierStockEffect|INSERT INTO stock_movements/i);
}

function testEventTypeConstraintOnlyExtendsPreviousDomain() {
  const previous = extractSupplierControlEventTypes(read(previousConstraintPath));
  const next = extractSupplierControlEventTypes(read(migrationPath));
  const rollback = extractSupplierControlEventTypes(read(rollbackPath));
  const added = next.filter((type) => !previous.includes(type)).sort();
  const removed = previous.filter((type) => !next.includes(type));

  assert.deepStrictEqual(removed, [], 'Migration 117 must not remove existing supplier_control_events.event_type values');
  assert.deepStrictEqual(added, [
    'supplier_stock_destruction_created',
    'supplier_stock_return_created',
  ]);
  assert.deepStrictEqual(rollback, previous, 'Rollback 117 must restore the exact previous event_type domain');
}

function testNormalizePayloadAliases() {
  const normalized = normalizeStockEffectPayload({
    expected_credit_note_id: ids.expected,
    credit_note_id: ids.credit,
    quantity: '4,5',
    comment: 'x',
  });
  assert.strictEqual(normalized.expectedCreditNoteId, ids.expected);
  assert.strictEqual(normalized.pennylaneCreditNoteId, ids.credit);
  assert.strictEqual(normalized.quantity, 4.5);
  assert.strictEqual(normalized.notes, 'x');
}

(async () => {
  testNormalizePayloadAliases();
  await testDestructionCreatesNegativeMovementAndRecomputesStock();
  await testSupplierReturnCreatesNegativeMovementWithoutLegacyBlMutation();
  await testIdempotentRetryDoesNotDecrementTwice();
  await testConcurrentIdempotentRetryAfterUniqueViolationDoesNotReturn500();
  await testValidationRejectsNegativeStockAndIncoherentLinks();
  await testOptionalFinancialLinksAreReallyOptional();
  await testExpectedCreditNoteFromPurchaseWithoutPennylaneStillCreatesDestruction();
  await testListStockEffectsForExpectedCreditNote();
  testStaticContracts();
  testEventTypeConstraintOnlyExtendsPreviousDomain();
  console.log('OK supplier stock effects tests');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
