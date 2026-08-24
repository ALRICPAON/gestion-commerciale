const { assertArticleCategory } = require('./articleCategory');
const { normalizeStoragePayload } = require('./articleStorageConditions');

const DEFAULT_UNIT = 'kg';
const DEFAULT_VAT_RATE = 5.5;
const AGENT_ARTICLE_CREATE_FIELDS = Object.freeze([
  'department_id',
  'plu',
  'designation',
  'ean',
  'unit',
  'article_category',
  'is_active',
  'family_code',
  'sector_code',
  'category',
  'latin_name',
  'fao_zone',
  'sous_zone',
  'engin',
  'allergenes',
  'display_name',
  'purchase_unit',
  'stock_unit',
  'sale_unit',
  'vat_rate',
  'purchase_price_ex_vat',
  'sale_price_ex_vat',
  'sale_price_inc_vat',
  'storage_temperature_min',
  'storage_temperature_max',
  'storage_instruction',
]);
const AGENT_ARTICLE_CREATE_FIELD_SET = new Set(AGENT_ARTICLE_CREATE_FIELDS);

function expose(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function toNullableString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeUuidParam(value) {
  const s = String(value ?? '').trim();
  if (!s || s === 'null' || s === 'undefined') return null;
  return s;
}

function toNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function normalizeArticleCreatePayload(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw expose(400, 'payload doit etre un objet');
  }

  const normalized = {
    department_id: normalizeUuidParam(payload.department_id),
    plu: toNullableString(payload.plu),
    designation: toNullableString(payload.designation),
    ean: toNullableString(payload.ean),
    unit: toNullableString(payload.unit) || DEFAULT_UNIT,
    article_category: assertArticleCategory(payload.article_category),
    is_active: payload.is_active === undefined ? true : Boolean(payload.is_active),
    family_code: toNullableString(payload.family_code),
    sector_code: toNullableString(payload.sector_code),
    category: toNullableString(payload.category),
    latin_name: toNullableString(payload.latin_name),
    fao_zone: toNullableString(payload.fao_zone),
    sous_zone: toNullableString(payload.sous_zone),
    engin: toNullableString(payload.engin),
    allergenes: toNullableString(payload.allergenes),
    display_name: toNullableString(payload.display_name),
    purchase_unit: toNullableString(payload.purchase_unit),
    stock_unit: toNullableString(payload.stock_unit),
    sale_unit: toNullableString(payload.sale_unit),
    vat_rate: toNullableNumber(payload.vat_rate) ?? DEFAULT_VAT_RATE,
    purchase_price_ex_vat: toNullableNumber(payload.purchase_price_ex_vat),
    sale_price_ex_vat: toNullableNumber(payload.sale_price_ex_vat),
    sale_price_inc_vat: toNullableNumber(payload.sale_price_inc_vat),
    storage: payload.storage && typeof payload.storage === 'object' && !Array.isArray(payload.storage)
      ? {
        storage_temperature_min: payload.storage.storage_temperature_min ?? null,
        storage_temperature_max: payload.storage.storage_temperature_max ?? null,
        storage_instruction: payload.storage.storage_instruction ?? null,
      }
      : normalizeStoragePayload(payload),
  };

  if (!normalized.plu || !normalized.designation) {
    throw expose(400, 'plu et designation sont obligatoires');
  }

  return normalized;
}

function normalizeAgentArticleCreatePayload(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw expose(400, 'payload doit etre un objet');
  }
  const unknownKeys = Object.keys(payload).filter((key) => !AGENT_ARTICLE_CREATE_FIELD_SET.has(key));
  if (unknownKeys.length) {
    throw expose(400, `Cle(s) payload non autorisee(s) pour articles.create : ${unknownKeys.join(', ')}`);
  }
  return normalizeArticleCreatePayload(payload);
}

