const CASHFLOW_PERMISSIONS = {
  READ: 'cashflow.read',
  SYNC: 'cashflow.sync',
  MANAGE: 'cashflow.manage',
  SETTINGS: 'cashflow.settings',
};

function userPermissions(user = {}) {
  if (!user) return new Set();
  if (user.role === 'admin') return new Set(Object.values(CASHFLOW_PERMISSIONS));
  if (user.role === 'responsable') {
    return new Set([
      CASHFLOW_PERMISSIONS.READ,
      CASHFLOW_PERMISSIONS.SYNC,
      CASHFLOW_PERMISSIONS.MANAGE,
    ]);
  }
  return new Set();
}

function hasCashflowPermission(user, permission) {
  return userPermissions(user).has(permission);
}

function requireCashflowPermission(permission) {
  return (req, res, next) => {
    if (hasCashflowPermission(req.user, permission)) return next();
    return res.status(403).json({ error: 'Acces tresorerie interdit' });
  };
}

module.exports = {
  CASHFLOW_PERMISSIONS,
  hasCashflowPermission,
  requireCashflowPermission,
};
