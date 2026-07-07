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
    if (tariff === 1) return line.price_level_1_ht ?? line.price_ht;
    if (tariff === 2) return line.price_level_2_ht ?? line.price_ht;
    if (tariff === 3) return line.price_level_3_ht ?? line.price_ht;
    return line.price_ht;
  }

  function productRow(line, tariff) {
    return `<div class="cpl-product-row">
      <span>${escapeHtml(line.designation_snapshot || '-')}</span>
      <strong>${money(priceForTariff(line, tariff))}</strong>
    </div>`;
  }

  function familyBlocks(lines, tariff) {
    const regularLines = (lines || []).filter((line) => !line.is_featured);
    const grouped = regularLines.reduce((acc, line) => {
      const familyName = line.family_name || 'Autre';
      if (!acc[familyName]) acc[familyName] = [];
      acc[familyName].push(line);
      return acc;
    }, {});

    return Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'fr')).map((familyName) => `
      <section class="cpl-family-section">
        <h3>${escapeHtml(familyName)}</h3>
        ${grouped[familyName].map((line) => productRow(line, tariff)).join('')}
      </section>
    `).join('');
  }

  function featuredBlock(lines, tariff) {
    const featured = (lines || []).filter((line) => line.is_featured);
    if (!featured.length) return '';

    return `<section class="cpl-featured-section">
      <h3>Produits du moment</h3>
      ${featured.map((line) => productRow(line, tariff)).join('')}
    </section>`;
  }

  function singleSheetHtml(priceList, lines, storeSettings, tariff) {
    const settings = storeSettings || {};
    const companyName = settings.company_name || 'Gestion Commerciale';
    const clientName = priceList.client_name || '';

    return `<article class="cpl-print-document">
      <header class="cpl-print-header">
        <div class="cpl-company">
          ${settings.logo_url ? `<img class="cpl-logo" src="${escapeHtml(settings.logo_url)}" alt="Logo ${escapeHtml(companyName)}">` : ''}
          <div>
            <h1>${escapeHtml(companyName)}</h1>
            ${addressLine(settings) ? `<p>${escapeHtml(addressLine(settings))}</p>` : ''}
            ${companyMeta(settings) ? `<p class="cpl-company-meta">${escapeHtml(companyMeta(settings))}</p>` : ''}
          </div>
        </div>
        <div class="cpl-document-meta">
          <p class="cpl-label">Mercuriale</p>
          <h2>Cours du jour</h2>
          <p>Date : <strong>${formatDate(priceList.price_list_date)}</strong></p>
          ${clientName ? `<p>Client : <strong>${escapeHtml(clientName)}</strong></p>` : ''}
        </div>
      </header>

      ${featuredBlock(lines, tariff)}
      <div class="cpl-course-columns">
        ${familyBlocks(lines, tariff) || '<p class="cpl-empty">Aucun produit selectionne.</p>'}
      </div>
    </article>`;
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
