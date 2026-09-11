const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';
const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const userRaw = localStorage.getItem('gc_user') || localStorage.getItem('grv2_user');
if (!token || !userRaw) window.location.href = './login.html';

const user = JSON.parse(userRaw);
const el = (id) => document.getElementById(id);
const feedback = el('page-feedback');

let carriers = [];
let carrierSettings = [];
let grids = [];
let chains = [];
let logisticsServices = [];
let fuelSurcharges = [];
let shipments = [];
let editingGridId = null;
let editingChainId = null;
let editingServiceId = null;
let editingFuelId = null;
let editingShipmentId = null;

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

function formatDate(value) {
  return value ? String(value).slice(0, 10) : '-';
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

function apiJson(path, payload, method = 'POST') {
  return api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) });
}

function optionList(items, placeholder, selected = '', emptyLabel = null) {
  const first = emptyLabel === null ? `<option value="">${esc(placeholder)}</option>` : `<option value="">${esc(emptyLabel)}</option>`;
  return first + items.map((item) => (
    `<option value="${esc(item.id || item.carrier_id)}" ${(item.id || item.carrier_id) === selected ? 'selected' : ''}>${esc(item.name || item.code || item.id || item.carrier_id)}</option>`
  )).join('');
}

function fillSelect(id, items, placeholder = 'Choisir', emptyLabel = null) {
  const select = el(id);
  if (!select) return;
  const selected = select.value;
  select.innerHTML = optionList(items, placeholder, selected, emptyLabel);
  select.value = selected;
}

function fillCarrierSelects() {
  ['carrier-setting-carrier', 'grid-carrier', 'fuel-carrier'].forEach((id) => fillSelect(id, carriers, 'Choisir'));
  fillSelect('service-carrier', carriers, 'Sans transporteur', 'Sans transporteur');
  refreshChainLegCarrierSelects();
}

function fillChainSelects() {
  fillSelect('transport-chain', chains, 'Choisir un circuit');
}

function gridsForCarrier(carrierId) {
  return grids.filter((grid) => !carrierId || grid.carrier_id === carrierId);
}

function carrierName(id) {
  return carriers.find((carrier) => carrier.id === id)?.name || carrierSettings.find((item) => item.carrier_id === id)?.name || '';
}

function renderCarrierSettings() {
  const body = el('carrier-settings-body');
  body.innerHTML = carrierSettings.length ? carrierSettings.map((setting) => `
    <tr data-carrier-id="${esc(setting.carrier_id)}">
      <td>${esc(setting.name || '')}</td>
      <td>${esc(setting.code || '')}</td>
      <td>${money(setting.admin_fee_ht)} EUR</td>
      <td>${esc(setting.purchase_transport_mode || 'manual')}</td>
      <td>${esc(setting.notes || '')}<div><button class="btn btn-secondary btn-sm" data-action="carrier-edit" type="button">Modifier</button></div></td>
    </tr>
  `).join('') : '<tr><td colspan="5">Aucun transporteur parametre.</td></tr>';
}

