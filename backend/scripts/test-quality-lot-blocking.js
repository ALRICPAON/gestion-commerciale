const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  ALREADY_BLOCKED_CODE,
  BLOCKED_CODE,
  NOT_BLOCKED_CODE,
  assertLotUsable,
  availableLotCondition,
  blockLotForQuality,
  getLotQualityStatus,
  releaseLotForQuality,
} = require('../services/quality/lotBlocking');

const ROOT = path.resolve(__dirname, '..', '..');
const STORE_A = '50000000-0000-4000-8000-000000000001';
const STORE_B = '50000000-0000-4000-8000-000000000002';
const USER_ID = '50000000-0000-4000-8000-000000000101';
const LOT_A = '50000000-0000-4000-8000-000000000201';
const LOT_B = '50000000-0000-4000-8000-000000000202';
const NC_ID = '50000000-0000-4000-8000-000000000301';

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function clone(row) {
  return row ? { ...row } : row;
}

class FakeLotDb {
  constructor() {
    this.lots = [
      { id: LOT_A, store_id: STORE_A, lot_code: 'LOT-A', quality_status: 'available', quality_non_conformity_id: null },
      { id: LOT_B, store_id: STORE_B, lot_code: 'LOT-B', quality_status: 'available', quality_non_conformity_id: null },
    ];
    this.history = [];
    this.lockedReads = 0;
  }

  async query(sql, params = []) {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();

    if (normalized.startsWith('SELECT id, store_id, lot_code, quality_status')) {
      if (normalized.includes('FOR UPDATE')) this.lockedReads += 1;
      const row = this.lots.find((lot) => lot.id === params[0] && lot.store_id === params[1]);
      return { rows: row ? [clone(row)] : [] };
    }

    if (normalized.startsWith('UPDATE lots') && normalized.includes("SET quality_status = 'blocked'")) {
      const row = this.lots.find((lot) => lot.id === params[0] && lot.store_id === params[1]);
      if (!row) return { rows: [] };
      Object.assign(row, {
        quality_status: 'blocked',
        quality_block_reason: params[2],
        quality_block_reason_type: params[3],
        quality_block_comment: params[4],
        quality_blocked_by: row.quality_blocked_by || params[5],
        quality_released_at: null,
        quality_released_by: null,
        quality_release_reason: null,
        quality_release_comment: null,
        quality_non_conformity_id: params[6] || row.quality_non_conformity_id,
      });
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith('UPDATE lots') && normalized.includes("SET quality_status = 'available'")) {
      const row = this.lots.find((lot) => lot.id === params[0] && lot.store_id === params[1]);
      if (!row) return { rows: [] };
      Object.assign(row, {
        quality_status: 'available',
        quality_released_by: params[2],
        quality_release_reason: params[3],
        quality_release_comment: params[4],
      });
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith('INSERT INTO quality_lot_status_history')) {
      const row = {
        id: `history-${this.history.length + 1}`,
        store_id: params[0],
        lot_id: params[1],
        previous_status: params[2],
        new_status: params[3],
        reason_type: params[4],
        reason: params[5],
        comment: params[6],
        source_type: params[7],
        source_id: params[8],
        quality_non_conformity_id: params[9],
        changed_by: params[10],
      };
      this.history.push(row);
      return { rows: [clone(row)] };
    }

    throw new Error(`Unhandled fake SQL: ${normalized}`);
  }
}

