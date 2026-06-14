const { getDefaultPool } = require('../dbRegistry');

const MAX_SEARCH_LIMIT = 25;
const SOURCE = 'chatgpt_business';
const ACCENT_SOURCE = 'ÀÂÄàâäÉÈÊËéèêëÎÏîïÔÖôöÙÛÜùûüÇç';
const ACCENT_TARGET = 'AAAaaaEEEEeeeeIIiiOOooUUUuuuCc';

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function safeLimit(value, fallback = 10) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_SEARCH_LIMIT);
}

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function searchVariants(value) {
  const normalized = normalizeSearch(value);
  if (!normalized) return [];
  const variants = new Set([normalized]);
  if (normalized.endsWith('s') && normalized.length > 3) variants.add(normalized.slice(0, -1));
  return [...variants];
}

function normalizedSql(field) {
  return `LOWER(translate(COALESCE(${field}::text, ''), '${ACCENT_SOURCE}', '${ACCENT_TARGET}'))`;
}

function buildSearchWhere(fields, query, params) {
  const variants = searchVariants(query);
  if (variants.length === 0) return null;

  const blocks = [];
  variants.forEach((variant) => {
    params.push(`%${variant}%`);
    const idx = params.length;
    blocks.push(`(${fields.map((field) => `${normalizedSql(field)} LIKE $${idx}`).join(' OR ')})`);
  });

  return `(${blocks.join(' OR ')})`;
}

function requireSearchQuery(query) {
  const cleanQuery = clean(query);
  if (!cleanQuery) {
    const error = new Error('Paramètre query obligatoire');
    error.status = 400;
    throw error;
  }
  return cleanQuery;
}

function requireAgentApiKey(req, res, next) {
  const expectedKey = clean(process.env.ALTA_AGENT_API_KEY);
  if (!expectedKey) {
    return res.status(503).json({ error: 'Configuration agent manquante' });
  }

  const header = clean(req.get('authorization')) || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Authorization Bearer requis' });
  if (match[1] !== expectedKey) return res.status(403).json({ error: 'Clé API agent invalide' });

  req.dbPool = getDefaultPool();
  next();
}

async function resolveAgentStore(req, res, next) {
  try {
    const configuredStoreId = clean(process.env.ALTA_AGENT_STORE_ID);
    if (configuredStoreId) {
      const result = await req.dbPool.query('SELECT id FROM stores WHERE id = $1 LIMIT 1', [configuredStoreId]);
      if (result.rows.length === 0) return res.status(503).json({ error: 'Magasin agent introuvable' });
      req.agentStoreId = result.rows[0].id;
      return next();
    }

    const result = await req.dbPool.query('SELECT id FROM stores ORDER BY id ASC LIMIT 1');
    if (result.rows.length === 0) return res.status(503).json({ error: 'Aucun magasin disponible pour l agent' });
    req.agentStoreId = result.rows[0].id;
    next();
  } catch (error) {
    console.error('Erreur contexte agent :', error);
    res.status(500).json({ error: 'Erreur contexte agent' });
  }
}

async function searchClients(dbPool, storeId, input = {}) {
  const query = requireSearchQuery(input.query);
  const params = [storeId];
  const searchWhere = buildSearchWhere(
    ['c.code', 'c.name', 'c.legal_name', 'c.contact_name', 'c.email', 'c.phone', 'c.city'],
    query,
    params
  );
  params.push(safeLimit(input.limit));

  const result = await dbPool.query(
    `
    SELECT
      c.id,
      c.code,
      c.name,
      c.legal_name,
      c.client_type,
      c.status,
      c.tariff_level,
      c.contact_name,
      c.phone,
      c.mobile,
      c.email,
      c.city,
      c.payment_terms,
      c.delivery_terms
    FROM clients c
    WHERE c.store_id = $1
      AND ${searchWhere}
    ORDER BY c.status ASC, c.name ASC
    LIMIT $${params.length}
    `,
    params
  );

  return { results: result.rows };
}

