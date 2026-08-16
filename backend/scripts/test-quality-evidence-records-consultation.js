const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  evidenceStatusLabel,
  evidenceTypeLabel,
  getQualityEvidenceRecord,
  listQualityEvidenceRecords,
  publicEvidence,
} = require('../services/quality/evidenceRecords');

const ROOT = path.resolve(__dirname, '..', '..');
const STORE_A = '50000000-0000-4000-8000-000000000001';
const STORE_B = '50000000-0000-4000-8000-000000000002';
const EVENT_A = '50000000-0000-4000-8000-000000000101';
const EVIDENCE_A = '50000000-0000-4000-8000-000000000201';
const EVIDENCE_B = '50000000-0000-4000-8000-000000000202';

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function sampleEvidence(overrides = {}) {
  return {
    id: EVIDENCE_A,
    store_id: STORE_A,
    quality_event_id: EVENT_A,
    evidence_type: 'reception_record',
    evidence_status: 'recorded',
    evidence_at: '2026-08-16T08:54:00.000Z',
    recorded_at: '2026-08-16T08:54:01.000Z',
    recorded_by_email: 'qualite@example.test',
    source_type: 'automatic',
    source_record_type: 'purchases',
    source_record_id: '50000000-0000-4000-8000-000000000301',
    source_discriminator: 'reception_record',
    event_type: 'purchase_received',
    source_table: 'purchases',
    source_id: '50000000-0000-4000-8000-000000000301',
    occurred_at: '2026-08-16T08:54:00.000Z',
    archived_at: null,
    payload: {
      identification: {
        supplier_name: 'ROYALE MAREE',
        supplier_code: '81269',
        bl_number: 'BL-REAL',
        receipt_date: '2026-08-16',
        received_at: '2026-08-16T08:54:00.000Z',
      },
      received_products: [
        {
          article_designation: 'DOS DE CABILLAUD',
          article_plu: '3063',
          received_colis: 1,
          received_quantity: 3,
          price_unit: 'kg',
          lot_code: 'LOT-ALTA',
          supplier_lot_number: 'LOT-SUP',
          dlc: null,
          traceability: {
            latin_name: 'GADUS MORHUA',
            fao_zone: 'FAO 27 V',
            fishing_gear: 'CHALUT',
          },
        },
      ],
      documents: { sanitary_photo_urls: [] },
      controls: {
        temperature: { status: 'not_available_in_purchase_reception_flow' },
        observations: { status: 'partial', value: 'RAS' },
      },
    },
    ...overrides,
  };
}

class FakeDb {
  constructor(rows) {
    this.rows = rows;
    this.calls = [];
  }

  async query(sql, params = []) {
    this.calls.push({ sql: String(sql), params });
    if (String(sql).includes('LIMIT $')) {
      const storeId = params[0];
      const searchParam = params.find((value) => typeof value === 'string' && value.startsWith('%'));
      let rows = this.rows.filter((row) => row.store_id === storeId && !row.archived_at);
      const type = params.find((value) => value === 'reception_record' || value === 'unknown_future_type');
      if (type) rows = rows.filter((row) => row.evidence_type === type);
      if (searchParam) {
        const needle = searchParam.replace(/%/g, '').toLowerCase();
        rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(needle));
      }
      return { rows };
    }
    if (String(sql).includes('WHERE er.id = $1::uuid')) {
      const [id, storeId] = params;
      return { rows: this.rows.filter((row) => row.id === id && row.store_id === storeId && !row.archived_at) };
    }
    throw new Error('Unexpected SQL');
  }
}

