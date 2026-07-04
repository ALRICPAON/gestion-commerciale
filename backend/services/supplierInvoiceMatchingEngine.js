const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_DATE_WINDOW_DAYS = 21;
const DEFAULT_AMOUNT_TOLERANCE = 1;
const DEFAULT_AMOUNT_RATIO_TOLERANCE = 0.005;

const FINAL_ALTA_STATUSES = new Set(['validee_a_payer', 'payee', 'litige', 'refusee']);
const MATCHABLE_PURCHASE_STATUSES = ['received', 'received_pending_invoice', 'invoice_difference'];

function toNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(toNumber(value) * factor) / factor;
}

function daysBetween(left, right) {
  if (!left || !right) return null;
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) return null;
  return Math.abs(leftDate.getTime() - rightDate.getTime()) / 86400000;
}

function amountTolerance(amount) {
  const absoluteTolerance = Number(process.env.PENNYLANE_SUPPLIER_GLOBAL_AMOUNT_TOLERANCE) || DEFAULT_AMOUNT_TOLERANCE;
  const ratioTolerance = Number(process.env.PENNYLANE_SUPPLIER_GLOBAL_AMOUNT_RATIO_TOLERANCE) ||
    DEFAULT_AMOUNT_RATIO_TOLERANCE;
  return Math.max(absoluteTolerance, Math.abs(toNumber(amount)) * ratioTolerance);
}

function amountMatches(left, right) {
  return Math.abs(toNumber(left) - toNumber(right)) <= amountTolerance(left);
}

function scoreNumericCloseness(left, right) {
  const leftValue = Math.abs(toNumber(left, NaN));
  const rightValue = Math.abs(toNumber(right, NaN));
  if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return 0;
  if (leftValue === 0 && rightValue === 0) return 1;
  if (leftValue === 0 || rightValue === 0) return 0;
  return Math.max(0, 1 - Math.abs(leftValue - rightValue) / Math.max(leftValue, rightValue, 1));
}

async function loadInvoice(client, invoiceId, storeId) {
  const invoice = await client.query(
    `
    SELECT psi.*, s.name supplier_name, s.code supplier_code
    FROM pennylane_supplier_invoices psi
    LEFT JOIN suppliers s ON s.id = psi.supplier_id AND s.store_id = psi.store_id
    WHERE psi.id = $1
      AND psi.store_id = $2
    LIMIT 1
    `,
    [invoiceId, storeId]
  );

  if (!invoice.rows.length) return null;

  const lines = await client.query(
    `
    SELECT *
    FROM pennylane_supplier_invoice_lines
    WHERE supplier_invoice_id = $1
      AND store_id = $2
    ORDER BY line_position ASC, created_at ASC
    `,
    [invoiceId, storeId]
  );

  return { invoice: invoice.rows[0], lines: lines.rows };
}

async function loadGlobalPurchaseCandidates(client, invoice, dateWindowDays) {
  if (!invoice.supplier_id) return [];

  const result = await client.query(
    `
    SELECT
      p.id purchase_id,
      p.bl_number,
      p.receipt_date,
      p.status purchase_status,
      COALESCE(NULLIF(p.total_amount_ex_vat, 0), SUM(COALESCE(pl.line_amount_ex_vat, 0)), 0) AS purchase_amount_ex_vat,
      SUM(COALESCE(pl.line_amount_ex_vat, 0)) AS purchase_lines_amount_ex_vat,
      COUNT(pl.id)::int AS purchase_lines_count
    FROM purchases p
    LEFT JOIN purchase_lines pl
      ON pl.purchase_id = p.id
     AND pl.store_id = p.store_id
    WHERE p.store_id = $1
      AND p.supplier_id = $2
      AND p.status = ANY($3::text[])
      AND NOT EXISTS (
        SELECT 1
        FROM pennylane_supplier_invoice_match_results mr
        WHERE mr.store_id = p.store_id
          AND mr.purchase_id = p.id
          AND mr.supplier_invoice_id <> $4
          AND mr.match_status = 'conforme'
      )
      AND (
        $5::date IS NULL
        OR p.receipt_date IS NULL
        OR p.receipt_date BETWEEN ($5::date - ($6::int || ' days')::interval)
          AND ($5::date + ($6::int || ' days')::interval)
      )
    GROUP BY p.id, p.bl_number, p.receipt_date, p.status, p.total_amount_ex_vat
    ORDER BY p.receipt_date DESC NULLS LAST, p.created_at DESC
    LIMIT 200
    `,
    [
      invoice.store_id,
      invoice.supplier_id,
      MATCHABLE_PURCHASE_STATUSES,
      invoice.id,
      invoice.invoice_date || null,
      dateWindowDays,
    ]
  );

  return result.rows;
}