async function searchArticles(dbPool, storeId, input = {}) {
  const query = requireSearchQuery(input.query);
  const params = [storeId];
  const searchWhere = buildSearchWhere(
    ['a.plu', 'a.designation', 'a.ean', 'a.family_name', 'a.latin_name'],
    query,
    params
  );
  params.push(safeLimit(input.limit));

  const result = await dbPool.query(
    `
    SELECT
      a.id,
      a.plu,
      a.designation,
      a.ean,
      a.unit,
      a.purchase_unit,
      a.stock_unit,
      a.sale_unit,
      a.family_code,
      a.family_name,
      a.is_active,
      a.sale_price_level_1_ht,
      a.sale_price_level_2_ht,
      a.sale_price_level_3_ht,
      COALESCE(ss.stock_quantity, 0) AS stock_quantity,
      COALESCE(ss.pma, 0) AS pma
    FROM articles a
    LEFT JOIN stock_summary ss
      ON ss.article_id = a.id
     AND ss.store_id = a.store_id
    WHERE a.store_id = $1
      AND ${searchWhere}
    ORDER BY a.is_active DESC, a.designation ASC
    LIMIT $${params.length}
    `,
    params
  );

  return { results: result.rows };
}

async function searchStock(dbPool, storeId, input = {}) {
  const query = requireSearchQuery(input.query);
  const params = [storeId];
  const searchWhere = buildSearchWhere(
    ['a.plu', 'a.designation', 'a.ean', 'a.family_name', 'a.latin_name'],
    query,
    params
  );
  params.push(safeLimit(input.limit));

  const result = await dbPool.query(
    `
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
    LEFT JOIN stock_summary ss
      ON ss.article_id = a.id
     AND ss.store_id = a.store_id
    LEFT JOIN LATERAL (
      SELECT l.lot_code, l.supplier_lot_number, l.dlc
      FROM lots l
      WHERE l.store_id = a.store_id
        AND l.article_id = a.id
        AND l.qty_remaining > 0
      ORDER BY COALESCE(l.dlc, DATE '9999-12-31') ASC, l.created_at ASC, l.id ASC
      LIMIT 1
    ) lot ON true
    WHERE a.store_id = $1
      AND ${searchWhere}
    ORDER BY COALESCE(ss.stock_quantity, 0) DESC, a.designation ASC
    LIMIT $${params.length}
    `,
    params
  );

  return { results: result.rows };
}

async function searchSuppliers(dbPool, storeId, input = {}) {
  const query = requireSearchQuery(input.query);
  const params = [storeId];
  const searchWhere = buildSearchWhere(
    ['s.code', 's.name', 's.legal_name', 's.contact_name', 's.email', 's.phone', 's.city'],
    query,
    params
  );
  params.push(safeLimit(input.limit));

  const result = await dbPool.query(
    `
    SELECT
      s.id,
      s.code,
      s.name,
      s.legal_name,
      s.supplier_type,
      s.status,
      s.contact_name,
      s.phone,
      s.mobile,
      s.email,
      s.city,
      s.payment_terms,
      s.delivery_terms
    FROM suppliers s
    WHERE s.store_id = $1
      AND ${searchWhere}
    ORDER BY s.status ASC, s.name ASC
    LIMIT $${params.length}
    `,
    params
  );

  return { results: result.rows };
}

