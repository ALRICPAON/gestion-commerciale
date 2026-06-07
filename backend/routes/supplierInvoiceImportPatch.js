const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const { parseSupplierInvoice } = require('../services/supplier-invoices/import-supplier-invoice');

const router = express.Router();
const DOCUMENTS_ROOT = path.join(__dirname, '..', 'uploads', 'supplier-invoices');
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.xlsx', '.xls', '.csv']);
const MATCHABLE_PURCHASE_STATUSES = ['received', 'received_pending_invoice', 'invoice_difference', 'invoice_matched'];

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
  const cleaned = String(value).replace(/[\u00A0\u202F\u2009\u2002\u2003\s€]/g, '').replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function providedPositive(value) {
  return value !== undefined && value !== null && value !== '' && num(value, 0) > 0;
}

function pickNumber(bodyValue, parsedValue, fallback = 0) {
  if (providedPositive(bodyValue)) return num(bodyValue, fallback);
  if (parsedValue !== undefined && parsedValue !== null && parsedValue !== '') return num(parsedValue, fallback);
  return fallback;
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

function normalizeSupplierReference(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
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
      colis: Number(line.colis || 0),
      unit_price_ex_vat: Number(line.unit_price_ex_vat || 0),
      line_amount_ex_vat: Number(line.line_amount_ex_vat || 0),
      vat_rate: Number(line.vat_rate || 0),
      vat_amount: Number(line.vat_amount || 0),
      parsed_payload: line.parsed_payload || {},
    })),
  };
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
     SET product_total_ex_vat = COALESCE(NULLIF(si.product_total_ex_vat, 0), x.total_ex_vat, 0),
         total_ex_vat = COALESCE(NULLIF(si.total_ex_vat, 0), COALESCE(x.total_ex_vat, 0) + COALESCE(si.fees_ex_vat, 0), 0),
         vat_amount = COALESCE(NULLIF(si.vat_amount, 0), x.vat_amount, 0),
         total_inc_vat = COALESCE(NULLIF(si.total_inc_vat, 0), COALESCE(x.total_inc_vat, 0) + COALESCE(si.fees_ex_vat, 0), 0),
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

async function findPurchaseByInvoiceBl(client, invoice, storeId) {
  const blNumber = clean(invoice.supplier_invoice_bl_number);
  if (!blNumber) return null;
  const normalized = blNumber.replace(/\s+/g, '').toUpperCase();
  const result = await client.query(
    `SELECT p.*, COALESCE(SUM(pl.line_amount_ex_vat), 0) received_total_ex_vat,
            CASE
              WHEN UPPER(regexp_replace(COALESCE(p.bl_number, ''), '\\s+', '', 'g')) = $4 THEN 'bl_number'
              WHEN UPPER(regexp_replace(regexp_replace(COALESCE(p.source_document_original_name, ''), '[.][^.]*$', ''), '\\s+', '', 'g')) = $4 THEN 'source_document_original_name_stem'
              ELSE 'source_document_original_name_contains'
            END AS match_reason
     FROM purchases p
     LEFT JOIN purchase_lines pl ON pl.purchase_id = p.id
     WHERE p.store_id = $1
       AND p.supplier_id = $2
       AND p.status = ANY($3::text[])
       AND (
         UPPER(regexp_replace(COALESCE(p.bl_number, ''), '\\s+', '', 'g')) = $4
         OR UPPER(regexp_replace(regexp_replace(COALESCE(p.source_document_original_name, ''), '[.][^.]*$', ''), '\\s+', '', 'g')) = $4
         OR UPPER(regexp_replace(COALESCE(p.source_document_original_name, ''), '\\s+', '', 'g')) LIKE '%' || $4 || '%'
       )
     GROUP BY p.id
     ORDER BY
       CASE
         WHEN UPPER(regexp_replace(COALESCE(p.bl_number, ''), '\\s+', '', 'g')) = $4 THEN 0
         WHEN UPPER(regexp_replace(regexp_replace(COALESCE(p.source_document_original_name, ''), '[.][^.]*$', ''), '\\s+', '', 'g')) = $4 THEN 1
         ELSE 2
       END,
       p.receipt_date DESC NULLS LAST
     LIMIT 5`,
    [storeId, invoice.supplier_id, MATCHABLE_PURCHASE_STATUSES, normalized]
  );

  console.info('Auto-match facture fournisseur: recherche BL', {
    invoice_id: invoice.id,
    supplier_invoice_bl_number: blNumber,
    normalized_bl_number: normalized,
    supplier_id: invoice.supplier_id,
    store_id: storeId,
    candidate_count: result.rows.length,
    candidates: result.rows.map((row) => ({
      purchase_id: row.id,
      bl_number: row.bl_number,
      source_document_original_name: row.source_document_original_name,
      status: row.status,
      total_amount_ex_vat: row.total_amount_ex_vat,
      received_total_ex_vat: row.received_total_ex_vat,
      match_reason: row.match_reason,
    })),
  });

  return result.rows[0] || null;
}

