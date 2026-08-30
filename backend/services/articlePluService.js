const PRODUCT_PLU_MIN = 3000;
const PRODUCT_PLU_MAX = 3999;
const ARTICLE_PLU_UNIQUE_CONSTRAINT = 'uq_articles_store_plu';

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

function decoratePluConflict(error, nextPlu) {
  error.status = error.status || 409;
  error.next_plu = nextPlu || null;
  error.nextPlu = nextPlu || null;
  return error;
}

async function getNextProductPlu(client, storeId) {
  const result = await client.query(
    `
    WITH product_plu AS (
      SELECT a.plu::integer AS plu_number
      FROM articles a
      WHERE a.store_id = $1
        AND COALESCE(a.article_category, 'product') = 'product'
        AND a.plu ~ '^[0-9]+$'
        AND a.plu::integer BETWEEN $2 AND $3
    ),
    bounds AS (
      SELECT GREATEST(COALESCE(MAX(plu_number), $2 - 1) + 1, $2) AS start_number
      FROM product_plu
    )
    SELECT candidate.plu_number::text AS plu
    FROM bounds
    CROSS JOIN generate_series(bounds.start_number, $3) AS candidate(plu_number)
    WHERE NOT EXISTS (
      SELECT 1
      FROM articles existing
      WHERE existing.store_id = $1
        AND existing.plu = candidate.plu_number::text
    )
    ORDER BY candidate.plu_number ASC
    LIMIT 1
    `,
    [storeId, PRODUCT_PLU_MIN, PRODUCT_PLU_MAX]
  );

  return result.rows[0]?.plu || null;
}

async function assertPluAvailable(client, storeId, plu, options = {}) {
  const normalizedPlu = clean(plu);
  if (!normalizedPlu) return;

  const params = [storeId, normalizedPlu];
  let excludeFilter = '';
  if (options.excludeArticleId) {
    params.push(options.excludeArticleId);
    excludeFilter = `AND id <> $${params.length}`;
  }

  const result = await client.query(
    `
    SELECT id, plu, designation, ean, unit, article_category, is_active
    FROM articles
    WHERE store_id = $1
      AND plu = $2
      ${excludeFilter}
    LIMIT 1
    `,
    params
  );

  if (result.rows[0]) {
    const nextPlu = await getNextProductPlu(client, storeId);
    const error = expose(409, `PLU ${normalizedPlu} déjà utilisé`);
    error.duplicate = result.rows[0];
    decoratePluConflict(error, nextPlu);
    throw error;
  }
}

async function enrichPgUniquePluError(client, storeId, error) {
  if (error?.code !== '23505' || error.constraint !== ARTICLE_PLU_UNIQUE_CONSTRAINT) {
    return error;
  }

  const nextPlu = await getNextProductPlu(client, storeId).catch(() => null);
  const conflict = expose(409, 'PLU déjà utilisé');
  conflict.cause = error;
  decoratePluConflict(conflict, nextPlu);
  return conflict;
}

module.exports = {
  ARTICLE_PLU_UNIQUE_CONSTRAINT,
  PRODUCT_PLU_MAX,
  PRODUCT_PLU_MIN,
  assertPluAvailable,
  decoratePluConflict,
  enrichPgUniquePluError,
  getNextProductPlu,
};
