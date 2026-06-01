const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const { recomputeArticleStock } = require('../services/stockService');

const router = express.Router();

const clean = (value) => (value === undefined || value === null ? null : String(value).trim() || null);
const num = (value, fallback = 0) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
};
const pos = (value, fallback = 0) => Math.max(num(value, fallback), 0);
const forceRequested = (body = {}) => body.allow_negative_stock === true || body.force_stock_exit === true;

function stockInsufficientError({ line, missingQuantity, articleId, lotId, documentId }) {
  const error = new Error(`Stock insuffisant ligne ${line?.line_number || ''}`.trim());
  error.status = 409;
  error.code = 'STOCK_INSUFFICIENT';
  error.payload = {
    code: 'STOCK_INSUFFICIENT',
    message: error.message,
    error: error.message,
    line: line?.line_number || null,
    details: {
      stock_forced: false,
      missing_quantity: Number(missingQuantity.toFixed(3)),
      article_id: articleId || null,
      lot_id: lotId || null,
      document_id: documentId || null,
      line_id: line?.id || null,
    },
  };
  return error;
}

function errorBody(err, fallback) {
  return err.payload || {
    error: err.message || fallback,
    message: err.message || fallback,
    ...(err.code ? { code: err.code } : {}),
    ...(err.details ? { details: err.details } : {}),
  };
}

async function getClientSnapshot(db, storeId, clientId) {
  const result = await db.query(
    `SELECT c.id, c.code, c.name, c.tariff_level, c.vat_rate, c.is_vat_exempt, c.store_identifier,
      COALESCE(c.billed_client_id, c.id) AS billed_client_id,
      billed.code AS billed_client_code, billed.name AS billed_client_name
     FROM clients c
     LEFT JOIN clients billed ON billed.id = COALESCE(c.billed_client_id, c.id) AND billed.store_id = c.store_id
     WHERE c.id = $1 AND c.store_id = $2 AND c.status <> 'inactive'
     LIMIT 1`,
    [clientId, storeId]
  );
  if (!result.rows.length) {
    const error = new Error('Client livre introuvable pour ce magasin');
    error.status = 400;
    throw error;
  }
  return result.rows[0];
}

async function validateOrderWithoutStock(db, { orderId, storeId, userId }) {
  const orderResult = await db.query(
    `SELECT * FROM sales_documents WHERE id = $1 AND store_id = $2 AND document_type = 'ORDER' FOR UPDATE`,
    [orderId, storeId]
  );
  if (!orderResult.rows.length) {
    const error = new Error('Commande introuvable');
    error.status = 404;
    throw error;
  }
  const order = orderResult.rows[0];
  if (!['draft', 'validated'].includes(order.status)) {
    const error = new Error('Commande non validable en BL');
    error.status = 400;
    throw error;
  }

  const count = await db.query(`SELECT COUNT(*)::int AS count FROM sales_lines WHERE sales_document_id = $1`, [order.id]);
  if (!count.rows[0].count) {
    const error = new Error('Impossible de valider une commande sans ligne');
    error.status = 400;
    throw error;
  }

  if (order.status === 'draft') {
    await db.query(
      `UPDATE sales_lines SET line_status = 'ordered', updated_by = $1, updated_at = NOW() WHERE sales_document_id = $2`,
      [userId, order.id]
    );
    await db.query(
      `UPDATE sales_documents SET status = 'validated', validated_at = NOW(), updated_by = $1, updated_at = NOW() WHERE id = $2`,
      [userId, order.id]
    );
  }

  return { ...order, status: 'validated' };
}

