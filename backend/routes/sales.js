const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const { recomputeArticleStock } = require('../services/stockService');
const { toNullableString } = require('../utils/valueHelpers');

// LISTE DOCUMENTS DE VENTE / SORTIE
router.get('/', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const {
      department_id = '',
      status = '',
      document_type = '',
      limit = '50',
    } = req.query;

    if (!department_id) {
      return res.status(400).json({ error: 'department_id obligatoire' });
    }

    const safeLimit = Math.min(Number(limit) || 50, 200);

    const departmentCheck = await req.dbPool.query(
      `
      SELECT id
      FROM departments
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [department_id, req.user.store_id]
    );

    if (departmentCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Rayon invalide pour ce magasin' });
    }

    const params = [req.user.store_id, department_id];
    let where = `
      WHERE sd.store_id = $1
        AND sd.department_id = $2
    `;

    if (status) {
      params.push(status);
      where += ` AND sd.status = $${params.length}`;
    }

    if (document_type) {
      params.push(document_type);
      where += ` AND sd.document_type = $${params.length}`;
    }

    params.push(safeLimit);

    const result = await req.dbPool.query(
      `
      SELECT
        sd.id,
        sd.document_date,
        sd.status,
        sd.document_type,
        sd.origin,
        sd.reference_number,
        sd.source_inventory_date,
        sd.notes,
        sd.created_at,
        COUNT(sl.id) AS line_count
      FROM sales_documents sd
      LEFT JOIN sales_lines sl ON sl.sales_document_id = sd.id
      ${where}
      GROUP BY sd.id
      ORDER BY sd.created_at DESC
      LIMIT $${params.length}
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/sales :', err);
    res.status(500).json({ error: 'Erreur serveur ventes' });
  }
});

