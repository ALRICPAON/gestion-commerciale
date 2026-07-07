const {
  renderMercurialePdf,
  mercurialeFilename,
} = require('./mercurialePdfTemplate');

/**
 * Wrapper pour compatibilité avec l'interface existante
 * Utilise le template unifié mercurialePdfTemplate
 */
function renderCustomerPriceListPdf({ priceList, lines, storeSettings }) {
  return renderMercurialePdf({
    priceListOrClient: priceList,
    lines,
    storeSettings,
  });
}

function customerPriceListFilename(priceList = {}) {
  return mercurialeFilename(priceList);
}

module.exports = {
  customerPriceListFilename,
  renderCustomerPriceListPdf,
};
