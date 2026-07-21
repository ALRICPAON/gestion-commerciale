const { addDays, isoDate } = require('./forecastService');

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function amountClose(a, b) {
  const left = Math.abs(Number(a || 0));
  const right = Math.abs(Number(b || 0));
  if (!left || !right) return false;
  return Math.abs(left - right) <= Math.max(2, Math.min(left, right) * 0.08);
}

function detectRecurringTransactions(transactions = []) {
  const groups = new Map();
  for (const tx of transactions) {
    const key = [
      normalizeText(tx.counterparty_name || tx.label),
      tx.direction || '',
      tx.category_code || '',
    ].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  }

  const suggestions = [];
  for (const rows of groups.values()) {
    const sorted = rows
      .filter((row) => row.transaction_date && Number(row.amount || 0) !== 0)
      .sort((a, b) => isoDate(a.transaction_date).localeCompare(isoDate(b.transaction_date)));
    if (sorted.length < 3) continue;

    const base = sorted[0];
    const similar = sorted.filter((row) => amountClose(row.amount, base.amount));
    if (similar.length < 3) continue;

    const dates = similar.slice(-3).map((row) => isoDate(row.transaction_date));
    const dayNumbers = dates.map((date) => Number(date.slice(8, 10)));
    const regularDay = Math.max(...dayNumbers) - Math.min(...dayNumbers) <= 5;
    if (!regularDay) continue;

    suggestions.push({
      suggestion_type: 'transaction_recurrence',
      label: base.counterparty_name || base.label || 'Charge recurrente',
      estimated_amount: Math.round((similar.reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0) / similar.length) * 100) / 100,
      frequency: 'monthly',
      confidence: similar.length >= 4 ? 'elevee' : 'moyenne',
      evidence: {
        dates,
        transaction_ids: similar.slice(-5).map((row) => row.pennylane_transaction_id || row.id),
      },
    });
  }
  return suggestions;
}

function expandRecurringCharges(charges = [], { startDate = new Date(), days = 90 } = {}) {
  const start = isoDate(startDate);
  const end = addDays(start, Math.max(1, Number(days || 90)) - 1);
  const items = [];
  for (const charge of charges.filter((row) => row.active !== false)) {
    let cursor = isoDate(charge.first_due_date || start);
    let guard = 0;
    while (cursor <= end && guard < 400) {
      if (cursor >= start && (!charge.end_date || cursor <= isoDate(charge.end_date))) {
        items.push({
          id: `${charge.id}:${cursor}`,
          label: charge.label,
          date: cursor,
          amount: charge.cash_amount,
          direction: 'out',
          source: 'recurring_charge',
          counterparty_name: charge.category_code,
          status: 'active',
        });
      }
      const date = new Date(`${cursor}T00:00:00.000Z`);
      if (charge.frequency === 'weekly') date.setUTCDate(date.getUTCDate() + 7);
      else if (charge.frequency === 'quarterly') date.setUTCMonth(date.getUTCMonth() + 3);
      else if (charge.frequency === 'yearly') date.setUTCFullYear(date.getUTCFullYear() + 1);
      else date.setUTCMonth(date.getUTCMonth() + 1);
      cursor = isoDate(date);
      guard += 1;
    }
  }
  return items;
}

module.exports = {
  detectRecurringTransactions,
  expandRecurringCharges,
  normalizeText,
};
