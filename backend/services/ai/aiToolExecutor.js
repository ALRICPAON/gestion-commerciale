const { runBusinessTool } = require('./aiBusinessTools');
const { recommendSalesActions } = require('./aiRecommendationService');
const { generateSalesDrafts } = require('./aiSalesDraftService');
const { prepareCustomerOrderAction, isMissingActionTable } = require('./aiActionService');

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

function selectTools(question) {
  const text = normalizeText(question);
  const selected = TOOL_RULES
    .filter((rule) => rule.keywords.some((keyword) => text.includes(normalizeText(keyword))))
    .map((rule) => rule.name);

  return Array.from(new Set(selected)).slice(0, 4);
}

async function executeRelevantTools({ db, user, storeId, question }) {
  const toolNames = selectTools(question);

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
        return prepareCustomerOrderAction({ db, user, prompt: question })
          .then((action) => ({
            name: 'prepare_customer_order',
            available: true,
            data: {
              action,
              pending_actions: [action],
              requires_confirmation: true,
              confirmation_label: 'Confirmer l action ?',
            },
          }))
          .catch((error) => {
            if (isMissingActionTable(error)) {
              return {
                name: 'prepare_customer_order',
                available: false,
                reason: 'Table ai_pending_actions absente. Migration requise avant les actions IA confirmees.',
              };
            }
            if (error.expose && error.needs_clarification) {
              return {
                name: 'prepare_customer_order',
                available: false,
                reason: error.message,
                data: {
                  needs_clarification: true,
                  clarification_message: error.message,
                  details: error.details || null,
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
