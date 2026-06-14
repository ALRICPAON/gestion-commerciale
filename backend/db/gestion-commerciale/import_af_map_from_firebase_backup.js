#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '..', '.env'),
});

const { Pool } = require('pg');

const TABLE = 'supplier_article_mappings';
const REF_COLUMNS = ['supplier_reference', 'ref_fournisseur', 'refFournisseur', 'reference_fournisseur'];

const COLUMN_CANDIDATES = {
  supplier_code: ['supplier_code', 'fournisseur_code', 'fournisseurCode'],
  supplier_reference: REF_COLUMNS,
  supplier_alias: ['supplier_alias', 'alias_fournisseur', 'aliasFournisseur'],
  article_designation: ['article_designation', 'designation_interne', 'designationInterne', 'designation'],
  article_plu: ['article_plu', 'plu'],
  supplier_name: ['supplier_name', 'fournisseur_nom', 'fournisseurNom'],
  zone: ['zone'],
  sous_zone: ['sous_zone', 'sousZone'],
  fishing_gear: ['fishing_gear', 'engin'],
  latin_name: ['latin_name', 'nom_latin', 'nomLatin'],
  allergens: ['allergens', 'allergenes'],
  production_method: ['production_method', 'methode'],
  raw_data: ['raw_data', 'firebase_data', 'metadata'],
  source: ['source'],
  created_at: ['created_at'],
  updated_at: ['updated_at'],
};

function parseArgs(argv) {
  const args = {
    file: null,
    storeId: null,
    apply: false,
    reportFile: null,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file') args.file = argv[++i];
    else if (arg === '--store-id') args.storeId = argv[++i];
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--report-file') args.reportFile = argv[++i];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Argument inconnu: ${arg}`);
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node backend/db/gestion-commerciale/import_af_map_from_firebase_backup.js --store-id <uuid> --file <backup-v1.json> [--apply] [--report-file report.json]',
    '',
    'Par defaut, le script simule l import. Ajouter --apply pour ecrire en base.',
  ].join('\n');
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function decodeFirebaseValue(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(decodeFirebaseValue);
  if (typeof value !== 'object') return value;

  if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) return Number(value.integerValue);
  if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) return Number(value.doubleValue);
  if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) return Boolean(value.booleanValue);
  if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) return null;
  if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) return value.timestampValue;
  if (Object.prototype.hasOwnProperty.call(value, 'arrayValue')) {
    return (value.arrayValue.values || []).map(decodeFirebaseValue);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'mapValue')) {
    return decodeFirebaseValue(value.mapValue.fields || {});
  }
  if (Object.prototype.hasOwnProperty.call(value, 'fields')) return decodeFirebaseValue(value.fields);

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, decodeFirebaseValue(child)])
  );
}

function normalizeMappingEntry(entry, firebaseKey) {
  const decoded = decodeFirebaseValue(entry);
  const data = decoded?.data && typeof decoded.data === 'object' ? decoded.data : decoded;
  return {
    firebase_key: firebaseKey || clean(decoded?.id) || null,
    fournisseurCode: clean(data?.fournisseurCode),
    refFournisseur: clean(data?.refFournisseur),
    aliasFournisseur: clean(data?.aliasFournisseur),
    designationInterne: clean(data?.designationInterne),
    plu: clean(data?.plu),
    fournisseurNom: clean(data?.fournisseurNom),
    zone: clean(data?.zone),
    sousZone: clean(data?.sousZone),
    engin: clean(data?.engin),
    nomLatin: clean(data?.nomLatin),
    allergenes: clean(data?.allergenes),
    methode: clean(data?.methode),
    raw: data || {},
  };
}

function extractAfMapRows(backup) {
  const container = backup?.af_map || backup?.data?.af_map;
  if (!container) {
    throw new Error('Cle af_map introuvable dans le backup JSON');
  }

  if (Array.isArray(container)) {
    return container.map((entry, index) => normalizeMappingEntry(entry, String(index)));
  }

  if (typeof container === 'object') {
    return Object.entries(container).map(([key, entry]) => normalizeMappingEntry(entry, key));
  }

  throw new Error('Format af_map invalide: tableau ou objet attendu');
}

