const express = require('express');

const { authenticateToken } = require('../../middleware/auth');
const { attachDbContext } = require('../../middleware/dbContext');
const { requireQualityPermission } = require('../../middleware/quality/requireQualityPermission');
const { QUALITY_PERMISSIONS } = require('../../services/quality/permissions');
const masterDocuments = require('../../services/quality/masterDocuments');

const router = express.Router();

router.use(authenticateToken, attachDbContext);

function handleError(res, err, label) {
  console.error(label, err);
  res.status(err.status || 500).json({ error: err.message || 'Erreur referentiel documentaire qualite' });
}

router.get('/', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_READ), async (req, res) => {
  try {
    res.json({ documents: await masterDocuments.listMasterDocuments(req.dbPool, req.user.store_id, req.query) });
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/master-documents');
  }
});

router.post('/', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_EDIT), async (req, res) => {
  try {
    const document = await masterDocuments.createMasterDocument(req.dbPool, req.user.store_id, req.user.id, req.body);
    res.status(201).json({ document });
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/master-documents');
  }
});

router.get('/references', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_READ), async (req, res) => {
  try {
    res.json({ references: await masterDocuments.listDocumentReferences(req.dbPool, req.user.store_id, req.query) });
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/master-documents/references');
  }
});

router.post('/references', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_EDIT), async (req, res) => {
  try {
    const reference = await masterDocuments.addDocumentReference(req.dbPool, req.user.store_id, req.user.id, req.body);
    res.status(201).json({ reference });
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/master-documents/references');
  }
});

router.delete('/references/:id', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_EDIT), async (req, res) => {
  try {
    const reference = await masterDocuments.archiveDocumentReference(req.dbPool, req.user.store_id, req.user.id, req.params.id);
    if (!reference) return res.status(404).json({ error: 'Reference documentaire introuvable' });
    res.json({ mode: 'archived', reference });
  } catch (err) {
    handleError(res, err, 'Erreur DELETE /api/quality/master-documents/references/:id');
  }
});

router.get('/target/:targetType/:targetId', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_READ), async (req, res) => {
  try {
    const references = await masterDocuments.getDocumentsForTarget(req.dbPool, req.user.store_id, req.params.targetType, req.params.targetId);
    res.json({ references });
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/master-documents/target/:targetType/:targetId');
  }
});

router.get('/applicable/:targetType/:targetId', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_READ), async (req, res) => {
  try {
    const references = await masterDocuments.getApplicableDocumentsForTarget(req.dbPool, req.user.store_id, req.params.targetType, req.params.targetId);
    res.json({ references });
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/master-documents/applicable/:targetType/:targetId');
  }
});

router.get('/diagnostics/duplicates', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_READ), async (req, res) => {
  try {
    res.json(await masterDocuments.diagnoseDuplicates(req.dbPool, req.user.store_id));
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/master-documents/diagnostics/duplicates');
  }
});

router.post('/link-existing-attachment', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_EDIT), async (req, res) => {
  try {
    res.status(201).json(await masterDocuments.linkExistingAttachmentToMasterDocument(req.dbPool, req.user.store_id, req.user.id, req.body));
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/master-documents/link-existing-attachment');
  }
});

router.post('/compare', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_READ), async (req, res) => {
  try {
    res.json(await masterDocuments.compareDocuments(req.dbPool, req.user.store_id, req.body.first_document_id, req.body.second_document_id));
  } catch (err) {
    handleError(res, err, 'Erreur POST /api/quality/master-documents/compare');
  }
});

router.get('/:id', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_READ), async (req, res) => {
  try {
    const document = await masterDocuments.getMasterDocument(req.dbPool, req.user.store_id, req.params.id);
    if (!document) return res.status(404).json({ error: 'Document maitre introuvable' });
    res.json({ document });
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/master-documents/:id');
  }
});

router.get('/:id/export-pdf', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_EXPORT), async (req, res) => {
  try {
    const rendered = await masterDocuments.renderMasterDocumentPdf(req.dbPool, req.user.store_id, req.params.id);
    if (!rendered) return res.status(404).json({ error: 'Document maitre introuvable' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${rendered.filename}"`);
    res.send(rendered.pdf);
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/master-documents/:id/export-pdf');
  }
});

router.patch('/:id', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_EDIT), async (req, res) => {
  try {
    const document = await masterDocuments.updateMasterDocument(req.dbPool, req.user.store_id, req.params.id, req.user.id, req.body);
    if (!document) return res.status(404).json({ error: 'Document maitre introuvable' });
    res.json({ document });
  } catch (err) {
    handleError(res, err, 'Erreur PATCH /api/quality/master-documents/:id');
  }
});

router.delete('/:id', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_EDIT), async (req, res) => {
  try {
    const document = await masterDocuments.archiveMasterDocument(req.dbPool, req.user.store_id, req.params.id, req.user.id);
    if (!document) return res.status(404).json({ error: 'Document maitre introuvable' });
    res.json({ mode: 'archived', document });
  } catch (err) {
    handleError(res, err, 'Erreur DELETE /api/quality/master-documents/:id');
  }
});

router.get('/:id/incoming-references', requireQualityPermission(QUALITY_PERMISSIONS.DOCUMENTATION_READ), async (req, res) => {
  try {
    res.json({ references: await masterDocuments.listIncomingReferences(req.dbPool, req.user.store_id, req.params.id) });
  } catch (err) {
    handleError(res, err, 'Erreur GET /api/quality/master-documents/:id/incoming-references');
  }
});

module.exports = router;
