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

let stockRows = [];

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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(
    String(value || '')
  );
}

function warnInvalidArticleId(context, details = {}) {
  console.warn('[Stock] ID article invalide cote interface', {
    context,
    ...details,
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
  kpiDlc.textContent = dlcs.length ? formatDate(dlcs[0]) : '-';
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
        <td>${formatDate(getFifoDlc(row))}</td>
        <td>${formatMoney(row.stock_value_ex_vat)}</td>
        <td>
          <div class="stock-actions">
            <button class="btn btn-secondary btn-sm" data-action="lots" data-article-id="${escapeHtml(cleanArticleId)}" ${actionsDisabled}>Lots</button>
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
    params.set('limit', '500');

    if (stockSearchInput.value.trim()) params.set('search', stockSearchInput.value.trim());
    if (stockFamilyFilter.value.trim()) params.set('family', stockFamilyFilter.value.trim());

    stockRows = await apiGet(`/api/stock?${params.toString()}`);
    warnInvalidStockRows(stockRows);
    renderStock(stockRows);
    showFeedback(stockFeedback, `${stockRows.length} article(s) charge(s).`, 'success');
  } catch (error) {
    console.error(error);
    showFeedback(stockFeedback, error.message, 'error');
    stockTbody.innerHTML = '<tr><td colspan="13">Erreur de chargement.</td></tr>';
    updateKpis([]);
  }
}

function renderLots(lots) {
  if (!lots.length) {
    lotsTbody.innerHTML = '<tr><td colspan="12">Aucun lot disponible.</td></tr>';
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
      <td>${formatDate(lot.dlc)}</td>
      <td>${escapeHtml(lot.latin_name || '-')}</td>
      <td>${escapeHtml(lot.fao_zone || '-')}</td>
      <td>${escapeHtml(lot.sous_zone || '-')}</td>
      <td>${escapeHtml(lot.fishing_gear || '-')}</td>
      <td>${escapeHtml(lot.production_method || '-')}</td>
      <td>${escapeHtml(lot.allergens || '-')}</td>
    </tr>
  `).join('');
}

async function openLotsModal(articleId, details = {}) {
  const cleanArticleId = normalizeArticleId(articleId);
  if (!validateArticleId(cleanArticleId, 'openLotsModal', details)) {
    return;
  }

  const article = stockRows.find((row) => String(row.article_id) === String(cleanArticleId));
  lotModal.classList.remove('hidden');
  lotModalTitle.textContent = article ? `${article.plu || ''} - ${article.designation || 'Lots'}` : 'Lots disponibles';
  lotModalSubtitle.textContent = 'Lots disponibles tries par FIFO : DLC la plus proche, puis date de creation.';
  lotsTbody.innerHTML = '<tr><td colspan="12">Chargement des lots...</td></tr>';
  showFeedback(lotFeedback, '');

  try {
    const lots = await apiGet(`/api/stock/articles/${encodeURIComponent(cleanArticleId)}/lots?available_only=true`);
    renderLots(lots);
  } catch (error) {
    console.error(error);
    showFeedback(lotFeedback, error.message, 'error');
    lotsTbody.innerHTML = '<tr><td colspan="12">Erreur de chargement des lots.</td></tr>';
  }
}

function closeLotsModal() {
  lotModal.classList.add('hidden');
  lotsTbody.innerHTML = '<tr><td colspan="12">Selectionne un article.</td></tr>';
  showFeedback(lotFeedback, '');
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

  if (button.dataset.action === 'save-prices' && rowEl) {
    await savePrices(rowEl, { button });
  }
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
prefillPricesBtn.addEventListener('click', prefillPricesFromMargins);
savePrefilledPricesBtn.addEventListener('click', savePrefilledPrices);
closeLotModalBtn.addEventListener('click', closeLotsModal);
lotModal.addEventListener('click', (event) => {
  if (event.target === lotModal) closeLotsModal();
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
  loadStock();
}

init();
