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
  let activeWhatsappKind = null;

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

  function isOrder() {
    return documentType() === 'ORDER';
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

  function ensureEmailModal() {
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
    document.getElementById('close-document-email-modal-btn')?.addEventListener('click', closeEmailModal);
    document.getElementById('send-document-email-confirm-btn')?.addEventListener('click', sendEmail);
  }

  function ensureWhatsappModal() {
    if (document.getElementById('document-whatsapp-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'document-whatsapp-modal';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <div>
            <h3 id="document-whatsapp-modal-title">Envoyer par WhatsApp</h3>
            <p id="document-whatsapp-modal-helper">Vérifie le numéro et le message avant envoi.</p>
          </div>
          <button type="button" id="close-document-whatsapp-modal-btn" class="btn btn-secondary">Fermer</button>
        </div>
        <div class="form-grid">
          <div class="form-group form-group-span-2">
            <label for="document-whatsapp-to">Numéro WhatsApp</label>
            <input id="document-whatsapp-to" type="tel" autocomplete="tel" placeholder="+336..." />
          </div>
          <div class="form-group form-group-span-2">
            <label for="document-whatsapp-message">Message</label>
            <textarea id="document-whatsapp-message" rows="7"></textarea>
          </div>
        </div>
        <p class="helper-text">Si Meta refuse le texte libre hors conversation récente, il faudra utiliser un template WhatsApp officiel.</p>
        <div class="page-actions-right">
          <button type="button" id="send-document-whatsapp-confirm-btn" class="btn btn-primary">Envoyer</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('close-document-whatsapp-modal-btn')?.addEventListener('click', closeWhatsappModal);
    document.getElementById('send-document-whatsapp-confirm-btn')?.addEventListener('click', sendWhatsapp);
  }

  function modalField(id) {
    return document.getElementById(id);
  }

  function openEmailModal(kind) {
    ensureEmailModal();
    activeEmailKind = kind;
    const isInvoiceEmail = kind === 'invoice';
    const reference = isInvoiceEmail ? invoiceReference() : deliveryNoteReference();
    modalField('document-email-modal-title').textContent = isInvoiceEmail ? 'Envoyer la facture par email' : 'Envoyer le BL par email';
    modalField('document-email-to').value = isInvoiceEmail ? clean(invoiceDefaults?.email) : clean(blOptions?.email);
    modalField('document-email-subject').value = isInvoiceEmail ? `Facture ${reference}` : `Bon de livraison ${reference}`;
    modalField('document-email-message').value = isInvoiceEmail ? defaultInvoiceMessage() : defaultDeliveryNoteMessage();
    document.getElementById('document-email-modal')?.classList.remove('hidden');
  }

  async function openWhatsappModal(kind) {
    ensureWhatsappModal();
    activeWhatsappKind = kind;
    const titles = {
      sale: 'Envoyer la commande WhatsApp',
      delivery_note: 'Envoyer le BL WhatsApp',
      invoice: 'Envoyer la facture WhatsApp',
    };
    modalField('document-whatsapp-modal-title').textContent = titles[kind] || 'Envoyer par WhatsApp';
    modalField('document-whatsapp-to').value = '';
    modalField('document-whatsapp-message').value = 'Chargement...';
    document.getElementById('document-whatsapp-modal')?.classList.remove('hidden');

    try {
      const defaults = await request(`${whatsappPath(kind)}/defaults`);
      modalField('document-whatsapp-to').value = clean(defaults.to);
      modalField('document-whatsapp-message').value = clean(defaults.message);
      if (!defaults.to) showFeedback('Aucun numéro sur la fiche : renseigne un numéro manuel avant envoi.', true);
    } catch (err) {
      modalField('document-whatsapp-message').value = '';
      showFeedback(err.message || 'Préparation WhatsApp impossible', true);
    }
  }

  function closeEmailModal() {
    document.getElementById('document-email-modal')?.classList.add('hidden');
  }

  function closeWhatsappModal() {
    document.getElementById('document-whatsapp-modal')?.classList.add('hidden');
  }

  function whatsappPath(kind) {
    if (kind === 'invoice') return `/api/communication/whatsapp/invoice/${sale.id}`;
    if (kind === 'delivery_note') return `/api/communication/whatsapp/delivery-note/${sale.id}`;
    return `/api/communication/whatsapp/sale/${sale.id}`;
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
      closeEmailModal();
      showFeedback(`Email envoyé à ${result.to}`);
    } catch (err) {
      showFeedback(err.message || 'Erreur envoi email', true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function sendWhatsapp() {
    const to = clean(modalField('document-whatsapp-to')?.value);
    const message = clean(modalField('document-whatsapp-message')?.value);
    if (!to) {
      showFeedback('Renseigne un numéro WhatsApp.', true);
      return;
    }
    if (!message) {
      showFeedback('Renseigne un message WhatsApp.', true);
      return;
    }

    const button = modalField('send-document-whatsapp-confirm-btn');
    if (button) button.disabled = true;
    try {
      const result = await request(whatsappPath(activeWhatsappKind), {
        method: 'POST',
        body: JSON.stringify({ to, message }),
      });
      closeWhatsappModal();
      showFeedback(`WhatsApp envoyé (${result.message_id}).`);
    } catch (err) {
      showFeedback(err.message || 'Erreur envoi WhatsApp', true);
    } finally {
      if (button) button.disabled = false;
    }
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
    const canEmail = isDeliveryNote() || isInvoice();
    const canWhatsapp = isOrder() || isDeliveryNote() || isInvoice();
    mailBtn.classList.toggle('hidden', !canEmail);
    whatsappBtn.classList.toggle('hidden', !canWhatsapp);

    if (isOrder()) {
      whatsappBtn.disabled = false;
      whatsappBtn.textContent = '💬 Envoyer commande WhatsApp';
      whatsappBtn.title = 'Envoyer la commande par WhatsApp';
      return;
    }

    if (isInvoice()) {
      mailBtn.disabled = false;
      mailBtn.textContent = '📧 Envoyer par email';
      mailBtn.title = invoiceDefaults?.email ? `Envoyer à ${invoiceDefaults.email}` : 'Destinataire à renseigner';
      whatsappBtn.disabled = false;
      whatsappBtn.textContent = '💬 Envoyer facture WhatsApp';
      whatsappBtn.title = 'Envoyer la facture par WhatsApp';
      return;
    }

    if (isDeliveryNote()) {
      mailBtn.disabled = false;
      mailBtn.textContent = '📧 Envoyer par email';
      mailBtn.title = blOptions?.email ? `Envoyer à ${blOptions.email}` : 'Destinataire à renseigner';
      whatsappBtn.disabled = false;
      whatsappBtn.textContent = '💬 Envoyer BL WhatsApp';
      whatsappBtn.title = 'Envoyer le BL par WhatsApp';
    }
  }

  mailBtn?.addEventListener('click', (event) => {
    if (!isDeliveryNote() && !isInvoice()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openEmailModal(isInvoice() ? 'invoice' : 'delivery_note');
  }, true);

  whatsappBtn?.addEventListener('click', (event) => {
    if (!isOrder() && !isDeliveryNote() && !isInvoice()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const kind = isInvoice() ? 'invoice' : isDeliveryNote() ? 'delivery_note' : 'sale';
    openWhatsappModal(kind);
  }, true);

  ensureEmailModal();
  ensureWhatsappModal();
  setTimeout(refresh, 350);
  window.setInterval(refresh, 1500);
}());
