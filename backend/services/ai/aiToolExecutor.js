const { runBusinessTool } = require('./aiBusinessTools');
const { recommendSalesActions } = require('./aiRecommendationService');
const { generateSalesDrafts } = require('./aiSalesDraftService');
const { prepareCustomerOrderAction, isMissingActionTable } = require('./aiActionService');
const {
  buildActionPayloadFromShortMemory,
  buildShortMemory,
  findLatestCollectingActionMemory,
  isMissingActionMemoryTable,
  markCollectingMemoryCompleted,
  saveCollectingActionMemory,
} = require('./aiActionMemoryService');

const TOOL_RULES = [
  {
    name: 'prepare_customer_order',
    keywords: [
      'prepare une commande',
      'preparer une commande',
      'commande brouillon',
      'commande client brouillon',
      'cree une commande brouillon',
      'creer une commande brouillon',
      'commande pour',
      'commande ',
      'a approvisionner',
      'negoce',
      'precommande',
      'on lui vend',
    ],
  },
  {
    name: 'generate_sales_drafts',
    keywords: [
      'generer email commercial',
      'genere email commercial',
      'email commercial',
      'mail commercial',
      'generer whatsapp',
      'genere whatsapp',
      'message whatsapp',
      'generer offre commerciale',
      'genere offre commerciale',
      'offre commerciale',
      'brouillon commercial',
      'brouillons commerciaux',
      'brouillon email',
      'brouillon whatsapp',
    ],
  },
  {
    name: 'recommend_sales_actions',
    keywords: [
      'quoi vendre',
      'que vendre',
      'qui relancer',
      'relancer',
      'relance',
      'proposer',
      'propose',
      'recommander',
      'recommandation',
      'recommandations',
      'action commerciale',
      'actions commerciales',
      'actions concretes',
      'argumentaire',
      'priorite de vente',
      'priorites de vente',
      'centre de surveillance',
    ],
  },
  {
    name: 'analyze_stock',
    keywords: ['stock', 'stocks', 'lot', 'lots', 'disponible', 'disponibles', 'negatif', 'negatifs', 'sans stock'],
  },
  {
    name: 'analyze_dlc',
    keywords: ['dlc', 'perime', 'perimes', 'perimee', 'perimees', 'date limite', 'expiration'],
  },
  {
    name: 'analyze_clients',
    keywords: ['client', 'clients', 'relancer', 'relance', 'inactif', 'inactifs', 'recent', 'recents'],
  },
  {
    name: 'analyze_sales',
    keywords: ['vente', 'ventes', 'ca', 'chiffre', 'commande', 'commandes', 'vendu', 'vendus'],
  },
  {
    name: 'analyze_margins',
    keywords: ['marge', 'marges', 'rentable', 'rentables', 'faible marge', 'meilleure marge', 'forte marge'],
  },
  {
    name: 'analyze_suppliers',
    keywords: ['fournisseur', 'fournisseurs', 'achat', 'achats', 'reception', 'receptions'],
  },
];

const MISSING_FIELD_LABELS = {
  client: 'le client',
  article: 'l article ou son PLU',
  article_plu: 'le PLU article',
  colis_count: 'le nombre de colis',
  weight_per_colis: 'le poids par colis',
  quantity: 'la quantite',
  unit_price_ht: 'le prix HT',
};

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isStandalonePrice(question) {
  return /^\s*\d+(?:[,.]\d{1,2})?\s*(?:eur|euros|€)?\s*$/i.test(String(question || ''));
}

function selectTools(question, messages = [], options = {}) {
  const text = normalizeText(question);
  const selected = TOOL_RULES
    .filter((rule) => rule.keywords.some((keyword) => text.includes(normalizeText(keyword))))
    .map((rule) => rule.name);

  const recentText = messages
    .slice(-6)
    .map((message) => normalizeText(message?.content || ''))
    .join('\n');
  const isOrderFollowUp = (
    text.includes('pas en stock')
    || text.includes('on lui vend')
    || text.includes('prix')
    || text.includes('plu')
    || text.includes('article')
    || text.includes('c est')
    || isStandalonePrice(question)
  ) && (recentText.includes('prepare une commande') || recentText.includes('commande'));
  if (isOrderFollowUp || options.hasCollectingActionMemory) {
    selected.unshift('prepare_customer_order');
  }

  return Array.from(new Set(selected)).slice(0, 4);
}

