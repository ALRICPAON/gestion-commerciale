require("dotenv").config();
const fs = require("fs");
const { Pool } = require("pg");

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const suppliers = JSON.parse(
  fs.readFileSync("./suppliers-v2.json", "utf8")
);

async function importSuppliers() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const supplier of suppliers) {
      await client.query(
        `
        INSERT INTO suppliers (
          store_id,
          code,
          name,
          contact_name,
          phone,
          email,
          address,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (store_id, code)
        DO UPDATE SET
          name = EXCLUDED.name,
          contact_name = EXCLUDED.contact_name,
          phone = EXCLUDED.phone,
          email = EXCLUDED.email,
          address = EXCLUDED.address,
          is_active = EXCLUDED.is_active
        `,
        [
          supplier.store_id,
          supplier.code,
          supplier.name,
          supplier.contact_name,
          supplier.phone,
          supplier.email,
          supplier.address_line1, // on envoie ça dans la colonne SQL "address"
          supplier.is_active,
        ]
      );
    }

    await client.query("COMMIT");
    console.log(`✅ Import terminé : ${suppliers.length} fournisseurs traités`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Erreur import :", error);
  } finally {
    client.release();
    await pool.end();
  }
}

importSuppliers();