const assert = require('assert');

const { executeAgentTool } = require('../services/agent/agentToolExecutor');
const { listMcpTools } = require('../services/agent/agentToolRegistry');

const STORE_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const LIMIT_ID = '00000000-0000-4000-8000-000000000003';
const TASK_ID = '00000000-0000-4000-8000-000000000004';
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
    nextTask: 4,
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
      target_times: [],
      scheduled_days: [],
      responsible_user_id: null,
      quality_task_id: null,
      is_active: true,
      valid_from: '2026-08-02',
      valid_until: null,
    }] : [],
    tasks: [],
    links: [],
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
      task_id: limit.quality_task_id || null,
      task_title: limit.quality_task_id ? state.tasks.find((task) => task.id === limit.quality_task_id)?.title : null,
      task_frequency_value: limit.quality_task_id ? state.tasks.find((task) => task.id === limit.quality_task_id)?.frequency_value : null,
      task_frequency_unit: limit.quality_task_id ? state.tasks.find((task) => task.id === limit.quality_task_id)?.frequency_unit : null,
      task_target_time: limit.quality_task_id ? state.tasks.find((task) => task.id === limit.quality_task_id)?.target_time : null,
      task_status: limit.quality_task_id ? state.tasks.find((task) => task.id === limit.quality_task_id)?.status : null,
      task_active: limit.quality_task_id ? state.tasks.find((task) => task.id === limit.quality_task_id)?.active : null,
      task_origin: limit.quality_task_id ? state.tasks.find((task) => task.id === limit.quality_task_id)?.task_origin : null,
      task_source_entity_type: limit.quality_task_id ? state.tasks.find((task) => task.id === limit.quality_task_id)?.source_entity_type : null,
      task_source_entity_id: limit.quality_task_id ? state.tasks.find((task) => task.id === limit.quality_task_id)?.source_entity_id : null,
      task_source_locked: limit.quality_task_id ? state.tasks.find((task) => task.id === limit.quality_task_id)?.source_locked : null,
      schedule_tasks: state.links
        .filter((link) => link.limit_id === limit.id && !link.deleted_at)
        .map((link) => ({
          task_id: link.task_id,
          scheduled_day: link.scheduled_day === 'any' ? null : link.scheduled_day,
          target_time: link.target_time === '00:00:00' ? null : link.target_time,
        })),
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

      if (text.includes('FROM quality_tasks')) {
        if (text.includes('t.id = $1')) return { rows: state.tasks.filter((task) => task.id === params[0] && task.store_id === params[1]) };
        return { rows: state.tasks };
      }

      if (text.includes('INSERT INTO quality_tasks')) {
        const taskId = `00000000-0000-4000-8000-${String(state.nextTask).padStart(12, '0')}`;
        state.nextTask += 1;
        const task = {
          id: taskId,
          store_id: params[0],
          title: params[1],
          module_key: params[3],
          entity_type: params[4],
          entity_id: params[5],
          responsible_user_id: params[6],
          frequency_value: params[7],
          frequency_unit: params[8],
          target_time: params[9],
          next_due_at: params[10],
          status: params[11],
          active: params[12],
          category: params[13],
          proof_required: params[18],
          photo_required: params[19],
          configuration_status: params[23],
          created_source: params[24],
          created_by_agent: params[25],
          task_origin: params[27],
          source_entity_type: params[28],
          source_entity_id: params[29],
          source_locked: params[30],
        };
        state.tasks.push(task);
        return { rows: [{ id: task.id }] };
      }

      if (text.includes('UPDATE quality_tasks')) {
        const task = state.tasks.find((item) => item.id === params[0] && item.store_id === params[1]);
        if (!task) return { rows: [] };
        if (text.includes("status='archived'")) {
          Object.assign(task, {
            active: false,
            status: 'archived',
            configuration_status: 'archived',
            archived_by: params[2],
          });
          return { rows: [{ id: task.id }] };
        }
        Object.assign(task, {
          title: params[2],
          module_key: params[4],
          entity_type: params[5],
          entity_id: params[6],
          responsible_user_id: params[7],
          frequency_value: params[8],
          frequency_unit: params[9],
          target_time: params[10],
          next_due_at: params[11],
          status: params[12],
          active: params[13],
          category: params[14],
          proof_required: params[19],
          photo_required: params[20],
          configuration_status: params[24],
          created_source: params[25],
          created_by_agent: params[26],
          task_origin: params[28],
          source_entity_type: params[29],
          source_entity_id: params[30],
          source_locked: params[31],
        });
        return { rows: [{ id: task.id }] };
      }

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
          responsible_user_id: params[10],
          quality_task_id: params[11],
          is_active: params[12],
          valid_from: params[13],
          valid_until: params[14],
          scheduled_days: JSON.parse(params[15] || '[]'),
          target_times: JSON.parse(params[16] || '[]'),
        };
        state.nextLimit += 1;
        state.limits.push(limit);
        return { rows: [{ id: limit.id }] };
      }

      if (text.includes('UPDATE quality_temperature_limits')) {
        const limit = state.limits.find((item) => item.id === params[0] && item.store_id === params[1]);
        if (!limit) return { rows: [] };
        if (text.includes('SET quality_task_id=$3')) {
          limit.quality_task_id = params[2];
          return { rows: [{ id: limit.id }] };
        }
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
          responsible_user_id: params[11],
          quality_task_id: params[12],
          is_active: params[13],
          valid_from: params[14],
          valid_until: params[15],
          scheduled_days: JSON.parse(params[16] || '[]'),
          target_times: JSON.parse(params[17] || '[]'),
        });
        return { rows: [{ id: limit.id }] };
      }

      if (text.includes('SELECT limit_id, scheduled_day, target_time, task_id')
        && text.includes('FROM quality_temperature_limit_tasks')) {
        return { rows: state.links.filter((link) => link.limit_id === params[0] && !link.deleted_at) };
      }

      if (text.includes('INSERT INTO quality_temperature_limit_tasks')) {
        const [limitId, scheduledDay, targetTime, taskId, createdBy] = params;
        const existing = state.links.find((link) => link.limit_id === limitId && link.scheduled_day === scheduledDay && link.target_time === targetTime);
        if (existing) {
          existing.task_id = taskId;
          existing.deleted_at = null;
          existing.deleted_by = null;
        } else {
          state.links.push({ limit_id: limitId, scheduled_day: scheduledDay, target_time: targetTime, task_id: taskId, created_by: createdBy, deleted_at: null, deleted_by: null });
        }
        return { rows: [] };
      }

      if (text.includes('UPDATE quality_temperature_limit_tasks')) {
        const [limitId, scheduledDay, targetTime, deletedBy] = params;
        const link = state.links.find((item) => item.limit_id === limitId && item.scheduled_day === scheduledDay && item.target_time === targetTime && !item.deleted_at);
        if (link) {
          link.deleted_at = new Date().toISOString();
          link.deleted_by = deletedBy;
        }
        return { rows: [] };
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
  assert(createDb.calls.some((call) => call.sql.includes('INSERT INTO quality_tasks')), 'creation parametre temperature doit generer une tache systeme');
  assert.equal(createDb.state.tasks[0].task_origin, 'SYSTEM', 'tache temperature doit etre SYSTEM');
  assert.equal(createDb.state.tasks[0].source_entity_type, 'temperature_parameter', 'tache temperature doit pointer vers le parametre');
  assert.equal(createDb.state.tasks[0].source_locked, true, 'tache temperature doit etre verrouillee par sa source');

  const scheduledDb = makeDb();
  const scheduled = await executeAgentTool({
    db: scheduledDb,
    name: 'create_quality_temperature_parameter',
    input: {
      type_code: 'WORKSHOP',
      min_value: 0,
      max_value: 8,
      unit: 'C',
      expected_frequency_value: 1,
      expected_frequency_unit: 'events',
      scheduled_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
      target_times: ['04:00', '08:00', '12:00'],
    },
    context: makeContext(['quality.read', 'quality.configuration.write']),
  });
  assert.equal(scheduled.ok, true);
  assert.deepEqual(scheduled.data.parameter.scheduled_days, ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
  assert.deepEqual(scheduled.data.parameter.target_times, ['04:00:00', '08:00:00', '12:00:00']);
  assert.equal(scheduled.data.parameter.target_time, '04:00:00', 'target_time legacy doit rester le premier horaire');
  assert.equal(scheduledDb.state.tasks.length, 18, 'lundi-samedi x 3 horaires doit generer 18 taches systeme');
  assert.equal(scheduledDb.state.links.filter((link) => !link.deleted_at).length, 18, 'chaque creneau doit avoir une liaison tache');
  assert(scheduled.data.parameter.quality_task_id, 'quality_task_id primaire legacy doit rester renseigne');
  assert(scheduledDb.state.tasks.every((task) => task.task_origin === 'SYSTEM' && task.source_locked === true), 'toutes les taches creneau doivent etre SYSTEM verrouillees');

  const updatedSchedule = await executeAgentTool({
    db: scheduledDb,
    name: 'update_quality_temperature_parameter',
    input: {
      temperature_parameter_id: scheduled.data.parameter.id,
      type_code: 'WORKSHOP',
      min_value: 0,
      max_value: 8,
      unit: 'C',
      expected_frequency_value: 1,
      expected_frequency_unit: 'events',
      scheduled_days: ['monday', 'tuesday'],
      target_times: ['04:00'],
    },
    context: makeContext(['quality.read', 'quality.configuration.write']),
  });
  assert.equal(updatedSchedule.ok, true);
  assert.deepEqual(updatedSchedule.data.parameter.scheduled_days, ['monday', 'tuesday']);
  assert.deepEqual(updatedSchedule.data.parameter.target_times, ['04:00:00']);
  assert.equal(scheduledDb.state.links.filter((link) => !link.deleted_at).length, 2, 'mise a jour doit retirer les liaisons obsoletes');
  assert(scheduledDb.state.tasks.some((task) => task.status === 'archived'), 'les taches des creneaux retires doivent etre archivees');

  const movedPrimary = await executeAgentTool({
    db: scheduledDb,
    name: 'update_quality_temperature_parameter',
    input: {
      temperature_parameter_id: scheduled.data.parameter.id,
      type_code: 'WORKSHOP',
      min_value: 0,
      max_value: 8,
      unit: 'C',
      expected_frequency_value: 1,
      expected_frequency_unit: 'events',
      scheduled_days: ['tuesday'],
      target_times: ['04:00'],
    },
    context: makeContext(['quality.read', 'quality.configuration.write']),
  });
  const activePrimaryLink = scheduledDb.state.links.find((link) => !link.deleted_at && link.scheduled_day === 'tuesday' && link.target_time === '04:00:00');
  assert.equal(movedPrimary.data.parameter.quality_task_id, activePrimaryLink.task_id, 'quality_task_id legacy doit suivre le premier creneau actif');

  await expectBusinessRefusal(() => executeAgentTool({
    db: makeDb(),
    name: 'create_quality_temperature_parameter',
    input: { type_code: 'WORKSHOP', min_value: 0, max_value: 8, scheduled_days: ['sunday'], target_times: ['04:00'] },
    context: makeContext(['quality.read', 'quality.configuration.write']),
  }), /Jour de planification/, 'dimanche doit rester refuse pour le planning temperature ALTA');

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