function scorePurchaseCandidate(invoice, candidate, dateWindowDays) {
  const invoiceExVat = toNumber(invoice.amount_ex_vat ?? invoice.currency_amount_ex_vat);
  const purchaseExVat = toNumber(candidate.purchase_amount_ex_vat);
  const amountScore = scoreNumericCloseness(invoiceExVat, purchaseExVat);
  const dateDistance = daysBetween(invoice.invoice_date, candidate.receipt_date);
  const dateScore = dateDistance === null ? 0.5 : Math.max(0, 1 - dateDistance / Math.max(dateWindowDays, 1));
  const exactAmount = amountMatches(invoiceExVat, purchaseExVat);
  const score = round((amountScore * 75) + (dateScore * 25), 2);

  return {
    ...candidate,
    invoice_amount_ex_vat: invoiceExVat,
    purchase_amount_ex_vat: purchaseExVat,
    amount_difference: round(invoiceExVat - purchaseExVat, 4),
    date_distance_days: dateDistance,
    amount_score: round(amountScore, 4),
    date_score: round(dateScore, 4),
    exact_amount: exactAmount,
    score,
  };
}

function rankGlobalCandidates(invoice, candidates, dateWindowDays) {
  return candidates
    .map((candidate) => scorePurchaseCandidate(invoice, candidate, dateWindowDays))
    .sort((left, right) => {
      if (Number(right.exact_amount) !== Number(left.exact_amount)) {
        return Number(right.exact_amount) - Number(left.exact_amount);
      }
      return right.score - left.score;
    });
}

function buildGlobalResult(invoice, candidate, matchStatus, anomalyCode = null, anomalyLabel = null) {
  return {
    store_id: invoice.store_id,
    supplier_invoice_id: invoice.id,
    supplier_invoice_line_id: null,
    supplier_id: invoice.supplier_id,
    article_id: null,
    purchase_id: candidate?.purchase_id || null,
    purchase_line_id: null,
    lot_id: null,
    match_source: candidate ? 'global_amount_date' : 'none',
    match_status: matchStatus,
    anomaly_code: anomalyCode,
    anomaly_label: anomalyLabel,
    supplier_reference: null,
    invoice_label: invoice.invoice_number || 'Facture fournisseur Pennylane',
    article_label: 'Rapprochement global facture',
    purchase_bl_number: candidate?.bl_number || null,
    purchase_receipt_date: candidate?.receipt_date || null,
    ordered_quantity: null,
    received_quantity: null,
    invoice_quantity: null,
    purchase_unit_price_ex_vat: null,
    invoice_unit_price_ex_vat: null,
    quantity_difference: null,
    unit_price_difference: null,
    amount_difference: candidate?.amount_difference ?? null,
    vat_difference: null,
    invoice_amount_ex_vat: toNumber(invoice.amount_ex_vat ?? invoice.currency_amount_ex_vat),
    purchase_amount_ex_vat: candidate?.purchase_amount_ex_vat ?? null,
    invoice_vat_amount: toNumber(invoice.amount_vat ?? invoice.currency_amount_vat),
    confidence: candidate?.score ?? 0,
    ai_context: {
      mode: 'global_amount_date',
      invoice_number: invoice.invoice_number,
      supplier_name: invoice.supplier_name,
      invoice_date: invoice.invoice_date,
      invoice_amount_ex_vat: toNumber(invoice.amount_ex_vat ?? invoice.currency_amount_ex_vat),
      invoice_amount_vat: toNumber(invoice.amount_vat ?? invoice.currency_amount_vat),
      invoice_amount_inc_vat: toNumber(invoice.amount_inc_vat ?? invoice.currency_amount_inc_vat),
      purchase_amount_ex_vat: candidate?.purchase_amount_ex_vat ?? null,
      amount_tolerance: amountTolerance(invoice.amount_ex_vat ?? invoice.currency_amount_ex_vat),
      recommendation: anomalyCode ? 'controle_manuel' : 'proposition_rapprochement',
    },
    raw_payload: {
      mode: 'global_amount_date',
      candidate: candidate || null,
    },
  };
}

