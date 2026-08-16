const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  buildTraceabilityTestSnapshot,
  completeTraceabilityTest,
  searchTraceabilityTestLots,
} = require('../services/quality/traceabilityTestService');

const ROOT = path.resolve(__dirname, '..', '..');
const STORE_A = '80000000-0000-4000-8000-000000000001';
const STORE_B = '80000000-0000-4000-8000-000000000002';
const USER_ID = '80000000-0000-4000-8000-000000000101';
const LOT_A = '80000000-0000-4000-8000-000000000201';
const LOT_EMPTY = '80000000-0000-4000-8000-000000000202';
const LOT_B = '80000000-0000-4000-8000-000000000203';

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeTraceabilityDb {
  constructor() {
    this.nextId = 1;
    this.events = [];
    this.evidence = [];
    this.stockUpdates = 0;
    this.recallWrites = 0;
    this.ncWrites = 0;
    this.lots = [
      {
        lot_id: LOT_A,
        store_id: STORE_A,
        lot_code: 'LOT-ALTA',
        supplier_lot_number: 'LOT-SUP',
        source_type: 'purchase',
        qty_initial: 3,
        qty_remaining: 0,
        dlc: null,
        created_at: '2026-08-16T06:00:00.000Z',
        article_id: '80000000-0000-4000-8000-000000000301',
        article_plu: '3063',
        article_label: 'DOS DE CABILLAUD',
        article_unit: 'kg',
        family_name: 'Poisson',
        purchase_id: '80000000-0000-4000-8000-000000000401',
        purchase_line_id: '80000000-0000-4000-8000-000000000402',
        purchase_date: '2026-08-16',
        receipt_date: '2026-08-16',
        bl_number: 'BL-FOURN-1',
        invoice_number: null,
        purchase_line_number: 1,
        supplier_reference: 'CAB-DOS',
        supplier_label: 'Dos cabillaud',
        supplier_id: '80000000-0000-4000-8000-000000000501',
        supplier_code: 'ROY',
        supplier_name: 'ROYALE MAREE',
        latin_name: 'GADUS MORHUA',
        fao_zone: 'FAO 27',
        sous_zone: 'VII',
        fishing_gear: 'Chalut',
        production_method: 'Peche',
        origin_label: 'France',
        allergens: 'Poisson',
      },
      {
        lot_id: LOT_EMPTY,
        store_id: STORE_A,
        lot_code: 'LOT-NON-VENDU',
        supplier_lot_number: null,
        source_type: 'purchase',
        qty_initial: 5,
        qty_remaining: 5,
        article_id: '80000000-0000-4000-8000-000000000302',
        article_plu: '4000',
        article_label: 'MERLU',
        supplier_name: 'ROYALE MAREE',
      },
      {
        lot_id: LOT_B,
        store_id: STORE_B,
        lot_code: 'LOT-AUTRE-STORE',
        source_type: 'purchase',
        qty_initial: 1,
        qty_remaining: 1,
        article_id: '80000000-0000-4000-8000-000000000303',
        article_plu: '9999',
        article_label: 'AUTRE',
      },
    ];
    this.downstream = [
      { lot_id: LOT_A, delivery_note_id: 'dn1', delivery_note_reference: 'BL-C1', delivery_note_date: '2026-08-16', document_type: 'DELIVERY_NOTE', delivered_client_id: 'client-a', delivered_client_name: 'CLIENT LIVRE A', delivered_client_code: 'A', delivered_store_identifier: 'A1', billed_client_id: 'bill-a', billed_client_name: 'CENTRALE A', billed_client_code: 'CA', delivered_quantity: 1, allocated_at: '2026-08-16T07:00:00.000Z' },
      { lot_id: LOT_A, delivery_note_id: 'dn2', delivery_note_reference: 'BL-C2', delivery_note_date: '2026-08-16', document_type: 'DELIVERY_NOTE', delivered_client_id: 'client-b', delivered_client_name: 'CLIENT LIVRE B', delivered_client_code: 'B', delivered_store_identifier: 'B1', billed_client_id: 'client-b', billed_client_name: 'CLIENT LIVRE B', billed_client_code: 'B', delivered_quantity: 2, allocated_at: '2026-08-16T07:20:00.000Z' },
    ];
    this.transformations = [
      { movement_id: 'mov1', lot_id: LOT_A, movement_type: 'transformation_out', quantity: -1, source_table: 'transformation_inputs', source_id: 'trf-in', notes: 'Sortie transformation T1', created_at: '2026-08-16T08:00:00.000Z' },
    ];
  }

  async query(sql, params = []) {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    if (/UPDATE\s+(lots|stock_movements)/i.test(normalized)) this.stockUpdates += 1;
    if (/INSERT INTO product_recall/i.test(normalized)) this.recallWrites += 1;
    if (/INSERT INTO quality_non_conformities/i.test(normalized)) this.ncWrites += 1;

    if (normalized === 'SELECT gen_random_uuid() AS id') {
      const id = `90000000-0000-4000-8000-${String(this.nextId).padStart(12, '0')}`;
      this.nextId += 1;
      return { rows: [{ id }] };
    }
    if (normalized.startsWith('SELECT l.id AS lot_id') && normalized.includes('LIMIT 1')) {
      const row = this.lots.find((lot) => lot.store_id === params[0] && lot.lot_id === params[1]);
      return { rows: row ? [clone(row)] : [] };
    }
    if (normalized.startsWith('SELECT l.id AS lot_id') && normalized.includes('ORDER BY l.created_at DESC')) {
      const storeId = params[0];
      const search = params.find((value) => typeof value === 'string' && value.startsWith('%'));
      const needle = search ? search.replace(/%/g, '').toLowerCase() : null;
      return {
        rows: clone(this.lots.filter((lot) => (
          lot.store_id === storeId
          && (!needle || [lot.lot_code, lot.supplier_lot_number, lot.article_plu, lot.article_label].some((value) => String(value || '').toLowerCase().includes(needle)))
        ))),
      };
    }
    if (normalized.startsWith('SELECT sd.id AS delivery_note_id')) {
      return { rows: clone(this.downstream.filter((row) => row.lot_id === params[1])) };
    }
    if (normalized.startsWith('SELECT sm.id AS movement_id')) {
      return { rows: clone(this.transformations.filter((row) => row.lot_id === params[1])) };
    }
    if (normalized.startsWith('INSERT INTO quality_events')) {
      const row = { id: `91000000-0000-4000-8000-${String(this.events.length + 1).padStart(12, '0')}`, store_id: params[0], event_type: params[1], source_table: params[2], source_id: params[3], source_discriminator: params[5], occurred_at: params[6], triggered_by: params[7], payload: params[10] };
      this.events.push(row);
      return { rows: [clone(row)] };
    }
    if (normalized.startsWith('SELECT * FROM quality_events')) {
      const row = this.events.find((event) => event.id === params[0] && event.store_id === params[1]);
      return { rows: row ? [clone(row)] : [] };
    }
    if (normalized.startsWith('INSERT INTO quality_evidence_records')) {
      const row = { id: `evidence-${this.evidence.length + 1}`, store_id: params[0], quality_event_id: params[1], evidence_type: params[2], evidence_status: params[4], evidence_at: params[5], recorded_by: params[6], source_type: params[7], source_record_type: params[8], source_record_id: params[9], source_discriminator: params[10], payload: params[18] };
      this.evidence.push(row);
      return { rows: [clone(row)] };
    }
    throw new Error(`Unexpected SQL: ${normalized}`);
  }
}

