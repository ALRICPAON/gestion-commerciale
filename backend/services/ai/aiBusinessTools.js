const OPTIONAL_DB_ERROR_CODES = new Set(['42P01', '42703', '42883']);
const DEFAULT_LIMIT = 25;

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, decimals = 2) {
  return Number(number(value).toFixed(decimals));
}

function rows(result, limit = DEFAULT_LIMIT) {
  return Array.isArray(result) ? result.slice(0, limit) : [];
}

function unavailable(name, reason = 'Données non disponibles dans le schéma actuel.') {
  return {
    name,
    available: false,
    reason,
    data: {},
  };
}

async function safeQuery(db, label, sql, params = []) {
  try {
    const result = await db.query(sql, params);
    return {
      available: true,
      rows: result.rows,
    };
  } catch (error) {
    if (OPTIONAL_DB_ERROR_CODES.has(error.code)) {
      console.warn(`Agent IA outil ignore ${label} :`, {
        code: error.code,
        message: error.message,
      });
      return {
        available: false,
        rows: [],
        reason: 'Données non disponibles dans le schéma actuel.',
      };
    }

    console.error(`Agent IA outil erreur ${label} :`, {
      code: error.code || null,
      message: error.message,
    });

    return {
      available: false,
      rows: [],
      reason: 'Analyse indisponible temporairement.',
    };
  }
}

async function analyzeStock(db, storeId) {
  const [availableStock, availableLots, negativeStock, articlesWithoutStock] = await Promise.all([
    safeQuery(db, 'stock disponible par article', `
      SELECT
        a.id AS article_id,
        a.plu,
        a.designation,
        a.unit,
        ss.stock_quantity,
        ss.stock_value_ex_vat,
        ss.pma,
        ss.next_dlc
      FROM articles a
      LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
      WHERE a.store_id = $1
        AND COALESCE(a.is_active, true) = true
        AND COALESCE(ss.stock_quantity, 0) > 0
      ORDER BY ss.stock_quantity DESC, a.designation ASC
      LIMIT 80
    `, [storeId]),
    safeQuery(db, 'lots disponibles', `
      SELECT
        l.id AS lot_id,
        l.lot_code,
        l.supplier_lot_number,
        l.qty_remaining,
        l.unit_cost_ex_vat,
        l.dlc,
        a.plu,
        a.designation,
        s.name AS supplier_name
      FROM lots l
      JOIN articles a ON a.id = l.article_id AND a.store_id = l.store_id
      LEFT JOIN suppliers s ON s.id = l.supplier_id AND s.store_id = l.store_id
      WHERE l.store_id = $1
        AND l.qty_remaining > 0
      ORDER BY COALESCE(l.dlc, DATE '9999-12-31') ASC, a.designation ASC
      LIMIT 80
    `, [storeId]),
    safeQuery(db, 'stocks negatifs', `
      SELECT
        a.id AS article_id,
        a.plu,
        a.designation,
        a.unit,
        ss.stock_quantity,
        ss.stock_value_ex_vat
      FROM stock_summary ss
      JOIN articles a ON a.id = ss.article_id AND a.store_id = ss.store_id
      WHERE ss.store_id = $1
        AND ss.stock_quantity < 0
      ORDER BY ss.stock_quantity ASC, a.designation ASC
      LIMIT 40
    `, [storeId]),
    safeQuery(db, 'articles sans stock', `
      SELECT
        a.id AS article_id,
        a.plu,
        a.designation,
        a.unit,
        a.family_name
      FROM articles a
      LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
      WHERE a.store_id = $1
        AND COALESCE(a.is_active, true) = true
        AND COALESCE(ss.stock_quantity, 0) = 0
      ORDER BY a.designation ASC
      LIMIT 60
    `, [storeId]),
  ]);

  const stockRows = rows(availableStock.rows, 80);
  const totalQuantity = stockRows.reduce((sum, row) => sum + number(row.stock_quantity), 0);
  const totalValue = stockRows.reduce((sum, row) => sum + number(row.stock_value_ex_vat), 0);

  return {
    name: 'analyze_stock',
    available: availableStock.available || availableLots.available,
    data: {
      totals: {
        available_articles: stockRows.length,
        available_quantity: round(totalQuantity, 3),
        available_value_ht: round(totalValue, 2),
        negative_stock_count: negativeStock.rows.length,
        articles_without_stock_count: articlesWithoutStock.rows.length,
      },
      available_stock: stockRows,
      available_lots: rows(availableLots.rows, 60),
      negative_stock: rows(negativeStock.rows, 40),
      articles_without_stock: rows(articlesWithoutStock.rows, 40),
    },
  };
}

