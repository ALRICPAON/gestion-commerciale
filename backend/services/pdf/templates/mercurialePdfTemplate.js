const {
  companyHeader,
  escapeHtml,
  fileSafe,
  formatDate,
  htmlDocument,
  money,
} = require('../pdfLayout');

function targetTariff(priceListOrClient) {
  const value = priceListOrClient.target_tariff_level ?? priceListOrClient.tariff_level;
  const parsed = Number(value);
  return [1, 2, 3].includes(parsed) ? parsed : null;
}

function priceForTariff(line, tariff) {
  if (tariff === 1) return line.display_price_level_1_ht ?? line.price_level_1_ht ?? line.display_price_ht ?? line.price_ht;
  if (tariff === 2) return line.display_price_level_2_ht ?? line.price_level_2_ht ?? line.display_price_ht ?? line.price_ht;
  if (tariff === 3) return line.display_price_level_3_ht ?? line.price_level_3_ht ?? line.display_price_ht ?? line.price_ht;
  return line.display_price_ht ?? line.price_ht;
}

/**
 * Regroupe les produits par famille et les prépare pour une mise en page 2 colonnes
 * Optimise le remplissage des colonnes pour équilibrer la hauteur
 */
function groupProductsByFamilyOptimized(lines = [], tariff) {
  const grouped = (lines || []).filter((line) => !line.is_featured).reduce((acc, line) => {
    const family = line.family_name || 'Autre';
    if (!acc[family]) acc[family] = [];
    acc[family].push(line);
    return acc;
  }, {});

  const sortedFamilies = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'fr'));
  
  // Créer les sections HTML pour chaque famille
  const familySections = sortedFamilies.map((familyName) => ({
    name: familyName,
    html: `
      <section class="mercuriale-family" data-family="${escapeHtml(familyName)}">
        <h3>${escapeHtml(familyName)}</h3>
        <table>
          <tbody>
            ${grouped[familyName].map((line) => `
              <tr>
                <td class="mercuriale-designation">${escapeHtml(line.designation_snapshot || '-')}</td>
                <td class="mercuriale-unit">${escapeHtml(line.sale_unit || '')}</td>
                <td class="mercuriale-price">${money(priceForTariff(line, tariff))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </section>
    `,
  }));

  // Distribuer les familles entre les 2 colonnes en équilibrant la charge
  const leftColumn = [];
  const rightColumn = [];
  
  familySections.forEach((section, index) => {
    if (index % 2 === 0) {
      leftColumn.push(section.html);
    } else {
      rightColumn.push(section.html);
    }
  });

  return {
    leftColumn: leftColumn.join(''),
    rightColumn: rightColumn.join(''),
  };
}

function featuredBlock(lines, tariff) {
  const featured = (lines || []).filter((line) => line.is_featured);
  if (!featured.length) return '';
  
  return `
    <section class="mercuriale-featured">
      <h3>Produits du moment</h3>
      <table>
        <tbody>
          ${featured.map((line) => `
            <tr>
              <td class="mercuriale-designation">${escapeHtml(line.designation_snapshot || '-')}</td>
              <td class="mercuriale-unit">${escapeHtml(line.sale_unit || '')}</td>
              <td class="mercuriale-price">${money(priceForTariff(line, tariff))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
  `;
}

function singleSheetHtml(priceListOrClient, lines, storeSettings, tariff) {
  const clientName = priceListOrClient.client_name || '';
  const priceListDate = priceListOrClient.price_list_date || new Date();
  const subtitle = `Date d'edition : ${formatDate(priceListDate)}`;
  
  const clientBlock = clientName 
    ? `<p class="mercuriale-client">Client : <strong>${escapeHtml(clientName)}</strong></p>` 
    : '';
  
  const columnsData = groupProductsByFamilyOptimized(lines, tariff);

  return `
    <article class="pdf-document mercuriale-document">
      ${companyHeader(storeSettings, 'Mercuriale / Cours du jour', subtitle)}
      
      <section class="mercuriale-intro">
        ${clientBlock}
        <p class="mercuriale-subtitle">Prix net départ</p>
      </section>

      ${featuredBlock(lines, tariff)}

      <div class="mercuriale-columns">
        <div class="mercuriale-column-left">
          ${columnsData.leftColumn || '<p class="mercuriale-empty">Aucun produit.</p>'}
        </div>
        <div class="mercuriale-column-right">
          ${columnsData.rightColumn || ''}
        </div>
      </div>

      ${storeSettings.legal_mentions ? `
        <section class="mercuriale-footer">
          <p>${escapeHtml(storeSettings.legal_mentions)}</p>
        </section>
      ` : ''}
    </article>
  `;
}

function renderMercurialePdf({ priceListOrClient, lines, storeSettings }) {
  const tariff = targetTariff(priceListOrClient || {});
  const tariffs = tariff ? [tariff] : [1, 2, 3];
  const body = tariffs.map((level) => singleSheetHtml(priceListOrClient || {}, lines || [], storeSettings || {}, level)).join('');
  
  const styles = `
    @page {
      margin: 9mm;
      size: A4;
    }

    body {
      background: #f5f7f9;
      color: #17212b;
      font-size: 9px;
      margin: 0;
      padding: 0;
    }

    .mercuriale-document {
      background: #ffffff;
      min-height: 277mm;
      padding: 0;
    }

    /* En-tête */
    .doc-header {
      border-bottom: 2px solid #0f5f78;
      margin-bottom: 8px;
      padding-bottom: 7px;
    }

    .company-logo {
      max-height: 15mm;
      max-width: 24mm;
    }

    .company-block h1 {
      color: #0f5f78;
      font-size: 15px;
      letter-spacing: 0;
    }

    .document-title {
      background: #f7fafc;
      border-color: #aebdcc;
    }

    .document-title h2 {
      color: #17212b;
    }

    /* Intro section */
    .mercuriale-intro {
      background: #f7fafc;
      border: 1px solid #c6d0d8;
      margin: 0 0 8px;
      padding: 5px 7px;
    }

    .mercuriale-client {
      font-weight: 800;
      margin: 0 0 4px;
      padding: 0;
    }

    .mercuriale-subtitle {
      font-weight: 800;
      margin: 0;
      padding: 0;
    }

    /* Featured products */
    .mercuriale-featured {
      border: 1px solid #9fc6d2;
      break-inside: avoid;
      margin: 0 0 6px;
      page-break-inside: avoid;
    }

    .mercuriale-featured h3 {
      background: #0f5f78;
      color: #ffffff;
      font-size: 9px;
      letter-spacing: 0;
      margin: 0;
      padding: 4px 6px;
      text-transform: uppercase;
    }

    .mercuriale-featured table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    /* Colonnes */
    .mercuriale-columns {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8mm;
      margin: 0;
      padding: 0;
    }

    .mercuriale-column-left,
    .mercuriale-column-right {
      overflow: hidden;
    }

    /* Families dans les colonnes */
    .mercuriale-family {
      break-inside: avoid;
      margin: 0 0 6px;
      page-break-inside: avoid;
    }

    .mercuriale-family h3 {
      background: #17212b;
      color: #ffffff;
      font-size: 9px;
      letter-spacing: 0;
      margin: 0;
      padding: 4px 6px;
      text-transform: uppercase;
    }

    .mercuriale-family table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    .mercuriale-family tbody tr:nth-child(even) {
      background: #f8fafc;
    }

    .mercuriale-designation {
      border-bottom: 1px solid #d5dde5;
      border-right: 1px solid #d5dde5;
      padding: 2px 4px;
      width: 60%;
      word-wrap: break-word;
      word-break: break-word;
    }

    .mercuriale-unit {
      border-bottom: 1px solid #d5dde5;
      border-right: 1px solid #d5dde5;
      padding: 2px 4px;
      text-align: center;
      width: 20%;
    }

    .mercuriale-price {
      border-bottom: 1px solid #d5dde5;
      color: #0f3443;
      font-size: 9px;
      font-weight: 800;
      padding: 2px 4px;
      text-align: right;
      width: 20%;
    }

    .mercuriale-featured tbody tr:nth-child(even) {
      background: #f8fafc;
    }

    .mercuriale-featured .mercuriale-designation,
    .mercuriale-featured .mercuriale-unit,
    .mercuriale-featured .mercuriale-price {
      border-bottom: 1px solid #d5dde5;
      padding: 2px 4px;
    }

    .mercuriale-featured .mercuriale-designation {
      border-right: 1px solid #d5dde5;
      width: 60%;
    }

    .mercuriale-featured .mercuriale-unit {
      border-right: 1px solid #d5dde5;
      text-align: center;
      width: 20%;
    }

    .mercuriale-featured .mercuriale-price {
      text-align: right;
      width: 20%;
    }

    .mercuriale-empty {
      border: 1px solid #c6d0d8;
      padding: 10px;
    }

    /* Footer */
    .mercuriale-footer {
      border-top: 1px solid #c6d0d8;
      margin-top: 8px;
      padding-top: 7px;
      text-align: left;
      width: 100%;
    }

    .mercuriale-footer p {
      font-size: 7.5px;
      line-height: 1.4;
      margin: 0;
      padding: 0;
      color: #52616f;
    }
  `;

  return htmlDocument('Mercuriale', body, styles);
}

function mercurialeFilename(priceListOrClient = {}) {
  const title = priceListOrClient.title || 'mercuriale';
  return `${fileSafe(title)}.pdf`;
}

module.exports = {
  mercurialeFilename,
  renderMercurialePdf,
  targetTariff,
};
