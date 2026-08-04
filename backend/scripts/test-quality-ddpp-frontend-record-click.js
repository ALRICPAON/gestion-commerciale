const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const temperatureRecordId = '11111111-1111-4111-8111-111111111111';
const wrongTaskId = '22222222-2222-4222-8222-222222222222';
const wrongOccurrenceId = '33333333-3333-4333-8333-333333333333';
const wrongSourceEntityId = '44444444-4444-4444-8444-444444444444';

class Element {
  constructor(id) {
    this.id = id;
    this.innerHTML = '';
    this.textContent = '';
    this.className = '';
    this.dataset = {};
    this.listeners = {};
    this.classList = {
      add: () => {},
      remove: () => {},
      toggle: () => {},
    };
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }
}

function datasetFromButton(html) {
  const button = html.match(/<button\b[^>]*data-detail-type="[^"]+"[^>]*>/)?.[0];
  assert(button, 'Le tableau DDPP doit rendre un bouton Voir le detail');
  const dataset = {};
  for (const [, key, value] of button.matchAll(/\sdata-([a-z0-9-]+)="([^"]*)"/g)) {
    const camel = key.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
    dataset[camel] = value;
  }
  return dataset;
}

async function main() {
  const source = fs.readFileSync(path.join(root, 'frontend/quality/js/quality-ddpp.js'), 'utf8');
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  };
  let clickHandler = null;
  let requestedDetailUrl = null;
  const fetchCalls = [];

  const fakeApi = {
    ddpp: async () => ({
      status: 'green',
      period: { start: '2026-08-04T00:00:00.000Z', end: '2026-08-04T23:59:59.000Z' },
      today: { generated_at: '2026-08-04T05:00:00.000Z', summary: {} },
      summary: {},
      completed_items: [],
      temperature_records: [{
        id: wrongTaskId,
        record_id: temperatureRecordId,
        source_record_id: wrongOccurrenceId,
        occurrence_id: wrongOccurrenceId,
        quality_task_id: wrongTaskId,
        source_entity_id: wrongSourceEntityId,
        detail_type: 'temperature',
        record_type: 'temperature',
        recorded_at: '2026-08-04T04:00:00.000Z',
        type_label: 'Chambre froide',
        zone_name: 'Atelier',
        equipment_name: 'Thermometre',
        value: 7.5,
        unit: 'C',
        alert_status: 'compliant',
      }],
      cleaning_records: [],
      non_conformities: [],
      corrective_actions: [],
    }),
    ddppRecordDetail: async (type, id) => {
      requestedDetailUrl = `/api/quality/operations/ddpp/record/${type}/${id}`;
      assert.equal(type, 'temperature', 'Le detail doit demander un record temperature');
      assert.equal(id, temperatureRecordId, `Le detail doit recevoir le record metier temperature, recu: ${id}`);
      fetchCalls.push(requestedDetailUrl);
      return {
        type: 'temperature',
        record: { id: temperatureRecordId, value: 7.5, unit: 'C', recorded_at: '2026-08-04T04:00:00.000Z', alert_status: 'compliant' },
        source: { record_id: temperatureRecordId, occurrence_id: wrongOccurrenceId, quality_task_id: wrongTaskId },
        attachments: {},
        non_conformities: [],
        corrective_actions: [],
      };
    },
  };

  const context = {
    console,
    URLSearchParams,
    FormData: class {
      entries() { return []; }
    },
    localStorage: {
      getItem(key) {
        if (key === 'gc_user') return JSON.stringify({ id: 'user-test', email: 'qa@example.test' });
        if (key === 'gc_token') return 'token-test';
        return null;
      },
    },
    window: {
      APP_CONFIG: { API_BASE_URL: '' },
      location: { href: '' },
    },
    document: {
      getElementById: getElement,
      addEventListener(type, handler) {
        if (type === 'click') clickHandler = handler;
      },
    },
    fetch: async (url) => {
      fetchCalls.push(String(url));
      if (String(url).startsWith('/api/quality/operations/ddpp/record/')) {
        requestedDetailUrl = String(url);
        assert(requestedDetailUrl.endsWith(`/temperature/${temperatureRecordId}`), `Le detail doit recevoir le record metier temperature, recu: ${requestedDetailUrl}`);
        return {
          ok: true,
          json: async () => ({
            type: 'temperature',
            record: { id: temperatureRecordId, value: 7.5, unit: 'C', recorded_at: '2026-08-04T04:00:00.000Z', alert_status: 'compliant' },
            source: { record_id: temperatureRecordId, occurrence_id: wrongOccurrenceId, quality_task_id: wrongTaskId },
            attachments: {},
            non_conformities: [],
            corrective_actions: [],
          }),
        };
      }
      if (String(url).startsWith('/api/quality/operations/ddpp')) {
        return {
          ok: true,
          json: async () => ({
            status: 'green',
            period: { start: '2026-08-04T00:00:00.000Z', end: '2026-08-04T23:59:59.000Z' },
            today: { generated_at: '2026-08-04T05:00:00.000Z', summary: {} },
            summary: {},
            completed_items: [],
            temperature_records: [{
              id: wrongTaskId,
              record_id: temperatureRecordId,
              source_record_id: wrongOccurrenceId,
              occurrence_id: wrongOccurrenceId,
              quality_task_id: wrongTaskId,
              source_entity_id: wrongSourceEntityId,
              detail_type: 'temperature',
              record_type: 'temperature',
              recorded_at: '2026-08-04T04:00:00.000Z',
              type_label: 'Chambre froide',
              zone_name: 'Atelier',
              equipment_name: 'Thermometre',
              value: 7.5,
              unit: 'C',
              alert_status: 'compliant',
            }],
            cleaning_records: [],
            non_conformities: [],
            corrective_actions: [],
          }),
        };
      }
      throw new Error(`URL inattendue: ${url}`);
    },
  };
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;
  context.window.fetch = context.fetch;
  context.window.QualityOperationsApi = fakeApi;

  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'quality-ddpp.js' });
  await new Promise((resolve) => setImmediate(resolve));

  const temperaturesHtml = getElement('quality-ddpp-temperatures').innerHTML;
  const dataset = datasetFromButton(temperaturesHtml);
  assert.equal(dataset.detailId, temperatureRecordId, 'Le bouton doit porter data-detail-id=record_id metier');
  assert.equal(dataset.recordId, temperatureRecordId, 'Le bouton doit tracer record_id metier');
  assert.equal(dataset.taskId, wrongTaskId, 'Le bouton doit tracer task_id sans l envoyer');
  assert.equal(dataset.occurrenceId, wrongOccurrenceId, 'Le bouton doit tracer occurrence_id sans l envoyer');
  assert.equal(dataset.sourceEntityId, wrongSourceEntityId, 'Le bouton doit tracer source_entity_id sans l envoyer');
  assert.equal(dataset.sourceRecordId, wrongOccurrenceId, 'Le bouton doit tracer source_record_id sans l envoyer');

  clickHandler({
    target: {
      closest(selector) {
        if (selector !== '[data-detail-type]') return null;
        return { dataset };
      },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert(requestedDetailUrl, 'Le clic Voir detail doit appeler l API detail');
  assert(fetchCalls.some((url) => url.endsWith(`/temperature/${temperatureRecordId}`)), 'L API doit recevoir exactement le record metier');
  assert(getElement('quality-ddpp-detail-body').innerHTML.includes('7.50 C'), 'Le detail doit etre affiche');

  console.log(JSON.stringify({
    ok: true,
    clicked_detail_button: true,
    sent_record_id: temperatureRecordId,
    wrong_task_id_not_sent: wrongTaskId,
    wrong_occurrence_id_not_sent: wrongOccurrenceId,
    detail_displayed: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
