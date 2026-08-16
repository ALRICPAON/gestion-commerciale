const assert = require('assert');
const fs = require('fs');
const path = require('path');

const router = require('../routes/mcpServer');
const { listModules } = require('../services/agent/agentModuleCatalog');
const {
  FINAL_AGENT_PERMISSIONS,
  buildCoverageReport,
} = require('../services/agent/agentFullCoverageService');
const { FRONTEND_BACKEND_CAPABILITIES } = require('../services/agent/agentFrontendBackendCoverageService');
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
  'quality.record.create',
  'quality.nc.manage',
  'quality.action.manage',
  'quality.configuration.write',
  'quality.documentation.read',
  'quality.documentation.edit',
  'supplies_materials.read',
  'supplies_materials.write',
  'supplies_materials.archive',
  'supplies_materials.documents',
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
  assert.equal(MCP_SERVER_VERSION, '1.8.5', 'Version MCP non incrementee');

  const publicTools = buildPublicMcpTools();
  const publicNames = new Set(publicTools.map((tool) => tool.name));
  const coverage = buildCoverageReport(publicTools, listModules());

  assert.equal(coverage.coverage_complete, true, `Couverture incomplete: ${JSON.stringify(coverage.missing_tools)}`);
  assert.equal(coverage.missing_tools.length, 0, 'Aucun missing_tool ne doit rester');
  assert.equal(coverage.frontend_backend_coverage_complete, true, `Couverture front/backend incomplete: ${JSON.stringify(coverage.missing_frontend_backend_capabilities)}`);
  assert.equal(coverage.missing_frontend_backend_capabilities.length, 0, 'Aucune capacite front/backend ne doit manquer');
  assert.equal(coverage.frontend_backend_capabilities.length, FRONTEND_BACKEND_CAPABILITIES.length, 'Matrice front/backend incomplete');
  for (const capability of coverage.frontend_backend_capabilities) {
    assert(capability.frontend, `${capability.capability} doit referencer le front`);
    assert(fs.existsSync(path.resolve(__dirname, '..', '..', capability.frontend)), `${capability.frontend} introuvable`);
    assert(capability.route, `${capability.capability} doit referencer une route backend`);
    assert(capability.service, `${capability.capability} doit referencer un service metier`);
    assert(publicNames.has(capability.mcp_tool), `${capability.capability} doit pointer vers un outil MCP public`);
    assert.equal(capability.status, 'covered', `${capability.capability} doit etre couverte`);
  }
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
    'supplies_materials',
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

  const requiredFrontendBackendTools = [
    'list_quality_temperature_types',
    'list_quality_temperature_parameters',
    'get_quality_temperature_parameter',
    'create_quality_temperature_parameter',
    'update_quality_temperature_parameter',
    'archive_or_disable_quality_temperature_parameter',
    'list_quality_cleaning_plans',
    'get_quality_cleaning_plan',
    'create_quality_cleaning_plan',
    'update_quality_cleaning_plan',
    'archive_or_disable_quality_cleaning_plan',
    'get_quality_today_work',
    'get_quality_overdue_work',
    'get_quality_ddpp_dashboard',
    'execute_quality_temperature_occurrence',
    'execute_quality_cleaning_occurrence',
    'execute_quality_manual_occurrence',
    'create_quality_non_conformity',
    'create_quality_corrective_action',
    'close_quality_non_conformity',
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
    'prepare_quality_lot_block',
    'prepare_quality_lot_release',
    'prepare_traceability_test_completion',
    'prepare_product_recall',
    'prepare_product_recall_notifications',
  ];
  for (const name of requiredFrontendBackendTools) {
    assert(publicNames.has(name), `${name} doit etre expose au MCP public`);
  }

  const withoutTemperatureTypes = publicTools.filter((tool) => tool.name !== 'list_quality_temperature_types');
  const missingTemperatureTypes = buildCoverageReport(withoutTemperatureTypes, listModules());
  assert.equal(missingTemperatureTypes.coverage_complete, false, 'La couverture globale doit echouer si les types temperature front/backend manquent');
  assert.equal(missingTemperatureTypes.frontend_backend_coverage_complete, false, 'La couverture front/backend doit echouer si GET /api/quality/temperatures/types manque');
  assert(
    missingTemperatureTypes.missing_frontend_backend_capabilities.some((item) => item.mcp_tool === 'list_quality_temperature_types'),
    'La matrice doit signaler list_quality_temperature_types comme manquant'
  );

  const cleaningCreate = publicTools.find((tool) => tool.name === 'create_quality_cleaning_plan');
  assert(cleaningCreate.inputSchema.properties.planning_mode, 'create_quality_cleaning_plan doit exposer planning_mode');
  assert(cleaningCreate.inputSchema.properties.zone_ids, 'create_quality_cleaning_plan doit exposer zone_ids');
  assert(cleaningCreate.inputSchema.properties.equipment_ids, 'create_quality_cleaning_plan doit exposer equipment_ids');
  assert(cleaningCreate.inputSchema.properties.scheduled_days, 'create_quality_cleaning_plan doit exposer scheduled_days');
  assert(cleaningCreate.inputSchema.properties.task_title, 'create_quality_cleaning_plan doit exposer task_title');
  assert(cleaningCreate.inputSchema.properties.responsible_user_id, 'create_quality_cleaning_plan doit exposer responsible_user_id');
  assert(cleaningCreate.inputSchema.properties.frequency_value, 'create_quality_cleaning_plan doit exposer frequency_value');
  assert(cleaningCreate.inputSchema.properties.frequency_unit, 'create_quality_cleaning_plan doit exposer frequency_unit');
  assert(cleaningCreate.inputSchema.properties.target_time, 'create_quality_cleaning_plan doit exposer target_time');

  const cleaningUpdate = publicTools.find((tool) => tool.name === 'update_quality_cleaning_plan');
  assert(cleaningUpdate.inputSchema.properties.zone_ids, 'update_quality_cleaning_plan doit exposer zone_ids');
  assert(cleaningUpdate.inputSchema.properties.equipment_ids, 'update_quality_cleaning_plan doit exposer equipment_ids');

  const temperatureCreate = publicTools.find((tool) => tool.name === 'create_quality_temperature_parameter');
  assert(temperatureCreate.description.includes('list_quality_temperature_types'), 'create_quality_temperature_parameter doit guider vers list_quality_temperature_types');
  assert(temperatureCreate.inputSchema.properties.type_code.description.includes('list_quality_temperature_types'), 'type_code doit documenter la source des codes autorises');
  assert(temperatureCreate.inputSchema.properties.planning_mode, 'create_quality_temperature_parameter doit exposer planning_mode');
  assert(temperatureCreate.inputSchema.properties.task_title, 'create_quality_temperature_parameter doit exposer task_title');
  assert(temperatureCreate.inputSchema.properties.responsible_user_id, 'create_quality_temperature_parameter doit exposer responsible_user_id');
  assert(temperatureCreate.inputSchema.properties.frequency_value, 'create_quality_temperature_parameter doit exposer frequency_value');
  assert(temperatureCreate.inputSchema.properties.frequency_unit, 'create_quality_temperature_parameter doit exposer frequency_unit');
  assert(temperatureCreate.inputSchema.properties.target_time, 'create_quality_temperature_parameter doit exposer target_time');
  assert(temperatureCreate.inputSchema.properties.target_times, 'create_quality_temperature_parameter doit exposer target_times');
  assert(temperatureCreate.inputSchema.properties.scheduled_days, 'create_quality_temperature_parameter doit exposer scheduled_days');

  const temperatureUpdate = publicTools.find((tool) => tool.name === 'update_quality_temperature_parameter');
  assert(temperatureUpdate.inputSchema.properties.target_times, 'update_quality_temperature_parameter doit exposer target_times');
  assert(temperatureUpdate.inputSchema.properties.scheduled_days, 'update_quality_temperature_parameter doit exposer scheduled_days');

  const todayWork = publicTools.find((tool) => tool.name === 'get_quality_today_work');
  assert(todayWork, 'get_quality_today_work doit etre expose');
  const temperatureOccurrence = publicTools.find((tool) => tool.name === 'execute_quality_temperature_occurrence');
  assert(temperatureOccurrence.inputSchema.properties.occurrence_id, 'execute_quality_temperature_occurrence doit accepter occurrence_id');
  const cleaningOccurrence = publicTools.find((tool) => tool.name === 'execute_quality_cleaning_occurrence');
  assert(cleaningOccurrence.inputSchema.properties.cleaning_plan_id, 'execute_quality_cleaning_occurrence doit accepter cleaning_plan_id');
  const closeNc = tools.find((tool) => tool.name === 'close_quality_non_conformity');
  assert(closeNc, 'close_quality_non_conformity manquant');
  assert.equal(closeNc.requiresConfirmation, true, 'close_quality_non_conformity doit exiger confirmation humaine');

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
  assert.equal(response.result.version, '1.8.5', 'tools/list doit exposer la version MCP');
  assert.equal(response.result.coverage_complete, true, 'tools/list doit exposer coverage_complete=true');
  assert.deepEqual(response.result.missing_tools, [], 'tools/list ne doit pas exposer de missing_tools');
  assert.equal(response.result.frontend_backend_coverage_complete, true, 'tools/list doit exposer frontend_backend_coverage_complete=true');
  assert.deepEqual(response.result.missing_frontend_backend_capabilities, [], 'tools/list ne doit pas exposer de capacites front/backend manquantes');
  assert.equal(response.result.frontend_backend_capabilities.length, FRONTEND_BACKEND_CAPABILITIES.length, 'tools/list doit exposer la matrice front/backend');
  assert.deepEqual(response.result.final_permissions, EXPECTED_PERMISSIONS, 'tools/list doit exposer les permissions finales');
  assert.equal(response.result.coverage_matrix.length, expectedModules.length, 'tools/list doit exposer la matrice complete');
  assert.equal(response.result.tool_count, response.result.tools.length, 'tool_count incoherent');

  console.log(JSON.stringify({
    ok: true,
    mcp_version: MCP_SERVER_VERSION,
    public_tool_count: publicTools.length,
    coverage_complete: coverage.coverage_complete,
    frontend_backend_coverage_complete: coverage.frontend_backend_coverage_complete,
    modules: expectedModules.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
