(function () {
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    }[char]));
  }

  function number(value, fallback = 0) {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function money(value) {
    if (value === null || value === undefined || value === '') return '-';
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(number(value));
  }

  function formatDate(value) {
    if (!value) return '-';
    try { return new Intl.DateTimeFormat('fr-FR').format(new Date(value)); }
    catch { return String(value); }
  }

  function targetTariff(priceList) {
    const value = priceList.target_tariff_level ?? priceList.tariff_level;
    const parsed = Number(value);
    return [1, 2, 3].includes(parsed) ? parsed : null;
  }

  function addressLine(settings) {
    return [
      settings.address_line1,
      settings.address_line2,
      [settings.postal_code, settings.city].filter(Boolean).join(' '),
    ].filter(Boolean).join(' - ');
  }

  function companyMeta(settings) {
    return [
      settings.phone ? `Tel. ${settings.phone}` : null,
      settings.email,
      settings.sanitary_approval_number ? `Agrement sanitaire ${settings.sanitary_approval_number}` : null,
    ].filter(Boolean).join(' | ');
  }

  function priceForTariff(line, tariff) {
    if (tariff === 1) return line.display_price_level_1_ht ?? line.price_level_1_ht ?? line.display_price_ht ?? line.price_ht;
    if (tariff === 2) return line.display_price_level_2_ht ?? line.price_level_2_ht ?? line.display_price_ht ?? line.price_ht;
    if (tariff === 3) return line.display_price_level_3_ht ?? line.price_level_3_ht ?? line.display_price_ht ?? line.price_ht;
    return line.display_price_ht ?? line.price_ht;
  }

  /**
   * Regroupe les produits par famille et les prépare pour une mise en page 2 colonnes
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

    // Distribuer les familles entre les 2 colonnes
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

  function singleSheetHtml(priceList, lines, storeSettings, tariff) {
    const settings = storeSettings || {};
    const companyName = settings.company_name || 'Gestion Commerciale';
    const clientName = priceList.client_name || '';
    const columnsData = groupProductsByFamilyOptimized(lines, tariff);

    return `
      <article class="mercuriale-print-document">
        <header class="mercuriale-print-header">
          <div class="mercuriale-company">
            ${settings.logo_url ? `<img class="mercuriale-logo" src="${escapeHtml(settings.logo_url)}" alt="Logo ${escapeHtml(companyName)}">` : ''}
            <div>
              <h1>${escapeHtml(companyName)}</h1>
              ${addressLine(settings) ? `<p>${escapeHtml(addressLine(settings))}</p>` : ''}
              ${companyMeta(settings) ? `<p class="mercuriale-company-meta">${escapeHtml(companyMeta(settings))}</p>` : ''}
            </div>
          </div>
          <div class="mercuriale-document-meta">
            <p class="mercuriale-label">Mercuriale</p>
            <h2>Cours du jour</h2>
            <p>Date : <strong>${formatDate(priceList.price_list_date)}</strong></p>
            ${clientName ? `<p>Client : <strong>${escapeHtml(clientName)}</strong></p>` : ''}
          </div>
        </header>

        <section class="mercuriale-intro">
          ${clientName ? `<p class="mercuriale-client">Client : <strong>${escapeHtml(clientName)}</strong></p>` : ''}
          <p class="mercuriale-subtitle">Prix net départ</p>
        </section>

        ${featuredBlock(lines, tariff)}

        <div class="mercuriale-columns">
          <div class="mercuriale-column-left">
            ${columnsData.leftColumn || '<p class="mercuriale-empty">Aucun produit selectionne.</p>'}
          </div>
          <div class="mercuriale-column-right">
            ${columnsData.rightColumn || ''}
          </div>
        </div>

        ${settings.legal_mentions ? `
          <section class="mercuriale-footer">
            <p>${escapeHtml(settings.legal_mentions)}</p>
          </section>
        ` : ''}
      </article>
    `;
  }

  function buildHtml(priceList, lines, storeSettings = {}) {
    const tariff = targetTariff(priceList);
    const tariffs = tariff ? [tariff] : [1, 2, 3];

    return tariffs.map((level) => singleSheetHtml(priceList, lines, storeSettings, level)).join('');
  }

  window.CustomerPriceListPrint = {
    buildHtml,
    escapeHtml,
    formatDate,
    money,
  };
}());
