const transportPurchaseFlow = require('./transportPurchaseFlowService');

function expose(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeKey(value) {
  const text = clean(value);
  return text ? text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() : '';
}

function isPreparationLogisticsService(service = {}) {
  const label = normalizeKey(service.label);
  return /\bprepa\b/.test(label) || /\bpreparation\b/.test(label);
}

function hasOwn(body = {}, field) {
  return Object.prototype.hasOwnProperty.call(body, field);
}

function isoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = clean(value);
  if (!text) return new Date().toISOString().slice(0, 10);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) throw expose(400, 'Date invalide');
  return match[1];
}

function num(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed)) throw expose(400, 'Valeur numerique invalide');
  return parsed;
}

function positive(value, fallback = 0) {
  return Math.max(num(value, fallback), 0);
}

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function selectBracket(brackets, weightKg) {
  const weight = positive(weightKg, 0);
  const found = (brackets || []).find((bracket) => (
    weight >= Number(bracket.min_weight_kg || 0)
    && (bracket.max_weight_kg === null || bracket.max_weight_kg === undefined || weight <= Number(bracket.max_weight_kg))
  ));
  if (!found) throw expose(400, `Aucune tranche transport pour ${weight} kg`);
  return found;
}

function calculateBracketAmount(bracket, weightKg) {
  const mode = clean(bracket.pricing_mode);
  const amount = positive(bracket.amount_ht, 0);
  if (mode === 'fixed') return amount;
  if (mode === 'per_tonne') return positive(weightKg, 0) * amount / 1000;
  throw expose(400, 'Mode de tranche transport invalide');
}

function fuelRateForDate(rates, date) {
  const day = isoDate(date);
  return (rates || [])
    .filter((rate) => isoDate(rate.effective_from) <= day && (!rate.effective_to || isoDate(rate.effective_to) >= day))
    .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0] || null;
}

function calculateLeg({ leg, grid, brackets, fuelRates, date, weightKg, adminFeeHt = 0 }) {
  const bracket = selectBracket(brackets, weightKg);
  const baseAmount = calculateBracketAmount(bracket, weightKg);
  const fuel = fuelRateForDate(fuelRates, date);
  const fuelPercent = positive(fuel?.surcharge_percent, 0);
  const fuelAmount = baseAmount * fuelPercent / 100;
  const legAdminFee = positive(leg?.specific_admin_fee_ht, 0);
  const total = money(baseAmount + fuelAmount + legAdminFee);
  return {
    leg_id: leg?.id || null,
    carrier_id: leg?.carrier_id || grid?.carrier_id || null,
    grid_id: grid?.id || leg?.grid_id || null,
    grid_name: grid?.name || null,
    origin_label: leg?.origin_label || grid?.origin_label || null,
    destination_label: leg?.destination_label || grid?.destination_label || null,
    weight_kg: positive(weightKg, 0),
    bracket_id: bracket.id || null,
    bracket_min_weight_kg: Number(bracket.min_weight_kg || 0),
    bracket_max_weight_kg: bracket.max_weight_kg === null || bracket.max_weight_kg === undefined ? null : Number(bracket.max_weight_kg),
    pricing_mode: bracket.pricing_mode,
    rate_amount_ht: Number(bracket.amount_ht || 0),
    transport_amount_ht: money(baseAmount),
    fuel_surcharge_percent: fuelPercent,
    fuel_amount_ht: money(fuelAmount),
    admin_fee_ht: money(legAdminFee),
    total_ht: total,
  };
}

function calculateLogisticsService(service, weightKg) {
  const mode = clean(service.calculation_mode);
  const amount = positive(service.amount_ht, 0);
  let total;
  if (mode === 'per_kg') total = positive(weightKg, 0) * amount;
  else if (mode === 'per_tonne') total = positive(weightKg, 0) * amount / 1000;
  else if (mode === 'fixed') total = amount;
  else throw expose(400, 'Mode de prestation invalide');
  return {
    service_id: service.id || null,
    label: service.label,
    calculation_mode: mode,
    amount_ht: amount,
    weight_kg: positive(weightKg, 0),
    total_ht: money(total),
  };
}

function logisticsServicePerKg(service) {
  const mode = clean(service.calculation_mode);
  const amount = positive(service.amount_ht, 0);
  if (mode === 'per_kg') return amount;
  if (mode === 'per_tonne') return amount / 1000;
  return 0;
}

