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
  const proofUploader = read('frontend/quality/js/quality-proof-uploader.js');
  const todayJs = read('frontend/quality/js/quality-today.js');
  const tempJs = read('frontend/quality/js/temperature-records.js');
  const cleaningJs = read('frontend/quality/js/cleaning-records.js');
  const operationsApi = read('frontend/quality/js/operations-api.js');
  const operationsRoute = read('backend/routes/quality/operations.js');
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
    'uploadEvidenceFiles',
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

  assertContains(helper, 'type="text" inputmode="decimal"', 'Le composant temperature doit accepter 7,5 et 7.5');
  assertContains(helper, "String(value).replace(',', '.')", 'Le parsing temperature doit accepter la virgule');
  assertContains(proofUploader, 'ownerFromContext', 'Uploader preuve doit conserver les UUID du contexte');
  assertContains(proofUploader, "'zone_id'", 'Uploader preuve doit transmettre zone_id');
  assertContains(proofUploader, "'equipment_id'", 'Uploader preuve doit transmettre equipment_id');
  assertContains(proofUploader, "'task_id'", 'Uploader preuve doit transmettre task_id');
  assertContains(proofUploader, "'occurrence_id'", 'Uploader preuve doit transmettre occurrence_id');
  assertContains(proofUploader, "'source_entity_type'", 'Uploader preuve doit transmettre source_entity_type');
  assertContains(proofUploader, "'source_entity_id'", 'Uploader preuve doit transmettre source_entity_id');
  assertContains(proofUploader, 'cleanupUploaded', 'Uploader preuve doit nettoyer les preuves si le controle echoue');
  assertContains(operationsApi, 'deleteEvidencePhoto', 'API operationnelle doit permettre le rollback photo');
  assertContains(operationsApi, 'deleteEvidenceDocument', 'API operationnelle doit permettre le rollback document');
  assertContains(operationsRoute, "router.delete('/evidence/photos/:id'", 'Route rollback photo manquante');
  assertContains(operationsRoute, "router.delete('/evidence/documents/:id'", 'Route rollback document manquante');
  assertContains(todayJs, 'manualEvidencePhotoFile', 'La saisie manuelle doit accepter une photo');
  assertContains(todayJs, 'uploadManualEvidence', 'La saisie manuelle doit uploader les preuves');

  assertContains(todayHtml, 'quality-proof-uploader.js?v=1', 'Cache uploader preuves manquant dans Qualite du jour');
  assertContains(todayHtml, 'quality-execution-forms.js?v=4', 'Cache helper partage non incremente dans Qualite du jour');
  assertContains(todayHtml, 'operations-api.js?v=5', 'Cache API operationnelle non incremente dans Qualite du jour');
  assertContains(todayHtml, 'quality-today.js?v=7', 'Cache Qualite du jour non incremente');
  assertContains(tempHtml, 'quality-proof-uploader.js?v=1', 'Cache uploader preuves manquant dans Releves temperatures');
  assertContains(tempHtml, 'quality-execution-forms.js?v=4', 'Cache helper partage non incremente dans Releves temperatures');
  assertContains(tempHtml, 'operations-api.js?v=5', 'Cache API operationnelle non incremente dans Releves temperatures');
  assertContains(tempHtml, 'temperature-records.js?v=7', 'Cache temperatures non incremente');
  assertContains(cleaningHtml, 'quality-proof-uploader.js?v=1', 'Cache uploader preuves manquant dans Nettoyages');
  assertContains(cleaningHtml, 'quality-execution-forms.js?v=4', 'Cache helper partage non incremente dans Nettoyages');
  assertContains(cleaningHtml, 'operations-api.js?v=5', 'Cache API operationnelle non incremente dans Nettoyages');
  assertContains(cleaningHtml, 'cleaning-records.js?v=6', 'Cache nettoyages non incremente');

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
