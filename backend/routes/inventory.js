const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const { toNullableString } = require('../utils/valueHelpers');
const XLSX = require('xlsx');
const multer = require('multer');
const path = require('path');
const { ensureDir } = require('../utils/fileHelpers');
const {
  createSafeUploadFilename,
  getUploadExtension,
  inventoryImportFileFilter,
} = require('../utils/uploadValidation');

const IMPORTS_ROOT = path.join(__dirname, "..", "uploads", "imports");
ensureDir(IMPORTS_ROOT);

const importDocumentStorage = multer.diskStorage({
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
});

const uploadImportDocument = multer({
  storage: importDocumentStorage,
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
  fileFilter: inventoryImportFileFilter,
});

// =========================================================
// HELPERS INVENTAIRE
// =========================================================

function extractEANFromText(text) {
  if (!text) return null;

  const str = String(text)
    .replace(/\u00A0/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\t/g, ' ')
    .trim();

  const match13 = str.match(/(\d{13})/);
  if (match13 && match13[1]) return match13[1];

  const shortMatch = str.match(/(\d{8,12})/);
  if (shortMatch && shortMatch[1]) {
    return shortMatch[1].padStart(13, '0');
  }

  return null;
}

function toSafeNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  return Number.parseFloat(String(value).replace(',', '.').replace(/\s/g, '')) || 0;
}

function normalizeEan(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return null;
  return digits.padStart(13, '0').slice(-13);
}

function normalizeSaleUnit(raw) {
  if (!raw) return 'kg';
  const normalized = String(raw).toLowerCase().trim();

  // Mapping vers 'piece'
  if (['pièce', 'pièces', 'pcs', 'pc', 'unité', 'u', 'uvc'].includes(normalized)) {
    return 'piece';
  }

  // Mapping vers 'colis'
  if (['colis', 'carton', 'cartons', 'box'].includes(normalized)) {
    return 'colis';
  }

  // Tout le reste vers 'kg'
  return 'kg';
}

function roundInventoryQuantity(value) {
  return Number(Number(value || 0).toFixed(3));
}

function getSectorSortRank(code) {
  const order = {
    TRAD: 1,
    FE: 2,
    LS: 3,
    SCE: 4,
    EMB: 5,
  };
  return order[String(code || '').toUpperCase()] || 99;
}

function sortInventoryPreviewLines(lines) {
  return lines.sort((a, b) => {
    const rankA = getSectorSortRank(a.sector_code);
    const rankB = getSectorSortRank(b.sector_code);

    if (rankA !== rankB) return rankA - rankB;

    return String(a.article_label || '').localeCompare(
      String(b.article_label || ''),
      'fr',
      { sensitivity: 'base' }
    );
  });
}

async function getNextInventoryReference(client, storeId, departmentId, inventoryDate) {
  const result = await client.query(`
    SELECT COALESCE(
      MAX(
        NULLIF(
          regexp_replace(reference_number, '^INV-[0-9]{4}-[0-9]{2}-[0-9]{2}-', ''),
          ''
        )::integer
      ),
      0
    ) AS max_sequence
    FROM sales_documents
    WHERE store_id = $1
      AND department_id = $2
      AND document_type = 'inventory_sale'
      AND origin = 'inventory_import'
      AND source_inventory_date = $3::date
      AND status <> 'cancelled'
      AND reference_number ~ '^INV-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{3}$'
  `, [storeId, departmentId, inventoryDate]);

  const nextSequence = Number(result.rows[0]?.max_sequence || 0) + 1;
  return `INV-${inventoryDate}-${String(nextSequence).padStart(3, '0')}`;
}