function calculateChainSnapshot({ chain, legs, services = [], date, weightKg, adminFeeByCarrier = {} }) {
  const calculatedLegs = (legs || []).map((leg) => calculateLeg({
    leg,
    grid: leg.grid,
    brackets: leg.brackets || [],
    fuelRates: leg.fuel_rates || [],
    date,
    weightKg,
  }));
  const calculatedServices = (services || []).map((service) => calculateLogisticsService(service, weightKg));
  const carriersWithTransport = new Set(calculatedLegs.map((leg) => leg.carrier_id).filter(Boolean));
  const adminFees = Object.entries(adminFeeByCarrier || {})
    .filter(([carrierId, amount]) => carriersWithTransport.has(carrierId) && positive(amount, 0) > 0)
    .map(([carrierId, amount]) => ({
      carrier_id: carrierId,
      amount_ht: money(amount),
      scope: 'shipment_carrier',
    }));
  const transportAmount = calculatedLegs.reduce((sum, leg) => sum + Number(leg.transport_amount_ht || 0), 0);
  const fuelAmount = calculatedLegs.reduce((sum, leg) => sum + Number(leg.fuel_amount_ht || 0), 0);
  const adminFee = calculatedLegs.reduce((sum, leg) => sum + Number(leg.admin_fee_ht || 0), 0)
    + adminFees.reduce((sum, fee) => sum + Number(fee.amount_ht || 0), 0);
  const servicesAmount = calculatedServices.reduce((sum, service) => sum + Number(service.total_ht || 0), 0);
  return {
    chain_id: chain?.id || null,
    chain_name: chain?.name || null,
    date: isoDate(date),
    weight_kg: positive(weightKg, 0),
    legs: calculatedLegs,
    admin_fees: adminFees,
    services: calculatedServices,
    transport_amount_ht: money(transportAmount),
    fuel_amount_ht: money(fuelAmount),
    admin_fee_ht: money(adminFee),
    services_amount_ht: money(servicesAmount),
    total_ht: money(transportAmount + fuelAmount + adminFee + servicesAmount),
  };
}

function estimateLegPerKg({ bracket, fuelPercent = 0 }) {
  if (!bracket) return 0;
  if (bracket.pricing_mode === 'per_tonne') return (positive(bracket.amount_ht, 0) / 1000) * (1 + positive(fuelPercent, 0) / 100);
  return 0;
}

async function listCarriers(db, storeId) {
  const result = await db.query(
    `SELECT id, code, name, email, transport_operations_email, supplier_type, is_carrier
     FROM suppliers
     WHERE store_id = $1
       AND COALESCE(status, 'active') <> 'inactive'
       AND (is_carrier = true OR supplier_type = 'transporteur')
     ORDER BY name ASC`,
    [storeId]
  );
  return { results: result.rows };
}

async function getCarrierAdminFee(db, storeId, carrierId) {
  const result = await db.query(
    `SELECT COALESCE(admin_fee_ht, 0) AS admin_fee_ht
     FROM supplier_transport_settings
     WHERE store_id = $1 AND supplier_id = $2
     LIMIT 1`,
    [storeId, carrierId]
  );
  return Number(result.rows[0]?.admin_fee_ht || 0);
}

async function listChains(db, storeId, input = {}) {
  const params = [storeId];
  const where = ['tc.store_id = $1'];
  if (clean(input.direction) && clean(input.direction) !== 'all') {
    params.push(clean(input.direction));
    where.push(`tc.direction IN ($${params.length}, 'both')`);
  }
  const result = await db.query(
    `SELECT tc.*,
      COUNT(tcl.id)::int AS leg_count,
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', tcl.id,
        'leg_order', tcl.leg_order,
        'carrier_id', tcl.carrier_id,
        'carrier_name', s.name,
        'grid_id', tcl.grid_id,
        'grid_name', trg.name,
        'origin_label', COALESCE(tcl.origin_label, trg.origin_label),
        'destination_label', COALESCE(tcl.destination_label, trg.destination_label)
      ) ORDER BY tcl.leg_order) FILTER (WHERE tcl.id IS NOT NULL), '[]'::jsonb) AS legs
     FROM transport_chains tc
     LEFT JOIN transport_chain_legs tcl ON tcl.chain_id = tc.id AND tcl.store_id = tc.store_id
     LEFT JOIN suppliers s ON s.id = tcl.carrier_id AND s.store_id = tc.store_id
     LEFT JOIN transport_rate_grids trg ON trg.id = tcl.grid_id AND trg.store_id = tc.store_id
     WHERE ${where.join(' AND ')}
     GROUP BY tc.id
     ORDER BY tc.is_active DESC, tc.name ASC`,
    params
  );
  return { results: result.rows };
}

