const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { renderHtmlToPdf, sendPdf } = require('../services/pdf/pdfRenderer');
const {
  customerPriceListFilename,
  renderCustomerPriceListPdf,
} = require('../services/pdf/templates/customerPriceListPdfTemplate');
const {
  deliveryNoteFilename,
  renderDeliveryNotePdf,
} = require('../services/pdf/templates/deliveryNotePdfTemplate');
const {
  renderSaleOrderPdf,
  saleOrderFilename,
} = require('../services/pdf/templates/saleOrderPdfTemplate');

const router = express.Router();

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function badId(res) {
  return res.status(400).json({ error: 'ID document invalide' });
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

async function renderAndSend(res, html, filename) {
  const pdf = await renderHtmlToPdf(html);
  sendPdf(res, pdf, filename);
}

router.get('/customer-price-lists/:id/pdf', authenticateToken, attachDbContext, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return badId(res);

    const [headerResult, linesResult, storeSettings] = await Promise.all([
      req.dbPool.query(
        `
        SELECT cpl.*, cl.name AS client_name, cl.code AS client_code
        FROM customer_price_lists cpl
        LEFT JOIN clients cl ON cl.id = cpl.client_id AND cl.store_id = cpl.store_id
        WHERE cpl.id = $1 AND cpl.store_id = $2
        LIMIT 1
        `,
        [req.params.id, req.user.store_id]
      ),
      req.dbPool.query(
        `
        SELECT *
        FROM customer_price_list_lines
        WHERE price_list_id = $1 AND store_id = $2
        ORDER BY is_featured DESC, COALESCE(family_name, 'Autre') ASC, display_order ASC, designation_snapshot ASC
        `,
        [req.params.id, req.user.store_id]
      ),
      getStoreSettings(req.dbPool, req.user.store_id),
    ]);

    if (!headerResult.rows.length) return res.status(404).json({ error: 'Mercuriale introuvable' });
    const priceList = { ...headerResult.rows[0], target_tariff_level: headerResult.rows[0].tariff_level };
    const html = renderCustomerPriceListPdf({ priceList, lines: linesResult.rows, storeSettings });
    return renderAndSend(res, html, customerPriceListFilename(priceList));
  } catch (err) {
    console.error('Erreur PDF mercuriale :', err);
    return res.status(500).json({ error: 'Erreur generation PDF mercuriale' });
  }
});

router.get('/delivery-notes/:id/pdf', authenticateToken, attachDbContext, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return badId(res);

    const documentResult = await req.dbPool.query(
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
      [req.params.id, req.user.store_id]
    );
    if (!documentResult.rows.length) return res.status(404).json({ error: 'Bon de livraison introuvable' });

    const [linesResult, storeSettings] = await Promise.all([
      req.dbPool.query(
        `
        SELECT sl.*, COALESCE(SUM(sla.quantity), 0) AS allocated_quantity,
          jsonb_agg(jsonb_build_object(
            'lot_id', sla.lot_id,
            'quantity', sla.quantity,
            'lot_code', l.lot_code,
            'supplier_lot_number', l.supplier_lot_number,
            'dlc', l.dlc
          )) FILTER (WHERE sla.id IS NOT NULL) AS allocations
        FROM sales_lines sl
        LEFT JOIN sale_line_allocations sla ON sla.sales_line_id = sl.id
        LEFT JOIN lots l ON l.id = sla.lot_id
        WHERE sl.sales_document_id = $1 AND sl.store_id = $2
        GROUP BY sl.id
        ORDER BY sl.line_number ASC
        `,
        [req.params.id, req.user.store_id]
      ),
      getStoreSettings(req.dbPool, req.user.store_id),
    ]);

    const document = documentResult.rows[0];
    const html = renderDeliveryNotePdf({ document, lines: linesResult.rows, storeSettings });
    return renderAndSend(res, html, deliveryNoteFilename(document));
  } catch (err) {
    console.error('Erreur PDF BL :', err);
    return res.status(500).json({ error: 'Erreur generation PDF bon de livraison' });
  }
});

router.get('/sales/:id/pdf', authenticateToken, attachDbContext, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return badId(res);

    const saleResult = await req.dbPool.query(
      `
      SELECT sd.*, c.name AS client_name, c.code AS client_code,
        COALESCE(c.tariff_level, sd.tariff_level_snapshot, 1) AS client_tariff_level
      FROM sales_documents sd
      LEFT JOIN clients c ON c.id = sd.client_id AND c.store_id = sd.store_id
      WHERE sd.id = $1 AND sd.store_id = $2
      LIMIT 1
      `,
      [req.params.id, req.user.store_id]
    );
    if (!saleResult.rows.length) return res.status(404).json({ error: 'Document de vente introuvable' });

    const sale = saleResult.rows[0];
    if (sale.document_type === 'INVOICE') {
      return res.status(501).json({ error: 'PDF facture non disponible dans cette version' });
    }
    if (sale.document_type !== 'ORDER') {
      return res.status(400).json({ error: 'Cette route PDF est limitee aux commandes client' });
    }

    const [linesResult, storeSettings] = await Promise.all([
      req.dbPool.query(
        `
        SELECT *
        FROM sales_lines
        WHERE sales_document_id = $1 AND store_id = $2
        ORDER BY line_number ASC
        `,
        [req.params.id, req.user.store_id]
      ),
      getStoreSettings(req.dbPool, req.user.store_id),
    ]);

    const html = renderSaleOrderPdf({ sale, lines: linesResult.rows, storeSettings });
    return renderAndSend(res, html, saleOrderFilename(sale));
  } catch (err) {
    console.error('Erreur PDF commande :', err);
    return res.status(500).json({ error: 'Erreur generation PDF commande client' });
  }
});

router.get('/invoices/:id/pdf', authenticateToken, attachDbContext, async (req, res) => (
  res.status(501).json({ error: 'PDF facture non disponible dans cette version' })
));

module.exports = router;
