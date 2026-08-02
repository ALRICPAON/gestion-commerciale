const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { executeAgentTool } = require('../services/agent/agentToolExecutor');
const { listMcpTools } = require('../services/agent/agentToolRegistry');
const { saveCleaningPlan, getCleaningPlan, listCleaningPlans } = require('../services/quality/cleaning');
const { mapPlanPayload } = require('../validators/quality/cleaning');

const STORE_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const ZONE_1 = '00000000-0000-4000-8000-000000000011';
const ZONE_2 = '00000000-0000-4000-8000-000000000012';
const EQUIPMENT_1 = '00000000-0000-4000-8000-000000000021';
const EQUIPMENT_2 = '00000000-0000-4000-8000-000000000022';
const PLAN_ID = '00000000-0000-4000-8000-000000000031';
const TASK_ID = '00000000-0000-4000-8000-000000000041';
const AUDIT_ID = '00000000-0000-4000-8000-000000000101';

function makeContext(permissions) {
  return {
    store_id: STORE_ID,
    user_id: USER_ID,
    role: 'agent',
    user_permissions: permissions,
    agent_permissions: permissions,
    source: 'mcp',
    request_id: 'req-cleaning-multi-targets-test',
  };
}

function cloneState(source) {
  return {
    plans: source.plans.map((plan) => ({ ...plan, scheduled_days: [...(plan.scheduled_days || [])] })),
    planZones: new Map([...source.planZones.entries()].map(([key, value]) => [key, new Set([...value])])),
    planEquipments: new Map([...source.planEquipments.entries()].map(([key, value]) => [key, new Set([...value])])),
    tasks: source.tasks.map((task) => ({ ...task })),
  };
}

function restoreState(target, snapshot) {
  target.plans.length = 0;
  target.plans.push(...snapshot.plans);
  target.planZones.clear();
  for (const [key, value] of snapshot.planZones.entries()) target.planZones.set(key, value);
  target.planEquipments.clear();
  for (const [key, value] of snapshot.planEquipments.entries()) target.planEquipments.set(key, value);
  target.tasks.length = 0;
  target.tasks.push(...snapshot.tasks);
}