// CREER DOCUMENT DE VENTE / SORTIE
router.post('/', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const {
      department_id,
      document_date,
      document_type = 'manual_sale',
      origin = 'manual',
      reference_number,
      source_inventory_date,
      notes,
    } = req.body;

    if (!department_id) {
      return res.status(400).json({ error: 'department_id obligatoire' });
    }

    const allowedTypes = ['inventory_sale', 'manual_sale', 'transfer_out', 'waste'];
    if (!allowedTypes.includes(document_type)) {
      return res.status(400).json({ error: 'document_type invalide' });
    }

    const allowedOrigins = ['inventory_import', 'manual', 'interdepartment', 'adjustment'];
    if (!allowedOrigins.includes(origin)) {
      return res.status(400).json({ error: 'origin invalide' });
    }

    await client.query('BEGIN');

    const departmentCheck = await client.query(
      `
      SELECT id
      FROM departments
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [department_id, req.user.store_id]
    );

    if (departmentCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Rayon invalide pour ce magasin' });
    }

    const result = await client.query(
      `
      INSERT INTO sales_documents (
        id,
        store_id,
        department_id,
        document_date,
        status,
        document_type,
        origin,
        reference_number,
        source_inventory_date,
        notes,
        created_by,
        updated_by
      )
      VALUES (
        gen_random_uuid(),
        $1, $2,
        COALESCE($3::date, CURRENT_DATE),
        'draft',
        $4,
        $5,
        $6,
        $7::date,
        $8,
        $9,
        $9
      )
      RETURNING *
      `,
      [
        req.user.store_id,
        department_id,
        document_date || null,
        document_type,
        origin,
        toNullableString(reference_number),
        source_inventory_date || null,
        toNullableString(notes),
        req.user.id,
      ]
    );

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      sale: result.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/sales :', err);
    res.status(500).json({ error: 'Erreur création document vente' });
  } finally {
    client.release();
  }
});

// DETAIL DOCUMENT DE VENTE / SORTIE
router.get('/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const saleId = req.params.id;

    const saleResult = await req.dbPool.query(
      `
      SELECT
        sd.*
      FROM sales_documents sd
      WHERE sd.id = $1
        AND sd.store_id = $2
      LIMIT 1
      `,
      [saleId, req.user.store_id]
    );

    if (saleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Document de vente introuvable' });
    }

    const linesResult = await req.dbPool.query(
      `
      SELECT
        sl.*,
        a.plu AS article_plu,
        a.designation AS article_name
      FROM sales_lines sl
      LEFT JOIN articles a ON a.id = sl.article_id
      WHERE sl.sales_document_id = $1
      ORDER BY sl.line_number ASC
      `,
      [saleId]
    );

    res.json({
      sale: saleResult.rows[0],
      lines: linesResult.rows,
    });
  } catch (err) {
    console.error('Erreur GET /api/sales/:id :', err);
    res.status(500).json({ error: 'Erreur détail document vente' });
  }
});

// MODIFIER UNE LIGNE DE VENTE / SORTIE
router.patch('/lines/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const lineId = req.params.id;
    const {
      article_id,
      article_plu,
      sold_quantity,
      sale_unit,
      unit_sale_price_ttc,
      unit_sale_price_ht,
      unit_cost_ex_vat,
      line_reason,
      ean,
      article_label,
      source_inventory_line,
      line_status,
    } = req.body;

    await client.query('BEGIN');

    const lineCheck = await client.query(
      `
      SELECT
        sl.id,
        sl.sales_document_id,
        sl.article_id AS old_article_id,
        sd.store_id,
        sd.department_id,
        sd.status AS sale_status
      FROM sales_lines sl
      JOIN sales_documents sd ON sd.id = sl.sales_document_id
      WHERE sl.id = $1
        AND sd.store_id = $2
      LIMIT 1
      `,
      [lineId, req.user.store_id]
    );

    if (lineCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ligne de vente introuvable' });
    }

    const currentLine = lineCheck.rows[0];

    if (currentLine.sale_status !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Impossible de modifier une ligne sur un document non brouillon',
      });
    }

    let finalArticleId = article_id || currentLine.old_article_id || null;
    let article = null;

    if (!finalArticleId && article_plu) {
      const articleByPluResult = await client.query(
        `
        SELECT id
        FROM articles
        WHERE store_id = $1
          AND plu = $2
        LIMIT 1
        `,
        [req.user.store_id, String(article_plu).trim()]
      );

      if (articleByPluResult.rows.length > 0) {
        finalArticleId = articleByPluResult.rows[0].id;
      }
    }

    if (finalArticleId) {
      const articleResult = await client.query(
        `
        SELECT
          a.id,
          a.plu,
          a.designation,
          a.ean,
          a.unit,
          ad.sale_unit
        FROM articles a
        LEFT JOIN article_departments ad
          ON ad.article_id = a.id
         AND ad.department_id = $2
        WHERE a.id = $1
          AND a.store_id = $3
        LIMIT 1
        `,
        [finalArticleId, currentLine.department_id, req.user.store_id]
      );

      if (articleResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Article introuvable' });
      }

      article = articleResult.rows[0];
    }

    if (!finalArticleId && (article_id || article_plu)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Article introuvable' });
    }

    const finalEan = toNullableString(ean) || article?.ean || null;
    const finalArticleLabel = toNullableString(article_label) || article?.designation || null;

    const finalSaleUnit = ['kg', 'piece', 'colis'].includes(sale_unit)
      ? sale_unit
      : (article?.sale_unit || article?.unit || 'kg');

    const safeSoldQuantity =
      sold_quantity !== undefined && sold_quantity !== null && sold_quantity !== ''
        ? Number(sold_quantity)
        : 0;

    const safeUnitSalePriceTtc =
      unit_sale_price_ttc !== undefined && unit_sale_price_ttc !== null && unit_sale_price_ttc !== ''
        ? Number(unit_sale_price_ttc)
        : 0;

    const safeUnitSalePriceHt =
      unit_sale_price_ht !== undefined && unit_sale_price_ht !== null && unit_sale_price_ht !== ''
        ? Number(unit_sale_price_ht)
        : Number((safeUnitSalePriceTtc / 1.055).toFixed(4));

    const safeUnitCostExVat =
      unit_cost_ex_vat !== undefined && unit_cost_ex_vat !== null && unit_cost_ex_vat !== ''
        ? Number(unit_cost_ex_vat)
        : 0;

    const allowedLineStatuses = ['pending', 'cancelled'];
    const finalLineStatus =
      line_status && allowedLineStatuses.includes(line_status)
        ? line_status
        : 'pending';

    const updateResult = await client.query(
      `
      UPDATE sales_lines
      SET
        article_id = $1,
        ean = $2,
        article_label = $3,
        sold_quantity = $4::numeric,
        sale_unit = $5,
        unit_sale_price_ttc = $6::numeric,
        unit_sale_price_ht = $7::numeric,
        unit_cost_ex_vat = $8::numeric,
        line_reason = $9,
        line_status = $10,
        source_inventory_line = $11::jsonb,
        updated_at = NOW()
      WHERE id = $12
      RETURNING *
      `,
      [
        finalArticleId,
        finalEan,
        finalArticleLabel,
        safeSoldQuantity,
        finalSaleUnit,
        safeUnitSalePriceTtc,
        safeUnitSalePriceHt,
        safeUnitCostExVat,
        toNullableString(line_reason),
        finalLineStatus,
        JSON.stringify(source_inventory_line || {}),
        lineId,
      ]
    );

    await client.query(
      `
      INSERT INTO sales_line_metadata (
        id,
        sales_line_id,
        meta_key,
        meta_value,
        notes
      )
      VALUES (
        gen_random_uuid(),
        $1,
        'v2_line',
        $2::jsonb,
        NULL
      )
      ON CONFLICT (sales_line_id, meta_key)
      DO UPDATE SET
        meta_value = EXCLUDED.meta_value,
        updated_at = NOW()
      `,
      [
        lineId,
        JSON.stringify(source_inventory_line || {}),
      ]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      line: updateResult.rows[0],
      article,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur PATCH /api/sales/lines/:id :', err);
    res.status(500).json({ error: 'Erreur mise à jour ligne vente' });
  } finally {
    client.release();
  }
});

// SUPPRIMER UNE LIGNE DE VENTE / SORTIE
router.delete('/lines/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const lineId = req.params.id;

    await client.query('BEGIN');

    const lineCheck = await client.query(
      `
      SELECT
        sl.id,
        sl.sales_document_id,
        sd.status AS sale_status,
        sd.store_id
      FROM sales_lines sl
      JOIN sales_documents sd ON sd.id = sl.sales_document_id
      WHERE sl.id = $1
        AND sd.store_id = $2
      LIMIT 1
      `,
      [lineId, req.user.store_id]
    );

    if (lineCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ligne de vente introuvable' });
    }

    const currentLine = lineCheck.rows[0];

    if (currentLine.sale_status !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Impossible de supprimer une ligne sur un document non brouillon',
      });
    }

    await client.query(
      `
      DELETE FROM sales_lines
      WHERE id = $1
      `,
      [lineId]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Ligne de vente supprimée avec succès',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur DELETE /api/sales/lines/:id :', err);
    res.status(500).json({ error: 'Erreur suppression ligne vente' });
  } finally {
    client.release();
  }
});

// MODIFIER EN-TETE DOCUMENT DE VENTE / SORTIE
router.patch('/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const saleId = req.params.id;
    const {
      document_date,
      status,
      document_type,
      origin,
      reference_number,
      source_inventory_date,
      notes,
    } = req.body;

    await client.query('BEGIN');

    const saleCheck = await client.query(
      `
      SELECT id, status
      FROM sales_documents
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [saleId, req.user.store_id]
    );

    if (saleCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Document de vente introuvable' });
    }

    const currentSale = saleCheck.rows[0];

    if (currentSale.status === 'validated') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Un document validé ne peut plus être modifié',
      });
    }

    const allowedStatuses = ['draft', 'cancelled'];
    if (status && !allowedStatuses.includes(status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Statut non autorisé manuellement' });
    }

    const allowedTypes = ['inventory_sale', 'manual_sale', 'transfer_out', 'waste'];
    if (document_type && !allowedTypes.includes(document_type)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'document_type invalide' });
    }

    const allowedOrigins = ['inventory_import', 'manual', 'interdepartment', 'adjustment'];
    if (origin && !allowedOrigins.includes(origin)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'origin invalide' });
    }

    const result = await client.query(
      `
      UPDATE sales_documents
      SET
        document_date = COALESCE($1::date, document_date),
        status = COALESCE($2, status),
        document_type = COALESCE($3, document_type),
        origin = COALESCE($4, origin),
        reference_number = $5,
        source_inventory_date = $6::date,
        notes = $7,
        updated_by = $8,
        updated_at = NOW()
      WHERE id = $9
        AND store_id = $10
      RETURNING *
      `,
      [
        document_date || null,
        status || null,
        document_type || null,
        origin || null,
        toNullableString(reference_number),
        source_inventory_date || null,
        toNullableString(notes),
        req.user.id,
        saleId,
        req.user.store_id,
      ]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      sale: result.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur PATCH /api/sales/:id :', err);
    res.status(500).json({ error: 'Erreur mise à jour document vente' });
  } finally {
    client.release();
  }
});

