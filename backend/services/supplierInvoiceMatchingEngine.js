const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_DATE_WINDOW_DAYS = 21;
const QUANTITY_TOLERANCE = 0.001;
const UNIT_PRICE_TOLERANCE = 0.01;
const AMOUNT_TOLERANCE = 0.05;
const VAT_TOLERANCE = 0.05;

const FINAL_ALTA_STATUSES = new Set(['validee_a_payer', 'payee', 'litige', 'refusee']);

function toNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(toNumber(value) * factor) / factor;
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeReference(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function firstPresent(object, keys) {
  if (!object || typeof object !== 'object') return null;
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null && object[key] !== '') return object[key];
  }
  return null;
}

function nestedFirstPresent(object, keys) {
  const direct = firstPresent(object, keys);
  if (direct) return direct;
  if (!object || typeof object !== 'object') return null;

  for (const value of Object.values(object)) {
    if (value && typeof value === 'object') {
      const nested = nestedFirstPresent(value, keys);
      if (nested) return nested;
    }
  }

  return null;
}

function extractSupplierReference(line) {
  return clean(
    nestedFirstPresent(line.raw_payload, [
      'supplier_reference',
      'supplier_ref',
      'reference',
      'product_reference',
      'product_ref',
      'sku',
      'ean',
    ])
  );
}

function tokenSimilarity(left, right) {
  const leftText = normalizeText(left);
  const rightText = normalizeText(right);
  if (!leftText || !rightText) return 0;
  if (leftText === rightText) return 1;
  if (leftText.includes(rightText) || rightText.includes(leftText)) return 0.88;

  const leftTokens = new Set(leftText.split(/\s+/).filter((token) => token.length > 2));
  const rightTokens = new Set(rightText.split(/\s+/).filter((token) => token.length > 2));
  if (!leftTokens.size || !rightTokens.size) return 0;

  let common = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) common += 1;
  }

  return common / Math.max(leftTokens.size, rightTokens.size);
}

function parseVatRate(value) {
  const text = String(value || '').replace('%', '').replace(',', '.').trim();
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return parsed > 1 ? parsed / 100 : parsed;
}

