const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const importDocument = require('../services/imports/import-document');
const { recomputeArticleStock } = require('../services/stockService');

const router = express.Router();

const PURCHASE_DOCUMENTS_ROOT = path.join(__dirname, '..', 'uploads', 'purchase-documents');
const SANITARY_PHOTOS_ROOT = path.join(__dirname, '..', 'uploads', 'sanitary-photos');
const ALLOWED_IMPORT_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv', '.pdf']);
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

fs.mkdirSync(PURCHASE_DOCUMENTS_ROOT, { recursive: true });
fs.mkdirSync(SANITARY_PHOTOS_ROOT, { recursive: true });

const documentUpload = multer({
  dest: PURCHASE_DOCUMENTS_ROOT,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_IMPORT_EXTENSIONS.has(ext)) {
      return cb(Object.assign(new Error('Format de fichier non supporte'), { status: 400, expose: true }));
    }
    return cb(null, true);
  },
});

const sanitaryPhotoUpload = multer({
  dest: SANITARY_PHOTOS_ROOT,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
      return cb(Object.assign(new Error('Format image non supporte'), { status: 400, expose: true }));
    }
    return cb(null, true);
  },
});

function normalizePriceUnit(v) {
  return ['kg', 'piece', 'colis'].includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'kg';
}

function buildLotCode(plu, supplierId, lineId) {
  const p = String(plu || 'NOPLU').replace(/\s+/g, '').toUpperCase();
  const s = String(supplierId || '').replace(/-/g, '').slice(0, 6).toUpperCase();
  const l = String(lineId || '').replace(/-/g, '').slice(0, 6).toUpperCase();
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const ddd = String(Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86400000)).padStart(3, '0');
  return `${p}-${yy}${ddd}-${s}-${l}`;
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
    const r = await client.query('SELECT id, plu, designation, unit FROM articles WHERE id = $1 AND store_id = $2 LIMIT 1', [article_id, storeId]);
    return r.rows[0] || null;
  }
  if (article_plu) {
    const r = await client.query('SELECT id, plu, designation, unit FROM articles WHERE store_id = $1 AND plu = $2 LIMIT 1', [storeId, String(article_plu).trim()]);
    return r.rows[0] || null;
  }
  return null;
}

function publicPurchaseDocumentUrl(purchaseId) {
  return `/api/purchases/${encodeURIComponent(purchaseId)}/document`;
}

function sanitaryPhotoUrl(fileName) {
  return `/uploads/sanitary-photos/${fileName}`;
}

router.get('/purchases/:id/document', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const result = await req.dbPool.query(
      `SELECT source_document_storage_path, source_document_original_name
       FROM purchases
       WHERE id = $1 AND store_id = $2
       LIMIT 1`,
      [req.params.id, req.user.store_id]
    );

    if (!result.rows.length || !result.rows[0].source_document_storage_path) {
      return res.status(404).json({ error: 'Document achat introuvable' });
    }

    const storagePath = result.rows[0].source_document_storage_path;
    if (!fs.existsSync(storagePath)) return res.status(404).json({ error: 'Fichier achat introuvable' });
    return res.download(storagePath, result.rows[0].source_document_original_name || 'document-fournisseur');
  } catch (error) {
    console.error('Erreur document achat :', error);
    return res.status(500).json({ error: 'Erreur serveur document achat' });
  }
});

router.post('/purchase-lines/:id/sanitary-photos', authenticateToken, attachDbContext, requireAdminOrManager, sanitaryPhotoUpload.single('photo'), async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    if (!req.file) return res.status(400).json({ error: 'Photo obligatoire' });

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
      return res.status(404).json({ error: 'Ligne achat introuvable' });
    }

    if (['closed', 'cancelled'].includes(line.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Achat verrouille' });
    }

    const url = sanitaryPhotoUrl(req.file.filename);
    await client.query(
      `INSERT INTO purchase_line_metadata(
        id, purchase_line_id, meta_key, meta_value, sanitary_photo_url, sanitary_photo_urls, updated_at
       )
       VALUES(gen_random_uuid(), $1, 'gc_line', '{}'::jsonb, $2, jsonb_build_array($2), NOW())
       ON CONFLICT(purchase_line_id, meta_key)
       DO UPDATE SET
         sanitary_photo_url = EXCLUDED.sanitary_photo_url,
         sanitary_photo_urls = COALESCE(purchase_line_metadata.sanitary_photo_urls, '[]'::jsonb) || jsonb_build_array($2),
         updated_at = NOW()`,
      [req.params.id, url]
    );

    await client.query('COMMIT');
    return res.status(201).json({ ok: true, url });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur upload photo sanitaire :', error);
    return res.status(500).json({ error: 'Erreur upload photo sanitaire' });
  } finally {
    client.release();
  }
});

