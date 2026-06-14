const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');

const router = express.Router();

const SAM_TABLE = 'supplier_article_mappings';
const ARTICLE_TABLE = 'articles';
const SUPPLIER_TABLE = 'suppliers';

const SAM_PLU_COLUMNS = ['article_plu', 'plu', 'matched_plu'];
const SAM_EAN_COLUMNS = ['article_ean', 'ean', 'matched_ean'];
const SAM_DESIGNATION_COLUMNS = ['article_designation', 'designation', 'matched_designation'];
const SUPPLIER_NAME_COLUMNS = ['name', 'legal_name', 'code'];

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function firstExistingColumn(columns, candidates) {
  return candidates.find((column) => columns.includes(column)) || null;
}

function buildTextExpression(alias, columns, candidates) {
  const existing = candidates.filter((column) => columns.includes(column));
  if (existing.length === 0) return 'NULL::text';
  return `COALESCE(${existing.map((column) => `${alias}.${quoteIdentifier(column)}::text`).join(', ')})`;
}

function buildSupplierNameExpression(columns) {
  const existing = SUPPLIER_NAME_COLUMNS.filter((column) => columns.includes(column));
  if (existing.length === 0) return 's.id::text';
  return `COALESCE(${existing.map((column) => `s.${quoteIdentifier(column)}::text`).join(', ')}, s.id::text)`;
}

function normalizeIdentifierExpression(expression) {
  return `LOWER(REGEXP_REPLACE(TRIM(COALESCE(${expression}, '')), '\\s+', ' ', 'g'))`;
}

async function tableColumns(client, tableName) {
  const result = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [tableName]
  );
  return result.rows.map((row) => row.column_name);
}

function assertRequiredColumns(columns, tableName, requiredColumns) {
  const missing = requiredColumns.filter((column) => !columns.includes(column));
  if (missing.length > 0) {
    const error = new Error(`Colonnes manquantes dans ${tableName}: ${missing.join(', ')}`);
    error.status = 500;
    throw error;
  }
}

function buildRepairSql(columns) {
  const samColumns = columns.sam;
  const articleColumns = columns.articles;
  const supplierColumns = columns.suppliers;

  assertRequiredColumns(samColumns, SAM_TABLE, ['id', 'store_id', 'article_id', 'supplier_id']);
  assertRequiredColumns(articleColumns, ARTICLE_TABLE, ['id', 'store_id']);

  const articlePluColumn = firstExistingColumn(articleColumns, ['plu']);
  const articleEanColumn = firstExistingColumn(articleColumns, ['ean']);
  const articleDesignationColumn = firstExistingColumn(articleColumns, ['designation', 'display_name']);
  const articleActiveExpression = articleColumns.includes('is_active') ? 'COALESCE(a.is_active, true) = true' : 'true';
  const supplierNameExpression = buildSupplierNameExpression(supplierColumns);

  const samPluExpression = buildTextExpression('sam', samColumns, SAM_PLU_COLUMNS);
  const samEanExpression = buildTextExpression('sam', samColumns, SAM_EAN_COLUMNS);
  const samDesignationExpression = buildTextExpression('sam', samColumns, SAM_DESIGNATION_COLUMNS);

  const matchBranches = [];

  if (articlePluColumn) {
    matchBranches.push(`
      SELECT
        sam.id mapping_id,
        'plu' match_method,
        a.id article_id,
        a.plu article_plu,
        a.designation article_designation,
        1 priority
      FROM orphan_mappings sam
      JOIN ${ARTICLE_TABLE} a
        ON a.store_id = sam.store_id
       AND ${articleActiveExpression}
       AND NULLIF(${samPluExpression}, '') IS NOT NULL
       AND ${normalizeIdentifierExpression(`a.${quoteIdentifier(articlePluColumn)}::text`)} = ${normalizeIdentifierExpression(samPluExpression)}
    `);
  }

  if (articleEanColumn) {
    matchBranches.push(`
      SELECT
        sam.id mapping_id,
        'ean' match_method,
        a.id article_id,
        a.plu article_plu,
        a.designation article_designation,
        2 priority
      FROM orphan_mappings sam
      JOIN ${ARTICLE_TABLE} a
        ON a.store_id = sam.store_id
       AND ${articleActiveExpression}
       AND NULLIF(${samEanExpression}, '') IS NOT NULL
       AND ${normalizeIdentifierExpression(`a.${quoteIdentifier(articleEanColumn)}::text`)} = ${normalizeIdentifierExpression(samEanExpression)}
    `);
  }

  if (articleDesignationColumn) {
    matchBranches.push(`
      SELECT
        sam.id mapping_id,
        'designation' match_method,
        a.id article_id,
        a.plu article_plu,
        a.designation article_designation,
        3 priority
      FROM orphan_mappings sam
      JOIN ${ARTICLE_TABLE} a
        ON a.store_id = sam.store_id
       AND ${articleActiveExpression}
       AND NULLIF(${samDesignationExpression}, '') IS NOT NULL
       AND ${normalizeIdentifierExpression(`a.${quoteIdentifier(articleDesignationColumn)}::text`)} = ${normalizeIdentifierExpression(samDesignationExpression)}
    `);
  }

  const allMatchesSql = matchBranches.length > 0 ? matchBranches.join('\nUNION ALL\n') : `
      SELECT
        NULL::uuid mapping_id,
        NULL::text match_method,
        NULL::uuid article_id,
        NULL::text article_plu,
        NULL::text article_designation,
        NULL::int priority
      WHERE false
    `;

  const updatedAtSet = samColumns.includes('updated_at') ? ', updated_at = NOW()' : '';
  const updatedBySet = samColumns.includes('updated_by') ? ', updated_by = $2' : '';

  return {
    supplierNameExpression,
    samPluExpression,
    samEanExpression,
    samDesignationExpression,
    updatedAtSet,
    updatedBySet,
    cte: `
      WITH orphan_mappings AS (
        SELECT sam.*
        FROM ${SAM_TABLE} sam
        LEFT JOIN ${ARTICLE_TABLE} current_article
          ON current_article.id = sam.article_id
         AND current_article.store_id = sam.store_id
        WHERE sam.store_id = $1
          AND current_article.id IS NULL
      ),
      all_matches AS (
        ${allMatchesSql}
      ),
      ranked_matches AS (
        SELECT
          mapping_id,
          match_method,
          article_id,
          article_plu,
          article_designation,
          priority,
          COUNT(*) OVER (PARTITION BY mapping_id, priority) candidate_count,
          ROW_NUMBER() OVER (PARTITION BY mapping_id ORDER BY priority ASC) priority_rank
        FROM all_matches
      ),
      unique_matches AS (
        SELECT mapping_id, match_method, article_id, article_plu, article_designation, priority
        FROM ranked_matches
        WHERE candidate_count = 1
          AND priority_rank = 1
      )
    `,
  };
}

