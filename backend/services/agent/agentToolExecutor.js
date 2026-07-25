const { getAgentTool, RISK_LEVELS } = require('./agentToolRegistry');
const { authorizeTool } = require('./agentAuthorizationService');
const { startAuditLog, completeAuditLog } = require('./agentAuditService');

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
    client_key: context.client_key || user.client_key || null,
    source: context.source || 'agent',
    conversation_id: context.conversation_id || null,
    request_id: context.request_id || null,
    user,
  };
}

async function executeAgentTool({ db, context, name, input = {}, confirmed = false }) {
  const tool = getAgentTool(name);
  if (!tool || tool.enabled === false) {
    const error = new Error(`Outil agent inconnu : ${name || ''}`);
    error.status = 404;
    error.expose = true;
    throw error;
  }

  const normalizedContext = normalizeContext(context);
  assertInputSize(input);
  authorizeTool(tool, normalizedContext);

  if (tool.riskLevel >= RISK_LEVELS.COMMITTING_ACTION && tool.requiresConfirmation && !confirmed && input.confirmation !== 'human_confirmed') {
    return {
      ok: true,
      mode: 'confirmation_required',
      tool: tool.name,
      domain: tool.domain,
      pending_action: {
        summary: `Confirmation requise pour ${tool.title}`,
        impact: tool.description,
        expires_at: null,
      },
    };
  }

  const auditId = await startAuditLog({ db, context: normalizedContext, tool, input });
  try {
    const result = await tool.execute({ db, context: normalizedContext, input, tool, auditId });
    if (result && typeof result === 'object' && !result.audit_id) result.audit_id = auditId;
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
    await completeAuditLog({ db, auditId, status: 'error', error });
    throw error;
  }
}

module.exports = {
  executeAgentTool,
  normalizeContext,
};
