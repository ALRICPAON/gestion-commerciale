(function () {
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  const API_BASE = window.APP_CONFIG?.API_BASE_URL;
  const saleId = new URLSearchParams(window.location.search).get('id');

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

  function qty(value) {
    return number(value).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  function formatDate(value) {
    if (!value) return '-';
    try { return new Intl.DateTimeFormat('fr-FR').format(new Date(value)); }
    catch { return String(value); }
  }

  function documentYear(value) {
    const date = value ? new Date(value) : new Date();
    return Number.isFinite(date.getTime()) ? date.getFullYear() : new Date().getFullYear();
  }

  function displayReference(document, prefix) {
    const reference = String(document?.reference_number || '').trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reference);
    if (reference && !isUuid) return reference;
    const shortId = String(document?.id || reference || '').replace(/-/g, '').slice(0, 8).toUpperCase();
    return `${prefix}-${documentYear(document?.document_date || document?.created_at)}-${shortId || 'ANCIEN'}`;
  }

  function addressBlock(parts) {
    return parts.filter(Boolean).map((part) => `<p>${escapeHtml(part)}</p>`).join('');
  }

  function infoLine(label, value) {
    return value ? `<p><span>${escapeHtml(label)}</span>${escapeHtml(value)}</p>` : '';
  }

  async function request(path) {
    const response = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur API');
    return data;
  }

  function buildHtml(sale, lines, storeSettings = null) {
    const settings = storeSettings || {};
    const companyName = settings.company_name || 'Gestion Commerciale';
    const reference = displayReference(sale, 'CMD') || 'Commande';
    const deliveredStoreId = sale.client_store_identifier || sale.delivered_client_store_identifier || '';
    const rows = (lines || []).map((line) => `<tr>
      <td class="prep-check-cell"><span class="prep-check"></span></td>
      <td>${escapeHtml(line.article_plu || '')}</td>
      <td><strong>${escapeHtml(line.article_label || '-')}</strong></td>
      <td class="num">${number(line.package_count)}</td>
      <td class="num">${qty(line.weight_per_package)} ${escapeHtml(line.sale_unit || 'kg')}</td>
      <td class="num">${qty(line.total_weight || line.sold_quantity)} ${escapeHtml(line.sale_unit || 'kg')}</td>
      <td class="prep-comment-cell"></td>
    </tr>`).join('');

    return `<article class="order-print-document">
      <header class="sales-print-header">
        <div class="sales-print-company">
          ${settings.logo_url ? `<img class="sales-print-logo" src="${escapeHtml(settings.logo_url)}" alt="Logo ${escapeHtml(companyName)}">` : ''}
          <div>
            <h1>${escapeHtml(companyName)}</h1>
            ${addressBlock([settings.address_line1, settings.address_line2, [settings.postal_code, settings.city].filter(Boolean).join(' '), settings.country])}
            <div class="sales-print-company-meta">
              ${infoLine('Tel.', settings.phone)}
              ${infoLine('Email', settings.email)}
              ${infoLine('SIRET', settings.siret)}
              ${infoLine('TVA', settings.vat_number)}
              ${infoLine('Agrement sanitaire', settings.sanitary_approval_number)}
            </div>
          </div>
        </div>
        <div class="sales-print-document-meta">
          <p class="sales-print-label">Commande preparation</p>
          <h2>${escapeHtml(reference)}</h2>
          <p>Date : <strong>${formatDate(sale.document_date)}</strong></p>
        </div>
      </header>

      <section class="sales-print-parties">
        <div class="sales-print-party-card">
          <h3>Client livre</h3>
          <p class="sales-print-party-name">${escapeHtml(sale.client_name || sale.delivered_client_name_snapshot || '-')}</p>
          ${sale.client_code ? `<p>Code client : <strong>${escapeHtml(sale.client_code)}</strong></p>` : ''}
          ${deliveredStoreId ? `<p>Identifiant magasin : <strong>${escapeHtml(deliveredStoreId)}</strong></p>` : ''}
          ${addressBlock([sale.address_line1, sale.address_line2, [sale.postal_code, sale.city].filter(Boolean).join(' ')])}
        </div>
        <div class="sales-print-party-card">
          <h3>Preparation</h3>
          <p>Commande : <strong>${escapeHtml(reference)}</strong></p>
          <p>Origine : <strong>${escapeHtml(sale.origin === 'negoce' ? 'Negoce' : 'Classique')}</strong></p>
        </div>
      </section>

      <table class="print-table order-prep-lines-table">
        <thead><tr><th>Prep.</th><th>PLU</th><th>Designation</th><th>Colis</th><th>Poids/colis</th><th>Poids total</th><th>Commentaire</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7">Aucune ligne.</td></tr>'}</tbody>
      </table>

      <section class="order-print-footer">
        <div>${sale.notes ? `<h3>Notes preparation</h3><p>${escapeHtml(sale.notes)}</p>` : ''}</div>
        <div>Prepare par</div>
        <div>Controle par</div>
      </section>
    </article>`;
  }

  async function printOrder(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!saleId || !API_BASE || !token) return;
    const data = await request(`/api/sales/${saleId}/print-data`);
    const printArea = document.getElementById('print-area');
    if (!printArea) return;
    printArea.innerHTML = buildHtml(data.sale || {}, data.lines || [], data.store_settings);
    window.print();
  }

  document.getElementById('print-order-btn')?.addEventListener('click', (event) => {
    printOrder(event).catch((error) => {
      const feedback = document.getElementById('sale-lines-feedback');
      if (feedback) {
        feedback.textContent = error.message;
        feedback.classList.remove('hidden', 'success');
        feedback.classList.add('error');
      }
    });
  }, true);
}());
