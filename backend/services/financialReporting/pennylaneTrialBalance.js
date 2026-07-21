const { PennylaneApiError, createPennylaneClient } = require('../pennylane');
const { getPennylaneConfig } = require('../pennylane/config');

const DEFAULT_PAGE_LIMIT = 100;

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function num(value) {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractLines(body) {
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body.trial_balance)) return body.trial_balance;
  if (Array.isArray(body.lines)) return body.lines;
  if (body.data && typeof body.data === 'object') return extractLines(body.data);
  if (body.trial_balance && typeof body.trial_balance === 'object') return extractLines(body.trial_balance);
  return [];
}

function nextCursor(body) {
  return (
    body?.next_cursor
    || body?.cursor
    || body?.meta?.next_cursor
    || body?.pagination?.next_cursor
    || null
  );
}

function hasMore(body) {
  return Boolean(body?.has_more || body?.meta?.has_more || body?.pagination?.has_more || nextCursor(body));
}

function pick(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return null;
}

function normalizeTrialBalanceLine(row = {}) {
  const account = row.account || row.general_account || row.ledger_account || {};
  const accountNumber = clean(pick(row, ['account_number', 'number', 'account']) || pick(account, ['number', 'account_number']));
  const formattedAccountNumber = clean(
    pick(row, ['formatted_account_number', 'formatted_number'])
    || pick(account, ['formatted_number', 'formatted_account_number'])
    || accountNumber
  );
  const accountLabel = clean(
    pick(row, ['account_label', 'label', 'name'])
    || pick(account, ['label', 'name'])
    || 'Compte sans libelle'
  );
  const totalDebit = num(pick(row, ['total_debit', 'debit', 'debit_amount', 'debits']));
  const totalCredit = num(pick(row, ['total_credit', 'credit', 'credit_amount', 'credits']));
  const explicitNet = pick(row, ['net_balance', 'balance', 'amount']);

  return {
    account_number: accountNumber,
    formatted_account_number: formattedAccountNumber,
    account_label: accountLabel,
    total_debit: totalDebit,
    total_credit: totalCredit,
    net_balance: explicitNet === null ? Number((totalCredit - totalDebit).toFixed(2)) : num(explicitNet),
    raw: row,
  };
}

function trialBalanceEndpoint({ periodStart, periodEnd, isAuxiliary = false, cursor = null, limit = DEFAULT_PAGE_LIMIT }) {
  const params = new URLSearchParams();
  params.set('period_start', periodStart);
  params.set('period_end', periodEnd);
  params.set('is_auxiliary', String(Boolean(isAuxiliary)));
  params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);
  return `/trial_balance?${params.toString()}`;
}

function functionalPennylaneError(err) {
  if (!(err instanceof PennylaneApiError)) return err;

  if (err.status === 401) {
    const error = new Error('Token Pennylane invalide ou expire.');
    error.status = 502;
    error.code = 'PENNYLANE_UNAUTHORIZED';
    return error;
  }

  if (err.status === 403) {
    const error = new Error('Acces refuse par Pennylane : le token doit disposer du scope trial_balance:readonly.');
    error.status = 403;
    error.code = 'PENNYLANE_TRIAL_BALANCE_SCOPE_MISSING';
    return error;
  }

  if (err.status === 429) {
    const error = new Error('Limite Pennylane atteinte. Reessayez la synchronisation dans quelques instants.');
    error.status = 429;
    error.code = 'PENNYLANE_RATE_LIMIT';
    return error;
  }

  return err;
}

async function fetchPennylaneTrialBalance({
  periodStart,
  periodEnd,
  isAuxiliary = false,
  client = createPennylaneClient(getPennylaneConfig()),
  pageLimit = DEFAULT_PAGE_LIMIT,
}) {
  const lines = [];
  let cursor = null;
  let pages = 0;

  try {
    do {
      const response = await client.get(trialBalanceEndpoint({
        periodStart,
        periodEnd,
        isAuxiliary,
        cursor,
        limit: pageLimit,
      }));
      pages += 1;
      const pageLines = extractLines(response.body).map(normalizeTrialBalanceLine).filter((line) => line.account_number);
      lines.push(...pageLines);
      cursor = nextCursor(response.body);
      if (!hasMore(response.body)) cursor = null;
    } while (cursor);
  } catch (err) {
    throw functionalPennylaneError(err);
  }

  return { lines, pages };
}

module.exports = {
  extractLines,
  fetchPennylaneTrialBalance,
  functionalPennylaneError,
  normalizeTrialBalanceLine,
  trialBalanceEndpoint,
};
