const base = require('./agentToolsService');
const { recomputeArticleStock } = require('./stockService');

const MAX_LIMIT = 100;
const ORDER_ACTION_TYPES = new Set(['customer_order_draft', 'create_customer_order', 'create_customer_order_draft']);
const DELIVERY_NOTE_ACTION_TYPES = new Set(['validate_order_to_delivery_note', 'create_delivery_note_from_order', 'order_to_delivery_note']);
const SOURCE = 'chatgpt_business';
const ACCENT_SOURCE = 'ÀÂÄàâäÉÈÊËéèêëÎÏîïÔÖôöÙÛÜùûüÇç';
const ACCENT_TARGET = 'AAAaaaEEEEeeeeIIiiOOooUUUuuuCc';

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function limit(value, fallback = 50, max = MAX_LIMIT) {
  const parsed = Number(value);
  return Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : fallback, max);
}

function num(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pos(value, fallback = 0) {
  return Math.max(num(value, fallback), 0);
}

function normalized(field) {
  return `LOWER(translate(COALESCE(${field}::text, ''), '${ACCENT_SOURCE}', '${ACCENT_TARGET}'))`;
}

function searchWhere(fields, query, params) {
  const normalizedQuery = String(query || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalizedQuery) return null;

  const variants = new Set([normalizedQuery]);
  if (normalizedQuery.endsWith('s') && normalizedQuery.length > 3) variants.add(normalizedQuery.slice(0, -1));

  return [...variants].map((variant) => {
    params.push(`%${variant}%`);
    const idx = params.length;
    return `(${fields.map((field) => `${normalized(field)} LIKE $${idx}`).join(' OR ')})`;
  }).join(' OR ');
}

function stockSelect() {
  return `
    SELECT
      a.id AS article_id,
      a.plu,
      a.designation,
      a.unit,
      a.stock_unit,
      a.sale_unit,
      a.family_name,
      COALESCE(ss.stock_quantity, 0) AS stock_quantity,
      COALESCE(ss.stock_value_ex_vat, 0) AS stock_value_ex_vat,
      COALESCE(ss.pma, 0) AS pma,
      ss.next_dlc,
      lot.lot_code AS next_lot_code,
      lot.supplier_lot_number AS next_supplier_lot_number,
      lot.dlc AS next_lot_dlc
    FROM articles a
    LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
    LEFT JOIN LATERAL (
      SELECT l.lot_code, l.supplier_lot_number, l.dlc
      FROM lots l
      WHERE l.store_id = a.store_id
        AND l.article_id = a.id
        AND l.qty_remaining > 0
      ORDER BY COALESCE(l.dlc, DATE '9999-12-31'), l.created_at, l.id
      LIMIT 1
    ) lot ON true
  `;
}

async function getStockOverview(dbPool, storeId, input = {}) {
  const availableOnly = input.available_only === false || input.available_only === 'false' ? false : true;
  const availableSql = availableOnly ? 'AND COALESCE(ss.stock_quantity, 0) > 0' : '';
  const [summary, rows] = await Promise.all([
    dbPool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE COALESCE(ss.stock_quantity, 0) > 0)::int AS articles_in_stock,
        COUNT(*) FILTER (WHERE COALESCE(ss.stock_quantity, 0) = 0)::int AS articles_without_stock,
        COUNT(*) FILTER (WHERE COALESCE(ss.stock_quantity, 0) < 0)::int AS articles_negative_stock,
        COALESCE(SUM(COALESCE(ss.stock_quantity, 0)) FILTER (WHERE COALESCE(ss.stock_quantity, 0) > 0), 0) AS total_stock_quantity,
        COALESCE(SUM(COALESCE(ss.stock_value_ex_vat, 0)), 0) AS total_stock_value_ex_vat,
        MIN(ss.next_dlc) FILTER (WHERE COALESCE(ss.stock_quantity, 0) > 0 AND ss.next_dlc IS NOT NULL) AS earliest_dlc
      FROM articles a
      LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
      WHERE a.store_id = $1
      `,
      [storeId]
    ),
    dbPool.query(
      `
      ${stockSelect()}
      WHERE a.store_id = $1
        ${availableSql}
      ORDER BY COALESCE(ss.stock_quantity, 0) DESC, a.designation ASC
      LIMIT $2
      `,
      [storeId, limit(input.limit)]
    ),
  ]);
  return { summary: summary.rows[0] || {}, results: rows.rows };
}

async function searchStock(dbPool, storeId, input = {}) {
  const query = clean(input.query);
  if (!query) return getStockOverview(dbPool, storeId, input);

  const params = [storeId];
  const where = searchWhere(
    ['a.plu', 'a.designation', 'a.ean', 'a.family_name', 'a.latin_name', 'l.lot_code', 'l.supplier_lot_number'],
    query,
    params
  );
  params.push(limit(input.limit, 25, 50));

  const result = await dbPool.query(
    `
    SELECT DISTINCT ON (a.id)
      a.id AS article_id,
      a.plu,
      a.designation,
      a.unit,
      a.stock_unit,
      a.sale_unit,
      a.family_name,
      COALESCE(ss.stock_quantity, 0) AS stock_quantity,
      COALESCE(ss.stock_value_ex_vat, 0) AS stock_value_ex_vat,
      COALESCE(ss.pma, 0) AS pma,
      ss.next_dlc,
      next_lot.lot_code AS next_lot_code,
      next_lot.supplier_lot_number AS next_supplier_lot_number,
      next_lot.dlc AS next_lot_dlc
    FROM articles a
    LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
    LEFT JOIN lots l ON l.article_id = a.id AND l.store_id = a.store_id
    LEFT JOIN LATERAL (
      SELECT lot.lot_code, lot.supplier_lot_number, lot.dlc
      FROM lots lot
      WHERE lot.store_id = a.store_id
        AND lot.article_id = a.id
        AND lot.qty_remaining > 0
      ORDER BY COALESCE(lot.dlc, DATE '9999-12-31'), lot.created_at, lot.id
      LIMIT 1
    ) next_lot ON true
    WHERE a.store_id = $1
      AND (${where})
    ORDER BY a.id, COALESCE(ss.stock_quantity, 0) DESC, a.designation ASC
    LIMIT $${params.length}
    `,
    params
  );
  return { results: result.rows };
}

async function getClientsOverview(dbPool, storeId, input = {}) {
  const [summary, rows] = await Promise.all([
    dbPool.query(
      `
      SELECT
        COUNT(*)::int AS total_clients,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active_clients,
        COUNT(DISTINCT client_type)::int AS client_type_count
      FROM clients
      WHERE store_id = $1
      `,
      [storeId]
    ),
    dbPool.query(
      `
      SELECT id, code, name, legal_name, client_type, status, tariff_level, contact_name, phone, mobile, email, city
      FROM clients
      WHERE store_id = $1
      ORDER BY status ASC, name ASC
      LIMIT $2
      `,
      [storeId, limit(input.limit)]
    ),
  ]);
  return { summary: summary.rows[0] || {}, results: rows.rows };
}

async function getArticlesOverview(dbPool, storeId, input = {}) {
  const [summary, rows] = await Promise.all([
    dbPool.query(
      `
      SELECT
        COUNT(*)::int AS total_articles,
        COUNT(*) FILTER (WHERE is_active = true)::int AS active_articles,
        COUNT(DISTINCT family_code)::int AS family_count
      FROM articles
      WHERE store_id = $1
      `,
      [storeId]
    ),
    dbPool.query(
      `
      SELECT a.id, a.plu, a.designation, a.unit, a.stock_unit, a.sale_unit, a.family_code, a.family_name,
             a.is_active, a.sale_price_level_1_ht, a.sale_price_level_2_ht, a.sale_price_level_3_ht,
             COALESCE(ss.stock_quantity, 0) AS stock_quantity
      FROM articles a
      LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
      WHERE a.store_id = $1
      ORDER BY a.is_active DESC, a.designation ASC
      LIMIT $2
      `,
      [storeId, limit(input.limit)]
    ),
  ]);
  return { summary: summary.rows[0] || {}, results: rows.rows };
}

async function getSuppliersOverview(dbPool, storeId, input = {}) {
  const [summary, rows] = await Promise.all([
    dbPool.query(
      `
      SELECT
        COUNT(*)::int AS total_suppliers,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active_suppliers,
        COUNT(DISTINCT supplier_type)::int AS supplier_type_count
      FROM suppliers
      WHERE store_id = $1
      `,
      [storeId]
    ),
    dbPool.query(
      `
      SELECT id, code, name, legal_name, supplier_type, status, contact_name, phone, mobile, email, city
      FROM suppliers
      WHERE store_id = $1
      ORDER BY status ASC, name ASC
      LIMIT $2
      `,
      [storeId, limit(input.limit)]
    ),
  ]);
  return { summary: summary.rows[0] || {}, results: rows.rows };
}

async function getExpiringLots(dbPool, storeId, input = {}) {
  const days = Math.max(1, Math.min(num(input.days, 5), 60));
  const params = [storeId, days, limit(input.limit)];
  let extra = '';
  if (clean(input.query)) {
    extra = `AND (${searchWhere(['a.plu', 'a.designation', 'l.lot_code', 'l.supplier_lot_number'], input.query, params)})`;
  }
  const result = await dbPool.query(
    `
    SELECT l.id AS lot_id, l.article_id, a.plu, a.designation, l.lot_code, l.supplier_lot_number,
           l.qty_remaining, l.unit_cost_ex_vat, l.dlc, s.code AS supplier_code, s.name AS supplier_name
    FROM lots l
    JOIN articles a ON a.id = l.article_id AND a.store_id = l.store_id
    LEFT JOIN suppliers s ON s.id = l.supplier_id
    WHERE l.store_id = $1
      AND l.qty_remaining > 0
      AND l.dlc IS NOT NULL
      AND l.dlc <= CURRENT_DATE + ($2::int * INTERVAL '1 day')
      ${extra}
    ORDER BY l.dlc ASC, a.designation ASC
    LIMIT $3
    `,
    params
  );
  return { days, results: result.rows };
}

async function getNegativeStock(dbPool, storeId, input = {}) {
  const result = await dbPool.query(
    `
    ${stockSelect()}
    WHERE a.store_id = $1
      AND COALESCE(ss.stock_quantity, 0) < 0
    ORDER BY COALESCE(ss.stock_quantity, 0) ASC, a.designation ASC
    LIMIT $2
    `,
    [storeId, limit(input.limit)]
  );
  return { results: result.rows };
}

async function getSalesOverview(dbPool, storeId, input = {}) {
  const params = [storeId];
  let where = 'WHERE sd.store_id = $1';
  if (clean(input.date_from)) {
    params.push(clean(input.date_from));
    where += ` AND sd.document_date >= $${params.length}::date`;
  }
  if (clean(input.date_to)) {
    params.push(clean(input.date_to));
    where += ` AND sd.document_date <= $${params.length}::date`;
  }
  if (clean(input.status)) {
    params.push(clean(input.status));
    where += ` AND sd.status = $${params.length}`;
  }
  if (clean(input.document_type)) {
    params.push(clean(input.document_type));
    where += ` AND sd.document_type = $${params.length}`;
  }
  const rowParams = [...params, limit(input.limit)];
  const [summary, rows] = await Promise.all([
    dbPool.query(
      `
      SELECT COUNT(*)::int AS document_count,
             COALESCE(SUM(total_amount_ex_vat), 0) AS total_amount_ex_vat,
             COALESCE(SUM(total_amount_inc_vat), 0) AS total_amount_inc_vat,
             COUNT(*) FILTER (WHERE status = 'draft')::int AS draft_count,
             COUNT(*) FILTER (WHERE status = 'validated')::int AS validated_count
      FROM sales_documents sd
      ${where}
      `,
      params
    ),
    dbPool.query(
      `
      SELECT sd.id, sd.document_date, sd.status, sd.document_type, sd.reference_number,
             sd.total_amount_ex_vat, sd.total_amount_inc_vat,
             c.id AS client_id, c.code AS client_code, c.name AS client_name,
             COUNT(sl.id)::int AS line_count
      FROM sales_documents sd
      LEFT JOIN clients c ON c.id = sd.client_id AND c.store_id = sd.store_id
      LEFT JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
      ${where}
      GROUP BY sd.id, c.id, c.code, c.name
      ORDER BY sd.document_date DESC NULLS LAST, sd.created_at DESC
      LIMIT $${rowParams.length}
      `,
      rowParams
    ),
  ]);
  return { summary: summary.rows[0] || {}, results: rows.rows };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function getSalesToday(dbPool, storeId, input = {}) {
  return getSalesOverview(dbPool, storeId, { ...input, date_from: today(), date_to: today() });
}

async function getTopClients(dbPool, storeId, input = {}) {
  const days = Math.max(1, Math.min(num(input.days, 90), 3650));
  const result = await dbPool.query(
    `
    SELECT c.id AS client_id, c.code AS client_code, c.name AS client_name, c.client_type,
           COUNT(sd.id)::int AS document_count,
           COALESCE(SUM(sd.total_amount_ex_vat), 0) AS total_amount_ex_vat,
           COALESCE(SUM(sd.total_amount_inc_vat), 0) AS total_amount_inc_vat,
           MAX(sd.document_date) AS last_sale_date
    FROM sales_documents sd
    JOIN clients c ON c.id = sd.client_id AND c.store_id = sd.store_id
    WHERE sd.store_id = $1
      AND sd.document_date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
    GROUP BY c.id, c.code, c.name, c.client_type
    ORDER BY COALESCE(SUM(sd.total_amount_ex_vat), 0) DESC, c.name ASC
    LIMIT $3
    `,
    [storeId, days, limit(input.limit, 10, 50)]
  );
  return { days, results: result.rows };
}

async function prepareOrderPayload(dbPool, storeId, payload) {
  const clientId = clean(payload.client_id);
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (!clientId) {
    const error = new Error('payload.client_id obligatoire pour une commande client');
    error.status = 400;
    throw error;
  }
  if (!lines.length) {
    const error = new Error('payload.lines obligatoire pour une commande client');
    error.status = 400;
    throw error;
  }

  const clientResult = await dbPool.query(
    `SELECT id, code, name, tariff_level, vat_rate, is_vat_exempt FROM clients WHERE id=$1 AND store_id=$2 AND status<>'inactive' LIMIT 1`,
    [clientId, storeId]
  );
  if (!clientResult.rows.length) {
    const error = new Error('Client introuvable pour ce magasin');
    error.status = 400;
    throw error;
  }

  const preparedLines = [];
  for (const [index, raw] of lines.entries()) {
    const articleId = clean(raw.article_id);
    const articlePlu = clean(raw.article_plu);
    if (!articleId && !articlePlu) {
      const error = new Error(`Ligne ${index + 1}: article_id ou article_plu obligatoire`);
      error.status = 400;
      throw error;
    }
    const params = [storeId];
    let where = 'a.store_id=$1 AND a.is_active=true';
    if (articleId) {
      params.push(articleId);
      where += ` AND a.id=$${params.length}`;
    } else {
      params.push(articlePlu);
      where += ` AND a.plu=$${params.length}`;
    }
    const articleResult = await dbPool.query(
      `
      SELECT a.id, a.plu, a.designation, a.sale_unit, a.stock_unit, a.unit, a.vat_rate,
             COALESCE(ss.stock_quantity, 0) AS stock_quantity, COALESCE(ss.pma, 0) AS pma,
             lot.id AS suggested_lot_id, lot.lot_code AS suggested_lot_code, lot.supplier_lot_number, lot.dlc
      FROM articles a
      LEFT JOIN stock_summary ss ON ss.article_id=a.id AND ss.store_id=a.store_id
      LEFT JOIN LATERAL (
        SELECT id, lot_code, supplier_lot_number, dlc
        FROM lots
        WHERE store_id=a.store_id AND article_id=a.id AND qty_remaining > 0
        ORDER BY COALESCE(dlc, DATE '9999-12-31'), created_at, id
        LIMIT 1
      ) lot ON true
      WHERE ${where}
      LIMIT 1
      `,
      params
    );
    if (!articleResult.rows.length) {
      const error = new Error(`Ligne ${index + 1}: article introuvable ou inactif`);
      error.status = 400;
      throw error;
    }
    const article = articleResult.rows[0];
    const packageCount = pos(raw.package_count || raw.colis_count);
    const weightPerPackage = pos(raw.weight_per_package || raw.poids_par_colis);
    const quantity = raw.total_weight !== undefined
      ? pos(raw.total_weight)
      : pos(raw.sold_quantity || raw.quantity, Number((packageCount * weightPerPackage).toFixed(3)));
    const unitPrice = pos(raw.unit_sale_price_ht || raw.prix_vente_ht);
    if (quantity <= 0 || unitPrice <= 0) {
      const error = new Error(`Ligne ${index + 1}: quantité et prix HT obligatoires`);
      error.status = 400;
      throw error;
    }
    const stockQuantity = num(article.stock_quantity);
    preparedLines.push({
      ...raw,
      article_id: article.id,
      article_plu: article.plu,
      article_label: clean(raw.article_label) || article.designation,
      package_count: packageCount,
      weight_per_package: weightPerPackage,
      total_weight: quantity,
      sold_quantity: quantity,
      sale_unit: clean(raw.sale_unit) || article.sale_unit || article.stock_unit || article.unit || 'kg',
      unit_sale_price_ht: unitPrice,
      unit_cost_ex_vat: pos(raw.unit_cost_ex_vat, num(article.pma)),
      vat_rate: raw.vat_rate !== undefined ? pos(raw.vat_rate) : article.vat_rate,
      suggested_lot_id: clean(raw.suggested_lot_id) || article.suggested_lot_id || null,
      stock_quantity: stockQuantity,
      stock_status: stockQuantity >= quantity ? 'available' : 'insufficient_or_absent',
      force_stock_exit: Boolean(raw.force_stock_exit || stockQuantity < quantity),
      missing_quantity: Math.max(Number((quantity - stockQuantity).toFixed(3)), 0),
    });
  }
  return { ...payload, document_type: 'ORDER', status: 'draft', client: clientResult.rows[0], lines: preparedLines, stock_warning: preparedLines.some((line) => line.stock_status !== 'available') };
}

async function createPendingAction(dbPool, storeId, input = {}) {
  if (!ORDER_ACTION_TYPES.has(clean(input.action_type))) {
    return base.createPendingAction(dbPool, storeId, input);
  }
  return base.createPendingAction(dbPool, storeId, {
    ...input,
    payload: await prepareOrderPayload(dbPool, storeId, input.payload || {}),
  });
}

async function getPendingActionType(dbPool, storeId, id) {
  const result = await dbPool.query(
    `
    SELECT action_type
    FROM agent_pending_actions
    WHERE id = $1
      AND store_id = $2
      AND status = 'pending'
    LIMIT 1
    `,
    [id, storeId]
  );

  return clean(result.rows[0]?.action_type);
}

async function salesAuditColumnsRequireUser(db) {
  const result = await db.query(
    `
    SELECT COUNT(*)::int AS required_count
    FROM information_schema.columns
    WHERE table_schema = CURRENT_SCHEMA()
      AND table_name IN ('sales_documents', 'sales_lines')
      AND column_name IN ('created_by', 'updated_by')
      AND is_nullable = 'NO'
    `
  );

  return num(result.rows[0]?.required_count) > 0;
}

async function resolveSalesAuditUserId(db, storeId) {
  const requiresUser = await salesAuditColumnsRequireUser(db);
  const result = await db.query(
    `
    SELECT id
    FROM users
    WHERE store_id = $1
      AND COALESCE(is_active, true) = true
    ORDER BY
      CASE role
        WHEN 'admin' THEN 1
        WHEN 'manager' THEN 2
        ELSE 3
      END,
      id ASC
    LIMIT 1
    `,
    [storeId]
  );

  const userId = result.rows[0]?.id || null;
  if (requiresUser && !userId) {
    const error = new Error('Aucun utilisateur technique disponible pour créer la commande');
    error.status = 503;
    throw error;
  }

  return userId;
}

async function insertCustomerOrderDraft(db, storeId, payload, notesFallback = null) {
  const actorId = await resolveSalesAuditUserId(db, storeId);
  const client = payload.client;
  const sale = await db.query(
    `
    INSERT INTO sales_documents(id,store_id,client_key,client_id,document_date,status,document_type,origin,reference_number,notes,tariff_level_snapshot,vat_rate_snapshot,is_vat_exempt_snapshot,created_by,updated_by)
    VALUES(gen_random_uuid(),$1,NULL,$2,COALESCE($3::date,CURRENT_DATE),'draft','ORDER','chatgpt_mcp',$4,$5,$6,$7,$8,$9,$9)
    RETURNING *
    `,
    [storeId, client.id, clean(payload.document_date), clean(payload.reference_number), clean(payload.notes) || notesFallback, num(client.tariff_level, 1), num(client.vat_rate, 5.5), Boolean(client.is_vat_exempt), actorId]
  );
  const saleId = sale.rows[0].id;
  const createdLines = [];
  let lineNumber = 1;
  for (const line of payload.lines) {
    const quantity = pos(line.sold_quantity || line.total_weight);
    const unitHt = pos(line.unit_sale_price_ht);
    const vatRate = client.is_vat_exempt ? 0 : pos(line.vat_rate, num(client.vat_rate, 5.5));
    const ht = Number((quantity * unitHt).toFixed(2));
    const vat = Number((ht * vatRate / 100).toFixed(2));
    const ttc = Number((ht + vat).toFixed(2));
    const unitTtc = quantity > 0 ? Number((ttc / quantity).toFixed(4)) : unitHt;
    const cost = pos(line.unit_cost_ex_vat);
    const inserted = await db.query(
      `
      INSERT INTO sales_lines(id,store_id,client_key,sales_document_id,line_number,article_id,article_plu,article_label,package_count,weight_per_package,total_weight,sold_quantity,sale_unit,line_status,unit_sale_price_ht,unit_sale_price_ttc,vat_rate,line_amount_ht,line_vat_amount,line_amount_ttc,unit_cost_ex_vat,line_margin_ex_vat,suggested_lot_id,traceability_snapshot,created_by,updated_by)
      VALUES(gen_random_uuid(),$1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,$22)
      RETURNING id, article_id, article_plu, article_label, sold_quantity, sale_unit, unit_sale_price_ht, line_amount_ht, line_amount_ttc
      `,
      [storeId, saleId, lineNumber, line.article_id, line.article_plu, line.article_label, pos(line.package_count), pos(line.weight_per_package), quantity, quantity, clean(line.sale_unit) || 'kg', unitHt, unitTtc, vatRate, ht, vat, ttc, cost, Number((ht - quantity * cost).toFixed(2)), clean(line.suggested_lot_id), JSON.stringify({ stock_status: line.stock_status, stock_quantity: line.stock_quantity, missing_quantity: line.missing_quantity, force_stock_exit: line.force_stock_exit, prepared_by: SOURCE }), actorId]
    );
    createdLines.push(inserted.rows[0]);
    lineNumber += 1;
  }

  const totals = await db.query(
    `
    UPDATE sales_documents sd
    SET total_amount_ex_vat=x.ht,total_vat_amount=x.vat,total_amount_inc_vat=x.ttc,updated_at=NOW()
    FROM (
      SELECT COALESCE(SUM(line_amount_ht),0) ht,
             COALESCE(SUM(line_vat_amount),0) vat,
             COALESCE(SUM(line_amount_ttc),0) ttc
      FROM sales_lines
      WHERE sales_document_id=$1
    ) x
    WHERE sd.id=$1
    RETURNING sd.reference_number, sd.total_amount_ex_vat, sd.total_vat_amount, sd.total_amount_inc_vat
    `,
    [saleId]
  );
  const totalRow = totals.rows[0] || {};
  return {
    sale_id: saleId,
    reference_number: totalRow.reference_number || sale.rows[0].reference_number || null,
    document_type: 'ORDER',
    status: 'draft',
    client: { id: client.id, code: client.code, name: client.name },
    line_count: createdLines.length,
    total_amount_ex_vat: totalRow.total_amount_ex_vat,
    total_vat_amount: totalRow.total_vat_amount,
    total_amount_inc_vat: totalRow.total_amount_inc_vat,
    stock_warning: payload.stock_warning,
    stock_message: payload.stock_warning
      ? 'Commande brouillon créée avec stock insuffisant ou absent sur au moins une ligne.'
      : 'Commande brouillon créée avec stock disponible pour les lignes demandées.',
    created_lines: createdLines,
  };
}

async function createCustomerOrderConfirmed(dbPool, storeId, input = {}) {
  const db = await dbPool.connect();
  try {
    await db.query('BEGIN');
    const payload = await prepareOrderPayload(db, storeId, input);
    const result = await insertCustomerOrderDraft(db, storeId, payload, input.notes);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

async function allocateSalesDocumentStock(db, storeId, salesDocumentId, actorId, movementLabel) {
  const lines = await db.query(
    'SELECT * FROM sales_lines WHERE sales_document_id=$1 AND store_id=$2 ORDER BY line_number FOR UPDATE',
    [salesDocumentId, storeId]
  );
  let allocated = 0;
  const articles = new Set();

  for (const line of lines.rows) {
    let remaining = pos(line.sold_quantity || line.total_weight, 0);
    if (!line.article_id || remaining <= 0) continue;

    const lots = line.selected_lot_id
      ? await db.query(
        'SELECT * FROM lots WHERE store_id=$1 AND article_id=$2 AND id=$3 AND qty_remaining>0 FOR UPDATE',
        [storeId, line.article_id, line.selected_lot_id]
      )
      : await db.query(
        `SELECT * FROM lots
         WHERE store_id=$1 AND article_id=$2 AND qty_remaining>0
         ORDER BY COALESCE(dlc,DATE '9999-12-31'),created_at,id
         FOR UPDATE`,
        [storeId, line.article_id]
      );

    for (const lot of lots.rows) {
      if (remaining <= 0) break;
      const quantity = Math.min(remaining, num(lot.qty_remaining));
      if (quantity <= 0) continue;

      await db.query(
        'UPDATE lots SET qty_remaining=qty_remaining-$1,updated_at=NOW() WHERE id=$2',
        [quantity, lot.id]
      );
      await db.query(
        'INSERT INTO sale_line_allocations(id,sales_line_id,lot_id,quantity,unit_cost_ex_vat) VALUES(gen_random_uuid(),$1,$2,$3,$4)',
        [line.id, lot.id, quantity, num(lot.unit_cost_ex_vat)]
      );
      await db.query(
        `INSERT INTO stock_movements(id,store_id,client_key,article_id,lot_id,movement_type,quantity,unit_cost_ex_vat,source_table,source_id,notes,created_by)
         VALUES(gen_random_uuid(),$1,NULL,$2,$3,'sale_out',$4,$5,'sales_lines',$6,$7,$8)`,
        [storeId, line.article_id, lot.id, -quantity, num(lot.unit_cost_ex_vat), line.id, movementLabel, actorId]
      );

      remaining = Number((remaining - quantity).toFixed(3));
      allocated += 1;
    }

    if (remaining > 0) {
      const error = new Error(`Stock insuffisant ligne ${line.line_number}`);
      error.status = 400;
      throw error;
    }

    await db.query(
      "UPDATE sales_lines SET line_status='validated',updated_by=$1,updated_at=NOW() WHERE id=$2",
      [actorId, line.id]
    );
    articles.add(line.article_id);
  }

  for (const articleId of articles) {
    await recomputeArticleStock(db, articleId, storeId);
  }

  return { allocated, line_count: lines.rows.length, article_count: articles.size };
}

async function findCustomerOrderForDeliveryNote(db, storeId, payload = {}) {
  const saleId = clean(payload.sale_id || payload.order_id || payload.id);
  const referenceNumber = clean(payload.reference_number || payload.order_reference || payload.order_reference_number);
  if (!saleId && !referenceNumber) {
    const error = new Error('payload.sale_id ou payload.reference_number obligatoire pour valider une commande en BL');
    error.status = 400;
    throw error;
  }

  const params = [storeId];
  let where = 'sd.store_id=$1';
  if (saleId) {
    params.push(saleId);
    where += ` AND sd.id=$${params.length}`;
  } else {
    params.push(referenceNumber);
    where += ` AND sd.reference_number=$${params.length}`;
  }

  const result = await db.query(
    `SELECT sd.*, c.code AS client_code, c.name AS client_name
     FROM sales_documents sd
     LEFT JOIN clients c ON c.id=sd.client_id AND c.store_id=sd.store_id
     WHERE ${where}
     FOR UPDATE OF sd`,
    params
  );

  if (!result.rows.length) {
    const error = new Error('Commande introuvable pour ce magasin');
    error.status = 404;
    throw error;
  }

  const order = result.rows[0];
  if (order.document_type !== 'ORDER') {
    const error = new Error('Le document trouvé n’est pas une commande client');
    error.status = 400;
    throw error;
  }
  if (['invoiced', 'factured', 'facturee'].includes(clean(order.status))) {
    const error = new Error('Commande déjà facturée');
    error.status = 400;
    throw error;
  }

  const existingDeliveryNote = await db.query(
    `SELECT id, reference_number
     FROM sales_documents
     WHERE store_id=$1
       AND document_type='DELIVERY_NOTE'
       AND notes LIKE $2
     LIMIT 1`,
    [storeId, `%source_order_id:${order.id}%`]
  );
  if (existingDeliveryNote.rows.length) {
    const error = new Error(`Commande déjà convertie en BL ${existingDeliveryNote.rows[0].reference_number || existingDeliveryNote.rows[0].id}`);
    error.status = 400;
    throw error;
  }

  return order;
}

async function createDeliveryNoteFromOrder(db, storeId, payload = {}, summary = null) {
  const actorId = await resolveSalesAuditUserId(db, storeId);
  const order = await findCustomerOrderForDeliveryNote(db, storeId, payload);
  const orderLines = await db.query(
    'SELECT * FROM sales_lines WHERE sales_document_id=$1 AND store_id=$2 ORDER BY line_number',
    [order.id, storeId]
  );
  if (!orderLines.rows.length) {
    const error = new Error('Commande sans ligne, impossible de créer un BL');
    error.status = 400;
    throw error;
  }

  const notes = [
    clean(payload.notes) || summary || `BL créé depuis la commande ${order.reference_number || order.id}`,
    `source_order_id:${order.id}`,
    order.reference_number ? `source_order_reference:${order.reference_number}` : null,
  ].filter(Boolean).join('\n');

  const delivery = await db.query(
    `INSERT INTO sales_documents(id,store_id,client_key,client_id,document_date,status,document_type,origin,reference_number,notes,tariff_level_snapshot,vat_rate_snapshot,is_vat_exempt_snapshot,created_by,updated_by)
     VALUES(gen_random_uuid(),$1,NULL,$2,COALESCE($3::date,CURRENT_DATE),'draft','DELIVERY_NOTE','chatgpt_mcp',NULL,$4,$5,$6,$7,$8,$8)
     RETURNING *`,
    [
      storeId,
      order.client_id,
      clean(payload.document_date),
      notes,
      num(order.tariff_level_snapshot, 1),
      num(order.vat_rate_snapshot, 5.5),
      Boolean(order.is_vat_exempt_snapshot),
      actorId,
    ]
  );
  const deliveryId = delivery.rows[0].id;

  for (const line of orderLines.rows) {
    await db.query(
      `INSERT INTO sales_lines(id,store_id,client_key,sales_document_id,line_number,article_id,article_plu,article_label,package_count,weight_per_package,total_weight,sold_quantity,sale_unit,line_status,unit_sale_price_ht,unit_sale_price_ttc,vat_rate,line_amount_ht,line_vat_amount,line_amount_ttc,unit_cost_ex_vat,line_margin_ex_vat,selected_lot_id,suggested_lot_id,traceability_snapshot,created_by,updated_by)
       VALUES(gen_random_uuid(),$1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23,$23)`,
      [
        storeId,
        deliveryId,
        line.line_number,
        line.article_id,
        line.article_plu,
        line.article_label,
        pos(line.package_count),
        pos(line.weight_per_package),
        pos(line.total_weight),
        pos(line.sold_quantity || line.total_weight),
        clean(line.sale_unit) || 'kg',
        pos(line.unit_sale_price_ht),
        pos(line.unit_sale_price_ttc),
        pos(line.vat_rate),
        pos(line.line_amount_ht),
        pos(line.line_vat_amount),
        pos(line.line_amount_ttc),
        pos(line.unit_cost_ex_vat),
        num(line.line_margin_ex_vat),
        clean(line.selected_lot_id),
        clean(line.suggested_lot_id),
        JSON.stringify({ ...(line.traceability_snapshot || {}), source_order_id: order.id, source_order_line_id: line.id, prepared_by: SOURCE }),
        actorId,
      ]
    );
  }

  const totals = await db.query(
    `UPDATE sales_documents sd
     SET total_amount_ex_vat=x.ht,total_vat_amount=x.vat,total_amount_inc_vat=x.ttc,updated_at=NOW()
     FROM (
       SELECT COALESCE(SUM(line_amount_ht),0) ht,
              COALESCE(SUM(line_vat_amount),0) vat,
              COALESCE(SUM(line_amount_ttc),0) ttc
       FROM sales_lines
       WHERE sales_document_id=$1
     ) x
     WHERE sd.id=$1
     RETURNING sd.reference_number, sd.total_amount_ex_vat, sd.total_vat_amount, sd.total_amount_inc_vat`,
    [deliveryId]
  );

  const stockResult = await allocateSalesDocumentStock(
    db,
    storeId,
    deliveryId,
    actorId,
    `Validation BL depuis commande ${order.reference_number || order.id}`
  );

  const updatedDelivery = await db.query(
    `UPDATE sales_documents
     SET status='validated',updated_by=$1,updated_at=NOW()
     WHERE id=$2 AND store_id=$3
     RETURNING reference_number,status`,
    [actorId, deliveryId, storeId]
  );
  await db.query(
    `UPDATE sales_documents
     SET status='validated',updated_by=$1,updated_at=NOW()
     WHERE id=$2 AND store_id=$3`,
    [actorId, order.id, storeId]
  );

  const totalRow = totals.rows[0] || {};
  return {
    delivery_note_id: deliveryId,
    delivery_note_reference: updatedDelivery.rows[0]?.reference_number || totalRow.reference_number || delivery.rows[0].reference_number || null,
    document_type: 'DELIVERY_NOTE',
    status: updatedDelivery.rows[0]?.status || 'validated',
    source_order_id: order.id,
    source_order_reference: order.reference_number || null,
    client: { id: order.client_id, code: order.client_code, name: order.client_name },
    line_count: orderLines.rows.length,
    allocated: stockResult.allocated,
    total_amount_ex_vat: totalRow.total_amount_ex_vat,
    total_vat_amount: totalRow.total_vat_amount,
    total_amount_inc_vat: totalRow.total_amount_inc_vat,
  };
}

async function executePendingAction(dbPool, storeId, input = {}) {
  const id = clean(input.id);
  const confirmation = clean(input.confirmation);
  if (!id || confirmation !== 'human_confirmed') {
    const error = new Error('id et confirmation=human_confirmed obligatoires');
    error.status = 400;
    throw error;
  }

  const actionType = await getPendingActionType(dbPool, storeId, id);
  if (!ORDER_ACTION_TYPES.has(actionType) && !DELIVERY_NOTE_ACTION_TYPES.has(actionType)) {
    return base.executePendingAction(dbPool, storeId, input);
  }

  const db = await dbPool.connect();
  try {
    await db.query('BEGIN');
    const actionResult = await db.query(
      `SELECT * FROM agent_pending_actions WHERE id=$1 AND store_id=$2 AND status='pending' FOR UPDATE`,
      [id, storeId]
    );
    if (!actionResult.rows.length) {
      const error = new Error('Action pending introuvable ou déjà traitée');
      error.status = 404;
      throw error;
    }
    const action = actionResult.rows[0];
    if (!ORDER_ACTION_TYPES.has(action.action_type) && !DELIVERY_NOTE_ACTION_TYPES.has(action.action_type)) {
      const error = new Error(`Type action non executable par MCP : ${action.action_type}`);
      error.status = 400;
      throw error;
    }
    const executionResult = DELIVERY_NOTE_ACTION_TYPES.has(action.action_type)
      ? await createDeliveryNoteFromOrder(db, storeId, action.payload || {}, action.summary)
      : await insertCustomerOrderDraft(db, storeId, await prepareOrderPayload(db, storeId, action.payload || {}), action.summary);
    const updated = await db.query(
      `UPDATE agent_pending_actions SET status='executed', executed_at=NOW(), payload=jsonb_set(payload,'{execution_result}',$3::jsonb,true) WHERE id=$1 AND store_id=$2 RETURNING *`,
      [id, storeId, JSON.stringify(executionResult)]
    );
    await db.query('COMMIT');
    return { ...updated.rows[0], execution_result: executionResult };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

module.exports = {
  ...base,
  searchStock,
  getStockOverview,
  getStockState: searchStock,
  getClientsOverview,
  getArticlesOverview,
  getSuppliersOverview,
  getSalesOverview,
  getSalesToday,
  getTopClients,
  getExpiringLots,
  getNegativeStock,
  createCustomerOrderConfirmed,
  createPendingAction,
  executePendingAction,
};
