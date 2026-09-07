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

async function testServerGenerationSheetFromDatabase(sheetDate, expectedDate) {
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
            sheet_date: sheetDate,
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
  assert.strictEqual(sheet.sheet_date, expectedDate);
  assert.strictEqual(sheet.clients.length, 1);
  assert.strictEqual(sheet.products.length, 1);
  assert.strictEqual(sheet.products[0].uid, `pricing-${articleId}`);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].quantity, 7);
  assert.strictEqual(queries[0].params[0], storeId);
  assert.strictEqual(queries[0].params[1], sheetId);
  assert.match(queries[0].sql, /WHERE store_id = \$1 AND id = \$2/);
  assert.match(queries[0].sql, /to_char\(sheet_date, 'YYYY-MM-DD'\) AS sheet_date/);
}

async function testDraftGeneratedOrderLookupSql() {
  const queries = [];
  const storeId = uuid('t', 1);
  const sheetId = uuid('s', 1);
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      return {
        rows: [
          { id: uuid('d', 1), client_id: uuid('c', 1), reference_number: 'CMD-1', created_at: '2026-09-07T08:00:00Z' },
          { id: uuid('d', 2), client_id: uuid('c', 2), reference_number: 'CMD-2', created_at: '2026-09-07T09:00:00Z' },
        ],
      };
    },
  };
  const byClient = await quickOrderSheetsRoute._fetchDraftGeneratedOrdersByClientForTest(db, storeId, sheetId);
  assert.strictEqual(byClient.size, 2);
  assert.strictEqual(queries.length, 1);
  assert.deepStrictEqual(queries[0].params, [storeId, sheetId]);
  assert.match(queries[0].sql, /SELECT DISTINCT ON \(sd\.client_id\) sd\.id, sd\.client_id, sd\.reference_number, sd\.created_at/);
  assert.match(queries[0].sql, /ORDER BY sd\.client_id, sd\.created_at ASC/);
}

function testBusinessDateNormalization() {
  const safeDate = quickOrderSheetsRoute._safeDateForTest;

  assert.strictEqual(safeDate('2026-09-07'), '2026-09-07');
  assert.strictEqual(safeDate('2026-09-08'), '2026-09-08');
  assert.strictEqual(safeDate('2026-09-08T00:00:00.000Z'), '2026-09-08');
  assert.strictEqual(safeDate(new Date(2026, 8, 7)), '2026-09-07');
  assert.strictEqual(safeDate(new Date(2026, 8, 8)), '2026-09-08');
  assert.notStrictEqual(safeDate(new Date(2026, 8, 8)), '2026-09-07');
  assert.notStrictEqual(safeDate(new Date(2026, 8, 7)), 'Mon Sep 07');
}

function testRoyaleMareeOrderTargetRequiresBilledClient() {
  const orderTarget = quickOrderSheetsRoute._orderTargetForClientForTest;
  const directLeclerc = orderTarget({
    id: 'client-88',
    code: '88',
    name: '88.E.LECLERC SODIVARDIERE',
    tariff_level: 2,
    vat_rate: 5.5,
    is_vat_exempt: false,
    parent_client_id: 'rm-parent',
    parent_client_code: 'RM-88',
    parent_client_name: 'E.LECLERC SODIVARDIERE',
    parent_tariff_level: 1,
    billed_client_id: 'client-88',
    billed_client_code: '88',
    billed_client_name: '88.E.LECLERC SODIVARDIERE',
  });
  assert.strictEqual(directLeclerc.flow, 'classic');
  assert.strictEqual(directLeclerc.documentClientId, 'client-88');
  assert.strictEqual(directLeclerc.tariffLevel, 2);

  const billedRoyale = orderTarget({
    id: 'store-88',
    code: '88',
    name: '88.E.LECLERC SODIVARDIERE',
    tariff_level: 2,
    vat_rate: 5.5,
    is_vat_exempt: false,
    billed_client_id: 'rm-88',
    billed_client_code: 'RM-88',
    billed_client_name: 'E.LECLERC SODIVARDIERE',
    billed_tariff_level: 1,
    billed_vat_rate: 5.5,
    billed_is_vat_exempt: false,
  });
  assert.strictEqual(billedRoyale.flow, 'royale_maree');
  assert.strictEqual(billedRoyale.documentClientId, 'rm-88');
  assert.strictEqual(billedRoyale.tariffLevel, 1);
}

