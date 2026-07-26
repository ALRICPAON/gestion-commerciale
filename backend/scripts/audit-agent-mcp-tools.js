const { listAgentTools, listMcpTools, RISK_LEVELS } = require('../services/agent/agentToolRegistry');
const { listExecutableActions } = require('../services/agent/agentActionOrchestratorService');
const mcpServer = require('../routes/mcpServer');

function kind(tool) {
  const riskLevel = tool.riskLevel ?? tool._meta?.riskLevel ?? RISK_LEVELS.READ;
  if (riskLevel >= RISK_LEVELS.COMMITTING_ACTION) return 'Execution';
  if (riskLevel > RISK_LEVELS.READ || /prepare|preview|draft|pending/i.test(tool.name)) return 'Preparation / apercu';
  return 'Lecture';
}

function serviceFor(tool, executableActions) {
  if (tool._meta?.internalToolName) return `${tool._meta.internalToolName} via wrapper public MCP`;
  const action = executableActions.find((item) => (item.action_type || item.name) === tool.name);
  if (action) return action.service;
  if (tool.name === 'execute_business_action') return 'agentActionOrchestratorService.executeExecutableActionDirect';
  if (tool.name === 'execute_pending_action') return 'agentActionOrchestratorService.executeExecutablePendingAction';
  if (tool.name === 'create_pending_action') return 'agentActionOrchestratorService.createExecutablePendingAction';
  if (tool.name === 'update_quality_section' || tool.name === 'execute_quality_section_update') return 'quality.documentation.apply_section_updates via agentActionOrchestratorService.executeExecutableActionDirect';
  if (tool.status === 'planned' || tool.enabled === false) return 'a raccorder';
  return 'handler registre agent';
}

function gapFor(tool, mcpNames, executableActions) {
  if (tool._meta?.internalToolName) return 'OK wrapper public tools/list';
  if (tool.status === 'planned' || tool.enabled === false) return 'Planifie, non expose MCP';
  if (!mcpNames.has(tool.name)) return 'Non expose MCP';
  if (tool.riskLevel >= RISK_LEVELS.COMMITTING_ACTION) {
    const action = executableActions.find((item) => (item.action_type || item.name) === tool.name);
    if (tool.name === 'execute_pending_action' || tool.name === 'execute_business_action' || action) return 'OK allowlist/confirmation';
    if (tool.name === 'update_quality_section' || tool.name === 'execute_quality_section_update') return 'OK compatibilite: redirige vers action canonique';
    return 'Execution directe a auditer progressivement';
  }
  return 'OK';
}

function escapeCell(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function main() {
  const agentTools = listAgentTools();
  const internalMcpTools = listMcpTools();
  const publicMcpTools = typeof mcpServer._private?.buildPublicMcpTools === 'function'
    ? mcpServer._private.buildPublicMcpTools()
    : internalMcpTools;
  const mcpNames = new Set(publicMcpTools.map((tool) => tool.name));
  const executableActions = listExecutableActions();
  const rows = publicMcpTools.map((tool) => [
    tool.name,
    tool.domain || tool._meta?.domain || '',
    kind(tool),
    tool.requiredPermission || tool._meta?.requiredPermission || '',
    serviceFor(tool, executableActions),
    tool.status === 'planned' || tool.enabled === false ? 'Non' : 'Oui',
    gapFor(tool, mcpNames, executableActions),
  ]);

  console.log('# Audit outils MCP ALTA');
  console.log('');
  console.log(`- Outils registre agent: ${agentTools.length}`);
  console.log(`- Outils MCP internes agentToolRegistry: ${internalMcpTools.length}`);
  console.log(`- Outils publics exposes MCP tools/list: ${mcpNames.size}`);
  console.log('- Source tools/list publique: legacyTools + agentToolRegistry.listMcpTools + public underscore aliases');
  console.log(`- Actions metier executables allowlistees: ${executableActions.length}`);
  console.log('');
  console.log('## Actions executables allowlistees');
  console.log('');
  console.log('| action_type exact | Description | Permissions requises | Schema payload | Exemple minimal | Alias acceptes |');
  console.log('|---|---|---|---|---|---|');
  for (const action of executableActions) {
    console.log(`| ${[
      action.action_type || action.name,
      action.description || '',
      (action.permissions_required || []).join(', '),
      JSON.stringify(action.payload_schema || {}),
      JSON.stringify(action.example || {}),
      (action.aliases || []).join(', '),
    ].map(escapeCell).join(' | ')} |`);
  }
  console.log('');
  console.log('## Matrice outils MCP');
  console.log('');
  console.log('| Outil MCP | Module | Lecture / Preparation / Execution | Permission | Service metier appele | Fonctionnel actuellement | Ecart |');
  console.log('|---|---|---|---|---|---|---|');
  for (const row of rows) {
    console.log(`| ${row.map(escapeCell).join(' | ')} |`);
  }
}

main();
