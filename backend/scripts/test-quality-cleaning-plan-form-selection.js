const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ZONE_RECEPTION = '00000000-0000-4000-8000-000000000101';
const ZONE_PREP = '00000000-0000-4000-8000-000000000102';
const ZONE_SOCIAL = '00000000-0000-4000-8000-000000000103';
const EQUIPMENT_DOOR = '00000000-0000-4000-8000-000000000201';
const EQUIPMENT_TABLE = '00000000-0000-4000-8000-000000000202';
const EQUIPMENT_SCALE = '00000000-0000-4000-8000-000000000203';

class ClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  toggle(value, force) {
    const enabled = force === undefined ? !this.values.has(value) : Boolean(force);
    if (enabled) this.values.add(value);
    else this.values.delete(value);
  }
  contains(value) { return this.values.has(value); }
}

class Element {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.checked = false;
    this.disabled = false;
    this.dataset = {};
    this.children = [];
    this.options = [];
    this.classList = new ClassList();
    this.listeners = {};
  }
  appendChild(child) {
    this.children.push(child);
    if (child.tagName === 'OPTION') this.options.push(child);
    return child;
  }
  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
    if (this.tagName === 'SELECT') this.options = [];
  }
  get innerHTML() { return this._innerHTML || ''; }
  get selectedOptions() { return this.options.filter((option) => option.selected); }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  reset() {}
  querySelectorAll() { return []; }
}

function makeDocument() {
  const ids = [
    'cleaning-plans-feedback', 'cleaning-plan-list', 'cleaning-plan-add-btn',
    'cleaning-plan-form-card', 'cleaning-plan-form', 'cleaning-plan-form-title', 'cleaning-plan-id',
    'cleaning-plan-title', 'cleaning-plan-zone-ids', 'cleaning-plan-equipment-search',
    'cleaning-plan-equipment-options', 'cleaning-plan-select-zone-equipments', 'cleaning-plan-clear-equipments',
    'cleaning-plan-product', 'cleaning-plan-duration', 'cleaning-plan-active', 'cleaning-plan-method',
    'cleaning-plan-safety', 'cleaning-plan-description', 'cleaning-plan-planning-mode',
    'cleaning-plan-quality-task-id', 'cleaning-plan-task-title', 'cleaning-plan-task-responsible',
    'cleaning-plan-frequency-value', 'cleaning-plan-frequency-unit', 'cleaning-plan-target-time', 'cleaning-plan-cancel-btn',
    'cleaning-plan-existing-task-label', 'cleaning-plan-task-title-label', 'cleaning-plan-task-responsible-label',
    'cleaning-plan-frequency-value-label', 'cleaning-plan-frequency-unit-label', 'cleaning-plan-target-time-label',
    'cleaning-plan-scheduled-days-label',
  ];
  const elements = new Map(ids.map((id) => [id, new Element(id.includes('zone-ids') || id.includes('task-id') || id.includes('mode') || id.includes('unit') || id.includes('responsible') ? 'select' : 'div', id)]));
  const scheduledInputs = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((value) => {
    const input = new Element('input');
    input.name = 'cleaning-plan-scheduled-day';
    input.value = value;
    return input;
  });
  elements.get('cleaning-plan-scheduled-days-label').querySelectorAll = (selector) => selector === 'input[name="cleaning-plan-scheduled-day"]' ? scheduledInputs : [];
  elements.get('cleaning-plan-form').reset = () => {};
  return {
    elements,
    createElement(tag) { return new Element(tag); },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element('div', id));
      return elements.get(id);
    },
  };
}

function loadModule(plansById) {
  const document = makeDocument();
  let saveCalls = 0;
  const context = {
    console,
    document,
    localStorage: {
      getItem(key) {
        if (key === 'gc_user') return JSON.stringify({ id: 'user-1', role: 'admin', permissions: ['quality.equipment.manage'] });
        if (key === 'gc_token') return 'token';
        return null;
      },
    },
    window: {
      __QUALITY_CLEANING_PLANS_TEST_MODE__: true,
      location: { href: '' },
      hasQualityPermission: () => true,
      QualityCleaningApi: {
        getPlan: async (id) => plansById[id],
        savePlan: async () => { saveCalls += 1; },
        listPlans: async () => [],
        updatePlanStatus: async () => {},
      },
      QualityDigitalTwinApi: { listZones: async () => [], listEquipments: async () => [] },
      QualityTasksApi: { list: async () => [] },
      APP_CONFIG: {},
    },
  };
  context.window.window = context.window;
  context.window.document = document;
  context.window.localStorage = context.localStorage;
  vm.createContext(context);
  const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'quality', 'js', 'cleaning-plans.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'cleaning-plans.js' });
  return {
    document,
    helpers: context.window.__QualityCleaningPlansTest,
    saveCalls: () => saveCalls,
  };
}

function selectedValues(document) {
  return document.getElementById('cleaning-plan-zone-ids').options.filter((option) => option.selected).map((option) => option.value);
}

