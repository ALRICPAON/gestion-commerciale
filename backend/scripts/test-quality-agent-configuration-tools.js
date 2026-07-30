const assert = require('assert');

const { authorizeTool } = require('../services/agent/agentAuthorizationService');
const { executeAgentTool } = require('../services/agent/agentToolExecutor');
const { getAgentTool, listMcpTools } = require('../services/agent/agentToolRegistry');

const STORE_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const ZONE_ID = '00000000-0000-4000-8000-000000000003';
const EQUIPMENT_ID = '00000000-0000-4000-8000-000000000004';
const TASK_ID = '00000000-0000-4000-8000-000000000005';
const PLAN_ID = '00000000-0000-4000-8000-000000000006';
const AUDIT_ID = '00000000-0000-4000-8000-000000000101';

function makeContext(permissions) {
  return {
    store_id: STORE_ID,
    user_id: USER_ID,
    role: 'agent',
    user_permissions: permissions,
    agent_permissions: permissions,
    source: 'mcp',
    request_id: 'req-quality-config-test',
  };
}

function makeDb(options = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });

      if (text.includes('agent_tool_audit_logs') && text.includes('INSERT')) return { rows: [{ id: AUDIT_ID }] };
      if (text.includes('agent_tool_audit_logs') && text.includes('UPDATE')) return { rows: [] };
      if (text.includes('FROM stores')) return { rows: options.missingStore ? [] : [{ id: STORE_ID }] };
      if (text.includes('FROM quality_zones')) return { rows: options.crossStoreZone ? [] : [{ id: ZONE_ID, code: 'ZONE-1', name: 'Zone 1', status: 'active' }] };
      if (text.includes('FROM quality_equipments')) return { rows: options.missingEquipment ? [] : [{ id: EQUIPMENT_ID, code: 'EQ-1', name: 'Equipement 1', zone_id: ZONE_ID, status: 'active' }] };
      if (text.includes('FROM quality_task_history')) return { rows: options.hasTaskHistory ? [{ id: 'history-1' }] : [] };
      if (text.includes("FROM quality_tasks") && text.includes("module_key = 'cleaning'")) return { rows: [{ id: TASK_ID }] };
      if (text.includes('INSERT INTO quality_tasks')) return { rows: [{ id: TASK_ID }] };
      if (text.includes('UPDATE quality_tasks')) return { rows: [{ id: TASK_ID }] };
      if (text.includes('FROM quality_tasks')) {
        return {
          rows: [{
            id: TASK_ID,
            store_id: STORE_ID,
            title: 'Controle zone',
            module_key: 'cleaning',
            entity_type: 'zone',
            entity_id: ZONE_ID,
            status: options.executedTask ? 'completed' : 'pending_review',
            active: false,
            last_completed_at: options.executedTask ? '2026-07-20T08:00:00.000Z' : null,
            configuration_status: 'pending_review',
          }],
        };
      }
      if (text.includes('INSERT INTO quality_cleaning_plans')) return { rows: [{ id: PLAN_ID }] };
      if (text.includes('UPDATE quality_cleaning_plans')) return { rows: [{ id: PLAN_ID }] };
      if (text.includes('FROM quality_cleaning_plans')) {
        return {
          rows: [{
            id: PLAN_ID,
            store_id: STORE_ID,
            title: 'Plan zone',
            zone_id: ZONE_ID,
            equipment_id: EQUIPMENT_ID,
            quality_task_id: options.incompletePlan ? null : TASK_ID,
            product_name: options.incompletePlan ? null : 'Produit fourni',
            dosage_concentration: options.incompletePlan ? null : 'A completer',
            contact_time_minutes: options.incompletePlan ? null : 10,
            active: false,
            configuration_status: 'pending_review',
          }],
        };
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
    refused = error.status >= 400 && pattern.test(error.message);
  }
  assert.equal(refused, true, message);
}

