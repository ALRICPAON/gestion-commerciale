const tools = [
  {
    name: 'recommend_sales_actions',
    description: 'Recommande les clients a relancer et les produits a proposer en croisant stock, DLC, marges, historique client et ventes recentes.',
    enabled: true,
    readonly: true,
  },
  {
    name: 'generate_sales_drafts',
    description: 'Prepare des brouillons commerciaux email, WhatsApp ou offre a partir des recommandations, sans envoi ni ecriture.',
    enabled: true,
    readonly: true,
  },
  {
    name: 'analyze_stock',
    description: 'Analyse le stock disponible par article, les lots disponibles, les stocks negatifs et les articles sans stock.',
    enabled: true,
    readonly: true,
  },
  {
    name: 'analyze_dlc',
    description: 'Analyse les lots avec DLC proche, les lots depasses et les priorites de vente.',
    enabled: true,
    readonly: true,
  },
  {
    name: 'analyze_clients',
    description: 'Analyse les meilleurs clients, clients recents, clients inactifs et clients a relancer.',
    enabled: true,
    readonly: true,
  },
  {
    name: 'analyze_sales',
    description: 'Analyse les ventes recentes, le CA par periode, les top articles vendus et les top clients.',
    enabled: true,
    readonly: true,
  },
  {
    name: 'analyze_margins',
    description: 'Analyse les marges par article et client, ainsi que les articles a faible ou forte marge.',
    enabled: true,
    readonly: true,
  },
  {
    name: 'analyze_suppliers',
    description: 'Analyse les fournisseurs recents, achats recents et fournisseurs principaux.',
    enabled: true,
    readonly: true,
  },
  {
    name: 'create_sale_draft',
    description: 'Preparera une commande ou vente brouillon apres confirmation utilisateur.',
    enabled: false,
    readonly: false,
  },
  {
    name: 'prepare_supplier_order',
    description: 'Preparera une proposition de commande fournisseur.',
    enabled: false,
    readonly: false,
  },
  {
    name: 'prepare_customer_email',
    description: 'Preparera un email commercial sans l envoyer.',
    enabled: false,
    readonly: true,
  },
  {
    name: 'prepare_whatsapp_message',
    description: 'Preparera un message WhatsApp sans l envoyer.',
    enabled: false,
    readonly: true,
  },
];

function listTools() {
  return tools.map((tool) => ({ ...tool }));
}

module.exports = {
  listTools,
};