function invoiceLineUnitPrice(line) {
  const direct = toNumber(line.raw_currency_unit_price, NaN);
  if (Number.isFinite(direct) && direct !== 0) return direct;
  const quantity = toNumber(line.quantity);
  if (quantity === 0) return 0;
  return round(toNumber(line.amount ?? line.currency_amount) / quantity, 6);
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

async function loadMappings(client, storeId, supplierId) {
  if (!supplierId) return [];
  const result = await client.query(
    `
    SELECT
      m.id mapping_id,
      m.supplier_ref,
      m.supplier_label,
      m.article_id,
      a.plu article_plu,
      a.designation article_name
    FROM supplier_article_mappings m
    JOIN articles a ON a.id = m.article_id AND a.store_id = m.store_id
    WHERE m.store_id = $1
      AND m.supplier_id = $2
      AND COALESCE(m.is_active, true) = true
    `,
    [storeId, supplierId]
  ).catch(() => ({ rows: [] }));

  return result.rows;
}

async function loadArticleCandidates(client, storeId) {
  const result = await client.query(
    `
    SELECT id, plu, designation
    FROM articles
    WHERE store_id = $1
    ORDER BY designation ASC
    LIMIT 5000
    `,
    [storeId]
  );
  return result.rows;
}

async function loadPurchaseLineCandidates(client, invoice, dateWindowDays) {
  if (!invoice.supplier_id) return [];
  const result = await client.query(
    `
    SELECT
      pl.id purchase_line_id,
      pl.purchase_id,
      pl.article_id,
      pl.supplier_reference,
      pl.supplier_label,
      pl.ordered_quantity,
      pl.received_quantity,
      pl.unit_price_ex_vat,
      pl.line_amount_ex_vat,
      pl.price_unit,
      p.bl_number,
      p.receipt_date,
      p.status purchase_status,
      a.plu article_plu,
      a.designation article_name,
      l.id lot_id
    FROM purchase_lines pl
    JOIN purchases p ON p.id = pl.purchase_id AND p.store_id = pl.store_id
    LEFT JOIN articles a ON a.id = pl.article_id AND a.store_id = pl.store_id
    LEFT JOIN lots l ON l.purchase_line_id = pl.id
    WHERE pl.store_id = $1
      AND pl.supplier_id = $2
      AND p.status IN ('received', 'received_pending_invoice', 'invoice_difference', 'invoice_matched')
      AND (
        $3::date IS NULL
        OR p.receipt_date IS NULL
        OR p.receipt_date BETWEEN ($3::date - ($4::int || ' days')::interval)
          AND ($3::date + ($4::int || ' days')::interval)
      )
    ORDER BY p.receipt_date DESC NULLS LAST, pl.line_number ASC
    LIMIT 500
    `,
    [invoice.store_id, invoice.supplier_id, invoice.invoice_date || null, dateWindowDays]
  );

  return result.rows;
}

function resolveArticle(line, mappings, articles) {
  const supplierReference = extractSupplierReference(line);
  const normalizedReference = normalizeReference(supplierReference);

  if (normalizedReference) {
    const mapping = mappings.find((entry) => normalizeReference(entry.supplier_ref) === normalizedReference);
    if (mapping) {
      return {
        articleId: mapping.article_id,
        articleLabel: mapping.article_name,
        supplierReference,
        source: 'af_map',
        confidence: 100,
      };
    }
  }

  const label = line.label || '';
  const mappingByLabel = mappings
    .map((entry) => ({
      entry,
      score: Math.max(tokenSimilarity(label, entry.supplier_label), tokenSimilarity(label, entry.article_name)),
    }))
    .sort((left, right) => right.score - left.score)[0];

  if (mappingByLabel?.score >= 0.72) {
    return {
      articleId: mappingByLabel.entry.article_id,
      articleLabel: mappingByLabel.entry.article_name,
      supplierReference,
      source: 'designation',
      confidence: round(mappingByLabel.score * 100, 2),
    };
  }

  const articleByLabel = articles
    .map((entry) => ({
      entry,
      score: Math.max(tokenSimilarity(label, entry.designation), tokenSimilarity(label, entry.plu)),
    }))
    .sort((left, right) => right.score - left.score)[0];

  if (articleByLabel?.score >= 0.78) {
    return {
      articleId: articleByLabel.entry.id,
      articleLabel: articleByLabel.entry.designation,
      supplierReference,
      source: 'article_alta',
      confidence: round(articleByLabel.score * 100, 2),
    };
  }

  return {
    articleId: null,
    articleLabel: null,
    supplierReference,
    source: 'none',
    confidence: 0,
  };
}

function scorePurchaseLine(line, resolvedArticle, purchaseLine) {
  const supplierReference = normalizeReference(resolvedArticle.supplierReference);
  const purchaseReference = normalizeReference(purchaseLine.supplier_reference);
  const labelScore = Math.max(
    tokenSimilarity(line.label, purchaseLine.supplier_label),
    tokenSimilarity(line.label, purchaseLine.article_name)
  );
  const invoiceAmount = Math.abs(toNumber(line.amount ?? line.currency_amount));
  const purchaseAmount = Math.abs(toNumber(purchaseLine.line_amount_ex_vat));
  const amountScore = invoiceAmount > 0
    ? Math.max(0, 1 - Math.abs(invoiceAmount - purchaseAmount) / Math.max(invoiceAmount, purchaseAmount, 1))
    : 0;

  let score = 0;
  let source = resolvedArticle.source;

  if (resolvedArticle.articleId && purchaseLine.article_id === resolvedArticle.articleId) score += 70;
  if (supplierReference && purchaseReference && supplierReference === purchaseReference) {
    score += 90;
    if (source === 'none') source = 'supplier_reference';
  }
  if (labelScore >= 0.72) score += labelScore * 45;
  if (amountScore >= 0.75) score += amountScore * 20;

  return { score, source, labelScore, amountScore };
}

function selectPurchaseLine(line, resolvedArticle, candidates) {
  const ranked = candidates
    .map((purchaseLine) => ({
      purchaseLine,
      ...scorePurchaseLine(line, resolvedArticle, purchaseLine),
    }))
    .sort((left, right) => right.score - left.score);

  const best = ranked[0];
  if (!best || best.score < 60) return null;
  return best;
}

function buildLineResult(invoice, line, resolvedArticle, selectedPurchaseLine) {
  const purchaseLine = selectedPurchaseLine?.purchaseLine || null;
  const invoiceQuantity = toNumber(line.quantity);
  const invoiceUnitPrice = invoiceLineUnitPrice(line);
  const invoiceAmount = toNumber(line.amount ?? line.currency_amount);
  const invoiceVat = toNumber(line.tax ?? line.currency_tax);

  if (!resolvedArticle.articleId) {
    return lineResult(invoice, line, resolvedArticle, purchaseLine, {
      matchStatus: 'article_inconnu',
      anomalyCode: 'article_inconnu',
      anomalyLabel: 'Article ALTA non identifie',
      invoiceQuantity,
      invoiceUnitPrice,
      invoiceAmount,
      invoiceVat,
      confidence: 0,
    });
  }

  if (!purchaseLine) {
    return lineResult(invoice, line, resolvedArticle, purchaseLine, {
      matchStatus: 'bl_manquant',
      anomalyCode: 'bl_manquant',
      anomalyLabel: 'Aucune ligne reception/BL rapprochable',
      invoiceQuantity,
      invoiceUnitPrice,
      invoiceAmount,
      invoiceVat,
      confidence: resolvedArticle.confidence,
    });
  }

  const receivedQuantity = toNumber(purchaseLine.received_quantity || purchaseLine.ordered_quantity);
  const orderedQuantity = toNumber(purchaseLine.ordered_quantity);
  const purchaseUnitPrice = toNumber(purchaseLine.unit_price_ex_vat);
  const purchaseAmount = toNumber(purchaseLine.line_amount_ex_vat);
  const quantityDifference = round(invoiceQuantity - receivedQuantity, 4);
  const unitPriceDifference = round(invoiceUnitPrice - purchaseUnitPrice, 6);
  const amountDifference = round(invoiceAmount - purchaseAmount, 4);
  const vatRate = parseVatRate(line.vat_rate);
  const expectedVat = vatRate === null ? null : round(invoiceAmount * vatRate, 4);
  const vatDifference = expectedVat === null ? 0 : round(invoiceVat - expectedVat, 4);

  let matchStatus = 'conforme';
  let anomalyCode = null;
  let anomalyLabel = null;

  if (Math.abs(quantityDifference) > QUANTITY_TOLERANCE) {
    matchStatus = 'ecart_quantite';
    anomalyCode = 'ecart_quantite';
    anomalyLabel = 'Quantite facturee differente de la quantite receptionnee';
  } else if (Math.abs(unitPriceDifference) > UNIT_PRICE_TOLERANCE || Math.abs(amountDifference) > AMOUNT_TOLERANCE) {
    matchStatus = 'ecart_prix';
    anomalyCode = 'ecart_prix';
    anomalyLabel = 'Prix facture different du prix receptionne';
  } else if (Math.abs(vatDifference) > VAT_TOLERANCE) {
    matchStatus = 'ecart_tva';
    anomalyCode = 'ecart_tva';
    anomalyLabel = 'TVA ligne incoherente avec le taux Pennylane';
  }

  return lineResult(invoice, line, resolvedArticle, purchaseLine, {
    matchStatus,
    anomalyCode,
    anomalyLabel,
    orderedQuantity,
    receivedQuantity,
    invoiceQuantity,
    purchaseUnitPrice,
    invoiceUnitPrice,
    quantityDifference,
    unitPriceDifference,
    amountDifference,
    vatDifference,
    invoiceAmount,
    purchaseAmount,
    invoiceVat,
    confidence: selectedPurchaseLine ? Math.min(100, round(selectedPurchaseLine.score, 2)) : resolvedArticle.confidence,
    matchSource: selectedPurchaseLine?.source || resolvedArticle.source,
  });
}

function lineResult(invoice, line, resolvedArticle, purchaseLine, details) {
  const aiContext = {
    invoice_number: invoice.invoice_number,
    supplier_name: invoice.supplier_name,
    line_label: line.label,
    article_label: resolvedArticle.articleLabel || purchaseLine?.article_name || null,
    anomaly_code: details.anomalyCode,
    anomaly_label: details.anomalyLabel,
    recommendation: details.anomalyCode ? 'controle_manuel' : 'conforme',
  };

  return {
    store_id: invoice.store_id,
    supplier_invoice_id: invoice.id,
    supplier_invoice_line_id: line.id,
    supplier_id: invoice.supplier_id,
    article_id: resolvedArticle.articleId || purchaseLine?.article_id || null,
    purchase_id: purchaseLine?.purchase_id || null,
    purchase_line_id: purchaseLine?.purchase_line_id || null,
    lot_id: purchaseLine?.lot_id || null,
    match_source: details.matchSource || resolvedArticle.source || 'none',
    match_status: details.matchStatus,
    anomaly_code: details.anomalyCode,
    anomaly_label: details.anomalyLabel,
    supplier_reference: resolvedArticle.supplierReference || purchaseLine?.supplier_reference || null,
    invoice_label: line.label || null,
    article_label: resolvedArticle.articleLabel || purchaseLine?.article_name || null,
    purchase_bl_number: purchaseLine?.bl_number || null,
    purchase_receipt_date: purchaseLine?.receipt_date || null,
    ordered_quantity: details.orderedQuantity ?? null,
    received_quantity: details.receivedQuantity ?? null,
    invoice_quantity: details.invoiceQuantity ?? null,
    purchase_unit_price_ex_vat: details.purchaseUnitPrice ?? null,
    invoice_unit_price_ex_vat: details.invoiceUnitPrice ?? null,
    quantity_difference: details.quantityDifference ?? null,
    unit_price_difference: details.unitPriceDifference ?? null,
    amount_difference: details.amountDifference ?? null,
    vat_difference: details.vatDifference ?? null,
    invoice_amount_ex_vat: details.invoiceAmount ?? null,
    purchase_amount_ex_vat: details.purchaseAmount ?? null,
    invoice_vat_amount: details.invoiceVat ?? null,
    confidence: details.confidence ?? 0,
    ai_context: aiContext,
    raw_payload: {
      invoice_line: line.raw_payload || {},
      purchase_line_id: purchaseLine?.purchase_line_id || null,
    },
  };
}

function summarize(invoice, lines, results) {
  const anomalyResults = results.filter((result) => result.match_status !== 'conforme');
  const matchedResults = results.filter((result) => result.purchase_line_id);
  const purchaseIds = new Set(results.map((result) => result.purchase_id).filter(Boolean));
  const lineTotalExVat = round(lines.reduce((sum, line) => sum + toNumber(line.amount ?? line.currency_amount), 0), 4);
  const lineVat = round(lines.reduce((sum, line) => sum + toNumber(line.tax ?? line.currency_tax), 0), 4);
  const invoiceExVat = toNumber(invoice.amount_ex_vat ?? invoice.currency_amount_ex_vat);
  const invoiceVat = toNumber(invoice.amount_vat ?? invoice.currency_amount_vat);
  const totalExVatDifference = round(invoiceExVat - lineTotalExVat, 4);
  const totalVatDifference = round(invoiceVat - lineVat, 4);
  const totalAnomalies = [...anomalyResults];

  if (Math.abs(totalVatDifference) > VAT_TOLERANCE && lines.length > 0) {
    totalAnomalies.push({ match_status: 'ecart_tva', anomaly_code: 'ecart_tva' });
  }

  const anomalyCounts = totalAnomalies.reduce((acc, result) => {
    const key = result.anomaly_code || result.match_status || 'controle_manuel';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const conformityScore = lines.length
    ? round((results.filter((result) => result.match_status === 'conforme').length / lines.length) * 100, 2)
    : 0;

  return {
    line_count: lines.length,
    matched_lines: matchedResults.length,
    conform_lines: results.filter((result) => result.match_status === 'conforme').length,
    anomaly_count: totalAnomalies.length,
    bl_count: purchaseIds.size,
    conformity_score: conformityScore,
    total_ex_vat_difference: totalExVatDifference,
    total_vat_difference: totalVatDifference,
    anomaly_counts: anomalyCounts,
  };
}

function statusFromSummary(invoice, summary) {
  if (invoice.paid === true || invoice.payment_status === 'paid') return 'payee';
  if (!summary.line_count) return 'a_rapprocher';
  if (!summary.anomaly_count) return 'conforme';
  if (summary.anomaly_counts.article_inconnu) return 'article_inconnu';
  if (summary.anomaly_counts.bl_manquant) return 'bl_manquant';
  if (summary.anomaly_counts.ecart_quantite) return 'ecart_quantite';
  if (summary.anomaly_counts.ecart_prix) return 'ecart_prix';
  if (summary.anomaly_counts.ecart_tva) return 'ecart_tva';
  return 'controle_manuel';
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
        match_status = CASE WHEN $3::int = 0 AND $4::int > 0 THEN 'matched' ELSE 'discrepancy' END,
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
      summary.line_count,
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

    const { invoice, lines } = loaded;
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

    const mappings = await loadMappings(client, invoice.store_id, invoice.supplier_id);
    const articles = await loadArticleCandidates(client, invoice.store_id);
    const purchaseCandidates = await loadPurchaseLineCandidates(client, invoice, dateWindowDays);

    const results = lines.map((line) => {
      const resolvedArticle = resolveArticle(line, mappings, articles);
      const selectedPurchaseLine = selectPurchaseLine(line, resolvedArticle, purchaseCandidates);
      return buildLineResult(invoice, line, resolvedArticle, selectedPurchaseLine);
    });

    const summary = summarize(invoice, lines, results);
    await persistResults(client, invoice, results, summary);
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
  const batchSize = Math.max(1, Math.min(Number(options.batchSize || process.env.PENNYLANE_SUPPLIER_INVOICE_MATCH_BATCH_SIZE) || DEFAULT_BATCH_SIZE, 100));
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
      console.error('[Supplier invoice matching] erreur analyse automatique', {
        invoice_id: invoice.id,
        message: error.message,
      });
    }
  }

  return { processed, succeeded, failed, skipped: false };
}

module.exports = {
  analyzePennylaneSupplierInvoice,
  processPendingPennylaneSupplierInvoiceMatching,
};
