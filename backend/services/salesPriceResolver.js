const pricingService = require('./pricingService');

const clean = (value) => (value === undefined || value === null ? null : String(value).trim() || null);
const num = (value, fallback = 0) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
};

class SalePriceResolutionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.status = 400;
    this.code = details.code || 'SALE_PRICE_REQUIRED';
    this.details = details;
  }
}

function positivePrice(value) {
  const parsed = num(value, 0);
  return parsed > 0 ? parsed : null;
}

function legacyTariffLevel(level) {
  const parsed = Number(level?.legacy_level || level?.tariff_level || level);
  return [1, 2, 3].includes(parsed) ? parsed : 1;
}

function articleFallbackPrice(article = {}, tariffLevel = 1) {
  const level = legacyTariffLevel(tariffLevel);
  const levelField = `sale_price_level_${level}_ht`;
  const levelPrice = positivePrice(article[levelField]);
  if (levelPrice !== null) return { price: levelPrice, field: levelField, tariff_level: level };
  const defaultPrice = positivePrice(article.sale_price_ex_vat);
  if (defaultPrice !== null) return { price: defaultPrice, field: 'sale_price_ex_vat', tariff_level: level };
  return { price: null, field: null, tariff_level: level };
}

function assertPositiveUnitPrice(price, context = {}) {
  if (positivePrice(price) !== null) return;
  throw new SalePriceResolutionError(
    `Prix de vente obligatoire et strictement positif${context.line_number ? ` ligne ${context.line_number}` : ''}`,
    {
      code: 'SALE_PRICE_NON_POSITIVE',
      line_id: context.line_id || null,
      line_number: context.line_number || null,
      article_id: context.article_id || null,
      client_id: context.client_id || null,
      document_id: context.document_id || null,
      source: context.source || null,
      price: price === undefined ? null : price,
    }
  );
}

function pricingTraceForResolution(resolution) {
  if (resolution.source === 'published_pricing') {
    return {
      pricing_session_id: resolution.pricing_session_id,
      pricing_line_id: resolution.pricing_line_id,
      tariff_level_id: resolution.tariff_level_id,
      source_tariff_price_ht: resolution.source_tariff_price_ht,
      royale_maree_commission_ht: resolution.royale_maree_commission_ht,
      final_unit_price_ht: resolution.unit_price_ht,
    };
  }
  if (resolution.source === 'existing_line') {
    return {
      pricing_session_id: resolution.pricing_session_id || null,
      pricing_line_id: resolution.pricing_line_id || null,
      tariff_level_id: resolution.tariff_level_id || null,
      source_tariff_price_ht: resolution.source_tariff_price_ht ?? null,
      royale_maree_commission_ht: resolution.royale_maree_commission_ht ?? null,
      final_unit_price_ht: resolution.final_unit_price_ht ?? resolution.unit_price_ht,
    };
  }
  return {
    pricing_session_id: null,
    pricing_line_id: null,
    tariff_level_id: null,
    source_tariff_price_ht: null,
    royale_maree_commission_ht: null,
    final_unit_price_ht: resolution.unit_price_ht,
  };
}

function inventoryPriceTrace(resolution) {
  return {
    price_resolution: {
      source: resolution.source,
      resolved_at: new Date().toISOString(),
      tariff_level: resolution.tariff_level || null,
      fallback_field: resolution.fallback_field || null,
      pricing_session_id: resolution.pricing_session_id || null,
      pricing_line_id: resolution.pricing_line_id || null,
      tariff_level_id: resolution.tariff_level_id || null,
      source_tariff_price_ht: resolution.source_tariff_price_ht ?? null,
      royale_maree_commission_ht: resolution.royale_maree_commission_ht ?? null,
      final_unit_price_ht: resolution.unit_price_ht,
    },
  };
}