function testIncrementalGenerationCellIdentity() {
  const cellKey = quickOrderSheetsRoute._sheetCellKeyForTest;
  const fromSheet = quickOrderSheetsRoute._quantitySignatureFromSheetLineForTest;
  const fromGenerated = quickOrderSheetsRoute._quantitySignatureFromGeneratedLineForTest;
  const same = quickOrderSheetsRoute._sameQuantitySignatureForTest;
  const buildDelta = quickOrderSheetsRoute._buildGenerationDeltaForTest;
  const batchOrderIds = quickOrderSheetsRoute._generatedOrderIdsFromBatchesForTest;

  assert.strictEqual(cellKey('client-a', 'pricing-homard'), 'client-a::pricing-homard');
  assert.notStrictEqual(cellKey('client-a', 'pricing-homard'), cellKey('client-b', 'pricing-homard'));
  assert.notStrictEqual(cellKey('client-a', 'pricing-homard'), cellKey('client-a', 'pricing-sole'));

  const generatedTenKg = fromGenerated({
    article_id: 'article-homard',
    package_count: 2,
    weight_per_package: 5,
    total_weight: 10,
    sold_quantity: 10,
  });
  const currentTenKg = fromSheet({
    article: { id: 'article-homard' },
    packageCount: 2,
    weightPerPackage: 5,
    quantity: 10,
  });
  const currentTwelveKg = fromSheet({
    article: { id: 'article-homard' },
    packageCount: 2,
    weightPerPackage: 6,
    quantity: 12,
  });

  assert.strictEqual(same(generatedTenKg, currentTenKg), true, 'troisieme clic identique doit etre noop');
  assert.strictEqual(same(generatedTenKg, currentTwelveKg), false, 'quantite augmentee doit etre detectee');

  const group = { documentClientId: 'client-a' };
  const current = new Map([
    ['client-a::pricing-homard', { group, line: { article: { id: 'article-homard' }, product: { uid: 'pricing-homard' }, packageCount: 2, weightPerPackage: 5, quantity: 10 } }],
    ['client-c::pricing-sole', { group, line: { article: { id: 'article-sole' }, product: { uid: 'pricing-sole' }, packageCount: 1, weightPerPackage: 5, quantity: 5 } }],
  ]);
  const generated = new Map([
    ['client-a::pricing-homard', { id: 'line-a', sales_document_id: 'order-a', article_id: 'article-homard', package_count: 2, weight_per_package: 5, total_weight: 10, sold_quantity: 10, document_client_id: 'client-a', document_status: 'draft', source_client_id: 'client-a', column_uid: 'pricing-homard' }],
  ]);
  const firstDelta = buildDelta(current, generated);
  assert.strictEqual(firstDelta.created.length, 1, 'nouvelle cellule C doit etre creee');
  assert.strictEqual(firstDelta.unchanged.length, 1, 'cellule A inchangee doit rester intacte');
  assert.strictEqual(firstDelta.updated.length, 0);
  assert.strictEqual(firstDelta.conflicts.length, 0);

  const changedCurrent = new Map([
    ['client-a::pricing-homard', { group, line: { article: { id: 'article-homard' }, product: { uid: 'pricing-homard' }, packageCount: 2, weightPerPackage: 6, quantity: 12 } }],
  ]);
  const draftChange = buildDelta(changedCurrent, generated);
  assert.strictEqual(draftChange.updated.length, 1, 'quantite augmentee sur draft doit etre mise a jour');
  const lockedChange = buildDelta(changedCurrent, new Map([
    ['client-a::pricing-homard', { ...generated.get('client-a::pricing-homard'), document_status: 'validated' }],
  ]));
  assert.strictEqual(lockedChange.conflicts.length, 1, 'commande deja engagee ne doit pas etre modifiee silencieusement');

  const partialWithLockedChange = buildDelta(new Map([
    ['client-a::pricing-homard', { group, line: { article: { id: 'article-homard' }, product: { uid: 'pricing-homard' }, packageCount: 2, weightPerPackage: 6, quantity: 12 } }],
    ['client-b::pricing-sole', { group: { documentClientId: 'client-b' }, line: { article: { id: 'article-sole' }, product: { uid: 'pricing-sole' }, packageCount: 1, weightPerPackage: 5, quantity: 5 } }],
    ['client-c::pricing-langoustine', { group: { documentClientId: 'client-c' }, line: { article: { id: 'article-langoustine' }, product: { uid: 'pricing-langoustine' }, packageCount: 2, weightPerPackage: 4, quantity: 8 } }],
    ['client-d::pricing-tourteau', { group: { documentClientId: 'client-d' }, line: { article: { id: 'article-tourteau' }, product: { uid: 'pricing-tourteau' }, packageCount: 3, weightPerPackage: 3, quantity: 9 } }],
  ]), new Map([
    ['client-a::pricing-homard', { ...generated.get('client-a::pricing-homard'), document_status: 'validated' }],
  ]));
  assert.strictEqual(partialWithLockedChange.conflicts.length, 1, 'ancienne cellule engagee modifiee doit remonter en warning');
  assert.strictEqual(partialWithLockedChange.created.length, 3, 'les trois nouvelles cellules doivent rester generables');

  const sameClientNewCell = buildDelta(new Map([
    ['client-a::pricing-homard', { group, line: { article: { id: 'article-homard' }, product: { uid: 'pricing-homard' }, packageCount: 2, weightPerPackage: 5, quantity: 10 } }],
    ['client-a::pricing-sole', { group, line: { article: { id: 'article-sole' }, product: { uid: 'pricing-sole' }, packageCount: 1, weightPerPackage: 5, quantity: 5 } }],
  ]), new Map([
    ['client-a::pricing-homard', { ...generated.get('client-a::pricing-homard'), document_status: 'validated' }],
  ]));
  assert.strictEqual(sameClientNewCell.unchanged.length, 1, 'ancienne cellule engagee inchangee ne doit pas etre touchee');
  assert.strictEqual(sameClientNewCell.created.length, 1, 'nouvelle cellule meme client doit creer une nouvelle operation sure');

  const partialWithLockedDelete = buildDelta(new Map([
    ['client-b::pricing-sole', { group: { documentClientId: 'client-b' }, line: { article: { id: 'article-sole' }, product: { uid: 'pricing-sole' }, packageCount: 1, weightPerPackage: 5, quantity: 5 } }],
  ]), new Map([
    ['client-a::pricing-homard', { ...generated.get('client-a::pricing-homard'), document_status: 'validated' }],
  ]));
  assert.strictEqual(partialWithLockedDelete.conflicts.length, 1, 'suppression engagee doit remonter en warning');
  assert.strictEqual(partialWithLockedDelete.created.length, 1, 'nouvelle cellule doit rester generable malgre suppression engagee');

  const billedChanged = buildDelta(new Map([
    ['client-a::pricing-homard', { group: { documentClientId: 'rm-client-a' }, line: { article: { id: 'article-homard' }, product: { uid: 'pricing-homard' }, packageCount: 2, weightPerPackage: 5, quantity: 10 } }],
  ]), new Map([
    ['client-a::pricing-homard', { ...generated.get('client-a::pricing-homard'), document_client_id: 'client-a', document_status: 'draft' }],
  ]));
  assert.strictEqual(billedChanged.moved.length, 1, 'client direct -> billed RM doit deplacer la ligne draft');
  const billedChangedLocked = buildDelta(new Map([
    ['client-a::pricing-homard', { group: { documentClientId: 'client-a' }, line: { article: { id: 'article-homard' }, product: { uid: 'pricing-homard' }, packageCount: 2, weightPerPackage: 5, quantity: 10 } }],
  ]), new Map([
    ['client-a::pricing-homard', { ...generated.get('client-a::pricing-homard'), document_client_id: 'rm-client-a', document_status: 'validated' }],
  ]));
  assert.strictEqual(billedChangedLocked.conflicts.length, 1, 'RM -> direct sur commande non draft doit bloquer');
  assert.strictEqual(billedChangedLocked.conflicts[0].type, 'locked_existing_order');

  const unresolvedArticle = buildDelta(new Map([
    ['client-a::pricing-homard', { line: { client: { id: 'client-a' }, product: { uid: 'pricing-homard' } }, unresolved: 'article_not_found_or_inactive' }],
    ['client-c::pricing-sole', { group, line: { article: { id: 'article-sole' }, product: { uid: 'pricing-sole' }, packageCount: 1, weightPerPackage: 5, quantity: 5 } }],
  ]), generated);
  assert.strictEqual(unresolvedArticle.conflicts.length, 1, 'article inactif encore present ne doit pas etre supprime silencieusement');
  assert.strictEqual(unresolvedArticle.created.length, 1, 'autre cellule valide doit rester generable');
  assert.strictEqual(unresolvedArticle.deleted.length, 0);

  const unresolvedClient = buildDelta(new Map([
    ['client-a::pricing-homard', { line: { client: { id: 'client-a' }, product: { uid: 'pricing-homard' } }, unresolved: 'client_not_found_or_inactive' }],
  ]), generated);
  assert.strictEqual(unresolvedClient.conflicts.length, 1, 'client inactif encore present ne doit pas etre supprime silencieusement');
  assert.strictEqual(unresolvedClient.deleted.length, 0);

  const deletedDraft = buildDelta(new Map(), generated);
  assert.strictEqual(deletedDraft.deleted.length, 1, 'cellule supprimee sur draft doit etre supprimee');
  const deletedLocked = buildDelta(new Map(), new Map([
    ['client-a::pricing-homard', { ...generated.get('client-a::pricing-homard'), document_status: 'validated' }],
  ]));
  assert.strictEqual(deletedLocked.conflicts.length, 1, 'cellule supprimee sur commande engagee doit bloquer');

  const neverGeneratedEmpty = buildDelta(new Map(), new Map());
  assert.strictEqual(neverGeneratedEmpty.deleted.length, 0, 'fiche vide jamais generee doit etre noop');
  assert.strictEqual(neverGeneratedEmpty.conflicts.length, 0);

  assert.deepStrictEqual(batchOrderIds([
    { generated_order_ids: ['order-a', 'order-b'] },
    { generated_order_ids: ['order-b', 'order-c'] },
  ]), ['order-a', 'order-b', 'order-c']);
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

  assert(html.includes('./js/quick-order-sheet.js?v=14'), 'cache-buster quick-order-sheet attendu en v14');
  assert(js.includes('flushPendingAutosave'), 'generateOrders doit flusher les autosaves');
  assert(js.includes("Impossible de generer les commandes : certaines saisies ne sont pas encore enregistrees."), 'message blocage flush attendu');
  assert(js.includes("sheet_id: state.sheet?.id"), 'generateOrders doit envoyer sheet_id');
  assert(js.includes("els.generate?.addEventListener('click', () => generateOrders(false))"), 'le clic generation ne doit pas passer l evenement comme force_regenerate');
  assert(!js.includes("state.sheet?.generated_order_ids?.length && !state.isDirtySinceGeneration"), 'le front ne doit plus bloquer une generation delta deja sauvegardee');
  assert(js.includes('if (!lines.length && !generatedCount)'), 'le front doit autoriser la synchronisation d une fiche vide deja generee');
  assert(js.includes('Generation partielle'), 'le front doit afficher une generation partielle sans erreur globale');
  assert(js.includes('ancienne(s) saisie(s)'), 'le front doit afficher les conflits non appliques');
  assert(!js.includes('...buildSheetPayload()'), 'generateOrders ne doit plus envoyer le payload complet');
  assert(route.includes('getSheetForGeneration'), 'route generate-orders doit charger la fiche serveur');
  assert(route.includes("to_char(sheet_date, 'YYYY-MM-DD') AS sheet_date"), 'la date fiche DB doit etre lue en YYYY-MM-DD');
  assert(route.includes("source: 'database'"), 'route generate-orders doit tracer la source database');
  assert(route.includes('document_date: sheet.sheet_date'), 'la resolution tarifaire doit recevoir la date exacte de la fiche');
  assert(route.includes('sheet.sheet_date,'), 'l insertion commande doit utiliser la date exacte de la fiche');
  assert(route.includes('quick_order_sheet_generations'), 'protection anti-doublon conservee');
  assert(route.includes('DROP CONSTRAINT IF EXISTS quick_order_sheet_generations_store_id_sheet_id_key'), 'la generation doit autoriser plusieurs batches par fiche');
  assert(route.includes("source: 'delta'"), 'payload_snapshot doit tracer le delta genere');
  assert(route.includes('conflicts: delta.conflicts'), 'payload_snapshot doit conserver les conflits ignores du batch');
  assert(route.includes('fetchGeneratedSheetLines'), 'la generation delta doit relire les lignes deja generees');
  assert(route.includes('locked_existing_order'), 'les commandes engagees modifiees doivent etre signalees sans modification');
  assert(route.includes('document_client_id'), 'un changement de client facture doit etre detecte');
  assert(route.includes('lookup_conflict_existing_cell'), 'un lookup master inactif ne doit pas etre interprete comme suppression');
  assert(route.includes('can_regenerate: false'), 'les commandes engagees ne doivent pas proposer une regeneration destructive normale');
  assert(route.includes('partial: hasConflicts'), 'les conflits verrouilles ne doivent pas bloquer les operations sures');
  assert(route.includes('res.status(hasConflicts ? 200 : 201)'), 'une generation partielle doit repondre HTTP 200');
  assert(route.includes('noop: true'), 'un nouveau clic sans delta doit etre idempotent sans doublon');
  assert(route.includes('positiveOrError'), 'blocage prix strictement positif conserve');
  assert(route.includes('SELECT DISTINCT ON (sd.client_id) sd.id, sd.client_id, sd.reference_number, sd.created_at'), 'requete draft orders doit etre valide avec ORDER BY');
  assert(route.includes('ORDER BY sd.client_id, sd.created_at ASC'), 'DISTINCT ON doit ordonner par client puis date creation');

  testBusinessDateNormalization();
  testRoyaleMareeOrderTargetRequiresBilledClient();
  testIncrementalGenerationCellIdentity();
  await testDraftGeneratedOrderLookupSql();
  await testServerGenerationSheetFromDatabase('2026-09-07', '2026-09-07');
  await testServerGenerationSheetFromDatabase(new Date(2026, 8, 7), '2026-09-07');
  await testServerGenerationSheetFromDatabase('2026-09-08', '2026-09-08');
  await testServerGenerationSheetFromDatabase(new Date(2026, 8, 8), '2026-09-08');

  console.log(JSON.stringify({
    ok: true,
    legacy_generate_payload_bytes: legacyBytes,
    incremental_generate_payload_bytes: nextBytes,
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
