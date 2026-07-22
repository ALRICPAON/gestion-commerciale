const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const sessionToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const sessionUserRaw = localStorage.getItem('gc_user') || localStorage.getItem('grv2_user');

if (!sessionToken || !sessionUserRaw) {
  window.location.href = './login.html';
}

const sessionUser = JSON.parse(sessionUserRaw);

const state = {
  items: [],
  profiles: [],
  operations: [],
  balances: [],
  returnableMovements: [],
  preview: null,
};

const els = {
  userName: document.getElementById('user-name'),
  backHomeBtn: document.getElementById('back-home-btn'),
  logoutBtn: document.getElementById('logout-btn'),
  refreshBtn: document.getElementById('refresh-btn'),
  feedback: document.getElementById('packaging-feedback'),
  itemForm: document.getElementById('item-form'),
  movementForm: document.getElementById('movement-form'),
  itemSearch: document.getElementById('item-search'),
  itemsTbody: document.getElementById('items-tbody'),
  movementItem: document.getElementById('movement-item'),
  operationArticle: document.getElementById('operation-article'),
  operationProfile: document.getElementById('operation-profile'),
  operationForm: document.getElementById('operation-form'),
  operationPreview: document.getElementById('operation-preview'),
  previewOperationBtn: document.getElementById('preview-operation-btn'),
  operationsTbody: document.getElementById('operations-tbody'),
  returnableForm: document.getElementById('returnable-form'),
  returnableItem: document.getElementById('returnable-item'),
  returnableBalances: document.getElementById('returnable-balances'),
  returnableMovementsTbody: document.getElementById('returnable-movements-tbody'),
  resetItemBtn: document.getElementById('reset-item-btn'),
};

