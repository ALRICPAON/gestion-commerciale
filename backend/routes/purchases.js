const express = require('express');
const path = require('path');
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const { ensureDir } = require('../utils/fileHelpers');
const {
  createSafeUploadFilename,
  getUploadExtension,
  sanitaryImageFileFilter,
  supplierImportFileFilter,
} = require('../utils/uploadValidation');
const { recomputeArticleStock } = require('../services/stockService');
const { toNullableString } = require('../utils/valueHelpers');

const router = express.Router();

const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads', 'sanitary');

function buildLotCode(plu, supplierId, lineId) {
  const pluPart = (plu || 'NOPLU').replace(/\s+/g, '').toUpperCase();
  const supplierPart = String(supplierId).replace(/-/g, '').slice(0, 6).toUpperCase();
  const shortLineId = String(lineId).replace(/-/g, '').slice(0, 6).toUpperCase();

  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const ddd = String(
    Math.floor(
      (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
        Date.UTC(now.getFullYear(), 0, 0)) / 86400000
    )
  ).padStart(3, '0');

  return pluPart + '-' + yy + ddd + '-' + supplierPart + '-' + shortLineId;
}

ensureDir(UPLOADS_ROOT);

function sanitizeSanitaryLineId(rawLineId) {
  if (typeof rawLineId !== 'string') return null;
  const lineId = rawLineId.trim();

  // Seuls les identifiants simples autorisés : lettres, chiffres, tirets et underscores.
  // Pas de slash, pas de backslash, pas de point.
  if (!/^[0-9A-Za-z_-]+$/.test(lineId)) {
    return null;
  }

  return lineId;
}

function getSafeSanitaryTargetDir(lineId) {
  const targetDir = path.resolve(UPLOADS_ROOT, lineId);
  const relative = path.relative(UPLOADS_ROOT, targetDir);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return targetDir;
}

const sanitaryStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const lineId = sanitizeSanitaryLineId(req.params.id);

      if (!lineId) {
        return cb(new Error('Identifiant de ligne invalide'));
      }

      const targetDir = getSafeSanitaryTargetDir(lineId);

      if (!targetDir) {
        return cb(new Error('Chemin de destination invalide'));
      }

      ensureDir(targetDir);
      cb(null, targetDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const ext = getUploadExtension(file);
    cb(null, createSafeUploadFilename('sanitary', ext));
  },
});

const uploadSanitaryPhoto = multer({
  storage: sanitaryStorage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: sanitaryImageFileFilter,
});

const uploadSanitaryPhotoDebug = (req, res, next) => {
  console.log('[UPLOAD PHOTO] start', {
    lineId: req.params.id,
    userId: req.user?.id,
    contentType: req.headers['content-type'],
  });

  uploadSanitaryPhoto.single('photo')(req, res, (err) => {
    if (err) {
      console.error('[UPLOAD PHOTO] multer error', err);

      return res.status(400).json({
        error: err.message || 'Erreur upload fichier',
      });
    }

    console.log('[UPLOAD PHOTO] multer ok', {
      hasFile: !!req.file,
      filename: req.file?.filename,
      mimetype: req.file?.mimetype,
      size: req.file?.size,
    });

    next();
  });
};

const IMPORTS_ROOT = path.join(__dirname, '..', 'uploads', 'imports');
ensureDir(IMPORTS_ROOT);

const uploadImportDocument = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        ensureDir(IMPORTS_ROOT);
        cb(null, IMPORTS_ROOT);
      } catch (error) {
        cb(error);
      }
    },
    filename: (req, file, cb) => {
      const ext = getUploadExtension(file);
      cb(null, createSafeUploadFilename('import', ext));
    },
  }),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
  fileFilter: supplierImportFileFilter,
});

function normalizeImportUnit(raw) {
  const value = String(raw || '').trim().toLowerCase();

  if (['piece', 'pièce', 'pieces', 'pièces', 'pcs', 'pc', 'unite', 'unité'].includes(value)) {
    return 'piece';
  }

  if (['colis', 'box', 'carton', 'cartons'].includes(value)) {
    return 'colis';
  }

  return 'kg';
}

async function ensureLsArticleForImport(client, {
  storeId,
  departmentId,
  plu,
  designation,
}) {
  const existingArticle = await client.query(
    `
    SELECT a.id
    FROM articles a
    WHERE a.store_id = $1
      AND a.plu = $2
    LIMIT 1
    `,
    [storeId, plu]
  );

  if (existingArticle.rows.length > 0) {
    return {
      article_id: existingArticle.rows[0].id,
      created: false,
    };
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
      $1, $2, $3, 'piece', $4, true, 'import_ls_auto'
    )
    RETURNING id
    `,
    [storeId, plu, designation || `Article ${plu}`, plu]
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
      $1, $2, $3, 'piece', 'piece', 'piece', true, NULL
    )
    RETURNING id
    `,
    [articleId, departmentId, designation || `Article ${plu}`]
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
      'LS',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      '{}'::jsonb
    )
    `,
    [articleDepartmentId]
  );

  return {
    article_id: articleId,
    created: true,
  };
}

async function createScapCotisationPurchase(client, {
  storeId,
  departmentId,
  supplierId,
  userId,
  linkedPurchaseId,
  totalHt,
}) {
  const cotRate = 0.03;
  const cotAmount = Math.round((Number(totalHt || 0) * cotRate) * 100) / 100;

  if (cotAmount <= 0) {
    return null;
  }

  const articleResult = await client.query(
    `
    SELECT id
    FROM articles
    WHERE store_id = $1
      AND plu = 'COTISATION_SCA'
    LIMIT 1
    `,
    [storeId]
  );

  let cotArticleId = articleResult.rows[0]?.id || null;

  if (!cotArticleId) {
    const created = await ensureLsArticleForImport(client, {
      storeId,
      departmentId,
      plu: 'COTISATION_SCA',
      designation: 'Cotisation centrale 3%',
    });
    cotArticleId = created.article_id;
  }

  const purchaseInsert = await client.query(
    `
    INSERT INTO purchases (
      id,
      store_id,
      department_id,
      supplier_id,
      purchase_date,
      status,
      purchase_type,
      order_date,
      receipt_date,
      notes,
      created_by,
      updated_by,
      bl_number
    )
    VALUES (
      gen_random_uuid(),
      $1, $2, $3,
      CURRENT_DATE,
      'received',
      'direct_bl',
      CURRENT_DATE,
      CURRENT_DATE,
      $4,
      $5,
      $5,
      NULL
    )
    RETURNING id
    `,
    [
      storeId,
      departmentId,
      supplierId,
      `Cotisation centrale 3% liée à l'achat ${linkedPurchaseId}`,
      userId,
    ]
  );

  const cotPurchaseId = purchaseInsert.rows[0].id;

  const lineInsert = await client.query(
    `
    INSERT INTO purchase_lines (
      id,
      purchase_id,
      store_id,
      department_id,
      supplier_id,
      line_number,
      supplier_article_mapping_id,
      article_id,
      supplier_reference,
      supplier_label,
      ordered_colis,
      ordered_pieces,
      ordered_quantity,
      received_colis,
      received_pieces,
      received_quantity,
      stock_quantity,
      unit_price_ex_vat,
      line_amount_ex_vat,
      line_status,
      lot_mode,
      price_unit
    )
    VALUES (
      gen_random_uuid(),
      $1, $2, $3, $4, 1, NULL, $5,
      'COTISATION',
      'Cotisation centrale 3%',
      0, 0, 0,
      0, 0, 0,
      0,
      0,
      $6,
      'received',
      'manual',
      'kg'
    )
    RETURNING id
    `,
    [
      cotPurchaseId,
      storeId,
      departmentId,
      supplierId,
      cotArticleId,
      cotAmount,
    ]
  );

  await client.query(
    `
    INSERT INTO purchase_line_metadata (
      id,
      purchase_line_id,
      meta_key,
      meta_value,
      notes
    )
    VALUES (
      gen_random_uuid(),
      $1,
      'v2_line',
      '{}'::jsonb,
      $2
    )
    `,
    [
      lineInsert.rows[0].id,
      `Cotisation centrale 3% liée à l'achat ${linkedPurchaseId}`,
    ]
  );

  return {
    purchase_id: cotPurchaseId,
    amount: cotAmount,
  };
}

