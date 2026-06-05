const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const { renderHtmlToPdf, sendPdf } = require('../services/pdf/pdfRenderer');
const { recomputeArticleStock } = require('../services/stockService');
const {
  customerCreditNoteFilename,
  renderCustomerCreditNotePdf,
} = require('../services/pdf/templates/customerCreditNotePdfTemplate');

const router = express.Router();

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function num(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pos(value, fallback = 0) {
  return Math.max(num(value, fallback), 0);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function badId(res) {
  return res.status(400).json({ error: 'ID document invalide' });
}

async function nextCreditNoteReference(db, storeId, documentDate = new Date()) {
  const year = new Date(documentDate).getFullYear();
  const prefix = `AV-${year}-`;
  const suffixPattern = `^AV-${year}-([0-9]+)$`;

  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`customer-credit-note:${storeId}:${year}`]);

  const result = await db.query(
    `
    SELECT COALESCE(MAX((substring(reference_number FROM $2))::integer), 0) + 1 AS next_number
    FROM sales_documents
    WHERE store_id = $1
      AND UPPER(document_type) = 'CREDIT_NOTE'
      AND reference_number LIKE $3
      AND substring(reference_number FROM $2) IS NOT NULL
    `,
    [storeId, suffixPattern, `${prefix}%`]
  );
  return `${prefix}${String(Number(result.rows[0]?.next_number || 1)).padStart(5, '0')}`;
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

async function getCreditNoteDocument(db, { creditNoteId, storeId }) {
  const result = await db.query(
    `
    SELECT cn.*,
      billed.name AS billed_client_name,
      billed.code AS billed_client_code,
      COALESCE(cn.billed_client_name_snapshot, billed.name) AS client_name,
      COALESCE(cn.billed_client_code_snapshot, billed.code) AS client_code,
      COALESCE(cn.delivered_client_name_snapshot, inv.delivered_client_name_snapshot, delivered.name) AS delivered_client_name,
      COALESCE(cn.delivered_client_code_snapshot, inv.delivered_client_code_snapshot, delivered.code) AS delivered_client_code,
      COALESCE(cn.delivered_client_store_identifier, inv.delivered_client_store_identifier, delivered.store_identifier) AS client_store_identifier,
      delivered.address_line1,
      delivered.address_line2,
      delivered.postal_code,
      delivered.city,
      inv.reference_number AS source_invoice_reference,
      dn.reference_number AS source_delivery_note_reference,
      src.reference_number AS source_order_reference
    FROM sales_documents cn
    LEFT JOIN sales_documents inv
      ON inv.id = cn.source_invoice_id
     AND inv.store_id = cn.store_id
     AND inv.document_type = 'INVOICE'
    LEFT JOIN sales_documents dn
      ON dn.id = cn.source_delivery_note_id
     AND dn.store_id = cn.store_id
     AND dn.document_type = 'DELIVERY_NOTE'
    LEFT JOIN clients delivered
      ON delivered.id = COALESCE(cn.client_id, inv.client_id)
     AND delivered.store_id = cn.store_id
    LEFT JOIN clients billed
      ON billed.id = COALESCE(cn.billed_client_id, inv.billed_client_id)
     AND billed.store_id = cn.store_id
    LEFT JOIN sales_documents src
      ON src.id = cn.source_order_id
     AND src.store_id = cn.store_id
    WHERE cn.id = $1
      AND cn.store_id = $2
      AND cn.document_type = 'CREDIT_NOTE'
    LIMIT 1
    `,
    [creditNoteId, storeId]
  );
  return result.rows[0] || null;
}

async function getCreditNoteLines(db, { creditNoteId, storeId }) {
  const result = await db.query(
    `
    SELECT *
    FROM sales_lines
    WHERE sales_document_id = $1
      AND store_id = $2
    ORDER BY line_number ASC
    `,
    [creditNoteId, storeId]
  );
  return result.rows;
}

function selectedQuantityFor(line, requestedLines, creditAll) {
  const sourceQuantity = pos(line.sold_quantity || line.total_weight, 0);
  const remainingQuantity = pos(line.remaining_quantity, sourceQuantity);
  if (creditAll) return remainingQuantity;
  const requested = requestedLines.find((item) => {
    const sourceLineId = clean(item.source_invoice_line_id || item.invoice_line_id || item.id);
    return sourceLineId === line.id || Number(item.line_number) === Number(line.line_number);
  });
  if (!requested) return 0;
  return pos(requested.quantity ?? requested.total_weight ?? requested.sold_quantity, 0);
}

function computeCreditLine(line, quantity) {
  const sourceQuantity = pos(line.sold_quantity || line.total_weight, 0);
  const ratio = sourceQuantity > 0 ? quantity / sourceQuantity : 0;
  const packageCount = Number((pos(line.package_count, 0) * ratio).toFixed(3));
  const weightPerPackage = pos(line.weight_per_package, 0);
  const unitPriceHt = num(line.unit_sale_price_ht, 0);
  const vatRate = num(line.vat_rate, 0);
  const lineHt = Number((quantity * unitPriceHt).toFixed(2));
  const lineVat = Number((lineHt * vatRate / 100).toFixed(2));
  const lineTtc = Number((lineHt + lineVat).toFixed(2));
  const unitPriceTtc = quantity > 0 ? Number((lineTtc / quantity).toFixed(4)) : num(line.unit_sale_price_ttc, 0);
  const unitCost = num(line.unit_cost_ex_vat, 0);
  return {
    packageCount,
    weightPerPackage,
    totalWeight: quantity,
    soldQuantity: quantity,
    unitPriceHt,
    unitPriceTtc,
    vatRate,
    lineHt,
    lineVat,
    lineTtc,
    unitCost,
    margin: Number((lineHt - quantity * unitCost).toFixed(2)),
  };
}

router.get('/invoices/:id/credit-notes', authenticateToken, attachDbContext, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return badId(res);
    const result = await req.dbPool.query(
      `
      SELECT id, reference_number, document_date, status, origin,
        total_amount_ex_vat, total_vat_amount, total_amount_inc_vat,
        pennylane_status, pennylane_invoice_id, pennylane_synced_at, pennylane_error
      FROM sales_documents
      WHERE store_id = $1
        AND source_invoice_id = $2
        AND document_type = 'CREDIT_NOTE'
      ORDER BY document_date DESC, created_at DESC
      `,
      [req.user.store_id, req.params.id]
    );
    return res.json({ credit_notes: result.rows });
  } catch (err) {
    console.error('Erreur GET avoirs facture :', err);
    return res.status(500).json({ error: 'Erreur serveur avoirs facture' });
  }
});

