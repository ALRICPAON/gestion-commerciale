require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const STORE_ID = "74e852c6-1ea2-46bd-92c4-bcc4a666415c";
const DEPARTMENT_ID = "07b8ffb0-4547-4010-b475-56602591eb67";

const BACKUP_PATH = path.join(__dirname, "backup-v1.json");

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.TARGET_DB_NAME || process.env.DB_NAME || "gestion_rayons",
  user: process.env.DB_USER || "admin",
  password: process.env.DB_PASSWORD || "admin",
});

function cleanString(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str === "" ? null : str;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function mapPurchaseStatus(status) {
  const s = String(status || "").toLowerCase();
  if (["received", "recu", "reçu", "valide", "validé"].includes(s)) return "received";
  if (["cancelled", "canceled", "annule", "annulé"].includes(s)) return "cancelled";
  if (["closed", "cloture", "clôturé"].includes(s)) return "closed";
  if (["ordered", "commande"].includes(s)) return "ordered";
  return "ordered";
}

function mapDocumentType(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("facture")) return "invoice";
  if (t.includes("criee") || t.includes("criée")) return "auction_slip";
  if (t.includes("bl")) return "delivery_note";
  return "manual";
}

function getCollections(raw) {
  if (raw.collections) return raw.collections;
  return raw;
}

function getDocs(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  return Object.entries(collection).map(([id, value]) => {
    if (value && value.data) return { id: value.id || id, ...value };
    return { id, data: value, subcollections: value?.subcollections || {} };
  });
}

async function getSupplierId(client, code) {
  const result = await client.query(
    `SELECT id FROM suppliers WHERE store_id = $1 AND code = $2 LIMIT 1`,
    [STORE_ID, String(code || "").trim()]
  );
  return result.rows[0]?.id || null;
}

async function getArticleId(client, plu) {
  if (!plu) return null;
  const result = await client.query(
    `SELECT id FROM articles WHERE store_id = $1 AND plu = $2 LIMIT 1`,
    [STORE_ID, String(plu).trim()]
  );
  return result.rows[0]?.id || null;
}

async function getMappingId(client, supplierId, ref) {
  if (!supplierId || !ref) return null;
  const result = await client.query(
    `SELECT id FROM supplier_article_mappings
     WHERE supplier_id = $1 AND supplier_ref = $2
     LIMIT 1`,
    [supplierId, String(ref).trim()]
  );
  return result.rows[0]?.id || null;
}

