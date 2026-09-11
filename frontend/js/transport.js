const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';
const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const userRaw = localStorage.getItem('gc_user') || localStorage.getItem('grv2_user');
if (!token || !userRaw) window.location.href = './login.html';

const user = JSON.parse(userRaw);
const el = (id) => document.getElementById(id);
const dateInput = el('transport-date');
const chainSelect = el('transport-chain');
const directionSelect = el('transport-direction');
const weightInput = el('transport-weight');
const body = el('shipments-body');
const feedback = el('page-feedback');
let chains = [];
let shipments = [];

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function money(value) {
  return Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function showFeedback(message, type = 'success') {
  feedback.textContent = message;
  feedback.className = `page-feedback ${type}`;
  window.setTimeout(() => feedback.classList.add('hidden'), 3500);
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (response.status === 401) {
    localStorage.removeItem('gc_token');
    localStorage.removeItem('gc_user');
    window.location.href = './login.html';
    return null;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur API');
  return data;
}

async function apiJson(path, payload) {
  return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) });
}

function renderChains() {
  const selected = chainSelect.value;
  chainSelect.innerHTML = '<option value="">Choisir un circuit</option>' + chains.map((chain) => (
    `<option value="${esc(chain.id)}">${esc(chain.name || chain.code || chain.id)}</option>`
  )).join('');
  chainSelect.value = selected;
}

function renderShipments() {
  body.innerHTML = shipments.length ? shipments.map((shipment) => `
    <tr data-shipment-id="${esc(shipment.id)}">
      <td>${esc(shipment.status || '')}</td>
      <td>${shipment.direction === 'purchase' ? 'Achat' : 'Vente'}</td>
      <td>${esc(shipment.carrier_name || '')}</td>
      <td>${esc(shipment.chain_name || '')}</td>
      <td>${esc(shipment.origin_label || '')}</td>
      <td>${esc(shipment.destination_label || '')}</td>
      <td>${Number(shipment.total_weight_kg || 0).toLocaleString('fr-FR')} kg</td>
      <td>${money(shipment.expected_total_ht)} EUR</td>
      <td>${esc(shipment.blt_reference || '-')}</td>
      <td>${shipment.blt_reference ? '<span class="transport-muted">Genere</span>' : '<button class="btn btn-secondary btn-sm" data-action="generate" type="button">Generer BL transport</button>'}</td>
    </tr>
  `).join('') : '<tr><td colspan="10">Aucun envoi pour cette date.</td></tr>';
}

async function loadChains() {
  const data = await api('/api/transport/chains?direction=all');
  chains = data?.results || [];
  renderChains();
}

async function loadShipments() {
  const date = dateInput.value || todayIso();
  const data = await api(`/api/transport/day?date=${encodeURIComponent(date)}`);
  shipments = data?.results || [];
  renderShipments();
}

async function createShipment() {
  if (!chainSelect.value) return showFeedback('Choisir un circuit.', 'error');
  if (!Number(weightInput.value)) return showFeedback('Saisir un poids.', 'error');
  await apiJson('/api/transport/shipments', {
    shipment_date: dateInput.value || todayIso(),
    chain_id: chainSelect.value,
    direction: directionSelect.value || 'sale',
    total_weight_kg: weightInput.value,
  });
  weightInput.value = '';
  await loadShipments();
  showFeedback('Envoi transport cree.');
}

async function generateBlt(shipmentId) {
  const result = await apiJson(`/api/transport/shipments/${encodeURIComponent(shipmentId)}/generate-blt`, {});
  await loadShipments();
  showFeedback(`BL transport ${result.delivery_note?.reference_number || ''} genere.`);
}

function bindEvents() {
  el('user-name').textContent = user.name || user.email || 'Utilisateur';
  el('back-home-btn').addEventListener('click', () => { window.location.href = './home.html'; });
  el('logout-btn').addEventListener('click', () => {
    ['gc_token', 'gc_user', 'grv2_token', 'grv2_user'].forEach((key) => localStorage.removeItem(key));
    window.location.href = './login.html';
  });
  el('create-shipment-btn').addEventListener('click', () => createShipment().catch((error) => showFeedback(error.message, 'error')));
  el('refresh-shipments-btn').addEventListener('click', () => loadShipments().catch((error) => showFeedback(error.message, 'error')));
  dateInput.addEventListener('change', () => loadShipments().catch((error) => showFeedback(error.message, 'error')));
  body.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="generate"]');
    const row = event.target.closest('[data-shipment-id]');
    if (button && row) generateBlt(row.dataset.shipmentId).catch((error) => showFeedback(error.message, 'error'));
  });
}

async function init() {
  dateInput.value = todayIso();
  bindEvents();
  await loadChains();
  await loadShipments();
}

init().catch((error) => showFeedback(error.message, 'error'));
