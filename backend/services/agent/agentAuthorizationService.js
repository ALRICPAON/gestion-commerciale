const { isTrustedOwnerMode } = require('./agentTrustedMode');

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
  let permissions = [];
  if (Array.isArray(raw)) permissions = raw.map(normalizePermission).filter(Boolean);
  else if (raw && typeof raw === 'object') {
    permissions = Object.entries(raw).filter(([, allowed]) => Boolean(allowed)).map(([name]) => normalizePermission(name));
  }
  const expanded = new Set(permissions);
  if (expanded.has('quality.documentation.edit')) expanded.add('quality.documentation.read');
  if (expanded.has('quality.document.edit')) expanded.add('quality.document.read');
  if (expanded.has('quality.documentation.read')) expanded.add('quality.document.read');
  if (expanded.has('quality.document.read')) expanded.add('quality.documentation.read');
  if (expanded.has('quality.documentation.edit')) expanded.add('quality.document.edit');
  if (expanded.has('quality.document.edit')) expanded.add('quality.documentation.edit');
  if (expanded.has('quality.documentation.export')) expanded.add('quality.document.export');
  if (expanded.has('quality.document.export')) expanded.add('quality.documentation.export');
  if (expanded.has('quality.configuration.write')) expanded.add('quality.read');
  return [...expanded];
}

function hasPermissionValue(permissions, requiredPermission) {
  return permissions.includes(requiredPermission) || permissions.includes('*');
}

function hasPermission(context, requiredPermission) {
  if (!requiredPermission) return true;
  if (isTrustedOwnerMode(context)) return true;
  const agentPermissions = permissionList(context.agent_permissions || context.agentPermissions || context.permissions);
  const userSidePermissions = permissionList(context.user_permissions || context.userPermissions || context.user?.permissions || context.permissions);
  const role = context.user?.role || context.role;
  const userAllowed = hasPermissionValue(userSidePermissions, requiredPermission) || isPrivilegedRole(role);
  const agentAllowed = hasPermissionValue(agentPermissions, requiredPermission);
  return userAllowed && agentAllowed;
}

function safePermissionLog(tool, context = {}) {
  return {
    tool: tool.name,
    required_permission: tool.requiredPermission,
    required_permissions: tool.requiredPermissions || (tool.requiredPermission ? [tool.requiredPermission] : []),
    role: context.user?.role || context.role || null,
    user_permissions: permissionList(context.user_permissions || context.userPermissions || context.user?.permissions || context.permissions),
    agent_permissions: permissionList(context.agent_permissions || context.agentPermissions || context.permissions),
    source: context.source || null,
    trusted_mode: isTrustedOwnerMode(context),
  };
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
  const requiredPermissions = tool.requiredPermissions || (tool.requiredPermission ? [tool.requiredPermission] : []);
  const missingPermission = requiredPermissions.find((permission) => !hasPermission(context, permission));
  if (missingPermission) {
    console.warn('Refus permission outil agent', safePermissionLog(tool, context));
    const error = new Error(`Permission requise : ${missingPermission}`);
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
