const fs = require("fs");
const pool = require("./db");

const STORE_ID = "c8ef6923-eb14-4fb2-a04f-4d05a65817e5";

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text || text.toLowerCase() === "nan") return null;
  return text;
}

async function importAFMap() {
  const client = await pool.connect();

  try {
    const rows = JSON.parse(fs.readFileSync("./af-map-v2.json", "utf8"));

    console.log(`📦 ${rows.length} lignes AF_MAP à traiter`);

    let inserted = 0;
    let updated = 0;
    let skippedNoSupplier = 0;
    let skippedNoArticle = 0;
    let skippedNoRef = 0;
    let skippedNoPlu = 0;

    await client.query("BEGIN");

    for (const row of rows) {
      const supplierCode = clean(row.supplier_code);
      const supplierRef = clean(row.supplier_reference);
      const supplierLabel = clean(row.supplier_label);
      const plu = clean(row.plu);

      if (!supplierRef) {
        skippedNoRef++;
        continue;
      }

      if (!plu) {
        skippedNoPlu++;
        continue;
      }

      const supplierResult = await client.query(
        `
        SELECT id, store_id
        FROM suppliers
        WHERE store_id = $1
          AND code = $2
        LIMIT 1
        `,
        [STORE_ID, supplierCode]
      );

      if (supplierResult.rows.length === 0) {
        skippedNoSupplier++;
        continue;
      }

      const supplierId = supplierResult.rows[0].id;
      const storeId = supplierResult.rows[0].store_id;

      const articleResult = await client.query(
        `
        SELECT id
        FROM articles
        WHERE store_id = $1
          AND plu = $2
        LIMIT 1
        `,
        [storeId, plu]
      );

      if (articleResult.rows.length === 0) {
        skippedNoArticle++;
        continue;
      }

      const articleId = articleResult.rows[0].id;

      const existingResult = await client.query(
        `
        SELECT id
        FROM supplier_article_mappings
        WHERE supplier_id = $1
          AND supplier_ref = $2
        LIMIT 1
        `,
        [supplierId, supplierRef]
      );

      if (existingResult.rows.length > 0) {
        await client.query(
          `
          UPDATE supplier_article_mappings
          SET
            article_id = $1,
            supplier_label = $2,
            is_active = true
          WHERE supplier_id = $3
            AND supplier_ref = $4
          `,
          [articleId, supplierLabel, supplierId, supplierRef]
        );
        updated++;
      } else {
        await client.query(
          `
          INSERT INTO supplier_article_mappings (
            supplier_id,
            article_id,
            supplier_ref,
            supplier_label,
            purchase_unit,
            conversion_to_stock,
            is_active
          )
          VALUES ($1, $2, $3, $4, $5, $6, true)
          `,
          [
            supplierId,
            articleId,
            supplierRef,
            supplierLabel,
            "kg",
            1,
          ]
        );
        inserted++;
      }
    }

    await client.query("COMMIT");

    console.log("✅ Import AF_MAP terminé");
    console.log(`   Insérés        : ${inserted}`);
    console.log(`   Mis à jour     : ${updated}`);
    console.log(`   Sans fournisseur: ${skippedNoSupplier}`);
    console.log(`   Sans article   : ${skippedNoArticle}`);
    console.log(`   Sans ref       : ${skippedNoRef}`);
    console.log(`   Sans plu       : ${skippedNoPlu}`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Erreur import AF_MAP :", error);
  } finally {
    client.release();
    await pool.end();
  }
}

importAFMap();