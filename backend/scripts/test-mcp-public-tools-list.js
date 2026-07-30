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
  const generatedTools = buildPublicMcpTools();
  const generatedNames = new Set(generatedTools.map((tool) => tool.name));

  const response = await handleRequest(fakeReq(), {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });
  assert(response?.result?.tools, 'tools/list doit retourner result.tools');
  assert(response.result.coverage_complete === true, 'tools/list doit exposer coverage_complete=true');
  assert(Array.isArray(response.result.coverage_matrix), 'tools/list doit exposer coverage_matrix');
  assert(Array.isArray(response.result.final_permissions), 'tools/list doit exposer final_permissions');
  assert(response.result.final_permissions.includes('mcp.execute'), 'tools/list doit exposer mcp.execute');
  assert(response.result.final_permissions.includes('quality.documentation.edit'), 'tools/list doit exposer quality.documentation.edit');
  assert(JSON.stringify(response.result.missing_tools) === '[]', 'tools/list ne doit pas exposer de missing_tools');
  const publicTools = response.result.tools;
  const publicNames = new Set(publicTools.map((tool) => tool.name));

  try {
    process.env.ALTA_AGENT_PERMISSIONS = 'agent.use,quality.documentation.read';
    for (const name of expectedNames) {
      assert(generatedNames.has(name), `${name} absent de buildPublicMcpTools`);
      assert(publicNames.has(name), `${name} absent de la reponse MCP tools/list`);
      const tool = publicTools.find((item) => item.name === name);
      assert(tool.description, `${name} description manquante`);
      assert(tool.inputSchema?.type === 'object', `${name} inputSchema invalide`);
      assert(tool._meta?.requiredPermission === 'quality.documentation.edit', `${name} permission MCP invalide`);
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
    expected_tools: expectedNames.map((name) => ({
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
