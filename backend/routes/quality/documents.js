const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const { authenticateToken } = require('../../middleware/auth');
const { attachDbContext } = require('../../middleware/dbContext');
const { requireQualityPermission } = require('../../middleware/quality/requireQualityPermission');
const { QUALITY_PERMISSIONS } = require('../../services/quality/permissions');
const { documentPayload, photoPayload } = require('../../validators/quality/documents');
const {
  listDocuments,
  getDocument,
  createDocument,
  archiveDocument,
  restoreDocument,
  listPhotos,
  getPhoto,
  createPhoto,
  archivePhoto,
  restorePhoto,
} = require('../../services/quality/documents');

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
      cb(null, `${safeStore}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE },
});

router.use(authenticateToken, attachDbContext);

function handleError(res, err, label) {
  console.error(label, err);
  res.status(err.status || 500).json({ error: err.message || 'Erreur documents qualité' });
}

function requireOwner(payload) {
  return payload.owner_type && payload.owner_id;
}

router.get('/documents', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    res.json(await listDocuments(req.dbPool, req.user.store_id, req.query));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/documents');
  }
});

router.post('/documents', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENT_MANAGE), upload.single('file'), async (req, res) => {
  try {
    const payload = documentPayload(req.body);
    if (!requireOwner(payload)) return res.status(400).json({ error: 'Propriétaire document invalide' });
    if (!req.file) return res.status(400).json({ error: 'Fichier obligatoire' });
    const document = await createDocument(req.dbPool, req.user.store_id, req.user.id, payload, req.file);
    res.status(201).json(document);
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/documents');
  }
});

router.get('/documents/:id/download', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    const document = await getDocument(req.dbPool, req.user.store_id, req.params.id);
    if (!document) return res.status(404).json({ error: 'Document introuvable' });
    res.download(document.storage_path, document.original_filename);
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/documents/:id/download');
  }
});

router.patch('/documents/:id/restore', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENT_MANAGE), async (req, res) => {
  try {
    const document = await restoreDocument(req.dbPool, req.user.store_id, req.user.id, req.params.id);
    if (!document) return res.status(404).json({ error: 'Document introuvable' });
    res.json({ mode: 'restored', document });
  } catch (err) {
    handleError(res, err, 'Erreur PATCH /api/quality/documents/:id/restore');
  }
});

router.delete('/documents/:id', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENT_MANAGE), async (req, res) => {
  try {
    const document = await archiveDocument(req.dbPool, req.user.store_id, req.user.id, req.params.id);
    if (!document) return res.status(404).json({ error: 'Document introuvable' });
    res.json({ mode: 'archived', document });
  } catch (err) {
    handleError(res, err, 'Erreur DELETE /api/quality/documents/:id');
  }
});

router.get('/photos', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    res.json(await listPhotos(req.dbPool, req.user.store_id, req.query));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/photos');
  }
});

router.post('/photos', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENT_MANAGE), upload.single('file'), async (req, res) => {
  try {
    const payload = photoPayload(req.body);
    if (!requireOwner(payload)) return res.status(400).json({ error: 'Propriétaire photo invalide' });
    if (!req.file) return res.status(400).json({ error: 'Photo obligatoire' });
    if (!String(req.file.mimetype || '').startsWith('image/')) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Le fichier doit être une image' });
    }
    const photo = await createPhoto(req.dbPool, req.user.store_id, req.user.id, payload, req.file);
    res.status(201).json(photo);
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/photos');
  }
});

router.get('/photos/:id/file', requireQualityPermission(QUALITY_PERMISSIONS.READ), async (req, res) => {
  try {
    const photo = await getPhoto(req.dbPool, req.user.store_id, req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo introuvable' });
    res.sendFile(photo.storage_path);
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/photos/:id/file');
  }
});

router.patch('/photos/:id/restore', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENT_MANAGE), async (req, res) => {
  try {
    const photo = await restorePhoto(req.dbPool, req.user.store_id, req.user.id, req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo introuvable' });
    res.json({ mode: 'restored', photo });
  } catch (err) {
    handleError(res, err, 'Erreur PATCH /api/quality/photos/:id/restore');
  }
});

router.delete('/photos/:id', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENT_MANAGE), async (req, res) => {
  try {
    const photo = await archivePhoto(req.dbPool, req.user.store_id, req.user.id, req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo introuvable' });
    res.json({ mode: 'archived', photo });
  } catch (err) {
    handleError(res, err, 'Erreur DELETE /api/quality/photos/:id');
  }
});

module.exports = router;
