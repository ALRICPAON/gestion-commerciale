const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  createReceptionQualityEvidence,
  normalizeReceptionQualityControl,
} = require('../services/quality/purchaseReceptionEvidence');

const ROOT = path.resolve(__dirname, '..', '..');
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const STORE_A = '20000000-0000-4000-8000-000000000001';
const STORE_B = '20000000-0000-4000-8000-000000000002';
const PURCHASE_A = '20000000-0000-4000-8000-000000000101';
const USER_ID = '20000000-0000-4000-8000-000000000201';
const RECEIVED_AT = '2026-08-16T06:42:17.123Z';

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function clone(row) {
  return row ? { ...row, payload: JSON.parse(JSON.stringify(row.payload || {})) } : row;
}

function makeId(prefix, count) {
  return `${prefix === 'event' ? '30000000' : '40000000'}-0000-4000-8000-${String(count).padStart(12, '0')}`;
}

function eventKey(row) {
  return [
    row.store_id,
    row.event_type,
    row.source_table,
    row.source_id,
    row.source_line_id || ZERO_UUID,
    row.source_discriminator || '',
  ].join('|');
}

function evidenceKey(row) {
  return [
    row.store_id,
    row.quality_event_id,
    row.evidence_type,
    row.source_record_type || '',
    row.source_record_id || ZERO_UUID,
    row.source_discriminator || '',
  ].join('|');
}

class FakeQualityDb {
  constructor() {
    this.events = [];
    this.evidence = [];
    this.eventSeq = 1;
    this.evidenceSeq = 1;
    this.inTransaction = false;
    this.txEvents = null;
    this.txEvidence = null;
  }

  activeEvents() {
    return this.inTransaction ? this.txEvents : this.events;
  }

  activeEvidence() {
    return this.inTransaction ? this.txEvidence : this.evidence;
  }

  async query(sql, params = []) {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();

    if (normalized === 'BEGIN') {
      this.inTransaction = true;
      this.txEvents = this.events.map(clone);
      this.txEvidence = this.evidence.map(clone);
      return { rows: [] };
    }
    if (normalized === 'ROLLBACK') {
      this.inTransaction = false;
      this.txEvents = null;
      this.txEvidence = null;
      return { rows: [] };
    }
    if (normalized === 'COMMIT') {
      this.events = this.txEvents;
      this.evidence = this.txEvidence;
      this.inTransaction = false;
      this.txEvents = null;
      this.txEvidence = null;
      return { rows: [] };
    }

    if (normalized.startsWith('INSERT INTO quality_events')) {
      const row = {
        id: makeId('event', this.eventSeq),
        store_id: params[0],
        event_type: params[1],
        source_table: params[2],
        source_id: params[3],
        source_line_id: params[4],
        source_discriminator: params[5] || '',
        occurred_at: params[6],
        triggered_by: params[7],
        event_status: params[8],
        payload_version: params[9],
        payload: params[10],
        archived_at: null,
      };
      const existing = this.activeEvents().find((item) => !item.archived_at && eventKey(item) === eventKey(row));
      if (existing) return { rows: [] };
      this.eventSeq += 1;
      this.activeEvents().push(row);
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith('SELECT * FROM quality_events WHERE store_id =')) {
      const lookup = {
        store_id: params[0],
        event_type: params[1],
        source_table: params[2],
        source_id: params[3],
        source_line_id: params[4],
        source_discriminator: params[5] || '',
      };
      const row = this.activeEvents().find((item) => !item.archived_at && eventKey(item) === eventKey(lookup));
      return { rows: row ? [clone(row)] : [] };
    }

    if (normalized.startsWith('SELECT * FROM quality_events WHERE id =')) {
      const row = this.activeEvents().find((item) => item.id === params[0] && item.store_id === params[1] && !item.archived_at);
      return { rows: row ? [clone(row)] : [] };
    }

    if (/^SELECT id FROM quality_(tasks|task_occurrences|non_conformities|documents|photos|master_documents)/.test(normalized)) {
      return { rows: [] };
    }

    if (normalized.startsWith('INSERT INTO quality_evidence_records')) {
      const event = this.activeEvents().find((item) => item.id === params[1] && item.store_id === params[0] && !item.archived_at);
      if (!event) {
        const err = new Error('event/store fk');
        err.code = '23503';
        throw err;
      }
      const row = {
        id: makeId('evidence', this.evidenceSeq),
        store_id: params[0],
        quality_event_id: params[1],
        evidence_type: params[2],
        evidence_reference: params[3],
        evidence_status: params[4],
        evidence_at: params[5],
        recorded_by: params[6],
        source_type: params[7],
        source_record_type: params[8],
        source_record_id: params[9],
        source_discriminator: params[10] || '',
        payload_version: params[17],
        payload: params[18],
        archived_at: null,
      };
      const existing = this.activeEvidence().find((item) => !item.archived_at && item.source_type !== 'human' && evidenceKey(item) === evidenceKey(row));
      if (existing) return { rows: [] };
      this.evidenceSeq += 1;
      this.activeEvidence().push(row);
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith('SELECT * FROM quality_evidence_records WHERE store_id =') && normalized.includes('evidence_type =')) {
      const lookup = {
        store_id: params[0],
        quality_event_id: params[1],
        evidence_type: params[2],
        source_record_type: params[3],
        source_record_id: params[4],
        source_discriminator: params[5] || '',
      };
      const row = this.activeEvidence().find((item) => !item.archived_at && item.source_type !== 'human' && evidenceKey(item) === evidenceKey(lookup));
      return { rows: row ? [clone(row)] : [] };
    }

    throw new Error(`Unhandled fake SQL: ${normalized}`);
  }
}

