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
const refreshStockBtn = document.getElementById('refresh-stock-btn');
const stockSearchBtn = document.getElementById('stock-search-btn');
const stockSearchInput = document.getElementById('stock-search-input');
const stockFamilyFilter = document.getElementById('stock-family-filter');
const stockAvailableFilter = document.getElementById('stock-available-filter');
const stockFeedback = document.getElementById('stock-feedback');
const stockTbody = document.getElementById('stock-tbody');
const stockCategoryTabs = Array.from(document.querySelectorAll('.stock-tab'));
const stockActionsHeading = document.getElementById('stock-actions-heading');
const marginLevel1Input = document.getElementById('margin-level-1');
const marginLevel2Input = document.getElementById('margin-level-2');
const marginLevel3Input = document.getElementById('margin-level-3');
const prefillPricesBtn = document.getElementById('prefill-prices-btn');
const savePrefilledPricesBtn = document.getElementById('save-prefilled-prices-btn');

const kpiArticles = document.getElementById('kpi-articles');
const kpiQuantity = document.getElementById('kpi-quantity');
const kpiValue = document.getElementById('kpi-value');
const kpiDlc = document.getElementById('kpi-dlc');

const lotModal = document.getElementById('lot-modal');
const closeLotModalBtn = document.getElementById('close-lot-modal-btn');
const lotModalTitle = document.getElementById('lot-modal-title');
const lotModalSubtitle = document.getElementById('lot-modal-subtitle');
const lotFeedback = document.getElementById('lot-feedback');
const lotsTbody = document.getElementById('lots-tbody');
const manualOutHistoryTbody = document.getElementById('manual-out-history-tbody');

const manualOutModal = document.getElementById('manual-stock-out-modal');
const closeManualOutModalBtn = document.getElementById('close-manual-stock-out-modal-btn');
const manualOutForm = document.getElementById('manual-stock-out-form');
const manualOutArticle = document.getElementById('manual-stock-out-article');
const manualOutLotSelect = document.getElementById('manual-stock-out-lot');
const manualOutAvailable = document.getElementById('manual-stock-out-available');
const manualOutQuantity = document.getElementById('manual-stock-out-quantity');
const manualOutUnit = document.getElementById('manual-stock-out-unit');
const manualOutReason = document.getElementById('manual-stock-out-reason');
const manualOutDate = document.getElementById('manual-stock-out-date');
const manualOutComment = document.getElementById('manual-stock-out-comment');
const manualOutFeedback = document.getElementById('manual-stock-out-feedback');
const submitManualOutBtn = document.getElementById('submit-manual-stock-out-btn');

let stockRows = [];
let activeStockCategory = 'product';
let activeLotsArticleId = null;
let manualOutLots = [];
let manualOutArticleRow = null;
let manualOutReasons = [
  { code: 'waste', label: 'Casse / perte' },
  { code: 'unfit', label: 'Produit impropre' },
  { code: 'destruction', label: 'Destruction' },
  { code: 'inventory_adjustment', label: 'Ecart inventaire' },
  { code: 'internal_use', label: 'Consommation interne' },
  { code: 'supplier_return', label: 'Retour fournisseur' },
  { code: 'other', label: 'Autre' },
];

function authHeaders(json = false) {
  const headers = {
    Authorization: `Bearer ${sessionToken}`,
  };
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

function showFeedback(el, message = '', type = '') {
  if (!el) return;
  el.textContent = message;
  el.className = 'page-feedback';
  if (!message) el.classList.add('hidden');
  if (type) el.classList.add(type);
}

function normalizeArticleId(value) {
  const id = String(value ?? '').trim();
  if (!id || id === 'undefined' || id === 'null') return '';
  return id;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value || '')
  );
}

function warnInvalidArticleId(context, details = {}) {
  const articleId = normalizeArticleId(details.articleId);
  console.warn('[Stock] ID article invalide cote interface', {
    context,
    ...details,
    articleId,
    articleIdLength: articleId.length,
  });
}

function validateArticleId(articleId, context, details = {}) {
  if (isUuid(articleId)) return true;
  showFeedback(stockFeedback, 'ID article invalide cote interface.', 'error');
  warnInvalidArticleId(context, { articleId, ...details });
  return false;
}

function getFifoDlc(row) {
  return row.next_lot_dlc || row.next_dlc;
}

function isPackagingView() {
  return activeStockCategory === 'packaging';
}

