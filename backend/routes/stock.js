const express = require('express');

const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');

function clean(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(
    String(value || '')
  );
}

function parseBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return fallback;
}

function parsePositiveNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseNullablePrice(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0) {
    const error = new Error('Les tarifs doivent etre des nombres positifs ou vides');
    error.status = 400;
    throw error;
  }
  return parsed;
}

function safeLimit(value, fallback = 250, max = 1000) {
  const parsed = Number(value);
  return Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : fallback, max);
}

function lotsSelectSql(extraColumns = '') {
  return `
    SELECT
      l.id,
      l.store_id,
      l.article_id,
      a.plu,
      a.designation,
      a.unit,
      a.family_code,
      a.family_name,
      l.purchase_id,
      l.purchase_line_id,
      l.supplier_id,
      s.code AS supplier_code,
      s.name AS supplier_name,
      p.bl_number,
      p.invoice_number,
      p.purchase_date,
      p.receipt_date,
      l.lot_code,
      l.supplier_lot_number,
      l.source_type,
      l.qty_initial,
      l.qty_remaining,
      l.unit_cost_ex_vat,
      l.dlc,
      l.traceability_data,
      COALESCE(l.traceability_data->>'latin_name', a.latin_name) AS latin_name,
      COALESCE(l.traceability_data->>'fao_zone', a.fao_zone) AS fao_zone,
      COALESCE(l.traceability_data->>'sous_zone', a.sous_zone) AS sous_zone,
      COALESCE(l.traceability_data->>'fishing_gear', a.fishing_gear) AS fishing_gear,
      COALESCE(l.traceability_data->>'production_method', a.production_method) AS production_method,
      COALESCE(l.traceability_data->>'allergens', a.allergens) AS allergens,
      l.traceability_data->>'origin_label' AS origin_label,
      ROW_NUMBER() OVER (
        PARTITION BY l.article_id
        ORDER BY COALESCE(l.dlc, DATE '9999-12-31') ASC, l.created_at ASC, l.id ASC
      ) AS fifo_rank,
      l.created_at,
      l.updated_at
      ${extraColumns}
    FROM lots l
    JOIN articles a ON a.id = l.article_id AND a.store_id = l.store_id
    LEFT JOIN suppliers s ON s.id = l.supplier_id
    LEFT JOIN purchases p ON p.id = l.purchase_id
  `;
}

function summarySelectSql() {
  return `
    SELECT
      ss.id,
      ss.store_id,
      ss.article_id,
      a.plu,
      a.designation,
      a.unit,
      a.ean,
      a.family_code,
      a.family_name,
      a.sale_price_level_1_ht,
      a.sale_price_level_2_ht,
      a.sale_price_level_3_ht,
      ss.stock_quantity,
      ss.stock_value_ex_vat,
      ss.pma,
      ss.next_dlc,
      ss.updated_at,
      next_lot.id AS next_lot_id,
      next_lot.lot_code AS next_lot_code,
      next_lot.supplier_lot_number AS next_supplier_lot_number,
      next_lot.dlc AS next_lot_dlc,
      COALESCE(next_lot.traceability_data->>'latin_name', a.latin_name) AS latin_name,
      COALESCE(next_lot.traceability_data->>'fao_zone', a.fao_zone) AS fao_zone,
      COALESCE(next_lot.traceability_data->>'sous_zone', a.sous_zone) AS sous_zone,
      COALESCE(next_lot.traceability_data->>'fishing_gear', a.fishing_gear) AS fishing_gear,
      COALESCE(next_lot.traceability_data->>'production_method', a.production_method) AS production_method,
      COALESCE(next_lot.traceability_data->>'allergens', a.allergens) AS allergens,
      next_lot.traceability_data->>'origin_label' AS origin_label
    FROM stock_summary ss
    JOIN articles a ON a.id = ss.article_id AND a.store_id = ss.store_id
    LEFT JOIN LATERAL (
      SELECT l.*
      FROM lots l
      WHERE l.store_id = ss.store_id
        AND l.article_id = ss.article_id
        AND l.qty_remaining > 0
      ORDER BY COALESCE(l.dlc, DATE '9999-12-31') ASC, l.created_at ASC, l.id ASC
      LIMIT 1
    ) next_lot ON true
  `;
}

