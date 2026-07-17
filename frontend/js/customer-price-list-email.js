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

  function canSendMercurialEmails(preview) {
    return Boolean(preview?.smtp?.configured && Number(preview?.summary?.eligible || 0) > 0);
  }

  function statusLabel(status) {
    return {
      skipped_no_email: 'aucun contact mercuriale ni email de secours',
      skipped_not_sendable: 'niveau tarifaire manquant',
      skipped_no_products: 'aucun produit pour ce niveau tarifaire',
    }[status] || status || 'ignore';
  }

  function clientList(preview, statuses) {
    const wanted = new Set(statuses);
    const rows = (preview.recipients || []).filter((row) => wanted.has(row.status));
    if (!rows.length) return [];
    return rows.slice(0, 8).map((row) => `- ${row.client_name || row.client_id} : ${statusLabel(row.status)}`);
  }

  function renderSummary(preview) {
    const summaryEl = getEl('email-send-summary');
    if (!summaryEl) return;

    const summary = preview.summary || {};
    const smtp = preview.smtp || {};
    const lines = [
      `Clients actifs : ${summary.total_clients || 0}`,
      `Contacts mercuriale selectionnes : ${summary.price_list_contacts || 0}`,
      `Clients avec destinataire resolu : ${summary.with_email || 0}`,
      `Clients sans destinataire : ${summary.without_email || 0}`,
      `Clients sans contact mercuriale coche : ${summary.without_price_list_contact || 0}`,
      `Clients avec tarif propre : ${summary.own_tariff || 0}`,
      `Clients avec tarif herite du parent : ${summary.parent_tariff || 0}`,
      `Clients avec tarif herite du client facture : ${summary.billed_tariff || 0}`,
      `Clients sans niveau tarifaire : ${summary.without_tariff || 0}`,
      `Clients sans produit fiche d'appel : ${summary.without_products || 0}`,
      `Clients avec fallback contact/email : ${summary.fallback_recipients || 0}`,
      `Emails qui seront envoyes : ${summary.eligible || 0}`,
    ];

    if (!smtp.configured) {
      lines.push(`SMTP incomplet : ${(smtp.missing || []).join(', ') || 'configuration manquante'}`);
    }

    if (!summary.eligible) {
      lines.push('Aucun client eligible : il faut au moins un destinataire, un tarif 1/2/3 et un produit dans la fiche d appel du jour.');
    }

    const details = clientList(preview, ['skipped_no_email', 'skipped_not_sendable', 'skipped_no_products']);
    if (details.length) {
      lines.push('Clients ignores :');
      lines.push(...details);
    }

    summaryEl.className = `page-feedback ${canSendMercurialEmails(preview) ? 'success' : 'error'}`;
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
      sendBtn.disabled = !canSendMercurialEmails(preview);
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
      showMessage('', 'Prepare les emails pour verifier le SMTP, les contacts mercuriale et les clients eligibles.');
      sendBtn.addEventListener('click', () => {
        sendMercurialEmails().catch((err) => showMessage('error', err.message || 'Erreur envoi email'));
      });
    }
  });

  window.CustomerPriceListEmail = {
    canSendMercurialEmails,
  };
})();
