const { PennylaneApiError, createPennylaneClient } = require('./client');
const { getPennylaneConfig } = require('./config');
const { writeSyncLog } = require('./syncQueue');

const DEFAULT_BATCH_SIZE = 10;
const MAX_BACKOFF_MINUTES = 60;

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== '';
    })
  );
}

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

function extractPartner(responseBody, responseKey) {
  if (!responseBody || typeof responseBody !== 'object') return null;
  if (responseBody.id) return responseBody;
  if (responseKey && responseBody[responseKey]?.id) return responseBody[responseKey];
  if (responseBody.data?.id) return responseBody.data;
  return null;
}

function extractPartnerList(responseBody, listKey) {
  if (!responseBody || typeof responseBody !== 'object') return [];
  if (Array.isArray(responseBody.items)) return responseBody.items;
  if (Array.isArray(responseBody.data)) return responseBody.data;
  if (listKey && Array.isArray(responseBody[listKey])) return responseBody[listKey];
  return [];
}

function getPartnerId(responseBody, responseKey) {
  const partner = extractPartner(responseBody, responseKey);
  return partner?.id ? String(partner.id) : null;
}

function buildExternalReference(entityType, partner) {
  return `alta:${partner.store_id}:${entityType}:${partner.id}`;
}

function buildJsonFilter(field, operator, value) {
  return encodeURIComponent(JSON.stringify([{ field, operator, value }]));
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

async function fetchAltaPartner(db, config, storeId, partnerId) {
  const result = await db.query(config.fetchSql, [partnerId, storeId]);
  return result.rows[0] || null;
}

async function findPennylanePartnerByExternalReference(pennylaneClient, config, externalReference) {
  const filter = buildJsonFilter('external_reference', 'eq', externalReference);
  const response = await pennylaneClient.get(`${config.listEndpoint}?limit=1&filter=${filter}`);
  const [partner] = extractPartnerList(response.body, config.listResponseKey);
  return partner || null;
}

async function updateExistingPennylanePartner(pennylaneClient, config, pennylanePartnerId, payload, mode) {
  const response = await pennylaneClient.put(config.updateEndpoint(pennylanePartnerId), payload);

  return {
    response,
    payload,
    pennylanePartnerId: getPartnerId(response.body, config.responseKey) || String(pennylanePartnerId),
    mode,
  };
}

async function upsertPennylanePartner({ pennylaneClient, config, altaPartner }) {
  const payload = config.buildPayload(altaPartner);
  const existingPennylaneId = altaPartner[config.pennylaneIdColumn];

  if (existingPennylaneId) {
    return updateExistingPennylanePartner(pennylaneClient, config, existingPennylaneId, payload, 'update');
  }

  const existingPartner = await findPennylanePartnerByExternalReference(
    pennylaneClient,
    config,
    payload.external_reference
  );

  if (existingPartner?.id) {
    return updateExistingPennylanePartner(pennylaneClient, config, existingPartner.id, payload, 'link_then_update');
  }

  try {
    const response = await pennylaneClient.post(config.createEndpoint, payload);
    return {
      response,
      payload,
      pennylanePartnerId: getPartnerId(response.body, config.responseKey),
      mode: 'create',
    };
  } catch (err) {
    if (!(err instanceof PennylaneApiError) || err.status !== 409) {
      throw err;
    }

    const conflictedPartner = await findPennylanePartnerByExternalReference(
      pennylaneClient,
      config,
      payload.external_reference
    );

    if (!conflictedPartner?.id) {
      throw err;
    }

    return updateExistingPennylanePartner(
      pennylaneClient,
      config,
      conflictedPartner.id,
      payload,
      'conflict_then_update'
    );
  }
}

async function markQueueSuccess(db, config, queueItem, result) {
  await db.query(config.markSuccessSql, [result.pennylanePartnerId, queueItem.entity_id, queueItem.store_id]);

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
        [config.referenceKey]: result.pennylanePartnerId,
        mode: result.mode,
      }),
    ]
  );

  await writeSyncLog(db, {
    queueId: queueItem.id,
    storeId: queueItem.store_id,
    status: 'success',
    message: config.successMessage,
    requestPayload: result.payload,
    responsePayload: redactSensitivePayload(result.response.body),
  });
}

