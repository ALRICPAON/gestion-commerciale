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
  assert(html.includes('traceability.js?v=6'), 'Cache-buster JS traceability attendu');
  assert(html.includes('start-traceability-test-btn'), 'Bouton test tracabilite manquant');

  assert(js.includes('Retrait / Rappel produit'), 'Bouton rappel produit manquant');
  assert(js.includes('/api/traceability/lots/${encodeURIComponent(lotId)}/recall-analysis'), 'GET recall-analysis manquant');
  assert(js.includes('/api/traceability/lots/${encodeURIComponent(lotId)}/recall'), 'POST recall manquant');
  assert(js.includes('/api/traceability/recalls/${encodeURIComponent(campaignId)}'), 'Lecture campagne manquante');
  assert(js.includes('PRODUCT_RECALL_ACTIVE_EXISTS'), 'Gestion campagne active manquante');
  assert(js.includes('Commentaire obligatoire pour le type Autre'), 'Validation front type other manquante');
  assert(js.includes('Aucun email ne sera envoye'), 'Garde-fou UX email manquant');
  assert(js.includes('Envoyer les rappels selectionnes'), 'Bouton envoi selectionne manquant');
  assert(js.includes('/api/traceability/recalls/${encodeURIComponent(campaignId)}/send'), 'Endpoint envoi rappel manquant');
  assert(js.includes('Envoyer maintenant'), 'Confirmation finale envoi manquante');
  assert(js.includes('Les emails seront envoyes immediatement via ALTA MAREE'), 'Avertissement envoi immediat manquant');
  assert(js.includes("['ready', 'failed'].includes(recipient.status)"), 'Selection ready/failed manquante');
  assert(js.includes("pending: 'Envoi en cours / a verifier'"), 'Libelle pending a verifier manquant');
  assert(js.includes("recipient_ids: recipientIds"), 'Payload recipient_ids manquant');
  assert(js.includes('recall-recipient-checkbox'), 'Checkbox destinataires envoi manquante');
  assert(js.includes('function updateRecallSendButtonState'), 'Activation bouton envoi manquante');
  assert(js.includes('function renderRecallSendResultPanel'), 'Resultat detaille envoi manquant');
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
  assert(js.includes('/api/traceability/traceability-tests/lots'), 'Recherche lots test tracabilite manquante');
  assert(js.includes('/api/traceability/lots/${encodeURIComponent(lotId)}/traceability-test'), 'Endpoint test tracabilite manquant');
  assert(js.includes('traceability-test-result'), 'Choix resultat test tracabilite manquant');
  assert(js.includes('Action corrective obligatoire pour un test non conforme'), 'Validation non conforme test tracabilite manquante');

  assert(css.includes('.trace-recall-summary'), 'Styles resume rappel manquants');
  assert(css.includes('.trace-recall-recipient-list'), 'Styles recipients rappel manquants');
  assert(css.includes('@media (max-width: 760px)'), 'Responsive mobile traceability manquant');
}

function testBackendReadEndpoint() {
  const route = read('backend/routes/traceability.js');
  const service = read('backend/services/productRecallService.js');

  assert(route.includes("router.get('/recalls/:campaignId'"), 'Endpoint lecture rappel manquant');
  assert(route.includes("router.get('/traceability-tests/lots'"), 'Endpoint recherche lots test tracabilite manquant');
  assert(route.includes("router.get('/lots/:lotId/traceability-test'"), 'Endpoint lecture test tracabilite manquant');
  assert(route.includes("router.post('/lots/:lotId/traceability-test'"), 'Endpoint validation test tracabilite manquant');
  assert(route.includes("router.post('/recalls/:campaignId/send'"), 'Endpoint envoi rappel manquant');
  assert(route.includes('getProductRecallCampaign'), 'Route lecture rappel non branchee au service');
  assert(route.includes('sendProductRecallNotifications'), 'Route envoi rappel non branchee au service');
  assert(service.includes('async function getProductRecallCampaign'), 'Service lecture rappel manquant');
  assert(service.includes('async function sendProductRecallNotifications'), 'Service envoi rappel manquant');
  assert(service.includes("eventType: 'product_recall_notifications_processed'"), 'Evenement qualite notifications manquant');
  assert(service.includes("evidenceType: 'product_recall_notification_record'"), 'Preuve qualite notifications manquante');
  assert(service.includes('FROM product_recall_recipients'), 'Lecture recipients rappel manquante');
  assert(service.includes('WHERE c.store_id = $1::uuid'), 'Store isolation campagne manquante');
}

function testEmailOnlyOnSendEndpoint() {
  const frontend = read('frontend/js/traceability.js');
  const route = read('backend/routes/traceability.js');
  const service = read('backend/services/productRecallService.js');

  assert(!frontend.includes('sendEmail'), 'Le frontend ne doit jamais appeler sendEmail');
  assert(!frontend.includes('emailService'), 'Le frontend ne doit pas importer emailService');
  assert(!route.includes('sendEmail'), 'La route ne doit pas appeler directement sendEmail');
  assert(service.includes("const { sendEmail } = require('./emailService')"), 'Le service doit reutiliser emailService');
  assert(service.includes('sendEmailFn = sendEmail'), 'sendEmail doit rester injectable pour les tests');
  assert(service.includes('reserveRecallRecipientsForSend'), 'Reservation backend anti double envoi manquante');
  assert(service.includes('SMTP_SUCCESS_DB_PERSISTENCE_FAILED'), 'Incident SMTP OK / DB KO non journalise');
  assert(service.includes("status: 'pending'"), 'Incident apres SMTP doit rester pending');
}

function main() {
  testFrontendWiring();
  testBackendReadEndpoint();
  testEmailOnlyOnSendEndpoint();
  console.log(JSON.stringify({
    ok: true,
    tests: [
      'frontend_recall_workflow_wiring',
      'campaign_read_endpoint',
      'email_only_on_confirmed_send_endpoint',
      'cache_busters',
      'responsive_styles',
    ],
  }, null, 2));
}

main();
