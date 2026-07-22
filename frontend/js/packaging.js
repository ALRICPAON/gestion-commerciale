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
  stockMovements: [],
  selectedOperationArticle: null,
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
  movementType: document.getElementById('movement-type'),
  movementCost: document.getElementById('movement-cost'),
  movementHistoryItem: document.getElementById('movement-history-item'),
  stockMovementsTbody: document.getElementById('stock-movements-tbody'),
  selectedPackagingSummary: document.getElementById('selected-packaging-summary'),
  operationArticle: document.getElementById('operation-article'),
  operationArticleId: document.getElementById('operation-article-id'),
  operationArticleSelected: document.getElementById('operation-article-selected'),
  operationArticleF9Btn: document.getElementById('operation-article-f9-btn'),
  operationProfile: document.getElementById('operation-profile'),
  operationForm: document.getElementById('operation-form'),
  operationPreview: document.getElementById('operation-preview'),
  previewOperationBtn: document.getElementById('preview-operation-btn'),
  operationsTbody: document.getElementById('operations-tbody'),
  returnableForm: document.getElementById('returnable-form'),
  returnableItem: document.getElementById('returnable-item'),
  returnableDeposit: document.getElementById('returnable-deposit'),
  returnableBalances: document.getElementById('returnable-balances'),
  returnableMovementsTbody: document.getElementById('returnable-movements-tbody'),
  resetItemBtn: document.getElementById('reset-item-btn'),
  articlePickerModal: document.getElementById('article-picker-modal'),
  closeArticlePickerBtn: document.getElementById('close-article-picker-btn'),
  articlePickerSearch: document.getElementById('article-picker-search'),
  articlePickerResults: document.getElementById('article-picker-results'),
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

function selectedPackagingItem(selectEl = els.movementItem) {
  return state.items.find((item) => String(item.id) === String(selectEl.value));
}