async function markQueueFailure(db, config, queueItem, err) {
  const error = sanitizePennylaneError(err);
  const finalFailure = queueItem.attempts >= queueItem.max_attempts;
  const retryDelayMinutes = getRetryDelayMinutes(queueItem.attempts);

  await db.query(config.markFailureSql, [error.message, queueItem.entity_id, queueItem.store_id]);

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
    message: finalFailure ? config.finalFailureMessage : config.retryFailureMessage,
    responsePayload: error.responseBody || error,
    errorCode: error.code || (error.status ? `HTTP_${error.status}` : null),
  });
}

async function claimQueueItems(db, config, { batchSize, workerId }) {
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
    [config.entityType, config.actions, batchSize, workerId]
  );

  return result.rows;
}

async function tryAcquirePartnerLock(db, config, queueItem) {
  const result = await db.query(
    `
    SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked
    `,
    [config.lockNamespace, `${queueItem.store_id}:${queueItem.entity_id}`]
  );

  return Boolean(result.rows[0]?.locked);
}

async function releasePartnerLock(db, config, queueItem) {
  await db.query(
    `
    SELECT pg_advisory_unlock(hashtext($1), hashtext($2))
    `,
    [config.lockNamespace, `${queueItem.store_id}:${queueItem.entity_id}`]
  );
}

async function deferQueueItem(db, config, queueItem) {
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
    message: config.deferredMessage,
  });
}

async function processQueueItem(db, pennylaneClient, config, queueItem) {
  const lockDb = typeof db.connect === 'function' ? await db.connect() : db;
  let lockAcquired = false;

  try {
    lockAcquired = await tryAcquirePartnerLock(lockDb, config, queueItem);

    if (!lockAcquired) {
      await deferQueueItem(db, config, queueItem);
      return 'deferred';
    }

    const altaPartner = await fetchAltaPartner(db, config, queueItem.store_id, queueItem.entity_id);

    if (!altaPartner) {
      throw new Error(config.notFoundMessage);
    }

    await db.query(config.markProcessingSql, [altaPartner.id, altaPartner.store_id]);

    const result = await upsertPennylanePartner({ pennylaneClient, config, altaPartner });

    if (!result.pennylanePartnerId) {
      throw new Error(config.missingRemoteIdMessage);
    }

    await markQueueSuccess(db, config, queueItem, result);
    return 'success';
  } finally {
    if (lockAcquired) {
      await releasePartnerLock(lockDb, config, queueItem).catch((err) => {
        console.warn(config.lockReleaseWarning, {
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

async function processPennylanePartnerSyncQueue(db, config, options = {}) {
  const pennylaneConfig = getPennylaneConfig();
  const batchSize = Number(options.batchSize || process.env.PENNYLANE_SYNC_BATCH_SIZE) || DEFAULT_BATCH_SIZE;
  const workerId = options.workerId || `${config.workerName}-${process.pid}`;

  if (!pennylaneConfig.enabled) {
    return { processed: 0, succeeded: 0, failed: 0, deferred: 0, skipped: true, reason: 'PENNYLANE_DISABLED' };
  }

  if (!pennylaneConfig.apiToken) {
    return { processed: 0, succeeded: 0, failed: 0, deferred: 0, skipped: true, reason: 'PENNYLANE_TOKEN_MISSING' };
  }

  const pennylaneClient = createPennylaneClient(pennylaneConfig);
  const queueItems = await claimQueueItems(db, config, { batchSize, workerId });
  let succeeded = 0;
  let failed = 0;
  let deferred = 0;

  for (const queueItem of queueItems) {
    try {
      const status = await processQueueItem(db, pennylaneClient, config, queueItem);
      if (status === 'deferred') {
        deferred += 1;
      } else {
        succeeded += 1;
      }
    } catch (err) {
      await markQueueFailure(db, config, queueItem, err);
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
  buildExternalReference,
  compactObject,
  normalizeCountry,
  normalizePaymentConditions,
  processPennylanePartnerSyncQueue,
};
