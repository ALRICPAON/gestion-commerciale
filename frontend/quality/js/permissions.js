(function () {
  const QUALITY_PERMISSIONS = Object.freeze({
    READ: 'quality.read',
    RECORD_CREATE: 'quality.record.create',
    NC_MANAGE: 'quality.nc.manage',
    AUDIT_MANAGE: 'quality.audit.manage',
    CRISIS_MANAGE: 'quality.crisis.manage',
    INSPECTION_EXPORT: 'quality.inspection.export',
    AI_USE: 'quality.ai.use',
    ADMIN: 'quality.admin',
  });

  function getQualityPermissions(user) {
    return Array.isArray(user?.permissions) ? user.permissions : [];
  }

  function hasQualityPermission(user, permission) {
    if (!user || !permission) return false;
    if (user.role === 'admin' || user.role === 'responsable') return true;
    const permissions = getQualityPermissions(user);
    return permissions.includes(permission) || permissions.includes(QUALITY_PERMISSIONS.ADMIN);
  }

  window.ALTA_QUALITY_PERMISSIONS = QUALITY_PERMISSIONS;
  window.hasQualityPermission = hasQualityPermission;
})();
