const assert = require('assert');

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function makeClients(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    code: `CL${String(index + 1).padStart(4, '0')}`,
    name: `Client actif ${index + 1}`,
    legal_name: `Client actif ${index + 1} SARL`,
    city: index % 2 ? 'Boulogne-sur-Mer' : 'Paris',
    parent_client_id: null,
    billed_client_id: null,
    tariff_level: (index % 3) + 1,
    is_royale_maree_member: index % 7 === 0,
    store_identifier: `MAG-${index + 1}`,
    affiliate_label: index % 5 === 0 ? 'Affilie' : '',
    affiliate_store_number: index % 5 === 0 ? `A-${index}` : '',
  }));
}

function makeProducts(count) {
  return Array.from({ length: count }, (_, index) => ({
    uid: `pricing-line-${index + 1}`,
    column_uid: `pricing-line-${index + 1}`,
    article_id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    plu: `PLU${String(index + 1).padStart(4, '0')}`,
    designation: `Article tarifie du jour ${index + 1}`,
    price: 10 + index / 10,
    supplier_id: index % 9 === 0 ? null : `20000000-0000-4000-8000-${String((index % 12) + 1).padStart(12, '0')}`,
    supplier_code: index % 9 === 0 ? '' : `FOU${(index % 12) + 1}`,
    supplier_name: index % 9 === 0 ? '' : `Fournisseur ${(index % 12) + 1}`,
    purchase_price_ht: 7 + index / 20,
    transport_cost_ht: 0.45,
    cost_rendered_ht: 7.45 + index / 20,
    supplier_available_quantity: 100 + index,
    stock: 100 + index,
    sale_price_level_1_ht: 12 + index / 10,
    sale_price_level_2_ht: 11.5 + index / 10,
    sale_price_level_3_ht: 11 + index / 10,
    family_code: `FAM${index % 8}`,
    family_name: `Famille ${index % 8}`,
    sale_unit: index % 4 === 0 ? 'piece' : 'kg',
    unit: index % 4 === 0 ? 'piece' : 'kg',
    pricing_session_id: 'pricing-session-large',
    pricing_line_id: `pricing-line-${index + 1}`,
    tariff_prices: [
      { legacy_level: 1, code: 'T1', name: 'Tarif 1', price_ht: 12 + index / 10, source: 'pricing' },
      { legacy_level: 2, code: 'T2', name: 'Tarif 2', price_ht: 11.5 + index / 10, source: 'pricing' },
      { legacy_level: 3, code: 'T3', name: 'Tarif 3', price_ht: 11 + index / 10, source: 'pricing' },
    ],
    out_of_tariff: false,
    removed_from_current_pricing: false,
    display_order: index + 1,
  }));
}

function makeEntries(clients, products, filledCount) {
  const entries = {};
  for (let index = 0; index < filledCount; index += 1) {
    const client = clients[index % clients.length];
    const product = products[index % products.length];
    if (!entries[client.id]) entries[client.id] = {};
    entries[client.id][product.uid] = {
      colis: String((index % 4) + 1),
      kg: String(1.5 + (index % 6) / 2),
      pieces: '',
    };
  }
  return entries;
}

const clients = makeClients(200);
const products = makeProducts(100);
const entries = makeEntries(clients, products, 240);

const legacyPayload = {
  sheet_id: '30000000-0000-4000-8000-000000000001',
  title: "Fiche d'appel clients",
  date: '2026-09-07',
  notes: 'Arrivage du jour avec beaucoup de clients et articles',
  clients,
  products,
  entries,
};

const oneCellPatch = {
  entries: [
    {
      client_id: clients[0].id,
      column_uid: products[0].uid,
      colis: '2',
      kg: '3.5',
      pieces: '',
    },
  ],
};

const twentyCellPatch = {
  entries: Array.from({ length: 20 }, (_, index) => ({
    client_id: clients[index].id,
    column_uid: products[index].uid,
    colis: String((index % 3) + 1),
    kg: String(2 + index / 10),
    pieces: '',
  })),
};

const report = {
  scenario: '200 clients / 100 articles / 240 cellules saisies',
  legacy_bytes: jsonBytes(legacyPayload),
  legacy_breakdown: {
    clients_bytes: jsonBytes(legacyPayload.clients),
    products_bytes: jsonBytes(legacyPayload.products),
    entries_bytes: jsonBytes(legacyPayload.entries),
  },
  one_cell_patch_bytes: jsonBytes(oneCellPatch),
  twenty_cell_patch_bytes: jsonBytes(twentyCellPatch),
};

assert(report.legacy_bytes > 100 * 1024, 'le payload historique doit depasser la limite Express par defaut dans ce scenario');
assert(report.one_cell_patch_bytes < 1024, 'un autosave cellule doit rester tres petit');
assert(report.twenty_cell_patch_bytes < 10 * 1024, 'un batch de 20 cellules doit rester raisonnable');
assert(!JSON.stringify(oneCellPatch).includes('Client actif'), 'un autosave cellule ne doit pas envoyer les clients');
assert(!JSON.stringify(oneCellPatch).includes('Article tarifie'), 'un autosave cellule ne doit pas envoyer les produits');

console.log(JSON.stringify(report, null, 2));
