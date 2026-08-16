const express = require('express');

const { authenticateToken } = require('../../middleware/auth');
const { attachDbContext } = require('../../middleware/dbContext');
const { requireQualityPermission } = require('../../middleware/quality/requireQualityPermission');
const { QUALITY_PERMISSIONS } = require('../../services/quality/permissions');
const {
  getQualityEvidenceRecord,
  listQualityEvidenceRecords,
} = require('../../services/quality/evidenceRecords');

const router = express.Router();

router.use(authenticateToken, attachDbContext);

function handleError(res, err, label) {
  console.error(label, err);
  res.status(err.status || 500).json({ error: err.publicMessage || err.message || 'Erreur serveur enregistrements qualite' });
}

router.get('/', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    res.json(await listQualityEvidenceRecords(req.dbPool, req.user.store_id, req.query));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/evidence-records');
  }
});

router.get('/:id', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    const record = await getQualityEvidenceRecord(req.dbPool, req.user.store_id, req.params.id);
    if (!record) return res.status(404).json({ error: 'Enregistrement qualite introuvable' });
    return res.json(record);
  } catch (err) {
    return handleError(res, err, 'Erreur GET /api/quality/evidence-records/:id');
  }
});

module.exports = router;
