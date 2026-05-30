const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const sessionToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const sessionUserRaw = localStorage.getItem('gc_user') || localStorage.getItem('grv2_user');
const activeDepartmentRaw =
  localStorage.getItem('gc_active_department') || localStorage.getItem('grv2_active_department');

if (!sessionToken || !sessionUserRaw) {
  window.location.href = './login.html';
}

const sessionUser = JSON.parse(sessionUserRaw);
let activeDepartment = activeDepartmentRaw ? JSON.parse(activeDepartmentRaw) : null;

const userNameEl = document.getElementById('user-name');
const backHomeBtn = document.getElementById('back-home-btn');
const logoutBtn = document.getElementById('logout-btn');
const articleDepartmentFilter = document.getElementById('article-department-filter');

const searchInput = document.getElementById('search-input');
const familyFilter = document.getElementById('family-filter');
const statusFilter = document.getElementById('status-filter');
const refreshBtn = document.getElementById('refresh-btn');
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

let articlesCache = [];
let familiesCache = [];

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
  const headers = {
    Authorization: `Bearer ${sessionToken}`,
  };

  if (json) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

function formatPrice(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return number.toFixed(2);
}

function formatVat(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `${number.toString().replace('.', ',')} %`;
}

function parseNumberInput(input) {
  if (!input || input.value === '') return null;
  const normalized = String(input.value).replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function fillTopbar() {
  userNameEl.textContent = sessionUser.email || 'Utilisateur';
}

function fillArticleDepartmentFilter() {
  const departments = sessionUser.departments || [];

  articleDepartmentFilter.innerHTML = '<option value="">Tous les services</option>';

  departments.forEach((department) => {
    const option = document.createElement('option');
    option.value = department.id;
    option.textContent = department.name;

    if (activeDepartment && String(department.id) === String(activeDepartment.id)) {
      option.selected = true;
    }

    articleDepartmentFilter.appendChild(option);
  });
}

function fillFamilySelects() {
  const activeDepartmentFamilies = activeDepartment
    ? familiesCache.filter((family) => family.department_id === activeDepartment.id)
    : familiesCache;

  const options = activeDepartmentFamilies
    .map((family) => `<option value="${family.code}">${family.name}</option>`)
    .join('');

  familyFilter.innerHTML = `<option value="">Toutes</option>${options}`;
  articleFamilyInput.innerHTML = `<option value="">-- Choisir --</option>${options}`;
}

async function loadFamilies() {
  const params = new URLSearchParams();

  if (activeDepartment?.id) {
    params.set('department_id', activeDepartment.id);
  }

  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE_URL}/api/articles/families${suffix}`, {
    headers: authHeaders(false),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Erreur chargement familles');
  }

  familiesCache = data;
  fillFamilySelects();
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
  articleFamilyInput.value = article?.family_code || article?.category || '';
  articleCategoryInput.value = article?.category || '';
  articleLatinNameInput.value = article?.latin_name || '';
  articleFaoZoneInput.value = article?.fao_zone || '';
  articleSousZoneInput.value = article?.sous_zone || '';
  articleEnginInput.value = article?.engin || '';
  articleAllergenesInput.value = article?.allergenes || '';
  articleDisplayNameInput.value = article?.display_name || '';
  articlePurchaseUnitInput.value = article?.purchase_unit || '';
  articleStockUnitInput.value = article?.stock_unit || '';
  articleSaleUnitInput.value = article?.sale_unit || '';
  articleVatRateInput.value = article?.vat_rate ?? '5.5';
  articlePurchasePriceExVatInput.value = article?.purchase_price_ex_vat ?? '';
  articleSalePriceExVatInput.value = article?.sale_price_ex_vat ?? '';
  articleSalePriceIncVatInput.value = article?.sale_price_inc_vat ?? '';
  articleActiveInput.value = String(article?.is_active ?? true);
}

function closeModal() {
  modal.classList.add('hidden');
  articleForm.reset();
  articleIdInput.value = '';
  articleUnitInput.value = 'kg';
  articleVatRateInput.value = '5.5';
  articleActiveInput.value = 'true';
}

function renderArticles(rows) {
  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10">Aucun article trouvé.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows.map((article) => `
    <tr>
      <td>${article.plu || ''}</td>
      <td>${article.designation || ''}</td>
      <td>${article.department_name || ''}</td>
      <td>${article.family_name || ''}</td>
      <td>${article.unit || ''}</td>
      <td>${formatVat(article.vat_rate)}</td>
      <td>${formatPrice(article.sale_price_ex_vat)}</td>
      <td>${formatPrice(article.sale_price_inc_vat)}</td>
      <td>${article.is_active ? 'Actif' : 'Inactif'}</td>
      <td>
        <div class="table-actions">
  <button class="btn btn-secondary btn-sm" data-action="view" data-id="${article.id}">
    Voir
  </button>

  ${
    canManageArticle(article)
      ? `
        <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${article.id}">Modifier</button>
        <button class="btn btn-secondary btn-sm" data-action="duplicate" data-id="${article.id}">Dupliquer</button>
        <button class="btn btn-secondary btn-sm" data-action="toggle" data-id="${article.id}">
          ${article.is_active ? 'Désactiver' : 'Activer'}
        </button>
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${article.id}">Supprimer</button>
      `
      : '<span style="font-size:12px;color:#999;">Lecture seule</span>'
  }
</div>
      </td>
    </tr>
  `).join('');
}

async function loadArticles() {
  try {
    setFeedback('Chargement des articles...', '');
    tbody.innerHTML = `
      <tr>
        <td colspan="10">Chargement des articles...</td>
      </tr>
    `;

    const params = new URLSearchParams();
  

    if (searchInput.value.trim()) {
      params.set('search', searchInput.value.trim());
    }

    if (familyFilter.value) {
      params.set('family', familyFilter.value);
    }

    if (statusFilter.value) {
      params.set('active', statusFilter.value);
    }

    const response = await fetch(`${API_BASE_URL}/api/articles?${params.toString()}`, {
      headers: authHeaders(false),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erreur chargement articles');
    }

    articlesCache = data;
    renderArticles(data);
    setFeedback(`${data.length} article(s) chargé(s).`, 'success');
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
    tbody.innerHTML = `
      <tr>
        <td colspan="10">Erreur de chargement.</td>
      </tr>
    `;
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
      {
        method: isEdit ? 'PATCH' : 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erreur enregistrement article');
    }

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
      body: JSON.stringify({
        is_active: !article.is_active,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erreur changement statut');
    }

    setFeedback(data.message || 'Statut mis à jour.', 'success');
    await loadArticles();
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
  }
}

async function deleteArticle(article) {
  const confirmed = window.confirm(`Supprimer l'article "${article.designation}" ?`);
  if (!confirmed) return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/articles/${article.id}`, {
      method: 'DELETE',
      headers: authHeaders(false),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erreur suppression');
    }

    setFeedback(data.message || 'Article supprimé', 'success');
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
      body: JSON.stringify({
        new_plu: newPlu.trim(),
        new_designation: newDesignation.trim(),
        new_ean: (newEan || '').trim(),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erreur duplication');
    }

    setFeedback(data.message || 'Article dupliqué', 'success');
    await loadArticles();
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
  }
}

function recalculatePriceFromExVat() {
  const exVat = parseNumberInput(articleSalePriceExVatInput);
  const vatRate = parseNumberInput(articleVatRateInput);

  if (exVat === null || vatRate === null) return;

  const incVat = exVat * (1 + vatRate / 100);
  articleSalePriceIncVatInput.value = incVat.toFixed(4);
}

function recalculatePriceFromIncVat() {
  const incVat = parseNumberInput(articleSalePriceIncVatInput);
  const vatRate = parseNumberInput(articleVatRateInput);

  if (incVat === null || vatRate === null) return;

  const exVat = incVat / (1 + vatRate / 100);
  articleSalePriceExVatInput.value = exVat.toFixed(4);
}

tbody.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const articleId = button.dataset.id;
  const article = articlesCache.find((item) => String(item.id) === String(articleId));

  if (!article) {
    setFeedback('Article introuvable dans la liste affichÃ©e.', 'error');
    return;
  }

  if (action === 'view') {
    if (!isValidId(article.id)) {
      setFeedback('Impossible d ouvrir la fiche : ID article invalide.', 'error');
      return;
    }

    const detailParams = new URLSearchParams();
    detailParams.set('id', article.id);

    if (isValidId(article.department_id)) {
      detailParams.set('department_id', article.department_id);
    }

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


backHomeBtn.addEventListener('click', () => {
  window.location.href = './home.html';
});

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

articleSalePriceExVatInput.addEventListener('change', recalculatePriceFromExVat);
articleSalePriceIncVatInput.addEventListener('change', recalculatePriceFromIncVat);
articleVatRateInput.addEventListener('change', () => {
  if (articleSalePriceExVatInput.value) {
    recalculatePriceFromExVat();
  } else if (articleSalePriceIncVatInput.value) {
    recalculatePriceFromIncVat();
  }
});

async function init() {
  try {
    fillTopbar();
    await loadFamilies();
await loadArticles();
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
  }
}

init();
