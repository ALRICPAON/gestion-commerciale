const FINANCIAL_REPORT_PERMISSIONS = {
  READ: 'financial_reports.read',
  SYNC: 'financial_reports.sync',
  ADMIN: 'financial_reports.admin',
};

function userPermissions(user = {}) {
  if (!user) return new Set();
  if (user.role === 'admin') {
    return new Set(Object.values(FINANCIAL_REPORT_PERMISSIONS));
  }
  if (user.role === 'responsable') {
    return new Set([
      FINANCIAL_REPORT_PERMISSIONS.READ,
      FINANCIAL_REPORT_PERMISSIONS.SYNC,
    ]);
  }
  return new Set();
}

function hasFinancialReportPermission(user, permission) {
  return userPermissions(user).has(permission);
}

function requireFinancialReportPermission(permission) {
  return (req, res, next) => {
    if (hasFinancialReportPermission(req.user, permission)) return next();
    return res.status(403).json({ error: 'Acces compte d exploitation interdit' });
  };
}

module.exports = {
  FINANCIAL_REPORT_PERMISSIONS,
  hasFinancialReportPermission,
  requireFinancialReportPermission,
};
