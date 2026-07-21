const { renderHtmlToPdf, sendPdf } = require('../pdf/pdfRenderer');
const {
  buildDailyForecast,
  buildWeeklyForecast,
  expandManualItems,
  isoDate,
  money,
} = require('./forecastService');
const { calculateCustomerBehaviour, forecastCustomerPaymentDate } = require('./customerPaymentBehaviourService');
const { calculateDistrimerExposure, simulateDistrimerPayment, DEFAULT_SETTINGS } = require('./distrimerExposureService');
const { latestBankSnapshot, listBankAccounts, listBankTransactions } = require('./bankTransactionService');
const { PENNYLANE_CASHFLOW_CAPABILITIES } = require('./pennylaneCashflowService');
const { listManualItems } = require('./manualForecastService');
const { calculateSupplierInvoicePaymentAmounts } = require('./supplierPaymentService');
const { expandRecurringCharges } = require('./recurringChargeService');

function parseHorizon(value) {
  const horizon = Number(value || 30);
  return [7, 30, 60, 90].includes(horizon) ? horizon : 30;
}

function parseScenario(value) {
  const text = String(value || 'realiste').toLowerCase();
  return ['prudent', 'realiste', 'optimiste'].includes(text) ? text : 'realiste';
}

function coalesceCashflowAmount(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return Number(value || 0);
  }
  return 0;
}

async function getSettings(db, storeId) {
  const result = await db.query(
    `
    INSERT INTO cashflow_settings(store_id)
    VALUES($1)
    ON CONFLICT (store_id) DO UPDATE SET updated_at = cashflow_settings.updated_at
    RETURNING *
    `,
    [storeId]
  );
  return result.rows[0];
}

async function updateSettings(db, storeId, body = {}) {
  const current = await getSettings(db, storeId);
  const result = await db.query(
    `
    UPDATE cashflow_settings
    SET opening_balance = $2,
      main_bank_account_label = $3,
      distrimer_supplier_id = $4,
      distrimer_pennylane_supplier_id = $5,
      distrimer_limit = $6,
      distrimer_green_threshold = $7,
      distrimer_orange_threshold = $8,
      distrimer_red_threshold = $9,
      distrimer_target_after_payment = $10,
      default_customer_delay_days = $11,
      cautious_customer_delay_days = $12,
      included_bank_account_ids = COALESCE($13::text[], included_bank_account_ids),
      excluded_bank_account_ids = COALESCE($14::text[], excluded_bank_account_ids),
      balance_stale_after_hours = $15,
      monitored_supplier_pennylane_id = $16,
      monitored_supplier_name = $17,
      settings = COALESCE($18::jsonb, settings),
      updated_at = now()
    WHERE store_id = $1
    RETURNING *
    `,
    [
      storeId,
      body.opening_balance ?? current.opening_balance,
      body.main_bank_account_label ?? current.main_bank_account_label,
      body.distrimer_supplier_id ?? current.distrimer_supplier_id,
      body.distrimer_pennylane_supplier_id ?? current.distrimer_pennylane_supplier_id,
      body.distrimer_limit ?? current.distrimer_limit,
      body.distrimer_green_threshold ?? current.distrimer_green_threshold,
      body.distrimer_orange_threshold ?? current.distrimer_orange_threshold,
      body.distrimer_red_threshold ?? current.distrimer_red_threshold,
      body.distrimer_target_after_payment ?? current.distrimer_target_after_payment,
      body.default_customer_delay_days ?? current.default_customer_delay_days,
      body.cautious_customer_delay_days ?? current.cautious_customer_delay_days,
      Array.isArray(body.included_bank_account_ids) ? body.included_bank_account_ids.map(String) : null,
      Array.isArray(body.excluded_bank_account_ids) ? body.excluded_bank_account_ids.map(String) : null,
      body.balance_stale_after_hours ?? current.balance_stale_after_hours ?? 24,
      body.monitored_supplier_pennylane_id ?? current.monitored_supplier_pennylane_id ?? body.distrimer_pennylane_supplier_id ?? current.distrimer_pennylane_supplier_id,
      body.monitored_supplier_name ?? current.monitored_supplier_name,
      body.settings ? JSON.stringify(body.settings) : null,
    ]
  );
  await applyBankAccountSelection(db, storeId, result.rows[0]);
  return result.rows[0];
}

