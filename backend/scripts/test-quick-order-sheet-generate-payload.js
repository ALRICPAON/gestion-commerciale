const assert = require('assert');
const fs = require('fs');
const path = require('path');

const quickOrderSheetsRoute = require('../routes/quickOrderSheets');

const root = path.resolve(__dirname, '..', '..');
const js = fs.readFileSync(path.join(root, 'frontend/js/quick-order-sheet.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'frontend/quick-order-sheet.html'), 'utf8');
const route = fs.readFileSync(path.join(root, 'backend/routes/quickOrderSheets.js'), 'utf8');

function uuid(prefix, index) {
  return `${prefix}0000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function bodyBytes(body) {
  return Buffer.byteLength(JSON.stringify(body), 'utf8');
}

function buildLegacyPayload() {
  const clients = Array.from({ length: 200 }, (_, index) => ({
    id: uuid('c', index + 1),
    code: `CL${String(index + 1).padStart(4, '0')}`,
    name: `Client ${index + 1}`,
    legal_name: `Client ${index + 1}`,
    city: index % 2 ? 'Lyon' : 'Paris',
    tariff_level: (index % 3) + 1,
    store_identifier: `S${index + 1}`,
  }));
  const products = Array.from({ length: 100 }, (_, index) => ({
    uid: `pricing-${uuid('a', index + 1)}`,
    column_uid: `pricing-${uuid('a', index + 1)}`,
    article_id: uuid('a', index + 1),
    plu: `PLU${String(index + 1).padStart(4, '0')}`,
    designation: `Article ${index + 1}`,
    supplier_id: uuid('f', (index % 12) + 1),
    supplier_code: `FOU${(index % 12) + 1}`,
    supplier_name: `Fournisseur ${(index % 12) + 1}`,
    purchase_price_ht: 8 + index / 10,
    transport_cost_ht: 0.7,
    cost_rendered_ht: 8.7 + index / 10,
    sale_price_level_1_ht: 14 + index / 10,
    sale_price_level_2_ht: 13 + index / 10,
    sale_price_level_3_ht: 12 + index / 10,
    tariff_prices: [
      { legacy_level: 1, price_ht: 14 + index / 10, source: 'published_pricing' },
      { legacy_level: 2, price_ht: 13 + index / 10, source: 'published_pricing' },
      { legacy_level: 3, price_ht: 12 + index / 10, source: 'published_pricing' },
    ],
    pricing_session_id: uuid('p', 1),
    pricing_line_id: uuid('l', index + 1),
    family_code: 'MAREE',
    family_name: 'Maree',
    sale_unit: 'kg',
    unit: 'kg',
    display_order: index + 1,
  }));
  const entries = {};
  for (let clientIndex = 0; clientIndex < clients.length; clientIndex += 1) {
    const client = clients[clientIndex];
    entries[client.id] = {};
    for (let productIndex = 0; productIndex < 10; productIndex += 1) {
      entries[client.id][products[productIndex].uid] = {
        colis: String((clientIndex % 3) + 1),
        kg: String(1 + productIndex / 10),
        pieces: '',
      };
    }
  }
  return {
    sheet_id: uuid('s', 1),
    title: "Fiche d'appel clients",
    date: '2026-09-07',
    notes: 'Simulation 200 clients / 100 articles',
    clients,
    products,
    entries,
    confirm_generate: true,
    force_regenerate: false,
  };
}

async function testServerGenerationSheetFromDatabase() {
  const sheetId = uuid('s', 1);
  const storeId = uuid('t', 1);
  const articleId = uuid('a', 1);
  const clientId = uuid('c', 1);
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('FROM quick_order_sheets')) {
        return {
          rows: [{
            id: sheetId,
            store_id: storeId,
            sheet_date: '2026-09-07',
            title: "Fiche d'appel clients",
            notes: 'Serveur canonique',
            supplier_id: null,
            selected_client_ids: [],
            order_entries: {
              [clientId]: {
                [`pricing-${articleId}`]: { colis: '2', kg: '3.5', pieces: '' },
              },
            },
          }],
        };
      }
      if (sql.includes('FROM quick_order_sheet_products')) {
        return {
          rows: [{
            id: uuid('q', 1),
            store_id: storeId,
            sheet_id: sheetId,
            column_uid: `pricing-${articleId}`,
            article_id: articleId,
            supplier_id: uuid('f', 1),
            plu: 'HOMARD',
            designation_snapshot: 'HOMARD EUROPEEN 600/800',
            display_order: 1,
            sale_price_level_1_ht: 21.9,
            sale_price_level_2_ht: 20.9,
            sale_price_level_3_ht: 19.9,
            pricing_line_id: uuid('l', 1),
            supplier_available_quantity: 50,
          }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const sheet = await quickOrderSheetsRoute._getSheetForGenerationForTest(db, storeId, sheetId);
  const lines = quickOrderSheetsRoute._sheetLinesForTest(sheet);

  assert.strictEqual(sheet.sheet_id, sheetId);
  assert.strictEqual(sheet.clients.length, 1);
  assert.strictEqual(sheet.products.length, 1);
  assert.strictEqual(sheet.products[0].uid, `pricing-${articleId}`);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].quantity, 7);
  assert.strictEqual(queries[0].params[0], storeId);
  assert.strictEqual(queries[0].params[1], sheetId);
  assert.match(queries[0].sql, /WHERE store_id = \$1 AND id = \$2/);
}

(async () => {
  const legacyPayload = buildLegacyPayload();
  const nextPayload = {
    sheet_id: legacyPayload.sheet_id,
    confirm_generate: true,
    force_regenerate: false,
  };
  const legacyBytes = bodyBytes(legacyPayload);
  const nextBytes = bodyBytes(nextPayload);

  assert(legacyBytes > 200000, `legacy payload should be large enough to reproduce risk, got ${legacyBytes}`);
  assert(nextBytes < 200, `generation payload should stay tiny, got ${nextBytes}`);
  assert(!Object.prototype.hasOwnProperty.call(nextPayload, 'clients'));
  assert(!Object.prototype.hasOwnProperty.call(nextPayload, 'products'));
  assert(!Object.prototype.hasOwnProperty.call(nextPayload, 'order_entries'));
  assert(!Object.prototype.hasOwnProperty.call(nextPayload, 'entries'));

  assert(html.includes('./js/quick-order-sheet.js?v=12'), 'cache-buster quick-order-sheet attendu en v12');
  assert(js.includes('flushPendingAutosave'), 'generateOrders doit flusher les autosaves');
  assert(js.includes("Impossible de generer les commandes : certaines saisies ne sont pas encore enregistrees."), 'message blocage flush attendu');
  assert(js.includes("sheet_id: state.sheet?.id"), 'generateOrders doit envoyer sheet_id');
  assert(js.includes("els.generate?.addEventListener('click', () => generateOrders(false))"), 'le clic generation ne doit pas passer l evenement comme force_regenerate');
  assert(!js.includes('...buildSheetPayload()'), 'generateOrders ne doit plus envoyer le payload complet');
  assert(route.includes('getSheetForGeneration'), 'route generate-orders doit charger la fiche serveur');
  assert(route.includes("source: 'database'"), 'route generate-orders doit tracer la source database');
  assert(route.includes('quick_order_sheet_generations'), 'protection anti-doublon conservee');
  assert(route.includes('can_regenerate: true'), 'regeneration controlee conservee');
  assert(route.includes('positiveOrError'), 'blocage prix strictement positif conserve');

  await testServerGenerationSheetFromDatabase();

  console.log(JSON.stringify({
    ok: true,
    legacy_generate_payload_bytes: legacyBytes,
    incremental_generate_payload_bytes: nextBytes,
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
