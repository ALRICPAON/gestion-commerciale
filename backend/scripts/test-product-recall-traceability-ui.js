const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function testFrontendWiring() {
  const html = read('frontend/traceability.html');
  const js = read('frontend/js/traceability.js');
  const css = read('frontend/css/pages/traceability.css');

  assert(html.includes('traceability.css?v=2'), 'Cache-buster CSS traceability attendu');
  assert(html.includes('traceability.js?v=4'), 'Cache-buster JS traceability attendu');

  assert(js.includes('Retrait / Rappel produit'), 'Bouton rappel produit manquant');
  assert(js.includes('/api/traceability/lots/${encodeURIComponent(lotId)}/recall-analysis'), 'GET recall-analysis manquant');
  assert(js.includes('/api/traceability/lots/${encodeURIComponent(lotId)}/recall'), 'POST recall manquant');
  assert(js.includes('/api/traceability/recalls/${encodeURIComponent(campaignId)}'), 'Lecture campagne manquante');
  assert(js.includes('PRODUCT_RECALL_ACTIVE_EXISTS'), 'Gestion campagne active manquante');
  assert(js.includes('Commentaire obligatoire pour le type Autre'), 'Validation front type other manquante');
  assert(js.includes('Aucun email ne sera envoye'), 'Garde-fou UX email manquant');
  assert(js.includes("Envoyer les rappels - disponible a l'etape suivante"), 'Bouton envoi doit rester desactive');
  assert(js.includes('id="recall-email-preview"'), 'Conteneur preview live manquant');
  assert(js.includes('function updateRecallEmailPreview'), 'Preview live manquante');
  assert(js.includes("matches('#recall-reason, #recall-comment')"), 'Preview live input motif/commentaire manquante');
  assert(js.includes("matches('#recall-type')"), 'Preview live change type manquante');
  assert(js.includes('Informations complementaires'), 'Section commentaire email manquante');
  assert(js.includes('recipient?.contact_name || recipient?.delivered_client_name'), 'Salutation contact_name puis client manquante');
  assert(js.includes('1 ? singular : plural'), 'Singulier/pluriel bandeau manquant');
  assert(js.includes('email pret a etre envoye'), 'Bandeau email pret manquant');
  assert(js.includes('contact a effectuer'), 'Bandeau contact a effectuer manquant');
  assert(js.includes('<div><span>Destinataire</span>'), 'Destinataire preview manquant');
  assert(js.includes('<div><span>Client</span>'), 'Client preview manquant');
  assert(js.includes('delivery_notes'), 'Detail BL par destinataire manquant');
  assert(js.includes('selectedRecallRecipient'), 'Preview personnalisee par destinataire manquante');
  assert(js.includes('renderRecallRecipients(source.recipients, { selectable: true })'), 'Selection destinataires post-creation manquante');

  assert(css.includes('.trace-recall-summary'), 'Styles resume rappel manquants');
  assert(css.includes('.trace-recall-recipient-list'), 'Styles recipients rappel manquants');
  assert(css.includes('@media (max-width: 760px)'), 'Responsive mobile traceability manquant');
}

function testBackendReadEndpoint() {
  const route = read('backend/routes/traceability.js');
  const service = read('backend/services/productRecallService.js');

  assert(route.includes("router.get('/recalls/:campaignId'"), 'Endpoint lecture rappel manquant');
  assert(route.includes('getProductRecallCampaign'), 'Route lecture rappel non branchee au service');
  assert(service.includes('async function getProductRecallCampaign'), 'Service lecture rappel manquant');
  assert(service.includes('FROM product_recall_recipients'), 'Lecture recipients rappel manquante');
  assert(service.includes('WHERE c.store_id = $1::uuid'), 'Store isolation campagne manquante');
}

function testNoEmailOrMigration() {
  const files = [
    'frontend/js/traceability.js',
    'backend/routes/traceability.js',
    'backend/services/productRecallService.js',
  ].map(read).join('\n');

  assert(!files.includes('sendEmail'), 'sendEmail ne doit pas etre utilise');
  assert(!files.includes('emailService'), 'emailService ne doit pas etre importe');
  assert(!files.includes('SMTP'), 'SMTP ne doit pas etre modifie');
  assert(!files.includes('smtp'), 'smtp ne doit pas etre modifie');
}

function main() {
  testFrontendWiring();
  testBackendReadEndpoint();
  testNoEmailOrMigration();
  console.log(JSON.stringify({
    ok: true,
    tests: [
      'frontend_recall_workflow_wiring',
      'campaign_read_endpoint',
      'no_email_no_smtp',
      'cache_busters',
      'responsive_styles',
    ],
  }, null, 2));
}

main();
