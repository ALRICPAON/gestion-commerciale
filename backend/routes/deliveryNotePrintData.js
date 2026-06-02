const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');

const router = express.Router();

function deliveryNoteSelect() {
  return `
    SELECT dn.*, delivered.name AS client_name, delivered.code AS client_code,
      delivered.address_line1, delivered.address_line2, delivered.postal_code, delivered.city,
      delivered.store_identifier AS client_store_identifier,
      billed.name AS billed_client_name, billed.code AS billed_client_code,
      src.reference_number AS source_order_reference, invoice.id AS invoice_id,
      invoice.reference_number AS invoice_reference, COUNT(sl.id) AS line_count
    FROM sales_documents dn
    LEFT JOIN clients delivered ON delivered.id = dn.client_id AND delivered.store_id = dn.store_id
    LEFT JOIN clients billed ON billed.id = dn.billed_client_id AND billed.store_id = dn.store_id
    LEFT JOIN sales_documents src ON src.id = dn.source_order_id AND src.store_id = dn.store_id
    LEFT JOIN sales_documents invoice ON invoice.source_delivery_note_id = dn.id AND invoice.store_id = dn.store_id AND invoice.document_type = 'INVOICE'
    LEFT JOIN sales_lines sl ON sl.sales_document_id = dn.id
  `;
}

async function findStoreSettings(req) {
  const result = await req.dbPool.query(
    `SELECT id, store_id, company_name, logo_url, address_line1, address_line2,
      postal_code, city, country, phone, email, siret, vat_number,
      sanitary_approval_number, payment_terms, legal_mentions,
      terms_and_conditions, delivery_note_footer
     FROM store_settings
     WHERE store_id = $1
     LIMIT 1`,
    [req.user.store_id]
  );

  return result.rows[0] || null;
}

async function getPrintableDeliveryNote(req, res) {
  const document = await req.dbPool.query(
    `${deliveryNoteSelect()} WHERE dn.id = $1 AND dn.store_id = $2 AND dn.document_type = 'DELIVERY_NOTE' GROUP BY dn.id, delivered.name, delivered.code, delivered.address_line1, delivered.address_line2, delivered.postal_code, delivered.city, delivered.store_identifier, billed.name, billed.code, src.reference_number, invoice.id, invoice.reference_number`,
    [req.params.id, req.user.store_id]
  );

  if (!document.rows.length) {
    return res.status(404).json({ error: 'BL introuvable' });
  }

  const [lines, storeSettings] = await Promise.all([
    req.dbPool.query(
      `SELECT sl.*, COALESCE(SUM(sla.quantity), 0) AS allocated_quantity,
        jsonb_agg(jsonb_build_object('lot_id', sla.lot_id, 'quantity', sla.quantity, 'lot_code', l.lot_code, 'supplier_lot_number', l.supplier_lot_number, 'dlc', l.dlc)) FILTER (WHERE sla.id IS NOT NULL) AS allocations
       FROM sales_lines sl
       LEFT JOIN sale_line_allocations sla ON sla.sales_line_id = sl.id
       LEFT JOIN lots l ON l.id = sla.lot_id
       WHERE sl.sales_document_id = $1
       GROUP BY sl.id
       ORDER BY sl.line_number ASC`,
      [req.params.id]
    ),
    findStoreSettings(req),
  ]);

  await req.dbPool.query(
    `UPDATE sales_documents SET printed_at = COALESCE(printed_at, NOW()) WHERE id = $1 AND store_id = $2`,
    [req.params.id, req.user.store_id]
  );

  return res.json({
    document: document.rows[0],
    lines: lines.rows,
    store_settings: storeSettings,
  });
}

router.get('/delivery-notes/:id/print-data', authenticateToken, attachDbContext, async (req, res) => {
  try {
    await getPrintableDeliveryNote(req, res);
  } catch (err) {
    console.error('Erreur print-data BL :', err);
    res.status(500).json({ error: 'Erreur preparation impression BL' });
  }
});

module.exports = router;