async function createDeliveryNoteFromOrder(db, { orderId, storeId, clientKey, userId, notes, referenceNumber }) {
  const existing = await db.query(
    `SELECT id FROM sales_documents WHERE store_id = $1 AND source_order_id = $2 AND document_type = 'DELIVERY_NOTE' LIMIT 1`,
    [storeId, orderId]
  );
  if (existing.rows.length) return { id: existing.rows[0].id, existing: true };

  const orderResult = await db.query(
    `SELECT * FROM sales_documents WHERE id = $1 AND store_id = $2 AND document_type = 'ORDER' FOR UPDATE`,
    [orderId, storeId]
  );
  if (!orderResult.rows.length) {
    const error = new Error('Commande introuvable');
    error.status = 404;
    throw error;
  }
  const order = orderResult.rows[0];
  if (order.status !== 'validated') {
    const error = new Error('La commande doit etre validee avant generation du BL');
    error.status = 400;
    throw error;
  }

  const sourceLines = await db.query(`SELECT * FROM sales_lines WHERE sales_document_id = $1 ORDER BY line_number ASC`, [order.id]);
  if (!sourceLines.rows.length) {
    const error = new Error('Impossible de generer un BL sans ligne');
    error.status = 400;
    throw error;
  }

  const client = await getClientSnapshot(db, storeId, order.client_id);
  const reference = clean(referenceNumber) || `BL-${new Date().toISOString().slice(0, 10)}-${String(order.id).slice(0, 8)}`;
  const origin = order.origin === 'negoce' ? 'negoce' : 'order';
  const created = await db.query(
    `INSERT INTO sales_documents (
      id, store_id, client_key, client_id, billed_client_id, source_order_id,
      document_date, status, document_type, origin, reference_number, notes,
      total_amount_ex_vat, total_vat_amount, total_amount_inc_vat,
      tariff_level_snapshot, vat_rate_snapshot, is_vat_exempt_snapshot,
      delivered_client_name_snapshot, delivered_client_code_snapshot, delivered_client_store_identifier,
      billed_client_name_snapshot, billed_client_code_snapshot, created_by, updated_by
    ) VALUES (
      gen_random_uuid(), $1, $2, $3, $4, $5,
      CURRENT_DATE, 'draft', 'DELIVERY_NOTE', $6, $7, $8,
      $9, $10, $11, $12, $13, $14,
      $15, $16, $17, $18, $19, $20, $20
    ) RETURNING id`,
    [
      storeId, order.client_key || clientKey || null, order.client_id, client.billed_client_id || order.client_id,
      order.id, origin, reference, clean(notes) || order.notes, order.total_amount_ex_vat, order.total_vat_amount,
      order.total_amount_inc_vat, order.tariff_level_snapshot || client.tariff_level || 1,
      order.vat_rate_snapshot || client.vat_rate || 5.5, order.is_vat_exempt_snapshot || client.is_vat_exempt || false,
      client.name, client.code, client.store_identifier, client.billed_client_name || client.name,
      client.billed_client_code || client.code, userId,
    ]
  );

  const deliveryNoteId = created.rows[0].id;
  for (const line of sourceLines.rows) {
    await db.query(
      `INSERT INTO sales_lines (
        id, store_id, client_key, sales_document_id, line_number, article_id, article_plu, article_label,
        package_count, weight_per_package, total_weight, sold_quantity, sale_unit,
        unit_sale_price_ht, unit_sale_price_ttc, vat_rate, line_amount_ht, line_vat_amount, line_amount_ttc,
        unit_cost_ex_vat, line_margin_ex_vat, selected_lot_id, suggested_lot_id, traceability_snapshot,
        line_status, created_by, updated_by
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23::jsonb, 'pending', $24, $24
      )`,
      [
        storeId, line.client_key || order.client_key || clientKey || null, deliveryNoteId, line.line_number,
        line.article_id, line.article_plu, line.article_label, line.package_count, line.weight_per_package,
        line.total_weight, line.sold_quantity, line.sale_unit, line.unit_sale_price_ht, line.unit_sale_price_ttc,
        line.vat_rate, line.line_amount_ht, line.line_vat_amount, line.line_amount_ttc, line.unit_cost_ex_vat,
        line.line_margin_ex_vat, line.selected_lot_id, line.suggested_lot_id, JSON.stringify(line.traceability_snapshot || {}), userId,
      ]
    );
  }
  return { id: deliveryNoteId, existing: false };
}

async function recordForcedStockExit(db, { storeId, clientKey, articleId, lotId, documentId, line, missingQuantity, unitCost, userId }) {
  const notes = JSON.stringify({
    forced_stock_exit: true,
    stock_forced: true,
    missing_quantity: Number(missingQuantity.toFixed(3)),
    article_id: articleId || null,
    lot_id: lotId || null,
    document_id: documentId,
    line_id: line?.id || null,
    user_id: userId || null,
    created_at: new Date().toISOString(),
    forced_at: new Date().toISOString(),
  });
  await db.query(
    `INSERT INTO stock_movements(id, store_id, client_key, article_id, lot_id, movement_type, quantity, unit_cost_ex_vat, source_table, source_id, notes, created_by)
     VALUES(gen_random_uuid(), $1, $2, $3, $4, 'sale_out', $5, $6, 'sales_documents', $7, $8, $9)`,
    [storeId, clientKey || null, articleId, lotId || null, -missingQuantity, num(unitCost), documentId, notes, userId]
  );
}

