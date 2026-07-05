const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');

const router = express.Router();

const MATCHABLE_PURCHASE_STATUSES = ['received', 'received_pending_invoice', 'invoice_difference', 'invoice_matched'];
const AMOUNT_TOLERANCE = 0.05;

function clean(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s || null;
}

function normalizePurchaseIds(value) {
  const raw = Array.isArray(value) ? value : [value];
  const ids = raw.map(clean).filter(Boolean);
  return [...new Set(ids)];
}

function invoiceComparableTotal(invoice) {
  return Number(invoice.product_total_ex_vat || invoice.total_ex_vat || 0);
}

function purchaseComparableTotal(purchase) {
  return Number(purchase.received_total_ex_vat || purchase.total_amount_ex_vat || 0);
}

async function getInvoice(client, invoiceId, storeId) {
  const result = await client.query(
    `SELECT si.*, s.name supplier_name, s.code supplier_code
     FROM supplier_invoices si
     JOIN suppliers s ON s.id = si.supplier_id
     WHERE si.id = $1 AND si.store_id = $2
     LIMIT 1`,
    [invoiceId, storeId]
  );
  return result.rows[0] || null;
}

async function loadPurchaseLines(client, storeId, purchaseIds) {
  if (!purchaseIds.length) return [];
  const result = await client.query(
    `SELECT pl.id, pl.purchase_id, pl.line_number, pl.supplier_reference, pl.supplier_label,
            pl.price_unit, pl.received_quantity, pl.ordered_quantity, pl.received_colis,
            pl.ordered_colis, pl.received_pieces, pl.ordered_pieces, pl.unit_price_ex_vat,
            pl.line_amount_ex_vat, a.plu article_plu, a.designation article_name,
            plm.meta_value, plm.supplier_lot_number purchase_supplier_lot_number
     FROM purchase_lines pl
     LEFT JOIN articles a ON a.id = pl.article_id
     LEFT JOIN purchase_line_metadata plm ON plm.purchase_line_id = pl.id AND plm.meta_key = 'gc_line'
     WHERE pl.store_id = $1
       AND pl.purchase_id = ANY($2::uuid[])
     ORDER BY pl.purchase_id, pl.line_number ASC`,
    [storeId, purchaseIds]
  );
  return result.rows;
}

function purchaseLineQuantity(line) {
  const unit = String(line.price_unit || 'kg').toLowerCase();
  const colis = Number(line.received_colis || line.ordered_colis || 0);
  const pieces = Number(line.received_pieces || line.ordered_pieces || 0);
  const quantity = Number(line.received_quantity || line.ordered_quantity || 0);
  if (unit === 'colis') return colis;
  if (unit === 'piece') return colis > 0 && pieces > 0 ? colis * pieces : pieces;
  return colis > 0 && quantity > 0 ? colis * quantity : quantity;
}

function purchaseLineLot(line) {
  const meta = line.meta_value && typeof line.meta_value === 'object' ? line.meta_value : {};
  return clean(line.purchase_supplier_lot_number) || clean(meta.supplier_lot_number) || clean(meta.lot) || clean(meta.lot_number);
}

function serializeLine(line) {
  return {
    id: line.id,
    line_number: line.line_number,
    supplier_reference: line.supplier_reference,
    supplier_label: line.supplier_label || line.article_name,
    article_plu: line.article_plu,
    article_name: line.article_name,
    supplier_lot_number: purchaseLineLot(line),
    quantity: purchaseLineQuantity(line),
    price_unit: line.price_unit || 'kg',
    unit_price_ex_vat: Number(line.unit_price_ex_vat || 0),
    line_amount_ex_vat: Number(line.line_amount_ex_vat || 0),
  };
}

