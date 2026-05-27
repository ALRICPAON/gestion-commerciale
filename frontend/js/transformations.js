const API_BASE_URL = `${window.APP_CONFIG.API_BASE_URL}/api`;

function getToken() {
  return localStorage.getItem('grv2_token');
}

function getSessionUser() {
  try {
    return JSON.parse(localStorage.getItem('grv2_user') || 'null');
  } catch {
    return null;
  }
}

function getActiveDepartment() {
  try {
    return JSON.parse(localStorage.getItem('grv2_active_department') || 'null');
  } catch {
    return null;
  }
}

function requireAuth() {
  const token = getToken();
  const user = getSessionUser();
  const department = getActiveDepartment();

  if (!token || !user || !department) {
    window.location.href = './login.html';
    return null;
  }

  return { token, user, department };
}

async function apiFetch(path, options = {}) {
  const token = getToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(data?.error || data || 'Erreur API');
  }

  return data;
}

function logout() {
  localStorage.removeItem('grv2_token');
  localStorage.removeItem('grv2_user');
  localStorage.removeItem('grv2_active_department');
  window.location.href = './login.html';
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR');
}

function formatNumber(value, decimals = 3) {
  const n = Number(value || 0);
  return n.toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
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

function parseQueryParams() {
  return new URLSearchParams(window.location.search);
}

function isTransformationsListPage() {
  return !!document.getElementById('transformations-table-body');
}

function isTransformationDetailPage() {
  return !!document.getElementById('transformation-date');
}

// =========================================================
// COMMON ARTICLE SEARCH
// =========================================================

async function searchSourceArticles(query) {
  const department = getActiveDepartment();
  if (!department?.id) return [];

  const q = encodeURIComponent(query || '');
  const dep = encodeURIComponent(department.id);

  return apiFetch(`/articles/search-in-stock?department_id=${dep}&q=${q}`);
}

async function searchTargetArticles(query) {
  const department = getActiveDepartment();
  if (!department?.id) return [];

  const q = encodeURIComponent(query || '');
  const dep = encodeURIComponent(department.id);

  return apiFetch(`/articles/search?department_id=${dep}&q=${q}`);
}

function populateArticleSelect(selectEl, articles, currentValue = '') {
  if (!selectEl) return;

  const rows = Array.isArray(articles) ? articles : [];
  selectEl.innerHTML = '<option value="">Sélectionner…</option>';

  rows.forEach((article) => {
    const option = document.createElement('option');
    option.value = article.id;
    option.textContent = `${article.plu || ''} - ${article.designation || article.display_name || ''}`.trim();
    option.dataset.plu = article.plu || '';
    option.dataset.designation = article.designation || article.display_name || '';
    option.dataset.unit = article.unit || 'kg';
    selectEl.appendChild(option);
  });

  if (currentValue) {
    selectEl.value = currentValue;
  }
}

// =========================================================
// CREATION BROUILLON
// =========================================================

async function createNewTransformationDraft() {
  const session = requireAuth();
  if (!session) return;

  const { department } = session;

  try {
    setMessage('page-message', 'Création du brouillon en cours...', 'info');

    const data = await apiFetch('/transformations', {
      method: 'POST',
      body: JSON.stringify({
        department_id: department.id,
        transformation_date: new Date().toISOString().split('T')[0],
      }),
    });

    setMessage('page-message', 'Brouillon créé avec succès', 'success');
    window.location.href = `./transformation-detail.html?id=${data.transformation.id}`;
  } catch (err) {
    console.error('Erreur création brouillon:', err);
    setMessage('page-message', `Erreur: ${err.message}`, 'error');
  }
}

// =========================================================
// LIST PAGE
// =========================================================

async function loadTransformationsList() {
  const session = requireAuth();
  if (!session) return;

  const { user, department } = session;

  const userNameEl = document.getElementById('user-name');
  if (userNameEl) userNameEl.textContent = user.email || 'Utilisateur';

  const depLabel = document.getElementById('department-label');
  if (depLabel) depLabel.textContent = `${department.name || 'Rayon'} (${department.code || ''})`;

  const status = document.getElementById('status-filter')?.value || '';
  const limit = document.getElementById('limit-filter')?.value || '50';

  const tbody = document.getElementById('transformations-table-body');
  tbody.innerHTML = '<tr><td colspan="6">Chargement…</td></tr>';

  try {
    clearMessage('page-message');

    const dep = encodeURIComponent(department.id);
    const query = new URLSearchParams({
      department_id: department.id,
      limit,
    });

    if (status) {
      query.set('status', status);
    }

    const rows = await apiFetch(`/transformations?${query.toString()}`);

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6">Aucune transformation.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((row) => {
      const source = row.input_plu
        ? `${row.input_plu} - ${row.input_designation || ''} (${formatNumber(row.input_quantity)} ${row.input_quantity !== null ? 'kg' : ''})`
        : '—';

      const target = row.output_plu
        ? `${row.output_plu} - ${row.output_designation || ''} (${formatNumber(row.output_quantity)} ${row.output_quantity !== null ? 'kg' : ''})`
        : '—';

      return `
        <tr>
          <td>${formatDate(row.transformation_date || row.created_at)}</td>
          <td>
  <span class="transfo-status-badge transfo-status-${row.status || 'draft'}">
    ${row.status || '—'}
  </span>
</td>
          <td>${source}</td>
          <td>${target}</td>
          <td>${row.reference_number || '—'}</td>
          <td>
            <button class="btn btn-small btn-primary" data-open-id="${row.id}">Ouvrir</button>
          </td>
        </tr>
      `;
    }).join('');

    document.querySelectorAll('[data-open-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-open-id');
        window.location.href = `./transformation-detail.html?id=${id}`;
      });
    });
  } catch (error) {
    console.error(error);
    tbody.innerHTML = '<tr><td colspan="6">Erreur de chargement.</td></tr>';
    setMessage('page-message', error.message, 'error');
  }
}

