const express = require('express');

const { authenticateToken } = require('../../middleware/auth');
const { attachDbContext } = require('../../middleware/dbContext');
const { requireQualityPermission } = require('../../middleware/quality/requireQualityPermission');
const { QUALITY_PERMISSIONS } = require('../../services/quality/permissions');
const {
  deactivateQualityTask,
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
  res.status(err.status || 500).json({ error: err.publicMessage || err.message || 'Erreur serveur qualité tâches' });
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
    if (!taskId) return res.status(400).json({ error: 'Identifiant tâche invalide' });
    const task = await getQualityTask(req.dbPool, req.user.store_id, taskId);
    if (!task) return res.status(404).json({ error: 'Tâche qualité introuvable' });
    res.json(task);
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/tasks/:id');
  }
});

router.post('/', requireQualityPermission(QUALITY_PERMISSIONS.EQUIPMENT_MANAGE), async (req, res) => {
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

router.put('/:id', requireQualityPermission(QUALITY_PERMISSIONS.EQUIPMENT_MANAGE), async (req, res) => {
  try {
    const taskId = cleanUuid(req.params.id);
    if (!taskId) return res.status(400).json({ error: 'Identifiant tâche invalide' });
    const payload = mapTaskPayload(req.body);
    const error = validateTaskPayload(payload);
    if (error) return res.status(400).json({ error });
    const task = await saveQualityTask(req.dbPool, req.user.store_id, req.user.id, payload, taskId);
    if (!task) return res.status(404).json({ error: 'Tâche qualité introuvable' });
    res.json(task);
  } catch (err) {
    handleError(res, err, 'Erreur PUT /api/quality/tasks/:id');
  }
});

router.patch('/:id/status', requireQualityPermission(QUALITY_PERMISSIONS.RECORD_CREATE), async (req, res) => {
  try {
    const taskId = cleanUuid(req.params.id);
    if (!taskId) return res.status(400).json({ error: 'Identifiant tâche invalide' });
    const payload = mapStatusPayload(req.body);
    const error = validateStatusPayload(payload);
    if (error) return res.status(400).json({ error });
    const task = await updateQualityTaskStatus(req.dbPool, req.user.store_id, req.user.id, taskId, payload);
    if (!task) return res.status(404).json({ error: 'Tâche qualité introuvable' });
    res.json(task);
  } catch (err) {
    handleError(res, err, 'Erreur PATCH /api/quality/tasks/:id/status');
  }
});

router.delete('/:id', requireQualityPermission(QUALITY_PERMISSIONS.EQUIPMENT_MANAGE), async (req, res) => {
  try {
    const taskId = cleanUuid(req.params.id);
    if (!taskId) return res.status(400).json({ error: 'Identifiant tâche invalide' });
    const task = await deactivateQualityTask(req.dbPool, req.user.store_id, req.user.id, taskId);
    if (!task) return res.status(404).json({ error: 'Tâche qualité introuvable' });
    res.json({ mode: 'deactivated', message: 'Tâche désactivée', task });
  } catch (err) {
    handleError(res, err, 'Erreur DELETE /api/quality/tasks/:id');
  }
});

module.exports = router;
