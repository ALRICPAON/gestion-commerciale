const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  EXPECTED_CREDIT_NOTE_REASON_TYPES,
  EXPECTED_CREDIT_NOTE_STATUSES,
  applyCreditNoteMatch,
  createExpectedCreditNote,
  removeCreditNoteLink,
} = require('../services/supplierExpectedCreditNoteService');

const root = path.join(__dirname, '../..');
const servicePath = path.join(root, 'backend/services/supplierExpectedCreditNoteService.js');
const supplierControlServicePath = path.join(root, 'backend/services/supplierControlService.js');
const routePath = path.join(root, 'backend/routes/supplierControl.js');
const migrationPath = path.join(root, 'backend/db/gestion-commerciale/116_supplier_expected_credit_notes.sql');
const rollbackPath = path.join(root, 'backend/db/gestion-commerciale/116_supplier_expected_credit_notes_rollback.sql');
const supplierControlHtmlPath = path.join(root, 'frontend/supplier-control.html');
const supplierControlJsPath = path.join(root, 'frontend/js/supplier-control.js');
const purchaseHtmlPath = path.join(root, 'frontend/purchase-detail.html');
const purchaseJsPath = path.join(root, 'frontend/js/purchase-detail.js');
const reconcileScriptPath = path.join(root, 'backend/scripts/reconcile-expected-credit-notes-from-purchase-links.js');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function assertContains(source, pattern, message) {
  assert.match(source, pattern, message || `Missing ${pattern}`);
}

function assertNotContains(source, pattern, message) {
  assert.ok(!pattern.test(source), message || `Unexpected ${pattern}`);
}

const ids = {
  store: '11111111-1111-4111-8111-111111111111',
  supplier: '22222222-2222-4222-8222-222222222222',
  purchase: '33333333-3333-4333-8333-333333333333',
  purchaseLine: '44444444-4444-4444-8444-444444444444',
  invoice: '55555555-5555-4555-8555-555555555555',
  credit: '66666666-6666-4666-8666-666666666666',
  user: '77777777-7777-4777-8777-777777777777',
};

function createMockDb({
  duplicate = false,
  supplierMismatch = false,
  linkedInvoiceFromPurchase = false,
  linkedInvoiceRows = null,
  invoiceOverrides = {},
  expectedOverrides = {},
} = {}) {
  const queries = [];
  const state = { inserted: null, invoiceStatusUpdates: [] };
  const invoice = {
    id: ids.invoice,
    store_id: ids.store,
    supplier_id: ids.supplier,
    document_type: 'invoice',
    amount_ex_vat: 949.5,
    payment_status: 'pending',
    paid: false,
    supplier_control_status: 'conforme',
    invoice_number: '511260004713',
    ...invoiceOverrides,
  };
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      const compact = sql.replace(/\s+/g, ' ');
      if (/BEGIN|COMMIT|ROLLBACK/.test(compact)) return { rows: [], rowCount: 0 };
      if (/FROM supplier_expected_credit_notes\s+WHERE store_id/i.test(sql)) {
        return duplicate ? { rows: [{ id: 'existing-note', idempotency_key: params[1] }] } : { rows: [] };
      }
      if (/FROM purchases p/i.test(sql)) {
        return { rows: [{ id: ids.purchase, store_id: ids.store, supplier_id: supplierMismatch ? ids.credit : ids.supplier, total_amount_ex_vat: 949.5, bl_number: '511-00081293' }] };
      }
      if (/FROM purchase_lines pl/i.test(sql)) {
        return { rows: [{ id: ids.purchaseLine, purchase_id: ids.purchase, store_id: ids.store, article_id: 'article-id', article_name: 'QUEUE DE LOTTE' }] };
      }
      if (/FROM supplier_control_document_links scl/i.test(sql) && /JOIN pennylane_supplier_invoices psi/i.test(sql)) {
        if (linkedInvoiceRows) return { rows: linkedInvoiceRows };
        return { rows: linkedInvoiceFromPurchase ? [invoice] : [] };
      }
      if (/FROM pennylane_supplier_invoices psi/i.test(sql)) {
        return { rows: [invoice] };
      }
      if (/SELECT id FROM suppliers/i.test(sql)) return { rows: [{ id: ids.supplier }] };
      if (/INSERT INTO supplier_expected_credit_notes/i.test(sql)) {
        state.inserted = {
          id: 'expected-note-id',
          store_id: ids.store,
          supplier_id: ids.supplier,
          source_purchase_id: ids.purchase,
          source_purchase_line_id: ids.purchaseLine,
          source_pennylane_supplier_invoice_id: params[4],
          expected_amount_ex_vat: params[5],
          reason_type: 'price_error',
          reason_comment: '151 EUR/kg au lieu de 15,10 EUR/kg',
          affected_quantity: 3,
          affected_unit: 'kg',
          status: 'pending',
          ...expectedOverrides,
        };
        return { rows: [state.inserted], rowCount: 1 };
      }
      if (/INSERT INTO supplier_control_events/i.test(sql)) return { rows: [], rowCount: 1 };
      if (/WITH linked_purchases AS/i.test(sql)) {
        return {
          rows: [{
            purchase_total_ex_vat: 949.5,
            applied_credit_note_total_ex_vat: 0,
            remaining_expected_credit_note_total_ex_vat: 407.7,
          }],
        };
      }
      if (/UPDATE pennylane_supplier_invoices/i.test(sql)) {
        if (/supplier_control_status = \$1/i.test(compact)) state.invoiceStatusUpdates.push(params[0]);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return {
    queries,
    state,
    async connect() {
      return client;
    },
  };
}

async function assertRejects(pattern, fn) {
  let thrown = null;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, 'Expected rejection');
  assert.match(thrown.message, pattern);
}

