const { PennylaneApiError, createPennylaneClient } = require('./client');
const { getPennylaneConfig } = require('./config');
const { writeSyncLog } = require('./syncQueue');
const { analyzePennylaneSupplierInvoice } = require('../supplierInvoiceMatchingEngine');

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CHANGELOG_LIMIT = 1000;
const DEFAULT_INITIAL_SYNC_DAYS = 7;
const SUPPLIER_INVOICE_SYNC_RESOURCE = 'supplier_invoices';

const ALTA_STATUSES = new Set([
  'nouvelle',
  'a_rapprocher',
  'analyse_automatique',
  'en_controle',
  'conforme',
  'ecart_prix',
  'ecart_quantite',
  'ecart_tva',
  'bl_manquant',
  'article_inconnu',
  'controle_manuel',
  'litige',
  'refusee',
  'validee_a_payer',
  'payee',
]);

function redactSensitivePayload(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactSensitivePayload);

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (/authorization|api[_-]?token|access[_-]?token|refresh[_-]?token|secret/i.test(key)) {
        return [key, '[REDACTED]'];
      }

      return [key, redactSensitivePayload(entry)];
    })
  );
}

function sanitizePennylaneError(err) {
  if (err instanceof PennylaneApiError) {
    return {
      message: err.message,
      status: err.status,
      code: err.code,
      responseBody: redactSensitivePayload(err.responseBody),
    };
  }

  return { message: err.message || 'Erreur Pennylane inattendue' };
}

function shortStack(err) {
  return String(err?.stack || '')
    .split('\n')
    .slice(0, 6)
    .join('\n');
}

function decorateSupplierInvoiceImportError(err, context = {}) {
  err.supplierInvoiceImportContext = {
    ...(err.supplierInvoiceImportContext || {}),
    ...context,
  };
  return err;
}

function logSupplierInvoiceImportError(err, context = {}) {
  const importContext = {
    ...(err?.supplierInvoiceImportContext || {}),
    ...context,
  };

  console.error('[Pennylane supplier invoice import] ERREUR', {
    pennylane_invoice_id: importContext.pennylaneInvoiceId ? String(importContext.pennylaneInvoiceId) : null,
    local_invoice_id: importContext.localInvoiceId || null,
    etape: importContext.step || 'unknown',
    message: err?.message || 'Erreur inconnue',
    code: err?.code || null,
    detail: err?.detail || null,
    stack: shortStack(err),
  });
}

function logSupplierInvoiceStatusFlow(step, payload = {}) {
  console.info('[Pennylane supplier invoice status flow]', {
    step,
    ...payload,
  });
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function toDateOrNull(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function firstPresent(object, keys) {
  if (!object || typeof object !== 'object') return null;

  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null && object[key] !== '') {
      return object[key];
    }
  }

  return null;
}

function nestedFirstPresent(object, keys) {
  const direct = firstPresent(object, keys);
  if (direct !== null && direct !== undefined && direct !== '') return direct;
  if (!object || typeof object !== 'object') return null;

  for (const value of Object.values(object)) {
    if (value && typeof value === 'object') {
      const nested = nestedFirstPresent(value, keys);
      if (nested !== null && nested !== undefined && nested !== '') return nested;
    }
  }

  return null;
}

