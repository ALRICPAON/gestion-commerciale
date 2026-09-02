const assert = require('assert');
const fs = require('fs');
const path = require('path');

const resolver = require('../services/salesPriceResolver');

const storeId = 'store-1';
const article = {
  id: 'article-1',
  designation: 'Bar',
  sale_price_level_1_ht: 8,
  sale_price_level_2_ht: 9,
  sale_price_level_3_ht: 10,
  sale_price_ex_vat: 7,
};

function depsWith(result) {
  return { resolvePublishedPrice: async () => result };
}

async function resolve(input, published) {
  return resolver.resolveSalesLinePrice({}, storeId, {
    client_id: 'client-1',
    article,
    article_id: article.id,
    document_date: '2026-09-02',
    preserve_existing: false,
    ...input,
  }, depsWith(published));
}

(async () => {
  const publishedLevel2 = {
    found: true,
    tariff_level: { legacy_level: 2 },
    pricing_session_id: 'session-1',
    pricing_line_id: 'pline-1',
    tariff_level_id: 'level-2',
    source_tariff_price_ht: 12,
    royale_maree_commission_ht: 0,
    final_unit_price_ht: 12,
  };

  const publishedWins = await resolve({}, publishedLevel2);
  assert.strictEqual(publishedWins.source, 'published_pricing');
  assert.strictEqual(publishedWins.unit_price_ht, 12);

  const frontendOldPriceIgnored = await resolve({ suggested_unit_sale_price_ht: 4 }, publishedLevel2);
  assert.strictEqual(frontendOldPriceIgnored.unit_price_ht, 12);

  const fallback = await resolve({}, { found: false, tariff_level: { legacy_level: 3 } });
  assert.strictEqual(fallback.source, 'article_fallback');
  assert.strictEqual(fallback.unit_price_ht, 10);
  assert.strictEqual(fallback.fallback_field, 'sale_price_level_3_ht');

  await assert.rejects(
    () => resolve({ article: { id: 'article-2' }, article_id: 'article-2' }, { found: false, tariff_level: { legacy_level: 1 } }),
    /Aucun prix de vente strictement positif/
  );

  await assert.rejects(
    () => resolve({ article: { id: 'article-3', sale_price_level_1_ht: 0, sale_price_ex_vat: 0 }, article_id: 'article-3' }, { found: false, tariff_level: { legacy_level: 1 } }),
    /Aucun prix de vente strictement positif/
  );

  await assert.rejects(
    () => resolve({}, { ...publishedLevel2, final_unit_price_ht: 0 }),
    /Prix de vente obligatoire et strictement positif/
  );

  const frozen = await resolver.resolveSalesLinePrice({}, storeId, {
    client_id: 'client-1',
    article,
    article_id: article.id,
    existing_line: { id: 'line-1', article_id: article.id, unit_sale_price_ht: 6.5 },
  }, depsWith(publishedLevel2));
  assert.strictEqual(frozen.source, 'existing_line');
  assert.strictEqual(frozen.unit_price_ht, 6.5);

  const level1 = await resolve({}, { found: false, tariff_level: { legacy_level: 1 } });
  const level2 = await resolve({}, { found: false, tariff_level: { legacy_level: 2 } });
  const level3 = await resolve({}, { found: false, tariff_level: { legacy_level: 3 } });
  assert.deepStrictEqual([level1.unit_price_ht, level2.unit_price_ht, level3.unit_price_ht], [8, 9, 10]);

  await assert.rejects(
    () => resolver.assertDocumentLinePricesPositive({
      query: async () => ({ rows: [{ id: 'line-zero', line_number: 11, article_id: 'article-1', unit_sale_price_ht: 0 }] }),
    }, storeId, 'doc-1'),
    /Prix de vente obligatoire et strictement positif/
  );

  const root = path.resolve(__dirname, '..');
  const deliveryNotes = fs.readFileSync(path.join(root, 'routes', 'deliveryNotes.js'), 'utf8');
  const forced = fs.readFileSync(path.join(root, 'routes', 'deliveryNoteValidationForced.js'), 'utf8');
  const editable = fs.readFileSync(path.join(root, 'routes', 'deliveryNotesEditable.js'), 'utf8');
  const quickOrder = fs.readFileSync(path.join(root, 'routes', 'quickOrderSheets.js'), 'utf8');

  assert(deliveryNotes.includes('pricing_session_id, pricing_line_id, tariff_level_id'), 'commande -> BL doit copier la provenance prix');
  assert(forced.includes('pricing_session_id, pricing_line_id, tariff_level_id'), 'commande -> BL force doit copier la provenance prix');
  assert(editable.includes('resolveSalesLinePrice'), 'BL direct doit utiliser le resolver');
  assert(quickOrder.includes('resolveSalesLinePrice'), 'generation fiche appel doit utiliser le resolver');
  assert(quickOrder.includes('sale_price_level_3_ht'), 'fiche appel doit charger les niveaux tarifaires article pour fallback');

  console.log('OK sales price resolver PR1');
})();
