const { generateToolCall } = require('./aiClient');

const OPTIONAL_DB_ERROR_CODES = new Set(['42P01', '42703']);
const ALLOWED_STATUSES = new Set(['collecting', 'ready_for_confirmation']);
const ALLOWED_MISSING_FIELDS = new Set([
  'client',
  'article',
  'article_plu',
  'colis_count',
  'weight_per_colis',
  'quantity',
  'unit_price_ht',
]);

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

function userConversationOnly(messages = [], question = '') {
  const userMessages = [];
  const ignoredAssistantMessages = [];

  if (Array.isArray(messages)) {
    messages.slice(-10).forEach((message) => {
      const content = clean(message?.content);
      if (!content) return;
      if (message?.role === 'user') {
        userMessages.push(content);
      } else if (message?.role === 'assistant') {
        ignoredAssistantMessages.push(content);
      }
    });
  }

  const currentQuestion = clean(question);
  if (currentQuestion && userMessages[userMessages.length - 1] !== currentQuestion) {
    userMessages.push(currentQuestion);
  }

  if (ignoredAssistantMessages.length > 0) {
    console.info('[AI MEMORY] ignored assistant content', {
      ignored_count: ignoredAssistantMessages.length,
      samples: ignoredAssistantMessages.slice(-3),
    });
  }

  return userMessages;
}

function actionMemoryTool() {
  return {
    type: 'function',
    function: {
      name: 'update_action_memory',
      description: 'Met a jour la memoire courte structuree pour une action metier de commande client brouillon. Utilise uniquement les messages utilisateur. Ne copie jamais une phrase assistant dans un champ metier.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action_type: {
            type: 'string',
            enum: ['customer_order_draft'],
          },
          client_search: {
            type: ['string', 'null'],
            description: 'Nom/code client demande par l utilisateur, par exemple Royale Maree.',
          },
          article_search: {
            type: ['string', 'null'],
            description: 'Designation article demandee par l utilisateur, par exemple langoustine 20/30.',
          },
          article_plu: {
            type: ['string', 'null'],
            description: 'PLU/reference article si donne par l utilisateur, par exemple 3135.',
          },
          colis_count: {
            type: ['number', 'null'],
            description: 'Nombre de colis, par exemple 5 dans 5x3kg.',
          },
          weight_per_colis: {
            type: ['number', 'null'],
            description: 'Poids par colis en kg, par exemple 3 dans 5x3kg.',
          },
          quantity: {
            type: ['number', 'null'],
            description: 'Quantite totale si elle est fournie directement.',
          },
          unit_price_ht: {
            type: ['number', 'null'],
            description: 'Prix de vente HT par unite/kg.',
          },
          missing_fields: {
            type: 'array',
            items: {
              type: 'string',
              enum: Array.from(ALLOWED_MISSING_FIELDS),
            },
          },
          status: {
            type: 'string',
            enum: Array.from(ALLOWED_STATUSES),
          },
        },
        required: [
          'action_type',
          'client_search',
          'article_search',
          'article_plu',
          'colis_count',
          'weight_per_colis',
          'quantity',
          'unit_price_ht',
          'missing_fields',
          'status',
        ],
      },
    },
  };
}

function parseToolArguments(message) {
  const call = message?.tool_calls?.find((toolCall) => toolCall?.function?.name === 'update_action_memory');
  if (!call) return null;

  try {
    return JSON.parse(call.function.arguments || '{}');
  } catch (error) {
    console.info('[AI MEMORY TOOL] invalid json', { message: error.message });
    return null;
  }
}

function validatedString(value) {
  return clean(value);
}

function validatedPositiveNumber(value) {
  const parsed = number(value, 0);
  return parsed > 0 ? parsed : null;
}

function filterMissingFields(missingFields, validated) {
  const hasArticleSearch = Boolean(validated.article_search || validated.article_plu);
  const hasQuantity = Boolean(validated.quantity);

  return missingFields.filter((field) => {
    if (field === 'action_type') return !validated.action_type;
    if (field === 'client') return !validated.client_search;
    if (field === 'article' || field === 'article_plu') return !hasArticleSearch;
    if (field === 'quantity' || field === 'colis_count' || field === 'weight_per_colis') return !hasQuantity;
    if (field === 'unit_price_ht') return !validated.unit_price_ht;
    return true;
  });
}

function validateMemoryPayload(payload = {}) {
  const actionType = payload.action_type === 'customer_order_draft'
    ? 'customer_order_draft'
    : null;
  const colisCount = validatedPositiveNumber(payload.colis_count);
  const weightPerColis = validatedPositiveNumber(payload.weight_per_colis);
  const directQuantity = validatedPositiveNumber(payload.quantity);
  const quantity = colisCount && weightPerColis
    ? Number((colisCount * weightPerColis).toFixed(3))
    : directQuantity;
  const status = ALLOWED_STATUSES.has(payload.status) ? payload.status : 'collecting';
  const missingFields = Array.isArray(payload.missing_fields)
    ? payload.missing_fields.filter((field) => ALLOWED_MISSING_FIELDS.has(field))
    : [];

  const validated = {
    action_type: actionType,
    client_search: validatedString(payload.client_search),
    article_search: validatedString(payload.article_search),
    article_plu: validatedString(payload.article_plu),
    colis_count: colisCount,
    weight_per_colis: weightPerColis,
    quantity,
    unit_price_ht: validatedPositiveNumber(payload.unit_price_ht),
    missing_fields: [],
    status,
  };

  validated.missing_fields = filterMissingFields(missingFields, validated);

  if (!validated.action_type) validated.missing_fields.push('action_type');
  if (!validated.client_search) validated.missing_fields.push('client');
  if (!validated.article_search && !validated.article_plu) validated.missing_fields.push('article');
  if (!validated.quantity) validated.missing_fields.push('quantity');
  if (!validated.unit_price_ht) validated.missing_fields.push('unit_price_ht');

  validated.missing_fields = Array.from(new Set(validated.missing_fields));
  if (validated.missing_fields.length > 0) {
    validated.status = 'collecting';
  }

  console.info('[AI MEMORY TOOL] validated fields', validated);

  return validated;
}

