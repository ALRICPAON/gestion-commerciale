async function queueQualityNotification({
  storeId,
  type,
  title,
  message,
  priority = 'normal',
  channel = 'in_app',
  recipients = [],
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
    priority,
    channel,
    recipients,
    target_type: targetType,
    target_id: targetId,
    metadata,
  };
}

module.exports = {
  queueQualityNotification,
};
