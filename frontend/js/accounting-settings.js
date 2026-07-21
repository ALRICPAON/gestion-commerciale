const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';
const sessionToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const sessionUserRaw = localStorage.getItem('gc_user') || localStorage.getItem('grv2_user');

if (!sessionToken || !sessionUserRaw) {
  window.location.href = './login.html';
}

const sessionUser = JSON.parse(sessionUserRaw);
const userNameEl = document.getElementById('user-name');
const backHomeBtn = document.getElementById('back-home-btn');
const logoutBtn = document.getElementById('logout-btn');
const loadMappingsBtn = document.getElementById('load-mappings-btn');
const feedbackEl = document.getElementById('page-feedback');
const mappingsTableEl = document.getElementById('mappings-table');

function authHeaders() {
  return { Authorization: `Bearer ${sessionToken}` };
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showFeedback(message, type = 'success') {
  feedbackEl.textContent = message || '';
  feedbackEl.className = `page-feedback ${message ? '' : 'hidden'} ${type === 'error' ? 'error' : 'success'}`;
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur parametres comptables');
  return data;
}

function renderMappings(mappings = []) {
  if (!mappings.length) {
    mappingsTableEl.innerHTML = '<div class="financial-empty">Aucune correspondance comptable.</div>';
    return;
  }
  const canEdit = sessionUser.role === 'admin';
  mappingsTableEl.innerHTML = `
    <table class="financial-table">
      <thead><tr><th>Prefixe</th><th>Priorite</th><th>Rubrique</th><th>Sous-rubrique</th><th>Libelle dirigeant</th><th>Signe</th><th>Ordre</th><th>Actif</th><th></th></tr></thead>
      <tbody>
        ${mappings.map((mapping) => `
          <tr data-mapping-id="${escapeHtml(mapping.id)}">
            <td><input data-field="account_prefix" value="${escapeHtml(mapping.account_prefix || '')}" ${canEdit ? '' : 'disabled'} /></td>
            <td>${String(mapping.account_prefix || '').length}</td>
            <td><input data-field="section_code" value="${escapeHtml(mapping.section_code || '')}" ${canEdit ? '' : 'disabled'} /></td>
            <td><input data-field="subsection_code" value="${escapeHtml(mapping.subsection_code || '')}" ${canEdit ? '' : 'disabled'} /></td>
            <td><input data-field="display_label" value="${escapeHtml(mapping.display_label || '')}" ${canEdit ? '' : 'disabled'} /></td>
            <td>
              <select data-field="calculation_sign" ${canEdit ? '' : 'disabled'}>
                <option value="1" ${Number(mapping.calculation_sign) === 1 ? 'selected' : ''}>Produit</option>
                <option value="-1" ${Number(mapping.calculation_sign) === -1 ? 'selected' : ''}>Charge</option>
              </select>
            </td>
            <td><input data-field="display_order" type="number" value="${escapeHtml(mapping.display_order || 0)}" ${canEdit ? '' : 'disabled'} /></td>
            <td><input data-field="is_active" type="checkbox" ${mapping.is_active ? 'checked' : ''} ${canEdit ? '' : 'disabled'} /></td>
            <td>${canEdit ? '<button class="btn btn-secondary btn-sm" type="button" data-action="save-mapping">Enregistrer</button>' : ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function loadMappings() {
  const data = await requestJson('/api/reports/financial/mappings');
  renderMappings(data.mappings || []);
}

async function saveMapping(row) {
  const patch = {};
  row.querySelectorAll('[data-field]').forEach((field) => {
    patch[field.dataset.field] = field.type === 'checkbox' ? field.checked : field.value;
  });
  patch.calculation_sign = Number(patch.calculation_sign);
  patch.display_order = Number(patch.display_order);
  await requestJson(`/api/reports/financial/mappings/${encodeURIComponent(row.dataset.mappingId)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  showFeedback('Correspondance enregistree.');
}

function init() {
  userNameEl.textContent = sessionUser.email || sessionUser.name || 'Utilisateur';
  backHomeBtn.addEventListener('click', () => { window.location.href = './home.html'; });
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('gc_token');
    localStorage.removeItem('gc_user');
    localStorage.removeItem('grv2_token');
    localStorage.removeItem('grv2_user');
    window.location.href = './login.html';
  });
  loadMappingsBtn.addEventListener('click', () => loadMappings().catch((error) => showFeedback(error.message, 'error')));
  mappingsTableEl.addEventListener('click', (event) => {
    if (!event.target.closest('[data-action="save-mapping"]')) return;
    saveMapping(event.target.closest('[data-mapping-id]')).catch((error) => showFeedback(error.message, 'error'));
  });
}

init();
loadMappings().catch((error) => showFeedback(error.message, 'error'));