function formatMissingFields(shortMemory) {
  const missingFields = Array.isArray(shortMemory?.missing_fields) ? shortMemory.missing_fields : [];
  const labels = missingFields
    .filter((field) => field !== 'action_type')
    .map((field) => MISSING_FIELD_LABELS[field] || field);

  if (labels.length === 0) {
    return 'Il me manque encore des elements pour preparer la commande.';
  }

  return `Il me manque ${labels.join(', ')} pour preparer la commande.`;
}

function logResolvedAction({ storeId, user, action }) {
  console.info('[AI MEMORY TOOL] resolved client', {
    store_id: storeId,
    user_id: user.id,
    client_id: action.payload?.client?.id || null,
    client_name: action.payload?.client?.name || null,
  });
  console.info('[AI MEMORY TOOL] resolved article', {
    store_id: storeId,
    user_id: user.id,
    lines: Array.isArray(action.payload?.lines)
      ? action.payload.lines.map((line) => ({
          article_id: line.article_id,
          article_plu: line.article_plu,
          article_label: line.article_label,
          quantity: line.quantity,
          sale_unit: line.sale_unit,
        }))
      : [],
  });
  console.info('[AI MEMORY TOOL] stock status', {
    store_id: storeId,
    user_id: user.id,
    has_negoce_lines: Boolean(action.payload?.has_negoce_lines),
    lines: Array.isArray(action.payload?.lines)
      ? action.payload.lines.map((line) => ({
          article_id: line.article_id,
          quantity: line.quantity,
          stock_status: line.supply_status,
          is_negoce: line.is_negoce,
        }))
      : [],
  });
}

function logResolutionError({ storeId, user, error }) {
  console.info('[AI MEMORY TOOL] resolved client', {
    store_id: storeId,
    user_id: user.id,
    status: 'error_or_unknown',
    reason: error.details?.reason || null,
    client_id: error.details?.log?.client_id || null,
    message: error.message,
  });
  console.info('[AI MEMORY TOOL] resolved article', {
    store_id: storeId,
    user_id: user.id,
    status: 'error_or_unknown',
    reason: error.details?.reason || null,
    requested: error.details?.requested || null,
    candidates: error.details?.candidates || [],
    message: error.message,
  });
  console.info('[AI MEMORY TOOL] stock status', {
    store_id: storeId,
    user_id: user.id,
    status: 'error_or_unknown',
    reason: error.details?.reason || null,
  });
}

function mergeResolutionError(shortMemory, error) {
  const missingFields = new Set(shortMemory.missing_fields || []);
  const reason = error.details?.reason || '';

  if (reason.includes('client') && !shortMemory.client_search) {
    missingFields.add('client');
  }
  if (reason.includes('prix') && !shortMemory.unit_price_ht) {
    missingFields.add('unit_price_ht');
  }
  if (reason.includes('article') && !shortMemory.article_search && !shortMemory.article_plu) {
    missingFields.add('article');
  }

  return {
    ...shortMemory,
    status: 'collecting',
    missing_fields: Array.from(missingFields),
    resolution_error: {
      message: error.message,
      details: error.details || null,
    },
  };
}

