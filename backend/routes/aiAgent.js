const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const aiAgentService = require('../services/ai/aiAgentService');
const {
  prepareCustomerOrderAction,
  confirmAction,
  cancelAction,
} = require('../services/ai/aiActionService');

const router = express.Router();

router.post('/ai-agent/chat', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const result = await aiAgentService.chat({
      db: req.dbPool,
      user: req.user,
      question: req.body?.question || req.body?.message,
      messages: req.body?.messages || [],
    });

    res.json(result);
  } catch (error) {
    console.error('Erreur POST /api/ai-agent/chat :', {
      message: error.message,
      status: error.status || 500,
    });

    const status = error.status || 500;
    res.status(status).json({
      error: error.expose || status < 500 ? error.message : 'Erreur serveur assistant IA',
    });
  }
});

router.post('/ai-agent/actions/prepare', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    if (req.body?.action_type && req.body.action_type !== 'customer_order_draft') {
      return res.status(400).json({ error: 'Action IA non autorisee dans cette PR' });
    }

    const action = await prepareCustomerOrderAction({
      db: req.dbPool,
      user: req.user,
      prompt: req.body?.prompt || req.body?.question || '',
      payload: req.body?.payload || null,
    });

    res.status(201).json({ ok: true, action });
  } catch (error) {
    console.error('Erreur POST /api/ai-agent/actions/prepare :', {
      message: error.message,
      status: error.status || 500,
    });

    const status = error.status || 500;
    res.status(status).json({
      error: error.expose || status < 500 ? error.message : 'Erreur preparation action IA',
    });
  }
});

router.post('/ai-agent/actions/:id/confirm', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const result = await confirmAction({
      dbPool: req.dbPool,
      user: req.user,
      actionId: req.params.id,
    });

    res.json(result);
  } catch (error) {
    console.error('Erreur POST /api/ai-agent/actions/:id/confirm :', {
      action_id: req.params.id,
      message: error.message,
      status: error.status || 500,
    });

    const status = error.status || 500;
    res.status(status).json({
      error: error.expose || status < 500 ? error.message : 'Erreur confirmation action IA',
    });
  }
});

router.post('/ai-agent/actions/:id/cancel', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const result = await cancelAction({
      db: req.dbPool,
      user: req.user,
      actionId: req.params.id,
    });

    res.json(result);
  } catch (error) {
    console.error('Erreur POST /api/ai-agent/actions/:id/cancel :', {
      action_id: req.params.id,
      message: error.message,
      status: error.status || 500,
    });

    const status = error.status || 500;
    res.status(status).json({
      error: error.expose || status < 500 ? error.message : 'Erreur annulation action IA',
    });
  }
});

module.exports = router;
