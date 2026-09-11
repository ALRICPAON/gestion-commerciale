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

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function assertNonNegative(value, label, fallback = 0) {
  const parsed = num(value, fallback);
  if (parsed < 0) throw badRequest(`${label} doit etre positif`);
  return parsed;
}

function validatePeriod(start, end, startLabel = 'Date de debut') {
  if (!clean(start)) throw badRequest(`${startLabel} obligatoire`);
  const from = transport.isoDate(start);
  const to = dateOrNull(end);
  if (to && to < from) throw badRequest('La date de fin doit etre posterieure au debut');
  return { from, to };
}

function dateOrNull(value) {
  return clean(value) ? transport.isoDate(value) : null;
}

function validateGridPayload(body = {}) {
  if (!clean(body.carrier_id)) throw badRequest('Transporteur obligatoire');
  if (!clean(body.name)) throw badRequest('Nom de grille obligatoire');
  const period = validatePeriod(body.valid_from || body.effective_from, body.valid_to, 'Debut de validite');
  const brackets = Array.isArray(body.brackets) ? body.brackets : [];
  if (!brackets.length) throw badRequest('Au moins une tranche tarifaire est obligatoire');
  const allowedModes = new Set(['fixed', 'per_tonne']);
  const normalizedBrackets = brackets.map((bracket, index) => {
    const minWeight = assertNonNegative(bracket.min_weight_kg, 'Poids minimum', 0);
    const maxWeight = bracket.max_weight_kg === null || bracket.max_weight_kg === '' ? null : assertNonNegative(bracket.max_weight_kg, 'Poids maximum', 0);
    if (maxWeight !== null && maxWeight < minWeight) throw badRequest('Le poids maximum doit etre superieur au poids minimum');
    const pricingMode = clean(bracket.pricing_mode) || 'per_tonne';
    if (!allowedModes.has(pricingMode)) throw badRequest('Mode de tranche transport invalide');
    return {
      min_weight_kg: minWeight,
      max_weight_kg: maxWeight,
      pricing_mode: pricingMode,
      amount_ht: assertNonNegative(bracket.amount_ht, 'Montant HT', 0),
      display_order: Number(bracket.display_order) || index + 1,
    };
  });
  return { period, brackets: normalizedBrackets };
}

function validateChainPayload(body = {}) {
  if (!clean(body.name)) throw badRequest('Nom du circuit obligatoire');
  const direction = clean(body.direction) || 'sale';
  if (!['purchase', 'sale', 'both'].includes(direction)) throw badRequest('Sens du circuit invalide');
  const legs = Array.isArray(body.legs) ? body.legs : [];
  if (!legs.length) throw badRequest('Au moins une etape de circuit est obligatoire');
  const seenOrders = new Set();
  const normalizedLegs = legs.map((leg, index) => {
    if (!clean(leg.carrier_id)) throw badRequest('Transporteur obligatoire sur chaque etape');
    if (!clean(leg.grid_id)) throw badRequest('Grille obligatoire sur chaque etape');
    const legOrder = Number(leg.leg_order) || index + 1;
    if (seenOrders.has(legOrder)) throw badRequest('Ordre des etapes en doublon');
    seenOrders.add(legOrder);
    return {
      leg_order: legOrder,
      carrier_id: clean(leg.carrier_id),
      grid_id: clean(leg.grid_id),
      origin_label: clean(leg.origin_label),
      destination_label: clean(leg.destination_label),
      specific_admin_fee_ht: leg.specific_admin_fee_ht === '' || leg.specific_admin_fee_ht === null || leg.specific_admin_fee_ht === undefined
        ? null
        : assertNonNegative(leg.specific_admin_fee_ht, 'Frais admin etape', 0),
    };
  });
  return { direction, legs: normalizedLegs };
}

function validateLogisticsServicePayload(body = {}) {
  if (!clean(body.label)) throw badRequest('Libelle prestation obligatoire');
  const calculationMode = clean(body.calculation_mode) || 'per_tonne';
  if (!['per_kg', 'per_tonne', 'fixed'].includes(calculationMode)) throw badRequest('Mode de prestation invalide');
  const period = validatePeriod(body.effective_from, body.effective_to, "Date d'effet");
  return {
    calculation_mode: calculationMode,
    amount_ht: assertNonNegative(body.amount_ht, 'Montant HT', 0),
    period,
  };
}