async function getChainForCalculation(db, storeId, chainId, date) {
  const chain = (await db.query('SELECT * FROM transport_chains WHERE id = $1 AND store_id = $2 LIMIT 1', [chainId, storeId])).rows[0];
  if (!chain) throw expose(404, 'Circuit transport introuvable');
  const legsResult = await db.query(
    `SELECT tcl.*, trg.name AS grid_name, trg.origin_label AS grid_origin_label,
            trg.destination_label AS grid_destination_label, trg.carrier_id AS grid_carrier_id
     FROM transport_chain_legs tcl
     JOIN transport_rate_grids trg ON trg.id = tcl.grid_id AND trg.store_id = tcl.store_id
     WHERE tcl.store_id = $1 AND tcl.chain_id = $2
       AND trg.valid_from <= $3::date
       AND (trg.valid_to IS NULL OR trg.valid_to >= $3::date)
     ORDER BY tcl.leg_order ASC`,
    [storeId, chainId, isoDate(date)]
  );
  const legs = [];
  for (const leg of legsResult.rows) {
    const brackets = await db.query(
      `SELECT * FROM transport_rate_brackets
       WHERE store_id = $1 AND grid_id = $2
       ORDER BY display_order ASC, min_weight_kg ASC`,
      [storeId, leg.grid_id]
    );
    const fuelRates = await db.query(
      `SELECT * FROM transport_fuel_surcharges
       WHERE store_id = $1 AND carrier_id = $2
       ORDER BY effective_from DESC`,
      [storeId, leg.carrier_id]
    );
    legs.push({
      ...leg,
      origin_label: leg.origin_label || leg.grid_origin_label,
      destination_label: leg.destination_label || leg.grid_destination_label,
      grid: {
        id: leg.grid_id,
        carrier_id: leg.grid_carrier_id,
        name: leg.grid_name,
        origin_label: leg.grid_origin_label,
        destination_label: leg.grid_destination_label,
      },
      brackets: brackets.rows,
      fuel_rates: fuelRates.rows,
    });
  }
  return { chain, legs };
}

async function estimateChainPerKg(db, storeId, chainId, date) {
  if (!clean(chainId)) return { total_per_kg_ht: 0, legs: [] };
  const { chain, legs } = await getChainForCalculation(db, storeId, chainId, date);
  const estimatedLegs = [];
  for (const leg of legs) {
    const bracket = (leg.brackets || []).find((item) => Number(item.min_weight_kg || 0) <= 41 && (item.max_weight_kg === null || Number(item.max_weight_kg) >= 200))
      || selectBracket(leg.brackets, 41);
    const fuel = fuelRateForDate(leg.fuel_rates, date);
    const perKg = estimateLegPerKg({ bracket, fuelPercent: fuel?.surcharge_percent || 0 });
    estimatedLegs.push({
      leg_id: leg.id,
      grid_id: leg.grid_id,
      grid_name: leg.grid_name,
      carrier_id: leg.carrier_id,
      bracket_id: bracket.id,
      pricing_mode: bracket.pricing_mode,
      rate_amount_ht: Number(bracket.amount_ht || 0),
      fuel_surcharge_percent: Number(fuel?.surcharge_percent || 0),
      amount_per_kg_ht: perKg,
    });
  }
  return {
    chain_id: chain.id,
    chain_name: chain.name,
    date: isoDate(date),
    basis: 'default_41_200_kg',
    total_per_kg_ht: estimatedLegs.reduce((sum, leg) => sum + leg.amount_per_kg_ht, 0),
    legs: estimatedLegs,
  };
}

async function estimateSupplierPurchaseTransport(db, storeId, supplierId, date) {
  const setting = (await db.query(
    `SELECT * FROM supplier_transport_settings WHERE store_id = $1 AND supplier_id = $2 LIMIT 1`,
    [storeId, supplierId]
  )).rows[0];
  if (!setting || setting.purchase_transport_mode === 'franco') {
    return { amount_per_kg_ht: 0, source: 'franco', setting: setting || null };
  }
  if (setting.purchase_transport_mode !== 'carrier_paid_by_us' || !setting.purchase_transport_chain_id) {
    return { amount_per_kg_ht: 0, source: 'manual_or_missing_chain', setting: setting || null };
  }
  const estimate = await estimateChainPerKg(db, storeId, setting.purchase_transport_chain_id, date);
  return { amount_per_kg_ht: estimate.total_per_kg_ht, source: 'transport_chain', setting, estimate };
}

