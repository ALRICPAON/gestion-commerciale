const OPTIONAL_DB_ERROR_CODES = new Set(['42P01', '42703', '42883']);

const MAX_CLIENTS = 5;
const LOW_HISTORY_MAX_CLIENTS = 3;
const MAX_PRODUCTS_PER_CLIENT = 5;

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, decimals = 2) {
  return Number(number(value).toFixed(decimals));
}

function formatQuantity(value, unit) {
  const quantity = round(value, 3);
  return `${quantity} ${unit || 'unite'}`;
}

function buildReasons(row, options = {}) {
  const includeClientHistory = options.includeClientHistory !== false;
  const reasons = [];

  if (number(row.dlc_score) > 0) {
    const days = row.days_before_dlc === null || row.days_before_dlc === undefined
      ? null
      : number(row.days_before_dlc);
    reasons.push(days !== null && days >= 0
      ? `DLC proche (${days} jour${days > 1 ? 's' : ''})`
      : 'DLC proche');
  }

  if (includeClientHistory && number(row.history_score) > 0) {
    reasons.push('client deja acheteur');
  }

  if (number(row.margin_score) > 0) {
    reasons.push(`marge interessante (${round(row.margin_rate, 1)}%)`);
  }

  if (number(row.stock_score) > 0) {
    reasons.push(`stock disponible important (${formatQuantity(row.stock_quantity, row.unit)})`);
  }

  if (number(row.recent_sales_score) > 0) {
    reasons.push('article vendu recemment');
  }

  return reasons.length > 0 ? reasons : ['stock disponible'];
}

function buildSalesPitch(client, products) {
  const firstProduct = products[0];
  if (!firstProduct) return '';

  return [
    `Bonjour ${client.name || ''},`,
    `j'ai de la belle ${String(firstProduct.designation || 'marchandise').toLowerCase()} disponible aujourd'hui.`,
    firstProduct.reasons.some((reason) => reason.includes('DLC proche'))
      ? 'Je peux te faire une proposition interessante pour faire tourner rapidement.'
      : 'C est un bon produit a proposer pour ton rayon.',
  ].join(' ').replace(/\s+/g, ' ').trim();
}

function buildUnavailableResult(reason) {
  return {
    name: 'recommend_sales_actions',
    available: false,
    reason,
    data: {
      recommendations: [],
      missing_data: [reason],
    },
  };
}

async function loadRecommendationDiagnostics(db, storeId) {
  const [clients, stock, dlc, sales, margins] = await Promise.all([
    db.query(`
      SELECT COUNT(*)::int AS count
      FROM clients
      WHERE store_id = $1
        AND COALESCE(status, 'active') <> 'inactive'
        AND LOWER(COALESCE(name, '')) NOT LIKE '%alric%'
        AND LOWER(COALESCE(email, '')) NOT LIKE '%alric%'
    `, [storeId]),
    db.query(`
      SELECT COUNT(*)::int AS count
      FROM stock_summary ss
      JOIN articles a ON a.id = ss.article_id AND a.store_id = ss.store_id
      WHERE ss.store_id = $1
        AND COALESCE(a.is_active, true) = true
        AND COALESCE(ss.stock_quantity, 0) > 0
    `, [storeId]),
    db.query(`
      SELECT COUNT(*)::int AS count
      FROM stock_summary ss
      JOIN articles a ON a.id = ss.article_id AND a.store_id = ss.store_id
      WHERE ss.store_id = $1
        AND COALESCE(a.is_active, true) = true
        AND COALESCE(ss.stock_quantity, 0) > 0
        AND ss.next_dlc IS NOT NULL
        AND ss.next_dlc::date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
    `, [storeId]),
    db.query(`
      SELECT COUNT(*)::int AS count
      FROM sales_documents sd
      JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
      WHERE sd.store_id = $1
        AND sl.article_id IS NOT NULL
        AND sd.document_date >= CURRENT_DATE - INTERVAL '180 days'
        AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
    `, [storeId]),
    db.query(`
      SELECT COUNT(*)::int AS count
      FROM sales_documents sd
      JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
      WHERE sd.store_id = $1
        AND sl.article_id IS NOT NULL
        AND sd.document_date >= CURRENT_DATE - INTERVAL '90 days'
        AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
        AND COALESCE(sl.line_margin_ex_vat, 0) <> 0
    `, [storeId]),
  ]);

  return {
    clients: number(clients.rows[0]?.count),
    stock: number(stock.rows[0]?.count),
    dlc: number(dlc.rows[0]?.count),
    sales: number(sales.rows[0]?.count),
    margins: number(margins.rows[0]?.count),
  };
}

