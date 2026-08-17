const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assertIncludes(text, expected, message) {
  assert(text.includes(expected), message);
}

function assertNotIncludes(text, unexpected, message) {
  assert(!text.includes(unexpected), message);
}

function main() {
  const homeHtml = read('frontend/home.html');
  const packingHtml = read('frontend/packing.html');
  const packingJs = read('frontend/js/packing.js');
  const packingDetailHtml = read('frontend/packing-detail.html');
  const packingDetailJs = read('frontend/js/packing-detail.js');
  const articlesHtml = read('frontend/articles.html');
  const articlesJs = read('frontend/js/articles.js');

  assertIncludes(homeHtml, 'href="./packing.html"', 'Home doit exposer le module Colisage');
  assertIncludes(homeHtml, 'data-module="packing"', 'Carte home Colisage manquante');

  assertIncludes(packingHtml, './css/pages/packing.css?v=1', 'Cache-buster CSS liste colisage manquant');
  assertIncludes(packingHtml, './js/packing.js?v=1', 'Cache-buster JS liste colisage manquant');
  assertIncludes(packingHtml, 'Nouvelle operation', 'Creation brouillon colisage manquante');
  assertIncludes(packingHtml, 'F9 : afficher les produits', 'Indication F9 produits manquante');
  ['Brouillon', 'Valide', 'Annule', 'Tous', 'Cout poisson', 'Cout emballage', 'PR/kg'].forEach((label) => {
    assertIncludes(packingHtml, label, `Liste colisage doit afficher ${label}`);
  });

  assertIncludes(packingJs, "api('/api/packing", 'Liste colisage doit appeler /api/packing');
  assertIncludes(packingJs, 'article_category=product&limit=50', 'Consultation F9 produits doit filtrer product et limiter');
  assertIncludes(packingJs, '/api/articles/search?q=', 'Recherche article manuelle manquante');
  assertIncludes(packingJs, "event.key === 'F9'", 'F9 doit etre gere sur article produit');
  assertIncludes(packingJs, 'event.preventDefault();', 'F9 doit appeler preventDefault');
  assertIncludes(packingJs, 'Number.isInteger(packageCount)', 'package_count doit etre controle entier cote frontend');

  assertIncludes(packingDetailHtml, './css/pages/packing-detail.css?v=1', 'Cache-buster CSS detail colisage manquant');
  assertIncludes(packingDetailHtml, './js/packing-detail.js?v=1', 'Cache-buster JS detail colisage manquant');
  assertIncludes(packingDetailHtml, 'Lots poisson source', 'Bloc lots source manquant');
  assertIncludes(packingDetailHtml, 'Emballages / consommables', 'Bloc emballages manquant');
  assertIncludes(packingDetailHtml, 'Valider colisage', 'Action validation manquante');
  assertIncludes(packingDetailHtml, 'F9 : afficher les lots', 'Indication F9 lots manquante');

  assertIncludes(packingDetailJs, '/api/stock/lots?', 'Recherche lots doit reutiliser /api/stock/lots');
  assertIncludes(packingDetailJs, "params.set('article_category', state.lineMode === 'source' ? 'product' : 'packaging')", 'Lots source/product et emballages/packaging doivent etre separes');
  assertIncludes(packingDetailJs, "params.set('available_only', 'true')", 'Recherche lots doit viser le stock disponible');
  assertIncludes(packingDetailJs, "params.set('exclude_blocked_quality', 'true')", 'Recherche lots doit exclure les lots bloques qualite');
  assertIncludes(packingDetailJs, "params.set('limit', '100')", 'Recherche lots doit rester limitee');
  assertIncludes(packingDetailJs, "event.key === 'F9'", 'F9 doit etre gere sur les lots');
  assertIncludes(packingDetailJs, 'event.preventDefault();', 'F9 lots doit appeler preventDefault');
  assertIncludes(packingDetailJs, '/source-lots', 'Ajout/suppression lots source manquant');
  assertIncludes(packingDetailJs, '/materials', 'Ajout/suppression emballages manquant');
  assertIncludes(packingDetailJs, '/validate', 'Validation colisage manquante');
  assertIncludes(packingDetailJs, '/cancel', 'Annulation colisage manquante');
  assertIncludes(packingDetailJs, 'PACKING_SOURCE_LOT_BLOCKED', 'Erreur lot source bloquee non mappee');
  assertIncludes(packingDetailJs, 'PACKING_MATERIAL_STOCK_INSUFFICIENT', 'Erreur stock emballage non mappee');
  assertIncludes(packingDetailJs, "operation.status !== 'draft'", 'Mode readonly hors brouillon manquant');
  assertIncludes(read('backend/routes/stock.js'), "COALESCE(l.quality_status, 'released') <> 'blocked'", 'Endpoint stock/lots doit supporter exclusion des lots bloques');

  assertIncludes(articlesHtml, './js/articles.js?v=18', 'Cache-buster articles.js doit etre incremente');
  assertIncludes(articlesJs, 'openArticleFromEditParam', 'articles.html doit traiter ?edit=');
  assertIncludes(articlesJs, 'fetchArticleById', 'articles.js doit relire une fiche article par id');
  assertIncludes(articlesJs, "url.searchParams.delete('edit')", 'Le parametre edit doit etre nettoye apres ouverture');
  assertIncludes(articlesJs, "article_category: articleBusinessCategoryInput.value || 'product'", 'La categorie doit etre envoyee a la sauvegarde article');
  assertIncludes(articlesJs, 'refreshedArticle.article_category !== payload.article_category', 'La sauvegarde categorie doit etre verifiee apres relecture');

  assertNotIncludes(packingJs, 'sendEmail', 'Le frontend colisage ne doit pas envoyer d email');
  assertNotIncludes(packingDetailJs, 'sendEmail', 'Le detail colisage ne doit pas envoyer d email');
  assert(!fs.existsSync(path.join(ROOT, 'backend', 'db', 'gestion-commerciale', '107_packing_frontend.sql')), 'Aucune migration 107 attendue');

  console.log(JSON.stringify({
    ok: true,
    checked: [
      'home_entry',
      'packing_list',
      'packing_detail',
      'f9_consultation',
      'cost_columns',
      'article_edit_param',
      'article_category_reload_guard',
      'cache_busters',
      'no_migration',
    ],
  }, null, 2));
}

main();
