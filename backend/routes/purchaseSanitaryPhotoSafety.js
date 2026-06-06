const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const { recomputeArticleStock } = require('../services/stockService');

const router = express.Router();

const SANITARY_PHOTOS_ROOT = path.join(__dirname, '..', 'uploads', 'sanitary-photos');
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

fs.mkdirSync(SANITARY_PHOTOS_ROOT, { recursive: true });

const sanitaryPhotoStorage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, SANITARY_PHOTOS_ROOT);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ALLOWED_IMAGE_EXTENSIONS.has(ext) ? ext : '.jpg';
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `sanitary-${unique}${safeExt}`);
  },
});

const sanitaryPhotoUpload = multer({
  storage: sanitaryPhotoStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
      return cb(Object.assign(new Error('Format image non supporte'), { status: 400, expose: true }));
    }
    return cb(null, true);
  },
});

function removeUploadedFile(file) {
  if (!file?.path) return;
  fs.unlink(file.path, (error) => {
    if (error) console.warn('Impossible de supprimer le fichier upload orphelin :', file.path, error.message);
  });
}

function removeUploadedFiles(files) {
  files.forEach(removeUploadedFile);
}

function uploadedSanitaryFiles(req) {
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === 'object') {
    return Object.values(req.files).flat().filter(Boolean);
  }
  return req.file ? [req.file] : [];
}

function toNullableString(v) {
  const s = String(v ?? '').trim();
  return s || null;
}

function normalizePriceUnit(v) {
  return ['kg', 'piece', 'colis'].includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'kg';
}

function lineAmount(line, useReceived = false) {
  const unit = normalizePriceUnit(line.price_unit);
  const colis = Number((useReceived ? line.received_colis : line.ordered_colis) || 0);
  const pieces = Number((useReceived ? line.received_pieces : line.ordered_pieces) || 0);
  const qty = Number((useReceived ? line.received_quantity : line.ordered_quantity) || 0);
  const price = Number(line.unit_price_ex_vat || 0);
  if (unit === 'colis') return Number((colis * price).toFixed(4));
  if (unit === 'piece') return Number(((colis > 0 && pieces > 0 ? colis * pieces : pieces) * price).toFixed(4));
  return Number(((colis > 0 && qty > 0 ? colis * qty : qty) * price).toFixed(4));
}

async function recomputePurchaseTotals(client, purchaseId) {
  await client.query(
    `UPDATE purchases p
     SET total_amount_ex_vat = COALESCE(x.total, 0), updated_at = NOW()
     FROM (SELECT COALESCE(SUM(line_amount_ex_vat), 0) total FROM purchase_lines WHERE purchase_id = $1) x
     WHERE p.id = $1`,
    [purchaseId]
  );
}

async function resolveArticle(client, storeId, { article_id, article_plu }) {
  if (article_id) {
    const r = await client.query('SELECT id, plu, designation, unit, latin_name, fao_zone, sous_zone, engin, category, allergenes FROM articles WHERE id = $1 AND store_id = $2 LIMIT 1', [article_id, storeId]);
    return r.rows[0] || null;
  }
  if (article_plu) {
    const r = await client.query('SELECT id, plu, designation, unit, latin_name, fao_zone, sous_zone, engin, category, allergenes FROM articles WHERE store_id = $1 AND plu = $2 LIMIT 1', [storeId, String(article_plu).trim()]);
    return r.rows[0] || null;
  }
  return null;
}

function sanitaryPhotoUrl(fileName) {
  return `/uploads/sanitary-photos/${fileName}`;
}

function isSafeSanitaryPhotoUrl(value) {
  const url = String(value || '').trim();
  if (!url) return false;
  return url.startsWith('/uploads/sanitary-photos/') || url.startsWith('http://') || url.startsWith('https://');
}

