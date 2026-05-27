require("dotenv").config();
const { Pool } = require("pg");

const pools = new Map();

const DB_CLIENTS = {
  scorpa: process.env.DB_NAME_SCORPA || process.env.DB_NAME || "gestion_commerciale",
  default: process.env.DB_NAME || "gestion_commerciale",
};

function createPool(databaseName) {
  return new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: databaseName,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
}

function getPoolByDatabase(databaseName) {
  if (!databaseName) {
    throw new Error("Nom de base PostgreSQL manquant");
  }

  if (!pools.has(databaseName)) {
    pools.set(databaseName, createPool(databaseName));
  }

  return pools.get(databaseName);
}

function getPoolByClientKey(clientKey = "default") {
  const databaseName = DB_CLIENTS[clientKey];

  if (!databaseName) {
    throw new Error(`Client DB inconnu : ${clientKey}`);
  }

  return getPoolByDatabase(databaseName);
}

function getDefaultPool() {
  return getPoolByClientKey("default");
}

async function closeAllPools() {
  await Promise.all([...pools.values()].map((pool) => pool.end()));
  pools.clear();
}

module.exports = {
  DB_CLIENTS,
  getPoolByDatabase,
  getPoolByClientKey,
  getDefaultPool,
  closeAllPools,
};
