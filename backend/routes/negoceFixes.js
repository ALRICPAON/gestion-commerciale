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
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
const uuidOrNull = (value) => {
  const cleaned = clean(value);
  return cleaned && isUuid(cleaned) ? cleaned : null;
};

async function articleByInput(db, storeId, body = {}) {
  const articleId = uuidOrNull(body.article_id);
  const plu = clean(body.article_plu);
  if (!articleId && !plu) return null;
  const params = [storeId];
  let where = 'a.store_id = $1 AND a.is_active = true';
  if (articleId) {
    params.push(articleId);
    where += ` AND a.id = $${params.length}`;
  } else {
    params.push(plu);
    where += ` AND a.plu = $${params.length}`;
  }
  const result = await db.query(
    `SELECT a.*, COALESCE(ss.pma, 0) AS pma
     FROM articles a
     LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
     WHERE ${where}
     LIMIT 1`,
    params
  );
  return result.rows[0] || null;
}

function traceFrom(row) {
  if (!row) return {};
  return {
    lot_id: row.lot_id || row.id || null,
    lot_code: row.lot_code || null,
    supplier_lot_number: row.supplier_lot_number || null,
    dlc: row.dlc || null,
    latin_name: row.traceability_data?.latin_name || row.latin_name || null,
    fao_zone: row.traceability_data?.fao_zone || row.fao_zone || null,
    sous_zone: row.traceability_data?.sous_zone || row.sous_zone || null,
    fishing_gear: row.traceability_data?.fishing_gear || row.fishing_gear || null,
    production_method: row.traceability_data?.production_method || row.production_method || null,
    allergens: row.traceability_data?.allergens || row.allergens || null,
    available_quantity: row.qty_remaining === undefined ? null : num(row.qty_remaining),
  };
}