async function applyBankAccountSelection(db, storeId, settings) {
  const included = Array.isArray(settings.included_bank_account_ids) ? settings.included_bank_account_ids : [];
  const excluded = Array.isArray(settings.excluded_bank_account_ids) ? settings.excluded_bank_account_ids : [];
  if (!included.length && !excluded.length) return;
  await db.query(
    `
    UPDATE cashflow_bank_accounts
    SET include_in_cashflow = CASE
        WHEN pennylane_bank_account_id = ANY($2::text[]) THEN true
        WHEN pennylane_bank_account_id = ANY($3::text[]) THEN false
        ELSE include_in_cashflow
      END,
      is_main = CASE WHEN pennylane_bank_account_id = $4 THEN true ELSE false END,
      updated_at = now()
    WHERE store_id = $1
    `,
    [storeId, included, excluded, included[0] || null]
  ).catch(() => {});
}

async function listCustomerReceivables(db, storeId) {
  const result = await db.query(
    `
    SELECT
      inv.id,
      inv.reference_number AS invoice_number,
      inv.document_date AS invoice_date,
      COALESCE(inv.payment_due_date, inv.due_date, inv.document_date + INTERVAL '30 days')::date AS due_date,
      inv.total_amount_inc_vat AS total_amount,
      COALESCE(inv.pennylane_remaining_amount, GREATEST(inv.total_amount_inc_vat - COALESCE(inv.pennylane_paid_amount, 0), 0), inv.total_amount_inc_vat) AS remaining_amount,
      inv.pennylane_payment_status AS payment_status,
      inv.pennylane_paid_at AS paid_at,
      COALESCE(inv.billed_client_id, inv.client_id) AS client_id,
      COALESCE(inv.billed_client_name_snapshot, billed.name, delivered.name, 'Client') AS client_name,
      COALESCE(billed.payment_terms, delivered.payment_terms) AS payment_terms
    FROM sales_documents inv
    LEFT JOIN clients billed ON billed.id = inv.billed_client_id AND billed.store_id = inv.store_id
    LEFT JOIN clients delivered ON delivered.id = inv.client_id AND delivered.store_id = inv.store_id
    WHERE inv.store_id = $1
      AND inv.document_type = 'INVOICE'
      AND COALESCE(inv.status, '') NOT IN ('cancelled', 'deleted')
      AND COALESCE(inv.pennylane_payment_status, 'unpaid') NOT IN ('paid')
    ORDER BY due_date ASC NULLS LAST, inv.document_date ASC
    LIMIT 500
    `,
    [storeId]
  ).catch(() => ({ rows: [] }));
  return result.rows.map((row) => ({
    ...row,
    expected_payment_date: forecastCustomerPaymentDate(row),
    is_overdue: row.due_date ? isoDate(row.due_date) < isoDate(new Date()) : false,
    forecast_reliability: row.client_name && String(row.client_name).toUpperCase().includes('ROYALE MAREE') ? 'moyenne' : 'standard',
  }));
}

async function listPaidCustomerHistory(db, storeId) {
  const result = await db.query(
    `
    SELECT
      inv.id,
      inv.document_date AS invoice_date,
      COALESCE(inv.payment_due_date, inv.due_date, inv.document_date + INTERVAL '30 days')::date AS due_date,
      inv.pennylane_paid_at AS paid_at,
      COALESCE(inv.billed_client_id, inv.client_id) AS client_id,
      COALESCE(inv.billed_client_name_snapshot, billed.name, delivered.name, 'Client') AS client_name
    FROM sales_documents inv
    LEFT JOIN clients billed ON billed.id = inv.billed_client_id AND billed.store_id = inv.store_id
    LEFT JOIN clients delivered ON delivered.id = inv.client_id AND delivered.store_id = inv.store_id
    WHERE inv.store_id = $1
      AND inv.document_type = 'INVOICE'
      AND inv.pennylane_paid_at IS NOT NULL
    ORDER BY inv.pennylane_paid_at DESC
    LIMIT 1000
    `,
    [storeId]
  ).catch(() => ({ rows: [] }));
  return result.rows;
}

