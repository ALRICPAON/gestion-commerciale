const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const CORE_COLUMNS = [
  'action',
  'id',
  'plu',
  'designation',
  'display_name',
  'latin_name',
  'fao_zone',
  'sous_zone',
  'fishing_gear',
  'production_method',
  'allergens',
  'purchase_unit',
  'stock_unit',
  'sale_unit',
  'vat_rate',
  'sale_price_level_1_ht',
  'sale_price_level_2_ht',
  'sale_price_level_3_ht',
  'is_active',
  'created_at',
  'updated_at',
];

const OPTIONAL_BUSINESS_COLUMNS = [
  'ean',
  'unit',
  'category',
  'family',
  'subfamily',
  'brand',
  'origin',
  'caliber',
  'packaging',
  'description',
];

const ARTICLE_IMPORT_COLUMNS = [
  'plu',
  'designation',
  'ean',
  'unit',
  'display_name',
  'latin_name',
  'fao_zone',
  'sous_zone',
  'fishing_gear',
  'allergens',
  'production_method',
  'sale_price_level_1_ht',
  'sale_price_level_2_ht',
  'sale_price_level_3_ht',
  'category',
  'family',
  'subfamily',
  'brand',
  'origin',
  'caliber',
  'packaging',
  'description',
  'is_active',
];

const DEPARTMENT_COLUMNS = [
  'display_name',
  'purchase_unit',
  'stock_unit',
  'sale_unit',
  'vat_rate',
  'sale_price_ex_vat',
  'sale_price_inc_vat',
];

