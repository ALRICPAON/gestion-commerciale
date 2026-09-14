const OPTIONAL_DB_ERROR_CODES = new Set(['42P01', '42703', '42883', '42P10']);

function intValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function moneyValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
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
      console.warn(`Centre surveillance ignore ${label} :`, {
        code: error.code,
        message: error.message,
      });
      return {
        available: false,
        rows: [],
        reason: 'Données non disponibles',
      };
    }

    console.error(`Centre surveillance erreur ${label} :`, {
      code: error.code || null,
      message: error.message,
    });
    return {
      available: false,
      rows: [],
      reason: 'Analyse indisponible',
    };
  }
}

function firstCount(result) {
  return intValue(result.rows[0]?.count);
}

async function lossSales(db, storeId) {
  const result = await safeQuery(db, 'ventes a perte', `
    SELECT
      sl.id,
      sd.reference_number,
      sd.document_date,
      c.name AS client_name,
      COALESCE(a.plu, sl.article_plu) AS plu,
      COALESCE(a.designation, sl.article_label, 'Article sans nom') AS designation,
      sl.line_amount_ht,
      sl.line_margin_ex_vat
    FROM sales_lines sl
    JOIN sales_documents sd ON sd.id = sl.sales_document_id AND sd.store_id = sl.store_id
    LEFT JOIN clients c ON c.id = sd.client_id AND c.store_id = sd.store_id
    LEFT JOIN articles a ON a.id = sl.article_id AND a.store_id = sl.store_id
    WHERE sl.store_id = $1
      AND sd.document_date >= CURRENT_DATE - INTERVAL '30 days'
      AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
      AND COALESCE(sl.line_margin_ex_vat, 0) < 0
    ORDER BY sl.line_margin_ex_vat ASC, sd.document_date DESC
    LIMIT 20
  `, [storeId]);

  return {
    count: result.rows.length,
    available: result.available,
    items: result.rows.map((row) => ({
      label: row.designation,
      detail: `${row.client_name || 'Client non renseigné'} - ${moneyValue(row.line_margin_ex_vat)} EUR de marge`,
      date: row.document_date,
      reference: row.reference_number,
    })),
  };
}

async function lowMargins(db, storeId, thresholdRate) {
  const result = await safeQuery(db, 'marges faibles', `
    WITH allocation_costs AS (
      SELECT
        sales_line_id,
        SUM(quantity) AS allocated_quantity,
        SUM(quantity * unit_cost_ex_vat) / NULLIF(SUM(quantity), 0) AS purchase_unit_cost_ht
      FROM sale_line_allocations
      WHERE quantity > 0
      GROUP BY sales_line_id
    ),
    line_margins AS (
      SELECT
        sl.id,
        sd.id AS document_id,
        sd.document_type,
        sd.reference_number,
        sd.document_date,
        c.name AS client_name,
        COALESCE(a.plu, sl.article_plu) AS plu,
        COALESCE(a.designation, sl.article_label, 'Article sans nom') AS designation,
        sl.unit_sale_price_ht AS sale_unit_price_ht,
        COALESCE(ac.purchase_unit_cost_ht, selected_lot.unit_cost_ex_vat) AS purchase_unit_cost_ht,
        sl.total_weight,
        sl.sold_quantity
      FROM sales_lines sl
      JOIN sales_documents sd ON sd.id = sl.sales_document_id AND sd.store_id = sl.store_id
      LEFT JOIN allocation_costs ac ON ac.sales_line_id = sl.id
      LEFT JOIN lots selected_lot ON selected_lot.id = sl.selected_lot_id AND selected_lot.store_id = sl.store_id
      LEFT JOIN clients c ON c.id = sd.client_id AND c.store_id = sd.store_id
      LEFT JOIN articles a ON a.id = sl.article_id AND a.store_id = sl.store_id
      WHERE sl.store_id = $1
        AND sd.document_type = 'DELIVERY_NOTE'
        AND sd.document_date >= CURRENT_DATE - INTERVAL '30 days'
        AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
    )
    SELECT
      id,
      document_id,
      document_type,
      reference_number,
      document_date,
      client_name,
      plu,
      designation,
      purchase_unit_cost_ht,
      sale_unit_price_ht,
      sale_unit_price_ht - purchase_unit_cost_ht AS margin_per_kg,
      (sale_unit_price_ht - purchase_unit_cost_ht) / NULLIF(purchase_unit_cost_ht, 0) * 100 AS margin_rate,
      (sale_unit_price_ht - purchase_unit_cost_ht) * COALESCE(NULLIF(total_weight, 0), sold_quantity, 0) AS margin_total
    FROM line_margins
    WHERE purchase_unit_cost_ht > 0
      AND sale_unit_price_ht IS NOT NULL
      AND (sale_unit_price_ht - purchase_unit_cost_ht) / NULLIF(purchase_unit_cost_ht, 0) * 100 < $2
    ORDER BY margin_rate ASC, document_date DESC
    LIMIT 20
  `, [storeId, thresholdRate]);

  const items = result.rows.map((row) => ({
    label: `${row.reference_number || row.document_id} - ${row.designation}`,
    detail: `${row.client_name || 'Client non renseigné'} - Achat ${moneyValue(row.purchase_unit_cost_ht)} EUR/kg - Vente ${moneyValue(row.sale_unit_price_ht)} EUR/kg - Marge ${moneyValue(row.margin_per_kg)} EUR/kg - ${moneyValue(row.margin_rate)} %`,
    date: row.document_date,
    reference: row.reference_number,
    document_id: row.document_id,
    line_id: row.id,
    article: row.designation,
    purchase_unit_cost_ht: moneyValue(row.purchase_unit_cost_ht),
    sale_unit_price_ht: moneyValue(row.sale_unit_price_ht),
    margin_per_kg: moneyValue(row.margin_per_kg),
    margin_rate_percent: moneyValue(row.margin_rate),
    margin_total: moneyValue(row.margin_total),
    url: `./delivery-notes.html?id=${row.document_id}&line_id=${row.id}`,
  }));

  return {
    count: result.rows.length,
    available: result.available,
    view_url: items[0]?.url || './delivery-notes.html',
    items,
  };
}

