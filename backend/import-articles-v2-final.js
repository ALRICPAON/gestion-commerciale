const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, ".env"),
});

const fs = require("fs");
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const INPUT_FILE = "C:/Users/apaon/export-firebase/articles-v2-ready.json";

const STORE_CODE = "LEC001";
const DEPARTMENT_CODE = "POIS";
const METADATA_FIELD_KEY = "v2_import";

async function getStore(client) {
  const res = await client.query(
    `SELECT id FROM stores WHERE code = $1 LIMIT 1`,
    [STORE_CODE]
  );
  if (!res.rows.length) throw new Error("Store introuvable");
  return res.rows[0];
}

async function getDepartment(client) {
  const res = await client.query(
    `SELECT id FROM departments WHERE code = $1 LIMIT 1`,
    [DEPARTMENT_CODE]
  );
  if (!res.rows.length) throw new Error("Département introuvable");
  return res.rows[0];
}

async function getSectorsMap(client, departmentId) {
  const res = await client.query(
    `SELECT id, code FROM department_sectors WHERE department_id = $1`,
    [departmentId]
  );

  const map = new Map();
  for (const row of res.rows) {
    map.set(row.code, row.id);
  }

  return map;
}

function getSafeDesignation(row) {
  const a = row.article || {};
  const raw = a.designation;

  if (raw && String(raw).trim() !== "") {
    return String(raw).trim();
  }

  if (a.plu && String(a.plu).trim() !== "") {
    return `[A COMPLETER] PLU ${String(a.plu).trim()}`;
  }

  return "[A COMPLETER] ARTICLE SANS DESIGNATION";
}

async function upsertArticle(client, storeId, row) {
  const a = row.article || {};
const designation = getSafeDesignation(row);

if (!a.designation || String(a.designation).trim() === "") {
  console.log(`⚠️ Désignation manquante pour PLU ${a.plu || "inconnu"} -> ${designation}`);
}

const res = await client.query(
    `
    INSERT INTO articles (
      store_id,
      plu,
      designation,
      unit,
      ean,
      is_active,
      source_origin,
      source_id
    )
    VALUES ($1, $2, $3, $4, $5, true, $6, $7)
    ON CONFLICT (store_id, plu)
    DO UPDATE SET
      designation = EXCLUDED.designation,
      unit = EXCLUDED.unit,
      ean = EXCLUDED.ean,
      is_active = EXCLUDED.is_active,
      source_origin = EXCLUDED.source_origin,
      source_id = EXCLUDED.source_id
    RETURNING id
    `,
    [
      storeId,
      a.plu,
      designation,
      a.unite || "kg",
      a.ean || null,
      "firebase",
      row.source_id || null,
    ]
  );

  return res.rows[0].id;
}

async function upsertArticleDepartment(client, articleId, departmentId, sectorId, row) {
  const a = row.article || {};

  const res = await client.query(
    `
    INSERT INTO article_departments (
      article_id,
      department_id,
      department_sector_id,
      display_name,
      is_active
    )
    VALUES ($1, $2, $3, $4, true)
    ON CONFLICT (article_id, department_id)
    DO UPDATE SET
      department_sector_id = EXCLUDED.department_sector_id,
      display_name = EXCLUDED.display_name,
      is_active = EXCLUDED.is_active
    RETURNING id
    `,
    [
      articleId,
      departmentId,
      sectorId,
      a.designation || null,
    ]
  );

  return res.rows[0].id;
}

async function upsertMetadata(client, articleDepartmentId, row) {
  const m = row.metadata || {};

  await client.query(
    `
    INSERT INTO article_department_metadata (
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
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (article_department_id, field_key)
    DO UPDATE SET
      field_value = EXCLUDED.field_value,
      category = EXCLUDED.category,
      latin_name = EXCLUDED.latin_name,
      fao_zone = EXCLUDED.fao_zone,
      sous_zone = EXCLUDED.sous_zone,
      engin = EXCLUDED.engin,
      allergenes = EXCLUDED.allergenes,
      raw_source = EXCLUDED.raw_source
    `,
    [
      articleDepartmentId,
      METADATA_FIELD_KEY,
      null,
      m.categorie || null,
      m.nom_latin || null,
      m.zone || null,
      m.sous_zone || null,
      m.engin || null,
      m.allergenes || null,
      JSON.stringify(row.raw_source || {}),
    ]
  );
}

async function main() {
  const raw = fs.readFileSync(INPUT_FILE, "utf-8");
  const rows = JSON.parse(raw);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const store = await getStore(client);
    const department = await getDepartment(client);
    const sectorsMap = await getSectorsMap(client, department.id);

    let count = 0;

    for (const row of rows) {
      const sectorCode = row?.sector?.code;
      const sectorId = sectorsMap.get(sectorCode) || null;

      const articleId = await upsertArticle(client, store.id, row);

      const articleDepartmentId = await upsertArticleDepartment(
        client,
        articleId,
        department.id,
        sectorId,
        row
      );

      await upsertMetadata(client, articleDepartmentId, row);

      count++;
    }

    await client.query("COMMIT");

    console.log("✅ IMPORT TERMINE");
    console.log("Articles importes :", count);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ ERREUR IMPORT :", err);
  } finally {
    client.release();
    await pool.end();
  }
}

main();