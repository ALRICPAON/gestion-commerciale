const crypto = require('crypto');
const express = require('express');

const {
  requireAgentApiKey,
  resolveAgentStore,
  searchClients,
  getClientsOverview,
  searchArticles,
  getArticlesOverview,
  searchStock,
  getStockOverview,
  getStockState,
  getExpiringLots,
  getNegativeStock,
  searchSuppliers,
  getSuppliersOverview,
  searchSales,
  getSalesOverview,
  getSalesToday,
  getTopClients,
  createCustomerOrderConfirmed,
  createPendingAction,
  getPendingAction,
  executePendingAction,
} = require('../services/agentCommercialToolsService');

const router = express.Router();
const PROTOCOL_VERSION = '2025-06-18';
const LEGACY_SESSIONS = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;
const ALTA_WIDGET_URI = 'ui://widget/alta-maree-connected.html';
const ALTA_WIDGET_MIME_TYPE = 'text/html;profile=mcp-app';
const SECURITY_SCHEMES = [{ type: 'noauth' }];

const ALTA_WIDGET_HTML = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ALTA MAREE connecté</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7fafc;
      --panel: #ffffff;
      --text: #122033;
      --muted: #5f6f82;
      --accent: #0f766e;
      --border: #d9e2ec;
    }

    body {
      margin: 0;
      padding: 18px;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    main {
      max-width: 720px;
      margin: 0 auto;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 18px;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 20px;
      line-height: 1.2;
      letter-spacing: 0;
    }

    p {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.45;
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 14px;
      padding: 8px 10px;
      border: 1px solid rgba(15, 118, 110, 0.24);
      border-radius: 8px;
      color: var(--accent);
      font-size: 13px;
      font-weight: 650;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--accent);
    }
  </style>
</head>
<body>
  <main>
    <h1>ALTA MAREE connecté</h1>
    <p>Les outils ALTA lisent les données commerciales, préparent les commandes et exécutent uniquement après confirmation humaine.</p>
    <div class="status"><span class="dot" aria-hidden="true"></span>Connexion MCP active</div>
  </main>
