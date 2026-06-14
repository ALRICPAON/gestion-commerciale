const OPTIONAL_DB_ERROR_CODES = new Set(['42P01', '42703']);
const FORBIDDEN_ENTITY_TEXT = [
  'finaliser la commande',
  'il me faut',
  'je n ai pas assez',
  'je n\'ai pas assez',
  'peux tu',
  'peux-tu',
  'preciser',
  'préciser',
  'manquant',
  'manque',
  'commande brouillon',
];

function clean(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function number(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isConfirmationIntent(question) {
  const text = normalizeText(question)
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return [
    'je confirme',
    'confirme',
    'oui je confirme',
    'ok je confirme',
    'c est confirme',
    'valide',
    'je valide',
  ].includes(text);
}

function isStandalonePrice(question) {
  return /^\s*\d+(?:[,.]\d{1,2})?\s*(?:eur|euros|€)?\s*$/i.test(String(question || ''));
}

function extractPrice(question) {
  const text = String(question || '');
  const explicit = text.match(/(?:\bprix|\ba|à|\bvendu|\bvend|\bon lui vend)\s*(\d+(?:[,.]\d{1,2})?)/i);
  if (explicit) return number(explicit[1]);
  if (isStandalonePrice(text)) return number(text);

  const trailing = text.match(/\s(\d+[,.]\d{1,2})\s*(?:€|eur|euros)?\s*$/i);
  return trailing ? number(trailing[1]) : 0;
}

function stripTrailingPrice(value) {
  return clean(String(value || '')
    .replace(/\s+(?:prix|a|à|vendu|vend|on lui vend)\s*\d+(?:[,.]\d{1,2})?\s*(?:€|eur|euros)?\s*$/i, '')
    .replace(/\s+\d+[,.]\d{1,2}\s*(?:€|eur|euros)?\s*$/i, ''));
}

function hasForbiddenEntityText(value) {
  const text = normalizeText(value);
  return FORBIDDEN_ENTITY_TEXT.some((forbidden) => text.includes(normalizeText(forbidden)));
}

function sanitizeEntity(value) {
  const text = clean(value);
  if (!text || hasForbiddenEntityText(text)) return null;
  return text;
}

function collectUserText(messages = [], question = '') {
  const userMessages = [];
  const ignoredAssistantMessages = [];

  if (Array.isArray(messages)) {
    messages.slice(-8).forEach((message) => {
      const content = clean(message?.content);
      if (!content) return;

      if (message?.role === 'user') {
        userMessages.push(content);
        return;
      }

      if (message?.role === 'assistant') {
        ignoredAssistantMessages.push(content);
      }
    });
  }

  const cleanQuestion = clean(question);
  if (cleanQuestion && userMessages[userMessages.length - 1] !== cleanQuestion) {
    userMessages.push(cleanQuestion);
  }

  if (ignoredAssistantMessages.length > 0) {
    console.info('[AI MEMORY] ignored assistant content', {
      ignored_count: ignoredAssistantMessages.length,
      samples: ignoredAssistantMessages.slice(-3),
    });
  }

  return userMessages.join('\n');
}

function quantityPattern() {
  return '(?:\\d+(?:[,.]\\d+)?\\s*x\\s*)?\\d+(?:[,.]\\d+)?\\s*(?:kg|kilo|kilos|piece|pieces|unite|unites)?';
}

function extractOrderParts(text) {
  const segment = clean(text) || '';
  const qty = quantityPattern();
  const patterns = [
    new RegExp(`\\b(?:prepare|preparer|prépare|préparer)\\s+(?:une\\s+)?commande\\s+(?:brouillon\\s+)?pour\\s+(.+?)\\s+(?:avec|:)\\s+(.+?)(?=\\n|$)`, 'i'),
    new RegExp(`\\bcommande\\s+(?:brouillon\\s+)?(?:pour\\s+)?(.+?)\\s+(?:avec|:)\\s+(.+?)(?=\\n|$)`, 'i'),
    new RegExp(`\\bpour\\s+(.+?)\\s+(?:avec|:)\\s+(.+?)(?=\\n|$)`, 'i'),
    new RegExp(`\\bcommande\\s+(?:brouillon\\s+)?(?:pour\\s+)?(.+?)\\s+(${qty}\\s+.+?)(?=\\n|$)`, 'i'),
    new RegExp(`\\bpour\\s+(.+?)\\s+(${qty}\\s+.+?)(?=\\n|$)`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = segment.match(pattern);
    const clientSearch = sanitizeEntity(match?.[1]);
    const itemsPart = sanitizeEntity(match?.[2]);
    if (clientSearch && itemsPart) {
      return {
        client_search: clientSearch,
        items_part: itemsPart,
      };
    }
  }

  return null;
}

function extractPlu(value) {
  const text = String(value || '');
  const explicit = text.match(/\bplu\s*[:#-]?\s*([a-z0-9-]+)/i);
  if (explicit) return clean(explicit[1]);

  const referenceOnly = text.match(/^\s*([a-z0-9-]{3,})\s*$/i);
  return referenceOnly ? clean(referenceOnly[1]) : null;
}

function normalizeArticleSearch(value, plu) {
  const withoutPrice = stripTrailingPrice(value);
  const withoutPluLabel = clean(String(withoutPrice || '').replace(/\bplu\s*[:#-]?\s*/i, ''));
  const articleSearch = sanitizeEntity(withoutPluLabel);
  return articleSearch || plu || null;
}

function parseProductLines(itemsPart, fallbackPrice = 0) {
  return String(itemsPart || '')
    .split(/\s+et\s+|,|;/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const linePrice = extractPrice(part) || fallbackPrice || null;
      const packageMatch = part.match(/(\d+(?:[,.]\d+)?)\s*x\s*(\d+(?:[,.]\d+)?)\s*kg\s+(?:de\s+|d')?(.+)/i);
      if (packageMatch) {
        const plu = extractPlu(stripTrailingPrice(packageMatch[3]));
        const articleSearch = normalizeArticleSearch(packageMatch[3], plu);
        if (!articleSearch) return null;

        return {
          article_search: articleSearch,
          plu,
          quantity: Number((number(packageMatch[1]) * number(packageMatch[2])).toFixed(3)),
          package_count: number(packageMatch[1]),
          weight_per_package: number(packageMatch[2]),
          unit: 'kg',
          price: linePrice,
        };
      }

      const match = part.match(/(\d+(?:[,.]\d+)?)\s*(kg|kilo|kilos|piece|pieces|unite|unites)?\s+(?:de\s+|d')?(.+)/i);
      if (!match) return null;

      const plu = extractPlu(stripTrailingPrice(match[3]));
      const articleSearch = normalizeArticleSearch(match[3], plu);
      if (!articleSearch) return null;

      return {
        article_search: articleSearch,
        plu,
        quantity: number(match[1]),
        unit: ['piece', 'pieces', 'unite', 'unites'].includes(normalizeText(match[2])) ? 'unite' : 'kg',
        price: linePrice,
      };
    })
    .filter((line) => line && line.quantity > 0 && line.article_search);
}

function mergeProducts(previousProducts, products, standalonePrice) {
  if (products.length > 0) return products;

  return previousProducts
    .map((product) => ({
      ...product,
      article_search: sanitizeEntity(product.article_search),
      plu: sanitizeEntity(product.plu),
      price: product.price || standalonePrice || null,
    }))
    .filter((product) => product.article_search && product.quantity > 0);
}

function buildShortMemory({ question, messages = [], previousMemory = null, clarification = null }) {
  const userText = collectUserText(messages, question);
  const orderParts = extractOrderParts(userText);
  const standalonePrice = extractPrice(question);
  const previousProducts = Array.isArray(previousMemory?.produits) ? previousMemory.produits : [];
  const parsedProducts = orderParts ? parseProductLines(orderParts.items_part, standalonePrice) : [];
  const products = mergeProducts(previousProducts, parsedProducts, standalonePrice);
  const client = orderParts?.client_search
    ? { search: orderParts.client_search }
    : previousMemory?.client?.search && sanitizeEntity(previousMemory.client.search)
      ? { search: sanitizeEntity(previousMemory.client.search) }
      : null;

  const missingFields = new Set(Array.isArray(previousMemory?.missing_fields) ? previousMemory.missing_fields : []);
  const reason = clarification?.details?.reason || '';
  if (reason.includes('prix')) missingFields.add('prix');
  if (reason.includes('client')) missingFields.add('client');
  if (reason.includes('article')) missingFields.add('produits');

  if (!client?.search) missingFields.add('client');
  if (products.length === 0) missingFields.add('produits');
  if (products.some((product) => !product.quantity || product.quantity <= 0)) missingFields.add('quantites');
  if (products.some((product) => !product.price || product.price <= 0)) missingFields.add('prix');

  if (standalonePrice > 0 && products.length > 0) missingFields.delete('prix');
  if (client?.search) missingFields.delete('client');
  if (products.length > 0) missingFields.delete('produits');
  if (products.every((product) => product.quantity > 0)) missingFields.delete('quantites');
  if (products.every((product) => product.price > 0)) missingFields.delete('prix');

  const shortMemory = {
    derniere_action_pending: null,
    client,
    produits: products,
    quantites: products.map((product) => ({
      article_search: product.article_search,
      plu: product.plu || null,
      quantity: product.quantity,
      unit: product.unit,
    })),
    prix: products.map((product) => ({
      article_search: product.article_search,
      plu: product.plu || null,
      price: product.price || null,
    })),
    statut: 'collecting',
    missing_fields: Array.from(missingFields),
    clarification: clarification?.message || null,
    updated_at: new Date().toISOString(),
  };

  console.info('[AI MEMORY] extracted entities', {
    client: shortMemory.client,
    produits: shortMemory.produits,
    quantites: shortMemory.quantites,
    prix: shortMemory.prix,
    source: 'user_messages_only',
  });
  console.info('[AI MEMORY] collecting state', {
    statut: shortMemory.statut,
    missing_fields: shortMemory.missing_fields,
    ready_for_pending_action: Boolean(
      shortMemory.client?.search
        && shortMemory.produits.length > 0
        && shortMemory.produits.every((product) => product.quantity > 0 && product.price > 0)
    ),
  });

  return shortMemory;
}

function buildPromptFromShortMemory(memory, question) {
  const shortMemory = memory?.short_memory || memory;
  const clientSearch = shortMemory?.client?.search;
  const products = Array.isArray(shortMemory?.produits) ? shortMemory.produits : [];
  const standalonePrice = extractPrice(question);

  if (!clientSearch || products.length === 0) {
    return question;
  }

  const lines = products.map((product) => {
    const quantity = product.quantity || 0;
    const unit = product.unit || 'kg';
    const price = product.price || standalonePrice || 0;
    const articleSearch = product.plu || product.article_search;
    const packageText = product.package_count > 0 && product.weight_per_package > 0
      ? `${product.package_count}x${product.weight_per_package}kg de ${articleSearch}`
      : `${quantity}${unit} de ${articleSearch}`;
    return price > 0 ? `${packageText} prix ${price}` : packageText;
  });

  return `Prepare une commande pour ${clientSearch} avec ${lines.join(' et ')}`;
}

async function findLatestCollectingActionMemory({ db, user }) {
  const result = await db.query(`
    SELECT id, payload, created_at
    FROM ai_pending_actions
    WHERE store_id = $1
      AND user_id = $2
      AND action_type = 'customer_order_draft'
      AND status = 'collecting'
    ORDER BY created_at DESC
    LIMIT 1
  `, [user.store_id, user.id]);

  return result.rows[0] || null;
}

async function saveCollectingActionMemory({ db, user, question, messages = [], clarification = null }) {
  const existing = await findLatestCollectingActionMemory({ db, user });
  const previousMemory = existing?.payload?.short_memory || null;
  const shortMemory = buildShortMemory({ question, messages, previousMemory, clarification });
  const payload = {
    short_memory: shortMemory,
    source: 'ai_agent_chat',
    last_question: clean(question),
  };

  if (existing?.id) {
    const updated = await db.query(`
      UPDATE ai_pending_actions
      SET payload = $4::jsonb,
          result = NULL
      WHERE id = $1 AND store_id = $2 AND user_id = $3 AND status = 'collecting'
      RETURNING id, action_type, status, payload, created_at
    `, [existing.id, user.store_id, user.id, JSON.stringify(payload)]);
    return updated.rows[0] || null;
  }

  const inserted = await db.query(`
    INSERT INTO ai_pending_actions (
      id, store_id, user_id, action_type, status, payload, created_at
    )
    VALUES (gen_random_uuid(), $1, $2, 'customer_order_draft', 'collecting', $3::jsonb, NOW())
    RETURNING id, action_type, status, payload, created_at
  `, [user.store_id, user.id, JSON.stringify(payload)]);

  return inserted.rows[0] || null;
}

async function markCollectingMemoryCompleted({ db, user, actionId }) {
  await db.query(`
    UPDATE ai_pending_actions
    SET status = 'cancelled',
        cancelled_at = NOW(),
        result = $3::jsonb
    WHERE store_id = $1
      AND user_id = $2
      AND action_type = 'customer_order_draft'
      AND status = 'collecting'
  `, [user.store_id, user.id, JSON.stringify({ completed_by_action_id: actionId })]);
}

async function findPendingActionsForUser({ db, user, limit = 2 }) {
  const result = await db.query(`
    SELECT id, action_type, status, payload, created_at
    FROM ai_pending_actions
    WHERE store_id = $1
      AND user_id = $2
      AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT $3
  `, [user.store_id, user.id, limit]);

  return result.rows;
}

function isMissingActionMemoryTable(error) {
  return OPTIONAL_DB_ERROR_CODES.has(error.code);
}

module.exports = {
  buildPromptFromShortMemory,
  buildShortMemory,
  findLatestCollectingActionMemory,
  findPendingActionsForUser,
  isConfirmationIntent,
  isMissingActionMemoryTable,
  markCollectingMemoryCompleted,
  saveCollectingActionMemory,
};
