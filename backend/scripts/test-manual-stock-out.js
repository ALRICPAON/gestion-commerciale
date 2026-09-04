const assert = require('assert');

const {
  MANUAL_STOCK_OUT_REASONS,
  cancelManualStockOut,
  createManualStockOut,
} = require('../services/manualStockOutService');

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const ARTICLE_KG = '22222222-2222-4222-8222-222222222222';
const ARTICLE_PIECE = '33333333-3333-4333-8333-333333333333';
const LOT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LOT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOT_PIECE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const REQUEST_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const MOVEMENT_IDS = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000007',
  '10000000-0000-4000-8000-000000000008',
];

class FakeDb {
  constructor() {
    this.lots = new Map();
    this.movements = [];
    this.summary = new Map();
    this.nextMovement = 1;
    this.queryLog = [];
    this.lockedKeys = new Set();
    this.lockWaiters = new Map();
  }

  addLot(lot) {
    this.lots.set(lot.id, {
      store_id: STORE_ID,
      client_key: 'client-key',
      article_id: lot.article_id || ARTICLE_KG,
      unit: lot.unit || 'kg',
      plu: lot.plu || 'ART',
      designation: lot.designation || 'Article',
      lot_code: lot.lot_code || lot.id.slice(0, 8),
      supplier_lot_number: lot.supplier_lot_number || null,
      qty_initial: lot.qty_initial ?? lot.qty_remaining,
      qty_remaining: lot.qty_remaining,
      unit_cost_ex_vat: lot.unit_cost_ex_vat || 10,
      ...lot,
    });
  }

  async query(sql, params = []) {
    this.queryLog.push({ sql, params });

    if (sql.includes('pg_advisory_xact_lock')) {
      await this.acquireRequestLock(params[0]);
      return { rows: [] };
    }

    if (sql.includes("sm.source_table = 'manual_stock_out'") && sql.includes('sm.source_id = $2')) {
      const movement = this.movements.find((entry) => entry.store_id === params[0] && entry.source_id === params[1] && entry.quantity < 0);
      if (movement) this.releaseRequestLock(`manual_stock_out:${params[0]}:${params[1]}`);
      return { rows: movement ? [{ ...movement, lot_qty_remaining: this.lots.get(movement.lot_id)?.qty_remaining || 0 }] : [] };
    }

    if (sql.includes('FROM lots l') && sql.includes('JOIN articles a') && sql.includes('FOR UPDATE OF l')) {
      const lot = this.lots.get(params[0]);
      return { rows: lot && lot.store_id === params[1] && lot.article_id === params[2] ? [{ ...lot }] : [] };
    }

    if (sql.includes('SET qty_remaining = qty_remaining - $1')) {
      const [qty, lotId, storeId, articleId] = params;
      const lot = this.lots.get(lotId);
      if (!lot || lot.store_id !== storeId || lot.article_id !== articleId || lot.qty_remaining < qty) return { rows: [] };
      lot.qty_remaining = Number((lot.qty_remaining - qty).toFixed(3));
      return { rows: [{ ...lot }] };
    }

    if (sql.includes('SET qty_remaining = qty_remaining + $1')) {
      const [qty, lotId, storeId, articleId] = params;
      const lot = this.lots.get(lotId);
      if (!lot || lot.store_id !== storeId || lot.article_id !== articleId) return { rows: [] };
      lot.qty_remaining = Number((lot.qty_remaining + qty).toFixed(3));
      return { rows: [{ ...lot }] };
    }

    if (sql.includes('INSERT INTO stock_movements')) {
      const isCancel = sql.includes("'manual_stock_out_cancel'");
      const movement = isCancel
        ? {
          id: MOVEMENT_IDS[this.nextMovement++ - 1],
          store_id: params[0],
          client_key: params[1],
          article_id: params[2],
          lot_id: params[3],
          movement_type: 'manual_stock_out_cancel',
          quantity: params[4],
          unit_cost_ex_vat: params[5],
          source_table: 'manual_stock_out_cancel',
          source_id: params[6],
          notes: params[7],
          created_by: params[8],
          created_at: new Date().toISOString(),
        }
        : {
          id: MOVEMENT_IDS[this.nextMovement++ - 1],
          store_id: params[0],
          client_key: params[1],
          article_id: params[2],
          lot_id: params[3],
          movement_type: params[4],
          quantity: params[5],
          unit_cost_ex_vat: params[6],
          source_table: 'manual_stock_out',
          source_id: params[7],
          notes: params[8],
          created_by: params[9],
          created_at: params[10] || new Date().toISOString(),
        };
      this.movements.push(movement);
      if (movement.source_table === 'manual_stock_out' && movement.source_id) {
        this.releaseRequestLock(`manual_stock_out:${movement.store_id}:${movement.source_id}`);
      }
      return { rows: [movement] };
    }

    if (sql.includes('COALESCE(SUM(qty_remaining), 0) AS qty')) {
      const [storeId, articleId] = params;
      const lots = Array.from(this.lots.values()).filter((lot) => lot.store_id === storeId && lot.article_id === articleId && lot.qty_remaining > 0);
      const qty = lots.reduce((sum, lot) => sum + lot.qty_remaining, 0);
      const value = lots.reduce((sum, lot) => sum + lot.qty_remaining * lot.unit_cost_ex_vat, 0);
      return { rows: [{ qty, value, next_dlc: null }] };
    }

    if (sql.includes('INSERT INTO stock_summary')) {
      const [, articleId, qty, value, pma, nextDlc] = params;
      this.summary.set(articleId, {
        stock_quantity: qty,
        stock_value_ex_vat: value,
        pma,
        next_dlc: nextDlc,
      });
      return { rows: [] };
    }

    if (sql.includes('JOIN lots l') && sql.includes("sm.source_table = 'manual_stock_out'") && sql.includes('sm.id = $1')) {
      const movement = this.movements.find((entry) => entry.id === params[0] && entry.store_id === params[1] && entry.quantity < 0);
      return { rows: movement ? [{ ...movement, current_lot_qty: this.lots.get(movement.lot_id)?.qty_remaining || 0 }] : [] };
    }

    if (sql.includes("source_table = 'manual_stock_out_cancel'") && sql.includes('source_id = $2')) {
      return { rows: this.movements.some((entry) => entry.source_table === 'manual_stock_out_cancel' && entry.source_id === params[1]) ? [{ id: 'existing-cancel' }] : [] };
    }

    throw new Error(`Unhandled fake SQL: ${sql}`);
  }

