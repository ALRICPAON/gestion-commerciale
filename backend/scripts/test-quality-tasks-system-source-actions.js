const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { saveQualityTask } = require('../services/quality/tasks');

const root = path.resolve(__dirname, '..', '..');
const STORE_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const TASK_ID = '33333333-3333-3333-3333-333333333333';
const PARAMETER_ID = '44444444-4444-4444-4444-444444444444';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function makeDb() {
  const before = {
    id: TASK_ID,
    store_id: STORE_ID,
    title: 'Releve temperature - Atelier - lundi 04:00',
    module_key: 'temperature',
    task_origin: 'SYSTEM',
    source_entity_type: 'temperature_parameter',
    source_entity_id: PARAMETER_ID,
    source_locked: true,
    active: true,
    status: 'planned',
    frequency_value: 1,
    frequency_unit: 'days',
    target_time: '04:00',
  };
  return {
    async query(sql) {
      if (/FROM quality_tasks t/i.test(sql)) return { rows: [before] };
      if (/UPDATE quality_tasks/i.test(sql)) throw new Error('Une tache SYSTEM verrouillee ne doit pas etre modifiee directement');
      return { rows: [] };
    },
  };
}

async function main() {
  const taskJs = read('frontend/quality/js/quality-tasks.js');
  const taskHtml = read('frontend/quality/pages/quality-tasks.html');
  const tempSettingsHtml = read('frontend/quality/pages/temperature-settings.html');
  const cleaningPlansHtml = read('frontend/quality/pages/cleaning-plans.html');

  assert(taskJs.includes('function openTaskSource'), 'Le front taches doit ouvrir la source native');
  assert(taskJs.includes('temperature-settings.html?parameter_id='), 'Modifier une tache temperature SYSTEM doit ouvrir le parametre');
  assert(taskJs.includes('cleaning-plans.html?plan_id='), 'Modifier une tache nettoyage SYSTEM doit ouvrir le plan');
  assert(taskJs.includes("if (task.task_origin === 'SYSTEM' && task.source_locked) return openTaskSource(task);"), 'Les actions SYSTEM verrouillees doivent court-circuiter les appels directs');
  assert(taskHtml.includes('tasks-api.js?v=2'), 'Cache tasks-api doit etre incremente');
  assert(taskHtml.includes('quality-tasks.js?v=3'), 'Cache quality-tasks doit etre incremente');
  assert(tempSettingsHtml.includes('tasks-api.js?v=2'), 'Cache tasks-api doit etre incremente dans les parametres temperature');
  assert(cleaningPlansHtml.includes('tasks-api.js?v=2'), 'Cache tasks-api doit etre incremente dans les plans de nettoyage');

  await assert.rejects(
    () => saveQualityTask(makeDb(), STORE_ID, USER_ID, {
      title: 'Modification directe interdite',
      task_origin: 'MANUAL',
      source_locked: false,
    }, TASK_ID),
    /Modification directe refusee/
  );

  console.log(JSON.stringify({
    ok: true,
    system_task_front_redirects_to_source: true,
    direct_system_task_write_blocked: true,
    cache_versions_updated: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
