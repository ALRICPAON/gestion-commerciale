const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const { authenticateToken } = require('../../middleware/auth');
const { attachDbContext } = require('../../middleware/dbContext');
const { requireQualityPermission } = require('../../middleware/quality/requireQualityPermission');
const { QUALITY_PERMISSIONS } = require('../../services/quality/permissions');
const {
  createMissingItem,
  createSection,
  deleteSection,
  getDocumentation,
  getOrCreateDefaultDocumentation,
  listDocumentation,
  listMissingItems,
  updateMissingItem,
  updateSection,
} = require('../../services/quality/qualityDocumentationService');
const {
  listSectionVersions,
  restoreSectionVersion,
} = require('../../services/quality/qualityDocumentationVersionService');
const {
  exportDocumentationPdf,
  renderDocumentationPdf,
} = require('../../services/quality/qualityDocumentationExportService');

const router = express.Router();
const UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'uploads', 'quality-documentation-attachments');
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf'];
const ALLOWED_MIME_TYPES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) { cb(null, UPLOAD_DIR); },
    filename(req, file, cb) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeStore = String(req.user.store_id || 'store').replace(/[^a-zA-Z0-9-]/g, '');
      cb(null, `${safeStore}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter(req, file, cb) {
    const mime = String(file.mimetype || '');
    const allowed = ALLOWED_MIME_TYPES.has(mime) || ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
    cb(allowed ? null : Object.assign(new Error('Type de fichier non autorise'), { status: 400 }), allowed);
  },
});

router.use(authenticateToken, attachDbContext);

function handleError(res, err, label) {
  console.error(label, err);
  res.status(err.status || 500).json({ error: err.message || 'Erreur documentation qualite' });
}

function exportOptions(body = {}) {
  return {
    export_type: body.export_type || 'full',
    tome_id: body.tome_id || null,
    only_validated: body.only_validated === true,
    include_missing: body.include_missing !== false,
    include_attachments: body.include_attachments !== false,
  };
}

router.get('/', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_READ), async (req, res) => {
  try {
    const collections = await listDocumentation(req.dbPool, req.user.store_id);
    res.json({ collections });
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/documentation');
  }
});

router.post('/', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_CREATE), async (req, res) => {
  try {
    const documentation = await getOrCreateDefaultDocumentation(req.dbPool, req.user.store_id, req.user.id);
    res.status(201).json(documentation);
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/documentation');
  }
});

router.get('/default', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_READ), async (req, res) => {
  try {
    res.json(await getOrCreateDefaultDocumentation(req.dbPool, req.user.store_id, req.user.id));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/documentation/default');
  }
});

router.get('/missing-items', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_READ), async (req, res) => {
  try {
    res.json(await listMissingItems(req.dbPool, req.user.store_id, req.query));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/documentation/missing-items');
  }
});

router.post('/missing-items', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_EDIT), async (req, res) => {
  try {
    res.status(201).json(await createMissingItem(req.dbPool, req.user.store_id, req.user.id, req.body));
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/documentation/missing-items');
  }
});

router.patch('/missing-items/:id', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_EDIT), async (req, res) => {
  try {
    const item = await updateMissingItem(req.dbPool, req.user.store_id, req.params.id, req.user.id, req.body);
    if (!item) return res.status(404).json({ error: 'Information manquante introuvable' });
    res.json(item);
  } catch (err) {
    handleError(res, err, 'Erreur PATCH /api/quality/documentation/missing-items/:id');
  }
});

router.get('/sections/:sectionId', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_READ), async (req, res) => {
  try {
    const result = await req.dbPool.query('SELECT * FROM quality_documentation_sections WHERE id = $1 AND store_id = $2 LIMIT 1', [req.params.sectionId, req.user.store_id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Chapitre introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/documentation/sections/:sectionId');
  }
});

router.patch('/sections/:sectionId', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_EDIT), async (req, res) => {
  try {
    const section = await updateSection(req.dbPool, req.user.store_id, req.params.sectionId, req.user.id, req.body);
    if (!section) return res.status(404).json({ error: 'Chapitre introuvable' });
    res.json(section);
  } catch (err) {
    handleError(res, err, 'Erreur PATCH /api/quality/documentation/sections/:sectionId');
  }
});

router.delete('/sections/:sectionId', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_DELETE), async (req, res) => {
  try {
    const section = await deleteSection(req.dbPool, req.user.store_id, req.params.sectionId, req.user.id);
    if (!section) return res.status(404).json({ error: 'Chapitre introuvable' });
    res.json({ mode: 'archived', section });
  } catch (err) {
    handleError(res, err, 'Erreur DELETE /api/quality/documentation/sections/:sectionId');
  }
});

router.get('/sections/:sectionId/versions', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_READ), async (req, res) => {
  try {
    res.json(await listSectionVersions(req.dbPool, req.user.store_id, req.params.sectionId));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/documentation/sections/:sectionId/versions');
  }
});

router.post('/sections/:sectionId/restore-version', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_EDIT), async (req, res) => {
  try {
    const section = await restoreSectionVersion(req.dbPool, req.user.store_id, req.params.sectionId, req.body.version_id, req.user.id);
    if (!section) return res.status(404).json({ error: 'Version introuvable' });
    res.json(section);
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/documentation/sections/:sectionId/restore-version');
  }
});

router.post('/sections/:sectionId/attachments', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_EDIT), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier obligatoire' });
    const section = await req.dbPool.query('SELECT id FROM quality_documentation_sections WHERE id = $1 AND store_id = $2 LIMIT 1', [req.params.sectionId, req.user.store_id]);
    if (!section.rows[0]) return res.status(404).json({ error: 'Chapitre introuvable' });
    const result = await req.dbPool.query(
      `INSERT INTO quality_documentation_attachments
       (section_id, store_id, filename, original_filename, mime_type, file_path, file_size, include_in_export, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [req.params.sectionId, req.user.store_id, req.body.filename || req.file.originalname, req.file.originalname, req.file.mimetype, req.file.path, req.file.size, req.body.include_in_export !== 'false', req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/documentation/sections/:sectionId/attachments');
  }
});

