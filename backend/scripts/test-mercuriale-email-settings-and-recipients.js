const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const {
  resolveDocumentRecipients,
  recipientsToEmailList,
} = require('../services/documentRecipientService');
const {
  buildMercurialeEmailMessage,
  buildCustomerTariffEmailPreview,
  buildSummary,
  customerMercurialPdfPriceList,
  isMercurialEmailSendReady,
  resolveClientPricingLevel,
  resolveClientPricingLevelSource,
  resolveEmailSalutation,
  resolveMercurialeTargetTariff,
  sendCustomerTariffEmails,
  sendCustomerTariffTestEmail,
} = require('../services/customerTariffEmailService');
const { resolveCompanyEmail } = require('../services/pdf/pdfLayout');
const {
  MERCURIALE_PRICE_MENTION,
  renderMercurialePdf,
} = require('../services/pdf/templates/mercurialePdfTemplate');
const {
  buildCustomerPriceListPdfPayload,
  fetchSavedPriceListProductsByPricingLevel,
} = require('../services/customerPriceListPdfService');
const customerPriceListsRouter = require('../routes/customerPriceLists');
const customerTariffEmailsRouter = require('../routes/customerTariffEmails');
const pdfDocumentsRouter = require('../routes/pdfDocuments');

const TEST_UUID = '550e8400-e29b-41d4-a716-446655440000';

function savedPriceListLines() {
  return [{
    id: 'line-1',
    store_id: 'store-1',
    price_list_id: TEST_UUID,
    article_id: 'article-current',
    designation_snapshot: 'Produit courant enregistre',
    display_name: 'Produit courant enregistre',
    family_name: 'Famille',
    sale_unit: 'kg',
    stock_quantity_snapshot: 7,
    price_ht: null,
    price_level_1_ht: 11,
    price_level_2_ht: 22,
    price_level_3_ht: 33,
    tariff_level: null,
    is_featured: true,
    display_order: 1,
  }];
}

function findRouteHandler(router, pathPattern, method = 'get') {
  const layer = router.stack.find((entry) => entry.route?.path === pathPattern && entry.route.methods[method]);
  assert.ok(layer, `route ${method.toUpperCase()} ${pathPattern} trouvee`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    setHeader() {
      return this;
    },
  };
}

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

function sourceProductsDb({ clientRows = [] } = {}) {
  return {
    async query(sql) {
      const text = String(sql);
      if (text.includes('FROM clients c')) return { rows: clientRows };
      if (text.includes('FROM store_settings')) return { rows: [{ royale_maree_commission_eur_per_kg: 0 }] };
      if (text.includes('FROM quick_order_sheets')) return { rows: [] };
      if (text.includes('FROM stock_summary')) {
        return {
          rows: [{
            article_id: 'article-1',
            plu: 'PLU1',
            designation: 'Produit test',
            display_name: 'Produit test',
            unit: 'kg',
            sale_unit: 'kg',
            family_code: 'FAM',
            family_name: 'Famille',
            sale_price_ex_vat: 9,
            sale_price_level_1_ht: 10,
            sale_price_level_2_ht: 20,
            sale_price_level_3_ht: 30,
            stock_quantity: 5,
            pma: 6,
          }],
        };
      }
      throw new Error(`Requete source-products inattendue: ${text.slice(0, 80)}`);
    },
  };
}

async function callSourceProducts(query = {}, db = sourceProductsDb()) {
  const handler = findRouteHandler(customerPriceListsRouter, '/source-products');
  const res = mockRes();
  await handler({
    query,
    user: { store_id: 'store-1' },
    dbPool: db,
  }, res);
  return res;
}

function pdfRouteDb({ header = null, client = null, lines = savedPriceListLines() } = {}) {
  return {
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes('FROM customer_price_lists cpl')) {
        return { rows: [header || { id: TEST_UUID, client_id: null, tariff_level: null, title: 'Mercuriale generale', price_list_date: '2026-07-20' }] };
      }
      if (text.includes('FROM clients c')) {
        return { rows: client ? [client] : [] };
      }
      if (text.includes('FROM customer_price_list_lines')) return { rows: lines };
      if (text.includes('FROM store_settings')) return { rows: [{ royale_maree_commission_eur_per_kg: 0 }] };
      throw new Error(`Requete PDF inattendue: ${text.slice(0, 80)} | ${JSON.stringify(params)}`);
    },
  };
}