async function loadRecommendationRows(db, storeId) {
  const result = await db.query(`
    WITH available_stock AS (
      SELECT
        a.id AS article_id,
        a.plu,
        a.designation,
        a.unit,
        ss.stock_quantity,
        ss.stock_value_ex_vat,
        ss.pma,
        ss.next_dlc,
        CASE
          WHEN ss.next_dlc IS NULL THEN NULL
          ELSE ss.next_dlc::date - CURRENT_DATE
        END AS days_before_dlc
      FROM stock_summary ss
      JOIN articles a ON a.id = ss.article_id AND a.store_id = ss.store_id
      WHERE ss.store_id = $1
        AND COALESCE(a.is_active, true) = true
        AND COALESCE(ss.stock_quantity, 0) > 0
      ORDER BY
        CASE WHEN ss.next_dlc IS NULL THEN 9999 ELSE ss.next_dlc::date - CURRENT_DATE END ASC,
        ss.stock_quantity DESC,
        a.designation ASC
      LIMIT 80
    ),
    active_clients AS (
      SELECT
        c.id AS client_id,
        c.code AS client_code,
        c.name,
        c.city,
        c.email,
        c.mobile,
        c.phone,
        MAX(sd.document_date) AS last_sale_date,
        COUNT(sd.id) AS document_count,
        COALESCE(SUM(sd.total_amount_ex_vat), 0) AS ca_ht
      FROM clients c
      LEFT JOIN sales_documents sd
        ON sd.client_id = c.id
       AND sd.store_id = c.store_id
       AND sd.document_date >= CURRENT_DATE - INTERVAL '180 days'
       AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
      WHERE c.store_id = $1
        AND COALESCE(c.status, 'active') <> 'inactive'
        AND LOWER(COALESCE(c.name, '')) NOT LIKE '%alric%'
        AND LOWER(COALESCE(c.email, '')) NOT LIKE '%alric%'
      GROUP BY c.id, c.code, c.name, c.city, c.email, c.mobile, c.phone
      ORDER BY
        MAX(sd.document_date) DESC NULLS LAST,
        COALESCE(SUM(sd.total_amount_ex_vat), 0) DESC,
        c.name ASC
      LIMIT 80
    ),
    client_article_history AS (
      SELECT
        sd.client_id,
        sl.article_id,
        MAX(sd.document_date) AS last_article_sale_date,
        COUNT(sl.id) AS article_sale_count,
        COALESCE(SUM(COALESCE(sl.sold_quantity, sl.total_weight, 0)), 0) AS quantity_sold,
        COALESCE(SUM(sl.line_amount_ht), 0) AS ca_ht
      FROM sales_documents sd
      JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
      WHERE sd.store_id = $1
        AND sl.article_id IS NOT NULL
        AND sd.document_date >= CURRENT_DATE - INTERVAL '180 days'
        AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
      GROUP BY sd.client_id, sl.article_id
    ),
    recent_article_sales AS (
      SELECT
        sl.article_id,
        COUNT(DISTINCT sd.client_id) AS recent_client_count,
        COALESCE(SUM(COALESCE(sl.sold_quantity, sl.total_weight, 0)), 0) AS recent_quantity,
        COALESCE(SUM(sl.line_amount_ht), 0) AS recent_ca_ht
      FROM sales_documents sd
      JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
      WHERE sd.store_id = $1
        AND sl.article_id IS NOT NULL
        AND sd.document_date >= CURRENT_DATE - INTERVAL '30 days'
        AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
      GROUP BY sl.article_id
    ),
    article_margins AS (
      SELECT
        sl.article_id,
        COALESCE(SUM(sl.line_amount_ht), 0) AS margin_ca_ht,
        COALESCE(SUM(sl.line_margin_ex_vat), 0) AS margin_ht,
        CASE
          WHEN COALESCE(SUM(sl.line_amount_ht), 0) > 0
          THEN COALESCE(SUM(sl.line_margin_ex_vat), 0) / COALESCE(SUM(sl.line_amount_ht), 0) * 100
          ELSE 0
        END AS margin_rate
      FROM sales_documents sd
      JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
      WHERE sd.store_id = $1
        AND sl.article_id IS NOT NULL
        AND sd.document_date >= CURRENT_DATE - INTERVAL '90 days'
        AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
      GROUP BY sl.article_id
    )
    SELECT
      c.client_id,
      c.client_code,
      c.name AS client_name,
      c.city AS client_city,
      c.email,
      c.mobile,
      c.phone,
      c.last_sale_date,
      c.document_count,
      c.ca_ht AS client_ca_ht,
      s.article_id,
      s.plu,
      s.designation,
      s.unit,
      s.stock_quantity,
      s.stock_value_ex_vat,
      s.pma,
      s.next_dlc,
      s.days_before_dlc,
      h.last_article_sale_date,
      h.article_sale_count,
      h.quantity_sold,
      h.ca_ht AS article_client_ca_ht,
      COALESCE(m.margin_ht, 0) AS margin_ht,
      COALESCE(m.margin_rate, 0) AS margin_rate,
      COALESCE(r.recent_client_count, 0) AS recent_client_count,
      COALESCE(r.recent_quantity, 0) AS recent_quantity,
      CASE
        WHEN s.days_before_dlc IS NOT NULL AND s.days_before_dlc BETWEEN 0 AND 3 THEN 40
        WHEN s.days_before_dlc IS NOT NULL AND s.days_before_dlc BETWEEN 4 AND 7 THEN 25
        ELSE 0
      END AS dlc_score,
      CASE WHEN h.article_sale_count IS NOT NULL THEN 30 ELSE 0 END AS history_score,
      CASE WHEN COALESCE(m.margin_rate, 0) >= 20 THEN 20 ELSE 0 END AS margin_score,
      CASE WHEN COALESCE(s.stock_quantity, 0) >= 20 THEN 10 ELSE 0 END AS stock_score,
      CASE WHEN COALESCE(r.recent_client_count, 0) > 0 THEN 10 ELSE 0 END AS recent_sales_score
    FROM active_clients c
    CROSS JOIN available_stock s
    LEFT JOIN client_article_history h ON h.client_id = c.client_id AND h.article_id = s.article_id
    LEFT JOIN recent_article_sales r ON r.article_id = s.article_id
    LEFT JOIN article_margins m ON m.article_id = s.article_id
    ORDER BY
      (
        CASE
          WHEN s.days_before_dlc IS NOT NULL AND s.days_before_dlc BETWEEN 0 AND 3 THEN 40
          WHEN s.days_before_dlc IS NOT NULL AND s.days_before_dlc BETWEEN 4 AND 7 THEN 25
          ELSE 0
        END
        + CASE WHEN h.article_sale_count IS NOT NULL THEN 30 ELSE 0 END
        + CASE WHEN COALESCE(m.margin_rate, 0) >= 20 THEN 20 ELSE 0 END
        + CASE WHEN COALESCE(s.stock_quantity, 0) >= 20 THEN 10 ELSE 0 END
        + CASE WHEN COALESCE(r.recent_client_count, 0) > 0 THEN 10 ELSE 0 END
      ) DESC,
      c.last_sale_date DESC NULLS LAST,
      s.stock_quantity DESC,
      s.designation ASC
    LIMIT 300
  `, [storeId]);

  return result.rows;
}