function hasFilledText(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function extractList(responseBody) {
  if (!responseBody || typeof responseBody !== 'object') return [];
  if (Array.isArray(responseBody.items)) return responseBody.items;
  if (Array.isArray(responseBody.data)) return responseBody.data;
  if (Array.isArray(responseBody.supplier_invoices)) return responseBody.supplier_invoices;
  if (Array.isArray(responseBody.invoice_lines)) return responseBody.invoice_lines;
  if (Array.isArray(responseBody.supplier_invoice_lines)) return responseBody.supplier_invoice_lines;
  if (Array.isArray(responseBody.lines)) return responseBody.lines;
  if (Array.isArray(responseBody.changes)) return responseBody.changes;
  if (responseBody.data && typeof responseBody.data === 'object') return extractList(responseBody.data);
  if (responseBody.invoice_lines && typeof responseBody.invoice_lines === 'object') return extractList(responseBody.invoice_lines);
  if (responseBody.supplier_invoice_lines && typeof responseBody.supplier_invoice_lines === 'object') return extractList(responseBody.supplier_invoice_lines);
  return [];
}

function hasMore(responseBody) {
  return Boolean(responseBody?.has_more || responseBody?.meta?.has_more);
}

function nextCursor(responseBody) {
  return responseBody?.next_cursor || responseBody?.meta?.next_cursor || null;
}

function extractInvoice(responseBody) {
  if (!responseBody || typeof responseBody !== 'object') return null;
  if (responseBody.id) return responseBody;
  if (responseBody.supplier_invoice?.id) return responseBody.supplier_invoice;
  if (responseBody.data?.id) return responseBody.data;
  return null;
}

function extractChangeResourceId(change) {
  return (
    firstPresent(change, ['resource_id', 'supplier_invoice_id', 'id']) ||
    firstPresent(change?.resource || {}, ['id']) ||
    firstPresent(change?.object || {}, ['id'])
  );
}

function extractChangeOperation(change) {
  return String(firstPresent(change, ['operation', 'event', 'action']) || 'update').toLowerCase();
}

function extractProcessedAt(change) {
  return firstPresent(change, ['processed_at', 'created_at', 'updated_at']);
}

function initialStartDate() {
  const days = Number(process.env.PENNYLANE_SUPPLIER_INVOICE_SYNC_INITIAL_DAYS) || DEFAULT_INITIAL_SYNC_DAYS;
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Math.max(1, Math.min(days, 28)));
  return date.toISOString();
}

function buildChangelogEndpoint({ startDate, cursor, limit }) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));

  if (cursor) {
    params.set('cursor', cursor);
  } else if (startDate) {
    params.set('start_date', startDate);
  }

  return `/changelogs/supplier_invoices?${params.toString()}`;
}

function normalizeAltaStatus(currentStatus, invoice, supplierId) {
  if (currentStatus && ALTA_STATUSES.has(currentStatus) && currentStatus !== 'nouvelle') {
    return currentStatus;
  }

  if (invoice.paid === true || invoice.payment_status === 'paid') return 'payee';
  if (!supplierId) return 'a_rapprocher';
  return 'a_rapprocher';
}

function normalizeSupplierId(invoice) {
  const direct = firstPresent(invoice, [
    'supplier_id',
    'pennylane_supplier_id',
    'thirdparty_id',
    'provider_id',
    'vendor_id',
    'source_id',
    'remote_id',
  ]);
  if (direct) return direct;

  const supplier = invoice?.supplier;
  if (typeof supplier === 'string' || typeof supplier === 'number') return supplier;
  if (supplier && typeof supplier === 'object') {
    return firstPresent(supplier, [
      'id',
      'supplier_id',
      'pennylane_supplier_id',
      'thirdparty_id',
      'provider_id',
      'vendor_id',
      'source_id',
      'remote_id',
    ]);
  }

  return nestedFirstPresent(invoice, ['supplier_id']);
}

function normalizeEInvoicing(invoice) {
  const eInvoicing = invoice?.e_invoicing || {};
  return {
    status: firstPresent(eInvoicing, ['status']),
    reason: firstPresent(eInvoicing, ['reason']),
    flowId: firstPresent(eInvoicing.flow || {}, ['id']) || firstPresent(eInvoicing, ['flow_id']),
  };
}

function buildIncomingStatusSnapshot(invoice) {
  return {
    pennylane_supplier_invoice_id: invoice?.id ? String(invoice.id) : null,
    payment_status: firstPresent(invoice, ['payment_status']),
    paid: invoice?.paid === true,
    raw_paid: invoice?.paid ?? null,
    accounting_status: firstPresent(invoice, ['accounting_status']),
  };
}

function buildLocalStatusSnapshot(row) {
  if (!row) return null;

  return {
    local_invoice_id: row.id || null,
    payment_status: row.payment_status || null,
    paid: row.paid ?? null,
    accounting_status: row.accounting_status || null,
    alta_business_status: row.alta_business_status || null,
    match_status: row.match_status || null,
    auto_match_status: row.auto_match_status || null,
    updated_at: row.updated_at || null,
    last_synced_at: row.last_synced_at || null,
  };
}

function summarizeChanges(changes) {
  return changes
    .map((change) => ({
      resource_id: extractChangeResourceId(change) ? String(extractChangeResourceId(change)) : null,
      operation: extractChangeOperation(change),
      processed_at: extractProcessedAt(change) || null,
    }))
    .filter((change) => change.resource_id)
    .slice(0, 20);
}

