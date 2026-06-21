const { generateToolCall } = require('./aiClient');
const { normalizeConversation } = require('./aiMemoryService');
const { confirmAction, cancelAction } = require('./aiActionService');
const { buildIntelligenceAlerts } = require('../intelligence/alertEngine');

const MAX_QUESTION_LENGTH = 2000;
const MAX_TOOL_STEPS = 8;
const OPTIONAL_DB_ERROR_CODES = new Set(['42P01', '42703', '42883', '42P10']);
const DEFAULT_READ_LIMIT = 30;

function number(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, decimals = 2) {
  return Number(number(value).toFixed(decimals));
}

function normalizeQuestion(question) {
  const text = String(question || '').trim();
  if (!text) {
    const error = new Error('Message assistant requis');
    error.status = 400;
    error.expose = true;
    throw error;
  }
  return text.slice(0, MAX_QUESTION_LENGTH);
}

function parseArgs(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch (error) {
    return {};
  }
}

function ok(data) {
  return { ok: true, ...data };
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function singular(token) {
  return token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token;
}

function tokens(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map(singular)
    .filter((token) => token.length > 1);
}

function matchScore(query, values) {
  const queryTokens = tokens(query);
  if (queryTokens.length === 0) return 1;
  const haystack = normalizeText(values.filter(Boolean).join(' '));
  if (!haystack) return 0;
  if (haystack.includes(queryTokens.join(' '))) return 1;
  return queryTokens.filter((token) => haystack.includes(token)).length / queryTokens.length;
}

function candidateList(rows, query, valuesForRow, limit) {
  return rows
    .map((row) => ({ ...row, match_score: matchScore(query, valuesForRow(row)) }))
    .filter((row) => !query || row.match_score > 0)
    .slice(0, limit);
}

function businessResult(domain, row) {
  return {
    domain,
    id: row.id || row.article_id || row.client_id || row.supplier_id || null,
    code: row.code || row.plu || row.article_plu || null,
    name: row.name || row.designation || row.article_label || row.display_name || null,
    status: row.status || (row.is_active === false ? 'inactive' : 'active'),
    match_score: row.match_score ?? null,
    stock: row.stock_quantity !== undefined ? {
      quantity: number(row.stock_quantity),
      unit: row.sale_unit || row.unit || 'kg',
      pma: number(row.pma),
      next_dlc: row.next_dlc || null,
    } : null,
    raw: row,
  };
}

function formatQuantity(value, unit = 'kg') {
  return `${round(value, 3)} ${unit}`;
}

function formatMoney(value) {
  return `${number(value).toFixed(2)} EUR`;
}

function clean(value) {
  const text = String(value || '').trim();
  return text || null;
}

function limit(value, fallback = DEFAULT_READ_LIMIT, max = 100) {
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

function dateRange(args = {}, defaultPeriod = 'last_30_days') {
  const now = new Date();
  const period = clean(args.period) || defaultPeriod;
  if (args.date_from || args.date_to) {
    return {
      date_from: clean(args.date_from) || isoDate(addDays(now, -30)),
      date_to: clean(args.date_to) || isoDate(now),
      period: 'custom',
    };
  }
  if (period === 'today') {
    return { date_from: isoDate(now), date_to: isoDate(now), period };
  }
  if (period === 'month') {
    return { date_from: isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), date_to: isoDate(now), period };
  }
  if (period === 'year') {
    return { date_from: isoDate(new Date(Date.UTC(now.getUTCFullYear(), 0, 1))), date_to: isoDate(now), period };
  }
  return { date_from: isoDate(addDays(now, -30)), date_to: isoDate(now), period: 'last_30_days' };
}

function buildDateFilters(alias, args, params) {
  const range = dateRange(args);
  params.push(range.date_from);
  const fromIndex = params.length;
  params.push(range.date_to);
  const toIndex = params.length;
  return {
    range,
    sql: `${alias}.document_date >= $${fromIndex}::date AND ${alias}.document_date <= $${toIndex}::date`,
  };
}

function pendingSummary(payload) {
  const clientName = payload?.client?.name || 'client';
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  return [
    `Je vais preparer une commande brouillon pour ${clientName} :`,
    ...lines.map((line) => {
      const plu = line.article_plu ? ` - PLU ${line.article_plu}` : '';
      const stock = line.stock_quantity !== undefined ? ` - stock ${formatQuantity(line.stock_quantity, line.sale_unit || 'kg')}` : '';
      const packageText = line.package_count > 0 && line.weight_per_package > 0
        ? `${line.package_count} colis x ${line.weight_per_package} kg = ${formatQuantity(line.quantity, line.sale_unit || 'kg')}`
        : formatQuantity(line.quantity, line.sale_unit || 'kg');
      return `- ${line.article_label}${plu} : ${packageText} a ${formatMoney(line.unit_sale_price_ht)}/${line.sale_unit || 'kg'}${stock}`;
    }),
    '',
    'Confirmer l action ?',
  ].join('\n');
}

function actionResultText(result) {
  const sale = result?.result;
  if (!sale) return 'Action IA executee.';
  const lines = Array.isArray(sale.lines)
    ? sale.lines.map((line) => `- ${line.article_label} : ${line.sold_quantity} ${line.sale_unit}`)
    : [];
  return ['Commande brouillon creee.', `Client : ${sale.client?.name || 'client'}`, `Document : ${sale.sale_id}`, '', ...lines].join('\n');
}

function systemPrompt() {
  return [
    'Tu es ALTA, assistant commercial pour ALTA MAREE.',
    'Tu es un agent GPT tool-first : le backend fournit les donnees, toi tu fais le raisonnement metier.',
    'Le backend ne choisit pas les clients/articles a ta place. Les outils renvoient plusieurs candidats riches.',
    'Tu dois comparer les candidats, expliquer ton choix ou demander une precision si le choix est ambigu.',
    'Ne considere jamais l ordre des resultats comme une decision backend. Utilise les donnees : designation, PLU, stock, historique, prix.',
    'Tu ne generes jamais de SQL libre et tu ne demandes jamais au backend de parser la conversation.',
    'Tous les outils lecture sont read-only, limites par store_id, sans DELETE, UPDATE ni INSERT.',
    'Les outils de synthese ventes, marges, achats, factures fournisseurs et alertes sont des outils de lecture uniquement.',
    'prepare_email_draft prepare seulement un texte de brouillon : aucun email n est envoye et aucune donnee metier n est enregistree.',
    'Une action sensible passe obligatoirement par create_pending_action puis confirmation humaine.',
    'Tu ne dois jamais afficher Confirmer si aucune pending_action n existe.',
    'Le payload pending_action doit contenir uniquement ton choix final, avec article_id exact.',
    'Pour une commande, l article affiche doit etre exactement l article execute : meme article_id, meme PLU, meme designation.',
    'Reponds en francais, de facon concise et operationnelle.',
  ].join('\n');
}

function toolDefinitions() {
  const idArg = (name) => ({ type: 'object', properties: { [name]: { type: 'string' } }, required: [name] });
  const periodArgs = {
    period: { type: 'string', enum: ['today', 'month', 'last_30_days', 'year', 'custom'] },
    date_from: { type: 'string', description: 'Date debut YYYY-MM-DD si period=custom.' },
    date_to: { type: 'string', description: 'Date fin YYYY-MM-DD si period=custom.' },
  };
  return [
    { type: 'function', function: { name: 'search_clients', description: 'Retourne plusieurs clients candidats. GPT choisit ou demande precision.', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 30 } }, required: ['query'] } } },
    { type: 'function', function: { name: 'search_articles', description: 'Retourne plusieurs articles candidats avec stock/prix. GPT compare et choisit.', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 }, only_in_stock: { type: 'boolean' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'search_stock', description: 'Retourne les etats de stock pour une recherche ou plusieurs article_id. Ne choisit pas.', parameters: { type: 'object', properties: { query: { type: 'string' }, article_ids: { type: 'array', items: { type: 'string' } }, limit: { type: 'integer', minimum: 1, maximum: 50 } } } } },
    { type: 'function', function: { name: 'get_client_profile', description: 'Lit une fiche client avec historique recent.', parameters: idArg('client_id') } },
    { type: 'function', function: { name: 'get_article_profile', description: 'Lit une fiche article avec stock et historiques.', parameters: idArg('article_id') } },
    { type: 'function', function: { name: 'get_stock_state', description: 'Lit le stock detaille d un article.', parameters: idArg('article_id') } },
    { type: 'function', function: { name: 'search_suppliers', description: 'Retourne plusieurs fournisseurs candidats.', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 30 } }, required: ['query'] } } },
    { type: 'function', function: { name: 'get_sales_history', description: 'Lit historique ventes client/article.', parameters: { type: 'object', properties: { client_id: { type: 'string' }, article_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 80 } } } } },
    { type: 'function', function: { name: 'get_sales_summary', description: 'Synthese read-only des ventes, CA et marge sur une periode.', parameters: { type: 'object', properties: { ...periodArgs, document_type: { type: 'string', enum: ['ORDER', 'DELIVERY_NOTE', 'INVOICE', 'CREDIT_NOTE'] } } } } },
    { type: 'function', function: { name: 'get_sales_documents', description: 'Liste read-only de commandes, BL, factures ou avoirs clients.', parameters: { type: 'object', properties: { ...periodArgs, document_type: { type: 'string', enum: ['ORDER', 'DELIVERY_NOTE', 'INVOICE', 'CREDIT_NOTE'] }, status: { type: 'string' }, client_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 80 } } } } },
    { type: 'function', function: { name: 'get_margin_analysis', description: 'Analyse read-only des marges par article, client ou fournisseur.', parameters: { type: 'object', properties: { ...periodArgs, group_by: { type: 'string', enum: ['article', 'client', 'supplier'] }, limit: { type: 'integer', minimum: 1, maximum: 80 } } } } },
    { type: 'function', function: { name: 'get_purchase_summary', description: 'Synthese read-only des achats, receptions et fournisseurs.', parameters: { type: 'object', properties: { period: periodArgs.period, date_from: periodArgs.date_from, date_to: periodArgs.date_to, supplier_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 80 } } } } },
    { type: 'function', function: { name: 'get_supplier_invoice_summary', description: 'Synthese read-only des factures fournisseurs et rapprochements.', parameters: { type: 'object', properties: { period: periodArgs.period, date_from: periodArgs.date_from, date_to: periodArgs.date_to, supplier_id: { type: 'string' }, status: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 80 } } } } },
    { type: 'function', function: { name: 'get_clients_to_follow_up', description: 'Clients actifs a relancer selon derniere vente connue.', parameters: { type: 'object', properties: { inactive_days: { type: 'integer', minimum: 1, maximum: 365 }, limit: { type: 'integer', minimum: 1, maximum: 80 } } } } },
    { type: 'function', function: { name: 'get_intelligence_alerts', description: 'Lit les alertes du centre de surveillance ALTA.', parameters: { type: 'object', properties: { level: { type: 'string', enum: ['green', 'orange', 'red'] }, limit: { type: 'integer', minimum: 1, maximum: 20 } } } } },
    { type: 'function', function: { name: 'prepare_email_draft', description: 'Prepare un brouillon email texte sans envoi et sans ecriture metier.', parameters: { type: 'object', properties: { client_id: { type: 'string' }, client_name: { type: 'string' }, purpose: { type: 'string' }, product_focus: { type: 'string' } } } } },
    { type: 'function', function: { name: 'get_pending_action', description: 'Lit une action en attente.', parameters: { type: 'object', properties: { action_id: { type: 'string' } } } } },
    { type: 'function', function: { name: 'create_pending_action', description: 'Fige le choix final de GPT et demande confirmation humaine.', parameters: { type: 'object', properties: { action_type: { type: 'string', enum: ['customer_order_draft'] }, payload: { type: 'object' } }, required: ['action_type', 'payload'] } } },
    { type: 'function', function: { name: 'execute_pending_action', description: 'Execute une pending_action apres confirmation humaine.', parameters: idArg('action_id') } },
    { type: 'function', function: { name: 'cancel_pending_action', description: 'Annule une pending_action.', parameters: idArg('action_id') } },
  ];
}

