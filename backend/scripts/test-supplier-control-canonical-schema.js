const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  CANONICAL_SUPPLIER_CONTROL_STATUSES,
  canonicalSupplierControlStatus,
  getSupplierControlDocument,
  isPaidStatus,
} = require('../services/supplierControlService');

const migrationPath = path.join(__dirname, '../db/gestion-commerciale/112_supplier_control_canonical_schema.sql');
const rollbackPath = path.join(__dirname, '../db/gestion-commerciale/112_supplier_control_canonical_schema_rollback.sql');
const homePath = path.join(__dirname, '../../frontend/home.html');
const supplierInvoicesHtmlPath = path.join(__dirname, '../../frontend/supplier-invoices.html');
const pennylaneSupplierInvoicesHtmlPath = path.join(__dirname, '../../frontend/pennylane-supplier-invoices.html');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function assertContains(source, pattern, message) {
  assert.ok(pattern.test(source), message || `Missing ${pattern}`);
}

function testMigrationCreatesCanonicalTables() {
  const sql = read(migrationPath);

  assertContains(sql, /CREATE TABLE IF NOT EXISTS supplier_control_document_links/i);
  assertContains(sql, /CREATE TABLE IF NOT EXISTS supplier_control_events/i);
  assertContains(sql, /CREATE TABLE IF NOT EXISTS supplier_control_migration_issues/i);
  assertContains(sql, /CREATE OR REPLACE VIEW supplier_control_document_summary/i);
  assertContains(sql, /ALTER TABLE pennylane_supplier_invoices\s+ADD COLUMN IF NOT EXISTS supplier_control_status text/i);
  assertContains(sql, /pennylane_supplier_invoice_id uuid NOT NULL REFERENCES pennylane_supplier_invoices\(id\) ON DELETE CASCADE/i);
  assertContains(sql, /purchase_id uuid REFERENCES purchases\(id\) ON DELETE SET NULL/i);
  assertContains(sql, /purchase_line_id uuid REFERENCES purchase_lines\(id\) ON DELETE SET NULL/i);
}

function testMigrationIsNonDestructiveAndIdempotent() {
  const sql = read(migrationPath);

  assert.ok(!/\bDROP\s+TABLE\b/i.test(sql), 'PR1 migration must not drop tables');
  assert.ok(!/\bDELETE\s+FROM\s+supplier_invoices\b/i.test(sql), 'PR1 migration must not delete legacy supplier invoices');
  assert.ok(!/\bDELETE\s+FROM\s+pennylane_supplier_invoices\b/i.test(sql), 'PR1 migration must not delete Pennylane documents');
  assert.ok(!/\bTRUNCATE\b/i.test(sql), 'PR1 migration must not truncate data');
  assertContains(sql, /CREATE TABLE IF NOT EXISTS/i);
  assertContains(sql, /CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_control_links_purchase/i);
  assertContains(sql, /CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_control_links_purchase_line/i);
  assertContains(sql, /ON CONFLICT DO NOTHING/i, 'Backfill must be replay-safe');
}

function testOneAndManyPurchaseLinksAreAllowedWithoutDuplicateRows() {
  const sql = read(migrationPath);

  assertContains(sql, /ux_supplier_control_links_purchase[\s\S]+pennylane_supplier_invoice_id,\s*purchase_id,\s*link_type/i);
  assertContains(sql, /ux_supplier_control_links_purchase_line[\s\S]+pennylane_supplier_invoice_id,\s*purchase_id,\s*purchase_line_id,\s*link_type/i);
  assertContains(sql, /WHERE purchase_id IS NOT NULL AND purchase_line_id IS NULL/i);
  assertContains(sql, /WHERE purchase_id IS NOT NULL AND purchase_line_id IS NOT NULL/i);
}

