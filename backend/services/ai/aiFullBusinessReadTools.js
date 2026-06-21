const { buildIntelligenceAlerts } = require('../intelligence/alertEngine');

const OPTIONAL_DB_ERROR_CODES = new Set(['42P01', '42703', '42883', '42P10']);
const DEFAULT_LIMIT = 30;

function clean(value) {
  const text = String(value || '').trim();
  return text || null;
}

function number(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function limit(value, fallback = DEFAULT_LIMIT, max = 100) {
  return Math.min(Math.max(Math.trunc(number(value, fallback)), 1), max);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function dateRange(args = {}, defaultPeriod = 'month') {
  const now = new Date();
  const period = clean(args.period) || defaultPeriod;
  const from = clean(args.date_from) || clean(args.from);
  const to = clean(args.date_to) || clean(args.to);
  if (from || to || period === 'custom') {
    return {
      date_from: from || isoDate(addDays(now, -30)),
      date_to: to || isoDate(now),
      period: 'custom',
    };
  }
  if (period === 'today') return { date_from: isoDate(now), date_to: isoDate(now), period };
  if (period === 'year') {
    return { date_from: isoDate(new Date(Date.UTC(now.getUTCFullYear(), 0, 1))), date_to: isoDate(now), period };
  }
  if (period === 'last_30_days') return { date_from: isoDate(addDays(now, -30)), date_to: isoDate(now), period };
  return { date_from: isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), date_to: isoDate(now), period: 'month' };
}

function periodArgs() {
  return {
    period: { type: 'string', enum: ['today', 'month', 'last_30_days', 'year', 'custom'] },
    date_from: { type: 'string', description: 'Date debut YYYY-MM-DD si period=custom.' },
    date_to: { type: 'string', description: 'Date fin YYYY-MM-DD si period=custom.' },
  };
}

function ok(data) {
  return { ok: true, read_only: true, ...data };
}

function unavailable(tool, error) {
  const reason = OPTIONAL_DB_ERROR_CODES.has(error.code)
    ? 'Donnees non disponibles dans le schema actuel.'
    : 'Lecture metier indisponible.';
  console.error('[AI FULL READ] tool unavailable', {
    tool,
    message: error.message,
    code: error.code || null,
  });
  return { ok: false, available: false, read_only: true, reason };
}

async function safeTool(tool, fn) {
  try {
    return await fn();
  } catch (error) {
    return unavailable(tool, error);
  }
}

async function getAccountingSummary({ db, user, args }) {
  return safeTool('get_accounting_summary', async () => {
    const range = dateRange(args);
    const [sales, purchases, supplierInvoices] = await Promise.all([
      db.query(`
        SELECT COUNT(DISTINCT sd.id)::int AS document_count,
               COALESCE(SUM(sl.line_amount_ht), 0) AS ca_ht,
               COALESCE(SUM(sl.line_margin_ex_vat), 0) AS margin_ht,
               COALESCE(SUM(sl.line_amount_ht - sl.line_margin_ex_vat), 0) AS cost_ht
        FROM sales_documents sd
        LEFT JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
        WHERE sd.store_id = $1
          AND sd.document_date >= $2::date
          AND sd.document_date <= $3::date
          AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
      `, [user.store_id, range.date_from, range.date_to]),
      db.query(`
        SELECT COUNT(DISTINCT p.id)::int AS purchase_count,
               COALESCE(SUM(pl.line_amount_ex_vat), 0) AS purchases_ht
        FROM purchases p
        LEFT JOIN purchase_lines pl ON pl.purchase_id = p.id AND pl.store_id = p.store_id
        WHERE p.store_id = $1
          AND COALESCE(p.receipt_date, p.purchase_date) >= $2::date
          AND COALESCE(p.receipt_date, p.purchase_date) <= $3::date
          AND COALESCE(p.status, '') <> 'cancelled'
      `, [user.store_id, range.date_from, range.date_to]),
      db.query(`
        SELECT COUNT(DISTINCT si.id)::int AS invoice_count,
               COALESCE(SUM(si.total_ex_vat), 0) AS supplier_invoices_ht,
               COALESCE(SUM(si.total_inc_vat), 0) AS supplier_invoices_ttc
        FROM supplier_invoices si
        WHERE si.store_id = $1
          AND si.invoice_date >= $2::date
          AND si.invoice_date <= $3::date
          AND COALESCE(si.status, '') <> 'cancelled'
      `, [user.store_id, range.date_from, range.date_to]),
    ]);
    return ok({ period: range, accounting_summary: { sales: sales.rows[0], purchases: purchases.rows[0], supplier_invoices: supplierInvoices.rows[0] } });
  });
}

async function getDashboardSummary({ db, user, args }) {
  return safeTool('get_dashboard_summary', async () => {
    const range = dateRange(args);
    const [sales, stock, alerts] = await Promise.all([
      db.query(`
        SELECT COUNT(DISTINCT sd.id)::int AS document_count,
               COUNT(DISTINCT sd.client_id)::int AS client_count,
               COALESCE(SUM(sl.line_amount_ht), 0) AS ca_ht,
               COALESCE(SUM(sl.line_margin_ex_vat), 0) AS margin_ht
        FROM sales_documents sd
        LEFT JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
        WHERE sd.store_id = $1
          AND sd.document_date >= $2::date
          AND sd.document_date <= $3::date
          AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
      `, [user.store_id, range.date_from, range.date_to]),
      db.query(`
        SELECT COUNT(*)::int AS article_count,
               COALESCE(SUM(stock_quantity), 0) AS stock_quantity,
               COALESCE(SUM(stock_value_ex_vat), 0) AS stock_value_ht
        FROM stock_summary
        WHERE store_id = $1
      `, [user.store_id]),
      buildIntelligenceAlerts(db, user.store_id),
    ]);
    return ok({
      period: range,
      dashboard_summary: {
        sales: sales.rows[0],
        stock: stock.rows[0],
        alert_counts: alerts.reduce((acc, alert) => ({ ...acc, [alert.level]: (acc[alert.level] || 0) + 1 }), {}),
        top_alerts: alerts.slice(0, 10),
      },
    });
  });
}

async function getRealMarginSummary({ db, user, args }) {
  return safeTool('get_real_margin_summary', async () => {
    const range = dateRange(args);
    const result = await db.query(`
      WITH sales AS (
        SELECT sl.id, sl.article_id, sl.line_amount_ht, sl.line_margin_ex_vat
        FROM sales_documents sd
        JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
        WHERE sd.store_id = $1
          AND sd.document_date >= $2::date
          AND sd.document_date <= $3::date
          AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
      ),
      allocations AS (
        SELECT sales_line_id, COALESCE(SUM(quantity * unit_cost_ex_vat), 0) AS fifo_cost_ht
        FROM sale_line_allocations
        GROUP BY sales_line_id
      )
      SELECT COALESCE(SUM(s.line_amount_ht), 0) AS ca_ht,
             COALESCE(SUM(s.line_margin_ex_vat), 0) AS stored_margin_ht,
             COALESCE(SUM(a.fifo_cost_ht), 0) AS fifo_cost_ht,
             COALESCE(SUM(s.line_amount_ht), 0) - COALESCE(SUM(a.fifo_cost_ht), 0) AS real_margin_ht,
             CASE WHEN COALESCE(SUM(s.line_amount_ht), 0) > 0
               THEN (COALESCE(SUM(s.line_amount_ht), 0) - COALESCE(SUM(a.fifo_cost_ht), 0)) / COALESCE(SUM(s.line_amount_ht), 0) * 100
               ELSE 0
             END AS real_margin_rate
      FROM sales s
      LEFT JOIN allocations a ON a.sales_line_id = s.id
    `, [user.store_id, range.date_from, range.date_to]);
    return ok({ period: range, real_margin_summary: result.rows[0] || {} });
  });
}

async function getSalesFullSummary({ db, user, args }) {
  return safeTool('get_sales_full_summary', async () => {
    const range = dateRange(args);
    const maxRows = limit(args.limit, 20, 80);
    const [byType, byClient, byArticle] = await Promise.all([
      db.query(`
        SELECT sd.document_type, sd.status, COUNT(DISTINCT sd.id)::int AS document_count,
               COALESCE(SUM(sl.line_amount_ht), 0) AS ca_ht,
               COALESCE(SUM(sl.line_margin_ex_vat), 0) AS margin_ht
        FROM sales_documents sd
        LEFT JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
        WHERE sd.store_id = $1 AND sd.document_date >= $2::date AND sd.document_date <= $3::date
        GROUP BY sd.document_type, sd.status
        ORDER BY ca_ht DESC
      `, [user.store_id, range.date_from, range.date_to]),
      db.query(`
        SELECT c.id AS client_id, c.code, c.name, COUNT(DISTINCT sd.id)::int AS document_count,
               COALESCE(SUM(sl.line_amount_ht), 0) AS ca_ht,
               COALESCE(SUM(sl.line_margin_ex_vat), 0) AS margin_ht
        FROM sales_documents sd
        JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
        LEFT JOIN clients c ON c.id = sd.client_id AND c.store_id = sd.store_id
        WHERE sd.store_id = $1 AND sd.document_date >= $2::date AND sd.document_date <= $3::date
          AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
        GROUP BY c.id, c.code, c.name
        ORDER BY ca_ht DESC
        LIMIT $4
      `, [user.store_id, range.date_from, range.date_to, maxRows]),
      db.query(`
        SELECT sl.article_id, sl.article_plu, sl.article_label,
               COALESCE(SUM(sl.sold_quantity), 0) AS quantity,
               COALESCE(SUM(sl.line_amount_ht), 0) AS ca_ht,
               COALESCE(SUM(sl.line_margin_ex_vat), 0) AS margin_ht
        FROM sales_documents sd
        JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
        WHERE sd.store_id = $1 AND sd.document_date >= $2::date AND sd.document_date <= $3::date
          AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
        GROUP BY sl.article_id, sl.article_plu, sl.article_label
        ORDER BY ca_ht DESC
        LIMIT $4
      `, [user.store_id, range.date_from, range.date_to, maxRows]),
    ]);
    return ok({ period: range, sales_full_summary: { by_document_type: byType.rows, top_clients: byClient.rows, top_articles: byArticle.rows } });
  });
}

async function getPurchaseFullSummary({ db, user, args }) {
  return safeTool('get_purchase_full_summary', async () => {
    const range = dateRange(args);
    const maxRows = limit(args.limit, 20, 80);
    const [byStatus, bySupplier, byArticle] = await Promise.all([
      db.query(`
        SELECT p.status, COUNT(DISTINCT p.id)::int AS purchase_count,
               COALESCE(SUM(pl.line_amount_ex_vat), 0) AS purchases_ht
        FROM purchases p
        LEFT JOIN purchase_lines pl ON pl.purchase_id = p.id AND pl.store_id = p.store_id
        WHERE p.store_id = $1 AND COALESCE(p.receipt_date, p.purchase_date) >= $2::date AND COALESCE(p.receipt_date, p.purchase_date) <= $3::date
        GROUP BY p.status
        ORDER BY purchases_ht DESC
      `, [user.store_id, range.date_from, range.date_to]),
      db.query(`
        SELECT s.id AS supplier_id, s.code, s.name,
               COUNT(DISTINCT p.id)::int AS purchase_count,
               COALESCE(SUM(pl.line_amount_ex_vat), 0) AS purchases_ht
        FROM purchases p
        LEFT JOIN purchase_lines pl ON pl.purchase_id = p.id AND pl.store_id = p.store_id
        LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.store_id = p.store_id
        WHERE p.store_id = $1 AND COALESCE(p.receipt_date, p.purchase_date) >= $2::date AND COALESCE(p.receipt_date, p.purchase_date) <= $3::date
          AND COALESCE(p.status, '') <> 'cancelled'
        GROUP BY s.id, s.code, s.name
        ORDER BY purchases_ht DESC
        LIMIT $4
      `, [user.store_id, range.date_from, range.date_to, maxRows]),
      db.query(`
        SELECT pl.article_id, pl.article_plu, pl.article_label,
               COALESCE(SUM(COALESCE(pl.received_quantity, pl.ordered_quantity, 0)), 0) AS quantity,
               COALESCE(SUM(pl.line_amount_ex_vat), 0) AS purchases_ht
        FROM purchases p
        JOIN purchase_lines pl ON pl.purchase_id = p.id AND pl.store_id = p.store_id
        WHERE p.store_id = $1 AND COALESCE(p.receipt_date, p.purchase_date) >= $2::date AND COALESCE(p.receipt_date, p.purchase_date) <= $3::date
          AND COALESCE(p.status, '') <> 'cancelled'
        GROUP BY pl.article_id, pl.article_plu, pl.article_label
        ORDER BY purchases_ht DESC
        LIMIT $4
      `, [user.store_id, range.date_from, range.date_to, maxRows]),
    ]);
    return ok({ period: range, purchase_full_summary: { by_status: byStatus.rows, top_suppliers: bySupplier.rows, top_articles: byArticle.rows } });
  });
}

async function getSupplierOrdersSummary({ db, user, args }) {
  return safeTool('get_supplier_orders_summary', async () => {
    const range = dateRange(args);
    const result = await db.query(`
      SELECT p.status, COUNT(DISTINCT p.id)::int AS order_count,
             COUNT(pl.id)::int AS line_count,
             COALESCE(SUM(pl.ordered_quantity), 0) AS ordered_quantity,
             COALESCE(SUM(pl.received_quantity), 0) AS received_quantity,
             COALESCE(SUM(pl.line_amount_ex_vat), 0) AS amount_ht
      FROM purchases p
      LEFT JOIN purchase_lines pl ON pl.purchase_id = p.id AND pl.store_id = p.store_id
      WHERE p.store_id = $1 AND p.purchase_date >= $2::date AND p.purchase_date <= $3::date
      GROUP BY p.status
      ORDER BY amount_ht DESC
    `, [user.store_id, range.date_from, range.date_to]);
    return ok({ period: range, supplier_orders_summary: { by_status: result.rows } });
  });
}

async function getSupplierInvoicesSummary({ db, user, args }) {
  return safeTool('get_supplier_invoices_summary', async () => {
    const range = dateRange(args);
    const maxRows = limit(args.limit, 20, 80);
    const [summary, bySupplier] = await Promise.all([
      db.query(`
        SELECT status, COUNT(*)::int AS invoice_count,
               COALESCE(SUM(total_ex_vat), 0) AS total_ht,
               COALESCE(SUM(total_inc_vat), 0) AS total_ttc
        FROM supplier_invoices
        WHERE store_id = $1 AND invoice_date >= $2::date AND invoice_date <= $3::date
        GROUP BY status
        ORDER BY total_ht DESC
      `, [user.store_id, range.date_from, range.date_to]),
      db.query(`
        SELECT s.id AS supplier_id, s.code, s.name, COUNT(si.id)::int AS invoice_count,
               COALESCE(SUM(si.total_ex_vat), 0) AS total_ht,
               COALESCE(SUM(si.total_inc_vat), 0) AS total_ttc
        FROM supplier_invoices si
        LEFT JOIN suppliers s ON s.id = si.supplier_id AND s.store_id = si.store_id
        WHERE si.store_id = $1 AND si.invoice_date >= $2::date AND si.invoice_date <= $3::date
          AND COALESCE(si.status, '') <> 'cancelled'
        GROUP BY s.id, s.code, s.name
        ORDER BY total_ht DESC
        LIMIT $4
      `, [user.store_id, range.date_from, range.date_to, maxRows]),
    ]);
    return ok({ period: range, supplier_invoices_summary: { by_status: summary.rows, top_suppliers: bySupplier.rows } });
  });
}

async function getTransformationsSummary({ db, user, args }) {
  return safeTool('get_transformations_summary', async () => {
    const range = dateRange(args);
    const result = await db.query(`
      SELECT COUNT(DISTINCT sd.id)::int AS transformation_count,
             COALESCE(SUM(CASE WHEN sl.line_reason = 'transformation_input' THEN sl.sold_quantity ELSE 0 END), 0) AS input_quantity,
             COALESCE(SUM(CASE WHEN sl.line_reason = 'transformation_output' THEN sl.sold_quantity ELSE 0 END), 0) AS output_quantity,
             COALESCE(SUM(CASE WHEN sl.line_reason = 'transformation_output' THEN sl.line_amount_ht ELSE 0 END), 0) AS output_value_ht
      FROM sales_documents sd
      LEFT JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
      WHERE sd.store_id = $1
        AND sd.document_date >= $2::date
        AND sd.document_date <= $3::date
        AND (sd.origin = 'transformation' OR sl.line_reason IN ('transformation_input', 'transformation_output'))
    `, [user.store_id, range.date_from, range.date_to]);
    return ok({ period: range, transformations_summary: result.rows[0] || {} });
  });
}

async function getStockLotsSummary({ db, user, args }) {
  return safeTool('get_stock_lots_summary', async () => {
    const maxRows = limit(args.limit, 30, 100);
    const [summary, riskyLots] = await Promise.all([
      db.query(`
        SELECT COUNT(*)::int AS lot_count,
               COUNT(*) FILTER (WHERE qty_remaining > 0)::int AS active_lot_count,
               COALESCE(SUM(qty_remaining), 0) AS remaining_quantity,
               COALESCE(SUM(qty_remaining * unit_cost_ex_vat), 0) AS remaining_value_ht,
               COUNT(*) FILTER (WHERE dlc IS NOT NULL AND dlc < CURRENT_DATE)::int AS expired_lot_count,
               COUNT(*) FILTER (WHERE dlc IS NOT NULL AND dlc <= CURRENT_DATE + INTERVAL '3 days')::int AS dlc_soon_count
        FROM lots
        WHERE store_id = $1
      `, [user.store_id]),
      db.query(`
        SELECT l.id, l.lot_code, l.supplier_lot_number, l.qty_remaining, l.unit_cost_ex_vat, l.dlc,
               a.id AS article_id, a.plu, a.designation,
               s.id AS supplier_id, s.name AS supplier_name
        FROM lots l
        LEFT JOIN articles a ON a.id = l.article_id AND a.store_id = l.store_id
        LEFT JOIN suppliers s ON s.id = l.supplier_id AND s.store_id = l.store_id
        WHERE l.store_id = $1 AND l.qty_remaining > 0
          AND (l.dlc IS NULL OR l.dlc <= CURRENT_DATE + INTERVAL '7 days')
        ORDER BY l.dlc ASC NULLS FIRST, l.qty_remaining DESC
        LIMIT $2
      `, [user.store_id, maxRows]),
    ]);
    return ok({ stock_lots_summary: { totals: summary.rows[0] || {}, risky_lots: riskyLots.rows } });
  });
}

async function getTraceabilitySummary({ db, user, args }) {
  return safeTool('get_traceability_summary', async () => {
    const range = dateRange(args);
    const result = await db.query(`
      SELECT COUNT(DISTINCT l.id)::int AS lot_count,
             COUNT(DISTINCT l.id) FILTER (WHERE l.traceability_data IS NULL OR l.traceability_data = '{}'::jsonb)::int AS lots_missing_traceability,
             COUNT(DISTINCT sl.id)::int AS sold_line_count,
             COUNT(DISTINCT sl.id) FILTER (WHERE sl.traceability_snapshot IS NULL OR sl.traceability_snapshot = '{}'::jsonb)::int AS sold_lines_missing_traceability
      FROM lots l
      LEFT JOIN sale_line_allocations sla ON sla.lot_id = l.id
      LEFT JOIN sales_lines sl ON sl.id = sla.sales_line_id AND sl.store_id = l.store_id
      LEFT JOIN sales_documents sd ON sd.id = sl.sales_document_id AND sd.store_id = sl.store_id
        AND sd.document_date >= $2::date AND sd.document_date <= $3::date
      WHERE l.store_id = $1
    `, [user.store_id, range.date_from, range.date_to]);
    return ok({ period: range, traceability_summary: result.rows[0] || {} });
  });
}

function toolDefinitions() {
  const period = periodArgs();
  const periodWithLimit = { ...period, limit: { type: 'integer', minimum: 1, maximum: 100 } };
  return [
    { type: 'function', function: { name: 'get_accounting_summary', description: 'Lecture read-only comptabilite: CA, achats, factures fournisseurs et marge stockee.', parameters: { type: 'object', properties: period } } },
    { type: 'function', function: { name: 'get_dashboard_summary', description: 'Lecture read-only dashboard: activite, stock et alertes importantes.', parameters: { type: 'object', properties: period } } },
    { type: 'function', function: { name: 'get_real_margin_summary', description: 'Lecture read-only de la marge reelle basee sur allocations FIFO quand disponibles.', parameters: { type: 'object', properties: period } } },
    { type: 'function', function: { name: 'get_sales_full_summary', description: 'Lecture read-only complete ventes: commandes, BL, factures, avoirs, clients et articles.', parameters: { type: 'object', properties: periodWithLimit } } },
    { type: 'function', function: { name: 'get_purchase_full_summary', description: 'Lecture read-only complete achats: receptions, fournisseurs et articles achetes.', parameters: { type: 'object', properties: periodWithLimit } } },
    { type: 'function', function: { name: 'get_supplier_orders_summary', description: 'Lecture read-only des commandes fournisseurs via achats/receptions existants.', parameters: { type: 'object', properties: period } } },
    { type: 'function', function: { name: 'get_supplier_invoices_summary', description: 'Lecture read-only des factures fournisseurs par statut et fournisseur.', parameters: { type: 'object', properties: periodWithLimit } } },
    { type: 'function', function: { name: 'get_transformations_summary', description: 'Lecture read-only des transformations et rendements entree/sortie.', parameters: { type: 'object', properties: period } } },
    { type: 'function', function: { name: 'get_stock_lots_summary', description: 'Lecture read-only des lots, DLC, valeur de stock et risques FIFO/DLC.', parameters: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } } } },
    { type: 'function', function: { name: 'get_traceability_summary', description: 'Lecture read-only de la tracabilite lots et ventes.', parameters: { type: 'object', properties: period } } },
  ];
}

const handlers = {
  get_accounting_summary: getAccountingSummary,
  get_dashboard_summary: getDashboardSummary,
  get_real_margin_summary: getRealMarginSummary,
  get_sales_full_summary: getSalesFullSummary,
  get_purchase_full_summary: getPurchaseFullSummary,
  get_supplier_orders_summary: getSupplierOrdersSummary,
  get_supplier_invoices_summary: getSupplierInvoicesSummary,
  get_transformations_summary: getTransformationsSummary,
  get_stock_lots_summary: getStockLotsSummary,
  get_traceability_summary: getTraceabilitySummary,
};

module.exports = { toolDefinitions, handlers };