async function searchClients({ db, user, args }) {
  const maxRows = Math.min(number(args.limit, 12), 30);
  const result = await db.query(`
    SELECT id, code, name, COALESCE(status, 'active') AS status, city, email, tariff_level
    FROM clients
    WHERE store_id = $1
      AND COALESCE(status, 'active') <> 'inactive'
    ORDER BY name ASC
    LIMIT 300
  `, [user.store_id]);
  const candidates = candidateList(result.rows, args.query, (row) => [row.name, row.code, row.city, row.email], maxRows);
  return ok({ candidates: candidates.map((row) => businessResult('clients', row)) });
}

async function searchArticles({ db, user, args }) {
  const maxRows = Math.min(number(args.limit, 20), 50);
  const onlyInStock = Boolean(args.only_in_stock);
  const result = await db.query(`
    SELECT a.id, a.plu, a.ean, a.designation, a.display_name, a.unit, a.sale_unit,
           a.vat_rate, a.sale_price_ex_vat, a.sale_price_level_1_ht, a.sale_price_level_2_ht,
           a.sale_price_level_3_ht, COALESCE(a.is_active, true) AS is_active,
           COALESCE(ss.stock_quantity, 0) AS stock_quantity, COALESCE(ss.pma, 0) AS pma, ss.next_dlc
    FROM articles a
    LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
    WHERE a.store_id = $1
      AND COALESCE(a.is_active, true) = true
      AND ($2::boolean = false OR COALESCE(ss.stock_quantity, 0) > 0)
    ORDER BY a.designation ASC
    LIMIT 500
  `, [user.store_id, onlyInStock]);
  const candidates = candidateList(result.rows, args.query, (row) => [row.designation, row.display_name, row.plu, row.ean], maxRows);
  return ok({ candidates: candidates.map((row) => businessResult('articles', row)) });
}