async function listStoresToSync(db, storeId = null) {
  if (storeId) return [{ store_id: storeId }];

  const result = await db.query(
    `
    SELECT DISTINCT store_id
    FROM suppliers
    WHERE store_id IS NOT NULL
      AND pennylane_supplier_id IS NOT NULL
    ORDER BY store_id
    `
  );

  return result.rows;
}

async function getSyncState(db, storeId) {
  const result = await db.query(
    `
    INSERT INTO pennylane_supplier_invoice_sync_state(store_id, resource, last_processed_at)
    VALUES($1, $2, NULL)
    ON CONFLICT (store_id, resource) DO UPDATE
    SET updated_at = pennylane_supplier_invoice_sync_state.updated_at
    RETURNING *
    `,
    [storeId, SUPPLIER_INVOICE_SYNC_RESOURCE]
  );

  return result.rows[0];
}

async function markSyncStateProcessing(db, state, workerId) {
  await db.query(
    `
    UPDATE pennylane_supplier_invoice_sync_state
    SET sync_status = 'processing',
      locked_at = now(),
      locked_by = $3,
      last_error = NULL,
      updated_at = now()
    WHERE store_id = $1
      AND resource = $2
    `,
    [state.store_id, state.resource, workerId]
  );
}

async function markSyncStateSuccess(db, state, { lastProcessedAt, cursor }) {
  await db.query(
    `
    UPDATE pennylane_supplier_invoice_sync_state
    SET sync_status = 'success',
      last_processed_at = COALESCE($3::timestamptz, last_processed_at),
      cursor = $4,
      locked_at = NULL,
      locked_by = NULL,
      last_error = NULL,
      updated_at = now()
    WHERE store_id = $1
      AND resource = $2
    `,
    [state.store_id, state.resource, lastProcessedAt || null, cursor || null]
  );
}

async function markSyncStateFailure(db, state, err) {
  const error = sanitizePennylaneError(err);
  await db.query(
    `
    UPDATE pennylane_supplier_invoice_sync_state
    SET sync_status = 'failed',
      locked_at = NULL,
      locked_by = NULL,
      last_error = $3,
      updated_at = now()
    WHERE store_id = $1
      AND resource = $2
    `,
    [state.store_id, state.resource, error.message]
  );

  await writeSyncLog(db, {
    storeId: state.store_id,
    status: 'failed',
    message: 'Synchronisation entrante des factures fournisseurs Pennylane en echec.',
    responsePayload: error.responseBody || error,
    errorCode: error.code || (error.status ? `HTTP_${error.status}` : null),
  });
}

async function findAltaSupplier(db, storeId, pennylaneSupplierId) {
  if (!pennylaneSupplierId) return null;

  const result = await db.query(
    `
    SELECT id
    FROM suppliers
    WHERE store_id = $1
      AND pennylane_supplier_id::text = $2::text
    LIMIT 1
    `,
    [storeId, String(pennylaneSupplierId)]
  );

  return result.rows[0]?.id || null;
}

async function listInvoicesMissingSupplier(db, storeId, limit = 50) {
  const result = await db.query(
    `
    SELECT
      psi.pennylane_supplier_invoice_id,
      'missing_supplier_id' AS reason
    FROM pennylane_supplier_invoices psi
    WHERE psi.store_id = $1
      AND psi.pennylane_deleted_at IS NULL
      AND psi.supplier_id IS NULL
      AND NULLIF(TRIM(COALESCE(psi.pennylane_supplier_id, '')), '') IS NOT NULL
      AND (psi.invoice_date IS NULL OR psi.invoice_date >= CURRENT_DATE - INTERVAL '90 days')
    ORDER BY psi.last_synced_at ASC NULLS FIRST, psi.created_at ASC
    LIMIT $2
    `,
    [storeId, limit]
  );

  return result.rows
    .filter((row) => row.pennylane_supplier_invoice_id)
    .map((row) => ({
      pennylaneInvoiceId: row.pennylane_supplier_invoice_id,
      reason: row.reason || 'incomplete',
    }));
}

async function markInvoiceDeleted(db, storeId, pennylaneInvoiceId) {
  await db.query(
    `
    UPDATE pennylane_supplier_invoices
    SET sync_status = 'deleted',
      pennylane_deleted_at = now(),
      last_synced_at = now(),
      updated_at = now()
    WHERE store_id = $1
      AND pennylane_supplier_invoice_id = $2
    `,
    [storeId, String(pennylaneInvoiceId)]
  );
}

