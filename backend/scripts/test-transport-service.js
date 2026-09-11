const assert = require('assert');
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

(async () => {
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

  console.log('transportService tests ok');
})();