function testHistoricalBackfillUsesOnlyReliableBridges() {
  const sql = read(migrationPath);

  assertContains(sql, /NULLIF\(si\.pennylane_payload->>'pennylane_supplier_invoice_id', ''\) = psi\.pennylane_supplier_invoice_id/i);
  assertContains(sql, /si\.supplier_id = psi\.supplier_id\s+AND si\.invoice_number = psi\.invoice_number/i);
  assertContains(sql, /NOT EXISTS \([\s\S]+psi_dup[\s\S]+psi_dup\.id <> psi\.id/i);
  assertContains(sql, /JOIN supplier_invoice_matches sim/i);
  assertContains(sql, /legacy_supplier_invoice_match_id/i);
  assertContains(sql, /legacy_supplier_invoice_without_canonical_pennylane_document/i);
}

function testHistoricalValidationAndCreditNotesArePreserved() {
  const sql = read(migrationPath);

  assertContains(sql, /WHEN lb\.status IN \('invoice_validated', 'cost_adjusted', 'sent_to_pennylane'\)/i);
  assertContains(sql, /supplier_credit_note_applications/i);
  assertContains(sql, /supplier_credit_note_returns/i);
  assertContains(sql, /legacy_credit_note_application_without_canonical_pennylane_document/i);
  assertContains(sql, /legacy_supplier_return_without_canonical_pennylane_document/i);
}

function testCanonicalStatuses() {
  assert.deepStrictEqual([...CANONICAL_SUPPLIER_CONTROL_STATUSES], [
    'a_rapprocher',
    'a_controler',
    'ecart',
    'avoir_attendu',
    'conforme',
    'valide_a_payer',
    'paye',
    'litige',
  ]);

  assert.strictEqual(isPaidStatus('paid', false), true);
  assert.strictEqual(isPaidStatus('paid_offline', false), true);
  assert.strictEqual(isPaidStatus(null, true), true);
  assert.strictEqual(canonicalSupplierControlStatus({ payment_status: 'to_be_paid' }), 'valide_a_payer');
  assert.strictEqual(canonicalSupplierControlStatus({ payment_status: 'to_be_paid', supplier_control_status: 'a_rapprocher' }), 'valide_a_payer');
  assert.strictEqual(canonicalSupplierControlStatus({ paid: true, supplier_control_status: 'ecart' }), 'paye');
  assert.strictEqual(canonicalSupplierControlStatus({ alta_business_status: 'ecart_prix' }), 'ecart');
  assert.strictEqual(canonicalSupplierControlStatus({ alta_business_status: 'controle_manuel' }), 'a_controler');
  assert.strictEqual(canonicalSupplierControlStatus({ alta_business_status: 'conforme' }), 'conforme');
  assert.strictEqual(canonicalSupplierControlStatus({ alta_business_status: 'litige' }), 'litige');
  assert.strictEqual(canonicalSupplierControlStatus({}), 'a_rapprocher');
}

async function testCanonicalReaderWithAndWithoutLegacyMirror() {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM pennylane_supplier_invoices psi/i.test(sql)) {
        return {
          rows: [{
            id: 'pennylane-local-id',
            store_id: 'store-a',
            pennylane_supplier_invoice_id: 'pl-123',
            supplier_control_status: null,
            alta_business_status: 'ecart_quantite',
            payment_status: null,
            paid: false,
          }],
        };
      }
      if (/FROM supplier_control_document_links scl/i.test(sql)) {
        return {
          rows: [
            { id: 'link-1', purchase_id: 'purchase-1', purchase_line_id: null },
            { id: 'link-2', purchase_id: 'purchase-2', purchase_line_id: null },
            { id: 'link-3', purchase_id: 'purchase-3', purchase_line_id: null },
          ],
        };
      }
      if (/FROM supplier_control_events/i.test(sql)) return { rows: [{ id: 'event-1', event_type: 'legacy_backfill' }] };
      return { rows: [] };
    },
  };

  const result = await getSupplierControlDocument(db, {
    storeId: 'store-a',
    pennylaneSupplierInvoiceId: 'pennylane-local-id',
  });

  assert.strictEqual(result.document.supplier_control_status, 'ecart');
  assert.strictEqual(result.links.length, 3, 'Facture = 3 BL must be readable');
  assert.strictEqual(result.events.length, 1);
  assert.ok(calls.every((call) => call.params.includes('store-a')), 'All canonical reads must be store-scoped');

  const missingDb = { async query() { return { rows: [] }; } };
  assert.strictEqual(await getSupplierControlDocument(missingDb, {
    storeId: 'store-b',
    pennylaneSupplierInvoiceId: 'missing',
  }), null);
}

function testLegacyScreensRemainWired() {
  const home = read(homePath);
  const supplierInvoices = read(supplierInvoicesHtmlPath);
  const pennylaneSupplierInvoices = read(pennylaneSupplierInvoicesHtmlPath);

  assertContains(home, /href="\.\/supplier-invoices\.html"/i);
  assertContains(home, /href="\.\/pennylane-supplier-invoices\.html"/i);
  assertContains(supplierInvoices, /\.\/js\/supplier-invoices\.js\?v=7/i);
  assertContains(pennylaneSupplierInvoices, /\.\/js\/pennylane-supplier-invoices\.js\?v=3/i);
}

function testMigrationSqlOrderingGuard() {
  const sql = read(migrationPath);
  assert.ok(!/INSERT INTO supplier_control_migration_issues\([\s\S]{0,300}\)\s*WITH\s+/i.test(sql), 'CTE must precede INSERT in PostgreSQL');
  assertContains(sql, /^BEGIN;/m);
  assertContains(sql, /^COMMIT;/m);
}

function testRollbackIsScopedToPr1Objects() {
  const rollback = read(rollbackPath);
  assertContains(rollback, /DROP VIEW IF EXISTS supplier_control_document_summary/i);
  assertContains(rollback, /DROP TABLE IF EXISTS supplier_control_document_links/i);
  assertContains(rollback, /DROP TABLE IF EXISTS supplier_control_events/i);
  assertContains(rollback, /DROP TABLE IF EXISTS supplier_control_migration_issues/i);
  assertContains(rollback, /DROP COLUMN IF EXISTS supplier_control_status/i);
  assert.ok(!/DROP TABLE IF EXISTS supplier_invoices/i.test(rollback), 'Rollback must not drop legacy supplier invoices');
  assert.ok(!/DROP TABLE IF EXISTS pennylane_supplier_invoices/i.test(rollback), 'Rollback must not drop Pennylane documents');
}

(async () => {
  testMigrationCreatesCanonicalTables();
  testMigrationIsNonDestructiveAndIdempotent();
  testOneAndManyPurchaseLinksAreAllowedWithoutDuplicateRows();
  testHistoricalBackfillUsesOnlyReliableBridges();
  testHistoricalValidationAndCreditNotesArePreserved();
  testCanonicalStatuses();
  await testCanonicalReaderWithAndWithoutLegacyMirror();
  testLegacyScreensRemainWired();
  testMigrationSqlOrderingGuard();
  testRollbackIsScopedToPr1Objects();
  console.log('OK supplier control canonical schema tests');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
