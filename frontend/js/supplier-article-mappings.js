const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const sessionToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const sessionUserRaw = localStorage.getItem('gc_user') || localStorage.getItem('grv2_user');

if (!sessionToken || !sessionUserRaw) {
  window.location.href = './login.html';
}

const sessionUser = JSON.parse(sessionUserRaw);

const userNameEl = document.getElementById('user-name');
const backHomeBtn = document.getElementById('back-home-btn');
const logoutBtn = document.getElementById('logout-btn');
const refreshBtn = document.getElementById('refresh-btn');
const createMappingBtn = document.getElementById('create-mapping-btn');
const applyFiltersBtn = document.getElementById('apply-filters-btn');
const feedbackEl = document.getElementById('af-map-feedback');

const searchInput = document.getElementById('search-input');
const supplierFilterInput = document.getElementById('supplier-filter-input');
const supplierFilterF9Btn = document.getElementById('supplier-filter-f9-btn');
const supplierFilterClearBtn = document.getElementById('supplier-filter-clear-btn');
const statusFilter = document.getElementById('status-filter');
const mappingsTbody = document.getElementById('mappings-tbody');

const mappingModal = document.getElementById('mapping-modal');
const mappingModalTitle = document.getElementById('mapping-modal-title');
const closeMappingModalBtn = document.getElementById('close-mapping-modal-btn');
const mappingForm = document.getElementById('mapping-form');
const mappingIdInput = document.getElementById('mapping-id');
const mappingSupplierIdInput = document.getElementById('mapping-supplier-id');
const mappingArticleIdInput = document.getElementById('mapping-article-id');
const mappingSupplierDisplayInput = document.getElementById('mapping-supplier-display');
const mappingArticleDisplayInput = document.getElementById('mapping-article-display');
const mappingSupplierRefInput = document.getElementById('mapping-supplier-ref');
const mappingSupplierLabelInput = document.getElementById('mapping-supplier-label');
const mappingPurchaseUnitInput = document.getElementById('mapping-purchase-unit');
const mappingPriceUnitInput = document.getElementById('mapping-price-unit');
const mappingSupplierF9Btn = document.getElementById('mapping-supplier-f9-btn');
const mappingArticleF9Btn = document.getElementById('mapping-article-f9-btn');

const supplierModal = document.getElementById('supplier-modal');
const closeSupplierModalBtn = document.getElementById('close-supplier-modal-btn');
const supplierSearchInput = document.getElementById('supplier-search-input');
const supplierSearchBtn = document.getElementById('supplier-search-btn');
const supplierResultsTbody = document.getElementById('supplier-results-tbody');

const articleModal = document.getElementById('article-modal');
const closeArticleModalBtn = document.getElementById('close-article-modal-btn');
const articleSearchInput = document.getElementById('article-search-input');
const articleSearchBtn = document.getElementById('article-search-btn');
const articleResultsTbody = document.getElementById('article-results-tbody');

let mappingsCache = [];
let supplierPickerTarget = 'form';
let selectedFilterSupplier = null;

