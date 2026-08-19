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
  const traceabilityHtml = read('frontend/traceability.html');
  const traceabilityJs = read('frontend/js/traceability.js');
  const traceabilityCss = read('frontend/css/pages/traceability.css');
  const traceabilityRoute = read('backend/routes/traceability.js');
  const productRecallService = read('backend/services/productRecallService.js');
  const stockMovementLabels = read('frontend/js/stock-movement-labels.js');
  const articlesHtml = read('frontend/articles.html');
  const articlesJs = read('frontend/js/articles.js');

  assertIncludes(homeHtml, 'href="./packing.html"', 'Home doit exposer le module Colisage');
  assertIncludes(homeHtml, 'data-module="packing"', 'Carte home Colisage manquante');

  assertIncludes(packingHtml, './css/pages/packing.css?v=3', 'Cache-buster CSS liste colisage manquant');
  assertIncludes(packingHtml, './js/packing.js?v=3', 'Cache-buster JS liste colisage manquant');
  assertIncludes(packingHtml, 'Nouvelle operation', 'Creation brouillon colisage manquante');
  assertIncludes(packingHtml, 'F9 : afficher les produits', 'Indication F9 produits manquante');
  ['Brouillon', 'Valide', 'Annule', 'Tous', 'Cout poisson', 'Cout emballage', 'PR/kg'].forEach((label) => {
    assertIncludes(packingHtml, label, `Liste colisage doit afficher ${label}`);
  });

  assertIncludes(packingJs, "api('/api/packing", 'Liste colisage doit appeler /api/packing');
  assertIncludes(packingJs, 'ARTICLE_PAGE_SIZE = 500', 'Consultation F9 produits doit charger par pages');
  assertIncludes(packingJs, 'article_category=product&limit=${ARTICLE_PAGE_SIZE}&offset=${offset}', 'F9 produits doit paginer les products actifs');
  assertIncludes(packingJs, 'active=true&article_category=product', 'F9 produits doit filtrer uniquement les products actifs');
  assertIncludes(packingJs, 'while (Array.isArray(page) && page.length === ARTICLE_PAGE_SIZE)', 'F9 produits ne doit pas couper silencieusement la liste');
  assertIncludes(packingJs, 'article-result-search', 'Popup F9 article doit contenir une recherche interne');
  assertIncludes(packingJs, 'queryOverride', 'Recherche F9 article doit pouvoir filtrer sans fermer la popup');
  assertIncludes(packingJs, "event.target.matches('#article-result-search')", 'Recherche F9 article doit reagir a la saisie et Entree');
  assertIncludes(packingJs, '&search=${encodeURIComponent(query)}', 'Recherche article manuelle manquante');
  assertIncludes(packingJs, "event.key === 'F9'", 'F9 doit etre gere sur article produit');
  assertIncludes(packingJs, 'event.preventDefault();', 'F9 doit appeler preventDefault');
  assertIncludes(packingJs, 'Number.isInteger(packageCount)', 'package_count doit etre controle entier cote frontend');

  assertIncludes(packingDetailHtml, './css/pages/packing-detail.css?v=2', 'Cache-buster CSS detail colisage manquant');
  assertIncludes(packingDetailHtml, './js/packing-detail.js?v=2', 'Cache-buster JS detail colisage manquant');
  assertIncludes(packingDetailHtml, 'Lots poisson source', 'Bloc lots source manquant');
  assertIncludes(packingDetailHtml, 'Emballages / consommables', 'Bloc emballages manquant');
  assertIncludes(packingDetailHtml, 'Valider colisage', 'Action validation manquante');
  assertIncludes(packingDetailHtml, 'F9 : afficher les lots', 'Indication F9 lots manquante');
  assertIncludes(packingDetailHtml, 'lot-action-header', 'Popup lots doit prevoir la colonne quantite/action');
  assertIncludes(packingDetailHtml, 'Ajouter les lots selectionnes', 'Bouton ajout groupe lots source manquant');
  assertIncludes(packingDetailHtml, 'Completer automatiquement', 'Bouton auto-completion lots source manquant');

  assertIncludes(packingDetailJs, '/api/stock/lots?', 'Recherche lots doit reutiliser /api/stock/lots');
  assertIncludes(packingDetailJs, "params.set('article_category', state.lineMode === 'source' ? 'product' : 'packaging')", 'Lots source/product et emballages/packaging doivent etre separes');
  assertIncludes(packingDetailJs, "params.set('available_only', 'true')", 'Recherche lots doit viser le stock disponible');
  assertIncludes(packingDetailJs, "params.set('exclude_blocked_quality', 'true')", 'Recherche lots doit exclure les lots bloques qualite');
  assertIncludes(packingDetailJs, "params.set('limit', '100')", 'Recherche lots doit rester limitee');
  assertIncludes(packingDetailJs, "event.key === 'F9'", 'F9 doit etre gere sur les lots');
  assertIncludes(packingDetailJs, 'event.preventDefault();', 'F9 lots doit appeler preventDefault');
  assertIncludes(packingDetailJs, '/source-lots', 'Ajout/suppression lots source manquant');
  assertIncludes(packingDetailJs, 'source-quantity-input', 'Popup lots source doit afficher un input par ligne');
  assertIncludes(packingDetailJs, 'selectedSourceLotsFromInputs', 'Selection multi-lots source manquante');
  assertIncludes(packingDetailJs, 'addSelectedSourceLots', 'Ajout groupe lots source manquant');
  assertIncludes(packingDetailJs, 'quantity - line.stock > 0.0001', 'Validation frontend quantite > stock manquante');
  assertIncludes(packingDetailJs, 'renderSourceSelectionSummary', 'Somme live lots source manquante');
  assertIncludes(packingDetailJs, 'const remaining = target - selected - popup', 'Calcul reste apres ajout incorrect');
  assertIncludes(packingDetailJs, 'await loadOperation();', 'Operation doit etre rechargee apres ajout groupe');
  assertIncludes(packingDetailJs, '/materials', 'Ajout/suppression emballages manquant');
  assertIncludes(packingDetailJs, '/validate', 'Validation colisage manquante');
  assertIncludes(packingDetailJs, '/cancel', 'Annulation colisage manquante');
  assertIncludes(packingDetailJs, 'PACKING_SOURCE_LOT_BLOCKED', 'Erreur lot source bloquee non mappee');
  assertIncludes(packingDetailJs, 'PACKING_MATERIAL_STOCK_INSUFFICIENT', 'Erreur stock emballage non mappee');
  assertIncludes(packingDetailJs, "operation.status !== 'draft'", 'Mode readonly hors brouillon manquant');
  assertIncludes(read('backend/routes/stock.js'), "COALESCE(l.quality_status, 'released') <> 'blocked'", 'Endpoint stock/lots doit supporter exclusion des lots bloques');

  assertIncludes(articlesHtml, './js/articles.js?v=19', 'Cache-buster articles.js doit etre incremente');
  assertIncludes(articlesJs, 'openArticleFromEditParam', 'articles.html doit traiter ?edit=');
  assertIncludes(articlesJs, 'fetchArticleById', 'articles.js doit relire une fiche article par id');
  assertIncludes(articlesJs, "url.searchParams.delete('edit')", 'Le parametre edit doit etre nettoye apres ouverture');
  assertIncludes(articlesJs, "article_category: articleBusinessCategoryInput.value || 'product'", 'La categorie doit etre envoyee a la sauvegarde article');
  assertIncludes(articlesJs, 'assertArticleSaveConsistency(refreshedArticle, payload)', 'La sauvegarde categorie doit etre verifiee apres relecture');

  assertIncludes(traceabilityHtml, './css/pages/traceability.css?v=3', 'Cache-buster CSS tracabilite attendu');
  assertIncludes(traceabilityHtml, './js/stock-movement-labels.js?v=1', 'Libelles mouvements centralises doivent etre charges');
  assertIncludes(traceabilityHtml, './js/traceability.js?v=8', 'Cache-buster traceability.js attendu');
  assertIncludes(traceabilityRoute, 'async function fetchPackingTrace', 'Backend tracabilite doit exposer les liens colisage');
  assertIncludes(traceabilityRoute, 'po.output_lot_id = $2::uuid', 'Trace output lot -> operation colisage manquante');
  assertIncludes(traceabilityRoute, 'FROM packing_source_lots psl', 'Trace lots source colisage manquante');
  assertIncludes(traceabilityRoute, 'FROM packing_materials pm', 'Trace emballages colisage manquante');
  assertIncludes(traceabilityRoute, 'packing_trace: packingTrace', 'Reponse detail lot doit inclure packing_trace');
  assertIncludes(traceabilityJs, 'renderPackingTrace', 'Front tracabilite doit rendre la carte Colisage');
  assertIncludes(traceabilityJs, 'renderPackingSources', 'Front tracabilite doit afficher les lots source');
  assertIncludes(traceabilityJs, 'renderPackingMaterials', 'Front tracabilite doit afficher les emballages');
  assertIncludes(traceabilityJs, "data-action=\"open-lot-detail\"", 'Lots source/output doivent etre cliquables');
  assertIncludes(traceabilityCss, 'trace-packing-summary', 'Styles carte colisage manquants');
  assertIncludes(productRecallService, 'fetchRecallDeliveryRows', 'Rappel doit suivre les output lots issus de colisage');
  assertIncludes(productRecallService, 'via_packing_operation_id', 'Analyse rappel doit conserver le lien source -> colisage -> output');
  assertIncludes(stockMovementLabels, 'packing_source_out', 'Libelle mouvement packing_source_out manquant');
  assertIncludes(stockMovementLabels, 'packing_material_out', 'Libelle mouvement packing_material_out manquant');
  assertIncludes(stockMovementLabels, 'packing_output_in', 'Libelle mouvement packing_output_in manquant');

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
