const CLIENT_ENTITY_TYPE = 'client';
const CLIENT_CREATE_ACTION = 'client.create';
const CLIENT_UPDATE_ACTION = 'client.update';

async function writeSyncLog(db, {
  queueId = null,
  storeId,
  status,
  message,
  requestPayload = null,
  responsePayload = null,
  errorCode = null,
  createdBy = null,
}) {
  await db.query(
    `
    INSERT INTO pennylane_sync_logs (
      queue_id, store_id, status, message,
      request_payload, response_payload, error_code, created_by
    ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
    `,
    [
      queueId,
      storeId,
      status,
      message,
      requestPayload ? JSON.stringify(requestPayload) : null,
      responsePayload ? JSON.stringify(responsePayload) : null,
      errorCode,
      createdBy,
    ]
  );
}

async function enqueuePennylaneSync(db, {
  storeId,
  entityType,
  entityId,
  action,
  payload = {},
  priority = 100,
  createdBy = null,
}) {
  const existing = await db.query(
    `
    UPDATE pennylane_sync_queue
    SET
      payload = $5::jsonb,
      priority = LEAST(priority, $6),
      scheduled_at = now(),
      last_error = NULL,
      updated_at = now()
    WHERE id = (
      SELECT id
      FROM pennylane_sync_queue
      WHERE store_id = $1
        AND entity_type = $2
        AND entity_id = $3
        AND action = $4
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    )
    RETURNING id
    `,
    [storeId, entityType, entityId, action, JSON.stringify(payload), priority]
  );

  if (existing.rows.length > 0) {
    const queueId = existing.rows[0].id;
    await writeSyncLog(db, {
      queueId,
      storeId,
      status: 'pending',
      message: 'Demande de synchronisation Pennylane mise a jour dans la queue.',
      requestPayload: { entity_type: entityType, entity_id: entityId, action, payload },
      createdBy,
    });
    return { id: queueId, reused: true };
  }

  const inserted = await db.query(
    `
    INSERT INTO pennylane_sync_queue (
      store_id, entity_type, entity_id, action, status,
      priority, payload, created_by
    ) VALUES ($1, $2, $3, $4, 'pending', $5, $6::jsonb, $7)
    RETURNING id
    `,
    [storeId, entityType, entityId, action, priority, JSON.stringify(payload), createdBy]
  );

  const queueId = inserted.rows[0].id;
  await writeSyncLog(db, {
    queueId,
    storeId,
    status: 'pending',
    message: 'Demande de synchronisation Pennylane ajoutee a la queue.',
    requestPayload: { entity_type: entityType, entity_id: entityId, action, payload },
    createdBy,
  });

  return { id: queueId, reused: false };
}

function buildClientQueuePayload(client) {
  return {
    client_id: client.id,
    code: client.code,
    name: client.name,
    legal_name: client.legal_name,
    email: client.email,
    phone: client.phone || client.mobile,
    vat_number: client.vat_number,
    siret: client.siret,
    status: client.status,
    external_reference: `alta:${client.store_id}:client:${client.id}`,
  };
}

async function enqueuePennylaneClientSync(db, {
  client,
  action,
  createdBy = null,
}) {
  return enqueuePennylaneSync(db, {
    storeId: client.store_id,
    entityType: CLIENT_ENTITY_TYPE,
    entityId: client.id,
    action,
    payload: buildClientQueuePayload(client),
    priority: action === CLIENT_CREATE_ACTION ? 50 : 80,
    createdBy,
  });
}

module.exports = {
  CLIENT_CREATE_ACTION,
  CLIENT_ENTITY_TYPE,
  CLIENT_UPDATE_ACTION,
  enqueuePennylaneClientSync,
  enqueuePennylaneSync,
  writeSyncLog,
};