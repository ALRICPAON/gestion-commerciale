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
const rematchPreviewBtn = document.getElementById('rematch-preview-btn');
const rematchConfirmBtn = document.getElementById('rematch-confirm-btn');
const feedbackEl = document.getElementById('af-map-feedback');

const totalMappingsEl = document.getElementById('total-mappings');
const validMappingsEl = document.getElementById('valid-mappings');
const orphanMappingsEl = document.getElementById('orphan-mappings');
const repairableMappingsEl = document.getElementById('repairable-mappings');
const nonRepairableMappingsEl = document.getElementById('non-repairable-mappings');
const suppliersTbody = document.getElementById('suppliers-tbody');
const previewTbody = document.getElementById('preview-tbody');
const rematchMethodsEl = document.getElementById('rematch-methods');

let lastPreview = null;

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

function formatCount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString('fr-FR') : '0';
}

function text(value) {
  return value === null || value === undefined || value === '' ? '-' : String(value);
}

function renderSuppliers(rows = []) {
  if (!rows.length) {
    suppliersTbody.innerHTML = '<tr><td colspan="4">Aucun mapping orphelin détecté.</td></tr>';
    return;
  }

  suppliersTbody.innerHTML = rows.map((supplier) => `
    <tr>
      <td>${text(supplier.supplier_name)}</td>
      <td>${formatCount(supplier.orphan_mappings)}</td>
      <td>${formatCount(supplier.repairable_mappings)}</td>
      <td>${formatCount(supplier.non_repairable_mappings)}</td>
    </tr>
  `).join('');
}

function renderMethods(rows = []) {
  if (!rows.length) {
    rematchMethodsEl.textContent = 'Aucun mapping réparable détecté.';
    return;
  }

  rematchMethodsEl.textContent = rows
    .map((row) => `${row.match_method}: ${formatCount(row.count)}`)
    .join(' | ');
}

function renderPreview(rows = []) {
  if (!rows.length) {
    previewTbody.innerHTML = '<tr><td colspan="7">Aucun mapping orphelin dans l’aperçu.</td></tr>';
    return;
  }

  previewTbody.innerHTML = rows.map((mapping) => `
    <tr>
      <td>${text(mapping.supplier_name)}</td>
      <td>${text(mapping.mapping_plu)}</td>
      <td>${text(mapping.mapping_ean)}</td>
      <td>${text(mapping.mapping_designation)}</td>
      <td>${text(mapping.match_method)}</td>
      <td>${text(mapping.suggested_article_plu)} - ${text(mapping.suggested_article_designation)}</td>
      <td>${mapping.repairable ? 'Réparable' : 'Non réparable'}</td>
    </tr>
  `).join('');
}

function renderDiagnostic(data) {
  totalMappingsEl.textContent = formatCount(data.total_mappings);
  validMappingsEl.textContent = formatCount(data.valid_mappings);
  orphanMappingsEl.textContent = formatCount(data.orphan_mappings);
  repairableMappingsEl.textContent = formatCount(data.repairable_mappings);
  nonRepairableMappingsEl.textContent = formatCount(data.non_repairable_mappings);
  renderSuppliers(data.suppliers || []);
  renderMethods(data.repair_methods || []);
  renderPreview(data.sample_mappings || []);

  lastPreview = data;
  rematchConfirmBtn.disabled = Number(data.repairable_mappings || 0) === 0;
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

async function loadDiagnostic() {
  try {
    setFeedback('Chargement du diagnostic AF_MAP...');
    rematchConfirmBtn.disabled = true;
    const data = await fetchJson('/api/supplier-article-mappings/diagnostic', { headers: authHeaders(false) });
    renderDiagnostic(data);
    setFeedback('Diagnostic AF_MAP chargé.', 'success');
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
    suppliersTbody.innerHTML = '<tr><td colspan="4">Erreur de chargement.</td></tr>';
  }
}

async function loadPreview() {
  try {
    setFeedback('Calcul de l’aperçu de rematch AF_MAP...');
    const data = await fetchJson('/api/supplier-article-mappings/rematch-preview', { headers: authHeaders(false) });
    lastPreview = data;
    renderMethods(data.repair_methods || []);
    renderPreview(data.sample_mappings || []);
    rematchConfirmBtn.disabled = Number(data.repairable_mappings || 0) === 0;
    setFeedback(`${formatCount(data.repairable_mappings)} mapping(s) réparable(s), ${formatCount(data.non_repairable_mappings)} non réparable(s).`, 'success');
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
  }
}

async function confirmRematch() {
  const repairableCount = Number(lastPreview?.repairable_mappings || 0);
  if (repairableCount <= 0) return;

  const confirmed = window.confirm(
    `Confirmer la correction de ${formatCount(repairableCount)} mapping(s) AF_MAP réparable(s) ? Aucun mapping ne sera supprimé.`
  );
  if (!confirmed) return;

  try {
    setFeedback('Correction AF_MAP en cours...');
    rematchConfirmBtn.disabled = true;
    const data = await fetchJson('/api/supplier-article-mappings/rematch', {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    });
    setFeedback(`${formatCount(data.repaired_mappings)} mapping(s) AF_MAP réparé(s).`, 'success');
    await loadDiagnostic();
  } catch (error) {
    console.error(error);
    setFeedback(error.message, 'error');
    rematchConfirmBtn.disabled = false;
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

refreshBtn.addEventListener('click', loadDiagnostic);
rematchPreviewBtn.addEventListener('click', loadPreview);
rematchConfirmBtn.addEventListener('click', confirmRematch);

loadDiagnostic();