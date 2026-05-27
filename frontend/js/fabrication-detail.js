const API_BASE = `${window.APP_CONFIG.API_BASE_URL}/api`;

const token = localStorage.getItem('grv2_token');
const activeDepartment = JSON.parse(localStorage.getItem('grv2_active_department') || 'null');

const params = new URLSearchParams(window.location.search);
const fabricationId = params.get('id');

const fabricationSubtitle = document.getElementById('fabricationSubtitle');
const fabricationNameTitle = document.getElementById('fabricationNameTitle');

const fabricationNameInput = document.getElementById('fabricationName');
const fabricationStatusInput = document.getElementById('fabricationStatus');
const plannedQuantityInput = document.getElementById('plannedQuantity');
const producedQuantityInput = document.getElementById('producedQuantity');
const outputUnitInput = document.getElementById('outputUnit');
const dlcDateInput = document.getElementById('dlcDate');
const fabricationNotesInput = document.getElementById('fabricationNotes');

const outputArticleBox = document.getElementById('outputArticleBox');
const fabricationLines = document.getElementById('fabricationLines');

const btnSaveFabrication = document.getElementById('btnSaveFabrication');
const btnDeleteFabrication = document.getElementById('btnDeleteFabrication');
const btnValidateFabrication = document.getElementById('btnValidateFabrication');
const btnPrintFabrication = document.getElementById('btnPrintFabrication');

let currentFabrication = null;

if (!token) {
  window.location.href = './login.html';
}

if (!activeDepartment?.id) {
  alert('Aucun rayon actif trouvé.');
  window.location.href = './home.html';
}

if (!fabricationId) {
  alert('Fabrication introuvable.');
  window.location.href = './fabrications.html';
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

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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

function lockIfNeeded(fabrication) {
  const locked = ['validated', 'cancelled'].includes(fabrication.status);

  fabricationNameInput.disabled = locked;
  fabricationStatusInput.disabled = locked;
  plannedQuantityInput.disabled = locked;
  producedQuantityInput.disabled = locked;
  dlcDateInput.disabled = locked;
  fabricationNotesInput.disabled = locked;

  btnSaveFabrication.style.display = locked ? 'none' : 'inline-block';
  btnDeleteFabrication.style.display =
    fabrication.status === 'cancelled' ? 'none' : 'inline-block';
  btnDeleteFabrication.textContent =
    fabrication.status === 'validated'
      ? 'Annuler fabrication validée'
      : 'Supprimer';
  btnValidateFabrication.style.display =
    ['draft', 'in_progress'].includes(fabrication.status) ? 'inline-block' : 'none';
}

function renderFabrication(fabrication) {
  currentFabrication = fabrication;

  fabricationSubtitle.textContent = `${formatStatus(fabrication.status)} — ${fabrication.fabrication_date?.slice(0, 10) || ''}`;
  fabricationNameTitle.textContent = fabrication.name || 'Fabrication';

  fabricationNameInput.value = fabrication.name || '';
  fabricationStatusInput.value = fabrication.status || 'draft';
  plannedQuantityInput.value = fabrication.planned_quantity || 0;
  producedQuantityInput.value = fabrication.produced_quantity || fabrication.planned_quantity || 0;
  outputUnitInput.value = fabrication.output_unit || '';
  dlcDateInput.value = fabrication.dlc_date ? String(fabrication.dlc_date).slice(0, 10) : '';
  fabricationNotesInput.value = fabrication.notes || '';

  outputArticleBox.innerHTML = `
    <b>${fabrication.output_article_plu || ''}</b>
    —
    ${fabrication.output_article_name || 'Produit fini non défini'}
    <br>
    <span>Recette : ${fabrication.recipe_name || '-'}</span>
  `;

  renderLines(fabrication.lines || []);
  lockIfNeeded(fabrication);
}

function renderLines(lines) {
  if (!lines.length) {
    fabricationLines.innerHTML = '<p>Aucun ingrédient.</p>';
    return;
  }

  const editable = currentFabrication && !['validated', 'cancelled'].includes(currentFabrication.status);

  fabricationLines.innerHTML = '';

  lines.forEach((line) => {
    const div = document.createElement('div');
    div.className = 'module-card';

    div.innerHTML = `
      <h3>${line.plu || ''} — ${line.article_name || 'Article inconnu'}</h3>
      <p><b>Quantité prévue :</b> ${Number(line.planned_quantity || 0)} ${line.unit || ''}</p>
      <p><b>Quantité utilisée :</b> ${
        editable
          ? `<input type="number" class="line-used-quantity" data-line-id="${line.id}" value="${Number(
              line.used_quantity ?? line.planned_quantity ?? 0
            )}" step="0.001" style="width:140px;margin-left:8px;" /> ${escapeHtml(line.unit || '')}`
          : `${line.used_quantity != null ? Number(line.used_quantity) : '-'} ${escapeHtml(line.unit || '')}`
      }</p>
      <p><b>Statut ligne :</b> ${line.line_status || '-'}</p>
    `;

    fabricationLines.appendChild(div);
  });

  if (editable) {
    const saveButton = document.createElement('button');
    saveButton.id = 'btnSaveIngredientQuantities';
    saveButton.type = 'button';
    saveButton.className = 'btn btn-primary';
    saveButton.textContent = 'Enregistrer quantités ingrédients';
    saveButton.addEventListener('click', saveIngredientQuantities);
    fabricationLines.appendChild(saveButton);
  }
}

async function saveIngredientQuantities() {
  const inputs = [...document.querySelectorAll('.line-used-quantity')];
  const originalLines = currentFabrication?.lines || [];

  const updates = inputs
    .map((input) => ({
      id: input.dataset.lineId,
      used_quantity: Number(input.value || 0),
    }))
    .filter((item) => item.id);

  if (!updates.length) {
    return alert('Aucune ligne à mettre à jour.');
  }

  const modified = updates.filter((item) => {
    const originalLine = originalLines.find((line) => String(line.id) === String(item.id));
    const originalQuantity = Number(originalLine?.used_quantity ?? originalLine?.planned_quantity ?? 0);
    return Number(item.used_quantity) !== originalQuantity;
  });

  if (!modified.length) {
    return alert('Aucune modification détectée.');
  }

  for (const item of modified) {
    if (item.used_quantity <= 0) {
      return alert('La quantité utilisée doit être supérieure à 0.');
    }
  }

  try {
    for (const item of modified) {
      await apiFetch(`/fabrications/lines/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ used_quantity: item.used_quantity }),
      });
    }

    alert('Quantités ingrédients enregistrées.');
    await loadFabrication();
  } catch (err) {
    alert(err.message || 'Erreur enregistrement quantités ingrédients.');
  }
}