async function validateNegoceDeliveryNote(db, { deliveryNoteId, storeId, clientKey, userId }) {
  const document = await db.query(
    `SELECT * FROM sales_documents WHERE id = $1 AND store_id = $2 AND document_type = 'DELIVERY_NOTE' FOR UPDATE`,
    [deliveryNoteId, storeId]
  );
  if (!document.rows.length) {
    const error = new Error('BL introuvable');
    error.status = 404;
    throw error;
  }
  const note = document.rows[0];
  if (note.origin !== 'negoce') return null;
  if (note.status !== 'draft') return { allocated: 0, alreadyValidated: true };

  const lines = await db.query(`SELECT * FROM sales_lines WHERE sales_document_id = $1 ORDER BY line_number ASC FOR UPDATE`, [note.id]);
  if (!lines.rows.length) {
    const error = new Error('Impossible de valider un BL sans ligne');
    error.status = 400;
    throw error;
  }

  let allocated = 0;
  const articles = new Set();
  for (const line of lines.rows) {
    let remaining = pos(line.sold_quantity || line.total_weight, 0);
    if (!line.article_id && remaining > 0) {
      const error = new Error(`Article requis pour destocker la ligne ${line.line_number}`);
      error.status = 400;
      throw error;
    }
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
        [storeId, note.client_key || clientKey || null, line.article_id, lot.id, -quantity, num(lot.unit_cost_ex_vat), note.id, `Validation BL negoce ${note.reference_number || note.id}`, userId]
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

  await db.query(`UPDATE sales_documents SET status = 'validated', validated_at = NOW(), updated_by = $1, updated_at = NOW() WHERE id = $2`, [userId, note.id]);
  if (note.source_order_id) {
    await db.query(`UPDATE sales_documents SET status = 'delivered', updated_by = $1, updated_at = NOW() WHERE id = $2 AND store_id = $3 AND document_type = 'ORDER'`, [userId, note.source_order_id, storeId]);
  }
  for (const articleId of articles) await recomputeArticleStock(db, articleId, storeId);
  return { allocated, alreadyValidated: false };
}

async function createNegoceDeliveryNote(db, { order, storeId, clientKey, userId, notes, referenceNumber }) {
  const existing = await db.query(
    `SELECT id FROM sales_documents WHERE store_id = $1 AND source_order_id = $2 AND document_type = 'DELIVERY_NOTE' LIMIT 1`,
    [storeId, order.id]
  );
  if (existing.rows.length) return { id: existing.rows[0].id, existing: true };

  const client = await db.query(
    `SELECT c.*, COALESCE(c.billed_client_id, c.id) AS billed_client_id,
      billed.code AS billed_client_code, billed.name AS billed_client_name
     FROM clients c
     LEFT JOIN clients billed ON billed.id = COALESCE(c.billed_client_id, c.id) AND billed.store_id = c.store_id
     WHERE c.id = $1 AND c.store_id = $2 LIMIT 1`,
    [order.client_id, storeId]
  );
  if (!client.rows.length) {
    const error = new Error('Client livre introuvable pour ce magasin');
    error.status = 400;
    throw error;
  }
  const c = client.rows[0];
  const created = await db.query(
    `INSERT INTO sales_documents (id, store_id, client_key, client_id, billed_client_id, source_order_id, document_date, status, document_type, origin, reference_number, notes, total_amount_ex_vat, total_vat_amount, total_amount_inc_vat, tariff_level_snapshot, vat_rate_snapshot, is_vat_exempt_snapshot, delivered_client_name_snapshot, delivered_client_code_snapshot, delivered_client_store_identifier, billed_client_name_snapshot, billed_client_code_snapshot, created_by, updated_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, CURRENT_DATE, 'draft', 'DELIVERY_NOTE', 'negoce', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $19) RETURNING id`,
    [storeId, order.client_key || clientKey || null, order.client_id, c.billed_client_id || order.client_id, order.id, clean(referenceNumber) || `BL-${new Date().toISOString().slice(0, 10)}-${String(order.id).slice(0, 8)}`, clean(notes) || order.notes, order.total_amount_ex_vat, order.total_vat_amount, order.total_amount_inc_vat, order.tariff_level_snapshot || c.tariff_level || 1, order.vat_rate_snapshot || c.vat_rate || 5.5, order.is_vat_exempt_snapshot || c.is_vat_exempt || false, c.name, c.code, c.store_identifier, c.billed_client_name || c.name, c.billed_client_code || c.code, userId]
  );
  const deliveryNoteId = created.rows[0].id;
  const lines = await db.query(`SELECT * FROM sales_lines WHERE sales_document_id = $1 ORDER BY line_number`, [order.id]);
  for (const line of lines.rows) {
    await db.query(
      `INSERT INTO sales_lines (id, store_id, client_key, sales_document_id, line_number, article_id, article_plu, article_label, package_count, weight_per_package, total_weight, sold_quantity, sale_unit, unit_sale_price_ht, unit_sale_price_ttc, vat_rate, line_amount_ht, line_vat_amount, line_amount_ttc, unit_cost_ex_vat, line_margin_ex_vat, selected_lot_id, suggested_lot_id, traceability_snapshot, line_status, created_by, updated_by)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23::jsonb, 'pending', $24, $24)`,
      [storeId, line.client_key || order.client_key || clientKey || null, deliveryNoteId, line.line_number, line.article_id, line.article_plu, line.article_label, line.package_count, line.weight_per_package, line.total_weight, line.sold_quantity, line.sale_unit, line.unit_sale_price_ht, line.unit_sale_price_ttc, line.vat_rate, line.line_amount_ht, line.line_vat_amount, line.line_amount_ttc, line.unit_cost_ex_vat, line.line_margin_ex_vat, line.selected_lot_id, line.suggested_lot_id, JSON.stringify(line.traceability_snapshot || {}), userId]
    );
  }
  return { id: deliveryNoteId, existing: false };
}

router.patch('/sales/lines/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res, next) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const lineResult = await db.query(
      `SELECT sl.*, sd.origin, sd.status, sd.vat_rate_snapshot, sd.is_vat_exempt_snapshot
       FROM sales_lines sl
       JOIN sales_documents sd ON sd.id = sl.sales_document_id AND sd.store_id = sl.store_id
       WHERE sl.id = $1 AND sl.store_id = $2 FOR UPDATE`,
      [req.params.id, req.user.store_id]
    );
    if (!lineResult.rows.length) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Ligne introuvable' }); }
    const line = lineResult.rows[0];
    if (line.origin !== 'negoce') { await db.query('ROLLBACK'); return next(); }
    if (line.status !== 'draft') { await db.query('ROLLBACK'); return res.status(400).json({ error: 'Ligne negoce non modifiable' }); }

    const article = await articleByInput(db, req.user.store_id, req.body || {});
    if (!article) { await db.query('ROLLBACK'); return res.status(400).json({ error: 'Article reference introuvable pour ce magasin' }); }
    const selectedLotId = uuidOrNull(req.body?.selected_lot_id);
    let selectedLot = null;
    if (selectedLotId) {
      const lotResult = await db.query(`SELECT * FROM lots WHERE id = $1 AND article_id = $2 AND store_id = $3 AND qty_remaining > 0 LIMIT 1`, [selectedLotId, article.id, req.user.store_id]);
      if (!lotResult.rows.length) { await db.query('ROLLBACK'); return res.status(400).json({ error: 'Lot selectionne introuvable ou sans stock' }); }
      selectedLot = lotResult.rows[0];
    }
    const suggested = selectedLot ? { rows: [{ id: selectedLot.id }] } : await db.query(`SELECT id FROM lots WHERE store_id = $1 AND article_id = $2 AND qty_remaining > 0 ORDER BY COALESCE(dlc, DATE '9999-12-31'), created_at, id LIMIT 1`, [req.user.store_id, article.id]);
    const packageCount = pos(req.body?.package_count, line.package_count || 0);
    const weightPerPackage = pos(req.body?.weight_per_package, line.weight_per_package || 0);
    const totalWeight = req.body?.total_weight !== undefined ? pos(req.body.total_weight, 0) : Number((packageCount * weightPerPackage).toFixed(3));
    const soldQuantity = totalWeight > 0 ? totalWeight : pos(req.body?.sold_quantity, line.sold_quantity || 0);
    const vatRate = line.is_vat_exempt_snapshot ? 0 : pos(req.body?.vat_rate, num(article.vat_rate, num(line.vat_rate_snapshot, 5.5)));
    const unitPriceHt = pos(req.body?.unit_sale_price_ht, num(article.sale_price_level_1_ht, num(article.sale_price_ex_vat, line.unit_sale_price_ht || 0)));
    const ht = Number((soldQuantity * unitPriceHt).toFixed(2));
    const vat = Number((ht * vatRate / 100).toFixed(2));
    const ttc = Number((ht + vat).toFixed(2));
    const unitTtc = soldQuantity > 0 ? Number((ttc / soldQuantity).toFixed(4)) : Number((unitPriceHt * (1 + vatRate / 100)).toFixed(4));
    const cost = num(article.pma, line.unit_cost_ex_vat || 0);
    const traceability = selectedLot ? traceFrom({ ...article, ...selectedLot }) : traceFrom(article);

    const updated = await db.query(
      `UPDATE sales_lines SET article_id = $1, article_plu = $2, article_label = $3, package_count = $4, weight_per_package = $5, total_weight = $6, sold_quantity = $7, sale_unit = $8, unit_sale_price_ht = $9, unit_sale_price_ttc = $10, vat_rate = $11, line_amount_ht = $12, line_vat_amount = $13, line_amount_ttc = $14, unit_cost_ex_vat = $15, line_margin_ex_vat = $16, selected_lot_id = $17, suggested_lot_id = $18, traceability_snapshot = $19::jsonb, updated_by = $20, updated_at = NOW() WHERE id = $21 AND store_id = $22 RETURNING *`,
      [article.id, clean(req.body?.article_plu) || article.plu, clean(req.body?.article_label) || article.designation, packageCount, weightPerPackage, totalWeight, soldQuantity, clean(req.body?.sale_unit) || article.sale_unit || article.unit || 'kg', unitPriceHt, unitTtc, vatRate, ht, vat, ttc, cost, Number((ht - soldQuantity * cost).toFixed(2)), selectedLot?.id || null, suggested.rows[0]?.id || null, JSON.stringify(traceability), req.user.id, req.params.id, req.user.store_id]
    );
    await db.query(`UPDATE sales_documents sd SET total_amount_ex_vat = COALESCE(x.ht,0), total_vat_amount = COALESCE(x.vat,0), total_amount_inc_vat = COALESCE(x.ttc,0), updated_by = $2, updated_at = NOW() FROM (SELECT COALESCE(SUM(line_amount_ht),0) ht, COALESCE(SUM(line_vat_amount),0) vat, COALESCE(SUM(line_amount_ttc),0) ttc FROM sales_lines WHERE sales_document_id = $1) x WHERE sd.id = $1`, [line.sales_document_id, req.user.id]);
    await db.query('COMMIT');
    res.json({ ok: true, line: updated.rows[0] });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur maj ligne negoce :', err);
    res.status(500).json({ error: err.message || 'Erreur maj ligne negoce' });
  } finally { db.release(); }
});

