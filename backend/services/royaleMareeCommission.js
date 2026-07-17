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

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function royaleMareeCommissionAmount(settings = {}) {
  return Math.max(0, parseDecimal(settings.royale_maree_commission_eur_per_kg, 0));
}

function isRoyaleMareeCommissionPricingLevel(pricingLevel) {
  return normalizePricingLevel(pricingLevel) === ROYALE_MAREE_COMMISSION_PRICING_LEVEL;
}

function isRoyaleMareeText(value) {
  return normalizeSearch(value).includes('ROYALE MAREE');
}

function isRoyaleMareeLeclercCircuit(client = null, context = {}) {
  if (context.forceRoyaleMareeCircuit === true) return true;
  if (!client) return context.clientOptionalTargetTariff === ROYALE_MAREE_COMMISSION_PRICING_LEVEL;
  return (
    client.is_royale_maree_member === true
    || client.parent_is_royale_maree_member === true
    || client.billed_is_royale_maree_member === true
    || isRoyaleMareeText(client.name)
    || isRoyaleMareeText(client.legal_name)
    || isRoyaleMareeText(client.code)
    || isRoyaleMareeText(client.parent_client_name)
    || isRoyaleMareeText(client.parent_client_code)
    || isRoyaleMareeText(client.billed_client_name)
    || isRoyaleMareeText(client.billed_client_code)
  );
}

function shouldApplyRoyaleMareeCommission({ pricingLevel, client = null, context = {} } = {}) {
  return (
    isRoyaleMareeCommissionPricingLevel(pricingLevel)
    && isRoyaleMareeLeclercCircuit(client, context)
    && royaleMareeCommissionAmount(context.storeSettings || context.settings || {}) > 0
  );
}

function getCustomerDisplayedPrice({ price, pricingLevel, client = null, storeSettings = {}, context = {} } = {}) {
  if (price === null || price === undefined || price === '') return price;
  const parsedPrice = parseDecimal(price, null);
  if (parsedPrice === null) return price;
  const settings = storeSettings || context.storeSettings || {};
  if (!shouldApplyRoyaleMareeCommission({ pricingLevel, client, context: { ...context, storeSettings: settings } })) {
    return parsedPrice;
  }
  return Number((parsedPrice + royaleMareeCommissionAmount(settings)).toFixed(4));
}

function priceWithRoyaleMareeCommission(price, pricingLevel, settings = {}) {
  return getCustomerDisplayedPrice({
    price,
    pricingLevel,
    storeSettings: settings,
    context: { forceRoyaleMareeCircuit: true },
  });
}

function decorateLineWithDisplayedPrices(line = {}, { client = null, storeSettings = {}, context = {} } = {}) {
  return {
    ...line,
    display_price_ht: getCustomerDisplayedPrice({
      price: line.price_ht,
      pricingLevel: line.tariff_level || context.targetTariffLevel,
      client,
      storeSettings,
      context,
    }),
    display_price_level_1_ht: getCustomerDisplayedPrice({
      price: line.price_level_1_ht,
      pricingLevel: 1,
      client,
      storeSettings,
      context,
    }),
    display_price_level_2_ht: getCustomerDisplayedPrice({
      price: line.price_level_2_ht,
      pricingLevel: 2,
      client,
      storeSettings,
      context,
    }),
    display_price_level_3_ht: getCustomerDisplayedPrice({
      price: line.price_level_3_ht,
      pricingLevel: 3,
      client,
      storeSettings,
      context,
    }),
  };
}

module.exports = {
  ROYALE_MAREE_COMMISSION_PRICING_LEVEL,
  decorateLineWithDisplayedPrices,
  getCustomerDisplayedPrice,
  isRoyaleMareeLeclercCircuit,
  isRoyaleMareeCommissionPricingLevel,
  priceWithRoyaleMareeCommission,
  royaleMareeCommissionAmount,
  shouldApplyRoyaleMareeCommission,
};
