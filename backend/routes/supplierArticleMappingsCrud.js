const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');

const router = express.Router();

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function cleanBool(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return defaultValue;
}

function mappingSelectSql() {
  return `
    SELECT
      sam.id,
      sam.store_id,
      sam.supplier_id,
      s.code supplier_code,
      s.name supplier_name,
      sam.article_id,
      a.plu article_plu,
      a.designation article_designation,
      sam.supplier_ref,
      sam.supplier_label,
      sam.purchase_unit,
      sam.price_unit,
      COALESCE(sam.is_active, true) is_active
    FROM supplier_article_mappings sam
    JOIN suppliers s
      ON s.id = sam.supplier_id
     AND s.store_id = sam.store_id
    JOIN articles a
      ON a.id = sam.article_id
     AND a.store_id = sam.store_id
  `;
}

async function getMappingById(client, storeId, mappingId) {
  const result = await client.query(
    `
    ${mappingSelectSql()}
    WHERE sam.store_id = $1
      AND sam.id = $2
    LIMIT 1
    `,
    [storeId, mappingId]
  );
  return result.rows[0] || null;
}

async function assertSupplier(client, storeId, supplierId) {
  const result = await client.query(
    `
    SELECT id, code, name
    FROM suppliers
    WHERE id = $1
      AND store_id = $2
    LIMIT 1
    `,
    [supplierId, storeId]
  );
  return result.rows[0] || null;
}

async function assertArticle(client, storeId, articleId) {
  const result = await client.query(
    `
    SELECT id, plu, designation
    FROM articles
    WHERE id = $1
      AND store_id = $2
    LIMIT 1
    `,
    [articleId, storeId]
  );
  return result.rows[0] || null;
}

async function findActiveDuplicate(client, storeId, supplierId, supplierRef, excludeId = null) {
  const params = [storeId, supplierId, supplierRef];
  let excludeSql = '';
  if (excludeId) {
    params.push(excludeId);
    excludeSql = `AND id <> $${params.length}`;
  }

  const result = await client.query(
    `
    SELECT id
    FROM supplier_article_mappings
    WHERE store_id = $1
      AND supplier_id = $2
      AND LOWER(TRIM(supplier_ref)) = LOWER(TRIM($3))
      AND COALESCE(is_active, true) = true
      ${excludeSql}
    LIMIT 1
    `,
    params
  );
  return result.rows[0] || null;
}

router.get('/supplier-article-mappings', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const params = [req.user.store_id];
    const where = ['sam.store_id = $1'];

    if (req.query.supplier_id) {
      params.push(String(req.query.supplier_id));
      where.push(`sam.supplier_id = $${params.length}`);
    }

    const status = cleanText(req.query.status) || 'active';
    if (status !== 'all') {
      params.push(status !== 'inactive');
      where.push(`COALESCE(sam.is_active, true) = $${params.length}`);
    }

    const search = cleanText(req.query.search);
    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      where.push(`(
        sam.supplier_ref ILIKE $${idx}
        OR COALESCE(sam.supplier_label, '') ILIKE $${idx}
        OR s.code ILIKE $${idx}
        OR s.name ILIKE $${idx}
        OR a.plu ILIKE $${idx}
        OR a.designation ILIKE $${idx}
      )`);
    }

    const limit = Math.min(Number(req.query.limit || 300), 1000);
    params.push(limit);

    const result = await req.dbPool.query(
      `
      ${mappingSelectSql()}
      WHERE ${where.join(' AND ')}
      ORDER BY s.name ASC, sam.supplier_ref ASC
      LIMIT $${params.length}
      `,
      params
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Erreur liste AF_MAP :', error);
    res.status(500).json({ error: 'Erreur liste AF_MAP' });
  }
});

