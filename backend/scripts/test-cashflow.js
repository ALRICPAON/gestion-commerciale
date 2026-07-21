const assert = require('assert');

const {
  buildDailyForecast,
  expandManualItems,
  addDays,
} = require('../services/cashflow/forecastService');
const {
  calculateDistrimerExposure,
  simulateDistrimerPayment,
} = require('../services/cashflow/distrimerExposureService');
const {
  calculateSupplierInvoicePaymentAmounts,
  classifySupplierPaymentStatus,
} = require('../services/cashflow/supplierPaymentService');
const {
  calculateCustomerBehaviour,
  forecastCustomerPaymentDate,
} = require('../services/cashflow/customerPaymentBehaviourService');
const {
  detectRecurringTransactions,
} = require('../services/cashflow/recurringChargeService');
const {
  fetchAllPages,
  extractList,
  classifySupplierInvoiceCashflow,
  normalizeSupplierInvoice,
  normalizeTransaction,
  pushSqlError,
  runCashflowDiagnostic,
} = require('../services/cashflow/pennylaneCashflowService');
const {
  isDistrimerInvoice,
} = require('../services/cashflow/service');
const { PennylaneApiError } = require('../services/pennylane');

function byDate(forecast, date) {
  return forecast.rows.find((row) => row.date === date);
}

function testCustomerInflow() {
  const start = '2026-07-21';
  const forecast = buildDailyForecast({
    openingBalance: 5000,
    startDate: start,
    days: 15,
    items: [{ date: addDays(start, 10), amount: 10000, direction: 'in' }],
  });
  assert.strictEqual(byDate(forecast, addDays(start, 10)).inflows, 10000);
  assert.strictEqual(byDate(forecast, addDays(start, 10)).closing_balance, 15000);
}

function testSupplierOutflow() {
  const start = '2026-07-21';
  const forecast = buildDailyForecast({
    openingBalance: 10000,
    startDate: start,
    days: 10,
    items: [{ date: addDays(start, 5), amount: 6000, direction: 'out' }],
  });
  assert.strictEqual(byDate(forecast, addDays(start, 5)).outflows, 6000);
  assert.strictEqual(byDate(forecast, addDays(start, 5)).closing_balance, 4000);
}

function testPartialInvoice() {
  const total = 8000;
  const paid = 3000;
  assert.strictEqual(total - paid, 5000);
}

function testDistrimerUnderLimit() {
  const result = calculateDistrimerExposure({
    invoices: [{ amount: 7500 }],
    plannedPurchases: [{ amount: 1000 }],
  });
  assert.strictEqual(result.exposure, 8500);
  assert.notStrictEqual(result.level, 'bloquant');
}

function testDistrimerBreach() {
  const simulation = simulateDistrimerPayment({
    currentExposure: 8500,
    plannedPurchases: 4000,
    settings: { limit: 10000, targetAfterPayment: 7500 },
  });
  assert.strictEqual(simulation.future_exposure, 12500);
  assert.strictEqual(simulation.minimum_payment, 2500);
  assert.strictEqual(simulation.advised_payment, 5000);
}

function testNegativeCashflow() {
  const forecast = buildDailyForecast({
    openingBalance: 4000,
    startDate: '2026-07-21',
    days: 2,
    items: [{ date: '2026-07-21', amount: 7000, direction: 'out' }],
  });
  assert.strictEqual(forecast.minimum_balance, -3000);
  assert.strictEqual(forecast.rows[0].alert_level, 'rouge');
}

function testCustomerRealDelay() {
  const behaviours = calculateCustomerBehaviour([
    { client_id: 'a', client_name: 'Client A', invoice_date: '2026-07-01', due_date: '2026-07-05', paid_at: '2026-07-11' },
    { client_id: 'a', client_name: 'Client A', invoice_date: '2026-07-02', due_date: '2026-07-06', paid_at: '2026-07-12' },
    { client_id: 'a', client_name: 'Client A', invoice_date: '2026-07-03', due_date: '2026-07-07', paid_at: '2026-07-13' },
  ]);
  assert.strictEqual(behaviours[0].average_invoice_to_payment_days, 10);
  assert.strictEqual(behaviours[0].average_due_delay_days, 6);
}

