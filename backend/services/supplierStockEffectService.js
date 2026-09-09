const { recomputeArticleStock } = require('./stockService');

const STOCK_EFFECT_TYPES = new Set(['destruction', 'supplier_return']);

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function num(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fail(message, status = 400, code = undefined, details = undefined) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  if (details) error.details = details;
  throw error;
}

function normalizeStockEffectPayload(payload = {}) {
  return {
    purchaseId: clean(payload.purchase_id),
    purchaseLineId: clean(payload.purchase_line_id),
    lotId: clean(payload.lot_id),
    articleId: clean(payload.article_id),
    supplierId: clean(payload.supplier_id),
    expectedCreditNoteId: clean(payload.supplier_expected_credit_note_id || payload.expected_credit_note_id),
    pennylaneCreditNoteId: clean(payload.pennylane_credit_note_id || payload.credit_note_id),
    quantity: num(payload.quantity, 0),
    reason: clean(payload.reason),
    notes: clean(payload.notes || payload.comment),
    occurredAt: clean(payload.occurred_at),
    idempotencyKey: clean(payload.idempotency_key),
    rawPayload: payload,
  };
}

async function loadOptionalExpectedCreditNote(client, storeId, expectedCreditNoteId) {
  if (!expectedCreditNoteId) return null;
  const result = await client.query(
    `SELECT *
     FROM supplier_expected_credit_notes
     WHERE id = $1 AND store_id = $2
     LIMIT 1`,
    [expectedCreditNoteId, storeId]
  );
  if (!result.rows.length) fail('Attente avoir fournisseur introuvable', 404, 'SUPPLIER_STOCK_EFFECT_EXPECTED_CREDIT_NOTE_NOT_FOUND');
  return result.rows[0];
}

async function loadOptionalPennylaneCreditNote(client, storeId, pennylaneCreditNoteId) {
  if (!pennylaneCreditNoteId) return null;
  const result = await client.query(
    `SELECT *
     FROM pennylane_supplier_invoices
     WHERE id = $1
       AND store_id = $2
       AND document_type = 'credit_note'
       AND pennylane_deleted_at IS NULL
     LIMIT 1`,
    [pennylaneCreditNoteId, storeId]
  );
  if (!result.rows.length) fail('Avoir fournisseur Pennylane introuvable', 404, 'SUPPLIER_STOCK_EFFECT_CREDIT_NOTE_NOT_FOUND');
  return result.rows[0];
}

function validateLinks(effect, lot, expectedCreditNote, pennylaneCreditNote) {
  if (String(lot.article_id) !== String(effect.articleId)) {
    fail('Article incoherent avec le lot selectionne', 409, 'SUPPLIER_STOCK_EFFECT_ARTICLE_MISMATCH');
  }
  if (String(lot.purchase_id) !== String(effect.purchaseId) || String(lot.purchase_line_id) !== String(effect.purchaseLineId)) {
    fail('BL ou ligne incoherent avec le lot selectionne', 409, 'SUPPLIER_STOCK_EFFECT_PURCHASE_MISMATCH');
  }
  if (effect.supplierId && String(lot.supplier_id) !== String(effect.supplierId)) {
    fail('Fournisseur incoherent avec le lot selectionne', 409, 'SUPPLIER_STOCK_EFFECT_SUPPLIER_MISMATCH');
  }
  if (expectedCreditNote) {
    if (String(expectedCreditNote.supplier_id) !== String(lot.supplier_id)) {
      fail('Attente avoir incoherente avec le fournisseur du lot', 409, 'SUPPLIER_STOCK_EFFECT_EXPECTED_SUPPLIER_MISMATCH');
    }
    if (expectedCreditNote.source_purchase_id && String(expectedCreditNote.source_purchase_id) !== String(lot.purchase_id)) {
      fail('Attente avoir incoherente avec le BL', 409, 'SUPPLIER_STOCK_EFFECT_EXPECTED_PURCHASE_MISMATCH');
    }
    if (expectedCreditNote.source_purchase_line_id && String(expectedCreditNote.source_purchase_line_id) !== String(lot.purchase_line_id)) {
      fail('Attente avoir incoherente avec la ligne BL', 409, 'SUPPLIER_STOCK_EFFECT_EXPECTED_LINE_MISMATCH');
    }
  }
  if (pennylaneCreditNote && String(pennylaneCreditNote.supplier_id) !== String(lot.supplier_id)) {
    fail('Avoir Pennylane incoherent avec le fournisseur du lot', 409, 'SUPPLIER_STOCK_EFFECT_CREDIT_SUPPLIER_MISMATCH');
  }
}

