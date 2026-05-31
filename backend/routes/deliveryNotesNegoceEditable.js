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
const norm = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

function isNegoce(document) {
  return norm(document?.origin) === 'negoce';
}

function isDeliveryNoteShape(document) {
  return norm(document?.document_type) === 'delivery_note' || norm(document?.status) === 'delivery_note';
}

function isInvoiceLocked(document) {
  return norm(document?.status) === 'invoiced'
    || !!document?.invoice_id
    || !!document?.invoice_reference
    || !!document?.source_invoice_id
    || !!document?.invoiced_at;
}

function isUnlockedNegoceDeliveryNote(document) {
  return isNegoce(document) && isDeliveryNoteShape(document) && !isInvoiceLocked(document);
}

function logRouteHit(action, document, extra = {}) {
  console.info('deliveryNotesNegoceEditable route hit', {
    action,
    document_id: document?.id,
    document_type: document?.document_type,
    origin: document?.origin,
    status: document?.status,
    invoice_id: document?.invoice_id,
    invoice_reference: document?.invoice_reference,
    source_invoice_id: document?.source_invoice_id,
    invoiced_at: document?.invoiced_at,
    ...extra,
  });
}

async function getDocument(db, documentId, storeId, lock = false) {
  const result = await db.query(
    `SELECT sd.*, invoice.id AS invoice_id, invoice.reference_number AS invoice_reference
     FROM sales_documents sd
     LEFT JOIN sales_documents invoice
       ON invoice.source_delivery_note_id = sd.id
      AND invoice.store_id = sd.store_id
      AND invoice.document_type = 'INVOICE'
     WHERE sd.id = $1 AND sd.store_id = $2
     ${lock ? 'FOR UPDATE OF sd' : ''}`,
    [documentId, storeId]
  );
  return result.rows[0] || null;
}

async function getLineDocument(db, lineId, storeId) {
  const result = await db.query(
    `SELECT sl.*,
       sd.id AS document_id,
       sd.client_key AS document_client_key,
       sd.document_type AS document_type,
       sd.status AS document_status,
       sd.origin AS document_origin,
       sd.reference_number AS document_reference_number,
       sd.vat_rate_snapshot,
       sd.is_vat_exempt_snapshot,
       sd.invoiced_at,
       invoice.id AS invoice_id,
       invoice.reference_number AS invoice_reference
     FROM sales_lines sl
     JOIN sales_documents sd ON sd.id = sl.sales_document_id AND sd.store_id = sl.store_id
     LEFT JOIN sales_documents invoice
       ON invoice.source_delivery_note_id = sd.id
      AND invoice.store_id = sd.store_id
      AND invoice.document_type = 'INVOICE'
     WHERE sl.id = $1 AND sl.store_id = $2
     FOR UPDATE OF sl, sd`,
    [lineId, storeId]
  );
  return result.rows[0] || null;
}

