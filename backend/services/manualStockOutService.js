const { recomputeArticleStock } = require('./stockService');

const MANUAL_STOCK_OUT_REASONS = Object.freeze([
  { code: 'waste', label: 'Casse / perte', movement_type: 'waste_out' },
  { code: 'unfit', label: 'Produit impropre', movement_type: 'unfit_out' },
  { code: 'destruction', label: 'Destruction', movement_type: 'destruction_out' },
  { code: 'inventory_adjustment', label: 'Ecart inventaire', movement_type: 'inventory_adjustment_out' },
  { code: 'internal_use', label: 'Consommation interne', movement_type: 'internal_use_out' },
  { code: 'supplier_return', label: 'Retour fournisseur', movement_type: 'supplier_return_out' },
  { code: 'other', label: 'Autre', movement_type: 'manual_stock_out' },
]);

const MANUAL_STOCK_OUT_MOVEMENT_TYPES = new Set(MANUAL_STOCK_OUT_REASONS.map((reason) => reason.movement_type));

function clean(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function number(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundQty(value) {
  return Number(number(value).toFixed(3));
}

function businessError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getManualStockOutReason(code) {
  return MANUAL_STOCK_OUT_REASONS.find((reason) => reason.code === clean(code));
}

function manualStockOutNote({ reason, comment, movementDate, userId }) {
  return JSON.stringify({
    source: 'manual_stock_out',
    reason_code: reason.code,
    reason_label: reason.label,
    comment: clean(comment),
    movement_date: clean(movementDate),
    user_id: userId || null,
  });
}

function cancellationNote({ originalMovementId, comment, userId }) {
  return JSON.stringify({
    source: 'manual_stock_out_cancel',
    original_movement_id: originalMovementId,
    comment: clean(comment),
    user_id: userId || null,
  });
}

async function getManualStockOutByRequestId(client, { storeId, requestId }) {
  if (!isUuid(requestId)) return null;
  const existing = await client.query(
    `SELECT sm.*, l.qty_remaining AS lot_qty_remaining
     FROM stock_movements sm
     LEFT JOIN lots l ON l.id = sm.lot_id AND l.store_id = sm.store_id
     WHERE sm.store_id = $1
       AND sm.source_table = 'manual_stock_out'
       AND sm.source_id = $2
       AND sm.quantity < 0
       AND sm.movement_type = ANY($3::text[])
     LIMIT 1`,
    [storeId, requestId, Array.from(MANUAL_STOCK_OUT_MOVEMENT_TYPES)]
  );
  return existing.rows[0] || null;
}

async function lockManualStockOutRequestId(client, { storeId, requestId }) {
  if (!isUuid(requestId)) return;
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`manual_stock_out:${storeId}:${requestId}`]
  );
}

async function createManualStockOut(client, {
  storeId,
  clientKey = null,
  articleId,
  lotId,
  quantity,
  reasonCode,
  comment = null,
  movementDate = null,
  userId = null,
  requestId = null,
}) {
  if (!isUuid(storeId)) throw businessError('Magasin invalide', 400);
  if (!isUuid(articleId)) throw businessError('Article invalide', 400);
  if (!isUuid(lotId)) throw businessError('Lot obligatoire et invalide', 400);

  const qty = roundQty(quantity);
  if (qty <= 0) throw businessError('La quantite a sortir doit etre strictement positive', 400);

  const reason = getManualStockOutReason(reasonCode);
  if (!reason) throw businessError('Motif de sortie de stock invalide', 400);

  const idempotencyKey = isUuid(requestId) ? requestId : null;
  if (idempotencyKey) {
    await lockManualStockOutRequestId(client, { storeId, requestId: idempotencyKey });
    const existing = await getManualStockOutByRequestId(client, { storeId, requestId: idempotencyKey });
    if (existing) {
      return {
        movement: existing,
        lot: { id: existing.lot_id, qty_remaining: Number(existing.lot_qty_remaining || 0) },
        reason,
        duplicate: true,
        warning: reason.code === 'supplier_return' ? supplierReturnWarning() : null,
      };
    }
  }

  const lotResult = await client.query(
    `SELECT l.*, a.unit, a.plu, a.designation
     FROM lots l
     JOIN articles a ON a.id = l.article_id AND a.store_id = l.store_id
     WHERE l.id = $1
       AND l.store_id = $2
       AND l.article_id = $3
     FOR UPDATE OF l`,
    [lotId, storeId, articleId]
  );
  const lot = lotResult.rows[0];
  if (!lot) throw businessError('Lot introuvable pour cet article', 404);

  const available = roundQty(lot.qty_remaining);
  if (available < qty) {
    throw businessError(`Quantite demandee superieure au stock disponible du lot (${available} ${lot.unit || ''})`, 409);
  }

  const updatedLot = await client.query(
    `UPDATE lots
     SET qty_remaining = qty_remaining - $1,
         updated_at = NOW()
     WHERE id = $2
       AND store_id = $3
       AND article_id = $4
       AND qty_remaining >= $1
     RETURNING id, article_id, lot_code, supplier_lot_number, qty_initial, qty_remaining, unit_cost_ex_vat`,
    [qty, lotId, storeId, articleId]
  );
  if (!updatedLot.rows.length) {
    throw businessError('Stock du lot insuffisant ou modifie par un autre utilisateur', 409);
  }

  const movement = await client.query(
    `INSERT INTO stock_movements(
       id, store_id, client_key, article_id, lot_id, movement_type, quantity,
       unit_cost_ex_vat, source_table, source_id, notes, created_by, created_at
     )
     VALUES(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'manual_stock_out', $8, $9, $10, COALESCE($11::timestamptz, NOW()))
     RETURNING *`,
    [
      storeId,
      clientKey,
      articleId,
      lotId,
      reason.movement_type,
      -qty,
      number(lot.unit_cost_ex_vat, 0),
      idempotencyKey,
      manualStockOutNote({ reason, comment, movementDate, userId }),
      userId,
      clean(movementDate),
    ]
  );

  await recomputeArticleStock(client, articleId, storeId);

  return {
    movement: movement.rows[0],
    lot: updatedLot.rows[0],
    reason,
    duplicate: false,
    warning: reason.code === 'supplier_return' ? supplierReturnWarning() : null,
  };
}