async function getStockState({ db, user, args }) {
  const [summary, lots] = await Promise.all([
    db.query(`
      SELECT a.id AS article_id, a.plu, a.designation, a.unit, a.sale_unit,
             COALESCE(ss.stock_quantity, 0) AS stock_quantity,
             COALESCE(ss.stock_value_ex_vat, 0) AS stock_value_ex_vat,
             COALESCE(ss.pma, 0) AS pma, ss.next_dlc
      FROM articles a
      LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
      WHERE a.id = $1 AND a.store_id = $2
      LIMIT 1
    `, [args.article_id, user.store_id]),
    db.query(`
      SELECT l.id AS lot_id, l.lot_code, l.supplier_lot_number, l.qty_remaining,
             l.unit_cost_ex_vat, l.dlc, s.id AS supplier_id, s.name AS supplier_name
      FROM lots l
      LEFT JOIN suppliers s ON s.id = l.supplier_id AND s.store_id = l.store_id
      WHERE l.store_id = $1 AND l.article_id = $2 AND l.qty_remaining > 0
      ORDER BY COALESCE(l.dlc, DATE '9999-12-31') ASC, l.qty_remaining DESC
      LIMIT 30
    `, [user.store_id, args.article_id]),
  ]);
  const row = summary.rows[0] || null;
  return ok({
    stock_state: row ? {
      article_id: row.article_id,
      plu: row.plu,
      designation: row.designation,
      quantity: number(row.stock_quantity),
      unit: row.sale_unit || row.unit || 'kg',
      value_ht: number(row.stock_value_ex_vat),
      pma: number(row.pma),
      next_dlc: row.next_dlc || null,
      lots: lots.rows,
    } : null,
  });
}

async function searchStock({ db, user, args }) {
  const articleIds = Array.isArray(args.article_ids) ? args.article_ids.filter(Boolean) : [];
  if (articleIds.length > 0) {
    const states = await Promise.all(articleIds.map((articleId) => getStockState({ db, user, args: { article_id: articleId } })));
    return ok({ stock_states: states.map((state) => state.stock_state).filter(Boolean) });
  }
  const result = await searchArticles({ db, user, args: { query: args.query || '', limit: args.limit || 20, only_in_stock: true } });
  return ok({ candidates: result.candidates });
}

async function getClientProfile({ db, user, args }) {
  const result = await db.query(`
    SELECT id, code, name, COALESCE(status, 'active') AS status, city, email, tariff_level, vat_rate, is_vat_exempt
    FROM clients
    WHERE id = $1 AND store_id = $2
    LIMIT 1
  `, [args.client_id, user.store_id]);
  const client = result.rows[0] || null;
  if (!client) return ok({ client: null });
  const history = await getSalesHistory({ db, user, args: { client_id: args.client_id, limit: 20 } });
  return ok({ client: businessResult('clients', client), sales_history: history.sales_history });
}

async function getArticleProfile({ db, user, args }) {
  const result = await db.query(`
    SELECT a.id, a.plu, a.ean, a.designation, a.display_name, a.unit, a.sale_unit,
           a.vat_rate, a.sale_price_ex_vat, a.sale_price_level_1_ht, a.sale_price_level_2_ht,
           a.sale_price_level_3_ht, COALESCE(a.is_active, true) AS is_active,
           COALESCE(ss.stock_quantity, 0) AS stock_quantity, COALESCE(ss.pma, 0) AS pma, ss.next_dlc
    FROM articles a
    LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
    WHERE a.id = $1 AND a.store_id = $2
    LIMIT 1
  `, [args.article_id, user.store_id]);
  const article = result.rows[0] || null;
  if (!article) return ok({ article: null });
  const [stock, history] = await Promise.all([
    getStockState({ db, user, args: { article_id: args.article_id } }),
    getSalesHistory({ db, user, args: { article_id: args.article_id, limit: 20 } }),
  ]);
  return ok({ article: businessResult('articles', article), stock: stock.stock_state, sales_history: history.sales_history });
}

async function searchSuppliers({ db, user, args }) {
  const maxRows = Math.min(number(args.limit, 12), 30);
  const result = await db.query(`
    SELECT id, code, name, COALESCE(status, 'active') AS status, city, email, phone
    FROM suppliers
    WHERE store_id = $1
      AND COALESCE(status, 'active') <> 'inactive'
    ORDER BY name ASC
    LIMIT 300
  `, [user.store_id]);
  const candidates = candidateList(result.rows, args.query, (row) => [row.name, row.code, row.city, row.email], maxRows);
  return ok({ candidates: candidates.map((row) => businessResult('suppliers', row)) });
}

