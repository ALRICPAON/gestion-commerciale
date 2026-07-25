const assert = require('assert');
const { payloadHash } = require('../services/agent/agentPendingActionService');
const { executeAgentTool } = require('../services/agent/agentToolExecutor');

async function main() {
  assert.equal(payloadHash({ b: 2, a: 1 }), payloadHash({ a: 1, b: 2 }), 'hash stable attendu');

  let plannedRefused = false;
  try {
    await executeAgentTool({
      db: null,
      name: 'update_article_price',
      input: {},
      context: {
        store_id: '00000000-0000-4000-8000-000000000001',
        role: 'admin',
        user_permissions: ['articles.write'],
        agent_permissions: ['articles.write'],
      },
    });
  } catch (error) {
    plannedRefused = error.status === 409;
  }
  assert.equal(plannedRefused, true, 'un outil planned doit etre refuse a l execution');

  console.log(JSON.stringify({ ok: true }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
