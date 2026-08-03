const assert = require('assert');

const { listAgentTools, listMcpTools } = require('../services/agent/agentToolRegistry');
const { updateQualityTaskStatus, completeQualityTask } = require('../services/quality/tasks');
const {
  executeManualOccurrence,
  listQualityTodayWork,
  listCompletedWorkItems,
  recordCleaningExecution,
  recordTemperatureControl,
} = require('../services/quality/operations');

const STORE_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const TASK_ID = '33333333-3333-3333-3333-333333333333';

function makeTask(overrides = {}) {
  return {
    id: TASK_ID,
    store_id: STORE_ID,
    title: 'Controle temperature chambre froide',
    module_key: 'temperature',
    task_origin: 'SYSTEM',
    source_entity_type: 'temperature_parameter',
    source_entity_id: '44444444-4444-4444-4444-444444444444',
    source_locked: true,
    frequency_value: 1,
    frequency_unit: 'days',
    target_time: '04:00',
    next_due_at: new Date('2026-08-03T04:00:00.000Z'),
    last_completed_at: null,
    ...overrides,
  };
}

function makeDb(task = makeTask()) {
  const occurrence = {
    id: '55555555-5555-5555-5555-555555555555',
    store_id: STORE_ID,
    task_id: TASK_ID,
    due_at: '2026-08-03T04:00:00.000Z',
    status: 'due',
  };
  const manualRecord = {
    id: '66666666-6666-6666-6666-666666666666',
    store_id: STORE_ID,
    quality_task_id: TASK_ID,
    occurrence_id: occurrence.id,
    result_status: 'completed',
    conformity_status: 'conform',
  };
  const calls = [];
  const temperatureRecord = {
    id: '77777777-7777-7777-7777-777777777777',
    value: 1.2,
    alert_status: 'compliant',
  };
  const cleaningRecord = {
    id: '88888888-8888-8888-8888-888888888888',
    status: 'done',
  };
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM quality_task_occurrences o/i.test(sql)) {
        return {
          rows: [{
            occurrence_id: occurrence.id,
            quality_task_id: TASK_ID,
            completed_at: '2026-08-03T04:05:00.000Z',
            result_status: 'conform',
            record_type: 'quality_manual_task_record',
            source_record_id: manualRecord.id,
            task_title: task.title,
            module_key: task.module_key,
            task_origin: 'MANUAL',
            source_locked: false,
            manual_result_status: 'completed',
            manual_conformity_status: 'conform',
            manual_observation: 'Controle realise',
            completed_by_email: 'operator@example.test',
          }],
        };
      }
      if (/FROM quality_temperature_records r/i.test(sql)) return { rows: [] };
      if (/INSERT INTO quality_temperature_records/i.test(sql)) return { rows: [temperatureRecord] };
      if (/FROM quality_cleaning_plans/i.test(sql)) return { rows: [{ id: '99999999-9999-9999-9999-999999999999', active: true, quality_task_id: TASK_ID, title: 'Plan test', zones: [], equipments: [] }] };
      if (/INSERT INTO quality_cleaning_records/i.test(sql)) return { rows: [cleaningRecord] };
      if (/FROM quality_task_occurrences/i.test(sql)) return { rows: [{ ...occurrence, status: 'completed' }] };
      if (/INSERT INTO quality_task_occurrences/i.test(sql)) return { rows: [occurrence] };
      if (/INSERT INTO quality_manual_task_records/i.test(sql)) return { rows: [manualRecord] };
      if (/UPDATE quality_task_occurrences/i.test(sql)) return { rows: [{ ...occurrence, status: 'completed', source_record_type: params[3], source_record_id: params[4] }] };
      if (/FROM quality_tasks/i.test(sql)) return { rows: [task] };
      if (/UPDATE quality_tasks/i.test(sql)) return { rows: [{ ...task, status: params[2], last_completed_at: params[3], next_due_at: params[4] }] };
      if (/INSERT INTO quality_task_history/i.test(sql)) return { rows: [] };
      if (/INSERT INTO quality_event_log/i.test(sql)) return { rows: [] };
      if (/BEGIN|COMMIT|ROLLBACK/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
}