async function upsertInvoice(db, { storeId, invoice, reason }) {
  const pennylaneSupplierId = normalizeSupplierId(invoice);
  const supplierId = await findAltaSupplier(db, storeId, pennylaneSupplierId);
  const eInvoicing = normalizeEInvoicing(invoice);
  const incomingStatus = buildIncomingStatusSnapshot(invoice);
  let localInvoiceId = null;
  let currentStep = 'update_invoice';

  try {
    const existing = await db.query(
      `
      SELECT
        id,
        accounting_status,
        payment_status,
        paid,
        alta_business_status,
        match_status,
        auto_match_status,
        updated_at,
        last_synced_at
      FROM pennylane_supplier_invoices
      WHERE store_id = $1
        AND pennylane_supplier_invoice_id = $2
      LIMIT 1
      `,
      [storeId, String(invoice.id)]
    );
    const existingRow = existing.rows[0] || null;
    const altaBusinessStatus = normalizeAltaStatus(existingRow?.alta_business_status, invoice, supplierId);

    logSupplierInvoiceStatusFlow('before_upsert', {
      store_id: storeId,
      reason: reason || 'sync',
      pennylane_supplier_invoice_id: String(invoice.id),
      received: incomingStatus,
      existing: buildLocalStatusSnapshot(existingRow),
      update_payload: {
        accounting_status: firstPresent(invoice, ['accounting_status']),
        payment_status: firstPresent(invoice, ['payment_status']),
        paid: invoice.paid === true,
        alta_business_status: altaBusinessStatus,
        payment_status_included_in_upsert: true,
        paid_included_in_upsert: true,
        accounting_status_included_in_upsert: true,
      },
      payment_status_will_change: (existingRow?.payment_status || null) !== (incomingStatus.payment_status || null),
      paid_will_change: existingRow ? existingRow.paid !== incomingStatus.paid : true,
    });

    const upserted = await db.query(
      `
      INSERT INTO pennylane_supplier_invoices(
        id, store_id, pennylane_supplier_invoice_id, pennylane_supplier_id, supplier_id,
        invoice_number, invoice_date, due_date, currency,
        amount_ex_vat, amount_vat, amount_inc_vat,
        currency_amount_ex_vat, currency_amount_vat, currency_amount_inc_vat,
        remaining_amount_with_tax, remaining_amount_without_tax,
        accounting_status, payment_status, paid,
        e_invoice_status, e_invoice_reason, e_invoice_flow_id,
        pennylane_filename, public_file_url, external_reference,
        alta_business_status, sync_status, raw_payload, last_synced_at
      )
      VALUES(
        gen_random_uuid(), $1, $2, $3, $4,
        $5, $6::date, $7::date, $8,
        $9, $10, $11,
        $12, $13, $14,
        $15, $16,
        $17, $18, $19,
        $20, $21, $22,
        $23, $24, $25,
        $26, 'synced', $27::jsonb, now()
      )
      ON CONFLICT (store_id, pennylane_supplier_invoice_id) DO UPDATE
      SET pennylane_supplier_id = EXCLUDED.pennylane_supplier_id,
        supplier_id = EXCLUDED.supplier_id,
        invoice_number = EXCLUDED.invoice_number,
        invoice_date = EXCLUDED.invoice_date,
        due_date = EXCLUDED.due_date,
        currency = EXCLUDED.currency,
        amount_ex_vat = EXCLUDED.amount_ex_vat,
        amount_vat = EXCLUDED.amount_vat,
        amount_inc_vat = EXCLUDED.amount_inc_vat,
        currency_amount_ex_vat = EXCLUDED.currency_amount_ex_vat,
        currency_amount_vat = EXCLUDED.currency_amount_vat,
        currency_amount_inc_vat = EXCLUDED.currency_amount_inc_vat,
        remaining_amount_with_tax = EXCLUDED.remaining_amount_with_tax,
        remaining_amount_without_tax = EXCLUDED.remaining_amount_without_tax,
        accounting_status = EXCLUDED.accounting_status,
        payment_status = EXCLUDED.payment_status,
        paid = EXCLUDED.paid,
        e_invoice_status = EXCLUDED.e_invoice_status,
        e_invoice_reason = EXCLUDED.e_invoice_reason,
        e_invoice_flow_id = EXCLUDED.e_invoice_flow_id,
        pennylane_filename = EXCLUDED.pennylane_filename,
        public_file_url = EXCLUDED.public_file_url,
        external_reference = EXCLUDED.external_reference,
        alta_business_status = CASE
          WHEN pennylane_supplier_invoices.alta_business_status IN ('validee_a_payer', 'payee', 'litige', 'refusee')
            THEN pennylane_supplier_invoices.alta_business_status
          ELSE EXCLUDED.alta_business_status
        END,
        sync_status = 'synced',
        pennylane_deleted_at = NULL,
        raw_payload = EXCLUDED.raw_payload,
        last_synced_at = now(),
        updated_at = now()
      RETURNING
        id,
        accounting_status,
        payment_status,
        paid,
        alta_business_status,
        match_status,
        auto_match_status,
        updated_at,
        last_synced_at
      `,
      [
        storeId,
        String(invoice.id),
        pennylaneSupplierId ? String(pennylaneSupplierId) : null,
        supplierId,
        firstPresent(invoice, ['invoice_number', 'number']),
        toDateOrNull(firstPresent(invoice, ['date', 'invoice_date'])),
        toDateOrNull(firstPresent(invoice, ['deadline', 'due_date'])),
        firstPresent(invoice, ['currency']) || 'EUR',
        toNumberOrNull(firstPresent(invoice, ['amount_before_tax', 'amount_ex_vat'])),
        toNumberOrNull(firstPresent(invoice, ['tax'])),
        toNumberOrNull(firstPresent(invoice, ['amount'])),
        toNumberOrNull(firstPresent(invoice, ['currency_amount_before_tax'])),
        toNumberOrNull(firstPresent(invoice, ['currency_tax'])),
        toNumberOrNull(firstPresent(invoice, ['currency_amount'])),
        toNumberOrNull(firstPresent(invoice, ['remaining_amount_with_tax'])),
        toNumberOrNull(firstPresent(invoice, ['remaining_amount_without_tax'])),
        firstPresent(invoice, ['accounting_status']),
        firstPresent(invoice, ['payment_status']),
        invoice.paid === true,
        eInvoicing.status,
        eInvoicing.reason,
        eInvoicing.flowId,
        firstPresent(invoice, ['filename']),
        firstPresent(invoice, ['public_file_url']),
        firstPresent(invoice, ['external_reference']),
        altaBusinessStatus,
        JSON.stringify(invoice),
      ]
    );

    const returnedRow = upserted.rows[0];
    localInvoiceId = returnedRow.id;

    logSupplierInvoiceStatusFlow('after_upsert_returning', {
      store_id: storeId,
      reason: reason || 'sync',
      pennylane_supplier_invoice_id: String(invoice.id),
      local_invoice_id: localInvoiceId,
      previous: buildLocalStatusSnapshot(existingRow),
      returned: buildLocalStatusSnapshot(returnedRow),
      payment_status_changed_in_db: (existingRow?.payment_status || null) !== (returnedRow.payment_status || null),
      paid_changed_in_db: existingRow ? existingRow.paid !== returnedRow.paid : true,
      alta_business_status_changed_in_db: (existingRow?.alta_business_status || null) !== (returnedRow.alta_business_status || null),
    });

    await db.query(
      `
      DELETE FROM pennylane_supplier_invoice_lines
      WHERE supplier_invoice_id = $1
        AND store_id = $2
      `,
      [localInvoiceId, storeId]
    );

    return localInvoiceId;
  } catch (err) {
    throw decorateSupplierInvoiceImportError(err, {
      pennylaneInvoiceId: invoice?.id,
      localInvoiceId,
      step: err.supplierInvoiceImportContext?.step || currentStep,
    });
  }
}

