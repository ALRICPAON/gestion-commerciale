const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  addPurchaseLink,
  analyzeSupplierControlMatches,
  applySupplierControlMatch,
  recalculateSupplierControl,
  removePurchaseLink,
  resolveSupplierControlDifference,
  supplierControlMatchSignature,
} = require('../services/supplierControlService');

const routePath = path.join(__dirname, '../routes/supplierControl.js');
const servicePath = path.join(__dirname, '../services/supplierControlService.js');
const migrationPath = path.join(__dirname, '../db/gestion-commerciale/113_supplier_control_matching_events.sql');

const ids = {
  storeA: '00000000-0000-4000-8000-000000000001',
  storeB: '00000000-0000-4000-8000-000000000002',
  user: '00000000-0000-4000-8000-000000000010',
  doc: '00000000-0000-4000-8000-000000000100',
  supplier: '00000000-0000-4000-8000-000000000200',
  otherSupplier: '00000000-0000-4000-8000-000000000201',
  p1: '00000000-0000-4000-8000-000000000301',
  p2: '00000000-0000-4000-8000-000000000302',
  p3: '00000000-0000-4000-8000-000000000303',
  p4: '00000000-0000-4000-8000-000000000304',
};

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function document(overrides = {}) {
  return {
    id: ids.doc,
    store_id: ids.storeA,
    pennylane_supplier_invoice_id: 'pl-supplier-invoice-1',
    supplier_id: ids.supplier,
    supplier_name: 'LECRI MAREE',
    supplier_code: 'LECRIMAREE',
    invoice_number: 'FAC-BL-1',
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
    id: ids.p1,
    store_id: ids.storeA,
    supplier_id: ids.supplier,
    bl_number: 'BL-1',
    invoice_number: null,
    purchase_date: '2026-09-07',
    order_date: '2026-09-07',
    receipt_date: '2026-09-08',
    status: 'received',
    total_amount_ex_vat: 100,
    purchase_lines_total_ex_vat: 100,
    purchase_lines_count: 1,
    linked_to_locked_document: false,
    ...overrides,
  };
}

function purchaseLine(overrides = {}) {
  return {
    id: 'purchase-line-1',
    purchase_id: ids.p1,
    line_number: 1,
    article_id: '00000000-0000-4000-8000-000000000901',
    article_name: 'HOMARD',
    supplier_reference: 'HOM-600',
    supplier_label: 'HOMARD 600/800',
    received_colis: 1,
    received_pieces: 3,
    received_quantity: 10,
    price_unit: 'kg',
    unit_price_ex_vat: 10,
    line_amount_ex_vat: 100,
    ...overrides,
  };
}

function linkFor(rowPurchase, overrides = {}) {
  return {
    id: `link-${rowPurchase.id}`,
    store_id: ids.storeA,
    pennylane_supplier_invoice_id: ids.doc,
    purchase_id: rowPurchase.id,
    purchase_line_id: null,
    link_type: 'invoice_match',
    match_status: 'matched',
    amount_difference: 0,
    purchase_total_ex_vat: rowPurchase.total_amount_ex_vat,
    purchase_lines_total_ex_vat: rowPurchase.purchase_lines_total_ex_vat,
    bl_number: rowPurchase.bl_number,
    receipt_date: rowPurchase.receipt_date,
    ...overrides,
  };
}