async function searchSales(dbPool, storeId, input = {}) {
  const query = requireSearchQuery(input.query);
  const params = [storeId];
  const salesWhere = buildSearchWhere(
    ['sd.reference_number', 'sd.notes', 'c.code', 'c.name'],
    query,
    params
  );
  const lineWhere = buildSearchWhere(['sl.article_plu', 'sl.article_label'], query, params);
  params.push(safeLimit(input.limit));

  const result = await dbPool.query(
    `
    SELECT
      sd.id,
      sd.document_date,
      sd.status,
      sd.document_type,
      sd.reference_number,
      sd.origin,
      sd.total_amount_ex_vat,
      sd.total_amount_inc_vat,
      c.id AS client_id,
      c.code AS client_code,
      c.name AS client_name,
      COUNT(sl.id) AS line_count,
      STRING_AGG(DISTINCT COALESCE(sl.article_label, sl.article_plu), ', ' ORDER BY COALESCE(sl.article_label, sl.article_plu)) AS articles_summary
    FROM sales_documents sd
    LEFT JOIN clients c
      ON c.id = sd.client_id
     AND c.store_id = sd.store_id
    LEFT JOIN sales_lines sl
      ON sl.sales_document_id = sd.id
     AND sl.store_id = sd.store_id
    WHERE sd.store_id = $1
      AND (${salesWhere} OR ${lineWhere})
    GROUP BY sd.id, c.id, c.code, c.name
    ORDER BY sd.document_date DESC NULLS LAST, sd.created_at DESC
    LIMIT $${params.length}
    `,
    params
  );

  return { results: result.rows };
}

async function createPendingAction(dbPool, storeId, input = {}) {
  const actionType = clean(input.action_type);
  const summary = clean(input.summary);
  const payload = input.payload;

  if (!actionType) {
    const error = new Error('action_type obligatoire');
    error.status = 400;
    throw error;
  }
  if (!summary) {
    const error = new Error('summary obligatoire');
    error.status = 400;
    throw error;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const error = new Error('payload JSON objet obligatoire');
    error.status = 400;
    throw error;
  }

  const result = await dbPool.query(
    `
    INSERT INTO agent_pending_actions (
      store_id,
      created_by_source,
      action_type,
      summary,
      payload,
      status
    )
    VALUES ($1, $2, $3, $4, $5::jsonb, 'pending')
    RETURNING id, store_id, created_by_source, action_type, summary, payload, status, created_at, executed_at, cancelled_at
    `,
    [storeId, SOURCE, actionType, summary, JSON.stringify(payload)]
  );

  return result.rows[0];
}

async function getPendingAction(dbPool, storeId, input = {}) {
  const id = clean(input.id);
  if (!id) {
    const error = new Error('id obligatoire');
    error.status = 400;
    throw error;
  }

  const result = await dbPool.query(
    `
    SELECT id, store_id, created_by_source, action_type, summary, payload, status, created_at, executed_at, cancelled_at
    FROM agent_pending_actions
    WHERE id = $1
      AND store_id = $2
    LIMIT 1
    `,
    [id, storeId]
  );

  if (result.rows.length === 0) {
    const error = new Error('Action en attente introuvable');
    error.status = 404;
    throw error;
  }

  return result.rows[0];
}

async function executePendingAction(dbPool, storeId, input = {}) {
  const id = clean(input.id);
  const confirmation = clean(input.confirmation);
  if (!id) {
    const error = new Error('id obligatoire');
    error.status = 400;
    throw error;
  }
  if (confirmation !== 'human_confirmed') {
    const error = new Error('confirmation=human_confirmed obligatoire');
    error.status = 400;
    throw error;
  }

  const result = await dbPool.query(
    `
    UPDATE agent_pending_actions
    SET status = 'executed', executed_at = NOW()
    WHERE id = $1
      AND store_id = $2
      AND status = 'pending'
    RETURNING id, store_id, created_by_source, action_type, summary, payload, status, created_at, executed_at, cancelled_at
    `,
    [id, storeId]
  );

  if (result.rows.length === 0) {
    const error = new Error('Action pending introuvable ou déjà traitée');
    error.status = 404;
    throw error;
  }

  return {
    ...result.rows[0],
    execution_note: 'Socle agent uniquement : aucune action métier directe n est exécutée par cet endpoint.',
  };
}

module.exports = {
  MAX_SEARCH_LIMIT,
  clean,
  requireAgentApiKey,
  resolveAgentStore,
  searchClients,
  searchArticles,
  searchStock,
  searchSuppliers,
  searchSales,
  createPendingAction,
  getPendingAction,
  executePendingAction,
};
