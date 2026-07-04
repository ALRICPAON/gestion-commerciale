const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const { processPennylaneSupplierInvoiceImportSync } = require('../services/pennylane');
const {
  analyzePennylaneSupplierInvoice,
  buildPennylaneSupplierInvoiceMatchingDebug,
  processPendingPennylaneSupplierInvoiceMatching,
} = require('../services/supplierInvoiceMatchingEngine');

const router = express.Router();

const ALTA_STATUSES = new Set([
  'nouvelle',
  'a_rapprocher',
  'analyse_automatique',
  'en_controle',
  'conforme',
  'ecart_prix',
  'ecart_quantite',
  'ecart_tva',
  'bl_manquant',
  'article_inconnu',
  'controle_manuel',
  'litige',
  'refusee',
  'validee_a_payer',
  'payee',
]);

const FINAL_ALTA_SUPPLIER_INVOICE_STATUSES = new Set(['invoice_validated', 'cost_adjusted', 'sent_to_pennylane']);

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function num(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPgDate(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function summaryObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizedPennylaneInvoiceRow(row) {
  const summary = summaryObject(row.auto_match_summary);
  const globalCandidateCount = Number(row.auto_bl_count || summary.candidate_count || summary.bl_count || 0);
  const globalAnomalyCount = Number(row.auto_anomaly_count || summary.anomaly_count || 0);
  const globalSuccess = Boolean(
    row.supplier_id &&
    row.auto_match_status === 'success' &&
    globalCandidateCount > 0 &&
    globalAnomalyCount === 0
  );

  const displayStatus = globalSuccess ? 'en_controle' : row.alta_business_status;

  return {
    ...row,
    display_alta_business_status: displayStatus,
    display_auto_matched_count: globalSuccess
      ? globalCandidateCount
      : Number(row.auto_matched_lines_count || summary.matched_lines || 0),
    display_auto_anomaly_count: globalAnomalyCount,
  };
}

function buildAltaSupplierInvoicePayload(pennylaneInvoice, matchResults) {
  return {
    source: 'pennylane_supplier_invoice',
    pennylane_supplier_invoice_id: pennylaneInvoice.pennylane_supplier_invoice_id,
    pennylane_supplier_id: pennylaneInvoice.pennylane_supplier_id,
    supplier_id: pennylaneInvoice.supplier_id,
    invoice_number: pennylaneInvoice.invoice_number,
    invoice_date: toPgDate(pennylaneInvoice.invoice_date),
    due_date: toPgDate(pennylaneInvoice.due_date),
    amount_ex_vat: num(pennylaneInvoice.amount_ex_vat ?? pennylaneInvoice.currency_amount_ex_vat),
    amount_vat: num(pennylaneInvoice.amount_vat ?? pennylaneInvoice.currency_amount_vat),
    amount_inc_vat: num(pennylaneInvoice.amount_inc_vat ?? pennylaneInvoice.currency_amount_inc_vat),
    public_file_url: pennylaneInvoice.public_file_url,
    proposed_purchase_ids: matchResults.map((row) => row.purchase_id).filter(Boolean),
  };
}

async function loadPennylaneInvoiceForBridge(client, invoiceId, storeId) {
  const invoice = await client.query(
    `
    SELECT
      psi.*,
      s.name AS supplier_name,
      s.code AS supplier_code,
      s.supplier_type
    FROM pennylane_supplier_invoices psi
    LEFT JOIN suppliers s
      ON s.id = psi.supplier_id
     AND s.store_id = psi.store_id
    WHERE psi.id = $1
      AND psi.store_id = $2
      AND psi.pennylane_deleted_at IS NULL
    LIMIT 1
    `,
    [invoiceId, storeId]
  );

  return invoice.rows[0] || null;
}

async function loadPennylaneGlobalMatchResults(client, invoiceId, storeId) {
  const result = await client.query(
    `
    SELECT *
    FROM pennylane_supplier_invoice_match_results
    WHERE supplier_invoice_id = $1
      AND store_id = $2
      AND purchase_id IS NOT NULL
    ORDER BY confidence DESC NULLS LAST, created_at ASC
    LIMIT 20
    `,
    [invoiceId, storeId]
  );

  return result.rows;
}

async function findOrCreateAltaSupplierInvoice(client, { pennylaneInvoice, matchResults, user }) {
  const payload = buildAltaSupplierInvoicePayload(pennylaneInvoice, matchResults);
  const totalExVat = num(pennylaneInvoice.amount_ex_vat ?? pennylaneInvoice.currency_amount_ex_vat);
  const vatAmount = num(pennylaneInvoice.amount_vat ?? pennylaneInvoice.currency_amount_vat);
  const totalIncVat = num(pennylaneInvoice.amount_inc_vat ?? pennylaneInvoice.currency_amount_inc_vat);
  const proposedStatus = Number(pennylaneInvoice.auto_anomaly_count || 0) > 0 ? 'invoice_difference' : 'matched';
  const proposedMatchStatus = Number(pennylaneInvoice.auto_anomaly_count || 0) > 0 ? 'discrepancy' : 'matched';

  const existingByPayload = await client.query(
    `
    SELECT *
    FROM supplier_invoices
    WHERE store_id = $1
      AND pennylane_payload->>'pennylane_supplier_invoice_id' = $2
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [pennylaneInvoice.store_id, String(pennylaneInvoice.pennylane_supplier_invoice_id)]
  );

  const existingByIdentity = existingByPayload.rows.length ? existingByPayload : await client.query(
    `
    SELECT *
    FROM supplier_invoices
    WHERE store_id = $1
      AND supplier_id = $2
      AND invoice_number = $3
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [pennylaneInvoice.store_id, pennylaneInvoice.supplier_id, pennylaneInvoice.invoice_number]
  );

  if (existingByIdentity.rows.length) {
    const existing = existingByIdentity.rows[0];
    const finalStatus = FINAL_ALTA_SUPPLIER_INVOICE_STATUSES.has(existing.status);
    const updated = await client.query(
      `
      UPDATE supplier_invoices
      SET supplier_id = $2,
          invoice_number = $3,
          invoice_date = $4::date,
          due_date = $5::date,
          total_ex_vat = $6,
          product_total_ex_vat = $6,
          vat_amount = $7,
          total_inc_vat = $8,
          document_url = $9,
          status = CASE WHEN $10::boolean THEN status ELSE $11 END,
          match_status = CASE WHEN $10::boolean THEN match_status ELSE $12 END,
          pennylane_payload = $13::jsonb,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        existing.id,
        pennylaneInvoice.supplier_id,
        pennylaneInvoice.invoice_number,
        toPgDate(pennylaneInvoice.invoice_date),
        toPgDate(pennylaneInvoice.due_date),
        totalExVat,
        vatAmount,
        totalIncVat,
        clean(pennylaneInvoice.public_file_url),
        finalStatus,
        proposedStatus,
        proposedMatchStatus,
        JSON.stringify(payload),
      ]
    );
    return { invoice: updated.rows[0], created: false, finalStatus };
  }

  const inserted = await client.query(
    `
    INSERT INTO supplier_invoices(
      id, store_id, client_key, supplier_id, invoice_number, invoice_date, due_date,
      supplier_type, total_ex_vat, product_total_ex_vat, fees_ex_vat, vat_amount,
      total_inc_vat, document_url, notes, status, match_status, pennylane_payload, created_by
    )
    VALUES(gen_random_uuid(), $1, $2, $3, $4, $5::date, $6::date,
      $7, $8, $8, 0, $9,
      $10, $11, $12, $13, $14, $15::jsonb, $16)
    RETURNING *
    `,
    [
      pennylaneInvoice.store_id,
      user.client_key || null,
      pennylaneInvoice.supplier_id,
      pennylaneInvoice.invoice_number,
      toPgDate(pennylaneInvoice.invoice_date),
      toPgDate(pennylaneInvoice.due_date),
      clean(pennylaneInvoice.supplier_type),
      totalExVat,
      vatAmount,
      totalIncVat,
      clean(pennylaneInvoice.public_file_url),
      `Facture creee depuis Pennylane ${pennylaneInvoice.pennylane_supplier_invoice_id}`,
      proposedStatus,
      proposedMatchStatus,
      JSON.stringify(payload),
      user.id,
    ]
  );

  return { invoice: inserted.rows[0], created: true, finalStatus: false };
}

async function replaceAltaProposedMatches(client, { altaInvoice, pennylaneInvoice, matchResults }) {
  if (FINAL_ALTA_SUPPLIER_INVOICE_STATUSES.has(altaInvoice.status)) return 0;

  await client.query('DELETE FROM supplier_invoice_matches WHERE supplier_invoice_id = $1', [altaInvoice.id]);

  let inserted = 0;
  for (const result of matchResults) {
    const isConform = result.match_status === 'conforme';
    await client.query(
      `
      INSERT INTO supplier_invoice_matches(
        id, store_id, supplier_invoice_id, purchase_id, match_status,
        difference_type, amount_difference, notes
      )
      VALUES(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
      `,
      [
        pennylaneInvoice.store_id,
        altaInvoice.id,
        result.purchase_id,
        isConform ? 'matched' : 'difference',
        isConform ? null : 'amount',
        num(result.amount_difference, 0),
        'Proposition globale depuis facture fournisseur Pennylane',
      ]
    );
    inserted += 1;
  }

  return inserted;
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
        psi.auto_match_status,
        psi.auto_match_summary,
        psi.auto_bl_count,
        psi.auto_matched_lines_count,
        psi.auto_anomaly_count,
        psi.auto_conformity_score,
        psi.auto_matched_at,
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

    return res.json({ invoices: result.rows.map(normalizedPennylaneInvoiceRow) });
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

    const analysis = await analyzePennylaneSupplierInvoice(req.dbPool, {
      invoiceId: req.params.id,
      storeId: req.user.store_id,
    });

    if (analysis.reason === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Facture fournisseur Pennylane introuvable' });
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

    const matchResults = await req.dbPool.query(
      `
      SELECT
        mr.*,
        a.plu article_plu,
        a.designation article_name
      FROM pennylane_supplier_invoice_match_results mr
      LEFT JOIN articles a
        ON a.id = mr.article_id
       AND a.store_id = mr.store_id
      WHERE mr.supplier_invoice_id = $1
        AND mr.store_id = $2
      ORDER BY mr.created_at ASC
      `,
      [req.params.id, req.user.store_id]
    );

    const matchingDebug = await buildPennylaneSupplierInvoiceMatchingDebug(req.dbPool, {
      invoiceId: req.params.id,
      storeId: req.user.store_id,
    });

    return res.json({
      invoice: normalizedPennylaneInvoiceRow(invoice.rows[0]),
      lines: lines.rows,
      links: links.rows,
      match_results: matchResults.rows,
      matching_analysis: analysis,
      matching_debug: matchingDebug,
    });
  } catch (err) {
    console.error('Erreur GET /api/integrations/pennylane/supplier-invoices/:id :', err);
    return res.status(500).json({ error: 'Erreur detail facture fournisseur Pennylane' });
  }
});

router.post('/integrations/pennylane/supplier-invoices/:id/analyze', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Identifiant facture fournisseur Pennylane invalide' });
    }

    const result = await analyzePennylaneSupplierInvoice(req.dbPool, {
      invoiceId: req.params.id,
      storeId: req.user.store_id,
    });

    if (result.reason === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Facture fournisseur Pennylane introuvable' });
    }

    return res.json(result);
  } catch (err) {
    console.error('Erreur POST /api/integrations/pennylane/supplier-invoices/:id/analyze :', err);
    return res.status(500).json({ error: 'Erreur analyse automatique facture fournisseur Pennylane' });
  }
});

router.post('/integrations/pennylane/supplier-invoices/:id/open-alta', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Identifiant facture fournisseur Pennylane invalide' });
    }

    const analysis = await analyzePennylaneSupplierInvoice(req.dbPool, {
      invoiceId: req.params.id,
      storeId: req.user.store_id,
    });
    if (analysis.reason === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Facture fournisseur Pennylane introuvable' });
    }

    await client.query('BEGIN');
    const pennylaneInvoice = await loadPennylaneInvoiceForBridge(client, req.params.id, req.user.store_id);
    if (!pennylaneInvoice) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Facture fournisseur Pennylane introuvable' });
    }
    if (!pennylaneInvoice.supplier_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Fournisseur ALTA obligatoire avant ouverture dans le module facture fournisseur' });
    }

    const matchResults = await loadPennylaneGlobalMatchResults(client, pennylaneInvoice.id, req.user.store_id);
    const alta = await findOrCreateAltaSupplierInvoice(client, {
      pennylaneInvoice,
      matchResults,
      user: req.user,
    });
    const matchesInserted = await replaceAltaProposedMatches(client, {
      altaInvoice: alta.invoice,
      pennylaneInvoice,
      matchResults,
    });

    await client.query('COMMIT');
    return res.json({
      ok: true,
      supplier_invoice_id: alta.invoice.id,
      created: alta.created,
      matches_inserted: matchesInserted,
      redirect_url: `./supplier-invoices.html?invoice_id=${encodeURIComponent(alta.invoice.id)}`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/integrations/pennylane/supplier-invoices/:id/open-alta :', err);
    return res.status(500).json({ error: err.message || 'Erreur ouverture facture fournisseur ALTA' });
  } finally {
    client.release();
  }
});

router.post('/integrations/pennylane/supplier-invoices/sync', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const result = await processPennylaneSupplierInvoiceImportSync(req.dbPool, {
      storeId: req.user.store_id,
      workerId: `manual-pennylane-supplier-invoice-sync-${req.user.id}`,
    });
    const matching = await processPendingPennylaneSupplierInvoiceMatching(req.dbPool, {
      storeId: req.user.store_id,
    });

    return res.status(202).json({
      ok: true,
      sync: result,
      matching,
    });
  } catch (err) {
    console.error('Erreur POST /api/integrations/pennylane/supplier-invoices/sync :', err);
    return res.status(500).json({ error: 'Erreur synchronisation factures fournisseurs Pennylane' });
  }
});

module.exports = router;
