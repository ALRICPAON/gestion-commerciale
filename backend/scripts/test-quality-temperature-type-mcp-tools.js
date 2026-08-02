const assert = require('assert');

const { executeAgentTool } = require('../services/agent/agentToolExecutor');
const { listMcpTools } = require('../services/agent/agentToolRegistry');

const STORE_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const LIMIT_ID = '00000000-0000-4000-8000-000000000003';
const AUDIT_ID = '00000000-0000-4000-8000-000000000101';

function makeContext(permissions) {
  return {
    store_id: STORE_ID,
    user_id: USER_ID,
    role: 'agent',
    user_permissions: permissions,
    agent_permissions: permissions,
    source: 'mcp',
    request_id: 'req-quality-temperature-types-test',
  };
}

function makeDb(options = {}) {
  const calls = [];
  const state = {
    nextLimit: 1,
    types: [
      { code: 'COLD_ROOM', label: 'Chambre froide', default_unit: 'C', category: 'storage', is_active: true },
      { code: 'WORKSHOP', label: 'Atelier', default_unit: 'C', category: 'zone', is_active: true },
      { code: 'ARCHIVED_TYPE', label: 'Archive', default_unit: 'C', category: 'legacy', is_active: false },
    ],
    limits: options.initialLimit ? [{
      id: LIMIT_ID,
      store_id: STORE_ID,
      type_code: 'COLD_ROOM',
      zone_id: null,
      equipment_id: null,
      min_value: 0,
      max_value: 4,
      unit: 'C',
      expected_frequency_value: null,
      expected_frequency_unit: null,
      target_time: null,
      quality_task_id: null,
      is_active: true,
      valid_from: '2026-08-02',
      valid_until: null,
    }] : [],
  };

  function enrichLimit(limit) {
    if (!limit) return null;
    const type = state.types.find((item) => item.code === limit.type_code);
    return {
      ...limit,
      type_label: type?.label || null,
      type_default_unit: type?.default_unit || null,
      type_category: type?.category || null,
      type_active: type?.is_active === true,
      task_id: null,
    };
  }

  return {
    calls,
    state,
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });

      if (text.includes('agent_tool_audit_logs') && text.includes('INSERT')) return { rows: [{ id: AUDIT_ID }] };
      if (text.includes('agent_tool_audit_logs') && text.includes('UPDATE')) return { rows: [] };

      if (text.includes('FROM quality_temperature_types')) {
        return { rows: state.types.filter((type) => type.is_active).sort((a, b) => a.label.localeCompare(b.label)) };
      }

      if (text.includes('FROM quality_tasks')) return { rows: [] };

      if (text.includes('INSERT INTO quality_temperature_limits')) {
        const limit = {
          id: `00000000-0000-4000-8000-${String(state.nextLimit).padStart(12, '0')}`,
          store_id: params[0],
          type_code: params[1],
          zone_id: params[2],
          equipment_id: params[3],
          min_value: params[4],
          max_value: params[5],
          unit: params[6],
          expected_frequency_value: params[7],
          expected_frequency_unit: params[8],
          target_time: params[9],
          quality_task_id: params[10],
          is_active: params[11],
          valid_from: params[12],
          valid_until: params[13],
        };
        state.nextLimit += 1;
        state.limits.push(limit);
        return { rows: [{ id: limit.id }] };
      }

      if (text.includes('UPDATE quality_temperature_limits')) {
        const limit = state.limits.find((item) => item.id === params[0] && item.store_id === params[1]);
        if (!limit) return { rows: [] };
        Object.assign(limit, {
          type_code: params[2],
          zone_id: params[3],
          equipment_id: params[4],
          min_value: params[5],
          max_value: params[6],
          unit: params[7],
          expected_frequency_value: params[8],
          expected_frequency_unit: params[9],
          target_time: params[10],
          quality_task_id: params[11],
          is_active: params[12],
          valid_from: params[13],
          valid_until: params[14],
        });
        return { rows: [{ id: limit.id }] };
      }

      if (text.includes('FROM quality_temperature_limits l')) {
        if (params.length >= 2 && text.includes('WHERE l.id = $1')) {
          return { rows: state.limits.filter((limit) => limit.id === params[0] && limit.store_id === params[1]).map(enrichLimit) };
        }
        return { rows: state.limits.filter((limit) => limit.store_id === params[0]).map(enrichLimit) };
      }

      return { rows: [] };
    },
  };
}

async function expectForbidden(action, message) {
  let refused = false;
  try {
    await action();
  } catch (error) {
    refused = error.status === 403;
  }
  assert.equal(refused, true, message);
}