router.post('/invoices/:id/credit-notes', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  if (!isUuid(req.params.id)) return badId(res);

  const db = await req.dbPool.connect();
  const body = req.body || {};
  const requestedLines = Array.isArray(body.lines) ? body.lines : [];
  const creditAll = requestedLines.length === 0 || clean(body.credit_type || body.type) === 'total';
  const returnStock = body.return_stock === true || body.return_stock === 'true';

  try {
    await db.query('BEGIN');
    const invoiceResult = await db.query(
      `SELECT * FROM sales_documents WHERE id = $1 AND store_id = $2 AND document_type = 'INVOICE' FOR UPDATE`,
      [req.params.id, req.user.store_id]
    );
    if (!invoiceResult.rows.length) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'Facture introuvable' });
    }
    const invoice = invoiceResult.rows[0];
    if (!['validated', 'invoiced'].includes(String(invoice.status || '').toLowerCase())) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'La facture doit etre validee avant creation avoir' });
    }

    const linesResult = await db.query(
      `
      SELECT il.*,
        COALESCE(credited.quantity, 0) AS credited_quantity,
        GREATEST(COALESCE(il.sold_quantity, il.total_weight, 0) - COALESCE(credited.quantity, 0), 0) AS remaining_quantity
      FROM sales_lines il
      LEFT JOIN LATERAL (
        SELECT SUM(COALESCE(cl.sold_quantity, cl.total_weight, 0)) AS quantity
        FROM sales_lines cl
        JOIN sales_documents cn ON cn.id = cl.sales_document_id
        WHERE cn.store_id = il.store_id
          AND cn.document_type = 'CREDIT_NOTE'
          AND cn.source_invoice_id = $1
          AND cl.source_invoice_line_id = il.id
      ) credited ON true
      WHERE il.sales_document_id = $1
        AND il.store_id = $2
      ORDER BY il.line_number ASC
      FOR UPDATE OF il
      `,
      [invoice.id, req.user.store_id]
    );
    if (!linesResult.rows.length) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'Impossible de creer un avoir sur une facture sans ligne' });
    }

    const documentDate = clean(body.document_date) || new Date().toISOString().slice(0, 10);
    const reference = clean(body.reference_number) || await nextCreditNoteReference(db, req.user.store_id, documentDate);
    const selectedLines = [];
    for (const line of linesResult.rows) {
      const quantity = selectedQuantityFor(line, requestedLines, creditAll);
      if (quantity <= 0) continue;
      if (quantity > pos(line.remaining_quantity, 0)) {
        await db.query('ROLLBACK');
        return res.status(400).json({ error: `Quantite d'avoir trop elevee ligne ${line.line_number}` });
      }
      selectedLines.push({ source: line, quantity, amounts: computeCreditLine(line, quantity) });
    }
    if (!selectedLines.length) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucune ligne a crediter' });
    }
    if (returnStock) {
      const missingStockSource = selectedLines.find(({ source, quantity }) => (
        quantity > 0 && (!source.article_id || !source.selected_lot_id)
      ));
      if (missingStockSource) {
        await db.query('ROLLBACK');
        return res.status(400).json({
          error: `Retour stock impossible ligne ${missingStockSource.source.line_number} : article ou lot source introuvable`,
        });
      }
    }

    const totals = selectedLines.reduce((acc, line) => ({
      ht: Number((acc.ht + line.amounts.lineHt).toFixed(2)),
      vat: Number((acc.vat + line.amounts.lineVat).toFixed(2)),
      ttc: Number((acc.ttc + line.amounts.lineTtc).toFixed(2)),
    }), { ht: 0, vat: 0, ttc: 0 });

    const created = await db.query(
      `
      INSERT INTO sales_documents (
        id, store_id, client_key, client_id, billed_client_id, source_order_id, source_delivery_note_id, source_invoice_id,
        document_date, status, document_type, origin, reference_number, notes,
        total_amount_ex_vat, total_vat_amount, total_amount_inc_vat,
        tariff_level_snapshot, vat_rate_snapshot, is_vat_exempt_snapshot,
        delivered_client_name_snapshot, delivered_client_code_snapshot, delivered_client_store_identifier,
        billed_client_name_snapshot, billed_client_code_snapshot,
        locked_at, validated_at, pennylane_status, created_by, updated_by
      ) VALUES (
        gen_random_uuid(), $1, $2, $3::uuid, $4::uuid, $5, $6, $7,
        $8::date, 'validated', 'CREDIT_NOTE', $9, $10, $11,
        $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22,
        NOW(), NOW(), 'not_sent', $23, $23
      )
      RETURNING id, reference_number, pennylane_status
      `,
      [
        req.user.store_id,
        invoice.client_key || req.user.client_key || null,
        invoice.client_id || null,
        invoice.billed_client_id || invoice.client_id || null,
        invoice.source_order_id || null,
        invoice.source_delivery_note_id || null,
        invoice.id,
        documentDate,
        returnStock ? 'customer_return' : 'accounting_credit_note',
        reference,
        clean(body.notes) || `Avoir sur facture ${invoice.reference_number || invoice.id}`,
        totals.ht,
        totals.vat,
        totals.ttc,
        invoice.tariff_level_snapshot,
        invoice.vat_rate_snapshot,
        invoice.is_vat_exempt_snapshot,
        invoice.delivered_client_name_snapshot,
        invoice.delivered_client_code_snapshot,
        invoice.delivered_client_store_identifier,
        invoice.billed_client_name_snapshot,
        invoice.billed_client_code_snapshot,
        req.user.id,
      ]
    );
    const creditNoteId = created.rows[0].id;
    const articlesToRecompute = new Set();

    for (const item of selectedLines) {
      const line = item.source;
      const x = item.amounts;
      await db.query(
        `
        INSERT INTO sales_lines (
          id, store_id, client_key, sales_document_id, source_invoice_line_id, line_number, article_id, article_plu, article_label,
          package_count, weight_per_package, total_weight, sold_quantity, sale_unit,
          unit_sale_price_ht, unit_sale_price_ttc, vat_rate, line_amount_ht, line_vat_amount, line_amount_ttc,
          unit_cost_ex_vat, line_margin_ex_vat, selected_lot_id, suggested_lot_id, traceability_snapshot,
          line_status, created_by, updated_by
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19,
          $20, $21, $22, $23, $24::jsonb,
          'credited', $25, $25
        )
        `,
        [
          req.user.store_id,
          line.client_key || invoice.client_key || req.user.client_key || null,
          creditNoteId,
          line.id,
          line.line_number,
          line.article_id,
          line.article_plu,
          line.article_label,
          x.packageCount,
          x.weightPerPackage,
          x.totalWeight,
          x.soldQuantity,
          line.sale_unit,
          x.unitPriceHt,
          x.unitPriceTtc,
          x.vatRate,
          x.lineHt,
          x.lineVat,
          x.lineTtc,
          x.unitCost,
          x.margin,
          line.selected_lot_id,
          line.suggested_lot_id,
          JSON.stringify(line.traceability_snapshot || {}),
          req.user.id,
        ]
      );

      if (returnStock && line.article_id && line.selected_lot_id && item.quantity > 0) {
        const lot = await db.query(
          `SELECT id, unit_cost_ex_vat FROM lots WHERE id = $1 AND store_id = $2 AND article_id = $3 FOR UPDATE`,
          [line.selected_lot_id, req.user.store_id, line.article_id]
        );
        if (!lot.rows.length) {
          await db.query('ROLLBACK');
          return res.status(400).json({ error: `Lot introuvable pour retour stock ligne ${line.line_number}` });
        }
        await db.query(`UPDATE lots SET qty_remaining = qty_remaining + $1, updated_at = NOW() WHERE id = $2`, [item.quantity, line.selected_lot_id]);
        await db.query(
          `INSERT INTO stock_movements(id, store_id, client_key, article_id, lot_id, movement_type, quantity, unit_cost_ex_vat, source_table, source_id, notes, created_by)
           VALUES(gen_random_uuid(), $1, $2, $3, $4, 'customer_return', $5, $6, 'sales_documents', $7, $8, $9)`,
          [
            req.user.store_id,
            invoice.client_key || req.user.client_key || null,
            line.article_id,
            line.selected_lot_id,
            item.quantity,
            num(lot.rows[0].unit_cost_ex_vat, x.unitCost),
            creditNoteId,
            `Retour client avoir ${reference}`,
            req.user.id,
          ]
        );
        articlesToRecompute.add(line.article_id);
      }
    }

    if (returnStock) {
      for (const articleId of articlesToRecompute) await recomputeArticleStock(db, articleId, req.user.store_id);
    }

    await db.query('COMMIT');
    return res.status(201).json({
      ok: true,
      credit_note_id: creditNoteId,
      credit_note_reference: created.rows[0].reference_number,
      pennylane_status: created.rows[0].pennylane_status,
      return_stock: returnStock,
    });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur creation avoir client :', err);
    if (err.code === '23505') return res.status(409).json({ error: 'Numero avoir deja utilise, reessaie la creation' });
    return res.status(500).json({ error: err.message || 'Erreur creation avoir client' });
  } finally {
    db.release();
  }
});

