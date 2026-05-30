const express = require('express');

const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');

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

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '')
  );
}

function normalizeBool(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return null;
}

function toNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
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

// GET /api/articles
router.get('/', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const {
      search = '',
      family = '',
      sector = '',
      active = '',
      limit = '200',
      offset = '0',
    } = req.query;
    const departmentId = normalizeUuidParam(req.query.department_id);

    const familyCode = family || sector;
    const activeValue = normalizeBool(active);
    const safeLimit = Math.min(Number(limit) || 200, 500);
    const safeOffset = Number(offset) || 0;

    const params = [req.user.store_id];
    let where = 'WHERE a.store_id = $1';

    if (departmentId && isUuid(departmentId)) {
      params.push(departmentId);
      where += ` AND ad.department_id = $${params.length}`;
    }

    if (familyCode) {
      params.push(familyCode);
      where += ` AND (
        ds.code = $${params.length}
        OR NOT EXISTS (
          SELECT 1
          FROM article_departments ad_check
          WHERE ad_check.article_id = a.id
        )
      )`;
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
        OR COALESCE(a.ean, '') ILIKE $${idx}
        OR COALESCE(ad.display_name, '') ILIKE $${idx}
        OR COALESCE(adm.latin_name, '') ILIKE $${idx}
        OR COALESCE(adm.category, '') ILIKE $${idx}
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
        a.ean,
        a.unit,
        a.is_active,
        a.source_origin,
        a.source_id,
        a.created_at,
        a.updated_at,

        ad.id AS article_department_id,
        ad.department_id,
        d.name AS department_name,
        ad.department_sector_id,
        COALESCE(a.display_name, ad.display_name) AS display_name,
        COALESCE(a.purchase_unit, ad.purchase_unit) AS purchase_unit,
        COALESCE(a.stock_unit, ad.stock_unit) AS stock_unit,
        COALESCE(a.sale_unit, ad.sale_unit) AS sale_unit,
        ad.vat_rate,
        ad.purchase_price_ex_vat,
        ad.sale_price_ex_vat,
        ad.sale_price_inc_vat,

        ds.code AS family_code,
        ds.name AS family_name,

        COALESCE(a.production_method, adm.category) AS category,
        COALESCE(a.latin_name, adm.latin_name) AS latin_name,
        COALESCE(a.fao_zone, adm.fao_zone) AS fao_zone,
        COALESCE(a.sous_zone, adm.sous_zone) AS sous_zone,
        COALESCE(a.fishing_gear, adm.engin) AS engin,
        COALESCE(a.fishing_gear, adm.engin) AS fishing_gear,
        COALESCE(a.allergens, adm.allergenes) AS allergenes,
        COALESCE(a.allergens, adm.allergenes) AS allergens,
        COALESCE(a.production_method, adm.raw_source->>'production_method', adm.raw_source->>'method_production') AS production_method,
        COALESCE(adm.raw_source, '{}'::jsonb) AS raw_source
      FROM articles a
      LEFT JOIN article_departments ad ON ad.article_id = a.id
      LEFT JOIN departments d ON d.id = ad.department_id
      LEFT JOIN department_sectors ds ON ds.id = ad.department_sector_id
      LEFT JOIN article_department_metadata adm
        ON adm.article_department_id = ad.id
       AND adm.field_key = 'business_metadata'
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

// GET /api/articles/families
router.get('/families', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const departmentId = normalizeUuidParam(req.query.department_id);

    const params = [];
    let where = 'WHERE ds.is_active = true';

    if (departmentId && isUuid(departmentId)) {
      params.push(departmentId);
      where += ` AND ds.department_id = $${params.length}`;
    } else {
      params.push(req.user.store_id);
      where += ` AND ds.department_id IN (
        SELECT id FROM departments WHERE store_id = $${params.length}
      )`;
    }

    const result = await req.dbPool.query(
      `
      SELECT
        ds.id,
        ds.department_id,
        ds.code,
        ds.name,
        ds.description,
        ds.color_hex,
        ds.display_order
      FROM department_sectors ds
      ${where}
      ORDER BY ds.display_order ASC, ds.name ASC
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/articles/families :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/articles/search
router.get('/search', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const { q = '', sector = '', family = '' } = req.query;
    const departmentId = normalizeUuidParam(req.query.department_id);
    const searchTerm = String(q).trim();

    if (!searchTerm) {
      return res.json([]);
    }

    const familyCode = family || sector;
    const likePattern = `%${searchTerm}%`;
    const startsWithPattern = `${searchTerm}%`;
    const queryParams = [req.user.store_id, likePattern, searchTerm, startsWithPattern];
    let extraFilters = '';

    if (departmentId && isUuid(departmentId)) {
      queryParams.push(departmentId);
      extraFilters += ` AND ad.department_id = $${queryParams.length}`;
    }

    if (familyCode) {
      queryParams.push(familyCode);
      extraFilters += ` AND (
        ds.code = $${queryParams.length}
        OR NOT EXISTS (
          SELECT 1
          FROM article_departments ad_check
          WHERE ad_check.article_id = a.id
        )
      )`;
    }

    const result = await req.dbPool.query(
      `
      SELECT
        a.id,
        a.plu,
        a.designation,
        a.unit,
        a.ean,
        a.is_active,
        COALESCE(a.display_name, ad.display_name) AS display_name,
        COALESCE(a.purchase_unit, ad.purchase_unit) AS purchase_unit,
        COALESCE(a.stock_unit, ad.stock_unit) AS stock_unit,
        COALESCE(a.sale_unit, ad.sale_unit) AS sale_unit,
        ad.vat_rate,
        ad.sale_price_ex_vat,
        ad.sale_price_inc_vat,
        COALESCE(a.latin_name, adm.latin_name) AS latin_name,
        COALESCE(a.production_method, adm.category) AS category,
        COALESCE(a.fao_zone, adm.fao_zone) AS fao_zone,
        COALESCE(a.sous_zone, adm.sous_zone) AS sous_zone,
        COALESCE(a.fishing_gear, adm.engin) AS engin,
        COALESCE(a.fishing_gear, adm.engin) AS fishing_gear,
        COALESCE(a.allergens, adm.allergenes) AS allergenes,
        COALESCE(a.allergens, adm.allergenes) AS allergens,
        COALESCE(a.production_method, adm.raw_source->>'production_method', adm.raw_source->>'method_production') AS production_method
      FROM articles a
      LEFT JOIN article_departments ad ON ad.article_id = a.id
      LEFT JOIN department_sectors ds ON ds.id = ad.department_sector_id
      LEFT JOIN article_department_metadata adm
        ON adm.article_department_id = ad.id
       AND adm.field_key = 'business_metadata'
      WHERE a.store_id = $1
        AND a.is_active = true
        AND COALESCE(ad.is_active, true) = true
        ${extraFilters}
        AND (
          a.plu ILIKE $2
          OR a.designation ILIKE $2
          OR COALESCE(a.ean, '') ILIKE $2
          OR COALESCE(ad.display_name, '') ILIKE $2
          OR COALESCE(adm.latin_name, '') ILIKE $2
        )
      ORDER BY
        CASE WHEN a.plu = $3 THEN 0 ELSE 1 END,
        CASE WHEN a.plu ILIKE $4 THEN 0 ELSE 1 END,
        a.designation ASC
      LIMIT 50
      `,
      queryParams
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/articles/search :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/articles/search-in-stock
router.get('/search-in-stock', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const { q = '' } = req.query;
    const departmentId = normalizeUuidParam(req.query.department_id);
    const searchTerm = String(q).trim();

    if (!searchTerm) {
      return res.json([]);
    }

    const params = [req.user.store_id, `%${searchTerm}%`, `${searchTerm}%`];
    let departmentFilter = '';

    if (departmentId && isUuid(departmentId)) {
      params.push(departmentId);
      departmentFilter = `AND (
        ad.department_id = $${params.length}
        OR NOT EXISTS (
          SELECT 1
          FROM article_departments ad_check
          WHERE ad_check.article_id = a.id
        )
      )`;
    }

    const result = await req.dbPool.query(
      `
      SELECT
        a.id,
        a.plu,
        a.designation,
        a.ean,
        a.unit,
        COALESCE(a.sale_unit, ad.sale_unit) AS sale_unit,
        ad.sale_price_ex_vat,
        ad.sale_price_inc_vat,
        ad.sale_price_inc_vat AS pv_ttc_real,
        COALESCE(ss.pma, 0) AS pma,
        COALESCE(ss.pma, 0) AS unit_cost_ex_vat,
        COALESCE(ss.stock_quantity, 0) AS stock_quantity
      FROM articles a
      LEFT JOIN article_departments ad ON ad.article_id = a.id
      LEFT JOIN article_department_metadata adm
        ON adm.article_department_id = ad.id
       AND adm.field_key = 'business_metadata'
      LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
      WHERE a.store_id = $1
        AND a.is_active = true
        AND COALESCE(ad.is_active, true) = true
        AND COALESCE(ss.stock_quantity, 0) > 0
        ${departmentFilter}
        AND (
          a.plu ILIKE $2
          OR a.designation ILIKE $2
          OR COALESCE(ad.display_name, '') ILIKE $2
          OR COALESCE(adm.latin_name, '') ILIKE $2
          OR COALESCE(a.ean, '') ILIKE $2
        )
      ORDER BY
        CASE WHEN a.plu = $3 THEN 0 ELSE 1 END,
        CASE WHEN a.plu ILIKE $3 THEN 0 ELSE 1 END,
        a.designation ASC
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

// POST /api/articles
router.post('/', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const {
      department_id,
      plu,
      designation,
      ean,
      unit,
      is_active = true,
      family_code,
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
      vat_rate = 5.5,
      purchase_price_ex_vat,
      sale_price_ex_vat,
      sale_price_inc_vat,
    } = req.body;

    if (!toNullableString(plu) || !toNullableString(designation)) {
  return res.status(400).json({
    error: 'plu et designation sont obligatoires',
  });
}

    await client.query('BEGIN');

    let department = null;

if (department_id) {
  department = await assertDepartmentBelongsToStore(client, department_id, req.user.store_id);

  if (!department) {
    await client.query('ROLLBACK');
    return res.status(400).json({ error: 'Service invalide pour ce client' });
  }
}

    const selectedFamilyCode = family_code || sector_code;
    const sectorId = await getSectorId(client, department_id, selectedFamilyCode);

    const articleInsert = await client.query(
      `
      INSERT INTO articles (
        store_id,
        plu,
        designation,
        ean,
        unit,
        is_active,
        source_origin,
        created_by,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7, $7)
      RETURNING id
      `,
      [
        req.user.store_id,
        toNullableString(plu),
        toNullableString(designation),
        toNullableString(ean),
        toNullableString(unit) || 'kg',
        !!is_active,
        req.user.id,
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
        department_id,
        sectorId,
        toNullableString(display_name),
        toNullableString(purchase_unit),
        toNullableString(stock_unit),
        toNullableString(sale_unit),
        toNullableNumber(vat_rate) ?? 5.5,
        toNullableNumber(purchase_price_ex_vat),
        toNullableNumber(sale_price_ex_vat),
        toNullableNumber(sale_price_inc_vat),
        !!is_active,
        req.user.id,
      ]
    );

    const articleDepartmentId = articleDepartmentInsert.rows[0].id;

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
      return res.status(400).json({ error: 'PLU déjà existant pour ce client' });
    }

    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// GET /api/articles/:id
router.get('/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const articleId = normalizeUuidParam(req.params.id);
    const departmentId = normalizeUuidParam(req.query.department_id);

    if (!articleId || !isUuid(articleId)) {
      return res.status(400).json({ error: 'ID article invalide' });
    }

    const params = [articleId, req.user.store_id];
    let departmentFilter = '';

    if (departmentId && isUuid(departmentId)) {
      params.push(departmentId);
      departmentFilter = `AND ad.department_id = $${params.length}`;
    }

    const result = await req.dbPool.query(
      `
      SELECT
        a.id,
        a.store_id,
        a.plu,
        a.designation,
        a.ean,
        a.unit,
        a.is_active,
        a.source_origin,
        a.source_id,
        a.created_at,
        a.updated_at,

        ad.id AS article_department_id,
        ad.department_id,
        d.name AS department_name,
        d.code AS department_code,
        ad.department_sector_id,
        COALESCE(a.display_name, ad.display_name) AS display_name,
        COALESCE(a.purchase_unit, ad.purchase_unit) AS purchase_unit,
        COALESCE(a.stock_unit, ad.stock_unit) AS stock_unit,
        COALESCE(a.sale_unit, ad.sale_unit) AS sale_unit,
        ad.vat_rate,
        ad.purchase_price_ex_vat,
        ad.sale_price_ex_vat,
        ad.sale_price_inc_vat,

        ds.code AS family_code,
        ds.name AS family_name,

        COALESCE(a.production_method, adm.category) AS category,
        COALESCE(a.latin_name, adm.latin_name) AS latin_name,
        COALESCE(a.fao_zone, adm.fao_zone) AS fao_zone,
        COALESCE(a.sous_zone, adm.sous_zone) AS sous_zone,
        COALESCE(a.fishing_gear, adm.engin) AS engin,
        COALESCE(a.fishing_gear, adm.engin) AS fishing_gear,
        COALESCE(a.allergens, adm.allergenes) AS allergenes,
        COALESCE(a.allergens, adm.allergenes) AS allergens,
        COALESCE(a.production_method, adm.raw_source->>'production_method', adm.raw_source->>'method_production') AS production_method,
        COALESCE(adm.raw_source, '{}'::jsonb) AS raw_source
      FROM articles a
      LEFT JOIN article_departments ad ON ad.article_id = a.id
      LEFT JOIN departments d ON d.id = ad.department_id
      LEFT JOIN department_sectors ds ON ds.id = ad.department_sector_id
      LEFT JOIN article_department_metadata adm
        ON adm.article_department_id = ad.id
       AND adm.field_key = 'business_metadata'
      WHERE a.id = $1
        AND a.store_id = $2
        ${departmentFilter}
      LIMIT 1
      `,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Article introuvable' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur GET /api/articles/:id :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/articles/:id
router.patch('/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const articleId = req.params.id;

    const {
      department_id,
      plu,
      designation,
      ean,
      unit,
      is_active = true,
      family_code,
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
      vat_rate = 5.5,
      purchase_price_ex_vat,
      sale_price_ex_vat,
      sale_price_inc_vat,
    } = req.body;

    if (!toNullableString(plu) || !toNullableString(designation)) {
  return res.status(400).json({
    error: 'plu et designation sont obligatoires',
  });
}

    await client.query('BEGIN');

    let department = null;

if (department_id) {
  department = await assertDepartmentBelongsToStore(
    client,
    department_id,
    req.user.store_id
  );

  if (!department) {
    await client.query('ROLLBACK');
    return res.status(400).json({
      error: 'Service invalide pour ce client',
    });
  }
}

    const articleUpdate = await client.query(
      `
      UPDATE articles
SET
  plu = $1,
  designation = $2,
  ean = $3,
  unit = $4,
  is_active = $5,
  updated_by = $6,
  latin_name = $9,
  fao_zone = $10,
  sous_zone = $11,
  fishing_gear = $12,
  allergens = $13,
  production_method = $14,
  display_name = $15,
  purchase_unit = $16,
  stock_unit = $17,
  sale_unit = $18,
  updated_at = NOW()
WHERE id = $7
  AND store_id = $8
RETURNING id
      `,
     [
  toNullableString(plu),
  toNullableString(designation),
  toNullableString(ean),
  toNullableString(unit) || 'kg',
  !!is_active,
  req.user.id,
  articleId,
  req.user.store_id,
  toNullableString(latin_name),
  toNullableString(fao_zone),
  toNullableString(sous_zone),
  toNullableString(engin),
  toNullableString(allergenes),
  toNullableString(category),
  toNullableString(display_name),
  toNullableString(purchase_unit),
  toNullableString(stock_unit),
  toNullableString(sale_unit),
]
    );

    if (articleUpdate.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Article introuvable' });
    }

    const selectedFamilyCode = family_code || sector_code;
    let articleDepartmentId = null;

    if (department_id) {
      const sectorId = await getSectorId(client, department_id, selectedFamilyCode);

      const articleDepartmentUpdate = await client.query(
        `
        UPDATE article_departments
        SET
          department_sector_id = $1,
          display_name = $2,
          purchase_unit = $3,
          stock_unit = $4,
          sale_unit = $5,
          vat_rate = $6,
          purchase_price_ex_vat = $7,
          sale_price_ex_vat = $8,
          sale_price_inc_vat = $9,
          is_active = $10,
          updated_by = $11
        WHERE article_id = $12
          AND department_id = $13
        RETURNING id
        `,
        [
          sectorId,
          toNullableString(display_name),
          toNullableString(purchase_unit),
          toNullableString(stock_unit),
          toNullableString(sale_unit),
          toNullableNumber(vat_rate) ?? 5.5,
          toNullableNumber(purchase_price_ex_vat),
          toNullableNumber(sale_price_ex_vat),
          toNullableNumber(sale_price_inc_vat),
          !!is_active,
          req.user.id,
          articleId,
          department_id,
        ]
      );

      if (articleDepartmentUpdate.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Rattachement article/service introuvable' });
      }

      articleDepartmentId = articleDepartmentUpdate.rows[0].id;
    } else {
      const articleDepartmentUpdate = await client.query(
        `
        UPDATE article_departments ad
        SET
          department_sector_id = COALESCE((
            SELECT ds.id
            FROM department_sectors ds
            WHERE ds.department_id = ad.department_id
              AND ds.code = $1
              AND ds.is_active = true
            LIMIT 1
          ), ad.department_sector_id),
          display_name = $2,
          purchase_unit = $3,
          stock_unit = $4,
          sale_unit = $5,
          vat_rate = $6,
          purchase_price_ex_vat = $7,
          sale_price_ex_vat = $8,
          sale_price_inc_vat = $9,
          is_active = $10,
          updated_by = $11
        WHERE ad.id = (
          SELECT ad_pick.id
          FROM article_departments ad_pick
          JOIN articles a_pick ON a_pick.id = ad_pick.article_id
          WHERE ad_pick.article_id = $12
            AND a_pick.store_id = $13
          ORDER BY ad_pick.created_at ASC
          LIMIT 1
        )
        RETURNING id
        `,
        [
          toNullableString(selectedFamilyCode),
          toNullableString(display_name),
          toNullableString(purchase_unit),
          toNullableString(stock_unit),
          toNullableString(sale_unit),
          toNullableNumber(vat_rate) ?? 5.5,
          toNullableNumber(purchase_price_ex_vat),
          toNullableNumber(sale_price_ex_vat),
          toNullableNumber(sale_price_inc_vat),
          !!is_active,
          req.user.id,
          articleId,
          req.user.store_id,
        ]
      );

      articleDepartmentId = articleDepartmentUpdate.rows[0]?.id || null;
    }

    if (articleDepartmentId) {
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
        ON CONFLICT (article_department_id, field_key)
        DO UPDATE SET
          category = EXCLUDED.category,
          latin_name = EXCLUDED.latin_name,
          fao_zone = EXCLUDED.fao_zone,
          sous_zone = EXCLUDED.sous_zone,
          engin = EXCLUDED.engin,
          allergenes = EXCLUDED.allergenes,
          updated_at = NOW()
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
    }

    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Article modifié avec succès',
      id: articleId,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur PATCH /api/articles/:id :', err);

    if (err.code === '23505') {
      return res.status(400).json({ error: 'PLU déjà existant pour ce client' });
    }

    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// PATCH /api/articles/:id/status
router.patch('/:id/status', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const articleId = req.params.id;
    const { is_active } = req.body;

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active doit être un booléen' });
    }

    await client.query('BEGIN');

    const articleUpdate = await client.query(
      `
      UPDATE articles
      SET is_active = $1,
          updated_by = $2
      WHERE id = $3
        AND store_id = $4
      RETURNING id
      `,
      [is_active, req.user.id, articleId, req.user.store_id]
    );

    if (articleUpdate.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Article introuvable' });
    }

    await client.query(
      `
      UPDATE article_departments
      SET is_active = $1,
          updated_by = $2
      WHERE article_id = $3
      `,
      [is_active, req.user.id, articleId]
    );

    await client.query('COMMIT');

    res.json({ ok: true, message: 'Statut article mis à jour' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur PATCH /api/articles/:id/status :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// POST /api/articles/:id/duplicate
router.post('/:id/duplicate', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const sourceArticleId = req.params.id;
    const { new_plu, new_designation, new_ean } = req.body;

    if (!toNullableString(new_plu) || !toNullableString(new_designation)) {
      return res.status(400).json({
        error: 'new_plu et new_designation sont obligatoires',
      });
    }

    const sourceResult = await client.query(
      `
      SELECT
        a.unit,
        a.is_active,
        ad.department_id,
        ad.department_sector_id,
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
      JOIN article_departments ad ON ad.article_id = a.id
      LEFT JOIN article_department_metadata adm
        ON adm.article_department_id = ad.id
       AND adm.field_key = 'business_metadata'
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
        store_id,
        plu,
        designation,
        ean,
        unit,
        is_active,
        source_origin,
        created_by,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'duplicate', $7, $7)
      RETURNING id
      `,
      [
        req.user.store_id,
        toNullableString(new_plu),
        toNullableString(new_designation),
        toNullableString(new_ean),
        source.unit || 'kg',
        source.is_active,
        req.user.id,
      ]
    );

    const newArticleId = articleInsert.rows[0].id;

    const adInsert = await client.query(
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
        newArticleId,
        source.department_id,
        source.department_sector_id,
        source.display_name,
        source.purchase_unit,
        source.stock_unit,
        source.sale_unit,
        source.vat_rate || 5.5,
        source.purchase_price_ex_vat,
        source.sale_price_ex_vat,
        source.sale_price_inc_vat,
        source.is_active,
        req.user.id,
      ]
    );

    const newArticleDepartmentId = adInsert.rows[0].id;

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

// DELETE /api/articles/:id
router.delete('/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const articleId = req.params.id;

    await client.query('BEGIN');

    const result = await client.query(
      `
      DELETE FROM articles
      WHERE id = $1
        AND store_id = $2
      RETURNING id
      `,
      [articleId, req.user.store_id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Article introuvable' });
    }

    await client.query('COMMIT');

    res.json({ ok: true, message: 'Article supprimé' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur DELETE /api/articles/:id :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

module.exports = router;
