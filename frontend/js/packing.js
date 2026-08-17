const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const sessionToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const sessionUserRaw = localStorage.getItem('gc_user') || localStorage.getItem('grv2_user');

if (!sessionToken || !sessionUserRaw) {
  window.location.href = './login.html';
}

const sessionUser = JSON.parse(sessionUserRaw);

const els = {
  userName: document.getElementById('user-name'),
  backHome: document.getElementById('back-home-btn'),
  logout: document.getElementById('logout-btn'),
  refresh: document.getElementById('refresh-packing-btn'),
  newPacking: document.getElementById('new-packing-btn'),
  feedback: document.getElementById('packing-feedback'),
  tbody: document.getElementById('packing-tbody'),
  tabs: Array.from(document.querySelectorAll('.packing-tab')),
  draftModal: document.getElementById('draft-modal'),
  closeDraftModal: document.getElementById('close-draft-modal-btn'),
  draftForm: document.getElementById('draft-form'),
  outputArticleId: document.getElementById('output-article-id'),
  outputArticleSearch: document.getElementById('output-article-search'),
  outputArticleSelected: document.getElementById('output-article-selected'),
  articleResults: document.getElementById('article-results'),
  packageCount: document.getElementById('draft-package-count'),
  quantityPerPackage: document.getElementById('draft-quantity-per-package'),
  totalPreview: document.getElementById('draft-total-preview'),
  notes: document.getElementById('draft-notes'),
};

const state = {
  status: 'draft',
  operations: [],
  selectedArticle: null,
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

function logout() {
  ['gc_token', 'gc_user', 'gc_active_department', 'grv2_token', 'grv2_user', 'grv2_active_department'].forEach((key) => localStorage.removeItem(key));
  window.location.href = './login.html';
}

function setFeedback(message = '', type = '') {
  els.feedback.textContent = message;
  els.feedback.className = 'page-feedback';
  if (!message) els.feedback.classList.add('hidden');
  if (type) els.feedback.classList.add(type);
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Erreur API colisage');
    error.code = data.code || null;
    throw error;
  }
  return data;
}