async function testCentralService() {
  const db = new FakeLotDb();

  assert.strictEqual(availableLotCondition('l'), "COALESCE(l.quality_status, 'available') <> 'blocked'");
  assert.strictEqual((await getLotQualityStatus(db, STORE_A, LOT_A)).quality_status, 'available');

  const blocked = await blockLotForQuality(db, {
    storeId: STORE_A,
    lotId: LOT_A,
    userId: USER_ID,
    reason: 'Suspicion odeur',
    reasonType: 'quality_suspicion',
    comment: 'Isolation en chambre froide',
    sourceType: 'traceability_manual',
    sourceId: LOT_A,
    qualityNonConformityId: NC_ID,
  });

  assert.strictEqual(blocked.lot.quality_status, 'blocked');
  assert.strictEqual(blocked.history.previous_status, 'available');
  assert.strictEqual(blocked.history.new_status, 'blocked');
  assert.strictEqual(db.history.length, 1);
  assert.strictEqual(db.lockedReads, 1);

  await assert.rejects(
    () => blockLotForQuality(db, {
      storeId: STORE_A,
      lotId: LOT_A,
      userId: USER_ID,
      reason: 'Nouveau motif interdit',
      reasonType: 'quality_suspicion',
    }),
    (error) => error.code === ALREADY_BLOCKED_CODE && error.status === 409 && error.details.motif === 'Suspicion odeur'
  );
  assert.strictEqual(db.history.length, 1);
  assert.strictEqual((await getLotQualityStatus(db, STORE_A, LOT_A)).quality_block_reason, 'Suspicion odeur');

  await assert.rejects(
    () => assertLotUsable(db, STORE_A, LOT_A),
    (error) => error.code === BLOCKED_CODE && error.status === 409 && error.details.lot_id === LOT_A
  );

  assert.strictEqual((await assertLotUsable(db, STORE_B, LOT_B)).id, LOT_B);
  assert.strictEqual(await assertLotUsable(db, STORE_A, LOT_B), null);

  await assert.rejects(
    () => blockLotForQuality(db, { storeId: STORE_A, lotId: LOT_A, userId: USER_ID, reason: '', reasonType: 'quality_suspicion' }),
    /Motif de blocage obligatoire/
  );
  await assert.rejects(
    () => blockLotForQuality(db, { storeId: STORE_A, lotId: LOT_A, userId: USER_ID, reason: 'Suspicion', reasonType: '' }),
    /Type de motif de blocage obligatoire/
  );

  await assert.rejects(
    () => releaseLotForQuality(db, { storeId: STORE_A, lotId: LOT_A, userId: USER_ID, reason: 'Analyse OK', comment: '' }),
    /Motif et commentaire obligatoires/
  );

  const released = await releaseLotForQuality(db, {
    storeId: STORE_A,
    lotId: LOT_A,
    userId: USER_ID,
    reason: 'Analyse OK',
    comment: 'Liberation responsable qualite',
  });
  assert.strictEqual(released.lot.quality_status, 'available');
  assert.strictEqual(db.history.length, 2);

  await assert.rejects(
    () => releaseLotForQuality(db, { storeId: STORE_A, lotId: LOT_A, userId: USER_ID, reason: 'Analyse OK', comment: 'Deja libre' }),
    (error) => error.code === NOT_BLOCKED_CODE && error.status === 409
  );
  assert.strictEqual(db.history.length, 2);
  assert.strictEqual(db.lockedReads, 4);
}

function testStaticGuards() {
  const migration = read('backend/db/gestion-commerciale/103_quality_lot_blocking.sql');
  assert(migration.includes('quality_status text NOT NULL DEFAULT'));
  assert(migration.includes('CREATE TABLE IF NOT EXISTS quality_lot_status_history'));
  assert(migration.includes('lots_id_store_id_unique'));
  assert(migration.includes('quality_non_conformities_id_store_id_unique'));
  assert(migration.includes('FOREIGN KEY (lot_id, store_id)'));
  assert(migration.includes('FOREIGN KEY (quality_non_conformity_id, store_id)'));
  assert(read('backend/db/gestion-commerciale/103_quality_lot_blocking_rollback.sql').includes('DROP TABLE IF EXISTS quality_lot_status_history'));

  const lotBlocking = read('backend/services/quality/lotBlocking.js');
  assert(lotBlocking.includes('FOR UPDATE'));
  assert(lotBlocking.includes('LOT_ALREADY_QUALITY_BLOCKED'));
  assert(lotBlocking.includes('LOT_NOT_QUALITY_BLOCKED'));

  const purchase = read('backend/routes/purchaseReceptionUpgrade.js');
  assert(purchase.includes('createNonConformity'));
  assert(purchase.includes('blockLotForQuality'));
  assert(purchase.includes("qualityControl.corrective_action === 'lot_isolation'"));

  [
    'backend/routes/deliveryNotes.js',
    'backend/routes/deliveryNotesEditable.js',
    'backend/routes/deliveryNoteValidationForced.js',
    'backend/routes/deliveryNotesNegoceEditable.js',
    'backend/routes/negoceFixes.js',
    'backend/routes/transformations.js',
    'backend/routes/transformationValidation.js',
  ].forEach((relativePath) => {
    const source = read(relativePath);
    assert(source.includes('availableLotCondition'), `${relativePath} must filter blocked lots`);
  });

  const traceabilityRoute = read('backend/routes/traceability.js');
  assert(traceabilityRoute.includes("router.post('/lots/:lotId/block-quality'"));
  assert(traceabilityRoute.includes("router.post('/lots/:lotId/release-quality'"));
  assert(traceabilityRoute.includes('quality_lot_status_history'));

  const traceabilityFront = read('frontend/js/traceability.js');
  assert(traceabilityFront.includes('qualityStatusBadge'));
  assert(traceabilityFront.includes('block-quality'));
  assert(traceabilityFront.includes('release-quality'));
  assert(read('frontend/traceability.html').includes('traceability.js?v=3'));
}

async function main() {
  await testCentralService();
  testStaticGuards();
  console.log(JSON.stringify({ ok: true, tests: ['central_service', 'static_route_guards'] }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
