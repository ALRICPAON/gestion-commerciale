const DOCUMENT_TYPES = new Set(['invoice', 'credit_note']);
const CREDIT_NOTE_REASONS = new Set([
  'commercial_discount',
  'price_error',
  'supplier_return',
  'full_cancellation',
  'other',
]);

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function num(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveAmount(value) {
  return Math.abs(num(value, 0));
}

function normalizeSupplierDocumentType(value) {
  const text = clean(value)?.toLowerCase().replace(/[\s-]+/g, '_') || null;
  if (!text) return null;
  if (['credit_note', 'creditnote', 'supplier_credit_note', 'avoir', 'avoir_fournisseur', 'refund', 'vendor_credit'].includes(text)) {
    return 'credit_note';
  }
  if (['invoice', 'supplier_invoice', 'facture', 'bill'].includes(text)) return 'invoice';
  return DOCUMENT_TYPES.has(text) ? text : null;
}

function normalizeCreditNoteReason(value) {
  const text = clean(value)?.toLowerCase().replace(/[\s-]+/g, '_') || null;
  if (!text) return 'other';
  if (['discount', 'remise', 'ristourne', 'commercial_discount'].includes(text)) return 'commercial_discount';
  if (['price_error', 'pricing_error', 'erreur_prix', 'ecart_prix'].includes(text)) return 'price_error';
  if (['supplier_return', 'retour_fournisseur', 'return'].includes(text)) return 'supplier_return';
  if (['full_cancellation', 'cancellation', 'annulation', 'annulation_totale'].includes(text)) return 'full_cancellation';
  return CREDIT_NOTE_REASONS.has(text) ? text : 'other';
}

function flattenObject(value, depth = 0, output = []) {
  if (!value || typeof value !== 'object' || depth > 4) return output;
  for (const [key, entry] of Object.entries(value)) {
    output.push({ key, value: entry });
    if (entry && typeof entry === 'object') flattenObject(entry, depth + 1, output);
  }
  return output;
}

function explicitDocumentTypeFromPayload(payload) {
  const explicitKeys = new Set([
    'document_type',
    'invoice_type',
    'type',
    'kind',
    'document_kind',
    'billing_type',
  ]);
  for (const entry of flattenObject(payload)) {
    if (!explicitKeys.has(String(entry.key).toLowerCase())) continue;
    const type = normalizeSupplierDocumentType(entry.value);
    if (type) return type;
  }
  return null;
}

function metadataDocumentTypeFromPayload(payload) {
  for (const entry of flattenObject(payload)) {
    const key = String(entry.key || '').toLowerCase();
    const value = String(entry.value ?? '').toLowerCase();
    if (['is_credit_note', 'credit_note', 'is_refund'].includes(key) && ['true', '1', 'yes'].includes(value)) {
      return 'credit_note';
    }
    if (!/(status|metadata|nature|category|label)/i.test(key)) continue;
    const type = normalizeSupplierDocumentType(value);
    if (type) return type;
  }
  return null;
}

function detectPennylaneSupplierDocumentType(payload = {}, amounts = {}) {
  return explicitDocumentTypeFromPayload(payload)
    || metadataDocumentTypeFromPayload(payload)
    || (num(amounts.amount_ex_vat ?? amounts.amount_inc_vat ?? payload.amount_before_tax ?? payload.amount, 0) < 0 ? 'credit_note' : 'invoice');
}

function isSupplierCreditNote(invoice = {}) {
  return normalizeSupplierDocumentType(invoice.document_type) === 'credit_note';
}

function signedFinancialAmount(invoice = {}, field = 'total_ex_vat') {
  const amount = positiveAmount(invoice[field]);
  return isSupplierCreditNote(invoice) ? -amount : amount;
}

function supplierOutstandingFromDocuments(documents = []) {
  return documents.reduce((sum, document) => {
    const status = clean(document.status);
    const affected = !isSupplierCreditNote(document)
      || clean(document.source_supplier_invoice_id)
      || clean(document.source_purchase_id)
      || document.applied === true;
    if (!['invoice_validated', 'cost_adjusted', 'sent_to_pennylane', 'validee_a_payer', 'payee'].includes(status)) return sum;
    if (!affected) return sum;
    return sum + signedFinancialAmount(document, 'total_ex_vat');
  }, 0);
}

async function createCreditNoteApplication(client, {
  storeId,
  creditNoteInvoiceId,
  sourceSupplierInvoiceId = null,
  sourcePurchaseId = null,
  applicationType = 'financial',
  amountExVat = 0,
  notes = null,
  userId = null,
}) {
  const type = applicationType === 'supplier_return' ? 'supplier_return' : 'financial';
  const result = await client.query(
    `INSERT INTO supplier_credit_note_applications(
       id, store_id, credit_note_invoice_id, source_supplier_invoice_id, source_purchase_id,
       application_type, amount_ex_vat, notes, created_by
     )
     VALUES(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (store_id, credit_note_invoice_id, (COALESCE(source_supplier_invoice_id, '00000000-0000-0000-0000-000000000000'::uuid)), (COALESCE(source_purchase_id, '00000000-0000-0000-0000-000000000000'::uuid)), application_type)
     DO UPDATE SET amount_ex_vat = EXCLUDED.amount_ex_vat, notes = EXCLUDED.notes, updated_at = NOW()
     RETURNING *`,
    [storeId, creditNoteInvoiceId, sourceSupplierInvoiceId, sourcePurchaseId, type, positiveAmount(amountExVat), clean(notes), userId]
  );
  return result.rows[0];
}

async function registerSupplierReturn(client, {
  storeId,
  creditNoteInvoiceId,
  purchaseId,
  purchaseLineId,
  lotId,
  quantity,
  notes = null,
  userId = null,
}) {
  const qty = num(quantity, 0);
  if (qty <= 0) {
    const error = new Error('Quantite retour fournisseur obligatoire');
    error.status = 400;
    throw error;
  }

  const credit = await client.query(
    `SELECT *
     FROM supplier_invoices
     WHERE id = $1 AND store_id = $2
     FOR UPDATE`,
    [creditNoteInvoiceId, storeId]
  );
  const creditNote = credit.rows[0];
  if (!creditNote || !isSupplierCreditNote(creditNote)) {
    const error = new Error('Avoir fournisseur introuvable');
    error.status = 404;
    throw error;
  }
  if (normalizeCreditNoteReason(creditNote.credit_note_reason) !== 'supplier_return') {
    const error = new Error('Le motif supplier_return est requis pour un retour stock fournisseur');
    error.status = 409;
    throw error;
  }

  const lot = await client.query(
    `SELECT l.*, pl.id purchase_line_id, pl.purchase_id, pl.article_id, pl.supplier_id
     FROM lots l
     JOIN purchase_lines pl ON pl.id = l.purchase_line_id
     WHERE l.id = $1
       AND l.store_id = $2
       AND pl.id = $3
       AND pl.purchase_id = $4
     FOR UPDATE`,
    [lotId, storeId, purchaseLineId, purchaseId]
  );
  const row = lot.rows[0];
  if (!row) {
    const error = new Error('Lot achat introuvable pour le retour fournisseur');
    error.status = 404;
    throw error;
  }
  if (num(row.qty_remaining, 0) < qty) {
    const error = new Error('Quantite retour superieure au stock disponible du lot');
    error.status = 409;
    throw error;
  }

  await client.query('UPDATE lots SET qty_remaining = qty_remaining - $1, updated_at = NOW() WHERE id = $2', [qty, row.id]);
  const movement = await client.query(
    `INSERT INTO stock_movements(
       id, store_id, client_key, article_id, lot_id, movement_type, quantity,
       unit_cost_ex_vat, source_table, source_id, notes, created_by
     )
     VALUES(gen_random_uuid(), $1, $2, $3, $4, 'supplier_return', $5, $6, 'supplier_credit_note_returns', $7, $8, $9)
     RETURNING *`,
    [storeId, row.client_key || creditNote.client_key || null, row.article_id, row.id, -qty, num(row.unit_cost_ex_vat, 0), creditNote.id, clean(notes) || `Retour fournisseur avoir ${creditNote.invoice_number}`, userId]
  );
  const returnRow = await client.query(
    `INSERT INTO supplier_credit_note_returns(
       id, store_id, credit_note_invoice_id, purchase_id, purchase_line_id, lot_id,
       article_id, supplier_id, quantity, unit_cost_ex_vat, movement_id, notes, created_by
     )
     VALUES(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [storeId, creditNote.id, purchaseId, purchaseLineId, row.id, row.article_id, row.supplier_id, qty, num(row.unit_cost_ex_vat, 0), movement.rows[0].id, clean(notes), userId]
  );
  await client.query(
    `UPDATE supplier_invoices
     SET stock_effect = 'supplier_return',
         source_purchase_id = COALESCE(source_purchase_id, $2),
         updated_at = NOW()
     WHERE id = $1`,
    [creditNote.id, purchaseId]
  );

  return { return: returnRow.rows[0], movement: movement.rows[0] };
}

module.exports = {
  CREDIT_NOTE_REASONS,
  DOCUMENT_TYPES,
  clean,
  detectPennylaneSupplierDocumentType,
  isSupplierCreditNote,
  normalizeCreditNoteReason,
  normalizeSupplierDocumentType,
  positiveAmount,
  registerSupplierReturn,
  signedFinancialAmount,
  supplierOutstandingFromDocuments,
  createCreditNoteApplication,
};
