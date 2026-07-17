const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const {
  resolveDocumentRecipients,
  recipientsToEmailList,
} = require('../services/documentRecipientService');
const {
  buildSummary,
  customerMercurialPdfPriceList,
  isMercurialEmailSendReady,
  resolveClientPricingLevel,
  resolveClientPricingLevelSource,
} = require('../services/customerTariffEmailService');
const { resolveCompanyEmail } = require('../services/pdf/pdfLayout');
const {
  MERCURIALE_PRICE_MENTION,
  renderMercurialePdf,
} = require('../services/pdf/templates/mercurialePdfTemplate');

function mockDb(queryRows) {
  let index = 0;
  return {
    async query() {
      const rows = queryRows[index] || [];
      index += 1;
      return { rows };
    },
  };
}

async function resolveClient(queryRows) {
  return resolveDocumentRecipients(mockDb(queryRows), {
    entityType: 'client',
    entityId: 'client-1',
    documentType: 'price_list',
    storeId: 'store-1',
  });
}

(async () => {
  const preferred = await resolveClient([
    [{ contact_id: 'c1', contact_name: 'Mercuriale', email: 'prix@example.com', source: 'contact_preference' }],
  ]);
  assert.deepEqual(recipientsToEmailList(preferred), ['prix@example.com'], 'contact mercuriale actif utilise');
  assert.equal(preferred.source, 'contact_preference');
  assert.equal(preferred.preferred_count, 1);

  const multiplePreferred = await resolveClient([
    [
      { contact_id: 'c1', contact_name: 'A', email: 'prix@example.com', source: 'contact_preference' },
      { contact_id: 'c2', contact_name: 'B', email: 'prix2@example.com', source: 'contact_preference' },
      { contact_id: 'c3', contact_name: 'Doublon', email: 'PRIX@example.com', source: 'contact_preference' },
    ],
  ]);
  assert.deepEqual(
    recipientsToEmailList(multiplePreferred),
    ['prix@example.com', 'prix2@example.com'],
    'plusieurs contacts mercuriale actifs dedoublonnes'
  );
  assert.equal(multiplePreferred.preferred_count, 3);

  const unchecked = await resolveClient([[], [], []]);
  assert.deepEqual(recipientsToEmailList(unchecked), [], 'contact mercuriale non coche non retenu');
  assert.equal(unchecked.preferred_count, 0);

  const primaryFallback = await resolveClient([
    [],
    [{ contact_id: 'c4', contact_name: 'Principal', email: 'principal@example.com', source: 'primary_contact' }],
  ]);
  assert.deepEqual(recipientsToEmailList(primaryFallback), ['principal@example.com'], 'fallback contact principal');
  assert.equal(primaryFallback.source, 'primary_contact');

  const clientEmailFallback = await resolveClient([
    [],
    [],
    [{ contact_id: null, contact_name: 'Client', email: 'client@example.com', source: 'legacy_client_email' }],
  ]);
  assert.deepEqual(recipientsToEmailList(clientEmailFallback), ['client@example.com'], 'fallback email fiche client');
  assert.equal(clientEmailFallback.source, 'legacy_client_email');

  assert.equal(resolveClientPricingLevel({ tariff_level: 3 }), 3, 'client avec tarif propre');
  assert.equal(resolveClientPricingLevelSource({ tariff_level: 3 }), 'client', 'source tarif propre');
  assert.equal(resolveClientPricingLevel({ tariff_level: null, parent_tariff_level: 1 }), 1, 'client sans tarif herite du parent');
  assert.equal(resolveClientPricingLevelSource({ tariff_level: null, parent_tariff_level: 1 }), 'parent', 'source tarif parent');
  assert.equal(resolveClientPricingLevel({ tariff_level: null, parent_tariff_level: null, billed_tariff_level: 2 }), 2, 'client sans parent herite du facture');
  assert.equal(resolveClientPricingLevelSource({ tariff_level: null, parent_tariff_level: null, billed_tariff_level: 2 }), 'billed', 'source tarif facture');
  assert.equal(resolveClientPricingLevel({ tariff_level: 2, parent_tariff_level: 1, billed_tariff_level: 3 }), 2, 'priorite tarif client sur parent');
  assert.equal(resolveClientPricingLevel({ tariff_level: null, parent_tariff_level: 1, billed_tariff_level: 2 }), 1, 'priorite parent sur facture');
  assert.equal(resolveClientPricingLevel({ tariff_level: null, parent_tariff_level: null, billed_tariff_level: null }), null, 'aucun tarif valide');
  assert.equal(resolveClientPricingLevel({ tariff_level: 9, parent_tariff_level: 0, billed_tariff_level: 'x' }), null, 'tarifs invalides ignores');
  assert.equal(
    resolveClientPricingLevel({
      is_royale_maree_member: true,
      parent_client_name: 'ROYALE MAREE',
      tariff_level: null,
      parent_tariff_level: 1,
    }),
    1,
    'affilie Royale Maree sans tarif propre utilise le tarif parent'
  );
  assert.equal(
    customerMercurialPdfPriceList({ name: 'Leclerc affilie', tariff_level: null, parent_tariff_level: 1 }).tariff_level,
    1,
    'PDF email utilise le tarif resolu'
  );

  const summary = buildSummary([
    { email: 'a@example.com', resolved_tariff_level: 1, pricing_level_source: 'client', item_count: 3, price_list_contact_count: 1, recipient_source: 'contact_preference' },
    { email: 'b@example.com', resolved_tariff_level: null, pricing_level_source: null, item_count: 3, price_list_contact_count: 1, recipient_source: 'contact_preference' },
    { email: null, resolved_tariff_level: 1, pricing_level_source: 'parent', item_count: 3, price_list_contact_count: 0, recipient_source: null },
    { email: 'c@example.com', resolved_tariff_level: 2, pricing_level_source: 'billed', item_count: 0, price_list_contact_count: 0, recipient_source: 'legacy_client_email' },
  ]);
  assert.equal(summary.eligible, 1, 'un seul client eligible');
  assert.equal(summary.without_tariff, 1, 'client sans tarif diagnostique');
  assert.equal(summary.without_email, 1, 'client sans email diagnostique');
  assert.equal(summary.without_products, 1, 'client sans produit diagnostique');
  assert.equal(summary.price_list_contacts, 2, 'contacts mercuriale comptes');
  assert.equal(summary.own_tariff, 1, 'tarifs propres comptes');
  assert.equal(summary.parent_tariff, 1, 'tarifs herites parent comptes');
  assert.equal(summary.billed_tariff, 1, 'tarifs herites facture comptes');

  assert.equal(
    isMercurialEmailSendReady({ smtp: { configured: true }, summary: { eligible: 1 } }),
    true,
    'SMTP configure et eligible active le bouton'
  );
  assert.equal(
    isMercurialEmailSendReady({ smtp: { configured: false }, summary: { eligible: 1 } }),
    false,
    'SMTP incomplet bloque le bouton'
  );

  assert.equal(
    resolveCompanyEmail({
      contact_email: 'contact@altamaree.fr',
      email: 'societe@altamaree.fr',
      email_sender_address: 'sender@altamaree.fr',
    }),
    'contact@altamaree.fr',
    'email societe priorise contact_email'
  );

  const pdfHtml = renderMercurialePdf({
    priceListOrClient: { title: 'Test', tariff_level: 1, price_list_date: '2026-07-17' },
    lines: [{ designation_snapshot: 'Produit', sale_unit: 'kg', price_ht: 20 }],
    storeSettings: { company_name: 'ALTA MAREE', contact_email: 'contact@altamaree.fr' },
  });
  assert.ok(pdfHtml.includes(MERCURIALE_PRICE_MENTION), 'PDF contient Prix rendu');
  assert.ok(pdfHtml.includes('contact@altamaree.fr'), 'PDF utilise contact_email');

  const frontendPrint = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/js/customer-price-list-print.js'),
    'utf8'
  );
  assert.ok(frontendPrint.includes("MERCURIALE_PRICE_MENTION = 'Prix rendu'"), 'apercu contient Prix rendu');
  assert.ok(frontendPrint.includes('settings.contact_email || settings.email || settings.email_sender_address'), 'apercu resout email societe');

  console.log('mercuriale-email-settings-and-recipients: ok');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