// SUPPRIMER DOCUMENT DE VENTE / SORTIE
router.delete('/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const saleId = req.params.id;

    await client.query('BEGIN');

    const saleCheck = await client.query(
      `
      SELECT id, status
      FROM sales_documents
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [saleId, req.user.store_id]
    );

    if (saleCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Document de vente introuvable' });
    }

    const sale = saleCheck.rows[0];

    if (sale.status === 'validated') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Impossible de supprimer un document validé',
      });
    }

    await client.query(
      `
      DELETE FROM sales_documents
      WHERE id = $1
        AND store_id = $2
      `,
      [saleId, req.user.store_id]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Document de vente supprimé avec succès',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur DELETE /api/sales/:id :', err);
    res.status(500).json({ error: 'Erreur suppression document vente' });
  } finally {
    client.release();
  }
});

// AJOUTER UNE LIGNE A UN DOCUMENT DE VENTE / SORTIE
router.post('/:id/lines', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const saleId = req.params.id;
    const {
      article_id,
      article_plu,
      sold_quantity,
      sale_unit,
      unit_sale_price_ttc,
      unit_sale_price_ht,
      unit_cost_ex_vat,
      line_reason,
      ean,
      article_label,
      source_inventory_line,
    } = req.body;

    await client.query('BEGIN');

    const saleResult = await client.query(
      `
      SELECT id, store_id, department_id, status
      FROM sales_documents
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [saleId, req.user.store_id]
    );

    if (saleResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Document de vente introuvable' });
    }

    const sale = saleResult.rows[0];

    if (sale.status !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Impossible d’ajouter une ligne sur un document non brouillon',
      });
    }

    let finalArticleId = article_id || null;
    let article = null;

    if (!finalArticleId && article_plu) {
      const articleByPluResult = await client.query(
        `
        SELECT id, plu, designation, ean
        FROM articles
        WHERE store_id = $1
          AND plu = $2
        LIMIT 1
        `,
        [req.user.store_id, String(article_plu).trim()]
      );

      if (articleByPluResult.rows.length > 0) {
        finalArticleId = articleByPluResult.rows[0].id;
      }
    }

    if (finalArticleId) {
      const articleResult = await client.query(
        `
        SELECT
          a.id,
          a.plu,
          a.designation,
          a.ean,
          a.unit,
          ad.sale_unit
        FROM articles a
        LEFT JOIN article_departments ad
          ON ad.article_id = a.id
         AND ad.department_id = $2
        WHERE a.id = $1
          AND a.store_id = $3
        LIMIT 1
        `,
        [finalArticleId, sale.department_id, req.user.store_id]
      );

      if (articleResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Article introuvable' });
      }

      article = articleResult.rows[0];
    }

    const finalEan = toNullableString(ean) || article?.ean || null;
    const finalArticleLabel = toNullableString(article_label) || article?.designation || null;

    const nextLineNumberResult = await client.query(
      `
      SELECT COALESCE(MAX(line_number), 0) + 1 AS next_line_number
      FROM sales_lines
      WHERE sales_document_id = $1
      `,
      [saleId]
    );

    const nextLineNumber = nextLineNumberResult.rows[0].next_line_number;

    const finalSaleUnit = ['kg', 'piece', 'colis'].includes(sale_unit)
      ? sale_unit
      : (article?.sale_unit || article?.unit || 'kg');

    const safeSoldQuantity =
      sold_quantity !== undefined && sold_quantity !== null && sold_quantity !== ''
        ? Number(sold_quantity)
        : 0;

    const safeUnitSalePriceTtc =
      unit_sale_price_ttc !== undefined && unit_sale_price_ttc !== null && unit_sale_price_ttc !== ''
        ? Number(unit_sale_price_ttc)
        : 0;

    const safeUnitSalePriceHt =
      unit_sale_price_ht !== undefined && unit_sale_price_ht !== null && unit_sale_price_ht !== ''
        ? Number(unit_sale_price_ht)
        : Number((safeUnitSalePriceTtc / 1.055).toFixed(4));

    const safeUnitCostExVat =
      unit_cost_ex_vat !== undefined && unit_cost_ex_vat !== null && unit_cost_ex_vat !== ''
        ? Number(unit_cost_ex_vat)
        : 0;

    const insertResult = await client.query(
      `
      INSERT INTO sales_lines (
        id,
        sales_document_id,
        store_id,
        department_id,
        article_id,
        line_number,
        ean,
        article_label,
        sold_quantity,
        sale_unit,
        unit_sale_price_ttc,
        unit_sale_price_ht,
        unit_cost_ex_vat,
        line_reason,
        line_status,
        source_inventory_line
      )
      VALUES (
        gen_random_uuid(),
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11, $12,
        $13,
        'pending',
        $14::jsonb
      )
      RETURNING *
      `,
      [
        saleId,
        sale.store_id,
        sale.department_id,
        finalArticleId,
        nextLineNumber,
        finalEan,
        finalArticleLabel,
        safeSoldQuantity,
        finalSaleUnit,
        safeUnitSalePriceTtc,
        safeUnitSalePriceHt,
        safeUnitCostExVat,
        toNullableString(line_reason),
        JSON.stringify(source_inventory_line || {}),
      ]
    );

    const line = insertResult.rows[0];

    await client.query(
      `
      INSERT INTO sales_line_metadata (
        id,
        sales_line_id,
        meta_key,
        meta_value,
        notes
      )
      VALUES (
        gen_random_uuid(),
        $1,
        'v2_line',
        $2::jsonb,
        NULL
      )
      ON CONFLICT (sales_line_id, meta_key)
      DO NOTHING
      `,
      [
        line.id,
        JSON.stringify(source_inventory_line || {}),
      ]
    );

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      line,
      article,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/sales/:id/lines :', err);
    res.status(500).json({ error: 'Erreur ajout ligne vente' });
  } finally {
    client.release();
  }
});