function sourceDocumentLabel(movement) {
  if (!movement.source_table) return '-';
  if (movement.source_table === 'packaging_operations') return `Conditionnement ${movement.source_id || ''}`.trim();
  if (movement.source_table === 'packaging_stock_movements') return `Annulation ${movement.source_id || ''}`.trim();
  return `${movement.source_table} ${movement.source_id || ''}`.trim();
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
  els.movementHistoryItem.innerHTML = '<option value="">Tous les emballages</option>' + optionHtml;
  els.returnableItem.innerHTML =
    state.items
      .filter((item) => item.category === 'returnable' && item.active !== false)
      .map((item) => `<option value="${item.id}">${escapeHtml(item.code)} - ${escapeHtml(item.designation)}</option>`)
      .join('') || '<option value="">Aucune consigne</option>';
  updateSelectedPackagingSummary();
  prefillMovementCost();
  prefillReturnableDeposit();
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

function renderStockMovements() {
  if (!state.stockMovements.length) {
    els.stockMovementsTbody.innerHTML = '<tr><td colspan="10">Aucun mouvement.</td></tr>';
    return;
  }

  els.stockMovementsTbody.innerHTML = state.stockMovements
    .map((movement) => {
      const isActive = movement.status !== 'cancelled' && !movement.cancelled_at;
      const sourceBlocked = movement.source_table === 'packaging_operations';
      const action = isActive && !sourceBlocked
        ? `<button class="btn btn-secondary btn-sm" type="button" data-cancel-stock-movement="${movement.id}">Corriger / annuler</button>`
        : sourceBlocked
          ? '<span class="muted-text">Corriger operation source</span>'
          : '-';
      return `
        <tr>
          <td>${formatDate(movement.movement_date)}</td>
          <td>${escapeHtml(movement.code || '')} ${escapeHtml(movement.designation || '')}</td>
          <td>${escapeHtml(movement.movement_type)}</td>
          <td>${formatNumber(movement.quantity)} ${escapeHtml(movement.management_unit || '')}</td>
          <td>${formatMoney(movement.unit_cost_ex_vat)}</td>
          <td>${escapeHtml(movement.notes || movement.cancellation_reason || '')}</td>
          <td>${escapeHtml(movement.created_by_email || movement.created_by || '-')}</td>
          <td>${escapeHtml(sourceDocumentLabel(movement))}</td>
          <td><span class="status-pill ${isActive ? 'active' : 'cancelled'}">${isActive ? 'Actif' : 'Annule'}</span></td>
          <td>${action}</td>
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
  const articleId = els.operationArticleId.value.trim();
  if (!articleId) {
    state.profiles = [];
    renderProfiles();
    return;
  }

  const data = await api(`/api/packaging/articles/${encodeURIComponent(articleId)}/profiles`);
  state.profiles = data.profiles || [];
  renderProfiles();
}

async function loadStockMovements() {
  const params = new URLSearchParams({ limit: '100' });
  if (els.movementHistoryItem.value) params.set('packaging_item_id', els.movementHistoryItem.value);
  const data = await api(`/api/packaging/stock-movements?${params.toString()}`);
  state.stockMovements = data.movements || [];
  renderStockMovements();
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
    await loadStockMovements();
    await loadOperations();
    await loadReturnables();
  } catch (error) {
    console.error(error);
    showFeedback(error.message, 'error');
  }
}

function updateSelectedPackagingSummary() {
  const item = selectedPackagingItem();
  if (!item) {
    els.selectedPackagingSummary.textContent = 'Selectionne un emballage.';
    return;
  }

  const alert = Number(item.current_stock) <= Number(item.alert_threshold)
    ? '<span class="stock-alert">Alerte stock</span>'
    : '<span>Stock OK</span>';
  els.selectedPackagingSummary.innerHTML = `
    <div><strong>${escapeHtml(item.code)}</strong> - ${escapeHtml(item.designation)}</div>
    <div>Stock disponible: <strong>${formatNumber(item.current_stock)} ${escapeHtml(item.management_unit)}</strong></div>
    <div>Cout courant: <strong>${formatMoney(item.current_unit_cost_ex_vat)}</strong></div>
    <div>Consigne: <strong>${formatMoney(item.deposit_unit_value)}</strong></div>
    <div>${alert}</div>
  `;
}

function prefillMovementCost() {
  const item = selectedPackagingItem();
  if (!item || !els.movementCost) return;
  if (els.movementType.value === 'purchase_in') {
    els.movementCost.value = item.current_unit_cost_ex_vat ?? 0;
  }
}

function prefillReturnableDeposit() {
  const item = selectedPackagingItem(els.returnableItem);
  if (!item || !els.returnableDeposit) return;
  els.returnableDeposit.value = item.deposit_unit_value ?? 0;
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
  await Promise.all([loadItems(), loadStockMovements()]);
  showFeedback('Mouvement stock enregistre.', 'success');
}

function collectOperationPayload() {
  return {
    article_id: getInput('operation-article-id'),
    profile_id: getInput('operation-profile'),
    product_quantity_kg: getInput('operation-kg'),
    package_count: getInput('operation-packages'),
    product_cost_before_packaging: getInput('operation-product-cost') || 0,
    operation_date: getInput('operation-date') || null,
    notes: getInput('operation-notes'),
  };
}

function articleDisplay(article) {
  return `${article.plu || ''} - ${article.designation || article.display_name || ''}`.trim();
}

function applyOperationArticle(article) {
  const normalized = {
    ...article,
    id: article.article_id || article.id,
    designation: article.designation || article.display_name || '',
  };
  state.selectedOperationArticle = normalized;
  els.operationArticle.value = articleDisplay(normalized);
  els.operationArticleId.value = normalized.id || '';
  els.operationArticleSelected.textContent = normalized.id
    ? `${normalized.plu || '-'} - ${normalized.designation || '-'}`
    : 'Aucun article selectionne.';
  loadProfilesForArticle().catch(handleActionError);
}

async function searchArticles(term) {
  const search = String(term || '').trim();
  if (!search) return [];
  const rows = await api(`/api/articles/search?q=${encodeURIComponent(search)}`);
  return Array.isArray(rows) ? rows : [];
}

async function resolveOperationArticleFromInput() {
  const term = els.operationArticle.value.trim();
  if (!term) return;
  const rows = await searchArticles(term);
  const article = rows.find((row) => String(row.plu) === term) || rows[0];
  if (!article) throw new Error(`Article introuvable pour ${term}`);
  applyOperationArticle(article);
}

function openArticlePicker(initialSearch = '') {
  els.articlePickerSearch.value = initialSearch;
  els.articlePickerModal.classList.remove('hidden');
  renderArticlePickerResults([]);
  setTimeout(() => els.articlePickerSearch.focus(), 50);
  if (initialSearch) runArticlePickerSearch().catch(handleActionError);
}

function closeArticlePicker() {
  els.articlePickerModal.classList.add('hidden');
}

function renderArticlePickerResults(rows) {
  if (!rows.length) {
    els.articlePickerResults.innerHTML = '<tr><td colspan="5">Lance une recherche.</td></tr>';
    return;
  }

  els.articlePickerResults.innerHTML = rows
    .map((article) => `
      <tr>
        <td>${escapeHtml(article.plu || '')}</td>
        <td>${escapeHtml(article.designation || article.display_name || '')}</td>
        <td>${escapeHtml(article.sale_unit || article.unit || '')}</td>
        <td>${formatNumber(article.stock_quantity || 0)}</td>
        <td><button class="btn btn-secondary btn-sm" type="button" data-pick-article="${article.id || article.article_id}">Choisir</button></td>
      </tr>
    `)
    .join('');
}

async function runArticlePickerSearch() {
  const rows = await searchArticles(els.articlePickerSearch.value);
  state.articlePickerRows = rows;
  renderArticlePickerResults(rows);
}

async function previewOperation() {
  if (!els.operationArticleId.value.trim()) await resolveOperationArticleFromInput();
  state.preview = await api('/api/packaging/operations/preview', {
    method: 'POST',
    body: JSON.stringify(collectOperationPayload()),
  });
  renderPreview(state.preview);
}

async function submitOperation(event) {
  event.preventDefault();
  if (!els.operationArticleId.value.trim()) await resolveOperationArticleFromInput();
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
  prefillReturnableDeposit();
  showFeedback('Mouvement consigne enregistre.', 'success');
}

async function cancelStockMovement(movementId) {
  const reason = window.prompt('Justification obligatoire pour annuler ce mouvement');
  if (!reason || !reason.trim()) {
    showFeedback('Annulation abandonnee : justification obligatoire.', 'error');
    return;
  }

  await api(`/api/packaging/stock-movements/${encodeURIComponent(movementId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  await Promise.all([loadItems(), loadStockMovements()]);
  showFeedback('Mouvement annule par mouvement inverse.', 'success');
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
  els.movementItem.addEventListener('change', () => {
    updateSelectedPackagingSummary();
    prefillMovementCost();
  });
  els.movementType.addEventListener('change', prefillMovementCost);
  els.movementHistoryItem.addEventListener('change', () => loadStockMovements().catch(handleActionError));
  els.returnableItem.addEventListener('change', prefillReturnableDeposit);
  els.operationArticle.addEventListener('input', () => {
    els.operationArticleId.value = '';
    els.operationArticleSelected.textContent = 'Aucun article selectionne.';
  });
  els.operationArticle.addEventListener('blur', () => resolveOperationArticleFromInput().catch(handleActionError));
  els.operationArticle.addEventListener('keydown', (event) => {
    if (event.key === 'F9') {
      event.preventDefault();
      openArticlePicker(els.operationArticle.value.trim());
    }
  });
  els.operationArticleF9Btn.addEventListener('click', () => openArticlePicker(els.operationArticle.value.trim()));
  els.closeArticlePickerBtn.addEventListener('click', closeArticlePicker);
  els.articlePickerSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runArticlePickerSearch().catch(handleActionError);
  });
  els.articlePickerSearch.addEventListener('input', () => runArticlePickerSearch().catch(handleActionError));
  els.itemsTbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-edit-item]');
    if (button) editItem(button.dataset.editItem);
  });
  els.stockMovementsTbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-cancel-stock-movement]');
    if (button) cancelStockMovement(button.dataset.cancelStockMovement).catch(handleActionError);
  });
  els.articlePickerResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-pick-article]');
    if (!button) return;
    const article = (state.articlePickerRows || []).find((row) => String(row.id || row.article_id) === String(button.dataset.pickArticle));
    if (article) applyOperationArticle(article);
    closeArticlePicker();
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
