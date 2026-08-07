const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { listDueTemperatureReadings } = require('../services/quality/temperatures');

const STORE_ID = '00000000-0000-4000-8000-000000000001';
const COLD_LIMIT_ID = '00000000-0000-4000-8000-000000000101';
const WORKSHOP_LIMIT_ID = '00000000-0000-4000-8000-000000000102';
const EVENT_LIMIT_ID = '00000000-0000-4000-8000-000000000103';
const COLD_TASK_ID = '00000000-0000-4000-8000-000000000201';
const WORKSHOP_TASK_ID = '00000000-0000-4000-8000-000000000202';
const EVENT_TASK_ID = '00000000-0000-4000-8000-000000000203';

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', relativePath), 'utf8');
}

function makeTemperatureRow({
  limitId,
  taskId,
  title,
  equipmentName,
  scheduledDays,
  targetTimes,
  min,
  max,
  frequencyUnit = 'days',
}) {
  return {
    limit_id: limitId,
    parameter_id: limitId,
    quality_task_id: taskId,
    scheduled_days: scheduledDays,
    target_times: targetTimes,
    legacy_target_time: targetTimes[0] || null,
    type_code: 'STORAGE',
    type_label: 'Stockage froid',
    zone_id: null,
    zone_code: null,
    zone_name: null,
    equipment_id: `equipment-${taskId.slice(-3)}`,
    equipment_code: equipmentName.toUpperCase().replace(/\s+/g, '-'),
    equipment_name: equipmentName,
    min_value: min,
    max_value: max,
    unit: 'C',
    is_active: true,
    task_id: taskId,
    task_title: title,
    task_frequency_value: 1,
    task_frequency_unit: frequencyUnit,
    task_target_time: null,
    task_next_due_at: new Date().toISOString(),
    task_last_completed_at: null,
    task_status: 'planned',
    task_active: true,
    task_origin: 'SYSTEM',
    task_source_entity_type: 'temperature_parameter',
    task_source_entity_id: limitId,
    task_source_locked: true,
    task_responsible_email: null,
  };
}

function makeDb(rows) {
  return {
    calls: [],
    async query(sql, params = []) {
      this.calls.push({ sql: String(sql), params });
      if (String(sql).includes('FROM quality_temperature_limits l')) return { rows };
      return { rows: [] };
    },
  };
}

async function main() {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const rows = [
    makeTemperatureRow({
      limitId: COLD_LIMIT_ID,
      taskId: COLD_TASK_ID,
      title: 'Releve temperature - Chambre froide',
      equipmentName: 'Chambre froide',
      scheduledDays: days,
      targetTimes: ['04:00:00', '12:00:00', '17:30:00'],
      min: 0,
      max: 2,
    }),
    makeTemperatureRow({
      limitId: WORKSHOP_LIMIT_ID,
      taskId: WORKSHOP_TASK_ID,
      title: 'Releve temperature - Atelier refrigere',
      equipmentName: 'Atelier refrigere',
      scheduledDays: days,
      targetTimes: ['04:00:00', '10:00:00'],
      min: 7,
      max: 8,
    }),
    makeTemperatureRow({
      limitId: EVENT_LIMIT_ID,
      taskId: EVENT_TASK_ID,
      title: 'Controle temperature reception produit',
      equipmentName: 'Reception produit',
      scheduledDays: [],
      targetTimes: [],
      min: 0,
      max: 4,
      frequencyUnit: 'events',
    }),
  ];

  const due = await listDueTemperatureReadings(makeDb(rows), STORE_ID, { include_upcoming: 'true' });
  const cold = due.filter((item) => item.parameter_id === COLD_LIMIT_ID);
  const workshop = due.filter((item) => item.parameter_id === WORKSHOP_LIMIT_ID);
  const eventControls = due.filter((item) => item.parameter_id === EVENT_LIMIT_ID);

  assert.equal(cold.length, 18, 'Chambre froide doit produire 18 occurrences hebdomadaires');
  assert.equal(workshop.length, 12, 'Atelier refrigere doit produire 12 occurrences hebdomadaires');
  assert.equal(eventControls.length, 0, 'Les controles evenementiels ne doivent pas etre transformes en planning natif');
  assert.equal(new Set(cold.map((item) => item.quality_task_id)).size, 1, 'Chambre froide doit utiliser une tache canonique unique');
  assert.equal(new Set(workshop.map((item) => item.quality_task_id)).size, 1, 'Atelier doit utiliser une tache canonique unique');
  assert(cold.every((item) => item.quality_task_id === COLD_TASK_ID), 'Occurrences chambre froide rattachees a la mauvaise tache');
  assert(workshop.every((item) => item.quality_task_id === WORKSHOP_TASK_ID), 'Occurrences atelier rattachees a la mauvaise tache');
  assert(due.every((item) => item.scheduled_day !== 'sunday'), 'Aucune occurrence dimanche ne doit etre generee');
  assert(due.every((item) => item.task_title && !/\b(monday|tuesday|wednesday|thursday|friday|saturday)\b|04:00|10:00|12:00|17:30/i.test(item.task_title)), 'Le titre de tache ne doit pas contenir le jour ou l heure');

  const operations = read('backend/services/quality/operations.js');
  const temperatures = read('backend/services/quality/temperatures.js');
  const migration = read('backend/db/gestion-commerciale/071_quality_temperature_single_task_occurrences.sql');

  assert(operations.includes('ON CONFLICT (task_id, due_at)'), 'Occurrences doivent rester idempotentes via task_id + due_at');
  assert(operations.includes("task.source_entity_type === 'temperature_parameter' && task.frequency_unit !== 'events'"), 'Les controles temperature evenementiels doivent rester dans le flux taches');
  assert(temperatures.includes("title: `Releve temperature - ${targetLabel(limit)}`"), 'Le titre canonique ne doit pas inclure de creneau');
  assert(temperatures.includes("frequency_unit: hasNativeSchedule(limit) ? 'days'"), 'Un planning natif ne doit pas rester en frequency_unit events');
  assert(migration.includes('quality_temperature_limit_task_migration_audit'), 'La migration doit conserver un audit des anciennes liaisons');
  assert(migration.includes("status = 'archived'"), 'La migration doit archiver logiquement les anciennes taches');
  assert(!/DELETE\s+FROM\s+quality_tasks/i.test(migration), 'La migration ne doit jamais supprimer physiquement les taches');
  assert(!/DELETE\s+FROM\s+quality_temperature_records/i.test(migration), 'La migration ne doit jamais supprimer de releves historiques');

  console.log(JSON.stringify({
    ok: true,
    canonical_temperature_tasks: 2,
    cold_room_weekly_occurrences: cold.length,
    workshop_weekly_occurrences: workshop.length,
    sunday_occurrences: due.filter((item) => item.scheduled_day === 'sunday').length,
    event_controls_preserved: true,
    idempotence_constraint: true,
    legacy_tasks_archived_not_deleted: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
