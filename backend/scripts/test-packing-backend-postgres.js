const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

require('../../env');

const {
  addPackingMaterial,
  addPackingSourceLot,
  createPackingDraft,
  validatePackingOperation,
} = require('../services/packingService');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATION_106 = path.join(ROOT, 'backend', 'db', 'gestion-commerciale', '106_packing_foundation.sql');

const STORE_A = '90000000-0000-4000-8000-000000000001';
const STORE_B = '90000000-0000-4000-8000-000000000002';
const USER_A = '90000000-0000-4000-8000-000000000101';
const ARTICLE_FISH_A = '90000000-0000-4000-8000-000000000201';
const ARTICLE_FISH_B = '90000000-0000-4000-8000-000000000202';
const ARTICLE_OUTPUT = '90000000-0000-4000-8000-000000000203';
const ARTICLE_BOX = '90000000-0000-4000-8000-000000000204';
const ARTICLE_STORE_B = '90000000-0000-4000-8000-000000000205';
const LOT_A = '90000000-0000-4000-8000-000000000301';
const LOT_B = '90000000-0000-4000-8000-000000000302';
const LOT_BOX = '90000000-0000-4000-8000-000000000303';
const LOT_BLOCKED = '90000000-0000-4000-8000-000000000304';
const LOT_STORE_B = '90000000-0000-4000-8000-000000000305';

