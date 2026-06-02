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

const userNameEl = document.getElementById('user-name');
const backHomeBtn = document.getElementById('back-home-btn');
const logoutBtn = document.getElementById('logout-btn');
const refreshSourceBtn = document.getElementById('refresh-source-btn');
const savePriceListBtn = document.getElementById('save-price-list-btn');
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
const sourceTbody = document.getElementById('source-tbody');
const pageFeedback = document.getElementById('page-feedback');
const selectedSummary = document.getElementById('selected-summary');
const selectedLinesEl = document.getElementById('selected-lines');
const previewBtn = document.getElementById('preview-btn');
const printBtn = document.getElementById('print-btn');
const previewEl = document.getElementById('price-list-preview');

let clients = [];
let sourceProducts = [];
let selectedLines = [];
let savedPriceListId = null;
let lastStoreSettings = {};

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

function parsePrice(value) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
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

function selectedClient() {
  return clients.find((client) => String(client.id) === String(clientSelect.value)) || null;
}

function updateTariffContext(sourceContext = null) {
  const client = selectedClient();
  if (!client) {
    tariffContext.textContent = 'Aucun client selectionne : les prix restent a choisir.';
    return;
  }

  const level = sourceContext?.tariff_level || client.tariff_level || 1;
  tariffContext.textContent = `Client selectionne : tarif ${level} applique automatiquement depuis la fiche client.`;
}

function defaultTitle() {
  const typeLabel = COURSE_TYPE_LABELS[courseTypeSelect.value] || COURSE_TYPE_LABELS.general;
  const client = selectedClient();
  return client ? `${typeLabel} - ${client.name}` : typeLabel;
}

