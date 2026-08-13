async function logQualityEvent({
  dbPool,
  storeId,
  actorId,
  eventType,
  targetType,
  targetId = null,
  source = 'web',
  severity = 'info',
  occurredAt = new Date().toISOString(),
  correlationId = null,
  reason = null,
  before = null,
  after = null,
  metadata = {},
} = {}) {
  const event = {
    queued: false,
    persisted: false,
    store_id: storeId || null,
    actor_id: actorId || null,
    event_type: eventType || null,
    target_type: targetType || null,
    target_id: targetId,
    source,
    severity,
    occurred_at: occurredAt,
    correlation_id: correlationId,
    reason,
    before,
    after,
    metadata,
    db_available: Boolean(dbPool),
  };

  if (!dbPool?.query || !storeId || !eventType) return event;

  try {
    await runOptionalAuditOperation(dbPool, async () => {
      const store = await dbPool.query('SELECT client_key FROM stores WHERE id = $1 LIMIT 1', [storeId]);
      await dbPool.query(
        `INSERT INTO user_audit_events (store_id, user_id, client_key, action, entity_type, entity_id, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          storeId,
          actorId || null,
          store.rows[0]?.client_key || 'unknown',
          eventType,
          targetType || null,
          targetId || null,
          {
            source,
            severity,
            occurred_at: occurredAt,
            correlation_id: correlationId,
            reason,
            before,
            after,
            metadata,
          },
        ]
      );
    });
    event.persisted = true;
  } catch (err) {
    event.error = err.message;
    console.warn('Audit qualite non persiste', { eventType, targetType, targetId, message: err.message });
  }

  return event;
}

async function runOptionalAuditOperation(dbPool, operation) {
  if (!dbPool?.query) return operation();

  const savepoint = `sp_quality_audit_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  try {
    await dbPool.query(`SAVEPOINT ${savepoint}`);
  } catch (err) {
    return operation();
  }

  try {
    const result = await operation();
    await dbPool.query(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (err) {
    await dbPool.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => {});
    await dbPool.query(`RELEASE SAVEPOINT ${savepoint}`).catch(() => {});
    throw err;
  }
}

module.exports = {
  logQualityEvent,
};
