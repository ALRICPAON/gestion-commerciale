const { PennylaneApiError, createPennylaneClient } = require('./client');
const { getPennylaneConfig } = require('./config');
const { writeSyncLog } = require('./syncQueue');

const CUSTOMER_INVOICE_ENTITY_TYPE = 'customer_invoice';
const CUSTOMER_INVOICE_CREATE_ACTION = 'customer_invoice.create';
const CUSTOMER_INVOICE_UPDATE_ACTION = 'customer_invoice.update';
const DEFAULT_BATCH_SIZE = 10;
const MAX_BACKOFF_MINUTES = 60;
const CLIENT_NOT_READY_DELAY_MINUTES = 5;
const DRAFT_RECHECK_DELAY_MINUTES = 10;
const FINALIZED_STATUSES = new Set(['validated', 'finalized', 'sent', 'paid', 'partially_paid', 'overdue']);

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== '';
    })
  );
}

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

function buildJsonFilter(field, operator, value) {
  return encodeURIComponent(JSON.stringify([{ field, operator, value }]));
}

function buildExternalReference(invoice) {
  return `alta:${invoice.store_id}:${CUSTOMER_INVOICE_ENTITY_TYPE}:${invoice.id}`;
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

  return {
    message: err.message || 'Erreur Pennylane inattendue',
  };
}

function getRetryDelayMinutes(attempts) {
  const delay = 2 ** Math.max(attempts - 1, 0);
  return Math.min(delay, MAX_BACKOFF_MINUTES);
}

function toMoneyString(value) {
  const amount = Number(value || 0);
  return amount.toFixed(2);
}

function toIsoDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function paymentTermDays(value) {
  const text = String(value || '').toLowerCase();
  const match = text.match(/(\d+)/);
  if (match) return Number(match[1]);
  if (text.includes('comptant') || text.includes('reception') || text.includes('réception')) return 0;
  return 30;
}

function isFinalizedInvoice(invoice) {
  return (
    invoice &&
    String(invoice.document_type || '').toUpperCase() === 'INVOICE' &&
    FINALIZED_STATUSES.has(String(invoice.status || '').toLowerCase())
  );
}

function normalizeVatRate(value, invoice) {
  if (invoice.is_vat_exempt_snapshot) return 'exempt';

  const rate = Number(value ?? invoice.vat_rate_snapshot ?? 0);
  if (!Number.isFinite(rate) || rate <= 0) return 'exempt';

  const code = Math.round(rate * 10).toString();
  return `FR_${code}`;
}

function normalizeUnit(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['kg', 'kilo', 'kilogramme', 'kilogrammes'].includes(text)) return 'kg';
  if (['piece', 'pieces', 'pièce', 'pièces', 'unite', 'unité', 'unit'].includes(text)) return 'piece';
  return text || 'piece';
}

function lineQuantity(line) {
  const candidates = [line.sold_quantity, line.total_weight, line.package_count, 1];
  const quantity = candidates.map(Number).find((value) => Number.isFinite(value) && value > 0);
  return quantity || 1;
}

function buildStandardInvoiceLinePayload(line, invoice) {
  const quantity = lineQuantity(line);
  const unitPrice = Number(line.unit_sale_price_ht ?? 0);

  return {
    label: line.article_label || `Ligne ${line.line_number || ''}`.trim(),
    quantity,
    unit: normalizeUnit(line.sale_unit),
    raw_currency_unit_price: toMoneyString(unitPrice),
    vat_rate: normalizeVatRate(line.vat_rate, invoice),
  };
}

function buildPennylaneCustomerInvoicePayload(invoice, lines) {
  const date = toIsoDate(invoice.document_date);
  const deadline = toIsoDate(invoice.payment_due_date || invoice.due_date || addDays(date, paymentTermDays(invoice.client_payment_terms)));

  return compactObject({
    customer_id: Number(invoice.pennylane_customer_id),
    date,
    deadline,
    invoice_lines: lines.map((line) => buildStandardInvoiceLinePayload(line, invoice)),
    external_reference: buildExternalReference(invoice),
  });
}

function extractInvoice(responseBody) {
  if (!responseBody || typeof responseBody !== 'object') return null;
  if (responseBody.id) return responseBody;
  if (responseBody.customer_invoice?.id) return responseBody.customer_invoice;
  if (responseBody.data?.id) return responseBody.data;
  return null;
}

