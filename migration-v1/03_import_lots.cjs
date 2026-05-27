require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const BACKUP_PATH = path.join(__dirname, "backup-v1.json");

const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.TARGET_DB_NAME || process.env.DB_NAME || "gestion_rayons",
  user: process.env.DB_USER || "admin",
  password: process.env.DB_PASSWORD || "password",
};

const STORE_CODE = process.env.STORE_CODE || "LEC001";
const DEPARTMENT_CODE = process.env.DEPARTMENT_CODE || "POIS";

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toNullableString(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function toDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toSqlDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function sanitizeCode(value) {
  return String(value || "")
    .trim()
    .replace(/[^0-9A-Za-z_-]/g, "")
    .slice(0, 40);
}

function makeLotCode(lotData) {
  const plu = sanitizeCode(lotData.plu || "NO-PLU");
  const rawId = sanitizeCode(lotData.lotId || `${lotData.achatId || ""}${lotData.ligneId || ""}`);
  const shortId = rawId.slice(-24) || Math.random().toString(36).slice(2, 12);
  return `V1-${plu}-${shortId}`.slice(0, 80);
}

function getLotData(doc) {
  if (!doc) return {};
  return doc.data || doc;
}

function normalizeStatus(lotData, qtyRemaining) {
  if (lotData.closed === true || qtyRemaining <= 0) {
    return "closed";
  }
  return "open";
}

async function getTableColumns(client, tableName) {
  const result = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [tableName]
  );

  return new Set(result.rows.map((row) => row.column_name));
}

