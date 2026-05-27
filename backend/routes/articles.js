const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager, requireAdmin } = require('../middleware/authorization');
const { normalizeBool, toNullableString } = require('../utils/valueHelpers');
const { assertDepartmentBelongsToStore } = require('../utils/departmentHelpers');

// GET /api/articles - List articles with filters
router.get('/', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const {
      search = '',
      sector = '',
      active = '',
      department_id = '',
      limit = '200',
      offset = '0',
    } = req.query;

    const activeValue = normalizeBool(active);
    const safeLimit = Math.min(Number(limit) || 200, 500);
    const safeOffset = Number(offset) || 0;

    const params = [req.user.store_id];
    let where = `WHERE a.store_id = $1`;

    if (department_id) {
      params.push(department_id);
      where += ` AND ad.department_id = $${params.length}`;
    }

    if (sector) {
      params.push(sector);
      where += ` AND ds.code = $${params.length}`;
    }

    if (activeValue !== null) {
      params.push(activeValue);
      where += ` AND a.is_active = $${params.length}`;
    }

    if (search && String(search).trim() !== '') {
      params.push(`%${String(search).trim()}%`);
      const idx = params.length;
      where += ` AND (
        a.plu ILIKE $${idx}
        OR a.designation ILIKE $${idx}
        OR COALESCE(ad.display_name, '') ILIKE $${idx}
        OR COALESCE(adm.latin_name, '') ILIKE $${idx}
      )`;
    }

    params.push(safeLimit);
    params.push(safeOffset);

    const result = await req.dbPool.query(
      `
      SELECT
        a.id,
        a.store_id,
        a.plu,
        a.designation,
        a.unit,
        a.ean,
        a.is_active,
        a.source_origin,
        a.source_id,

        ad.id AS article_department_id,
        ad.department_id,
        d.name AS department_name,
        ad.display_name,
        ad.purchase_unit,
        ad.stock_unit,
        ad.sale_unit,
        ad.department_sector_id,

        ds.code AS sector_code,
        ds.name AS sector_name,

        COALESCE(adm.category, NULL) AS category,
COALESCE(adm.latin_name, NULL) AS latin_name,
COALESCE(adm.fao_zone, NULL) AS fao_zone,
COALESCE(adm.sous_zone, NULL) AS sous_zone,
COALESCE(adm.engin, NULL) AS engin,
COALESCE(adm.allergenes, NULL) AS allergenes,
COALESCE(adm.raw_source, '{}'::jsonb) AS raw_source

      FROM articles a
JOIN article_departments ad ON ad.article_id = a.id
JOIN departments d ON d.id = ad.department_id
LEFT JOIN department_sectors ds ON ds.id = ad.department_sector_id
LEFT JOIN article_department_metadata adm
        ON adm.article_department_id = ad.id
       AND adm.field_key IN ('v2_import', 'business_metadata')
      ${where}
      ORDER BY a.designation ASC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/articles :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/articles - Create new article
router.post('/', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const {
      department_id,
      plu,
      designation,
      unit,
      ean,
      is_active = true,
      sector_code,
      category,
      latin_name,
      fao_zone,
      sous_zone,
      engin,
      allergenes,
      display_name,
      purchase_unit,
      stock_unit,
      sale_unit,
    } = req.body;

    if (!department_id || !plu || !designation) {
      return res.status(400).json({ error: 'department_id, plu et designation sont obligatoires' });
    }

    await client.query('BEGIN');

    const department = await assertDepartmentBelongsToStore(client, department_id, req.user.store_id);

    if (!department) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Rayon invalide pour ce magasin' });
    }

    let sectorId = null;
    if (sector_code) {
      const sectorResult = await client.query(
        `
        SELECT id
        FROM department_sectors
        WHERE department_id = $1
          AND code = $2
        LIMIT 1
        `,
        [department_id, sector_code]
      );
      sectorId = sectorResult.rows[0]?.id || null;
    }

    const articleInsert = await client.query(
      `
      INSERT INTO articles (
        id,
        store_id,
        plu,
        designation,
        unit,
        ean,
        is_active,
        source_origin
      )
      VALUES (
        gen_random_uuid(),
        $1, $2, $3, $4, $5, $6, 'manual'
      )
      RETURNING id
      `,
      [
        req.user.store_id,
        toNullableString(plu),
        toNullableString(designation),
        toNullableString(unit) || 'kg',
        toNullableString(ean),
        !!is_active,
      ]
    );

    const articleId = articleInsert.rows[0].id;

    const articleDepartmentInsert = await client.query(
      `
      INSERT INTO article_departments (
        id,
        article_id,
        department_id,
        display_name,
        purchase_unit,
        stock_unit,
        sale_unit,
        is_active,
        department_sector_id
      )
      VALUES (
        gen_random_uuid(),
        $1, $2, $3, $4, $5, $6, $7, $8
      )
      RETURNING id
      `,
      [
        articleId,
        department_id,
        toNullableString(display_name),
        toNullableString(purchase_unit),
        toNullableString(stock_unit),
        toNullableString(sale_unit),
        !!is_active,
        sectorId,
      ]
    );

    const articleDepartmentId = articleDepartmentInsert.rows[0].id;

    await client.query(
      `
      INSERT INTO article_department_metadata (
        id,
        article_department_id,
        field_key,
        field_value,
        category,
        latin_name,
        fao_zone,
        sous_zone,
        engin,
        allergenes,
        raw_source
      )
      VALUES (
        gen_random_uuid(),
        $1,
        'v2_import',
        NULL,
        $2, $3, $4, $5, $6, $7, '{}'::jsonb
      )
      `,
      [
        articleDepartmentId,
        toNullableString(category),
        toNullableString(latin_name),
        toNullableString(fao_zone),
        toNullableString(sous_zone),
        toNullableString(engin),
        toNullableString(allergenes),
      ]
    );

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      message: 'Article créé avec succès',
      id: articleId,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/articles :', err);

    if (err.code === '23505') {
      return res.status(400).json({ error: 'PLU déjà existant pour ce magasin' });
    }

    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// GET /api/articles/search - Search articles by name/plu/display_name
router.get('/search', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const { q = '', department_id = '' } = req.query;
    const searchTerm = String(q).trim();

    if (!searchTerm || searchTerm.length === 0) {
      return res.json([]);
    }

    if (!department_id) {
      return res.status(400).json({ error: 'department_id is required' });
    }

    const likePattern = `%${searchTerm}%`;
    const startsWithPattern = `${searchTerm}%`;

    const result = await req.dbPool.query(
      `
      SELECT
        a.id,
        a.plu,
        a.designation,
        ad.display_name,
        a.unit
      FROM articles a
      JOIN article_departments ad ON ad.article_id = a.id
      WHERE a.store_id = $1
        AND ad.department_id = $2
        AND a.is_active = true
        AND (
          a.plu ILIKE $3
          OR a.designation ILIKE $3
          OR COALESCE(ad.display_name, '') ILIKE $3
        )
      ORDER BY
        -- Match exact PLU d'abord
        CASE WHEN a.plu = $4 THEN 0 ELSE 1 END,
        -- PLU commence par la recherche
        CASE WHEN a.plu ILIKE $5 THEN 0 ELSE 1 END,
        -- Ensuite designation alphabétique
        a.designation ASC
      LIMIT 50
      `,
      [req.user.store_id, department_id, likePattern, searchTerm, startsWithPattern]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/articles/search :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/articles/search-in-stock - Search articles with stock
router.get('/search-in-stock', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const { q = '', department_id = '' } = req.query;
    const searchTerm = String(q).trim();

    if (!department_id) {
      return res.status(400).json({ error: 'department_id is required' });
    }

    const params = [req.user.store_id, department_id];
    let where = `
      WHERE ss.store_id = $1
        AND ss.department_id = $2
        AND ss.stock_quantity > 0
    `;

    if (searchTerm) {
      params.push(`%${searchTerm}%`);
      const idx = params.length;

      params.push(`${searchTerm}%`);
      const startsIdx = params.length;

      params.push(searchTerm);
      const exactIdx = params.length;

      const result = await req.dbPool.query(
        `
        SELECT
          a.id,
          a.plu,
          a.designation,
          ad.display_name,
          a.unit,
          ss.stock_quantity
        FROM stock_summary ss
        JOIN articles a ON a.id = ss.article_id
        LEFT JOIN article_departments ad
          ON ad.article_id = a.id
         AND ad.department_id = ss.department_id
        ${where}
          AND (
            a.plu ILIKE $${idx}
            OR a.designation ILIKE $${idx}
            OR COALESCE(ad.display_name, '') ILIKE $${idx}
          )
        ORDER BY
          CASE WHEN a.plu = $${exactIdx} THEN 0 ELSE 1 END,
          CASE WHEN a.plu ILIKE $${startsIdx} THEN 0 ELSE 1 END,
          a.designation ASC
        LIMIT 50
        `,
        params
      );

      return res.json(result.rows);
    }

    const result = await req.dbPool.query(
      `
      SELECT
        a.id,
        a.plu,
        a.designation,
        ad.display_name,
        a.unit,
        ss.stock_quantity
      FROM stock_summary ss
      JOIN articles a ON a.id = ss.article_id
      LEFT JOIN article_departments ad
        ON ad.article_id = a.id
       AND ad.department_id = ss.department_id
      ${where}
      ORDER BY a.designation ASC
      LIMIT 50
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/articles/search-in-stock :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/articles/:id/status - Update article active status
router.patch('/:id/status', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const articleId = req.params.id;
    const { is_active } = req.body;

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active doit être un booléen' });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `
      UPDATE articles
      SET is_active = $1
      WHERE id = $2
        AND store_id = $3
      RETURNING id
      `,
      [is_active, articleId, req.user.store_id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Article introuvable' });
    }

    await client.query(
      `
      UPDATE article_departments
      SET is_active = $1
      WHERE article_id = $2
      `,
      [is_active, articleId]
    );

    await client.query('COMMIT');

    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur PATCH /api/articles/:id/status :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// POST /api/articles/:id/duplicate - Duplicate an article
router.post('/:id/duplicate', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const sourceArticleId = req.params.id;
    const { new_plu, new_designation, new_ean } = req.body;

    if (!new_plu || !new_designation) {
      return res.status(400).json({ error: 'new_plu et new_designation sont obligatoires' });
    }

    const sourceResult = await client.query(
      `
      SELECT
        a.unit,
        a.is_active,
        ad.department_id,
        ad.display_name,
        ad.purchase_unit,
        ad.stock_unit,
        ad.sale_unit,
        ad.department_sector_id,
        adm.category,
        adm.latin_name,
        adm.fao_zone,
        adm.sous_zone,
        adm.engin,
        adm.allergenes
      FROM articles a
      JOIN article_departments ad ON ad.article_id = a.id
      LEFT JOIN article_department_metadata adm
        ON adm.article_department_id = ad.id
       AND adm.field_key IN ('v2_import', 'business_metadata')
      WHERE a.id = $1
        AND a.store_id = $2
      LIMIT 1
      `,
      [sourceArticleId, req.user.store_id]
    );

    if (sourceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Article source introuvable' });
    }

    const source = sourceResult.rows[0];

    await client.query('BEGIN');

    const articleInsert = await client.query(
      `
      INSERT INTO articles (
        id, store_id, plu, designation, unit, ean, is_active, source_origin
      )
      VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'duplicate'
      )
      RETURNING id
      `,
      [
        req.user.store_id,
        toNullableString(new_plu),
        toNullableString(new_designation),
        source.unit || 'kg',
        toNullableString(new_ean),
        source.is_active,
      ]
    );

    const newArticleId = articleInsert.rows[0].id;

    const adInsert = await client.query(
      `
      INSERT INTO article_departments (
        id, article_id, department_id, display_name,
        purchase_unit, stock_unit, sale_unit, is_active, department_sector_id
      )
      VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8
      )
      RETURNING id
      `,
      [
        newArticleId,
        source.department_id,
        source.display_name,
        source.purchase_unit,
        source.stock_unit,
        source.sale_unit,
        source.is_active,
        source.department_sector_id,
      ]
    );

    const newArticleDepartmentId = adInsert.rows[0].id;

    await client.query(
      `
      INSERT INTO article_department_metadata (
        id,
        article_department_id,
        field_key,
        field_value,
        category,
        latin_name,
        fao_zone,
        sous_zone,
        engin,
        allergenes,
        raw_source
      )
      VALUES (
        gen_random_uuid(),
        $1,
        'v2_import',
        NULL,
        $2, $3, $4, $5, $6, $7, '{}'::jsonb
      )
      `,
      [
        newArticleDepartmentId,
        source.category,
        source.latin_name,
        source.fao_zone,
        source.sous_zone,
        source.engin,
        source.allergenes,
      ]
    );

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      message: 'Article dupliqué avec succès',
      id: newArticleId,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/articles/:id/duplicate :', err);

    if (err.code === '23505') {
      return res.status(400).json({ error: 'Le nouveau PLU existe déjà' });
    }

    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// GET /api/articles/:articleId/lots-available - Get available lots for an article
router.get('/:articleId/lots-available', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const articleId = req.params.articleId;
    const { department_id = '' } = req.query;

    if (!department_id) {
      return res.status(400).json({ error: 'department_id obligatoire' });
    }

    const articleCheck = await req.dbPool.query(
      `
      SELECT id, plu, designation
      FROM articles
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [articleId, req.user.store_id]
    );

    if (articleCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Article introuvable' });
    }

    const result = await req.dbPool.query(
      `
      SELECT
        l.id AS lot_id,
        l.lot_code,
        l.qty_initial,
        l.qty_remaining,
        l.unit_cost_ex_vat,
        l.dlc,
        l.created_at,
        l.source_type,
        l.traceability_data,
        s.name AS supplier_name
      FROM lots l
      LEFT JOIN suppliers s ON s.id = l.supplier_id
      WHERE l.store_id = $1
        AND l.department_id = $2
        AND l.article_id = $3
        AND l.qty_remaining > 0
      ORDER BY l.created_at ASC, l.id ASC
      `,
      [req.user.store_id, department_id, articleId]
    );

    res.json({
      article: articleCheck.rows[0],
      lots: result.rows.map((row) => ({
        ...row,
        qty_initial: Number(row.qty_initial || 0),
        qty_remaining: Number(row.qty_remaining || 0),
        unit_cost_ex_vat: Number(row.unit_cost_ex_vat || 0),
      })),
    });
  } catch (err) {
    console.error('Erreur GET /api/articles/:articleId/lots-available :', err);
    res.status(500).json({ error: 'Erreur chargement lots disponibles' });
  }
});