function assertContiguousSqlParameters(sql) {
  const matches = [...String(sql).matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
  if (!matches.length) return;
  const used = new Set(matches);
  for (let index = 1; index <= Math.max(...matches); index += 1) {
    if (!used.has(index)) {
      const err = new Error(`could not determine data type of parameter $${index}`);
      err.code = '42P18';
      throw err;
    }
  }
}

function makeDb(options = {}) {
  const state = {
    plans: [],
    planZones: new Map(),
    planEquipments: new Map(),
    tasks: [],
    zones: [
      { id: ZONE_1, code: 'AT', name: 'Atelier', status: 'active' },
      { id: ZONE_2, code: 'CF', name: 'Chambre froide', status: 'active' },
    ],
    equipments: [
      { id: EQUIPMENT_1, code: 'TAB-1', name: 'Table decoupe', zone_id: ZONE_1, zone_name: 'Atelier', status: 'active' },
      { id: EQUIPMENT_2, code: 'BAL-1', name: 'Balance', zone_id: ZONE_2, zone_name: 'Chambre froide', status: 'active' },
    ],
  };
  const calls = [];
  let txSnapshot = null;

  function planRow(plan) {
    const zones = [...(state.planZones.get(plan.id) || [])].map((id) => state.zones.find((zone) => zone.id === id)).filter(Boolean);
    const equipments = [...(state.planEquipments.get(plan.id) || [])].map((id) => state.equipments.find((equipment) => equipment.id === id)).filter(Boolean);
    const zone = zones[0] || state.zones.find((item) => item.id === plan.zone_id) || null;
    const equipment = equipments[0] || state.equipments.find((item) => item.id === plan.equipment_id) || null;
    return {
      ...plan,
      zone_code: zone?.code || null,
      zone_name: zone?.name || null,
      equipment_code: equipment?.code || null,
      equipment_name: equipment?.name || null,
      zones,
      equipments,
      task_id: plan.quality_task_id || null,
      task_title: plan.quality_task_id ? state.tasks.find((task) => task.id === plan.quality_task_id)?.title : null,
      task_frequency_value: plan.quality_task_id ? state.tasks.find((task) => task.id === plan.quality_task_id)?.frequency_value : null,
      task_frequency_unit: plan.quality_task_id ? state.tasks.find((task) => task.id === plan.quality_task_id)?.frequency_unit : null,
      task_target_time: plan.quality_task_id ? state.tasks.find((task) => task.id === plan.quality_task_id)?.target_time : null,
      task_active: plan.quality_task_id ? state.tasks.find((task) => task.id === plan.quality_task_id)?.active : null,
      task_status: plan.quality_task_id ? state.tasks.find((task) => task.id === plan.quality_task_id)?.status : null,
    };
  }

  return {
    calls,
    state,
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (options.detectParameterGaps) assertContiguousSqlParameters(text);

      if (text === 'BEGIN') {
        txSnapshot = cloneState(state);
        return { rows: [] };
      }
      if (text === 'COMMIT') {
        txSnapshot = null;
        return { rows: [] };
      }
      if (text === 'ROLLBACK') {
        if (txSnapshot) restoreState(state, txSnapshot);
        txSnapshot = null;
        return { rows: [] };
      }

      if (text.includes('agent_tool_audit_logs') && text.includes('INSERT')) return { rows: [{ id: AUDIT_ID }] };
      if (text.includes('agent_tool_audit_logs') && text.includes('UPDATE')) return { rows: [] };
      if (text.includes('FROM stores')) return { rows: [{ id: STORE_ID }] };

      if (text.includes('FROM quality_zones')) {
        if (text.includes('ANY')) return { rows: state.zones.filter((zone) => params[1].includes(zone.id)) };
        return { rows: state.zones.filter((zone) => zone.id === params[0]) };
      }

      if (text.includes('FROM quality_equipments')) {
        if (text.includes('ANY')) return { rows: state.equipments.filter((equipment) => params[1].includes(equipment.id)) };
        return { rows: state.equipments.filter((equipment) => equipment.id === params[0]) };
      }

      if (text.includes('FROM quality_tasks')) {
        if (text.includes("module_key = 'cleaning'")) return { rows: state.tasks.filter((task) => task.id === params[0] && task.store_id === params[1] && task.module_key === 'cleaning') };
        if (text.includes('t.id = $1')) return { rows: state.tasks.filter((task) => task.id === params[0] && task.store_id === params[1]) };
        return { rows: state.tasks };
      }

      if (text.includes('INSERT INTO quality_tasks')) {
        if (options.failTaskSync) {
          const err = new Error('simulated task sync failure');
          err.code = 'XX999';
          throw err;
        }
        const task = {
          id: TASK_ID,
          store_id: params[0],
          title: params[1],
          description: params[2],
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
          configuration_status: params[23],
        };
        state.tasks.push(task);
        return { rows: [{ id: task.id }] };
      }

      if (text.includes('UPDATE quality_tasks')) {
        const task = state.tasks.find((item) => item.id === params[0] && item.store_id === params[1]);
        if (!task) return { rows: [] };
        if (text.includes("SET active=false")) {
          Object.assign(task, { active: false, status: 'paused', configuration_status: 'inactive' });
        } else {
          Object.assign(task, {
            title: params[2],
            description: params[3],
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
            configuration_status: params[24],
          });
        }
        return { rows: [{ id: task.id }] };
      }

      if (text.includes('INSERT INTO quality_cleaning_plans')) {
        if (options.missingPlanSchedulingColumns && text.includes('responsible_user_id')) {
          const err = new Error('column "responsible_user_id" of relation "quality_cleaning_plans" does not exist');
          err.code = '42703';
          throw err;
        }
        const plan = {
          id: PLAN_ID,
          store_id: params[0],
          title: params[1],
          description: params[2],
          zone_id: params[3],
          equipment_id: params[4],
          product_name: params[5],
          method: params[6],
          safety_instructions: params[7],
          expected_duration_minutes: params[8],
          quality_task_id: params[9],
          active: params[10],
          created_by: params[11],
          configuration_status: params[21],
          responsible_user_id: params[25],
          frequency_value: params[26],
          frequency_unit: params[27],
          target_time: params[28],
          scheduled_days: JSON.parse(params[29] || '[]'),
        };
        state.plans.push(plan);
        return { rows: [{ id: plan.id }] };
      }

      if (text.includes('UPDATE quality_cleaning_plans')) {
        const plan = state.plans.find((item) => item.id === params[0] && item.store_id === params[1]);
        if (!plan) return { rows: [] };
        if (text.includes('SET quality_task_id=$3')) {
          plan.quality_task_id = params[2];
          return { rows: [{ id: plan.id }] };
        }
        Object.assign(plan, {
          title: params[2],
          description: params[3],
          zone_id: params[4],
          equipment_id: params[5],
          product_name: params[6],
          method: params[7],
          safety_instructions: params[8],
          expected_duration_minutes: params[9],
          quality_task_id: params[10],
          active: params[11],
          responsible_user_id: params[26],
          frequency_value: params[27],
          frequency_unit: params[28],
          target_time: params[29],
          scheduled_days: JSON.parse(params[30] || '[]'),
        });
        return { rows: [{ id: plan.id }] };
      }

      if (text.includes('UPDATE quality_cleaning_plan_zones')) {
        const keep = new Set(params[1]);
        state.planZones.set(params[0], new Set([...(state.planZones.get(params[0]) || [])].filter((id) => keep.has(id))));
        return { rows: [] };
      }
      if (text.includes('INSERT INTO quality_cleaning_plan_zones')) {
        const ids = state.planZones.get(params[0]) || new Set();
        ids.add(params[1]);
        state.planZones.set(params[0], ids);
        return { rows: [] };
      }
      if (text.includes('UPDATE quality_cleaning_plan_equipments')) {
        const keep = new Set(params[1]);
        state.planEquipments.set(params[0], new Set([...(state.planEquipments.get(params[0]) || [])].filter((id) => keep.has(id))));
        return { rows: [] };
      }
      if (text.includes('INSERT INTO quality_cleaning_plan_equipments')) {
        const ids = state.planEquipments.get(params[0]) || new Set();
        ids.add(params[1]);
        state.planEquipments.set(params[0], ids);
        return { rows: [] };
      }

      if (text.includes('FROM quality_cleaning_plans p')) {
        if (text.includes('p.id = $1')) return { rows: state.plans.filter((plan) => plan.id === params[0] && plan.store_id === params[1]).map(planRow) };
        return { rows: state.plans.filter((plan) => plan.store_id === params[0]).map(planRow) };
      }

      return { rows: [] };
    },
    async connect() {
      return {
        query: (sql, params) => this.query(sql, params),
        release() {},
      };
    },
  };
}

