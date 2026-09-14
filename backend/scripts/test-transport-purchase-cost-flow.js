const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  allocateTransportAmountByWeight,
  buildTransportPurchaseComponents,
  buildTransportPurchaseLine,
  insertShipmentDocumentPurchaseLink,
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

  const aggregatedServices = buildTransportPurchaseComponents({
    transport_amount_ht: 0,
    fuel_amount_ht: 0,
    admin_fee_ht: 0,
    services_amount_ht: 15,
    expected_total_ht: 15,
    calculation_snapshot: {},
  });
  assert.deepStrictEqual(aggregatedServices.map((item) => item.code), ['logistics_service']);
}

function testRealTransportUnitCost() {
  assertNear(realTransportUnitCost({ expected_total_ht: 99, total_weight_kg: 50 }), 1.98, 'real transport cost per kg');
  assert.strictEqual(realTransportUnitCost({ expected_total_ht: 99, total_weight_kg: 0 }), null);
}

function amountWithPurchasePieceConvention(line) {
  const colis = Number(line.received_colis ?? line.ordered_colis ?? 0);
  const pieces = Number(line.received_pieces ?? line.ordered_pieces ?? 0);
  const unitPrice = Number(line.unit_price_ex_vat || 0);
  return Number(((colis > 0 && pieces > 0 ? colis * pieces : pieces) * unitPrice).toFixed(4));
}

function testTransportServiceLinesUsePieceQuantityConvention() {
  const components = buildTransportPurchaseComponents({
    transport_amount_ht: 85.21,
    fuel_amount_ht: 29.82,
    admin_fee_ht: 5.92,
    services_amount_ht: 7.5,
    expected_total_ht: 128.45,
    calculation_snapshot: {
      legs: [{ carrier_id: 'carrier-1', transport_amount_ht: 85.21 }],
      admin_fees: [{ carrier_id: 'carrier-1', amount_ht: 5.92 }],
      services: [{ label: 'Etiquetage', total_ht: 7.5 }],
    },
  });
  const lines = components.map(buildTransportPurchaseLine);

  assert.deepStrictEqual(components.map((item) => item.code), [
    'base_transport',
    'fuel_surcharge',
    'admin_fee',
    'logistics_service',
  ]);

  for (const line of lines) {
    assert.strictEqual(line.article_id, null, `${line.supplier_reference} must remain a service line`);
    assert.strictEqual(line.ordered_colis, null, `${line.supplier_reference} must not use colis`);
    assert.strictEqual(line.received_colis, null, `${line.supplier_reference} must not use received colis`);
    assert.strictEqual(line.ordered_pieces, 1, `${line.supplier_reference} must use ordered_pieces=1`);
    assert.strictEqual(line.received_pieces, 1, `${line.supplier_reference} must use received_pieces=1`);
    assert.strictEqual(line.ordered_quantity, 0, `${line.supplier_reference} must not use weight as quantity`);
    assert.strictEqual(line.received_quantity, 0, `${line.supplier_reference} must not use received weight as quantity`);
    assert.strictEqual(line.stock_quantity, 0, `${line.supplier_reference} must not create stock quantity`);
    assert.strictEqual(line.price_unit, 'piece');
    assert.strictEqual(line.line_status, 'received');
    assertNear(amountWithPurchasePieceConvention(line), line.line_amount_ex_vat, `${line.supplier_reference} line total`);
  }
}

function testBlt202600001TransportLineTotal() {
  const components = buildTransportPurchaseComponents({
    transport_amount_ht: 85.21,
    fuel_amount_ht: 29.82,
    admin_fee_ht: 5.92,
    expected_total_ht: 120.95,
    calculation_snapshot: {
      legs: [{ carrier_id: 'carrier-1', transport_amount_ht: 85.21 }],
      admin_fees: [{ carrier_id: 'carrier-1', amount_ht: 5.92 }],
      services: [],
    },
  });
  const lines = components.map(buildTransportPurchaseLine);

  assertNear(lines.find((line) => line.supplier_reference === 'base_transport').line_amount_ex_vat, 85.21, 'base transport amount');
  assertNear(lines.find((line) => line.supplier_reference === 'fuel_surcharge').line_amount_ex_vat, 29.82, 'fuel surcharge amount');
  assertNear(lines.find((line) => line.supplier_reference === 'admin_fee').line_amount_ex_vat, 5.92, 'admin fee amount');
  assertNear(lines.reduce((sum, line) => sum + line.line_amount_ex_vat, 0), 120.95, 'transport purchase total');
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
  assert(service.includes('$2::uuid IS NOT NULL'), 'shipment document link must cast nullable shipment parameter');
  assert(service.includes('ordered_pieces, ordered_quantity'), 'transport service lines must write purchase piece quantities');
  assert(service.includes('received_colis, received_pieces, received_quantity, stock_quantity'), 'transport service lines must write received piece quantities and no stock');
  assert(!/INSERT INTO lots|INSERT INTO stock_movements|stock_summary/i.test(service), 'transport purchase service must not create stock or lots');
  assert(service.includes('target_sales_line_id'), 'service must allocate costs to sales lines');
  assert(service.includes('target_purchase_line_id'), 'service must allocate costs to purchase lines');
  assert(service.includes('allocateTransportAmountByWeight'), 'service must allocate transport proportionally by allocable weight');
  assert(service.includes('totalAllocableWeight'), 'allocation must use actual allocable weight, not BLT weight');
  assert(transportRoute.includes("await db.query('BEGIN')"), 'BLT generation route must be transactional');
}