async function callCustomerPriceListPdf(db = pdfRouteDb()) {
  const handler = findRouteHandler(pdfDocumentsRouter, '/customer-price-lists/:id/pdf');
  const res = mockRes();
  await handler({
    params: { id: TEST_UUID },
    user: { store_id: 'store-1' },
    dbPool: db,
  }, res);
  return res;
}

async function callTariffEmailSend(body = {}) {
  const handler = findRouteHandler(customerTariffEmailsRouter, '/send', 'post');
  const res = mockRes();
  await handler({
    body,
    user: { id: 'user-1', store_id: 'store-1' },
    dbPool: deselectedSendDb(),
  }, res);
  return res;
}

function emailPreviewDb() {
  return {
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes('FROM customer_price_lists')) {
        return { rows: [{ price_list_id: TEST_UUID, price_list_date: '2026-07-20' }] };
      }
      if (text.includes('FROM clients c') && text.includes("c.status = 'active'")) {
        return {
          rows: [{
            id: 'client-1',
            code: 'C1',
            name: 'Client test',
            email: 'client@example.com',
            tariff_level: 1,
            parent_tariff_level: null,
            billed_tariff_level: null,
          }],
        };
      }
      if (text.includes('FROM store_settings')) {
        return {
          rows: [{
            company_name: 'ALTA MAREE',
            phone: '06 87 34 34 55',
            contact_email: 'contact@altamaree.fr',
            email_sender_address: 'commercial@altamaree.fr',
            website: 'https://altamaree.fr',
            royale_maree_commission_eur_per_kg: 0,
          }],
        };
      }
      if (text.includes('FROM customer_price_list_lines')) return { rows: savedPriceListLines() };
      if (text.includes('FROM quick_order_sheets')) return { rows: [{ id: 'sheet-1' }] };
      if (text.includes('FROM quick_order_sheet_products')) {
        return {
          rows: [{
            article_id: 'article-1',
            designation: 'Produit test',
            display_name: 'Produit test',
            family_name: 'Famille',
            sale_unit: 'kg',
            price_ht: params[2] === 1 ? 10 : 20,
          }],
        };
      }
      if (text.includes('FROM client_contacts') && text.includes('receives_price_lists = true')) {
        return { rows: [{ contact_id: 'contact-1', contact_name: 'Jean Dupont', email: 'prix@example.com', source: 'mercuriale_contact' }] };
      }
      if (text.includes('FROM client_contacts')) return { rows: [] };
      if (text.includes('NULL::uuid AS contact_id')) return { rows: [] };
      throw new Error(`Requete preview inattendue: ${text.slice(0, 80)}`);
    },
  };
}

function deselectedSendDb() {
  return {
    async query(sql) {
      const text = String(sql);
      if (text.includes('FROM customer_price_lists')) {
        return { rows: [{ price_list_id: TEST_UUID, price_list_date: '2026-07-20' }] };
      }
      if (text.includes('FROM clients c') && text.includes("c.status = 'active'")) {
        return {
          rows: [{
            id: 'client-1',
            name: 'Client test',
            email: 'client@example.com',
            tariff_level: 1,
          }],
        };
      }
      if (text.includes('FROM store_settings')) {
        return { rows: [{ contact_email: 'contact@altamaree.fr', email_sender_address: 'commercial@altamaree.fr' }] };
      }
      if (text.includes('FROM customer_price_list_lines')) return { rows: savedPriceListLines() };
      if (text.includes('FROM quick_order_sheets')) return { rows: [{ id: 'sheet-1' }] };
      if (text.includes('FROM quick_order_sheet_products')) {
        return { rows: [{ article_id: 'article-1', designation: 'Produit', family_name: 'Famille', sale_unit: 'kg', price_ht: 10 }] };
      }
      if (text.includes('INSERT INTO customer_price_list_email_batches')) {
        return { rows: [{ id: 'batch-1', created_at: '2026-07-20T00:00:00Z' }] };
      }
      if (text.includes('UPDATE customer_price_list_email_batches')) return { rows: [] };
      throw new Error(`Requete envoi deselection inattendue: ${text.slice(0, 80)}`);
    },
  };
}

