const express = require('express');

const { authenticateToken } = require('../../middleware/auth');
const { attachDbContext } = require('../../middleware/dbContext');
const { requireQualityPermission } = require('../../middleware/quality/requireQualityPermission');
const { QUALITY_PERMISSIONS } = require('../../services/quality/permissions');
const { ZONE_STATUSES, cleanUuid, mapZonePayload } = require('../../validators/quality/digitalTwin');
const {
  listZones,
  getZone,
  createZone,
  updateZone,
  changeZoneStatus,
  deleteOrArchiveZone,
} = require('../../services/quality/digitalTwin');

const router = express.Router();

router.use(authenticateToken, attachDbContext);

function handleError(res, err, label) {
  console.error(label, err);
  res.status(err.status || 500).json({ error: err.publicMessage || err.message || 'Erreur serveur qualité' });
}

function validateZonePayload(payload) {
  if (!payload.code || !payload.name || !payload.type) {
    return 'Code, nom et type sont obligatoires';
  }
  return null;
}

router.get('/', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    const zones = await listZones(req.dbPool, req.user.store_id, req.query);
    res.json(zones);
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/zones');
  }
});

router.get('/:id', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    const zoneId = cleanUuid(req.params.id);
    if (!zoneId) return res.status(400).json({ error: 'Identifiant zone invalide' });
    const zone = await getZone(req.dbPool, req.user.store_id, zoneId);
    if (!zone) return res.status(404).json({ error: 'Zone qualité introuvable' });
    res.json(zone);
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/zones/:id');
  }
});

router.post('/', requireQualityPermission(QUALITY_PERMISSIONS.EQUIPMENT_MANAGE), async (req, res) => {
  try {
    const payload = mapZonePayload(req.body);
    const error = validateZonePayload(payload);
    if (error) return res.status(400).json({ error });
    const zone = await createZone(req.dbPool, req.user.store_id, req.user.id, payload);
    res.status(201).json(zone);
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/zones');
  }
});

router.put('/:id', requireQualityPermission(QUALITY_PERMISSIONS.EQUIPMENT_MANAGE), async (req, res) => {
  try {
    const zoneId = cleanUuid(req.params.id);
    if (!zoneId) return res.status(400).json({ error: 'Identifiant zone invalide' });
    const payload = mapZonePayload(req.body);
    const error = validateZonePayload(payload);
    if (error) return res.status(400).json({ error });
    const zone = await updateZone(req.dbPool, req.user.store_id, req.user.id, zoneId, payload);
    if (!zone) return res.status(404).json({ error: 'Zone qualité introuvable' });
    res.json(zone);
  } catch (err) {
    handleError(res, err, 'Erreur PUT /api/quality/zones/:id');
  }
});

router.patch('/:id/status', requireQualityPermission(QUALITY_PERMISSIONS.EQUIPMENT_MANAGE), async (req, res) => {
  try {
    const zoneId = cleanUuid(req.params.id);
    if (!zoneId) return res.status(400).json({ error: 'Identifiant zone invalide' });
    const status = String(req.body.status || '').trim();
    if (!ZONE_STATUSES.includes(status)) return res.status(400).json({ error: 'Statut zone invalide' });
    const zone = await changeZoneStatus(req.dbPool, req.user.store_id, req.user.id, zoneId, status);
    if (!zone) return res.status(404).json({ error: 'Zone qualité introuvable' });
    res.json(zone);
  } catch (err) {
    handleError(res, err, 'Erreur PATCH /api/quality/zones/:id/status');
  }
});

router.delete('/:id', requireQualityPermission(QUALITY_PERMISSIONS.EQUIPMENT_MANAGE), async (req, res) => {
  try {
    const zoneId = cleanUuid(req.params.id);
    if (!zoneId) return res.status(400).json({ error: 'Identifiant zone invalide' });
    const result = await deleteOrArchiveZone(req.dbPool, req.user.store_id, req.user.id, zoneId);
    if (!result) return res.status(404).json({ error: 'Zone qualité introuvable' });
    res.json(result);
  } catch (err) {
    handleError(res, err, 'Erreur DELETE /api/quality/zones/:id');
  }
});

module.exports = router;
