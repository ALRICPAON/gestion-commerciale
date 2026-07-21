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
const periodPreset = document.getElementById('period-preset');
const periodStartInput = document.getElementById('period-start');
const periodEndInput = document.getElementById('period-end');
const comparisonStartInput = document.getElementById('comparison-start');
const comparisonEndInput = document.getElementById('comparison-end');
const loadReportBtn = document.getElementById('load-report-btn');
const syncBtn = document.getElementById('sync-btn');
const exportPdfBtn = document.getElementById('export-pdf-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');
const loadMappingsBtn = document.getElementById('load-mappings-btn');
const feedbackEl = document.getElementById('page-feedback');
const reportStatus = document.getElementById('report-status');
const kpiGrid = document.getElementById('kpi-grid');
const syncInfo = document.getElementById('sync-info');
const provisionalBadge = document.getElementById('provisional-badge');
const incomeStatementEl = document.getElementById('income-statement');
const comparisonTableEl = document.getElementById('comparison-table');
const mappingsTableEl = document.getElementById('mappings-table');

function authHeaders() {
  return { Authorization: `Bearer ${sessionToken}` };
}

function showFeedback(message, type = 'success') {
  if (!feedbackEl) return;
  feedbackEl.textContent = message || '';
  feedbackEl.className = `page-feedback ${message ? '' : 'hidden'} ${type === 'error' ? 'error' : 'success'}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function money(value) {
  return Number(value || 0).toLocaleString('fr-FR', {
    style: 'currency',
    currency: 'EUR',
  });
}

function percent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function setPresetDates() {
  const now = new Date();
  const value = periodPreset.value;
  let start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  let end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  if (value === 'previous-month') {
    start = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
    end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0));
  } else if (value === 'current-year') {
    start = new Date(Date.UTC(now.getFullYear(), 0, 1));
  } else if (value === 'custom') {
    return;
  }

  periodStartInput.value = isoDate(start);
  periodEndInput.value = isoDate(end);
  const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const comparisonEnd = new Date(start);
  comparisonEnd.setUTCDate(comparisonEnd.getUTCDate() - 1);
  const comparisonStart = new Date(comparisonEnd);
  comparisonStart.setUTCDate(comparisonStart.getUTCDate() - days + 1);
  comparisonStartInput.value = isoDate(comparisonStart);
  comparisonEndInput.value = isoDate(comparisonEnd);
}

function queryParams(extra = {}) {
  const params = new URLSearchParams({
    period_start: periodStartInput.value,
    period_end: periodEndInput.value,
    comparison_period_start: comparisonStartInput.value,
    comparison_period_end: comparisonEndInput.value,
    ...extra,
  });
  return params.toString();
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
  if (!response.ok) {
    const error = new Error(data.error || 'Erreur API reporting financier');
    error.status = response.status;
    error.code = data.code || null;
    throw error;
  }
  return data;
}

function renderKpis(report = {}) {
  const kpis = report.kpis || {};
  const items = [
    ['Chiffre d affaires', money(kpis.revenue)],
    ['Marge brute', money(kpis.gross_margin)],
    ['Taux de marge', percent(kpis.margin_rate)],
    ['Charges exploitation', money(kpis.operating_charges)],
    ['EBE', money(kpis.ebitda)],
    ['Resultat net provisoire', money(kpis.net_result)],
  ];
  kpiGrid.innerHTML = items.map(([label, value]) => `
    <article class="financial-kpi">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `).join('');
}

function renderStatement(report = {}) {
  const sections = Array.isArray(report.sections) ? report.sections : [];
  if (!sections.length) {
    incomeStatementEl.innerHTML = '<div class="financial-empty">Aucune balance Pennylane chargee pour cette periode.</div>';
    return;
  }
  const warning = report.incomplete
    ? '<div class="financial-warning">Donnees incompletes ou comptes non mappes : le resultat reste provisoire.</div>'
    : '';
  incomeStatementEl.innerHTML = `${warning}${sections.map((section) => `
    <details class="financial-section" open>
      <summary>
        <span>${escapeHtml(section.section_label)} - ${escapeHtml(section.display_label)}</span>
        <strong>${escapeHtml(money(section.amount))}</strong>
      </summary>
      <table class="financial-table">
        <thead>
          <tr><th>Compte</th><th>Libelle</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Solde</th><th class="num">Montant</th></tr>
        </thead>
        <tbody>
          ${(section.accounts || []).map((account) => `
            <tr>
              <td>${escapeHtml(account.formatted_account_number || account.account_number)}</td>
              <td>${escapeHtml(account.account_label || '')}</td>
              <td class="num">${escapeHtml(money(account.total_debit))}</td>
              <td class="num">${escapeHtml(money(account.total_credit))}</td>
              <td class="num">${escapeHtml(money(account.net_balance))}</td>
              <td class="num">${escapeHtml(money(account.amount))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </details>
  `).join('')}`;
}

function renderComparison(compare = {}) {
  const rows = Object.entries(compare.calculations || {});
  if (!rows.length) {
    comparisonTableEl.innerHTML = '<div class="financial-empty">Aucune comparaison disponible.</div>';
    return;
  }
  comparisonTableEl.innerHTML = `
    <table class="financial-table">
      <thead><tr><th>Indicateur</th><th class="num">Actuel</th><th class="num">Precedent</th><th class="num">Ecart</th><th class="num">Ecart %</th></tr></thead>
      <tbody>
        ${rows.map(([key, row]) => `
          <tr>
            <td>${escapeHtml(key)}</td>
            <td class="num">${escapeHtml(money(row.current))}</td>
            <td class="num">${escapeHtml(money(row.previous))}</td>
            <td class="num">${escapeHtml(money(row.delta))}</td>
            <td class="num">${escapeHtml(percent(row.delta_percent))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderMappings(mappings = []) {
  if (!mappings.length) {
    mappingsTableEl.innerHTML = '<div class="financial-empty">Aucun mapping charge.</div>';
    return;
  }
  const canEdit = sessionUser.role === 'admin';
  mappingsTableEl.innerHTML = `
    <table class="financial-table">
      <thead><tr><th>Prefixe</th><th>Section</th><th>Sous-section</th><th>Libelle</th><th>Signe</th><th>Ordre</th><th>Actif</th><th></th></tr></thead>
      <tbody>
        ${mappings.map((mapping) => `
          <tr data-mapping-id="${escapeHtml(mapping.id)}">
            <td><input data-field="account_prefix" value="${escapeHtml(mapping.account_prefix || '')}" ${canEdit ? '' : 'disabled'} /></td>
            <td><input data-field="section_code" value="${escapeHtml(mapping.section_code || '')}" ${canEdit ? '' : 'disabled'} /></td>
            <td><input data-field="subsection_code" value="${escapeHtml(mapping.subsection_code || '')}" ${canEdit ? '' : 'disabled'} /></td>
            <td><input data-field="display_label" value="${escapeHtml(mapping.display_label || '')}" ${canEdit ? '' : 'disabled'} /></td>
            <td>
              <select data-field="calculation_sign" ${canEdit ? '' : 'disabled'}>
                <option value="1" ${Number(mapping.calculation_sign) === 1 ? 'selected' : ''}>+1</option>
                <option value="-1" ${Number(mapping.calculation_sign) === -1 ? 'selected' : ''}>-1</option>
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
  const id = row.dataset.mappingId;
  const patch = {};
  row.querySelectorAll('[data-field]').forEach((field) => {
    const key = field.dataset.field;
    patch[key] = field.type === 'checkbox' ? field.checked : field.value;
  });
  patch.calculation_sign = Number(patch.calculation_sign);
  patch.display_order = Number(patch.display_order);
  await requestJson(`/api/reports/financial/mappings/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  showFeedback('Mapping enregistre.', 'success');
}

function updateMeta(report = {}) {
  reportStatus.textContent = `Periode ${report.period_start || periodStartInput.value} au ${report.period_end || periodEndInput.value}`;
  provisionalBadge.textContent = report.provisional ? 'Provisoire' : 'Definitif';
  provisionalBadge.classList.toggle('is-final', !report.provisional);
  const fetchedAt = report.snapshot?.fetched_at || report.last_sync?.completed_at || null;
  syncInfo.textContent = fetchedAt
    ? `Derniere synchronisation : ${new Date(fetchedAt).toLocaleString('fr-FR')}`
    : 'Aucune synchronisation chargee.';
}

async function loadReport(refresh = false) {
  showFeedback('');
  const report = await requestJson(`/api/reports/financial/income-statement?${queryParams({ refresh })}`);
  const compare = await requestJson(`/api/reports/financial/comparison?${queryParams()}`);
  renderKpis(report);
  renderStatement(report);
  renderComparison(compare);
  updateMeta(report);
}

async function syncReport() {
  syncBtn.disabled = true;
  syncBtn.textContent = 'Synchronisation...';
  try {
    await requestJson('/api/reports/financial/sync', {
      method: 'POST',
      body: JSON.stringify({
        period_start: periodStartInput.value,
        period_end: periodEndInput.value,
      }),
    });
    await loadReport(false);
    showFeedback('Balance Pennylane synchronisee.', 'success');
  } catch (error) {
    console.error('Erreur synchronisation reporting financier :', { message: error.message, status: error.status, code: error.code });
    showFeedback(error.message || 'Erreur synchronisation Pennylane', 'error');
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = 'Actualiser depuis Pennylane';
  }
}

async function exportReport(format) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/reports/financial/export?${queryParams({ format })}`, {
      headers: authHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Erreur export reporting financier');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `reporting-financier-${periodStartInput.value}-${periodEndInput.value}.${format === 'pdf' ? 'pdf' : 'csv'}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Erreur export reporting financier :', { message: error.message });
    showFeedback(error.message || 'Erreur export reporting financier', 'error');
  }
}

function initEvents() {
  userNameEl.textContent = sessionUser.email || sessionUser.name || 'Utilisateur';
  backHomeBtn.addEventListener('click', () => { window.location.href = './home.html'; });
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('gc_token');
    localStorage.removeItem('gc_user');
    localStorage.removeItem('grv2_token');
    localStorage.removeItem('grv2_user');
    window.location.href = './login.html';
  });
  periodPreset.addEventListener('change', setPresetDates);
  loadReportBtn.addEventListener('click', () => loadReport(false).catch((error) => {
    console.error('Erreur chargement reporting financier :', { message: error.message, status: error.status, code: error.code });
    showFeedback(error.message || 'Erreur chargement reporting financier', 'error');
  }));
  syncBtn.addEventListener('click', syncReport);
  exportPdfBtn.addEventListener('click', () => exportReport('pdf'));
  exportCsvBtn.addEventListener('click', () => exportReport('csv'));
  loadMappingsBtn.addEventListener('click', () => loadMappings().catch((error) => {
    console.error('Erreur chargement mappings financiers :', { message: error.message, status: error.status });
    showFeedback(error.message || 'Erreur chargement mappings', 'error');
  }));
  mappingsTableEl.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="save-mapping"]')) {
      saveMapping(event.target.closest('[data-mapping-id]')).catch((error) => {
        console.error('Erreur sauvegarde mapping financier :', { message: error.message, status: error.status });
        showFeedback(error.message || 'Erreur sauvegarde mapping', 'error');
      });
    }
  });
}

setPresetDates();
initEvents();
loadReport(false).catch((error) => {
  console.error('Erreur initialisation reporting financier :', { message: error.message, status: error.status, code: error.code });
  showFeedback(error.message || 'Erreur initialisation reporting financier', 'error');
});
loadMappings().catch(() => {});