  async acquireRequestLock(key) {
    if (!this.lockedKeys.has(key)) {
      this.lockedKeys.add(key);
      return;
    }

    await new Promise((resolve) => {
      const waiters = this.lockWaiters.get(key) || [];
      waiters.push(resolve);
      this.lockWaiters.set(key, waiters);
    });
    this.lockedKeys.add(key);
  }

  releaseRequestLock(key) {
    const waiters = this.lockWaiters.get(key) || [];
    if (waiters.length) {
      const next = waiters.shift();
      this.lockWaiters.set(key, waiters);
      next();
      return;
    }
    this.lockedKeys.delete(key);
  }
}

async function expectReject(fn, status) {
  let error = null;
  try {
    await fn();
  } catch (err) {
    error = err;
  }
  assert(error, 'Expected rejection');
  assert.strictEqual(error.status, status);
}

async function manualOut(db, overrides = {}) {
  return createManualStockOut(db, {
    storeId: STORE_ID,
    clientKey: 'client-key',
    articleId: ARTICLE_KG,
    lotId: LOT_A,
    quantity: 2,
    reasonCode: 'waste',
    comment: 'Caisse tombee',
    movementDate: '2026-09-04',
    userId: USER_ID,
    requestId: REQUEST_ID,
    ...overrides,
  });
}