async function assertDepartmentBelongsToStore(client, departmentId, storeId) {
  const result = await client.query(
    `
    SELECT id
    FROM departments
    WHERE id = $1
      AND store_id = $2
    LIMIT 1
    `,
    [departmentId, storeId]
  );
  return result.rows[0] || null;
}

async function resolveDefaultDepartmentId(client, storeId) {
  const result = await client.query(
    `
    SELECT id
    FROM departments
    WHERE store_id = $1
    ORDER BY created_at ASC
    LIMIT 1
    `,
    [storeId]
  );
  return result.rows[0]?.id || null;
}

async function getSectorId(client, departmentId, sectorCode) {
  const cleanCode = toNullableString(sectorCode);
  if (!cleanCode) return null;

  const result = await client.query(
    `
    SELECT id
    FROM department_sectors
    WHERE department_id = $1
      AND code = $2
      AND is_active = true
    LIMIT 1
    `,
    [departmentId, cleanCode]
  );
  return result.rows[0]?.id || null;
}

async function findObviousDuplicate(client, storeId, payload) {
  const checks = [];
  if (payload.plu) checks.push({ field: 'plu', value: payload.plu });
  if (payload.ean) checks.push({ field: 'ean', value: payload.ean });
  if (payload.designation) checks.push({ field: 'designation', value: payload.designation });

  for (const check of checks) {
    const result = await client.query(
      `
      SELECT id, plu, designation, ean, unit, article_category, is_active
      FROM articles
      WHERE store_id = $1
        AND lower(trim(COALESCE(${check.field}, ''))) = lower(trim($2))
      LIMIT 1
      `,
      [storeId, check.value]
    );
    if (result.rows[0]) return { match_field: check.field, article: result.rows[0] };
  }
  return null;
}

async function readCreatedArticle(client, storeId, articleId) {
  const result = await client.query(
    `
    SELECT
      a.id,
      a.store_id,
      a.plu,
      a.designation,
      a.ean,
      a.unit,
      COALESCE(a.article_category, 'product') AS article_category,
      a.is_active,
      a.source_origin,
      a.storage_temperature_min,
      a.storage_temperature_max,
      a.storage_instruction,
      ad.id AS article_department_id,
      ad.department_id,
      d.name AS department_name,
      ad.department_sector_id,
      ds.code AS family_code,
      ds.name AS family_name,
      ad.display_name,
      ad.purchase_unit,
      ad.stock_unit,
      ad.sale_unit,
      ad.vat_rate,
      ad.purchase_price_ex_vat,
      ad.sale_price_ex_vat,
      ad.sale_price_inc_vat,
      adm.category,
      adm.latin_name,
      adm.fao_zone,
      adm.sous_zone,
      adm.engin,
      adm.allergenes
    FROM articles a
    LEFT JOIN article_departments ad ON ad.article_id = a.id
    LEFT JOIN departments d ON d.id = ad.department_id
    LEFT JOIN department_sectors ds ON ds.id = ad.department_sector_id
    LEFT JOIN article_department_metadata adm
      ON adm.article_department_id = ad.id
     AND adm.field_key = 'business_metadata'
    WHERE a.id = $1
      AND a.store_id = $2
    LIMIT 1
    `,
    [articleId, storeId]
  );
  return result.rows[0] || null;
}

