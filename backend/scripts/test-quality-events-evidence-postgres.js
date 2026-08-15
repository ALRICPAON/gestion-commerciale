const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Client } = require('pg');

require('../../env');

const {
  createOrGetQualityEvent,
  createOrGetQualityEvidenceRecord,
  getQualityEventById,
} = require('../services/quality/events');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATION = path.join(ROOT, 'backend', 'db', 'gestion-commerciale', '102_quality_events_evidence_records.sql');

const STORE_A = '10000000-0000-4000-8000-000000000246';
const STORE_B = '10000000-0000-4000-8000-000000000247';
const USER_A = '10000000-0000-4000-8000-000000000248';
const SOURCE_ID = '10000000-0000-4000-8000-000000000249';
const ROLLBACK_SOURCE_ID = '10000000-0000-4000-8000-000000000250';
const ZERO_SOURCE_ID = '10000000-0000-4000-8000-000000000251';

function requireTestDatabaseUrl() {
  const databaseUrl = process.env.QUALITY_EVENTS_EVIDENCE_PG_TEST_DATABASE_URL;
  if (process.env.QUALITY_EVENTS_EVIDENCE_PG_TEST !== '1' || !databaseUrl) {
    console.log(JSON.stringify({
      ok: false,
      skipped: true,
      reason: 'Set QUALITY_EVENTS_EVIDENCE_PG_TEST=1 and QUALITY_EVENTS_EVIDENCE_PG_TEST_DATABASE_URL to run the real PostgreSQL integration test.',
    }, null, 2));
    process.exit(0);
  }
  const parsedUrl = new URL(databaseUrl);
  if (
    parsedUrl.pathname.replace(/^\//, '') === 'gestion_commerciale'
    && process.env.QUALITY_EVENTS_EVIDENCE_ALLOW_PRODUCTION_DB !== 'I_UNDERSTAND_THIS_IS_NOT_A_TEST_DB'
  ) {
    console.log(JSON.stringify({
      ok: false,
      skipped: true,
      reason: 'Refusing to run against database gestion_commerciale without explicit production override.',
    }, null, 2));
    process.exit(0);
  }
  return databaseUrl;
}

async function cleanup(client) {
  await client.query(
    `DELETE FROM stores
     WHERE id IN ($1::uuid, $2::uuid)
       AND code IN ('codex_qev_store_a_246', 'codex_qev_store_b_246')`,
    [STORE_A, STORE_B]
  );
}

async function seedStores(client) {
  await client.query(
    `INSERT INTO stores (id, code, name, client_key)
     VALUES
       ($1::uuid, 'codex_qev_store_a_246', 'Codex QEV Store A', 'codex_qev_a_246'),
       ($2::uuid, 'codex_qev_store_b_246', 'Codex QEV Store B', 'codex_qev_b_246')
     ON CONFLICT (id) DO NOTHING`,
    [STORE_A, STORE_B]
  );
  await client.query(
    `INSERT INTO users (id, store_id, email, password_hash, role)
     VALUES ($1::uuid, $2::uuid, 'codex-qev-246@example.test', 'test', 'qualite')
     ON CONFLICT (store_id, email) DO NOTHING`,
    [USER_A, STORE_A]
  );
}

async function main() {
  const client = new Client({ connectionString: requireTestDatabaseUrl() });
  await client.connect();

  try {
    await client.query(fs.readFileSync(MIGRATION, 'utf8'));
    await cleanup(client);
    await seedStores(client);

    await client.query('BEGIN');
    const firstEvent = await createOrGetQualityEvent({
      db: client,
      storeId: STORE_A,
      eventType: 'purchase_received',
      sourceTable: 'purchase_receipts',
      sourceId: SOURCE_ID,
      occurredAt: '2026-08-15T12:00:00.000Z',
      userId: USER_A,
      payload: { test: true },
    });
    assert.equal(firstEvent.created, true, 'Premier event doit etre cree');

    const secondEvent = await createOrGetQualityEvent({
      db: client,
      storeId: STORE_A,
      eventType: 'purchase_received',
      sourceTable: 'purchase_receipts',
      sourceId: SOURCE_ID,
      occurredAt: '2026-08-15T12:01:00.000Z',
      userId: USER_A,
      payload: { test: true },
    });
    assert.equal(secondEvent.created, false, 'Rejeu event doit relire');
    assert.equal(secondEvent.event.id, firstEvent.event.id, 'Rejeu event doit garder le meme id');

    const firstEvidence = await createOrGetQualityEvidenceRecord({
      db: client,
      storeId: STORE_A,
      qualityEventId: firstEvent.event.id,
      evidenceType: 'reception_record',
      sourceType: 'automatic',
      sourceRecordType: 'purchase_receipts',
      sourceRecordId: SOURCE_ID,
      sourceDiscriminator: 'header',
      userId: USER_A,
      payload: { generated: true },
    });
    assert.equal(firstEvidence.created, true, 'Premiere evidence automatique doit etre creee');

    const secondEvidence = await createOrGetQualityEvidenceRecord({
      db: client,
      storeId: STORE_A,
      qualityEventId: firstEvent.event.id,
      evidenceType: 'reception_record',
      sourceType: 'automatic',
      sourceRecordType: 'purchase_receipts',
      sourceRecordId: SOURCE_ID,
      sourceDiscriminator: 'header',
      userId: USER_A,
      payload: { generated: true },
    });
    assert.equal(secondEvidence.created, false, 'Rejeu evidence automatique doit relire');
    assert.equal(secondEvidence.evidence.id, firstEvidence.evidence.id, 'Rejeu evidence doit garder le meme id');

    const otherEvidenceType = await createOrGetQualityEvidenceRecord({
      db: client,
      storeId: STORE_A,
      qualityEventId: firstEvent.event.id,
      evidenceType: 'traceability_snapshot',
      sourceType: 'automatic',
      sourceRecordType: 'purchase_receipts',
      sourceRecordId: SOURCE_ID,
      sourceDiscriminator: 'header',
      userId: USER_A,
      payload: { generated: true },
    });
    assert.equal(otherEvidenceType.created, true, 'Deux types de preuves doivent coexister');

    const otherStoreEvent = await createOrGetQualityEvent({
      db: client,
      storeId: STORE_B,
      eventType: 'purchase_received',
      sourceTable: 'purchase_receipts',
      sourceId: SOURCE_ID,
      occurredAt: '2026-08-15T12:00:00.000Z',
      payload: { test: true },
    });
    assert.equal(otherStoreEvent.created, true, 'Le meme event logique doit etre distinct par magasin');

    await client.query('SAVEPOINT qev_fk_check');
    let fkRejected = false;
    try {
      await client.query(
        `INSERT INTO quality_evidence_records (
          store_id, quality_event_id, evidence_type, source_type, source_record_type, source_record_id
        ) VALUES ($1::uuid, $2::uuid, 'reception_record', 'automatic', 'purchase_receipts', $3::uuid)`,
        [STORE_B, firstEvent.event.id, ZERO_SOURCE_ID]
      );
    } catch (error) {
      fkRejected = /23503|violates foreign key constraint|insert or update on table/.test(`${error.code || ''} ${error.message || ''}`);
    }
    await client.query('ROLLBACK TO SAVEPOINT qev_fk_check');
    await client.query('RELEASE SAVEPOINT qev_fk_check');
    assert.equal(fkRejected, true, 'La FK composite event/store doit refuser un croisement magasin');

    const counts = await client.query(
      `SELECT
         (SELECT count(*)::integer FROM quality_events WHERE store_id = $1::uuid AND source_id = $2::uuid) AS events_a,
         (SELECT count(*)::integer FROM quality_events WHERE store_id = $4::uuid AND source_id = $2::uuid) AS events_b,
         (SELECT count(*)::integer FROM quality_evidence_records WHERE store_id = $1::uuid AND quality_event_id = $3::uuid AND evidence_type = 'reception_record') AS reception_records,
         (SELECT count(*)::integer FROM quality_evidence_records WHERE store_id = $1::uuid AND quality_event_id = $3::uuid) AS evidence_total`,
      [STORE_A, SOURCE_ID, firstEvent.event.id, STORE_B]
    );
    assert.equal(counts.rows[0].events_a, 1, 'Un seul event attendu apres rejeu');
    assert.equal(counts.rows[0].events_b, 1, 'Un event distinct attendu sur le second magasin');
    assert.equal(counts.rows[0].reception_records, 1, 'Une seule evidence reception_record attendue apres rejeu');
    assert.equal(counts.rows[0].evidence_total, 2, 'Deux types evidence attendus pour le meme event');
    await client.query('ROLLBACK');

    await client.query('BEGIN');
    const rollbackEvent = await createOrGetQualityEvent({
      db: client,
      storeId: STORE_A,
      eventType: 'rollback_test',
      sourceTable: 'quality_events_pg_test',
      sourceId: ROLLBACK_SOURCE_ID,
      occurredAt: '2026-08-15T13:00:00.000Z',
      userId: USER_A,
    });
    await createOrGetQualityEvidenceRecord({
      db: client,
      storeId: STORE_A,
      qualityEventId: rollbackEvent.event.id,
      evidenceType: 'rollback_evidence',
      sourceType: 'automatic',
      sourceRecordType: 'quality_events_pg_test',
      sourceRecordId: ROLLBACK_SOURCE_ID,
      sourceDiscriminator: 'rollback',
      userId: USER_A,
    });
    assert(await getQualityEventById({ db: client, storeId: STORE_A, eventId: rollbackEvent.event.id }), 'Event rollback doit etre visible avant rollback');
    await client.query('ROLLBACK');

    const rollbackCounts = await client.query(
      `SELECT
         (SELECT count(*)::integer FROM quality_events WHERE source_id = $1::uuid) AS events,
         (SELECT count(*)::integer FROM quality_evidence_records WHERE source_record_id = $1::uuid) AS evidence`,
      [ROLLBACK_SOURCE_ID]
    );
    assert.equal(rollbackCounts.rows[0].events, 0, 'Aucun event ne doit subsister apres rollback');
    assert.equal(rollbackCounts.rows[0].evidence, 0, 'Aucune evidence ne doit subsister apres rollback');

    console.log(JSON.stringify({
      ok: true,
      migration_applied: true,
      event_replay: true,
      automatic_evidence_replay: true,
      distinct_evidence_types_allowed: true,
      multi_store_separation: true,
      transaction_rollback: true,
      event_store_fk_rejected: true,
    }, null, 2));
  } finally {
    await cleanup(client).catch(() => {});
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