async function validateDeliveryNoteStock(db, { deliveryNoteId, storeId, clientKey, userId, allowNegativeStock = false }) {
  const document = await db.query(
    `SELECT * FROM sales_documents WHERE id = $1 AND store_id = $2 AND document_type = 'DELIVERY_NOTE' FOR UPDATE`,
    [deliveryNoteId, storeId]
  );
  if (!document.rows.length) {
    const error = new Error('BL introuvable');
    error.status = 404;
    throw error;
  }
  const deliveryNote = document.rows[0];
  if (deliveryNote.status !== 'draft') return { allocated: 0, alreadyValidated: true };

  const lines = await db.query(`SELECT * FROM sales_lines WHERE sales_document_id = $1 ORDER BY line_number ASC FOR UPDATE`, [deliveryNote.id]);
  if (!lines.rows.length) {
    const error = new Error('Impossible de valider un BL sans ligne');
    error.status = 400;
    throw error;
  }

  let allocated = 0;
  const articles = new Set();
  const skipStock = deliveryNote.origin === 'negoce';
  for (const line of lines.rows) {
    let remaining = pos(line.sold_quantity || line.total_weight, 0);
    if (!skipStock && line.article_id && remaining > 0) {
      const lots = line.selected_lot_id
        ? await db.query(`SELECT * FROM lots WHERE store_id = $1 AND article_id = $2 AND id = $3 AND qty_remaining > 0 FOR UPDATE`, [storeId, line.article_id, line.selected_lot_id])
        : await db.query(`SELECT * FROM lots WHERE store_id = $1 AND article_id = $2 AND qty_remaining > 0 ORDER BY COALESCE(dlc, DATE '9999-12-31'), created_at, id FOR UPDATE`, [storeId, line.article_id]);

      for (const lot of lots.rows) {
        if (remaining <= 0) break;
        const quantity = Math.min(remaining, num(lot.qty_remaining));
        if (quantity <= 0) continue;
        await db.query(`UPDATE lots SET qty_remaining = qty_remaining - $1, updated_at = NOW() WHERE id = $2`, [quantity, lot.id]);
        await db.query(`INSERT INTO sale_line_allocations(id, sales_line_id, lot_id, quantity, unit_cost_ex_vat) VALUES(gen_random_uuid(), $1, $2, $3, $4)`, [line.id, lot.id, quantity, num(lot.unit_cost_ex_vat)]);
        await db.query(
          `INSERT INTO stock_movements(id, store_id, client_key, article_id, lot_id, movement_type, quantity, unit_cost_ex_vat, source_table, source_id, notes, created_by)
           VALUES(gen_random_uuid(), $1, $2, $3, $4, 'sale_out', $5, $6, 'sales_documents', $7, $8, $9)`,
          [storeId, deliveryNote.client_key || clientKey || null, line.article_id, lot.id, -quantity, num(lot.unit_cost_ex_vat), deliveryNote.id, `Validation BL ${deliveryNote.reference_number || deliveryNote.id}`, userId]
        );
        remaining = Number((remaining - quantity).toFixed(3));
        allocated += 1;
      }
      if (remaining > 0) {
        if (!allowNegativeStock) {
          throw stockInsufficientError({ line, missingQuantity: remaining, articleId: line.article_id, lotId: line.selected_lot_id, documentId: deliveryNote.id });
        }
        await recordForcedStockExit(db, {
          storeId,
          clientKey: deliveryNote.client_key || clientKey || null,
          articleId: line.article_id,
          lotId: line.selected_lot_id || null,
          documentId: deliveryNote.id,
          line,
          missingQuantity: remaining,
          unitCost: line.unit_cost_ex_vat,
          userId,
        });
        remaining = 0;
        allocated += 1;
      }
      articles.add(line.article_id);
    }
    await db.query(`UPDATE sales_lines SET line_status = 'validated', updated_by = $1, updated_at = NOW() WHERE id = $2`, [userId, line.id]);
  }

  await db.query(`UPDATE sales_documents SET status = 'validated', validated_at = NOW(), updated_by = $1, updated_at = NOW() WHERE id = $2`, [userId, deliveryNote.id]);
  if (deliveryNote.source_order_id) {
    await db.query(`UPDATE sales_documents SET status = 'delivered', updated_by = $1, updated_at = NOW() WHERE id = $2 AND store_id = $3 AND document_type = 'ORDER'`, [userId, deliveryNote.source_order_id, storeId]);
  }
  for (const articleId of articles) await recomputeArticleStock(db, articleId, storeId);
  return { allocated, alreadyValidated: false };
}

router.post('/sales/:id/validate-delivery-note', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const allowNegativeStock = forceRequested(req.body || {});
    await validateOrderWithoutStock(db, { orderId: req.params.id, storeId: req.user.store_id, userId: req.user.id });
    const deliveryNote = await createDeliveryNoteFromOrder(db, { orderId: req.params.id, storeId: req.user.store_id, clientKey: req.user.client_key, userId: req.user.id, notes: req.body?.notes, referenceNumber: req.body?.reference_number });
    const validation = await validateDeliveryNoteStock(db, { deliveryNoteId: deliveryNote.id, storeId: req.user.store_id, clientKey: req.user.client_key, userId: req.user.id, allowNegativeStock });
    await db.query('COMMIT');
    res.json({ ok: true, delivery_note_id: deliveryNote.id, allocated: validation.allocated, existing: deliveryNote.existing, forced_stock_exit: allowNegativeStock });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur validation commande en BL forceable :', err);
    res.status(err.status || 500).json(errorBody(err, 'Erreur validation en BL'));
  } finally {
    db.release();
  }
});

router.post('/delivery-notes/:id/validate', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const allowNegativeStock = forceRequested(req.body || {});
    const validation = await validateDeliveryNoteStock(db, { deliveryNoteId: req.params.id, storeId: req.user.store_id, clientKey: req.user.client_key, userId: req.user.id, allowNegativeStock });
    await db.query('COMMIT');
    res.json({ ok: true, allocated: validation.allocated, already_validated: validation.alreadyValidated, forced_stock_exit: allowNegativeStock });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur validation BL forceable :', err);
    res.status(err.status || 500).json(errorBody(err, 'Erreur validation BL'));
  } finally {
    db.release();
  }
});

module.exports = router;
