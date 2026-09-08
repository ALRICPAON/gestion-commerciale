const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  addPurchaseLink,
  removePurchaseLink,
  canonicalSupplierControlStatus,
  recalculateSupplierControl,
  supplierControlMatchSignature,
  totalsFromDocumentAndLinks,
  validateSupplierControlDocument,
} = require('../services/supplierControlService');

const servicePath = path.join(__dirname, '../services/supplierControlService.js');
const routePath = path.join(__dirname, '../routes/supplierControl.js');
const pennylaneStatusSyncPath = path.join(__dirname, '../services/pennylane/supplierInvoiceStatusSync.js');
const migrationPath = path.join(__dirname, '../db/gestion-commerciale/114_supplier_control_validation_events.sql');
const reconciliationMigrationPath = path.join(__dirname, '../db/gestion-commerciale/115_supplier_control_reconciliation_status.sql');

const ids = {
  store: '00000000-0000-4000-8000-000000000001',
  user: '00000000-0000-4000-8000-000000000010',
  doc: '00000000-0000-4000-8000-000000000100',
  supplier: '00000000-0000-4000-8000-000000000200',
  purchase1: '00000000-0000-4000-8000-000000000300',
  purchase2: '00000000-0000-4000-8000-000000000301',
};

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function document(overrides = {}) {
  return {
    id: ids.doc,
    store_id: ids.store,
    pennylane_supplier_invoice_id: 'pl-supplier-invoice-1',
    supplier_id: ids.supplier,
    invoice_number: 'FAC-1',
    document_type: 'invoice',
    invoice_date: '2026-09-08',
    amount_ex_vat: 100,
    amount_vat: 20,
    amount_inc_vat: 120,
    payment_status: null,
    paid: false,
    alta_business_status: 'a_rapprocher',
    supplier_control_status: 'a_rapprocher',
    pennylane_deleted_at: null,
    ...overrides,
  };
}

function purchase(overrides = {}) {
  return {
    id: ids.purchase1,
    store_id: ids.store,
    supplier_id: ids.supplier,
    status: 'received',
    total_amount_ex_vat: 100,
    purchase_lines_total_ex_vat: 100,
    bl_number: 'BL-1',
    ...overrides,
  };
}

function link(overrides = {}) {
  const rowPurchase = purchase(overrides.purchase || {});
  return {
    id: overrides.id || `link-${rowPurchase.id}`,
    store_id: ids.store,
    pennylane_supplier_invoice_id: ids.doc,
    purchase_id: rowPurchase.id,
    purchase_line_id: null,
    link_type: 'invoice_match',
    match_status: overrides.match_status || 'matched',
    amount_difference: overrides.amount_difference ?? 0,
    purchase_total_ex_vat: rowPurchase.total_amount_ex_vat,
    purchase_lines_total_ex_vat: rowPurchase.purchase_lines_total_ex_vat,
    purchase_status: rowPurchase.status,
    purchase_supplier_id: rowPurchase.supplier_id,
    ...overrides,
  };
}

