const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const { authenticateToken } = require('../../middleware/auth');
const { attachDbContext } = require('../../middleware/dbContext');
const { requireQualityPermission } = require('../../middleware/quality/requireQualityPermission');
const { QUALITY_PERMISSIONS } = require('../../services/quality/permissions');
const { createDocument, createPhoto } = require('../../services/quality/documents');
const operations = require('../../services/quality/operations');
const { cleanUuid } = require('../../validators/quality/tasks');

const router = express.Router();
const UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'uploads', 'quality-documents');
const MAX_FILE_SIZE = 20 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      cb(null, UPLOAD_DIR);
    },
    filename(req, file, cb) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeStore = String(req.user.store_id || 'store').replace(/[^a-zA-Z0-9-]/g, '');
      cb(null, `${safeStore}-evidence-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE },
});

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

function evidenceOwner(body = {}) {
  const equipmentId = cleanUuid(body.equipment_id);
  if (equipmentId) return { owner_type: 'equipment', owner_id: equipmentId };
  const zoneId = cleanUuid(body.zone_id);
  if (zoneId) return { owner_type: 'zone', owner_id: zoneId };
  return null;
}

router.post('/evidence/photos', requireQualityPermission(QUALITY_PERMISSIONS.RECORD_CREATE), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Photo obligatoire' });
    if (!String(req.file.mimetype || '').startsWith('image/')) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Le fichier doit etre une image' });
    }
    const owner = evidenceOwner(req.body);
    if (!owner) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Zone ou equipement obligatoire pour relier la preuve' });
    }
    const photo = await createPhoto(req.dbPool, req.user.store_id, req.user.id, {
      ...owner,
      caption: req.body.caption || 'Preuve operationnelle qualite',
      author: req.user.email || req.user.name || null,
      is_primary: false,
    }, req.file);
    res.status(201).json({ photo, evidence_photo_id: photo.id });
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/operations/evidence/photos');
  }
});

router.post('/evidence/documents', requireQualityPermission(QUALITY_PERMISSIONS.RECORD_CREATE), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier obligatoire' });
    const owner = evidenceOwner(req.body);
    if (!owner) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Zone ou equipement obligatoire pour relier la preuve' });
    }
    const document = await createDocument(req.dbPool, req.user.store_id, req.user.id, {
      ...owner,
      type_code: 'AUTRE',
      name: req.body.name || req.file.originalname || 'Preuve operationnelle qualite',
      description: req.body.description || 'Preuve jointe depuis une execution qualite',
      author: req.user.email || req.user.name || null,
    }, req.file);
    res.status(201).json({ document, evidence_document_id: document.id });
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/operations/evidence/documents');
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
