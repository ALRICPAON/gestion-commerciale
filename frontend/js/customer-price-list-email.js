(function () {
  const apiBase = window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL ? window.APP_CONFIG.API_BASE_URL : '';

  function getToken() {
    return localStorage.getItem('gc_token') || localStorage.getItem('grv2_token') || localStorage.getItem('authToken') || localStorage.getItem('token') || '';
  }

  function getEl(id) {
    return document.getElementById(id);
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

  function readyRecipients(preview) {
    return (preview?.recipients || []).filter((row) => row.status === 'ready' && row.mail_preview);
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
    summaryEl.innerHTML = lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('');
  }

  function renderRecipientOptions(rows) {
    return rows.map((row, index) => `
      <button type="button" class="merc-email-recipient ${index === 0 ? 'active' : ''}" data-index="${index}">
        <strong>${escapeHtml(row.client_name || row.client_id || 'Client')}</strong>
        <span>${escapeHtml(row.email || '')}</span>
      </button>
    `).join('');
  }

  function contactNames(row) {
    const names = (row.recipients || []).map((recipient) => recipient.name).filter(Boolean);
    return names.length ? names.join(', ') : 'Contact non renseigne';
  }

  function recipientAddressBlock(row) {
    const recipients = row.recipients || [];
    if (!recipients.length) return escapeHtml(row.email || '');
    return recipients.map((recipient) => `
      <div>
        <strong>${escapeHtml(recipient.name || row.client_name || 'Contact')}</strong>
        <span>${escapeHtml(recipient.email || '')}</span>
      </div>
    `).join('');
  }

  function bodyHtml(text) {
    return escapeHtml(text || '').split(/\r?\n/).map((line) => (
      line ? `<p>${line}</p>` : '<br>'
    )).join('');
  }

  function renderMailCard(row) {
    const mail = row.mail_preview || {};
    return `
      <div class="merc-email-card">
        <div class="merc-email-head">
          <div>
            <span>De</span>
            <strong>${escapeHtml(mail.from || '')}</strong>
          </div>
          <div>
            <span>A</span>
            <div class="merc-email-to">${recipientAddressBlock(row)}</div>
          </div>
          <div>
            <span>Objet</span>
            <strong>${escapeHtml(mail.subject || '')}</strong>
          </div>
        </div>
        <div class="merc-email-meta">
          <div><span>Client</span><strong>${escapeHtml(row.client_name || row.client_id || '')}</strong></div>
          <div><span>Contact</span><strong>${escapeHtml(contactNames(row))}</strong></div>
          <div><span>PDF joint</span><strong>${escapeHtml(mail.attachment_filename || '')}</strong></div>
        </div>
        <div class="merc-email-body">${bodyHtml(mail.body || mail.text || '')}</div>
        <div class="merc-email-attachment">
          <span aria-hidden="true">✓</span>
          <strong>${escapeHtml(mail.attachment_filename || '')}</strong>
        </div>
      </div>
    `;
  }

  function renderEmailPreview(preview, selectedIndex = 0) {
    const panel = getEl('email-preview-panel');
    if (!panel) return;

    const rows = readyRecipients(preview);
    if (!rows.length) {
      panel.className = 'merc-email-preview hidden';
      panel.innerHTML = '';
      return;
    }

    const index = Math.min(Math.max(Number(selectedIndex) || 0, 0), rows.length - 1);
    panel.className = 'merc-email-preview';
    panel.innerHTML = `
      <div class="merc-email-preview-header">
        <div>
          <h3>Previsualisation des emails</h3>
          <p>${rows.length} email${rows.length > 1 ? 's' : ''} pret${rows.length > 1 ? 's' : ''} a envoyer. Aucun email n'est envoye a cette etape.</p>
        </div>
        <div class="merc-email-test">
          <label for="email-test-recipient">Email de test</label>
          <div>
            <input id="email-test-recipient" type="email" value="${escapeHtml(preview.test_recipient || '')}" placeholder="adresse@test.fr">
            <button id="email-test-btn" type="button" class="btn btn-secondary">Envoyer un test</button>
          </div>
        </div>
      </div>
      <div class="merc-email-preview-grid">
        <div class="merc-email-list">${renderRecipientOptions(rows)}</div>
        ${renderMailCard(rows[index])}
      </div>
    `;

    panel.querySelectorAll('.merc-email-recipient').forEach((button) => {
      button.addEventListener('click', () => renderEmailPreview(preview, button.dataset.index));
    });

    const testBtn = getEl('email-test-btn');
    if (testBtn) {
      testBtn.addEventListener('click', () => sendMercurialTestEmail().catch((err) => showMessage('error', err.message || 'Erreur envoi test')));
    }
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
    renderEmailPreview(preview);

    const sendBtn = getEl('email-send-btn');
    if (sendBtn) {
      sendBtn.disabled = !canSendMercurialEmails(preview);
    }

    return preview;
  }

  async function sendMercurialTestEmail() {
    const preview = window.__customerMercurialEmailPreview || await previewMercurialEmails();
    const testInput = getEl('email-test-recipient');
    const testRecipient = testInput ? testInput.value.trim() : '';

    if (!canSendMercurialEmails(preview)) {
      showMessage('error', 'Prepare les emails avant l envoi du test.');
      return;
    }

    showMessage('', 'Envoi du test en cours...');
    const result = await requestJson('/api/customer-price-lists/email/test', {
      method: 'POST',
      body: JSON.stringify({ to: testRecipient }),
    });

    showMessage('success', `Email de test envoye a ${result.to}.`);
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
    renderEmailPreview,
  };
})();
