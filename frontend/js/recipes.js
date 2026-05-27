const API_BASE = `${window.APP_CONFIG.API_BASE_URL}/api`;

const token = localStorage.getItem('grv2_token');
const activeDepartment = JSON.parse(localStorage.getItem('grv2_active_department') || 'null');

const recipeIdInput = document.getElementById('recipeId');
const recipeNameInput = document.getElementById('recipeName');
const outputPluInput = document.getElementById('outputPlu');
const outputDesignationInput = document.getElementById('outputDesignation');
const outputQuantityInput = document.getElementById('outputQuantity');
const outputUnitInput = document.getElementById('outputUnit');
const dlcDaysInput = document.getElementById('dlcDays');
const procedureInput = document.getElementById('procedure');

const ingredientsList = document.getElementById('ingredientsList');
const recipesList = document.getElementById('recipesList');

const btnAddIngredient = document.getElementById('btnAddIngredient');
const btnSaveRecipe = document.getElementById('btnSaveRecipe');
const btnResetRecipe = document.getElementById('btnResetRecipe');

if (!token) {
  window.location.href = './login.html';
}

if (!activeDepartment?.id) {
  alert('Aucun rayon actif trouvé.');
  window.location.href = './home.html';
}

outputPluInput.addEventListener('keydown', (event) => {
  if (event.key === 'F9') {
    event.preventDefault();
    openArticleSearchModal(outputPluInput, outputDesignationInput, outputPluInput);
  }
});

outputPluInput.addEventListener('blur', () => {
  if (isArticleSearchOpen) return;
  fillArticleFromPlu(outputPluInput, outputDesignationInput, outputPluInput);
});

const outputPluSearchButton = document.createElement('button');
outputPluSearchButton.type = 'button';
outputPluSearchButton.textContent = '🔍';
outputPluSearchButton.style.marginLeft = '8px';
outputPluSearchButton.className = 'btn btn-secondary';
outputPluSearchButton.addEventListener('pointerdown', () => {
  isArticleSearchOpen = true;
});
outputPluSearchButton.addEventListener('click', () => {
  openArticleSearchModal(outputPluInput, outputDesignationInput, outputPluInput);
});
outputPluInput.insertAdjacentElement('afterend', outputPluSearchButton);

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || 'Erreur API');
  }

  return data;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function searchArticleByPlu(plu) {
  if (!plu) return null;

  const rows = await apiFetch(
    `/articles/search?department_id=${activeDepartment.id}&q=${encodeURIComponent(plu)}`
  );

  return rows.find((a) => String(a.plu) === String(plu)) || rows[0] || null;
}

async function fillArticleFromPlu(pluInput, designationInput, hiddenArticleIdInput) {
  const plu = pluInput.value.trim();

  if (!plu) {
    designationInput.value = '';
    hiddenArticleIdInput.value = '';
    return;
  }

  const article = await searchArticleByPlu(plu);

  if (!article) {
    designationInput.value = '';
    hiddenArticleIdInput.value = '';
    alert('Article introuvable');
    return;
  }

  pluInput.value = article.plu;
  designationInput.value = article.display_name || article.designation;
  hiddenArticleIdInput.value = article.id;
}

let articleSearchModal = null;
let articleSearchTarget = null;
let isArticleSearchOpen = false;

