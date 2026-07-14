const express = require('express');

const { authenticateToken } = require('../../middleware/auth');
const { attachDbContext } = require('../../middleware/dbContext');
const {
  QUALITY_PERMISSION_LIST,
} = require('../../services/quality/permissions');
const { logQualityEvent } = require('../../services/quality/eventLogger');
const { queueQualityNotification } = require('../../services/quality/notifications');
const { createQualityPdfDocument } = require('../../pdf/quality/generator');
const zonesRoutes = require('./zones');
const equipmentsRoutes = require('./equipments');
const documentsRoutes = require('./documents');
const temperaturesRoutes = require('./temperatures');
const tasksRoutes = require('./tasks');
const cleaningRoutes = require('./cleaning');
const documentationRoutes = require('./documentation');
const documentBlockRoutes = require('./documentBlocks');

const router = express.Router();

router.use('/zones', zonesRoutes);
router.use('/equipments', equipmentsRoutes);
router.use('/temperatures', temperaturesRoutes);
router.use('/tasks', tasksRoutes);
router.use('/cleaning', cleaningRoutes);
router.use('/', documentBlockRoutes);
router.use('/documentation', documentationRoutes);

router.get('/foundation', authenticateToken, attachDbContext, async (req, res) => {
  const eventPreview = await logQualityEvent({
    dbPool: req.dbPool,
    storeId: req.user.store_id,
    actorId: req.user.id,
    eventType: 'quality.foundation.preview',
    targetType: 'quality.foundation',
  });

  res.json({
    module: 'quality',
    status: 'foundation_ready',
    message: 'Module Qualité en cours de construction',
    permissions: QUALITY_PERMISSION_LIST,
    services: {
      event_logger: eventPreview,
      notifications: await queueQualityNotification({
        storeId: req.user.store_id,
        type: 'quality.foundation.preview',
        title: 'Fondation Qualité',
      }),
      pdf: await createQualityPdfDocument({
        title: 'Qualité',
        subtitle: 'Fondation QMS',
      }),
    },
  });
});

router.get('/permissions', authenticateToken, (req, res) => {
  res.json({
    module: 'quality',
    permissions: QUALITY_PERMISSION_LIST,
  });
});

router.use('/', documentsRoutes);

module.exports = router;