function purchase(storeId = STORE_A, id = PURCHASE_A) {
  return {
    id,
    store_id: storeId,
    client_key: 'codex',
    supplier_id: '20000000-0000-4000-8000-000000000301',
    purchase_type: 'direct_bl',
    purchase_date: '2026-08-16',
    receipt_date: '2026-08-16',
    bl_number: 'BL-42',
    invoice_number: null,
    source_document_url: `/api/purchases/${id}/document`,
    source_document_original_name: 'BL-42.pdf',
    source_document_mime_type: 'application/pdf',
    notes: 'Controle documentaire fournisseur.',
  };
}

function lines() {
  return [
    {
      id: '20000000-0000-4000-8000-000000000401',
      line_number: 1,
      article_id: '20000000-0000-4000-8000-000000000501',
      plu: 'SAUM',
      designation: 'Saumon entier',
      supplier_reference: 'SUP-SAU',
      supplier_label: 'SAUMON LABEL',
      received_colis: 2,
      received_pieces: 4,
      received_quantity: 18.5,
      stock_quantity: 37,
      price_unit: 'kg',
      unit_price_ex_vat: 12.4,
      line_amount_ex_vat: 458.8,
      lot_id: '20000000-0000-4000-8000-000000000601',
      lot_code: 'SAUM-26228-ABC-000401',
      supplier_lot_number: 'LOT-SUP-1',
      dlc: '2026-08-20',
      latin_name: 'Salmo salar',
      production_method: 'elevage',
      fao_zone: '27',
      sous_zone: 'IV',
      fishing_gear: null,
      origin_label: 'Norvege',
      allergens: 'poisson',
      sanitary_photo_url: '/uploads/sanitary-photos/one.jpg',
      sanitary_photo_urls: ['/uploads/sanitary-photos/one.jpg'],
    },
    {
      id: '20000000-0000-4000-8000-000000000402',
      line_number: 2,
      article_id: '20000000-0000-4000-8000-000000000502',
      plu: 'BAR',
      designation: 'Bar',
      supplier_reference: 'SUP-BAR',
      supplier_label: 'BAR LABEL',
      received_colis: 1,
      received_pieces: 3,
      received_quantity: 6.2,
      stock_quantity: 6.2,
      price_unit: 'kg',
      unit_price_ex_vat: 15.1,
      line_amount_ex_vat: 93.62,
      lot_id: '20000000-0000-4000-8000-000000000602',
      lot_code: 'BAR-26228-ABC-000402',
      supplier_lot_number: 'LOT-SUP-2',
      dlc: '2026-08-19',
      fao_zone: '27',
      origin_label: 'France',
      sanitary_photo_urls: [],
    },
  ];
}

