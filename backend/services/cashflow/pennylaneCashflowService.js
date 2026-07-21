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
  if (Array.isArray(body.bank_accounts)) return body.bank_accounts;
  if (Array.isArray(body.transactions)) return body.transactions;
  if (Array.isArray(body.supplier_invoices)) return body.supplier_invoices;
  if (Array.isArray(body.customer_invoices)) return body.customer_invoices;
  if (Array.isArray(body.payments)) return body.payments;
  if (Array.isArray(body.balances)) return body.balances;
  if (body.data && typeof body.data === 'object') return extractList(body.data);
  return [];
}

function hasMore(body) {
  return Boolean(body?.has_more || body?.meta?.has_more);
}

function nextCursor(body) {
  return body?.next_cursor || body?.meta?.next_cursor || null;
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

async function fetchAllPages(client, endpoint, { limit = 100, maxPages = 30 } = {}) {
  const separator = endpoint.includes('?') ? '&' : '?';
  let cursor = null;
  let pages = 0;
  const items = [];
  do {
    const url = `${endpoint}${separator}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const response = await client.get(url);
    items.push(...extractList(response.body));
    cursor = hasMore(response.body) ? nextCursor(response.body) : null;
    pages += 1;
  } while (cursor && pages < maxPages);
  return { items, pages };
}

async function runCashflowDiagnostic(db, { storeId, client = createPennylaneClient(getPennylaneConfig()) } = {}) {
  const rows = [];
  let sampleSupplierInvoiceId = null;
  for (const target of DIAGNOSTIC_TARGETS) {
    let diagnostic;
    try {
      const response = await client.get(target.endpoint);
      const items = extractList(response.body);
      if (target.key === 'supplier_invoices' && items[0]) {
        sampleSupplierInvoiceId = firstPresent(items[0], ['id', 'supplier_invoice_id']);
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
  const establishment = firstPresent(account, ['bank_establishment']) || {};
  const journal = firstPresent(account, ['journal']) || {};
  const ledger = firstPresent(account, ['ledger_account', 'accounting_account']) || {};
  return {
    id: String(firstPresent(account, ['id', 'bank_account_id'])),
    name: firstPresent(account, ['name', 'label']) || 'Compte bancaire',
    currency: firstPresent(account, ['currency']) || 'EUR',
    balance: Number(firstPresent(account, ['balance', 'current_balance', 'amount']) || 0),
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
  const { items, pages } = await fetchAllPages(client, '/bank_accounts', { limit: 100 });
  let upserted = 0;
  for (const account of items.map(normalizeBankAccount).filter((row) => row.id && row.id !== 'undefined')) {
    await db.query(
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
      `,
      [storeId, account.id, account.name, account.currency, account.balance, account.updated_at || null, account.bank_establishment_name, account.bank_establishment_id ? String(account.bank_establishment_id) : null, account.journal_id ? String(account.journal_id) : null, account.journal_label, account.ledger_account_id ? String(account.ledger_account_id) : null, account.ledger_account_number, JSON.stringify(account.raw)]
    );
    upserted += 1;
  }
  await refreshBankSnapshot(db, storeId);
  return { read: items.length, upserted, pages };
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
  const amount = Number(firstPresent(tx, ['amount', 'currency_amount']) || 0);
  const bankAccount = firstPresent(tx, ['bank_account']) || {};
  const supplier = firstPresent(tx, ['supplier']) || {};
  const customer = firstPresent(tx, ['customer']) || {};
  const matchedInvoices = firstPresent(tx, ['matched_invoices', 'invoices']) || [];
  const categories = firstPresent(tx, ['categories']) || [];
  const status = firstPresent(tx, ['reconciliation_status', 'status', 'state']);
  return {
    id: String(firstPresent(tx, ['id', 'transaction_id'])),
    bank_account_id: firstPresent(tx, ['bank_account_id']) || firstPresent(bankAccount, ['id']),
    date: firstPresent(tx, ['date', 'transaction_date']),
    label: firstPresent(tx, ['label', 'description', 'name']) || 'Mouvement bancaire',
    amount: Math.abs(amount),
    direction: amount < 0 || String(firstPresent(tx, ['direction', 'type']) || '').toLowerCase().includes('debit') ? 'out' : 'in',
    currency: firstPresent(tx, ['currency']) || 'EUR',
    supplier_id: firstPresent(tx, ['supplier_id']) || firstPresent(supplier, ['id']),
    customer_id: firstPresent(tx, ['customer_id']) || firstPresent(customer, ['id']),
    categories,
    matched_invoices: Array.isArray(matchedInvoices) ? matchedInvoices : [],
    reconciliation_status: status || (Array.isArray(matchedInvoices) && matchedInvoices.length ? 'matched' : null),
    unmatched_amount: Number(firstPresent(tx, ['outstanding_balance', 'unmatched_amount']) || 0),
    created_at: firstPresent(tx, ['created_at']),
    updated_at: firstPresent(tx, ['updated_at']),
    raw: tx,
  };
}

