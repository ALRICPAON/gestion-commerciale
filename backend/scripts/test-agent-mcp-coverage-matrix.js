const assert = require('assert');

const router = require('../routes/mcpServer');
const { listModules } = require('../services/agent/agentModuleCatalog');
const {
  FINAL_AGENT_PERMISSIONS,
  buildCoverageReport,
} = require('../services/agent/agentFullCoverageService');
const { getAgentTool, listAgentTools, RISK_LEVELS } = require('../services/agent/agentToolRegistry');

const {
  MCP_SERVER_VERSION,
  buildPublicMcpTools,
  handleRequest,
} = router._private;

const EXPECTED_PERMISSIONS = [
  'mcp.execute',
  'agent.use',
  'clients.read',
  'clients.write',
  'suppliers.read',
  'suppliers.write',
  'articles.read',
  'articles.write',
  'stock.read',
  'stock.write',
  'purchases.read',
  'purchases.write',
  'sales.read',
  'sales.write',
  'communications.read',
  'communications.send',
  'statistics.read',
  'cashflow.read',
  'cashflow.write',
  'pennylane.read',
  'pennylane.sync',
  'employee_planning.read',
  'employee_planning.write',
  'transformations.read',
  'transformations.write',
  'quality.read',
  'quality.configuration.write',
  'quality.documentation.read',
  'quality.documentation.edit',
];

function fakeReq() {
  return {
    get: () => null,
    protocol: 'https',
    baseUrl: '/mcp',
    agentStoreId: 'store-test',
    dbPool: {},
  };
}

async function main() {
  assert.deepEqual(FINAL_AGENT_PERMISSIONS, EXPECTED_PERMISSIONS, 'ALTA_AGENT_PERMISSIONS final invalide');
  assert.equal(MCP_SERVER_VERSION, '1.8.4', 'Version MCP non incrementee');

  const publicTools = buildPublicMcpTools();
  const publicNames = new Set(publicTools.map((tool) => tool.name));
  const coverage = buildCoverageReport(publicTools, listModules());

  assert.equal(coverage.coverage_complete, true, `Couverture incomplete: ${JSON.stringify(coverage.missing_tools)}`);
  assert.equal(coverage.missing_tools.length, 0, 'Aucun missing_tool ne doit rester');
  assert.deepEqual(coverage.final_permissions, EXPECTED_PERMISSIONS, 'Permissions exposees par la couverture invalides');

  const expectedModules = [
    'clients',
    'suppliers',
    'articles',
    'stock',
    'purchases',
    'sales',
    'communications',
    'statistics',
    'cashflow',
    'pennylane',
    'employee_planning',
    'transformations',
    'quality',
    'quality_documentation',
  ];
  assert.deepEqual(coverage.matrix.map((row) => row.module), expectedModules, 'Modules couverts invalides');

  const forbiddenNames = ['execute_sql', 'call_any_route', 'delete_anything', 'update_any_table', 'physical_delete'];
  for (const name of forbiddenNames) {
    assert.equal(publicNames.has(name), false, `Outil interdit expose: ${name}`);
  }

  const tools = listAgentTools();
  for (const tool of tools) {
    if (tool.riskLevel >= RISK_LEVELS.COMMITTING_ACTION) {
      assert.equal(tool.requiresConfirmation, true, `${tool.name} doit exiger une confirmation humaine`);
    }
  }

  const qualityActivation = tools.find((tool) => tool.name === 'quality_activate_configuration');
  assert(qualityActivation, 'quality_activate_configuration manquant');
  assert.equal(qualityActivation.riskLevel, RISK_LEVELS.COMMITTING_ACTION, 'Activation qualite doit etre engageante');
  assert.equal(qualityActivation.requiresConfirmation, true, 'Activation qualite doit etre confirmee humainement');

  const preparedConfirmedNames = [
    'send_email_confirmed',
    'send_customer_price_list_confirmed',
    'prepare_pennylane_sync',
    'prepare_customer_invoice',
    'prepare_stock_regularization',
    'prepare_transformation_validation',
  ];
  for (const name of preparedConfirmedNames) {
    const tool = tools.find((item) => item.name === name);
    assert(tool, `${name} manquant`);
    const executableTool = getAgentTool(name);
    const result = await executableTool.execute({
      db: {},
      context: { store_id: 'store-test', source: 'coverage-test' },
      input: { summary: `Test ${name}`, payload: { id: 'target-test' } },
      tool,
    });
    assert.equal(result.data.prepared_action.requires_confirmation, true, `${name} doit preparer une confirmation humaine`);
  }

  const response = await handleRequest(fakeReq(), {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });
  assert.equal(response.result.version, '1.8.4', 'tools/list doit exposer la version MCP');
  assert.equal(response.result.coverage_complete, true, 'tools/list doit exposer coverage_complete=true');
  assert.deepEqual(response.result.missing_tools, [], 'tools/list ne doit pas exposer de missing_tools');
  assert.deepEqual(response.result.final_permissions, EXPECTED_PERMISSIONS, 'tools/list doit exposer les permissions finales');
  assert.equal(response.result.coverage_matrix.length, expectedModules.length, 'tools/list doit exposer la matrice complete');
  assert.equal(response.result.tool_count, response.result.tools.length, 'tool_count incoherent');

  console.log(JSON.stringify({
    ok: true,
    mcp_version: MCP_SERVER_VERSION,
    public_tool_count: publicTools.length,
    coverage_complete: coverage.coverage_complete,
    modules: expectedModules.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
