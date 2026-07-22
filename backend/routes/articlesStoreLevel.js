const express = require('express');

const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');

const UNIT_FALLBACK = 'kg';

function clean(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function cleanUuid(value) {
  const trimmed = clean(value);
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null;
  return trimmed;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '')
  );
}

function parseBool(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return fallback;
}

function parseNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function articleUniqueViolationMessage(err, fallbackMessage = 'PLU deja existant pour ce client') {
  const constraint = String(err?.constraint || '').toLowerCase();
  const detail = String(err?.detail || '').toLowerCase();

  if (constraint.includes('ean') || detail.includes('(ean)')) {
    return 'EAN deja existant pour ce client';
  }

  return fallbackMessage;
}

function articlePayload(body) {
  return {
    plu: clean(body.plu),
    designation: clean(body.designation),
    ean: clean(body.ean),
    unit: clean(body.unit) || UNIT_FALLBACK,
    is_active: parseBool(body.is_active, true),
    family_code: clean(body.family_code || body.sector_code),
    family_name: clean(body.family_name),
    display_name: clean(body.display_name),
    purchase_unit: clean(body.purchase_unit),
    stock_unit: clean(body.stock_unit),
    sale_unit: clean(body.sale_unit),
    vat_rate: parseNumber(body.vat_rate, 5.5),
    purchase_price_ex_vat: parseNumber(body.purchase_price_ex_vat),
    sale_price_ex_vat: parseNumber(body.sale_price_ex_vat),
    sale_price_inc_vat: parseNumber(body.sale_price_inc_vat),
    production_method: clean(body.production_method || body.category),
    latin_name: clean(body.latin_name),
    fao_zone: clean(body.fao_zone),
    sous_zone: clean(body.sous_zone),
    fishing_gear: clean(body.fishing_gear || body.engin),
    allergens: clean(body.allergens || body.allergenes),
  };
}

function articleInsertParams(storeId, data, userId) {
  return [
    storeId,
    data.plu,
    data.designation,
    data.ean,
    data.unit,
    data.is_active,
    data.family_code,
    data.family_name,
    data.display_name,
    data.purchase_unit,
    data.stock_unit,
    data.sale_unit,
    data.vat_rate,
    data.purchase_price_ex_vat,
    data.sale_price_ex_vat,
    data.sale_price_inc_vat,
    data.production_method,
    data.latin_name,
    data.fao_zone,
    data.sous_zone,
    data.fishing_gear,
    data.allergens,
    userId,
  ];
}

async function applyFamilyName(db, storeId, data) {
  if (!data.family_code || data.family_name) return data;

  const result = await db.query(
    `
    SELECT ds.name
    FROM department_sectors ds
    JOIN departments d ON d.id = ds.department_id
    WHERE d.store_id = $1
      AND ds.code = $2
      AND ds.is_active = true
    ORDER BY ds.display_order ASC, ds.name ASC
    LIMIT 1
    `,
    [storeId, data.family_code]
  );

  return {
    ...data,
    family_name: result.rows[0]?.name || null,
  };
}

