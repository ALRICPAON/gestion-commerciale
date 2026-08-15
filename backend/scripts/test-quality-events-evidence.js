const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  createOrGetQualityEvent,
  createOrGetQualityEvidenceRecord,
  getQualityEventById,
  listEvidenceForEvent,
} = require('../services/quality/events');

const ROOT = path.resolve(__dirname, '..', '..');
const STORE_A = '00000000-0000-4000-8000-000000000001';
const STORE_B = '00000000-0000-4000-8000-000000000002';
const USER_ID = '00000000-0000-4000-8000-000000000101';
const SOURCE_ID = '00000000-0000-4000-8000-000000000201';
const TASK_A = '00000000-0000-4000-8000-000000000401';
const TASK_B = '00000000-0000-4000-8000-000000000402';

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function makeId(prefix, count) {
  const suffix = String(count).padStart(12, '0');
  return `00000000-0000-4000-8000-${suffix}`;
}

function cloneRow(row) {
  return row ? { ...row, payload: { ...(row.payload || {}) } } : row;
}

function eventKey(row) {
  return [
    row.store_id,
    row.event_type,
    row.source_table,
    row.source_id,
    row.source_line_id || '00000000-0000-0000-0000-000000000000',
    row.source_discriminator || '',
  ].join('|');
}

function evidenceKey(row) {
  return [
    row.store_id,
    row.quality_event_id,
    row.evidence_type,
    row.source_record_type || '',
    row.source_record_id || '00000000-0000-0000-0000-000000000000',
    row.source_discriminator || '',
  ].join('|');
}

class FakeQualityDb {
  constructor() {
    this.events = [];
    this.evidence = [];
    this.references = {
      quality_tasks: [
        { id: TASK_A, store_id: STORE_A },
        { id: TASK_B, store_id: STORE_B },
      ],
      quality_task_occurrences: [],
      quality_non_conformities: [],
      quality_documents: [],
      quality_photos: [],
      quality_master_documents: [],
    };
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
      this.txEvents = this.events.map(cloneRow);
      this.txEvidence = this.evidence.map(cloneRow);
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
        recorded_at: new Date(),
        triggered_by: params[7],
        event_status: params[8],
        payload_version: params[9],
        payload: params[10],
        created_by: params[11],
        updated_by: params[11],
        archived_at: null,
      };
      const existing = this.activeEvents().find((item) => !item.archived_at && eventKey(item) === eventKey(row));
      if (existing) return { rows: [] };
      this.eventSeq += 1;
      this.activeEvents().push(row);
      return { rows: [cloneRow(row)] };
    }

    if (normalized.startsWith('SELECT * FROM quality_events WHERE id =')) {
      const row = this.activeEvents().find((item) => item.id === params[0] && item.store_id === params[1] && !item.archived_at);
      return { rows: row ? [cloneRow(row)] : [] };
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
      return { rows: row ? [cloneRow(row)] : [] };
    }

    if (normalized.startsWith('INSERT INTO quality_evidence_records')) {
      const eventId = params[1];
      if (eventId) {
        const event = this.activeEvents().find((item) => item.id === eventId && item.store_id === params[0] && !item.archived_at);
        if (!event) {
          const err = new Error('insert or update on table "quality_evidence_records" violates foreign key constraint');
          err.code = '23503';
          throw err;
        }
      }
      const rowForKey = {
        store_id: params[0],
        quality_event_id: params[1],
        evidence_type: params[2],
        source_record_type: params[8],
        source_record_id: params[9],
        source_discriminator: params[10] || '',
      };
      if (normalized.includes('ON CONFLICT')) {
        const existing = this.activeEvidence().find((item) => (
          !item.archived_at
          && item.source_type !== 'human'
          && item.quality_event_id
          && evidenceKey(item) === evidenceKey(rowForKey)
        ));
        if (existing) return { rows: [] };
      }
      const row = {
        id: makeId('evidence', this.evidenceSeq),
        store_id: params[0],
        quality_event_id: params[1],
        evidence_type: params[2],
        evidence_reference: params[3],
        evidence_status: params[4],
        evidence_at: params[5],
        recorded_at: new Date(),
        recorded_by: params[6],
        source_type: params[7],
        source_record_type: params[8],
        source_record_id: params[9],
        source_discriminator: params[10],
        quality_task_id: params[11],
        occurrence_id: params[12],
        non_conformity_id: params[13],
        document_id: params[14],
        photo_id: params[15],
        master_document_id: params[16],
        payload_version: params[17],
        payload: params[18],
        created_by: params[19],
        updated_by: params[19],
        archived_at: null,
      };
      this.evidenceSeq += 1;
      this.activeEvidence().push(row);
      return { rows: [cloneRow(row)] };
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
      const row = this.activeEvidence().find((item) => (
        !item.archived_at
        && item.source_type !== 'human'
        && evidenceKey(item) === evidenceKey(lookup)
      ));
      return { rows: row ? [cloneRow(row)] : [] };
    }

    if (normalized.startsWith('SELECT * FROM quality_evidence_records')) {
      const rows = this.activeEvidence()
        .filter((item) => item.store_id === params[0] && item.quality_event_id === params[1] && !item.archived_at)
        .map(cloneRow);
      return { rows };
    }

    const referenceMatch = normalized.match(/^SELECT id FROM (quality_tasks|quality_task_occurrences|quality_non_conformities|quality_documents|quality_photos|quality_master_documents) WHERE id =/);
    if (referenceMatch) {
      const rows = (this.references[referenceMatch[1]] || [])
        .filter((item) => item.id === params[0] && item.store_id === params[1])
        .map(cloneRow);
      return { rows };
    }

    throw new Error(`Unhandled fake SQL: ${normalized}`);
  }
}