// LISTE ACHATS
router.get('/purchases', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const {
      status = '',
      supplier_id = '',
      date_from = '',
      date_to = '',
      limit = '500',
    } = req.query;

    const safeLimit = Math.min(Number(limit) || 500, 2000);

    const params = [req.user.store_id];
    let where = `WHERE p.store_id = $1`;

    if (status) {
      params.push(status);
      where += ` AND p.status = $${params.length}`;
    }

    if (supplier_id) {
      params.push(supplier_id);
      where += ` AND p.supplier_id = $${params.length}`;
    }

    if (date_from) {
      params.push(date_from);
      where += ` AND p.purchase_date >= $${params.length}::date`;
    }

    if (date_to) {
      params.push(date_to);
      where += ` AND p.purchase_date <= $${params.length}::date`;
    }

    params.push(safeLimit);

    const result = await req.dbPool.query(
      `
      SELECT
        p.id,
        p.status,
        p.purchase_type,
        p.order_date,
        p.receipt_date,
        p.bl_number,
        s.name AS supplier_name,
        COUNT(pl.id) AS line_count
      FROM purchases p
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      LEFT JOIN purchase_lines pl ON pl.purchase_id = p.id
      ${where}
      GROUP BY p.id, s.name
      ORDER BY p.created_at DESC
      LIMIT $${params.length}
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/purchases :', err);
    res.status(500).json({ error: 'Erreur serveur achats' });
  }
});

// CREER ACHAT
router.post('/purchases', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const {
      supplier_id,
      department_id,
      purchase_type = 'order',
      notes
    } = req.body;

    if (!supplier_id) {
      return res.status(400).json({ error: 'supplier_id obligatoire' });
    }

    if (!department_id) {
      return res.status(400).json({ error: 'department_id obligatoire' });
    }

    const allowedTypes = ['order', 'direct_bl', 'invoice_only'];
    if (!allowedTypes.includes(purchase_type)) {
      return res.status(400).json({ error: 'purchase_type invalide' });
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

    const supplierCheck = await client.query(
      `
      SELECT id
      FROM suppliers
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [supplier_id, req.user.store_id]
    );

    if (supplierCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Fournisseur invalide pour ce magasin' });
    }

    const result = await client.query(
      `
      INSERT INTO purchases (
        id,
        store_id,
        department_id,
        supplier_id,
        purchase_date,
        status,
        purchase_type,
        order_date,
        notes,
        created_by,
        updated_by
      )
      VALUES (
        gen_random_uuid(),
        $1, $2, $3,
        CURRENT_DATE,
        'ordered',
        $4,
        CURRENT_DATE,
        $5,
        $6,
        $6
      )
      RETURNING *
      `,
      [
        req.user.store_id,
        department_id,
        supplier_id,
        purchase_type,
        notes || null,
        req.user.id
      ]
    );

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      purchase: result.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/purchases :', err);
    res.status(500).json({ error: 'Erreur création achat' });
  } finally {
    client.release();
  }
});

// DETAIL ACHAT + LIGNES
router.get('/purchases/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const purchaseId = req.params.id;

    const purchaseResult = await req.dbPool.query(
      `
      SELECT
        p.*,
        s.name AS supplier_name
      FROM purchases p
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = $1
        AND p.store_id = $2
      `,
      [purchaseId, req.user.store_id]
    );

    if (purchaseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Achat introuvable' });
    }

    const linesResult = await req.dbPool.query(
      `
      SELECT
        pl.*,
        a.plu AS article_plu,
        a.designation AS article_name,
        plm.dlc,
        plm.latin_name,
        plm.fao_zone,
        plm.sous_zone,
        plm.fishing_gear,
        plm.production_method,
        plm.allergens,
        plm.origin_label,
        plm.supplier_lot_number,
        plm.sanitary_photo_url,
        plm.sanitary_photo_urls,
        plm.notes AS metadata_notes
      FROM purchase_lines pl
      LEFT JOIN articles a ON a.id = pl.article_id
      LEFT JOIN purchase_line_metadata plm ON plm.purchase_line_id = pl.id
      WHERE pl.purchase_id = $1
      ORDER BY pl.line_number ASC
      `,
      [purchaseId]
    );

    res.json({
      purchase: purchaseResult.rows[0],
      lines: linesResult.rows
    });

  } catch (err) {
    console.error('Erreur GET /api/purchases/:id :', err);
    res.status(500).json({ error: 'Erreur détail achat' });
  }
});

router.get('/mobile/purchases/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const purchaseId = req.params.id;

    const purchaseResult = await req.dbPool.query(
      `
      SELECT
        p.id,
        p.store_id,
        p.department_id,
        p.status,
        p.purchase_type,
        p.order_date,
        p.receipt_date,
        p.bl_number,
        p.invoice_number,
        p.notes,
        s.name AS supplier_name
      FROM purchases p
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = $1
        AND p.store_id = $2
      LIMIT 1
      `,
      [purchaseId, req.user.store_id]
    );

    if (purchaseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Achat introuvable' });
    }

    const linesResult = await req.dbPool.query(
      `
      SELECT
        pl.id,
        pl.line_number,
        pl.article_id,
        pl.price_unit,
        pl.ordered_colis,
        pl.ordered_pieces,
        pl.ordered_quantity,
        pl.received_colis,
        pl.received_pieces,
        pl.received_quantity,
        pl.unit_price_ex_vat,
        pl.line_status,
        a.plu AS article_plu,
        a.designation AS article_name,
        plm.sanitary_photo_url,
        plm.sanitary_photo_urls,
        plm.dlc,
        plm.latin_name,
        plm.fao_zone,
        plm.sous_zone
      FROM purchase_lines pl
      LEFT JOIN articles a ON a.id = pl.article_id
      LEFT JOIN purchase_line_metadata plm
        ON plm.purchase_line_id = pl.id
       AND plm.meta_key = 'v2_line'
      WHERE pl.purchase_id = $1
      ORDER BY pl.line_number ASC
      `,
      [purchaseId]
    );

    res.json({
      purchase: purchaseResult.rows[0],
      lines: linesResult.rows,
    });
  } catch (err) {
    console.error('Erreur GET /api/mobile/purchases/:id :', err);
    res.status(500).json({ error: 'Erreur chargement BL mobile' });
  }
});

