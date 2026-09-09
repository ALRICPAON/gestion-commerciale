const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const {
  addPurchaseLink,
  analyzeSupplierControlMatches,
  applySupplierControlMatch,
  getSupplierControlDocument,
  isUuid,
  listPurchaseCandidates,
  listSupplierControlDocuments,
  resolveSupplierControlDifference,
  removePurchaseLink,
  validateSupplierControlDocument,
} = require('../services/supplierControlService');
const {
  applyCreditNoteMatch,
  cancelExpectedCreditNote,
  createExpectedCreditNote,
  getExpectedCreditNote,
  listCreditNoteMatchCandidates,
  listExpectedCreditNotes,
  listExpectedCreditNotesForPurchase,
  removeCreditNoteLink,
} = require('../services/supplierExpectedCreditNoteService');
const {
  createSupplierStockEffect,
  listStockEffectsForExpectedCreditNote,
} = require('../services/supplierStockEffectService');

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

router.get('/supplier-control/expected-credit-notes', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const result = await listExpectedCreditNotes(req.dbPool, {
      storeId: req.user.store_id,
      filters: req.query || {},
    });
    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Erreur liste avoirs attendus');
  }
});

router.post('/supplier-control/expected-credit-notes', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const result = await createExpectedCreditNote(req.dbPool, {
      storeId: req.user.store_id,
      payload: req.body || {},
      userId: req.user.id,
      source: 'manual',
    });
    return res.status(result.idempotent ? 200 : 201).json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, 'Erreur creation avoir attendu');
  }
});

router.get('/supplier-control/expected-credit-notes/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Identifiant attente avoir invalide' });
    }
    const result = await getExpectedCreditNote(req.dbPool, {
      storeId: req.user.store_id,
      expectedCreditNoteId: req.params.id,
    });
    if (!result) return res.status(404).json({ error: 'Attente avoir introuvable' });
    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Erreur detail avoir attendu');
  }
});

router.get('/supplier-control/expected-credit-notes/:id/stock-effects', authenticateToken, attachDbContext, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Identifiant attente avoir invalide' });
    }
    const expected = await getExpectedCreditNote(req.dbPool, {
      storeId: req.user.store_id,
      expectedCreditNoteId: req.params.id,
    });
    if (!expected) return res.status(404).json({ error: 'Attente avoir introuvable' });
    const result = await listStockEffectsForExpectedCreditNote(req.dbPool, {
      storeId: req.user.store_id,
      expectedCreditNoteId: req.params.id,
    });
    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Erreur effets stock avoir attendu');
  }
});

router.post('/supplier-control/stock-effects/destruction', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const result = await createSupplierStockEffect(req.dbPool, {
      storeId: req.user.store_id,
      clientKey: req.user.client_key || null,
      type: 'destruction',
      payload: req.body || {},
      userId: req.user.id,
    });
    return res.status(result.idempotent ? 200 : 201).json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, 'Erreur destruction stock fournisseur');
  }
});

router.post('/supplier-control/stock-effects/supplier-return', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const result = await createSupplierStockEffect(req.dbPool, {
      storeId: req.user.store_id,
      clientKey: req.user.client_key || null,
      type: 'supplier_return',
      payload: req.body || {},
      userId: req.user.id,
    });
    return res.status(result.idempotent ? 200 : 201).json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, 'Erreur retour stock fournisseur');
  }
});

router.get('/supplier-control/purchases/:purchaseId/expected-credit-notes', authenticateToken, attachDbContext, async (req, res) => {
  try {
    if (!isUuid(req.params.purchaseId)) {
      return res.status(400).json({ error: 'Identifiant BL invalide' });
    }
    const result = await listExpectedCreditNotesForPurchase(req.dbPool, {
      storeId: req.user.store_id,
      purchaseId: req.params.purchaseId,
    });
    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Erreur avoirs attendus du BL');
  }
});

