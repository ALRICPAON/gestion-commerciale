const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { renderCustomerInvoicePdf } = require('../services/pdf/templates/customerInvoicePdfTemplate');

const repoRoot = path.join(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function baseInvoice(overrides = {}) {
  return {
    id: 'invoice-1',
    reference_number: 'FAC-2026-00001',
    document_date: '2026-07-27',
    billed_client_name: 'CENTRALE FACTUREE',
    billed_client_code: '88',
    delivered_client_name: 'MAGASIN LIVRE',
    client_store_identifier: 'MAG-01',
    address_line1: 'Adresse client livre',
    postal_code: '44000',
    city: 'Nantes',
    total_amount_ex_vat: 100,
    total_vat_amount: 5.5,
    total_amount_inc_vat: 105.5,
    pennylane_status: 'not_sent',
    ...overrides,
  };
}

function render(invoice) {
  return renderCustomerInvoicePdf({
    invoice,
    lines: [{
      line_number: 1,
      article_label: 'Bar de ligne',
      article_plu: '3013',
      package_count: 1,
      weight_per_package: 2,
      total_weight: 2,
      sale_unit: 'kg',
      unit_sale_price_ht: 50,
      line_amount_ht: 100,
      vat_rate: 5.5,
      line_vat_amount: 5.5,
      line_amount_ttc: 105.5,
      traceability_snapshot: { lot_code: 'LOT-A', fao_zone: '27' },
    }],
    storeSettings: { company_name: 'ALTA MAREE' },
  });
}

function testInvoiceQueryLoadsBilledClientLegalFields() {
  const source = read('backend/routes/customerInvoices.js');
  for (const field of [
    'billed.siret AS billed_client_siret',
    'billed.vat_number AS billed_client_vat_number',
    'billed.address_line1 AS billed_client_address_line1',
    'billed.address_line2 AS billed_client_address_line2',
    'billed.postal_code AS billed_client_postal_code',
    'billed.city AS billed_client_city',
    'billed.country AS billed_client_country',
  ]) {
    assert(source.includes(field), `${field} must be selected from billed client`);
  }
  assert(source.includes('ON billed.id = inv.billed_client_id'), 'billed legal fields must come from billed_client_id');
}

function testPrintDataAndPdfShareInvoiceDocumentLoader() {
  const source = read('backend/routes/customerInvoices.js');
  const printDataRoute = source.slice(source.indexOf("router.get('/invoices/:id/print-data'"), source.indexOf("router.get('/invoices/:id/pdf'"));
  const pdfRoute = source.slice(source.indexOf("router.get('/invoices/:id/pdf'"));
  assert(printDataRoute.includes('getInvoiceDocument(req.dbPool'), 'print-data route uses shared invoice document loader');
  assert(pdfRoute.includes('getInvoiceDocument(req.dbPool'), 'pdf route uses shared invoice document loader');
}

function testBilledClientLegalInfoAppears() {
  const html = render(baseInvoice({
    billed_client_siret: '12345678901234',
    billed_client_vat_number: 'FR12345678901',
    billed_client_address_line1: '1 rue de la Centrale',
    billed_client_address_line2: 'Batiment A',
    billed_client_postal_code: '75001',
    billed_client_city: 'Paris',
    billed_client_country: 'France',
  }));

  assert(html.includes('CENTRALE FACTUREE'));
  assert(html.includes('Code client : <strong>88</strong>'));
  assert(html.includes('SIRET : <strong>12345678901234</strong>'));
  assert(html.includes('TVA intracommunautaire : <strong>FR12345678901</strong>'));
  assert(html.includes('<p>1 rue de la Centrale</p>'));
  assert(html.includes('<p>Batiment A</p>'));
  assert(html.includes('<p>75001 Paris</p>'));
  assert(html.includes('<p>France</p>'));
}

function testMissingSiretAndVatAreHidden() {
  const html = render(baseInvoice({
    billed_client_address_line1: '1 rue de la Centrale',
    billed_client_postal_code: '75001',
    billed_client_city: 'Paris',
  }));

  assert(!html.includes('SIRET : <strong>'));
  assert(!html.includes('TVA intracommunautaire : <strong>'));
  assert(!html.includes('<p></p>'));
}

function testBilledClientDifferentFromDeliveredClientUsesBilledLegalInfo() {
  const html = render(baseInvoice({
    billed_client_name: 'CENTRALE JURIDIQUE',
    delivered_client_name: 'MAGASIN AFFILIE',
    address_line1: '9 quai du Magasin',
    billed_client_address_line1: '99 avenue de la Centrale',
    billed_client_siret: '99999999999999',
  }));

  const billedBlockStart = html.indexOf('<h3>Client facturé</h3>');
  const deliveredBlockStart = html.indexOf('<h3>Client livre</h3>');
  const billedBlock = html.slice(billedBlockStart, deliveredBlockStart);
  assert(billedBlock.includes('CENTRALE JURIDIQUE'));
  assert(billedBlock.includes('99 avenue de la Centrale'));
  assert(billedBlock.includes('99999999999999'));
  assert(!billedBlock.includes('9 quai du Magasin'), 'delivered address must not be used in billed client block');
}

function testTotalsLinesAndTraceabilityRemainRendered() {
  const html = render(baseInvoice({
    billed_client_siret: '12345678901234',
    billed_client_vat_number: 'FR12345678901',
  }));

  assert(html.includes('Bar de ligne'));
  assert(html.includes('Lot LOT-A'));
  assert(html.includes('FAO 27'));
  assert(html.includes('Total HT'));
  assert(html.includes('TVA'));
  assert(html.includes('Total TTC'));
}

const tests = [
  testInvoiceQueryLoadsBilledClientLegalFields,
  testPrintDataAndPdfShareInvoiceDocumentLoader,
  testBilledClientLegalInfoAppears,
  testMissingSiretAndVatAreHidden,
  testBilledClientDifferentFromDeliveredClientUsesBilledLegalInfo,
  testTotalsLinesAndTraceabilityRemainRendered,
];

for (const test of tests) {
  test();
  console.log(`OK ${test.name}`);
}

console.log('OK customer invoice PDF billed client legal info tests passed');
