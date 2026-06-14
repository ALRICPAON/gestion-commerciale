let cachedClient = null;

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('OPENAI_API_KEY manquante cote serveur');
    error.status = 503;
    error.expose = true;
    throw error;
  }

  if (!cachedClient) {
    const OpenAI = require('openai');
    cachedClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  return cachedClient;
}

async function generateAnswer({ messages }) {
  const client = getOpenAIClient();
  const model = process.env.AI_MODEL || 'gpt-4o-mini';

  const completion = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.2,
  });

  return completion.choices?.[0]?.message?.content?.trim() || '';
}

async function generateToolCall({ messages, tools, toolChoice }) {
  const client = getOpenAIClient();
  const model = process.env.AI_MODEL || 'gpt-4o-mini';

  const completion = await client.chat.completions.create({
    model,
    messages,
    tools,
    tool_choice: toolChoice || 'auto',
    temperature: 0,
  });

  return completion.choices?.[0]?.message || null;
}

module.exports = {
  generateAnswer,
  generateToolCall,
};