async function getSalesHistory({ db, user, args }) {
  const maxRows = Math.min(number(args.limit, 30), 80);
  const params = [user.store_id];
  const filters = ['sd.store_id = $1'];
  if (args.client_id) { params.push(args.client_id); filters.push(`sd.client_id = $${params.length}`); }
  if (args.article_id) { params.push(args.article_id); filters.push(`sl.article_id = $${params.length}`); }
  params.push(maxRows);
  const result = await db.query(`
    SELECT sd.id AS document_id, sd.document_date, sd.document_type, sd.status,
           c.id AS client_id, c.code AS client_code, c.name AS client_name,
           sl.article_id, sl.article_plu, sl.article_label, sl.sold_quantity, sl.sale_unit,
           sl.unit_sale_price_ht, sl.line_amount_ht, sl.line_margin_ex_vat
    FROM sales_documents sd
    JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
    LEFT JOIN clients c ON c.id = sd.client_id AND c.store_id = sd.store_id
    WHERE ${filters.join(' AND ')}
      AND COALESCE(sd.status, '') NOT IN ('cancelled')
    ORDER BY sd.document_date DESC, sl.article_label ASC
    LIMIT $${params.length}
  `, params);
  return ok({
    sales_history: result.rows.map((row) => ({
      document_id: row.document_id,
      document_date: row.document_date,
      document_type: row.document_type,
      status: row.status,
      client: { id: row.client_id, code: row.client_code, name: row.client_name },
      article: { id: row.article_id, plu: row.article_plu, label: row.article_label },
      quantity: number(row.sold_quantity),
      unit: row.sale_unit,
      unit_price_ht: number(row.unit_sale_price_ht),
      amount_ht: number(row.line_amount_ht),
      margin_ht: number(row.line_margin_ex_vat),
    })),
  });
}

async function getSalesSummary({ db, user, args }) {
  const params = [user.store_id];
  const dateFilter = buildDateFilters('sd', args, params);
  const filters = ['sd.store_id = $1', dateFilter.sql, "COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')"];
  if (args.document_type) { params.push(args.document_type); filters.push(`sd.document_type = $${params.length}`); }
  const result = await db.query(`
    SELECT
      COUNT(DISTINCT sd.id)::int AS document_count,
      COUNT(sl.id)::int AS line_count,
      COALESCE(SUM(sl.line_amount_ht), 0) AS ca_ht,
      COALESCE(SUM(sl.line_margin_ex_vat), 0) AS margin_ht,
      CASE WHEN COALESCE(SUM(sl.line_amount_ht), 0) > 0
        THEN COALESCE(SUM(sl.line_margin_ex_vat), 0) / COALESCE(SUM(sl.line_amount_ht), 0) * 100
        ELSE 0
      END AS margin_rate,
      COALESCE(SUM(COALESCE(sl.sold_quantity, sl.total_weight, 0)), 0) AS quantity,
      COUNT(DISTINCT sd.client_id)::int AS client_count
    FROM sales_documents sd
    LEFT JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
    WHERE ${filters.join(' AND ')}
  `, params);
  const byType = await db.query(`
    SELECT sd.document_type,
           COUNT(DISTINCT sd.id)::int AS document_count,
           COALESCE(SUM(sl.line_amount_ht), 0) AS ca_ht,
           COALESCE(SUM(sl.line_margin_ex_vat), 0) AS margin_ht
    FROM sales_documents sd
    LEFT JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
    WHERE ${filters.join(' AND ')}
    GROUP BY sd.document_type
    ORDER BY ca_ht DESC
  `, params);
  return ok({ sales_summary: { period: dateFilter.range, totals: result.rows[0] || {}, by_document_type: byType.rows } });
}

async function getSalesDocuments({ db, user, args }) {
  const params = [user.store_id];
  const dateFilter = buildDateFilters('sd', args, params);
  const filters = ['sd.store_id = $1', dateFilter.sql];
  if (args.document_type) { params.push(args.document_type); filters.push(`sd.document_type = $${params.length}`); }
  if (args.status) { params.push(args.status); filters.push(`sd.status = $${params.length}`); }
  if (args.client_id) { params.push(args.client_id); filters.push(`sd.client_id = $${params.length}`); }
  params.push(limit(args.limit, 30, 80));
  const result = await db.query(`
    SELECT sd.id, sd.reference_number, sd.document_number, sd.document_date, sd.document_type, sd.status,
           sd.total_amount_ex_vat, sd.total_vat_amount, sd.total_amount_inc_vat,
           c.id AS client_id, c.code AS client_code, c.name AS client_name,
           COUNT(sl.id)::int AS line_count,
           COALESCE(SUM(sl.line_margin_ex_vat), 0) AS margin_ht
    FROM sales_documents sd
    LEFT JOIN clients c ON c.id = sd.client_id AND c.store_id = sd.store_id
    LEFT JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
    WHERE ${filters.join(' AND ')}
    GROUP BY sd.id, c.id, c.code, c.name
    ORDER BY sd.document_date DESC NULLS LAST, sd.created_at DESC
    LIMIT $${params.length}
  `, params);
  return ok({ period: dateFilter.range, sales_documents: result.rows });
}

