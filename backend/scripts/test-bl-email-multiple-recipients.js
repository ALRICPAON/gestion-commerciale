const assert = require('assert');

let capturedEmail = null;
const emailServicePath = require.resolve('../services/emailService');
require.cache[emailServicePath] = {
  id: emailServicePath,
  filename: emailServicePath,
  loaded: true,
  exports: {
    sendEmail: async (payload) => {
      capturedEmail = payload;
      return { id: 'email-1', accepted: payload.to };
    },
  },
};

const pdfServicePath = require.resolve('../services/documentPdfService');
require.cache[pdfServicePath] = {
  id: pdfServicePath,
  filename: pdfServicePath,
  loaded: true,
  exports: {
    renderDeliveryNotePdfAttachment: async () => ({
      filename: 'BL-1.pdf',
      content: Buffer.from('pdf'),
      contentType: 'application/pdf',
    }),
    renderInvoicePdfAttachment: async () => ({
      filename: 'INV-1.pdf',
      content: Buffer.from('pdf'),
      contentType: 'application/pdf',
    }),
  },
};

const {
  parseEmailRecipients,
  resolveDocumentRecipients,
  recipientsToEmailList,
} = require('../services/documentRecipientService');
const { getDeliveryNoteCommunicationContext } = require('../services/deliveryNoteCommunicationService');
const { sendDeliveryNoteDocumentEmail } = require('../services/documentEmailService');

function makeRecipientDb({ preferredRows = [], fallbackRows = [] } = {}) {
  return {
    async query(sql) {
      if (sql.includes('FROM client_contacts') && sql.includes('receives_delivery_notes = true')) {
        return { rows: preferredRows };
      }
      if (sql.includes('FROM clients')) return { rows: fallbackRows };
      return { rows: [] };
    },
  };
}

(async () => {
  const preferred = await resolveDocumentRecipients(makeRecipientDb({
    preferredRows: [
      { contact_id: 'c1', contact_name: 'Jean', email: 'Jean@Client.fr', source: 'contact_preference' },
      { contact_id: 'c2', contact_name: 'Marie', email: 'marie@client.fr', source: 'contact_preference' },
      { contact_id: 'c3', contact_name: 'Doublon', email: 'JEAN@client.fr', source: 'contact_preference' },
      { contact_id: 'c4', contact_name: 'Sans email', email: '', source: 'contact_preference' },
    ],
  }), {
    entityType: 'client',
    entityId: 'client-1',
    documentType: 'delivery_note',
    storeId: 'store-1',
  });
  assert.deepStrictEqual(recipientsToEmailList(preferred), ['jean@client.fr', 'marie@client.fr']);
  assert.strictEqual(preferred.source, 'contact_preference');

  const invoiceOnlyIgnored = await resolveDocumentRecipients(makeRecipientDb({
    preferredRows: [],
    fallbackRows: [{ contact_id: null, contact_name: 'Client', email: 'direction@client.fr', source: 'legacy_client_email' }],
  }), {
    entityType: 'client',
    entityId: 'client-1',
    documentType: 'delivery_note',
    storeId: 'store-1',
  });
  assert.deepStrictEqual(recipientsToEmailList(invoiceOnlyIgnored), ['direction@client.fr']);
  assert.strictEqual(invoiceOnlyIgnored.source, 'legacy_client_email');

  assert.deepStrictEqual(parseEmailRecipients('a@test.fr; B@test.fr, a@test.fr').map((item) => item.email), ['a@test.fr', 'b@test.fr']);
  assert.deepStrictEqual(parseEmailRecipients(['', 'bad', 'ok@test.fr']).map((item) => item.email), ['ok@test.fr']);

  const contextDb = {
    async query(sql) {
      if (sql.includes('FROM sales_documents dn') && sql.includes("dn.document_type = 'DELIVERY_NOTE'")) {
        return { rows: [{ id: 'dn-1', store_id: 'store-1', reference_number: 'BL-1', delivered_client_id: 'client-1', billed_client_id: null, client_name: 'Client' }] };
      }
      if (sql.includes('FROM client_contacts') && sql.includes('receives_delivery_notes = true')) {
        return { rows: [
          { contact_id: 'c1', contact_name: 'Jean', email: 'jean@client.fr', source: 'contact_preference' },
          { contact_id: 'c2', contact_name: 'Marie', email: 'marie@client.fr', source: 'contact_preference' },
        ] };
      }
      if (sql.includes('FROM sales_lines')) return { rows: [] };
      if (sql.includes('FROM store_settings')) return { rows: [{ email: 'commercial@alta.test' }] };
      return { rows: [] };
    },
  };
  const context = await getDeliveryNoteCommunicationContext(contextDb, { storeId: 'store-1', deliveryNoteId: 'dn-1' });
  assert.deepStrictEqual(context.contacts.emails, ['jean@client.fr', 'marie@client.fr']);
  assert.strictEqual(context.contacts.email, 'jean@client.fr');
  assert.strictEqual(context.contacts.email_recipients.length, 2);

  const sendDb = {
    async query(sql) {
      if (sql.includes('FROM sales_documents dn') && sql.includes("dn.document_type = 'DELIVERY_NOTE'")) {
        return { rows: [{ id: 'dn-1', reference_number: 'BL-1', delivered_client_id: 'client-1', billed_client_id: null, reply_to: 'commercial@alta.test' }] };
      }
      return { rows: [] };
    },
  };
  const sent = await sendDeliveryNoteDocumentEmail(sendDb, {
    storeId: 'store-1',
    deliveryNoteId: 'dn-1',
    to: 'jean@client.fr; marie@client.fr; JEAN@client.fr',
  });
  assert.deepStrictEqual(sent.to, ['jean@client.fr', 'marie@client.fr']);
  assert.deepStrictEqual(capturedEmail.to, ['jean@client.fr', 'marie@client.fr']);

  console.log('bl email multiple recipients tests ok');
})();
