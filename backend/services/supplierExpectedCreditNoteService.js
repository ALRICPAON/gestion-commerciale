const EXPECTED_CREDIT_NOTE_STATUSES = new Set(['pending', 'matched', 'resolved', 'cancelled', 'disputed']);
const EXPECTED_CREDIT_NOTE_REASON_TYPES = new Set([
  'price_error',
  'quality_issue',
  'quantity_issue',
  'missing_goods',
  'supplier_return',
  'other',
]);
const DEFAULT_AMOUNT_TOLERANCE = 1;
const DEFAULT_AMOUNT_RATIO_TOLERANCE = 0.005;

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function toNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(toNumber(value) * factor) / factor;
}

function amountTolerance(amount) {
  const absoluteTolerance = Number(process.env.PENNYLANE_SUPPLIER_GLOBAL_AMOUNT_TOLERANCE) || DEFAULT_AMOUNT_TOLERANCE;
  const ratioTolerance = Number(process.env.PENNYLANE_SUPPLIER_GLOBAL_AMOUNT_RATIO_TOLERANCE) || DEFAULT_AMOUNT_RATIO_TOLERANCE;
  return Math.max(absoluteTolerance, Math.abs(toNumber(amount)) * ratioTolerance);
}

function documentAmount(document = {}) {
  return Math.abs(toNumber(document.amount_ex_vat ?? document.currency_amount_ex_vat));
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function daysBetween(left, right) {
  const leftDate = dateOnly(left);
  const rightDate = dateOnly(right);
  if (!leftDate || !rightDate) return null;
  return Math.abs(Date.parse(`${leftDate}T00:00:00Z`) - Date.parse(`${rightDate}T00:00:00Z`)) / 86400000;
}

function expectedCreditNoteError(message, status, code, details = undefined) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function creditNoteEventKey(type, id) {
  return `${type}:${id}`;
}

async function insertSupplierControlEvent(client, { storeId, documentId, eventType, eventKey, payload = {}, userId = null }) {
  if (!documentId) return false;
  const result = await client.query(
    `
    INSERT INTO supplier_control_events(
      id, store_id, pennylane_supplier_invoice_id, event_type, event_key, payload, created_by
    )
    VALUES(gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6)
    ON CONFLICT DO NOTHING
    `,
    [storeId, documentId, eventType, eventKey, JSON.stringify(payload), userId]
  );
  return result.rowCount !== 0;
}

async function loadPurchase(client, { storeId, purchaseId, forUpdate = false }) {
  if (!purchaseId) return null;
  const result = await client.query(
    `
    SELECT p.*, s.name AS supplier_name, s.code AS supplier_code
    FROM purchases p
    LEFT JOIN suppliers s
      ON s.id = p.supplier_id
     AND s.store_id = p.store_id
    WHERE p.id = $1
      AND p.store_id = $2
    LIMIT 1
    ${forUpdate ? 'FOR UPDATE OF p' : ''}
    `,
    [purchaseId, storeId]
  );
  return result.rows[0] || null;
}

async function loadPurchaseLine(client, { storeId, purchaseId, purchaseLineId }) {
  if (!purchaseLineId) return null;
  const result = await client.query(
    `
    SELECT pl.*, a.designation AS article_name, a.plu AS article_plu
    FROM purchase_lines pl
    LEFT JOIN articles a
      ON a.id = pl.article_id
     AND a.store_id = pl.store_id
    WHERE pl.id = $1
      AND pl.purchase_id = $2
      AND pl.store_id = $3
    LIMIT 1
    `,
    [purchaseLineId, purchaseId, storeId]
  );
  return result.rows[0] || null;
}

async function loadPennylaneDocument(client, { storeId, documentId, forUpdate = false }) {
  if (!documentId) return null;
  const result = await client.query(
    `
    SELECT psi.*, s.name AS supplier_name, s.code AS supplier_code
    FROM pennylane_supplier_invoices psi
    LEFT JOIN suppliers s
      ON s.id = psi.supplier_id
     AND s.store_id = psi.store_id
    WHERE psi.id = $1
      AND psi.store_id = $2
      AND psi.pennylane_deleted_at IS NULL
    LIMIT 1
    ${forUpdate ? 'FOR UPDATE OF psi' : ''}
    `,
    [documentId, storeId]
  );
  return result.rows[0] || null;
}

async function loadExpectedCreditNoteById(client, { storeId, expectedCreditNoteId, forUpdate = false }) {
  const result = await client.query(
    `
    SELECT ecn.*, s.name AS supplier_name, s.code AS supplier_code,
      p.bl_number, p.receipt_date, p.purchase_date,
      psi.invoice_number AS source_invoice_number,
      psi.invoice_date AS source_invoice_date,
      COALESCE(applied.applied_amount_ex_vat, 0) AS received_amount_ex_vat,
      GREATEST(ecn.expected_amount_ex_vat - COALESCE(applied.applied_amount_ex_vat, 0), 0) AS remaining_amount_ex_vat
    FROM supplier_expected_credit_notes ecn
    JOIN suppliers s
      ON s.id = ecn.supplier_id
     AND s.store_id = ecn.store_id
    LEFT JOIN purchases p
      ON p.id = ecn.source_purchase_id
     AND p.store_id = ecn.store_id
    LEFT JOIN pennylane_supplier_invoices psi
      ON psi.id = ecn.source_pennylane_supplier_invoice_id
     AND psi.store_id = ecn.store_id
    LEFT JOIN (
      SELECT store_id, expected_credit_note_id, SUM(applied_amount_ex_vat) AS applied_amount_ex_vat
      FROM supplier_expected_credit_note_links
      WHERE status <> 'unlinked'
      GROUP BY store_id, expected_credit_note_id
    ) applied
      ON applied.store_id = ecn.store_id
     AND applied.expected_credit_note_id = ecn.id
    WHERE ecn.id = $1
      AND ecn.store_id = $2
    LIMIT 1
    ${forUpdate ? 'FOR UPDATE OF ecn' : ''}
    `,
    [expectedCreditNoteId, storeId]
  );
  return result.rows[0] || null;
}

async function recalculateSourceInvoiceAfterCreditNote(client, { storeId, documentId }) {
  if (!documentId) return null;
  const document = await loadPennylaneDocument(client, { storeId, documentId, forUpdate: true });
  if (!document || document.document_type === 'credit_note') return null;
  const paymentStatus = clean(document.payment_status)?.toLowerCase();
  const currentStatus = clean(document.supplier_control_status)?.toLowerCase();
  const paid = document.paid === true || paymentStatus === 'paid' || paymentStatus?.startsWith('paid_');
  if (paid || paymentStatus === 'to_be_paid' || ['litige', 'reconciliation_required', 'valide_a_payer', 'paye'].includes(currentStatus)) {
    return currentStatus;
  }
  const totals = await client.query(
    `
    WITH linked_purchases AS (
      SELECT DISTINCT p.id,
        COALESCE(NULLIF(p.total_amount_ex_vat, 0), SUM(COALESCE(pl.line_amount_ex_vat, 0)), 0) AS total_ex_vat
      FROM supplier_control_document_links scl
      JOIN purchases p
        ON p.id = scl.purchase_id
       AND p.store_id = scl.store_id
      LEFT JOIN purchase_lines pl
        ON pl.purchase_id = p.id
       AND pl.store_id = p.store_id
      WHERE scl.store_id = $1
        AND scl.pennylane_supplier_invoice_id = $2
        AND scl.match_status <> 'removed'
      GROUP BY p.id, p.total_amount_ex_vat
    ), expected AS (
      SELECT ecn.id, ecn.expected_amount_ex_vat,
        COALESCE(SUM(l.applied_amount_ex_vat) FILTER (WHERE l.status <> 'unlinked'), 0) AS applied_amount_ex_vat
      FROM supplier_expected_credit_notes ecn
      LEFT JOIN supplier_expected_credit_note_links l
        ON l.expected_credit_note_id = ecn.id
       AND l.store_id = ecn.store_id
      WHERE ecn.store_id = $1
        AND ecn.source_pennylane_supplier_invoice_id = $2
        AND ecn.status NOT IN ('cancelled', 'disputed')
      GROUP BY ecn.id
    )
    SELECT
      COALESCE((SELECT SUM(total_ex_vat) FROM linked_purchases), 0) AS purchase_total_ex_vat,
      COALESCE((SELECT SUM(applied_amount_ex_vat) FROM expected), 0) AS applied_credit_note_total_ex_vat,
      COALESCE((SELECT SUM(GREATEST(expected_amount_ex_vat - applied_amount_ex_vat, 0)) FROM expected), 0) AS remaining_expected_credit_note_total_ex_vat
    `,
    [storeId, documentId]
  );
  const row = totals.rows[0] || {};
  const invoiceTotal = documentAmount(document);
  const purchaseTotal = round(row.purchase_total_ex_vat);
  const appliedTotal = round(row.applied_credit_note_total_ex_vat);
  const remainingExpected = round(row.remaining_expected_credit_note_total_ex_vat);
  const difference = round(invoiceTotal - appliedTotal - purchaseTotal);
  const nextStatus = remainingExpected > 0.01
    ? 'avoir_attendu'
    : (Math.abs(difference) <= amountTolerance(invoiceTotal) ? 'conforme' : 'ecart');
  await client.query(
    `
    UPDATE pennylane_supplier_invoices
    SET supplier_control_status = $1,
        updated_at = now()
    WHERE id = $2
      AND store_id = $3
      AND supplier_control_status NOT IN ('valide_a_payer', 'paye', 'litige', 'reconciliation_required')
    `,
    [nextStatus, documentId, storeId]
  );
  return nextStatus;
}

function normalizeExpectedPayload(payload = {}) {
  const reasonType = clean(payload.reason_type);
  if (!EXPECTED_CREDIT_NOTE_REASON_TYPES.has(reasonType)) {
    throw expectedCreditNoteError('Motif avoir attendu invalide', 400, 'SUPPLIER_EXPECTED_CREDIT_NOTE_REASON_REQUIRED');
  }
  const reasonComment = clean(payload.reason_comment || payload.comment);
  if (!reasonComment) {
    throw expectedCreditNoteError('Commentaire obligatoire', 400, 'SUPPLIER_EXPECTED_CREDIT_NOTE_COMMENT_REQUIRED');
  }
  const expectedAmount = round(payload.expected_amount_ex_vat ?? payload.expected_amount);
  if (!(expectedAmount > 0)) {
    throw expectedCreditNoteError('Montant HT attendu obligatoire', 400, 'SUPPLIER_EXPECTED_CREDIT_NOTE_AMOUNT_REQUIRED');
  }
  const affectedQuantity = payload.affected_quantity === undefined || payload.affected_quantity === null || payload.affected_quantity === ''
    ? null
    : round(payload.affected_quantity);
  if (affectedQuantity !== null && !(affectedQuantity > 0)) {
    throw expectedCreditNoteError('Quantite concernee invalide', 400, 'SUPPLIER_EXPECTED_CREDIT_NOTE_QUANTITY_INVALID');
  }
  return {
    supplierId: clean(payload.supplier_id),
    sourcePurchaseId: clean(payload.source_purchase_id),
    sourcePurchaseLineId: clean(payload.source_purchase_line_id),
    sourcePennylaneSupplierInvoiceId: clean(payload.source_pennylane_supplier_invoice_id),
    expectedAmount,
    reasonType,
    reasonComment,
    affectedQuantity,
    affectedUnit: clean(payload.affected_unit),
    idempotencyKey: clean(payload.idempotency_key || payload.request_id),
    rawPayload: payload.raw_payload || {},
  };
}

async function createExpectedCreditNoteInTransaction(client, {
  storeId,
  payload,
  userId = null,
  source = 'manual',
} = {}) {
  const normalized = normalizeExpectedPayload(payload);

  if (normalized.idempotencyKey) {
    const existing = await client.query(
      `
      SELECT *
      FROM supplier_expected_credit_notes
      WHERE store_id = $1
        AND idempotency_key = $2
      LIMIT 1
      `,
      [storeId, normalized.idempotencyKey]
    );
    if (existing.rows[0]) return { expected_credit_note: existing.rows[0], idempotent: true };
  }

  let supplierId = normalized.supplierId;
  let purchase = null;
  let purchaseLine = null;
  let sourceDocument = null;

  if (normalized.sourcePurchaseId) {
    if (!isUuid(normalized.sourcePurchaseId)) {
      throw expectedCreditNoteError('BL source invalide', 400, 'SUPPLIER_EXPECTED_CREDIT_NOTE_PURCHASE_INVALID');
    }
    purchase = await loadPurchase(client, { storeId, purchaseId: normalized.sourcePurchaseId, forUpdate: true });
    if (!purchase) throw expectedCreditNoteError('BL fournisseur introuvable', 404, 'SUPPLIER_EXPECTED_CREDIT_NOTE_PURCHASE_NOT_FOUND');
    supplierId = supplierId || purchase.supplier_id;
    if (supplierId && String(supplierId) !== String(purchase.supplier_id)) {
      throw expectedCreditNoteError('Fournisseur incoherent avec le BL', 409, 'SUPPLIER_EXPECTED_CREDIT_NOTE_SUPPLIER_MISMATCH');
    }
    if (normalized.sourcePurchaseLineId) {
      purchaseLine = await loadPurchaseLine(client, {
        storeId,
        purchaseId: purchase.id,
        purchaseLineId: normalized.sourcePurchaseLineId,
      });
      if (!purchaseLine) {
        throw expectedCreditNoteError('Ligne achat source introuvable', 404, 'SUPPLIER_EXPECTED_CREDIT_NOTE_PURCHASE_LINE_NOT_FOUND');
      }
    }
  }

  if (normalized.sourcePennylaneSupplierInvoiceId) {
    if (!isUuid(normalized.sourcePennylaneSupplierInvoiceId)) {
      throw expectedCreditNoteError('Facture source invalide', 400, 'SUPPLIER_EXPECTED_CREDIT_NOTE_SOURCE_DOCUMENT_INVALID');
    }
    sourceDocument = await loadPennylaneDocument(client, {
      storeId,
      documentId: normalized.sourcePennylaneSupplierInvoiceId,
      forUpdate: true,
    });
    if (!sourceDocument) {
      throw expectedCreditNoteError('Facture source introuvable', 404, 'SUPPLIER_EXPECTED_CREDIT_NOTE_SOURCE_DOCUMENT_NOT_FOUND');
    }
    supplierId = supplierId || sourceDocument.supplier_id;
    if (supplierId && String(supplierId) !== String(sourceDocument.supplier_id)) {
      throw expectedCreditNoteError('Fournisseur incoherent avec la facture', 409, 'SUPPLIER_EXPECTED_CREDIT_NOTE_SUPPLIER_MISMATCH');
    }
  }

  if (!supplierId || !isUuid(supplierId)) {
    throw expectedCreditNoteError('Fournisseur obligatoire', 400, 'SUPPLIER_EXPECTED_CREDIT_NOTE_SUPPLIER_REQUIRED');
  }

  const supplier = await client.query(
    'SELECT id FROM suppliers WHERE id = $1 AND store_id = $2 LIMIT 1',
    [supplierId, storeId]
  );
  if (!supplier.rows.length) {
    throw expectedCreditNoteError('Fournisseur introuvable', 404, 'SUPPLIER_EXPECTED_CREDIT_NOTE_SUPPLIER_NOT_FOUND');
  }

  const inserted = await client.query(
    `
    INSERT INTO supplier_expected_credit_notes(
      id, store_id, supplier_id, source_purchase_id, source_purchase_line_id,
      source_pennylane_supplier_invoice_id, expected_amount_ex_vat, reason_type,
      reason_comment, affected_quantity, affected_unit, status, idempotency_key,
      created_by, raw_payload
    )
    VALUES(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11, $12, $13::jsonb)
    ON CONFLICT (store_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL
    DO UPDATE SET updated_at = supplier_expected_credit_notes.updated_at
    RETURNING *
    `,
    [
      storeId,
      supplierId,
      normalized.sourcePurchaseId || null,
      normalized.sourcePurchaseLineId || null,
      normalized.sourcePennylaneSupplierInvoiceId || null,
      normalized.expectedAmount,
      normalized.reasonType,
      normalized.reasonComment,
      normalized.affectedQuantity,
      normalized.affectedUnit,
      normalized.idempotencyKey,
      userId,
      JSON.stringify({ ...normalized.rawPayload, source }),
    ]
  );
  const expectedCreditNote = inserted.rows[0];

  await insertSupplierControlEvent(client, {
    storeId,
    documentId: normalized.sourcePennylaneSupplierInvoiceId,
    eventType: 'expected_credit_note_created',
    eventKey: creditNoteEventKey('expected_credit_note_created', expectedCreditNote.id),
    payload: {
      expected_credit_note_id: expectedCreditNote.id,
      source_purchase_id: expectedCreditNote.source_purchase_id,
      expected_amount_ex_vat: expectedCreditNote.expected_amount_ex_vat,
      reason_type: expectedCreditNote.reason_type,
    },
    userId,
  });

  if (sourceDocument && sourceDocument.document_type !== 'credit_note') {
    const paymentStatus = clean(sourceDocument.payment_status)?.toLowerCase();
    const isPaid = sourceDocument.paid === true || paymentStatus === 'paid' || paymentStatus?.startsWith('paid_');
    if (!isPaid && paymentStatus !== 'to_be_paid') {
      await client.query(
        `
        UPDATE pennylane_supplier_invoices
        SET supplier_control_status = 'avoir_attendu',
            updated_at = now()
        WHERE id = $1
          AND store_id = $2
          AND supplier_control_status NOT IN ('valide_a_payer', 'paye', 'litige', 'reconciliation_required')
        `,
        [sourceDocument.id, storeId]
      );
    }
  }

  return { expected_credit_note: expectedCreditNote, idempotent: false };
}

async function createExpectedCreditNote(db, options) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await createExpectedCreditNoteInTransaction(client, options);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listExpectedCreditNotesForSourceDocument(client, { storeId, documentId }) {
  const result = await client.query(
    `
    SELECT ecn.*, p.bl_number, p.receipt_date, a.designation AS article_name,
      COALESCE(applied.applied_amount_ex_vat, 0) AS received_amount_ex_vat,
      GREATEST(ecn.expected_amount_ex_vat - COALESCE(applied.applied_amount_ex_vat, 0), 0) AS remaining_amount_ex_vat
    FROM supplier_expected_credit_notes ecn
    LEFT JOIN purchases p
      ON p.id = ecn.source_purchase_id
     AND p.store_id = ecn.store_id
    LEFT JOIN purchase_lines pl
      ON pl.id = ecn.source_purchase_line_id
     AND pl.store_id = ecn.store_id
    LEFT JOIN articles a
      ON a.id = pl.article_id
     AND a.store_id = pl.store_id
    LEFT JOIN (
      SELECT store_id, expected_credit_note_id, SUM(applied_amount_ex_vat) AS applied_amount_ex_vat
      FROM supplier_expected_credit_note_links
      WHERE status <> 'unlinked'
      GROUP BY store_id, expected_credit_note_id
    ) applied
      ON applied.store_id = ecn.store_id
     AND applied.expected_credit_note_id = ecn.id
    WHERE ecn.store_id = $1
      AND ecn.source_pennylane_supplier_invoice_id = $2
    ORDER BY ecn.created_at DESC, ecn.id DESC
    `,
    [storeId, documentId]
  );
  return result.rows;
}

async function listExpectedCreditNotesForPurchase(db, { storeId, purchaseId }) {
  const result = await db.query(
    `
    SELECT ecn.*, s.name AS supplier_name, p.bl_number, p.receipt_date,
      COALESCE(applied.applied_amount_ex_vat, 0) AS received_amount_ex_vat,
      GREATEST(ecn.expected_amount_ex_vat - COALESCE(applied.applied_amount_ex_vat, 0), 0) AS remaining_amount_ex_vat
    FROM supplier_expected_credit_notes ecn
    JOIN suppliers s
      ON s.id = ecn.supplier_id
     AND s.store_id = ecn.store_id
    LEFT JOIN purchases p
      ON p.id = ecn.source_purchase_id
     AND p.store_id = ecn.store_id
    LEFT JOIN (
      SELECT store_id, expected_credit_note_id, SUM(applied_amount_ex_vat) AS applied_amount_ex_vat
      FROM supplier_expected_credit_note_links
      WHERE status <> 'unlinked'
      GROUP BY store_id, expected_credit_note_id
    ) applied
      ON applied.store_id = ecn.store_id
     AND applied.expected_credit_note_id = ecn.id
    WHERE ecn.store_id = $1
      AND ecn.source_purchase_id = $2
    ORDER BY ecn.created_at DESC, ecn.id DESC
    `,
    [storeId, purchaseId]
  );
  return { expected_credit_notes: result.rows };
}

async function listExpectedCreditNotes(db, { storeId, filters = {} }) {
  const params = [storeId];
  const where = ['ecn.store_id = $1'];
  const status = clean(filters.status);
  if (status && EXPECTED_CREDIT_NOTE_STATUSES.has(status)) {
    params.push(status);
    where.push(`ecn.status = $${params.length}`);
  }
  const supplierId = clean(filters.supplier_id);
  if (supplierId) {
    params.push(supplierId);
    where.push(`ecn.supplier_id = $${params.length}`);
  }
  const result = await db.query(
    `
    SELECT ecn.*, s.name AS supplier_name, p.bl_number,
      psi.invoice_number AS source_invoice_number,
      COALESCE(applied.applied_amount_ex_vat, 0) AS received_amount_ex_vat,
      GREATEST(ecn.expected_amount_ex_vat - COALESCE(applied.applied_amount_ex_vat, 0), 0) AS remaining_amount_ex_vat
    FROM supplier_expected_credit_notes ecn
    JOIN suppliers s
      ON s.id = ecn.supplier_id
     AND s.store_id = ecn.store_id
    LEFT JOIN purchases p
      ON p.id = ecn.source_purchase_id
     AND p.store_id = ecn.store_id
    LEFT JOIN pennylane_supplier_invoices psi
      ON psi.id = ecn.source_pennylane_supplier_invoice_id
     AND psi.store_id = ecn.store_id
    LEFT JOIN (
      SELECT store_id, expected_credit_note_id, SUM(applied_amount_ex_vat) AS applied_amount_ex_vat
      FROM supplier_expected_credit_note_links
      WHERE status <> 'unlinked'
      GROUP BY store_id, expected_credit_note_id
    ) applied
      ON applied.store_id = ecn.store_id
     AND applied.expected_credit_note_id = ecn.id
    WHERE ${where.join(' AND ')}
    ORDER BY ecn.created_at DESC, ecn.id DESC
    LIMIT 200
    `,
    params
  );
  return { expected_credit_notes: result.rows };
}

async function getExpectedCreditNote(db, { storeId, expectedCreditNoteId }) {
  const expectedCreditNote = await loadExpectedCreditNoteById(db, { storeId, expectedCreditNoteId });
  if (!expectedCreditNote) return null;
  const links = await db.query(
    `
    SELECT l.*, credit.invoice_number AS credit_note_number, credit.invoice_date AS credit_note_date,
      credit.amount_ex_vat AS credit_note_amount_ex_vat, credit.public_file_url
    FROM supplier_expected_credit_note_links l
    JOIN pennylane_supplier_invoices credit
      ON credit.id = l.pennylane_credit_note_id
     AND credit.store_id = l.store_id
    WHERE l.store_id = $1
      AND l.expected_credit_note_id = $2
      AND l.status <> 'unlinked'
    ORDER BY l.created_at DESC, l.id DESC
    `,
    [storeId, expectedCreditNoteId]
  );
  return { expected_credit_note: expectedCreditNote, links: links.rows };
}

async function cancelExpectedCreditNote(db, { storeId, expectedCreditNoteId, comment, userId = null }) {
  const text = clean(comment);
  if (!text) throw expectedCreditNoteError('Commentaire annulation obligatoire', 400, 'SUPPLIER_EXPECTED_CREDIT_NOTE_CANCEL_COMMENT_REQUIRED');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const existing = await loadExpectedCreditNoteById(client, { storeId, expectedCreditNoteId, forUpdate: true });
    if (!existing) {
      await client.query('ROLLBACK');
      return null;
    }
    if (existing.status === 'resolved') {
      throw expectedCreditNoteError('Attente deja soldee', 409, 'SUPPLIER_EXPECTED_CREDIT_NOTE_ALREADY_RESOLVED');
    }
    const updated = await client.query(
      `
      UPDATE supplier_expected_credit_notes
      SET status = 'cancelled',
          cancelled_at = now(),
          cancelled_by = $3,
          cancellation_comment = $4
      WHERE id = $1
        AND store_id = $2
      RETURNING *
      `,
      [expectedCreditNoteId, storeId, userId, text]
    );
    await insertSupplierControlEvent(client, {
      storeId,
      documentId: existing.source_pennylane_supplier_invoice_id,
      eventType: 'expected_credit_note_cancelled',
      eventKey: creditNoteEventKey('expected_credit_note_cancelled', expectedCreditNoteId),
      payload: { expected_credit_note_id: expectedCreditNoteId, comment: text },
      userId,
    });
    await recalculateSourceInvoiceAfterCreditNote(client, {
      storeId,
      documentId: existing.source_pennylane_supplier_invoice_id,
    });
    await client.query('COMMIT');
    return { expected_credit_note: updated.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function classifyCreditNoteCandidate({ expectedAmount, receivedAmount, dateDistance, sameBlReference }) {
  const difference = Math.abs(round(expectedAmount - receivedAmount));
  if (difference <= 0.01 && sameBlReference) return 'exact';
  if (difference <= 0.01) return 'strong_candidate';
  if (difference <= Math.max(1, expectedAmount * 0.02) && (dateDistance === null || dateDistance <= 45)) return 'candidate';
  return 'no_match';
}

async function listCreditNoteMatchCandidates(db, { storeId, creditNoteId }) {
  const creditNote = await loadPennylaneDocument(db, { storeId, documentId: creditNoteId });
  if (!creditNote) return null;
  if (creditNote.document_type !== 'credit_note') {
    throw expectedCreditNoteError('Le document Pennylane nest pas un avoir fournisseur', 400, 'SUPPLIER_EXPECTED_CREDIT_NOTE_DOCUMENT_NOT_CREDIT_NOTE');
  }
  const result = await db.query(
    `
    SELECT ecn.*, p.bl_number, p.receipt_date,
      psi.invoice_number AS source_invoice_number,
      COALESCE(applied.applied_amount_ex_vat, 0) AS received_amount_ex_vat,
      GREATEST(ecn.expected_amount_ex_vat - COALESCE(applied.applied_amount_ex_vat, 0), 0) AS remaining_amount_ex_vat
    FROM supplier_expected_credit_notes ecn
    LEFT JOIN purchases p
      ON p.id = ecn.source_purchase_id
     AND p.store_id = ecn.store_id
    LEFT JOIN pennylane_supplier_invoices psi
      ON psi.id = ecn.source_pennylane_supplier_invoice_id
     AND psi.store_id = ecn.store_id
    LEFT JOIN (
      SELECT store_id, expected_credit_note_id, SUM(applied_amount_ex_vat) AS applied_amount_ex_vat
      FROM supplier_expected_credit_note_links
      WHERE status <> 'unlinked'
      GROUP BY store_id, expected_credit_note_id
    ) applied
      ON applied.store_id = ecn.store_id
     AND applied.expected_credit_note_id = ecn.id
    WHERE ecn.store_id = $1
      AND ecn.supplier_id = $2
      AND ecn.status IN ('pending', 'matched')
    ORDER BY ecn.created_at DESC, ecn.id DESC
    LIMIT 100
    `,
    [storeId, creditNote.supplier_id]
  );
  const receivedAmount = documentAmount(creditNote);
  const reference = [
    creditNote.invoice_number,
    creditNote.external_reference,
    JSON.stringify(creditNote.raw_payload || {}),
  ].join(' ').toLowerCase();
  const candidates = result.rows.map((expected) => {
    const sameBlReference = expected.bl_number && reference.includes(String(expected.bl_number).toLowerCase());
    const dateDistance = daysBetween(creditNote.invoice_date, expected.created_at);
    const confidence = classifyCreditNoteCandidate({
      expectedAmount: toNumber(expected.remaining_amount_ex_vat || expected.expected_amount_ex_vat),
      receivedAmount,
      dateDistance,
      sameBlReference,
    });
    return {
      ...expected,
      received_amount_candidate_ex_vat: receivedAmount,
      difference_ex_vat: round(receivedAmount - toNumber(expected.remaining_amount_ex_vat || expected.expected_amount_ex_vat)),
      confidence,
      applicable: confidence !== 'no_match',
    };
  });
  const applicable = candidates.filter((candidate) => candidate.applicable);
  const globalConfidence = applicable.length === 0
    ? 'no_match'
    : (applicable.length > 1 && applicable[0]?.confidence !== 'exact' ? 'ambiguous' : applicable[0].confidence);
  return { credit_note: creditNote, candidates, confidence: globalConfidence };
}

async function applyCreditNoteMatch(db, { storeId, creditNoteId, expectedCreditNoteIds, applications = [], userId = null }) {
  const ids = [...new Set((expectedCreditNoteIds || []).filter(isUuid).map(String))];
  if (!ids.length) {
    throw expectedCreditNoteError('Aucune attente avoir selectionnee', 400, 'SUPPLIER_EXPECTED_CREDIT_NOTE_MATCH_REQUIRED');
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const creditNote = await loadPennylaneDocument(client, { storeId, documentId: creditNoteId, forUpdate: true });
    if (!creditNote) {
      await client.query('ROLLBACK');
      return null;
    }
    if (creditNote.document_type !== 'credit_note') {
      throw expectedCreditNoteError('Le document Pennylane nest pas un avoir fournisseur', 400, 'SUPPLIER_EXPECTED_CREDIT_NOTE_DOCUMENT_NOT_CREDIT_NOTE');
    }
    const amountAvailable = documentAmount(creditNote);
    const expectedResult = await client.query(
      `
      SELECT ecn.*, COALESCE(applied.applied_amount_ex_vat, 0) AS received_amount_ex_vat
      FROM supplier_expected_credit_notes ecn
      LEFT JOIN (
        SELECT store_id, expected_credit_note_id, SUM(applied_amount_ex_vat) AS applied_amount_ex_vat
        FROM supplier_expected_credit_note_links
        WHERE status <> 'unlinked'
        GROUP BY store_id, expected_credit_note_id
      ) applied
        ON applied.store_id = ecn.store_id
       AND applied.expected_credit_note_id = ecn.id
      WHERE ecn.store_id = $1
        AND ecn.id = ANY($2::uuid[])
      FOR UPDATE OF ecn
      `,
      [storeId, ids]
    );
    if (expectedResult.rows.length !== ids.length) {
      throw expectedCreditNoteError('Attente avoir introuvable', 404, 'SUPPLIER_EXPECTED_CREDIT_NOTE_NOT_FOUND');
    }
    if (expectedResult.rows.some((row) => String(row.supplier_id) !== String(creditNote.supplier_id))) {
      throw expectedCreditNoteError('Fournisseur de lavoir incoherent', 409, 'SUPPLIER_EXPECTED_CREDIT_NOTE_SUPPLIER_MISMATCH');
    }

    const existingApplied = await client.query(
      `
      SELECT COALESCE(SUM(applied_amount_ex_vat), 0) AS total
      FROM supplier_expected_credit_note_links
      WHERE store_id = $1
        AND pennylane_credit_note_id = $2
        AND status <> 'unlinked'
      `,
      [storeId, creditNote.id]
    );
    let totalToApply = 0;
    const explicitAmounts = new Map((applications || []).map((item) => [String(item.expected_credit_note_id), round(item.applied_amount_ex_vat)]));
    const links = [];
    const sourceDocumentIdsToRecalculate = new Set();
    for (const expected of expectedResult.rows) {
      const remaining = round(toNumber(expected.expected_amount_ex_vat) - toNumber(expected.received_amount_ex_vat));
      const amount = explicitAmounts.has(String(expected.id)) ? explicitAmounts.get(String(expected.id)) : Math.min(remaining, amountAvailable);
      if (!(amount > 0)) continue;
      totalToApply = round(totalToApply + amount);
      if (round(toNumber(existingApplied.rows[0]?.total) + totalToApply) - amountAvailable > 0.01) {
        throw expectedCreditNoteError('Montant avoir deja totalement applique', 409, 'SUPPLIER_EXPECTED_CREDIT_NOTE_AMOUNT_EXCEEDED');
      }
      const inserted = await client.query(
        `
        INSERT INTO supplier_expected_credit_note_links(
          id, store_id, expected_credit_note_id, pennylane_credit_note_id, applied_amount_ex_vat,
          status, created_by, raw_payload
        )
        VALUES(gen_random_uuid(), $1, $2, $3, $4, 'matched', $5, $6::jsonb)
        ON CONFLICT (store_id, expected_credit_note_id, pennylane_credit_note_id)
          WHERE status <> 'unlinked'
        DO UPDATE SET
          applied_amount_ex_vat = EXCLUDED.applied_amount_ex_vat,
          updated_at = now()
        RETURNING *
        `,
        [storeId, expected.id, creditNote.id, amount, userId, JSON.stringify({ source: 'supplier_control_credit_note_match' })]
      );
      links.push(inserted.rows[0]);
    }

    for (const expected of expectedResult.rows) {
      const totals = await client.query(
        `
        SELECT COALESCE(SUM(applied_amount_ex_vat), 0) AS applied
        FROM supplier_expected_credit_note_links
        WHERE store_id = $1
          AND expected_credit_note_id = $2
          AND status <> 'unlinked'
        `,
        [storeId, expected.id]
      );
      const applied = round(totals.rows[0]?.applied);
      const nextStatus = applied >= round(expected.expected_amount_ex_vat) - 0.01 ? 'resolved' : 'matched';
      await client.query(
        `
        UPDATE supplier_expected_credit_notes
        SET status = $1,
            resolved_at = CASE WHEN $1 = 'resolved' THEN COALESCE(resolved_at, now()) ELSE resolved_at END,
            resolved_by = CASE WHEN $1 = 'resolved' THEN COALESCE(resolved_by, $4) ELSE resolved_by END
        WHERE id = $2
          AND store_id = $3
        `,
        [nextStatus, expected.id, storeId, userId]
      );
      await insertSupplierControlEvent(client, {
        storeId,
        documentId: expected.source_pennylane_supplier_invoice_id,
        eventType: nextStatus === 'resolved' ? 'expected_credit_note_resolved' : 'expected_credit_note_partially_resolved',
        eventKey: `${nextStatus}:${expected.id}:${creditNote.id}:${applied}`,
        payload: {
          expected_credit_note_id: expected.id,
          pennylane_credit_note_id: creditNote.id,
          applied_amount_ex_vat: applied,
          expected_amount_ex_vat: expected.expected_amount_ex_vat,
        },
        userId,
      });
      if (expected.source_pennylane_supplier_invoice_id) {
        sourceDocumentIdsToRecalculate.add(String(expected.source_pennylane_supplier_invoice_id));
      }
    }

    await insertSupplierControlEvent(client, {
      storeId,
      documentId: creditNote.id,
      eventType: 'credit_note_linked',
      eventKey: `credit_note_linked:${creditNote.id}:${ids.sort().join(':')}`,
      payload: { expected_credit_note_ids: ids, applied_amount_ex_vat: totalToApply },
      userId,
    });
    for (const sourceDocumentId of sourceDocumentIdsToRecalculate) {
      await recalculateSourceInvoiceAfterCreditNote(client, {
        storeId,
        documentId: sourceDocumentId,
      });
    }
    await client.query('COMMIT');
    return { credit_note: creditNote, links };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function removeCreditNoteLink(db, { storeId, creditNoteId, linkId, comment = null, userId = null }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `
      UPDATE supplier_expected_credit_note_links l
      SET status = 'unlinked',
          unlinked_at = now(),
          unlinked_by = $4,
          unlink_comment = $5
      FROM supplier_expected_credit_notes ecn
      WHERE l.id = $1
        AND l.store_id = $2
        AND l.pennylane_credit_note_id = $3
        AND l.status <> 'unlinked'
        AND ecn.id = l.expected_credit_note_id
        AND ecn.store_id = l.store_id
      RETURNING l.*, ecn.source_pennylane_supplier_invoice_id
      `,
      [linkId, storeId, creditNoteId, userId, clean(comment)]
    );
    if (!updated.rows.length) {
      await client.query('ROLLBACK');
      return null;
    }
    const link = updated.rows[0];
    await client.query(
      `
      UPDATE supplier_expected_credit_notes ecn
      SET status = CASE
          WHEN COALESCE((
            SELECT SUM(applied_amount_ex_vat)
            FROM supplier_expected_credit_note_links
            WHERE store_id = $1
              AND expected_credit_note_id = $2
              AND status <> 'unlinked'
          ), 0) <= 0 THEN 'pending'
          WHEN COALESCE((
            SELECT SUM(applied_amount_ex_vat)
            FROM supplier_expected_credit_note_links
            WHERE store_id = $1
              AND expected_credit_note_id = $2
              AND status <> 'unlinked'
          ), 0) >= ecn.expected_amount_ex_vat - 0.01 THEN 'resolved'
          ELSE 'matched'
        END,
        resolved_at = CASE WHEN COALESCE((
            SELECT SUM(applied_amount_ex_vat)
            FROM supplier_expected_credit_note_links
            WHERE store_id = $1
              AND expected_credit_note_id = $2
              AND status <> 'unlinked'
          ), 0) >= ecn.expected_amount_ex_vat - 0.01 THEN resolved_at ELSE NULL END
      WHERE ecn.id = $2
        AND ecn.store_id = $1
      `,
      [storeId, link.expected_credit_note_id]
    );
    await insertSupplierControlEvent(client, {
      storeId,
      documentId: link.source_pennylane_supplier_invoice_id || creditNoteId,
      eventType: 'credit_note_unlinked',
      eventKey: `credit_note_unlinked:${link.id}:${Date.now()}`,
      payload: { link_id: link.id, pennylane_credit_note_id: creditNoteId },
      userId,
    });
    await recalculateSourceInvoiceAfterCreditNote(client, {
      storeId,
      documentId: link.source_pennylane_supplier_invoice_id,
    });
    await client.query('COMMIT');
    return { link };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function appliedCreditNoteTotalForSourceDocument(client, { storeId, documentId }) {
  const result = await client.query(
    `
    SELECT COALESCE(SUM(l.applied_amount_ex_vat), 0) AS total
    FROM supplier_expected_credit_notes ecn
    JOIN supplier_expected_credit_note_links l
      ON l.expected_credit_note_id = ecn.id
     AND l.store_id = ecn.store_id
     AND l.status <> 'unlinked'
    JOIN pennylane_supplier_invoices credit
      ON credit.id = l.pennylane_credit_note_id
     AND credit.store_id = l.store_id
     AND credit.document_type = 'credit_note'
     AND credit.pennylane_deleted_at IS NULL
    WHERE ecn.store_id = $1
      AND ecn.source_pennylane_supplier_invoice_id = $2
      AND ecn.status IN ('matched', 'resolved')
    `,
    [storeId, documentId]
  );
  return round(result.rows[0]?.total);
}

module.exports = {
  EXPECTED_CREDIT_NOTE_REASON_TYPES,
  EXPECTED_CREDIT_NOTE_STATUSES,
  appliedCreditNoteTotalForSourceDocument,
  cancelExpectedCreditNote,
  createExpectedCreditNote,
  createExpectedCreditNoteInTransaction,
  getExpectedCreditNote,
  listCreditNoteMatchCandidates,
  listExpectedCreditNotes,
  listExpectedCreditNotesForPurchase,
  listExpectedCreditNotesForSourceDocument,
  removeCreditNoteLink,
  applyCreditNoteMatch,
};
