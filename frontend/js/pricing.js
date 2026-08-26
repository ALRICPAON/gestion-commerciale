const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';
const sessionToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const sessionUserRaw = localStorage.getItem('gc_user') || localStorage.getItem('grv2_user');

if (!sessionToken || !sessionUserRaw) window.location.href = './login.html';

const sessionUser = JSON.parse(sessionUserRaw);
const el = (id) => document.getElementById(id);

const userNameEl = el('user-name');
const backHomeBtn = el('back-home-btn');
const logoutBtn = el('logout-btn');
const pricingDateInput = el('pricing-date-input');
const sessionStatusLabel = el('session-status-label');
const saveStateLabel = el('save-state-label');
const pageFeedback = el('page-feedback');
const loadSessionBtn = el('load-session-btn');
const newSessionBtn = el('new-session-btn');
const duplicateSessionBtn = el('duplicate-session-btn');
const addLineBtn = el('add-line-btn');
const importBtn = el('import-btn');
const publishBtn = el('publish-btn');
const saveNowBtn = el('save-now-btn');
const searchInput = el('search-input');
const supplierFilter = el('supplier-filter');
const familyFilter = el('family-filter');
const headRow = el('pricing-head-row');
const linesBody = el('pricing-lines-body');
const articleModal = el('article-modal');
const closeArticleModalBtn = el('close-article-modal-btn');
const articleSearchInput = el('article-search-input');
const articleResults = el('article-results');
const importModal = el('import-modal');
const closeImportModalBtn = el('close-import-modal-btn');
const importSupplierSelect = el('import-supplier-select');
const importFileInput = el('import-file-input');
const importFileName = el('import-file-name');
const importTextarea = el('import-textarea');
const runImportBtn = el('run-import-btn');
const confirmKnownBtn = el('confirm-known-btn');
const applyImportBtn = el('apply-import-btn');
const importSummary = el('import-summary');
const importResults = el('import-results');

let suppliers = [];
let tariffLevels = [];
let session = null;
let lines = [];
let dirty = new Set();
let saveTimer = null;
let lastImportId = null;
let currentImport = null;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function authHeaders() {
  return { Authorization: `Bearer ${sessionToken}` };
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur API');
  return data;
}

