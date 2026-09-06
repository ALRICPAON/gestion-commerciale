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

  const manualBeatsPublished = await resolve(
    { allow_manual_input: true, manual_price_override: true, manual_unit_price_ht: 22.9 },
    { ...publishedLevel2, final_unit_price_ht: 32, source_tariff_price_ht: 32 }
  );
  assert.strictEqual(manualBeatsPublished.source, 'manual_direct_entry');
  assert.strictEqual(manualBeatsPublished.unit_price_ht, 22.9);

  const negoceManualOverride = await resolve(
    { allow_manual_input: true, manual_price_override: true, manual_unit_price_ht: 24.5 },
    { ...publishedLevel2, final_unit_price_ht: 21.9, source_tariff_price_ht: 21.9 }
  );
  assert.strictEqual(negoceManualOverride.source, 'manual_direct_entry');
  assert.strictEqual(negoceManualOverride.unit_price_ht, 24.5);

  const publishedWithoutManualOverride = await resolve(
    { allow_manual_input: true, manual_price_override: false, manual_unit_price_ht: 22.9 },
    { ...publishedLevel2, final_unit_price_ht: 21.9, source_tariff_price_ht: 21.9 }
  );
  assert.strictEqual(publishedWithoutManualOverride.source, 'published_pricing');
  assert.strictEqual(publishedWithoutManualOverride.unit_price_ht, 21.9);

  const manualWithoutPublished = await resolve(
    {
      allow_manual_input: true,
      manual_price_override: true,
      manual_unit_price_ht: 29,
      article: { id: 'article-manual', designation: 'Homard', sale_price_level_1_ht: 0, sale_price_ex_vat: 0 },
      article_id: 'article-manual',
    },
    { found: false, tariff_level: { legacy_level: 1 } }
  );
  assert.strictEqual(manualWithoutPublished.source, 'manual_direct_entry');
  assert.strictEqual(manualWithoutPublished.unit_price_ht, 29);
  assert.strictEqual(resolver.inventoryPriceTrace(manualWithoutPublished).price_resolution.source, 'manual_direct_entry');

  const manualBeatsArticleFallback = await resolve(
    {
      allow_manual_input: true,
      manual_price_override: true,
      manual_unit_price_ht: 29,
      article: { id: 'article-manual-fallback', designation: 'Homard', sale_price_level_1_ht: 31, sale_price_ex_vat: 0 },
      article_id: 'article-manual-fallback',
    },
    { found: false, tariff_level: { legacy_level: 1 } }
  );
  assert.strictEqual(manualBeatsArticleFallback.source, 'manual_direct_entry');
  assert.strictEqual(manualBeatsArticleFallback.unit_price_ht, 29);

  const zeroManualFallsBackToArticle = await resolve(
    {
      allow_manual_input: true,
      manual_price_override: true,
      manual_unit_price_ht: 0,
      article: { id: 'article-fallback', designation: 'Homard', sale_price_level_1_ht: 31, sale_price_ex_vat: 0 },
      article_id: 'article-fallback',
    },
    { found: false, tariff_level: { legacy_level: 1 } }
  );
  assert.strictEqual(zeroManualFallsBackToArticle.source, 'article_fallback');
  assert.strictEqual(zeroManualFallsBackToArticle.unit_price_ht, 31);

  await assert.rejects(
    () => resolve(
      {
        allow_manual_input: true,
        manual_price_override: true,
        manual_unit_price_ht: 0,
        article: { id: 'article-no-price', designation: 'Homard', sale_price_level_1_ht: 0, sale_price_ex_vat: 0 },
        article_id: 'article-no-price',
      },
      { found: false, tariff_level: { legacy_level: 1 } }
    ),
    (error) => error.code === 'SALE_PRICE_MISSING'
  );

  const arbitraryPriceIgnoredWithoutManualContext = await resolve(
    {
      allow_manual_input: false,
      manual_price_override: true,
      manual_unit_price_ht: 29,
      article: { id: 'article-no-manual', designation: 'Homard', sale_price_level_1_ht: 31, sale_price_ex_vat: 0 },
      article_id: 'article-no-manual',
    },
    { found: false, tariff_level: { legacy_level: 1 } }
  );
  assert.strictEqual(arbitraryPriceIgnoredWithoutManualContext.source, 'article_fallback');
  assert.strictEqual(arbitraryPriceIgnoredWithoutManualContext.unit_price_ht, 31);

  const quickOrderArbitraryPriceCannotBypassPublished = await resolve(
    {
      allow_manual_input: false,
      manual_price_override: true,
      manual_unit_price_ht: 99,
    },
    { ...publishedLevel2, final_unit_price_ht: 21.9, source_tariff_price_ht: 21.9 }
  );
  assert.strictEqual(quickOrderArbitraryPriceCannotBypassPublished.source, 'published_pricing');
  assert.strictEqual(quickOrderArbitraryPriceCannotBypassPublished.unit_price_ht, 21.9);

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

  const explicitOverrideBeatsFrozenExistingLine = await resolver.resolveSalesLinePrice({}, storeId, {
    client_id: 'client-1',
    article,
    article_id: article.id,
    manual_unit_price_ht: 22.9,
    manual_price_override: true,
    allow_manual_input: true,
    existing_line: { id: 'line-1', article_id: article.id, unit_sale_price_ht: 21.9 },
  }, depsWith(publishedLevel2));
  assert.strictEqual(explicitOverrideBeatsFrozenExistingLine.source, 'manual_direct_entry');
  assert.strictEqual(explicitOverrideBeatsFrozenExistingLine.unit_price_ht, 22.9);

  const changedArticleReprices = await resolver.resolveSalesLinePrice({}, storeId, {
    client_id: 'client-1',
    article: { id: 'article-2', designation: 'Sole', sale_price_level_1_ht: 0, sale_price_ex_vat: 0 },
    article_id: 'article-2',
    manual_unit_price_ht: 29,
    manual_price_override: false,
    allow_manual_input: true,
    existing_line: { id: 'line-1', article_id: article.id, unit_sale_price_ht: 6.5 },
  }, depsWith({ ...publishedLevel2, final_unit_price_ht: 35, source_tariff_price_ht: 35 }));
  assert.strictEqual(changedArticleReprices.source, 'published_pricing');
  assert.strictEqual(changedArticleReprices.unit_price_ht, 35);

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
  const sales = fs.readFileSync(path.join(root, 'routes', 'sales.js'), 'utf8');
  const saleDetail = fs.readFileSync(path.join(root, '..', 'frontend', 'js', 'sale-detail.js'), 'utf8');

  assert(deliveryNotes.includes('pricing_session_id, pricing_line_id, tariff_level_id'), 'commande -> BL doit copier la provenance prix');
  assert(forced.includes('pricing_session_id, pricing_line_id, tariff_level_id'), 'commande -> BL force doit copier la provenance prix');
  assert(editable.includes('resolveSalesLinePrice'), 'BL direct doit utiliser le resolver');
  assert(quickOrder.includes('resolveSalesLinePrice'), 'generation fiche appel doit utiliser le resolver');
  assert(quickOrder.includes('sale_price_level_3_ht'), 'fiche appel doit charger les niveaux tarifaires article pour fallback');
  assert(sales.includes('allow_manual_input:allowsDirectManualPrice(line)'), 'commande directe doit autoriser explicitement le prix manuel');
  assert(sales.includes("line?.document_type==='ORDER'&&['manual','negoce'].includes(clean(line?.document_origin)||'manual')"), 'autorisation prix manuel doit dependre de la provenance document conservee');
  assert(sales.includes('manual_price_override:body.manual_price_override===true'), 'commande directe doit exiger un override manuel explicite');
  assert(sales.includes('manual_unit_price_ht:body.unit_sale_price_ht'), 'commande directe doit passer le prix manuel saisi au resolver');
  assert(sales.includes("Modification origine interdite"), 'PATCH document doit refuser un changement de provenance');
  assert(!sales.includes('origin=COALESCE'), 'PATCH document ne doit plus modifier sales_documents.origin');
  assert(!quickOrder.includes('allow_manual_input:true'), 'fiche appel ne doit pas autoriser le prix manuel arbitraire');
  assert(!editable.includes('allow_manual_input:true'), 'BL editable ne doit pas autoriser le prix manuel arbitraire');
  assert(saleDetail.includes("row.dataset.manualPriceOverride = 'false'"), 'selection article doit remettre override prix a false');
  assert(saleDetail.includes("manual_price_override: row.dataset.manualPriceOverride === 'true'"), 'saveLine doit envoyer le marqueur override explicite');
  assert(saleDetail.includes("e.target.classList.contains('line-unit-price-ht')) row.dataset.manualPriceOverride = 'true'"), 'saisie prix utilisateur doit activer override');
  assert(!saleDetail.includes("origin: isNegoce() ? 'negoce' : (sale?.origin || 'manual')"), 'sauvegarde entete front ne doit pas reecrire origin');

  console.log('OK sales price resolver PR1');
})();
