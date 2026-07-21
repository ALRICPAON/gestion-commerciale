const { PennylaneApiError, createPennylaneClient, getPennylaneConfig, processPennylaneSupplierInvoiceImportSync } = require('../pennylane');
const { processPennylaneCustomerInvoiceSyncQueue } = require('../pennylane/customerInvoiceSync');
const { classifySupplierPaymentStatus } = require('./supplierPaymentService');
const { detectRecurringTransactions } = require('./recurringChargeService');

const PENNYLANE_CASHFLOW_CAPABILITIES = {
  endpoints_used: [
    'GET /bank_accounts',
    'GET /transactions',
    'GET /supplier_invoices',
    'GET /supplier_invoices/:id',
    'GET /supplier_invoices/:id/payments',
    'GET /customer_invoices',
    'GET /trial_balance',
  ],
  required_scopes: [
    'bank_accounts:readonly',
    'transactions:readonly',
    'supplier_invoices:readonly',
    'customer_invoices:readonly',
    'trial_balance:readonly',
  ],
};

const DIAGNOSTIC_TARGETS = [
  { key: 'bank_accounts', label: 'Comptes bancaires', endpoint: '/bank_accounts?limit=1', scope: 'bank_accounts:readonly' },
  { key: 'transactions', label: 'Transactions bancaires', endpoint: '/transactions?limit=1', scope: 'transactions:readonly' },
  { key: 'supplier_invoices', label: 'Factures fournisseurs', endpoint: '/supplier_invoices?limit=1', scope: 'supplier_invoices:readonly' },
  { key: 'customer_invoices', label: 'Factures clients', endpoint: '/customer_invoices?limit=1', scope: 'customer_invoices:readonly' },
  { key: 'trial_balance', label: 'Balance comptable', endpoint: '/trial_balance?period_start=2026-01-01&period_end=2026-12-31&limit=1', scope: 'trial_balance:readonly' },
];

function firstPresent(object, keys) {
  if (!object || typeof object !== 'object') return null;
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null && object[key] !== '') return object[key];
  }
  return null;
}

function nestedFirstPresent(object, keys) {
  const direct = firstPresent(object, keys);
  if (direct !== null) return direct;
  if (!object || typeof object !== 'object') return null;
  for (const value of Object.values(object)) {
    if (value && typeof value === 'object') {
      const nested = nestedFirstPresent(value, keys);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function extractList(body) {
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body.results)) return body.results;
  if (Array.isArray(body.bank_accounts)) return body.bank_accounts;
  if (Array.isArray(body.transactions)) return body.transactions;
  if (Array.isArray(body.supplier_invoices)) return body.supplier_invoices;
  if (Array.isArray(body.customer_invoices)) return body.customer_invoices;
  if (Array.isArray(body.payments)) return body.payments;
  if (Array.isArray(body.balances)) return body.balances;
  if (body.data && Array.isArray(body.data.items)) return body.data.items;
  if (body.data && Array.isArray(body.data.results)) return body.data.results;
  if (body.data && typeof body.data === 'object') return extractList(body.data);
  return [];
}

function hasMore(body) {
  return Boolean(body?.has_more || body?.meta?.has_more || body?.metadata?.has_more);
}

function nextCursor(body) {
  return body?.next_cursor || body?.meta?.next_cursor || body?.metadata?.next_cursor || body?.pagination?.next_cursor || null;
}

function valueShape(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length ? [`array:${typeof value[0]}`] : [];
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).slice(0, 20).map((key) => [key, valueShape(value[key])]));
  return typeof value;
}

function itemShape(item) {
  if (!item || typeof item !== 'object') return {};
  return Object.fromEntries(Object.entries(item).slice(0, 40).map(([key, value]) => [key, valueShape(value)]));
}

function incrementReason(reasons, reason) {
  reasons[reason] = (reasons[reason] || 0) + 1;
}

function makeStats(resource, endpoint, queryParams = {}) {
  return {
    resource,
    endpoint,
    query_params: queryParams,
    http_status: null,
    pages_count: 0,
    received_count: 0,
    normalized_count: 0,
    inserted_count: 0,
    updated_count: 0,
    ignored_count: 0,
    error_count: 0,
    ignored_reasons: {},
    error_details: [],
    first_item_shape: null,
    error_message: null,
  };
}

async function saveResourceLog(db, storeId, stats) {
  await db.query(
    `
    INSERT INTO cashflow_sync_resource_logs(
      store_id, resource, endpoint, query_params, http_status, pages_count, received_count,
      normalized_count, inserted_count, updated_count, ignored_count, error_count,
      ignored_reasons, first_item_shape, error_message, error_details
    )
    VALUES($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15, $16::jsonb)
    `,
    [
      storeId,
      stats.resource,
      stats.endpoint,
      JSON.stringify(stats.query_params || {}),
      stats.http_status,
      stats.pages_count,
      stats.received_count,
      stats.normalized_count,
      stats.inserted_count,
      stats.updated_count,
      stats.ignored_count,
      stats.error_count,
      JSON.stringify(stats.ignored_reasons || {}),
      JSON.stringify(stats.first_item_shape || {}),
      stats.error_message,
      JSON.stringify((stats.error_details || []).slice(0, 25)),
    ]
  ).catch(() => {});
}

function pushSqlError(stats, resourceId, err, operation, valueTypes = {}) {
  stats.error_details.push({
    resource_id: resourceId ? String(resourceId) : null,
    operation,
    http_status: err.status || null,
    error_code: err.code || (err.status ? `HTTP_${err.status}` : null),
    pg_code: err.code || null,
    pg_constraint: err.constraint || null,
    pg_column: err.column || null,
    message: err.message || 'Erreur SQL',
    value_types: valueTypes,
  });
}

function pushOperationError(stats, resourceId, err, operation, valueTypes = {}) {
  pushSqlError(stats, resourceId, err, operation, valueTypes);
}

function sqlValueTypes(values = {}) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => {
    if (value === null || value === undefined) return [key, String(value)];
    if (Array.isArray(value)) return [key, `array:${value.length}`];
    return [key, typeof value];
  }));
}

async function saveResponseSample(db, storeId, resource, endpoint, firstItem) {
  if (!firstItem) return;
  await db.query(
    `
    INSERT INTO cashflow_pennylane_response_samples(store_id, resource, endpoint, item_shape)
    VALUES($1, $2, $3, $4::jsonb)
    `,
    [storeId, resource, endpoint, JSON.stringify(itemShape(firstItem))]
  ).catch(() => {});
}

function sanitizePennylaneError(error) {
  if (error instanceof PennylaneApiError) {
    return {
      status: error.status,
      code: error.code || (error.status ? `HTTP_${error.status}` : null),
      message: error.status === 403 ? 'Autorisation Pennylane manquante' : error.message,
      responseBody: error.responseBody && typeof error.responseBody === 'object'
        ? { message: firstPresent(error.responseBody, ['message', 'error', 'detail']) }
        : null,
    };
  }
  return { status: null, code: null, message: error.message || 'Erreur Pennylane inattendue' };
}

