async function queueQualityNotification({
  storeId,
  type,
  title,
  message,
  targetType = null,
  targetId = null,
  metadata = {},
} = {}) {
  return {
    queued: false,
    store_id: storeId || null,
    type: type || null,
    title: title || null,
    message: message || null,
    target_type: targetType,
    target_id: targetId,
    metadata,
  };
}

module.exports = {
  queueQualityNotification,
};
