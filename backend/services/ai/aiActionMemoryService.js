const OPTIONAL_DB_ERROR_CODES = new Set(['42P01', '42703']);

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
  return 0;
}

function extractOrderParts(text) {
  const segment = clean(text) || '';
  const patterns = [
    /\b(?:prepare|preparer|prépare|préparer)\s+(?:une\s+)?commande\s+(?:brouillon\s+)?pour\s+(.+?)\s+(?:avec|:)\s+(.+?)(?=\n|$)/i,
    /\bcommande\s+(?:brouillon\s+)?(?:pour\s+)?(.+?)\s+(?:avec|:)\s+(.+?)(?=\n|$)/i,
    /\bpour\s+(.+?)\s+(?:avec|:)\s+(.+?)(?=\n|$)/i,
  ];

  for (const pattern of patterns) {
    const match = segment.match(pattern);
    if (match?.[1] && match?.[2]) {
      return {
        client_search: clean(match[1]),
        items_part: clean(match[2]),
      };
    }
  }

  return null;
}

function parseProductLines(itemsPart, fallbackPrice = 0) {
  return String(itemsPart || '')
    .split(/\s+et\s+|,|;/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const packageMatch = part.match(/(\d+(?:[,.]\d+)?)\s*x\s*(\d+(?:[,.]\d+)?)\s*kg\s+(?:de\s+|d')?(.+)/i);
      if (packageMatch) {
        return {
          article_search: clean(packageMatch[3]),
          quantity: Number((number(packageMatch[1]) * number(packageMatch[2])).toFixed(3)),
          package_count: number(packageMatch[1]),
          weight_per_package: number(packageMatch[2]),
          unit: 'kg',
          price: fallbackPrice || extractPrice(part) || null,
        };
      }

      const match = part.match(/(\d+(?:[,.]\d+)?)\s*(kg|kilo|kilos|piece|pieces|unite|unites)?\s+(?:de\s+|d')?(.+)/i);
      if (!match) return null;

      return {
        article_search: clean(match[3]),
        quantity: number(match[1]),
        unit: ['piece', 'pieces', 'unite', 'unites'].includes(normalizeText(match[2])) ? 'unite' : 'kg',
        price: fallbackPrice || extractPrice(part) || null,
      };
    })
    .filter((line) => line?.article_search && line.quantity > 0);
}

function buildShortMemory({ question, messages = [], previousMemory = null, clarification = null }) {
  const recentText = [
    ...(Array.isArray(messages) ? messages.slice(-8).map((message) => message?.content || '') : []),
    question,
  ].join('\n');
  const orderParts = extractOrderParts(recentText);
  const standalonePrice = extractPrice(question);
  const previousProducts = Array.isArray(previousMemory?.produits) ? previousMemory.produits : [];
  const products = orderParts
    ? parseProductLines(orderParts.items_part, standalonePrice)
    : previousProducts.map((product) => ({
        ...product,
        price: product.price || standalonePrice || null,
      }));

  const missingFields = new Set(Array.isArray(previousMemory?.missing_fields) ? previousMemory.missing_fields : []);
  const reason = clarification?.details?.reason || '';
  if (reason.includes('prix')) missingFields.add('prix');
  if (reason.includes('client')) missingFields.add('client');
  if (reason.includes('article')) missingFields.add('produits');

  if (standalonePrice > 0) missingFields.delete('prix');
  if (orderParts?.client_search) missingFields.delete('client');
  if (products.length > 0) missingFields.delete('produits');

  return {
    derniere_action_pending: null,
    client: orderParts?.client_search
      ? { search: orderParts.client_search }
      : previousMemory?.client || null,
    produits: products,
    quantites: products.map((product) => ({
      article_search: product.article_search,
      quantity: product.quantity,
      unit: product.unit,
    })),
    prix: products.map((product) => ({
      article_search: product.article_search,
      price: product.price || null,
    })),
    statut: missingFields.size > 0 ? 'collecting' : 'collecting',
    missing_fields: Array.from(missingFields),
    clarification: clarification?.message || null,
    updated_at: new Date().toISOString(),
  };
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
    const packageText = product.package_count > 0 && product.weight_per_package > 0
      ? `${product.package_count}x${product.weight_per_package}kg de ${product.article_search}`
      : `${quantity}${unit} de ${product.article_search}`;
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
  findLatestCollectingActionMemory,
  findPendingActionsForUser,
  isConfirmationIntent,
  isMissingActionMemoryTable,
  markCollectingMemoryCompleted,
  saveCollectingActionMemory,
};
