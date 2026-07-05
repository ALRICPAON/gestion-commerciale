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

const QUALITY_PERMISSION_LIST = Object.freeze(Object.values(QUALITY_PERMISSIONS));
const QUALITY_PRIVILEGED_ROLES = Object.freeze(['admin', 'responsable']);

function hasQualityPermission(user, permission) {
  if (!user || !permission) return false;
  if (QUALITY_PRIVILEGED_ROLES.includes(user.role)) return true;

  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  return permissions.includes(permission) || permissions.includes(QUALITY_PERMISSIONS.ADMIN);
}

module.exports = {
  QUALITY_PERMISSIONS,
  QUALITY_PERMISSION_LIST,
  QUALITY_PRIVILEGED_ROLES,
  hasQualityPermission,
};
