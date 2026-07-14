const express = require('express');

const { authenticateToken } = require('../../middleware/auth');
const { attachDbContext } = require('../../middleware/dbContext');
const { requireQualityPermission } = require('../../middleware/quality/requireQualityPermission');
const { QUALITY_PERMISSIONS } = require('../../services/quality/permissions');
const {
  createChapterBlock,
  deleteDocumentBlock,
  duplicateDocumentBlock,
  listChapterBlocks,
  reorderChapterBlocks,
  updateDocumentBlock,
  withTransaction,
} = require('../../services/quality/qualityDocumentBlockService');

const router = express.Router();

router.use(authenticateToken, attachDbContext);

function handleError(res, err, label) {
  console.error(label, err);
  res.status(err.status || 500).json({ error: err.message || 'Erreur blocs documentation qualite' });
}

router.get('/document-chapters/:chapterId/blocks', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_READ), async (req, res) => {
  try {
    const blocks = await listChapterBlocks(req.dbPool, req.user.store_id, req.params.chapterId);
    if (!blocks) return res.status(404).json({ error: 'Chapitre introuvable' });
    res.json(blocks);
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/document-chapters/:chapterId/blocks');
  }
});

router.post('/document-chapters/:chapterId/blocks', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_EDIT), async (req, res) => {
  try {
    const block = await withTransaction(req.dbPool, (client) => createChapterBlock(client, req.user.store_id, req.params.chapterId, req.user.id, req.body));
    if (!block) return res.status(404).json({ error: 'Chapitre introuvable' });
    res.status(201).json(block);
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/document-chapters/:chapterId/blocks');
  }
});

router.post('/document-chapters/:chapterId/blocks/reorder', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_EDIT), async (req, res) => {
  try {
    const blocks = await withTransaction(req.dbPool, (client) => reorderChapterBlocks(client, req.user.store_id, req.params.chapterId, req.user.id, req.body.block_ids));
    if (!blocks) return res.status(404).json({ error: 'Chapitre introuvable' });
    res.json(blocks);
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/document-chapters/:chapterId/blocks/reorder');
  }
});

router.patch('/document-blocks/:blockId', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_EDIT), async (req, res) => {
  try {
    const block = await withTransaction(req.dbPool, (client) => updateDocumentBlock(client, req.user.store_id, req.params.blockId, req.user.id, req.body));
    if (!block) return res.status(404).json({ error: 'Bloc introuvable' });
    res.json(block);
  } catch (err) {
    handleError(res, err, 'Erreur PATCH /api/quality/document-blocks/:blockId');
  }
});

router.delete('/document-blocks/:blockId', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_DELETE), async (req, res) => {
  try {
    const block = await withTransaction(req.dbPool, (client) => deleteDocumentBlock(client, req.user.store_id, req.params.blockId, req.user.id));
    if (!block) return res.status(404).json({ error: 'Bloc introuvable' });
    res.json({ mode: 'deleted', block });
  } catch (err) {
    handleError(res, err, 'Erreur DELETE /api/quality/document-blocks/:blockId');
  }
});

router.post('/document-blocks/:blockId/duplicate', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_EDIT), async (req, res) => {
  try {
    const block = await withTransaction(req.dbPool, (client) => duplicateDocumentBlock(client, req.user.store_id, req.params.blockId, req.user.id));
    if (!block) return res.status(404).json({ error: 'Bloc introuvable' });
    res.status(201).json(block);
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/document-blocks/:blockId/duplicate');
  }
});

module.exports = router;