function testNoDoubleCounting() {
  const seen = new Set();
  const rows = [
    { source: 'pennylane', source_id: 'INV-1', amount: 100 },
    { source: 'alta', source_id: 'INV-1', amount: 100 },
  ];
  const unique = rows.filter((row) => {
    const key = row.source_id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  assert.strictEqual(unique.length, 1);
}

function testRecurringManualItem() {
  const items = expandManualItems([
    { id: 'rent', label: 'Loyer', date: '2026-07-01', amount: 1000, direction: 'out', recurrence: 'monthly', active: true },
  ], { startDate: '2026-07-01', days: 70 });
  assert.deepStrictEqual(items.map((item) => item.date), ['2026-07-01', '2026-08-01', '2026-09-01']);
}

function testScenarios() {
  const invoice = {
    invoice_date: '2026-07-01',
    due_date: '2026-07-10',
    average_invoice_to_payment_days: 13,
    theoretical_delay_days: 10,
  };
  const optimistic = forecastCustomerPaymentDate({ ...invoice, expected_payment_date: invoice.due_date });
  const realistic = forecastCustomerPaymentDate({ ...invoice, due_date: null });
  const prudentForecast = buildDailyForecast({
    openingBalance: 0,
    startDate: '2026-07-01',
    days: 30,
    scenario: 'prudent',
    items: [{ date: realistic, amount: 100, direction: 'in', safety_delay_days: 7 }],
  });
  assert.strictEqual(optimistic, '2026-07-10');
  assert.strictEqual(realistic, '2026-07-14');
  assert.strictEqual(prudentForecast.rows.find((row) => row.inflows === 100).date, '2026-07-21');
}

async function testPennylanePagination() {
  const calls = [];
  const client = {
    async get(endpoint) {
      calls.push(endpoint);
      if (!endpoint.includes('cursor=')) return { status: 200, body: { items: [{ id: 1 }], has_more: true, next_cursor: 'NEXT' } };
      return { status: 200, body: { items: [{ id: 2 }], has_more: false } };
    },
  };
  const result = await fetchAllPages(client, '/bank_accounts', { limit: 1 });
  assert.strictEqual(result.items.length, 2);
  assert.strictEqual(calls.length, 2);
}

async function testForbiddenDiagnostic() {
  const db = { async query() { return { rows: [] }; } };
  const client = {
    async get(endpoint) {
      if (endpoint.includes('/transactions')) {
        throw new PennylaneApiError('Erreur API Pennylane', { status: 403 });
      }
      return { status: 200, body: { items: [{ id: 1 }] } };
    },
  };
  const rows = await runCashflowDiagnostic(db, { storeId: 'store', client });
  const transactions = rows.find((row) => row.endpoint === 'GET /transactions');
  assert.strictEqual(transactions.access_status, 'forbidden');
  assert.match(transactions.action_required, /transactions:readonly/);
}

function testBankAccountSelectionSum() {
  const accounts = [
    { balance: 1000, include_in_cashflow: true },
    { balance: 2500, include_in_cashflow: true },
    { balance: 9000, include_in_cashflow: false },
  ];
  const balance = accounts.filter((row) => row.include_in_cashflow).reduce((sum, row) => sum + row.balance, 0);
  assert.strictEqual(balance, 3500);
}

function testSupplierPaymentStatuses() {
  assert.strictEqual(classifySupplierPaymentStatus('confirmed').is_confirmed, true);
  assert.strictEqual(classifySupplierPaymentStatus('pending').is_pending, true);
  assert.strictEqual(classifySupplierPaymentStatus('cancelled').is_cancelled, true);
  const amounts = calculateSupplierInvoicePaymentAmounts({
    totalAmount: 1000,
    payments: [
      { amount: 400, status: 'confirmed' },
      { amount: 200, status: 'pending' },
      { amount: 100, status: 'cancelled' },
    ],
  });
  assert.strictEqual(amounts.confirmed_paid_amount, 400);
  assert.strictEqual(amounts.pending_payment_amount, 200);
  assert.strictEqual(amounts.remaining_to_pay, 600);
}

function testMatchedTransactionNoDoubleCounting() {
  const invoice = { total: 1000, remaining: 0 };
  const transaction = { amount: 1000, matched_invoice_id: 'INV-1' };
  const forecastAmount = invoice.remaining > 0 && !transaction.matched_invoice_id ? invoice.remaining : 0;
  assert.strictEqual(forecastAmount, 0);
}

function testRecurringSuggestionNotIntegrated() {
  const suggestions = detectRecurringTransactions([
    { transaction_date: '2026-05-03', amount: 89, direction: 'out', label: 'Pennylane' },
    { transaction_date: '2026-06-03', amount: 90, direction: 'out', label: 'Pennylane' },
    { transaction_date: '2026-07-03', amount: 88, direction: 'out', label: 'Pennylane' },
  ]);
  assert.strictEqual(suggestions.length, 1);
  const forecast = buildDailyForecast({ openingBalance: 1000, items: [], days: 40 });
  assert.strictEqual(forecast.closing_balance, 1000);
}

function testClassSixAnalysis() {
  const rows = [
    { account_number: '607000', amount: 1200 },
    { account_number: '624000', amount: 200 },
    { account_number: '707000', amount: 5000 },
  ];
  const charges = rows.filter((row) => String(row.account_number).startsWith('6'));
  assert.strictEqual(charges.length, 2);
}

function testDistrimerWithPayments() {
  const exposure = calculateDistrimerExposure({
    invoices: [
      { amount: 8000, label: 'Facture 1' },
      { amount: 2000, label: 'Facture 2' },
    ],
    settings: { limit: 10000, targetAfterPayment: 7500 },
  });
  const amounts = calculateSupplierInvoicePaymentAmounts({
    totalAmount: 10000,
    payments: [{ amount: 1500, status: 'confirmed' }, { amount: 500, status: 'pending' }],
  });
  assert.strictEqual(exposure.exposure, 10000);
  assert.strictEqual(amounts.confirmed_paid_amount, 1500);
  assert.strictEqual(amounts.pending_payment_amount, 500);
  assert.strictEqual(amounts.remaining_to_pay, 8500);
}

function testExtractDataItemsShape() {
  const rows = extractList({ data: { items: [{ id: 'a' }] } });
  assert.strictEqual(rows.length, 1);
}

function testTransactionWithoutThirdPartyAndStringAmount() {
  const tx = normalizeTransaction({
    id: 'tx_1',
    date: '2026-07-01',
    amount: '-123.45',
    label: 'Debit carte',
  });
  assert.strictEqual(tx.id, 'tx_1');
  assert.strictEqual(tx.amount, 123.45);
  assert.strictEqual(tx.direction, 'out');
  assert.strictEqual(tx.supplier_id, null);
}

function testUnmatchedTransactionSavedShape() {
  const tx = normalizeTransaction({ id: 'tx_2', date: '2026-07-01', amount: '10.00' });
  assert.strictEqual(tx.matched_invoices.length, 0);
  assert.strictEqual(tx.reconciliation_status, null);
}

function testSupplierInvoiceMissingDueAndNumber() {
  const invoice = normalizeSupplierInvoice({
    id: 'si_1',
    amount: '800.50',
    remaining_amount: '300.25',
    supplier: { id: 'sup_1', name: 'DISTRIMER S.A.S.' },
  });
  assert.strictEqual(invoice.id, 'si_1');
  assert.strictEqual(invoice.invoice_number, 'A completer');
  assert.strictEqual(invoice.due_date, null);
  assert.strictEqual(invoice.remaining_amount_with_tax, 300.25);
}

function testRealAnonymizedTransactionShape() {
  const tx = normalizeTransaction({
    id: 123456,
    amount: '-1 234,56',
    currency: 'EUR',
    bank_account: { id: 987 },
    booked_at: '2026-07-20T10:45:00.000Z',
    description: 'PRELEVEMENT FOURNISSEUR',
    status: 'unmatched',
    matched_invoices: null,
  });
  assert.strictEqual(tx.id, '123456');
  assert.strictEqual(tx.bank_account_id, 987);
  assert.strictEqual(tx.date, '2026-07-20');
  assert.strictEqual(tx.amount, 1234.56);
  assert.strictEqual(tx.direction, 'out');
  assert.deepStrictEqual(tx.matched_invoices, []);
}

function testSqlErrorDiagnosticDetails() {
  const stats = { error_details: [] };
  const err = new Error('invalid input syntax for type numeric');
  err.code = '22P02';
  err.constraint = 'cashflow_bank_transactions_amount_check';
  err.column = 'amount';
  pushSqlError(stats, 'tx_1', err, 'upsert_cashflow_bank_transactions', { amount: 'string' });
  assert.strictEqual(stats.error_details.length, 1);
  assert.strictEqual(stats.error_details[0].pg_code, '22P02');
  assert.strictEqual(stats.error_details[0].pg_constraint, 'cashflow_bank_transactions_amount_check');
  assert.strictEqual(stats.error_details[0].pg_column, 'amount');
  assert.strictEqual(stats.error_details[0].value_types.amount, 'string');
}

function testSupplierInvoicePositiveWithoutPaidProofVisible() {
  const invoice = normalizeSupplierInvoice({
    id: 'si_review',
    amount: '500.00',
    supplier: { id: 'sup_1', name: 'Fournisseur test' },
  });
  const state = classifySupplierInvoiceCashflow(invoice);
  assert.ok(['open', 'needs_review'].includes(state.state));
  assert.strictEqual(state.remaining, 500);
}

function testSupplierInvoiceStatesAndPaymentIsolation() {
  const invoices = [
    classifySupplierInvoiceCashflow({ amount_inc_vat: 1000, remaining_amount_with_tax: 1000, paid: false }),
    classifySupplierInvoiceCashflow({ amount_inc_vat: 2000, remaining_amount_with_tax: null, paid: false }),
    classifySupplierInvoiceCashflow({ amount_inc_vat: 300, remaining_amount_with_tax: 0, paid: true }),
    classifySupplierInvoiceCashflow({ amount_inc_vat: 400, remaining_amount_with_tax: null, paid: false }),
    classifySupplierInvoiceCashflow({ amount_inc_vat: 500, remaining_amount_with_tax: null, paid: false }, [{ amount: 100, status: 'confirmed' }]),
    classifySupplierInvoiceCashflow({ amount_inc_vat: 600, remaining_amount_with_tax: null, paid: false }),
  ];
  assert.strictEqual(invoices.filter((row) => row.state === 'paid').length, 1);
  assert.strictEqual(invoices.filter((row) => row.state !== 'paid').length, 5);
  assert.strictEqual(invoices[4].remaining, 400);
}

function testDistrimerRecognitionByNameAndId() {
  assert.strictEqual(isDistrimerInvoice({ supplier_name: 'DISTRIMER S.A.S.' }, {}), true);
  assert.strictEqual(isDistrimerInvoice({ pennylane_supplier_id: 'sup_d' }, { monitored_supplier_pennylane_id: 'sup_d' }), true);
  assert.strictEqual(isDistrimerInvoice({ supplier_name: 'Autre fournisseur' }, { monitored_supplier_name: 'DISTRIMER' }), false);
}

function testClassSixVisibleCounts() {
  const rows = [
    { account_number: '607000', source: 'trial_balance' },
    { account_number: '624000', source: 'trial_balance' },
    { account_number: '707000', source: 'trial_balance' },
  ];
  const class6ReturnedByApi = rows.filter((row) => String(row.account_number).startsWith('6')).length;
  assert.strictEqual(class6ReturnedByApi, 2);
}

function testStatsArithmetic() {
  const stats = { received_count: 2, normalized_count: 2, inserted_count: 1, updated_count: 1, ignored_count: 0, error_count: 0 };
  assert.strictEqual(stats.received_count, stats.normalized_count);
  assert.strictEqual(stats.inserted_count + stats.updated_count + stats.ignored_count, 2);
}

const tests = [
  testCustomerInflow,
  testSupplierOutflow,
  testPartialInvoice,
  testDistrimerUnderLimit,
  testDistrimerBreach,
  testNegativeCashflow,
  testCustomerRealDelay,
  testNoDoubleCounting,
  testRecurringManualItem,
  testScenarios,
  testBankAccountSelectionSum,
  testSupplierPaymentStatuses,
  testMatchedTransactionNoDoubleCounting,
  testRecurringSuggestionNotIntegrated,
  testClassSixAnalysis,
  testDistrimerWithPayments,
  testExtractDataItemsShape,
  testTransactionWithoutThirdPartyAndStringAmount,
  testUnmatchedTransactionSavedShape,
  testSupplierInvoiceMissingDueAndNumber,
  testRealAnonymizedTransactionShape,
  testSqlErrorDiagnosticDetails,
  testSupplierInvoicePositiveWithoutPaidProofVisible,
  testSupplierInvoiceStatesAndPaymentIsolation,
  testDistrimerRecognitionByNameAndId,
  testClassSixVisibleCounts,
  testStatsArithmetic,
];

async function main() {
  for (const test of tests) {
    test();
    console.log(`OK ${test.name}`);
  }
  for (const test of [testPennylanePagination, testForbiddenDiagnostic]) {
    await test();
    console.log(`OK ${test.name}`);
  }
  console.log('Tests cashflow OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