async function getTableColumns(client, tableName) {
  const result = await client.query(
    `
    SELECT column_name, column_default, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    ORDER BY ordinal_position
    `,
    [tableName]
  );

  return result.rows;
}

function findColumn(columns, candidates) {
  const names = new Set(columns.map((column) => column.column_name));
  return candidates.find((candidate) => names.has(candidate)) || null;
}

function buildColumnMap(columns) {
  const columnMap = Object.fromEntries(
    Object.entries(COLUMN_CANDIDATES).map(([key, candidates]) => [key, findColumn(columns, candidates)])
  );
  const rawDataColumn = columns.find((column) => column.column_name === columnMap.raw_data);
  if (rawDataColumn && !['json', 'jsonb'].includes(rawDataColumn.data_type)) {
    columnMap.raw_data = null;
  }
  return columnMap;
}

async function findSupplier(client, storeId, supplierCode) {
  if (!supplierCode) return null;
  const result = await client.query(
    `
    SELECT id, code, name
    FROM suppliers
    WHERE store_id = $1
      AND LOWER(TRIM(code)) = LOWER(TRIM($2))
    LIMIT 1
    `,
    [storeId, supplierCode]
  );
  return result.rows[0] || null;
}

async function findArticle(client, storeId, plu) {
  if (!plu) return null;
  const result = await client.query(
    `
    SELECT id, plu, designation
    FROM articles
    WHERE store_id = $1
      AND LOWER(TRIM(plu::text)) = LOWER(TRIM($2))
    ORDER BY COALESCE(is_active, true) DESC, updated_at DESC NULLS LAST
    LIMIT 1
    `,
    [storeId, plu]
  );
  return result.rows[0] || null;
}

async function mappingExists(client, storeId, supplierId, articleId, refFournisseur, columnMap) {
  const refColumn = columnMap.supplier_reference;
  const params = [storeId, supplierId];
  let where = 'store_id = $1 AND supplier_id = $2';

  if (refColumn && refFournisseur) {
    params.push(refFournisseur);
    where += ` AND LOWER(TRIM(${quoteIdentifier(refColumn)}::text)) = LOWER(TRIM($${params.length}))`;
  } else {
    params.push(articleId);
    where += ` AND article_id = $${params.length}`;
  }

  const result = await client.query(
    `SELECT id FROM ${TABLE} WHERE ${where} LIMIT 1`,
    params
  );
  return result.rows[0] || null;
}

function addInsertValue(insert, column, value) {
  if (!column || value === undefined) return;
  insert.columns.push(column);
  insert.values.push(value);
}

function buildInsert(mapping, storeId, supplier, article, columnMap) {
  const insert = {
    columns: ['store_id', 'supplier_id', 'article_id'],
    values: [storeId, supplier.id, article.id],
  };

  addInsertValue(insert, columnMap.supplier_code, mapping.fournisseurCode);
  addInsertValue(insert, columnMap.supplier_reference, mapping.refFournisseur);
  addInsertValue(insert, columnMap.supplier_alias, mapping.aliasFournisseur);
  addInsertValue(insert, columnMap.article_designation, mapping.designationInterne);
  addInsertValue(insert, columnMap.article_plu, mapping.plu);
  addInsertValue(insert, columnMap.supplier_name, mapping.fournisseurNom);
  addInsertValue(insert, columnMap.zone, mapping.zone);
  addInsertValue(insert, columnMap.sous_zone, mapping.sousZone);
  addInsertValue(insert, columnMap.fishing_gear, mapping.engin);
  addInsertValue(insert, columnMap.latin_name, mapping.nomLatin);
  addInsertValue(insert, columnMap.allergens, mapping.allergenes);
  addInsertValue(insert, columnMap.production_method, mapping.methode);
  addInsertValue(insert, columnMap.raw_data, {
    firebase_key: mapping.firebase_key,
    ...mapping.raw,
  });
  addInsertValue(insert, columnMap.source, 'firebase_backup_af_map');
  addInsertValue(insert, columnMap.created_at, new Date());
  addInsertValue(insert, columnMap.updated_at, new Date());

  return insert;
}

