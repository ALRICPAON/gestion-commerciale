const { getAgentTool, RISK_LEVELS } = require('./agentToolRegistry');
const { authorizeTool } = require('./agentAuthorizationService');
const { startAuditLog, completeAuditLog } = require('./agentAuditService');
const {
  createAgentPendingAction,
  loadPendingActionForExecution,
  markPendingActionError,
  markPendingActionExecuted,
} = require('./agentPendingActionService');

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

function normalizeContext(context = {}) {
  const user = context.user || {};
  return {
    store_id: context.store_id || user.store_id || context.storeId,
    user_id: context.user_id || user.id || null,
    role: context.role || user.role || null,
    permissions: context.permissions || user.permissions || [],
    agent_permissions: context.agent_permissions || context.agentPermissions || context.permissions || [],
    user_permissions: context.user_permissions || context.userPermissions || user.permissions || [],
    client_key: context.client_key || user.client_key || null,
    source: context.source || 'agent',
    conversation_id: context.conversation_id || null,
    request_id: context.request_id || null,
    user,
  };
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

  if (tool.riskLevel >= RISK_LEVELS.COMMITTING_ACTION && tool.requiresConfirmation && !confirmed && input.confirmation !== 'human_confirmed') {
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
    if (confirmed && input.pending_action_id) {
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
