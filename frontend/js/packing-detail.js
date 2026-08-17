const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const sessionToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const sessionUserRaw = localStorage.getItem('gc_user') || localStorage.getItem('grv2_user');

if (!sessionToken || !sessionUserRaw) {
  window.location.href = './login.html';
}

const sessionUser = JSON.parse(sessionUserRaw);
const params = new URLSearchParams(window.location.search);
const operationId = params.get('id');

if (!operationId) window.location.href = './packing.html';

const els = {
  userName: document.getElementById('user-name'),
  backList: document.getElementById('back-list-btn'),
  backHome: document.getElementById('back-home-btn'),
  logout: document.getElementById('logout-btn'),
  title: document.getElementById('packing-title'),
  statusBadge: document.getElementById('status-badge'),
  operationHeading: document.getElementById('operation-heading'),
  operationSubtitle: document.getElementById('operation-subtitle'),
  draftActions: document.getElementById('draft-actions'),
  feedback: document.getElementById('detail-feedback'),
  packageCount: document.getElementById('package-count'),
  quantityPerPackage: document.getElementById('quantity-per-package'),
  targetWeight: document.getElementById('target-weight'),
  notes: document.getElementById('operation-notes'),
  outputArticleLine: document.getElementById('output-article-line'),
  costSummary: document.getElementById('cost-summary'),
  outputLotBox: document.getElementById('output-lot-box'),
  fishBalance: document.getElementById('fish-balance'),
  sourceTbody: document.getElementById('source-tbody'),
  materialsTbody: document.getElementById('materials-tbody'),
  save: document.getElementById('save-operation-btn'),
  validate: document.getElementById('validate-operation-btn'),
  cancel: document.getElementById('cancel-operation-btn'),
  addSource: document.getElementById('add-source-btn'),
  addMaterial: document.getElementById('add-material-btn'),
  lineModal: document.getElementById('line-modal'),
  lineModalTitle: document.getElementById('line-modal-title'),
  lineModalSubtitle: document.getElementById('line-modal-subtitle'),
  closeLineModal: document.getElementById('close-line-modal-btn'),
  lotSearch: document.getElementById('lot-search-input'),
  lineQuantity: document.getElementById('line-quantity-input'),
  lotSearchBtn: document.getElementById('lot-search-btn'),
  lotSearchHint: document.getElementById('lot-search-hint'),
  lineFeedback: document.getElementById('line-modal-feedback'),
  lotResultsTbody: document.getElementById('lot-results-tbody'),
  confirmModal: document.getElementById('confirm-modal'),
  confirmTitle: document.getElementById('confirm-title'),
  confirmText: document.getElementById('confirm-text'),
  confirmBody: document.getElementById('confirm-body'),
  closeConfirm: document.getElementById('close-confirm-btn'),
  confirmCancel: document.getElementById('confirm-cancel-btn'),
  confirmSubmit: document.getElementById('confirm-submit-btn'),
};

const state = {
  operation: null,
  lineMode: 'source',
  selectedLot: null,
  confirmAction: null,
};

const ERROR_MESSAGES = {
  PACKING_NOT_FOUND: 'Operation de colisage introuvable.',
  PACKING_NOT_DRAFT: 'Cette operation n est plus modifiable.',
  PACKING_ALREADY_VALIDATED: 'Cette operation a deja ete validee.',
  PACKING_SOURCE_STOCK_INSUFFICIENT: 'Stock poisson insuffisant pour valider le colisage.',
  PACKING_MATERIAL_STOCK_INSUFFICIENT: 'Stock emballage insuffisant pour valider le colisage.',
  PACKING_SOURCE_LOT_BLOCKED: 'Lot source bloque pour raison qualite.',
  PACKING_MATERIAL_LOT_BLOCKED: 'Lot emballage bloque pour raison qualite.',
  PACKING_INVALID_OUTPUT_QUANTITY: 'La somme des lots poisson doit correspondre au poids cible.',
  PACKING_OUTPUT_ARTICLE_INVALID: 'L article de sortie doit etre un produit.',
  PACKING_SOURCE_ARTICLE_INVALID: 'Le lot source doit etre un produit.',
  PACKING_MATERIAL_ARTICLE_INVALID: 'Le lot emballage doit etre un emballage.',
  PACKING_LINE_DUPLICATE: 'Ce lot est deja present dans l operation.',
};