async function loadFabrication() {
  const fabrication = await apiFetch(`/fabrications/${fabricationId}`);
  renderFabrication(fabrication);
}

async function saveFabrication() {
  const payload = {
    name: fabricationNameInput.value.trim(),
    status: fabricationStatusInput.value,
    planned_quantity: Number(plannedQuantityInput.value || 0),
    produced_quantity: Number(producedQuantityInput.value || 0),
    dlc_date: dlcDateInput.value || null,
    notes: fabricationNotesInput.value.trim(),
  };

  if (!payload.name) {
    alert('Nom obligatoire.');
    return;
  }

  if (payload.planned_quantity <= 0) {
    alert('Quantité prévue invalide.');
    return;
  }

  if (payload.produced_quantity <= 0) {
    alert('Quantité produite invalide.');
    return;
  }

  await apiFetch(`/fabrications/${fabricationId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  await loadFabrication();
}

async function deleteFabrication() {
  if (currentFabrication?.status === 'validated') {
    if (!confirm('Cette action va remettre les ingrédients en stock et supprimer le lot fabriqué si non consommé. Continuer ?')) return;

    try {
      const result = await apiFetch(`/fabrications/${fabricationId}/cancel-validated`, {
        method: 'POST',
        body: JSON.stringify({}),
      });

      alert(result.message || 'Fabrication annulée avec succès.');
      await loadFabrication();
    } catch (error) {
      alert(error.message || 'Erreur annulation fabrication.');
    }

    return;
  }

  if (!confirm('Supprimer cette fabrication brouillon ?')) return;

  await apiFetch(`/fabrications/${fabricationId}`, {
    method: 'DELETE',
  });

  window.location.href = './fabrications.html';
}

async function validateFabrication() {
  if (!confirm('Valider cette fabrication et mettre à jour le stock ?')) return;

  const originalText = btnValidateFabrication?.textContent;

  try {
    if (btnValidateFabrication) {
      btnValidateFabrication.disabled = true;
      btnValidateFabrication.textContent = 'Validation...';
    }

    await saveFabrication();

    const result = await apiFetch(`/fabrications/${fabricationId}/validate`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    alert(result.message || 'Fabrication validée avec succès.');

    await loadFabrication();
  } catch (error) {
    if (btnValidateFabrication) {
      btnValidateFabrication.disabled = false;
      btnValidateFabrication.textContent = originalText || 'Valider';
    }
    alert(error.message || 'Erreur validation fabrication.');
  }
}

function printFabricationSheet() {
  if (!currentFabrication) {
    alert('Fabrication non chargée.');
    return;
  }

  const lines = currentFabrication.lines || [];

  const linesHtml = lines.map((line) => `
    <tr>
      <td>${line.plu || ''}</td>
      <td>${line.article_name || ''}</td>
      <td>${Number(line.planned_quantity || 0)}</td>
      <td>${line.unit || ''}</td>
      <td></td>
      <td></td>
    </tr>
  `).join('');

  const printWindow = window.open('', '_blank');

  printWindow.document.write(`
    <!doctype html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8" />
      <title>Fiche fabrication</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          color: #000;
          padding: 24px;
        }

        h1 {
          margin-bottom: 4px;
        }

        .meta {
          margin-bottom: 20px;
          font-size: 14px;
        }

        .box {
          border: 1px solid #ccc;
          padding: 12px;
          margin-bottom: 16px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 12px;
        }

        th,
        td {
          border: 1px solid #999;
          padding: 8px;
          text-align: left;
        }

        th {
          background: #eee;
        }

        .signature {
          margin-top: 40px;
          display: flex;
          justify-content: space-between;
        }
      </style>
    </head>

    <body>
      <h1>Fiche de fabrication</h1>

      <div class="meta">
        Date : ${String(currentFabrication.fabrication_date || '').slice(0, 10)}<br>
        Statut : ${formatStatus(currentFabrication.status)}<br>
        Recette : ${currentFabrication.recipe_name || '-'}
      </div>

      <div class="box">
        <h2>${currentFabrication.name || 'Fabrication'}</h2>
        <p>
          <b>Produit fini :</b>
          ${currentFabrication.output_article_plu || ''}
          —
          ${currentFabrication.output_article_name || ''}
        </p>
        <p>
          <b>Quantité prévue :</b>
          ${Number(currentFabrication.planned_quantity || 0)}
          ${currentFabrication.output_unit || ''}
        </p>
        <p>
          <b>Quantité produite :</b>
          ${Number(currentFabrication.produced_quantity || currentFabrication.planned_quantity || 0)}
          ${currentFabrication.output_unit || ''}
        </p>
        <p>
          <b>DLC :</b>
          ${currentFabrication.dlc_date ? String(currentFabrication.dlc_date).slice(0, 10) : '-'}
        </p>
      </div>

      <div class="box">
        <h2>Ingrédients</h2>
        <table>
          <thead>
            <tr>
              <th>PLU</th>
              <th>Article</th>
              <th>Qté prévue</th>
              <th>Unité</th>
              <th>Qté réelle</th>
              <th>Contrôle</th>
            </tr>
          </thead>
          <tbody>
            ${linesHtml}
          </tbody>
        </table>
      </div>

      <div class="box">
  <h2>Procédure recette</h2>
  <p>${currentFabrication.recipe_procedure || 'Aucune procédure renseignée.'}</p>
</div>

<div class="box">
  <h2>Notes fabrication</h2>
  <p>${currentFabrication.notes || ''}</p>
</div>

      <div class="signature">
        <div>Préparé par : __________________</div>
        <div>Contrôlé par : __________________</div>
      </div>
    </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

btnSaveFabrication.addEventListener('click', saveFabrication);
btnDeleteFabrication.addEventListener('click', deleteFabrication);
btnValidateFabrication.addEventListener('click', validateFabrication);

btnPrintFabrication.addEventListener('click', printFabricationSheet);

await loadFabrication();
