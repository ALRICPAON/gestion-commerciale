const crypto = require('crypto');
const express = require('express');

const {
  requireAgentApiKey,
  resolveAgentStore,
  searchClients,
  searchArticles,
  searchStock,
  searchSuppliers,
  searchSales,
  createPendingAction,
  getPendingAction,
  executePendingAction,
} = require('../services/agentToolsService');

const router = express.Router();
const PROTOCOL_VERSION = '2025-06-18';
const LEGACY_SESSIONS = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;
const ALTA_WIDGET_URI = 'ui://widget/alta-maree-connected.html';
const ALTA_WIDGET_MIME_TYPE = 'text/html;profile=mcp-app';
const SECURITY_SCHEMES = [{ type: 'http', scheme: 'bearer' }];

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
    <p>Les outils ALTA sont disponibles pour rechercher clients, articles, stock, fournisseurs et ventes, puis préparer des actions en attente de confirmation humaine.</p>
    <div class="status"><span class="dot" aria-hidden="true"></span>Connexion MCP active</div>
  </main>
</body>
</html>`;

const searchInputSchema = {
  type: 'object',
  required: ['query'],
  properties: {
    query: { type: 'string', description: 'Texte à rechercher.' },
    limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Nombre maximum de résultats.' },
  },
  additionalProperties: false,
};

const searchOutputSchema = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    },
  },
  required: ['results'],
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
  },
  additionalProperties: true,
};

const pendingActionInputSchema = {
  type: 'object',
  required: ['action_type', 'summary', 'payload'],
  properties: {
    action_type: { type: 'string', description: 'Type métier préparé, par exemple customer_order_draft ou email_draft.' },
    summary: { type: 'string', description: 'Résumé clair à afficher à l’utilisateur avant confirmation.' },
    payload: { type: 'object', description: 'Payload figé préparé par l’agent.', additionalProperties: true },
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
    outputSchema: searchOutputSchema,
    invoking: 'Recherche clients ALTA...',
    invoked: 'Clients ALTA trouvés',
  }),
  makeTool({
    name: 'search_articles',
    title: 'Rechercher des articles',
    description: 'Recherche des articles ALTA MAREE par PLU, désignation, EAN, famille ou nom latin.',
    inputSchema: searchInputSchema,
    outputSchema: searchOutputSchema,
    invoking: 'Recherche articles ALTA...',
    invoked: 'Articles ALTA trouvés',
  }),
  makeTool({
    name: 'search_stock',
    title: 'Rechercher le stock',
    description: 'Recherche l’état de stock par article, avec quantité disponible et prochain lot FIFO.',
    inputSchema: searchInputSchema,
    outputSchema: searchOutputSchema,
    invoking: 'Lecture stock ALTA...',
    invoked: 'Stock ALTA consulté',
  }),
  makeTool({
    name: 'search_suppliers',
    title: 'Rechercher des fournisseurs',
    description: 'Recherche des fournisseurs ALTA MAREE par code, nom, contact, email, téléphone ou ville.',
    inputSchema: searchInputSchema,
    outputSchema: searchOutputSchema,
    invoking: 'Recherche fournisseurs ALTA...',
    invoked: 'Fournisseurs ALTA trouvés',
  }),
  makeTool({
    name: 'search_sales',
    title: 'Rechercher les ventes',
    description: 'Recherche des documents de vente, commandes ou lignes de vente.',
    inputSchema: searchInputSchema,
    outputSchema: searchOutputSchema,
    invoking: 'Recherche ventes ALTA...',
    invoked: 'Ventes ALTA trouvées',
  }),
  makeTool({
    name: 'create_pending_action',
    title: 'Créer une action en attente',
    description: 'Crée une action ALTA en attente de confirmation humaine. Aucune action métier directe n’est exécutée.',
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
    description: 'Marque une action pending comme exécutée uniquement après confirmation humaine explicite.',
    inputSchema: executePendingActionInputSchema,
    outputSchema: pendingActionOutputSchema,
    invoking: 'Confirmation action ALTA...',
    invoked: 'Action ALTA marquée exécutée',
    readOnly: false,
  }),
];

const toolHandlers = {
  search_clients: searchClients,
  search_articles: searchArticles,
  search_stock: searchStock,
  search_suppliers: searchSuppliers,
  search_sales: searchSales,
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
      serverInfo: { name: 'alta-maree-mcp', version: '1.1.0' },
      instructions: 'Utilise les outils ALTA uniquement pour lire les données métier et préparer des actions en attente de confirmation humaine.',
      _meta: {
        securitySchemes: SECURITY_SCHEMES,
      },
    });
  }

  if (method === 'ping') return jsonRpcResult(id, {});

  if (method === 'tools/list') {
    return jsonRpcResult(id, { tools });
  }

  if (method === 'tools/call') {
    const toolName = params.name;
    const handler = toolHandlers[toolName];
    if (!handler) return jsonRpcError(id, -32602, `Outil inconnu : ${toolName || ''}`);

    try {
      const args = params.arguments || {};
      const payload = await handler(req.dbPool, req.agentStoreId, args);
      return jsonRpcResult(id, toolResult(payload));
    } catch (error) {
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
