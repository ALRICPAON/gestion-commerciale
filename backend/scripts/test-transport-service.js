const assert = require('assert');
const fs = require('fs');
const path = require('path');
const transport = require('../services/transportService');
const transportRoutes = require('../routes/transport');

const {
  resolveCarrierSettingPatch,
  deletionDecision,
  validateGridPayload,
  validateChainPayload,
  validateLogisticsServicePayload,
} = transportRoutes._private;

function approx(actual, expected, precision = 0.000001) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= precision, `${actual} !== ${expected}`);
}

const fuelRates = [{ effective_from: '2026-09-01', surcharge_percent: 3.5 }];
const oldFuelRates = [
  { effective_from: '2026-09-01', surcharge_percent: 3.5 },
  { effective_from: '2026-01-01', effective_to: '2026-08-31', surcharge_percent: 2 },
];
const brackets = [
  { id: 'a', min_weight_kg: 0, max_weight_kg: 40, pricing_mode: 'fixed', amount_ht: 9.05 },
  { id: 'b', min_weight_kg: 41, max_weight_kg: 200, pricing_mode: 'per_tonne', amount_ht: 225.64 },
  { id: 'c', min_weight_kg: 201, max_weight_kg: 500, pricing_mode: 'per_tonne', amount_ht: 197.66 },
];

const fixed = transport.calculateLeg({
  leg: { id: 'l1', carrier_id: 'delanchy' },
  grid: { id: 'g1', name: '44 -> FT44' },
  brackets,
  fuelRates,
  date: '2026-09-11',
  weightKg: 25,
  adminFeeHt: 5.92,
});
approx(fixed.transport_amount_ht, 9.05);
approx(fixed.fuel_amount_ht, 0.32);
approx(fixed.admin_fee_ht, 0);
approx(fixed.total_ht, 9.37);

const tonne = transport.calculateLeg({
  leg: { id: 'l2', carrier_id: 'delanchy' },
  grid: { id: 'g2', name: '44 -> Les Sables' },
  brackets,
  fuelRates,
  date: '2026-09-11',
  weightKg: 327.4,
  adminFeeHt: 5.92,
});
approx(tonne.transport_amount_ht, 64.71);
approx(tonne.fuel_amount_ht, 2.26);
approx(tonne.admin_fee_ht, 0);
approx(tonne.total_ht, 66.98);
assert.strictEqual(tonne.bracket_id, 'c');

const oldFuel = transport.fuelRateForDate(oldFuelRates, '2026-08-20');
approx(oldFuel.surcharge_percent, 2);

const service = transport.calculateLogisticsService({
  id: 'prep',
  label: 'Preparation commandes',
  calculation_mode: 'per_tonne',
  amount_ht: 180,
}, 327.4);
approx(service.total_ht, 58.93);

const snapshot = transport.calculateChainSnapshot({
  chain: { id: 'chain1', name: 'Copromer -> Les Sables' },
  date: '2026-09-11',
  weightKg: 327.4,
  adminFeeByCarrier: { delanchy: 5.92 },
  legs: [
    { id: 'l1', carrier_id: 'delanchy', grid: { id: 'g1', name: 'Copromer -> FT44' }, brackets, fuel_rates: fuelRates },
    { id: 'l2', carrier_id: 'delanchy', grid: { id: 'g2', name: '44 -> Les Sables' }, brackets, fuel_rates: fuelRates },
  ],
  services: [{ id: 'prep', label: 'Preparation commandes', calculation_mode: 'per_tonne', amount_ht: 180 }],
});
assert.strictEqual(snapshot.legs.length, 2);
assert.strictEqual(snapshot.admin_fees.length, 1);
approx(snapshot.admin_fee_ht, 5.92);
approx(snapshot.services_amount_ht, 58.93);
approx(snapshot.total_ht, 198.79);

const multiCarrierSnapshot = transport.calculateChainSnapshot({
  chain: { id: 'chain2', name: 'Multi carriers' },
  date: '2026-09-11',
  weightKg: 327.4,
  adminFeeByCarrier: { delanchy: 5.92, other: 4 },
  legs: [
    { id: 'l1', carrier_id: 'delanchy', grid: { id: 'g1', name: 'A -> B' }, brackets, fuel_rates: fuelRates },
    { id: 'l2', carrier_id: 'other', grid: { id: 'g2', name: 'B -> C' }, brackets, fuel_rates: [] },
  ],
});
assert.strictEqual(multiCarrierSnapshot.admin_fees.length, 2);
approx(multiCarrierSnapshot.admin_fee_ht, 9.92);