router.get('/supplier-invoices/:id/manual-match-candidates', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const invoice = await getInvoice(req.dbPool, req.params.id, req.user.store_id);
    if (!invoice) return res.status(404).json({ error: 'Facture fournisseur introuvable' });

    const dateWindowDays = Math.max(1, Math.min(Number(req.query.date_window_days || 30), 120));
    const invoiceTotal = invoiceComparableTotal(invoice);
    const purchases = await req.dbPool.query(
      `SELECT p.id, p.bl_number, p.source_document_original_name, p.receipt_date, p.status,
              p.total_amount_ex_vat,
              COALESCE(SUM(pl.line_amount_ex_vat), p.total_amount_ex_vat, 0) received_total_ex_vat,
              COUNT(pl.id)::int line_count
       FROM purchases p
       LEFT JOIN purchase_lines pl ON pl.purchase_id = p.id
       WHERE p.store_id = $1
         AND p.supplier_id = $2
         AND p.status = ANY($3::text[])
         AND ($4::date IS NULL OR p.receipt_date BETWEEN ($4::date - ($5::int || ' days')::interval) AND ($4::date + ($5::int || ' days')::interval))
       GROUP BY p.id
       ORDER BY ABS(COALESCE(SUM(pl.line_amount_ex_vat), p.total_amount_ex_vat, 0) - $6::numeric) ASC,
                p.receipt_date DESC NULLS LAST
       LIMIT 50`,
      [req.user.store_id, invoice.supplier_id, MATCHABLE_PURCHASE_STATUSES, invoice.invoice_date || null, dateWindowDays, invoiceTotal]
    );

    const purchaseIds = purchases.rows.map((purchase) => purchase.id);
    const lines = await loadPurchaseLines(req.dbPool, req.user.store_id, purchaseIds);
    const linesByPurchase = new Map();
    lines.forEach((line) => {
      const key = String(line.purchase_id);
      if (!linesByPurchase.has(key)) linesByPurchase.set(key, []);
      linesByPurchase.get(key).push(serializeLine(line));
    });

    console.info('Rapprochement manuel facture fournisseur: candidats BL', {
      invoice_id: invoice.id,
      supplier_id: invoice.supplier_id,
      store_id: req.user.store_id,
      candidate_count: purchases.rows.length,
    });

    return res.json({
      invoice: {
        id: invoice.id,
        supplier_id: invoice.supplier_id,
        supplier_name: invoice.supplier_name,
        invoice_number: invoice.invoice_number,
        invoice_date: invoice.invoice_date,
        total_ex_vat: Number(invoice.total_ex_vat || 0),
        product_total_ex_vat: Number(invoice.product_total_ex_vat || 0),
        vat_amount: Number(invoice.vat_amount || 0),
        total_inc_vat: Number(invoice.total_inc_vat || 0),
        comparable_total_ex_vat: invoiceTotal,
      },
      candidates: purchases.rows.map((purchase) => {
        const purchaseTotal = purchaseComparableTotal(purchase);
        return {
          purchase_id: purchase.id,
          bl_number: purchase.bl_number,
          source_document_original_name: purchase.source_document_original_name,
          receipt_date: purchase.receipt_date,
          status: purchase.status,
          total_ex_vat: purchaseTotal,
          amount_difference: Number((invoiceTotal - purchaseTotal).toFixed(4)),
          line_count: Number(purchase.line_count || 0),
          lines: linesByPurchase.get(String(purchase.id)) || [],
        };
      }),
    });
  } catch (error) {
    console.error('Erreur candidats rapprochement manuel facture fournisseur :', error);
    return res.status(500).json({ error: 'Erreur candidats rapprochement manuel facture fournisseur' });
  }
});

