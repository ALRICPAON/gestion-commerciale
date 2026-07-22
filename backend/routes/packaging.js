const express = require('express');

const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const {
  PACKAGING_PERMISSIONS,
  requirePackagingPermission,
} = require('../services/packaging/permissions');
const packagingService = require('../services/packaging/packagingService');

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value || '')
  );
}

function requireUuid(value, label) {
  if (!isUuid(value)) {
    const error = new Error(`${label} invalide`);
    error.status = 400;
    throw error;
  }
  return value;
}

function handleError(error, res) {
  const status = error.status || 500;
  if (status >= 500) {
    console.error('[Packaging] Erreur API', error);
  }

  res.status(status).json({
    error: error.message || 'Erreur module conditionnement',
    details: error.details,
  });
}

router.use(authenticateToken, attachDbContext);

router.get(
  '/items',
  requirePackagingPermission(PACKAGING_PERMISSIONS.READ),
  asyncHandler(async (req, res) => {
    const items = await packagingService.listItems(req.dbPool, req.user.store_id, {
      active: req.query.active,
      category: req.query.category,
      search: req.query.search,
    });

    res.json({ items });
  })
);

router.post(
  '/items',
  requirePackagingPermission(PACKAGING_PERMISSIONS.MANAGE_CATALOG),
  asyncHandler(async (req, res) => {
    const item = await packagingService.createItem(req.dbPool, req.user.store_id, req.user.id, req.body);
    res.status(201).json({ item });
  })
);

router.patch(
  '/items/:id',
  requirePackagingPermission(PACKAGING_PERMISSIONS.MANAGE_CATALOG),
  asyncHandler(async (req, res) => {
    const itemId = requireUuid(req.params.id, 'ID emballage');
    const item = await packagingService.updateItem(
      req.dbPool,
      req.user.store_id,
      itemId,
      req.user.id,
      req.body
    );

    if (!item) return res.status(404).json({ error: 'Emballage introuvable' });
    res.json({ item });
  })
);

router.post(
  '/items/:id/stock-movements',
  requirePackagingPermission(PACKAGING_PERMISSIONS.ADJUST_STOCK),
  asyncHandler(async (req, res) => {
    const packagingItemId = requireUuid(req.params.id, 'ID emballage');
    const result = await packagingService.recordStockMovement(req.dbPool, req.user.store_id, req.user.id, {
      ...req.body,
      packaging_item_id: packagingItemId,
    });

    res.status(201).json(result);
  })
);

router.get(
  '/stock-movements',
  requirePackagingPermission(PACKAGING_PERMISSIONS.READ),
  asyncHandler(async (req, res) => {
    const packagingItemId = req.query.packaging_item_id
      ? requireUuid(req.query.packaging_item_id, 'ID emballage')
      : null;
    const movements = await packagingService.listStockMovements(req.dbPool, req.user.store_id, {
      packaging_item_id: packagingItemId,
      limit: req.query.limit,
    });

    res.json({ movements });
  })
);

router.post(
  '/stock-movements/:id/cancel',
  requirePackagingPermission(PACKAGING_PERMISSIONS.ADJUST_STOCK),
  asyncHandler(async (req, res) => {
    const movementId = requireUuid(req.params.id, 'ID mouvement');
    const result = await packagingService.cancelStockMovement(
      req.dbPool,
      req.user.store_id,
      req.user.id,
      movementId,
      req.body
    );

    res.status(201).json(result);
  })
);

router.delete(
  '/stock-movements/:id',
  requirePackagingPermission(PACKAGING_PERMISSIONS.ADJUST_STOCK),
  asyncHandler(async (req, res) => {
    const movementId = requireUuid(req.params.id, 'ID mouvement');
    const movements = await packagingService.listStockMovements(req.dbPool, req.user.store_id, {
      id: movementId,
      limit: 1,
    });
    const movement = movements.find((row) => String(row.id) === String(movementId));
    packagingService.assertStockMovementCanBeDeleted(movement);
    res.status(204).end();
  })
);

router.get(
  '/profiles',
  requirePackagingPermission(PACKAGING_PERMISSIONS.READ),
  asyncHandler(async (req, res) => {
    const articleId = req.query.article_id ? requireUuid(req.query.article_id, 'ID article') : null;
    const profiles = await packagingService.listProfiles(req.dbPool, req.user.store_id, {
      active: req.query.active,
      article_id: articleId,
      limit: req.query.limit,
    });

    res.json({ profiles });
  })
);

