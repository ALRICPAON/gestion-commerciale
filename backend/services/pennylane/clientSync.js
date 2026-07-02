const { PennylaneApiError, createPennylaneClient } = require('./client');
const { getPennylaneConfig } = require('./config');
const {
  CLIENT_CREATE_ACTION,
  CLIENT_ENTITY_TYPE,
  CLIENT_UPDATE_ACTION,
  writeSyncLog,
} = require('./syncQueue');

const DEFAULT_BATCH_SIZE = 10;
const MAX_BACKOFF_MINUTES = 60;
const ENTITY_LOCK_NAMESPACE = 'pennylane:client-sync';

function normalizeCountry(value) {
  const country = String(value || 'France').trim().toLowerCase();
  if (['fr', 'fra', 'france'].includes(country)) return 'FR';
  return country.length === 2 ? country.toUpperCase() : 'FR';
}

function normalizePaymentConditions(value) {
  const text = String(value || '').trim().toLowerCase();
  const map = new Map([
    ['comptant', 'upon_receipt'],
    ['a reception', 'upon_receipt'],
    ['a réception', 'upon_receipt'],
    ['7 jours', '7_days'],
    ['15 jours', '15_days'],
    ['30 jours', '30_days'],
    ['30 jours fin de mois', '30_days_end_of_month'],
    ['45 jours', '45_days'],
    ['45 jours fin de mois', '45_days_end_of_month'],
    ['60 jours', '60_days'],
  ]);

  return map.get(text) || '30_days';
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== '';
    })
  );
}

function extractPennylaneCustomer(responseBody) {
  if (!responseBody || typeof responseBody !== 'object') return null;
  if (responseBody.id) return responseBody;
  if (responseBody.customer?.id) return responseBody.customer;
  if (responseBody.company_customer?.id) return responseBody.company_customer;
  if (responseBody.data?.id) return responseBody.data;
  return null;
}

function extractPennylaneCustomerList(responseBody) {
  if (!responseBody || typeof responseBody !== 'object') return [];
  if (Array.isArray(responseBody.items)) return responseBody.items;
  if (Array.isArray(responseBody.data)) return responseBody.data;
  if (Array.isArray(responseBody.customers)) return responseBody.customers;
  return [];
}

function getPennylaneCustomerId(responseBody) {
  const customer = extractPennylaneCustomer(responseBody);
  return customer?.id ? String(customer.id) : null;
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

function buildExternalReference(client) {
  return `alta:${client.store_id}:client:${client.id}`;
}

function buildPennylaneCompanyCustomerPayload(client) {
  const fullAddress = [client.address_line1, client.address_line2].filter(Boolean).join('\n');
  const billingAddress = compactObject({
    address: fullAddress || client.city || 'Adresse non renseignee',
    postal_code: client.postal_code,
    city: client.city || 'Non renseigne',
    country_alpha2: normalizeCountry(client.country),
  });

  return compactObject({
    name: client.legal_name || client.name,
    vat_number: client.vat_number,
    reg_no: client.siret,
    phone: client.phone || client.mobile,
    billing_address: billingAddress,
    delivery_address: billingAddress,
    payment_conditions: normalizePaymentConditions(client.payment_terms),
    recipient: client.contact_name,
    reference: client.code,
    notes: client.notes,
    emails: client.email ? [client.email] : [],
    external_reference: buildExternalReference(client),
    billing_language: 'fr_FR',
  });
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

async function fetchAltaClient(db, storeId, clientId) {
  const result = await db.query(
    `
    SELECT
      id, store_id, code, name, legal_name, status,
      contact_name, phone, mobile, email,
      address_line1, address_line2, postal_code, city, country,
      vat_number, siret, payment_terms, notes,
      pennylane_customer_id
    FROM clients
    WHERE id = $1
      AND store_id = $2
    LIMIT 1
    `,
    [clientId, storeId]
  );

  return result.rows[0] || null;
}

async function findPennylaneCustomerByExternalReference(pennylaneClient, externalReference) {
  const filter = encodeURIComponent(`external_reference:eq:${externalReference}`);
  const response = await pennylaneClient.get(`/customers?limit=1&filter=${filter}`);
  const [customer] = extractPennylaneCustomerList(response.body);
  return customer || null;
}

async function updateExistingPennylaneCustomer(pennylaneClient, pennylaneCustomerId, payload, mode) {
  const response = await pennylaneClient.put(`/company_customers/${pennylaneCustomerId}`, payload);

  return {
    response,
    payload,
    pennylaneCustomerId: getPennylaneCustomerId(response.body) || String(pennylaneCustomerId),
    mode,
  };
}

async function upsertPennylaneCustomer({ pennylaneClient, altaClient }) {
  const payload = buildPennylaneCompanyCustomerPayload(altaClient);
  const existingPennylaneId = altaClient.pennylane_customer_id;

  if (existingPennylaneId) {
    return updateExistingPennylaneCustomer(pennylaneClient, existingPennylaneId, payload, 'update');
  }

  const existingCustomer = await findPennylaneCustomerByExternalReference(
    pennylaneClient,
    payload.external_reference
  );

  if (existingCustomer?.id) {
    return updateExistingPennylaneCustomer(pennylaneClient, existingCustomer.id, payload, 'link_then_update');
  }

  try {
    const response = await pennylaneClient.post('/company_customers', payload);
    return { response, payload, pennylaneCustomerId: getPennylaneCustomerId(response.body), mode: 'create' };
  } catch (err) {
    if (!(err instanceof PennylaneApiError) || err.status !== 409) {
      throw err;
    }

    const conflictedCustomer = await findPennylaneCustomerByExternalReference(
      pennylaneClient,
      payload.external_reference
    );

    if (!conflictedCustomer?.id) {
      throw err;
    }

    return updateExistingPennylaneCustomer(
      pennylaneClient,
      conflictedCustomer.id,
      payload,
      'conflict_then_update'
    );
  }
}

async function markQueueSuccess(db, queueItem, result) {
  await db.query(
    `
    UPDATE clients
    SET
      pennylane_customer_id = $1,
      pennylane_sync_status = 'success',
      pennylane_sync_last_error = NULL,
      pennylane_synced_at = now(),
      pennylane_sync_updated_at = now()
    WHERE id = $2
      AND store_id = $3
    `,
    [result.pennylaneCustomerId, queueItem.entity_id, queueItem.store_id]
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
        customer_id: result.pennylaneCustomerId,
        mode: result.mode,
      }),
    ]
  );

  await writeSyncLog(db, {
    queueId: queueItem.id,
    storeId: queueItem.store_id,
    status: 'success',
    message: 'Client synchronise avec Pennylane.',
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
    UPDATE clients
    SET
      pennylane_sync_status = 'failed',
      pennylane_sync_last_error = $1,
      pennylane_sync_updated_at = now()
    WHERE id = $2
      AND store_id = $3
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
      ? 'Synchronisation client Pennylane en echec definitif.'
      : 'Synchronisation client Pennylane en echec, nouvelle tentative planifiee.',
    responsePayload: error.responseBody || error,
    errorCode: error.code || (error.status ? `HTTP_${error.status}` : null),
  });
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
    [CLIENT_ENTITY_TYPE, [CLIENT_CREATE_ACTION, CLIENT_UPDATE_ACTION], batchSize, workerId]
  );

  return result.rows;
}

