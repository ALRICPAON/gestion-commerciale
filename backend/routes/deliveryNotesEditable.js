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
const unlocked = (doc) => doc?.document_type === 'DELIVERY_NOTE' && doc.status !== 'invoiced' && !doc.invoice_id && !doc.invoiced_at;

async function documentById(db, id, storeId, lock = false) {
  const result = await db.query(
    `SELECT sd.*, invoice.id AS invoice_id
     FROM sales_documents sd
     LEFT JOIN sales_documents invoice
       ON invoice.source_delivery_note_id = sd.id
      AND invoice.store_id = sd.store_id
      AND invoice.document_type = 'INVOICE'
     WHERE sd.id = $1 AND sd.store_id = $2
     ${lock ? 'FOR UPDATE OF sd' : ''}`,
    [id, storeId]
  );
  return result.rows[0] || null;
}

async function lineWithDocument(db, id, storeId) {
  const result = await db.query(
    `SELECT sl.*, sd.document_type, sd.status AS document_status, sd.origin AS document_origin,
      sd.client_id, sd.tariff_level_snapshot, sd.vat_rate_snapshot, sd.is_vat_exempt_snapshot,
      sd.invoiced_at, invoice.id AS invoice_id
     FROM sales_lines sl
     JOIN sales_documents sd ON sd.id = sl.sales_document_id AND sd.store_id = sl.store_id
     LEFT JOIN sales_documents invoice
       ON invoice.source_delivery_note_id = sd.id
      AND invoice.store_id = sd.store_id
      AND invoice.document_type = 'INVOICE'
     WHERE sl.id = $1 AND sl.store_id = $2
     FOR UPDATE OF sl, sd`,
    [id, storeId]
  );
  return result.rows[0] || null;
}

async function clientSnapshot(db, storeId, clientId) {
  if (!clientId) return null;
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
    const error = new Error('Client introuvable pour ce magasin');
    error.status = 400;
    throw error;
  }
  return result.rows[0];
}

async function articleByPayload(db, storeId, body) {
  const id = clean(body.article_id);
  const plu = clean(body.article_plu);
  if (!id && !plu) return null;
  const params = [storeId];
  let where = 'a.store_id = $1 AND a.is_active = true';
  if (id) { params.push(id); where += ` AND a.id = $${params.length}`; }
  else { params.push(plu); where += ` AND a.plu = $${params.length}`; }
  const result = await db.query(
    `SELECT a.*, COALESCE(ss.stock_quantity, 0) AS stock_quantity, COALESCE(ss.pma, 0) AS pma
     FROM articles a
     LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
     WHERE ${where}
     LIMIT 1`,
    params
  );
  return result.rows[0] || null;
}

async function lotById(db, storeId, articleId, lotId) {
  if (!lotId || !articleId) return null;
  const result = await db.query(
    `SELECT l.*, a.latin_name, a.fao_zone, a.sous_zone, a.fishing_gear, a.production_method, a.allergens
     FROM lots l
     JOIN articles a ON a.id = l.article_id AND a.store_id = l.store_id
     WHERE l.id = $1 AND l.article_id = $2 AND l.store_id = $3 AND l.qty_remaining > 0
     LIMIT 1`,
    [lotId, articleId, storeId]
  );
  return result.rows[0] || null;
}

async function fifoLot(db, storeId, articleId) {
  if (!articleId) return null;
  const result = await db.query(
    `SELECT l.*, a.latin_name, a.fao_zone, a.sous_zone, a.fishing_gear, a.production_method, a.allergens
     FROM lots l
     JOIN articles a ON a.id = l.article_id AND a.store_id = l.store_id
     WHERE l.store_id = $1 AND l.article_id = $2 AND l.qty_remaining > 0
     ORDER BY COALESCE(l.dlc, DATE '9999-12-31'), l.created_at, l.id
     LIMIT 1`,
    [storeId, articleId]
  );
  return result.rows[0] || null;
}

function snapshot(lot) {
  if (!lot) return {};
  return {
    lot_id: lot.id,
    lot_code: lot.lot_code,
    supplier_lot_number: lot.supplier_lot_number,
    dlc: lot.dlc,
    latin_name: lot.traceability_data?.latin_name || lot.latin_name || null,
    fao_zone: lot.traceability_data?.fao_zone || lot.fao_zone || null,
    sous_zone: lot.traceability_data?.sous_zone || lot.sous_zone || null,
    fishing_gear: lot.traceability_data?.fishing_gear || lot.fishing_gear || null,
    production_method: lot.traceability_data?.production_method || lot.production_method || null,
    allergens: lot.traceability_data?.allergens || lot.allergens || null,
    available_quantity: num(lot.qty_remaining),
  };
}