function ensureArticleSearchModal() {
  if (articleSearchModal) return articleSearchModal;

  const modal = document.createElement('div');
  modal.id = 'article-search-modal';
  modal.style.cssText =
    'position:fixed;top:0;left:0;right:0;bottom:0;display:none;align-items:center;justify-content:center;z-index:10000;background:rgba(0,0,0,0.45);';

  modal.innerHTML = `
    <div style="background:#fff;padding:18px;border-radius:10px;max-width:520px;width:100%;box-shadow:0 16px 40px rgba(0,0,0,0.25);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <strong>Recherche article</strong>
        <button type="button" id="articleSearchClose" style="border:none;background:transparent;font-size:22px;cursor:pointer;">×</button>
      </div>
      <input id="articleSearchQuery" class="input" placeholder="Recherche PLU ou désignation" style="width:100%;margin-bottom:12px;" />
      <div id="articleSearchResults" style="max-height:320px;overflow:auto;border:1px solid #eee;border-radius:6px;padding:8px;"></div>
    </div>
  `;

  document.body.appendChild(modal);

  const queryInput = modal.querySelector('#articleSearchQuery');
  const resultsContainer = modal.querySelector('#articleSearchResults');
  const closeBtn = modal.querySelector('#articleSearchClose');

  closeBtn.addEventListener('click', hideArticleSearchModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      hideArticleSearchModal();
    }
  });

  queryInput.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      await runArticleSearch();
    }
  });

  articleSearchModal = {
    modal,
    queryInput,
    resultsContainer,
  };

  return articleSearchModal;
}

function hideArticleSearchModal() {
  if (!articleSearchModal) return;
  isArticleSearchOpen = false;
  articleSearchModal.modal.style.display = 'none';
  articleSearchModal.resultsContainer.innerHTML = '';
}

async function runArticleSearch() {
  if (!articleSearchModal) return;

  const query = articleSearchModal.queryInput.value.trim();

  if (!query) {
    articleSearchModal.resultsContainer.innerHTML = '<p style="margin:0;color:#666;">Entrez un PLU ou un terme de recherche.</p>';
    return;
  }

  articleSearchModal.resultsContainer.innerHTML = '<p style="margin:0;color:#666;">Recherche...</p>';

  try {
    const articles = await apiFetch(
      `/articles/search?department_id=${activeDepartment.id}&q=${encodeURIComponent(query)}`
    );

    if (!Array.isArray(articles) || !articles.length) {
      articleSearchModal.resultsContainer.innerHTML = '<p style="margin:0;color:#666;">Aucun article trouvé.</p>';
      return;
    }

    articleSearchModal.resultsContainer.innerHTML = articles
      .map(
        (article) => `
          <button type="button" class="article-search-result" data-article-id="${article.id}" data-plu="${article.plu}" data-designation="${escapeHtml(
            article.display_name || article.designation || ''
          )}" style="width:100%;text-align:left;padding:10px;border:none;background:#f9f9f9;border-radius:6px;margin-bottom:8px;cursor:pointer;">
            <strong>${escapeHtml(String(article.plu || ''))}</strong>
            — ${escapeHtml(article.display_name || article.designation || '')}
          </button>
        `
      )
      .join('');

    articleSearchModal.resultsContainer.querySelectorAll('.article-search-result').forEach((button) => {
      button.addEventListener('click', () => {
        const articleId = button.dataset.articleId;
        const plu = button.dataset.plu;
        const designation = button.dataset.designation;

        if (articleSearchTarget) {
          articleSearchTarget.pluInput.value = plu;
          articleSearchTarget.designationInput.value = designation;

          if (articleSearchTarget.articleIdTarget) {
            if (articleSearchTarget.articleIdTarget.classList.contains('ingredient-article-id')) {
              articleSearchTarget.articleIdTarget.value = articleId;
            } else {
              articleSearchTarget.articleIdTarget.dataset.articleId = articleId;
            }
          }
        }

        hideArticleSearchModal();
        articleSearchTarget?.pluInput.focus();
      });
    });
  } catch (err) {
    articleSearchModal.resultsContainer.innerHTML = '<p style="margin:0;color:#cc0000;">Erreur recherche article.</p>';
  }
}

function openArticleSearchModal(pluInput, designationInput, articleIdTarget) {
  const modal = ensureArticleSearchModal();
  isArticleSearchOpen = true;
  articleSearchTarget = { pluInput, designationInput, articleIdTarget };
  modal.queryInput.value = pluInput.value.trim();
  modal.modal.style.display = 'flex';
  modal.queryInput.focus();

  runArticleSearch();
}