async function createTransformationAndOpen() {
  const session = requireAuth();
  if (!session) return;

  const { department } = session;

  try {
    clearMessage('page-message');

    const today = new Date().toISOString().slice(0, 10);

    const created = await apiFetch('/transformations', {
      method: 'POST',
      body: JSON.stringify({
        department_id: department.id,
        transformation_date: today,
        reference_number: '',
        notes: '',
        input_article_id: '00000000-0000-0000-0000-000000000000',
        input_quantity: 1,
        input_unit: 'kg',
        output_article_id: '00000000-0000-0000-0000-000000000000',
        output_quantity: 1,
        output_unit: 'kg',
      }),
    });

    window.location.href = `./transformation-detail.html?id=${created.transformation.id}`;
  } catch (error) {
    console.error(error);
    setMessage(
      'page-message',
      "Création impossible tant qu'on n'a pas choisi de vrais articles. Je corrige ça juste après avec un popup de création, mais pour l’instant crée la transformation depuis le détail après que je t’aie donné le patch si ça bloque.",
      'error'
    );
  }
}

// =========================================================
// DETAIL PAGE
// =========================================================

let detailState = {
  transformationId: null,
  transformation: null,
  inputs: [],
  outputs: [],
  inputLots: [],
  sourceLotsAvailable: [],
  inputSearchResults: [],
  outputSearchResults: [],
};

async function loadTransformationDetail() {
  const session = requireAuth();
  if (!session) return;

  const { user, department } = session;
  const params = parseQueryParams();
  const transformationId = params.get('id');

  if (!transformationId) {
    setMessage('detail-message', 'ID transformation manquant', 'error');
    return;
  }

  detailState.transformationId = transformationId;

  const userNameEl = document.getElementById('detail-user-name');
  if (userNameEl) userNameEl.textContent = user.email || 'Utilisateur';

  const depLabel = document.getElementById('detail-department-label');
  if (depLabel) depLabel.textContent = `${department.name || 'Rayon'} (${department.code || ''})`;

  try {
    clearMessage('detail-message');

    const data = await apiFetch(`/transformations/${transformationId}`);

    detailState.transformation = data.transformation;
    detailState.inputs = data.inputs || [];
    detailState.outputs = data.outputs || [];
    detailState.inputLots = data.input_lots || [];

    const input = detailState.inputs[0] || null;
    const output = detailState.outputs[0] || null;

    document.getElementById('detail-title').textContent =
      `Transformation ${data.transformation.reference_number || data.transformation.id}`;

    document.getElementById('transformation-date').value =
      (data.transformation.transformation_date || '').slice(0, 10);

    document.getElementById('transformation-status').value =
      data.transformation.status || 'draft';

    document.getElementById('transformation-reference').value =
      data.transformation.reference_number || '';

    document.getElementById('transformation-notes').value =
      data.transformation.notes || '';

    await preloadInputArticle(input);
    await preloadOutputArticle(output);

    document.getElementById('input-quantity').value = input?.input_quantity ?? '';
    document.getElementById('input-unit').value = input?.input_unit || 'kg';

    document.getElementById('output-quantity').value = output?.output_quantity ?? '';
    document.getElementById('output-unit').value = output?.output_unit || 'kg';

    renderYieldPreview();
    renderUsedLots();
    await loadAvailableLots(false);
    refreshDetailButtonsState();
  } catch (error) {
    console.error(error);
    setMessage('detail-message', error.message, 'error');
  }
}

