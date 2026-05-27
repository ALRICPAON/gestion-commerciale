const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const TARGET_DB_NAME = process.env.TARGET_DB_NAME || "gestion_rayons";
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

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function text(value) {
  return value === null || value === undefined ? "" : String(value);
}

async function main() {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Fichier introuvable : ${backupPath}`);
  }

  const data = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  const journal = data.compta_journal || {};

  const client = await pool.connect();

  const stats = {
    found: Object.keys(journal).length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  try {
    await client.query("BEGIN");

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

    const storeId = storeRes.rows[0].id;
    const departmentId = departmentRes.rows[0].id;

    for (const [firebaseId, doc] of Object.entries(journal)) {
      const d = doc.data || {};
      const closureDate = d.date || firebaseId;

      if (!closureDate) {
        stats.skipped++;
        stats.errors.push(`${firebaseId} ignoré : date manquante`);
        continue;
      }

      const caRealHt = num(d.caReel);

const theoreticalCaHt = num(
  d.caTheorique ??
  d.venteTheoriqueHT ??
  d.caTheo
);

const purchasesHt = num(
  d.achatsPeriode ??
  d.achatsPeriodeHT
);

const consumedCostHt = num(
  d.achatsConsoFinal ??
  d.achatsConsoHT
);

const realMarginHt = num(d.marge);
const realMarginPct = num(d.margePct);

      const stockStart = num(d.stockDebut);
      const stockEnd = d.stockFinManual !== undefined
        ? num(d.stockFinManual)
        : num(d.stockFin);

      const validated = Boolean(d.validated);

      const notes = [
        text(d.noteZ || d.zNote),
        "",
        "---",
        "Import Firebase V1",
        `ID: ${firebaseId}`,
        `updatedAt: ${text(d.updatedAt)}`,
      ].join("\n").trim();

      const existing = await client.query(
        `
        SELECT id
        FROM compta_daily_closures
        WHERE store_id = $1
          AND department_id = $2
          AND closure_date = $3
        LIMIT 1
        `,
        [storeId, departmentId, closureDate]
      );

      if (existing.rows.length) {
        await client.query(
          `
          UPDATE compta_daily_closures
          SET ca_real_ht = $1,
              stock_start_value_ht = $2,
              stock_end_value_ht = $3,
              purchases_ht = $4,
              real_consumed_cost_ht = $5,
              real_margin_ht = $6,
              real_margin_pct = $7,
              theoretical_ca_ht = $8,
              theoretical_cost_ht = $9,
              theoretical_margin_ht = $10,
              theoretical_margin_pct = $11,
              delta_ca_real_vs_theoretical = $12,
              delta_margin_real_vs_theoretical = $13,
              notes = $14,
              validated = $15,
              validated_at = CASE WHEN $15 = true THEN COALESCE(validated_at, now()) ELSE validated_at END,
              updated_at = now()
          WHERE id = $16
          `,
          [
            caRealHt,
            stockStart,
            stockEnd,
            purchasesHt,
            consumedCostHt,
            realMarginHt,
            realMarginPct,
            theoreticalCaHt,
            consumedCostHt,
            theoreticalCaHt - consumedCostHt,
            theoreticalCaHt > 0
              ? ((theoreticalCaHt - consumedCostHt) / theoreticalCaHt) * 100
              : 0,
            caRealHt - theoreticalCaHt,
            realMarginHt - (theoreticalCaHt - consumedCostHt),
            notes,
            validated,
            existing.rows[0].id,
          ]
        );

        stats.updated++;
      } else {
        await client.query(
          `
          INSERT INTO compta_daily_closures (
            store_id,
            department_id,
            closure_date,
            ca_real_ht,
            ca_n1_ht,
            stock_start_value_ht,
            stock_end_value_ht,
            purchases_ht,
            real_consumed_cost_ht,
            real_margin_ht,
            real_margin_pct,
            theoretical_ca_ht,
            theoretical_cost_ht,
            theoretical_margin_ht,
            theoretical_margin_pct,
            delta_ca_real_vs_theoretical,
            delta_margin_real_vs_theoretical,
            notes,
            validated,
            validated_at
          )
          VALUES (
            $1, $2, $3, $4, 0, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18,
            CASE WHEN $18 = true THEN now() ELSE NULL END
          )
          `,
          [
            storeId,
            departmentId,
            closureDate,
            caRealHt,
            stockStart,
            stockEnd,
            purchasesHt,
            consumedCostHt,
            realMarginHt,
            realMarginPct,
            theoreticalCaHt,
            consumedCostHt,
            theoreticalCaHt - consumedCostHt,
            theoreticalCaHt > 0
              ? ((theoreticalCaHt - consumedCostHt) / theoreticalCaHt) * 100
              : 0,
            caRealHt - theoreticalCaHt,
            realMarginHt - (theoreticalCaHt - consumedCostHt),
            notes,
            validated,
          ]
        );

        stats.inserted++;
      }
    }

    await client.query("COMMIT");

    console.log("Import comptabilité historique terminé");
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
  console.error("Erreur import comptabilité historique :", err);
  process.exit(1);
});