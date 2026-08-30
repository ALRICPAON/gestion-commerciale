const assert = require('assert');
const {
  assertPluAvailable,
  getNextProductPlu,
} = require('../services/articlePluService');
const { createArticle } = require('../services/articleCreationService');

function makeDb(initialArticles = []) {
  const state = {
    articles: initialArticles.map((article, index) => ({
      id: article.id || `article-${index + 1}`,
      store_id: article.store_id || 'store-1',
      plu: String(article.plu),
      designation: article.designation || `Article ${index + 1}`,
      ean: article.ean || null,
      unit: article.unit || 'kg',
      article_category: article.article_category || 'product',
      is_active: article.is_active !== undefined ? article.is_active : true,
    })),
    nextArticleId: 'article-new',
    nextArticleDepartmentId: 'article-dept-new',
    created: null,
  };

  const db = {
    state,
    async query(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim();

      if (compact.includes('generate_series') && compact.includes('product_plu')) {
        const [storeId, min, max] = params;
        const productNumbers = state.articles
          .filter((article) => article.store_id === storeId)
          .filter((article) => (article.article_category || 'product') === 'product')
          .map((article) => (/^\d+$/.test(article.plu) ? Number(article.plu) : null))
          .filter((value) => Number.isInteger(value) && value >= min && value <= max);
        const used = new Set(
          state.articles
            .filter((article) => article.store_id === storeId)
            .map((article) => String(article.plu))
        );
        const start = Math.max((productNumbers.length ? Math.max(...productNumbers) : min - 1) + 1, min);
        for (let candidate = start; candidate <= max; candidate += 1) {
          if (!used.has(String(candidate))) return { rows: [{ plu: String(candidate) }] };
        }
        return { rows: [] };
      }

      if (
        compact.includes('FROM articles')
        && compact.includes('WHERE store_id = $1')
        && compact.includes('AND plu = $2')
      ) {
        return {
          rows: state.articles.filter((article) => (
            article.store_id === params[0]
            && article.plu === params[1]
            && (!compact.includes('AND id <> $3') || article.id !== params[2])
          )).slice(0, 1),
        };
      }

      if (compact.includes('FROM departments') && compact.includes('ORDER BY created_at ASC')) {
        return { rows: [{ id: 'dept-1' }] };
      }

      if (compact.includes('FROM departments') && compact.includes('WHERE id = $1')) {
        return { rows: params[0] === 'dept-1' && params[1] === 'store-1' ? [{ id: 'dept-1' }] : [] };
      }

      if (compact.includes('FROM articles') && compact.includes('lower(trim')) {
        const value = String(params[1] || '').trim().toLowerCase();
        return {
          rows: state.articles.filter((article) => (
            article.store_id === params[0]
            && (
              String(article.plu || '').trim().toLowerCase() === value
              || String(article.ean || '').trim().toLowerCase() === value
              || String(article.designation || '').trim().toLowerCase() === value
            )
          )).slice(0, 1),
        };
      }

      if (compact.includes('FROM department_sectors')) return { rows: [] };

      if (compact.startsWith('INSERT INTO articles')) {
        if (state.articles.some((article) => article.store_id === params[0] && article.plu === params[1])) {
          const error = new Error('duplicate key value violates unique constraint "uq_articles_store_plu"');
          error.code = '23505';
          throw error;
        }
        state.created = {
          id: state.nextArticleId,
          store_id: params[0],
          plu: params[1],
          designation: params[2],
          ean: params[3],
          unit: params[4],
          article_category: params[5],
          is_active: params[6],
          source_origin: params[7],
          storage_temperature_min: params[8],
          storage_temperature_max: params[9],
          storage_instruction: params[10],
        };
        state.articles.push(state.created);
        return { rows: [{ id: state.nextArticleId }] };
      }

      if (compact.startsWith('INSERT INTO article_departments')) {
        state.created.department_id = params[1];
        state.created.department_sector_id = params[2];
        state.created.display_name = params[3];
        state.created.purchase_unit = params[4];
        state.created.stock_unit = params[5];
        state.created.sale_unit = params[6];
        state.created.vat_rate = params[7];
        state.created.purchase_price_ex_vat = params[8];
        state.created.sale_price_ex_vat = params[9];
        state.created.sale_price_inc_vat = params[10];
        return { rows: [{ id: state.nextArticleDepartmentId }] };
      }

      if (compact.startsWith('INSERT INTO article_department_metadata')) {
        return { rows: [] };
      }

      if (compact.includes('FROM articles a') && compact.includes('WHERE a.id = $1')) {
        return {
          rows: state.created && state.created.id === params[0] && state.created.store_id === params[1]
            ? [{ ...state.created, article_department_id: state.nextArticleDepartmentId }]
            : [],
        };
      }

      throw new Error(`Unexpected SQL: ${compact}`);
    },
  };

  return db;
}

async function assertRejectsStatus(fn, status, pattern) {
  try {
    await fn();
  } catch (error) {
    assert.equal(error.status, status);
    if (pattern) assert(pattern.test(error.message), error.message);
    return error;
  }
  throw new Error('Rejet attendu');
}

async function main() {
  assert.equal(await getNextProductPlu(makeDb([{ plu: '3893' }]), 'store-1'), '3894');
  assert.equal(await getNextProductPlu(makeDb([{ plu: '3893' }, { plu: '3894', is_active: false }]), 'store-1'), '3895');
  assert.equal(await getNextProductPlu(makeDb([{ plu: 'ABC' }, { plu: '4999' }, { plu: '2999' }, { plu: '3893' }]), 'store-1'), '3894');
  assert.equal(await getNextProductPlu(makeDb([{ plu: '3999' }]), 'store-1'), null);
  assert.equal(await getNextProductPlu(makeDb([{ plu: '3893' }, { plu: '3894', article_category: 'packaging' }]), 'store-1'), '3895');

  await assertRejectsStatus(
    () => assertPluAvailable(makeDb([{ plu: '3894', is_active: false }]), 'store-1', '3894'),
    409,
    /PLU 3894 deja utilise/
  );

  const manualDb = makeDb([{ plu: '3893' }]);
  const manualCreated = await createArticle(manualDb, {
    storeId: 'store-1',
    userId: 'user-1',
    payload: {
      department_id: 'dept-1',
      plu: '4501',
      designation: 'Article manuel libre',
      ean: '0203163000000',
      article_category: 'product',
    },
  });
  assert.equal(manualCreated.article.plu, '4501');
  assert.equal(manualCreated.article.ean, '0203163000000');

  const conflictError = await assertRejectsStatus(
    () => createArticle(makeDb([{ plu: '3893' }, { plu: '3894', is_active: false }]), {
      storeId: 'store-1',
      userId: 'user-1',
      payload: {
        department_id: 'dept-1',
        plu: '3894',
        designation: 'Course PLU',
        article_category: 'product',
      },
    }),
    409,
    /PLU 3894 deja utilise/
  );
  assert.equal(conflictError.next_plu, '3895');

  console.log(JSON.stringify({
    ok: true,
    next_after_3893: '3894',
    next_after_taken_3894: '3895',
    ean_preserved: manualCreated.article.ean,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
