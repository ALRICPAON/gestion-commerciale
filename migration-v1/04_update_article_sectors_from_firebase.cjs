require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const BACKUP_PATH = path.join(__dirname, "backup-v1.json");

const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.TARGET_DB_NAME || process.env.DB_NAME || "gestion_commerciale",
  user: process.env.DB_USER || "admin",
  password: process.env.DB_PASSWORD || "password",
};

const STORE_CODE = process.env.STORE_CODE || "LEC001";
const DEPARTMENT_CODE = process.env.DEPARTMENT_CODE || "POIS";

function normalizeRayon(value) {
  const raw = String(value || "").trim().toLowerCase();

  const map = {
    trad: "TRAD",
    traditionnel: "TRAD",
    ls: "LS",
    libre_service: "LS",
    "libre-service": "LS",
    fe: "FE",
    frais_emballe: "FE",
    "frais-emballe": "FE",
    frais_emballé: "FE",
    "frais-emballé": "FE",
    sce: "SCE",
    sauce: "SCE",
    sauces: "SCE",
    emb: "EMB",
    emballage: "EMB",
    emballages: "EMB",
  };

  return map[raw] || null;
}

function getData(doc) {
  return doc?.data || doc || {};
}

async function main() {
  if (!fs.existsSync(BACKUP_PATH)) {
    throw new Error(`Fichier introuvable : ${BACKUP_PATH}`);
  }

  const backup = JSON.parse(fs.readFileSync(BACKUP_PATH, "utf8"));
  const firebaseArticles = backup.articles || {};

  const pool = new Pool(DB_CONFIG);
  const client = await pool.connect();

  let updated = 0;
  let skippedNoPlu = 0;
  let skippedNoRayon = 0;
  let skippedUnknownRayon = 0;
  let skippedArticleNotFound = 0;
  let errors = 0;

  try {
    console.log("========================================");
    console.log("Mise à jour secteurs articles depuis Firebase V1");
    console.log("Base cible :", DB_CONFIG.database);
    console.log("Store code :", STORE_CODE);
    console.log("Department code :", DEPARTMENT_CODE);
    console.log("Articles Firebase :", Object.keys(firebaseArticles).length);
    console.log("========================================");

    const storeResult = await client.query(
      `SELECT id FROM stores WHERE code = $1 LIMIT 1`,
      [STORE_CODE]
    );

    if (storeResult.rows.length === 0) {
      throw new Error(`Store introuvable avec code ${STORE_CODE}`);
    }

    const storeId = storeResult.rows[0].id;

    const departmentResult = await client.query(
      `
      SELECT id
      FROM departments
      WHERE store_id = $1
        AND code = $2
      LIMIT 1
      `,
      [storeId, DEPARTMENT_CODE]
    );

    if (departmentResult.rows.length === 0) {
      throw new Error(`Rayon introuvable avec code ${DEPARTMENT_CODE}`);
    }

    const departmentId = departmentResult.rows[0].id;

    const sectorsResult = await client.query(
      `
      SELECT id, code
      FROM department_sectors
      WHERE department_id = $1
      `,
      [departmentId]
    );

    const sectorByCode = new Map(
      sectorsResult.rows.map((sector) => [String(sector.code).toUpperCase(), sector.id])
    );

    console.log("Secteurs V2 trouvés :", [...sectorByCode.keys()].join(", "));

    const articlesResult = await client.query(
      `
      SELECT a.id, a.plu
      FROM articles a
      JOIN article_departments ad ON ad.article_id = a.id
      WHERE ad.department_id = $1
      `,
      [departmentId]
    );

    const articleByPlu = new Map(
      articlesResult.rows.map((article) => [String(article.plu).trim(), article.id])
    );

    await client.query("BEGIN");

    for (const [firebaseId, rawArticle] of Object.entries(firebaseArticles)) {
      try {
        const data = getData(rawArticle);
        const plu = String(data.PLU || data.plu || firebaseId || "").trim();

        if (!plu) {
          skippedNoPlu++;
          continue;
        }

        const rayonRaw = data.rayon;
        if (!rayonRaw) {
          skippedNoRayon++;
          continue;
        }

        const sectorCode = normalizeRayon(rayonRaw);
        if (!sectorCode) {
          skippedUnknownRayon++;
          console.log("Rayon Firebase inconnu :", { plu, designation: data.Designation, rayon: rayonRaw });
          continue;
        }

        const sectorId = sectorByCode.get(sectorCode);
        if (!sectorId) {
          skippedUnknownRayon++;
          console.log("Secteur V2 introuvable :", { plu, sectorCode });
          continue;
        }

        const articleId = articleByPlu.get(plu);
        if (!articleId) {
          skippedArticleNotFound++;
          continue;
        }

        const result = await client.query(
          `
          UPDATE article_departments
          SET department_sector_id = $1
          WHERE article_id = $2
            AND department_id = $3
          `,
          [sectorId, articleId, departmentId]
        );

        updated += result.rowCount;
      } catch (err) {
        errors++;
        console.error("Erreur article Firebase :", firebaseId, err.message);
      }
    }

    await client.query("COMMIT");

    console.log("========================================");
    console.log("Mise à jour secteurs terminée");
    console.log("Mis à jour :", updated);
    console.log("Ignorés sans PLU :", skippedNoPlu);
    console.log("Ignorés sans rayon :", skippedNoRayon);
    console.log("Ignorés rayon inconnu :", skippedUnknownRayon);
    console.log("Ignorés article introuvable :", skippedArticleNotFound);
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