function compute(body, article, doc, old = {}) {
  const packageCount = pos(body.package_count, old.package_count || 0);
  const weightPerPackage = pos(body.weight_per_package, old.weight_per_package || 0);
  const totalWeight = body.total_weight !== undefined ? pos(body.total_weight, 0) : Number((packageCount * weightPerPackage).toFixed(3));
  const soldQuantity = totalWeight > 0 ? totalWeight : pos(body.sold_quantity, old.sold_quantity || 0);
  const vatRate = doc.is_vat_exempt_snapshot ? 0 : pos(body.vat_rate, num(doc.vat_rate_snapshot, 5.5));
  const unitPriceHt = body.unit_sale_price_ht !== undefined && body.unit_sale_price_ht !== null && body.unit_sale_price_ht !== '' ? pos(body.unit_sale_price_ht, 0) : pos(old.unit_sale_price_ht, 0);
  const lineAmountHt = Number((soldQuantity * unitPriceHt).toFixed(2));
  const lineVatAmount = Number((lineAmountHt * vatRate / 100).toFixed(2));
  const lineAmountTtc = Number((lineAmountHt + lineVatAmount).toFixed(2));
  const unitPriceTtc = soldQuantity > 0 ? Number((lineAmountTtc / soldQuantity).toFixed(4)) : Number((unitPriceHt * (1 + vatRate / 100)).toFixed(4));
  const unitCost = pos(body.unit_cost_ex_vat, num(article?.pma, old.unit_cost_ex_vat || 0));
  return { packageCount, weightPerPackage, totalWeight, soldQuantity, vatRate, unitPriceHt, unitPriceTtc, lineAmountHt, lineVatAmount, lineAmountTtc, unitCost, margin: Number((lineAmountHt - soldQuantity * unitCost).toFixed(2)) };
}

async function recalc(db, documentId, userId) {
  await db.query(
    `UPDATE sales_documents sd
     SET total_amount_ex_vat = COALESCE(x.ht, 0), total_vat_amount = COALESCE(x.vat, 0),
       total_amount_inc_vat = COALESCE(x.ttc, 0), updated_by = $2, updated_at = NOW()
     FROM (SELECT COALESCE(SUM(line_amount_ht), 0) ht, COALESCE(SUM(line_vat_amount), 0) vat, COALESCE(SUM(line_amount_ttc), 0) ttc FROM sales_lines WHERE sales_document_id = $1) x
     WHERE sd.id = $1`,
    [documentId, userId]
  );
}

async function reverseStock(db, documentId, storeId, userId) {
  const doc = await documentById(db, documentId, storeId, true);
  const affected = new Set();
  if (!doc || doc.status !== 'validated') return affected;
  const allocations = await db.query(
    `SELECT sla.lot_id, sla.quantity, sl.article_id
     FROM sale_line_allocations sla
     JOIN sales_lines sl ON sl.id = sla.sales_line_id
     WHERE sl.sales_document_id = $1
     FOR UPDATE`,
    [documentId]
  );
  for (const allocation of allocations.rows) {
    if (allocation.lot_id && num(allocation.quantity) > 0) {
      await db.query(`UPDATE lots SET qty_remaining = qty_remaining + $1, updated_at = NOW() WHERE id = $2 AND store_id = $3`, [allocation.quantity, allocation.lot_id, storeId]);
    }
    if (allocation.article_id) affected.add(allocation.article_id);
  }
  await db.query(`DELETE FROM sale_line_allocations WHERE sales_line_id IN (SELECT id FROM sales_lines WHERE sales_document_id = $1)`, [documentId]);
  await db.query(`DELETE FROM stock_movements WHERE store_id = $1 AND source_table = 'sales_documents' AND source_id = $2 AND movement_type = 'sale_out'`, [storeId, documentId]);
  await db.query(`UPDATE sales_lines SET line_status = 'pending', updated_by = $1, updated_at = NOW() WHERE sales_document_id = $2`, [userId, documentId]);
  return affected;
}

