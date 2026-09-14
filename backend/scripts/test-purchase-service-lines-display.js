const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  purchaseLineDisplayLabel,
  purchaseLineDisplayReference,
  sanitizePurchaseLineForDisplay,
  sumPurchaseLinesExVat,
} = require('../services/purchaseLinePresentationService');

function assertContains(haystack, pattern, message) {
  assert(pattern.test(haystack), message);
}

function assertNotContains(haystack, pattern, message) {
  assert(!pattern.test(haystack), message);
}

function testArticleLineKeepsCatalogDisplay() {
  const line = {
    id: 'line-article',
    article_id: 'article-1',
    article_plu: '3013',
    article_name: 'Filet julienne',
    supplier_reference: 'SUP-3013',
    supplier_label: 'FILET JULIENNE FOURNISSEUR',
    line_amount_ex_vat: 55.5,
  };

  assert.strictEqual(purchaseLineDisplayReference(line), '3013');
  assert.strictEqual(purchaseLineDisplayLabel(line), 'Filet julienne');
}

function testServiceLineUsesSupplierDisplay() {
  const line = {
    id: 'line-service',
    article_id: null,
    supplier_reference: 'ADMIN',
    supplier_label: 'Frais administratifs transport',
    line_amount_ex_vat: 4.35,
  };

  const displayed = sanitizePurchaseLineForDisplay(line);
  assert.strictEqual(displayed.article_plu, 'ADMIN');
  assert.strictEqual(displayed.article_name, 'Frais administratifs transport');
  assert.strictEqual(displayed.is_service_line, true);
}

function testTransportServiceReferenceIsReadableWithoutDataRewrite() {
  const line = {
    id: 'line-transport',
    article_id: null,
    article_plu: 'base_transport',
    supplier_reference: 'base_transport',
    supplier_label: 'Transport HT',
    transport_component_meta_value: { component_code: 'base_transport', amount_ht: 110 },
    line_amount_ex_vat: 110,
  };

  const displayed = sanitizePurchaseLineForDisplay(line);
  assert.strictEqual(displayed.article_plu, 'TRANSPORT');
  assert.strictEqual(displayed.article_name, 'Transport HT');
}

function testMixedArticleAndServiceTotal() {
  const lines = [
    { article_id: 'article-1', line_amount_ex_vat: 10.12 },
    { article_id: null, supplier_label: 'Transport HT', line_amount_ex_vat: 120.95 },
  ];

  assert.strictEqual(sumPurchaseLinesExVat(lines), 131.07);
}

function testTransportOnlyTotalsMatchBltAmounts() {
  assert.strictEqual(sumPurchaseLinesExVat([
    { article_id: null, supplier_label: 'Transport HT', line_amount_ex_vat: 110 },
    { article_id: null, supplier_label: 'Surcharge carburant', line_amount_ex_vat: 6.6 },
    { article_id: null, supplier_label: 'Frais administratifs transport', line_amount_ex_vat: 4.35 },
  ]), 120.95);

  assert.strictEqual(sumPurchaseLinesExVat([
    { article_id: null, supplier_label: 'Transport HT', line_amount_ex_vat: 39.37 },
    { article_id: null, supplier_label: 'Surcharge carburant', line_amount_ex_vat: 3.94 },
  ]), 43.31);
}

function testSqlShapeIncludesServiceLinesInDisplayAndTotals() {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'purchases.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'purchase-detail.js'), 'utf8');

  assertContains(route, /COALESCE\(a\.plu,\s*pl\.supplier_reference\)\s+article_plu/i, 'detail route must expose supplier_reference when article is missing');
  assertContains(route, /COALESCE\(a\.designation,\s*pl\.supplier_label\)\s+article_name/i, 'detail route must expose supplier_label when article is missing');
  assertContains(route, /COALESCE\(SUM\(pl\.line_amount_ex_vat\),0\)\s+computed_total_amount_ex_vat/i, 'purchase list total must sum every line');
  assertContains(route, /total_amount_ex_vat:\s*sumPurchaseLinesExVat\(lines\)/, 'purchase detail total must be computed from every returned line');
  assertContains(route, /LEFT JOIN LATERAL[\s\S]*meta_key='transport_component'[\s\S]*LIMIT 1\) tcm ON true/i, 'transport metadata lookup must not duplicate purchase lines');
  assertContains(frontend, /line\.article_name\s*\|\|\s*line\.supplier_label/, 'frontend detail must render supplier_label fallback');
}

function testServiceLinesDoNotCreateStock() {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'purchases.js'), 'utf8');

  assertContains(route, /if\s*\(!line\.article_id\)\s*{[\s\S]*stock_quantity\s*=\s*0[\s\S]*lot_id\s*=\s*NULL[\s\S]*continue;/, 'stock rebuild must skip service lines');
  assertNotContains(route, /if\s*\(!line\.article_id\)\s*throw businessError\(`Ligne \$\{line\.line_number\} sans article`\)/, 'service lines must not be rejected by stock rebuild');
}

function run() {
  testArticleLineKeepsCatalogDisplay();
  testServiceLineUsesSupplierDisplay();
  testTransportServiceReferenceIsReadableWithoutDataRewrite();
  testMixedArticleAndServiceTotal();
  testTransportOnlyTotalsMatchBltAmounts();
  testSqlShapeIncludesServiceLinesInDisplayAndTotals();
  testServiceLinesDoNotCreateStock();
  console.log('OK purchase service lines display');
}

run();