async function preloadInputArticle(input) {
  const select = document.getElementById('input-article-select');
  const search = document.getElementById('input-article-search');

  if (!input?.article_id) {
    populateArticleSelect(select, [], '');
    search.value = '';
    return;
  }

  const label = `${input.article_plu || ''} - ${input.article_name || ''}`.trim();
  populateArticleSelect(select, [{
    id: input.article_id,
    plu: input.article_plu || '',
    designation: input.article_name || '',
    unit: input.input_unit || 'kg',
  }], input.article_id);
  search.value = label;
}

async function preloadOutputArticle(output) {
  const select = document.getElementById('output-article-select');
  const search = document.getElementById('output-article-search');

  if (!output?.article_id) {
    populateArticleSelect(select, [], '');
    search.value = '';
    return;
  }

  const label = `${output.article_plu || ''} - ${output.article_name || ''}`.trim();
  populateArticleSelect(select, [{
    id: output.article_id,
    plu: output.article_plu || '',
    designation: output.article_name || '',
    unit: output.output_unit || 'kg',
  }], output.article_id);
  search.value = label;
}

function refreshDetailButtonsState() {
  const status = detailState.transformation?.status || 'draft';
  const locked = status === 'validated';

  document.getElementById('save-transformation-btn').disabled = locked;
  document.getElementById('validate-transformation-btn').disabled = locked;
  document.getElementById('delete-transformation-btn').disabled = false; // Always enabled

  // Change delete button text and action based on status
  const deleteBtn = document.getElementById('delete-transformation-btn');
  if (status === 'validated') {
    deleteBtn.textContent = 'Annuler transformation validée';
  } else {
    deleteBtn.textContent = 'Supprimer';
  }

  document.getElementById('transformation-date').disabled = locked;
  document.getElementById('transformation-status').disabled = locked;
  document.getElementById('transformation-reference').disabled = locked;
  document.getElementById('transformation-notes').disabled = locked;
  document.getElementById('input-article-search').disabled = locked;
  document.getElementById('input-article-select').disabled = locked;
  document.getElementById('input-quantity').disabled = locked;
  document.getElementById('input-unit').disabled = locked;
  document.getElementById('output-article-search').disabled = locked;
  document.getElementById('output-article-select').disabled = locked;
  document.getElementById('output-quantity').disabled = locked;
  document.getElementById('output-unit').disabled = locked;
  document.getElementById('load-source-lots-btn').disabled = locked;
}

function renderYieldPreview() {
  const inputQty = Number(document.getElementById('input-quantity').value || 0);
  const outputQty = Number(document.getElementById('output-quantity').value || 0);

  const el = document.getElementById('yield-preview');
  if (!el) return;

  if (inputQty > 0 && outputQty > 0) {
    const ratio = outputQty / inputQty;
    el.textContent = `Rendement : ${(ratio * 100).toFixed(2)} %`;
  } else {
    el.textContent = 'Rendement : —';
  }
}

function renderAvailableLots() {
  const tbody = document.getElementById('available-lots-body');
  const lots = detailState.sourceLotsAvailable || [];

  if (!lots.length) {
    tbody.innerHTML = '<tr><td colspan="6">Aucun lot chargé.</td></tr>';
    return;
  }

  tbody.innerHTML = lots.map((lot) => `
    <tr>
      <td>${lot.lot_code || '—'}</td>
      <td>${lot.supplier_name || '—'}</td>
      <td>${formatDate(lot.created_at)}</td>
      <td>${formatDate(lot.dlc)}</td>
      <td>${formatNumber(lot.qty_remaining)}</td>
      <td>${formatNumber(lot.unit_cost_ex_vat, 4)}</td>
    </tr>
  `).join('');
}