async function executePrepareCustomerOrder({ db, user, storeId, question, messages, collectingMemory }) {
  console.info('[AI TOOL] prepare_customer_order called', {
    store_id: storeId,
    user_id: user.id,
    original_question: question,
    conversation_messages: Array.isArray(messages) ? messages.length : 0,
    has_collecting_action_memory: Boolean(collectingMemory?.id),
  });

  const shortMemory = await buildShortMemory({
    question,
    messages,
    previousMemory: collectingMemory?.payload?.short_memory || null,
  });

  console.info('[AI TOOL] prepare_customer_order args', {
    store_id: storeId,
    user_id: user.id,
    source: 'update_action_memory_tool',
    short_memory: shortMemory,
    collecting_action_memory_id: collectingMemory?.id || null,
  });

  if (shortMemory.status !== 'ready_for_confirmation') {
    let memory = null;
    try {
      memory = await saveCollectingActionMemory({ db, user, shortMemory, question });
    } catch (error) {
      if (!isMissingActionMemoryTable(error)) throw error;
    }

    return {
      name: 'prepare_customer_order',
      available: false,
      reason: formatMissingFields(shortMemory),
      data: {
        needs_clarification: true,
        clarification_message: formatMissingFields(shortMemory),
        details: {
          reason: 'action_memory_collecting',
          missing_fields: shortMemory.missing_fields,
        },
        action_memory: memory ? {
          id: memory.id,
          status: memory.status,
          short_memory: memory.payload?.short_memory || null,
        } : null,
        pending_actions: [],
      },
    };
  }

  const payload = buildActionPayloadFromShortMemory(shortMemory);
  console.info('[AI TOOL] article search started', {
    store_id: storeId,
    user_id: user.id,
    source: 'structured_action_memory',
    client_search: payload?.client_search || null,
    lines: payload?.lines || [],
  });

  try {
    const action = await prepareCustomerOrderAction({
      db,
      user,
      prompt: '',
      payload,
    });

    logResolvedAction({ storeId, user, action });
    console.info('[AI TOOL] customer detected', {
      store_id: storeId,
      user_id: user.id,
      status: 'success',
      client_id: action.payload?.client?.id || null,
      client_name: action.payload?.client?.name || null,
    });
    console.info('[AI TOOL] article search result', {
      store_id: storeId,
      user_id: user.id,
      status: 'success',
      lines: Array.isArray(action.payload?.lines)
        ? action.payload.lines.map((line) => ({
            article_id: line.article_id,
            article_plu: line.article_plu,
            article_label: line.article_label,
            quantity: line.quantity,
            sale_unit: line.sale_unit,
            stock_status: line.supply_status,
          }))
        : [],
    });
    console.info('[AI ACTION] pending confirmation created', {
      store_id: storeId,
      user_id: user.id,
      action_id: action.id,
      action_type: action.action_type,
      status: action.status,
    });

    try {
      await markCollectingMemoryCompleted({ db, user, actionId: action.id });
    } catch (error) {
      if (!isMissingActionMemoryTable(error)) throw error;
    }

    return {
      name: 'prepare_customer_order',
      available: true,
      data: {
        action,
        pending_actions: [action],
        pending_action_id: action.id,
        requires_confirmation: true,
        confirmation_label: 'Confirmer l action ?',
      },
    };
  } catch (error) {
    logResolutionError({ storeId, user, error });
    console.info('[AI TOOL] customer detected', {
      store_id: storeId,
      user_id: user.id,
      status: 'error_or_unknown',
      reason: error.details?.reason || null,
      client_id: error.details?.log?.client_id || null,
      message: error.message,
    });
    console.info('[AI TOOL] article search result', {
      store_id: storeId,
      user_id: user.id,
      status: 'error',
      reason: error.details?.reason || null,
      requested: error.details?.requested || null,
      candidates: error.details?.candidates || [],
      message: error.message,
    });

    if (isMissingActionTable(error) || isMissingActionMemoryTable(error)) {
      return {
        name: 'prepare_customer_order',
        available: false,
        reason: 'Table ai_pending_actions absente. Migration requise avant les actions IA confirmees.',
      };
    }

    if (error.expose && error.needs_clarification) {
      let memory = null;
      try {
        memory = await saveCollectingActionMemory({
          db,
          user,
          shortMemory: mergeResolutionError(shortMemory, error),
          question,
        });
      } catch (memoryError) {
        if (!isMissingActionMemoryTable(memoryError)) throw memoryError;
      }

      return {
        name: 'prepare_customer_order',
        available: false,
        reason: error.message,
        data: {
          needs_clarification: true,
          clarification_message: error.message,
          details: error.details || null,
          action_memory: memory ? {
            id: memory.id,
            status: memory.status,
            short_memory: memory.payload?.short_memory || null,
          } : null,
          pending_actions: [],
        },
      };
    }

    throw error;
  }
}

async function executeRelevantTools({ db, user, storeId, question, messages = [] }) {
  let collectingMemory = null;
  try {
    collectingMemory = await findLatestCollectingActionMemory({ db, user });
  } catch (error) {
    if (!isMissingActionMemoryTable(error)) throw error;
  }

  const toolNames = selectTools(question, messages, {
    hasCollectingActionMemory: Boolean(collectingMemory?.id),
  });

  if (toolNames.length === 0) {
    return [];
  }

  console.info('Agent IA outils lecture seule selectionnes', {
    store_id: storeId,
    tools: toolNames,
  });

  const results = await Promise.all(
    toolNames.map((toolName) => {
      if (toolName === 'prepare_customer_order') {
        return executePrepareCustomerOrder({ db, user, storeId, question, messages, collectingMemory });
      }

      if (toolName === 'generate_sales_drafts') {
        return generateSalesDrafts(db, storeId, question);
      }

      if (toolName === 'recommend_sales_actions') {
        return recommendSalesActions(db, storeId);
      }

      return runBusinessTool(toolName, { db, storeId });
    })
  );

  return results;
}

module.exports = {
  executeRelevantTools,
  selectTools,
};