async function cancelManualStockOut(client, {
  storeId,
  movementId,
  comment = null,
  userId = null,
}) {
  if (!isUuid(storeId)) throw businessError('Magasin invalide', 400);
  if (!isUuid(movementId)) throw businessError('Mouvement invalide', 400);

  const originalResult = await client.query(
    `SELECT sm.*, l.qty_remaining AS current_lot_qty
     FROM stock_movements sm
     JOIN lots l ON l.id = sm.lot_id AND l.store_id = sm.store_id
     WHERE sm.id = $1
       AND sm.store_id = $2
       AND sm.source_table = 'manual_stock_out'
       AND sm.quantity < 0
       AND sm.movement_type = ANY($3::text[])
     FOR UPDATE OF sm, l`,
    [movementId, storeId, Array.from(MANUAL_STOCK_OUT_MOVEMENT_TYPES)]
  );
  const original = originalResult.rows[0];
  if (!original) throw businessError('Sortie manuelle introuvable ou non annulable', 404);

  const existingCancel = await client.query(
    `SELECT id
     FROM stock_movements
     WHERE store_id = $1
       AND source_table = 'manual_stock_out_cancel'
       AND source_id = $2
     LIMIT 1`,
    [storeId, movementId]
  );
  if (existingCancel.rows.length) throw businessError('Cette sortie de stock est deja annulee', 409);

  const restoreQty = roundQty(Math.abs(number(original.quantity, 0)));
  if (restoreQty <= 0) throw businessError('Quantite du mouvement original invalide', 409);

  const updatedLot = await client.query(
    `UPDATE lots
     SET qty_remaining = qty_remaining + $1,
         updated_at = NOW()
     WHERE id = $2
       AND store_id = $3
       AND article_id = $4
     RETURNING id, article_id, lot_code, supplier_lot_number, qty_initial, qty_remaining, unit_cost_ex_vat`,
    [restoreQty, original.lot_id, storeId, original.article_id]
  );
  if (!updatedLot.rows.length) throw businessError('Lot de la sortie introuvable', 404);

  const movement = await client.query(
    `INSERT INTO stock_movements(
       id, store_id, client_key, article_id, lot_id, movement_type, quantity,
       unit_cost_ex_vat, source_table, source_id, notes, created_by
     )
     VALUES(gen_random_uuid(), $1, $2, $3, $4, 'manual_stock_out_cancel', $5, $6, 'manual_stock_out_cancel', $7, $8, $9)
     RETURNING *`,
    [
      storeId,
      original.client_key || null,
      original.article_id,
      original.lot_id,
      restoreQty,
      number(original.unit_cost_ex_vat, 0),
      original.id,
      cancellationNote({ originalMovementId: original.id, comment, userId }),
      userId,
    ]
  );

  await recomputeArticleStock(client, original.article_id, storeId);

  return {
    movement: movement.rows[0],
    lot: updatedLot.rows[0],
    restored_quantity: restoreQty,
  };
}

function supplierReturnWarning() {
  return 'Retour fournisseur manuel enregistre en stock uniquement. Pour un retour fournisseur avec avoir/comptabilite, utiliser le flux avoir fournisseur existant.';
}

module.exports = {
  MANUAL_STOCK_OUT_REASONS,
  MANUAL_STOCK_OUT_MOVEMENT_TYPES,
  cancelManualStockOut,
  createManualStockOut,
  getManualStockOutReason,
  roundQty,
};