function normalizeInventoryAnomaly(rawAnomaly) {
  const raw = rawAnomaly || {};

  return {
    source_type: toNullableString(raw.source_type) || 'inventory',
    anomaly_type: toNullableString(raw.anomaly_type) || (raw.stock_alert ? 'stock_alert' : 'inventory_anomaly'),
    action_type: toNullableString(raw.action_type) || 'reported',
    article_id: raw.article_id || null,
    article_plu: toNullableString(raw.article_plu),
    article_label: toNullableString(raw.article_label),
    ean: toNullableString(raw.ean),
    stock_quantity: Number(raw.stock_quantity || 0),
    sold_quantity: Number(raw.sold_quantity || 0),
    sale_unit: toNullableString(raw.sale_unit),
    unit_sale_price_ttc: Number(raw.unit_sale_price_ttc || 0),
    line_total_ttc: Number(raw.line_total_ttc || 0),
    reason: toNullableString(raw.reason || raw.line_reason),
    source_row_number: raw.source_row_number ? Number(raw.source_row_number) : null,
    raw_line: raw.raw_line || raw,
  };
}

async function insertInventoryAnomalies(client, {
  anomalies,
  storeId,
  departmentId,
  inventoryDate,
  salesDocumentId,
  createdBy,
}) {
  for (const rawAnomaly of anomalies) {
    const anomaly = normalizeInventoryAnomaly(rawAnomaly);

    await client.query(
      `
      INSERT INTO inventory_anomalies (
        store_id,
        department_id,
        inventory_date,
        source_type,
        anomaly_type,
        action_type,
        article_id,
        article_plu,
        article_label,
        ean,
        stock_quantity,
        sold_quantity,
        sale_unit,
        unit_sale_price_ttc,
        line_total_ttc,
        reason,
        source_row_number,
        raw_line,
        sales_document_id,
        created_by
      )
      VALUES (
        $1,
        $2,
        $3::date,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17,
        $18::jsonb,
        $19,
        $20
      )
      `,
      [
        storeId,
        departmentId,
        inventoryDate,
        anomaly.source_type,
        anomaly.anomaly_type,
        anomaly.action_type,
        anomaly.article_id,
        anomaly.article_plu,
        anomaly.article_label,
        anomaly.ean,
        anomaly.stock_quantity,
        anomaly.sold_quantity,
        anomaly.sale_unit,
        anomaly.unit_sale_price_ttc,
        anomaly.line_total_ttc,
        anomaly.reason,
        anomaly.source_row_number,
        JSON.stringify(anomaly.raw_line || {}),
        salesDocumentId,
        createdBy,
      ]
    );
  }
}

function parseInventoryCashFile(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const aggregated = new Map();

  for (let i = 18; i < rows.length; i++) {
    const row = rows[i] || [];

    const cellR = row[17];   // colonne R : EAN + texte
    const cellT = row[19];   // colonne T : CA TTC
    const cellAB = row[28];  // quantité vendue LS (garder ton index métier validé)

    if (!cellR) continue;

    const ean = extractEANFromText(cellR);
    if (!ean) continue;

    const caTtc = toSafeNumber(cellT);
    const qty = toSafeNumber(cellAB);

    if (!aggregated.has(ean)) {
      aggregated.set(ean, {
        ean,
        ca_ttc: 0,
        qty_uvc: 0,
      });
    }

    const current = aggregated.get(ean);
    current.ca_ttc += caTtc;
    current.qty_uvc += qty;
  }

  return Array.from(aggregated.values());
}