function renderUsedLots() {
  const tbody = document.getElementById('used-lots-body');
  const rows = detailState.inputLots || [];

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5">Pas encore validée.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((row) => `
    <tr>
      <td>${row.lot_code || '—'}</td>
      <td>${row.selection_mode || '—'}</td>
      <td>${formatNumber(row.quantity_taken)}</td>
      <td>${formatNumber(row.unit_cost_ex_vat, 4)}</td>
      <td>${row.supplier_name || '—'}</td>
    </tr>
  `).join('');
}

async function loadAvailableLots(showMessage = true) {
  const department = getActiveDepartment();
  const inputArticleId = document.getElementById('input-article-select').value;

  if (!department?.id || !inputArticleId) {
    detailState.sourceLotsAvailable = [];
    renderAvailableLots();
    if (showMessage) {
      setMessage('detail-message', 'Choisis d’abord un article source', 'error');
    }
    return;
  }

  try {
    const data = await apiFetch(
      `/articles/${inputArticleId}/lots-available?department_id=${encodeURIComponent(department.id)}`
    );

    detailState.sourceLotsAvailable = data.lots || [];
    renderAvailableLots();
  } catch (error) {
    console.error(error);
    detailState.sourceLotsAvailable = [];
    renderAvailableLots();
    if (showMessage) {
      setMessage('detail-message', error.message, 'error');
    }
  }
}

async function saveTransformation() {
  try {
    clearMessage('detail-message');

    const payload = {
      transformation_date: document.getElementById('transformation-date').value || null,
      status: document.getElementById('transformation-status').value || 'draft',
      reference_number: document.getElementById('transformation-reference').value || null,
      notes: document.getElementById('transformation-notes').value || null,
      input_article_id: document.getElementById('input-article-select').value || null,
      input_quantity: Number(document.getElementById('input-quantity').value || 0),
      input_unit: document.getElementById('input-unit').value || 'kg',
      output_article_id: document.getElementById('output-article-select').value || null,
      output_quantity: Number(document.getElementById('output-quantity').value || 0),
      output_unit: document.getElementById('output-unit').value || 'kg',
    };

    await apiFetch(`/transformations/${detailState.transformationId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });

    setMessage('detail-message', 'Transformation enregistrée', 'success');
    await loadTransformationDetail();
  } catch (error) {
    console.error(error);
    setMessage('detail-message', error.message, 'error');
  }
}

async function deleteTransformation() {
  const status = detailState.transformation?.status || 'draft';

  if (status === 'validated') {
    // Cancel validated transformation
    if (!confirm('Cette action va remettre les ingrédients en stock et supprimer le lot transformé si non consommé. Continuer ?')) return;

    try {
      const result = await apiFetch(`/transformations/${detailState.transformationId}/cancel-validated`, {
        method: 'POST',
      });

      setMessage('detail-message', result.message || 'Transformation annulée avec succès.', 'success');
      await loadTransformationDetail(detailState.transformationId);
    } catch (error) {
      console.error(error);
      setMessage('detail-message', error.message, 'error');
    }
  } else {
    // Delete draft transformation
    if (!confirm('Supprimer cette transformation brouillon ?')) return;

    try {
      await apiFetch(`/transformations/${detailState.transformationId}`, {
        method: 'DELETE',
      });

      window.location.href = './transformations.html';
    } catch (error) {
      console.error(error);
      setMessage('detail-message', error.message, 'error');
    }
  }
}

function openValidationModal() {
  const modal = document.getElementById('lot-choice-modal');
  const manualSection = document.getElementById('manual-lots-section');
  modal.classList.remove('hidden');
  manualSection.classList.add('hidden');
}

function closeValidationModal() {
  const modal = document.getElementById('lot-choice-modal');
  modal.classList.add('hidden');
}

function renderManualLotsTable() {
  const tbody = document.getElementById('manual-lots-body');
  const lots = detailState.sourceLotsAvailable || [];

  if (!lots.length) {
    tbody.innerHTML = '<tr><td colspan="7">Aucun lot disponible.</td></tr>';
    return;
  }

  tbody.innerHTML = lots.map((lot) => `
    <tr>
      <td>${lot.lot_code || '—'}</td>
      <td>${lot.supplier_name || '—'}</td>
      <td>${formatDate(lot.created_at)}</td>
      <td>${formatDate(lot.dlc)}</td>
      <td>${formatNumber(lot.qty_remaining)}</td>
      <td>${formatNumber(lot.unit_cost_ex_vat, 4)}</td>
      <td>
        <input
          type="number"
          step="0.001"
          min="0"
          max="${lot.qty_remaining}"
          class="input manual-lot-qty"
          data-lot-id="${lot.lot_id}"
          placeholder="0.000"
        />
      </td>
    </tr>
  `).join('');
}

async function validateTransformationFifo() {
  const button = document.getElementById('validate-fifo-btn');
  const originalText = button?.textContent;

  try {
    clearMessage('detail-message');

    if (button) {
      button.disabled = true;
      button.textContent = 'Validation...';
    }

    await saveTransformation();

    await apiFetch(`/transformations/${detailState.transformationId}/validate`, {
      method: 'POST',
      body: JSON.stringify({
        selection_mode: 'fifo',
      }),
    });

    closeValidationModal();
    setMessage('detail-message', 'Transformation validée en FIFO', 'success');
    await loadTransformationDetail();
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = originalText || 'Valider FIFO';
    }
    console.error(error);
    setMessage('detail-message', error.message, 'error');
  }
}

