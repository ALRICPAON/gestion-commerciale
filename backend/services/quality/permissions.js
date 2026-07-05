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

const QUALITY_PERMISSION_LIST = Object.freeze(Object.values(QUALITY_PERMISSIONS));

function hasQualityPermission(user, permission) {
  if (!user || !permission) return false;
  if (user.role === 'admin') return true;

  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  return permissions.includes(permission) || permissions.includes(QUALITY_PERMISSIONS.ADMIN);
}

module.exports = {
  QUALITY_PERMISSIONS,
  QUALITY_PERMISSION_LIST,
  hasQualityPermission,
};
