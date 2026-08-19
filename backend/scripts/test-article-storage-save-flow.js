const assert = require('assert');

const router = require('../routes/articlesStoreLevel');

function findRouteHandler(method, routePath) {
  const layer = router.stack.find((item) => item.route?.path === routePath && item.route.methods[method]);
  assert(layer, `${method.toUpperCase()} ${routePath} introuvable`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createFakeDb(article) {
  const client = {
    async query(sql, params = []) {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql)) return { rows: [] };

      if (/UPDATE articles/i.test(sql)) {
        assert(sql.includes('article_category = $5'), 'PATCH actif doit persister article_category sans decalage SQL');
        article.plu = params[0];
        article.designation = params[1];
        article.ean = params[2];
        article.unit = params[3];
        article.article_category = params[4];
        article.is_active = params[5];
        article.family_code = params[6];
        article.family_name = params[7];
        article.display_name = params[8];
        article.purchase_unit = params[9];
        article.stock_unit = params[10];
        article.sale_unit = params[11];
        article.vat_rate = params[12];
        article.purchase_price_ex_vat = params[13];
        article.sale_price_ex_vat = params[14];
        article.sale_price_inc_vat = params[15];
        article.production_method = params[16];
        article.latin_name = params[17];
        article.fao_zone = params[18];
        article.sous_zone = params[19];
        article.fishing_gear = params[20];
        article.allergens = params[21];
        article.storage_temperature_min = params[22];
        article.storage_temperature_max = params[23];
        article.storage_instruction = params[24];
        return { rows: [{ id: article.id }] };
      }

      throw new Error(`Requete client inattendue: ${sql}`);
    },
    release() {},
  };

  return {
    async connect() {
      return client;
    },
    async query(sql) {
      assert(sql.includes("COALESCE(a.article_category, 'product') AS article_category"), 'GET actif doit relire article_category');
      return { rows: [{ ...article }] };
    },
  };
}

async function patchAndReload(article, payload) {
  const dbPool = createFakeDb(article);
  const patchHandler = findRouteHandler('patch', '/:id');
  const getHandler = findRouteHandler('get', '/:id');

  const patchRes = createResponse();
  await patchHandler({
    params: { id: article.id },
    body: payload,
    user: { id: 'user-1', store_id: article.store_id },
    dbPool,
  }, patchRes);

  assert.strictEqual(patchRes.statusCode, 200, patchRes.body?.error || 'PATCH doit reussir');

  const getRes = createResponse();
  await getHandler({
    params: { id: article.id },
    user: { store_id: article.store_id },
    dbPool,
  }, getRes);

  assert.strictEqual(getRes.statusCode, 200, getRes.body?.error || 'GET doit reussir');
  return getRes.body;
}

function fullPayload(article, overrides = {}) {
  return {
    plu: article.plu,
    designation: article.designation,
    ean: article.ean,
    unit: article.unit,
    article_category: article.article_category,
    is_active: article.is_active,
    family_code: article.family_code || '',
    family_name: article.family_name || '',
    display_name: article.display_name || '',
    purchase_unit: article.purchase_unit || '',
    stock_unit: article.stock_unit || '',
    sale_unit: article.sale_unit || '',
    vat_rate: article.vat_rate,
    purchase_price_ex_vat: article.purchase_price_ex_vat,
    sale_price_ex_vat: article.sale_price_ex_vat,
    sale_price_inc_vat: article.sale_price_inc_vat,
    category: article.production_method || '',
    latin_name: article.latin_name || '',
    fao_zone: article.fao_zone || '',
    sous_zone: article.sous_zone || '',
    engin: article.fishing_gear || '',
    allergenes: article.allergens || '',
    storage_temperature_min: article.storage_temperature_min,
    storage_temperature_max: article.storage_temperature_max,
    storage_instruction: article.storage_instruction || '',
    ...overrides,
  };
}

async function main() {
  const article = {
    id: '11111111-1111-4111-8111-111111111111',
    store_id: '22222222-2222-4222-8222-222222222222',
    plu: '1234',
    designation: 'Langoustine vivante',
    ean: null,
    unit: 'kg',
    article_category: 'packaging',
    is_active: true,
    family_code: null,
    family_name: null,
    display_name: null,
    purchase_unit: 'kg',
    stock_unit: 'kg',
    sale_unit: 'kg',
    vat_rate: 5.5,
    purchase_price_ex_vat: 8,
    sale_price_ex_vat: 12,
    sale_price_inc_vat: 12.66,
    production_method: 'Peche',
    latin_name: 'Nephrops norvegicus',
    fao_zone: '27',
    sous_zone: 'VIII',
    fishing_gear: 'Casiers',
    allergens: 'Crustaces',
    storage_temperature_min: null,
    storage_temperature_max: null,
    storage_instruction: null,
  };

  const savedStorage = await patchAndReload(article, fullPayload(article, {
    storage_temperature_min: 3,
    storage_temperature_max: 5,
    storage_instruction: 'Ce produit doit etre vendu vivant',
  }));
  assert.strictEqual(savedStorage.article_category, 'packaging', 'categorie doit rester inchangee apres conservation 3/5');
  assert.strictEqual(savedStorage.storage_temperature_min, 3);
  assert.strictEqual(savedStorage.storage_temperature_max, 5);
  assert.strictEqual(savedStorage.storage_instruction, 'Ce produit doit etre vendu vivant');

  const savedZero = await patchAndReload(article, fullPayload(article, {
    storage_temperature_min: 0,
    storage_temperature_max: 2,
    storage_instruction: '',
  }));
  assert.strictEqual(savedZero.article_category, 'packaging', 'categorie doit rester inchangee apres conservation 0/2');
  assert.strictEqual(savedZero.storage_temperature_min, 0, '0 doit rester persiste');
  assert.strictEqual(savedZero.storage_temperature_max, 2);
  assert.strictEqual(savedZero.storage_instruction, null);

  const savedMixed = await patchAndReload(article, fullPayload(article, {
    designation: 'Langoustine vivante extra',
    storage_temperature_min: 3,
    storage_temperature_max: 5,
    storage_instruction: 'Ce produit doit etre vendu vivant',
  }));
  assert.strictEqual(savedMixed.article_category, 'packaging', 'categorie doit rester inchangee avec autre champ modifie');
  assert.strictEqual(savedMixed.designation, 'Langoustine vivante extra');
  assert.strictEqual(savedMixed.storage_temperature_min, 3);
  assert.strictEqual(savedMixed.storage_temperature_max, 5);
  assert.strictEqual(savedMixed.storage_instruction, 'Ce produit doit etre vendu vivant');

  console.log('article storage save flow tests ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