async function getColumns(client) {
  const [sam, articles, suppliers] = await Promise.all([
    tableColumns(client, SAM_TABLE),
    tableColumns(client, ARTICLE_TABLE),
    tableColumns(client, SUPPLIER_TABLE),
  ]);

  return { sam, articles, suppliers };
}

async function buildDiagnostic(client, storeId) {
  const columns = await getColumns(client);
  const sqlParts = buildRepairSql(columns);

  const counts = await client.query(
    `
    ${sqlParts.cte}
    SELECT
      (SELECT COUNT(*)::int FROM ${SAM_TABLE} WHERE store_id = $1) total_mappings,
      (
        SELECT COUNT(*)::int
        FROM ${SAM_TABLE} sam
        JOIN ${ARTICLE_TABLE} a ON a.id = sam.article_id AND a.store_id = sam.store_id
        WHERE sam.store_id = $1
      ) valid_mappings,
      (SELECT COUNT(*)::int FROM orphan_mappings) orphan_mappings,
      (SELECT COUNT(*)::int FROM unique_matches) repairable_mappings,
      (
        SELECT COUNT(*)::int
        FROM orphan_mappings om
        LEFT JOIN unique_matches um ON um.mapping_id = om.id
        WHERE um.mapping_id IS NULL
      ) non_repairable_mappings
    `,
    [storeId]
  );

  const suppliers = await client.query(
    `
    ${sqlParts.cte}
    SELECT
      sam.supplier_id,
      ${sqlParts.supplierNameExpression} supplier_name,
      COUNT(*)::int orphan_mappings,
      COUNT(um.mapping_id)::int repairable_mappings,
      (COUNT(*) - COUNT(um.mapping_id))::int non_repairable_mappings
    FROM orphan_mappings sam
    LEFT JOIN unique_matches um ON um.mapping_id = sam.id
    LEFT JOIN ${SUPPLIER_TABLE} s ON s.id = sam.supplier_id AND s.store_id = sam.store_id
    GROUP BY sam.supplier_id, ${sqlParts.supplierNameExpression}
    ORDER BY orphan_mappings DESC, supplier_name ASC
    `,
    [storeId]
  );

  const methods = await client.query(
    `
    ${sqlParts.cte}
    SELECT match_method, COUNT(*)::int count
    FROM unique_matches
    GROUP BY match_method
    ORDER BY MIN(priority) ASC
    `,
    [storeId]
  );

  const sample = await client.query(
    `
    ${sqlParts.cte}
    SELECT
      sam.id mapping_id,
      sam.supplier_id,
      ${sqlParts.supplierNameExpression} supplier_name,
      ${sqlParts.samPluExpression} mapping_plu,
      ${sqlParts.samEanExpression} mapping_ean,
      ${sqlParts.samDesignationExpression} mapping_designation,
      um.match_method,
      um.article_id suggested_article_id,
      um.article_plu suggested_article_plu,
      um.article_designation suggested_article_designation,
      (um.mapping_id IS NOT NULL) repairable
    FROM orphan_mappings sam
    LEFT JOIN unique_matches um ON um.mapping_id = sam.id
    LEFT JOIN ${SUPPLIER_TABLE} s ON s.id = sam.supplier_id AND s.store_id = sam.store_id
    ORDER BY repairable DESC, supplier_name ASC
    LIMIT 100
    `,
    [storeId]
  );

  return {
    ...counts.rows[0],
    suppliers: suppliers.rows,
    repair_methods: methods.rows,
    sample_mappings: sample.rows,
    available_mapping_columns: {
      plu: SAM_PLU_COLUMNS.filter((column) => columns.sam.includes(column)),
      ean: SAM_EAN_COLUMNS.filter((column) => columns.sam.includes(column)),
      designation: SAM_DESIGNATION_COLUMNS.filter((column) => columns.sam.includes(column)),
    },
  };
}