router.post('/supplier-invoices/:id/manual-match', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    const purchaseIds = normalizePurchaseIds(req.body?.purchase_ids);
    if (!purchaseIds.length) return res.status(400).json({ error: 'Au moins un BL doit etre selectionne' });

    await client.query('BEGIN');
    const invoice = await getInvoice(client, req.params.id, req.user.store_id);
    if (!invoice) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Facture fournisseur introuvable' });
    }

    const selected = await client.query(
      `SELECT p.id, p.bl_number, p.receipt_date, p.status, p.total_amount_ex_vat,
              COALESCE(SUM(pl.line_amount_ex_vat), p.total_amount_ex_vat, 0) received_total_ex_vat
       FROM purchases p
       LEFT JOIN purchase_lines pl ON pl.purchase_id = p.id
       WHERE p.store_id = $1
         AND p.supplier_id = $2
         AND p.status = ANY($3::text[])
         AND p.id = ANY($4::uuid[])
       GROUP BY p.id
       ORDER BY p.receipt_date ASC NULLS LAST, p.bl_number ASC NULLS LAST`,
      [req.user.store_id, invoice.supplier_id, MATCHABLE_PURCHASE_STATUSES, purchaseIds]
    );

    if (selected.rows.length !== purchaseIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Selection BL invalide pour ce fournisseur ou ce magasin' });
    }

    const invoiceTotal = invoiceComparableTotal(invoice);
    const selectedTotal = selected.rows.reduce((sum, purchase) => sum + purchaseComparableTotal(purchase), 0);
    const amountDifference = Number((invoiceTotal - selectedTotal).toFixed(4));
    const hasDifference = Math.abs(amountDifference) > AMOUNT_TOLERANCE;
    const matchStatus = hasDifference ? 'difference' : 'matched';
    const invoiceLineMatchStatus = hasDifference ? 'price_difference' : 'matched';
    const invoiceLineMatchError = hasDifference ? 'Ecart facture/BL confirme manuellement' : null;

    await client.query('DELETE FROM supplier_invoice_matches WHERE supplier_invoice_id = $1', [invoice.id]);
    await client.query(
      `UPDATE supplier_invoice_lines
       SET match_status = $2,
           match_error = $3,
           updated_at = NOW()
       WHERE supplier_invoice_id = $1`,
      [invoice.id, invoiceLineMatchStatus, invoiceLineMatchError]
    );

    for (const [index, purchase] of selected.rows.entries()) {
      const purchaseTotal = purchaseComparableTotal(purchase);
      const notes = [
        'Rapprochement manuel confirme par utilisateur',
        `BL selectionne ${purchase.bl_number || purchase.id}`,
        `total BL ${purchaseTotal.toFixed(4)} HT`,
        `total selection ${selectedTotal.toFixed(4)} HT`,
        `ecart facture-selection ${amountDifference.toFixed(4)} HT`,
      ].join(' - ');
      await client.query(
        `INSERT INTO supplier_invoice_matches(
          id, store_id, supplier_invoice_id, purchase_id, match_status,
          difference_type, amount_difference, notes
         ) VALUES(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user.store_id,
          invoice.id,
          purchase.id,
          matchStatus,
          hasDifference ? 'amount' : null,
          index === 0 ? amountDifference : 0,
          notes,
        ]
      );
    }

    const invoiceStatus = hasDifference ? 'invoice_difference' : 'matched';
    const invoiceMatchStatus = hasDifference ? 'discrepancy' : 'matched';
    await client.query(
      `UPDATE supplier_invoices
       SET status = $1,
           match_status = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [invoiceStatus, invoiceMatchStatus, invoice.id]
    );
    await client.query(
      `UPDATE purchases
       SET status = $1,
           updated_at = NOW()
       WHERE id = ANY($2::uuid[])
         AND store_id = $3`,
      [hasDifference ? 'invoice_difference' : 'invoice_matched', purchaseIds, req.user.store_id]
    );

    await client.query('COMMIT');
    console.info('Rapprochement manuel facture fournisseur confirme', {
      invoice_id: invoice.id,
      supplier_id: invoice.supplier_id,
      store_id: req.user.store_id,
      purchase_ids: purchaseIds,
      invoice_total_ex_vat: invoiceTotal,
      selected_total_ex_vat: Number(selectedTotal.toFixed(4)),
      amount_difference: amountDifference,
      match_status: invoiceMatchStatus,
    });

    return res.json({
      ok: true,
      status: invoiceStatus,
      match_status: invoiceMatchStatus,
      matches: selected.rows.length,
      differences: hasDifference ? 1 : 0,
      selected_total_ex_vat: Number(selectedTotal.toFixed(4)),
      amount_difference: amountDifference,
      confirmed: true,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur confirmation rapprochement manuel facture fournisseur :', error);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