function extractInvoiceList(responseBody) {
  if (!responseBody || typeof responseBody !== 'object') return [];
  if (Array.isArray(responseBody.items)) return responseBody.items;
  if (Array.isArray(responseBody.data)) return responseBody.data;
  if (Array.isArray(responseBody.customer_invoices)) return responseBody.customer_invoices;
  return [];
}

function getInvoiceId(responseBody) {
  const invoice = extractInvoice(responseBody);
  return invoice?.id ? String(invoice.id) : null;
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

function toNullableMoney(value) {
  if (value === undefined || value === null || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : null;
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function sumPennylanePayments(payments) {
  if (!Array.isArray(payments)) return null;

  const total = payments.reduce((sum, payment) => {
    const amount = toNumberOrNull(firstPresent(payment, [
      'amount',
      'currency_amount',
      'amount_with_tax',
      'amount_without_tax',
    ]));
    return amount === null ? sum : sum + amount;
  }, 0);

  return total > 0 ? total : null;
}

function normalizePaymentStatus(invoice) {
  const rawPaymentStatus = firstPresent(invoice, ['payment_status', 'paid_status', 'payment_state']);
  if (rawPaymentStatus) return String(rawPaymentStatus);

  if (invoice.paid === true) return 'paid';

  const remainingAmount = toNumberOrNull(firstPresent(invoice, [
    'remaining_amount_with_tax',
    'remaining_amount',
    'amount_due',
    'due_amount',
    'remaining_amount_without_tax',
  ]));
  const paidAmount = toNumberOrNull(firstPresent(invoice, [
    'paid_amount_with_tax',
    'paid_amount',
    'amount_paid',
    'total_paid',
  ])) ?? sumPennylanePayments(invoice.payments);

  if (remainingAmount !== null && remainingAmount <= 0) return 'paid';
  if (paidAmount !== null && paidAmount > 0) return 'partially_paid';

  return 'unpaid';
}

function extractPennylaneInvoiceAccountingStatus(responseBody) {
  const invoice = extractInvoice(responseBody);
  if (!invoice) return null;

  const remainingAmount = toNullableMoney(firstPresent(invoice, [
    'remaining_amount_with_tax',
    'remaining_amount',
    'amount_due',
    'due_amount',
    'remaining_amount_without_tax',
  ]));
  const explicitPaidAmount = toNullableMoney(firstPresent(invoice, [
    'paid_amount_with_tax',
    'paid_amount',
    'amount_paid',
    'total_paid',
  ]));
  const paymentsPaidAmount = toNullableMoney(sumPennylanePayments(invoice.payments));
  const totalAmount = toNumberOrNull(firstPresent(invoice, [
    'amount_with_tax',
    'total_amount_with_tax',
    'amount',
    'currency_amount',
    'total',
  ]));
  const remainingNumber = toNumberOrNull(remainingAmount);
  const derivedPaidAmount = totalAmount !== null && remainingNumber !== null
    ? toNullableMoney(Math.max(totalAmount - remainingNumber, 0))
    : null;

  return {
    invoiceNumber: firstPresent(invoice, ['invoice_number', 'number']),
    paymentStatus: normalizePaymentStatus(invoice),
    paidAmount: explicitPaidAmount || paymentsPaidAmount || derivedPaidAmount || (invoice.paid === false ? '0.00' : null),
    remainingAmount,
    paidAt: firstPresent(invoice, ['paid_at', 'paid_on', 'payment_date']),
    status: firstPresent(invoice, ['status', 'state']),
  };
}

async function fetchAltaInvoice(db, storeId, invoiceId) {
  const result = await db.query(
    `
    SELECT inv.*,
      billed.pennylane_customer_id,
      billed.payment_terms AS client_payment_terms
    FROM sales_documents inv
    LEFT JOIN clients billed
      ON billed.id = COALESCE(inv.billed_client_id, inv.client_id)
     AND billed.store_id = inv.store_id
    WHERE inv.id = $1
      AND inv.store_id = $2
      AND inv.document_type = 'INVOICE'
    LIMIT 1
    `,
    [invoiceId, storeId]
  );

  return result.rows[0] || null;
}

async function fetchAltaInvoiceLines(db, storeId, invoiceId) {
  const result = await db.query(
    `
    SELECT
      id, line_number, article_label, sold_quantity, total_weight,
      package_count, sale_unit, unit_sale_price_ht, vat_rate
    FROM sales_lines
    WHERE store_id = $1
      AND sales_document_id = $2
    ORDER BY line_number ASC
    `,
    [storeId, invoiceId]
  );

  return result.rows;
}

async function findPennylaneInvoiceByExternalReference(pennylaneClient, externalReference) {
  const filter = buildJsonFilter('external_reference', 'eq', externalReference);
  const response = await pennylaneClient.get(`/customer_invoices?limit=1&filter=${filter}`);
  const [invoice] = extractInvoiceList(response.body);
  return invoice || null;
}

async function refreshPennylaneInvoiceStatus(pennylaneClient, pennylaneInvoiceId) {
  const response = await pennylaneClient.get(`/customer_invoices/${pennylaneInvoiceId}`);

  return {
    response,
    payload: null,
    pennylaneInvoiceId: getInvoiceId(response.body) || String(pennylaneInvoiceId),
    mode: 'refresh_status',
  };
}

async function upsertPennylaneInvoice({ pennylaneClient, invoice, lines }) {
  if (invoice.pennylane_invoice_id) {
    return refreshPennylaneInvoiceStatus(pennylaneClient, invoice.pennylane_invoice_id);
  }

  const payload = buildPennylaneCustomerInvoicePayload(invoice, lines);
  const existingInvoice = await findPennylaneInvoiceByExternalReference(pennylaneClient, payload.external_reference);

  if (existingInvoice?.id) {
    return refreshPennylaneInvoiceStatus(pennylaneClient, existingInvoice.id);
  }

  try {
    const response = await pennylaneClient.post('/customer_invoices', payload);
    return {
      response,
      payload,
      pennylaneInvoiceId: getInvoiceId(response.body),
      mode: 'create',
    };
  } catch (err) {
    if (!(err instanceof PennylaneApiError) || ![409, 422].includes(err.status)) {
      throw err;
    }

    const conflictedInvoice = await findPennylaneInvoiceByExternalReference(pennylaneClient, payload.external_reference);

    if (!conflictedInvoice?.id) {
      throw err;
    }

    return refreshPennylaneInvoiceStatus(pennylaneClient, conflictedInvoice.id);
  }
}

async function claimQueueItems(db, { batchSize, workerId }) {
  const result = await db.query(
    `
    WITH next_jobs AS (
      SELECT id
      FROM pennylane_sync_queue
      WHERE entity_type = $1
        AND action = ANY($2)
        AND status IN ('pending', 'failed')
        AND attempts < max_attempts
        AND scheduled_at <= now()
      ORDER BY priority ASC, scheduled_at ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $3
    )
    UPDATE pennylane_sync_queue q
    SET
      status = 'processing',
      attempts = q.attempts + 1,
      locked_at = now(),
      locked_by = $4,
      updated_at = now()
    FROM next_jobs
    WHERE q.id = next_jobs.id
    RETURNING q.*
    `,
    [
      CUSTOMER_INVOICE_ENTITY_TYPE,
      [CUSTOMER_INVOICE_CREATE_ACTION, CUSTOMER_INVOICE_UPDATE_ACTION],
      batchSize,
      workerId,
    ]
  );

  return result.rows;
}

async function tryAcquireInvoiceLock(db, queueItem) {
  const result = await db.query(
    `
    SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked
    `,
    ['pennylane:customer-invoice-sync', `${queueItem.store_id}:${queueItem.entity_id}`]
  );

  return Boolean(result.rows[0]?.locked);
}

async function releaseInvoiceLock(db, queueItem) {
  await db.query(
    `
    SELECT pg_advisory_unlock(hashtext($1), hashtext($2))
    `,
    ['pennylane:customer-invoice-sync', `${queueItem.store_id}:${queueItem.entity_id}`]
  );
}

async function deferQueueItem(db, queueItem, { message, delayMinutes }) {
  await db.query(
    `
    UPDATE pennylane_sync_queue
    SET
      status = 'pending',
      attempts = GREATEST(attempts - 1, 0),
      locked_at = NULL,
      locked_by = NULL,
      scheduled_at = now() + ($2 || ' minutes')::interval,
      updated_at = now()
    WHERE id = $1
    `,
    [queueItem.id, delayMinutes]
  );

  await db.query(
    `
    UPDATE sales_documents
    SET
      pennylane_sync_status = 'pending',
      pennylane_sync_last_error = $1,
      pennylane_sync_updated_at = now()
    WHERE id = $2
      AND store_id = $3
      AND document_type = 'INVOICE'
    `,
    [message, queueItem.entity_id, queueItem.store_id]
  );

  await writeSyncLog(db, {
    queueId: queueItem.id,
    storeId: queueItem.store_id,
    status: 'pending',
    message,
  });
}

async function markQueueSuccess(db, queueItem, result) {
  const accountingStatus = extractPennylaneInvoiceAccountingStatus(result.response.body);

  await db.query(
    `
    UPDATE sales_documents
    SET
      pennylane_invoice_id = $1,
      pennylane_invoice_number = COALESCE($4, pennylane_invoice_number),
      pennylane_payment_status = COALESCE($5, pennylane_payment_status),
      pennylane_paid_amount = $6,
      pennylane_remaining_amount = $7,
      pennylane_paid_at = $8,
      pennylane_status = COALESCE($9, pennylane_status),
      pennylane_last_status_synced_at = now(),
      pennylane_sync_status = 'success',
      pennylane_sync_last_error = NULL,
      pennylane_synced_at = now(),
      pennylane_sync_updated_at = now()
    WHERE id = $2
      AND store_id = $3
      AND document_type = 'INVOICE'
    `,
    [
      result.pennylaneInvoiceId,
      queueItem.entity_id,
      queueItem.store_id,
      accountingStatus?.invoiceNumber || null,
      accountingStatus?.paymentStatus || null,
      accountingStatus?.paidAmount || null,
      accountingStatus?.remainingAmount || null,
      accountingStatus?.paidAt || null,
      accountingStatus?.status || null,
    ]
  );

  await db.query(
    `
    UPDATE pennylane_sync_queue
    SET
      status = 'success',
      pennylane_reference = $2::jsonb,
      last_error = NULL,
      locked_at = NULL,
      locked_by = NULL,
      processed_at = now(),
      updated_at = now()
    WHERE id = $1
    `,
    [
      queueItem.id,
      JSON.stringify({
        customer_invoice_id: result.pennylaneInvoiceId,
        mode: result.mode,
      }),
    ]
  );

  await writeSyncLog(db, {
    queueId: queueItem.id,
    storeId: queueItem.store_id,
    status: 'success',
    message: result.mode === 'refresh_status'
      ? 'Statut facture client Pennylane rafraichi.'
      : 'Facture client creee dans Pennylane.',
    requestPayload: result.payload,
    responsePayload: redactSensitivePayload(result.response.body),
  });
}

async function markQueueFailure(db, queueItem, err) {
  const error = sanitizePennylaneError(err);
  const finalFailure = queueItem.attempts >= queueItem.max_attempts;
  const retryDelayMinutes = getRetryDelayMinutes(queueItem.attempts);

  await db.query(
    `
    UPDATE sales_documents
    SET
      pennylane_sync_status = 'failed',
      pennylane_sync_last_error = $1,
      pennylane_sync_updated_at = now()
    WHERE id = $2
      AND store_id = $3
      AND document_type = 'INVOICE'
    `,
    [error.message, queueItem.entity_id, queueItem.store_id]
  );

  await db.query(
    `
    UPDATE pennylane_sync_queue
    SET
      status = 'failed',
      last_error = $2,
      locked_at = NULL,
      locked_by = NULL,
      scheduled_at = CASE
        WHEN $3::boolean THEN scheduled_at
        ELSE now() + ($4 || ' minutes')::interval
      END,
      processed_at = CASE WHEN $3::boolean THEN now() ELSE processed_at END,
      updated_at = now()
    WHERE id = $1
    `,
    [queueItem.id, error.message, finalFailure, retryDelayMinutes]
  );

  await writeSyncLog(db, {
    queueId: queueItem.id,
    storeId: queueItem.store_id,
    status: 'failed',
    message: finalFailure
      ? 'Synchronisation facture client Pennylane en echec definitif.'
      : 'Synchronisation facture client Pennylane en echec, nouvelle tentative planifiee.',
    responsePayload: error.responseBody || error,
    errorCode: error.code || (error.status ? `HTTP_${error.status}` : null),
  });
}

async function processQueueItem(db, pennylaneClient, queueItem) {
  const lockDb = typeof db.connect === 'function' ? await db.connect() : db;
  let lockAcquired = false;

  try {
    lockAcquired = await tryAcquireInvoiceLock(lockDb, queueItem);

    if (!lockAcquired) {
      await deferQueueItem(db, queueItem, {
        message: 'Synchronisation facture client Pennylane reportee car un autre job de la meme facture est deja en cours.',
        delayMinutes: 1,
      });
      return 'deferred';
    }

    const invoice = await fetchAltaInvoice(db, queueItem.store_id, queueItem.entity_id);

    if (!invoice) {
      throw new Error('Facture client ALTA introuvable pour la synchronisation Pennylane');
    }

    if (!isFinalizedInvoice(invoice)) {
      await deferQueueItem(db, queueItem, {
        message: 'Facture client non finalisee : synchronisation Pennylane reportee.',
        delayMinutes: DRAFT_RECHECK_DELAY_MINUTES,
      });
      return 'deferred';
    }

    if (!invoice.pennylane_customer_id) {
      await deferQueueItem(db, queueItem, {
        message: 'Client Pennylane manquant : synchronisation facture client reportee.',
        delayMinutes: CLIENT_NOT_READY_DELAY_MINUTES,
      });
      return 'deferred';
    }

    await db.query(
      `
      UPDATE sales_documents
      SET
        pennylane_sync_status = 'processing',
        pennylane_sync_last_error = NULL,
        pennylane_sync_updated_at = now()
      WHERE id = $1
        AND store_id = $2
        AND document_type = 'INVOICE'
      `,
      [invoice.id, invoice.store_id]
    );

    let lines = [];

    if (!invoice.pennylane_invoice_id) {
      lines = await fetchAltaInvoiceLines(db, queueItem.store_id, queueItem.entity_id);

      if (!lines.length) {
        throw new Error('Facture client ALTA sans ligne : synchronisation Pennylane impossible');
      }
    }

    const result = await upsertPennylaneInvoice({ pennylaneClient, invoice, lines });

    if (!result.pennylaneInvoiceId) {
      throw new Error('Pennylane n a pas retourne d identifiant facture client exploitable');
    }

    await markQueueSuccess(db, queueItem, result);
    return 'success';
  } finally {
    if (lockAcquired) {
      await releaseInvoiceLock(lockDb, queueItem).catch((err) => {
        console.warn('Impossible de liberer le verrou Pennylane facture client', {
          queue_id: queueItem.id,
          entity_id: queueItem.entity_id,
          error: err.message,
        });
      });
    }

    if (lockDb !== db && typeof lockDb.release === 'function') {
      lockDb.release();
    }
  }
}

async function processPennylaneCustomerInvoiceSyncQueue(db, options = {}) {
  const pennylaneConfig = getPennylaneConfig();
  const batchSize = Number(options.batchSize || process.env.PENNYLANE_SYNC_BATCH_SIZE) || DEFAULT_BATCH_SIZE;
  const workerId = options.workerId || `pennylane-customer-invoice-worker-${process.pid}`;

  if (!pennylaneConfig.enabled) {
    return { processed: 0, succeeded: 0, failed: 0, deferred: 0, skipped: true, reason: 'PENNYLANE_DISABLED' };
  }

  if (!pennylaneConfig.apiToken) {
    return { processed: 0, succeeded: 0, failed: 0, deferred: 0, skipped: true, reason: 'PENNYLANE_TOKEN_MISSING' };
  }

  const pennylaneClient = createPennylaneClient(pennylaneConfig);
  const queueItems = await claimQueueItems(db, { batchSize, workerId });
  let succeeded = 0;
  let failed = 0;
  let deferred = 0;

  for (const queueItem of queueItems) {
    try {
      const status = await processQueueItem(db, pennylaneClient, queueItem);
      if (status === 'deferred') {
        deferred += 1;
      } else {
        succeeded += 1;
      }
    } catch (err) {
      await markQueueFailure(db, queueItem, err);
      failed += 1;
    }
  }

  return {
    processed: queueItems.length,
    succeeded,
    failed,
    deferred,
    skipped: false,
  };
}

module.exports = {
  CUSTOMER_INVOICE_CREATE_ACTION,
  CUSTOMER_INVOICE_ENTITY_TYPE,
  CUSTOMER_INVOICE_UPDATE_ACTION,
  buildPennylaneCustomerInvoicePayload,
  processPennylaneCustomerInvoiceSyncQueue,
  extractPennylaneInvoiceAccountingStatus,
};
