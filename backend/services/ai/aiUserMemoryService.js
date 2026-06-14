const { generateToolCall } = require('./aiClient');

const OPTIONAL_DB_ERROR_CODES = new Set(['42P01', '42703']);
const ALLOWED_MEMORY_KEYS = new Set([
  'work_habits',
  'order_preferences',
  'confirmation_preferences',
  'negoce_preferences',
  'article_habits',
  'pricing_habits',
]);

function clean(value) {
  const text = String(value || '').trim();
  return text || null;
}

function number(value, fallback = 0.5) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function confidence(value) {
  return Math.min(1, Math.max(0, number(value, 0.5)));
}

function userConversationOnly(messages = [], question = '') {
  const userMessages = [];

  if (Array.isArray(messages)) {
    messages.slice(-12).forEach((message) => {
      const content = clean(message?.content);
      if (content && message?.role === 'user') {
        userMessages.push(content);
      }
    });
  }

  const currentQuestion = clean(question);
  if (currentQuestion && userMessages[userMessages.length - 1] !== currentQuestion) {
    userMessages.push(currentQuestion);
  }

  return userMessages;
}

function userMemoryTool() {
  return {
    type: 'function',
    function: {
      name: 'update_user_memory',
      description: 'Met a jour la memoire longue utilisateur ALTA avec des habitudes de travail durables. Ne stocke que des preferences reutilisables, jamais des faits ponctuels de commande.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          memories: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                memory_key: {
                  type: 'string',
                  enum: Array.from(ALLOWED_MEMORY_KEYS),
                },
                memory_value: {
                  type: 'object',
                  additionalProperties: true,
                },
                confidence_score: {
                  type: 'number',
                  minimum: 0,
                  maximum: 1,
                },
                source: {
                  type: 'string',
                },
                should_save: {
                  type: 'boolean',
                },
              },
              required: ['memory_key', 'memory_value', 'confidence_score', 'source', 'should_save'],
            },
          },
        },
        required: ['memories'],
      },
    },
  };
}

function parseToolArguments(message) {
  const call = message?.tool_calls?.find((toolCall) => toolCall?.function?.name === 'update_user_memory');
  if (!call) return null;

  try {
    return JSON.parse(call.function.arguments || '{}');
  } catch (error) {
    console.info('[AI USER MEMORY] invalid json', { message: error.message });
    return null;
  }
}

function normalizeMemoryUpdate(update = {}) {
  const key = clean(update.memory_key);
  if (!ALLOWED_MEMORY_KEYS.has(key) || update.should_save !== true) return null;

  const value = update.memory_value && typeof update.memory_value === 'object' && !Array.isArray(update.memory_value)
    ? update.memory_value
    : null;
  if (!value || Object.keys(value).length === 0) return null;

  return {
    memory_key: key,
    memory_value: value,
    confidence_score: confidence(update.confidence_score),
    source: clean(update.source) || 'update_user_memory',
  };
}

function isMissingUserMemoryTable(error) {
  return OPTIONAL_DB_ERROR_CODES.has(error.code);
}

async function loadUserMemory({ db, user }) {
  try {
    const result = await db.query(`
      SELECT memory_key, memory_value, confidence_score, source, updated_at
      FROM ai_user_memory
      WHERE store_id = $1
        AND user_id = $2
      ORDER BY updated_at DESC
    `, [user.store_id, user.id]);

    const memory = result.rows.reduce((acc, row) => {
      acc[row.memory_key] = {
        value: row.memory_value,
        confidence_score: Number(row.confidence_score),
        source: row.source,
        updated_at: row.updated_at,
      };
      return acc;
    }, {});

    console.info('[AI USER MEMORY] loaded', {
      store_id: user.store_id,
      user_id: user.id,
      count: result.rows.length,
    });

    return memory;
  } catch (error) {
    if (isMissingUserMemoryTable(error)) {
      console.info('[AI USER MEMORY] loaded', {
        store_id: user.store_id,
        user_id: user.id,
        count: 0,
        missing_table: true,
      });
      return {};
    }

    throw error;
  }
}

async function buildUserMemoryUpdates({ question, messages = [], currentMemory = {} }) {
  const userMessages = userConversationOnly(messages, question);
  if (userMessages.length === 0) return [];

  console.info('[AI USER MEMORY] update requested', {
    user_messages_count: userMessages.length,
    current_memory_keys: Object.keys(currentMemory),
  });

  const toolMessage = await generateToolCall({
    messages: [
      {
        role: 'system',
        content: [
          'Tu apprends les habitudes de travail durables de l utilisateur ALTA.',
          'Tu dois appeler update_user_memory.',
          'N utilise que les messages utilisateur comme source.',
          'Ne stocke pas les donnees ponctuelles d une commande precise : client du jour, quantite du jour, prix du jour.',
          'Stocke seulement ce qui ressemble a une preference reutilisable : colis x kg, negoce frequent, confirmation avant action, commande brouillon par defaut.',
          'Si rien de durable n est detectable, retourne memories: [].',
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify({
          current_memory: currentMemory,
          user_messages: userMessages,
        }),
      },
    ],
    tools: [userMemoryTool()],
    toolChoice: {
      type: 'function',
      function: { name: 'update_user_memory' },
    },
  });

  const payload = parseToolArguments(toolMessage) || {};
  const updates = Array.isArray(payload.memories)
    ? payload.memories.map(normalizeMemoryUpdate).filter(Boolean)
    : [];

  console.info('[AI USER MEMORY] update requested', {
    updates_count: updates.length,
    memory_keys: updates.map((update) => update.memory_key),
  });

  return updates;
}

async function saveUserMemoryUpdates({ db, user, updates = [] }) {
  if (!updates.length) return [];

  const saved = [];
  for (const update of updates) {
    const result = await db.query(`
      INSERT INTO ai_user_memory (
        id, store_id, user_id, memory_key, memory_value, confidence_score, source, created_at, updated_at
      )
      VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb, $5, $6, NOW(), NOW())
      ON CONFLICT (store_id, user_id, memory_key)
      DO UPDATE SET
        memory_value = ai_user_memory.memory_value || EXCLUDED.memory_value,
        confidence_score = GREATEST(ai_user_memory.confidence_score, EXCLUDED.confidence_score),
        source = EXCLUDED.source,
        updated_at = NOW()
      RETURNING memory_key, memory_value, confidence_score, source, updated_at
    `, [
      user.store_id,
      user.id,
      update.memory_key,
      JSON.stringify(update.memory_value),
      update.confidence_score,
      update.source,
    ]);

    if (result.rows[0]) saved.push(result.rows[0]);
  }

  console.info('[AI USER MEMORY] saved', {
    store_id: user.store_id,
    user_id: user.id,
    count: saved.length,
    memory_keys: saved.map((row) => row.memory_key),
  });

  return saved;
}

async function updateUserMemory({ db, user, question, messages = [] }) {
  try {
    const currentMemory = await loadUserMemory({ db, user });
    const updates = await buildUserMemoryUpdates({ question, messages, currentMemory });
    return saveUserMemoryUpdates({ db, user, updates });
  } catch (error) {
    if (isMissingUserMemoryTable(error)) return [];
    throw error;
  }
}

module.exports = {
  isMissingUserMemoryTable,
  loadUserMemory,
  updateUserMemory,
};