const frozen = JSON.parse(JSON.stringify(snapshot));
brackets[2].amount_ht = 358;
approx(frozen.legs[0].rate_amount_ht, 197.66);
approx(frozen.total_ht, 198.79);

approx(transport.logisticsServicePerKg({ calculation_mode: 'per_tonne', amount_ht: 180 }), 0.18);
approx(transport.logisticsServicePerKg({ calculation_mode: 'per_kg', amount_ht: 0.42 }), 0.42);
approx(transport.logisticsServicePerKg({ calculation_mode: 'fixed', amount_ht: 12 }), 0);

const existingCarrierSetting = {
  purchase_transport_mode: 'carrier_paid_by_us',
  purchase_transport_chain_id: 'chain-purchase',
  admin_fee_ht: 5.92,
  notes: 'achat configure',
};
const adminOnlyCarrierPatch = resolveCarrierSettingPatch(existingCarrierSetting, {
  admin_fee_ht: 7.5,
  notes: 'frais admin maj',
});
assert.deepStrictEqual(adminOnlyCarrierPatch, {
  purchase_transport_mode: 'carrier_paid_by_us',
  purchase_transport_chain_id: 'chain-purchase',
  admin_fee_ht: 7.5,
  notes: 'frais admin maj',
});
const feeOnlyCarrierPatch = resolveCarrierSettingPatch(existingCarrierSetting, { admin_fee_ht: 8 });
assert.strictEqual(feeOnlyCarrierPatch.purchase_transport_mode, 'carrier_paid_by_us');
assert.strictEqual(feeOnlyCarrierPatch.purchase_transport_chain_id, 'chain-purchase');
assert.strictEqual(feeOnlyCarrierPatch.notes, 'achat configure');
assert.strictEqual(feeOnlyCarrierPatch.admin_fee_ht, 8);

assert.deepStrictEqual(deletionDecision({ used: false }, 'deactivate'), { delete_physical: true, fallback: null });
assert.deepStrictEqual(deletionDecision({ used: true }, 'deactivate'), { delete_physical: false, fallback: 'deactivate' });
assert.deepStrictEqual(deletionDecision({ used: true }, 'cancel'), { delete_physical: false, fallback: 'cancel' });

const validGrid = validateGridPayload({
  carrier_id: 'carrier',
  name: 'Grille test',
  valid_from: '2026-09-11',
  brackets: [{ min_weight_kg: 0, max_weight_kg: 100, pricing_mode: 'per_tonne', amount_ht: 180 }],
});
assert.strictEqual(validGrid.brackets.length, 1);
assert.throws(() => validateGridPayload({
  carrier_id: 'carrier',
  name: 'Grille test',
  valid_from: '2026-09-11',
  brackets: [{ min_weight_kg: 200, max_weight_kg: 100, pricing_mode: 'per_tonne', amount_ht: 180 }],
}), /poids maximum/);

const validChain = validateChainPayload({
  name: 'Circuit test',
  direction: 'sale',
  legs: [
    { leg_order: 1, carrier_id: 'carrier', grid_id: 'grid-a' },
    { leg_order: 2, carrier_id: 'carrier', grid_id: 'grid-b' },
  ],
});
assert.strictEqual(validChain.legs.length, 2);
assert.throws(() => validateChainPayload({
  name: 'Circuit test',
  legs: [
    { leg_order: 1, carrier_id: 'carrier', grid_id: 'grid-a' },
    { leg_order: 1, carrier_id: 'carrier', grid_id: 'grid-b' },
  ],
}), /doublon/);

const validService = validateLogisticsServicePayload({
  label: 'Preparation',
  calculation_mode: 'per_tonne',
  amount_ht: 180,
  effective_from: '2026-09-11',
});
assert.strictEqual(validService.calculation_mode, 'per_tonne');
assert.throws(() => validateLogisticsServicePayload({
  label: 'Preparation',
  calculation_mode: 'bad',
  amount_ht: 180,
  effective_from: '2026-09-11',
}), /Mode de prestation/);