async function listClientLogisticsServices(db, storeId, clientId, input = {}) {
  const includeInactive = input.include_inactive === true || input.include_inactive === 'true';
  const params = [storeId, clientId];
  const where = ['cls.store_id = $1', 'cls.client_id = $2'];
  if (!includeInactive) where.push('cls.is_active = true', 'ls.is_active = true');
  const result = await db.query(
    `SELECT cls.id AS assignment_id, cls.is_active AS assignment_active,
            cls.provider_supplier_id,
            provider.name AS provider_supplier_name,
            provider.code AS provider_supplier_code,
            ls.*, service_carrier.name AS carrier_name
     FROM client_logistics_services cls
     JOIN logistics_services ls ON ls.id = cls.logistics_service_id AND ls.store_id = cls.store_id
     LEFT JOIN suppliers service_carrier ON service_carrier.id = ls.carrier_id AND service_carrier.store_id = ls.store_id
     LEFT JOIN suppliers provider ON provider.id = cls.provider_supplier_id AND provider.store_id = cls.store_id
     WHERE ${where.join(' AND ')}
     ORDER BY ls.label ASC`,
    params
  );
  return {
    results: result.rows.map((row) => ({
      ...row,
      id: row.id,
      service_id: row.id,
      assignment_id: row.assignment_id,
      active: row.assignment_active,
      actif: row.assignment_active,
      prestataire_id: row.provider_supplier_id,
      prestataire_name: row.provider_supplier_name,
      provider_missing: row.assignment_active === true && isPreparationLogisticsService(row) && !row.provider_supplier_id,
    })),
  };
}

async function assertLogisticsProvider(db, storeId, supplierId) {
  const result = await db.query(
    `SELECT id FROM suppliers
     WHERE id = $1
       AND store_id = $2
       AND COALESCE(status, 'active') <> 'inactive'
       AND (is_carrier = true OR supplier_type = 'transporteur')
     LIMIT 1`,
    [supplierId, storeId]
  );
  if (!result.rows[0]) throw expose(400, 'Prestataire logistique introuvable ou inactif');
}

function normalizeClientLogisticsAssignments(input = []) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => {
    if (typeof item === 'string') return { service_id: clean(item), provider_supplier_id: null };
    return {
      service_id: clean(item.service_id || item.logistics_service_id || item.id),
      provider_supplier_id: clean(item.provider_supplier_id || item.prestataire_id || item.carrier_id),
    };
  }).filter((item) => item.service_id);
}

async function replaceClientLogisticsServices(db, storeId, clientId, serviceAssignments = [], context = {}) {
  const assignments = normalizeClientLogisticsAssignments(serviceAssignments);
  await db.query(
    `UPDATE client_logistics_services
     SET is_active = false, provider_supplier_id = NULL, updated_by = $3, updated_at = now()
     WHERE store_id = $1 AND client_id = $2`,
    [storeId, clientId, context.user_id || null]
  );
  for (const assignment of assignments) {
    const service = await db.query(
      `SELECT id, label FROM logistics_services WHERE id = $1 AND store_id = $2 LIMIT 1`,
      [assignment.service_id, storeId]
    );
    if (!service.rows[0]) throw expose(404, 'Prestation logistique introuvable');
    if (assignment.provider_supplier_id) await assertLogisticsProvider(db, storeId, assignment.provider_supplier_id);
    if (isPreparationLogisticsService(service.rows[0]) && !assignment.provider_supplier_id) {
      throw expose(400, 'Prestataire obligatoire pour une prestation de preparation');
    }
    await db.query(
      `INSERT INTO client_logistics_services (
        store_id, client_id, logistics_service_id, provider_supplier_id, is_active, created_by, updated_by
      ) VALUES ($1,$2,$3,$4,true,$5,$5)
      ON CONFLICT (store_id, client_id, logistics_service_id)
      DO UPDATE SET is_active = true,
        provider_supplier_id = EXCLUDED.provider_supplier_id,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()`,
      [storeId, clientId, assignment.service_id, assignment.provider_supplier_id, context.user_id || null]
    );
  }
  return listClientLogisticsServices(db, storeId, clientId, { include_inactive: false });
}