// AJOUTER UNE LIGNE A UN ACHAT
router.post('/purchases/:id/lines', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const purchaseId = req.params.id;
    const {
      article_id,
      article_plu,
      supplier_ref,
      supplier_label,
      ordered_colis,
      ordered_pieces,
      ordered_quantity,
      unit_price_ex_vat,
      stock_quantity,
      purchase_unit,
      price_unit,
    } = req.body;

    await client.query('BEGIN');

    const purchaseResult = await client.query(
      `
      SELECT id, store_id, department_id, supplier_id, status
      FROM purchases
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [purchaseId, req.user.store_id]
    );

    if (purchaseResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Achat introuvable' });
    }

    const purchase = purchaseResult.rows[0];

    if (!['draft', 'ordered', 'receiving'].includes(purchase.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Impossible d’ajouter une ligne sur un achat déjà clôturé ou annulé',
      });
    }

    let finalArticleId = article_id || null;
    let finalSupplierMappingId = null;
    let finalSupplierLabel = supplier_label || null;
    let finalPurchaseUnit = purchase_unit || 'kg';

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

    if (!finalArticleId && supplier_ref) {
      const mappingResult = await client.query(
        `
        SELECT
          m.id,
          m.article_id,
          m.supplier_label,
          m.purchase_unit
        FROM supplier_article_mappings m
        WHERE m.supplier_id = $1
          AND m.supplier_ref = $2
          AND m.is_active = true
        LIMIT 1
        `,
        [purchase.supplier_id, supplier_ref]
      );

      if (mappingResult.rows.length > 0) {
        finalSupplierMappingId = mappingResult.rows[0].id;
        finalArticleId = mappingResult.rows[0].article_id;
        finalSupplierLabel = finalSupplierLabel || mappingResult.rows[0].supplier_label;
        finalPurchaseUnit = mappingResult.rows[0].purchase_unit || finalPurchaseUnit;
      }
    }

    const isEmptyLine = !article_id && !article_plu && !supplier_ref;

    if (!finalArticleId && !isEmptyLine) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Article introuvable : saisis un PLU valide ou utilise F9'
      });
    }

    const articleResult = finalArticleId
      ? await client.query(
          `
          SELECT id, designation, unit
          FROM articles
          WHERE id = $1
            AND store_id = $2
          LIMIT 1
          `,
          [finalArticleId, req.user.store_id]
        )
      : { rows: [] };

    if (finalArticleId && articleResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Article introuvable' });
    }

    const lineNumberResult = await client.query(
      `
      SELECT COALESCE(MAX(line_number), 0) + 1 AS next_line_number
      FROM purchase_lines
      WHERE purchase_id = $1
      `,
      [purchaseId]
    );

    const nextLineNumber = lineNumberResult.rows[0].next_line_number;

    const safeOrderedColis = ordered_colis !== undefined && ordered_colis !== null && ordered_colis !== ''
      ? Number(ordered_colis)
      : null;

    const safeOrderedPieces = ordered_pieces !== undefined && ordered_pieces !== null && ordered_pieces !== ''
      ? Number(ordered_pieces)
      : null;

    const safeOrderedQty = ordered_quantity !== undefined && ordered_quantity !== null && ordered_quantity !== ''
      ? Number(ordered_quantity)
      : 0;

    const safeReceivedColis = null;
    const safeReceivedPieces = null;
    const safeReceivedQty = 0;

    const safeStockQty = stock_quantity !== undefined && stock_quantity !== null && stock_quantity !== ''
      ? Number(stock_quantity)
      : 0;

    const safeUnitPrice = unit_price_ex_vat !== undefined && unit_price_ex_vat !== null && unit_price_ex_vat !== ''
      ? Number(unit_price_ex_vat)
      : 0;

    const finalPriceUnit = ['kg', 'piece', 'colis'].includes(price_unit) ? price_unit : 'kg';
    const safeLineAmount = 0;

    const insertResult = await client.query(
      `
      INSERT INTO purchase_lines (
        id,
        purchase_id,
        store_id,
        department_id,
        supplier_id,
        line_number,
        supplier_article_mapping_id,
        article_id,
        supplier_reference,
        supplier_label,
        ordered_colis,
        ordered_pieces,
        ordered_quantity,
        received_colis,
        received_pieces,
        received_quantity,
        stock_quantity,
        unit_price_ex_vat,
        line_amount_ex_vat,
        line_status,
        lot_mode,
        price_unit
      )
      VALUES (
        gen_random_uuid(),
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17, $18,
        'pending', 'auto', $19
      )
      RETURNING *
      `,
      [
        purchaseId,
        purchase.store_id,
        purchase.department_id,
        purchase.supplier_id,
        nextLineNumber,
        finalSupplierMappingId,
        finalArticleId,
        supplier_ref || null,
        finalSupplierLabel,
        safeOrderedColis,
        safeOrderedPieces,
        safeOrderedQty,
        safeReceivedColis,
        safeReceivedPieces,
        safeReceivedQty,
        safeStockQty,
        safeUnitPrice,
        safeLineAmount,
        finalPriceUnit,
      ]
    );

    await client.query(
      `
      INSERT INTO purchase_line_metadata (
        id,
        purchase_line_id,
        meta_key,
        meta_value
      )
      VALUES (
        gen_random_uuid(),
        $1,
        'v2_line',
        '{}'::jsonb
      )
      `,
      [insertResult.rows[0].id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      line: insertResult.rows[0],
      article_name: articleResult.rows[0]?.designation || null,
      article_unit: articleResult.rows[0]?.unit || null,
      resolved_by_af_map: !!finalSupplierMappingId,
      purchase_unit: finalPurchaseUnit,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/purchases/:id/lines :', err);
    res.status(500).json({ error: 'Erreur ajout ligne achat' });
  } finally {
    client.release();
  }
});

// DUPLIQUER UN ACHAT
router.post('/purchases/:id/duplicate', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const sourcePurchaseId = req.params.id;
    const {
      order_date,
      notes,
    } = req.body;

    await client.query('BEGIN');

    const sourcePurchaseResult = await client.query(
      `
      SELECT *
      FROM purchases
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [sourcePurchaseId, req.user.store_id]
    );

    if (sourcePurchaseResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Achat source introuvable' });
    }

    const sourcePurchase = sourcePurchaseResult.rows[0];

    const newPurchaseResult = await client.query(
      `
      INSERT INTO purchases (
        id,
        store_id,
        department_id,
        supplier_id,
        purchase_date,
        status,
        purchase_type,
        order_date,
        delivery_date,
        receipt_date,
        bl_number,
        invoice_number,
        notes,
        created_by,
        updated_by
      )
      VALUES (
        gen_random_uuid(),
        $1, $2, $3, $4, $5, $6, $7,
        NULL,
        NULL,
        NULL,
        NULL,
        $8,
        $9,
        $9
      )
      RETURNING *
      `,
      [
        sourcePurchase.store_id,
        sourcePurchase.department_id,
        sourcePurchase.supplier_id,
        order_date || new Date().toISOString().slice(0, 10),
        'draft',
        'order',
        order_date || new Date().toISOString().slice(0, 10),
        notes || sourcePurchase.notes || null,
        req.user.id,
      ]
    );

    const newPurchase = newPurchaseResult.rows[0];

    const sourceLinesResult = await client.query(
      `
      SELECT
        pl.*,
        plm.dlc,
        plm.latin_name,
        plm.fao_zone,
        plm.sous_zone,
        plm.fishing_gear,
        plm.production_method,
        plm.allergens,
        plm.origin_label,
        plm.supplier_lot_number,
        plm.sanitary_photo_url,
        plm.sanitary_photo_taken_at,
        plm.notes AS metadata_notes
      FROM purchase_lines pl
      LEFT JOIN purchase_line_metadata plm
        ON plm.purchase_line_id = pl.id
      WHERE pl.purchase_id = $1
      ORDER BY pl.line_number ASC
      `,
      [sourcePurchaseId]
    );

    for (const line of sourceLinesResult.rows) {
      const orderedQuantity = Number(line.ordered_quantity || 0);
      const unitPrice = Number(line.unit_price_ex_vat || 0);
      const calculatedLineAmount = orderedQuantity * unitPrice;

      const newLineResult = await client.query(
        `
        INSERT INTO purchase_lines (
          id,
          purchase_id,
          store_id,
          department_id,
          supplier_id,
          line_number,
          supplier_article_mapping_id,
          article_id,
          supplier_reference,
          supplier_label,
          ordered_colis,
          ordered_pieces,
          ordered_quantity,
          received_colis,
          received_pieces,
          received_quantity,
          stock_quantity,
          unit_price_ex_vat,
          line_amount_ex_vat,
          line_status,
          lot_mode
        )
        VALUES (
          gen_random_uuid(),
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10,
          $11,
          $12,
          0,
          0,
          0,
          0,
          $13,
          $14,
          'pending',
          $15
        )
        RETURNING id
        `,
        [
          newPurchase.id,
          newPurchase.store_id,
          newPurchase.department_id,
          newPurchase.supplier_id,
          line.line_number,
          line.supplier_article_mapping_id,
          line.article_id,
          line.supplier_reference,
          line.supplier_label,
          Number(line.ordered_colis || 0),
          Number(line.ordered_pieces || 0),
          orderedQuantity,
          unitPrice,
          calculatedLineAmount,
          line.lot_mode || 'auto',
        ]
      );

      const newLineId = newLineResult.rows[0].id;

      await client.query(
        `
        INSERT INTO purchase_line_metadata (
          id,
          purchase_line_id,
          meta_key,
          meta_value,
          dlc,
          latin_name,
          fao_zone,
          sous_zone,
          fishing_gear,
          production_method,
          allergens,
          origin_label,
          supplier_lot_number,
          sanitary_photo_url,
          sanitary_photo_taken_at,
          notes
        )
        VALUES (
          gen_random_uuid(),
          $1,
          'v2_line',
          '{}'::jsonb,
          NULL,
          $2, $3, $4, $5, $6, $7, $8, $9,
          NULL,
          NULL,
          NULL
        )
        `,
        [
          newLineId,
          line.latin_name || null,
          line.fao_zone || null,
          line.sous_zone || null,
          line.fishing_gear || null,
          line.production_method || null,
          line.allergens || null,
          line.origin_label || null,
          line.supplier_lot_number || null,
        ]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      message: 'Achat dupliqué avec succès',
      purchase: newPurchase,
      duplicated_lines: sourceLinesResult.rows.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/purchases/:id/duplicate :', err);
    res.status(500).json({ error: 'Erreur duplication achat' });
  } finally {
    client.release();
  }
});