async function createSupplierStockEffect(db, { storeId, type, payload = {}, userId = null, clientKey = null }) {
  if (!STOCK_EFFECT_TYPES.has(type)) {
    fail('Type effet stock fournisseur invalide', 400, 'SUPPLIER_STOCK_EFFECT_TYPE_INVALID');
  }
  const effect = normalizeStockEffectPayload(payload);
  if (!effect.purchaseId) fail('purchase_id obligatoire', 400, 'SUPPLIER_STOCK_EFFECT_PURCHASE_REQUIRED');
  if (!effect.purchaseLineId) fail('purchase_line_id obligatoire', 400, 'SUPPLIER_STOCK_EFFECT_LINE_REQUIRED');
  if (!effect.lotId) fail('lot_id obligatoire', 400, 'SUPPLIER_STOCK_EFFECT_LOT_REQUIRED');
  if (!effect.articleId) fail('article_id obligatoire', 400, 'SUPPLIER_STOCK_EFFECT_ARTICLE_REQUIRED');
  if (effect.quantity <= 0) fail('Quantite strictement positive obligatoire', 400, 'SUPPLIER_STOCK_EFFECT_QUANTITY_REQUIRED');

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    if (effect.idempotencyKey) {
      const existing = await client.query(
        `SELECT *
         FROM stock_movements
         WHERE store_id = $1 AND idempotency_key = $2
         LIMIT 1`,
        [storeId, effect.idempotencyKey]
      );
      if (existing.rows.length) {
        await client.query('COMMIT');
        return { idempotent: true, movement: existing.rows[0] };
      }
    }

    const expectedCreditNote = await loadOptionalExpectedCreditNote(client, storeId, effect.expectedCreditNoteId);
    const pennylaneCreditNote = await loadOptionalPennylaneCreditNote(client, storeId, effect.pennylaneCreditNoteId);
    const lotResult = await client.query(
      `SELECT l.*, pl.id AS purchase_line_id, pl.purchase_id, pl.article_id AS purchase_line_article_id,
              p.supplier_id AS purchase_supplier_id
       FROM lots l
       JOIN purchase_lines pl ON pl.id = l.purchase_line_id AND pl.store_id = l.store_id
       JOIN purchases p ON p.id = pl.purchase_id AND p.store_id = pl.store_id
       WHERE l.id = $1
         AND l.store_id = $2
         AND pl.id = $3
         AND pl.purchase_id = $4
       FOR UPDATE OF l`,
      [effect.lotId, storeId, effect.purchaseLineId, effect.purchaseId]
    );
    const lot = lotResult.rows[0];
    if (!lot) fail('Lot achat introuvable', 404, 'SUPPLIER_STOCK_EFFECT_LOT_NOT_FOUND');

    const normalizedLot = {
      ...lot,
      supplier_id: lot.supplier_id || lot.purchase_supplier_id,
      article_id: lot.article_id || lot.purchase_line_article_id,
    };
    validateLinks(effect, normalizedLot, expectedCreditNote, pennylaneCreditNote);
    if (num(normalizedLot.qty_remaining, 0) + 0.0001 < effect.quantity) {
      fail('Quantite superieure au stock disponible du lot', 409, 'SUPPLIER_STOCK_EFFECT_STOCK_INSUFFICIENT', {
        available_quantity: num(normalizedLot.qty_remaining, 0),
      });
    }

    const updateResult = await client.query(
      `UPDATE lots
       SET qty_remaining = qty_remaining - $1::numeric,
           updated_at = NOW()
       WHERE id = $2
         AND store_id = $3
         AND qty_remaining + 0.0001 >= $1::numeric
       RETURNING *`,
      [effect.quantity, normalizedLot.id, storeId]
    );
    if (!updateResult.rows.length) {
      fail('Stock lot insuffisant apres verrouillage', 409, 'SUPPLIER_STOCK_EFFECT_CONCURRENT_STOCK_INSUFFICIENT');
    }

    const movementResult = await client.query(
      `INSERT INTO stock_movements(
         id, store_id, client_key, article_id, lot_id, movement_type, quantity,
         unit_cost_ex_vat, source_table, source_id, notes, created_by,
         purchase_id, purchase_line_id, supplier_id, supplier_expected_credit_note_id,
         pennylane_credit_note_id, reason, occurred_at, idempotency_key, raw_payload
       )
       VALUES(
         gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7,
         'supplier_control_stock_effects', COALESCE($8::uuid, $9::uuid, $4::uuid), $10, $11,
         $12, $13, $14, $8, $9, $15, COALESCE($16::timestamptz, NOW()), $17, $18::jsonb
       )
       RETURNING *`,
      [
        storeId,
        normalizedLot.client_key || clientKey || null,
        normalizedLot.article_id,
        normalizedLot.id,
        type,
        -effect.quantity,
        num(normalizedLot.unit_cost_ex_vat, 0),
        effect.expectedCreditNoteId,
        effect.pennylaneCreditNoteId,
        effect.notes || (type === 'supplier_return' ? 'Retour fournisseur explicite' : 'Destruction/perte explicite'),
        userId,
        normalizedLot.purchase_id,
        normalizedLot.purchase_line_id,
        normalizedLot.supplier_id,
        effect.reason || type,
        effect.occurredAt,
        effect.idempotencyKey,
        JSON.stringify(effect.rawPayload || {}),
      ]
    );
    const movement = movementResult.rows[0];

    if (effect.expectedCreditNoteId) {
      await client.query(
        `INSERT INTO supplier_control_events(
           id, store_id, pennylane_supplier_invoice_id, event_type, event_key, payload, created_by
         )
         VALUES(gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (store_id, pennylane_supplier_invoice_id, event_key) DO NOTHING`,
        [
          storeId,
          expectedCreditNote?.source_pennylane_supplier_invoice_id || effect.pennylaneCreditNoteId,
          type === 'supplier_return' ? 'supplier_stock_return_created' : 'supplier_stock_destruction_created',
          `supplier_stock_effect:${movement.id}`,
          JSON.stringify({
            movement_id: movement.id,
            movement_type: type,
            quantity: effect.quantity,
            article_id: normalizedLot.article_id,
            lot_id: normalizedLot.id,
            purchase_id: normalizedLot.purchase_id,
            purchase_line_id: normalizedLot.purchase_line_id,
            supplier_expected_credit_note_id: effect.expectedCreditNoteId,
            pennylane_credit_note_id: effect.pennylaneCreditNoteId,
          }),
          userId,
        ]
      );
    }

    await recomputeArticleStock(client, normalizedLot.article_id, storeId);
    await client.query('COMMIT');

    return {
      idempotent: false,
      movement,
      lot: updateResult.rows[0],
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function listStockEffectsForExpectedCreditNote(db, { storeId, expectedCreditNoteId }) {
  const result = await db.query(
    `SELECT sm.*, a.plu AS article_plu, a.designation AS article_name,
            l.lot_code, l.supplier_lot_number, p.bl_number
     FROM stock_movements sm
     LEFT JOIN articles a ON a.id = sm.article_id AND a.store_id = sm.store_id
     LEFT JOIN lots l ON l.id = sm.lot_id AND l.store_id = sm.store_id
     LEFT JOIN purchases p ON p.id = sm.purchase_id AND p.store_id = sm.store_id
     WHERE sm.store_id = $1
       AND sm.supplier_expected_credit_note_id = $2
       AND sm.movement_type IN ('destruction', 'supplier_return')
     ORDER BY sm.created_at DESC`,
    [storeId, expectedCreditNoteId]
  );
  return {
    stock_effects: result.rows,
    totals: result.rows.reduce((acc, row) => {
      const qty = Math.abs(num(row.quantity, 0));
      if (row.movement_type === 'supplier_return') acc.supplier_return_quantity += qty;
      if (row.movement_type === 'destruction') acc.destruction_quantity += qty;
      acc.total_quantity += qty;
      return acc;
    }, { total_quantity: 0, supplier_return_quantity: 0, destruction_quantity: 0 }),
  };
}

module.exports = {
  STOCK_EFFECT_TYPES,
  createSupplierStockEffect,
  listStockEffectsForExpectedCreditNote,
  normalizeStockEffectPayload,
};
