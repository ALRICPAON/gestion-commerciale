const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

require('../../env');

const {
  createProductRecallDraft,
} = require('../services/productRecallService');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = [
  path.join(ROOT, 'backend', 'db', 'gestion-commerciale', '102_quality_events_evidence_records.sql'),
  path.join(ROOT, 'backend', 'db', 'gestion-commerciale', '103_quality_lot_blocking.sql'),
  path.join(ROOT, 'backend', 'db', 'gestion-commerciale', '104_product_recall_foundation.sql'),
];
const ROLLBACK_104 = path.join(ROOT, 'backend', 'db', 'gestion-commerciale', '104_product_recall_foundation_rollback.sql');

const STORE_A = '80000000-0000-4000-8000-000000000001';
const STORE_B = '80000000-0000-4000-8000-000000000002';
const USER_A = '80000000-0000-4000-8000-000000000101';
const ARTICLE_A = '80000000-0000-4000-8000-000000000201';
const LOT_A = '80000000-0000-4000-8000-000000000301';
const LOT_ROLLBACK = '80000000-0000-4000-8000-000000000302';
const CLIENT_A = '80000000-0000-4000-8000-000000000401';
const CLIENT_B = '80000000-0000-4000-8000-000000000402';
const CONTACT_A = '80000000-0000-4000-8000-000000000501';
const DOC_A = '80000000-0000-4000-8000-000000000601';
const DOC_B = '80000000-0000-4000-8000-000000000602';
const LINE_A = '80000000-0000-4000-8000-000000000701';
const LINE_B = '80000000-0000-4000-8000-000000000702';