function summarizeGlobal(invoice, candidates, result) {
  const isMatched = result?.match_status === 'conforme';
  const hasAmountMismatch = result?.match_status === 'ecart_prix';

  return {
    line_count: 0,
    matched_lines: isMatched ? 1 : 0,
    conform_lines: isMatched ? 1 : 0,
    anomaly_count: hasAmountMismatch ? 1 : 0,
    bl_count: candidates.length,
    conformity_score: isMatched ? 100 : 0,
    total_ex_vat_difference: result?.amount_difference ?? null,
    total_vat_difference: null,
    anomaly_counts: hasAmountMismatch ? { ecart_prix: 1 } : {},
    mode: 'global_amount_date',
    candidate_count: candidates.length,
  };
}

function statusFromSummary(invoice, summary) {
  if (invoice.paid === true || invoice.payment_status === 'paid') return 'payee';
  if (!invoice.supplier_id) return 'a_rapprocher';
  if (summary.mode === 'global_amount_date') {
    if (!summary.candidate_count) return 'a_rapprocher';
    if (summary.anomaly_count) return 'ecart_prix';
    return 'en_controle';
  }
  return 'a_rapprocher';
}

async function persistResults(client, invoice, results, summary) {
  await client.query('DELETE FROM pennylane_supplier_invoice_match_results WHERE supplier_invoice_id = $1', [invoice.id]);

  for (const result of results) {
    await client.query(
      `
      INSERT INTO pennylane_supplier_invoice_match_results(
        id, store_id, supplier_invoice_id, supplier_invoice_line_id, supplier_id,
        article_id, purchase_id, purchase_line_id, lot_id,
        match_source, match_status, anomaly_code, anomaly_label,
        supplier_reference, invoice_label, article_label,
        purchase_bl_number, purchase_receipt_date,
        ordered_quantity, received_quantity, invoice_quantity,
        purchase_unit_price_ex_vat, invoice_unit_price_ex_vat,
        quantity_difference, unit_price_difference, amount_difference, vat_difference,
        invoice_amount_ex_vat, purchase_amount_ex_vat, invoice_vat_amount,
        confidence, ai_context, raw_payload
      )
      VALUES(
        gen_random_uuid(), $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15,
        $16, $17::date,
        $18, $19, $20,
        $21, $22,
        $23, $24, $25, $26,
        $27, $28, $29,
        $30, $31::jsonb, $32::jsonb
      )
      `,
      [
        result.store_id,
        result.supplier_invoice_id,
        result.supplier_invoice_line_id,
        result.supplier_id,
        result.article_id,
        result.purchase_id,
        result.purchase_line_id,
        result.lot_id,
        result.match_source,
        result.match_status,
        result.anomaly_code,
        result.anomaly_label,
        result.supplier_reference,
        result.invoice_label,
        result.article_label,
        result.purchase_bl_number,
        result.purchase_receipt_date,
        result.ordered_quantity,
        result.received_quantity,
        result.invoice_quantity,
        result.purchase_unit_price_ex_vat,
        result.invoice_unit_price_ex_vat,
        result.quantity_difference,
        result.unit_price_difference,
        result.amount_difference,
        result.vat_difference,
        result.invoice_amount_ex_vat,
        result.purchase_amount_ex_vat,
        result.invoice_vat_amount,
        result.confidence,
        JSON.stringify(result.ai_context),
        JSON.stringify(result.raw_payload),
      ]
    );
  }

  const altaStatus = FINAL_ALTA_STATUSES.has(invoice.alta_business_status)
    ? invoice.alta_business_status
    : statusFromSummary(invoice, summary);

  await client.query(
    `
    UPDATE pennylane_supplier_invoices
    SET alta_business_status = $2,
        match_status = CASE WHEN $3::int = 0 AND $4::int > 0 THEN 'matched' ELSE 'pending' END,
        auto_match_status = 'success',
        auto_match_summary = $5::jsonb,
        auto_match_last_error = NULL,
        auto_matched_at = now(),
        auto_bl_count = $6,
        auto_matched_lines_count = $7,
        auto_anomaly_count = $3,
        auto_conformity_score = $8,
        updated_at = now()
    WHERE id = $1
    `,
    [
      invoice.id,
      altaStatus,
      summary.anomaly_count,
      summary.candidate_count,
      JSON.stringify(summary),
      summary.bl_count,
      summary.matched_lines,
      summary.conformity_score,
    ]
  );
}

