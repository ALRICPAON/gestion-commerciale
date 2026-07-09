const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';
const sessionToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const sessionUserRaw = localStorage.getItem('gc_user') || localStorage.getItem('grv2_user');
const activeDepartment = JSON.parse(
  localStorage.getItem('gc_active_department') || localStorage.getItem('grv2_active_department') || 'null'
);

if (!sessionToken || !sessionUserRaw) {
  window.location.href = './login.html';
}

const sessionUser = JSON.parse(sessionUserRaw);

const userNameEl = document.getElementById('user-name');
const backHomeBtn = document.getElementById('back-home-btn');
const logoutBtn = document.getElementById('logout-btn');
const refreshDataBtn = document.getElementById('refresh-data-btn');
const printSheetBtn = document.getElementById('print-sheet-btn');
const printSheetBtnSecondary = document.getElementById('print-sheet-btn-secondary');
const pageFeedback = document.getElementById('page-feedback');
const sheetTitleInput = document.getElementById('sheet-title-input');
const sheetDateInput = document.getElementById('sheet-date-input');
const sheetNoteInput = document.getElementById('sheet-note-input');
const clientSearchInput = document.getElementById('client-search-input');
const selectAllClientsBtn = document.getElementById('select-all-clients-btn');
const clearClientsBtn = document.getElementById('clear-clients-btn');
const clientCountLabel = document.getElementById('client-count-label');
const clientsList = document.getElementById('clients-list');
const productColumnsEl = document.getElementById('product-columns');
const addProductColumnBtn = document.getElementById('add-product-column-btn');
const printTitle = document.getElementById('print-title');
const printNote = document.getElementById('print-note');
const printDate = document.getElementById('print-date');
const printTableWrap = document.getElementById('print-table-wrap');
const articleModal = document.getElementById('article-modal');
const closeArticleModalBtn = document.getElementById('close-article-modal-btn');
const articleSearchInput = document.getElementById('article-search-input');
const articleSearchBtn = document.getElementById('article-search-btn');
const articleResults = document.getElementById('article-results');

const DEFAULT_PRODUCT_COLUMNS = 10;
const MAX_PRODUCT_COLUMNS = 18;

let clients = [];
let selectedClientIds = new Set();
let productColumns = [];
let activeProductIndex = null;
let articleSearchResults = [];

