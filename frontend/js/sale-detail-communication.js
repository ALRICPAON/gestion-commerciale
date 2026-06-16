(function () {
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  const API_BASE = window.APP_CONFIG.API_BASE_URL;
  const saleId = new URLSearchParams(window.location.search).get('id');
  const mailBtn = document.getElementById('send-mail-btn');
  const whatsappBtn = document.getElementById('send-whatsapp-btn');
  const feedbackEl = document.getElementById('sale-lines-feedback');

  let sale = null;
  let blOptions = null;
  let invoiceDefaults = null;
  let activeEmailKind = null;

  function clean(value) {
    const text = String(value ?? '').trim();
    return text || '';
  }

  function showFeedback(message, isError = false) {
    if (!feedbackEl) return;
    feedbackEl.textContent = message;
    feedbackEl.classList.remove('hidden');
    feedbackEl.classList.toggle('error', isError);
    feedbackEl.classList.toggle('success', !isError);
  }

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
    if (!response.ok) throw new Error(data.error || data.message || 'Erreur API');
    return data;
  }

  function documentType() {
    return String(sale?.document_type || '').toUpperCase();
  }

  function isDeliveryNote() {
    return documentType() === 'DELIVERY_NOTE';
  }

  function isInvoice() {
    return documentType() === 'INVOICE';
  }

  function deliveryNoteReference() {
    return blOptions?.delivery_note_reference || sale?.reference_number || sale?.id || '';
  }

  function invoiceReference() {
    return invoiceDefaults?.invoice_reference || sale?.reference_number || sale?.id || '';
  }

  function defaultDeliveryNoteMessage() {
    return `Bonjour,\n\nVeuillez trouver ci-joint votre bon de livraison ${deliveryNoteReference()}.\n\nCordialement,\nALTA MARÉE`;
  }

  function defaultInvoiceMessage() {
    return invoiceDefaults?.message || `Bonjour,\n\nVeuillez trouver ci-joint votre facture ${invoiceReference()}.\n\nCordialement,\nALTA MARÉE`;
  }

  function ensureModal() {
    if (document.getElementById('document-email-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'document-email-modal';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <div>
            <h3 id="document-email-modal-title">Envoyer par email</h3>
            <p id="document-email-modal-helper">Le document PDF sera joint automatiquement.</p>
          </div>
          <button type="button" id="close-document-email-modal-btn" class="btn btn-secondary">Fermer</button>
        </div>
        <div class="form-grid">
          <div class="form-group form-group-span-2">
            <label for="document-email-to">Destinataire</label>
            <input id="document-email-to" type="email" autocomplete="email" />
          </div>
          <div class="form-group form-group-span-2">
            <label for="document-email-subject">Objet</label>
            <input id="document-email-subject" type="text" />
          </div>
          <div class="form-group form-group-span-2">
            <label for="document-email-message">Message</label>
            <textarea id="document-email-message" rows="6"></textarea>
          </div>
        </div>
        <div class="page-actions-right">
          <button type="button" id="send-document-email-confirm-btn" class="btn btn-primary">Envoyer</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('close-document-email-modal-btn')?.addEventListener('click', closeModal);
    document.getElementById('send-document-email-confirm-btn')?.addEventListener('click', sendEmail);
  }

  function modalField(id) {
    return document.getElementById(id);
  }

  function openModal(kind) {
    ensureModal();
    activeEmailKind = kind;
    const isInvoiceEmail = kind === 'invoice';
    const reference = isInvoiceEmail ? invoiceReference() : deliveryNoteReference();
    modalField('document-email-modal-title').textContent = isInvoiceEmail ? 'Envoyer la facture par email' : 'Envoyer le BL par email';
    modalField('document-email-to').value = isInvoiceEmail ? clean(invoiceDefaults?.email) : clean(blOptions?.email);
    modalField('document-email-subject').value = isInvoiceEmail ? `Facture ${reference}` : `Bon de livraison ${reference}`;
    modalField('document-email-message').value = isInvoiceEmail ? defaultInvoiceMessage() : defaultDeliveryNoteMessage();
    document.getElementById('document-email-modal')?.classList.remove('hidden');
  }

  function closeModal() {
    document.getElementById('document-email-modal')?.classList.add('hidden');
  }

  async function sendEmail() {
    const to = clean(modalField('document-email-to')?.value);
    const subject = clean(modalField('document-email-subject')?.value);
    const message = clean(modalField('document-email-message')?.value);
    if (!to) {
      showFeedback('Renseigne un destinataire email.', true);
      return;
    }

    const button = modalField('send-document-email-confirm-btn');
    if (button) button.disabled = true;
    try {
      const path = activeEmailKind === 'invoice'
        ? `/api/communication/send-invoice-email/${sale.id}`
        : `/api/communication/send-delivery-note-email/${sale.id}`;
      const result = await request(path, {
        method: 'POST',
        body: JSON.stringify({ to, subject, message }),
      });
      closeModal();
      showFeedback(`Email envoyé à ${result.to}`);
    } catch (err) {
      showFeedback(err.message || 'Erreur envoi email', true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function normalizeWhatsappPhone(phone) {
    let digits = clean(phone).replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0')) digits = `33${digits.slice(1)}`;
    return digits;
  }

  function openInvoiceWhatsapp() {
    const message = invoiceDefaults?.whatsapp_message || `Bonjour, votre facture ${invoiceReference()} est disponible. Cordialement, ALTA MARÉE.`;
    const phone = normalizeWhatsappPhone(invoiceDefaults?.phone);
    const encoded = encodeURIComponent(message);
    const url = phone
      ? `https://web.whatsapp.com/send?phone=${phone}&text=${encoded}`
      : `https://web.whatsapp.com/send?text=${encoded}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function refresh() {
    if (!saleId || !mailBtn || !whatsappBtn) return;
    try {
      const data = await request(`/api/sales/${saleId}`);
      sale = data.sale || null;
      blOptions = null;
      invoiceDefaults = null;

      if (isDeliveryNote()) {
        blOptions = await request(`/api/delivery-notes/${sale.id}/communication-options`).catch(() => null);
      }
      if (isInvoice()) {
        invoiceDefaults = await request(`/api/communication/invoices/${sale.id}/defaults`).catch(() => null);
      }

      updateButtons();
    } catch (err) {
      console.warn('Communication document indisponible :', err.message);
    }
  }

  function updateButtons() {
    const visible = isDeliveryNote() || isInvoice();
    mailBtn.classList.toggle('hidden', !visible);
    whatsappBtn.classList.toggle('hidden', !visible);

    if (isInvoice()) {
      mailBtn.disabled = false;
      mailBtn.textContent = '📧 Envoyer par email';
      mailBtn.title = invoiceDefaults?.email ? `Envoyer à ${invoiceDefaults.email}` : 'Destinataire à renseigner';
      whatsappBtn.disabled = false;
      whatsappBtn.textContent = '💬 WhatsApp';
      whatsappBtn.title = invoiceDefaults?.phone ? `Ouvrir WhatsApp pour ${invoiceDefaults.phone}` : 'Ouvrir WhatsApp Web';
      return;
    }

    if (isDeliveryNote()) {
      mailBtn.disabled = false;
      mailBtn.textContent = '📧 Envoyer par email';
      mailBtn.title = blOptions?.email ? `Envoyer à ${blOptions.email}` : 'Destinataire à renseigner';
      whatsappBtn.disabled = !(blOptions?.can_send_whatsapp);
      whatsappBtn.textContent = '💬 WhatsApp';
    }
  }

  mailBtn?.addEventListener('click', (event) => {
    if (!isDeliveryNote() && !isInvoice()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openModal(isInvoice() ? 'invoice' : 'delivery_note');
  }, true);

  whatsappBtn?.addEventListener('click', (event) => {
    if (!isInvoice()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openInvoiceWhatsapp();
  }, true);

  ensureModal();
  setTimeout(refresh, 350);
  window.setInterval(refresh, 1500);
}());