async function getArticle(db, storeId, body = {}, oldLine = {}) {
  const articleId = clean(body.article_id) || clean(oldLine.article_id);
  const plu = clean(body.article_plu) || clean(oldLine.article_plu);
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

async function getSelectedLot(db, storeId, articleId, lotId) {
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

async function getFifoLots(db, storeId, articleId, selectedLotId = null) {
  if (!articleId) return [];
  if (selectedLotId) {
    const result = await db.query(
      `SELECT * FROM lots WHERE store_id = $1 AND article_id = $2 AND id = $3 AND qty_remaining > 0 FOR UPDATE`,
      [storeId, articleId, selectedLotId]
    );
    return result.rows;
  }
  const result = await db.query(
    `SELECT * FROM lots
     WHERE store_id = $1 AND article_id = $2 AND qty_remaining > 0
     ORDER BY COALESCE(dlc, DATE '9999-12-31'), created_at, id
     FOR UPDATE`,
    [storeId, articleId]
  );
  return result.rows;
}

function traceability(row) {
  if (!row) return {};
  return {
    lot_id: row.id || row.lot_id || null,
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

function computeLine(body, article, document, oldLine = {}) {
  const packageCount = pos(body.package_count, oldLine.package_count || 0);
  const weightPerPackage = pos(body.weight_per_package, oldLine.weight_per_package || 0);
  const totalWeight = body.total_weight !== undefined ? pos(body.total_weight, 0) : Number((packageCount * weightPerPackage).toFixed(3));
  const soldQuantity = totalWeight > 0 ? totalWeight : pos(body.sold_quantity, oldLine.sold_quantity || 0);
  const vatRate = document.is_vat_exempt_snapshot ? 0 : pos(body.vat_rate, num(article?.vat_rate, num(document.vat_rate_snapshot, 5.5)));
  const unitPriceHt = body.unit_sale_price_ht !== undefined && body.unit_sale_price_ht !== null && body.unit_sale_price_ht !== ''
    ? pos(body.unit_sale_price_ht, 0)
    : pos(oldLine.unit_sale_price_ht, num(article?.sale_price_level_1_ht, num(article?.sale_price_ex_vat, 0)));
  const ht = Number((soldQuantity * unitPriceHt).toFixed(2));
  const vat = Number((ht * vatRate / 100).toFixed(2));
  const ttc = Number((ht + vat).toFixed(2));
  const unitTtc = soldQuantity > 0 ? Number((ttc / soldQuantity).toFixed(4)) : Number((unitPriceHt * (1 + vatRate / 100)).toFixed(4));
  const cost = num(article?.pma, oldLine.unit_cost_ex_vat || 0);
  return {
    packageCount,
    weightPerPackage,
    totalWeight,
    soldQuantity,
    saleUnit: clean(body.sale_unit) || article?.sale_unit || article?.unit || oldLine.sale_unit || 'kg',
    unitPriceHt,
    unitTtc,
    vatRate,
    ht,
    vat,
    ttc,
    cost,
    margin: Number((ht - soldQuantity * cost).toFixed(2)),
  };
}

async function recalcDocument(db, documentId, userId) {
  await db.query(
    `UPDATE sales_documents sd
     SET total_amount_ex_vat = COALESCE(x.ht, 0),
       total_vat_amount = COALESCE(x.vat, 0),
       total_amount_inc_vat = COALESCE(x.ttc, 0),
       updated_by = $2,
       updated_at = NOW()
     FROM (
       SELECT COALESCE(SUM(line_amount_ht), 0) AS ht,
         COALESCE(SUM(line_vat_amount), 0) AS vat,
         COALESCE(SUM(line_amount_ttc), 0) AS ttc
       FROM sales_lines
       WHERE sales_document_id = $1
     ) x
     WHERE sd.id = $1`,
    [documentId, userId]
  );
}

async function reverseStock(db, documentId, storeId, userId) {
  const affected = new Set();
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
      await db.query(
        `UPDATE lots SET qty_remaining = qty_remaining + $1, updated_at = NOW() WHERE id = $2 AND store_id = $3`,
        [allocation.quantity, allocation.lot_id, storeId]
      );
    }
    if (allocation.article_id) affected.add(allocation.article_id);
  }

  await db.query(
    `DELETE FROM sale_line_allocations WHERE sales_line_id IN (SELECT id FROM sales_lines WHERE sales_document_id = $1)`,
    [documentId]
  );
  await db.query(
    `DELETE FROM stock_movements WHERE store_id = $1 AND source_table = 'sales_documents' AND source_id = $2 AND movement_type = 'sale_out'`,
    [storeId, documentId]
  );
  await db.query(
    `UPDATE sales_lines SET line_status = 'pending', updated_by = $1, updated_at = NOW() WHERE sales_document_id = $2`,
    [userId, documentId]
  );
  return affected;
}

async function validateStock(db, document, storeId, clientKey, userId) {
  const affected = new Set();
  const lines = await db.query(
    `SELECT * FROM sales_lines WHERE sales_document_id = $1 ORDER BY line_number ASC FOR UPDATE`,
    [document.id]
  );

  for (const line of lines.rows) {
    const remainingInitial = pos(line.sold_quantity || line.total_weight, 0);
    if (!line.article_id && remainingInitial > 0) {
      const error = new Error(`Article requis pour destocker la ligne ${line.line_number}`);
      error.status = 400;
      throw error;
    }

    let remaining = remainingInitial;
    if (line.article_id && remaining > 0) {
      const lots = await getFifoLots(db, storeId, line.article_id, line.selected_lot_id);
      for (const lot of lots) {
        if (remaining <= 0) break;
        const quantity = Math.min(remaining, num(lot.qty_remaining));
        if (quantity <= 0) continue;
        await db.query(`UPDATE lots SET qty_remaining = qty_remaining - $1, updated_at = NOW() WHERE id = $2`, [quantity, lot.id]);
        await db.query(
          `INSERT INTO sale_line_allocations(id, sales_line_id, lot_id, quantity, unit_cost_ex_vat)
           VALUES(gen_random_uuid(), $1, $2, $3, $4)`,
          [line.id, lot.id, quantity, num(lot.unit_cost_ex_vat)]
        );
        await db.query(
          `INSERT INTO stock_movements(id, store_id, client_key, article_id, lot_id, movement_type, quantity, unit_cost_ex_vat, source_table, source_id, notes, created_by)
           VALUES(gen_random_uuid(), $1, $2, $3, $4, 'sale_out', $5, $6, 'sales_documents', $7, $8, $9)`,
          [storeId, document.client_key || clientKey || null, line.article_id, lot.id, -quantity, num(lot.unit_cost_ex_vat), document.id, `Revalidation BL negoce ${document.reference_number || document.id}`, userId]
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

  await db.query(
    `UPDATE sales_documents SET status = CASE WHEN status = 'delivery_note' THEN status ELSE 'validated' END,
      validated_at = COALESCE(validated_at, NOW()), updated_by = $1, updated_at = NOW()
     WHERE id = $2`,
    [userId, document.id]
  );
  return affected;
}

async function withReallocation(db, document, storeId, clientKey, userId, work) {
  const affected = new Set();
  const wasDestocked = ['validated', 'delivery_note'].includes(norm(document.status));
  if (wasDestocked) {
    (await reverseStock(db, document.id, storeId, userId)).forEach((articleId) => affected.add(articleId));
  }

  const result = await work();
  await recalcDocument(db, document.id, userId);

  if (wasDestocked) {
    (await validateStock(db, document, storeId, clientKey, userId)).forEach((articleId) => affected.add(articleId));
  }

  for (const articleId of affected) {
    await recomputeArticleStock(db, articleId, storeId);
  }
  return result;
}

function documentFromLine(line) {
  return {
    id: line.document_id || line.sales_document_id,
    client_key: line.document_client_key,
    document_type: line.document_type,
    origin: line.document_origin,
    status: line.document_status,
    reference_number: line.document_reference_number,
    invoice_id: line.invoice_id,
    invoice_reference: line.invoice_reference,
    source_invoice_id: line.source_invoice_id,
    invoiced_at: line.invoiced_at,
    vat_rate_snapshot: line.vat_rate_snapshot,
    is_vat_exempt_snapshot: line.is_vat_exempt_snapshot,
  };
}

router.patch('/sales/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res, next) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const document = await getDocument(db, req.params.id, req.user.store_id, true);
    if (!document || !isNegoce(document) || !isDeliveryNoteShape(document)) {
      await db.query('ROLLBACK');
      return next();
    }
    logRouteHit('header', document);
    if (!isUnlockedNegoceDeliveryNote(document)) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'BL negoce facture ou lie a une facture : modification interdite' });
    }
    await db.query(
      `UPDATE sales_documents
       SET document_date = COALESCE($1::date, document_date),
         reference_number = $2,
         notes = $3,
         updated_by = $4,
         updated_at = NOW()
       WHERE id = $5 AND store_id = $6`,
      [clean(req.body?.document_date), clean(req.body?.reference_number), clean(req.body?.notes), req.user.id, document.id, req.user.store_id]
    );
    await db.query('COMMIT');
    res.json({ ok: true, message: 'BL negoce mis a jour' });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur modification entete BL negoce :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur modification BL negoce' });
  } finally {
    db.release();
  }
});

router.post('/sales/:id/lines', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res, next) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const document = await getDocument(db, req.params.id, req.user.store_id, true);
    if (!document || !isNegoce(document) || !isDeliveryNoteShape(document)) {
      await db.query('ROLLBACK');
      return next();
    }
    logRouteHit('add-line', document);
    if (!isUnlockedNegoceDeliveryNote(document)) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'BL negoce facture ou lie a une facture : modification interdite' });
    }

    const line = await withReallocation(db, document, req.user.store_id, req.user.client_key, req.user.id, async () => {
      const lineNumber = await db.query(
        `SELECT COALESCE(MAX(line_number), 0) + 1 AS line_number FROM sales_lines WHERE sales_document_id = $1`,
        [document.id]
      );
      const inserted = await db.query(
        `INSERT INTO sales_lines(id, store_id, client_key, sales_document_id, line_number, sale_unit, vat_rate, line_status, created_by, updated_by)
         VALUES(gen_random_uuid(), $1, $2, $3, $4, 'kg', COALESCE($5, 5.5), 'pending', $6, $6)
         RETURNING *`,
        [req.user.store_id, document.client_key || req.user.client_key || null, document.id, lineNumber.rows[0].line_number, document.vat_rate_snapshot, req.user.id]
      );
      return inserted.rows[0];
    });

    await db.query('COMMIT');
    res.status(201).json({ ok: true, line });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur ajout ligne BL negoce :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur ajout ligne BL negoce' });
  } finally {
    db.release();
  }
});