function createMockDb({
  doc = document(),
  links = [link()],
  events = [],
  purchases = [purchase()],
  incompatibleLinks = [],
  legacyLocked = [],
} = {}) {
  const calls = [];
  const state = {
    doc: doc ? { ...doc } : null,
    links: links.map((item) => ({ ...item })),
    events: events.map((item) => ({ ...item })),
    purchases: purchases.map((item) => ({ ...item })),
  };

  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    const compact = sql.replace(/\s+/g, ' ');

    if (/BEGIN|COMMIT|ROLLBACK/i.test(sql.trim())) return { rows: [] };

    if (/FROM pennylane_supplier_invoices psi/i.test(sql)) {
      if (!state.doc) return { rows: [] };
      if (params[1] && params[1] !== state.doc.store_id) return { rows: [] };
      return { rows: [{ ...state.doc }] };
    }

    if (/FROM supplier_control_document_links scl/i.test(sql) && /LEFT JOIN purchases p/i.test(sql)) {
      return { rows: state.links.filter((item) => item.match_status !== 'removed').map((item) => ({ ...item })) };
    }

    if (/FROM supplier_control_events/i.test(sql) && /ORDER BY created_at/i.test(sql)) {
      return { rows: state.events.slice().reverse().map((item) => ({ ...item })) };
    }

    if (/FROM purchases p/i.test(sql) && /FOR UPDATE OF p/i.test(sql)) {
      const found = state.purchases.find((item) => item.id === params[0] && item.store_id === params[1]);
      return { rows: found ? [{ ...found }] : [] };
    }

    if (/JOIN pennylane_supplier_invoices linked_psi/i.test(sql)) return { rows: incompatibleLinks };
    if (/FROM supplier_invoice_matches sim/i.test(sql)) return { rows: legacyLocked };

    if (/INSERT INTO supplier_control_events/i.test(sql)) {
      if (params[3] && state.events.some((event) => event.event_key === params[3])) return { rows: [], rowCount: 0 };
      state.events.push({
        id: `event-${state.events.length + 1}`,
        event_type: params[2],
        event_key: params[3],
        payload: params[4] ? JSON.parse(params[4]) : {},
      });
      return { rows: [], rowCount: 1 };
    }

    if (/UPDATE pennylane_supplier_invoices/i.test(sql) && /payment_status = \$1/i.test(compact)) {
      state.doc.payment_status = params[0];
      state.doc.supplier_control_status = params[1];
      if (params[0] === 'paid') state.doc.paid = true;
      return { rows: [] };
    }

    if (/UPDATE pennylane_supplier_invoices/i.test(sql) && /supplier_control_status/i.test(sql)) {
      state.doc.supplier_control_status = params[0];
      return { rows: [] };
    }

    return { rows: [] };
  };

  return {
    calls,
    state,
    async query(sql, params) { return query(sql, params); },
    async connect() {
      return { query, release() {} };
    },
  };
}

async function assertRejectsWithCode(code, fn) {
  let rejected = false;
  try {
    await fn();
  } catch (error) {
    rejected = true;
    assert.strictEqual(error.code, code);
  }
  assert.strictEqual(rejected, true, `Expected rejection ${code}`);
}

async function captureRejectsWithCode(code, fn) {
  try {
    await fn();
  } catch (error) {
    assert.strictEqual(error.code, code);
    return error;
  }
  assert.fail(`Expected rejection ${code}`);
}

function acceptedDifferenceEvent(doc, links) {
  const totals = totalsFromDocumentAndLinks(doc, links);
  const signature = supplierControlMatchSignature(doc, links, totals);
  return {
    event_type: 'difference_accepted',
    event_key: `difference_accepted:${signature.match_signature}`,
    payload: {
      purchase_ids: signature.purchase_ids,
      amount_difference: signature.amount_difference,
      match_signature: signature.match_signature,
    },
  };
}

async function testConformValidationUpdatesOnlyPaymentStatus() {
  const db = createMockDb();
  const pennylaneCalls = [];
  const result = await validateSupplierControlDocument(db, {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
    userId: ids.user,
    syncPennylaneStatus: async (payload) => {
      pennylaneCalls.push(payload);
      return { ok: true, payment_status: 'to_be_paid' };
    },
  });

  assert.strictEqual(pennylaneCalls.length, 1);
  assert.deepStrictEqual(Object.keys(pennylaneCalls[0]).sort(), ['invoiceId', 'pennylaneSupplierInvoiceId', 'storeId'].sort());
  assert.strictEqual(db.state.doc.payment_status, 'to_be_paid');
  assert.strictEqual(db.state.doc.supplier_control_status, 'valide_a_payer');
  assert.strictEqual(result.summary.can_validate, false);
  assert.ok(result.summary.blocking_reasons.includes('already_validated'));
  assert.ok(db.state.events.some((event) => event.event_type === 'validation_requested'));
  assert.ok(db.state.events.some((event) => event.event_type === 'validation_succeeded'));
}