</body>
</html>`;

const flexibleSearchInputSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Texte à rechercher. Optionnel pour obtenir une vue globale.' },
    limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Nombre maximum de résultats.' },
    available_only: { type: 'boolean', description: 'Limiter aux articles/lots disponibles quand applicable.' },
  },
  additionalProperties: false,
};

const searchInputSchema = {
  type: 'object',
  required: ['query'],
  properties: {
    query: { type: 'string', description: 'Texte à rechercher.' },
    limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Nombre maximum de résultats.' },
  },
  additionalProperties: false,
};

const stockSearchInputSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Texte à rechercher. Optionnel pour obtenir une vue globale du stock.' },
    limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Nombre maximum de résultats.' },
    available_only: { type: 'boolean', description: 'Limiter aux articles disponibles.' },
  },
  additionalProperties: false,
};

const overviewInputSchema = {
  type: 'object',
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Nombre maximum de lignes de détail.' },
  },
  additionalProperties: false,
};

const salesOverviewInputSchema = {
  type: 'object',
  properties: {
    date_from: { type: 'string', description: 'Date début YYYY-MM-DD.' },
    date_to: { type: 'string', description: 'Date fin YYYY-MM-DD.' },
    status: { type: 'string', description: 'Statut document, par exemple draft ou validated.' },
    document_type: { type: 'string', description: 'Type document, par exemple ORDER, DELIVERY_NOTE ou INVOICE.' },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
  additionalProperties: false,
};

const topClientsInputSchema = {
  type: 'object',
  properties: {
    days: { type: 'integer', minimum: 1, maximum: 3650, description: 'Période analysée en jours.' },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  },
  additionalProperties: false,
};

const expiringLotsInputSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Filtre article ou lot optionnel.' },
    days: { type: 'integer', minimum: 1, maximum: 60, description: 'Horizon DLC courte en jours.' },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
  additionalProperties: false,
};

const genericOutputSchema = {
  type: 'object',
  properties: {
    summary: { type: 'object', additionalProperties: true },
    results: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    },
  },
  additionalProperties: true,
};

const pendingActionOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    action_type: { type: 'string' },
    summary: { type: 'string' },
    payload: { type: 'object', additionalProperties: true },
    status: { type: 'string' },
    execution_result: { type: 'object', additionalProperties: true },
  },
  additionalProperties: true,
};

const customerOrderOutputSchema = {
  type: 'object',
  properties: {
    sale_id: { type: 'string' },
    reference_number: { type: 'string' },
    document_type: { type: 'string' },
    status: { type: 'string' },
    client: { type: 'object', additionalProperties: true },
    line_count: { type: 'integer' },
    total_amount_ex_vat: { type: 'number' },
    total_vat_amount: { type: 'number' },
    total_amount_inc_vat: { type: 'number' },
    stock_warning: { type: 'boolean' },
    stock_message: { type: 'string' },
    created_lines: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    },
  },
  additionalProperties: true,
};

const customerOrderConfirmedInputSchema = {
  type: 'object',
  required: ['client_id', 'lines'],
  properties: {
    client_id: { type: 'string', description: 'UUID du client actif.' },
    document_date: { type: 'string', description: 'Date de commande YYYY-MM-DD. Optionnel.' },
    notes: { type: 'string', description: 'Notes optionnelles de la commande.' },
    lines: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['unit_sale_price_ht'],
        properties: {
          article_id: { type: 'string', description: 'UUID article. Fournir article_id ou article_plu; la validation backend impose au moins un des deux.' },
          article_plu: { type: 'string', description: 'PLU article. Fournir article_plu si article_id indisponible; la validation backend impose au moins un des deux.' },
          article_label: { type: 'string', description: 'Libellé article affiché sur la ligne.' },
          package_count: { type: 'number', description: 'Nombre de colis, par exemple 10.' },
          weight_per_package: { type: 'number', description: 'Poids par colis en kg, par exemple 3.' },
          total_weight: { type: 'number', description: 'Poids total en kg. Calculé si absent et si package_count + weight_per_package sont fournis.' },
          unit_sale_price_ht: { type: 'number', description: 'Prix de vente HT par unité, par exemple 15.' },
          sale_unit: { type: 'string', description: 'Unité de vente, généralement kg.' },
          force_stock_exit: { type: 'boolean', description: 'True si le client confirme une commande malgré stock insuffisant.' },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

const pendingActionInputSchema = {
  type: 'object',
  required: ['action_type', 'summary', 'payload'],
  properties: {
    action_type: { type: 'string', description: 'Type métier générique. Ne pas utiliser pour les commandes client ChatGPT: utiliser create_customer_order_confirmed après confirmation utilisateur.' },
    summary: { type: 'string', description: 'Résumé clair à afficher à l’utilisateur avant confirmation.' },
    payload: {
      type: 'object',
      description: 'Payload figé préparé par l’agent pour les actions génériques hors commande client directe.',
      properties: {
        client_id: { type: 'string' },
        document_type: { type: 'string', enum: ['ORDER'] },
        document_date: { type: 'string' },
        reference_number: { type: 'string' },
        notes: { type: 'string' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            required: ['unit_sale_price_ht'],
            properties: {
              article_id: { type: 'string', description: 'Identifiant article. Fournir article_id ou article_plu; la validation backend impose au moins un des deux.' },
              article_plu: { type: 'string', description: 'PLU article si article_id indisponible; la validation backend impose au moins un des deux.' },
              article_label: { type: 'string' },
              package_count: { type: 'number', description: 'Nombre de colis, par exemple 10.' },
              weight_per_package: { type: 'number', description: 'Poids par colis en kg, par exemple 3.' },
              total_weight: { type: 'number', description: 'Poids total en kg, par exemple 30.' },
              sold_quantity: { type: 'number', description: 'Quantité vendue en kg. Peut être égale au poids total.' },
              sale_unit: { type: 'string', description: 'Unité de vente, souvent kg.' },
              unit_sale_price_ht: { type: 'number', description: 'Prix de vente HT par unité, par exemple 15.' },
              force_stock_exit: { type: 'boolean', description: 'Mettre true si stock insuffisant mais commande à préparer quand même.' },
            },
            additionalProperties: true,
          },
        },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: false,
};

const getPendingActionInputSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', description: 'Identifiant UUID de l’action en attente.' },
  },
  additionalProperties: false,
};

const executePendingActionInputSchema = {
  type: 'object',
  required: ['id', 'confirmation'],
  properties: {
    id: { type: 'string', description: 'Identifiant UUID de l’action en attente.' },
    confirmation: { type: 'string', enum: ['human_confirmed'], description: 'Doit valoir human_confirmed.' },
  },
  additionalProperties: false,
};

function toolMeta(invoking, invoked, options = {}) {
  return {
    securitySchemes: SECURITY_SCHEMES,
    ui: { resourceUri: ALTA_WIDGET_URI, visibility: ['model', 'app'] },
    'openai/outputTemplate': ALTA_WIDGET_URI,
    'openai/widgetAccessible': true,
    'openai/toolInvocation/invoking': invoking,
    'openai/toolInvocation/invoked': invoked,
    ...options,
  };
}

function makeTool({ name, title, description, inputSchema, outputSchema, invoking, invoked, readOnly = true }) {
  return {
    name,
    title,
    description,
    inputSchema,
    outputSchema,
    securitySchemes: SECURITY_SCHEMES,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: false,
      openWorldHint: false,
    },
    _meta: toolMeta(invoking, invoked),
  };
}

const tools = [
  makeTool({
    name: 'search_clients',
    title: 'Rechercher des clients',
    description: 'Recherche des clients ALTA MAREE par code, nom, contact, email, téléphone ou ville.',
    inputSchema: searchInputSchema,
    outputSchema: genericOutputSchema,
    invoking: 'Recherche clients ALTA...',
    invoked: 'Clients ALTA trouvés',
  }),
  makeTool({
    name: 'get_clients_overview',
    title: 'Vue clients',
    description: 'Donne une vue globale des clients du magasin avec résumé et liste.',
    inputSchema: overviewInputSchema,
    outputSchema: genericOutputSchema,
    invoking: 'Lecture clients ALTA...',
    invoked: 'Clients ALTA consultés',
  }),
  makeTool({
    name: 'search_articles',
    title: 'Rechercher des articles',
    description: 'Recherche des articles ALTA MAREE par PLU, désignation, EAN, famille ou nom latin.',
    inputSchema: searchInputSchema,
    outputSchema: genericOutputSchema,
    invoking: 'Recherche articles ALTA...',
    invoked: 'Articles ALTA trouvés',
  }),
  makeTool({
    name: 'get_articles_overview',
    title: 'Vue articles',
    description: 'Donne une vue globale des articles du magasin avec stock associé.',
    inputSchema: overviewInputSchema,
    outputSchema: genericOutputSchema,
    invoking: 'Lecture articles ALTA...',
    invoked: 'Articles ALTA consultés',
  }),
  makeTool({
    name: 'search_stock',
    title: 'Rechercher le stock',
    description: 'Recherche le stock par article ou lot. Si query est absent, retourne une vue globale du stock.',
    inputSchema: stockSearchInputSchema,
    outputSchema: genericOutputSchema,
    invoking: 'Lecture stock ALTA...',
    invoked: 'Stock ALTA consulté',
  }),
  makeTool({
    name: 'get_stock_overview',
    title: 'Vue stock globale',
    description: 'Donne une vraie vue globale du stock: volumes, valeur, articles en stock et premières DLC.',
    inputSchema: flexibleSearchInputSchema,
    outputSchema: genericOutputSchema,
    invoking: 'Synthèse stock ALTA...',
    invoked: 'Synthèse stock ALTA prête',
  }),
  makeTool({
    name: 'get_stock_state',
    title: 'État de stock',
    description: 'Retourne l’état de stock global ou filtré par query, utilisable pour “j’ai quoi en stock en saumon ?”.',
    inputSchema: flexibleSearchInputSchema,
    outputSchema: genericOutputSchema,
    invoking: 'État stock ALTA...',
    invoked: 'État stock ALTA prêt',
  }),
  makeTool({
    name: 'get_expiring_lots',
    title: 'Lots à DLC courte',
    description: 'Liste les lots disponibles dont la DLC arrive dans les prochains jours.',
    inputSchema: expiringLotsInputSchema,
    outputSchema: genericOutputSchema,
    invoking: 'Recherche DLC courtes ALTA...',
    invoked: 'DLC courtes ALTA trouvées',
  }),
  makeTool({
    name: 'get_negative_stock',
    title: 'Stock négatif',
    description: 'Liste les articles avec stock négatif.',
    inputSchema: overviewInputSchema,
    outputSchema: genericOutputSchema,
    invoking: 'Recherche stock négatif ALTA...',
    invoked: 'Stock négatif ALTA consulté',
  }),
  makeTool({
    name: 'search_suppliers',
    title: 'Rechercher des fournisseurs',
    description: 'Recherche des fournisseurs ALTA MAREE par code, nom, contact, email, téléphone ou ville.',
    inputSchema: searchInputSchema,
    outputSchema: genericOutputSchema,
    invoking: 'Recherche fournisseurs ALTA...',
    invoked: 'Fournisseurs ALTA trouvés',
  }),
  makeTool({
    name: 'get_suppliers_overview',
    title: 'Vue fournisseurs',
    description: 'Donne une vue globale des fournisseurs du magasin.',
    inputSchema: overviewInputSchema,
    outputSchema: genericOutputSchema,
    invoking: 'Lecture fournisseurs ALTA...',
    invoked: 'Fournisseurs ALTA consultés',
  }),
  makeTool({
    name: 'search_sales',
    title: 'Rechercher les ventes',
    description: 'Recherche des documents de vente, commandes ou lignes de vente.',
    inputSchema: searchInputSchema,
    outputSchema: genericOutputSchema,
    invoking: 'Recherche ventes ALTA...',
    invoked: 'Ventes ALTA trouvées',
  }),
  makeTool({
    name: 'get_sales_overview',
    title: 'Vue ventes',
    description: 'Donne une synthèse des ventes/commandes avec filtres date, statut et type document.',
    inputSchema: salesOverviewInputSchema,
    outputSchema: genericOutputSchema,
    invoking: 'Synthèse ventes ALTA...',
    invoked: 'Synthèse ventes ALTA prête',
  }),
  makeTool({
    name: 'get_sales_today',
    title: 'Ventes du jour',
    description: 'Donne les ventes/commandes du jour.',
    inputSchema: overviewInputSchema,
    outputSchema: genericOutputSchema,
    invoking: 'Lecture ventes du jour ALTA...',
    invoked: 'Ventes du jour ALTA consultées',
  }),
  makeTool({
    name: 'get_top_clients',
    title: 'Meilleurs clients',
    description: 'Classe les clients par chiffre d’affaires sur une période.',
    inputSchema: topClientsInputSchema,
    outputSchema: genericOutputSchema,
    invoking: 'Calcul meilleurs clients ALTA...',
    invoked: 'Meilleurs clients ALTA prêts',
  }),
  makeTool({
    name: 'create_customer_order_confirmed',
    title: 'Créer une commande client confirmée',
    description: 'Crée réellement une commande client brouillon dans ALTA. À appeler uniquement après confirmation explicite de l’utilisateur dans la conversation. Ne pas utiliser create_pending_action pour les commandes client ChatGPT.',
    inputSchema: customerOrderConfirmedInputSchema,
    outputSchema: customerOrderOutputSchema,
    invoking: 'Création commande ALTA...',
    invoked: 'Commande ALTA créée',
    readOnly: false,
  }),
  makeTool({
    name: 'create_pending_action',
    title: 'Créer une action en attente',
    description: 'Crée une action ALTA générique en attente de confirmation humaine. Ne pas utiliser pour une commande client ChatGPT: utiliser create_customer_order_confirmed après confirmation conversationnelle.',
    inputSchema: pendingActionInputSchema,
    outputSchema: pendingActionOutputSchema,
    invoking: 'Préparation action ALTA...',
    invoked: 'Action ALTA en attente créée',
    readOnly: false,
  }),
  makeTool({
    name: 'get_pending_action',
    title: 'Lire une action en attente',
    description: 'Lit une action en attente existante.',
    inputSchema: getPendingActionInputSchema,
    outputSchema: pendingActionOutputSchema,
    invoking: 'Lecture action ALTA...',
    invoked: 'Action ALTA chargée',
  }),
  makeTool({
    name: 'execute_pending_action',
    title: 'Exécuter une action confirmée',
    description: 'Exécute une action pending uniquement après confirmation humaine explicite.',
    inputSchema: executePendingActionInputSchema,
    outputSchema: pendingActionOutputSchema,
    invoking: 'Confirmation action ALTA...',
    invoked: 'Action ALTA exécutée',
    readOnly: false,
  }),
];

const toolHandlers = {
  search_clients: searchClients,
  get_clients_overview: getClientsOverview,
  search_articles: searchArticles,
  get_articles_overview: getArticlesOverview,
  search_stock: searchStock,
  get_stock_overview: getStockOverview,
  get_stock_state: getStockState,
  get_expiring_lots: getExpiringLots,
  get_negative_stock: getNegativeStock,
  search_suppliers: searchSuppliers,
  get_suppliers_overview: getSuppliersOverview,
  search_sales: searchSales,
  get_sales_overview: getSalesOverview,
  get_sales_today: getSalesToday,
  get_top_clients: getTopClients,
  create_customer_order_confirmed: createCustomerOrderConfirmed,
  create_pending_action: createPendingAction,
  get_pending_action: getPendingAction,
  execute_pending_action: executePendingAction,
};

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id ?? null, error };
}

function toolResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
    _meta: {
      ui: { resourceUri: ALTA_WIDGET_URI },
      'openai/outputTemplate': ALTA_WIDGET_URI,
    },
  };
}

function altaWidgetResource() {
  return {
    uri: ALTA_WIDGET_URI,
    name: 'ALTA MAREE connecté',
    title: 'ALTA MAREE connecté',
    description: 'Template HTML minimal pour l’application ChatGPT Business ALTA MAREE.',
    mimeType: ALTA_WIDGET_MIME_TYPE,
    _meta: {
      'openai/widgetDescription': 'ALTA MAREE est connecté et prêt à interroger les données commerciales via MCP.',
      'openai/widgetPrefersBorder': true,
      'openai/widgetCSP': {
        connect_domains: ['https://api.altamaree.fr'],
        resource_domains: [],
      },
      'openai/widgetDomain': 'https://api.altamaree.fr',
    },
  };
}

function altaWidgetContent() {
  const resource = altaWidgetResource();
  return {
    uri: resource.uri,
    mimeType: resource.mimeType,
    text: ALTA_WIDGET_HTML,
    _meta: resource._meta,
  };
}

function getMcpEndpoint(req, sessionId) {
  const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`;
  return `${baseUrl}?sessionId=${encodeURIComponent(sessionId)}`;
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${data}\n\n`);
}

function writeSseJson(res, message) {
  writeSse(res, 'message', JSON.stringify(message));
}

function closeLegacySession(sessionId) {
  const session = LEGACY_SESSIONS.get(sessionId);
  if (!session) return;
  clearInterval(session.heartbeat);
  clearTimeout(session.timeout);
  LEGACY_SESSIONS.delete(sessionId);
  if (!session.res.destroyed) session.res.end();
}

async function handleRequest(req, message) {
  if (!message || message.jsonrpc !== '2.0' || !message.method) {
    return jsonRpcError(message?.id, -32600, 'Requête JSON-RPC invalide');
  }

  const { id, method, params = {} } = message;

  if (id === undefined || id === null) {
    return null;
  }

  if (method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
      },
      serverInfo: { name: 'alta-maree-mcp', version: '1.4.0' },
      instructions: 'Utilise les outils ALTA pour lire librement les données commerciales. Pour une commande client confirmée dans la conversation, appelle create_customer_order_confirmed afin de créer un brouillon modifiable dans ALTA. Les outils pending_action restent réservés aux actions génériques hors commande client directe. Toute modification, validation, facturation, email ou suppression hors création de brouillon commande doit rester confirmée explicitement.',
      _meta: {
        securitySchemes: SECURITY_SCHEMES,
      },
    });
  }

  if (method === 'ping') return jsonRpcResult(id, {});

  if (method === 'tools/list') {
    console.log('MCP ALTA tools/list', { count: tools.length, names: tools.map(t => t.name) });
    return jsonRpcResult(id, { tools });
  }

  if (method === 'tools/call') {
    const toolName = params.name;
    const handler = toolHandlers[toolName];
    if (!handler) return jsonRpcError(id, -32602, `Outil inconnu : ${toolName || ''}`);

    try {
      const args = params.arguments || {};
      console.log('MCP ALTA tool call', {
        tool: toolName,
        store_id: req.agentStoreId,
        has_query: Boolean(args.query),
      });
      const payload = await handler(req.dbPool, req.agentStoreId, args);
      console.log('MCP ALTA tool success', {
        tool: toolName,
        result_count: Array.isArray(payload?.results) ? payload.results.length : undefined,
        status: payload?.status,
      });
      return jsonRpcResult(id, toolResult(payload));
    } catch (error) {
      console.error('Erreur outil MCP ALTA', {
        tool: toolName,
        message: error.message,
        status: error.status,
      });
      return jsonRpcResult(id, {
        isError: true,
        content: [
          {
            type: 'text',
            text: error.message || 'Erreur outil MCP',
          },
        ],
      });
    }
  }

  if (method === 'resources/list') {
    return jsonRpcResult(id, { resources: [altaWidgetResource()] });
  }

  if (method === 'resources/templates/list') {
    return jsonRpcResult(id, { resourceTemplates: [] });
  }

  if (method === 'resources/read') {
    if (params.uri !== ALTA_WIDGET_URI) {
      return jsonRpcError(id, -32602, `Ressource inconnue : ${params.uri || ''}`);
    }

    return jsonRpcResult(id, { contents: [altaWidgetContent()] });
  }

  if (method === 'prompts/list') return jsonRpcResult(id, { prompts: [] });

  return jsonRpcError(id, -32601, `Méthode MCP non supportée : ${method}`);
}

async function handleBatch(req, body) {
  if (!Array.isArray(body)) {
    const response = await handleRequest(req, body);
    return response ? [response] : [];
  }

  const responses = await Promise.all(body.map((message) => handleRequest(req, message)));
  return responses.filter(Boolean);
}

router.use(requireAgentApiKey, resolveAgentStore);

router.get('/', (req, res) => {
  const accept = req.get('accept') || '';
  if (!accept.includes('text/event-stream')) {
    return res.status(405).json({ error: 'Utilise POST JSON-RPC ou GET avec Accept: text/event-stream' });
  }

  const sessionId = crypto.randomUUID();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const heartbeat = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);
  const timeout = setTimeout(() => closeLegacySession(sessionId), SESSION_TTL_MS);

  LEGACY_SESSIONS.set(sessionId, { res, heartbeat, timeout });
  writeSse(res, 'endpoint', getMcpEndpoint(req, sessionId));

  req.on('close', () => closeLegacySession(sessionId));
});

router.post('/', async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    if (sessionId) {
      const session = LEGACY_SESSIONS.get(String(sessionId));
      if (!session || session.res.destroyed) {
        return res.status(404).json({ error: 'Session MCP SSE introuvable' });
      }

      const responses = await handleBatch(req, req.body);
      responses.forEach((response) => writeSseJson(session.res, response));
      return res.status(202).end();
    }

    const responses = await handleBatch(req, req.body);
    if (responses.length === 0) return res.status(202).end();
    if (Array.isArray(req.body)) return res.json(responses);
    return res.json(responses[0]);
  } catch (error) {
    console.error('Erreur MCP ALTA :', error);
    return res.status(500).json(jsonRpcError(null, -32603, 'Erreur serveur MCP'));
  }
});

router.delete('/', (req, res) => {
  const sessionId = req.query.sessionId || req.get('mcp-session-id');
  if (sessionId) closeLegacySession(String(sessionId));
  res.status(405).json({ error: 'Session MCP stateless : suppression non supportée' });
});

module.exports = router;
