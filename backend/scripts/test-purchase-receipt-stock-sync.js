const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  calculateReceivedStockQuantity,
  isStockBackedPurchaseStatus,
  purchaseLineUpdateValues,
} = require('../services/purchaseReceiptStockSync');

function applyEdit(state, body) {
  const stockBacked = isStockBackedPurchaseStatus(state.purchase.status);
  const quantities = purchaseLineUpdateValues(body, state.line, stockBacked);
  const nextLine = { ...state.line, ...body, ...quantities };
  if (!stockBacked) return { ...state, line: nextLine };

  const consumed = Number((state.lot.qty_initial - state.lot.qty_remaining).toFixed(3));
  const nextQty = calculateReceivedStockQuantity(nextLine);
  if (consumed > 0) {
    const error = new Error('Stock deja consomme sur ce BL fournisseur');
    error.code = 'PURCHASE_RECEIPT_STOCK_CONSUMED';
    throw error;
  }
  return {
    ...state,
    line: { ...nextLine, stock_quantity: nextQty },
    lot: { ...state.lot, article_id: nextLine.article_id, supplier_lot_number: nextLine.supplier_lot_number, qty_initial: nextQty, qty_remaining: Number((nextQty - consumed).toFixed(3)) },
    movement: { ...state.movement, article_id: nextLine.article_id, quantity: nextQty },
  };
}

function removeLine(state) {
  const consumed = Number((state.lot.qty_initial - state.lot.qty_remaining).toFixed(3));
  if (consumed > 0) {
    const error = new Error('Stock deja consomme sur ce BL fournisseur');
    error.code = 'PURCHASE_RECEIPT_STOCK_CONSUMED';
    throw error;
  }
  return { ...state, line: null, lot: null, movement: null };
}

function baseState(overrides = {}) {
  const qty = overrides.qty ?? 1;
  const articleId = overrides.article_id || 'article-a';
  return {
    purchase: { id: 'purchase-1', status: overrides.status || 'received_pending_invoice' },
    line: {
      id: 'line-1',
      article_id: articleId,
      price_unit: 'kg',
      ordered_colis: null,
      ordered_pieces: null,
      ordered_quantity: qty,
      received_colis: null,
      received_pieces: null,
      received_quantity: qty,
      stock_quantity: qty,
      supplier_lot_number: overrides.supplier_lot_number || 'LOT-A',
      latin_name: 'Gadus morhua',
      fao_zone: '27',
      sous_zone: 'VII',
      fishing_gear: 'chalut',
      origin_label: 'France',
      dlc: '2026-09-15',
    },
    lot: {
      id: 'lot-1',
      article_id: articleId,
      qty_initial: qty,
      qty_remaining: overrides.remaining ?? qty,
      supplier_lot_number: overrides.supplier_lot_number || 'LOT-A',
      traceability_data: {
        latin_name: 'Gadus morhua',
        fao_zone: '27',
        sous_zone: 'VII',
        fishing_gear: 'chalut',
        origin_label: 'France',
      },
    },
    movement: { movement_type: 'purchase_in', article_id: articleId, quantity: qty },
  };
}

const test1 = applyEdit(baseState({ qty: 1 }), { received_quantity: 2 });
assert.strictEqual(test1.lot.qty_initial, 2);
assert.strictEqual(test1.lot.qty_remaining, 2);

const test2 = applyEdit(baseState({ qty: 2 }), { received_quantity: 1 });
assert.strictEqual(test2.lot.qty_initial, 1);
assert.strictEqual(test2.lot.qty_remaining, 1);

const once = applyEdit(baseState({ qty: 1 }), { received_quantity: 2 });
const twice = applyEdit(once, { received_quantity: 2 });
assert.strictEqual(twice.lot.qty_initial, 2);
assert.strictEqual(twice.lot.qty_remaining, 2);

const removed = removeLine(baseState({ qty: 5 }));
assert.strictEqual(removed.lot, null);
assert.strictEqual(removed.movement, null);

assert.throws(() => applyEdit(baseState({ qty: 5, remaining: 2 }), { received_quantity: 2 }), /Stock deja consomme/);

assert.throws(() => applyEdit(baseState({ qty: 5, remaining: 2 }), { received_quantity: 6 }), /Stock deja consomme/);

const changedArticle = applyEdit(baseState({ qty: 5 }), { article_id: 'article-b', received_quantity: 5 });
assert.strictEqual(changedArticle.lot.article_id, 'article-b');
assert.strictEqual(changedArticle.movement.article_id, 'article-b');

assert.throws(() => applyEdit(baseState({ qty: 5, remaining: 2 }), { article_id: 'article-b', received_quantity: 2 }), /Stock deja consomme/);

const changedLot = applyEdit(baseState({ qty: 5, supplier_lot_number: 'LOT-A' }), { supplier_lot_number: 'LOT-B', received_quantity: 5 });
assert.strictEqual(changedLot.lot.supplier_lot_number, 'LOT-B');

assert.throws(() => applyEdit(baseState({ qty: 5, remaining: 2 }), { supplier_lot_number: 'LOT-B', received_quantity: 2 }), /Stock deja consomme/);

const traceability = applyEdit(baseState({ qty: 5 }), { received_quantity: 5 });
assert.strictEqual(traceability.line.latin_name, 'Gadus morhua');
assert.strictEqual(traceability.lot.traceability_data.fao_zone, '27');

const orderedOnly = applyEdit(baseState({ status: 'ordered', qty: 1 }), { ordered_quantity: 2 });
assert.strictEqual(orderedOnly.lot.qty_initial, 1);
assert.strictEqual(orderedOnly.line.ordered_quantity, 2);

const legacyFrontendPayload = applyEdit(baseState({ qty: 1 }), { ordered_quantity: 2 });
assert.strictEqual(legacyFrontendPayload.line.received_quantity, 2);
assert.strictEqual(legacyFrontendPayload.lot.qty_initial, 2);

const frontend = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'js', 'purchase-detail.js'), 'utf8');
assert(frontend.includes('received_pending_invoice'), 'Le frontend doit traiter received_pending_invoice comme un statut receptionne');

const purchasesRoute = fs.readFileSync(path.resolve(__dirname, '..', 'routes', 'purchases.js'), 'utf8');
assert(purchasesRoute.includes('purchaseReceiptStockSync.purchaseLineUpdateValues'), 'La route achat doit normaliser les corrections de reception');
assert(purchasesRoute.includes('rebuildStockForPurchaseIfNeeded(client, purchase'), 'La modification de ligne recue doit reconstruire le stock existant');

console.log('OK purchase receipt stock sync PR2');