async function insertMapping(client, insert) {
  const quotedColumns = insert.columns.map(quoteIdentifier);
  const placeholders = insert.values.map((_, index) => `$${index + 1}`);
  await client.query(
    `INSERT INTO ${TABLE} (${quotedColumns.join(', ')}) VALUES (${placeholders.join(', ')})`,
    insert.values
  );
}

function emptyReport(totalRows, apply) {
  return {
    mode: apply ? 'apply' : 'dry-run',
    total_rows: totalRows,
    imported: 0,
    ignored: 0,
    supplier_not_found: 0,
    article_not_found: 0,
    invalid_rows: 0,
    errors: [],
  };
}

async function run() {
  const args = parseArgs(process.argv);
  if (args.help || !args.file || !args.storeId) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }

  const backupPath = path.resolve(args.file);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const rows = extractAfMapRows(backup);
  const report = emptyReport(rows.length, args.apply);

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  const client = await pool.connect();
  try {
    const columns = await getTableColumns(client, TABLE);
    const columnNames = new Set(columns.map((column) => column.column_name));
    for (const required of ['store_id', 'supplier_id', 'article_id']) {
      if (!columnNames.has(required)) throw new Error(`Colonne obligatoire absente: ${TABLE}.${required}`);
    }

    const columnMap = buildColumnMap(columns);

    await client.query('BEGIN');

    for (const mapping of rows) {
      if (!mapping.fournisseurCode || !mapping.refFournisseur || !mapping.plu) {
        report.invalid_rows += 1;
        report.ignored += 1;
        report.errors.push({
          reason: 'invalid_row',
          firebase_key: mapping.firebase_key,
          fournisseurCode: mapping.fournisseurCode,
          refFournisseur: mapping.refFournisseur,
          plu: mapping.plu,
        });
        continue;
      }

      const supplier = await findSupplier(client, args.storeId, mapping.fournisseurCode);
      if (!supplier) {
        report.supplier_not_found += 1;
        report.ignored += 1;
        report.errors.push({
          reason: 'supplier_not_found',
          firebase_key: mapping.firebase_key,
          fournisseurCode: mapping.fournisseurCode,
          refFournisseur: mapping.refFournisseur,
          plu: mapping.plu,
        });
        continue;
      }

      const article = await findArticle(client, args.storeId, mapping.plu);
      if (!article) {
        report.article_not_found += 1;
        report.ignored += 1;
        report.errors.push({
          reason: 'article_not_found',
          firebase_key: mapping.firebase_key,
          fournisseurCode: mapping.fournisseurCode,
          supplier_id: supplier.id,
          refFournisseur: mapping.refFournisseur,
          plu: mapping.plu,
        });
        continue;
      }

      const existing = await mappingExists(
        client,
        args.storeId,
        supplier.id,
        article.id,
        mapping.refFournisseur,
        columnMap
      );
      if (existing) {
        report.ignored += 1;
        report.errors.push({
          reason: 'duplicate',
          firebase_key: mapping.firebase_key,
          existing_id: existing.id,
          fournisseurCode: mapping.fournisseurCode,
          refFournisseur: mapping.refFournisseur,
          plu: mapping.plu,
        });
        continue;
      }

      if (args.apply) {
        const insert = buildInsert(mapping, args.storeId, supplier, article, columnMap);
        await insertMapping(client, insert);
      }

      report.imported += 1;
    }

    if (args.apply) await client.query('COMMIT');
    else await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  console.log(JSON.stringify(report, null, 2));
  if (args.reportFile) {
    fs.writeFileSync(path.resolve(args.reportFile), `${JSON.stringify(report, null, 2)}\n`);
  }
}

run().catch((error) => {
  console.error('Import AF_MAP impossible:', error);
  process.exit(1);
});