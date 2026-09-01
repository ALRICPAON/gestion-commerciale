const assert = require('assert');
const fs = require('fs');
const path = require('path');

const customerInvoicesRouter = require('../routes/customerInvoices');
const { buildPennylaneCustomerInvoicePayload } = require('../services/pennylane/customerInvoiceSync');

const repoRoot = path.join(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function functionBody(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  assert(start > -1, `${functionName} exists`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(braceStart, index + 1);
  }
  throw new Error(`Cannot extract ${functionName}`);
}

function asyncFunctionBody(source, functionName) {
  const start = source.indexOf(`async function ${functionName}`);
  assert(start > -1, `${functionName} exists`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(braceStart, index + 1);
  }
  throw new Error(`Cannot extract ${functionName}`);
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

function testDeliveryNotesBillingHasNoNativeConfirmation() {
  const source = read('frontend/js/delivery-notes.js');
  const openBody = functionBody(source, 'openInvoiceDateModal');
  const submitBody = asyncFunctionBody(source, 'validateInvoice');
  assert(!openBody.includes('confirm('), 'delivery notes invoice click opens the modal without native confirm');
  assert(!submitBody.includes('confirm('), 'delivery notes invoice submit posts without native confirm');
  assert(source.includes("invoiceBtn?.addEventListener('click', openInvoiceDateModal)"), 'invoice button opens the modal directly');
}

function testDeliveryNotesModalDisplaysBillingContext() {
  const js = read('frontend/js/delivery-notes.js');
  const html = read('frontend/delivery-notes.html');
  assert(js.includes('BL : ${reference}'), 'modal subtitle displays the BL reference');
  assert(js.includes('Date du BL : ${fmtDate(deliveryDate)}'), 'modal subtitle displays the BL date in French format');
  assert(js.includes('Client facturé : ${billedClient}'), 'modal subtitle displays billed client when available');
  assert(js.includes('invoiceDateInput.value = invoiceDateDefault(selectedDeliveryNote)'), 'invoice date defaults from the BL date with fallback');
  assert(html.includes('delivery-notes.js?v=10'), 'delivery notes JS cache-busting is bumped to v=10');
}

function testSaleDetailBillingUsesModalWithoutNativeConfirmation() {
  const js = read('frontend/js/sale-detail-flow.js');
  const html = read('frontend/sale-detail.html');
  const css = read('frontend/css/pages/sale-detail.css');
  const openBody = functionBody(js, 'openInvoiceDateModal');
  const submitBody = asyncFunctionBody(js, 'validateInvoiceFromBl');
  assert(!openBody.includes('confirm('), 'sale detail invoice click opens the modal without native confirm');
  assert(!submitBody.includes('confirm('), 'sale detail invoice submit posts without native confirm');
  assert(!js.includes('Valider ce BL en facture ?'), 'legacy sale detail invoice confirmation is removed');
  assert(js.includes("JSON.stringify({ document_date: documentDate })"), 'sale detail sends document_date in invoice payload');
  assert(html.includes('id="invoice-date-flow-modal"'), 'sale detail exposes the invoice date modal');
  assert(html.includes('sale-detail-flow.js?v=9'), 'sale detail flow JS cache-busting is bumped');
  assert(css.includes('.invoice-date-flow-modal-card'), 'sale detail modal has page-local styling');
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
  testDeliveryNotesBillingHasNoNativeConfirmation,
  testDeliveryNotesModalDisplaysBillingContext,
  testSaleDetailBillingUsesModalWithoutNativeConfirmation,
  testAlreadyInvoicedDeliveryNoteKeepsExistingInvoice,
  testPennylanePayloadUsesInvoiceDocumentDate,
];

for (const test of tests) {
  test();
  console.log(`OK ${test.name}`);
}

console.log('OK delivery note invoice date tests passed');
