(() => {
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  const API_BASE = window.APP_CONFIG?.API_BASE_URL;
  if (!token || !API_BASE) return;

  const ordersBody = document.getElementById('orders-body');
  const deliveryNotesBody = document.getElementById('delivery-notes-body');
  const validateBtn = document.getElementById('validate-btn');
  const feedbackEl = document.getElementById('page-feedback');
  let selectedDeliveryNoteId = new URLSearchParams(window.location.search).get('open') || null;

  function number(value, fallback = 0) {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function qty(value) {
    return number(value).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  function showFeedback(message, type = 'success') {
    if (!feedbackEl) return;
    feedbackEl.textContent = message;
    feedbackEl.className = `page-feedback ${type}`;
    window.setTimeout(() => {
      feedbackEl.className = 'page-feedback hidden';
      feedbackEl.textContent = '';
    }, 3500);
  }

  async function request(path, payload = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || data.error || 'Erreur API');
      error.status = response.status;
      error.code = data.code;
      error.details = data.details || {};
      throw error;
    }
    return data;
  }

  async function requestWithStockConfirmation(path, payload = {}) {
    try {
      return await request(path, payload);
    } catch (error) {
      if (error.status !== 409 || error.code !== 'STOCK_INSUFFICIENT') throw error;
      const missing = error.details?.missing_quantity ? `\nManque : ${qty(error.details.missing_quantity)}` : '';
      const confirmed = window.confirm(`Stock insuffisant.${missing}\n\nForcer la sortie stock et créer un lot négatif traçable ?`);
      if (!confirmed) throw error;
      return request(path, { ...payload, allow_negative_stock: true });
    }
  }

  async function generateDeliveryNote(orderId) {
    const data = await requestWithStockConfirmation(`/api/sales/${encodeURIComponent(orderId)}/validate-delivery-note`, {});
    showFeedback(data.forced_stock_exit ? 'Commande validée en BL avec sortie forcée tracée.' : 'Commande validée en BL et stock déstocké.');
    if (typeof window.refreshAll === 'function') await window.refreshAll();
    if (data.delivery_note_id && typeof window.openDeliveryNote === 'function') await window.openDeliveryNote(data.delivery_note_id);
    if (data.delivery_note_id) selectedDeliveryNoteId = data.delivery_note_id;
  }

  async function validateDeliveryNote() {
    if (!selectedDeliveryNoteId) return;
    const data = await requestWithStockConfirmation(`/api/delivery-notes/${encodeURIComponent(selectedDeliveryNoteId)}/validate`, {});
    showFeedback(data.forced_stock_exit ? 'BL validé avec sortie forcée tracée.' : 'BL validé et stock déstocké.');
    if (typeof window.refreshAll === 'function') await window.refreshAll();
    if (typeof window.openDeliveryNote === 'function') await window.openDeliveryNote(selectedDeliveryNoteId);
  }

  ordersBody?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-generate]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled = true;
    generateDeliveryNote(button.dataset.generate)
      .catch((error) => showFeedback(error.message || 'Erreur validation en BL', 'error'))
      .finally(() => { button.disabled = false; });
  }, true);

  deliveryNotesBody?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-open]');
    if (button) selectedDeliveryNoteId = button.dataset.open;
  }, true);

  validateBtn?.addEventListener('click', (event) => {
    if (!selectedDeliveryNoteId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    validateBtn.disabled = true;
    validateDeliveryNote()
      .catch((error) => showFeedback(error.message || 'Erreur validation BL', 'error'))
      .finally(() => { validateBtn.disabled = false; });
  }, true);
}());