function mockDbForClientEstimate({ mode = 'carrier_paid_by_us', services = [] } = {}) {
  return {
    async query(sql, params) {
      if (sql.includes('FROM clients')) {
        return { rows: [{ id: params[0], sale_transport_mode: mode, sale_transport_chain_id: mode === 'carrier_paid_by_us' ? 'chain-sale' : null }] };
      }
      if (sql.includes('FROM transport_chains')) {
        return { rows: [{ id: 'chain-sale', name: '44 -> Les Sables', direction: 'sale' }] };
      }
      if (sql.includes('FROM transport_chain_legs')) {
        return { rows: [{ id: 'leg-sale', chain_id: 'chain-sale', carrier_id: 'delanchy', grid_id: 'grid-sale', grid_name: '44 -> Les Sables', grid_origin_label: '44', grid_destination_label: 'Les Sables' }] };
      }
      if (sql.includes('FROM transport_rate_brackets')) {
        return { rows: [{ id: 'sale-bracket', min_weight_kg: 41, max_weight_kg: 200, pricing_mode: 'per_tonne', amount_ht: 397.02, display_order: 1 }] };
      }
      if (sql.includes('FROM transport_fuel_surcharges')) {
        return { rows: [{ effective_from: '2026-09-01', surcharge_percent: 3.5 }] };
      }
      if (sql.includes('FROM client_logistics_services')) {
        return { rows: services };
      }
      return { rows: [] };
    },
  };
}