async function rerunSupplierInvoiceMatching(db, { storeId, localInvoiceId, pennylaneInvoiceId, reason }) {
  try {
    const result = await analyzePennylaneSupplierInvoice(db, {
      invoiceId: localInvoiceId,
      storeId,
    });
    console.info('[Pennylane supplier invoice import] analyse relancee apres import entete', {
      store_id: storeId,
      invoice_id: String(pennylaneInvoiceId),
      local_invoice_id: localInvoiceId,
      reason,
      result,
    });
  } catch (err) {
    logSupplierInvoiceImportError(err, {
      pennylaneInvoiceId,
      localInvoiceId,
      step: 'matching',
    });
    console.error('[Pennylane supplier invoice import] erreur relance analyse apres import entete', {
      store_id: storeId,
      invoice_id: String(pennylaneInvoiceId),
      local_invoice_id: localInvoiceId,
      reason,
      message: err.message,
    });
  }
}

async function syncSupplierInvoiceById(db, pennylaneClient, storeId, pennylaneInvoiceId, options = {}) {
  let invoice = null;
  let localInvoiceId = null;
  let currentStep = 'fetch_invoice';

  try {
    const response = await pennylaneClient.get(`/supplier_invoices/${encodeURIComponent(pennylaneInvoiceId)}`);
    invoice = extractInvoice(response.body);
    if (!invoice?.id) throw new Error('Pennylane n a pas retourne de facture fournisseur exploitable');

    const reason = options.reason || 'sync';
    logSupplierInvoiceStatusFlow('after_pennylane_fetch', {
      store_id: storeId,
      reason,
      pennylane_supplier_invoice_id: String(invoice.id),
      payment_status: firstPresent(invoice, ['payment_status']),
      paid: invoice.paid === true,
      raw_paid: invoice.paid ?? null,
      accounting_status: firstPresent(invoice, ['accounting_status']),
    });
    console.info('[Pennylane supplier invoice import] header only', {
      invoice_id: String(invoice.id),
      reason,
      public_file_url_present: Boolean(firstPresent(invoice, ['public_file_url'])),
    });
    currentStep = 'update_invoice';
    localInvoiceId = await upsertInvoice(db, { storeId, invoice, reason });

    if (options.rerunMatching) {
      currentStep = 'matching';
      await rerunSupplierInvoiceMatching(db, {
        storeId,
        localInvoiceId,
        pennylaneInvoiceId: invoice.id,
        reason,
      });
    }

    return { synced: true };
  } catch (err) {
    const decorated = decorateSupplierInvoiceImportError(err, {
      pennylaneInvoiceId: invoice?.id || pennylaneInvoiceId,
      localInvoiceId: err.supplierInvoiceImportContext?.localInvoiceId || localInvoiceId,
      step: err.supplierInvoiceImportContext?.step || currentStep,
    });
    logSupplierInvoiceImportError(decorated);
    throw decorated;
  }
}