router.post('/supplier-article-mappings', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const supplierId = cleanText(req.body?.supplier_id);
    const articleId = cleanText(req.body?.article_id);
    const supplierRef = cleanText(req.body?.supplier_ref);

    if (!supplierId || !articleId || !supplierRef) {
      return res.status(400).json({ error: 'Fournisseur, article et référence fournisseur sont obligatoires' });
    }

    const [supplier, article] = await Promise.all([
      assertSupplier(req.dbPool, req.user.store_id, supplierId),
      assertArticle(req.dbPool, req.user.store_id, articleId),
    ]);

    if (!supplier) return res.status(404).json({ error: 'Fournisseur introuvable' });
    if (!article) return res.status(404).json({ error: 'Article introuvable' });

    const duplicate = await findActiveDuplicate(req.dbPool, req.user.store_id, supplierId, supplierRef);
    if (duplicate) {
      return res.status(400).json({ error: 'Mapping actif déjà existant pour ce fournisseur et cette référence' });
    }

    const result = await req.dbPool.query(
      `
      INSERT INTO supplier_article_mappings (
        store_id,
        supplier_id,
        article_id,
        supplier_ref,
        supplier_label,
        purchase_unit,
        price_unit,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
      `,
      [
        req.user.store_id,
        supplierId,
        articleId,
        supplierRef,
        cleanText(req.body?.supplier_label),
        cleanText(req.body?.purchase_unit),
        cleanText(req.body?.price_unit),
        cleanBool(req.body?.is_active, true),
      ]
    );

    const mapping = await getMappingById(req.dbPool, req.user.store_id, result.rows[0].id);
    res.status(201).json(mapping);
  } catch (error) {
    console.error('Erreur création AF_MAP :', error);
    res.status(500).json({ error: 'Erreur création AF_MAP' });
  }
});

router.patch('/supplier-article-mappings/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const current = await getMappingById(req.dbPool, req.user.store_id, req.params.id);
    if (!current) return res.status(404).json({ error: 'Mapping AF_MAP introuvable' });

    const supplierId = cleanText(req.body?.supplier_id) || current.supplier_id;
    const articleId = cleanText(req.body?.article_id) || current.article_id;
    const supplierRef = cleanText(req.body?.supplier_ref);
    if (!supplierRef) return res.status(400).json({ error: 'Référence fournisseur obligatoire' });

    const [supplier, article] = await Promise.all([
      assertSupplier(req.dbPool, req.user.store_id, supplierId),
      assertArticle(req.dbPool, req.user.store_id, articleId),
    ]);

    if (!supplier) return res.status(404).json({ error: 'Fournisseur introuvable' });
    if (!article) return res.status(404).json({ error: 'Article introuvable' });

    const duplicate = await findActiveDuplicate(req.dbPool, req.user.store_id, supplierId, supplierRef, req.params.id);
    if (duplicate) {
      return res.status(400).json({ error: 'Mapping actif déjà existant pour ce fournisseur et cette référence' });
    }

    await req.dbPool.query(
      `
      UPDATE supplier_article_mappings
      SET
        supplier_id = $1,
        article_id = $2,
        supplier_ref = $3,
        supplier_label = $4,
        purchase_unit = $5,
        price_unit = $6
      WHERE id = $7
        AND store_id = $8
      `,
      [
        supplierId,
        articleId,
        supplierRef,
        cleanText(req.body?.supplier_label),
        cleanText(req.body?.purchase_unit),
        cleanText(req.body?.price_unit),
        req.params.id,
        req.user.store_id,
      ]
    );

    const mapping = await getMappingById(req.dbPool, req.user.store_id, req.params.id);
    res.json(mapping);
  } catch (error) {
    console.error('Erreur modification AF_MAP :', error);
    res.status(500).json({ error: 'Erreur modification AF_MAP' });
  }
});

router.patch('/supplier-article-mappings/:id/status', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const isActive = cleanBool(req.body?.is_active, true);
    const result = await req.dbPool.query(
      `
      UPDATE supplier_article_mappings
      SET is_active = $1
      WHERE id = $2
        AND store_id = $3
      RETURNING id
      `,
      [isActive, req.params.id, req.user.store_id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Mapping AF_MAP introuvable' });

    const mapping = await getMappingById(req.dbPool, req.user.store_id, req.params.id);
    res.json(mapping);
  } catch (error) {
    console.error('Erreur statut AF_MAP :', error);
    res.status(500).json({ error: 'Erreur statut AF_MAP' });
  }
});

module.exports = router;