async function activeClientLogisticsServicesForDate(db, storeId, clientId, date) {
  const result = await db.query(
    `SELECT ls.*, cls.provider_supplier_id,
        provider.name AS provider_supplier_name,
        provider.code AS provider_supplier_code
     FROM client_logistics_services cls
     JOIN logistics_services ls ON ls.id = cls.logistics_service_id AND ls.store_id = cls.store_id
     LEFT JOIN suppliers provider ON provider.id = cls.provider_supplier_id AND provider.store_id = cls.store_id
     WHERE cls.store_id = $1
       AND cls.client_id = $2
       AND cls.is_active = true
       AND ls.is_active = true
       AND ls.effective_from <= $3::date
       AND (ls.effective_to IS NULL OR ls.effective_to >= $3::date)
     ORDER BY ls.label ASC`,
    [storeId, clientId, isoDate(date)]
  );
  return result.rows;
}

async function estimateClientSaleLogistics(db, storeId, clientId, date) {
  const client = (await db.query(
    `SELECT id, sale_transport_mode, sale_transport_chain_id
     FROM clients
     WHERE id = $1 AND store_id = $2 AND COALESCE(status, 'active') <> 'inactive'
     LIMIT 1`,
    [clientId, storeId]
  )).rows[0];
  if (!client) throw expose(404, 'Client introuvable pour ce magasin');
  let transportEstimate = { total_per_kg_ht: 0, legs: [], source: 'none' };
  if (client.sale_transport_mode === 'carrier_paid_by_us' && client.sale_transport_chain_id) {
    const estimate = await estimateChainPerKg(db, storeId, client.sale_transport_chain_id, date);
    transportEstimate = { ...estimate, source: 'transport_chain' };
  } else if (client.sale_transport_mode === 'franco' || client.sale_transport_mode === 'none') {
    transportEstimate = { total_per_kg_ht: 0, legs: [], source: 'franco_or_none' };
  } else {
    transportEstimate = { total_per_kg_ht: 0, legs: [], source: 'manual_or_missing_chain' };
  }
  const services = await activeClientLogisticsServicesForDate(db, storeId, clientId, date);
  const serviceEstimates = services.map((service) => ({
    service_id: service.id,
    label: service.label,
    calculation_mode: service.calculation_mode,
    amount_ht: Number(service.amount_ht || 0),
    amount_per_kg_ht: logisticsServicePerKg(service),
  }));
  const servicesPerKg = serviceEstimates.reduce((sum, service) => sum + service.amount_per_kg_ht, 0);
  return {
    client_id: client.id,
    date: isoDate(date),
    transport_mode: client.sale_transport_mode,
    transport_per_kg_ht: transportEstimate.total_per_kg_ht || 0,
    services_per_kg_ht: servicesPerKg,
    total_per_kg_ht: (transportEstimate.total_per_kg_ht || 0) + servicesPerKg,
    transport: transportEstimate,
    services: serviceEstimates,
  };
}

async function applyPurchaseTransportEstimatesToPricingSession(db, storeId, sessionId, context = {}) {
  const session = (await db.query(
    `SELECT * FROM pricing_sessions WHERE id = $1 AND store_id = $2 FOR UPDATE`,
    [sessionId, storeId]
  )).rows[0];
  if (!session) throw expose(404, 'Session tarification introuvable');
  if (session.status !== 'draft') throw expose(409, 'Une session publiee ne peut pas etre modifiee');
  const lines = await db.query(
    `SELECT id, supplier_id FROM pricing_lines
     WHERE store_id = $1 AND pricing_session_id = $2 AND supplier_id IS NOT NULL
       AND COALESCE(transport_cost_forced, false) = false
     ORDER BY display_order ASC`,
    [storeId, sessionId]
  );
  let updated = 0;
  for (const line of lines.rows) {
    const estimate = await estimateSupplierPurchaseTransport(db, storeId, line.supplier_id, session.pricing_date);
    if (estimate.source === 'manual_or_missing_chain') continue;
    await db.query(
      `UPDATE pricing_lines
       SET transport_cost_ht = $3, transport_cost_source = $4, updated_by = $5, updated_at = now()
       WHERE id = $1 AND store_id = $2`,
      [line.id, storeId, money(estimate.amount_per_kg_ht), estimate.source, context.user_id || null]
    );
    updated += 1;
  }
  return { ok: true, updated_line_count: updated };
}