async function fetchAllPages(client, endpoint, { limit = 100, maxPages = 30, stats = null } = {}) {
  const separator = endpoint.includes('?') ? '&' : '?';
  let cursor = null;
  let pages = 0;
  const items = [];
  do {
    const url = `${endpoint}${separator}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const response = await client.get(url);
    if (stats) stats.http_status = response.status;
    const pageItems = extractList(response.body);
    items.push(...pageItems);
    cursor = hasMore(response.body) ? nextCursor(response.body) : null;
    pages += 1;
    if (stats) {
      stats.pages_count = pages;
      stats.received_count = items.length;
      if (!stats.first_item_shape && pageItems[0]) stats.first_item_shape = itemShape(pageItems[0]);
    }
  } while (cursor && pages < maxPages);
  return { items, pages };
}

function buildJsonFilter(field, operator, value) {
  return encodeURIComponent(JSON.stringify([{ field, operator, value }]));
}

function monthsAgoIso(months) {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() - Number(months || 12));
  return date.toISOString().slice(0, 10);
}

function toMoney(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = typeof value === 'string' ? value.replace(/\s/g, '').replace(',', '.') : value;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : fallback;
}

function toDateOrNull(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function toTextOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

async function runCashflowDiagnostic(db, { storeId, client = createPennylaneClient(getPennylaneConfig()) } = {}) {
  const rows = [];
  let sampleSupplierInvoiceId = null;
  let sampleBankAccountId = null;
  for (const target of DIAGNOSTIC_TARGETS) {
    let diagnostic;
    try {
      const response = await client.get(target.endpoint);
      const items = extractList(response.body);
      if (target.key === 'supplier_invoices' && items[0]) {
        sampleSupplierInvoiceId = firstPresent(items[0], ['id', 'supplier_invoice_id']);
      }
      if (target.key === 'bank_accounts' && items[0]) {
        sampleBankAccountId = firstPresent(items[0], ['id', 'bank_account_id']);
      }
      diagnostic = {
        endpoint: `GET ${target.endpoint.split('?')[0]}`,
        label: target.label,
        http_status: response.status,
        required_scope: target.scope,
        access_status: 'accessible',
        item_count: items.length,
        error_message: null,
        action_required: null,
      };
    } catch (error) {
      const clean = sanitizePennylaneError(error);
      diagnostic = {
        endpoint: `GET ${target.endpoint.split('?')[0]}`,
        label: target.label,
        http_status: clean.status,
        required_scope: target.scope,
        access_status: clean.status === 403 ? 'forbidden' : (clean.status === 401 ? 'unauthorized' : 'error'),
        item_count: 0,
        error_message: clean.message,
        action_required: clean.status === 403 ? `Ajouter le scope ${target.scope} a la cle Pennylane.` : 'Verifier la connexion Pennylane.',
      };
    }
    rows.push(diagnostic);
    await saveDiagnosticRow(db, storeId, diagnostic);
  }
  if (sampleBankAccountId) {
    const endpoint = `/transactions?limit=1&filter=${buildJsonFilter('bank_account_id', 'eq', String(sampleBankAccountId))}`;
    let diagnostic;
    try {
      const response = await client.get(endpoint);
      const items = extractList(response.body);
      diagnostic = {
        endpoint: 'GET /transactions?filter=bank_account_id',
        label: 'Transactions du compte bancaire',
        http_status: response.status,
        required_scope: 'transactions:readonly',
        access_status: 'accessible',
        item_count: items.length,
        error_message: null,
        action_required: items.length ? null : 'Endpoint accessible, aucune transaction recue sur le compte teste.',
      };
    } catch (error) {
      const clean = sanitizePennylaneError(error);
      diagnostic = {
        endpoint: 'GET /transactions?filter=bank_account_id',
        label: 'Transactions du compte bancaire',
        http_status: clean.status,
        required_scope: 'transactions:readonly',
        access_status: clean.status === 403 ? 'forbidden' : (clean.status === 401 ? 'unauthorized' : 'error'),
        item_count: 0,
        error_message: clean.message,
        action_required: clean.status === 400 ? 'Filtre bank_account_id refuse par Pennylane : verifier la syntaxe exacte.' : (clean.status === 403 ? 'Ajouter le scope transactions:readonly a la cle Pennylane.' : 'Verifier les transactions Pennylane.'),
      };
    }
    rows.push(diagnostic);
    await saveDiagnosticRow(db, storeId, diagnostic);
  }
  if (sampleSupplierInvoiceId) {
    for (const target of [
      {
        label: 'Detail facture fournisseur',
        endpoint: `/supplier_invoices/${encodeURIComponent(sampleSupplierInvoiceId)}`,
        scope: 'supplier_invoices:readonly',
      },
      {
        label: 'Paiements fournisseurs',
        endpoint: `/supplier_invoices/${encodeURIComponent(sampleSupplierInvoiceId)}/payments?limit=1`,
        scope: 'supplier_invoices:readonly',
      },
    ]) {
      let diagnostic;
      try {
        const response = await client.get(target.endpoint);
        diagnostic = {
          endpoint: `GET ${target.endpoint.split('?')[0].replace(String(sampleSupplierInvoiceId), '{id}')}`,
          label: target.label,
          http_status: response.status,
          required_scope: target.scope,
          access_status: 'accessible',
          item_count: extractList(response.body).length || (response.body ? 1 : 0),
          error_message: null,
          action_required: null,
        };
      } catch (error) {
        const clean = sanitizePennylaneError(error);
        diagnostic = {
          endpoint: `GET ${target.endpoint.split('?')[0].replace(String(sampleSupplierInvoiceId), '{id}')}`,
          label: target.label,
          http_status: clean.status,
          required_scope: target.scope,
          access_status: clean.status === 403 ? 'forbidden' : (clean.status === 401 ? 'unauthorized' : 'error'),
          item_count: 0,
          error_message: clean.message,
          action_required: clean.status === 403 ? `Ajouter le scope ${target.scope} a la cle Pennylane.` : 'Verifier la connexion Pennylane.',
        };
      }
      rows.push(diagnostic);
      await saveDiagnosticRow(db, storeId, diagnostic);
    }
  } else {
    for (const endpoint of ['GET /supplier_invoices/{id}', 'GET /supplier_invoices/{id}/payments']) {
      const diagnostic = {
        endpoint,
        label: endpoint.includes('payments') ? 'Paiements fournisseurs' : 'Detail facture fournisseur',
        http_status: null,
        required_scope: 'supplier_invoices:readonly',
        access_status: 'error',
        item_count: 0,
        error_message: 'Aucune facture fournisseur disponible pour tester le detail.',
        action_required: 'Synchroniser ou creer une facture fournisseur Pennylane pour tester cet acces.',
      };
      rows.push(diagnostic);
      await saveDiagnosticRow(db, storeId, diagnostic);
    }
  }
  return rows;
}

async function saveDiagnosticRow(db, storeId, diagnostic) {
  await db.query(
    `
    INSERT INTO cashflow_scope_diagnostics(
      store_id, endpoint, http_status, required_scope, access_status, item_count, error_message, action_required
    )
    VALUES($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [storeId, diagnostic.endpoint, diagnostic.http_status, diagnostic.required_scope, diagnostic.access_status, diagnostic.item_count, diagnostic.error_message, diagnostic.action_required]
  ).catch(() => {});
}

function normalizeBankAccount(account = {}) {
  const id = firstPresent(account, ['id', 'bank_account_id']);
  const establishment = firstPresent(account, ['bank_establishment']) || {};
  const journal = firstPresent(account, ['journal']) || {};
  const ledger = firstPresent(account, ['ledger_account', 'accounting_account']) || {};
  return {
    id: toTextOrNull(id),
    name: firstPresent(account, ['name', 'label']) || 'Compte bancaire',
    currency: firstPresent(account, ['currency']) || 'EUR',
    balance: toMoney(firstPresent(account, ['balance', 'current_balance', 'amount']), 0),
    updated_at: firstPresent(account, ['updated_at', 'balance_updated_at']),
    bank_establishment_name: firstPresent(establishment, ['name', 'label']),
    bank_establishment_id: firstPresent(establishment, ['id']),
    journal_id: firstPresent(journal, ['id']),
    journal_label: firstPresent(journal, ['label', 'name']),
    ledger_account_id: firstPresent(ledger, ['id']),
    ledger_account_number: firstPresent(ledger, ['number']),
    raw: account,
  };
}

async function syncBankAccounts(db, { storeId, client }) {
  const stats = makeStats('bank_accounts', 'GET /bank_accounts');
  try {
    const { items, pages } = await fetchAllPages(client, '/bank_accounts', { limit: 100, stats });
    await saveResponseSample(db, storeId, 'bank_account', '/bank_accounts', items[0]);
    stats.pages_count = pages;
    for (const raw of items) {
      const account = normalizeBankAccount(raw);
      if (!account.id || account.id === 'undefined') {
        stats.ignored_count += 1;
        incrementReason(stats.ignored_reasons, 'missing_id');
        continue;
      }
      stats.normalized_count += 1;
      const result = await db.query(
        `
      INSERT INTO cashflow_bank_accounts(
        store_id, pennylane_bank_account_id, name, currency, balance, pennylane_updated_at,
        bank_establishment_name, bank_establishment_id, journal_id, journal_label,
        ledger_account_id, ledger_account_number, raw_payload, last_synced_at
      )
      VALUES($1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9, $10, $11, $12, $13::jsonb, now())
      ON CONFLICT (store_id, pennylane_bank_account_id) DO UPDATE
      SET name = EXCLUDED.name,
        currency = EXCLUDED.currency,
        balance = EXCLUDED.balance,
        pennylane_updated_at = EXCLUDED.pennylane_updated_at,
        bank_establishment_name = EXCLUDED.bank_establishment_name,
        bank_establishment_id = EXCLUDED.bank_establishment_id,
        journal_id = EXCLUDED.journal_id,
        journal_label = EXCLUDED.journal_label,
        ledger_account_id = EXCLUDED.ledger_account_id,
        ledger_account_number = EXCLUDED.ledger_account_number,
        raw_payload = EXCLUDED.raw_payload,
        last_synced_at = now(),
        updated_at = now()
      RETURNING (xmax = 0) AS inserted
      `,
        [storeId, account.id, account.name, account.currency, account.balance, account.updated_at || null, account.bank_establishment_name, account.bank_establishment_id ? String(account.bank_establishment_id) : null, account.journal_id ? String(account.journal_id) : null, account.journal_label, account.ledger_account_id ? String(account.ledger_account_id) : null, account.ledger_account_number, JSON.stringify(account.raw)]
      );
      if (result.rows[0]?.inserted) stats.inserted_count += 1;
      else stats.updated_count += 1;
    }
    await refreshBankSnapshot(db, storeId);
    await saveResourceLog(db, storeId, stats);
    return { read: stats.received_count, upserted: stats.inserted_count + stats.updated_count, pages, stats };
  } catch (err) {
    stats.error_count += 1;
    stats.error_message = sanitizePennylaneError(err).message;
    await saveResourceLog(db, storeId, stats);
    throw err;
  }
}

async function refreshBankSnapshot(db, storeId) {
  const result = await db.query(
    `
    SELECT *
    FROM cashflow_bank_accounts
    WHERE store_id = $1
      AND include_in_cashflow = true
    `,
    [storeId]
  );
  const balance = result.rows.reduce((sum, row) => sum + Number(row.balance || 0), 0);
  await db.query(
    `
    INSERT INTO cashflow_bank_snapshots(
      store_id, balance, balance_source, snapshot_at, included_bank_account_ids, account_count
    )
    VALUES($1, $2, 'pennylane', now(), $3::text[], $4)
    `,
    [storeId, balance, result.rows.map((row) => row.pennylane_bank_account_id), result.rows.length]
  );
}

function normalizeTransaction(tx = {}) {
  const id = nestedFirstPresent(tx, ['id', 'transaction_id']);
  const amount = toMoney(nestedFirstPresent(tx, ['amount', 'currency_amount', 'value']), 0);
  const bankAccount = firstPresent(tx, ['bank_account']) || {};
  const supplier = firstPresent(tx, ['supplier']) || {};
  const customer = firstPresent(tx, ['customer']) || {};
  const matchedInvoices = firstPresent(tx, ['matched_invoices', 'invoices']) || [];
  const categories = firstPresent(tx, ['categories']) || [];
  const status = firstPresent(tx, ['reconciliation_status', 'status', 'state']);
  const rawDate = nestedFirstPresent(tx, ['date', 'transaction_date', 'emitted_at', 'booked_at', 'created_at']);
  return {
    id: id ? String(id) : null,
    bank_account_id: toTextOrNull(firstPresent(tx, ['bank_account_id']) || firstPresent(bankAccount, ['id'])),
    date: toDateOrNull(rawDate),
    label: firstPresent(tx, ['label', 'description', 'name']) || 'Mouvement bancaire',
    amount: Math.abs(amount),
    direction: amount < 0 || String(firstPresent(tx, ['direction', 'type']) || '').toLowerCase().includes('debit') ? 'out' : 'in',
    currency: firstPresent(tx, ['currency']) || 'EUR',
    supplier_id: toTextOrNull(firstPresent(tx, ['supplier_id']) || firstPresent(supplier, ['id'])),
    customer_id: toTextOrNull(firstPresent(tx, ['customer_id']) || firstPresent(customer, ['id'])),
    categories,
    matched_invoices: Array.isArray(matchedInvoices) ? matchedInvoices : [],
    reconciliation_status: status || (Array.isArray(matchedInvoices) && matchedInvoices.length ? 'matched' : null),
    unmatched_amount: toMoney(firstPresent(tx, ['outstanding_balance', 'unmatched_amount']), 0),
    created_at: firstPresent(tx, ['created_at']),
    updated_at: firstPresent(tx, ['updated_at']),
    raw: tx,
  };
}

function normalizeSupplierId(invoice) {
  const supplier = firstPresent(invoice, ['supplier', 'provider', 'vendor']) || {};
  return firstPresent(invoice, ['supplier_id', 'pennylane_supplier_id', 'thirdparty_id'])
    || firstPresent(supplier, ['id', 'supplier_id']);
}

function normalizeSupplierName(invoice) {
  const supplier = firstPresent(invoice, ['supplier', 'provider', 'vendor']) || {};
  return firstPresent(invoice, ['supplier_name', 'vendor_name', 'counterparty_name'])
    || firstPresent(supplier, ['name', 'label'])
    || 'Fournisseur a completer';
}

function normalizeSupplierInvoice(invoice = {}) {
  const id = firstPresent(invoice, ['id', 'supplier_invoice_id']);
  const rawRemainingWithTax = firstPresent(invoice, ['remaining_amount_with_tax']);
  const rawRemainingWithoutTax = firstPresent(invoice, ['remaining_amount_without_tax']);
  const total = toMoney(firstPresent(invoice, [
    'amount',
    'amount_inc_vat',
    'amount_with_tax',
    'currency_amount',
    'total_amount',
  ]), 0);
  const remaining = toMoney(rawRemainingWithTax, null);
  const fallbackRemaining = toMoney(firstPresent(invoice, [
    'remaining_amount',
    'amount_due',
    'due_amount',
  ]), null);
  const paid = toMoney(firstPresent(invoice, [
    'paid_amount_with_tax',
    'paid_amount',
    'amount_paid',
  ]), null);
  return {
    id: id ? String(id) : null,
    supplier_id: normalizeSupplierId(invoice) ? String(normalizeSupplierId(invoice)) : null,
    supplier_name: normalizeSupplierName(invoice),
    invoice_number: firstPresent(invoice, ['invoice_number', 'number', 'reference']) || 'A completer',
    invoice_date: toDateOrNull(firstPresent(invoice, ['date', 'invoice_date', 'created_at'])),
    due_date: toDateOrNull(firstPresent(invoice, ['deadline', 'due_date'])),
    currency: firstPresent(invoice, ['currency']) || 'EUR',
    amount_ex_vat: toMoney(firstPresent(invoice, ['amount_before_tax', 'amount_ex_vat', 'amount_without_tax']), null),
    amount_vat: toMoney(firstPresent(invoice, ['tax', 'amount_vat', 'vat_amount']), null),
    amount_inc_vat: total,
    remaining_amount_with_tax: remaining === null ? (fallbackRemaining === null ? Math.max(total - (paid || 0), 0) : fallbackRemaining) : remaining,
    official_remaining_amount_with_tax: remaining,
    official_remaining_amount_with_tax_raw: rawRemainingWithTax ?? null,
    official_remaining_amount_without_tax_raw: rawRemainingWithoutTax ?? null,
    has_official_remaining_amount_with_tax: remaining !== null,
    paid_amount: paid,
    accounting_status: firstPresent(invoice, ['accounting_status', 'status']),
    payment_status: firstPresent(invoice, ['payment_status', 'paid_status', 'payment_state']),
    paid: firstPresent(invoice, ['paid']) === true || ['paid', 'paid_out', 'confirmed', 'completed', 'settled', 'fully_paid'].includes(String(firstPresent(invoice, ['payment_status', 'paid_status', 'payment_state']) || '').toLowerCase()),
    reconciled: firstPresent(invoice, ['reconciled']) === true,
    updated_at: firstPresent(invoice, ['updated_at']),
    raw: invoice,
  };
}

function classifySupplierInvoiceCashflow(invoice, payments = [], matchedTransactions = []) {
  const total = toMoney(invoice.amount_inc_vat, 0);
  const officialRemaining = toMoney(invoice.remaining_amount_with_tax, null);
  const hasOfficialRemaining = invoice.has_official_remaining_amount_with_tax === true
    || (invoice.official_remaining_amount_with_tax_raw !== undefined && invoice.official_remaining_amount_with_tax_raw !== null)
    || (invoice.raw && Object.prototype.hasOwnProperty.call(invoice.raw, 'remaining_amount_with_tax'));
  const confirmedPayments = payments
    .filter((payment) => classifySupplierPaymentStatus(payment.status).is_confirmed)
    .reduce((sum, payment) => sum + toMoney(payment.amount, 0), 0);
  const matchedTotal = matchedTransactions.reduce((sum, tx) => sum + toMoney(tx.amount, 0), 0);
  const paymentStatus = String(invoice.payment_status || '').toLowerCase();
  const paidStatuses = ['paid', 'paid_out', 'confirmed', 'completed', 'settled', 'fully_paid'];
  const cancelledStatuses = ['cancelled', 'canceled', 'void', 'archived'];
  const explicitPaid = invoice.paid === true || paidStatuses.includes(paymentStatus);
  const cancelled = cancelledStatuses.includes(paymentStatus) || cancelledStatuses.includes(String(invoice.accounting_status || '').toLowerCase());

  if (hasOfficialRemaining && officialRemaining !== null && officialRemaining > 0 && explicitPaid) {
    return { state: 'needs_review', remaining: officialRemaining, paidAmount: confirmedPayments, reason: 'contradictory_paid_with_official_remaining' };
  }
  if (hasOfficialRemaining && officialRemaining !== null && officialRemaining > 0 && cancelled) {
    return { state: 'needs_review', remaining: officialRemaining, paidAmount: confirmedPayments, reason: 'cancelled_or_archived_with_official_remaining' };
  }
  if (hasOfficialRemaining && officialRemaining !== null && officialRemaining > 0) {
    return { state: 'open', remaining: officialRemaining, paidAmount: Math.max(total - officialRemaining, confirmedPayments), reason: 'official_remaining_positive' };
  }
  if (hasOfficialRemaining && officialRemaining === 0 && explicitPaid) {
    return { state: 'paid', remaining: 0, paidAmount: Math.max(confirmedPayments, total), reason: 'official_remaining_zero_paid_confirmed' };
  }
  if (hasOfficialRemaining && officialRemaining === 0 && invoice.reconciled === true) {
    return { state: 'paid', remaining: 0, paidAmount: Math.max(confirmedPayments, total), reason: 'official_remaining_zero_reconciled' };
  }
  if (hasOfficialRemaining && officialRemaining === 0) {
    return { state: 'needs_review', remaining: 0, paidAmount: confirmedPayments, reason: 'official_remaining_zero_without_paid_proof' };
  }
  if (explicitPaid) {
    return { state: 'paid', remaining: 0, paidAmount: Math.max(confirmedPayments, total), reason: 'official_paid_status' };
  }
  if (total > 0 && confirmedPayments > 0 && confirmedPayments < total) {
    return { state: 'open', remaining: Math.max(total - confirmedPayments, 0), paidAmount: confirmedPayments, reason: 'partial_confirmed_payment' };
  }
  if (total > 0 && confirmedPayments >= total) {
    return { state: 'paid', remaining: 0, paidAmount: confirmedPayments, reason: 'payments_cover_total' };
  }
  if (total > 0 && matchedTotal > 0 && matchedTotal < total) {
    return { state: 'open', remaining: Math.max(total - matchedTotal, 0), paidAmount: matchedTotal, reason: 'partial_matched_transactions' };
  }
  if (total > 0 && matchedTotal >= total) {
    return { state: 'paid', remaining: 0, paidAmount: matchedTotal, reason: 'matched_transactions_cover_total' };
  }
  if (total > 0) {
    return { state: 'needs_review', remaining: total, paidAmount: confirmedPayments, reason: 'missing_remaining_no_paid_proof' };
  }
  return { state: 'needs_review', remaining: 0, paidAmount: confirmedPayments, reason: 'missing_total_amount' };
}

async function findAltaSupplierId(db, storeId, pennylaneSupplierId, supplierName) {
  if (pennylaneSupplierId) {
    const byId = await db.query(
      'SELECT id FROM suppliers WHERE store_id = $1 AND pennylane_supplier_id::text = $2::text LIMIT 1',
      [storeId, String(pennylaneSupplierId)]
    ).catch(() => ({ rows: [] }));
    if (byId.rows[0]) return byId.rows[0].id;
  }
  if (supplierName) {
    const byName = await db.query(
      'SELECT id FROM suppliers WHERE store_id = $1 AND UPPER(name) = UPPER($2) LIMIT 1',
      [storeId, supplierName]
    ).catch(() => ({ rows: [] }));
    if (byName.rows[0]) return byName.rows[0].id;
  }
  return null;
}

async function syncSupplierInvoicesDirect(db, { storeId, client }) {
  const stats = makeStats('supplier_invoices', 'GET /supplier_invoices', { direct_list: true });
  try {
    const { items, pages } = await fetchAllPages(client, '/supplier_invoices?sort=-id', { limit: 100, maxPages: 80, stats });
    await saveResponseSample(db, storeId, 'supplier_invoice', '/supplier_invoices', items[0]);
    stats.pages_count = pages;
    for (const raw of items) {
      const invoice = normalizeSupplierInvoice(raw);
      if (!invoice.id) {
        stats.ignored_count += 1;
        incrementReason(stats.ignored_reasons, 'missing_id');
        continue;
      }
      stats.normalized_count += 1;
      try {
        const altaSupplierId = await findAltaSupplierId(db, storeId, invoice.supplier_id, invoice.supplier_name);
        const cashflowState = classifySupplierInvoiceCashflow(invoice);
        const result = await db.query(
          `
          INSERT INTO pennylane_supplier_invoices(
            id, store_id, pennylane_supplier_invoice_id, pennylane_supplier_id, supplier_id,
            invoice_number, invoice_date, due_date, currency, amount_ex_vat, amount_vat, amount_inc_vat,
            remaining_amount_with_tax, accounting_status, payment_status, paid,
            alta_business_status, sync_status, raw_payload, last_synced_at, cashflow_last_direct_sync_at,
            cashflow_normalization_status, cashflow_open_state, cashflow_remaining_amount,
            cashflow_paid_amount, cashflow_state_reason, cashflow_supplier_name
          )
          VALUES(gen_random_uuid(), $1, $2, $3, $4, $5, $6::date, $7::date, $8, $9, $10, $11, $12, $13, $14, $15, 'a_rapprocher', 'synced', $16::jsonb, now(), now(), 'ok', $17, $18, $19, $20, $21)
          ON CONFLICT (store_id, pennylane_supplier_invoice_id) DO UPDATE
          SET pennylane_supplier_id = EXCLUDED.pennylane_supplier_id,
            supplier_id = COALESCE(EXCLUDED.supplier_id, pennylane_supplier_invoices.supplier_id),
            invoice_number = EXCLUDED.invoice_number,
            invoice_date = EXCLUDED.invoice_date,
            due_date = EXCLUDED.due_date,
            currency = EXCLUDED.currency,
            amount_ex_vat = EXCLUDED.amount_ex_vat,
            amount_vat = EXCLUDED.amount_vat,
            amount_inc_vat = EXCLUDED.amount_inc_vat,
            remaining_amount_with_tax = EXCLUDED.remaining_amount_with_tax,
            accounting_status = EXCLUDED.accounting_status,
            payment_status = EXCLUDED.payment_status,
            paid = EXCLUDED.paid,
            raw_payload = EXCLUDED.raw_payload,
            sync_status = 'synced',
            last_synced_at = now(),
            cashflow_last_direct_sync_at = now(),
            cashflow_normalization_status = 'ok',
            cashflow_open_state = EXCLUDED.cashflow_open_state,
            cashflow_remaining_amount = EXCLUDED.cashflow_remaining_amount,
            cashflow_paid_amount = EXCLUDED.cashflow_paid_amount,
            cashflow_state_reason = EXCLUDED.cashflow_state_reason,
            cashflow_supplier_name = EXCLUDED.cashflow_supplier_name,
            updated_at = now()
          RETURNING (xmax = 0) AS inserted
          `,
          [
            storeId,
            invoice.id,
            invoice.supplier_id,
            altaSupplierId,
            invoice.invoice_number,
            invoice.invoice_date ? String(invoice.invoice_date).slice(0, 10) : null,
            invoice.due_date ? String(invoice.due_date).slice(0, 10) : null,
            invoice.currency,
            invoice.amount_ex_vat,
            invoice.amount_vat,
            invoice.amount_inc_vat,
            invoice.remaining_amount_with_tax,
            invoice.accounting_status,
            invoice.payment_status,
            invoice.paid,
            JSON.stringify(invoice.raw),
            cashflowState.state,
            cashflowState.remaining,
            cashflowState.paidAmount,
            cashflowState.reason,
            invoice.supplier_name,
          ]
        );
        if (result.rows[0]?.inserted) stats.inserted_count += 1;
        else stats.updated_count += 1;
      } catch (err) {
        stats.error_count += 1;
        incrementReason(stats.ignored_reasons, 'database_constraint');
        pushSqlError(stats, invoice.id, err, 'upsert_pennylane_supplier_invoices', sqlValueTypes({
          supplier_id: invoice.supplier_id,
          invoice_date: invoice.invoice_date,
          due_date: invoice.due_date,
          amount_inc_vat: invoice.amount_inc_vat,
          remaining_amount_with_tax: invoice.remaining_amount_with_tax,
          paid: invoice.paid,
        }));
      }
    }
    await saveResourceLog(db, storeId, stats);
    return { read: stats.received_count, upserted: stats.inserted_count + stats.updated_count, pages, stats };
  } catch (err) {
    stats.error_count += 1;
    stats.error_message = sanitizePennylaneError(err).message;
    await saveResourceLog(db, storeId, stats);
    throw err;
  }
}

async function syncTransactions(db, { storeId, client }) {
  const historyMonths = await db.query(
    'SELECT initial_bank_history_months FROM cashflow_settings WHERE store_id = $1 LIMIT 1',
    [storeId]
  ).then((r) => r.rows[0]?.initial_bank_history_months || 12).catch(() => 12);
  const since = monthsAgoIso(historyMonths);
  const endpoint = `/transactions?filter=${buildJsonFilter('date', 'gteq', since)}&sort=-id`;
  const stats = makeStats('transactions', 'GET /transactions', { date_gteq: since, filtered: true });
  try {
    const { items, pages } = await fetchAllPages(client, endpoint, { limit: 100, maxPages: 80, stats });
    await saveResponseSample(db, storeId, 'transaction', '/transactions', items[0]);
    stats.pages_count = pages;
    for (const raw of items) {
      const tx = normalizeTransaction(raw);
      if (!tx.id || tx.id === 'undefined') {
        stats.ignored_count += 1;
        incrementReason(stats.ignored_reasons, 'missing_id');
        continue;
      }
      stats.normalized_count += 1;
      try {
        const result = await db.query(
          `
      INSERT INTO cashflow_bank_transactions(
        store_id, pennylane_transaction_id, bank_account_pennylane_id, transaction_date, label,
        direction, amount, currency, supplier_id, customer_id, categories, matched_invoices,
        reconciliation_status, reconciled, unmatched_amount, pennylane_created_at, pennylane_updated_at, raw_payload
      )
      VALUES($1, $2, $3, $4::date, $5, $6, $7::numeric, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15::numeric, $16::timestamptz, $17::timestamptz, $18::jsonb)
      ON CONFLICT ON CONSTRAINT cashflow_bank_transactions_store_pennylane_uidx DO UPDATE
      SET bank_account_pennylane_id = EXCLUDED.bank_account_pennylane_id,
        transaction_date = EXCLUDED.transaction_date,
        label = EXCLUDED.label,
        direction = EXCLUDED.direction,
        amount = EXCLUDED.amount,
        currency = EXCLUDED.currency,
        supplier_id = EXCLUDED.supplier_id,
        customer_id = EXCLUDED.customer_id,
        categories = EXCLUDED.categories,
        matched_invoices = EXCLUDED.matched_invoices,
        reconciliation_status = EXCLUDED.reconciliation_status,
        reconciled = EXCLUDED.reconciled,
        unmatched_amount = EXCLUDED.unmatched_amount,
        pennylane_created_at = EXCLUDED.pennylane_created_at,
        pennylane_updated_at = EXCLUDED.pennylane_updated_at,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
      RETURNING (xmax = 0) AS inserted
      `,
          [storeId, tx.id, tx.bank_account_id ? String(tx.bank_account_id) : null, tx.date, tx.label, tx.direction, tx.amount, tx.currency, tx.supplier_id ? String(tx.supplier_id) : null, tx.customer_id ? String(tx.customer_id) : null, JSON.stringify(tx.categories), JSON.stringify(tx.matched_invoices), tx.reconciliation_status, ['matched', 'reconciled'].includes(String(tx.reconciliation_status || '').toLowerCase()), tx.unmatched_amount, tx.created_at || null, tx.updated_at || null, JSON.stringify(tx.raw)]
        );
        if (result.rows[0]?.inserted) stats.inserted_count += 1;
        else if (result.rowCount > 0) stats.updated_count += 1;
        await upsertTransactionInvoiceLinks(db, storeId, tx);
      } catch (err) {
        stats.error_count += 1;
        incrementReason(stats.ignored_reasons, 'database_constraint');
        pushSqlError(stats, tx.id, err, 'upsert_cashflow_bank_transactions', {
          transaction_date: tx.date === null ? 'null' : typeof tx.date,
          amount: typeof tx.amount,
          unmatched_amount: typeof tx.unmatched_amount,
          bank_account_id: tx.bank_account_id === null ? 'null' : typeof tx.bank_account_id,
          supplier_id: tx.supplier_id === null ? 'null' : typeof tx.supplier_id,
          customer_id: tx.customer_id === null ? 'null' : typeof tx.customer_id,
        });
      }
    }
    await refreshRecurringSuggestions(db, storeId);
    await saveResourceLog(db, storeId, stats);
    return { read: stats.received_count, upserted: stats.inserted_count + stats.updated_count, pages, stats };
  } catch (err) {
    stats.error_count += 1;
    stats.error_message = sanitizePennylaneError(err).message;
    await saveResourceLog(db, storeId, stats);
    throw err;
  }
}

async function upsertTransactionInvoiceLinks(db, storeId, tx) {
  for (const invoice of tx.matched_invoices || []) {
    const invoiceId = firstPresent(invoice, ['id', 'invoice_id', 'supplier_invoice_id', 'customer_invoice_id']);
    if (!invoiceId) continue;
    const invoiceType = String(firstPresent(invoice, ['type', 'invoice_type']) || '').includes('customer') ? 'customer_invoice' : 'supplier_invoice';
    await db.query(
      `
      INSERT INTO cashflow_invoice_transaction_links(store_id, invoice_type, pennylane_invoice_id, pennylane_transaction_id, amount, raw_payload)
      VALUES($1, $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT (store_id, invoice_type, pennylane_invoice_id, pennylane_transaction_id) DO UPDATE
      SET amount = EXCLUDED.amount, raw_payload = EXCLUDED.raw_payload, updated_at = now()
      `,
      [storeId, invoiceType, String(invoiceId), tx.id, Number(firstPresent(invoice, ['amount', 'matched_amount']) || tx.amount || 0), JSON.stringify(invoice)]
    );
  }
}

async function syncSupplierInvoicePayments(db, { storeId, client }) {
  const stats = makeStats('supplier_payments', 'GET /supplier_invoices/{id}/payments');
  const invoices = await db.query(
    `
    SELECT pennylane_supplier_invoice_id
    FROM pennylane_supplier_invoices
    WHERE store_id = $1
      AND pennylane_deleted_at IS NULL
      AND pennylane_supplier_invoice_id IS NOT NULL
    ORDER BY invoice_date DESC NULLS LAST
    LIMIT 500
    `,
    [storeId]
  );
  let read = 0;
  let upserted = 0;
  let failed = 0;
  let secondaryErrors = 0;
  let firstPayment = null;
  for (const invoice of invoices.rows) {
    const invoiceId = String(invoice.pennylane_supplier_invoice_id);
    let items = [];
    try {
      const fetched = await fetchAllPages(client, `/supplier_invoices/${encodeURIComponent(invoiceId)}/payments`, { limit: 100, maxPages: 10 });
      items = fetched.items;
      read += items.length;
      stats.pages_count += 1;
      stats.received_count += items.length;
      if (!firstPayment && items[0]) firstPayment = items[0];
    } catch (err) {
      failed += 1;
      stats.error_count += 1;
      pushOperationError(stats, invoiceId, err, 'fetch_supplier_invoice_payments', { invoice_id: typeof invoiceId });
      if (err instanceof PennylaneApiError && err.status === 403) throw err;
      continue;
    }

    for (const payment of items) {
      const paymentId = firstPresent(payment, ['id', 'payment_id']);
      try {
        if (!paymentId) {
          stats.ignored_count += 1;
          incrementReason(stats.ignored_reasons, 'missing_id');
          continue;
        }
        stats.normalized_count += 1;
        const classification = classifySupplierPaymentStatus(firstPresent(payment, ['status', 'state']));
        const result = await db.query(
          `
          INSERT INTO cashflow_supplier_invoice_payments(
            store_id, pennylane_supplier_invoice_id, pennylane_payment_id, label, amount, currency,
            status, is_confirmed, is_pending, pennylane_created_at, pennylane_updated_at, raw_payload
          )
          VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12::jsonb)
          ON CONFLICT (store_id, pennylane_supplier_invoice_id, pennylane_payment_id) DO UPDATE
          SET label = EXCLUDED.label,
            amount = EXCLUDED.amount,
            currency = EXCLUDED.currency,
            status = EXCLUDED.status,
            is_confirmed = EXCLUDED.is_confirmed,
            is_pending = EXCLUDED.is_pending,
            pennylane_created_at = EXCLUDED.pennylane_created_at,
            pennylane_updated_at = EXCLUDED.pennylane_updated_at,
            raw_payload = EXCLUDED.raw_payload,
            updated_at = now()
          RETURNING (xmax = 0) AS inserted
          `,
          [storeId, invoiceId, String(paymentId), firstPresent(payment, ['label', 'description']), toMoney(firstPresent(payment, ['amount', 'currency_amount']), 0), firstPresent(payment, ['currency']) || 'EUR', classification.status, classification.is_confirmed, classification.is_pending, firstPresent(payment, ['created_at']) || null, firstPresent(payment, ['updated_at']) || null, JSON.stringify(payment)]
        );
        if (result.rows[0]?.inserted) stats.inserted_count += 1;
        else stats.updated_count += 1;
        upserted += 1;
      } catch (err) {
        failed += 1;
        stats.error_count += 1;
        pushOperationError(stats, invoiceId, err, 'upsert_supplier_invoice_payment', {
          payment_id: paymentId === null ? 'null' : typeof paymentId,
          amount: typeof firstPresent(payment, ['amount', 'currency_amount']),
        });
      }
    }

    try {
      await syncSupplierInvoiceMatchedTransactions(db, { storeId, client, invoiceId });
    } catch (err) {
      secondaryErrors += 1;
      stats.error_count += 1;
      pushOperationError(stats, invoiceId, err, 'sync_supplier_invoice_matched_transactions', { invoice_id: typeof invoiceId });
    }
    try {
      await refreshSupplierInvoiceCashflowState(db, storeId, invoiceId);
    } catch (err) {
      secondaryErrors += 1;
      stats.error_count += 1;
      pushOperationError(stats, invoiceId, err, 'refresh_supplier_invoice_cashflow_state', { invoice_id: typeof invoiceId });
    }
  }
  await saveResponseSample(db, storeId, 'supplier_payment', '/supplier_invoices/{id}/payments', firstPayment);
  await saveResourceLog(db, storeId, stats);
  return { invoices: invoices.rows.length, read, upserted, failed, secondary_errors: secondaryErrors, stats };
}

async function refreshSupplierInvoiceCashflowState(db, storeId, invoiceId) {
  const invoiceResult = await db.query(
    `
    SELECT *
    FROM pennylane_supplier_invoices
    WHERE store_id = $1 AND pennylane_supplier_invoice_id = $2
    LIMIT 1
    `,
    [storeId, String(invoiceId)]
  ).catch(() => ({ rows: [] }));
  const invoice = invoiceResult.rows[0];
  if (!invoice) return null;
  const payments = await db.query(
    `
    SELECT amount, status
    FROM cashflow_supplier_invoice_payments
    WHERE store_id = $1 AND pennylane_supplier_invoice_id = $2
    `,
    [storeId, String(invoiceId)]
  ).then((r) => r.rows).catch(() => []);
  const matchedTransactions = await db.query(
    `
    SELECT amount
    FROM cashflow_invoice_transaction_links
    WHERE store_id = $1 AND invoice_type = 'supplier_invoice' AND pennylane_invoice_id = $2
    `,
    [storeId, String(invoiceId)]
  ).then((r) => r.rows).catch(() => []);
  const rawPayload = invoice.raw_payload && typeof invoice.raw_payload === 'object' ? invoice.raw_payload : {};
  const rawRemainingWithTax = Object.prototype.hasOwnProperty.call(rawPayload, 'remaining_amount_with_tax')
    ? rawPayload.remaining_amount_with_tax
    : undefined;
  const hasOfficialRemaining = rawRemainingWithTax !== undefined;
  const state = classifySupplierInvoiceCashflow({
    amount_inc_vat: invoice.amount_inc_vat,
    remaining_amount_with_tax: hasOfficialRemaining
      ? invoice.remaining_amount_with_tax
      : null,
    official_remaining_amount_with_tax_raw: rawRemainingWithTax,
    has_official_remaining_amount_with_tax: hasOfficialRemaining,
    payment_status: invoice.payment_status,
    paid: invoice.paid,
    reconciled: rawPayload.reconciled === true,
    accounting_status: invoice.accounting_status,
  }, payments, matchedTransactions);
  await db.query(
    `
    UPDATE pennylane_supplier_invoices
    SET cashflow_open_state = $3,
      cashflow_remaining_amount = $4,
      cashflow_paid_amount = $5,
      cashflow_state_reason = $6,
      updated_at = now()
    WHERE store_id = $1 AND pennylane_supplier_invoice_id = $2
    `,
    [storeId, String(invoiceId), state.state, state.remaining, state.paidAmount, state.reason]
  ).catch(() => {});
  return state;
}

async function syncSupplierInvoiceMatchedTransactions(db, { storeId, client, invoiceId }) {
  try {
    const { items } = await fetchAllPages(client, `/supplier_invoices/${encodeURIComponent(invoiceId)}/matched_transactions`, { limit: 100, maxPages: 5 });
    for (const raw of items) {
      const tx = normalizeTransaction(raw);
      if (!tx.id || tx.id === 'undefined') continue;
      await db.query(
        `
        INSERT INTO cashflow_invoice_transaction_links(store_id, invoice_type, pennylane_invoice_id, pennylane_transaction_id, amount, source, raw_payload)
        VALUES($1, 'supplier_invoice', $2, $3, $4, 'supplier_invoice_matched_transactions', $5::jsonb)
        ON CONFLICT (store_id, invoice_type, pennylane_invoice_id, pennylane_transaction_id) DO UPDATE
        SET amount = EXCLUDED.amount, source = EXCLUDED.source, raw_payload = EXCLUDED.raw_payload, updated_at = now()
        `,
        [storeId, String(invoiceId), tx.id, tx.amount, JSON.stringify(raw)]
      );
    }
  } catch (err) {
    if (err instanceof PennylaneApiError && [403, 404].includes(err.status)) return;
    throw err;
  }
}

async function refreshRecurringSuggestions(db, storeId) {
  const rows = await db.query(
    `
    SELECT *
    FROM cashflow_bank_transactions
    WHERE store_id = $1
      AND direction = 'out'
      AND transaction_date >= CURRENT_DATE - INTERVAL '180 days'
    `,
    [storeId]
  );
  const suggestions = detectRecurringTransactions(rows.rows);
  for (const suggestion of suggestions) {
    await db.query(
      `
      INSERT INTO cashflow_recurring_suggestions(
        store_id, suggestion_type, label, estimated_amount, frequency, confidence, evidence
      )
      VALUES($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT DO NOTHING
      `,
      [storeId, suggestion.suggestion_type, suggestion.label, suggestion.estimated_amount, suggestion.frequency, suggestion.confidence, JSON.stringify(suggestion.evidence)]
    ).catch(() => {});
  }
}

async function syncClass6ChargeHistory(db, storeId) {
  const stats = makeStats('class6_trial_balance', 'LOCAL pennylane_trial_balance_lines');
  const result = await db.query(
    `
    SELECT DISTINCT ON (line.account_number)
      snap.period_start,
      snap.period_end,
      line.account_number,
      line.account_label,
      line.total_debit,
      line.total_credit,
      (COALESCE(line.total_debit, 0) - COALESCE(line.total_credit, 0)) AS net_charge
    FROM pennylane_trial_balance_snapshots snap
    INNER JOIN pennylane_trial_balance_lines line ON line.snapshot_id = snap.id
    WHERE snap.store_id = $1
      AND line.account_number LIKE '6%'
    ORDER BY line.account_number, snap.fetched_at DESC
    `,
    [storeId]
  ).catch(() => ({ rows: [] }));
  stats.received_count = result.rows.length;
  stats.normalized_count = result.rows.length;
  if (result.rows[0]) stats.first_item_shape = itemShape(result.rows[0]);
  for (const row of result.rows) {
    const inserted = await db.query(
      `
      INSERT INTO cashflow_charge_history(
        store_id, source, period_start, period_end, month_key, account_number, account_label,
        category_code, total_debit, total_credit, net_charge, raw_payload
      )
      VALUES($1, 'trial_balance', $2::date, $3::date, to_char($3::date, 'YYYY-MM'), $4, $5, $6, $7, $8, $9, $10::jsonb)
      ON CONFLICT (store_id, source, COALESCE(period_start, '1900-01-01'::date), COALESCE(period_end, '1900-01-01'::date), account_number)
      DO UPDATE SET account_label = EXCLUDED.account_label,
        category_code = EXCLUDED.category_code,
        total_debit = EXCLUDED.total_debit,
        total_credit = EXCLUDED.total_credit,
        net_charge = EXCLUDED.net_charge,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
      RETURNING (xmax = 0) AS inserted
      `,
      [
        storeId,
        row.period_start,
        row.period_end,
        row.account_number,
        row.account_label,
        categoryForAccount(row.account_number),
        Number(row.total_debit || 0),
        Number(row.total_credit || 0),
        Number(row.net_charge || 0),
        JSON.stringify(row),
      ]
    ).catch(() => ({ rows: [] }));
    if (inserted.rows[0]?.inserted) stats.inserted_count += 1;
    else stats.updated_count += 1;
  }
  await saveResourceLog(db, storeId, stats);
  return { read: stats.received_count, upserted: stats.inserted_count + stats.updated_count, stats };
}

function categoryForAccount(accountNumber) {
  const value = String(accountNumber || '');
  if (value.startsWith('607')) return 'goods_purchases';
  if (value.startsWith('624')) return 'transport';
  if (value.startsWith('6226')) return 'fees';
  if (value.startsWith('625')) return 'travel_reception';
  if (value.startsWith('613') || value.startsWith('614')) return 'rent';
  if (value.startsWith('616')) return 'insurance';
  if (value.startsWith('627')) return 'bank_fees';
  if (value.startsWith('641')) return 'wages';
  if (value.startsWith('645')) return 'social_charges';
  if (value.startsWith('63')) return 'taxes';
  if (value.startsWith('612')) return 'leasing';
  return 'charges_a_classer';
}

async function syncCashflowData(db, { storeId, userId }) {
  const config = getPennylaneConfig();
  const client = createPennylaneClient(config);
  const result = {
    diagnostic: await runCashflowDiagnostic(db, { storeId, client }),
    bank_accounts: null,
    transactions: null,
    supplier_invoices: null,
    supplier_payments: null,
    class6_charge_history: null,
    customer_invoice_queue: null,
  };

  try {
    result.bank_accounts = await syncBankAccounts(db, { storeId, client });
  } catch (err) {
    result.bank_accounts = { failed: true, ...sanitizePennylaneError(err) };
  }
  try {
    result.transactions = await syncTransactions(db, { storeId, client });
  } catch (err) {
    result.transactions = { failed: true, ...sanitizePennylaneError(err) };
  }
  try {
    result.supplier_invoices = await syncSupplierInvoicesDirect(db, { storeId, client });
    result.supplier_invoice_changelog = await processPennylaneSupplierInvoiceImportSync(db, {
      storeId,
      workerId: `manual-cashflow-supplier-sync-${userId || 'system'}`,
    }).catch((err) => ({ failed: true, error: err.message }));
  } catch (err) {
    result.supplier_invoices = { failed: true, error: err.message };
  }
  try {
    result.supplier_payments = await syncSupplierInvoicePayments(db, { storeId, client });
  } catch (err) {
    result.supplier_payments = { failed: true, ...sanitizePennylaneError(err) };
  }
  result.class6_charge_history = await syncClass6ChargeHistory(db, storeId);
  try {
    result.customer_invoice_queue = await processPennylaneCustomerInvoiceSyncQueue(db, {
      workerId: `manual-cashflow-customer-sync-${userId || 'system'}`,
    });
  } catch (err) {
    result.customer_invoice_queue = { failed: true, error: err.message };
  }

  const failed = Object.values(result).some((value) => value?.failed);
  await db.query(
    `
    INSERT INTO cashflow_sync_logs(store_id, sync_type, status, read_count, created_count, updated_count, skipped_count, error_message, details, completed_at)
    VALUES($1, 'manual', $2, $3, $4, 0, 0, $5, $6::jsonb, now())
    `,
    [
      storeId,
      failed ? 'partial' : 'success',
      Number(result.bank_accounts?.read || 0) + Number(result.transactions?.read || 0) + Number(result.supplier_payments?.read || 0),
      Number(result.bank_accounts?.upserted || 0) + Number(result.transactions?.upserted || 0) + Number(result.supplier_payments?.upserted || 0),
      Object.values(result).filter((value) => value?.failed).map((value) => value.message || value.error).filter(Boolean).join(' ; ') || null,
      JSON.stringify(result),
    ]
  ).catch(() => {});

  return result;
}

module.exports = {
  DIAGNOSTIC_TARGETS,
  PENNYLANE_CASHFLOW_CAPABILITIES,
  extractList,
  fetchAllPages,
  itemShape,
  normalizeSupplierInvoice,
  normalizeTransaction,
  classifySupplierInvoiceCashflow,
  pushSqlError,
  runCashflowDiagnostic,
  syncBankAccounts,
  syncCashflowData,
  syncSupplierInvoicesDirect,
  syncSupplierInvoicePayments,
  syncTransactions,
  syncClass6ChargeHistory,
  refreshSupplierInvoiceCashflowState,
};