async function getMarginAnalysis({ db, user, args }) {
  const groupBy = ['article', 'client', 'supplier'].includes(args.group_by) ? args.group_by : 'article';
  const params = [user.store_id];
  const dateFilter = buildDateFilters('sd', args, params);
  const maxRows = limit(args.limit, 30, 80);
  params.push(maxRows);

  if (groupBy === 'client') {
    const result = await db.query(`
      SELECT c.id AS client_id, c.code, c.name,
             COUNT(DISTINCT sd.id)::int AS document_count,
             COALESCE(SUM(sl.line_amount_ht), 0) AS ca_ht,
             COALESCE(SUM(sl.line_margin_ex_vat), 0) AS margin_ht,
             CASE WHEN COALESCE(SUM(sl.line_amount_ht), 0) > 0
               THEN COALESCE(SUM(sl.line_margin_ex_vat), 0) / COALESCE(SUM(sl.line_amount_ht), 0) * 100
               ELSE 0
             END AS margin_rate
      FROM sales_documents sd
      JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
      LEFT JOIN clients c ON c.id = sd.client_id AND c.store_id = sd.store_id
      WHERE sd.store_id = $1 AND ${dateFilter.sql} AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
      GROUP BY c.id, c.code, c.name
      ORDER BY margin_ht DESC, ca_ht DESC
      LIMIT $${params.length}
    `, params);
    return ok({ period: dateFilter.range, group_by: groupBy, margins: result.rows });
  }

  if (groupBy === 'supplier') {
    const result = await db.query(`
      SELECT s.id AS supplier_id, s.code, s.name,
             COUNT(sl.id)::int AS line_count,
             COALESCE(SUM(sl.line_amount_ht), 0) AS ca_ht,
             COALESCE(SUM(sl.line_margin_ex_vat), 0) AS margin_ht,
             CASE WHEN COALESCE(SUM(sl.line_amount_ht), 0) > 0
               THEN COALESCE(SUM(sl.line_margin_ex_vat), 0) / COALESCE(SUM(sl.line_amount_ht), 0) * 100
               ELSE 0
             END AS margin_rate
      FROM sales_documents sd
      JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
      LEFT JOIN sale_line_allocations sla ON sla.sales_line_id = sl.id
      LEFT JOIN lots l ON l.id = sla.lot_id AND l.store_id = sl.store_id
      LEFT JOIN suppliers s ON s.id = l.supplier_id AND s.store_id = l.store_id
      WHERE sd.store_id = $1 AND ${dateFilter.sql} AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
      GROUP BY s.id, s.code, s.name
      ORDER BY margin_ht DESC, ca_ht DESC
      LIMIT $${params.length}
    `, params);
    return ok({ period: dateFilter.range, group_by: groupBy, margins: result.rows });
  }

  const result = await db.query(`
    SELECT COALESCE(a.id, sl.article_id) AS article_id,
           COALESCE(a.plu, sl.article_plu) AS plu,
           COALESCE(a.designation, sl.article_label, 'Article sans nom') AS designation,
           COALESCE(SUM(COALESCE(sl.sold_quantity, sl.total_weight, 0)), 0) AS quantity,
           COALESCE(SUM(sl.line_amount_ht), 0) AS ca_ht,
           COALESCE(SUM(sl.line_margin_ex_vat), 0) AS margin_ht,
           CASE WHEN COALESCE(SUM(sl.line_amount_ht), 0) > 0
             THEN COALESCE(SUM(sl.line_margin_ex_vat), 0) / COALESCE(SUM(sl.line_amount_ht), 0) * 100
             ELSE 0
           END AS margin_rate
    FROM sales_documents sd
    JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
    LEFT JOIN articles a ON a.id = sl.article_id AND a.store_id = sl.store_id
    WHERE sd.store_id = $1 AND ${dateFilter.sql} AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
    GROUP BY COALESCE(a.id, sl.article_id), COALESCE(a.plu, sl.article_plu), COALESCE(a.designation, sl.article_label, 'Article sans nom')
    ORDER BY margin_ht DESC, ca_ht DESC
    LIMIT $${params.length}
  `, params);
  return ok({ period: dateFilter.range, group_by: groupBy, margins: result.rows });
}

async function getPurchaseSummary({ db, user, args }) {
  const range = dateRange(args);
  const params = [user.store_id, range.date_from, range.date_to];
  const filters = [
    'p.store_id = $1',
    "COALESCE(p.receipt_date, p.purchase_date) >= $2::date",
    "COALESCE(p.receipt_date, p.purchase_date) <= $3::date",
  ];
  if (args.supplier_id) { params.push(args.supplier_id); filters.push(`p.supplier_id = $${params.length}`); }
  const summary = await db.query(`
    SELECT COUNT(DISTINCT p.id)::int AS purchase_count,
           COUNT(pl.id)::int AS line_count,
           COALESCE(SUM(pl.line_amount_ex_vat), 0) AS purchases_ht,
           COALESCE(SUM(COALESCE(pl.received_quantity, pl.ordered_quantity, 0)), 0) AS quantity,
           COUNT(DISTINCT p.supplier_id)::int AS supplier_count
    FROM purchases p
    LEFT JOIN purchase_lines pl ON pl.purchase_id = p.id AND pl.store_id = p.store_id
    WHERE ${filters.join(' AND ')} AND COALESCE(p.status, '') <> 'cancelled'
  `, params);
  params.push(limit(args.limit, 30, 80));
  const recent = await db.query(`
    SELECT p.id, p.purchase_date, p.receipt_date, p.status, p.bl_number, p.invoice_number,
           p.total_amount_ex_vat, s.id AS supplier_id, s.code AS supplier_code, s.name AS supplier_name,
           COUNT(pl.id)::int AS line_count
    FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.store_id = p.store_id
    LEFT JOIN purchase_lines pl ON pl.purchase_id = p.id AND pl.store_id = p.store_id
    WHERE ${filters.join(' AND ')}
    GROUP BY p.id, s.id, s.code, s.name
    ORDER BY COALESCE(p.receipt_date, p.purchase_date) DESC NULLS LAST, p.created_at DESC
    LIMIT $${params.length}
  `, params);
  return ok({ period: range, purchase_summary: summary.rows[0] || {}, recent_purchases: recent.rows });
}

async function getSupplierInvoiceSummary({ db, user, args }) {
  const range = dateRange(args);
  const params = [user.store_id, range.date_from, range.date_to];
  const filters = ['si.store_id = $1', 'si.invoice_date >= $2::date', 'si.invoice_date <= $3::date'];
  if (args.supplier_id) { params.push(args.supplier_id); filters.push(`si.supplier_id = $${params.length}`); }
  if (args.status) { params.push(args.status); filters.push(`si.status = $${params.length}`); }
  const summary = await db.query(`
    SELECT COUNT(DISTINCT si.id)::int AS invoice_count,
           COALESCE(SUM(si.total_ex_vat), 0) AS total_ht,
           COALESCE(SUM(si.total_vat), 0) AS total_vat,
           COALESCE(SUM(si.total_inc_vat), 0) AS total_ttc,
           COUNT(DISTINCT si.supplier_id)::int AS supplier_count,
           COUNT(DISTINCT si.id) FILTER (WHERE sim.id IS NULL)::int AS unmatched_count
    FROM supplier_invoices si
    LEFT JOIN supplier_invoice_matches sim ON sim.supplier_invoice_id = si.id
    WHERE ${filters.join(' AND ')} AND COALESCE(si.status, '') <> 'cancelled'
  `, params);
  params.push(limit(args.limit, 30, 80));
  const invoices = await db.query(`
    SELECT si.id, si.invoice_number, si.invoice_date, si.status, si.total_ex_vat, si.total_inc_vat,
           s.id AS supplier_id, s.code AS supplier_code, s.name AS supplier_name,
           COUNT(sim.id)::int AS match_count
    FROM supplier_invoices si
    LEFT JOIN suppliers s ON s.id = si.supplier_id AND s.store_id = si.store_id
    LEFT JOIN supplier_invoice_matches sim ON sim.supplier_invoice_id = si.id
    WHERE ${filters.join(' AND ')}
    GROUP BY si.id, s.id, s.code, s.name
    ORDER BY si.invoice_date DESC NULLS LAST, si.created_at DESC
    LIMIT $${params.length}
  `, params);
  return ok({ period: range, supplier_invoice_summary: summary.rows[0] || {}, supplier_invoices: invoices.rows });
}

