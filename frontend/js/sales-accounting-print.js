(function () {
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  const API_BASE = window.APP_CONFIG?.API_BASE_URL;
  const saleId = new URLSearchParams(window.location.search).get('id');
  const invoiceButton = document.getElementById('print-invoice-btn');
  const creditNoteButton = document.getElementById('print-credit-note-btn');
  const printArea = document.getElementById('print-area');
  let currentSale = null;
  let currentInvoice = null;
  let currentCreditNote = null;

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

  function documentType() {
    return String(currentSale?.document_type || '').toUpperCase();
  }

  function isDeliveryNote() {
    return documentType() === 'DELIVERY_NOTE'
      || (String(currentSale?.origin || '').toLowerCase() === 'negoce'
        && ['delivered', 'delivery_note', 'validated', 'invoiced'].includes(String(currentSale?.status || '').toLowerCase()));
  }

  function buildFooter(settings, doc, isCreditNote) {
    return [
      doc.notes ? `<h3>${isCreditNote ? 'Motif / notes' : 'Notes'}</h3><p>${escapeHtml(doc.notes)}</p>` : '',
      settings.payment_terms ? `<h3>Paiement</h3><p><strong>Conditions de paiement :</strong> ${escapeHtml(settings.payment_terms)}</p>` : '',
      settings.iban ? `<p><strong>IBAN :</strong> ${escapeHtml(settings.iban)}</p>` : '',
      settings.bic ? `<p><strong>BIC :</strong> ${escapeHtml(settings.bic)}</p>` : '',
      settings.invoice_footer ? `<h3>Pied de facture</h3><p>${escapeHtml(settings.invoice_footer)}</p>` : '',
      settings.legal_mentions ? `<h3>Mentions legales</h3><p>${escapeHtml(settings.legal_mentions)}</p>` : '',
      settings.terms_and_conditions ? `<h3>CGV</h3><p>${escapeHtml(settings.terms_and_conditions)}</p>` : '',
    ].filter(Boolean).join('');
  }

  function buildAccountingPrintHtml(doc, lines, settings, options) {
    const deliveredStoreId = doc.client_store_identifier || doc.delivered_client_store_identifier || '';
    const sourceInvoice = doc.source_invoice_reference || doc.source_invoice_id || '';
    const sourceDeliveryNote = doc.source_delivery_note_reference || doc.source_delivery_note_id || '';
    const sourceOrder = doc.source_order_reference || doc.source_order_id || '';
    const rows = (lines || []).map((line) => {
      const details = [escapeHtml(line.article_plu || ''), lineTrace(line)].filter(Boolean).join('<br>');
      return `<tr>
      <td>${escapeHtml(line.line_number || '')}</td>
      <td><strong>${escapeHtml(line.article_label || '-')}</strong><small>${details || '-'}</small></td>
      <td class="num">${number(line.package_count)}</td>
      <td class="num">${qty(line.weight_per_package)} ${escapeHtml(line.sale_unit || 'kg')}</td>
      <td class="num">${qty(line.total_weight || line.sold_quantity)} ${escapeHtml(line.sale_unit || 'kg')}</td>
      <td class="num">${money(line.unit_sale_price_ht)}</td>
      <td class="num">${money(line.line_amount_ht)}</td>
      <td class="num">${number(line.vat_rate).toFixed(2)} %</td>
      <td class="num">${money(line.line_vat_amount)}</td>
      <td class="num">${money(line.line_amount_ttc)}</td>
    </tr>`;
    }).join('');

    return `<article class="accounting-print-document">
      <header class="sales-print-header">
        <div class="sales-print-company">
          ${settings.logo_url ? `<img class="sales-print-logo" src="${escapeHtml(settings.logo_url)}" alt="Logo ${escapeHtml(settings.company_name || 'Gestion Commerciale')}">` : ''}
          <div>
            <h1>${escapeHtml(settings.company_name || 'Gestion Commerciale')}</h1>
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
          <p class="sales-print-label">${escapeHtml(options.label)}</p>
          <h2>${escapeHtml(doc.reference_number || doc.id || options.label)}</h2>
          <p>Date : <strong>${formatDate(doc.document_date)}</strong></p>
        </div>
      </header>

      <section class="accounting-print-links">
        ${sourceInvoice ? `<p>Facture source : <strong>${escapeHtml(sourceInvoice)}</strong></p>` : ''}
        ${sourceDeliveryNote ? `<p>BL source : <strong>${escapeHtml(sourceDeliveryNote)}</strong></p>` : ''}
        ${sourceOrder ? `<p>Commande source : <strong>${escapeHtml(sourceOrder)}</strong></p>` : ''}
      </section>

      <section class="sales-print-parties">
        <div class="sales-print-party-card">
          <h3>Client facture</h3>
          <p class="sales-print-party-name">${escapeHtml(doc.billed_client_name || doc.billed_client_name_snapshot || doc.client_name || '-')}</p>
          ${doc.billed_client_code ? `<p>Code client : <strong>${escapeHtml(doc.billed_client_code)}</strong></p>` : ''}
        </div>
        <div class="sales-print-party-card">
          <h3>Client livre</h3>
          <p class="sales-print-party-name">${escapeHtml(doc.delivered_client_name || doc.delivered_client_name_snapshot || '-')}</p>
          ${deliveredStoreId ? `<p>Identifiant magasin : <strong>${escapeHtml(deliveredStoreId)}</strong></p>` : ''}
          ${addressBlock([doc.address_line1, doc.address_line2, [doc.postal_code, doc.city].filter(Boolean).join(' ')])}
        </div>
      </section>

      <table class="print-table accounting-lines-table">
        <thead><tr><th>Ligne</th><th>Designation</th><th>Colis</th><th>Poids/colis</th><th>Poids total</th><th>Prix HT</th><th>Total HT</th><th>TVA</th><th>Montant TVA</th><th>TTC</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="10">Aucune ligne.</td></tr>'}</tbody>
      </table>

      <section class="accounting-print-bottom">
        <div class="accounting-print-footer-note">${buildFooter(settings, doc, options.isCreditNote)}</div>
        <div class="bl-totals">
          <p><span>${options.isCreditNote ? 'Total HT credite' : 'Total HT'}</span><strong>${money(doc.total_amount_ex_vat)}</strong></p>
          <p><span>${options.isCreditNote ? 'TVA creditee' : 'TVA'}</span><strong>${money(doc.total_vat_amount)}</strong></p>
          <p class="grand-total"><span>${options.isCreditNote ? 'Total TTC credite' : 'Total TTC'}</span><strong>${money(doc.total_amount_inc_vat)}</strong></p>
        </div>
      </section>
      <p class="accounting-print-pennylane">Statut Pennylane : ${escapeHtml(doc.pennylane_status || 'not_sent')}</p>
    </article>`;
  }

  async function refreshButtons() {
    if (!saleId || !API_BASE || !token) return;
    const data = await request(`/api/sales/${saleId}`);
    currentSale = data.sale || null;
    currentInvoice = null;
    currentCreditNote = null;

    if (isDeliveryNote() && currentSale?.id) {
      currentInvoice = (await request(`/api/delivery-notes/${currentSale.id}/invoice`).catch(() => null))?.invoice || null;
    }
    if (documentType() === 'INVOICE') {
      currentInvoice = currentSale;
      const creditNotes = (await request(`/api/invoices/${currentSale.id}/credit-notes`).catch(() => null))?.credit_notes || [];
      currentCreditNote = creditNotes[0] || null;
    }
    if (documentType() === 'CREDIT_NOTE') currentCreditNote = currentSale;

    invoiceButton?.classList.toggle('hidden', !currentInvoice?.id);
    creditNoteButton?.classList.toggle('hidden', !currentCreditNote?.id);
    if (invoiceButton) invoiceButton.disabled = !currentInvoice?.id;
    if (creditNoteButton) creditNoteButton.disabled = !currentCreditNote?.id;
  }

  async function printInvoice() {
    if (!currentInvoice?.id || !printArea) return;
    const data = await request(`/api/invoices/${currentInvoice.id}/print-data`);
    printArea.innerHTML = buildAccountingPrintHtml(data.invoice || {}, data.lines || [], data.store_settings || {}, { label: 'Facture client', isCreditNote: false });
    window.print();
  }

  async function printCreditNote() {
    if (!currentCreditNote?.id || !printArea) return;
    const data = await request(`/api/credit-notes/${currentCreditNote.id}/print-data`);
    printArea.innerHTML = buildAccountingPrintHtml(data.credit_note || {}, data.lines || [], data.store_settings || {}, { label: 'AVOIR CLIENT', isCreditNote: true });
    window.print();
  }

  invoiceButton?.addEventListener('click', () => printInvoice().catch(console.error));
  creditNoteButton?.addEventListener('click', () => printCreditNote().catch(console.error));
  setTimeout(() => refreshButtons().catch(console.error), 350);
}());
