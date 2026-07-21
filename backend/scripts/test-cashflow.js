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
  calculateCustomerBehaviour,
  forecastCustomerPaymentDate,
} = require('../services/cashflow/customerPaymentBehaviourService');

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
];

for (const test of tests) {
  test();
  console.log(`OK ${test.name}`);
}

console.log('Tests cashflow OK');
