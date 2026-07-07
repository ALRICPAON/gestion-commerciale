const ROYALE_MAREE_COMMISSION_PRICING_LEVEL = 1;

function parseDecimal(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePricingLevel(value) {
  const parsed = Number(value);
  return [1, 2, 3].includes(parsed) ? parsed : null;
}

function royaleMareeCommissionAmount(settings = {}) {
  return Math.max(0, parseDecimal(settings.royale_maree_commission_eur_per_kg, 0));
}

function isRoyaleMareeCommissionPricingLevel(pricingLevel) {
  return normalizePricingLevel(pricingLevel) === ROYALE_MAREE_COMMISSION_PRICING_LEVEL;
}

function priceWithRoyaleMareeCommission(price, pricingLevel, settings = {}) {
  if (price === null || price === undefined || price === '') return price;
  const parsedPrice = parseDecimal(price, null);
  if (parsedPrice === null) return price;
  if (!isRoyaleMareeCommissionPricingLevel(pricingLevel)) return parsedPrice;
  return parsedPrice + royaleMareeCommissionAmount(settings);
}

module.exports = {
  ROYALE_MAREE_COMMISSION_PRICING_LEVEL,
  isRoyaleMareeCommissionPricingLevel,
  priceWithRoyaleMareeCommission,
  royaleMareeCommissionAmount,
};