async function main() {
  const frontend = read('frontend/js/purchase-detail.js');
  const frontendHtml = read('frontend/purchase-detail.html');
  const server = read('backend/server.js');
  const route = read('backend/routes/purchaseReceptionUpgrade.js');
  const service = read('backend/services/quality/purchaseReceptionEvidence.js');
  const migration = read('backend/db/gestion-commerciale/20260822_purchase_reception_mode.sql');

  assert(frontend.includes('apiFetch(`/api/purchases/${purchaseId}/validate-reception`'), 'Frontend validation reception ne cible pas endpoint attendu');
  assert(frontend.includes('requestReceptionQualityControl'), 'Popup controle qualite reception manquante');
  assert(frontend.includes('overall_status: "conform"'), 'Payload conforme par defaut manquant');
  assert(frontendHtml.includes('value="direct_trade"'), 'Option frontend Negoce manquante');
  assert(frontend.includes('directTradeQualityControlPayload'), 'Payload frontend Negoce manquant');
  assert(frontend.includes('status: "not_applicable"'), 'Negoce doit envoyer des controles non applicables');
  assert(frontend.includes('reception_mode: qualityControl.reception_mode || "physical"'), 'Mode de reception non envoye au backend');
  assert(frontend.includes('quality_control: qualityControl'), 'Payload quality_control non envoye au backend');
  assert(frontend.includes('corrective_action: correctiveAction'), 'Action corrective non collectee');
  assert(frontend.includes('temperatureValueRaw === "" ? null : Number(temperatureValueRaw)'), 'Temperature mesuree doit rester facultative et numerique');
  assert(server.indexOf('purchaseReceptionUpgradeRoutes') < server.indexOf('purchasesRoutes'), 'La route reception upgrade doit etre montee avant routes/purchases');
  assert(route.includes("router.post('/purchases/:id/validate-reception'"), 'Endpoint backend reel manquant');
  assert(route.includes('normalizeReceptionQualityControl(req.body.quality_control, { required: true })'), 'Validation backend quality_control obligatoire manquante');
  assert(route.includes('receptionModeFromRequest(req.body, qualityControl)'), 'Derivation mode reception manquante');
  assert(route.includes('reception_mode = $4'), 'Persistance reception_mode manquante');
  assert(route.includes('SELECT * FROM purchases WHERE id = $1 AND store_id = $2 FOR UPDATE'), 'Verrou purchase FOR UPDATE manquant');
  assert(route.includes('INSERT INTO lots'), 'Creation lots manquante dans le flux reception');
  assert(route.includes('INSERT INTO stock_movements'), 'Creation stock_movements manquante dans le flux reception');
  assert(route.includes('createReceptionQualityEvidence'), 'Generation qualite reception non branchee');
  assert(route.indexOf('createReceptionQualityEvidence') < route.indexOf("await client.query('COMMIT')"), 'Generation qualite doit etre avant COMMIT');
  assert(route.includes("await client.query('ROLLBACK')"), 'Rollback route manquant');
  assert(!route.includes('quality_tasks'), 'La PR ne doit pas recreer/brancher quality_tasks');
  assert(!route.includes('quality_temperature_records'), 'La PR ne doit pas recreer/brancher temperature');
  assert(service.includes("eventType: 'purchase_received'"), 'Event type purchase_received manquant');
  assert(service.includes("evidenceType: 'reception_record'"), 'Evidence type reception_record manquant');
  assert(service.includes("'direct_trade'"), 'Mode direct_trade absent du service qualite');
  assert(service.includes("'not_applicable'"), 'Statut not_applicable absent du service qualite');
  assert(service.includes('reception_mode_notice'), 'Mention Negoce explicite manquante dans ENR');
  assert(service.includes("evidenceStatus: 'recorded'"), 'Evidence status recorded attendu');
  assert(service.includes("sourceRecordType: 'purchases'"), 'Evidence idempotence source purchases attendue');
  assert(service.includes("sourceDiscriminator: 'reception_record'"), 'Evidence discriminator reception_record attendu');
  assert(service.includes("CORRECTIVE_ACTIONS = new Set(['supplier_return', 'lot_isolation', 'accepted_with_reservation', 'destruction', 'other'])"), 'Actions correctives attendues manquantes');
  assert(migration.includes('ADD COLUMN IF NOT EXISTS reception_mode'), 'Migration reception_mode manquante');
  assert(migration.includes("CHECK (reception_mode IN ('physical', 'direct_trade'))"), 'Contrainte reception_mode manquante');

  assert.throws(
    () => normalizeReceptionQualityControl({ overall_status: 'bad' }, { required: true }),
    /Statut global qualite invalide/,
    'Statut inconnu doit etre refuse'
  );
  assert.throws(
    () => normalizeReceptionQualityControl({ overall_status: 'non_conform', temperature: { status: 'conform' }, freshness: { status: 'conform' }, packaging: { status: 'conform' }, label_conformity: { status: 'conform' } }, { required: true }),
    /Observation obligatoire/,
    'Non conforme sans observation doit etre refuse'
  );
  assert.throws(
    () => normalizeReceptionQualityControl({ overall_status: 'non_conform', temperature: { status: 'conform' }, freshness: { status: 'conform' }, packaging: { status: 'conform' }, label_conformity: { status: 'conform' }, observation: 'Caisse deterioree' }, { required: true }),
    /Action corrective obligatoire/,
    'Non conforme sans action doit etre refuse'
  );
  assert.throws(
    () => normalizeReceptionQualityControl({ overall_status: 'non_conform', temperature: { status: 'conform' }, freshness: { status: 'conform' }, packaging: { status: 'conform' }, label_conformity: { status: 'conform' }, observation: 'Odeur anormale', corrective_action: 'other' }, { required: true }),
    /Commentaire obligatoire/,
    'Action other sans commentaire doit etre refusee'
  );
  assert.throws(
    () => normalizeReceptionQualityControl({ overall_status: 'non_conform', temperature: { status: 'non_conform', value_c: 'chaud' }, freshness: { status: 'conform' }, packaging: { status: 'conform' }, label_conformity: { status: 'conform' }, observation: 'Temperature elevee', corrective_action: 'lot_isolation' }, { required: true }),
    /Temperature mesuree invalide/,
    'Temperature non numerique doit etre refusee'
  );
  assert.throws(
    () => normalizeReceptionQualityControl({ overall_status: 'conform', reception_mode: 'direct_trade', temperature: { status: 'conform' }, freshness: { status: 'conform' }, packaging: { status: 'conform' }, label_conformity: { status: 'conform' } }, { required: true }),
    /Le mode negoce exige le statut global negoce/,
    'Negoce ne doit pas pouvoir etre valide comme conforme physique'
  );

  const db = new FakeQualityDb();
  const supplier = { id: '20000000-0000-4000-8000-000000000301', code: '81269', name: 'Criée Test' };
  const first = await createReceptionQualityEvidence({
    db,
    purchase: purchase(),
    supplier,
    lines: lines(),
    userId: USER_ID,
    receiptDate: '2026-08-16',
    receivedAt: new Date(RECEIVED_AT),
  });
  assert.equal(first.eventCreated, true, 'Premier passage doit creer event');
  assert.equal(first.evidenceCreated, true, 'Premier passage doit creer evidence');
  assert.equal(db.events.length, 1, 'Un event attendu');
  assert.equal(db.evidence.length, 1, 'Une evidence attendue');
  assert.equal(db.events[0].event_type, 'purchase_received');
  assert.equal(db.events[0].source_table, 'purchases');
  assert.equal(db.evidence[0].evidence_type, 'reception_record');
  assert.equal(db.evidence[0].evidence_status, 'recorded');
  assert.equal(new Date(db.events[0].occurred_at).toISOString(), RECEIVED_AT, 'occurred_at doit utiliser receivedAt, pas receiptDate');
  assert.equal(new Date(db.evidence[0].evidence_at).toISOString(), RECEIVED_AT, 'evidence_at doit utiliser receivedAt, pas receiptDate');

  const payload = db.evidence[0].payload;
  assert.equal(payload.identification.receipt_date, '2026-08-16', 'receipt_date metier doit rester dans le snapshot');
  assert.equal(payload.identification.received_at, RECEIVED_AT, 'received_at snapshot doit utiliser l instant technique reel');
  assert.equal(payload.identification.purchase_id, PURCHASE_A, 'Snapshot purchase_id manquant');
  assert.equal(payload.identification.supplier_name, 'Criée Test', 'Snapshot fournisseur manquant');
  assert.equal(payload.identification.bl_number, 'BL-42', 'Snapshot BL manquant');
  assert.equal(payload.received_products.length, 2, 'Snapshot multi-lignes incomplet');
  assert.equal(payload.received_products[0].article_designation, 'Saumon entier', 'Designation historique manquante');
  assert.equal(payload.received_products[0].lot_code, 'SAUM-26228-ABC-000401', 'Lot ALTA manquant');
  assert.equal(payload.received_products[0].supplier_lot_number, 'LOT-SUP-1', 'Lot fournisseur manquant');
  assert.equal(payload.received_products[0].traceability.latin_name, 'Salmo salar', 'Traceabilite sanitaire manquante');
  assert.equal(payload.controls.temperature.status, 'not_available_in_purchase_reception_flow', 'Temperature ne doit pas etre inventee');

  const conformDb = new FakeQualityDb();
  const conform = await createReceptionQualityEvidence({
    db: conformDb,
    purchase: purchase(),
    supplier,
    lines: lines(),
    userId: USER_ID,
    receiptDate: '2026-08-16',
    receivedAt: new Date(RECEIVED_AT),
    qualityControl: {
      overall_status: 'conform',
      temperature: { status: 'conform', value_c: null },
      freshness: { status: 'conform' },
      packaging: { status: 'conform' },
      label_conformity: { status: 'conform' },
      observation: null,
      corrective_action: null,
      corrective_action_comment: null,
    },
  });
  assert.equal(conform.evidenceCreated, true, 'Controle conforme doit creer evidence');
  assert.equal(conformDb.evidence[0].payload.controls.overall_status, 'conform', 'Statut conforme manquant dans ENR');
  assert.equal(conformDb.evidence[0].payload.controls.temperature.status, 'conform', 'Temperature conforme attendue');
  assert.equal(conformDb.evidence[0].payload.controls.corrective_action, null, 'Action corrective absente en conforme');

  const nonConformDb = new FakeQualityDb();
  await createReceptionQualityEvidence({
    db: nonConformDb,
    purchase: purchase(),
    supplier,
    lines: lines(),
    userId: USER_ID,
    receiptDate: '2026-08-16',
    receivedAt: new Date(RECEIVED_AT),
    qualityControl: {
      overall_status: 'non_conform',
      temperature: { status: 'non_conform', value_c: 6 },
      freshness: { status: 'conform' },
      packaging: { status: 'conform' },
      label_conformity: { status: 'conform' },
      observation: 'Temperature reception trop elevee',
      corrective_action: 'lot_isolation',
      corrective_action_comment: 'Lot mis de cote en attente decision',
    },
  });
  assert.equal(nonConformDb.evidence[0].payload.controls.overall_status, 'non_conform', 'Statut non conforme manquant');
  assert.equal(nonConformDb.evidence[0].payload.controls.temperature.value_c, 6, 'Temperature mesuree manquante');
  assert.equal(nonConformDb.evidence[0].payload.controls.corrective_action, 'lot_isolation', 'Action isolation attendue');

  const packagingDb = new FakeQualityDb();
  await createReceptionQualityEvidence({
    db: packagingDb,
    purchase: purchase(),
    supplier,
    lines: lines(),
    userId: USER_ID,
    receiptDate: '2026-08-16',
    qualityControl: {
      overall_status: 'non_conform',
      temperature: { status: 'conform' },
      freshness: { status: 'conform' },
      packaging: { status: 'non_conform' },
      label_conformity: { status: 'conform' },
      observation: 'Caisse deterioree',
      corrective_action: 'accepted_with_reservation',
    },
  });
  assert.equal(packagingDb.evidence[0].payload.controls.temperature.value_c, null, 'Temperature facultative si emballage non conforme');
  assert.equal(packagingDb.evidence[0].payload.controls.packaging.status, 'non_conform', 'Emballage non conforme attendu');

  const directTradeDb = new FakeQualityDb();
  await createReceptionQualityEvidence({
    db: directTradeDb,
    purchase: { ...purchase(), reception_mode: 'direct_trade' },
    supplier,
    lines: lines(),
    userId: USER_ID,
    receiptDate: '2026-08-16',
    receivedAt: new Date(RECEIVED_AT),
    qualityControl: {
      overall_status: 'direct_trade',
      reception_mode: 'direct_trade',
      temperature: { status: 'not_applicable', value_c: null },
      freshness: { status: 'not_applicable' },
      packaging: { status: 'not_applicable' },
      label_conformity: { status: 'not_applicable' },
    },
  });
  const directTradePayload = directTradeDb.evidence[0].payload;
  assert.equal(directTradePayload.reception_mode, 'direct_trade', 'Mode Negoce manquant dans ENR');
  assert.equal(directTradePayload.reception_mode_label, 'Negoce', 'Libelle Negoce manquant dans ENR');
  assert(directTradePayload.reception_mode_notice.includes('livraison directe fournisseur vers client'), 'Mention livraison directe manquante');
  assert.equal(directTradePayload.identification.reception_mode, 'direct_trade', 'Mode Negoce manquant dans identification');
  assert.equal(directTradePayload.controls.overall_status, 'direct_trade', 'Statut global Negoce manquant');
  assert.equal(directTradePayload.controls.temperature.status, 'not_applicable', 'Temperature doit etre non applicable en Negoce');
  assert.equal(directTradePayload.controls.temperature.value_c, null, 'Temperature ne doit pas etre inventee en Negoce');
  assert.equal(directTradePayload.controls.freshness.status, 'not_applicable', 'Fraicheur doit etre non applicable en Negoce');
  assert.equal(directTradePayload.controls.packaging.status, 'not_applicable', 'Emballage doit etre non applicable en Negoce');
  assert.equal(directTradePayload.controls.label_conformity.status, 'not_applicable', 'Etiquetage doit etre non applicable en Negoce');
  assert.equal(directTradePayload.received_products.length, 2, 'Negoce doit conserver les lignes recues');
  assert.equal(directTradePayload.received_products[0].supplier_lot_number, 'LOT-SUP-1', 'Negoce doit conserver le lot fournisseur');
  assert.equal(directTradePayload.received_products[0].lot_code, 'SAUM-26228-ABC-000401', 'Negoce doit conserver le lot ALTA');

  const replay = await createReceptionQualityEvidence({
    db,
    purchase: purchase(),
    supplier,
    lines: lines(),
    userId: USER_ID,
    receiptDate: '2026-08-16',
    receivedAt: new Date('2026-08-16T08:01:00.000Z'),
  });
  assert.equal(replay.eventCreated, false, 'Replay doit relire event');
  assert.equal(replay.evidenceCreated, false, 'Replay doit relire evidence');
  assert.equal(db.events.length, 1, 'Replay ne doit pas doubler event');
  assert.equal(db.evidence.length, 1, 'Replay ne doit pas doubler evidence');

  const otherStore = await createReceptionQualityEvidence({
    db,
    purchase: purchase(STORE_B, PURCHASE_A),
    supplier,
    lines: lines(),
    userId: USER_ID,
    receiptDate: '2026-08-16',
  });
  assert.equal(otherStore.eventCreated, true, 'Multi-store doit creer un event distinct');
  assert.equal(otherStore.evidenceCreated, true, 'Multi-store doit creer une evidence distincte');
  assert.equal(db.events.length, 2, 'Deux magasins doivent produire deux events');
  assert.equal(db.evidence.length, 2, 'Deux magasins doivent produire deux evidences');

  await db.query('BEGIN');
  const rolledBack = await createReceptionQualityEvidence({
    db,
    purchase: purchase(STORE_A, '20000000-0000-4000-8000-000000000777'),
    supplier,
    lines: lines(),
    userId: USER_ID,
    receiptDate: '2026-08-16',
  });
  assert(rolledBack.event.id, 'Event transactionnel attendu avant rollback');
  await db.query('ROLLBACK');
  assert.equal(db.events.some((event) => event.source_id === '20000000-0000-4000-8000-000000000777'), false, 'Event ne doit pas persister apres rollback');
  assert.equal(db.evidence.some((evidence) => evidence.source_record_id === '20000000-0000-4000-8000-000000000777'), false, 'Evidence ne doit pas persister apres rollback');

  console.log(JSON.stringify({
    ok: true,
    endpoint: 'POST /api/purchases/:id/validate-reception',
    route: 'backend/routes/purchaseReceptionUpgrade.js',
    event_type: 'purchase_received',
    evidence_type: 'reception_record',
    idempotent_replay: true,
    multi_store: true,
    rollback: true,
    snapshot_lines: payload.received_products.length,
    old_physical_controls_preserved_as_not_available: true,
    conform_quality_control: true,
    non_conform_temperature_control: true,
    non_conform_packaging_without_temperature: true,
    direct_trade_reception_mode: true,
    direct_trade_controls_not_applicable: true,
    backend_validation: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
