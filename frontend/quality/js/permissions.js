(function () {
  const QUALITY_PERMISSIONS = Object.freeze({
    READ: 'quality.read',
    RECORD_CREATE: 'quality.record.create',
    EQUIPMENT_MANAGE: 'quality.equipment.manage',
    NC_MANAGE: 'quality.nc.manage',
    ACTION_MANAGE: 'quality.action.manage',
    AUDIT_MANAGE: 'quality.audit.manage',
    CRISIS_MANAGE: 'quality.crisis.manage',
    DOCUMENT_MANAGE: 'quality.document.manage',
    INSPECTION_EXPORT: 'quality.inspection.export',
    AI_USE: 'quality.ai.use',
    ADMIN: 'quality.admin',
  });
  const QUALITY_PRIVILEGED_ROLES = Object.freeze(['admin', 'responsable']);

  function getQualityPermissions(user) {
    return Array.isArray(user?.permissions) ? user.permissions : [];
  }

  function hasQualityPermission(user, permission) {
    if (!user || !permission) return false;
    if (QUALITY_PRIVILEGED_ROLES.includes(user.role)) return true;
    const permissions = getQualityPermissions(user);
    return permissions.includes(permission) || permissions.includes(QUALITY_PERMISSIONS.ADMIN);
  }

  window.ALTA_QUALITY_PERMISSIONS = QUALITY_PERMISSIONS;
  window.ALTA_QUALITY_PRIVILEGED_ROLES = QUALITY_PRIVILEGED_ROLES;
  window.hasQualityPermission = hasQualityPermission;
})();
