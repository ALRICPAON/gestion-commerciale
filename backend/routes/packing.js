const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const {
  addPackingMaterial,
  addPackingSourceLot,
  cancelPackingDraft,
  createPackingDraft,
  getPackingOperation,
  listPackingOperations,
  removePackingMaterial,
  removePackingSourceLot,
  updatePackingDraft,
  validatePackingOperation,
} = require('../services/packingService');

const router = express.Router();

function errorResponse(res, error) {
  const status = error.status || 500;
  if (status >= 500) console.error('Erreur packing :', error);
  return res.status(status).json({
    error: error.message || 'Erreur colisage',
    ...(error.code ? { code: error.code } : {}),
    ...(error.details ? { details: error.details } : {}),
  });
}

function baseInput(req) {
  return {
    storeId: req.user.store_id,
    userId: req.user.id || null,
    clientKey: req.user.client_key || null,
  };
}

router.get('/', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const rows = await listPackingOperations(req.dbPool, req.user.store_id, {
      status: req.query.status || null,
      limit: req.query.limit || 50,
    });
    res.json(rows);
  } catch (error) {
    errorResponse(res, error);
  }
});

router.get('/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const operation = await getPackingOperation(req.dbPool, req.user.store_id, req.params.id);
    res.json(operation);
  } catch (error) {
    errorResponse(res, error);
  }
});

router.post('/', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const operation = await createPackingDraft(req.dbPool, {
      ...baseInput(req),
      outputArticleId: req.body.output_article_id,
      packageCount: req.body.package_count,
      quantityPerPackage: req.body.quantity_per_package,
      totalOutputQuantity: req.body.total_output_quantity,
      notes: req.body.notes,
    });
    res.status(201).json(operation);
  } catch (error) {
    errorResponse(res, error);
  }
});

router.patch('/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const operation = await updatePackingDraft(req.dbPool, {
      ...baseInput(req),
      packingOperationId: req.params.id,
      outputArticleId: req.body.output_article_id,
      packageCount: req.body.package_count,
      quantityPerPackage: req.body.quantity_per_package,
      totalOutputQuantity: req.body.total_output_quantity,
      notes: req.body.notes,
    });
    res.json(operation);
  } catch (error) {
    errorResponse(res, error);
  }
});

router.post('/:id/source-lots', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const operation = await addPackingSourceLot(req.dbPool, {
      ...baseInput(req),
      packingOperationId: req.params.id,
      lotId: req.body.lot_id,
      quantityUsed: req.body.quantity_used,
    });
    res.status(201).json(operation);
  } catch (error) {
    errorResponse(res, error);
  }
});

router.delete('/:id/source-lots/:lineId', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const operation = await removePackingSourceLot(req.dbPool, {
      ...baseInput(req),
      packingOperationId: req.params.id,
      lineId: req.params.lineId,
    });
    res.json(operation);
  } catch (error) {
    errorResponse(res, error);
  }
});

router.post('/:id/materials', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const operation = await addPackingMaterial(req.dbPool, {
      ...baseInput(req),
      packingOperationId: req.params.id,
      lotId: req.body.lot_id,
      quantityUsed: req.body.quantity_used,
    });
    res.status(201).json(operation);
  } catch (error) {
    errorResponse(res, error);
  }
});

router.delete('/:id/materials/:lineId', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const operation = await removePackingMaterial(req.dbPool, {
      ...baseInput(req),
      packingOperationId: req.params.id,
      lineId: req.params.lineId,
    });
    res.json(operation);
  } catch (error) {
    errorResponse(res, error);
  }
});

router.post('/:id/validate', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const operation = await validatePackingOperation(req.dbPool, {
      ...baseInput(req),
      packingOperationId: req.params.id,
    });
    res.json(operation);
  } catch (error) {
    errorResponse(res, error);
  }
});

router.post('/:id/cancel', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const operation = await cancelPackingDraft(req.dbPool, {
      ...baseInput(req),
      packingOperationId: req.params.id,
    });
    res.json(operation);
  } catch (error) {
    errorResponse(res, error);
  }
});

module.exports = router;
