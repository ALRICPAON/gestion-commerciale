const assert = require('assert');
const fs = require('fs');
const path = require('path');

const purchasesRouter = require('../routes/purchases');

const ROOT = path.join(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

function mergeExistingPhotos(existingUrls, patch) {
  if (patch.mode === 'clear') return [];
  if (patch.mode === 'replace') return patch.urls;
  if (patch.mode === 'merge') {
    return [...existingUrls, ...patch.urls].filter((url, index, all) => all.indexOf(url) === index);
  }
  return existingUrls;
}

function main() {
  const helpers = purchasesRouter._sanitaryPhotoTest;
  assert(helpers, 'Helpers de test photos sanitaires manquants');

  const firstPhoto = '/uploads/sanitary-photos/one.jpg';
  const secondPhoto = '/uploads/sanitary-photos/two.jpg';

  const uploadOne = helpers.resolveSanitaryPhotoPatch({ sanitary_photo_urls: [firstPhoto] }, { purchase_line_id: 'line-1' });
  assert.equal(uploadOne.mode, 'merge', 'Upload photo 1 doit merger les URLs');
  assert.deepEqual(uploadOne.urls, [firstPhoto]);

  const uploadTwo = helpers.resolveSanitaryPhotoPatch({ sanitary_photo_urls: [secondPhoto] }, { purchase_line_id: 'line-1' });
  const afterTwoUploads = mergeExistingPhotos(uploadOne.urls, uploadTwo);
  assert.deepEqual(afterTwoUploads, [firstPhoto, secondPhoto], 'Deux uploads successifs doivent conserver deux photos');

  const staleLineSheetSave = helpers.resolveSanitaryPhotoPatch({
    sanitary_photo_url: null,
    sanitary_photo_urls: [],
  }, { purchase_line_id: 'line-1' });
  assert.equal(staleLineSheetSave.mode, 'preserve', 'Un tableau vide obsolète doit preserver les photos');
  assert.deepEqual(mergeExistingPhotos(afterTwoUploads, staleLineSheetSave), [firstPhoto, secondPhoto], 'La sauvegarde obsolète ne doit pas vider les photos');

  const explicitClear = helpers.resolveSanitaryPhotoPatch({
    sanitary_photo_action: 'clear',
    sanitary_photo_urls: [],
  }, { purchase_line_id: 'line-1' });
  assert.equal(explicitClear.mode, 'clear', 'La suppression doit etre explicite');
  assert.deepEqual(mergeExistingPhotos(afterTwoUploads, explicitClear), [], 'La suppression explicite doit vider les photos');

  const historical = helpers.normalizeSanitaryPhotoUrls('not-json', firstPhoto, { purchase_line_id: 'legacy-line' });
  assert.deepEqual(historical, [firstPhoto], 'sanitary_photo_url historique doit rester exploitable si sanitary_photo_urls est invalide');

  const purchasesRoute = read('backend/routes/purchases.js');
  assert(purchasesRoute.includes("resolveSanitaryPhotoPatch"), 'PATCH ligne doit utiliser resolveSanitaryPhotoPatch');
  assert(purchasesRoute.includes("$13::text='clear'"), 'PATCH ligne doit gerer une suppression explicite');
  assert(purchasesRoute.includes("$13::text='merge'"), 'PATCH ligne doit merger les nouveaux uploads');
  assert(purchasesRoute.includes("ELSE CASE WHEN jsonb_typeof(purchase_line_metadata.sanitary_photo_urls)='array'"), 'PATCH ligne doit preserver/normaliser les photos existantes');

  const traceabilityRoute = read('backend/routes/traceability.js');
  assert(traceabilityRoute.includes("WHEN jsonb_typeof(m.sanitary_photo_urls) = 'array'"), 'Traceability doit proteger JSONB_ARRAY_ELEMENTS_TEXT par jsonb_typeof');

  const purchaseDetail = read('frontend/js/purchase-detail.js');
  assert(purchaseDetail.includes('visibilitychange'), 'purchase-detail doit recharger au retour de visibilite');
  assert(purchaseDetail.includes('window.addEventListener("focus"'), 'purchase-detail doit recharger au focus');
  assert(purchaseDetail.includes('openLineSheet(sheetLineToRefresh)'), 'La fiche ligne ouverte doit etre rafraichie apres reload');

  const photoBl = read('frontend/js/photo-bl.js');
  assert(photoBl.includes('const refreshed = await apiFetch(`/api/purchases/${encodeURIComponent(purchaseId)}`)'), 'photo-bl doit relire achat apres upload');
  assert(photoBl.includes('persistedUrls.length'), 'photo-bl doit afficher le total persiste');

  const receptionRoute = read('backend/routes/purchaseReceptionUpgrade.js');
  assert(receptionRoute.includes('sanitary_photo_urls: normalizeSanitaryPhotoUrls(line.sanitary_photo_urls, line.sanitary_photo_url'), 'Validation reception doit embarquer les photos normalisees');

  const evidenceService = read('backend/services/quality/purchaseReceptionEvidence.js');
  assert(evidenceService.includes('sanitary_photo_urls: jsonArray(line.sanitary_photo_urls)'), 'Preuve qualite doit conserver les photos de ligne');
  assert(evidenceService.includes('documents:') && evidenceService.includes('sanitary_photo_urls:'), 'Preuve qualite doit exposer les photos en documents');

  const transformations = read('backend/routes/transformations.js');
  const transformationValidation = read('backend/routes/transformationValidation.js');
  assert(transformations.includes('sourcePhotos'), 'Transformations doivent continuer a utiliser source_photos');
  assert(transformationValidation.includes('sourcePhotos'), 'Validation transformations doit continuer a utiliser source_photos');

  console.log(JSON.stringify({
    ok: true,
    upload_simple: true,
    upload_multiple: true,
    stale_line_sheet_preserves_photos: true,
    explicit_clear_supported: true,
    historical_single_photo_normalized: true,
    purchase_detail_focus_reload: true,
    photo_bl_persistence_confirmation: true,
    traceability_jsonb_guard: true,
    reception_quality_evidence_preserved: true,
    transformations_source_photos_checked: true,
  }, null, 2));
}

main();