function authHeaders(json = true) {
  const headers = { Authorization: `Bearer ${sessionToken}` };
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function setFeedback(message = '', type = '') {
  feedbackEl.textContent = message;
  feedbackEl.className = 'page-feedback';
  if (!message) feedbackEl.classList.add('hidden');
  if (type) feedbackEl.classList.add(type);
}

function text(value) {
  return value === null || value === undefined || value === '' ? '-' : String(value);
}

function supplierLabel(row) {
  const code = row.supplier_code ? `${row.supplier_code} - ` : '';
  return `${code}${row.supplier_name || ''}`.trim();
}

function articleLabel(row) {
  const plu = row.article_plu ? `${row.article_plu} - ` : '';
  return `${plu}${row.article_designation || ''}`.trim();
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...authHeaders(options.body !== undefined),
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Erreur AF_MAP');
  return data;
}

function renderMappings(rows) {
  if (!rows.length) {
    mappingsTbody.innerHTML = '<tr><td colspan="9">Aucun mapping trouvé.</td></tr>';
    return;
  }

  mappingsTbody.innerHTML = rows.map((mapping) => `
    <tr>
      <td>${text(supplierLabel(mapping))}</td>
      <td>${text(mapping.supplier_ref)}</td>
      <td>${text(mapping.supplier_label)}</td>
      <td>${text(mapping.article_plu)}</td>
      <td>${text(mapping.article_designation)}</td>
      <td>${text(mapping.purchase_unit)}</td>
      <td>${text(mapping.price_unit)}</td>
      <td>${mapping.is_active ? 'Actif' : 'Inactif'}</td>
      <td>
        <div class="page-actions-right">
          <button class="btn btn-secondary btn-sm" type="button" data-action="edit" data-id="${mapping.id}">Modifier</button>
          <button class="btn btn-secondary btn-sm" type="button" data-action="toggle" data-id="${mapping.id}" data-active="${mapping.is_active}">
            ${mapping.is_active ? 'Désactiver' : 'Réactiver'}
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function loadMappings() {
  try {
    setFeedback('Chargement AF_MAP...');
    mappingsTbody.innerHTML = '<tr><td colspan="9">Chargement...</td></tr>';
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set('search', searchInput.value.trim());
    if (selectedFilterSupplier?.id) params.set('supplier_id', selectedFilterSupplier.id);
    if (statusFilter.value) params.set('status', statusFilter.value);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const rows = await fetchJson(`/api/supplier-article-mappings${suffix}`, { headers: authHeaders(false) });
    mappingsCache = rows;
    renderMappings(rows);
    setFeedback(`${rows.length} mapping(s) chargé(s).`, 'success');
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
    mappingsTbody.innerHTML = '<tr><td colspan="9">Erreur de chargement.</td></tr>';
  }
}

function openMappingModal(mapping = null) {
  mappingForm.reset();
  mappingIdInput.value = mapping?.id || '';
  mappingSupplierIdInput.value = mapping?.supplier_id || '';
  mappingArticleIdInput.value = mapping?.article_id || '';
  mappingSupplierDisplayInput.value = mapping ? supplierLabel(mapping) : '';
  mappingArticleDisplayInput.value = mapping ? articleLabel(mapping) : '';
  mappingSupplierRefInput.value = mapping?.supplier_ref || '';
  mappingSupplierLabelInput.value = mapping?.supplier_label || '';
  mappingPurchaseUnitInput.value = mapping?.purchase_unit || '';
  mappingPriceUnitInput.value = mapping?.price_unit || '';
  mappingModalTitle.textContent = mapping ? 'Modifier mapping' : 'Nouveau mapping';
  mappingModal.classList.remove('hidden');
}

function closeMappingModal() {
  mappingModal.classList.add('hidden');
}

function openSupplierModal(target = 'form') {
  supplierPickerTarget = target;
  supplierSearchInput.value = '';
  supplierResultsTbody.innerHTML = '<tr><td colspan="4">Lance une recherche.</td></tr>';
  supplierModal.classList.remove('hidden');
  supplierSearchInput.focus();
}

function closeSupplierModal() {
  supplierModal.classList.add('hidden');
}

function openArticleModal() {
  articleSearchInput.value = '';
  articleResultsTbody.innerHTML = '<tr><td colspan="5">Lance une recherche.</td></tr>';
  articleModal.classList.remove('hidden');
  articleSearchInput.focus();
}

function closeArticleModal() {
  articleModal.classList.add('hidden');
}

async function searchSuppliers() {
  try {
    supplierResultsTbody.innerHTML = '<tr><td colspan="4">Recherche...</td></tr>';
    const params = new URLSearchParams();
    if (supplierSearchInput.value.trim()) params.set('search', supplierSearchInput.value.trim());
    const rows = await fetchJson(`/api/suppliers?${params.toString()}`, { headers: authHeaders(false) });
    if (!rows.length) {
      supplierResultsTbody.innerHTML = '<tr><td colspan="4">Aucun fournisseur trouvé.</td></tr>';
      return;
    }
    supplierResultsTbody.innerHTML = rows.map((supplier) => `
      <tr>
        <td>${text(supplier.code)}</td>
        <td>${text(supplier.name)}</td>
        <td>${text(supplier.status)}</td>
        <td><button class="btn btn-secondary btn-sm" type="button" data-supplier-id="${supplier.id}">Choisir</button></td>
      </tr>
    `).join('');
  } catch (error) {
    console.error(error);
    supplierResultsTbody.innerHTML = `<tr><td colspan="4">${error.message}</td></tr>`;
  }
}

async function searchArticles() {
  try {
    articleResultsTbody.innerHTML = '<tr><td colspan="5">Recherche...</td></tr>';
    const params = new URLSearchParams();
    if (articleSearchInput.value.trim()) params.set('search', articleSearchInput.value.trim());
    params.set('active', 'true');
    params.set('limit', '100');
    const rows = await fetchJson(`/api/articles?${params.toString()}`, { headers: authHeaders(false) });
    if (!rows.length) {
      articleResultsTbody.innerHTML = '<tr><td colspan="5">Aucun article trouvé.</td></tr>';
      return;
    }
    articleResultsTbody.innerHTML = rows.map((article) => `
      <tr>
        <td>${text(article.plu)}</td>
        <td>${text(article.designation)}</td>
        <td>${text(article.purchase_unit)}</td>
        <td>${article.is_active ? 'Actif' : 'Inactif'}</td>
        <td><button class="btn btn-secondary btn-sm" type="button" data-article-id="${article.id}">Choisir</button></td>
      </tr>
    `).join('');
  } catch (error) {
    console.error(error);
    articleResultsTbody.innerHTML = `<tr><td colspan="5">${error.message}</td></tr>`;
  }
}

function chooseSupplier(supplier) {
  if (supplierPickerTarget === 'filter') {
    selectedFilterSupplier = supplier;
    supplierFilterInput.value = supplierLabel(supplier);
  } else {
    mappingSupplierIdInput.value = supplier.id;
    mappingSupplierDisplayInput.value = supplierLabel(supplier);
  }
  closeSupplierModal();
}

function chooseArticle(article) {
  mappingArticleIdInput.value = article.id;
  mappingArticleDisplayInput.value = articleLabel(article);
  if (!mappingPurchaseUnitInput.value && article.purchase_unit) mappingPurchaseUnitInput.value = article.purchase_unit;
  closeArticleModal();
}

async function saveMapping(event) {
  event.preventDefault();
  try {
    const payload = {
      supplier_id: mappingSupplierIdInput.value,
      article_id: mappingArticleIdInput.value,
      supplier_ref: mappingSupplierRefInput.value.trim(),
      supplier_label: mappingSupplierLabelInput.value.trim(),
      purchase_unit: mappingPurchaseUnitInput.value.trim(),
      price_unit: mappingPriceUnitInput.value.trim(),
    };

    if (!payload.supplier_id || !payload.article_id || !payload.supplier_ref) {
      throw new Error('Fournisseur, article et référence fournisseur sont obligatoires');
    }

    const mappingId = mappingIdInput.value;
    const path = mappingId ? `/api/supplier-article-mappings/${mappingId}` : '/api/supplier-article-mappings';
    const method = mappingId ? 'PATCH' : 'POST';
    await fetchJson(path, {
      method,
      body: JSON.stringify(payload),
    });
    closeMappingModal();
    await loadMappings();
    setFeedback('Mapping AF_MAP enregistré.', 'success');
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
  }
}

async function toggleMapping(mappingId, isActive) {
  const nextActive = !isActive;
  const confirmed = window.confirm(nextActive ? 'Réactiver ce mapping AF_MAP ?' : 'Désactiver ce mapping AF_MAP ?');
  if (!confirmed) return;
  try {
    await fetchJson(`/api/supplier-article-mappings/${mappingId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: nextActive }),
    });
    await loadMappings();
    setFeedback(nextActive ? 'Mapping réactivé.' : 'Mapping désactivé.', 'success');
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
  }
}

