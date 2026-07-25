function normalizePermission(permission) {
  return String(permission || '').trim();
}

function userPermissions(context = {}) {
  const raw = context.permissions || context.user?.permissions || [];
  if (Array.isArray(raw)) return raw.map(normalizePermission).filter(Boolean);
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).filter(([, allowed]) => Boolean(allowed)).map(([name]) => normalizePermission(name));
  }
  return [];
}

function isPrivilegedRole(role) {
  return ['admin', 'administrator', 'manager', 'responsable'].includes(String(role || '').toLowerCase());
}

function hasPermission(context, requiredPermission) {
  if (!requiredPermission) return true;
  const permissions = userPermissions(context);
  if (permissions.includes(requiredPermission) || permissions.includes('*')) return true;
  return isPrivilegedRole(context.role || context.user?.role);
}

function assertAgentContext(context = {}) {
  if (!context.store_id) {
    const error = new Error('Contexte agent invalide : store_id authentifie manquant');
    error.status = 401;
    error.expose = true;
    throw error;
  }
}

function authorizeTool(tool, context = {}) {
  assertAgentContext(context);
  if (!hasPermission(context, tool.requiredPermission)) {
    const error = new Error(`Permission requise : ${tool.requiredPermission}`);
    error.status = 403;
    error.expose = true;
    throw error;
  }
  return true;
}

module.exports = {
  authorizeTool,
  hasPermission,
  userPermissions,
};
