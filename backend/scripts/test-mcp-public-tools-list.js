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
  const expectedNames = Object.keys(PUBLIC_QUALITY_BLOCK_TOOL_ALIASES);
  const generatedTools = buildPublicMcpTools();
  const generatedNames = new Set(generatedTools.map((tool) => tool.name));

  const response = await handleRequest(fakeReq(), {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });
  assert(response?.result?.tools, 'tools/list doit retourner result.tools');
  const publicTools = response.result.tools;
  const publicNames = new Set(publicTools.map((tool) => tool.name));

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
