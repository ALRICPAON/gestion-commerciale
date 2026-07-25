const crypto = require('crypto');

const DEFAULT_TTL_MINUTES = 60;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function payloadHash(payload) {
  return crypto.createHash('sha256').update(stableStringify(payload || {})).digest('hex');
}

async function createAgentPendingAction({ db, context, tool, input, auditId = null }) {
  const frozenPayload = input || {};
  const hash = payloadHash(frozenPayload);
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_MINUTES * 60 * 1000).toISOString();
  const summary = input.summary || `Confirmation requise pour ${tool.title || tool.name}`;
  const impact = input.impact || tool.description || 'Action metier ALTA a confirmer.';
  const result = await db.query(
    `INSERT INTO agent_pending_actions
     (store_id, created_by_source, action_type, summary, payload, domain, final_tool_name,
      frozen_payload, human_summary, impact_summary, target_objects, expires_at, payload_hash, idempotency_key,
      risk_level, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$5::jsonb,$4,$8,$9::jsonb,$10,$11,$12,$13,$14)
     ON CONFLICT (store_id, idempotency_key) WHERE idempotency_key IS NOT NULL
     DO UPDATE SET summary = agent_pending_actions.summary
     RETURNING *`,
    [
      context.store_id,
      context.source || 'agent',
      tool.name,
      summary,
      JSON.stringify(frozenPayload),
      tool.domain,
      tool.name,
      impact,
      JSON.stringify(input.target_objects || []),
      expiresAt,
      hash,
      input.idempotency_key || `${tool.name}:${hash}`,
      tool.riskLevel,
      context.user_id || null,
    ]
  );
  return {
    ...result.rows[0],
    audit_id: auditId,
  };
}

async function loadPendingActionForExecution({ db, context, id }) {
  const result = await db.query(
    `SELECT *
     FROM agent_pending_actions
     WHERE id = $1 AND store_id = $2
     FOR UPDATE`,
    [id, context.store_id]
  );
  const action = result.rows[0];
  if (!action) {
    const error = new Error('Action en attente introuvable pour ce magasin');
    error.status = 404;
    error.expose = true;
    throw error;
  }
  if (action.status !== 'pending') {
    const error = new Error('Action en attente deja traitee');
    error.status = 409;
    error.expose = true;
    throw error;
  }
  if (action.expires_at && new Date(action.expires_at).getTime() < Date.now()) {
    await db.query('UPDATE agent_pending_actions SET status = $2, cancelled_at = now(), error_message = $3 WHERE id = $1', [id, 'cancelled', 'Action expiree']);
    const error = new Error('Action en attente expiree');
    error.status = 410;
    error.expose = true;
    throw error;
  }
  const frozenPayload = action.frozen_payload || action.payload || {};
  if (action.payload_hash && payloadHash(frozenPayload) !== action.payload_hash) {
    const error = new Error('Empreinte payload invalide');
    error.status = 409;
    error.expose = true;
    throw error;
  }
  return {
    ...action,
    frozen_payload: frozenPayload,
  };
}

async function markPendingActionExecuted({ db, id, result, context = {} }) {
  const update = await db.query(
    `UPDATE agent_pending_actions
     SET status = 'executed',
         executed_at = now(),
         confirmed_at = now(),
         confirmed_by_user_id = $3,
         execution_result = $2::jsonb,
         payload = jsonb_set(payload, '{execution_result}', $2::jsonb, true)
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [id, JSON.stringify(result || {}), context.user_id || null]
  );
  return update.rows[0] || null;
}

async function markPendingActionError({ db, id, error }) {
  await db.query(
    `UPDATE agent_pending_actions
     SET error_message = $2
     WHERE id = $1`,
    [id, error.message || 'Erreur execution action']
  ).catch(() => {});
}

module.exports = {
  createAgentPendingAction,
  loadPendingActionForExecution,
  markPendingActionError,
  markPendingActionExecuted,
  payloadHash,
};
