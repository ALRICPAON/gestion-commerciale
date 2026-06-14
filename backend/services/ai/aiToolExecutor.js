const { runBusinessTool } = require('./aiBusinessTools');
const { recommendSalesActions } = require('./aiRecommendationService');
const { generateSalesDrafts } = require('./aiSalesDraftService');
const { prepareCustomerOrderAction, isMissingActionTable } = require('./aiActionService');
const {
  buildPromptFromShortMemory,
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
    || text.includes('c est')
    || isStandalonePrice(question)
  ) && (recentText.includes('prepare une commande') || recentText.includes('commande'));
  if (isOrderFollowUp || options.hasCollectingActionMemory) {
    selected.unshift('prepare_customer_order');
  }

  return Array.from(new Set(selected)).slice(0, 4);
}

function buildActionPrompt(question, messages = [], collectingMemory = null) {
  const memoryPrompt = collectingMemory?.payload?.short_memory
    ? buildPromptFromShortMemory(collectingMemory.payload.short_memory, question)
    : question;

  return [
    ...messages.slice(-6).map((message) => `${message.role || 'message'}: ${message.content || ''}`),
    `user: ${memoryPrompt}`,
  ].join('\n');
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
        return prepareCustomerOrderAction({
          db,
          user,
          prompt: buildActionPrompt(question, messages, collectingMemory),
        })
          .then(async (action) => {
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
          })
          .catch(async (error) => {
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
                  question,
                  messages,
                  clarification: {
                    message: error.message,
                    details: error.details || null,
                  },
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
          });
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