router.post('/supplier-control/expected-credit-notes/:id/cancel', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Identifiant attente avoir invalide' });
    }
    const result = await cancelExpectedCreditNote(req.dbPool, {
      storeId: req.user.store_id,
      expectedCreditNoteId: req.params.id,
      comment: req.body?.comment,
      userId: req.user.id,
    });
    if (!result) return res.status(404).json({ error: 'Attente avoir introuvable' });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, 'Erreur annulation avoir attendu');
  }
});

router.get('/supplier-control/credit-notes/:id/match-candidates', authenticateToken, attachDbContext, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Identifiant avoir Pennylane invalide' });
    }
    const result = await listCreditNoteMatchCandidates(req.dbPool, {
      storeId: req.user.store_id,
      creditNoteId: req.params.id,
    });
    if (!result) return res.status(404).json({ error: 'Avoir Pennylane introuvable' });
    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Erreur candidats avoir fournisseur');
  }
});

router.post('/supplier-control/credit-notes/:id/apply-match', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Identifiant avoir Pennylane invalide' });
    }
    const result = await applyCreditNoteMatch(req.dbPool, {
      storeId: req.user.store_id,
      creditNoteId: req.params.id,
      expectedCreditNoteIds: req.body?.expected_credit_note_ids,
      applications: req.body?.applications,
      userId: req.user.id,
    });
    if (!result) return res.status(404).json({ error: 'Avoir Pennylane introuvable' });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, 'Erreur rattachement avoir fournisseur');
  }
});

router.delete('/supplier-control/credit-notes/:id/links/:linkId', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    if (!isUuid(req.params.id) || !isUuid(req.params.linkId)) {
      return res.status(400).json({ error: 'Identifiant avoir ou lien invalide' });
    }
    const result = await removeCreditNoteLink(req.dbPool, {
      storeId: req.user.store_id,
      creditNoteId: req.params.id,
      linkId: req.params.linkId,
      comment: req.body?.comment,
      userId: req.user.id,
    });
    if (!result) return res.status(404).json({ error: 'Lien avoir introuvable' });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, 'Erreur retrait rattachement avoir');
  }
});

router.post('/supplier-control/documents/:id/analyze', authenticateToken, attachDbContext, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Identifiant document fournisseur invalide' });
    }

    const result = await analyzeSupplierControlMatches(req.dbPool, {
      storeId: req.user.store_id,
      documentId: req.params.id,
      userId: req.user.id,
      dateWindowDays: req.body?.date_window_days,
    });
    if (!result) return res.status(404).json({ error: 'Document fournisseur Pennylane introuvable' });

    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, 'Erreur analyse controle fournisseur');
  }
});

router.post('/supplier-control/documents/:id/apply-match', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Identifiant document fournisseur invalide' });
    }

    const result = await applySupplierControlMatch(req.dbPool, {
      storeId: req.user.store_id,
      documentId: req.params.id,
      purchaseIds: req.body?.purchase_ids,
      userId: req.user.id,
    });
    if (!result) return res.status(404).json({ error: 'Document fournisseur Pennylane introuvable' });

    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, 'Erreur application rapprochement controle fournisseur');
  }
});

router.post('/supplier-control/documents/:id/resolve-difference', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Identifiant document fournisseur invalide' });
    }

    const result = await resolveSupplierControlDifference(req.dbPool, {
      storeId: req.user.store_id,
      documentId: req.params.id,
      resolutionType: req.body?.resolution_type,
      comment: req.body?.comment,
      expectedCreditNoteAmount: req.body?.expected_credit_note_amount,
      userId: req.user.id,
    });
    if (!result) return res.status(404).json({ error: 'Document fournisseur Pennylane introuvable' });

    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, 'Erreur resolution ecart controle fournisseur');
  }
});

router.post('/supplier-control/documents/:id/validate', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Identifiant document fournisseur invalide' });
    }

    const result = await validateSupplierControlDocument(req.dbPool, {
      storeId: req.user.store_id,
      documentId: req.params.id,
      confirmation: req.body?.confirmation,
      comment: req.body?.comment,
      userId: req.user.id,
    });
    if (!result) return res.status(404).json({ error: 'Document fournisseur Pennylane introuvable' });

    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, 'Erreur validation controle fournisseur');
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
