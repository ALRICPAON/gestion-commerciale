const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const supplierArticleMappings = require('../services/supplierArticleMappingService');

const router = express.Router();

function statusFromQuery(value) {
  const status = String(value || 'active').trim();
  if (status === 'all' || status === 'inactive') return status;
  return 'active';
}

router.get('/supplier-article-mappings', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const result = await supplierArticleMappings.searchSupplierArticleMappings(req.dbPool, req.user.store_id, {
      supplier_id: req.query.supplier_id,
      query: req.query.search,
      status: statusFromQuery(req.query.status),
      limit: req.query.limit,
    });
    res.json(result.results);
  } catch (error) {
    console.error('Erreur liste AF_MAP :', error);
    res.status(error.status || 500).json({ error: error.expose ? error.message : 'Erreur liste AF_MAP' });
  }
});

router.post('/supplier-article-mappings', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const mapping = await supplierArticleMappings.upsertSupplierArticleMapping(req.dbPool, req.user.store_id, {
      ...req.body,
      mapping_source: req.body?.mapping_source || 'manual',
    }, { user_id: req.user.id, client_key: req.user.client_key });
    res.status(201).json(mapping);
  } catch (error) {
    console.error('Erreur creation AF_MAP :', error);
    res.status(error.status || 500).json({ error: error.expose ? error.message : 'Erreur creation AF_MAP' });
  }
});

router.patch('/supplier-article-mappings/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const mapping = await supplierArticleMappings.updateSupplierArticleMapping(req.dbPool, req.user.store_id, req.params.id, req.body, {
      user_id: req.user.id,
      client_key: req.user.client_key,
    });
    res.json(mapping);
  } catch (error) {
    console.error('Erreur modification AF_MAP :', error);
    res.status(error.status || 500).json({ error: error.expose ? error.message : 'Erreur modification AF_MAP' });
  }
});

router.patch('/supplier-article-mappings/:id/status', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const mapping = await supplierArticleMappings.setSupplierArticleMappingStatus(req.dbPool, req.user.store_id, req.params.id, req.body?.is_active, {
      user_id: req.user.id,
    });
    res.json(mapping);
  } catch (error) {
    console.error('Erreur statut AF_MAP :', error);
    res.status(error.status || 500).json({ error: error.expose ? error.message : 'Erreur statut AF_MAP' });
  }
});

module.exports = router;
