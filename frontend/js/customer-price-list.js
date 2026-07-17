const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const sessionToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const sessionUserRaw = localStorage.getItem('gc_user') || localStorage.getItem('grv2_user');

if (!sessionToken || !sessionUserRaw) {
  window.location.href = './login.html';
}

const sessionUser = JSON.parse(sessionUserRaw);

const COURSE_TYPE_LABELS = {
  general: 'Cours general',
  client: 'Cours client',
  promotion: 'Offre promotionnelle',
  daily_arrival: 'Arrivage du jour',
};

const TARGET_LABELS = {
  all: 'Mercuriale complete',
  1: 'Vue Leclerc',
  2: 'Vue B',
  3: 'Vue C',
};

const userNameEl = document.getElementById('user-name');
const backHomeBtn = document.getElementById('back-home-btn');
const logoutBtn = document.getElementById('logout-btn');
const refreshSourceBtn = document.getElementById('refresh-source-btn');
const savePriceListBtn = document.getElementById('save-price-list-btn');
const targetTariffSelect = document.getElementById('target-tariff-select');
const courseTypeSelect = document.getElementById('course-type-select');
const clientSelect = document.getElementById('client-select');
const titleInput = document.getElementById('price-list-title-input');
const priceListDateInput = document.getElementById('price-list-date-input');
const validUntilInput = document.getElementById('valid-until-input');
const statusSelect = document.getElementById('status-select');
const notesInput = document.getElementById('notes-input');
const tariffContext = document.getElementById('tariff-context');
const sourceSearchInput = document.getElementById('source-search-input');
const sourceFamilyInput = document.getElementById('source-family-input');
const availableOnlySelect = document.getElementById('available-only-select');
const sourceSearchBtn = document.getElementById('source-search-btn');
const sourceCount = document.getElementById('source-count');
const sourceThead = document.getElementById('source-thead');
const sourceTbody = document.getElementById('source-tbody');
const pageFeedback = document.getElementById('page-feedback');
const selectedSummary = document.getElementById('selected-summary');
const selectAllBtn = document.getElementById('select-all-btn');
const unselectAllBtn = document.getElementById('unselect-all-btn');
const previewBtn = document.getElementById('preview-btn');
const printBtn = document.getElementById('print-btn');
const downloadPdfBtn = document.getElementById('download-pdf-btn');
const previewEl = document.getElementById('price-list-preview');

let clients = [];
let sourceProducts = [];
let selectedArticleIds = new Set();
let featuredArticleIds = new Set();
let savedPriceListId = null;
let lastStoreSettings = {};
let currentPriceList = null;

window.CustomerPriceListState = {
  emailContext() {
    const storedDate = currentPriceList?.price_list_date ? String(currentPriceList.price_list_date).slice(0, 10) : null;
    const inputDate = priceListDateInput?.value || null;
    const resolvedDate = storedDate || inputDate || null;
    return {
      price_list_id: currentPriceList?.id || savedPriceListId || null,
      mercuriale_date: resolvedDate,
      price_list_date: resolvedDate,
      client_id: clientSelect?.value || currentPriceList?.client_id || null,
      target_tariff_level: targetTariffLevel(),
      tariff_level: targetTariffLevel(),
    };
  },
};

