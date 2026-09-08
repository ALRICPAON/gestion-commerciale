const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  addPurchaseLink,
  amountTolerance,
  canonicalSupplierControlStatus,
  getSupplierControlDocument,
  listPurchaseCandidates,
  listSupplierControlDocuments,
  recalculateSupplierControl,
  removePurchaseLink,
} = require('../services/supplierControlService');

const routePath = path.join(__dirname, '../routes/supplierControl.js');
const servicePath = path.join(__dirname, '../services/supplierControlService.js');
const serverPath = path.join(__dirname, '../server.js');
const importSyncPath = path.join(__dirname, '../services/pennylane/supplierInvoiceImportSync.js');

const ids = {
  storeA: '00000000-0000-4000-8000-000000000001',
  storeB: '00000000-0000-4000-8000-000000000002',
  user: '00000000-0000-4000-8000-000000000010',
  doc: '00000000-0000-4000-8000-000000000100',
  docOther: '00000000-0000-4000-8000-000000000101',
  supplier: '00000000-0000-4000-8000-000000000200',
  otherSupplier: '00000000-0000-4000-8000-000000000201',
  purchase1: '00000000-0000-4000-8000-000000000300',
  purchase2: '00000000-0000-4000-8000-000000000301',
  purchase3: '00000000-0000-4000-8000-000000000302',
};

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function document(overrides = {}) {
  return {
    id: ids.doc,
    store_id: ids.storeA,
    pennylane_supplier_invoice_id: 'pl-invoice-1',
    supplier_id: ids.supplier,
    supplier_name: 'LECRI MAREE',
    supplier_code: 'LECRIMAREE',
    invoice_number: 'FAC-1',
    document_type: 'invoice',
    invoice_date: '2026-09-08',
    due_date: '2026-09-30',
    amount_ex_vat: 100,
    amount_vat: 20,
    amount_inc_vat: 120,
    currency: 'EUR',
    payment_status: null,
    paid: false,
    alta_business_status: 'a_rapprocher',
    supplier_control_status: 'a_rapprocher',
    public_file_url: 'https://example.invalid/fac-1.pdf',
    pennylane_deleted_at: null,
    ...overrides,
  };
}

function purchase(overrides = {}) {
  return {
    id: ids.purchase1,
    store_id: ids.storeA,
    supplier_id: ids.supplier,
    supplier_name: 'LECRI MAREE',
    supplier_code: 'LECRIMAREE',
    bl_number: 'BL-1',
    purchase_date: '2026-09-07',
    order_date: '2026-09-07',
    receipt_date: '2026-09-08',
    status: 'received',
    total_amount_ex_vat: 100,
    ...overrides,
  };
}

function link(overrides = {}) {
  const rowPurchase = purchase(overrides.purchase || {});
  return {
    id: overrides.id || 'link-1',
    store_id: ids.storeA,
    pennylane_supplier_invoice_id: ids.doc,
    purchase_id: rowPurchase.id,
    purchase_line_id: null,
    link_type: 'invoice_match',
    match_status: overrides.match_status || 'matched',
    amount_difference: overrides.amount_difference ?? 0,
    quantity_difference: 0,
    price_difference: 0,
    vat_difference: 0,
    source: 'manual',
    matching_method: 'manual_purchase_link',
    validated_at: overrides.validated_at || null,
    purchase_total_ex_vat: rowPurchase.total_amount_ex_vat,
    purchase_status: rowPurchase.status,
    bl_number: rowPurchase.bl_number,
    receipt_date: rowPurchase.receipt_date,
    ...overrides,
  };
}

