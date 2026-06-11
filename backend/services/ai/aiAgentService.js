const { generateAnswer } = require('./aiClient');
const { buildAiContext } = require('./aiContextService');
const { normalizeConversation } = require('./aiMemoryService');
const { SYSTEM_PROMPT, buildContextPrompt } = require('./aiPrompts');
const { listTools } = require('./aiToolsRegistry');

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

async function chat({ db, user, question, messages = [] }) {
  const prompt = normalizeQuestion(question);
  const [context, conversation] = await Promise.all([
    buildAiContext({ db, user }),
    Promise.resolve(normalizeConversation(messages)),
  ]);

  console.info('Agent IA demande recue', {
    user_id: user.id,
    store_id: user.store_id,
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    conversation_messages: conversation.length,
  });

  const answer = await generateAnswer({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'system',
        content: buildContextPrompt({
          ...context,
          tools_v2_declared_disabled: listTools(),
        }),
      },
      ...conversation,
      { role: 'user', content: prompt },
    ],
  });

  return {
    answer: answer || "Je n'ai pas pu produire de reponse exploitable pour le moment.",
  };
}

module.exports = {
  chat,
};