function authHeaders(json = false) {
  const headers = { Authorization: `Bearer ${sessionToken}` };
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function escapeHtml(value) {
  return window.CustomerPriceListPrint.escapeHtml(value);
}

function showFeedback(message = '', type = '') {
  pageFeedback.textContent = message;
  pageFeedback.className = 'page-feedback';
  if (!message) pageFeedback.classList.add('hidden');
  if (type) pageFeedback.classList.add(type);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatNumber(value, digits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

function formatMoney(value) {
  return window.CustomerPriceListPrint.money(value);
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders(false) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur API');
  return data;
}

async function apiSend(path, method, payload) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur API');
  return data;
}

async function downloadPdf(path, fallbackName) {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders(false) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Erreur generation PDF');
  }
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1] || fallbackName;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function selectedClient() {
  return clients.find((client) => String(client.id) === String(clientSelect.value)) || null;
}

function targetTariffValue() {
  return targetTariffSelect.value || 'all';
}

function targetTariffLevel() {
  const value = targetTariffValue();
  return value === 'all' ? null : Number(value);
}

function isMultiTariff() {
  return targetTariffValue() === 'all';
}

function updateTariffContext() {
  const label = TARGET_LABELS[targetTariffValue()] || TARGET_LABELS.all;
  const client = selectedClient();
  tariffContext.textContent = client
    ? `${label}. Client optionnel selectionne : ${client.name}.`
    : `${label}. Aucun client requis pour preparer la mercuriale.`;
}

function defaultTitle() {
  return TARGET_LABELS[targetTariffValue()] || COURSE_TYPE_LABELS[courseTypeSelect.value] || 'Mercuriale du jour';
}

function sourceQuery() {
  const params = new URLSearchParams();
  params.set('available_only', availableOnlySelect.value || 'true');
  params.set('limit', '1500');
  params.set('target_tariff_level', targetTariffValue());
  params.set('price_list_date', priceListDateInput.value || todayIso());
  if (clientSelect.value) params.set('client_id', clientSelect.value);
  if (sourceSearchInput.value.trim()) params.set('search', sourceSearchInput.value.trim());
  if (sourceFamilyInput.value.trim()) params.set('family', sourceFamilyInput.value.trim());
  return params.toString();
}

function usefulInfo(row) {
  return [
    row.caliber_info,
    row.origin_label,
    row.fao_zone ? `FAO ${row.fao_zone}` : null,
    row.sous_zone,
  ].filter(Boolean).join(' - ');
}

function priceLabel(row) {
  if (isMultiTariff()) {
    return [
      formatMoney(row.display_price_level_1_ht ?? row.price_level_1_ht),
      formatMoney(row.display_price_level_2_ht ?? row.price_level_2_ht),
      formatMoney(row.display_price_level_3_ht ?? row.price_level_3_ht),
    ];
  }
  return [formatMoney(row.display_price_ht ?? row.suggested_price_ht)];
}

function renderTableHead() {
  sourceThead.innerHTML = isMultiTariff()
    ? `<tr>
        <th>Inclure</th>
        <th>Moment</th>
        <th>Produit</th>
        <th>Famille</th>
        <th>Infos</th>
        <th>Disponible fournisseur</th>
        <th>Vue Leclerc HT</th>
        <th>Vue B HT</th>
        <th>Vue C HT</th>
      </tr>`
    : `<tr>
        <th>Inclure</th>
        <th>Moment</th>
        <th>Produit</th>
        <th>Famille</th>
        <th>Infos</th>
        <th>Disponible fournisseur</th>
        <th>Prix HT</th>
      </tr>`;
}

function renderSourceProducts() {
  renderTableHead();
  const selectedCount = sourceProducts.filter((row) => selectedArticleIds.has(row.article_id)).length;
  sourceCount.textContent = `${sourceProducts.length} article${sourceProducts.length > 1 ? 's' : ''}`;
  selectedSummary.textContent = `${selectedCount} article${selectedCount > 1 ? 's' : ''} inclus.`;

  if (!sourceProducts.length) {
    sourceTbody.innerHTML = `<tr><td colspan="${isMultiTariff() ? 9 : 7}">Aucun article disponible.</td></tr>`;
    return;
  }

  sourceTbody.innerHTML = sourceProducts.map((row) => {
    const included = selectedArticleIds.has(row.article_id);
    const featured = featuredArticleIds.has(row.article_id);
    const prices = priceLabel(row);
    const priceCells = isMultiTariff()
      ? prices.map((price) => `<td class="num">${price}</td>`).join('')
      : `<td class="num">${prices[0]}</td>`;

    return `<tr class="${included ? '' : 'muted-row'}" data-article-id="${escapeHtml(row.article_id)}">
      <td><input type="checkbox" data-action="toggle-include" ${included ? 'checked' : ''} aria-label="Inclure ${escapeHtml(row.display_name || row.designation)}" /></td>
      <td><input type="checkbox" data-action="toggle-featured" ${featured ? 'checked' : ''} ${included ? '' : 'disabled'} aria-label="Produit du moment ${escapeHtml(row.display_name || row.designation)}" /></td>
      <td><strong>${escapeHtml(row.display_name || row.designation)}</strong><small>${escapeHtml(row.plu || '')}</small></td>
      <td>${escapeHtml(row.family_name || 'Autre')}</td>
      <td>${escapeHtml(usefulInfo(row) || '-')}</td>
      <td>${formatNumber(row.stock_quantity)} ${escapeHtml(row.sale_unit || row.unit || '')}</td>
      ${priceCells}
    </tr>`;
  }).join('');
}

function buildLineFromSource(row, index) {
  const tariffLevel = targetTariffLevel();
  return {
    key: row.article_id,
    article_id: row.article_id,
    family_code: row.family_code,
    family_name: row.family_name || 'Autre',
    display_order: index + 1,
    is_featured: featuredArticleIds.has(row.article_id),
    designation_snapshot: row.display_name || row.designation,
    caliber_info: row.caliber_info,
    origin_label: row.origin_label,
    fao_zone: row.fao_zone,
    sous_zone: row.sous_zone,
    sale_unit: row.sale_unit || row.unit,
    stock_quantity_snapshot: row.stock_quantity,
    price_ht: tariffLevel ? row.suggested_price_ht : null,
    price_level_1_ht: row.price_level_1_ht,
    price_level_2_ht: row.price_level_2_ht,
    price_level_3_ht: row.price_level_3_ht,
    display_price_ht: tariffLevel ? row.display_price_ht : null,
    display_price_level_1_ht: row.display_price_level_1_ht,
    display_price_level_2_ht: row.display_price_level_2_ht,
    display_price_level_3_ht: row.display_price_level_3_ht,
    price_source: tariffLevel ? 'target_tariff' : 'none',
    tariff_level: tariffLevel,
    line_note: '',
  };
}

function selectedLines() {
  return sourceProducts
    .filter((row) => selectedArticleIds.has(row.article_id))
    .map((row, index) => buildLineFromSource(row, index));
}

function selectAll() {
  selectedArticleIds = new Set(sourceProducts.map((row) => row.article_id));
  renderSourceProducts();
  renderPreview();
}

function unselectAll() {
  selectedArticleIds = new Set();
  featuredArticleIds = new Set();
  renderSourceProducts();
  renderPreview();
}

async function loadClients() {
  clients = await apiGet('/api/clients?status=active');
  clientSelect.innerHTML = '<option value="">Sans client</option>' + clients.map((client) => (
    `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)}</option>`
  )).join('');
}

async function loadSourceProducts(options = {}) {
  sourceTbody.innerHTML = `<tr><td colspan="${isMultiTariff() ? 9 : 7}">Chargement des articles...</td></tr>`;
  const data = await apiGet(`/api/customer-price-lists/source-products?${sourceQuery()}`);
  sourceProducts = data.products || [];

  if (options.keepSelection) {
    const availableIds = new Set(sourceProducts.map((row) => row.article_id));
    selectedArticleIds = new Set([...selectedArticleIds].filter((id) => availableIds.has(id)));
    featuredArticleIds = new Set([...featuredArticleIds].filter((id) => availableIds.has(id) && selectedArticleIds.has(id)));
  } else {
    selectedArticleIds = new Set(sourceProducts.map((row) => row.article_id));
    featuredArticleIds = new Set();
  }

  updateTariffContext();
  renderSourceProducts();
  renderPreview();
}

function payload() {
  const tariffLevel = targetTariffLevel();
  return {
    client_id: clientSelect.value || null,
    course_type: courseTypeSelect.value,
    target_tariff_level: tariffLevel,
    tariff_level: tariffLevel,
    title: titleInput.value.trim() || defaultTitle(),
    price_list_date: priceListDateInput.value || todayIso(),
    valid_until: validUntilInput.value || null,
    status: statusSelect.value,
    notes: notesInput.value.trim() || null,
    lines: selectedLines(),
  };
}

async function savePriceList() {
  const lines = selectedLines();
  if (!lines.length) {
    showFeedback('Garde au moins un article coche pour enregistrer la mercuriale.', 'error');
    return null;
  }

  savePriceListBtn.disabled = true;
  try {
    const body = payload();
    const saved = savedPriceListId
      ? await apiSend(`/api/customer-price-lists/${encodeURIComponent(savedPriceListId)}`, 'PUT', body)
      : await apiSend('/api/customer-price-lists', 'POST', body);
    savedPriceListId = saved.id;
    currentPriceList = saved;
    showFeedback('Mercuriale enregistree.', 'success');
    await loadPresentation();
    return saved;
  } catch (error) {
    console.error(error);
    showFeedback(error.message, 'error');
    return null;
  } finally {
    savePriceListBtn.disabled = false;
  }
}

function renderPreview(priceListOverride = null, linesOverride = null, settingsOverride = null) {
  const priceList = priceListOverride || {
    ...payload(),
    client_name: selectedClient()?.name || '',
  };
  const lines = linesOverride || selectedLines();
  const settings = settingsOverride || lastStoreSettings || {};
  previewEl.className = 'print-preview';
  previewEl.innerHTML = window.CustomerPriceListPrint.buildHtml(priceList, lines, settings);
}

async function loadPresentation() {
  if (!savedPriceListId) {
    renderPreview();
    return;
  }

  const data = await apiGet(`/api/customer-price-lists/${encodeURIComponent(savedPriceListId)}/presentation`);
  lastStoreSettings = data.store_settings || {};
  currentPriceList = data.price_list || currentPriceList;
  if (currentPriceList?.price_list_date) {
    priceListDateInput.value = String(currentPriceList.price_list_date).slice(0, 10);
  }
  renderPreview(data.price_list, data.lines || [], lastStoreSettings);
}

function printPreview() {
  const html = previewEl.innerHTML;
  if (!html || html.includes('print-preview-placeholder')) return;

  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) {
    window.print();
    return;
  }

  printWindow.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Mercuriale</title><link rel="stylesheet" href="./css/app.css"><link rel="stylesheet" href="./css/pages/customer-price-list.css"></head><body>${html}</body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

async function downloadPriceListPdf() {
  showFeedback('', '');
  downloadPdfBtn.disabled = true;
  try {
    if (!savedPriceListId) {
      const saved = await savePriceList();
      if (!saved?.id && !savedPriceListId) return;
    }
    const context = window.CustomerPriceListState?.emailContext ? window.CustomerPriceListState.emailContext() : {};
    const params = new URLSearchParams();
    if (context.client_id) params.set('client_id', context.client_id);
    if (context.target_tariff_level) params.set('target_tariff_level', context.target_tariff_level);
    if (context.tariff_level) params.set('tariff_level', context.tariff_level);
    if (context.mercuriale_date) params.set('mercuriale_date', context.mercuriale_date);
    const query = params.toString();
    await downloadPdf(`/api/customer-price-lists/${encodeURIComponent(savedPriceListId)}/pdf${query ? `?${query}` : ''}`, 'mercuriale.pdf');
    showFeedback('PDF mercuriale genere.', 'success');
  } catch (error) {
    console.error(error);
    showFeedback(error.message, 'error');
  } finally {
    downloadPdfBtn.disabled = false;
  }
}

function logout() {
  localStorage.removeItem('grv2_token');
  localStorage.removeItem('grv2_user');
  localStorage.removeItem('grv2_active_department');
  localStorage.removeItem('gc_token');
  localStorage.removeItem('gc_user');
  localStorage.removeItem('gc_active_department');
  window.location.href = './login.html';
}

function bindEvents() {
  backHomeBtn.addEventListener('click', () => { window.location.href = './home.html'; });
  logoutBtn.addEventListener('click', logout);
  refreshSourceBtn.addEventListener('click', () => loadSourceProducts().catch((error) => showFeedback(error.message, 'error')));
  sourceSearchBtn.addEventListener('click', () => loadSourceProducts().catch((error) => showFeedback(error.message, 'error')));
  selectAllBtn.addEventListener('click', selectAll);
  unselectAllBtn.addEventListener('click', unselectAll);
  sourceSearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadSourceProducts().catch((error) => showFeedback(error.message, 'error'));
  });
  targetTariffSelect.addEventListener('change', () => {
    savedPriceListId = null;
    currentPriceList = null;
    if (!titleInput.value.trim() || Object.values(TARGET_LABELS).includes(titleInput.value.trim())) {
      titleInput.value = defaultTitle();
    }
    loadSourceProducts().catch((error) => showFeedback(error.message, 'error'));
  });
  clientSelect.addEventListener('change', () => {
    updateTariffContext();
    renderPreview();
  });
  courseTypeSelect.addEventListener('change', () => {
    if (!titleInput.value.trim()) titleInput.value = defaultTitle();
    renderPreview();
  });
  priceListDateInput.addEventListener('change', () => {
    savedPriceListId = null;
    currentPriceList = null;
    loadSourceProducts().catch((error) => showFeedback(error.message, 'error'));
  });
  savePriceListBtn.addEventListener('click', savePriceList);
  previewBtn.addEventListener('click', () => {
    showFeedback('', '');
    renderPreview();
  });
  printBtn.addEventListener('click', printPreview);
  downloadPdfBtn.addEventListener('click', downloadPriceListPdf);

  sourceTbody.addEventListener('change', (event) => {
    const input = event.target.closest('input[data-action]');
    const row = event.target.closest('[data-article-id]');
    if (!input || !row) return;
    const articleId = row.dataset.articleId;

    if (input.dataset.action === 'toggle-include') {
      if (input.checked) selectedArticleIds.add(articleId);
      else {
        selectedArticleIds.delete(articleId);
        featuredArticleIds.delete(articleId);
      }
    }

    if (input.dataset.action === 'toggle-featured') {
      if (input.checked && selectedArticleIds.has(articleId)) featuredArticleIds.add(articleId);
      else featuredArticleIds.delete(articleId);
    }

    renderSourceProducts();
    renderPreview();
  });
}

async function init() {
  userNameEl.textContent = sessionUser.email || 'Utilisateur';
  priceListDateInput.value = todayIso();
  titleInput.value = defaultTitle();
  bindEvents();

  try {
    await loadClients();
    await loadSourceProducts();
  } catch (error) {
    console.error(error);
    showFeedback(error.message, 'error');
  }
}

init();
