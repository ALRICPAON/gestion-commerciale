const PACKAGING_PERMISSIONS = {
  READ: 'packaging.read',
  MANAGE_CATALOG: 'packaging.manage_catalog',
  MANAGE_PROFILES: 'packaging.manage_profiles',
  CREATE_OPERATION: 'packaging.create_operation',
  VALIDATE_OPERATION: 'packaging.validate_operation',
  ADJUST_STOCK: 'packaging.adjust_stock',
  MANAGE_RETURNABLES: 'packaging.manage_returnables',
};

const MANAGER_ROLES = ['admin', 'responsable'];

function hasPackagingPermission(user, permission) {
  if (!user) return false;
  if (permission === PACKAGING_PERMISSIONS.READ) return true;
  return MANAGER_ROLES.includes(user.role);
}

function requirePackagingPermission(permission) {
  return (req, res, next) => {
    if (!hasPackagingPermission(req.user, permission)) {
      return res.status(403).json({ error: 'Acces interdit au module conditionnement' });
    }

    next();
  };
}

module.exports = {
  PACKAGING_PERMISSIONS,
  hasPackagingPermission,
  requirePackagingPermission,
};