function renderGrids() {
  const body = el('grids-body');
  body.innerHTML = grids.length ? grids.map((grid) => `
    <tr data-grid-id="${esc(grid.id)}">
      <td>${esc(grid.carrier_name || carrierName(grid.carrier_id))}</td>
      <td>${esc(grid.name || '')}<div class="transport-muted">${esc(grid.code || '')}</div></td>
      <td>${esc(grid.origin_label || '-')} -> ${esc(grid.destination_label || '-')}</td>
      <td>${esc(formatDate(grid.valid_from))} -> ${esc(formatDate(grid.valid_to))}</td>
      <td>${Number(grid.brackets?.length || 0)}</td>
      <td>${grid.is_active ? 'Actif' : 'Inactif'}</td>
      <td>
        <button class="btn btn-secondary btn-sm" data-action="grid-detail" type="button">Detail</button>
        <button class="btn btn-secondary btn-sm" data-action="grid-edit" type="button">Modifier</button>
        <button class="btn btn-secondary btn-sm" data-action="grid-delete" type="button">${grid.is_active ? 'Supprimer' : 'Suppr.'}</button>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="7">Aucune grille transport.</td></tr>';
}

function renderChains() {
  fillChainSelects();
  const body = el('chains-body');
  body.innerHTML = chains.length ? chains.map((chain) => `
    <tr data-chain-id="${esc(chain.id)}">
      <td>${esc(chain.name || '')}<div class="transport-muted">${esc(chain.code || '')}</div></td>
      <td>${chain.direction === 'purchase' ? 'Achat' : chain.direction === 'both' ? 'Mixte' : 'Vente'}</td>
      <td>${esc(chain.origin_label || '-')} -> ${esc(chain.destination_label || '-')}</td>
      <td>${Number(chain.leg_count || chain.legs?.length || 0)}</td>
      <td>${chain.is_active ? 'Actif' : 'Inactif'}</td>
      <td>
        <button class="btn btn-secondary btn-sm" data-action="chain-detail" type="button">Detail</button>
        <button class="btn btn-secondary btn-sm" data-action="chain-edit" type="button">Modifier</button>
        <button class="btn btn-secondary btn-sm" data-action="chain-delete" type="button">${chain.is_active ? 'Supprimer' : 'Suppr.'}</button>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="6">Aucun circuit transport.</td></tr>';
}

function renderLogisticsServices() {
  const body = el('services-body');
  body.innerHTML = logisticsServices.length ? logisticsServices.map((service) => `
    <tr data-service-id="${esc(service.id)}">
      <td>${esc(service.label || '')}</td>
      <td>${esc(service.carrier_name || 'Sans transporteur')}</td>
      <td>${esc(service.calculation_mode || '')}</td>
      <td>${money(service.amount_ht)} EUR</td>
      <td>${esc(formatDate(service.effective_from))} -> ${esc(formatDate(service.effective_to))}</td>
      <td>${service.is_active ? 'Actif' : 'Inactif'}<div><button class="btn btn-secondary btn-sm" data-action="service-edit" type="button">Modifier</button> <button class="btn btn-secondary btn-sm" data-action="service-delete" type="button">Supprimer</button></div></td>
    </tr>
  `).join('') : '<tr><td colspan="6">Aucune prestation logistique.</td></tr>';
}

function renderFuelSurcharges() {
  const body = el('fuel-body');
  body.innerHTML = fuelSurcharges.length ? fuelSurcharges.map((rate) => `
    <tr data-fuel-id="${esc(rate.id)}">
      <td>${esc(rate.carrier_name || '')}</td>
      <td>${Number(rate.surcharge_percent || 0).toLocaleString('fr-FR')} %</td>
      <td>${esc(formatDate(rate.effective_from))}</td>
      <td>${esc(formatDate(rate.effective_to))}</td>
      <td>${esc(rate.notes || '')}<div><button class="btn btn-secondary btn-sm" data-action="fuel-edit" type="button">Modifier</button> <button class="btn btn-secondary btn-sm" data-action="fuel-delete" type="button">Supprimer</button></div></td>
    </tr>
  `).join('') : '<tr><td colspan="5">Aucun taux carburant.</td></tr>';
}

function renderShipments() {
  const body = el('shipments-body');
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
      <td>${shipment.blt_reference ? '<span class="transport-muted">Genere</span>' : '<button class="btn btn-secondary btn-sm" data-action="shipment-edit" type="button">Modifier</button> <button class="btn btn-secondary btn-sm" data-action="shipment-delete" type="button">Supprimer</button> <button class="btn btn-secondary btn-sm" data-action="generate" type="button">Generer BL transport</button>'}</td>
    </tr>
  `).join('') : '<tr><td colspan="10">Aucun envoi pour cette date.</td></tr>';
}

function gridOptions(carrierId, selected = '') {
  return optionList(gridsForCarrier(carrierId), 'Choisir une grille', selected);
}

function refreshChainLegGridSelect(row) {
  if (!row) return;
  const carrierId = row.querySelector('[data-field="carrier_id"]')?.value || '';
  const gridSelect = row.querySelector('[data-field="grid_id"]');
  if (gridSelect) gridSelect.innerHTML = gridOptions(carrierId, gridSelect.value);
}

function refreshChainLegCarrierSelects() {
  Array.from(el('chain-legs-body').querySelectorAll('tr')).forEach((row) => {
    const carrierSelect = row.querySelector('[data-field="carrier_id"]');
    if (!carrierSelect) return;
    carrierSelect.innerHTML = optionList(carriers, 'Choisir', carrierSelect.value);
    refreshChainLegGridSelect(row);
  });
}

function refreshChainLegGridSelects() {
  Array.from(el('chain-legs-body').querySelectorAll('tr')).forEach((row) => refreshChainLegGridSelect(row));
}

function addBracketRow(values = {}) {
  const body = el('grid-brackets-body');
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input data-field="min_weight_kg" type="number" min="0" step="0.001" value="${esc(values.min_weight_kg ?? 0)}" /></td>
    <td><input data-field="max_weight_kg" type="number" min="0" step="0.001" value="${esc(values.max_weight_kg ?? '')}" /></td>
    <td><select data-field="pricing_mode"><option value="per_tonne">EUR/tonne</option><option value="fixed">Forfait</option></select></td>
    <td><input data-field="amount_ht" type="number" min="0" step="0.0001" value="${esc(values.amount_ht ?? '')}" /></td>
    <td><button class="btn btn-secondary btn-sm" data-action="remove-row" type="button">Retirer</button></td>
  `;
  row.querySelector('[data-field="pricing_mode"]').value = values.pricing_mode || 'per_tonne';
  body.appendChild(row);
}

function addLegRow(values = {}) {
  const body = el('chain-legs-body');
  const row = document.createElement('tr');
  const carrierId = values.carrier_id || '';
  row.innerHTML = `
    <td><input data-field="leg_order" type="number" min="1" step="1" value="${esc(values.leg_order ?? body.children.length + 1)}" /></td>
    <td><select data-field="carrier_id">${optionList(carriers, 'Choisir', carrierId)}</select></td>
    <td><select data-field="grid_id">${gridOptions(carrierId, values.grid_id || '')}</select></td>
    <td><input data-field="origin_label" type="text" value="${esc(values.origin_label ?? '')}" /></td>
    <td><input data-field="destination_label" type="text" value="${esc(values.destination_label ?? '')}" /></td>
    <td><input data-field="specific_admin_fee_ht" type="number" min="0" step="0.01" value="${esc(values.specific_admin_fee_ht ?? '')}" /></td>
    <td><button class="btn btn-secondary btn-sm" data-action="remove-row" type="button">Retirer</button></td>
  `;
  body.appendChild(row);
}

function collectRows(bodyId) {
  return Array.from(el(bodyId).querySelectorAll('tr')).map((row) => {
    const data = {};
    row.querySelectorAll('[data-field]').forEach((field) => { data[field.dataset.field] = field.value; });
    return data;
  });
}

function requireValue(value, message) {
  if (!String(value || '').trim()) throw new Error(message);
}

function detailPanel(title, rowsHtml) {
  const panel = el('transport-detail-panel');
  panel.classList.remove('hidden');
  panel.innerHTML = `<div class="page-actions"><h2>${esc(title)}</h2></div>${rowsHtml}`;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showGridDetail(gridId) {
  const grid = grids.find((item) => item.id === gridId);
  if (!grid) return;
  const rows = (grid.brackets || []).map((bracket) => `
    <tr><td>${esc(bracket.min_weight_kg)}</td><td>${esc(bracket.max_weight_kg ?? '-')}</td><td>${esc(bracket.pricing_mode)}</td><td>${money(bracket.amount_ht)} EUR</td></tr>
  `).join('');
  detailPanel(grid.name || 'Grille transport', `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Min kg</th><th>Max kg</th><th>Mode</th><th>Montant</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">Aucune tranche.</td></tr>'}</tbody>
    </table></div>
  `);
}

function showChainDetail(chainId) {
  const chain = chains.find((item) => item.id === chainId);
  if (!chain) return;
  const rows = (chain.legs || []).map((leg) => `
    <tr><td>${esc(leg.leg_order)}</td><td>${esc(leg.carrier_name || '')}</td><td>${esc(leg.grid_name || '')}</td><td>${esc(leg.origin_label || '-')}</td><td>${esc(leg.destination_label || '-')}</td></tr>
  `).join('');
  detailPanel(chain.name || 'Circuit transport', `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Ordre</th><th>Transporteur</th><th>Grille</th><th>Depart</th><th>Destination</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">Aucune etape.</td></tr>'}</tbody>
    </table></div>
  `);
}

function setButtonMode(buttonId, cancelId, isEditing, createText, editText) {
  el(buttonId).textContent = isEditing ? editText : createText;
  el(cancelId)?.classList.toggle('hidden', !isEditing);
}

function clearGridForm() {
  editingGridId = null;
  ['grid-code', 'grid-name', 'grid-origin', 'grid-destination', 'grid-to', 'grid-notes'].forEach((id) => { el(id).value = ''; });
  el('grid-carrier').value = '';
  el('grid-from').value = todayIso();
  el('grid-active').checked = true;
  el('grid-brackets-body').innerHTML = '';
  addBracketRow();
  setButtonMode('save-grid-btn', 'cancel-grid-edit-btn', false, 'Creer grille', 'Enregistrer les modifications');
}

function editGrid(gridId) {
  const grid = grids.find((item) => item.id === gridId);
  if (!grid) return;
  editingGridId = grid.id;
  el('grid-carrier').value = grid.carrier_id || '';
  el('grid-code').value = grid.code || '';
  el('grid-name').value = grid.name || '';
  el('grid-origin').value = grid.origin_label || '';
  el('grid-destination').value = grid.destination_label || '';
  el('grid-from').value = formatDate(grid.valid_from) === '-' ? todayIso() : formatDate(grid.valid_from);
  el('grid-to').value = formatDate(grid.valid_to) === '-' ? '' : formatDate(grid.valid_to);
  el('grid-active').checked = grid.is_active !== false;
  el('grid-notes').value = grid.notes || '';
  el('grid-brackets-body').innerHTML = '';
  (grid.brackets || []).forEach((bracket) => addBracketRow(bracket));
  if (!grid.brackets?.length) addBracketRow();
  setButtonMode('save-grid-btn', 'cancel-grid-edit-btn', true, 'Creer grille', 'Enregistrer les modifications');
  el('grid-name').focus();
}

function clearChainForm() {
  editingChainId = null;
  ['chain-code', 'chain-name', 'chain-origin', 'chain-destination', 'chain-notes'].forEach((id) => { el(id).value = ''; });
  el('chain-direction').value = 'sale';
  el('chain-active').checked = true;
  el('chain-legs-body').innerHTML = '';
  addLegRow();
  setButtonMode('save-chain-btn', 'cancel-chain-edit-btn', false, 'Creer circuit', 'Enregistrer les modifications');
}

function editChain(chainId) {
  const chain = chains.find((item) => item.id === chainId);
  if (!chain) return;
  editingChainId = chain.id;
  el('chain-code').value = chain.code || '';
  el('chain-name').value = chain.name || '';
  el('chain-direction').value = chain.direction || 'sale';
  el('chain-origin').value = chain.origin_label || '';
  el('chain-destination').value = chain.destination_label || '';
  el('chain-active').checked = chain.is_active !== false;
  el('chain-notes').value = chain.notes || '';
  el('chain-legs-body').innerHTML = '';
  (chain.legs || []).forEach((leg) => addLegRow(leg));
  if (!chain.legs?.length) addLegRow();
  setButtonMode('save-chain-btn', 'cancel-chain-edit-btn', true, 'Creer circuit', 'Enregistrer les modifications');
  el('chain-name').focus();
}

function clearServiceForm() {
  editingServiceId = null;
  ['service-label', 'service-amount', 'service-to', 'service-notes'].forEach((id) => { el(id).value = ''; });
  el('service-carrier').value = '';
  el('service-mode').value = 'per_tonne';
  el('service-from').value = todayIso();
  el('service-active').checked = true;
  setButtonMode('save-service-btn', 'cancel-service-edit-btn', false, 'Creer prestation', 'Enregistrer les modifications');
}

function editService(serviceId) {
  const service = logisticsServices.find((item) => item.id === serviceId);
  if (!service) return;
  editingServiceId = service.id;
  el('service-carrier').value = service.carrier_id || '';
  el('service-label').value = service.label || '';
  el('service-mode').value = service.calculation_mode || 'per_tonne';
  el('service-amount').value = service.amount_ht || '';
  el('service-from').value = formatDate(service.effective_from) === '-' ? todayIso() : formatDate(service.effective_from);
  el('service-to').value = formatDate(service.effective_to) === '-' ? '' : formatDate(service.effective_to);
  el('service-active').checked = service.is_active !== false;
  el('service-notes').value = service.notes || '';
  setButtonMode('save-service-btn', 'cancel-service-edit-btn', true, 'Creer prestation', 'Enregistrer les modifications');
}

function clearFuelForm() {
  editingFuelId = null;
  el('fuel-carrier').value = '';
  el('fuel-percent').value = '';
  el('fuel-from').value = todayIso();
  el('fuel-to').value = '';
  setButtonMode('create-fuel-btn', 'cancel-fuel-edit-btn', false, 'Ajouter taux', 'Enregistrer');
}

function editFuel(fuelId) {
  const rate = fuelSurcharges.find((item) => item.id === fuelId);
  if (!rate) return;
  editingFuelId = rate.id;
  el('fuel-carrier').value = rate.carrier_id || '';
  el('fuel-percent').value = rate.surcharge_percent || '';
  el('fuel-from').value = formatDate(rate.effective_from) === '-' ? todayIso() : formatDate(rate.effective_from);
  el('fuel-to').value = formatDate(rate.effective_to) === '-' ? '' : formatDate(rate.effective_to);
  setButtonMode('create-fuel-btn', 'cancel-fuel-edit-btn', true, 'Ajouter taux', 'Enregistrer');
}

function editShipment(shipmentId) {
  const shipment = shipments.find((item) => item.id === shipmentId);
  if (!shipment) return;
  editingShipmentId = shipment.id;
  el('transport-date').value = formatDate(shipment.shipment_date) === '-' ? todayIso() : formatDate(shipment.shipment_date);
  el('transport-chain').value = shipment.chain_id || '';
  el('transport-direction').value = shipment.direction || 'sale';
  el('transport-weight').value = shipment.total_weight_kg || '';
  el('create-shipment-btn').textContent = 'Enregistrer envoi';
}

function clearShipmentForm() {
  editingShipmentId = null;
  el('transport-date').value = todayIso();
  el('transport-chain').value = '';
  el('transport-direction').value = 'sale';
  el('transport-weight').value = '';
  el('create-shipment-btn').textContent = 'Creer envoi';
}

async function loadCarriers() {
  const data = await api('/api/transport/carriers');
  carriers = data?.results || [];
  fillCarrierSelects();
}

async function loadCarrierSettings() {
  const data = await api('/api/transport/carrier-settings');
  carrierSettings = data?.results || [];
  renderCarrierSettings();
}

async function loadGrids() {
  const data = await api('/api/transport/grids');
  grids = data?.results || [];
  renderGrids();
  refreshChainLegGridSelects();
}

async function loadChains() {
  const data = await api('/api/transport/chains?direction=all');
  chains = data?.results || [];
  renderChains();
}

async function loadLogisticsServices() {
  const data = await api('/api/transport/logistics-services');
  logisticsServices = data?.results || [];
  renderLogisticsServices();
}

async function loadFuelSurcharges() {
  const data = await api('/api/transport/fuel-surcharges');
  fuelSurcharges = data?.results || [];
  renderFuelSurcharges();
}

async function loadShipments() {
  const date = el('transport-date').value || todayIso();
  const data = await api(`/api/transport/day?date=${encodeURIComponent(date)}`);
  shipments = data?.results || [];
  renderShipments();
}

async function saveCarrierSetting() {
  const carrierId = el('carrier-setting-carrier').value;
  requireValue(carrierId, 'Choisir un transporteur.');
  await apiJson(`/api/transport/carriers/${encodeURIComponent(carrierId)}/settings`, {
    admin_fee_ht: el('carrier-setting-admin-fee').value || 0,
    notes: el('carrier-setting-notes').value || null,
  }, 'PUT');
  await loadCarrierSettings();
  showFeedback('Parametrage transporteur enregistre.');
}

async function saveGrid() {
  requireValue(el('grid-carrier').value, 'Choisir un transporteur.');
  requireValue(el('grid-name').value, 'Saisir un nom de grille.');
  requireValue(el('grid-from').value, 'Saisir une date de debut.');
  const brackets = collectRows('grid-brackets-body').filter((row) => row.amount_ht !== '');
  if (!brackets.length) throw new Error('Ajouter au moins une tranche.');
  const payload = {
    carrier_id: el('grid-carrier').value,
    code: el('grid-code').value || null,
    name: el('grid-name').value,
    origin_label: el('grid-origin').value || null,
    destination_label: el('grid-destination').value || null,
    valid_from: el('grid-from').value,
    valid_to: el('grid-to').value || null,
    is_active: el('grid-active').checked,
    notes: el('grid-notes').value || null,
    brackets,
  };
  const wasEditing = Boolean(editingGridId);
  if (editingGridId) await apiJson(`/api/transport/grids/${encodeURIComponent(editingGridId)}`, payload, 'PATCH');
  else await apiJson('/api/transport/grids', payload);
  clearGridForm();
  await loadGrids();
  showFeedback(wasEditing ? 'Grille transport modifiee.' : 'Grille transport creee.');
}

async function saveChain() {
  requireValue(el('chain-name').value, 'Saisir un nom de circuit.');
  const legs = collectRows('chain-legs-body').filter((row) => row.carrier_id || row.grid_id);
  if (!legs.length) throw new Error('Ajouter au moins une etape.');
  const payload = {
    code: el('chain-code').value || null,
    name: el('chain-name').value,
    direction: el('chain-direction').value,
    origin_label: el('chain-origin').value || null,
    destination_label: el('chain-destination').value || null,
    is_active: el('chain-active').checked,
    notes: el('chain-notes').value || null,
    legs,
  };
  const wasEditing = Boolean(editingChainId);
  if (editingChainId) await apiJson(`/api/transport/chains/${encodeURIComponent(editingChainId)}`, payload, 'PATCH');
  else await apiJson('/api/transport/chains', payload);
  clearChainForm();
  await loadChains();
  showFeedback(wasEditing ? 'Circuit transport modifie.' : 'Circuit transport cree.');
}

async function saveLogisticsService() {
  requireValue(el('service-label').value, 'Saisir un libelle.');
  requireValue(el('service-from').value, 'Saisir une date de debut.');
  const payload = {
    carrier_id: el('service-carrier').value || null,
    label: el('service-label').value,
    calculation_mode: el('service-mode').value,
    amount_ht: el('service-amount').value || 0,
    effective_from: el('service-from').value,
    effective_to: el('service-to').value || null,
    is_active: el('service-active').checked,
    notes: el('service-notes').value || null,
  };
  const wasEditing = Boolean(editingServiceId);
  if (editingServiceId) await apiJson(`/api/transport/logistics-services/${encodeURIComponent(editingServiceId)}`, payload, 'PATCH');
  else await apiJson('/api/transport/logistics-services', payload);
  clearServiceForm();
  await loadLogisticsServices();
  showFeedback(wasEditing ? 'Prestation logistique modifiee.' : 'Prestation logistique creee.');
}

async function createFuelSurcharge() {
  requireValue(el('fuel-carrier').value, 'Choisir un transporteur.');
  requireValue(el('fuel-percent').value, 'Saisir un taux carburant.');
  requireValue(el('fuel-from').value, "Saisir une date d'effet.");
  const payload = {
    carrier_id: el('fuel-carrier').value,
    surcharge_percent: el('fuel-percent').value,
    effective_from: el('fuel-from').value,
    effective_to: el('fuel-to').value || null,
  };
  const wasEditing = Boolean(editingFuelId);
  if (editingFuelId) await apiJson(`/api/transport/fuel-surcharges/${encodeURIComponent(editingFuelId)}`, payload, 'PATCH');
  else await apiJson('/api/transport/fuel-surcharges', payload);
  clearFuelForm();
  await loadFuelSurcharges();
  showFeedback(wasEditing ? 'Taux carburant modifie.' : 'Taux carburant ajoute.');
}

async function createShipment() {
  requireValue(el('transport-chain').value, 'Choisir un circuit.');
  if (!Number(el('transport-weight').value)) throw new Error('Saisir un poids.');
  const payload = {
    shipment_date: el('transport-date').value || todayIso(),
    chain_id: el('transport-chain').value,
    direction: el('transport-direction').value || 'sale',
    total_weight_kg: el('transport-weight').value,
  };
  const wasEditing = Boolean(editingShipmentId);
  if (editingShipmentId) await apiJson(`/api/transport/shipments/${encodeURIComponent(editingShipmentId)}`, payload, 'PATCH');
  else await apiJson('/api/transport/shipments', payload);
  clearShipmentForm();
  await loadShipments();
  showFeedback(wasEditing ? 'Envoi transport modifie.' : 'Envoi transport cree.');
}

async function generateBlt(shipmentId) {
  const result = await apiJson(`/api/transport/shipments/${encodeURIComponent(shipmentId)}/generate-blt`, {});
  await loadShipments();
  showFeedback(`BL transport ${result.delivery_note?.reference_number || ''} genere.`);
}

async function deleteEntity(path, confirmMessage, reload, successMessage) {
  if (!window.confirm(confirmMessage)) return;
  const result = await api(path, { method: 'DELETE' });
  await reload();
  showFeedback(result.deactivated || result.cancelled ? `${successMessage} desactive/annule.` : `${successMessage} supprime.`);
}

function bindEvents() {
  el('user-name').textContent = user.name || user.email || 'Utilisateur';
  el('back-home-btn').addEventListener('click', () => { window.location.href = './home.html'; });
  el('logout-btn').addEventListener('click', () => {
    ['gc_token', 'gc_user', 'grv2_token', 'grv2_user'].forEach((key) => localStorage.removeItem(key));
    window.location.href = './login.html';
  });
  el('carrier-setting-carrier').addEventListener('change', () => {
    const setting = carrierSettings.find((item) => item.carrier_id === el('carrier-setting-carrier').value);
    el('carrier-setting-admin-fee').value = setting ? Number(setting.admin_fee_ht || 0) : '';
    el('carrier-setting-notes').value = setting?.notes || '';
  });
  el('add-bracket-btn').addEventListener('click', () => addBracketRow());
  el('add-leg-btn').addEventListener('click', () => addLegRow());
  el('cancel-grid-edit-btn').addEventListener('click', () => clearGridForm());
  el('cancel-chain-edit-btn').addEventListener('click', () => clearChainForm());
  el('cancel-service-edit-btn').addEventListener('click', () => clearServiceForm());
  el('cancel-fuel-edit-btn').addEventListener('click', () => clearFuelForm());
  el('save-carrier-setting-btn').addEventListener('click', () => saveCarrierSetting().catch((error) => showFeedback(error.message, 'error')));
  el('save-grid-btn').addEventListener('click', () => saveGrid().catch((error) => showFeedback(error.message, 'error')));
  el('save-chain-btn').addEventListener('click', () => saveChain().catch((error) => showFeedback(error.message, 'error')));
  el('save-service-btn').addEventListener('click', () => saveLogisticsService().catch((error) => showFeedback(error.message, 'error')));
  el('create-fuel-btn').addEventListener('click', () => createFuelSurcharge().catch((error) => showFeedback(error.message, 'error')));
  el('create-shipment-btn').addEventListener('click', () => createShipment().catch((error) => showFeedback(error.message, 'error')));
  el('refresh-shipments-btn').addEventListener('click', () => loadShipments().catch((error) => showFeedback(error.message, 'error')));
  el('transport-date').addEventListener('change', () => loadShipments().catch((error) => showFeedback(error.message, 'error')));
  el('grid-brackets-body').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="remove-row"]');
    if (button) button.closest('tr')?.remove();
  });
  el('chain-legs-body').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="remove-row"]');
    if (button) button.closest('tr')?.remove();
  });
  el('chain-legs-body').addEventListener('change', (event) => {
    const select = event.target.closest('[data-field="carrier_id"]');
    if (!select) return;
    refreshChainLegGridSelect(select.closest('tr'));
  });
  el('grids-body').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    const row = event.target.closest('[data-grid-id]');
    if (!button || !row) return;
    if (button.dataset.action === 'grid-detail') showGridDetail(row.dataset.gridId);
    if (button.dataset.action === 'grid-edit') editGrid(row.dataset.gridId);
    if (button.dataset.action === 'grid-delete') deleteEntity(
      `/api/transport/grids/${encodeURIComponent(row.dataset.gridId)}`,
      'Supprimer cette grille si elle est inutilisee, sinon la desactiver ?',
      loadGrids,
      'Grille transport'
    ).catch((error) => showFeedback(error.message, 'error'));
  });
  el('chains-body').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    const row = event.target.closest('[data-chain-id]');
    if (!button || !row) return;
    if (button.dataset.action === 'chain-detail') showChainDetail(row.dataset.chainId);
    if (button.dataset.action === 'chain-edit') editChain(row.dataset.chainId);
    if (button.dataset.action === 'chain-delete') deleteEntity(
      `/api/transport/chains/${encodeURIComponent(row.dataset.chainId)}`,
      'Supprimer ce circuit si inutilise, sinon le desactiver ?',
      loadChains,
      'Circuit transport'
    ).catch((error) => showFeedback(error.message, 'error'));
  });
  el('carrier-settings-body').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="carrier-edit"]');
    const row = event.target.closest('[data-carrier-id]');
    if (!button || !row) return;
    el('carrier-setting-carrier').value = row.dataset.carrierId;
    el('carrier-setting-carrier').dispatchEvent(new Event('change'));
  });
  el('services-body').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    const row = event.target.closest('[data-service-id]');
    if (!button || !row) return;
    if (button.dataset.action === 'service-edit') editService(row.dataset.serviceId);
    if (button.dataset.action === 'service-delete') deleteEntity(
      `/api/transport/logistics-services/${encodeURIComponent(row.dataset.serviceId)}`,
      'Supprimer cette prestation si inutilisee, sinon la desactiver ?',
      loadLogisticsServices,
      'Prestation logistique'
    ).catch((error) => showFeedback(error.message, 'error'));
  });
  el('fuel-body').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    const row = event.target.closest('[data-fuel-id]');
    if (!button || !row) return;
    if (button.dataset.action === 'fuel-edit') editFuel(row.dataset.fuelId);
    if (button.dataset.action === 'fuel-delete') deleteEntity(
      `/api/transport/fuel-surcharges/${encodeURIComponent(row.dataset.fuelId)}`,
      'Supprimer ce taux carburant si inutilise ?',
      loadFuelSurcharges,
      'Taux carburant'
    ).catch((error) => showFeedback(error.message, 'error'));
  });
  el('shipments-body').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    const row = event.target.closest('[data-shipment-id]');
    if (!button || !row) return;
    if (button.dataset.action === 'generate') generateBlt(row.dataset.shipmentId).catch((error) => showFeedback(error.message, 'error'));
    if (button.dataset.action === 'shipment-edit') editShipment(row.dataset.shipmentId);
    if (button.dataset.action === 'shipment-delete') deleteEntity(
      `/api/transport/shipments/${encodeURIComponent(row.dataset.shipmentId)}`,
      'Supprimer cet envoi si aucun BLT existe, sinon l annuler ?',
      loadShipments,
      'Envoi transport'
    ).catch((error) => showFeedback(error.message, 'error'));
  });
}

async function init() {
  ['grid-from', 'service-from', 'fuel-from', 'transport-date'].forEach((id) => { el(id).value = todayIso(); });
  bindEvents();
  addBracketRow();
  addLegRow();
  await loadCarriers();
  await Promise.all([loadCarrierSettings(), loadGrids(), loadChains(), loadLogisticsServices(), loadFuelSurcharges()]);
  await loadShipments();
}

init().catch((error) => showFeedback(error.message, 'error'));