function formatNumber(value, digits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0,00 EUR';
  return number.toLocaleString('fr-FR', {
    style: 'currency',
    currency: 'EUR',
  });
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('fr-FR');
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function parseDecimal(value) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parsePriceInput(value) {
  const parsed = parseDecimal(value);
  if (parsed === null) return null;
  return parsed >= 0 ? parsed : NaN;
}

function parseMarginInput(input) {
  const parsed = parseDecimal(input.value);
  if (parsed === null) return null;
  return parsed >= 0 && parsed < 100 ? parsed : NaN;
}

function formatPriceInput(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : '';
}

function marginText(price, pma) {
  const salePrice = Number(price);
  const cost = Number(pma || 0);
  if (!Number.isFinite(salePrice) || salePrice <= 0) return '';
  const amount = salePrice - cost;
  const rate = (amount / salePrice) * 100;
  return `${formatMoney(amount)} / ${rate.toFixed(1).replace('.', ',')} %`;
}

function priceFromMargin(pma, margin) {
  const cost = Number(pma || 0);
  const rate = Number(margin);
  if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(rate) || rate < 0 || rate >= 100) return null;
  return cost / (1 - rate / 100);
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: authHeaders(false),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur API stock');
  return data;
}

async function apiPatch(path, payload) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PATCH',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur sauvegarde tarifs');
  return data;
}

async function apiPost(path, payload) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur action stock');
  return data;
}

function updateKpis(rows) {
  const totalQuantity = rows.reduce((sum, row) => sum + Number(row.stock_quantity || 0), 0);
  const totalValue = rows.reduce((sum, row) => sum + Number(row.stock_value_ex_vat || 0), 0);
  const dlcs = rows
    .map(getFifoDlc)
    .filter(Boolean)
    .sort((a, b) => new Date(a) - new Date(b));

  kpiArticles.textContent = String(rows.length);
  kpiQuantity.textContent = formatNumber(totalQuantity);
  kpiValue.textContent = formatMoney(totalValue);
  kpiDlc.textContent = isPackagingView() ? '-' : (dlcs.length ? formatDate(dlcs[0]) : '-');
}

function tariffCell(row, level) {
  const field = `sale_price_level_${level}_ht`;
  return `
    <input
      class="tariff-input"
      type="number"
      min="0"
      step="0.01"
      data-level="${level}"
      value="${escapeHtml(formatPriceInput(row[field]))}"
      aria-label="Tarif ${level} HT ${escapeHtml(row.designation)}"
    />
  `;
}

