const { runBusinessTool } = require('./aiBusinessTools');

const TOOL_RULES = [
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

async function executeRelevantTools({ db, storeId, question }) {
  const toolNames = selectTools(question);

  if (toolNames.length === 0) {
    return [];
  }

  console.info('Agent IA outils lecture seule selectionnes', {
    store_id: storeId,
    tools: toolNames,
  });

  const results = await Promise.all(
    toolNames.map((toolName) => runBusinessTool(toolName, { db, storeId }))
  );

  return results;
}

module.exports = {
  executeRelevantTools,
  selectTools,
};