router.post('/sales/:id/validate-delivery-note', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res, next) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const orderResult = await db.query(`SELECT * FROM sales_documents WHERE id = $1 AND store_id = $2 AND document_type = 'ORDER' FOR UPDATE`, [req.params.id, req.user.store_id]);
    if (!orderResult.rows.length) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Commande introuvable' }); }
    const order = orderResult.rows[0];
    if (order.origin !== 'negoce') { await db.query('ROLLBACK'); return next(); }
    if (!['draft', 'validated'].includes(order.status)) { await db.query('ROLLBACK'); return res.status(400).json({ error: 'Commande non validable en BL' }); }
    const count = await db.query(`SELECT COUNT(*)::int AS count FROM sales_lines WHERE sales_document_id = $1`, [order.id]);
    if (!count.rows[0].count) { await db.query('ROLLBACK'); return res.status(400).json({ error: 'Impossible de valider une commande sans ligne' }); }
    if (order.status === 'draft') {
      await db.query(`UPDATE sales_lines SET line_status = 'ordered', updated_by = $1, updated_at = NOW() WHERE sales_document_id = $2`, [req.user.id, order.id]);
      await db.query(`UPDATE sales_documents SET status = 'validated', validated_at = NOW(), updated_by = $1, updated_at = NOW() WHERE id = $2`, [req.user.id, order.id]);
    }
    const deliveryNote = await createNegoceDeliveryNote(db, { order, storeId: req.user.store_id, clientKey: req.user.client_key, userId: req.user.id, notes: req.body?.notes, referenceNumber: req.body?.reference_number });
    const validation = await validateNegoceDeliveryNote(db, { deliveryNoteId: deliveryNote.id, storeId: req.user.store_id, clientKey: req.user.client_key, userId: req.user.id });
    await db.query('COMMIT');
    res.json({ ok: true, delivery_note_id: deliveryNote.id, allocated: validation.allocated, existing: deliveryNote.existing });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur validation commande negoce en BL :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur validation BL negoce' });
  } finally { db.release(); }
});