function hasOwn(body = {}, field) {
  return Object.prototype.hasOwnProperty.call(body, field);
}

function resolveCarrierSettingPatch(existing = {}, body = {}) {
  const mode = hasOwn(body, 'purchase_transport_mode')
    ? clean(body.purchase_transport_mode) || 'manual'
    : clean(existing.purchase_transport_mode) || 'manual';
  if (!['franco', 'carrier_paid_by_us', 'manual'].includes(mode)) throw badRequest('Mode achat transport invalide');
  return {
    purchase_transport_mode: mode,
    purchase_transport_chain_id: hasOwn(body, 'purchase_transport_chain_id')
      ? clean(body.purchase_transport_chain_id)
      : clean(existing.purchase_transport_chain_id),
    admin_fee_ht: hasOwn(body, 'admin_fee_ht')
      ? assertNonNegative(body.admin_fee_ht, 'Frais administratifs HT', 0)
      : assertNonNegative(existing.admin_fee_ht, 'Frais administratifs HT', 0),
    notes: hasOwn(body, 'notes') ? clean(body.notes) : clean(existing.notes),
  };
}

async function assertCarrier(db, storeId, carrierId) {
  const result = await db.query(
    `SELECT id FROM suppliers
     WHERE id = $1 AND store_id = $2 AND COALESCE(status, 'active') <> 'inactive'
     LIMIT 1`,
    [carrierId, storeId]
  );
  if (!result.rows[0]) throw Object.assign(new Error('Transporteur introuvable'), { status: 404 });
}

async function assertGridForCarrier(db, storeId, gridId, carrierId) {
  const result = await db.query(
    `SELECT id FROM transport_rate_grids
     WHERE id = $1 AND store_id = $2 AND carrier_id = $3
     LIMIT 1`,
    [gridId, storeId, carrierId]
  );
  if (!result.rows[0]) throw Object.assign(new Error('Grille transport introuvable pour ce transporteur'), { status: 404 });
}

function allKeysAllowed(body = {}, allowed = []) {
  const allowedSet = new Set(allowed);
  return Object.keys(body || {}).every((key) => allowedSet.has(key));
}

function deletionDecision(usage = {}, fallback = 'deactivate') {
  return usage.used ? { delete_physical: false, fallback } : { delete_physical: true, fallback: null };
}

async function getById(db, table, storeId, id, label) {
  const result = await db.query(`SELECT * FROM ${table} WHERE id = $1 AND store_id = $2 LIMIT 1`, [id, storeId]);
  if (!result.rows[0]) throw Object.assign(new Error(`${label} introuvable`), { status: 404 });
  return result.rows[0];
}

async function gridUsage(db, storeId, gridId) {
  const legs = await db.query('SELECT COUNT(*)::int AS count FROM transport_chain_legs WHERE store_id = $1 AND grid_id = $2', [storeId, gridId]);
  const snapshots = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM transport_delivery_notes
     WHERE store_id = $1 AND calculation_snapshot::text LIKE $2`,
    [storeId, `%${gridId}%`]
  );
  return { chain_legs: legs.rows[0].count, snapshots: snapshots.rows[0].count, used: legs.rows[0].count > 0 || snapshots.rows[0].count > 0 };
}

async function chainUsage(db, storeId, chainId) {
  const supplierSettings = await db.query('SELECT COUNT(*)::int AS count FROM supplier_transport_settings WHERE store_id = $1 AND purchase_transport_chain_id = $2', [storeId, chainId]);
  const clientSettings = await db.query('SELECT COUNT(*)::int AS count FROM clients WHERE store_id = $1 AND sale_transport_chain_id = $2', [storeId, chainId]);
  const shipments = await db.query('SELECT COUNT(*)::int AS count FROM transport_shipments WHERE store_id = $1 AND chain_id = $2', [storeId, chainId]);
  const deliveryNotes = await db.query('SELECT COUNT(*)::int AS count FROM transport_delivery_notes WHERE store_id = $1 AND calculation_snapshot::text LIKE $2', [storeId, `%${chainId}%`]);
  return {
    supplier_settings: supplierSettings.rows[0].count,
    client_settings: clientSettings.rows[0].count,
    shipments: shipments.rows[0].count,
    delivery_notes: deliveryNotes.rows[0].count,
    used: supplierSettings.rows[0].count > 0 || clientSettings.rows[0].count > 0 || shipments.rows[0].count > 0 || deliveryNotes.rows[0].count > 0,
  };
}

async function logisticsServiceUsage(db, storeId, serviceId) {
  const assignments = await db.query('SELECT COUNT(*)::int AS count FROM client_logistics_services WHERE store_id = $1 AND logistics_service_id = $2', [storeId, serviceId]);
  const snapshots = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM transport_delivery_notes
     WHERE store_id = $1 AND calculation_snapshot::text LIKE $2`,
    [storeId, `%${serviceId}%`]
  );
  return { assignments: assignments.rows[0].count, snapshots: snapshots.rows[0].count, used: assignments.rows[0].count > 0 || snapshots.rows[0].count > 0 };
}