async function listDayShipments(db, storeId, input = {}) {
  const date = isoDate(input.date || input.shipment_date);
  const result = await db.query(
    `SELECT ts.*, s.name AS carrier_name, tc.name AS chain_name, tdn.reference_number AS blt_reference
     FROM transport_shipments ts
     LEFT JOIN suppliers s ON s.id = ts.carrier_id AND s.store_id = ts.store_id
     LEFT JOIN transport_chains tc ON tc.id = ts.chain_id AND tc.store_id = ts.store_id
     LEFT JOIN transport_delivery_notes tdn ON tdn.shipment_id = ts.id AND tdn.store_id = ts.store_id
     WHERE ts.store_id = $1 AND ts.shipment_date = $2::date
     ORDER BY ts.created_at DESC`,
    [storeId, date]
  );
  return { results: result.rows };
}

async function createShipment(db, storeId, input = {}, context = {}) {
  const date = isoDate(input.shipment_date || input.date);
  const direction = clean(input.direction) || 'sale';
  if (!['purchase', 'sale'].includes(direction)) throw expose(400, 'Sens transport invalide');
  const chainId = clean(input.chain_id);
  const weightKg = positive(input.total_weight_kg ?? input.weight_kg, 0);
  const idempotencyKey = clean(input.idempotency_key || input.request_id);
  const sourceType = clean(input.source_type);
  const sourceId = clean(input.source_id);
  const sourceReference = clean(input.source_reference);
  if (!chainId) throw expose(400, 'Circuit transport obligatoire');
  if (weightKg <= 0) throw expose(400, 'Poids transport obligatoire');
  if (idempotencyKey) {
    const existing = await db.query(
      'SELECT * FROM transport_shipments WHERE store_id = $1 AND idempotency_key = $2 LIMIT 1',
      [storeId, idempotencyKey]
    );
    if (existing.rows.length) return existing.rows[0];
  }
  if (sourceType && sourceId) {
    const existing = await findActiveShipmentBySource(db, storeId, sourceType, sourceId);
    if (existing) return existing;
  }
  const { chain, legs } = await getChainForCalculation(db, storeId, chainId, date);
  const carrierId = clean(input.carrier_id) || legs[0]?.carrier_id || null;
  const adminFeeByCarrier = {};
  for (const leg of legs) adminFeeByCarrier[leg.carrier_id] = await getCarrierAdminFee(db, storeId, leg.carrier_id);
  const snapshot = calculateChainSnapshot({ chain, legs, date, weightKg, adminFeeByCarrier });
  let result;
  try {
    result = await db.query(
      `INSERT INTO transport_shipments (
        store_id, shipment_date, direction, carrier_id, chain_id, origin_label, destination_label,
        total_weight_kg, expected_total_ht, calculation_snapshot, notes,
        idempotency_key, source_type, source_id, source_reference, created_by, updated_by
      ) VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14::uuid,$15,$16,$16)
      RETURNING *`,
      [
        storeId, date, direction, carrierId, chainId,
        clean(input.origin_label) || chain.origin_label,
        clean(input.destination_label) || chain.destination_label,
        weightKg, snapshot.total_ht, JSON.stringify(snapshot), clean(input.notes),
        idempotencyKey, sourceType, sourceId, sourceReference, context.user_id || null,
      ]
    );
  } catch (error) {
    if (idempotencyKey && error.code === '23505' && String(error.constraint || '').includes('ux_transport_shipments_idempotency_key')) {
      const existing = await db.query(
        'SELECT * FROM transport_shipments WHERE store_id = $1 AND idempotency_key = $2 LIMIT 1',
        [storeId, idempotencyKey]
      );
      if (existing.rows.length) return existing.rows[0];
    }
    if (sourceType && sourceId && error.code === '23505' && String(error.constraint || '').includes('ux_transport_shipments_source_active')) {
      const existing = await findActiveShipmentBySource(db, storeId, sourceType, sourceId);
      if (existing) return existing;
    }
    throw error;
  }
  return result.rows[0];
}