function selectedSendDb({ withCompanyEmail = true } = {}) {
  return {
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes('FROM customer_price_lists')) {
        return { rows: [{ price_list_id: TEST_UUID, price_list_date: '2026-07-20' }] };
      }
      if (text.includes('FROM clients c') && text.includes("c.status = 'active'")) {
        return {
          rows: [
            { id: 'client-a', name: 'Client A', email: 'principal-a@test.fr', tariff_level: 1 },
            { id: 'client-b', name: 'Client B', email: 'principal-b@test.fr', tariff_level: 1 },
          ],
        };
      }
      if (text.includes('FROM store_settings')) {
        return { rows: [withCompanyEmail ? { contact_email: 'test@altamaree.fr', email_sender_address: 'commercial@altamaree.fr' } : { email_sender_address: 'commercial@altamaree.fr' }] };
      }
      if (text.includes('FROM customer_price_list_lines')) return { rows: savedPriceListLines() };
      if (text.includes('FROM quick_order_sheets')) return { rows: [{ id: 'sheet-1' }] };
      if (text.includes('FROM quick_order_sheet_products')) {
        return { rows: [{ article_id: 'article-1', designation: 'Produit', display_name: 'Produit', family_name: 'Famille', sale_unit: 'kg', price_ht: 10 }] };
      }
      if (text.includes('FROM client_contacts') && text.includes('receives_price_lists = true')) {
        return {
          rows: [
            { contact_id: 'contact-1', contact_name: 'Contact 1', email: 'merc1@test.fr', source: 'mercuriale_contact' },
            { contact_id: 'contact-2', contact_name: 'Contact 2', email: 'merc2@test.fr', source: 'mercuriale_contact' },
          ],
        };
      }
      if (text.includes('INSERT INTO customer_price_list_email_batches')) {
        return { rows: [{ id: 'batch-1', created_at: '2026-07-20T00:00:00Z' }] };
      }
      if (text.includes('INSERT INTO customer_price_list_email_results')) return { rows: [] };
      if (text.includes('UPDATE customer_price_list_email_batches')) return { rows: [] };
      throw new Error(`Requete envoi selection inattendue: ${text.slice(0, 100)} | ${JSON.stringify(params)}`);
    },
  };
}