async function testShipmentDocumentPurchaseLinkCastsNonNullShipmentId() {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1, rows: [] };
    },
  };

  await insertShipmentDocumentPurchaseLink(db, {
    storeId: '11111111-1111-1111-1111-111111111111',
    shipmentId: '22222222-2222-2222-2222-222222222222',
    purchaseId: '33333333-3333-3333-3333-333333333333',
    supplierId: '44444444-4444-4444-4444-444444444444',
    documentReference: 'BLT-2026-00001',
    weightKg: 123.456,
  });

  assert.strictEqual(calls.length, 1);
  assert(calls[0].sql.includes('SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::numeric'), 'insert select must cast all parameters');
  assert(calls[0].sql.includes('WHERE $2::uuid IS NOT NULL'), 'shipment_id null guard must be cast');
  assert(calls[0].sql.includes('WHERE store_id = $1::uuid'), 'idempotence lookup must cast store_id');
  assert(calls[0].sql.includes('shipment_id = $2::uuid'), 'idempotence lookup must cast shipment_id');
  assert(calls[0].sql.includes('purchase_id = $3::uuid'), 'idempotence lookup must cast purchase_id');
  assert.deepStrictEqual(calls[0].params, [
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
    '44444444-4444-4444-4444-444444444444',
    'BLT-2026-00001',
    123.456,
  ]);
}

async function testShipmentDocumentPurchaseLinkCastsNullShipmentId() {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 0, rows: [] };
    },
  };

  await insertShipmentDocumentPurchaseLink(db, {
    storeId: '11111111-1111-1111-1111-111111111111',
    shipmentId: null,
    purchaseId: '33333333-3333-3333-3333-333333333333',
    supplierId: '44444444-4444-4444-4444-444444444444',
    documentReference: 'BLT-2026-00002',
    weightKg: 0,
  });

  assert.strictEqual(calls.length, 1);
  assert(calls[0].sql.includes('WHERE $2::uuid IS NOT NULL'), 'null shipment guard must remain typed');
  assert.strictEqual(calls[0].params[1], null);
}

async function testShipmentDocumentPurchaseLinkIdempotenceShape() {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 0, rows: [] };
    },
  };

  await insertShipmentDocumentPurchaseLink(db, {
    storeId: '11111111-1111-1111-1111-111111111111',
    shipmentId: '22222222-2222-2222-2222-222222222222',
    purchaseId: '33333333-3333-3333-3333-333333333333',
    supplierId: '44444444-4444-4444-4444-444444444444',
    documentReference: 'BLT-2026-00001',
    weightKg: 10,
  });

  assert(calls[0].sql.includes('NOT EXISTS'), 'shipment document link must stay idempotent');
  assert.strictEqual((calls[0].sql.match(/transport_shipment_documents/g) || []).length, 2, 'query must insert only when matching link is absent');
}

(async () => {
  testTransportPurchaseComponents();
  testRealTransportUnitCost();
  testTransportServiceLinesUsePieceQuantityConvention();
  testBlt202600001TransportLineTotal();
  testProportionalAllocationUsesAllocableWeightAndRemainder();
  testTransportPurchaseFlowSqlShape();
  await testShipmentDocumentPurchaseLinkCastsNonNullShipmentId();
  await testShipmentDocumentPurchaseLinkCastsNullShipmentId();
  await testShipmentDocumentPurchaseLinkIdempotenceShape();
  console.log('transport purchase cost flow tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
