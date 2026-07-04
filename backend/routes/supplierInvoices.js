const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const { recomputeArticleStock } = require('../services/stockService');
const {
  VALIDATED_PAYMENT_STATUS,
  syncValidatedSupplierInvoiceStatusToPennylane,
} = require('../services/pennylane');

const router = express.Router();
const DOCUMENTS_ROOT = path.join(__dirname, '..', 'uploads', 'supplier-invoices');
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.xlsx', '.xls', '.csv']);

fs.mkdirSync(DOCUMENTS_ROOT, { recursive: true });

const upload = multer({
  dest: DOCUMENTS_ROOT,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(Object.assign(new Error('Format facture fournisseur non supporte'), { status: 400, expose: true }));
    }
    return cb(null, true);
  },
});

function clean(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s || null;
}

function num(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function jsonLines(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function jsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function invoiceDocumentUrl(invoiceId) {
  return `/api/supplier-invoices/${encodeURIComponent(invoiceId)}/document`;
}

function buildPennylanePayload(invoice, lines) {
  return {
    type: 'supplier_invoice',
    source: 'gestion-commerciale',
    invoice_id: invoice.id,
    store_id: invoice.store_id,
    supplier_id: invoice.supplier_id,
    supplier_name: invoice.supplier_name,
    invoice_number: invoice.invoice_number,
    invoice_date: invoice.invoice_date,
    due_date: invoice.due_date,
    total_ex_vat: Number(invoice.total_ex_vat || 0),
    product_total_ex_vat: Number(invoice.product_total_ex_vat || 0),
    fees_ex_vat: Number(invoice.fees_ex_vat || 0),
    vat_amount: Number(invoice.vat_amount || 0),
    total_inc_vat: Number(invoice.total_inc_vat || 0),
    lines: lines.map((line) => ({
      article_id: line.article_id,
      supplier_reference: line.supplier_reference,
      label: line.supplier_label,
      quantity: Number(line.quantity || 0),
      unit_price_ex_vat: Number(line.unit_price_ex_vat || 0),
      line_amount_ex_vat: Number(line.line_amount_ex_vat || 0),
      vat_rate: Number(line.vat_rate || 0),
      vat_amount: Number(line.vat_amount || 0),
    })),
  };
}

function buildValidatedPennylanePayload(invoice, lines) {
  const existingPayload = jsonObject(invoice.pennylane_payload);
  const payload = buildPennylanePayload(invoice, lines);

  return {
    ...existingPayload,
    ...payload,
    source: existingPayload.source || payload.source,
    pennylane_supplier_invoice_id: existingPayload.pennylane_supplier_invoice_id || null,
    pennylane_supplier_id: existingPayload.pennylane_supplier_id || null,
  };
}

function getPennylaneSupplierInvoiceId(invoice) {
  const payload = jsonObject(invoice.pennylane_payload);
  return clean(payload.pennylane_supplier_invoice_id || invoice.pennylane_supplier_invoice_id);
}

async function recordPennylaneStatusSyncFailure(db, { invoice, error, userId }) {
  const errorPayload = error.pennylaneStatusSync || { message: error.message || 'Erreur Pennylane inattendue' };

  await db.query(
    `UPDATE supplier_invoices
     SET pennylane_status = 'pennylane_error',
         updated_at = NOW()
     WHERE id = $1 AND store_id = $2`,
    [invoice.id, invoice.store_id]
  ).catch((updateError) => {
    console.error('[Pennylane supplier invoice status] erreur stockage statut local', {
      invoice_id: invoice.id,
      message: updateError.message,
    });
  });

  await db.query(
    `INSERT INTO supplier_invoice_exports(id, supplier_invoice_id, store_id, export_type, status, payload, created_by)
     VALUES(gen_random_uuid(), $1, $2, 'pennylane_status_sync', 'failed', $3::jsonb, $4)`,
    [
      invoice.id,
      invoice.store_id,
      JSON.stringify({
        target_payment_status: VALIDATED_PAYMENT_STATUS,
        error: errorPayload,
      }),
      userId,
    ]
  ).catch((insertError) => {
    console.error('[Pennylane supplier invoice status] erreur stockage echec export', {
      invoice_id: invoice.id,
      message: insertError.message,
    });
  });
}

async function getInvoice(client, invoiceId, storeId) {
  const invoice = await client.query(
    `SELECT si.*, s.name supplier_name, s.code supplier_code
     FROM supplier_invoices si
     JOIN suppliers s ON s.id = si.supplier_id
     WHERE si.id = $1 AND si.store_id = $2
     LIMIT 1`,
    [invoiceId, storeId]
  );
  return invoice.rows[0] || null;
}

async function getInvoiceLines(client, invoiceId) {
  const lines = await client.query(
    `SELECT sil.*, a.plu article_plu, a.designation article_name
     FROM supplier_invoice_lines sil
     LEFT JOIN articles a ON a.id = sil.article_id
     WHERE sil.supplier_invoice_id = $1
     ORDER BY sil.line_number ASC`,
    [invoiceId]
  );
  return lines.rows;
}

async function syncInvoiceTotals(client, invoiceId) {
  await client.query(
    `UPDATE supplier_invoices si
     SET product_total_ex_vat = COALESCE(x.total_ex_vat, si.product_total_ex_vat),
         total_ex_vat = CASE WHEN si.total_ex_vat = 0 THEN COALESCE(x.total_ex_vat, 0) + COALESCE(si.fees_ex_vat, 0) ELSE si.total_ex_vat END,
         vat_amount = CASE WHEN si.vat_amount = 0 THEN COALESCE(x.vat_amount, 0) ELSE si.vat_amount END,
         total_inc_vat = CASE WHEN si.total_inc_vat = 0 THEN COALESCE(x.total_inc_vat, 0) + COALESCE(si.fees_ex_vat, 0) ELSE si.total_inc_vat END,
         updated_at = NOW()
     FROM (
       SELECT COALESCE(SUM(line_amount_ex_vat), 0) total_ex_vat,
              COALESCE(SUM(vat_amount), 0) vat_amount,
              COALESCE(SUM(line_amount_inc_vat), 0) total_inc_vat
       FROM supplier_invoice_lines
       WHERE supplier_invoice_id = $1
     ) x
     WHERE si.id = $1`,
    [invoiceId]
  );
}

router.get('/supplier-invoices', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const params = [req.user.store_id];
    let where = 'WHERE si.store_id = $1';
    if (clean(req.query.status)) {
      params.push(clean(req.query.status));
      where += ` AND si.status = $${params.length}`;
    }
    if (clean(req.query.supplier_id)) {
      params.push(clean(req.query.supplier_id));
      where += ` AND si.supplier_id = $${params.length}`;
    }
    if (clean(req.query.search)) {
      params.push(`%${clean(req.query.search)}%`);
      where += ` AND (si.invoice_number ILIKE $${params.length} OR s.name ILIKE $${params.length} OR COALESCE(s.code, '') ILIKE $${params.length})`;
    }

    const result = await req.dbPool.query(
      `SELECT si.*, s.name supplier_name, s.code supplier_code,
              COUNT(DISTINCT sil.id) line_count,
              COUNT(DISTINCT sim.id) match_count
       FROM supplier_invoices si
       JOIN suppliers s ON s.id = si.supplier_id
       LEFT JOIN supplier_invoice_lines sil ON sil.supplier_invoice_id = si.id
       LEFT JOIN supplier_invoice_matches sim ON sim.supplier_invoice_id = si.id
       ${where}
       GROUP BY si.id, s.name, s.code
       ORDER BY si.invoice_date DESC NULLS LAST, si.created_at DESC
       LIMIT 500`,
      params
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Erreur liste factures fournisseurs :', error);
    return res.status(500).json({ error: 'Erreur serveur factures fournisseurs' });
  }
});

router.post('/supplier-invoices', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    const supplierId = clean(req.body.supplier_id);
    const invoiceNumber = clean(req.body.invoice_number);
    if (!supplierId || !invoiceNumber) return res.status(400).json({ error: 'supplier_id et invoice_number obligatoires' });

    await client.query('BEGIN');
    const supplier = await client.query('SELECT id, supplier_type FROM suppliers WHERE id = $1 AND store_id = $2 LIMIT 1', [supplierId, req.user.store_id]);
    if (!supplier.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Fournisseur invalide' });
    }

    const invoice = await client.query(
      `INSERT INTO supplier_invoices(
        id, store_id, client_key, supplier_id, invoice_number, invoice_date, due_date,
        supplier_type, total_ex_vat, product_total_ex_vat, fees_ex_vat, vat_amount,
        total_inc_vat, notes, created_by
       )
       VALUES(gen_random_uuid(), $1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        req.user.store_id,
        req.user.client_key || null,
        supplierId,
        invoiceNumber,
        clean(req.body.invoice_date),
        clean(req.body.due_date),
        clean(req.body.supplier_type) || supplier.rows[0].supplier_type || null,
        num(req.body.total_ex_vat),
        num(req.body.product_total_ex_vat),
        num(req.body.fees_ex_vat),
        num(req.body.vat_amount),
        num(req.body.total_inc_vat),
        clean(req.body.notes),
        req.user.id,
      ]
    );

    const lines = jsonLines(req.body.lines);
    let lineNumber = 1;
    for (const line of lines) {
      await client.query(
        `INSERT INTO supplier_invoice_lines(
          id, supplier_invoice_id, store_id, supplier_id, line_number, article_id,
          supplier_reference, supplier_label, quantity, colis, pieces, price_unit,
          unit_price_ex_vat, line_amount_ex_vat, vat_rate, vat_amount, line_amount_inc_vat
         )
         VALUES(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, 'kg'), $12, $13, $14, $15, $16)`,
        [
          invoice.rows[0].id,
          req.user.store_id,
          supplierId,
          lineNumber++,
          clean(line.article_id),
          clean(line.supplier_reference),
          clean(line.supplier_label),
          num(line.quantity),
          num(line.colis, null),
          num(line.pieces, null),
          clean(line.price_unit),
          num(line.unit_price_ex_vat),
          num(line.line_amount_ex_vat),
          num(line.vat_rate),
          num(line.vat_amount),
          num(line.line_amount_inc_vat),
        ]
      );
    }

    await syncInvoiceTotals(client, invoice.rows[0].id);
    const finalInvoice = await getInvoice(client, invoice.rows[0].id, req.user.store_id);
    const finalLines = await getInvoiceLines(client, invoice.rows[0].id);
    const payload = buildPennylanePayload(finalInvoice, finalLines);
    await client.query('UPDATE supplier_invoices SET pennylane_payload = $1::jsonb WHERE id = $2', [JSON.stringify(payload), invoice.rows[0].id]);
    await client.query('COMMIT');
    return res.status(201).json({ ok: true, invoice: finalInvoice, lines: finalLines });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur creation facture fournisseur :', error);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.post('/supplier-invoices/import', authenticateToken, attachDbContext, requireAdminOrManager, upload.single('document'), async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    if (!req.file) return res.status(400).json({ error: 'Document facture obligatoire' });
    req.body.document_url = null;
    await client.query('BEGIN');
    const supplierId = clean(req.body.supplier_id);
    const invoiceNumber = clean(req.body.invoice_number) || path.parse(req.file.originalname || req.file.filename).name;
    if (!supplierId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'supplier_id obligatoire' });
    }

    const supplier = await client.query('SELECT id, supplier_type FROM suppliers WHERE id = $1 AND store_id = $2 LIMIT 1', [supplierId, req.user.store_id]);
    if (!supplier.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Fournisseur invalide' });
    }

    const invoice = await client.query(
      `INSERT INTO supplier_invoices(
        id, store_id, client_key, supplier_id, invoice_number, invoice_date, due_date,
        supplier_type, total_ex_vat, product_total_ex_vat, fees_ex_vat, vat_amount,
        total_inc_vat, document_url, notes, created_by
       )
       VALUES(gen_random_uuid(), $1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11, $12, NULL, $13, $14)
       RETURNING *`,
      [
        req.user.store_id,
        req.user.client_key || null,
        supplierId,
        invoiceNumber,
        clean(req.body.invoice_date),
        clean(req.body.due_date),
        clean(req.body.supplier_type) || supplier.rows[0].supplier_type || null,
        num(req.body.total_ex_vat),
        num(req.body.product_total_ex_vat),
        num(req.body.fees_ex_vat),
        num(req.body.vat_amount),
        num(req.body.total_inc_vat),
        clean(req.body.notes),
        req.user.id,
      ]
    );

    const url = invoiceDocumentUrl(invoice.rows[0].id);
    await client.query('UPDATE supplier_invoices SET document_url = $1 WHERE id = $2', [url, invoice.rows[0].id]);
    await client.query(
      `INSERT INTO supplier_invoice_documents(
        id, supplier_invoice_id, store_id, document_type, original_name, mime_type, storage_path, public_url, uploaded_by
       )
       VALUES(gen_random_uuid(), $1, $2, 'invoice', $3, $4, $5, $6, $7)`,
      [invoice.rows[0].id, req.user.store_id, req.file.originalname || null, req.file.mimetype || null, req.file.path, url, req.user.id]
    );

    await client.query('COMMIT');
    return res.status(201).json({ ok: true, invoice: { ...invoice.rows[0], document_url: url } });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur import facture fournisseur :', error);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get('/supplier-invoices/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const invoice = await getInvoice(req.dbPool, req.params.id, req.user.store_id);
    if (!invoice) return res.status(404).json({ error: 'Facture fournisseur introuvable' });
    const lines = await getInvoiceLines(req.dbPool, invoice.id);
    const matches = await req.dbPool.query(
      `SELECT sim.*, p.bl_number, p.receipt_date, pl.line_number purchase_line_number,
              a.plu article_plu, a.designation article_name
       FROM supplier_invoice_matches sim
       LEFT JOIN purchases p ON p.id = sim.purchase_id
       LEFT JOIN purchase_lines pl ON pl.id = sim.purchase_line_id
       LEFT JOIN articles a ON a.id = pl.article_id
       WHERE sim.supplier_invoice_id = $1
       ORDER BY sim.created_at ASC`,
      [invoice.id]
    );
    const documents = await req.dbPool.query('SELECT * FROM supplier_invoice_documents WHERE supplier_invoice_id = $1 ORDER BY created_at DESC', [invoice.id]);
    return res.json({ invoice, lines, matches: matches.rows, documents: documents.rows });
  } catch (error) {
    console.error('Erreur detail facture fournisseur :', error);
    return res.status(500).json({ error: 'Erreur detail facture fournisseur' });
  }
});

router.get('/supplier-invoices/:id/document', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const doc = await req.dbPool.query(
      `SELECT d.*
       FROM supplier_invoice_documents d
       JOIN supplier_invoices si ON si.id = d.supplier_invoice_id
       WHERE d.supplier_invoice_id = $1 AND d.store_id = $2
       ORDER BY d.created_at DESC
       LIMIT 1`,
      [req.params.id, req.user.store_id]
    );
    if (!doc.rows.length || !fs.existsSync(doc.rows[0].storage_path)) return res.status(404).json({ error: 'Document facture introuvable' });
    return res.download(doc.rows[0].storage_path, doc.rows[0].original_name || 'facture-fournisseur');
  } catch (error) {
    console.error('Erreur document facture fournisseur :', error);
    return res.status(500).json({ error: 'Erreur document facture fournisseur' });
  }
});

router.post('/supplier-invoices/:id/auto-match', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    await client.query('BEGIN');
    const invoice = await getInvoice(client, req.params.id, req.user.store_id);
    if (!invoice) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Facture fournisseur introuvable' });
    }

    await client.query('DELETE FROM supplier_invoice_matches WHERE supplier_invoice_id = $1', [invoice.id]);

    const lines = await getInvoiceLines(client, invoice.id);
    const dateWindowDays = Math.max(1, Math.min(Number(req.body.date_window_days || 7), 45));
    const candidates = await client.query(
      `SELECT p.*, COALESCE(SUM(pl.line_amount_ex_vat), 0) received_total_ex_vat
       FROM purchases p
       LEFT JOIN purchase_lines pl ON pl.purchase_id = p.id
       WHERE p.store_id = $1
         AND p.supplier_id = $2
         AND p.status IN ('received', 'received_pending_invoice', 'invoice_difference', 'invoice_matched')
         AND ($3::date IS NULL OR p.receipt_date BETWEEN ($3::date - ($4::int || ' days')::interval) AND ($3::date + ($4::int || ' days')::interval))
       GROUP BY p.id
       ORDER BY ABS(COALESCE(p.total_amount_ex_vat, 0) - $5::numeric) ASC, p.receipt_date DESC NULLS LAST
       LIMIT 20`,
      [req.user.store_id, invoice.supplier_id, invoice.invoice_date || null, dateWindowDays, Number(invoice.product_total_ex_vat || invoice.total_ex_vat || 0)]
    );

    let differences = 0;
    let matches = 0;

    if (!lines.length && candidates.rows.length) {
      const purchase = candidates.rows[0];
      const amountDifference = Number((Number(invoice.product_total_ex_vat || invoice.total_ex_vat || 0) - Number(purchase.received_total_ex_vat || purchase.total_amount_ex_vat || 0)).toFixed(4));
      const matchStatus = Math.abs(amountDifference) <= 0.05 ? 'matched' : 'difference';
      if (matchStatus === 'difference') differences += 1;
      matches += 1;
      await client.query(
        `INSERT INTO supplier_invoice_matches(id, store_id, supplier_invoice_id, purchase_id, match_status, difference_type, amount_difference, notes)
         VALUES(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
        [req.user.store_id, invoice.id, purchase.id, matchStatus, matchStatus === 'difference' ? 'amount' : null, amountDifference, 'Rapprochement automatique par fournisseur/date/total']
      );
    }

    for (const line of lines) {
      const candidateLine = await client.query(
        `SELECT pl.*, p.id purchase_id, p.bl_number, p.receipt_date, l.id lot_id
         FROM purchase_lines pl
         JOIN purchases p ON p.id = pl.purchase_id
         LEFT JOIN lots l ON l.purchase_line_id = pl.id
         WHERE pl.store_id = $1
           AND pl.supplier_id = $2
           AND p.status IN ('received', 'received_pending_invoice', 'invoice_difference', 'invoice_matched')
           AND ($3::uuid IS NULL OR pl.article_id = $3::uuid)
         ORDER BY ABS(COALESCE(pl.line_amount_ex_vat, 0) - $4::numeric) ASC, p.receipt_date DESC NULLS LAST
         LIMIT 1`,
        [req.user.store_id, invoice.supplier_id, line.article_id || null, Number(line.line_amount_ex_vat || 0)]
      );

      if (!candidateLine.rows.length) {
        differences += 1;
        await client.query('UPDATE supplier_invoice_lines SET match_status = $1, match_error = $2 WHERE id = $3', ['missing_purchase_line', 'Aucune ligne reception rapprochable', line.id]);
        continue;
      }

      const purchaseLine = candidateLine.rows[0];
      const qtyDifference = Number((Number(line.quantity || 0) - Number(purchaseLine.received_quantity || purchaseLine.ordered_quantity || 0)).toFixed(3));
      const priceDifference = Number((Number(line.unit_price_ex_vat || 0) - Number(purchaseLine.unit_price_ex_vat || 0)).toFixed(4));
      const amountDifference = Number((Number(line.line_amount_ex_vat || 0) - Number(purchaseLine.line_amount_ex_vat || 0)).toFixed(4));
      const hasDifference = Math.abs(qtyDifference) > 0.001 || Math.abs(priceDifference) > 0.001 || Math.abs(amountDifference) > 0.05;
      const matchStatus = hasDifference ? 'difference' : 'matched';
      if (hasDifference) differences += 1;
      matches += 1;

      await client.query(
        `INSERT INTO supplier_invoice_matches(
          id, store_id, supplier_invoice_id, supplier_invoice_line_id, purchase_id,
          purchase_line_id, lot_id, match_status, difference_type, quantity_difference,
          price_difference, amount_difference, notes
         )
         VALUES(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          req.user.store_id,
          invoice.id,
          line.id,
          purchaseLine.purchase_id,
          purchaseLine.id,
          purchaseLine.lot_id,
          matchStatus,
          hasDifference ? 'line' : null,
          qtyDifference,
          priceDifference,
          amountDifference,
          hasDifference ? 'Ecart detecte automatiquement' : 'Rapprochement automatique OK',
        ]
      );

      await client.query(
        'UPDATE supplier_invoice_lines SET match_status = $1, match_error = $2 WHERE id = $3',
        [hasDifference ? 'price_difference' : 'matched', hasDifference ? 'Ecart facture/reception' : null, line.id]
      );
    }

    const status = differences > 0 ? 'invoice_difference' : 'matched';
    const matchStatus = differences > 0 ? 'discrepancy' : 'matched';
    await client.query('UPDATE supplier_invoices SET status = $1, match_status = $2, updated_at = NOW() WHERE id = $3', [status, matchStatus, invoice.id]);
    await client.query(
      `UPDATE purchases p
       SET status = CASE WHEN $1 > 0 THEN 'invoice_difference' ELSE 'invoice_matched' END,
           updated_at = NOW()
       WHERE p.id IN (SELECT DISTINCT purchase_id FROM supplier_invoice_matches WHERE supplier_invoice_id = $2 AND purchase_id IS NOT NULL)`,
      [differences, invoice.id]
    );

    await client.query('COMMIT');
    return res.json({ ok: true, status, match_status: matchStatus, matches, differences });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur rapprochement facture fournisseur :', error);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

async function applyCostAdjustments(client, invoice, userId) {
  const matches = await client.query(
    `SELECT sim.*, pl.article_id, pl.received_quantity, pl.ordered_quantity, pl.line_amount_ex_vat, l.unit_cost_ex_vat, l.qty_initial
     FROM supplier_invoice_matches sim
     JOIN purchase_lines pl ON pl.id = sim.purchase_line_id
     JOIN lots l ON l.id = sim.lot_id
     WHERE sim.supplier_invoice_id = $1 AND sim.purchase_line_id IS NOT NULL AND sim.lot_id IS NOT NULL`,
    [invoice.id]
  );

  const totalBase = matches.rows.reduce((sum, row) => sum + Number(row.line_amount_ex_vat || 0), 0);
  const fees = Number(invoice.fees_ex_vat || 0);
  let adjusted = 0;

  for (const row of matches.rows) {
    const qty = Number(row.qty_initial || row.received_quantity || row.ordered_quantity || 0);
    if (qty <= 0) continue;
    const baseAmount = Number(row.line_amount_ex_vat || 0);
    const prorataFees = totalBase > 0 ? Number(((baseAmount / totalBase) * fees).toFixed(4)) : 0;
    const targetAmount = baseAmount + prorataFees;
    const newUnitCost = Number((targetAmount / qty).toFixed(4));
    const oldUnitCost = Number(row.unit_cost_ex_vat || 0);
    if (Math.abs(newUnitCost - oldUnitCost) <= 0.0001) continue;

    await client.query('UPDATE lots SET unit_cost_ex_vat = $1, updated_at = NOW() WHERE id = $2', [newUnitCost, row.lot_id]);
    await client.query(
      `INSERT INTO supplier_invoice_cost_adjustments(
        id, store_id, supplier_invoice_id, purchase_id, purchase_line_id, lot_id, article_id,
        old_unit_cost_ex_vat, new_unit_cost_ex_vat, quantity_reference, adjustment_amount_ex_vat,
        reason, created_by
       )
       VALUES(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [invoice.store_id, invoice.id, row.purchase_id, row.purchase_line_id, row.lot_id, row.article_id, oldUnitCost, newUnitCost, qty, Number(((newUnitCost - oldUnitCost) * qty).toFixed(4)), 'Ajustement cout facture fournisseur / criee', userId]
    );
    await client.query(
      `INSERT INTO stock_movements(id, store_id, client_key, article_id, lot_id, movement_type, quantity, unit_cost_ex_vat, source_table, source_id, notes, created_by)
       VALUES(gen_random_uuid(), $1, $2, $3, $4, 'cost_adjustment', 0, $5, 'supplier_invoices', $6, $7, $8)`,
      [invoice.store_id, invoice.client_key, row.article_id, row.lot_id, newUnitCost, invoice.id, `Ajustement cout reel facture fournisseur ${invoice.invoice_number}`, userId]
    );
    await recomputeArticleStock(client, row.article_id, invoice.store_id);
    adjusted += 1;
  }

  return adjusted;
}

router.post('/supplier-invoices/:id/validate', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    await client.query('BEGIN');
    const invoice = await getInvoice(client, req.params.id, req.user.store_id);
    if (!invoice) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Facture fournisseur introuvable' });
    }
    if (invoice.match_status === 'discrepancy' && req.body.confirm_difference !== true) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Validation manuelle obligatoire en cas d ecart', code: 'INVOICE_DIFFERENCE_CONFIRMATION_REQUIRED' });
    }

    const pennylaneSupplierInvoiceId = getPennylaneSupplierInvoiceId(invoice);
    const adjustedLots = req.body.adjust_costs === true ? await applyCostAdjustments(client, invoice, req.user.id) : 0;
    const finalStatus = adjustedLots > 0 ? 'cost_adjusted' : 'invoice_validated';
    const lines = await getInvoiceLines(client, invoice.id);
    const payload = buildValidatedPennylanePayload(invoice, lines);

    await client.query(
      `UPDATE supplier_invoices
       SET status = $1,
           pennylane_status = 'ready_to_send',
           pennylane_payload = $2::jsonb,
           validated_by = $3,
           validated_at = NOW(),
           updated_at = NOW()
       WHERE id = $4`,
      [finalStatus, JSON.stringify(payload), req.user.id, invoice.id]
    );
    await client.query(
      `UPDATE purchases p
       SET status = $1, updated_at = NOW()
       WHERE p.id IN (SELECT DISTINCT purchase_id FROM supplier_invoice_matches WHERE supplier_invoice_id = $2 AND purchase_id IS NOT NULL)`,
      [finalStatus, invoice.id]
    );
    await client.query(
      `INSERT INTO supplier_invoice_exports(id, supplier_invoice_id, store_id, export_type, status, payload, created_by)
       VALUES(gen_random_uuid(), $1, $2, 'pennylane_payload', 'ready_to_send', $3::jsonb, $4)`,
      [invoice.id, invoice.store_id, JSON.stringify(payload), req.user.id]
    );

    await client.query('COMMIT');

    let pennylaneStatusSync = null;
    let warning = null;
    if (pennylaneSupplierInvoiceId) {
      try {
        pennylaneStatusSync = await syncValidatedSupplierInvoiceStatusToPennylane({
          invoiceId: invoice.id,
          pennylaneSupplierInvoiceId,
          storeId: invoice.store_id,
        });
        await req.dbPool.query(
          `UPDATE supplier_invoices
           SET pennylane_status = $1,
               updated_at = NOW()
           WHERE id = $2 AND store_id = $3`,
          [VALIDATED_PAYMENT_STATUS, invoice.id, invoice.store_id]
        );
      } catch (syncError) {
        warning = 'Facture validee dans ALTA, mais statut Pennylane non mis a jour';
        await recordPennylaneStatusSyncFailure(req.dbPool, {
          invoice,
          error: syncError,
          userId: req.user.id,
        });
      }
    }

    return res.json({
      ok: true,
      status: finalStatus,
      adjusted_lots: adjustedLots,
      pennylane_status: pennylaneSupplierInvoiceId ? VALIDATED_PAYMENT_STATUS : 'ready_to_send',
      pennylane_status_sync: pennylaneStatusSync,
      warning,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur validation facture fournisseur :', error);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get('/supplier-invoices/:id/pennylane-payload', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const invoice = await getInvoice(req.dbPool, req.params.id, req.user.store_id);
    if (!invoice) return res.status(404).json({ error: 'Facture fournisseur introuvable' });
    const lines = await getInvoiceLines(req.dbPool, invoice.id);
    return res.json(buildPennylanePayload(invoice, lines));
  } catch (error) {
    console.error('Erreur payload Pennylane fournisseur :', error);
    return res.status(500).json({ error: 'Erreur payload Pennylane fournisseur' });
  }
});

module.exports = router;