router.patch('/sales/lines/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res, next) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const line = await getLineDocument(db, req.params.id, req.user.store_id);
    const document = line ? documentFromLine(line) : null;
    if (!line || !isNegoce(document) || !isDeliveryNoteShape(document)) {
      await db.query('ROLLBACK');
      return next();
    }
    logRouteHit('patch-line', document, { line_id: req.params.id });

    if (!isUnlockedNegoceDeliveryNote(document)) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'BL negoce facture ou lie a une facture : modification interdite' });
    }

    const updated = await withReallocation(db, document, req.user.store_id, req.user.client_key, req.user.id, async () => {
      const article = await getArticle(db, req.user.store_id, req.body || {}, line);
      const x = computeLine(req.body || {}, article, document, line);
      const selectedLot = await getSelectedLot(db, req.user.store_id, article?.id, clean(req.body?.selected_lot_id || line.selected_lot_id));
      const label = clean(req.body?.article_label) || article?.designation || line.article_label;
      if (!label) {
        const error = new Error('Designation article obligatoire pour une ligne negoce');
        error.status = 400;
        throw error;
      }

      const result = await db.query(
        `UPDATE sales_lines
         SET article_id = $1,
           article_plu = $2,
           article_label = $3,
           package_count = $4,
           weight_per_package = $5,
           total_weight = $6,
           sold_quantity = $7,
           sale_unit = $8,
           unit_sale_price_ht = $9,
           unit_sale_price_ttc = $10,
           vat_rate = $11,
           line_amount_ht = $12,
           line_vat_amount = $13,
           line_amount_ttc = $14,
           unit_cost_ex_vat = $15,
           line_margin_ex_vat = $16,
           selected_lot_id = $17,
           suggested_lot_id = NULL,
           traceability_snapshot = $18::jsonb,
           updated_by = $19,
           updated_at = NOW()
         WHERE id = $20 AND store_id = $21
         RETURNING *`,
        [
          article?.id || line.article_id || null,
          clean(req.body?.article_plu) || article?.plu || line.article_plu || null,
          label,
          x.packageCount,
          x.weightPerPackage,
          x.totalWeight,
          x.soldQuantity,
          x.saleUnit,
          x.unitPriceHt,
          x.unitTtc,
          x.vatRate,
          x.ht,
          x.vat,
          x.ttc,
          x.cost,
          x.margin,
          selectedLot?.id || clean(req.body?.selected_lot_id) || line.selected_lot_id || null,
          JSON.stringify(traceability(selectedLot || article)),
          req.user.id,
          req.params.id,
          req.user.store_id,
        ]
      );
      return result.rows[0];
    });

    await db.query('COMMIT');
    res.json({ ok: true, line: updated });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur modification ligne BL negoce :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur modification ligne BL negoce' });
  } finally {
    db.release();
  }
});

router.delete('/sales/lines/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res, next) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const line = await getLineDocument(db, req.params.id, req.user.store_id);
    const document = line ? documentFromLine(line) : null;
    if (!line || !isNegoce(document) || !isDeliveryNoteShape(document)) {
      await db.query('ROLLBACK');
      return next();
    }
    logRouteHit('delete-line', document, { line_id: req.params.id });

    if (!isUnlockedNegoceDeliveryNote(document)) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'BL negoce facture ou lie a une facture : modification interdite' });
    }

    await withReallocation(db, document, req.user.store_id, req.user.client_key, req.user.id, async () => {
      await db.query(`DELETE FROM sales_lines WHERE id = $1 AND store_id = $2`, [req.params.id, req.user.store_id]);
    });

    await db.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur suppression ligne BL negoce :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur suppression ligne BL negoce' });
  } finally {
    db.release();
  }
});

module.exports = router;
