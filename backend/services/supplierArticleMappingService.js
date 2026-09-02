function expose(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function cleanBool(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return defaultValue;
}

function num(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed)) throw expose(400, 'Valeur numerique invalide');
  return parsed;
}

function normalizeSupplierDesignation(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[â€™']/g, ' ')
    .replace(/[^a-z0-9/.,]+/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPool(db) {
  return Boolean(db && typeof db.connect === 'function' && (
    typeof db.query !== 'function'
    || typeof db.totalCount === 'number'
    || typeof db.idleCount === 'number'
    || typeof db.waitingCount === 'number'
  ));
}

function isTransactionClient(db) {
  return Boolean(db && typeof db.query === 'function' && !isPool(db));
}

async function inTransaction(db, fn) {
  if (isTransactionClient(db)) return fn(db);
  if (!isPool(db)) throw expose(500, 'Connexion base indisponible');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function ensureSupplierArticleMappingsSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS supplier_article_mappings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      client_key text,
      supplier_id uuid NOT NULL REFERENCES suppliers(id),
      article_id uuid NOT NULL REFERENCES articles(id),
      supplier_ref text NOT NULL,
      supplier_label text,
      purchase_unit text DEFAULT 'kg',
      price_unit text DEFAULT 'kg',
      is_active boolean DEFAULT true,
      created_by uuid,
      updated_by uuid,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    )
  `);

  await client.query(`
    ALTER TABLE supplier_article_mappings
      ADD COLUMN IF NOT EXISTS client_key text,
      ADD COLUMN IF NOT EXISTS purchase_unit text DEFAULT 'kg',
      ADD COLUMN IF NOT EXISTS price_unit text DEFAULT 'kg',
      ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
      ADD COLUMN IF NOT EXISTS created_by uuid,
      ADD COLUMN IF NOT EXISTS updated_by uuid,
      ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
      ADD COLUMN IF NOT EXISTS supplier_designation_original text,
      ADD COLUMN IF NOT EXISTS supplier_designation_normalized text,
      ADD COLUMN IF NOT EXISTS mapping_source text NOT NULL DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS confidence_score numeric(5,2),
      ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
      ADD COLUMN IF NOT EXISTS usage_count integer NOT NULL DEFAULT 0
  `);

  await client.query(`
    UPDATE supplier_article_mappings
    SET supplier_designation_original = COALESCE(supplier_designation_original, supplier_label, supplier_ref),
        supplier_designation_normalized = COALESCE(
          supplier_designation_normalized,
          lower(regexp_replace(trim(COALESCE(supplier_label, supplier_ref, '')), '\\s+', ' ', 'g'))
        )
    WHERE supplier_designation_normalized IS NULL
  `);

  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'supplier_article_mappings'::regclass
          AND conname = 'supplier_article_mappings_supplier_id_supplier_ref_key'
      ) THEN
        ALTER TABLE supplier_article_mappings
          DROP CONSTRAINT supplier_article_mappings_supplier_id_supplier_ref_key;
      END IF;
    END $$;
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_article_mappings_store_supplier_ref_active
      ON supplier_article_mappings(store_id, supplier_id, supplier_ref)
      WHERE COALESCE(is_active, true) = true
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_article_mappings_store_supplier_normalized_active
      ON supplier_article_mappings(store_id, supplier_id, supplier_designation_normalized)
      WHERE COALESCE(is_active, true) = true
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_supplier_article_mappings_normalized
      ON supplier_article_mappings(store_id, supplier_id, supplier_designation_normalized)
  `);
}

function mappingSelectSql() {
  return `
    SELECT
      sam.*,
      s.code supplier_code,
      s.name supplier_name,
      a.plu article_plu,
      a.designation article_designation,
      a.designation article_name
    FROM supplier_article_mappings sam
    JOIN suppliers s ON s.id = sam.supplier_id AND s.store_id = sam.store_id
    JOIN articles a ON a.id = sam.article_id AND a.store_id = sam.store_id
  `;
}

async function assertStoreSupplier(client, storeId, supplierId) {
  const result = await client.query(
    'SELECT id, code, name FROM suppliers WHERE id = $1 AND store_id = $2 LIMIT 1',
    [supplierId, storeId]
  );
  if (!result.rows[0]) throw expose(404, 'Fournisseur introuvable');
  return result.rows[0];
}

async function resolveSupplier(client, storeId, input = {}) {
  const supplierId = clean(input.supplier_id);
  const supplierCode = clean(input.supplier_code);
  if (supplierId) return assertStoreSupplier(client, storeId, supplierId);
  if (!supplierCode) throw expose(400, 'Fournisseur obligatoire');

  const result = await client.query(
    'SELECT id, code, name FROM suppliers WHERE store_id = $1 AND (LOWER(code) = LOWER($2) OR name ILIKE $3) LIMIT 1',
    [storeId, supplierCode, `%${supplierCode}%`]
  );
  if (!result.rows[0]) throw expose(404, 'Fournisseur introuvable');
  return result.rows[0];
}

async function resolveArticle(client, storeId, input = {}) {
  const articleId = clean(input.article_id);
  const plu = clean(input.plu || input.article_plu);
  const result = articleId
    ? await client.query('SELECT id, plu, designation FROM articles WHERE id = $1 AND store_id = $2 LIMIT 1', [articleId, storeId])
    : await client.query('SELECT id, plu, designation FROM articles WHERE store_id = $1 AND plu = $2 LIMIT 1', [storeId, plu]);
  if (!result.rows[0]) throw expose(404, 'Article introuvable');
  return result.rows[0];
}

async function getMappingById(client, storeId, mappingId) {
  const result = await client.query(
    `${mappingSelectSql()} WHERE sam.store_id = $1 AND sam.id = $2 LIMIT 1`,
    [storeId, mappingId]
  );
  return result.rows[0] || null;
}

async function searchSupplierArticleMappings(db, storeId, input = {}) {
  const params = [storeId];
  const where = ['sam.store_id = $1'];

  if (clean(input.supplier_id)) {
    params.push(clean(input.supplier_id));
    where.push(`sam.supplier_id = $${params.length}`);
  }

  const includeInactive = input.include_inactive === true || input.status === 'all';
  if (!includeInactive) {
    if (input.status === 'inactive') {
      where.push('COALESCE(sam.is_active, true) = false');
    } else {
      where.push('COALESCE(sam.is_active, true) = true');
    }
  }

  if (clean(input.query)) {
    params.push(`%${clean(input.query)}%`);
    const idx = params.length;
    where.push(`(
      sam.supplier_ref ILIKE $${idx}
      OR COALESCE(sam.supplier_label, '') ILIKE $${idx}
      OR COALESCE(sam.supplier_designation_original, '') ILIKE $${idx}
      OR COALESCE(sam.supplier_designation_normalized, '') ILIKE $${idx}
      OR s.code ILIKE $${idx}
      OR s.name ILIKE $${idx}
      OR a.plu ILIKE $${idx}
      OR a.designation ILIKE $${idx}
    )`);
  }

  params.push(Math.min(Math.max(Number(input.limit) || 300, 1), 1000));
  const result = await db.query(
    `${mappingSelectSql()}
     WHERE ${where.join(' AND ')}
     ORDER BY s.name ASC, sam.supplier_ref ASC
     LIMIT $${params.length}`,
    params
  );
  return { results: result.rows };
}

async function findReusableMapping(client, storeId, supplierId, supplierRef, normalizedDesignation, excludeId = null) {
  const params = [storeId, supplierId, supplierRef, normalizedDesignation];
  let excludeSql = '';
  if (excludeId) {
    params.push(excludeId);
    excludeSql = `AND id <> $${params.length}`;
  }

  const result = await client.query(
    `SELECT id, COALESCE(is_active, true) is_active
     FROM supplier_article_mappings
     WHERE store_id = $1
       AND supplier_id = $2
       ${excludeSql}
       AND (
         ($3::text IS NOT NULL AND LOWER(TRIM(supplier_ref)) = LOWER(TRIM($3::text)))
         OR ($4::text IS NOT NULL AND supplier_designation_normalized = $4)
       )
     ORDER BY
       CASE
         WHEN $3::text IS NOT NULL AND LOWER(TRIM(supplier_ref)) = LOWER(TRIM($3::text)) THEN 0
         WHEN $4::text IS NOT NULL AND supplier_designation_normalized = $4 THEN 1
         ELSE 2
       END,
       COALESCE(is_active, true) DESC,
       updated_at DESC NULLS LAST,
       created_at DESC NULLS LAST
     LIMIT 1
     FOR UPDATE`,
    params
  );
  return result.rows[0] || null;
}

async function deactivateConflicts(client, storeId, supplierId, supplierRef, normalizedDesignation, keepId, userId) {
  await client.query(
    `UPDATE supplier_article_mappings
     SET is_active = false,
         updated_by = $6,
         updated_at = now()
     WHERE store_id = $1
       AND supplier_id = $2
       AND id <> $5
       AND COALESCE(is_active, true) = true
       AND (
         ($3::text IS NOT NULL AND LOWER(TRIM(supplier_ref)) = LOWER(TRIM($3::text)))
         OR ($4::text IS NOT NULL AND supplier_designation_normalized = $4)
       )`,
    [storeId, supplierId, supplierRef, normalizedDesignation, keepId, userId || null]
  );
}

async function upsertSupplierArticleMapping(db, storeId, input = {}, context = {}) {
  return inTransaction(db, async (client) => {
    await ensureSupplierArticleMappingsSchema(client);

    const supplier = await resolveSupplier(client, storeId, input);
    const article = await resolveArticle(client, storeId, input);
    const supplierRef = clean(input.supplier_ref || input.supplier_reference || input.supplier_designation_original);
    const supplierLabel = clean(input.supplier_label);
    const original = clean(input.supplier_designation_original || supplierLabel || supplierRef);
    if (!supplierRef || !original) throw expose(400, 'Reference fournisseur obligatoire');

    const normalized = normalizeSupplierDesignation(input.supplier_designation_normalized || original);
    const mappingSource = clean(input.mapping_source) || 'manual';
    const confidence = num(input.confidence_score, mappingSource === 'manual' ? 100 : null);
    const userId = context.user_id || context.userId || null;
    const clientKey = clean(context.client_key || input.client_key);

    const existing = await findReusableMapping(client, storeId, supplier.id, supplierRef, normalized);
    let mappingId = existing?.id || null;

    if (mappingId) {
      await client.query(
        `UPDATE supplier_article_mappings
         SET article_id = $3,
             supplier_ref = $4,
             supplier_label = $5,
             purchase_unit = $6,
             price_unit = $7,
             supplier_designation_original = $8,
             supplier_designation_normalized = $9,
             mapping_source = $10,
             confidence_score = $11,
             is_active = true,
             client_key = COALESCE($12, client_key),
             updated_by = $13,
             updated_at = now()
         WHERE id = $14
           AND store_id = $1
           AND supplier_id = $2`,
        [
          storeId,
          supplier.id,
          article.id,
          supplierRef,
          supplierLabel || original,
          clean(input.purchase_unit) || 'kg',
          clean(input.price_unit) || 'kg',
          original,
          normalized,
          mappingSource,
          confidence,
          clientKey,
          userId,
          mappingId,
        ]
      );
    } else {
      try {
        const inserted = await client.query(
          `INSERT INTO supplier_article_mappings (
            id, store_id, client_key, supplier_id, article_id, supplier_ref, supplier_label,
            purchase_unit, price_unit, supplier_designation_original, supplier_designation_normalized,
            mapping_source, confidence_score, is_active, created_by, updated_by
          )
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $13, $13)
          RETURNING id`,
          [
            storeId,
            clientKey,
            supplier.id,
            article.id,
            supplierRef,
            supplierLabel || original,
            clean(input.purchase_unit) || 'kg',
            clean(input.price_unit) || 'kg',
            original,
            normalized,
            mappingSource,
            confidence,
            userId,
          ]
        );
        mappingId = inserted.rows[0].id;
      } catch (error) {
        if (error.code !== '23505') throw error;
        const retry = await findReusableMapping(client, storeId, supplier.id, supplierRef, normalized);
        if (!retry) throw error;
        mappingId = retry.id;
      }
    }

    await deactivateConflicts(client, storeId, supplier.id, supplierRef, normalized, mappingId, userId);
    return getMappingById(client, storeId, mappingId);
  });
}

async function updateSupplierArticleMapping(db, storeId, mappingId, input = {}, context = {}) {
  return inTransaction(db, async (client) => {
    const current = await getMappingById(client, storeId, mappingId);
    if (!current) throw expose(404, 'Mapping introuvable');
    return upsertSupplierArticleMapping(client, storeId, {
      supplier_id: clean(input.supplier_id) || current.supplier_id,
      article_id: clean(input.article_id) || current.article_id,
      supplier_ref: clean(input.supplier_ref) || current.supplier_ref,
      supplier_label: input.supplier_label !== undefined ? clean(input.supplier_label) : current.supplier_label,
      purchase_unit: clean(input.purchase_unit) || current.purchase_unit || 'kg',
      price_unit: clean(input.price_unit) || current.price_unit || 'kg',
      supplier_designation_original: clean(input.supplier_designation_original) || current.supplier_designation_original || clean(input.supplier_label) || current.supplier_label || current.supplier_ref,
      supplier_designation_normalized: clean(input.supplier_designation_normalized) || current.supplier_designation_normalized,
      mapping_source: clean(input.mapping_source) || current.mapping_source || 'manual',
      confidence_score: input.confidence_score !== undefined ? input.confidence_score : current.confidence_score,
    }, context);
  });
}

async function setSupplierArticleMappingStatus(db, storeId, mappingId, isActive, context = {}) {
  return inTransaction(db, async (client) => {
    const result = await client.query(
      `UPDATE supplier_article_mappings
       SET is_active = $1,
           updated_by = $4,
           updated_at = now()
       WHERE id = $2
         AND store_id = $3
       RETURNING id`,
      [cleanBool(isActive, true), mappingId, storeId, context.user_id || context.userId || null]
    );
    if (!result.rows[0]) throw expose(404, 'Mapping introuvable');
    return getMappingById(client, storeId, mappingId);
  });
}

async function lookupSupplierArticleMapping(db, storeId, input = {}) {
  const supplierId = clean(input.supplier_id);
  const supplierRef = clean(input.supplier_ref || input.supplier_reference);
  const original = clean(input.supplier_designation_original || input.supplier_label || input.designation);
  const normalized = original ? normalizeSupplierDesignation(input.supplier_designation_normalized || original) : null;
  if (!supplierId || (!supplierRef && !normalized)) return null;

  const result = await db.query(
    `${mappingSelectSql()}
     WHERE sam.store_id = $1
       AND sam.supplier_id = $2
       AND COALESCE(sam.is_active, true) = true
       AND (
         ($3::text IS NOT NULL AND regexp_replace(UPPER(TRIM(COALESCE(sam.supplier_ref, ''))), '[^A-Z0-9]', '', 'g') = regexp_replace(UPPER(TRIM($3::text)), '[^A-Z0-9]', '', 'g'))
         OR ($4::text IS NOT NULL AND sam.supplier_designation_normalized = $4)
       )
     ORDER BY
       CASE
         WHEN $3::text IS NOT NULL AND regexp_replace(UPPER(TRIM(COALESCE(sam.supplier_ref, ''))), '[^A-Z0-9]', '', 'g') = regexp_replace(UPPER(TRIM($3::text)), '[^A-Z0-9]', '', 'g') THEN 0
         WHEN $4::text IS NOT NULL AND sam.supplier_designation_normalized = $4 THEN 1
         ELSE 2
       END,
       sam.updated_at DESC NULLS LAST,
       sam.created_at DESC NULLS LAST
     LIMIT 1`,
    [storeId, supplierId, supplierRef, normalized]
  );

  return result.rows[0] || null;
}

module.exports = {
  clean,
  cleanBool,
  expose,
  normalizeSupplierDesignation,
  ensureSupplierArticleMappingsSchema,
  getMappingById,
  searchSupplierArticleMappings,
  upsertSupplierArticleMapping,
  updateSupplierArticleMapping,
  setSupplierArticleMappingStatus,
  lookupSupplierArticleMapping,
};