function authHeaders(json = false) {
  const headers = { Authorization: `Bearer ${sessionToken}` };
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showFeedback(message = '', type = '') {
  els.feedback.textContent = message;
  els.feedback.className = 'page-feedback';
  if (!message) els.feedback.classList.add('hidden');
  if (type) els.feedback.classList.add(type);
}

function formatNumber(value, digits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('fr-FR', { maximumFractionDigits: digits });
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0,00 EUR';
  return number.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('fr-FR');
}

function getInput(id) {
  return document.getElementById(id).value.trim();
}

function setInput(id, value) {
  document.getElementById(id).value = value ?? '';
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...authHeaders(Boolean(options.body)),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur API conditionnement');
  return data;
}

function categoryLabel(value) {
  return {
    consumable: 'Consommable',
    returnable: 'Consigne',
    reusable_internal: 'Reutilisable',
  }[value] || value;
}

function renderOptions() {
  const optionHtml = state.items
    .filter((item) => item.active !== false)
    .map((item) => `<option value="${item.id}">${escapeHtml(item.code)} - ${escapeHtml(item.designation)}</option>`)
    .join('');
  els.movementItem.innerHTML = optionHtml || '<option value="">Aucun emballage</option>';
  els.returnableItem.innerHTML =
    state.items
      .filter((item) => item.category === 'returnable' && item.active !== false)
      .map((item) => `<option value="${item.id}">${escapeHtml(item.code)} - ${escapeHtml(item.designation)}</option>`)
      .join('') || '<option value="">Aucune consigne</option>';
}

function renderItems() {
  const search = els.itemSearch.value.trim().toLowerCase();
  const rows = state.items.filter((item) => {
    const haystack = `${item.code} ${item.designation}`.toLowerCase();
    return !search || haystack.includes(search);
  });

  if (!rows.length) {
    els.itemsTbody.innerHTML = '<tr><td colspan="9">Aucun emballage.</td></tr>';
    return;
  }

  els.itemsTbody.innerHTML = rows
    .map((item) => {
      const alertClass = Number(item.current_stock) <= Number(item.alert_threshold) ? 'stock-alert' : '';
      return `
        <tr>
          <td>${escapeHtml(item.code)}</td>
          <td>${escapeHtml(item.designation)}</td>
          <td>${categoryLabel(item.category)}</td>
          <td class="${alertClass}">${formatNumber(item.current_stock)} ${escapeHtml(item.management_unit)}</td>
          <td>${formatMoney(item.current_unit_cost_ex_vat)}</td>
          <td>${formatMoney(item.deposit_unit_value)}</td>
          <td>${formatNumber(item.alert_threshold)}</td>
          <td>${item.active ? 'Actif' : 'Inactif'}</td>
          <td><button class="btn btn-secondary btn-sm" type="button" data-edit-item="${item.id}">Editer</button></td>
        </tr>
      `;
    })
    .join('');
}

function renderProfiles() {
  els.operationProfile.innerHTML =
    state.profiles
      .map((profile) => `<option value="${profile.id}">${profile.is_default ? '* ' : ''}${escapeHtml(profile.name)}</option>`)
      .join('') || '<option value="">Aucun profil</option>';
}

function renderPreview(preview) {
  if (!preview) {
    els.operationPreview.textContent = 'Selectionne un article, un profil, des kg et un nombre de colis.';
    return;
  }

  els.operationPreview.innerHTML = `
    <div class="preview-kpis">
      <span>Total emballage <strong>${formatMoney(preview.packaging_cost_total_ex_vat)}</strong></span>
      <span>Par colis <strong>${formatMoney(preview.packaging_cost_per_package)}</strong></span>
      <span>Par kg <strong>${formatMoney(preview.packaging_cost_per_kg)}</strong></span>
      <span>Cout apres emballage <strong>${formatMoney(preview.cost_after_packaging_per_kg)}</strong></span>
    </div>
    <ul class="preview-lines">
      ${(preview.lines || [])
        .map(
          (line) => `
            <li>
              <span>${escapeHtml(line.designation || line.code || line.packaging_item_id)}</span>
              <strong>${formatNumber(line.quantity)} - ${formatMoney(line.total_cost_ex_vat)}</strong>
            </li>
          `
        )
        .join('')}
    </ul>
  `;
}

function renderOperations() {
  if (!state.operations.length) {
    els.operationsTbody.innerHTML = '<tr><td colspan="8">Aucune operation.</td></tr>';
    return;
  }

  els.operationsTbody.innerHTML = state.operations
    .map(
      (operation) => `
        <tr>
          <td>${formatDate(operation.operation_date)}</td>
          <td>${escapeHtml(operation.plu || '')} ${escapeHtml(operation.article_designation || '')}</td>
          <td>${escapeHtml(operation.profile_name || '-')}</td>
          <td>${formatNumber(operation.product_quantity_kg)}</td>
          <td>${formatNumber(operation.package_count)}</td>
          <td>${formatMoney(operation.packaging_cost_total_ex_vat)}</td>
          <td><span class="status-pill ${operation.status}">${operation.status}</span></td>
          <td>
            ${
              operation.status === 'draft'
                ? `<button class="btn btn-primary btn-sm" type="button" data-validate-operation="${operation.id}">Valider</button>`
                : '-'
            }
          </td>
        </tr>
      `
    )
    .join('');
}

function renderReturnables() {
  if (!state.balances.length) {
    els.returnableBalances.textContent = 'Aucun solde consigne.';
  } else {
    els.returnableBalances.innerHTML = state.balances
      .map(
        (balance) => `
          <div class="balance-row">
            <span>${escapeHtml(balance.code || '')} ${escapeHtml(balance.designation || '')}</span>
            <strong>${formatNumber(balance.balance_quantity)} - ${formatMoney(balance.deposit_balance_value)}</strong>
          </div>
        `
      )
      .join('');
  }

  if (!state.returnableMovements.length) {
    els.returnableMovementsTbody.innerHTML = '<tr><td colspan="6">Aucun mouvement.</td></tr>';
    return;
  }

  els.returnableMovementsTbody.innerHTML = state.returnableMovements
    .map(
      (movement) => `
        <tr>
          <td>${formatDate(movement.movement_date)}</td>
          <td>${escapeHtml(movement.code || '')} ${escapeHtml(movement.designation || '')}</td>
          <td>${escapeHtml(movement.movement_type)}</td>
          <td>${formatNumber(movement.quantity)}</td>
          <td>${formatMoney(movement.deposit_unit_value)}</td>
          <td>${escapeHtml(movement.notes || '')}</td>
        </tr>
      `
    )
    .join('');
}

async function loadItems() {
  const data = await api('/api/packaging/items');
  state.items = data.items || [];
  renderOptions();
  renderItems();
}

async function loadProfilesForArticle() {
  const articleId = els.operationArticle.value.trim();
  if (!articleId) {
    state.profiles = [];
    renderProfiles();
    return;
  }

  const data = await api(`/api/packaging/articles/${encodeURIComponent(articleId)}/profiles`);
  state.profiles = data.profiles || [];
  renderProfiles();
}

async function loadOperations() {
  const data = await api('/api/packaging/operations?limit=50');
  state.operations = data.operations || [];
  renderOperations();
}

async function loadReturnables() {
  const [balancesData, movementsData] = await Promise.all([
    api('/api/packaging/returnables/balances'),
    api('/api/packaging/returnables/movements?limit=100'),
  ]);
  state.balances = balancesData.balances || [];
  state.returnableMovements = movementsData.movements || [];
  renderReturnables();
}

async function refreshAll() {
  showFeedback('');
  try {
    await loadItems();
    await loadOperations();
    await loadReturnables();
  } catch (error) {
    console.error(error);
    showFeedback(error.message, 'error');
  }
}

function collectItemPayload() {
  return {
    code: getInput('item-code'),
    designation: getInput('item-designation'),
    category: getInput('item-category'),
    management_unit: getInput('item-unit') || 'unit',
    format_label: getInput('item-format'),
    current_unit_cost_ex_vat: getInput('item-cost') || 0,
    deposit_unit_value: getInput('item-deposit') || 0,
    alert_threshold: getInput('item-threshold') || 0,
    active: true,
  };
}

function resetItemForm() {
  els.itemForm.reset();
  setInput('item-id', '');
  setInput('item-unit', 'unit');
  setInput('item-cost', '0');
  setInput('item-deposit', '0');
  setInput('item-threshold', '0');
}

function editItem(itemId) {
  const item = state.items.find((candidate) => String(candidate.id) === String(itemId));
  if (!item) return;
  setInput('item-id', item.id);
  setInput('item-code', item.code);
  setInput('item-designation', item.designation);
  setInput('item-category', item.category);
  setInput('item-unit', item.management_unit);
  setInput('item-format', item.format_label);
  setInput('item-cost', item.current_unit_cost_ex_vat);
  setInput('item-deposit', item.deposit_unit_value);
  setInput('item-threshold', item.alert_threshold);
}

async function submitItem(event) {
  event.preventDefault();
  const itemId = getInput('item-id');
  const method = itemId ? 'PATCH' : 'POST';
  const path = itemId ? `/api/packaging/items/${encodeURIComponent(itemId)}` : '/api/packaging/items';

  await api(path, {
    method,
    body: JSON.stringify(collectItemPayload()),
  });

  resetItemForm();
  await loadItems();
  showFeedback('Emballage enregistre.', 'success');
}

async function submitMovement(event) {
  event.preventDefault();
  const itemId = els.movementItem.value;
  await api(`/api/packaging/items/${encodeURIComponent(itemId)}/stock-movements`, {
    method: 'POST',
    body: JSON.stringify({
      movement_type: getInput('movement-type'),
      quantity: getInput('movement-quantity'),
      unit_cost_ex_vat: getInput('movement-cost') || 0,
      notes: getInput('movement-notes'),
    }),
  });
  els.movementForm.reset();
  await loadItems();
  showFeedback('Mouvement stock enregistre.', 'success');
}

function collectOperationPayload() {
  return {
    article_id: getInput('operation-article'),
    profile_id: getInput('operation-profile'),
    product_quantity_kg: getInput('operation-kg'),
    package_count: getInput('operation-packages'),
    product_cost_before_packaging: getInput('operation-product-cost') || 0,
    operation_date: getInput('operation-date') || null,
    notes: getInput('operation-notes'),
  };
}

async function previewOperation() {
  state.preview = await api('/api/packaging/operations/preview', {
    method: 'POST',
    body: JSON.stringify(collectOperationPayload()),
  });
  renderPreview(state.preview);
}

async function submitOperation(event) {
  event.preventDefault();
  const data = await api('/api/packaging/operations', {
    method: 'POST',
    body: JSON.stringify(collectOperationPayload()),
  });
  await loadOperations();
  showFeedback(`Operation brouillon creee: ${data.operation.id}`, 'success');
}

async function validateOperation(operationId) {
  await api(`/api/packaging/operations/${encodeURIComponent(operationId)}/validate`, { method: 'POST' });
  await Promise.all([loadItems(), loadOperations()]);
  showFeedback('Operation validee et stock emballage mis a jour.', 'success');
}

async function submitReturnable(event) {
  event.preventDefault();
  await api('/api/packaging/returnables/movements', {
    method: 'POST',
    body: JSON.stringify({
      packaging_item_id: getInput('returnable-item'),
      movement_type: getInput('returnable-type'),
      quantity: getInput('returnable-quantity'),
      deposit_unit_value: getInput('returnable-deposit') || 0,
      notes: getInput('returnable-notes'),
    }),
  });
  els.returnableForm.reset();
  await loadReturnables();
  showFeedback('Mouvement consigne enregistre.', 'success');
}

function setupTabs() {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-tab]').forEach((candidate) => candidate.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.add('hidden'));
      button.classList.add('active');
      document.getElementById(`tab-${button.dataset.tab}`).classList.remove('hidden');
    });
  });
}