async function getClientsToFollowUp({ db, user, args }) {
  const inactiveDays = Math.min(Math.max(Math.trunc(number(args.inactive_days, 30)), 1), 365);
  const maxRows = limit(args.limit, 30, 80);
  const result = await db.query(`
    WITH last_sales AS (
      SELECT client_id, MAX(document_date) AS last_sale_date, COUNT(*) AS document_count,
             COALESCE(SUM(total_amount_ex_vat), 0) AS ca_ht
      FROM sales_documents
      WHERE store_id = $1
        AND COALESCE(status, '') NOT IN ('draft', 'cancelled')
      GROUP BY client_id
    )
    SELECT c.id AS client_id, c.code, c.name, c.email, c.mobile, c.phone,
           ls.last_sale_date,
           CASE WHEN ls.last_sale_date IS NULL THEN 9999 ELSE CURRENT_DATE - ls.last_sale_date::date END AS inactive_days,
           COALESCE(ls.document_count, 0) AS document_count,
           COALESCE(ls.ca_ht, 0) AS ca_ht
    FROM clients c
    LEFT JOIN last_sales ls ON ls.client_id = c.id
    WHERE c.store_id = $1
      AND COALESCE(c.status, 'active') <> 'inactive'
      AND (ls.last_sale_date IS NULL OR ls.last_sale_date <= CURRENT_DATE - ($2::int || ' days')::interval)
    ORDER BY inactive_days DESC, c.name ASC
    LIMIT $3
  `, [user.store_id, inactiveDays, maxRows]);
  return ok({ inactive_days_threshold: inactiveDays, clients_to_follow_up: result.rows });
}

async function getIntelligenceAlerts({ db, user, args }) {
  const alerts = await buildIntelligenceAlerts(db, user.store_id);
  const requestedLevel = clean(args.level);
  const filtered = alerts
    .filter((alert) => !requestedLevel || alert.level === requestedLevel)
    .sort((a, b) => ({ red: 3, orange: 2, green: 1 }[b.level] - { red: 3, orange: 2, green: 1 }[a.level] || b.count - a.count))
.slice(0, limit(args.limit, 10, 20));
  return ok({ alerts: filtered, source: 'intelligence_center', read_only: true });
}

function pickEmailClient(client, fallbackName) {
  if (client) return client;
  return { id: null, name: fallbackName || 'client', email: null, mobile: null, code: null };
}

async function prepareEmailDraft({ db, user, args }) {
  let client = null;
  if (args.client_id) {
    const result = await db.query(`
      SELECT id, code, name, email, mobile, phone, city
      FROM clients
      WHERE id = $1 AND store_id = $2 AND COALESCE(status, 'active') <> 'inactive'
      LIMIT 1
    `, [args.client_id, user.store_id]);
    client = result.rows[0] || null;
  }
  if (!client && args.client_name) {
    const candidates = await searchClients({ db, user, args: { query: args.client_name, limit: 1 } });
    client = candidates.candidates?.[0]?.raw || null;
  }
  if (!client) {
    const followUp = await getClientsToFollowUp({ db, user, args: { inactive_days: 30, limit: 1 } });
    client = followUp.clients_to_follow_up?.[0] ? {
      id: followUp.clients_to_follow_up[0].client_id,
      name: followUp.clients_to_follow_up[0].name,
      email: followUp.clients_to_follow_up[0].email,
      mobile: followUp.clients_to_follow_up[0].mobile,
      code: followUp.clients_to_follow_up[0].code,
    } : null;
  }

  const target = pickEmailClient(client, args.client_name);
  const purpose = clean(args.purpose) || 'relance commerciale';
  const productFocus = clean(args.product_focus);
  const subject = productFocus
    ? `Disponibilite ${productFocus} - ALTA MAREE`
    : 'Disponibilites produits de la mer - ALTA MAREE';
  const body = [
    `Bonjour ${target.name && target.name !== 'client' ? target.name : ''},`.trim(),
    '',
    purpose.toLowerCase().includes('relance')
      ? 'Je me permets de te recontacter pour faire le point sur tes besoins produits de la mer.'
      : 'Je te contacte au sujet de nos disponibilites produits de la mer.',
    productFocus ? `Nous pouvons notamment regarder ensemble les disponibilites autour de : ${productFocus}.` : 'Je peux te proposer les produits disponibles et les priorites du moment selon le stock.',
    '',
    'Dis-moi ce qui peut t interesser et je te prepare une proposition adaptee.',
    '',
    'Bien cordialement,',
    'ALTA MAREE',
  ].join('\n');

  return ok({
    draft_only: true,
    send_allowed: false,
    read_only: true,
    client: target,
    email_draft: { subject, body },
    warning: 'Brouillon uniquement : aucun email envoye, aucune donnee metier enregistree.',
  });
}