function addIngredientRow(data = {}) {
  const row = document.createElement('div');
  row.className = 'ingredient-row';

  row.innerHTML = `
    <input type="hidden" class="ingredient-article-id" value="${data.article_id || ''}" />

    <input class="input ingredient-plu" placeholder="PLU ingrédient" value="${data.plu || ''}" />

    <input class="input ingredient-designation" placeholder="Désignation" readonly value="${data.article_name || data.designation || ''}" />

    <input class="input ingredient-quantity" type="number" step="0.001" placeholder="Quantité" value="${data.quantity || ''}" />

    <select class="input ingredient-unit">
      <option value="kg">kg</option>
      <option value="piece">pièce</option>
      <option value="colis">colis</option>
    </select>

    <button class="btn btn-danger ingredient-remove" type="button">✖</button>
  `;

  const articleIdInput = row.querySelector('.ingredient-article-id');
  const pluInput = row.querySelector('.ingredient-plu');
  const designationInput = row.querySelector('.ingredient-designation');
  const unitInput = row.querySelector('.ingredient-unit');

  unitInput.value = data.unit || 'kg';

  pluInput.addEventListener('blur', () => {
    if (isArticleSearchOpen) return;
    fillArticleFromPlu(pluInput, designationInput, articleIdInput);
  });

  pluInput.addEventListener('keydown', (event) => {
    if (event.key === 'F9') {
      event.preventDefault();
      openArticleSearchModal(pluInput, designationInput, articleIdInput);
    }
  });

  const ingredientSearchButton = document.createElement('button');
  ingredientSearchButton.type = 'button';
  ingredientSearchButton.textContent = '🔍';
  ingredientSearchButton.style.marginLeft = '8px';
  ingredientSearchButton.className = 'btn btn-secondary';
  ingredientSearchButton.addEventListener('pointerdown', () => {
    isArticleSearchOpen = true;
  });
  ingredientSearchButton.addEventListener('click', () => {
    openArticleSearchModal(pluInput, designationInput, articleIdInput);
  });

  pluInput.insertAdjacentElement('afterend', ingredientSearchButton);

  row.querySelector('.ingredient-remove').addEventListener('click', () => {
    row.remove();
  });

  ingredientsList.appendChild(row);
}

function collectIngredients() {
  return [...document.querySelectorAll('.ingredient-row')]
    .map((row) => ({
      article_id: row.querySelector('.ingredient-article-id').value,
      quantity: Number(row.querySelector('.ingredient-quantity').value || 0),
      unit: row.querySelector('.ingredient-unit').value || 'kg',
    }))
    .filter((ing) => ing.article_id && ing.quantity > 0);
}

function resetForm() {
  recipeIdInput.value = '';
  recipeNameInput.value = '';
  outputPluInput.value = '';
  outputPluInput.dataset.articleId = '';
  outputDesignationInput.value = '';
  outputQuantityInput.value = 1;
  outputUnitInput.value = 'kg';
  dlcDaysInput.value = 0;
  procedureInput.value = '';
  ingredientsList.innerHTML = '';
  addIngredientRow();
}

async function loadRecipes() {
  recipesList.innerHTML = 'Chargement...';

  const recipes = await apiFetch(`/recipes?department_id=${activeDepartment.id}`);

  if (!recipes.length) {
    recipesList.innerHTML = '<p>Aucune recette.</p>';
    return;
  }

  recipesList.innerHTML = '';

  recipes.forEach((recipe) => {
    const div = document.createElement('div');
    div.className = 'recette-card';

    div.innerHTML = `
      <h3>${recipe.name}</h3>
      <p><b>Produit fini :</b> ${recipe.plu || ''} — ${recipe.article_name || ''}</p>
      <p><b>Quantité standard :</b> ${Number(recipe.output_quantity || 1)} ${recipe.output_unit}</p>
      <p><b>DLC :</b> ${recipe.dlc_days || 0} jour(s)</p>

      <div class="actions">
        <button class="btn btn-primary btn-manufacture" type="button">Fabriquer</button>
        <button class="btn btn-muted btn-edit" type="button">Modifier</button>
        <button class="btn btn-danger btn-delete" type="button">Supprimer</button>
      </div>
    `;

    div.querySelector('.btn-manufacture').addEventListener('click', () => createFabricationFromRecipe(recipe));
    div.querySelector('.btn-edit').addEventListener('click', () => editRecipe(recipe.id));
    div.querySelector('.btn-delete').addEventListener('click', () => deleteRecipe(recipe.id));

    recipesList.appendChild(div);
  });
}