function setupEvents() {
  els.userName.textContent = sessionUser.email || 'Utilisateur';
  els.backHomeBtn.addEventListener('click', () => {
    window.location.href = './home.html';
  });
  els.logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('gc_token');
    localStorage.removeItem('gc_user');
    localStorage.removeItem('grv2_token');
    localStorage.removeItem('grv2_user');
    window.location.href = './login.html';
  });
  els.refreshBtn.addEventListener('click', refreshAll);
  els.itemForm.addEventListener('submit', (event) => submitItem(event).catch(handleActionError));
  els.movementForm.addEventListener('submit', (event) => submitMovement(event).catch(handleActionError));
  els.operationForm.addEventListener('submit', (event) => submitOperation(event).catch(handleActionError));
  els.previewOperationBtn.addEventListener('click', () => previewOperation().catch(handleActionError));
  els.returnableForm.addEventListener('submit', (event) => submitReturnable(event).catch(handleActionError));
  els.resetItemBtn.addEventListener('click', resetItemForm);
  els.itemSearch.addEventListener('input', renderItems);
  els.operationArticle.addEventListener('change', () => loadProfilesForArticle().catch(handleActionError));
  els.itemsTbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-edit-item]');
    if (button) editItem(button.dataset.editItem);
  });
  els.operationsTbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-validate-operation]');
    if (button) validateOperation(button.dataset.validateOperation).catch(handleActionError);
  });
  setupTabs();
}

function handleActionError(error) {
  console.error(error);
  showFeedback(error.message, 'error');
}

setupEvents();
refreshAll();