function createMockDb({
  doc = document(),
  documents = null,
  links = [],
  lines = [],
  events = [],
  purchases = [],
  incompatibleLinks = [],
  legacyLocked = [],
} = {}) {
  const calls = [];
  const state = {
    doc: doc ? { ...doc } : null,
    links: links.map((item) => ({ ...item })),
    events: events.map((item) => ({ ...item })),
  };

  const query = async (sql, params = []) => {
    calls.push({ sql, params });

    if (/BEGIN|COMMIT|ROLLBACK/i.test(sql.trim())) return { rows: [] };

    if (/SELECT COUNT\(\*\)::int AS total/i.test(sql) && /FROM pennylane_supplier_invoices psi/i.test(sql)) {
      return { rows: [{ total: (documents || [state.doc]).filter(Boolean).length }] };
    }

    if (/WITH active_link_purchases AS/i.test(sql)) {
      const limit = Number(params[params.length - 4]);
      const offset = Number(params[params.length - 3]);
      const absoluteTolerance = Number(params[params.length - 2]);
      const ratioTolerance = Number(params[params.length - 1]);
      const rows = (documents || [state.doc]).filter(Boolean).slice(offset, offset + limit).map((row) => {
        const linkedPurchaseTotal = links.reduce((sum, item) => sum + Number(item.purchase_total_ex_vat || 0), 0);
        const difference = Number(row.amount_ex_vat || 0) - linkedPurchaseTotal;
        return {
          id: row.id,
          pennylane_supplier_invoice_id: row.pennylane_supplier_invoice_id,
          document_type: row.document_type,
          invoice_number: row.invoice_number,
          external_reference: row.external_reference || null,
          supplier_id: row.supplier_id,
          supplier_name: row.supplier_name,
          supplier_code: row.supplier_code,
          invoice_date: row.invoice_date,
          due_date: row.due_date,
          amount_ex_vat: row.amount_ex_vat,
          amount_vat: row.amount_vat,
          amount_inc_vat: row.amount_inc_vat,
          currency: row.currency,
          payment_status: row.payment_status,
          supplier_control_status: row.supplier_control_status,
          paid: row.paid,
          linked_purchase_count: links.length,
          linked_purchase_total: linkedPurchaseTotal,
          amount_difference: difference,
          has_difference: Math.abs(difference) > Math.max(absoluteTolerance, Math.abs(Number(row.amount_ex_vat || 0)) * ratioTolerance),
          has_expected_credit_note: events.some((item) => item.event_type === 'expected_credit_note'),
          last_synced_at: row.last_synced_at || null,
          last_control_action_at: events[0]?.created_at || null,
        };
      });
      return { rows };
    }

    if (/FROM pennylane_supplier_invoices psi/i.test(sql)) {
      if (!state.doc) return { rows: [] };
      const requestedStore = params[1];
      if (requestedStore && requestedStore !== state.doc.store_id) return { rows: [] };
      return { rows: [{ ...state.doc }] };
    }

    if (/FROM supplier_control_document_links scl/i.test(sql) && /LEFT JOIN purchases p/i.test(sql)) {
      return { rows: state.links.filter((item) => item.match_status !== 'removed') };
    }

    if (/FROM supplier_control_events/i.test(sql) && /ORDER BY created_at/i.test(sql)) {
      return { rows: state.events };
    }

    if (/FROM pennylane_supplier_invoice_lines/i.test(sql)) return { rows: lines };

    if (/FROM purchases p/i.test(sql) && /FOR UPDATE OF p/i.test(sql)) {
      const found = purchases.find((item) => item.id === params[0]);
      return { rows: found ? [found] : [] };
    }

    if (/FROM purchases p/i.test(sql) && /LIMIT 200/i.test(sql)) {
      return { rows: purchases.map((item) => ({ ...item, purchase_id: item.id, purchase_status: item.status, total_ex_vat: item.total_amount_ex_vat })) };
    }

    if (/linked_psi\.supplier_control_status IN \('valide_a_payer', 'paye', 'litige', 'avoir_attendu'\)/i.test(sql)) {
      return { rows: incompatibleLinks };
    }

    if (/FROM supplier_invoice_matches sim/i.test(sql) && /JOIN supplier_invoices si/i.test(sql)) {
      return { rows: legacyLocked };
    }

    if (/INSERT INTO supplier_control_document_links/i.test(sql)) {
      let existing = state.links.find((item) => item.purchase_id === params[2] && item.purchase_line_id === null);
      if (!existing) {
        existing = link({
          id: `link-${state.links.length + 1}`,
          purchase_id: params[2],
          amount_difference: params[4],
          match_status: params[3],
          purchase: purchases.find((item) => item.id === params[2]) || purchase({ id: params[2] }),
        });
        state.links.push(existing);
      } else if (existing.match_status === 'removed') {
        existing.match_status = params[3];
      }
      return { rows: [existing] };
    }

    if (/INSERT INTO supplier_control_events/i.test(sql)) {
      state.events.push({ id: `event-${state.events.length + 1}`, event_type: params[2], event_key: params[3] });
      return { rows: [] };
    }

    if (/UPDATE supplier_control_document_links/i.test(sql)) {
      const changed = state.links.filter((item) => item.purchase_id === params[2] && item.match_status !== 'removed');
      changed.forEach((item) => { item.match_status = 'removed'; });
      return { rows: changed };
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
      return {
        query,
        release() {},
      };
    },
  };
}

