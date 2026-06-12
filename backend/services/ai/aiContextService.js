const OPTIONAL_TABLE_ERROR_CODES = new Set(['42P01', '42703']);

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function limitRows(rows = [], limit = 40) {
  return rows.slice(0, limit);
}

async function safeQuery(db, label, sql, params = [], fallback = []) {
  try {
    const result = await db.query(sql, params);
    return result.rows;
  } catch (error) {
    if (OPTIONAL_TABLE_ERROR_CODES.has(error.code)) {
      console.warn(`Agent IA contexte ignore ${label} :`, error.message);
      return fallback;
    }

    throw error;
  }
}

async function loadUserContext(db, user) {
  const rows = await safeQuery(
    db,
    'utilisateur',
    `
    SELECT id, store_id, email, role, is_active
    FROM users
    WHERE id = $1
      AND store_id = $2
    LIMIT 1
    `,
    [user.id, user.store_id],
    []
  );

  return rows[0] || {
    id: user.id,
    store_id: user.store_id,
    email: user.email,
    role: user.role,
  };
}

async function loadStoreContext(db, storeId) {
  const [stores, settings] = await Promise.all([
    safeQuery(
      db,
      'magasin',
      `
      SELECT id, code, name, client_key
      FROM stores
      WHERE id = $1
      LIMIT 1
      `,
      [storeId],
      []
    ),
    safeQuery(
      db,
      'parametres magasin',
      `
      SELECT company_name, city, country, phone, email, siret, vat_number, sanitary_approval_number
      FROM store_settings
      WHERE store_id = $1
      LIMIT 1
      `,
      [storeId],
      []
    ),
  ]);

  return {
    store: stores[0] || { id: storeId },
    settings: settings[0] || null,
  };
}

async function loadArticles(db, storeId) {
  return limitRows(await safeQuery(
    db,
    'articles actifs',
    `
    SELECT id, plu, designation, unit, family_code, family_name, sale_price_level_1_ht, sale_price_level_2_ht, sale_price_level_3_ht
    FROM articles
    WHERE store_id = $1
      AND COALESCE(is_active, true) = true
    ORDER BY designation ASC
    LIMIT 60
    `,
    [storeId]
  ), 60);
}

async function loadClients(db, storeId) {
  return limitRows(await safeQuery(
    db,
    'clients actifs',
    `
    SELECT id, code, name, client_type, tariff_level, city, email, mobile, phone
    FROM clients
    WHERE store_id = $1
      AND COALESCE(status, 'active') <> 'inactive'
    ORDER BY name ASC
    LIMIT 50
    `,
    [storeId]
  ), 50);
}

async function loadSuppliers(db, storeId) {
  return limitRows(await safeQuery(
    db,
    'fournisseurs actifs',
    `
    SELECT id, code, name, supplier_type, city, email, mobile, phone
    FROM suppliers
    WHERE store_id = $1
      AND COALESCE(status, 'active') <> 'inactive'
    ORDER BY name ASC
    LIMIT 50
    `,
    [storeId]
  ), 50);
}

async function loadStock(db, storeId) {
  const [summary, expiringLots] = await Promise.all([
    safeQuery(
      db,
      'stock disponible',
      `
      SELECT
        a.plu,
        a.designation,
        a.unit,
        ss.stock_quantity,
        ss.stock_value_ex_vat,
        ss.pma,
        ss.next_dlc
      FROM stock_summary ss
      JOIN articles a ON a.id = ss.article_id AND a.store_id = ss.store_id
      WHERE ss.store_id = $1
        AND ss.stock_quantity > 0
      ORDER BY ss.stock_quantity DESC
      LIMIT 60
      `,
      [storeId]
    ),
    safeQuery(
      db,
      'lots DLC proche',
      `
      SELECT
        l.id,
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
        AND l.dlc IS NOT NULL
        AND l.dlc <= CURRENT_DATE + INTERVAL '10 days'
      ORDER BY l.dlc ASC, a.designation ASC
      LIMIT 40
      `,
      [storeId]
    ),
  ]);

  const totals = summary.reduce(
    (acc, row) => {
      acc.quantity += asNumber(row.stock_quantity);
      acc.value_ht += asNumber(row.stock_value_ex_vat);
      return acc;
    },
    { quantity: 0, value_ht: 0 }
  );

  return {
    totals: {
      quantity: Number(totals.quantity.toFixed(3)),
      value_ht: Number(totals.value_ht.toFixed(2)),
    },
    available: limitRows(summary, 60),
    expiring_lots: limitRows(expiringLots, 40),
  };
}

