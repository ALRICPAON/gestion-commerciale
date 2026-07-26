const { getAgentTool, RISK_LEVELS } = require('./agentToolRegistry');
const { authorizeTool } = require('./agentAuthorizationService');
const { startAuditLog, completeAuditLog } = require('./agentAuditService');
const {
  createAgentPendingAction,
  loadPendingActionForExecution,
  markPendingActionError,
  markPendingActionExecuted,
} = require('./agentPendingActionService');
const { isTrustedOwnerMode } = require('./agentTrustedMode');

const MAX_INPUT_BYTES = 100 * 1024;

function assertInputSize(input) {
  const size = Buffer.byteLength(JSON.stringify(input || {}), 'utf8');
  if (size > MAX_INPUT_BYTES) {
    const error = new Error('Payload outil agent trop volumineux');
    error.status = 413;
    error.expose = true;
    throw error;
  }
}

function firstPermissionValue(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value;
    if (value && typeof value === 'object' && Object.keys(value).length > 0) return value;
  }
  return [];
}

function permissionArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (value && typeof value === 'object') {
    return Object.entries(value).filter(([, allowed]) => Boolean(allowed)).map(([name]) => String(name || '').trim()).filter(Boolean);
  }
  return [];
}

function expandPermissionImplications(permissions) {
  const expanded = new Set(permissionArray(permissions));
  if (expanded.has('quality.documentation.edit')) expanded.add('quality.documentation.read');
  return [...expanded];
}

function normalizeContext(context = {}) {
  const user = context.user || {};
  const userPermissions = expandPermissionImplications(firstPermissionValue(
    context.user_permissions,
    context.userPermissions,
    user.permissions,
    context.permissions
  ));
  const agentPermissions = expandPermissionImplications(firstPermissionValue(
    context.agent_permissions,
    context.agentPermissions,
    context.permissions
  ));
  const permissions = expandPermissionImplications(firstPermissionValue(context.permissions, userPermissions));
  const normalized = {
    store_id: context.store_id || user.store_id || context.storeId,
    user_id: context.user_id || user.id || null,
    role: context.role || user.role || null,
    permissions,
    user_permissions: userPermissions,
    userPermissions,
    agent_permissions: agentPermissions,
    agentPermissions,
    client_key: context.client_key || user.client_key || null,
    source: context.source || 'agent',
    conversation_id: context.conversation_id || null,
    request_id: context.request_id || null,
    user,
  };
  if (context.trusted_mode !== undefined) normalized.trusted_mode = context.trusted_mode === true;
  if (context.trustedMode !== undefined) normalized.trusted_mode = context.trustedMode === true;
  return normalized;
}

async function executeAgentTool({ db, context, name, input = {}, confirmed = false }) {
  const tool = getAgentTool(name);
  if (!tool) {
    const error = new Error(`Outil agent inconnu : ${name || ''}`);
    error.status = 404;
    error.expose = true;
    throw error;
  }
  if (tool.enabled === false || tool.status === 'planned') {
    const error = new Error(`Outil non disponible : ${tool.name}`);
    error.status = 409;
    error.expose = true;
    throw error;
  }

  const normalizedContext = normalizeContext(context);
  assertInputSize(input);
  authorizeTool(tool, normalizedContext);

  const trustedMode = isTrustedOwnerMode(normalizedContext);

  if (!trustedMode && tool.riskLevel >= RISK_LEVELS.COMMITTING_ACTION && tool.requiresConfirmation && !confirmed && input.confirmation !== 'human_confirmed') {
    const auditId = await startAuditLog({ db, context: normalizedContext, tool, input });
    const pending = await createAgentPendingAction({ db, context: normalizedContext, tool, input, auditId });
    await completeAuditLog({
      db,
      auditId,
      status: 'confirmation_required',
      outputSummary: pending.summary,
      pendingActionId: pending.id,
    });
    return {
      ok: true,
      mode: 'confirmation_required',
      tool: tool.name,
      domain: tool.domain,
      pending_action: {
        id: pending.id,
        summary: `Confirmation requise pour ${tool.title}`,
        impact: pending.impact_summary || tool.description,
        expires_at: pending.expires_at,
      },
    };
  }

  const auditId = await startAuditLog({ db, context: normalizedContext, tool, input });
  try {
    let executionInput = input;
    let pendingAction = null;
    if ((confirmed || trustedMode) && input.pending_action_id) {
      pendingAction = await loadPendingActionForExecution({ db, context: normalizedContext, id: input.pending_action_id });
      executionInput = pendingAction.frozen_payload;
    }
    const result = await tool.execute({ db, context: normalizedContext, input: executionInput, tool, auditId });
    if (result && typeof result === 'object' && !result.audit_id) result.audit_id = auditId;
    if (pendingAction) {
      await markPendingActionExecuted({ db, id: pendingAction.id, result, context: normalizedContext });
      result.pending_action_id = pendingAction.id;
    }
    await completeAuditLog({
      db,
      auditId,
      status: 'success',
      outputSummary: result?.summary || result?.mode || 'Execution outil agent terminee',
      targetType: result?.target_type || null,
      targetId: result?.target_id || null,
      pendingActionId: result?.pending_action?.id || null,
    });
    return result;
  } catch (error) {
    if (input.pending_action_id) await markPendingActionError({ db, id: input.pending_action_id, error });
    await completeAuditLog({ db, auditId, status: 'error', error });
    throw error;
  }
}

module.exports = {
  executeAgentTool,
  normalizeContext,
};