router.delete('/attachments/:id', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_DELETE), async (req, res) => {
  try {
    const result = await req.dbPool.query(
      `UPDATE quality_documentation_attachments
       SET archived_at = COALESCE(archived_at, now())
       WHERE id = $1 AND store_id = $2
       RETURNING *`,
      [req.params.id, req.user.store_id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Piece jointe introuvable' });
    res.json({ mode: 'archived', attachment: result.rows[0] });
  } catch (err) {
    handleError(res, err, 'Erreur DELETE /api/quality/documentation/attachments/:id');
  }
});

router.get('/attachments/:id/download', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_READ), async (req, res) => {
  try {
    const result = await req.dbPool.query('SELECT * FROM quality_documentation_attachments WHERE id = $1 AND store_id = $2 LIMIT 1', [req.params.id, req.user.store_id]);
    const attachment = result.rows[0];
    if (!attachment || attachment.archived_at) return res.status(404).json({ error: 'Piece jointe introuvable' });
    res.download(attachment.file_path, attachment.original_filename || attachment.filename);
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/documentation/attachments/:id/download');
  }
});

router.get('/:id', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_READ), async (req, res) => {
  try {
    const documentation = await getDocumentation(req.dbPool, req.user.store_id, req.params.id);
    if (!documentation) return res.status(404).json({ error: 'Dossier documentaire introuvable' });
    res.json(documentation);
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/documentation/:id');
  }
});

router.get('/:id/sections', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_READ), async (req, res) => {
  try {
    const documentation = await getDocumentation(req.dbPool, req.user.store_id, req.params.id);
    if (!documentation) return res.status(404).json({ error: 'Dossier documentaire introuvable' });
    res.json(documentation.sections);
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/documentation/:id/sections');
  }
});

router.post('/:id/sections', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_EDIT), async (req, res) => {
  try {
    res.status(201).json(await createSection(req.dbPool, req.user.store_id, req.params.id, req.user.id, req.body));
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/documentation/:id/sections');
  }
});

router.post('/:id/preview', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_EXPORT), async (req, res) => {
  try {
    const rendered = await renderDocumentationPdf(req.dbPool, req.user.store_id, req.params.id, exportOptions(req.body));
    if (!rendered) return res.status(404).json({ error: 'Dossier documentaire introuvable' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="apercu-documentation-qualite.pdf"');
    res.send(rendered.pdf);
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/documentation/:id/preview');
  }
});

router.post('/:id/export-pdf', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_EXPORT), async (req, res) => {
  try {
    const exported = await exportDocumentationPdf(req.dbPool, req.user.store_id, req.params.id, req.user.id, exportOptions(req.body));
    if (!exported) return res.status(404).json({ error: 'Dossier documentaire introuvable' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.send(exported.pdf);
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/documentation/:id/export-pdf');
  }
});

router.get('/:id/exports', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_READ), async (req, res) => {
  try {
    const result = await req.dbPool.query(
      `SELECT id, export_type, version, options_json, filename, generated_by, generated_at
       FROM quality_documentation_exports
       WHERE collection_id = $1 AND store_id = $2
       ORDER BY generated_at DESC`,
      [req.params.id, req.user.store_id]
    );
    res.json(result.rows);
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/documentation/:id/exports');
  }
});

module.exports = router;
