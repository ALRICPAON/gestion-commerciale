const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dashboardRouter = require('../routes/dashboard');

const { dashboard, purchaseTotals } = dashboardRouter._test;
const root = path.join(__dirname, '../..');

const ids = {
  store: '11111111-1111-4111-8111-111111111111',
  otherStore: '22222222-2222-4222-8222-222222222222',
  purchase: '33333333-3333-4333-8333-333333333333',
  otherPurchase: '44444444-4444-4444-8444-444444444444',
};

function createDashboardDb({
  salesHt = 1000,
  salesTtc = 1200,
  initialStock = 0,
  finalStock = 0,
  purchases = [],
  expectedCreditNotes = [],
  creditNoteLinks = [],
  creditDocuments = [],
} = {}) {
  const calls = [];
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/FROM stock_snapshots/i.test(sql)) {
      const bound = String(params[1] || '');
      return { rows: [{ total_value_ht: bound.includes('23:59') ? finalStock : initialStock }] };
    }
    if (/FROM sales_documents/i.test(sql)) {
      return { rows: [{ ca_ht: salesHt, ca_ttc: salesTtc }] };
    }
    if (/WITH period_purchases AS/i.test(sql)) {
      const [storeId, fromDate, toDate] = params;
      const periodPurchases = purchases.filter((purchase) => {
        const date = purchase.receipt_date || purchase.purchase_date;
        return purchase.store_id === storeId && date >= fromDate && date <= toDate && purchase.status !== 'cancelled';
      });
      const purchaseIds = new Set(periodPurchases.map((purchase) => purchase.id));
      const gross = periodPurchases.reduce((sum, purchase) => (
        sum + (purchase.lines || []).reduce((lineSum, line) => lineSum + Number(line.line_amount_ex_vat || 0), 0)
      ), 0);
      const applied = creditNoteLinks.reduce((sum, link) => {
        if (link.store_id !== storeId || link.status === 'unlinked') return sum;
        const expected = expectedCreditNotes.find((item) => item.id === link.expected_credit_note_id && item.store_id === link.store_id);
        if (!expected || expected.status === 'cancelled' || !purchaseIds.has(expected.source_purchase_id)) return sum;
        const credit = creditDocuments.find((item) => item.id === link.pennylane_credit_note_id && item.store_id === link.store_id);
        if (!credit || credit.document_type !== 'credit_note' || credit.pennylane_deleted_at) return sum;
        return sum + Number(link.applied_amount_ex_vat || 0);
      }, 0);
      return {
        rows: [{
          gross_purchases_ht: gross,
          supplier_credit_notes_applied_ht: applied,
          purchases_ht: Math.max(gross - applied, 0),
        }],
      };
    }
    return { rows: [] };
  };
  return { calls, query };
}

function purchase(overrides = {}) {
  return {
    id: ids.purchase,
    store_id: ids.store,
    receipt_date: '2026-09-08',
    purchase_date: '2026-09-08',
    status: 'received',
    lines: [{ line_amount_ex_vat: 949.5 }],
    ...overrides,
  };
}

function expected(overrides = {}) {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    store_id: ids.store,
    source_purchase_id: ids.purchase,
    status: 'resolved',
    ...overrides,
  };
}

function credit(overrides = {}) {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    store_id: ids.store,
    document_type: 'credit_note',
    ...overrides,
  };
}

function link(overrides = {}) {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    store_id: ids.store,
    expected_credit_note_id: '55555555-5555-4555-8555-555555555555',
    pennylane_credit_note_id: '66666666-6666-4666-8666-666666666666',
    applied_amount_ex_vat: 407.7,
    status: 'matched',
    ...overrides,
  };
}

async function testGrossPurchaseWithoutCreditNote() {
  const db = createDashboardDb({ purchases: [purchase()] });
  const totals = await purchaseTotals(db, ids.store, '2026-09-08', '2026-09-08');
  assert.strictEqual(totals.gross_purchases_ht, 949.5);
  assert.strictEqual(totals.supplier_credit_notes_applied_ht, 0);
  assert.strictEqual(totals.purchases_ht, 949.5);
}

async function testExpectedOnlyDoesNotReduceRealizedPurchases() {
  const db = createDashboardDb({
    purchases: [purchase()],
    expectedCreditNotes: [expected({ status: 'pending' })],
  });
  const totals = await purchaseTotals(db, ids.store, '2026-09-08', '2026-09-08');
  assert.strictEqual(totals.purchases_ht, 949.5);
}

async function testSogelmerRealCreditNoteReducesNetPurchase() {
  const db = createDashboardDb({
    purchases: [purchase()],
    expectedCreditNotes: [expected()],
    creditNoteLinks: [link()],
    creditDocuments: [credit()],
  });
  const result = await dashboard(db, ids.store, { period: 'custom', from: new Date('2026-09-08T00:00:00Z'), to: new Date('2026-09-08T00:00:00Z') });
  assert.strictEqual(result.kpis.gross_purchases_ht, 949.5);
  assert.strictEqual(result.kpis.supplier_credit_notes_applied_ht, 407.7);
  assert.strictEqual(result.kpis.purchases_ht, 541.8);
  assert.strictEqual(result.kpis.consumed_purchases_ht, 541.8);
  assert.strictEqual(result.kpis.gross_margin_ht, 458.2);
}

