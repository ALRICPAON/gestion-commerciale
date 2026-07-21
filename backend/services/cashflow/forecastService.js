const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(value = new Date()) {
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${isoDate(value)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return isoDate(date);
}

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function normalizeForecastItem(item = {}) {
  const direction = item.direction || item.type || 'in';
  return {
    id: item.id || item.source_id || null,
    label: item.label || item.description || 'Mouvement previsionnel',
    date: isoDate(item.date || item.expected_date || item.forecast_date || new Date()),
    amount: Math.abs(money(item.amount ?? item.remaining_amount)),
    direction: ['out', 'sortie', 'debit'].includes(String(direction).toLowerCase()) ? 'out' : 'in',
    source: item.source || 'manual',
    source_id: item.source_id || item.id || null,
    counterparty_name: item.counterparty_name || item.client_name || item.supplier_name || null,
    status: item.status || null,
  };
}

function scenarioDate(item, scenario = 'realiste') {
  const normalized = normalizeForecastItem(item);
  if (normalized.direction === 'out') return normalized.date;
  if (scenario === 'optimiste') return isoDate(item.due_date || item.theoretical_date || normalized.date);
  if (scenario === 'prudent') return addDays(normalized.date, Number(item.safety_delay_days ?? 7));
  return normalized.date;
}

function buildDailyForecast({
  openingBalance = 0,
  items = [],
  startDate = new Date(),
  days = 30,
  scenario = 'realiste',
} = {}) {
  const start = isoDate(startDate);
  const horizon = Math.max(1, Number(days || 30));
  const normalizedItems = items.map((item) => ({
    ...normalizeForecastItem(item),
    date: scenarioDate(item, scenario),
    due_date: item.due_date || null,
  }));
  let balance = money(openingBalance);
  let minimumBalance = balance;
  let minimumDate = start;
  let firstNegativeDate = balance < 0 ? start : null;
  const rows = [];

  for (let offset = 0; offset < horizon; offset += 1) {
    const date = addDays(start, offset);
    const dayItems = normalizedItems.filter((item) => item.date === date);
    const inflows = money(dayItems.filter((item) => item.direction === 'in').reduce((sum, item) => sum + item.amount, 0));
    const outflows = money(dayItems.filter((item) => item.direction === 'out').reduce((sum, item) => sum + item.amount, 0));
    const opening = balance;
    balance = money(balance + inflows - outflows);

    if (balance < minimumBalance) {
      minimumBalance = balance;
      minimumDate = date;
    }
    if (!firstNegativeDate && balance < 0) firstNegativeDate = date;

    rows.push({
      date,
      opening_balance: opening,
      inflows,
      outflows,
      closing_balance: balance,
      items: dayItems,
      alert_level: balance < 0 ? 'rouge' : 'normal',
    });
  }

  return {
    start_date: start,
    days: horizon,
    scenario,
    opening_balance: money(openingBalance),
    closing_balance: balance,
    minimum_balance: minimumBalance,
    minimum_date: minimumDate,
    first_negative_date: firstNegativeDate,
    rows,
  };
}

function weekKey(dateValue) {
  const date = new Date(`${isoDate(dateValue)}T00:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / DAY_MS) + 1) / 7);
  return `${date.getUTCFullYear()}-S${String(week).padStart(2, '0')}`;
}

function buildWeeklyForecast(dailyRows = []) {
  const weeks = new Map();
  for (const row of dailyRows) {
    const key = weekKey(row.date);
    if (!weeks.has(key)) {
      weeks.set(key, {
        week: key,
        start_date: row.date,
        opening_balance: row.opening_balance,
        inflows: 0,
        outflows: 0,
        closing_balance: row.closing_balance,
        items: [],
      });
    }
    const week = weeks.get(key);
    week.inflows = money(week.inflows + row.inflows);
    week.outflows = money(week.outflows + row.outflows);
    week.closing_balance = row.closing_balance;
    week.items.push(...(row.items || []));
  }
  return Array.from(weeks.values());
}

function expandManualItems(items = [], { startDate = new Date(), days = 90 } = {}) {
  const start = isoDate(startDate);
  const end = addDays(start, Math.max(1, Number(days || 90)) - 1);
  const expanded = [];
  const stepDays = {
    weekly: 7,
    hebdomadaire: 7,
  };

  for (const item of items.filter((entry) => entry.active !== false)) {
    const recurrence = String(item.recurrence || 'unique').toLowerCase();
    let cursor = isoDate(item.date || item.forecast_date || item.expected_date || start);
    let guard = 0;

    while (cursor <= end && guard < 400) {
      if (cursor >= start) {
        expanded.push({
          ...item,
          id: `${item.id || item.label}:${cursor}`,
          date: cursor,
          source: 'manual',
        });
      }
      guard += 1;
      if (recurrence === 'unique') break;
      if (stepDays[recurrence]) {
        cursor = addDays(cursor, stepDays[recurrence]);
      } else {
        const date = new Date(`${cursor}T00:00:00.000Z`);
        if (['monthly', 'mensuelle'].includes(recurrence)) date.setUTCMonth(date.getUTCMonth() + 1);
        else if (['quarterly', 'trimestrielle'].includes(recurrence)) date.setUTCMonth(date.getUTCMonth() + 3);
        else if (['yearly', 'annuelle'].includes(recurrence)) date.setUTCFullYear(date.getUTCFullYear() + 1);
        else break;
        cursor = isoDate(date);
      }
    }
  }

  return expanded;
}

module.exports = {
  addDays,
  buildDailyForecast,
  buildWeeklyForecast,
  expandManualItems,
  isoDate,
  money,
  normalizeForecastItem,
  scenarioDate,
};