async function listSupplierPayables(db, storeId) {
  const result = await db.query(
    `
    SELECT
      psi.id,
      psi.pennylane_supplier_invoice_id,
      psi.pennylane_supplier_id,
      psi.supplier_id,
      COALESCE(s.name, psi.cashflow_supplier_name, psi.pennylane_supplier_id, 'Fournisseur') AS supplier_name,
      psi.invoice_number,
      psi.invoice_date,
      psi.due_date,
      COALESCE(psi.cashflow_remaining_amount, psi.remaining_amount_with_tax, psi.amount_inc_vat, psi.currency_amount_inc_vat, 0) AS remaining_amount,
      psi.amount_inc_vat AS total_amount,
      psi.payment_status,
      psi.paid,
      psi.accounting_status,
      COALESCE(psi.cashflow_open_state, 'needs_review') AS cashflow_open_state,
      psi.cashflow_state_reason,
      psi.cashflow_supplier_name,
      psi.last_synced_at,
      'pennylane' AS source,
      COALESCE(pay.confirmed_paid_amount, 0) AS confirmed_paid_amount,
      COALESCE(pay.pending_payment_amount, 0) AS pending_payment_amount,
      COALESCE(pay.payment_count, 0)::int AS payment_count,
      COALESCE(link.link_count, 0)::int AS matched_transaction_count
    FROM pennylane_supplier_invoices psi
    LEFT JOIN suppliers s ON s.id = psi.supplier_id AND s.store_id = psi.store_id
    LEFT JOIN (
      SELECT
        store_id,
        pennylane_supplier_invoice_id,
        SUM(CASE WHEN is_confirmed THEN amount ELSE 0 END) AS confirmed_paid_amount,
        SUM(CASE WHEN is_pending THEN amount ELSE 0 END) AS pending_payment_amount,
        COUNT(*) AS payment_count
      FROM cashflow_supplier_invoice_payments
      GROUP BY store_id, pennylane_supplier_invoice_id
    ) pay ON pay.store_id = psi.store_id AND pay.pennylane_supplier_invoice_id = psi.pennylane_supplier_invoice_id
    LEFT JOIN (
      SELECT store_id, pennylane_invoice_id, COUNT(*) AS link_count
      FROM cashflow_invoice_transaction_links
      WHERE invoice_type = 'supplier_invoice'
      GROUP BY store_id, pennylane_invoice_id
    ) link ON link.store_id = psi.store_id AND link.pennylane_invoice_id = psi.pennylane_supplier_invoice_id
    WHERE psi.store_id = $1
      AND psi.pennylane_deleted_at IS NULL
      AND COALESCE(psi.cashflow_open_state, CASE
        WHEN COALESCE(psi.paid, false) = true OR COALESCE(psi.payment_status, '') IN ('paid') THEN 'paid'
        WHEN COALESCE(psi.remaining_amount_with_tax, psi.amount_inc_vat, psi.currency_amount_inc_vat, 0) > 0 THEN 'open'
        ELSE 'needs_review'
      END) IN ('open', 'needs_review')
    ORDER BY psi.due_date ASC NULLS LAST, psi.invoice_date ASC
    LIMIT 500
    `,
    [storeId]
  ).catch(() => ({ rows: [] }));
  return result.rows.map((row) => ({
    ...row,
    supplier_name: row.supplier_name || row.cashflow_supplier_name || row.pennylane_supplier_id || 'Fournisseur a completer',
    remaining_amount: coalesceCashflowAmount(row.remaining_amount, row.total_amount),
    is_open: ['open', 'needs_review'].includes(String(row.cashflow_open_state || '').toLowerCase()),
    ...calculateSupplierInvoicePaymentAmounts({
      totalAmount: row.total_amount,
      pennylaneRemainingAmount: row.remaining_amount,
      payments: [
        { amount: row.confirmed_paid_amount, status: 'confirmed' },
        { amount: row.pending_payment_amount, status: 'pending' },
      ],
    }),
    planned_payment_date: row.due_date || row.invoice_date || isoDate(new Date()),
    priority: row.due_date && isoDate(row.due_date) <= isoDate(new Date()) ? 'haute' : 'normale',
  }));
}

async function listRecurringCharges(db, storeId) {
  const result = await db.query(
    `
    SELECT *
    FROM cashflow_recurring_charges
    WHERE store_id = $1
    ORDER BY active DESC, first_due_date ASC
    LIMIT 500
    `,
    [storeId]
  ).catch(() => ({ rows: [] }));
  return result.rows;
}

async function listChargeHistory(db, storeId) {
  const result = await db.query(
    `
    SELECT *
    FROM cashflow_charge_history
    WHERE store_id = $1
    ORDER BY month_key DESC NULLS LAST, account_number ASC
    LIMIT 300
    `,
    [storeId]
  ).catch(() => ({ rows: [] }));
  return result.rows;
}