async function testAcceptedCurrentDifferenceCanValidate() {
  const doc = document({ amount_ex_vat: 110 });
  const links = [link({ purchase: purchase({ total_amount_ex_vat: 100, purchase_lines_total_ex_vat: 100 }) })];
  const db = createMockDb({ doc, links, events: [acceptedDifferenceEvent(doc, links)] });
  const result = await validateSupplierControlDocument(db, {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
    syncPennylaneStatus: async () => ({ ok: true }),
  });
  assert.strictEqual(result.validation.status, 'succeeded');
  assert.strictEqual(db.state.doc.supplier_control_status, 'valide_a_payer');
}

async function testStaleDifferenceAcceptanceIsRefused() {
  const oldDoc = document({ amount_ex_vat: 110 });
  const oldLinks = [link({ purchase: purchase({ total_amount_ex_vat: 100, purchase_lines_total_ex_vat: 100 }) })];
  const stale = acceptedDifferenceEvent(oldDoc, oldLinks);
  const newLinks = [link({ purchase: purchase({ total_amount_ex_vat: 30, purchase_lines_total_ex_vat: 30 }) })];
  await assertRejectsWithCode('SUPPLIER_CONTROL_VALIDATION_BLOCKED', () => validateSupplierControlDocument(createMockDb({
    doc: document({ amount_ex_vat: 110 }),
    links: newLinks,
    events: [stale],
    purchases: [purchase({ total_amount_ex_vat: 30, purchase_lines_total_ex_vat: 30 })],
  }), {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
    syncPennylaneStatus: async () => {
      throw new Error('must not call Pennylane');
    },
  }));
}

async function testBusinessBlocksAndConfirmation() {
  await assertRejectsWithCode('SUPPLIER_CONTROL_VALIDATION_CONFIRMATION_REQUIRED', () => validateSupplierControlDocument(createMockDb(), {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: false,
  }));
  await assertRejectsWithCode('SUPPLIER_CONTROL_VALIDATION_BLOCKED', () => validateSupplierControlDocument(createMockDb({ links: [] }), {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
  }));
  await assertRejectsWithCode('SUPPLIER_CONTROL_VALIDATION_BLOCKED', () => validateSupplierControlDocument(createMockDb({
    doc: document({ supplier_control_status: 'litige' }),
  }), {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
  }));
  await assertRejectsWithCode('SUPPLIER_CONTROL_CREDIT_NOTE_VALIDATION_NOT_SUPPORTED', () => validateSupplierControlDocument(createMockDb({
    doc: document({ document_type: 'credit_note' }),
  }), {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
  }));
  await assertRejectsWithCode('SUPPLIER_CONTROL_PENNYLANE_ID_MISSING', () => validateSupplierControlDocument(createMockDb({
    doc: document({ pennylane_supplier_invoice_id: null }),
  }), {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
  }));
}

async function testAlreadyToBePaidAndPaidAreIdempotent() {
  let called = false;
  let result = await validateSupplierControlDocument(createMockDb({
    doc: document({ payment_status: 'to_be_paid', supplier_control_status: 'a_rapprocher' }),
  }), {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
    syncPennylaneStatus: async () => { called = true; },
  });
  assert.strictEqual(called, false);
  assert.strictEqual(result.document.supplier_control_status, 'valide_a_payer');
  assert.ok(result.summary.blocking_reasons.includes('already_validated'));

  called = false;
  result = await validateSupplierControlDocument(createMockDb({
    doc: document({ payment_status: 'paid', supplier_control_status: 'a_rapprocher' }),
  }), {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
    syncPennylaneStatus: async () => { called = true; },
  });
  assert.strictEqual(called, false);
  assert.strictEqual(result.document.supplier_control_status, 'paye');
  assert.ok(result.summary.blocking_reasons.includes('already_paid'));
}