// VALIDATION DOCUMENT DE VENTE / SORTIE
router.post('/:id/validate', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const saleId = req.params.id;

    await client.query('BEGIN');

    const saleResult = await client.query(`
      SELECT *
      FROM sales_documents
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      FOR UPDATE
    `, [saleId, req.user.store_id]);

    if (saleResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Document introuvable' });
    }

    const sale = saleResult.rows[0];
    const stockMovementType = getStockMovementTypeFromDocumentType(sale.document_type);

    if (sale.status !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Document déjà validé ou non modifiable' });
    }

    const linesResult = await client.query(`
      SELECT *
      FROM sales_lines
      WHERE sales_document_id = $1
      ORDER BY line_number ASC
    `, [saleId]);

    if (linesResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucune ligne à valider' });
    }

    const lines = linesResult.rows;

    for (const line of lines) {
      const qtyToConsume = Number(line.sold_quantity || 0);

      if (qtyToConsume <= 0) {
        continue;
      }

      if (!line.article_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Ligne ${line.line_number} sans article`,
        });
      }

      const lotsResult = await client.query(
        `
        SELECT
          id,
          qty_remaining,
          unit_cost_ex_vat,
          created_at
        FROM lots
        WHERE article_id = $1
          AND store_id = $2
          AND department_id = $3
          AND qty_remaining > 0
        ORDER BY created_at ASC, id ASC
        FOR UPDATE
        `,
        [line.article_id, sale.store_id, sale.department_id]
      );

      const lots = lotsResult.rows;
      const totalAvailable = lots.reduce((sum, lot) => sum + Number(lot.qty_remaining || 0), 0);

      if (totalAvailable < qtyToConsume) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Stock insuffisant pour la ligne ${line.line_number}`,
        });
      }

      let remainingToConsume = qtyToConsume;
      let totalConsumedCost = 0;

      for (const lot of lots) {
        if (remainingToConsume <= 0) break;

        const lotQty = Number(lot.qty_remaining || 0);
        const consumeQty = Math.min(lotQty, remainingToConsume);
        const unitCost = Number(lot.unit_cost_ex_vat || 0);
        const lotUpdate = await client.query(
          `
          UPDATE lots
          SET qty_remaining = qty_remaining - $1
          WHERE id = $2
            AND qty_remaining >= $1
          RETURNING id, qty_remaining
          `,
          [consumeQty, lot.id]
        );

        if (lotUpdate.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Stock insuffisant ou lot déjà consommé' });
        }

        await client.query(
          `
          INSERT INTO stock_movements (
            id,
            store_id,
            department_id,
            article_id,
            lot_id,
            movement_type,
            quantity,
            unit_cost_ex_vat,
            source_table,
            source_id,
            notes,
            created_at,
            created_by
          )
          VALUES (
            gen_random_uuid(),
            $1, $2, $3, $4,
            $5,
            $6,
            $7,
            'sales_lines',
            $8,
            $9,
            NOW(),
            $10
          )
          `,
          [
            sale.store_id,
            sale.department_id,
            line.article_id,
            lot.id,
            stockMovementType,
            consumeQty,
            unitCost,
            line.id,
            `Validation sortie ${sale.document_type} ${saleId}`,
            req.user.id,
          ]
        );

        totalConsumedCost += consumeQty * unitCost;
        remainingToConsume -= consumeQty;
      }

      await client.query(
        `
        UPDATE sales_lines
        SET
          unit_cost_ex_vat = CASE
            WHEN sold_quantity > 0 THEN ROUND(($1 / sold_quantity), 4)
            ELSE unit_cost_ex_vat
          END,
          line_status = 'validated',
          updated_at = NOW()
        WHERE id = $2
        `,
        [totalConsumedCost, line.id]
      );

      await recomputeArticleStock(
        client,
        line.article_id,
        sale.store_id,
        sale.department_id
      );
    }

    await client.query(`
      UPDATE sales_documents
      SET status = 'validated',
          updated_at = NOW(),
          updated_by = $2
      WHERE id = $1
    `, [saleId, req.user.id]);

    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Document validé (structure OK, FIFO à compléter)',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur validation vente :', err);
    res.status(500).json({ error: 'Erreur validation vente' });
  } finally {
    client.release();
  }
});

