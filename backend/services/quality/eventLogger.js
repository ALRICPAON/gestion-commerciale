async function logQualityEvent({
  dbPool,
  storeId,
  actorId,
  eventType,
  targetType,
  targetId = null,
  reason = null,
  before = null,
  after = null,
  metadata = {},
} = {}) {
  return {
    queued: false,
    persisted: false,
    store_id: storeId || null,
    actor_id: actorId || null,
    event_type: eventType || null,
    target_type: targetType || null,
    target_id: targetId,
    reason,
    before,
    after,
    metadata,
    db_available: Boolean(dbPool),
  };
}

module.exports = {
  logQualityEvent,
};