async function upsertLegacyDepartment(db, articleId, storeId, userId, departmentId, data) {
  if (!departmentId) return null;

  const department = await db.query(
    'SELECT id FROM departments WHERE id = $1 AND store_id = $2 LIMIT 1',
    [departmentId, storeId]
  );

  if (department.rows.length === 0) {
    const error = new Error('Service invalide pour ce client');
    error.status = 400;
    throw error;
  }

  const sector = data.family_code
    ? await db.query(
        `
        SELECT id
        FROM department_sectors
        WHERE department_id = $1
          AND code = $2
          AND is_active = true
        LIMIT 1
        `,
        [departmentId, data.family_code]
      )
    : { rows: [] };

  const articleDepartment = await db.query(
    `
    INSERT INTO article_departments (
      article_id, department_id, department_sector_id, display_name,
      purchase_unit, stock_unit, sale_unit, vat_rate,
      purchase_price_ex_vat, sale_price_ex_vat, sale_price_inc_vat,
      is_active, created_by, updated_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
    ON CONFLICT (article_id, department_id)
    DO UPDATE SET
      department_sector_id = EXCLUDED.department_sector_id,
      display_name = EXCLUDED.display_name,
      purchase_unit = EXCLUDED.purchase_unit,
      stock_unit = EXCLUDED.stock_unit,
      sale_unit = EXCLUDED.sale_unit,
      vat_rate = EXCLUDED.vat_rate,
      purchase_price_ex_vat = EXCLUDED.purchase_price_ex_vat,
      sale_price_ex_vat = EXCLUDED.sale_price_ex_vat,
      sale_price_inc_vat = EXCLUDED.sale_price_inc_vat,
      is_active = EXCLUDED.is_active,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
    RETURNING id
    `,
    [
      articleId,
      departmentId,
      sector.rows[0]?.id || null,
      data.display_name,
      data.purchase_unit,
      data.stock_unit,
      data.sale_unit,
      data.vat_rate,
      data.purchase_price_ex_vat,
      data.sale_price_ex_vat,
      data.sale_price_inc_vat,
      data.is_active,
      userId,
    ]
  );

  const articleDepartmentId = articleDepartment.rows[0]?.id || null;
  if (!articleDepartmentId) return null;

  await db.query(
    `
    INSERT INTO article_department_metadata (
      article_department_id, field_key, category, latin_name, fao_zone,
      sous_zone, engin, allergenes, raw_source
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
      data.production_method,
      data.latin_name,
      data.fao_zone,
      data.sous_zone,
      data.fishing_gear,
      data.allergens,
    ]
  );

  return articleDepartmentId;
}

function selectArticlesSql() {
  return `
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
      a.family_code,
      COALESCE(a.family_name, ds.name) AS family_name,
      ad.id AS article_department_id,
      ad.department_id,
      d.name AS department_name,
      d.code AS department_code,
      ad.department_sector_id,
      COALESCE(a.display_name, ad.display_name) AS display_name,
      COALESCE(a.purchase_unit, ad.purchase_unit, a.unit) AS purchase_unit,
      COALESCE(a.stock_unit, ad.stock_unit, a.unit) AS stock_unit,
      COALESCE(a.sale_unit, ad.sale_unit, a.unit) AS sale_unit,
      COALESCE(a.vat_rate, ad.vat_rate, 5.50) AS vat_rate,
      COALESCE(a.purchase_price_ex_vat, ad.purchase_price_ex_vat) AS purchase_price_ex_vat,
      COALESCE(a.sale_price_ex_vat, ad.sale_price_ex_vat) AS sale_price_ex_vat,
      COALESCE(a.sale_price_inc_vat, ad.sale_price_inc_vat) AS sale_price_inc_vat,
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
    LEFT JOIN article_departments ad
      ON ad.id = (
        SELECT ad_pick.id
        FROM article_departments ad_pick
        WHERE ad_pick.article_id = a.id
        ORDER BY
          CASE WHEN ad_pick.is_active = true THEN 0 ELSE 1 END,
          ad_pick.updated_at DESC NULLS LAST,
          ad_pick.created_at DESC NULLS LAST
        LIMIT 1
      )
    LEFT JOIN departments d ON d.id = ad.department_id
    LEFT JOIN department_sectors ds ON ds.id = ad.department_sector_id
    LEFT JOIN article_department_metadata adm
      ON adm.article_department_id = ad.id
     AND adm.field_key = 'business_metadata'
  `;
}

router.get('/families', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const result = await req.dbPool.query(
      `
      SELECT DISTINCT ON (ds.code)
        ds.id, ds.department_id, ds.code, ds.name,
        ds.description, ds.color_hex, ds.display_order
      FROM department_sectors ds
      JOIN departments d ON d.id = ds.department_id
      WHERE d.store_id = $1
        AND ds.is_active = true
      ORDER BY ds.code, ds.display_order ASC, ds.name ASC
      `,
      [req.user.store_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/articles/families :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/search', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const searchTerm = String(req.query.q || '').trim();
    if (!searchTerm) return res.json([]);

    const familyCode = clean(req.query.family || req.query.sector);
    const params = [req.user.store_id, `%${searchTerm}%`, searchTerm, `${searchTerm}%`];
    let familyFilter = '';

    if (familyCode) {
      params.push(familyCode);
      familyFilter = `AND (a.family_code = $${params.length} OR ds.code = $${params.length})`;
    }

    const result = await req.dbPool.query(
      `
      ${selectArticlesSql()}
      WHERE a.store_id = $1
        AND a.is_active = true
        ${familyFilter}
        AND (
          a.plu ILIKE $2
          OR a.designation ILIKE $2
          OR COALESCE(a.ean, '') ILIKE $2
          OR COALESCE(a.display_name, '') ILIKE $2
          OR COALESCE(a.latin_name, '') ILIKE $2
        )
      ORDER BY
        CASE WHEN a.plu = $3 THEN 0 ELSE 1 END,
        CASE WHEN a.plu ILIKE $4 THEN 0 ELSE 1 END,
        a.designation ASC
      LIMIT 50
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/articles/search :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/search-in-stock', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const searchTerm = String(req.query.q || '').trim();
    if (!searchTerm) return res.json([]);

    const result = await req.dbPool.query(
      `
      SELECT
        a.id,
        a.plu,
        a.designation,
        a.ean,
        a.unit,
        COALESCE(a.sale_unit, a.unit) AS sale_unit,
        a.sale_price_ex_vat,
        a.sale_price_inc_vat,
        a.sale_price_inc_vat AS pv_ttc_real,
        COALESCE(ss.pma, 0) AS pma,
        COALESCE(ss.pma, 0) AS unit_cost_ex_vat,
        COALESCE(ss.stock_quantity, 0) AS stock_quantity
      FROM articles a
      LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
      WHERE a.store_id = $1
        AND a.is_active = true
        AND COALESCE(ss.stock_quantity, 0) > 0
        AND (
          a.plu ILIKE $2
          OR a.designation ILIKE $2
          OR COALESCE(a.display_name, '') ILIKE $2
          OR COALESCE(a.latin_name, '') ILIKE $2
          OR COALESCE(a.ean, '') ILIKE $2
        )
      ORDER BY
        CASE WHEN a.plu ILIKE $3 THEN 0 ELSE 1 END,
        a.designation ASC
      LIMIT 50
      `,
      [req.user.store_id, `%${searchTerm}%`, `${searchTerm}%`]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/articles/search-in-stock :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const familyCode = clean(req.query.family || req.query.sector);
    const activeValue = parseBool(req.query.active);
    const safeLimit = Math.min(Number(req.query.limit) || 200, 500);
    const safeOffset = Number(req.query.offset) || 0;

    const params = [req.user.store_id];
    let where = 'WHERE a.store_id = $1';

    if (familyCode) {
      params.push(familyCode);
      where += ` AND (a.family_code = $${params.length} OR ds.code = $${params.length})`;
    }

    if (activeValue !== null) {
      params.push(activeValue);
      where += ` AND a.is_active = $${params.length}`;
    }

    if (clean(req.query.search)) {
      params.push(`%${clean(req.query.search)}%`);
      const idx = params.length;
      where += ` AND (
        a.plu ILIKE $${idx}
        OR a.designation ILIKE $${idx}
        OR COALESCE(a.ean, '') ILIKE $${idx}
        OR COALESCE(a.display_name, '') ILIKE $${idx}
        OR COALESCE(a.latin_name, '') ILIKE $${idx}
        OR COALESCE(a.production_method, '') ILIKE $${idx}
      )`;
    }

    params.push(safeLimit, safeOffset);

    const result = await req.dbPool.query(
      `
      ${selectArticlesSql()}
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

router.post('/', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const data = await applyFamilyName(client, req.user.store_id, articlePayload(req.body));
    if (!data.plu || !data.designation) {
      return res.status(400).json({ error: 'plu et designation sont obligatoires' });
    }

    await client.query('BEGIN');

    const created = await client.query(
      `
      INSERT INTO articles (
        store_id, plu, designation, ean, unit, is_active, source_origin,
        family_code, family_name, display_name, purchase_unit, stock_unit, sale_unit,
        vat_rate, purchase_price_ex_vat, sale_price_ex_vat, sale_price_inc_vat,
        production_method, latin_name, fao_zone, sous_zone, fishing_gear, allergens,
        created_by, updated_by
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, 'manual',
        $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23, $23
      )
      RETURNING id
      `,
      articleInsertParams(req.user.store_id, data, req.user.id)
    );

    await upsertLegacyDepartment(
      client,
      created.rows[0].id,
      req.user.store_id,
      req.user.id,
      cleanUuid(req.body.department_id),
      data
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true, message: 'Article cree avec succes', id: created.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/articles :', err);
    if (err.code === '23505') return res.status(400).json({ error: articleUniqueViolationMessage(err) });
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

router.get('/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const articleId = cleanUuid(req.params.id);
    if (!articleId || !isUuid(articleId)) return res.status(400).json({ error: 'ID article invalide' });

    const result = await req.dbPool.query(
      `
      ${selectArticlesSql()}
      WHERE a.id = $1
        AND a.store_id = $2
      LIMIT 1
      `,
      [articleId, req.user.store_id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Article introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur GET /api/articles/:id :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const articleId = cleanUuid(req.params.id);
    if (!articleId || !isUuid(articleId)) return res.status(400).json({ error: 'ID article invalide' });

    const data = await applyFamilyName(client, req.user.store_id, articlePayload(req.body));
    if (!data.plu || !data.designation) {
      return res.status(400).json({ error: 'plu et designation sont obligatoires' });
    }

    await client.query('BEGIN');

    const updated = await client.query(
      `
      UPDATE articles
      SET
        plu = $1,
        designation = $2,
        ean = $3,
        unit = $4,
        is_active = $5,
        family_code = $6,
        family_name = $7,
        display_name = $8,
        purchase_unit = $9,
        stock_unit = $10,
        sale_unit = $11,
        vat_rate = $12,
        purchase_price_ex_vat = $13,
        sale_price_ex_vat = $14,
        sale_price_inc_vat = $15,
        production_method = $16,
        latin_name = $17,
        fao_zone = $18,
        sous_zone = $19,
        fishing_gear = $20,
        allergens = $21,
        updated_by = $22,
        updated_at = NOW()
      WHERE id = $23
        AND store_id = $24
      RETURNING id
      `,
      [
        data.plu,
        data.designation,
        data.ean,
        data.unit,
        data.is_active,
        data.family_code,
        data.family_name,
        data.display_name,
        data.purchase_unit,
        data.stock_unit,
        data.sale_unit,
        data.vat_rate,
        data.purchase_price_ex_vat,
        data.sale_price_ex_vat,
        data.sale_price_inc_vat,
        data.production_method,
        data.latin_name,
        data.fao_zone,
        data.sous_zone,
        data.fishing_gear,
        data.allergens,
        req.user.id,
        articleId,
        req.user.store_id,
      ]
    );

    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Article introuvable' });
    }

    await upsertLegacyDepartment(
      client,
      articleId,
      req.user.store_id,
      req.user.id,
      cleanUuid(req.body.department_id),
      data
    );

    await client.query('COMMIT');
    res.json({ ok: true, message: 'Article modifie avec succes', id: articleId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur PATCH /api/articles/:id :', err);
    if (err.code === '23505') return res.status(400).json({ error: articleUniqueViolationMessage(err) });
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

router.patch('/:id/status', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const articleId = cleanUuid(req.params.id);
    if (!articleId || !isUuid(articleId)) return res.status(400).json({ error: 'ID article invalide' });
    if (typeof req.body.is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active doit etre un booleen' });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `
      UPDATE articles
      SET is_active = $1,
          updated_by = $2,
          updated_at = NOW()
      WHERE id = $3
        AND store_id = $4
      RETURNING id
      `,
      [req.body.is_active, req.user.id, articleId, req.user.store_id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Article introuvable' });
    }

    await client.query(
      `UPDATE article_departments SET is_active = $1, updated_by = $2, updated_at = NOW() WHERE article_id = $3`,
      [req.body.is_active, req.user.id, articleId]
    );

    await client.query('COMMIT');
    res.json({ ok: true, message: 'Statut article mis a jour' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur PATCH /api/articles/:id/status :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

router.post('/:id/duplicate', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const sourceArticleId = cleanUuid(req.params.id);
    const newPlu = clean(req.body.new_plu);
    const newDesignation = clean(req.body.new_designation);
    const newEan = clean(req.body.new_ean);

    if (!sourceArticleId || !isUuid(sourceArticleId)) return res.status(400).json({ error: 'ID article invalide' });
    if (!newPlu || !newDesignation) {
      return res.status(400).json({ error: 'new_plu et new_designation sont obligatoires' });
    }

    const source = await client.query(
      `
      ${selectArticlesSql()}
      WHERE a.id = $1
        AND a.store_id = $2
      LIMIT 1
      `,
      [sourceArticleId, req.user.store_id]
    );

    if (source.rows.length === 0) return res.status(404).json({ error: 'Article source introuvable' });
    const article = source.rows[0];

    const data = {
      plu: newPlu,
      designation: newDesignation,
      ean: newEan,
      unit: article.unit || UNIT_FALLBACK,
      is_active: article.is_active,
      family_code: article.family_code,
      family_name: article.family_name,
      display_name: article.display_name,
      purchase_unit: article.purchase_unit,
      stock_unit: article.stock_unit,
      sale_unit: article.sale_unit,
      vat_rate: parseNumber(article.vat_rate, 5.5),
      purchase_price_ex_vat: parseNumber(article.purchase_price_ex_vat),
      sale_price_ex_vat: parseNumber(article.sale_price_ex_vat),
      sale_price_inc_vat: parseNumber(article.sale_price_inc_vat),
      production_method: article.production_method || article.category,
      latin_name: article.latin_name,
      fao_zone: article.fao_zone,
      sous_zone: article.sous_zone,
      fishing_gear: article.fishing_gear || article.engin,
      allergens: article.allergens || article.allergenes,
    };

    await client.query('BEGIN');

    const created = await client.query(
      `
      INSERT INTO articles (
        store_id, plu, designation, ean, unit, is_active, source_origin,
        family_code, family_name, display_name, purchase_unit, stock_unit, sale_unit,
        vat_rate, purchase_price_ex_vat, sale_price_ex_vat, sale_price_inc_vat,
        production_method, latin_name, fao_zone, sous_zone, fishing_gear, allergens,
        created_by, updated_by
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, 'duplicate',
        $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23, $23
      )
      RETURNING id
      `,
      articleInsertParams(req.user.store_id, data, req.user.id)
    );

    if (article.department_id) {
      await upsertLegacyDepartment(
        client,
        created.rows[0].id,
        req.user.store_id,
        req.user.id,
        article.department_id,
        data
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ ok: true, message: 'Article duplique avec succes', id: created.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/articles/:id/duplicate :', err);
    if (err.code === '23505') return res.status(400).json({ error: articleUniqueViolationMessage(err, 'Le nouveau PLU existe deja') });
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

router.delete('/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const articleId = cleanUuid(req.params.id);
    if (!articleId || !isUuid(articleId)) return res.status(400).json({ error: 'ID article invalide' });

    await client.query('BEGIN');

    const result = await client.query(
      `
      UPDATE articles
      SET is_active = false,
          updated_by = $1,
          updated_at = NOW()
      WHERE id = $2
        AND store_id = $3
      RETURNING id
      `,
      [req.user.id, articleId, req.user.store_id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Article introuvable' });
    }

    await client.query(
      `UPDATE article_departments SET is_active = false, updated_by = $1, updated_at = NOW() WHERE article_id = $2`,
      [req.user.id, articleId]
    );

    await client.query('COMMIT');
    res.json({ ok: true, message: 'Article desactive' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur DELETE /api/articles/:id :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

module.exports = router;
