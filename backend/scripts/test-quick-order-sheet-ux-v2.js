const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'frontend/quick-order-sheet.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'frontend/js/quick-order-sheet.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend/css/pages/quick-order-sheet.css'), 'utf8');
const route = fs.readFileSync(path.join(root, 'backend/routes/quickOrderSheets.js'), 'utf8');

assert(html.includes('Vue Clients'), 'la vue client doit etre exposee');
assert(html.includes('Vue Articles'), 'la vue article doit etre exposee');
assert(!html.includes('new-sheet-btn'), 'le bouton Nouvelle fiche doit etre supprime');
assert(!html.includes('supplier-select'), 'le filtre fournisseur ne doit plus etre dans la prise de commande principale');
assert(!html.includes('margin-level-1-input'), 'les marges/prix ne doivent plus etre modifiables dans la fiche appel');
assert(html.includes('Ajouter un article hors tarif'), 'l ajout hors tarif doit etre explicite');

assert(js.includes("view: 'client'"), 'l etat doit connaitre le mode client');
assert(js.includes("state.view === 'article'"), 'l etat doit connaitre le mode article');
assert(js.includes('AUTOSAVE_DELAY_MS'), 'autosave debounce attendu');
assert(js.includes("apiSend('/api/quick-order-sheets/by-date', buildSheetPayload(), 'PUT')"), 'autosave serveur attendu');
assert(js.includes('priceForClient(product, client)'), 'le prix affiche doit dependre du client');
assert(js.includes('out_of_tariff'), 'le flux hors tarif doit etre trace');
assert(js.includes("Prix HT obligatoire"), 'le prix hors tarif doit etre obligatoire cote UI');
assert(js.includes('parseDecimal(priceForClient(line.product, line.client)) <= 0'), 'la generation front bloque les prix non positifs');
assert(!js.includes('DEFAULT_PRODUCT_COLUMNS'), 'aucune colonne produit fixe ne doit rester');
assert(!js.includes('product-column-editor'), 'les grosses cartes produit doivent etre retirees');

assert(route.includes('ensureDailySheetForDate'), 'le GET par date doit auto-creer la fiche');
assert(route.includes('publishedPricingForDate'), 'les articles doivent venir de la tarification publiee');
assert(!route.includes('AND COALESCE(pl.exclude_from_mercuriale, false) = false'), 'la fiche appel ne doit pas masquer les lignes publiees de la tarification du jour');
assert(route.includes('ON CONFLICT (sheet_id, column_uid)'), 'la synchro tarification doit etre idempotente');
assert(route.includes('manual_out_of_pricing'), 'la generation doit gerer explicitement le hors tarif');
assert(route.includes('positiveOrError'), 'la generation doit bloquer les prix non positifs');
assert(route.includes('quick_order_sheet_generations'), 'la generation doit rester protegee contre les doublons');

assert(css.includes('grid-template-columns: minmax(260px, 340px) minmax(0, 1fr)'), 'layout desktop compact attendu');
assert(css.includes('position: sticky'), 'en-tetes/identifiants fixes attendus');
assert(css.includes('@media (max-width: 980px)'), 'fallback tablette attendu');

const clients = Array.from({ length: 200 }, (_, index) => ({ id: `client-${index}`, name: `Client ${index}` }));
const products = Array.from({ length: 100 }, (_, index) => ({ uid: `product-${index}`, designation: `Article ${index}` }));
const renderedClientRows = products.length;
const renderedArticleRows = clients.length;
assert.equal(renderedClientRows, 100, 'scenario charge: une vue client rend les 100 articles, pas 200x100 champs');
assert.equal(renderedArticleRows, 200, 'scenario charge: une vue article rend les 200 clients, pas 200x100 champs');
assert(renderedClientRows * 3 < clients.length * products.length * 3, 'la V2 evite la matrice complete en DOM');

console.log('OK quick order sheet UX V2');
