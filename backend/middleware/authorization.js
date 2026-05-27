function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès interdit' });
  }

  next();
}

function requireAdminOrManager(req, res, next) {
  if (!req.user || !['admin', 'responsable'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Accès interdit' });
  }

  next();
}

module.exports = {
  requireAdmin,
  requireAdminOrManager,
};
