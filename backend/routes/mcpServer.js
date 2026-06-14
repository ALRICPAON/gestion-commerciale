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

const searchInputSchema = {
  type: 'object',
  required: ['query'],
  properties: {
    query: { type: 'string', description: 'Texte à rechercher.' },
    limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Nombre maximum de résultats.' },
  },
  additionalProperties: false,
};

const tools = [
  {
    name: 'search_clients',
    description: 'Recherche des clients ALTA MARÉE par code, nom, contact, email, téléphone ou ville.',
    inputSchema: searchInputSchema,
  },
  {
    name: 'search_articles',
    description: 'Recherche des articles ALTA MARÉE par PLU, désignation, EAN, famille ou nom latin.',
    inputSchema: searchInputSchema,
  },
  {
    name: 'search_stock',
    description: 'Recherche l’état de stock par article, avec quantité disponible et prochain lot FIFO.',
    inputSchema: searchInputSchema,
  },
  {
    name: 'search_suppliers',
    description: 'Recherche des fournisseurs ALTA MARÉE par code, nom, contact, email, téléphone ou ville.',
    inputSchema: searchInputSchema,
  },
  {
    name: 'search_sales',
    description: 'Recherche des documents de vente, commandes ou lignes de vente.',
    inputSchema: searchInputSchema,
  },
  {
    name: 'create_pending_action',
    description: 'Crée une action ALTA en attente de confirmation humaine. Aucune action métier directe n’est exécutée.',
    inputSchema: {
      type: 'object',
      required: ['action_type', 'summary', 'payload'],
      properties: {
        action_type: { type: 'string', description: 'Type métier préparé, par exemple customer_order_draft ou email_draft.' },
        summary: { type: 'string', description: 'Résumé clair à afficher à l’utilisateur avant confirmation.' },
        payload: { type: 'object', description: 'Payload figé préparé par l’agent.', additionalProperties: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_pending_action',
    description: 'Lit une action en attente existante.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Identifiant UUID de l’action en attente.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'execute_pending_action',
    description: 'Marque une action pending comme exécutée uniquement après confirmation humaine explicite.',
    inputSchema: {
      type: 'object',
      required: ['id', 'confirmation'],
      properties: {
        id: { type: 'string', description: 'Identifiant UUID de l’action en attente.' },
        confirmation: { type: 'string', enum: ['human_confirmed'], description: 'Doit valoir human_confirmed.' },
      },
      additionalProperties: false,
    },
  },
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
  };
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
      capabilities: { tools: {} },
      serverInfo: { name: 'alta-maree-mcp', version: '1.0.0' },
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

  if (method === 'resources/list') return jsonRpcResult(id, { resources: [] });
  if (method === 'prompts/list') return jsonRpcResult(id, { prompts: [] });

  return jsonRpcError(id, -32601, `Méthode MCP non supportée : ${method}`);
}

router.use(requireAgentApiKey, resolveAgentStore);

router.get('/', (req, res) => {
  const accept = req.get('accept') || '';
  if (!accept.includes('text/event-stream')) {
    return res.status(405).json({ error: 'Utilise POST JSON-RPC ou GET avec Accept: text/event-stream' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  res.write('event: endpoint\n');
  res.write('data: /mcp\n\n');
  res.write('event: ready\n');
  res.write('data: {"ok":true}\n\n');

  const heartbeat = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  req.on('close', () => clearInterval(heartbeat));
});

router.post('/', async (req, res) => {
  try {
    const body = req.body;
    if (Array.isArray(body)) {
      const responses = (await Promise.all(body.map((message) => handleRequest(req, message)))).filter(Boolean);
      if (responses.length === 0) return res.status(202).end();
      return res.json(responses);
    }

    const response = await handleRequest(req, body);
    if (!response) return res.status(202).end();
    return res.json(response);
  } catch (error) {
    console.error('Erreur MCP ALTA :', error);
    return res.status(500).json(jsonRpcError(null, -32603, 'Erreur serveur MCP'));
  }
});

router.delete('/', (req, res) => {
  res.status(405).json({ error: 'Session MCP stateless : suppression non supportée' });
});

module.exports = router;
