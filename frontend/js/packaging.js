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
  allProfiles: [],
  operations: [],
  balances: [],
  returnableMovements: [],
  stockMovements: [],
  selectedOperationArticle: null,
  selectedModelArticle: null,
  articlePickerTarget: 'operation',
  articlePickerRows: [],
  movementToCancel: null,
  preview: null,
};

const els = {
  userName: document.getElementById('user-name'),
  backHomeBtn: document.getElementById('back-home-btn'),
  logoutBtn: document.getElementById('logout-btn'),
  refreshBtn: document.getElementById('refresh-btn'),
  feedback: document.getElementById('packaging-feedback'),
  itemSearch: document.getElementById('item-search'),
  itemsTbody: document.getElementById('items-tbody'),
  movementItem: document.getElementById('movement-item'),
  movementHistoryItem: document.getElementById('movement-history-item'),
  stockMovementsTbody: document.getElementById('stock-movements-tbody'),
  selectedPackagingSummary: document.getElementById('selected-packaging-summary'),
  operationArticle: document.getElementById('operation-article'),
  operationArticleId: document.getElementById('operation-article-id'),
  operationArticleSelected: document.getElementById('operation-article-selected'),
  operationArticleF9Btn: document.getElementById('operation-article-f9-btn'),
  operationLot: document.getElementById('operation-lot'),
  operationProfile: document.getElementById('operation-profile'),
  operationModelHint: document.getElementById('operation-model-hint'),
  submitOperationBtn: document.getElementById('submit-operation-btn'),
  operationForm: document.getElementById('operation-form'),
  operationPreview: document.getElementById('operation-preview'),
  previewOperationBtn: document.getElementById('preview-operation-btn'),
  operationsTbody: document.getElementById('operations-tbody'),
  returnableForm: document.getElementById('returnable-form'),
  returnableItem: document.getElementById('returnable-item'),
  returnableDeposit: document.getElementById('returnable-deposit'),
  returnableBalances: document.getElementById('returnable-balances'),
  returnableMovementsTbody: document.getElementById('returnable-movements-tbody'),
  newModelBtn: document.getElementById('new-model-btn'),
  modelForm: document.getElementById('model-form'),
  modelId: document.getElementById('model-id'),
  modelArticle: document.getElementById('model-article'),
  modelArticleId: document.getElementById('model-article-id'),
  modelArticleSelected: document.getElementById('model-article-selected'),
  modelArticleF9Btn: document.getElementById('model-article-f9-btn'),
  modelName: document.getElementById('model-name'),
  modelTargetWeight: document.getElementById('model-target-weight'),
  modelDefault: document.getElementById('model-default'),
  modelNotes: document.getElementById('model-notes'),
  addModelComponentBtn: document.getElementById('add-model-component-btn'),
  modelComponents: document.getElementById('model-components'),
  modelCostSummary: document.getElementById('model-cost-summary'),
  cancelModelBtn: document.getElementById('cancel-model-btn'),
  modelsTbody: document.getElementById('models-tbody'),
  articlePickerModal: document.getElementById('article-picker-modal'),
  closeArticlePickerBtn: document.getElementById('close-article-picker-btn'),
  articlePickerSearch: document.getElementById('article-picker-search'),
  articlePickerResults: document.getElementById('article-picker-results'),
  movementCancelModal: document.getElementById('movement-cancel-modal'),
  closeMovementCancelBtn: document.getElementById('close-movement-cancel-btn'),
  movementCancelSummary: document.getElementById('movement-cancel-summary'),
  movementCancelForm: document.getElementById('movement-cancel-form'),
  movementCancelReason: document.getElementById('movement-cancel-reason'),
  confirmMovementCancelBtn: document.getElementById('confirm-movement-cancel-btn'),
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

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function retryButton(action) {
  return `<button class="btn btn-secondary btn-sm" type="button" data-retry="${action}">Reessayer</button>`;
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
  if (!response.ok) {
    const error = new Error(data.error || 'Erreur API conditionnement');
    error.status = response.status;
    error.path = path;
    error.details = data.details;
    throw error;
  }
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
  prefillReturnableDeposit();
}

function renderItems() {
  const search = els.itemSearch.value.trim().toLowerCase();
  const rows = state.items.filter((item) => {
    const haystack = `${item.code} ${item.designation}`.toLowerCase();
    return !search || haystack.includes(search);
  });

  if (!rows.length) {
    els.itemsTbody.innerHTML = '<tr><td colspan="7">Aucun emballage.</td></tr>';
    return;
  }

  els.itemsTbody.innerHTML = rows
    .map((item) => {
      return `
        <tr>
          <td>${escapeHtml(item.code)}</td>
          <td>${escapeHtml(item.designation)}</td>
          <td>${categoryLabel(item.category)}</td>
          <td>${formatNumber(item.current_stock)}</td>
          <td>${formatMoney(item.current_unit_cost_ex_vat)}</td>
          <td>${escapeHtml(item.management_unit)}</td>
          <td><button class="btn btn-secondary btn-sm" type="button" data-open-article="${item.id}">Fiche article</button></td>
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
        ? `<button class="btn btn-secondary btn-sm" type="button" data-cancel-stock-movement="${movement.id}">Annuler / corriger</button>`
        : sourceBlocked
          ? '<span class="muted-text">A corriger depuis l operation de conditionnement</span>'
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
      .join('') || '<option value="">Aucun modele</option>';
  els.operationModelHint.textContent = state.profiles.length
    ? `${state.profiles.length} modele(s) disponible(s).`
    : 'Aucun modele de conditionnement n existe pour cet article.';
  updateOperationSubmitState();
}

function renderOperationLots(lots = []) {
  els.operationLot.innerHTML = lots
    .map((lot) => `<option value="${lot.id}">${escapeHtml(lot.lot_code || lot.supplier_lot_number || lot.id)} - ${formatNumber(lot.qty_remaining)} ${escapeHtml(lot.unit || 'kg')} - ${formatMoney(lot.unit_cost_ex_vat)}</option>`)
    .join('') || '<option value="">Aucun lot disponible</option>';
  updateOperationSubmitState();
}

function renderModels() {
  if (!state.allProfiles.length) {
    els.modelsTbody.innerHTML = '<tr><td colspan="9">Aucun modele de conditionnement.</td></tr>';
    return;
  }

  els.modelsTbody.innerHTML = state.allProfiles.map((profile) => {
    const components = (profile.components || [])
      .map((component) => `${component.code || ''} ${component.designation || ''} (${formatNumber(component.quantity)} ${component.management_unit || ''})`)
      .join(', ');
    return `
      <tr>
        <td>${escapeHtml(profile.name)}</td>
        <td>${escapeHtml(profile.article_designation || '')}</td>
        <td>${escapeHtml(profile.plu || '')}</td>
        <td>${formatNumber(profile.target_net_weight_kg)} kg</td>
        <td>${escapeHtml(components || '-')}</td>
        <td>${formatMoney(profile.estimated_cost_per_package || 0)}</td>
        <td>${profile.is_default ? 'Oui' : 'Non'}</td>
        <td>${profile.active ? 'Actif' : 'Inactif'}</td>
        <td>
          <button class="btn btn-secondary btn-sm" type="button" data-edit-model="${profile.id}">Modifier</button>
          ${profile.active ? `<button class="btn btn-secondary btn-sm" type="button" data-disable-model="${profile.id}">Desactiver</button>` : '-'}
        </td>
      </tr>
    `;
  }).join('');
}

function renderModelComponents() {
  const components = state.modelComponents || [];
  if (!components.length) {
    els.modelComponents.innerHTML = '<div class="field-hint">Ajoute au moins un emballage.</div>';
  } else {
    els.modelComponents.innerHTML = components.map((component, index) => {
      const item = state.items.find((candidate) => String(candidate.id) === String(component.packaging_item_id));
      const unitCost = Number(item?.current_unit_cost_ex_vat || component.current_unit_cost_ex_vat || 0);
      const lineCost = unitCost * Number(component.quantity || 0);
      return `
        <div class="component-row" data-component-index="${index}">
          <select data-component-field="packaging_item_id">
            ${state.items.filter((item) => item.active !== false && item.category === 'consumable').map((itemOption) => `
              <option value="${itemOption.id}" ${String(itemOption.id) === String(component.packaging_item_id) ? 'selected' : ''}>
                ${escapeHtml(itemOption.code)} - ${escapeHtml(itemOption.designation)} | stock ${formatNumber(itemOption.current_stock)} ${escapeHtml(itemOption.management_unit)} | PMA ${formatMoney(itemOption.current_unit_cost_ex_vat)}
              </option>
            `).join('')}
          </select>
          <input data-component-field="quantity" type="number" min="0.0001" step="0.0001" value="${component.quantity || 1}" />
          <span>${escapeHtml(item?.management_unit || '')}</span>
          <strong>${formatMoney(lineCost)}</strong>
          <button class="btn btn-secondary btn-sm" type="button" data-remove-component="${index}">Supprimer</button>
        </div>
      `;
    }).join('');
  }

  const total = components.reduce((sum, component) => {
    const item = state.items.find((candidate) => String(candidate.id) === String(component.packaging_item_id));
    return sum + Number(component.quantity || 0) * Number(item?.current_unit_cost_ex_vat || 0);
  }, 0);
  els.modelCostSummary.textContent = `Cout d'emballage estime par colis : ${formatMoney(total)}`;
}

function renderPreview(preview) {
  if (!preview) {
    els.operationPreview.textContent = 'Selectionne un article, un modele, des kg et un nombre de colis.';
    return;
  }

  els.operationPreview.innerHTML = `
    <div class="preview-kpis">
      <span>Stock produit <strong>Inchange</strong></span>
      <span>Stock disponible <strong>${formatNumber(preview.article_stock?.stock_quantity || 0)} ${escapeHtml(preview.article_stock?.unit || 'kg')}</strong></span>
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
                : operation.status === 'validated'
                  ? `<button class="btn btn-secondary btn-sm" type="button" data-cancel-operation="${operation.id}">Annuler</button>`
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

function renderStockMovementsError(error) {
  els.stockMovementsTbody.innerHTML = `
    <tr>
      <td colspan="10">
        Impossible de charger l historique mouvements.
        ${escapeHtml(error.message || '')}
        ${retryButton('stock-movements')}
      </td>
    </tr>
  `;
}

async function loadItems() {
  try {
    const data = await api('/api/articles?packaging_only=true&active=true&limit=200');
    state.items = (Array.isArray(data) ? data : []).map((article) => ({
      id: article.id,
      code: article.plu,
      designation: article.designation,
      category: article.article_type === 'PACKAGING_RETURNABLE' ? 'returnable' : 'consumable',
      management_unit: article.management_unit || article.stock_unit || article.unit || 'unit',
      current_stock: article.stock_quantity || 0,
      current_unit_cost_ex_vat: article.current_unit_cost_ex_vat || article.pma || 0,
      deposit_unit_value: article.deposit_unit_value || 0,
      alert_threshold: article.alert_threshold || 0,
      active: true,
    }));
    renderOptions();
    renderItems();
  } catch (error) {
    els.itemsTbody.innerHTML = `<tr><td colspan="7">Impossible de charger les articles emballages. ${escapeHtml(error.message)} ${retryButton('items')}</td></tr>`;
    throw error;
  }
}

async function loadProfilesForArticle(articleId = els.operationArticleId.value.trim()) {
  if (!isUuid(articleId)) {
    state.profiles = [];
    renderProfiles();
    renderOperationLots([]);
    return;
  }

  const data = await api(`/api/packaging/articles/${encodeURIComponent(articleId)}/profiles`);
  state.profiles = data.profiles || [];
  renderProfiles();
}

async function loadLotsForOperationArticle(articleId = els.operationArticleId.value.trim()) {
  if (!isUuid(articleId)) {
    renderOperationLots([]);
    return;
  }

  const lots = await api(`/api/stock/lots?article_id=${encodeURIComponent(articleId)}&available_only=true&limit=200`);
  renderOperationLots(Array.isArray(lots) ? lots : []);
}

async function loadModels() {
  try {
    const data = await api('/api/packaging/profiles?limit=200');
    state.allProfiles = data.profiles || [];
    renderModels();
  } catch (error) {
    els.modelsTbody.innerHTML = `<tr><td colspan="9">Impossible de charger les modeles. ${escapeHtml(error.message)} ${retryButton('models')}</td></tr>`;
    throw error;
  }
}

async function loadStockMovements() {
  try {
    const params = new URLSearchParams({ limit: '100' });
    if (els.movementHistoryItem.value) params.set('packaging_item_id', els.movementHistoryItem.value);
    const data = await api(`/api/packaging/stock-movements?${params.toString()}`);
    state.stockMovements = data.movements || [];
    renderStockMovements();
  } catch (error) {
    renderStockMovementsError(error);
    throw error;
  }
}

async function loadOperations() {
  try {
    const data = await api('/api/packaging/operations?limit=50');
    state.operations = data.operations || [];
    renderOperations();
  } catch (error) {
    els.operationsTbody.innerHTML = `<tr><td colspan="8">Impossible de charger les operations. ${escapeHtml(error.message)} ${retryButton('operations')}</td></tr>`;
    throw error;
  }
}

async function loadReturnables() {
  try {
    const [balancesData, movementsData] = await Promise.all([
      api('/api/packaging/returnables/balances'),
      api('/api/packaging/returnables/movements?limit=100'),
    ]);
    state.balances = balancesData.balances || [];
    state.returnableMovements = movementsData.movements || [];
    renderReturnables();
  } catch (error) {
    els.returnableBalances.innerHTML = `Impossible de charger les consignes. ${escapeHtml(error.message)} ${retryButton('returnables')}`;
    els.returnableMovementsTbody.innerHTML = '<tr><td colspan="6">Erreur chargement consignes.</td></tr>';
    throw error;
  }
}

async function refreshAll() {
  showFeedback('');
  const results = await Promise.allSettled([
    loadItems(),
    loadModels(),
    loadStockMovements(),
    loadOperations(),
    loadReturnables(),
  ]);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) {
    console.error(failed.reason);
    showFeedback(`Chargement incomplet: ${failed.reason.message}`, 'error');
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

function prefillReturnableDeposit() {
  const item = selectedPackagingItem(els.returnableItem);
  if (!item || !els.returnableDeposit) return;
  els.returnableDeposit.value = item.deposit_unit_value ?? 0;
}

function openArticleDetail(itemId) {
  const item = state.items.find((candidate) => String(candidate.id) === String(itemId));
  if (!item) return;
  window.location.href = `./article-detail.html?id=${encodeURIComponent(item.id)}`;
}

function collectOperationPayload() {
  return {
    article_id: getInput('operation-article-id'),
    lot_id: els.operationLot.value,
    profile_id: getInput('operation-profile'),
    product_quantity_kg: getInput('operation-kg'),
    package_count: getInput('operation-packages'),
    operation_date: getInput('operation-date') || null,
    notes: getInput('operation-notes'),
  };
}

function updateOperationSubmitState() {
  const ready = isUuid(els.operationArticleId.value)
    && isUuid(els.operationLot.value)
    && isUuid(els.operationProfile.value)
    && Number(getInput('operation-kg')) > 0
    && Number(getInput('operation-packages')) > 0;
  els.submitOperationBtn.disabled = !ready;
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
  els.operationArticleId.value = isUuid(normalized.id) ? normalized.id : '';
  els.operationArticleSelected.textContent = els.operationArticleId.value
    ? `${normalized.plu || '-'} - ${normalized.designation || '-'}`
    : 'Aucun article selectionne.';
  if (els.operationArticleId.value) loadProfilesForArticle(els.operationArticleId.value).catch(handleActionError);
  if (els.operationArticleId.value) loadLotsForOperationArticle(els.operationArticleId.value).catch(handleActionError);
}

function applyModelArticle(article) {
  const normalized = {
    ...article,
    id: article.article_id || article.id,
    designation: article.designation || article.display_name || '',
  };
  state.selectedModelArticle = normalized;
  els.modelArticle.value = articleDisplay(normalized);
  els.modelArticleId.value = isUuid(normalized.id) ? normalized.id : '';
  els.modelArticleSelected.textContent = els.modelArticleId.value
    ? `${normalized.plu || '-'} - ${normalized.designation || '-'}`
    : 'Aucun article selectionne.';
}

function resetModelForm() {
  els.modelForm.reset();
  els.modelId.value = '';
  els.modelArticleId.value = '';
  els.modelArticleSelected.textContent = 'Aucun article selectionne.';
  state.selectedModelArticle = null;
  state.modelComponents = [];
  renderModelComponents();
}

function openModelForm(profile = null) {
  els.modelForm.classList.remove('hidden');
  resetModelForm();
  if (!profile) return;
  els.modelId.value = profile.id;
  els.modelArticleId.value = profile.article_id;
  els.modelArticle.value = `${profile.plu || ''} - ${profile.article_designation || ''}`.trim();
  els.modelArticleSelected.textContent = els.modelArticle.value;
  els.modelName.value = profile.name || '';
  els.modelTargetWeight.value = profile.target_net_weight_kg || '';
  els.modelDefault.value = profile.is_default ? 'true' : 'false';
  els.modelNotes.value = profile.notes || '';
  state.modelComponents = (profile.components || []).map((component) => ({
    packaging_item_id: component.packaging_article_id || component.packaging_item_id,
    quantity: component.quantity,
  }));
  renderModelComponents();
}

function closeModelForm() {
  resetModelForm();
  els.modelForm.classList.add('hidden');
}

function collectModelPayload() {
  if (!isUuid(els.modelArticleId.value)) throw new Error('Selectionne un article valide pour le modele');
  return {
    name: els.modelName.value.trim(),
    target_net_weight_kg: els.modelTargetWeight.value,
    target_package_count: 1,
    is_default: els.modelDefault.value === 'true',
    notes: els.modelNotes.value.trim(),
    components: (state.modelComponents || []).map((component) => ({
      packaging_article_id: component.packaging_item_id,
      quantity_per_package: component.quantity,
      quantity: component.quantity,
      consumption_rule: 'per_package',
      is_primary_packaging: false,
    })),
  };
}

async function submitModel(event) {
  event.preventDefault();
  const payload = collectModelPayload();
  const modelId = els.modelId.value;
  const articleId = els.modelArticleId.value;
  const path = modelId
    ? `/api/packaging/profiles/${encodeURIComponent(modelId)}`
    : `/api/packaging/articles/${encodeURIComponent(articleId)}/profiles`;
  await api(path, { method: modelId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
  closeModelForm();
  await Promise.all([loadModels(), loadProfilesForArticle().catch(() => {})]);
  showFeedback('Modele de conditionnement enregistre.', 'success');
}

async function searchArticles(term) {
  const search = String(term || '').trim();
  if (!search) return [];
  const endpoint = state.articlePickerTarget === 'operation' ? '/api/articles/search-in-stock' : '/api/articles/search';
  const rows = await api(`${endpoint}?q=${encodeURIComponent(search)}`);
  return Array.isArray(rows) ? rows : [];
}

async function resolveOperationArticleFromInput() {
  state.articlePickerTarget = 'operation';
  const term = els.operationArticle.value.trim();
  if (!term) return;
  const rows = await searchArticles(term);
  const exactRows = rows.filter((row) => String(row.plu || '').toLowerCase() === term.toLowerCase());

  if (!rows.length) {
    els.operationArticleId.value = '';
    els.operationArticleSelected.textContent = 'Aucun article trouve pour ce PLU';
    state.profiles = [];
    renderProfiles();
    renderOperationLots([]);
    throw new Error('Aucun article trouve pour ce PLU');
  }

  if (exactRows.length === 1) {
    applyOperationArticle(exactRows[0]);
    return;
  }

  if (rows.length === 1) {
    applyOperationArticle(rows[0]);
    return;
  }

  openArticlePicker(term, rows);
}

async function resolveModelArticleFromInput() {
  const term = els.modelArticle.value.trim();
  if (!term) return;
  state.articlePickerTarget = 'model';
  const rows = await searchArticles(term);
  const exactRows = rows.filter((row) => String(row.plu || '').toLowerCase() === term.toLowerCase());
  if (!rows.length) {
    els.modelArticleId.value = '';
    els.modelArticleSelected.textContent = 'Aucun article trouve';
    throw new Error('Aucun article trouve');
  }
  if (exactRows.length === 1) return applyModelArticle(exactRows[0]);
  if (rows.length === 1) return applyModelArticle(rows[0]);
  openArticlePicker(term, rows);
}

function canOpenArticlePickerFromKeydown(event) {
  return event.key === 'F9' && event.target === els.operationArticle;
}

function articleSearchTerm() {
  const value = els.operationArticle.value.trim();
  if (state.selectedOperationArticle?.plu && value === articleDisplay(state.selectedOperationArticle)) {
    return state.selectedOperationArticle.plu;
  }
  return value.includes(' - ') ? value.split(' - ')[0].trim() : value;
}

function openOperationArticlePicker(event) {
  if (event) event.preventDefault();
  state.articlePickerTarget = 'operation';
  openArticlePicker(articleSearchTerm());
}

function openModelArticlePicker(event) {
  if (event) event.preventDefault();
  state.articlePickerTarget = 'model';
  openArticlePicker(els.modelArticle.value.trim());
}

function requireResolvedArticleId() {
  const articleId = els.operationArticleId.value.trim();
  if (!isUuid(articleId)) throw new Error('Selectionne un article valide par PLU ou F9 avant de continuer');
  return articleId;
}

function showArticleSearchError(error) {
  els.articlePickerResults.innerHTML = `<tr><td colspan="5">Erreur recherche article: ${escapeHtml(error.message)} ${retryButton('article-picker')}</td></tr>`;
}

function openArticlePicker(initialSearch = '', initialRows = null) {
  els.articlePickerSearch.value = initialSearch;
  els.articlePickerModal.classList.remove('hidden');
  state.articlePickerRows = Array.isArray(initialRows) ? initialRows : [];
  renderArticlePickerResults(state.articlePickerRows);
  setTimeout(() => els.articlePickerSearch.focus(), 50);
  if (!initialRows && initialSearch) runArticlePickerSearch().catch((error) => {
    showArticleSearchError(error);
    handleActionError(error);
  });
}

function closeArticlePicker() {
  els.articlePickerModal.classList.add('hidden');
}

function renderArticlePickerResults(rows) {
  if (!rows.length) {
    els.articlePickerResults.innerHTML = '<tr><td colspan="5">Aucun article trouve.</td></tr>';
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
  try {
    const rows = await searchArticles(els.articlePickerSearch.value);
    state.articlePickerRows = rows;
    renderArticlePickerResults(rows);
  } catch (error) {
    showArticleSearchError(error);
    throw error;
  }
}

async function previewOperation() {
  if (!els.operationArticleId.value.trim()) await resolveOperationArticleFromInput();
  requireResolvedArticleId();
  state.preview = await api('/api/packaging/operations/preview', {
    method: 'POST',
    body: JSON.stringify(collectOperationPayload()),
  });
  renderPreview(state.preview);
}

async function submitOperation(event) {
  event.preventDefault();
  if (!els.operationArticleId.value.trim()) await resolveOperationArticleFromInput();
  requireResolvedArticleId();
  const data = await api('/api/packaging/operations', {
    method: 'POST',
    body: JSON.stringify(collectOperationPayload()),
  });
  await api(`/api/packaging/operations/${encodeURIComponent(data.operation.id)}/validate`, { method: 'POST' });
  await Promise.all([loadItems(), loadOperations(), loadStockMovements()]);
  showFeedback('Conditionnement valide : produit inchange, emballages deduits, cout ajoute trace.', 'success');
}

async function validateOperation(operationId) {
  await api(`/api/packaging/operations/${encodeURIComponent(operationId)}/validate`, { method: 'POST' });
  await Promise.all([loadItems(), loadOperations(), loadStockMovements()]);
  showFeedback('Operation validee : emballages deduits et cout incorpore au prix de revient.', 'success');
}

async function cancelOperation(operationId) {
  const reason = window.prompt('Motif d annulation du conditionnement');
  if (!reason || !reason.trim()) return;
  await api(`/api/packaging/operations/${encodeURIComponent(operationId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason.trim() }),
  });
  await Promise.all([loadItems(), loadOperations(), loadStockMovements()]);
  showFeedback('Operation annulee : emballages recredites et cout conditionnement annule.', 'success');
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

function openMovementCancelModal(movementId) {
  const movement = state.stockMovements.find((row) => String(row.id) === String(movementId));
  if (!movement) return;
  state.movementToCancel = movement;
  els.movementCancelSummary.innerHTML = `
    <div><strong>${escapeHtml(movement.code || '')}</strong> - ${escapeHtml(movement.designation || '')}</div>
    <div>Date: <strong>${formatDate(movement.movement_date)}</strong></div>
    <div>Type: <strong>${escapeHtml(movement.movement_type)}</strong></div>
    <div>Quantite: <strong>${formatNumber(movement.quantity)} ${escapeHtml(movement.management_unit || '')}</strong></div>
    <div>Cout HT: <strong>${formatMoney(movement.unit_cost_ex_vat)}</strong></div>
    <div>Un mouvement inverse sera cree pour conserver l historique complet.</div>
  `;
  els.movementCancelReason.value = '';
  els.movementCancelModal.classList.remove('hidden');
  setTimeout(() => els.movementCancelReason.focus(), 50);
}

function closeMovementCancelModal() {
  state.movementToCancel = null;
  els.movementCancelModal.classList.add('hidden');
}

async function cancelStockMovement(event) {
  event.preventDefault();
  const movement = state.movementToCancel;
  const reason = els.movementCancelReason.value;
  if (!reason || !reason.trim()) {
    els.movementCancelReason.focus();
    showFeedback('Justification obligatoire pour annuler ce mouvement.', 'error');
    return;
  }

  els.confirmMovementCancelBtn.disabled = true;
  await api(`/api/packaging/stock-movements/${encodeURIComponent(movement.id)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  }).finally(() => {
    els.confirmMovementCancelBtn.disabled = false;
  });
  closeMovementCancelModal();
  await Promise.allSettled([loadItems(), loadStockMovements()]);
  showFeedback('Mouvement annule par mouvement inverse.', 'success');
}

function retryLoad(action) {
  if (action === 'items') return loadItems();
  if (action === 'models') return loadModels();
  if (action === 'stock-movements') return loadStockMovements();
  if (action === 'operations') return loadOperations();
  if (action === 'returnables') return loadReturnables();
  if (action === 'article-picker') return runArticlePickerSearch();
  return refreshAll();
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
  els.operationForm.addEventListener('submit', (event) => submitOperation(event).catch(handleActionError));
  els.previewOperationBtn.addEventListener('click', () => previewOperation().catch(handleActionError));
  els.returnableForm.addEventListener('submit', (event) => submitReturnable(event).catch(handleActionError));
  els.itemSearch.addEventListener('input', renderItems);
  els.movementItem.addEventListener('change', () => {
    updateSelectedPackagingSummary();
  });
  els.movementHistoryItem.addEventListener('change', () => loadStockMovements().catch(handleActionError));
  els.returnableItem.addEventListener('change', prefillReturnableDeposit);
  els.newModelBtn.addEventListener('click', () => openModelForm());
  els.cancelModelBtn.addEventListener('click', closeModelForm);
  els.modelForm.addEventListener('submit', (event) => submitModel(event).catch(handleActionError));
  els.addModelComponentBtn.addEventListener('click', () => {
  const firstItem = state.items.find((item) => item.active !== false && item.category === 'consumable');
    if (!firstItem) {
      showFeedback('Aucun article emballage consommable actif disponible dans Articles.', 'error');
      return;
    }
    state.modelComponents = [...(state.modelComponents || []), { packaging_item_id: firstItem.id, quantity: 1 }];
    renderModelComponents();
  });
  els.modelComponents.addEventListener('input', (event) => {
    const row = event.target.closest('[data-component-index]');
    if (!row) return;
    const index = Number(row.dataset.componentIndex);
    const field = event.target.dataset.componentField;
    state.modelComponents[index][field] = event.target.value;
    renderModelComponents();
  });
  els.modelComponents.addEventListener('change', (event) => {
    const row = event.target.closest('[data-component-index]');
    if (!row) return;
    const index = Number(row.dataset.componentIndex);
    const field = event.target.dataset.componentField;
    state.modelComponents[index][field] = event.target.value;
    renderModelComponents();
  });
  els.modelComponents.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-component]');
    if (!button) return;
    state.modelComponents.splice(Number(button.dataset.removeComponent), 1);
    renderModelComponents();
  });
  els.modelsTbody.addEventListener('click', (event) => {
    const editButton = event.target.closest('[data-edit-model]');
    const disableButton = event.target.closest('[data-disable-model]');
    if (editButton) {
      const profile = state.allProfiles.find((candidate) => String(candidate.id) === String(editButton.dataset.editModel));
      if (profile) openModelForm(profile);
    }
    if (disableButton) {
      api(`/api/packaging/profiles/${encodeURIComponent(disableButton.dataset.disableModel)}/deactivate`, { method: 'POST' })
        .then(loadModels)
        .catch(handleActionError);
    }
  });
  els.modelArticle.addEventListener('input', () => {
    els.modelArticleId.value = '';
    els.modelArticleSelected.textContent = 'Aucun article selectionne.';
  });
  els.modelArticle.addEventListener('keydown', (event) => {
    if (event.key === 'F9' && event.target === els.modelArticle) {
      event.preventDefault();
      openModelArticlePicker(event);
    }
  });
  els.modelArticle.addEventListener('blur', () => resolveModelArticleFromInput().catch(handleActionError));
  els.modelArticleF9Btn.addEventListener('mousedown', (event) => event.preventDefault());
  els.modelArticleF9Btn.addEventListener('click', openModelArticlePicker);
  els.operationArticle.addEventListener('input', () => {
    els.operationArticleId.value = '';
    els.operationArticleSelected.textContent = 'Aucun article selectionne.';
    updateOperationSubmitState();
  });
  els.operationArticle.addEventListener('blur', () => resolveOperationArticleFromInput().catch(handleActionError));
  els.operationArticle.addEventListener('keydown', (event) => {
    if (canOpenArticlePickerFromKeydown(event)) {
      event.preventDefault();
      openOperationArticlePicker(event);
    }
  });
  els.operationArticleF9Btn.addEventListener('mousedown', (event) => event.preventDefault());
  els.operationArticleF9Btn.addEventListener('click', openOperationArticlePicker);
  els.closeArticlePickerBtn.addEventListener('click', closeArticlePicker);
  els.closeMovementCancelBtn.addEventListener('click', closeMovementCancelModal);
  els.movementCancelForm.addEventListener('submit', (event) => cancelStockMovement(event).catch(handleActionError));
  els.articlePickerSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runArticlePickerSearch().catch(handleActionError);
  });
  els.articlePickerSearch.addEventListener('input', () => runArticlePickerSearch().catch(handleActionError));
  document.addEventListener('click', (event) => {
    const retry = event.target.closest('[data-retry]');
    if (retry) retryLoad(retry.dataset.retry).catch(handleActionError);
  });
  els.itemsTbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-open-article]');
    if (button) openArticleDetail(button.dataset.openArticle);
  });
  els.stockMovementsTbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-cancel-stock-movement]');
    if (button) openMovementCancelModal(button.dataset.cancelStockMovement);
  });
  els.articlePickerResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-pick-article]');
    if (!button) return;
    const article = (state.articlePickerRows || []).find((row) => String(row.id || row.article_id) === String(button.dataset.pickArticle));
    if (article && state.articlePickerTarget === 'model') applyModelArticle(article);
    if (article && state.articlePickerTarget === 'operation') applyOperationArticle(article);
    closeArticlePicker();
  });
  ['operation-lot', 'operation-profile', 'operation-kg', 'operation-packages'].forEach((id) => {
    document.getElementById(id).addEventListener('input', updateOperationSubmitState);
    document.getElementById(id).addEventListener('change', updateOperationSubmitState);
  });
  els.operationsTbody.addEventListener('click', (event) => {
    const validateButton = event.target.closest('[data-validate-operation]');
    const cancelButton = event.target.closest('[data-cancel-operation]');
    if (validateButton) validateOperation(validateButton.dataset.validateOperation).catch(handleActionError);
    if (cancelButton) cancelOperation(cancelButton.dataset.cancelOperation).catch(handleActionError);
  });
  setupTabs();
}

function handleActionError(error) {
  console.error(error);
  showFeedback(error.message, 'error');
}

setupEvents();
refreshAll();
