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
  assert.throws(() => assertArticleCategory('metal'), /Catégorie article invalide/);

  const articlesRoute = read('backend/routes/articles.js');
  includes('backend/routes/articles.js', 'article_category', 'articles route doit exposer article_category');
  includes('backend/routes/articles.js', 'assertArticleCategory(article_category)', 'articles route doit valider article_category');
  assert(
    articlesRoute.includes("article_category = CASE WHEN $22 THEN $23 ELSE article_category END"),
    'PATCH partiel article doit conserver article_category si absente'
  );
  assert(
    articlesRoute.includes("const hasPatchField = (field) => Object.prototype.hasOwnProperty.call(req.body, field)"),
    'PATCH partiel article doit distinguer champ absent et champ fourni'
  );
  assert(
    articlesRoute.includes("const hasArticleCategoryPatch = hasPatchField('article_category')"),
    'PATCH explicite article_category doit etre detecte separement'
  );
  assert(
    articlesRoute.includes('const currentArticleResult = await client.query'),
    'PATCH partiel article doit relire la valeur courante avant update'
  );
  assert(
    articlesRoute.includes("const nextDesignation = hasPatchField('designation') ? toNullableString(designation) : currentArticle.designation"),
    'PATCH partiel designation doit conserver les autres champs existants'
  );
  assert(
    articlesRoute.includes('const normalizedArticleCategory = hasArticleCategoryPatch'),
    'PATCH explicite article_category doit etre valide avant update'
  );
  assert(
    articlesRoute.includes('if (err.status && err.status < 500)'),
    'PATCH article_category invalide doit retourner une erreur 400 metier'
  );
  assert(
    !articlesRoute.includes("AND COALESCE(a.article_category, 'product') = $5"),
    'recherche articles generique sans categorie ne doit pas masquer packaging'
  );
  assert(
    !articlesRoute.includes("AND COALESCE(a.article_category, 'product') = $4"),
    'recherche stock generique sans categorie ne doit pas masquer packaging'
  );
  assert(
    (articlesRoute.match(/const requestedArticleCategory = req\.query\.article_category !== undefined/g) || []).length >= 2,
    'recherches generiques doivent filtrer uniquement si article_category est fourni'
  );
  assert(
    (articlesRoute.match(/COALESCE\(a\.article_category, 'product'\) = \$\$\{.*\.length\}/g) || []).length >= 2,
    'recherches generiques doivent accepter les filtres explicites product et packaging'
  );
  includes('backend/routes/articlesExcel.js', 'articleCategoryLabel', 'export Excel doit convertir la categorie');
  includes('backend/routes/articlesExcel.js', 'normalizeImportHeader', 'import Excel doit accepter la colonne Categorie');
  includes('backend/routes/articlesExcel.js', 'normalizeArticleCategory(row[column])', 'import Excel doit normaliser product/Produit/packaging/Emballage');
  assert(
    !read('backend/routes/articlesExcel.js').includes("article_category = 'product'"),
    'import update Excel ne doit pas forcer product quand la categorie est absente'
  );

  includes('backend/routes/stock.js', "COALESCE(a.article_category, 'product') = $", 'stock doit filtrer par article_category');
  includes('frontend/stock.html', 'stock-packaging-tab', 'front stock doit avoir onglet Emballages');
  includes('frontend/js/stock.js', "params.set('article_category', activeStockCategory)", 'front stock doit envoyer article_category');
  includes('frontend/stock.html', './js/stock.js?v=6', 'cache-buster stock attendu');
  includes('frontend/stock.html', './css/pages/stock.css?v=4', 'cache-buster css stock attendu');

  includes('frontend/articles.html', 'article-business-category', 'formulaire article doit afficher la categorie metier');
  includes('frontend/js/articles.js', 'article_category: articleBusinessCategoryInput.value', 'front articles doit envoyer article_category');
  includes('frontend/js/articles.js', 'openArticleFromEditParam', 'front articles doit ouvrir ?edit=');
  includes('frontend/js/articles.js', 'assertArticleSaveConsistency(refreshedArticle, payload)', 'front articles doit verifier la categorie relue apres sauvegarde');
  includes('frontend/articles.html', './js/articles.js?v=20', 'cache-buster articles attendu');
  includes('frontend/article-detail.html', './js/article-detail.js?v=17', 'cache-buster detail article attendu');

  includes('backend/routes/sales.js', "COALESCE(a.article_category,'product')='product'", 'vente doit refuser les emballages');
  includes('frontend/js/sale-detail.js', 'article_category=product', 'front vente doit demander les produits');
  includes('frontend/sale-detail.html', './js/sale-detail.js?v=18', 'cache-buster vente attendu');
  includes('frontend/js/sale-stock-negative-flow.js', 'article_category=product', 'flux vente stock negatif doit demander les produits');
  includes('frontend/sale-detail.html', './js/sale-stock-negative-flow.js?v=4', 'cache-buster flux stock negatif attendu');
  includes('frontend/js/quick-order-sheet.js', "article_category: 'product'", 'commande rapide doit demander les produits');
  includes('frontend/quick-order-sheet.html', './js/quick-order-sheet.js?v=9', 'cache-buster commande rapide attendu');

  includes('backend/routes/transformations.js', "COALESCE(a.article_category, 'product') = 'product'", 'transformation doit filtrer les produits');
  includes('backend/routes/transformationUpdate.js', "COALESCE(article_category, 'product') = 'product'", 'update transformation doit filtrer les produits');
  includes('backend/routes/transformationValidation.js', "COALESCE(article_category, 'product') = 'product'", 'validation transformation doit filtrer les produits');
  includes('backend/routes/traceability.js', "COALESCE(a.article_category, 'product') = 'product'", 'tracabilite liste doit filtrer les produits');
  includes('backend/services/quality/traceabilityTestService.js', "COALESCE(a.article_category, 'product') = 'product'", 'test tracabilite doit filtrer les produits');

  includes('backend/services/agentCommercialToolsService.js', 'appendArticleCategoryFilter', 'agent doit filtrer article_category');
  includes('backend/services/agentToolsService.js', 'appendArticleCategoryFilter', 'agent historique doit filtrer article_category');
  includes('backend/services/agent/agentToolSchemas.js', "article_category: { type: 'string', enum: ['product', 'packaging'] }", 'schema MCP doit exposer article_category');
  includes('backend/routes/articles.js', 'source.article_category || \'product\'', 'duplication article doit conserver la categorie source');
  assert(
    !read('backend/routes/purchases.js').includes("article_category, 'product') = 'product'"),
    'achat doit pouvoir selectionner product et packaging'
  );

  console.log(JSON.stringify({ ok: true, migration: '105_article_category_packaging.sql' }, null, 2));
}

main();
