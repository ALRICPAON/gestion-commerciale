(function () {
  const apiBase = window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL ? window.APP_CONFIG.API_BASE_URL : '';

  function getToken() {
    return localStorage.getItem('authToken') || localStorage.getItem('token') || '';
  }

  function getEl(id) {
    return document.getElementById(id);
  }

  function showMessage(type, message) {
    const summaryEl = getEl('email-send-summary');
    if (!summaryEl) return;

    summaryEl.className = `page-feedback ${type || ''}`.trim();
    summaryEl.textContent = message;
  }

  function renderSummary(preview) {
    const summaryEl = getEl('email-send-summary');
    if (!summaryEl) return;

    const summary = preview.summary || {};
    const smtp = preview.smtp || {};
    const byTariff = summary.by_tariff || {};
    const lines = [
      `Clients actifs avec email : ${summary.with_email || 0}`,
      `Clients sans email : ${summary.without_email || 0}`,
      `Clients sans tarif : ${summary.without_tariff || 0}`,
      `Tarif 1 : ${byTariff[1] || 0}`,
      `Tarif 2 : ${byTariff[2] || 0}`,
      `Tarif 3 : ${byTariff[3] || 0}`,
      'Chaque client recevra uniquement la grille correspondant a son tarif.',
    ];

    if (!smtp.configured) {
      lines.push(`SMTP incomplet : ${(smtp.missing || []).join(', ') || 'configuration manquante'}`);
    }

    summaryEl.className = `page-feedback ${smtp.configured ? 'success' : 'error'}`;
    summaryEl.innerHTML = lines.map((line) => `<div>${line}</div>`).join('');
  }

  function renderSendResult(result) {
    const summary = result.summary || {};
    const message = [
      `Emails envoyes : ${summary.sent || 0}`,
      `Clients ignores : ${summary.skipped || 0}`,
      `Erreurs : ${summary.errors || 0}`,
    ].join(' | ');

    showMessage(summary.errors ? 'error' : 'success', message);
  }

  async function requestJson(path, options) {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${getToken()}`,
        'Content-Type': 'application/json',
        ...(options && options.headers ? options.headers : {}),
      },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Erreur API');
    }

    return data;
  }

  async function previewTariffEmails() {
    showMessage('', 'Preparation de la preview email...');
    const preview = await requestJson('/api/customer-price-lists/email/preview', { method: 'GET' });
    window.__customerTariffEmailPreview = preview;
    renderSummary(preview);

    const sendBtn = getEl('email-send-btn');
    if (sendBtn) {
      sendBtn.disabled = !(preview.smtp && preview.smtp.configured && preview.summary && preview.summary.eligible > 0);
    }

    return preview;
  }

  function buildConfirmationMessage(preview) {
    const summary = preview.summary || {};
    const byTariff = summary.by_tariff || {};

    return [
      `Clients avec email : ${summary.with_email || 0}`,
      `Clients sans email : ${summary.without_email || 0}`,
      `Tarif 1 : ${byTariff[1] || 0}`,
      `Tarif 2 : ${byTariff[2] || 0}`,
      `Tarif 3 : ${byTariff[3] || 0}`,
      '',
      'Chaque client recevra uniquement son tarif.',
      'Confirmer l envoi des emails ?',
    ].join('\n');
  }

  async function sendTariffEmails() {
    const preview = window.__customerTariffEmailPreview || await previewTariffEmails();

    if (!(preview.smtp && preview.smtp.configured)) {
      showMessage('error', 'Configuration SMTP incomplete. Envoi annule.');
      return;
    }

    if (!(preview.summary && preview.summary.eligible > 0)) {
      showMessage('error', 'Aucun client eligible pour l envoi.');
      return;
    }

    if (!window.confirm(buildConfirmationMessage(preview))) {
      return;
    }

    const titleInput = getEl('price-list-title-input');
    const payload = {
      subject: titleInput && titleInput.value ? titleInput.value : undefined,
    };

    showMessage('', 'Envoi des emails tarifs en cours...');
    const result = await requestJson('/api/customer-price-lists/email/send', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    window.__customerTariffEmailPreview = null;
    renderSendResult(result);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const previewBtn = getEl('email-preview-btn');
    const sendBtn = getEl('email-send-btn');

    if (previewBtn) {
      previewBtn.addEventListener('click', () => {
        previewTariffEmails().catch((err) => showMessage('error', err.message || 'Erreur preview email'));
      });
    }

    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.addEventListener('click', () => {
        sendTariffEmails().catch((err) => showMessage('error', err.message || 'Erreur envoi email'));
      });
    }
  });
})();