function testContractConstants() {
  ['pending', 'matched', 'resolved', 'cancelled', 'disputed'].forEach((status) => {
    assert.ok(EXPECTED_CREDIT_NOTE_STATUSES.has(status));
  });
  ['price_error', 'quality_issue', 'quantity_issue', 'missing_goods', 'supplier_return', 'other'].forEach((reason) => {
    assert.ok(EXPECTED_CREDIT_NOTE_REASON_TYPES.has(reason));
  });
}

async function testCreateExpectedCreditNoteFromPurchase() {
  const db = createMockDb();
  const result = await createExpectedCreditNote(db, {
    storeId: ids.store,
    userId: ids.user,
    payload: {
      source_purchase_id: ids.purchase,
      source_purchase_line_id: ids.purchaseLine,
      source_pennylane_supplier_invoice_id: ids.invoice,
      expected_amount_ex_vat: 100,
      reason_type: 'price_error',
      reason_comment: 'Prix facture trop eleve',
      affected_quantity: 10,
      affected_unit: 'kg',
      idempotency_key: 'ui-request-1',
    },
  });
  assert.strictEqual(result.expected_credit_note.id, 'expected-note-id');
  const allSql = db.queries.map((call) => call.sql).join('\n');
  assertContains(allSql, /FOR UPDATE OF p/);
  assertContains(allSql, /INSERT INTO supplier_expected_credit_notes/);
  assertContains(allSql, /INSERT INTO supplier_control_events/);
  assertNotContains(allSql, /stock_movements|stock_lots|stock_quantity|UPDATE\s+purchase_lines/i);
}

async function testExpectedCreditNoteFromLinkedPurchaseAttachesAndRecalculatesInvoice() {
  const db = createMockDb({ linkedInvoiceFromPurchase: true });
  const result = await createExpectedCreditNote(db, {
    storeId: ids.store,
    userId: ids.user,
    payload: {
      source_purchase_id: ids.purchase,
      source_purchase_line_id: ids.purchaseLine,
      expected_amount_ex_vat: 407.7,
      reason_type: 'price_error',
      reason_comment: '151 EUR/kg au lieu de 15,10 EUR/kg',
      affected_quantity: 3,
      affected_unit: 'kg',
      idempotency_key: 'sogelmer-linked-purchase',
    },
  });
  assert.strictEqual(result.expected_credit_note.source_pennylane_supplier_invoice_id, ids.invoice);
  assert.deepStrictEqual(db.state.invoiceStatusUpdates, ['avoir_attendu']);
  const allSql = db.queries.map((call) => call.sql).join('\n');
  assertContains(allSql, /FROM supplier_control_document_links scl[\s\S]*JOIN pennylane_supplier_invoices psi/);
  assertContains(allSql, /WITH linked_purchases AS/);
  assertNotContains(allSql, /payment_status\s*=\s*'to_be_paid'|payment_status\s*=\s*\$1/i);
}

async function testExpectedCreditNoteFromLinkedPurchaseKeepsPennylaneToBePaid() {
  const db = createMockDb({
    linkedInvoiceFromPurchase: true,
    invoiceOverrides: { payment_status: 'to_be_paid', supplier_control_status: 'valide_a_payer' },
  });
  const result = await createExpectedCreditNote(db, {
    storeId: ids.store,
    userId: ids.user,
    payload: {
      source_purchase_id: ids.purchase,
      expected_amount_ex_vat: 407.7,
      reason_type: 'price_error',
      reason_comment: '151 EUR/kg au lieu de 15,10 EUR/kg',
      affected_quantity: 3,
      affected_unit: 'kg',
      idempotency_key: 'sogelmer-to-be-paid',
    },
  });
  assert.strictEqual(result.expected_credit_note.source_pennylane_supplier_invoice_id, ids.invoice);
  assert.deepStrictEqual(db.state.invoiceStatusUpdates, ['avoir_attendu']);
  assert.ok(!db.queries.some((call) => /payment_status\s*=\s*'to_be_paid'|payment_status\s*=\s*\$1/i.test(call.sql)));
}

async function testExpectedCreditNoteFromLinkedPurchaseKeepsPaidVisible() {
  const db = createMockDb({
    linkedInvoiceFromPurchase: true,
    invoiceOverrides: { payment_status: 'paid', paid: true, supplier_control_status: 'paye' },
  });
  const result = await createExpectedCreditNote(db, {
    storeId: ids.store,
    userId: ids.user,
    payload: {
      source_purchase_id: ids.purchase,
      expected_amount_ex_vat: 407.7,
      reason_type: 'price_error',
      reason_comment: '151 EUR/kg au lieu de 15,10 EUR/kg',
      affected_quantity: 3,
      affected_unit: 'kg',
      idempotency_key: 'sogelmer-paid',
    },
  });
  assert.strictEqual(result.expected_credit_note.source_pennylane_supplier_invoice_id, ids.invoice);
  assert.deepStrictEqual(db.state.invoiceStatusUpdates, ['avoir_attendu']);
  assert.ok(!db.queries.some((call) => /payment_status\s*=/i.test(call.sql)));
}