async function createArticle(client, { storeId, userId, payload, sourceOrigin = 'manual' }) {
  const normalized = normalizeArticleCreatePayload(payload);

  let departmentIdFinal = normalized.department_id;
  if (departmentIdFinal) {
    const department = await assertDepartmentBelongsToStore(client, departmentIdFinal, storeId);
    if (!department) throw expose(400, 'Service invalide pour ce client');
  } else {
    departmentIdFinal = await resolveDefaultDepartmentId(client, storeId);
    if (!departmentIdFinal) {
      throw expose(400, 'Aucun service disponible pour creer le rattachement article');
    }
  }

  const duplicate = await findObviousDuplicate(client, storeId, normalized);
  if (duplicate) {
    const error = expose(409, `Article existant detecte sur ${duplicate.match_field}`);
    error.duplicate = duplicate.article;
    throw error;
  }

  const selectedFamilyCode = normalized.family_code || normalized.sector_code;
  const sectorId = await getSectorId(client, departmentIdFinal, selectedFamilyCode);

  const articleInsert = await client.query(
    `
    INSERT INTO articles (
      store_id,
      plu,
      designation,
      ean,
      unit,
      article_category,
      is_active,
      source_origin,
      storage_temperature_min,
      storage_temperature_max,
      storage_instruction,
      created_by,
      updated_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
    RETURNING id
    `,
    [
      storeId,
      normalized.plu,
      normalized.designation,
      normalized.ean,
      normalized.unit,
      normalized.article_category,
      normalized.is_active,
      sourceOrigin,
      normalized.storage.storage_temperature_min,
      normalized.storage.storage_temperature_max,
      normalized.storage.storage_instruction,
      userId || null,
    ]
  );

  const articleId = articleInsert.rows[0].id;
  const articleDepartmentInsert = await client.query(
    `
    INSERT INTO article_departments (
      article_id,
      department_id,
      department_sector_id,
      display_name,
      purchase_unit,
      stock_unit,
      sale_unit,
      vat_rate,
      purchase_price_ex_vat,
      sale_price_ex_vat,
      sale_price_inc_vat,
      is_active,
      created_by,
      updated_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
    RETURNING id
    `,
    [
      articleId,
      departmentIdFinal,
      sectorId,
      normalized.display_name,
      normalized.purchase_unit,
      normalized.stock_unit,
      normalized.sale_unit,
      normalized.vat_rate,
      normalized.purchase_price_ex_vat,
      normalized.sale_price_ex_vat,
      normalized.sale_price_inc_vat,
      normalized.is_active,
      userId || null,
    ]
  );

  await client.query(
    `
    INSERT INTO article_department_metadata (
      article_department_id,
      field_key,
      category,
      latin_name,
      fao_zone,
      sous_zone,
      engin,
      allergenes,
      raw_source
    )
    VALUES ($1, 'business_metadata', $2, $3, $4, $5, $6, $7, '{}'::jsonb)
    `,
    [
      articleDepartmentInsert.rows[0].id,
      normalized.category,
      normalized.latin_name,
      normalized.fao_zone,
      normalized.sous_zone,
      normalized.engin,
      normalized.allergenes,
    ]
  );

  const article = await readCreatedArticle(client, storeId, articleId);
  if (!article) throw expose(409, 'Article cree mais relecture impossible');

  return {
    ok: true,
    id: articleId,
    article,
    defaults_applied: {
      unit: !toNullableString(payload.unit) ? DEFAULT_UNIT : null,
      vat_rate: toNullableNumber(payload.vat_rate) === null ? DEFAULT_VAT_RATE : null,
      is_active: payload.is_active === undefined ? true : null,
      article_category: !toNullableString(payload.article_category) ? 'product' : null,
    },
  };
}

async function executeAgentArticleCreate({ db, context, payload }) {
  const created = await createArticle(db, {
    storeId: context.store_id,
    userId: context.user_id,
    payload,
    sourceOrigin: 'agent_mcp',
  });

  return {
    ok: true,
    mode: 'executed',
    action: 'articles.create',
    module: 'articles',
    target_type: 'articles',
    target_id: created.id,
    article_id: created.id,
    article: created.article,
    defaults_applied: created.defaults_applied,
  };
}

module.exports = {
  AGENT_ARTICLE_CREATE_FIELDS,
  DEFAULT_UNIT,
  DEFAULT_VAT_RATE,
  createArticle,
  executeAgentArticleCreate,
  findObviousDuplicate,
  normalizeAgentArticleCreatePayload,
  normalizeArticleCreatePayload,
  readCreatedArticle,
};