async function validateStock(db, documentId, storeId, clientKey, userId) {
  const doc = await documentById(db, documentId, storeId, true);
  if (!unlocked(doc)) {
    const error = new Error('BL facture ou lie a une facture : modification interdite');
    error.status = 400;
    throw error;
  }
  const affected = new Set();
  const skipStock = doc.origin === 'negoce';
  const lines = await db.query(`SELECT * FROM sales_lines WHERE sales_document_id = $1 ORDER BY line_number ASC FOR UPDATE`, [documentId]);
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
          [storeId, doc.client_key || clientKey || null, line.article_id, lot.id, -quantity, num(lot.unit_cost_ex_vat), documentId, `Revalidation BL ${doc.reference_number || documentId}`, userId]
        );
        remaining = Number((remaining - quantity).toFixed(3));
      }
      if (remaining > 0) {
        const error = new Error(`Stock insuffisant ligne ${line.line_number}`);
        error.status = 400;
        throw error;
      }
      affected.add(line.article_id);
    }
    await db.query(`UPDATE sales_lines SET line_status = 'validated', updated_by = $1, updated_at = NOW() WHERE id = $2`, [userId, line.id]);
  }
  await db.query(`UPDATE sales_documents SET status = 'validated', validated_at = COALESCE(validated_at, NOW()), updated_by = $1, updated_at = NOW() WHERE id = $2`, [userId, documentId]);
  return affected;
}

async function withReallocation(db, doc, storeId, clientKey, userId, work) {
  const wasValidated = doc.status === 'validated';
  const affected = new Set();
  if (wasValidated) (await reverseStock(db, doc.id, storeId, userId)).forEach((id) => affected.add(id));
  const result = await work();
  await recalc(db, doc.id, userId);
  if (wasValidated) (await validateStock(db, doc.id, storeId, clientKey, userId)).forEach((id) => affected.add(id));
  for (const id of affected) await recomputeArticleStock(db, id, storeId);
  return result;
}

router.patch('/sales/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res, next) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const doc = await documentById(db, req.params.id, req.user.store_id, true);
    if (!doc || doc.document_type !== 'DELIVERY_NOTE') { await db.query('ROLLBACK'); return next(); }
    if (!unlocked(doc)) { await db.query('ROLLBACK'); return res.status(400).json({ error: 'BL facture ou lie a une facture : modification interdite' }); }
    const client = clean(req.body?.client_id) ? await clientSnapshot(db, req.user.store_id, req.body.client_id) : null;
    await db.query(
      `UPDATE sales_documents SET client_id = COALESCE($1, client_id), billed_client_id = COALESCE($2, billed_client_id), document_date = COALESCE($3::date, document_date), reference_number = $4, notes = $5, tariff_level_snapshot = COALESCE($6, tariff_level_snapshot), vat_rate_snapshot = COALESCE($7, vat_rate_snapshot), is_vat_exempt_snapshot = COALESCE($8, is_vat_exempt_snapshot), delivered_client_name_snapshot = COALESCE($9, delivered_client_name_snapshot), delivered_client_code_snapshot = COALESCE($10, delivered_client_code_snapshot), delivered_client_store_identifier = COALESCE($11, delivered_client_store_identifier), billed_client_name_snapshot = COALESCE($12, billed_client_name_snapshot), billed_client_code_snapshot = COALESCE($13, billed_client_code_snapshot), updated_by = $14, updated_at = NOW() WHERE id = $15 AND store_id = $16`,
      [client?.id || null, client?.billed_client_id || null, clean(req.body?.document_date), clean(req.body?.reference_number), clean(req.body?.notes), client?.tariff_level || null, client?.vat_rate || null, client?.is_vat_exempt ?? null, client?.name || null, client?.code || null, client?.store_identifier || null, client?.billed_client_name || null, client?.billed_client_code || null, req.user.id, doc.id, req.user.store_id]
    );
    await db.query('COMMIT');
    res.json({ ok: true, message: 'BL mis a jour' });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur modification entete BL :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur modification BL' });
  } finally {
    db.release();
  }
});

router.post('/sales/:id/lines', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res, next) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const doc = await documentById(db, req.params.id, req.user.store_id, true);
    if (!doc || doc.document_type !== 'DELIVERY_NOTE') { await db.query('ROLLBACK'); return next(); }
    if (!unlocked(doc)) { await db.query('ROLLBACK'); return res.status(400).json({ error: 'BL facture ou lie a une facture : modification interdite' }); }
    const line = await withReallocation(db, doc, req.user.store_id, req.user.client_key, req.user.id, async () => {
      const numberResult = await db.query(`SELECT COALESCE(MAX(line_number), 0) + 1 AS line_number FROM sales_lines WHERE sales_document_id = $1`, [doc.id]);
      const inserted = await db.query(
        `INSERT INTO sales_lines(id, store_id, client_key, sales_document_id, line_number, sale_unit, vat_rate, line_status, created_by, updated_by) VALUES(gen_random_uuid(), $1, $2, $3, $4, 'kg', COALESCE($5, 5.5), 'pending', $6, $6) RETURNING *`,
        [req.user.store_id, doc.client_key || req.user.client_key || null, doc.id, numberResult.rows[0].line_number, doc.vat_rate_snapshot, req.user.id]
      );
      return inserted.rows[0];
    });
    await db.query('COMMIT');
    res.status(201).json({ ok: true, line });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur ajout ligne BL :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur ajout ligne BL' });
  } finally {
    db.release();
  }
});