async function dlcSoon(db, storeId, days) {
  const result = await safeQuery(db, 'lots DLC proches', `
    SELECT
      l.id,
      l.lot_code,
      l.supplier_lot_number,
      l.qty_remaining,
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
      AND l.dlc <= CURRENT_DATE + ($2::int || ' days')::interval
    ORDER BY l.dlc ASC, l.qty_remaining DESC
    LIMIT 20
  `, [storeId, days]);

  return {
    count: result.rows.length,
    available: result.available,
    items: result.rows.map((row) => ({
      label: row.designation,
      detail: `${row.qty_remaining} restant - DLC dans ${row.days_before_dlc} jour(s)`,
      date: row.dlc,
      reference: row.lot_code || row.supplier_lot_number,
    })),
  };
}

async function dlcExpired(db, storeId) {
  const result = await safeQuery(db, 'lots DLC depasses', `
    SELECT
      l.id,
      l.lot_code,
      l.supplier_lot_number,
      l.qty_remaining,
      l.dlc,
      (CURRENT_DATE - l.dlc::date) AS days_expired,
      a.plu,
      a.designation
    FROM lots l
    JOIN articles a ON a.id = l.article_id AND a.store_id = l.store_id
    WHERE l.store_id = $1
      AND l.qty_remaining > 0
      AND l.dlc IS NOT NULL
      AND l.dlc < CURRENT_DATE
    ORDER BY l.dlc ASC
    LIMIT 20
  `, [storeId]);

  return {
    count: result.rows.length,
    available: result.available,
    items: result.rows.map((row) => ({
      label: row.designation,
      detail: `${row.qty_remaining} restant - dépassé depuis ${row.days_expired} jour(s)`,
      date: row.dlc,
      reference: row.lot_code || row.supplier_lot_number,
    })),
  };
}

async function negativeStock(db, storeId) {
  const result = await safeQuery(db, 'stocks negatifs', `
    SELECT
      a.id,
      a.plu,
      a.designation,
      a.unit,
      ss.stock_quantity
    FROM stock_summary ss
    JOIN articles a ON a.id = ss.article_id AND a.store_id = ss.store_id
    WHERE ss.store_id = $1
      AND ss.stock_quantity < 0
    ORDER BY ss.stock_quantity ASC, a.designation ASC
    LIMIT 20
  `, [storeId]);

  return {
    count: result.rows.length,
    available: result.available,
    items: result.rows.map((row) => ({
      label: row.designation,
      detail: `${row.stock_quantity} ${row.unit || ''}`,
      reference: row.plu,
    })),
  };
}

async function articlesWithoutStock(db, storeId) {
  const result = await safeQuery(db, 'articles sans stock', `
    SELECT
      a.id,
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
    LIMIT 20
  `, [storeId]);

  return {
    count: result.rows.length,
    available: result.available,
    items: result.rows.map((row) => ({
      label: row.designation,
      detail: row.family_name || 'Famille non renseignée',
      reference: row.plu,
    })),
  };
}