function clean(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function boolValue(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const s = String(value).trim().toLowerCase();
  if (['true', '1', 'oui', 'yes', 'y', 'actif', 'active'].includes(s)) return true;
  if (['false', '0', 'non', 'no', 'n', 'inactif', 'inactive'].includes(s)) return false;
  return fallback;
}

function numberValue(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function normalizeAction(value) {
  const action = String(value || 'ignore').trim().toLowerCase();
  return ['update', 'create', 'disable', 'ignore'].includes(action) ? action : null;
}

function excelDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

async function tableColumns(db, tableName) {
  const result = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
}

async function defaultDepartmentId(db, storeId) {
  const result = await db.query(
    `SELECT id FROM departments WHERE store_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [storeId]
  );
  return result.rows[0]?.id || null;
}

async function sectorIdForFamily(db, departmentId, familyCode) {
  const code = clean(familyCode);
  if (!departmentId || !code) return null;
  const result = await db.query(
    `SELECT id FROM department_sectors WHERE department_id = $1 AND code = $2 AND is_active = true LIMIT 1`,
    [departmentId, code]
  );
  return result.rows[0]?.id || null;
}

async function findArticleByIdOrPlu(db, storeId, row) {
  const id = clean(row.id);
  const plu = clean(row.plu);
  if (id) {
    const result = await db.query(`SELECT * FROM articles WHERE id = $1 AND store_id = $2 LIMIT 1`, [id, storeId]);
    if (result.rows.length) return result.rows[0];
  }
  if (plu) {
    const result = await db.query(`SELECT * FROM articles WHERE plu = $1 AND store_id = $2 LIMIT 1`, [plu, storeId]);
    if (result.rows.length) return result.rows[0];
  }
  return null;
}

function buildArticlePayload(row, articleColumns, { creating = false } = {}) {
  const payload = {};

  for (const column of ARTICLE_IMPORT_COLUMNS) {
    if (!articleColumns.has(column)) continue;
    if (!(column in row)) continue;

    if (column === 'is_active') {
      const parsed = boolValue(row[column], creating ? true : null);
      if (parsed !== null) payload[column] = parsed;
    } else if (column.startsWith('sale_price_level_')) {
      payload[column] = numberValue(row[column]);
    } else {
      payload[column] = clean(row[column]);
    }
  }

  if (creating) {
    if (articleColumns.has('source_origin')) payload.source_origin = 'excel_import';
    if (articleColumns.has('is_active') && payload.is_active === undefined) payload.is_active = true;
    if (articleColumns.has('unit') && !payload.unit) payload.unit = 'kg';
  }

  return payload;
}

function buildSetClause(payload, startIndex = 1) {
  const entries = Object.entries(payload);
  const assignments = entries.map(([column], index) => `${column} = $${startIndex + index}`);
  const values = entries.map(([, value]) => value);
  return { assignments, values, nextIndex: startIndex + entries.length };
}

async function upsertArticleDepartment(db, articleId, storeId, row, userId) {
  const departmentId = await defaultDepartmentId(db, storeId);
  if (!departmentId) throw new Error('Aucun service disponible pour rattacher l article');

  const selectedFamily = clean(row.family) || clean(row.family_code) || clean(row.category);
  const sectorId = await sectorIdForFamily(db, departmentId, selectedFamily);
  const salePriceExVat = numberValue(row.sale_price_ex_vat ?? row.sale_price_level_1_ht);
  const payload = {
    department_sector_id: sectorId,
    display_name: clean(row.display_name),
    purchase_unit: clean(row.purchase_unit),
    stock_unit: clean(row.stock_unit),
    sale_unit: clean(row.sale_unit),
    vat_rate: numberValue(row.vat_rate) ?? 5.5,
    sale_price_ex_vat: salePriceExVat,
    sale_price_inc_vat: numberValue(row.sale_price_inc_vat),
    is_active: boolValue(row.is_active, true),
    updated_by: userId,
  };

  const existing = await db.query(
    `SELECT id FROM article_departments WHERE article_id = $1 AND department_id = $2 LIMIT 1`,
    [articleId, departmentId]
  );

  if (existing.rows.length) {
    const { assignments, values } = buildSetClause(payload, 1);
    await db.query(
      `UPDATE article_departments SET ${assignments.join(', ')}, updated_at = NOW() WHERE id = $${values.length + 1}`,
      [...values, existing.rows[0].id]
    );
    return existing.rows[0].id;
  }

  const insertPayload = {
    article_id: articleId,
    department_id: departmentId,
    ...payload,
    created_by: userId,
  };
  const columns = Object.keys(insertPayload);
  const values = Object.values(insertPayload);
  const placeholders = values.map((_, index) => `$${index + 1}`);
  const inserted = await db.query(
    `INSERT INTO article_departments (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
    values
  );
  return inserted.rows[0].id;
}

async function upsertMetadata(db, articleDepartmentId, row) {
  if (!articleDepartmentId) return;
  await db.query(
    `INSERT INTO article_department_metadata (
      article_department_id, field_key, category, latin_name, fao_zone, sous_zone, engin, allergenes, raw_source
    ) VALUES ($1, 'business_metadata', $2, $3, $4, $5, $6, $7, '{}'::jsonb)
    ON CONFLICT (article_department_id, field_key)
    DO UPDATE SET
      category = EXCLUDED.category,
      latin_name = EXCLUDED.latin_name,
      fao_zone = EXCLUDED.fao_zone,
      sous_zone = EXCLUDED.sous_zone,
      engin = EXCLUDED.engin,
      allergenes = EXCLUDED.allergenes,
      updated_at = NOW()`,
    [
      articleDepartmentId,
      clean(row.category) || clean(row.production_method),
      clean(row.latin_name),
      clean(row.fao_zone),
      clean(row.sous_zone),
      clean(row.fishing_gear) || clean(row.engin),
      clean(row.allergens) || clean(row.allergenes),
    ]
  );
}

async function disableArticle(db, articleId, storeId, userId) {
  const result = await db.query(
    `UPDATE articles SET is_active = false, updated_by = $1, updated_at = NOW() WHERE id = $2 AND store_id = $3 RETURNING id`,
    [userId, articleId, storeId]
  );
  if (!result.rows.length) throw new Error('Article introuvable pour desactivation');
  await db.query(
    `UPDATE article_departments SET is_active = false, updated_by = $1, updated_at = NOW() WHERE article_id = $2`,
    [userId, articleId]
  );
}

router.get('/export.xlsx', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const articleColumns = await tableColumns(req.dbPool, 'articles');
    const optionalColumns = OPTIONAL_BUSINESS_COLUMNS.filter((column) => articleColumns.has(column));
    const columns = [...CORE_COLUMNS, ...optionalColumns.filter((column) => !CORE_COLUMNS.includes(column))];

    const result = await req.dbPool.query(
      `SELECT
        a.*,
        ad.display_name AS ad_display_name,
        ad.purchase_unit AS ad_purchase_unit,
        ad.stock_unit AS ad_stock_unit,
        ad.sale_unit AS ad_sale_unit,
        ad.vat_rate AS ad_vat_rate,
        ad.sale_price_ex_vat AS ad_sale_price_ex_vat,
        ad.sale_price_inc_vat AS ad_sale_price_inc_vat,
        ds.code AS family_code,
        ds.name AS family_name,
        adm.category AS metadata_category,
        adm.latin_name AS metadata_latin_name,
        adm.fao_zone AS metadata_fao_zone,
        adm.sous_zone AS metadata_sous_zone,
        adm.engin AS metadata_fishing_gear,
        adm.allergenes AS metadata_allergens,
        adm.raw_source AS metadata_raw_source
       FROM articles a
       LEFT JOIN article_departments ad ON ad.article_id = a.id AND ad.id = (
         SELECT ad_pick.id
         FROM article_departments ad_pick
         WHERE ad_pick.article_id = a.id
         ORDER BY CASE WHEN ad_pick.is_active = true THEN 0 ELSE 1 END, ad_pick.updated_at DESC NULLS LAST, ad_pick.created_at DESC NULLS LAST
         LIMIT 1
       )
       LEFT JOIN department_sectors ds ON ds.id = ad.department_sector_id
       LEFT JOIN article_department_metadata adm ON adm.article_department_id = ad.id AND adm.field_key = 'business_metadata'
       WHERE a.store_id = $1
       ORDER BY a.designation ASC`,
      [req.user.store_id]
    );

    const rows = result.rows.map((article) => {
      const rawSource = article.metadata_raw_source || {};
      const row = {
        action: 'ignore',
        id: article.id,
        plu: article.plu ? String(article.plu) : '',
        designation: article.designation || '',
        display_name: article.display_name || article.ad_display_name || '',
        latin_name: article.latin_name || article.metadata_latin_name || '',
        fao_zone: article.fao_zone || article.metadata_fao_zone || '',
        sous_zone: article.sous_zone || article.metadata_sous_zone || '',
        fishing_gear: article.fishing_gear || article.metadata_fishing_gear || '',
        production_method: article.production_method || rawSource.production_method || rawSource.method_production || article.metadata_category || '',
        allergens: article.allergens || article.metadata_allergens || '',
        purchase_unit: article.purchase_unit || article.ad_purchase_unit || '',
        stock_unit: article.stock_unit || article.ad_stock_unit || '',
        sale_unit: article.sale_unit || article.ad_sale_unit || '',
        vat_rate: article.vat_rate ?? article.ad_vat_rate ?? '',
        sale_price_level_1_ht: article.sale_price_level_1_ht ?? article.ad_sale_price_ex_vat ?? '',
        sale_price_level_2_ht: article.sale_price_level_2_ht ?? '',
        sale_price_level_3_ht: article.sale_price_level_3_ht ?? '',
        is_active: article.is_active === false ? false : true,
        created_at: excelDate(article.created_at),
        updated_at: excelDate(article.updated_at),
      };

      for (const column of optionalColumns) {
        if (column === 'category') row[column] = article.category || article.metadata_category || '';
        else if (column === 'family') row[column] = article.family || article.family_code || article.family_name || '';
        else row[column] = article[column] ?? '';
      }

      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(rows, { header: columns });
    worksheet['!cols'] = columns.map((column) => ({ wch: column === 'designation' || column === 'display_name' ? 32 : 18 }));
    for (let rowIndex = 2; rowIndex <= rows.length + 1; rowIndex += 1) {
      const cell = worksheet[`C${rowIndex}`];
      if (cell) cell.t = 's';
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Articles');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="articles-export.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error('Erreur export Excel articles :', err);
    res.status(500).json({ error: 'Erreur export Excel articles' });
  }
});

router.post('/import.xlsx', authenticateToken, attachDbContext, requireAdminOrManager, upload.single('file'), async (req, res) => {
  const db = await req.dbPool.connect();
  const summary = { created: 0, updated: 0, disabled: 0, ignored: 0, errors: [] };

  try {
    if (!req.file?.buffer) return res.status(400).json({ error: 'Fichier Excel manquant' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) return res.status(400).json({ error: 'Fichier Excel vide' });

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: '', raw: false });
    if (!rows.length) return res.status(400).json({ error: 'Aucune ligne article a importer' });

    const articleColumns = await tableColumns(db, 'articles');
    await db.query('BEGIN');

    for (const [index, row] of rows.entries()) {
      const excelLine = index + 2;
      try {
        const action = normalizeAction(row.action);
        if (!action) throw new Error('action invalide : utiliser update, create, disable ou ignore');
        if (action === 'ignore') {
          summary.ignored += 1;
          continue;
        }

        const existing = await findArticleByIdOrPlu(db, req.user.store_id, row);

        if (action === 'disable') {
          if (!existing) throw new Error('article introuvable pour disable');
          await disableArticle(db, existing.id, req.user.store_id, req.user.id);
          summary.disabled += 1;
          continue;
        }

        if (action === 'update') {
          if (!clean(row.id)) throw new Error('id obligatoire pour update');
          if (!existing) throw new Error('article introuvable pour update');
          const payload = buildArticlePayload(row, articleColumns);
          payload.updated_by = req.user.id;
          const { assignments, values } = buildSetClause(payload, 1);
          if (assignments.length) {
            await db.query(
              `UPDATE articles SET ${assignments.join(', ')}, updated_at = NOW() WHERE id = $${values.length + 1} AND store_id = $${values.length + 2}`,
              [...values, existing.id, req.user.store_id]
            );
          }
          const articleDepartmentId = await upsertArticleDepartment(db, existing.id, req.user.store_id, row, req.user.id);
          await upsertMetadata(db, articleDepartmentId, row);
          summary.updated += 1;
          continue;
        }

        if (action === 'create') {
          if (clean(row.id)) throw new Error('id doit etre vide pour create');
          if (!clean(row.plu) || !clean(row.designation)) throw new Error('plu et designation obligatoires pour create');
          if (existing) throw new Error('PLU deja existant : utiliser update ou changer le PLU');
          const payload = buildArticlePayload(row, articleColumns, { creating: true });
          payload.store_id = req.user.store_id;
          payload.created_by = req.user.id;
          payload.updated_by = req.user.id;
          const columns = Object.keys(payload);
          const values = Object.values(payload);
          const placeholders = values.map((_, valueIndex) => `$${valueIndex + 1}`);
          const inserted = await db.query(
            `INSERT INTO articles (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
            values
          );
          const articleDepartmentId = await upsertArticleDepartment(db, inserted.rows[0].id, req.user.store_id, row, req.user.id);
          await upsertMetadata(db, articleDepartmentId, row);
          summary.created += 1;
        }
      } catch (err) {
        summary.errors.push({ line: excelLine, plu: clean(row.plu), error: err.message });
      }
    }

    if (summary.errors.length) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'Import annule : certaines lignes sont en erreur', summary });
    }

    await db.query('COMMIT');
    res.json({ ok: true, summary });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur import Excel articles :', err);
    res.status(500).json({ error: err.message || 'Erreur import Excel articles', summary });
  } finally {
    db.release();
  }
});

router.delete('/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();
  try {
    await db.query('BEGIN');
    await disableArticle(db, req.params.id, req.user.store_id, req.user.id);
    await db.query('COMMIT');
    res.json({ ok: true, message: 'Article desactive sans suppression physique' });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur desactivation article :', err);
    res.status(404).json({ error: err.message || 'Article introuvable' });
  } finally {
    db.release();
  }
});

module.exports = router;