function makePoolDb(task = makeTask()) {
  const client = makeDb(task);
  client.release = () => {};
  return {
    client,
    calls: client.calls,
    async connect() {
      return client;
    },
  };
}

function makeTodayWorkDb() {
  const eventTask = makeTask({
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    title: 'Controle reception evenementiel',
    module_key: 'manual',
    task_origin: 'MANUAL',
    source_entity_type: null,
    source_entity_id: null,
    source_locked: false,
    frequency_unit: 'events',
    next_due_at: null,
  });
  const plannedTask = makeTask({
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    title: 'Controle futur',
    module_key: 'manual',
    task_origin: 'MANUAL',
    source_entity_type: null,
    source_entity_id: null,
    source_locked: false,
    frequency_unit: 'days',
    next_due_at: '2099-01-01T04:00:00.000Z',
  });
  return {
    async query(sql, params = []) {
      if (/FROM quality_temperature_limits l/i.test(sql)) return { rows: [] };
      if (/FROM quality_cleaning_plans p/i.test(sql)) return { rows: [] };
      if (/FROM quality_tasks t/i.test(sql)) return { rows: [eventTask, plannedTask] };
      if (/FROM quality_task_occurrences o/i.test(sql)) return { rows: [] };
      if (/FROM quality_non_conformities nc/i.test(sql)) return { rows: [] };
      if (/INSERT INTO quality_task_occurrences/i.test(sql)) return { rows: [{ id: `occ-${params[1]}`, task_id: params[1], due_at: params[2], status: 'planned' }] };
      return { rows: [] };
    },
  };
}