// =========================================================
// 📊 INVENTAIRE — PREVIEW IMPORT
// =========================================================
router.post('/preview-import', authenticateToken, attachDbContext, requireAdminOrManager, uploadImportDocument.single('file'), async (req, res) => {
  try {
    const {
      department_id,
      inventory_date,
      notes,
    } = req.body;

    if (!department_id) {
      return res.status(400).json({ error: 'department_id requis' });
    }

    if (!inventory_date) {
      return res.status(400).json({ error: 'inventory_date requis' });
    }

    if (!req.file || !req.file.path) {
      return res.status(400).json({ error: 'Fichier caisse obligatoire' });
    }

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

    const parsedRows = parseInventoryCashFile(req.file.path);
    const totalInputLines = parsedRows.length;

    if (!parsedRows.length) {
      return res.status(400).json({ error: 'Aucune vente exploitable trouvée dans le fichier caisse' });
    }

    const eans = parsedRows
      .map((row) => normalizeEan(row.ean))
      .filter(Boolean);

    const articleResult = await req.dbPool.query(
      `
      SELECT
        a.id AS article_id,
        a.plu,
        a.designation,
        a.ean,
        a.unit,
        ad.sale_unit,
        ds.code AS sector_code,
        sap.pv_ttc_real,
        COALESCE(ss.stock_quantity, 0) AS stock_quantity
      FROM articles a
      LEFT JOIN article_departments ad
        ON ad.article_id = a.id
       AND ad.department_id = $2
      LEFT JOIN department_sectors ds
        ON ds.id = ad.department_sector_id
      LEFT JOIN stock_article_pricing sap
        ON sap.article_id = a.id
       AND sap.department_id = $2
       AND sap.store_id = $1
      LEFT JOIN stock_summary ss
        ON ss.article_id = a.id
       AND ss.department_id = $2
      WHERE a.store_id = $1
        AND a.ean IS NOT NULL
        AND regexp_replace(a.ean, '[^0-9]', '', 'g') = ANY($3::text[])
      `,
      [req.user.store_id, department_id, eans]
    );

    const articleByEan = new Map();
    for (const article of articleResult.rows) {
      const normalized = normalizeEan(article.ean);
      if (normalized) {
        articleByEan.set(normalized, article);
      }
    }

    const retained_lines = [];
    const ignored_lines = [];

    for (let index = 0; index < parsedRows.length; index += 1) {
      const row = parsedRows[index];
      const source_row_number = index + 1;
      const normalizedEan = normalizeEan(row.ean);

      if (!normalizedEan) {
        ignored_lines.push({
          source_row_number,
          ean: row.ean || null,
          reason: 'EAN invalide',
        });
        continue;
      }

      const article = articleByEan.get(normalizedEan);
      if (!article) {
        ignored_lines.push({
          source_row_number,
          ean: normalizedEan,
          reason: 'Article introuvable par EAN',
        });
        continue;
      }

      const sectorCode = String(article.sector_code || '').toUpperCase();
      const qtyUvc = Number(row.qty_uvc || 0);
      const caTtc = Number(row.ca_ttc || 0);
      const articleUnit = String(article.sale_unit || article.unit || '').trim().toLowerCase();
      const isPieceUnit = ['piece', 'pièce', 'pieces', 'pièces', 'pcs', 'pc', 'unite', 'unité', 'u', 'uvc'].includes(articleUnit);
      const isLs = sectorCode === 'LS' || isPieceUnit;

      let soldQuantity = 0;
      let saleUnit = 'kg';
      let unitSalePriceTtc = 0;
      let pricing_mode = 'trad_ca_div_pv';

      if (isLs) {
        soldQuantity = qtyUvc;
        saleUnit = 'piece';
        unitSalePriceTtc = qtyUvc > 0 ? Number((caTtc / qtyUvc).toFixed(4)) : 0;
        pricing_mode = 'ls_qty_from_cash';
      } else {
        const pvTtc = Number(article.pv_ttc_real || 0);
        if (pvTtc <= 0) {
          if (caTtc > 0) {
            retained_lines.push({
              source_row_number,
              pricing_mode,
              ean: normalizedEan,
              article_id: article.article_id,
              article_plu: article.plu,
              article_label: article.designation,
              sector_code: sectorCode,
              stock_quantity: Number(article.stock_quantity || 0),
              stock_alert: Number(article.stock_quantity || 0) <= 0,
              sold_quantity: 0,
              sale_unit: 'kg',
              unit_sale_price_ttc: 0,
              line_total_ttc: Number(caTtc.toFixed(2)),
              line_reason: null,
              anomaly_type: 'missing_sale_price',
              include: false,
              resolved: false,
            });
            continue;
          }

          ignored_lines.push({
            source_row_number,
            ean: normalizedEan,
            article_plu: article.plu,
            article_label: article.designation,
            reason: 'PV TTC manquant pour article TRAD',
          });
          continue;
        }

        soldQuantity = caTtc > 0 ? Number((caTtc / pvTtc).toFixed(3)) : 0;
        saleUnit = 'kg';
        unitSalePriceTtc = pvTtc;
      }

      if (soldQuantity <= 0 || caTtc <= 0) {
        ignored_lines.push({
          source_row_number,
          ean: normalizedEan,
          article_plu: article.plu,
          article_label: article.designation,
          reason: 'Quantité ou CA invalide',
        });
        continue;
      }

      retained_lines.push({
  source_row_number,
  pricing_mode,
  ean: normalizedEan,
  article_id: article.article_id,
  article_plu: article.plu,
  article_label: article.designation,
  sector_code: sectorCode,
  stock_quantity: Number(article.stock_quantity || 0),
  stock_alert: Number(article.stock_quantity || 0) <= 0,
  sold_quantity: soldQuantity,
  sale_unit: saleUnit,
  unit_sale_price_ttc: unitSalePriceTtc,
  line_total_ttc: Number(caTtc.toFixed(2)),
  line_reason: null,
  anomaly_type: Number(article.stock_quantity || 0) <= 0 ? 'stock_alert' : null,
  include: Number(article.stock_quantity || 0) > 0,
  resolved: Number(article.stock_quantity || 0) > 0,
});
    }

    sortInventoryPreviewLines(retained_lines);

    res.json({
      total_input_lines: totalInputLines,
      retained_lines,
      ignored_lines,
    });
  } catch (err) {
    console.error('Erreur preview inventaire :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// =========================================================
// 📊 INVENTAIRE — CREATE SALE DOCUMENT
// =========================================================
router.post('/create-sale-document', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const {
      department_id,
      inventory_date,
      notes,
      lines,
      anomalies,
    } = req.body;

    if (!department_id) {
      return res.status(400).json({ error: 'department_id obligatoire' });
    }

    if (!inventory_date) {
      return res.status(400).json({ error: 'inventory_date obligatoire' });
    }

    const requestLines = Array.isArray(lines) ? lines : [];
    const requestAnomalies = Array.isArray(anomalies) ? anomalies : [];

    if (requestLines.length === 0 && requestAnomalies.length === 0) {
      return res.status(400).json({ error: 'Aucune ligne ou anomalie à importer' });
    }

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
      return res.status(400).json({ error: 'Rayon invalide pour ce magasin' });
    }

    await client.query('BEGIN');

    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`inventory_sale:${req.user.store_id}:${department_id}:${inventory_date}`]
    );

    const referenceNumber = await getNextInventoryReference(
      client,
      req.user.store_id,
      department_id,
      inventory_date
    );

    const existingSaleResult = await client.query(
      `
      SELECT id
      FROM sales_documents
      WHERE store_id = $1
        AND department_id = $2
        AND document_type = 'inventory_sale'
        AND origin = 'inventory_import'
        AND source_inventory_date = $3::date
        AND status <> 'cancelled'
      LIMIT 1
      `,
      [req.user.store_id, department_id, inventory_date]
    );

    if (false && existingSaleResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Document déjà validé ou non modifiable' });
    }

    const preparedLines = [];
    const requestedByArticle = new Map();

    for (const rawLine of requestLines) {
      if (rawLine.include === false) continue;

      const soldQuantity = Number(rawLine.sold_quantity || 0);
      const unitSalePriceTtc = Number(rawLine.unit_sale_price_ttc || 0);

      if (soldQuantity <= 0 || unitSalePriceTtc < 0) {
        continue;
      }

      let finalArticleId = rawLine.article_id || null;

      if (!finalArticleId && rawLine.article_plu) {
        const articleByPluResult = await client.query(
          `
          SELECT id
          FROM articles
          WHERE store_id = $1
            AND plu = $2
          LIMIT 1
          `,
          [req.user.store_id, String(rawLine.article_plu).trim()]
        );

        if (articleByPluResult.rows.length > 0) {
          finalArticleId = articleByPluResult.rows[0].id;
        }
      }

      if (!finalArticleId) {
        continue;
      }

      const articleResult = await client.query(
        `
        SELECT
          a.id,
          a.plu,
          a.designation,
          a.ean
        FROM articles a
        WHERE a.id = $1
          AND a.store_id = $2
        LIMIT 1
        `,
        [finalArticleId, req.user.store_id]
      );

      if (articleResult.rows.length === 0) {
        continue;
      }

      const article = articleResult.rows[0];

      const saleUnit = ['kg', 'piece', 'colis'].includes(rawLine.sale_unit)
        ? rawLine.sale_unit
        : 'kg';

      preparedLines.push({
        rawLine,
        article,
        soldQuantity,
        saleUnit,
        unitSalePriceTtc,
      });

      const existingRequest = requestedByArticle.get(article.id) || {
        article,
        requested_quantity: 0,
        unit: saleUnit,
      };

      existingRequest.requested_quantity += soldQuantity;
      requestedByArticle.set(article.id, existingRequest);
    }

    if (preparedLines.length === 0 && requestAnomalies.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucune ligne exploitable à créer' });
    }

    const articleIds = Array.from(requestedByArticle.keys());
    const stockResult = articleIds.length > 0
      ? await client.query(
        `
        SELECT
          article_id,
          COALESCE(stock_quantity, 0) AS stock_quantity
        FROM stock_summary
        WHERE store_id = $1
          AND department_id = $2
          AND article_id = ANY($3::uuid[])
        FOR UPDATE
        `,
        [req.user.store_id, department_id, articleIds]
      )
      : { rows: [] };

    const stockByArticle = new Map(
      stockResult.rows.map((row) => [
        row.article_id,
        Number(row.stock_quantity || 0),
      ])
    );

    const insufficientStockDetails = [];

    for (const request of requestedByArticle.values()) {
      const requestedQuantity = roundInventoryQuantity(request.requested_quantity);
      const availableQuantity = roundInventoryQuantity(stockByArticle.get(request.article.id) || 0);
      const missingQuantity = roundInventoryQuantity(requestedQuantity - availableQuantity);

      if (missingQuantity > 0.0005) {
        insufficientStockDetails.push({
          article_id: request.article.id,
          plu: request.article.plu || null,
          designation: request.article.designation || null,
          requested_quantity: requestedQuantity,
          available_quantity: availableQuantity,
          missing_quantity: missingQuantity,
          unit: request.unit,
        });
      }
    }

    if (insufficientStockDetails.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: "Stock insuffisant pour valider l'inventaire",
        code: 'INVENTORY_INSUFFICIENT_STOCK',
        details: insufficientStockDetails,
      });
    }

    const saleInsert = await client.query(
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
        $1,
        $2,
        $3::date,
        'draft',
        'inventory_sale',
        'inventory_import',
        $4,
        $5::date,
        $6,
        $7,
        $7
      )
      RETURNING *
      `,
      [
        req.user.store_id,
        department_id,
        inventory_date,
        referenceNumber,
        inventory_date,
        toNullableString(notes) || `Inventaire du ${inventory_date}`,
        req.user.id,
      ]
    );

    const sale = saleInsert.rows[0];

    let lineNumber = 1;
    let insertedLines = 0;

    for (const preparedLine of preparedLines) {
      const {
        rawLine,
        article,
        soldQuantity,
        saleUnit,
        unitSalePriceTtc,
      } = preparedLine;

      const unitSalePriceHt = Number((unitSalePriceTtc / 1.055).toFixed(4));
      const lineTotalTtc = Number((soldQuantity * unitSalePriceTtc).toFixed(2));
      const lineTotalHt = Number((lineTotalTtc / 1.055).toFixed(2));
      const unitCostExVat = Number(rawLine.unit_cost_ex_vat || rawLine.pma || 0);
      const lineCostExVat = Number((soldQuantity * unitCostExVat).toFixed(4));
      const lineMarginExVat = Number((lineTotalHt - lineCostExVat).toFixed(4));

      const lineInsert = await client.query(
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
          line_total_ttc,
          line_total_ht,
          unit_cost_ex_vat,
          line_cost_ex_vat,
          line_margin_ex_vat,
          line_reason,
          line_status,
          source_inventory_line
        )
        VALUES (
          gen_random_uuid(),
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16,
          $17,
          'pending',
          $18::jsonb
        )
        RETURNING id
        `,
        [
          sale.id,
          req.user.store_id,
          department_id,
          article.id,
          lineNumber,
          article.ean || null,
          rawLine.article_label || article.designation,
          soldQuantity,
          saleUnit,
          unitSalePriceTtc,
          unitSalePriceHt,
          lineTotalTtc,
          lineTotalHt,
          unitCostExVat,
          lineCostExVat,
          lineMarginExVat,
          toNullableString(rawLine.line_reason),
          JSON.stringify({
            import_type: 'inventory_preview',
            inventory_date,
            source_row_number: rawLine.source_row_number || null,
            pricing_mode: rawLine.pricing_mode || null,
            stock_quantity: rawLine.stock_quantity || 0,
          }),
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
        DO NOTHING
        `,
        [
          lineInsert.rows[0].id,
          JSON.stringify({
            import_type: 'inventory_preview',
            inventory_date,
            source_row_number: rawLine.source_row_number || null,
            pricing_mode: rawLine.pricing_mode || null,
            stock_quantity: rawLine.stock_quantity || 0,
          }),
        ]
      );

      insertedLines += 1;
      lineNumber += 1;
    }

    if (insertedLines === 0 && requestAnomalies.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucune ligne exploitable à créer' });
    }

    await insertInventoryAnomalies(client, {
      anomalies: requestAnomalies,
      storeId: req.user.store_id,
      departmentId: department_id,
      inventoryDate: inventory_date,
      salesDocumentId: sale.id,
      createdBy: req.user.id,
    });

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      sale_id: sale.id,
      inserted_lines: insertedLines,
      inserted_anomalies: requestAnomalies.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/inventory/create-sale-document :', err);
    return res.status(500).json({ error: 'Erreur création vente depuis inventaire' });
  } finally {
    client.release();
  }
});

// =========================================================
// 📊 INVENTAIRE — IMPORT SALES DOCUMENT
// =========================================================
router.post('/import-sales-document', authenticateToken, attachDbContext, requireAdminOrManager, uploadImportDocument.single('file'), async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const {
      department_id,
      inventory_date,
      notes,
    } = req.body;

    if (!department_id) {
      return res.status(400).json({ error: 'department_id obligatoire' });
    }

    if (!inventory_date) {
      return res.status(400).json({ error: 'inventory_date obligatoire' });
    }

    if (!req.file || !req.file.path) {
      return res.status(400).json({ error: 'Fichier caisse obligatoire' });
    }

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
      return res.status(400).json({ error: 'Rayon invalide pour ce magasin' });
    }

    const parsedRows = parseInventoryCashFile(req.file.path);

    if (!parsedRows.length) {
      return res.status(400).json({ error: 'Aucune vente exploitable trouvée dans le fichier caisse' });
    }

    await client.query('BEGIN');

    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`inventory_sale:${req.user.store_id}:${department_id}:${inventory_date}`]
    );

    const referenceNumber = await getNextInventoryReference(
      client,
      req.user.store_id,
      department_id,
      inventory_date
    );

    const existingSaleResult = await client.query(
      `
      SELECT id
      FROM sales_documents
      WHERE store_id = $1
        AND department_id = $2
        AND document_type = 'inventory_sale'
        AND origin = 'inventory_import'
        AND source_inventory_date = $3::date
        AND status <> 'cancelled'
      LIMIT 1
      `,
      [req.user.store_id, department_id, inventory_date]
    );

    if (false && existingSaleResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Document déjà validé ou non modifiable' });
    }

    const saleInsert = await client.query(
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
        $1,
        $2,
        $3::date,
        'draft',
        'inventory_sale',
        'inventory_import',
        $4,
        $5::date,
        $6,
        $7,
        $7
      )
      RETURNING *
      `,
      [
        req.user.store_id,
        department_id,
        inventory_date,
        referenceNumber,
        inventory_date,
        toNullableString(notes) || `Import caisse inventaire du ${inventory_date}`,
        req.user.id,
      ]
    );

    const sale = saleInsert.rows[0];

    const eans = parsedRows
      .map((row) => normalizeEan(row.ean))
      .filter(Boolean);

    const articleResult = await client.query(
      `
      SELECT
        a.id AS article_id,
        a.plu,
        a.designation,
        a.ean,
        a.unit,
        ad.sale_unit,
        ds.code AS sector_code,
        sap.pv_ttc_real,
        ss.pma
      FROM articles a
      LEFT JOIN article_departments ad
        ON ad.article_id = a.id
       AND ad.department_id = $2
      LEFT JOIN department_sectors ds
        ON ds.id = ad.department_sector_id
      LEFT JOIN stock_article_pricing sap
        ON sap.article_id = a.id
       AND sap.department_id = $2
       AND sap.store_id = $1
      LEFT JOIN stock_summary ss
        ON ss.article_id = a.id
       AND ss.department_id = $2
       AND ss.store_id = $1
      WHERE a.store_id = $1
        AND a.ean IS NOT NULL
        AND regexp_replace(a.ean, '[^0-9]', '', 'g') = ANY($3::text[])
      `,
      [req.user.store_id, department_id, eans]
    );

    const articleByEan = new Map();
    for (const article of articleResult.rows) {
      const normalized = normalizeEan(article.ean);
      if (normalized) {
        articleByEan.set(normalized, article);
      }
    }

    let lineNumber = 1;
    let insertedLines = 0;
    const skipped = [];

    for (const row of parsedRows) {
      const normalizedEan = normalizeEan(row.ean);
      if (!normalizedEan) continue;

      const article = articleByEan.get(normalizedEan);

      if (!article) {
        skipped.push({
          ean: normalizedEan,
          reason: 'Article introuvable par EAN',
        });
        continue;
      }

      const sectorCode = String(article.sector_code || '').toUpperCase();
      const isLs = sectorCode === 'LS';

      const caTtc = Number(row.ca_ttc || 0);
      const qtyUvc = Number(row.qty_uvc || 0);

      let soldQuantity = 0;
      let saleUnit = 'kg';
      let unitSalePriceTtc = 0;

      if (isLs) {
        // ✅ LS = quantité caisse réelle, toujours à la pièce
        soldQuantity = qtyUvc;
        saleUnit = 'piece';
        unitSalePriceTtc = qtyUvc > 0 ? Number((caTtc / qtyUvc).toFixed(4)) : 0;
      } else {
        // ✅ TRAD = quantité recalculée depuis CA / PV, toujours en kg
        const pvTtc = Number(article.pv_ttc_real || 0);

        if (pvTtc <= 0) {
          skipped.push({
            ean: normalizedEan,
            plu: article.plu,
            designation: article.designation,
            reason: 'PV TTC manquant pour article TRAD',
          });
          continue;
        }

        soldQuantity = caTtc > 0 ? Number((caTtc / pvTtc).toFixed(3)) : 0;
        saleUnit = 'kg';
        unitSalePriceTtc = pvTtc;
      }

      if (soldQuantity <= 0 || caTtc <= 0) {
        continue;
      }

      const unitSalePriceHt = Number((unitSalePriceTtc / 1.055).toFixed(4));
      const lineTotalHt = Number((caTtc / 1.055).toFixed(2));
      const unitCostExVat = Number(article.pma || 0);
      const lineCostExVat = Number((soldQuantity * unitCostExVat).toFixed(4));
      const lineMarginExVat = Number((lineTotalHt - lineCostExVat).toFixed(4));

      console.log('saleUnit final =', saleUnit);

      const lineInsert = await client.query(
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
          line_total_ttc,
          line_total_ht,
          unit_cost_ex_vat,
          line_cost_ex_vat,
          line_margin_ex_vat,
          line_reason,
          line_status,
          source_inventory_line
        )
        VALUES (
          gen_random_uuid(),
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16,
          $17,
          'pending',
          $18::jsonb
        )
        RETURNING id
        `,
        [
          sale.id,
          req.user.store_id,
          department_id,
          article.article_id,
          lineNumber,
          normalizedEan,
          article.designation,
          soldQuantity,
          saleUnit,
          unitSalePriceTtc,
          unitSalePriceHt,
          caTtc,
          lineTotalHt,
          unitCostExVat,
          lineCostExVat,
          lineMarginExVat,
          isLs ? 'Import inventaire caisse LS' : 'Import inventaire caisse TRAD',
          JSON.stringify({
            import_type: 'inventory_cash',
            inventory_date,
            ean: normalizedEan,
            ca_ttc: caTtc,
            qty_uvc: qtyUvc,
            sector_code: sectorCode,
            pricing_mode: isLs ? 'ls_qty_from_cash' : 'trad_ca_div_pv',
          }),
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
        DO NOTHING
        `,
        [
          lineInsert.rows[0].id,
          JSON.stringify({
            import_type: 'inventory_cash',
            inventory_date,
            ean: normalizedEan,
            ca_ttc: caTtc,
            qty_uvc: qtyUvc,
            sector_code: sectorCode,
            pricing_mode: isLs ? 'ls_qty_from_cash' : 'trad_ca_div_pv',
          }),
        ]
      );

      insertedLines += 1;
      lineNumber += 1;
    }

    if (insertedLines === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Aucune ligne exploitable importée',
        skipped,
      });
    }

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      sale_id: sale.id,
      inserted_lines: insertedLines,
      skipped,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/inventory/import-sales-document :', err);
    return res.status(500).json({ error: 'Erreur import inventaire vers ventes' });
  } finally {
    client.release();
  }
});