async function main() {
  const route = read('backend/routes/quality/evidenceRecords.js');
  const index = read('backend/routes/quality/index.js');
  const dashboard = read('frontend/quality/pages/dashboard.html');
  const page = read('frontend/quality/pages/evidence-records.html');
  const frontend = read('frontend/quality/js/evidence-records.js');
  const temperaturePage = read('frontend/quality/pages/temperature-records.html');
  const cleaningPage = read('frontend/quality/pages/cleaning-records.html');

  assert(route.includes('router.use(authenticateToken, attachDbContext)'), 'Authentification API obligatoire manquante');
  assert(route.includes('requireQualityPermission(QUALITY_PERMISSIONS.READ)'), 'Permission quality.read manquante');
  assert(index.includes("router.use('/evidence-records', evidenceRecordRoutes)"), 'Route evidence-records non montee');
  assert(dashboard.includes('href="./evidence-records.html"'), 'Carte Enregistrements manquante');
  assert(dashboard.includes('Consulter les ENR et preuves qualite.'), 'Description carte incorrecte');
  assert(page.includes('Historique des ENR et preuves generes par les operations metier ALTA.'), 'Sous-titre Enregistrements incorrect');
  assert(page.includes('evidence-record-summary'), 'Cartes de synthese Enregistrements manquantes');
  assert(page.includes('evidence-record-document-links'), 'Bloc documents applicables manquant');
  assert(page.includes('quality-document-links.js'), 'Mecanisme documentaire Qualite non charge');
  assert(page.includes('evidence-record-export-csv'), 'Export CSV Enregistrements manquant');
  assert(page.includes('<th>Date/heure</th>'), 'Colonne Date/heure manquante');
  assert(page.includes('<th>Type</th>'), 'Colonne Type manquante');
  assert(page.includes('<th>Reference</th>'), 'Colonne Reference manquante');
  assert(page.includes('<th>Origine</th>'), 'Colonne Origine manquante');
  assert(page.includes('<th>Resume</th>'), 'Colonne Resume manquante');
  assert(page.includes('<th>Statut</th>'), 'Colonne Statut manquante');
  assert(frontend.includes('/api/quality/evidence-records'), 'Frontend ne cible pas API evidence-records');
  assert(frontend.includes('Reception fournisseur'), 'Libelle reception_record manquant');
  assert(frontend.includes('Non renseigne'), 'Traduction not_available manquante');
  assert(frontend.includes('humanize'), 'Fallback type inconnu manquant');
  assert(frontend.includes('DOCUMENT_TARGETS_BY_TYPE'), 'Couche mapping documentaire maintenable manquante');
  assert(frontend.includes('QualityDocumentLinks.render'), 'Documents applicables non reutilises');
  assert(frontend.includes('renderProductsTable'), 'Table produits recus manquante');
  assert(frontend.includes('Tracabilite'), 'Bloc tracabilite manquant');
  assert(frontend.includes('Documents / preuves'), 'Bloc documents/preuves manquant');
  assert(frontend.includes('openProtectedUrl'), 'Ouverture securisee des preuves manquante');
  assert(frontend.includes('exportCsv'), 'Export CSV frontend manquant');
  assert(frontend.includes('date_heure') && frontend.includes('reference') && !frontend.includes('JSON.stringify(record.payload'), 'Export CSV doit rester lisible sans JSON brut');
  assert(!frontend.includes("data-action=\"delete\""), 'Action suppression interdite sur les preuves');
  assert(!frontend.includes("data-action=\"archive\""), 'Action archivage interdite sur les preuves');
  assert(!frontend.includes("data-action=\"validate\""), 'Action validation interdite sur les preuves');
  assert(!frontend.includes('fetch(`${API_BASE_URL}/api/quality/evidence-records${path}`, {\n      method:'), 'Frontend ne doit pas ecrire sur les preuves');
  assert(temperaturePage.includes('temperature-record-table-body'), 'Historique temperatures doit rester present');
  assert(cleaningPage.includes('cleaning-record-table-body'), 'Historique nettoyages doit rester present');

  assert.equal(evidenceTypeLabel('reception_record'), 'Reception fournisseur');
  assert.equal(evidenceStatusLabel('recorded'), 'Enregistre');
  assert.equal(evidenceTypeLabel('unknown_future_type'), 'Unknown Future Type');

  const rowA = sampleEvidence();
  const rowB = sampleEvidence({ id: EVIDENCE_B, store_id: STORE_B });
  const incomplete = sampleEvidence({
    id: '50000000-0000-4000-8000-000000000203',
    evidence_type: 'unknown_future_type',
    payload: {},
  });
  const db = new FakeDb([rowA, rowB, incomplete]);

  const list = await listQualityEvidenceRecords(db, STORE_A, {});
  assert.equal(list.length, 2, 'Liste store A doit exclure store B');
  assert(list.every((item) => item.store_id === STORE_A), 'Isolation store_id liste incorrecte');
  assert.equal(list[0].type_label, 'Reception fournisseur');
  assert.equal(list[0].status_label, 'Enregistre');
  assert.equal(list[0].reference_label, 'ROYALE MAREE');
  assert.equal(list[0].origin_label, 'Achat / reception');
  assert.equal(list[0].summary_label, 'DOS DE CABILLAUD - 3 kg');

  const detail = await getQualityEvidenceRecord(db, STORE_A, EVIDENCE_A);
  assert(detail, 'Detail preuve existante introuvable');
  assert.equal(detail.payload.received_products[0].article_plu, '3063', 'Detail snapshot PLU manquant');
  assert.equal(detail.payload.received_products[0].traceability.latin_name, 'GADUS MORHUA', 'Detail traceabilite manquant');

  const missing = await getQualityEvidenceRecord(db, STORE_A, '50000000-0000-4000-8000-000000009999');
  assert.equal(missing, null, 'Preuve inexistante doit retourner null');

  const crossStore = await getQualityEvidenceRecord(db, STORE_A, EVIDENCE_B);
  assert.equal(crossStore, null, 'Preuve autre store doit etre inaccessible');

  const filtered = await listQualityEvidenceRecords(db, STORE_A, { evidence_type: 'reception_record', search: 'cabil' });
  assert.equal(filtered.length, 1, 'Filtre type/recherche doit trouver reception_record');

  const partial = publicEvidence(incomplete);
  assert.equal(partial.reference_label, 'purchases', 'Payload incomplet doit garder un fallback lisible');
  assert.equal(partial.type_label, 'Unknown Future Type', 'Type inconnu doit avoir un fallback lisible');

  const multiProduct = publicEvidence(sampleEvidence({
    payload: {
      ...sampleEvidence().payload,
      received_products: [
        sampleEvidence().payload.received_products[0],
        { article_designation: 'FILET DE LIEU', article_plu: '3099', received_colis: 2, received_quantity: 6, price_unit: 'kg' },
      ],
      documents: {},
    },
  }));
  assert.equal(multiProduct.payload.received_products.length, 2, 'Snapshot multi-produits doit rester disponible pour le tableau detail');
  assert.deepEqual(multiProduct.payload.documents, {}, 'Absence document/photo doit rester lisible et non bloquante');

  console.log(JSON.stringify({
    ok: true,
    list_route: 'GET /api/quality/evidence-records',
    detail_route: 'GET /api/quality/evidence-records/:id',
    store_isolation: true,
    reception_record_rendering: true,
    incomplete_payload_fallback: true,
    unknown_type_fallback: true,
    multiple_product_rows: true,
    missing_document_photo: true,
    applicable_documents_block: true,
    readonly_actions: true,
    csv_export: true,
    temperature_history_preserved: true,
    cleaning_history_preserved: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