function authHeaders(json = false) {
  const headers = { Authorization: `Bearer ${sessionToken}` };
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function logout() {
  ['gc_token', 'gc_user', 'gc_active_department', 'grv2_token', 'grv2_user', 'grv2_active_department'].forEach((key) => localStorage.removeItem(key));
  window.location.href = './login.html';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setFeedback(element, message = '', type = '') {
  element.textContent = message;
  element.className = 'page-feedback';
  if (!message) element.classList.add('hidden');
  if (type) element.classList.add(type);
}

function backendMessage(error) {
  return ERROR_MESSAGES[error.code] || error.message || 'Erreur colisage.';
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Erreur API colisage');
    error.code = data.code || null;
    error.details = data.details || null;
    throw error;
  }
  return data;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value, digits = 3) {
  return number(value).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatMoney(value, digits = 2) {
  return number(value).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('fr-FR');
}

function statusLabel(status) {
  if (status === 'validated') return 'VALIDE';
  if (status === 'cancelled') return 'ANNULE';
  return 'BROUILLON';
}

function isDraft() {
  return state.operation?.status === 'draft';
}

function lineArticleId(line) {
  return line.article_id || line.article?.id || '';
}

function renderSummary(operation) {
  const rows = [
    ['Poids total', `${formatNumber(operation.total_output_quantity)} kg`],
    ['Nombre de colis', formatNumber(operation.package_count, 0)],
    ['Poids par colis', `${formatNumber(operation.quantity_per_package)} kg`],
    ['Cout poisson', formatMoney(operation.fish_cost_ex_vat)],
    ['Cout emballages', formatMoney(operation.packaging_cost_ex_vat)],
    ['Cout total', formatMoney(operation.total_cost_ex_vat)],
    ['Prix de revient', `${formatMoney(operation.unit_cost_ex_vat, 4)} / kg`],
  ];
  els.costSummary.innerHTML = rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');

  if (operation.status === 'validated') {
    els.outputLotBox.classList.remove('hidden');
    els.outputLotBox.innerHTML = `
      <strong>Colisage valide</strong><br>
      Nouveau lot : ${escapeHtml(operation.output_lot_code || operation.output_lot_id || '-')}<br>
      Poids : ${formatNumber(operation.total_output_quantity)} kg<br>
      PR : ${formatMoney(operation.unit_cost_ex_vat, 4)} / kg<br>
      <a class="btn btn-secondary btn-sm" href="./stock.html">Voir dans Stock</a>
    `;
  } else {
    els.outputLotBox.classList.add('hidden');
    els.outputLotBox.innerHTML = '';
  }
}

function renderFishBalance(operation) {
  const target = number(operation.total_output_quantity);
  const selected = (operation.source_lots || []).reduce((sum, line) => sum + number(line.quantity_used), 0);
  const remaining = target - selected;
  const mode = Math.abs(remaining) <= 0.001 ? '' : (remaining > 0 ? 'warning' : 'error');
  els.fishBalance.innerHTML = `
    <span class="balance-pill">Poids cible : ${formatNumber(target)} kg</span>
    <span class="balance-pill">Poids poisson selectionne : ${formatNumber(selected)} kg</span>
    <span class="balance-pill ${mode}">Reste a selectionner : ${formatNumber(remaining)} kg</span>
  `;
}

function renderSources(operation) {
  const rows = operation.source_lots || [];
  if (!rows.length) {
    els.sourceTbody.innerHTML = '<tr><td colspan="8">Aucun lot source.</td></tr>';
    return;
  }
  els.sourceTbody.innerHTML = rows.map((line) => {
    const differentArticle = lineArticleId(line) && lineArticleId(line) !== operation.output_article_id;
    return `
      <tr>
        <td><strong>${escapeHtml(line.article_plu || '-')}</strong><br>${escapeHtml(line.article_designation || '-')}</td>
        <td>${escapeHtml(line.lot_code || '-')}<br><span class="stock-muted">${escapeHtml(line.supplier_lot_number || '')}</span></td>
        <td>${formatNumber(line.qty_remaining)} ${escapeHtml(line.unit || 'kg')}</td>
        <td class="numeric">${formatNumber(line.quantity_used)} kg</td>
        <td class="numeric">${formatMoney(line.unit_cost_ex_vat, 4)}</td>
        <td class="numeric">${formatMoney(line.line_cost_ex_vat)}</td>
        <td>${differentArticle ? '<span class="article-warning">Article source different de l article de sortie</span>' : ''}</td>
        <td>${isDraft() ? `<button class="btn btn-danger btn-sm" data-action="delete-source" data-id="${escapeHtml(line.id)}">Supprimer</button>` : '-'}</td>
      </tr>
    `;
  }).join('');
}

function renderMaterials(operation) {
  const rows = operation.materials || [];
  if (!rows.length) {
    els.materialsTbody.innerHTML = '<tr><td colspan="7">Aucun emballage.</td></tr>';
    return;
  }
  els.materialsTbody.innerHTML = rows.map((line) => `
    <tr>
      <td><strong>${escapeHtml(line.article_plu || '-')}</strong><br>${escapeHtml(line.article_designation || '-')}</td>
      <td>${escapeHtml(line.lot_code || '-')}<br><span class="stock-muted">${escapeHtml(line.supplier_lot_number || '')}</span></td>
      <td class="numeric">${formatNumber(line.quantity_used)}</td>
      <td>${escapeHtml(line.unit || '')}</td>
      <td class="numeric">${formatMoney(line.unit_cost_ex_vat, 4)}</td>
      <td class="numeric">${formatMoney(line.line_cost_ex_vat)}</td>
      <td>${isDraft() ? `<button class="btn btn-danger btn-sm" data-action="delete-material" data-id="${escapeHtml(line.id)}">Supprimer</button>` : '-'}</td>
    </tr>
  `).join('');
}

function renderOperation(operation) {
  state.operation = operation;
  const readonly = operation.status !== 'draft';
  document.body.classList.toggle('readonly', readonly);
  els.statusBadge.className = `packing-badge ${operation.status}`;
  els.statusBadge.textContent = statusLabel(operation.status);
  els.title.textContent = `${operation.output_article_plu || ''} ${operation.output_article_designation || 'Colisage'}`;
  els.operationHeading.textContent = `${operation.output_article_plu || '-'} - ${operation.output_article_designation || '-'}`;
  els.operationSubtitle.textContent = `Operation ${operation.id}`;
  els.outputArticleLine.textContent = `${operation.output_article_plu || '-'} - ${operation.output_article_designation || '-'}`;
  els.packageCount.value = Math.trunc(number(operation.package_count)) || '';
  els.quantityPerPackage.value = number(operation.quantity_per_package) || '';
  els.notes.value = operation.notes || '';
  els.targetWeight.textContent = `${formatNumber(operation.total_output_quantity)} kg`;
  els.draftActions.classList.toggle('hidden', readonly);
  els.addSource.classList.toggle('hidden', readonly);
  els.addMaterial.classList.toggle('hidden', readonly);
  [els.packageCount, els.quantityPerPackage, els.notes].forEach((input) => { input.disabled = readonly; });
  renderSummary(operation);
  renderFishBalance(operation);
  renderSources(operation);
  renderMaterials(operation);
}

async function loadOperation() {
  try {
    setFeedback(els.feedback, 'Chargement...', '');
    const operation = await api(`/api/packing/${encodeURIComponent(operationId)}`);
    renderOperation(operation);
    setFeedback(els.feedback, '', '');
  } catch (error) {
    console.error(error);
    setFeedback(els.feedback, backendMessage(error), 'error');
  }
}

async function saveDraft() {
  try {
    const packageCount = Number(els.packageCount.value);
    if (!Number.isInteger(packageCount) || packageCount <= 0) throw new Error('Le nombre de colis doit etre entier.');
    await api(`/api/packing/${encodeURIComponent(operationId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        package_count: packageCount,
        quantity_per_package: Number(els.quantityPerPackage.value),
        notes: els.notes.value.trim() || null,
      }),
    });
    setFeedback(els.feedback, 'Operation enregistree.', 'success');
    await loadOperation();
  } catch (error) {
    console.error(error);
    setFeedback(els.feedback, backendMessage(error), 'error');
  }
}

function openLineModal(mode) {
  state.lineMode = mode;
  state.selectedLot = null;
  els.lineModalTitle.textContent = mode === 'source' ? 'Ajouter un lot poisson source' : 'Ajouter un emballage';
  els.lineModalSubtitle.textContent = mode === 'source'
    ? 'F9 : afficher les lots produit disponibles.'
    : 'F9 : afficher les emballages en stock.';
  els.lotSearchHint.textContent = mode === 'source' ? 'F9 : afficher les lots' : 'F9 : afficher les emballages';
  els.lotSearch.value = '';
  els.lineQuantity.value = mode === 'material' ? Math.trunc(number(state.operation.package_count)) || '' : '';
  els.lotResultsTbody.innerHTML = '<tr><td colspan="9">Rechercher ou appuyer sur F9.</td></tr>';
  setFeedback(els.lineFeedback, '', '');
  els.lineModal.classList.remove('hidden');
  els.lotSearch.focus();
}

function closeLineModal() {
  els.lineModal.classList.add('hidden');
}

async function searchLots({ showAll = false } = {}) {
  try {
    const params = new URLSearchParams();
    params.set('article_category', state.lineMode === 'source' ? 'product' : 'packaging');
    params.set('available_only', 'true');
    params.set('exclude_blocked_quality', 'true');
    params.set('limit', '100');
    const query = els.lotSearch.value.trim();
    if (!showAll && query) params.set('search', query);
    const rows = await api(`/api/stock/lots?${params.toString()}`);
    const filtered = rows
      .filter((lot) => lot.quality_status !== 'blocked')
      .sort((a, b) => {
        if (state.lineMode !== 'source') return 0;
        const aSame = a.article_id === state.operation.output_article_id ? 0 : 1;
        const bSame = b.article_id === state.operation.output_article_id ? 0 : 1;
        return aSame - bSame;
      });
    renderLotResults(filtered);
  } catch (error) {
    console.error(error);
    setFeedback(els.lineFeedback, backendMessage(error), 'error');
  }
}

function renderLotResults(rows) {
  if (!rows.length) {
    els.lotResultsTbody.innerHTML = '<tr><td colspan="9">Aucun lot disponible.</td></tr>';
    return;
  }
  els.lotResultsTbody.innerHTML = rows.map((lot) => {
    const differentArticle = state.lineMode === 'source' && lot.article_id !== state.operation.output_article_id;
    return `
      <tr data-lot-id="${escapeHtml(lot.id)}">
        <td>${escapeHtml(lot.plu || '-')}</td>
        <td><strong>${escapeHtml(lot.designation || '-')}</strong>${differentArticle ? '<span class="article-warning">Article different</span>' : ''}</td>
        <td>${escapeHtml(lot.lot_code || '-')}</td>
        <td>${escapeHtml(lot.supplier_lot_number || '-')}</td>
        <td>${escapeHtml(lot.supplier_name || '-')}</td>
        <td class="numeric">${formatNumber(lot.qty_remaining)} ${escapeHtml(lot.unit || '')}</td>
        <td class="numeric">${formatMoney(lot.unit_cost_ex_vat, 4)}</td>
        <td>${formatDate(lot.dlc)}</td>
        <td><button class="btn btn-primary btn-sm" data-action="choose-lot" data-id="${escapeHtml(lot.id)}">Choisir</button></td>
      </tr>
    `;
  }).join('');
}

async function addSelectedLot(lotId) {
  try {
    const quantity = Number(els.lineQuantity.value);
    if (!quantity || quantity <= 0) throw new Error('Saisir une quantite utilisee.');
    const path = state.lineMode === 'source'
      ? `/api/packing/${encodeURIComponent(operationId)}/source-lots`
      : `/api/packing/${encodeURIComponent(operationId)}/materials`;
    await api(path, {
      method: 'POST',
      body: JSON.stringify({ lot_id: lotId, quantity_used: quantity }),
    });
    closeLineModal();
    await loadOperation();
  } catch (error) {
    console.error(error);
    setFeedback(els.lineFeedback, backendMessage(error), 'error');
  }
}

async function deleteLine(type, lineId) {
  try {
    const path = type === 'source'
      ? `/api/packing/${encodeURIComponent(operationId)}/source-lots/${encodeURIComponent(lineId)}`
      : `/api/packing/${encodeURIComponent(operationId)}/materials/${encodeURIComponent(lineId)}`;
    await api(path, { method: 'DELETE' });
    await loadOperation();
  } catch (error) {
    console.error(error);
    setFeedback(els.feedback, backendMessage(error), 'error');
  }
}

function openConfirm({ title, text, body, submitLabel, action }) {
  els.confirmTitle.textContent = title;
  els.confirmText.textContent = text;
  els.confirmBody.innerHTML = body;
  els.confirmSubmit.textContent = submitLabel;
  state.confirmAction = action;
  els.confirmModal.classList.remove('hidden');
}

function closeConfirm() {
  els.confirmModal.classList.add('hidden');
  state.confirmAction = null;
}

function validationBody() {
  const op = state.operation;
  return `
    <div><span>Article</span><strong>${escapeHtml(op.output_article_plu || '-')} ${escapeHtml(op.output_article_designation || '')}</strong></div>
    <div><span>Poids</span><strong>${formatNumber(op.total_output_quantity)} kg</strong></div>
    <div><span>Colis</span><strong>${formatNumber(op.package_count, 0)} x ${formatNumber(op.quantity_per_package)} kg</strong></div>
    <div><span>Lots consommes</span><strong>${(op.source_lots || []).length}</strong></div>
    <div><span>Emballages</span><strong>${(op.materials || []).length}</strong></div>
    <div><span>Cout total</span><strong>${formatMoney(op.total_cost_ex_vat)}</strong></div>
    <div><span>PR</span><strong>${formatMoney(op.unit_cost_ex_vat, 4)} / kg</strong></div>
  `;
}

function askValidate() {
  openConfirm({
    title: 'Valider le colisage',
    text: 'Cette validation va decrementer les lots source et les emballages puis creer un nouveau lot global.',
    body: validationBody(),
    submitLabel: 'Confirmer la validation',
    action: async () => {
      await api(`/api/packing/${encodeURIComponent(operationId)}/validate`, { method: 'POST' });
      closeConfirm();
      setFeedback(els.feedback, 'Colisage valide.', 'success');
      await loadOperation();
    },
  });
}

function askCancel() {
  openConfirm({
    title: 'Annuler le brouillon',
    text: 'Annuler ce brouillon de colisage ?',
    body: '<div><span>Aucun mouvement stock</span><strong>ne sera cree</strong></div>',
    submitLabel: 'Annuler l operation',
    action: async () => {
      await api(`/api/packing/${encodeURIComponent(operationId)}/cancel`, { method: 'POST' });
      closeConfirm();
      setFeedback(els.feedback, 'Brouillon annule.', 'success');
      await loadOperation();
    },
  });
}

els.userName.textContent = sessionUser.email || 'Utilisateur';
els.backList.addEventListener('click', () => { window.location.href = './packing.html'; });
els.backHome.addEventListener('click', () => { window.location.href = './home.html'; });
els.logout.addEventListener('click', logout);
els.save.addEventListener('click', saveDraft);
els.validate.addEventListener('click', askValidate);
els.cancel.addEventListener('click', askCancel);
els.addSource.addEventListener('click', () => openLineModal('source'));
els.addMaterial.addEventListener('click', () => openLineModal('material'));
els.closeLineModal.addEventListener('click', closeLineModal);
els.lotSearchBtn.addEventListener('click', () => searchLots());
els.closeConfirm.addEventListener('click', closeConfirm);
els.confirmCancel.addEventListener('click', closeConfirm);
els.confirmSubmit.addEventListener('click', async () => {
  if (!state.confirmAction) return;
  try {
    await state.confirmAction();
  } catch (error) {
    console.error(error);
    setFeedback(els.feedback, backendMessage(error), 'error');
    closeConfirm();
  }
});

els.lotSearch.addEventListener('keydown', (event) => {
  if (event.key === 'F9') {
    event.preventDefault();
    searchLots({ showAll: true });
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    searchLots();
  }
});

els.lotResultsTbody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="choose-lot"]');
  if (button) addSelectedLot(button.dataset.id);
});

els.sourceTbody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="delete-source"]');
  if (button) deleteLine('source', button.dataset.id);
});

els.materialsTbody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="delete-material"]');
  if (button) deleteLine('material', button.dataset.id);
});

loadOperation();