async function testConcurrentIntentAndRetryAfterFailure() {
  const doc = document();
  const links = [link()];
  const signature = supplierControlMatchSignature(doc, links, totalsFromDocumentAndLinks(doc, links));
  let syncCalled = false;
  await assertRejectsWithCode('SUPPLIER_CONTROL_VALIDATION_IN_PROGRESS', () => validateSupplierControlDocument(createMockDb({
    doc,
    links,
    events: [{ event_type: 'validation_requested', created_at: new Date().toISOString(), payload: { match_signature: signature.match_signature } }],
  }), {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
    fetchPennylanePaymentStatus: async () => ({ payment_status: 'pending' }),
    syncPennylaneStatus: async () => {
      syncCalled = true;
    },
  }));
  assert.strictEqual(syncCalled, false);

  const db = createMockDb({
    doc,
    links,
    events: [
      { event_type: 'validation_requested', payload: { match_signature: signature.match_signature } },
      { event_type: 'validation_failed', payload: { match_signature: signature.match_signature } },
    ],
  });
  let called = false;
  await validateSupplierControlDocument(db, {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
    fetchPennylanePaymentStatus: async () => ({ payment_status: 'pending' }),
    syncPennylaneStatus: async () => { called = true; return { ok: true }; },
  });
  assert.strictEqual(called, true);
}

async function testOrphanedRequestedRecoveredFromRemoteToBePaid() {
  const doc = document();
  const links = [link()];
  const signature = supplierControlMatchSignature(doc, links, totalsFromDocumentAndLinks(doc, links));
  const db = createMockDb({
    doc,
    links,
    events: [{ event_type: 'validation_requested', created_at: new Date().toISOString(), payload: { match_signature: signature.match_signature } }],
  });
  let syncCalled = false;
  const result = await validateSupplierControlDocument(db, {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
    fetchPennylanePaymentStatus: async () => ({ payment_status: 'to_be_paid', paid: false }),
    syncPennylaneStatus: async () => { syncCalled = true; },
  });
  assert.strictEqual(syncCalled, false);
  assert.strictEqual(result.validation.status, 'recovered');
  assert.strictEqual(db.state.doc.payment_status, 'to_be_paid');
  assert.strictEqual(db.state.doc.supplier_control_status, 'valide_a_payer');
  assert.ok(db.state.events.some((event) => event.event_type === 'validation_already_applied'));
}

async function testOrphanedRequestedRecoveredFromRemotePaidWithoutDowngrade() {
  const doc = document();
  const links = [link()];
  const signature = supplierControlMatchSignature(doc, links, totalsFromDocumentAndLinks(doc, links));
  const db = createMockDb({
    doc,
    links,
    events: [{ event_type: 'validation_requested', created_at: new Date().toISOString(), payload: { match_signature: signature.match_signature } }],
  });
  let syncCalled = false;
  const result = await validateSupplierControlDocument(db, {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
    fetchPennylanePaymentStatus: async () => ({ payment_status: 'paid', paid: true }),
    syncPennylaneStatus: async () => { syncCalled = true; },
  });
  assert.strictEqual(syncCalled, false);
  assert.strictEqual(result.validation.status, 'recovered');
  assert.strictEqual(db.state.doc.payment_status, 'paid');
  assert.strictEqual(db.state.doc.supplier_control_status, 'paye');
  assert.strictEqual(db.state.doc.paid, true);
}

async function testLostResponseAfterRemoteSuccessIsRecoveredOnRetry() {
  const db = createMockDb();
  await assertRejectsWithCode('SUPPLIER_CONTROL_PENNYLANE_VALIDATION_FAILED', () => validateSupplierControlDocument(db, {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
    syncPennylaneStatus: async () => {
      const error = new Error('socket hang up after remote accepted');
      error.status = 502;
      throw error;
    },
  }));
  assert.strictEqual(db.state.doc.payment_status, null);
  assert.ok(db.state.events.some((event) => event.event_type === 'validation_requested'));
  assert.ok(db.state.events.some((event) => event.event_type === 'validation_failed'));

  let syncCalled = false;
  const recovered = await validateSupplierControlDocument(db, {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
    fetchPennylanePaymentStatus: async () => ({ payment_status: 'to_be_paid' }),
    syncPennylaneStatus: async () => { syncCalled = true; },
  });
  assert.strictEqual(syncCalled, false);
  assert.strictEqual(recovered.validation.status, 'recovered');
  assert.strictEqual(db.state.doc.payment_status, 'to_be_paid');
  assert.strictEqual(db.state.doc.supplier_control_status, 'valide_a_payer');
}

