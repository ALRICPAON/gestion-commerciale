const assert = require('assert');
const fs = require('fs');
const path = require('path');

const customerInvoicesRouter = require('../routes/customerInvoices');
const { buildPennylaneCustomerInvoicePayload } = require('../services/pennylane/customerInvoiceSync');

const repoRoot = path.join(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function testBackendAcceptsChosenDeliveryNoteDate() {
  const result = customerInvoicesRouter._private.validateInvoiceDocumentDate('2026-07-27');
  assert.deepStrictEqual(result, { ok: true, documentDate: '2026-07-27' });
}

function testBackendAcceptsToday() {
  const today = new Date().toISOString().slice(0, 10);
  const result = customerInvoicesRouter._private.validateInvoiceDocumentDate(today);
  assert.deepStrictEqual(result, { ok: true, documentDate: today });
}

function testBackendRejectsFutureDate() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const result = customerInvoicesRouter._private.validateInvoiceDocumentDate(tomorrow);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /futur/);
}

function testBackendRejectsInvalidDate() {
  const result = customerInvoicesRouter._private.validateInvoiceDocumentDate('27/07/2026');
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /YYYY-MM-DD/);
}

function testEmptyDateFallsBackForLegacyCalls() {
  const result = customerInvoicesRouter._private.validateInvoiceDocumentDate('');
  assert.deepStrictEqual(result, { ok: true, documentDate: null });
}

function testFrontendRejectsEmptyDateBeforeSubmit() {
  const source = read('frontend/js/delivery-notes.js');
  assert(source.includes("return 'La date de facture est obligatoire.'"), 'frontend displays a clear required-date error');
  assert(source.includes("JSON.stringify({ document_date: documentDate })"), 'frontend sends document_date in invoice payload');
}

function testAlreadyInvoicedDeliveryNoteKeepsExistingInvoice() {
  const source = read('backend/routes/customerInvoices.js');
  const existingCheck = source.indexOf('const existing = await db.query');
  const insertInvoice = source.indexOf('INSERT INTO sales_documents');
  assert(existingCheck > -1, 'backend checks for an existing invoice');
  assert(insertInvoice > -1, 'backend still creates an invoice when needed');
  assert(existingCheck < insertInvoice, 'existing invoice is returned before any invoice insert');
  assert(source.includes('existing: true'), 'backend response marks existing invoice without duplicate');
}

function testPennylanePayloadUsesInvoiceDocumentDate() {
  const payload = buildPennylaneCustomerInvoicePayload({
    id: 'invoice-1',
    store_id: 'store-1',
    document_date: '2026-07-27',
    pennylane_customer_id: '123',
  }, [{
    article_label: 'Ligne test',
    sold_quantity: 1,
    unit_sale_price_ht: 10,
    vat_rate: 5.5,
    sale_unit: 'kg',
  }]);

  assert.strictEqual(payload.date, '2026-07-27');
}

const tests = [
  testBackendAcceptsChosenDeliveryNoteDate,
  testBackendAcceptsToday,
  testBackendRejectsFutureDate,
  testBackendRejectsInvalidDate,
  testEmptyDateFallsBackForLegacyCalls,
  testFrontendRejectsEmptyDateBeforeSubmit,
  testAlreadyInvoicedDeliveryNoteKeepsExistingInvoice,
  testPennylanePayloadUsesInvoiceDocumentDate,
];

for (const test of tests) {
  test();
  console.log(`OK ${test.name}`);
}

console.log('OK delivery note invoice date tests passed');