async function editRecipe(id) {
  const recipe = await apiFetch(`/recipes/${id}`);

  recipeIdInput.value = recipe.id;
  recipeNameInput.value = recipe.name;
  outputQuantityInput.value = recipe.output_quantity || 1;
  outputUnitInput.value = recipe.output_unit || 'kg';
  dlcDaysInput.value = recipe.dlc_days || 0;
  procedureInput.value = recipe.procedure || '';

  const outputArticle = await apiFetch(`/articles/${recipe.output_article_id}`);
  outputPluInput.value = outputArticle.article.plu || '';
  outputDesignationInput.value = outputArticle.article.display_name || outputArticle.article.designation || '';
  outputPluInput.dataset.articleId = recipe.output_article_id;

  ingredientsList.innerHTML = '';

  (recipe.ingredients || []).forEach((ing) => {
    addIngredientRow({
      article_id: ing.article_id,
      plu: ing.plu,
      article_name: ing.designation || ing.article_name,
      quantity: ing.quantity,
      unit: ing.unit,
    });
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function saveRecipe() {
  const name = recipeNameInput.value.trim();
  const outputArticleId = outputPluInput.dataset.articleId;

  if (!name) return alert('Nom recette obligatoire');
  if (!outputArticleId) return alert('Produit fini obligatoire');

  const ingredients = collectIngredients();

  if (!ingredients.length) {
    return alert('Ajoute au moins un ingrédient');
  }

  const payload = {
    department_id: activeDepartment.id,
    name,
    output_article_id: outputArticleId,
    output_quantity: Number(outputQuantityInput.value || 1),
    output_unit: outputUnitInput.value || 'kg',
    dlc_days: Number(dlcDaysInput.value || 0),
    procedure: procedureInput.value.trim(),
    ingredients,
  };

  if (recipeIdInput.value) {
    await apiFetch(`/recipes/${recipeIdInput.value}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  } else {
    await apiFetch('/recipes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  resetForm();
  await loadRecipes();
}

async function deleteRecipe(id) {
  if (!confirm('Supprimer cette recette ?')) return;

  await apiFetch(`/recipes/${id}`, {
    method: 'DELETE',
  });

  await loadRecipes();
}

async function createFabricationFromRecipe(recipe) {
  try {
    const payload = {
      department_id: activeDepartment.id,
      recipe_id: recipe.id,
      planned_quantity: Number(recipe.output_quantity || 1),
      notes: '',
    };

    const result = await apiFetch('/fabrications', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!result?.fabrication_id) {
      throw new Error('Impossible de créer la fabrication');
    }

    window.location.href = `./fabrication-detail.html?id=${encodeURIComponent(result.fabrication_id)}`;
  } catch (error) {
    alert(error.message || 'Erreur création fabrication');
  }
}

outputPluInput.addEventListener('blur', async () => {
  const hidden = { value: outputPluInput.dataset.articleId || '' };

  await fillArticleFromPlu(outputPluInput, outputDesignationInput, hidden);

  outputPluInput.dataset.articleId = hidden.value;
});

btnAddIngredient.addEventListener('click', () => addIngredientRow());
btnSaveRecipe.addEventListener('click', saveRecipe);
btnResetRecipe.addEventListener('click', resetForm);

resetForm();
loadRecipes();