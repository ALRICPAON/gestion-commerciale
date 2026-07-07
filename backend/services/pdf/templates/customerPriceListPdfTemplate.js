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
  return `<tr>
    <td>${escapeHtml(line.designation_snapshot || '-')}</td>
    <td>${escapeHtml(line.sale_unit || '')}</td>
    <td class="num price-cell">${money(priceForTariff(line, tariff))}</td>
  </tr>`;
}

function featuredBlock(lines, tariff) {
  const featured = (lines || []).filter((line) => line.is_featured);
  if (!featured.length) return '';
  return `<section class="featured">
    <h3>Produits du moment</h3>
    <table>
      <thead><tr><th>Designation</th><th>Unite</th><th class="num">Prix HT</th></tr></thead>
      <tbody>${featured.map((line) => productRow(line, tariff)).join('')}</tbody>
    </table>
  </section>`;
}

function familyBlocks(lines, tariff) {
  const grouped = (lines || []).filter((line) => !line.is_featured).reduce((acc, line) => {
    const family = line.family_name || 'Autre';
    if (!acc[family]) acc[family] = [];
    acc[family].push(line);
    return acc;
  }, {});

  return Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'fr')).map((family) => `
    <section class="family">
      <h3>${escapeHtml(family)}</h3>
      <table>
        <thead><tr><th>Designation</th><th>Unite</th><th class="num">Prix HT</th></tr></thead>
        <tbody>${grouped[family].map((line) => productRow(line, tariff)).join('')}</tbody>
      </table>
    </section>
  `).join('') || '<p class="empty">Aucun produit selectionne.</p>';
}

function sheet(priceList, lines, settings, tariff) {
  const subtitle = `Date d'edition : ${formatDate(priceList.price_list_date || new Date())}`;
  const client = priceList.client_name ? `<p>Client : <strong>${escapeHtml(priceList.client_name)}</strong></p>` : '';
  return `<article class="pdf-document cpl-document">
    ${companyHeader(settings, 'Mercuriale / Cours du jour', subtitle)}
    <section class="intro-band">
      ${client}
      <p>Prix net départ</p>
    </section>
    <div class="cpl-family-columns">
      ${featuredBlock(lines, tariff)}
      ${familyBlocks(lines, tariff)}
    </div>
    ${settings.legal_mentions ? `<section class="footer-note"><h3>Mentions</h3><p>${escapeHtml(settings.legal_mentions)}</p></section>` : ''}
  </article>`;
}

function renderCustomerPriceListPdf({ priceList, lines, storeSettings }) {
  const tariff = targetTariff(priceList || {});
  const tariffs = tariff ? [tariff] : [1, 2, 3];
  const body = tariffs.map((level) => sheet(priceList || {}, lines || [], storeSettings || {}, level)).join('');
  const styles = `
    @page { margin: 9mm; }
    body { background: #f5f7f9; color: #17212b; font-size: 9px; }
    .cpl-document { background: #ffffff; min-height: 277mm; }
    .doc-header { border-bottom: 2px solid #0f5f78; margin-bottom: 8px; padding-bottom: 7px; }
    .company-logo { max-height: 15mm; max-width: 24mm; }
    .company-block h1 { color: #0f5f78; font-size: 15px; letter-spacing: 0; }
    .document-title { background: #f7fafc; border-color: #aebdcc; }
    .document-title h2 { color: #17212b; }
    .intro-band { background: #f7fafc; border: 1px solid #c6d0d8; display: flex; justify-content: space-between; gap: 10px; margin: 0 0 8px; padding: 5px 7px; }
    .intro-band p { font-weight: 800; margin: 0; }
    .cpl-family-columns { column-count: 2; column-gap: 8mm; column-fill: auto; }
    .featured, .family { break-inside: avoid; display: inline-block; margin: 0 0 6px; page-break-inside: avoid; width: 100%; }
    .featured { border: 1px solid #9fc6d2; }
    .featured h3, .family h3 { color: #ffffff; font-size: 9px; letter-spacing: 0; margin: 0; padding: 4px 6px; text-transform: uppercase; }
    .featured h3 { background: #0f5f78; }
    .family h3 { background: #17212b; }
    .featured table, .family table { table-layout: fixed; }
    .featured th, .family th { background: #e8eef4; border-color: #aebdcc; color: #17212b; font-size: 7px; letter-spacing: 0; padding: 3px 4px; }
    .featured td, .family td { border-color: #d5dde5; line-height: 1.12; padding: 2px 4px; }
    .featured tbody tr:nth-child(even), .family tbody tr:nth-child(even) { background: #f8fafc; }
    th:nth-child(1) { width: 63%; }
    th:nth-child(2) { width: 13%; }
    th:nth-child(3) { width: 24%; }
    .price-cell { color: #0f3443; font-size: 9px; font-weight: 800; }
    .empty { border: 1px solid #c6d0d8; padding: 10px; }
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
