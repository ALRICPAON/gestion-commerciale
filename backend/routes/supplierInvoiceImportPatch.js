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
const REVIEW_STATUS = 'draft';
const REVIEW_MATCH_STATUS = 'unmatched';
const QUANTITY_TOLERANCE = 0.001;
const PRICE_TOLERANCE = 0.001;
const AMOUNT_TOLERANCE = 0.05;

fs.mkdirSync(DOCUMENTS_ROOT, { recursive: true });

const upload = multer({
  dest: DOCUMENTS_ROOT,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) return cb(Object.assign(new Error('Format facture fournisseur non supporte'), { status: 400, expose: true }));
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

function parsedPayload(value) {
  return value && typeof value === 'object' ? value : {};
}

function invoiceLotNumber(line) {
  const payload = parsedPayload(line.parsed_payload);
  return clean(line.supplier_lot_number) || clean(payload.supplier_lot_number) || clean(payload.lot) || clean(payload.lot_number);
}

function purchaseMeta(row) {
  return row?.meta_value && typeof row.meta_value === 'object' ? row.meta_value : {};
}

function purchaseLotNumber(line) {
  const meta = purchaseMeta(line);
  return clean(line.purchase_supplier_lot_number) || clean(line.supplier_lot_number) || clean(meta.supplier_lot_number) || clean(meta.lot) || clean(meta.lot_number);
}

function purchaseLineTotalQuantity(line) {
  const unit = String(line.price_unit || 'kg').toLowerCase();
  const colis = Number(line.received_colis || line.ordered_colis || 0);
  const pieces = Number(line.received_pieces || line.ordered_pieces || 0);
  const quantity = Number(line.received_quantity || line.ordered_quantity || 0);
  if (unit === 'colis') return colis;
  if (unit === 'piece') return colis > 0 && pieces > 0 ? colis * pieces : pieces;
  return colis > 0 && quantity > 0 ? colis * quantity : quantity;
}

function invoiceComparableTotal(invoice) {
  return Number(invoice.product_total_ex_vat || invoice.total_ex_vat || 0);
}

function purchaseComparableTotal(purchase) {
  return Number(purchase.received_total_ex_vat || purchase.total_amount_ex_vat || 0);
}

function normalizePurchaseScope(value) {
  if (!value) return null;
  const ids = (Array.isArray(value) ? value : [value]).map(clean).filter(Boolean);
  return ids.length ? ids : null;
}

function reviewPayload({ confidence, matches, differences, proposedPurchaseIds }) {
  return {
    supplier_invoice_review: {
      status: 'pending_human_review',
      confidence,
      matches,
      differences,
      proposed_purchase_ids: proposedPurchaseIds || [],
      requires_human_confirmation: true,
      updated_at: new Date().toISOString(),
    },
  };
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

async function getInvoiceLines(client, invoiceId) {
  const result = await client.query(
    `SELECT sil.*, a.plu article_plu, a.designation article_name
     FROM supplier_invoice_lines sil
     LEFT JOIN articles a ON a.id = sil.article_id
     WHERE sil.supplier_invoice_id = $1
     ORDER BY sil.line_number ASC`,
    [invoiceId]
  );
  return result.rows;
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
     ORDER BY CASE
       WHEN UPPER(regexp_replace(COALESCE(p.bl_number, ''), '\\s+', '', 'g')) = $4 THEN 0
       WHEN UPPER(regexp_replace(regexp_replace(COALESCE(p.source_document_original_name, ''), '[.][^.]*$', ''), '\\s+', '', 'g')) = $4 THEN 1
       ELSE 2
     END, p.receipt_date DESC NULLS LAST
     LIMIT 5`,
    [storeId, invoice.supplier_id, MATCHABLE_PURCHASE_STATUSES, normalized]
  );
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
    [storeId, invoice.supplier_id, MATCHABLE_PURCHASE_STATUSES, invoice.invoice_date || null, dateWindowDays, invoiceComparableTotal(invoice)]
  );
}

async function selectedPurchases(client, invoice, storeId, purchaseIds) {
  const ids = normalizePurchaseScope(purchaseIds);
  if (!ids) return [];
  const result = await client.query(
    `SELECT p.*, COALESCE(SUM(pl.line_amount_ex_vat), 0) received_total_ex_vat
     FROM purchases p
     LEFT JOIN purchase_lines pl ON pl.purchase_id = p.id
     WHERE p.store_id = $1
       AND p.supplier_id = $2
       AND p.status = ANY($3::text[])
       AND p.id = ANY($4::uuid[])
     GROUP BY p.id
     ORDER BY p.receipt_date DESC NULLS LAST`,
    [storeId, invoice.supplier_id, MATCHABLE_PURCHASE_STATUSES, ids]
  );
  return result.rows;
}

async function loadPurchaseLineCandidates(client, invoice, storeId, purchaseScope = null) {
  const purchaseIds = normalizePurchaseScope(purchaseScope);
  const result = await client.query(
    `SELECT pl.*, p.id purchase_id, p.bl_number, p.receipt_date, l.id lot_id,
            plm.meta_value, plm.supplier_lot_number purchase_supplier_lot_number
     FROM purchase_lines pl
     JOIN purchases p ON p.id = pl.purchase_id
     LEFT JOIN lots l ON l.purchase_line_id = pl.id
     LEFT JOIN purchase_line_metadata plm ON plm.purchase_line_id = pl.id AND plm.meta_key = 'gc_line'
     WHERE pl.store_id = $1
       AND p.supplier_id = $2
       AND p.status = ANY($3::text[])
       AND ($4::uuid[] IS NULL OR p.id = ANY($4::uuid[]))
     ORDER BY p.receipt_date DESC NULLS LAST, pl.line_number ASC`,
    [storeId, invoice.supplier_id, MATCHABLE_PURCHASE_STATUSES, purchaseIds]
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

function candidateRank(invoiceLine, purchaseLine, mappedArticleId) {
  const meta = purchaseMeta(purchaseLine);
  const invoiceRef = normalizeSupplierReference(invoiceLine.supplier_reference);
  const directRef = normalizeSupplierReference(purchaseLine.supplier_reference);
  const metaRef = normalizeSupplierReference(meta.supplier_reference);
  const metaLegacyRef = normalizeSupplierReference(meta.refFournisseur);
  const quantityGap = Math.abs(Number(invoiceLine.quantity || 0) - purchaseLineTotalQuantity(purchaseLine));
  const priceGap = Math.abs(Number(invoiceLine.unit_price_ex_vat || 0) - Number(purchaseLine.unit_price_ex_vat || 0));
  const amountGap = Math.abs(Number(invoiceLine.line_amount_ex_vat || 0) - Number(purchaseLine.line_amount_ex_vat || 0));
  const invoiceLot = invoiceLotNumber(invoiceLine);
  const purchaseLot = purchaseLotNumber(purchaseLine);
  const base = { quantityGap, priceGap, amountGap, invoiceLot, purchaseLot };

  if (invoiceLot && purchaseLot && invoiceLot === purchaseLot) return { ...base, rank: 0, reason: 'supplier_lot_number' };
  if (quantityGap <= QUANTITY_TOLERANCE) return { ...base, rank: 1, reason: 'quantity_kg' };
  if (priceGap <= PRICE_TOLERANCE) return { ...base, rank: 2, reason: 'unit_price_ex_vat' };
  if (amountGap <= AMOUNT_TOLERANCE) return { ...base, rank: 3, reason: 'line_amount_ex_vat' };
  if (mappedArticleId && purchaseLine.article_id && String(purchaseLine.article_id) === String(mappedArticleId)) return { ...base, rank: 4, reason: 'supplier_article_mapping' };
  if (invoiceLine.article_id && purchaseLine.article_id && String(invoiceLine.article_id) === String(purchaseLine.article_id)) return { ...base, rank: 4, reason: 'article_id' };
  if (invoiceRef && [directRef, metaRef, metaLegacyRef].includes(invoiceRef)) return { ...base, rank: 5, reason: 'supplier_reference_fallback' };
  return null;
}

async function findPurchaseLineCandidate(client, line, invoice, storeId, purchaseScope, usedIds) {
  const mappedArticleId = await findMappedArticleId(client, invoice, normalizeSupplierReference(line.supplier_reference));
  const used = new Set(usedIds.map((id) => String(id)));
  const candidates = await loadPurchaseLineCandidates(client, invoice, storeId, purchaseScope);
  const ranked = candidates
    .filter((candidate) => !used.has(String(candidate.id)))
    .map((candidate) => {
      const rank = candidateRank(line, candidate, mappedArticleId);
      return rank ? { ...candidate, ...rank } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || a.amountGap - b.amountGap || a.priceGap - b.priceGap || a.quantityGap - b.quantityGap || Number(a.line_number || 0) - Number(b.line_number || 0));

  console.info('Auto-match facture fournisseur: candidats ligne', {
    invoice_id: invoice.id,
    invoice_line_id: line.id,
    supplier_reference: line.supplier_reference,
    invoice_lot: invoiceLotNumber(line),
    purchase_scope: normalizePurchaseScope(purchaseScope),
    loaded_purchase_lines: candidates.length,
    candidate_count: ranked.length,
    candidates: ranked.map((row) => ({
      purchase_line_id: row.id,
      purchase_id: row.purchase_id,
      supplier_reference: row.supplier_reference,
      purchase_lot: purchaseLotNumber(row),
      match_reason: row.reason,
      quantity_gap: row.quantityGap,
      price_gap: row.priceGap,
      amount_gap: row.amountGap,
    })),
  });

  return ranked[0] || null;
}

async function createPurchaseLevelMatch(client, invoice, purchase, storeId, notePrefix) {
  const amountDifference = Number((invoiceComparableTotal(invoice) - purchaseComparableTotal(purchase)).toFixed(4));
  const matchStatus = Math.abs(amountDifference) <= AMOUNT_TOLERANCE ? 'matched' : 'difference';
  await client.query(
    `INSERT INTO supplier_invoice_matches(id, store_id, supplier_invoice_id, purchase_id, match_status, difference_type, amount_difference, notes)
     VALUES(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
    [storeId, invoice.id, purchase.id, matchStatus, matchStatus === 'difference' ? 'amount' : null, amountDifference, `${notePrefix}${purchase.match_reason ? ` (${purchase.match_reason})` : ''}`]
  );
  return { hasDifference: matchStatus === 'difference' };
}

async function insertLineMatches(client, invoice, lines, storeId, purchaseScope) {
  let differences = 0;
  let matches = 0;
  const used = [];
  for (const line of lines) {
    const purchaseLine = await findPurchaseLineCandidate(client, line, invoice, storeId, purchaseScope, used);
    if (!purchaseLine) {
      differences += 1;
      await client.query('UPDATE supplier_invoice_lines SET match_status = $1, match_error = $2 WHERE id = $3', ['missing_purchase_line', 'Aucune ligne reception rapprochable', line.id]);
      continue;
    }
    used.push(purchaseLine.id);
    const qtyDifference = Number((Number(line.quantity || 0) - purchaseLineTotalQuantity(purchaseLine)).toFixed(3));
    const priceDifference = Number((Number(line.unit_price_ex_vat || 0) - Number(purchaseLine.unit_price_ex_vat || 0)).toFixed(4));
    const amountDifference = Number((Number(line.line_amount_ex_vat || 0) - Number(purchaseLine.line_amount_ex_vat || 0)).toFixed(4));
    const hasDifference = Math.abs(qtyDifference) > QUANTITY_TOLERANCE || Math.abs(priceDifference) > PRICE_TOLERANCE || Math.abs(amountDifference) > AMOUNT_TOLERANCE;
    const matchStatus = hasDifference ? 'difference' : 'matched';
    if (hasDifference) differences += 1;
    matches += 1;
    await client.query(
      `INSERT INTO supplier_invoice_matches(
        id, store_id, supplier_invoice_id, supplier_invoice_line_id, purchase_id,
        purchase_line_id, lot_id, match_status, difference_type, quantity_difference,
        price_difference, amount_difference, notes
       ) VALUES(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [storeId, invoice.id, line.id, purchaseLine.purchase_id, purchaseLine.id, purchaseLine.lot_id, matchStatus, hasDifference ? 'line' : null, qtyDifference, priceDifference, amountDifference, hasDifference ? `Proposition avec ecart (${purchaseLine.reason || 'matching'})` : `Proposition OK (${purchaseLine.reason || 'matching'})`]
    );
    await client.query('UPDATE supplier_invoice_lines SET match_status = $1, match_error = $2 WHERE id = $3', [hasDifference ? 'price_difference' : 'matched', hasDifference ? 'Ecart facture/reception a controler' : null, line.id]);
  }
  return { differences, matches };
}

function confidenceLabel({ blPurchase, fallbackCandidateCount, differences, lineCount, lineMatches }) {
  if (fallbackCandidateCount > 1 && !blPurchase) return 'doute';
  if (blPurchase && differences === 0 && lineMatches >= lineCount) return 'sur';
  if (differences === 0) return 'probable';
  return 'doute';
}

async function updateReviewState(client, invoiceId, { confidence, matches, differences, proposedPurchaseIds }) {
  await client.query(
    `UPDATE supplier_invoices
     SET status = $1,
         match_status = $2,
         parsed_payload = COALESCE(parsed_payload, '{}'::jsonb) || $3::jsonb,
         updated_at = NOW()
     WHERE id = $4`,
    [REVIEW_STATUS, REVIEW_MATCH_STATUS, JSON.stringify(reviewPayload({ confidence, matches, differences, proposedPurchaseIds })), invoiceId]
  );
}

async function createMatchProposal(client, invoiceId, storeId, options = {}) {
  const invoice = await getInvoice(client, invoiceId, storeId);
  if (!invoice) return { ok: false, reason: 'invoice_not_found', matches: 0, differences: 0 };
  const invoiceTotal = invoiceComparableTotal(invoice);
  if (invoiceTotal <= 0) return { ok: true, skipped: true, reason: 'zero_total', matches: 0, differences: 0 };

  await client.query('DELETE FROM supplier_invoice_matches WHERE supplier_invoice_id = $1', [invoice.id]);
  const lines = await getInvoiceLines(client, invoice.id);
  const dateWindowDays = Math.max(1, Math.min(Number(options.date_window_days || 7), 45));
  const manualPurchases = await selectedPurchases(client, invoice, storeId, options.purchase_ids);
  const blPurchase = manualPurchases.length ? null : await findPurchaseByInvoiceBl(client, invoice, storeId);
  let fallbackCandidates = { rows: [] };
  if (!blPurchase && !manualPurchases.length) fallbackCandidates = await findPurchaseCandidates(client, invoice, storeId, dateWindowDays);
  const proposedPurchases = manualPurchases.length ? manualPurchases : (blPurchase ? [blPurchase] : fallbackCandidates.rows.slice(0, 1));

  let differences = 0;
  let matches = 0;
  for (const purchase of proposedPurchases) {
    const note = manualPurchases.length ? 'Proposition manuelle de rapprochement' : (blPurchase ? 'Proposition automatique par numero BL facture' : 'Proposition automatique par fournisseur/date/total');
    const purchaseMatch = await createPurchaseLevelMatch(client, invoice, purchase, storeId, note);
    matches += 1;
    if (purchaseMatch.hasDifference) differences += 1;
  }

  const proposedPurchaseIds = proposedPurchases.map((purchase) => purchase.id);
  if (lines.length && proposedPurchaseIds.length) {
    const lineResult = await insertLineMatches(client, invoice, lines, storeId, proposedPurchaseIds);
    matches += lineResult.matches;
    differences += lineResult.differences;
  }

  const confidence = matches > 0 ? confidenceLabel({
    blPurchase,
    fallbackCandidateCount: fallbackCandidates.rows.length,
    differences,
    lineCount: lines.length,
    lineMatches: Math.max(0, matches - proposedPurchases.length),
  }) : 'doute';
  await updateReviewState(client, invoice.id, { confidence, matches, differences, proposedPurchaseIds });

  return {
    ok: true,
    status: REVIEW_STATUS,
    match_status: REVIEW_MATCH_STATUS,
    confidence,
    matches,
    differences,
    proposed_purchase_ids: proposedPurchaseIds,
    requires_human_confirmation: true,
  };
}

async function confirmMatchProposal(client, invoiceId, storeId, body = {}) {
  const invoice = await getInvoice(client, invoiceId, storeId);
  if (!invoice) return { ok: false, statusCode: 404, error: 'Facture fournisseur introuvable' };
  const purchaseIds = normalizePurchaseScope(body.purchase_ids);
  if (purchaseIds) await createMatchProposal(client, invoice.id, storeId, { purchase_ids: purchaseIds, date_window_days: body.date_window_days });

  const summary = await client.query(
    `SELECT COUNT(*)::int match_count,
            COUNT(DISTINCT purchase_id)::int purchase_count,
            COALESCE(SUM(CASE WHEN match_status = 'difference' THEN 1 ELSE 0 END), 0)::int difference_count
     FROM supplier_invoice_matches
     WHERE supplier_invoice_id = $1`,
    [invoice.id]
  );
  const row = summary.rows[0] || {};
  const matches = Number(row.match_count || 0);
  const differences = Number(row.difference_count || 0);
  if (matches <= 0 || Number(row.purchase_count || 0) <= 0) return { ok: false, statusCode: 409, error: 'Aucune proposition de rapprochement a confirmer' };

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
  return { ok: true, status, match_status: matchStatus, matches, differences, confirmed: true };
}

async function matchCandidates(client, invoiceId, storeId, dateWindowDays = 7) {
  const invoice = await getInvoice(client, invoiceId, storeId);
  if (!invoice) return null;
  const blPurchase = await findPurchaseByInvoiceBl(client, invoice, storeId);
  const fallback = await findPurchaseCandidates(client, invoice, storeId, dateWindowDays);
  const byId = new Map();
  if (blPurchase) byId.set(String(blPurchase.id), blPurchase);
  fallback.rows.forEach((row) => byId.set(String(row.id), row));
  const candidates = Array.from(byId.values());
  const lines = candidates.length ? await loadPurchaseLineCandidates(client, invoice, storeId, candidates.map((row) => row.id)) : [];
  const linesByPurchase = new Map();
  lines.forEach((line) => {
    const key = String(line.purchase_id);
    if (!linesByPurchase.has(key)) linesByPurchase.set(key, []);
    linesByPurchase.get(key).push({
      id: line.id,
      line_number: line.line_number,
      supplier_reference: line.supplier_reference,
      supplier_label: line.supplier_label,
      supplier_lot_number: purchaseLotNumber(line),
      quantity_kg: purchaseLineTotalQuantity(line),
      unit_price_ex_vat: Number(line.unit_price_ex_vat || 0),
      line_amount_ex_vat: Number(line.line_amount_ex_vat || 0),
    });
  });
  const invoiceTotal = invoiceComparableTotal(invoice);
  return {
    invoice_id: invoice.id,
    invoice_total_ex_vat: invoiceTotal,
    candidates: candidates.map((purchase) => {
      const amountDifference = Number((invoiceTotal - purchaseComparableTotal(purchase)).toFixed(4));
      const exactBl = ['bl_number', 'source_document_original_name_stem', 'source_document_original_name_contains'].includes(purchase.match_reason);
      const totalExact = Math.abs(amountDifference) <= AMOUNT_TOLERANCE;
      return {
        purchase_id: purchase.id,
        bl_number: purchase.bl_number,
        source_document_original_name: purchase.source_document_original_name,
        receipt_date: purchase.receipt_date,
        status: purchase.status,
        total_ex_vat: purchaseComparableTotal(purchase),
        amount_difference: amountDifference,
        confidence: exactBl && totalExact ? 'sur' : (totalExact ? 'probable' : 'doute'),
        match_reason: purchase.match_reason || 'supplier_date_total',
        lines: linesByPurchase.get(String(purchase.id)) || [],
      };
    }),
  };
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

    const invoice = await client.query(
      `INSERT INTO supplier_invoices(
        id, store_id, client_key, supplier_id, invoice_number, invoice_date, due_date,
        supplier_type, supplier_invoice_bl_number, customer_code, total_ex_vat, product_total_ex_vat,
        fees_ex_vat, vat_amount, total_inc_vat, document_url, notes, parsed_payload, created_by
       ) VALUES(gen_random_uuid(), $1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11, $12, $13, $14, NULL, $15, $16::jsonb, $17)
       RETURNING *`,
      [req.user.store_id, req.user.client_key || null, supplierId, invoiceNumber, clean(req.body.invoice_date) || clean(parsed.invoice_date), clean(req.body.due_date) || clean(parsed.due_date), clean(req.body.supplier_type) || supplier.rows[0].supplier_type || null, clean(parsed.supplier_invoice_bl_number), clean(parsed.customer_code), totalExVat, productTotalExVat, feesExVat, vatAmount, totalIncVat, clean(req.body.notes), JSON.stringify(parsed.parsed_payload || {}), req.user.id]
    );

    const url = invoiceDocumentUrl(invoice.rows[0].id);
    await client.query('UPDATE supplier_invoices SET document_url = $1 WHERE id = $2', [url, invoice.rows[0].id]);
    await client.query(
      `INSERT INTO supplier_invoice_documents(id, supplier_invoice_id, store_id, document_type, original_name, mime_type, storage_path, public_url, uploaded_by)
       VALUES(gen_random_uuid(), $1, $2, 'invoice', $3, $4, $5, $6, $7)`,
      [invoice.rows[0].id, req.user.store_id, req.file.originalname || null, req.file.mimetype || null, req.file.path, url, req.user.id]
    );

    const invoiceLines = jsonLines(req.body.lines).length ? jsonLines(req.body.lines) : parsed.lines || [];
    let lineNumber = 1;
    for (const line of invoiceLines) {
      await client.query(
        `INSERT INTO supplier_invoice_lines(
          id, supplier_invoice_id, store_id, supplier_id, line_number, article_id,
          supplier_reference, supplier_label, quantity, colis, pieces, price_unit,
          unit_price_ex_vat, line_amount_ex_vat, vat_rate, vat_amount, line_amount_inc_vat,
          parsed_payload
         ) VALUES(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, 'kg'), $12, $13, $14, $15, $16, $17::jsonb)`,
        [invoice.rows[0].id, req.user.store_id, supplierId, lineNumber++, clean(line.article_id), clean(line.supplier_reference), clean(line.supplier_label || line.designation), num(line.quantity ?? line.quantity_kg), num(line.colis ?? line.ordered_colis, null), num(line.pieces, null), clean(line.price_unit), num(line.unit_price_ex_vat), num(line.line_amount_ex_vat), num(line.vat_rate), num(line.vat_amount), num(line.line_amount_inc_vat), JSON.stringify(line.parsed_payload || {})]
      );
    }

    await syncInvoiceTotals(client, invoice.rows[0].id);
    const autoMatch = await createMatchProposal(client, invoice.rows[0].id, req.user.store_id, { date_window_days: 7 });
    const finalInvoice = await getInvoice(client, invoice.rows[0].id, req.user.store_id);
    const finalLines = await getInvoiceLines(client, invoice.rows[0].id);
    await client.query('UPDATE supplier_invoices SET pennylane_payload = $1::jsonb WHERE id = $2', [JSON.stringify(buildPennylanePayload(finalInvoice, finalLines)), invoice.rows[0].id]);
    await client.query('COMMIT');
    return res.status(201).json({ ok: true, invoice: finalInvoice, lines: finalLines, parser: { detected: parsedResult.detected, name: parsedResult.parser, message: parsedResult.message }, auto_match: autoMatch, message: autoMatch.matches > 0 ? 'Facture importee, rapprochement propose a controler' : parsedResult.message });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur import facture fournisseur :', error);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get('/supplier-invoices/:id/match-candidates', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const dateWindowDays = Math.max(1, Math.min(Number(req.query.date_window_days || 7), 45));
    const result = await matchCandidates(req.dbPool, req.params.id, req.user.store_id, dateWindowDays);
    if (!result) return res.status(404).json({ error: 'Facture fournisseur introuvable' });
    return res.json(result);
  } catch (error) {
    console.error('Erreur candidats rapprochement facture fournisseur :', error);
    return res.status(500).json({ error: 'Erreur candidats rapprochement facture fournisseur' });
  }
});

router.post('/supplier-invoices/:id/auto-match', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    await client.query('BEGIN');
    const result = await createMatchProposal(client, req.params.id, req.user.store_id, { date_window_days: Math.max(1, Math.min(Number(req.body.date_window_days || 7), 45)) });
    if (!result.ok && result.reason === 'invoice_not_found') {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Facture fournisseur introuvable' });
    }
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

router.post('/supplier-invoices/:id/confirm-match', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    await client.query('BEGIN');
    const result = await confirmMatchProposal(client, req.params.id, req.user.store_id, req.body || {});
    if (!result.ok) {
      await client.query('ROLLBACK');
      return res.status(result.statusCode || 400).json({ error: result.error });
    }
    await client.query('COMMIT');
    return res.json(result);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur confirmation rapprochement facture fournisseur :', error);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.post('/supplier-invoices/:id/validate', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res, next) => {
  try {
    const invoice = await getInvoice(req.dbPool, req.params.id, req.user.store_id);
    if (!invoice) return res.status(404).json({ error: 'Facture fournisseur introuvable' });
    if (!['matched', 'discrepancy'].includes(invoice.match_status)) return res.status(409).json({ error: 'Rapprochement a confirmer avant validation facture', code: 'SUPPLIER_INVOICE_MATCH_CONFIRMATION_REQUIRED', status: invoice.status, match_status: invoice.match_status });
    if (invoice.match_status === 'discrepancy' && req.body.confirm_difference !== true) return res.status(409).json({ error: 'Validation manuelle obligatoire en cas d ecart', code: 'INVOICE_DIFFERENCE_CONFIRMATION_REQUIRED' });
    return next();
  } catch (error) {
    console.error('Erreur garde validation facture fournisseur :', error);
    return res.status(500).json({ error: 'Erreur validation facture fournisseur' });
  }
});

router.delete('/supplier-invoices/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  let documents = [];
  try {
    await client.query('BEGIN');
    const invoice = await getInvoice(client, req.params.id, req.user.store_id);
    if (!invoice) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Facture fournisseur introuvable' });
    }
    const docs = await client.query('SELECT storage_path FROM supplier_invoice_documents WHERE supplier_invoice_id = $1 AND store_id = $2', [invoice.id, req.user.store_id]);
    documents = docs.rows.map((row) => row.storage_path).filter(Boolean);
    const purchases = await client.query('SELECT DISTINCT purchase_id FROM supplier_invoice_matches WHERE supplier_invoice_id = $1 AND purchase_id IS NOT NULL', [invoice.id]);
    const purchaseIds = purchases.rows.map((row) => row.purchase_id).filter(Boolean);
    if (purchaseIds.length) {
      await client.query(
        `UPDATE purchases
         SET status = 'received_pending_invoice', updated_at = NOW()
         WHERE id = ANY($1::uuid[])
           AND store_id = $2
           AND status IN ('invoice_matched', 'invoice_difference')`,
        [purchaseIds, req.user.store_id]
      );
    }
    await client.query('DELETE FROM supplier_invoice_cost_adjustments WHERE supplier_invoice_id = $1', [invoice.id]);
    await client.query('DELETE FROM supplier_invoice_exports WHERE supplier_invoice_id = $1', [invoice.id]);
    await client.query('DELETE FROM supplier_invoice_matches WHERE supplier_invoice_id = $1', [invoice.id]);
    await client.query('DELETE FROM supplier_invoice_lines WHERE supplier_invoice_id = $1', [invoice.id]);
    await client.query('DELETE FROM supplier_invoice_documents WHERE supplier_invoice_id = $1', [invoice.id]);
    await client.query('DELETE FROM supplier_invoices WHERE id = $1 AND store_id = $2', [invoice.id, req.user.store_id]);
    await client.query('COMMIT');
    documents.forEach((storagePath) => fs.unlink(storagePath, (error) => {
      if (error && error.code !== 'ENOENT') console.warn('Impossible de supprimer le fichier facture fournisseur :', storagePath, error.message);
    }));
    return res.json({ ok: true, deleted: true, restored_purchase_ids: purchaseIds });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur suppression facture fournisseur :', error);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
