const assert = require('assert');
const fs = require('fs');
const path = require('path');

const route = require('../routes/quickOrderSheets');

const normalize = route._normalizeDailyPricingPayloadForTest;
assert.equal(typeof normalize, 'function', 'quick order sheet normalizer is testable');

const payload = normalize({
  date: '2026-08-27',
  products: [
    { uid: 'missing', article_id: '11111111-1111-4111-8111-111111111111', designation: 'Transport absent', purchase_price_ht: '10.25' },
    { uid: 'empty', article_id: '22222222-2222-4222-8222-222222222222', designation: 'Transport vide', purchase_price_ht: '8', transport_cost_ht: '' },
    { uid: 'explicit', article_id: '33333333-3333-4333-8333-333333333333', designation: 'Transport explicite', purchase_price_ht: '12', transport_cost_ht: '0.15' },
    { uid: 'no-purchase', article_id: '44444444-4444-4444-8444-444444444444', designation: 'Achat absent' },
  ],
});

const byUid = new Map(payload.products.map((product) => [product.column_uid, product]));
assert.equal(byUid.get('missing').transport_cost_ht, 0, 'missing transport is normalized to zero');
assert.equal(byUid.get('missing').cost_rendered_ht, 10.25, 'missing rendered cost is purchase + zero transport');
assert.equal(byUid.get('empty').transport_cost_ht, 0, 'empty-string transport is normalized to zero');
assert.equal(byUid.get('empty').cost_rendered_ht, 8, 'empty-string transport keeps rendered cost coherent');
assert.equal(byUid.get('explicit').transport_cost_ht, 0.15, 'explicit transport is preserved');
assert.equal(byUid.get('explicit').cost_rendered_ht, 12.15, 'explicit transport is included in rendered cost');
assert.equal(byUid.get('no-purchase').transport_cost_ht, 0, 'transport is still non-null without purchase price');
assert.equal(byUid.get('no-purchase').cost_rendered_ht, null, 'rendered cost remains null when purchase price is unavailable');

const manyProductsPayload = normalize({
  date: '2026-08-27',
  products: Array.from({ length: 25 }, (_, index) => ({
    uid: `product-${index + 1}`,
    designation: `Produit ${index + 1}`,
    purchase_price_ht: String(index + 1),
  })),
});
assert.equal(manyProductsPayload.products.length, 25, 'quick order sheet backend keeps more than 18 products');
assert.equal(manyProductsPayload.products[24].column_uid, 'product-25', 'quick order sheet backend does not truncate product 25');

const root = path.join(__dirname, '..', '..');
const pricingService = fs.readFileSync(path.join(root, 'backend/services/pricingService.js'), 'utf8');
const agentCallSheet = fs.readFileSync(path.join(root, 'backend/services/agentCallSheetService.js'), 'utf8');
const quickOrderSheets = fs.readFileSync(path.join(root, 'backend/routes/quickOrderSheets.js'), 'utf8');
const quickOrderSheetJs = fs.readFileSync(path.join(root, 'frontend/js/quick-order-sheet.js'), 'utf8');

assert(pricingService.includes('line.transport_cost_ht || 0'), 'pricing publication sync writes non-null transport');
assert(quickOrderSheets.includes('product.transport_cost_ht') && quickOrderSheets.includes('const transportCost = pos(product.transport_cost_ht, 0)'), 'manual sheet save writes normalized transport');
assert(!quickOrderSheets.includes('products.slice(0, 60)'), 'manual sheet save has no backend product limit');
assert(!agentCallSheet.includes('transport_cost_ht, cost_rendered_ht'), 'agent call sheet tools leave transport columns to database defaults instead of writing NULL');
assert(quickOrderSheetJs.includes('const DEFAULT_PRODUCT_COLUMNS = 10;'), 'new quick order sheets still start with 10 product columns');
assert(!quickOrderSheetJs.includes('MAX_PRODUCT_COLUMNS'), 'quick order sheet frontend has no maximum product column limit');
assert(!quickOrderSheetJs.includes('slice(0, MAX_PRODUCT_COLUMNS)'), 'local drafts are not truncated to 18 products');
assert(quickOrderSheetJs.includes('productColumns = draft.productColumns.map'), 'local drafts reload all saved product columns');
assert(quickOrderSheetJs.includes('productColumns.push(emptyProductColumn())'), 'add product always appends a new product column');

console.log(JSON.stringify({
  ok: true,
  tests: [
    'transport absent -> 0',
    'transport vide -> 0',
    'transport 0.15 -> 0.15',
    'cost_rendered_ht recalcule depuis achat + transport',
    'audit ecritures quick_order_sheet_products: sauvegarde manuelle, sync pricing, agent call sheet',
    'fiche appel 25 produits sans troncature',
  ],
}, null, 2));