function createMockDb({
  doc = document(),
  purchases = [],
  links = [],
  events = [],
  pennylaneLines = [],
  purchaseLines = [],
  incompatibleLinks = [],
  failOnPurchaseId = null,
} = {}) {
  const calls = [];
  const state = {
    doc: doc ? { ...doc } : null,
    purchases: purchases.map((item) => ({ ...item })),
    links: links.map((item) => ({ ...item })),
    events: events.map((item) => ({ ...item })),
  };

  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    const compact = sql.replace(/\s+/g, ' ');

    if (/BEGIN|COMMIT|ROLLBACK/i.test(sql.trim())) return { rows: [] };

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

    if (/FROM pennylane_supplier_invoice_lines/i.test(sql)) {
      return { rows: pennylaneLines };
    }

    if (/FROM purchase_lines pl/i.test(sql)) {
      return { rows: purchaseLines };
    }

    if (/SELECT id FROM suppliers/i.test(sql)) {
      return { rows: [{ id: params[0], store_id: params[1] }] };
    }

    if (/FROM purchases p/i.test(sql) && /GROUP BY p\.id/i.test(sql)) {
      return {
        rows: state.purchases
          .filter((item) => item.store_id === params[0] && item.supplier_id === params[1])
          .map((item) => ({ ...item })),
      };
    }

    if (/FROM purchases p/i.test(sql) && /FOR UPDATE OF p/i.test(sql)) {
      if (params[0] === failOnPurchaseId) {
        throw new Error('forced validation failure');
      }
      const found = state.purchases.find((item) => item.id === params[0] && item.store_id === params[1]);
      return { rows: found ? [{ ...found }] : [] };
    }

    if (/JOIN pennylane_supplier_invoices linked_psi/i.test(sql)) {
      return { rows: incompatibleLinks };
    }

    if (/FROM supplier_invoice_matches sim/i.test(sql)) return { rows: [] };

    if (/UPDATE supplier_control_document_links/i.test(sql) && /NOT \(purchase_id = ANY/i.test(compact)) {
      const keep = new Set(params[2] || []);
      state.links.forEach((item) => {
        if (!keep.has(item.purchase_id) && item.match_status !== 'removed') item.match_status = 'removed';
      });
      return { rows: [] };
    }

    if (/INSERT INTO supplier_control_document_links/i.test(sql)) {
      const purchaseId = params[2];
      let existing = state.links.find((item) => item.purchase_id === purchaseId && item.purchase_line_id === null);
      const rowPurchase = state.purchases.find((item) => item.id === purchaseId) || purchase({ id: purchaseId });
      if (!existing) {
        existing = linkFor(rowPurchase, {
          id: `link-${state.links.length + 1}`,
          match_status: params[3],
          amount_difference: params[4],
        });
        state.links.push(existing);
      } else {
        existing.match_status = params[3];
        existing.amount_difference = params[4];
      }
      return { rows: [existing] };
    }

    if (/INSERT INTO supplier_control_events/i.test(sql)) {
      if (!params[3] || !state.events.some((event) => event.event_key === params[3])) {
        state.events.push({
          id: `event-${state.events.length + 1}`,
          event_type: params[2],
          event_key: params[3],
          payload: params[4] ? JSON.parse(params[4]) : {},
        });
      }
      return { rows: [] };
    }

    if (/INSERT INTO supplier_expected_credit_notes/i.test(sql)) {
      return {
        rows: [{
          id: 'expected-credit-note-id',
          store_id: params[0],
          supplier_id: params[1],
          source_purchase_id: params[2],
          source_purchase_line_id: params[3],
          source_pennylane_supplier_invoice_id: params[4],
          expected_amount_ex_vat: params[5],
          reason_type: params[6],
          reason_comment: params[7],
          status: 'pending',
        }],
      };
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

async function testSingleAndMultiBlProposals() {
  let db = createMockDb({ purchases: [purchase({ bl_number: 'BL-1', total_amount_ex_vat: 100 })] });
  let result = await analyzeSupplierControlMatches(db, { storeId: ids.storeA, documentId: ids.doc, userId: ids.user });
  assert.ok(['exact', 'strong_candidate'].includes(result.proposals[0].confidence));
  assert.deepStrictEqual(result.proposals[0].purchase_ids, [ids.p1]);
  assert.strictEqual(result.analysis.line_matching_available, false);

  db = createMockDb({
    doc: document({ amount_ex_vat: 300, invoice_number: 'FAC-300' }),
    purchases: [
      purchase({ id: ids.p1, bl_number: 'BL-1', total_amount_ex_vat: 100 }),
      purchase({ id: ids.p2, bl_number: 'BL-2', total_amount_ex_vat: 100 }),
      purchase({ id: ids.p3, bl_number: 'BL-3', total_amount_ex_vat: 100 }),
    ],
  });
  result = await analyzeSupplierControlMatches(db, { storeId: ids.storeA, documentId: ids.doc, userId: ids.user });
  assert.ok(result.proposals.some((proposal) => proposal.purchase_ids.length === 3 && proposal.difference_ex_vat === 0));

  db = createMockDb({
    doc: document({ amount_ex_vat: 500, invoice_number: 'FAC-500' }),
    purchases: [
      purchase({ id: ids.p1, total_amount_ex_vat: 250 }),
      purchase({ id: ids.p2, total_amount_ex_vat: 250 }),
      purchase({ id: ids.p3, total_amount_ex_vat: 300 }),
      purchase({ id: ids.p4, total_amount_ex_vat: 200 }),
    ],
  });
  result = await analyzeSupplierControlMatches(db, { storeId: ids.storeA, documentId: ids.doc, userId: ids.user });
  assert.strictEqual(result.analysis.ambiguous, true);

  db = createMockDb({ purchases: [] });
  result = await analyzeSupplierControlMatches(db, { storeId: ids.storeA, documentId: ids.doc, userId: ids.user });
  assert.strictEqual(result.analysis.result, 'no_match');
  assert.strictEqual(result.proposals.length, 0);
}

async function testFairMultiBlSearchFindsCombinationWithoutTopCandidate() {
  const purchases = [
    purchase({ id: ids.p1, bl_number: 'BL-TOP', total_amount_ex_vat: 95, receipt_date: '2026-09-08' }),
  ];
  for (let index = 2; index <= 18; index += 1) {
    purchases.push(purchase({
      id: `00000000-0000-4000-8000-0000000003${String(index).padStart(2, '0')}`,
      bl_number: `BL-${index}`,
      total_amount_ex_vat: index === 2 || index === 3 ? 50 : 7 + index,
      receipt_date: '2026-09-20',
    }));
  }
  const db = createMockDb({
    doc: document({ amount_ex_vat: 100, invoice_number: 'FAC-100' }),
    purchases,
  });

  const result = await analyzeSupplierControlMatches(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.ok(result.proposals.some((proposal) => (
    proposal.purchase_ids.length === 2 &&
    proposal.purchase_ids.includes(purchases[1].id) &&
    proposal.purchase_ids.includes(purchases[2].id) &&
    proposal.difference_ex_vat === 0
  )));
}

async function testLockedPurchaseIsNeverExactApplicable() {
  const db = createMockDb({
    doc: document({ amount_ex_vat: 100, invoice_number: 'FAC-BL-1' }),
    purchases: [purchase({ total_amount_ex_vat: 100, bl_number: 'BL-1', linked_to_locked_document: true })],
  });
  const result = await analyzeSupplierControlMatches(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.notStrictEqual(result.proposals[0].confidence, 'exact');
  assert.notStrictEqual(result.proposals[0].confidence, 'strong_candidate');
  assert.strictEqual(result.proposals[0].applicable, false);
  assert.ok(result.proposals[0].reasons.includes('purchase_locked'));
}

async function testToleranceAndDifferences() {
  let db = createMockDb({
    doc: document({ amount_ex_vat: 100.5 }),
    purchases: [purchase({ total_amount_ex_vat: 100 })],
  });
  let result = await analyzeSupplierControlMatches(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.ok(Math.abs(result.proposals[0].difference_ex_vat) <= 1);

  db = createMockDb({
    doc: document({ amount_ex_vat: 130 }),
    links: [linkFor(purchase({ total_amount_ex_vat: 100 }))],
    purchases: [purchase({ total_amount_ex_vat: 100 })],
  });
  result = await analyzeSupplierControlMatches(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.ok(result.differences.some((item) => item.type === 'amount_difference' && item.blocking === true));
  assert.ok(db.state.events.some((event) => event.event_type === 'difference_detected'));
}

async function testApplyMatchAtomicIdempotentAndReplacement() {
  let db = createMockDb({
    doc: document({ amount_ex_vat: 200 }),
    purchases: [
      purchase({ id: ids.p1, total_amount_ex_vat: 100 }),
      purchase({ id: ids.p2, total_amount_ex_vat: 100 }),
    ],
  });
  const first = await applySupplierControlMatch(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseIds: [ids.p1, ids.p2],
    userId: ids.user,
  });
  const second = await applySupplierControlMatch(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseIds: [ids.p1, ids.p2],
    userId: ids.user,
  });
  assert.strictEqual(first.summary.control_status, 'conforme');
  assert.strictEqual(second.summary.control_status, 'conforme');
  assert.strictEqual(db.state.links.filter((item) => item.match_status !== 'removed').length, 2);
  assert.strictEqual(db.state.events.filter((event) => event.event_type === 'match_applied').length, 1);

  db = createMockDb({
    doc: document({ amount_ex_vat: 100 }),
    links: [linkFor(purchase({ id: ids.p1 })), linkFor(purchase({ id: ids.p2 }))],
    purchases: [purchase({ id: ids.p3, total_amount_ex_vat: 100 })],
  });
  await applySupplierControlMatch(db, { storeId: ids.storeA, documentId: ids.doc, purchaseIds: [ids.p3] });
  assert.strictEqual(db.state.links.filter((item) => item.match_status !== 'removed').length, 1);
  assert.strictEqual(db.state.links.find((item) => item.purchase_id === ids.p1).match_status, 'removed');

  db = createMockDb({
    doc: document({ amount_ex_vat: 200 }),
    purchases: [purchase({ id: ids.p1, total_amount_ex_vat: 100 }), purchase({ id: ids.p2, total_amount_ex_vat: 100 })],
    failOnPurchaseId: ids.p2,
  });
  await assert.rejects(() => applySupplierControlMatch(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseIds: [ids.p1, ids.p2],
  }));
  assert.strictEqual(db.state.links.length, 0);
  assert.ok(db.calls.some((call) => /ROLLBACK/i.test(call.sql)));
}

async function testEffectivePurchaseTotalIsSharedByAnalyzeApplyAndRecalculate() {
  const rowPurchase = purchase({
    id: ids.p1,
    total_amount_ex_vat: 0,
    purchase_lines_total_ex_vat: 100,
    bl_number: 'BL-LINES-100',
  });
  const db = createMockDb({
    doc: document({ amount_ex_vat: 100, invoice_number: 'FAC-LINES' }),
    purchases: [rowPurchase],
  });

  const analysis = await analyzeSupplierControlMatches(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.strictEqual(analysis.proposals[0].combination_total_ex_vat, 100);
  assert.strictEqual(analysis.proposals[0].difference_ex_vat, 0);

  const applied = await applySupplierControlMatch(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseIds: [ids.p1],
  });
  assert.strictEqual(applied.summary.difference_total, 0);
  assert.strictEqual(applied.summary.control_status, 'conforme');

  const recalculated = await recalculateSupplierControl(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.strictEqual(recalculated.difference_total, 0);
  assert.strictEqual(recalculated.control_status, 'conforme');
}

async function testApplyMatchGuards() {
  await assertRejectsWithCode('SUPPLIER_CONTROL_PURCHASE_SUPPLIER_MISMATCH', () => applySupplierControlMatch(createMockDb({
    purchases: [purchase({ supplier_id: ids.otherSupplier })],
  }), {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseIds: [ids.p1],
  }));

  await assertRejectsWithCode('SUPPLIER_CONTROL_PURCHASE_STATUS_BLOCKED', () => applySupplierControlMatch(createMockDb({
    purchases: [purchase({ status: 'ordered' })],
  }), {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseIds: [ids.p1],
  }));

  await assertRejectsWithCode('SUPPLIER_CONTROL_PURCHASE_ALREADY_LOCKED', () => applySupplierControlMatch(createMockDb({
    purchases: [purchase()],
    incompatibleLinks: [{ id: 'locked' }],
  }), {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseIds: [ids.p1],
  }));

  await assertRejectsWithCode('SUPPLIER_CONTROL_DOCUMENT_LINKS_LOCKED', () => applySupplierControlMatch(createMockDb({
    doc: document({ supplier_control_status: 'paye' }),
    purchases: [purchase()],
  }), {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseIds: [ids.p1],
  }));

  const crossStore = await analyzeSupplierControlMatches(createMockDb({
    doc: document({ store_id: ids.storeB }),
    purchases: [purchase()],
  }), {
    storeId: ids.storeA,
    documentId: ids.doc,
  });
  assert.strictEqual(crossStore, null);
}

async function testPurchaseLinesAndPennylaneLines() {
  const db = createMockDb({
    purchases: [purchase()],
    purchaseLines: [purchaseLine()],
    pennylaneLines: [],
  });
  const applied = await applySupplierControlMatch(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseIds: [ids.p1],
  });
  assert.strictEqual(applied.purchase_lines.length, 1);
  const analysis = await analyzeSupplierControlMatches(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.strictEqual(analysis.line_matching_available, false);
}

async function testRepeatedAnalysisEventsAreIdempotent() {
  const db = createMockDb({ purchases: [purchase()] });
  await analyzeSupplierControlMatches(db, { storeId: ids.storeA, documentId: ids.doc, userId: ids.user });
  await analyzeSupplierControlMatches(db, { storeId: ids.storeA, documentId: ids.doc, userId: ids.user });
  assert.strictEqual(db.state.events.filter((event) => event.event_type === 'automatic_analysis').length, 1);
}

async function testResolutionsAndValidation() {
  let db = createMockDb({
    doc: document({ amount_ex_vat: 130, supplier_control_status: 'ecart' }),
    links: [linkFor(purchase({ total_amount_ex_vat: 100 }))],
  });
  let result = await resolveSupplierControlDifference(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    resolutionType: 'accepted_difference',
    comment: 'Ecart commercial accepte',
    userId: ids.user,
  });
  assert.strictEqual(result.summary.control_status, 'ecart');
  assert.strictEqual(result.summary.accepted_difference, true);
  assert.strictEqual(result.summary.can_validate, true);
  assert.ok(db.state.events.some((event) => event.event_type === 'difference_accepted'));

  await assertRejectsWithCode('SUPPLIER_CONTROL_RESOLUTION_COMMENT_REQUIRED', () => resolveSupplierControlDifference(createMockDb(), {
    storeId: ids.storeA,
    documentId: ids.doc,
    resolutionType: 'accepted_difference',
    comment: '',
  }));

  db = createMockDb({ doc: document({ amount_ex_vat: 130 }), links: [linkFor(purchase({ total_amount_ex_vat: 100 }))] });
  result = await resolveSupplierControlDifference(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    resolutionType: 'supplier_credit_note_expected',
    expectedCreditNoteAmount: 30,
    comment: 'Avoir demande fournisseur',
  });
  assert.strictEqual(result.summary.control_status, 'avoir_attendu');
  assert.strictEqual(result.summary.can_validate, false);
  assert.ok(db.state.events.some((event) => event.event_type === 'expected_credit_note'));

  db = createMockDb({ doc: document({ amount_ex_vat: 130 }), links: [linkFor(purchase({ total_amount_ex_vat: 100 }))] });
  result = await resolveSupplierControlDifference(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    resolutionType: 'dispute',
    comment: 'Litige ouvert',
  });
  assert.strictEqual(result.summary.control_status, 'litige');
  assert.strictEqual(result.summary.can_validate, false);
  assert.ok(db.state.events.some((event) => event.event_type === 'dispute_opened'));
}

async function testResolutionStatusesOverrideHistoricalAltaStatusesAndLockLinks() {
  let db = createMockDb({
    doc: document({ alta_business_status: 'en_controle', supplier_control_status: 'a_controler' }),
    links: [linkFor(purchase())],
    purchases: [purchase()],
  });
  let result = await resolveSupplierControlDifference(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    resolutionType: 'dispute',
    comment: 'Litige malgre ancien statut',
  });
  assert.strictEqual(result.summary.control_status, 'litige');
  result = await recalculateSupplierControl(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.strictEqual(result.control_status, 'litige');
  await assertRejectsWithCode('SUPPLIER_CONTROL_DOCUMENT_LINKS_LOCKED', () => applySupplierControlMatch(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseIds: [ids.p1],
  }));
  await assertRejectsWithCode('SUPPLIER_CONTROL_DOCUMENT_LINKS_LOCKED', () => addPurchaseLink(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseId: ids.p1,
  }));
  await assertRejectsWithCode('SUPPLIER_CONTROL_DOCUMENT_LINKS_LOCKED', () => removePurchaseLink(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseId: ids.p1,
  }));

  db = createMockDb({
    doc: document({ alta_business_status: 'conforme', supplier_control_status: 'conforme' }),
    links: [linkFor(purchase({ total_amount_ex_vat: 90 }))],
    purchases: [purchase()],
  });
  result = await resolveSupplierControlDifference(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    resolutionType: 'supplier_credit_note_expected',
    expectedCreditNoteAmount: 10,
    comment: 'Avoir attendu malgre ancien conforme',
  });
  assert.strictEqual(result.summary.control_status, 'avoir_attendu');
  result = await recalculateSupplierControl(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.strictEqual(result.control_status, 'avoir_attendu');
  await assertRejectsWithCode('SUPPLIER_CONTROL_DOCUMENT_LINKS_LOCKED', () => applySupplierControlMatch(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseIds: [ids.p1],
  }));
  await assertRejectsWithCode('SUPPLIER_CONTROL_DOCUMENT_LINKS_LOCKED', () => addPurchaseLink(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseId: ids.p1,
  }));
  await assertRejectsWithCode('SUPPLIER_CONTROL_DOCUMENT_LINKS_LOCKED', () => removePurchaseLink(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseId: ids.p1,
  }));
}