async function testPennylaneFailureDoesNotValidateAlta() {
  const db = createMockDb();
  await assertRejectsWithCode('SUPPLIER_CONTROL_PENNYLANE_VALIDATION_FAILED', () => validateSupplierControlDocument(db, {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
    syncPennylaneStatus: async () => {
      const error = new Error('Pennylane 500');
      error.status = 500;
      throw error;
    },
  }));
  assert.notStrictEqual(db.state.doc.supplier_control_status, 'valide_a_payer');
  assert.strictEqual(db.state.doc.payment_status, null);
  assert.ok(db.state.events.some((event) => event.event_type === 'validation_failed'));
}

async function testFinalizationDetectsLinkChangeAfterPennylaneSuccess() {
  const db = createMockDb({
    purchases: [
      purchase({ id: ids.purchase1, total_amount_ex_vat: 100, purchase_lines_total_ex_vat: 100 }),
      purchase({ id: ids.purchase2, total_amount_ex_vat: 100, purchase_lines_total_ex_vat: 100 }),
    ],
  });
  let syncCalls = 0;
  const error = await captureRejectsWithCode('SUPPLIER_CONTROL_VALIDATION_RECONCILIATION_REQUIRED', () => validateSupplierControlDocument(db, {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
    syncPennylaneStatus: async () => {
      syncCalls += 1;
      db.state.links.push(link({
        id: 'link-after-sync',
        purchase: purchase({ id: ids.purchase2, total_amount_ex_vat: 100, purchase_lines_total_ex_vat: 100 }),
      }));
      return { ok: true, payment_status: 'to_be_paid' };
    },
  }));
  assert.strictEqual(syncCalls, 1);
  assert.strictEqual(db.state.doc.payment_status, 'to_be_paid');
  assert.strictEqual(db.state.doc.supplier_control_status, 'reconciliation_required');
  assert.ok(error.details.summary.blocking_reasons.includes('validation_reconciliation_required'));
  assert.ok(db.state.events.some((event) => event.event_type === 'validation_reconciliation_required'));
}

async function testFinalizationDetectsPurchaseTotalChangeAfterPennylaneSuccess() {
  const db = createMockDb();
  await captureRejectsWithCode('SUPPLIER_CONTROL_VALIDATION_RECONCILIATION_REQUIRED', () => validateSupplierControlDocument(db, {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
    syncPennylaneStatus: async () => {
      db.state.links[0].purchase_total_ex_vat = 80;
      db.state.links[0].purchase_lines_total_ex_vat = 80;
      db.state.purchases[0].total_amount_ex_vat = 80;
      db.state.purchases[0].purchase_lines_total_ex_vat = 80;
      return { ok: true, payment_status: 'to_be_paid' };
    },
  }));
  assert.strictEqual(db.state.doc.payment_status, 'to_be_paid');
  assert.strictEqual(db.state.doc.supplier_control_status, 'reconciliation_required');
}

async function testFinalizationDetectsLinkRemovalAfterPennylaneSuccess() {
  const db = createMockDb();
  await captureRejectsWithCode('SUPPLIER_CONTROL_VALIDATION_RECONCILIATION_REQUIRED', () => validateSupplierControlDocument(db, {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
    syncPennylaneStatus: async () => {
      db.state.links[0].match_status = 'removed';
      return { ok: true, payment_status: 'to_be_paid' };
    },
  }));
  assert.strictEqual(db.state.doc.payment_status, 'to_be_paid');
  assert.strictEqual(db.state.doc.supplier_control_status, 'reconciliation_required');
}

async function testUnchangedSignatureStillFinalizesNormally() {
  const db = createMockDb();
  const result = await validateSupplierControlDocument(db, {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
    syncPennylaneStatus: async () => ({ ok: true, payment_status: 'to_be_paid' }),
  });
  assert.strictEqual(result.validation.status, 'succeeded');
  assert.strictEqual(db.state.doc.supplier_control_status, 'valide_a_payer');
  assert.ok(!db.state.events.some((event) => event.event_type === 'validation_reconciliation_required'));
}