async function analyzeDlc(db, storeId) {
  const [soon, expired] = await Promise.all([
    safeQuery(db, 'DLC proches', `
      SELECT
        l.id AS lot_id,
        l.lot_code,
        l.supplier_lot_number,
        l.qty_remaining,
        l.unit_cost_ex_vat,
        l.dlc,
        (l.dlc::date - CURRENT_DATE) AS days_before_dlc,
        a.plu,
        a.designation,
        s.name AS supplier_name
      FROM lots l
      JOIN articles a ON a.id = l.article_id AND a.store_id = l.store_id
      LEFT JOIN suppliers s ON s.id = l.supplier_id AND s.store_id = l.store_id
      WHERE l.store_id = $1
        AND l.qty_remaining > 0
        AND l.dlc IS NOT NULL
        AND l.dlc >= CURRENT_DATE
        AND l.dlc <= CURRENT_DATE + INTERVAL '10 days'
      ORDER BY l.dlc ASC, l.qty_remaining DESC, a.designation ASC
      LIMIT 60
    `, [storeId]),
    safeQuery(db, 'DLC depassees', `
      SELECT
        l.id AS lot_id,
        l.lot_code,
        l.supplier_lot_number,
        l.qty_remaining,
        l.unit_cost_ex_vat,
        l.dlc,
        (CURRENT_DATE - l.dlc::date) AS days_expired,
        a.plu,
        a.designation,
        s.name AS supplier_name
      FROM lots l
      JOIN articles a ON a.id = l.article_id AND a.store_id = l.store_id
      LEFT JOIN suppliers s ON s.id = l.supplier_id AND s.store_id = l.store_id
      WHERE l.store_id = $1
        AND l.qty_remaining > 0
        AND l.dlc IS NOT NULL
        AND l.dlc < CURRENT_DATE
      ORDER BY l.dlc ASC, a.designation ASC
      LIMIT 60
    `, [storeId]),
  ]);

  const salePriority = [...expired.rows, ...soon.rows]
    .map((lot) => ({
      ...lot,
      priority: lot.days_expired !== undefined ? 'controle_urgent' : Number(lot.days_before_dlc) <= 2 ? 'vente_urgente' : 'vente_prioritaire',
    }))
    .slice(0, 60);

  return {
    name: 'analyze_dlc',
    available: soon.available || expired.available,
    data: {
      lots_expired: rows(expired.rows, 60),
      lots_soon: rows(soon.rows, 60),
      sale_priority: salePriority,
    },
  };
}

async function analyzeClients(db, storeId) {
  const [bestClients, recentClients, inactiveClients] = await Promise.all([
    safeQuery(db, 'meilleurs clients', `
      SELECT
        c.id AS client_id,
        c.code,
        c.name,
        c.email,
        c.mobile,
        COUNT(sd.id) AS document_count,
        COALESCE(SUM(sd.total_ht), 0) AS ca_ht,
        MAX(sd.document_date) AS last_sale_date
      FROM clients c
      JOIN sales_documents sd ON sd.client_id = c.id AND sd.store_id = c.store_id
      WHERE c.store_id = $1
        AND COALESCE(c.status, 'active') <> 'inactive'
        AND sd.document_date >= CURRENT_DATE - INTERVAL '90 days'
        AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
      GROUP BY c.id, c.code, c.name, c.email, c.mobile
      ORDER BY ca_ht DESC, document_count DESC, c.name ASC
      LIMIT 30
    `, [storeId]),
    safeQuery(db, 'clients recents', `
      SELECT
        c.id AS client_id,
        c.code,
        c.name,
        c.email,
        c.mobile,
        MAX(sd.document_date) AS last_sale_date,
        COUNT(sd.id) AS document_count
      FROM clients c
      JOIN sales_documents sd ON sd.client_id = c.id AND sd.store_id = c.store_id
      WHERE c.store_id = $1
        AND COALESCE(c.status, 'active') <> 'inactive'
        AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
      GROUP BY c.id, c.code, c.name, c.email, c.mobile
      ORDER BY last_sale_date DESC, c.name ASC
      LIMIT 30
    `, [storeId]),
    safeQuery(db, 'clients inactifs', `
      WITH last_sales AS (
        SELECT client_id, MAX(document_date) AS last_sale_date, COUNT(*) AS document_count
        FROM sales_documents
        WHERE store_id = $1
          AND COALESCE(status, '') NOT IN ('draft', 'cancelled')
        GROUP BY client_id
      )
      SELECT
        c.id AS client_id,
        c.code,
        c.name,
        c.email,
        c.mobile,
        ls.last_sale_date,
        CASE WHEN ls.last_sale_date IS NULL THEN 9999 ELSE CURRENT_DATE - ls.last_sale_date::date END AS inactive_days,
        COALESCE(ls.document_count, 0) AS document_count
      FROM clients c
      LEFT JOIN last_sales ls ON ls.client_id = c.id
      WHERE c.store_id = $1
        AND COALESCE(c.status, 'active') <> 'inactive'
        AND (ls.last_sale_date IS NULL OR ls.last_sale_date <= CURRENT_DATE - INTERVAL '30 days')
      ORDER BY inactive_days DESC, c.name ASC
      LIMIT 50
    `, [storeId]),
  ]);

  return {
    name: 'analyze_clients',
    available: bestClients.available || recentClients.available || inactiveClients.available,
    data: {
      best_clients: rows(bestClients.rows, 30),
      recent_clients: rows(recentClients.rows, 30),
      inactive_clients: rows(inactiveClients.rows, 50),
      clients_to_follow_up: rows(inactiveClients.rows, 20),
    },
  };
}