async function prepareCustomerOrderDraft({ db, user, args }) {
  const clientResult = await db.query(`
    SELECT id, code, name, tariff_level, vat_rate, is_vat_exempt, city, email
    FROM clients
    WHERE id = $1 AND store_id = $2 AND COALESCE(status, 'active') <> 'inactive'
    LIMIT 1
  `, [args.client_id, user.store_id]);
  const client = clientResult.rows[0];
  if (!client) {
    const error = new Error('Client introuvable pour ce magasin.');
    error.status = 400;
    error.expose = true;
    throw error;
  }

  const rawLines = Array.isArray(args.lines) ? args.lines : [];
  if (rawLines.length === 0) {
    const error = new Error('Aucune ligne de commande fournie.');
    error.status = 400;
    error.expose = true;
    throw error;
  }

  const lines = [];
  for (const rawLine of rawLines) {
    const qty = number(rawLine.quantity);
    const price = number(rawLine.unit_sale_price_ht);
    if (qty <= 0 || price <= 0) {
      const error = new Error('Quantite et prix de vente obligatoires pour chaque ligne.');
      error.status = 400;
      error.expose = true;
      throw error;
    }

    const articleResult = await db.query(`
      SELECT a.id, a.plu, a.designation, a.unit, a.sale_unit, a.vat_rate,
             COALESCE(ss.stock_quantity, 0) AS stock_quantity, COALESCE(ss.pma, 0) AS pma,
             (ss.article_id IS NOT NULL) AS has_stock_summary
      FROM articles a
      LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
      WHERE a.id = $1 AND a.store_id = $2 AND COALESCE(a.is_active, true) = true
      LIMIT 1
    `, [rawLine.article_id, user.store_id]);
    const article = articleResult.rows[0];
    if (!article) {
      const error = new Error(`Article introuvable pour la ligne ${lines.length + 1}.`);
      error.status = 400;
      error.expose = true;
      throw error;
    }

    const saleUnit = rawLine.sale_unit || article.sale_unit || article.unit || 'kg';
    const vatRate = client.is_vat_exempt ? 0 : number(article.vat_rate, number(client.vat_rate, 5.5));
    const amountHt = round(qty * price, 2);
    const vatAmount = round(amountHt * vatRate / 100, 2);
    const amountTtc = round(amountHt + vatAmount, 2);
    const stockQty = number(article.stock_quantity);
    const line = {
      article_id: article.id,
      article_plu: article.plu,
      plu: article.plu,
      designation: article.designation,
      article_label: article.designation,
      stock_quantity: stockQty,
      source: article.has_stock_summary ? 'stock' : 'articles',
      is_negoce: Boolean(rawLine.allow_negoce) || stockQty < qty,
      supply_status: Boolean(rawLine.allow_negoce) || stockQty < qty ? 'a_approvisionner' : 'stock',
      quantity: qty,
      package_count: number(rawLine.package_count),
      weight_per_package: number(rawLine.weight_per_package),
      sale_unit: saleUnit,
      unit_sale_price_ht: price,
      unit_sale_price_ttc: qty > 0 ? round(amountTtc / qty, 4) : 0,
      vat_rate: vatRate,
      line_amount_ht: amountHt,
      line_vat_amount: vatAmount,
      line_amount_ttc: amountTtc,
      unit_cost_ex_vat: number(article.pma),
      line_margin_ex_vat: round(amountHt - qty * number(article.pma), 2),
    };
    console.info('[AI ACTION] selected article frozen', { store_id: user.store_id, user_id: user.id, article_id: line.article_id, plu: line.article_plu, designation: line.designation, stock_quantity: line.stock_quantity, source: line.source, is_negoce: line.is_negoce });
    lines.push(line);
  }

  const payload = { client, lines, has_negoce_lines: lines.some((line) => line.is_negoce), prepared_by: 'ai_gpt_led_agent', prepared_at: new Date().toISOString() };
  return ok({ action_type: 'customer_order_draft', payload, summary: pendingSummary(payload) });
}

function assertActionPayload(payload) {
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  if (!payload?.client?.id || lines.length === 0) {
    const error = new Error('Payload action incomplet : client ou lignes manquants.');
    error.status = 400;
    error.expose = true;
    throw error;
  }
  for (const [index, line] of lines.entries()) {
    if (!line.article_id || !line.article_label) {
      const error = new Error(`Payload action incomplet : article fige manquant ligne ${index + 1}.`);
      error.status = 400;
      error.expose = true;
      throw error;
    }
    if (line.article_plu && line.plu && String(line.article_plu) !== String(line.plu)) {
      const error = new Error(`Incoherence article detectee ligne ${index + 1}.`);
      error.status = 400;
      error.expose = true;
      throw error;
    }
  }
}

async function createPendingAction({ db, user, args }) {
  if (args.action_type !== 'customer_order_draft') {
    const error = new Error('Type action non autorise.');
    error.status = 400;
    error.expose = true;
    throw error;
  }
  assertActionPayload(args.payload);
  const payload = args.payload;
  const summary = pendingSummary(payload);
  console.info('[AI ACTION] confirmation display payload', { store_id: user.store_id, user_id: user.id, action_type: args.action_type, lines: payload.lines.map((line) => ({ article_id: line.article_id, plu: line.article_plu, designation: line.article_label, stock_quantity: line.stock_quantity, source: line.source, is_negoce: line.is_negoce })) });
  const result = await db.query(`
    INSERT INTO ai_pending_actions (id, store_id, user_id, action_type, status, payload, created_at)
    VALUES (gen_random_uuid(), $1, $2, $3, 'pending', $4::jsonb, NOW())
    RETURNING id, action_type, status, payload, created_at
  `, [user.store_id, user.id, args.action_type, JSON.stringify(payload)]);
  console.info('[AI ACTION] pending confirmation created', { store_id: user.store_id, user_id: user.id, action_id: result.rows[0].id, action_type: args.action_type });
  return ok({ pending_action: { id: result.rows[0].id, action_type: result.rows[0].action_type, status: result.rows[0].status, summary, payload, created_at: result.rows[0].created_at } });
}

async function getPendingAction({ db, user, args }) {
  const params = [user.store_id, user.id];
  const idFilter = args.action_id ? 'AND id = $3' : '';
  if (args.action_id) params.push(args.action_id);
  const result = await db.query(`
    SELECT id, action_type, status, payload, created_at
    FROM ai_pending_actions
    WHERE store_id = $1 AND user_id = $2 AND status = 'pending' ${idFilter}
    ORDER BY created_at DESC
    LIMIT 1
  `, params);
  const action = result.rows[0] || null;
  return ok({ pending_action: action ? { ...action, summary: pendingSummary(action.payload) } : null });
}