async function testPaidDuringFinalizationIsNeverDowngraded() {
  const db = createMockDb();
  let syncCalls = 0;
  const result = await validateSupplierControlDocument(db, {
    storeId: ids.store,
    documentId: ids.doc,
    confirmation: true,
    syncPennylaneStatus: async () => {
      syncCalls += 1;
      db.state.doc.payment_status = 'paid';
      db.state.doc.paid = true;
      db.state.doc.supplier_control_status = 'a_controler';
      return { ok: true, payment_status: 'to_be_paid' };
    },
  });
  assert.strictEqual(syncCalls, 1);
  assert.strictEqual(result.document.supplier_control_status, 'paye');
  assert.strictEqual(db.state.doc.payment_status, 'paid');
  assert.strictEqual(db.state.doc.supplier_control_status, 'paye');
}

async function testPaidInboundSyncAndLocks() {
  const db = createMockDb({ doc: document({ payment_status: 'paid', supplier_control_status: 'a_controler' }) });
  const summary = await recalculateSupplierControl(db, { storeId: ids.store, documentId: ids.doc });
  assert.strictEqual(summary.control_status, 'paye');
  assert.strictEqual(db.state.doc.supplier_control_status, 'paye');
  await assertRejectsWithCode('SUPPLIER_CONTROL_DOCUMENT_LINKS_LOCKED', () => addPurchaseLink(db, {
    storeId: ids.store,
    documentId: ids.doc,
    purchaseId: ids.purchase1,
  }));
  await assertRejectsWithCode('SUPPLIER_CONTROL_DOCUMENT_LINKS_LOCKED', () => removePurchaseLink(db, {
    storeId: ids.store,
    documentId: ids.doc,
    purchaseId: ids.purchase1,
  }));
}

function testStaticGuards() {
  const route = read(routePath);
  const service = read(servicePath);
  const statusSync = read(pennylaneStatusSyncPath);
  const migration = read(migrationPath);
  const reconciliationMigration = read(reconciliationMigrationPath);

  assert.match(route, /router\.post\('\/supplier-control\/documents\/:id\/validate'/);
  assert.match(route, /validateSupplierControlDocument/);
  assert.match(route, /requireAdminOrManager/);
  assert.match(service, /syncValidatedSupplierInvoiceStatusToPennylane/);
  assert.match(statusSync, /client\.put\(endpoint, \{ payment_status: VALIDATED_PAYMENT_STATUS \}\)/);
  assert.ok(!/client\.(post|delete)\(/i.test(statusSync), 'Validation status sync must not create or delete Pennylane invoices');
  assert.ok(!/invoice_lines|supplier_invoice_lines/i.test(statusSync), 'Validation status sync must not mutate invoice content');
  for (const eventType of ['validation_requested', 'validation_succeeded', 'validation_failed', 'validation_already_applied', 'validation_reconciliation_required']) {
    assert.match(migration, new RegExp(eventType));
  }
  assert.match(reconciliationMigration, /reconciliation_required/);
}

(async () => {
  assert.strictEqual(canonicalSupplierControlStatus({ payment_status: 'to_be_paid' }), 'valide_a_payer');
  await testConformValidationUpdatesOnlyPaymentStatus();
  await testAcceptedCurrentDifferenceCanValidate();
  await testStaleDifferenceAcceptanceIsRefused();
  await testBusinessBlocksAndConfirmation();
  await testAlreadyToBePaidAndPaidAreIdempotent();
  await testConcurrentIntentAndRetryAfterFailure();
  await testOrphanedRequestedRecoveredFromRemoteToBePaid();
  await testOrphanedRequestedRecoveredFromRemotePaidWithoutDowngrade();
  await testLostResponseAfterRemoteSuccessIsRecoveredOnRetry();
  await testPennylaneFailureDoesNotValidateAlta();
  await testFinalizationDetectsLinkChangeAfterPennylaneSuccess();
  await testFinalizationDetectsPurchaseTotalChangeAfterPennylaneSuccess();
  await testFinalizationDetectsLinkRemovalAfterPennylaneSuccess();
  await testUnchangedSignatureStillFinalizesNormally();
  await testPaidDuringFinalizationIsNeverDowngraded();
  await testPaidInboundSyncAndLocks();
  testStaticGuards();
  console.log('OK supplier control validation tests');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
