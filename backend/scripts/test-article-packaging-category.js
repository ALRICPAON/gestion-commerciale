const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const {
  articleCategoryLabel,
  assertArticleCategory,
  normalizeArticleCategory,
} = require('../services/articleCategory');

function includes(file, pattern, message) {
  assert(read(file).includes(pattern), message);
}

function main() {
  const migration = read('backend/db/gestion-commerciale/105_article_category_packaging.sql');
  assert(migration.includes("ADD COLUMN IF NOT EXISTS article_category text NOT NULL DEFAULT 'product'"), 'migration doit ajouter article_category product par defaut');
  assert(migration.includes("CHECK (article_category IN ('product', 'packaging'))"), 'migration doit contraindre product/packaging');
  assert(migration.includes('idx_articles_store_article_category'), 'migration doit indexer store/category');
  assert(!migration.includes('stock_packaging'), 'aucun stock emballage separe ne doit etre cree');

  const rollback = read('backend/db/gestion-commerciale/105_article_category_packaging_rollback.sql');
  assert(rollback.includes('DROP COLUMN IF EXISTS article_category'), 'rollback doit retirer la colonne dediee');

  assert.equal(normalizeArticleCategory(undefined), 'product');
  assert.equal(normalizeArticleCategory('Produit'), 'product');
  assert.equal(normalizeArticleCategory('Emballage'), 'packaging');
  assert.equal(articleCategoryLabel('packaging'), 'Emballage');
  assert.equal(assertArticleCategory('product'), 'product');

  includes('backend/routes/articles.js', 'article_category', 'articles route doit exposer article_category');
  includes('backend/routes/articles.js', 'assertArticleCategory(article_category)', 'articles route doit valider article_category');
  includes('backend/routes/articlesExcel.js', 'articleCategoryLabel', 'export Excel doit convertir la categorie');
  includes('backend/routes/articlesExcel.js', 'normalizeImportHeader', 'import Excel doit accepter la colonne Categorie');
  includes('backend/routes/articlesExcel.js', 'normalizeArticleCategory(row[column])', 'import Excel doit normaliser product/Produit/packaging/Emballage');

  includes('backend/routes/stock.js', "COALESCE(a.article_category, 'product') = $", 'stock doit filtrer par article_category');
  includes('frontend/stock.html', 'stock-packaging-tab', 'front stock doit avoir onglet Emballages');
  includes('frontend/js/stock.js', "params.set('article_category', activeStockCategory)", 'front stock doit envoyer article_category');
  includes('frontend/stock.html', './js/stock.js?v=6', 'cache-buster stock attendu');
  includes('frontend/stock.html', './css/pages/stock.css?v=4', 'cache-buster css stock attendu');

  includes('frontend/articles.html', 'article-business-category', 'formulaire article doit afficher la categorie metier');
  includes('frontend/js/articles.js', 'article_category: articleBusinessCategoryInput.value', 'front articles doit envoyer article_category');
  includes('frontend/articles.html', './js/articles.js?v=17', 'cache-buster articles attendu');
  includes('frontend/article-detail.html', './js/article-detail.js?v=16', 'cache-buster detail article attendu');

  includes('backend/routes/sales.js', "COALESCE(a.article_category,'product')='product'", 'vente doit refuser les emballages');
  includes('frontend/js/sale-detail.js', 'article_category=product', 'front vente doit demander les produits');
  includes('frontend/sale-detail.html', './js/sale-detail.js?v=18', 'cache-buster vente attendu');
  includes('frontend/js/quick-order-sheet.js', "article_category: 'product'", 'commande rapide doit demander les produits');
  includes('frontend/quick-order-sheet.html', './js/quick-order-sheet.js?v=8', 'cache-buster commande rapide attendu');

  includes('backend/routes/transformations.js', "COALESCE(a.article_category, 'product') = 'product'", 'transformation doit filtrer les produits');
  includes('backend/routes/transformationUpdate.js', "COALESCE(article_category, 'product') = 'product'", 'update transformation doit filtrer les produits');
  includes('backend/routes/transformationValidation.js', "COALESCE(article_category, 'product') = 'product'", 'validation transformation doit filtrer les produits');
  includes('backend/routes/traceability.js', "COALESCE(a.article_category, 'product') = 'product'", 'tracabilite liste doit filtrer les produits');
  includes('backend/services/quality/traceabilityTestService.js', "COALESCE(a.article_category, 'product') = 'product'", 'test tracabilite doit filtrer les produits');

  includes('backend/services/agentCommercialToolsService.js', 'appendArticleCategoryFilter', 'agent doit filtrer article_category');
  includes('backend/services/agentToolsService.js', 'appendArticleCategoryFilter', 'agent historique doit filtrer article_category');
  includes('backend/services/agent/agentToolSchemas.js', "article_category: { type: 'string', enum: ['product', 'packaging'] }", 'schema MCP doit exposer article_category');

  console.log(JSON.stringify({ ok: true, migration: '105_article_category_packaging.sql' }, null, 2));
}

main();
