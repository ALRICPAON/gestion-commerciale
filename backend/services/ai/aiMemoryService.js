const MAX_MESSAGES = 12;
const MAX_CONTENT_LENGTH = 2000;

function normalizeRole(role) {
  return role === 'assistant' ? 'assistant' : 'user';
}

function normalizeContent(content) {
  return String(content || '').trim().slice(0, MAX_CONTENT_LENGTH);
}

function normalizeConversation(messages = []) {
  if (!Array.isArray(messages)) return [];

  return messages
    .slice(-MAX_MESSAGES)
    .map((message) => ({
      role: normalizeRole(message.role),
      content: normalizeContent(message.content),
    }))
    .filter((message) => message.content);
}

module.exports = {
  normalizeConversation,
};
