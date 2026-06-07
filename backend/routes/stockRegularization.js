const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const { recomputeArticleStock } = require('../services/stockService');

const router = express.Router();
const REGULARIZATION_NOTE = 'Régularisation stock négatif suite sortie forcée';

function clean(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function safeLimit(value, fallback = 250, max = 1000) {
  const parsed = Number(value);
  return Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : fallback, max);
}

async function getNegativeLot(client, lotId, storeId) {
  const result = await client.query(
    `SELECT l.id, l.store_id, l.article_id, l.qty_remaining, l.unit_cost_ex_vat,
            l.lot_code, l.supplier_lot_number, a.plu, a.designation, a.unit,
            s.name supplier_name, s.code supplier_code
     FROM lots l
     JOIN articles a ON a.id = l.article_id AND a.store_id = l.store_id
     LEFT JOIN suppliers s ON s.id = l.supplier_id
     WHERE l.id = $1
       AND l.store_id = $2
       AND l.qty_remaining < 0
     LIMIT 1`,
    [lotId, storeId]
  );
  return result.rows[0] || null;
}

router.get('/negative-lots', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const params = [req.user.store_id];
    let where = 'WHERE l.store_id = $1 AND l.qty_remaining < 0';

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
      `SELECT l.id lot_id, l.article_id::text article_id, l.lot_code, l.supplier_lot_number,
              l.qty_remaining, l.qty_initial, l.unit_cost_ex_vat, l.dlc,
              a.plu, a.designation, a.unit,
              s.name supplier_name, s.code supplier_code,
              last_move.created_at last_movement_at,
              last_move.movement_type last_movement_type,
              last_move.source_table last_source_table,
              last_move.source_id last_source_id,
              last_move.notes last_movement_notes,
              forced_move.created_at forced_movement_at,
              forced_move.movement_type forced_movement_type,
              forced_move.source_table forced_source_table,
              forced_move.source_id forced_source_id,
              forced_move.notes forced_movement_notes
       FROM lots l
       JOIN articles a ON a.id = l.article_id AND a.store_id = l.store_id
       LEFT JOIN suppliers s ON s.id = l.supplier_id
       LEFT JOIN LATERAL (
         SELECT sm.created_at, sm.movement_type, sm.source_table, sm.source_id, sm.notes
         FROM stock_movements sm
         WHERE sm.store_id = l.store_id
           AND sm.lot_id = l.id
         ORDER BY sm.created_at DESC, sm.id DESC
         LIMIT 1
       ) last_move ON true
       LEFT JOIN LATERAL (
         SELECT sm.created_at, sm.movement_type, sm.source_table, sm.source_id, sm.notes
         FROM stock_movements sm
         WHERE sm.store_id = l.store_id
           AND sm.lot_id = l.id
           AND sm.quantity < 0
           AND (
             COALESCE(sm.notes, '') ILIKE '%force%'
             OR COALESCE(sm.movement_type, '') ILIKE '%force%'
             OR COALESCE(sm.notes, '') ILIKE '%sortie%'
           )
         ORDER BY sm.created_at DESC, sm.id DESC
         LIMIT 1
       ) forced_move ON true
       ${where}
       ORDER BY l.qty_remaining ASC, last_move.created_at DESC NULLS LAST, a.designation ASC
       LIMIT $${params.length}`,
      params
    );

    console.info('Régularisation stock: lots négatifs listés', {
      store_id: req.user.store_id,
      count: result.rows.length,
    });

    return res.json(result.rows.map((row) => ({
      ...row,
      qty_remaining: Number(row.qty_remaining || 0),
      qty_initial: Number(row.qty_initial || 0),
      unit_cost_ex_vat: Number(row.unit_cost_ex_vat || 0),
    })));
  } catch (error) {
    console.error('Erreur GET /api/stock/negative-lots :', error);
    return res.status(500).json({ error: 'Erreur serveur stocks négatifs' });
  }
});

router.post('/negative-lots/:lotId/regularize', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    const lotId = clean(req.params.lotId);
    if (!isUuid(lotId)) return res.status(400).json({ error: 'lot_id invalide' });
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirmation utilisateur obligatoire' });

    await client.query('BEGIN');
    const lot = await getNegativeLot(client, lotId, req.user.store_id);
    if (!lot) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Lot négatif introuvable ou déjà régularisé' });
    }

    const currentQty = Number(lot.qty_remaining || 0);
    const regularizationQty = Math.abs(currentQty);
    if (regularizationQty <= 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Le lot ne nécessite pas de régularisation' });
    }

    await client.query(
      `UPDATE lots
       SET qty_remaining = 0,
           updated_at = NOW()
       WHERE id = $1
         AND store_id = $2
         AND qty_remaining = $3
       RETURNING id`,
      [lot.id, req.user.store_id, lot.qty_remaining]
    ).then((updated) => {
      if (!updated.rows.length) {
        const error = new Error('Le stock du lot a changé, recharge la liste avant de régulariser');
        error.status = 409;
        throw error;
      }
    });

    const movement = await client.query(
      `INSERT INTO stock_movements(
        id, store_id, client_key, article_id, lot_id, movement_type, quantity,
        unit_cost_ex_vat, source_table, source_id, notes, created_by
       ) VALUES(gen_random_uuid(), $1, $2, $3, $4, 'regularization', $5, $6, 'stock_regularization', $4, $7, $8)
       RETURNING *`,
      [
        req.user.store_id,
        req.user.client_key || null,
        lot.article_id,
        lot.id,
        regularizationQty,
        Number(lot.unit_cost_ex_vat || 0),
        REGULARIZATION_NOTE,
        req.user.id,
      ]
    );

    await recomputeArticleStock(client, lot.article_id, req.user.store_id);
    await client.query('COMMIT');

    console.info('Régularisation stock négatif confirmée', {
      store_id: req.user.store_id,
      lot_id: lot.id,
      article_id: lot.article_id,
      previous_qty: currentQty,
      regularization_qty: regularizationQty,
      movement_id: movement.rows[0].id,
    });

    return res.json({
      ok: true,
      lot_id: lot.id,
      article_id: lot.article_id,
      previous_qty: currentQty,
      regularization_qty: regularizationQty,
      new_qty_remaining: 0,
      movement: movement.rows[0],
      message: 'Lot régularisé à 0',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/stock/negative-lots/:lotId/regularize :', error);
    if (error.status) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: error.message || 'Erreur régularisation stock' });
  } finally {
    client.release();
  }
});

module.exports = router;