function requireTestDatabaseUrl() {
  const databaseUrl = process.env.PACKING_PG_TEST_DATABASE_URL;
  if (process.env.PACKING_PG_TEST !== '1' || !databaseUrl) {
    console.log(JSON.stringify({
      ok: false,
      skipped: true,
      reason: 'Set PACKING_PG_TEST=1 and PACKING_PG_TEST_DATABASE_URL to run the real PostgreSQL integration test.',
    }, null, 2));
    process.exit(0);
  }

  const parsedUrl = new URL(databaseUrl);
  if (
    parsedUrl.pathname.replace(/^\//, '') === 'gestion_commerciale'
    && process.env.PACKING_PG_TEST_ALLOW_PRODUCTION_DB !== 'I_UNDERSTAND_THIS_IS_NOT_A_TEST_DB'
  ) {
    console.log(JSON.stringify({
      ok: false,
      skipped: true,
      reason: 'Refusing to run against database gestion_commerciale without explicit test override.',
    }, null, 2));
    process.exit(0);
  }
  return databaseUrl;
}

function servicePool(client) {
  return {
    async connect() {
      return {
        query: (...args) => client.query(...args),
        release() {},
      };
    },
  };
}

async function cleanup(client) {
  await client.query(`DELETE FROM stock_movements WHERE store_id IN ($1::uuid, $2::uuid)`, [STORE_A, STORE_B]).catch(() => {});
  await client.query(`DELETE FROM packing_materials WHERE store_id IN ($1::uuid, $2::uuid)`, [STORE_A, STORE_B]).catch(() => {});
  await client.query(`DELETE FROM packing_source_lots WHERE store_id IN ($1::uuid, $2::uuid)`, [STORE_A, STORE_B]).catch(() => {});
  await client.query(`DELETE FROM packing_operations WHERE store_id IN ($1::uuid, $2::uuid)`, [STORE_A, STORE_B]).catch(() => {});
  await client.query(
    `DELETE FROM stock_summary WHERE store_id IN ($1::uuid, $2::uuid)`,
    [STORE_A, STORE_B]
  ).catch(() => {});
  await client.query(
    `DELETE FROM lots WHERE store_id IN ($1::uuid, $2::uuid)`,
    [STORE_A, STORE_B]
  ).catch(() => {});
  await client.query(
    `DELETE FROM articles WHERE store_id IN ($1::uuid, $2::uuid)`,
    [STORE_A, STORE_B]
  ).catch(() => {});
  await client.query(`DELETE FROM users WHERE id = $1::uuid`, [USER_A]).catch(() => {});
  await client.query(`DELETE FROM stores WHERE id IN ($1::uuid, $2::uuid)`, [STORE_A, STORE_B]).catch(() => {});
}

async function applyMigration(client) {
  await client.query(fs.readFileSync(MIGRATION_106, 'utf8'));
}

async function seed(client) {
  await client.query(
    `INSERT INTO stores(id, code, name, client_key)
     VALUES ($1::uuid, 'PACKA', 'Packing Test A', 'packing-test-a'),
            ($2::uuid, 'PACKB', 'Packing Test B', 'packing-test-b')
     ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name`,
    [STORE_A, STORE_B]
  );
  await client.query(
    `INSERT INTO users(id, store_id, email, password_hash, role)
     VALUES ($1::uuid, $2::uuid, 'packing@test.local', 'x', 'admin')
     ON CONFLICT (store_id, email) DO UPDATE SET role = EXCLUDED.role`,
    [USER_A, STORE_A]
  );
  await client.query(
    `INSERT INTO articles(id, store_id, plu, designation, unit, article_category)
     VALUES
       ($1::uuid, $5::uuid, 'SOLE150', 'SOLE 1/50', 'kg', 'product'),
       ($2::uuid, $5::uuid, 'SOLE120', 'SOLE 1/20', 'kg', 'product'),
       ($3::uuid, $5::uuid, 'SOLE5', 'SOLE COLIS 5 KG', 'kg', 'product'),
       ($4::uuid, $5::uuid, 'BOX5', 'CAISSE POLYSTYRENE 5 KG', 'piece', 'packaging')
     ON CONFLICT (store_id, plu) DO UPDATE
       SET designation = EXCLUDED.designation,
           unit = EXCLUDED.unit,
           article_category = EXCLUDED.article_category`,
    [ARTICLE_FISH_A, ARTICLE_FISH_B, ARTICLE_OUTPUT, ARTICLE_BOX, STORE_A]
  );
  await client.query(
    `INSERT INTO articles(id, store_id, plu, designation, unit, article_category)
     VALUES ($1::uuid, $2::uuid, 'SOLEB', 'SOLE STORE B', 'kg', 'product')
     ON CONFLICT (store_id, plu) DO UPDATE SET article_category = EXCLUDED.article_category`,
    [ARTICLE_STORE_B, STORE_B]
  );
  await client.query(
    `INSERT INTO lots(id, store_id, article_id, lot_code, source_type, qty_initial, qty_remaining, unit_cost_ex_vat, quality_status)
     VALUES
       ($1::uuid, $6::uuid, $7::uuid, 'PACK-FISH-A', 'purchase', 3, 3, 8, 'available'),
       ($2::uuid, $6::uuid, $8::uuid, 'PACK-FISH-B', 'purchase', 7, 7, 10, 'available'),
       ($3::uuid, $6::uuid, $9::uuid, 'PACK-BOX-A', 'purchase', 5, 5, 1.5, 'available'),
       ($4::uuid, $6::uuid, $7::uuid, 'PACK-BLOCKED', 'purchase', 1, 1, 8, 'blocked'),
       ($5::uuid, $10::uuid, $11::uuid, 'PACK-STORE-B', 'purchase', 1, 1, 8, 'available')
     ON CONFLICT (store_id, lot_code) DO UPDATE
       SET qty_initial = EXCLUDED.qty_initial,
           qty_remaining = EXCLUDED.qty_remaining,
           unit_cost_ex_vat = EXCLUDED.unit_cost_ex_vat,
           quality_status = EXCLUDED.quality_status`,
    [LOT_A, LOT_B, LOT_BOX, LOT_BLOCKED, LOT_STORE_B, STORE_A, ARTICLE_FISH_A, ARTICLE_FISH_B, ARTICLE_BOX, STORE_B, ARTICLE_STORE_B]
  );
}

async function main() {
  const databaseUrl = requireTestDatabaseUrl();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const pool = servicePool(client);

  try {
    await applyMigration(client);
    await cleanup(client);
    await seed(client);

    const draft = await createPackingDraft(pool, {
      storeId: STORE_A,
      userId: USER_A,
      clientKey: 'packing-test-a',
      outputArticleId: ARTICLE_OUTPUT,
      packageCount: 2,
      quantityPerPackage: 5,
      notes: 'Integration packing test',
    });
    assert.strictEqual(draft.status, 'draft');
    assert.strictEqual(Number(draft.total_output_quantity), 10);

    await addPackingSourceLot(pool, { storeId: STORE_A, packingOperationId: draft.id, lotId: LOT_A, quantityUsed: 3 });
    await addPackingSourceLot(pool, { storeId: STORE_A, packingOperationId: draft.id, lotId: LOT_B, quantityUsed: 7 });
    const withMaterial = await addPackingMaterial(pool, { storeId: STORE_A, packingOperationId: draft.id, lotId: LOT_BOX, quantityUsed: 2 });
    assert.strictEqual(Number(withMaterial.fish_cost_ex_vat), 94);
    assert.strictEqual(Number(withMaterial.packaging_cost_ex_vat), 3);
    assert.strictEqual(Number(withMaterial.total_cost_ex_vat), 97);
    assert.strictEqual(Number(withMaterial.unit_cost_ex_vat), 9.7);

    await assert.rejects(
      () => addPackingSourceLot(pool, { storeId: STORE_A, packingOperationId: draft.id, lotId: LOT_BLOCKED, quantityUsed: 1 }),
      (error) => error.code === 'PACKING_SOURCE_LOT_BLOCKED'
    );
    await assert.rejects(
      () => addPackingMaterial(pool, { storeId: STORE_A, packingOperationId: draft.id, lotId: LOT_A, quantityUsed: 1 }),
      (error) => error.code === 'PACKING_MATERIAL_ARTICLE_INVALID'
    );
    await assert.rejects(
      () => addPackingSourceLot(pool, { storeId: STORE_A, packingOperationId: draft.id, lotId: LOT_STORE_B, quantityUsed: 1 }),
      (error) => error.code === 'PACKING_SOURCE_ARTICLE_INVALID'
    );

    const validated = await validatePackingOperation(pool, {
      storeId: STORE_A,
      userId: USER_A,
      clientKey: 'packing-test-a',
      packingOperationId: draft.id,
    });
    assert.strictEqual(validated.status, 'validated');
    assert.ok(validated.output_lot_id, 'output lot missing');
    assert.strictEqual(validated.source_lots.length, 2);
    assert.strictEqual(validated.materials.length, 1);

    const lots = await client.query(
      `SELECT id, qty_initial, qty_remaining, unit_cost_ex_vat, source_type, traceability_data
       FROM lots
       WHERE id IN ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
      [LOT_A, LOT_B, LOT_BOX, validated.output_lot_id]
    );
    const byId = Object.fromEntries(lots.rows.map((row) => [row.id, row]));
    assert.strictEqual(Number(byId[LOT_A].qty_remaining), 0);
    assert.strictEqual(Number(byId[LOT_B].qty_remaining), 0);
    assert.strictEqual(Number(byId[LOT_BOX].qty_remaining), 3);
    assert.strictEqual(Number(byId[validated.output_lot_id].qty_initial), 10);
    assert.strictEqual(Number(byId[validated.output_lot_id].qty_remaining), 10);
    assert.strictEqual(Number(byId[validated.output_lot_id].unit_cost_ex_vat), 9.7);
    assert.strictEqual(byId[validated.output_lot_id].source_type, 'packing');
    assert.strictEqual(byId[validated.output_lot_id].traceability_data.source_lots.length, 2);

    const movements = await client.query(
      `SELECT movement_type, quantity
       FROM stock_movements
       WHERE store_id = $1::uuid
         AND source_table = 'packing_operations'
         AND source_id = $2::uuid
       ORDER BY movement_type, quantity`,
      [STORE_A, draft.id]
    );
    assert.deepStrictEqual(
      movements.rows.map((row) => row.movement_type).sort(),
      ['packing_material_out', 'packing_output_in', 'packing_source_out', 'packing_source_out'].sort()
    );

    const summary = await client.query(
      `SELECT article_id, stock_quantity, pma
       FROM stock_summary
       WHERE store_id = $1::uuid
         AND article_id IN ($2::uuid, $3::uuid, $4::uuid)`,
      [STORE_A, ARTICLE_OUTPUT, ARTICLE_BOX, ARTICLE_FISH_A]
    );
    const summaryByArticle = Object.fromEntries(summary.rows.map((row) => [row.article_id, row]));
    assert.strictEqual(Number(summaryByArticle[ARTICLE_OUTPUT].stock_quantity), 10);
    assert.strictEqual(Number(summaryByArticle[ARTICLE_OUTPUT].pma), 9.7);
    assert.strictEqual(Number(summaryByArticle[ARTICLE_BOX].stock_quantity), 3);
    assert.strictEqual(Number(summaryByArticle[ARTICLE_FISH_A].stock_quantity), 0);

    await assert.rejects(
      () => validatePackingOperation(pool, { storeId: STORE_A, userId: USER_A, packingOperationId: draft.id }),
      (error) => error.code === 'PACKING_ALREADY_VALIDATED'
    );

    console.log(JSON.stringify({
      ok: true,
      migration: '106_packing_foundation.sql',
      tests: [
        'create_draft',
        'add_two_fish_lots',
        'add_one_packaging_material',
        'fish_cost_94',
        'packaging_cost_3',
        'final_unit_cost_9_70',
        'unique_output_lot_created',
        'source_lots_decremented',
        'packaging_lot_decremented',
        'stock_movements_created',
        'stock_summary_recomputed',
        'blocked_lot_refused',
        'multi_store_refused',
        'product_as_material_refused',
        'second_validate_refused',
        'traceability_source_output_kept',
      ],
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
