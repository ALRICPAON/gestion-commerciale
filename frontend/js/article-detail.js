const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const sessionToken = localStorage.getItem('grv2_token');
const sessionUserRaw = localStorage.getItem('grv2_user');
const activeDepartmentRaw = localStorage.getItem('grv2_active_department');

if (!sessionToken || !sessionUserRaw || !activeDepartmentRaw) {
  window.location.href = './login.html';
}

const sessionUser = JSON.parse(sessionUserRaw);
let activeDepartment = JSON.parse(activeDepartmentRaw);

const params = new URLSearchParams(window.location.search);
const articleId = params.get('id');
const queryDepartmentId = params.get('department_id');

if (!articleId) {
  window.location.href = './articles.html';
}

const userNameEl = document.getElementById('user-name');
const departmentSelectEl = document.getElementById('department-select');
const backBtn = document.getElementById('back-btn');
const editBtn = document.getElementById('edit-btn');
const articleTitleEl = document.getElementById('article-title');

const identityEl = document.getElementById('identity');
const commercialEl = document.getElementById('commercial');
const metaEl = document.getElementById('meta');
const unitsEl = document.getElementById('units');
const technicalEl = document.getElementById('technical');

let currentArticle = null;

function authHeaders(json = true) {
  const headers = {
    Authorization: `Bearer ${sessionToken}`,
  };

  if (json) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

function valueOrDash(value) {
  if (value === null || value === undefined || value === '') return '-';
  return value;
}

function formatPrice(value) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return `${number.toFixed(2)} €`;
}

function formatVat(value) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return `${number.toString().replace('.', ',')} %`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('fr-FR');
}

function yesNo(value) {
  return value ? 'Oui' : 'Non';
}

function field(label, value) {
  return `
    <div class="info-item">
      <span class="info-label">${label}</span>
      <strong class="info-value">${valueOrDash(value)}</strong>
    </div>
  `;
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

function renderArticle(article) {
  currentArticle = article;

  articleTitleEl.textContent = `${article.plu || ''} - ${article.designation || 'Article'}`;

  identityEl.innerHTML = [
    field('PLU', article.plu),
    field('Désignation', article.designation),
    field('Nom affiché', article.display_name),
    field('EAN', article.ean),
    field('Service', article.department_name),
    field('Famille', article.family_name),
    field('Actif', yesNo(article.is_active)),
  ].join('');

  commercialEl.innerHTML = [
    field('TVA', formatVat(article.vat_rate)),
    field('PA HT', formatPrice(article.purchase_price_ex_vat)),
    field('PV HT', formatPrice(article.sale_price_ex_vat)),
    field('PV TTC', formatPrice(article.sale_price_inc_vat)),
  ].join('');

  metaEl.innerHTML = [
    field('Origine produit', article.category),
    field('Nom latin', article.latin_name),
    field('Zone FAO', article.fao_zone),
    field('Sous-zone', article.sous_zone),
    field('Engin / méthode', article.engin),
    field('Allergènes', article.allergenes),
  ].join('');

  unitsEl.innerHTML = [
    field('Unité principale', article.unit),
    field('Unité achat', article.purchase_unit),
    field('Unité stock', article.stock_unit),
    field('Unité vente', article.sale_unit),
  ].join('');

  technicalEl.innerHTML = [
    field('ID article', article.id),
    field('ID rattachement service', article.article_department_id),
    field('Origine source', article.source_origin),
    field('Source ID', article.source_id),
    field('Créé le', formatDate(article.created_at)),
    field('Modifié le', formatDate(article.updated_at)),
  ].join('');
}

async function loadArticle() {
  try {
    const departmentId = queryDepartmentId || activeDepartment.id;
    const url = `${API_BASE_URL}/api/articles/${articleId}?department_id=${encodeURIComponent(departmentId)}`;

    const response = await fetch(url, {
      headers: authHeaders(false),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erreur chargement article');
    }

    renderArticle(data);
  } catch (error) {
    console.error(error);
    articleTitleEl.textContent = error.message;
  }
}

departmentSelectEl.addEventListener('change', async (event) => {
  const selectedId = event.target.value;
  const department = (sessionUser.departments || []).find((item) => item.id === selectedId);

  if (!department) return;

  activeDepartment = department;
  localStorage.setItem('grv2_active_department', JSON.stringify(department));

  window.location.href = `./article-detail.html?id=${articleId}&department_id=${department.id}`;
});

backBtn.addEventListener('click', () => {
  window.location.href = './articles.html';
});

editBtn.addEventListener('click', () => {
  window.location.href = `./articles.html?edit=${articleId}`;
});

fillTopbar();
loadArticle();