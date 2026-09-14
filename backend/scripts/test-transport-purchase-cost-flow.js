const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  allocateTransportAmountByWeight,
  buildTransportPurchaseComponents,
  realTransportUnitCost,
} = require('../services/transportPurchaseFlowService');

function assertNear(actual, expected, message) {
  assert(Math.abs(Number(actual) - expected) < 0.0001, `${message}: expected ${expected}, got ${actual}`);
}

function testTransportPurchaseComponents() {
  const components = buildTransportPurchaseComponents({
    transport_amount_ht: 80,
    fuel_amount_ht: 12,
    admin_fee_ht: 7,
    services_amount_ht: 15,
    expected_total_ht: 114,
    calculation_snapshot: {
      legs: [{ carrier_id: 'carrier-1', transport_amount_ht: 80 }],
      admin_fees: [{ carrier_id: 'carrier-1', amount_ht: 7 }],
      services: [{ label: 'Dechargement', total_ht: 15 }],
    },
  });

  assert.deepStrictEqual(components.map((item) => item.code), [
    'base_transport',
    'fuel_surcharge',
    'admin_fee',
    'logistics_service',
  ]);
  assertNear(components.reduce((sum, item) => sum + item.amount_ht, 0), 114, 'component total');
}

function testRealTransportUnitCost() {
  assertNear(realTransportUnitCost({ expected_total_ht: 99, total_weight_kg: 50 }), 1.98, 'real transport cost per kg');
  assert.strictEqual(realTransportUnitCost({ expected_total_ht: 99, total_weight_kg: 0 }), null);
}

function testProportionalAllocationUsesAllocableWeightAndRemainder() {
  const allocations = allocateTransportAmountByWeight([
    { id: 'small', weight_kg: 1 },
    { id: 'largest', weight_kg: 2 },
    { id: 'empty', weight_kg: 0 },
  ], 100);

  assert.strictEqual(allocations.length, 2);
  assertNear(
    allocations.reduce((sum, line) => sum + line.allocated_amount_ht, 0),
    100,
    'allocated total must equal transport total'
  );
  assert.strictEqual(
    allocations.reduce((sum, line) => sum + line.allocated_amount_ht, 0).toFixed(4),
    '100.0000',
    'allocated total must be exact at stored precision'
  );
  assertNear(allocations.find((line) => line.id === 'small').allocated_amount_ht, 33.3333, 'small line prorata');
  assertNear(allocations.find((line) => line.id === 'largest').allocated_amount_ht, 66.6667, 'largest line receives remainder');
  assertNear(allocations.find((line) => line.id === 'small').unit_transport_cost_ht, 33.3333, 'small unit transport cost');
  assertNear(allocations.find((line) => line.id === 'largest').unit_transport_cost_ht, 33.3334, 'largest unit transport cost');
}

function testTransportPurchaseFlowSqlShape() {
  const service = fs.readFileSync(path.join(__dirname, '..', 'services', 'transportPurchaseFlowService.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'gestion-commerciale', '119_transport_purchase_cost_flow.sql'), 'utf8');
  const transportRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'transport.js'), 'utf8');

  assert(migration.includes('ux_purchases_transport_delivery_note'), 'migration must enforce one purchase per BLT');
  assert(migration.includes('transport_cost_allocations'), 'migration must create transport allocation table');
  assert(migration.includes('real_transport_cost_per_kg_ht'), 'migration must persist BLT real transport EUR/kg');
  assert(service.includes('findLinkedPurchase'), 'service must search existing linked purchase before creating');
  assert(service.includes('Achat transport deja facture ou verrouille'), 'service must block locked transport purchases');
  assert(service.includes('supplier_invoice_matches'), 'service must block purchase refresh when a supplier invoice is linked');
  assert(service.includes('DELETE FROM purchase_lines WHERE purchase_id'), 'modifiable linked purchase must be refreshed');
  assert(service.includes('transport_shipment_documents'), 'service must keep shipment document purchase link');
  assert(service.includes('target_sales_line_id'), 'service must allocate costs to sales lines');
  assert(service.includes('target_purchase_line_id'), 'service must allocate costs to purchase lines');
  assert(service.includes('allocateTransportAmountByWeight'), 'service must allocate transport proportionally by allocable weight');
  assert(service.includes('totalAllocableWeight'), 'allocation must use actual allocable weight, not BLT weight');
  assert(transportRoute.includes("await db.query('BEGIN')"), 'BLT generation route must be transactional');
}

testTransportPurchaseComponents();
testRealTransportUnitCost();
testProportionalAllocationUsesAllocableWeightAndRemainder();
testTransportPurchaseFlowSqlShape();
console.log('transport purchase cost flow tests passed');