async function loadSales(db, storeId) {
  const [documents, stats] = await Promise.all([
    safeQuery(
      db,
      'dernieres ventes BL factures',
      `
      SELECT
        sd.id,
        sd.document_type,
        sd.reference_number AS document_number,
        sd.document_date,
        sd.status,
        sd.total_amount_ex_vat AS total_ht,
        c.name AS client_name
      FROM sales_documents sd
      LEFT JOIN clients c ON c.id = sd.client_id AND c.store_id = sd.store_id
      WHERE sd.store_id = $1
      ORDER BY sd.document_date DESC, sd.created_at DESC
      LIMIT 25
      `,
      [storeId]
    ),
    safeQuery(
      db,
      'statistiques ventes',
      `
      SELECT
        COUNT(*) AS document_count,
        COALESCE(SUM(total_amount_ex_vat), 0) AS ca_ht
      FROM sales_documents
      WHERE store_id = $1
        AND document_date >= CURRENT_DATE - INTERVAL '30 days'
        AND COALESCE(status, '') NOT IN ('draft', 'cancelled')
      `,
      [storeId],
      []
    ),
  ]);

  return {
    last_documents: documents,
    last_30_days: stats[0] || null,
  };
}

async function loadPurchases(db, storeId) {
  const [documents, stats] = await Promise.all([
    safeQuery(
      db,
      'derniers achats receptions',
      `
      SELECT
        p.id,
        p.purchase_date,
        p.receipt_date,
        p.status,
        p.bl_number,
        p.invoice_number,
        s.name AS supplier_name
      FROM purchases p
      LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.store_id = p.store_id
      WHERE p.store_id = $1
      ORDER BY COALESCE(p.receipt_date, p.purchase_date) DESC, p.created_at DESC
      LIMIT 25
      `,
      [storeId]
    ),
    safeQuery(
      db,
      'statistiques achats',
      `
      SELECT
        COUNT(*) AS purchase_count,
        COALESCE(SUM(pl.line_amount_ex_vat), 0) AS purchases_ht
      FROM purchases p
      JOIN purchase_lines pl ON pl.purchase_id = p.id AND pl.store_id = p.store_id
      WHERE p.store_id = $1
        AND COALESCE(p.receipt_date, p.purchase_date) >= CURRENT_DATE - INTERVAL '30 days'
        AND COALESCE(p.status, '') <> 'cancelled'
      `,
      [storeId],
      []
    ),
  ]);

  return {
    last_documents: documents,
    last_30_days: stats[0] || null,
  };
}

async function buildAiContext({ db, user }) {
  const storeId = user.store_id;
  const [
    userContext,
    storeContext,
    articles,
    clients,
    suppliers,
    stock,
    sales,
    purchases,
  ] = await Promise.all([
    loadUserContext(db, user),
    loadStoreContext(db, storeId),
    loadArticles(db, storeId),
    loadClients(db, storeId),
    loadSuppliers(db, storeId),
    loadStock(db, storeId),
    loadSales(db, storeId),
    loadPurchases(db, storeId),
  ]);

  return {
    readonly: true,
    generated_at: new Date().toISOString(),
    user: userContext,
    store_id: storeId,
    company: storeContext,
    articles,
    clients,
    suppliers,
    stock,
    sales,
    purchases,
    limits: {
      articles: articles.length,
      clients: clients.length,
      suppliers: suppliers.length,
      stock_rows: stock.available.length,
      expiring_lots: stock.expiring_lots.length,
    },
  };
}

module.exports = {
  buildAiContext,
};
