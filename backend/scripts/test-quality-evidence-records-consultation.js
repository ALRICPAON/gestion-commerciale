const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  evidenceStatusLabel,
  evidenceTypeLabel,
  getQualityEvidenceRecord,
  listReceptionDownstreamDeliveries,
  listReceptionSupplierDocuments,
  listQualityEvidenceRecords,
  publicEvidence,
  receptionLotIds,
} = require('../services/quality/evidenceRecords');

const ROOT = path.resolve(__dirname, '..', '..');
const STORE_A = '50000000-0000-4000-8000-000000000001';
const STORE_B = '50000000-0000-4000-8000-000000000002';
const EVENT_A = '50000000-0000-4000-8000-000000000101';
const EVIDENCE_A = '50000000-0000-4000-8000-000000000201';
const EVIDENCE_B = '50000000-0000-4000-8000-000000000202';
const TRACE_EVIDENCE = '50000000-0000-4000-8000-000000000204';
const PURCHASE_A = '50000000-0000-4000-8000-000000000301';

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
    source_record_id: PURCHASE_A,
    source_discriminator: 'reception_record',
    event_type: 'purchase_received',
    source_table: 'purchases',
    source_id: PURCHASE_A,
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
          lot_id: '50000000-0000-4000-8000-000000000401',
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
  constructor(rows, downstreamRows = [], supplierDocumentRows = []) {
    this.rows = rows;
    this.downstreamRows = downstreamRows;
    this.supplierDocumentRows = supplierDocumentRows;
    this.calls = [];
  }

  async query(sql, params = []) {
    this.calls.push({ sql: String(sql), params });
    if (String(sql).includes('WITH purchase_document')) {
      const [storeId, purchaseId] = params;
      return {
        rows: this.supplierDocumentRows.filter((row) => row.store_id === storeId && (
          row.purchase_id === purchaseId
          || row.source_purchase_id === purchaseId
          || row.match_purchase_id === purchaseId
        )),
      };
    }
    if (String(sql).includes('FROM sale_line_allocations sla')) {
      const [storeId, lotIds] = params;
      return {
        rows: this.downstreamRows.filter((row) => row.store_id === storeId && lotIds.includes(row.lot_id)),
      };
    }
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
  assert(page.includes('traceability_test_record'), 'Filtre test de tracabilite manquant');
  assert(page.includes('evidence-records.js?v=6'), 'Cache-buster evidence-records attendu');
  assert(page.includes('<th>Date/heure</th>'), 'Colonne Date/heure manquante');
  assert(page.includes('<th>Type</th>'), 'Colonne Type manquante');
  assert(page.includes('<th>Reference</th>'), 'Colonne Reference manquante');
  assert(page.includes('<th>Origine</th>'), 'Colonne Origine manquante');
  assert(page.includes('<th>Resume</th>'), 'Colonne Resume manquante');
  assert(page.includes('<th>Statut</th>'), 'Colonne Statut manquante');
  assert(frontend.includes('/api/quality/evidence-records'), 'Frontend ne cible pas API evidence-records');
  assert(frontend.includes('Reception fournisseur'), 'Libelle reception_record manquant');
  assert(frontend.includes('Test de tracabilite'), 'Libelle traceability_test_record manquant');
  assert(frontend.includes('renderTraceabilityTestDetail'), 'Rendu detail test tracabilite manquant');
  assert(frontend.includes('Tracabilite aval'), 'Bloc aval test tracabilite manquant');
  assert(frontend.includes('Non renseigne'), 'Traduction not_available manquante');
  assert(frontend.includes("conform: 'Conforme'"), 'Libelle conforme manquant');
  assert(frontend.includes("non_conform: 'Non conforme'"), 'Libelle non conforme manquant');
  assert(frontend.includes("lot_isolation: 'Isolement du lot'"), 'Libelle action corrective manquant');
  assert(frontend.includes('value_c') && frontend.includes('Action corrective'), 'Rendu controle qualite reception incomplet');
  assert(frontend.includes('humanize'), 'Fallback type inconnu manquant');
  assert(frontend.includes('DOCUMENT_TARGETS_BY_TYPE'), 'Couche mapping documentaire maintenable manquante');
  assert(frontend.includes('QualityDocumentLinks.render'), 'Documents applicables non reutilises');
  assert(frontend.includes('renderProductsTable'), 'Table produits recus manquante');
  assert(frontend.includes('renderLinkedDocuments'), 'Bloc documents lies reception manquant');
  assert(frontend.includes('BL fournisseur'), 'Libelle BL fournisseur manquant');
  assert(frontend.includes('Documents fournisseur'), 'Bloc documents fournisseur manquant');
  assert(frontend.includes('Aucun document lié à cette réception.'), 'Message absence document fournisseur incorrect');
  assert(frontend.includes('Destination / BL aval'), 'Bloc destination aval manquant');
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
  assert.equal(evidenceTypeLabel('traceability_test_record'), 'Test de tracabilite');
  assert.equal(evidenceStatusLabel('recorded'), 'Enregistre');
  assert.equal(evidenceTypeLabel('unknown_future_type'), 'Unknown Future Type');

  const rowA = sampleEvidence();
  const rowB = sampleEvidence({ id: EVIDENCE_B, store_id: STORE_B });
  const incomplete = sampleEvidence({
    id: '50000000-0000-4000-8000-000000000203',
    evidence_type: 'unknown_future_type',
    payload: {},
  });
  const downstreamRows = [
    {
      store_id: STORE_A,
      lot_id: '50000000-0000-4000-8000-000000000401',
      lot_code: 'LOT-ALTA',
      supplier_lot_number: 'LOT-SUP',
      delivery_note_reference: 'BL-AVAL-1',
      delivery_date: '2026-08-17',
      delivered_client_name: 'E.LECLERC TEST',
      delivered_client_code: 'CLI-1',
      delivered_client_store_identifier: 'MAG-01',
      delivered_quantity: '2',
    },
    {
      store_id: STORE_A,
      lot_id: '50000000-0000-4000-8000-000000000401',
      lot_code: 'LOT-ALTA',
      supplier_lot_number: 'LOT-SUP',
      delivery_note_reference: 'BL-AVAL-2',
      delivery_date: '2026-08-18',
      delivered_client_name: 'INTERMARCHE TEST',
      delivered_client_code: 'CLI-2',
      delivered_client_store_identifier: 'MAG-02',
      delivered_quantity: '1',
    },
  ];
  const supplierDocumentRows = [
    {
      store_id: STORE_A,
      purchase_id: PURCHASE_A,
      document_type: 'purchase_bl',
      original_name: 'BL-fournisseur-ROYALE.pdf',
      public_url: `/api/purchases/${PURCHASE_A}/document`,
      created_at: '2026-08-16T08:53:00.000Z',
      storage_path: 'C:/private/supplier/bl.pdf',
      uploaded_by: 'hidden-user-id',
    },
    {
      store_id: STORE_A,
      purchase_id: PURCHASE_A,
      document_type: 'purchase_bl',
      original_name: 'BL-fournisseur-ROYALE.pdf',
      public_url: `/api/purchases/${PURCHASE_A}/document`,
      created_at: null,
    },
    {
      store_id: STORE_A,
      source_purchase_id: PURCHASE_A,
      document_type: 'invoice',
      original_name: 'Facture-fournisseur-ROYALE.pdf',
      public_url: '/api/supplier-invoices/50000000-0000-4000-8000-000000000701/document',
      created_at: '2026-08-19T10:00:00.000Z',
    },
    {
      store_id: STORE_A,
      match_purchase_id: PURCHASE_A,
      document_type: 'other',
      original_name: 'Annexe-qualite-fournisseur.pdf',
      public_url: '/api/supplier-invoices/50000000-0000-4000-8000-000000000702/document',
      created_at: '2026-08-20T10:00:00.000Z',
    },
    {
      store_id: STORE_B,
      purchase_id: PURCHASE_A,
      document_type: 'purchase_bl',
      original_name: 'BL-autre-magasin.pdf',
      public_url: `/api/purchases/${PURCHASE_A}/document`,
      created_at: '2026-08-16T08:53:00.000Z',
    },
  ];
  const db = new FakeDb([rowA, rowB, incomplete], downstreamRows, supplierDocumentRows);

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
  assert.equal(detail.payload.linked_documents.supplier_delivery_note, 'BL-REAL', 'BL fournisseur doit remonter depuis identification.bl_number');
  assert.equal(detail.payload.linked_documents.supplier_documents.length, 3, 'Tous les documents fournisseur lies a l achat doivent etre listes et dedoublonnes');
  assert.deepEqual(
    detail.payload.linked_documents.supplier_documents.map((document) => document.type_label),
    ['BL fournisseur', 'Facture fournisseur', 'Document fournisseur'],
    'Les types documents fournisseur doivent etre libelles pour affichage'
  );
  assert.equal(detail.payload.linked_documents.supplier_documents[0].name, 'BL-fournisseur-ROYALE.pdf', 'Nom document fournisseur manquant');
  assert.equal(detail.payload.linked_documents.supplier_documents[0].date, '2026-08-16T08:53:00.000Z', 'Date document achat liee manquante');
  assert.equal(detail.payload.linked_documents.supplier_documents[0].url, `/api/purchases/${PURCHASE_A}/document`, 'Lien document achat existant manquant');
  assert.equal(Object.keys(detail.payload.linked_documents.supplier_documents[0]).includes('storage_path'), false, 'La vue DDPP ne doit pas exposer storage_path');
  assert.equal(Object.keys(detail.payload.linked_documents.supplier_documents[0]).includes('uploaded_by'), false, 'La vue DDPP ne doit pas exposer uploaded_by');
  assert.equal(Object.keys(detail.payload.linked_documents.supplier_documents[0]).includes('id'), false, 'La vue DDPP ne doit pas exposer id document');
  assert.equal(detail.payload.linked_documents.downstream_delivery_notes.length, 2, 'Multi-destination aval doit etre listee');
  assert.equal(detail.payload.linked_documents.downstream_delivery_notes[0].delivered_client_name, 'E.LECLERC TEST', 'Client livre aval manquant');
  assert.equal(detail.payload.linked_documents.downstream_delivery_notes[0].delivery_note_reference, 'BL-AVAL-1', 'BL aval manquant');
  assert.equal(detail.payload.linked_documents.downstream_delivery_notes[0].delivery_date, '2026-08-17', 'Date livraison aval manquante');
  assert.equal(detail.payload.linked_documents.downstream_delivery_notes[0].delivered_quantity, 2, 'Quantite livree aval manquante');
  assert.equal(Object.keys(detail.payload.linked_documents.downstream_delivery_notes[0]).includes('lot_id'), false, 'La vue DDPP ne doit pas exposer lot_id dans les documents lies');

  const missing = await getQualityEvidenceRecord(db, STORE_A, '50000000-0000-4000-8000-000000009999');
  assert.equal(missing, null, 'Preuve inexistante doit retourner null');

  const crossStore = await getQualityEvidenceRecord(db, STORE_A, EVIDENCE_B);
  assert.equal(crossStore, null, 'Preuve autre store doit etre inaccessible');

  const filtered = await listQualityEvidenceRecords(db, STORE_A, { evidence_type: 'reception_record', search: 'cabil' });
  assert.equal(filtered.length, 1, 'Filtre type/recherche doit trouver reception_record');
  assert.equal(filtered[0].payload.linked_documents, undefined, 'La liste ne doit pas enrichir chaque ligne avec les BL aval');

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

  const controlledEvidence = publicEvidence(sampleEvidence({
    payload: {
      ...sampleEvidence().payload,
      controls: {
        overall_status: 'non_conform',
        temperature: { status: 'non_conform', value_c: 6 },
        freshness: { status: 'conform' },
        packaging: { status: 'conform' },
        label_conformity: { status: 'conform' },
        observation: 'Temperature reception trop elevee',
        corrective_action: 'lot_isolation',
        corrective_action_comment: 'Lot mis de cote',
      },
    },
  }));
  assert.equal(controlledEvidence.payload.controls.temperature.value_c, 6, 'Temperature mesuree doit rester dans le snapshot');
  assert.equal(controlledEvidence.payload.controls.corrective_action, 'lot_isolation', 'Action corrective doit rester dans le snapshot');

  const physicalWithoutDownstream = await getQualityEvidenceRecord(
    new FakeDb([sampleEvidence({
      id: '50000000-0000-4000-8000-000000000205',
      payload: {
        ...sampleEvidence().payload,
        controls: {
          overall_status: 'conform',
          temperature: { status: 'conform' },
          freshness: { status: 'conform' },
          packaging: { status: 'conform' },
          label_conformity: { status: 'conform' },
        },
      },
    })]),
    STORE_A,
    '50000000-0000-4000-8000-000000000205'
  );
  assert.equal(physicalWithoutDownstream.payload.linked_documents.supplier_delivery_note, 'BL-REAL', 'Reception physique doit conserver le BL fournisseur');
  assert.deepEqual(physicalWithoutDownstream.payload.linked_documents.supplier_documents, [], 'Reception physique sans document achat doit rester lisible avec liste vide');
  assert.deepEqual(physicalWithoutDownstream.payload.linked_documents.downstream_delivery_notes, [], 'Reception sans BL aval doit rester lisible avec liste vide');

  const directTradeWithDocument = await getQualityEvidenceRecord(
    new FakeDb(
      [sampleEvidence({
        id: '50000000-0000-4000-8000-000000000206',
        payload: {
          ...sampleEvidence().payload,
          identification: { ...sampleEvidence().payload.identification, purchase_id: PURCHASE_A },
          reception_mode: 'direct_trade',
          controls: {
            overall_status: 'not_applicable',
            temperature: { status: 'not_applicable' },
            freshness: { status: 'not_applicable' },
            packaging: { status: 'not_applicable' },
            label_conformity: { status: 'not_applicable' },
          },
        },
      })],
      [],
      supplierDocumentRows
    ),
    STORE_A,
    '50000000-0000-4000-8000-000000000206'
  );
  assert.equal(directTradeWithDocument.payload.reception_mode, 'direct_trade', 'Le mode negoce technique doit rester inchange');
  assert.equal(directTradeWithDocument.payload.controls.overall_status, 'not_applicable', 'Le statut technique not_applicable doit rester inchange');
  assert.equal(directTradeWithDocument.payload.linked_documents.supplier_documents.length, 3, 'ENR-005 negoce doit exposer les documents fournisseur existants');

  assert.deepEqual(
    await listReceptionSupplierDocuments(new FakeDb([rowA], [], supplierDocumentRows), STORE_A, {}, {}),
    [],
    'Aucun document fournisseur ne doit etre invente sans purchase_id'
  );

  const noLotIds = receptionLotIds(sampleEvidence({ payload: { identification: { bl_number: 'BL-NOLOT' }, received_products: [{}] } }).payload);
  assert.deepEqual(noLotIds, [], 'Reception sans lot_id ne doit pas inventer de lien aval');
  assert.deepEqual(await listReceptionDownstreamDeliveries(db, STORE_A, { received_products: [{}] }), [], 'Aucun appel aval utile sans lot_id');

  const traceabilityRecord = publicEvidence(sampleEvidence({
    id: TRACE_EVIDENCE,
    evidence_type: 'traceability_test_record',
    source_type: 'human',
    source_record_type: 'lots',
    event_type: 'traceability_test_completed',
    payload: {
      test_id: 'trace-test-1',
      lot: { lot_id: 'lot-1', lot_code: 'LOT-ALTA', supplier_lot_number: 'LOT-SUP' },
      article: { plu: '3063', designation: 'DOS DE CABILLAUD' },
      started_at: '2026-08-16T08:00:00.000Z',
      completed_at: '2026-08-16T08:02:14.000Z',
      duration_seconds: 134,
      result: 'conform',
      observation: 'RAS',
      upstream: { supplier_name: 'ROYALE MAREE', bl_number: 'BL-1', received_quantity: 3 },
      transformations: [],
      downstream: [{ delivery_note_reference: 'BL-C1', delivered_client_name: 'CLIENT LIVRE', billed_client_name: 'CENTRALE', delivered_quantity: 3 }],
      summary: { clients_delivered_count: 1, delivery_notes_count: 1, delivered_quantity: 3, stock_initial: 3, stock_remaining: 0 },
    },
  }));
  assert.equal(traceabilityRecord.type_label, 'Test de tracabilite', 'Type test tracabilite doit etre libelle');
  assert.equal(traceabilityRecord.reference_label, 'LOT-ALTA', 'Reference test tracabilite doit etre le lot');
  assert.equal(traceabilityRecord.origin_label, 'Tracabilite', 'Origine test tracabilite incorrecte');
  assert(traceabilityRecord.summary_label.includes('Conforme'), 'Resume test tracabilite doit afficher le resultat');

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
    quality_control_rendering: true,
    linked_supplier_delivery_note: true,
    linked_supplier_documents: true,
    linked_supplier_documents_multi: true,
    linked_supplier_documents_empty: true,
    downstream_delivery_notes: true,
    downstream_multi_destination: true,
    missing_downstream_delivery_note: true,
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
