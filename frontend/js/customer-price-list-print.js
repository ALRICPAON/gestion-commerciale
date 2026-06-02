(function () {
  const TYPE_LABELS = {
    general: 'Cours general',
    client: 'Cours client',
    promotion: 'Offre promotionnelle',
    daily_arrival: 'Arrivage du jour',
  };

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

  function lineRow(line) {
    const details = lineDetails(line);
    return `<tr>
      <td>
        <strong>${escapeHtml(line.designation_snapshot || '-')}</strong>
        ${details ? `<small>${escapeHtml(details)}</small>` : ''}
      </td>
      <td class="num">${money(line.price_ht)}</td>
      <td>${escapeHtml(line.sale_unit || '')}</td>
    </tr>`;
  }

  function familySections(lines) {
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
          <thead><tr><th>Designation</th><th>Prix HT</th><th>Unite</th></tr></thead>
          <tbody>${grouped[familyName].map(lineRow).join('')}</tbody>
        </table>
      </section>
    `).join('');
  }

  function featuredSection(lines) {
    const featured = (lines || []).filter((line) => line.is_featured);
    if (!featured.length) return '';

    return `<section class="cpl-featured-section">
      <h3>Produits du moment</h3>
      <table class="cpl-print-table">
        <thead><tr><th>Designation</th><th>Prix HT</th><th>Unite</th></tr></thead>
        <tbody>${featured.map(lineRow).join('')}</tbody>
      </table>
    </section>`;
  }

  function buildHtml(priceList, lines, storeSettings = {}) {
    const settings = storeSettings || {};
    const companyName = settings.company_name || 'Gestion Commerciale';
    const typeLabel = TYPE_LABELS[priceList.course_type] || TYPE_LABELS.general;
    const title = priceList.title || typeLabel;
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
          <p class="cpl-label">${escapeHtml(typeLabel)}</p>
          <h2>${escapeHtml(title)}</h2>
          <p>Date : <strong>${formatDate(priceList.price_list_date)}</strong></p>
          ${priceList.valid_until ? `<p>Valable jusqu'au : <strong>${formatDate(priceList.valid_until)}</strong></p>` : ''}
          ${clientName ? `<p>Client : <strong>${escapeHtml(clientName)}</strong></p>` : ''}
        </div>
      </header>

      ${featuredSection(lines)}
      ${familySections(lines) || '<p class="cpl-empty">Aucun produit selectionne.</p>'}

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
