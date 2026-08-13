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
    event.persisted = true;
  } catch (err) {
    event.error = err.message;
    console.warn('Audit qualite non persiste', { eventType, targetType, targetId, message: err.message });
  }

  return event;
}

module.exports = {
  logQualityEvent,
};
