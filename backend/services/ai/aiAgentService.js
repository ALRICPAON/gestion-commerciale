const { generateAnswer } = require('./aiClient');
const { buildAiContext } = require('./aiContextService');
const { normalizeConversation } = require('./aiMemoryService');
const { SYSTEM_PROMPT, buildContextPrompt } = require('./aiPrompts');
const { listTools } = require('./aiToolsRegistry');
const { executeRelevantTools } = require('./aiToolExecutor');

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
    }));
}

async function chat({ db, user, question, messages = [] }) {
  const prompt = normalizeQuestion(question);
  const [context, conversation, toolResults] = await Promise.all([
    buildAiContext({ db, user }),
    Promise.resolve(normalizeConversation(messages)),
    executeRelevantTools({ db, user, storeId: user.store_id, question: prompt, messages: conversation }),
  ]);
  const pendingActions = extractPendingActions(toolResults);

  console.info('Agent IA demande recue', {
    user_id: user.id,
    store_id: user.store_id,
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    conversation_messages: conversation.length,
    readonly_tools: toolResults.map((tool) => tool.name),
    pending_actions: pendingActions.length,
  });

  const answer = await generateAnswer({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'system',
        content: buildContextPrompt({
          ...context,
          tools_readonly_available: listTools().filter((tool) => tool.enabled && tool.readonly),
          tools_readonly_results: toolResults,
        }),
      },
      ...conversation,
      { role: 'user', content: prompt },
    ],
  });

  return {
    answer: answer || "Je n'ai pas pu produire de reponse exploitable pour le moment.",
    pending_actions: pendingActions,
  };
}

module.exports = {
  chat,
};