function renderStock(rows) {
  if (!rows.length) {
    stockTbody.innerHTML = '<tr><td colspan="13">Aucun stock trouve.</td></tr>';
    updateKpis([]);
    return;
  }

  stockTbody.innerHTML = rows.map((row) => {
    const articleId = row.article_id;
    const cleanArticleId = normalizeArticleId(articleId);
    const hasValidArticleId = isUuid(cleanArticleId);
    const actionsDisabled = hasValidArticleId ? '' : 'disabled';

    if (!hasValidArticleId) {
      warnInvalidArticleId('renderStock', { articleId, row });
    }

    return `
      <tr data-article-id="${escapeHtml(cleanArticleId)}" data-pma="${escapeHtml(row.pma || 0)}">
        <td>${escapeHtml(row.plu)}</td>
        <td><strong>${escapeHtml(row.designation)}</strong></td>
        <td>${formatNumber(row.stock_quantity)} ${escapeHtml(row.unit || '')}</td>
        <td>${formatMoney(row.pma)}</td>
        <td>${tariffCell(row, 1)}</td>
        <td class="margin-cell" data-margin-level="1">${marginText(row.sale_price_level_1_ht, row.pma)}</td>
        <td>${tariffCell(row, 2)}</td>
        <td class="margin-cell" data-margin-level="2">${marginText(row.sale_price_level_2_ht, row.pma)}</td>
        <td>${tariffCell(row, 3)}</td>
        <td class="margin-cell" data-margin-level="3">${marginText(row.sale_price_level_3_ht, row.pma)}</td>
        <td class="stock-dlc-column">${isPackagingView() ? '-' : formatDate(getFifoDlc(row))}</td>
        <td>${formatMoney(row.stock_value_ex_vat)}</td>
        <td>
          <div class="stock-actions">
            <button class="btn btn-secondary btn-sm" data-action="lots" data-article-id="${escapeHtml(cleanArticleId)}" ${actionsDisabled}>Lots</button>
            <button class="btn btn-danger btn-sm" data-action="manual-out" data-article-id="${escapeHtml(cleanArticleId)}" ${actionsDisabled}>Sortie</button>
            <button class="btn btn-primary btn-sm" data-action="save-prices" data-article-id="${escapeHtml(cleanArticleId)}" ${actionsDisabled}>Enregistrer</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  updateKpis(rows);
}

function updateRowMargins(rowEl) {
  const pma = Number(rowEl.dataset.pma || 0);
  rowEl.querySelectorAll('.tariff-input').forEach((input) => {
    const marginEl = rowEl.querySelector(`[data-margin-level="${input.dataset.level}"]`);
    const price = parsePriceInput(input.value);
    marginEl.textContent = Number.isNaN(price) ? 'Prix invalide' : marginText(price, pma);
    marginEl.classList.toggle('error-text', Number.isNaN(price));
  });
}

function parseMovementNotes(notes) {
  try {
    const parsed = JSON.parse(notes || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return { comment: notes || '' };
  }
}

function manualOutReasonLabel(codeOrType) {
  const reason = manualOutReasons.find((entry) => entry.code === codeOrType || entry.movement_type === codeOrType);
  if (reason) return reason.label;
  if (window.stockMovementLabel) return window.stockMovementLabel(codeOrType);
  return codeOrType || '-';
}

function renderManualOutReasons() {
  manualOutReason.innerHTML = manualOutReasons.map((reason) => `
    <option value="${escapeHtml(reason.code)}">${escapeHtml(reason.label)}</option>
  `).join('');
}

async function loadManualOutReasons() {
  try {
    const data = await apiGet('/api/stock/manual-outs/reasons');
    if (Array.isArray(data.reasons) && data.reasons.length) {
      manualOutReasons = data.reasons;
      renderManualOutReasons();
    }
  } catch (error) {
    console.error(error);
  }
}

function setManualOutLotDetails() {
  const lot = manualOutLots.find((entry) => String(entry.id) === String(manualOutLotSelect.value));
  const unit = lot?.unit || manualOutArticleRow?.unit || '';
  manualOutUnit.value = unit;
  manualOutAvailable.textContent = lot
    ? `Disponible : ${formatNumber(lot.qty_remaining)} ${unit} - lot ${lot.lot_code || '-'}`
    : 'Disponible : -';
  if (lot) manualOutQuantity.max = String(lot.qty_remaining);
}

async function openManualOutModal(articleId, selectedLotId = null) {
  const cleanArticleId = normalizeArticleId(articleId);
  if (!validateArticleId(cleanArticleId, 'openManualOutModal', { selectedLotId })) return;

  manualOutArticleRow = stockRows.find((row) => String(row.article_id) === String(cleanArticleId)) || null;
  showFeedback(manualOutFeedback, '');
  manualOutForm.reset();
  manualOutDate.value = todayInputValue();
  manualOutQuantity.value = '';
  manualOutArticle.textContent = manualOutArticleRow
    ? `${manualOutArticleRow.plu || ''} - ${manualOutArticleRow.designation || 'Article'}`
    : 'Article';
  manualOutLotSelect.innerHTML = '<option value="">Chargement des lots...</option>';
  manualOutModal.classList.remove('hidden');

  try {
    manualOutLots = await apiGet(`/api/stock/articles/${encodeURIComponent(cleanArticleId)}/lots?available_only=true`);
    if (!manualOutLots.length) {
      manualOutLotSelect.innerHTML = '<option value="">Aucun lot disponible</option>';
      showFeedback(manualOutFeedback, 'Aucun lot disponible pour cet article.', 'error');
      return;
    }
    manualOutLotSelect.innerHTML = manualOutLots.map((lot) => `
      <option value="${escapeHtml(lot.id)}">
        ${escapeHtml(lot.lot_code || lot.id)} - ${formatNumber(lot.qty_remaining)} ${escapeHtml(lot.unit || manualOutArticleRow?.unit || '')}
      </option>
    `).join('');
    manualOutLotSelect.value = selectedLotId && manualOutLots.some((lot) => String(lot.id) === String(selectedLotId))
      ? String(selectedLotId)
      : String(manualOutLots[0].id);
    setManualOutLotDetails();
  } catch (error) {
    console.error(error);
    showFeedback(manualOutFeedback, error.message, 'error');
    manualOutLotSelect.innerHTML = '<option value="">Erreur lots</option>';
  }
}

function closeManualOutModal() {
  manualOutModal.classList.add('hidden');
  showFeedback(manualOutFeedback, '');
}

async function submitManualStockOut(event) {
  event.preventDefault();
  const lot = manualOutLots.find((entry) => String(entry.id) === String(manualOutLotSelect.value));
  if (!lot || !manualOutArticleRow) {
    showFeedback(manualOutFeedback, 'Selectionne un lot disponible.', 'error');
    return;
  }

  const quantity = parseDecimal(manualOutQuantity.value);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    showFeedback(manualOutFeedback, 'La quantite doit etre strictement positive.', 'error');
    return;
  }
  if (quantity > Number(lot.qty_remaining || 0)) {
    showFeedback(manualOutFeedback, `Quantite superieure au disponible du lot (${formatNumber(lot.qty_remaining)} ${lot.unit || ''}).`, 'error');
    return;
  }

  submitManualOutBtn.disabled = true;
  showFeedback(manualOutFeedback, 'Validation de la sortie...');
  try {
    const requestId = window.crypto?.randomUUID ? window.crypto.randomUUID() : null;
    const result = await apiPost('/api/stock/manual-outs', {
      request_id: requestId,
      article_id: manualOutArticleRow.article_id,
      lot_id: lot.id,
      quantity,
      reason: manualOutReason.value,
      date: manualOutDate.value,
      comment: manualOutComment.value,
    });
    const newQty = Number(result.lot?.qty_remaining ?? (Number(lot.qty_remaining || 0) - quantity));
    showFeedback(manualOutFeedback, `${formatNumber(quantity)} ${lot.unit || ''} sortis du stock. Nouveau stock disponible : ${formatNumber(newQty)} ${lot.unit || ''}.`, 'success');
    if (result.warning) showFeedback(stockFeedback, result.warning, 'warning');
    await loadStock();
    if (activeLotsArticleId) await openLotsModal(activeLotsArticleId, { refreshOnly: true });
  } catch (error) {
    console.error(error);
    showFeedback(manualOutFeedback, error.message, 'error');
  } finally {
    submitManualOutBtn.disabled = false;
  }
}

async function savePrices(rowEl, options = {}) {
  const articleId = normalizeArticleId(rowEl.dataset.articleId);
  const inputs = Array.from(rowEl.querySelectorAll('.tariff-input'));
  const values = inputs.map((input) => parsePriceInput(input.value));

  if (!validateArticleId(articleId, 'savePrices', { rowEl, button: options.button })) {
    return false;
  }

  if (values.some((value) => Number.isNaN(value))) {
    showFeedback(stockFeedback, 'Un tarif doit etre positif ou vide.', 'error');
    return false;
  }

  const button = rowEl.querySelector('[data-action="save-prices"]');
  if (button) button.disabled = true;

  try {
    const result = await apiPatch(`/api/stock/articles/${encodeURIComponent(articleId)}/prices`, {
      sale_price_level_1_ht: values[0],
      sale_price_level_2_ht: values[1],
      sale_price_level_3_ht: values[2],
    });

    const index = stockRows.findIndex((row) => String(row.article_id) === String(articleId));
    if (index >= 0) {
      stockRows[index] = {
        ...stockRows[index],
        sale_price_level_1_ht: result.prices.sale_price_level_1_ht,
        sale_price_level_2_ht: result.prices.sale_price_level_2_ht,
        sale_price_level_3_ht: result.prices.sale_price_level_3_ht,
      };
    }

    inputs.forEach((input, i) => {
      input.value = formatPriceInput(values[i]);
      delete input.dataset.prefilled;
    });
    delete rowEl.dataset.prefilled;
    updateRowMargins(rowEl);
    if (!options.silent) showFeedback(stockFeedback, 'Tarifs enregistres.', 'success');
    return true;
  } catch (error) {
    console.error(error);
    if (!options.silent) showFeedback(stockFeedback, error.message, 'error');
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

function prefillPricesFromMargins() {
  const margins = [marginLevel1Input, marginLevel2Input, marginLevel3Input].map(parseMarginInput);

  if (margins.some((margin) => Number.isNaN(margin))) {
    showFeedback(stockFeedback, 'Les marges doivent etre comprises entre 0 et 99,99 %.', 'error');
    return;
  }

  if (margins.every((margin) => margin === null)) {
    showFeedback(stockFeedback, 'Renseigne au moins une marge a pre-remplir.', 'error');
    return;
  }

  let filledCount = 0;
  stockTbody.querySelectorAll('tr[data-article-id]').forEach((rowEl) => {
    const pma = Number(rowEl.dataset.pma || 0);
    if (!Number.isFinite(pma) || pma <= 0) return;

    margins.forEach((margin, index) => {
      if (margin === null) return;
      const level = index + 1;
      const input = rowEl.querySelector(`.tariff-input[data-level="${level}"]`);
      if (!input || input.value.trim()) return;

      const price = priceFromMargin(pma, margin);
      if (price === null) return;

      input.value = formatPriceInput(price);
      input.dataset.prefilled = 'true';
      rowEl.dataset.prefilled = 'true';
      filledCount += 1;
    });

    updateRowMargins(rowEl);
  });

  if (filledCount === 0) {
    showFeedback(stockFeedback, 'Aucun tarif vide avec PMA positif a pre-remplir.', 'error');
    return;
  }

  showFeedback(stockFeedback, `${filledCount} tarif(s) pre-rempli(s). Verifie puis enregistre.`, 'success');
}

async function savePrefilledPrices() {
  const rows = Array.from(stockTbody.querySelectorAll('tr[data-prefilled="true"]'));
  if (!rows.length) {
    showFeedback(stockFeedback, 'Aucun tarif pre-rempli a enregistrer.', 'error');
    return;
  }

  savePrefilledPricesBtn.disabled = true;
  showFeedback(stockFeedback, 'Enregistrement des tarifs pre-remplis...');

  let successCount = 0;
  for (const rowEl of rows) {
    const saved = await savePrices(rowEl, { silent: true });
    if (saved) successCount += 1;
  }

  savePrefilledPricesBtn.disabled = false;
  if (successCount === rows.length) {
    showFeedback(stockFeedback, `${successCount} ligne(s) enregistree(s).`, 'success');
  } else {
    showFeedback(stockFeedback, `${successCount}/${rows.length} ligne(s) enregistree(s). Certaines lignes sont a verifier.`, 'error');
  }
}

function warnInvalidStockRows(rows) {
  rows.forEach((row) => {
    const articleId = row.article_id;
    if (!isUuid(normalizeArticleId(articleId))) {
      warnInvalidArticleId('GET /api/stock', {
        articleId,
        rowId: row.id,
        stockSummaryId: row.id,
        row,
      });
    }
  });
}

async function loadStock() {
  try {
    showFeedback(stockFeedback, 'Chargement du stock...');
    stockTbody.innerHTML = '<tr><td colspan="13">Chargement du stock...</td></tr>';

    const params = new URLSearchParams();
    params.set('available_only', stockAvailableFilter.value || 'true');
    params.set('article_category', activeStockCategory);
    params.set('limit', '500');

    if (stockSearchInput.value.trim()) params.set('search', stockSearchInput.value.trim());
    if (stockFamilyFilter.value.trim()) params.set('family', stockFamilyFilter.value.trim());

    stockRows = await apiGet(`/api/stock?${params.toString()}`);
    warnInvalidStockRows(stockRows);
    renderStock(stockRows);
    showFeedback(stockFeedback, `${stockRows.length} ${isPackagingView() ? 'emballage(s)' : 'produit(s)'} charge(s).`, 'success');
  } catch (error) {
    console.error(error);
    showFeedback(stockFeedback, error.message, 'error');
    stockTbody.innerHTML = '<tr><td colspan="13">Erreur de chargement.</td></tr>';
    updateKpis([]);
  }
}

async function loadManualOutHistory(articleId) {
  if (!manualOutHistoryTbody) return;
  manualOutHistoryTbody.innerHTML = '<tr><td colspan="7">Chargement...</td></tr>';
  try {
    const movements = await apiGet(`/api/stock/manual-outs?article_id=${encodeURIComponent(articleId)}&limit=20`);
    if (!movements.length) {
      manualOutHistoryTbody.innerHTML = '<tr><td colspan="7">Aucune sortie manuelle recente.</td></tr>';
      return;
    }
    manualOutHistoryTbody.innerHTML = movements.map((movement) => {
      const notes = parseMovementNotes(movement.notes);
      const cancelled = Boolean(movement.cancellation_movement_id);
      return `
        <tr data-movement-id="${escapeHtml(movement.id)}">
          <td>${formatDate(movement.created_at)}</td>
          <td>${escapeHtml(movement.lot_code || movement.supplier_lot_number || '-')}</td>
          <td>${escapeHtml(notes.reason_label || manualOutReasonLabel(notes.reason_code || movement.movement_type))}</td>
          <td>${formatNumber(Math.abs(Number(movement.quantity || 0)))} ${escapeHtml(movement.unit || '')}</td>
          <td>${escapeHtml(notes.comment || '')}</td>
          <td>${escapeHtml(movement.created_by_email || movement.created_by || '-')}</td>
          <td>
            ${cancelled
              ? '<span class="stock-muted">Annulee</span>'
              : '<button class="btn btn-secondary btn-sm" type="button" data-action="cancel-manual-out">Annuler</button>'}
          </td>
        </tr>
      `;
    }).join('');
  } catch (error) {
    console.error(error);
    manualOutHistoryTbody.innerHTML = '<tr><td colspan="7">Erreur historique sorties.</td></tr>';
  }
}

async function cancelManualOut(movementId) {
  const confirmed = window.confirm('Annuler cette sortie de stock et creer un mouvement inverse ?');
  if (!confirmed) return;
  try {
    await apiPost(`/api/stock/manual-outs/${encodeURIComponent(movementId)}/cancel`, {
      comment: 'Annulation depuis module stock',
    });
    showFeedback(lotFeedback, 'Sortie annulee, stock restaure.', 'success');
    await loadStock();
    if (activeLotsArticleId) await openLotsModal(activeLotsArticleId, { refreshOnly: true });
  } catch (error) {
    console.error(error);
    showFeedback(lotFeedback, error.message, 'error');
  }
}

function renderLots(lots) {
  if (!lots.length) {
    lotsTbody.innerHTML = `<tr><td colspan="${isPackagingView() ? 6 : 13}">Aucun lot disponible.</td></tr>`;
    return;
  }

  lotsTbody.innerHTML = lots.map((lot) => `
    <tr>
      <td>${lot.fifo_rank || '-'}</td>
      <td>
        <strong>${escapeHtml(lot.lot_code)}</strong>
        <span class="stock-muted">${escapeHtml(lot.supplier_lot_number || '')}</span>
      </td>
      <td>${escapeHtml(lot.supplier_name || lot.supplier_code || '-')}</td>
      <td>${formatNumber(lot.qty_remaining)} / ${formatNumber(lot.qty_initial)} ${escapeHtml(lot.unit || '')}</td>
      <td>${formatMoney(lot.unit_cost_ex_vat)}</td>
      ${isPackagingView() ? '' : `
        <td class="lot-sanitary-column">${formatDate(lot.dlc)}</td>
        <td class="lot-sanitary-column">${escapeHtml(lot.latin_name || '-')}</td>
        <td class="lot-sanitary-column">${escapeHtml(lot.fao_zone || '-')}</td>
        <td class="lot-sanitary-column">${escapeHtml(lot.sous_zone || '-')}</td>
        <td class="lot-sanitary-column">${escapeHtml(lot.fishing_gear || '-')}</td>
        <td class="lot-sanitary-column">${escapeHtml(lot.production_method || '-')}</td>
        <td class="lot-sanitary-column">${escapeHtml(lot.allergens || '-')}</td>
      `}
      <td><button class="btn btn-danger btn-sm" type="button" data-action="manual-out-lot" data-lot-id="${escapeHtml(lot.id)}" data-article-id="${escapeHtml(lot.article_id)}">Sortie</button></td>
    </tr>
  `).join('');
}

async function openLotsModal(articleId, details = {}) {
  const cleanArticleId = normalizeArticleId(articleId);
  if (!validateArticleId(cleanArticleId, 'openLotsModal', details)) {
    return;
  }

  activeLotsArticleId = cleanArticleId;
  const article = stockRows.find((row) => String(row.article_id) === String(cleanArticleId));
  lotModal.classList.remove('hidden');
  lotModalTitle.textContent = article ? `${article.plu || ''} - ${article.designation || 'Lots'}` : 'Lots disponibles';
  lotModalSubtitle.textContent = isPackagingView()
    ? 'Lots emballage disponibles tries par date de creation.'
    : 'Lots disponibles tries par FIFO : DLC la plus proche, puis date de creation.';
  lotsTbody.innerHTML = `<tr><td colspan="${isPackagingView() ? 6 : 13}">Chargement des lots...</td></tr>`;
  if (!details.refreshOnly) showFeedback(lotFeedback, '');

  try {
    const lots = await apiGet(`/api/stock/articles/${encodeURIComponent(cleanArticleId)}/lots?available_only=true`);
    renderLots(lots);
    await loadManualOutHistory(cleanArticleId);
  } catch (error) {
    console.error(error);
    showFeedback(lotFeedback, error.message, 'error');
    lotsTbody.innerHTML = `<tr><td colspan="${isPackagingView() ? 6 : 13}">Erreur de chargement des lots.</td></tr>`;
  }
}

function closeLotsModal() {
  activeLotsArticleId = null;
  lotModal.classList.add('hidden');
  lotsTbody.innerHTML = `<tr><td colspan="${isPackagingView() ? 6 : 13}">Selectionne un article.</td></tr>`;
  manualOutHistoryTbody.innerHTML = '<tr><td colspan="7">Selectionne un article.</td></tr>';
  showFeedback(lotFeedback, '');
}

function setStockCategory(category) {
  activeStockCategory = category === 'packaging' ? 'packaging' : 'product';
  document.body.classList.toggle('stock-packaging-view', isPackagingView());
  stockCategoryTabs.forEach((tab) => {
    const active = tab.dataset.category === activeStockCategory;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (stockActionsHeading) stockActionsHeading.textContent = isPackagingView() ? 'Lots' : 'Lots / Tracabilite';
  closeLotsModal();
  loadStock();
}

stockTbody.addEventListener('input', (event) => {
  const input = event.target.closest('.tariff-input');
  if (!input) return;
  delete input.dataset.prefilled;
  const rowEl = input.closest('tr[data-article-id]');
  if (rowEl) updateRowMargins(rowEl);
});

stockTbody.addEventListener('change', (event) => {
  const input = event.target.closest('.tariff-input');
  if (!input) return;
  const price = parsePriceInput(input.value);
  if (!Number.isNaN(price)) input.value = formatPriceInput(price);
});

stockTbody.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const rowEl = button.closest('tr[data-article-id]');
  const articleId = normalizeArticleId(rowEl?.dataset.articleId);

  if (!validateArticleId(articleId, `click:${button.dataset.action}`, { button, rowEl })) {
    return;
  }

  if (button.dataset.action === 'lots') {
    openLotsModal(articleId, { button, rowEl });
    return;
  }

  if (button.dataset.action === 'manual-out') {
    openManualOutModal(articleId);
    return;
  }

  if (button.dataset.action === 'save-prices' && rowEl) {
    await savePrices(rowEl, { button });
  }
});

lotsTbody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="manual-out-lot"]');
  if (!button) return;
  openManualOutModal(button.dataset.articleId, button.dataset.lotId);
});

manualOutHistoryTbody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="cancel-manual-out"]');
  if (!button) return;
  const row = button.closest('tr[data-movement-id]');
  if (row) cancelManualOut(row.dataset.movementId);
});

stockSearchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    loadStock();
  }
});

stockSearchBtn.addEventListener('click', loadStock);
refreshStockBtn.addEventListener('click', loadStock);
stockAvailableFilter.addEventListener('change', loadStock);
stockCategoryTabs.forEach((tab) => tab.addEventListener('click', () => setStockCategory(tab.dataset.category)));
prefillPricesBtn.addEventListener('click', prefillPricesFromMargins);
savePrefilledPricesBtn.addEventListener('click', savePrefilledPrices);
closeLotModalBtn.addEventListener('click', closeLotsModal);
lotModal.addEventListener('click', (event) => {
  if (event.target === lotModal) closeLotsModal();
});
closeManualOutModalBtn.addEventListener('click', closeManualOutModal);
manualOutModal.addEventListener('click', (event) => {
  if (event.target === manualOutModal) closeManualOutModal();
});
manualOutLotSelect.addEventListener('change', setManualOutLotDetails);
manualOutForm.addEventListener('submit', submitManualStockOut);

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
  renderManualOutReasons();
  loadManualOutReasons();
  loadStock();
}

init();
