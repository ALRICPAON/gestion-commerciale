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

function deliveryNoteSelect() {
  return `
    SELECT dn.*, delivered.name AS client_name, delivered.code AS client_code,
      delivered.address_line1, delivered.address_line2, delivered.postal_code, delivered.city,
      delivered.store_identifier AS client_store_identifier,
      billed.name AS billed_client_name, billed.code AS billed_client_code,
      src.reference_number AS source_order_reference, invoice.id AS invoice_id,
      invoice.reference_number AS invoice_reference, COUNT(sl.id) AS line_count
    FROM sales_documents dn
    LEFT JOIN clients delivered ON delivered.id = dn.client_id AND delivered.store_id = dn.store_id
    LEFT JOIN clients billed ON billed.id = dn.billed_client_id AND billed.store_id = dn.store_id
    LEFT JOIN sales_documents src ON src.id = dn.source_order_id AND src.store_id = dn.store_id
    LEFT JOIN sales_documents invoice ON invoice.source_delivery_note_id = dn.id AND invoice.store_id = dn.store_id AND invoice.document_type = 'INVOICE'
    LEFT JOIN sales_lines sl ON sl.sales_document_id = dn.id
  `;
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
      CURRENT_DATE, 'draft', 'DELIVERY_NOTE', 'order', $6, $7,
      $8, $9, $10, $11, $12, $13,
      $14, $15, $16, $17, $18, $19, $19
    ) RETURNING id`,
    [
      storeId, order.client_key || clientKey || null, order.client_id, client.billed_client_id || order.client_id,
      order.id, reference, clean(notes) || order.notes, order.total_amount_ex_vat, order.total_vat_amount,
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

async function validateDeliveryNoteStock(db, { deliveryNoteId, storeId, clientKey, userId }) {
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
  for (const line of lines.rows) {
    let remaining = pos(line.sold_quantity || line.total_weight, 0);
    if (!line.article_id || remaining <= 0) continue;
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
      const error = new Error(`Stock insuffisant ligne ${line.line_number}`);
      error.status = 400;
      throw error;
    }
    await db.query(`UPDATE sales_lines SET line_status = 'validated', updated_by = $1, updated_at = NOW() WHERE id = $2`, [userId, line.id]);
    articles.add(line.article_id);
  }

  await db.query(`UPDATE sales_documents SET status = 'validated', locked_at = NOW(), validated_at = NOW(), updated_by = $1, updated_at = NOW() WHERE id = $2`, [userId, deliveryNote.id]);
  if (deliveryNote.source_order_id) {
    await db.query(`UPDATE sales_documents SET status = 'delivered', locked_at = NOW(), updated_by = $1, updated_at = NOW() WHERE id = $2 AND store_id = $3 AND document_type = 'ORDER'`, [userId, deliveryNote.source_order_id, storeId]);
  }
  for (const articleId of articles) await recomputeArticleStock(db, articleId, storeId);
  return { allocated, alreadyValidated: false };
}

router.post('/sales/:id/validate', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    await validateOrderWithoutStock(db, { orderId: req.params.id, storeId: req.user.store_id, userId: req.user.id });
    await db.query('COMMIT');
    res.json({ ok: true, message: 'Commande validee sans destockage' });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    res.status(err.status || 500).json({ error: err.message || 'Erreur validation commande' });
  } finally {
    db.release();
  }
});

router.post('/sales/:id/validate-delivery-note', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    await validateOrderWithoutStock(db, { orderId: req.params.id, storeId: req.user.store_id, userId: req.user.id });
    const deliveryNote = await createDeliveryNoteFromOrder(db, { orderId: req.params.id, storeId: req.user.store_id, clientKey: req.user.client_key, userId: req.user.id, notes: req.body.notes, referenceNumber: req.body.reference_number });
    const validation = await validateDeliveryNoteStock(db, { deliveryNoteId: deliveryNote.id, storeId: req.user.store_id, clientKey: req.user.client_key, userId: req.user.id });
    await db.query('COMMIT');
    res.json({ ok: true, delivery_note_id: deliveryNote.id, allocated: validation.allocated, existing: deliveryNote.existing });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur validation commande en BL :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur validation en BL' });
  } finally {
    db.release();
  }
});

router.get('/delivery-notes', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const params = [req.user.store_id];
    const where = [`dn.store_id = $1`, `dn.document_type = 'DELIVERY_NOTE'`];
    if (clean(req.query.status)) { params.push(clean(req.query.status)); where.push(`dn.status = $${params.length}`); }
    params.push(Math.min(Number(req.query.limit) || 200, 1000));
    const result = await req.dbPool.query(`${deliveryNoteSelect()} WHERE ${where.join(' AND ')} GROUP BY dn.id, delivered.name, delivered.code, delivered.address_line1, delivered.address_line2, delivered.postal_code, delivered.city, delivered.store_identifier, billed.name, billed.code, src.reference_number, invoice.id, invoice.reference_number ORDER BY dn.created_at DESC LIMIT $${params.length}`, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/delivery-notes :', err);
    res.status(500).json({ error: 'Erreur serveur bons de livraison' });
  }
});

router.get('/delivery-notes/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const document = await req.dbPool.query(`${deliveryNoteSelect()} WHERE dn.id = $1 AND dn.store_id = $2 AND dn.document_type = 'DELIVERY_NOTE' GROUP BY dn.id, delivered.name, delivered.code, delivered.address_line1, delivered.address_line2, delivered.postal_code, delivered.city, delivered.store_identifier, billed.name, billed.code, src.reference_number, invoice.id, invoice.reference_number`, [req.params.id, req.user.store_id]);
    if (!document.rows.length) return res.status(404).json({ error: 'BL introuvable' });
    const lines = await req.dbPool.query(`SELECT * FROM sales_lines WHERE sales_document_id = $1 ORDER BY line_number ASC`, [req.params.id]);
    res.json({ ...document.rows[0], lines: lines.rows });
  } catch (err) {
    console.error('Erreur GET /api/delivery-notes/:id :', err);
    res.status(500).json({ error: 'Erreur serveur bon de livraison' });
  }
});

router.post('/sales/:id/delivery-note', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const deliveryNote = await createDeliveryNoteFromOrder(db, { orderId: req.params.id, storeId: req.user.store_id, clientKey: req.user.client_key, userId: req.user.id, notes: req.body.notes, referenceNumber: req.body.reference_number });
    await db.query('COMMIT');
    res.status(deliveryNote.existing ? 200 : 201).json({ ok: true, id: deliveryNote.id, existing: deliveryNote.existing });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    res.status(err.status || 500).json({ error: err.message || 'Erreur generation BL' });
  } finally {
    db.release();
  }
});

router.post('/delivery-notes/:id/validate', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const validation = await validateDeliveryNoteStock(db, { deliveryNoteId: req.params.id, storeId: req.user.store_id, clientKey: req.user.client_key, userId: req.user.id });
    await db.query('COMMIT');
    res.json({ ok: true, allocated: validation.allocated, already_validated: validation.alreadyValidated });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur validation BL :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur validation BL' });
  } finally {
    db.release();
  }
});

router.post('/delivery-notes/:id/validate-invoice', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const noteResult = await db.query(`SELECT * FROM sales_documents WHERE id = $1 AND store_id = $2 AND document_type = 'DELIVERY_NOTE' FOR UPDATE`, [req.params.id, req.user.store_id]);
    if (!noteResult.rows.length) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'BL introuvable' }); }
    const note = noteResult.rows[0];
    if (!['validated', 'invoiced'].includes(note.status)) { await db.query('ROLLBACK'); return res.status(400).json({ error: 'Le BL doit etre valide avant facturation' }); }
    const existing = await db.query(`SELECT id FROM sales_documents WHERE store_id = $1 AND source_delivery_note_id = $2 AND document_type = 'INVOICE' LIMIT 1`, [req.user.store_id, note.id]);
    if (existing.rows.length) { await db.query('COMMIT'); return res.json({ ok: true, invoice_id: existing.rows[0].id, existing: true }); }
    const invoice = await db.query(
      `INSERT INTO sales_documents (id, store_id, client_key, client_id, billed_client_id, source_order_id, source_delivery_note_id, document_date, status, document_type, origin, reference_number, notes, total_amount_ex_vat, total_vat_amount, total_amount_inc_vat, tariff_level_snapshot, vat_rate_snapshot, is_vat_exempt_snapshot, delivered_client_name_snapshot, delivered_client_code_snapshot, delivered_client_store_identifier, billed_client_name_snapshot, billed_client_code_snapshot, created_by, updated_by)
       VALUES (gen_random_uuid(), $1, $2, COALESCE($3, $4), COALESCE($3, $4), $5, $6, CURRENT_DATE, 'draft', 'INVOICE', 'delivery_note', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $20) RETURNING id`,
      [req.user.store_id, note.client_key || req.user.client_key || null, note.billed_client_id, note.client_id, note.source_order_id, note.id, clean(req.body.reference_number), note.notes, note.total_amount_ex_vat, note.total_vat_amount, note.total_amount_inc_vat, note.tariff_level_snapshot, note.vat_rate_snapshot, note.is_vat_exempt_snapshot, note.delivered_client_name_snapshot, note.delivered_client_code_snapshot, note.delivered_client_store_identifier, note.billed_client_name_snapshot, note.billed_client_code_snapshot, req.user.id]
    );
    const lines = await db.query(`SELECT * FROM sales_lines WHERE sales_document_id = $1 ORDER BY line_number`, [note.id]);
    for (const line of lines.rows) {
      await db.query(`INSERT INTO sales_lines (id, store_id, client_key, sales_document_id, line_number, article_id, article_plu, article_label, package_count, weight_per_package, total_weight, sold_quantity, sale_unit, unit_sale_price_ht, unit_sale_price_ttc, vat_rate, line_amount_ht, line_vat_amount, line_amount_ttc, unit_cost_ex_vat, line_margin_ex_vat, selected_lot_id, suggested_lot_id, traceability_snapshot, line_status, created_by, updated_by) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23::jsonb, 'pending', $24, $24)`, [req.user.store_id, line.client_key || note.client_key || req.user.client_key || null, invoice.rows[0].id, line.line_number, line.article_id, line.article_plu, line.article_label, line.package_count, line.weight_per_package, line.total_weight, line.sold_quantity, line.sale_unit, line.unit_sale_price_ht, line.unit_sale_price_ttc, line.vat_rate, line.line_amount_ht, line.line_vat_amount, line.line_amount_ttc, line.unit_cost_ex_vat, line.line_margin_ex_vat, line.selected_lot_id, line.suggested_lot_id, JSON.stringify(line.traceability_snapshot || {}), req.user.id]);
    }
    await db.query(`UPDATE sales_documents SET status = 'invoiced', invoiced_at = NOW(), locked_at = COALESCE(locked_at, NOW()), updated_by = $1, updated_at = NOW() WHERE id = $2`, [req.user.id, note.id]);
    await db.query('COMMIT');
    res.json({ ok: true, invoice_id: invoice.rows[0].id, existing: false });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur validation facture BL :', err);
    res.status(500).json({ error: err.message || 'Erreur validation facture' });
  } finally {
    db.release();
  }
});

async function getPrintableDeliveryNote(req, res, withPrintedAt = false) {
  const document = await req.dbPool.query(
    `${deliveryNoteSelect()} WHERE dn.id = $1 AND dn.store_id = $2 AND dn.document_type = 'DELIVERY_NOTE' GROUP BY dn.id, delivered.name, delivered.code, delivered.address_line1, delivered.address_line2, delivered.postal_code, delivered.city, delivered.store_identifier, billed.name, billed.code, src.reference_number, invoice.id, invoice.reference_number`,
    [req.params.id, req.user.store_id]
  );
  if (!document.rows.length) return res.status(404).json({ error: 'BL introuvable' });
  const lines = await req.dbPool.query(
    `SELECT sl.*, COALESCE(SUM(sla.quantity), 0) AS allocated_quantity,
      jsonb_agg(jsonb_build_object('lot_id', sla.lot_id, 'quantity', sla.quantity, 'lot_code', l.lot_code, 'supplier_lot_number', l.supplier_lot_number, 'dlc', l.dlc)) FILTER (WHERE sla.id IS NOT NULL) AS allocations
     FROM sales_lines sl
     LEFT JOIN sale_line_allocations sla ON sla.sales_line_id = sl.id
     LEFT JOIN lots l ON l.id = sla.lot_id
     WHERE sl.sales_document_id = $1
     GROUP BY sl.id
     ORDER BY sl.line_number ASC`,
    [req.params.id]
  );
  if (withPrintedAt) await req.dbPool.query(`UPDATE sales_documents SET printed_at = COALESCE(printed_at, NOW()) WHERE id = $1`, [req.params.id]);
  return res.json({ document: document.rows[0], lines: lines.rows });
}

router.get('/delivery-notes/:id/print-data', authenticateToken, attachDbContext, async (req, res) => {
  try { await getPrintableDeliveryNote(req, res, true); }
  catch (err) { console.error('Erreur print-data BL :', err); res.status(500).json({ error: 'Erreur preparation impression BL' }); }
});

router.get('/delivery-notes/:id/health-labels', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const note = await req.dbPool.query(`SELECT dn.id, dn.reference_number, dn.document_date, COALESCE(dn.delivered_client_name_snapshot, c.name) AS delivered_client_name, COALESCE(dn.delivered_client_code_snapshot, c.code) AS delivered_client_code, COALESCE(dn.delivered_client_store_identifier, c.store_identifier) AS delivered_client_store_identifier FROM sales_documents dn LEFT JOIN clients c ON c.id = dn.client_id AND c.store_id = dn.store_id WHERE dn.id = $1 AND dn.store_id = $2 AND dn.document_type = 'DELIVERY_NOTE' LIMIT 1`, [req.params.id, req.user.store_id]);
    if (!note.rows.length) return res.status(404).json({ error: 'BL introuvable' });
    const lines = await req.dbPool.query(`SELECT sl.line_number, sl.article_plu, sl.article_label, sl.package_count, sl.total_weight, sl.sale_unit, sl.traceability_snapshot, COALESCE(SUM(sla.quantity), sl.sold_quantity, sl.total_weight) AS label_quantity, jsonb_agg(jsonb_build_object('lot_code', l.lot_code, 'supplier_lot_number', l.supplier_lot_number, 'dlc', l.dlc, 'quantity', sla.quantity)) FILTER (WHERE sla.id IS NOT NULL) AS lots FROM sales_lines sl LEFT JOIN sale_line_allocations sla ON sla.sales_line_id = sl.id LEFT JOIN lots l ON l.id = sla.lot_id WHERE sl.sales_document_id = $1 GROUP BY sl.id ORDER BY sl.line_number ASC`, [req.params.id]);
    const labels = lines.rows.map((line) => ({ delivery_note_id: note.rows[0].id, delivery_note_reference: note.rows[0].reference_number, delivery_date: note.rows[0].document_date, delivered_client_name: note.rows[0].delivered_client_name, delivered_client_code: note.rows[0].delivered_client_code, delivered_client_store_identifier: note.rows[0].delivered_client_store_identifier, line_number: line.line_number, article_plu: line.article_plu, article_label: line.article_label, quantity: num(line.label_quantity), unit: line.sale_unit || 'kg', package_count: num(line.package_count), traceability: line.traceability_snapshot || {}, lots: line.lots || [] }));
    res.json({ delivery_note: note.rows[0], labels });
  } catch (err) {
    console.error('Erreur etiquettes sanitaires BL :', err);
    res.status(500).json({ error: 'Erreur preparation etiquettes sanitaires' });
  }
});

module.exports = router;