function sourceQuery() {
  const params = new URLSearchParams();
  params.set('available_only', availableOnlySelect.value || 'true');
  params.set('limit', '500');
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

function renderSourceProducts() {
  sourceCount.textContent = `${sourceProducts.length} produit${sourceProducts.length > 1 ? 's' : ''}`;

  if (!sourceProducts.length) {
    sourceTbody.innerHTML = '<tr><td colspan="6">Aucun produit disponible.</td></tr>';
    return;
  }

  sourceTbody.innerHTML = sourceProducts.map((row) => {
    const alreadySelected = selectedLines.some((line) => line.article_id === row.article_id);
    const price = row.suggested_price_ht;
    return `<tr>
      <td><strong>${escapeHtml(row.display_name || row.designation)}</strong><small>${escapeHtml(row.plu || '')}</small></td>
      <td>${escapeHtml(row.family_name || 'Autre')}</td>
      <td>${escapeHtml(usefulInfo(row) || '-')}</td>
      <td>${formatNumber(row.stock_quantity)} ${escapeHtml(row.sale_unit || row.unit || '')}</td>
      <td>${price === null || price === undefined ? '-' : formatMoney(price)}</td>
      <td><button class="btn btn-primary btn-sm" data-action="add-source" data-article-id="${escapeHtml(row.article_id)}" ${alreadySelected ? 'disabled' : ''}>${alreadySelected ? 'Ajoute' : 'Ajouter'}</button></td>
    </tr>`;
  }).join('');
}

function sortLines(lines) {
  return [...lines].sort((a, b) => {
    if (a.is_featured !== b.is_featured) return a.is_featured ? -1 : 1;
    const familyCompare = String(a.family_name || 'Autre').localeCompare(String(b.family_name || 'Autre'), 'fr');
    if (familyCompare !== 0) return familyCompare;
    return Number(a.display_order || 0) - Number(b.display_order || 0);
  });
}

function groupedSelectedLines() {
  const sorted = sortLines(selectedLines);
  const groups = [];
  const featured = sorted.filter((line) => line.is_featured);
  if (featured.length) groups.push({ title: 'Produits du moment', lines: featured, featured: true });

  sorted.filter((line) => !line.is_featured).forEach((line) => {
    const familyName = line.family_name || 'Autre';
    let group = groups.find((item) => !item.featured && item.title === familyName);
    if (!group) {
      group = { title: familyName, lines: [], featured: false };
      groups.push(group);
    }
    group.lines.push(line);
  });

  return groups;
}

function renderSelectedLines() {
  selectedSummary.textContent = selectedLines.length
    ? `${selectedLines.length} produit${selectedLines.length > 1 ? 's' : ''} selectionne${selectedLines.length > 1 ? 's' : ''}`
    : 'Aucun produit selectionne.';

  if (!selectedLines.length) {
    selectedLinesEl.className = 'selected-lines-empty';
    selectedLinesEl.innerHTML = 'Selectionne des produits depuis le stock.';
    return;
  }

  selectedLinesEl.className = 'selected-lines';
  selectedLinesEl.innerHTML = groupedSelectedLines().map((group) => `
    <section class="selected-section">
      <h4>${escapeHtml(group.title)}</h4>
      ${group.lines.map((line) => `
        <div class="selected-line" data-line-key="${escapeHtml(line.key)}">
          <div>
            <strong>${escapeHtml(line.designation_snapshot)}</strong>
            <span class="selected-line-meta">${escapeHtml([line.caliber_info, line.origin_label, line.fao_zone ? `FAO ${line.fao_zone}` : null].filter(Boolean).join(' - ') || '-')}</span>
            <span class="selected-family-label">${escapeHtml(line.family_name || 'Autre')}</span>
          </div>
          <input type="number" min="0" step="0.01" data-field="price_ht" value="${escapeHtml(line.price_ht ?? '')}" aria-label="Prix HT" />
          <input type="text" data-field="line_note" value="${escapeHtml(line.line_note || '')}" placeholder="Note" aria-label="Note ligne" />
          <input type="number" min="1" step="1" data-field="display_order" value="${escapeHtml(line.display_order || 1)}" aria-label="Ordre" />
          <label class="featured-toggle"><input type="checkbox" data-field="is_featured" ${line.is_featured ? 'checked' : ''} /> Moment</label>
          <button class="btn btn-danger remove-line-btn" data-action="remove-line" aria-label="Retirer">x</button>
        </div>
      `).join('')}
    </section>
  `).join('');
}

function buildLineFromSource(row) {
  const price = row.suggested_price_ht;
  return {
    key: row.article_id || `manual-${Date.now()}`,
    article_id: row.article_id,
    family_code: row.family_code,
    family_name: row.family_name || 'Autre',
    display_order: selectedLines.length + 1,
    is_featured: false,
    designation_snapshot: row.display_name || row.designation,
    caliber_info: row.caliber_info,
    origin_label: row.origin_label,
    fao_zone: row.fao_zone,
    sous_zone: row.sous_zone,
    sale_unit: row.sale_unit || row.unit,
    stock_quantity_snapshot: row.stock_quantity,
    price_ht: price ?? '',
    price_source: price === null || price === undefined ? 'none' : row.suggested_price_source || 'client_tariff',
    tariff_level: row.selected_tariff_level,
    line_note: '',
  };
}

function addSourceProduct(articleId) {
  const row = sourceProducts.find((product) => product.article_id === articleId);
  if (!row || selectedLines.some((line) => line.article_id === articleId)) return;
  selectedLines.push(buildLineFromSource(row));
  renderSourceProducts();
  renderSelectedLines();
  renderPreview();
}

function updateLineFromInput(lineKey, field, value, checked = false) {
  const line = selectedLines.find((item) => item.key === lineKey);
  if (!line) return;

  if (field === 'is_featured') {
    line.is_featured = checked;
  } else if (field === 'price_ht') {
    const price = parsePrice(value);
    line.price_ht = Number.isNaN(price) ? '' : price;
    line.price_source = price === null ? 'none' : 'manual';
  } else if (field === 'display_order') {
    const order = Number(value);
    line.display_order = Number.isFinite(order) && order > 0 ? order : 1;
  } else if (field === 'line_note') {
    line.line_note = value;
  }

  renderPreview();
}

function removeLine(lineKey) {
  selectedLines = selectedLines.filter((line) => line.key !== lineKey);
  renderSourceProducts();
  renderSelectedLines();
  renderPreview();
}

function applyClientTariffToSelected() {
  if (!clientSelect.value) {
    selectedLines = selectedLines.map((line) => ({
      ...line,
      price_source: line.price_ht === '' || line.price_ht === null ? 'none' : 'manual',
      tariff_level: null,
    }));
    return;
  }

  selectedLines = selectedLines.map((line) => {
    const source = sourceProducts.find((row) => row.article_id === line.article_id);
    if (!source || source.suggested_price_ht === null || source.suggested_price_ht === undefined) return line;
    return {
      ...line,
      price_ht: source.suggested_price_ht,
      price_source: 'client_tariff',
      tariff_level: source.selected_tariff_level,
    };
  });
}

async function loadClients() {
  clients = await apiGet('/api/clients?status=active');
  clientSelect.innerHTML = '<option value="">Sans client</option>' + clients.map((client) => (
    `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)}${client.tariff_level ? ` - Tarif ${client.tariff_level}` : ''}</option>`
  )).join('');
}

async function loadSourceProducts() {
  sourceTbody.innerHTML = '<tr><td colspan="6">Chargement des produits...</td></tr>';
  const data = await apiGet(`/api/customer-price-lists/source-products?${sourceQuery()}`);
  sourceProducts = data.products || [];
  updateTariffContext(data);
  applyClientTariffToSelected();
  renderSourceProducts();
  renderSelectedLines();
  renderPreview();
}

function payload() {
  return {
    client_id: clientSelect.value || null,
    course_type: courseTypeSelect.value,
    title: titleInput.value.trim() || defaultTitle(),
    price_list_date: priceListDateInput.value || todayIso(),
    valid_until: validUntilInput.value || null,
    status: statusSelect.value,
    notes: notesInput.value.trim() || null,
    lines: selectedLines.map((line, index) => ({
      ...line,
      display_order: Number(line.display_order || index + 1),
      price_ht: line.price_ht === '' ? null : line.price_ht,
    })),
  };
}

async function savePriceList() {
  if (!selectedLines.length) {
    showFeedback('Selectionne au moins un produit pour enregistrer le cours.', 'error');
    return null;
  }

  savePriceListBtn.disabled = true;
  try {
    const body = payload();
    const saved = savedPriceListId
      ? await apiSend(`/api/customer-price-lists/${encodeURIComponent(savedPriceListId)}`, 'PUT', body)
      : await apiSend('/api/customer-price-lists', 'POST', body);
    savedPriceListId = saved.id;
    selectedLines = (saved.lines || []).map((line) => ({ ...line, key: line.article_id || line.id }));
    showFeedback('Cours enregistre.', 'success');
    renderSelectedLines();
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
  const lines = linesOverride || payload().lines;
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
  sourceSearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadSourceProducts().catch((error) => showFeedback(error.message, 'error'));
  });
  clientSelect.addEventListener('change', () => loadSourceProducts().catch((error) => showFeedback(error.message, 'error')));
  courseTypeSelect.addEventListener('change', () => {
    if (!titleInput.value.trim()) titleInput.value = defaultTitle();
    renderPreview();
  });
  savePriceListBtn.addEventListener('click', savePriceList);
  previewBtn.addEventListener('click', () => {
    showFeedback('', '');
    renderPreview();
  });
  printBtn.addEventListener('click', printPreview);

  sourceTbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="add-source"]');
    if (!button) return;
    addSourceProduct(button.dataset.articleId);
  });

  selectedLinesEl.addEventListener('input', (event) => {
    const input = event.target.closest('[data-field]');
    const row = event.target.closest('[data-line-key]');
    if (!input || !row) return;
    updateLineFromInput(row.dataset.lineKey, input.dataset.field, input.value, input.checked);
  });

  selectedLinesEl.addEventListener('change', (event) => {
    const input = event.target.closest('[data-field="is_featured"]');
    const row = event.target.closest('[data-line-key]');
    if (!input || !row) return;
    updateLineFromInput(row.dataset.lineKey, input.dataset.field, input.value, input.checked);
    renderSelectedLines();
  });

  selectedLinesEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="remove-line"]');
    const row = event.target.closest('[data-line-key]');
    if (!button || !row) return;
    removeLine(row.dataset.lineKey);
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
