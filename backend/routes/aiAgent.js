const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const aiAgentService = require('../services/ai/aiAgentService');

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

module.exports = router;
