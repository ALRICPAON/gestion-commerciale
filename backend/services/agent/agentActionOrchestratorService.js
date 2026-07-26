const { hasPermission } = require('./agentAuthorizationService');
const { payloadHash } = require('./agentPendingActionService');
const { getExecutableAction, listExecutableActions } = require('./agentExecutableActionRegistry');

function expose(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function clean(value) {
  return String(value || '').trim();
}

function assertExecutionPermission(action, context) {
  if (!context.user_id) {
    throw expose(401, 'Utilisateur demandeur requis pour executer une action MCP');
  }
  if (!hasPermission(context, 'mcp.execute')) {
    throw expose(403, 'Permission requise : mcp.execute');
  }
  if (!hasPermission(context, action.requiredPermission)) {
    throw expose(403, `Permission requise : ${action.requiredPermission}`);
  }
}

function sanitizeActionForResponse(action) {
  if (!action) return null;
  return {
    action_type: action.name,
    name: action.name,
    description: action.description,
    module: action.module,
    required_permission: action.requiredPermission,
    permissions_required: action.requiredPermissions || ['mcp.execute', action.requiredPermission],
    service: action.service,
    confirmation_level: action.confirmationLevel,
    reversible: action.reversible,
    preview_required: action.previewRequired,
    batch: action.batch,
    aliases: action.aliases || [],
    payload_schema: action.payloadSchema || { type: 'object', additionalProperties: true },
    example: action.example || null,
  };
}

async function createExecutablePendingAction({ db, context, input = {} }) {
  const actionType = clean(input.action_type);
  const action = getExecutableAction(actionType);
  if (!action) {
    throw expose(400, `Type action MCP non executable : ${actionType || 'vide'}`);
  }
  const payload = action.validatePayload(input.payload || {});
  const summary = clean(input.summary) || `Confirmation requise pour ${action.name}`;
  const impact = clean(input.impact) || `${action.service} sera appele apres confirmation explicite.`;
  const targetObjects = Array.isArray(input.target_objects) ? input.target_objects : [];
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const frozenPayload = payload;
  const hash = payloadHash(frozenPayload);
  const result = await db.query(
    `INSERT INTO agent_pending_actions
     (store_id, created_by_source, action_type, summary, payload, status, domain, module, final_tool_name,
      frozen_payload, human_summary, impact_summary, target_objects, expires_at, payload_hash, idempotency_key,
      risk_level, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5::jsonb,'awaiting_confirmation',$6,$6,$7,
      $5::jsonb,$4,$8,$9::jsonb,$10,$11,$12,2,$13)
     ON CONFLICT (store_id, idempotency_key) WHERE idempotency_key IS NOT NULL
     DO UPDATE SET summary = agent_pending_actions.summary
     RETURNING *`,
    [
      context.store_id,
      context.source || 'mcp',
      action.name,
      summary,
      JSON.stringify(frozenPayload),
      action.module,
      action.name,
      impact,
      JSON.stringify(targetObjects),
      expiresAt,
      hash,
      input.idempotency_key || `${action.name}:${hash}`,
      context.user_id || null,
    ]
  );
  return {
    ...result.rows[0],
    action: sanitizeActionForResponse(action),
  };
}

async function loadActionForExecution(db, context, id) {
  const result = await db.query(
    `SELECT *
     FROM agent_pending_actions
     WHERE id = $1 AND store_id = $2
     FOR UPDATE`,
    [id, context.store_id]
  );
  const pendingAction = result.rows[0];
  if (!pendingAction) throw expose(404, 'Action en attente introuvable pour ce magasin');
  if (!['pending', 'prepared', 'awaiting_confirmation'].includes(pendingAction.status)) {
    throw expose(409, 'Action en attente deja traitee');
  }
  if (pendingAction.expires_at && new Date(pendingAction.expires_at).getTime() < Date.now()) {
    await db.query(
      `UPDATE agent_pending_actions
       SET status = 'cancelled', cancelled_at = now(), error_message = $2
       WHERE id = $1`,
      [id, 'Action expiree']
    );
    throw expose(410, 'Action en attente expiree');
  }
  const frozenPayload = pendingAction.frozen_payload || pendingAction.payload || {};
  if (pendingAction.payload_hash && payloadHash(frozenPayload) !== pendingAction.payload_hash) {
    throw expose(409, 'Empreinte payload invalide');
  }
  return {
    ...pendingAction,
    frozen_payload: frozenPayload,
  };
}

async function executeExecutablePendingAction({ dbPool, context, input = {} }) {
  const id = clean(input.id || input.pending_action_id);
  if (!id || clean(input.confirmation) !== 'human_confirmed') {
    throw expose(400, 'id et confirmation=human_confirmed obligatoires');
  }
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const pendingAction = await loadActionForExecution(client, context, id);
    const action = getExecutableAction(pendingAction.final_tool_name || pendingAction.action_type);
    if (!action) {
      throw expose(400, `Type action non executable par MCP : ${pendingAction.action_type}`);
    }
    assertExecutionPermission(action, context);
    const payload = action.validatePayload(pendingAction.frozen_payload || {});
    await client.query(
      `UPDATE agent_pending_actions
       SET status = 'executing',
           confirmed_at = now(),
           confirmed_by_user_id = $3,
           error_message = NULL
       WHERE id = $1 AND store_id = $2 AND status IN ('pending','prepared','awaiting_confirmation')`,
      [id, context.store_id, context.user_id || null]
    );
    const result = await action.execute({
      db: client,
      dbPool,
      context,
      payload,
      pendingAction,
    });
    const updated = await client.query(
      `UPDATE agent_pending_actions
       SET status = 'executed',
           executed_at = now(),
           execution_result = $3::jsonb,
           payload = jsonb_set(payload, '{execution_result}', $3::jsonb, true)
       WHERE id = $1 AND store_id = $2 AND status = 'executing'
       RETURNING *`,
      [id, context.store_id, JSON.stringify(result || {})]
    );
    if (!updated.rows[0]) throw expose(409, 'Action non executee : statut incoherent');
    await client.query('COMMIT');
    return {
      ...updated.rows[0],
      action: sanitizeActionForResponse(action),
      execution_result: result,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    await dbPool.query(
      `UPDATE agent_pending_actions
       SET status = 'failed',
           error_message = $3
       WHERE id = $1 AND store_id = $2 AND status = 'executing'`,
      [id, context.store_id, error.message || 'Erreur execution action']
    ).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createExecutablePendingAction,
  executeExecutablePendingAction,
  listExecutableActions: () => listExecutableActions().map(sanitizeActionForResponse),
};