async function executePendingAction({ db, user, args }) {
  const pending = await getPendingAction({ db, user, args });
  const action = pending.pending_action;
  if (!action) {
    const error = new Error('Aucune action en attente a executer.');
    error.status = 404;
    error.expose = true;
    throw error;
  }
  assertActionPayload(action.payload);
  console.info('[AI ACTION] execution payload', { store_id: user.store_id, user_id: user.id, action_id: action.id, action_type: action.action_type, lines: action.payload.lines.map((line) => ({ article_id: line.article_id, plu: line.article_plu, designation: line.article_label, stock_quantity: line.stock_quantity, source: line.source, is_negoce: line.is_negoce })) });
  console.info('[AI ACTION] article consistency check', { store_id: user.store_id, user_id: user.id, action_id: action.id, ok: true, checked_lines: action.payload.lines.length });
  const result = await confirmAction({ dbPool: db, user, actionId: action.id });
  return ok({ action_result: result });
}

async function cancelPendingAction({ db, user, args }) {
  const result = await cancelAction({ db, user, actionId: args.action_id });
  return ok({ cancelled: result.action });
}

const HANDLERS = {
  search_clients: searchClients,
  search_articles: searchArticles,
  search_stock: searchStock,
  get_client_profile: getClientProfile,
  get_article_profile: getArticleProfile,
  get_stock_state: getStockState,
  search_suppliers: searchSuppliers,
  get_sales_history: getSalesHistory,
  get_sales_summary: getSalesSummary,
  get_sales_documents: getSalesDocuments,
  get_margin_analysis: getMarginAnalysis,
  get_purchase_summary: getPurchaseSummary,
  get_supplier_invoice_summary: getSupplierInvoiceSummary,
  get_clients_to_follow_up: getClientsToFollowUp,
  get_intelligence_alerts: getIntelligenceAlerts,
  prepare_email_draft: prepareEmailDraft,
  prepare_customer_order_draft: prepareCustomerOrderDraft,
  create_pending_action: createPendingAction,
  get_pending_action: getPendingAction,
  execute_pending_action: executePendingAction,
  cancel_pending_action: cancelPendingAction,
};

async function executeTool({ db, user, toolCall }) {
  const name = toolCall?.function?.name;
  const handler = HANDLERS[name];
  if (!handler) return { ok: false, tool: name, reason: 'Outil inconnu.' };
  try {
    return await handler({ db, user, args: parseArgs(toolCall?.function?.arguments), name });
  } catch (error) {
    if (OPTIONAL_DB_ERROR_CODES.has(error.code)) return { ok: false, tool: name, available: false, reason: 'Donnees non disponibles dans le schema actuel.' };
    console.error('[AI GPT LED] tool error', { store_id: user.store_id, user_id: user.id, tool: name, message: error.message, code: error.code || null });
    return { ok: false, tool: name, error: error.expose ? error.message : 'Erreur outil IA.' };
  }
}

function isConfirmationIntent(prompt) {
  return ['oui', 'ok', 'confirme', 'je confirme', 'vas y', 'valide', 'tu peux valider'].includes(normalizeText(prompt));
}

function deterministicPendingAnswer(action) {
  console.info('[AI ACTION] confirmation display payload', { action_id: action.id, action_type: action.action_type, lines: action.payload?.lines?.map((line) => ({ article_id: line.article_id, plu: line.article_plu, designation: line.article_label, stock_quantity: line.stock_quantity, source: line.source, is_negoce: line.is_negoce })) || [] });
  return { answer: action.summary || pendingSummary(action.payload), pending_action_id: action.id, pending_action: action, pending_actions: [action] };
}

async function handleTextConfirmation({ db, user }) {
  const pending = await getPendingAction({ db, user, args: {} });
  const action = pending.pending_action;
  if (!action) return { answer: 'Aucune action a confirmer.', pending_action_id: null, pending_actions: [] };
  const result = await executePendingAction({ db, user, args: { action_id: action.id } });
  return { answer: actionResultText(result.action_result), pending_action_id: null, pending_action: null, pending_actions: [], action_result: result.action_result };
}

async function runToolLoop({ db, user, prompt, conversation }) {
  const messages = [{ role: 'system', content: systemPrompt() }, ...conversation, { role: 'user', content: prompt }];
  const tools = toolDefinitions();
  let latestPendingAction = null;
  let latestActionResult = null;

  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    const assistantMessage = await generateToolCall({ messages, tools, toolChoice: 'auto' });
    if (!assistantMessage) break;
    const calls = assistantMessage.tool_calls || [];
    if (calls.length === 0) {
      if (latestPendingAction) return deterministicPendingAnswer(latestPendingAction);
      if (latestActionResult) return { answer: actionResultText(latestActionResult), pending_action_id: null, pending_action: null, pending_actions: [], action_result: latestActionResult };
      return { answer: assistantMessage.content?.trim() || "Je n'ai pas pu produire de reponse exploitable pour le moment.", pending_action_id: null, pending_action: null, pending_actions: [] };
    }

    messages.push({ role: 'assistant', content: assistantMessage.content || '', tool_calls: calls });
    for (const call of calls) {
      const result = await executeTool({ db, user, toolCall: call });
      if (call.function?.name === 'create_pending_action' && result.pending_action) latestPendingAction = result.pending_action;
      if (call.function?.name === 'execute_pending_action' && result.action_result) latestActionResult = result.action_result;
      messages.push({ role: 'tool', tool_call_id: call.id, name: call.function?.name, content: JSON.stringify(result) });
    }
    if (latestPendingAction) return deterministicPendingAnswer(latestPendingAction);
    if (latestActionResult) return { answer: actionResultText(latestActionResult), pending_action_id: null, pending_action: null, pending_actions: [], action_result: latestActionResult };
  }

  return { answer: 'Je n ai pas reussi a finaliser l action avec les outils disponibles. Peux-tu reformuler ou preciser ?', pending_action_id: null, pending_action: null, pending_actions: [] };
}

async function chat({ db, user, question, messages = [] }) {
  const prompt = normalizeQuestion(question);
  const conversation = normalizeConversation(Array.isArray(messages) ? messages : []);
  console.info('[AI GPT LED] chat received', { store_id: user.store_id, user_id: user.id, conversation_messages: conversation.length, model: process.env.AI_MODEL || 'gpt-4o-mini' });
  if (isConfirmationIntent(prompt)) return handleTextConfirmation({ db, user });
  return runToolLoop({ db, user, prompt, conversation });
}

module.exports = { chat };