async function testExpectedCreditNoteFromAmbiguousLinkedPurchaseDoesNotPickInvoice() {
  const db = createMockDb({
    linkedInvoiceRows: [
      { id: ids.invoice, store_id: ids.store, supplier_id: ids.supplier, document_type: 'invoice', amount_ex_vat: 949.5 },
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', store_id: ids.store, supplier_id: ids.supplier, document_type: 'invoice', amount_ex_vat: 949.5 },
    ],
  });
  const result = await createExpectedCreditNote(db, {
    storeId: ids.store,
    userId: ids.user,
    payload: {
      source_purchase_id: ids.purchase,
      expected_amount_ex_vat: 407.7,
      reason_type: 'price_error',
      reason_comment: '151 EUR/kg au lieu de 15,10 EUR/kg',
      idempotency_key: 'sogelmer-ambiguous',
    },
  });
  assert.strictEqual(result.expected_credit_note.source_pennylane_supplier_invoice_id, null);
  assert.deepStrictEqual(db.state.invoiceStatusUpdates, []);
}

async function testIdempotentRetry() {
  const db = createMockDb({ duplicate: true });
  const result = await createExpectedCreditNote(db, {
    storeId: ids.store,
    userId: ids.user,
    payload: {
      supplier_id: ids.supplier,
      expected_amount_ex_vat: 42.5,
      reason_type: 'quality_issue',
      reason_comment: 'Qualite insuffisante',
      idempotency_key: 'same-request',
    },
  });
  assert.strictEqual(result.idempotent, true);
  assert.ok(!db.queries.some((call) => /INSERT INTO supplier_expected_credit_notes/i.test(call.sql)));
}

async function testValidations() {
  await assertRejects(/Motif/, () => createExpectedCreditNote(createMockDb(), {
    storeId: ids.store,
    payload: { supplier_id: ids.supplier, expected_amount_ex_vat: 10, reason_comment: 'x' },
  }));
  await assertRejects(/Commentaire/, () => createExpectedCreditNote(createMockDb(), {
    storeId: ids.store,
    payload: { supplier_id: ids.supplier, expected_amount_ex_vat: 10, reason_type: 'other' },
  }));
  await assertRejects(/Montant/, () => createExpectedCreditNote(createMockDb(), {
    storeId: ids.store,
    payload: { supplier_id: ids.supplier, expected_amount_ex_vat: 0, reason_type: 'other', reason_comment: 'x' },
  }));
  await assertRejects(/Fournisseur incoherent/, () => createExpectedCreditNote(createMockDb({ supplierMismatch: true }), {
    storeId: ids.store,
    payload: {
      supplier_id: ids.supplier,
      source_purchase_id: ids.purchase,
      expected_amount_ex_vat: 10,
      reason_type: 'other',
      reason_comment: 'x',
    },
  }));
}

function createApplyMatchMockDb() {
  const queries = [];
  const state = {
    committed: false,
    rolledBack: false,
    events: [],
    recalculatedSourceDocuments: [],
  };
  const expectedId = '88888888-8888-4888-8888-888888888888';
  const linkId = '99999999-9999-4999-8999-999999999999';
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      const compact = sql.replace(/\s+/g, ' ');
      if (/^BEGIN$/i.test(sql.trim())) return { rows: [], rowCount: 0 };
      if (/^COMMIT$/i.test(sql.trim())) {
        state.committed = true;
        return { rows: [], rowCount: 0 };
      }
      if (/^ROLLBACK$/i.test(sql.trim())) {
        state.rolledBack = true;
        return { rows: [], rowCount: 0 };
      }
      if (/FROM pennylane_supplier_invoices psi/i.test(sql)) {
        const requestedId = params[0];
        if (requestedId === ids.credit) {
          return { rows: [{ id: ids.credit, store_id: ids.store, supplier_id: ids.supplier, document_type: 'credit_note', amount_ex_vat: 100, invoice_number: 'AV-1' }] };
        }
        if (requestedId === ids.invoice) {
          return { rows: [{ id: ids.invoice, store_id: ids.store, supplier_id: ids.supplier, document_type: 'invoice', amount_ex_vat: 1100, payment_status: 'pending', paid: false, supplier_control_status: 'avoir_attendu' }] };
        }
        return { rows: [] };
      }
      if (/FROM supplier_expected_credit_notes ecn/i.test(sql) && /FOR UPDATE OF ecn/i.test(sql)) {
        return {
          rows: [{
            id: expectedId,
            store_id: ids.store,
            supplier_id: ids.supplier,
            source_purchase_id: ids.purchase,
            source_pennylane_supplier_invoice_id: ids.invoice,
            expected_amount_ex_vat: 100,
            received_amount_ex_vat: 0,
            status: 'pending',
          }],
        };
      }
      if (/FROM supplier_expected_credit_note_links/i.test(sql) && /pennylane_credit_note_id = \$2/i.test(sql)) {
        if (/AS applied_amount_ex_vat/i.test(sql)) return { rows: [{ applied_amount_ex_vat: 100 }] };
        return { rows: [{ total: 0 }] };
      }
      if (/INSERT INTO supplier_expected_credit_note_links/i.test(sql)) {
        return {
          rows: [{
            id: linkId,
            store_id: params[0],
            expected_credit_note_id: params[1],
            pennylane_credit_note_id: params[2],
            applied_amount_ex_vat: params[3],
            status: 'matched',
          }],
          rowCount: 1,
        };
      }
      if (/SELECT COALESCE\(SUM\(applied_amount_ex_vat\), 0\) AS applied/i.test(compact)) {
        return { rows: [{ applied: 100 }] };
      }
      if (/UPDATE supplier_expected_credit_notes/i.test(sql)) {
        return { rows: [], rowCount: 1 };
      }
      if (/INSERT INTO supplier_control_events/i.test(sql)) {
        state.events.push({ event_type: params[2], event_key: params[3], payload: params[4] ? JSON.parse(params[4]) : {} });
        return { rows: [], rowCount: 1 };
      }
      if (/WITH linked_purchases AS/i.test(sql)) {
        state.recalculatedSourceDocuments.push(params[1]);
        return {
          rows: [{
            purchase_total_ex_vat: 1000,
            applied_credit_note_total_ex_vat: 100,
            remaining_expected_credit_note_total_ex_vat: 0,
          }],
        };
      }
      if (/UPDATE pennylane_supplier_invoices/i.test(sql) && /supplier_control_status = \$1/i.test(sql)) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return {
    queries,
    state,
    expectedId,
    async connect() {
      return client;
    },
  };
}