async function testAcceptedDifferenceIsBoundToCurrentMatchSignature() {
  const p990 = purchase({ id: ids.p1, total_amount_ex_vat: 990, bl_number: 'BL-990' });
  const p920 = purchase({ id: ids.p2, total_amount_ex_vat: 920, bl_number: 'BL-920' });
  const db = createMockDb({
    doc: document({ amount_ex_vat: 1000, supplier_control_status: 'ecart' }),
    links: [linkFor(p990)],
    purchases: [p990, p920],
  });

  let result = await resolveSupplierControlDifference(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    resolutionType: 'accepted_difference',
    comment: 'Ecart 10 EUR accepte',
    userId: ids.user,
  });
  assert.strictEqual(result.summary.accepted_difference, true);
  assert.strictEqual(result.summary.can_validate, true);
  const acceptedEvent = db.state.events.find((event) => event.event_type === 'difference_accepted');
  assert.strictEqual(acceptedEvent.payload.amount_difference, 10);
  assert.deepStrictEqual(acceptedEvent.payload.purchase_ids, [ids.p1]);
  assert.strictEqual(acceptedEvent.payload.match_signature, supplierControlMatchSignature(db.state.doc, db.state.links).match_signature);

  result = await applySupplierControlMatch(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseIds: [ids.p2],
    userId: ids.user,
  });
  assert.ok(db.state.events.some((event) => event.event_type === 'difference_accepted'));
  assert.strictEqual(result.summary.difference_total, 80);
  assert.strictEqual(result.summary.accepted_difference, false);
  assert.strictEqual(result.summary.can_validate, false);
  assert.ok(result.summary.blocking_reasons.includes('difference_non_resolue'));
}