async function main() {
  if (!fs.existsSync(BACKUP_PATH)) {
    throw new Error(`Fichier introuvable : ${BACKUP_PATH}`);
  }

  const raw = JSON.parse(fs.readFileSync(BACKUP_PATH, "utf8"));
  const collections = getCollections(raw);
  const achats = getDocs(collections.achats || collections.Achats);

  console.log(`Achats Firebase détectés : ${achats.length}`);

  const client = await pool.connect();

  let importedPurchases = 0;
  let importedLines = 0;
  let skippedPurchases = 0;
  let skippedLines = 0;

  try {
    await client.query("BEGIN");

    for (const achatDoc of achats) {
      const achatId = achatDoc.id;
      const achat = achatDoc.data || {};

      const supplierCode = cleanString(achat.fournisseurCode);
      const supplierId = await getSupplierId(client, supplierCode);

      if (!supplierId) {
        skippedPurchases++;
        console.warn(`Achat ignoré fournisseur introuvable : ${achatId} / ${supplierCode}`);
        continue;
      }

      const purchaseDate = toDate(achat.date) || toDate(achat.createdAt) || new Date().toISOString().slice(0, 10);
      const status = mapPurchaseStatus(achat.statut);
      const documentType = mapDocumentType(achat.type);

      const purchaseResult = await client.query(
        `
        INSERT INTO purchases (
          store_id,
          department_id,
          supplier_id,
          purchase_date,
          document_number,
          document_type,
          source_type,
          status,
          currency,
          notes,
          total_amount_ex_vat,
          total_amount_inc_vat,
          purchase_type,
          order_date,
          delivery_date,
          receipt_date,
          bl_number,
          invoice_number,
          created_at,
          updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,'import',$7,'EUR',$8,
          $9,$10,'direct_bl',$11,$12,$13,$14,$15,
          COALESCE($16::timestamptz, now()),
          COALESCE($17::timestamptz, now())
        )
        RETURNING id
        `,
        [
          STORE_ID,
          DEPARTMENT_ID,
          supplierId,
          purchaseDate,
          cleanString(achat.numero || achat.blNumero || achat.factureNumero || achatId),
          documentType,
          status,
          cleanString(`Import Firebase V1 achatId=${achatId}`),
          toNumber(achat.montantHT, 0),
          toNumber(achat.montantTTC ?? achat.montantHT, 0),
          purchaseDate,
          purchaseDate,
          status === "received" || status === "closed" ? purchaseDate : null,
          cleanString(achat.blNumero || achat.numero || achatId),
          cleanString(achat.factureNumero),
          achat.createdAt || null,
          achat.updatedAt || achat.createdAt || null,
        ]
      );

      const purchaseId = purchaseResult.rows[0].id;
      importedPurchases++;

      const lignesCollection =
        achatDoc.subcollections?.lignes ||
        achatDoc.subcollections?.Lignes ||
        achatDoc.lignes ||
        {};

      const lignes = getDocs(lignesCollection);

      let lineNumber = 1;

      for (const lineDoc of lignes) {
        const line = lineDoc.data || {};

        const supplierRef = cleanString(line.refFournisseur || line.fournisseurRef);
        const plu = cleanString(line.plu);
        const articleId = await getArticleId(client, plu);
        const mappingId = await getMappingId(client, supplierId, supplierRef);

        const qty = toNumber(line.poidsTotalKg ?? line.quantite ?? line.poids ?? line.stock_quantity, 0);
        const price = toNumber(line.prixKg ?? line.prixAchatKg ?? line.unit_price_ex_vat, 0);

        if (qty <= 0 && price <= 0 && !articleId && !supplierRef) {
          skippedLines++;
          continue;
        }

        const lineResult = await client.query(
          `
          INSERT INTO purchase_lines (
            purchase_id,
            store_id,
            department_id,
            supplier_id,
            line_number,
            supplier_article_mapping_id,
            article_id,
            supplier_reference,
            supplier_label,
            ordered_quantity,
            received_quantity,
            stock_quantity,
            unit_price_ex_vat,
            vat_rate,
            batch_number_supplier,
            origin_country,
            status,
            line_status,
            lot_mode,
            ordered_colis,
            ordered_pieces,
            received_colis,
            received_pieces,
            price_unit,
            received_at,
            created_at,
            updated_at
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,
            $10,$11,$12,$13,0,
            $14,$15,
            'validated',
            $16,
            'auto',
            $17,$18,$19,$20,
            'kg',
            $21,
            COALESCE($22::timestamptz, now()),
            COALESCE($23::timestamptz, now())
          )
          RETURNING id
          `,
          [
            purchaseId,
            STORE_ID,
            DEPARTMENT_ID,
            supplierId,
            lineNumber++,
            mappingId,
            articleId,
            supplierRef,
            cleanString(line.designation || line.designationInterne || line.aliasFournisseur),
            qty,
            status === "received" || status === "closed" ? qty : 0,
            qty,
            price,
            cleanString(line.lot),
            cleanString(line.origine || line.origin_country),
            status === "received" || status === "closed" ? "received" : "pending",
            toNumber(line.colis, 0),
            toNumber(line.pieces, 0),
            status === "received" || status === "closed" ? toNumber(line.colis, 0) : 0,
            status === "received" || status === "closed" ? toNumber(line.pieces, 0) : 0,
            status === "received" || status === "closed" ? (line.createdAt || achat.createdAt || null) : null,
            line.createdAt || achat.createdAt || null,
            line.updatedAt || achat.updatedAt || line.createdAt || achat.createdAt || null,
          ]
        );

        const purchaseLineId = lineResult.rows[0].id;
        importedLines++;

        await client.query(
          `
          INSERT INTO purchase_line_metadata (
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
            notes,
            created_at,
            updated_at
          )
          VALUES (
            $1,
            'firebase_v1',
            $2,
            $3,
            $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
            COALESCE($14::timestamptz, now()),
            COALESCE($15::timestamptz, now())
          )
          ON CONFLICT (purchase_line_id, meta_key)
          DO UPDATE SET
            meta_value = EXCLUDED.meta_value,
            dlc = EXCLUDED.dlc,
            latin_name = EXCLUDED.latin_name,
            fao_zone = EXCLUDED.fao_zone,
            sous_zone = EXCLUDED.sous_zone,
            fishing_gear = EXCLUDED.fishing_gear,
            production_method = EXCLUDED.production_method,
            allergens = EXCLUDED.allergens,
            origin_label = EXCLUDED.origin_label,
            supplier_lot_number = EXCLUDED.supplier_lot_number,
            sanitary_photo_url = EXCLUDED.sanitary_photo_url,
            notes = EXCLUDED.notes,
            updated_at = now()
          `,
          [
            purchaseLineId,
            JSON.stringify({
              achatId,
              ligneId: lineDoc.id,
              raw: line,
            }),
            toDate(line.dlc || line.dltc),
            cleanString(line.nomLatin),
            cleanString(line.fao || line.zone),
            cleanString(line.sousZone),
            cleanString(line.engin),
            cleanString(line.methode || line.production_method),
            cleanString(line.allergenes),
            cleanString(line.origine || line.origin_label),
            cleanString(line.lot),
            cleanString(line.photo_url),
            cleanString(`Import Firebase V1 achatId=${achatId} ligneId=${lineDoc.id}`),
            line.createdAt || achat.createdAt || null,
            line.updatedAt || achat.updatedAt || line.createdAt || achat.createdAt || null,
          ]
        );
      }
    }

    await client.query("COMMIT");

    console.log("✅ Import achats terminé");
    console.log({
      importedPurchases,
      importedLines,
      skippedPurchases,
      skippedLines,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Import annulé :", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