router.get('/credit-notes/:id/print-data', authenticateToken, attachDbContext, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return badId(res);
    const creditNote = await getCreditNoteDocument(req.dbPool, { creditNoteId: req.params.id, storeId: req.user.store_id });
    if (!creditNote) return res.status(404).json({ error: 'Avoir introuvable' });
    const [lines, storeSettings] = await Promise.all([
      getCreditNoteLines(req.dbPool, { creditNoteId: req.params.id, storeId: req.user.store_id }),
      getStoreSettings(req.dbPool, req.user.store_id),
    ]);
    return res.json({ credit_note: creditNote, lines, store_settings: storeSettings });
  } catch (err) {
    console.error('Erreur print-data avoir client :', err);
    return res.status(500).json({ error: 'Erreur preparation impression avoir client' });
  }
});

router.get('/credit-notes/:id/pdf', authenticateToken, attachDbContext, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return badId(res);
    const creditNote = await getCreditNoteDocument(req.dbPool, { creditNoteId: req.params.id, storeId: req.user.store_id });
    if (!creditNote) return res.status(404).json({ error: 'Avoir introuvable' });
    const [lines, storeSettings] = await Promise.all([
      getCreditNoteLines(req.dbPool, { creditNoteId: req.params.id, storeId: req.user.store_id }),
      getStoreSettings(req.dbPool, req.user.store_id),
    ]);
    const html = renderCustomerCreditNotePdf({ creditNote, lines, storeSettings });
    const pdf = await renderHtmlToPdf(html);
    return sendPdf(res, pdf, customerCreditNoteFilename(creditNote));
  } catch (err) {
    console.error('Erreur PDF avoir client :', err);
    return res.status(500).json({ error: 'Erreur generation PDF avoir client' });
  }
});

module.exports = router;
