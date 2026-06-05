const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const { renderHtmlToPdf, sendPdf } = require('../services/pdf/pdfRenderer');
const {
  customerInvoiceFilename,
  renderCustomerInvoicePdf,
} = require('../services/pdf/templates/customerInvoicePdfTemplate');

const router = express.Router();

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function badId(res) {
  return res.status(400).json({ error: 'ID document invalide' });
}

async function nextInvoiceReference(db, storeId, invoiceDate = new Date()) {
  const year = new Date(invoiceDate).getFullYear();
  const prefix = `FAC-${year}-`;
  const result = await db.query(
    `
    SELECT reference_number
    FROM sales_documents
    WHERE store_id = $1
      AND document_type = 'INVOICE'
      AND reference_number LIKE $2
    ORDER BY reference_number DESC
    LIMIT 1
    `,
    [storeId, `${prefix}%`]
  );
  const lastNumber = result.rows[0]?.reference_number?.match(/^(?:FAC)-\d{4}-(\d+)$/)?.[1];
  const nextNumber = String((Number(lastNumber) || 0) + 1).padStart(5, '0');
  return `${prefix}${nextNumber}`;
}

async function getStoreSettings(db, storeId) {
  const result = await db.query(
    `
    SELECT id, store_id, company_name, logo_url, address_line1, address_line2,
      postal_code, city, country, phone, email, siret, vat_number,
      sanitary_approval_number, iban, bic, payment_terms, legal_mentions,
      terms_and_conditions, delivery_note_footer, invoice_footer
    FROM store_settings
    WHERE store_id = $1
    LIMIT 1
    `,
    [storeId]
  );
  return result.rows[0] || null;
}

async function getInvoiceDocument(db, { invoiceId, storeId }) {
  const result = await db.query(
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
  return result.rows[0] || null;
}

async function getInvoiceLines(db, { invoiceId, storeId }) {
  const result = await db.query(
    `
    SELECT *
    FROM sales_lines
    WHERE sales_document_id = $1
      AND store_id = $2
    ORDER BY line_number ASC
    `,
    [invoiceId, storeId]
  );
  return result.rows;
}

router.get('/delivery-notes/:id/invoice', authenticateToken, attachDbContext, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return badId(res);
    const result = await req.dbPool.query(
      `
      SELECT id, reference_number, document_date, status, locked_at,
        pennylane_status, pennylane_invoice_id, pennylane_synced_at, pennylane_error
      FROM sales_documents
      WHERE store_id = $1
        AND source_delivery_note_id = $2
        AND document_type = 'INVOICE'
      LIMIT 1
      `,
      [req.user.store_id, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Facture introuvable pour ce BL' });
    return res.json({ invoice: result.rows[0] });
  } catch (err) {
    console.error('Erreur GET facture BL :', err);
    return res.status(500).json({ error: 'Erreur serveur facture BL' });
  }
});

router.post('/delivery-notes/:id/validate-invoice', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  if (!isUuid(req.params.id)) return badId(res);

  const db = await req.dbPool.connect();
  const body = req.body || {};
  try {
    await db.query('BEGIN');
    const noteResult = await db.query(
      `SELECT * FROM sales_documents WHERE id = $1 AND store_id = $2 AND document_type = 'DELIVERY_NOTE' FOR UPDATE`,
      [req.params.id, req.user.store_id]
    );
    if (!noteResult.rows.length) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'BL introuvable' });
    }

    const note = noteResult.rows[0];
    if (!['validated', 'invoiced'].includes(note.status)) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'Le BL doit etre valide avant facturation' });
    }

    const existing = await db.query(
      `SELECT id, reference_number FROM sales_documents WHERE store_id = $1 AND source_delivery_note_id = $2 AND document_type = 'INVOICE' LIMIT 1`,
      [req.user.store_id, note.id]
    );
    if (existing.rows.length) {
      await db.query('COMMIT');
      return res.json({ ok: true, invoice_id: existing.rows[0].id, invoice_reference: existing.rows[0].reference_number, existing: true });
    }

    const invoiceDate = clean(body.document_date) || new Date().toISOString().slice(0, 10);
    const invoiceRef = clean(body.reference_number) || await nextInvoiceReference(db, req.user.store_id, invoiceDate);
    const invoice = await db.query(
      `
      INSERT INTO sales_documents (
        id, store_id, client_key, client_id, billed_client_id, source_order_id, source_delivery_note_id,
        document_date, status, document_type, origin, reference_number, notes,
        total_amount_ex_vat, total_vat_amount, total_amount_inc_vat,
        tariff_level_snapshot, vat_rate_snapshot, is_vat_exempt_snapshot,
        delivered_client_name_snapshot, delivered_client_code_snapshot, delivered_client_store_identifier,
        billed_client_name_snapshot, billed_client_code_snapshot,
        locked_at, validated_at, pennylane_status, created_by, updated_by
      ) VALUES (
        gen_random_uuid(), $1, $2, COALESCE($3, $4), COALESCE($3, $4), $5, $6,
        $7::date, 'validated', 'INVOICE', 'delivery_note', $8, $9,
        $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20,
        NOW(), NOW(), 'not_sent', $21, $21
      )
      RETURNING id, reference_number, pennylane_status
      `,
      [
        req.user.store_id,
        note.client_key || req.user.client_key || null,
        note.billed_client_id,
        note.client_id,
        note.source_order_id,
        note.id,
        invoiceDate,
        invoiceRef,
        note.notes,
        note.total_amount_ex_vat,
        note.total_vat_amount,
        note.total_amount_inc_vat,
        note.tariff_level_snapshot,
        note.vat_rate_snapshot,
        note.is_vat_exempt_snapshot,
        note.delivered_client_name_snapshot,
        note.delivered_client_code_snapshot,
        note.delivered_client_store_identifier,
        note.billed_client_name_snapshot,
        note.billed_client_code_snapshot,
        req.user.id,
      ]
    );

    const lines = await db.query(`SELECT * FROM sales_lines WHERE sales_document_id = $1 ORDER BY line_number`, [note.id]);
    if (!lines.rows.length) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'Impossible de facturer un BL sans ligne' });
    }

    for (const line of lines.rows) {
      await db.query(
        `
        INSERT INTO sales_lines (
          id, store_id, client_key, sales_document_id, line_number, article_id, article_plu, article_label,
          package_count, weight_per_package, total_weight, sold_quantity, sale_unit,
          unit_sale_price_ht, unit_sale_price_ttc, vat_rate, line_amount_ht, line_vat_amount, line_amount_ttc,
          unit_cost_ex_vat, line_margin_ex_vat, selected_lot_id, suggested_lot_id, traceability_snapshot,
          line_status, created_by, updated_by
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12,
          $13, $14, $15, $16, $17, $18,
          $19, $20, $21, $22, $23::jsonb,
          'invoiced', $24, $24
        )
        `,
        [
          req.user.store_id,
          line.client_key || note.client_key || req.user.client_key || null,
          invoice.rows[0].id,
          line.line_number,
          line.article_id,
          line.article_plu,
          line.article_label,
          line.package_count,
          line.weight_per_package,
          line.total_weight,
          line.sold_quantity,
          line.sale_unit,
          line.unit_sale_price_ht,
          line.unit_sale_price_ttc,
          line.vat_rate,
          line.line_amount_ht,
          line.line_vat_amount,
          line.line_amount_ttc,
          line.unit_cost_ex_vat,
          line.line_margin_ex_vat,
          line.selected_lot_id,
          line.suggested_lot_id,
          JSON.stringify(line.traceability_snapshot || {}),
          req.user.id,
        ]
      );
    }

    await db.query(
      `UPDATE sales_documents SET status = 'invoiced', invoiced_at = NOW(), updated_by = $1, updated_at = NOW() WHERE id = $2 AND store_id = $3`,
      [req.user.id, note.id, req.user.store_id]
    );
    await db.query('COMMIT');
    return res.json({ ok: true, invoice_id: invoice.rows[0].id, invoice_reference: invoice.rows[0].reference_number, pennylane_status: invoice.rows[0].pennylane_status, existing: false });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur validation facture BL :', err);
    if (err.code === '23505') return res.status(409).json({ error: 'Numero de facture deja utilise, reessaie la facturation' });
    return res.status(500).json({ error: err.message || 'Erreur validation facture' });
  } finally {
    db.release();
  }
});