function requireTestDatabaseUrl() {
  const databaseUrl = process.env.PRODUCT_RECALL_PG_TEST_DATABASE_URL;
  if (process.env.PRODUCT_RECALL_PG_TEST !== '1' || !databaseUrl) {
    console.log(JSON.stringify({
      ok: false,
      skipped: true,
      reason: 'Set PRODUCT_RECALL_PG_TEST=1 and PRODUCT_RECALL_PG_TEST_DATABASE_URL to run the real PostgreSQL integration test.',
    }, null, 2));
    process.exit(0);
  }
  const parsedUrl = new URL(databaseUrl);
  if (
    parsedUrl.pathname.replace(/^\//, '') === 'gestion_commerciale'
    && process.env.PRODUCT_RECALL_PG_TEST_ALLOW_PRODUCTION_DB !== 'I_UNDERSTAND_THIS_IS_NOT_A_TEST_DB'
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

async function cleanup(client) {
  await client.query(
    `DELETE FROM quality_evidence_records WHERE store_id IN ($1::uuid, $2::uuid)`,
    [STORE_A, STORE_B]
  ).catch(() => {});
  await client.query(
    `DELETE FROM quality_events WHERE store_id IN ($1::uuid, $2::uuid)`,
    [STORE_A, STORE_B]
  ).catch(() => {});
  await client.query(
    `DELETE FROM product_recall_recipients WHERE store_id IN ($1::uuid, $2::uuid)`,
    [STORE_A, STORE_B]
  ).catch(() => {});
  await client.query(
    `DELETE FROM product_recall_campaigns WHERE store_id IN ($1::uuid, $2::uuid)`,
    [STORE_A, STORE_B]
  ).catch(() => {});
  await client.query(
    `DELETE FROM quality_lot_status_history WHERE store_id IN ($1::uuid, $2::uuid)`,
    [STORE_A, STORE_B]
  ).catch(() => {});
  await client.query(
    `DELETE FROM sale_line_allocations WHERE sales_line_id IN ($1::uuid, $2::uuid)`,
    [LINE_A, LINE_B]
  ).catch(() => {});
  await client.query(
    `DELETE FROM sales_lines WHERE id IN ($1::uuid, $2::uuid)`,
    [LINE_A, LINE_B]
  ).catch(() => {});
  await client.query(
    `DELETE FROM sales_documents WHERE id IN ($1::uuid, $2::uuid)`,
    [DOC_A, DOC_B]
  ).catch(() => {});
  await client.query(
    `DELETE FROM client_contacts WHERE store_id IN ($1::uuid, $2::uuid)`,
    [STORE_A, STORE_B]
  ).catch(() => {});
  await client.query(
    `DELETE FROM lots WHERE id IN ($1::uuid, $2::uuid)`,
    [LOT_A, LOT_ROLLBACK]
  ).catch(() => {});
  await client.query(
    `DELETE FROM articles WHERE id = $1::uuid`,
    [ARTICLE_A]
  ).catch(() => {});
  await client.query(
    `DELETE FROM clients WHERE id IN ($1::uuid, $2::uuid)`,
    [CLIENT_A, CLIENT_B]
  ).catch(() => {});
  await client.query(
    `DELETE FROM users WHERE id = $1::uuid`,
    [USER_A]
  ).catch(() => {});
  await client.query(
    `DELETE FROM stores WHERE id IN ($1::uuid, $2::uuid)`,
    [STORE_A, STORE_B]
  ).catch(() => {});
}

async function applyMigrations(client) {
  for (const migration of MIGRATIONS) {
    await client.query(fs.readFileSync(migration, 'utf8'));
  }
}

async function seed(client) {
  await client.query(
    `INSERT INTO stores (id, code, name, client_key)
     VALUES
       ($1::uuid, 'codex_pr_store_a_250', 'Codex Recall Store A', 'codex_pr_a_250'),
       ($2::uuid, 'codex_pr_store_b_250', 'Codex Recall Store B', 'codex_pr_b_250')
     ON CONFLICT (id) DO NOTHING`,
    [STORE_A, STORE_B]
  );
  await client.query(
    `INSERT INTO users (id, store_id, email, password_hash, role)
     VALUES ($1::uuid, $2::uuid, 'codex-product-recall-250@example.test', 'test', 'admin')
     ON CONFLICT (store_id, email) DO NOTHING`,
    [USER_A, STORE_A]
  );
  await client.query(
    `INSERT INTO articles (id, store_id, plu, designation, unit)
     VALUES ($1::uuid, $2::uuid, 'PR250', 'Article rappel test', 'kg')
     ON CONFLICT (id) DO NOTHING`,
    [ARTICLE_A, STORE_A]
  );
  await client.query(
    `INSERT INTO clients (id, store_id, code, name, email, status)
     VALUES
       ($1::uuid, $3::uuid, 'LIV-A', 'Client livre A', NULL, 'active'),
       ($2::uuid, $3::uuid, 'LIV-B', 'Client livre B', 'client-b-recall@example.test', 'active')
     ON CONFLICT (id) DO NOTHING`,
    [CLIENT_A, CLIENT_B, STORE_A]
  );
  await client.query(
    `INSERT INTO client_contacts (
       id, store_id, client_id, contact_name, email, receives_delivery_notes, is_primary, status
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, 'Contact BL A', 'contact-a-recall@example.test', true, false, 'active'
     )
     ON CONFLICT (id) DO NOTHING`,
    [CONTACT_A, STORE_A, CLIENT_A]
  );
  await client.query(
    `INSERT INTO lots (id, store_id, article_id, lot_code, supplier_lot_number, qty_initial, qty_remaining)
     VALUES
       ($1::uuid, $3::uuid, $4::uuid, 'PR-LOT-A-250', 'SUP-PR-250', 30, 12),
       ($2::uuid, $3::uuid, $4::uuid, 'PR-LOT-ROLLBACK-250', 'SUP-ROLLBACK-250', 10, 10)
     ON CONFLICT (id) DO NOTHING`,
    [LOT_A, LOT_ROLLBACK, STORE_A, ARTICLE_A]
  );
  await client.query(
    `INSERT INTO sales_documents (
       id, store_id, client_id, document_date, status, document_type, reference_number
     ) VALUES
       ($1::uuid, $3::uuid, $4::uuid, '2026-08-16', 'validated', 'DELIVERY_NOTE', 'BL-PR-A'),
       ($2::uuid, $3::uuid, $5::uuid, '2026-08-16', 'validated', 'DELIVERY_NOTE', 'BL-PR-B')
     ON CONFLICT (id) DO NOTHING`,
    [DOC_A, DOC_B, STORE_A, CLIENT_A, CLIENT_B]
  );
  await client.query(
    `INSERT INTO sales_lines (
       id, store_id, sales_document_id, line_number, article_id, article_plu, article_label,
       sold_quantity, total_weight, line_status
     ) VALUES
       ($1::uuid, $5::uuid, $3::uuid, 1, $6::uuid, 'PR250', 'Article rappel test', 5, 5, 'validated'),
       ($2::uuid, $5::uuid, $4::uuid, 1, $6::uuid, 'PR250', 'Article rappel test', 7, 7, 'validated')
     ON CONFLICT (id) DO NOTHING`,
    [LINE_A, LINE_B, DOC_A, DOC_B, STORE_A, ARTICLE_A]
  );
  await client.query(
    `INSERT INTO sale_line_allocations (sales_line_id, lot_id, quantity)
     VALUES
       ($1::uuid, $3::uuid, 5),
       ($2::uuid, $3::uuid, 7)`,
    [LINE_A, LINE_B, LOT_A]
  );
}

async function assertUniqueConstraintCompatibility(client) {
  const checks = await client.query(
    `SELECT table_name, count(*)::integer AS compatible_count
     FROM (
       SELECT
         c.conrelid::regclass::text AS table_name,
         (
            SELECT array_agg(a.attname::text ORDER BY keys.ordinality)
            FROM unnest(c.conkey) WITH ORDINALITY AS keys(attnum, ordinality)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = keys.attnum
          ) AS columns
       FROM pg_constraint c
       WHERE c.contype IN ('p', 'u')
         AND c.conrelid IN (
           'lots'::regclass,
           'articles'::regclass,
           'clients'::regclass,
           'client_contacts'::regclass,
           'quality_events'::regclass,
           'quality_evidence_records'::regclass,
           'product_recall_campaigns'::regclass
         )
     ) constraints
     WHERE columns = ARRAY['id', 'store_id']::text[]
     GROUP BY table_name`,
    []
  );
  const byTable = new Map(checks.rows.map((row) => [row.table_name, row.compatible_count]));
  [
    'lots',
    'articles',
    'clients',
    'client_contacts',
    'quality_events',
    'quality_evidence_records',
    'product_recall_campaigns',
  ].forEach((table) => {
    assert.strictEqual(byTable.get(table), 1, `${table} doit avoir une seule UNIQUE compatible (id, store_id)`);
  });
}

async function main() {
  const client = new Client({ connectionString: requireTestDatabaseUrl() });
  await client.connect();

  try {
    await applyMigrations(client);
    await cleanup(client);
    await seed(client);
    await assertUniqueConstraintCompatibility(client);

    await client.query('BEGIN');
    const draft = await createProductRecallDraft({
      db: client,
      storeId: STORE_A,
      lotId: LOT_A,
      userId: USER_A,
      recallType: 'supplier_recall',
      reason: 'Test integration rappel',
      comment: 'Campagne draft',
    });
    await client.query('COMMIT');

    assert.strictEqual(draft.campaign.status, 'draft');
    assert.strictEqual(draft.recipients.length, 2);
    assert.strictEqual(draft.analysis.clients_count, 2);
    assert.strictEqual(draft.analysis.total_delivered_quantity, 12);

    const stored = await client.query(
      `SELECT
         (SELECT count(*)::integer FROM product_recall_campaigns WHERE store_id = $1::uuid AND lot_id = $2::uuid) AS campaigns,
         (SELECT count(*)::integer FROM product_recall_recipients WHERE store_id = $1::uuid AND campaign_id = $3::uuid) AS recipients,
         (SELECT count(*)::integer FROM quality_events WHERE store_id = $1::uuid AND source_id = $3::uuid AND event_type = 'product_recall_initiated') AS events,
         (SELECT count(*)::integer FROM quality_evidence_records WHERE store_id = $1::uuid AND source_record_id = $3::uuid AND evidence_type = 'product_recall_record') AS evidence`,
      [STORE_A, LOT_A, draft.campaign.id]
    );
    assert.strictEqual(stored.rows[0].campaigns, 1);
    assert.strictEqual(stored.rows[0].recipients, 2);
    assert.strictEqual(stored.rows[0].events, 1);
    assert.strictEqual(stored.rows[0].evidence, 1);

    await client.query('BEGIN');
    try {
      await client.query('SAVEPOINT recall_fk_store');
      let fkRejected = false;
      try {
        await client.query(
          `INSERT INTO product_recall_recipients (
             store_id, campaign_id, delivered_client_id, status
           ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'ready')`,
          [STORE_B, draft.campaign.id, CLIENT_A]
        );
      } catch (error) {
        fkRejected = error.code === '23503';
      }
      await client.query('ROLLBACK TO SAVEPOINT recall_fk_store');
      await client.query('RELEASE SAVEPOINT recall_fk_store');
      assert.strictEqual(fkRejected, true, 'FK composite recipient/campaign doit refuser un croisement magasin');

      await client.query('SAVEPOINT recall_unique_active');
      let uniqueRejected = false;
      try {
        await client.query(
          `INSERT INTO product_recall_campaigns (
             store_id, lot_id, article_id, status, recall_type, reason
           ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'draft', 'supplier_recall', 'Doublon actif')`,
          [STORE_A, LOT_A, ARTICLE_A]
        );
      } catch (error) {
        uniqueRejected = error.code === '23505' && error.constraint === 'uq_product_recall_active_lot';
      }
      await client.query('ROLLBACK TO SAVEPOINT recall_unique_active');
      await client.query('RELEASE SAVEPOINT recall_unique_active');
      assert.strictEqual(uniqueRejected, true, 'Index campagne active doit refuser un doublon actif');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }

    await assert.rejects(
      () => createProductRecallDraft({
        db: client,
        storeId: STORE_A,
        lotId: LOT_A,
        userId: USER_A,
        recallType: 'supplier_recall',
        reason: 'Deuxieme draft interdite',
      }),
      (error) => error.status === 409 && error.code === 'PRODUCT_RECALL_ACTIVE_EXISTS'
    );

    await client.query(
      `UPDATE product_recall_campaigns
       SET status = 'closed', closed_at = now()
       WHERE id = $1::uuid AND store_id = $2::uuid`,
      [draft.campaign.id, STORE_A]
    );
    const secondDraft = await createProductRecallDraft({
      db: client,
      storeId: STORE_A,
      lotId: LOT_A,
      userId: USER_A,
      recallType: 'supplier_recall',
      reason: 'Nouvelle campagne apres cloture',
    });
    assert.strictEqual(secondDraft.campaign.status, 'draft');

    await client.query('BEGIN');
    const rollbackDraft = await createProductRecallDraft({
      db: client,
      storeId: STORE_A,
      lotId: LOT_ROLLBACK,
      userId: USER_A,
      recallType: 'quality_suspicion',
      reason: 'Rollback attendu',
    });
    assert(rollbackDraft.campaign.id, 'Draft rollback visible dans la transaction');
    await client.query('ROLLBACK');
    const rollbackCounts = await client.query(
      `SELECT
         (SELECT count(*)::integer FROM product_recall_campaigns WHERE lot_id = $1::uuid) AS campaigns,
         (SELECT COALESCE(quality_status, 'available') FROM lots WHERE id = $1::uuid) AS lot_status`,
      [LOT_ROLLBACK]
    );
    assert.strictEqual(rollbackCounts.rows[0].campaigns, 0);
    assert.strictEqual(rollbackCounts.rows[0].lot_status, 'available');

    console.log(JSON.stringify({
      ok: true,
      migration_104_applied: true,
      draft_campaign_created: true,
      recipients_created: true,
      composite_fk_store_guard: true,
      active_campaign_unique_index: true,
      second_active_campaign_rejected: true,
      closed_campaign_allows_new_draft: true,
      transaction_rollback: true,
      rollback_104_exercised: false,
      rollback_104_reason: 'Set PRODUCT_RECALL_PG_TEST_RUN_ROLLBACK_104=1 to drop migration 104 objects on the dedicated test database.',
    }, null, 2));

    await cleanup(client);
    if (process.env.PRODUCT_RECALL_PG_TEST_RUN_ROLLBACK_104 === '1') {
      await client.query(fs.readFileSync(ROLLBACK_104, 'utf8'));
    }
  } finally {
    await cleanup(client).catch(() => {});
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