function formatNumber(value, digits = 3) {
  const number = Number(value || 0);
  return number.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatMoney(value, digits = 2) {
  const number = Number(value || 0);
  return number.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('fr-FR');
}

function statusLabel(status) {
  if (status === 'validated') return 'Valide';
  if (status === 'cancelled') return 'Annule';
  return 'Brouillon';
}

function statusBadge(status) {
  return `<span class="packing-badge ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>`;
}

function renderOperations(rows) {
  if (!rows.length) {
    els.tbody.innerHTML = '<tr><td colspan="13">Aucune operation.</td></tr>';
    return;
  }

  els.tbody.innerHTML = rows.map((operation) => `
    <tr>
      <td>${formatDate(operation.created_at)}</td>
      <td><strong>${escapeHtml(operation.output_article_designation || '-')}</strong></td>
      <td>${escapeHtml(operation.output_article_plu || '-')}</td>
      <td class="numeric">${formatNumber(operation.total_output_quantity)} kg</td>
      <td class="numeric">${formatNumber(operation.package_count, 0)}</td>
      <td class="numeric">${formatNumber(operation.quantity_per_package)} kg</td>
      <td class="numeric">${formatMoney(operation.fish_cost_ex_vat)}</td>
      <td class="numeric">${formatMoney(operation.packaging_cost_ex_vat)}</td>
      <td class="numeric">${formatMoney(operation.total_cost_ex_vat)}</td>
      <td class="numeric">${formatMoney(operation.unit_cost_ex_vat, 4)}</td>
      <td>${statusBadge(operation.status)}</td>
      <td>${escapeHtml(operation.output_lot_code || '-')}</td>
      <td><a class="btn btn-secondary btn-sm" href="./packing-detail.html?id=${encodeURIComponent(operation.id)}">Voir</a></td>
    </tr>
  `).join('');
}

async function loadOperations() {
  try {
    setFeedback('Chargement...', '');
    els.tbody.innerHTML = '<tr><td colspan="13">Chargement...</td></tr>';
    const params = new URLSearchParams();
    if (state.status) params.set('status', state.status);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    state.operations = await api(`/api/packing${suffix}`);
    renderOperations(state.operations);
    setFeedback(`${state.operations.length} operation(s) chargee(s).`, 'success');
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
    els.tbody.innerHTML = '<tr><td colspan="13">Erreur de chargement.</td></tr>';
  }
}

function openDraftModal() {
  state.selectedArticle = null;
  els.draftForm.reset();
  els.outputArticleId.value = '';
  els.outputArticleSelected.textContent = 'Aucun article selectionne.';
  els.articleResults.classList.add('hidden');
  updateTotalPreview();
  els.draftModal.classList.remove('hidden');
  els.outputArticleSearch.focus();
}

function closeDraftModal() {
  els.draftModal.classList.add('hidden');
}

function updateTotalPreview() {
  const packages = Number(els.packageCount.value || 0);
  const perPackage = Number(els.quantityPerPackage.value || 0);
  const total = packages > 0 && perPackage > 0 ? packages * perPackage : 0;
  els.totalPreview.textContent = `${formatNumber(total)} kg`;
}

async function searchOutputArticles({ showAll = false } = {}) {
  const query = els.outputArticleSearch.value.trim();
  const data = showAll || !query
    ? await api('/api/articles?active=true&article_category=product&limit=50')
    : await api(`/api/articles/search?q=${encodeURIComponent(query)}&article_category=product`);
  renderArticleResults(Array.isArray(data) ? data : []);
}

function renderArticleResults(rows) {
  els.articleResults.classList.remove('hidden');
  if (!rows.length) {
    els.articleResults.innerHTML = '<div class="search-result"><span>Aucun produit trouve.</span></div>';
    return;
  }
  els.articleResults.innerHTML = rows.map((article) => `
    <button type="button" class="search-result" data-id="${escapeHtml(article.id)}">
      <strong>${escapeHtml(article.plu || '-')}</strong>
      <span>${escapeHtml(article.designation || article.display_name || '-')}</span>
      <small>${escapeHtml(article.unit || 'kg')}</small>
    </button>
  `).join('');
}

function selectOutputArticle(articleId) {
  const button = Array.from(els.articleResults.querySelectorAll('.search-result[data-id]'))
    .find((item) => String(item.dataset.id) === String(articleId));
  if (!button) return;
  state.selectedArticle = {
    id: articleId,
    plu: button.querySelector('strong')?.textContent || '',
    designation: button.querySelector('span')?.textContent || '',
  };
  els.outputArticleId.value = articleId;
  els.outputArticleSelected.textContent = `${state.selectedArticle.plu} - ${state.selectedArticle.designation}`;
  els.outputArticleSearch.value = `${state.selectedArticle.plu} ${state.selectedArticle.designation}`;
  els.articleResults.classList.add('hidden');
}

async function createDraft(event) {
  event.preventDefault();
  try {
    const articleId = els.outputArticleId.value;
    if (!articleId) throw new Error('Selectionner un article produit.');
    const packageCount = Number(els.packageCount.value);
    if (!Number.isInteger(packageCount) || packageCount <= 0) throw new Error('Le nombre de colis doit etre entier.');
    const payload = {
      output_article_id: articleId,
      package_count: packageCount,
      quantity_per_package: Number(els.quantityPerPackage.value),
      notes: els.notes.value.trim() || null,
    };
    const operation = await api('/api/packing', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    window.location.href = `./packing-detail.html?id=${encodeURIComponent(operation.id)}`;
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
  }
}

els.userName.textContent = sessionUser.email || 'Utilisateur';
els.backHome.addEventListener('click', () => { window.location.href = './home.html'; });
els.logout.addEventListener('click', logout);
els.refresh.addEventListener('click', loadOperations);
els.newPacking.addEventListener('click', openDraftModal);
els.closeDraftModal.addEventListener('click', closeDraftModal);
els.draftForm.addEventListener('submit', createDraft);
els.packageCount.addEventListener('input', updateTotalPreview);
els.quantityPerPackage.addEventListener('input', updateTotalPreview);

els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    els.tabs.forEach((item) => item.classList.toggle('active', item === tab));
    state.status = tab.dataset.status || '';
    loadOperations();
  });
});

els.outputArticleSearch.addEventListener('keydown', (event) => {
  if (event.key === 'F9') {
    event.preventDefault();
    searchOutputArticles({ showAll: true }).catch((error) => setFeedback(error.message, 'error'));
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    searchOutputArticles().catch((error) => setFeedback(error.message, 'error'));
  }
});

els.outputArticleSearch.addEventListener('input', () => {
  state.selectedArticle = null;
  els.outputArticleId.value = '';
});

els.articleResults.addEventListener('click', (event) => {
  const button = event.target.closest('.search-result[data-id]');
  if (button) selectOutputArticle(button.dataset.id);
});

loadOperations();
