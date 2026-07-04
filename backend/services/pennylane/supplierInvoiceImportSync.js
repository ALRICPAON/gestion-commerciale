const { PennylaneApiError, createPennylaneClient } = require('./client');
const { getPennylaneConfig } = require('./config');
const { writeSyncLog } = require('./syncQueue');

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

function buildLinesEndpoint(invoice) {
  const url = invoice?.invoice_lines?.url;
  if (url) {
    try {
      const parsed = new URL(url);
      return `${parsed.pathname.replace('/api/external/v2', '')}${parsed.search || ''}`;
    } catch {
      // Fall back to the documented endpoint below.
    }
  }

  return `/supplier_invoices/${encodeURIComponent(invoice.id)}/invoice_lines?limit=100`;
}

function extractEmbeddedInvoiceLines(invoice) {
  const direct = extractList(invoice);
  if (direct.length) return direct;

  const invoiceLines = invoice?.invoice_lines;
  if (Array.isArray(invoiceLines)) return invoiceLines;
  if (invoiceLines && typeof invoiceLines === 'object') {
    const lines = extractList(invoiceLines);
    if (lines.length) return lines;
  }

  const supplierInvoiceLines = invoice?.supplier_invoice_lines;
  if (Array.isArray(supplierInvoiceLines)) return supplierInvoiceLines;
  if (supplierInvoiceLines && typeof supplierInvoiceLines === 'object') {
    const lines = extractList(supplierInvoiceLines);
    if (lines.length) return lines;
  }

  return [];
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

function unwrapLine(line) {
  if (!line || typeof line !== 'object') return line;
  return line.invoice_line || line.supplier_invoice_line || line.line || line;
}

function normalizeLine(inputLine, index) {
  const line = unwrapLine(inputLine);
  const label = nestedFirstPresent(line, [
    'label',
    'description',
    'designation',
    'name',
    'product_name',
    'article_name',
    'item_name',
  ]);
  const supplierReference = nestedFirstPresent(line, [
    'supplier_reference',
    'supplier_ref',
    'reference',
    'product_reference',
    'product_ref',
    'article_code',
    'sku',
    'ean',
  ]);

  return {
    pennylane_line_id: firstPresent(line, ['id', 'invoice_line_id', 'supplier_invoice_line_id']),
    e_invoice_line_id: nestedFirstPresent(line, ['e_invoice_line_id']),
    label,
    quantity: toNumberOrNull(nestedFirstPresent(line, ['quantity', 'qty', 'quantity_billed'])),
    unit: nestedFirstPresent(line, ['unit', 'price_unit', 'unit_name', 'measure_unit']),
    raw_currency_unit_price: toNumberOrNull(nestedFirstPresent(line, [
      'raw_currency_unit_price',
      'currency_unit_price',
      'unit_price',
      'price',
      'unit_amount',
      'amount_unit',
    ])),
    currency_amount: toNumberOrNull(nestedFirstPresent(line, [
      'currency_amount',
      'currency_amount_before_tax',
      'amount_before_tax',
      'amount_ex_vat',
      'total_ex_vat',
      'total_without_tax',
      'subtotal',
    ])),
    amount: toNumberOrNull(nestedFirstPresent(line, [
      'amount',
      'amount_before_tax',
      'amount_ex_vat',
      'total_ex_vat',
      'total_without_tax',
      'subtotal',
    ])),
    currency_tax: toNumberOrNull(nestedFirstPresent(line, ['currency_tax', 'currency_vat', 'tax', 'vat_amount'])),
    tax: toNumberOrNull(nestedFirstPresent(line, ['tax', 'vat_amount', 'amount_vat'])),
    vat_rate: nestedFirstPresent(line, ['vat_rate', 'tax_rate', 'vat']),
    ledger_account_id: nestedFirstPresent(line, ['ledger_account_id']),
    position: Number(nestedFirstPresent(line, ['position', 'line_number', 'rank'])) || index + 1,
    raw_payload: {
      ...line,
      supplier_reference: supplierReference || line.supplier_reference || null,
      article_code: nestedFirstPresent(line, ['article_code', 'product_code']) || null,
      sku: nestedFirstPresent(line, ['sku']) || null,
    },
  };
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

async function fetchInvoiceLines(pennylaneClient, invoice) {
  const lines = [];
  let endpoint = buildLinesEndpoint(invoice);

  while (endpoint) {
    const response = await pennylaneClient.get(endpoint);
    lines.push(...extractList(response.body));

    if (!hasMore(response.body)) break;
    const cursor = nextCursor(response.body);
    if (!cursor) break;

    const separator = endpoint.includes('?') ? '&' : '?';
    endpoint = `${endpoint}${separator}cursor=${encodeURIComponent(cursor)}`;
  }

  if (lines.length) return lines;
  return extractEmbeddedInvoiceLines(invoice);
}

async function listIncompleteLocalInvoices(db, storeId, limit = 50) {
  const result = await db.query(
    `
    SELECT psi.pennylane_supplier_invoice_id
    FROM pennylane_supplier_invoices psi
    WHERE psi.store_id = $1
      AND psi.pennylane_deleted_at IS NULL
      AND (psi.invoice_date IS NULL OR psi.invoice_date >= CURRENT_DATE - INTERVAL '90 days')
      AND NOT EXISTS (
        SELECT 1
        FROM pennylane_supplier_invoice_lines psil
        WHERE psil.supplier_invoice_id = psi.id
          AND psil.store_id = psi.store_id
          AND (
            NULLIF(TRIM(COALESCE(psil.label, '')), '') IS NOT NULL
            OR psil.quantity IS NOT NULL
            OR psil.raw_currency_unit_price IS NOT NULL
            OR psil.amount IS NOT NULL
            OR psil.currency_amount IS NOT NULL
          )
      )
    ORDER BY psi.last_synced_at ASC NULLS FIRST, psi.created_at ASC
    LIMIT $2
    `,
    [storeId, limit]
  );

  return result.rows.map((row) => row.pennylane_supplier_invoice_id).filter(Boolean);
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

async function upsertInvoice(db, { storeId, invoice, lines }) {
  const pennylaneSupplierId = normalizeSupplierId(invoice);
  const supplierId = await findAltaSupplier(db, storeId, pennylaneSupplierId);
  const eInvoicing = normalizeEInvoicing(invoice);

  const existing = await db.query(
    `
    SELECT alta_business_status
    FROM pennylane_supplier_invoices
    WHERE store_id = $1
      AND pennylane_supplier_invoice_id = $2
    LIMIT 1
    `,
    [storeId, String(invoice.id)]
  );
  const altaBusinessStatus = normalizeAltaStatus(existing.rows[0]?.alta_business_status, invoice, supplierId);

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
    RETURNING id
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

  const localInvoiceId = upserted.rows[0].id;
  await db.query('DELETE FROM pennylane_supplier_invoice_lines WHERE supplier_invoice_id = $1', [localInvoiceId]);

  for (const [index, line] of lines.entries()) {
    const normalizedLine = normalizeLine(line, index);
    await db.query(
      `
      INSERT INTO pennylane_supplier_invoice_lines(
        id, store_id, supplier_invoice_id, pennylane_line_id, e_invoice_line_id,
        line_position, label, quantity, unit, raw_currency_unit_price,
        currency_amount, amount, currency_tax, tax, vat_rate,
        ledger_account_id, raw_payload
      )
      VALUES(
        gen_random_uuid(), $1, $2, $3, $4,
        $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14,
        $15, $16::jsonb
      )
      `,
      [
        storeId,
        localInvoiceId,
        normalizedLine.pennylane_line_id ? String(normalizedLine.pennylane_line_id) : null,
        normalizedLine.e_invoice_line_id ? String(normalizedLine.e_invoice_line_id) : null,
        normalizedLine.position,
        normalizedLine.label,
        normalizedLine.quantity,
        normalizedLine.unit,
        normalizedLine.raw_currency_unit_price,
        normalizedLine.currency_amount,
        normalizedLine.amount,
        normalizedLine.currency_tax,
        normalizedLine.tax,
        normalizedLine.vat_rate,
        normalizedLine.ledger_account_id ? String(normalizedLine.ledger_account_id) : null,
        JSON.stringify(normalizedLine.raw_payload),
      ]
    );
  }

  return localInvoiceId;
}

async function syncSupplierInvoiceById(db, pennylaneClient, storeId, pennylaneInvoiceId) {
  const response = await pennylaneClient.get(`/supplier_invoices/${encodeURIComponent(pennylaneInvoiceId)}`);
  const invoice = extractInvoice(response.body);
  if (!invoice?.id) throw new Error('Pennylane n a pas retourne de facture fournisseur exploitable');

  const lines = await fetchInvoiceLines(pennylaneClient, invoice);
  await upsertInvoice(db, { storeId, invoice, lines });
  return { synced: true };
}

async function syncSupplierInvoiceChange(db, pennylaneClient, storeId, change) {
  const pennylaneInvoiceId = extractChangeResourceId(change);
  if (!pennylaneInvoiceId) return { skipped: true };

  const operation = extractChangeOperation(change);
  if (operation === 'delete') {
    await markInvoiceDeleted(db, storeId, String(pennylaneInvoiceId));
    return { deleted: true };
  }

  return syncSupplierInvoiceById(db, pennylaneClient, storeId, pennylaneInvoiceId);
}

async function processStoreSupplierInvoiceSync(db, pennylaneClient, storeId, options = {}) {
  const state = await getSyncState(db, storeId);
  const workerId = options.workerId || `pennylane-supplier-invoice-import-${process.pid}`;
  const limit = Number(options.limit || process.env.PENNYLANE_SUPPLIER_INVOICE_CHANGELOG_LIMIT) || DEFAULT_CHANGELOG_LIMIT;
  const startDate = state.cursor ? null : state.last_processed_at?.toISOString?.() || state.last_processed_at || initialStartDate();

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

    const incompleteInvoiceIds = await listIncompleteLocalInvoices(db, storeId);
    for (const pennylaneInvoiceId of incompleteInvoiceIds) {
      processed += 1;
      try {
        await syncSupplierInvoiceById(db, pennylaneClient, storeId, pennylaneInvoiceId);
        succeeded += 1;
      } catch (err) {
        failed += 1;
        const error = sanitizePennylaneError(err);
        await writeSyncLog(db, {
          storeId,
          status: 'failed',
          message: 'Erreur reimport facture fournisseur Pennylane incomplete.',
          requestPayload: { pennylane_supplier_invoice_id: pennylaneInvoiceId },
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
    return { processed: 0, succeeded: 0, deleted: 0, failed: 0, skipped: true, reason: 'PENNYLANE_DISABLED' };
  }

  if (!pennylaneConfig.apiToken) {
    return { processed: 0, succeeded: 0, deleted: 0, failed: 0, skipped: true, reason: 'PENNYLANE_TOKEN_MISSING' };
  }

  const pennylaneClient = createPennylaneClient(pennylaneConfig);
  const stores = (await listStoresToSync(db, options.storeId)).slice(0, batchSize);
  let processed = 0;
  let succeeded = 0;
  let deleted = 0;
  let failed = 0;

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
