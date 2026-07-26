const SENSITIVE_KEY_PATTERN = /(secret|token|password|apikey|api_key|authorization|jwt|pennylane_key|openai_key|iban|bic)/i;
const { isTrustedOwnerMode, trustedModeLabel } = require('./agentTrustedMode');

function maskSensitive(value, depth = 0) {
  if (depth > 8) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => maskSensitive(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => (
    SENSITIVE_KEY_PATTERN.test(key) ? [key, '[MASKED]'] : [key, maskSensitive(item, depth + 1)]
  )));
}

function summarizePayload(value) {
  if (!value || typeof value !== 'object') return String(value || '').slice(0, 500);
  const keys = Object.keys(value).slice(0, 12);
  return keys.length ? `Champs: ${keys.join(', ')}` : 'Payload vide';
}

async function startAuditLog({ db, context, tool, input }) {
  if (!db?.query) return null;
  const masked = maskSensitive({
    ...(input || {}),
    _agent_mode: trustedModeLabel(context),
    trusted_mode: isTrustedOwnerMode(context),
  });
  try {
    const result = await db.query(
      `INSERT INTO agent_tool_audit_logs
       (store_id, user_id, conversation_id, request_id, tool_name, domain, risk_level, input_summary, input_payload, status, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'running',now())
       RETURNING id`,
      [
        context.store_id,
        context.user_id || null,
        context.conversation_id || null,
        context.request_id || null,
        tool.name,
        tool.domain,
        tool.riskLevel,
        summarizePayload(masked),
        JSON.stringify(masked),
      ]
    );
    return result.rows[0]?.id || null;
  } catch (error) {
    console.warn('Audit agent non disponible', { tool: tool.name, message: error.message, code: error.code });
    return null;
  }
}

async function completeAuditLog({ db, auditId, status = 'success', outputSummary = null, targetType = null, targetId = null, pendingActionId = null, error = null }) {
  if (!auditId || !db?.query) return;
  await db.query(
    `UPDATE agent_tool_audit_logs
     SET status = $2,
         output_summary = $3,
         target_type = $4,
         target_id = $5,
         pending_action_id = $6,
         error_code = $7,
         error_message = $8,
         completed_at = now()
     WHERE id = $1`,
    [
      auditId,
      status,
      outputSummary,
      targetType,
      targetId,
      pendingActionId,
      error?.code || null,
      error?.message || null,
    ]
  ).catch((err) => console.warn('Maj audit agent ignoree', { auditId, message: err.message }));
}

async function listAgentAuditLogs(db, storeId, input = {}) {
  const limit = Math.min(Number(input.limit || 50), 200);
  const result = await db.query(
    `SELECT id, store_id, user_id, conversation_id, request_id, tool_name, domain, risk_level,
            input_summary, output_summary, target_type, target_id, pending_action_id,
            status, error_code, error_message, started_at, completed_at, created_at
     FROM agent_tool_audit_logs
     WHERE store_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [storeId, limit]
  );
  return result.rows;
}

async function getAgentAuditLog(db, storeId, input = {}) {
  const result = await db.query(
    `SELECT *
     FROM agent_tool_audit_logs
     WHERE id = $1 AND store_id = $2
     LIMIT 1`,
    [input.id, storeId]
  );
  return result.rows[0] || null;
}

module.exports = {
  maskSensitive,
  startAuditLog,
  completeAuditLog,
  listAgentAuditLogs,
  getAgentAuditLog,
};