(async () => {
  const preferred = await resolveClient([
    [{ contact_id: 'c1', contact_name: 'Mercuriale', email: 'prix@example.com', source: 'mercuriale_contact' }],
  ]);
  assert.deepEqual(recipientsToEmailList(preferred), ['prix@example.com'], 'contact mercuriale actif utilise');
  assert.equal(preferred.source, 'mercuriale_contact');
  assert.equal(preferred.preferred_count, 1);

  const multiplePreferred = await resolveClient([
    [
      { contact_id: 'c1', contact_name: 'A', email: 'prix@example.com', source: 'mercuriale_contact' },
      { contact_id: 'c2', contact_name: 'B', email: 'prix2@example.com', source: 'mercuriale_contact' },
      { contact_id: 'c3', contact_name: 'Doublon', email: 'PRIX@example.com', source: 'mercuriale_contact' },
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

  const clientEmailFallback = await resolveClient([
    [],
    [{ contact_id: null, contact_name: 'Client', email: 'client@example.com', source: 'client_fallback' }],
  ]);
  assert.deepEqual(recipientsToEmailList(clientEmailFallback), ['client@example.com'], 'fallback email fiche client');
  assert.equal(clientEmailFallback.source, 'client_fallback');

  assert.equal(resolveClientPricingLevel({ tariff_level: 3 }), 3, 'client avec tarif propre');
  assert.equal(resolveClientPricingLevelSource({ tariff_level: 3 }), 'client', 'source tarif propre');
  assert.equal(resolveClientPricingLevel({ id: 'client-sans-parent', tariff_level: 1 }), 1, 'preparation emails client sans parent ne plante pas');
  assert.equal(resolveClientPricingLevel({ tariff_level: null, parent_tariff_level: 1 }), 1, 'client sans tarif herite du parent');
  assert.equal(resolveClientPricingLevelSource({ tariff_level: null, parent_tariff_level: 1 }), 'parent', 'source tarif parent');
  assert.equal(resolveClientPricingLevel({ tariff_level: null, parent_tariff_level: null, billed_tariff_level: 2 }), 2, 'client sans parent herite du facture');
  assert.equal(resolveClientPricingLevelSource({ tariff_level: null, parent_tariff_level: null, billed_tariff_level: 2 }), 'billed', 'source tarif facture');
  assert.equal(resolveClientPricingLevel({ tariff_level: 2, parent_tariff_level: 1, billed_tariff_level: 3 }), 2, 'priorite tarif client sur parent');
  assert.equal(resolveClientPricingLevel({ tariff_level: null, parent_tariff_level: 1, billed_tariff_level: 2 }), 1, 'priorite parent sur facture');
  assert.equal(resolveClientPricingLevel({ tariff_level: null, parent_tariff_level: null, billed_tariff_level: null }), null, 'aucun tarif valide');
  assert.equal(resolveClientPricingLevel({ tariff_level: 9, parent_tariff_level: 0, billed_tariff_level: 'x' }), null, 'tarifs invalides ignores');
  assert.equal(resolveClientPricingLevel(null), null, 'client null sans TypeError');
  assert.equal(resolveClientPricingLevelSource(null), null, 'source client null sans TypeError');
  assert.equal(resolveClientPricingLevel(undefined), null, 'client undefined sans TypeError');
  assert.equal(
    resolveMercurialeTargetTariff({ targetTariffLevel: 2, client: null }),
    2,
    'route PDF sans client utilise le niveau tarifaire fourni'
  );
  assert.equal(
    resolveMercurialeTargetTariff({ targetTariffLevel: null, client: null }),
    null,
    'route PDF sans client ni tarif detecte la 400 metier'
  );
  assert.equal(
    resolveMercurialeTargetTariff({ targetTariffLevel: 1, client: { tariff_level: 2, parent_tariff_level: 3 } }),
    1,
    'target_tariff_level explicite prioritaire'
  );
  assert.equal(resolveEmailSalutation('Jean Dupont'), 'Bonjour Jean,', 'salutation utilise le prenom');
  assert.equal(resolveEmailSalutation('Jean-Pierre Martin'), 'Bonjour Jean-Pierre,', 'salutation conserve le prenom compose');
  assert.equal(resolveEmailSalutation(''), 'Bonjour,', 'salutation generique sans contact');
  const renderedMail = buildMercurialeEmailMessage({
    storeSettings: {
      phone: '06 87 34 34 55',
      contact_email: 'contact@altamaree.fr',
      email_sender_address: 'commercial@altamaree.fr',
      website: 'https://altamaree.fr',
    },
    recipientResolution: {
      recipients: [{ contact_name: 'Jean Dupont', email: 'jean@example.com' }],
    },
    mercurialeDate: '2026-07-20',
    commonMessage: 'Message commun modifie.',
    clientTariffLevel: 2,
    pdfFilename: 'Mercuriale_ALTA_MAREE_2026-07-17.pdf',
  });
  assert.equal(renderedMail.subject, 'Mercuriale ALTA MARÉE - Départ du 20/07/2026', 'objet utilise la date mercuriale');
  assert.ok(renderedMail.body.includes('Bonjour Jean,'), 'corps personnalise avec prenom');
  assert.ok(renderedMail.body.includes('Message commun modifie.'), 'message commun modifie dans le corps');
  assert.equal(renderedMail.client_tariff_level, 2, 'preview expose le niveau tarifaire client');
  assert.equal(renderedMail.attachment_filename, 'Mercuriale_ALTA_MAREE_2026-07-17.pdf', 'nom PDF expose dans preview');
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
  assert.equal(customerMercurialPdfPriceList(null).tariff_level, null, 'PDF email accepte un client null');

  const sourceWithoutTarget = await callSourceProducts();
  assert.equal(sourceWithoutTarget.statusCode, 200, 'source-products sans client ni tarif retourne 200');
  assert.equal(sourceWithoutTarget.body.target_tariff_level, null, 'source-products accepte un tarif cible null');
  assert.equal(sourceWithoutTarget.body.products[0].price_level_1_ht, 10, 'source-products conserve le prix niveau 1');
  assert.equal(sourceWithoutTarget.body.products[0].price_level_2_ht, 20, 'source-products conserve le prix niveau 2');
  assert.equal(sourceWithoutTarget.body.products[0].price_level_3_ht, 30, 'source-products conserve le prix niveau 3');
  assert.equal(sourceWithoutTarget.body.products[0].suggested_price_ht, null, 'source-products sans tarif ne suggere pas de prix unique');
  assert.equal(sourceWithoutTarget.body.products[0].suggested_price_source, 'none', 'source-products sans tarif garde source none');

  const sourceWithTarget = await callSourceProducts({ target_tariff_level: '1' });
  assert.equal(sourceWithTarget.statusCode, 200, 'source-products avec tarif explicite retourne 200');
  assert.equal(sourceWithTarget.body.target_tariff_level, 1, 'source-products target_tariff_level=1 utilise le tarif 1');
  assert.equal(sourceWithTarget.body.products[0].suggested_price_ht, 10, 'source-products target_tariff_level=1 suggere le prix niveau 1');

  const sourceWithInheritedParent = await callSourceProducts(
    { client_id: TEST_UUID },
    sourceProductsDb({
      clientRows: [{
        id: TEST_UUID,
        name: 'Leclerc affilie',
        tariff_level: null,
        parent_tariff_level: 1,
        billed_tariff_level: null,
      }],
    })
  );
  assert.equal(sourceWithInheritedParent.statusCode, 200, 'source-products client affilie retourne 200');
  assert.equal(sourceWithInheritedParent.body.target_tariff_level, 1, 'source-products client affilie herite du tarif parent');

  const emailPreview = await buildCustomerTariffEmailPreview(emailPreviewDb(), 'store-1', {
    price_list_id: TEST_UUID,
    common_message: 'Message commun modifie.',
  });
  assert.equal(emailPreview.summary.eligible, 1, 'preview email globale fonctionne sans client transmis');
  assert.equal(emailPreview.mercuriale_date, '2026-07-20', 'preview utilise la date de mercuriale fournie');
  assert.equal(emailPreview.stored_mercuriale_date, '2026-07-20', 'preview retrouve la date en base depuis price_list_id');
  assert.equal(emailPreview.resolved_mercuriale_date, '2026-07-20', 'diagnostic date resolue expose');
  assert.equal(
    emailPreview.recipients[0].mail_preview.subject,
    'Mercuriale ALTA MARÉE - Départ du 20/07/2026',
    'objet utilise la date en base de la mercuriale'
  );
  assert.equal(emailPreview.recipients[0].mail_preview.salutation, 'Bonjour Jean,', 'preview email affiche la salutation personnalisee');
  assert.equal(emailPreview.recipients[0].mail_preview.text, emailPreview.recipients[0].mail_preview.body, 'preview affiche le meme texte que l envoi');
  assert.ok(emailPreview.recipients[0].mail_preview.body.includes('Message commun modifie.'), 'preview utilise le message commun modifie');
  assert.equal(emailPreview.recipients[0].mail_preview.client_tariff_level, 1, 'preview expose le tarif unique du client');
  assert.equal(emailPreview.recipients[0].mail_preview.attachment_filename, emailPreview.attachment_filename, 'preview expose le PDF joint exact');

  await assert.rejects(
    () => sendCustomerTariffEmails(deselectedSendDb(), 'store-1', {
      price_list_id: TEST_UUID,
      selected_client_ids: [],
      common_message: 'Message commun modifie.',
    }),
    /Aucun client sélectionné pour l’envoi/,
    'selection vide refusee cote backend'
  );
  const emptySelectionResponse = await callTariffEmailSend({ selected_client_ids: [] });
  assert.equal(emptySelectionResponse.statusCode, 400, 'route envoi refuse une selection vide');
  assert.equal(emptySelectionResponse.body.error, 'Aucun client sélectionné pour l’envoi', 'route envoi retourne une erreur claire selection vide');

  const sentMessages = [];
  const emailPdfInputs = [];
  const selectedSend = await sendCustomerTariffEmails(selectedSendDb(), 'store-1', {
    price_list_id: TEST_UUID,
    selected_client_ids: ['client-a'],
    common_message: 'Message commun modifie.',
    buildPdf: async (input) => {
      emailPdfInputs.push(input);
      return Buffer.from('PDF tarif unique');
    },
    sendEmail: async (message) => {
      sentMessages.push(message);
      return { message_id: `message-${sentMessages.length}` };
    },
  });
  assert.equal(selectedSend.summary.sent, 1, 'un seul client selectionne envoye');
  assert.equal(sentMessages.length, 1, 'aucun envoi aux autres clients actifs');
  assert.deepEqual(sentMessages[0].to, ['merc1@test.fr', 'merc2@test.fr'], 'tous les contacts mercuriale transmis au SMTP');
  assert.equal(emailPdfInputs[0].products[0].designation_snapshot, 'Produit courant enregistre', 'PDF email recoit les produits courants');
  assert.equal(emailPdfInputs[0].products[0].price_ht, 11, 'PDF email recoit le prix courant du tarif client');

  const testMessages = [];
  await sendCustomerTariffTestEmail(selectedSendDb({ withCompanyEmail: false }), 'store-1', {
    price_list_id: TEST_UUID,
    selected_client_ids: ['client-a'],
    to: 'test-destinataire@altamaree.fr',
    buildPdf: async () => Buffer.from('PDF test tarif unique'),
    sendEmail: async (message) => {
      testMessages.push(message);
      return { message_id: 'test-message' };
    },
  });
  assert.equal(testMessages.length, 1, 'email test envoye une seule fois');
  assert.equal(testMessages[0].to, 'test-destinataire@altamaree.fr', 'email test envoye uniquement a l adresse test');

  const savedProductsByLevel = await fetchSavedPriceListProductsByPricingLevel(
    pdfRouteDb(),
    'store-1',
    TEST_UUID,
    { royale_maree_commission_eur_per_kg: 0 }
  );
  assert.equal(savedProductsByLevel[1][0].designation_snapshot, 'Produit courant enregistre', 'email charge les lignes de la mercuriale enregistree');
  assert.equal(savedProductsByLevel[1][0].price_ht, 11, 'email utilise le prix niveau 1 enregistre');
  assert.equal(savedProductsByLevel[2][0].price_ht, 22, 'email utilise le prix niveau 2 enregistre');

  const generalPdfPayload = await buildCustomerPriceListPdfPayload(pdfRouteDb(), {
    storeId: 'store-1',
    priceListId: TEST_UUID,
    requireTargetTariff: false,
  });
  assert.equal(generalPdfPayload.lines[0].designation_snapshot, 'Produit courant enregistre', 'PDF telecharge charge les produits courants');
  assert.equal(generalPdfPayload.lines[0].price_level_1_ht, 11, 'PDF telecharge conserve le tarif 1 courant');
  assert.equal(generalPdfPayload.lines[0].price_level_2_ht, 22, 'PDF telecharge conserve le tarif 2 courant');
  assert.equal(generalPdfPayload.lines[0].price_level_3_ht, 33, 'PDF telecharge conserve le tarif 3 courant');

  const directTariffPdfPayload = await buildCustomerPriceListPdfPayload(pdfRouteDb({
    header: { id: TEST_UUID, client_id: null, tariff_level: 2, title: 'Mercuriale tarif 2', price_list_date: '2026-07-20' },
  }), {
    storeId: 'store-1',
    priceListId: TEST_UUID,
    requireTargetTariff: true,
  });
  assert.equal(directTariffPdfPayload.resolvedTariffLevel, 2, 'PDF sans client utilise le niveau tarifaire direct');

  const inheritedTariffPdfPayload = await buildCustomerPriceListPdfPayload(pdfRouteDb({
    header: { id: TEST_UUID, client_id: 'client-rm', tariff_level: null, title: 'Mercuriale client', price_list_date: '2026-07-20' },
    client: { id: 'client-rm', name: 'Leclerc affilie', tariff_level: null, parent_tariff_level: 1, billed_tariff_level: 2 },
  }), {
    storeId: 'store-1',
    priceListId: TEST_UUID,
    requireTargetTariff: true,
  });
  assert.equal(inheritedTariffPdfPayload.resolvedTariffLevel, 1, 'PDF client herite le tarif parent');

  await assert.rejects(
    () => buildCustomerPriceListPdfPayload(pdfRouteDb({ header: { id: TEST_UUID, client_id: null, tariff_level: null, title: 'Sans tarif' } }), {
      storeId: 'store-1',
      priceListId: TEST_UUID,
      requireTargetTariff: true,
    }),
    /Client ou niveau tarifaire requis pour générer la mercuriale/,
    'PDF personnalise sans client ni tarif retourne une erreur claire'
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

  const frontendEmail = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/js/customer-price-list-email.js'),
    'utf8'
  );
  assert.ok(frontendEmail.includes('mail_preview'), 'frontend utilise la preview email backend');
  assert.ok(frontendEmail.includes('/api/customer-price-lists/email/test'), 'frontend expose l envoi de test');
  assert.ok(frontendEmail.includes("requestJson('/api/customer-price-lists/email/preview'"), 'frontend appelle la preview email');
  assert.ok(frontendEmail.includes("method: 'POST'"), 'frontend prepare les emails en POST');
  assert.ok(!frontendEmail.includes("email/preview${previewQuery()}"), 'frontend ne prepare plus les emails en GET');
  assert.ok(frontendEmail.includes('Envoyer un test'), 'frontend affiche le bouton envoyer un test');
  assert.ok(frontendEmail.includes('selected_client_ids'), 'frontend envoie la selection visible');
  assert.ok(frontendEmail.includes('selectedReadyRecipients(preview)'), 'frontend calcule la selection courante');
  assert.ok(frontendEmail.includes('Clients selectionnes'), 'confirmation utilise les clients selectionnes');
  const confirmationFunction = frontendEmail.slice(
    frontendEmail.indexOf('function buildConfirmationMessage'),
    frontendEmail.indexOf('async function sendMercurialEmails')
  );
  assert.ok(!confirmationFunction.includes('summary.total_clients'), 'confirmation n utilise plus le total global');
  assert.ok(frontendEmail.includes('Message commun'), 'frontend affiche le message commun');

  const frontendController = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/js/customer-price-list.js'),
    'utf8'
  );
  assert.ok(frontendController.includes('currentPriceList?.price_list_date'), 'frontend utilise la date de la mercuriale chargee');
  assert.ok(frontendController.includes('const inputDate = priceListDateInput?.value || null'), 'frontend lit la date visible si mercuriale non enregistree');
  assert.ok(frontendController.includes('const resolvedDate = storedDate || inputDate || null'), 'frontend resout une date unique pour les emails');
  assert.ok(frontendController.includes('mercuriale_date: resolvedDate'), 'frontend transmet mercuriale_date meme avant enregistrement');
  assert.ok(frontendController.includes('currentPriceList = data.price_list'), 'frontend conserve la mercuriale courante');

  console.log('mercuriale-email-settings-and-recipients: ok');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
