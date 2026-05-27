const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const sessionToken = localStorage.getItem('grv2_token');
const sessionUserRaw = localStorage.getItem('grv2_user');
const activeDepartmentRaw = localStorage.getItem('grv2_active_department');

if (!sessionToken || !sessionUserRaw || !activeDepartmentRaw) {
  window.location.href = './login.html';
}

const sessionUser = JSON.parse(sessionUserRaw);
let activeDepartment = JSON.parse(activeDepartmentRaw);

const userNameEl = document.getElementById('user-name');
const departmentSelectEl = document.getElementById('department-select');
const backHomeBtn = document.getElementById('back-home-btn');
const logoutBtn = document.getElementById('logout-btn');
const articleDepartmentFilter = document.getElementById('article-department-filter');

const searchInput = document.getElementById('search-input');
const sectorFilter = document.getElementById('sector-filter');
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
const articleSectorInput = document.getElementById('article-sector');
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
const articleActiveInput = document.getElementById('article-active');

let articlesCache = [];

function canManageArticle(article) {
  return article.department_id === activeDepartment.id;
}

function setFeedback(message = '', type = '') {
  feedbackEl.textContent = message;
  feedbackEl.className = 'feedback-box';
  if (type) {
    feedbackEl.classList.add(type);
  }
}

function authHeaders(json = true) {
  const headers = {
    Authorization: `Bearer ${sessionToken}`,
  };
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function fillTopbar() {
  userNameEl.textContent = sessionUser.email || 'Utilisateur';

  const departments = sessionUser.departments || [];
  departmentSelectEl.innerHTML = '';

  departments.forEach((department) => {
    const option = document.createElement('option');
    option.value = department.id;
    option.textContent = department.name;
    if (department.id === activeDepartment.id) {
      option.selected = true;
    }
    departmentSelectEl.appendChild(option);
  });
}

function applyTheme() {
  const code = (activeDepartment.code || '').toLowerCase();
  document.body.classList.remove(
    'theme-pois',
    'theme-bouch',
    'theme-fdl',
    'theme-boul',
    'theme-char',
    'theme-trait',
    'theme-from'
  );

  const map = {
    pois: 'theme-pois',
    bouch: 'theme-bouch',
    fdl: 'theme-fdl',
    boul: 'theme-boul',
    char: 'theme-char',
    trait: 'theme-trait',
    from: 'theme-from',
  };

  if (map[code]) {
    document.body.classList.add(map[code]);
  }
}

function openModal(editMode = false, article = null) {
  modal.classList.remove('hidden');
  modalTitle.textContent = editMode ? 'Modifier un article' : 'Créer un article';

  articleIdInput.value = article?.id || '';
  articlePluInput.value = article?.plu || '';
  articleDesignationInput.value = article?.designation || '';
  articleUnitInput.value = article?.unit || '';
  articleEanInput.value = article?.ean || '';
  articleSectorInput.value = article?.sector_code || '';
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
  articleActiveInput.value = String(article?.is_active ?? true);
}

function closeModal() {
  modal.classList.add('hidden');
  articleForm.reset();
  articleIdInput.value = '';
  articleActiveInput.value = 'true';
}

function renderArticles(rows) {
  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">Aucun article trouvé.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows.map((article) => `
    <tr>
      <td>${article.plu || ''}</td>
<td>${article.designation || ''}</td>
<td>${article.department_name || ''}</td> <!-- AJOUT -->
<td>${article.sector_code || ''}</td>
<td>${article.unit || ''}</td>
<td>${article.category || ''}</td>
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
        : `
          <span style="font-size:12px;color:#999;">Lecture seule</span>
        `
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
        <td colspan="7">Chargement des articles...</td>
      </tr>
    `;

    const params = new URLSearchParams();
    const selectedDepartmentId = articleDepartmentFilter.value;

if (selectedDepartmentId) {
  params.set('department_id', selectedDepartmentId);
}

    if (searchInput.value.trim()) {
      params.set('search', searchInput.value.trim());
    }

    if (sectorFilter.value) {
      params.set('sector', sectorFilter.value);
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
        <td colspan="7">Erreur de chargement.</td>
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
      department_id: activeDepartment.id,
      plu: articlePluInput.value.trim(),
      designation: articleDesignationInput.value.trim(),
      unit: articleUnitInput.value.trim(),
      ean: articleEanInput.value.trim(),
      sector_code: articleSectorInput.value,
      category: articleCategoryInput.value.trim(),
      latin_name: articleLatinNameInput.value.trim(),
      fao_zone: articleFaoZoneInput.value.trim(),
      sous_zone: articleSousZoneInput.value.trim(),
      engin: articleEnginInput.value.trim(),
      allergenes: articleAllergenesInput.value.trim(),
      display_name: articleDisplayNameInput.value.trim(),
      purchase_unit: articlePurchaseUnitInput.value.trim(),
      stock_unit: articleStockUnitInput.value.trim(),
      sale_unit: articleSaleUnitInput.value.trim(),
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

function fillArticleDepartmentFilter() {
  const departments = sessionUser.departments || [];

  articleDepartmentFilter.innerHTML = '<option value="">Tous les rayons</option>';

  departments.forEach((department) => {
    const option = document.createElement('option');
    option.value = department.id;
    option.textContent = department.name;

    if (department.id === activeDepartment.id) {
      option.selected = true;
    }

    articleDepartmentFilter.appendChild(option);
  });
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

    setFeedback('Statut mis à jour.', 'success');
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

tbody.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const articleId = button.dataset.id;
  const article = articlesCache.find((item) => item.id === articleId);

  if (!article) return;

  if (action === 'view') {
  window.location.href =
    `./article-detail.html?id=${article.id}&department_id=${article.department_id}`;
  return;
}

  if (!canManageArticle(article)) {
  setFeedback("Article d'un autre rayon : lecture seule", 'error');
  return;
}

  if (action === 'edit') {
    openModal(true, article);
  }

  if (action === 'toggle') {
    await toggleArticle(article);
  }

  if (action === 'delete') {
    await deleteArticle(article);
  }

  if (action === 'duplicate') {
    await duplicateArticle(article);
  }
});

departmentSelectEl.addEventListener('change', (event) => {
  const selectedId = event.target.value;
  const department = (sessionUser.departments || []).find((item) => item.id === selectedId);
  if (!department) return;

  activeDepartment = department;
  localStorage.setItem('grv2_active_department', JSON.stringify(department));
  applyTheme();
  loadArticles();
});

backHomeBtn.addEventListener('click', () => {
  window.location.href = './home.html';
});

logoutBtn.addEventListener('click', () => {
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

sectorFilter.addEventListener('change', loadArticles);
statusFilter.addEventListener('change', loadArticles);
articleDepartmentFilter.addEventListener('change', loadArticles);

fillTopbar();
fillArticleDepartmentFilter(); // ← AJOUT
applyTheme();
loadArticles();