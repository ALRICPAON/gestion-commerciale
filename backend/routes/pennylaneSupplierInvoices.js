const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const { processPennylaneSupplierInvoiceImportSync } = require('../services/pennylane');

const router = express.Router();

const ALTA_STATUSES = new Set([
  'nouvelle',
  'a_rapprocher',
  'en_controle',
  'conforme',
  'ecart_prix',
  'ecart_quantite',
  'litige',
  'refusee',
  'validee_a_payer',
  'payee',
]);

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

router.get('/integrations/pennylane/supplier-invoices', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const params = [req.user.store_id];
    const where = ['psi.store_id = $1', 'psi.pennylane_deleted_at IS NULL'];

    const status = clean(req.query.status);
    if (status && status !== 'all' && ALTA_STATUSES.has(status)) {
      params.push(status);
      where.push(`psi.alta_business_status = $${params.length}`);
    }

    const supplierId = clean(req.query.supplier_id);
    if (supplierId && isUuid(supplierId)) {
      params.push(supplierId);
      where.push(`psi.supplier_id = $${params.length}`);
    }

    const search = clean(req.query.search);
    if (search) {
      params.push(`%${search}%`);
      where.push(`(
        psi.invoice_number ILIKE $${params.length}
        OR COALESCE(s.name, '') ILIKE $${params.length}
        OR COALESCE(s.code, '') ILIKE $${params.length}
        OR COALESCE(psi.pennylane_supplier_id, '') ILIKE $${params.length}
      )`);
    }

    const result = await req.dbPool.query(
      `
      SELECT
        psi.id,
        psi.pennylane_supplier_invoice_id,
        psi.pennylane_supplier_id,
        psi.supplier_id,
        s.name AS supplier_name,
        s.code AS supplier_code,
        psi.invoice_number,
        psi.invoice_date,
        psi.due_date,
        psi.currency,
        psi.amount_ex_vat,
        psi.amount_vat,
        psi.amount_inc_vat,
        psi.accounting_status,
        psi.payment_status,
        psi.paid,
        psi.e_invoice_status,
        psi.e_invoice_reason,
        psi.e_invoice_flow_id,
        psi.public_file_url,
        psi.pennylane_filename,
        psi.alta_business_status,
        psi.match_status,
        psi.sync_status,
        psi.last_synced_at,
        COUNT(psil.id)::int AS line_count
      FROM pennylane_supplier_invoices psi
      LEFT JOIN suppliers s
        ON s.id = psi.supplier_id
       AND s.store_id = psi.store_id
      LEFT JOIN pennylane_supplier_invoice_lines psil
        ON psil.supplier_invoice_id = psi.id
      WHERE ${where.join(' AND ')}
      GROUP BY psi.id, s.name, s.code
      ORDER BY psi.invoice_date DESC NULLS LAST, psi.created_at DESC
      LIMIT 300
      `,
      params
    );

    return res.json({ invoices: result.rows });
  } catch (err) {
    console.error('Erreur GET /api/integrations/pennylane/supplier-invoices :', err);
    return res.status(500).json({ error: 'Erreur liste factures fournisseurs Pennylane' });
  }
});

router.get('/integrations/pennylane/supplier-invoices/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Identifiant facture fournisseur Pennylane invalide' });
    }

    const invoice = await req.dbPool.query(
      `
      SELECT
        psi.*,
        s.name AS supplier_name,
        s.code AS supplier_code
      FROM pennylane_supplier_invoices psi
      LEFT JOIN suppliers s
        ON s.id = psi.supplier_id
       AND s.store_id = psi.store_id
      WHERE psi.id = $1
        AND psi.store_id = $2
      LIMIT 1
      `,
      [req.params.id, req.user.store_id]
    );

    if (!invoice.rows.length) {
      return res.status(404).json({ error: 'Facture fournisseur Pennylane introuvable' });
    }

    const lines = await req.dbPool.query(
      `
      SELECT *
      FROM pennylane_supplier_invoice_lines
      WHERE supplier_invoice_id = $1
        AND store_id = $2
      ORDER BY line_position ASC, created_at ASC
      `,
      [req.params.id, req.user.store_id]
    );

    const links = await req.dbPool.query(
      `
      SELECT *
      FROM pennylane_supplier_invoice_links
      WHERE supplier_invoice_id = $1
        AND store_id = $2
      ORDER BY created_at ASC
      `,
      [req.params.id, req.user.store_id]
    );

    return res.json({
      invoice: invoice.rows[0],
      lines: lines.rows,
      links: links.rows,
    });
  } catch (err) {
    console.error('Erreur GET /api/integrations/pennylane/supplier-invoices/:id :', err);
    return res.status(500).json({ error: 'Erreur detail facture fournisseur Pennylane' });
  }
});

router.post('/integrations/pennylane/supplier-invoices/sync', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const result = await processPennylaneSupplierInvoiceImportSync(req.dbPool, {
      storeId: req.user.store_id,
      workerId: `manual-pennylane-supplier-invoice-sync-${req.user.id}`,
    });

    return res.status(202).json({
      ok: true,
      ...result,
    });
  } catch (err) {
    console.error('Erreur POST /api/integrations/pennylane/supplier-invoices/sync :', err);
    return res.status(500).json({ error: 'Erreur synchronisation factures fournisseurs Pennylane' });
  }
});

module.exports = router;
