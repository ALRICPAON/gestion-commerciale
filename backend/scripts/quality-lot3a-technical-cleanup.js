require('dotenv').config();

const { Pool } = require('pg');
const { cleanupLot3aTechnicalDebt } = require('../services/quality/qualityLot3aTechnicalCleanupService');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} est requis`);
  return value;
}

function createPool() {
  return new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: required('DB_NAME'),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD,
  });
}

async function main() {
  const storeId = required('STORE_ID');
  const userId = process.env.USER_ID || null;
  const apply = process.env.APPLY === '1' || process.env.APPLY === 'true';
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await cleanupLot3aTechnicalDebt(client, storeId, userId, { apply });
    if (apply) await client.query('COMMIT');
    else await client.query('ROLLBACK');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
