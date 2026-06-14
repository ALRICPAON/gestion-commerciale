const { generateAnswer } = require('./aiClient');
const { buildAiContext } = require('./aiContextService');
const { normalizeConversation } = require('./aiMemoryService');
const { SYSTEM_PROMPT, buildContextPrompt } = require('./aiPrompts');
const { listTools } = require('./aiToolsRegistry');
const { executeRelevantTools } = require('./aiToolExecutor');
const { confirmAction } = require('./aiActionService');
const {
  findPendingActionsForUser,
  isConfirmationIntent,
  isMissingActionMemoryTable,
} = require('./aiActionMemoryService');

const MAX_QUESTION_LENGTH = 2000;

function normalizeQuestion(question) {
  const text = String(question || '').trim();
  if (!text) {
    const error = new Error('Message assistant requis');
    error.status = 400;
    error.expose = true;
    throw error;
  }

  return text.slice(0, MAX_QUESTION_LENGTH);
}

function extractPendingActions(toolResults) {
  return toolResults
    .flatMap((tool) => tool?.data?.pending_actions || [])
    .filter((action) => action?.id && action?.status === 'pending')
    .map((action) => ({
      id: action.id,
      action_type: action.action_type,
      status: action.status,
      summary: action.summary,
      payload: action.payload || null,
    }));
}

function formatActionResult(result) {
  const sale = result?.result;
  if (!sale) return 'Action IA executee.';

  const lines = Array.isArray(sale.lines)
    ? sale.lines.map((line) => `- ${line.article_label} : ${line.sold_quantity} ${line.sale_unit}`)
    : [];

  return [
    'Commande brouillon creee.',
    `Client : ${sale.client?.name || 'client'}`,
    `Document : ${sale.sale_id}`,
    '',
    ...lines,
  ].join('\n');
}

function formatPendingActionAnswer(pendingAction) {
  if (pendingAction?.summary) return pendingAction.summary;

  const payload = pendingAction?.payload || {};
  const clientName = payload.client?.name || 'client';
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (lines.length === 0) return 'Confirmer l action ?';

  return [
    `Je vais preparer une commande brouillon pour ${clientName} :`,
    ...lines.map((line) => {
      const plu = line.article_plu ? ` - PLU ${line.article_plu}` : '';
      return `- ${line.article_label}${plu} : ${line.quantity} ${line.sale_unit || 'kg'}`;
    }),
    '',
    'Confirmer l action ?',
  ].join('\n');
}

function logConfirmationDisplayPayload({ user, pendingAction }) {
  const lines = Array.isArray(pendingAction?.payload?.lines) ? pendingAction.payload.lines : [];
  console.info('[AI ACTION] confirmation display payload', {
    store_id: user.store_id,
    user_id: user.id,
    action_id: pendingAction?.id || null,
    action_type: pendingAction?.action_type || null,
    lines: lines.map((line) => ({
      article_id: line.article_id || null,
      plu: line.article_plu || null,
      designation: line.article_label || null,
      quantity: line.quantity || null,
      sale_unit: line.sale_unit || null,
      stock_status: line.supply_status || null,
      is_negoce: Boolean(line.is_negoce),
    })),
  });
}

async function handleConfirmationIntent({ db, user }) {
  let pendingActions = [];
  try {
    pendingActions = await findPendingActionsForUser({ db, user, limit: 2 });
  } catch (error) {
    if (!isMissingActionMemoryTable(error)) throw error;
    return {
      answer: 'aucune action à confirmer',
      pending_action_id: null,
      pending_actions: [],
    };
  }

  if (pendingActions.length === 0) {
    return {
      answer: 'aucune action à confirmer',
      pending_action_id: null,
      pending_actions: [],
    };
  }

  if (pendingActions.length > 1) {
    return {
      answer: 'J ai plusieurs actions en attente. Utilise le bouton Confirmer de l action voulue pour eviter toute ambiguite.',
      pending_action_id: null,
      pending_actions: pendingActions.map((action) => ({
        id: action.id,
        action_type: action.action_type,
        status: action.status,
      })),
    };
  }

  const pendingAction = pendingActions[0];
  console.info('[AI ACTION] confirmation matched pending action', {
    store_id: user.store_id,
    user_id: user.id,
    action_id: pendingAction.id,
    action_type: pendingAction.action_type,
  });

  const confirmed = await confirmAction({
    dbPool: db,
    user,
    actionId: pendingAction.id,
  });

  console.info('[AI ACTION] pending action executed', {
    store_id: user.store_id,
    user_id: user.id,
    action_id: pendingAction.id,
    status: confirmed.status,
    sale_id: confirmed.result?.sale_id || null,
  });

  return {
    answer: formatActionResult(confirmed),
    pending_action_id: null,
    pending_actions: [],
    action_result: confirmed,
  };
}

async function chat({ db, user, question, messages = [] }) {
  const prompt = normalizeQuestion(question);
  const conversation = normalizeConversation(Array.isArray(messages) ? messages : []);

  if (isConfirmationIntent(prompt)) {
    const confirmationResult = await handleConfirmationIntent({ db, user });
    console.info('Agent IA confirmation texte traitee', {
      user_id: user.id,
      store_id: user.store_id,
      executed: Boolean(confirmationResult.action_result),
    });
    return confirmationResult;
  }

  const [context, toolResults] = await Promise.all([
    buildAiContext({ db, user }),
    executeRelevantTools({ db, user, storeId: user.store_id, question: prompt, messages: conversation }),
  ]);
  const pendingActions = extractPendingActions(toolResults);
  const pendingAction = pendingActions[0] || null;

  console.info('Agent IA demande recue', {
    user_id: user.id,
    store_id: user.store_id,
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    conversation_messages: conversation.length,
    readonly_tools: toolResults.map((tool) => tool.name),
    pending_actions: pendingActions.length,
  });

  if (pendingAction) {
    logConfirmationDisplayPayload({ user, pendingAction });
    return {
      answer: formatPendingActionAnswer(pendingAction),
      pending_action_id: pendingAction.id,
      pending_action: pendingAction,
      pending_actions: pendingActions,
    };
  }

  const answer = await generateAnswer({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'system',
        content: buildContextPrompt({
          ...context,
          tools_readonly_available: listTools().filter((tool) => tool.enabled && tool.readonly),
          tools_readonly_results: toolResults,
          pending_action_id: null,
        }),
      },
      ...conversation,
      { role: 'user', content: prompt },
    ],
  });

  return {
    answer: answer || "Je n'ai pas pu produire de reponse exploitable pour le moment.",
    pending_action_id: null,
    pending_action: null,
    pending_actions: [],
  };
}

module.exports = {
  chat,
};