(async () => {
  assert(MANUAL_STOCK_OUT_REASONS.some((reason) => reason.code === 'supplier_return'), 'Motif retour fournisseur expose');

  const db1 = new FakeDb();
  db1.addLot({ id: LOT_A, qty_remaining: 5, unit: 'kg' });
  const result1 = await manualOut(db1);
  assert.strictEqual(Number(result1.lot.qty_remaining), 3, 'Test 1: reste 3 kg');
  assert.strictEqual(result1.movement.quantity, -2);
  assert.strictEqual(db1.summary.get(ARTICLE_KG).stock_quantity, 3, 'Test 10: summary egale total lots apres sortie');

  const db2 = new FakeDb();
  db2.addLot({ id: LOT_A, qty_remaining: 2.8, unit: 'kg' });
  await expectReject(() => manualOut(db2, { quantity: 4, requestId: null }), 409);

  const db3 = new FakeDb();
  db3.addLot({ id: LOT_PIECE, article_id: ARTICLE_PIECE, qty_remaining: 5, unit: 'piece' });
  const result3 = await manualOut(db3, { articleId: ARTICLE_PIECE, lotId: LOT_PIECE, quantity: 2, requestId: null });
  assert.strictEqual(Number(result3.lot.qty_remaining), 3, 'Test 3: reste 3 pieces');

  const db4 = new FakeDb();
  db4.addLot({ id: LOT_A, qty_remaining: 5, unit: 'kg' });
  db4.addLot({ id: LOT_B, qty_remaining: 7, unit: 'kg' });
  await manualOut(db4, { lotId: LOT_B, quantity: 2, requestId: null });
  assert.strictEqual(db4.lots.get(LOT_A).qty_remaining, 5, 'Test 4: premier lot intact');
  assert.strictEqual(db4.lots.get(LOT_B).qty_remaining, 5, 'Test 4: seul le lot choisi baisse');

  const db5 = new FakeDb();
  db5.addLot({ id: LOT_A, qty_remaining: 5 });
  await expectReject(() => manualOut(db5, { quantity: 0, requestId: null }), 400);

  const db6 = new FakeDb();
  db6.addLot({ id: LOT_A, qty_remaining: 5 });
  await expectReject(() => manualOut(db6, { reasonCode: 'bad_reason', requestId: null }), 400);

  const db7 = new FakeDb();
  db7.addLot({ id: LOT_A, qty_remaining: 5 });
  const [firstConcurrent, secondConcurrent] = await Promise.all([
    manualOut(db7, { requestId: REQUEST_ID }),
    manualOut(db7, { requestId: REQUEST_ID }),
  ]);
  assert.strictEqual(firstConcurrent.duplicate, false, 'Test 7.1: premiere requete cree la sortie');
  assert.strictEqual(secondConcurrent.duplicate, true, 'Test 7.1: requete concurrente reutilise la sortie');
  assert.strictEqual(db7.lots.get(LOT_A).qty_remaining, 3, 'Test 7.1: un seul destockage concurrent');
  assert.strictEqual(db7.movements.filter((movement) => movement.source_table === 'manual_stock_out').length, 1, 'Test 7.1: un seul mouvement concurrent');

  const duplicate = await manualOut(db7, { requestId: REQUEST_ID });
  assert.strictEqual(duplicate.duplicate, true, 'Test 7: double requete idempotente');
  assert.strictEqual(db7.lots.get(LOT_A).qty_remaining, 3, 'Test 7.2: replay apres succes sans double destockage');
  assert.strictEqual(db7.movements.filter((movement) => movement.source_table === 'manual_stock_out').length, 1, 'Test 7.2: aucun nouveau mouvement');

  await cancelManualStockOut(db7, {
    storeId: STORE_ID,
    movementId: firstConcurrent.movement.id,
    comment: 'Annulation apres sortie idempotente',
    userId: USER_ID,
  });
  const replayAfterCancel = await manualOut(db7, { requestId: REQUEST_ID });
  assert.strictEqual(replayAfterCancel.duplicate, true, 'Test 8.1: annulation ne rend pas le request_id reutilisable');
  assert.strictEqual(db7.lots.get(LOT_A).qty_remaining, 5, 'Test 8.1: pas de nouveau destockage apres annulation');
  assert.strictEqual(db7.movements.filter((movement) => movement.source_table === 'manual_stock_out_cancel').length, 1, 'Test 8.1: un mouvement inverse conserve');

  const db8 = new FakeDb();
  db8.addLot({ id: LOT_A, qty_remaining: 5 });
  const out = await manualOut(db8, { quantity: 2, requestId: null });
  const cancellation = await cancelManualStockOut(db8, {
    storeId: STORE_ID,
    movementId: out.movement.id,
    comment: 'Erreur de saisie',
    userId: USER_ID,
  });
  assert.strictEqual(cancellation.movement.quantity, 2, 'Test 8: mouvement inverse');
  assert.strictEqual(Number(cancellation.lot.qty_remaining), 5, 'Test 8: stock restaure');

  const notes = JSON.parse(out.movement.notes);
  assert.strictEqual(notes.user_id, USER_ID, 'Test 9: utilisateur');
  assert.strictEqual(notes.movement_date, '2026-09-04', 'Test 9: date');
  assert.strictEqual(notes.reason_code, 'waste', 'Test 9: motif');
  assert.strictEqual(notes.comment, 'Caisse tombee', 'Test 9: commentaire');

  const summary = db8.summary.get(ARTICLE_KG);
  assert.strictEqual(summary.stock_quantity, 5, 'Test 10: summary egale total lots apres annulation');

  console.log('OK manual stock out service');
})();