router.get('/', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const params = [req.user.store_id];
    const availableOnly = parseBool(req.query.available_only, true);
    let where = 'WHERE ss.store_id = $1';

    if (availableOnly) where += ' AND ss.stock_quantity > 0';

    if (clean(req.query.search)) {
      params.push(`%${clean(req.query.search)}%`);
      const idx = params.length;
      where += ` AND (
        a.plu ILIKE $${idx}
        OR a.designation ILIKE $${idx}
        OR COALESCE(a.ean, '') ILIKE $${idx}
        OR COALESCE(a.latin_name, '') ILIKE $${idx}
        OR COALESCE(a.family_name, '') ILIKE $${idx}
      )`;
    }

    if (clean(req.query.family)) {
      params.push(clean(req.query.family));
      where += ` AND a.family_code = $${params.length}`;
    }

    params.push(safeLimit(req.query.limit));

    const result = await req.dbPool.query(
      `
      ${summarySelectSql()}
      ${where}
      ORDER BY a.designation ASC
      LIMIT $${params.length}
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/stock :', err);
    res.status(500).json({ error: 'Erreur serveur stock' });
  }
});

router.get('/lots', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const params = [req.user.store_id];
    const availableOnly = parseBool(req.query.available_only, true);
    let where = 'WHERE l.store_id = $1';

    if (availableOnly) where += ' AND l.qty_remaining > 0';

    if (clean(req.query.article_id)) {
      const articleId = clean(req.query.article_id);
      if (!isUuid(articleId)) return res.status(400).json({ error: 'article_id invalide' });
      params.push(articleId);
      where += ` AND l.article_id = $${params.length}`;
    }

    if (clean(req.query.search)) {
      params.push(`%${clean(req.query.search)}%`);
      const idx = params.length;
      where += ` AND (
        a.plu ILIKE $${idx}
        OR a.designation ILIKE $${idx}
        OR l.lot_code ILIKE $${idx}
        OR COALESCE(l.supplier_lot_number, '') ILIKE $${idx}
        OR COALESCE(s.name, '') ILIKE $${idx}
      )`;
    }

    params.push(safeLimit(req.query.limit));

    const result = await req.dbPool.query(
      `
      ${lotsSelectSql()}
      ${where}
      ORDER BY COALESCE(l.dlc, DATE '9999-12-31') ASC, l.created_at ASC, l.id ASC
      LIMIT $${params.length}
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/stock/lots :', err);
    res.status(500).json({ error: 'Erreur serveur lots' });
  }
});

router.patch('/articles/:articleId/prices', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const articleId = clean(req.params.articleId);
    if (!articleId || !isUuid(articleId)) return res.status(400).json({ error: 'ID article invalide' });

    const price1 = parseNullablePrice(req.body.sale_price_level_1_ht);
    const price2 = parseNullablePrice(req.body.sale_price_level_2_ht);
    const price3 = parseNullablePrice(req.body.sale_price_level_3_ht);

    const result = await req.dbPool.query(
      `
      UPDATE articles
      SET
        sale_price_level_1_ht = $1,
        sale_price_level_2_ht = $2,
        sale_price_level_3_ht = $3,
        updated_by = $4,
        updated_at = NOW()
      WHERE id = $5
        AND store_id = $6
      RETURNING id, sale_price_level_1_ht, sale_price_level_2_ht, sale_price_level_3_ht
      `,
      [price1, price2, price3, req.user.id, articleId, req.user.store_id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Article introuvable' });
    res.json({ ok: true, prices: result.rows[0] });
  } catch (err) {
    console.error('Erreur PATCH /api/stock/articles/:articleId/prices :', err);
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Erreur serveur tarifs article' });
  }
});

router.get('/articles/:articleId', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const articleId = clean(req.params.articleId);
    if (!articleId || !isUuid(articleId)) return res.status(400).json({ error: 'ID article invalide' });

    const result = await req.dbPool.query(
      `
      ${summarySelectSql()}
      WHERE ss.store_id = $1
        AND ss.article_id = $2
      LIMIT 1
      `,
      [req.user.store_id, articleId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Stock article introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur GET /api/stock/articles/:articleId :', err);
    res.status(500).json({ error: 'Erreur serveur stock article' });
  }
});

