const { renderHtmlToPdf } = require('./pdf/pdfRenderer');
const {
  deliveryNoteFilename,
  renderDeliveryNotePdf,
} = require('./pdf/templates/deliveryNotePdfTemplate');
const {
  customerInvoiceFilename,
  renderCustomerInvoicePdf,
} = require('./pdf/templates/customerInvoicePdfTemplate');

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  error.expose = true;
  return error;
}

async function getStoreSettings(db, storeId) {
  const result = await db.query(
    `
    SELECT company_name, logo_url, address_line1, address_line2, postal_code, city, country,
      phone, email, siret, vat_number, sanitary_approval_number, iban, bic,
      payment_terms, legal_mentions, terms_and_conditions, delivery_note_footer, invoice_footer
    FROM store_settings
    WHERE store_id = $1
    LIMIT 1
    `,
    [storeId]
  );
  return result.rows[0] || {};
}

async function getDeliveryNotePayload(db, { storeId, deliveryNoteId }) {
  const documentResult = await db.query(
    `
    SELECT dn.*, delivered.name AS client_name, delivered.code AS client_code,
      delivered.address_line1, delivered.address_line2, delivered.postal_code, delivered.city,
      delivered.store_identifier AS client_store_identifier,
      billed.name AS billed_client_name, billed.code AS billed_client_code,
      src.reference_number AS source_order_reference
    FROM sales_documents dn
    LEFT JOIN clients delivered ON delivered.id = dn.client_id AND delivered.store_id = dn.store_id
    LEFT JOIN clients billed ON billed.id = dn.billed_client_id AND billed.store_id = dn.store_id
    LEFT JOIN sales_documents src ON src.id = dn.source_order_id AND src.store_id = dn.store_id
    WHERE dn.id = $1 AND dn.store_id = $2 AND dn.document_type = 'DELIVERY_NOTE'
    LIMIT 1
    `,
    [deliveryNoteId, storeId]
  );
  if (!documentResult.rows.length) throw notFound('Bon de livraison introuvable');

  const [linesResult, storeSettings] = await Promise.all([
    db.query(
      `
      SELECT sl.*, COALESCE(SUM(sla.quantity), 0) AS allocated_quantity,
        jsonb_agg(jsonb_build_object(
          'lot_id', sla.lot_id,
          'quantity', sla.quantity,
          'lot_code', l.lot_code,
          'supplier_lot_number', l.supplier_lot_number,
          'dlc', l.dlc,
          'latin_name', COALESCE(l.traceability_data->>'latin_name', a.latin_name),
          'fao_zone', COALESCE(l.traceability_data->>'fao_zone', a.fao_zone),
          'sous_zone', COALESCE(l.traceability_data->>'sous_zone', a.sous_zone),
          'fishing_gear', COALESCE(l.traceability_data->>'fishing_gear', a.fishing_gear),
          'production_method', COALESCE(l.traceability_data->>'production_method', a.production_method)
        )) FILTER (WHERE sla.id IS NOT NULL) AS allocations
      FROM sales_lines sl
      LEFT JOIN sale_line_allocations sla ON sla.sales_line_id = sl.id
      LEFT JOIN lots l ON l.id = sla.lot_id
      LEFT JOIN articles a ON a.id = sl.article_id AND a.store_id = sl.store_id
      WHERE sl.sales_document_id = $1 AND sl.store_id = $2
      GROUP BY sl.id
      ORDER BY sl.line_number ASC
      `,
      [deliveryNoteId, storeId]
    ),
    getStoreSettings(db, storeId),
  ]);

  return {
    document: documentResult.rows[0],
    lines: linesResult.rows,
    storeSettings,
  };
}

