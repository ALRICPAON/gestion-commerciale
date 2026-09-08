const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const {
  addPurchaseLink,
  getSupplierControlDocument,
  isUuid,
  listPurchaseCandidates,
  listSupplierControlDocuments,
  removePurchaseLink,
} = require('../services/supplierControlService');

const router = express.Router();

function sendError(res, error, fallbackMessage) {
  const status = error.status || 500;
  if (status >= 500) console.error(fallbackMessage, error);
  return res.status(status).json({
    error: error.message || fallbackMessage,
    code: error.code || undefined,
    details: error.details || undefined,
  });
}

router.get('/supplier-control/documents', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const result = await listSupplierControlDocuments(req.dbPool, {
      storeId: req.user.store_id,
      filters: req.query || {},
    });
    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Erreur liste controle fournisseurs');
  }
});

router.get('/supplier-control/documents/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Identifiant document fournisseur invalide' });
    }

    const result = await getSupplierControlDocument(req.dbPool, {
      storeId: req.user.store_id,
      pennylaneSupplierInvoiceId: req.params.id,
    });
    if (!result) return res.status(404).json({ error: 'Document fournisseur Pennylane introuvable' });

    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Erreur detail controle fournisseur');
  }
});

router.get('/supplier-control/documents/:id/purchase-candidates', authenticateToken, attachDbContext, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Identifiant document fournisseur invalide' });
    }

    const result = await listPurchaseCandidates(req.dbPool, {
      storeId: req.user.store_id,
      documentId: req.params.id,
      dateWindowDays: req.query.date_window_days,
    });
    if (!result) return res.status(404).json({ error: 'Document fournisseur Pennylane introuvable' });

    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Erreur candidats BL controle fournisseur');
  }
});

router.post('/supplier-control/documents/:id/purchase-links', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Identifiant document fournisseur invalide' });
    }
    const purchaseId = req.body?.purchase_id;
    if (!isUuid(purchaseId)) {
      return res.status(400).json({ error: 'purchase_id invalide' });
    }

    const result = await addPurchaseLink(req.dbPool, {
      storeId: req.user.store_id,
      documentId: req.params.id,
      purchaseId,
      userId: req.user.id,
    });
    if (!result) return res.status(404).json({ error: 'Document fournisseur Pennylane introuvable' });

    return res.status(201).json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, 'Erreur ajout lien BL controle fournisseur');
  }
});

router.delete('/supplier-control/documents/:id/purchase-links/:purchaseId', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    if (!isUuid(req.params.id) || !isUuid(req.params.purchaseId)) {
      return res.status(400).json({ error: 'Identifiant document ou BL invalide' });
    }

    const result = await removePurchaseLink(req.dbPool, {
      storeId: req.user.store_id,
      documentId: req.params.id,
      purchaseId: req.params.purchaseId,
      userId: req.user.id,
    });
    if (!result) return res.status(404).json({ error: 'Document fournisseur Pennylane introuvable' });

    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, 'Erreur suppression lien BL controle fournisseur');
  }
});

module.exports = router;
