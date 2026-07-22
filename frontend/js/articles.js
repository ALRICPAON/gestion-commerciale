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

const searchInput = document.getElementById('search-input');
const familyFilter = document.getElementById('family-filter');
const statusFilter = document.getElementById('status-filter');
const articleTypeFilter = document.getElementById('article-type-filter');
const packagingOnlyFilter = document.getElementById('packaging-only-filter');
const refreshBtn = document.getElementById('refresh-btn');
const exportArticlesBtn = document.getElementById('export-articles-btn');
const importArticlesBtn = document.getElementById('import-articles-btn');
const importArticlesFile = document.getElementById('import-articles-file');
const createArticleBtn = document.getElementById('create-article-btn');
const feedbackEl = document.getElementById('articles-feedback');
const tbody = document.getElementById('articles-tbody');

const modal = document.getElementById('article-modal');
const modalTitle = document.getElementById('modal-title');
const closeModalBtn = document.getElementById('close-modal-btn');
const articleForm = document.getElementById('article-form');

const articleIdInput = document.getElementById('article-id');
const articlePluInput = document.getElementById('article-plu');
const articleDesignationInput = document.getElementById('article-designation');
const articleUnitInput = document.getElementById('article-unit');
const articleEanInput = document.getElementById('article-ean');
const articleTypeInput = document.getElementById('article-type');
const articleFamilyInput = document.getElementById('article-family');
const articleCategoryInput = document.getElementById('article-category');
const articleLatinNameInput = document.getElementById('article-latin-name');
const articleFaoZoneInput = document.getElementById('article-fao-zone');
const articleSousZoneInput = document.getElementById('article-sous-zone');
const articleEnginInput = document.getElementById('article-engin');
const articleAllergenesInput = document.getElementById('article-allergenes');
const articleDisplayNameInput = document.getElementById('article-display-name');
const articlePurchaseUnitInput = document.getElementById('article-purchase-unit');
const articleStockUnitInput = document.getElementById('article-stock-unit');
const articleSaleUnitInput = document.getElementById('article-sale-unit');
const articleVatRateInput = document.getElementById('article-vat-rate');
const articlePurchasePriceExVatInput = document.getElementById('article-purchase-price-ex-vat');
const articleSalePriceExVatInput = document.getElementById('article-sale-price-ex-vat');
const articleSalePriceIncVatInput = document.getElementById('article-sale-price-inc-vat');
const articleActiveInput = document.getElementById('article-active');
const articleAlertThresholdInput = document.getElementById('article-alert-threshold');
const articleFormatLabelInput = document.getElementById('article-format-label');
const articleDepositUnitValueInput = document.getElementById('article-deposit-unit-value');
const articlePrimarySupplierInput = document.getElementById('article-primary-supplier');
const articlePrimarySupplierReturnableInput = document.getElementById('article-primary-supplier-returnable');
const articleReturnableUnitHintInput = document.getElementById('article-returnable-unit-hint');
const packagingConsumableSection = document.getElementById('packaging-consumable-section');
const packagingReturnableSection = document.getElementById('packaging-returnable-section');

let articlesCache = [];
let familiesCache = [];
let suppliersCache = [];

const ARTICLE_TYPE_LABELS = {
  PRODUCT: 'Produit',
  PACKAGING_CONSUMABLE: 'Emballage consommable',
  PACKAGING_RETURNABLE: 'Emballage consigne',
  OTHER: 'Autre',
};

const ARTICLE_TYPE_DEFAULTS = {
  PRODUCT: {
    stock_managed: true,
    sellable: true,
    visible_in_price_list: true,
    contributes_to_product_cost: true,
  },
  PACKAGING_CONSUMABLE: {
    stock_managed: true,
    sellable: false,
    visible_in_price_list: false,
    contributes_to_product_cost: true,
  },
  PACKAGING_RETURNABLE: {
    stock_managed: true,
    sellable: false,
    visible_in_price_list: false,
    contributes_to_product_cost: false,
  },
  OTHER: {
    stock_managed: true,
    sellable: false,
    visible_in_price_list: false,
    contributes_to_product_cost: false,
  },
};

function isValidId(value) {
  const id = String(value ?? '').trim();
  return !!id && id !== 'null' && id !== 'undefined';
}

function setFeedback(message = '', type = '') {
  feedbackEl.textContent = message;
  feedbackEl.className = 'feedback-box';
  if (type) feedbackEl.classList.add(type);
}

