const { addDays, isoDate, money } = require('./forecastService');

const DEFAULT_SETTINGS = {
  supplierName: 'DISTRIMER',
  limit: 10000,
  greenThreshold: 8000,
  orangeThreshold: 9500,
  blockingThreshold: 10000,
  targetAfterPayment: 7500,
};

function exposureLevel(exposure, settings = {}) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };
  const value = money(exposure);
  if (value >= cfg.blockingThreshold) return 'bloquant';
  if (value > cfg.orangeThreshold) return 'rouge';
  if (value >= cfg.greenThreshold) return 'orange';
  return 'vert';
}

function calculateDistrimerExposure({ invoices = [], plannedPurchases = [], settings = {} } = {}) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };
  const rows = [...invoices, ...plannedPurchases].map((item) => ({
    id: item.id || item.source_id || null,
    label: item.label || item.invoice_number || item.description || 'DISTRIMER',
    date: isoDate(item.date || item.due_date || item.invoice_date || new Date()),
    amount: money(item.remaining_amount ?? item.amount ?? item.remaining_amount_with_tax),
    source: item.source || 'pennylane',
  }));
  const current = money(rows.reduce((sum, row) => sum + row.amount, 0));
  const sorted = rows.slice().sort((a, b) => a.date.localeCompare(b.date));
  let running = 0;
  let breach = null;

  for (const row of sorted) {
    running = money(running + row.amount);
    if (!breach && running >= cfg.limit) {
      breach = {
        date: row.date,
        exposure: running,
      };
    }
  }

  return {
    supplier_name: cfg.supplierName,
    exposure: current,
    limit: cfg.limit,
    remaining_margin: money(cfg.limit - current),
    target_after_payment: cfg.targetAfterPayment,
    level: exposureLevel(current, cfg),
    breach,
    minimum_payment: breach ? money(Math.max(0, breach.exposure - cfg.limit)) : money(Math.max(0, current - cfg.limit)),
    advised_payment: money(Math.max(0, current - cfg.targetAfterPayment)),
    items: sorted,
  };
}

function simulateDistrimerPayment({
  currentExposure = 0,
  plannedPurchases = 0,
  bankBalance = 0,
  expectedInflows = 0,
  paymentAmount = null,
  settings = {},
  deadline = null,
} = {}) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };
  const futureExposure = money(Number(currentExposure || 0) + Number(plannedPurchases || 0));
  const minimumPayment = money(Math.max(0, futureExposure - cfg.limit));
  const advisedPayment = money(Math.max(0, futureExposure - cfg.targetAfterPayment));
  const simulatedPayment = paymentAmount === null || paymentAmount === undefined ? advisedPayment : money(paymentAmount);
  const exposureAfterPayment = money(futureExposure - simulatedPayment);
  const treasuryAfterPayment = money(Number(bankBalance || 0) + Number(expectedInflows || 0) - simulatedPayment);

  return {
    current_exposure: money(currentExposure),
    planned_purchases: money(plannedPurchases),
    future_exposure: futureExposure,
    minimum_payment: minimumPayment,
    advised_payment: advisedPayment,
    simulated_payment: simulatedPayment,
    exposure_after_payment: exposureAfterPayment,
    treasury_after_payment: treasuryAfterPayment,
    payment_deadline: deadline || addDays(new Date(), 7),
    level_after_payment: exposureLevel(exposureAfterPayment, cfg),
    blocking: futureExposure >= cfg.limit,
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  calculateDistrimerExposure,
  exposureLevel,
  simulateDistrimerPayment,
};
