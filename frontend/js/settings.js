const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
const authToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');

if (!sessionUser || !authToken) {
  window.location.href = './login.html';
}

const fields = [
  'company_name',
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

let currentSettings = {};

const userNameEl = document.getElementById('user-name');
const pageFeedback = document.getElementById('page-feedback');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const settingsForm = document.getElementById('settings-form');
const logoPreview = document.getElementById('logo-preview');
const logoEmpty = document.getElementById('logo-empty');
const logoFileInput = document.getElementById('logo_file');
const uploadLogoBtn = document.getElementById('upload-logo-btn');
const deleteLogoBtn = document.getElementById('delete-logo-btn');
const faviconPreview = document.getElementById('favicon-preview');
const faviconEmpty = document.getElementById('favicon-empty');
const faviconFileInput = document.getElementById('favicon_file');
const uploadFaviconBtn = document.getElementById('upload-favicon-btn');
const deleteFaviconBtn = document.getElementById('delete-favicon-btn');

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

function cacheBustedUrl(url) {
  if (!url) return '';
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${Date.now()}`;
}

function renderLogoPreview() {
  const logoUrl = currentSettings.logo_url;
  if (logoPreview) {
    logoPreview.src = logoUrl ? cacheBustedUrl(logoUrl) : '';
    logoPreview.classList.toggle('hidden', !logoUrl);
  }
  if (logoEmpty) logoEmpty.classList.toggle('hidden', Boolean(logoUrl));
  if (deleteLogoBtn) deleteLogoBtn.disabled = !canManageSettings() || !logoUrl;
  if (uploadLogoBtn) uploadLogoBtn.textContent = logoUrl ? 'Changer le logo' : 'Télécharger le logo';
}

function renderFaviconPreview() {
  const faviconUrl = currentSettings.favicon_url;
  if (faviconPreview) {
    faviconPreview.src = faviconUrl ? cacheBustedUrl(faviconUrl) : '';
    faviconPreview.classList.toggle('hidden', !faviconUrl);
  }
  if (faviconEmpty) faviconEmpty.classList.toggle('hidden', Boolean(faviconUrl));
  if (deleteFaviconBtn) deleteFaviconBtn.disabled = !canManageSettings() || !faviconUrl;
  if (uploadFaviconBtn) uploadFaviconBtn.textContent = faviconUrl ? 'Changer le favicon' : 'Télécharger le favicon';
}

function renderBrandingPreviews() {
  renderLogoPreview();
  renderFaviconPreview();
}

function fillForm(settings = {}) {
  currentSettings = { ...(settings || {}) };
  fields.forEach((field) => setFieldValue(field, currentSettings[field]));
  if (!currentSettings.country) setFieldValue('country', 'France');
  renderBrandingPreviews();
}

function collectPayload() {
  const payload = {};
  fields.forEach((field) => {
    payload[field] = getFieldValue(field);
  });
  if (!payload.country) payload.country = 'France';
  payload.logo_url = currentSettings.logo_url || null;
  payload.favicon_url = currentSettings.favicon_url || null;
  return payload;
}

function lockForm() {
  fields.forEach((field) => {
    const input = getField(field);
    if (input) input.disabled = true;
  });
  if (saveSettingsBtn) saveSettingsBtn.disabled = true;
  if (uploadLogoBtn) uploadLogoBtn.disabled = true;
  if (deleteLogoBtn) deleteLogoBtn.disabled = true;
  if (logoFileInput) logoFileInput.disabled = true;
  if (uploadFaviconBtn) uploadFaviconBtn.disabled = true;
  if (deleteFaviconBtn) deleteFaviconBtn.disabled = true;
  if (faviconFileInput) faviconFileInput.disabled = true;
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

async function uploadBrandingFile(file, options) {
  if (!file || !canManageSettings()) return;

  const formData = new FormData();
  formData.append(options.fieldName, file);

  options.setBusy(true);

  try {
    const response = await apiFetch(`${API_BASE_URL}/api/store-settings/${options.kind}`, {
      method: 'POST',
      body: formData,
    });
    if (!response) return;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Erreur upload ${options.label}`);
    fillForm(data || {});
    showFeedback(`${options.labelTitle} société mis à jour.`);
  } catch (err) {
    console.error(`Erreur upload ${options.label} :`, err);
    showFeedback(err.message || `Erreur upload ${options.label}`, 'error');
  } finally {
    if (options.input) options.input.value = '';
    options.setBusy(false);
    renderBrandingPreviews();
  }
}

async function deleteBrandingFile(options) {
  if (!canManageSettings() || !currentSettings[options.settingKey]) return;

  options.setBusy(true);

  try {
    const response = await apiFetch(`${API_BASE_URL}/api/store-settings/${options.kind}`, { method: 'DELETE' });
    if (!response) return;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Erreur suppression ${options.label}`);
    fillForm(data || {});
    showFeedback(`${options.labelTitle} société supprimé.`);
  } catch (err) {
    console.error(`Erreur suppression ${options.label} :`, err);
    showFeedback(err.message || `Erreur suppression ${options.label}`, 'error');
  } finally {
    options.setBusy(false);
    renderBrandingPreviews();
  }
}

function setLogoBusy(isBusy) {
  if (uploadLogoBtn) uploadLogoBtn.disabled = isBusy || !canManageSettings();
  if (deleteLogoBtn) deleteLogoBtn.disabled = isBusy || !canManageSettings() || !currentSettings.logo_url;
}

function setFaviconBusy(isBusy) {
  if (uploadFaviconBtn) uploadFaviconBtn.disabled = isBusy || !canManageSettings();
  if (deleteFaviconBtn) deleteFaviconBtn.disabled = isBusy || !canManageSettings() || !currentSettings.favicon_url;
}

function uploadLogo(file) {
  return uploadBrandingFile(file, {
    kind: 'logo',
    fieldName: 'logo',
    label: 'logo',
    labelTitle: 'Logo',
    input: logoFileInput,
    setBusy: setLogoBusy,
  });
}

function uploadFavicon(file) {
  return uploadBrandingFile(file, {
    kind: 'favicon',
    fieldName: 'favicon',
    label: 'favicon',
    labelTitle: 'Favicon',
    input: faviconFileInput,
    setBusy: setFaviconBusy,
  });
}

function deleteLogo() {
  return deleteBrandingFile({
    kind: 'logo',
    label: 'logo',
    labelTitle: 'Logo',
    settingKey: 'logo_url',
    setBusy: setLogoBusy,
  });
}

function deleteFavicon() {
  return deleteBrandingFile({
    kind: 'favicon',
    label: 'favicon',
    labelTitle: 'Favicon',
    settingKey: 'favicon_url',
    setBusy: setFaviconBusy,
  });
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
  uploadLogoBtn?.addEventListener('click', () => logoFileInput?.click());
  logoFileInput?.addEventListener('change', () => uploadLogo(logoFileInput.files?.[0]));
  deleteLogoBtn?.addEventListener('click', deleteLogo);
  uploadFaviconBtn?.addEventListener('click', () => faviconFileInput?.click());
  faviconFileInput?.addEventListener('change', () => uploadFavicon(faviconFileInput.files?.[0]));
  deleteFaviconBtn?.addEventListener('click', deleteFavicon);
}

bindEvents();
loadSettings();
