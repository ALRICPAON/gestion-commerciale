const { listAgentTools, listMcpTools, RISK_LEVELS } = require('../services/agent/agentToolRegistry');
const { authorizeTool } = require('../services/agent/agentAuthorizationService');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const tools = listAgentTools();
  const mcpTools = listMcpTools();
  const names = new Set();
  const mcpNames = new Set(mcpTools.map((tool) => tool.name));

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
    if (tool.status === 'planned') {
      assert(tool.enabled === false, `Outil planned executable: ${tool.name}`);
      assert(!mcpNames.has(tool.name), `Outil planned expose au modele: ${tool.name}`);
    }
    if (tool.status !== 'planned') {
      assert(typeof tool.execute === 'function' || mcpNames.has(tool.name), `Handler manquant: ${tool.name}`);
    }
    if (tool.riskLevel >= RISK_LEVELS.COMMITTING_ACTION) {
      assert(tool.requiresConfirmation === true, `Confirmation manquante pour outil engageant: ${tool.name}`);
    }
  }

  const readTool = tools.find((tool) => tool.name === 'prepare_cashflow_plan');
  assert(readTool, 'prepare_cashflow_plan manquant');
  assert(mcpNames.has('prepare_cashflow_plan'), 'prepare_cashflow_plan non expose au modele');
  assert(mcpNames.has('list_executable_actions'), 'list_executable_actions non expose au modele');
  assert(mcpNames.has('execute_business_action'), 'execute_business_action non expose au modele');
  assert(mcpNames.has('quality.documentation.apply_section_updates'), 'quality.documentation.apply_section_updates non expose au modele');
  const blockToolNames = [
    'quality.documentation.update_text_block',
    'quality.documentation.add_text_block',
    'quality.documentation.add_table_block',
    'quality.documentation.add_diagram_block',
    'quality.documentation.delete_block',
    'quality.documentation.move_block',
  ];
  for (const name of blockToolNames) {
    const publicTool = mcpTools.find((tool) => tool.name === name);
    assert(publicTool, `${name} non expose dans le catalogue MCP public`);
    assert(publicTool.inputSchema?.type === 'object', `${name} schema public invalide`);
    assert(publicTool._meta?.requiredPermission === 'quality.documentation.edit', `${name} permission publique invalide`);
  }
  assert(mcpTools.find((tool) => tool.name === 'quality.documentation.add_text_block').inputSchema.properties.section_code, 'add_text_block doit accepter section_code');
  assert(mcpTools.find((tool) => tool.name === 'quality.documentation.add_text_block').inputSchema.properties.section_id, 'add_text_block doit accepter section_id');
  assert(mcpTools.find((tool) => tool.name === 'quality.documentation.add_table_block').inputSchema.properties.columns, 'add_table_block doit exposer columns');
  assert(mcpTools.find((tool) => tool.name === 'quality.documentation.add_table_block').inputSchema.properties.rows, 'add_table_block doit exposer rows');
  assert(mcpTools.find((tool) => tool.name === 'quality.documentation.add_table_block').inputSchema.properties.section_id, 'add_table_block doit accepter section_id');
  assert(mcpTools.find((tool) => tool.name === 'quality.documentation.add_diagram_block').inputSchema.properties.nodes, 'add_diagram_block doit exposer nodes');
  assert(mcpTools.find((tool) => tool.name === 'quality.documentation.add_diagram_block').inputSchema.properties.connections, 'add_diagram_block doit exposer connections');
  assert(mcpTools.find((tool) => tool.name === 'quality.documentation.add_diagram_block').inputSchema.properties.section_id, 'add_diagram_block doit accepter section_id');
  assert(mcpTools.find((tool) => tool.name === 'quality.documentation.move_block').inputSchema.properties.block_ids, 'move_block doit exposer block_ids');
  assert(mcpTools.find((tool) => tool.name === 'quality.documentation.move_block').inputSchema.properties.section_id, 'move_block doit accepter section_id');
  assert(mcpTools.find((tool) => tool.name === 'get_quality_section_blocks').inputSchema.properties.section_code, 'get_quality_section_blocks doit accepter section_code');
  assert(mcpNames.has('get_cashflow_data_sources'), 'get_cashflow_data_sources non expose au modele');
  assert(mcpNames.has('get_distrimer_exposure'), 'get_distrimer_exposure non expose au modele');
  assert(mcpNames.has('draft_quality_section'), 'draft_quality_section non expose au modele');
  assert(!mcpNames.has('update_article_price'), 'Outil planned expose au modele');

  authorizeTool(readTool, {
    store_id: '00000000-0000-4000-8000-000000000001',
    role: 'admin',
    user_permissions: [],
    agent_permissions: ['cashflow.read'],
  });

  let refused = false;
  try {
    authorizeTool(readTool, {
      store_id: '00000000-0000-4000-8000-000000000001',
      role: 'responsable',
      user_permissions: [],
      agent_permissions: ['cashflow.read'],
    });
  } catch (error) {
    refused = error.status === 403;
  }
  assert(refused, 'Responsable sans permission ne doit pas contourner les droits');

  refused = false;
  try {
    authorizeTool(readTool, {
      store_id: '00000000-0000-4000-8000-000000000001',
      role: 'admin',
      user_permissions: ['cashflow.read'],
      agent_permissions: ['quality.read'],
    });
  } catch (error) {
    refused = error.status === 403;
  }
  assert(refused, 'ALTA_AGENT_PERMISSIONS doit pouvoir restreindre les droits');

  const qualityReadTool = tools.find((tool) => tool.name === 'get_quality_section_blocks');
  authorizeTool(qualityReadTool, {
    store_id: '00000000-0000-4000-8000-000000000001',
    role: 'responsable',
    user_permissions: ['quality.documentation.edit'],
    agent_permissions: ['quality.documentation.edit'],
  });

  assert(!names.has('execute_sql'), 'Outil interdit execute_sql present');
  assert(!names.has('call_any_route'), 'Outil interdit call_any_route present');
  assert(!names.has('delete_anything'), 'Outil interdit delete_anything present');
  assert(!names.has('update_any_table'), 'Outil interdit update_any_table present');

  console.log(JSON.stringify({
    ok: true,
    tool_count: tools.length,
    mcp_tool_count: mcpTools.length,
    risk_counts: tools.reduce((acc, tool) => {
      acc[tool.riskLevel] = (acc[tool.riskLevel] || 0) + 1;
      return acc;
    }, {}),
  }, null, 2));
}

main();
