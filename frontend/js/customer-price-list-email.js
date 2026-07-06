(function () {
  const apiBase = window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL ? window.APP_CONFIG.API_BASE_URL : '';

  function getToken() {
    return localStorage.getItem('gc_token') || localStorage.getItem('grv2_token') || localStorage.getItem('authToken') || localStorage.getItem('token') || '';
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
    const lines = [
      `Clients actifs : ${summary.total_clients || 0}`,
      `Clients avec email : ${summary.with_email || 0}`,
      `Clients sans email : ${summary.without_email || 0}`,
      `Emails qui seront envoyes : ${summary.eligible || 0}`,
      'Chaque client recevra une mercuriale PDF personnalisee.',
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
      `Envoyes : ${summary.sent || 0}`,
      `Ignores : ${summary.skipped || 0}`,
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

  async function previewMercurialEmails() {
    showMessage('', 'Preparation de la preview email...');
    const preview = await requestJson('/api/customer-price-lists/email/preview', { method: 'GET' });
    window.__customerMercurialEmailPreview = preview;
    renderSummary(preview);

    const sendBtn = getEl('email-send-btn');
    if (sendBtn) {
      sendBtn.disabled = !(preview.smtp && preview.smtp.configured && preview.summary && preview.summary.eligible > 0);
    }

    return preview;
  }

  function buildConfirmationMessage(preview) {
    const summary = preview.summary || {};

    return [
      `Clients actifs : ${summary.total_clients || 0}`,
      `Clients avec email : ${summary.with_email || 0}`,
      `Clients sans email : ${summary.without_email || 0}`,
      `Emails qui seront envoyes : ${summary.eligible || 0}`,
      '',
      'Chaque client recevra son propre PDF personnalise.',
      'Confirmer l envoi des mercuriales ?',
    ].join('\n');
  }

  async function sendMercurialEmails() {
    const preview = window.__customerMercurialEmailPreview || await previewMercurialEmails();

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

    showMessage('', 'Envoi des mercuriales en cours...');
    const result = await requestJson('/api/customer-price-lists/email/send', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    window.__customerMercurialEmailPreview = null;
    renderSendResult(result);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const previewBtn = getEl('email-preview-btn');
    const sendBtn = getEl('email-send-btn');

    if (previewBtn) {
      previewBtn.addEventListener('click', () => {
        previewMercurialEmails().catch((err) => showMessage('error', err.message || 'Erreur preview email'));
      });
    }

    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.addEventListener('click', () => {
        sendMercurialEmails().catch((err) => showMessage('error', err.message || 'Erreur envoi email'));
      });
    }
  });
})();
