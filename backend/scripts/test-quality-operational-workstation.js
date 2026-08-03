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
      if (/INSERT INTO quality_temperature_records/i.test(sql)) return { rows: [{ ...temperatureRecord, source: params[7] }] };
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
  let connectCount = 0;
  let releaseCount = 0;
  let endCount = 0;
  client._connected = true;
  client.connect = async () => {
    throw new Error('Client has already been connected. You cannot reuse a client.');
  };
  client.end = async () => {
    endCount += 1;
    throw new Error('Pool client end must not be called.');
  };
  client.release = () => { releaseCount += 1; };
  return {
    client,
    calls: client.calls,
    stats() {
      return { connectCount, releaseCount, endCount };
    },
    async connect() {
      connectCount += 1;
      return client;
    },
  };
}

function makeFailingTemperaturePoolDb() {
  const pool = makePoolDb();
  const originalQuery = pool.client.query;
  pool.client.query = async (sql, params = []) => {
    if (/INSERT INTO quality_temperature_records/i.test(sql)) {
      throw new Error('simulated temperature insert failure');
    }
    return originalQuery.call(pool.client, sql, params);
  };
  return pool;
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
    'get_quality_ddpp_record_detail',
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

  const manualPoolDb = makePoolDb(makeTask({ task_origin: 'MANUAL', source_locked: false, module_key: 'manual' }));
  await executeManualOccurrence(manualPoolDb, STORE_ID, USER_ID, {
    quality_task_id: TASK_ID,
    completed_at: '2026-08-03T04:05:00.000Z',
    result_status: 'completed',
    conformity_status: 'conform',
    comment: 'Controle realise',
  });
  assert.equal(manualPoolDb.stats().connectCount, 1, 'La transaction manuelle ne doit acquerir qu un client');
  assert.equal(manualPoolDb.stats().releaseCount, 1, 'La transaction manuelle doit liberer le client une seule fois');
  assert.equal(manualPoolDb.stats().endCount, 0, 'Aucun end() ne doit etre appele sur un client du pool');

  const temperatureDb = makePoolDb();
  const temperature = await recordTemperatureControl(temperatureDb, STORE_ID, USER_ID, {
    quality_task_id: TASK_ID,
    type_code: 'COLD_ROOM',
    value: 1.2,
    recorded_at: '2026-08-03T04:05:00.000Z',
  });
  assert(temperature.record, 'La saisie temperature canonique doit creer un record');
  assert.equal(temperature.record.source, 'api', 'La saisie temperature operationnelle doit ecrire source=api');
  assert(temperatureDb.calls.some((call) => /UPDATE quality_task_occurrences/i.test(call.sql)), 'La saisie temperature doit completer une occurrence');
  assert.equal(temperatureDb.stats().connectCount, 1, 'La transaction temperature ne doit acquerir qu un client');
  assert.equal(temperatureDb.stats().releaseCount, 1, 'La transaction temperature doit liberer le client une seule fois');
  assert.equal(temperatureDb.stats().endCount, 0, 'Aucun end() temperature ne doit etre appele sur un client du pool');
  assert.equal(temperatureDb.calls.filter((call) => /^BEGIN$/i.test(call.sql)).length, 1, 'BEGIN temperature unique attendu');
  assert.equal(temperatureDb.calls.filter((call) => /^COMMIT$/i.test(call.sql)).length, 1, 'COMMIT temperature unique attendu');
  assert.equal(temperatureDb.calls.filter((call) => /^ROLLBACK$/i.test(call.sql)).length, 0, 'ROLLBACK temperature inattendu');

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
  assert.equal(cleaningDb.stats().connectCount, 1, 'La transaction nettoyage ne doit acquerir qu un client');
  assert.equal(cleaningDb.stats().releaseCount, 1, 'La transaction nettoyage doit liberer le client une seule fois');
  assert.equal(cleaningDb.stats().endCount, 0, 'Aucun end() nettoyage ne doit etre appele sur un client du pool');

  const rollbackDb = makeFailingTemperaturePoolDb();
  await assert.rejects(
    () => recordTemperatureControl(rollbackDb, STORE_ID, USER_ID, {
      quality_task_id: TASK_ID,
      type_code: 'COLD_ROOM',
      value: 1.2,
      recorded_at: '2026-08-03T04:05:00.000Z',
    }),
    /simulated temperature insert failure/
  );
  assert.equal(rollbackDb.stats().connectCount, 1, 'Rollback: acquisition client unique attendue');
  assert.equal(rollbackDb.stats().releaseCount, 1, 'Rollback: liberation client unique attendue');
  assert.equal(rollbackDb.calls.filter((call) => /^ROLLBACK$/i.test(call.sql)).length, 1, 'Rollback SQL attendu');
  assert.equal(rollbackDb.calls.filter((call) => /UPDATE quality_task_occurrences/i.test(call.sql)).length, 0, 'Aucune occurrence ne doit etre completee apres echec record');

  const completedDb = makePoolDb();
  await assert.rejects(
    () => recordTemperatureControl(completedDb, STORE_ID, USER_ID, {
      occurrence_id: '55555555-5555-5555-5555-555555555555',
      type_code: 'COLD_ROOM',
      value: 1.2,
      recorded_at: '2026-08-03T04:05:00.000Z',
    }),
    /deja completee/
  );
  assert.equal(completedDb.calls.filter((call) => /INSERT INTO quality_temperature_records/i.test(call.sql)).length, 0, 'Double soumission: aucun record duplique attendu');

  const todayWork = await listQualityTodayWork(makeTodayWorkDb(), STORE_ID, { include_upcoming: 'true' });
  assert.equal(todayWork.summary.event_controls, 1, 'Les controles evenementiels doivent avoir leur section dediee');
  assert.equal(todayWork.sections.event_controls[0].frequency_unit, 'events', 'La frequence events doit etre conservee');
  assert(!todayWork.sections.upcoming.some((item) => item.frequency_unit === 'events'), 'Un controle events ne doit pas apparaitre dans a venir');

  console.log(JSON.stringify({
    ok: true,
    checked_public_tools: 10,
    system_direct_completion_blocked: true,
    system_business_completion_allowed: true,
    manual_execution_recorded: true,
    manual_pool_transaction_checked: true,
    canonical_temperature_recorded: true,
    canonical_cleaning_recorded: true,
    event_controls_separated: true,
    connected_client_not_reused: true,
    rollback_atomic: true,
    double_submission_blocked: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