function assertNoPennylaneCalls(db) {
  assert.ok(!db.calls.some((call) => /createPennylaneClient|\/supplier_invoices\/.+payment_status|client\.put/i.test(call.sql)));
}

function assertNoSupplierInvoiceCreationInNewApiSource() {
  const route = read(routePath);
  const service = read(servicePath);
  assert.ok(!/INSERT INTO supplier_invoices/i.test(route), 'New canonical route must not create supplier_invoices');
  assert.ok(!/INSERT INTO supplier_invoices/i.test(service), 'New canonical service must not create supplier_invoices');
  assert.ok(!/syncValidatedSupplierInvoiceStatusToPennylane|createPennylaneClient/i.test(route + service), 'PR2 must not call Pennylane');
}

async function testListDocumentsAndFilters() {
  const db = createMockDb({
    documents: [
      document({ supplier_control_status: 'a_rapprocher' }),
      document({ id: ids.docOther, document_type: 'credit_note', supplier_control_status: 'paye', invoice_number: 'AV-1' }),
    ],
    links: [link()],
    events: [{ event_type: 'expected_credit_note', created_at: '2026-09-08T10:00:00Z' }],
  });
  const result = await listSupplierControlDocuments(db, {
    storeId: ids.storeA,
    filters: {
      supplier_control_status: 'a_rapprocher',
      supplier_id: ids.supplier,
      document_type: 'invoice',
      payment_status: 'to_be_paid',
      search: 'FAC',
      date_from: '2026-09-01',
      date_to: '2026-09-30',
      sort: 'supplier',
      direction: 'asc',
      limit: 25,
      page: 1,
    },
  });
  assert.strictEqual(result.documents.length, 2);
  assert.strictEqual(result.pagination.limit, 25);
  const sql = db.calls.find((call) => /WITH active_link_purchases AS/i.test(call.sql)).sql;
  assert.match(sql, /psi\.supplier_control_status/);
  assert.match(sql, /psi\.supplier_id/);
  assert.match(sql, /psi\.document_type/);
  assert.match(sql, /LOWER\(COALESCE\(psi\.payment_status/);
  assert.match(sql, /psi\.invoice_number ILIKE/);
  assert.match(sql, /ORDER BY supplier_name ASC/);
  assertNoPennylaneCalls(db);
}

async function testListPaginationKeepsTotalOnEmptyPage() {
  const db = createMockDb({
    documents: [
      document({ id: ids.doc, invoice_number: 'FAC-1' }),
      document({ id: ids.docOther, invoice_number: 'FAC-2' }),
    ],
  });
  const result = await listSupplierControlDocuments(db, {
    storeId: ids.storeA,
    filters: { limit: 2, page: 3 },
  });
  assert.deepStrictEqual(result.documents, []);
  assert.strictEqual(result.pagination.total, 2);
  assert.strictEqual(result.pagination.has_more, false);
}

async function testDetailDocumentLinesAndPdf() {
  const db = createMockDb({
    links: [link()],
    lines: [{ id: 'line-1', label: 'HOMARD', amount: 100 }],
    events: [{ id: 'event-1', event_type: 'match_added' }],
  });
  const result = await getSupplierControlDocument(db, {
    storeId: ids.storeA,
    pennylaneSupplierInvoiceId: ids.doc,
  });
  assert.strictEqual(result.document.id, ids.doc);
  assert.strictEqual(result.document.pdf_available, true);
  assert.strictEqual(result.lines_available, true);
  assert.strictEqual(result.links.length, 1);
  assert.strictEqual(result.summary.can_validate, true);

  const withoutLines = await getSupplierControlDocument(createMockDb(), {
    storeId: ids.storeA,
    pennylaneSupplierInvoiceId: ids.doc,
  });
  assert.strictEqual(withoutLines.lines_available, false);
  assert.deepStrictEqual(withoutLines.lines, []);
}

async function testOtherStoreRefused() {
  const db = createMockDb({ doc: document({ store_id: ids.storeB }) });
  const result = await getSupplierControlDocument(db, {
    storeId: ids.storeA,
    pennylaneSupplierInvoiceId: ids.doc,
  });
  assert.strictEqual(result, null);
}

async function testRecalculateNoBlOneBlManyBlAndFinalStatuses() {
  let db = createMockDb({ links: [] });
  let summary = await recalculateSupplierControl(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.strictEqual(summary.control_status, 'a_rapprocher');
  assert.strictEqual(summary.linked_purchase_count, 0);
  assert.ok(summary.blocking_reasons.includes('aucun_bl_rapproche'));

  db = createMockDb({ links: [link()] });
  summary = await recalculateSupplierControl(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.strictEqual(summary.control_status, 'conforme');
  assert.strictEqual(summary.linked_purchase_count, 1);
  assert.strictEqual(summary.difference_total, 0);

  db = createMockDb({
    doc: document({ amount_ex_vat: 300 }),
    links: [
      link({ id: 'l1', purchase: purchase({ id: ids.purchase1, total_amount_ex_vat: 100 }) }),
      link({ id: 'l2', purchase_id: ids.purchase2, purchase: purchase({ id: ids.purchase2, total_amount_ex_vat: 100 }) }),
      link({ id: 'l3', purchase_id: ids.purchase3, purchase: purchase({ id: ids.purchase3, total_amount_ex_vat: 100 }) }),
    ],
  });
  summary = await recalculateSupplierControl(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.strictEqual(summary.control_status, 'conforme');
  assert.strictEqual(summary.linked_purchase_count, 3);

  db = createMockDb({ doc: document({ amount_ex_vat: 130 }), links: [link()] });
  summary = await recalculateSupplierControl(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.strictEqual(summary.control_status, 'ecart');
  assert.ok(summary.blocking_reasons.includes('difference_non_resolue'));

  db = createMockDb({ doc: document({ paid: true, supplier_control_status: 'paye' }), links: [link()] });
  summary = await recalculateSupplierControl(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.strictEqual(summary.control_status, 'paye');
  assert.ok(summary.blocking_reasons.includes('document_deja_paye'));

  db = createMockDb({ doc: document({ payment_status: 'to_be_paid', supplier_control_status: 'a_rapprocher' }), links: [link()] });
  summary = await recalculateSupplierControl(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.strictEqual(summary.control_status, 'valide_a_payer');
  assert.strictEqual(db.state.doc.supplier_control_status, 'valide_a_payer');

  db = createMockDb({ doc: document({ payment_status: 'paid', supplier_control_status: 'a_controler' }), links: [link()] });
  summary = await recalculateSupplierControl(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.strictEqual(summary.control_status, 'paye');
  assert.strictEqual(db.state.doc.supplier_control_status, 'paye');

  db = createMockDb({ doc: document({ alta_business_status: 'litige', supplier_control_status: 'litige' }), links: [link()] });
  summary = await recalculateSupplierControl(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.strictEqual(summary.control_status, 'litige');
  assert.ok(summary.blocking_reasons.includes('document_en_litige'));
}

async function testRecalculateReturnsPersistedNextStatus() {
  const db = createMockDb({
    doc: document({ alta_business_status: 'controle_manuel', supplier_control_status: 'a_controler' }),
    links: [link()],
  });
  const summary = await recalculateSupplierControl(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.strictEqual(db.state.doc.supplier_control_status, 'conforme');
  assert.strictEqual(summary.control_status, 'conforme');
  assert.strictEqual(summary.can_validate, true);
}

async function testListMultiPurchaseInvoiceUsesGlobalDifference() {
  const db = createMockDb({
    doc: document({ amount_ex_vat: 300 }),
    links: [
      link({
        id: 'l1',
        match_status: 'difference',
        amount_difference: 200,
        purchase: purchase({ id: ids.purchase1, total_amount_ex_vat: 100 }),
      }),
      link({
        id: 'l2',
        purchase_id: ids.purchase2,
        match_status: 'difference',
        amount_difference: 200,
        purchase: purchase({ id: ids.purchase2, total_amount_ex_vat: 100 }),
      }),
      link({
        id: 'l3',
        purchase_id: ids.purchase3,
        match_status: 'difference',
        amount_difference: 200,
        purchase: purchase({ id: ids.purchase3, total_amount_ex_vat: 100 }),
      }),
    ],
  });
  const result = await listSupplierControlDocuments(db, {
    storeId: ids.storeA,
    filters: { limit: 10 },
  });
  assert.strictEqual(result.documents[0].amount_difference, 0);
  assert.strictEqual(result.documents[0].has_difference, false);

  const summary = await recalculateSupplierControl(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.strictEqual(summary.control_status, 'conforme');
  assert.strictEqual(summary.difference_total, 0);
}

async function testToleranceEnvironmentIsSharedByListDetailAndRecalculate() {
  const previousAbsolute = process.env.PENNYLANE_SUPPLIER_GLOBAL_AMOUNT_TOLERANCE;
  const previousRatio = process.env.PENNYLANE_SUPPLIER_GLOBAL_AMOUNT_RATIO_TOLERANCE;
  process.env.PENNYLANE_SUPPLIER_GLOBAL_AMOUNT_TOLERANCE = '100';
  process.env.PENNYLANE_SUPPLIER_GLOBAL_AMOUNT_RATIO_TOLERANCE = '0.005';

  try {
    const db = createMockDb({
      doc: document({ amount_ex_vat: 1000 }),
      links: [link({
        amount_difference: 80,
        purchase: purchase({ total_amount_ex_vat: 920 }),
      })],
    });

    assert.strictEqual(amountTolerance(1000), 100);

    const list = await listSupplierControlDocuments(db, {
      storeId: ids.storeA,
      filters: { limit: 10 },
    });
    const listCall = db.calls.find((call) => /WITH active_link_purchases AS/i.test(call.sql));
    assert.strictEqual(Number(listCall.params[listCall.params.length - 2]), 100);
    assert.strictEqual(Number(listCall.params[listCall.params.length - 1]), 0.005);
    assert.strictEqual(list.documents[0].amount_difference, 80);
    assert.strictEqual(list.documents[0].has_difference, false);

    const detail = await getSupplierControlDocument(db, {
      storeId: ids.storeA,
      pennylaneSupplierInvoiceId: ids.doc,
    });
    assert.strictEqual(detail.summary.difference_total, 80);
    assert.strictEqual(detail.summary.control_status, 'conforme');
    assert.strictEqual(detail.summary.can_validate, true);

    const recalculated = await recalculateSupplierControl(db, {
      storeId: ids.storeA,
      documentId: ids.doc,
    });
    assert.strictEqual(recalculated.difference_total, 80);
    assert.strictEqual(recalculated.control_status, 'conforme');
    assert.strictEqual(recalculated.can_validate, true);
  } finally {
    if (previousAbsolute === undefined) delete process.env.PENNYLANE_SUPPLIER_GLOBAL_AMOUNT_TOLERANCE;
    else process.env.PENNYLANE_SUPPLIER_GLOBAL_AMOUNT_TOLERANCE = previousAbsolute;
    if (previousRatio === undefined) delete process.env.PENNYLANE_SUPPLIER_GLOBAL_AMOUNT_RATIO_TOLERANCE;
    else process.env.PENNYLANE_SUPPLIER_GLOBAL_AMOUNT_RATIO_TOLERANCE = previousRatio;
  }
}

async function testPurchaseCandidates() {
  const db = createMockDb({
    purchases: [
      purchase({ id: ids.purchase1, total_amount_ex_vat: 100, bl_number: 'BL-1' }),
      purchase({ id: ids.purchase2, total_amount_ex_vat: 96, bl_number: 'BL-2' }),
    ],
  });
  const result = await listPurchaseCandidates(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
  });
  assert.strictEqual(result.candidates.length, 2);
  assert.strictEqual(result.candidates[0].purchase_id, ids.purchase1);
  assert.ok(result.candidates[0].score >= result.candidates[1].score);
}

async function testAddLinkIdempotentAndRemoveLink() {
  const db = createMockDb({ purchases: [purchase()] });
  const first = await addPurchaseLink(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseId: ids.purchase1,
    userId: ids.user,
  });
  const second = await addPurchaseLink(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseId: ids.purchase1,
    userId: ids.user,
  });
  assert.strictEqual(first.link.purchase_id, ids.purchase1);
  assert.strictEqual(second.link.purchase_id, ids.purchase1);
  assert.strictEqual(db.state.links.filter((item) => item.purchase_id === ids.purchase1).length, 1);

  const removed = await removePurchaseLink(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseId: ids.purchase1,
    userId: ids.user,
  });
  assert.strictEqual(removed.removed, 1);
  assert.strictEqual(db.state.links[0].match_status, 'removed');
  assert.ok(db.state.events.some((event) => event.event_type === 'match_added'));
  assert.ok(db.state.events.some((event) => event.event_type === 'match_removed'));
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

async function testSupplierAndLockedPurchaseProtections() {
  await assertRejectsWithCode('SUPPLIER_CONTROL_PURCHASE_SUPPLIER_MISMATCH', () => addPurchaseLink(createMockDb({
    purchases: [purchase({ supplier_id: ids.otherSupplier })],
  }), {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseId: ids.purchase1,
  }));

  await assertRejectsWithCode('SUPPLIER_CONTROL_PURCHASE_ALREADY_LOCKED', () => addPurchaseLink(createMockDb({
    purchases: [purchase()],
    incompatibleLinks: [{ id: 'locked-link', supplier_control_status: 'valide_a_payer' }],
  }), {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseId: ids.purchase1,
  }));

  await assertRejectsWithCode('SUPPLIER_CONTROL_PURCHASE_LEGACY_LOCKED', () => addPurchaseLink(createMockDb({
    purchases: [purchase()],
    legacyLocked: [{ id: 'legacy-invoice', status: 'invoice_validated' }],
  }), {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseId: ids.purchase1,
  }));

  await assertRejectsWithCode('SUPPLIER_CONTROL_DOCUMENT_LINKS_LOCKED', () => addPurchaseLink(createMockDb({
    doc: document({ supplier_control_status: 'valide_a_payer' }),
    purchases: [purchase()],
  }), {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseId: ids.purchase1,
  }));

  await assertRejectsWithCode('SUPPLIER_CONTROL_DOCUMENT_LINKS_LOCKED', () => removePurchaseLink(createMockDb({
    doc: document({ payment_status: 'paid', supplier_control_status: 'a_rapprocher' }),
    links: [link()],
  }), {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseId: ids.purchase1,
  }));
}

async function testCreditNoteHasNoStockEffect() {
  const db = createMockDb({
    doc: document({ document_type: 'credit_note', amount_ex_vat: 50 }),
    links: [link({ purchase: purchase({ total_amount_ex_vat: 50 }) })],
  });
  const result = await getSupplierControlDocument(db, {
    storeId: ids.storeA,
    pennylaneSupplierInvoiceId: ids.doc,
  });
  assert.strictEqual(result.document.document_type, 'credit_note');
  assert.ok(!db.calls.some((call) => /stock_movements|UPDATE lots|registerSupplierReturn/i.test(call.sql)));
}

function testRoutesAreRegisteredAndProtected() {
  const route = read(routePath);
  const server = read(serverPath);
  assert.match(server, /const supplierControlRoutes = require\('\.\/routes\/supplierControl'\)/);
  assert.match(server, /app\.use\('\/api', supplierControlRoutes\)/);
  assert.match(route, /router\.get\('\/supplier-control\/documents'/);
  assert.match(route, /router\.get\('\/supplier-control\/documents\/:id'/);
  assert.match(route, /router\.get\('\/supplier-control\/documents\/:id\/purchase-candidates'/);
  assert.match(route, /router\.post\('\/supplier-control\/documents\/:id\/purchase-links'/);
  assert.match(route, /router\.delete\('\/supplier-control\/documents\/:id\/purchase-links\/:purchaseId'/);
  assert.ok((route.match(/authenticateToken/g) || []).length >= 5, 'All supplier-control routes must be authenticated');
  assert.ok((route.match(/attachDbContext/g) || []).length >= 5, 'All supplier-control routes must attach DB context');
  assert.ok((route.match(/requireAdminOrManager/g) || []).length >= 2, 'Write routes must require manager/admin');
}

function testPennylaneLineAuditGuard() {
  const importSync = read(importSyncPath);
  assert.match(importSync, /DELETE FROM pennylane_supplier_invoice_lines/);
  assert.match(importSync, /header only/);
  assert.ok(!/INSERT INTO pennylane_supplier_invoice_lines/i.test(importSync), 'Current supplier invoice sync does not reliably populate Pennylane lines');
}

(async () => {
  assert.strictEqual(canonicalSupplierControlStatus({ payment_status: 'to_be_paid' }), 'valide_a_payer');
  await testListDocumentsAndFilters();
  await testListPaginationKeepsTotalOnEmptyPage();
  await testDetailDocumentLinesAndPdf();
  await testOtherStoreRefused();
  await testRecalculateNoBlOneBlManyBlAndFinalStatuses();
  await testRecalculateReturnsPersistedNextStatus();
  await testListMultiPurchaseInvoiceUsesGlobalDifference();
  await testToleranceEnvironmentIsSharedByListDetailAndRecalculate();
  await testPurchaseCandidates();
  await testAddLinkIdempotentAndRemoveLink();
  await testSupplierAndLockedPurchaseProtections();
  await testCreditNoteHasNoStockEffect();
  testRoutesAreRegisteredAndProtected();
  testPennylaneLineAuditGuard();
  assertNoSupplierInvoiceCreationInNewApiSource();
  console.log('OK supplier control API tests');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
