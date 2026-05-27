require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const TARGET_DB_NAME = process.env.TARGET_DB_NAME || process.env.DB_NAME || "gestion_rayons_challans";
const STORE_CODE = process.env.STORE_CODE || "LEC001";
const DEPARTMENT_CODE = process.env.DEPARTMENT_CODE || "POIS";

const backupPath = path.join(__dirname, "backup-v1.json");

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  database: TARGET_DB_NAME,
  user: process.env.DB_USER || "admin",
  password: process.env.DB_PASSWORD,
});

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const cleaned = clean(value);
    if (cleaned) return cleaned;
  }
  return "";
}

async function main() {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Fichier introuvable : ${backupPath}`);
  }

  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  const articlesV1 = backup.articles || {};

  const client = await pool.connect();

  let updatedArticles = 0;
  let updatedMetadata = 0;
  let skippedNoArticle = 0;
  let skippedNoArticleDepartment = 0;
  let withBusinessData = 0;

  try {
    await client.query("BEGIN");

    const storeRes = await client.query(
      `SELECT id FROM stores WHERE code = $1 LIMIT 1`,
      [STORE_CODE]
    );

    if (!storeRes.rowCount) {
      throw new Error(`Store introuvable avec code ${STORE_CODE}`);
    }

    const storeId = storeRes.rows[0].id;

    const depRes = await client.query(
      `SELECT id FROM departments WHERE code = $1 LIMIT 1`,
      [DEPARTMENT_CODE]
    );

    if (!depRes.rowCount) {
      throw new Error(`Rayon introuvable avec code ${DEPARTMENT_CODE}`);
    }

    const departmentId = depRes.rows[0].id;

    for (const [docId, doc] of Object.entries(articlesV1)) {
      const data = doc.data || doc || {};

      const plu = firstNonEmpty(data.PLU, data.plu, docId);
      if (!plu) continue;

      const latinName = firstNonEmpty(data.NomLatin, data.nomLatin, data.latin_name);
      const faoZone = firstNonEmpty(data.Zone, data.FAO, data.fao, data.fao_zone);
      const faoSubzone = firstNonEmpty(data.SousZone, data.sousZone, data.fao_subzone);
      const fishingGear = firstNonEmpty(data.Engin, data.engin, data.fishing_gear);
      const category = firstNonEmpty(data.Categorie, data.categorie, data.category);
      const allergenes = firstNonEmpty(data.Allergenes, data.allergenes);
      const ean = firstNonEmpty(data.ean, data.EAN);
      const unit = firstNonEmpty(data.Unite, data.unit);

      if (
        latinName ||
        faoZone ||
        faoSubzone ||
        fishingGear ||
        category ||
        allergenes ||
        ean ||
        unit
      ) {
        withBusinessData++;
      } else {
        continue;
      }

      const articleRes = await client.query(
        `
        SELECT id
        FROM articles
        WHERE store_id = $1
          AND plu = $2
        LIMIT 1
        `,
        [storeId, plu]
      );

      if (!articleRes.rowCount) {
        skippedNoArticle++;
        continue;
      }

      const articleId = articleRes.rows[0].id;

      await client.query(
        `
        UPDATE articles
        SET
          latin_name = CASE WHEN $2 <> '' THEN $2 ELSE latin_name END,
          fao_zone = CASE WHEN $3 <> '' THEN $3 ELSE fao_zone END,
          fao_subzone = CASE WHEN $4 <> '' THEN $4 ELSE fao_subzone END,
          fishing_gear = CASE WHEN $5 <> '' THEN $5 ELSE fishing_gear END,
          category = CASE WHEN $6 <> '' THEN $6 ELSE category END,
          ean = CASE WHEN $7 <> '' THEN $7 ELSE ean END,
          unit = CASE WHEN $8 <> '' THEN $8 ELSE unit END
        WHERE id = $1
        `,
        [articleId, latinName, faoZone, faoSubzone, fishingGear, category, ean, unit]
      );

      updatedArticles++;

      const adRes = await client.query(
        `
        SELECT id
        FROM article_departments
        WHERE article_id = $1
          AND department_id = $2
        LIMIT 1
        `,
        [articleId, departmentId]
      );

      if (!adRes.rowCount) {
        skippedNoArticleDepartment++;
        continue;
      }

      const articleDepartmentId = adRes.rows[0].id;

      const metaRes = await client.query(
        `
        SELECT id
        FROM article_department_metadata
        WHERE article_department_id = $1
        ORDER BY created_at ASC
        LIMIT 1
        `,
        [articleDepartmentId]
      );

      const rawSource = {
        source: "firebase_v1_articles",
        plu,
        data,
      };

      if (metaRes.rowCount) {
        await client.query(
          `
          UPDATE article_department_metadata
          SET
            field_key = 'business_metadata',
            field_value = $2,
            nom_latin = CASE WHEN $3 <> '' THEN $3 ELSE nom_latin END,
            latin_name = CASE WHEN $3 <> '' THEN $3 ELSE latin_name END,
            category = CASE WHEN $4 <> '' THEN $4 ELSE category END,
            zone = CASE WHEN $5 <> '' THEN $5 ELSE zone END,
            fao_zone = CASE WHEN $5 <> '' THEN $5 ELSE fao_zone END,
            sous_zone = CASE WHEN $6 <> '' THEN $6 ELSE sous_zone END,
            engin = CASE WHEN $7 <> '' THEN $7 ELSE engin END,
            allergenes = CASE WHEN $8 <> '' THEN $8 ELSE allergenes END,
            raw_source = $9::jsonb,
            updated_at = now()
          WHERE id = $1
          `,
          [
            metaRes.rows[0].id,
            JSON.stringify(rawSource),
            latinName,
            category,
            faoZone,
            faoSubzone,
            fishingGear,
            allergenes,
            JSON.stringify(rawSource),
          ]
        );
      } else {
        await client.query(
          `
          INSERT INTO article_department_metadata (
            article_department_id,
            field_key,
            field_value,
            nom_latin,
            latin_name,
            category,
            zone,
            fao_zone,
            sous_zone,
            engin,
            allergenes,
            raw_source,
            created_at,
            updated_at
          )
          VALUES (
            $1,
            'business_metadata',
            $2,
            $3,
            $3,
            $4,
            $5,
            $5,
            $6,
            $7,
            $8,
            $9::jsonb,
            now(),
            now()
          )
          `,
          [
            articleDepartmentId,
            JSON.stringify(rawSource),
            latinName,
            category,
            faoZone,
            faoSubzone,
            fishingGear,
            allergenes,
            JSON.stringify(rawSource),
          ]
        );
      }

      updatedMetadata++;
    }

    await client.query("COMMIT");

    console.log("✅ Mise à jour métadonnées articles terminée");
    console.log({
      targetDb: TARGET_DB_NAME,
      storeCode: STORE_CODE,
      departmentCode: DEPARTMENT_CODE,
      articlesFirebase: Object.keys(articlesV1).length,
      withBusinessData,
      updatedArticles,
      updatedMetadata,
      skippedNoArticle,
      skippedNoArticleDepartment,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Erreur migration métadonnées articles");
    console.error(err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();