async function findPurchaseCandidates(client, invoice, storeId, dateWindowDays) {
  return client.query(
    `SELECT p.*, COALESCE(SUM(pl.line_amount_ex_vat), 0) received_total_ex_vat
     FROM purchases p
     LEFT JOIN purchase_lines pl ON pl.purchase_id = p.id
     WHERE p.store_id = $1
       AND p.supplier_id = $2
       AND p.status = ANY($3::text[])
       AND ($4::date IS NULL OR p.receipt_date BETWEEN ($4::date - ($5::int || ' days')::interval) AND ($4::date + ($5::int || ' days')::interval))
     GROUP BY p.id
     ORDER BY ABS(COALESCE(p.total_amount_ex_vat, 0) - $6::numeric) ASC, p.receipt_date DESC NULLS LAST
     LIMIT 20`,
    [storeId, invoice.supplier_id, MATCHABLE_PURCHASE_STATUSES, invoice.invoice_date || null, dateWindowDays, Number(invoice.product_total_ex_vat || invoice.total_ex_vat || 0)]
  );
}

async function loadPurchaseLineCandidates(client, invoice, storeId, purchaseId = null) {
  const result = await client.query(
    `SELECT pl.*, p.id purchase_id, p.bl_number, p.receipt_date, l.id lot_id, plm.meta_value
     FROM purchase_lines pl
     JOIN purchases p ON p.id = pl.purchase_id
     LEFT JOIN lots l ON l.purchase_line_id = pl.id
     LEFT JOIN purchase_line_metadata plm ON plm.purchase_line_id = pl.id AND plm.meta_key = 'gc_line'
     WHERE pl.store_id = $1
       AND p.supplier_id = $2
       AND p.status = ANY($3::text[])
       AND ($4::uuid IS NULL OR p.id = $4::uuid)
     ORDER BY p.receipt_date DESC NULLS LAST, pl.line_number ASC`,
    [storeId, invoice.supplier_id, MATCHABLE_PURCHASE_STATUSES, purchaseId]
  );
  return result.rows;
}

async function findMappedArticleId(client, invoice, normalizedRef) {
  if (!normalizedRef) return null;
  const result = await client.query(
    `SELECT m.article_id
     FROM supplier_article_mappings m
     WHERE m.supplier_id = $1
       AND COALESCE(m.is_active, true) = true
       AND regexp_replace(UPPER(COALESCE(m.supplier_ref, '')), '[^A-Z0-9]', '', 'g') = $2
     LIMIT 1`,
    [invoice.supplier_id, normalizedRef]
  ).catch(() => ({ rows: [] }));
  return result.rows[0]?.article_id || null;
}

function metaValue(row) {
  return row?.meta_value && typeof row.meta_value === 'object' ? row.meta_value : {};
}