async function resolveSalesLinePrice(db, storeId, input = {}, deps = {}) {
  const resolvePublishedPrice = deps.resolvePublishedPrice || pricingService.resolvePublishedPrice;
  const article = input.article || {};
  const articleId = clean(input.article_id || article.id);
  const clientId = clean(input.client_id);
  const existingLine = input.existing_line || null;
  const oldArticleId = clean(existingLine?.article_id);
  const sameArticle = existingLine && oldArticleId && articleId && oldArticleId === articleId;
  const existingPrice = positivePrice(existingLine?.unit_sale_price_ht);

  if (input.preserve_existing !== false && sameArticle && existingPrice !== null && input.force_reprice !== true) {
    return {
      source: 'existing_line',
      unit_price_ht: existingPrice,
      tariff_level: legacyTariffLevel(input.tariff_level || existingLine.tariff_level_snapshot || 1),
      pricing_session_id: existingLine.pricing_session_id || null,
      pricing_line_id: existingLine.pricing_line_id || null,
      tariff_level_id: existingLine.tariff_level_id || null,
      source_tariff_price_ht: existingLine.source_tariff_price_ht ?? null,
      royale_maree_commission_ht: existingLine.royale_maree_commission_ht ?? null,
      final_unit_price_ht: existingLine.final_unit_price_ht ?? existingPrice,
    };
  }

  const published = await resolvePublishedPrice(db, storeId, {
    client_id: clientId,
    article_id: articleId,
    date: input.date || input.document_date,
  });
  const tariffLevel = legacyTariffLevel(published?.tariff_level || input.tariff_level || 1);

  if (published?.found) {
    assertPositiveUnitPrice(published.final_unit_price_ht, {
      source: 'published_pricing',
      article_id: articleId,
      client_id: clientId,
      line_id: existingLine?.id,
      line_number: existingLine?.line_number,
      document_id: existingLine?.sales_document_id || input.document_id,
    });
    return {
      source: 'published_pricing',
      unit_price_ht: num(published.final_unit_price_ht),
      tariff_level: tariffLevel,
      pricing_session_id: published.pricing_session_id,
      pricing_line_id: published.pricing_line_id,
      tariff_level_id: published.tariff_level_id,
      source_tariff_price_ht: published.source_tariff_price_ht,
      royale_maree_commission_ht: published.royale_maree_commission_ht,
      final_unit_price_ht: published.final_unit_price_ht,
    };
  }

  const fallback = articleFallbackPrice(article, tariffLevel);
  if (fallback.price !== null) {
    return {
      source: 'article_fallback',
      unit_price_ht: fallback.price,
      tariff_level: tariffLevel,
      fallback_field: fallback.field,
      final_unit_price_ht: fallback.price,
    };
  }

  throw new SalePriceResolutionError(
    `Aucun prix de vente strictement positif trouve${input.context_label ? ` pour ${input.context_label}` : ''}`,
    {
      code: 'SALE_PRICE_MISSING',
      article_id: articleId,
      client_id: clientId,
      line_id: existingLine?.id || null,
      line_number: existingLine?.line_number || null,
      document_id: existingLine?.sales_document_id || input.document_id || null,
      tariff_level: tariffLevel,
    }
  );
}

async function assertDocumentLinePricesPositive(db, storeId, documentId) {
  const result = await db.query(
    `SELECT id, line_number, article_id, unit_sale_price_ht, sales_document_id
     FROM sales_lines
     WHERE store_id = $1 AND sales_document_id = $2
       AND COALESCE(sold_quantity, total_weight, 0) > 0
       AND COALESCE(unit_sale_price_ht, 0) <= 0
     ORDER BY line_number
     LIMIT 1`,
    [storeId, documentId]
  );
  if (result.rows.length) {
    const line = result.rows[0];
    assertPositiveUnitPrice(line.unit_sale_price_ht, {
      source: 'document_validation',
      line_id: line.id,
      line_number: line.line_number,
      article_id: line.article_id,
      document_id: documentId,
    });
  }
}

module.exports = {
  SalePriceResolutionError,
  articleFallbackPrice,
  assertDocumentLinePricesPositive,
  assertPositiveUnitPrice,
  inventoryPriceTrace,
  pricingTraceForResolution,
  resolveSalesLinePrice,
};
