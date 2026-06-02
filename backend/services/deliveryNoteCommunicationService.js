const { sendEmail } = require('./emailService');
const { normalizePhone, sendTemplateMessage } = require('./whatsappService');

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function firstValue(...values) {
  return values.map(clean).find(Boolean) || null;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]));
}

function number(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDate(value) {
  if (!value) return '-';
  try { return new Intl.DateTimeFormat('fr-FR').format(new Date(value)); }
  catch { return String(value); }
}

function money(value) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(number(value));
}

function qty(value) {
  return number(value).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function clientName(document) {
  return firstValue(document.billed_client_name, document.client_name, document.delivered_client_name_snapshot, 'Client');
}

function defaultEmail(document) {
  return firstValue(document.billed_client_email, document.delivered_client_email);
}

function defaultPhone(document) {
  return firstValue(
    document.delivered_client_mobile,
    document.delivered_client_phone,
    document.billed_client_mobile,
    document.billed_client_phone
  );
}

async function getDeliveryNoteCommunicationContext(db, { storeId, deliveryNoteId }) {
  const documentResult = await db.query(
    `SELECT dn.id, dn.store_id, dn.reference_number, dn.document_date, dn.status,
      dn.total_amount_ex_vat, dn.total_vat_amount, dn.total_amount_inc_vat, dn.notes,
      COALESCE(delivered.name, dn.delivered_client_name_snapshot) AS client_name,
      COALESCE(delivered.code, dn.delivered_client_code_snapshot) AS client_code,
      COALESCE(delivered.store_identifier, dn.delivered_client_store_identifier) AS client_store_identifier,
      delivered.address_line1, delivered.address_line2, delivered.postal_code, delivered.city,
      delivered.email AS delivered_client_email,
      delivered.phone AS delivered_client_phone,
      delivered.mobile AS delivered_client_mobile,
      COALESCE(billed.name, dn.billed_client_name_snapshot) AS billed_client_name,
      COALESCE(billed.code, dn.billed_client_code_snapshot) AS billed_client_code,
      billed.email AS billed_client_email,
      billed.phone AS billed_client_phone,
      billed.mobile AS billed_client_mobile,
      src.reference_number AS source_order_reference
     FROM sales_documents dn
     LEFT JOIN clients delivered ON delivered.id = dn.client_id AND delivered.store_id = dn.store_id
     LEFT JOIN clients billed ON billed.id = dn.billed_client_id AND billed.store_id = dn.store_id
     LEFT JOIN sales_documents src ON src.id = dn.source_order_id AND src.store_id = dn.store_id
     WHERE dn.id = $1 AND dn.store_id = $2 AND dn.document_type = 'DELIVERY_NOTE'
     LIMIT 1`,
    [deliveryNoteId, storeId]
  );

  if (!documentResult.rows.length) {
    const error = new Error('BL introuvable');
    error.status = 404;
    throw error;
  }

  const [linesResult, storeSettingsResult] = await Promise.all([
    db.query(
      `SELECT sl.line_number, sl.article_plu, sl.article_label, sl.package_count,
        sl.total_weight, sl.sold_quantity, sl.sale_unit, sl.unit_sale_price_ht,
        sl.line_amount_ht, sl.line_amount_ttc, sl.vat_rate,
        jsonb_agg(jsonb_build_object(
          'lot_code', l.lot_code,
          'supplier_lot_number', l.supplier_lot_number,
          'dlc', l.dlc,
          'quantity', sla.quantity
        )) FILTER (WHERE sla.id IS NOT NULL) AS allocations
       FROM sales_lines sl
       LEFT JOIN sale_line_allocations sla ON sla.sales_line_id = sl.id
       LEFT JOIN lots l ON l.id = sla.lot_id
       WHERE sl.sales_document_id = $1
       GROUP BY sl.id
       ORDER BY sl.line_number ASC`,
      [deliveryNoteId]
    ),
    db.query(
      `SELECT company_name, address_line1, address_line2, postal_code, city, country,
        phone, email, siret, vat_number, sanitary_approval_number, delivery_note_footer
       FROM store_settings
       WHERE store_id = $1
       LIMIT 1`,
      [storeId]
    ),
  ]);

  const document = documentResult.rows[0];
  const email = defaultEmail(document);
  const phone = defaultPhone(document);

  return {
    document,
    lines: linesResult.rows,
    store_settings: storeSettingsResult.rows[0] || {},
    contacts: {
      email,
      phone,
      whatsapp_phone: normalizePhone(phone),
      email_source: email === clean(document.billed_client_email) ? 'billed_client' : (email ? 'delivered_client' : null),
      phone_source: phone ? 'client' : null,
    },
  };
}

function buildDeliveryNoteEmailHtml(context, message) {
  const document = context.document;
  const settings = context.store_settings || {};
  const rows = (context.lines || []).map((line) => `
    <tr>
      <td>${escapeHtml(line.line_number || '')}</td>
      <td><strong>${escapeHtml(line.article_label || '-')}</strong><br><small>${escapeHtml(line.article_plu || '')}</small></td>
      <td style="text-align:right;">${qty(line.total_weight || line.sold_quantity)} ${escapeHtml(line.sale_unit || 'kg')}</td>
      <td style="text-align:right;">${money(line.line_amount_ht)}</td>
      <td style="text-align:right;">${money(line.line_amount_ttc)}</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>Bon de livraison ${escapeHtml(document.reference_number || document.id)}</title></head>
<body style="font-family:Arial,sans-serif;color:#172033;line-height:1.45;">
  <h1 style="font-size:20px;margin-bottom:4px;">Bon de livraison ${escapeHtml(document.reference_number || document.id)}</h1>
  <p style="margin-top:0;color:#53606f;">${escapeHtml(settings.company_name || 'Gestion Commerciale')}</p>
  <p>${escapeHtml(clean(message) || 'Bonjour, veuillez trouver ci-dessous les informations de votre bon de livraison.')}</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0;">
    <tbody>
      <tr><td style="padding:4px 0;color:#53606f;">Client livré</td><td style="padding:4px 0;"><strong>${escapeHtml(document.client_name || '-')}</strong></td></tr>
      <tr><td style="padding:4px 0;color:#53606f;">Client facturé</td><td style="padding:4px 0;"><strong>${escapeHtml(document.billed_client_name || '-')}</strong></td></tr>
      <tr><td style="padding:4px 0;color:#53606f;">Date</td><td style="padding:4px 0;">${escapeHtml(formatDate(document.document_date))}</td></tr>
      <tr><td style="padding:4px 0;color:#53606f;">Commande</td><td style="padding:4px 0;">${escapeHtml(document.source_order_reference || '-')}</td></tr>
    </tbody>
  </table>
  <table style="border-collapse:collapse;width:100%;border:1px solid #d9dee7;">
    <thead>
      <tr style="background:#f3f5f8;">
        <th style="text-align:left;padding:8px;border-bottom:1px solid #d9dee7;">Ligne</th>
        <th style="text-align:left;padding:8px;border-bottom:1px solid #d9dee7;">Article</th>
        <th style="text-align:right;padding:8px;border-bottom:1px solid #d9dee7;">Quantité</th>
        <th style="text-align:right;padding:8px;border-bottom:1px solid #d9dee7;">HT</th>
        <th style="text-align:right;padding:8px;border-bottom:1px solid #d9dee7;">TTC</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="5" style="padding:8px;">Aucune ligne.</td></tr>'}</tbody>
  </table>
  <p style="text-align:right;font-size:16px;"><strong>Total TTC : ${money(document.total_amount_inc_vat)}</strong></p>
  ${settings.delivery_note_footer ? `<p style="color:#53606f;">${escapeHtml(settings.delivery_note_footer)}</p>` : ''}
</body>
</html>`;
}

function buildDeliveryNoteEmailText(context, message) {
  const document = context.document;
  const lines = (context.lines || []).map((line) => `- ${line.line_number || ''} ${line.article_label || '-'}: ${qty(line.total_weight || line.sold_quantity)} ${line.sale_unit || 'kg'}`).join('\n');
  return `${clean(message) || 'Bonjour, veuillez trouver les informations de votre bon de livraison.'}\n\nBL: ${document.reference_number || document.id}\nClient: ${clientName(document)}\nDate: ${formatDate(document.document_date)}\n\n${lines}\n\nTotal TTC: ${money(document.total_amount_inc_vat)}`;
}

async function sendDeliveryNoteEmail(db, { storeId, deliveryNoteId, to, subject, message }) {
  const context = await getDeliveryNoteCommunicationContext(db, { storeId, deliveryNoteId });
  const recipient = clean(to) || context.contacts.email;
  if (!recipient) {
    const error = new Error('Aucun email client disponible pour ce BL');
    error.status = 400;
    throw error;
  }

  const result = await sendEmail({
    to: recipient,
    subject: clean(subject) || `Bon de livraison ${context.document.reference_number || context.document.id}`,
    html: buildDeliveryNoteEmailHtml(context, message),
    text: buildDeliveryNoteEmailText(context, message),
    replyTo: context.store_settings.email,
  });

  return {
    ok: true,
    to: recipient,
    delivery_note_id: context.document.id,
    delivery_note_reference: context.document.reference_number,
    email: result,
  };
}

async function sendDeliveryNoteWhatsapp(db, { storeId, deliveryNoteId, to, templateName, languageCode }) {
  const context = await getDeliveryNoteCommunicationContext(db, { storeId, deliveryNoteId });
  const recipient = clean(to) || context.contacts.phone;
  if (!recipient) {
    const error = new Error('Aucun telephone client disponible pour ce BL');
    error.status = 400;
    throw error;
  }

  const result = await sendTemplateMessage({
    to: recipient,
    templateName,
    languageCode,
    bodyParameters: [
      clientName(context.document),
      context.document.reference_number || context.document.id,
      formatDate(context.document.document_date),
    ],
  });

  return {
    ok: true,
    to: result.to,
    template: result.template,
    delivery_note_id: context.document.id,
    delivery_note_reference: context.document.reference_number,
    whatsapp: result.result,
  };
}

module.exports = {
  getDeliveryNoteCommunicationContext,
  sendDeliveryNoteEmail,
  sendDeliveryNoteWhatsapp,
};