async function forecastItems(db, storeId, { days = 30 } = {}) {
  const [receivables, payables, manualItems, recurringCharges] = await Promise.all([
    listCustomerReceivables(db, storeId),
    listSupplierPayables(db, storeId),
    listManualItems(db, storeId).catch(() => []),
    listRecurringCharges(db, storeId),
  ]);
  const expandedManual = expandManualItems(manualItems.map((item) => ({
    ...item,
    date: item.forecast_date,
    type: item.direction,
  })), { days });

  const recurringItems = expandRecurringCharges(recurringCharges, { days });

  return [
    ...receivables.map((invoice) => ({
      id: invoice.id,
      label: `Facture client ${invoice.invoice_number || ''}`.trim(),
      date: invoice.expected_payment_date,
      due_date: invoice.due_date,
      amount: invoice.remaining_amount,
      direction: 'in',
      source: 'pennylane_customer_invoice',
      counterparty_name: invoice.client_name,
      status: invoice.payment_status,
    })),
    ...payables.map((invoice) => ({
      id: invoice.id,
      label: `Facture fournisseur ${invoice.invoice_number || ''}`.trim(),
      date: invoice.planned_payment_date,
      due_date: invoice.due_date,
      amount: invoice.remaining_amount,
      direction: 'out',
      source: 'pennylane_supplier_invoice',
      counterparty_name: invoice.supplier_name,
      status: invoice.payment_status,
    })),
    ...expandedManual.map((item) => ({
      id: item.id,
      label: item.label,
      date: item.date,
      amount: item.amount,
      direction: item.direction,
      source: 'manual',
      counterparty_name: item.category,
      status: item.active === false ? 'inactive' : 'active',
    })),
    ...recurringItems,
  ];
}

function settingsForDistrimer(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    supplierName: 'DISTRIMER',
    limit: Number(settings.distrimer_limit || 10000),
    greenThreshold: Number(settings.distrimer_green_threshold || 8000),
    orangeThreshold: Number(settings.distrimer_orange_threshold || 9500),
    blockingThreshold: Number(settings.distrimer_limit || 10000),
    targetAfterPayment: Number(settings.distrimer_target_after_payment || 7500),
  };
}