async function testAcceptedDifferenceSurvivesIdempotentReplayAndSortedOrder() {
  const p600 = purchase({ id: ids.p1, total_amount_ex_vat: 600, bl_number: 'BL-600' });
  const p390 = purchase({ id: ids.p2, total_amount_ex_vat: 390, bl_number: 'BL-390' });
  const db = createMockDb({
    doc: document({ amount_ex_vat: 1000, supplier_control_status: 'ecart' }),
    links: [linkFor(p600), linkFor(p390)],
    purchases: [p600, p390],
  });

  await resolveSupplierControlDifference(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    resolutionType: 'accepted_difference',
    comment: 'Ecart 10 EUR accepte',
  });
  let result = await applySupplierControlMatch(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseIds: [ids.p2, ids.p1],
  });
  assert.strictEqual(result.summary.difference_total, 10);
  assert.strictEqual(result.summary.accepted_difference, true);
  assert.strictEqual(result.summary.can_validate, true);

  result = await applySupplierControlMatch(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseIds: [ids.p1, ids.p2],
  });
  assert.strictEqual(result.summary.accepted_difference, true);
  assert.strictEqual(db.state.events.filter((event) => event.event_type === 'difference_accepted').length, 1);
}

async function testAcceptedDifferenceInvalidatesForDifferentPurchasesOrAmount() {
  const p990 = purchase({ id: ids.p1, total_amount_ex_vat: 990, bl_number: 'BL-990' });
  const p980 = purchase({ id: ids.p2, total_amount_ex_vat: 980, bl_number: 'BL-980' });
  const p10 = purchase({ id: ids.p3, total_amount_ex_vat: 10, bl_number: 'BL-10' });
  let db = createMockDb({
    doc: document({ amount_ex_vat: 1000, supplier_control_status: 'ecart' }),
    links: [linkFor(p990)],
    purchases: [p990, p980, p10],
  });

  await resolveSupplierControlDifference(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    resolutionType: 'accepted_difference',
    comment: 'Ecart 10 EUR accepte',
  });
  let result = await applySupplierControlMatch(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    purchaseIds: [ids.p2, ids.p3],
  });
  assert.strictEqual(result.summary.difference_total, 10);
  assert.strictEqual(result.summary.accepted_difference, false);
  assert.strictEqual(result.summary.can_validate, false);

  db = createMockDb({
    doc: document({ amount_ex_vat: 1000, supplier_control_status: 'ecart' }),
    links: [linkFor(p990)],
    purchases: [p990],
  });
  await resolveSupplierControlDifference(db, {
    storeId: ids.storeA,
    documentId: ids.doc,
    resolutionType: 'accepted_difference',
    comment: 'Ecart 10 EUR accepte',
  });
  db.state.doc.amount_ex_vat = 1070;
  result = await recalculateSupplierControl(db, { storeId: ids.storeA, documentId: ids.doc });
  assert.strictEqual(result.difference_total, 80);
  assert.strictEqual(result.accepted_difference, false);
  assert.strictEqual(result.can_validate, false);
  assert.ok(result.blocking_reasons.includes('difference_non_resolue'));
}

