const express = require('express');

const { authenticateToken } = require('../../middleware/auth');
const { attachDbContext } = require('../../middleware/dbContext');
const { requireAnyQualityPermission, requireQualityPermission } = require('../../middleware/quality/requireQualityPermission');
const { QUALITY_PERMISSIONS } = require('../../services/quality/permissions');
const {
  archiveQualityTask,
  getQualityTask,
  getQualityTaskSummary,
  listQualityTasks,
  saveQualityTask,
  updateQualityTaskStatus,
} = require('../../services/quality/tasks');
const {
  cleanUuid,
  mapStatusPayload,
  mapTaskPayload,
  validateStatusPayload,
  validateTaskPayload,
} = require('../../validators/quality/tasks');

const router = express.Router();

router.use(authenticateToken, attachDbContext);

function handleError(res, err, label) {
  console.error(label, err);
  res.status(err.status || 500).json({ error: err.publicMessage || err.message || 'Erreur serveur qualite taches' });
}

router.get('/summary', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    res.json(await getQualityTaskSummary(req.dbPool, req.user.store_id));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/tasks/summary');
  }
});

router.get('/', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    res.json(await listQualityTasks(req.dbPool, req.user.store_id, req.query));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/tasks');
  }
});

router.get('/:id', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    const taskId = cleanUuid(req.params.id);
    if (!taskId) return res.status(400).json({ error: 'Identifiant tache invalide' });
    const task = await getQualityTask(req.dbPool, req.user.store_id, taskId);
    if (!task) return res.status(404).json({ error: 'Tache qualite introuvable' });
    res.json(task);
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/tasks/:id');
  }
});

const requireTaskConfigurationPermission = requireAnyQualityPermission([
  QUALITY_PERMISSIONS.EQUIPMENT_MANAGE,
  QUALITY_PERMISSIONS.CONFIGURATION_WRITE,
]);

router.post('/', requireTaskConfigurationPermission, async (req, res) => {
  try {
    const payload = mapTaskPayload(req.body);
    const error = validateTaskPayload(payload);
    if (error) return res.status(400).json({ error });
    const task = await saveQualityTask(req.dbPool, req.user.store_id, req.user.id, payload);
    res.status(201).json(task);
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/tasks');
  }
});

router.put('/:id', requireTaskConfigurationPermission, async (req, res) => {
  try {
    const taskId = cleanUuid(req.params.id);
    if (!taskId) return res.status(400).json({ error: 'Identifiant tache invalide' });
    const payload = mapTaskPayload(req.body);
    const error = validateTaskPayload(payload);
    if (error) return res.status(400).json({ error });
    const task = await saveQualityTask(req.dbPool, req.user.store_id, req.user.id, payload, taskId);
    if (!task) return res.status(404).json({ error: 'Tache qualite introuvable' });
    res.json(task);
  } catch (err) {
    handleError(res, err, 'Erreur PUT /api/quality/tasks/:id');
  }
});

router.patch('/:id/status', requireQualityPermission(QUALITY_PERMISSIONS.RECORD_CREATE), async (req, res) => {
  try {
    const taskId = cleanUuid(req.params.id);
    if (!taskId) return res.status(400).json({ error: 'Identifiant tache invalide' });
    const payload = mapStatusPayload(req.body);
    const error = validateStatusPayload(payload);
    if (error) return res.status(400).json({ error });
    const task = await updateQualityTaskStatus(req.dbPool, req.user.store_id, req.user.id, taskId, payload);
    if (!task) return res.status(404).json({ error: 'Tache qualite introuvable' });
    res.json(task);
  } catch (err) {
    handleError(res, err, 'Erreur PATCH /api/quality/tasks/:id/status');
  }
});

router.delete('/:id', requireTaskConfigurationPermission, async (req, res) => {
  try {
    const taskId = cleanUuid(req.params.id);
    if (!taskId) return res.status(400).json({ error: 'Identifiant tache invalide' });
    const before = await getQualityTask(req.dbPool, req.user.store_id, taskId);
    if (!before) return res.status(404).json({ error: 'Tache qualite introuvable' });
    if (before.task_origin === 'SYSTEM' && before.source_locked) {
      return res.status(409).json({
        error: 'Archivage direct refuse: cette tache est generee depuis sa source ALTA. Archivez ou desactivez la source liee.',
        source_entity_type: before.source_entity_type,
        source_entity_id: before.source_entity_id,
      });
    }
    const task = await archiveQualityTask(req.dbPool, req.user.store_id, req.user.id, taskId);
    res.json({ mode: 'archived', message: 'Tache archivee', task });
  } catch (err) {
    handleError(res, err, 'Erreur DELETE /api/quality/tasks/:id');
  }
});

module.exports = router;