async function main() {
  const migration = fs.readFileSync(path.resolve(__dirname, '..', 'db', 'gestion-commerciale', '064_quality_cleaning_plan_multi_targets.sql'), 'utf8');
  const guardMigration = fs.readFileSync(path.resolve(__dirname, '..', 'db', 'gestion-commerciale', '065_quality_cleaning_plan_source_of_truth_guard.sql'), 'utf8');
  const frontendPage = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'quality', 'pages', 'cleaning-plans.html'), 'utf8');
  const frontendJs = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'quality', 'js', 'cleaning-plans.js'), 'utf8');
  assert(migration.includes('CREATE TABLE IF NOT EXISTS quality_cleaning_plan_zones'), 'Migration zones manquante');
  assert(migration.includes('CREATE TABLE IF NOT EXISTS quality_cleaning_plan_equipments'), 'Migration equipements manquante');
  assert(migration.includes('ADD COLUMN IF NOT EXISTS frequency_value'), 'Colonnes planning plan manquantes');
  assert(migration.includes('ADD COLUMN IF NOT EXISTS responsible_user_id'), 'Responsable plan manquant');
  assert(guardMigration.includes('ADD COLUMN IF NOT EXISTS responsible_user_id'), 'Migration garde responsable plan manquante');
  assert(guardMigration.includes('CREATE TABLE IF NOT EXISTS quality_cleaning_plan_zones'), 'Migration garde zones manquante');
  assert(guardMigration.includes('CREATE TABLE IF NOT EXISTS quality_cleaning_plan_equipments'), 'Migration garde equipements manquante');
  assert(migration.includes('REFERENCES quality_cleaning_plans(id)'), 'FK plan manquante');
  assert(migration.includes('INSERT INTO quality_cleaning_plan_zones'), 'Backfill zones manquant');
  assert(migration.includes('INSERT INTO quality_cleaning_plan_equipments'), 'Backfill equipements manquant');
  assert(frontendPage.includes('cleaning-plan-zone-ids'), 'Select multiple zones manquant dans le front');
  assert(frontendPage.includes('cleaning-plan-equipment-search'), 'Recherche equipement manquante dans le front');
  assert(frontendPage.includes('cleaning-plan-equipment-options'), 'Liste equipements manquante dans le front');
  assert(frontendJs.includes('zone_ids: zoneIds'), 'Payload front zone_ids manquant');
  assert(frontendJs.includes('equipment_ids: equipmentIds'), 'Payload front equipment_ids manquant');
  assert(!frontendJs.includes('tasksApi.save'), 'Le front plans nettoyage ne doit pas creer manuellement une tache qualite');

  const legacyPayload = mapPlanPayload({ title: 'Legacy', zone_id: ZONE_1, equipment_id: EQUIPMENT_1 });
  assert.deepEqual(legacyPayload.zone_ids, [ZONE_1], 'zone_id legacy doit alimenter zone_ids');
  assert.deepEqual(legacyPayload.equipment_ids, [EQUIPMENT_1], 'equipment_id legacy doit alimenter equipment_ids');

  const pilotPayload = mapPlanPayload({
    title: 'Plan pilote',
    zone_ids: [ZONE_1, ZONE_2],
    equipment_ids: [EQUIPMENT_1, EQUIPMENT_2],
    frequency_value: 1,
    frequency_unit: 'events',
    expected_duration_minutes: 20,
    configuration_status: 'pending_review',
    active: false,
  });
  assert.equal(pilotPayload.responsible_user_id, undefined, 'Payload pilote ne doit pas fournir responsible_user_id');
  assert.equal(pilotPayload.target_time, undefined, 'Payload pilote ne doit pas fournir target_time');
  assert.equal(pilotPayload.quality_task_id, undefined, 'Payload pilote ne doit pas fournir quality_task_id');
  assert.equal(pilotPayload.contact_time_minutes, undefined, 'Payload pilote ne doit pas fournir contact_time_minutes');

  const multiPayload = mapPlanPayload({ ...pilotPayload, title: 'Multi', frequency_unit: 'days', target_time: '08:00' });
  assert.equal(multiPayload.zone_id, ZONE_1, 'zone_id legacy doit rester le premier zone_ids');
  assert.equal(multiPayload.equipment_id, EQUIPMENT_1, 'equipment_id legacy doit rester le premier equipment_ids');

  const mcpTools = listMcpTools();
  for (const name of ['create_quality_cleaning_plan', 'update_quality_cleaning_plan', 'quality_create_cleaning_plan', 'quality_update_cleaning_plan']) {
    const tool = mcpTools.find((item) => item.name === name);
    assert(tool, `${name} manquant`);
    assert(tool.inputSchema.properties.zone_ids, `${name} doit accepter zone_ids`);
    assert(tool.inputSchema.properties.equipment_ids, `${name} doit accepter equipment_ids`);
  }

  const missingSchemaDb = makeDb({ missingPlanSchedulingColumns: true });
  await assert.rejects(
    () => saveCleaningPlan(missingSchemaDb, STORE_ID, USER_ID, multiPayload),
    /responsible_user_id/,
    'Schema prod incomplet doit reproduire l erreur responsable_user_id'
  );
  assert.equal(missingSchemaDb.state.plans.length, 0, 'Aucun plan partiel ne doit rester apres echec schema');
  assert.equal(missingSchemaDb.state.tasks.length, 0, 'Aucune tache ne doit etre creee apres echec schema');
  assert(missingSchemaDb.calls.some((call) => call.sql === 'ROLLBACK'), 'Echec creation plan doit rollback');

  const pilotDb = makeDb({ detectParameterGaps: true });
  const pilotCreated = await saveCleaningPlan(pilotDb, STORE_ID, USER_ID, pilotPayload);
  assert.equal(pilotCreated.quality_task_id, TASK_ID, 'Payload pilote doit creer et lier automatiquement une tache');
  assert.equal(pilotCreated.responsible_user_id, undefined, 'Plan pilote sans responsable doit rester sans responsable');
  assert.equal(pilotDb.state.tasks[0].responsible_user_id, null, 'Tache pilote sans responsable doit garder NULL');
  assert.equal(pilotDb.state.tasks[0].target_time, null, 'Tache pilote sans heure cible doit garder NULL');
  assert.equal(pilotDb.state.tasks[0].frequency_unit, 'events', 'Frequence pilote events doit etre conservee');
  assert.equal(pilotDb.state.plans.length, 1, 'Payload pilote doit creer un seul plan');
  assert.equal(pilotDb.state.tasks.length, 1, 'Payload pilote doit creer une seule tache');
  assert(pilotDb.calls.some((call) => call.sql === 'COMMIT'), 'Payload pilote doit commit sans trou de placeholder');

  const db = makeDb();
  const created = await saveCleaningPlan(db, STORE_ID, USER_ID, multiPayload);
  assert.equal(created.zone_id, ZONE_1, 'Compatibilite zone_id invalide');
  assert.equal(created.equipment_id, EQUIPMENT_1, 'Compatibilite equipment_id invalide');
  assert.deepEqual(created.zones.map((zone) => zone.id), [ZONE_1, ZONE_2], 'Zones multiples non relues');
  assert.deepEqual(created.equipments.map((equipment) => equipment.id), [EQUIPMENT_1, EQUIPMENT_2], 'Equipements multiples non relus');
  assert.equal(created.quality_task_id, TASK_ID, 'Creation plan doit creer et lier automatiquement une tache qualite');
  assert.equal(db.state.tasks.length, 1, 'Une seule tache qualite doit etre creee par plan');
  assert.equal(db.state.tasks[0].frequency_value, 1, 'Frequence tache doit provenir du plan');
  assert.equal(db.state.tasks[0].responsible_user_id, null, 'Creation sans responsable doit rester valide et nullable');
  assert(db.calls.some((call) => call.sql === 'COMMIT'), 'Creation plan doit etre transactionnelle');
  assert(db.calls.some((call) => call.sql.includes('INSERT INTO quality_cleaning_plan_zones')), 'Liens zones non ecrits');
  assert(db.calls.some((call) => call.sql.includes('INSERT INTO quality_cleaning_plan_equipments')), 'Liens equipements non ecrits');

  const updated = await saveCleaningPlan(db, STORE_ID, USER_ID, mapPlanPayload({ ...created, title: 'Multi updated', zone_ids: [ZONE_2], equipment_ids: [EQUIPMENT_2], frequency_value: 2, frequency_unit: 'days' }), PLAN_ID);
  assert.deepEqual(updated.zones.map((zone) => zone.id), [ZONE_2], 'Retrait zone non applique');
  assert.deepEqual(updated.equipments.map((equipment) => equipment.id), [EQUIPMENT_2], 'Retrait equipement non applique');
  assert.equal(db.state.tasks.length, 1, 'Modification plan ne doit pas creer une seconde tache');
  assert.equal(db.state.tasks[0].frequency_value, 2, 'Modification plan doit synchroniser la frequence de la tache');

  const responsibleDb = makeDb();
  const withResponsible = await saveCleaningPlan(responsibleDb, STORE_ID, USER_ID, mapPlanPayload({ ...multiPayload, responsible_user_id: USER_ID }));
  assert.equal(withResponsible.responsible_user_id, USER_ID, 'Creation avec responsable doit conserver le responsable sur le plan');
  assert.equal(responsibleDb.state.tasks[0].responsible_user_id, USER_ID, 'Tache synchronisee doit reprendre le responsable du plan');

  const scheduledDb = makeDb();
  const withSchedule = await saveCleaningPlan(scheduledDb, STORE_ID, USER_ID, mapPlanPayload({ ...multiPayload, target_time: '07:30', scheduled_days: ['monday', 'friday'] }));
  assert.equal(withSchedule.target_time, '07:30', 'Creation avec heure cible doit conserver target_time');
  assert.deepEqual(withSchedule.scheduled_days, ['monday', 'friday'], 'Creation avec scheduled_days doit conserver les jours');
  assert.equal(scheduledDb.state.tasks[0].target_time, '07:30', 'Tache synchronisee doit reprendre target_time');

  const nullableDb = makeDb();
  const nullableCreated = await saveCleaningPlan(nullableDb, STORE_ID, USER_ID, mapPlanPayload({ ...multiPayload, responsible_user_id: USER_ID, target_time: '06:00' }));
  const nullableUpdated = await saveCleaningPlan(nullableDb, STORE_ID, USER_ID, mapPlanPayload({ ...nullableCreated, responsible_user_id: null, target_time: null, frequency_value: 3, frequency_unit: 'events' }), PLAN_ID);
  assert.equal(nullableUpdated.responsible_user_id, null, 'Update doit permettre de retirer responsible_user_id');
  assert.equal(nullableUpdated.target_time, null, 'Update doit permettre de retirer target_time');
  assert.equal(nullableDb.state.tasks.length, 1, 'Update NULL ne doit pas creer de deuxieme tache');
  assert.equal(nullableDb.state.tasks[0].responsible_user_id, null, 'Tache synchronisee doit retirer responsible_user_id');
  assert.equal(nullableDb.state.tasks[0].target_time, null, 'Tache synchronisee doit retirer target_time');

  const failedSyncDb = makeDb({ failTaskSync: true });
  await assert.rejects(
    () => saveCleaningPlan(failedSyncDb, STORE_ID, USER_ID, pilotPayload),
    /simulated task sync failure/,
    'Echec synchronisation tache doit remonter'
  );
  assert.equal(failedSyncDb.state.plans.length, 0, 'Rollback sync doit supprimer le plan partiel');
  assert.equal(failedSyncDb.state.planZones.size, 0, 'Rollback sync doit supprimer les liens zones partiels');
  assert.equal(failedSyncDb.state.planEquipments.size, 0, 'Rollback sync doit supprimer les liens equipements partiels');
  assert.equal(failedSyncDb.state.tasks.length, 0, 'Rollback sync ne doit laisser aucune tache');
  assert(!failedSyncDb.calls.some((call) => call.sql.includes('agent_tool_audit_logs') && call.sql.includes('INSERT')), 'Rollback sync ne doit laisser aucun audit persiste');

  const listed = await listCleaningPlans(db, STORE_ID, { zone_id: ZONE_2 });
  assert.equal(listed.length, 1, 'Filtre zone multi-cibles invalide');
  const read = await getCleaningPlan(db, STORE_ID, PLAN_ID);
  assert.equal(read.zones[0].name, 'Chambre froide', 'Lecture detaillee des zones invalide');

  const mcpDb = makeDb();
  const mcpCreated = await executeAgentTool({
    db: mcpDb,
    name: 'create_quality_cleaning_plan',
    input: { title: 'MCP multi', zone_ids: [ZONE_1, ZONE_2], equipment_ids: [EQUIPMENT_1, EQUIPMENT_2], frequency_value: 1, frequency_unit: 'days', target_time: '08:00' },
    context: makeContext(['quality.read', 'quality.configuration.write']),
  });
  assert.equal(mcpCreated.ok, true, 'Creation MCP multi-cibles invalide');
  assert.equal(mcpCreated.data.plan.zones.length, 2, 'MCP create doit retourner zones[]');
  assert.equal(mcpCreated.data.plan.equipments.length, 2, 'MCP create doit retourner equipments[]');
  assert.equal(mcpCreated.data.plan.quality_task_id, TASK_ID, 'MCP create doit retourner la tache synchronisee');

  console.log(JSON.stringify({ ok: true, checked: ['migration', 'validator', 'service', 'api_contract', 'frontend', 'mcp'], zones: 2, equipments: 2 }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
