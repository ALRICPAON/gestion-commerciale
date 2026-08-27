(function () {
  const LABEL_PAGE_WIDTH_MM = 150;
  const LABEL_PAGE_HEIGHT_MM = 70;
  const PRINT_CARD_WIDTH_MM = 149;
  const PRINT_CARD_HEIGHT_MM = 69;
  const PRINT_SAFE_WIDTH_MM = 146;
  const PRINT_SAFE_HEIGHT_MM = 66;
  const TAB_X_START_MM = 30;
  const TAB_X_END_MM = 148;
  const TAB_WIDTH_MM = TAB_X_END_MM - TAB_X_START_MM;
  const TAB_PHYSICAL_Y_START_MM = 34;
  const TAB_PHYSICAL_HEIGHT_MM = 20;
  const TAB_SAFE_Y_START_MM = 35;
  const TAB_SAFE_HEIGHT_MM = 18;
  const TAB_Y_START_MM = TAB_SAFE_Y_START_MM;
  const TAB_HEIGHT_MM = TAB_SAFE_HEIGHT_MM;

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

  function formatLabelSize(labels) {
    const printer = Array.isArray(labels) ? labels[0]?.printer : null;
    const visualWidth = printer?.visual_width_mm || printer?.height_mm || 150;
    const visualHeight = printer?.visual_height_mm || printer?.width_mm || 70;
    return `${visualWidth} x ${visualHeight} mm`;
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
    const fixedTopLeft = [
      info('Produit', label.article_label || 'Article'),
      info('Nom scientifique', trace.latin_name),
      info('Methode', trace.production_method),
    ].join('');
    const fixedTopMiddle = [
      info('ZONE DE PECHE', label.fishing_area_label || trace.fao_zone),
      info('Sous-zone', trace.sous_zone),
      info('Engin', trace.fishing_gear),
    ].join('');
    const fixedTopRight = [
      info('Calibre', label.caliber),
      info('POIDS NET', label.net_weight_label),
    ].join('');
    const fixedBottom = [
      info('Lot', labelTrace(label)),
      info('DATE DE CONDITIONNEMENT', label.conditioning_date_label || formatDate(label.conditioning_date || label.document_date)),
      info('DLC/DDM', trace.dlc ? formatDate(trace.dlc) : ''),
      info('ALLERGENE', label.allergen_label || formatAllergen(trace.allergens), 'health-label-allergen'),
      info('CONSERVATION', label.storage_temperature_label),
      info('MENTION', label.storage_instruction_label),
      info('ETAT', trace.defrosted ? 'DECONGELE' : ''),
    ].join('');
    const tabLeft = [
      info('Produit', label.article_label || 'Article'),
      info('Nom scientifique', trace.latin_name),
      info('Methode', trace.production_method),
      info('ALLERGENE', label.allergen_label || formatAllergen(trace.allergens), 'health-label-allergen'),
    ].join('');
    const tabMiddle = [
      info('ZONE DE PECHE', label.fishing_area_label || trace.fao_zone),
      info('Sous-zone', trace.sous_zone),
      info('Engin', trace.fishing_gear),
      info('DLC/DDM', trace.dlc ? formatDate(trace.dlc) : ''),
    ].join('');
    const tabRight = [
      info('Lot', labelTrace(label)),
      info('DATE DE CONDITIONNEMENT', label.conditioning_date_label || formatDate(label.conditioning_date || label.document_date)),
      info('CONSERVATION', label.storage_temperature_label),
      info('MENTION', label.storage_instruction_label),
      info('ETAT', trace.defrosted ? 'DECONGELE' : ''),
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
      <section class="health-label-fixed-trace-top">
        <div>${fixedTopLeft}</div>
        <div>${fixedTopMiddle}</div>
        <div>${fixedTopRight}</div>
      </section>
      <section class="health-label-tab">
        <div class="health-label-tab-column">${tabLeft}</div>
        <div class="health-label-tab-column">${tabMiddle}</div>
        <div class="health-label-tab-column">${tabRight}</div>
      </section>
      <section class="health-label-fixed-trace-bottom">${fixedBottom}</section>
      <footer class="health-label-footer">
        <span>${escapeHtml(label.delivery_note_reference || '')} - Ligne ${escapeHtml(label.line_number || '')}</span>
        <span>Colis ${escapeHtml(label.copy_index || '')}/${escapeHtml(label.copy_count || '')}</span>
      </footer>
    </article>`;
  }

  function buildHtml(labels) {
    return `<section class="health-label-print-sheet">${(labels || []).map(renderLabel).join('')}</section>`;
  }

  function buildPrintDocument(labels) {
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Etiquettes sanitaires</title>
  <style>
    @page { size: ${LABEL_PAGE_WIDTH_MM}mm ${LABEL_PAGE_HEIGHT_MM}mm; margin: 0; }
    html,
    body {
      background: #ffffff;
      margin: 0;
      padding: 0;
      width: ${LABEL_PAGE_WIDTH_MM}mm;
    }
    * { box-sizing: border-box; }
    .health-label-print-sheet {
      display: block;
      margin: 0;
      padding: 0;
    }
    .health-label-card {
      background: #ffffff;
      border: 0;
      break-after: page;
      color: #111820;
      display: block;
      font-family: Arial, Helvetica, sans-serif;
      height: ${PRINT_CARD_HEIGHT_MM}mm;
      margin: 0;
      overflow: hidden;
      padding: 0;
      page-break-after: always;
      position: relative;
      width: ${PRINT_CARD_WIDTH_MM}mm;
    }
    .health-label-card:last-child {
      break-after: auto;
      page-break-after: auto;
    }
    .health-label-top,
    .health-label-footer {
      align-items: center;
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }
    .health-label-top {
      height: 8mm;
      left: 2mm;
      position: absolute;
      top: 2mm;
      width: ${PRINT_SAFE_WIDTH_MM}mm;
    }
    .health-label-brand {
      align-items: center;
      display: grid;
      gap: 8px;
      grid-template-columns: auto minmax(0, 1fr);
      min-width: 0;
    }
    .health-label-brand img {
      max-height: 6mm;
      max-width: 15mm;
      object-fit: contain;
    }
    .health-label-brand strong {
      display: block;
      font-size: 12px;
      line-height: 1.05;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .health-label-brand span {
      color: #45515c;
      display: block;
      font-size: 7px;
      line-height: 1.2;
    }
    .health-label-approval {
      align-items: center;
      border: 2px solid #111820;
      border-radius: 50%;
      display: grid;
      flex: 0 0 25mm;
      font-size: 8px;
      font-weight: 800;
      height: 6mm;
      justify-content: center;
      line-height: 1;
      padding: 2px 8px;
      text-align: center;
    }
    .health-label-approval strong {
      display: block;
      font-size: 10px;
      line-height: 1.05;
    }
    .health-label-client {
      display: flex;
      flex-direction: column;
      height: 8mm;
      justify-content: center;
      left: 50mm;
      min-width: 0;
      position: absolute;
      top: 10mm;
      width: 65mm;
    }
    .health-label-client span {
      color: #45515c;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0;
    }
    .health-label-client strong {
      display: block;
      font-size: 18px;
      line-height: 1;
      overflow-wrap: anywhere;
    }
    .health-label-fixed-trace-top {
      display: grid;
      gap: 0 3mm;
      grid-template-columns: 1fr 1fr 42mm;
      height: 14mm;
      left: 2mm;
      min-height: 0;
      overflow: hidden;
      position: absolute;
      top: 19mm;
      width: ${PRINT_SAFE_WIDTH_MM}mm;
    }
    .health-label-fixed-trace-top > div {
      align-content: start;
      display: grid;
      gap: 1px;
      min-width: 0;
      overflow: hidden;
    }
    .health-label-fixed-trace-top span,
    .health-label-fixed-trace-bottom span {
      color: #45515c;
      display: block;
      font-size: 5px;
      font-weight: 800;
      line-height: 1;
      text-transform: uppercase;
    }
    .health-label-fixed-trace-top strong,
    .health-label-fixed-trace-bottom strong {
      display: block;
      font-size: 7px;
      line-height: 1.05;
      overflow-wrap: anywhere;
    }
    .health-label-tab {
      display: grid;
      gap: 0 2mm;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      height: ${TAB_HEIGHT_MM}mm;
      left: ${TAB_X_START_MM}mm;
      min-height: 0;
      overflow: hidden;
      padding: 1mm 0 0;
      position: absolute;
      top: ${TAB_Y_START_MM}mm;
      width: ${TAB_WIDTH_MM}mm;
    }
    .health-label-tab-column {
      align-content: start;
      display: grid;
      gap: 1px;
      grid-template-columns: 1fr;
      min-width: 0;
      overflow: hidden;
    }
    .health-label-tab span {
      color: #45515c;
      display: block;
      font-size: 4.5px;
      font-weight: 800;
      line-height: 1;
      text-transform: uppercase;
    }
    .health-label-tab div strong {
      display: block;
      font-size: 6px;
      line-height: 1.05;
      overflow-wrap: anywhere;
    }
    .health-label-fixed-trace-bottom {
      align-content: start;
      display: grid;
      gap: 1px 3mm;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      height: 10mm;
      left: 2mm;
      min-height: 0;
      overflow: hidden;
      position: absolute;
      top: 54mm;
      width: ${PRINT_SAFE_WIDTH_MM}mm;
    }
    .health-label-footer {
      color: #45515c;
      font-size: 8px;
      font-weight: 700;
      height: 3mm;
      left: 2mm;
      min-height: 0;
      padding-top: 1px;
      position: absolute;
      top: 64mm;
      width: ${PRINT_SAFE_WIDTH_MM}mm;
    }
  </style>
</head>
<body>${buildHtml(labels)}</body>
</html>`;
  }

  function renderPreview(labels, zplDocument, warnings = []) {
    const count = Array.isArray(labels) ? labels.length : 0;
    const warningHtml = warnings.length
      ? `<div class="health-label-warnings">${warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join('')}</div>`
      : '';
    return `<div class="health-label-preview-tools">
      <strong>${escapeHtml(count)} etiquette(s) ${escapeHtml(formatLabelSize(labels))}</strong>
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

  function print(labels) {
    if (!Array.isArray(labels) || !labels.length) return;
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.border = '0';
    frame.style.height = '0';
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    document.body.appendChild(frame);

    let didPrint = false;
    const cleanup = () => {
      setTimeout(() => frame.remove(), 250);
    };
    const printFrame = () => {
      if (didPrint) return;
      const frameWindow = frame.contentWindow;
      if (!frameWindow) {
        cleanup();
        return;
      }
      didPrint = true;
      frameWindow.focus();
      frameWindow.addEventListener('afterprint', cleanup, { once: true });
      frameWindow.print();
      setTimeout(cleanup, 2000);
    };

    const frameDocument = frame.contentDocument || frame.contentWindow?.document;
    if (!frameDocument) {
      cleanup();
      return;
    }
    frame.onload = printFrame;
    frameDocument.open();
    frameDocument.write(buildPrintDocument(labels));
    frameDocument.close();
    setTimeout(printFrame, 250);
  }

  window.HealthLabels = {
    askCopies,
    askLot,
    bindZplDownload,
    buildPrintDocument,
    buildHtml,
    escapeHtml,
    LABEL_PAGE_WIDTH_MM,
    LABEL_PAGE_HEIGHT_MM,
    PRINT_CARD_WIDTH_MM,
    PRINT_CARD_HEIGHT_MM,
    PRINT_SAFE_WIDTH_MM,
    PRINT_SAFE_HEIGHT_MM,
    TAB_X_START_MM,
    TAB_Y_START_MM,
    TAB_HEIGHT_MM,
    TAB_X_END_MM,
    TAB_WIDTH_MM,
    TAB_PHYSICAL_Y_START_MM,
    TAB_PHYSICAL_HEIGHT_MM,
    TAB_SAFE_Y_START_MM,
    TAB_SAFE_HEIGHT_MM,
    print,
    renderPreview,
    resolveLogoUrl,
    formatAllergen,
  };
}());