function mockDbForDraftShipment({ withDeliveryNote = false } = {}) {
  return {
    updates: [],
    async query(sql, params) {
      if (sql.includes('FROM transport_shipments') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{
            id: params[0],
            shipment_date: '2026-09-11',
            direction: 'sale',
            carrier_id: 'carrier',
            chain_id: 'chain-sale',
            total_weight_kg: 80,
            status: withDeliveryNote ? 'blt_generated' : 'draft',
            notes: 'draft',
          }],
        };
      }
      if (sql.includes('FROM transport_delivery_notes') && sql.includes('shipment_id')) {
        return { rows: withDeliveryNote ? [{ id: 'blt' }] : [] };
      }
      if (sql.includes('FROM transport_chains')) {
        return { rows: [{ id: 'chain-sale', name: 'Circuit', direction: 'sale', origin_label: 'A', destination_label: 'B' }] };
      }
      if (sql.includes('FROM transport_chain_legs')) {
        return { rows: [{ id: 'leg', chain_id: 'chain-sale', carrier_id: 'carrier', grid_id: 'grid', grid_name: 'Grid', grid_origin_label: 'A', grid_destination_label: 'B' }] };
      }
      if (sql.includes('FROM transport_rate_brackets')) {
        return { rows: [{ id: 'bracket', min_weight_kg: 0, max_weight_kg: null, pricing_mode: 'per_tonne', amount_ht: 100, display_order: 1 }] };
      }
      if (sql.includes('FROM transport_fuel_surcharges')) {
        return { rows: [] };
      }
      if (sql.includes('FROM supplier_transport_settings')) {
        return { rows: [{ admin_fee_ht: 2 }] };
      }
      if (sql.includes('UPDATE transport_shipments')) {
        this.updates.push({ sql, params });
        return { rows: [{ id: params[0], total_weight_kg: params[8], expected_total_ht: params[9], status: 'draft' }] };
      }
      if (sql.includes('DELETE FROM transport_shipments')) {
        this.updates.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

function mockDbForCreateShipments() {
  let nextId = 1;
  const byIdempotencyKey = new Map();
  const bySource = new Map();
  const sourceKey = (sourceType, sourceId) => `${sourceType || ''}:${sourceId || ''}`;
  return {
    inserts: [],
    seedShipment(row) {
      const shipment = { status: 'draft', ...row };
      if (shipment.idempotency_key) byIdempotencyKey.set(shipment.idempotency_key, shipment);
      if (shipment.source_type && shipment.source_id && shipment.status !== 'cancelled') {
        bySource.set(sourceKey(shipment.source_type, shipment.source_id), shipment);
      }
      return shipment;
    },
    async query(sql, params) {
      if (sql.includes('FROM transport_shipments') && sql.includes('source_type') && sql.includes('source_id')) {
        const row = bySource.get(sourceKey(params[1], params[2]));
        return { rows: row && row.status !== 'cancelled' ? [row] : [] };
      }
      if (sql.includes('FROM transport_shipments') && sql.includes('idempotency_key')) {
        return { rows: byIdempotencyKey.has(params[1]) ? [byIdempotencyKey.get(params[1])] : [] };
      }
      if (sql.includes('FROM transport_chains')) {
        return { rows: [{ id: 'chain-purchase', name: 'COPROMER -> FT44', direction: 'purchase', origin_label: 'COPROMER', destination_label: 'FT44' }] };
      }
      if (sql.includes('FROM transport_chain_legs')) {
        return { rows: [{ id: 'leg', chain_id: 'chain-purchase', carrier_id: 'carrier', grid_id: 'grid', grid_name: 'COPROMER -> FT44', grid_origin_label: 'COPROMER', grid_destination_label: 'FT44' }] };
      }
      if (sql.includes('FROM transport_rate_brackets')) {
        return { rows: [{ id: 'bracket', min_weight_kg: 0, max_weight_kg: null, pricing_mode: 'per_tonne', amount_ht: 100, display_order: 1 }] };
      }
      if (sql.includes('FROM transport_fuel_surcharges')) {
        return { rows: [] };
      }
      if (sql.includes('FROM supplier_transport_settings')) {
        return { rows: [{ admin_fee_ht: 0 }] };
      }
      if (sql.includes('INSERT INTO transport_shipments')) {
        const row = {
          id: `shipment-${nextId}`,
          store_id: params[0],
          shipment_date: params[1],
          direction: params[2],
          carrier_id: params[3],
          chain_id: params[4],
          origin_label: params[5],
          destination_label: params[6],
          total_weight_kg: params[7],
          expected_total_ht: params[8],
          idempotency_key: params[11],
          source_type: params[12],
          source_id: params[13],
          source_reference: params[14],
          status: 'draft',
        };
        nextId += 1;
        this.inserts.push({ sql, params, row });
        if (row.idempotency_key) byIdempotencyKey.set(row.idempotency_key, row);
        if (row.source_type && row.source_id) bySource.set(sourceKey(row.source_type, row.source_id), row);
        return { rows: [row] };
      }
      return { rows: [] };
    },
  };
}

function mockDbForConcurrentShipmentConflict({ constraint, existing }) {
  const base = mockDbForCreateShipments();
  let firstLookup = true;
  base.seedShipment(existing);
  const originalQuery = base.query.bind(base);
  return {
    ...base,
    async query(sql, params) {
      if (sql.includes('FROM transport_shipments') && (sql.includes('idempotency_key') || sql.includes('source_type'))) {
        if (firstLookup) {
          firstLookup = false;
          return { rows: [] };
        }
        return originalQuery(sql, params);
      }
      if (sql.includes('INSERT INTO transport_shipments')) {
        const error = new Error('duplicate key');
        error.code = '23505';
        error.constraint = constraint;
        throw error;
      }
      return originalQuery(sql, params);
    },
  };
}

function mockDbForClientLogisticsAssignments() {
  const services = new Map([
    ['prep-service', { id: 'prep-service', label: 'PREPA COMMANDE', calculation_mode: 'per_tonne', amount_ht: 180, is_active: true }],
    ['ice-service', { id: 'ice-service', label: 'Glacage', calculation_mode: 'fixed', amount_ht: 12, is_active: true }],
  ]);
  const providers = new Map([
    ['delanchy', { id: 'delanchy', name: 'FRIGO TRANSPORTS 44', code: 'FT44' }],
    ['other-carrier', { id: 'other-carrier', name: 'Autre Transport', code: 'OTH' }],
  ]);
  const assignments = new Map();
  return {
    assignments,
    async query(sql, params) {
      if (sql.startsWith('UPDATE client_logistics_services')) {
        for (const assignment of assignments.values()) {
          if (assignment.store_id === params[0] && assignment.client_id === params[1]) {
            assignment.is_active = false;
            assignment.provider_supplier_id = null;
          }
        }
        return { rows: [] };
      }
      if (sql.includes('SELECT id, label FROM logistics_services')) {
        return { rows: services.has(params[0]) ? [services.get(params[0])] : [] };
      }
      if (sql.includes('SELECT id FROM suppliers')) {
        return { rows: providers.has(params[0]) ? [{ id: params[0] }] : [] };
      }
      if (sql.includes('INSERT INTO client_logistics_services')) {
        const service = services.get(params[2]);
        const assignment = {
          assignment_id: `assignment-${params[2]}`,
          store_id: params[0],
          client_id: params[1],
          logistics_service_id: params[2],
          provider_supplier_id: params[3],
          is_active: true,
          ...service,
        };
        assignments.set(params[2], assignment);
        return { rows: [assignment] };
      }
      if (sql.includes('FROM client_logistics_services')) {
        const includeInactive = !sql.includes('cls.is_active = true');
        return {
          rows: Array.from(assignments.values())
            .filter((assignment) => includeInactive || assignment.is_active)
            .map((assignment) => {
              const provider = providers.get(assignment.provider_supplier_id);
              return {
                ...assignment,
                assignment_active: assignment.is_active,
                provider_supplier_name: provider?.name || null,
                provider_supplier_code: provider?.code || null,
              };
            }),
        };
      }
      return { rows: [] };
    },
  };
}

(async () => {
  assert.strictEqual(transport.isPreparationLogisticsService({ label: 'PREPA COMMANDE' }), true, 'PREPA COMMANDE reconnue');
  assert.strictEqual(transport.isPreparationLogisticsService({ label: 'Préparation commande' }), true, 'preparation accentuee reconnue');
  assert.strictEqual(transport.isPreparationLogisticsService({ label: 'Glacage' }), false, 'autre prestation non preparation');

  const saleEstimate = await transport.estimateClientSaleLogistics(
    mockDbForClientEstimate({ services: [{ id: 'prep', label: 'Preparation', calculation_mode: 'per_tonne', amount_ht: 180 }] }),
    'store',
    'client',
    '2026-09-11'
  );
  approx(saleEstimate.transport_per_kg_ht, 0.4109157);
  approx(saleEstimate.services_per_kg_ht, 0.18);
  approx(saleEstimate.total_per_kg_ht, 0.5909157);

  const francoPrep = await transport.estimateClientSaleLogistics(
    mockDbForClientEstimate({ mode: 'franco', services: [{ id: 'prep', label: 'Preparation', calculation_mode: 'per_tonne', amount_ht: 180 }] }),
    'store',
    'client',
    '2026-09-11'
  );
  approx(francoPrep.transport_per_kg_ht, 0);
  approx(francoPrep.total_per_kg_ht, 0.18);

  const inactiveHistorical = await transport.estimateClientSaleLogistics(
    mockDbForClientEstimate({ services: [] }),
    'store',
    'client',
    '2026-08-15'
  );
  assert.strictEqual(inactiveHistorical.transport.legs[0].grid_id, 'grid-sale');

  const draftDb = mockDbForDraftShipment();
  const updatedShipment = await transport.updateDraftShipment(draftDb, 'store', 'shipment', {
    shipment_date: '2026-09-12',
    chain_id: 'chain-sale',
    direction: 'sale',
    total_weight_kg: 120,
  }, { user_id: 'user' });
  approx(updatedShipment.expected_total_ht, 14);
  assert.strictEqual(draftDb.updates.length, 1);

  const deletedDraft = await transport.deleteDraftShipment(mockDbForDraftShipment(), 'store', 'shipment', { user_id: 'user' });
  assert.deepStrictEqual(deletedDraft, { deleted: true, cancelled: false });

  const cancelledLocked = await transport.deleteDraftShipment(mockDbForDraftShipment({ withDeliveryNote: true }), 'store', 'shipment', { user_id: 'user' });
  assert.deepStrictEqual(cancelledLocked, { deleted: false, cancelled: true });
  await assert.rejects(
    () => transport.updateDraftShipment(mockDbForDraftShipment({ withDeliveryNote: true }), 'store', 'shipment', { total_weight_kg: 120 }, { user_id: 'user' }),
    /verrouille/
  );

  const clientLogisticsDb = mockDbForClientLogisticsAssignments();
  await assert.rejects(
    () => transport.replaceClientLogisticsServices(clientLogisticsDb, 'store', 'client', [{ service_id: 'prep-service' }], { user_id: 'user' }),
    /Prestataire obligatoire/
  );
  const savedAssignments = await transport.replaceClientLogisticsServices(
    clientLogisticsDb,
    'store',
    'client',
    [{ service_id: 'prep-service', provider_supplier_id: 'delanchy' }],
    { user_id: 'user' }
  );
  assert.strictEqual(savedAssignments.results[0].provider_supplier_id, 'delanchy', 'Test H prestataire persiste');
  assert.strictEqual(savedAssignments.results[0].provider_supplier_name, 'FRIGO TRANSPORTS 44', 'Test H nom prestataire retourne');
  const uncheckedAssignments = await transport.replaceClientLogisticsServices(clientLogisticsDb, 'store', 'client', [], { user_id: 'user' });
  assert.strictEqual(uncheckedAssignments.results.length, 0, 'Test I prestation decochee non active');
  assert.strictEqual(clientLogisticsDb.assignments.get('prep-service').provider_supplier_id, null, 'Test I prestataire nettoye au decochage');

  const legacyDb = mockDbForClientLogisticsAssignments();
  legacyDb.assignments.set('prep-service', {
    assignment_id: 'legacy-assignment',
    store_id: 'store',
    client_id: 'client',
    logistics_service_id: 'prep-service',
    id: 'prep-service',
    label: 'PREPA COMMANDE',
    calculation_mode: 'per_tonne',
    amount_ht: 180,
    is_active: true,
    provider_supplier_id: null,
  });
  const legacyAssignments = await transport.listClientLogisticsServices(legacyDb, 'store', 'client');
  assert.strictEqual(legacyAssignments.results[0].provider_missing, true, 'Test C UI signale prestataire manquant');

  const duplicateRouteDb = mockDbForCreateShipments();
  const firstShipment = await transport.createShipment(duplicateRouteDb, 'store', {
    shipment_date: '2026-09-15',
    chain_id: 'chain-purchase',
    direction: 'purchase',
    total_weight_kg: 80,
    idempotency_key: 'request-morning',
  }, { user_id: 'user' });
  const secondShipment = await transport.createShipment(duplicateRouteDb, 'store', {
    shipment_date: '2026-09-15',
    chain_id: 'chain-purchase',
    direction: 'purchase',
    total_weight_kg: 120,
    idempotency_key: 'request-afternoon',
  }, { user_id: 'user' });
  const retriedShipment = await transport.createShipment(duplicateRouteDb, 'store', {
    shipment_date: '2026-09-15',
    chain_id: 'chain-purchase',
    direction: 'purchase',
    total_weight_kg: 120,
    idempotency_key: 'request-afternoon',
  }, { user_id: 'user' });
  assert.notStrictEqual(firstShipment.id, secondShipment.id, 'same route/day must create two distinct shipment ids');
  assert.strictEqual(retriedShipment.id, secondShipment.id, 'same idempotency key must return the existing shipment');
  assert.strictEqual(duplicateRouteDb.inserts.length, 2, 'same business route/day must not be deduplicated by application code');
  assert.strictEqual(duplicateRouteDb.inserts[0].params[7], 80);
  assert.strictEqual(duplicateRouteDb.inserts[1].params[7], 120);

  const sourceDb = mockDbForCreateShipments();
  const sourceShipment = await transport.createShipment(sourceDb, 'store', {
    shipment_date: '2026-09-16',
    chain_id: 'chain-purchase',
    direction: 'purchase',
    total_weight_kg: 90,
    source_type: 'purchase_arrival',
    source_id: '11111111-1111-4111-8111-111111111111',
    source_reference: 'ACH-1',
  }, { user_id: 'user' });
  const sourceRetry = await transport.createShipment(sourceDb, 'store', {
    shipment_date: '2026-09-16',
    chain_id: 'chain-purchase',
    direction: 'purchase',
    total_weight_kg: 120,
    source_type: 'purchase_arrival',
    source_id: '11111111-1111-4111-8111-111111111111',
    source_reference: 'ACH-1',
  }, { user_id: 'user' });
  assert.strictEqual(sourceRetry.id, sourceShipment.id, 'same source_type/source_id must return existing active shipment');
  assert.strictEqual(sourceDb.inserts.length, 1, 'same source must not create a duplicate active shipment');

  const cancelledSourceDb = mockDbForCreateShipments();
  cancelledSourceDb.seedShipment({
    id: 'cancelled-shipment',
    source_type: 'purchase_arrival',
    source_id: '22222222-2222-4222-8222-222222222222',
    status: 'cancelled',
  });
  const replacement = await transport.createShipment(cancelledSourceDb, 'store', {
    shipment_date: '2026-09-16',
    chain_id: 'chain-purchase',
    direction: 'purchase',
    total_weight_kg: 95,
    source_type: 'purchase_arrival',
    source_id: '22222222-2222-4222-8222-222222222222',
    source_reference: 'ACH-2',
  }, { user_id: 'user' });
  assert.notStrictEqual(replacement.id, 'cancelled-shipment', 'same source can create a new shipment after cancellation');
  assert.strictEqual(cancelledSourceDb.inserts.length, 1, 'cancelled source shipment must not block replacement');

  const concurrentIdempotencyDb = mockDbForConcurrentShipmentConflict({
    constraint: 'ux_transport_shipments_idempotency_key',
    existing: {
      id: 'existing-idempotent',
      idempotency_key: 'same-request',
    },
  });
  const recoveredIdempotent = await transport.createShipment(concurrentIdempotencyDb, 'store', {
    shipment_date: '2026-09-17',
    chain_id: 'chain-purchase',
    direction: 'purchase',
    total_weight_kg: 75,
    idempotency_key: 'same-request',
  }, { user_id: 'user' });
  assert.strictEqual(recoveredIdempotent.id, 'existing-idempotent', '23505 on idempotency key must recover existing shipment');

  const concurrentSourceDb = mockDbForConcurrentShipmentConflict({
    constraint: 'ux_transport_shipments_source_active',
    existing: {
      id: 'existing-source',
      source_type: 'client_order_delivery',
      source_id: '33333333-3333-4333-8333-333333333333',
    },
  });
  const recoveredSource = await transport.createShipment(concurrentSourceDb, 'store', {
    shipment_date: '2026-09-17',
    chain_id: 'chain-purchase',
    direction: 'purchase',
    total_weight_kg: 75,
    source_type: 'client_order_delivery',
    source_id: '33333333-3333-4333-8333-333333333333',
  }, { user_id: 'user' });
  assert.strictEqual(recoveredSource.id, 'existing-source', '23505 on business source key must recover existing shipment');

  const migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'gestion-commerciale', '120_transport_shipments_allow_same_route_same_day.sql'), 'utf8');
  const dispatchMigration = fs.readFileSync(path.join(__dirname, '..', 'db', 'gestion-commerciale', '121_transport_preparation_dispatch.sql'), 'utf8');
  const providerMigration = fs.readFileSync(path.join(__dirname, '..', 'db', 'gestion-commerciale', '122_client_logistics_service_providers.sql'), 'utf8');
  assert(migration.includes('transport_shipments'), 'migration must target transport shipments');
  assert(migration.includes("con.contype = 'u'"), 'migration must remove unique business constraints only');
  assert(migration.includes('idx.indisprimary = false'), 'migration must preserve the primary key');
  assert(migration.includes('ux_transport_shipments_idempotency_key'), 'migration must add technical idempotency uniqueness');
  assert(!/UNIQUE\s*\(\s*store_id\s*,\s*shipment_date/i.test(migration), 'migration must not recreate route/day uniqueness');
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'transport.js'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '..', 'services', 'transportService.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'transport.js'), 'utf8');
  const clientFrontend = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'client-detail.js'), 'utf8');
  assert(service.includes('idempotency_key = $2 LIMIT 1'), 'createShipment must lookup existing technical idempotency key');
  assert(service.includes("error.code === '23505'") && service.includes('ux_transport_shipments_idempotency_key'), 'createShipment must handle concurrent idempotent retries');
  assert(dispatchMigration.includes('ux_transport_shipments_source_active'), 'dispatch migration must add business source uniqueness');
  assert(service.includes('findActiveShipmentBySource'), 'createShipment must lookup existing business source shipment');
  assert(service.includes('ux_transport_shipments_source_active'), 'createShipment must recover concurrent business source conflicts');
  assert(service.includes('idempotency_key, source_type, source_id, source_reference'), 'createShipment must persist technical and business idempotence keys');
  assert(providerMigration.includes('provider_supplier_id'), 'provider migration must add a client-level logistics provider');
  assert(service.includes('prestataire_id: row.provider_supplier_id'), 'client logistics API must expose prestataire_id');
  assert(service.includes('SET is_active = false, provider_supplier_id = NULL'), 'unchecked logistics services must clear stale provider links');
  assert(clientFrontend.includes('Prestataire non renseign'), 'client UI must show missing provider state');
  assert(route.includes('transportErrorPayload'), 'transport routes must return structured API error payloads');
  assert(route.includes('code: error.code || null'), 'transport API errors must expose database/API code');
  assert(route.includes('details: error.details || error.constraint || null'), 'transport API errors must expose useful details');
  assert(frontend.includes('idempotency_key: requestId()'), 'frontend must send a technical idempotency key per shipment create');

  console.log('transportService tests ok');
})();