async function apiJson(path, payload, method = 'POST') {
  return api(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}

async function apiForm(path, formData, method = 'POST') {
  return api(path, { method, body: formData });
}

function showFeedback(message, type = 'info') {
  pageFeedback.textContent = message;
  pageFeedback.className = `page-feedback ${type}`;
  pageFeedback.classList.remove('hidden');
  window.setTimeout(() => pageFeedback.classList.add('hidden'), 4500);
}

function money(value) {
  if (value === null || value === undefined || value === '') return '';
  return Number(value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function numberValue(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : '';
}

function setStatus() {
  sessionStatusLabel.textContent = session ? `${session.status} - v${session.version_number || 1}` : 'Aucune session';
  saveStateLabel.textContent = dirty.size ? `${dirty.size} ligne(s) modifiee(s)` : 'A jour';
  publishBtn.disabled = !session || session.status !== 'draft' || dirty.size > 0;
  saveNowBtn.disabled = !dirty.size;
}

function supplierOptions(selected) {
  return ['<option value="">-</option>'].concat(suppliers.map((supplier) => (
    `<option value="${supplier.id}" ${String(selected || '') === String(supplier.id) ? 'selected' : ''}>${escapeHtml(supplier.name || supplier.code || supplier.id)}</option>`
  ))).join('');
}

function escapeHtml(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderHead() {
  headRow.innerHTML = `
    <th>Code</th>
    <th>Designation</th>
    <th>Fournisseur</th>
    <th>Achat</th>
    <th>Transport</th>
    <th>Cout rendu</th>
    ${tariffLevels.map((level) => `<th>${escapeHtml(level.name || level.code)}</th>`).join('')}
    <th>Actions</th>
  `;
}

function tariffValue(line, level) {
  const found = (line.tariffs || []).find((tariff) => tariff.tariff_level_id === level.id || Number(tariff.legacy_level) === Number(level.legacy_level));
  return found?.price_ht ?? '';
}

function marginHtml(line, price) {
  const p = Number(price);
  const cost = Number(line.cost_rendered_ht || 0);
  if (!Number.isFinite(p) || p <= 0) return '';
  const abs = p - cost;
  const rate = (abs / p) * 100;
  return `<span class="pricing-margin">${money(abs)} / ${rate.toFixed(1)}%</span>`;
}

function refreshRowComputedCells(row, line) {
  if (!row || !line) return;
  const cost = Number(line.cost_rendered_ht || 0);
  const costCell = row.querySelector('.pricing-cost');
  if (costCell) costCell.textContent = money(cost);
  row.querySelectorAll('[data-tariff-level-id]').forEach((input) => {
    const value = input.value;
    const cell = input.closest('td');
    if (cell) {
      const old = cell.querySelector('.pricing-margin');
      if (old) old.remove();
      cell.insertAdjacentHTML('beforeend', marginHtml(line, value));
    }
  });
}

function visibleLines() {
  const query = String(searchInput.value || '').toLowerCase();
  const supplier = supplierFilter.value;
  const family = familyFilter.value;
  return lines.filter((line) => {
    const text = [line.plu_snapshot, line.designation_snapshot, line.supplier_name].filter(Boolean).join(' ').toLowerCase();
    return (!query || text.includes(query))
      && (!supplier || String(line.supplier_id || '') === supplier)
      && (!family || String(line.family_name || '') === family);
  });
}

function renderFilters() {
  const selectedSupplier = supplierFilter.value;
  const selectedFamily = familyFilter.value;
  supplierFilter.innerHTML = '<option value="">Tous fournisseurs</option>' + suppliers.map((supplier) => (
    `<option value="${supplier.id}">${escapeHtml(supplier.name || supplier.code || supplier.id)}</option>`
  )).join('');
  const families = [...new Set(lines.map((line) => line.family_name).filter(Boolean))].sort();
  familyFilter.innerHTML = '<option value="">Toutes familles</option>' + families.map((family) => `<option value="${escapeHtml(family)}">${escapeHtml(family)}</option>`).join('');
  supplierFilter.value = selectedSupplier;
  familyFilter.value = selectedFamily;
}

function renderLines() {
  renderHead();
  renderFilters();
  linesBody.innerHTML = visibleLines().map((line) => `
    <tr data-line-id="${line.id}" class="${dirty.has(line.id) ? 'pricing-row-dirty' : ''}">
      <td>${escapeHtml(line.plu_snapshot || '')}</td>
      <td>${escapeHtml(line.designation_snapshot || '')}</td>
      <td><select data-field="supplier_id">${supplierOptions(line.supplier_id)}</select></td>
      <td><input class="pricing-number" data-field="purchase_price_ht" type="number" step="0.01" min="0" value="${numberValue(line.purchase_price_ht)}"></td>
      <td><input class="pricing-number" data-field="transport_cost_ht" type="number" step="0.01" min="0" value="${numberValue(line.transport_cost_ht)}"></td>
      <td class="pricing-cost">${money(line.cost_rendered_ht)}</td>
      ${tariffLevels.map((level) => {
        const value = tariffValue(line, level);
        return `<td><input class="pricing-number" data-tariff-level-id="${level.id}" type="number" step="0.01" min="0" value="${numberValue(value)}">${marginHtml(line, value)}</td>`;
      }).join('')}
      <td><button class="btn btn-secondary btn-sm" data-action="delete" type="button">Retirer</button></td>
    </tr>
  `).join('');
  setStatus();
}

function markDirty(lineId) {
  if (!session || session.status !== 'draft') return;
  dirty.add(lineId);
  const row = linesBody.querySelector(`[data-line-id="${lineId}"]`);
  if (row) row.classList.add('pricing-row-dirty');
  setStatus();
  scheduleSave();
}

function scheduleSave() {
  saveStateLabel.textContent = 'Sauvegarde programmee...';
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveDirtyLines, 1100);
}

function rowPayload(row) {
  const lineId = row.dataset.lineId;
  const payload = { pricing_line_id: lineId, tariffs: [] };
  row.querySelectorAll('[data-field]').forEach((input) => {
    payload[input.dataset.field] = input.value === '' ? null : input.value;
  });
  row.querySelectorAll('[data-tariff-level-id]').forEach((input) => {
    payload.tariffs.push({
      tariff_level_id: input.dataset.tariffLevelId,
      price_ht: input.value === '' ? null : input.value,
    });
  });
  return payload;
}

async function saveDirtyLines() {
  if (!dirty.size) return;
  const ids = [...dirty];
  saveStateLabel.textContent = 'Sauvegarde...';
  for (const id of ids) {
    const row = linesBody.querySelector(`[data-line-id="${id}"]`);
    if (!row) continue;
    const updated = await apiJson(`/api/pricing/lines/${encodeURIComponent(id)}`, rowPayload(row), 'PATCH');
    const index = lines.findIndex((line) => String(line.id) === String(id));
    if (index >= 0) lines[index] = updated;
    dirty.delete(id);
    row.classList.remove('pricing-row-dirty');
    refreshRowComputedCells(row, updated);
  }
  showFeedback('Tarification sauvegardee.', 'success');
  setStatus();
}

async function loadReferenceData() {
  const [supplierRows, tariffRows] = await Promise.all([
    api('/api/suppliers?limit=500'),
    api('/api/pricing/tariff-levels'),
  ]);
  suppliers = Array.isArray(supplierRows) ? supplierRows : supplierRows.results || [];
  tariffLevels = tariffRows.results || [];
  importSupplierSelect.innerHTML = '<option value="">Choisir fournisseur</option>' + suppliers.map((supplier) => `<option value="${supplier.id}">${escapeHtml(supplier.name || supplier.code || supplier.id)}</option>`).join('');
}

async function loadSession(showMessage = true) {
  const date = pricingDateInput.value || todayIso();
  const current = await api(`/api/pricing/sessions?date=${encodeURIComponent(date)}&limit=1`);
  if (!current.results?.length) {
    session = null;
    lines = [];
    renderLines();
    if (showMessage) showFeedback('Aucune session pour cette date.', 'info');
    return;
  }
  const detail = await api(`/api/pricing/sessions/${encodeURIComponent(current.results[0].id)}`);
  session = detail.session;
  lines = detail.lines || [];
  dirty.clear();
  renderLines();
  if (showMessage) showFeedback('Session chargee.', 'success');
}

async function createSession() {
  const result = await apiJson('/api/pricing/sessions', { pricing_date: pricingDateInput.value || todayIso() });
  session = result.session;
  lines = result.lines || [];
  dirty.clear();
  renderLines();
  showFeedback('Session creee.', 'success');
}

async function duplicateSession() {
  const result = await apiJson('/api/pricing/sessions/duplicate', { pricing_date: pricingDateInput.value || todayIso() });
  session = result.session;
  lines = result.lines || [];
  dirty.clear();
  renderLines();
  showFeedback('Tarification precedente reprise.', 'success');
}

async function searchArticles() {
  const query = articleSearchInput.value.trim();
  if (!query) return;
  const data = await api(`/api/articles?search=${encodeURIComponent(query)}&limit=30`);
  const rows = Array.isArray(data) ? data : data.articles || data.results || [];
  articleResults.innerHTML = rows.map((article) => `
    <div class="pricing-result-row">
      <strong>${escapeHtml(article.plu || '')}</strong>
      <span>${escapeHtml(article.designation || article.display_name || '')}</span>
      <button class="btn btn-primary btn-sm" data-article-id="${article.id}" type="button">Ajouter</button>
    </div>
  `).join('') || '<p>Aucun article.</p>';
}

async function addArticle(articleId) {
  if (!session) await createSession();
  const line = await apiJson('/api/pricing/lines', { pricing_session_id: session.id, article_id: articleId });
  lines.push(line);
  articleModal.classList.add('hidden');
  renderLines();
}

async function deleteLine(lineId) {
  await api(`/api/pricing/lines/${encodeURIComponent(lineId)}`, { method: 'DELETE' });
  lines = lines.filter((line) => String(line.id) !== String(lineId));
  dirty.delete(lineId);
  renderLines();
}

async function publishSession() {
  await saveDirtyLines();
  if (!session) return;
  const result = await apiJson(`/api/pricing/sessions/${encodeURIComponent(session.id)}/publish`, { sync_call_sheet: true });
  session = result.session;
  lines = result.lines || [];
  renderLines();
  showFeedback('Tarifs publies et fiche appel synchronisee.', 'success');
}

async function runImport() {
  if (!importSupplierSelect.value) throw new Error('Choisir un fournisseur');
  const file = importFileInput.files?.[0] || null;
  const rawText = importTextarea.value.trim();
  let result;
  if (file) {
    const formData = new FormData();
    formData.append('supplier_id', importSupplierSelect.value);
    formData.append('file', file);
    if (rawText) formData.append('raw_text', rawText);
    result = await apiForm('/api/pricing/supplier-imports', formData);
  } else {
    result = await apiJson('/api/pricing/supplier-imports', {
      supplier_id: importSupplierSelect.value,
      raw_text: rawText,
      source_type: 'text',
    });
  }
  setImport(result);
}

async function applyImport() {
  if (!lastImportId || !session) return;
  const result = await apiJson(`/api/pricing/supplier-imports/${encodeURIComponent(lastImportId)}/apply`, { pricing_session_id: session.id });
  importModal.classList.add('hidden');
  await loadSession(false);
  showFeedback(`Import applique : ${result.applied_line_count || 0} ligne(s).`, 'success');
}

function setImport(result) {
  currentImport = result;
  lastImportId = result.import?.id || null;
  renderImport();
}

function decisionLabel(line) {
  if (line.user_decision === 'confirmed') return 'Confirme';
  if (line.user_decision === 'overridden') return 'Corrige';
  if (line.user_decision === 'ignored') return 'Ignore';
  if (line.match_method === 'known_mapping') return 'Mapping connu';
  if (line.match_status === 'probable') return `Proposition ${Number(line.confidence_score || 0).toFixed(0)} %`;
  return 'A traiter';
}

function renderImport() {
  const linesForImport = currentImport?.lines || [];
  const summary = currentImport?.summary || linesForImport.reduce((acc, line) => {
    acc.total += 1;
    acc.ready += ['confirmed', 'overridden'].includes(line.user_decision) ? 1 : 0;
    acc.pending += line.user_decision === 'pending' ? 1 : 0;
    acc.ignored += line.user_decision === 'ignored' ? 1 : 0;
    return acc;
  }, { total: 0, ready: 0, pending: 0, ignored: 0 });
  applyImportBtn.disabled = !lastImportId || !session || !summary.ready;
  confirmKnownBtn.disabled = !linesForImport.some((line) => line.match_method === 'known_mapping' && line.user_decision === 'pending');
  importSummary.innerHTML = lastImportId ? `
    <strong>${summary.total || 0}</strong> lignes detectees
    <strong>${summary.ready || 0}</strong> pretes a appliquer
    <strong>${summary.pending || 0}</strong> a traiter
    <strong>${summary.ignored || 0}</strong> ignorees
  ` : '';
  importResults.innerHTML = linesForImport.length ? `
    <table class="pricing-import-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Designation fournisseur</th>
          <th>Prix</th>
          <th>Calibre/unite</th>
          <th>Article ALTA</th>
          <th>PLU</th>
          <th>Matching</th>
          <th>Decision</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${linesForImport.map((line) => `
          <tr data-import-line-id="${line.id}">
            <td>${escapeHtml(line.row_number || '')}</td>
            <td>${escapeHtml(line.supplier_designation_original || '')}</td>
            <td class="pricing-number">${money(line.purchase_price_ht)}</td>
            <td>${escapeHtml([line.caliber, line.unit || line.price_unit].filter(Boolean).join(' / '))}</td>
            <td>${line.article_designation ? escapeHtml(line.article_designation) : '<span class="pricing-muted">Aucun article</span>'}</td>
            <td>${escapeHtml(line.article_plu || '')}</td>
            <td>${escapeHtml(line.match_method || line.match_status || '')}<br><small>${Number(line.confidence_score || 0).toFixed(0)} %</small></td>
            <td><span class="pricing-decision">${decisionLabel(line)}</span></td>
            <td>${importActionsHtml(line)}<div class="pricing-inline-search hidden"></div></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '<p>Aucune ligne detectee.</p>';
}

function importActionsHtml(line) {
  if (line.user_decision === 'ignored') return '<span class="pricing-muted">Ignoree</span>';
  const buttons = [];
  if (line.matched_article_id && line.user_decision === 'pending') buttons.push(`<button class="btn btn-primary btn-sm" data-import-action="confirm" type="button">Confirmer</button>`);
  if (line.matched_article_id) buttons.push(`<button class="btn btn-secondary btn-sm" data-import-action="change" type="button">Changer</button>`);
  if (!line.matched_article_id) buttons.push(`<button class="btn btn-primary btn-sm" data-import-action="change" type="button">Choisir article</button>`);
  buttons.push(`<button class="btn btn-secondary btn-sm" data-import-action="ignore" type="button">Ignorer</button>`);
  return `<div class="pricing-import-actions">${buttons.join('')}</div>`;
}

async function refreshImport() {
  if (!lastImportId) return;
  setImport(await api(`/api/pricing/supplier-imports/${encodeURIComponent(lastImportId)}`));
}

async function confirmImportLine(lineId) {
  await apiJson(`/api/pricing/supplier-import-lines/${encodeURIComponent(lineId)}/confirm`, {});
  await refreshImport();
}

async function ignoreImportLine(lineId) {
  await apiJson(`/api/pricing/supplier-import-lines/${encodeURIComponent(lineId)}/ignore`, {});
  await refreshImport();
}

function showArticleSearch(row) {
  const box = row.querySelector('.pricing-inline-search');
  box.classList.remove('hidden');
  box.innerHTML = `
    <input type="search" placeholder="PLU ou designation article" data-import-search-input />
    <button class="btn btn-secondary btn-sm" data-import-action="search" type="button">Rechercher</button>
    <div class="pricing-inline-results"></div>
  `;
  box.querySelector('input').focus();
}

async function searchImportArticles(row) {
  const query = row.querySelector('[data-import-search-input]')?.value || '';
  if (!query.trim()) return;
  const data = await api(`/api/pricing/supplier-import-lines/articles/search?query=${encodeURIComponent(query)}&limit=12`);
  const target = row.querySelector('.pricing-inline-results');
  target.innerHTML = (data.results || []).map((article) => `
    <button class="pricing-article-choice" data-import-action="select-article" data-article-id="${article.id}" type="button">
      <strong>${escapeHtml(article.plu || '')}</strong>
      <span>${escapeHtml(article.designation || '')}</span>
      <small>${escapeHtml(article.sale_unit || article.unit || '')} ${escapeHtml(article.family_name || '')}</small>
    </button>
  `).join('') || '<p>Aucun article.</p>';
}

async function selectImportArticle(lineId, articleId) {
  await apiJson(`/api/pricing/supplier-import-lines/${encodeURIComponent(lineId)}/override`, { article_id: articleId });
  await refreshImport();
}

async function confirmKnownMappings() {
  const known = (currentImport?.lines || []).filter((line) => line.match_method === 'known_mapping' && line.user_decision === 'pending');
  for (const line of known) await apiJson(`/api/pricing/supplier-import-lines/${encodeURIComponent(line.id)}/confirm`, {});
  await refreshImport();
}

function bindEvents() {
  userNameEl.textContent = sessionUser.name || sessionUser.email || 'Utilisateur';
  backHomeBtn.addEventListener('click', () => { window.location.href = './home.html'; });
  logoutBtn.addEventListener('click', () => { localStorage.removeItem('gc_token'); localStorage.removeItem('gc_user'); window.location.href = './login.html'; });
  loadSessionBtn.addEventListener('click', () => loadSession());
  newSessionBtn.addEventListener('click', createSession);
  duplicateSessionBtn.addEventListener('click', duplicateSession);
  saveNowBtn.addEventListener('click', saveDirtyLines);
  publishBtn.addEventListener('click', publishSession);
  addLineBtn.addEventListener('click', () => articleModal.classList.remove('hidden'));
  closeArticleModalBtn.addEventListener('click', () => articleModal.classList.add('hidden'));
  articleSearchInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') searchArticles(); });
  articleResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-article-id]');
    if (button) addArticle(button.dataset.articleId).catch((error) => showFeedback(error.message, 'error'));
  });
  importBtn.addEventListener('click', () => importModal.classList.remove('hidden'));
  closeImportModalBtn.addEventListener('click', () => importModal.classList.add('hidden'));
  runImportBtn.addEventListener('click', () => runImport().catch((error) => showFeedback(error.message, 'error')));
  confirmKnownBtn.addEventListener('click', () => confirmKnownMappings().catch((error) => showFeedback(error.message, 'error')));
  applyImportBtn.addEventListener('click', () => applyImport().catch((error) => showFeedback(error.message, 'error')));
  importFileInput.addEventListener('change', () => {
    importFileName.textContent = importFileInput.files?.[0]?.name || 'Aucun fichier selectionne';
  });
  importResults.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-import-action]');
    const row = event.target.closest('[data-import-line-id]');
    if (!actionEl || !row) return;
    const lineId = row.dataset.importLineId;
    const action = actionEl.dataset.importAction;
    if (action === 'confirm') confirmImportLine(lineId).catch((error) => showFeedback(error.message, 'error'));
    if (action === 'ignore') ignoreImportLine(lineId).catch((error) => showFeedback(error.message, 'error'));
    if (action === 'change') showArticleSearch(row);
    if (action === 'search') searchImportArticles(row).catch((error) => showFeedback(error.message, 'error'));
    if (action === 'select-article') selectImportArticle(lineId, actionEl.dataset.articleId).catch((error) => showFeedback(error.message, 'error'));
  });
  importResults.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !event.target.matches('[data-import-search-input]')) return;
    const row = event.target.closest('[data-import-line-id]');
    if (row) searchImportArticles(row).catch((error) => showFeedback(error.message, 'error'));
  });
  searchInput.addEventListener('input', renderLines);
  supplierFilter.addEventListener('change', renderLines);
  familyFilter.addEventListener('change', renderLines);
  linesBody.addEventListener('input', (event) => {
    const row = event.target.closest('[data-line-id]');
    if (row) markDirty(row.dataset.lineId);
  });
  linesBody.addEventListener('change', (event) => {
    const row = event.target.closest('[data-line-id]');
    if (row) markDirty(row.dataset.lineId);
  });
  linesBody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="delete"]');
    const row = event.target.closest('[data-line-id]');
    if (button && row) deleteLine(row.dataset.lineId).catch((error) => showFeedback(error.message, 'error'));
  });
}

async function init() {
  pricingDateInput.value = todayIso();
  bindEvents();
  await loadReferenceData();
  await loadSession(false);
}

init().catch((error) => showFeedback(error.message, 'error'));