async function main() {
  const migration = read('backend/db/gestion-commerciale/102_quality_events_evidence_records.sql');
  const rollback = read('backend/db/gestion-commerciale/102_quality_events_evidence_records_rollback.sql');
  const service = read('backend/services/quality/events.js');
  const docs = read('docs/QUALITY_EVENTS_EVIDENCE_FOUNDATION.md');

  assert(migration.includes('CREATE TABLE IF NOT EXISTS quality_events'), 'Table quality_events manquante');
  assert(migration.includes('CREATE TABLE IF NOT EXISTS quality_evidence_records'), 'Table quality_evidence_records manquante');
  assert(migration.includes('uq_quality_events_idempotency'), 'Index idempotence evenement manquant');
  assert(migration.includes('source_discriminator'), 'Discriminant source manquant');
  assert(migration.includes('source_discriminator text NOT NULL DEFAULT'), 'Discriminant source preuve manquant');
  assert(migration.includes('uq_quality_evidence_records_automatic_idempotency'), 'Index idempotence preuve automatique manquant');
  assert(migration.includes('FOREIGN KEY (quality_event_id, store_id)'), 'FK composite evidence -> event manquante');
  assert(migration.includes('REFERENCES quality_events(id, store_id)'), 'Reference composite event/store manquante');
  assert(rollback.includes('DROP TABLE IF EXISTS quality_evidence_records'), 'Rollback evidence manquant');
  assert(rollback.includes('DROP TABLE IF EXISTS quality_events'), 'Rollback events manquant');
  assert(service.includes('createOrGetQualityEvidenceRecord'), 'Service createOrGet evidence manquant');
  assert(service.includes('assertEvidenceReferencesStore'), 'Validation multi-store references optionnelles manquante');
  assert(service.includes('ON CONFLICT'), 'Services createOrGet doivent etre idempotents');
  assert(docs.includes('business event -> quality_events -> 0..n quality_evidence_records'), 'Flux documentaire manquant');

  const db = new FakeQualityDb();
  const first = await createOrGetQualityEvent({
    db,
    storeId: STORE_A,
    eventType: 'reception.temperature_control_required',
    sourceTable: 'supplier_receptions',
    sourceId: SOURCE_ID,
    occurredAt: '2026-08-15T08:00:00.000Z',
    userId: USER_ID,
    payload: { lot: 'A-1' },
  });
  assert.equal(first.created, true, 'Le premier appel doit creer un evenement');

  const second = await createOrGetQualityEvent({
    db,
    storeId: STORE_A,
    eventType: 'reception.temperature_control_required',
    sourceTable: 'supplier_receptions',
    sourceId: SOURCE_ID,
    occurredAt: '2026-08-15T08:01:00.000Z',
    userId: USER_ID,
    payload: { lot: 'A-1' },
  });
  assert.equal(second.created, false, 'Le second appel identique doit relire l evenement existant');
  assert.equal(first.event.id, second.event.id, 'Idempotence: un seul evenement logique attendu');
  assert.equal(db.events.length, 1, 'La base ne doit contenir qu une ligne evenement');

  const otherStore = await createOrGetQualityEvent({
    db,
    storeId: STORE_B,
    eventType: 'reception.temperature_control_required',
    sourceTable: 'supplier_receptions',
    sourceId: SOURCE_ID,
    occurredAt: '2026-08-15T08:00:00.000Z',
  });
  assert.equal(otherStore.created, true, 'Le meme evenement logique sur un autre magasin doit creer une ligne');
  assert.equal(db.events.length, 2, 'Deux magasins doivent produire deux evenements');

  const evidenceResult = await createOrGetQualityEvidenceRecord({
    db,
    storeId: STORE_A,
    qualityEventId: first.event.id,
    evidenceType: 'temperature_reading',
    evidenceReference: 'TEMP-2026-08-15-001',
    evidenceAt: '2026-08-15T08:05:00.000Z',
    sourceType: 'automatic',
    userId: USER_ID,
    payload: { value: 2.4, unit: 'C' },
  });
  assert.equal(evidenceResult.created, true, 'La premiere preuve automatique doit etre creee');
  const evidence = evidenceResult.evidence;
  assert.equal(evidence.quality_event_id, first.event.id, 'La preuve doit etre liee a l evenement');

  const linkedEvidence = await listEvidenceForEvent({ db, storeId: STORE_A, eventId: first.event.id });
  assert.equal(linkedEvidence.length, 1, 'Lecture des preuves liees incorrecte');
  assert.equal(linkedEvidence[0].evidence_type, 'temperature_reading');

  const humanEvidenceResult = await createOrGetQualityEvidenceRecord({
    db,
    storeId: STORE_A,
    evidenceType: 'visual_cleanliness_check',
    evidenceAt: '2026-08-15T09:00:00.000Z',
    sourceType: 'human',
    userId: USER_ID,
    payload: { zone: 'atelier' },
  });
  assert.equal(humanEvidenceResult.created, true, 'Une preuve humaine directe doit etre creee sans idempotence forcee');
  assert.equal(humanEvidenceResult.evidence.quality_event_id, null, 'Une preuve humaine directe doit etre acceptee sans evenement');

  await assert.rejects(
    () => createOrGetQualityEvidenceRecord({
      db,
      storeId: STORE_B,
      qualityEventId: first.event.id,
      evidenceType: 'temperature_reading',
      sourceType: 'automatic',
    }),
    /Evenement qualite introuvable pour ce magasin/,
    'Le service doit bloquer un lien preuve magasin B -> evenement magasin A'
  );

  await assert.rejects(
    () => createOrGetQualityEvidenceRecord({
      db,
      storeId: STORE_A,
      qualityEventId: first.event.id,
      evidenceType: 'task_snapshot',
      sourceType: 'automatic',
      qualityTaskId: TASK_B,
    }),
    /Tache qualite introuvable pour ce magasin/,
    'Le service doit bloquer une reference optionnelle cross-store'
  );

  const replayOneEvent = await createOrGetQualityEvent({
    db,
    storeId: STORE_A,
    eventType: 'purchase_received',
    sourceTable: 'purchase_receipts',
    sourceId: '00000000-0000-4000-8000-000000000501',
    occurredAt: '2026-08-15T11:00:00.000Z',
  });
  assert.equal(replayOneEvent.created, true, 'Premier passage futur: event cree');
  const replayOneEvidence = await createOrGetQualityEvidenceRecord({
    db,
    storeId: STORE_A,
    qualityEventId: replayOneEvent.event.id,
    evidenceType: 'reception_record',
    sourceType: 'automatic',
    sourceRecordType: 'purchase_receipts',
    sourceRecordId: '00000000-0000-4000-8000-000000000501',
    sourceDiscriminator: 'header',
  });
  assert.equal(replayOneEvidence.created, true, 'Premier passage futur: preuve creee');

  const replayTwoEvent = await createOrGetQualityEvent({
    db,
    storeId: STORE_A,
    eventType: 'purchase_received',
    sourceTable: 'purchase_receipts',
    sourceId: '00000000-0000-4000-8000-000000000501',
    occurredAt: '2026-08-15T11:01:00.000Z',
  });
  assert.equal(replayTwoEvent.created, false, 'Rejeu futur: event relu');
  const replayTwoEvidence = await createOrGetQualityEvidenceRecord({
    db,
    storeId: STORE_A,
    qualityEventId: replayTwoEvent.event.id,
    evidenceType: 'reception_record',
    sourceType: 'automatic',
    sourceRecordType: 'purchase_receipts',
    sourceRecordId: '00000000-0000-4000-8000-000000000501',
    sourceDiscriminator: 'header',
  });
  assert.equal(replayTwoEvidence.created, false, 'Rejeu futur: preuve relue');
  assert.equal(
    db.evidence.filter((item) => item.quality_event_id === replayOneEvent.event.id && item.evidence_type === 'reception_record').length,
    1,
    'Un replay ne doit pas produire deux preuves automatiques identiques'
  );

  const secondEvidenceType = await createOrGetQualityEvidenceRecord({
    db,
    storeId: STORE_A,
    qualityEventId: replayOneEvent.event.id,
    evidenceType: 'traceability_snapshot',
    sourceType: 'automatic',
    sourceRecordType: 'purchase_receipts',
    sourceRecordId: '00000000-0000-4000-8000-000000000501',
    sourceDiscriminator: 'header',
  });
  assert.equal(secondEvidenceType.created, true, 'Deux types de preuve differents doivent coexister pour le meme evenement');

  await db.query('BEGIN');
  const txEvent = await createOrGetQualityEvent({
    db,
    storeId: STORE_A,
    eventType: 'sales.dispatch_control_required',
    sourceTable: 'delivery_notes',
    sourceId: '00000000-0000-4000-8000-000000000301',
    occurredAt: '2026-08-15T10:00:00.000Z',
  });
  await createOrGetQualityEvidenceRecord({
    db,
    storeId: STORE_A,
    qualityEventId: txEvent.event.id,
    evidenceType: 'photo_before_dispatch',
    sourceType: 'human',
  });
  assert(await getQualityEventById({ db, storeId: STORE_A, eventId: txEvent.event.id }), 'Evenement transactionnel non visible dans la transaction');
  await db.query('ROLLBACK');
  assert.equal(await getQualityEventById({ db, storeId: STORE_A, eventId: txEvent.event.id }), null, 'Rollback: evenement ne doit pas persister');
  assert.equal(db.evidence.some((item) => item.quality_event_id === txEvent.event.id), false, 'Rollback: preuve ne doit pas persister');

  console.log(JSON.stringify({
    ok: true,
    migration: '102_quality_events_evidence_records.sql',
    rollback: '102_quality_events_evidence_records_rollback.sql',
    idempotent_events: true,
    idempotent_automatic_evidence: true,
    distinct_evidence_types_allowed: true,
    multi_store_isolated: true,
    optional_reference_store_guard: true,
    rollback_event_and_evidence: true,
    linked_evidence_fk_checked: true,
    human_evidence_without_event: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