function buildProductPriorities(queryRows, options = {}) {
  const includeClientHistory = options.includeClientHistory !== false;
  const byArticle = new Map();

  queryRows.forEach((row) => {
    if (byArticle.has(row.article_id)) return;

    const score = number(row.dlc_score)
      + number(row.margin_score)
      + number(row.stock_score)
      + number(row.recent_sales_score);

    if (score <= 0) return;

    byArticle.set(row.article_id, {
      article_id: row.article_id,
      plu: row.plu,
      designation: row.designation,
      unit: row.unit,
      stock_quantity: round(row.stock_quantity, 3),
      stock_value_ht: round(row.stock_value_ex_vat, 2),
      pma: round(row.pma, 3),
      next_dlc: row.next_dlc,
      days_before_dlc: row.days_before_dlc === null ? null : number(row.days_before_dlc),
      margin_ht_90_days: round(row.margin_ht, 2),
      margin_rate: round(row.margin_rate, 1),
      recent_client_count_30_days: number(row.recent_client_count),
      recent_quantity_30_days: round(row.recent_quantity, 3),
      score,
      score_details: {
        dlc: number(row.dlc_score),
        margin: number(row.margin_score),
        stock: number(row.stock_score),
        recent_sales: number(row.recent_sales_score),
      },
      reasons: buildReasons(row, { includeClientHistory }),
    });
  });

  return Array.from(byArticle.values())
    .sort((a, b) => b.score - a.score || b.stock_quantity - a.stock_quantity || a.designation.localeCompare(b.designation))
    .slice(0, MAX_PRODUCTS_PER_CLIENT);
}