function purchaseLineMatchRank(invoiceLine, purchaseLine, mappedArticleId) {
  const invoiceRef = normalizeSupplierReference(invoiceLine.supplier_reference);
  const meta = metaValue(purchaseLine);
  const directRef = normalizeSupplierReference(purchaseLine.supplier_reference);
  const metaSupplierRef = normalizeSupplierReference(meta.supplier_reference);
  const metaLegacyRef = normalizeSupplierReference(meta.refFournisseur);

  if (invoiceRef && directRef === invoiceRef) return { rank: 0, reason: 'supplier_reference' };
  if (invoiceRef && metaSupplierRef === invoiceRef) return { rank: 1, reason: 'metadata_supplier_reference' };
  if (invoiceRef && metaLegacyRef === invoiceRef) return { rank: 1, reason: 'metadata_ref_fournisseur' };
  if (mappedArticleId && purchaseLine.article_id && String(purchaseLine.article_id) === String(mappedArticleId)) return { rank: 2, reason: 'supplier_article_mapping' };
  if (invoiceLine.article_id && purchaseLine.article_id && String(purchaseLine.article_id) === String(invoiceLine.article_id)) return { rank: 3, reason: 'article_id' };
  return null;
}

async function findPurchaseLineCandidate(client, line, invoice, storeId, purchaseId = null, usedPurchaseLineIds = []) {
  const normalizedRef = normalizeSupplierReference(line.supplier_reference);
  const mappedArticleId = await findMappedArticleId(client, invoice, normalizedRef);
  const candidates = await loadPurchaseLineCandidates(client, invoice, storeId, purchaseId);
  const used = new Set(usedPurchaseLineIds.map((id) => String(id)));

  const ranked = candidates
    .filter((candidate) => !used.has(String(candidate.id)))
    .map((candidate) => {
      const match = purchaseLineMatchRank(line, candidate, mappedArticleId);
      if (!match) return null;
      return {
        ...candidate,
        match_reason: match.reason,
        match_rank: match.rank,
        amount_gap: Math.abs(Number(candidate.line_amount_ex_vat || 0) - Number(line.line_amount_ex_vat || 0)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.match_rank - b.match_rank || a.amount_gap - b.amount_gap || Number(a.line_number || 0) - Number(b.line_number || 0));

  console.info('Auto-match facture fournisseur: candidats ligne', {
    invoice_id: invoice.id,
    invoice_line_id: line.id,
    supplier_reference: line.supplier_reference,
    normalized_supplier_reference: normalizedRef,
    purchase_id: purchaseId,
    loaded_purchase_lines: candidates.length,
    candidate_count: ranked.length,
    candidates: ranked.map((row) => ({
      purchase_line_id: row.id,
      supplier_reference: row.supplier_reference,
      article_id: row.article_id,
      line_amount_ex_vat: row.line_amount_ex_vat,
      match_reason: row.match_reason,
      match_rank: row.match_rank,
    })),
  });

  return ranked[0] || null;
}

function purchaseLineTotalQuantity(line) {
  const unit = String(line.price_unit || 'kg').toLowerCase();
  const receivedColis = Number(line.received_colis || line.ordered_colis || 0);
  const receivedPieces = Number(line.received_pieces || line.ordered_pieces || 0);
  const receivedQuantity = Number(line.received_quantity || line.ordered_quantity || 0);

  if (unit === 'colis') return receivedColis;
  if (unit === 'piece') return receivedColis > 0 && receivedPieces > 0 ? receivedColis * receivedPieces : receivedPieces;
  return receivedColis > 0 && receivedQuantity > 0 ? receivedColis * receivedQuantity : receivedQuantity;
}

async function createPurchaseLevelMatch(client, invoice, purchase, storeId, notePrefix) {
  const invoiceTotal = Number(invoice.product_total_ex_vat || invoice.total_ex_vat || 0);
  const purchaseTotal = Number(purchase.received_total_ex_vat || purchase.total_amount_ex_vat || 0);
  const amountDifference = Number((invoiceTotal - purchaseTotal).toFixed(4));
  const matchStatus = Math.abs(amountDifference) <= 0.05 ? 'matched' : 'difference';

  await client.query(
    `INSERT INTO supplier_invoice_matches(id, store_id, supplier_invoice_id, purchase_id, match_status, difference_type, amount_difference, notes)
     VALUES(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
    [
      storeId,
      invoice.id,
      purchase.id,
      matchStatus,
      matchStatus === 'difference' ? 'amount' : null,
      amountDifference,
      `${notePrefix}${purchase.match_reason ? ` (${purchase.match_reason})` : ''}`,
    ]
  );

  return {
    amountDifference,
    matchStatus,
    hasDifference: matchStatus === 'difference',
  };
}

async function autoMatchInvoice(client, invoiceId, storeId, dateWindowDays = 7) {
  const invoice = await getInvoice(client, invoiceId, storeId);
  if (!invoice) return { ok: false, reason: 'invoice_not_found', matches: 0, differences: 0 };

  const invoiceTotal = Number(invoice.product_total_ex_vat || invoice.total_ex_vat || 0);
  console.info('Auto-match facture fournisseur: debut', {
    invoice_id: invoice.id,
    supplier_invoice_bl_number: invoice.supplier_invoice_bl_number,
    supplier_id: invoice.supplier_id,
    store_id: storeId,
    invoice_total_ex_vat: invoiceTotal,
    status: invoice.status,
    match_status: invoice.match_status,
  });

  if (invoiceTotal <= 0) {
    console.info('Auto-match facture fournisseur: ignore total nul', { invoice_id: invoice.id });
    return { ok: true, skipped: true, reason: 'zero_total', matches: 0, differences: 0 };
  }

  await client.query('DELETE FROM supplier_invoice_matches WHERE supplier_invoice_id = $1', [invoice.id]);

  const lines = await getInvoiceLines(client, invoice.id);
  const blPurchase = await findPurchaseByInvoiceBl(client, invoice, storeId);
  let candidates = { rows: [] };
  if (!blPurchase) candidates = await findPurchaseCandidates(client, invoice, storeId, dateWindowDays);

  console.info('Auto-match facture fournisseur: candidats fallback', {
    invoice_id: invoice.id,
    bl_purchase_found: Boolean(blPurchase),
    fallback_candidate_count: candidates.rows.length,
    fallback_candidates: candidates.rows.map((row) => ({
      purchase_id: row.id,
      bl_number: row.bl_number,
      source_document_original_name: row.source_document_original_name,
      status: row.status,
      total_amount_ex_vat: row.total_amount_ex_vat,
      received_total_ex_vat: row.received_total_ex_vat,
    })),
  });

  let differences = 0;
  let matches = 0;
  const usedPurchaseLineIds = [];

  if (blPurchase) {
    const purchaseMatch = await createPurchaseLevelMatch(client, invoice, blPurchase, storeId, 'Rapprochement automatique par numero BL facture');
    matches += 1;
    if (purchaseMatch.hasDifference) differences += 1;
  } else if (!lines.length) {
    const purchase = candidates.rows[0];
    if (purchase) {
      const purchaseMatch = await createPurchaseLevelMatch(client, invoice, purchase, storeId, 'Rapprochement automatique par fournisseur/date/total');
      matches += 1;
      if (purchaseMatch.hasDifference) differences += 1;
    }
  }

  if (!blPurchase && !candidates.rows.length) {
    console.info('Auto-match facture fournisseur: aucun purchase candidat', {
      invoice_id: invoice.id,
      supplier_invoice_bl_number: invoice.supplier_invoice_bl_number,
      supplier_id: invoice.supplier_id,
      store_id: storeId,
      status_filter: MATCHABLE_PURCHASE_STATUSES,
    });
  }

  for (const line of lines) {
    let purchaseLine = await findPurchaseLineCandidate(client, line, invoice, storeId, blPurchase?.id || null, usedPurchaseLineIds);
    if (!purchaseLine && blPurchase?.id) {
      purchaseLine = await findPurchaseLineCandidate(client, line, invoice, storeId, null, usedPurchaseLineIds);
    }

    if (!purchaseLine) {
      differences += 1;
      await client.query('UPDATE supplier_invoice_lines SET match_status = $1, match_error = $2 WHERE id = $3', ['missing_purchase_line', 'Aucune ligne reception rapprochable par reference fournisseur, mapping ou article', line.id]);
      console.info('Auto-match facture fournisseur: ligne sans candidat', {
        invoice_id: invoice.id,
        invoice_line_id: line.id,
        supplier_reference: line.supplier_reference,
        article_id: line.article_id,
        line_amount_ex_vat: line.line_amount_ex_vat,
      });
      continue;
    }

    usedPurchaseLineIds.push(purchaseLine.id);

    const purchaseQuantity = purchaseLineTotalQuantity(purchaseLine);
    const qtyDifference = Number((Number(line.quantity || 0) - purchaseQuantity).toFixed(3));
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
        storeId,
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
        hasDifference ? `Ecart detecte automatiquement (${purchaseLine.match_reason || 'matching'})` : `Rapprochement automatique OK (${purchaseLine.match_reason || 'matching'})`,
      ]
    );

    await client.query(
      'UPDATE supplier_invoice_lines SET match_status = $1, match_error = $2 WHERE id = $3',
      [hasDifference ? 'price_difference' : 'matched', hasDifference ? 'Ecart facture/reception' : null, line.id]
    );
  }

  if (matches > 0) {
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
    console.info('Auto-match facture fournisseur: resultat', {
      invoice_id: invoice.id,
      status,
      match_status: matchStatus,
      matches,
      differences,
      matched_by_bl: Boolean(blPurchase),
    });
    return { ok: true, status, match_status: matchStatus, matches, differences, matched_by_bl: Boolean(blPurchase) };
  }

  console.info('Auto-match facture fournisseur: aucun match cree', { invoice_id: invoice.id });
  return { ok: true, status: invoice.status, match_status: invoice.match_status, matches, differences, matched_by_bl: false };
}

router.post('/supplier-invoices/import', authenticateToken, attachDbContext, requireAdminOrManager, upload.single('document'), async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    if (!req.file) return res.status(400).json({ error: 'Document facture obligatoire' });

    const parsedResult = await parseSupplierInvoice(req.file).catch((error) => {
      console.warn('Parser facture fournisseur indisponible :', error);
      return { detected: false, parser: null, message: 'Document importé mais aucun parser disponible', invoice: null };
    });
    const parsed = parsedResult.invoice || {};

    await client.query('BEGIN');
    const supplierId = clean(req.body.supplier_id);
    const invoiceNumber = clean(req.body.invoice_number) || clean(parsed.invoice_number) || path.parse(req.file.originalname || req.file.filename).name;
    if (!supplierId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'supplier_id obligatoire' });
    }

    const supplier = await client.query('SELECT id, supplier_type FROM suppliers WHERE id = $1 AND store_id = $2 LIMIT 1', [supplierId, req.user.store_id]);
    if (!supplier.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Fournisseur invalide' });
    }

    const productTotalExVat = pickNumber(req.body.product_total_ex_vat, parsed.product_total_ex_vat, 0);
    const feesExVat = num(req.body.fees_ex_vat, 0);
    const totalExVat = pickNumber(req.body.total_ex_vat, parsed.total_ex_vat || productTotalExVat + feesExVat, productTotalExVat + feesExVat);
    const vatAmount = pickNumber(req.body.vat_amount, parsed.vat_amount, 0);
    const totalIncVat = pickNumber(req.body.total_inc_vat, parsed.total_inc_vat, totalExVat + vatAmount);
    const parsedPayload = parsed.parsed_payload || {};

    const invoice = await client.query(
      `INSERT INTO supplier_invoices(
        id, store_id, client_key, supplier_id, invoice_number, invoice_date, due_date,
        supplier_type, supplier_invoice_bl_number, customer_code, total_ex_vat, product_total_ex_vat,
        fees_ex_vat, vat_amount, total_inc_vat, document_url, notes, parsed_payload, created_by
       )
       VALUES(gen_random_uuid(), $1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11, $12, $13, $14, NULL, $15, $16::jsonb, $17)
       RETURNING *`,
      [
        req.user.store_id,
        req.user.client_key || null,
        supplierId,
        invoiceNumber,
        clean(req.body.invoice_date) || clean(parsed.invoice_date),
        clean(req.body.due_date) || clean(parsed.due_date),
        clean(req.body.supplier_type) || supplier.rows[0].supplier_type || null,
        clean(parsed.supplier_invoice_bl_number),
        clean(parsed.customer_code),
        totalExVat,
        productTotalExVat,
        feesExVat,
        vatAmount,
        totalIncVat,
        clean(req.body.notes),
        JSON.stringify(parsedPayload),
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

    const lines = jsonLines(req.body.lines);
    const invoiceLines = lines.length ? lines : parsed.lines || [];
    let lineNumber = 1;
    for (const line of invoiceLines) {
      await client.query(
        `INSERT INTO supplier_invoice_lines(
          id, supplier_invoice_id, store_id, supplier_id, line_number, article_id,
          supplier_reference, supplier_label, quantity, colis, pieces, price_unit,
          unit_price_ex_vat, line_amount_ex_vat, vat_rate, vat_amount, line_amount_inc_vat,
          parsed_payload
         )
         VALUES(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, 'kg'), $12, $13, $14, $15, $16, $17::jsonb)`,
        [
          invoice.rows[0].id,
          req.user.store_id,
          supplierId,
          lineNumber++,
          clean(line.article_id),
          clean(line.supplier_reference),
          clean(line.supplier_label || line.designation),
          num(line.quantity ?? line.quantity_kg),
          num(line.colis ?? line.ordered_colis, null),
          num(line.pieces, null),
          clean(line.price_unit),
          num(line.unit_price_ex_vat),
          num(line.line_amount_ex_vat),
          num(line.vat_rate),
          num(line.vat_amount),
          num(line.line_amount_inc_vat),
          JSON.stringify(line.parsed_payload || {}),
        ]
      );
    }

    await syncInvoiceTotals(client, invoice.rows[0].id);
    const autoMatch = await autoMatchInvoice(client, invoice.rows[0].id, req.user.store_id, 7);
    const finalInvoice = await getInvoice(client, invoice.rows[0].id, req.user.store_id);
    const finalLines = await getInvoiceLines(client, invoice.rows[0].id);
    const payload = buildPennylanePayload(finalInvoice, finalLines);
    await client.query('UPDATE supplier_invoices SET pennylane_payload = $1::jsonb WHERE id = $2', [JSON.stringify(payload), invoice.rows[0].id]);

    await client.query('COMMIT');
    return res.status(201).json({
      ok: true,
      invoice: finalInvoice,
      lines: finalLines,
      parser: {
        detected: parsedResult.detected,
        name: parsedResult.parser,
        message: parsedResult.message,
      },
      auto_match: autoMatch,
      message: parsedResult.message,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur import facture fournisseur :', error);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
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

    const dateWindowDays = Math.max(1, Math.min(Number(req.body.date_window_days || 7), 45));
    const result = await autoMatchInvoice(client, invoice.id, req.user.store_id, dateWindowDays);
    await client.query('COMMIT');
    return res.json(result);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur rapprochement facture fournisseur :', error);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