async function main() {
  const mcpTools = listMcpTools();
  const mcpNames = new Set(mcpTools.map((tool) => tool.name));
  const expectedTools = [
    'quality_create_task',
    'quality_update_task',
    'quality_create_cleaning_plan',
    'quality_update_cleaning_plan',
    'quality_assign_task_to_zone',
    'quality_assign_task_to_equipment',
    'quality_activate_configuration',
    'quality_deactivate_configuration',
  ];
  for (const name of expectedTools) {
    const tool = mcpTools.find((item) => item.name === name);
    assert(tool, `${name} non expose par MCP`);
    assert.equal(tool._meta.requiredPermission, 'quality.configuration.write', `${name} permission invalide`);
    assert.equal(tool.inputSchema.type, 'object', `${name} schema invalide`);
  }
  assert(!mcpNames.has('quality_delete_temperature_record'), 'Suppression releve exposee a tort');
  assert(!mcpNames.has('quality_delete_task_history'), 'Suppression historique exposee a tort');

  authorizeTool(getAgentTool('get_quality_context'), makeContext(['quality.configuration.write']));

  await expectForbidden(() => executeAgentTool({
    db: makeDb(),
    name: 'quality_create_task',
    input: { title: 'Controle zone', category: 'inspection', zone_id: ZONE_ID },
    context: makeContext(['quality.read']),
  }), 'creation tache doit etre refusee sans quality.configuration.write');

  const taskDb = makeDb();
  const taskResult = await executeAgentTool({
    db: taskDb,
    name: 'quality_create_task',
    input: { title: 'Controle zone', category: 'inspection', zone_id: ZONE_ID, frequency_value: 1, frequency_unit: 'days' },
    context: makeContext(['quality.read', 'quality.configuration.write']),
  });
  assert.equal(taskResult.ok, true);
  assert.equal(taskResult.data.summary.id, TASK_ID);
  assert(taskDb.calls.some((call) => call.sql.includes('INSERT INTO quality_tasks')), 'creation tache non executee');
  assert(taskDb.calls.some((call) => call.sql.includes('agent_tool_audit_logs')), 'creation tache non auditee');

  await expectForbidden(() => executeAgentTool({
    db: makeDb(),
    name: 'quality_create_cleaning_plan',
    input: { title: 'Plan zone', zone_id: ZONE_ID },
    context: makeContext(['quality.read']),
  }), 'creation plan doit etre refusee sans quality.configuration.write');

  const planDb = makeDb();
  const planResult = await executeAgentTool({
    db: planDb,
    name: 'quality_create_cleaning_plan',
    input: { title: 'Plan zone', zone_id: ZONE_ID, equipment_id: EQUIPMENT_ID, quality_task_id: TASK_ID },
    context: makeContext(['quality.read', 'quality.configuration.write']),
  });
  assert.equal(planResult.ok, true);
  assert.equal(planResult.data.summary.id, PLAN_ID);
  assert(planDb.calls.some((call) => call.sql.includes('INSERT INTO quality_cleaning_plans')), 'creation plan non executee');

  await expectBusinessRefusal(() => executeAgentTool({
    db: makeDb({ crossStoreZone: true }),
    name: 'quality_create_task',
    input: { title: 'Controle autre magasin', zone_id: ZONE_ID },
    context: makeContext(['quality.read', 'quality.configuration.write']),
  }), /Zone qualite introuvable/, 'association inter-magasins doit etre refusee');

  await expectBusinessRefusal(() => executeAgentTool({
    db: makeDb({ missingEquipment: true }),
    name: 'quality_create_cleaning_plan',
    input: { title: 'Plan equipement absent', equipment_id: EQUIPMENT_ID },
    context: makeContext(['quality.read', 'quality.configuration.write']),
  }), /Equipement qualite introuvable/, 'equipement inexistant doit etre refuse');

  await expectBusinessRefusal(() => executeAgentTool({
    db: makeDb({ executedTask: true }),
    name: 'quality_update_task',
    input: { task_id: TASK_ID, title: 'Modification interdite' },
    context: makeContext(['quality.read', 'quality.configuration.write']),
  }), /deja executee/, 'modification tache executee doit etre refusee');

  await expectBusinessRefusal(() => executeAgentTool({
    db: makeDb({ incompletePlan: true }),
    name: 'quality_activate_configuration',
    input: { type: 'cleaning_plan', cleaning_plan_id: PLAN_ID },
    context: makeContext(['quality.read', 'quality.configuration.write']),
  }), /Activation refusee/, 'activation plan incomplet doit etre refusee');

  console.log(JSON.stringify({ ok: true, checked_tools: expectedTools.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
