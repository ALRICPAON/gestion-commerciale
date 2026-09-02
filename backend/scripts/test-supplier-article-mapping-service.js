const assert = require('assert');

const mappings = require('../services/supplierArticleMappingService');

const STORE_A = '00000000-0000-0000-0000-00000000000a';
const STORE_B = '00000000-0000-0000-0000-00000000000b';
const SUPPLIER = '10000000-0000-0000-0000-000000000001';
const ARTICLE_1 = '20000000-0000-0000-0000-000000000001';
const ARTICLE_2 = '20000000-0000-0000-0000-000000000002';
const USER = '30000000-0000-0000-0000-000000000001';

function normRef(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function rowWithJoins(db, row) {
  const supplier = db.suppliers.find((item) => item.id === row.supplier_id && item.store_id === row.store_id);
  const article = db.articles.find((item) => item.id === row.article_id && item.store_id === row.store_id);
  return {
    ...row,
    supplier_code: supplier?.code,
    supplier_name: supplier?.name,
    article_plu: article?.plu,
    article_designation: article?.designation,
    article_name: article?.designation,
  };
}

function createFakeDb() {
  return {
    nextId: 1,
    suppliers: [
      { id: SUPPLIER, store_id: STORE_A, code: '10003', name: 'SOGELMER' },
      { id: SUPPLIER, store_id: STORE_B, code: '10003', name: 'SOGELMER autre store' },
    ],
    articles: [
      { id: ARTICLE_1, store_id: STORE_A, plu: '1001', designation: 'FILET JULIENNE' },
      { id: ARTICLE_2, store_id: STORE_A, plu: '1002', designation: 'QUEUE LOTTE' },
      { id: ARTICLE_1, store_id: STORE_B, plu: '9001', designation: 'AUTRE STORE' },
    ],
    mappings: [],
    async query(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      if (/^(CREATE|ALTER)\b/i.test(compact)) return { rows: [] };
      if (compact.startsWith('DO $$')) return { rows: [] };
      if (compact.startsWith('UPDATE supplier_article_mappings SET supplier_designation_original')) return { rows: [] };
      if (compact.startsWith('SELECT id, code, name FROM suppliers')) {
        return { rows: this.suppliers.filter((row) => row.id === params[0] && row.store_id === params[1]).slice(0, 1) };
      }
      if (compact.startsWith('SELECT id, plu, designation FROM articles WHERE id')) {
        return { rows: this.articles.filter((row) => row.id === params[0] && row.store_id === params[1]).slice(0, 1) };
      }
      if (compact.startsWith('SELECT id, plu, designation FROM articles WHERE store_id')) {
        return { rows: this.articles.filter((row) => row.store_id === params[0] && row.plu === params[1]).slice(0, 1) };
      }
      if (compact.startsWith('SELECT id, COALESCE(is_active, true) is_active FROM supplier_article_mappings')) {
        const [storeId, supplierId, supplierRef, normalized] = params;
        const rows = this.mappings
          .filter((row) => row.store_id === storeId && row.supplier_id === supplierId)
          .filter((row) => (supplierRef && row.supplier_ref.trim().toLowerCase() === supplierRef.trim().toLowerCase()) || (normalized && row.supplier_designation_normalized === normalized))
          .sort((a, b) => Number(Boolean(b.is_active)) - Number(Boolean(a.is_active)));
        return { rows: rows.slice(0, 1).map((row) => ({ id: row.id, is_active: row.is_active !== false })) };
      }
      if (compact.startsWith('INSERT INTO supplier_article_mappings')) {
        const id = `40000000-0000-0000-0000-${String(this.nextId++).padStart(12, '0')}`;
        const row = {
          id,
          store_id: params[0],
          client_key: params[1],
          supplier_id: params[2],
          article_id: params[3],
          supplier_ref: params[4],
          supplier_label: params[5],
          purchase_unit: params[6],
          price_unit: params[7],
          supplier_designation_original: params[8],
          supplier_designation_normalized: params[9],
          mapping_source: params[10],
          confidence_score: params[11],
          is_active: true,
          created_by: params[12],
          updated_by: params[12],
        };
        const conflict = this.mappings.find((existing) => existing.store_id === row.store_id && existing.supplier_id === row.supplier_id && existing.is_active !== false && existing.supplier_ref === row.supplier_ref);
        if (conflict) {
          const error = new Error('duplicate');
          error.code = '23505';
          throw error;
        }
        this.mappings.push(row);
        return { rows: [{ id }] };
      }
      if (compact.startsWith('UPDATE supplier_article_mappings SET article_id')) {
        const row = this.mappings.find((item) => item.id === params[13] && item.store_id === params[0] && item.supplier_id === params[1]);
        if (row) {
          Object.assign(row, {
            article_id: params[2],
            supplier_ref: params[3],
            supplier_label: params[4],
            purchase_unit: params[5],
            price_unit: params[6],
            supplier_designation_original: params[7],
            supplier_designation_normalized: params[8],
            mapping_source: params[9],
            confidence_score: params[10],
            is_active: true,
            client_key: params[11] || row.client_key,
            updated_by: params[12],
          });
        }
        return { rows: [] };
      }
      if (compact.startsWith('UPDATE supplier_article_mappings SET is_active = false')) {
        const [storeId, supplierId, supplierRef, normalized, keepId] = params;
        this.mappings.forEach((row) => {
          if (
            row.store_id === storeId &&
            row.supplier_id === supplierId &&
            row.id !== keepId &&
            row.is_active !== false &&
            ((supplierRef && row.supplier_ref.trim().toLowerCase() === supplierRef.trim().toLowerCase()) || (normalized && row.supplier_designation_normalized === normalized))
          ) {
            row.is_active = false;
          }
        });
        return { rows: [] };
      }
      if (compact.startsWith('UPDATE supplier_article_mappings SET is_active = $1')) {
        const row = this.mappings.find((item) => item.id === params[1] && item.store_id === params[2]);
        if (!row) return { rows: [] };
        row.is_active = params[0];
        row.updated_by = params[3];
        return { rows: [{ id: row.id }] };
      }
      if (compact.startsWith('SELECT sam.*, s.code supplier_code')) {
        if (compact.includes('sam.id = $2')) {
          const row = this.mappings.find((item) => item.store_id === params[0] && item.id === params[1]);
          return { rows: row ? [rowWithJoins(this, row)] : [] };
        }
        if (compact.includes("regexp_replace(UPPER(TRIM(COALESCE(sam.supplier_ref") || compact.includes('sam.supplier_designation_normalized = $4')) {
          const [storeId, supplierId, supplierRef, normalized] = params;
          const rows = this.mappings
            .filter((row) => row.store_id === storeId && row.supplier_id === supplierId && row.is_active !== false)
            .filter((row) => (supplierRef && normRef(row.supplier_ref) === normRef(supplierRef)) || (normalized && row.supplier_designation_normalized === normalized));
          return { rows: rows.slice(0, 1).map((row) => rowWithJoins(this, row)) };
        }
        const storeId = params[0];
        return { rows: this.mappings.filter((row) => row.store_id === storeId).map((row) => rowWithJoins(this, row)) };
      }
      throw new Error(`Unhandled SQL in fake DB: ${compact}`);
    },
  };
}

async function run() {
  const db = createFakeDb();

  const created = await mappings.upsertSupplierArticleMapping(db, STORE_A, {
    supplier_id: SUPPLIER,
    article_id: ARTICLE_1,
    supplier_ref: 'FILJUL58',
    supplier_label: 'FILET JULIENNE 5/800 GR 3 KG',
    purchase_unit: 'kg',
    price_unit: 'kg',
  }, { user_id: USER });
  assert.strictEqual(created.supplier_ref, 'FILJUL58');
  assert.strictEqual(created.article_plu, '1001');

  const updated = await mappings.upsertSupplierArticleMapping(db, STORE_A, {
    supplier_id: SUPPLIER,
    article_id: ARTICLE_2,
    supplier_ref: 'FILJUL58',
    supplier_label: 'FILET JULIENNE UPDATED',
  }, { user_id: USER });
  assert.strictEqual(updated.id, created.id);
  assert.strictEqual(updated.article_id, ARTICLE_2);
  assert.strictEqual(db.mappings.length, 1);

  await mappings.setSupplierArticleMappingStatus(db, STORE_A, created.id, false, { user_id: USER });
  assert.strictEqual(db.mappings[0].is_active, false);

  const reactivated = await mappings.upsertSupplierArticleMapping(db, STORE_A, {
    supplier_id: SUPPLIER,
    article_id: ARTICLE_1,
    supplier_ref: 'FILJUL58',
    supplier_label: 'FILET JULIENNE REACTIVE',
  }, { user_id: USER });
  assert.strictEqual(reactivated.id, created.id);
  assert.strictEqual(reactivated.is_active, true);

  const otherStore = await mappings.upsertSupplierArticleMapping(db, STORE_B, {
    supplier_id: SUPPLIER,
    article_id: ARTICLE_1,
    supplier_ref: 'FILJUL58',
    supplier_label: 'AUTRE STORE',
  }, { user_id: USER });
  assert.notStrictEqual(otherStore.id, created.id);
  assert.strictEqual(db.mappings.filter((row) => row.supplier_ref === 'FILJUL58').length, 2);

  const slash = await mappings.upsertSupplierArticleMapping(db, STORE_A, {
    supplier_id: SUPPLIER,
    article_id: ARTICLE_2,
    supplier_ref: 'QLO2500/',
    supplier_label: 'QUEUE LOTTE 200/500 GR 3 KG',
  }, { user_id: USER });
  assert.strictEqual(slash.supplier_ref, 'QLO2500/');

  const byRef = await mappings.lookupSupplierArticleMapping(db, STORE_A, {
    supplier_id: SUPPLIER,
    supplier_ref: 'QLO2500/',
  });
  assert.strictEqual(byRef.article_id, ARTICLE_2);

  const byNormalizedDesignation = await mappings.lookupSupplierArticleMapping(db, STORE_A, {
    supplier_id: SUPPLIER,
    supplier_designation_original: 'QUEUE LOTTE 200/500 GR 3 KG',
  });
  assert.strictEqual(byNormalizedDesignation.article_id, ARTICLE_2);

  const listed = await mappings.searchSupplierArticleMappings(db, STORE_A, { status: 'all' });
  assert.strictEqual(listed.results.length, 2);

  console.log('OK test-supplier-article-mapping-service');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
