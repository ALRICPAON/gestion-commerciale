const fs = require("fs");
const { Pool } = require("pg");
const STORE_ID = "74e852c6-1ea2-46bd-92c4-bcc4a666415c";
const DEPARTMENT_ID = "07b8ffb0-4547-4010-b475-56602591eb67";
const crypto = require("crypto");

const raw = fs.readFileSync("./migration-v1/backup-v1.json", "utf8");
const backup = JSON.parse(raw);

const pool = new Pool({
  host: "localhost",
  port: 5432,
  user: "admin",
  password: "ChangeMoi_RayonV2_2026!",
  database: process.env.TARGET_DB_NAME || "gestion_rayons",
});

function uuid() {
  return crypto.randomUUID();
}

async function main() {
  const client = await pool.connect();

  try {
    console.log("=== IMPORT FOURNISSEURS ===");

    const supplierMap = {};

    for (const [firebaseId, doc] of Object.entries(backup.fournisseurs || {})) {
      const d = doc.data || {};

      const supplierId = uuid();

      supplierMap[d.code] = supplierId;

      await client.query(
  `
  INSERT INTO suppliers (
    id,
    store_id,
    code,
    name,
    contact_name,
    phone,
    email,
    address,
    is_active,
    created_at
  )
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW())
  `,
  [
    supplierId,
    STORE_ID,
    d.code || firebaseId,
    d.nom || "",
    d.contact || "",
    d.telephone || "",
    d.email || "",
    d.adresse || "",
  ]
);
      console.log("FOURNISSEUR :", d.code, d.nom);
    }

    console.log("");
    console.log("=== IMPORT ARTICLES ===");

    const articleMap = {};

    for (const [firebaseId, doc] of Object.entries(backup.articles || {})) {
      const d = doc.data || {};

      const articleId = uuid();

      articleMap[d.PLU] = articleId;

      await client.query(
  `
  INSERT INTO articles (
    id,
    store_id,
    plu,
    designation,
    unit,
    category,
    latin_name,
    fao_zone,
    fao_subzone,
    fishing_gear,
    ean,
    is_active,
    source_origin,
    source_id,
    created_at,
    updated_at
  )
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,'firebase_v1',$12,NOW(),NOW())
  `,
  [
    articleId,
    STORE_ID,
    d.PLU || firebaseId,
    d.Designation || "",
    d.Unite || "kg",
    d.Categorie || "",
    d.NomLatin || "",
    d.Zone || "",
    d.SousZone || "",
    d.Engin || "",
    d.ean || "",
    firebaseId,
  ]
);

await client.query(
  `
  INSERT INTO article_departments (
    article_id,
    department_id,
    display_name,
    purchase_unit,
    stock_unit,
    sale_unit,
    is_active,
    created_at,
    updated_at
  )
  VALUES (
    $1,$2,$3,$4,$5,$6,true,NOW(),NOW()
  )
  `,
  [
    articleId,
    DEPARTMENT_ID,
    d.Designation || "",
    d.Unite || "kg",
    d.Unite || "kg",
    d.Unite || "kg",
  ]
);
      console.log("ARTICLE :", d.PLU, d.Designation);
    }

    console.log("");
    console.log("=== IMPORT AF_MAP ===");

    for (const [firebaseId, doc] of Object.entries(backup.af_map || {})) {
      const d = doc.data || {};

      const articleId = articleMap[d.plu];
      const supplierId = supplierMap[d.fournisseurCode];

      if (!articleId || !supplierId) {
        console.log("SKIP AF_MAP", firebaseId);
        continue;
      }

      await client.query(
  `
  INSERT INTO supplier_article_mappings (
    id,
    supplier_id,
    article_id,
    supplier_ref,
    supplier_label,
    purchase_unit,
    conversion_to_stock,
    is_active,
    created_at
  )
  VALUES (
    gen_random_uuid(),
    $1,$2,$3,$4,$5,1,true,NOW()
  )
  ON CONFLICT (supplier_id, supplier_ref) DO NOTHING
  `,
  [
    supplierId,
    articleId,
    d.refFournisseur || "",
    d.aliasFournisseur || d.designationInterne || "",
    "kg",
  ]
);
    }

    console.log("");
    console.log("=== IMPORT TERMINE ===");
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    await pool.end();
  }
}

main();