// MODIFIER EN-TETE ACHAT
router.patch('/purchases/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const purchaseId = req.params.id;
    const {
      order_date,
      receipt_date,
      purchase_type,
      status,
      bl_number,
      invoice_number,
      notes,
    } = req.body;

    await client.query('BEGIN');

    const purchaseCheck = await client.query(
      `
      SELECT id, status
      FROM purchases
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [purchaseId, req.user.store_id]
    );

    if (purchaseCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Achat introuvable' });
    }

    const currentPurchase = purchaseCheck.rows[0];

    if (currentPurchase.status === 'received' && status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Un achat déjà reçu ne peut pas être annulé manuellement',
      });
    }

    if (currentPurchase.status === 'closed') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Un achat clôturé ne peut plus être modifié',
      });
    }

    const allowedTypes = ['order', 'direct_bl', 'invoice_only'];
    const allowedManualStatuses = ['ordered', 'cancelled'];

    if (purchase_type && !allowedTypes.includes(purchase_type)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'purchase_type invalide' });
    }

    if (status && !allowedManualStatuses.includes(status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Statut non autorisé manuellement',
      });
    }

    const result = await client.query(
      `
      UPDATE purchases
      SET
        purchase_date = COALESCE($1::date, purchase_date),
        order_date = COALESCE($1::date, order_date),
        receipt_date = $2::date,
        purchase_type = COALESCE($3, purchase_type),
        status = COALESCE($4, status),
        bl_number = $5,
        invoice_number = $6,
        notes = $7,
        updated_by = $8,
        updated_at = NOW()
      WHERE id = $9
        AND store_id = $10
      RETURNING *
      `,
      [
        order_date || null,
        receipt_date || null,
        purchase_type || null,
        status || null,
        toNullableString(bl_number),
        toNullableString(invoice_number),
        toNullableString(notes),
        req.user.id,
        purchaseId,
        req.user.store_id,
      ]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      purchase: result.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur PATCH /api/purchases/:id :', err);
    res.status(500).json({ error: 'Erreur mise à jour achat' });
  } finally {
    client.release();
  }
});

// VALIDATION RECEPTION
router.post('/purchases/:id/validate-reception', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const purchaseId = req.params.id;
    const { receipt_date } = req.body;

    console.log('STEP 1: START VALIDATE RECEPTION', { purchaseId, receipt_date, userId: req.user.id });

    await client.query('BEGIN');
    console.log('STEP 2: BEGIN TRANSACTION');

    const purchaseResult = await client.query(
      `
      SELECT p.*
      FROM purchases p
      WHERE p.id = $1
        AND p.store_id = $2
      LIMIT 1
      FOR UPDATE
      `,
      [purchaseId, req.user.store_id]
    );
    console.log('STEP 3: PURCHASE FETCHED', { rows: purchaseResult.rows.length });

    if (purchaseResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Achat introuvable' });
    }

    const purchase = purchaseResult.rows[0];
    console.log('STEP 4: PURCHASE STATUS', { purchaseId, status: purchase.status });

    if (purchase.status !== 'ordered') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Document déjà validé ou non modifiable' });
    }

    const linesResult = await client.query(
      `
      SELECT
        pl.*,
        a.plu,
        a.designation,
        plm.dlc,
        plm.latin_name,
        plm.fao_zone,
        plm.sous_zone,
        plm.fishing_gear,
        plm.production_method,
        plm.allergens,
        plm.origin_label,
        plm.supplier_lot_number
      FROM purchase_lines pl
      LEFT JOIN articles a ON a.id = pl.article_id
      LEFT JOIN purchase_line_metadata plm
        ON plm.purchase_line_id = pl.id
       AND plm.meta_key = 'v2_line'
      WHERE pl.purchase_id = $1
      ORDER BY pl.line_number ASC
      FOR UPDATE OF pl
      `,
      [purchaseId]
    );
    console.log('STEP 5: LINES FETCHED', { lineCount: linesResult.rows.length });

    if (linesResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucune ligne à réceptionner' });
    }

    let createdLots = 0;

    for (const line of linesResult.rows) {
      console.log('STEP 6: PROCESS LINE START', {
        lineId: line.id,
        lineNumber: line.line_number,
        articleId: line.article_id,
        price_unit: line.price_unit,
        received_colis: line.received_colis,
        received_pieces: line.received_pieces,
        received_quantity: line.received_quantity,
        ordered_colis: line.ordered_colis,
        ordered_pieces: line.ordered_pieces,
        ordered_quantity: line.ordered_quantity,
        unit_price_ex_vat: line.unit_price_ex_vat,
      });

      if (!line.article_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Ligne ${line.line_number} sans article`,
        });
      }

      let qty = 0;

      let finalReceivedColis = Number(line.received_colis || 0);
      let finalReceivedPieces = Number(line.received_pieces || 0);
      let finalReceivedQuantity = Number(line.received_quantity || 0);

      const orderedColis = Number(line.ordered_colis || 0);
      const orderedPieces = Number(line.ordered_pieces || 0);
      const orderedQuantity = Number(line.ordered_quantity || 0);

      if (line.price_unit === 'colis') {
        qty = finalReceivedColis > 0 ? finalReceivedColis : orderedColis;

        if (finalReceivedColis <= 0 && qty > 0) {
          finalReceivedColis = qty;
        }
      } else if (line.price_unit === 'piece') {
  if (finalReceivedColis <= 0 && orderedColis > 0) {
    finalReceivedColis = orderedColis;
  }

  if (finalReceivedPieces <= 0 && orderedPieces > 0) {
    finalReceivedPieces = orderedPieces;
  }

  qty = finalReceivedColis > 0 && finalReceivedPieces > 0
    ? finalReceivedColis * finalReceivedPieces
    : finalReceivedPieces;
      } else {
        if (finalReceivedColis <= 0 && orderedColis > 0) {
          finalReceivedColis = orderedColis;
        }

        if (finalReceivedQuantity <= 0 && orderedQuantity > 0) {
          finalReceivedQuantity = orderedQuantity;
        }

        qty = finalReceivedColis > 0 && finalReceivedQuantity > 0
          ? finalReceivedColis * finalReceivedQuantity
          : finalReceivedQuantity;
      }

      console.log('STEP 7: QUANTITY CALCULATED', {
        lineId: line.id,
        qty,
        finalReceivedColis,
        finalReceivedPieces,
        finalReceivedQuantity,
        orderedColis,
        orderedPieces,
        orderedQuantity,
      });

      if (qty <= 0) {
        console.log('STEP 8: SKIP LINE NO QUANTITY', { lineId: line.id, qty });
        continue;
      }

      const lotCode = buildLotCode(line.plu, purchase.supplier_id, line.id);
      const traceabilityData = {
        latin_name: line.latin_name || null,
        fao_zone: line.fao_zone || null,
        sous_zone: line.sous_zone || null,
        fishing_gear: line.fishing_gear || null,
        production_method: line.production_method || null,
        allergens: line.allergens || null,
        origin_label: line.origin_label || null,
      };

      console.log('STEP 10: INSERT LOT', {
        purchaseLineId: line.id,
        qty,
        unit_cost_ex_vat: Number(line.unit_price_ex_vat || 0),
        dlc: line.dlc,
        lotCode,
      });

      const lotInsert = await client.query(
        `
        INSERT INTO lots (
          id,
          store_id,
          department_id,
          article_id,
          purchase_id,
          purchase_line_id,
          supplier_id,
          lot_code,
          supplier_lot_number,
          source_type,
          qty_initial,
          qty_remaining,
          unit_cost_ex_vat,
          dlc,
          traceability_data,
          created_at
        )
        VALUES (
          gen_random_uuid(),
          $1, $2, $3, $4, $5, $6,
          $7, $8,
          'purchase',
          $9, $9,
          $10,
          $11,
          $12::jsonb,
          NOW()
        )
        RETURNING id
        `,
        [
          purchase.store_id,
          purchase.department_id,
          line.article_id,
          purchase.id,
          line.id,
          purchase.supplier_id,
          lotCode,
          line.supplier_lot_number || null,
          qty,
          Number(line.unit_price_ex_vat || 0),
          line.dlc || null,
          JSON.stringify(traceabilityData),
        ]
      );

      const lotId = lotInsert.rows[0].id;
      console.log('STEP 11: LOT INSERTED', { lotId, lineId: line.id });

      console.log('STEP 12: INSERT STOCK MOVEMENT', { lotId, qty, articleId: line.article_id });
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
          'purchase_in',
          $5,
          $6,
          'purchase_lines',
          $7,
          $8,
          NOW(),
          $9
        )
        `,
        [
          purchase.store_id,
          purchase.department_id,
          line.article_id,
          lotId,
          qty,
          Number(line.unit_price_ex_vat || 0),
          line.id,
          `Réception achat ${purchaseId}`,
          req.user.id,
        ]
      );
      console.log('STEP 13: STOCK MOVEMENT INSERTED', { lotId, lineId: line.id });

      console.log('STEP 14: UPDATE PURCHASE LINE', {
        lineId: line.id,
        finalReceivedColis,
        finalReceivedPieces,
        finalReceivedQuantity,
        lotId,
      });
      await client.query(
        `
        UPDATE purchase_lines
        SET
          received_colis = $1,
          received_pieces = $2,
          received_quantity = $3,
          lot_id = $4,
          line_status = 'received',
          status = 'validated',
          received_at = COALESCE(received_at, NOW()),
          updated_at = NOW()
        WHERE id = $5
        `,
        [
          finalReceivedColis,
          finalReceivedPieces,
          finalReceivedQuantity,
          lotId,
          line.id,
        ]
      );
      console.log('STEP 15: PURCHASE LINE UPDATED', { lineId: line.id });

      createdLots += 1;

      console.log('STEP 16: RECOMPUTE ARTICLE STOCK', { lineId: line.id, articleId: line.article_id });
      await recomputeArticleStock(
        client,
        line.article_id,
        purchase.store_id,
        purchase.department_id
      );
      console.log('STEP 17: ARTICLE STOCK RECOMPUTED', { lineId: line.id });
    }

    if (createdLots === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Aucune quantité réceptionnée',
      });
    }

    await client.query(
      `
      UPDATE purchases
      SET
        status = 'received',
        purchase_type = CASE WHEN purchase_type = 'order' THEN 'direct_bl' ELSE purchase_type END,
        receipt_date = COALESCE($1::date, receipt_date, CURRENT_DATE),
        updated_at = NOW(),
        updated_by = $2
      WHERE id = $3
      `,
      [receipt_date || null, req.user.id, purchaseId]
    );
    console.log('STEP 18: PURCHASE UPDATED', { purchaseId });

    await client.query('COMMIT');
    console.log('STEP 19: COMMIT TRANSACTION', { purchaseId, createdLots });

    res.json({
      ok: true,
      message: `Réception validée : ${createdLots} lot(s) créé(s)`,
      created_lots: createdLots,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ERREUR VALIDATION RECEPTION:', err);
    console.error(err.stack);
    res.status(500).json({ error: err.message, stack: err.stack });
  } finally {
    client.release();
  }
});

// SUPPRIMER UN ACHAT
router.delete('/purchases/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const purchaseId = req.params.id;

    await client.query('BEGIN');

    const purchaseCheck = await client.query(
      `
      SELECT id, status, store_id, department_id
      FROM purchases
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [purchaseId, req.user.store_id]
    );

    if (purchaseCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Achat introuvable' });
    }

    const purchase = purchaseCheck.rows[0];

    if (purchase.status === 'closed') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Impossible de supprimer un achat clôturé',
      });
    }

    const linesResult = await client.query(
      `
      SELECT
        id,
        article_id,
        lot_id
      FROM purchase_lines
      WHERE purchase_id = $1
      `,
      [purchaseId]
    );

    const lines = linesResult.rows;
    const articleIdsToRecompute = [
      ...new Set(
        lines
          .map((line) => line.article_id)
          .filter(Boolean)
      ),
    ];

    const lineIds = lines.map((line) => line.id);

    if (lineIds.length > 0) {
      await client.query(
        `
        DELETE FROM stock_movements
        WHERE source_table = 'purchase_lines'
          AND source_id = ANY($1::uuid[])
        `,
        [lineIds]
      );

      await client.query(
        `
        DELETE FROM lots
        WHERE purchase_id = $1
           OR purchase_line_id = ANY($2::uuid[])
        `,
        [purchaseId, lineIds]
      );

      await client.query(
        `
        DELETE FROM purchase_line_metadata
        WHERE purchase_line_id = ANY($1::uuid[])
        `,
        [lineIds]
      );

      await client.query(
        `
        DELETE FROM purchase_lines
        WHERE id = ANY($1::uuid[])
        `,
        [lineIds]
      );
    }

    await client.query(
      `
      DELETE FROM purchases
      WHERE id = $1
        AND store_id = $2
      `,
      [purchaseId, req.user.store_id]
    );

    for (const articleId of articleIdsToRecompute) {
      await recomputeArticleStock(
        client,
        articleId,
        purchase.store_id,
        purchase.department_id
      );
    }

    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Achat supprimé avec succès',
      deleted_lines: lineIds.length,
      recomputed_articles: articleIdsToRecompute.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur DELETE /api/purchases/:id :', err);
    res.status(500).json({ error: 'Erreur suppression achat' });
  } finally {
    client.release();
  }
});

