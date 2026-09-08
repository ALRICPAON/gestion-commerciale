const CANONICAL_SUPPLIER_CONTROL_STATUSES = new Set([
  'a_rapprocher',
  'a_controler',
  'ecart',
  'avoir_attendu',
  'conforme',
  'valide_a_payer',
  'paye',
  'litige',
]);

const DOCUMENT_TYPES = new Set(['invoice', 'credit_note']);
const MATCHABLE_PURCHASE_STATUSES = ['received', 'received_pending_invoice', 'invoice_difference', 'invoice_matched'];
const FINAL_CONTROL_STATUSES = new Set(['paye', 'valide_a_payer', 'litige', 'avoir_attendu']);
const LINK_EDIT_LOCKED_CONTROL_STATUSES = new Set(['valide_a_payer', 'paye', 'litige', 'avoir_attendu']);
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

  if (['litige', 'refusee'].includes(altaStatus)) return 'litige';
  if (paymentStatus === 'to_be_paid' || altaStatus === 'validee_a_payer') return 'valide_a_payer';
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

function buildValidationSummary(document, totals, controlStatus = canonicalSupplierControlStatus(document)) {
  const status = controlStatus;
  const blockingReasons = [];

  if (document.pennylane_deleted_at) blockingReasons.push('document_supprime_pennylane');
  if (status === 'paye') blockingReasons.push('document_deja_paye');
  if (status === 'litige') blockingReasons.push('document_en_litige');
  if (!document.supplier_id) blockingReasons.push('fournisseur_inconnu');
  if (totals.linked_purchase_count <= 0) blockingReasons.push('aucun_bl_rapproche');
  if (Math.abs(totals.difference_total) > amountTolerance(totals.invoice_total)) {
    blockingReasons.push('difference_non_resolue');
  }

  return {
    invoice_total: totals.invoice_total,
    matched_purchase_total: totals.matched_purchase_total,
    difference_total: totals.difference_total,
    linked_purchase_count: totals.linked_purchase_count,
    control_status: status,
    can_validate: blockingReasons.length === 0 && ['conforme', 'valide_a_payer'].includes(status),
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
  const byPurchase = new Map();
  for (const link of links) {
    if (!link.purchase_id) continue;
    const key = String(link.purchase_id);
    if (!byPurchase.has(key)) {
      byPurchase.set(key, toNumber(link.purchase_total_ex_vat));
    }
  }
  const matchedPurchaseTotal = round([...byPurchase.values()].reduce((sum, value) => sum + value, 0), 4);
  return {
    invoice_total: invoiceTotal,
    matched_purchase_total: matchedPurchaseTotal,
    difference_total: round(invoiceTotal - matchedPurchaseTotal, 4),
    linked_purchase_count: byPurchase.size,
  };
}

async function insertEvent(client, { storeId, documentId, eventType, eventKey = null, payload = {}, userId = null }) {
  await client.query(
    `
    INSERT INTO supplier_control_events(
      id, store_id, pennylane_supplier_invoice_id, event_type, event_key, payload, created_by
    )
    VALUES(gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6)
    ON CONFLICT DO NOTHING
    `,
    [storeId, documentId, eventType, eventKey, JSON.stringify(payload), userId]
  );
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

  const summary = buildValidationSummary(document, totals, nextStatus);
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
  if (status && CANONICAL_SUPPLIER_CONTROL_STATUSES.has(status)) {
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
  const summary = buildValidationSummary(document, totals, statusFromTotals(document, totals));

  return {
    document: {
      ...document,
      supplier_control_status: canonicalSupplierControlStatus(document),
      pdf_available: Boolean(clean(document.public_file_url)),
    },
    links,
    lines_available: lines.length > 0,
    lines,
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
  MATCHABLE_PURCHASE_STATUSES,
  amountToleranceConfig,
  amountTolerance,
  assertDocumentLinksEditable,
  canonicalSupplierControlStatus,
  clean,
  getSupplierControlDocument,
  isPaidStatus,
  isUuid,
  listPurchaseCandidates,
  listSupplierControlDocuments,
  recalculateSupplierControl,
  addPurchaseLink,
  removePurchaseLink,
  totalsFromDocumentAndLinks,
};