async function main() {
  if (!fs.existsSync(BACKUP_PATH)) {
    throw new Error(`Fichier introuvable : ${BACKUP_PATH}`);
  }

  const backup = JSON.parse(fs.readFileSync(BACKUP_PATH, "utf8"));
  const firebaseLots = backup.lots || {};

  const pool = new Pool(DB_CONFIG);
  const client = await pool.connect();

  let inserted = 0;
  let updated = 0;
  let skippedNoArticle = 0;
  let skippedInvalidQty = 0;
  let errors = 0;

  try {
    console.log("========================================");
    console.log("Migration lots Firebase V1 -> Rayon V2");
    console.log("Base cible :", DB_CONFIG.database);
    console.log("Store code :", STORE_CODE);
    console.log("Department code :", DEPARTMENT_CODE);
    console.log("Lots Firebase :", Object.keys(firebaseLots).length);
    console.log("========================================");

    const storeResult = await client.query(
      `SELECT id, code, name FROM stores WHERE code = $1 LIMIT 1`,
      [STORE_CODE]
    );

    if (storeResult.rows.length === 0) {
      throw new Error(`Store introuvable avec code ${STORE_CODE}`);
    }

    const store = storeResult.rows[0];

    const departmentResult = await client.query(
      `
      SELECT id, code, name
      FROM departments
      WHERE store_id = $1
        AND code = $2
      LIMIT 1
      `,
      [store.id, DEPARTMENT_CODE]
    );

    if (departmentResult.rows.length === 0) {
      throw new Error(`Rayon introuvable avec code ${DEPARTMENT_CODE}`);
    }

    const department = departmentResult.rows[0];

    const articleResult = await client.query(
      `
      SELECT a.id, a.plu
      FROM articles a
      INNER JOIN article_departments ad ON ad.article_id = a.id
      WHERE ad.department_id = $1
        AND a.plu IS NOT NULL
      `,
      [department.id]
    );

    const articleByPlu = new Map(
      articleResult.rows.map((row) => [String(row.plu).trim(), row.id])
    );

    const supplierResult = await client.query(
      `
      SELECT id, code
      FROM suppliers
      WHERE store_id = $1
      `,
      [store.id]
    );

    const supplierByCode = new Map(
      supplierResult.rows.map((row) => [String(row.code).trim(), row.id])
    );

    const purchaseColumns = await getTableColumns(client, "purchases");
    const purchaseLineColumns = await getTableColumns(client, "purchase_lines");

    let purchaseByFirebaseId = new Map();
    let purchaseLineByFirebaseId = new Map();

    const purchaseIdColumnCandidates = [
      "firebase_id",
      "v1_id",
      "legacy_id",
      "source_id",
      "external_id",
      "firebase_achat_id",
    ];

    const purchaseLineIdColumnCandidates = [
      "firebase_id",
      "v1_id",
      "legacy_id",
      "source_id",
      "external_id",
      "firebase_line_id",
      "firebase_ligne_id",
    ];

    const purchaseIdColumn = purchaseIdColumnCandidates.find((col) =>
      purchaseColumns.has(col)
    );

    const purchaseLineIdColumn = purchaseLineIdColumnCandidates.find((col) =>
      purchaseLineColumns.has(col)
    );

    if (purchaseIdColumn) {
      const result = await client.query(
        `SELECT id, ${purchaseIdColumn} AS firebase_id FROM purchases WHERE store_id = $1`,
        [store.id]
      );

      purchaseByFirebaseId = new Map(
        result.rows
          .filter((row) => row.firebase_id)
          .map((row) => [String(row.firebase_id), row.id])
      );

      console.log(`Mapping achats via purchases.${purchaseIdColumn} :`, purchaseByFirebaseId.size);
    } else {
      console.log("Aucune colonne legacy Firebase détectée sur purchases, purchase_id restera null.");
    }

    if (purchaseLineIdColumn) {
      const result = await client.query(
        `SELECT id, ${purchaseLineIdColumn} AS firebase_id FROM purchase_lines WHERE store_id = $1`,
        [store.id]
      );

      purchaseLineByFirebaseId = new Map(
        result.rows
          .filter((row) => row.firebase_id)
          .map((row) => [String(row.firebase_id), row.id])
      );

      console.log(
        `Mapping lignes achats via purchase_lines.${purchaseLineIdColumn} :`,
        purchaseLineByFirebaseId.size
      );
    } else {
      console.log("Aucune colonne legacy Firebase détectée sur purchase_lines, purchase_line_id restera null.");
    }

    await client.query("BEGIN");

    for (const [firebaseLotKey, rawLot] of Object.entries(firebaseLots)) {
      try {
        const lotData = getLotData(rawLot);

        const plu = toNullableString(lotData.plu);
        if (!plu) {
          skippedNoArticle++;
          continue;
        }

        const articleId = articleByPlu.get(String(plu).trim());
        if (!articleId) {
          skippedNoArticle++;
          continue;
        }

        let qtyInitial = toNumber(lotData.poidsInitial, 0);
        let qtyRemaining = toNumber(lotData.poidsRestant, 0);

        if (qtyInitial < 0 || qtyRemaining < 0) {
          skippedInvalidQty++;
          continue;
        }

        if (qtyRemaining > qtyInitial) {
          qtyInitial = qtyRemaining;
        }

        const unitCost = toNumber(lotData.prixAchatKg, 0);
        const status = normalizeStatus(lotData, qtyRemaining);
        const closedAt = status === "closed" ? toDateOrNull(lotData.updatedAt || lotData.createdAt) : null;

        const supplierId = lotData.fournisseurRef
          ? supplierByCode.get(String(lotData.fournisseurRef).trim()) || null
          : null;

        const purchaseId = lotData.achatId
          ? purchaseByFirebaseId.get(String(lotData.achatId)) || null
          : null;

        const purchaseLineId = lotData.ligneId
          ? purchaseLineByFirebaseId.get(String(lotData.ligneId)) || null
          : null;

        const lotCode = makeLotCode({
          ...lotData,
          lotId: lotData.lotId || firebaseLotKey,
        });

        const sourceType =
          lotData.source === "transformation"
            ? "transformation"
            : lotData.source === "fabrication"
              ? "fabrication"
              : "purchase";

        const traceabilityData = {
          firebase_lot_id: lotData.lotId || firebaseLotKey,
          firebase_achat_id: lotData.achatId || null,
          firebase_ligne_id: lotData.ligneId || null,
          designation_v1: lotData.designation || null,
          plu_v1: lotData.plu || null,
          fao_zone: lotData.fao || lotData.zone || null,
          zone: lotData.zone || null,
          sous_zone: lotData.sousZone || null,
          fishing_gear: lotData.engin || null,
          latin_name: lotData.nomLatin || null,
          gencode: lotData.gencode || null,
          supplier_ref_v1: lotData.fournisseurRef || null,
          source_v1: lotData.source || null,
        };

        const result = await client.query(
          `
          INSERT INTO lots (
            store_id,
            department_id,
            article_id,
            purchase_id,
            purchase_line_id,
            supplier_id,
            lot_code,
            supplier_lot_number,
            source_type,
            scan_id,
            qty_initial,
            qty_remaining,
            unit_cost_ex_vat,
            dlc,
            sanitary_photo_url,
            traceability_data,
            status,
            created_at,
            closed_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16::jsonb, $17, COALESCE($18::timestamp, now()), $19::timestamp
          )
          ON CONFLICT (store_id, lot_code)
          DO UPDATE SET
            article_id = EXCLUDED.article_id,
            purchase_id = EXCLUDED.purchase_id,
            purchase_line_id = EXCLUDED.purchase_line_id,
            supplier_id = EXCLUDED.supplier_id,
            supplier_lot_number = EXCLUDED.supplier_lot_number,
            source_type = EXCLUDED.source_type,
            scan_id = EXCLUDED.scan_id,
            qty_initial = EXCLUDED.qty_initial,
            qty_remaining = EXCLUDED.qty_remaining,
            unit_cost_ex_vat = EXCLUDED.unit_cost_ex_vat,
            dlc = EXCLUDED.dlc,
            sanitary_photo_url = EXCLUDED.sanitary_photo_url,
            traceability_data = EXCLUDED.traceability_data,
            status = EXCLUDED.status,
            closed_at = EXCLUDED.closed_at
          RETURNING (xmax = 0) AS inserted
          `,
          [
            store.id,
            department.id,
            articleId,
            purchaseId,
            purchaseLineId,
            supplierId,
            lotCode,
            toNullableString(lotData.numeroLot || lotData.supplierLot || lotData.lotFournisseur),
            sourceType,
            toNullableString(lotData.scanId),
            qtyInitial,
            qtyRemaining,
            unitCost,
            toSqlDateOrNull(lotData.dlc),
            toNullableString(lotData.sanitaryPhotoUrl || lotData.photoUrl),
            JSON.stringify(traceabilityData),
            status,
            toDateOrNull(lotData.createdAt),
            closedAt,
          ]
        );

        if (result.rows[0]?.inserted) {
          inserted++;
        } else {
          updated++;
        }
      } catch (err) {
        errors++;
        console.error("Erreur lot Firebase :", firebaseLotKey, err.message);
      }
    }

    console.log("Reconstruction stock_summary depuis les lots ouverts...");

    await client.query(
      `
      DELETE FROM stock_summary
      WHERE store_id = $1
        AND department_id = $2
      `,
      [store.id, department.id]
    );

    await client.query(
      `
      INSERT INTO stock_summary (
        store_id,
        department_id,
        article_id,
        stock_quantity,
        stock_value_ex_vat,
        pma,
        next_dlc,
        updated_at
      )
      SELECT
        store_id,
        department_id,
        article_id,
        SUM(qty_remaining) AS stock_quantity,
        SUM(qty_remaining * unit_cost_ex_vat) AS stock_value_ex_vat,
        CASE
          WHEN SUM(qty_remaining) > 0
          THEN SUM(qty_remaining * unit_cost_ex_vat) / SUM(qty_remaining)
          ELSE 0
        END AS pma,
        MIN(dlc) FILTER (WHERE dlc IS NOT NULL AND qty_remaining > 0) AS next_dlc,
        now()
      FROM lots
      WHERE store_id = $1
        AND department_id = $2
        AND qty_remaining > 0
        AND status = 'open'
      GROUP BY store_id, department_id, article_id
      `,
      [store.id, department.id]
    );

    await client.query("COMMIT");

    console.log("========================================");
    console.log("Migration lots terminée");
    console.log("Insérés :", inserted);
    console.log("Mis à jour :", updated);
    console.log("Ignorés sans article :", skippedNoArticle);
    console.log("Ignorés quantité invalide :", skippedInvalidQty);
    console.log("Erreurs :", errors);
    console.log("========================================");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Migration annulée :", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();