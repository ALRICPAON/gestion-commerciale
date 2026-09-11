const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const transport = require('../services/transportService');

const router = express.Router();

function context(req) {
  return { user_id: req.user?.id || null, source: 'ui' };
}

function clean(value) {
  return transport.clean(value);
}

function num(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

router.use(authenticateToken, attachDbContext);

router.get('/carriers', async (req, res) => {
  try {
    res.json(await transport.listCarriers(req.dbPool, req.user.store_id));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur transporteurs' });
  }
});

router.get('/grids', async (req, res) => {
  try {
    const params = [req.user.store_id];
    const where = ['trg.store_id = $1'];
    if (clean(req.query.carrier_id)) {
      params.push(clean(req.query.carrier_id));
      where.push(`trg.carrier_id = $${params.length}`);
    }
    const result = await req.dbPool.query(
      `SELECT trg.*, s.name AS carrier_name,
        COALESCE(jsonb_agg(jsonb_build_object(
          'id', trb.id,
          'min_weight_kg', trb.min_weight_kg,
          'max_weight_kg', trb.max_weight_kg,
          'pricing_mode', trb.pricing_mode,
          'amount_ht', trb.amount_ht,
          'display_order', trb.display_order
        ) ORDER BY trb.display_order ASC, trb.min_weight_kg ASC) FILTER (WHERE trb.id IS NOT NULL), '[]'::jsonb) AS brackets
       FROM transport_rate_grids trg
       LEFT JOIN suppliers s ON s.id = trg.carrier_id AND s.store_id = trg.store_id
       LEFT JOIN transport_rate_brackets trb ON trb.grid_id = trg.id AND trb.store_id = trg.store_id
       WHERE ${where.join(' AND ')}
       GROUP BY trg.id, s.name
       ORDER BY trg.is_active DESC, trg.valid_from DESC, trg.name ASC`,
      params
    );
    res.json({ results: result.rows });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur grilles transport' });
  }
});

router.post('/grids', requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const body = req.body || {};
    if (!clean(body.carrier_id)) throw Object.assign(new Error('Transporteur obligatoire'), { status: 400 });
    if (!clean(body.name)) throw Object.assign(new Error('Nom de grille obligatoire'), { status: 400 });
    const grid = await db.query(
      `INSERT INTO transport_rate_grids (
        store_id, carrier_id, code, name, origin_label, destination_label, valid_from,
        valid_to, is_active, version_number, notes, created_by, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,COALESCE($9::boolean,true),COALESCE($10::int,1),$11,$12,$12)
      RETURNING *`,
      [
        req.user.store_id, clean(body.carrier_id), clean(body.code), clean(body.name),
        clean(body.origin_label), clean(body.destination_label), transport.isoDate(body.valid_from || body.effective_from),
        clean(body.valid_to), body.is_active !== false, Number(body.version_number) || 1, clean(body.notes), req.user.id,
      ]
    );
    const brackets = Array.isArray(body.brackets) ? body.brackets : [];
    let order = 1;
    for (const bracket of brackets) {
      await db.query(
        `INSERT INTO transport_rate_brackets (
          store_id, grid_id, min_weight_kg, max_weight_kg, pricing_mode, amount_ht, display_order
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          req.user.store_id, grid.rows[0].id, num(bracket.min_weight_kg, 0),
          bracket.max_weight_kg === null || bracket.max_weight_kg === '' ? null : num(bracket.max_weight_kg),
          clean(bracket.pricing_mode) || 'per_tonne', num(bracket.amount_ht), Number(bracket.display_order) || order++,
        ]
      );
    }
    await db.query('COMMIT');
    res.status(201).json(grid.rows[0]);
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    res.status(error.status || 500).json({ error: error.message || 'Erreur creation grille transport' });
  } finally {
    db.release();
  }
});

router.get('/chains', async (req, res) => {
  try {
    res.json(await transport.listChains(req.dbPool, req.user.store_id, req.query));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur circuits transport' });
  }
});

router.post('/chains', requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const body = req.body || {};
    if (!clean(body.name)) throw Object.assign(new Error('Nom du circuit obligatoire'), { status: 400 });
    const chain = await db.query(
      `INSERT INTO transport_chains (
        store_id, code, name, direction, origin_label, destination_label, is_active, notes, created_by, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::boolean,true),$8,$9,$9)
      RETURNING *`,
      [
        req.user.store_id, clean(body.code), clean(body.name), clean(body.direction) || 'sale',
        clean(body.origin_label), clean(body.destination_label), body.is_active !== false, clean(body.notes), req.user.id,
      ]
    );
    const legs = Array.isArray(body.legs) ? body.legs : [];
    let order = 1;
    for (const leg of legs) {
      await db.query(
        `INSERT INTO transport_chain_legs (
          store_id, chain_id, leg_order, carrier_id, grid_id, origin_label, destination_label, specific_admin_fee_ht
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          req.user.store_id, chain.rows[0].id, Number(leg.leg_order) || order++,
          clean(leg.carrier_id), clean(leg.grid_id), clean(leg.origin_label),
          clean(leg.destination_label), leg.specific_admin_fee_ht === '' ? null : leg.specific_admin_fee_ht ?? null,
        ]
      );
    }
    await db.query('COMMIT');
    res.status(201).json(chain.rows[0]);
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    res.status(error.status || 500).json({ error: error.message || 'Erreur creation circuit transport' });
  } finally {
    db.release();
  }
});