async function updateDraftShipment(db, storeId, shipmentId, input = {}, context = {}) {
  const shipment = (await db.query(
    `SELECT * FROM transport_shipments WHERE id = $1 AND store_id = $2 FOR UPDATE`,
    [shipmentId, storeId]
  )).rows[0];
  if (!shipment) throw expose(404, 'Envoi transport introuvable');
  if (shipment.status !== 'draft') throw expose(409, 'Envoi transport verrouille apres generation BL transport');
  const deliveryNote = (await db.query(
    `SELECT id FROM transport_delivery_notes WHERE shipment_id = $1 AND store_id = $2 LIMIT 1`,
    [shipmentId, storeId]
  )).rows[0];
  if (deliveryNote) throw expose(409, 'Envoi transport verrouille apres generation BL transport');
  const date = isoDate(input.shipment_date || input.date || shipment.shipment_date);
  const direction = clean(input.direction) || shipment.direction || 'sale';
  if (!['purchase', 'sale'].includes(direction)) throw expose(400, 'Sens transport invalide');
  const chainId = clean(input.chain_id) || shipment.chain_id;
  const weightKg = positive(input.total_weight_kg ?? input.weight_kg ?? shipment.total_weight_kg, 0);
  if (!chainId) throw expose(400, 'Circuit transport obligatoire');
  if (weightKg <= 0) throw expose(400, 'Poids transport obligatoire');
  const { chain, legs } = await getChainForCalculation(db, storeId, chainId, date);
  const carrierId = clean(input.carrier_id) || legs[0]?.carrier_id || shipment.carrier_id || null;
  const adminFeeByCarrier = {};
  for (const leg of legs) adminFeeByCarrier[leg.carrier_id] = await getCarrierAdminFee(db, storeId, leg.carrier_id);
  const snapshot = calculateChainSnapshot({ chain, legs, date, weightKg, adminFeeByCarrier });
  const result = await db.query(
    `UPDATE transport_shipments
     SET shipment_date = $3::date, direction = $4, carrier_id = $5, chain_id = $6,
         origin_label = $7, destination_label = $8, total_weight_kg = $9,
         expected_total_ht = $10, calculation_snapshot = $11::jsonb,
         notes = $12,
         source_type = CASE WHEN $13::text IS NULL THEN source_type ELSE $13::text END,
         source_id = CASE WHEN $14::uuid IS NULL THEN source_id ELSE $14::uuid END,
         source_reference = CASE WHEN $15::text IS NULL THEN source_reference ELSE $15::text END,
         updated_by = $16, updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING *`,
    [
      shipment.id, storeId, date, direction, carrierId, chainId,
      clean(input.origin_label) || chain.origin_label,
      clean(input.destination_label) || chain.destination_label,
      weightKg, snapshot.total_ht, JSON.stringify(snapshot),
      hasOwn(input, 'notes') ? clean(input.notes) : clean(shipment.notes),
      clean(input.source_type),
      clean(input.source_id),
      clean(input.source_reference),
      context.user_id || null,
    ]
  );
  return result.rows[0];
}

async function findActiveShipmentBySource(db, storeId, sourceType, sourceId) {
  if (!clean(sourceType) || !clean(sourceId)) return null;
  const result = await db.query(
    `SELECT *
     FROM transport_shipments
     WHERE store_id = $1
       AND source_type = $2
       AND source_id = $3::uuid
       AND COALESCE(status, 'draft') <> 'cancelled'
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE`,
    [storeId, clean(sourceType), clean(sourceId)]
  );
  return result.rows[0] || null;
}

async function upsertDraftShipmentFromSource(db, storeId, input = {}, context = {}) {
  const existing = await findActiveShipmentBySource(db, storeId, input.source_type, input.source_id);
  if (existing) {
    if (existing.status !== 'draft') return { ...existing, skipped_update: true, reason: 'locked_after_blt' };
    return updateDraftShipment(db, storeId, existing.id, input, context);
  }
  return createShipment(db, storeId, input, context);
}

async function deleteDraftShipment(db, storeId, shipmentId, context = {}) {
  const shipment = (await db.query(
    `SELECT * FROM transport_shipments WHERE id = $1 AND store_id = $2 FOR UPDATE`,
    [shipmentId, storeId]
  )).rows[0];
  if (!shipment) throw expose(404, 'Envoi transport introuvable');
  const deliveryNote = (await db.query(
    `SELECT id FROM transport_delivery_notes WHERE shipment_id = $1 AND store_id = $2 LIMIT 1`,
    [shipmentId, storeId]
  )).rows[0];
  if (deliveryNote || shipment.status === 'blt_generated') {
    await db.query(
      `UPDATE transport_shipments
       SET status = 'cancelled', updated_by = $3, updated_at = now()
       WHERE id = $1 AND store_id = $2`,
      [shipment.id, storeId, context.user_id || null]
    );
    return { deleted: false, cancelled: true };
  }
  await db.query('DELETE FROM transport_shipments WHERE id = $1 AND store_id = $2', [shipment.id, storeId]);
  return { deleted: true, cancelled: false };
}