async function syncSupplierInvoiceChange(db, pennylaneClient, storeId, change) {
  const pennylaneInvoiceId = extractChangeResourceId(change);
  if (!pennylaneInvoiceId) return { skipped: true };

  const operation = extractChangeOperation(change);
  if (operation === 'delete') {
    await markInvoiceDeleted(db, storeId, String(pennylaneInvoiceId));
    return { deleted: true };
  }

  return syncSupplierInvoiceById(db, pennylaneClient, storeId, pennylaneInvoiceId, {
    reason: 'changelog',
  });
}

async function processStoreSupplierInvoiceSync(db, pennylaneClient, storeId, options = {}) {
  const state = await getSyncState(db, storeId);
  const workerId = options.workerId || `pennylane-supplier-invoice-import-${process.pid}`;
  const limit = Number(options.limit || process.env.PENNYLANE_SUPPLIER_INVOICE_CHANGELOG_LIMIT) || DEFAULT_CHANGELOG_LIMIT;
  const startDate = state.cursor ? null : state.last_processed_at?.toISOString?.() || state.last_processed_at || initialStartDate();

  logSupplierInvoiceStatusFlow('store_sync_start', {
    store_id: storeId,
    worker_id: workerId,
    resource: state.resource,
    state_status: state.sync_status || null,
    cursor_present: Boolean(state.cursor),
    last_processed_at: state.last_processed_at || null,
    start_date: startDate || null,
    limit,
  });

  await markSyncStateProcessing(db, state, workerId);

  let cursor = state.cursor || null;
  let lastProcessedAt = null;
  let processed = 0;
  let succeeded = 0;
  let deleted = 0;
  let failed = 0;

  try {
    do {
      const endpoint = buildChangelogEndpoint({ startDate, cursor, limit });
      const response = await pennylaneClient.get(endpoint);
      const changes = extractList(response.body);

      logSupplierInvoiceStatusFlow('changelog_page', {
        store_id: storeId,
        endpoint,
        changes_count: changes.length,
        changes_sample: summarizeChanges(changes),
        has_more: hasMore(response.body),
        next_cursor_present: Boolean(nextCursor(response.body)),
      });

      for (const change of changes) {
        processed += 1;
        try {
          const result = await syncSupplierInvoiceChange(db, pennylaneClient, storeId, change);
          if (result.deleted) deleted += 1;
          if (result.synced) succeeded += 1;
        } catch (err) {
          failed += 1;
          const error = sanitizePennylaneError(err);
          await writeSyncLog(db, {
            storeId,
            status: 'failed',
            message: 'Erreur synchronisation facture fournisseur Pennylane.',
            requestPayload: { change },
            responsePayload: error.responseBody || error,
            errorCode: error.code || (error.status ? `HTTP_${error.status}` : null),
          });
        }

        lastProcessedAt = extractProcessedAt(change) || lastProcessedAt;
      }

      cursor = hasMore(response.body) ? nextCursor(response.body) : null;
      await markSyncStateSuccess(db, state, { lastProcessedAt: null, cursor });
    } while (cursor);

    const invoicesMissingSupplier = await listInvoicesMissingSupplier(db, storeId);
    logSupplierInvoiceStatusFlow('missing_supplier_retry_candidates', {
      store_id: storeId,
      candidates_count: invoicesMissingSupplier.length,
      candidates_sample: invoicesMissingSupplier.slice(0, 20),
    });

    for (const incompleteInvoice of invoicesMissingSupplier) {
      processed += 1;
      try {
        await syncSupplierInvoiceById(db, pennylaneClient, storeId, incompleteInvoice.pennylaneInvoiceId, {
          reason: incompleteInvoice.reason,
          rerunMatching: true,
        });
        succeeded += 1;
      } catch (err) {
        failed += 1;
        const error = sanitizePennylaneError(err);
        await writeSyncLog(db, {
          storeId,
          status: 'failed',
          message: 'Erreur reimport facture fournisseur Pennylane incomplete.',
          requestPayload: {
            pennylane_supplier_invoice_id: incompleteInvoice.pennylaneInvoiceId,
            reason: incompleteInvoice.reason,
          },
          responsePayload: error.responseBody || error,
          errorCode: error.code || (error.status ? `HTTP_${error.status}` : null),
        });
      }
    }

    await markSyncStateSuccess(db, state, { lastProcessedAt, cursor: null });
    return { processed, succeeded, deleted, failed };
  } catch (err) {
    await markSyncStateFailure(db, state, err);
    throw err;
  }
}