function normalizeSanitaryPhotoUrls(rawUrls, primaryUrl = null, context = {}) {
  const urls = [];

  const addUrl = (value) => {
    const url = String(value || '').trim();
    if (!isSafeSanitaryPhotoUrl(url)) {
      if (url) console.error('Photo sanitaire ignoree: URL invalide', { ...context, url });
      return;
    }
    if (!urls.includes(url)) urls.push(url);
  };

  addUrl(primaryUrl);

  if (Array.isArray(rawUrls)) {
    rawUrls.forEach(addUrl);
    return urls;
  }

  if (typeof rawUrls === 'string') {
    const trimmed = rawUrls.trim();
    if (!trimmed) return urls;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        parsed.forEach(addUrl);
      } else {
        console.error('Photo sanitaire ignoree: sanitary_photo_urls JSON non-array', { ...context, value: rawUrls });
      }
    } catch (error) {
      addUrl(trimmed);
    }
    return urls;
  }

  if (rawUrls !== null && rawUrls !== undefined) {
    console.error('Photo sanitaire ignoree: sanitary_photo_urls non-array', { ...context, type: typeof rawUrls });
  }

  return urls;
}

function sanitizePurchaseLine(line) {
  return {
    ...line,
    sanitary_photo_urls: normalizeSanitaryPhotoUrls(line.sanitary_photo_urls, line.sanitary_photo_url, {
      purchase_line_id: line.id,
      purchase_id: line.purchase_id,
    }),
  };
}

router.get('/purchases', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const { status = '', supplier_id = '', date_from = '', date_to = '', limit = '500' } = req.query;
    const params = [req.user.store_id];
    let where = 'WHERE p.store_id = $1';
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
    params.push(Math.min(Number(limit) || 500, 2000));

    const result = await req.dbPool.query(
      `SELECT p.*, s.name supplier_name, COUNT(pl.id) line_count
       FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN purchase_lines pl ON pl.purchase_id = p.id
       ${where}
       GROUP BY p.id, s.name
       ORDER BY p.created_at DESC
       LIMIT $${params.length}`,
      params
    );

    return res.json(Array.isArray(result.rows) ? result.rows : []);
  } catch (error) {
    console.error('Erreur liste achats securisee :', error);
    return res.status(500).json({ error: 'Erreur serveur achats' });
  }
});

router.get('/purchases/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const purchaseResult = await req.dbPool.query(
      `SELECT p.*, s.name supplier_name
       FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.id = $1 AND p.store_id = $2
       LIMIT 1`,
      [req.params.id, req.user.store_id]
    );

    if (!purchaseResult.rows.length) return res.status(404).json({ error: 'Achat introuvable' });

    const linesResult = await req.dbPool.query(
      `SELECT pl.*, a.plu article_plu, a.designation article_name,
              plm.dlc, plm.latin_name, plm.fao_zone, plm.sous_zone, plm.fishing_gear,
              plm.production_method, plm.allergens, plm.origin_label, plm.supplier_lot_number,
              plm.sanitary_photo_url,
              CASE
                WHEN jsonb_typeof(plm.sanitary_photo_urls) = 'array' THEN plm.sanitary_photo_urls
                WHEN plm.sanitary_photo_url IS NOT NULL THEN jsonb_build_array(plm.sanitary_photo_url)
                ELSE '[]'::jsonb
              END AS sanitary_photo_urls,
              plm.notes metadata_notes
       FROM purchase_lines pl
       LEFT JOIN articles a ON a.id = pl.article_id
       LEFT JOIN purchase_line_metadata plm ON plm.purchase_line_id = pl.id AND plm.meta_key = 'gc_line'
       WHERE pl.purchase_id = $1 AND pl.store_id = $2
       ORDER BY pl.line_number`,
      [req.params.id, req.user.store_id]
    );

    return res.json({
      purchase: purchaseResult.rows[0],
      lines: linesResult.rows.map(sanitizePurchaseLine),
    });
  } catch (error) {
    console.error('Erreur detail achat securise :', error);
    return res.status(500).json({ error: 'Erreur détail achat' });
  }
});