async function analyzeSales(db, storeId) {
  const [recentSales, periodRevenue, topArticles, topClients] = await Promise.all([
    safeQuery(db, 'ventes recentes', `
      SELECT
        sd.id,
        sd.document_type,
        sd.document_number,
        sd.document_date,
        sd.status,
        sd.total_ht,
        c.name AS client_name
      FROM sales_documents sd
      LEFT JOIN clients c ON c.id = sd.client_id AND c.store_id = sd.store_id
      WHERE sd.store_id = $1
      ORDER BY sd.document_date DESC, sd.created_at DESC
      LIMIT 30
    `, [storeId]),
    safeQuery(db, 'CA par periode', `
      SELECT
        date_trunc('day', document_date)::date AS period,
        COUNT(*) AS document_count,
        COALESCE(SUM(total_ht), 0) AS ca_ht
      FROM sales_documents
      WHERE store_id = $1
        AND document_date >= CURRENT_DATE - INTERVAL '30 days'
        AND COALESCE(status, '') NOT IN ('draft', 'cancelled')
      GROUP BY date_trunc('day', document_date)::date
      ORDER BY period DESC
      LIMIT 30
    `, [storeId]),
    safeQuery(db, 'top articles vendus', `
      SELECT
        COALESCE(a.plu, sl.article_plu) AS plu,
        COALESCE(a.designation, sl.article_label, 'Article sans nom') AS designation,
        COALESCE(SUM(COALESCE(sl.sold_quantity, sl.total_weight, 0)), 0) AS quantity,
        COALESCE(SUM(sl.line_amount_ht), 0) AS ca_ht
      FROM sales_lines sl
      JOIN sales_documents sd ON sd.id = sl.sales_document_id AND sd.store_id = sl.store_id
      LEFT JOIN articles a ON a.id = sl.article_id AND a.store_id = sl.store_id
      WHERE sl.store_id = $1
        AND sd.document_date >= CURRENT_DATE - INTERVAL '30 days'
        AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
      GROUP BY COALESCE(a.plu, sl.article_plu), COALESCE(a.designation, sl.article_label, 'Article sans nom')
      ORDER BY ca_ht DESC, quantity DESC
      LIMIT 30
    `, [storeId]),
    safeQuery(db, 'top clients ventes', `
      SELECT
        c.id AS client_id,
        c.code,
        c.name,
        COUNT(sd.id) AS document_count,
        COALESCE(SUM(sd.total_ht), 0) AS ca_ht
      FROM sales_documents sd
      LEFT JOIN clients c ON c.id = sd.client_id AND c.store_id = sd.store_id
      WHERE sd.store_id = $1
        AND sd.document_date >= CURRENT_DATE - INTERVAL '30 days'
        AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
      GROUP BY c.id, c.code, c.name
      ORDER BY ca_ht DESC, document_count DESC
      LIMIT 30
    `, [storeId]),
  ]);

  return {
    name: 'analyze_sales',
    available: recentSales.available || periodRevenue.available || topArticles.available || topClients.available,
    data: {
      recent_sales: rows(recentSales.rows, 30),
      revenue_by_day: rows(periodRevenue.rows, 30),
      top_articles: rows(topArticles.rows, 30),
      top_clients: rows(topClients.rows, 30),
    },
  };
}