router.patch('/sales/lines/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res, next) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const line = await lineWithDocument(db, req.params.id, req.user.store_id);
    if (!line || line.document_type !== 'DELIVERY_NOTE') { await db.query('ROLLBACK'); return next(); }
    const doc = { id: line.sales_document_id, document_type: line.document_type, status: line.document_status, origin: line.document_origin, invoice_id: line.invoice_id, invoiced_at: line.invoiced_at, client_id: line.client_id, tariff_level_snapshot: line.tariff_level_snapshot, vat_rate_snapshot: line.vat_rate_snapshot, is_vat_exempt_snapshot: line.is_vat_exempt_snapshot };
    if (!unlocked(doc)) { await db.query('ROLLBACK'); return res.status(400).json({ error: 'BL facture ou lie a une facture : modification interdite' }); }
    const updated = await withReallocation(db, doc, req.user.store_id, req.user.client_key, req.user.id, async () => {
      const article = await articleByPayload(db, req.user.store_id, req.body || {});
      if (!article && line.document_origin !== 'negoce') { const error = new Error('Article obligatoire pour une ligne BL'); error.status = 400; throw error; }
      const selectedLot = await lotById(db, req.user.store_id, article?.id, clean(req.body?.selected_lot_id));
      if (clean(req.body?.selected_lot_id) && !selectedLot && line.document_origin !== 'negoce') { const error = new Error('Lot selectionne introuvable ou sans stock'); error.status = 400; throw error; }
      const suggestedLot = selectedLot || (line.document_origin === 'negoce' ? null : await fifoLot(db, req.user.store_id, article?.id));
      const x = compute(req.body || {}, article, doc, line);
      const result = await db.query(
        `UPDATE sales_lines SET article_id = $1, article_plu = $2, article_label = $3, package_count = $4, weight_per_package = $5, total_weight = $6, sold_quantity = $7, sale_unit = $8, unit_sale_price_ht = $9, unit_sale_price_ttc = $10, vat_rate = $11, line_amount_ht = $12, line_vat_amount = $13, line_amount_ttc = $14, unit_cost_ex_vat = $15, line_margin_ex_vat = $16, selected_lot_id = $17, suggested_lot_id = $18, traceability_snapshot = $19::jsonb, updated_by = $20, updated_at = NOW() WHERE id = $21 AND store_id = $22 RETURNING *`,
        [article?.id || null, clean(req.body?.article_plu) || article?.plu || null, clean(req.body?.article_label) || article?.designation || null, x.packageCount, x.weightPerPackage, x.totalWeight, x.soldQuantity, clean(req.body?.sale_unit) || article?.sale_unit || article?.unit || 'kg', x.unitPriceHt, x.unitPriceTtc, x.vatRate, x.lineAmountHt, x.lineVatAmount, x.lineAmountTtc, x.unitCost, x.margin, selectedLot?.id || null, suggestedLot?.id || null, JSON.stringify(snapshot(selectedLot || suggestedLot)), req.user.id, req.params.id, req.user.store_id]
      );
      return result.rows[0];
    });
    await db.query('COMMIT');
    res.json({ ok: true, line: updated });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur modification ligne BL :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur modification ligne BL' });
  } finally {
    db.release();
  }
});

router.delete('/sales/lines/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res, next) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const line = await lineWithDocument(db, req.params.id, req.user.store_id);
    if (!line || line.document_type !== 'DELIVERY_NOTE') { await db.query('ROLLBACK'); return next(); }
    const doc = { id: line.sales_document_id, document_type: line.document_type, status: line.document_status, origin: line.document_origin, invoice_id: line.invoice_id, invoiced_at: line.invoiced_at };
    if (!unlocked(doc)) { await db.query('ROLLBACK'); return res.status(400).json({ error: 'BL facture ou lie a une facture : modification interdite' }); }
    await withReallocation(db, doc, req.user.store_id, req.user.client_key, req.user.id, async () => {
      await db.query(`DELETE FROM sales_lines WHERE id = $1 AND store_id = $2`, [req.params.id, req.user.store_id]);
    });
    await db.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur suppression ligne BL :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur suppression ligne BL' });
  } finally {
    db.release();
  }
});

module.exports = router;