async function analyzePennylaneSupplierInvoice(db, { invoiceId, storeId, dateWindowDays = DEFAULT_DATE_WINDOW_DAYS }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const loaded = await loadInvoice(client, invoiceId, storeId);
    if (!loaded) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'NOT_FOUND' };
    }

    const { invoice } = loaded;
    if (FINAL_ALTA_STATUSES.has(invoice.alta_business_status)) {
      await client.query('ROLLBACK');
      return { ok: true, skipped: true, reason: 'FINAL_STATUS', invoice_id: invoice.id };
    }

    await client.query(
      `
      UPDATE pennylane_supplier_invoices
      SET alta_business_status = 'analyse_automatique',
          auto_match_status = 'processing',
          auto_match_last_error = NULL,
          updated_at = now()
      WHERE id = $1
      `,
      [invoice.id]
    );

    const candidates = await loadGlobalPurchaseCandidates(client, invoice, dateWindowDays);
    const ranked = rankGlobalCandidates(invoice, candidates, dateWindowDays);
    const best = ranked[0] || null;
    const result = best
      ? buildGlobalResult(
        invoice,
        best,
        best.exact_amount ? 'conforme' : 'ecart_prix',
        best.exact_amount ? null : 'ecart_prix',
        best.exact_amount ? null : 'Montant HT facture different du total HT receptionne'
      )
      : buildGlobalResult(invoice, null, 'unmatched');

    const summary = summarizeGlobal(invoice, ranked, result);
    await persistResults(client, invoice, best ? [result, ...ranked.slice(1, 5).map((candidate) => (
      buildGlobalResult(invoice, candidate, candidate.exact_amount ? 'conforme' : 'ecart_prix',
        candidate.exact_amount ? null : 'ecart_prix',
        candidate.exact_amount ? null : 'Montant HT facture different du total HT receptionne')
    ))] : [], summary);
    await client.query('COMMIT');

    return { ok: true, invoice_id: invoice.id, ...summary };
  } catch (error) {
    await client.query('ROLLBACK');
    await db.query(
      `
      UPDATE pennylane_supplier_invoices
      SET auto_match_status = 'failed',
          auto_match_last_error = $2,
          alta_business_status = CASE
            WHEN alta_business_status IN ('validee_a_payer', 'payee', 'litige', 'refusee') THEN alta_business_status
            ELSE 'controle_manuel'
          END,
          updated_at = now()
      WHERE id = $1
      `,
      [invoiceId, error.message]
    ).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function processPendingPennylaneSupplierInvoiceMatching(db, options = {}) {
  const batchSize = Math.max(
    1,
    Math.min(Number(options.batchSize || process.env.PENNYLANE_SUPPLIER_INVOICE_MATCH_BATCH_SIZE) || DEFAULT_BATCH_SIZE, 100)
  );
  const storeId = options.storeId || null;
  const params = [];
  const where = [
    "psi.sync_status = 'synced'",
    'psi.pennylane_deleted_at IS NULL',
    "psi.alta_business_status NOT IN ('validee_a_payer', 'payee', 'litige', 'refusee')",
    "(psi.auto_matched_at IS NULL OR psi.last_synced_at IS NULL OR psi.last_synced_at > psi.auto_matched_at)",
  ];

  if (storeId) {
    params.push(storeId);
    where.push(`psi.store_id = $${params.length}`);
  }

  params.push(batchSize);
  const invoices = await db.query(
    `
    SELECT psi.id, psi.store_id
    FROM pennylane_supplier_invoices psi
    WHERE ${where.join(' AND ')}
    ORDER BY psi.last_synced_at ASC NULLS FIRST, psi.created_at ASC
    LIMIT $${params.length}
    `,
    params
  );

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const invoice of invoices.rows) {
    processed += 1;
    try {
      await analyzePennylaneSupplierInvoice(db, {
        invoiceId: invoice.id,
        storeId: invoice.store_id,
        dateWindowDays: options.dateWindowDays || DEFAULT_DATE_WINDOW_DAYS,
      });
      succeeded += 1;
    } catch (error) {
      failed += 1;
      console.error('[Supplier invoice matching] erreur analyse automatique globale', {
        invoice_id: invoice.id,
        message: error.message,
      });
    }
  }

  return { processed, succeeded, failed, skipped: false };
}

