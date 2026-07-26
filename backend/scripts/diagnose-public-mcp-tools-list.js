const DEFAULT_MCP_URL = 'https://api.altamaree.fr/mcp';

const EXPECTED_TOOLS = [
  'quality_documentation_update_text_block',
  'quality_documentation_add_text_block',
  'quality_documentation_add_table_block',
  'quality_documentation_add_diagram_block',
  'quality_documentation_delete_block',
  'quality_documentation_move_block',
];

async function rpc(url, method, id = 1) {
  const apiKey = String(process.env.ALTA_AGENT_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('ALTA_AGENT_API_KEY requis dans l environnement pour interroger le MCP public');
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method }),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Reponse non JSON (${response.status}): ${text.slice(0, 300)}`);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(json)}`);
  }
  if (json.error) {
    throw new Error(`MCP ${json.error.code}: ${json.error.message}`);
  }
  return json.result || {};
}

async function main() {
  const url = process.argv[2] || process.env.ALTA_MCP_URL || DEFAULT_MCP_URL;
  const initialized = await rpc(url, 'initialize', 1);
  const listed = await rpc(url, 'tools/list', 2);
  const tools = Array.isArray(listed.tools) ? listed.tools : [];
  const names = new Set(tools.map((tool) => tool.name));
  const checks = EXPECTED_TOOLS.map((name) => ({
    name,
    present: names.has(name),
    internal_tool: tools.find((tool) => tool.name === name)?._meta?.internalToolName || null,
    required_permission: tools.find((tool) => tool.name === name)?._meta?.requiredPermission || null,
  }));

  console.log(JSON.stringify({
    ok: checks.every((item) => item.present),
    url,
    protocol_version: initialized.protocolVersion || null,
    mcp_version: initialized.serverInfo?.version || null,
    public_tool_count: tools.length,
    registry_source: 'public MCP tools/list response from /mcp',
    expected_tools: checks,
  }, null, 2));

  if (!checks.every((item) => item.present)) process.exit(1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
