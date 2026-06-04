const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

function getToken() {
  return localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
}

function getSessionUser() {
  try {
    return JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  } catch {
    return null;
  }
}

function requireAuth() {
  const token = getToken();
  const user = getSessionUser();
  if (!token || !user) {
    window.location.href = './login.html';
    return null;
  }
  return { token, user };
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data?.error || data || 'Erreur API');
  return data;
}

function logout() {
  ['gc_token', 'gc_user', 'gc_active_department', 'grv2_token', 'grv2_user', 'grv2_active_department'].forEach((key) => localStorage.removeItem(key));
  window.location.href = './login.html';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('fr-FR');
}

function formatNumber(value, decimals = 3) {
  const number = Number(value || 0);
  return number.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function setMessage(elementId, message, type = 'info') {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.className = `page-message ${type}`;
  el.textContent = message || '';
}

function clearMessage(elementId) {
  setMessage(elementId, '', 'info');
}

function isListPage() {
  return !!document.getElementById('transformations-table-body');
}

function isDetailPage() {
  return !!document.getElementById('transformation-date');
}

function selectedOption(selectId) {
  const select = document.getElementById(selectId);
  return select?.selectedOptions?.[0] || null;
}

function articleFromOption(option) {
  if (!option?.value) return null;
  return {
    id: option.value,
    plu: option.dataset.plu || '',
    designation: option.dataset.designation || option.textContent || '',
    unit: option.dataset.unit || 'kg',
  };
}

function populateArticleSelect(selectEl, articles, currentValue = '') {
  if (!selectEl) return;
  const rows = Array.isArray(articles) ? articles : [];
  selectEl.innerHTML = '<option value="">Sélectionner...</option>';
  rows.forEach((article) => {
    const option = document.createElement('option');
    option.value = article.id;
    option.textContent = `${article.plu || ''} - ${article.designation || article.display_name || ''}`.trim();
    option.dataset.plu = article.plu || '';
    option.dataset.designation = article.designation || article.display_name || '';
    option.dataset.unit = article.unit || 'kg';
    selectEl.appendChild(option);
  });
  if (currentValue) selectEl.value = currentValue;
}

async function searchArticles(query, mode) {
  const params = new URLSearchParams({ mode, q: query || '', limit: '30' });
  return apiFetch(`/api/transformations/articles/search?${params.toString()}`);
}

const detailState = {
  transformationId: null,
  transformation: null,
  inputLots: [],
  sourceLotsAvailable: [],
};

async function createTransformation() {
  try {
    clearMessage('page-message');
    const created = await apiFetch('/api/transformations', {
      method: 'POST',
      body: JSON.stringify({ transformation_date: new Date().toISOString().slice(0, 10) }),
    });
    window.location.href = `./transformation-detail.html?id=${created.transformation.id}`;
  } catch (error) {
    console.error(error);
    setMessage('page-message', error.message, 'error');
  }
}

async function loadTransformationsList() {
  const session = requireAuth();
  if (!session) return;
  const tbody = document.getElementById('transformations-table-body');
  document.getElementById('user-name').textContent = session.user.email || 'Utilisateur';

  const status = document.getElementById('status-filter')?.value || '';
  const limit = document.getElementById('limit-filter')?.value || '50';
  const params = new URLSearchParams({ limit });
  if (status) params.set('status', status);

  tbody.innerHTML = '<tr><td colspan="6">Chargement...</td></tr>';
  try {
    clearMessage('page-message');
    const rows = await apiFetch(`/api/transformations?${params.toString()}`);
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6">Aucune transformation.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((row) => {
      const source = row.input_plu ? `${row.input_plu} - ${row.input_designation || ''} (${formatNumber(row.input_quantity)} ${row.input_unit || 'kg'})` : '-';
      const target = row.output_plu ? `${row.output_plu} - ${row.output_designation || ''} (${formatNumber(row.output_quantity)} ${row.output_unit || 'kg'})` : '-';
      return `<tr>
        <td>${formatDate(row.transformation_date || row.created_at)}</td>
        <td><span class="transfo-status-badge transfo-status-${escapeHtml(row.status || 'draft')}">${escapeHtml(row.status || '-')}</span></td>
        <td>${escapeHtml(source)}</td>
        <td>${escapeHtml(target)}</td>
        <td>${escapeHtml(row.reference_number || '-')}</td>
        <td><button class="btn btn-small btn-primary" data-open-id="${escapeHtml(row.id)}">Ouvrir</button></td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('[data-open-id]').forEach((button) => {
      button.addEventListener('click', () => { window.location.href = `./transformation-detail.html?id=${button.dataset.openId}`; });
    });
  } catch (error) {
    console.error(error);
    tbody.innerHTML = '<tr><td colspan="6">Erreur de chargement.</td></tr>';
    setMessage('page-message', error.message, 'error');
  }
}

async function preloadArticle(selectId, searchId, article) {
  const select = document.getElementById(selectId);
  const search = document.getElementById(searchId);
  if (!article?.id) {
    populateArticleSelect(select, [], '');
    search.value = '';
    return;
  }
  populateArticleSelect(select, [article], article.id);
  search.value = `${article.plu || ''} - ${article.designation || ''}`.trim();
}

async function loadTransformationDetail() {
  const session = requireAuth();
  if (!session) return;
  document.getElementById('detail-user-name').textContent = session.user.email || 'Utilisateur';

  const transformationId = new URLSearchParams(window.location.search).get('id');
  if (!transformationId) {
    setMessage('detail-message', 'ID transformation manquant', 'error');
    return;
  }
  detailState.transformationId = transformationId;

  try {
    clearMessage('detail-message');
    const data = await apiFetch(`/api/transformations/${encodeURIComponent(transformationId)}`);
    const transformation = data.transformation || {};
    const input = data.inputs?.[0] || null;
    const output = data.outputs?.[0] || null;
    detailState.transformation = transformation;
    detailState.inputLots = data.input_lots || [];

    document.getElementById('detail-title').textContent = `Transformation ${transformation.reference_number || String(transformation.id || '').slice(0, 8)}`;
    document.getElementById('transformation-date').value = (transformation.transformation_date || '').slice(0, 10);
    document.getElementById('transformation-status').value = transformation.status || 'draft';
    document.getElementById('transformation-reference').value = transformation.reference_number || '';
    document.getElementById('transformation-notes').value = transformation.notes || '';

    await preloadArticle('input-article-select', 'input-article-search', input ? { id: input.article_id, plu: input.article_plu, designation: input.article_name, unit: input.input_unit } : null);
    await preloadArticle('output-article-select', 'output-article-search', output ? { id: output.article_id, plu: output.article_plu, designation: output.article_name, unit: output.output_unit } : null);

    document.getElementById('input-quantity').value = input?.input_quantity ?? '';
    document.getElementById('input-unit').value = input?.input_unit || 'kg';
    document.getElementById('output-quantity').value = output?.output_quantity ?? '';
    document.getElementById('output-unit').value = output?.output_unit || 'kg';

    renderYieldPreview();
    renderUsedLots();
    await loadAvailableLots(false);
    refreshButtons();
  } catch (error) {
    console.error(error);
    setMessage('detail-message', error.message, 'error');
  }
}

function renderYieldPreview() {
  const inputQty = Number(document.getElementById('input-quantity').value || 0);
  const outputQty = Number(document.getElementById('output-quantity').value || 0);
  const yieldEl = document.getElementById('yield-preview');
  const costEl = document.getElementById('cost-preview');
  yieldEl.textContent = inputQty > 0 && outputQty > 0 ? `Rendement : ${((outputQty / inputQty) * 100).toFixed(2)} %` : 'Rendement : -';
  const cost = detailState.transformation?.output_unit_cost_ex_vat || 0;
  costEl.textContent = cost > 0 ? `PA transformé : ${formatNumber(cost, 4)} HT` : 'PA transformé : -';
}

function renderAvailableLots() {
  const tbody = document.getElementById('available-lots-body');
  const lots = detailState.sourceLotsAvailable || [];
  if (!lots.length) {
    tbody.innerHTML = '<tr><td colspan="6">Aucun lot chargé.</td></tr>';
    return;
  }
  tbody.innerHTML = lots.map((lot) => `<tr>
    <td>${escapeHtml(lot.lot_code || '-')}</td>
    <td>${escapeHtml(lot.supplier_name || '-')}</td>
    <td>${formatDate(lot.created_at)}</td>
    <td>${formatDate(lot.dlc)}</td>
    <td class="num">${formatNumber(lot.qty_remaining)}</td>
    <td class="num">${formatNumber(lot.unit_cost_ex_vat, 4)}</td>
  </tr>`).join('');
}

function renderUsedLots() {
  const tbody = document.getElementById('used-lots-body');
  const rows = detailState.inputLots || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5">Pas encore validée.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((row) => `<tr>
    <td>${escapeHtml(row.lot_code || '-')}</td>
    <td>${escapeHtml(row.selection_mode || '-')}</td>
    <td class="num">${formatNumber(row.quantity_taken)}</td>
    <td class="num">${formatNumber(row.unit_cost_ex_vat, 4)}</td>
    <td>${escapeHtml(row.supplier_name || '-')}</td>
  </tr>`).join('');
}

async function loadAvailableLots(showMessage = true) {
  const articleId = document.getElementById('input-article-select').value;
  if (!articleId) {
    detailState.sourceLotsAvailable = [];
    renderAvailableLots();
    if (showMessage) setMessage('detail-message', 'Choisis d’abord un article source', 'error');
    return;
  }
  try {
    const data = await apiFetch(`/api/transformations/articles/${encodeURIComponent(articleId)}/lots-available`);
    detailState.sourceLotsAvailable = data.lots || [];
    renderAvailableLots();
  } catch (error) {
    console.error(error);
    detailState.sourceLotsAvailable = [];
    renderAvailableLots();
    if (showMessage) setMessage('detail-message', error.message, 'error');
  }
}

function buildPayload() {
  const inputArticle = articleFromOption(selectedOption('input-article-select'));
  const outputArticle = articleFromOption(selectedOption('output-article-select'));
  return {
    transformation_date: document.getElementById('transformation-date').value || null,
    reference_number: document.getElementById('transformation-reference').value || null,
    notes: document.getElementById('transformation-notes').value || null,
    input_article_id: inputArticle?.id || null,
    input_quantity: Number(document.getElementById('input-quantity').value || 0),
    input_unit: document.getElementById('input-unit').value || inputArticle?.unit || 'kg',
    output_article_id: outputArticle?.id || null,
    output_quantity: Number(document.getElementById('output-quantity').value || 0),
    output_unit: document.getElementById('output-unit').value || outputArticle?.unit || 'kg',
  };
}

async function saveTransformation() {
  clearMessage('detail-message');
  await apiFetch(`/api/transformations/${detailState.transformationId}`, {
    method: 'PATCH',
    body: JSON.stringify(buildPayload()),
  });
  setMessage('detail-message', 'Transformation enregistrée', 'success');
  await loadTransformationDetail();
}

async function deleteTransformation() {
  const status = detailState.transformation?.status || 'draft';
  if (status === 'validated') {
    if (!confirm('Annuler cette transformation validée ? Le stock source sera restauré si le lot transformé n’a pas été consommé.')) return;
    try {
      const result = await apiFetch(`/api/transformations/${detailState.transformationId}/cancel-validated`, { method: 'POST' });
      setMessage('detail-message', result.message || 'Transformation annulée', 'success');
      await loadTransformationDetail();
    } catch (error) {
      console.error(error);
      setMessage('detail-message', error.message, 'error');
    }
    return;
  }
  if (!confirm('Supprimer cette transformation brouillon ?')) return;
  try {
    await apiFetch(`/api/transformations/${detailState.transformationId}`, { method: 'DELETE' });
    window.location.href = './transformations.html';
  } catch (error) {
    console.error(error);
    setMessage('detail-message', error.message, 'error');
  }
}

function openValidationModal() {
  document.getElementById('lot-choice-modal').classList.remove('hidden');
  document.getElementById('manual-lots-section').classList.add('hidden');
}

function closeValidationModal() {
  document.getElementById('lot-choice-modal').classList.add('hidden');
}

function renderManualLotsTable() {
  const tbody = document.getElementById('manual-lots-body');
  const lots = detailState.sourceLotsAvailable || [];
  if (!lots.length) {
    tbody.innerHTML = '<tr><td colspan="7">Aucun lot disponible.</td></tr>';
    return;
  }
  tbody.innerHTML = lots.map((lot) => `<tr>
    <td>${escapeHtml(lot.lot_code || '-')}</td>
    <td>${escapeHtml(lot.supplier_name || '-')}</td>
    <td>${formatDate(lot.created_at)}</td>
    <td>${formatDate(lot.dlc)}</td>
    <td class="num">${formatNumber(lot.qty_remaining)}</td>
    <td class="num">${formatNumber(lot.unit_cost_ex_vat, 4)}</td>
    <td><input type="number" step="0.001" min="0" max="${escapeHtml(lot.qty_remaining)}" class="input manual-lot-qty" data-lot-id="${escapeHtml(lot.lot_id)}" placeholder="0.000" /></td>
  </tr>`).join('');
}

async function validateTransformation(selectionMode, manualLots = []) {
  try {
    clearMessage('detail-message');
    await saveTransformation();
    const result = await apiFetch(`/api/transformations/${detailState.transformationId}/validate`, {
      method: 'POST',
      body: JSON.stringify({ selection_mode: selectionMode, manual_lots: manualLots }),
    });
    closeValidationModal();
    setMessage('detail-message', result.message || 'Transformation validée', 'success');
    await loadTransformationDetail();
  } catch (error) {
    console.error(error);
    setMessage('detail-message', error.message, 'error');
  }
}

function refreshButtons() {
  const status = detailState.transformation?.status || 'draft';
  const locked = status === 'validated';
  ['save-transformation-btn', 'validate-transformation-btn', 'input-article-search', 'input-article-select', 'input-quantity', 'input-unit', 'output-article-search', 'output-article-select', 'output-quantity', 'output-unit', 'load-source-lots-btn', 'transformation-date', 'transformation-reference', 'transformation-notes'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = locked;
  });
  const deleteBtn = document.getElementById('delete-transformation-btn');
  deleteBtn.disabled = false;
  deleteBtn.textContent = locked ? 'Annuler transformation validée' : 'Supprimer';
}

function bindListPage() {
  document.getElementById('back-home-btn')?.addEventListener('click', () => { window.location.href = './home.html'; });
  document.getElementById('logout-btn')?.addEventListener('click', logout);
  document.getElementById('refresh-btn')?.addEventListener('click', loadTransformationsList);
  document.getElementById('status-filter')?.addEventListener('change', loadTransformationsList);
  document.getElementById('limit-filter')?.addEventListener('change', loadTransformationsList);
  document.getElementById('create-transformation-btn')?.addEventListener('click', createTransformation);
}

function bindDetailPage() {
  document.getElementById('detail-back-list-btn')?.addEventListener('click', () => { window.location.href = './transformations.html'; });
  document.getElementById('detail-logout-btn')?.addEventListener('click', logout);
  document.getElementById('save-transformation-btn')?.addEventListener('click', () => saveTransformation().catch((error) => setMessage('detail-message', error.message, 'error')));
  document.getElementById('delete-transformation-btn')?.addEventListener('click', deleteTransformation);
  document.getElementById('validate-transformation-btn')?.addEventListener('click', async () => {
    try {
      await saveTransformation();
      await loadAvailableLots(false);
      openValidationModal();
    } catch (error) {
      setMessage('detail-message', error.message, 'error');
    }
  });
  document.getElementById('close-lot-choice-modal')?.addEventListener('click', closeValidationModal);
  document.getElementById('validate-fifo-btn')?.addEventListener('click', () => validateTransformation('fifo'));
  document.getElementById('manual-mode-btn')?.addEventListener('click', async () => {
    document.getElementById('manual-lots-section').classList.remove('hidden');
    await loadAvailableLots(false);
    renderManualLotsTable();
  });
  document.getElementById('confirm-manual-validate-btn')?.addEventListener('click', () => {
    const manualLots = Array.from(document.querySelectorAll('.manual-lot-qty'))
      .map((input) => ({ lot_id: input.dataset.lotId, quantity_taken: Number(input.value || 0) }))
      .filter((row) => row.lot_id && row.quantity_taken > 0);
    validateTransformation('manual', manualLots);
  });
  document.getElementById('load-source-lots-btn')?.addEventListener('click', () => loadAvailableLots(true));
  document.getElementById('input-quantity')?.addEventListener('input', renderYieldPreview);
  document.getElementById('output-quantity')?.addEventListener('input', renderYieldPreview);
  document.getElementById('input-article-select')?.addEventListener('change', () => loadAvailableLots(false));
  document.getElementById('input-article-search')?.addEventListener('input', async (event) => {
    try {
      populateArticleSelect(document.getElementById('input-article-select'), await searchArticles(event.target.value, 'source'));
    } catch (error) {
      setMessage('detail-message', error.message, 'error');
    }
  });
  document.getElementById('output-article-search')?.addEventListener('input', async (event) => {
    try {
      populateArticleSelect(document.getElementById('output-article-select'), await searchArticles(event.target.value, 'target'));
    } catch (error) {
      setMessage('detail-message', error.message, 'error');
    }
  });
}

async function init() {
  if (!requireAuth()) return;
  if (isListPage()) {
    bindListPage();
    await loadTransformationsList();
  }
  if (isDetailPage()) {
    bindDetailPage();
    await loadTransformationDetail();
  }
}

init();
