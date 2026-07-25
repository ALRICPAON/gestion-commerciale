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
  return ['admin', 'administrator'].includes(String(role || '').toLowerCase());
}

function permissionList(raw) {
  if (Array.isArray(raw)) return raw.map(normalizePermission).filter(Boolean);
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).filter(([, allowed]) => Boolean(allowed)).map(([name]) => normalizePermission(name));
  }
  return [];
}

function hasPermissionValue(permissions, requiredPermission) {
  return permissions.includes(requiredPermission) || permissions.includes('*');
}

function hasPermission(context, requiredPermission) {
  if (!requiredPermission) return true;
  const agentPermissions = permissionList(context.agent_permissions || context.agentPermissions || context.permissions);
  const userSidePermissions = context.user
    ? permissionList(context.user.permissions || context.user_permissions || context.userPermissions)
    : permissionList(context.permissions);
  const role = context.user?.role || context.role;
  const userAllowed = hasPermissionValue(userSidePermissions, requiredPermission) || isPrivilegedRole(role);
  const agentAllowed = hasPermissionValue(agentPermissions, requiredPermission);
  return userAllowed && agentAllowed;
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
  if (tool.status === 'planned' || tool.enabled === false) {
    const error = new Error(`Outil non disponible : ${tool.name}`);
    error.status = 409;
    error.expose = true;
    throw error;
  }
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
