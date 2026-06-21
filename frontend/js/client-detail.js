const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;
const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
const authToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
if (!sessionUser || !authToken) window.location.href = './login.html';

const params = new URLSearchParams(window.location.search);
const clientId = params.get('id');
const $ = (id) => document.getElementById(id);
const userNameEl = $('user-name');
const pageFeedback = $('page-feedback');
const formTitle = $('form-title');
const formDescription = $('form-description');
const pageSubtitle = $('page-subtitle');
const saveClientBtn = $('save-client-btn');
const statusClientBtn = $('status-client-btn');
const clientForm = $('client-form');
const billedClientSelect = $('billed_client_id');

const fields = ['code', 'name', 'legal_name', 'client_type', 'status', 'tariff_level', 'billed_client_id', 'is_royale_maree_member', 'store_identifier', 'contact_name', 'phone', 'mobile', 'email', 'address_line1', 'address_line2', 'postal_code', 'city', 'country', 'vat_number', 'siret', 'payment_terms', 'delivery_terms', 'notes'];
let currentClient = null;
let clients = [];

function logoutAndRedirect() {
  ['gc_token', 'gc_user', 'gc_active_department', 'grv2_token', 'grv2_user', 'grv2_active_department'].forEach((key) => localStorage.removeItem(key));
  window.location.href = './login.html';
}

function showFeedback(message, type = 'success') {
  if (!pageFeedback) return;
  pageFeedback.textContent = message;
  pageFeedback.className = `page-feedback ${type}`;
  setTimeout(() => { pageFeedback.className = 'page-feedback hidden'; pageFeedback.textContent = ''; }, 3500);
}

const canEditClient = () => ['admin', 'responsable', 'commercial'].includes(sessionUser.role);
const canChangeStatus = () => ['admin', 'responsable'].includes(sessionUser.role);
const setFieldValue = (id, value) => {
  const el = $(id);
  if (!el) return;
  if (el.type === 'checkbox') {
    el.checked = value === true || value === 'true' || value === '1';
    return;
  }
  el.value = value ?? '';
};
const getFieldValue = (id) => {
  const el = $(id);
  if (!el) return null;
  if (el.type === 'checkbox') return el.checked;
  const value = el.value.trim();
  return value === '' ? null : value;
};

async function apiFetch(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${authToken}` } });
  if (response.status === 401) { logoutAndRedirect(); return null; }
  return response;
}

function renderBilledClients() {
  if (!billedClientSelect) return;
  const selected = currentClient?.billed_client_id || clientId || '';
  billedClientSelect.innerHTML = '<option value="">Lui-même</option>';
  clients.forEach((client) => {
    if (client.status === 'inactive') return;
    const option = document.createElement('option');
    option.value = client.id;
    option.textContent = [client.code, client.name].filter(Boolean).join(' - ');
    billedClientSelect.appendChild(option);
  });
  billedClientSelect.value = selected === clientId ? '' : selected;
}

function fillForm(client) {
  fields.forEach((field) => setFieldValue(field, client[field]));
  if (!client.country) setFieldValue('country', 'France');
  if (!client.tariff_level) setFieldValue('tariff_level', '1');
  setFieldValue('billed_client_id', client.billed_client_id === client.id ? '' : client.billed_client_id);
}

function collectPayload() {
  const payload = {};
  fields.forEach((field) => { payload[field] = getFieldValue(field); });
  if (!payload.country) payload.country = 'France';
  if (!payload.client_type) payload.client_type = 'standard';
  if (!payload.status) payload.status = 'active';
  if (!['1', '2', '3'].includes(String(payload.tariff_level || ''))) payload.tariff_level = '1';
  if (!payload.billed_client_id && clientId) payload.billed_client_id = clientId;
  return payload;
}

function updateHeader() {
  if (!clientId) {
    formTitle.textContent = 'Nouveau client';
    formDescription.textContent = 'Crée une nouvelle fiche client.';
    pageSubtitle.textContent = 'Nouveau client';
    statusClientBtn?.classList.add('hidden');
    return;
  }
  const name = currentClient?.name || 'Client';
  formTitle.textContent = name;
  formDescription.textContent = 'Consulte et modifie la fiche client.';
  pageSubtitle.textContent = name;
  if (canChangeStatus() && currentClient) {
    statusClientBtn?.classList.remove('hidden');
    statusClientBtn.textContent = currentClient.status === 'active' ? 'Désactiver' : 'Réactiver';
    statusClientBtn.dataset.status = currentClient.status === 'active' ? 'inactive' : 'active';
  }
}

function lockFormIfNeeded() {
  if (canEditClient()) return;
  fields.forEach((field) => { const el = $(field); if (el) el.disabled = true; });
  saveClientBtn.disabled = true;
}

async function loadClientsForBilling() {
  const response = await apiFetch(`${API_BASE_URL}/api/clients?status=active`);
  if (!response) return;
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(data.error || 'Impossible de charger les clients facturés');
  clients = Array.isArray(data) ? data : [];
  renderBilledClients();
}

async function loadClient() {
  if (!clientId) { currentClient = null; updateHeader(); renderBilledClients(); lockFormIfNeeded(); return; }
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/clients/${clientId}`);
    if (!response) return;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Impossible de charger le client');
    currentClient = data;
    fillForm(data);
    renderBilledClients();
    updateHeader();
    lockFormIfNeeded();
  } catch (err) { console.error('Erreur chargement client :', err); showFeedback(err.message || 'Erreur chargement client', 'error'); }
}

async function saveClient() {
  if (!canEditClient()) return showFeedback("Vous n'avez pas le droit de modifier cette fiche.", 'error');
  const payload = collectPayload();
  if (!payload.name) return showFeedback('Le nom client est obligatoire.', 'error');
  try {
    const url = clientId ? `${API_BASE_URL}/api/clients/${clientId}` : `${API_BASE_URL}/api/clients`;
    const response = await apiFetch(url, { method: clientId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response) return;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur enregistrement client');
    currentClient = data;
    showFeedback('Client enregistré.');
    if (!clientId && data.id) window.location.href = `./client-detail.html?id=${encodeURIComponent(data.id)}`;
    else { fillForm(data); renderBilledClients(); updateHeader(); }
  } catch (err) { console.error('Erreur sauvegarde client :', err); showFeedback(err.message || 'Erreur enregistrement client', 'error'); }
}

async function changeClientStatus(status) {
  if (!clientId || !canChangeStatus()) return;
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/clients/${clientId}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    if (!response) return;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur changement statut client');
    currentClient.status = data.status;
    setFieldValue('status', data.status);
    updateHeader();
    showFeedback('Statut client mis à jour.');
  } catch (err) { console.error('Erreur statut client :', err); showFeedback(err.message || 'Erreur changement statut', 'error'); }
}

function bindEvents() {
  if (userNameEl) userNameEl.textContent = sessionUser.email || 'Utilisateur';
  $('back-list-btn')?.addEventListener('click', () => { window.location.href = './clients.html'; });
  $('back-home-btn')?.addEventListener('click', () => { window.location.href = './home.html'; });
  $('logout-btn')?.addEventListener('click', logoutAndRedirect);
  saveClientBtn?.addEventListener('click', saveClient);
  clientForm?.addEventListener('submit', (event) => { event.preventDefault(); saveClient(); });
  statusClientBtn?.addEventListener('click', () => changeClientStatus(statusClientBtn.dataset.status || 'inactive'));
}

bindEvents();
loadClientsForBilling().then(loadClient).catch((err) => { console.error('Erreur initialisation client :', err); showFeedback(err.message || 'Erreur initialisation client', 'error'); loadClient(); });
