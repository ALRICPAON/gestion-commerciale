const CANONICAL_SUPPLIER_CONTROL_STATUSES = new Set([
  'a_rapprocher',
  'a_controler',
  'ecart',
  'avoir_attendu',
  'conforme',
  'valide_a_payer',
  'paye',
  'litige',
  'reconciliation_required',
]);

const DOCUMENT_TYPES = new Set(['invoice', 'credit_note']);
const MATCHABLE_PURCHASE_STATUSES = ['received', 'received_pending_invoice', 'invoice_difference', 'invoice_matched'];
const FINAL_CONTROL_STATUSES = new Set(['paye', 'valide_a_payer', 'litige', 'avoir_attendu', 'reconciliation_required']);
const LINK_EDIT_LOCKED_CONTROL_STATUSES = new Set(['valide_a_payer', 'paye', 'litige', 'avoir_attendu', 'reconciliation_required']);
const DIFFERENCE_RESOLUTION_TYPES = new Set(['accepted_difference', 'supplier_credit_note_expected', 'dispute']);
const DEFAULT_MATCH_DATE_WINDOW_DAYS = 21;
const MAX_MATCH_CANDIDATES = 30;
const MAX_COMBINATION_SIZE = 4;
const MAX_COMBINATIONS = 800;
const DEFAULT_AMOUNT_TOLERANCE = 1;
const DEFAULT_AMOUNT_RATIO_TOLERANCE = 0.005;
const VALIDATION_FINAL_STATUSES = new Set(['valide_a_payer', 'paye']);
const VALIDATION_BLOCKED_FINAL_STATUSES = new Set(['litige', 'avoir_attendu', 'reconciliation_required']);
const SUPPLIER_CONTROL_STATUS_GROUPS = {
  needs_action: ['a_rapprocher', 'a_controler', 'ecart', 'avoir_attendu', 'conforme', 'reconciliation_required'],
  ready_to_validate: ['conforme', 'ecart'],
  final: ['valide_a_payer', 'paye'],
};

const {
  fetchSupplierInvoicePaymentStatusFromPennylane,
  syncValidatedSupplierInvoiceStatusToPennylane,
} = require('./pennylane/supplierInvoiceStatusSync');

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

function amountToleranceConfig() {
  const absoluteTolerance = Number(process.env.PENNYLANE_SUPPLIER_GLOBAL_AMOUNT_TOLERANCE) || DEFAULT_AMOUNT_TOLERANCE;
  const ratioTolerance = Number(process.env.PENNYLANE_SUPPLIER_GLOBAL_AMOUNT_RATIO_TOLERANCE) ||
    DEFAULT_AMOUNT_RATIO_TOLERANCE;
  return { absoluteTolerance, ratioTolerance };
}

function amountTolerance(amount) {
  const { absoluteTolerance, ratioTolerance } = amountToleranceConfig();
  return Math.max(absoluteTolerance, Math.abs(toNumber(amount)) * ratioTolerance);
}

function isPaidStatus(paymentStatus, paid) {
  const status = clean(paymentStatus)?.toLowerCase() || '';
  return paid === true || status === 'paid' || status.startsWith('paid_');
}

function canonicalSupplierControlStatus(document = {}) {
  if (isPaidStatus(document.payment_status, document.paid)) return 'paye';

  const paymentStatus = clean(document.payment_status)?.toLowerCase();
  const altaStatus = clean(document.alta_business_status)?.toLowerCase();
  const current = clean(document.supplier_control_status)?.toLowerCase();

  if (current === 'reconciliation_required') return current;
  if (paymentStatus === 'to_be_paid') return 'valide_a_payer';
  if (current && FINAL_CONTROL_STATUSES.has(current)) return current;
  if (['litige', 'refusee'].includes(altaStatus)) return 'litige';
  if (altaStatus === 'validee_a_payer') return 'valide_a_payer';
  if (altaStatus === 'conforme') return 'conforme';
  if (['ecart_prix', 'ecart_quantite', 'ecart_tva'].includes(altaStatus)) return 'ecart';
  if (['analyse_automatique', 'en_controle', 'article_inconnu', 'controle_manuel'].includes(altaStatus)) {
    return 'a_controler';
  }
  if (current && CANONICAL_SUPPLIER_CONTROL_STATUSES.has(current)) return current;

  return 'a_rapprocher';
}

function documentAmount(document = {}) {
  return Math.abs(toNumber(document.amount_ex_vat ?? document.currency_amount_ex_vat));
}

function effectivePurchaseTotalExVat(purchase = {}) {
  const headerTotals = [
    purchase.total_amount_ex_vat,
    purchase.purchase_total_ex_vat,
    purchase.total_ex_vat,
  ];
  for (const value of headerTotals) {
    const total = toNumber(value, NaN);
    if (Number.isFinite(total) && total !== 0) return total;
  }
  const linesTotal = toNumber(purchase.purchase_lines_total_ex_vat, NaN);
  if (Number.isFinite(linesTotal)) return linesTotal;
  return 0;
}

function documentVatAmount(document = {}) {
  return Math.abs(toNumber(document.amount_vat ?? document.currency_amount_vat, NaN));
}

function documentIncVatAmount(document = {}) {
  return Math.abs(toNumber(document.amount_inc_vat ?? document.currency_amount_inc_vat, NaN));
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
  const leftMs = Date.parse(`${leftDate}T00:00:00Z`);
  const rightMs = Date.parse(`${rightDate}T00:00:00Z`);
  return Math.abs(leftMs - rightMs) / 86400000;
}

function activePurchaseIdsFromLinks(links = []) {
  return [...new Set(
    links
      .map((link) => clean(link.purchase_id))
      .filter(Boolean)
      .map(String)
  )].sort();
}

function normalizedDifference(value) {
  return round(value, 4).toFixed(4);
}

function supplierControlMatchSignature(document, links = [], totals = null) {
  const currentTotals = totals || totalsFromDocumentAndLinks(document, links);
  const purchaseIds = activePurchaseIdsFromLinks(links);
  return {
    purchase_ids: purchaseIds,
    amount_difference: Number(normalizedDifference(currentTotals.difference_total)),
    match_signature: [
      String(document?.id || ''),
      purchaseIds.join(','),
      normalizedDifference(currentTotals.difference_total),
    ].join('|'),
  };
}

function eventPayload(event = {}) {
  if (!event.payload) return {};
  if (typeof event.payload === 'object') return event.payload;
  try {
    return JSON.parse(event.payload);
  } catch (_) {
    return {};
  }
}

function hasDifferenceAccepted(events = [], document = {}, links = [], totals = null) {
  const current = supplierControlMatchSignature(document, links, totals);
  return events
    .filter((event) => event.event_type === 'difference_accepted')
    .some((event) => {
      const payload = eventPayload(event);
      if (payload.match_signature) return payload.match_signature === current.match_signature;
      const payloadPurchaseIds = Array.isArray(payload.purchase_ids)
        ? payload.purchase_ids.map(String).sort()
        : [];
      return payloadPurchaseIds.join(',') === current.purchase_ids.join(',') &&
        normalizedDifference(payload.amount_difference) === normalizedDifference(current.amount_difference);
    });
}

function buildValidationSummary(document, totals, controlStatus = canonicalSupplierControlStatus(document), options = {}) {
  const status = controlStatus;
  const blockingReasons = [];
  const acceptedDifference = Boolean(options.acceptedDifference);

  if (document.pennylane_deleted_at) blockingReasons.push('document_supprime_pennylane');
  if (status === 'paye') blockingReasons.push('document_deja_paye', 'already_paid');
  if (status === 'valide_a_payer') blockingReasons.push('already_validated');
  if (status === 'litige') blockingReasons.push('document_en_litige');
  if (status === 'avoir_attendu') blockingReasons.push('avoir_fournisseur_attendu');
  if (status === 'reconciliation_required') blockingReasons.push('validation_reconciliation_required');
  if (!document.supplier_id) blockingReasons.push('fournisseur_inconnu');
  if (totals.linked_purchase_count <= 0) blockingReasons.push('aucun_bl_rapproche');
  if (!acceptedDifference && Math.abs(totals.difference_total) > amountTolerance(totals.invoice_total)) {
    blockingReasons.push('difference_non_resolue');
  }

  return {
    invoice_total: totals.invoice_total,
    matched_purchase_total: totals.matched_purchase_total,
    difference_total: totals.difference_total,
    linked_purchase_count: totals.linked_purchase_count,
    control_status: status,
    accepted_difference: acceptedDifference,
    can_validate: blockingReasons.length === 0 && ['conforme', 'valide_a_payer', 'ecart'].includes(status),
    blocking_reasons: blockingReasons,
  };
}

function statusFromTotals(document, totals) {
  const currentStatus = canonicalSupplierControlStatus(document);
  if (FINAL_CONTROL_STATUSES.has(currentStatus)) return currentStatus;
  if (totals.linked_purchase_count <= 0) return 'a_rapprocher';
  if (Math.abs(totals.difference_total) <= amountTolerance(totals.invoice_total)) return 'conforme';
  return 'ecart';
}

function assertDocumentLinksEditable(document) {
  const status = canonicalSupplierControlStatus(document);
  if (!LINK_EDIT_LOCKED_CONTROL_STATUSES.has(status)) return;

  const error = new Error('Document fournisseur finalise: liens BL non modifiables');
  error.status = 409;
  error.code = 'SUPPLIER_CONTROL_DOCUMENT_LINKS_LOCKED';
  error.details = { supplier_control_status: status };
  throw error;
}

