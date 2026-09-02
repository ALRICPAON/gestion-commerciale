const STOCK_BACKED_PURCHASE_STATUSES = new Set(['received', 'received_pending_invoice']);

function isStockBackedPurchaseStatus(status) {
  return STOCK_BACKED_PURCHASE_STATUSES.has(String(status || ''));
}

function normalizePriceUnit(value) {
  return ['kg', 'piece', 'colis'].includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'kg';
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function receivedCorrectionValue(body, current, receivedKey, orderedKey) {
  if (hasOwn(body, receivedKey)) return body[receivedKey];
  if (hasOwn(body, orderedKey)) return body[orderedKey];
  return current[receivedKey];
}

function purchaseLineUpdateValues(body = {}, current = {}, stockBacked = false) {
  return {
    ordered_colis: body.ordered_colis ?? current.ordered_colis,
    ordered_pieces: body.ordered_pieces ?? current.ordered_pieces,
    ordered_quantity: body.ordered_quantity ?? current.ordered_quantity,
    received_colis: stockBacked ? receivedCorrectionValue(body, current, 'received_colis', 'ordered_colis') : (body.received_colis ?? current.received_colis),
    received_pieces: stockBacked ? receivedCorrectionValue(body, current, 'received_pieces', 'ordered_pieces') : (body.received_pieces ?? current.received_pieces),
    received_quantity: stockBacked ? receivedCorrectionValue(body, current, 'received_quantity', 'ordered_quantity') : (body.received_quantity ?? current.received_quantity),
  };
}

function calculateReceivedStockQuantity(line = {}) {
  const unit = normalizePriceUnit(line.price_unit);
  const colis = Number(line.received_colis ?? line.ordered_colis ?? 0);
  const pieces = Number(line.received_pieces ?? line.ordered_pieces ?? 0);
  const quantity = Number(line.received_quantity ?? line.ordered_quantity ?? 0);
  if (unit === 'colis') return colis;
  if (unit === 'piece') return colis > 0 && pieces > 0 ? colis * pieces : pieces;
  return colis > 0 && quantity > 0 ? colis * quantity : quantity;
}

module.exports = {
  STOCK_BACKED_PURCHASE_STATUSES,
  calculateReceivedStockQuantity,
  isStockBackedPurchaseStatus,
  purchaseLineUpdateValues,
};