router.get('/supplier-article-mappings/diagnostic', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const diagnostic = await buildDiagnostic(req.dbPool, req.user.store_id);
    res.json(diagnostic);
  } catch (error) {
    console.error('Erreur diagnostic AF_MAP :', error);
    res.status(error.status || 500).json({ error: error.message || 'Erreur diagnostic AF_MAP' });
  }
});

router.get('/supplier-article-mappings/rematch-preview', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const diagnostic = await buildDiagnostic(req.dbPool, req.user.store_id);
    res.json({
      repairable_mappings: diagnostic.repairable_mappings,
      non_repairable_mappings: diagnostic.non_repairable_mappings,
      repair_methods: diagnostic.repair_methods,
      sample_mappings: diagnostic.sample_mappings,
    });
  } catch (error) {
    console.error('Erreur aperçu rematch AF_MAP :', error);
    res.status(error.status || 500).json({ error: error.message || 'Erreur aperçu rematch AF_MAP' });
  }
});

router.post(
  '/supplier-article-mappings/rematch',
  authenticateToken,
  attachDbContext,
  requireAdminOrManager,
  async (req, res) => {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ error: 'Confirmation obligatoire avant correction AF_MAP' });
    }

    const client = await req.dbPool.connect();
    try {
      await client.query('BEGIN');

      const columns = await getColumns(client);
      const sqlParts = buildRepairSql(columns);
      const params = columns.sam.includes('updated_by') ? [req.user.store_id, req.user.id] : [req.user.store_id];
      const result = await client.query(
        `
        ${sqlParts.cte},
        updated_mappings AS (
          UPDATE ${SAM_TABLE} sam
          SET article_id = um.article_id
              ${sqlParts.updatedAtSet}
              ${sqlParts.updatedBySet}
          FROM unique_matches um
          WHERE sam.id = um.mapping_id
            AND sam.store_id = $1
          RETURNING sam.id, sam.supplier_id, sam.article_id, um.match_method
        )
        SELECT
          COUNT(*)::int repaired_mappings,
          COUNT(*) FILTER (WHERE match_method = 'plu')::int repaired_by_plu,
          COUNT(*) FILTER (WHERE match_method = 'ean')::int repaired_by_ean,
          COUNT(*) FILTER (WHERE match_method = 'designation')::int repaired_by_designation
        FROM updated_mappings
        `,
        params
      );

      await client.query('COMMIT');

      res.json({
        ok: true,
        ...result.rows[0],
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Erreur rematch AF_MAP :', error);
      res.status(error.status || 500).json({ error: error.message || 'Erreur rematch AF_MAP' });
    } finally {
      client.release();
    }
  }
);

module.exports = router;