// GET /api/articles/:id - Get article detail
router.get('/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const requestedDepartmentId = req.query.department_id || null;
    const result = await req.dbPool.query(
      `
      SELECT
        a.id,
        a.store_id,
        a.plu,
        a.designation,
        a.unit,
        a.ean,
        a.is_active,
        a.source_origin,
        a.source_id,

        ad.id AS article_department_id,
        ad.department_id,
        ad.display_name,
        d.name AS department_name,
        ad.purchase_unit,
        ad.stock_unit,
        ad.sale_unit,
        ad.department_sector_id,

        ds.code AS sector_code,
        ds.name AS sector_name,

        adm.category,
        adm.latin_name,
        adm.fao_zone,
        adm.sous_zone,
        adm.engin,
        adm.allergenes,
        adm.raw_source

      FROM articles a
      JOIN article_departments ad ON ad.article_id = a.id
      JOIN departments d ON d.id = ad.department_id  -- 👈 AJOUT
      LEFT JOIN department_sectors ds ON ds.id = ad.department_sector_id
      LEFT JOIN article_department_metadata adm
        ON adm.article_department_id = ad.id
       AND adm.field_key IN ('v2_import', 'business_metadata')
      WHERE a.id = $1
  AND a.store_id = $2
  AND ($3::uuid IS NULL OR ad.department_id = $3::uuid)
LIMIT 1
      `,
      [req.params.id, req.user.store_id, requestedDepartmentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Article introuvable' });
    }

    const article = result.rows[0];

let stockArticleId = article.id;

const directStockCheck = await req.dbPool.query(
  `
  SELECT 1
  FROM stock_summary
  WHERE store_id = $1
    AND department_id = $2
    AND article_id = $3
  LIMIT 1
  `,
  [req.user.store_id, article.department_id, stockArticleId]
);

if (directStockCheck.rows.length === 0 && article.plu) {
  const fallbackStockArticle = await req.dbPool.query(
    `
    SELECT a.id
    FROM articles a
    JOIN stock_summary ss ON ss.article_id = a.id
    WHERE a.store_id = $1
      AND ss.store_id = $1
      AND ss.department_id = $2
      AND a.plu = $3
    LIMIT 1
    `,
    [req.user.store_id, article.department_id, article.plu]
  );

  if (fallbackStockArticle.rows.length > 0) {
    stockArticleId = fallbackStockArticle.rows[0].id;
  }
}

const stockResult = await req.dbPool.query(
  `
  SELECT
    ss.stock_quantity,
    ss.stock_value_ex_vat,
    ss.pma,
    ss.next_dlc,
    sap.pv_ttc_real
  FROM stock_summary ss
  LEFT JOIN stock_article_pricing sap
    ON sap.store_id = ss.store_id
   AND sap.department_id = ss.department_id
   AND sap.article_id = ss.article_id
  WHERE ss.store_id = $1
    AND ss.department_id = $2
    AND ss.article_id = $3
  LIMIT 1
  `,
  [req.user.store_id, article.department_id, stockArticleId]
);

const lotsResult = await req.dbPool.query(
  `
  SELECT
    l.id,
    l.lot_code,
    l.qty_initial,
    l.qty_remaining,
    l.unit_cost_ex_vat,
    l.dlc,
    l.source_type,
    l.supplier_lot_number,
    l.traceability_data,
    l.created_at,
    s.name AS supplier_name
  FROM lots l
  LEFT JOIN suppliers s ON s.id = l.supplier_id
  WHERE l.store_id = $1
    AND l.department_id = $2
    AND l.article_id = $3
  ORDER BY
    CASE WHEN l.qty_remaining > 0 THEN 0 ELSE 1 END,
    l.dlc ASC NULLS LAST,
    l.created_at DESC
  LIMIT 100
  `,
  [req.user.store_id, article.department_id, stockArticleId]
);

const movementsResult = await req.dbPool.query(
  `
  SELECT
    sm.id,
    sm.movement_type,
    sm.quantity,
    sm.unit_cost_ex_vat,
    sm.source_table,
    sm.source_id,
    sm.notes,
    sm.created_at,
    l.lot_code
  FROM stock_movements sm
  LEFT JOIN lots l ON l.id = sm.lot_id
  WHERE sm.store_id = $1
    AND sm.department_id = $2
    AND sm.article_id = $3
  ORDER BY sm.created_at DESC
  LIMIT 50
  `,
  [req.user.store_id, article.department_id, stockArticleId]
);

const purchasesResult = await req.dbPool.query(
  `
  SELECT
    pl.id,
    pl.purchase_id,
    pl.article_id,
    pl.ordered_quantity,
    pl.received_quantity,
    pl.price_unit,
    pl.unit_price_ex_vat,
    pl.line_amount_ex_vat,
    p.purchase_date,
    p.bl_number,
    p.status AS purchase_status,
    s.name AS supplier_name,
    plm.dlc
  FROM purchase_lines pl
  JOIN purchases p ON p.id = pl.purchase_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id
  LEFT JOIN purchase_line_metadata plm
    ON plm.purchase_line_id = pl.id
   AND plm.meta_key = 'v2_line'
  WHERE pl.article_id = $1
  ORDER BY p.purchase_date DESC NULLS LAST, pl.created_at DESC NULLS LAST
  LIMIT 30
  `,
  [stockArticleId]
);

const salesResult = await req.dbPool.query(
  `
  SELECT
    sl.id,
    sl.sales_document_id,
    sd.document_date,
    sd.document_type,
    sd.status,
    sd.reference_number,
    sl.sold_quantity,
    sl.sale_unit,
    sl.unit_sale_price_ttc,
    sl.unit_cost_ex_vat,
    sl.line_reason,
    sl.line_status
  FROM sales_lines sl
  JOIN sales_documents sd ON sd.id = sl.sales_document_id
  WHERE sl.article_id = $1
    AND sl.store_id = $2
    AND sl.department_id = $3
  ORDER BY sd.document_date DESC NULLS LAST, sl.created_at DESC NULLS LAST
  LIMIT 30
  `,
  [stockArticleId, req.user.store_id, article.department_id]
);

res.json({
  article,
  stock: stockResult.rows[0] || null,
  lots: lotsResult.rows,
  movements: movementsResult.rows,
  history: {
    purchases: purchasesResult.rows,
    sales: salesResult.rows,
  },
  debug: {
    requestedDepartmentId,
    openedArticleId: article.id,
    stockArticleId,
    articlePlu: article.plu,
    stockCount: stockResult.rows.length,
    lotsCount: lotsResult.rows.length,
    movementsCount: movementsResult.rows.length,
    purchasesCount: purchasesResult.rows.length,
    salesCount: salesResult.rows.length,
  },
});
  } catch (err) {
    console.error('Erreur GET /api/articles/:id :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/articles/:id - Update article
router.patch('/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const articleId = req.params.id;
    const {
      department_id,
      plu,
      designation,
      unit,
      ean,
      is_active,
      sector_code,
      category,
      latin_name,
      fao_zone,
      sous_zone,
      engin,
      allergenes,
      display_name,
      purchase_unit,
      stock_unit,
      sale_unit,
    } = req.body;

    await client.query('BEGIN');

    const articleCheck = await client.query(
      `
      SELECT a.id, ad.id AS article_department_id, ad.department_id
      FROM articles a
      JOIN article_departments ad ON ad.article_id = a.id
      WHERE a.id = $1
        AND a.store_id = $2
      LIMIT 1
      `,
      [articleId, req.user.store_id]
    );

    if (articleCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Article introuvable' });
    }

    const current = articleCheck.rows[0];
    const finalDepartmentId = department_id || current.department_id;

    const department = await assertDepartmentBelongsToStore(client, finalDepartmentId, req.user.store_id);

    if (!department) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Rayon invalide pour ce magasin' });
    }

    let sectorId = null;
    if (sector_code) {
      const sectorResult = await client.query(
        `
        SELECT id
        FROM department_sectors
        WHERE department_id = $1
          AND code = $2
        LIMIT 1
        `,
        [finalDepartmentId, sector_code]
      );
      sectorId = sectorResult.rows[0]?.id || null;
    }

    await client.query(
      `
      UPDATE articles
      SET
        plu = COALESCE($1, plu),
        designation = COALESCE($2, designation),
        unit = COALESCE($3, unit),
        ean = $4,
        is_active = COALESCE($5, is_active)
      WHERE id = $6
        AND store_id = $7
      `,
      [
        toNullableString(plu),
        toNullableString(designation),
        toNullableString(unit),
        toNullableString(ean),
        typeof is_active === 'boolean' ? is_active : null,
        articleId,
        req.user.store_id,
      ]
    );

    await client.query(
      `
      UPDATE article_departments
      SET
        department_id = $1,
        display_name = $2,
        purchase_unit = $3,
        stock_unit = $4,
        sale_unit = $5,
        is_active = COALESCE($6, is_active),
        department_sector_id = $7
      WHERE article_id = $8
      `,
      [
        finalDepartmentId,
        toNullableString(display_name),
        toNullableString(purchase_unit),
        toNullableString(stock_unit),
        toNullableString(sale_unit),
        typeof is_active === 'boolean' ? is_active : null,
        sectorId,
        articleId,
      ]
    );

    await client.query(
      `
      INSERT INTO article_department_metadata (
        id,
        article_department_id,
        field_key,
        field_value,
        category,
        latin_name,
        fao_zone,
        sous_zone,
        engin,
        allergenes,
        raw_source
      )
      VALUES (
        gen_random_uuid(),
        $1,
        'v2_import',
        NULL,
        $2, $3, $4, $5, $6, $7, '{}'::jsonb
      )
      ON CONFLICT (article_department_id, field_key)
      DO UPDATE SET
        category = EXCLUDED.category,
        latin_name = EXCLUDED.latin_name,
        fao_zone = EXCLUDED.fao_zone,
        sous_zone = EXCLUDED.sous_zone,
        engin = EXCLUDED.engin,
        allergenes = EXCLUDED.allergenes
      `,
      [
        current.article_department_id,
        toNullableString(category),
        toNullableString(latin_name),
        toNullableString(fao_zone),
        toNullableString(sous_zone),
        toNullableString(engin),
        toNullableString(allergenes),
      ]
    );

    await client.query('COMMIT');

    res.json({ ok: true, message: 'Article modifié avec succès' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur PATCH /api/articles/:id :', err);

    if (err.code === '23505') {
      return res.status(400).json({ error: 'PLU déjà existant pour ce magasin' });
    }

    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// DELETE /api/articles/:id - Delete article
router.delete('/:id', authenticateToken, attachDbContext, requireAdmin, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const articleId = req.params.id;

    const articleCheck = await client.query(
      `
      SELECT id
      FROM articles
      WHERE id = $1
        AND store_id = $2
      `,
      [articleId, req.user.store_id]
    );

    if (articleCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Article introuvable' });
    }

    const purchaseLinesCheck = await client.query(
      `
      SELECT 1
      FROM purchase_lines
      WHERE article_id = $1
      LIMIT 1
      `,
      [articleId]
    );

    if (purchaseLinesCheck.rows.length > 0) {
      return res.status(400).json({
        error: 'Article déjà utilisé dans des achats. Désactive-le au lieu de le supprimer.',
      });
    }

    await client.query('BEGIN');

    await client.query(
      `
      DELETE FROM article_department_metadata
      WHERE article_department_id IN (
        SELECT id FROM article_departments WHERE article_id = $1
      )
      `,
      [articleId]
    );

    await client.query(
      `DELETE FROM article_departments WHERE article_id = $1`,
      [articleId]
    );

    await client.query(
      `DELETE FROM articles WHERE id = $1 AND store_id = $2`,
      [articleId, req.user.store_id]
    );

    await client.query('COMMIT');

    res.json({ ok: true, message: 'Article supprimé avec succès' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur DELETE /api/articles/:id :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

module.exports = router;