function isDistrimerInvoice(invoice, settings = {}) {
  if (settings.monitored_supplier_pennylane_id && invoice.pennylane_supplier_id && String(settings.monitored_supplier_pennylane_id) === String(invoice.pennylane_supplier_id)) return true;
  if (settings.monitored_supplier_name && normalizeName(invoice.supplier_name) === normalizeName(settings.monitored_supplier_name)) return true;
  if (settings.distrimer_supplier_id && invoice.supplier_id && String(settings.distrimer_supplier_id) === String(invoice.supplier_id)) return true;
  if (settings.distrimer_pennylane_supplier_id && invoice.pennylane_supplier_id && String(settings.distrimer_pennylane_supplier_id) === String(invoice.pennylane_supplier_id)) return true;
  return normalizeName(invoice.supplier_name).includes('DISTRIMER');
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

async function getDistrimer(db, storeId) {
  const settings = await getSettings(db, storeId);
  const payables = await listSupplierPayables(db, storeId);
  const allDistrimerInvoices = await db.query(
    `
    SELECT
      psi.id,
      psi.pennylane_supplier_invoice_id,
      psi.pennylane_supplier_id,
      psi.supplier_id,
      COALESCE(s.name, psi.cashflow_supplier_name, psi.pennylane_supplier_id, 'Fournisseur') AS supplier_name,
      psi.invoice_number,
      psi.invoice_date,
      psi.due_date,
      COALESCE(psi.cashflow_open_state, 'needs_review') AS cashflow_open_state,
      COALESCE(psi.cashflow_remaining_amount, psi.remaining_amount_with_tax, psi.amount_inc_vat, psi.currency_amount_inc_vat, 0) AS remaining_amount,
      COALESCE(pay.pending_payment_amount, 0) AS pending_payment_amount
    FROM pennylane_supplier_invoices psi
    LEFT JOIN suppliers s ON s.id = psi.supplier_id AND s.store_id = psi.store_id
    LEFT JOIN (
      SELECT store_id, pennylane_supplier_invoice_id, SUM(CASE WHEN is_pending THEN amount ELSE 0 END) AS pending_payment_amount
      FROM cashflow_supplier_invoice_payments
      GROUP BY store_id, pennylane_supplier_invoice_id
    ) pay ON pay.store_id = psi.store_id AND pay.pennylane_supplier_invoice_id = psi.pennylane_supplier_invoice_id
    WHERE psi.store_id = $1 AND psi.pennylane_deleted_at IS NULL
    `,
    [storeId]
  ).then((r) => r.rows.filter((invoice) => isDistrimerInvoice(invoice, settings))).catch(() => []);
  const invoices = allDistrimerInvoices.filter((invoice) => invoice.cashflow_open_state === 'open').map((invoice) => ({
    ...invoice,
    amount: invoice.remaining_amount,
    date: invoice.due_date || invoice.invoice_date,
  }));
  const exposure = calculateDistrimerExposure({
    invoices,
    plannedPurchases: [],
    settings: settingsForDistrimer(settings),
  });
  const reviewInvoices = allDistrimerInvoices.filter((invoice) => invoice.cashflow_open_state === 'needs_review');
  const paidInvoices = allDistrimerInvoices.filter((invoice) => invoice.cashflow_open_state === 'paid');
  const potentialOutstanding = reviewInvoices.reduce((sum, invoice) => sum + Number(invoice.remaining_amount || 0), Number(exposure.exposure || 0));
  return {
    ...exposure,
    total_invoice_count: allDistrimerInvoices.length,
    open_invoice_count: invoices.length,
    paid_invoice_count: paidInvoices.length,
    review_invoice_count: reviewInvoices.length,
    confirmed_outstanding: exposure.exposure,
    potential_review_outstanding: reviewInvoices.reduce((sum, invoice) => sum + Number(invoice.remaining_amount || 0), 0),
    potential_outstanding: money(potentialOutstanding),
    pending_payment_amount: allDistrimerInvoices.reduce((sum, invoice) => sum + Number(invoice.pending_payment_amount || 0), 0),
    review_items: reviewInvoices.map((invoice) => ({
      id: invoice.id,
      label: invoice.invoice_number || 'Facture DISTRIMER a verifier',
      date: invoice.due_date || invoice.invoice_date,
      amount: invoice.remaining_amount,
      source: 'pennylane_review',
    })),
  };
}

async function supplierExposure(db, storeId) {
  const payables = await listSupplierPayables(db, storeId);
  const bySupplier = new Map();
  for (const invoice of payables) {
    const key = invoice.pennylane_supplier_id || invoice.supplier_id || invoice.supplier_name || 'unknown';
    if (!bySupplier.has(key)) {
      bySupplier.set(key, {
        supplier_id: invoice.supplier_id || null,
        pennylane_supplier_id: invoice.pennylane_supplier_id || null,
        supplier_name: invoice.supplier_name || 'Fournisseur a completer',
        open_invoice_count: 0,
        total_amount: 0,
        confirmed_paid_amount: 0,
        pending_payment_amount: 0,
        remaining_amount: 0,
        oldest_due_date: null,
        invoices: [],
      });
    }
    const row = bySupplier.get(key);
    row.open_invoice_count += 1;
    row.total_amount += Number(invoice.total_amount || 0);
    row.confirmed_paid_amount += Number(invoice.confirmed_paid_amount || 0);
    row.pending_payment_amount += Number(invoice.pending_payment_amount || 0);
    row.remaining_amount += Number(invoice.remaining_amount || 0);
    if (invoice.due_date && (!row.oldest_due_date || isoDate(invoice.due_date) < isoDate(row.oldest_due_date))) {
      row.oldest_due_date = invoice.due_date;
    }
    row.invoices.push(invoice);
  }
  return Array.from(bySupplier.values()).sort((a, b) => b.remaining_amount - a.remaining_amount);
}

async function debugCounts(db, storeId) {
  const single = async (sql, params = [storeId]) => db.query(sql, params).then((r) => Number(Object.values(r.rows[0] || { count: 0 })[0] || 0)).catch(() => 0);
  const settings = await getSettings(db, storeId).catch(() => ({}));
  const payables = await listSupplierPayables(db, storeId);
  const latestResourceLogs = await db.query(
    `
    SELECT DISTINCT ON (resource) resource, endpoint, pages_count, received_count, normalized_count,
      inserted_count, updated_count, ignored_count, error_count, ignored_reasons, error_message,
      error_details, first_item_shape, created_at
    FROM cashflow_sync_resource_logs
    WHERE store_id = $1
    ORDER BY resource, created_at DESC
    `,
    [storeId]
  ).then((r) => r.rows).catch(() => []);
  const latestFor = (resource) => latestResourceLogs.find((row) => row.resource === resource) || {};
  const supplierStateCounts = await db.query(
    `
    SELECT COALESCE(cashflow_open_state, 'needs_review') AS state, COUNT(*)::int AS count
    FROM pennylane_supplier_invoices
    WHERE store_id = $1 AND pennylane_deleted_at IS NULL
    GROUP BY COALESCE(cashflow_open_state, 'needs_review')
    `,
    [storeId]
  ).then((r) => r.rows.reduce((acc, row) => ({ ...acc, [row.state]: Number(row.count || 0) }), {})).catch(() => ({}));
  const suppliersFound = await db.query(
    `
    SELECT DISTINCT
      COALESCE(s.name, psi.cashflow_supplier_name, psi.pennylane_supplier_id, 'Fournisseur a completer') AS supplier_name,
      psi.pennylane_supplier_id,
      COUNT(*)::int AS invoice_count
    FROM pennylane_supplier_invoices psi
    LEFT JOIN suppliers s ON s.id = psi.supplier_id AND s.store_id = psi.store_id
    WHERE psi.store_id = $1 AND psi.pennylane_deleted_at IS NULL
    GROUP BY COALESCE(s.name, psi.cashflow_supplier_name, psi.pennylane_supplier_id, 'Fournisseur a completer'), psi.pennylane_supplier_id
    ORDER BY invoice_count DESC, supplier_name ASC
    LIMIT 50
    `,
    [storeId]
  ).then((r) => r.rows).catch(() => []);
  const totalSupplierInvoices = await single('SELECT COUNT(*) FROM pennylane_supplier_invoices WHERE store_id = $1 AND pennylane_deleted_at IS NULL');
  const class6InDatabase = await single('SELECT COUNT(*) FROM cashflow_charge_history WHERE store_id = $1');
  const distrimer = await getDistrimer(db, storeId).catch(() => ({}));
  return {
    bankAccountsReceived: Number(latestFor('bank_accounts').received_count || 0),
    bankAccountsInDatabase: await single('SELECT COUNT(*) FROM cashflow_bank_accounts WHERE store_id = $1'),
    transactionsReceived: Number(latestFor('transactions').received_count || 0),
    transactionsNormalized: Number(latestFor('transactions').normalized_count || 0),
    transactionsInDatabase: await single('SELECT COUNT(*) FROM cashflow_bank_transactions WHERE store_id = $1'),
    transactionErrors: Number(latestFor('transactions').error_count || 0),
    supplierInvoicesReceived: Number(latestFor('supplier_invoices').received_count || 0),
    supplierInvoicesInDatabase: totalSupplierInvoices,
    totalSupplierInvoices,
    openSupplierInvoices: Number(supplierStateCounts.open || 0),
    paidSupplierInvoices: Number(supplierStateCounts.paid || 0),
    reviewSupplierInvoices: Number(supplierStateCounts.needs_review || 0),
    payableOrReviewSupplierInvoices: payables.length,
    supplierPayments: await single('SELECT COUNT(*) FROM cashflow_supplier_invoice_payments WHERE store_id = $1'),
    trialBalanceAccounts: await single(`
      SELECT COUNT(*)
      FROM pennylane_trial_balance_lines line
      INNER JOIN pennylane_trial_balance_snapshots snap ON snap.id = line.snapshot_id
      WHERE snap.store_id = $1
    `),
    class6Received: Number(latestFor('class6_trial_balance').received_count || 0),
    class6InDatabase,
    class6ReturnedByApi: class6InDatabase,
    class6Accounts: await single(`
      SELECT COUNT(DISTINCT line.account_number)
      FROM pennylane_trial_balance_lines line
      INNER JOIN pennylane_trial_balance_snapshots snap ON snap.id = line.snapshot_id
      WHERE snap.store_id = $1 AND line.account_number LIKE '6%'
    `),
    recurringCharges: await single('SELECT COUNT(*) FROM cashflow_recurring_charges WHERE store_id = $1'),
    distrimerInvoices: Number(distrimer.total_invoice_count || 0),
    distrimerOpenInvoices: Number(distrimer.open_invoice_count || 0),
    distrimerPaidInvoices: Number(distrimer.paid_invoice_count || 0),
    distrimerReviewInvoices: Number(distrimer.review_invoice_count || 0),
    distrimerConfirmedOutstanding: Number(distrimer.confirmed_outstanding || 0),
    distrimerPotentialOutstanding: Number(distrimer.potential_outstanding || 0),
    distrimerPendingPayments: Number(distrimer.pending_payment_amount || 0),
    suppliersFound,
    latestResourceLogs,
  };
}

async function latestDiagnostics(db, storeId) {
  const result = await db.query(
    `
    SELECT DISTINCT ON (endpoint) *
    FROM cashflow_scope_diagnostics
    WHERE store_id = $1
    ORDER BY endpoint, tested_at DESC
    `,
    [storeId]
  ).catch(() => ({ rows: [] }));
  return result.rows;
}

async function chargeCompletionAlerts(db, storeId) {
  const [categories, recurring, transactions] = await Promise.all([
    db.query(
      `
      SELECT DISTINCT ON (SUBSTRING(line.account_number FROM 1 FOR 3))
        SUBSTRING(line.account_number FROM 1 FOR 3) AS account_prefix,
        line.account_label,
        line.net_balance
      FROM pennylane_trial_balance_snapshots snap
      INNER JOIN pennylane_trial_balance_lines line ON line.snapshot_id = snap.id
      WHERE snap.store_id = $1
        AND line.account_number LIKE ANY(ARRAY['60%', '61%', '62%', '63%', '64%', '65%', '66%'])
      ORDER BY SUBSTRING(line.account_number FROM 1 FOR 3), snap.fetched_at DESC
      `,
      [storeId]
    ).then((r) => r.rows).catch(async () => db.query(
      `
      SELECT *
      FROM financial_report_mappings
      WHERE (store_id = $1 OR store_id IS NULL)
        AND is_active = true
        AND account_prefix LIKE ANY(ARRAY['60%', '61%', '62%', '63%', '64%', '65%', '66%'])
      `,
      [storeId]
    ).then((r) => r.rows).catch(() => [])),
    listRecurringCharges(db, storeId),
    listBankTransactions(db, storeId, { direction: 'out' }).catch(() => []),
  ]);
  const recurringCategories = new Set(recurring.filter((row) => row.active !== false).map((row) => row.category_code));
  const alerts = [];
  const checks = [
    ['fees', 'Des honoraires ont ete comptabilises mais aucune echeance future n est configuree.'],
    ['wages', 'Aucune charge de salaire n est configuree.'],
    ['social_charges', 'Aucune prevision de cotisations sociales n est renseignee.'],
    ['taxes', 'Aucune prevision de TVA ou impots n est renseignee.'],
  ];
  for (const [code, message] of checks) {
    if (!recurringCategories.has(code)) alerts.push({ code, message, action: 'Creer une charge recurrente' });
  }
  if (categories.length && !recurring.length) {
    alerts.push({ code: 'historical_charges', message: 'Des comptes de classe 6 existent dans le compte d exploitation, mais aucune charge recurrente n est configuree.', action: 'Completer les charges recurrentes' });
  }
  return {
    alerts,
    historical_charge_categories_count: categories.length,
    configured_recurring_charges_count: recurring.length,
    observed_bank_outflows_count: transactions.length,
  };
}

async function getDashboard(db, storeId, query = {}) {
  const settings = await getSettings(db, storeId);
  const snapshot = await latestBankSnapshot(db, storeId).catch(() => null);
  const openingBalance = money(snapshot?.balance ?? settings.opening_balance ?? 0);
  const bankAccounts = await listBankAccounts(db, storeId);
  const [items, receivables, payables, manualItems, recurringCharges, diagnostics, completion, syncLog] = await Promise.all([
    forecastItems(db, storeId, { days: 90 }),
    listCustomerReceivables(db, storeId),
    listSupplierPayables(db, storeId),
    listManualItems(db, storeId).catch(() => []),
    listRecurringCharges(db, storeId),
    latestDiagnostics(db, storeId),
    chargeCompletionAlerts(db, storeId),
    db.query('SELECT * FROM cashflow_sync_logs WHERE store_id = $1 ORDER BY started_at DESC LIMIT 1', [storeId]).then((r) => r.rows[0]).catch(() => null),
  ]);
  const scenario = parseScenario(query.scenario);
  const daily30 = buildDailyForecast({ openingBalance, items, days: 30, scenario });
  const daily7 = buildDailyForecast({ openingBalance, items, days: 7, scenario });
  const distrimer = await getDistrimer(db, storeId);
  const overdueReceivables = receivables.filter((invoice) => invoice.is_overdue);

  return {
    kpis: {
      bank_balance: openingBalance,
      bank_balance_source: snapshot ? 'snapshot_bancaire_alta' : 'parametre_manuel',
      bank_balance_updated_at: snapshot?.snapshot_at || settings.updated_at,
      bank_balance_stale: snapshot?.snapshot_at
        ? ((Date.now() - new Date(snapshot.snapshot_at).getTime()) / 3600000) > Number(settings.balance_stale_after_hours || 24)
        : true,
      included_bank_accounts: bankAccounts.filter((account) => account.include_in_cashflow).map((account) => account.name),
      forecast_7_days: daily7.closing_balance,
      forecast_30_days: daily30.closing_balance,
      expected_inflows: money(items.filter((item) => item.direction === 'in').reduce((sum, item) => sum + Number(item.amount || 0), 0)),
      expected_outflows: money(items.filter((item) => item.direction === 'out').reduce((sum, item) => sum + Number(item.amount || 0), 0)),
      overdue_customer_invoices: overdueReceivables.length,
      supplier_invoices_to_pay: payables.length,
      distrimer_exposure: distrimer.exposure,
      distrimer_remaining_margin: distrimer.remaining_margin,
      minimum_cash_needed: Math.abs(Math.min(0, daily30.minimum_balance)),
    },
    reliability: {
      source: PENNYLANE_CASHFLOW_CAPABILITIES,
      last_sync: syncLog,
      bank_account: settings.main_bank_account_label || 'Compte principal non renseigne',
      customer_invoice_count: receivables.length,
      supplier_invoice_count: payables.length,
      manual_item_count: manualItems.length,
      recurring_charge_count: recurringCharges.length,
      unplanned_items: items.filter((item) => !item.date).length,
      bank_accounts: bankAccounts,
      diagnostics,
      charge_completion: completion,
    },
    forecast: daily30,
    weekly_forecast: buildWeeklyForecast(daily30.rows),
    distrimer,
  };
}

async function getForecast(db, storeId, query = {}) {
  const settings = await getSettings(db, storeId);
  const snapshot = await latestBankSnapshot(db, storeId).catch(() => null);
  const items = await forecastItems(db, storeId, { days: parseHorizon(query.days) });
  const daily = buildDailyForecast({
    openingBalance: snapshot?.balance ?? settings.opening_balance ?? 0,
    items,
    days: parseHorizon(query.days),
    scenario: parseScenario(query.scenario),
  });
  return {
    ...daily,
    weekly_rows: buildWeeklyForecast(daily.rows),
    assumptions: scenarioAssumptions(daily.scenario),
  };
}

function scenarioAssumptions(scenario) {
  if (scenario === 'prudent') return ['Encaissements clients decales par marge de securite.', 'Sorties conservees aux dates prevues.'];
  if (scenario === 'optimiste') return ['Clients aux echeances theoriques.', 'Aucune entree retardee.'];
  return ['Historique client et echeances Pennylane prioritaires.', 'Paiements fournisseurs aux dates configurees.'];
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[;"\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function forecastCsv(forecast) {
  const rows = [['Date', 'Solde debut', 'Encaissements', 'Decaissements', 'Solde fin']];
  for (const row of forecast.rows || []) {
    rows.push([row.date, row.opening_balance, row.inflows, row.outflows, row.closing_balance]);
  }
  return rows.map((row) => row.map(csvEscape).join(';')).join('\n');
}

function cashflowHtml(report) {
  const moneyFr = (value) => Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
  body{font-family:Arial,sans-serif;color:#172033} h1{font-size:20pt;color:#0f3d5e} table{width:100%;border-collapse:collapse;font-size:9pt} th,td{border:1px solid #d7dee8;padding:5px;text-align:left}.num{text-align:right}.alert{background:#fff1f2;color:#9f1239;padding:8px}.notice{font-size:8pt;color:#667085;margin-top:18px}
  </style></head><body><h1>Previsionnel de tresorerie</h1>
  <p>Periode : ${report.start_date} sur ${report.days} jours. Scenario : ${report.scenario}.</p>
  ${report.first_negative_date ? `<p class="alert">Solde negatif prevu le ${report.first_negative_date}. Point bas : ${moneyFr(report.minimum_balance)} EUR.</p>` : ''}
  <table><thead><tr><th>Date</th><th class="num">Solde debut</th><th class="num">Encaissements</th><th class="num">Decaissements</th><th class="num">Solde fin</th></tr></thead><tbody>
  ${report.rows.map((row) => `<tr><td>${row.date}</td><td class="num">${moneyFr(row.opening_balance)}</td><td class="num">${moneyFr(row.inflows)}</td><td class="num">${moneyFr(row.outflows)}</td><td class="num">${moneyFr(row.closing_balance)}</td></tr>`).join('')}
  </tbody></table><p class="notice">Document de gestion previsionnel - ne remplace pas les documents comptables.</p></body></html>`;
}

async function sendForecastExport(res, forecast, format) {
  if (format === 'pdf') {
    const pdf = await renderHtmlToPdf(cashflowHtml(forecast), { format: 'A4' });
    return sendPdf(res, pdf, `previsionnel-tresorerie-${forecast.start_date}.pdf`);
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="previsionnel-tresorerie-${forecast.start_date}.csv"`);
  return res.send(`\ufeff${forecastCsv(forecast)}`);
}

module.exports = {
  forecastItems,
  getDashboard,
  getDistrimer,
  getForecast,
  getSettings,
  listBankTransactions,
  listBankAccounts,
  listRecurringCharges,
  listChargeHistory,
  supplierExposure,
  debugCounts,
  listCustomerReceivables,
  listPaidCustomerHistory,
  listSupplierPayables,
  sendForecastExport,
  simulateDistrimerPayment,
  updateSettings,
  latestDiagnostics,
  chargeCompletionAlerts,
  calculateCustomerBehaviour,
  settingsForDistrimer,
  isDistrimerInvoice,
  normalizeName,
};
