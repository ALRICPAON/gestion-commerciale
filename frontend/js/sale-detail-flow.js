(function () {
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  const API_BASE = window.APP_CONFIG.API_BASE_URL;
  const saleId = new URLSearchParams(window.location.search).get('id');
  const flowEls = {
    orderPdf: document.getElementById('download-order-pdf-btn'),
    blPdf: document.getElementById('download-bl-pdf-btn'),
    invoicePdf: document.getElementById('download-invoice-pdf-btn'),
    creditNotePdf: document.getElementById('download-credit-note-pdf-btn'),
    validateBl: document.getElementById('validate-bl-flow-btn'),
    printBl: document.getElementById('print-bl-btn'),
    labels: document.getElementById('print-health-labels-btn'),
    invoice: document.getElementById('validate-invoice-btn'),
    creditNote: document.getElementById('create-credit-note-btn'),
    creditNoteModal: document.getElementById('customer-credit-note-modal'),
    closeCreditNoteModal: document.getElementById('close-credit-note-modal-btn'),
    creditNoteType: document.getElementById('credit-note-type-select'),
    creditNoteReturnStock: document.getElementById('credit-note-return-stock-select'),
    creditNoteNotes: document.getElementById('credit-note-notes-input'),
    creditNoteLinesBody: document.getElementById('credit-note-lines-table-body'),
    confirmCreditNote: document.getElementById('confirm-credit-note-btn'),
    mail: document.getElementById('send-mail-btn'),
    whatsapp: document.getElementById('send-whatsapp-btn'),
    printArea: document.getElementById('print-area'),
    lineBody: document.getElementById('sale-lines-table-body'),
    feedback: document.getElementById('sale-lines-feedback'),
  };
  let currentSale = null;
  let currentLines = [];
  let currentInvoice = null;
  let currentCreditNotes = [];
  let communicationOptions = null;

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || data.error || 'Erreur API');
      error.status = response.status;
      error.code = data.code;
      error.details = data.details || {};
      error.payload = data;
      throw error;
    }
    return data;
  }

  async function postWithStockConfirmation(path, payload = {}) {
    const firstPayload = { ...payload };
    console.info('Validation BL payload envoyé', { path, payload: firstPayload });
    try {
      return await request(path, { method: 'POST', body: JSON.stringify(firstPayload) });
    } catch (error) {
      if (error.status !== 409 || error.code !== 'STOCK_INSUFFICIENT') throw error;
      const missing = error.details?.missing_quantity ? `\nManque : ${qty(error.details.missing_quantity)}` : '';
      const confirmed = confirm(`Stock insuffisant. Voulez-vous valider quand même en sortie forcée ?${missing}`);
      if (!confirmed) throw error;
      const forcedPayload = { ...payload, allow_negative_stock: true };
      console.info('Validation BL payload envoyé après confirmation', { path, payload: forcedPayload });
      return request(path, { method: 'POST', body: JSON.stringify(forcedPayload) });
    }
  }

  async function downloadPdf(path, fallbackName) {
    const response = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Erreur generation PDF');
    }
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match?.[1] || fallbackName;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function feedback(message, isError = false) {
    if (!flowEls.feedback) return;
    flowEls.feedback.textContent = message;
    flowEls.feedback.classList.remove('hidden');
    flowEls.feedback.classList.toggle('error', isError);
    flowEls.feedback.classList.toggle('success', !isError);
  }

  function number(value) {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function qty(value) {
    return number(value).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    }[char]));
  }

  function documentType() {
    return String(currentSale?.document_type || '').toUpperCase();
  }

  function isNegoce() {
    return String(currentSale?.origin || '').toLowerCase() === 'negoce';
  }

  function isDeliveryNote() {
    return documentType() === 'DELIVERY_NOTE'
      || (isNegoce() && ['delivered', 'delivery_note', 'validated'].includes(String(currentSale?.status || '').toLowerCase()));
  }

  function invoiceId() {
    return currentSale?.document_type === 'INVOICE' ? currentSale.id : currentInvoice?.id;
  }

  function creditNoteId() {
    return documentType() === 'CREDIT_NOTE' ? currentSale.id : currentCreditNotes[0]?.id;
  }

  function isFactured() {
    return String(currentSale?.status || '').toLowerCase() === 'invoiced'
      || !!currentInvoice?.id
      || !!currentSale?.invoice_id
      || !!currentSale?.invoice_reference
      || !!currentSale?.source_invoice_id
      || !!currentSale?.invoiced_at;
  }

  function canValidateBl() {
    return documentType() === 'ORDER' && currentSale?.status === 'draft';
  }

  function show(el, visible) {
    if (!el) return;
    el.classList.toggle('hidden', !visible);
  }

  async function refreshState() {
    if (!saleId) return;
    const data = await request(`/api/sales/${saleId}`);
    currentSale = data.sale || null;
    currentLines = Array.isArray(data.lines) ? data.lines : [];
    currentInvoice = null;
    currentCreditNotes = [];
    communicationOptions = null;
    if (isDeliveryNote() && currentSale?.id) {
      communicationOptions = await request(`/api/delivery-notes/${currentSale.id}/communication-options`).catch(() => null);
      const invoiceData = await request(`/api/delivery-notes/${currentSale.id}/invoice`).catch(() => null);
      currentInvoice = invoiceData?.invoice || null;
    }
    if (documentType() === 'INVOICE' && currentSale?.id) {
      const creditNotesData = await request(`/api/invoices/${currentSale.id}/credit-notes`).catch(() => null);
      currentCreditNotes = Array.isArray(creditNotesData?.credit_notes) ? creditNotesData.credit_notes : [];
    }
    refreshButtons();
    enhanceLineActions();
  }

  function refreshButtons() {
    const isOrder = documentType() === 'ORDER';
    const isBl = isDeliveryNote();
    const isBlDocument = documentType() === 'DELIVERY_NOTE';
    const isInvoice = documentType() === 'INVOICE';
    const isCreditNote = documentType() === 'CREDIT_NOTE';
    const factured = isFactured();
    const hasInvoicePdf = isInvoice || !!invoiceId();
    const hasCreditNotePdf = isCreditNote || !!creditNoteId();
    show(flowEls.orderPdf, isOrder);
    show(flowEls.blPdf, isBlDocument);
    show(flowEls.invoicePdf, hasInvoicePdf);
    show(flowEls.creditNotePdf, hasCreditNotePdf);
    show(flowEls.validateBl, canValidateBl());
    show(flowEls.printBl, isBl);
    show(flowEls.labels, isBl);
    show(flowEls.invoice, isBl && !factured);
    show(flowEls.creditNote, isInvoice);
    show(flowEls.mail, isBl);
    show(flowEls.whatsapp, isBl);
    if (flowEls.orderPdf) flowEls.orderPdf.disabled = !isOrder;
    if (flowEls.blPdf) flowEls.blPdf.disabled = !isBlDocument;
    if (flowEls.invoicePdf) {
      flowEls.invoicePdf.disabled = !hasInvoicePdf;
      flowEls.invoicePdf.textContent = 'Télécharger PDF facture';
    }
    if (flowEls.creditNotePdf) flowEls.creditNotePdf.disabled = !hasCreditNotePdf;
    if (flowEls.validateBl) flowEls.validateBl.disabled = !canValidateBl();
    if (flowEls.printBl) flowEls.printBl.disabled = !isBl;
    if (flowEls.labels) flowEls.labels.disabled = !isBl;
    if (flowEls.invoice) flowEls.invoice.disabled = !(isBl && !factured && currentSale?.status === 'validated');
    if (flowEls.creditNote) flowEls.creditNote.disabled = !isInvoice;
    if (flowEls.mail) {
      flowEls.mail.disabled = !(isBl && communicationOptions?.can_send_email);
      flowEls.mail.title = communicationOptions?.can_send_email ? `Envoyer à ${communicationOptions.email}` : 'Aucun email client disponible';
    }
    if (flowEls.whatsapp) {
      flowEls.whatsapp.disabled = !(isBl && communicationOptions?.can_send_whatsapp);
      flowEls.whatsapp.title = communicationOptions?.can_send_whatsapp ? `Envoyer à ${communicationOptions.whatsapp_phone}` : 'Aucun téléphone WhatsApp disponible';
    }
  }

  async function validateBlFromSale() {
    await refreshState();
    if (!canValidateBl()) return;
    if (!confirm('Valider en BL ? Cette action génère le BL et déstocke les lots disponibles.')) return;
    const data = await postWithStockConfirmation(`/api/sales/${currentSale.id}/validate-delivery-note`, {});
    const nextId = data.delivery_note_id || data.id;
    feedback(data.forced_stock_exit ? 'Commande validée en BL avec sortie forcée tracée' : 'Commande validée en BL');
    if (nextId) window.location.href = `./sale-detail.html?id=${encodeURIComponent(nextId)}`;
    else window.location.reload();
  }

  async function downloadOrderPdf() {
    await refreshState();
    if (documentType() !== 'ORDER') return;
    flowEls.orderPdf.disabled = true;
    try {
      await downloadPdf(`/api/sales/${currentSale.id}/pdf`, 'commande-client.pdf');
      feedback('PDF commande généré');
    } finally {
      flowEls.orderPdf.disabled = false;
    }
  }

  async function downloadDeliveryNotePdf() {
    await refreshState();
    if (documentType() !== 'DELIVERY_NOTE') return;
    flowEls.blPdf.disabled = true;
    try {
      await downloadPdf(`/api/delivery-notes/${currentSale.id}/pdf`, 'bon-de-livraison.pdf');
      feedback('PDF BL généré');
    } finally {
      flowEls.blPdf.disabled = false;
    }
  }

  async function downloadInvoicePdf() {
    await refreshState();
    const id = invoiceId();
    if (!id) return;
    flowEls.invoicePdf.disabled = true;
    try {
      await downloadPdf(`/api/invoices/${id}/pdf`, 'facture-client.pdf');
      feedback('PDF facture généré');
    } finally {
      flowEls.invoicePdf.disabled = false;
    }
  }

  async function downloadCreditNotePdf() {
    await refreshState();
    const id = creditNoteId();
    if (!id) return;
    flowEls.creditNotePdf.disabled = true;
    try {
      await downloadPdf(`/api/credit-notes/${id}/pdf`, 'avoir-client.pdf');
      feedback('PDF avoir généré');
    } finally {
      flowEls.creditNotePdf.disabled = false;
    }
  }

  async function printDeliveryNote() {
    await refreshState();
    if (!isDeliveryNote()) return;
    const data = await request(`/api/delivery-notes/${currentSale.id}/print-data`);
    flowEls.printArea.innerHTML = window.DeliveryNotePrint.buildHtml(data.document, data.lines || [], data.store_settings);
    window.print();
  }

  function renderCreditNoteLines() {
    if (!flowEls.creditNoteLinesBody) return;
    const isTotal = flowEls.creditNoteType?.value !== 'partial';
    flowEls.creditNoteLinesBody.innerHTML = currentLines.map((line) => {
      const quantity = number(line.sold_quantity || line.total_weight);
      return `<tr data-line-id="${line.id}">
        <td>${escapeHtml(line.line_number || '')}</td>
        <td>${escapeHtml(line.article_label || '-')}<br><small>${escapeHtml(line.article_plu || '')}</small></td>
        <td>${qty(quantity)} ${escapeHtml(line.sale_unit || 'kg')}</td>
        <td><input class="line-input credit-note-line-quantity" type="number" min="0" step="0.001" max="${quantity}" value="${quantity}" ${isTotal ? 'disabled' : ''}></td>
      </tr>`;
    }).join('') || '<tr><td colspan="4">Aucune ligne facturée.</td></tr>';
  }

  async function openCreditNoteModal() {
    await refreshState();
    if (documentType() !== 'INVOICE') return;
    if (flowEls.creditNoteType) flowEls.creditNoteType.value = 'total';
    if (flowEls.creditNoteReturnStock) flowEls.creditNoteReturnStock.value = 'false';
    if (flowEls.creditNoteNotes) flowEls.creditNoteNotes.value = '';
    renderCreditNoteLines();
    flowEls.creditNoteModal?.classList.remove('hidden');
  }

  async function createCreditNote() {
    await refreshState();
    if (documentType() !== 'INVOICE') return;
    const creditType = flowEls.creditNoteType?.value || 'total';
    const lines = creditType === 'partial'
      ? Array.from(flowEls.creditNoteLinesBody?.querySelectorAll('tr[data-line-id]') || []).map((row) => ({
        source_invoice_line_id: row.dataset.lineId,
        quantity: number(row.querySelector('.credit-note-line-quantity')?.value),
      })).filter((line) => line.quantity > 0)
      : [];
    if (creditType === 'partial' && !lines.length) {
      feedback('Sélectionne au moins une quantité à créditer', true);
      return;
    }
    const data = await request(`/api/invoices/${currentSale.id}/credit-notes`, {
      method: 'POST',
      body: JSON.stringify({
        type: creditType,
        return_stock: flowEls.creditNoteReturnStock?.value === 'true',
        notes: flowEls.creditNoteNotes?.value || null,
        lines,
      }),
    });
    flowEls.creditNoteModal?.classList.add('hidden');
    feedback(`Avoir créé : ${data.credit_note_reference || data.credit_note_id || ''}`);
    await refreshState();
  }

  function labelTrace(label) {
    const trace = label.traceability || {};
    const lots = (label.lots || []).map((lot) => [
      lot.lot_code || lot.supplier_lot_number,
      lot.dlc ? `DLC ${window.DeliveryNotePrint.formatDate(lot.dlc)}` : null,
    ].filter(Boolean).join(' - ')).filter(Boolean).join(', ');
    return lots || trace.lot_code || trace.supplier_lot_number || '-';
  }

  function buildLabelsHtml(labels) {
    const esc = window.DeliveryNotePrint.escapeHtml;
    const labelQty = window.DeliveryNotePrint.qty;
    return `<section class="health-label-print-sheet">${(labels || []).map((label) => {
      const trace = label.traceability || {};
      return `<article class="health-label-print-card">
        <h2>${esc(label.article_label || 'Article')}</h2>
        <p><strong>Client livré :</strong> ${esc(label.delivered_client_name || '-')}</p>
        <p><strong>Identifiant magasin :</strong> ${esc(label.delivered_client_store_identifier || '-')}</p>
        <p><strong>BL :</strong> ${esc(label.delivery_note_reference || '-')}</p>
        <p><strong>Ligne :</strong> ${esc(label.line_number || '-')}</p>
        <p><strong>Quantité :</strong> ${labelQty(label.quantity)} ${esc(label.unit || 'kg')}</p>
        <p><strong>Lot :</strong> ${esc(labelTrace(label))}</p>
        <p><strong>Zone FAO :</strong> ${esc(trace.fao_zone || '-')}</p>
        <p><strong>Méthode :</strong> ${esc(trace.production_method || '-')}</p>
      </article>`;
    }).join('')}</section>`;
  }

  async function printHealthLabels(lineNumber = null) {
    await refreshState();
    if (!isDeliveryNote()) return;
    const data = await request(`/api/delivery-notes/${currentSale.id}/health-labels`);
    let labels = data.labels || [];
    if (lineNumber !== null) labels = labels.filter((label) => Number(label.line_number) === Number(lineNumber));
    if (!labels.length) {
      feedback('Aucune étiquette sanitaire trouvée pour cette sélection', true);
      return;
    }
    flowEls.printArea.innerHTML = buildLabelsHtml(labels);
    window.print();
  }

  async function validateInvoiceFromBl() {
    await refreshState();
    if (!isDeliveryNote() || isFactured()) return;
    if (!confirm('Valider ce BL en facture ?')) return;
    const data = await request(`/api/delivery-notes/${currentSale.id}/validate-invoice`, { method: 'POST', body: JSON.stringify({}) });
    feedback(data.existing ? 'Facture déjà préparée' : `Facture préparée : ${data.invoice_reference || data.invoice_id || ''}`);
    await refreshState();
  }

  async function sendDeliveryNoteEmail() {
    await refreshState();
    if (!isDeliveryNote() || !communicationOptions?.can_send_email) return;
    if (!confirm(`Envoyer le BL par email à ${communicationOptions.email} ?`)) return;
    const data = await request(`/api/delivery-notes/${currentSale.id}/send-email`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    feedback(`Email BL envoyé à ${data.to}`);
  }

  async function sendDeliveryNoteWhatsapp() {
    await refreshState();
    if (!isDeliveryNote() || !communicationOptions?.can_send_whatsapp) return;
    if (!confirm(`Envoyer le message WhatsApp du BL à ${communicationOptions.whatsapp_phone} ?`)) return;
    const data = await request(`/api/delivery-notes/${currentSale.id}/send-whatsapp`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    feedback(`Message WhatsApp BL envoyé à ${data.to}`);
  }

  function enhanceLineActions() {
    if (!flowEls.lineBody || !isDeliveryNote()) return;
    flowEls.lineBody.querySelectorAll('tr[data-line-id]').forEach((row) => {
      if (row.querySelector('[data-action="print-line-label-flow"]')) return;
      const line = currentLines.find((item) => item.id === row.dataset.lineId);
      const actionsCell = row.querySelector('td:last-child');
      if (!line || !actionsCell) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary btn-sm line-label-btn';
      button.dataset.action = 'print-line-label-flow';
      button.dataset.lineNumber = line.line_number;
      button.textContent = 'Étiquette';
      actionsCell.appendChild(button);
    });
  }

  flowEls.orderPdf?.addEventListener('click', () => downloadOrderPdf().catch((error) => feedback(error.message, true)));
  flowEls.blPdf?.addEventListener('click', () => downloadDeliveryNotePdf().catch((error) => feedback(error.message, true)));
  flowEls.invoicePdf?.addEventListener('click', () => downloadInvoicePdf().catch((error) => feedback(error.message, true)));
  flowEls.creditNotePdf?.addEventListener('click', () => downloadCreditNotePdf().catch((error) => feedback(error.message, true)));
  flowEls.validateBl?.addEventListener('click', () => validateBlFromSale().catch((error) => feedback(error.message, true)));
  flowEls.printBl?.addEventListener('click', () => printDeliveryNote().catch((error) => feedback(error.message, true)));
  flowEls.labels?.addEventListener('click', () => printHealthLabels().catch((error) => feedback(error.message, true)));
  flowEls.invoice?.addEventListener('click', () => validateInvoiceFromBl().catch((error) => feedback(error.message, true)));
  flowEls.creditNote?.addEventListener('click', () => openCreditNoteModal().catch((error) => feedback(error.message, true)));
  flowEls.closeCreditNoteModal?.addEventListener('click', () => flowEls.creditNoteModal?.classList.add('hidden'));
  flowEls.creditNoteType?.addEventListener('change', renderCreditNoteLines);
  flowEls.confirmCreditNote?.addEventListener('click', () => createCreditNote().catch((error) => feedback(error.message, true)));
  flowEls.mail?.addEventListener('click', () => sendDeliveryNoteEmail().catch((error) => feedback(error.message, true)));
  flowEls.whatsapp?.addEventListener('click', () => sendDeliveryNoteWhatsapp().catch((error) => feedback(error.message, true)));
  flowEls.lineBody?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="print-line-label-flow"]');
    if (!button) return;
    printHealthLabels(button.dataset.lineNumber).catch((error) => feedback(error.message, true));
  });

  const observer = new MutationObserver(() => { refreshState().catch(() => {}); });
  if (flowEls.lineBody) observer.observe(flowEls.lineBody, { childList: true });
  setTimeout(() => refreshState().catch((error) => feedback(error.message, true)), 250);
}());