async function fuelSurchargeUsage(db, storeId, rate) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM transport_delivery_notes
     WHERE store_id = $1
       AND carrier_id = $2
       AND document_date >= $3::date
       AND ($4::date IS NULL OR document_date <= $4::date)`,
    [storeId, rate.carrier_id, rate.effective_from, rate.effective_to]
  );
  return { delivery_notes: result.rows[0].count, used: result.rows[0].count > 0 };
}

async function shipmentUsage(db, storeId, shipmentId) {
  const result = await db.query(
    'SELECT COUNT(*)::int AS count FROM transport_delivery_notes WHERE store_id = $1 AND shipment_id = $2',
    [storeId, shipmentId]
  );
  return { delivery_notes: result.rows[0].count, used: result.rows[0].count > 0 };
}

router.use(authenticateToken, attachDbContext);

router.get('/carriers', async (req, res) => {
  try {
    res.json(await transport.listCarriers(req.dbPool, req.user.store_id));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur transporteurs' });
  }
});

router.get('/carrier-settings', async (req, res) => {
  try {
    const result = await req.dbPool.query(
      `SELECT s.id AS carrier_id, s.code, s.name, s.supplier_type, s.is_carrier,
              COALESCE(sts.purchase_transport_mode, 'manual') AS purchase_transport_mode,
              sts.purchase_transport_chain_id,
              COALESCE(sts.admin_fee_ht, 0) AS admin_fee_ht,
              sts.notes
       FROM suppliers s
       LEFT JOIN supplier_transport_settings sts
         ON sts.supplier_id = s.id AND sts.store_id = s.store_id
       WHERE s.store_id = $1
         AND COALESCE(s.status, 'active') <> 'inactive'
         AND (s.is_carrier = true OR s.supplier_type = 'transporteur')
       ORDER BY s.name ASC`,
      [req.user.store_id]
    );
    res.json({ results: result.rows });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur parametrage transporteurs' });
  }
});

router.put('/carriers/:carrierId/settings', requireAdminOrManager, async (req, res) => {
  try {
    const carrierId = clean(req.params.carrierId);
    if (!carrierId) throw badRequest('Transporteur obligatoire');
    const supplier = await req.dbPool.query(
      `SELECT id FROM suppliers
       WHERE id = $1 AND store_id = $2 AND COALESCE(status, 'active') <> 'inactive'
       LIMIT 1`,
      [carrierId, req.user.store_id]
    );
    if (!supplier.rows[0]) throw Object.assign(new Error('Transporteur introuvable'), { status: 404 });
    const existing = await req.dbPool.query(
      `SELECT purchase_transport_mode, purchase_transport_chain_id, admin_fee_ht, notes
       FROM supplier_transport_settings
       WHERE store_id = $1 AND supplier_id = $2
       LIMIT 1`,
      [req.user.store_id, carrierId]
    );
    const patch = resolveCarrierSettingPatch(existing.rows[0] || {}, req.body || {});
    await req.dbPool.query(
      `UPDATE suppliers
       SET is_carrier = true, updated_by = $3, updated_at = now()
       WHERE id = $1 AND store_id = $2`,
      [carrierId, req.user.store_id, req.user.id]
    );
    const result = await req.dbPool.query(
      `INSERT INTO supplier_transport_settings (
        store_id, supplier_id, purchase_transport_mode, purchase_transport_chain_id,
        admin_fee_ht, notes, created_by, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
      ON CONFLICT (store_id, supplier_id)
      DO UPDATE SET purchase_transport_mode = EXCLUDED.purchase_transport_mode,
        purchase_transport_chain_id = EXCLUDED.purchase_transport_chain_id,
        admin_fee_ht = EXCLUDED.admin_fee_ht,
        notes = EXCLUDED.notes,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
      RETURNING *`,
      [
        req.user.store_id,
        carrierId,
        patch.purchase_transport_mode,
        patch.purchase_transport_chain_id,
        patch.admin_fee_ht,
        patch.notes,
        req.user.id,
      ]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur enregistrement parametrage transporteur' });
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

router.get('/fuel-surcharges', async (req, res) => {
  try {
    const params = [req.user.store_id];
    const where = ['tfs.store_id = $1'];
    if (clean(req.query.carrier_id)) {
      params.push(clean(req.query.carrier_id));
      where.push(`tfs.carrier_id = $${params.length}`);
    }
    const result = await req.dbPool.query(
      `SELECT tfs.*, s.name AS carrier_name
       FROM transport_fuel_surcharges tfs
       JOIN suppliers s ON s.id = tfs.carrier_id AND s.store_id = tfs.store_id
       WHERE ${where.join(' AND ')}
       ORDER BY s.name ASC, tfs.effective_from DESC`,
      params
    );
    res.json({ results: result.rows });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur historique carburant' });
  }
});

router.post('/fuel-surcharges', requireAdminOrManager, async (req, res) => {
  try {
    const body = req.body || {};
    if (!clean(body.carrier_id)) throw Object.assign(new Error('Transporteur obligatoire'), { status: 400 });
    const period = validatePeriod(body.effective_from, body.effective_to, "Date d'effet");
    await assertCarrier(req.dbPool, req.user.store_id, clean(body.carrier_id));
    const result = await req.dbPool.query(
      `INSERT INTO transport_fuel_surcharges (
        store_id, carrier_id, effective_from, effective_to, surcharge_percent, notes, created_by, updated_by
      ) VALUES ($1,$2,$3::date,$4::date,$5,$6,$7,$7)
      RETURNING *`,
      [
        req.user.store_id,
        clean(body.carrier_id),
        period.from,
        period.to,
        assertNonNegative(body.surcharge_percent, 'Taux carburant', 0),
        clean(body.notes),
        req.user.id,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur creation taux carburant' });
  }
});

router.patch('/fuel-surcharges/:id', requireAdminOrManager, async (req, res) => {
  try {
    const rate = await getById(req.dbPool, 'transport_fuel_surcharges', req.user.store_id, req.params.id, 'Taux carburant');
    const usage = await fuelSurchargeUsage(req.dbPool, req.user.store_id, rate);
    if (usage.used && !allKeysAllowed(req.body, ['effective_to', 'notes'])) {
      throw Object.assign(new Error('Taux carburant deja utilise : seule la cloture ou les notes sont autorisees'), { status: 409 });
    }
    const carrierId = hasOwn(req.body, 'carrier_id') ? clean(req.body.carrier_id) : rate.carrier_id;
    const effectiveFrom = hasOwn(req.body, 'effective_from') ? transport.isoDate(req.body.effective_from) : transport.isoDate(rate.effective_from);
    const effectiveTo = hasOwn(req.body, 'effective_to') ? dateOrNull(req.body.effective_to) : dateOrNull(rate.effective_to);
    if (effectiveTo && transport.isoDate(effectiveTo) < effectiveFrom) throw badRequest('La date de fin doit etre posterieure au debut');
    if (!usage.used && carrierId) await assertCarrier(req.dbPool, req.user.store_id, carrierId);
    const result = await req.dbPool.query(
      `UPDATE transport_fuel_surcharges
       SET carrier_id = $3, effective_from = $4::date, effective_to = $5::date,
           surcharge_percent = $6, notes = $7, updated_by = $8, updated_at = now()
       WHERE id = $1 AND store_id = $2
       RETURNING *`,
      [
        rate.id,
        req.user.store_id,
        carrierId,
        effectiveFrom,
        effectiveTo,
        hasOwn(req.body, 'surcharge_percent') ? assertNonNegative(req.body.surcharge_percent, 'Taux carburant', 0) : rate.surcharge_percent,
        hasOwn(req.body, 'notes') ? clean(req.body.notes) : clean(rate.notes),
        req.user.id,
      ]
    );
    res.json({ result: result.rows[0], usage });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur modification taux carburant' });
  }
});

router.delete('/fuel-surcharges/:id', requireAdminOrManager, async (req, res) => {
  try {
    const rate = await getById(req.dbPool, 'transport_fuel_surcharges', req.user.store_id, req.params.id, 'Taux carburant');
    const usage = await fuelSurchargeUsage(req.dbPool, req.user.store_id, rate);
    if (usage.used) {
      throw Object.assign(new Error('Taux carburant deja utilise : suppression interdite, cloturez la periode'), { status: 409, details: usage });
    }
    await req.dbPool.query('DELETE FROM transport_fuel_surcharges WHERE id = $1 AND store_id = $2', [rate.id, req.user.store_id]);
    res.json({ ok: true, deleted: true, usage });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur suppression taux carburant', details: error.details });
  }
});

router.post('/grids', requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const body = req.body || {};
    const validation = validateGridPayload(body);
    await assertCarrier(db, req.user.store_id, clean(body.carrier_id));
    const grid = await db.query(
      `INSERT INTO transport_rate_grids (
        store_id, carrier_id, code, name, origin_label, destination_label, valid_from,
        valid_to, is_active, version_number, notes, created_by, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,COALESCE($9::boolean,true),COALESCE($10::int,1),$11,$12,$12)
      RETURNING *`,
      [
        req.user.store_id, clean(body.carrier_id), clean(body.code), clean(body.name),
        clean(body.origin_label), clean(body.destination_label), validation.period.from,
        validation.period.to, body.is_active !== false, Number(body.version_number) || 1, clean(body.notes), req.user.id,
      ]
    );
    for (const bracket of validation.brackets) {
      await db.query(
        `INSERT INTO transport_rate_brackets (
          store_id, grid_id, min_weight_kg, max_weight_kg, pricing_mode, amount_ht, display_order
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          req.user.store_id, grid.rows[0].id, bracket.min_weight_kg,
          bracket.max_weight_kg, bracket.pricing_mode, bracket.amount_ht, bracket.display_order,
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

router.patch('/grids/:id', requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const grid = await getById(db, 'transport_rate_grids', req.user.store_id, req.params.id, 'Grille transport');
    const usage = await gridUsage(db, req.user.store_id, grid.id);
    const body = req.body || {};
    if (usage.used && !allKeysAllowed(body, ['valid_to', 'is_active', 'notes'])) {
      throw Object.assign(new Error('Grille deja utilisee : modification retroactive interdite, creez une nouvelle version'), { status: 409, details: usage });
    }
    if (usage.used) {
      const result = await db.query(
        `UPDATE transport_rate_grids
         SET valid_to = $3::date, is_active = COALESCE($4::boolean, is_active),
             notes = COALESCE($5, notes), updated_by = $6, updated_at = now()
         WHERE id = $1 AND store_id = $2
         RETURNING *`,
        [
          grid.id,
          req.user.store_id,
          hasOwn(body, 'valid_to') ? dateOrNull(body.valid_to) : dateOrNull(grid.valid_to),
          hasOwn(body, 'is_active') ? body.is_active !== false : grid.is_active,
          hasOwn(body, 'notes') ? clean(body.notes) : clean(grid.notes),
          req.user.id,
        ]
      );
      await db.query('COMMIT');
      return res.json({ result: result.rows[0], usage, archived: result.rows[0].is_active === false });
    }
    const existingBrackets = Array.isArray(body.brackets) ? body.brackets : (await db.query(
      `SELECT min_weight_kg, max_weight_kg, pricing_mode, amount_ht, display_order
       FROM transport_rate_brackets
       WHERE store_id = $1 AND grid_id = $2
       ORDER BY display_order ASC, min_weight_kg ASC`,
      [req.user.store_id, grid.id]
    )).rows;
    const validation = validateGridPayload({
      ...grid,
      ...body,
      valid_from: hasOwn(body, 'valid_from') ? body.valid_from : grid.valid_from,
      valid_to: hasOwn(body, 'valid_to') ? body.valid_to : grid.valid_to,
      brackets: existingBrackets,
    });
    await assertCarrier(db, req.user.store_id, clean(body.carrier_id) || grid.carrier_id);
    const result = await db.query(
      `UPDATE transport_rate_grids
       SET carrier_id = $3, code = $4, name = $5, origin_label = $6,
           destination_label = $7, valid_from = $8::date, valid_to = $9::date,
           is_active = $10, notes = $11, updated_by = $12, updated_at = now()
       WHERE id = $1 AND store_id = $2
       RETURNING *`,
      [
        grid.id,
        req.user.store_id,
        clean(body.carrier_id) || grid.carrier_id,
        hasOwn(body, 'code') ? clean(body.code) : clean(grid.code),
        hasOwn(body, 'name') ? clean(body.name) : clean(grid.name),
        hasOwn(body, 'origin_label') ? clean(body.origin_label) : clean(grid.origin_label),
        hasOwn(body, 'destination_label') ? clean(body.destination_label) : clean(grid.destination_label),
        validation.period.from,
        validation.period.to,
        hasOwn(body, 'is_active') ? body.is_active !== false : grid.is_active,
        hasOwn(body, 'notes') ? clean(body.notes) : clean(grid.notes),
        req.user.id,
      ]
    );
    if (Array.isArray(body.brackets)) {
      await db.query('DELETE FROM transport_rate_brackets WHERE store_id = $1 AND grid_id = $2', [req.user.store_id, grid.id]);
      for (const bracket of validation.brackets) {
        await db.query(
          `INSERT INTO transport_rate_brackets (
            store_id, grid_id, min_weight_kg, max_weight_kg, pricing_mode, amount_ht, display_order
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [req.user.store_id, grid.id, bracket.min_weight_kg, bracket.max_weight_kg, bracket.pricing_mode, bracket.amount_ht, bracket.display_order]
        );
      }
    }
    await db.query('COMMIT');
    res.json({ result: result.rows[0], usage });
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    res.status(error.status || 500).json({ error: error.message || 'Erreur modification grille transport', details: error.details });
  } finally {
    db.release();
  }
});

router.delete('/grids/:id', requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const grid = await getById(db, 'transport_rate_grids', req.user.store_id, req.params.id, 'Grille transport');
    const usage = await gridUsage(db, req.user.store_id, grid.id);
    if (usage.used) {
      const result = await db.query(
        `UPDATE transport_rate_grids
         SET is_active = false, valid_to = COALESCE(valid_to, CURRENT_DATE),
             updated_by = $3, updated_at = now()
         WHERE id = $1 AND store_id = $2
         RETURNING *`,
        [grid.id, req.user.store_id, req.user.id]
      );
      await db.query('COMMIT');
      return res.json({ ok: true, deleted: false, deactivated: true, result: result.rows[0], usage });
    }
    await db.query('DELETE FROM transport_rate_grids WHERE id = $1 AND store_id = $2', [grid.id, req.user.store_id]);
    await db.query('COMMIT');
    res.json({ ok: true, deleted: true, usage });
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    res.status(error.status || 500).json({ error: error.message || 'Erreur suppression grille transport', details: error.details });
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
    const validation = validateChainPayload(body);
    for (const leg of validation.legs) {
      await assertCarrier(db, req.user.store_id, leg.carrier_id);
      await assertGridForCarrier(db, req.user.store_id, leg.grid_id, leg.carrier_id);
    }
    const chain = await db.query(
      `INSERT INTO transport_chains (
        store_id, code, name, direction, origin_label, destination_label, is_active, notes, created_by, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::boolean,true),$8,$9,$9)
      RETURNING *`,
      [
        req.user.store_id, clean(body.code), clean(body.name), validation.direction,
        clean(body.origin_label), clean(body.destination_label), body.is_active !== false, clean(body.notes), req.user.id,
      ]
    );
    for (const leg of validation.legs) {
      await db.query(
        `INSERT INTO transport_chain_legs (
          store_id, chain_id, leg_order, carrier_id, grid_id, origin_label, destination_label, specific_admin_fee_ht
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          req.user.store_id, chain.rows[0].id, leg.leg_order,
          clean(leg.carrier_id), clean(leg.grid_id), clean(leg.origin_label),
          clean(leg.destination_label), leg.specific_admin_fee_ht,
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

router.patch('/chains/:id', requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const chain = await getById(db, 'transport_chains', req.user.store_id, req.params.id, 'Circuit transport');
    const body = req.body || {};
    const validation = Array.isArray(body.legs) ? validateChainPayload({ ...chain, ...body }) : null;
    if (validation) {
      for (const leg of validation.legs) {
        await assertCarrier(db, req.user.store_id, leg.carrier_id);
        await assertGridForCarrier(db, req.user.store_id, leg.grid_id, leg.carrier_id);
      }
    }
    const direction = hasOwn(body, 'direction') ? clean(body.direction) || 'sale' : chain.direction;
    if (!['purchase', 'sale', 'both'].includes(direction)) throw badRequest('Sens du circuit invalide');
    const result = await db.query(
      `UPDATE transport_chains
       SET code = $3, name = $4, direction = $5, origin_label = $6,
           destination_label = $7, is_active = $8, notes = $9,
           updated_by = $10, updated_at = now()
       WHERE id = $1 AND store_id = $2
       RETURNING *`,
      [
        chain.id,
        req.user.store_id,
        hasOwn(body, 'code') ? clean(body.code) : clean(chain.code),
        hasOwn(body, 'name') ? clean(body.name) : chain.name,
        direction,
        hasOwn(body, 'origin_label') ? clean(body.origin_label) : clean(chain.origin_label),
        hasOwn(body, 'destination_label') ? clean(body.destination_label) : clean(chain.destination_label),
        hasOwn(body, 'is_active') ? body.is_active !== false : chain.is_active,
        hasOwn(body, 'notes') ? clean(body.notes) : clean(chain.notes),
        req.user.id,
      ]
    );
    if (validation) {
      await db.query('DELETE FROM transport_chain_legs WHERE store_id = $1 AND chain_id = $2', [req.user.store_id, chain.id]);
      for (const leg of validation.legs) {
        await db.query(
          `INSERT INTO transport_chain_legs (
            store_id, chain_id, leg_order, carrier_id, grid_id, origin_label, destination_label, specific_admin_fee_ht
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            req.user.store_id, chain.id, leg.leg_order, leg.carrier_id, leg.grid_id,
            leg.origin_label, leg.destination_label, leg.specific_admin_fee_ht,
          ]
        );
      }
    }
    await db.query('COMMIT');
    res.json({ result: result.rows[0], usage: await chainUsage(req.dbPool, req.user.store_id, chain.id) });
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    res.status(error.status || 500).json({ error: error.message || 'Erreur modification circuit transport', details: error.details });
  } finally {
    db.release();
  }
});

router.delete('/chains/:id', requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const chain = await getById(db, 'transport_chains', req.user.store_id, req.params.id, 'Circuit transport');
    const usage = await chainUsage(db, req.user.store_id, chain.id);
    if (usage.used) {
      const result = await db.query(
        `UPDATE transport_chains
         SET is_active = false, updated_by = $3, updated_at = now()
         WHERE id = $1 AND store_id = $2
         RETURNING *`,
        [chain.id, req.user.store_id, req.user.id]
      );
      await db.query('COMMIT');
      return res.json({ ok: true, deleted: false, deactivated: true, result: result.rows[0], usage });
    }
    await db.query('DELETE FROM transport_chains WHERE id = $1 AND store_id = $2', [chain.id, req.user.store_id]);
    await db.query('COMMIT');
    res.json({ ok: true, deleted: true, usage });
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    res.status(error.status || 500).json({ error: error.message || 'Erreur suppression circuit transport', details: error.details });
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
    const validation = validateLogisticsServicePayload(body);
    if (clean(body.carrier_id)) await assertCarrier(req.dbPool, req.user.store_id, clean(body.carrier_id));
    const result = await req.dbPool.query(
      `INSERT INTO logistics_services (
        store_id, carrier_id, label, calculation_mode, amount_ht, effective_from,
        effective_to, is_active, notes, created_by, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,COALESCE($8::boolean,true),$9,$10,$10)
      RETURNING *`,
      [
        req.user.store_id, clean(body.carrier_id), clean(body.label),
        validation.calculation_mode, validation.amount_ht,
        validation.period.from, validation.period.to,
        body.is_active !== false, clean(body.notes), req.user.id,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur creation prestation logistique' });
  }
});

router.patch('/logistics-services/:id', requireAdminOrManager, async (req, res) => {
  try {
    const service = await getById(req.dbPool, 'logistics_services', req.user.store_id, req.params.id, 'Prestation logistique');
    const body = req.body || {};
    const merged = {
      ...service,
      ...body,
      label: hasOwn(body, 'label') ? body.label : service.label,
      calculation_mode: hasOwn(body, 'calculation_mode') ? body.calculation_mode : service.calculation_mode,
      amount_ht: hasOwn(body, 'amount_ht') ? body.amount_ht : service.amount_ht,
      effective_from: hasOwn(body, 'effective_from') ? body.effective_from : service.effective_from,
      effective_to: hasOwn(body, 'effective_to') ? body.effective_to : service.effective_to,
    };
    const validation = validateLogisticsServicePayload(merged);
    if (hasOwn(body, 'carrier_id') && clean(body.carrier_id)) await assertCarrier(req.dbPool, req.user.store_id, clean(body.carrier_id));
    const result = await req.dbPool.query(
      `UPDATE logistics_services
       SET carrier_id = $3, label = $4, calculation_mode = $5, amount_ht = $6,
           effective_from = $7::date, effective_to = $8::date, is_active = $9,
           notes = $10, updated_by = $11, updated_at = now()
       WHERE id = $1 AND store_id = $2
       RETURNING *`,
      [
        service.id,
        req.user.store_id,
        hasOwn(body, 'carrier_id') ? clean(body.carrier_id) : clean(service.carrier_id),
        clean(merged.label),
        validation.calculation_mode,
        validation.amount_ht,
        validation.period.from,
        validation.period.to,
        hasOwn(body, 'is_active') ? body.is_active !== false : service.is_active,
        hasOwn(body, 'notes') ? clean(body.notes) : clean(service.notes),
        req.user.id,
      ]
    );
    res.json({ result: result.rows[0], usage: await logisticsServiceUsage(req.dbPool, req.user.store_id, service.id) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur modification prestation logistique' });
  }
});

router.delete('/logistics-services/:id', requireAdminOrManager, async (req, res) => {
  try {
    const service = await getById(req.dbPool, 'logistics_services', req.user.store_id, req.params.id, 'Prestation logistique');
    const usage = await logisticsServiceUsage(req.dbPool, req.user.store_id, service.id);
    if (usage.used) {
      const result = await req.dbPool.query(
        `UPDATE logistics_services
         SET is_active = false, effective_to = COALESCE(effective_to, CURRENT_DATE),
             updated_by = $3, updated_at = now()
         WHERE id = $1 AND store_id = $2
         RETURNING *`,
        [service.id, req.user.store_id, req.user.id]
      );
      return res.json({ ok: true, deleted: false, deactivated: true, result: result.rows[0], usage });
    }
    await req.dbPool.query('DELETE FROM logistics_services WHERE id = $1 AND store_id = $2', [service.id, req.user.store_id]);
    res.json({ ok: true, deleted: true, usage });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur suppression prestation logistique', details: error.details });
  }
});

router.get('/clients/:clientId/logistics-services', async (req, res) => {
  try {
    res.json(await transport.listClientLogisticsServices(req.dbPool, req.user.store_id, req.params.clientId, req.query));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur prestations client' });
  }
});

router.put('/clients/:clientId/logistics-services', requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const result = await transport.replaceClientLogisticsServices(
      db,
      req.user.store_id,
      req.params.clientId,
      req.body?.logistics_service_ids || req.body?.service_ids || [],
      context(req)
    );
    await db.query('COMMIT');
    res.json(result);
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    res.status(error.status || 500).json({ error: error.message || 'Erreur enregistrement prestations client' });
  } finally {
    db.release();
  }
});

router.get('/clients/:clientId/sale-logistics-estimate', async (req, res) => {
  try {
    res.json(await transport.estimateClientSaleLogistics(
      req.dbPool,
      req.user.store_id,
      req.params.clientId,
      req.query.date || req.query.pricing_date
    ));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur estimation logistique client' });
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

router.patch('/shipments/:id', requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const shipment = await transport.updateDraftShipment(db, req.user.store_id, req.params.id, req.body, context(req));
    await db.query('COMMIT');
    res.json(shipment);
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    res.status(error.status || 500).json({ error: error.message || 'Erreur modification envoi transport' });
  } finally {
    db.release();
  }
});

router.delete('/shipments/:id', requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    const result = await transport.deleteDraftShipment(db, req.user.store_id, req.params.id, context(req));
    await db.query('COMMIT');
    res.json({ ok: true, ...result });
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    res.status(error.status || 500).json({ error: error.message || 'Erreur suppression envoi transport' });
  } finally {
    db.release();
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

router._private = {
  resolveCarrierSettingPatch,
  deletionDecision,
  validateGridPayload,
  validateChainPayload,
  validateLogisticsServicePayload,
};

module.exports = router;
