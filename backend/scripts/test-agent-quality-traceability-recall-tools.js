const assert = require('assert');

const { authorizeTool } = require('../services/agent/agentAuthorizationService');
const { buildCoverageReport } = require('../services/agent/agentFullCoverageService');
const { listExecutableActions } = require('../services/agent/agentExecutableActionRegistry');
const { getAgentTool, listAgentTools, listMcpTools, RISK_LEVELS } = require('../services/agent/agentToolRegistry');
const { listModules } = require('../services/agent/agentModuleCatalog');
const mcpServer = require('../routes/mcpServer');

const { buildPublicMcpTools } = mcpServer._private;

const READ_TOOLS = [
  'list_quality_evidence_records',
  'get_quality_evidence_record',
  'list_quality_events',
  'get_quality_event',
  'list_quality_blocked_lots',
  'get_lot_quality_status',
  'search_traceability_lots',
  'get_traceability_snapshot',
  'list_traceability_tests',
  'get_traceability_test',
  'list_product_recall_campaigns',
  'get_product_recall_campaign',
  'analyze_product_recall_for_lot',
];

const PREPARE_TOOLS = [
  'prepare_quality_lot_block',
  'prepare_quality_lot_release',
  'prepare_traceability_test_completion',
  'prepare_product_recall',
  'prepare_product_recall_notifications',
];

const EXECUTABLE_ACTIONS = [
  'quality.lot.block',
  'quality.lot.release',
  'quality.traceability_test.complete',
  'product_recall.create_campaign',
  'product_recall.send_notifications',
];

function context(extra = {}) {
  return {
    store_id: '80000000-0000-4000-8000-000000000001',
    user_id: '80000000-0000-4000-8000-000000000101',
    role: 'admin',
    user_permissions: [
      'agent.use',
      'quality.read',
      'quality.record.create',
      'stock.read',
      'stock.write',
      'sales.read',
      'communications.send',
      'mcp.execute',
    ],
    agent_permissions: [
      'agent.use',
      'quality.read',
      'quality.record.create',
      'stock.read',
      'stock.write',
      'sales.read',
      'communications.send',
      'mcp.execute',
    ],
    source: 'agent-test',
    ...extra,
  };
}

async function main() {
  const tools = listAgentTools();
  const publicTools = listMcpTools();
  const names = new Set(tools.map((tool) => tool.name));
  const publicNames = new Set(publicTools.map((tool) => tool.name));

  for (const name of [...READ_TOOLS, ...PREPARE_TOOLS]) {
    assert(names.has(name), `${name} absent du registry`);
    assert(publicNames.has(name), `${name} absent tools/list`);
    const tool = getAgentTool(name);
    assert(tool.description && tool.description.length > 40, `${name} description trop faible`);
    assert(tool.outputSchema?.type === 'object', `${name} output schema manquant`);
  }

  for (const name of READ_TOOLS) {
    const tool = getAgentTool(name);
    assert.equal(tool.riskLevel, RISK_LEVELS.READ, `${name} doit rester lecture`);
    assert.equal(tool.requiresConfirmation, false, `${name} ne doit pas demander confirmation`);
  }

  for (const name of PREPARE_TOOLS) {
    const tool = getAgentTool(name);
    assert.equal(tool.riskLevel, RISK_LEVELS.LOW_REVERSIBLE_WRITE, `${name} doit seulement preparer`);
    assert.equal(tool.requiresConfirmation, false, `${name} ne doit pas executer directement`);
    assert(String(tool.description).includes('confirmation humaine'), `${name} doit documenter la confirmation humaine`);
  }

  const actions = listExecutableActions();
  const actionNames = new Set(actions.map((action) => action.name));
  for (const name of EXECUTABLE_ACTIONS) {
    assert(actionNames.has(name), `${name} absent des actions executables`);
    const action = actions.find((item) => item.name === name);
    assert.equal(action.confirmationLevel, 'explicit_human', `${name} doit exiger confirmation explicite`);
    assert(action.requiredPermissions.includes('mcp.execute'), `${name} doit exiger mcp.execute`);
    assert(action.previewRequired, `${name} doit exiger un apercu/preparation`);
  }

  const sendAction = actions.find((action) => action.name === 'product_recall.send_notifications');
  assert(sendAction.requiredPermissions.includes('communications.send'), 'envoi rappel doit exiger communications.send');
  assert(sendAction.requiredPermissions.includes('quality.record.create'), 'envoi rappel doit creer une preuve qualite');
  assert(String(sendAction.description).includes('aucun email silencieux'), 'envoi rappel doit interdire email silencieux');

  const blockTool = getAgentTool('prepare_quality_lot_block');
  authorizeTool(blockTool, context());
  assert.throws(
    () => authorizeTool(blockTool, context({ user_permissions: ['agent.use', 'stock.write'], agent_permissions: ['agent.use', 'stock.write'] })),
    /quality\.record\.create/,
    'prepare_quality_lot_block doit exiger quality.record.create en plus de stock.write'
  );

  const preparedBlock = await blockTool.execute({
    db: {},
    context: context(),
    input: { lot_id: 'lot-1', reason_type: 'supplier_recall', reason: 'Rappel fournisseur' },
    tool: blockTool,
  });
  assert.equal(preparedBlock.data.prepared_action.action_type, 'quality.lot.block');
  assert.equal(preparedBlock.data.prepared_action.requires_confirmation, true);
  assert.equal(preparedBlock.data.prepared_action.executable_now, true);

  const preparedTraceability = await getAgentTool('prepare_traceability_test_completion').execute({
    db: {},
    context: context(),
    input: { lot_id: 'lot-1', result: 'conform', started_at: '2026-08-16T08:00:00.000Z' },
    tool: getAgentTool('prepare_traceability_test_completion'),
  });
  assert.equal(preparedTraceability.data.prepared_action.action_type, 'quality.traceability_test.complete');
  assert(String(getAgentTool('prepare_traceability_test_completion').description).includes('ne doit jamais decider conforme automatiquement'));

  const coverage = buildCoverageReport(buildPublicMcpTools(), listModules());
  assert.equal(coverage.coverage_complete, true, JSON.stringify(coverage.missing_tools));
  const qualityRow = coverage.matrix.find((row) => row.module === 'quality');
  for (const name of [
    'list_quality_evidence_records',
    'list_quality_events',
    'list_quality_blocked_lots',
    'get_traceability_snapshot',
    'list_traceability_tests',
    'analyze_product_recall_for_lot',
    'prepare_quality_lot_block',
    'prepare_product_recall',
  ]) {
    const serialized = JSON.stringify(qualityRow);
    assert(serialized.includes(name), `${name} absent matrice couverture qualite`);
  }

  for (const forbidden of ['execute_sql', 'delete_record', 'update_table', 'call_route', 'raw_http', 'send_arbitrary_email', 'delete_recall', 'delete_evidence']) {
    assert(!names.has(forbidden), `Outil interdit expose: ${forbidden}`);
    assert(!publicNames.has(forbidden), `Outil interdit expose MCP: ${forbidden}`);
  }

  console.log(JSON.stringify({
    ok: true,
    read_tools: READ_TOOLS,
    prepare_tools: PREPARE_TOOLS,
    executable_actions: EXECUTABLE_ACTIONS,
    tool_count: tools.length,
    mcp_tool_count: publicTools.length,
    coverage_complete: coverage.coverage_complete,
    no_real_email_sent: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
