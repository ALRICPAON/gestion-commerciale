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

function makeDb() {
  const state = {
    plans: [],
    planZones: new Map(),
    planEquipments: new Map(),
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
      task_id: null,
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
      if (text.includes('FROM stores')) return { rows: [{ id: STORE_ID }] };

      if (text.includes('FROM quality_zones')) {
        if (text.includes('ANY')) return { rows: state.zones.filter((zone) => params[1].includes(zone.id)) };
        return { rows: state.zones.filter((zone) => zone.id === params[0]) };
      }

      if (text.includes('FROM quality_equipments')) {
        if (text.includes('ANY')) return { rows: state.equipments.filter((equipment) => params[1].includes(equipment.id)) };
        return { rows: state.equipments.filter((equipment) => equipment.id === params[0]) };
      }

      if (text.includes('FROM quality_tasks')) return { rows: [] };

      if (text.includes('INSERT INTO quality_cleaning_plans')) {
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
        };
        state.plans.push(plan);
        return { rows: [{ id: plan.id }] };
      }

      if (text.includes('UPDATE quality_cleaning_plans')) {
        const plan = state.plans.find((item) => item.id === params[0] && item.store_id === params[1]);
        if (!plan) return { rows: [] };
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
  };
}

async function main() {
  const migration = fs.readFileSync(path.resolve(__dirname, '..', 'db', 'gestion-commerciale', '064_quality_cleaning_plan_multi_targets.sql'), 'utf8');
  const frontendPage = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'quality', 'pages', 'cleaning-plans.html'), 'utf8');
  const frontendJs = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'quality', 'js', 'cleaning-plans.js'), 'utf8');
  assert(migration.includes('CREATE TABLE IF NOT EXISTS quality_cleaning_plan_zones'), 'Migration zones manquante');
  assert(migration.includes('CREATE TABLE IF NOT EXISTS quality_cleaning_plan_equipments'), 'Migration equipements manquante');
  assert(migration.includes('REFERENCES quality_cleaning_plans(id)'), 'FK plan manquante');
  assert(migration.includes('INSERT INTO quality_cleaning_plan_zones'), 'Backfill zones manquant');
  assert(migration.includes('INSERT INTO quality_cleaning_plan_equipments'), 'Backfill equipements manquant');
  assert(frontendPage.includes('cleaning-plan-zone-ids'), 'Select multiple zones manquant dans le front');
  assert(frontendPage.includes('cleaning-plan-equipment-search'), 'Recherche equipement manquante dans le front');
  assert(frontendPage.includes('cleaning-plan-equipment-options'), 'Liste equipements manquante dans le front');
  assert(frontendJs.includes('zone_ids: zoneIds'), 'Payload front zone_ids manquant');
  assert(frontendJs.includes('equipment_ids: equipmentIds'), 'Payload front equipment_ids manquant');

  const legacyPayload = mapPlanPayload({ title: 'Legacy', zone_id: ZONE_1, equipment_id: EQUIPMENT_1 });
  assert.deepEqual(legacyPayload.zone_ids, [ZONE_1], 'zone_id legacy doit alimenter zone_ids');
  assert.deepEqual(legacyPayload.equipment_ids, [EQUIPMENT_1], 'equipment_id legacy doit alimenter equipment_ids');

  const multiPayload = mapPlanPayload({ title: 'Multi', zone_ids: [ZONE_1, ZONE_2], equipment_ids: [EQUIPMENT_1, EQUIPMENT_2] });
  assert.equal(multiPayload.zone_id, ZONE_1, 'zone_id legacy doit rester le premier zone_ids');
  assert.equal(multiPayload.equipment_id, EQUIPMENT_1, 'equipment_id legacy doit rester le premier equipment_ids');

  const mcpTools = listMcpTools();
  for (const name of ['create_quality_cleaning_plan', 'update_quality_cleaning_plan', 'quality_create_cleaning_plan', 'quality_update_cleaning_plan']) {
    const tool = mcpTools.find((item) => item.name === name);
    assert(tool, `${name} manquant`);
    assert(tool.inputSchema.properties.zone_ids, `${name} doit accepter zone_ids`);
    assert(tool.inputSchema.properties.equipment_ids, `${name} doit accepter equipment_ids`);
  }

  const db = makeDb();
  const created = await saveCleaningPlan(db, STORE_ID, USER_ID, multiPayload);
  assert.equal(created.zone_id, ZONE_1, 'Compatibilite zone_id invalide');
  assert.equal(created.equipment_id, EQUIPMENT_1, 'Compatibilite equipment_id invalide');
  assert.deepEqual(created.zones.map((zone) => zone.id), [ZONE_1, ZONE_2], 'Zones multiples non relues');
  assert.deepEqual(created.equipments.map((equipment) => equipment.id), [EQUIPMENT_1, EQUIPMENT_2], 'Equipements multiples non relus');
  assert(db.calls.some((call) => call.sql.includes('INSERT INTO quality_cleaning_plan_zones')), 'Liens zones non ecrits');
  assert(db.calls.some((call) => call.sql.includes('INSERT INTO quality_cleaning_plan_equipments')), 'Liens equipements non ecrits');

  const updated = await saveCleaningPlan(db, STORE_ID, USER_ID, mapPlanPayload({ ...created, title: 'Multi updated', zone_ids: [ZONE_2], equipment_ids: [EQUIPMENT_2] }), PLAN_ID);
  assert.deepEqual(updated.zones.map((zone) => zone.id), [ZONE_2], 'Retrait zone non applique');
  assert.deepEqual(updated.equipments.map((equipment) => equipment.id), [EQUIPMENT_2], 'Retrait equipement non applique');

  const listed = await listCleaningPlans(db, STORE_ID, { zone_id: ZONE_2 });
  assert.equal(listed.length, 1, 'Filtre zone multi-cibles invalide');
  const read = await getCleaningPlan(db, STORE_ID, PLAN_ID);
  assert.equal(read.zones[0].name, 'Chambre froide', 'Lecture detaillee des zones invalide');

  const mcpDb = makeDb();
  const mcpCreated = await executeAgentTool({
    db: mcpDb,
    name: 'create_quality_cleaning_plan',
    input: { title: 'MCP multi', zone_ids: [ZONE_1, ZONE_2], equipment_ids: [EQUIPMENT_1, EQUIPMENT_2], planning_mode: 'none' },
    context: makeContext(['quality.read', 'quality.configuration.write']),
  });
  assert.equal(mcpCreated.ok, true, 'Creation MCP multi-cibles invalide');
  assert.equal(mcpCreated.data.plan.zones.length, 2, 'MCP create doit retourner zones[]');
  assert.equal(mcpCreated.data.plan.equipments.length, 2, 'MCP create doit retourner equipments[]');

  console.log(JSON.stringify({ ok: true, checked: ['migration', 'validator', 'service', 'api_contract', 'frontend', 'mcp'], zones: 2, equipments: 2 }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
