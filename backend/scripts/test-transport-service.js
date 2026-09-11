const assert = require('assert');
const transport = require('../services/transportService');

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
approx(fixed.admin_fee_ht, 5.92);
approx(fixed.total_ht, 15.29);

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
approx(tonne.total_ht, 72.9);
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
approx(snapshot.services_amount_ht, 58.93);
approx(snapshot.total_ht, 204.71);

const frozen = JSON.parse(JSON.stringify(snapshot));
brackets[2].amount_ht = 358;
approx(frozen.legs[0].rate_amount_ht, 197.66);
approx(frozen.total_ht, 204.71);

console.log('transportService tests ok');