async function testPartialMultipleUnlinkAndManyToManyNoDoubleCount() {
  const otherExpectedId = '88888888-8888-4888-8888-888888888888';
  let db = createDashboardDb({
    purchases: [purchase()],
    expectedCreditNotes: [expected()],
    creditNoteLinks: [link({ applied_amount_ex_vat: 200 })],
    creditDocuments: [credit()],
  });
  let totals = await purchaseTotals(db, ids.store, '2026-09-08', '2026-09-08');
  assert.strictEqual(totals.purchases_ht, 749.5);

  db = createDashboardDb({
    purchases: [purchase()],
    expectedCreditNotes: [expected()],
    creditNoteLinks: [link({ id: 'l1', applied_amount_ex_vat: 200 }), link({ id: 'l2', applied_amount_ex_vat: 207.7 })],
    creditDocuments: [credit()],
  });
  totals = await purchaseTotals(db, ids.store, '2026-09-08', '2026-09-08');
  assert.strictEqual(Number(totals.purchases_ht.toFixed(2)), 541.8);

  db = createDashboardDb({
    purchases: [purchase()],
    expectedCreditNotes: [expected()],
    creditNoteLinks: [link({ status: 'unlinked' })],
    creditDocuments: [credit()],
  });
  totals = await purchaseTotals(db, ids.store, '2026-09-08', '2026-09-08');
  assert.strictEqual(totals.purchases_ht, 949.5);

  db = createDashboardDb({
    purchases: [purchase(), purchase({ id: ids.otherPurchase, lines: [{ line_amount_ex_vat: 50 }] })],
    expectedCreditNotes: [expected(), expected({ id: otherExpectedId, source_purchase_id: ids.otherPurchase })],
    creditNoteLinks: [link({ applied_amount_ex_vat: 407.7 }), link({ expected_credit_note_id: otherExpectedId, applied_amount_ex_vat: 10 })],
    creditDocuments: [credit()],
  });
  totals = await purchaseTotals(db, ids.store, '2026-09-08', '2026-09-08');
  assert.strictEqual(Number(totals.purchases_ht.toFixed(2)), 581.8);
}

async function testSupplierStorePeriodAndOtherPurchases() {
  const db = createDashboardDb({
    purchases: [
      purchase(),
      purchase({ id: ids.otherPurchase, lines: [{ line_amount_ex_vat: 100 }] }),
    ],
    expectedCreditNotes: [
      expected(),
      expected({ id: 'wrong-store', store_id: ids.otherStore, source_purchase_id: ids.purchase }),
      expected({ id: 'out-of-period', source_purchase_id: 'out-period' }),
    ],
    creditNoteLinks: [
      link(),
      link({ expected_credit_note_id: 'wrong-store', store_id: ids.otherStore, applied_amount_ex_vat: 999 }),
      link({ expected_credit_note_id: 'out-of-period', applied_amount_ex_vat: 999 }),
    ],
    creditDocuments: [
      credit(),
      credit({ id: 'other-kind', document_type: 'invoice' }),
    ],
  });
  const totals = await purchaseTotals(db, ids.store, '2026-09-08', '2026-09-08');
  assert.strictEqual(totals.gross_purchases_ht, 1049.5);
  assert.strictEqual(totals.supplier_credit_notes_applied_ht, 407.7);
  assert.strictEqual(Number(totals.purchases_ht.toFixed(2)), 641.8);

  const nextDay = await purchaseTotals(db, ids.store, '2026-09-09', '2026-09-09');
  assert.strictEqual(nextDay.purchases_ht, 0);
}

function testQueryUsesRealCreditNoteLinksOnly() {
  const db = createDashboardDb({ purchases: [purchase()] });
  return purchaseTotals(db, ids.store, '2026-09-08', '2026-09-08').then(() => {
    const sql = db.calls.find((call) => /WITH period_purchases AS/i.test(call.sql)).sql;
    assert.match(sql, /supplier_expected_credit_note_links/);
    assert.match(sql, /l\.applied_amount_ex_vat/);
    assert.match(sql, /credit\.document_type = 'credit_note'/);
    assert.match(sql, /l\.status <> 'unlinked'/);
    assert.doesNotMatch(sql, /expected_amount_ex_vat/);
  });
}

function testDashboardUiLabelsExposeNetPurchases() {
  const html = fs.readFileSync(path.join(root, 'frontend/tableau-de-bord.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'frontend/js/dashboard.js'), 'utf8');
  assert.match(html, /Achats nets HT periode/);
  assert.match(js, /Achats bruts HT periode/);
  assert.match(js, /Avoirs fournisseurs appliques/);
  assert.match(js, /Achats nets HT periode/);
  assert.match(js, /gross_purchases_ht/);
  assert.match(js, /supplier_credit_notes_applied_ht/);
}

(async () => {
  await testGrossPurchaseWithoutCreditNote();
  await testExpectedOnlyDoesNotReduceRealizedPurchases();
  await testSogelmerRealCreditNoteReducesNetPurchase();
  await testPartialMultipleUnlinkAndManyToManyNoDoubleCount();
  await testSupplierStorePeriodAndOtherPurchases();
  await testQueryUsesRealCreditNoteLinksOnly();
  testDashboardUiLabelsExposeNetPurchases();
  console.log('OK dashboard supplier credit note tests');
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
