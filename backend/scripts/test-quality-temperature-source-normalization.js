const assert = require('assert');

const {
  mapRecordPayload,
  normalizeTemperatureRecordSource,
} = require('../validators/quality/temperatures');
const { saveTemperatureRecord } = require('../services/quality/temperatures');

const STORE_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const TASK_ID = '33333333-3333-3333-3333-333333333333';
const OCCURRENCE_ID = '44444444-4444-4444-4444-444444444444';

function makeDb() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM quality_temperature_records r/i.test(sql)) return { rows: [] };
      if (/INSERT INTO quality_temperature_records/i.test(sql)) {
        return { rows: [{ id: '55555555-5555-5555-5555-555555555555', source: params[7], alert_status: 'compliant' }] };
      }
      if (/FROM quality_tasks/i.test(sql)) return { rows: [{ id: TASK_ID, next_due_at: null, frequency_value: 1, frequency_unit: 'events' }] };
      if (/UPDATE quality_tasks/i.test(sql)) return { rows: [{ id: TASK_ID, status: params[2] }] };
      if (/INSERT INTO quality_task_history/i.test(sql)) return { rows: [] };
      if (/INSERT INTO quality_event_log/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
}

async function saveWithSource(source, context = {}) {
  const db = makeDb();
  const record = await saveTemperatureRecord(db, STORE_ID, USER_ID, {
    type_code: 'COLD_ROOM',
    value: 2.5,
    unit: 'C',
    recorded_at: '2026-08-03T04:00:00.000Z',
    source,
    comment: source === 'exceptional' ? 'Controle hors planning' : null,
    ...context,
  });
  return { db, record };
}

async function main() {
  assert.equal(normalizeTemperatureRecordSource('scheduled'), 'api');
  assert.equal(normalizeTemperatureRecordSource('occurrence'), 'api');
  assert.equal(normalizeTemperatureRecordSource('task'), 'api');
  assert.equal(normalizeTemperatureRecordSource('quality_today'), 'api');
  assert.equal(normalizeTemperatureRecordSource('exceptional'), 'manual');
  assert.equal(normalizeTemperatureRecordSource('automatic'), 'iot');
  assert.equal(normalizeTemperatureRecordSource('manual'), 'manual');
  assert.equal(normalizeTemperatureRecordSource('import'), 'import');
  assert.equal(normalizeTemperatureRecordSource('api'), 'api');
  assert.equal(normalizeTemperatureRecordSource('iot'), 'iot');
  assert.equal(normalizeTemperatureRecordSource(null, { quality_task_id: TASK_ID }), 'api');
  assert.equal(normalizeTemperatureRecordSource(null, {}), 'manual');
  assert.throws(() => normalizeTemperatureRecordSource('spreadsheet'), /Source de releve temperature invalide/);

  assert.equal(mapRecordPayload({ source: 'scheduled', type_code: 'COLD_ROOM', value: 1 }).source, 'api');
  assert.equal(mapRecordPayload({ source: 'exceptional', type_code: 'COLD_ROOM', value: 1 }).source, 'manual');
  assert.equal(mapRecordPayload({ type_code: 'COLD_ROOM', value: '7,5' }).value, 7.5, 'La virgule decimale doit etre acceptee');
  assert.equal(mapRecordPayload({ type_code: 'COLD_ROOM', value: '7.5' }).value, 7.5, 'Le point decimal doit etre accepte');
  assert.throws(() => mapRecordPayload({ source: 'bad', type_code: 'COLD_ROOM', value: 1 }), /Source de releve temperature invalide/);

  assert.equal((await saveWithSource('scheduled', { quality_task_id: TASK_ID, occurrence_id: OCCURRENCE_ID })).record.source, 'api', 'Qualite du jour doit ecrire api');
  assert.equal((await saveWithSource('occurrence', { quality_task_id: TASK_ID, occurrence_id: OCCURRENCE_ID })).record.source, 'api', 'Occurrence doit ecrire api');
  assert.equal((await saveWithSource('api', { quality_task_id: TASK_ID })).record.source, 'api', 'MCP/API doit ecrire api');
  assert.equal((await saveWithSource('manual')).record.source, 'manual', 'Page specialisee directe doit ecrire manual');
  assert.equal((await saveWithSource('exceptional', { exceptional_reason: 'Controle hors planning' })).record.source, 'manual', 'Exceptionnel interface doit ecrire manual');
  assert.equal((await saveWithSource('import')).record.source, 'import', 'Import doit ecrire import');
  assert.equal((await saveWithSource('iot')).record.source, 'iot', 'IoT doit ecrire iot');
  assert.equal((await saveWithSource('automatic')).record.source, 'iot', 'Automatique doit ecrire iot');
  await assert.rejects(() => saveWithSource('spreadsheet'), /Source de releve temperature invalide/);

  console.log(JSON.stringify({
    ok: true,
    scheduled_to_api: true,
    occurrence_to_api: true,
    exceptional_to_manual: true,
    automatic_to_iot: true,
    comma_temperature_parsed: true,
    dot_temperature_parsed: true,
    invalid_source_rejected: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
