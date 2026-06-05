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
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(number(value));
  }

  function qty(value) {
    return number(value).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  function formatDate(value) {
    if (!value) return '-';
    try { return new Intl.DateTimeFormat('fr-FR').format(new Date(value)); }
    catch { return String(value); }
  }

  function lotTraceDetails(lot) {
    return [
      lot.lot_code || lot.supplier_lot_number ? `Lot ${lot.lot_code || lot.supplier_lot_number}` : null,
      lot.dlc ? `DLC ${formatDate(lot.dlc)}` : null,
      lot.latin_name,
      lot.fao_zone ? `FAO ${lot.fao_zone}` : null,
      lot.sous_zone,
      lot.fishing_gear,
      lot.production_method,
    ].filter(Boolean).map(escapeHtml).join(' - ');
  }

  function lineTrace(line) {
    const allocationDetails = (line.allocations || []).map(lotTraceDetails).filter(Boolean);
    if (allocationDetails.length) return allocationDetails.join('<br>');
    const trace = line.traceability_snapshot || {};
    return [
      trace.lot_code || trace.supplier_lot_number ? `Lot ${trace.lot_code || trace.supplier_lot_number}` : null,
      trace.dlc ? `DLC ${formatDate(trace.dlc)}` : null,
      trace.latin_name,
      trace.fao_zone ? `FAO ${trace.fao_zone}` : null,
      trace.sous_zone,
      trace.fishing_gear || trace.engin,
      trace.production_method || trace.category,
    ].filter(Boolean).map(escapeHtml).join(' - ');
  }

  function infoLine(label, value) {
    return value ? `<p><span>${escapeHtml(label)}</span>${escapeHtml(value)}</p>` : '';
  }

  function addressBlock(parts) {
    return parts.filter(Boolean).map((part) => `<p>${escapeHtml(part)}</p>`).join('');
  }

  function buildDeliveryNotePrintHtml(document, lines, storeSettings = null) {
    const settings = storeSettings || {};
    const companyName = settings.company_name || 'Gestion Commerciale';
    const deliveredStoreId = document.client_store_identifier || document.delivered_client_store_identifier || '';
    const sourceOrder = document.source_order_reference || document.source_order_id || '';
    const rows = (lines || []).map((line) => `<tr><td>${escapeHtml(line.line_number || '')}</td><td>${escapeHtml(line.article_plu || '')}</td><td><strong>${escapeHtml(line.article_label || '-')}</strong><small>${lineTrace(line) || '-'}</small></td><td class="num">${number(line.package_count)}</td><td class="num">${qty(line.weight_per_package)} ${escapeHtml(line.sale_unit || 'kg')}</td><td class="num">${qty(line.total_weight || line.sold_quantity)} ${escapeHtml(line.sale_unit || 'kg')}</td><td class="num">${money(line.unit_sale_price_ht)}</td><td class="num">${money(line.line_amount_ht)}</td><td class="num">${number(line.vat_rate).toFixed(2)} %</td><td class="num">${money(line.line_amount_ttc)}</td></tr>`).join('');

    return `<article class="bl-print-document">
      <header class="bl-print-header">
        <div class="bl-company">
          ${settings.logo_url ? `<img class="bl-logo" src="${escapeHtml(settings.logo_url)}" alt="Logo ${escapeHtml(companyName)}">` : ''}
          <div>
            <h1>${escapeHtml(companyName)}</h1>
            ${addressBlock([settings.address_line1, settings.address_line2, [settings.postal_code, settings.city].filter(Boolean).join(' '), settings.country])}
            <div class="bl-company-meta">
              ${infoLine('Tél.', settings.phone)}
              ${infoLine('Email', settings.email)}
              ${infoLine('SIRET', settings.siret)}
              ${infoLine('TVA', settings.vat_number)}
              ${infoLine('Agrément sanitaire', settings.sanitary_approval_number)}
            </div>
          </div>
        </div>
        <div class="bl-document-meta">
          <p class="bl-label">Bon de livraison</p>
          <h2>${escapeHtml(document.reference_number || document.id)}</h2>
          <p>Date : <strong>${formatDate(document.document_date)}</strong></p>
          ${sourceOrder ? `<p>Commande : <strong>${escapeHtml(sourceOrder)}</strong></p>` : ''}
        </div>
      </header>

      <section class="bl-parties">
        <div class="bl-party-card">
          <h3>Client livré</h3>
          <p class="bl-party-name">${escapeHtml(document.client_name || document.delivered_client_name_snapshot || '-')}</p>
          ${deliveredStoreId ? `<p>Identifiant magasin : <strong>${escapeHtml(deliveredStoreId)}</strong></p>` : ''}
          ${addressBlock([document.address_line1, document.address_line2, [document.postal_code, document.city].filter(Boolean).join(' ')])}
        </div>
        <div class="bl-party-card">
          <h3>Client facturé</h3>
          <p class="bl-party-name">${escapeHtml(document.billed_client_name || document.billed_client_name_snapshot || '-')}</p>
          ${document.billed_client_code ? `<p>Code client : <strong>${escapeHtml(document.billed_client_code)}</strong></p>` : ''}
        </div>
      </section>

      <table class="print-table bl-lines-table">
        <thead><tr><th>Ligne</th><th>PLU</th><th>Désignation</th><th>Colis</th><th>Poids/colis</th><th>Poids total</th><th>Prix HT</th><th>Total HT</th><th>TVA</th><th>TTC</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="10">Aucune ligne.</td></tr>'}</tbody>
      </table>

      <section class="bl-bottom">
        <div class="bl-notes">
          ${document.notes ? `<h3>Notes</h3><p>${escapeHtml(document.notes)}</p>` : ''}
          ${settings.delivery_note_footer ? `<h3>Pied de bon de livraison</h3><p>${escapeHtml(settings.delivery_note_footer)}</p>` : ''}
        </div>
        <div class="bl-totals">
          <p><span>Total HT</span><strong>${money(document.total_amount_ex_vat)}</strong></p>
          <p><span>TVA</span><strong>${money(document.total_vat_amount)}</strong></p>
          <p class="grand-total"><span>Total TTC</span><strong>${money(document.total_amount_inc_vat)}</strong></p>
        </div>
      </section>

      <section class="bl-signature">
        <div><p>Date de réception</p></div>
        <div><p>Nom et signature du réceptionnaire</p></div>
        <div><p>Cachet client</p></div>
      </section>
    </article>`;
  }

  window.DeliveryNotePrint = {
    buildHtml: buildDeliveryNotePrintHtml,
    escapeHtml,
    formatDate,
    qty,
  };
}());
