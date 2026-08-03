const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function assertContains(source, pattern, message) {
  assert(source.includes(pattern), message);
}

function assertNotContains(source, pattern, message) {
  assert(!source.includes(pattern), message);
}

function main() {
  const helper = read('frontend/quality/js/quality-execution-forms.js');
  const todayJs = read('frontend/quality/js/quality-today.js');
  const tempJs = read('frontend/quality/js/temperature-records.js');
  const cleaningJs = read('frontend/quality/js/cleaning-records.js');
  const todayHtml = read('frontend/quality/pages/quality-today.html');
  const tempHtml = read('frontend/quality/pages/temperature-records.html');
  const cleaningHtml = read('frontend/quality/pages/cleaning-records.html');

  [
    'createTemperatureExecutionForm',
    'createCleaningExecutionForm',
    'submitTemperatureExecution',
    'submitCleaningExecution',
    'TEMPERATURE_FIELDS',
    'CLEANING_FIELDS',
  ].forEach((exportName) => assertContains(helper, exportName, `${exportName} doit etre exporte par le helper partage`));

  [
    'parameter', 'type', 'zone', 'equipment', 'min_limit', 'max_limit', 'unit',
    'value', 'recorded_at', 'source', 'operator', 'comment', 'conformity',
    'corrective_action', 'evidence_photo_id', 'evidence_document_id', 'exceptional_reason',
  ].forEach((field) => assertContains(helper, field, `Champ temperature partage manquant: ${field}`));

  [
    'plan', 'zones', 'equipments', 'method', 'product', 'dosage_concentration',
    'contact_time_minutes', 'safety_instructions', 'started_at', 'ended_at',
    'status', 'visual_check_status', 'operator', 'comment', 'anomaly_comment',
    'corrective_action', 'evidence_photo_id', 'evidence_document_id', 'exceptional_reason',
  ].forEach((field) => assertContains(helper, field, `Champ nettoyage partage manquant: ${field}`));

  [todayJs, tempJs].forEach((source) => {
    assertContains(source, 'createTemperatureExecutionForm', 'Les vues temperature doivent monter le composant temperature partage');
    assertContains(source, 'operationsApi', 'Les vues temperature doivent utiliser l API operationnelle');
  });
  [todayJs, cleaningJs].forEach((source) => {
    assertContains(source, 'createCleaningExecutionForm', 'Les vues nettoyage doivent monter le composant nettoyage partage');
    assertContains(source, 'operationsApi', 'Les vues nettoyage doivent utiliser l API operationnelle');
  });

  assertNotContains(todayJs, 'quality-temperature-value', 'Qualite du jour ne doit plus piloter un formulaire temperature local');
  assertNotContains(todayJs, 'quality-cleaning-status', 'Qualite du jour ne doit plus piloter un formulaire nettoyage local');
  assertNotContains(tempJs, 'api.saveRecord(data', 'La creation temperature ne doit plus contourner la route operationnelle');
  assertNotContains(cleaningJs, 'api.createRecord(data', 'La creation nettoyage ne doit plus contourner la route operationnelle');

  assertContains(todayHtml, 'quality-execution-forms.js?v=2', 'Cache helper partage non incremente dans Qualite du jour');
  assertContains(todayHtml, 'quality-today.js?v=4', 'Cache Qualite du jour non incremente');
  assertContains(tempHtml, 'quality-execution-forms.js?v=2', 'Cache helper partage non incremente dans Releves temperatures');
  assertContains(tempHtml, 'temperature-records.js?v=4', 'Cache temperatures non incremente');
  assertContains(cleaningHtml, 'quality-execution-forms.js?v=2', 'Cache helper partage non incremente dans Nettoyages');
  assertContains(cleaningHtml, 'cleaning-records.js?v=3', 'Cache nettoyages non incremente');

  assertContains(todayHtml, 'id="quality-temperature-execution-form"', 'Qualite du jour doit exposer le conteneur temperature partage');
  assertContains(todayHtml, 'id="quality-cleaning-execution-form"', 'Qualite du jour doit exposer le conteneur nettoyage partage');
  assertContains(tempHtml, 'id="temperature-record-form"', 'Releves temperatures doit exposer le conteneur temperature partage');
  assertContains(cleaningHtml, 'id="cleaning-record-form"', 'Nettoyages doit exposer le conteneur nettoyage partage');

  console.log(JSON.stringify({
    ok: true,
    shared_temperature_component: true,
    shared_cleaning_component: true,
    canonical_frontend_submit: true,
    cache_versions_updated: true,
  }, null, 2));
}

main();
