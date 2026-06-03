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

  function qty(value) {
    return number(value).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
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

  function documentLabel(priceList) {
    const tariff = targetTariff(priceList);
    return tariff ? `Cours Tarif ${tariff}` : 'Cours general';
  }

  function addressBlock(parts) {
    return parts.filter(Boolean).map((part) => `<p>${escapeHtml(part)}</p>`).join('');
  }

  function companyMeta(settings) {
    const parts = [
      settings.phone ? `Tel. ${settings.phone}` : null,
      settings.email,
      settings.siret ? `SIRET ${settings.siret}` : null,
      settings.vat_number ? `TVA ${settings.vat_number}` : null,
      settings.sanitary_approval_number ? `Agrement ${settings.sanitary_approval_number}` : null,
    ].filter(Boolean);

    return parts.length ? `<p class="cpl-company-meta">${escapeHtml(parts.join(' | '))}</p>` : '';
  }

  function lineDetails(line) {
    return [
      line.caliber_info,
      line.origin_label,
      line.fao_zone ? `FAO ${line.fao_zone}` : null,
      line.sous_zone,
      line.line_note,
    ].filter(Boolean).join(' - ');
  }

  function lineRow(line, priceList) {
    const details = lineDetails(line);
    const tariff = targetTariff(priceList);
    const priceCells = tariff
      ? `<td class="num">${money(line.price_ht)}</td>`
      : `<td class="num">${money(line.price_level_1_ht)}</td><td class="num">${money(line.price_level_2_ht)}</td><td class="num">${money(line.price_level_3_ht)}</td>`;

    return `<tr>
      <td>
        <strong>${escapeHtml(line.designation_snapshot || '-')}</strong>
        ${details ? `<small>${escapeHtml(details)}</small>` : ''}
      </td>
      ${priceCells}
      <td>${escapeHtml(line.sale_unit || '')}</td>
    </tr>`;
  }

  function tableHead(priceList) {
    return targetTariff(priceList)
      ? '<thead><tr><th>Designation</th><th>Prix HT</th><th>Unite</th></tr></thead>'
      : '<thead><tr><th>Designation</th><th>Tarif 1 HT</th><th>Tarif 2 HT</th><th>Tarif 3 HT</th><th>Unite</th></tr></thead>';
  }

  function familySections(lines, priceList) {
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
        <table class="cpl-print-table">
          ${tableHead(priceList)}
          <tbody>${grouped[familyName].map((line) => lineRow(line, priceList)).join('')}</tbody>
        </table>
      </section>
    `).join('');
  }

  function featuredSection(lines, priceList) {
    const featured = (lines || []).filter((line) => line.is_featured);
    if (!featured.length) return '';

    return `<section class="cpl-featured-section">
      <h3>Produits du moment</h3>
      <table class="cpl-print-table">
        ${tableHead(priceList)}
        <tbody>${featured.map((line) => lineRow(line, priceList)).join('')}</tbody>
      </table>
    </section>`;
  }

  function buildHtml(priceList, lines, storeSettings = {}) {
    const settings = storeSettings || {};
    const companyName = settings.company_name || 'Gestion Commerciale';
    const label = documentLabel(priceList);
    const title = priceList.title || label;
    const clientName = priceList.client_name || '';

    return `<article class="cpl-print-document">
      <header class="cpl-print-header">
        <div class="cpl-company">
          ${settings.logo_url ? `<img class="cpl-logo" src="${escapeHtml(settings.logo_url)}" alt="Logo ${escapeHtml(companyName)}">` : ''}
          <div>
            <h1>${escapeHtml(companyName)}</h1>
            ${addressBlock([settings.address_line1, settings.address_line2, [settings.postal_code, settings.city].filter(Boolean).join(' '), settings.country])}
            ${companyMeta(settings)}
          </div>
        </div>
        <div class="cpl-document-meta">
          <p class="cpl-label">${escapeHtml(label)}</p>
          <h2>${escapeHtml(title)}</h2>
          <p>Date : <strong>${formatDate(priceList.price_list_date)}</strong></p>
          ${priceList.valid_until ? `<p>Valable jusqu'au : <strong>${formatDate(priceList.valid_until)}</strong></p>` : ''}
          ${clientName ? `<p>Client : <strong>${escapeHtml(clientName)}</strong></p>` : ''}
        </div>
      </header>

      ${featuredSection(lines, priceList)}
      ${familySections(lines, priceList) || '<p class="cpl-empty">Aucun produit selectionne.</p>'}

      ${settings.legal_mentions ? `<footer class="cpl-footer">${escapeHtml(settings.legal_mentions)}</footer>` : ''}
    </article>`;
  }

  window.CustomerPriceListPrint = {
    buildHtml,
    escapeHtml,
    formatDate,
    money,
    qty,
  };
}());
