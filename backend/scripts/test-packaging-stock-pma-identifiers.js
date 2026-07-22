const assert = require('assert');
const fs = require('fs');
const path = require('path');

const diagnosticSql = {
  productStockAndPma: `
SELECT
  a.id AS article_id,
  a.store_id,
  s.name AS store_name,
  a.plu,
  a.designation,
  a.unit,
  ss.id AS stock_summary_id,
  ss.stock_quantity,
  ss.stock_value_ex_vat,
  ss.pma
FROM articles a
JOIN stores s ON s.id = a.store_id
LEFT JOIN stock_summary ss
  ON ss.article_id = a.id
 AND ss.store_id = a.store_id
WHERE a.store_id = $1
  AND (a.plu = $2 OR a.designation ILIKE $3)
ORDER BY a.designation ASC;
`,
  packagingStockAndPma: `
SELECT
  a.id AS packaging_article_id,
  a.store_id,
  s.name AS store_name,
  a.plu,
  a.designation,
  a.article_type,
  a.is_active,
  a.stock_managed,
  COALESCE(a.stock_unit, a.unit, 'unit') AS stock_unit,
  ss.id AS stock_summary_id,
  ss.stock_quantity,
  ss.stock_value_ex_vat,
  ss.pma
FROM articles a
JOIN stores s ON s.id = a.store_id
LEFT JOIN stock_summary ss
  ON ss.article_id = a.id
 AND ss.store_id = a.store_id
WHERE a.store_id = $1
  AND a.id = $2;
`,
  packagingModelValidation: `
SELECT id
FROM articles
WHERE id = $1
  AND store_id = $2
  AND is_active = true
  AND article_type = 'PACKAGING_CONSUMABLE'
LIMIT 1;
`,
};

function run() {
  const articlesRoutes = fs.readFileSync(path.join(__dirname, '../routes/articles.js'), 'utf8');
  const packagingService = fs.readFileSync(path.join(__dirname, '../services/packaging/packagingService.js'), 'utf8');
  const packagingJs = fs.readFileSync(path.join(__dirname, '../../frontend/js/packaging.js'), 'utf8');
  const packagingHtml = fs.readFileSync(path.join(__dirname, '../../frontend/packaging.html'), 'utf8');

  assert(articlesRoutes.includes('function activeArticleDepartmentJoin'));
  assert(articlesRoutes.includes('LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id'));
  assert(articlesRoutes.includes('COALESCE(ss.stock_quantity, 0)::float8 AS stock_quantity'));
  assert(articlesRoutes.includes('COALESCE(ss.pma, 0)::float8 AS pma'));
  assert(articlesRoutes.includes('COALESCE(ss.pma, a.purchase_price_ex_vat, ad.purchase_price_ex_vat, 0)::float8 AS current_unit_cost_ex_vat'));

  assert(packagingJs.includes('<option value="${itemOption.id}"'));
  assert(packagingJs.includes('packaging_article_id: component.packaging_item_id'));
  assert(packagingJs.includes('quantity_per_package: component.quantity'));
  assert(packagingHtml.includes('packaging.js?v=6'));

  assert(packagingService.includes('function componentQuantityOf'));
  assert(packagingService.includes('component.quantity_per_package ?? component.quantity'));
  assert(packagingService.includes("AND article_type = 'PACKAGING_CONSUMABLE'"));
  assert(!packagingService.includes('FROM packaging_items'));
  assert(!packagingService.includes('JOIN packaging_items'));
  assert(!packagingService.includes('stock_quantity > 0'));
  assert(packagingService.includes('assertSufficientStock(lines, stocks)'));

  console.log('Diagnostic SQL stock/PMA/identifiants:');
  console.log(diagnosticSql.productStockAndPma.trim());
  console.log(diagnosticSql.packagingStockAndPma.trim());
  console.log(diagnosticSql.packagingModelValidation.trim());
  console.log('Packaging stock/PMA/identifier tests passed');
}

run();
