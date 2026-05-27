/*
  Migration Firebase V1 -> Rayon V2
  07_import_supplier_invoices.cjs

  Importe les factures fournisseurs Firebase V1 vers :
  - supplier_invoices
  - supplier_invoice_links

  Matching achats :
  Firebase factures.data.achatsPointes[].achatId -> purchases.bl_number
  Secours -> purchases.notes contient "achatId=<firebaseId>"

  Variables attendues :
  DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, TARGET_DB_NAME
  STORE_CODE=LEC001
  DEPARTMENT_CODE=POIS

  Fichier attendu :
  migration-v1/backup-v1.json
  ou backup-v1.json à la racine du projet
*/

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const TARGET_DB_NAME = process.env.TARGET_DB_NAME || process.env.DB_NAME || 'gestion_rayons';
const STORE_CODE = process.env.STORE_CODE || 'LEC001';
const DEPARTMENT_CODE = process.env.DEPARTMENT_CODE || 'POIS';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'admin',
  password: process.env.DB_PASSWORD,
  database: TARGET_DB_NAME,
});

function readBackup() {
  const candidates = [
    path.join(process.cwd(), 'migration-v1', 'backup-v1.json'),
    path.join(process.cwd(), 'backup-v1.json'),
  ];

  const filePath = candidates.find((p) => fs.existsSync(p));
  if (!filePath) {
    throw new Error(
      'backup-v1.json introuvable. Place le fichier dans migration-v1/backup-v1.json ou à la racine du projet.'
    );
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toDate(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  if (value && typeof value === 'object' && value._seconds) {
    return new Date(value._seconds * 1000).toISOString().slice(0, 10);
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function toTimestamp(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object' && value._seconds) {
    return new Date(value._seconds * 1000).toISOString();
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeStatus(firebaseStatus) {
  // V2 autorise uniquement draft / validated / cancelled.
  // En V1, OK et ECART sont des factures lettrées.
  // On conserve l'écart dans gap_ht.
  const s = String(firebaseStatus || '').trim().toUpperCase();

  if (s === 'ANNULEE' || s === 'ANNULÉE' || s === 'CANCELLED') {
    return 'cancelled';
  }

  return 'validated';
}

async function getContext(client) {
  const storeRes = await client.query(
    `SELECT id FROM stores WHERE code = $1 LIMIT 1`,
    [STORE_CODE]
  );

  if (storeRes.rowCount === 0) {
    throw new Error(`Store introuvable pour code=${STORE_CODE}`);
  }

  const departmentRes = await client.query(
    `SELECT id FROM departments WHERE code = $1 LIMIT 1`,
    [DEPARTMENT_CODE]
  );

  if (departmentRes.rowCount === 0) {
    throw new Error(`Department introuvable pour code=${DEPARTMENT_CODE}`);
  }

  return {
    storeId: storeRes.rows[0].id,
    departmentId: departmentRes.rows[0].id,
  };
}

async function getSupplierMap(client, storeId) {
  const res = await client.query(
    `SELECT id, code FROM suppliers WHERE store_id = $1`,
    [storeId]
  );

  const map = new Map();

  for (const row of res.rows) {
    if (row.code !== null && row.code !== undefined) {
      map.set(String(row.code).trim(), row.id);
    }
  }

  return map;
}

async function findPurchaseId(client, storeId, departmentId, firebaseAchatId) {
  if (!firebaseAchatId) return null;

  const legacyId = String(firebaseAchatId).trim();

  const res = await client.query(
    `SELECT id
       FROM purchases
      WHERE store_id = $1
        AND department_id = $2
        AND (
          bl_number = $3
          OR notes ILIKE $4
        )
      ORDER BY created_at DESC
      LIMIT 1`,
    [storeId, departmentId, legacyId, `%achatId=${legacyId}%`]
  );

  return res.rowCount ? res.rows[0].id : null;
}

async function main() {
  const backup = readBackup();
  const factures = backup.factures || {};
  const entries = Object.entries(factures);

  console.log(`Factures Firebase détectées : ${entries.length}`);

  const client = await pool.connect();

  const stats = {
    importedInvoices: 0,
    importedLinks: 0,
    skippedInvoices: 0,
    missingSuppliers: 0,
    unmatchedPurchases: 0,
    errors: 0,
  };

  try {
    await client.query('BEGIN');

    const { storeId, departmentId } = await getContext(client);
    const supplierMap = await getSupplierMap(client, storeId);

    // Réimport propre et idempotent pour le magasin/rayon cible.
    // Les liens sont supprimés automatiquement grâce au ON DELETE CASCADE.
    await client.query(
      `DELETE FROM supplier_invoices
        WHERE store_id = $1
          AND department_id = $2`,
      [storeId, departmentId]
    );

    for (const [firebaseInvoiceId, wrapper] of entries) {
      try {
        const data = wrapper && wrapper.data ? wrapper.data : wrapper;

        if (!data) {
          stats.skippedInvoices += 1;
          continue;
        }

        const invoiceDate = toDate(data.date || data.createdAt);

        if (!invoiceDate) {
          console.warn(`Facture ignorée sans date : ${firebaseInvoiceId}`);
          stats.skippedInvoices += 1;
          continue;
        }

        const supplierCode = String(data.fournisseurCode || '').trim();
        const supplierId = supplierMap.get(supplierCode) || null;

        if (!supplierId) {
          stats.missingSuppliers += 1;
        }

        const invoiceNumber = data.numero
          ? String(data.numero).trim()
          : String(firebaseInvoiceId).trim();

        const amountHt = toNumber(
          data.montantFactureHT ?? data.montantFournisseurHT,
          0
        );

        const validatedAmountHt = toNumber(data.totalPointeHT, 0);
        const gapHt = toNumber(data.ecartHT, amountHt - validatedAmountHt);
        const status = normalizeStatus(data.statut);
        const createdAt = toTimestamp(data.createdAt) || new Date().toISOString();

        const noteParts = [];
        if (data.ecartNote) noteParts.push(String(data.ecartNote));
        noteParts.push(`Import Firebase V1 factureId=${firebaseInvoiceId}`);
        if (supplierCode) noteParts.push(`fournisseurCode=${supplierCode}`);
        if (data.statut) noteParts.push(`statutV1=${data.statut}`);
        const notes = noteParts.join(' | ');

        const insertInvoice = await client.query(
          `INSERT INTO supplier_invoices (
             store_id,
             department_id,
             supplier_id,
             invoice_date,
             invoice_number,
             amount_ht,
             validated_amount_ht,
             gap_ht,
             status,
             notes,
             validated_at,
             created_at,
             updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             CASE WHEN $9 = 'validated' THEN COALESCE($11::timestamp, now()) ELSE NULL END,
             COALESCE($11::timestamp, now()),
             now()
           )
           RETURNING id`,
          [
            storeId,
            departmentId,
            supplierId,
            invoiceDate,
            invoiceNumber,
            amountHt,
            validatedAmountHt,
            gapHt,
            status,
            notes,
            createdAt,
          ]
        );

        const supplierInvoiceId = insertInvoice.rows[0].id;
        stats.importedInvoices += 1;

        const links = Array.isArray(data.achatsPointes)
          ? data.achatsPointes
          : [];

        for (const link of links) {
          const achatId = link.achatId || link.numeroAchat;
          const purchaseId = await findPurchaseId(
            client,
            storeId,
            departmentId,
            achatId
          );

          if (!purchaseId) {
            stats.unmatchedPurchases += 1;
            console.warn(
              `Achat non retrouvé pour facture ${invoiceNumber} : achatId=${achatId}`
            );
          }

          await client.query(
            `INSERT INTO supplier_invoice_links (
               supplier_invoice_id,
               purchase_id,
               purchase_line_id,
               linked_amount_ht,
               created_at
             ) VALUES ($1, $2, NULL, $3, now())`,
            [supplierInvoiceId, purchaseId, toNumber(link.totalHT, 0)]
          );

          stats.importedLinks += 1;
        }
      } catch (err) {
        stats.errors += 1;
        console.error(`Erreur facture ${firebaseInvoiceId}:`, err.message);
      }
    }

    await client.query('COMMIT');

    console.log('✅ Import factures fournisseurs terminé');
    console.log(stats);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