async function clientsToFollowUp(db, storeId, inactiveDays) {
  const result = await safeQuery(db, 'clients a relancer', `
    WITH last_sales AS (
      SELECT client_id, MAX(document_date) AS last_sale_date, COUNT(*) AS document_count
      FROM sales_documents
      WHERE store_id = $1
        AND COALESCE(status, '') NOT IN ('draft', 'cancelled')
      GROUP BY client_id
    )
    SELECT
      c.id,
      c.code,
      c.name,
      c.email,
      c.mobile,
      ls.last_sale_date,
      CASE WHEN ls.last_sale_date IS NULL THEN 9999 ELSE CURRENT_DATE - ls.last_sale_date::date END AS inactive_days
    FROM clients c
    LEFT JOIN last_sales ls ON ls.client_id = c.id
    WHERE c.store_id = $1
      AND COALESCE(c.status, 'active') <> 'inactive'
      AND (ls.last_sale_date IS NULL OR ls.last_sale_date <= CURRENT_DATE - ($2::int || ' days')::interval)
    ORDER BY inactive_days DESC, c.name ASC
    LIMIT 20
  `, [storeId, inactiveDays]);

  return {
    count: result.rows.length,
    available: result.available,
    items: result.rows.map((row) => ({
      label: row.name,
      detail: row.last_sale_date ? `Dernière vente il y a ${row.inactive_days} jour(s)` : 'Aucune vente connue',
      date: row.last_sale_date,
      reference: row.code,
    })),
  };
}

async function unmatchedSupplierInvoices(db, storeId) {
  const result = await safeQuery(db, 'factures fournisseurs non rapprochees', `
    SELECT
      si.id,
      si.invoice_number,
      si.invoice_date,
      si.status,
      si.total_ex_vat,
      s.name AS supplier_name,
      COUNT(sim.id) AS match_count
    FROM supplier_invoices si
    JOIN suppliers s ON s.id = si.supplier_id
    LEFT JOIN supplier_invoice_matches sim ON sim.supplier_invoice_id = si.id
    WHERE si.store_id = $1
      AND COALESCE(si.status, '') NOT IN ('cancelled', 'matched', 'paid')
    GROUP BY si.id, s.name
    HAVING COUNT(sim.id) = 0
    ORDER BY si.invoice_date DESC NULLS LAST, si.created_at DESC
    LIMIT 20
  `, [storeId]);

  return {
    count: result.rows.length,
    available: result.available,
    items: result.rows.map((row) => ({
      label: row.supplier_name,
      detail: `${row.invoice_number || 'Sans numéro'} - ${moneyValue(row.total_ex_vat)} EUR HT`,
      date: row.invoice_date,
      reference: row.invoice_number,
    })),
  };
}

async function unpaidCustomerInvoices(db, storeId) {
  const result = await safeQuery(db, 'factures clients impayees', `
    SELECT
      sd.id,
      sd.reference_number,
      sd.document_date,
      sd.status,
      sd.total_ht,
      c.name AS client_name
    FROM sales_documents sd
    LEFT JOIN clients c ON c.id = sd.client_id AND c.store_id = sd.store_id
    WHERE sd.store_id = $1
      AND sd.document_type = 'INVOICE'
      AND COALESCE(sd.status, '') NOT IN ('paid', 'cancelled', 'draft')
    ORDER BY sd.document_date ASC, sd.created_at ASC
    LIMIT 20
  `, [storeId]);

  return {
    count: result.rows.length,
    available: result.available,
    items: result.rows.map((row) => ({
      label: row.client_name || 'Client non renseigné',
      detail: `${row.reference_number || 'Sans référence'} - ${moneyValue(row.total_ht)} EUR HT`,
      date: row.document_date,
      reference: row.reference_number,
    })),
  };
}

async function receptionsPendingInvoice(db, storeId) {
  const result = await safeQuery(db, 'receptions en attente facture', `
    SELECT
      p.id,
      p.bl_number,
      p.receipt_date,
      p.status,
      p.total_amount_ex_vat,
      s.name AS supplier_name
    FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.store_id = p.store_id
    WHERE p.store_id = $1
      AND COALESCE(p.status, '') IN ('received', 'received_pending_invoice', 'invoice_difference')
      AND NOT EXISTS (
        SELECT 1
        FROM supplier_invoice_matches sim
        WHERE sim.purchase_id = p.id
      )
    ORDER BY p.receipt_date DESC NULLS LAST, p.created_at DESC
    LIMIT 20
  `, [storeId]);

  return {
    count: result.rows.length,
    available: result.available,
    items: result.rows.map((row) => ({
      label: row.supplier_name || 'Fournisseur non renseigné',
      detail: `${row.bl_number || 'BL sans numéro'} - ${moneyValue(row.total_amount_ex_vat)} EUR HT`,
      date: row.receipt_date,
      reference: row.bl_number,
    })),
  };
}

module.exports = {
  firstCount,
  lossSales,
  lowMargins,
  dlcSoon,
  dlcExpired,
  negativeStock,
  articlesWithoutStock,
  clientsToFollowUp,
  unmatchedSupplierInvoices,
  unpaidCustomerInvoices,
  receptionsPendingInvoice,
};