async function validateTransformationManual() {
  const button = document.getElementById('confirm-manual-validate-btn');
  const originalText = button?.textContent;

  try {
    clearMessage('detail-message');

    if (button) {
      button.disabled = true;
      button.textContent = 'Validation...';
    }

    await saveTransformation();

    const inputs = Array.from(document.querySelectorAll('.manual-lot-qty'));
    const manualLots = inputs
      .map((input) => ({
        lot_id: input.dataset.lotId,
        quantity_taken: Number(input.value || 0),
      }))
      .filter((row) => row.lot_id && row.quantity_taken > 0);

    await apiFetch(`/transformations/${detailState.transformationId}/validate`, {
      method: 'POST',
      body: JSON.stringify({
        selection_mode: 'manual',
        manual_lots: manualLots,
      }),
    });

    closeValidationModal();
    setMessage('detail-message', 'Transformation validée avec sélection manuelle', 'success');
    await loadTransformationDetail();
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = originalText || 'Valider';
    }
    console.error(error);
    setMessage('detail-message', error.message, 'error');
  }
}

// =========================================================
// PAGE INIT
// =========================================================

function bindListPageEvents() {
  document.getElementById('back-home-btn')?.addEventListener('click', () => {
    window.location.href = './home.html';
  });

  document.getElementById('logout-btn')?.addEventListener('click', logout);

  document.getElementById('refresh-btn')?.addEventListener('click', loadTransformationsList);
  document.getElementById('status-filter')?.addEventListener('change', loadTransformationsList);
  document.getElementById('limit-filter')?.addEventListener('change', loadTransformationsList);

  // temporairement désactivé tant qu'on n'a pas fait le popup de création complet
  document.getElementById('create-transformation-btn')?.addEventListener('click', createNewTransformationDraft);
}


function bindDetailPageEvents() {
  document.getElementById('detail-back-list-btn')?.addEventListener('click', () => {
    window.location.href = './transformations.html';
  });

  document.getElementById('detail-logout-btn')?.addEventListener('click', logout);

  document.getElementById('save-transformation-btn')?.addEventListener('click', saveTransformation);
  document.getElementById('delete-transformation-btn')?.addEventListener('click', deleteTransformation);

  document.getElementById('validate-transformation-btn')?.addEventListener('click', async () => {
  try {
    await saveTransformation();
    await loadAvailableLots(false);
    openValidationModal();
  } catch (error) {
    console.error(error);
    setMessage('detail-message', error.message, 'error');
  }
});

  document.getElementById('close-lot-choice-modal')?.addEventListener('click', closeValidationModal);
  document.getElementById('validate-fifo-btn')?.addEventListener('click', validateTransformationFifo);

  document.getElementById('manual-mode-btn')?.addEventListener('click', async () => {
    document.getElementById('manual-lots-section').classList.remove('hidden');
    await loadAvailableLots(false);
    renderManualLotsTable();
  });

  document.getElementById('confirm-manual-validate-btn')?.addEventListener('click', validateTransformationManual);

  document.getElementById('load-source-lots-btn')?.addEventListener('click', async () => {
  clearMessage('detail-message');
  await loadAvailableLots(true);
});

  document.getElementById('input-quantity')?.addEventListener('input', renderYieldPreview);
  document.getElementById('output-quantity')?.addEventListener('input', renderYieldPreview);

  document.getElementById('input-article-search')?.addEventListener('input', async (e) => {
  try {
    const rows = await searchSourceArticles(e.target.value);
    detailState.inputSearchResults = rows;
    populateArticleSelect(document.getElementById('input-article-select'), rows);
  } catch (error) {
    console.error(error);
    setMessage('detail-message', error.message, 'error');
  }
});

document.getElementById('output-article-search')?.addEventListener('input', async (e) => {
  try {
    const rows = await searchTargetArticles(e.target.value);
    detailState.outputSearchResults = rows;
    populateArticleSelect(document.getElementById('output-article-select'), rows);
  } catch (error) {
    console.error(error);
    setMessage('detail-message', error.message, 'error');
  }
});

  document.getElementById('input-article-select')?.addEventListener('change', async () => {
  clearMessage('detail-message');
  await loadAvailableLots(false);
});
}

async function init() {
  const session = requireAuth();
  if (!session) return;

  if (isTransformationsListPage()) {
    bindListPageEvents();
    await loadTransformationsList();
  }

  if (isTransformationDetailPage()) {
    bindDetailPageEvents();
    await loadTransformationDetail();
  }
}

init();
