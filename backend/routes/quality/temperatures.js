const express = require('express');

const { authenticateToken } = require('../../middleware/auth');
const { attachDbContext } = require('../../middleware/dbContext');
const { requireQualityPermission } = require('../../middleware/quality/requireQualityPermission');
const { QUALITY_PERMISSIONS } = require('../../services/quality/permissions');
const {
  cleanUuid,
  mapLimitPayload,
  mapRecordPayload,
  validateLimitPayload,
  validateRecordPayload,
} = require('../../validators/quality/temperatures');
const {
  deleteTemperatureLimit,
  deleteTemperatureRecord,
  getTemperatureRecord,
  getTemperatureSummary,
  listTemperatureLimits,
  listTemperatureRecords,
  listTemperatureTypes,
  saveTemperatureLimit,
  saveTemperatureRecord,
} = require('../../services/quality/temperatures');

const router = express.Router();

router.use(authenticateToken, attachDbContext);

function handleError(res, err, label) {
  console.error(label, err);
  res.status(err.status || 500).json({ error: err.publicMessage || err.message || 'Erreur serveur qualité températures' });
}

router.get('/types', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    res.json(await listTemperatureTypes(req.dbPool));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/temperatures/types');
  }
});

router.get('/limits', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    res.json(await listTemperatureLimits(req.dbPool, req.user.store_id, req.query));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/temperatures/limits');
  }
});

router.post('/limits', requireQualityPermission(QUALITY_PERMISSIONS.EQUIPMENT_MANAGE), async (req, res) => {
  try {
    const payload = mapLimitPayload(req.body);
    const error = validateLimitPayload(payload);
    if (error) return res.status(400).json({ error });
    const limit = await saveTemperatureLimit(req.dbPool, req.user.store_id, req.user.id, payload);
    res.status(201).json(limit);
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/temperatures/limits');
  }
});

router.put('/limits/:id', requireQualityPermission(QUALITY_PERMISSIONS.EQUIPMENT_MANAGE), async (req, res) => {
  try {
    const limitId = cleanUuid(req.params.id);
    if (!limitId) return res.status(400).json({ error: 'Identifiant limite invalide' });
    const payload = mapLimitPayload(req.body);
    const error = validateLimitPayload(payload);
    if (error) return res.status(400).json({ error });
    const limit = await saveTemperatureLimit(req.dbPool, req.user.store_id, req.user.id, payload, limitId);
    if (!limit) return res.status(404).json({ error: 'Limite de température introuvable' });
    res.json(limit);
  } catch (err) {
    handleError(res, err, 'Erreur PUT /api/quality/temperatures/limits/:id');
  }
});

router.delete('/limits/:id', requireQualityPermission(QUALITY_PERMISSIONS.EQUIPMENT_MANAGE), async (req, res) => {
  try {
    const limitId = cleanUuid(req.params.id);
    if (!limitId) return res.status(400).json({ error: 'Identifiant limite invalide' });
    const limit = await deleteTemperatureLimit(req.dbPool, req.user.store_id, req.user.id, limitId);
    if (!limit) return res.status(404).json({ error: 'Limite de température introuvable' });
    res.json({ mode: 'archived', message: 'Limite désactivée', limit });
  } catch (err) {
    handleError(res, err, 'Erreur DELETE /api/quality/temperatures/limits/:id');
  }
});

router.get('/summary', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    res.json(await getTemperatureSummary(req.dbPool, req.user.store_id));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/temperatures/summary');
  }
});

router.get('/', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    res.json(await listTemperatureRecords(req.dbPool, req.user.store_id, req.query));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/temperatures');
  }
});

router.get('/:id', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    const recordId = cleanUuid(req.params.id);
    if (!recordId) return res.status(400).json({ error: 'Identifiant relevé invalide' });
    const record = await getTemperatureRecord(req.dbPool, req.user.store_id, recordId);
    if (!record) return res.status(404).json({ error: 'Relevé de température introuvable' });
    res.json(record);
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/temperatures/:id');
  }
});

router.post('/', requireQualityPermission(QUALITY_PERMISSIONS.RECORD_CREATE), async (req, res) => {
  try {
    const payload = mapRecordPayload(req.body);
    const error = validateRecordPayload(payload);
    if (error) return res.status(400).json({ error });
    const record = await saveTemperatureRecord(req.dbPool, req.user.store_id, req.user.id, payload);
    res.status(201).json(record);
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/temperatures');
  }
});

router.put('/:id', requireQualityPermission(QUALITY_PERMISSIONS.EQUIPMENT_MANAGE), async (req, res) => {
  try {
    const recordId = cleanUuid(req.params.id);
    if (!recordId) return res.status(400).json({ error: 'Identifiant relevé invalide' });
    const payload = mapRecordPayload(req.body);
    const error = validateRecordPayload(payload);
    if (error) return res.status(400).json({ error });
    const record = await saveTemperatureRecord(req.dbPool, req.user.store_id, req.user.id, payload, recordId);
    if (!record) return res.status(404).json({ error: 'Relevé de température introuvable' });
    res.json(record);
  } catch (err) {
    handleError(res, err, 'Erreur PUT /api/quality/temperatures/:id');
  }
});

router.delete('/:id', requireQualityPermission(QUALITY_PERMISSIONS.EQUIPMENT_MANAGE), async (req, res) => {
  try {
    const recordId = cleanUuid(req.params.id);
    if (!recordId) return res.status(400).json({ error: 'Identifiant relevé invalide' });
    const record = await deleteTemperatureRecord(req.dbPool, req.user.store_id, req.user.id, recordId);
    if (!record) return res.status(404).json({ error: 'Relevé de température introuvable' });
    res.json({ mode: 'archived', message: 'Relevé archivé', record });
  } catch (err) {
    handleError(res, err, 'Erreur DELETE /api/quality/temperatures/:id');
  }
});

module.exports = router;