function authHeaders(json = true) {
  const headers = { Authorization: `Bearer ${sessionToken}` };
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function formatPrice(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : '';
}

function formatVat(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toString().replace('.', ',')} %` : '';
}

function articleTypeLabel(value) {
  return ARTICLE_TYPE_LABELS[value] || ARTICLE_TYPE_LABELS.PRODUCT;
}

function updateArticleTypeUi(applyDefaults = false) {
  const type = articleTypeInput.value || 'PRODUCT';
  const isConsumable = type === 'PACKAGING_CONSUMABLE';
  const isReturnable = type === 'PACKAGING_RETURNABLE';
  packagingConsumableSection.classList.toggle('hidden', !isConsumable);
  packagingReturnableSection.classList.toggle('hidden', !isReturnable);
  articleReturnableUnitHintInput.value = articleStockUnitInput.value || articleUnitInput.value || 'unite';
  const defaults = ARTICLE_TYPE_DEFAULTS[type] || ARTICLE_TYPE_DEFAULTS.PRODUCT;
  articleTypeInput.dataset.stockManaged = String(defaults.stock_managed);
  articleTypeInput.dataset.sellable = String(defaults.sellable);
  articleTypeInput.dataset.visibleInPriceList = String(defaults.visible_in_price_list);
  articleTypeInput.dataset.contributesToProductCost = String(defaults.contributes_to_product_cost);

  if (!applyDefaults) return;
  if (isConsumable || isReturnable || type === 'OTHER') {
    articleSalePriceExVatInput.value = '';
    articleSalePriceIncVatInput.value = '';
    articleSaleUnitInput.value = '';
  }
  if ((isConsumable || isReturnable) && !articleStockUnitInput.value) {
    articleStockUnitInput.value = articleUnitInput.value || 'unite';
  }
}

function parseNumberInput(input) {
  if (!input || input.value === '') return null;
  const number = Number(String(input.value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function fillTopbar() {
  userNameEl.textContent = sessionUser.email || 'Utilisateur';
}

function fillFamilySelects() {
  const options = familiesCache
    .map((family) => `<option value="${family.code}">${family.name}</option>`)
    .join('');
  familyFilter.innerHTML = `<option value="">Toutes</option>${options}`;
  articleFamilyInput.innerHTML = `<option value="">-- Choisir --</option>${options}`;
}

function fillSupplierSelects() {
  const options = suppliersCache
    .map((supplier) => `<option value="${supplier.id}">${supplier.code ? `${supplier.code} - ` : ''}${supplier.name || supplier.legal_name || supplier.id}</option>`)
    .join('');
  const html = `<option value="">-- Aucun --</option>${options}`;
  articlePrimarySupplierInput.innerHTML = html;
  articlePrimarySupplierReturnableInput.innerHTML = html;
}

async function loadFamilies() {
  const response = await fetch(`${API_BASE_URL}/api/articles/families`, { headers: authHeaders(false) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Erreur chargement familles');
  familiesCache = data;
  fillFamilySelects();
}

async function loadSuppliers() {
  const response = await fetch(`${API_BASE_URL}/api/suppliers?status=active`, { headers: authHeaders(false) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Erreur chargement fournisseurs');
  suppliersCache = Array.isArray(data) ? data : [];
  fillSupplierSelects();
}

function canManageArticle(article) {
  return true;
}

function openModal(editMode = false, article = null) {
  modal.classList.remove('hidden');
  modalTitle.textContent = editMode ? 'Modifier un article' : 'Créer un article';

  articleIdInput.value = article?.id || '';
  articlePluInput.value = article?.plu || '';
  articleDesignationInput.value = article?.designation || '';
  articleUnitInput.value = article?.unit || 'kg';
  articleEanInput.value = article?.ean || '';
  articleTypeInput.value = article?.article_type || new URLSearchParams(window.location.search).get('article_type') || 'PRODUCT';
  articleFamilyInput.value = article?.family_code || article?.category || '';
  articleCategoryInput.value = article?.category || '';
  articleLatinNameInput.value = article?.latin_name || '';
  articleFaoZoneInput.value = article?.fao_zone || '';
  articleSousZoneInput.value = article?.sous_zone || '';
  articleEnginInput.value = article?.engin || article?.fishing_gear || '';
  articleAllergenesInput.value = article?.allergenes || article?.allergens || '';
  articleDisplayNameInput.value = article?.display_name || '';
  articlePurchaseUnitInput.value = article?.purchase_unit || '';
  articleStockUnitInput.value = article?.stock_unit || '';
  articleSaleUnitInput.value = article?.sale_unit || '';
  articleVatRateInput.value = article?.vat_rate ?? '5.5';
  articlePurchasePriceExVatInput.value = article?.purchase_price_ex_vat ?? '';
  articleSalePriceExVatInput.value = article?.sale_price_ex_vat ?? '';
  articleSalePriceIncVatInput.value = article?.sale_price_inc_vat ?? '';
  articleActiveInput.value = String(article?.is_active ?? true);
  articleAlertThresholdInput.value = article?.alert_threshold ?? '';
  articleFormatLabelInput.value = article?.format_label ?? '';
  articleDepositUnitValueInput.value = article?.deposit_unit_value ?? '';
  articlePrimarySupplierInput.value = article?.primary_supplier_id || '';
  articlePrimarySupplierReturnableInput.value = article?.primary_supplier_id || '';
  updateArticleTypeUi(!editMode);
}

function closeModal() {
  modal.classList.add('hidden');
  articleForm.reset();
  articleIdInput.value = '';
  articleUnitInput.value = 'kg';
  articleTypeInput.value = 'PRODUCT';
  articleVatRateInput.value = '5.5';
  articleActiveInput.value = 'true';
  articleAlertThresholdInput.value = '';
  articleFormatLabelInput.value = '';
  articleDepositUnitValueInput.value = '';
  articlePrimarySupplierInput.value = '';
  articlePrimarySupplierReturnableInput.value = '';
  updateArticleTypeUi(false);
}

function renderArticles(rows) {
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="11">Aucun article trouvé.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((article) => `
    <tr>
      <td>${article.plu || ''}</td>
      <td>${article.designation || ''}</td>
      <td><span class="article-type-pill ${article.article_type || 'PRODUCT'}">${articleTypeLabel(article.article_type || 'PRODUCT')}</span></td>
      <td>${article.department_name || ''}</td>
      <td>${article.family_name || ''}</td>
      <td>${article.unit || ''}</td>
      <td>${formatVat(article.vat_rate)}</td>
      <td>${formatPrice(article.sale_price_ex_vat)}</td>
      <td>${formatPrice(article.sale_price_inc_vat)}</td>
      <td>${article.is_active ? 'Actif' : 'Inactif'}</td>
      <td>
        <div class="table-actions">
          <button class="btn btn-secondary btn-sm" data-action="view" data-id="${article.id}">Voir</button>
          ${canManageArticle(article) ? `
            <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${article.id}">Modifier</button>
            <button class="btn btn-secondary btn-sm" data-action="duplicate" data-id="${article.id}">Dupliquer</button>
            <button class="btn btn-secondary btn-sm" data-action="toggle" data-id="${article.id}">${article.is_active ? 'Désactiver' : 'Activer'}</button>
            <button class="btn btn-danger btn-sm" data-action="delete" data-id="${article.id}">Désactiver</button>
          ` : '<span style="font-size:12px;color:#999;">Lecture seule</span>'}
        </div>
      </td>
    </tr>
  `).join('');
}

async function loadArticles() {
  try {
    setFeedback('Chargement des articles...', '');
    tbody.innerHTML = '<tr><td colspan="11">Chargement des articles...</td></tr>';

    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set('search', searchInput.value.trim());
    if (familyFilter.value) params.set('family', familyFilter.value);
    if (statusFilter.value) params.set('active', statusFilter.value);
    if (articleTypeFilter.value) params.set('article_type', articleTypeFilter.value);
    if (packagingOnlyFilter.checked) params.set('packaging_only', 'true');

    const suffix = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(`${API_BASE_URL}/api/articles${suffix}`, { headers: authHeaders(false) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Erreur chargement articles');

    articlesCache = data;
    renderArticles(data);
    setFeedback(`${data.length} article(s) chargé(s).`, 'success');
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
    tbody.innerHTML = '<tr><td colspan="11">Erreur de chargement.</td></tr>';
  }
}

async function saveArticle(event) {
  event.preventDefault();
  try {
    const articleId = articleIdInput.value;
    const isEdit = !!articleId;
    const payload = {
      plu: articlePluInput.value.trim(),
      designation: articleDesignationInput.value.trim(),
      unit: articleUnitInput.value,
      ean: articleEanInput.value.trim(),
      article_type: articleTypeInput.value || 'PRODUCT',
      stock_managed: articleTypeInput.dataset.stockManaged === 'true',
      sellable: articleTypeInput.dataset.sellable === 'true',
      visible_in_price_list: articleTypeInput.dataset.visibleInPriceList === 'true',
      contributes_to_product_cost: articleTypeInput.dataset.contributesToProductCost === 'true',
      alert_threshold: parseNumberInput(articleAlertThresholdInput) ?? 0,
      format_label: articleFormatLabelInput.value.trim(),
      deposit_unit_value: parseNumberInput(articleDepositUnitValueInput) ?? 0,
      primary_supplier_id: articleTypeInput.value === 'PACKAGING_RETURNABLE'
        ? articlePrimarySupplierReturnableInput.value
        : articlePrimarySupplierInput.value,
      family_code: articleFamilyInput.value,
      category: articleCategoryInput.value,
      latin_name: articleLatinNameInput.value.trim(),
      fao_zone: articleFaoZoneInput.value.trim(),
      sous_zone: articleSousZoneInput.value.trim(),
      engin: articleEnginInput.value.trim(),
      allergenes: articleAllergenesInput.value.trim(),
      display_name: articleDisplayNameInput.value.trim(),
      purchase_unit: articlePurchaseUnitInput.value,
      stock_unit: articleStockUnitInput.value,
      sale_unit: articleSaleUnitInput.value,
      vat_rate: parseNumberInput(articleVatRateInput),
      purchase_price_ex_vat: parseNumberInput(articlePurchasePriceExVatInput),
      sale_price_ex_vat: parseNumberInput(articleSalePriceExVatInput),
      sale_price_inc_vat: parseNumberInput(articleSalePriceIncVatInput),
      is_active: articleActiveInput.value === 'true',
    };

    const response = await fetch(
      isEdit ? `${API_BASE_URL}/api/articles/${articleId}` : `${API_BASE_URL}/api/articles`,
      { method: isEdit ? 'PATCH' : 'POST', headers: authHeaders(true), body: JSON.stringify(payload) }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Erreur enregistrement article');

    closeModal();
    setFeedback(data.message || 'Article enregistré', 'success');
    await loadArticles();
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
  }
}

async function toggleArticle(article) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/articles/${article.id}/status`, {
      method: 'PATCH',
      headers: authHeaders(true),
      body: JSON.stringify({ is_active: !article.is_active }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Erreur changement statut');
    setFeedback(data.message || 'Statut mis à jour.', 'success');
    await loadArticles();
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
  }
}

async function deleteArticle(article) {
  const confirmed = window.confirm(`Désactiver l'article "${article.designation}" ?`);
  if (!confirmed) return;
  try {
    const response = await fetch(`${API_BASE_URL}/api/articles/${article.id}`, {
      method: 'DELETE',
      headers: authHeaders(false),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Erreur désactivation');
    setFeedback(data.message || 'Article désactivé', 'success');
    await loadArticles();
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
  }
}

async function duplicateArticle(article) {
  const newPlu = window.prompt('Nouveau PLU :');
  if (!newPlu) return;
  const newDesignation = window.prompt('Nouvelle désignation :', `${article.designation} COPIE`);
  if (!newDesignation) return;
  const newEan = window.prompt('Nouvel EAN (optionnel) :', article.ean || '');

  try {
    const response = await fetch(`${API_BASE_URL}/api/articles/${article.id}/duplicate`, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ new_plu: newPlu.trim(), new_designation: newDesignation.trim(), new_ean: (newEan || '').trim() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Erreur duplication');
    setFeedback(data.message || 'Article dupliqué', 'success');
    await loadArticles();
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
  }
}

async function exportArticlesExcel() {
  try {
    setFeedback('Préparation de l export Excel...', '');
    const response = await fetch(`${API_BASE_URL}/api/articles/export.xlsx`, { headers: authHeaders(false) });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Erreur export Excel');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `articles-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setFeedback('Export Excel généré.', 'success');
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
  }
}

async function importArticlesExcel(file) {
  if (!file) return;
  try {
    setFeedback('Import Excel en cours...', '');
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE_URL}/api/articles/import.xlsx`, {
      method: 'POST',
      headers: authHeaders(false),
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = data.summary?.errors?.slice(0, 5).map((err) => `Ligne ${err.line}: ${err.error}`).join(' | ');
      throw new Error(details || data.error || 'Erreur import Excel');
    }
    const s = data.summary || {};
    setFeedback(`Import terminé : ${s.created || 0} créé(s), ${s.updated || 0} modifié(s), ${s.disabled || 0} désactivé(s), ${s.ignored || 0} ignoré(s).`, 'success');
    await loadArticles();
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
  } finally {
    importArticlesFile.value = '';
  }
}

function recalculatePriceFromExVat() {
  const exVat = parseNumberInput(articleSalePriceExVatInput);
  const vatRate = parseNumberInput(articleVatRateInput);
  if (exVat === null || vatRate === null) return;
  articleSalePriceIncVatInput.value = (exVat * (1 + vatRate / 100)).toFixed(4);
}

function recalculatePriceFromIncVat() {
  const incVat = parseNumberInput(articleSalePriceIncVatInput);
  const vatRate = parseNumberInput(articleVatRateInput);
  if (incVat === null || vatRate === null) return;
  articleSalePriceExVatInput.value = (incVat / (1 + vatRate / 100)).toFixed(4);
}

tbody.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const articleId = button.dataset.id;
  const article = articlesCache.find((item) => String(item.id) === String(articleId));
  if (!article) {
    setFeedback('Article introuvable dans la liste affichée.', 'error');
    return;
  }

  if (action === 'view') {
    if (!isValidId(article.id)) {
      setFeedback('Impossible d ouvrir la fiche : ID article invalide.', 'error');
      return;
    }
    const detailParams = new URLSearchParams();
    detailParams.set('id', article.id);
    window.location.href = `./article-detail.html?${detailParams.toString()}`;
    return;
  }

  if (!canManageArticle(article)) {
    setFeedback("Article d'un autre service : lecture seule", 'error');
    return;
  }

  if (action === 'edit') openModal(true, article);
  if (action === 'toggle') await toggleArticle(article);
  if (action === 'delete') await deleteArticle(article);
  if (action === 'duplicate') await duplicateArticle(article);
});

backHomeBtn.addEventListener('click', () => { window.location.href = './home.html'; });
logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('gc_token');
  localStorage.removeItem('gc_user');
  localStorage.removeItem('gc_active_department');
  localStorage.removeItem('grv2_token');
  localStorage.removeItem('grv2_user');
  localStorage.removeItem('grv2_active_department');
  window.location.href = './login.html';
});

refreshBtn.addEventListener('click', loadArticles);
exportArticlesBtn?.addEventListener('click', exportArticlesExcel);
importArticlesBtn?.addEventListener('click', () => importArticlesFile?.click());
importArticlesFile?.addEventListener('change', () => importArticlesExcel(importArticlesFile.files?.[0]));
createArticleBtn.addEventListener('click', () => openModal(false));
closeModalBtn.addEventListener('click', closeModal);
articleForm.addEventListener('submit', saveArticle);

searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    loadArticles();
  }
});

familyFilter.addEventListener('change', loadArticles);
statusFilter.addEventListener('change', loadArticles);
articleTypeFilter.addEventListener('change', () => {
  if (articleTypeFilter.value) packagingOnlyFilter.checked = false;
  loadArticles();
});
packagingOnlyFilter.addEventListener('change', () => {
  if (packagingOnlyFilter.checked) articleTypeFilter.value = '';
  loadArticles();
});
articleTypeInput.addEventListener('change', () => updateArticleTypeUi(true));
articleUnitInput.addEventListener('change', () => updateArticleTypeUi(false));
articleStockUnitInput.addEventListener('change', () => updateArticleTypeUi(false));
articlePrimarySupplierInput.addEventListener('change', () => {
  articlePrimarySupplierReturnableInput.value = articlePrimarySupplierInput.value;
});
articlePrimarySupplierReturnableInput.addEventListener('change', () => {
  articlePrimarySupplierInput.value = articlePrimarySupplierReturnableInput.value;
});
articleSalePriceExVatInput.addEventListener('change', recalculatePriceFromExVat);
articleSalePriceIncVatInput.addEventListener('change', recalculatePriceFromIncVat);
articleVatRateInput.addEventListener('change', () => {
  if (articleSalePriceExVatInput.value) recalculatePriceFromExVat();
  else if (articleSalePriceIncVatInput.value) recalculatePriceFromIncVat();
});

async function init() {
  try {
    fillTopbar();
    await loadFamilies();
    await loadSuppliers();
    const params = new URLSearchParams(window.location.search);
    if (params.get('article_type')) {
      openModal(false, { article_type: params.get('article_type') });
    }
    await loadArticles();
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
  }
}

init();
