const API_BASE = `${window.APP_CONFIG.API_BASE_URL}/api`;

const token = localStorage.getItem('grv2_token');
const activeDepartment = JSON.parse(localStorage.getItem('grv2_active_department') || 'null');

const recipeSelect = document.getElementById('recipeSelect');
const plannedQuantityInput = document.getElementById('plannedQuantity');
const fabricationNotesInput = document.getElementById('fabricationNotes');
const btnCreateFabrication = document.getElementById('btnCreateFabrication');
const fabricationsList = document.getElementById('fabricationsList');

if (!token) {
  window.location.href = './login.html';
}

if (!activeDepartment?.id) {
  alert('Aucun rayon actif trouvé.');
  window.location.href = './home.html';
}

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

function formatStatus(status) {
  const map = {
    draft: 'Brouillon',
    in_progress: 'En cours',
    validated: 'Validée',
    cancelled: 'Annulée',
  };

  return map[status] || status;
}

async function loadRecipes() {
  const recipes = await apiFetch(`/recipes?department_id=${activeDepartment.id}`);

  recipeSelect.innerHTML = '';

  if (!recipes.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Aucune recette disponible';
    recipeSelect.appendChild(option);
    recipeSelect.disabled = true;
    return;
  }

  recipes.forEach((recipe) => {
    const option = document.createElement('option');
    option.value = recipe.id;
    option.textContent = `${recipe.name} — ${recipe.plu || ''} ${recipe.article_name || ''}`;
    option.dataset.quantity = recipe.output_quantity || 1;
    recipeSelect.appendChild(option);
  });

  const firstOption = recipeSelect.options[0];
  if (firstOption?.dataset.quantity) {
    plannedQuantityInput.value = firstOption.dataset.quantity;
  }
}

async function loadFabrications() {
  fabricationsList.innerHTML = 'Chargement...';

  const fabrications = await apiFetch(`/fabrications?department_id=${activeDepartment.id}`);

  if (!fabrications.length) {
    fabricationsList.innerHTML = '<p>Aucune fabrication.</p>';
    return;
  }

  fabricationsList.innerHTML = '';

  fabrications.forEach((fab) => {
    const card = document.createElement('div');
    card.className = 'module-card';

    card.innerHTML = `
      <h3>${fab.name}</h3>
      <p><b>Statut :</b> ${formatStatus(fab.status)}</p>
      <p><b>Recette :</b> ${fab.recipe_name || '-'}</p>
      <p><b>Produit fini :</b> ${fab.output_article_plu || ''} — ${fab.output_article_name || ''}</p>
      <p><b>Quantité prévue :</b> ${Number(fab.planned_quantity || 0)} ${fab.output_unit || ''}</p>
      <p><b>Date :</b> ${fab.fabrication_date ? String(fab.fabrication_date).slice(0, 10) : '-'}</p>

      <div class="actions">
        <button class="btn btn-primary btn-open" type="button">Ouvrir</button>
        ${
          fab.status === 'draft'
            ? '<button class="btn btn-danger btn-delete" type="button">Supprimer</button>'
            : ''
        }
      </div>
    `;

    card.querySelector('.btn-open').addEventListener('click', () => {
      window.location.href = `./fabrication-detail.html?id=${fab.id}`;
    });

    const deleteBtn = card.querySelector('.btn-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => deleteFabrication(fab.id));
    }

    fabricationsList.appendChild(card);
  });
}

async function createFabrication() {
  const recipeId = recipeSelect.value;
  const plannedQuantity = Number(plannedQuantityInput.value || 0);

  if (!recipeId) {
    alert('Choisis une recette.');
    return;
  }

  if (plannedQuantity <= 0) {
    alert('Quantité à produire invalide.');
    return;
  }

  const result = await apiFetch('/fabrications', {
    method: 'POST',
    body: JSON.stringify({
      department_id: activeDepartment.id,
      recipe_id: recipeId,
      planned_quantity: plannedQuantity,
      notes: fabricationNotesInput.value.trim(),
    }),
  });

  window.location.href = `./fabrication-detail.html?id=${result.fabrication_id}`;
}

async function deleteFabrication(id) {
  if (!confirm('Supprimer cette fabrication brouillon ?')) return;

  await apiFetch(`/fabrications/${id}`, {
    method: 'DELETE',
  });

  await loadFabrications();
}

recipeSelect.addEventListener('change', () => {
  const option = recipeSelect.options[recipeSelect.selectedIndex];
  if (option?.dataset.quantity) {
    plannedQuantityInput.value = option.dataset.quantity;
  }
});

btnCreateFabrication.addEventListener('click', createFabrication);

await loadRecipes();
await loadFabrications();