router.patch('/purchase-lines/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    await client.query('BEGIN');
    const chk = await client.query(
      `SELECT pl.*, p.status purchase_status
       FROM purchase_lines pl
       JOIN purchases p ON p.id = pl.purchase_id
       WHERE pl.id = $1 AND pl.store_id = $2
       LIMIT 1`,
      [req.params.id, req.user.store_id]
    );

    if (!chk.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ligne introuvable' });
    }
    if (['closed', 'cancelled'].includes(chk.rows[0].purchase_status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ligne non modifiable' });
    }

    const article = await resolveArticle(client, req.user.store_id, req.body) || (chk.rows[0].article_id ? { id: chk.rows[0].article_id } : null);
    if (!article?.id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Article introuvable' });
    }

    const merged = { ...chk.rows[0], ...req.body, price_unit: normalizePriceUnit(req.body.price_unit || chk.rows[0].price_unit) };
    const amount = lineAmount(merged, chk.rows[0].purchase_status === 'received');
    const lineResult = await client.query(
      `UPDATE purchase_lines
       SET article_id = $1, ordered_colis = $2, ordered_pieces = $3, ordered_quantity = $4,
           received_colis = $5, received_pieces = $6, received_quantity = $7,
           unit_price_ex_vat = $8, price_unit = $9, line_amount_ex_vat = $10, updated_at = NOW()
       WHERE id = $11
       RETURNING *`,
      [
        article.id,
        req.body.ordered_colis ?? chk.rows[0].ordered_colis,
        req.body.ordered_pieces ?? chk.rows[0].ordered_pieces,
        req.body.ordered_quantity ?? chk.rows[0].ordered_quantity,
        req.body.received_colis ?? chk.rows[0].received_colis,
        req.body.received_pieces ?? chk.rows[0].received_pieces,
        req.body.received_quantity ?? chk.rows[0].received_quantity,
        req.body.unit_price_ex_vat ?? chk.rows[0].unit_price_ex_vat,
        merged.price_unit,
        amount,
        req.params.id,
      ]
    );

    const hasPhotoUrls = Object.prototype.hasOwnProperty.call(req.body, 'sanitary_photo_urls');
    const hasPrimaryPhoto = Boolean(toNullableString(req.body.sanitary_photo_url));
    const normalizedPhotoUrls = hasPhotoUrls || hasPrimaryPhoto
      ? normalizeSanitaryPhotoUrls(req.body.sanitary_photo_urls, req.body.sanitary_photo_url, { purchase_line_id: req.params.id })
      : null;

    await client.query(
      `INSERT INTO purchase_line_metadata(
        id, purchase_line_id, meta_key, meta_value, latin_name, fao_zone, sous_zone,
        fishing_gear, allergens, origin_label, supplier_lot_number, dlc,
        sanitary_photo_url, sanitary_photo_urls, notes, updated_at
       )
       VALUES(gen_random_uuid(), $1, 'gc_line', '{}'::jsonb, $2, $3, $4, $5, $6, $7, $8, $9,
              $10::text, $11::jsonb, $12, NOW())
       ON CONFLICT(purchase_line_id, meta_key)
       DO UPDATE SET
         latin_name = EXCLUDED.latin_name,
         fao_zone = EXCLUDED.fao_zone,
         sous_zone = EXCLUDED.sous_zone,
         fishing_gear = EXCLUDED.fishing_gear,
         allergens = EXCLUDED.allergens,
         origin_label = EXCLUDED.origin_label,
         supplier_lot_number = EXCLUDED.supplier_lot_number,
         dlc = EXCLUDED.dlc,
         sanitary_photo_url = COALESCE(EXCLUDED.sanitary_photo_url, purchase_line_metadata.sanitary_photo_url),
         sanitary_photo_urls = COALESCE(
           EXCLUDED.sanitary_photo_urls,
           CASE
             WHEN jsonb_typeof(purchase_line_metadata.sanitary_photo_urls) = 'array' THEN purchase_line_metadata.sanitary_photo_urls
             WHEN purchase_line_metadata.sanitary_photo_url IS NOT NULL THEN jsonb_build_array(purchase_line_metadata.sanitary_photo_url)
             ELSE '[]'::jsonb
           END
         ),
         notes = EXCLUDED.notes,
         updated_at = NOW()`,
      [
        req.params.id,
        req.body.latin_name || null,
        req.body.fao_zone || null,
        req.body.sous_zone || null,
        req.body.fishing_gear || null,
        req.body.allergens || null,
        req.body.origin_label || null,
        req.body.supplier_lot_number || null,
        req.body.dlc || null,
        toNullableString(req.body.sanitary_photo_url),
        normalizedPhotoUrls ? JSON.stringify(normalizedPhotoUrls) : null,
        req.body.metadata_notes || null,
      ]
    );

    await recomputePurchaseTotals(client, chk.rows[0].purchase_id);
    await client.query('COMMIT');
    return res.json({ ok: true, line: lineResult.rows[0], article });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur modification ligne achat securisee :', error);
    return res.status(500).json({ error: 'Erreur modification ligne achat' });
  } finally {
    client.release();
  }
});