function buildRecommendations(queryRows, options = {}) {
  const lowHistoryMode = Boolean(options.lowHistoryMode);
  const maxClients = options.maxClients || MAX_CLIENTS;
  const byClient = new Map();

  queryRows.forEach((row) => {
    const score = number(row.dlc_score)
      + number(row.history_score)
      + number(row.margin_score)
      + number(row.stock_score)
      + number(row.recent_sales_score);

    if (score <= 0) return;

    const clientId = row.client_id;
    if (!byClient.has(clientId)) {
      byClient.set(clientId, {
        client: {
          id: clientId,
          code: row.client_code,
          name: row.client_name,
          city: row.client_city,
          email: row.email,
          mobile: row.mobile,
          phone: row.phone,
          last_sale_date: row.last_sale_date,
          document_count: number(row.document_count),
          ca_ht: round(row.client_ca_ht, 2),
          relation_mode: lowHistoryMode ? 'client_a_tester' : 'client_a_relancer',
        },
        products: [],
      });
    }

    byClient.get(clientId).products.push({
      article_id: row.article_id,
      plu: row.plu,
      designation: row.designation,
      unit: row.unit,
      stock_quantity: round(row.stock_quantity, 3),
      stock_value_ht: round(row.stock_value_ex_vat, 2),
      pma: round(row.pma, 3),
      next_dlc: row.next_dlc,
      days_before_dlc: row.days_before_dlc === null ? null : number(row.days_before_dlc),
      last_article_sale_date: row.last_article_sale_date,
      article_sale_count: number(row.article_sale_count),
      quantity_sold_180_days: round(row.quantity_sold, 3),
      ca_ht_180_days: round(row.article_client_ca_ht, 2),
      margin_ht_90_days: round(row.margin_ht, 2),
      margin_rate: round(row.margin_rate, 1),
      recent_client_count_30_days: number(row.recent_client_count),
      recent_quantity_30_days: round(row.recent_quantity, 3),
      score,
      score_details: {
        dlc: number(row.dlc_score),
        client_history: number(row.history_score),
        margin: number(row.margin_score),
        stock: number(row.stock_score),
        recent_sales: number(row.recent_sales_score),
      },
      is_personalized_by_history: !lowHistoryMode && number(row.history_score) > 0,
      reasons: buildReasons(row, { includeClientHistory: !lowHistoryMode }),
    });
  });

  return Array.from(byClient.values())
    .map((recommendation) => {
      const products = recommendation.products
        .sort((a, b) => b.score - a.score || b.stock_quantity - a.stock_quantity || a.designation.localeCompare(b.designation))
        .slice(0, MAX_PRODUCTS_PER_CLIENT);

      const priorityScore = products.reduce((sum, product) => sum + product.score, 0);

      return {
        client: recommendation.client,
        priority_score: priorityScore,
        priority: priorityScore >= 120 ? 'haute' : priorityScore >= 70 ? 'moyenne' : 'opportunite',
        products,
        sales_pitch: buildSalesPitch(recommendation.client, products),
      };
    })
    .filter((recommendation) => recommendation.products.length > 0)
    .sort((a, b) => b.priority_score - a.priority_score || a.client.name.localeCompare(b.client.name))
    .slice(0, maxClients);
}