async function processPennylaneSupplierInvoiceImportSync(db, options = {}) {
  const pennylaneConfig = getPennylaneConfig();
  const batchSize = Number(options.batchSize || process.env.PENNYLANE_SUPPLIER_INVOICE_STORE_BATCH_SIZE) || DEFAULT_BATCH_SIZE;

  if (!pennylaneConfig.enabled) {
    logSupplierInvoiceStatusFlow('service_skipped', {
      reason: 'PENNYLANE_DISABLED',
      worker_id: options.workerId || null,
    });
    return { processed: 0, succeeded: 0, deleted: 0, failed: 0, skipped: true, reason: 'PENNYLANE_DISABLED' };
  }

  if (!pennylaneConfig.apiToken) {
    logSupplierInvoiceStatusFlow('service_skipped', {
      reason: 'PENNYLANE_TOKEN_MISSING',
      worker_id: options.workerId || null,
    });
    return { processed: 0, succeeded: 0, deleted: 0, failed: 0, skipped: true, reason: 'PENNYLANE_TOKEN_MISSING' };
  }

  const pennylaneClient = createPennylaneClient(pennylaneConfig);
  const stores = (await listStoresToSync(db, options.storeId)).slice(0, batchSize);
  let processed = 0;
  let succeeded = 0;
  let deleted = 0;
  let failed = 0;

  logSupplierInvoiceStatusFlow('service_start', {
    worker_id: options.workerId || null,
    requested_store_id: options.storeId || null,
    batch_size: batchSize,
    stores_count: stores.length,
    store_ids: stores.map((store) => store.store_id).slice(0, 50),
  });

  for (const store of stores) {
    try {
      const result = await processStoreSupplierInvoiceSync(db, pennylaneClient, store.store_id, options);
      processed += result.processed;
      succeeded += result.succeeded;
      deleted += result.deleted;
      failed += result.failed;
    } catch (err) {
      failed += 1;
    }
  }

  return {
    processed,
    succeeded,
    deleted,
    failed,
    skipped: false,
  };
}

module.exports = {
  processPennylaneSupplierInvoiceImportSync,
};
