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
      department_id = '',
      limit = '200',
      offset = '0',
    } = req.query;

    const familyCode = family || sector;
    const activeValue = normalizeBool(active);
    const safeLimit = Math.min(Number(limit) || 200, 500);
    const safeOffset = Number(offset) || 0;

    const params = [req.user.store_id];
    let where = 'WHERE a.store_id = $1';

    if (department_id) {
      params.push(department_id);
      where += ` AND ad.department_id = $${params.length}`;
    }

    if (familyCode) {
      params.push(familyCode);
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
        ad.display_name,
        ad.purchase_unit,
        ad.stock_unit,
        ad.sale_unit,
        ad.vat_rate,
        ad.purchase_price_ex_vat,
        ad.sale_price_ex_vat,
        ad.sale_price_inc_vat,

        ds.code AS family_code,
        ds.name AS family_name,

        adm.category,
        adm.latin_name,
        adm.fao_zone,
        adm.sous_zone,
        adm.engin,
        adm.allergenes,
        COALESCE(adm.raw_source, '{}'::jsonb) AS raw_source
      FROM articles a
      JOIN article_departments ad ON ad.article_id = a.id
      JOIN departments d ON d.id = ad.department_id
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
    const { department_id = '' } = req.query;

    const params = [];
    let where = 'WHERE ds.is_active = true';

    if (department_id) {
      params.push(department_id);
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
    const { q = '', department_id = '' } = req.query;
    const searchTerm = String(q).trim();

    if (!department_id) {
      return res.status(400).json({ error: 'department_id est obligatoire' });
    }

    if (!searchTerm) {
      return res.json([]);
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
        a.unit,
        ad.sale_unit,
        ad.vat_rate,
        ad.sale_price_ex_vat,
        ad.sale_price_inc_vat
      FROM articles a
      JOIN article_departments ad ON ad.article_id = a.id
      WHERE a.store_id = $1
        AND ad.department_id = $2
        AND a.is_active = true
        AND ad.is_active = true
        AND (
          a.plu ILIKE $3
          OR a.designation ILIKE $3
          OR COALESCE(ad.display_name, '') ILIKE $3
          OR COALESCE(a.ean, '') ILIKE $3
        )
      ORDER BY
        CASE WHEN a.plu = $4 THEN 0 ELSE 1 END,
        CASE WHEN a.plu ILIKE $5 THEN 0 ELSE 1 END,
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

    if (!department_id || !toNullableString(plu) || !toNullableString(designation)) {
      return res.status(400).json({
        error: 'department_id, plu et designation sont obligatoires',
      });
    }

    await client.query('BEGIN');

    const department = await assertDepartmentBelongsToStore(client, department_id, req.user.store_id);

    if (!department) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Service invalide pour ce client' });
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

    if (!department_id || !toNullableString(plu) || !toNullableString(designation)) {
      return res.status(400).json({
        error: 'department_id, plu et designation sont obligatoires',
      });
    }

    await client.query('BEGIN');

    const department = await assertDepartmentBelongsToStore(client, department_id, req.user.store_id);

    if (!department) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Service invalide pour ce client' });
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
        updated_by = $6
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
      ]
    );

    if (articleUpdate.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Article introuvable' });
    }

    const selectedFamilyCode = family_code || sector_code;
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

    const articleDepartmentId = articleDepartmentUpdate.rows[0].id;

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