async function main() {
  const service = read('backend/services/quality/traceabilityTestService.js');
  const route = read('backend/routes/traceability.js');
  const frontend = read('frontend/js/traceability.js');
  const evidenceFrontend = read('frontend/quality/js/evidence-records.js');

  assert(service.includes("eventType: 'traceability_test_completed'"));
  assert(service.includes("evidenceType: 'traceability_test_record'"));
  assert(service.includes("sourceType: 'human'"));
  assert(route.includes("router.get('/traceability-tests/lots'"));
  assert(route.includes("router.post('/lots/:lotId/traceability-test'"));
  assert(frontend.includes('Test de tracabilite'));
  assert(evidenceFrontend.includes('renderTraceabilityTestDetail'));
  assert(!service.includes('blockLotForQuality'));
  assert(!service.includes('sendEmail'));
  assert(!service.includes('quality_non_conformities'));

  const db = new FakeTraceabilityDb();
  const lots = await searchTraceabilityTestLots({ db, storeId: STORE_A, search: '3063' });
  assert.strictEqual(lots.length, 1);
  assert.strictEqual(lots[0].lot_code, 'LOT-ALTA');

  const snapshot = await buildTraceabilityTestSnapshot({ db, storeId: STORE_A, lotId: LOT_A });
  assert.strictEqual(snapshot.article.designation, 'DOS DE CABILLAUD');
  assert.strictEqual(snapshot.upstream.supplier_name, 'ROYALE MAREE');
  assert.strictEqual(snapshot.upstream.bl_number, 'BL-FOURN-1');
  assert.strictEqual(snapshot.downstream.length, 2);
  assert.strictEqual(snapshot.summary.clients_delivered_count, 2);
  assert.strictEqual(snapshot.summary.delivery_notes_count, 2);
  assert.strictEqual(snapshot.summary.delivered_quantity, 3);
  assert.strictEqual(snapshot.downstream[0].delivered_client_name, 'CLIENT LIVRE A');
  assert.strictEqual(snapshot.downstream[0].billed_client_name, 'CENTRALE A');
  assert.strictEqual(snapshot.transformations.length, 1);

  const empty = await buildTraceabilityTestSnapshot({ db, storeId: STORE_A, lotId: LOT_EMPTY });
  assert.strictEqual(empty.downstream.length, 0);
  assert.strictEqual(empty.summary.delivery_notes_count, 0);

  await assert.rejects(
    () => buildTraceabilityTestSnapshot({ db, storeId: STORE_A, lotId: LOT_B }),
    (error) => error.status === 404 && error.code === 'LOT_NOT_FOUND'
  );

  const conform = await completeTraceabilityTest({
    db,
    storeId: STORE_A,
    lotId: LOT_A,
    userId: USER_ID,
    result: 'conform',
    observation: 'RAS',
    startedAt: '2026-08-16T08:00:00.000Z',
    completedAt: new Date('2026-08-16T08:02:14.000Z'),
  });
  assert.strictEqual(conform.quality_event.event_type, 'traceability_test_completed');
  assert.strictEqual(conform.quality_evidence_record.evidence_type, 'traceability_test_record');
  assert.strictEqual(conform.quality_evidence_record.source_type, 'human');
  assert.strictEqual(conform.quality_evidence_record.payload.duration_seconds, 134);
  assert.strictEqual(conform.quality_evidence_record.payload.result, 'conform');
  assert.strictEqual(conform.quality_evidence_record.payload.downstream.length, 2);

  await assert.rejects(
    () => completeTraceabilityTest({ db, storeId: STORE_A, lotId: LOT_A, userId: USER_ID, result: 'non_conform', correctiveAction: 'Corriger', startedAt: '2026-08-16T08:00:00.000Z' }),
    (error) => error.code === 'TRACEABILITY_TEST_OBSERVATION_REQUIRED'
  );
  await assert.rejects(
    () => completeTraceabilityTest({ db, storeId: STORE_A, lotId: LOT_A, userId: USER_ID, result: 'non_conform', observation: 'Rupture lien BL', startedAt: '2026-08-16T08:00:00.000Z' }),
    (error) => error.code === 'TRACEABILITY_TEST_CORRECTIVE_ACTION_REQUIRED'
  );

  const nonConform = await completeTraceabilityTest({
    db,
    storeId: STORE_A,
    lotId: LOT_A,
    userId: USER_ID,
    result: 'non_conform',
    observation: 'Lot fournisseur absent',
    correctiveAction: 'Verifier fournisseur',
    startedAt: '2026-08-16T09:00:00.000Z',
    completedAt: new Date('2026-08-16T09:01:00.000Z'),
  });
  assert.strictEqual(nonConform.quality_evidence_record.payload.result, 'non_conform');
  assert.strictEqual(db.evidence.length, 2, 'Plusieurs tests du meme lot doivent etre autorises');
  assert.strictEqual(db.stockUpdates, 0, 'Le test ne doit pas modifier le stock ou les lots');
  assert.strictEqual(db.recallWrites, 0, 'Le test ne doit pas creer de rappel');
  assert.strictEqual(db.ncWrites, 0, 'Le test ne doit pas creer de NC');

  console.log(JSON.stringify({
    ok: true,
    tests: [
      'lot_search_plu_lot_supplier_article',
      'snapshot_upstream_downstream_transformations',
      'empty_downstream_supported',
      'multi_store_refused',
      'conform_evidence_created',
      'non_conform_validation_required',
      'multiple_tests_same_lot_allowed',
      'duration_seconds',
      'quality_evidence_snapshot',
      'no_stock_no_recall_no_nc',
      'frontend_and_evidence_rendering_wired',
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
