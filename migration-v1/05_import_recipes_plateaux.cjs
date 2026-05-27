const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const TARGET_DB_NAME = process.env.TARGET_DB_NAME || "gestion_commerciale";
const STORE_CODE = process.env.STORE_CODE || "LEC001";
const DEPARTMENT_CODE = process.env.DEPARTMENT_CODE || "POIS";

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  database: TARGET_DB_NAME,
  user: process.env.DB_USER || "admin",
  password: process.env.DB_PASSWORD,
});

const backupPath = path.join(__dirname, "backup-v1.json");

function normalizePlu(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeUnit(value) {
  const unit = String(value || "kg").toLowerCase();
  if (["piece", "pièce", "pcs", "unite", "unité"].includes(unit)) return "piece";
  if (["colis"].includes(unit)) return "colis";
  return "kg";
}

async function getContext(client) {
  const storeRes = await client.query(
    "SELECT id FROM stores WHERE code = $1 LIMIT 1",
    [STORE_CODE]
  );

  if (!storeRes.rows.length) {
    throw new Error(`Store introuvable : ${STORE_CODE}`);
  }

  const departmentRes = await client.query(
    "SELECT id FROM departments WHERE code = $1 LIMIT 1",
    [DEPARTMENT_CODE]
  );

  if (!departmentRes.rows.length) {
    throw new Error(`Rayon introuvable : ${DEPARTMENT_CODE}`);
  }

  return {
    storeId: storeRes.rows[0].id,
    departmentId: departmentRes.rows[0].id,
  };
}

async function findArticleByPlu(client, plu) {
  const cleanPlu = normalizePlu(plu);
  if (!cleanPlu) return null;

  const res = await client.query(
    "SELECT id, plu, designation FROM articles WHERE plu = $1 LIMIT 1",
    [cleanPlu]
  );

  return res.rows[0] || null;
}

async function upsertRecipe(client, context, source) {
  const outputArticle = await findArticleByPlu(client, source.outputPlu);

  if (!outputArticle) {
    return {
      status: "skipped",
      reason: `Produit fini introuvable PLU ${source.outputPlu}`,
    };
  }

  const existing = await client.query(
    `
    SELECT id
    FROM recipes
    WHERE store_id = $1
      AND department_id = $2
      AND lower(name) = lower($3)
      AND output_article_id = $4
    LIMIT 1
    `,
    [context.storeId, context.departmentId, source.name, outputArticle.id]
  );

  let recipeId;

  if (existing.rows.length) {
    recipeId = existing.rows[0].id;

    await client.query(
      `
      UPDATE recipes
      SET output_quantity = $1,
          output_unit = $2,
          dlc_days = $3,
          procedure = $4,
          is_active = true
      WHERE id = $5
      `,
      [
        source.outputQuantity,
        source.outputUnit,
        source.dlcDays,
        source.procedure,
        recipeId,
      ]
    );

    await client.query("DELETE FROM recipe_ingredients WHERE recipe_id = $1", [
      recipeId,
    ]);
  } else {
    const inserted = await client.query(
      `
      INSERT INTO recipes
        (store_id, department_id, name, output_article_id, output_quantity, output_unit, dlc_days, procedure, is_active)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, true)
      RETURNING id
      `,
      [
        context.storeId,
        context.departmentId,
        source.name,
        outputArticle.id,
        source.outputQuantity,
        source.outputUnit,
        source.dlcDays,
        source.procedure,
      ]
    );

    recipeId = inserted.rows[0].id;
  }

  let lineNumber = 1;
  let insertedIngredients = 0;
  let skippedIngredients = 0;

  for (const ingredient of source.ingredients) {
    const article = await findArticleByPlu(client, ingredient.plu);

    if (!article) {
      skippedIngredients++;
      continue;
    }

    await client.query(
      `
      INSERT INTO recipe_ingredients
        (recipe_id, article_id, line_number, quantity, unit, notes)
      VALUES
        ($1, $2, $3, $4, $5, $6)
      `,
      [
        recipeId,
        article.id,
        lineNumber,
        ingredient.quantity,
        ingredient.unit,
        ingredient.notes || null,
      ]
    );

    lineNumber++;
    insertedIngredients++;
  }

  return {
    status: existing.rows.length ? "updated" : "inserted",
    insertedIngredients,
    skippedIngredients,
  };
}

function buildRecipesFromFirebase(data) {
  const rows = [];

  for (const [id, doc] of Object.entries(data.recettes || {})) {
    const r = doc.data || {};
    const final = r.produitFinal || {};

    rows.push({
      sourceType: "recette",
      legacyId: id,
      name: r.nom || final.designation || `Recette ${id}`,
      outputPlu: normalizePlu(final.plu),
      outputQuantity: Number(final.qty || final.quantity || 1),
      outputUnit: normalizeUnit(final.unit),
      dlcDays: Number(final.dlcDays || 0),
      procedure:
        `${r.procedure || ""}\n\n---\nImport Firebase V1\nType: recette\nID: ${id}`.trim(),
      ingredients: Array.isArray(r.ingredients)
        ? r.ingredients.map((ing) => ({
            plu: normalizePlu(ing.plu),
            quantity: Number(ing.qty || ing.quantity || 0),
            unit: normalizeUnit(ing.unit),
            notes: ing.designation || null,
          }))
        : [],
    });
  }

  return rows;
}

function buildPlateauxFromFirebase(data) {
  const rows = [];

  for (const [id, doc] of Object.entries(data.plateaux || {})) {
    const p = doc.data || {};

    rows.push({
      sourceType: "plateau",
      legacyId: id,
      name: p.designation || `Plateau ${id}`,
      outputPlu: normalizePlu(p.plu),
      outputQuantity: 1,
      outputUnit: "piece",
      dlcDays: 0,
      procedure:
        `Plateau importé depuis Firebase V1.\nPrix revient V1: ${p.prixRevient ?? ""}\nPV V1: ${p.pv ?? ""}\nMarge V1: ${p.marge ?? ""}\n\n---\nImport Firebase V1\nType: plateau\nID: ${id}`.trim(),
      ingredients: Array.isArray(p.composants)
        ? p.composants.map((ing) => ({
            plu: normalizePlu(ing.plu),
            quantity: Number(ing.qty || 0),
            unit: normalizeUnit(ing.unit),
            notes: ing.des || ing.designation || null,
          }))
        : [],
    });
  }

  return rows;
}

async function main() {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Fichier introuvable : ${backupPath}`);
  }

  const raw = fs.readFileSync(backupPath, "utf8");
  const data = JSON.parse(raw);

  const client = await pool.connect();

  const stats = {
    recettes: 0,
    plateaux: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    ingredientsInserted: 0,
    ingredientsSkipped: 0,
    errors: [],
  };

  try {
    await client.query("BEGIN");

    const context = await getContext(client);

    const recipes = buildRecipesFromFirebase(data);
    const plateaux = buildPlateauxFromFirebase(data);
    const all = [...recipes, ...plateaux];

    stats.recettes = recipes.length;
    stats.plateaux = plateaux.length;

    for (const item of all) {
      try {
        if (!item.outputPlu) {
          stats.skipped++;
          stats.errors.push(`${item.sourceType} ${item.legacyId} ignoré : PLU produit fini manquant`);
          continue;
        }

        if (!item.ingredients.length) {
          stats.skipped++;
          stats.errors.push(`${item.sourceType} ${item.legacyId} ignoré : aucun ingrédient`);
          continue;
        }

        const result = await upsertRecipe(client, context, item);

        if (result.status === "inserted") stats.inserted++;
        if (result.status === "updated") stats.updated++;
        if (result.status === "skipped") {
          stats.skipped++;
          stats.errors.push(`${item.sourceType} ${item.legacyId} ignoré : ${result.reason}`);
        }

        stats.ingredientsInserted += result.insertedIngredients || 0;
        stats.ingredientsSkipped += result.skippedIngredients || 0;
      } catch (err) {
        stats.skipped++;
        stats.errors.push(`${item.sourceType} ${item.legacyId} erreur : ${err.message}`);
      }
    }

    await client.query("COMMIT");

    console.log("Import recettes + plateaux terminé");
    console.log(stats);

    if (stats.errors.length) {
      console.log("\nDétails :");
      stats.errors.forEach((e) => console.log("- " + e));
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Erreur import recettes + plateaux :", err);
  process.exit(1);
});