async function recommendSalesActions(db, storeId) {
  console.info('[AI SALES] tool called', {
    store_id: storeId,
    tool: 'recommend_sales_actions',
  });

  try {
    const diagnostics = await loadRecommendationDiagnostics(db, storeId);
    console.info('[AI SALES] clients found', {
      store_id: storeId,
      count: diagnostics.clients,
    });
    console.info('[AI SALES] stock found', {
      store_id: storeId,
      count: diagnostics.stock,
      dlc_soon_count: diagnostics.dlc,
    });
    console.info('[AI SALES] sales data found', {
      store_id: storeId,
      sales_line_count_180_days: diagnostics.sales,
      margin_line_count_90_days: diagnostics.margins,
    });

    const queryRows = await loadRecommendationRows(db, storeId);
    const clientArticleHistoryRows = queryRows.filter((row) => number(row.article_sale_count) > 0).length;
    const lowHistoryMode = diagnostics.sales === 0 || clientArticleHistoryRows < 3;
    const recommendations = buildRecommendations(queryRows, {
      lowHistoryMode,
      maxClients: lowHistoryMode ? LOW_HISTORY_MAX_CLIENTS : MAX_CLIENTS,
    });
    const productPriorities = buildProductPriorities(queryRows, {
      includeClientHistory: !lowHistoryMode,
    });

    const missingData = [];
    if (diagnostics.stock === 0) {
      missingData.push('Aucun stock disponible.');
    }
    if (diagnostics.clients === 0) {
      missingData.push('Aucun client actif.');
    }
    if (diagnostics.sales === 0) {
      missingData.push('Aucune vente historique exploitable.');
    }
    if (diagnostics.margins === 0) {
      missingData.push('Aucune marge exploitable.');
    }
    if (queryRows.length === 0 && missingData.length === 0) {
      missingData.push('Aucun stock disponible ou aucun client actif exploitable.');
    }
    if (lowHistoryMode) {
      missingData.push('Historique de ventes insuffisant pour personnaliser fortement les propositions.');
    }
    if (diagnostics.margins > 0 && !queryRows.some((row) => number(row.margin_rate) > 0)) {
      missingData.push('Marges recentes insuffisantes pour prioriser finement la rentabilite.');
    }

    console.info('[AI SALES] recommendations generated', {
      store_id: storeId,
      query_rows: queryRows.length,
      recommendations: recommendations.length,
      product_priorities: productPriorities.length,
      low_history_mode: lowHistoryMode,
      client_article_history_rows: clientArticleHistoryRows,
      missing_data: missingData,
    });

    return {
      name: 'recommend_sales_actions',
      available: recommendations.length > 0,
      reason: recommendations.length > 0 ? undefined : 'Pas assez de stock ou d historique exploitable pour recommander une relance.',
      data: {
        summary: {
          mode: lowHistoryMode ? 'faible_historique' : 'personnalise',
          message: lowHistoryMode
            ? 'Comme tu n’as pas encore assez d’historique de ventes, je te propose une stratégie de démarrage basée surtout sur le stock disponible.'
            : undefined,
          strategy: lowHistoryMode
            ? 'Produits prioritaires globaux selon stock, DLC et marge disponible, puis clients a tester en relance.'
            : 'Recommandations personnalisees par couple client/article.',
          clients_returned: recommendations.length,
          max_clients: lowHistoryMode ? LOW_HISTORY_MAX_CLIENTS : MAX_CLIENTS,
          max_products_per_client: MAX_PRODUCTS_PER_CLIENT,
          client_article_history_rows: clientArticleHistoryRows,
          scoring: {
            dlc_proche: 40,
            client_deja_acheteur: 30,
            marge_elevee: 20,
            stock_important: 10,
            vente_recente_article: 10,
          },
        },
        product_priorities: productPriorities,
        recommendations,
        missing_data: missingData,
      },
    };
  } catch (error) {
    if (OPTIONAL_DB_ERROR_CODES.has(error.code)) {
      console.warn('Agent IA recommandations indisponibles schema :', {
        code: error.code,
        message: error.message,
      });
      return buildUnavailableResult('Données de stock, clients ou ventes non disponibles dans le schéma actuel.');
    }

    console.error('Agent IA recommandations erreur :', {
      code: error.code || null,
      message: error.message,
    });
    return buildUnavailableResult('Recommandations commerciales indisponibles temporairement.');
  }
}

module.exports = {
  recommendSalesActions,
};
