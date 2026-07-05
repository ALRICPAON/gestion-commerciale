const express = require('express');

const { authenticateToken } = require('../../middleware/auth');
const { attachDbContext } = require('../../middleware/dbContext');
const { requireQualityPermission } = require('../../middleware/quality/requireQualityPermission');
const { QUALITY_PERMISSIONS } = require('../../services/quality/permissions');
const { EQUIPMENT_STATUSES, cleanUuid, mapEquipmentPayload } = require('../../validators/quality/digitalTwin');
const {
  listEquipments,
  getEquipment,
  createEquipment,
  updateEquipment,
  changeEquipmentStatus,
  deleteEquipment,
} = require('../../services/quality/digitalTwin');

const router = express.Router();

router.use(authenticateToken, attachDbContext);

function handleError(res, err, label) {
  console.error(label, err);
  res.status(err.status || 500).json({ error: err.publicMessage || err.message || 'Erreur serveur qualité' });
}

function validateEquipmentPayload(payload) {
  if (!payload.zone_id || !payload.code || !payload.name || !payload.type) {
    return 'Zone, code, nom et type sont obligatoires';
  }
  return null;
}

router.get('/', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    const equipments = await listEquipments(req.dbPool, req.user.store_id, req.query);
    res.json(equipments);
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/equipments');
  }
});

router.get('/:id', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    const equipmentId = cleanUuid(req.params.id);
    if (!equipmentId) return res.status(400).json({ error: 'Identifiant équipement invalide' });
    const equipment = await getEquipment(req.dbPool, req.user.store_id, equipmentId);
    if (!equipment) return res.status(404).json({ error: 'Équipement qualité introuvable' });
    res.json(equipment);
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/equipments/:id');
  }
});

router.post('/', requireQualityPermission(QUALITY_PERMISSIONS.EQUIPMENT_MANAGE), async (req, res) => {
  try {
    const payload = mapEquipmentPayload(req.body);
    const error = validateEquipmentPayload(payload);
    if (error) return res.status(400).json({ error });
    const result = await createEquipment(req.dbPool, req.user.store_id, req.user.id, payload);
    res.status(201).json(result);
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/equipments');
  }
});

router.put('/:id', requireQualityPermission(QUALITY_PERMISSIONS.EQUIPMENT_MANAGE), async (req, res) => {
  try {
    const equipmentId = cleanUuid(req.params.id);
    if (!equipmentId) return res.status(400).json({ error: 'Identifiant équipement invalide' });
    const payload = mapEquipmentPayload(req.body);
    const error = validateEquipmentPayload(payload);
    if (error) return res.status(400).json({ error });
    const result = await updateEquipment(req.dbPool, req.user.store_id, req.user.id, equipmentId, payload);
    if (!result) return res.status(404).json({ error: 'Équipement qualité introuvable' });
    res.json(result);
  } catch (err) {
    handleError(res, err, 'Erreur PUT /api/quality/equipments/:id');
  }
});

router.patch('/:id/status', requireQualityPermission(QUALITY_PERMISSIONS.EQUIPMENT_MANAGE), async (req, res) => {
  try {
    const equipmentId = cleanUuid(req.params.id);
    if (!equipmentId) return res.status(400).json({ error: 'Identifiant équipement invalide' });
    const status = String(req.body.status || '').trim();
    if (!EQUIPMENT_STATUSES.includes(status)) return res.status(400).json({ error: 'Statut équipement invalide' });
    const equipment = await changeEquipmentStatus(req.dbPool, req.user.store_id, req.user.id, equipmentId, status);
    if (!equipment) return res.status(404).json({ error: 'Équipement qualité introuvable' });
    res.json(equipment);
  } catch (err) {
    handleError(res, err, 'Erreur PATCH /api/quality/equipments/:id/status');
  }
});

router.delete('/:id', requireQualityPermission(QUALITY_PERMISSIONS.EQUIPMENT_MANAGE), async (req, res) => {
  try {
    const equipmentId = cleanUuid(req.params.id);
    if (!equipmentId) return res.status(400).json({ error: 'Identifiant équipement invalide' });
    const result = await deleteEquipment(req.dbPool, req.user.store_id, req.user.id, equipmentId);
    if (!result) return res.status(404).json({ error: 'Équipement qualité introuvable' });
    res.json(result);
  } catch (err) {
    handleError(res, err, 'Erreur DELETE /api/quality/equipments/:id');
  }
});

module.exports = router;
