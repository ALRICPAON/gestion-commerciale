const express = require('express');

const { authenticateToken } = require('../../middleware/auth');
const { attachDbContext } = require('../../middleware/dbContext');
const { requireQualityPermission } = require('../../middleware/quality/requireQualityPermission');
const { QUALITY_PERMISSIONS } = require('../../services/quality/permissions');
const {
  changeCleaningPlanStatus,
  createCleaningRecord,
  getCleaningPlan,
  getCleaningSummary,
  listCleaningPlans,
  listCleaningRecords,
  listDueCleaningRecords,
  saveCleaningPlan,
} = require('../../services/quality/cleaning');
const {
  cleanUuid,
  mapPlanPayload,
  mapRecordPayload,
  validatePlanPayload,
  validateRecordPayload,
} = require('../../validators/quality/cleaning');

const router = express.Router();

router.use(authenticateToken, attachDbContext);

function handleError(res, err, label) {
  console.error(label, err);
  res.status(err.status || 500).json({ error: err.publicMessage || err.message || 'Erreur serveur qualité nettoyage' });
}

router.get('/summary', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    res.json(await getCleaningSummary(req.dbPool, req.user.store_id));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/cleaning/summary');
  }
});

router.get('/plans', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    res.json(await listCleaningPlans(req.dbPool, req.user.store_id, req.query));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/cleaning/plans');
  }
});

router.get('/plans/:id', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    const planId = cleanUuid(req.params.id);
    if (!planId) return res.status(400).json({ error: 'Identifiant plan invalide' });
    const plan = await getCleaningPlan(req.dbPool, req.user.store_id, planId);
    if (!plan) return res.status(404).json({ error: 'Plan de nettoyage introuvable' });
    res.json(plan);
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/cleaning/plans/:id');
  }
});

router.post('/plans', requireQualityPermission(QUALITY_PERMISSIONS.EQUIPMENT_MANAGE), async (req, res) => {
  try {
    const payload = mapPlanPayload(req.body);
    const error = validatePlanPayload(payload);
    if (error) return res.status(400).json({ error });
    const plan = await saveCleaningPlan(req.dbPool, req.user.store_id, req.user.id, payload);
    res.status(201).json(plan);
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/cleaning/plans');
  }
});

router.put('/plans/:id', requireQualityPermission(QUALITY_PERMISSIONS.EQUIPMENT_MANAGE), async (req, res) => {
  try {
    const planId = cleanUuid(req.params.id);
    if (!planId) return res.status(400).json({ error: 'Identifiant plan invalide' });
    const payload = mapPlanPayload(req.body);
    const error = validatePlanPayload(payload);
    if (error) return res.status(400).json({ error });
    const plan = await saveCleaningPlan(req.dbPool, req.user.store_id, req.user.id, payload, planId);
    if (!plan) return res.status(404).json({ error: 'Plan de nettoyage introuvable' });
    res.json(plan);
  } catch (err) {
    handleError(res, err, 'Erreur PUT /api/quality/cleaning/plans/:id');
  }
});

router.patch('/plans/:id/status', requireQualityPermission(QUALITY_PERMISSIONS.EQUIPMENT_MANAGE), async (req, res) => {
  try {
    const planId = cleanUuid(req.params.id);
    if (!planId) return res.status(400).json({ error: 'Identifiant plan invalide' });
    const active = req.body.active !== false && req.body.active !== 'false';
    const plan = await changeCleaningPlanStatus(req.dbPool, req.user.store_id, req.user.id, planId, active);
    if (!plan) return res.status(404).json({ error: 'Plan de nettoyage introuvable' });
    res.json(plan);
  } catch (err) {
    handleError(res, err, 'Erreur PATCH /api/quality/cleaning/plans/:id/status');
  }
});

router.get('/due-records', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    res.json(await listDueCleaningRecords(req.dbPool, req.user.store_id, req.query));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/cleaning/due-records');
  }
});

router.post('/records', requireQualityPermission(QUALITY_PERMISSIONS.RECORD_CREATE), async (req, res) => {
  try {
    const payload = mapRecordPayload(req.body);
    const error = validateRecordPayload(payload);
    if (error) return res.status(400).json({ error });
    const record = await createCleaningRecord(req.dbPool, req.user.store_id, req.user.id, payload);
    res.status(201).json(record);
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/cleaning/records');
  }
});

router.get('/records', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    res.json(await listCleaningRecords(req.dbPool, req.user.store_id, req.query));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/cleaning/records');
  }
});

module.exports = router;