router.post('/delivery-notes/:id/validate', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res, next) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const validation = await validateNegoceDeliveryNote(db, { deliveryNoteId: req.params.id, storeId: req.user.store_id, clientKey: req.user.client_key, userId: req.user.id });
    if (!validation) { await db.query('ROLLBACK'); return next(); }
    await db.query('COMMIT');
    res.json({ ok: true, allocated: validation.allocated, already_validated: validation.alreadyValidated });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur validation BL negoce :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur validation BL negoce' });
  } finally { db.release(); }
});

router.post('/delivery-notes/:id/validate-invoice', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  const body = req.body || {};
  try {
    await db.query('BEGIN');
    const noteResult = await db.query(`SELECT * FROM sales_documents WHERE id = $1 AND store_id = $2 AND document_type = 'DELIVERY_NOTE' FOR UPDATE`, [req.params.id, req.user.store_id]);
    if (!noteResult.rows.length) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'BL introuvable' }); }
    const note = noteResult.rows[0];
    if (!['validated', 'invoiced'].includes(note.status)) { await db.query('ROLLBACK'); return res.status(400).json({ error: 'Le BL doit etre valide avant facturation' }); }
    const existing = await db.query(`SELECT id FROM sales_documents WHERE store_id = $1 AND source_delivery_note_id = $2 AND document_type = 'INVOICE' LIMIT 1`, [req.user.store_id, note.id]);
    if (existing.rows.length) { await db.query('COMMIT'); return res.json({ ok: true, invoice_id: existing.rows[0].id, existing: true }); }
    const billedClientId = uuidOrNull(note.billed_client_id) || uuidOrNull(note.client_id);
    const deliveredClientId = uuidOrNull(note.client_id);
    const invoice = await db.query(
      `INSERT INTO sales_documents (id, store_id, client_key, client_id, billed_client_id, source_order_id, source_delivery_note_id, document_date, status, document_type, origin, reference_number, notes, total_amount_ex_vat, total_vat_amount, total_amount_inc_vat, tariff_level_snapshot, vat_rate_snapshot, is_vat_exempt_snapshot, delivered_client_name_snapshot, delivered_client_code_snapshot, delivered_client_store_identifier, billed_client_name_snapshot, billed_client_code_snapshot, locked_at, created_by, updated_by)
       VALUES (gen_random_uuid(), $1, $2, $3::uuid, $4::uuid, $5, $6, CURRENT_DATE, 'validated', 'INVOICE', 'delivery_note', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), $20, $20) RETURNING id, reference_number`,
      [req.user.store_id, note.client_key || req.user.client_key || null, billedClientId || deliveredClientId, billedClientId || deliveredClientId, note.source_order_id, note.id, clean(body.reference_number) || `FAC-${new Date().toISOString().slice(0, 10)}-${String(note.id).slice(0, 8)}`, note.notes, note.total_amount_ex_vat, note.total_vat_amount, note.total_amount_inc_vat, note.tariff_level_snapshot, note.vat_rate_snapshot, note.is_vat_exempt_snapshot, note.delivered_client_name_snapshot, note.delivered_client_code_snapshot, note.delivered_client_store_identifier, note.billed_client_name_snapshot, note.billed_client_code_snapshot, req.user.id]
    );
    const lines = await db.query(`SELECT * FROM sales_lines WHERE sales_document_id = $1 ORDER BY line_number`, [note.id]);
    for (const line of lines.rows) {
      await db.query(`INSERT INTO sales_lines (id, store_id, client_key, sales_document_id, line_number, article_id, article_plu, article_label, package_count, weight_per_package, total_weight, sold_quantity, sale_unit, unit_sale_price_ht, unit_sale_price_ttc, vat_rate, line_amount_ht, line_vat_amount, line_amount_ttc, unit_cost_ex_vat, line_margin_ex_vat, selected_lot_id, suggested_lot_id, traceability_snapshot, line_status, created_by, updated_by) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23::jsonb, 'invoiced', $24, $24)`, [req.user.store_id, line.client_key || note.client_key || req.user.client_key || null, invoice.rows[0].id, line.line_number, uuidOrNull(line.article_id), line.article_plu, line.article_label, line.package_count, line.weight_per_package, line.total_weight, line.sold_quantity, line.sale_unit, line.unit_sale_price_ht, line.unit_sale_price_ttc, line.vat_rate, line.line_amount_ht, line.line_vat_amount, line.line_amount_ttc, line.unit_cost_ex_vat, line.line_margin_ex_vat, uuidOrNull(line.selected_lot_id), uuidOrNull(line.suggested_lot_id), JSON.stringify(line.traceability_snapshot || {}), req.user.id]);
    }
    await db.query(`UPDATE sales_documents SET status = 'invoiced', invoiced_at = NOW(), updated_by = $1, updated_at = NOW() WHERE id = $2`, [req.user.id, note.id]);
    await db.query('COMMIT');
    res.json({ ok: true, invoice_id: invoice.rows[0].id, invoice_reference: invoice.rows[0].reference_number, existing: false });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur validation facture BL :', err);
    res.status(500).json({ error: err.message || 'Erreur validation facture' });
  } finally { db.release(); }
});

module.exports = router;
