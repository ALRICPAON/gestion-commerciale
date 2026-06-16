const { sendEmail } = require('./emailService');
const {
  renderDeliveryNotePdfAttachment,
  renderInvoicePdfAttachment,
} = require('./documentPdfService');

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function firstValue(...values) {
  return values.map(clean).find(Boolean) || null;
}

function defaultDeliveryNoteMessage(reference) {
  return `Bonjour,\n\nVeuillez trouver ci-joint votre bon de livraison ${reference}.\n\nCordialement,\nALTA MARÉE`;
}

function defaultInvoiceMessage(reference) {
  return `Bonjour,\n\nVeuillez trouver ci-joint votre facture ${reference}.\n\nCordialement,\nALTA MARÉE`;
}

async function getDeliveryNoteContacts(db, { storeId, deliveryNoteId }) {
  const result = await db.query(
    `
    SELECT dn.id, dn.reference_number,
      delivered.email AS delivered_client_email,
      billed.email AS billed_client_email,
      settings.email AS reply_to
    FROM sales_documents dn
    LEFT JOIN clients delivered ON delivered.id = dn.client_id AND delivered.store_id = dn.store_id
    LEFT JOIN clients billed ON billed.id = dn.billed_client_id AND billed.store_id = dn.store_id
    LEFT JOIN store_settings settings ON settings.store_id = dn.store_id
    WHERE dn.id = $1 AND dn.store_id = $2 AND dn.document_type = 'DELIVERY_NOTE'
    LIMIT 1
    `,
    [deliveryNoteId, storeId]
  );

  return result.rows[0] || null;
}

async function getInvoiceContacts(db, { storeId, invoiceId }) {
  const result = await db.query(
    `
    SELECT inv.id, inv.reference_number,
      billed.email AS billed_client_email,
      delivered.email AS delivered_client_email,
      billed.phone AS billed_client_phone,
      billed.mobile AS billed_client_mobile,
      delivered.phone AS delivered_client_phone,
      delivered.mobile AS delivered_client_mobile,
      settings.email AS reply_to
    FROM sales_documents inv
    LEFT JOIN sales_documents dn
      ON dn.id = inv.source_delivery_note_id
     AND dn.store_id = inv.store_id
     AND dn.document_type = 'DELIVERY_NOTE'
    LEFT JOIN clients billed
      ON billed.id = inv.billed_client_id
     AND billed.store_id = inv.store_id
    LEFT JOIN clients delivered
      ON delivered.id = COALESCE(inv.client_id, dn.client_id)
     AND delivered.store_id = inv.store_id
    LEFT JOIN store_settings settings ON settings.store_id = inv.store_id
    WHERE inv.id = $1 AND inv.store_id = $2 AND inv.document_type = 'INVOICE'
    LIMIT 1
    `,
    [invoiceId, storeId]
  );

  return result.rows[0] || null;
}

async function sendDeliveryNoteDocumentEmail(db, { storeId, deliveryNoteId, to, subject, message }) {
  const contacts = await getDeliveryNoteContacts(db, { storeId, deliveryNoteId });
  if (!contacts) {
    const error = new Error('BL introuvable');
    error.status = 404;
    error.expose = true;
    throw error;
  }

  const reference = contacts.reference_number || contacts.id;
  const recipient = clean(to) || firstValue(contacts.billed_client_email, contacts.delivered_client_email);
  if (!recipient) {
    const error = new Error('Aucun email client disponible pour ce BL');
    error.status = 400;
    error.expose = true;
    throw error;
  }

  const pdf = await renderDeliveryNotePdfAttachment(db, { storeId, deliveryNoteId });
  const email = await sendEmail({
    to: recipient,
    subject: clean(subject) || `Bon de livraison ${reference}`,
    text: clean(message) || defaultDeliveryNoteMessage(reference),
    replyTo: contacts.reply_to,
    attachments: [{
      filename: pdf.filename,
      content: pdf.content,
      contentType: pdf.contentType,
    }],
  });

  return {
    ok: true,
    to: recipient,
    delivery_note_id: contacts.id,
    delivery_note_reference: reference,
    attachment: pdf.filename,
    email,
  };
}

async function sendInvoiceDocumentEmail(db, { storeId, invoiceId, to, subject, message }) {
  const contacts = await getInvoiceContacts(db, { storeId, invoiceId });
  if (!contacts) {
    const error = new Error('Facture introuvable');
    error.status = 404;
    error.expose = true;
    throw error;
  }

  const reference = contacts.reference_number || contacts.id;
  const recipient = clean(to) || firstValue(contacts.billed_client_email, contacts.delivered_client_email);
  if (!recipient) {
    const error = new Error('Aucun email client disponible pour cette facture');
    error.status = 400;
    error.expose = true;
    throw error;
  }

  const pdf = await renderInvoicePdfAttachment(db, { storeId, invoiceId });
  const email = await sendEmail({
    to: recipient,
    subject: clean(subject) || `Facture ${reference}`,
    text: clean(message) || defaultInvoiceMessage(reference),
    replyTo: contacts.reply_to,
    attachments: [{
      filename: pdf.filename,
      content: pdf.content,
      contentType: pdf.contentType,
    }],
  });

  return {
    ok: true,
    to: recipient,
    invoice_id: contacts.id,
    invoice_reference: reference,
    attachment: pdf.filename,
    email,
  };
}

async function getInvoiceCommunicationDefaults(db, { storeId, invoiceId }) {
  const contacts = await getInvoiceContacts(db, { storeId, invoiceId });
  if (!contacts) return null;

  const reference = contacts.reference_number || contacts.id;
  const phone = firstValue(
    contacts.billed_client_mobile,
    contacts.billed_client_phone,
    contacts.delivered_client_mobile,
    contacts.delivered_client_phone
  );

  return {
    invoice_id: contacts.id,
    invoice_reference: reference,
    email: firstValue(contacts.billed_client_email, contacts.delivered_client_email),
    phone,
    subject: `Facture ${reference}`,
    message: defaultInvoiceMessage(reference),
    whatsapp_message: `Bonjour, votre facture ${reference} est disponible. Cordialement, ALTA MARÉE.`,
  };
}

module.exports = {
  defaultDeliveryNoteMessage,
  defaultInvoiceMessage,
  getInvoiceCommunicationDefaults,
  sendDeliveryNoteDocumentEmail,
  sendInvoiceDocumentEmail,
};
