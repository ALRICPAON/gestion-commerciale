const tools = [
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
  {
    name: 'analyze_stock',
    description: 'Analysera le stock, les lots, la DLC et les rotations.',
    enabled: false,
    readonly: true,
  },
  {
    name: 'analyze_customer_history',
    description: 'Analysera l historique client.',
    enabled: false,
    readonly: true,
  },
  {
    name: 'analyze_margin',
    description: 'Analysera les marges articles, clients et fournisseurs.',
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
