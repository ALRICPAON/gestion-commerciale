const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');

const router = express.Router();
const DAY_MS = 24 * 60 * 60 * 1000;

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value) {
  return Number(num(value).toFixed(2));
}

function pct(value) {
  return Number(num(value).toFixed(2));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function parseDate(value, fallback) {
  const raw = clean(value);
  if (!raw) return fallback;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function periodRange(query = {}) {
  const today = new Date();
  const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const period = clean(query.period) || 'month';

  if (period === 'custom') {
    const from = parseDate(query.from, utcToday);
    const to = parseDate(query.to, from);
    return { period, from, to };
  }

  if (period === 'day') return { period, from: utcToday, to: utcToday };

  if (period === 'week') {
    const day = utcToday.getUTCDay() || 7;
    const from = addDays(utcToday, 1 - day);
    return { period, from, to: addDays(from, 6) };
  }

  if (period === 'year') {
    const from = new Date(Date.UTC(utcToday.getUTCFullYear(), 0, 1));
    const to = new Date(Date.UTC(utcToday.getUTCFullYear(), 11, 31));
    return { period, from, to };
  }

  const from = new Date(Date.UTC(utcToday.getUTCFullYear(), utcToday.getUTCMonth(), 1));
  const to = new Date(Date.UTC(utcToday.getUTCFullYear(), utcToday.getUTCMonth() + 1, 0));
  return { period: 'month', from, to };
}

function rangeBounds(range) {
  return {
    period: range.period,
    fromDate: isoDate(range.from),
    toDate: isoDate(range.to),
    fromStart: `${isoDate(range.from)}T00:00:00.000Z`,
    toEnd: `${isoDate(range.to)}T23:59:59.999Z`,
  };
}

function previousBounds(bounds) {
  const from = new Date(`${bounds.fromDate}T00:00:00.000Z`);
  const to = new Date(`${bounds.toDate}T00:00:00.000Z`);
  const days = Math.max(Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1, 1);
  const previousTo = addDays(from, -1);
  const previousFrom = addDays(previousTo, 1 - days);
  return { fromDate: isoDate(previousFrom), toDate: isoDate(previousTo) };
}

function saleDocumentsWhere(alias = 'sd') {
  return `${alias}.status NOT IN ('draft', 'cancelled')
    AND (
      ${alias}.document_type IN ('INVOICE', 'manual_sale', 'inventory_sale')
      OR (
        ${alias}.document_type = 'DELIVERY_NOTE'
        AND NOT EXISTS (
          SELECT 1 FROM sales_documents inv
          WHERE inv.store_id = ${alias}.store_id
            AND inv.document_type = 'INVOICE'
            AND inv.source_delivery_note_id = ${alias}.id
        )
      )
    )`;
}

function salesLinesCte() {
  return `
    WITH valid_sales AS (
      SELECT sd.*
      FROM sales_documents sd
      WHERE sd.store_id = $1
        AND sd.document_date >= $2::date
        AND sd.document_date <= $3::date
        AND ${saleDocumentsWhere('sd')}
    ),
    valid_lines AS (
      SELECT
        vs.id AS document_id,
        vs.document_date,
        vs.document_type,
        vs.client_id,
        sl.id AS line_id,
        sl.article_id,
        COALESCE(sl.article_label, a.designation, 'Article sans nom') AS article_name,
        COALESCE(a.plu, sl.article_plu) AS article_plu,
        COALESCE(sl.sold_quantity, sl.total_weight, 0) AS quantity,
        COALESCE(sl.line_amount_ht, 0) AS ca_ht,
        COALESCE(sl.line_margin_ex_vat, sl.line_amount_ht - (COALESCE(sl.sold_quantity, sl.total_weight, 0) * COALESCE(sl.unit_cost_ex_vat, 0)), 0) AS margin_ht,
        COALESCE(sl.unit_sale_price_ht, 0) AS unit_price_ht
      FROM valid_sales vs
      JOIN sales_lines sl ON sl.sales_document_id = vs.id AND sl.store_id = vs.store_id
      LEFT JOIN articles a ON a.id = sl.article_id AND a.store_id = sl.store_id
      WHERE COALESCE(sl.sold_quantity, sl.total_weight, 0) > 0
    )`;
}

async function articlesStats(db, storeId, bounds) {
  const previous = previousBounds(bounds);
  const [current, previousTotals] = await Promise.all([
    db.query(`${salesLinesCte()}
      SELECT
        article_id,
        article_plu,
        article_name,
        COALESCE(SUM(ca_ht), 0) AS ca_ht,
        COALESCE(SUM(quantity), 0) AS quantity,
        COALESCE(SUM(margin_ht), 0) AS margin_ht,
        COUNT(DISTINCT document_id) AS sales_count,
        CASE WHEN SUM(quantity) > 0 THEN SUM(ca_ht) / SUM(quantity) ELSE 0 END AS average_price_ht
      FROM valid_lines
      GROUP BY article_id, article_plu, article_name
      ORDER BY ca_ht DESC, article_name ASC`, [storeId, bounds.fromDate, bounds.toDate]),
    db.query(`${salesLinesCte()}
      SELECT COALESCE(SUM(ca_ht), 0) ca_ht, COALESCE(SUM(quantity), 0) quantity, COALESCE(SUM(margin_ht), 0) margin_ht
      FROM valid_lines`, [storeId, previous.fromDate, previous.toDate]),
  ]);

  const rows = current.rows.map((row) => {
    const ca = money(row.ca_ht);
    const margin = money(row.margin_ht);
    const quantity = Number(num(row.quantity).toFixed(3));
    return {
      article_id: row.article_id,
      plu: row.article_plu,
      article: row.article_name,
      ca_ht: ca,
      quantity,
      margin_ht: margin,
      margin_rate: ca > 0 ? pct((margin / ca) * 100) : 0,
      average_price_ht: quantity > 0 ? money(ca / quantity) : 0,
      sales_count: Number(row.sales_count || 0),
    };
  });

  const totals = rows.reduce((acc, row) => {
    acc.ca_ht += row.ca_ht;
    acc.quantity += row.quantity;
    acc.margin_ht += row.margin_ht;
    acc.sales_count += row.sales_count;
    return acc;
  }, { ca_ht: 0, quantity: 0, margin_ht: 0, sales_count: 0 });
  const previousCa = num(previousTotals.rows[0]?.ca_ht);

  return {
    kpis: {
      ca_ht: money(totals.ca_ht),
      quantity: Number(totals.quantity.toFixed(3)),
      margin_ht: money(totals.margin_ht),
      margin_rate: totals.ca_ht > 0 ? pct((totals.margin_ht / totals.ca_ht) * 100) : 0,
      average_price_ht: totals.quantity > 0 ? money(totals.ca_ht / totals.quantity) : 0,
      sales_count: totals.sales_count,
      evolution_ca_rate: previousCa > 0 ? pct(((totals.ca_ht - previousCa) / previousCa) * 100) : null,
    },
    charts: {
      top_ca: rows.slice().sort((a, b) => b.ca_ht - a.ca_ht).slice(0, 10).map((r) => ({ label: r.article, value: r.ca_ht })),
      top_margin: rows.slice().sort((a, b) => b.margin_ht - a.margin_ht).slice(0, 10).map((r) => ({ label: r.article, value: r.margin_ht })),
    },
    table: rows,
    comparison: { previous_from: previous.fromDate, previous_to: previous.toDate },
  };
}

async function clientsStats(db, storeId, bounds) {
  const result = await db.query(`${salesLinesCte()}
    SELECT
      c.id AS client_id,
      COALESCE(c.name, 'Client non renseigne') AS client_name,
      COALESCE(SUM(vl.ca_ht), 0) AS ca_ht,
      COALESCE(SUM(vl.margin_ht), 0) AS margin_ht,
      COUNT(DISTINCT vl.document_id) AS order_count,
      COUNT(DISTINCT CASE WHEN vl.document_type = 'DELIVERY_NOTE' THEN vl.document_id END) AS delivery_note_count,
      COUNT(DISTINCT CASE WHEN vl.document_type = 'INVOICE' THEN vl.document_id END) AS invoice_count,
      MAX(vl.document_date) AS last_order_date
    FROM valid_lines vl
    LEFT JOIN clients c ON c.id = vl.client_id AND c.store_id = $1
    GROUP BY c.id, c.name
    ORDER BY ca_ht DESC, client_name ASC`, [storeId, bounds.fromDate, bounds.toDate]);

  const inactive = await db.query(`
    WITH last_orders AS (
      SELECT sd.client_id, MAX(sd.document_date) AS last_order_date
      FROM sales_documents sd
      WHERE sd.store_id = $1
        AND ${saleDocumentsWhere('sd')}
      GROUP BY sd.client_id
    )
    SELECT
      c.id,
      c.name,
      lo.last_order_date,
      CASE
        WHEN lo.last_order_date IS NULL THEN 9999
        ELSE CURRENT_DATE - lo.last_order_date::date
      END AS inactive_days
    FROM clients c
    LEFT JOIN last_orders lo ON lo.client_id = c.id
    WHERE c.store_id = $1
      AND c.status <> 'inactive'
      AND (lo.last_order_date IS NULL OR lo.last_order_date::date <= CURRENT_DATE - INTERVAL '30 days')
    ORDER BY inactive_days DESC, c.name ASC`, [storeId]);

  const rows = result.rows.map((row) => {
    const ca = money(row.ca_ht);
    const margin = money(row.margin_ht);
    const orderCount = Number(row.order_count || 0);
    return {
      client_id: row.client_id,
      client: row.client_name,
      ca_ht: ca,
      margin_ht: margin,
      margin_rate: ca > 0 ? pct((margin / ca) * 100) : 0,
      order_count: orderCount,
      delivery_note_count: Number(row.delivery_note_count || 0),
      invoice_count: Number(row.invoice_count || 0),
      average_basket_ht: orderCount > 0 ? money(ca / orderCount) : 0,
      last_order_date: row.last_order_date,
    };
  });

  const totals = rows.reduce((acc, row) => {
    acc.ca_ht += row.ca_ht;
    acc.margin_ht += row.margin_ht;
    acc.orders += row.order_count;
    acc.delivery_notes += row.delivery_note_count;
    acc.invoices += row.invoice_count;
    return acc;
  }, { ca_ht: 0, margin_ht: 0, orders: 0, delivery_notes: 0, invoices: 0 });

  const inactiveRows = inactive.rows.map((row) => ({
    client_id: row.id,
    client: row.name,
    last_order_date: row.last_order_date,
    inactive_days: Number(row.inactive_days || 0),
  }));

  return {
    kpis: {
      ca_ht: money(totals.ca_ht),
      margin_ht: money(totals.margin_ht),
      delivery_note_count: totals.delivery_notes,
      invoice_count: totals.invoices,
      average_basket_ht: totals.orders > 0 ? money(totals.ca_ht / totals.orders) : 0,
    },
    charts: {
      top_ca: rows.slice().sort((a, b) => b.ca_ht - a.ca_ht).slice(0, 10).map((r) => ({ label: r.client, value: r.ca_ht })),
      top_margin: rows.slice().sort((a, b) => b.margin_ht - a.margin_ht).slice(0, 10).map((r) => ({ label: r.client, value: r.margin_ht })),
    },
    inactive: {
      days_30: inactiveRows.filter((r) => r.inactive_days >= 30),
      days_60: inactiveRows.filter((r) => r.inactive_days >= 60),
      days_90: inactiveRows.filter((r) => r.inactive_days >= 90),
    },
    table: rows,
  };
}

async function suppliersStats(db, storeId, bounds) {
  const result = await db.query(`
    WITH purchase_base AS (
      SELECT p.*
      FROM purchases p
      WHERE p.store_id = $1
        AND COALESCE(p.receipt_date, p.purchase_date) >= $2::date
        AND COALESCE(p.receipt_date, p.purchase_date) <= $3::date
        AND p.status <> 'cancelled'
    ),
    supplier_rows AS (
      SELECT
        s.id AS supplier_id,
        COALESCE(s.name, 'Fournisseur non renseigne') AS supplier_name,
        COALESCE(SUM(pl.line_amount_ex_vat), 0) AS purchases_ht,
        COALESCE(SUM(COALESCE(pl.received_quantity, pl.ordered_quantity, 0)), 0) AS quantity,
        COUNT(DISTINCT p.id) AS reception_count,
        COUNT(DISTINCT CASE WHEN p.bl_number IS NOT NULL THEN p.id END) AS delivery_note_count,
        COUNT(DISTINCT CASE WHEN p.invoice_number IS NOT NULL THEN p.id END) AS invoice_count
      FROM purchase_base p
      JOIN purchase_lines pl ON pl.purchase_id = p.id AND pl.store_id = p.store_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.store_id = p.store_id
      GROUP BY s.id, s.name
    )
    SELECT *, SUM(purchases_ht) OVER () AS total_purchases_ht
    FROM supplier_rows
    ORDER BY purchases_ht DESC, supplier_name ASC`, [storeId, bounds.fromDate, bounds.toDate]);

  const rows = result.rows.map((row) => {
    const purchases = money(row.purchases_ht);
    const quantity = Number(num(row.quantity).toFixed(3));
    const total = num(row.total_purchases_ht);
    return {
      supplier_id: row.supplier_id,
      supplier: row.supplier_name,
      purchases_ht: purchases,
      quantity,
      purchase_share_rate: total > 0 ? pct((purchases / total) * 100) : 0,
      delivery_note_count: Number(row.delivery_note_count || 0),
      invoice_count: Number(row.invoice_count || 0),
      reception_count: Number(row.reception_count || 0),
      average_price_ht: quantity > 0 ? money(purchases / quantity) : 0,
    };
  });

  const totals = rows.reduce((acc, row) => {
    acc.purchases_ht += row.purchases_ht;
    acc.quantity += row.quantity;
    acc.receptions += row.reception_count;
    return acc;
  }, { purchases_ht: 0, quantity: 0, receptions: 0 });

  return {
    kpis: {
      purchases_ht: money(totals.purchases_ht),
      quantity: Number(totals.quantity.toFixed(3)),
      average_price_ht: totals.quantity > 0 ? money(totals.purchases_ht / totals.quantity) : 0,
      reception_count: totals.receptions,
    },
    charts: {
      purchase_share: rows.slice(0, 10).map((r) => ({ label: r.supplier, value: r.purchases_ht })),
      top_purchases: rows.slice().sort((a, b) => b.purchases_ht - a.purchases_ht).slice(0, 10).map((r) => ({ label: r.supplier, value: r.purchases_ht })),
    },
    table: rows,
  };
}

async function latestSnapshotBefore(db, storeId, bound) {
  const result = await db.query(
    `SELECT id, snapshot_date, snapshot_type, total_value_ht
     FROM stock_snapshots
     WHERE store_id = $1 AND snapshot_date <= $2
     ORDER BY snapshot_date DESC
     LIMIT 1`,
    [storeId, bound]
  );
  return result.rows[0] || null;
}

async function purchaseTotals(db, storeId, bounds) {
  const result = await db.query(
    `SELECT COALESCE(SUM(pl.line_amount_ex_vat), 0) AS purchases_ht
     FROM purchases p
     JOIN purchase_lines pl ON pl.purchase_id = p.id AND pl.store_id = p.store_id
     WHERE p.store_id = $1
       AND COALESCE(p.receipt_date, p.purchase_date) >= $2::date
       AND COALESCE(p.receipt_date, p.purchase_date) <= $3::date
       AND p.status <> 'cancelled'`,
    [storeId, bounds.fromDate, bounds.toDate]
  );
  return num(result.rows[0]?.purchases_ht);
}

async function marginEvolution(db, storeId, bounds) {
  const result = await db.query(`${salesLinesCte()}
    SELECT document_date::date AS date, COALESCE(SUM(ca_ht), 0) ca_ht, COALESCE(SUM(margin_ht), 0) margin_ht
    FROM valid_lines
    GROUP BY document_date::date
    ORDER BY document_date::date`, [storeId, bounds.fromDate, bounds.toDate]);
  return result.rows.map((row) => ({ label: isoDate(new Date(row.date)), ca_ht: money(row.ca_ht), margin_ht: money(row.margin_ht) }));
}

async function marginsStats(db, storeId, bounds) {
  const [initialSnapshot, finalSnapshot, purchasesHt, articleRows, clientRows, supplierRows, evolution] = await Promise.all([
    latestSnapshotBefore(db, storeId, bounds.fromStart),
    latestSnapshotBefore(db, storeId, bounds.toEnd),
    purchaseTotals(db, storeId, bounds),
    articlesStats(db, storeId, bounds),
    clientsStats(db, storeId, bounds),
    db.query(`${salesLinesCte()}
      SELECT
        COALESCE(s.name, 'Fournisseur non lie') AS supplier,
        COALESCE(SUM(sla.quantity * vl.unit_price_ht), 0) AS ca_ht,
        COALESCE(SUM(sla.quantity * COALESCE(sla.unit_cost_ex_vat, 0)), 0) AS cost_ht,
        COALESCE(SUM(sla.quantity * (vl.unit_price_ht - COALESCE(sla.unit_cost_ex_vat, 0))), 0) AS margin_ht
      FROM valid_lines vl
      JOIN sale_line_allocations sla ON sla.sales_line_id = vl.line_id
      LEFT JOIN lots l ON l.id = sla.lot_id
      LEFT JOIN suppliers s ON s.id = l.supplier_id AND s.store_id = $1
      GROUP BY s.name
      ORDER BY margin_ht DESC, supplier ASC`, [storeId, bounds.fromDate, bounds.toDate]),
    marginEvolution(db, storeId, bounds),
  ]);

  const caHt = articleRows.kpis.ca_ht;
  const stockInitialHt = initialSnapshot ? money(initialSnapshot.total_value_ht) : null;
  const stockFinalHt = finalSnapshot ? money(finalSnapshot.total_value_ht) : null;
  const hasSnapshots = Boolean(initialSnapshot && finalSnapshot);
  const consumedPurchasesHt = hasSnapshots ? money(purchasesHt + stockInitialHt - stockFinalHt) : null;
  const grossMarginHt = hasSnapshots ? money(caHt - consumedPurchasesHt) : articleRows.kpis.margin_ht;
  const marginRate = caHt > 0 ? pct((grossMarginHt / caHt) * 100) : 0;

  const supplierTable = supplierRows.rows.map((row) => {
    const ca = money(row.ca_ht);
    const margin = money(row.margin_ht);
    return {
      supplier: row.supplier,
      ca_ht: ca,
      cost_ht: money(row.cost_ht),
      margin_ht: margin,
      margin_rate: ca > 0 ? pct((margin / ca) * 100) : 0,
    };
  });

  return {
    kpis: {
      ca_ht: caHt,
      consumed_purchases_ht: consumedPurchasesHt,
      gross_margin_ht: grossMarginHt,
      margin_rate: marginRate,
      stock_initial_ht: stockInitialHt,
      stock_final_ht: stockFinalHt,
    },
    snapshots: {
      available: hasSnapshots,
      message: hasSnapshots ? null : 'Capture de stock manquante : marge globale basee sur la marge des lignes de vente.',
      initial: initialSnapshot,
      final: finalSnapshot,
    },
    charts: {
      margin_evolution: evolution,
      top_articles: articleRows.table.slice().sort((a, b) => b.margin_ht - a.margin_ht).slice(0, 10).map((r) => ({ label: r.article, value: r.margin_ht })),
      top_clients: clientRows.table.slice().sort((a, b) => b.margin_ht - a.margin_ht).slice(0, 10).map((r) => ({ label: r.client, value: r.margin_ht })),
    },
    tables: {
      articles: articleRows.table,
      clients: clientRows.table,
      suppliers: supplierTable,
    },
  };
}

function withMeta(bounds, data) {
  return { period: bounds.period, from: bounds.fromDate, to: bounds.toDate, ...data };
}

function handler(loader, label) {
  return async (req, res) => {
    try {
      const bounds = rangeBounds(periodRange(req.query || {}));
      const data = await loader(req.dbPool, req.user.store_id, bounds);
      res.json(withMeta(bounds, data));
    } catch (error) {
      console.error(`Erreur statistiques ${label} :`, error);
      res.status(500).json({ error: `Erreur statistiques ${label}` });
    }
  };
}

router.get('/statistics/articles', authenticateToken, attachDbContext, handler(articlesStats, 'articles'));
router.get('/statistics/clients', authenticateToken, attachDbContext, handler(clientsStats, 'clients'));
router.get('/statistics/suppliers', authenticateToken, attachDbContext, handler(suppliersStats, 'fournisseurs'));
router.get('/statistics/margins', authenticateToken, attachDbContext, handler(marginsStats, 'marges'));

module.exports = router;
