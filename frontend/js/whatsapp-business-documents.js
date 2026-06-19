(function () {
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  const API_BASE = window.APP_CONFIG?.API_BASE_URL;

  if (!token || !API_BASE) return;

  function clean(value) {
    const text = String(value ?? '').trim();
    return text || '';
  }

  function authHeaders(json = false) {
    const headers = { Authorization: `Bearer ${token}` };
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  }

  async function apiGet(path) {
    const response = await fetch(`${API_BASE}${path}`, { headers: authHeaders(false) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur API');
    return data;
  }

  async function apiPost(path, payload) {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.message_id) throw new Error(data.error || 'Meta n a pas retourne de message_id');
    return data;
  }

  function showFeedback(message, type = '') {
    const el = document.getElementById('purchase-header-feedback') || document.getElementById('page-feedback');
    if (!el) return;
    el.textContent = message;
    el.className = 'page-feedback';
    if (!message) el.classList.add('hidden');
    if (type) el.classList.add(type);
  }

  function ensureModal() {
    if (document.getElementById('business-whatsapp-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'business-whatsapp-modal';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <div>
            <h3 id="business-whatsapp-title">Envoyer par WhatsApp</h3>
            <p id="business-whatsapp-helper">Vérifie le numéro et le message avant envoi.</p>
          </div>
          <button type="button" id="close-business-whatsapp-btn" class="btn btn-secondary">Fermer</button>
        </div>
        <div class="form-grid">
          <div class="form-group form-group-span-2">
            <label for="business-whatsapp-to">Numéro WhatsApp</label>
            <input id="business-whatsapp-to" type="tel" autocomplete="tel" placeholder="+336..." />
          </div>
          <div class="form-group form-group-span-2">
            <label for="business-whatsapp-message">Message</label>
            <textarea id="business-whatsapp-message" rows="8"></textarea>
          </div>
        </div>
        <p class="helper-text">Si Meta refuse le texte libre hors conversation récente, il faudra utiliser un template WhatsApp officiel.</p>
        <div class="page-actions-right">
          <button type="button" id="send-business-whatsapp-btn" class="btn btn-primary">Envoyer</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('close-business-whatsapp-btn')?.addEventListener('click', () => closeModal());
  }

  function field(id) {
    return document.getElementById(id);
  }

  function closeModal() {
    document.getElementById('business-whatsapp-modal')?.classList.add('hidden');
  }

  async function openModal(config) {
    ensureModal();
    field('business-whatsapp-title').textContent = config.title;
    field('business-whatsapp-to').value = '';
    field('business-whatsapp-message').value = 'Chargement...';
    document.getElementById('business-whatsapp-modal')?.classList.remove('hidden');

    try {
      const defaults = await apiGet(config.defaultsPath());
      const fallback = clean(config.fallbackMessage?.());
      field('business-whatsapp-to').value = clean(defaults.to);
      field('business-whatsapp-message').value = config.preferFallbackMessage && fallback
        ? fallback
        : clean(defaults.message || fallback);
      if (!defaults.to) showFeedback('Aucun numéro disponible : renseigne un numéro manuel avant envoi.', 'error');
    } catch (error) {
      field('business-whatsapp-message').value = clean(config.fallbackMessage?.());
      showFeedback(error.message || 'Préparation WhatsApp impossible', 'error');
    }

    const button = field('send-business-whatsapp-btn');
    button.onclick = async () => {
      const to = clean(field('business-whatsapp-to')?.value);
      const message = clean(field('business-whatsapp-message')?.value);
      if (!to) {
        showFeedback('Renseigne un numéro WhatsApp.', 'error');
        return;
      }
      if (!message) {
        showFeedback('Renseigne un message WhatsApp.', 'error');
        return;
      }

      button.disabled = true;
      try {
        const result = await apiPost(config.sendPath(), { ...config.payload?.(), to, message });
        closeModal();
        showFeedback(`WhatsApp envoyé (${result.message_id}).`, 'success');
      } catch (error) {
        showFeedback(error.message || 'Erreur envoi WhatsApp', 'error');
      } finally {
        button.disabled = false;
      }
    };
  }

  function insertPurchaseButton() {
    const root = document.querySelector('.purchase-detail-page .welcome-card .page-actions-right');
    if (!root || document.getElementById('send-purchase-whatsapp-btn')) return;
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'send-purchase-whatsapp-btn';
    button.className = 'btn btn-secondary';
    button.textContent = '💬 Envoyer commande fournisseur WhatsApp';
    button.addEventListener('click', () => openModal({
      title: 'Envoyer commande fournisseur WhatsApp',
      defaultsPath: () => `/api/communication/whatsapp/purchase/${encodeURIComponent(id)}/defaults`,
      sendPath: () => `/api/communication/whatsapp/purchase/${encodeURIComponent(id)}`,
      payload: () => ({}),
    }));
    root.appendChild(button);
  }

  function priceListPreviewMessage() {
    const preview = clean(document.getElementById('price-list-preview')?.innerText);
    if (preview && !/Enregistre|prévisualise|previsualise/i.test(preview)) {
      return `Bonjour,\n\nVoici les cours ALTA MARÉE du jour :\n\n${preview}\n\nCordialement,\nALTA MARÉE`;
    }
    return 'Bonjour,\n\nVoici les cours ALTA MARÉE du jour :\n\nMerci de vérifier la mercuriale avant envoi.\n\nCordialement,\nALTA MARÉE';
  }

  function priceListClientId() {
    return clean(document.getElementById('client-select')?.value);
  }

  function insertPriceListButton() {
    const disabledButton = Array.from(document.querySelectorAll('.customer-price-list-page .preview-card button'))
      .find((button) => /WhatsApp/i.test(button.textContent || ''));
    if (!disabledButton || document.getElementById('send-price-list-whatsapp-btn')) return;
    disabledButton.disabled = false;
    disabledButton.id = 'send-price-list-whatsapp-btn';
    disabledButton.textContent = '💬 Envoyer les cours WhatsApp';
    disabledButton.addEventListener('click', () => {
      const params = new URLSearchParams();
      if (priceListClientId()) params.set('client_id', priceListClientId());
      openModal({
        title: 'Envoyer les cours WhatsApp',
        defaultsPath: () => `/api/communication/whatsapp/price-list/defaults?${params.toString()}`,
        sendPath: () => '/api/communication/whatsapp/price-list',
        fallbackMessage: priceListPreviewMessage,
        preferFallbackMessage: true,
        payload: () => ({ client_id: priceListClientId() || null }),
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    insertPurchaseButton();
    insertPriceListButton();
    ensureModal();
  });
}());
