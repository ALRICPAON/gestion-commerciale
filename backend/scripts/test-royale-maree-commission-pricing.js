const assert = require('assert/strict');

const {
  decorateLineWithDisplayedPrices,
  getCustomerDisplayedPrice,
} = require('../services/royaleMareeCommission');

const settings = { royale_maree_commission_eur_per_kg: '0.50' };
const leclercClient = { name: 'LECLERC TEST', is_royale_maree_member: true };
const standardClient = { name: 'CLIENT STANDARD', is_royale_maree_member: false };

function displayed(price, pricingLevel, client, storeSettings = settings, context = {}) {
  return getCustomerDisplayedPrice({
    price,
    pricingLevel,
    client,
    storeSettings,
    context,
  });
}

assert.equal(displayed(20, 1, null), 20.5, 'Tarif 1 sans client ajoute la commission');
assert.equal(displayed(20, 1, leclercClient), 20.5, 'Tarif 1 avec client Leclerc ajoute la commission');
assert.equal(displayed(20, 1, standardClient), 20.5, 'Tarif 1 client non marque RM ajoute la commission');
assert.equal(displayed(20, 1, standardClient, { royale_maree_commission_eur_per_kg: 0 }), 20, 'Commission nulle conserve le tarif 1');
assert.equal(displayed(21.2, 1, standardClient), 21.7, 'Tarif 1 manuel ajoute la commission');
assert.equal(displayed(22, 2, leclercClient), 22, 'Tarif 2 ne prend pas la commission');
assert.equal(displayed(23, 3, leclercClient), 23, 'Tarif 3 ne prend pas la commission');

const decorated = decorateLineWithDisplayedPrices({
  price_ht: 20,
  price_level_1_ht: 20,
  price_level_2_ht: 22,
  price_level_3_ht: 23,
  tariff_level: 1,
}, {
  client: standardClient,
  storeSettings: settings,
  context: { targetTariffLevel: 1 },
});

assert.equal(decorated.price_level_1_ht, 20, 'Le tarif 1 stocke reste brut');
assert.equal(decorated.display_price_level_1_ht, 20.5, 'Le prix affiche T1 est majore');
assert.equal(decorated.display_price_ht, 20.5, 'Le prix affiche de la ligne est majore');
assert.equal(decorated.display_price_level_2_ht, 22, 'Le prix affiche T2 reste brut');
assert.equal(decorated.display_price_level_3_ht, 23, 'Le prix affiche T3 reste brut');

console.log('royale-maree-commission-pricing: ok');