async function main() {
  const zones = [
    { id: ZONE_RECEPTION, code: 'RDC-RECEPTION-CRIEE', name: 'Reception criee' },
    { id: ZONE_PREP, code: 'RDC-PREPA', name: 'Preparation' },
    { id: ZONE_SOCIAL, code: 'RDC-SOCIAL', name: 'Locaux sociaux' },
  ];
  const equipments = [
    { id: EQUIPMENT_DOOR, code: 'PORTE-REC01', name: 'Porte reception', zone_id: ZONE_RECEPTION, zone_name: 'Reception criee' },
    { id: EQUIPMENT_TABLE, code: 'TABLE-01', name: 'Table decoupe', zone_id: ZONE_PREP, zone_name: 'Preparation' },
    { id: EQUIPMENT_SCALE, code: 'BAL-01', name: 'Balance', zone_id: ZONE_PREP, zone_name: 'Preparation' },
  ];
  const single = {
    id: 'plan-single',
    title: 'Reception des produits',
    zones: [{ id: ZONE_RECEPTION, code: 'RDC-RECEPTION-CRIEE', name: 'Reception criee' }],
    equipments: [{ id: EQUIPMENT_DOOR, code: 'PORTE-REC01', name: 'Porte reception', zone_id: ZONE_RECEPTION }],
    scheduled_days: ['monday', 'tuesday'],
  };
  const multi = {
    id: 'plan-multi',
    title: 'Materiels contact alimentaire',
    zones: [{ id: ZONE_RECEPTION }, { id: ZONE_PREP }],
    equipments: [{ id: EQUIPMENT_DOOR }, { id: EQUIPMENT_TABLE }],
  };
  const legacy = {
    id: 'plan-legacy',
    title: 'Legacy',
    zone_id: ZONE_SOCIAL,
    equipment_id: EQUIPMENT_SCALE,
  };
  const codeOnly = {
    id: 'plan-code',
    title: 'Code only',
    zones: [{ code: 'RDC-RECEPTION-CRIEE' }],
    equipments: [{ code: 'PORTE-REC01' }],
  };
  const app = loadModule({ 'plan-single': single, 'plan-multi': multi, 'plan-legacy': legacy, 'plan-code': codeOnly });
  app.helpers.setData({ zones, equipments });

  await app.helpers.openEditForm('plan-single');
  assert.deepEqual(selectedValues(app.document), [ZONE_RECEPTION], 'Un seul plan ne doit selectionner que sa zone');
  assert.deepEqual(app.helpers.state().selectedEquipmentIds, [EQUIPMENT_DOOR], 'Un seul plan ne doit cocher que son equipement');
  assert.deepEqual(app.helpers.selectedScheduledDays(), ['monday', 'tuesday'], 'Les jours planifies du plan doivent etre charges');
  assert(!selectedValues(app.document).includes(ZONE_PREP), 'Aucune selection parasite zone preparation');
  assert(!selectedValues(app.document).includes(ZONE_SOCIAL), 'Aucune selection parasite zone sociaux');

  app.document.getElementById('cleaning-plan-cancel-btn').listeners.click?.();
  assert.equal(app.saveCalls(), 0, 'Annuler ne doit pas sauvegarder');
  await app.helpers.openEditForm('plan-single');
  assert.deepEqual(selectedValues(app.document), [ZONE_RECEPTION], 'Reouverture doit conserver la selection reelle');
  assert.equal(app.saveCalls(), 0, 'Reouverture ne doit pas sauvegarder');

  await app.helpers.openEditForm('plan-multi');
  assert.deepEqual(selectedValues(app.document).sort(), [ZONE_PREP, ZONE_RECEPTION].sort(), 'Multi-zones invalide');
  assert.deepEqual(app.helpers.state().selectedEquipmentIds.sort(), [EQUIPMENT_DOOR, EQUIPMENT_TABLE].sort(), 'Multi-equipements invalide');
  app.document.getElementById('cleaning-plan-frequency-unit').value = 'events';
  app.document.getElementById('cleaning-plan-frequency-unit').listeners.change?.();
  assert.deepEqual(app.helpers.selectedScheduledDays(), [], 'Frequence evenementielle ne doit pas envoyer de jours planifies');

  await app.helpers.openEditForm('plan-legacy');
  assert.deepEqual(selectedValues(app.document), [ZONE_SOCIAL], 'Champs legacy zone_id non respectes');
  assert.deepEqual(app.helpers.state().selectedEquipmentIds, [EQUIPMENT_SCALE], 'Champs legacy equipment_id non respectes');

  await app.helpers.openEditForm('plan-code');
  assert.deepEqual(selectedValues(app.document), [ZONE_RECEPTION], 'Tableaux objets par code non normalises');
  assert.deepEqual(app.helpers.state().selectedEquipmentIds, [EQUIPMENT_DOOR], 'Equipements objets par code non normalises');

  console.log(JSON.stringify({ ok: true, checked: ['single', 'multi', 'legacy', 'arrays', 'scheduled_days', 'events_without_days', 'no_stray_selection', 'cancel_without_save', 'reopen'] }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