async function expectBusinessRefusal(action, pattern, message) {
  let refused = false;
  try {
    await action();
  } catch (error) {
    refused = error.status === 400 && pattern.test(error.message);
  }
  assert.equal(refused, true, message);
}

async function expectInvalidType(action, message) {
  let refused = false;
  try {
    await action();
  } catch (error) {
    refused = error.status === 400
      && /Type de temperature invalide/.test(error.message)
      && error.message.includes('COLD_ROOM')
      && error.message.includes('WORKSHOP');
  }
  assert.equal(refused, true, message);
}

async function main() {
  const mcpTools = listMcpTools();
  const listTypesTool = mcpTools.find((tool) => tool.name === 'list_quality_temperature_types');
  assert(listTypesTool, 'list_quality_temperature_types non expose par MCP');
  assert.equal(listTypesTool._meta.requiredPermission, 'quality.read', 'Permission lecture invalide pour list_quality_temperature_types');
  assert.equal(listTypesTool.inputSchema.type, 'object', 'Schema invalide pour list_quality_temperature_types');

  const readDb = makeDb();
  const typesResult = await executeAgentTool({
    db: readDb,
    name: 'list_quality_temperature_types',
    input: {},
    context: makeContext(['quality.read']),
  });
  assert.equal(typesResult.ok, true);
  assert.deepEqual(typesResult.data.types.map((type) => type.code), ['WORKSHOP', 'COLD_ROOM']);
  assert(!typesResult.data.types.some((type) => type.code === 'ARCHIVED_TYPE'), 'Les types inactifs ne doivent pas etre exposes');

  await expectForbidden(() => executeAgentTool({
    db: makeDb(),
    name: 'create_quality_temperature_parameter',
    input: { type_code: 'COLD_ROOM', min_value: 0, max_value: 4 },
    context: makeContext(['quality.read']),
  }), 'creation parametre temperature doit etre refusee sans quality.configuration.write');

  const createDb = makeDb();
  const created = await executeAgentTool({
    db: createDb,
    name: 'create_quality_temperature_parameter',
    input: { type_code: 'COLD_ROOM', min_value: 0, max_value: 4, unit: 'C' },
    context: makeContext(['quality.read', 'quality.configuration.write']),
  });
  assert.equal(created.ok, true);
  assert.equal(created.data.parameter.type_code, 'COLD_ROOM');
  assert.equal(created.data.parameter.type_label, 'Chambre froide');
  assert(createDb.calls.some((call) => call.sql.includes('INSERT INTO quality_temperature_limits')), 'creation limite non executee');

  const invalidCreateDb = makeDb();
  await expectInvalidType(() => executeAgentTool({
    db: invalidCreateDb,
    name: 'create_quality_temperature_parameter',
    input: { type_code: 'UNKNOWN_TYPE', min_value: 0, max_value: 4 },
    context: makeContext(['quality.read', 'quality.configuration.write']),
  }), 'type_code inconnu doit produire une erreur metier lisible');
  assert(!invalidCreateDb.calls.some((call) => call.sql.includes('INSERT INTO quality_temperature_limits')), 'type_code invalide ne doit pas atteindre INSERT');

  const updateDb = makeDb({ initialLimit: true });
  const updated = await executeAgentTool({
    db: updateDb,
    name: 'update_quality_temperature_parameter',
    input: { temperature_parameter_id: LIMIT_ID, type_code: 'WORKSHOP', min_value: 1, max_value: 8, unit: 'C' },
    context: makeContext(['quality.read', 'quality.configuration.write']),
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.data.parameter.type_code, 'WORKSHOP');
  assert.equal(updated.data.parameter.type_label, 'Atelier');

  const invalidUpdateDb = makeDb({ initialLimit: true });
  await expectInvalidType(() => executeAgentTool({
    db: invalidUpdateDb,
    name: 'update_quality_temperature_parameter',
    input: { temperature_parameter_id: LIMIT_ID, type_code: 'ARCHIVED_TYPE', min_value: 1, max_value: 8 },
    context: makeContext(['quality.read', 'quality.configuration.write']),
  }), 'type_code inactif doit etre refuse avant UPDATE');
  assert(!invalidUpdateDb.calls.some((call) => call.sql.includes('UPDATE quality_temperature_limits')), 'type_code inactif ne doit pas atteindre UPDATE');

  console.log(JSON.stringify({ ok: true, checked_tool: 'list_quality_temperature_types', active_type_count: typesResult.data.types.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
