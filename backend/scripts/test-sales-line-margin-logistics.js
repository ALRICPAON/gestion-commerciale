const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  computeDeliveryLogisticsTotals,
  computeLineMargin,
  enrichLines,
} = require('../services/salesLineMetrics');
const { renderDeliveryNotePdf } = require('../services/pdf/templates/deliveryNotePdfTemplate');
const alertQueries = require('../services/intelligence/alertQueries');

function assertNear(actual, expected, message) {
  assert(Math.abs(Number(actual) - expected) < 0.0001, `${message}: expected ${expected}, got ${actual}`);
}

function testSingleLotMargin() {
  const margin = computeLineMargin({
    unit_sale_price_ht: 12,
    total_weight: 18,
    selected_lot_id: 'lot-1',
    selected_lot_unit_cost_ex_vat: 10,
  });
  assertNear(margin.purchase_unit_cost_ht, 10, 'single lot cost');
  assertNear(margin.margin_per_kg, 2, 'single lot EUR/kg');
  assertNear(margin.margin_rate_percent, 20, 'single lot rate');
  assertNear(margin.margin_total, 36, 'single lot total');
  assert.strictEqual(margin.status, 'ok');
}

function testWeightedLotsMargin() {
  const margin = computeLineMargin({
    unit_sale_price_ht: 11,
    total_weight: 15,
    allocations: [
      { quantity: 10, unit_cost_ex_vat: 8 },
      { quantity: 5, unit_cost_ex_vat: 10 },
    ],
  });
  assertNear(margin.purchase_unit_cost_ht, 8.6667, 'weighted lot cost');
  assertNear(margin.margin_per_kg, 2.3333, 'weighted EUR/kg');
  assertNear(margin.margin_total, 35, 'weighted total');
}

function testNoLotMargin() {
  assert.strictEqual(computeLineMargin({ unit_sale_price_ht: 12, total_weight: 18 }), null);
  assert.strictEqual(enrichLines([{ id: 'line-1' }])[0].real_margin, null);
}

function testMarginStatuses() {
  assert.strictEqual(computeLineMargin({ unit_sale_price_ht: 10.5, total_weight: 1, selected_lot_id: 'lot', selected_lot_unit_cost_ex_vat: 10 }).status, 'low');
  assert.strictEqual(computeLineMargin({ unit_sale_price_ht: 9, total_weight: 1, selected_lot_id: 'lot', selected_lot_unit_cost_ex_vat: 10 }).status, 'negative');
}

function testLogisticsTotals() {
  const totals = computeDeliveryLogisticsTotals([
    { article_id: 'a1', package_count: 10, total_weight: 70 },
    { article_id: 'a2', package_count: 8, sold_quantity: 56.4 },
    { article_id: 'a1', package_count: 0, total_weight: 0 },
  ]);
  assertNear(totals.package_count, 18, 'package total');
  assertNear(totals.total_weight, 126.4, 'weight total');
  assert.strictEqual(totals.reference_count, 2);
}

function testDeliveryNotePdfLogistics() {
  const html = renderDeliveryNotePdf({
    document: {
      id: 'dn-1',
      reference_number: 'BL-2026-00100',
      document_date: '2026-09-14',
      client_name: 'Client',
      logistics_totals: { package_count: 18, total_weight: 126.4, reference_count: 7 },
    },
    lines: [],
    storeSettings: { company_name: 'ALTA MAREE' },
  });
  assert(html.includes('18 colis - 126,400 kg net - 7 references'), 'PDF must include logistics summary');
}

async function testLowMarginsQueryShape() {
  const calls = [];
  const result = await alertQueries.lowMargins({
    async query(sql, params) {
      calls.push({ sql, params });
      assert(sql.includes('sale_line_allocations'), 'low margins must use lot allocations');
      assert(sql.includes("sd.document_type = 'DELIVERY_NOTE'"), 'low margins must avoid ORDER/INVOICE double counting');
      assert(sql.includes('line_margins'), 'low margins must be line-level');
      return {
        rows: [{
          id: 'line-1',
          document_id: 'doc-1',
          reference_number: 'BL-2026-00100',
          document_date: '2026-09-14',
          client_name: 'E.LECLERC SODIVARDIERE',
          designation: 'FILET DE MERLU',
          purchase_unit_cost_ht: 11.2,
          sale_unit_price_ht: 11.9,
          margin_per_kg: 0.7,
          margin_rate: 6.25,
          margin_total: 12.6,
        }],
      };
    },
  }, 'store-1', 10);
  assert.strictEqual(calls[0].params[0], 'store-1');
  assert.strictEqual(result.count, 1);
  assert.strictEqual(result.items[0].document_id, 'doc-1');
  assert.strictEqual(result.items[0].line_id, 'line-1');
  assert.strictEqual(result.items[0].url, './delivery-notes.html?id=doc-1&line_id=line-1');
  assert(result.items[0].detail.includes('Achat 11.2 EUR/kg'), 'detail must expose purchase cost');
}

function testSalesDetailAllocationsRegression() {
  const salesRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'sales.js'), 'utf8');
  const routeStart = salesRoute.indexOf("router.get('/:id'");
  const routeEnd = salesRoute.indexOf("router.patch('/:id'", routeStart);
  const detailRoute = salesRoute.slice(routeStart, routeEnd);

  assert(detailRoute.includes('LEFT JOIN LATERAL'), 'GET /api/sales/:id must aggregate allocations with a lateral subquery');
  assert(detailRoute.includes('alloc.allocations'), 'GET /api/sales/:id must select lateral allocations');
  assert(!detailRoute.includes('GROUP BY sl.id'), 'GET /api/sales/:id must not group the main detail query');
  assert(detailRoute.includes('selected_lot.unit_cost_ex_vat selected_lot_unit_cost_ex_vat'), 'selected lot real cost must be preserved');
  assert(detailRoute.includes("'unit_cost_ex_vat',sla.unit_cost_ex_vat"), 'allocation real costs must be preserved');
  assert(detailRoute.includes('a.latin_name'), 'article latin name traceability must be preserved');
  assert(detailRoute.includes('a.fao_zone'), 'article FAO traceability must be preserved');
  assert(detailRoute.includes('a.sous_zone'), 'article sous-zone traceability must be preserved');
  assert(detailRoute.includes('a.fishing_gear'), 'article fishing gear traceability must be preserved');
  assert(detailRoute.includes('a.production_method'), 'article production method traceability must be preserved');
  assert(detailRoute.includes('a.allergens'), 'article allergens traceability must be preserved');
  assert(detailRoute.includes('enrichLines(l.rows)'), 'real margin enrichment must remain on sales detail response');
}

(async () => {
  testSingleLotMargin();
  testWeightedLotsMargin();
  testNoLotMargin();
  testMarginStatuses();
  testLogisticsTotals();
  testDeliveryNotePdfLogistics();
  await testLowMarginsQueryShape();
  testSalesDetailAllocationsRegression();
  console.log('sales line margin and logistics tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
