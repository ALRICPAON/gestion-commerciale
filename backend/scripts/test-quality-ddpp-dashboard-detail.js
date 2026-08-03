const assert = require('assert');

const {
  createNonConformity,
  getDdppDashboard,
  getDdppRecordDetail,
} = require('../services/quality/operations');
const { listMcpTools } = require('../services/agent/agentToolRegistry');

const STORE_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const TASK_ID = '33333333-3333-3333-3333-333333333333';
const OCCURRENCE_ID = '44444444-4444-4444-4444-444444444444';
const RECORD_ID = '55555555-5555-5555-5555-555555555555';
const NC_ID = '66666666-6666-6666-6666-666666666666';
const ACTION_ID = '77777777-7777-7777-7777-777777777777';

function makeDb() {
  const calls = [];
  const nc = {
    id: NC_ID,
    store_id: STORE_ID,
    origin_type: 'quality_temperature_record',
    origin_record_id: RECORD_ID,
    source_record_type: 'quality_temperature_record',
    source_record_id: RECORD_ID,
    quality_task_id: TASK_ID,
    occurrence_id: OCCURRENCE_ID,
    source_entity_type: 'temperature_parameter',
    source_entity_id: '88888888-8888-8888-8888-888888888888',
    zone_id: '99999999-9999-9999-9999-999999999999',
    equipment_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    zone_name: 'Reception',
    equipment_name: 'Porte froide',
    severity: 'high',
    title: 'Temperature hors seuil',
    description: 'Temperature au-dessus de la limite maximale',
    immediate_action: 'Isolement et verification',
    responsible_email: 'qualite@example.test',
    status: 'closed',
    closed_at: '2026-08-03T06:00:00.000Z',
    created_at: '2026-08-03T04:05:00.000Z',
  };
  const action = {
    id: ACTION_ID,
    store_id: STORE_ID,
    non_conformity_id: NC_ID,
    quality_task_id: TASK_ID,
    action: 'Verifier le rideau de porte',
    responsible_email: 'maintenance@example.test',
    due_at: '2026-08-03T08:00:00.000Z',
    status: 'open',
    effectiveness_check: 'Controle temperature suivant',
    non_conformity_title: nc.title,
    source_record_type: 'quality_temperature_record',
    source_record_id: RECORD_ID,
    record_type: 'temperature',
  };
  const temperatureRecord = {
    id: RECORD_ID,
    store_id: STORE_ID,
    recorded_at: '2026-08-03T04:05:00.000Z',
    type_code: 'COLD_ROOM',
    type_label: 'Chambre froide',
    zone_name: 'Reception',
    equipment_name: 'Porte froide',
    value: 9.4,
    unit: 'C',
    min_limit: 0,
    max_limit: 4,
    alert_status: 'out_of_limits',
    alert_reason: 'Temperature au-dessus de la limite maximale',
    comment: 'Ecart constate',
    corrective_action: 'Isolement',
    source: 'api',
    operator_email: 'operator@example.test',
    quality_task_id: TASK_ID,
    occurrence_id: OCCURRENCE_ID,
    task_id: TASK_ID,
    task_title: 'Controle temperature reception',
    task_status: 'active',
    task_origin: 'SYSTEM',
  };

  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/INSERT INTO quality_non_conformities/i.test(sql)) {
        return { rows: [{ ...nc, origin_type: params[1], origin_record_id: params[2] }] };
      }
      if (/INSERT INTO quality_event_log/i.test(sql)) return { rows: [] };
      if (/FROM quality_temperature_limits l/i.test(sql)) return { rows: [] };
      if (/FROM quality_cleaning_plans p/i.test(sql)) return { rows: [] };
      if (/FROM quality_task_occurrences o/i.test(sql)) {
        return {
          rows: [{
            occurrence_id: OCCURRENCE_ID,
            quality_task_id: TASK_ID,
            completed_at: '2026-08-03T04:05:00.000Z',
            result_status: 'out_of_limits',
            record_type: 'quality_temperature_record',
            source_record_id: RECORD_ID,
            task_title: 'Controle temperature reception',
            module_key: 'temperature',
            task_origin: 'SYSTEM',
            source_entity_type: 'temperature_parameter',
            source_entity_id: '88888888-8888-8888-8888-888888888888',
            alert_status: 'out_of_limits',
            value: 9.4,
            unit: 'C',
            type_label: 'Chambre froide',
            record_comment: 'Ecart constate',
            completed_by_email: 'operator@example.test',
          }],
        };
      }
      if (/FROM quality_tasks t/i.test(sql)) return { rows: [] };
      if (/FROM quality_temperature_records r/i.test(sql)) return { rows: [temperatureRecord] };
      if (/FROM quality_cleaning_records r/i.test(sql)) return { rows: [] };
      if (/FROM quality_non_conformities nc/i.test(sql)) return { rows: [nc] };
      if (/FROM quality_corrective_actions a/i.test(sql)) return { rows: [action] };
      return { rows: [] };
    },
  };
}

async function main() {
  const tools = listMcpTools();
  assert(tools.some((tool) => tool.name === 'get_quality_ddpp_dashboard'), 'Dashboard DDPP doit rester expose MCP');
  assert(tools.some((tool) => tool.name === 'get_quality_ddpp_record_detail'), 'Detail DDPP doit etre expose MCP');

  const db = makeDb();
  const created = await createNonConformity(db, STORE_ID, USER_ID, {
    source_record_type: 'quality_temperature_record',
    source_record_id: RECORD_ID,
    quality_task_id: TASK_ID,
    occurrence_id: OCCURRENCE_ID,
    description: 'Temperature au-dessus de la limite maximale',
  });
  assert.equal(created.origin_type, 'quality_temperature_record', 'Alias source_record_type doit alimenter origin_type');
  assert.equal(created.origin_record_id, RECORD_ID, 'Alias source_record_id doit alimenter origin_record_id');

  const dashboard = await getDdppDashboard(db, STORE_ID, {
    start_date: '2026-08-03T00:00:00.000Z',
    end_date: '2026-08-03T23:59:59.000Z',
  });
  assert.equal(dashboard.non_conformities.length, 1, 'NC liee a un releve de la periode doit remonter dans DDPP');
  assert.equal(dashboard.corrective_actions.length, 1, 'Action corrective liee doit remonter dans DDPP');
  assert.equal(dashboard.summary.open_non_conformities, 0, 'NC cloturee ne doit pas gonfler les ouvertes');
  assert.equal(dashboard.summary.overdue_corrective_actions, 1, 'Action ouverte en retard doit etre comptee');

  const detail = await getDdppRecordDetail(db, STORE_ID, 'temperature', RECORD_ID);
  assert(detail.record, 'Detail doit contenir le releve');
  assert.equal(detail.non_conformities[0].id, NC_ID, 'Detail releve doit contenir la NC liee');
  assert.equal(detail.corrective_actions[0].id, ACTION_ID, 'Detail releve doit contenir l action corrective liee');
  assert.equal(detail.source.record_type, 'quality_temperature_record', 'Detail doit exposer le type source');

  console.log(JSON.stringify({
    ok: true,
    ddpp_nc_linked: true,
    ddpp_actions_linked: true,
    detail_complete: true,
    mcp_detail_tool: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