function createConfigurableApplyMatchMockDb({
  creditAmount = 100,
  creditSupplierId = ids.supplier,
  expectedRows = null,
  existingCreditApplied = 0,
  invoiceOverrides = {},
  purchaseTotal = 1000,
} = {}) {
  const queries = [];
  const expectedId1 = '88888888-8888-4888-8888-888888888888';
  const expectedId2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const rows = expectedRows || [{
    id: expectedId1,
    store_id: ids.store,
    supplier_id: ids.supplier,
    source_purchase_id: ids.purchase,
    source_pennylane_supplier_invoice_id: ids.invoice,
    expected_amount_ex_vat: creditAmount,
    received_amount_ex_vat: 0,
    status: 'pending',
  }];
  const state = {
    links: [],
    events: [],
    invoiceStatusUpdates: [],
    committed: false,
    rolledBack: false,
  };
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      const compact = sql.replace(/\s+/g, ' ');
      if (/^BEGIN$/i.test(sql.trim())) return { rows: [], rowCount: 0 };
      if (/^COMMIT$/i.test(sql.trim())) {
        state.committed = true;
        return { rows: [], rowCount: 0 };
      }
      if (/^ROLLBACK$/i.test(sql.trim())) {
        state.rolledBack = true;
        return { rows: [], rowCount: 0 };
      }
      if (/FROM pennylane_supplier_invoices psi/i.test(sql)) {
        const requestedId = params[0];
        if (requestedId === ids.credit) {
          return { rows: [{ id: ids.credit, store_id: ids.store, supplier_id: creditSupplierId, document_type: 'credit_note', amount_ex_vat: creditAmount, invoice_number: 'AV-1' }] };
        }
        if (requestedId === ids.invoice) {
          return { rows: [{ id: ids.invoice, store_id: ids.store, supplier_id: ids.supplier, document_type: 'invoice', amount_ex_vat: 1100, payment_status: 'pending', paid: false, supplier_control_status: 'avoir_attendu', ...invoiceOverrides }] };
        }
        return { rows: [] };
      }
      if (/FROM supplier_expected_credit_notes ecn/i.test(sql) && /FOR UPDATE OF ecn/i.test(sql)) {
        const requested = new Set((params[1] || []).map(String));
        return { rows: rows.filter((row) => requested.has(String(row.id))) };
      }
      if (/FROM supplier_expected_credit_note_links/i.test(sql) && /pennylane_credit_note_id = \$2/i.test(sql)) {
        if (/AS applied_amount_ex_vat/i.test(sql)) {
          const applied = existingCreditApplied + state.links.reduce((sum, link) => sum + Number(link.applied_amount_ex_vat || 0), 0);
          return { rows: [{ applied_amount_ex_vat: applied }] };
        }
        return { rows: [{ total: existingCreditApplied }] };
      }
      if (/INSERT INTO supplier_expected_credit_note_links/i.test(sql)) {
        const link = {
          id: `link-${state.links.length + 1}`,
          store_id: params[0],
          expected_credit_note_id: params[1],
          pennylane_credit_note_id: params[2],
          applied_amount_ex_vat: params[3],
          status: 'matched',
        };
        state.links.push(link);
        return { rows: [link], rowCount: 1 };
      }
      if (/SELECT COALESCE\(SUM\(applied_amount_ex_vat\), 0\) AS applied/i.test(compact)) {
        const expectedId = params[1];
        const preExisting = rows.find((row) => String(row.id) === String(expectedId))?.received_amount_ex_vat || 0;
        const inserted = state.links
          .filter((link) => String(link.expected_credit_note_id) === String(expectedId))
          .reduce((sum, link) => sum + Number(link.applied_amount_ex_vat || 0), 0);
        return { rows: [{ applied: preExisting + inserted }] };
      }
      if (/UPDATE supplier_expected_credit_notes/i.test(sql)) return { rows: [], rowCount: 1 };
      if (/INSERT INTO supplier_control_events/i.test(sql)) {
        state.events.push({ event_type: params[2], event_key: params[3], payload: params[4] ? JSON.parse(params[4]) : {} });
        return { rows: [], rowCount: 1 };
      }
      if (/WITH linked_purchases AS/i.test(sql)) {
        const applied = state.links.reduce((sum, link) => sum + Number(link.applied_amount_ex_vat || 0), 0);
        const remaining = rows.reduce((sum, row) => {
          const received = Number(row.received_amount_ex_vat || 0) + state.links
            .filter((link) => String(link.expected_credit_note_id) === String(row.id))
            .reduce((linkSum, link) => linkSum + Number(link.applied_amount_ex_vat || 0), 0);
          return sum + Math.max(Number(row.expected_amount_ex_vat || 0) - received, 0);
        }, 0);
        return {
          rows: [{
            purchase_total_ex_vat: purchaseTotal,
            applied_credit_note_total_ex_vat: applied,
            remaining_expected_credit_note_total_ex_vat: remaining,
          }],
        };
      }
      if (/UPDATE pennylane_supplier_invoices/i.test(sql) && /supplier_control_status = \$1/i.test(compact)) {
        state.invoiceStatusUpdates.push(params[0]);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return {
    queries,
    state,
    expectedId1,
    expectedId2,
    async connect() {
      return client;
    },
  };
}

async function testApplyCreditNoteMatchCommitsAndRecalculatesSources() {
  const db = createApplyMatchMockDb();
  const result = await applyCreditNoteMatch(db, {
    storeId: ids.store,
    creditNoteId: ids.credit,
    expectedCreditNoteIds: [db.expectedId],
    userId: ids.user,
  });
  assert.strictEqual(result.links.length, 1);
  assert.strictEqual(db.state.committed, true, 'success path must reach COMMIT');
  assert.strictEqual(db.state.rolledBack, false, 'success path must not rollback');
  assert.deepStrictEqual(db.state.recalculatedSourceDocuments, [ids.invoice]);
  assert.ok(db.state.events.some((event) => event.event_type === 'credit_note_linked'));
}

async function testApplyCreditNoteMatchPartialKeepsExpectedOpen() {
  const db = createConfigurableApplyMatchMockDb({
    creditAmount: 40,
    expectedRows: [{
      id: '88888888-8888-4888-8888-888888888888',
      store_id: ids.store,
      supplier_id: ids.supplier,
      source_purchase_id: ids.purchase,
      source_pennylane_supplier_invoice_id: ids.invoice,
      expected_amount_ex_vat: 100,
      received_amount_ex_vat: 0,
      status: 'pending',
    }],
  });
  const result = await applyCreditNoteMatch(db, {
    storeId: ids.store,
    creditNoteId: ids.credit,
    expectedCreditNoteIds: [db.expectedId1],
    userId: ids.user,
  });
  assert.strictEqual(result.applied_amount_ex_vat, 40);
  assert.strictEqual(result.unapplied_amount_ex_vat, 0);
  assert.strictEqual(result.credit_note_control_status, 'conforme');
  assert.strictEqual(db.state.links[0].applied_amount_ex_vat, 40);
  assert.ok(db.state.events.some((event) => event.event_type === 'expected_credit_note_partially_resolved'));
}

async function testApplyCreditNoteMatchCompletesAfterMultipleCredits() {
  const db = createConfigurableApplyMatchMockDb({
    creditAmount: 60,
    expectedRows: [{
      id: '88888888-8888-4888-8888-888888888888',
      store_id: ids.store,
      supplier_id: ids.supplier,
      source_purchase_id: ids.purchase,
      source_pennylane_supplier_invoice_id: ids.invoice,
      expected_amount_ex_vat: 100,
      received_amount_ex_vat: 40,
      status: 'matched',
    }],
  });
  const result = await applyCreditNoteMatch(db, {
    storeId: ids.store,
    creditNoteId: ids.credit,
    expectedCreditNoteIds: [db.expectedId1],
    userId: ids.user,
  });
  assert.strictEqual(result.applied_amount_ex_vat, 60);
  assert.strictEqual(result.credit_note_control_status, 'conforme');
  assert.ok(db.state.events.some((event) => event.event_type === 'expected_credit_note_resolved'));
}

async function testApplyCreditNoteCanCoverMultipleExpectations() {
  const db = createConfigurableApplyMatchMockDb({
    creditAmount: 150,
    expectedRows: [
      {
        id: '88888888-8888-4888-8888-888888888888',
        store_id: ids.store,
        supplier_id: ids.supplier,
        source_purchase_id: ids.purchase,
        source_pennylane_supplier_invoice_id: ids.invoice,
        expected_amount_ex_vat: 100,
        received_amount_ex_vat: 0,
        status: 'pending',
      },
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        store_id: ids.store,
        supplier_id: ids.supplier,
        source_purchase_id: ids.purchase,
        source_pennylane_supplier_invoice_id: ids.invoice,
        expected_amount_ex_vat: 50,
        received_amount_ex_vat: 0,
        status: 'pending',
      },
    ],
  });
  const result = await applyCreditNoteMatch(db, {
    storeId: ids.store,
    creditNoteId: ids.credit,
    expectedCreditNoteIds: [db.expectedId1, db.expectedId2],
    userId: ids.user,
  });
  assert.deepStrictEqual(db.state.links.map((link) => link.applied_amount_ex_vat), [100, 50]);
  assert.strictEqual(result.unapplied_amount_ex_vat, 0);
}

