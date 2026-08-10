const express = require('express');

const { authenticateToken } = require('../../middleware/auth');
const { attachDbContext } = require('../../middleware/dbContext');
const { requireQualityPermission } = require('../../middleware/quality/requireQualityPermission');
const { QUALITY_PERMISSIONS } = require('../../services/quality/permissions');
const suppliesMaterials = require('../../services/quality/suppliesMaterials');
const { isQualityUuid } = require('../../validators/quality/common');

const router = express.Router();

router.use(authenticateToken, attachDbContext);

function handleError(res, err, label) {
  console.error(label, err);
  res.status(err.status || 500).json({ error: err.publicMessage || err.message || 'Erreur fournitures et materiels' });
}

function cleanUuid(value) {
  const text = String(value || '').trim();
  return isQualityUuid(text) ? text : null;
}

router.get('/', requireQualityPermission(QUALITY_PERMISSIONS.SUPPLIES_READ), async (req, res) => {
  try {
    res.json({ materials: await suppliesMaterials.listSuppliesMaterials(req.dbPool, req.user.store_id, req.query) });
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/supplies-materials');
  }
});

router.get('/diagnostics', requireQualityPermission(QUALITY_PERMISSIONS.SUPPLIES_READ), async (req, res) => {
  try {
    res.json(await suppliesMaterials.diagnoseSuppliesMaterials(req.dbPool, req.user.store_id));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/supplies-materials/diagnostics');
  }
});

router.get('/:id', requireQualityPermission(QUALITY_PERMISSIONS.SUPPLIES_READ), async (req, res) => {
  try {
    const materialId = cleanUuid(req.params.id);
    if (!materialId) return res.status(400).json({ error: 'Identifiant fourniture invalide' });
    const material = await suppliesMaterials.getSupplyMaterial(req.dbPool, req.user.store_id, materialId);
    if (!material) return res.status(404).json({ error: 'Fourniture ou materiel introuvable' });
    res.json({ material });
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/supplies-materials/:id');
  }
});

router.post('/', requireQualityPermission(QUALITY_PERMISSIONS.SUPPLIES_WRITE), async (req, res) => {
  try {
    const material = await suppliesMaterials.createSupplyMaterial(req.dbPool, req.user.store_id, req.user.id, req.body);
    res.status(201).json({ material });
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/supplies-materials');
  }
});

router.patch('/:id', requireQualityPermission(QUALITY_PERMISSIONS.SUPPLIES_WRITE), async (req, res) => {
  try {
    const materialId = cleanUuid(req.params.id);
    if (!materialId) return res.status(400).json({ error: 'Identifiant fourniture invalide' });
    const material = await suppliesMaterials.updateSupplyMaterial(req.dbPool, req.user.store_id, req.user.id, materialId, req.body);
    if (!material) return res.status(404).json({ error: 'Fourniture ou materiel introuvable' });
    res.json({ material });
  } catch (err) {
    handleError(res, err, 'Erreur PATCH /api/quality/supplies-materials/:id');
  }
});

router.delete('/:id', requireQualityPermission(QUALITY_PERMISSIONS.SUPPLIES_ARCHIVE), async (req, res) => {
  try {
    const materialId = cleanUuid(req.params.id);
    if (!materialId) return res.status(400).json({ error: 'Identifiant fourniture invalide' });
    const material = await suppliesMaterials.archiveSupplyMaterial(req.dbPool, req.user.store_id, req.user.id, materialId);
    if (!material) return res.status(404).json({ error: 'Fourniture ou materiel introuvable' });
    res.json({ mode: 'archived', material });
  } catch (err) {
    handleError(res, err, 'Erreur DELETE /api/quality/supplies-materials/:id');
  }
});

router.get('/:id/documents', requireQualityPermission(QUALITY_PERMISSIONS.SUPPLIES_READ), async (req, res) => {
  try {
    const materialId = cleanUuid(req.params.id);
    if (!materialId) return res.status(400).json({ error: 'Identifiant fourniture invalide' });
    res.json({ documents: await suppliesMaterials.listSupplyMaterialDocuments(req.dbPool, req.user.store_id, materialId) });
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/supplies-materials/:id/documents');
  }
});

router.post('/:id/documents', requireQualityPermission(QUALITY_PERMISSIONS.SUPPLIES_DOCUMENTS), async (req, res) => {
  try {
    const materialId = cleanUuid(req.params.id);
    if (!materialId) return res.status(400).json({ error: 'Identifiant fourniture invalide' });
    const reference = await suppliesMaterials.addSupplyMaterialDocumentReference(req.dbPool, req.user.store_id, req.user.id, {
      ...req.body,
      supply_material_id: materialId,
    });
    res.status(201).json({ reference });
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/supplies-materials/:id/documents');
  }
});

router.get('/:id/links', requireQualityPermission(QUALITY_PERMISSIONS.SUPPLIES_READ), async (req, res) => {
  try {
    const materialId = cleanUuid(req.params.id);
    if (!materialId) return res.status(400).json({ error: 'Identifiant fourniture invalide' });
    res.json({ links: await suppliesMaterials.listSupplyMaterialLinks(req.dbPool, req.user.store_id, materialId) });
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/supplies-materials/:id/links');
  }
});

router.post('/:id/links', requireQualityPermission(QUALITY_PERMISSIONS.SUPPLIES_WRITE), async (req, res) => {
  try {
    const materialId = cleanUuid(req.params.id);
    if (!materialId) return res.status(400).json({ error: 'Identifiant fourniture invalide' });
    const link = await suppliesMaterials.addSupplyMaterialLink(req.dbPool, req.user.store_id, req.user.id, {
      ...req.body,
      supply_material_id: materialId,
    });
    res.status(201).json({ link });
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/supplies-materials/:id/links');
  }
});

router.delete('/links/:linkId', requireQualityPermission(QUALITY_PERMISSIONS.SUPPLIES_WRITE), async (req, res) => {
  try {
    const linkId = cleanUuid(req.params.linkId);
    if (!linkId) return res.status(400).json({ error: 'Identifiant liaison invalide' });
    const link = await suppliesMaterials.archiveSupplyMaterialLink(req.dbPool, req.user.store_id, req.user.id, linkId);
    if (!link) return res.status(404).json({ error: 'Liaison introuvable' });
    res.json({ mode: 'archived', link });
  } catch (err) {
    handleError(res, err, 'Erreur DELETE /api/quality/supplies-materials/links/:linkId');
  }
});

module.exports = router;