router.post('/purchases/import-document', authenticateToken, attachDbContext, requireAdminOrManager, documentUpload.single('document'), async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier obligatoire' });

    const parsed = await importDocument(req.file, {
      import_parser_id: req.body.import_parser_id,
      supplier_code_override: req.body.supplier_code_override,
    });
    if (!parsed.ok) return res.status(400).json(parsed);

    const result = parsed.result;
    await client.query('BEGIN');

    let supplier = null;
    if (result.supplier_code) {
      const sr = await client.query(
        'SELECT * FROM suppliers WHERE store_id = $1 AND (code = $2 OR name ILIKE $3) LIMIT 1',
        [req.user.store_id, result.supplier_code, `%${result.supplier_name || ''}%`]
      );
      supplier = sr.rows[0] || null;
    }

    if (!supplier) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Fournisseur introuvable: ${result.supplier_code || result.supplier_name}`, ...parsed });
    }

    const purchase = await client.query(
      `INSERT INTO purchases(
        id, store_id, client_key, supplier_id, purchase_date, status, purchase_type, order_date,
        notes, created_by, updated_by, source_document_url, source_document_storage_path,
        source_document_original_name, source_document_mime_type, source_document_uploaded_at, source_document_uploaded_by
       )
       VALUES(gen_random_uuid(), $1, $2, $3, CURRENT_DATE, 'ordered', $4, CURRENT_DATE,
        $5, $6, $6, NULL, $7, $8, $9, NOW(), $6)
       RETURNING *`,
      [
        req.user.store_id,
        req.user.client_key || null,
        supplier.id,
        result.purchase_type || 'direct_bl',
        `Import ${parsed.detected_label}`,
        req.user.id,
        req.file.path,
        req.file.originalname || null,
        req.file.mimetype || null,
      ]
    );

    const purchaseId = purchase.rows[0].id;
    const documentUrl = publicPurchaseDocumentUrl(purchaseId);
    await client.query('UPDATE purchases SET source_document_url = $1 WHERE id = $2', [documentUrl, purchaseId]);
    await client.query(
      `INSERT INTO supplier_invoice_documents(id, purchase_id, store_id, document_type, original_name, mime_type, storage_path, public_url, uploaded_by)
       VALUES(gen_random_uuid(), $1, $2, 'purchase_bl', $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [purchaseId, req.user.store_id, req.file.originalname || null, req.file.mimetype || null, req.file.path, documentUrl, req.user.id]
    ).catch(() => null);

    const missing = [];
    let imported = 0;

    for (const line of result.lines || []) {
      let article = null;
      if (line.article_plu) article = await resolveArticle(client, req.user.store_id, { article_plu: line.article_plu });
      if (!article && line.supplier_reference) {
        const m = await client.query(
          `SELECT a.*
           FROM supplier_article_mappings m
           JOIN articles a ON a.id = m.article_id
           WHERE m.supplier_id = $1 AND m.supplier_ref = $2 AND COALESCE(m.is_active, true) = true
           LIMIT 1`,
          [supplier.id, line.supplier_reference]
        ).catch(() => ({ rows: [] }));
        article = m.rows[0] || null;
      }
      if (!article && line.needs_mapping) missing.push({ supplier_reference: line.supplier_reference, designation: line.designation });

      const n = await client.query('SELECT COALESCE(MAX(line_number), 0) + 1 n FROM purchase_lines WHERE purchase_id = $1', [purchaseId]);
      const amount = line.line_amount_ex_vat ?? lineAmount(line, false);
      const ins = await client.query(
        `INSERT INTO purchase_lines(
          id, purchase_id, store_id, client_key, supplier_id, line_number, article_id,
          supplier_reference, supplier_label, ordered_colis, ordered_pieces, ordered_quantity,
          unit_price_ex_vat, line_amount_ex_vat, price_unit, line_status
         )
         VALUES(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending')
         RETURNING id`,
        [
          purchaseId,
          req.user.store_id,
          req.user.client_key || null,
          supplier.id,
          n.rows[0].n,
          article?.id || null,
          line.supplier_reference,
          line.supplier_label || line.designation,
          line.ordered_colis,
          line.ordered_pieces,
          line.ordered_quantity,
          line.unit_price_ex_vat || 0,
          amount,
          normalizePriceUnit(line.price_unit),
        ]
      );

      await client.query(
        `INSERT INTO purchase_line_metadata(
          id, purchase_line_id, meta_key, meta_value, latin_name, fao_zone, sous_zone,
          fishing_gear, allergens, origin_label, supplier_lot_number, dlc
         )
         VALUES(gen_random_uuid(), $1, 'gc_line', $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          ins.rows[0].id,
          JSON.stringify(line),
          line.latin_name,
          line.fao_zone,
          line.sous_zone,
          line.fishing_gear,
          line.allergens,
          line.origin_label,
          line.supplier_lot_number,
          line.dlc,
        ]
      );
      imported += 1;
    }

    await recomputePurchaseTotals(client, purchaseId);
    await client.query('COMMIT');
    return res.json({
      ...parsed,
      purchase: { ...purchase.rows[0], source_document_url: documentUrl, supplier_code: supplier.code },
      imported_lines: imported,
      missing_trad_mappings: missing,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur import document fournisseur :', error);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.post('/purchases/:id/validate-reception', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();
  try {
    await client.query('BEGIN');
    const p = await client.query('SELECT * FROM purchases WHERE id = $1 AND store_id = $2 FOR UPDATE', [req.params.id, req.user.store_id]);
    if (!p.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Achat introuvable' });
    }

    const purchase = p.rows[0];
    if (purchase.status !== 'ordered') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Document deja valide ou non modifiable' });
    }

    const lines = await client.query(
      `SELECT pl.*, a.plu, plm.dlc, plm.latin_name, plm.fao_zone, plm.sous_zone,
              plm.fishing_gear, plm.production_method, plm.allergens, plm.origin_label,
              plm.supplier_lot_number, plm.sanitary_photo_url, plm.sanitary_photo_urls
       FROM purchase_lines pl
       LEFT JOIN articles a ON a.id = pl.article_id
       LEFT JOIN purchase_line_metadata plm ON plm.purchase_line_id = pl.id AND plm.meta_key = 'gc_line'
       WHERE pl.purchase_id = $1
       ORDER BY pl.line_number
       FOR UPDATE OF pl`,
      [purchase.id]
    );

    let createdLots = 0;
    for (const line of lines.rows) {
      if (!line.article_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Ligne ${line.line_number} sans article` });
      }

      const unit = normalizePriceUnit(line.price_unit);
      let rc = Number(line.received_colis || 0);
      let rp = Number(line.received_pieces || 0);
      let rq = Number(line.received_quantity || 0);
      const oc = Number(line.ordered_colis || 0);
      const op = Number(line.ordered_pieces || 0);
      const oq = Number(line.ordered_quantity || 0);
      if (rc <= 0 && oc > 0) rc = oc;
      if (rp <= 0 && op > 0) rp = op;
      if (rq <= 0 && oq > 0) rq = oq;

      const qty = unit === 'colis' ? rc : unit === 'piece' ? (rc > 0 && rp > 0 ? rc * rp : rp) : (rc > 0 && rq > 0 ? rc * rq : rq);
      if (qty <= 0) continue;

      const lotCode = buildLotCode(line.plu, purchase.supplier_id, line.id);
      const lot = await client.query(
        `INSERT INTO lots(
          id, store_id, client_key, article_id, purchase_id, purchase_line_id, supplier_id,
          lot_code, supplier_lot_number, source_type, qty_initial, qty_remaining,
          unit_cost_ex_vat, dlc, traceability_data
         )
         VALUES(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'purchase', $9, $9, $10, $11, $12::jsonb)
         RETURNING id`,
        [
          purchase.store_id,
          purchase.client_key,
          line.article_id,
          purchase.id,
          line.id,
          purchase.supplier_id,
          lotCode,
          line.supplier_lot_number || null,
          qty,
          Number(line.unit_price_ex_vat || 0),
          line.dlc || null,
          JSON.stringify({
            latin_name: line.latin_name,
            fao_zone: line.fao_zone,
            sous_zone: line.sous_zone,
            fishing_gear: line.fishing_gear,
            production_method: line.production_method,
            allergens: line.allergens,
            origin_label: line.origin_label,
            sanitary_photo_url: line.sanitary_photo_url,
            sanitary_photo_urls: line.sanitary_photo_urls || [],
          }),
        ]
      );

      await client.query(
        `INSERT INTO stock_movements(
          id, store_id, client_key, article_id, lot_id, movement_type, quantity,
          unit_cost_ex_vat, source_table, source_id, notes, created_by
         )
         VALUES(gen_random_uuid(), $1, $2, $3, $4, 'purchase_in', $5, $6, 'purchase_lines', $7, $8, $9)`,
        [purchase.store_id, purchase.client_key, line.article_id, lot.rows[0].id, qty, Number(line.unit_price_ex_vat || 0), line.id, `Reception achat ${purchase.id}`, req.user.id]
      );

      const finalAmount = lineAmount({ ...line, received_colis: rc, received_pieces: rp, received_quantity: rq }, true);
      await client.query(
        `UPDATE purchase_lines
         SET received_colis = $1, received_pieces = $2, received_quantity = $3,
             lot_id = $4, line_amount_ex_vat = $5, line_status = 'received',
             received_at = NOW(), updated_at = NOW()
         WHERE id = $6`,
        [rc, rp, rq, lot.rows[0].id, finalAmount, line.id]
      );

      await recomputeArticleStock(client, line.article_id, purchase.store_id);
      createdLots += 1;
    }

    if (createdLots === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucune quantite receptionnee' });
    }

    await client.query(
      `UPDATE purchases
       SET status = 'received_pending_invoice',
           purchase_type = CASE WHEN purchase_type = 'order' THEN 'direct_bl' ELSE purchase_type END,
           receipt_date = COALESCE($1::date, CURRENT_DATE),
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [req.body.receipt_date || null, req.user.id, purchase.id]
    );

    await recomputePurchaseTotals(client, purchase.id);
    await client.query('COMMIT');
    return res.json({ ok: true, created_lots: createdLots, message: `Reception validee : ${createdLots} lot(s) cree(s), en attente facture fournisseur` });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur validation reception enrichie :', error);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