async function testApplyCreditNoteRejectsSupplierMismatch() {
  const db = createConfigurableApplyMatchMockDb({ creditSupplierId: ids.purchase });
  await assertRejects(/Fournisseur/, () => applyCreditNoteMatch(db, {
    storeId: ids.store,
    creditNoteId: ids.credit,
    expectedCreditNoteIds: [db.expectedId1],
    userId: ids.user,
  }));
  assert.strictEqual(db.state.rolledBack, true);
}

async function testApplyCreditNoteRejectsCancelledExpectation() {
  const db = createConfigurableApplyMatchMockDb({
    expectedRows: [{
      id: '88888888-8888-4888-8888-888888888888',
      store_id: ids.store,
      supplier_id: ids.supplier,
      source_purchase_id: ids.purchase,
      source_pennylane_supplier_invoice_id: ids.invoice,
      expected_amount_ex_vat: 100,
      received_amount_ex_vat: 0,
      status: 'cancelled',
    }],
  });
  await assertRejects(/non rapprochable/, () => applyCreditNoteMatch(db, {
    storeId: ids.store,
    creditNoteId: ids.credit,
    expectedCreditNoteIds: [db.expectedId1],
    userId: ids.user,
  }));
  assert.strictEqual(db.state.links.length, 0);
}