// ANNULATION VALIDATION DOCUMENT DE VENTE / SORTIE
router.post('/:id/cancel-validation', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const saleId = req.params.id;

    await client.query('BEGIN');

    const saleResult = await client.query(
      `
      SELECT *
      FROM sales_documents
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      FOR UPDATE
      `,
      [saleId, req.user.store_id]
    );

    if (saleResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Document introuvable' });
    }

    const sale = saleResult.rows[0];

    if (sale.status !== 'validated') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Le document n’est pas validé' });
    }

    const linesResult = await client.query(
      `
      SELECT *
      FROM sales_lines
      WHERE sales_document_id = $1
      ORDER BY line_number ASC
      FOR UPDATE
      `,
      [saleId]
    );

    const lines = linesResult.rows;
    const lineIds = lines.map((line) => line.id);
    const impactedArticleIds = new Set(
      lines
        .map((line) => line.article_id)
        .filter(Boolean)
    );

    if (lineIds.length > 0) {
      const movementsResult = await client.query(
        `
        SELECT
          id,
          article_id,
          lot_id,
          quantity
        FROM stock_movements
        WHERE source_table = 'sales_lines'
          AND source_id = ANY($1::uuid[])
        FOR UPDATE
        `,
        [lineIds]
      );

      for (const movement of movementsResult.rows) {
        if (movement.article_id) {
          impactedArticleIds.add(movement.article_id);
        }

        if (!movement.lot_id) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: 'Mouvement de stock sans lot, annulation impossible',
          });
        }

        const lotRestore = await client.query(
          `
          UPDATE lots
          SET qty_remaining = qty_remaining + $1
          WHERE id = $2
            AND store_id = $3
            AND department_id = $4
          RETURNING id
          `,
          [
            Number(movement.quantity || 0),
            movement.lot_id,
            sale.store_id,
            sale.department_id,
          ]
        );

        if (lotRestore.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: 'Impossible de restaurer un lot consommé par cette vente',
          });
        }
      }

      await client.query(
        `
        DELETE FROM stock_movements
        WHERE source_table = 'sales_lines'
          AND source_id = ANY($1::uuid[])
        `,
        [lineIds]
      );

      await client.query(
        `
        UPDATE sales_lines
        SET line_status = 'pending',
            updated_at = NOW()
        WHERE sales_document_id = $1
        `,
        [saleId]
      );
    }

    await client.query(
      `
      UPDATE sales_documents
      SET status = 'draft',
          updated_at = NOW(),
          updated_by = $2
      WHERE id = $1
      `,
      [saleId, req.user.id]
    );

    for (const articleId of impactedArticleIds) {
      await recomputeArticleStock(
        client,
        articleId,
        sale.store_id,
        sale.department_id
      );
    }

    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Validation annulée, document repassé en brouillon',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur annulation validation vente :', err);
    res.status(500).json({ error: 'Erreur annulation validation vente' });
  } finally {
    client.release();
  }
});

function getStockMovementTypeFromDocumentType(documentType) {
  switch (documentType) {
    case 'inventory_sale':
      return 'inventory_sale_out';
    case 'manual_sale':
      return 'sale_out';
    case 'waste':
      return 'waste_out';
    case 'transfer_out':
      return 'transfer_out';
    default:
      return 'sale_out';
  }
}

module.exports = router;