router.get('/invoices/:id/print-data', authenticateToken, attachDbContext, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return badId(res);
    const invoice = await getInvoiceDocument(req.dbPool, { invoiceId: req.params.id, storeId: req.user.store_id });
    if (!invoice) return res.status(404).json({ error: 'Facture introuvable' });
    const [lines, storeSettings] = await Promise.all([
      getInvoiceLines(req.dbPool, { invoiceId: req.params.id, storeId: req.user.store_id }),
      getStoreSettings(req.dbPool, req.user.store_id),
    ]);
    return res.json({ invoice, lines, store_settings: storeSettings });
  } catch (err) {
    console.error('Erreur print-data facture :', err);
    return res.status(500).json({ error: 'Erreur preparation impression facture' });
  }
});

router.get('/invoices/:id/pdf', authenticateToken, attachDbContext, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return badId(res);
    const invoice = await getInvoiceDocument(req.dbPool, { invoiceId: req.params.id, storeId: req.user.store_id });
    if (!invoice) return res.status(404).json({ error: 'Facture introuvable' });
    const [lines, storeSettings] = await Promise.all([
      getInvoiceLines(req.dbPool, { invoiceId: req.params.id, storeId: req.user.store_id }),
      getStoreSettings(req.dbPool, req.user.store_id),
    ]);
    const html = renderCustomerInvoicePdf({ invoice, lines, storeSettings });
    const pdf = await renderHtmlToPdf(html);
    return sendPdf(res, pdf, customerInvoiceFilename(invoice));
  } catch (err) {
    console.error('Erreur PDF facture :', err);
    return res.status(500).json({ error: 'Erreur generation PDF facture client' });
  }
});

module.exports = router;