function mergeMemory(previousMemory = null, update = {}) {
  const previous = previousMemory || {};
  const merged = {
    action_type: update.action_type || previous.action_type || 'customer_order_draft',
    client_search: update.client_search || previous.client_search || null,
    article_search: update.article_search || previous.article_search || null,
    article_plu: update.article_plu || previous.article_plu || null,
    colis_count: update.colis_count || previous.colis_count || null,
    weight_per_colis: update.weight_per_colis || previous.weight_per_colis || null,
    quantity: update.quantity || previous.quantity || null,
    unit_price_ht: update.unit_price_ht || previous.unit_price_ht || null,
    missing_fields: update.missing_fields,
    status: update.status,
    updated_at: new Date().toISOString(),
  };

  return validateMemoryPayload(merged);
}

async function buildShortMemory({ question, messages = [], previousMemory = null }) {
  const userMessages = userConversationOnly(messages, question);
  const promptMessages = [
    {
      role: 'system',
      content: [
        'Tu extrais uniquement des donnees structurees depuis les messages utilisateur.',
        'Tu dois appeler update_action_memory.',
        'N utilise jamais le contenu assistant comme source de client, article, prix ou quantite.',
        'Ne devine pas. Si un champ manque, mets null et ajoute le champ dans missing_fields.',
        'Si client + article ou PLU + quantite + prix sont connus, mets status ready_for_confirmation. Sinon mets collecting.',
        'Pour 5x3kg, colis_count=5, weight_per_colis=3, quantity=15.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        previous_memory: previousMemory || null,
        user_messages: userMessages,
      }),
    },
  ];

  console.info('[AI MEMORY TOOL] called', {
    user_messages_count: userMessages.length,
    has_previous_memory: Boolean(previousMemory),
  });

  const toolMessage = await generateToolCall({
    messages: promptMessages,
    tools: [actionMemoryTool()],
    toolChoice: {
      type: 'function',
      function: { name: 'update_action_memory' },
    },
  });
  const payload = parseToolArguments(toolMessage) || {};

  console.info('[AI MEMORY TOOL] payload', payload);

  const validated = validateMemoryPayload(payload);
  const shortMemory = mergeMemory(previousMemory, validated);

  console.info('[AI MEMORY] extracted entities', {
    client_search: shortMemory.client_search,
    article_search: shortMemory.article_search,
    article_plu: shortMemory.article_plu,
    colis_count: shortMemory.colis_count,
    weight_per_colis: shortMemory.weight_per_colis,
    quantity: shortMemory.quantity,
    unit_price_ht: shortMemory.unit_price_ht,
    source: 'update_action_memory_tool',
  });
  console.info('[AI MEMORY] collecting state', {
    status: shortMemory.status,
    missing_fields: shortMemory.missing_fields,
    ready_for_pending_action: shortMemory.status === 'ready_for_confirmation',
  });

  return shortMemory;
}

function buildPromptFromShortMemory(memory) {
  const shortMemory = memory?.short_memory || memory;
  if (!shortMemory?.client_search || (!shortMemory.article_search && !shortMemory.article_plu) || !shortMemory.quantity) {
    return null;
  }

  const articleSearch = shortMemory.article_plu || shortMemory.article_search;
  const quantityText = shortMemory.colis_count && shortMemory.weight_per_colis
    ? `${shortMemory.colis_count}x${shortMemory.weight_per_colis}kg de ${articleSearch}`
    : `${shortMemory.quantity}kg de ${articleSearch}`;
  const priceText = shortMemory.unit_price_ht ? ` prix ${shortMemory.unit_price_ht}` : '';

  return `Prepare une commande pour ${shortMemory.client_search} avec ${quantityText}${priceText}`;
}

function buildActionPayloadFromShortMemory(memory) {
  const shortMemory = memory?.short_memory || memory;
  if (!shortMemory || shortMemory.status !== 'ready_for_confirmation') return null;

  return {
    client_search: shortMemory.client_search,
    lines: [
      {
        quantity: shortMemory.quantity,
        package_count: shortMemory.colis_count || 0,
        weight_per_package: shortMemory.weight_per_colis || 0,
        unit: 'kg',
        article_search: shortMemory.article_plu || shortMemory.article_search,
        unit_sale_price_ht: shortMemory.unit_price_ht,
        allow_negoce: true,
      },
    ],
  };
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

async function saveCollectingActionMemory({ db, user, shortMemory, question }) {
  const existing = await findLatestCollectingActionMemory({ db, user });
  const payload = {
    short_memory: shortMemory,
    source: 'update_action_memory_tool',
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
  buildActionPayloadFromShortMemory,
  buildPromptFromShortMemory,
  buildShortMemory,
  findLatestCollectingActionMemory,
  findPendingActionsForUser,
  isConfirmationIntent,
  isMissingActionMemoryTable,
  markCollectingMemoryCompleted,
  saveCollectingActionMemory,
};
