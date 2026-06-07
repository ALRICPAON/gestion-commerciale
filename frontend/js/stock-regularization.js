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
const searchInput = document.getElementById('regularization-search-input');
const searchBtn = document.getElementById('regularization-search-btn');
const feedbackEl = document.getElementById('regularization-feedback');
const tbody = document.getElementById('regularization-tbody');
const kpiLots = document.getElementById('kpi-lots');
const kpiQuantity = document.getElementById('kpi-quantity');
const kpiLastMovement = document.getElementById('kpi-last-movement');

let negativeLots = [];

function authHeaders(json = false) {
  const headers = { Authorization: `Bearer ${sessionToken}` };
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
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
  feedbackEl.textContent = message;
  feedbackEl.className = 'page-feedback';
  if (!message) feedbackEl.classList.add('hidden');
  if (type) feedbackEl.classList.add(type);
}

function formatNumber(value, digits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('fr-FR');
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders(false) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur API regularisation stock');
  return data;
}

async function apiPost(path, payload = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur regularisation stock');
  return data;
}

function updateKpis(rows) {
  const totalToRegularize = rows.reduce((sum, row) => sum + Math.abs(Number(row.qty_remaining || 0)), 0);
  const lastMovement = rows
    .map((row) => row.last_movement_at)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0];

  kpiLots.textContent = String(rows.length);
  kpiQuantity.textContent = formatNumber(totalToRegularize);
  kpiLastMovement.textContent = formatDateTime(lastMovement);
}

function originText(row) {
  const note = row.forced_movement_notes || row.last_movement_notes || '';
  const source = row.forced_source_table || row.last_source_table || '';
  const type = row.forced_movement_type || row.last_movement_type || '';
  const sourceId = row.forced_source_id || row.last_source_id || '';
  const parts = [];
  if (type) parts.push(type);
  if (source) parts.push(source);
  if (sourceId) parts.push(sourceId);
  if (note) parts.push(note);
  return parts.join(' - ') || '-';
}

function renderRows(rows) {
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7">Aucun stock negatif a regulariser.</td></tr>';
    updateKpis([]);
    return;
  }

  tbody.innerHTML = rows.map((row) => {
    const articleLabel = `${row.plu || ''} ${row.designation || ''}`.trim();
    const lotLabel = row.lot_code || row.supplier_lot_number || row.lot_id;
    const supplierLabel = row.supplier_name || row.supplier_code || '-';
    const unit = row.unit || '';
    return `
      <tr data-lot-id="${escapeHtml(row.lot_id)}">
        <td>
          <strong>${escapeHtml(articleLabel || '-')}</strong>
          <span class="regularization-muted">Article ${escapeHtml(row.article_id || '-')}</span>
        </td>
        <td>
          <strong>${escapeHtml(lotLabel || '-')}</strong>
          <span class="regularization-muted">Lot fournisseur ${escapeHtml(row.supplier_lot_number || '-')}</span>
        </td>
        <td><span class="regularization-negative">${formatNumber(row.qty_remaining)} ${escapeHtml(unit)}</span></td>
        <td>${escapeHtml(supplierLabel)}</td>
        <td>
          ${formatDateTime(row.last_movement_at)}
          <span class="regularization-muted">${escapeHtml(row.last_movement_type || '-')}</span>
        </td>
        <td class="regularization-origin">${escapeHtml(originText(row))}</td>
        <td>
          <div class="regularization-actions">
            <button class="btn btn-primary btn-sm" data-action="regularize" data-lot-id="${escapeHtml(row.lot_id)}">Régulariser</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  updateKpis(rows);
}

async function loadNegativeLots() {
  try {
    showFeedback('Chargement des stocks negatifs...');
    tbody.innerHTML = '<tr><td colspan="7">Chargement des stocks negatifs...</td></tr>';

    const params = new URLSearchParams();
    params.set('limit', '500');
    if (searchInput.value.trim()) params.set('search', searchInput.value.trim());

    negativeLots = await apiGet(`/api/stock/negative-lots?${params.toString()}`);
    renderRows(negativeLots);
    showFeedback(`${negativeLots.length} lot(s) negatif(s) charge(s).`, 'success');
  } catch (error) {
    console.error(error);
    showFeedback(error.message, 'error');
    tbody.innerHTML = '<tr><td colspan="7">Erreur de chargement.</td></tr>';
    updateKpis([]);
  }
}

async function regularizeLot(lotId) {
  const row = negativeLots.find((item) => String(item.lot_id) === String(lotId));
  if (!row) return;
  const quantity = Math.abs(Number(row.qty_remaining || 0));
  const lotLabel = row.lot_code || row.supplier_lot_number || row.lot_id;
  const confirmed = confirm(`Regulariser le lot ${lotLabel} ?\n\nUne entree interne de ${formatNumber(quantity)} ${row.unit || ''} sera creee pour remettre le lot a 0.\nLes anciens mouvements ne seront pas modifies.`);
  if (!confirmed) return;

  const button = tbody.querySelector(`button[data-lot-id="${CSS.escape(String(lotId))}"]`);
  if (button) button.disabled = true;

  try {
    const result = await apiPost(`/api/stock/negative-lots/${encodeURIComponent(lotId)}/regularize`, { confirm: true });
    showFeedback(`${result.message || 'Lot regularise.'} Mouvement cree : +${formatNumber(result.regularization_qty)}.`, 'success');
    await loadNegativeLots();
  } catch (error) {
    console.error(error);
    showFeedback(error.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    loadNegativeLots();
  }
});

searchBtn.addEventListener('click', loadNegativeLots);
refreshBtn.addEventListener('click', loadNegativeLots);

tbody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="regularize"]');
  if (!button) return;
  regularizeLot(button.dataset.lotId);
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

function init() {
  userNameEl.textContent = sessionUser.email || 'Utilisateur';
  loadNegativeLots();
}

init();