async function syncTransactions(db, { storeId, client }) {
  const { items, pages } = await fetchAllPages(client, '/transactions', { limit: 100 });
  let upserted = 0;
  for (const tx of items.map(normalizeTransaction).filter((row) => row.id && row.id !== 'undefined' && row.date)) {
    await db.query(
      `
      INSERT INTO cashflow_bank_transactions(
        store_id, pennylane_transaction_id, bank_account_pennylane_id, transaction_date, label,
        direction, amount, currency, supplier_id, customer_id, categories, matched_invoices,
        reconciliation_status, reconciled, unmatched_amount, pennylane_created_at, pennylane_updated_at, raw_payload
      )
      VALUES($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15, $16::timestamptz, $17::timestamptz, $18::jsonb)
      ON CONFLICT (store_id, pennylane_transaction_id) DO UPDATE
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
      `,
      [storeId, tx.id, tx.bank_account_id ? String(tx.bank_account_id) : null, tx.date, tx.label, tx.direction, tx.amount, tx.currency, tx.supplier_id ? String(tx.supplier_id) : null, tx.customer_id ? String(tx.customer_id) : null, JSON.stringify(tx.categories), JSON.stringify(tx.matched_invoices), tx.reconciliation_status, ['matched', 'reconciled'].includes(String(tx.reconciliation_status || '').toLowerCase()), tx.unmatched_amount, tx.created_at || null, tx.updated_at || null, JSON.stringify(tx.raw)]
    );
    await upsertTransactionInvoiceLinks(db, storeId, tx);
    upserted += 1;
  }
  await refreshRecurringSuggestions(db, storeId);
  return { read: items.length, upserted, pages };
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
  for (const invoice of invoices.rows) {
    try {
      const { items } = await fetchAllPages(client, `/supplier_invoices/${encodeURIComponent(invoice.pennylane_supplier_invoice_id)}/payments`, { limit: 100, maxPages: 10 });
      read += items.length;
      for (const payment of items) {
        const paymentId = firstPresent(payment, ['id', 'payment_id']);
        if (!paymentId) continue;
        const classification = classifySupplierPaymentStatus(firstPresent(payment, ['status', 'state']));
        await db.query(
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
          `,
          [storeId, String(invoice.pennylane_supplier_invoice_id), String(paymentId), firstPresent(payment, ['label', 'description']), Number(firstPresent(payment, ['amount', 'currency_amount']) || 0), firstPresent(payment, ['currency']) || 'EUR', classification.status, classification.is_confirmed, classification.is_pending, firstPresent(payment, ['created_at']) || null, firstPresent(payment, ['updated_at']) || null, JSON.stringify(payment)]
        );
        upserted += 1;
      }
    } catch (err) {
      failed += 1;
      if (err instanceof PennylaneApiError && err.status === 403) throw err;
    }
  }
  return { invoices: invoices.rows.length, read, upserted, failed };
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

async function syncCashflowData(db, { storeId, userId }) {
  const config = getPennylaneConfig();
  const client = createPennylaneClient(config);
  const result = {
    diagnostic: await runCashflowDiagnostic(db, { storeId, client }),
    bank_accounts: null,
    transactions: null,
    supplier_invoices: null,
    supplier_payments: null,
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
    result.supplier_invoices = await processPennylaneSupplierInvoiceImportSync(db, {
      storeId,
      workerId: `manual-cashflow-supplier-sync-${userId || 'system'}`,
    });
  } catch (err) {
    result.supplier_invoices = { failed: true, error: err.message };
  }
  try {
    result.supplier_payments = await syncSupplierInvoicePayments(db, { storeId, client });
  } catch (err) {
    result.supplier_payments = { failed: true, ...sanitizePennylaneError(err) };
  }
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
  runCashflowDiagnostic,
  syncBankAccounts,
  syncCashflowData,
  syncSupplierInvoicePayments,
  syncTransactions,
};
