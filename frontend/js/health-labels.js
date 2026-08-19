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

  function formatDate(value) {
    if (!value) return '';
    try { return new Intl.DateTimeFormat('fr-FR').format(new Date(value)); }
    catch { return String(value); }
  }

  function safe(value) {
    return String(value || '').trim();
  }

  function compact(items) {
    return items.map(safe).filter(Boolean);
  }

  function resolveLogoUrl(value) {
    const raw = safe(value);
    if (!raw) return '';
    const apiBase = safe(window.APP_CONFIG?.API_BASE_URL);
    if (/^(data:|blob:)/i.test(raw)) return raw;
    if (!apiBase) return raw;
    const UrlCtor = window.URL || (typeof URL !== 'undefined' ? URL : null);
    if (!UrlCtor) return raw;
    try {
      const parsed = new UrlCtor(raw.startsWith('//') ? `${window.location.protocol}${raw}` : raw, apiBase);
      if (parsed.pathname.startsWith('/uploads/store-logos/')) {
        return new UrlCtor(`${parsed.pathname}${parsed.search}`, apiBase).href;
      }
      return parsed.href;
    } catch {
      return raw;
    }
  }

  function formatAllergen(value) {
    const text = safe(value);
    return text ? text.toLocaleUpperCase('fr-FR') : '';
  }

  function info(label, value, className = '') {
    return safe(value) ? `<div${className ? ` class="${escapeHtml(className)}"` : ''}><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>` : '';
  }

  function labelTrace(label) {
    const trace = label.traceability || {};
    const lots = Array.isArray(label.lots) ? label.lots : [];
    return compact([
      trace.lot_code || lots.map((lot) => lot.lot_code || lot.supplier_lot_number).filter(Boolean).join(', '),
      trace.dlc ? `DLC/DDM ${formatDate(trace.dlc)}` : '',
    ]).join(' - ');
  }

  function companyLine(company) {
    return compact([
      company?.address_line1,
      compact([company?.postal_code, company?.city]).join(' '),
      company?.phone ? `Tel. ${company.phone}` : '',
    ]).join(' - ');
  }

  function renderLabel(label) {
    const trace = label.traceability || {};
    const company = label.company || {};
    const healthMark = company.health_mark || null;
    const logoUrl = resolveLogoUrl(company.logo_url);
    const client = label.delivered_client_display || compact([
      label.delivered_client_name,
      label.delivered_client_store_identifier ? `N° ${label.delivered_client_store_identifier}` : '',
    ]).join(' - ');
    const meta = [
      info('Nom scientifique', trace.latin_name),
      info('Methode', trace.production_method),
      info('ZONE DE PÊCHE', label.fishing_area_label || trace.fao_zone),
      info('Sous-zone', trace.sous_zone),
      info('Engin', trace.fishing_gear),
      info('Calibre', label.caliber),
      info('Lot', labelTrace(label)),
      info('DATE DE CONDITIONNEMENT', label.conditioning_date_label || formatDate(label.conditioning_date || label.document_date)),
      info('ALLERGÈNE', label.allergen_label || formatAllergen(trace.allergens), 'health-label-allergen'),
      info('CONSERVATION', label.storage_temperature_label),
      info('MENTION', label.storage_instruction_label),
    ].join('');

    return `<article class="health-label-card">
      <header class="health-label-top">
        <div class="health-label-brand">
          ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="">` : ''}
          <div>
            <strong>${escapeHtml(company.name || 'ALTA MAREE')}</strong>
            <span>${escapeHtml(companyLine(company))}</span>
          </div>
        </div>
        ${healthMark ? `<div class="health-label-approval"><span>${escapeHtml(healthMark.country || 'FR')}</span><strong>${escapeHtml(healthMark.approval_number || '')}</strong><span>${escapeHtml(healthMark.authority || 'UE')}</span></div>` : ''}
      </header>
      <section class="health-label-client">
        <span>POUR</span>
        <strong>${escapeHtml(client || '-')}</strong>
      </section>
      <section class="health-label-product">
        <h2>${escapeHtml(label.article_label || 'Article')}</h2>
        <div class="health-label-weight">
          <span>POIDS NET</span>
          <strong>${escapeHtml(label.net_weight_label || '')}</strong>
        </div>
      </section>
      <section class="health-label-meta">${meta}</section>
      ${trace.defrosted ? '<section class="health-label-warning">DECONGELE</section>' : ''}
      <footer class="health-label-footer">
        <span>${escapeHtml(label.delivery_note_reference || '')} - Ligne ${escapeHtml(label.line_number || '')}</span>
        <span>Colis ${escapeHtml(label.copy_index || '')}/${escapeHtml(label.copy_count || '')}</span>
      </footer>
    </article>`;
  }

  function buildHtml(labels) {
    return `<section class="health-label-print-sheet">${(labels || []).map(renderLabel).join('')}</section>`;
  }

  function renderPreview(labels, zplDocument, warnings = []) {
    const count = Array.isArray(labels) ? labels.length : 0;
    const warningHtml = warnings.length
      ? `<div class="health-label-warnings">${warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join('')}</div>`
      : '';
    return `<div class="health-label-preview-tools">
      <strong>${escapeHtml(count)} etiquette(s) 100 x 100 mm</strong>
      ${zplDocument ? `<button type="button" class="btn btn-secondary btn-sm" data-health-label-zpl>Télécharger ZPL</button>` : ''}
    </div>${warningHtml}${buildHtml(labels)}`;
  }

  function bindZplDownload(container, zplDocument, filename = 'etiquettes-sanitaires.zpl') {
    const button = container?.querySelector?.('[data-health-label-zpl]');
    if (!button || !zplDocument) return;
    button.addEventListener('click', () => {
      const blob = new Blob([zplDocument], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });
  }

  function askCopies(defaultCopies) {
    const fallback = Math.max(1, Math.floor(Number(defaultCopies) || 1));
    const value = prompt('Nombre d’etiquettes a imprimer pour cette ligne', String(fallback));
    if (value === null) return null;
    const copies = Math.floor(Number(String(value).replace(',', '.')));
    return Number.isFinite(copies) && copies > 0 ? copies : fallback;
  }

  function askLot(labels) {
    const lots = [];
    (labels || []).forEach((label) => {
      const lotId = label.allocation_lot_id || label.traceability?.lot_id || '';
      if (!lotId || lots.some((lot) => lot.id === lotId)) return;
      lots.push({
        id: lotId,
        label: label.traceability?.lot_code || label.traceability?.supplier_lot_number || lotId,
        count: (labels || []).filter((item) => (item.allocation_lot_id || item.traceability?.lot_id || '') === lotId).length,
      });
    });
    if (lots.length <= 1) return lots[0] || null;
    const message = lots.map((lot, index) => `${index + 1}. ${lot.label} (${lot.count} etiquette(s))`).join('\n');
    const value = prompt(`Lot a reimprimer :\n${message}`, '1');
    if (value === null) return null;
    const index = Math.floor(Number(String(value).replace(',', '.'))) - 1;
    return lots[index] || null;
  }

  function print(labels, printArea) {
    if (!printArea) return;
    printArea.innerHTML = buildHtml(labels);
    document.body.classList.add('printing-health-labels');
    const cleanup = () => {
      document.body.classList.remove('printing-health-labels');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(cleanup, 1200);
  }

  window.HealthLabels = {
    askCopies,
    askLot,
    bindZplDownload,
    buildHtml,
    escapeHtml,
    print,
    renderPreview,
    resolveLogoUrl,
    formatAllergen,
  };
}());