function authHeaders() {
  return { Authorization: `Bearer ${sessionToken}` };
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
  if (!pageFeedback) return;
  pageFeedback.textContent = message;
  pageFeedback.className = 'page-feedback';
  if (!message) pageFeedback.classList.add('hidden');
  if (type) pageFeedback.classList.add(type);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateFr(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('fr-FR');
}

function compactNumber(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString('fr-FR', { maximumFractionDigits: digits });
}

function moneyInputValue(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return number.toFixed(2);
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur API');
  return data;
}

function clientLabel(client) {
  const code = client.code ? `${client.code} - ` : '';
  const city = client.city ? ` (${client.city})` : '';
  return `${code}${client.name || client.legal_name || 'Client'}${city}`;
}

function productLabel(product) {
  return product.display_name || product.designation || product.label || '';
}

function emptyProductColumn() {
  return {
    article_id: null,
    plu: '',
    designation: '',
    price: '',
    stock: '',
    unit: '',
  };
}

function ensureProductColumns() {
  if (productColumns.length > 0) return;
  productColumns = Array.from({ length: DEFAULT_PRODUCT_COLUMNS }, emptyProductColumn);
}

function selectedClients() {
  return clients.filter((client) => selectedClientIds.has(String(client.id)));
}

function visibleClients() {
  const search = String(clientSearchInput?.value || '').trim().toLowerCase();
  if (!search) return clients;
  return clients.filter((client) => clientLabel(client).toLowerCase().includes(search));
}

function usableProductColumns() {
  return productColumns.filter((column) => column.article_id || column.designation || column.price || column.stock);
}

function updatePreview() {
  const title = sheetTitleInput.value.trim() || "Fiche d'appel clients";
  const note = sheetNoteInput.value.trim();
  const date = sheetDateInput.value || todayIso();
  const rows = selectedClients();
  const columns = usableProductColumns();

  printTitle.textContent = title;
  printNote.textContent = note || 'Arrivage du jour';
  printDate.textContent = formatDateFr(date);

  if (!rows.length || !columns.length) {
    printTableWrap.innerHTML = `<div class="print-empty-state">Selectionner au moins un client et un produit pour generer la fiche.</div>`;
    return;
  }

  const colgroup = [
    '<col class="client-col" />',
    ...columns.map(() => '<col class="product-col" />'),
  ].join('');

  const head = columns.map((column) => {
    const name = productLabel(column) || 'Produit';
    const price = column.price ? `${escapeHtml(column.price)} EUR` : '&nbsp;';
    const stock = column.stock ? `${escapeHtml(column.stock)} ${escapeHtml(column.unit || '')}` : '&nbsp;';
    return `<th>
      <div class="product-head-name">${escapeHtml(name)}</div>
      <div class="product-head-meta">Prix: ${price}</div>
      <div class="product-head-meta">Stock: ${stock}</div>
    </th>`;
  }).join('');

  const body = rows.map((client) => `<tr>
    <th scope="row">
      <strong>${escapeHtml(client.name || client.legal_name || 'Client')}</strong>
      <span>${escapeHtml([client.code, client.city].filter(Boolean).join(' - '))}</span>
    </th>
    ${columns.map(() => '<td></td>').join('')}
  </tr>`).join('');

  printTableWrap.innerHTML = `<table class="quick-print-table">
    <colgroup>${colgroup}</colgroup>
    <thead><tr><th>Clients</th>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function renderClients() {
  const rows = visibleClients();
  const selectedCount = selectedClients().length;
  clientCountLabel.textContent = `${selectedCount}/${clients.length} client${clients.length > 1 ? 's' : ''} selectionne${selectedCount > 1 ? 's' : ''}`;

  if (!rows.length) {
    clientsList.innerHTML = '<div class="empty-list">Aucun client actif trouve.</div>';
    updatePreview();
    return;
  }

  clientsList.innerHTML = rows.map((client) => {
    const checked = selectedClientIds.has(String(client.id));
    return `<label class="client-check-row">
      <input type="checkbox" data-client-id="${escapeHtml(client.id)}" ${checked ? 'checked' : ''} />
      <span>
        <strong>${escapeHtml(client.name || client.legal_name || 'Client')}</strong>
        <small>${escapeHtml([client.code, client.city, client.phone || client.mobile].filter(Boolean).join(' - '))}</small>
      </span>
    </label>`;
  }).join('');

  updatePreview();
}

function renderProductColumns() {
  ensureProductColumns();
  productColumnsEl.innerHTML = productColumns.map((column, index) => {
    const label = productLabel(column) || 'Article non choisi';
    return `<article class="product-column-editor" data-product-index="${index}">
      <div class="product-editor-title">
        <span>Colonne ${index + 1}</span>
        <div>
          <button class="btn btn-secondary btn-sm" type="button" data-action="duplicate-product" title="Dupliquer cette colonne">Copier</button>
          <button class="btn btn-secondary btn-sm" type="button" data-action="remove-product" title="Retirer cette colonne">X</button>
        </div>
      </div>
      <button class="product-pick-btn" type="button" data-action="pick-product">
        <strong>${escapeHtml(label)}</strong>
        <small>${escapeHtml(column.plu || 'F9 / rechercher article')}</small>
      </button>
      <label>
        Prix de vente
        <input type="text" inputmode="decimal" value="${escapeHtml(column.price)}" data-field="price" placeholder="ex. 12.90" />
      </label>
      <label>
        Stock disponible
        <input type="text" inputmode="decimal" value="${escapeHtml(column.stock)}" data-field="stock" placeholder="ex. 18 kg" />
      </label>
    </article>`;
  }).join('');
  addProductColumnBtn.disabled = productColumns.length >= MAX_PRODUCT_COLUMNS;
  updatePreview();
}

async function loadClients() {
  const data = await apiGet('/api/clients?status=active');
  clients = Array.isArray(data) ? data : [];
  clients.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr'));
  selectedClientIds = new Set(clients.map((client) => String(client.id)));
  renderClients();
}

async function stockByArticleIds(articleIds, searchTerm = '') {
  if (!articleIds.length) return new Map();
  const query = new URLSearchParams({
    available_only: 'false',
    limit: '1000',
  });
  if (searchTerm.trim()) query.set('search', searchTerm.trim());
  const stockRows = await apiGet(`/api/stock?${query.toString()}`);
  const wanted = new Set(articleIds.map(String));
  return new Map((Array.isArray(stockRows) ? stockRows : [])
    .filter((row) => wanted.has(String(row.article_id)))
    .map((row) => [String(row.article_id), row]));
}

async function searchArticles(term) {
  const query = new URLSearchParams({
    search: term,
    active: 'true',
    limit: '50',
  });
  if (activeDepartment?.id) query.set('department_id', activeDepartment.id);
  const articleRows = await apiGet(`/api/articles?${query.toString()}`);
  const articles = Array.isArray(articleRows) ? articleRows : [];
  const stocks = await stockByArticleIds(articles.map((article) => article.id), term);
  return articles.map((article) => ({ ...article, stock_row: stocks.get(String(article.id)) || null }));
}

function renderArticleResults() {
  if (!articleSearchResults.length) {
    articleResults.innerHTML = '<div class="empty-list">Aucun article trouve.</div>';
    return;
  }

  articleResults.innerHTML = articleSearchResults.map((article, index) => {
    const stock = article.stock_row;
    const stockText = stock ? `${compactNumber(stock.stock_quantity)} ${stock.unit || article.stock_unit || article.unit || ''}` : '-';
    const price = article.sale_price_ex_vat ?? stock?.sale_price_level_1_ht ?? stock?.sale_price_level_2_ht ?? stock?.sale_price_level_3_ht;
    return `<button class="article-result-row" type="button" data-result-index="${index}">
      <span>
        <strong>${escapeHtml(article.display_name || article.designation)}</strong>
        <small>${escapeHtml([article.plu, article.family_name].filter(Boolean).join(' - '))}</small>
      </span>
      <span class="article-result-meta">Stock ${escapeHtml(stockText)}<br>Prix ${escapeHtml(moneyInputValue(price) || '-')}</span>
    </button>`;
  }).join('');
}

async function runArticleSearch() {
  const term = articleSearchInput.value.trim();
  if (term.length < 2) {
    articleResults.innerHTML = '<div class="empty-list">Saisir au moins 2 caracteres.</div>';
    return;
  }
  articleResults.innerHTML = '<div class="empty-list">Recherche...</div>';
  try {
    articleSearchResults = await searchArticles(term);
    renderArticleResults();
  } catch (error) {
    console.error('Erreur recherche article fiche appel :', error);
    articleResults.innerHTML = '<div class="empty-list">Erreur recherche article.</div>';
  }
}

function openArticleModal(index) {
  activeProductIndex = index;
  articleSearchResults = [];
  articleSearchInput.value = productColumns[index]?.designation || '';
  articleResults.innerHTML = '<div class="empty-list">Rechercher un article par PLU ou designation.</div>';
  articleModal.classList.remove('hidden');
  articleSearchInput.focus();
  if (articleSearchInput.value.trim().length >= 2) runArticleSearch();
}

function closeArticleModal() {
  articleModal.classList.add('hidden');
  activeProductIndex = null;
  articleSearchResults = [];
}

function applyArticleResult(index) {
  const article = articleSearchResults[index];
  if (!article || activeProductIndex === null) return;
  const stock = article.stock_row;
  const price = article.sale_price_ex_vat ?? stock?.sale_price_level_1_ht ?? stock?.sale_price_level_2_ht ?? stock?.sale_price_level_3_ht;
  productColumns[activeProductIndex] = {
    article_id: article.id,
    plu: article.plu || '',
    designation: article.display_name || article.designation || '',
    price: productColumns[activeProductIndex].price || moneyInputValue(price),
    stock: productColumns[activeProductIndex].stock || compactNumber(stock?.stock_quantity),
    unit: stock?.unit || article.stock_unit || article.sale_unit || article.unit || '',
  };
  closeArticleModal();
  renderProductColumns();
}

function duplicateProduct(index) {
  if (productColumns.length >= MAX_PRODUCT_COLUMNS) return;
  productColumns.splice(index + 1, 0, { ...productColumns[index] });
  renderProductColumns();
}

function removeProduct(index) {
  productColumns.splice(index, 1);
  ensureProductColumns();
  renderProductColumns();
}

async function refreshData() {
  showFeedback('Chargement clients...', '');
  try {
    await loadClients();
    showFeedback('Clients actifs charges.', 'success');
  } catch (error) {
    console.error('Erreur chargement fiche appel :', error);
    showFeedback(error.message || 'Erreur chargement', 'error');
  }
}

function printSheet() {
  updatePreview();
  window.print();
}

function initEvents() {
  backHomeBtn?.addEventListener('click', () => { window.location.href = './home.html'; });
  logoutBtn?.addEventListener('click', () => {
    localStorage.removeItem('gc_token');
    localStorage.removeItem('gc_user');
    localStorage.removeItem('gc_active_department');
    localStorage.removeItem('grv2_token');
    localStorage.removeItem('grv2_user');
    localStorage.removeItem('grv2_active_department');
    window.location.href = './login.html';
  });
  refreshDataBtn?.addEventListener('click', refreshData);
  printSheetBtn?.addEventListener('click', printSheet);
  printSheetBtnSecondary?.addEventListener('click', printSheet);
  [sheetTitleInput, sheetDateInput, sheetNoteInput].forEach((input) => input?.addEventListener('input', updatePreview));
  clientSearchInput?.addEventListener('input', renderClients);
  selectAllClientsBtn?.addEventListener('click', () => {
    selectedClientIds = new Set(clients.map((client) => String(client.id)));
    renderClients();
  });
  clearClientsBtn?.addEventListener('click', () => {
    selectedClientIds = new Set();
    renderClients();
  });
  clientsList?.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-client-id]');
    if (!checkbox) return;
    if (checkbox.checked) selectedClientIds.add(String(checkbox.dataset.clientId));
    else selectedClientIds.delete(String(checkbox.dataset.clientId));
    renderClients();
  });
  addProductColumnBtn?.addEventListener('click', () => {
    if (productColumns.length < MAX_PRODUCT_COLUMNS) productColumns.push(emptyProductColumn());
    renderProductColumns();
  });
  productColumnsEl?.addEventListener('click', (event) => {
    const editor = event.target.closest('[data-product-index]');
    if (!editor) return;
    const index = Number(editor.dataset.productIndex);
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'pick-product') openArticleModal(index);
    if (action === 'duplicate-product') duplicateProduct(index);
    if (action === 'remove-product') removeProduct(index);
  });
  productColumnsEl?.addEventListener('input', (event) => {
    const input = event.target.closest('[data-field]');
    const editor = event.target.closest('[data-product-index]');
    if (!input || !editor) return;
    const index = Number(editor.dataset.productIndex);
    productColumns[index][input.dataset.field] = input.value;
    updatePreview();
  });
  closeArticleModalBtn?.addEventListener('click', closeArticleModal);
  articleModal?.addEventListener('click', (event) => {
    if (event.target === articleModal) closeArticleModal();
  });
  articleSearchBtn?.addEventListener('click', runArticleSearch);
  articleSearchInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runArticleSearch();
    }
    if (event.key === 'Escape') closeArticleModal();
  });
  articleResults?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-result-index]');
    if (!row) return;
    applyArticleResult(Number(row.dataset.resultIndex));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'F9') {
      event.preventDefault();
      const firstEmpty = productColumns.findIndex((column) => !column.article_id);
      openArticleModal(firstEmpty >= 0 ? firstEmpty : 0);
    }
  });
}

function init() {
  if (userNameEl) userNameEl.textContent = sessionUser.email || 'Utilisateur';
  sheetDateInput.value = todayIso();
  sheetNoteInput.value = 'Arrivage du jour';
  ensureProductColumns();
  initEvents();
  renderProductColumns();
  refreshData();
}

init();
