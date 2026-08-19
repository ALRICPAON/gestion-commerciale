const {
  clean,
  hasStorageField,
  mergeStoragePatch,
  nullableTemperature,
  validateStorageRange,
} = require('./articleStorageConditions');

const STORAGE_FIELDS = Object.freeze([
  'storage_temperature_min',
  'storage_temperature_max',
  'storage_instruction',
]);

const STORAGE_FIELD_SET = new Set(STORAGE_FIELDS);
const UPDATE_PAYLOAD_FIELDS = new Set(['article_id', 'changes']);

function expose(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw expose(400, `${label} doit etre un objet`);
  }
}

function assertId(value, label) {
  const normalized = clean(value);
  if (!normalized) throw expose(400, `${label} requis`);
  return normalized;
}

function normalizeArticleStorageChanges(rawChanges = {}) {
  assertObject(rawChanges, 'changes');
  const unknownKeys = Object.keys(rawChanges).filter((key) => !STORAGE_FIELD_SET.has(key));
  if (unknownKeys.length) {
    throw expose(400, `Champ(s) Article non autorise(s) pour cette action : ${unknownKeys.join(', ')}`);
  }
  if (!STORAGE_FIELDS.some((field) => hasStorageField(rawChanges, field))) {
    throw expose(400, 'Au moins une condition de conservation Article doit etre fournie');
  }

  const changes = {};
  if (hasStorageField(rawChanges, 'storage_temperature_min')) {
    changes.storage_temperature_min = nullableTemperature(
      rawChanges.storage_temperature_min,
      'Temperature minimale de conservation'
    );
  }
  if (hasStorageField(rawChanges, 'storage_temperature_max')) {
    changes.storage_temperature_max = nullableTemperature(
      rawChanges.storage_temperature_max,
      'Temperature maximale de conservation'
    );
  }
  if (hasStorageField(rawChanges, 'storage_instruction')) {
    changes.storage_instruction = clean(rawChanges.storage_instruction);
  }

  validateStorageRange({
    storage_temperature_min: hasStorageField(changes, 'storage_temperature_min') ? changes.storage_temperature_min : null,
    storage_temperature_max: hasStorageField(changes, 'storage_temperature_max') ? changes.storage_temperature_max : null,
  });
  return changes;
}

function normalizeArticleStorageUpdatePayload(payload = {}) {
  assertObject(payload, 'payload');
  const unknownKeys = Object.keys(payload).filter((key) => !UPDATE_PAYLOAD_FIELDS.has(key));
  if (unknownKeys.length) {
    throw expose(400, `Cle(s) payload non autorisee(s) pour cette action : ${unknownKeys.join(', ')}`);
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'changes')) {
    throw expose(400, 'payload.changes requis pour modifier les conditions de conservation Article');
  }
  return {
    article_id: assertId(payload.article_id, 'article_id'),
    changes: normalizeArticleStorageChanges(payload.changes),
  };
}

function storageSnapshot(row = {}) {
  return {
    storage_temperature_min: row.storage_temperature_min === undefined || row.storage_temperature_min === null
      ? null
      : Number(row.storage_temperature_min),
    storage_temperature_max: row.storage_temperature_max === undefined || row.storage_temperature_max === null
      ? null
      : Number(row.storage_temperature_max),
    storage_instruction: clean(row.storage_instruction),
  };
}

function numberEqual(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) {
    return (left === null || left === undefined) && (right === null || right === undefined);
  }
  return Number(left) === Number(right);
}

function storageMatches(expected, actual) {
  return numberEqual(expected.storage_temperature_min, actual.storage_temperature_min)
    && numberEqual(expected.storage_temperature_max, actual.storage_temperature_max)
    && clean(expected.storage_instruction) === clean(actual.storage_instruction);
}

async function executeArticleStorageConditionsUpdate({ db, context, payload }) {
  const normalized = normalizeArticleStorageUpdatePayload(payload);
  const currentResult = await db.query(
    `
    SELECT id, store_id, plu, designation, article_category,
           storage_temperature_min, storage_temperature_max, storage_instruction
    FROM articles
    WHERE id = $1 AND store_id = $2
    FOR UPDATE
    `,
    [normalized.article_id, context.store_id]
  );
  const before = currentResult.rows[0];
  if (!before) {
    throw expose(404, 'Article introuvable pour ce magasin');
  }

  const next = mergeStoragePatch(before, normalized.changes);
  await db.query(
    `
    UPDATE articles
    SET storage_temperature_min = $3,
        storage_temperature_max = $4,
        storage_instruction = $5,
        updated_by = COALESCE($6, updated_by),
        updated_at = NOW()
    WHERE id = $1 AND store_id = $2
    `,
    [
      normalized.article_id,
      context.store_id,
      next.storage_temperature_min,
      next.storage_temperature_max,
      next.storage_instruction,
      context.user_id || null,
    ]
  );

  const rereadResult = await db.query(
    `
    SELECT id, store_id, plu, designation, article_category,
           storage_temperature_min, storage_temperature_max, storage_instruction
    FROM articles
    WHERE id = $1 AND store_id = $2
    LIMIT 1
    `,
    [normalized.article_id, context.store_id]
  );
  const after = rereadResult.rows[0];
  if (!after || !storageMatches(next, storageSnapshot(after))) {
    throw expose(409, 'Les conditions de conservation Article relues ne correspondent pas aux valeurs enregistrees');
  }
  if (clean(after.article_category) !== clean(before.article_category)) {
    throw expose(409, 'La categorie Article relue ne correspond pas a la categorie initiale');
  }

  return {
    ok: true,
    mode: 'executed',
    action: 'articles.update_storage_conditions',
    module: 'articles',
    target_type: 'articles',
    target_id: after.id,
    article: {
      id: after.id,
      plu: after.plu,
      designation: after.designation,
      article_category: after.article_category,
    },
    before: storageSnapshot(before),
    after: storageSnapshot(after),
    changes: normalized.changes,
  };
}

module.exports = {
  STORAGE_FIELDS,
  executeArticleStorageConditionsUpdate,
  normalizeArticleStorageChanges,
  normalizeArticleStorageUpdatePayload,
  storageSnapshot,
};
