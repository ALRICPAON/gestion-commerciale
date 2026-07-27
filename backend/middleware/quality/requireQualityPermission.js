const { hasQualityPermission } = require('../../services/quality/permissions');

function requireQualityPermission(permission) {
  return function qualityPermissionMiddleware(req, res, next) {
    if (hasQualityPermission(req.user, permission)) {
      return next();
    }

    return res.status(403).json({ error: 'Accès qualité interdit' });
  };
}

function requireAnyQualityPermission(permissions = []) {
  return function qualityAnyPermissionMiddleware(req, res, next) {
    if (permissions.some((permission) => hasQualityPermission(req.user, permission))) {
      return next();
    }

    return res.status(403).json({ error: 'Acces qualite interdit' });
  };
}

module.exports = {
  requireAnyQualityPermission,
  requireQualityPermission,
};