userNameEl.textContent = sessionUser.email || 'Utilisateur';

backHomeBtn.addEventListener('click', () => {
  window.location.href = './home.html';
});

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('grv2_token');
  localStorage.removeItem('grv2_user');
  localStorage.removeItem('grv2_active_department');
  localStorage.removeItem('gc_token');
  localStorage.removeItem('gc_user');
  localStorage.removeItem('gc_active_department');
  window.location.href = './login.html';
});

refreshBtn.addEventListener('click', loadMappings);
applyFiltersBtn.addEventListener('click', loadMappings);
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') loadMappings();
});
createMappingBtn.addEventListener('click', () => openMappingModal());
closeMappingModalBtn.addEventListener('click', closeMappingModal);
mappingSupplierF9Btn.addEventListener('click', () => openSupplierModal('form'));
mappingArticleF9Btn.addEventListener('click', openArticleModal);
mappingForm.addEventListener('submit', saveMapping);
supplierFilterF9Btn.addEventListener('click', () => openSupplierModal('filter'));
supplierFilterClearBtn.addEventListener('click', () => {
  selectedFilterSupplier = null;
  supplierFilterInput.value = '';
  loadMappings();
});

closeSupplierModalBtn.addEventListener('click', closeSupplierModal);
supplierSearchBtn.addEventListener('click', searchSuppliers);
supplierSearchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') searchSuppliers();
});

closeArticleModalBtn.addEventListener('click', closeArticleModal);
articleSearchBtn.addEventListener('click', searchArticles);
articleSearchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') searchArticles();
});

mappingsTbody.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const mapping = mappingsCache.find((row) => row.id === button.dataset.id);
  if (!mapping) return;
  if (button.dataset.action === 'edit') openMappingModal(mapping);
  if (button.dataset.action === 'toggle') toggleMapping(mapping.id, button.dataset.active === 'true');
});

supplierResultsTbody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-supplier-id]');
  if (!button) return;
  const row = button.closest('tr');
  chooseSupplier({
    id: button.dataset.supplierId,
    supplier_code: row.children[0].textContent === '-' ? '' : row.children[0].textContent,
    supplier_name: row.children[1].textContent === '-' ? '' : row.children[1].textContent,
  });
});

articleResultsTbody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-article-id]');
  if (!button) return;
  const row = button.closest('tr');
  chooseArticle({
    id: button.dataset.articleId,
    article_plu: row.children[0].textContent === '-' ? '' : row.children[0].textContent,
    article_designation: row.children[1].textContent === '-' ? '' : row.children[1].textContent,
    purchase_unit: row.children[2].textContent === '-' ? '' : row.children[2].textContent,
  });
});

loadMappings();
