const { hasQualityPermission } = require('../../services/quality/permissions');

function requireQualityPermission(permission) {
  return function qualityPermissionMiddleware(req, res, next) {
    if (hasQualityPermission(req.user, permission)) {
      return next();
    }

    return res.status(403).json({ error: 'Accès qualité interdit' });
  };
}

module.exports = {
  requireQualityPermission,
};
