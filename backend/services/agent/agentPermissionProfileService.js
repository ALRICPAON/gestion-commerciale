const { FINAL_AGENT_PERMISSIONS } = require('./agentFullCoverageService');

const OWNER_ADMIN_PERMISSION_EXTENSIONS = Object.freeze([
  'quality.record.create',
  'supplies_materials.read',
  'supplies_materials.write',
  'supplies_materials.archive',
  'supplies_materials.documents',
]);

function uniquePermissions(permissions = []) {
  return [...new Set((permissions || []).map((permission) => String(permission || '').trim()).filter(Boolean))];
}

function parseAgentPermissions(value = process.env.ALTA_AGENT_PERMISSIONS || '') {
  return uniquePermissions(String(value || '').split(','));
}

function isOwnerAdminRole(role) {
  return ['trusted_owner', 'admin', 'administrator'].includes(String(role || '').trim().toLowerCase());
}

function resolveAgentPermissions({
  role = null,
  configuredPermissions = parseAgentPermissions(),
  fallbackPermissions = FINAL_AGENT_PERMISSIONS,
} = {}) {
  const configured = uniquePermissions(configuredPermissions);
  const base = configured.length ? configured : uniquePermissions(fallbackPermissions);
  if (!isOwnerAdminRole(role)) return base;
  return uniquePermissions([...base, ...OWNER_ADMIN_PERMISSION_EXTENSIONS]);
}

module.exports = {
  OWNER_ADMIN_PERMISSION_EXTENSIONS,
  isOwnerAdminRole,
  parseAgentPermissions,
  resolveAgentPermissions,
  uniquePermissions,
};