function testStaticContracts() {
  const route = read(routePath);
  const service = read(servicePath);
  const migration = read(migrationPath);
  assert.match(route, /router\.post\('\/supplier-control\/documents\/:id\/analyze'/);
  assert.match(route, /router\.post\('\/supplier-control\/documents\/:id\/apply-match'/);
  assert.match(route, /router\.post\('\/supplier-control\/documents\/:id\/resolve-difference'/);
  assert.ok((route.match(/requireAdminOrManager/g) || []).length >= 4);
  assert.match(migration, /match_applied/);
  assert.match(migration, /difference_accepted/);
  assert.match(migration, /dispute_opened/);
  assert.ok(!/INSERT INTO supplier_invoices/i.test(route + service), 'PR3 must not create supplier_invoices');
  assert.ok(!/createPennylaneClient|registerSupplierReturn|stock_movements|UPDATE lots/i.test(route + service), 'PR3 must not call Pennylane or affect stock');
}

(async () => {
  await testSingleAndMultiBlProposals();
  await testFairMultiBlSearchFindsCombinationWithoutTopCandidate();
  await testLockedPurchaseIsNeverExactApplicable();
  await testToleranceAndDifferences();
  await testApplyMatchAtomicIdempotentAndReplacement();
  await testEffectivePurchaseTotalIsSharedByAnalyzeApplyAndRecalculate();
  await testApplyMatchGuards();
  await testPurchaseLinesAndPennylaneLines();
  await testRepeatedAnalysisEventsAreIdempotent();
  await testResolutionsAndValidation();
  await testResolutionStatusesOverrideHistoricalAltaStatusesAndLockLinks();
  await testAcceptedDifferenceIsBoundToCurrentMatchSignature();
  await testAcceptedDifferenceSurvivesIdempotentReplayAndSortedOrder();
  await testAcceptedDifferenceInvalidatesForDifferentPurchasesOrAmount();
  testStaticContracts();
  console.log('OK supplier control matching tests');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