async function getInvoicePayload(db, { storeId, invoiceId }) {
  const invoiceResult = await db.query(
    `
    SELECT inv.*,
      billed.name AS billed_client_name,
      billed.code AS billed_client_code,
      COALESCE(inv.billed_client_name_snapshot, billed.name) AS client_name,
      COALESCE(inv.billed_client_code_snapshot, billed.code) AS client_code,
      COALESCE(inv.delivered_client_name_snapshot, dn.delivered_client_name_snapshot, delivered.name) AS delivered_client_name,
      COALESCE(inv.delivered_client_code_snapshot, dn.delivered_client_code_snapshot, delivered.code) AS delivered_client_code,
      COALESCE(inv.delivered_client_store_identifier, dn.delivered_client_store_identifier, delivered.store_identifier) AS client_store_identifier,
      delivered.address_line1,
      delivered.address_line2,
      delivered.postal_code,
      delivered.city,
      dn.reference_number AS source_delivery_note_reference,
      src.reference_number AS source_order_reference
    FROM sales_documents inv
    LEFT JOIN sales_documents dn
      ON dn.id = inv.source_delivery_note_id
     AND dn.store_id = inv.store_id
     AND dn.document_type = 'DELIVERY_NOTE'
    LEFT JOIN clients delivered
      ON delivered.id = dn.client_id
     AND delivered.store_id = inv.store_id
    LEFT JOIN clients billed
      ON billed.id = inv.billed_client_id
     AND billed.store_id = inv.store_id
    LEFT JOIN sales_documents src
      ON src.id = inv.source_order_id
     AND src.store_id = inv.store_id
    WHERE inv.id = $1
      AND inv.store_id = $2
      AND inv.document_type = 'INVOICE'
    LIMIT 1
    `,
    [invoiceId, storeId]
  );
  if (!invoiceResult.rows.length) throw notFound('Facture introuvable');

  const [linesResult, storeSettings] = await Promise.all([
    db.query(
      `
      SELECT il.*, COALESCE(SUM(sla.quantity), 0) AS allocated_quantity,
        jsonb_agg(jsonb_build_object(
          'lot_id', sla.lot_id,
          'quantity', sla.quantity,
          'lot_code', l.lot_code,
          'supplier_lot_number', l.supplier_lot_number,
          'dlc', l.dlc,
          'latin_name', COALESCE(l.traceability_data->>'latin_name', a.latin_name),
          'fao_zone', COALESCE(l.traceability_data->>'fao_zone', a.fao_zone),
          'sous_zone', COALESCE(l.traceability_data->>'sous_zone', a.sous_zone),
          'fishing_gear', COALESCE(l.traceability_data->>'fishing_gear', a.fishing_gear),
          'production_method', COALESCE(l.traceability_data->>'production_method', a.production_method)
        )) FILTER (WHERE sla.id IS NOT NULL) AS allocations
      FROM sales_documents inv
      JOIN sales_lines il
        ON il.sales_document_id = inv.id
       AND il.store_id = inv.store_id
      LEFT JOIN sales_lines bl
        ON bl.sales_document_id = inv.source_delivery_note_id
       AND bl.store_id = inv.store_id
       AND bl.line_number = il.line_number
       AND (bl.article_id IS NOT DISTINCT FROM il.article_id)
      LEFT JOIN sale_line_allocations sla
        ON sla.sales_line_id = bl.id
      LEFT JOIN lots l
        ON l.id = sla.lot_id
      LEFT JOIN articles a
        ON a.id = COALESCE(bl.article_id, il.article_id)
       AND a.store_id = il.store_id
      WHERE inv.id = $1
        AND inv.store_id = $2
        AND inv.document_type = 'INVOICE'
      GROUP BY il.id
      ORDER BY il.line_number ASC
      `,
      [invoiceId, storeId]
    ),
    getStoreSettings(db, storeId),
  ]);

  return {
    invoice: invoiceResult.rows[0],
    lines: linesResult.rows,
    storeSettings,
  };
}

async function renderDeliveryNotePdfAttachment(db, { storeId, deliveryNoteId }) {
  const payload = await getDeliveryNotePayload(db, { storeId, deliveryNoteId });
  const html = renderDeliveryNotePdf(payload);
  return {
    filename: deliveryNoteFilename(payload.document),
    content: await renderHtmlToPdf(html),
    contentType: 'application/pdf',
    document: payload.document,
  };
}

async function renderInvoicePdfAttachment(db, { storeId, invoiceId }) {
  const payload = await getInvoicePayload(db, { storeId, invoiceId });
  const html = renderCustomerInvoicePdf(payload);
  return {
    filename: customerInvoiceFilename(payload.invoice),
    content: await renderHtmlToPdf(html),
    contentType: 'application/pdf',
    document: payload.invoice,
  };
}

module.exports = {
  getDeliveryNotePayload,
  getInvoicePayload,
  renderDeliveryNotePdfAttachment,
  renderInvoicePdfAttachment,
};
