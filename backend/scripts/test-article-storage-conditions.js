const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  mergeStoragePatch,
  normalizeStoragePayload,
} = require('../services/articleStorageConditions');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

function includes(relativePath, expected, message) {
  assert(read(relativePath).includes(expected), message);
}

assert.deepStrictEqual(
  normalizeStoragePayload({
    storage_temperature_min: '3',
    storage_temperature_max: '5',
    storage_instruction: 'Entreposer au froid',
  }),
  {
    storage_temperature_min: 3,
    storage_temperature_max: 5,
    storage_instruction: 'Entreposer au froid',
  },
  '3/5/instruction doivent etre normalises'
);

assert.deepStrictEqual(
  normalizeStoragePayload({
    storage_temperature_min: '0',
    storage_temperature_max: '2',
    storage_instruction: '',
  }),
  {
    storage_temperature_min: 0,
    storage_temperature_max: 2,
    storage_instruction: null,
  },
  '0 doit rester une valeur et instruction vide doit rester null'
);

assert.deepStrictEqual(
  normalizeStoragePayload({}),
  {
    storage_temperature_min: null,
    storage_temperature_max: null,
    storage_instruction: null,
  },
  'absence de champs doit rester null'
);

assert.deepStrictEqual(
  normalizeStoragePayload({
    storage_temperature_min: '-2,5',
    storage_temperature_max: '4,5',
  }),
  {
    storage_temperature_min: -2.5,
    storage_temperature_max: 4.5,
    storage_instruction: null,
  },
  'decimales et temperatures negatives doivent etre acceptees'
);

assert.throws(
  () => normalizeStoragePayload({ storage_temperature_min: 6, storage_temperature_max: 5 }),
  /Temperature minimale de conservation superieure/,
  'min > max doit etre rejete'
);

assert.deepStrictEqual(
  mergeStoragePatch(
    { storage_temperature_min: 3, storage_temperature_max: 5, storage_instruction: 'Froid' },
    { storage_temperature_max: '6' }
  ),
  { storage_temperature_min: 3, storage_temperature_max: 6, storage_instruction: 'Froid' },
  'PATCH doit conserver les champs absents'
);

includes('backend/db/gestion-commerciale/107_article_storage_conditions.sql', 'ADD COLUMN IF NOT EXISTS storage_temperature_min numeric(6,2)', 'migration min manquante');
includes('backend/db/gestion-commerciale/107_article_storage_conditions.sql', 'ADD COLUMN IF NOT EXISTS storage_temperature_max numeric(6,2)', 'migration max manquante');
includes('backend/db/gestion-commerciale/107_article_storage_conditions.sql', 'ADD COLUMN IF NOT EXISTS storage_instruction text', 'migration instruction manquante');
includes('backend/db/gestion-commerciale/107_article_storage_conditions_rollback.sql', 'DROP COLUMN IF EXISTS storage_instruction', 'rollback instruction manquant');

includes('backend/routes/articlesStoreLevel.js', 'storage_temperature_min, storage_temperature_max, storage_instruction', 'route active doit inserer les champs conservation');
includes('backend/routes/articlesStoreLevel.js', 'storage_temperature_min = $22', 'route active doit mettre a jour la temperature min');
includes('backend/routes/articlesStoreLevel.js', 'storage_temperature_min: parseNumber(article.storage_temperature_min)', 'duplication active doit copier la temperature min');
includes('backend/routes/articlesStoreLevel.js', 'storage_instruction: article.storage_instruction', 'duplication active doit copier l instruction');

includes('backend/routes/articlesExcelDetail.js', 'Température conservation min °C', 'export Excel doit exposer la colonne min');
includes('backend/routes/articlesExcelDetail.js', 'Température conservation max °C', 'export Excel doit exposer la colonne max');
includes('backend/routes/articlesExcelDetail.js', 'Instruction conservation', 'export Excel doit exposer la colonne instruction');
includes('backend/routes/articlesExcelDetail.js', 'normalizeImportRow(sourceRow)', 'import Excel doit rester compatible avec anciens entetes et nouveaux entetes');
includes('backend/routes/articlesExcelDetail.js', 'validateStorageRange', 'import Excel doit valider min <= max');

includes('frontend/articles.html', 'article-storage-temperature-min', 'formulaire article doit afficher la temperature min');
includes('frontend/articles.html', 'article-storage-temperature-max', 'formulaire article doit afficher la temperature max');
includes('frontend/articles.html', 'article-storage-instruction', 'formulaire article doit afficher l instruction');
includes('frontend/js/articles.js', 'storage_temperature_min: parseNumberInput(articleStorageTemperatureMinInput)', 'front doit envoyer la temperature min');
includes('frontend/js/articles.js', 'article?.storage_temperature_min ??', 'front doit relire 0 comme valeur');
includes('frontend/article-detail.html', 'id="conservation"', 'fiche detail doit afficher la conservation');
includes('frontend/js/article-detail.js', 'formatTemperature(article.storage_temperature_min)', 'fiche detail doit formater la temperature min');

includes('backend/routes/deliveryNotes.js', 'a.storage_temperature_min, a.storage_temperature_max, a.storage_instruction', 'route etiquettes doit lire les champs Article');
includes('backend/services/healthLabelService.js', 'formatStorageTemperatureRange', 'service etiquette doit formater la plage structuree');
includes('frontend/js/health-labels.js', "info('CONSERVATION', label.storage_temperature_label)", 'aperçu etiquette doit afficher la plage si disponible');

console.log(JSON.stringify({ ok: true, migration: '107_article_storage_conditions.sql' }, null, 2));