async function loadDocument(client, { storeId, documentId, forUpdate = false }) {
  const result = await client.query(
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
      AND psi.pennylane_deleted_at IS NULL
    LIMIT 1
    ${forUpdate ? 'FOR UPDATE OF psi' : ''}
    `,
    [documentId, storeId]
  );
  return result.rows[0] || null;
}

async function loadActiveLinks(client, { storeId, documentId }) {
  const result = await client.query(
    `
    SELECT
      scl.*,
      p.bl_number,
      p.purchase_date,
      p.order_date,
      p.receipt_date,
      p.status AS purchase_status,
      p.total_amount_ex_vat AS purchase_total_ex_vat,
      pl_tot.purchase_lines_total_ex_vat,
      p.supplier_id AS purchase_supplier_id,
      s.name AS purchase_supplier_name,
      s.code AS purchase_supplier_code,
      pl.line_number AS purchase_line_number
    FROM supplier_control_document_links scl
    LEFT JOIN purchases p
      ON p.id = scl.purchase_id
     AND p.store_id = scl.store_id
    LEFT JOIN suppliers s
      ON s.id = p.supplier_id
     AND s.store_id = p.store_id
    LEFT JOIN (
      SELECT store_id, purchase_id, COALESCE(SUM(COALESCE(line_amount_ex_vat, 0)), 0) AS purchase_lines_total_ex_vat
      FROM purchase_lines
      GROUP BY store_id, purchase_id
    ) pl_tot
      ON pl_tot.purchase_id = p.id
     AND pl_tot.store_id = p.store_id
    LEFT JOIN purchase_lines pl
      ON pl.id = scl.purchase_line_id
     AND pl.store_id = scl.store_id
    WHERE scl.pennylane_supplier_invoice_id = $1
      AND scl.store_id = $2
      AND scl.match_status <> 'removed'
    ORDER BY scl.created_at ASC, scl.id ASC
    `,
    [documentId, storeId]
  );
  return result.rows;
}

async function loadPurchaseLinesForPurchaseIds(client, { storeId, purchaseIds }) {
  const ids = [...new Set((purchaseIds || []).filter(Boolean))];
  if (!ids.length) return [];

  const result = await client.query(
    `
    SELECT
      pl.id,
      pl.purchase_id,
      pl.line_number,
      pl.article_id,
      a.designation AS article_name,
      a.plu AS article_plu,
      pl.supplier_reference,
      pl.supplier_label,
      pl.ordered_colis,
      pl.ordered_pieces,
      pl.ordered_quantity,
      pl.received_colis,
      pl.received_pieces,
      pl.received_quantity,
      pl.price_unit,
      pl.unit_price_ex_vat,
      pl.line_amount_ex_vat,
      pl.line_status,
      pl.lot_id,
      plm.supplier_lot_number,
      plm.dlc,
      plm.notes AS metadata_notes
    FROM purchase_lines pl
    LEFT JOIN articles a
      ON a.id = pl.article_id
    LEFT JOIN purchase_line_metadata plm
      ON plm.purchase_line_id = pl.id
     AND plm.meta_key = 'gc_line'
    WHERE pl.store_id = $1
      AND pl.purchase_id = ANY($2::uuid[])
    ORDER BY pl.purchase_id, pl.line_number, pl.created_at
    `,
    [storeId, ids]
  );
  return result.rows;
}

async function loadEvents(client, { storeId, documentId, limit = 100 }) {
  const result = await client.query(
    `
    SELECT *
    FROM supplier_control_events
    WHERE pennylane_supplier_invoice_id = $1
      AND store_id = $2
    ORDER BY created_at DESC, id DESC
    LIMIT $3
    `,
    [documentId, storeId, limit]
  );
  return result.rows;
}

async function loadPennylaneLines(client, { storeId, documentId }) {
  const result = await client.query(
    `
    SELECT *
    FROM pennylane_supplier_invoice_lines
    WHERE supplier_invoice_id = $1
      AND store_id = $2
    ORDER BY line_position ASC, created_at ASC
    `,
    [documentId, storeId]
  );
  return result.rows;
}

function totalsFromDocumentAndLinks(document, links) {
  const invoiceTotal = documentAmount(document);
  const invoiceVat = documentVatAmount(document);
  const invoiceIncVat = documentIncVatAmount(document);
  const byPurchase = new Map();
  for (const link of links) {
    if (!link.purchase_id) continue;
    const key = String(link.purchase_id);
    if (!byPurchase.has(key)) {
      byPurchase.set(key, effectivePurchaseTotalExVat(link));
    }
  }
  const matchedPurchaseTotal = round([...byPurchase.values()].reduce((sum, value) => sum + value, 0), 4);
  return {
    invoice_total: invoiceTotal,
    invoice_total_ex_vat: invoiceTotal,
    matched_purchase_total: matchedPurchaseTotal,
    purchases_total_ex_vat: matchedPurchaseTotal,
    difference_total: round(invoiceTotal - matchedPurchaseTotal, 4),
    difference_ex_vat: round(invoiceTotal - matchedPurchaseTotal, 4),
    invoice_vat: Number.isFinite(invoiceVat) ? invoiceVat : null,
    purchases_vat: null,
    difference_vat: null,
    invoice_total_inc_vat: Number.isFinite(invoiceIncVat) ? invoiceIncVat : null,
    purchases_total_inc_vat: null,
    difference_inc_vat: null,
    linked_purchase_count: byPurchase.size,
  };
}

async function insertEvent(client, { storeId, documentId, eventType, eventKey = null, payload = {}, userId = null }) {
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

function supplierControlError(message, status, code, details = undefined) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function latestEventForSignature(events, eventType, matchSignature) {
  return events.find((event) => {
    if (event.event_type !== eventType) return false;
    const payload = eventPayload(event);
    return payload.match_signature === matchSignature;
  }) || null;
}

function safeValidationPayload(payload = {}) {
  return {
    supplier_control_status: payload.supplier_control_status,
    payment_status: payload.payment_status,
    blocking_reasons: payload.blocking_reasons,
    match_signature: payload.match_signature,
    amount_difference: payload.amount_difference,
    purchase_ids: payload.purchase_ids,
    comment: clean(payload.comment),
    pennylane_error: payload.pennylane_error,
  };
}

function sanitizePennylaneValidationError(error) {
  const source = error?.pennylaneStatusSync || {};
  return {
    message: source.message || error.message || 'Erreur Pennylane',
    status: source.status || error.status || null,
    code: source.code || error.code || null,
    responseBody: source.responseBody || null,
  };
}

function canonicalRemotePaymentStatus(result = {}) {
  const status = clean(result.payment_status)?.toLowerCase();
  if (result.paid === true || status === 'paid' || status?.startsWith('paid_')) return 'paid';
  if (status === 'to_be_paid') return 'to_be_paid';
  return status || null;
}

function validationRequestIsExpired(event) {
  const createdAt = event?.created_at ? new Date(event.created_at).getTime() : NaN;
  if (!Number.isFinite(createdAt)) return false;
  const leaseMs = Math.max(60, Number(process.env.SUPPLIER_CONTROL_VALIDATION_LEASE_SECONDS || 300)) * 1000;
  return Date.now() - createdAt > leaseMs;
}

async function persistRecoveredValidation(db, {
  storeId,
  documentId,
  paymentStatus,
  context,
  userId = null,
  comment = null,
}) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const document = await loadDocument(client, { storeId, documentId, forUpdate: true });
    if (!document) {
      await client.query('ROLLBACK');
      return null;
    }
    const nextPaymentStatus = paymentStatus === 'paid' ? 'paid' : 'to_be_paid';
    const nextControlStatus = paymentStatus === 'paid' ? 'paye' : 'valide_a_payer';
    await client.query(
      `
      UPDATE pennylane_supplier_invoices
      SET payment_status = $1,
          paid = CASE WHEN $1 = 'paid' THEN true ELSE paid END,
          supplier_control_status = $2,
          updated_at = now()
      WHERE id = $3
        AND store_id = $4
      `,
      [nextPaymentStatus, nextControlStatus, document.id, storeId]
    );
    document.payment_status = nextPaymentStatus;
    document.supplier_control_status = nextControlStatus;
    if (nextPaymentStatus === 'paid') document.paid = true;

    await insertEvent(client, {
      storeId,
      documentId: document.id,
      eventType: 'validation_already_applied',
      eventKey: `validation_recovered:${context.currentSignature.match_signature}:${nextControlStatus}`,
      payload: safeValidationPayload({
        supplier_control_status: nextControlStatus,
        payment_status: nextPaymentStatus,
        match_signature: context.currentSignature.match_signature,
        amount_difference: context.currentSignature.amount_difference,
        purchase_ids: context.currentSignature.purchase_ids,
        comment: clean(comment) || 'recovered_after_orphaned_validation_request',
      }),
      userId,
    });
    const summary = buildValidationSummary(document, context.totals, nextControlStatus, {
      acceptedDifference: context.summary?.accepted_difference,
    });
    await client.query('COMMIT');
    return {
      document,
      summary,
      validation: { status: 'recovered', payment_status: nextPaymentStatus },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function finalizeAlreadyAppliedValidation(client, {
  storeId,
  document,
  links,
  totals,
  userId,
  eventType = 'validation_already_applied',
  comment = null,
}) {
  const canonicalStatus = canonicalSupplierControlStatus(document);
  const nextStatus = canonicalStatus === 'paye' ? 'paye' : 'valide_a_payer';
  if (clean(document.supplier_control_status)?.toLowerCase() !== nextStatus) {
    await client.query(
      `
      UPDATE pennylane_supplier_invoices
      SET supplier_control_status = $1,
          updated_at = now()
      WHERE id = $2
        AND store_id = $3
      `,
      [nextStatus, document.id, storeId]
    );
    document.supplier_control_status = nextStatus;
  }
  const currentSignature = supplierControlMatchSignature(document, links, totals);
  await insertEvent(client, {
    storeId,
    documentId: document.id,
    eventType,
    eventKey: `${eventType}:${document.id}:${nextStatus}:${currentSignature.match_signature}`,
    payload: safeValidationPayload({
      supplier_control_status: nextStatus,
      payment_status: document.payment_status,
      match_signature: currentSignature.match_signature,
      amount_difference: currentSignature.amount_difference,
      purchase_ids: currentSignature.purchase_ids,
      comment,
    }),
    userId,
  });
  const summary = buildValidationSummary(document, totals, nextStatus, { acceptedDifference: false });
  return {
    document: { ...document, supplier_control_status: nextStatus },
    summary,
    validation: { status: 'already_applied', payment_status: document.payment_status || null },
  };
}

async function validateSupplierControlDocument(db, {
  storeId,
  documentId,
  confirmation,
  comment = null,
  userId = null,
  fetchPennylanePaymentStatus = fetchSupplierInvoicePaymentStatusFromPennylane,
  syncPennylaneStatus = syncValidatedSupplierInvoiceStatusToPennylane,
} = {}) {
  if (!isUuid(documentId)) {
    throw supplierControlError('Identifiant document fournisseur invalide', 400, 'SUPPLIER_CONTROL_DOCUMENT_ID_INVALID');
  }
  if (confirmation !== true) {
    throw supplierControlError('Confirmation explicite obligatoire', 400, 'SUPPLIER_CONTROL_VALIDATION_CONFIRMATION_REQUIRED');
  }

  const client = await db.connect();
  let context;
  try {
    await client.query('BEGIN');
    const document = await loadDocument(client, { storeId, documentId, forUpdate: true });
    if (!document) {
      await client.query('ROLLBACK');
      return null;
    }

    const links = await loadActiveLinks(client, { storeId, documentId });
    const totals = totalsFromDocumentAndLinks(document, links);
    const currentSignature = supplierControlMatchSignature(document, links, totals);
    const canonicalStatus = statusFromTotals(document, totals);
    const storedCanonicalStatus = canonicalSupplierControlStatus(document);

    if (document.document_type === 'credit_note') {
      await insertEvent(client, {
        storeId,
        documentId: document.id,
        eventType: 'validation_failed',
        eventKey: `validation_failed:${document.id}:credit_note:${Date.now()}`,
        payload: safeValidationPayload({
          supplier_control_status: storedCanonicalStatus,
          payment_status: document.payment_status,
          blocking_reasons: ['credit_note_validation_not_supported'],
          match_signature: currentSignature.match_signature,
          amount_difference: currentSignature.amount_difference,
          purchase_ids: currentSignature.purchase_ids,
          comment,
        }),
        userId,
      });
      await client.query('COMMIT');
      throw supplierControlError(
        'Validation Pennylane des avoirs fournisseur non supportee',
        409,
        'SUPPLIER_CONTROL_CREDIT_NOTE_VALIDATION_NOT_SUPPORTED',
        { document_type: document.document_type }
      );
    }

    if (VALIDATION_FINAL_STATUSES.has(storedCanonicalStatus)) {
      const already = await finalizeAlreadyAppliedValidation(client, { storeId, document, links, totals, userId, comment });
      await client.query('COMMIT');
      return already;
    }

    if (VALIDATION_BLOCKED_FINAL_STATUSES.has(storedCanonicalStatus)) {
      await insertEvent(client, {
        storeId,
        documentId: document.id,
        eventType: 'validation_failed',
        eventKey: `validation_failed:${document.id}:${storedCanonicalStatus}:${Date.now()}`,
        payload: safeValidationPayload({
          supplier_control_status: storedCanonicalStatus,
          payment_status: document.payment_status,
          blocking_reasons: [storedCanonicalStatus === 'litige'
            ? 'document_en_litige'
            : (storedCanonicalStatus === 'avoir_attendu'
              ? 'avoir_fournisseur_attendu'
              : 'validation_reconciliation_required')],
          match_signature: currentSignature.match_signature,
          amount_difference: currentSignature.amount_difference,
          purchase_ids: currentSignature.purchase_ids,
          comment,
        }),
        userId,
      });
      await client.query('COMMIT');
      throw supplierControlError('Document fournisseur non validable', 409, 'SUPPLIER_CONTROL_VALIDATION_BLOCKED', {
        supplier_control_status: storedCanonicalStatus,
      });
    }

    if (!clean(document.pennylane_supplier_invoice_id)) {
      await insertEvent(client, {
        storeId,
        documentId: document.id,
        eventType: 'validation_failed',
        eventKey: `validation_failed:${document.id}:missing_pennylane_id:${Date.now()}`,
        payload: safeValidationPayload({
          supplier_control_status: storedCanonicalStatus,
          payment_status: document.payment_status,
          blocking_reasons: ['pennylane_supplier_invoice_id_missing'],
          match_signature: currentSignature.match_signature,
          amount_difference: currentSignature.amount_difference,
          purchase_ids: currentSignature.purchase_ids,
          comment,
        }),
        userId,
      });
      await client.query('COMMIT');
      throw supplierControlError(
        'Identifiant facture fournisseur Pennylane manquant',
        409,
        'SUPPLIER_CONTROL_PENNYLANE_ID_MISSING'
      );
    }

    for (const purchaseId of currentSignature.purchase_ids) {
      await ensurePurchaseCanBeLinked(client, { storeId, document, purchaseId });
    }

    const events = await loadEvents(client, { storeId, documentId, limit: 100 });
    const acceptedDifference = hasDifferenceAccepted(events, document, links, totals);
    const summary = buildValidationSummary(document, totals, canonicalStatus, { acceptedDifference });
    if (!summary.can_validate) {
      await insertEvent(client, {
        storeId,
        documentId: document.id,
        eventType: 'validation_failed',
        eventKey: `validation_failed:${document.id}:${currentSignature.match_signature}:${Date.now()}`,
        payload: safeValidationPayload({
          supplier_control_status: summary.control_status,
          payment_status: document.payment_status,
          blocking_reasons: summary.blocking_reasons,
          match_signature: currentSignature.match_signature,
          amount_difference: currentSignature.amount_difference,
          purchase_ids: currentSignature.purchase_ids,
          comment,
        }),
        userId,
      });
      await client.query('COMMIT');
      throw supplierControlError('Document fournisseur non validable', 409, 'SUPPLIER_CONTROL_VALIDATION_BLOCKED', summary);
    }

    const existingSuccess = latestEventForSignature(events, 'validation_succeeded', currentSignature.match_signature);
    const existingRequested = latestEventForSignature(events, 'validation_requested', currentSignature.match_signature);
    const existingFailure = latestEventForSignature(events, 'validation_failed', currentSignature.match_signature);
    if (existingSuccess) {
      const already = await finalizeAlreadyAppliedValidation(client, { storeId, document, links, totals, userId, comment });
      await client.query('COMMIT');
      return already;
    }
    if (existingRequested && !existingFailure && !validationRequestIsExpired(existingRequested)) {
      context = { recoveryOnly: true, document, links, totals, currentSignature, summary };
      await client.query('COMMIT');
    } else if (existingRequested) {
      context = { recoveryBeforeRetry: true, document, links, totals, currentSignature, summary };
      await client.query('COMMIT');
    } else {
      await insertEvent(client, {
        storeId,
        documentId: document.id,
        eventType: 'validation_requested',
        eventKey: existingRequested
          ? `validation_requested:${currentSignature.match_signature}:${Date.now()}`
          : `validation_requested:${currentSignature.match_signature}`,
        payload: safeValidationPayload({
          supplier_control_status: summary.control_status,
          payment_status: document.payment_status,
          match_signature: currentSignature.match_signature,
          amount_difference: currentSignature.amount_difference,
          purchase_ids: currentSignature.purchase_ids,
          comment,
        }),
        userId,
      });
      await client.query('COMMIT');

      context = { document, links, totals, currentSignature, summary };
    }
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }

  if (context.recoveryOnly || context.recoveryBeforeRetry) {
    let remoteStatus;
    try {
      remoteStatus = await fetchPennylanePaymentStatus({
        invoiceId: context.document.id,
        pennylaneSupplierInvoiceId: context.document.pennylane_supplier_invoice_id,
        storeId,
      });
    } catch (error) {
      throw supplierControlError('Lecture statut Pennylane impossible', error.status || 502, 'SUPPLIER_CONTROL_PENNYLANE_STATUS_REFRESH_FAILED', {
        pennylane_error: sanitizePennylaneValidationError(error),
        retryable: true,
      });
    }
    const paymentStatus = canonicalRemotePaymentStatus(remoteStatus);
    if (paymentStatus === 'to_be_paid' || paymentStatus === 'paid') {
      return persistRecoveredValidation(db, {
        storeId,
        documentId,
        paymentStatus,
        context,
        userId,
        comment,
      });
    }
    if (context.recoveryBeforeRetry) {
      await insertEvent(db, {
        storeId,
        documentId: context.document.id,
        eventType: 'validation_requested',
        eventKey: `validation_requested:${context.currentSignature.match_signature}:${Date.now()}`,
        payload: safeValidationPayload({
          supplier_control_status: context.summary.control_status,
          payment_status: context.document.payment_status,
          match_signature: context.currentSignature.match_signature,
          amount_difference: context.currentSignature.amount_difference,
          purchase_ids: context.currentSignature.purchase_ids,
          comment,
        }),
        userId,
      });
    } else {
      throw supplierControlError(
        'Validation fournisseur deja en cours',
        409,
        'SUPPLIER_CONTROL_VALIDATION_IN_PROGRESS',
        { match_signature: context.currentSignature.match_signature, pennylane_payment_status: paymentStatus }
      );
    }
  }

  try {
    await syncPennylaneStatus({
      invoiceId: context.document.id,
      pennylaneSupplierInvoiceId: context.document.pennylane_supplier_invoice_id,
      storeId,
    });
  } catch (error) {
    const failureClient = await db.connect();
    try {
      await failureClient.query('BEGIN');
      await insertEvent(failureClient, {
        storeId,
        documentId: context.document.id,
        eventType: 'validation_failed',
        eventKey: `validation_failed:${context.currentSignature.match_signature}:${Date.now()}`,
        payload: safeValidationPayload({
          supplier_control_status: context.summary.control_status,
          payment_status: context.document.payment_status,
          blocking_reasons: ['pennylane_update_failed'],
          match_signature: context.currentSignature.match_signature,
          amount_difference: context.currentSignature.amount_difference,
          purchase_ids: context.currentSignature.purchase_ids,
          pennylane_error: sanitizePennylaneValidationError(error),
          comment,
        }),
        userId,
      });
      await failureClient.query('COMMIT');
    } catch (eventError) {
      await failureClient.query('ROLLBACK');
      throw eventError;
    } finally {
      failureClient.release();
    }
    throw supplierControlError('Validation Pennylane impossible', error.status || 502, 'SUPPLIER_CONTROL_PENNYLANE_VALIDATION_FAILED', {
      pennylane_error: sanitizePennylaneValidationError(error),
      retryable: true,
    });
  }

  const finalClient = await db.connect();
  try {
    await finalClient.query('BEGIN');
    const document = await loadDocument(finalClient, { storeId, documentId, forUpdate: true });
    if (!document) {
      await finalClient.query('ROLLBACK');
      return null;
    }
    if (canonicalSupplierControlStatus(document) === 'paye') {
      const currentLinks = await loadActiveLinks(finalClient, { storeId, documentId });
      const currentTotals = totalsFromDocumentAndLinks(document, currentLinks);
      const already = await finalizeAlreadyAppliedValidation(finalClient, {
        storeId,
        document,
        links: currentLinks,
        totals: currentTotals,
        userId,
        comment,
      });
      await finalClient.query('COMMIT');
      return already;
    }

    const currentLinks = await loadActiveLinks(finalClient, { storeId, documentId });
    const currentTotals = totalsFromDocumentAndLinks(document, currentLinks);
    const currentSignature = supplierControlMatchSignature(document, currentLinks, currentTotals);
    const currentEvents = await loadEvents(finalClient, { storeId, documentId, limit: 100 });
    const currentAcceptedDifference = hasDifferenceAccepted(currentEvents, document, currentLinks, currentTotals);
    const currentStatus = statusFromTotals(document, currentTotals);
    const currentSummary = buildValidationSummary(document, currentTotals, currentStatus, {
      acceptedDifference: currentAcceptedDifference,
    });
    if (currentSignature.match_signature !== context.currentSignature.match_signature || !currentSummary.can_validate) {
      await finalClient.query(
        `
        UPDATE pennylane_supplier_invoices
        SET payment_status = $1,
            supplier_control_status = $2,
            updated_at = now()
        WHERE id = $3
          AND store_id = $4
        `,
        ['to_be_paid', 'reconciliation_required', document.id, storeId]
      );
      document.payment_status = 'to_be_paid';
      document.supplier_control_status = 'reconciliation_required';
      const blockingReasons = currentSignature.match_signature !== context.currentSignature.match_signature
        ? [...new Set([...currentSummary.blocking_reasons, 'validation_signature_changed'])]
        : currentSummary.blocking_reasons;
      await insertEvent(finalClient, {
        storeId,
        documentId: document.id,
        eventType: 'validation_reconciliation_required',
        eventKey: `validation_reconciliation_required:${context.currentSignature.match_signature}:${currentSignature.match_signature}`,
        payload: safeValidationPayload({
          supplier_control_status: 'reconciliation_required',
          payment_status: 'to_be_paid',
          blocking_reasons: blockingReasons,
          match_signature: currentSignature.match_signature,
          amount_difference: currentSignature.amount_difference,
          purchase_ids: currentSignature.purchase_ids,
          comment,
        }),
        userId,
      });
      const reconciliationSummary = buildValidationSummary(document, currentTotals, 'reconciliation_required', {
        acceptedDifference: currentAcceptedDifference,
      });
      await finalClient.query('COMMIT');
      throw supplierControlError(
        'Validation Pennylane appliquee mais rapprochement ALTA modifie avant finalisation',
        409,
        'SUPPLIER_CONTROL_VALIDATION_RECONCILIATION_REQUIRED',
        {
          previous_match_signature: context.currentSignature.match_signature,
          current_match_signature: currentSignature.match_signature,
          summary: reconciliationSummary,
        }
      );
    }
    await finalClient.query(
      `
      UPDATE pennylane_supplier_invoices
      SET payment_status = $1,
          supplier_control_status = $2,
          updated_at = now()
      WHERE id = $3
        AND store_id = $4
      `,
      ['to_be_paid', 'valide_a_payer', document.id, storeId]
    );
    document.payment_status = 'to_be_paid';
    document.supplier_control_status = 'valide_a_payer';
    await insertEvent(finalClient, {
      storeId,
      documentId: document.id,
      eventType: 'validation_succeeded',
      eventKey: `validation_succeeded:${currentSignature.match_signature}`,
      payload: safeValidationPayload({
        supplier_control_status: 'valide_a_payer',
        payment_status: 'to_be_paid',
        match_signature: currentSignature.match_signature,
        amount_difference: currentSignature.amount_difference,
        purchase_ids: currentSignature.purchase_ids,
        comment,
      }),
      userId,
    });
    const summary = buildValidationSummary(document, currentTotals, 'valide_a_payer', {
      acceptedDifference: currentAcceptedDifference,
    });
    await finalClient.query('COMMIT');
    return {
      document,
      summary,
      validation: { status: 'succeeded', payment_status: 'to_be_paid' },
    };
  } catch (error) {
    await finalClient.query('ROLLBACK');
    throw error;
  } finally {
    finalClient.release();
  }
}

async function recalculateSupplierControl(client, { storeId, documentId, userId = null, emitEvent = false }) {
  const document = await loadDocument(client, { storeId, documentId, forUpdate: true });
  if (!document) return null;

  const links = await loadActiveLinks(client, { storeId, documentId });
  const totals = totalsFromDocumentAndLinks(document, links);
  const nextStatus = statusFromTotals(document, totals);
  const storedStatus = clean(document.supplier_control_status)?.toLowerCase() || null;

  if (nextStatus !== storedStatus) {
    await client.query(
      `
      UPDATE pennylane_supplier_invoices
      SET supplier_control_status = $1,
          updated_at = now()
      WHERE id = $2
        AND store_id = $3
      `,
      [nextStatus, document.id, storeId]
    );
    document.supplier_control_status = nextStatus;
  }

  const events = await loadEvents(client, { storeId, documentId, limit: 100 });
  const summary = buildValidationSummary(document, totals, nextStatus, {
    acceptedDifference: hasDifferenceAccepted(events, document, links, totals),
  });
  if (emitEvent) {
    await insertEvent(client, {
      storeId,
      documentId: document.id,
      eventType: Math.abs(summary.difference_total) > amountTolerance(summary.invoice_total) ? 'difference' : 'automatic_analysis',
      eventKey: null,
      payload: { recalculated_status: nextStatus, ...summary },
      userId,
    });
  }

  return summary;
}

async function listSupplierControlDocuments(db, { storeId, filters = {} }) {
  const params = [storeId];
  const where = ['psi.store_id = $1', 'psi.pennylane_deleted_at IS NULL'];

  const status = clean(filters.supplier_control_status);
  const statusGroup = clean(filters.status_group);
  if (statusGroup && SUPPLIER_CONTROL_STATUS_GROUPS[statusGroup]) {
    params.push(SUPPLIER_CONTROL_STATUS_GROUPS[statusGroup]);
    where.push(`psi.supplier_control_status = ANY($${params.length}::text[])`);
  } else if (status && CANONICAL_SUPPLIER_CONTROL_STATUSES.has(status)) {
    params.push(status);
    where.push(`psi.supplier_control_status = $${params.length}`);
  }

  const supplierId = clean(filters.supplier_id);
  if (supplierId && isUuid(supplierId)) {
    params.push(supplierId);
    where.push(`psi.supplier_id = $${params.length}`);
  }

  const documentType = clean(filters.document_type);
  if (documentType && DOCUMENT_TYPES.has(documentType)) {
    params.push(documentType);
    where.push(`psi.document_type = $${params.length}`);
  }

  const dateFrom = dateOnly(filters.date_from);
  if (dateFrom) {
    params.push(dateFrom);
    where.push(`psi.invoice_date >= $${params.length}::date`);
  }

  const dateTo = dateOnly(filters.date_to);
  if (dateTo) {
    params.push(dateTo);
    where.push(`psi.invoice_date <= $${params.length}::date`);
  }

  const paymentStatus = clean(filters.payment_status);
  if (paymentStatus) {
    params.push(paymentStatus.toLowerCase());
    where.push(`LOWER(COALESCE(psi.payment_status, '')) = $${params.length}`);
  }

  const search = clean(filters.search);
  if (search) {
    params.push(`%${search}%`);
    where.push(`(
      psi.invoice_number ILIKE $${params.length}
      OR psi.pennylane_supplier_invoice_id ILIKE $${params.length}
      OR COALESCE(psi.external_reference, '') ILIKE $${params.length}
      OR COALESCE(s.name, '') ILIKE $${params.length}
      OR COALESCE(s.code, '') ILIKE $${params.length}
      OR EXISTS (
        SELECT 1
        FROM supplier_control_document_links search_scl
        JOIN purchases search_p
          ON search_p.id = search_scl.purchase_id
         AND search_p.store_id = search_scl.store_id
        WHERE search_scl.store_id = psi.store_id
          AND search_scl.pennylane_supplier_invoice_id = psi.id
          AND search_scl.match_status <> 'removed'
          AND COALESCE(search_p.bl_number, '') ILIKE $${params.length}
      )
    )`);
  }

  const limit = Math.max(1, Math.min(Number(filters.limit || filters.page_size || 50), 200));
  const page = Math.max(1, Number(filters.page || 1));
  const offset = Math.max(0, Number(filters.offset ?? ((page - 1) * limit)));
  const sortKey = clean(filters.sort) || 'invoice_date';
  const direction = String(filters.direction || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const sortColumns = {
    invoice_date: 'invoice_date',
    due_date: 'due_date',
    supplier: 'supplier_name',
    amount: 'amount_ex_vat',
    status: 'supplier_control_status',
    updated_at: 'last_control_action_at',
    last_synced_at: 'last_synced_at',
    last_control_action_at: 'last_control_action_at',
  };
  const sortColumn = sortColumns[sortKey] || sortColumns.invoice_date;
  const { absoluteTolerance, ratioTolerance } = amountToleranceConfig();
  const countParams = [...params];
  const countResult = await db.query(
    `
    SELECT COUNT(*)::int AS total
    FROM pennylane_supplier_invoices psi
    LEFT JOIN suppliers s
      ON s.id = psi.supplier_id
     AND s.store_id = psi.store_id
    WHERE ${where.join(' AND ')}
    `,
    countParams
  );

  const queryParams = [...params];
  queryParams.push(limit);
  const limitParam = queryParams.length;
  queryParams.push(offset);
  const offsetParam = queryParams.length;
  queryParams.push(absoluteTolerance);
  const absoluteToleranceParam = queryParams.length;
  queryParams.push(ratioTolerance);
  const ratioToleranceParam = queryParams.length;

  const result = await db.query(
    `
    WITH active_link_purchases AS (
      SELECT DISTINCT
        scl.store_id,
        scl.pennylane_supplier_invoice_id,
        scl.purchase_id,
        p.total_amount_ex_vat
      FROM supplier_control_document_links scl
      LEFT JOIN purchases p
        ON p.id = scl.purchase_id
       AND p.store_id = scl.store_id
      WHERE scl.match_status <> 'removed'
        AND scl.purchase_id IS NOT NULL
    ), active_links AS (
      SELECT
        scl.store_id,
        scl.pennylane_supplier_invoice_id,
        COUNT(DISTINCT scl.purchase_id) FILTER (WHERE scl.purchase_id IS NOT NULL)::int AS linked_purchase_count,
        COALESCE(SUM(COALESCE(scl.amount_difference, 0)), 0) AS link_amount_difference
      FROM supplier_control_document_links scl
      WHERE scl.match_status <> 'removed'
      GROUP BY scl.store_id, scl.pennylane_supplier_invoice_id
    ), purchase_totals AS (
      SELECT
        store_id,
        pennylane_supplier_invoice_id,
        COALESCE(SUM(COALESCE(total_amount_ex_vat, 0)), 0) AS linked_purchase_total
      FROM active_link_purchases
      GROUP BY store_id, pennylane_supplier_invoice_id
    ), last_events AS (
      SELECT
        store_id,
        pennylane_supplier_invoice_id,
        MAX(created_at) AS last_control_action_at,
        BOOL_OR(event_type = 'expected_credit_note') AS has_expected_credit_note
      FROM supplier_control_events
      GROUP BY store_id, pennylane_supplier_invoice_id
    ), filtered AS (
      SELECT
        psi.id,
        psi.pennylane_supplier_invoice_id,
        psi.document_type,
        psi.invoice_number,
        psi.external_reference,
        psi.supplier_id,
        s.name AS supplier_name,
        s.code AS supplier_code,
        psi.invoice_date,
        psi.due_date,
        psi.amount_ex_vat,
        psi.amount_vat,
        psi.amount_inc_vat,
        psi.currency,
        psi.payment_status,
        psi.supplier_control_status,
        psi.paid,
        COALESCE(al.linked_purchase_count, 0) AS linked_purchase_count,
        COALESCE(pt.linked_purchase_total, 0) AS linked_purchase_total,
        ROUND((ABS(COALESCE(psi.amount_ex_vat, psi.currency_amount_ex_vat, 0)) - COALESCE(pt.linked_purchase_total, 0))::numeric, 4) AS amount_difference,
        ABS(ABS(COALESCE(psi.amount_ex_vat, psi.currency_amount_ex_vat, 0)) - COALESCE(pt.linked_purchase_total, 0))
          > GREATEST($${absoluteToleranceParam}, ABS(COALESCE(psi.amount_ex_vat, psi.currency_amount_ex_vat, 0)) * $${ratioToleranceParam}) AS has_difference,
        COALESCE(le.has_expected_credit_note, false) AS has_expected_credit_note,
        psi.last_synced_at,
        le.last_control_action_at
      FROM pennylane_supplier_invoices psi
      LEFT JOIN suppliers s
        ON s.id = psi.supplier_id
       AND s.store_id = psi.store_id
      LEFT JOIN active_links al
        ON al.pennylane_supplier_invoice_id = psi.id
       AND al.store_id = psi.store_id
      LEFT JOIN purchase_totals pt
        ON pt.pennylane_supplier_invoice_id = psi.id
       AND pt.store_id = psi.store_id
      LEFT JOIN last_events le
        ON le.pennylane_supplier_invoice_id = psi.id
       AND le.store_id = psi.store_id
      WHERE ${where.join(' AND ')}
    )
    SELECT *
    FROM filtered
    ORDER BY ${sortColumn} ${direction} NULLS LAST, id DESC
    LIMIT $${limitParam}
    OFFSET $${offsetParam}
    `,
    queryParams
  );

  const total = countResult.rows[0]?.total || 0;
  return {
    documents: result.rows,
    pagination: {
      total,
      limit,
      offset,
      page,
      has_more: offset + result.rows.length < total,
    },
  };
}

async function getSupplierControlDocument(db, { storeId, pennylaneSupplierInvoiceId }) {
  const document = await loadDocument(db, { storeId, documentId: pennylaneSupplierInvoiceId });
  if (!document) return null;

  const [links, events, lines] = await Promise.all([
    loadActiveLinks(db, { storeId, documentId: document.id }),
    loadEvents(db, { storeId, documentId: document.id }),
    loadPennylaneLines(db, { storeId, documentId: document.id }),
  ]);

  const totals = totalsFromDocumentAndLinks(document, links);
  const purchaseIds = links.map((link) => link.purchase_id).filter(Boolean);
  const purchaseLines = await loadPurchaseLinesForPurchaseIds(db, { storeId, purchaseIds });
  const summary = buildValidationSummary(document, totals, statusFromTotals(document, totals), {
    acceptedDifference: hasDifferenceAccepted(events, document, links, totals),
  });

  return {
    document: {
      ...document,
      supplier_control_status: canonicalSupplierControlStatus(document),
      pdf_available: Boolean(clean(document.public_file_url)),
    },
    links,
    lines_available: lines.length > 0,
    line_matching_available: lines.length > 0,
    lines,
    purchase_lines: purchaseLines,
    events,
    summary,
  };
}

async function listPurchaseCandidates(db, { storeId, documentId, dateWindowDays = 21 }) {
  const document = await loadDocument(db, { storeId, documentId });
  if (!document) return null;
  if (!document.supplier_id) return { document, candidates: [] };

  const windowDays = Math.max(1, Math.min(Number(dateWindowDays || 21), 90));
  const result = await db.query(
    `
    SELECT
      p.id AS purchase_id,
      p.bl_number,
      p.purchase_date,
      p.order_date,
      p.receipt_date,
      p.status AS purchase_status,
      p.total_amount_ex_vat AS total_ex_vat,
      p.invoice_number,
      EXISTS (
        SELECT 1
        FROM supplier_control_document_links scl
        WHERE scl.store_id = p.store_id
          AND scl.purchase_id = p.id
          AND scl.pennylane_supplier_invoice_id = $4
          AND scl.match_status <> 'removed'
      ) AS already_linked,
      EXISTS (
        SELECT 1
        FROM supplier_control_document_links scl
        JOIN pennylane_supplier_invoices linked_psi
          ON linked_psi.id = scl.pennylane_supplier_invoice_id
         AND linked_psi.store_id = scl.store_id
        WHERE scl.store_id = p.store_id
          AND scl.purchase_id = p.id
          AND scl.pennylane_supplier_invoice_id <> $4
          AND scl.match_status <> 'removed'
          AND (
            linked_psi.supplier_control_status IN ('valide_a_payer', 'paye', 'litige', 'avoir_attendu')
            OR linked_psi.paid IS TRUE
            OR LOWER(COALESCE(linked_psi.payment_status, '')) = 'to_be_paid'
            OR LOWER(COALESCE(linked_psi.payment_status, '')) = 'paid'
            OR LOWER(COALESCE(linked_psi.payment_status, '')) LIKE 'paid_%'
          )
      ) AS linked_to_locked_document
    FROM purchases p
    WHERE p.store_id = $1
      AND p.supplier_id = $2
      AND p.status = ANY($3::text[])
      AND (
        $5::date IS NULL
        OR p.receipt_date IS NULL
        OR p.receipt_date BETWEEN ($5::date - ($6::int || ' days')::interval)
          AND ($5::date + ($6::int || ' days')::interval)
      )
    ORDER BY p.receipt_date DESC NULLS LAST, p.created_at DESC
    LIMIT 200
    `,
    [storeId, document.supplier_id, MATCHABLE_PURCHASE_STATUSES, document.id, document.invoice_date || null, windowDays]
  );

  const invoiceTotal = documentAmount(document);
  const candidates = result.rows.map((candidate) => {
    const amountDifference = round(invoiceTotal - toNumber(candidate.total_ex_vat), 4);
    const dateDistance = daysBetween(document.invoice_date, candidate.receipt_date);
    const amountScore = Math.max(0, 1 - Math.abs(amountDifference) / Math.max(invoiceTotal, 1));
    const dateScore = dateDistance === null ? 0.5 : Math.max(0, 1 - dateDistance / windowDays);
    const referenceScore = document.invoice_number && candidate.bl_number &&
      String(document.invoice_number).includes(String(candidate.bl_number)) ? 1 : 0;
    return {
      ...candidate,
      amount_difference: amountDifference,
      score: round((referenceScore * 25) + (amountScore * 55) + (dateScore * 20), 2),
      proposal_reason: referenceScore ? 'reference_bl' : (Math.abs(amountDifference) <= amountTolerance(invoiceTotal) ? 'amount_close' : 'supplier_date'),
    };
  }).sort((left, right) => {
    if (Number(right.already_linked) !== Number(left.already_linked)) return Number(right.already_linked) - Number(left.already_linked);
    if (Number(right.linked_to_locked_document) !== Number(left.linked_to_locked_document)) return Number(left.linked_to_locked_document) - Number(right.linked_to_locked_document);
    return right.score - left.score;
  });

  return { document, candidates };
}

async function loadMatchingPurchases(client, { storeId, document, dateWindowDays = DEFAULT_MATCH_DATE_WINDOW_DAYS }) {
  if (!document.supplier_id) return [];

  const windowDays = Math.max(1, Math.min(Number(dateWindowDays || DEFAULT_MATCH_DATE_WINDOW_DAYS), 90));
  const result = await client.query(
    `
    SELECT
      p.id,
      p.bl_number,
      p.invoice_number,
      p.purchase_date,
      p.order_date,
      p.receipt_date,
      p.status,
      p.supplier_id,
      p.total_amount_ex_vat,
      COALESCE(SUM(COALESCE(pl.line_amount_ex_vat, 0)), 0) AS purchase_lines_total_ex_vat,
      COUNT(pl.id)::int AS purchase_lines_count,
      EXISTS (
        SELECT 1
        FROM supplier_control_document_links scl
        JOIN pennylane_supplier_invoices linked_psi
          ON linked_psi.id = scl.pennylane_supplier_invoice_id
         AND linked_psi.store_id = scl.store_id
        WHERE scl.store_id = p.store_id
          AND scl.purchase_id = p.id
          AND scl.pennylane_supplier_invoice_id <> $4
          AND scl.match_status <> 'removed'
          AND (
            linked_psi.supplier_control_status IN ('valide_a_payer', 'paye', 'litige', 'avoir_attendu')
            OR linked_psi.paid IS TRUE
            OR LOWER(COALESCE(linked_psi.payment_status, '')) = 'to_be_paid'
            OR LOWER(COALESCE(linked_psi.payment_status, '')) = 'paid'
            OR LOWER(COALESCE(linked_psi.payment_status, '')) LIKE 'paid_%'
          )
      ) AS linked_to_locked_document
    FROM purchases p
    LEFT JOIN purchase_lines pl
      ON pl.purchase_id = p.id
     AND pl.store_id = p.store_id
    WHERE p.store_id = $1
      AND p.supplier_id = $2
      AND p.status = ANY($3::text[])
      AND (
        $5::date IS NULL
        OR p.receipt_date IS NULL
        OR p.receipt_date BETWEEN ($5::date - ($6::int || ' days')::interval)
          AND ($5::date + ($6::int || ' days')::interval)
      )
    GROUP BY p.id
    ORDER BY p.receipt_date DESC NULLS LAST, p.created_at DESC
    LIMIT $7
    `,
    [
      storeId,
      document.supplier_id,
      MATCHABLE_PURCHASE_STATUSES,
      document.id,
      document.invoice_date || null,
      windowDays,
      MAX_MATCH_CANDIDATES,
    ]
  );

  return result.rows.map((purchase) => ({
    ...purchase,
    total_amount_ex_vat: effectivePurchaseTotalExVat(purchase),
  }));
}

function buildDifference(type, severity, expected, actual, message, blocking = true) {
  const difference = Number.isFinite(toNumber(expected, NaN)) && Number.isFinite(toNumber(actual, NaN))
    ? round(toNumber(expected) - toNumber(actual), 4)
    : null;
  return { type, severity, expected, actual, difference, message, blocking };
}

function buildControlDifferences(document, totals, { proposals = [], lineMatchingAvailable = false } = {}) {
  const differences = [];
  if (!document.supplier_id) {
    differences.push(buildDifference('supplier_mismatch', 'error', 'supplier_id', null, 'Fournisseur Pennylane non resolu dans ALTA'));
  }
  if (totals.linked_purchase_count <= 0) {
    differences.push(buildDifference('missing_purchase', 'error', 1, 0, 'Aucun BL rapproche'));
  }
  if (Math.abs(totals.difference_total) > amountTolerance(totals.invoice_total)) {
    differences.push(buildDifference(
      'amount_difference',
      'error',
      totals.invoice_total,
      totals.matched_purchase_total,
      'Ecart HT entre facture fournisseur et BL rapproches'
    ));
  }
  if (Number.isFinite(toNumber(totals.difference_vat, NaN)) &&
      Math.abs(totals.difference_vat) > amountTolerance(totals.invoice_vat || 0)) {
    differences.push(buildDifference(
      'vat_difference',
      'warning',
      totals.invoice_vat,
      totals.purchases_vat,
      'Ecart TVA detecte sur donnees fiables'
    ));
  }
  if (proposals.length > 1 && proposals.filter((proposal) => proposal.confidence === 'exact').length > 1) {
    differences.push(buildDifference('multiple_possible_matches', 'warning', 1, proposals.length, 'Plusieurs combinaisons exactes possibles'));
  }
  if (!lineMatchingAvailable) {
    differences.push(buildDifference('manual_review', 'info', 'lignes Pennylane', 'header only', 'Rapprochement ligne facture indisponible', false));
  }
  return differences;
}

function scoreReferenceMatch(document, purchase) {
  const haystack = [
    document.invoice_number,
    document.external_reference,
    document.pennylane_supplier_invoice_id,
  ].filter(Boolean).join(' ').toLowerCase();
  const references = [purchase.bl_number, purchase.invoice_number].filter(Boolean);
  if (!haystack || !references.length) return 0;
  return references.some((reference) => haystack.includes(String(reference).toLowerCase())) ? 1 : 0;
}

function scorePurchase(document, purchase, dateWindowDays) {
  const invoiceTotal = documentAmount(document);
  const purchaseTotal = Math.abs(effectivePurchaseTotalExVat(purchase));
  const difference = round(invoiceTotal - purchaseTotal, 4);
  const dateDistance = daysBetween(document.invoice_date, purchase.receipt_date || purchase.purchase_date || purchase.order_date);
  const amountScore = invoiceTotal <= 0 ? 0 : Math.max(0, 1 - Math.abs(difference) / Math.max(invoiceTotal, purchaseTotal, 1));
  const dateScore = dateDistance === null ? 0.5 : Math.max(0, 1 - dateDistance / Math.max(dateWindowDays, 1));
  const referenceScore = scoreReferenceMatch(document, purchase);
  const lockedPenalty = purchase.linked_to_locked_document ? 50 : 0;
  return {
    ...purchase,
    purchase_ids: [purchase.id],
    purchase_ids_key: String(purchase.id),
    purchase_total_ex_vat: purchaseTotal,
    combination_total_ex_vat: purchaseTotal,
    difference_ex_vat: difference,
    date_distance_days: dateDistance,
    score: round((referenceScore * 25) + (amountScore * 55) + (dateScore * 20) - lockedPenalty, 2),
    reasons: [
      referenceScore ? 'reference_bl' : null,
      Math.abs(difference) <= amountTolerance(invoiceTotal) ? 'amount_within_tolerance' : null,
      dateDistance !== null ? 'date_window' : null,
      purchase.linked_to_locked_document ? 'purchase_locked' : null,
    ].filter(Boolean),
  };
}

function classifyProposal(document, proposal, sameTotalCount) {
  if (proposal.locked) return 'candidate';
  const exactAmount = Math.abs(proposal.difference_ex_vat) <= amountTolerance(documentAmount(document));
  const hasReference = proposal.reasons.includes('reference_bl');
  if (exactAmount && hasReference && proposal.purchase_ids.length === 1 && sameTotalCount === 1) return 'exact';
  if (exactAmount && sameTotalCount === 1) return 'strong_candidate';
  if (exactAmount) return 'ambiguous';
  if (proposal.score >= 70) return 'candidate';
  return 'candidate';
}

function buildProposal(document, purchases, dateWindowDays, sameTotalCount = 1) {
  const scored = purchases.map((purchase) => scorePurchase(document, purchase, dateWindowDays));
  const total = round(scored.reduce((sum, item) => sum + item.purchase_total_ex_vat, 0), 4);
  const difference = round(documentAmount(document) - total, 4);
  const bestDateDistance = Math.min(...scored.map((item) => item.date_distance_days ?? dateWindowDays));
  const referenceScore = scored.some((item) => item.reasons.includes('reference_bl')) ? 1 : 0;
  const amountScore = Math.max(0, 1 - Math.abs(difference) / Math.max(documentAmount(document), total, 1));
  const dateScore = Math.max(0, 1 - bestDateDistance / Math.max(dateWindowDays, 1));
  const locked = scored.some((item) => item.linked_to_locked_document);
  const proposal = {
    purchase_ids: scored.map((item) => item.id),
    purchase_ids_key: scored.map((item) => item.id).sort().join(':'),
    bl_numbers: scored.map((item) => item.bl_number).filter(Boolean),
    purchases: scored.map((item) => ({
      purchase_id: item.id,
      bl_number: item.bl_number,
      receipt_date: item.receipt_date,
      status: item.status,
      total_ex_vat: item.purchase_total_ex_vat,
      linked_to_locked_document: Boolean(item.linked_to_locked_document),
    })),
    combination_total_ex_vat: total,
    difference_ex_vat: difference,
    score: round((referenceScore * 20) + (amountScore * 60) + (dateScore * 20) - (locked ? 50 : 0), 2),
    confidence: 'candidate',
    applicable: !locked,
    locked,
    reasons: [
      scored.length > 1 ? 'multi_bl_combination' : 'single_bl',
      referenceScore ? 'reference_bl' : null,
      Math.abs(difference) <= amountTolerance(documentAmount(document)) ? 'amount_within_tolerance' : 'amount_difference',
      'same_supplier',
      locked ? 'purchase_locked' : null,
    ].filter(Boolean),
  };
  proposal.confidence = classifyProposal(document, proposal, sameTotalCount);
  return proposal;
}

function findCombinationProposals(document, purchases, dateWindowDays) {
  const sorted = purchases
    .map((purchase) => scorePurchase(document, purchase, dateWindowDays))
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_MATCH_CANDIDATES);
  const proposals = [];
  const seen = new Set();
  let explored = 0;

  function visit(start, selected, targetSize) {
    if (explored >= MAX_COMBINATIONS) return;
    if (selected.length === targetSize) {
      const key = selected.map((item) => item.id).sort().join(':');
      if (!seen.has(key)) {
        seen.add(key);
        proposals.push(buildProposal(document, selected, dateWindowDays));
        explored += 1;
      }
      return;
    }
    for (let index = start; index < sorted.length; index += 1) {
      if (explored >= MAX_COMBINATIONS) break;
      visit(index + 1, [...selected, sorted[index]], targetSize);
    }
  }

  for (let size = 1; size <= MAX_COMBINATION_SIZE && explored < MAX_COMBINATIONS; size += 1) {
    visit(0, [], size);
  }
  const byRoundedTotal = new Map();
  for (const proposal of proposals) {
    const exactKey = Math.abs(proposal.difference_ex_vat) <= amountTolerance(documentAmount(document))
      ? 'exact'
      : String(round(proposal.combination_total_ex_vat, 2));
    byRoundedTotal.set(exactKey, (byRoundedTotal.get(exactKey) || 0) + 1);
  }

  return proposals.map((proposal) => ({
    ...proposal,
    confidence: classifyProposal(document, proposal, byRoundedTotal.get('exact') || 0),
  })).sort((left, right) => {
    const confidenceRank = { exact: 4, strong_candidate: 3, ambiguous: 2, candidate: 1, no_match: 0 };
    if (Number(right.applicable) !== Number(left.applicable)) return Number(right.applicable) - Number(left.applicable);
    if (confidenceRank[right.confidence] !== confidenceRank[left.confidence]) {
      return confidenceRank[right.confidence] - confidenceRank[left.confidence];
    }
    return right.score - left.score;
  }).slice(0, 10);
}

async function analyzeSupplierControlMatches(db, {
  storeId,
  documentId,
  userId = null,
  dateWindowDays = DEFAULT_MATCH_DATE_WINDOW_DAYS,
} = {}) {
  if (!isUuid(documentId)) {
    const error = new Error('Identifiant document fournisseur invalide');
    error.status = 400;
    throw error;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const document = await loadDocument(client, { storeId, documentId, forUpdate: true });
    if (!document) {
      await client.query('ROLLBACK');
      return null;
    }

    const currentLinks = await loadActiveLinks(client, { storeId, documentId });
    const lines = await loadPennylaneLines(client, { storeId, documentId });
    const purchases = await loadMatchingPurchases(client, { storeId, document, dateWindowDays });
    const proposals = findCombinationProposals(document, purchases, dateWindowDays);
    const totals = totalsFromDocumentAndLinks(document, currentLinks);
    const events = await loadEvents(client, { storeId, documentId, limit: 100 });
    const summary = buildValidationSummary(document, totals, statusFromTotals(document, totals), {
      acceptedDifference: hasDifferenceAccepted(events, document, currentLinks, totals),
    });
    const exactCount = proposals.filter((proposal) => proposal.confidence === 'exact' || proposal.confidence === 'strong_candidate').length;
    const ambiguous = proposals.some((proposal) => proposal.confidence === 'ambiguous') || exactCount > 1;
    const analysis = {
      result: proposals.length ? (ambiguous ? 'ambiguous' : proposals[0].confidence) : 'no_match',
      confidence: proposals[0]?.confidence || 'no_match',
      reasons: proposals[0]?.reasons || ['no_candidate'],
      candidate_count: purchases.length,
      exact_combination_found: proposals.some((proposal) => Math.abs(proposal.difference_ex_vat) <= amountTolerance(documentAmount(document))),
      ambiguous,
      limits: {
        date_window_days: Math.max(1, Math.min(Number(dateWindowDays || DEFAULT_MATCH_DATE_WINDOW_DAYS), 90)),
        max_candidates: MAX_MATCH_CANDIDATES,
        max_combination_size: MAX_COMBINATION_SIZE,
        max_combinations: MAX_COMBINATIONS,
      },
      line_matching_available: lines.length > 0,
    };
    const differences = buildControlDifferences(document, totals, { proposals, lineMatchingAvailable: lines.length > 0 });

    await insertEvent(client, {
      storeId,
      documentId,
      eventType: 'automatic_analysis',
      eventKey: `automatic_analysis:${documentId}:${JSON.stringify(proposals.map((proposal) => proposal.purchase_ids_key)).slice(0, 120)}`,
      payload: { analysis, differences, proposal_count: proposals.length },
      userId,
    });
    if (differences.some((difference) => difference.type === 'amount_difference' && difference.blocking)) {
      await insertEvent(client, {
        storeId,
        documentId,
        eventType: 'difference_detected',
        eventKey: `difference_detected:${documentId}:${round(totals.difference_total, 4)}`,
        payload: { differences, totals },
        userId,
      });
    }
    await recalculateSupplierControl(client, { storeId, documentId, userId });
    await client.query('COMMIT');

    return {
      document,
      current_links: currentLinks,
      proposals,
      summary,
      analysis,
      differences,
      line_matching_available: lines.length > 0,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function applySupplierControlMatch(db, { storeId, documentId, purchaseIds = [], userId = null }) {
  if (!isUuid(documentId)) {
    const error = new Error('Identifiant document fournisseur invalide');
    error.status = 400;
    throw error;
  }
  const ids = [...new Set((purchaseIds || []).map((id) => clean(id)).filter(Boolean))];
  if (!ids.length || ids.some((id) => !isUuid(id))) {
    const error = new Error('purchase_ids invalide');
    error.status = 400;
    throw error;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const document = await loadDocument(client, { storeId, documentId, forUpdate: true });
    if (!document) {
      await client.query('ROLLBACK');
      return null;
    }
    assertDocumentLinksEditable(document);

    const purchases = [];
    for (const purchaseId of ids) {
      purchases.push(await ensurePurchaseCanBeLinked(client, { storeId, document, purchaseId }));
    }

    const purchasesTotal = round(purchases.reduce((sum, purchase) => sum + effectivePurchaseTotalExVat(purchase), 0), 4);
    const amountDifference = round(documentAmount(document) - purchasesTotal, 4);
    const matchStatus = Math.abs(amountDifference) <= amountTolerance(documentAmount(document)) ? 'matched' : 'difference';

    await client.query(
      `
      UPDATE supplier_control_document_links
      SET match_status = 'removed',
          updated_at = now()
      WHERE store_id = $1
        AND pennylane_supplier_invoice_id = $2
        AND link_type = 'invoice_match'
        AND purchase_line_id IS NULL
        AND match_status <> 'removed'
        AND NOT (purchase_id = ANY($3::uuid[]))
      `,
      [storeId, document.id, ids]
    );

    const links = [];
    for (const purchase of purchases) {
      const inserted = await client.query(
        `
        INSERT INTO supplier_control_document_links(
          id, store_id, pennylane_supplier_invoice_id, purchase_id, link_type, match_status,
          amount_difference, source, matching_method, confidence, validated_by, validated_at, created_by, raw_payload
        )
        VALUES(gen_random_uuid(), $1, $2, $3, 'invoice_match', $4, $5, 'manual', 'manual_apply_match', 100, $6, now(), $6, $7::jsonb)
        ON CONFLICT (store_id, pennylane_supplier_invoice_id, purchase_id, link_type)
          WHERE purchase_id IS NOT NULL AND purchase_line_id IS NULL
        DO UPDATE SET
          match_status = EXCLUDED.match_status,
          amount_difference = EXCLUDED.amount_difference,
          source = 'manual',
          matching_method = 'manual_apply_match',
          confidence = 100,
          validated_by = EXCLUDED.validated_by,
          validated_at = now(),
          updated_at = now(),
          raw_payload = EXCLUDED.raw_payload
        RETURNING *
        `,
        [
          storeId,
          document.id,
          purchase.id,
          matchStatus,
          amountDifference,
          userId,
          JSON.stringify({
            purchase_total_ex_vat: effectivePurchaseTotalExVat(purchase),
            combination_purchase_ids: ids,
            combination_total_ex_vat: purchasesTotal,
            combination_difference_ex_vat: amountDifference,
          }),
        ]
      );
      links.push(inserted.rows[0]);
    }

    await insertEvent(client, {
      storeId,
      documentId: document.id,
      eventType: 'match_applied',
      eventKey: `match_applied:${document.id}:${ids.slice().sort().join(':')}`,
      payload: {
        purchase_ids: ids,
        amount_difference: amountDifference,
        purchases_total_ex_vat: purchasesTotal,
        match_status: matchStatus,
      },
      userId,
    });

    const summary = await recalculateSupplierControl(client, { storeId, documentId: document.id, userId });
    const purchaseLines = await loadPurchaseLinesForPurchaseIds(client, { storeId, purchaseIds: ids });
    await client.query('COMMIT');
    return { links, summary, purchase_lines: purchaseLines };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function resolveSupplierControlDifference(db, {
  storeId,
  documentId,
  resolutionType,
  comment,
  expectedCreditNoteAmount = null,
  userId = null,
}) {
  if (!isUuid(documentId)) {
    const error = new Error('Identifiant document fournisseur invalide');
    error.status = 400;
    throw error;
  }
  const type = clean(resolutionType);
  if (!DIFFERENCE_RESOLUTION_TYPES.has(type)) {
    const error = new Error('resolution_type invalide');
    error.status = 400;
    throw error;
  }
  const text = clean(comment);
  if (!text) {
    const error = new Error('commentaire obligatoire');
    error.status = 400;
    error.code = 'SUPPLIER_CONTROL_RESOLUTION_COMMENT_REQUIRED';
    throw error;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const document = await loadDocument(client, { storeId, documentId, forUpdate: true });
    if (!document) {
      await client.query('ROLLBACK');
      return null;
    }
    assertDocumentLinksEditable(document);

    const links = await loadActiveLinks(client, { storeId, documentId });
    const totals = totalsFromDocumentAndLinks(document, links);
    const currentSignature = supplierControlMatchSignature(document, links, totals);
    const nextStatus = type === 'supplier_credit_note_expected'
      ? 'avoir_attendu'
      : (type === 'dispute' ? 'litige' : 'ecart');
    const eventType = type === 'supplier_credit_note_expected'
      ? 'expected_credit_note'
      : (type === 'dispute' ? 'dispute_opened' : 'difference_accepted');
    const resolutionPayload = {
      resolution_type: type,
      comment: text,
      amount_difference: type === 'accepted_difference' ? currentSignature.amount_difference : totals.difference_total,
      expected_credit_note_amount: expectedCreditNoteAmount === null ? null : round(expectedCreditNoteAmount, 4),
    };
    if (type === 'accepted_difference') {
      resolutionPayload.purchase_ids = currentSignature.purchase_ids;
      resolutionPayload.match_signature = currentSignature.match_signature;
    }

    await insertEvent(client, {
      storeId,
      documentId: document.id,
      eventType,
      eventKey: type === 'accepted_difference'
        ? `${eventType}:${currentSignature.match_signature}`
        : `${eventType}:${document.id}:${round(totals.difference_total, 4)}`,
      payload: resolutionPayload,
      userId,
    });

    await client.query(
      `
      UPDATE pennylane_supplier_invoices
      SET supplier_control_status = $1,
          updated_at = now()
      WHERE id = $2
        AND store_id = $3
      `,
      [nextStatus, document.id, storeId]
    );
    document.supplier_control_status = nextStatus;

    const summary = buildValidationSummary(document, totals, nextStatus, {
      acceptedDifference: type === 'accepted_difference' &&
        hasDifferenceAccepted([{
          event_type: 'difference_accepted',
          payload: currentSignature,
        }], document, links, totals),
    });
    await client.query('COMMIT');
    return { document, summary };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ensurePurchaseCanBeLinked(client, { storeId, document, purchaseId }) {
  const purchase = await client.query(
    `
    SELECT p.*, s.name AS supplier_name, s.code AS supplier_code
    FROM purchases p
    LEFT JOIN suppliers s
      ON s.id = p.supplier_id
     AND s.store_id = p.store_id
    WHERE p.id = $1
      AND p.store_id = $2
    LIMIT 1
    FOR UPDATE OF p
    `,
    [purchaseId, storeId]
  );
  const row = purchase.rows[0] || null;
  if (!row) {
    const error = new Error('BL fournisseur introuvable');
    error.status = 404;
    throw error;
  }
  if (String(row.supplier_id) !== String(document.supplier_id)) {
    const error = new Error('Fournisseur du BL incoherent avec le document Pennylane');
    error.status = 409;
    error.code = 'SUPPLIER_CONTROL_PURCHASE_SUPPLIER_MISMATCH';
    throw error;
  }
  if (!MATCHABLE_PURCHASE_STATUSES.includes(row.status)) {
    const error = new Error('Statut BL non rapprochable');
    error.status = 409;
    error.code = 'SUPPLIER_CONTROL_PURCHASE_STATUS_BLOCKED';
    throw error;
  }

  const incompatible = await client.query(
    `
    SELECT
      scl.id,
      linked_psi.id AS linked_document_id,
      linked_psi.invoice_number,
      linked_psi.supplier_control_status,
      linked_psi.payment_status,
      linked_psi.paid
    FROM supplier_control_document_links scl
    JOIN pennylane_supplier_invoices linked_psi
      ON linked_psi.id = scl.pennylane_supplier_invoice_id
     AND linked_psi.store_id = scl.store_id
    WHERE scl.store_id = $1
      AND scl.purchase_id = $2
      AND scl.pennylane_supplier_invoice_id <> $3
      AND scl.match_status <> 'removed'
      AND (
        linked_psi.supplier_control_status IN ('valide_a_payer', 'paye', 'litige', 'avoir_attendu')
        OR linked_psi.paid IS TRUE
        OR LOWER(COALESCE(linked_psi.payment_status, '')) = 'to_be_paid'
        OR LOWER(COALESCE(linked_psi.payment_status, '')) = 'paid'
        OR LOWER(COALESCE(linked_psi.payment_status, '')) LIKE 'paid_%'
      )
    LIMIT 1
    `,
    [storeId, purchaseId, document.id]
  );
  if (incompatible.rows.length) {
    const error = new Error('BL deja lie a un document fournisseur valide ou paye');
    error.status = 409;
    error.code = 'SUPPLIER_CONTROL_PURCHASE_ALREADY_LOCKED';
    error.details = incompatible.rows[0];
    throw error;
  }

  const legacyLocked = await client.query(
    `
    SELECT si.id, si.invoice_number, si.status, si.pennylane_status
    FROM supplier_invoice_matches sim
    JOIN supplier_invoices si
      ON si.id = sim.supplier_invoice_id
     AND si.store_id = sim.store_id
    WHERE sim.store_id = $1
      AND sim.purchase_id = $2
      AND si.status IN ('invoice_validated', 'cost_adjusted', 'sent_to_pennylane')
      AND COALESCE(si.pennylane_payload->>'pennylane_supplier_invoice_id', '') <> COALESCE($3, '')
    LIMIT 1
    `,
    [storeId, purchaseId, document.pennylane_supplier_invoice_id]
  );
  if (legacyLocked.rows.length) {
    const error = new Error('BL deja valide historiquement sur une autre facture fournisseur');
    error.status = 409;
    error.code = 'SUPPLIER_CONTROL_PURCHASE_LEGACY_LOCKED';
    error.details = legacyLocked.rows[0];
    throw error;
  }

  return row;
}

async function addPurchaseLink(db, { storeId, documentId, purchaseId, userId = null }) {
  if (!isUuid(documentId) || !isUuid(purchaseId)) {
    const error = new Error('Identifiant document ou BL invalide');
    error.status = 400;
    throw error;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const document = await loadDocument(client, { storeId, documentId, forUpdate: true });
    if (!document) {
      await client.query('ROLLBACK');
      return null;
    }
    assertDocumentLinksEditable(document);
    const purchase = await ensurePurchaseCanBeLinked(client, { storeId, document, purchaseId });
    const amountDifference = round(documentAmount(document) - toNumber(purchase.total_amount_ex_vat), 4);

    const inserted = await client.query(
      `
      INSERT INTO supplier_control_document_links(
        id, store_id, pennylane_supplier_invoice_id, purchase_id, link_type, match_status,
        amount_difference, source, matching_method, created_by, raw_payload
      )
      VALUES(gen_random_uuid(), $1, $2, $3, 'invoice_match', $4, $5, 'manual', 'manual_purchase_link', $6, $7::jsonb)
      ON CONFLICT (store_id, pennylane_supplier_invoice_id, purchase_id, link_type)
        WHERE purchase_id IS NOT NULL AND purchase_line_id IS NULL
      DO UPDATE SET
        match_status = CASE
          WHEN supplier_control_document_links.match_status = 'removed' THEN EXCLUDED.match_status
          ELSE supplier_control_document_links.match_status
        END,
        amount_difference = EXCLUDED.amount_difference,
        source = 'manual',
        matching_method = 'manual_purchase_link',
        updated_at = now()
      RETURNING *
      `,
      [
        storeId,
        document.id,
        purchase.id,
        Math.abs(amountDifference) <= amountTolerance(documentAmount(document)) ? 'matched' : 'difference',
        amountDifference,
        userId,
        JSON.stringify({ purchase_total_ex_vat: purchase.total_amount_ex_vat }),
      ]
    );

    await insertEvent(client, {
      storeId,
      documentId: document.id,
      eventType: 'match_added',
      eventKey: `manual_purchase_link:${document.id}:${purchase.id}`,
      payload: { purchase_id: purchase.id, amount_difference: amountDifference },
      userId,
    });
    const summary = await recalculateSupplierControl(client, { storeId, documentId: document.id, userId });
    await client.query('COMMIT');
    return { link: inserted.rows[0], summary };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function removePurchaseLink(db, { storeId, documentId, purchaseId, userId = null }) {
  if (!isUuid(documentId) || !isUuid(purchaseId)) {
    const error = new Error('Identifiant document ou BL invalide');
    error.status = 400;
    throw error;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const document = await loadDocument(client, { storeId, documentId, forUpdate: true });
    if (!document) {
      await client.query('ROLLBACK');
      return null;
    }
    assertDocumentLinksEditable(document);

    const updated = await client.query(
      `
      UPDATE supplier_control_document_links
      SET match_status = 'removed',
          updated_at = now()
      WHERE store_id = $1
        AND pennylane_supplier_invoice_id = $2
        AND purchase_id = $3
        AND purchase_line_id IS NULL
        AND link_type = 'invoice_match'
        AND match_status <> 'removed'
      RETURNING *
      `,
      [storeId, document.id, purchaseId]
    );

    await insertEvent(client, {
      storeId,
      documentId: document.id,
      eventType: 'match_removed',
      eventKey: `manual_purchase_unlink:${document.id}:${purchaseId}:${Date.now()}`,
      payload: { purchase_id: purchaseId, removed_count: updated.rows.length },
      userId,
    });
    const summary = await recalculateSupplierControl(client, { storeId, documentId: document.id, userId });
    await client.query('COMMIT');
    return { removed: updated.rows.length, summary };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  CANONICAL_SUPPLIER_CONTROL_STATUSES,
  DOCUMENT_TYPES,
  DIFFERENCE_RESOLUTION_TYPES,
  MATCHABLE_PURCHASE_STATUSES,
  analyzeSupplierControlMatches,
  amountToleranceConfig,
  amountTolerance,
  applySupplierControlMatch,
  assertDocumentLinksEditable,
  canonicalSupplierControlStatus,
  clean,
  getSupplierControlDocument,
  isPaidStatus,
  isUuid,
  listPurchaseCandidates,
  listSupplierControlDocuments,
  recalculateSupplierControl,
  resolveSupplierControlDifference,
  validateSupplierControlDocument,
  addPurchaseLink,
  removePurchaseLink,
  supplierControlMatchSignature,
  totalsFromDocumentAndLinks,
};