async function testApplyCreditNoteRejectsOtherStoreExpectation() {
  const db = createConfigurableApplyMatchMockDb({ expectedRows: [] });
  await assertRejects(/introuvable/, () => applyCreditNoteMatch(db, {
    storeId: ids.store,
    creditNoteId: ids.credit,
    expectedCreditNoteIds: [db.expectedId1],
    userId: ids.user,
  }));
  assert.strictEqual(db.state.links.length, 0);
}

async function testApplyCreditNoteRejectsExpectedOverApplyAndReportsCreditOverage() {
  let db = createConfigurableApplyMatchMockDb({
    creditAmount: 150,
    expectedRows: [{
      id: '88888888-8888-4888-8888-888888888888',
      store_id: ids.store,
      supplier_id: ids.supplier,
      source_purchase_id: ids.purchase,
      source_pennylane_supplier_invoice_id: ids.invoice,
      expected_amount_ex_vat: 100,
      received_amount_ex_vat: 0,
      status: 'pending',
    }],
  });
  await assertRejects(/superieur au reste/, () => applyCreditNoteMatch(db, {
    storeId: ids.store,
    creditNoteId: ids.credit,
    expectedCreditNoteIds: [db.expectedId1],
    applications: [{ expected_credit_note_id: db.expectedId1, applied_amount_ex_vat: 150 }],
    userId: ids.user,
  }));

  db = createConfigurableApplyMatchMockDb({
    creditAmount: 150,
    expectedRows: [{
      id: '88888888-8888-4888-8888-888888888888',
      store_id: ids.store,
      supplier_id: ids.supplier,
      source_purchase_id: ids.purchase,
      source_pennylane_supplier_invoice_id: ids.invoice,
      expected_amount_ex_vat: 100,
      received_amount_ex_vat: 0,
      status: 'pending',
    }],
  });
  const result = await applyCreditNoteMatch(db, {
    storeId: ids.store,
    creditNoteId: ids.credit,
    expectedCreditNoteIds: [db.expectedId1],
    userId: ids.user,
  });
  assert.strictEqual(result.applied_amount_ex_vat, 100);
  assert.strictEqual(result.unapplied_amount_ex_vat, 50);
  assert.strictEqual(result.credit_note_control_status, 'a_controler');
}

async function testApplyCreditNoteKeepsPennylanePaymentStatusesAndNoSideEffects() {
  for (const invoiceOverrides of [
    { payment_status: 'to_be_paid', supplier_control_status: 'valide_a_payer' },
    { payment_status: 'paid', paid: true, supplier_control_status: 'paye' },
  ]) {
    const db = createConfigurableApplyMatchMockDb({ invoiceOverrides });
    await applyCreditNoteMatch(db, {
      storeId: ids.store,
      creditNoteId: ids.credit,
      expectedCreditNoteIds: [db.expectedId1],
      userId: ids.user,
    });
    const allSql = db.queries.map((call) => call.sql).join('\n');
    assertNotContains(allSql, /payment_status\s*=/i);
    assertNotContains(allSql, /INSERT INTO stock_movements|UPDATE\s+stock_lots|UPDATE\s+stock_quantity|UPDATE\s+purchase_lines/i);
  }
}

async function testSogelmerSyntheticNetAfterRealCreditNote() {
  const db = createConfigurableApplyMatchMockDb({
    creditAmount: 407.7,
    purchaseTotal: 949.5,
    expectedRows: [{
      id: '88888888-8888-4888-8888-888888888888',
      store_id: ids.store,
      supplier_id: ids.supplier,
      source_purchase_id: ids.purchase,
      source_pennylane_supplier_invoice_id: ids.invoice,
      expected_amount_ex_vat: 407.7,
      received_amount_ex_vat: 0,
      status: 'pending',
    }],
    invoiceOverrides: { amount_ex_vat: 949.5, invoice_number: '511260004713' },
  });
  await applyCreditNoteMatch(db, {
    storeId: ids.store,
    creditNoteId: ids.credit,
    expectedCreditNoteIds: [db.expectedId1],
    userId: ids.user,
  });
  const applied = db.state.links.reduce((sum, link) => sum + Number(link.applied_amount_ex_vat || 0), 0);
  assert.strictEqual(applied, 407.7);
  assert.ok(db.state.invoiceStatusUpdates.includes('conforme'), 'SOGELMER credit note must be sold after 407.70 / 407.70');
  const recalcQuery = db.queries.find((call) => /WITH linked_purchases AS/i.test(call.sql));
  const row = await db.connect().then((client) => client.query(recalcQuery.sql, recalcQuery.params)).then((result) => result.rows[0]);
  assert.strictEqual(Number(row.purchase_total_ex_vat), 949.5);
  assert.strictEqual(Number(row.applied_credit_note_total_ex_vat), 407.7);
  assert.strictEqual(Number((949.5 - 407.7).toFixed(2)), 541.8);
}

