const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const htmlPath = path.join(root, 'frontend/supplier-control.html');
const jsPath = path.join(root, 'frontend/js/supplier-control.js');
const cssPath = path.join(root, 'frontend/css/pages/supplier-control.css');
const homePath = path.join(root, 'frontend/home.html');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function assertContains(source, pattern, message) {
  assert.match(source, pattern, message);
}

function assertNotContains(source, pattern, message) {
  assert.ok(!pattern.test(source), message || `Unexpected pattern ${pattern}`);
}

function testPageAssetsAndMenu() {
  const html = read(htmlPath);
  const css = read(cssPath);
  const home = read(homePath);

  assertContains(html, /<title>Controle fournisseurs - Gestion Commerciale<\/title>/);
  assertContains(html, /frontend\/css\/pages\/supplier-control\.css|\.\/css\/pages\/supplier-control\.css\?v=2/);
  assertContains(html, /\.\/js\/supplier-control\.js\?v=3/);
  assertContains(home, /href="\.\/supplier-control\.html"/);
  assertContains(home, /Controle fournisseurs/);
  assertContains(home, /pennylane-supplier-invoices\.html"[^>]*hidden/);
  assertContains(css, /grid-template-columns:\s*minmax\(360px,\s*38%\)\s*minmax\(0,\s*1fr\)/);
}

function testRequiredDomIds() {
  const html = read(htmlPath);
  [
    'documents-list',
    'search-input',
    'detail-content',
    'pdf-link',
    'analyze-btn',
    'proposals-list',
    'load-candidates-btn',
    'candidates-list',
    'apply-manual-btn',
    'difference-section',
    'resolution-comment',
    'validate-btn',
    'events-list',
  ].forEach((id) => assertContains(html, new RegExp(`id="${id}"`)));
}

function testFiltersAndStatuses() {
  const html = read(htmlPath);
  const js = read(jsPath);
  [
    'needs_action',
    'a_rapprocher',
    'ecart',
    'avoir_attendu',
    'ready_to_validate',
    'valide_a_payer',
    'paye',
    'litige',
    'reconciliation_required',
    'all',
  ].forEach((filter) => assertContains(html, new RegExp(`data-filter="${filter}"`)));
  [
    'A rapprocher',
    'A controler',
    'Ecart detecte',
    'Avoir attendu',
    'Conforme',
    'Valide a payer',
    'Paye',
    'Litige',
    'A reconcilier',
  ].forEach((label) => assertContains(js, new RegExp(label)));
}

function testCanonicalEndpointsOnly() {
  const js = read(jsPath);
  [
    '/api/supplier-control/documents',
    '/purchase-candidates',
    '/analyze',
    '/apply-match',
    '/purchase-links/',
    '/resolve-difference',
    '/validate',
  ].forEach((endpoint) => assertContains(js, new RegExp(endpoint.replace(/[/-]/g, (char) => `\\${char}`))));
  assertNotContains(js, /\/api\/supplier-invoices/);
  assertNotContains(js, /\/api\/integrations\/pennylane\/supplier-invoices/);
}

function testActionsAndPayloads() {
  const js = read(jsPath);
  const html = read(htmlPath);
  assertContains(js, /JSON\.stringify\(\{\s*purchase_ids:/s);
  assertContains(js, /JSON\.stringify\(\{\s*purchase_id:\s*purchaseId\s*\}\)/);
  assertContains(js, /JSON\.stringify\(\{\s*resolution_type:\s*resolutionType,\s*comment/s);
  assertContains(js, /JSON\.stringify\(\{\s*confirmation:\s*true\s*\}\)/);
  assertContains(js, /window\.confirm\("Valider cette facture/);
  assertContains(html, /data-resolution="supplier_credit_note_expected"/);
  assertContains(html, /data-resolution="accepted_difference"/);
  assertContains(js, /dispute/);
  assertContains(js, /state\.busy/);
  assertContains(js, /button\.disabled = true/);
}

function testReadOnlyAndBusinessMessages() {
  const js = read(jsPath);
  assertContains(js, /\["admin", "responsable"\]\.includes\(sessionUser\.role\)/);
  assertContains(js, /lockedStatus/);
  assertContains(js, /canEditInvoiceControl/);
  assertContains(js, /canMatchCreditNote/);
  assertContains(js, /doc\.document_type !== "credit_note"/);
  assertContains(js, /doc\.document_type === "credit_note"/);
  assertContains(js, /els\.analyze\.disabled = state\.busy \|\| invoiceReadOnly \|\| doc\.document_type === "credit_note"/);
  assertContains(js, /La validation des avoirs sera geree separement/);
  assertContains(js, /Facture deja validee a payer dans Pennylane avant la creation de l'attente d'avoir/);
  assertContains(js, /Facture deja payee dans Pennylane avant la creation de l'attente d'avoir/);
  assertContains(js, /Une validation est deja en cours/);
  assertContains(js, /Une verification du rapprochement est necessaire/);
  assertContains(js, /Pennylane n'a pas pu etre mis a jour/);
  assertContains(js, /Le statut de paiement a ete mis a jour dans Pennylane/);
  assertContains(js, /Document paye/);
}

function testNoDangerousSideEffects() {
  const js = read(jsPath);
  const service = read(path.join(root, 'backend/services/supplierControlService.js'));
  assertNotContains(js, /stock_quantity|stock_lots|stock_movements|purchase_lines|received_quantity/);
  assertNotContains(js, /supplier_invoices/);
  assertNotContains(js, /invoice_lines|supplier_invoice_lines/);
  assertNotContains(service, /INSERT INTO supplier_invoices/i);
}

function testNoFakeLineMatching() {
  const js = read(jsPath);
  const html = read(htmlPath);
  assertNotContains(js, /line_matching|purchase_lines|pennylane_supplier_invoice_lines/);
  assertContains(html, /Rapprochement avec les bons de livraison/);
}

function testCreditNoteWorkflowIsNotGloballyReadOnly() {
  const js = read(jsPath);
  assertContains(js, /renderCreditNoteMatching\(doc, !canMatchCreditNote\)/);
  assertContains(js, /renderValidation\(summary, doc, !canEditInvoiceControl\)/);
  assertContains(js, /renderActionState\(!canEditInvoiceControl, !canMatchCreditNote, doc\)/);
  assertContains(js, /renderProposals\(readOnly, doc = \{\}\)[\s\S]*doc\.document_type !== "credit_note"/);
  assertContains(js, /renderCandidates\(readOnly, doc = \{\}\)[\s\S]*doc\.document_type !== "credit_note"/);
  assertContains(js, /state\.detail\?\.document\?\.document_type !== "credit_note"/);
  assertContains(js, /\/api\/supplier-control\/credit-notes\/.+\/match-candidates/);
  assertContains(js, /\/api\/supplier-control\/credit-notes\/.+\/apply-match/);
  assertNotContains(js, /const readOnly = [^\n]+doc\.document_type === "credit_note"/);
}

(async () => {
  testPageAssetsAndMenu();
  testRequiredDomIds();
  testFiltersAndStatuses();
  testCanonicalEndpointsOnly();
  testActionsAndPayloads();
  testReadOnlyAndBusinessMessages();
  testNoDangerousSideEffects();
  testNoFakeLineMatching();
  testCreditNoteWorkflowIsNotGloballyReadOnly();
  console.log('OK supplier control UI tests');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
