const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
const MANUAL_TEMP_RECORD_ID = '12121212-1212-1212-1212-121212121212';

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
          rows: [
            {
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
            },
            {
              occurrence_id: '13131313-1313-1313-1313-131313131313',
              quality_task_id: '14141414-1414-1414-1414-141414141414',
              completed_at: '2026-08-03T05:05:00.000Z',
              result_status: 'completed',
              record_type: 'quality_manual_task_record',
              source_record_id: MANUAL_TEMP_RECORD_ID,
              task_title: 'QF-01 Releve temperature chambre froide',
              module_key: 'manual',
              task_origin: 'MANUAL',
              source_entity_type: null,
              source_entity_id: null,
              manual_result_status: 'completed',
              manual_conformity_status: 'non_conform',
              manual_observation: '2.2',
              manual_corrective_action: 'Verifier fermeture porte',
              record_comment: '2.2',
              record_corrective_action: 'Verifier fermeture porte',
              completed_by_email: 'operator@example.test',
            },
          ],
        };
      }
      if (/FROM quality_tasks t/i.test(sql)) return { rows: [] };
      if (/FROM quality_temperature_records r/i.test(sql)) return { rows: [temperatureRecord] };
      if (/FROM quality_cleaning_records r/i.test(sql)) return { rows: [] };
      if (/FROM quality_manual_task_records r/i.test(sql)) {
        return {
          rows: [{
            id: MANUAL_TEMP_RECORD_ID,
            store_id: STORE_ID,
            quality_task_id: '14141414-1414-1414-1414-141414141414',
            occurrence_id: '13131313-1313-1313-1313-131313131313',
            performed_at: '2026-08-03T05:05:00.000Z',
            result_status: 'completed',
            conformity_status: 'non_conform',
            observation: '2.2',
            corrective_action: 'Verifier fermeture porte',
            performed_by_email: 'operator@example.test',
            task_id: '14141414-1414-1414-1414-141414141414',
            task_title: 'QF-01 Releve temperature chambre froide',
            task_status: 'active',
            task_origin: 'MANUAL',
            module_key: 'manual',
            zone_name: 'Chambre froide',
            equipment_name: 'Thermometre',
          }],
        };
      }
      if (/FROM quality_non_conformities nc/i.test(sql)) return { rows: [nc] };
      if (/FROM quality_corrective_actions a/i.test(sql)) return { rows: [action] };
      return { rows: [] };
    },
  };
}

async function main() {
  const ddppFrontend = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend/quality/js/quality-ddpp.js'), 'utf8');
  const ddppHtml = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend/quality/pages/quality-ddpp.html'), 'utf8');
  assert(ddppFrontend.includes('function recordContract'), 'Le front DDPP doit centraliser le contrat record_type/record_id');
  assert(ddppFrontend.includes('Temperature relevee'), 'Historique DDPP doit afficher une colonne temperature relevee');
  assert(ddppFrontend.includes("detailButton(record.detail_type || 'temperature', record.record_id"), 'Detail temperature doit utiliser uniquement record_id');
  assert(ddppFrontend.includes('toFixed(2)'), 'DDPP doit afficher les temperatures avec deux decimales');
  assert(ddppHtml.includes('quality-ddpp.js?v=5'), 'Cache DDPP doit etre incremente');

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
  assert.equal(dashboard.corrective_actions.length, 2, 'Action corrective liee ou immediate doit remonter dans DDPP');
  assert.equal(dashboard.temperature_records[0].record_id, RECORD_ID, 'Les releves temperature DDPP doivent exposer record_id');
  assert.equal(dashboard.summary.open_non_conformities, 0, 'NC cloturee ne doit pas gonfler les ouvertes');
  assert.equal(dashboard.summary.overdue_corrective_actions, 1, 'Action ouverte en retard doit etre comptee');
  const legacyTemperature = dashboard.temperature_records.find((record) => record.id === MANUAL_TEMP_RECORD_ID);
  assert(legacyTemperature, 'Ancienne QF temperature manuelle doit remonter dans la section Temperatures DDPP');
  assert.equal(legacyTemperature.detail_type, 'manual_task', 'Ancienne QF temperature doit ouvrir un detail manual_task');
  assert.equal(legacyTemperature.record_id, MANUAL_TEMP_RECORD_ID, 'Contrat DDPP doit exposer le vrai record_id');
  assert.equal(legacyTemperature.value, 2.2, 'Observation numerique QF doit alimenter la temperature relevee');
  assert(dashboard.corrective_actions.some((item) => item.id === `immediate-${MANUAL_TEMP_RECORD_ID}`), 'Action corrective immediate du record doit etre visible');

  const detail = await getDdppRecordDetail(db, STORE_ID, 'temperature', RECORD_ID);
  assert(detail.record, 'Detail doit contenir le releve');
  assert.equal(detail.non_conformities[0].id, NC_ID, 'Detail releve doit contenir la NC liee');
  assert.equal(detail.corrective_actions[0].id, ACTION_ID, 'Detail releve doit contenir l action corrective liee');
  assert.equal(detail.source.record_type, 'quality_temperature_record', 'Detail doit exposer le type source');
  const legacyDetail = await getDdppRecordDetail(db, STORE_ID, 'manual_task', MANUAL_TEMP_RECORD_ID);
  assert(legacyDetail.record, 'Detail manual_task doit ouvrir les anciens records QF');
  assert(legacyDetail.corrective_actions.some((item) => item.id === `immediate-${MANUAL_TEMP_RECORD_ID}`), 'Detail QF doit exposer l action corrective immediate');

  console.log(JSON.stringify({
    ok: true,
    ddpp_nc_linked: true,
    ddpp_actions_linked: true,
    legacy_qf_temperature_visible: true,
    ddpp_record_contract_stable: true,
    detail_complete: true,
    mcp_detail_tool: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