router.get('/articles/:articleId/lots', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const articleId = clean(req.params.articleId);
    if (!articleId || !isUuid(articleId)) return res.status(400).json({ error: 'ID article invalide' });

    const availableOnly = parseBool(req.query.available_only, true);
    const where = `
      WHERE l.store_id = $1
        AND l.article_id = $2
        ${availableOnly ? 'AND l.qty_remaining > 0' : ''}
    `;

    const result = await req.dbPool.query(
      `
      ${lotsSelectSql()}
      ${where}
      ORDER BY COALESCE(l.dlc, DATE '9999-12-31') ASC, l.created_at ASC, l.id ASC
      `,
      [req.user.store_id, articleId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/stock/articles/:articleId/lots :', err);
    res.status(500).json({ error: 'Erreur serveur lots article' });
  }
});

router.get('/articles/:articleId/fifo', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const articleId = clean(req.params.articleId);
    if (!articleId || !isUuid(articleId)) return res.status(400).json({ error: 'ID article invalide' });

    const requestedQuantity = parsePositiveNumber(req.query.quantity);
    if (!requestedQuantity) return res.status(400).json({ error: 'quantity doit etre positive' });

    const lots = await req.dbPool.query(
      `
      ${lotsSelectSql()}
      WHERE l.store_id = $1
        AND l.article_id = $2
        AND l.qty_remaining > 0
      ORDER BY COALESCE(l.dlc, DATE '9999-12-31') ASC, l.created_at ASC, l.id ASC
      `,
      [req.user.store_id, articleId]
    );

    let remainingToAllocate = requestedQuantity;
    const allocation = [];

    for (const lot of lots.rows) {
      if (remainingToAllocate <= 0) break;
      const available = Number(lot.qty_remaining || 0);
      const quantity = Math.min(available, remainingToAllocate);
      if (quantity > 0) {
        allocation.push({
          ...lot,
          suggested_quantity: Number(quantity.toFixed(3)),
        });
        remainingToAllocate = Number((remainingToAllocate - quantity).toFixed(3));
      }
    }

    res.json({
      article_id: articleId,
      requested_quantity: requestedQuantity,
      allocated_quantity: Number((requestedQuantity - remainingToAllocate).toFixed(3)),
      missing_quantity: remainingToAllocate,
      is_fully_allocated: remainingToAllocate <= 0,
      strategy: 'fifo_dlc_then_creation',
      lots: allocation,
    });
  } catch (err) {
    console.error('Erreur GET /api/stock/articles/:articleId/fifo :', err);
    res.status(500).json({ error: 'Erreur serveur allocation FIFO' });
  }
});

router.get('/movements', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const params = [req.user.store_id];
    let where = 'WHERE sm.store_id = $1';

    if (clean(req.query.article_id)) {
      const articleId = clean(req.query.article_id);
      if (!isUuid(articleId)) return res.status(400).json({ error: 'article_id invalide' });
      params.push(articleId);
      where += ` AND sm.article_id = $${params.length}`;
    }

    if (clean(req.query.lot_id)) {
      const lotId = clean(req.query.lot_id);
      if (!isUuid(lotId)) return res.status(400).json({ error: 'lot_id invalide' });
      params.push(lotId);
      where += ` AND sm.lot_id = $${params.length}`;
    }

    params.push(safeLimit(req.query.limit, 100, 500));

    const result = await req.dbPool.query(
      `
      SELECT
        sm.*,
        a.plu,
        a.designation,
        l.lot_code,
        l.supplier_lot_number
      FROM stock_movements sm
      JOIN articles a ON a.id = sm.article_id AND a.store_id = sm.store_id
      LEFT JOIN lots l ON l.id = sm.lot_id
      ${where}
      ORDER BY sm.created_at DESC
      LIMIT $${params.length}
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/stock/movements :', err);
    res.status(500).json({ error: 'Erreur serveur mouvements stock' });
  }
});

module.exports = router;
