const express = require('express');

const { authenticateToken } = require('../../middleware/auth');
const { attachDbContext } = require('../../middleware/dbContext');
const { requireQualityPermission } = require('../../middleware/quality/requireQualityPermission');
const { QUALITY_PERMISSIONS } = require('../../services/quality/permissions');
const operations = require('../../services/quality/operations');
const { cleanUuid } = require('../../validators/quality/tasks');

const router = express.Router();

router.use(authenticateToken, attachDbContext);

function handleError(res, err, label) {
  console.error(label, err);
  res.status(err.status || 500).json({ error: err.publicMessage || err.message || 'Erreur serveur qualite operationnelle' });
}

router.get('/today', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    res.json(await operations.listQualityTodayWork(req.dbPool, req.user.store_id, req.query));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/operations/today');
  }
});

router.get('/overdue', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    const work = await operations.listQualityTodayWork(req.dbPool, req.user.store_id, { ...req.query, include_upcoming: 'false' });
    res.json({ generated_at: work.generated_at, overdue: work.sections.overdue, summary: { overdue: work.summary.overdue } });
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/operations/overdue');
  }
});

router.get('/ddpp', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    res.json(await operations.getDdppDashboard(req.dbPool, req.user.store_id, req.query));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/operations/ddpp');
  }
});

router.get('/ddpp/record/:type/:id', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    const id = cleanUuid(req.params.id);
    if (!id) return res.status(400).json({ error: 'Identifiant enregistrement invalide' });
    const detail = await operations.getDdppRecordDetail(req.dbPool, req.user.store_id, req.params.type, id);
    if (!detail) return res.status(404).json({ error: 'Enregistrement DDPP introuvable' });
    res.json(detail);
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/operations/ddpp/record/:type/:id');
  }
});

router.get('/non-conformities', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    res.json(await operations.listOpenNonConformities(req.dbPool, req.user.store_id));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/operations/non-conformities');
  }
});

router.post('/temperature-occurrences/execute', requireQualityPermission(QUALITY_PERMISSIONS.RECORD_CREATE), async (req, res) => {
  try {
    res.status(201).json(await operations.executeTemperatureOccurrence(req.dbPool, req.user.store_id, req.user.id, req.body));
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/operations/temperature-occurrences/execute');
  }
});

router.post('/cleaning-occurrences/execute', requireQualityPermission(QUALITY_PERMISSIONS.RECORD_CREATE), async (req, res) => {
  try {
    res.status(201).json(await operations.executeCleaningOccurrence(req.dbPool, req.user.store_id, req.user.id, req.body));
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/operations/cleaning-occurrences/execute');
  }
});

router.post('/manual-occurrences/execute', requireQualityPermission(QUALITY_PERMISSIONS.RECORD_CREATE), async (req, res) => {
  try {
    res.status(201).json(await operations.executeManualOccurrence(req.dbPool, req.user.store_id, req.user.id, req.body));
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/operations/manual-occurrences/execute');
  }
});

router.post('/non-conformities', requireQualityPermission(QUALITY_PERMISSIONS.NC_MANAGE), async (req, res) => {
  try {
    if (!req.body?.description) return res.status(400).json({ error: 'Description obligatoire' });
    res.status(201).json(await operations.createNonConformity(req.dbPool, req.user.store_id, req.user.id, req.body));
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/operations/non-conformities');
  }
});

router.post('/corrective-actions', requireQualityPermission(QUALITY_PERMISSIONS.ACTION_MANAGE), async (req, res) => {
  try {
    if (!req.body?.action) return res.status(400).json({ error: 'Action corrective obligatoire' });
    res.status(201).json(await operations.createCorrectiveAction(req.dbPool, req.user.store_id, req.user.id, req.body));
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/operations/corrective-actions');
  }
});

router.post('/non-conformities/:id/close', requireQualityPermission(QUALITY_PERMISSIONS.NC_MANAGE), async (req, res) => {
  try {
    const id = cleanUuid(req.params.id);
    if (!id) return res.status(400).json({ error: 'Identifiant non-conformite invalide' });
    const closed = await operations.closeNonConformity(req.dbPool, req.user.store_id, req.user.id, id, req.body);
    if (!closed) return res.status(404).json({ error: 'Non-conformite introuvable' });
    res.json(closed);
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/operations/non-conformities/:id/close');
  }
});

module.exports = router;
