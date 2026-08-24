const router = require('../routes/mcpServer');

const {
  MCP_SERVER_VERSION,
  PUBLIC_QUALITY_BLOCK_TOOL_ALIASES,
  buildPublicMcpTools,
  handleRequest,
} = router._private;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectedPermissionForPublicAlias(name) {
  if (name === 'articles_create') return 'articles.write';
  if ([
    'quality_documentation_list_all_tables',
    'quality_documentation_get_table',
    'quality_documentation_list_all_diagrams',
    'quality_documentation_get_diagram',
    'quality_documentation_diagnose_structured_objects',
  ].includes(name)) return 'quality.documentation.read';
  return 'quality.documentation.edit';
}

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
  const previousPermissions = process.env.ALTA_AGENT_PERMISSIONS;
  const expectedNames = Object.keys(PUBLIC_QUALITY_BLOCK_TOOL_ALIASES);
  const expectedMasterDocumentTools = [
    'list_quality_master_documents',
    'get_quality_master_document',
    'create_quality_master_document',
    'update_quality_master_document',
    'archive_quality_master_document',
    'link_existing_attachment_to_master_document',
    'add_quality_document_reference',
    'archive_quality_document_reference',
    'list_quality_document_references',
    'list_quality_document_incoming_references',
    'compare_quality_documents',
    'diagnose_quality_document_duplicates',
  ];
  const expectedSupplyMaterialTools = [
    'list_supplies_materials',
    'get_supply_material',
    'search_supplies_materials',
    'list_supply_material_documents',
    'list_supply_material_links',
    'create_supply_material',
    'update_supply_material',
    'archive_supply_material',
    'add_supply_material_document_reference',
    'add_supply_material_link',
    'archive_supply_material_link',
    'diagnose_supplies_materials',
  ];
  const expectedQualityTraceabilityRecallTools = [
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
  const generatedTools = buildPublicMcpTools();
  const generatedNames = new Set(generatedTools.map((tool) => tool.name));

  const response = await handleRequest(fakeReq(), {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });
  assert(response?.result?.tools, 'tools/list doit retourner result.tools');
  assert(response.result.coverage_complete === true, 'tools/list doit exposer coverage_complete=true');
  assert(response.result.frontend_backend_coverage_complete === true, 'tools/list doit exposer frontend_backend_coverage_complete=true');
  assert(Array.isArray(response.result.coverage_matrix), 'tools/list doit exposer coverage_matrix');
  assert(Array.isArray(response.result.frontend_backend_capabilities), 'tools/list doit exposer frontend_backend_capabilities');
  assert(Array.isArray(response.result.final_permissions), 'tools/list doit exposer final_permissions');
  assert(response.result.final_permissions.includes('mcp.execute'), 'tools/list doit exposer mcp.execute');
  assert(response.result.final_permissions.includes('articles.write'), 'tools/list doit exposer articles.write');
  assert(response.result.final_permissions.includes('call_sheet.write'), 'tools/list doit exposer call_sheet.write');
  assert(response.result.final_permissions.includes('quality.documentation.edit'), 'tools/list doit exposer quality.documentation.edit');
  assert(response.result.final_permissions.includes('supplies_materials.read'), 'tools/list doit exposer supplies_materials.read');
  assert(JSON.stringify(response.result.missing_tools) === '[]', 'tools/list ne doit pas exposer de missing_tools');
  assert(JSON.stringify(response.result.missing_frontend_backend_capabilities) === '[]', 'tools/list ne doit pas exposer de capacites front/backend manquantes');
  const publicTools = response.result.tools;
  const publicNames = new Set(publicTools.map((tool) => tool.name));
  const articlePrepareTool = publicTools.find((tool) => tool.name === 'prepare_article_update');
  assert(articlePrepareTool, 'prepare_article_update absent de tools/list');
  assert(articlePrepareTool.inputSchema?.properties?.changes?.properties?.storage_temperature_min, 'prepare_article_update doit exposer storage_temperature_min');
  assert(articlePrepareTool.inputSchema?.properties?.changes?.properties?.storage_temperature_max, 'prepare_article_update doit exposer storage_temperature_max');
  assert(articlePrepareTool.inputSchema?.properties?.changes?.properties?.storage_instruction, 'prepare_article_update doit exposer storage_instruction');
  for (const name of ['list_call_sheets', 'get_call_sheet', 'search_call_sheet_lines', 'prepare_call_sheet_add_line', 'prepare_call_sheet_update_line', 'prepare_call_sheet_delete_line']) {
    assert(publicNames.has(name), `${name} absent de tools/list`);
  }

  for (const name of [
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
    ...expectedMasterDocumentTools,
    ...expectedSupplyMaterialTools,
    ...expectedQualityTraceabilityRecallTools,
  ]) {
    assert(publicNames.has(name), `${name} absent de la reponse MCP tools/list`);
    const tool = publicTools.find((item) => item.name === name);
    assert(tool.description, `${name} description manquante`);
    assert(tool.inputSchema?.type === 'object', `${name} inputSchema invalide`);
  }

  try {
    process.env.ALTA_AGENT_PERMISSIONS = 'agent.use';
    for (const name of expectedNames) {
      assert(generatedNames.has(name), `${name} absent de buildPublicMcpTools`);
      assert(publicNames.has(name), `${name} absent de la reponse MCP tools/list`);
      const tool = publicTools.find((item) => item.name === name);
      assert(tool.description, `${name} description manquante`);
      assert(tool.inputSchema?.type === 'object', `${name} inputSchema invalide`);
      const expectedPermission = expectedPermissionForPublicAlias(name);
      assert(tool._meta?.requiredPermission === expectedPermission, `${name} permission MCP invalide`);
      assert(tool._meta?.internalToolName === PUBLIC_QUALITY_BLOCK_TOOL_ALIASES[name], `${name} mapping interne invalide`);
      const callResponse = await handleRequest(fakeReq(), {
        jsonrpc: '2.0',
        id: `call-${name}`,
        method: 'tools/call',
        params: { name, arguments: {} },
      });
      assert(!callResponse.error, `${name} ne doit pas etre rejete comme outil inconnu`);
      assert(callResponse.result?.isError === true, `${name} doit atteindre le handler MCP`);
      assert(JSON.stringify(callResponse.result).includes('Permission requise'), `${name} doit etre controle par les permissions du handler interne`);
    }
  } finally {
    if (previousPermissions === undefined) delete process.env.ALTA_AGENT_PERMISSIONS;
    else process.env.ALTA_AGENT_PERMISSIONS = previousPermissions;
  }

  console.log(JSON.stringify({
    ok: true,
    mcp_version: MCP_SERVER_VERSION,
    public_tool_count: publicTools.length,
    registry_source: 'legacyTools + agentToolRegistry.listMcpTools + public underscore aliases',
    expected_tools: [...expectedNames, ...expectedMasterDocumentTools, ...expectedSupplyMaterialTools, ...expectedQualityTraceabilityRecallTools].map((name) => ({
      name,
      present: publicNames.has(name),
      internal_tool: PUBLIC_QUALITY_BLOCK_TOOL_ALIASES[name],
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