async function analyzeMargins(db, storeId) {
  const [byArticle, byClient] = await Promise.all([
    safeQuery(db, 'marges par article', `
      SELECT
        COALESCE(a.plu, sl.article_plu) AS plu,
        COALESCE(a.designation, sl.article_label, 'Article sans nom') AS designation,
        COALESCE(SUM(sl.line_amount_ht), 0) AS ca_ht,
        COALESCE(SUM(sl.line_margin_ex_vat), 0) AS margin_ht,
        CASE WHEN COALESCE(SUM(sl.line_amount_ht), 0) > 0
          THEN COALESCE(SUM(sl.line_margin_ex_vat), 0) / COALESCE(SUM(sl.line_amount_ht), 0) * 100
          ELSE 0
        END AS margin_rate
      FROM sales_lines sl
      JOIN sales_documents sd ON sd.id = sl.sales_document_id AND sd.store_id = sl.store_id
      LEFT JOIN articles a ON a.id = sl.article_id AND a.store_id = sl.store_id
      WHERE sl.store_id = $1
        AND sd.document_date >= CURRENT_DATE - INTERVAL '30 days'
        AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
      GROUP BY COALESCE(a.plu, sl.article_plu), COALESCE(a.designation, sl.article_label, 'Article sans nom')
      ORDER BY margin_ht DESC
      LIMIT 50
    `, [storeId]),
    safeQuery(db, 'marges par client', `
      SELECT
        c.id AS client_id,
        c.code,
        c.name,
        COALESCE(SUM(sl.line_amount_ht), 0) AS ca_ht,
        COALESCE(SUM(sl.line_margin_ex_vat), 0) AS margin_ht,
        CASE WHEN COALESCE(SUM(sl.line_amount_ht), 0) > 0
          THEN COALESCE(SUM(sl.line_margin_ex_vat), 0) / COALESCE(SUM(sl.line_amount_ht), 0) * 100
          ELSE 0
        END AS margin_rate
      FROM sales_documents sd
      JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
      LEFT JOIN clients c ON c.id = sd.client_id AND c.store_id = sd.store_id
      WHERE sd.store_id = $1
        AND sd.document_date >= CURRENT_DATE - INTERVAL '30 days'
        AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
      GROUP BY c.id, c.code, c.name
      ORDER BY margin_ht DESC
      LIMIT 50
    `, [storeId]),
  ]);

  const articleRows = rows(byArticle.rows, 50);
  const sortedByRate = articleRows.slice().sort((a, b) => number(a.margin_rate) - number(b.margin_rate));

  return {
    name: 'analyze_margins',
    available: byArticle.available || byClient.available,
    data: {
      margin_by_article: articleRows,
      margin_by_client: rows(byClient.rows, 50),
      low_margin_articles: sortedByRate.slice(0, 15),
      high_margin_articles: sortedByRate.slice(-15).reverse(),
    },
  };
}

async function analyzeSuppliers(db, storeId) {
  const [recentPurchases, topSuppliers] = await Promise.all([
    safeQuery(db, 'achats recents fournisseurs', `
      SELECT
        p.id,
        p.purchase_date,
        p.receipt_date,
        p.status,
        p.bl_number,
        p.invoice_number,
        s.id AS supplier_id,
        s.code AS supplier_code,
        s.name AS supplier_name
      FROM purchases p
      LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.store_id = p.store_id
      WHERE p.store_id = $1
      ORDER BY COALESCE(p.receipt_date, p.purchase_date) DESC, p.created_at DESC
      LIMIT 30
    `, [storeId]),
    safeQuery(db, 'fournisseurs principaux', `
      SELECT
        s.id AS supplier_id,
        s.code,
        s.name,
        COUNT(DISTINCT p.id) AS purchase_count,
        COALESCE(SUM(pl.line_amount_ex_vat), 0) AS purchases_ht,
        COALESCE(SUM(COALESCE(pl.received_quantity, pl.ordered_quantity, 0)), 0) AS quantity
      FROM purchases p
      JOIN purchase_lines pl ON pl.purchase_id = p.id AND pl.store_id = p.store_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.store_id = p.store_id
      WHERE p.store_id = $1
        AND COALESCE(p.receipt_date, p.purchase_date) >= CURRENT_DATE - INTERVAL '90 days'
        AND COALESCE(p.status, '') <> 'cancelled'
      GROUP BY s.id, s.code, s.name
      ORDER BY purchases_ht DESC, quantity DESC
      LIMIT 30
    `, [storeId]),
  ]);

  return {
    name: 'analyze_suppliers',
    available: recentPurchases.available || topSuppliers.available,
    data: {
      recent_purchases: rows(recentPurchases.rows, 30),
      top_suppliers: rows(topSuppliers.rows, 30),
    },
  };
}

const businessTools = {
  analyze_stock: analyzeStock,
  analyze_dlc: analyzeDlc,
  analyze_clients: analyzeClients,
  analyze_sales: analyzeSales,
  analyze_margins: analyzeMargins,
  analyze_suppliers: analyzeSuppliers,
};

async function runBusinessTool(name, { db, storeId }) {
  const tool = businessTools[name];
  if (!tool) return unavailable(name, 'Outil inconnu.');

  try {
    return await tool(db, storeId);
  } catch (error) {
    console.error(`Agent IA outil ${name} indisponible :`, {
      message: error.message,
      code: error.code || null,
    });
    return unavailable(name, 'Analyse indisponible temporairement.');
  }
}

module.exports = {
  businessTools,
  runBusinessTool,
};