async function main() {
  const internalTools = listAgentTools();
  const publicTools = listMcpTools();
  const internalNames = new Set(internalTools.map((tool) => tool.name));
  const publicNames = new Set(publicTools.map((tool) => tool.name));

  [
    'get_quality_today_work',
    'get_quality_overdue_work',
    'get_quality_ddpp_dashboard',
    'execute_quality_temperature_occurrence',
    'execute_quality_cleaning_occurrence',
    'execute_quality_manual_occurrence',
    'create_quality_non_conformity',
    'create_quality_corrective_action',
    'close_quality_non_conformity',
  ].forEach((name) => {
    assert(internalNames.has(name), `${name} doit exister dans le registre agent`);
    assert(publicNames.has(name), `${name} doit etre expose dans tools/list`);
  });

  const closeNc = internalTools.find((tool) => tool.name === 'close_quality_non_conformity');
  assert.equal(closeNc.requiresConfirmation, true, 'La cloture NC doit exiger une confirmation humaine');

  const temperatureExec = publicTools.find((tool) => tool.name === 'execute_quality_temperature_occurrence');
  assert(temperatureExec.inputSchema.properties.occurrence_id, 'execution temperature doit accepter occurrence_id');
  assert(temperatureExec.inputSchema.properties.quality_task_id, 'execution temperature doit accepter quality_task_id');
  assert(temperatureExec.inputSchema.properties.evidence_photo_id, 'execution temperature doit accepter evidence_photo_id');
  assert(temperatureExec.inputSchema.properties.method_used, 'execution temperature doit accepter method_used');
  const cleaningExec = publicTools.find((tool) => tool.name === 'execute_quality_cleaning_occurrence');
  assert(cleaningExec.inputSchema.properties.visual_check_status, 'execution nettoyage doit accepter visual_check_status');
  assert(cleaningExec.inputSchema.properties.anomaly_comment, 'execution nettoyage doit accepter anomaly_comment');
  const manualExec = publicTools.find((tool) => tool.name === 'execute_quality_manual_occurrence');
  assert(manualExec.inputSchema.properties.conformity_status, 'execution manuelle doit accepter conformity_status');

  const directDb = makeDb();
  await assert.rejects(
    () => updateQualityTaskStatus(directDb, STORE_ID, USER_ID, TASK_ID, { status: 'completed' }),
    /Completion directe refusee/
  );
  assert(!directDb.calls.some((call) => /UPDATE quality_tasks/i.test(call.sql)), 'La completion directe SYSTEM ne doit pas ecrire');

  const serviceDb = makeDb();
  await completeQualityTask(serviceDb, STORE_ID, USER_ID, TASK_ID, 'Releve metier cree', new Date('2026-08-03T04:05:00.000Z'));
  assert(serviceDb.calls.some((call) => /UPDATE quality_tasks/i.test(call.sql)), 'La completion service doit rester autorisee apres enregistrement metier');
  assert(serviceDb.calls.some((call) => /INSERT INTO quality_task_history/i.test(call.sql)), 'La completion service doit historiser la tache');

  const manualDb = makeDb(makeTask({ task_origin: 'MANUAL', source_locked: false, module_key: 'manual' }));
  const manualExecution = await executeManualOccurrence(manualDb, STORE_ID, USER_ID, {
    quality_task_id: TASK_ID,
    completed_at: '2026-08-03T04:05:00.000Z',
    result_status: 'completed',
    conformity_status: 'conform',
    comment: 'Controle realise',
  });
  assert(manualExecution.record, 'Une execution MANUAL doit creer une trace dediee');
  assert(manualDb.calls.some((call) => /INSERT INTO quality_manual_task_records/i.test(call.sql)), 'Trace MANUAL manquante');
  assert(manualDb.calls.some((call) => /UPDATE quality_task_occurrences/i.test(call.sql)), 'Occurrence MANUAL non completee');
  const completed = await listCompletedWorkItems(manualDb, STORE_ID, {});
  assert.equal(completed[0].type, 'manual', 'Une MANUAL realisee doit revenir dans les realises');

  const temperatureDb = makePoolDb();
  const temperature = await recordTemperatureControl(temperatureDb, STORE_ID, USER_ID, {
    quality_task_id: TASK_ID,
    type_code: 'COLD_ROOM',
    value: 1.2,
    recorded_at: '2026-08-03T04:05:00.000Z',
  });
  assert(temperature.record, 'La saisie temperature canonique doit creer un record');
  assert(temperatureDb.calls.some((call) => /UPDATE quality_task_occurrences/i.test(call.sql)), 'La saisie temperature doit completer une occurrence');

  const exceptionalDb = makePoolDb();
  await assert.rejects(
    () => recordTemperatureControl(exceptionalDb, STORE_ID, USER_ID, {
      type_code: 'COLD_ROOM',
      value: 1.2,
      source: 'exceptional',
    }),
    /Motif obligatoire/
  );

  const cleaningDb = makePoolDb();
  const cleaning = await recordCleaningExecution(cleaningDb, STORE_ID, USER_ID, {
    cleaning_plan_id: '99999999-9999-9999-9999-999999999999',
    quality_task_id: TASK_ID,
    status: 'done',
    performed_at: '2026-08-03T04:10:00.000Z',
  });
  assert(cleaning.record, 'La saisie nettoyage canonique doit creer un record');
  assert(cleaningDb.calls.some((call) => /UPDATE quality_task_occurrences/i.test(call.sql)), 'La saisie nettoyage doit completer une occurrence');

  const todayWork = await listQualityTodayWork(makeTodayWorkDb(), STORE_ID, { include_upcoming: 'true' });
  assert.equal(todayWork.summary.event_controls, 1, 'Les controles evenementiels doivent avoir leur section dediee');
  assert.equal(todayWork.sections.event_controls[0].frequency_unit, 'events', 'La frequence events doit etre conservee');
  assert(!todayWork.sections.upcoming.some((item) => item.frequency_unit === 'events'), 'Un controle events ne doit pas apparaitre dans a venir');

  console.log(JSON.stringify({
    ok: true,
    checked_public_tools: 9,
    system_direct_completion_blocked: true,
    system_business_completion_allowed: true,
    manual_execution_recorded: true,
    canonical_temperature_recorded: true,
    canonical_cleaning_recorded: true,
    event_controls_separated: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