router.get('/logistics-services', async (req, res) => {
  try {
    const result = await req.dbPool.query(
      `SELECT ls.*, s.name AS carrier_name
       FROM logistics_services ls
       LEFT JOIN suppliers s ON s.id = ls.carrier_id AND s.store_id = ls.store_id
       WHERE ls.store_id = $1
       ORDER BY ls.is_active DESC, ls.label ASC`,
      [req.user.store_id]
    );
    res.json({ results: result.rows });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur prestations logistiques' });
  }
});

router.post('/logistics-services', requireAdminOrManager, async (req, res) => {
  try {
    const body = req.body || {};
    if (!clean(body.label)) throw Object.assign(new Error('Libelle prestation obligatoire'), { status: 400 });
    const result = await req.dbPool.query(
      `INSERT INTO logistics_services (
        store_id, carrier_id, label, calculation_mode, amount_ht, effective_from,
        effective_to, is_active, notes, created_by, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,COALESCE($8::boolean,true),$9,$10,$10)
      RETURNING *`,
      [
        req.user.store_id, clean(body.carrier_id), clean(body.label),
        clean(body.calculation_mode) || 'per_tonne', num(body.amount_ht),
        transport.isoDate(body.effective_from), clean(body.effective_to),
        body.is_active !== false, clean(body.notes), req.user.id,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur creation prestation logistique' });
  }
});

router.get('/day', async (req, res) => {
  try {
    res.json(await transport.listDayShipments(req.dbPool, req.user.store_id, req.query));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur journee transport' });
  }
});

router.post('/shipments', requireAdminOrManager, async (req, res) => {
  try {
    const shipment = await transport.createShipment(req.dbPool, req.user.store_id, req.body, context(req));
    res.status(201).json(shipment);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur creation envoi transport' });
  }
});

router.post('/shipments/:id/generate-blt', requireAdminOrManager, async (req, res) => {
  try {
    const result = await transport.generateTransportDeliveryNote(
      req.dbPool,
      req.user.store_id,
      { ...req.body, shipment_id: req.params.id },
      context(req)
    );
    res.status(result.existing ? 200 : 201).json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur generation BL transport' });
  }
});

router.post('/pricing/:sessionId/apply-purchase-estimates', requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const result = await transport.applyPurchaseTransportEstimatesToPricingSession(db, req.user.store_id, req.params.sessionId, context(req));
    await db.query('COMMIT');
    res.json(result);
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    res.status(error.status || 500).json({ error: error.message || 'Erreur calcul transport achat' });
  } finally {
    db.release();
  }
});

module.exports = router;