async function nextBltReference(db, storeId, date) {
  const year = isoDate(date).slice(0, 4);
  const result = await db.query(
    `SELECT COUNT(*)::int + 1 AS n
     FROM transport_delivery_notes
     WHERE store_id = $1 AND reference_number LIKE $2`,
    [storeId, `BLT-${year}-%`]
  );
  return `BLT-${year}-${String(result.rows[0].n).padStart(5, '0')}`;
}

async function generateTransportDeliveryNote(db, storeId, input = {}, context = {}) {
  const shipmentId = clean(input.shipment_id);
  const shipment = (await db.query(
    `SELECT * FROM transport_shipments WHERE id = $1 AND store_id = $2 FOR UPDATE`,
    [shipmentId, storeId]
  )).rows[0];
  if (!shipment) throw expose(404, 'Envoi transport introuvable');
  const existing = (await db.query(
    `SELECT * FROM transport_delivery_notes WHERE shipment_id = $1 AND store_id = $2 LIMIT 1`,
    [shipmentId, storeId]
  )).rows[0];
  if (existing) {
    const purchaseLink = await transportPurchaseFlow.upsertTransportPurchase(db, storeId, existing.id, context);
    return {
      existing: true,
      delivery_note: {
        ...existing,
        purchase_id: purchaseLink.purchase_id,
        real_transport_cost_per_kg_ht: purchaseLink.unit_transport_cost_ht,
      },
      transport_purchase: purchaseLink,
    };
  }
  const snapshot = shipment.calculation_snapshot || {};
  const reference = clean(input.reference_number) || await nextBltReference(db, storeId, shipment.shipment_date);
  const result = await db.query(
    `INSERT INTO transport_delivery_notes (
      store_id, reference_number, shipment_id, carrier_id, document_date, direction,
      total_weight_kg, transport_amount_ht, fuel_amount_ht, admin_fee_ht, services_amount_ht,
      expected_total_ht, calculation_snapshot, created_by, updated_by
    ) VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$14)
    RETURNING *`,
    [
      storeId, reference, shipment.id, shipment.carrier_id, shipment.shipment_date, shipment.direction,
      shipment.total_weight_kg, snapshot.transport_amount_ht || 0, snapshot.fuel_amount_ht || 0,
      snapshot.admin_fee_ht || 0, snapshot.services_amount_ht || 0, snapshot.total_ht || shipment.expected_total_ht || 0,
      JSON.stringify(snapshot), context.user_id || null,
    ]
  );
  await db.query(
    `UPDATE transport_shipments SET status = 'blt_generated', updated_by = $3, updated_at = now()
     WHERE id = $1 AND store_id = $2`,
    [shipment.id, storeId, context.user_id || null]
  );
  const purchaseLink = await transportPurchaseFlow.upsertTransportPurchase(db, storeId, result.rows[0].id, context);
  const linkedDeliveryNote = {
    ...result.rows[0],
    purchase_id: purchaseLink.purchase_id,
    real_transport_cost_per_kg_ht: purchaseLink.unit_transport_cost_ht,
  };
  return { existing: false, delivery_note: linkedDeliveryNote, transport_purchase: purchaseLink };
}

module.exports = {
  clean,
  isoDate,
  normalizeKey,
  isPreparationLogisticsService,
  money,
  selectBracket,
  calculateBracketAmount,
  fuelRateForDate,
  calculateLeg,
  calculateLogisticsService,
  logisticsServicePerKg,
  calculateChainSnapshot,
  estimateChainPerKg,
  estimateSupplierPurchaseTransport,
  estimateClientSaleLogistics,
  listClientLogisticsServices,
  replaceClientLogisticsServices,
  normalizeClientLogisticsAssignments,
  assertLogisticsProvider,
  applyPurchaseTransportEstimatesToPricingSession,
  listCarriers,
  listChains,
  listDayShipments,
  createShipment,
  updateDraftShipment,
  findActiveShipmentBySource,
  upsertDraftShipmentFromSource,
  deleteDraftShipment,
  generateTransportDeliveryNote,
};
