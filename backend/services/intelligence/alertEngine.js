const queries = require('./alertQueries');

const DEFAULT_DLC_DAYS = 5;
const DEFAULT_LOW_MARGIN_RATE = 10;
const DEFAULT_INACTIVE_CLIENT_DAYS = 30;

function intEnv(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function levelFromCount(count, { orange = 1, red = 5 } = {}) {
  if (count >= red) return 'red';
  if (count >= orange) return 'orange';
  return 'green';
}

function makeAlert(config, result) {
  const count = Number(result.count || 0);
  return {
    id: config.id,
    title: config.title,
    description: config.description,
    count,
    level: result.available === false ? 'green' : levelFromCount(count, config.thresholds),
    available: result.available !== false,
    unavailable_reason: result.available === false ? 'Données non disponibles' : null,
    view_url: config.viewUrl,
    alta_prompt: config.altaPrompt(count),
    items: Array.isArray(result.items) ? result.items : [],
  };
}

async function buildIntelligenceAlerts(db, storeId) {
  const dlcDays = intEnv('INTELLIGENCE_DLC_DAYS', DEFAULT_DLC_DAYS);
  const lowMarginRate = intEnv('INTELLIGENCE_LOW_MARGIN_RATE', DEFAULT_LOW_MARGIN_RATE);
  const inactiveClientDays = intEnv('INTELLIGENCE_INACTIVE_CLIENT_DAYS', DEFAULT_INACTIVE_CLIENT_DAYS);

  const alertLoaders = [
    {
      id: 'loss_sales',
      title: 'Ventes à perte',
      description: 'Lignes de vente avec marge négative sur 30 jours.',
      viewUrl: './sales.html',
      thresholds: { orange: 1, red: 3 },
      altaPrompt: () => 'Analyse uniquement l’alerte "Ventes à perte" du Centre de surveillance. Explique les risques et propose les actions commerciales à faire manuellement.',
      load: () => queries.lossSales(db, storeId),
    },
    {
      id: 'low_margins',
      title: 'Marges faibles',
      description: `Articles sous ${lowMarginRate} % de marge sur 30 jours.`,
      viewUrl: './statistiques.html',
      thresholds: { orange: 1, red: 10 },
      altaPrompt: () => 'Analyse uniquement l’alerte "Marges faibles" du Centre de surveillance. Identifie les priorités et propose des actions tarifaires ou commerciales manuelles.',
      load: () => queries.lowMargins(db, storeId, lowMarginRate),
    },
    {
      id: 'dlc_soon',
      title: 'Lots DLC proches',
      description: `Lots avec DLC dans moins de ${dlcDays} jours.`,
      viewUrl: './stock.html',
      thresholds: { orange: 1, red: 8 },
      altaPrompt: () => 'Analyse uniquement l’alerte "Lots DLC proches" du Centre de surveillance. Priorise les lots à vendre et propose des actions commerciales manuelles.',
      load: () => queries.dlcSoon(db, storeId, dlcDays),
    },
    {
      id: 'dlc_expired',
      title: 'Lots DLC dépassés',
      description: 'Lots disponibles dont la DLC est déjà dépassée.',
      viewUrl: './stock.html',
      thresholds: { orange: 1, red: 1 },
      altaPrompt: () => 'Analyse uniquement l’alerte "Lots DLC dépassés" du Centre de surveillance. Liste les urgences et rappelle les actions de contrôle à faire manuellement.',
      load: () => queries.dlcExpired(db, storeId),
    },
    {
      id: 'negative_stock',
      title: 'Stocks négatifs',
      description: 'Articles avec quantité de stock inférieure à zéro.',
      viewUrl: './stock-regularization.html',
      thresholds: { orange: 1, red: 1 },
      altaPrompt: () => 'Analyse uniquement l’alerte "Stocks négatifs" du Centre de surveillance. Explique les causes probables et propose une méthode de vérification manuelle.',
      load: () => queries.negativeStock(db, storeId),
    },
    {
      id: 'articles_without_stock',
      title: 'Articles sans stock',
      description: 'Articles actifs sans quantité disponible.',
      viewUrl: './articles.html',
      thresholds: { orange: 10, red: 40 },
      altaPrompt: () => 'Analyse uniquement l’alerte "Articles sans stock" du Centre de surveillance. Regroupe les familles à réapprovisionner ou à masquer commercialement.',
      load: () => queries.articlesWithoutStock(db, storeId),
    },
    {
      id: 'clients_to_follow_up',
      title: 'Clients à relancer',
      description: `Clients actifs sans vente depuis ${inactiveClientDays} jours ou plus.`,
      viewUrl: './clients.html',
      thresholds: { orange: 1, red: 15 },
      altaPrompt: () => 'Analyse uniquement l’alerte "Clients à relancer" du Centre de surveillance. Propose une priorité de relance et des angles commerciaux manuels.',
      load: () => queries.clientsToFollowUp(db, storeId, inactiveClientDays),
    },
    {
      id: 'unmatched_supplier_invoices',
      title: 'Factures fournisseurs non rapprochées',
      description: 'Factures fournisseurs sans rapprochement BL détecté.',
      viewUrl: './supplier-invoices.html',
      thresholds: { orange: 1, red: 10 },
      altaPrompt: () => 'Analyse uniquement l’alerte "Factures fournisseurs non rapprochées" du Centre de surveillance. Propose l’ordre de traitement manuel.',
      load: () => queries.unmatchedSupplierInvoices(db, storeId),
    },
    {
      id: 'unpaid_customer_invoices',
      title: 'Factures clients impayées',
      description: 'Factures clients non marquées payées si le statut est disponible.',
      viewUrl: './sales.html',
      thresholds: { orange: 1, red: 10 },
      altaPrompt: () => 'Analyse uniquement l’alerte "Factures clients impayées" du Centre de surveillance. Propose une priorité de relance comptable manuelle.',
      load: () => queries.unpaidCustomerInvoices(db, storeId),
    },
    {
      id: 'receptions_pending_invoice',
      title: 'Réceptions en attente de facture',
      description: 'Réceptions fournisseurs non rapprochées à une facture.',
      viewUrl: './purchases.html',
      thresholds: { orange: 1, red: 10 },
      altaPrompt: () => 'Analyse uniquement l’alerte "Réceptions en attente de facture" du Centre de surveillance. Propose l’ordre de contrôle manuel.',
      load: () => queries.receptionsPendingInvoice(db, storeId),
    },
  ];

  const results = await Promise.all(alertLoaders.map(async (config) => makeAlert(config, await config.load())));

  console.info('Centre surveillance calcule', {
    store_id: storeId,
    alerts: results.map((alert) => ({ id: alert.id, count: alert.count, level: alert.level })),
  });

  return results;
}

module.exports = {
  buildIntelligenceAlerts,
};