router.post('/purchase-lines/:id/sanitary-photos', authenticateToken, attachDbContext, requireAdminOrManager, sanitaryPhotoUpload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'photos', maxCount: 12 },
]), async (req, res) => {
  const client = await req.dbPool.connect();
  const files = uploadedSanitaryFiles(req);
  try {
    if (!files.length) return res.status(400).json({ error: 'Photo obligatoire' });

    await client.query('BEGIN');
    const line = await client.query(
      `SELECT pl.id, pl.purchase_id, pl.store_id, p.status
       FROM purchase_lines pl
       JOIN purchases p ON p.id = pl.purchase_id
       WHERE pl.id = $1 AND pl.store_id = $2
       LIMIT 1`,
      [req.params.id, req.user.store_id]
    );

    if (!line.rows.length) {
      await client.query('ROLLBACK');
      removeUploadedFiles(files);
      return res.status(404).json({ error: 'Ligne achat introuvable' });
    }

    if (['closed', 'cancelled'].includes(line.rows[0].status)) {
      await client.query('ROLLBACK');
      removeUploadedFiles(files);
      return res.status(400).json({ error: 'Achat verrouille' });
    }

    const urls = normalizeSanitaryPhotoUrls(files.map((file) => sanitaryPhotoUrl(file.filename)), null, { purchase_line_id: req.params.id });
    if (!urls.length) {
      await client.query('ROLLBACK');
      removeUploadedFiles(files);
      return res.status(400).json({ error: 'Aucune URL photo valide' });
    }

    const primaryUrl = urls[0];
    await client.query(
      `INSERT INTO purchase_line_metadata(
        id, purchase_line_id, meta_key, meta_value, sanitary_photo_url, sanitary_photo_urls, updated_at
       )
       VALUES(gen_random_uuid(), $1, 'gc_line', '{}'::jsonb, $2::text, $3::jsonb, NOW())
       ON CONFLICT(purchase_line_id, meta_key)
       DO UPDATE SET
         sanitary_photo_url = COALESCE(purchase_line_metadata.sanitary_photo_url, EXCLUDED.sanitary_photo_url),
         sanitary_photo_urls = (
           CASE
             WHEN jsonb_typeof(purchase_line_metadata.sanitary_photo_urls) = 'array' THEN purchase_line_metadata.sanitary_photo_urls
             WHEN purchase_line_metadata.sanitary_photo_url IS NOT NULL THEN jsonb_build_array(purchase_line_metadata.sanitary_photo_url)
             ELSE '[]'::jsonb
           END
         ) || EXCLUDED.sanitary_photo_urls,
         updated_at = NOW()`,
      [req.params.id, primaryUrl, JSON.stringify(urls)]
    );

    await client.query('COMMIT');
    return res.status(201).json({ ok: true, url: primaryUrl, urls });
  } catch (error) {
    await client.query('ROLLBACK');
    removeUploadedFiles(files);
    console.error('Erreur upload photo sanitaire securise :', {
      purchase_line_id: req.params.id,
      store_id: req.user?.store_id,
      uploaded_files: files.map((file) => file.path),
      message: error.message,
      stack: error.stack,
    });
    return res.status(500).json({ error: 'Erreur upload photo sanitaire' });
  } finally {
    client.release();
  }
});

module.exports = router;
