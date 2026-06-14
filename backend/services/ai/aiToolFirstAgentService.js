const { generateToolCall } = require('./aiClient');
const { normalizeConversation } = require('./aiMemoryService');
const { confirmAction, cancelAction } = require('./aiActionService');

const MAX_QUESTION_LENGTH = 2000;
const MAX_TOOL_STEPS = 8;
const OPTIONAL_DB_ERROR_CODES = new Set(['42P01', '42703', '42883']);

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

function safeJsonParse(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch (error) {
    return {};
  }
}

function toolResult(data) {
  return {
    ok: true,
    ...data,
  };
}

function unavailable(toolName, error) {
  if (OPTIONAL_DB_ERROR_CODES.has(error.code)) {
    return {
      ok: false,
      tool: toolName,
      available: false,
      reason: 'Donnees non disponibles dans le schema actuel.',
    };
  }
  throw error;
}

function formatMoney(value) {
  return `${number(value).toFixed(2)} EUR`;
}

function formatQuantity(value, unit = 'kg') {
  return `${round(value, 3)} ${unit}`;
}

function pendingActionSummary(payload) {
  const clientName = payload?.client?.name || 'client';
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  const hasNegoce = lines.some((line) => line.is_negoce);

  return [
    hasNegoce
      ? `Je peux preparer une commande brouillon avec approvisionnement pour ${clientName} :`
      : `Je vais preparer une commande brouillon pour ${clientName} :`,
    ...lines.map((line) => {
      const plu = line.article_plu ? ` - PLU ${line.article_plu}` : '';
      const source = line.source ? ` - source ${line.source}` : '';
      const stock = line.stock_quantity !== undefined
        ? ` - stock ${formatQuantity(line.stock_quantity, line.sale_unit || 'kg')}`
        : '';
      const colis = line.package_count > 0 && line.weight_per_package > 0
        ? `${line.package_count} colis x ${line.weight_per_package} kg = ${formatQuantity(line.quantity, line.sale_unit || 'kg')}`
        : formatQuantity(line.quantity, line.sale_unit || 'kg');
      return `- ${line.article_label}${plu} : ${colis} a ${formatMoney(line.unit_sale_price_ht)}/${line.sale_unit || 'kg'}${stock}${source}`;
    }),
    '',
    'Confirmer l action ?',
  ].join('\n');
}

function formatActionResult(result) {
  const sale = result?.result;
  if (!sale) return 'Action IA executee.';

  const lines = Array.isArray(sale.lines)
    ? sale.lines.map((line) => `- ${line.article_label} : ${line.sold_quantity} ${line.sale_unit}`)
    : [];

  return [
    'Commande brouillon creee.',
    `Client : ${sale.client?.name || 'client'}`,
    `Document : ${sale.sale_id}`,
    '',
    ...lines,
  ].join('\n');
}

function buildSystemPrompt() {
  return [
    'Tu es ALTA, assistant commercial pour ALTA MAREE.',
    'Architecture obligatoire : tool-first.',
    'Tu dois utiliser les outils backend pour lire les clients, articles, stocks, historiques et memoires.',
    'Le backend ne parse pas les conversations et ne devine pas les champs metier a ta place.',
    'Pour toute action sensible, tu dois preparer un payload structure puis creer une pending_action.',
    'Tu ne dois jamais dire qu une commande, un email, un achat, un BL ou une facture est cree sans execution d une pending_action confirmee.',
    'Tu ne dois jamais proposer un bouton ou une phrase de confirmation si create_pending_action n a pas renvoye une action pending.',
    'La memoire utilisateur/client/metier sert uniquement de contexte. Elle ne doit jamais forcer un article dans une nouvelle commande.',
    'Pour une commande client, l article affiche doit etre exactement l article execute : meme article_id, meme PLU, meme designation.',
    'Si plusieurs articles conviennent, demande une clarification au lieu de choisir au hasard.',
    'Reponds en francais, de facon concise et operationnelle.',
  ].join('\n');
}

function toolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'search_clients',
        description: 'Recherche des clients du magasin.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 20 },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_client_profile',
        description: 'Charge la fiche commerciale d un client.',
        parameters: {
          type: 'object',
          properties: {
            client_id: { type: 'string' },
          },
          required: ['client_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_articles',
        description: 'Recherche des articles actifs du magasin.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 20 },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_stock',
        description: 'Recherche le stock disponible, par article ou par texte.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            article_ids: {
              type: 'array',
              items: { type: 'string' },
            },
            limit: { type: 'integer', minimum: 1, maximum: 30 },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_suppliers',
        description: 'Recherche des fournisseurs du magasin.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 20 },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'analyze_client_history',
        description: 'Analyse les derniers achats d un client.',
        parameters: {
          type: 'object',
          properties: {
            client_id: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 50 },
          },
          required: ['client_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'analyze_stock',
        description: 'Resume le stock disponible.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 80 },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'analyze_sales',
        description: 'Analyse les ventes recentes.',
        parameters: {
          type: 'object',
          properties: {
            days: { type: 'integer', minimum: 1, maximum: 365 },
            limit: { type: 'integer', minimum: 1, maximum: 80 },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'analyze_margins',
        description: 'Analyse les marges recentes par article.',
        parameters: {
          type: 'object',
          properties: {
            days: { type: 'integer', minimum: 1, maximum: 365 },
            limit: { type: 'integer', minimum: 1, maximum: 80 },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_user_memory',
        description: 'Charge les habitudes utilisateur connues. Contexte seulement.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_client_memory',
        description: 'Charge les habitudes commerciales d un client. Contexte seulement.',
        parameters: {
          type: 'object',
          properties: {
            client_id: { type: 'string' },
          },
          required: ['client_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'prepare_customer_order_draft',
        description: 'Prepare une commande client brouillon avec des article_id exacts. Ne cree pas la commande.',
        parameters: {
          type: 'object',
          properties: {
            client_id: { type: 'string' },
            lines: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  article_id: { type: 'string' },
                  quantity: { type: 'number', exclusiveMinimum: 0 },
                  sale_unit: { type: 'string' },
                  unit_sale_price_ht: { type: 'number', exclusiveMinimum: 0 },
                  package_count: { type: 'number' },
                  weight_per_package: { type: 'number' },
                  allow_negoce: { type: 'boolean' },
                },
                required: ['article_id', 'quantity', 'unit_sale_price_ht'],
              },
            },
          },
          required: ['client_id', 'lines'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'prepare_supplier_order',
        description: 'Prepare une commande fournisseur. Non executable dans ce socle.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'prepare_email_draft',
        description: 'Prepare un brouillon email. Non executable dans ce socle.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'prepare_commercial_offer',
        description: 'Prepare une offre commerciale. Non executable dans ce socle.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_pending_action',
        description: 'Fige une action preparee et demande confirmation humaine.',
        parameters: {
          type: 'object',
          properties: {
            action_type: {
              type: 'string',
              enum: ['customer_order_draft'],
            },
            payload: { type: 'object' },
          },
          required: ['action_type', 'payload'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_pending_action',
        description: 'Charge une action pending par id ou la derniere action pending utilisateur.',
        parameters: {
          type: 'object',
          properties: {
            action_id: { type: 'string' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'execute_pending_action',
        description: 'Execute une pending_action deja confirmee par l utilisateur.',
        parameters: {
          type: 'object',
          properties: {
            action_id: { type: 'string' },
          },
          required: ['action_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'cancel_pending_action',
        description: 'Annule une pending_action.',
        parameters: {
          type: 'object',
          properties: {
            action_id: { type: 'string' },
          },
          required: ['action_id'],
        },
      },
    },
  ];
}

async function searchClients({ db, user, args }) {
  const query = String(args.query || '').trim();
  const limit = Math.min(number(args.limit, 10), 20);
  const result = await db.query(`
    SELECT id, code, name, tariff_level, vat_rate, is_vat_exempt, city, email
    FROM clients
    WHERE store_id = $1
      AND COALESCE(status, 'active') <> 'inactive'
      AND (
        name ILIKE $2
        OR COALESCE(code, '') ILIKE $2
        OR COALESCE(city, '') ILIKE $2
      )
    ORDER BY
      CASE WHEN name ILIKE $3 THEN 0 ELSE 1 END,
      name ASC
    LIMIT $4
  `, [user.store_id, `%${query}%`, `${query}%`, limit]);

  return toolResult({ clients: result.rows });
}

async function getClientProfile({ db, user, args }) {
  const result = await db.query(`
    SELECT id, code, name, tariff_level, vat_rate, is_vat_exempt, city, email
    FROM clients
    WHERE id = $1
      AND store_id = $2
      AND COALESCE(status, 'active') <> 'inactive'
    LIMIT 1
  `, [args.client_id, user.store_id]);

  return toolResult({ client: result.rows[0] || null });
}

async function searchArticles({ db, user, args }) {
  const query = String(args.query || '').trim();
  const limit = Math.min(number(args.limit, 10), 20);
  const result = await db.query(`
    SELECT
      a.id,
      a.plu,
      a.ean,
      a.designation,
      a.display_name,
      a.unit,
      a.sale_unit,
      a.vat_rate,
      a.sale_price_ex_vat,
      a.sale_price_level_1_ht,
      a.sale_price_level_2_ht,
      a.sale_price_level_3_ht,
      COALESCE(ss.stock_quantity, 0) AS stock_quantity,
      COALESCE(ss.pma, 0) AS pma,
      ss.next_dlc
    FROM articles a
    LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
    WHERE a.store_id = $1
      AND COALESCE(a.is_active, true) = true
      AND (
        a.designation ILIKE $2
        OR COALESCE(a.display_name, '') ILIKE $2
        OR COALESCE(a.plu, '') ILIKE $2
        OR COALESCE(a.ean, '') ILIKE $2
      )
    ORDER BY
      CASE WHEN COALESCE(ss.stock_quantity, 0) > 0 THEN 0 ELSE 1 END,
      a.designation ASC
    LIMIT $3
  `, [user.store_id, `%${query}%`, limit]);

  return toolResult({ articles: result.rows });
}

async function searchStock({ db, user, args }) {
  const limit = Math.min(number(args.limit, 15), 30);
  const articleIds = Array.isArray(args.article_ids) ? args.article_ids.filter(Boolean) : [];
  const query = String(args.query || '').trim();

  const params = [user.store_id];
  const filters = ['a.store_id = $1', 'COALESCE(a.is_active, true) = true'];
  if (articleIds.length > 0) {
    params.push(articleIds);
    filters.push(`a.id = ANY($${params.length}::uuid[])`);
  } else if (query) {
    params.push(`%${query}%`);
    filters.push(`(
      a.designation ILIKE $${params.length}
      OR COALESCE(a.display_name, '') ILIKE $${params.length}
      OR COALESCE(a.plu, '') ILIKE $${params.length}
      OR COALESCE(a.ean, '') ILIKE $${params.length}
    )`);
  }
  params.push(limit);

  const result = await db.query(`
    SELECT
      a.id AS article_id,
      a.plu,
      a.designation,
      a.display_name,
      a.unit,
      a.sale_unit,
      COALESCE(ss.stock_quantity, 0) AS stock_quantity,
      COALESCE(ss.stock_value_ex_vat, 0) AS stock_value_ex_vat,
      COALESCE(ss.pma, 0) AS pma,
      ss.next_dlc
    FROM articles a
    LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
    WHERE ${filters.join(' AND ')}
    ORDER BY COALESCE(ss.stock_quantity, 0) DESC, a.designation ASC
    LIMIT $${params.length}
  `, params);

  return toolResult({ stock: result.rows });
}

async function searchSuppliers({ db, user, args }) {
  const query = String(args.query || '').trim();
  const limit = Math.min(number(args.limit, 10), 20);
  const result = await db.query(`
    SELECT id, code, name, city, email, phone
    FROM suppliers
    WHERE store_id = $1
      AND COALESCE(status, 'active') <> 'inactive'
      AND (
        name ILIKE $2
        OR COALESCE(code, '') ILIKE $2
        OR COALESCE(city, '') ILIKE $2
      )
    ORDER BY name ASC
    LIMIT $3
  `, [user.store_id, `%${query}%`, limit]);

  return toolResult({ suppliers: result.rows });
}

async function analyzeClientHistory({ db, user, args }) {
  const limit = Math.min(number(args.limit, 20), 50);
  const result = await db.query(`
    SELECT
      sd.id AS document_id,
      sd.document_date,
      sd.document_type,
      sd.status,
      sl.article_id,
      sl.article_plu,
      sl.article_label,
      sl.sold_quantity,
      sl.sale_unit,
      sl.unit_sale_price_ht,
      sl.line_amount_ht
    FROM sales_documents sd
    JOIN sales_lines sl ON sl.sales_document_id = sd.id AND sl.store_id = sd.store_id
    WHERE sd.store_id = $1
      AND sd.client_id = $2
      AND COALESCE(sd.status, '') NOT IN ('cancelled')
    ORDER BY sd.document_date DESC, sl.article_label ASC
    LIMIT $3
  `, [user.store_id, args.client_id, limit]);

  return toolResult({ history: result.rows });
}

async function analyzeStock({ db, user, args }) {
  const limit = Math.min(number(args.limit, 40), 80);
  const result = await db.query(`
    SELECT
      a.id AS article_id,
      a.plu,
      a.designation,
      a.sale_unit,
      COALESCE(ss.stock_quantity, 0) AS stock_quantity,
      COALESCE(ss.stock_value_ex_vat, 0) AS stock_value_ex_vat,
      COALESCE(ss.pma, 0) AS pma,
      ss.next_dlc
    FROM articles a
    LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
    WHERE a.store_id = $1
      AND COALESCE(a.is_active, true) = true
      AND COALESCE(ss.stock_quantity, 0) > 0
    ORDER BY ss.stock_quantity DESC, a.designation ASC
    LIMIT $2
  `, [user.store_id, limit]);

  return toolResult({ stock: result.rows });
}

async function analyzeSales({ db, user, args }) {
  const days = Math.min(number(args.days, 30), 365);
  const limit = Math.min(number(args.limit, 40), 80);
  const result = await db.query(`
    SELECT
      sl.article_id,
      sl.article_plu,
      sl.article_label,
      SUM(sl.sold_quantity) AS sold_quantity,
      sl.sale_unit,
      SUM(sl.line_amount_ht) AS amount_ht,
      COUNT(DISTINCT sd.client_id) AS client_count
    FROM sales_lines sl
    JOIN sales_documents sd ON sd.id = sl.sales_document_id AND sd.store_id = sl.store_id
    WHERE sl.store_id = $1
      AND sd.document_date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
      AND COALESCE(sd.status, '') NOT IN ('cancelled', 'draft')
    GROUP BY sl.article_id, sl.article_plu, sl.article_label, sl.sale_unit
    ORDER BY amount_ht DESC
    LIMIT $3
  `, [user.store_id, days, limit]);

  return toolResult({ sales: result.rows });
}

async function analyzeMargins({ db, user, args }) {
  const days = Math.min(number(args.days, 30), 365);
  const limit = Math.min(number(args.limit, 40), 80);
  const result = await db.query(`
    SELECT
      sl.article_id,
      sl.article_plu,
      sl.article_label,
      SUM(sl.line_amount_ht) AS amount_ht,
      SUM(sl.line_margin_ex_vat) AS margin_ht,
      CASE
        WHEN SUM(sl.line_amount_ht) = 0 THEN 0
        ELSE ROUND((SUM(sl.line_margin_ex_vat) / SUM(sl.line_amount_ht) * 100)::numeric, 2)
      END AS margin_rate
    FROM sales_lines sl
    JOIN sales_documents sd ON sd.id = sl.sales_document_id AND sd.store_id = sl.store_id
    WHERE sl.store_id = $1
      AND sd.document_date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
      AND COALESCE(sd.status, '') NOT IN ('cancelled', 'draft')
    GROUP BY sl.article_id, sl.article_plu, sl.article_label
    ORDER BY margin_ht DESC
    LIMIT $3
  `, [user.store_id, days, limit]);

  return toolResult({ margins: result.rows });
}

async function getUserMemory({ db, user }) {
  try {
    const result = await db.query(`
      SELECT memory_key, memory_value, confidence_score, source, updated_at
      FROM ai_user_memory
      WHERE store_id = $1 AND user_id = $2
      ORDER BY updated_at DESC
      LIMIT 50
    `, [user.store_id, user.id]);

    return toolResult({ memory: result.rows, context_only: true });
  } catch (error) {
    return unavailable('get_user_memory', error);
  }
}

async function getClientMemory({ db, user, args }) {
  try {
    const result = await db.query(`
      SELECT memory_key, memory_value, confidence_score, source, updated_at
      FROM ai_client_memory
      WHERE store_id = $1 AND client_id = $2
      ORDER BY updated_at DESC
      LIMIT 50
    `, [user.store_id, args.client_id]);

    return toolResult({ memory: result.rows, context_only: true });
  } catch (error) {
    return unavailable('get_client_memory', error);
  }
}

async function validateCustomerOrderDraft({ db, user, args }) {
  const clientResult = await db.query(`
    SELECT id, code, name, tariff_level, vat_rate, is_vat_exempt, city, email
    FROM clients
    WHERE id = $1
      AND store_id = $2
      AND COALESCE(status, 'active') <> 'inactive'
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
    const quantity = number(rawLine.quantity);
    const unitSalePriceHt = number(rawLine.unit_sale_price_ht);
    if (quantity <= 0 || unitSalePriceHt <= 0) {
      const error = new Error('Quantite et prix de vente obligatoires pour chaque ligne.');
      error.status = 400;
      error.expose = true;
      throw error;
    }

    const articleResult = await db.query(`
      SELECT
        a.id,
        a.plu,
        a.designation,
        a.display_name,
        a.unit,
        a.sale_unit,
        a.vat_rate,
        COALESCE(ss.stock_quantity, 0) AS stock_quantity,
        COALESCE(ss.pma, 0) AS pma,
        (ss.article_id IS NOT NULL) AS has_stock_summary
      FROM articles a
      LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
      WHERE a.id = $1
        AND a.store_id = $2
        AND COALESCE(a.is_active, true) = true
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
    const lineAmountHt = round(quantity * unitSalePriceHt, 2);
    const lineVatAmount = round(lineAmountHt * vatRate / 100, 2);
    const lineAmountTtc = round(lineAmountHt + lineVatAmount, 2);
    const unitCost = number(article.pma);
    const stockQuantity = number(article.stock_quantity);
    const isNegoce = Boolean(rawLine.allow_negoce) || stockQuantity < quantity;
    const source = article.has_stock_summary ? 'stock' : 'articles';
    const articleLabel = article.designation;

    const frozenLine = {
      article_id: article.id,
      article_plu: article.plu,
      plu: article.plu,
      designation: article.designation,
      article_label: articleLabel,
      stock_quantity: stockQuantity,
      source,
      is_negoce: isNegoce,
      supply_status: isNegoce ? 'a_approvisionner' : 'stock',
      quantity,
      package_count: number(rawLine.package_count),
      weight_per_package: number(rawLine.weight_per_package),
      sale_unit: saleUnit,
      unit_sale_price_ht: unitSalePriceHt,
      unit_sale_price_ttc: quantity > 0 ? round(lineAmountTtc / quantity, 4) : 0,
      vat_rate: vatRate,
      line_amount_ht: lineAmountHt,
      line_vat_amount: lineVatAmount,
      line_amount_ttc: lineAmountTtc,
      unit_cost_ex_vat: unitCost,
      line_margin_ex_vat: round(lineAmountHt - quantity * unitCost, 2),
    };

    console.info('[AI ACTION] selected article frozen', {
      store_id: user.store_id,
      user_id: user.id,
      article_id: frozenLine.article_id,
      plu: frozenLine.article_plu,
      designation: frozenLine.designation,
      stock_quantity: frozenLine.stock_quantity,
      source: frozenLine.source,
      is_negoce: frozenLine.is_negoce,
    });

    lines.push(frozenLine);
  }

  return {
    client,
    lines,
    has_negoce_lines: lines.some((line) => line.is_negoce),
    prepared_by: 'ai_tool_first_agent',
    prepared_at: new Date().toISOString(),
  };
}

async function prepareCustomerOrderDraft({ db, user, args }) {
  const payload = await validateCustomerOrderDraft({ db, user, args });
  return toolResult({
    action_type: 'customer_order_draft',
    payload,
    summary: pendingActionSummary(payload),
  });
}

function assertCustomerOrderPayloadConsistency(payload) {
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
    const error = new Error('Type action non autorise dans ce socle IA.');
    error.status = 400;
    error.expose = true;
    throw error;
  }

  assertCustomerOrderPayloadConsistency(args.payload);
  const payload = args.payload;
  const summary = pendingActionSummary(payload);

  console.info('[AI ACTION] confirmation display payload', {
    store_id: user.store_id,
    user_id: user.id,
    action_type: args.action_type,
    lines: payload.lines.map((line) => ({
      article_id: line.article_id,
      plu: line.article_plu,
      designation: line.article_label,
      stock_quantity: line.stock_quantity,
      source: line.source,
      is_negoce: line.is_negoce,
    })),
  });

  const result = await db.query(`
    INSERT INTO ai_pending_actions (
      id, store_id, user_id, action_type, status, payload, created_at
    )
    VALUES (gen_random_uuid(), $1, $2, $3, 'pending', $4::jsonb, NOW())
    RETURNING id, action_type, status, payload, created_at
  `, [user.store_id, user.id, args.action_type, JSON.stringify(payload)]);

  console.info('[AI ACTION] pending confirmation created', {
    store_id: user.store_id,
    user_id: user.id,
    action_id: result.rows[0].id,
    action_type: args.action_type,
  });

  return toolResult({
    pending_action: {
      id: result.rows[0].id,
      action_type: result.rows[0].action_type,
      status: result.rows[0].status,
      summary,
      payload,
      created_at: result.rows[0].created_at,
    },
  });
}

async function getPendingAction({ db, user, args }) {
  const params = [user.store_id, user.id];
  const idFilter = args.action_id ? 'AND id = $3' : '';
  if (args.action_id) params.push(args.action_id);

  const result = await db.query(`
    SELECT id, action_type, status, payload, created_at
    FROM ai_pending_actions
    WHERE store_id = $1
      AND user_id = $2
      AND status = 'pending'
      ${idFilter}
    ORDER BY created_at DESC
    LIMIT 1
  `, params);
  const action = result.rows[0] || null;

  return toolResult({
    pending_action: action
      ? {
          ...action,
          summary: pendingActionSummary(action.payload),
        }
      : null,
  });
}

async function executePendingAction({ db, user, args }) {
  const pending = await getPendingAction({ db, user, args });
  const pendingAction = pending.pending_action;
  if (!pendingAction) {
    const error = new Error('Aucune action en attente a executer.');
    error.status = 404;
    error.expose = true;
    throw error;
  }

  assertCustomerOrderPayloadConsistency(pendingAction.payload);
  console.info('[AI ACTION] execution payload', {
    store_id: user.store_id,
    user_id: user.id,
    action_id: pendingAction.id,
    action_type: pendingAction.action_type,
    lines: pendingAction.payload.lines.map((line) => ({
      article_id: line.article_id,
      plu: line.article_plu,
      designation: line.article_label,
      stock_quantity: line.stock_quantity,
      source: line.source,
      is_negoce: line.is_negoce,
    })),
  });
  console.info('[AI ACTION] article consistency check', {
    store_id: user.store_id,
    user_id: user.id,
    action_id: pendingAction.id,
    ok: true,
    checked_lines: pendingAction.payload.lines.length,
  });

  const result = await confirmAction({
    dbPool: db,
    user,
    actionId: pendingAction.id,
  });

  return toolResult({ action_result: result });
}

async function cancelPendingAction({ db, user, args }) {
  const result = await cancelAction({
    db,
    user,
    actionId: args.action_id,
  });

  return toolResult({ cancelled: result.action });
}

async function notImplementedTool({ name }) {
  return toolResult({
    tool: name,
    available: false,
    reason: 'Outil prepare dans le contrat agent, execution non activee dans ce socle.',
  });
}

const TOOL_HANDLERS = {
  search_clients: searchClients,
  get_client_profile: getClientProfile,
  search_articles: searchArticles,
  search_stock: searchStock,
  search_suppliers: searchSuppliers,
  analyze_client_history: analyzeClientHistory,
  analyze_stock: analyzeStock,
  analyze_sales: analyzeSales,
  analyze_margins: analyzeMargins,
  get_user_memory: getUserMemory,
  get_client_memory: getClientMemory,
  prepare_customer_order_draft: prepareCustomerOrderDraft,
  prepare_supplier_order: notImplementedTool,
  prepare_email_draft: notImplementedTool,
  prepare_commercial_offer: notImplementedTool,
  create_pending_action: createPendingAction,
  get_pending_action: getPendingAction,
  execute_pending_action: executePendingAction,
  cancel_pending_action: cancelPendingAction,
};

async function executeToolCall({ db, user, toolCall }) {
  const name = toolCall?.function?.name;
  const handler = TOOL_HANDLERS[name];
  const args = safeJsonParse(toolCall?.function?.arguments);
  if (!handler) {
    return {
      ok: false,
      tool: name,
      reason: 'Outil inconnu.',
    };
  }

  try {
    return await handler({ db, user, args, name });
  } catch (error) {
    if (OPTIONAL_DB_ERROR_CODES.has(error.code)) return unavailable(name, error);
    console.error('[AI TOOL FIRST] tool error', {
      store_id: user.store_id,
      user_id: user.id,
      tool: name,
      message: error.message,
      code: error.code || null,
    });
    return {
      ok: false,
      tool: name,
      error: error.expose ? error.message : 'Erreur outil IA.',
    };
  }
}

function isConfirmationIntent(prompt) {
  const normalized = String(prompt || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  return [
    'oui',
    'ok',
    'confirme',
    'je confirme',
    'vas-y',
    'valide',
    'tu peux valider',
  ].includes(normalized);
}

async function handleTextConfirmation({ db, user }) {
  const pending = await getPendingAction({ db, user, args: {} });
  const pendingAction = pending.pending_action;
  if (!pendingAction) {
    return {
      answer: 'Aucune action a confirmer.',
      pending_action_id: null,
      pending_actions: [],
    };
  }

  const result = await executePendingAction({
    db,
    user,
    args: { action_id: pendingAction.id },
  });

  return {
    answer: formatActionResult(result.action_result),
    pending_action_id: null,
    pending_action: null,
    pending_actions: [],
    action_result: result.action_result,
  };
}

function deterministicPendingAnswer(pendingAction) {
  console.info('[AI ACTION] confirmation display payload', {
    action_id: pendingAction.id,
    action_type: pendingAction.action_type,
    lines: pendingAction.payload?.lines?.map((line) => ({
      article_id: line.article_id,
      plu: line.article_plu,
      designation: line.article_label,
      stock_quantity: line.stock_quantity,
      source: line.source,
      is_negoce: line.is_negoce,
    })) || [],
  });

  return {
    answer: pendingAction.summary || pendingActionSummary(pendingAction.payload),
    pending_action_id: pendingAction.id,
    pending_action: pendingAction,
    pending_actions: [pendingAction],
  };
}

async function runToolLoop({ db, user, prompt, conversation }) {
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...conversation,
    { role: 'user', content: prompt },
  ];
  const tools = toolDefinitions();
  let latestPendingAction = null;
  let latestActionResult = null;

  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    const assistantMessage = await generateToolCall({
      messages,
      tools,
      toolChoice: 'auto',
    });

    if (!assistantMessage) break;

    const toolCalls = assistantMessage.tool_calls || [];
    if (toolCalls.length === 0) {
      if (latestPendingAction) return deterministicPendingAnswer(latestPendingAction);
      if (latestActionResult) {
        return {
          answer: formatActionResult(latestActionResult),
          pending_action_id: null,
          pending_action: null,
          pending_actions: [],
          action_result: latestActionResult,
        };
      }
      return {
        answer: assistantMessage.content?.trim() || "Je n'ai pas pu produire de reponse exploitable pour le moment.",
        pending_action_id: null,
        pending_action: null,
        pending_actions: [],
      };
    }

    messages.push({
      role: 'assistant',
      content: assistantMessage.content || '',
      tool_calls: toolCalls,
    });

    for (const toolCall of toolCalls) {
      const result = await executeToolCall({ db, user, toolCall });
      if (toolCall.function?.name === 'create_pending_action' && result.pending_action) {
        latestPendingAction = result.pending_action;
      }
      if (toolCall.function?.name === 'execute_pending_action' && result.action_result) {
        latestActionResult = result.action_result;
      }
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolCall.function?.name,
        content: JSON.stringify(result),
      });
    }

    if (latestPendingAction) return deterministicPendingAnswer(latestPendingAction);
    if (latestActionResult) {
      return {
        answer: formatActionResult(latestActionResult),
        pending_action_id: null,
        pending_action: null,
        pending_actions: [],
        action_result: latestActionResult,
      };
    }
  }

  return {
    answer: 'Je n ai pas reussi a finaliser l action avec les outils disponibles. Peux-tu reformuler ou preciser ?',
    pending_action_id: null,
    pending_action: null,
    pending_actions: [],
  };
}

async function chat({ db, user, question, messages = [] }) {
  const prompt = normalizeQuestion(question);
  const conversation = normalizeConversation(Array.isArray(messages) ? messages : []);

  console.info('[AI TOOL FIRST] chat received', {
    store_id: user.store_id,
    user_id: user.id,
    conversation_messages: conversation.length,
    model: process.env.AI_MODEL || 'gpt-4o-mini',
  });

  if (isConfirmationIntent(prompt)) {
    return handleTextConfirmation({ db, user });
  }

  return runToolLoop({
    db,
    user,
    prompt,
    conversation,
  });
}

module.exports = {
  chat,
};
