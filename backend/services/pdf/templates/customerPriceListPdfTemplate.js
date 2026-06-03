const {
  companyHeader,
  escapeHtml,
  fileSafe,
  formatDate,
  htmlDocument,
  money,
} = require('../pdfLayout');

function targetTariff(priceList) {
  const parsed = Number(priceList.target_tariff_level ?? priceList.tariff_level);
  return [1, 2, 3].includes(parsed) ? parsed : null;
}

function priceForTariff(line, tariff) {
  if (tariff === 1) return line.price_level_1_ht ?? line.price_ht;
  if (tariff === 2) return line.price_level_2_ht ?? line.price_ht;
  if (tariff === 3) return line.price_level_3_ht ?? line.price_ht;
  return line.price_ht;
}

function productRow(line, tariff) {
  return `<div class="cpl-row"><span>${escapeHtml(line.designation_snapshot || '-')}</span><strong>${money(priceForTariff(line, tariff))}</strong></div>`;
}

function featuredBlock(lines, tariff) {
  const featured = (lines || []).filter((line) => line.is_featured);
  if (!featured.length) return '';
  return `<section class="featured"><h3>Produits du moment</h3>${featured.map((line) => productRow(line, tariff)).join('')}</section>`;
}

function familyBlocks(lines, tariff) {
  const grouped = (lines || []).filter((line) => !line.is_featured).reduce((acc, line) => {
    const family = line.family_name || 'Autre';
    if (!acc[family]) acc[family] = [];
    acc[family].push(line);
    return acc;
  }, {});

  return Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'fr')).map((family) => `
    <section class="family"><h3>${escapeHtml(family)}</h3>${grouped[family].map((line) => productRow(line, tariff)).join('')}</section>
  `).join('') || '<p>Aucun produit selectionne.</p>';
}

function sheet(priceList, lines, settings, tariff) {
  const subtitle = `Tarif ${tariff} - ${formatDate(priceList.price_list_date)}`;
  const client = priceList.client_name ? `<p>Client : <strong>${escapeHtml(priceList.client_name)}</strong></p>` : '';
  return `<article class="pdf-document cpl-document">
    ${companyHeader(settings, 'Mercuriale / Cours du jour', subtitle)}
    ${client ? `<section class="cpl-client">${client}</section>` : ''}
    ${featuredBlock(lines, tariff)}
    <div class="columns">${familyBlocks(lines, tariff)}</div>
    ${settings.legal_mentions ? `<section class="footer-note"><h3>Mentions</h3><p>${escapeHtml(settings.legal_mentions)}</p></section>` : ''}
  </article>`;
}

function renderCustomerPriceListPdf({ priceList, lines, storeSettings }) {
  const tariff = targetTariff(priceList || {});
  const tariffs = tariff ? [tariff] : [1, 2, 3];
  const body = tariffs.map((level) => sheet(priceList || {}, lines || [], storeSettings || {}, level)).join('');
  const styles = `
    @page { margin: 9mm; }
    body { font-size: 10.5px; }
    .cpl-document { min-height: 277mm; }
    .cpl-client { margin: 0 0 8px; }
    .featured { background: #f8fbff; border: 1px solid #bfdbfe; border-radius: 6px; margin-bottom: 10px; padding: 8px; }
    .featured h3, .family h3 { color: #003f7f; font-size: 12px; margin: 0 0 5px; text-transform: uppercase; }
    .columns { column-count: 2; column-gap: 16px; }
    .family { break-inside: avoid; display: inline-block; margin: 0 0 8px; width: 100%; }
    .cpl-row { align-items: baseline; border-bottom: 1px dotted #cbd5e1; display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr) auto; padding: 2px 0; }
    .cpl-row strong { white-space: nowrap; }
  `;
  return htmlDocument('Mercuriale', body, styles);
}

function customerPriceListFilename(priceList = {}) {
  return `${fileSafe(priceList.title || 'mercuriale')}.pdf`;
}

module.exports = {
  customerPriceListFilename,
  renderCustomerPriceListPdf,
};
