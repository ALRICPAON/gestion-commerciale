const {
  maskPhoneNumber,
  normalizePhoneNumber,
  sendTextMessage,
} = require('./whatsappService');

const DOCUMENT_TYPES = {
  sale: 'ORDER',
  delivery_note: 'DELIVERY_NOTE',
  invoice: 'INVOICE',
};

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function firstPhone(...values) {
  for (const value of values) {
    const phone = normalizePhoneNumber(value);
    if (phone) return phone;
  }
  return null;
}

function shortId(value) {
  return String(value || '').split('-')[0] || '-';
}

function reference(row, fallbackPrefix) {
  return clean(row?.reference_number)
    || clean(row?.bl_number)
    || clean(row?.invoice_number)
    || `${fallbackPrefix}-${shortId(row?.id)}`;
}

function formatMoney(value) {
  const number = Number(value || 0);
  return number.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatQuantity(value) {
  const number = Number(value || 0);
  return number.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function businessError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function salesMessage(documentType, docRef) {
  if (documentType === 'DELIVERY_NOTE') {
    return `Bonjour,\n\nVotre bon de livraison ${docRef} est disponible.\n\nCordialement,\nALTA MARÉE`;
  }
  if (documentType === 'INVOICE') {
    return `Bonjour,\n\nVotre facture ${docRef} est disponible.\n\nCordialement,\nALTA MARÉE`;
  }
  return `Bonjour,\n\nVotre commande ${docRef} a bien été enregistrée.\n\nCordialement,\nALTA MARÉE`;
}

function purchaseLineSummary(lines = []) {
  const usefulLines = lines.slice(0, 12).map((line) => {
    const label = clean(line.article_name) || clean(line.supplier_label) || 'Article';
    const quantity = Number(line.ordered_quantity || 0) || Number(line.ordered_colis || 0) || Number(line.ordered_pieces || 0);
    const unit = clean(line.price_unit) || 'kg';
    return `- ${label}: ${formatQuantity(quantity)} ${unit}`;
  });
  if (!usefulLines.length) return '- Lignes de commande à confirmer';
  if (lines.length > usefulLines.length) usefulLines.push(`- ... ${lines.length - usefulLines.length} ligne(s) supplémentaire(s)`);
  return usefulLines.join('\n');
}

function priceListSummary(lines = []) {
  const usefulLines = lines.slice(0, 18).map((line) => {
    const label = clean(line.designation_snapshot) || 'Article';
    const price = line.price_ht ?? line.price_level_1_ht ?? line.price_level_2_ht ?? line.price_level_3_ht;
    const unit = clean(line.sale_unit) || 'kg';
    return `- ${label}: ${formatMoney(price)} € HT/${unit}`;
  });
  if (!usefulLines.length) return '- Aucun article disponible';
  if (lines.length > usefulLines.length) usefulLines.push(`- ... ${lines.length - usefulLines.length} article(s) supplémentaire(s)`);
  return usefulLines.join('\n');
}

function purchaseMessage(purchase, lines) {
  return `Bonjour,\n\nVeuillez trouver notre commande ${reference(purchase, 'ACHAT')} :\n\n${purchaseLineSummary(lines)}\n\nCordialement,\nALTA MARÉE`;
}

function priceListMessage(lines) {
  return `Bonjour,\n\nVoici les cours ALTA MARÉE du jour :\n\n${priceListSummary(lines)}\n\nCordialement,\nALTA MARÉE`;
}

async function clientRecipientContext(db, { storeId, clientId }) {
  if (!clientId) return null;
  const result = await db.query(
    `
    SELECT id, name, mobile, phone
    FROM clients
    WHERE id = $1
      AND store_id = $2
      AND status <> 'inactive'
    LIMIT 1
    `,
    [clientId, storeId]
  );
  const client = result.rows[0];
  if (!client) return null;
  const to = firstPhone(client.mobile, client.phone);
  return {
    recipient_name: clean(client.name),
    to,
    masked_to: maskPhoneNumber(to),
  };
}

async function getSalesDocumentContext(db, { storeId, id, kind }) {
  const expectedType = DOCUMENT_TYPES[kind];
  const result = await db.query(
    `
    SELECT
      sd.id,
      sd.document_type,
      sd.reference_number,
      sd.document_date,
      sd.client_id,
      sd.billed_client_id,
      COALESCE(c.name, billed.name, sd.delivered_client_name_snapshot, sd.billed_client_name_snapshot) AS recipient_name,
      c.mobile AS client_mobile,
      c.phone AS client_phone,
      billed.mobile AS billed_mobile,
      billed.phone AS billed_phone
    FROM sales_documents sd
    LEFT JOIN clients c ON c.id = sd.client_id AND c.store_id = sd.store_id
    LEFT JOIN clients billed ON billed.id = COALESCE(sd.billed_client_id, sd.client_id) AND billed.store_id = sd.store_id
    WHERE sd.id = $1
      AND sd.store_id = $2
      AND sd.document_type = $3
    LIMIT 1
    `,
    [id, storeId, expectedType]
  );

  const document = result.rows[0];
  if (!document) throw businessError('Document client introuvable', 404);
  const docRef = reference(document, expectedType === 'ORDER' ? 'COMMANDE' : expectedType === 'INVOICE' ? 'FACTURE' : 'BL');
  const to = firstPhone(document.billed_mobile, document.client_mobile, document.billed_phone, document.client_phone);
  return {
    document_type: kind,
    document_id: document.id,
    recipient_name: clean(document.recipient_name),
    to,
    masked_to: maskPhoneNumber(to),
    message: salesMessage(expectedType, docRef),
  };
}

async function getPurchaseContext(db, { storeId, id }) {
  const purchaseResult = await db.query(
    `
    SELECT
      p.id,
      p.bl_number,
      p.invoice_number,
      p.order_date,
      p.purchase_date,
      p.supplier_id,
      s.name AS supplier_name,
      s.mobile AS supplier_mobile,
      s.phone AS supplier_phone
    FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.store_id = p.store_id
    WHERE p.id = $1
      AND p.store_id = $2
    LIMIT 1
    `,
    [id, storeId]
  );
  const purchase = purchaseResult.rows[0];
  if (!purchase) throw businessError('Achat introuvable', 404);

  const linesResult = await db.query(
    `
    SELECT
      pl.ordered_colis,
      pl.ordered_pieces,
      pl.ordered_quantity,
      pl.price_unit,
      pl.supplier_label,
      a.designation AS article_name
    FROM purchase_lines pl
    LEFT JOIN articles a ON a.id = pl.article_id AND a.store_id = pl.store_id
    WHERE pl.purchase_id = $1
      AND pl.store_id = $2
    ORDER BY pl.line_number
    `,
    [id, storeId]
  );

  const to = firstPhone(purchase.supplier_mobile, purchase.supplier_phone);
  return {
    document_type: 'purchase',
    document_id: purchase.id,
    recipient_name: clean(purchase.supplier_name),
    to,
    masked_to: maskPhoneNumber(to),
    message: purchaseMessage(purchase, linesResult.rows),
  };
}

async function getPriceListContext(db, { storeId, priceListId, clientId, fallbackMessage }) {
  if (!priceListId) {
    const client = await clientRecipientContext(db, { storeId, clientId });
    return {
      document_type: 'price_list',
      document_id: null,
      recipient_name: client?.recipient_name || null,
      to: client?.to || null,
      masked_to: client?.masked_to || '-',
      message: clean(fallbackMessage) || priceListMessage([]),
    };
  }

  const headerResult = await db.query(
    `
    SELECT
      cpl.id,
      cpl.title,
      cl.name AS client_name,
      cl.mobile AS client_mobile,
      cl.phone AS client_phone
    FROM customer_price_lists cpl
    LEFT JOIN clients cl ON cl.id = cpl.client_id AND cl.store_id = cpl.store_id
    WHERE cpl.id = $1
      AND cpl.store_id = $2
    LIMIT 1
    `,
    [priceListId, storeId]
  );
  const header = headerResult.rows[0];
  if (!header) throw businessError('Mercuriale introuvable', 404);

  const linesResult = await db.query(
    `
    SELECT designation_snapshot, sale_unit, price_ht, price_level_1_ht, price_level_2_ht, price_level_3_ht
    FROM customer_price_list_lines
    WHERE price_list_id = $1
      AND store_id = $2
    ORDER BY is_featured DESC, COALESCE(family_name, 'Autre') ASC, display_order ASC, designation_snapshot ASC
    `,
    [priceListId, storeId]
  );

  const to = firstPhone(header.client_mobile, header.client_phone);
  return {
    document_type: 'price_list',
    document_id: header.id,
    recipient_name: clean(header.client_name),
    to,
    masked_to: maskPhoneNumber(to),
    message: priceListMessage(linesResult.rows),
  };
}

async function getWhatsappDefaults(db, { storeId, kind, id, priceListId, clientId, fallbackMessage }) {
  if (kind === 'purchase') return getPurchaseContext(db, { storeId, id });
  if (kind === 'price_list') return getPriceListContext(db, { storeId, priceListId, clientId, fallbackMessage });
  return getSalesDocumentContext(db, { storeId, id, kind });
}

async function sendWhatsappBusinessDocument(db, { storeId, kind, id, priceListId, clientId, to, message }) {
  const defaults = await getWhatsappDefaults(db, { storeId, kind, id, priceListId, clientId, fallbackMessage: message });
  const recipient = normalizePhoneNumber(to) || defaults.to;
  const body = clean(message) || defaults.message;

  if (!recipient) {
    throw businessError('Aucun numéro WhatsApp disponible. Renseigne un numéro manuel avant envoi.');
  }
  if (!body) {
    throw businessError('Message WhatsApp vide');
  }

  const result = await sendTextMessage(recipient, body);
  const maskedTo = maskPhoneNumber(recipient);

  if (!result.success || !result.message_id) {
    console.error('WhatsApp business Meta error', {
      document_type: defaults.document_type,
      document_id: defaults.document_id,
      to: maskedTo,
      status: result.status || 500,
      error: result.error || 'Erreur envoi WhatsApp',
    });
    throw businessError(result.error || 'Erreur envoi WhatsApp', result.status || 502);
  }

  console.log('WhatsApp business Meta success', {
    document_type: defaults.document_type,
    document_id: defaults.document_id,
    to: maskedTo,
    message_id: result.message_id,
  });

  // TODO: enregistrer l'historique type=whatsapp quand une table de journal communication sera disponible.
  return {
    success: true,
    message_id: result.message_id,
    to: maskedTo,
  };
}

module.exports = {
  getWhatsappDefaults,
  sendWhatsappBusinessDocument,
};
