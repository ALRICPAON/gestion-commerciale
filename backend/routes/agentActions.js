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
} = require('../services/agentCommercialToolsService');
const { listAgentTools } = require('../services/agent/agentToolRegistry');
const { executeAgentTool } = require('../services/agent/agentToolExecutor');
const { envTrustedMode } = require('../services/agent/agentTrustedMode');

const router = express.Router();

function handleAgentError(res, error, fallbackMessage) {
  if (error.status && error.status < 500) return res.status(error.status).json({ error: error.message });
  return res.status(500).json({ error: fallbackMessage });
}

function agentContext(req) {
  const configured = String(process.env.ALTA_AGENT_PERMISSIONS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    store_id: req.agentStoreId,
    user_id: process.env.ALTA_AGENT_USER_ID || null,
    role: envTrustedMode() ? 'trusted_owner' : 'agent',
    permissions: configured.length ? configured : [
      'agent.use',
      'clients.read',
      'suppliers.read',
      'articles.read',
      'stock.read',
      'sales.read',
      'cashflow.read',
      'quality.read',
      'quality.configuration.write',
      'quality.documentation.read',
      'statistics.read',
      'pennylane.read',
      'employee_planning.read',
      'transformations.read',
    ],
    client_key: null,
    source: 'agent_rest',
    trusted_mode: envTrustedMode(),
    conversation_id: req.get('x-alta-conversation-id') || null,
    request_id: req.get('x-request-id') || null,
  };
}

router.use(requireAgentApiKey, resolveAgentStore);

router.get('/tools', async (req, res) => {
  res.json({ tools: listAgentTools() });
});

router.post('/tools/:name/call', async (req, res) => {
  try {
    const result = await executeAgentTool({
      db: req.dbPool,
      context: agentContext(req),
      name: req.params.name,
      input: req.body || {},
      confirmed: req.body?.confirmation === 'human_confirmed',
    });
    res.json(result);
  } catch (error) {
    console.error('Erreur agent tool call :', { tool: req.params.name, message: error.message });
    handleAgentError(res, error, 'Erreur outil agent');
  }
});

router.get('/clients/search', async (req, res) => {
  try {
    res.json(await searchClients(req.dbPool, req.agentStoreId, req.query));
  } catch (error) {
    console.error('Erreur agent clients search :', error);
    handleAgentError(res, error, 'Erreur recherche clients');
  }
});

router.get('/articles/search', async (req, res) => {
  try {
    res.json(await searchArticles(req.dbPool, req.agentStoreId, req.query));
  } catch (error) {
    console.error('Erreur agent articles search :', error);
    handleAgentError(res, error, 'Erreur recherche articles');
  }
});

router.get('/stock/search', async (req, res) => {
  try {
    res.json(await searchStock(req.dbPool, req.agentStoreId, req.query));
  } catch (error) {
    console.error('Erreur agent stock search :', error);
    handleAgentError(res, error, 'Erreur recherche stock');
  }
});

router.get('/suppliers/search', async (req, res) => {
  try {
    res.json(await searchSuppliers(req.dbPool, req.agentStoreId, req.query));
  } catch (error) {
    console.error('Erreur agent suppliers search :', error);
    handleAgentError(res, error, 'Erreur recherche fournisseurs');
  }
});

router.get('/sales/search', async (req, res) => {
  try {
    res.json(await searchSales(req.dbPool, req.agentStoreId, req.query));
  } catch (error) {
    console.error('Erreur agent sales search :', error);
    handleAgentError(res, error, 'Erreur recherche ventes');
  }
});

router.post('/pending-actions', async (req, res) => {
  try {
    const pendingAction = await createPendingAction(req.dbPool, req.agentStoreId, req.body);
    res.status(201).json(pendingAction);
  } catch (error) {
    console.error('Erreur agent pending action create :', error);
    handleAgentError(res, error, 'Erreur création action en attente');
  }
});

router.get('/pending-actions/:id', async (req, res) => {
  try {
    res.json(await getPendingAction(req.dbPool, req.agentStoreId, { id: req.params.id }));
  } catch (error) {
    console.error('Erreur agent pending action get :', error);
    handleAgentError(res, error, 'Erreur lecture action en attente');
  }
});

router.post('/pending-actions/:id/execute', async (req, res) => {
  try {
    res.json(await executePendingAction(req.dbPool, req.agentStoreId, {
      id: req.params.id,
      confirmation: req.body?.confirmation,
    }));
  } catch (error) {
    console.error('Erreur agent pending action execute :', error);
    handleAgentError(res, error, 'Erreur exécution action en attente');
  }
});

module.exports = router;