// =========================================================
// 📊 INVENTAIRE — MANUAL PREVIEW
// Charge le stock actuel pour saisie manuelle du restant
// =========================================================
router.get('/manual-preview', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const departmentId = req.query.department_id;

    if (!departmentId) {
      return res.status(400).json({ error: 'department_id obligatoire' });
    }

    const departmentCheck = await req.dbPool.query(
      `
      SELECT id
      FROM departments
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [departmentId, req.user.store_id]
    );

    if (departmentCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Rayon invalide pour ce magasin' });
    }

    const result = await req.dbPool.query(
      `
      SELECT
        ss.article_id,
        a.plu AS article_plu,
        a.designation AS article_label,
        a.ean,
        a.unit,
ds.code AS sector_code,
ds.name AS sector_name,
COALESCE(ad.sale_unit, a.unit, 'kg') AS sale_unit,
COALESCE(ss.stock_quantity, 0) AS stock_quantity,
        COALESCE(ss.pma, 0) AS pma,
        COALESCE(sap.pv_ttc_real, 0) AS unit_sale_price_ttc
      FROM stock_summary ss
      JOIN articles a
        ON a.id = ss.article_id
      LEFT JOIN article_departments ad
  ON ad.article_id = a.id
 AND ad.department_id = ss.department_id
LEFT JOIN department_sectors ds
  ON ds.id = ad.department_sector_id
LEFT JOIN stock_article_pricing sap
        ON sap.article_id = ss.article_id
       AND sap.department_id = ss.department_id
       AND sap.store_id = ss.store_id
      WHERE ss.store_id = $1
        AND ss.department_id = $2
        AND COALESCE(ss.stock_quantity, 0) > 0
      ORDER BY
  CASE UPPER(COALESCE(ds.code, ''))
    WHEN 'TRAD' THEN 1
    WHEN 'FE' THEN 2
    WHEN 'LS' THEN 3
    WHEN 'SCE' THEN 4
    WHEN 'EMB' THEN 5
    ELSE 99
  END,
  a.designation ASC
      `,
      [req.user.store_id, departmentId]
    );

    const retained_lines = result.rows.map((row, index) => ({
      source_row_number: index + 1,
      pricing_mode: 'manual_remaining_stock',
      ean: row.ean || null,
      article_id: row.article_id,
      article_plu: row.article_plu,
      article_label: row.article_label,
sector_code: row.sector_code || null,
sector_name: row.sector_name || null,
stock_quantity: Number(row.stock_quantity || 0),
      remaining_quantity: null,
      sold_quantity: 0,
      sale_unit: normalizeSaleUnit(row.sale_unit || row.unit || 'kg'),
      unit_sale_price_ttc: Number(row.unit_sale_price_ttc || 0),
      unit_cost_ex_vat: Number(row.pma || 0),
      pma: Number(row.pma || 0),
      line_total_ttc: 0,
      line_reason: null,
      stock_alert: false,
      include: false,
      resolved: true,
    }));

    res.json({
      total_input_lines: retained_lines.length,
      retained_lines,
      ignored_lines: [],
    });
  } catch (err) {
    console.error('Erreur GET /api/inventory/manual-preview :', err);
    res.status(500).json({ error: 'Erreur chargement inventaire manuel' });
  }
});

module.exports = router;