async function buildPennylaneSupplierInvoiceMatchingDebug(db, { invoiceId, storeId, dateWindowDays = DEFAULT_DATE_WINDOW_DAYS }) {
  const client = await db.connect();
  try {
    const loaded = await loadInvoice(client, invoiceId, storeId);
    if (!loaded) return { found: false };

    const { invoice, lines } = loaded;
    const candidates = await loadGlobalPurchaseCandidates(client, invoice, dateWindowDays);
    const ranked = rankGlobalCandidates(invoice, candidates, dateWindowDays);

    return {
      found: true,
      mode: 'global_amount_date',
      pennylane_supplier: {
        pennylane_supplier_id: invoice.pennylane_supplier_id,
        supplier_name: invoice.supplier_name,
        supplier_code: invoice.supplier_code,
      },
      alta_supplier_id: invoice.supplier_id,
      invoice_date: invoice.invoice_date,
      invoice_lines_count: lines.length,
      invoice_amounts: {
        amount_ex_vat: invoice.amount_ex_vat ?? invoice.currency_amount_ex_vat,
        amount_vat: invoice.amount_vat ?? invoice.currency_amount_vat,
        amount_inc_vat: invoice.amount_inc_vat ?? invoice.currency_amount_inc_vat,
      },
      amount_tolerance: amountTolerance(invoice.amount_ex_vat ?? invoice.currency_amount_ex_vat),
      candidate_purchase_count: ranked.length,
      candidates_sample: ranked.slice(0, 10),
      reasons_for_article_unknown: [],
    };
  } finally {
    client.release();
  }
}

module.exports = {
  analyzePennylaneSupplierInvoice,
  buildPennylaneSupplierInvoiceMatchingDebug,
  processPendingPennylaneSupplierInvoiceMatching,
};
