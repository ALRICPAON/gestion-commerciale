const { listAgentTools, RISK_LEVELS } = require('../services/agent/agentToolRegistry');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const tools = listAgentTools();
  const names = new Set();

  assert(tools.length >= 60, `Catalogue trop court: ${tools.length}`);

  for (const tool of tools) {
    assert(tool.name, 'Outil sans nom');
    assert(!names.has(tool.name), `Nom outil duplique: ${tool.name}`);
    names.add(tool.name);
    assert(tool.title, `Titre manquant: ${tool.name}`);
    assert(tool.description, `Description manquante: ${tool.name}`);
    assert(tool.domain, `Domaine manquant: ${tool.name}`);
    assert(Number.isInteger(tool.riskLevel) && tool.riskLevel >= 0 && tool.riskLevel <= 3, `Risque invalide: ${tool.name}`);
    assert(tool.requiredPermission, `Permission manquante: ${tool.name}`);
    assert(tool.inputSchema && tool.inputSchema.type === 'object', `Schema entree invalide: ${tool.name}`);
    assert(tool.outputSchema && tool.outputSchema.type === 'object', `Schema sortie invalide: ${tool.name}`);
    if (tool.riskLevel >= RISK_LEVELS.COMMITTING_ACTION) {
      assert(tool.requiresConfirmation === true, `Confirmation manquante pour outil engageant: ${tool.name}`);
    }
  }

  assert(!names.has('execute_sql'), 'Outil interdit execute_sql present');
  assert(!names.has('call_any_route'), 'Outil interdit call_any_route present');
  assert(!names.has('delete_anything'), 'Outil interdit delete_anything present');
  assert(!names.has('update_any_table'), 'Outil interdit update_any_table present');

  console.log(JSON.stringify({
    ok: true,
    tool_count: tools.length,
    risk_counts: tools.reduce((acc, tool) => {
      acc[tool.riskLevel] = (acc[tool.riskLevel] || 0) + 1;
      return acc;
    }, {}),
  }, null, 2));
}

main();
