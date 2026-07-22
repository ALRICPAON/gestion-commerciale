const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const articlesHtml = fs.readFileSync(path.join(__dirname, '../../frontend/articles.html'), 'utf8');
  const articlesJs = fs.readFileSync(path.join(__dirname, '../../frontend/js/articles.js'), 'utf8');
  const articleDetailHtml = fs.readFileSync(path.join(__dirname, '../../frontend/article-detail.html'), 'utf8');
  const articleDetailJs = fs.readFileSync(path.join(__dirname, '../../frontend/js/article-detail.js'), 'utf8');
  const packagingHtml = fs.readFileSync(path.join(__dirname, '../../frontend/packaging.html'), 'utf8');
  const packagingJs = fs.readFileSync(path.join(__dirname, '../../frontend/js/packaging.js'), 'utf8');
  const articlesRoutes = fs.readFileSync(path.join(__dirname, '../routes/articles.js'), 'utf8');
  const customerPriceLists = fs.readFileSync(path.join(__dirname, '../routes/customerPriceLists.js'), 'utf8');

  assert(articlesHtml.includes('article-type'));
  assert(articlesHtml.includes('Produit commercialisable'));
  assert(articlesHtml.includes('Emballage consommable'));
  assert(articlesHtml.includes('Emballage consigne'));
  assert(articlesHtml.includes('Autre article non commercialisable'));
  assert(articlesHtml.includes('packaging-consumable-section'));
  assert(articlesHtml.includes('packaging-returnable-section'));
  assert(articlesHtml.includes('article-primary-supplier'));
  assert(articlesHtml.includes('article-primary-supplier-returnable'));
  assert(articlesHtml.includes('article-type-filter'));
  assert(articlesHtml.includes('packaging-only-filter'));
  assert(articlesHtml.includes('articles.js?v=17'));

  assert(articlesJs.includes('ARTICLE_TYPE_DEFAULTS'));
  assert(articlesJs.includes('visible_in_price_list'));
  assert(articlesJs.includes('contributes_to_product_cost'));
  assert(articlesJs.includes('/api/suppliers?status=active'));
  assert(articlesJs.includes('primary_supplier_id'));
  assert(articlesJs.includes('article_type: articleTypeInput.value'));
  assert(articlesJs.includes("new URLSearchParams(window.location.search).get('article_type')"));
  assert(articlesJs.includes('articleTypeLabel'));

  assert(articlesRoutes.includes("const ARTICLE_TYPES = new Set"));
  assert(articlesRoutes.includes('function articleFlagsForType'));
  assert(articlesRoutes.includes("router.get('/search-packaging'"));
  assert(articlesRoutes.includes("a.article_type = 'PACKAGING_CONSUMABLE'"));
  assert(articlesRoutes.includes('a.stock_managed = true'));
  assert(articlesRoutes.includes('visible_in_price_list'));
  assert(articlesRoutes.includes('contributes_to_product_cost'));

  assert(customerPriceLists.includes("COALESCE(a.article_type, 'PRODUCT') = 'PRODUCT'"));
  assert(packagingJs.includes('/api/articles?packaging_only=true'));
  assert(packagingJs.includes("item.category === 'consumable'"));
  assert(packagingHtml.includes('Articles emballages ALTA'));
  assert(!packagingHtml.includes('create-packaging-article-btn'));
  assert(!packagingHtml.includes('item-form'));
  assert(packagingJs.includes('openArticleDetail'));
  assert(!packagingJs.includes("window.location.href = './articles.html?article_type=PACKAGING_CONSUMABLE'"));
  assert(!packagingJs.includes('/api/packaging/items/'));
  assert(articleDetailHtml.includes('article-detail.js?v=16'));
  assert(articleDetailJs.includes('/api/articles/search-packaging?q='));
  assert(!articleDetailJs.includes('/api/packaging/items'));

  console.log('Articles packaging UI tests passed');
}

run();