router.get(
  '/articles/:articleId/profiles',
  requirePackagingPermission(PACKAGING_PERMISSIONS.READ),
  asyncHandler(async (req, res) => {
    const articleId = requireUuid(req.params.articleId, 'ID article');
    const profiles = await packagingService.listArticleProfiles(
      req.dbPool,
      req.user.store_id,
      articleId,
      req.query.include_inactive === 'true'
    );

    res.json({ profiles });
  })
);

router.post(
  '/articles/:articleId/profiles',
  requirePackagingPermission(PACKAGING_PERMISSIONS.MANAGE_PROFILES),
  asyncHandler(async (req, res) => {
    const articleId = requireUuid(req.params.articleId, 'ID article');
    const profile = await packagingService.upsertArticleProfile(req.dbPool, req.user.store_id, req.user.id, {
      ...req.body,
      article_id: articleId,
    });

    res.status(201).json({ profile });
  })
);

router.patch(
  '/profiles/:profileId',
  requirePackagingPermission(PACKAGING_PERMISSIONS.MANAGE_PROFILES),
  asyncHandler(async (req, res) => {
    const profileId = requireUuid(req.params.profileId, 'ID modele');
    const profile = await packagingService.upsertArticleProfile(req.dbPool, req.user.store_id, req.user.id, {
      ...req.body,
      id: profileId,
    });

    res.json({ profile });
  })
);

router.post(
  '/profiles/:profileId/deactivate',
  requirePackagingPermission(PACKAGING_PERMISSIONS.MANAGE_PROFILES),
  asyncHandler(async (req, res) => {
    const profileId = requireUuid(req.params.profileId, 'ID modele');
    const profile = await packagingService.deactivateProfile(req.dbPool, req.user.store_id, profileId, req.user.id);

    if (!profile) return res.status(404).json({ error: 'Modele de conditionnement introuvable' });
    res.json({ profile });
  })
);

router.post(
  '/operations/preview',
  requirePackagingPermission(PACKAGING_PERMISSIONS.READ),
  asyncHandler(async (req, res) => {
    const preview = await packagingService.buildOperationPreview(req.dbPool, req.user.store_id, req.body);
    res.json(preview);
  })
);

router.get(
  '/operations',
  requirePackagingPermission(PACKAGING_PERMISSIONS.READ),
  asyncHandler(async (req, res) => {
    const operations = await packagingService.listOperations(req.dbPool, req.user.store_id, req.query.limit);
    res.json({ operations });
  })
);

router.post(
  '/operations',
  requirePackagingPermission(PACKAGING_PERMISSIONS.CREATE_OPERATION),
  asyncHandler(async (req, res) => {
    const operation = await packagingService.createOperation(req.dbPool, req.user.store_id, req.user.id, req.body);
    res.status(201).json({ operation });
  })
);

router.post(
  '/operations/:id/validate',
  requirePackagingPermission(PACKAGING_PERMISSIONS.VALIDATE_OPERATION),
  asyncHandler(async (req, res) => {
    const operationId = requireUuid(req.params.id, 'ID operation');
    const operation = await packagingService.validateOperation(
      req.dbPool,
      req.user.store_id,
      req.user.id,
      operationId
    );

    res.json({ operation });
  })
);

router.post(
  '/operations/:id/cancel',
  requirePackagingPermission(PACKAGING_PERMISSIONS.VALIDATE_OPERATION),
  asyncHandler(async (req, res) => {
    const operationId = requireUuid(req.params.id, 'ID operation');
    const operation = await packagingService.cancelOperation(
      req.dbPool,
      req.user.store_id,
      req.user.id,
      operationId,
      req.body
    );

    res.json({ operation });
  })
);

router.get(
  '/returnables/balances',
  requirePackagingPermission(PACKAGING_PERMISSIONS.READ),
  asyncHandler(async (req, res) => {
    const balances = await packagingService.listReturnableBalances(req.dbPool, req.user.store_id);
    res.json({ balances });
  })
);

router.get(
  '/returnables/movements',
  requirePackagingPermission(PACKAGING_PERMISSIONS.READ),
  asyncHandler(async (req, res) => {
    const movements = await packagingService.listReturnableMovements(req.dbPool, req.user.store_id, req.query.limit);
    res.json({ movements });
  })
);

router.post(
  '/returnables/movements',
  requirePackagingPermission(PACKAGING_PERMISSIONS.MANAGE_RETURNABLES),
  asyncHandler(async (req, res) => {
    const movement = await packagingService.createReturnableMovement(
      req.dbPool,
      req.user.store_id,
      req.user.id,
      req.body
    );

    res.status(201).json({ movement });
  })
);

router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  return handleError(error, res);
});

module.exports = router;
