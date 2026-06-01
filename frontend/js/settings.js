const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
const authToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');

if (!sessionUser || !authToken) {
  window.location.href = './login.html';
}

const fields = [
  'company_name',
  'logo_url',
  'address_line1',
  'address_line2',
  'postal_code',
  'city',
  'country',
  'phone',
  'email',
  'siret',
  'vat_number',
  'sanitary_approval_number',
  'iban',
  'bic',
  'payment_terms',
  'legal_mentions',
  'terms_and_conditions',
  'delivery_note_footer',
  'invoice_footer',
];

const userNameEl = document.getElementById('user-name');
const pageFeedback = document.getElementById('page-feedback');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const settingsForm = document.getElementById('settings-form');

function canManageSettings() {
  return ['admin', 'responsable'].includes(sessionUser.role);
}

function logoutAndRedirect() {
  ['gc_token', 'gc_user', 'gc_active_department', 'grv2_token', 'grv2_user', 'grv2_active_department'].forEach((key) => {
    localStorage.removeItem(key);
  });
  window.location.href = './login.html';
}

function showFeedback(message, type = 'success') {
  if (!pageFeedback) return;
  pageFeedback.textContent = message;
  pageFeedback.className = `page-feedback ${type}`;
  window.setTimeout(() => {
    pageFeedback.className = 'page-feedback hidden';
    pageFeedback.textContent = '';
  }, 4000);
}

function getField(id) {
  return document.getElementById(id);
}

function setFieldValue(id, value) {
  const field = getField(id);
  if (!field) return;
  field.value = value ?? '';
}

function getFieldValue(id) {
  const field = getField(id);
  if (!field) return null;
  const value = field.value.trim();
  return value === '' ? null : value;
}

function fillForm(settings = {}) {
  fields.forEach((field) => setFieldValue(field, settings[field]));
  if (!settings.country) setFieldValue('country', 'France');
}

function collectPayload() {
  const payload = {};
  fields.forEach((field) => {
    payload[field] = getFieldValue(field);
  });
  if (!payload.country) payload.country = 'France';
  return payload;
}

function lockForm() {
  fields.forEach((field) => {
    const input = getField(field);
    if (input) input.disabled = true;
  });
  if (saveSettingsBtn) saveSettingsBtn.disabled = true;
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${authToken}`,
    },
  });

  if (response.status === 401) {
    logoutAndRedirect();
    return null;
  }

  if (response.status === 403) {
    lockForm();
    showFeedback("Vous n'avez pas accès aux paramètres société.", 'error');
  }

  return response;
}

async function loadSettings() {
  if (!canManageSettings()) {
    lockForm();
    showFeedback("Vous n'avez pas accès aux paramètres société.", 'error');
    return;
  }

  try {
    const response = await apiFetch(`${API_BASE_URL}/api/store-settings`);
    if (!response) return;
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || 'Impossible de charger les paramètres société');
    fillForm(data || {});
  } catch (err) {
    console.error('Erreur chargement paramètres société :', err);
    showFeedback(err.message || 'Erreur chargement paramètres société', 'error');
  }
}

async function saveSettings() {
  if (!canManageSettings()) {
    showFeedback("Vous n'avez pas le droit de modifier les paramètres société.", 'error');
    return;
  }

  try {
    const response = await apiFetch(`${API_BASE_URL}/api/store-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectPayload()),
    });
    if (!response) return;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur enregistrement paramètres société');
    fillForm(data || {});
    showFeedback('Paramètres société enregistrés.');
  } catch (err) {
    console.error('Erreur sauvegarde paramètres société :', err);
    showFeedback(err.message || 'Erreur enregistrement paramètres société', 'error');
  }
}

function bindEvents() {
  if (userNameEl) userNameEl.textContent = sessionUser.email || 'Utilisateur';
  document.getElementById('back-home-btn')?.addEventListener('click', () => { window.location.href = './home.html'; });
  document.getElementById('logout-btn')?.addEventListener('click', logoutAndRedirect);
  saveSettingsBtn?.addEventListener('click', saveSettings);
  settingsForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettings();
  });
}

bindEvents();
loadSettings();