// MODIFIER UNE LIGNE ACHAT
router.patch('/purchase-lines/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const lineId = req.params.id;
    const {
      article_id,
      article_plu,
      ordered_colis,
      ordered_pieces,
      ordered_quantity,
      received_colis,
      received_pieces,
      received_quantity,
      unit_price_ex_vat,
      stock_quantity,
      price_unit,
      latin_name,
      fao_zone,
      sous_zone,
      fishing_gear,
      origin_label,
      allergens,
      dlc,
      supplier_lot_number,
      sanitary_photo_url,
      metadata_notes,
      line_amount_ex_vat,
    } = req.body;

    await client.query('BEGIN');

    const lineCheck = await client.query(
      `
      SELECT
        pl.id,
        pl.purchase_id,
        pl.store_id,
        pl.department_id,
        pl.supplier_id,
        pl.article_id AS old_article_id,
        pl.lot_id AS old_lot_id,
        pl.line_status,
        p.status AS purchase_status,
        p.store_id AS purchase_store_id,
        p.department_id AS purchase_department_id,
        p.supplier_id AS purchase_supplier_id
      FROM purchase_lines pl
      JOIN purchases p ON p.id = pl.purchase_id
      WHERE pl.id = $1
        AND pl.store_id = $2
      LIMIT 1
      `,
      [lineId, req.user.store_id]
    );

    if (lineCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ligne achat introuvable' });
    }

    const line = lineCheck.rows[0];

    if (['closed', 'cancelled'].includes(line.purchase_status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Impossible de modifier une ligne sur un achat clôturé ou annulé',
      });
    }

    let finalArticleId = article_id || null;

    if (!finalArticleId && article_plu) {
      const articleByPluResult = await client.query(
        `
        SELECT id, plu, designation, unit
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

    if (!finalArticleId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Article introuvable' });
    }

    const articleResult = await client.query(
      `
      SELECT id, plu, designation, unit
      FROM articles
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [finalArticleId, req.user.store_id]
    );

    if (articleResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Article introuvable' });
    }

    const safeOrderedColis =
      ordered_colis !== undefined && ordered_colis !== null && ordered_colis !== ''
        ? Number(ordered_colis)
        : null;

    const safeOrderedPieces =
      ordered_pieces !== undefined && ordered_pieces !== null && ordered_pieces !== ''
        ? Number(ordered_pieces)
        : null;

    const safeOrderedQty =
      ordered_quantity !== undefined && ordered_quantity !== null && ordered_quantity !== ''
        ? Number(ordered_quantity)
        : null;

    const currentLineResult = await client.query(
      `
      SELECT
        received_colis,
        received_pieces,
        received_quantity,
        price_unit
      FROM purchase_lines
      WHERE id = $1
      LIMIT 1
      `,
      [lineId]
    );

    const currentLineDb = currentLineResult.rows[0];

    const safeReceivedColis =
      received_colis !== undefined && received_colis !== null && received_colis !== ''
        ? Number(received_colis)
        : Number(currentLineDb.received_colis || 0);

    const safeReceivedPieces =
      received_pieces !== undefined && received_pieces !== null && received_pieces !== ''
        ? Number(received_pieces)
        : Number(currentLineDb.received_pieces || 0);

    const safeReceivedQty =
      received_quantity !== undefined && received_quantity !== null && received_quantity !== ''
        ? Number(received_quantity)
        : Number(currentLineDb.received_quantity || 0);

    const safeUnitPrice =
      unit_price_ex_vat !== undefined && unit_price_ex_vat !== null && unit_price_ex_vat !== ''
        ? Number(unit_price_ex_vat)
        : 0;

    const safeStockQty =
      stock_quantity !== undefined && stock_quantity !== null && stock_quantity !== ''
        ? Number(stock_quantity)
        : 0;

    const finalPriceUnit = ['kg', 'piece', 'colis'].includes(price_unit) ? price_unit : (currentLineDb.price_unit || 'kg');

    let computedBaseQty = 0;

    if (line.purchase_status === 'received') {
      if (finalPriceUnit === 'colis') {
        computedBaseQty = safeReceivedColis || 0;
      } else if (finalPriceUnit === 'piece') {
        computedBaseQty = safeReceivedPieces || 0;
      } else {
        computedBaseQty = safeReceivedQty || 0;
      }
    } else {
      if (finalPriceUnit === 'colis') {
        computedBaseQty = safeOrderedColis || 0;
      } else if (finalPriceUnit === 'piece') {
        computedBaseQty = safeOrderedPieces || 0;
      } else {
        computedBaseQty = safeOrderedQty || 0;
      }
    }

    const finalLineAmount =
      line_amount_ex_vat !== undefined && line_amount_ex_vat !== null && line_amount_ex_vat !== ''
        ? Number(line_amount_ex_vat)
        : computedBaseQty * safeUnitPrice;

    await client.query(
      `
      UPDATE purchase_lines
      SET
        article_id = $1,
        ordered_colis = $2::numeric,
        ordered_pieces = $3::numeric,
        ordered_quantity = $4::numeric,
        received_colis = $5::numeric,
        received_pieces = $6::numeric,
        received_quantity = $7::numeric,
        unit_price_ex_vat = $8::numeric,
        stock_quantity = $9::numeric,
        price_unit = $10,
        line_amount_ex_vat = $11::numeric,
        received_at = CASE
          WHEN $5::numeric > 0 OR $6::numeric > 0 OR $7::numeric > 0 THEN COALESCE(received_at, NOW())
          ELSE received_at
        END,
        updated_at = NOW()
      WHERE id = $12
        AND store_id = $13
      RETURNING *
      `,
      [
        finalArticleId,
        safeOrderedColis,
        safeOrderedPieces,
        safeOrderedQty,
        safeReceivedColis,
        safeReceivedPieces,
        safeReceivedQty,
        safeUnitPrice,
        safeStockQty,
        finalPriceUnit,
        finalLineAmount,
        lineId,
        req.user.store_id,
      ]
    );

    await client.query(
      `
      INSERT INTO purchase_line_metadata (
        id,
        purchase_line_id,
        meta_key,
        meta_value,
        dlc,
        latin_name,
        fao_zone,
        sous_zone,
        fishing_gear,
        origin_label,
        allergens,
        supplier_lot_number,
        sanitary_photo_url,
        notes
      )
      VALUES (
        gen_random_uuid(),
        $1,
        'v2_line',
        '{}'::jsonb,
        $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      )
      ON CONFLICT (purchase_line_id, meta_key)
      DO UPDATE SET
        dlc = EXCLUDED.dlc,
        latin_name = EXCLUDED.latin_name,
        fao_zone = EXCLUDED.fao_zone,
        sous_zone = EXCLUDED.sous_zone,
        fishing_gear = EXCLUDED.fishing_gear,
        origin_label = EXCLUDED.origin_label,
        allergens = EXCLUDED.allergens,
        supplier_lot_number = EXCLUDED.supplier_lot_number,
        sanitary_photo_url = EXCLUDED.sanitary_photo_url,
        notes = EXCLUDED.notes
      `,
      [
        lineId,
        dlc || null,
        latin_name || null,
        fao_zone || null,
        sous_zone || null,
        fishing_gear || null,
        origin_label || null,
        allergens || null,
        supplier_lot_number || null,
        sanitary_photo_url || null,
        metadata_notes || null,
      ]
    );

    if (line.purchase_status === 'received') {
      const oldLotId = line.old_lot_id || null;
      const oldArticleId = line.old_article_id || null;

      if (oldLotId) {
        await client.query(
          `
          DELETE FROM stock_movements
          WHERE lot_id = $1
             OR (source_table = 'purchase_lines' AND source_id = $2)
          `,
          [oldLotId, lineId]
        );

        await client.query(
          `
          DELETE FROM lots
          WHERE id = $1
          `,
          [oldLotId]
        );
      } else {
        await client.query(
          `
          DELETE FROM stock_movements
          WHERE source_table = 'purchase_lines'
            AND source_id = $1
          `,
          [lineId]
        );
      }

      let receivedQtyForLot = 0;
      if (finalPriceUnit === 'colis') {
        receivedQtyForLot = Number(safeReceivedColis || 0);
      } else if (finalPriceUnit === 'piece') {
        receivedQtyForLot = Number(safeReceivedPieces || 0);
      } else {
        receivedQtyForLot = Number(safeReceivedColis || 0) > 0 && Number(safeReceivedQty || 0) > 0
          ? Number(safeReceivedColis || 0) * Number(safeReceivedQty || 0)
          : Number(safeReceivedQty || 0);
      }

      if (receivedQtyForLot > 0) {
        const lotCode = buildLotCode(articleResult.rows[0].plu, line.purchase_supplier_id, lineId);

        const traceabilityData = {
          latin_name: latin_name || null,
          fao_zone: fao_zone || null,
          sous_zone: sous_zone || null,
          fishing_gear: fishing_gear || null,
          allergens: allergens || null,
          origin_label: origin_label || null,
        };

        const lotInsert = await client.query(
          `
          INSERT INTO lots (
            id,
            store_id,
            department_id,
            article_id,
            purchase_id,
            purchase_line_id,
            supplier_id,
            lot_code,
            supplier_lot_number,
            source_type,
            qty_initial,
            qty_remaining,
            unit_cost_ex_vat,
            dlc,
            traceability_data,
            created_at
          )
          VALUES (
            gen_random_uuid(),
            $1, $2, $3, $4, $5, $6,
            $7, $8,
            'purchase',
            $9, $9,
            $10,
            $11,
            $12::jsonb,
            NOW()
          )
          RETURNING id
          `,
          [
            line.purchase_store_id,
            line.purchase_department_id,
            finalArticleId,
            line.purchase_id,
            lineId,
            line.purchase_supplier_id,
            lotCode,
            supplier_lot_number || null,
            receivedQtyForLot,
            safeUnitPrice,
            dlc || null,
            JSON.stringify(traceabilityData),
          ]
        );

        const finalLotId = lotInsert.rows[0].id;

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
            'purchase_in',
            $5,
            $6,
            'purchase_lines',
            $7,
            $8,
            NOW(),
            $9
          )
          `,
          [
            line.purchase_store_id,
            line.purchase_department_id,
            finalArticleId,
            finalLotId,
            receivedQtyForLot,
            safeUnitPrice,
            lineId,
            'Correction ligne reçue ' + line.purchase_id,
            req.user.id,
          ]
        );

        await client.query(
          `
          UPDATE purchase_lines
          SET
            lot_id = $1,
            line_status = 'received',
            status = 'validated',
            updated_at = NOW()
          WHERE id = $2
          `,
          [finalLotId, lineId]
        );

      } else {
        await client.query(
          `
          UPDATE purchase_lines
          SET
            lot_id = NULL,
            line_status = 'pending',
            updated_at = NOW()
          WHERE id = $1
          `,
          [lineId]
        );
      }

      const articleIdsToRecompute = [...new Set([oldArticleId, finalArticleId].filter(Boolean))];

      for (const articleIdToRecompute of articleIdsToRecompute) {
        await recomputeArticleStock(
          client,
          articleIdToRecompute,
          line.purchase_store_id,
          line.purchase_department_id
        );
      }
    }

    await client.query('COMMIT');

    res.json({
      ok: true,
      message: line.purchase_status === 'received'
        ? 'Ligne reçue corrigée avec reconstruction du stock'
        : 'Ligne achat mise à jour',
      article: articleResult.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur PATCH /api/purchase-lines/:id :', err);
    res.status(500).json({ error: 'Erreur mise à jour ligne achat' });
  } finally {
    client.release();
  }
});

router.post(
  '/purchase-lines/:id/upload-photo',
  authenticateToken,
  attachDbContext,
  uploadSanitaryPhotoDebug,
  async (req, res) => {
    const client = await req.dbPool.connect();

    try {
      const lineId = req.params.id;

      if (!req.file) {
        return res.status(400).json({ error: 'Aucun fichier reçu' });
      }

      const lineCheck = await client.query(
        `
        SELECT
          pl.id,
          pl.store_id,
          p.status AS purchase_status
        FROM purchase_lines pl
        JOIN purchases p ON p.id = pl.purchase_id
        WHERE pl.id = $1
          AND pl.store_id = $2
        LIMIT 1
        `,
        [lineId, req.user.store_id]
      );

      if (lineCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Ligne achat introuvable' });
      }

      const line = lineCheck.rows[0];

      if (['closed', 'cancelled'].includes(line.purchase_status)) {
        return res.status(400).json({ error: 'Achat verrouillé' });
      }

      const relativePath = `/uploads/sanitary/${lineId}/${req.file.filename}`;

      await client.query('BEGIN');

      await client.query(
        `
        INSERT INTO purchase_line_metadata (
  id,
  purchase_line_id,
  meta_key,
  meta_value,
  sanitary_photo_url,
  sanitary_photo_urls
)
VALUES (
  gen_random_uuid(),
  $1,
  'v2_line',
  '{}'::jsonb,
  $2::text,
  jsonb_build_array($2::text)
)
ON CONFLICT (purchase_line_id, meta_key)
DO NOTHING
        `,
        [lineId, relativePath]
      );

      await client.query(
  `
  UPDATE purchase_line_metadata
  SET
    sanitary_photo_url = COALESCE(NULLIF(sanitary_photo_url, ''), $2::text),
    sanitary_photo_urls = (
      SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
      FROM (
        SELECT elem
        FROM jsonb_array_elements(COALESCE(sanitary_photo_urls, '[]'::jsonb)) AS elem
        UNION ALL
        SELECT to_jsonb($2::text)
      ) AS all_elems
    )
  WHERE purchase_line_id = $1
    AND meta_key = 'v2_line'
  `,
  [lineId, relativePath]
);

      const metadataResult = await client.query(
        `
        SELECT sanitary_photo_url,
               COALESCE(sanitary_photo_urls, '[]'::jsonb) AS sanitary_photo_urls
        FROM purchase_line_metadata
        WHERE purchase_line_id = $1
          AND meta_key = 'v2_line'
        LIMIT 1
        `,
        [lineId]
      );

      await client.query('COMMIT');

      const metadata = metadataResult.rows[0] || {};

      res.json({
        ok: true,
        message: 'Photo sanitaire enregistrée',
        sanitary_photo_url: metadata.sanitary_photo_url,
        sanitary_photo_urls: metadata.sanitary_photo_urls,
        uploaded_photo_url: relativePath,
        filename: req.file.filename,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Erreur POST /api/purchase-lines/:id/upload-photo :', err);
      res.status(500).json({ error: 'Erreur upload photo' });
    } finally {
      client.release();
    }
  }
);

// SUPPRIMER UNE LIGNE ACHAT
router.delete('/purchase-lines/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const lineId = req.params.id;

    await client.query('BEGIN');

    const lineCheck = await client.query(
      `
      SELECT
        pl.id,
        pl.purchase_id,
        pl.store_id,
        pl.department_id,
        pl.article_id,
        pl.lot_id,
        p.status AS purchase_status,
        p.store_id AS purchase_store_id,
        p.department_id AS purchase_department_id
      FROM purchase_lines pl
      JOIN purchases p ON p.id = pl.purchase_id
      WHERE pl.id = $1
        AND pl.store_id = $2
      LIMIT 1
      `,
      [lineId, req.user.store_id]
    );

    if (lineCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ligne achat introuvable' });
    }

    const line = lineCheck.rows[0];

    if (['closed', 'cancelled'].includes(line.purchase_status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Impossible de supprimer une ligne sur un achat clôturé ou annulé',
      });
    }

    if (line.lot_id) {
      await client.query(
        `
        DELETE FROM stock_movements
        WHERE lot_id = $1
           OR (source_table = 'purchase_lines' AND source_id = $2)
        `,
        [line.lot_id, lineId]
      );

      await client.query(
        `
        DELETE FROM lots
        WHERE id = $1
        `,
        [line.lot_id]
      );
    } else {
      await client.query(
        `
        DELETE FROM stock_movements
        WHERE source_table = 'purchase_lines'
          AND source_id = $1
        `,
        [lineId]
      );
    }

    await client.query(
      `
      DELETE FROM purchase_line_metadata
      WHERE purchase_line_id = $1
      `,
      [lineId]
    );

    await client.query(
      `
      DELETE FROM purchase_lines
      WHERE id = $1
        AND store_id = $2
      `,
      [lineId, req.user.store_id]
    );

    if (line.article_id) {
      await recomputeArticleStock(
        client,
        line.article_id,
        line.purchase_store_id,
        line.purchase_department_id
      );
    }

    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Ligne achat supprimée avec succès',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur DELETE /api/purchase-lines/:id :', err);
    res.status(500).json({ error: 'Erreur suppression ligne achat' });
  } finally {
    client.release();
  }
});

// IMPORT DOCUMENT FOURNISSEUR
router.post(
  '/purchases/import-document',
  authenticateToken,
  attachDbContext,
  requireAdminOrManager,
  uploadImportDocument.single('document'),
  async (req, res) => {
    const client = await req.dbPool.connect();

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Aucun document reçu' });
      }

      const importDocument = require('../services/imports/import-document');
      const supplierCodeOverride = req.body.supplier_code_override || null;
      const crieeLayoutOverride = req.body.criee_layout_override || null;
      const importParserId = req.body.import_parser_id || null;
      const parsedResult = await importDocument(req.file, { 
        supplier_code_override: supplierCodeOverride,
        criee_layout_override: crieeLayoutOverride,
        import_parser_id: importParserId
      });

      if (!parsedResult.ok) {
        return res.status(400).json(parsedResult);
      }

      const importData = parsedResult.result;
      const currentDepartmentId = req.body.department_id || null;

      if (!currentDepartmentId) {
        return res.status(400).json({ error: 'department_id obligatoire' });
      }

      if (!Array.isArray(importData.lines) || importData.lines.length === 0) {
        return res.status(400).json({ error: 'Aucune ligne importable détectée' });
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
        [currentDepartmentId, req.user.store_id]
      );

      if (departmentCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Rayon invalide pour ce magasin' });
      }

      let supplier = null;

      if (importData.supplier_code) {
        const supplierResult = await client.query(
          `
          SELECT id, code, name
          FROM suppliers
          WHERE store_id = $1
            AND (
              UPPER(code) = UPPER($2)
              OR REPLACE(UPPER(code), ' ', '') = REPLACE(UPPER($2), ' ', '')
              OR REPLACE(UPPER(name), ' ', '') = REPLACE(UPPER($2), ' ', '')
            )
          LIMIT 1
          `,
          [req.user.store_id, importData.supplier_code]
        );

        if (supplierResult.rows.length > 0) {
          supplier = supplierResult.rows[0];
        }
      }

      if (!supplier && importData.supplier_name) {
        const supplierResult = await client.query(
          `
          SELECT id, code, name
          FROM suppliers
          WHERE store_id = $1
            AND REPLACE(UPPER(name), ' ', '') = REPLACE(UPPER($2), ' ', '')
          LIMIT 1
          `,
          [req.user.store_id, importData.supplier_name]
        );

        if (supplierResult.rows.length > 0) {
          supplier = supplierResult.rows[0];
        }
      }

      if (!supplier) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Fournisseur introuvable pour l'import (${importData.supplier_code || importData.supplier_name || 'inconnu'})`
        });
      }

      const purchaseInsert = await client.query(
        `
        INSERT INTO purchases (
          id,
          store_id,
          department_id,
          supplier_id,
          purchase_date,
          status,
          purchase_type,
          order_date,
          notes,
          created_by,
          updated_by,
          bl_number
        )
        VALUES (
          gen_random_uuid(),
          $1, $2, $3,
          CURRENT_DATE,
          'ordered',
          'order',
          CURRENT_DATE,
          $4,
          $5,
          $5,
          NULL
        )
        RETURNING *
        `,
        [
          req.user.store_id,
          currentDepartmentId,
          supplier.id,
          `Import auto ${parsedResult.detected_label || parsedResult.detected_type || ''}`.trim(),
          req.user.id,
        ]
      );

      const purchase = purchaseInsert.rows[0];

      const createdLsArticles = [];
      const missingLsArticles = [];
      const missingTradMappings = [];

      let lineNumber = 1;
      let importTotalHt = 0;

      for (const rawLine of importData.lines) {
        const supplierReference = rawLine.supplier_reference || null;
        const supplierLabel = rawLine.supplier_label || rawLine.designation || null;
        const articlePlu = rawLine.article_plu || null;

        let resolvedArticleId = null;
        let resolvedMappingId = null;

        if (articlePlu) {
          const articleResult = await client.query(
            `
            SELECT id
            FROM articles
            WHERE store_id = $1
              AND plu = $2
            LIMIT 1
            `,
            [req.user.store_id, articlePlu]
          );

          if (articleResult.rows.length > 0) {
            resolvedArticleId = articleResult.rows[0].id;
          }
        }

        if (!resolvedArticleId && supplierReference) {
          const mappingResult = await client.query(
            `
            SELECT m.id, m.article_id
            FROM supplier_article_mappings m
            WHERE m.supplier_id = $1
              AND m.supplier_ref = $2
              AND m.is_active = true
            LIMIT 1
            `,
            [supplier.id, supplierReference]
          );

          if (mappingResult.rows.length > 0) {
            resolvedMappingId = mappingResult.rows[0].id;
            resolvedArticleId = mappingResult.rows[0].article_id;
          } else if (supplier.code === '81268' || supplier.code === '81269') {
            const fallbackSupplierCode = supplier.code === '81268' ? '81269' : '81268';
            const fallbackSupplierResult = await client.query(
              `
              SELECT id
              FROM suppliers
              WHERE store_id = $1
                AND code = $2
              LIMIT 1
              `,
              [req.user.store_id, fallbackSupplierCode]
            );

            if (fallbackSupplierResult.rows.length > 0) {
              const fallbackMappingResult = await client.query(
                `
                SELECT m.id, m.article_id
                FROM supplier_article_mappings m
                WHERE m.supplier_id = $1
                  AND m.supplier_ref = $2
                  AND m.is_active = true
                LIMIT 1
                `,
                [fallbackSupplierResult.rows[0].id, supplierReference]
              );

              if (fallbackMappingResult.rows.length > 0) {
                resolvedMappingId = fallbackMappingResult.rows[0].id;
                resolvedArticleId = fallbackMappingResult.rows[0].article_id;
                console.log(
                  `[IMPORT CRIEE] fallback mapping used from supplier ${fallbackSupplierCode} for current supplier ${supplier.code}, ref ${supplierReference}`
                );
              }
            }
          }
        }

        if (parsedResult.detected_type === 'SCAPMAREE' && rawLine.line_kind === 'LS' && rawLine.article_plu && !resolvedArticleId) {
          const createdLs = await ensureLsArticleForImport(client, {
            storeId: req.user.store_id,
            departmentId: currentDepartmentId,
            plu: rawLine.article_plu,
            designation: rawLine.designation || rawLine.supplier_label || `Article ${rawLine.article_plu}`,
          });

          resolvedArticleId = createdLs.article_id;

          if (createdLs.created) {
            createdLsArticles.push({
              plu: rawLine.article_plu,
              designation: rawLine.designation || rawLine.supplier_label || null,
            });
          }
        }

        if (
          rawLine.line_kind === 'TRAD' &&
          rawLine.supplier_reference &&
          !resolvedArticleId &&
          !resolvedMappingId
        ) {
          missingTradMappings.push({
            supplier_reference: rawLine.supplier_reference,
            designation: rawLine.designation || rawLine.supplier_label || null,
          });
        }

        if (parsedResult.detected_type === 'SCAPMAREE' && rawLine.line_kind === 'LS' && rawLine.article_plu && !resolvedArticleId) {
          missingLsArticles.push({
            plu: rawLine.article_plu,
            designation: rawLine.designation || rawLine.supplier_label || null,
          });
        }

        let orderedColis =
          rawLine.ordered_colis !== undefined && rawLine.ordered_colis !== null && rawLine.ordered_colis !== ''
            ? Number(rawLine.ordered_colis)
            : null;

        let orderedPieces =
          rawLine.ordered_pieces !== undefined && rawLine.ordered_pieces !== null && rawLine.ordered_pieces !== ''
            ? Number(rawLine.ordered_pieces)
            : null;

        let orderedQuantity =
          rawLine.ordered_quantity !== undefined && rawLine.ordered_quantity !== null && rawLine.ordered_quantity !== ''
            ? Number(rawLine.ordered_quantity)
            : null;

        const unitPrice =
          rawLine.unit_price_ex_vat !== undefined && rawLine.unit_price_ex_vat !== null && rawLine.unit_price_ex_vat !== ''
            ? Number(rawLine.unit_price_ex_vat)
            : 0;

        let lineAmount =
          rawLine.line_amount_ex_vat !== undefined && rawLine.line_amount_ex_vat !== null && rawLine.line_amount_ex_vat !== ''
            ? Number(rawLine.line_amount_ex_vat)
            : 0;

        let priceUnit = normalizeImportUnit(rawLine.price_unit);

        if (resolvedArticleId) {
          const articleUnitResult = await client.query(
            `
            SELECT
              a.unit,
              ad.purchase_unit,
              ad.stock_unit,
              ad.sale_unit
            FROM articles a
            LEFT JOIN article_departments ad
              ON ad.article_id = a.id
             AND ad.department_id = $2
            WHERE a.id = $1
              AND a.store_id = $3
            LIMIT 1
            `,
            [resolvedArticleId, currentDepartmentId, req.user.store_id]
          );

          if (articleUnitResult.rows.length > 0) {
            const articleUnitRow = articleUnitResult.rows[0];
            const articleUnit = articleUnitRow.purchase_unit || articleUnitRow.unit || 'kg';
            priceUnit = normalizeImportUnit(articleUnit);
          }
        }

        if (priceUnit === 'piece') {
          if ((orderedPieces === null || orderedPieces === 0) && orderedQuantity !== null && orderedQuantity > 0) {
            orderedPieces = orderedQuantity;
          }
          orderedQuantity = null;
          orderedColis = null;
        } else if (priceUnit === 'colis') {
          if ((orderedColis === null || orderedColis === 0) && orderedQuantity !== null && orderedQuantity > 0) {
            orderedColis = orderedQuantity;
          }
          orderedQuantity = null;
          orderedPieces = null;
        } else {
          orderedColis = null;
          orderedPieces = null;
        }

        if (!lineAmount || lineAmount === 0) {
          const baseQty =
            priceUnit === 'piece'
              ? Number(orderedPieces || 0)
              : priceUnit === 'colis'
                ? Number(orderedColis || 0)
                : Number(orderedQuantity || 0);

          lineAmount = Number((baseQty * Number(unitPrice || 0)).toFixed(4));
        }

        importTotalHt += Number(lineAmount || 0);

        const lineInsert = await client.query(
          `
          INSERT INTO purchase_lines (
            id,
            purchase_id,
            store_id,
            department_id,
            supplier_id,
            line_number,
            supplier_article_mapping_id,
            article_id,
            supplier_reference,
            supplier_label,
            ordered_colis,
            ordered_pieces,
            ordered_quantity,
            received_colis,
            received_pieces,
            received_quantity,
            stock_quantity,
            unit_price_ex_vat,
            line_amount_ex_vat,
            line_status,
            lot_mode,
            price_unit
          )
          VALUES (
            gen_random_uuid(),
            $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12,
            0, 0, 0,
            0,
            $13,
            $14,
            'pending',
            'auto',
            $15
          )
          RETURNING id
          `,
          [
            purchase.id,
            req.user.store_id,
            currentDepartmentId,
            supplier.id,
            lineNumber,
            resolvedMappingId,
            resolvedArticleId,
            supplierReference,
            supplierLabel,
            orderedColis,
            orderedPieces,
            orderedQuantity,
            unitPrice,
            lineAmount,
            priceUnit,
          ]
        );

        const lineId = lineInsert.rows[0].id;

        await client.query(
          `
          INSERT INTO purchase_line_metadata (
            id,
            purchase_line_id,
            meta_key,
            meta_value,
            dlc,
            latin_name,
            fao_zone,
            sous_zone,
            fishing_gear,
            origin_label,
            allergens,
            supplier_lot_number,
            sanitary_photo_url,
            notes
          )
          VALUES (
            gen_random_uuid(),
            $1,
            'v2_line',
            '{}'::jsonb,
            $2, $3, $4, $5, $6, $7, $8, $9, NULL, NULL
          )
          ON CONFLICT (purchase_line_id, meta_key)
          DO UPDATE SET
            dlc = EXCLUDED.dlc,
            latin_name = EXCLUDED.latin_name,
            fao_zone = EXCLUDED.fao_zone,
            sous_zone = EXCLUDED.sous_zone,
            fishing_gear = EXCLUDED.fishing_gear,
            origin_label = EXCLUDED.origin_label,
            allergens = EXCLUDED.allergens,
            supplier_lot_number = EXCLUDED.supplier_lot_number
          `,
          [
            lineId,
            rawLine.dlc || null,
            rawLine.latin_name || null,
            rawLine.fao_zone || null,
            rawLine.sous_zone || null,
            rawLine.fishing_gear || null,
            rawLine.origin_label || null,
            rawLine.allergens || null,
            rawLine.supplier_lot_number || null,
          ]
        );

        lineNumber += 1;
      }

      let cotisationPurchase = null;

      if (parsedResult.detected_type === 'SCAPMAREE') {
        cotisationPurchase = await createScapCotisationPurchase(client, {
          storeId: req.user.store_id,
          departmentId: currentDepartmentId,
          supplierId: supplier.id,
          userId: req.user.id,
          linkedPurchaseId: purchase.id,
          totalHt: importTotalHt,
        });
      }

      await client.query('COMMIT');

      console.log('IMPORT /api/purchases/import-document:', {
        purchase_id: purchase.id,
        supplier_code: supplier.code,
        missing_trad_mappings_count: missingTradMappings.length,
        missing_trad_mappings: missingTradMappings,
      });

      res.json({
        ok: true,
        message: 'Import document terminé',
        detected_type: parsedResult.detected_type,
        detected_label: parsedResult.detected_label,
        purchase: {
          id: purchase.id,
          supplier_name: supplier.name,
          supplier_code: supplier.code,
        },
        imported_lines: importData.lines.length,
        warnings: importData.warnings || [],
        created_ls_articles: createdLsArticles,
        missing_ls_articles: missingLsArticles,
        missing_trad_mappings: missingTradMappings,
        cotisation_purchase: cotisationPurchase,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Erreur import document :', error);
      res.status(500).json({ error: 'Erreur import document' });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