function createRemoveMatchMockDb() {
  const queries = [];
  const state = {
    committed: false,
    rolledBack: false,
    events: [],
    recalculatedSourceDocuments: [],
    sourceStatuses: [],
  };
  const linkId = '99999999-9999-4999-8999-999999999999';
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      const compact = sql.replace(/\s+/g, ' ');
      if (/^BEGIN$/i.test(sql.trim())) return { rows: [], rowCount: 0 };
      if (/^COMMIT$/i.test(sql.trim())) {
        state.committed = true;
        return { rows: [], rowCount: 0 };
      }
      if (/^ROLLBACK$/i.test(sql.trim())) {
        state.rolledBack = true;
        return { rows: [], rowCount: 0 };
      }
      if (/UPDATE supplier_expected_credit_note_links l/i.test(sql) && /RETURNING l\.\*, ecn\.source_pennylane_supplier_invoice_id/i.test(sql)) {
        return {
          rows: [{
            id: linkId,
            store_id: ids.store,
            expected_credit_note_id: '88888888-8888-4888-8888-888888888888',
            pennylane_credit_note_id: ids.credit,
            source_pennylane_supplier_invoice_id: ids.invoice,
          }],
          rowCount: 1,
        };
      }
      if (/UPDATE supplier_expected_credit_notes ecn/i.test(sql)) return { rows: [], rowCount: 1 };
      if (/INSERT INTO supplier_control_events/i.test(sql)) {
        state.events.push({ event_type: params[2], event_key: params[3], payload: params[4] ? JSON.parse(params[4]) : {} });
        return { rows: [], rowCount: 1 };
      }
      if (/FROM pennylane_supplier_invoices psi/i.test(sql)) {
        if (params[0] === ids.credit) {
          return { rows: [{ id: ids.credit, store_id: ids.store, supplier_id: ids.supplier, document_type: 'credit_note', amount_ex_vat: 100, supplier_control_status: 'conforme' }] };
        }
        return { rows: [{ id: ids.invoice, store_id: ids.store, supplier_id: ids.supplier, document_type: 'invoice', amount_ex_vat: 1100, payment_status: 'pending', paid: false, supplier_control_status: 'conforme' }] };
      }
      if (/FROM supplier_expected_credit_note_links/i.test(sql) && /pennylane_credit_note_id = \$2/i.test(sql) && /AS applied_amount_ex_vat/i.test(sql)) {
        return { rows: [{ applied_amount_ex_vat: 0 }] };
      }
      if (/WITH linked_purchases AS/i.test(sql)) {
        state.recalculatedSourceDocuments.push(params[1]);
        return {
          rows: [{
            purchase_total_ex_vat: 1000,
            applied_credit_note_total_ex_vat: 0,
            remaining_expected_credit_note_total_ex_vat: 100,
          }],
        };
      }
      if (/UPDATE pennylane_supplier_invoices/i.test(sql) && /supplier_control_status = \$1/i.test(compact)) {
        state.sourceStatuses.push(params[0]);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return {
    queries,
    state,
    linkId,
    async connect() {
      return client;
    },
  };
}

async function testRemoveCreditNoteLinkRecalculatesSourceInvoice() {
  const db = createRemoveMatchMockDb();
  const result = await removeCreditNoteLink(db, {
    storeId: ids.store,
    creditNoteId: ids.credit,
    linkId: db.linkId,
    userId: ids.user,
  });
  assert.strictEqual(result.link.id, db.linkId);
  assert.strictEqual(result.credit_note_control_status, 'a_rapprocher');
  assert.strictEqual(db.state.committed, true, 'unlink success path must reach COMMIT');
  assert.strictEqual(db.state.rolledBack, false, 'unlink success path must not rollback');
  assert.deepStrictEqual(db.state.recalculatedSourceDocuments, [ids.invoice]);
  assert.deepStrictEqual(db.state.sourceStatuses, ['a_rapprocher', 'avoir_attendu']);
  assert.ok(db.state.events.some((event) => event.event_type === 'credit_note_unlinked'));
}

function testMigrationSchema() {
  const migration = read(migrationPath);
  const rollback = read(rollbackPath);
  assertContains(migration, /^BEGIN;/m);
  assertContains(migration, /CREATE TABLE IF NOT EXISTS supplier_expected_credit_notes/);
  assertContains(migration, /CREATE TABLE IF NOT EXISTS supplier_expected_credit_note_links/);
  assertContains(migration, /ux_supplier_expected_credit_notes_idempotency/);
  assertContains(migration, /ux_supplier_expected_credit_note_links_active/);
  assertContains(migration, /source_pennylane_supplier_invoice_id uuid REFERENCES pennylane_supplier_invoices/);
  assertContains(migration, /pennylane_credit_note_id uuid NOT NULL REFERENCES pennylane_supplier_invoices/);
  assertContains(migration, /supplier_return/);
  assertContains(migration, /expected_credit_note_created/);
  assertContains(migration, /credit_note_linked/);
  assertContains(rollback, /DROP TABLE IF EXISTS supplier_expected_credit_note_links/);
  assertContains(rollback, /DROP TABLE IF EXISTS supplier_expected_credit_notes/);
}

function testCanonicalRoutesAndPermissions() {
  const route = read(routePath);
  [
    /router\.get\('\/supplier-control\/expected-credit-notes'/,
    /router\.post\('\/supplier-control\/expected-credit-notes'.+requireAdminOrManager/s,
    /router\.get\('\/supplier-control\/expected-credit-notes\/:id'/,
    /router\.get\('\/supplier-control\/purchases\/:purchaseId\/expected-credit-notes'/,
    /router\.post\('\/supplier-control\/expected-credit-notes\/:id\/cancel'.+requireAdminOrManager/s,
    /router\.get\('\/supplier-control\/credit-notes\/:id\/match-candidates'/,
    /router\.post\('\/supplier-control\/credit-notes\/:id\/apply-match'.+requireAdminOrManager/s,
    /router\.delete\('\/supplier-control\/credit-notes\/:id\/links\/:linkId'.+requireAdminOrManager/s,
  ].forEach((pattern) => assertContains(route, pattern));
}

function testSupplierControlIntegration() {
  const service = read(supplierControlServicePath);
  const expectedService = read(servicePath);
  assertContains(service, /createExpectedCreditNoteInTransaction/);
  assertContains(service, /type === 'supplier_credit_note_expected'/);
  assertContains(service, /expected_credit_note_id/);
  assertContains(service, /applied_credit_note_total_ex_vat/);
  assertContains(service, /net_invoice_total_ex_vat/);
  assertContains(service, /currentStatus !== 'avoir_attendu'/);
  assertContains(expectedService, /loadPennylaneDocumentsLinkedToPurchase/);
  assertContains(expectedService, /recalculateCreditNoteControlStatus/);
  assertContains(expectedService, /recalculateSourceInvoiceAfterCreditNote/);
  assertContains(expectedService, /supplier_control_status NOT IN \('litige', 'reconciliation_required'\)/);
}

function testSafeReconcileScript() {
  const script = read(reconcileScriptPath);
  assertContains(script, /--store-id/);
  assertContains(script, /--apply/);
  assertContains(script, /dry_run: !apply/);
  assertContains(script, /existing_document_id IS NOT NULL OR document_count > 0/);
  assertContains(script, /source_pennylane_supplier_invoice_id IS NULL/);
  assertContains(script, /Number\(row\.document_count\) !== 1/);
  assertContains(script, /recalculateSourceInvoiceAfterCreditNote/);
  assertNotContains(script, /payment_status\s*=/i);
  assertNotContains(script, /stock_movements|stock_lots|purchase_lines/i);
}

function testUiIntegration() {
  const supplierHtml = read(supplierControlHtmlPath);
  const supplierJs = read(supplierControlJsPath);
  const purchaseHtml = read(purchaseHtmlPath);
  const purchaseJs = read(purchaseJsPath);
  assertContains(supplierHtml, /expected-credit-note-section/);
  assertContains(supplierHtml, /credit-note-match-section/);
  assertContains(supplierHtml, /data-filter="final">Rapproches/);
  assertContains(supplierHtml, /supplier-control\.js\?v=5/);
  assertContains(supplierJs, /creditNoteStatusLabels/);
  assertContains(supplierJs, /expected_credit_notes/);
  assertContains(supplierJs, /\/api\/supplier-control\/credit-notes\/.+\/match-candidates/);
  assertContains(supplierJs, /\/api\/supplier-control\/credit-notes\/.+\/apply-match/);
  assertContains(purchaseHtml, /open-expected-credit-note-modal-btn/);
  assertContains(purchaseHtml, /purchase-detail\.js\?v=12/);
  assertContains(purchaseJs, /\/api\/supplier-control\/expected-credit-notes/);
  assertContains(purchaseJs, /\/api\/supplier-control\/purchases\/.+\/expected-credit-notes/);
  assertContains(purchaseJs, /idempotency_key/);
}

function testNoForbiddenSideEffects() {
  const service = read(servicePath);
  const route = read(routePath);
  const combined = `${service}\n${route}`;
  assertNotContains(service, /syncValidatedSupplierInvoiceStatusToPennylane|payment_status\s*=\s*'to_be_paid'|payment_status\s*=\s*\$1/i);
  assertNotContains(combined, /INSERT INTO supplier_invoices/i);
  assertNotContains(combined, /INSERT INTO stock_movements|UPDATE\s+stock_lots|UPDATE\s+stock_quantity|UPDATE\s+purchase_lines/i);
  assertContains(service, /document_type = 'credit_note'/);
  assertContains(service, /String\(row\.supplier_id\) !== String\(creditNote\.supplier_id\)/);
  assertContains(service, /SUPPLIER_EXPECTED_CREDIT_NOTE_AMOUNT_EXCEEDED/);
  assertContains(service, /remaining_expected_credit_note_total_ex_vat/);
  assertContains(service, /invoiceTotal - purchaseTotal/);
  assertContains(service, /\? 'avoir_attendu'\s*:/);
}

(async () => {
  testContractConstants();
  await testCreateExpectedCreditNoteFromPurchase();
  await testExpectedCreditNoteFromLinkedPurchaseAttachesAndRecalculatesInvoice();
  await testExpectedCreditNoteFromLinkedPurchaseKeepsPennylaneToBePaid();
  await testExpectedCreditNoteFromLinkedPurchaseKeepsPaidVisible();
  await testExpectedCreditNoteFromAmbiguousLinkedPurchaseDoesNotPickInvoice();
  await testIdempotentRetry();
  await testValidations();
  await testApplyCreditNoteMatchCommitsAndRecalculatesSources();
  await testApplyCreditNoteMatchPartialKeepsExpectedOpen();
  await testApplyCreditNoteMatchCompletesAfterMultipleCredits();
  await testApplyCreditNoteCanCoverMultipleExpectations();
  await testApplyCreditNoteRejectsSupplierMismatch();
  await testApplyCreditNoteRejectsCancelledExpectation();
  await testApplyCreditNoteRejectsOtherStoreExpectation();
  await testApplyCreditNoteRejectsExpectedOverApplyAndReportsCreditOverage();
  await testApplyCreditNoteKeepsPennylanePaymentStatusesAndNoSideEffects();
  await testSogelmerSyntheticNetAfterRealCreditNote();
  await testRemoveCreditNoteLinkRecalculatesSourceInvoice();
  testMigrationSchema();
  testCanonicalRoutesAndPermissions();
  testSupplierControlIntegration();
  testSafeReconcileScript();
  testUiIntegration();
  testNoForbiddenSideEffects();
  console.log('OK supplier expected credit notes tests');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