async function tryAcquireClientLock(db, queueItem) {
  const result = await db.query(
    `
    SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked
    `,
    [ENTITY_LOCK_NAMESPACE, `${queueItem.store_id}:${queueItem.entity_id}`]
  );

  return Boolean(result.rows[0]?.locked);
}

async function releaseClientLock(db, queueItem) {
  await db.query(
    `
    SELECT pg_advisory_unlock(hashtext($1), hashtext($2))
    `,
    [ENTITY_LOCK_NAMESPACE, `${queueItem.store_id}:${queueItem.entity_id}`]
  );
}

async function deferQueueItem(db, queueItem) {
  await db.query(
    `
    UPDATE pennylane_sync_queue
    SET
      status = 'pending',
      attempts = GREATEST(attempts - 1, 0),
      locked_at = NULL,
      locked_by = NULL,
      scheduled_at = now() + interval '30 seconds',
      updated_at = now()
    WHERE id = $1
    `,
    [queueItem.id]
  );

  await writeSyncLog(db, {
    queueId: queueItem.id,
    storeId: queueItem.store_id,
    status: 'pending',
    message: 'Synchronisation client Pennylane reportee car un autre job du meme client est deja en cours.',
  });
}

async function processQueueItem(db, pennylaneClient, queueItem) {
  const lockDb = typeof db.connect === 'function' ? await db.connect() : db;
  let lockAcquired = false;

  try {
    lockAcquired = await tryAcquireClientLock(lockDb, queueItem);

    if (!lockAcquired) {
      await deferQueueItem(db, queueItem);
      return 'deferred';
    }

    const altaClient = await fetchAltaClient(db, queueItem.store_id, queueItem.entity_id);

    if (!altaClient) {
      throw new Error('Client ALTA introuvable pour la synchronisation Pennylane');
    }

    await db.query(
      `
      UPDATE clients
      SET
        pennylane_sync_status = 'processing',
        pennylane_sync_last_error = NULL,
        pennylane_sync_updated_at = now()
      WHERE id = $1
        AND store_id = $2
      `,
      [altaClient.id, altaClient.store_id]
    );

    const result = await upsertPennylaneCustomer({ pennylaneClient, altaClient });

    if (!result.pennylaneCustomerId) {
      throw new Error('Pennylane n a pas retourne d identifiant client exploitable');
    }

    await markQueueSuccess(db, queueItem, result);
    return 'success';
  } finally {
    if (lockAcquired) {
      await releaseClientLock(lockDb, queueItem).catch((err) => {
        console.warn('Impossible de liberer le verrou Pennylane client', {
          queue_id: queueItem.id,
          client_id: queueItem.entity_id,
          error: err.message,
        });
      });
    }

    if (lockDb !== db && typeof lockDb.release === 'function') {
      lockDb.release();
    }
  }
}

async function processPennylaneClientSyncQueue(db, options = {}) {
  const config = getPennylaneConfig();
  const batchSize = Number(options.batchSize || process.env.PENNYLANE_SYNC_BATCH_SIZE) || DEFAULT_BATCH_SIZE;
  const workerId = options.workerId || `pennylane-client-worker-${process.pid}`;

  if (!config.enabled) {
    return { processed: 0, succeeded: 0, failed: 0, skipped: true, reason: 'PENNYLANE_DISABLED' };
  }

  if (!config.apiToken) {
    return { processed: 0, succeeded: 0, failed: 0, skipped: true, reason: 'PENNYLANE_TOKEN_MISSING' };
  }

  const pennylaneClient = createPennylaneClient(config);
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
  buildPennylaneCompanyCustomerPayload,
  processPennylaneClientSyncQueue,
};