const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';
const sessionToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const sessionUserRaw = localStorage.getItem('gc_user') || localStorage.getItem('grv2_user');
const activeDepartment = JSON.parse(
  localStorage.getItem('gc_active_department') || localStorage.getItem('grv2_active_department') || 'null'
);

if (!sessionToken || !sessionUserRaw) {
  window.location.href = './login.html';
}

const sessionUser = JSON.parse(sessionUserRaw);

const userNameEl = document.getElementById('user-name');
const backHomeBtn = document.getElementById('back-home-btn');
const logoutBtn = document.getElementById('logout-btn');
const refreshDataBtn = document.getElementById('refresh-data-btn');
const printSheetBtn = document.getElementById('print-sheet-btn');
const printSheetBtnSecondary = document.getElementById('print-sheet-btn-secondary');
const clearEntriesBtn = document.getElementById('clear-entries-btn');
const newSheetBtn = document.getElementById('new-sheet-btn');
const pageFeedback = document.getElementById('page-feedback');
const sheetTitleInput = document.getElementById('sheet-title-input');
const sheetDateInput = document.getElementById('sheet-date-input');
const sheetNoteInput = document.getElementById('sheet-note-input');
const supplierSelect = document.getElementById('supplier-select');
const supplierEmailOutput = document.getElementById('supplier-email-output');
const marginLevel1Input = document.getElementById('margin-level-1-input');
const marginLevel2Input = document.getElementById('margin-level-2-input');
const marginLevel3Input = document.getElementById('margin-level-3-input');
const recalculateAllPricesBtn = document.getElementById('recalculate-all-prices-btn');
const clientSearchInput = document.getElementById('client-search-input');
const selectAllClientsBtn = document.getElementById('select-all-clients-btn');
const clearClientsBtn = document.getElementById('clear-clients-btn');
const clientCountLabel = document.getElementById('client-count-label');
const clientsList = document.getElementById('clients-list');
const productColumnsEl = document.getElementById('product-columns');
const addProductColumnBtn = document.getElementById('add-product-column-btn');
const emailPreviewBtn = document.getElementById('email-preview-btn');
const sendSupplierEmailBtn = document.getElementById('send-supplier-email-btn');
const generateOrdersBtn = document.getElementById('generate-orders-btn');
const actionPreviewPanel = document.getElementById('action-preview-panel');
const sheetReferenceLabel = document.getElementById('sheet-reference-label');
const printTitle = document.getElementById('print-title');
const printNote = document.getElementById('print-note');
const printDate = document.getElementById('print-date');
const printTableWrap = document.getElementById('print-table-wrap');
const articleModal = document.getElementById('article-modal');
const closeArticleModalBtn = document.getElementById('close-article-modal-btn');
const articleSearchInput = document.getElementById('article-search-input');
const articleSearchBtn = document.getElementById('article-search-btn');
const articleResults = document.getElementById('article-results');

const DEFAULT_PRODUCT_COLUMNS = 10;
const MAX_PRODUCT_COLUMNS = 18;
const DRAFT_STORAGE_KEY = `alta-maree:quick-order-sheet:v3:${sessionUser.store_id || sessionUser.client_key || sessionUser.email || 'default'}`;

let clients = [];
let suppliers = [];
let selectedClientIds = new Set();
let productColumns = [];
let activeProductIndex = null;
let articleSearchResults = [];
let orderEntries = {};
let draftLoaded = false;
let draftHasClientSelection = false;
let sheetId = '';
let emailPreviewReady = false;
let generatedOrderIds = [];
let generatedOrders = [];
let draftSupplierId = '';
let serverSaveTimer = null;
let isLoadingServerSheet = false;

function authHeaders() {
  return { Authorization: `Bearer ${sessionToken}` };
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
  if (!pageFeedback) return;
  pageFeedback.textContent = message;
  pageFeedback.className = 'page-feedback';
  if (!message) pageFeedback.classList.add('hidden');
  if (type) pageFeedback.classList.add(type);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateFr(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('fr-FR');
}

function compactNumber(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString('fr-FR', { maximumFractionDigits: digits });
}

function moneyInputValue(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return number.toFixed(2);
}

function parseDecimal(value) {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePercent(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 0), 99.99) / 100;
}

function moneyNumber(value) {
  const parsed = parseDecimal(value);
  return parsed > 0 ? parsed : 0;
}

function salePriceFromMargin(purchasePrice, marginRate) {
  const purchase = moneyNumber(purchasePrice);
  if (purchase <= 0 || marginRate < 0 || marginRate >= 1) return '';
  return (purchase / (1 - marginRate)).toFixed(2);
}

function realMargin(purchasePrice, salePrice) {
  const purchase = moneyNumber(purchasePrice);
  const sale = moneyNumber(salePrice);
  if (purchase <= 0 || sale <= 0) return '';
  return `${(((sale - purchase) / sale) * 100).toFixed(1)}%`;
}

function realMarginRate(purchasePrice, salePrice) {
  const purchase = moneyNumber(purchasePrice);
  const sale = moneyNumber(salePrice);
  if (purchase <= 0 || sale <= 0) return null;
  return Number(((sale - purchase) / sale).toFixed(4));
}

function defaultMargins() {
  return {
    1: parsePercent(marginLevel1Input?.value, 0.10),
    2: parsePercent(marginLevel2Input?.value, 0.15),
    3: parsePercent(marginLevel3Input?.value, 0.20),
  };
}

function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function generateUuidV4() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

function ensureValidSheetId() {
  if (isValidUuid(sheetId)) return sheetId;
  sheetId = generateUuidV4();
  return sheetId;
}

function updateSheetReferenceLabel() {
  if (!sheetReferenceLabel) return;
  ensureValidSheetId();
  sheetReferenceLabel.textContent = sheetId.slice(0, 8).toUpperCase();
}

function columnUid() {
  return `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function loadDraft() {
  const draft = safeJsonParse(localStorage.getItem(DRAFT_STORAGE_KEY));
  if (!draft || typeof draft !== 'object') return false;

  if (draft.title !== undefined) sheetTitleInput.value = draft.title || "Fiche d'appel clients";
  if (draft.date !== undefined) sheetDateInput.value = draft.date || todayIso();
  if (draft.note !== undefined) sheetNoteInput.value = draft.note || '';
  if (isValidUuid(draft.sheetId)) sheetId = draft.sheetId;
  if (draft.supplierId !== undefined) draftSupplierId = draft.supplierId || '';

  if (Array.isArray(draft.selectedClientIds)) {
    selectedClientIds = new Set(draft.selectedClientIds.map(String));
    draftHasClientSelection = true;
  }

  if (Array.isArray(draft.productColumns) && draft.productColumns.length > 0) {
    productColumns = draft.productColumns.slice(0, MAX_PRODUCT_COLUMNS).map((column) => ({
      ...emptyProductColumn(),
      ...column,
      uid: column.uid || columnUid(),
    }));
  }

  orderEntries = draft.orderEntries && typeof draft.orderEntries === 'object' ? draft.orderEntries : {};
  generatedOrderIds = Array.isArray(draft.generatedOrderIds) ? draft.generatedOrderIds : [];
  generatedOrders = Array.isArray(draft.generatedOrders) ? draft.generatedOrders : [];
  draftLoaded = true;
  return true;
}

function saveDraft() {
  ensureValidSheetId();
  const draft = {
    title: sheetTitleInput.value,
    sheetId,
    date: sheetDateInput.value,
    note: sheetNoteInput.value,
    supplierId: supplierSelect.value || draftSupplierId || '',
    selectedClientIds: Array.from(selectedClientIds),
    productColumns,
    orderEntries,
    generatedOrderIds,
    generatedOrders,
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  updateSheetReferenceLabel();
}

function serverPayload() {
  return {
    ...buildSheetPayload(),
    default_margin_level_1: defaultMargins()[1],
    default_margin_level_2: defaultMargins()[2],
    default_margin_level_3: defaultMargins()[3],
    selected_client_ids: Array.from(selectedClientIds),
  };
}

async function saveSheetToServer() {
  if (isLoadingServerSheet) return;
  await apiSend('/api/quick-order-sheets/by-date', serverPayload(), 'PUT');
}

function saveSheetToServerDebounced() {
  if (isLoadingServerSheet) return;
  window.clearTimeout(serverSaveTimer);
  serverSaveTimer = window.setTimeout(() => {
    saveSheetToServer().catch((error) => {
      console.error('Erreur sauvegarde fiche appel :', error);
      showFeedback(error.message || 'Erreur sauvegarde fiche appel', 'error');
    });
  }, 700);
}

function applyServerSheet(sheet) {
  if (!sheet) return false;
  isLoadingServerSheet = true;
  sheetTitleInput.value = sheet.title || "Fiche d'appel clients";
  sheetDateInput.value = String(sheet.sheet_date || todayIso()).slice(0, 10);
  sheetNoteInput.value = sheet.notes || '';
  supplierSelect.value = sheet.supplier_id || '';
  marginLevel1Input.value = (Number(sheet.default_margin_level_1 ?? 0.10) * 100).toFixed(2);
  marginLevel2Input.value = (Number(sheet.default_margin_level_2 ?? 0.15) * 100).toFixed(2);
  marginLevel3Input.value = (Number(sheet.default_margin_level_3 ?? 0.20) * 100).toFixed(2);
  selectedClientIds = new Set((Array.isArray(sheet.selected_client_ids) ? sheet.selected_client_ids : []).map(String));
  draftHasClientSelection = selectedClientIds.size > 0;
  orderEntries = sheet.order_entries && typeof sheet.order_entries === 'object' ? sheet.order_entries : {};
  productColumns = (Array.isArray(sheet.products) ? sheet.products : []).map((product) => ({
    ...emptyProductColumn(),
    uid: product.column_uid || columnUid(),
    article_id: product.article_id,
    plu: product.plu || '',
    designation: product.designation_snapshot || '',
    purchase_price_ht: moneyInputValue(product.purchase_price_ht),
    stock: product.supplier_available_quantity ?? '',
    unit: product.price_unit || product.sale_unit || 'kg',
    sale_unit: product.sale_unit || product.price_unit || 'kg',
    sale_price_level_1_ht: moneyInputValue(product.sale_price_level_1_ht),
    sale_price_level_2_ht: moneyInputValue(product.sale_price_level_2_ht),
    sale_price_level_3_ht: moneyInputValue(product.sale_price_level_3_ht),
    manual_price_level_1: Boolean(product.manual_price_level_1),
    manual_price_level_2: Boolean(product.manual_price_level_2),
    manual_price_level_3: Boolean(product.manual_price_level_3),
    family_code: product.family_code || '',
    family_name: product.family_name || '',
  }));
  ensureProductColumns();
  updateSupplierEmailOutput();
  renderClients();
  renderProductColumns();
  updatePreview();
  saveDraft();
  isLoadingServerSheet = false;
  return true;
}

async function loadSheetFromServer() {
  const date = sheetDateInput.value || todayIso();
  const data = await apiGet(`/api/quick-order-sheets/by-date?date=${encodeURIComponent(date)}`);
  if (data.exists && data.sheet) {
    applyServerSheet(data.sheet);
    showFeedback(`Fiche du ${formatDateFr(date)} rechargee.`, 'success');
    return true;
  }
  return false;
}

function persistSheetIdInDraft() {
  ensureValidSheetId();
  const draft = safeJsonParse(localStorage.getItem(DRAFT_STORAGE_KEY), {});
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
    ...(draft && typeof draft === 'object' ? draft : {}),
    sheetId,
    savedAt: new Date().toISOString(),
  }));
  updateSheetReferenceLabel();
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur API');
  return data;
}

async function apiSend(path, payload, method = 'POST') {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Erreur API');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function clientLabel(client) {
  const code = client.code ? `${client.code} - ` : '';
  const city = client.city ? ` (${client.city})` : '';
  return `${code}${client.name || client.legal_name || 'Client'}${city}`;
}

function productLabel(product) {
  return product.display_name || product.designation || product.label || '';
}

function emptyProductColumn() {
  return {
    uid: columnUid(),
    article_id: null,
    plu: '',
    designation: '',
    purchase_price_ht: '',
    sale_price_level_1_ht: '',
    sale_price_level_2_ht: '',
    sale_price_level_3_ht: '',
    manual_price_level_1: false,
    manual_price_level_2: false,
    manual_price_level_3: false,
    stock: '',
    unit: '',
    family_code: '',
    family_name: '',
    sale_unit: '',
  };
}

function ensureProductColumns() {
  if (productColumns.length > 0) return;
  productColumns = Array.from({ length: DEFAULT_PRODUCT_COLUMNS }, emptyProductColumn);
}

function recalculateColumnPrices(column, resetManual = false) {
  const margins = defaultMargins();
  [1, 2, 3].forEach((level) => {
    const manualKey = `manual_price_level_${level}`;
    const priceKey = `sale_price_level_${level}_ht`;
    if (resetManual || !column[manualKey]) {
      column[priceKey] = salePriceFromMargin(column.purchase_price_ht, margins[level]);
      column[manualKey] = false;
    }
  });
}

function recalculateAllPrices(resetManual = false) {
  productColumns.forEach((column) => recalculateColumnPrices(column, resetManual));
  renderProductColumns();
  invalidateEmailPreview();
  saveDraft();
  saveSheetToServerDebounced();
}

function selectedClients() {
  return clients.filter((client) => selectedClientIds.has(String(client.id)));
}

function visibleClients() {
  const search = String(clientSearchInput?.value || '').trim().toLowerCase();
  if (!search) return clients;
  return clients.filter((client) => clientLabel(client).toLowerCase().includes(search));
}

function usableProductColumns() {
  return productColumns.filter((column) => column.article_id || column.designation || column.price || column.stock);
}

function entryFor(clientId, columnUidValue) {
  return orderEntries[String(clientId)]?.[String(columnUidValue)] || {};
}

function entryQuantity(entry = {}) {
  const colis = parseDecimal(entry.colis);
  const kg = parseDecimal(entry.kg);
  return Number((colis * kg).toFixed(3));
}

function setEntryValue(clientId, columnUidValue, field, value) {
  const safeClientId = String(clientId);
  const safeColumnUid = String(columnUidValue);
  if (!orderEntries[safeClientId]) orderEntries[safeClientId] = {};
  if (!orderEntries[safeClientId][safeColumnUid]) orderEntries[safeClientId][safeColumnUid] = {};
  orderEntries[safeClientId][safeColumnUid][field] = value;
}

function selectedSupplier() {
  return suppliers.find((supplier) => String(supplier.id) === String(supplierSelect.value)) || null;
}

function selectedProductTotals() {
  const rows = selectedClients();
  return usableProductColumns().map((column) => {
    const sold = rows.reduce((sum, client) => sum + entryQuantity(entryFor(client.id, column.uid)), 0);
    const stock = parseDecimal(column.stock);
    return {
      ...column,
      stock,
      sold: Number(sold.toFixed(3)),
      remaining: Number((stock - sold).toFixed(3)),
      overstock: stock > 0 && sold > stock,
    };
  });
}

function updateSupplierEmailOutput() {
  const supplier = selectedSupplier();
  supplierEmailOutput.textContent = supplier?.email || '-';
  supplierEmailOutput.classList.toggle('missing-email', Boolean(supplier && !supplier.email));
  emailPreviewReady = false;
  sendSupplierEmailBtn.disabled = true;
}

function invalidateEmailPreview() {
  emailPreviewReady = false;
  sendSupplierEmailBtn.disabled = true;
}

function resetGenerationState() {
  generatedOrderIds = [];
  generatedOrders = [];
  invalidateEmailPreview();
}

function buildSheetPayload() {
  ensureValidSheetId();
  const selectedIds = new Set(selectedClients().map((client) => String(client.id)));
  const products = usableProductColumns();
  return {
    sheet_id: sheetId,
    title: sheetTitleInput.value.trim() || "Fiche d'appel clients",
    date: sheetDateInput.value || todayIso(),
    notes: sheetNoteInput.value.trim(),
    supplier_id: supplierSelect.value || null,
    clients: clients
      .filter((client) => selectedIds.has(String(client.id)))
      .map((client) => ({
        id: client.id,
        code: client.code,
        name: client.name || client.legal_name,
        legal_name: client.legal_name,
        city: client.city,
        parent_client_id: client.parent_client_id,
        billed_client_id: client.billed_client_id,
        tariff_level: client.tariff_level,
        is_royale_maree_member: client.is_royale_maree_member,
        store_identifier: client.store_identifier,
        affiliate_label: client.affiliate_label,
        affiliate_store_number: client.affiliate_store_number,
      })),
    products: products.map((product) => ({
      uid: product.uid,
      article_id: product.article_id,
      plu: product.plu,
      designation: product.designation,
      price: product.sale_price_level_1_ht || product.price,
      purchase_price_ht: product.purchase_price_ht,
      supplier_available_quantity: product.stock,
      stock: product.stock,
      sale_price_level_1_ht: product.sale_price_level_1_ht,
      sale_price_level_2_ht: product.sale_price_level_2_ht,
      sale_price_level_3_ht: product.sale_price_level_3_ht,
      manual_price_level_1: Boolean(product.manual_price_level_1),
      manual_price_level_2: Boolean(product.manual_price_level_2),
      manual_price_level_3: Boolean(product.manual_price_level_3),
      real_margin_level_1: realMarginRate(product.purchase_price_ht, product.sale_price_level_1_ht),
      real_margin_level_2: realMarginRate(product.purchase_price_ht, product.sale_price_level_2_ht),
      real_margin_level_3: realMarginRate(product.purchase_price_ht, product.sale_price_level_3_ht),
      family_code: product.family_code,
      family_name: product.family_name,
      sale_unit: product.sale_unit || product.unit,
      unit: product.unit || 'kg',
    })),
    entries: orderEntries,
  };
}

function enteredOrderLines() {
  const productsByUid = new Map(usableProductColumns().map((product) => [String(product.uid), product]));
  const rows = [];
  selectedClients().forEach((client) => {
    const clientEntries = orderEntries[String(client.id)] || {};
    Object.entries(clientEntries).forEach(([uid, entry]) => {
      const product = productsByUid.get(String(uid));
      if (!product?.article_id) return;
      const colis = parseDecimal(entry.colis);
      const kg = parseDecimal(entry.kg);
      const quantity = Number((colis * kg).toFixed(3));
      if (quantity <= 0) return;
      rows.push({ client, product, colis, kg, quantity });
    });
  });
  return rows;
}

function orderCellHtml(client, column) {
  const entry = entryFor(client.id, column.uid);
  const clientId = escapeHtml(client.id);
  const columnId = escapeHtml(column.uid);
  const price = priceForClient(column, client);
  return `<td>
    <div class="order-cell-grid">
      <label>
        <span>Colis</span>
        <input class="order-cell-input" type="text" inputmode="decimal" data-client-id="${clientId}" data-column-id="${columnId}" data-order-field="colis" value="${escapeHtml(entry.colis || '')}" aria-label="Colis ${escapeHtml(client.name || '')} ${escapeHtml(productLabel(column) || '')}" />
      </label>
      <label>
        <span>Kg</span>
        <input class="order-cell-input" type="text" inputmode="decimal" data-client-id="${clientId}" data-column-id="${columnId}" data-order-field="kg" value="${escapeHtml(entry.kg || '')}" aria-label="Kg ${escapeHtml(client.name || '')} ${escapeHtml(productLabel(column) || '')}" />
      </label>
    </div>
    <small class="order-cell-price">Prix: ${escapeHtml(moneyInputValue(price) || '-')} EUR</small>
  </td>`;
}

function priceForClient(column, client) {
  const level = [1, 2, 3].includes(Number(client?.tariff_level)) ? Number(client.tariff_level) : 1;
  return column[`sale_price_level_${level}_ht`] || column.price || '';
}

function updateProductTotalsInPlace() {
  selectedProductTotals().forEach((column) => {
    const head = printTableWrap.querySelector(`[data-total-column-id="${CSS.escape(String(column.uid))}"]`);
    if (!head) return;
    head.classList.toggle('product-overstock', column.overstock);
    const stockEl = head.querySelector('[data-total-field="stock"]');
    const soldEl = head.querySelector('[data-total-field="sold"]');
    const remainingEl = head.querySelector('[data-total-field="remaining"]');
    const remainingLine = head.querySelector('[data-total-line="remaining"]');
    if (stockEl) stockEl.textContent = compactNumber(column.stock);
    if (soldEl) soldEl.textContent = compactNumber(column.sold);
    if (remainingEl) remainingEl.textContent = compactNumber(column.remaining);
    remainingLine?.classList.toggle('stock-alert', column.overstock);
  });
}

function updatePreview() {
  const title = sheetTitleInput.value.trim() || "Fiche d'appel clients";
  const note = sheetNoteInput.value.trim();
  const date = sheetDateInput.value || todayIso();
  const rows = selectedClients();
  const columns = selectedProductTotals();

  printTitle.textContent = title;
  printNote.textContent = note || 'Arrivage du jour';
  printDate.textContent = formatDateFr(date);

  if (!rows.length || !columns.length) {
    printTableWrap.innerHTML = `<div class="print-empty-state">Selectionner au moins un client et un produit pour generer la fiche.</div>`;
    return;
  }

  const colgroup = [
    '<col class="client-col" />',
    ...columns.map(() => '<col class="product-col" />'),
  ].join('');

  const head = columns.map((column) => {
    const name = productLabel(column) || 'Produit';
    return `<th data-total-column-id="${escapeHtml(column.uid)}" class="${column.overstock ? 'product-overstock' : ''}">
      <div class="product-head-name">${escapeHtml(name)}</div>
      <div class="product-head-meta">T1 ${escapeHtml(moneyInputValue(column.sale_price_level_1_ht) || '-')} / T2 ${escapeHtml(moneyInputValue(column.sale_price_level_2_ht) || '-')} / T3 ${escapeHtml(moneyInputValue(column.sale_price_level_3_ht) || '-')}</div>
      <div class="product-head-meta">Dispo fournisseur: <span data-total-field="stock">${escapeHtml(compactNumber(column.stock))}</span> ${escapeHtml(column.unit || 'kg')}</div>
      <div class="product-head-meta">Vendu: <span data-total-field="sold">${escapeHtml(compactNumber(column.sold))}</span> kg</div>
      <div class="product-head-meta ${column.overstock ? 'stock-alert' : ''}" data-total-line="remaining">Reste: <span data-total-field="remaining">${escapeHtml(compactNumber(column.remaining))}</span> kg</div>
    </th>`;
  }).join('');

  const body = rows.map((client) => `<tr>
    <th scope="row">
      <strong>${escapeHtml(client.name || client.legal_name || 'Client')}</strong>
      <span>${escapeHtml([client.code, client.city].filter(Boolean).join(' - '))}</span>
    </th>
    ${columns.map((column) => orderCellHtml(client, column)).join('')}
  </tr>`).join('');

  printTableWrap.innerHTML = `<table class="quick-print-table">
    <colgroup>${colgroup}</colgroup>
    <thead><tr><th>Clients</th>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function renderClients() {
  const rows = visibleClients();
  const selectedCount = selectedClients().length;
  clientCountLabel.textContent = `${selectedCount}/${clients.length} client${clients.length > 1 ? 's' : ''} selectionne${selectedCount > 1 ? 's' : ''}`;

  if (!rows.length) {
    clientsList.innerHTML = '<div class="empty-list">Aucun client actif trouve.</div>';
    updatePreview();
    return;
  }

  clientsList.innerHTML = rows.map((client) => {
    const checked = selectedClientIds.has(String(client.id));
    return `<label class="client-check-row">
      <input type="checkbox" data-client-id="${escapeHtml(client.id)}" ${checked ? 'checked' : ''} />
      <span>
        <strong>${escapeHtml(client.name || client.legal_name || 'Client')}</strong>
        <small>${escapeHtml([client.code, client.city, client.phone || client.mobile].filter(Boolean).join(' - '))}</small>
      </span>
    </label>`;
  }).join('');

  updatePreview();
  saveDraft();
}

function renderProductColumns() {
  ensureProductColumns();
  const margins = defaultMargins();
  productColumnsEl.innerHTML = productColumns.map((column, index) => {
    const label = productLabel(column) || 'Article non choisi';
    const margin1 = realMargin(column.purchase_price_ht, column.sale_price_level_1_ht);
    const margin2 = realMargin(column.purchase_price_ht, column.sale_price_level_2_ht);
    const margin3 = realMargin(column.purchase_price_ht, column.sale_price_level_3_ht);
    return `<article class="product-column-editor" data-product-index="${index}">
      <div class="product-editor-title">
        <span>Colonne ${index + 1}</span>
        <div>
          <button class="btn btn-secondary btn-sm" type="button" data-action="duplicate-product" title="Dupliquer cette colonne">Copier</button>
          <button class="btn btn-secondary btn-sm" type="button" data-action="remove-product" title="Retirer cette colonne">X</button>
        </div>
      </div>
      <button class="product-pick-btn" type="button" data-action="pick-product">
        <strong>${escapeHtml(label)}</strong>
        <small>${escapeHtml(column.plu || 'F9 / rechercher article')}</small>
      </button>
      <label>
        Prix achat HT du jour
        <input type="text" inputmode="decimal" value="${escapeHtml(column.purchase_price_ht || '')}" data-field="purchase_price_ht" placeholder="ex. 9.00" />
      </label>
      <div class="price-grid">
        <label>
          PV T1
          <input type="text" inputmode="decimal" value="${escapeHtml(column.sale_price_level_1_ht || '')}" data-field="sale_price_level_1_ht" data-price-level="1" placeholder="${escapeHtml(salePriceFromMargin(column.purchase_price_ht, margins[1]))}" />
          <small>${escapeHtml(margin1 || '-')} ${column.manual_price_level_1 ? '<span class="manual-price-badge">manuel</span>' : ''}</small>
        </label>
        <label>
          PV T2
          <input type="text" inputmode="decimal" value="${escapeHtml(column.sale_price_level_2_ht || '')}" data-field="sale_price_level_2_ht" data-price-level="2" placeholder="${escapeHtml(salePriceFromMargin(column.purchase_price_ht, margins[2]))}" />
          <small>${escapeHtml(margin2 || '-')} ${column.manual_price_level_2 ? '<span class="manual-price-badge">manuel</span>' : ''}</small>
        </label>
        <label>
          PV T3
          <input type="text" inputmode="decimal" value="${escapeHtml(column.sale_price_level_3_ht || '')}" data-field="sale_price_level_3_ht" data-price-level="3" placeholder="${escapeHtml(salePriceFromMargin(column.purchase_price_ht, margins[3]))}" />
          <small>${escapeHtml(margin3 || '-')} ${column.manual_price_level_3 ? '<span class="manual-price-badge">manuel</span>' : ''}</small>
        </label>
      </div>
      <div class="product-editor-actions">
        <button class="btn btn-secondary btn-sm" type="button" data-action="recalculate-product">Recalculer la colonne</button>
      </div>
      <label>
        Disponible fournisseur
        <input type="text" inputmode="decimal" value="${escapeHtml(column.stock)}" data-field="stock" placeholder="ex. 18 kg" />
      </label>
    </article>`;
  }).join('');
  addProductColumnBtn.disabled = productColumns.length >= MAX_PRODUCT_COLUMNS;
  updatePreview();
}

async function loadClients() {
  const data = await apiGet('/api/clients?status=active');
  clients = Array.isArray(data) ? data : [];
  clients.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr'));
  if (!draftHasClientSelection) {
    selectedClientIds = new Set(clients.map((client) => String(client.id)));
  }
  renderClients();
}

async function loadSuppliers() {
  const data = await apiGet('/api/suppliers?status=active');
  suppliers = Array.isArray(data) ? data : [];
  supplierSelect.innerHTML = '<option value="">Choisir fournisseur</option>';
  suppliers.forEach((supplier) => {
    const option = document.createElement('option');
    option.value = supplier.id;
    option.textContent = `${supplier.code ? `${supplier.code} - ` : ''}${supplier.name || 'Fournisseur'}`;
    supplierSelect.appendChild(option);
  });
  if (draftSupplierId) supplierSelect.value = draftSupplierId;
  draftSupplierId = supplierSelect.value || '';
  updateSupplierEmailOutput();
}

async function stockByArticleIds(articleIds, searchTerm = '') {
  if (!articleIds.length) return new Map();
  const query = new URLSearchParams({
    available_only: 'false',
    limit: '1000',
  });
  if (searchTerm.trim()) query.set('search', searchTerm.trim());
  const stockRows = await apiGet(`/api/stock?${query.toString()}`);
  const wanted = new Set(articleIds.map(String));
  return new Map((Array.isArray(stockRows) ? stockRows : [])
    .filter((row) => wanted.has(String(row.article_id)))
    .map((row) => [String(row.article_id), row]));
}

async function searchArticles(term) {
  const query = new URLSearchParams({
    search: term,
    active: 'true',
    limit: '50',
  });
  if (activeDepartment?.id) query.set('department_id', activeDepartment.id);
  const articleRows = await apiGet(`/api/articles?${query.toString()}`);
  const articles = Array.isArray(articleRows) ? articleRows : [];
  const stocks = await stockByArticleIds(articles.map((article) => article.id), term);
  return articles.map((article) => ({ ...article, stock_row: stocks.get(String(article.id)) || null }));
}

function renderArticleResults() {
  if (!articleSearchResults.length) {
    articleResults.innerHTML = '<div class="empty-list">Aucun article trouve.</div>';
    return;
  }

  articleResults.innerHTML = articleSearchResults.map((article, index) => {
    const stock = article.stock_row;
    const stockText = stock ? `${compactNumber(stock.stock_quantity)} ${stock.unit || article.stock_unit || article.unit || ''}` : '-';
    const price = article.sale_price_ex_vat ?? stock?.sale_price_level_1_ht ?? stock?.sale_price_level_2_ht ?? stock?.sale_price_level_3_ht;
    return `<button class="article-result-row" type="button" data-result-index="${index}">
      <span>
        <strong>${escapeHtml(article.display_name || article.designation)}</strong>
        <small>${escapeHtml([article.plu, article.family_name].filter(Boolean).join(' - '))}</small>
      </span>
      <span class="article-result-meta">Stock ${escapeHtml(stockText)}<br>Prix ${escapeHtml(moneyInputValue(price) || '-')}</span>
    </button>`;
  }).join('');
}

async function runArticleSearch() {
  const term = articleSearchInput.value.trim();
  if (term.length < 2) {
    articleResults.innerHTML = '<div class="empty-list">Saisir au moins 2 caracteres.</div>';
    return;
  }
  articleResults.innerHTML = '<div class="empty-list">Recherche...</div>';
  try {
    articleSearchResults = await searchArticles(term);
    renderArticleResults();
  } catch (error) {
    console.error('Erreur recherche article fiche appel :', error);
    articleResults.innerHTML = '<div class="empty-list">Erreur recherche article.</div>';
  }
}

function openArticleModal(index) {
  activeProductIndex = index;
  articleSearchResults = [];
  articleSearchInput.value = productColumns[index]?.designation || '';
  articleResults.innerHTML = '<div class="empty-list">Rechercher un article par PLU ou designation.</div>';
  articleModal.classList.remove('hidden');
  articleSearchInput.focus();
  if (articleSearchInput.value.trim().length >= 2) runArticleSearch();
}

function closeArticleModal() {
  articleModal.classList.add('hidden');
  activeProductIndex = null;
  articleSearchResults = [];
}

function applyArticleResult(index) {
  const article = articleSearchResults[index];
  if (!article || activeProductIndex === null) return;
  const stock = article.stock_row;
  const purchasePrice = stock?.pma || article.purchase_price_ht || article.unit_cost_ex_vat || '';
  const nextColumn = {
    ...emptyProductColumn(),
    ...productColumns[activeProductIndex],
  };
  nextColumn.article_id = article.id;
  nextColumn.plu = article.plu || '';
  nextColumn.designation = article.display_name || article.designation || '';
  nextColumn.purchase_price_ht = nextColumn.purchase_price_ht || moneyInputValue(purchasePrice);
  nextColumn.stock = nextColumn.stock || '';
  nextColumn.unit = stock?.unit || article.stock_unit || article.sale_unit || article.unit || '';
  nextColumn.sale_unit = article.sale_unit || article.unit || nextColumn.unit;
  nextColumn.family_code = article.family_code || '';
  nextColumn.family_name = article.family_name || '';
  recalculateColumnPrices(nextColumn, false);
  productColumns[activeProductIndex] = {
    ...nextColumn,
    uid: productColumns[activeProductIndex].uid || columnUid(),
  };
  closeArticleModal();
  renderProductColumns();
  saveDraft();
}

function duplicateProduct(index) {
  if (productColumns.length >= MAX_PRODUCT_COLUMNS) return;
  productColumns.splice(index + 1, 0, { ...productColumns[index], uid: columnUid() });
  renderProductColumns();
}

function removeProduct(index) {
  const removed = productColumns[index];
  productColumns.splice(index, 1);
  if (removed?.uid) {
    Object.values(orderEntries).forEach((clientEntries) => {
      if (clientEntries && typeof clientEntries === 'object') delete clientEntries[removed.uid];
    });
  }
  ensureProductColumns();
  renderProductColumns();
}

function clearEntries() {
  orderEntries = {};
  updatePreview();
  invalidateEmailPreview();
  saveDraft();
  showFeedback('Quantites Colis / Kg videes pour cette fiche.', 'success');
}

function newSheet() {
  const confirmed = window.confirm('Cette action va effacer les saisies actuelles et creer une nouvelle fiche. Les commandes deja generees ne seront pas supprimees.');
  if (!confirmed) return;
  orderEntries = {};
  resetGenerationState();
  sheetId = generateUuidV4();
  sheetDateInput.value = todayIso();
  actionPreviewPanel.classList.add('hidden');
  actionPreviewPanel.innerHTML = '';
  updateSheetReferenceLabel();
  updatePreview();
  saveDraft();
  showFeedback(`Nouvelle fiche creee (${sheetId.slice(0, 8).toUpperCase()}). Produits, clients et fournisseur conserves.`, 'success');
}

function renderActionPreview(title, html) {
  actionPreviewPanel.classList.remove('hidden');
  actionPreviewPanel.innerHTML = `<h3>${escapeHtml(title)}</h3>${html}`;
}

function orderLinksHtml(orders = []) {
  if (!orders.length && !generatedOrderIds.length) return '';
  return `
    <div class="generated-orders-list">
      ${orders.map((order) => `
        <a class="btn btn-secondary btn-sm" href="./sale-detail.html?id=${encodeURIComponent(order.id)}">
          ${escapeHtml(order.reference_number || order.id)}
        </a>
      `).join('')}
      <button class="btn btn-primary btn-sm" type="button" data-action="open-sales-orders">Ouvrir dans Ventes</button>
    </div>
  `;
}

async function previewSupplierEmail() {
  const supplier = selectedSupplier();
  if (!supplier) {
    showFeedback('Choisis un fournisseur avant de preparer l email.', 'error');
    return;
  }
  try {
    const preview = await apiSend('/api/quick-order-sheets/email-preview', buildSheetPayload());
    const totalsHtml = (preview.totals || []).map((product) => `
      <tr class="${product.remaining < 0 ? 'danger-row' : ''}">
        <td>${escapeHtml(product.designation || product.plu || 'Produit')}</td>
        <td>${escapeHtml(compactNumber(product.stock))}</td>
        <td>${escapeHtml(compactNumber(product.sold))}</td>
        <td>${escapeHtml(compactNumber(product.remaining))}</td>
      </tr>
    `).join('');
    renderActionPreview('Apercu email fournisseur', `
      <p><strong>A :</strong> ${escapeHtml(preview.to || 'Email fournisseur manquant')}</p>
      <p><strong>Objet :</strong> ${escapeHtml(preview.subject || '')}</p>
      <table class="action-preview-table">
        <thead><tr><th>Produit</th><th>Stock</th><th>Vendu</th><th>Reste</th></tr></thead>
        <tbody>${totalsHtml}</tbody>
      </table>
    `);
    emailPreviewReady = true;
    sendSupplierEmailBtn.disabled = preview.missing_email === true;
    showFeedback(preview.missing_email ? 'Apercu genere, mais le fournisseur n a pas d email.' : 'Apercu email pret.', preview.missing_email ? 'error' : 'success');
  } catch (error) {
    console.error('Erreur apercu email fournisseur :', error);
    showFeedback(error.message || 'Erreur apercu email', 'error');
  }
}

async function sendSupplierEmail() {
  if (!emailPreviewReady) {
    showFeedback('Genere un apercu avant envoi.', 'error');
    return;
  }
  const supplier = selectedSupplier();
  const confirmed = window.confirm(`Envoyer la fiche d'appel au fournisseur ${supplier?.name || ''} (${supplier?.email || 'email manquant'}) ?`);
  if (!confirmed) return;

  try {
    const result = await apiSend('/api/quick-order-sheets/send-supplier-email', {
      ...buildSheetPayload(),
      preview_confirmed: true,
      confirm_send: true,
    });
    showFeedback(`Email envoye a ${result.to}.`, 'success');
  } catch (error) {
    console.error('Erreur envoi fournisseur :', error);
    showFeedback(error.message || 'Erreur envoi fournisseur', 'error');
  }
}

function orderSummaryHtml(lines) {
  const totalKg = lines.reduce((sum, line) => sum + line.quantity, 0);
  const totalAmount = lines.reduce((sum, line) => sum + line.quantity * parseDecimal(line.product.price), 0);
  const rows = lines.slice(0, 12).map((line) => `
    <tr>
      <td>${escapeHtml(line.client.name || line.client.legal_name || 'Client')}</td>
      <td>${escapeHtml(productLabel(line.product) || 'Produit')}</td>
      <td>${escapeHtml(compactNumber(line.colis))}</td>
      <td>${escapeHtml(compactNumber(line.kg))}</td>
      <td>${escapeHtml(compactNumber(line.quantity))}</td>
      <td>${escapeHtml(moneyInputValue(line.product.price) || '0.00')}</td>
    </tr>
  `).join('');
  const extra = lines.length > 12 ? `<p>+ ${lines.length - 12} ligne(s) supplementaire(s)</p>` : '';
  return `
    <p>${lines.length} ligne(s), ${escapeHtml(compactNumber(totalKg))} kg, environ ${escapeHtml(moneyInputValue(totalAmount))} EUR HT.</p>
    ${extra}
    <table class="action-preview-table">
      <thead><tr><th>Client</th><th>Produit</th><th>Colis</th><th>Kg/colis</th><th>Total kg</th><th>Prix HT</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="action-preview-actions">
      <button class="btn btn-primary" type="button" data-action="confirm-generate-orders">Confirmer et creer les commandes</button>
    </div>
  `;
}

function renderGeneratedOrders(result) {
  const orders = Array.isArray(result.orders) ? result.orders : [];
  const count = orders.length || generatedOrderIds.length;
  renderActionPreview(result.existing ? 'Commandes deja generees' : 'Commandes creees', `
    <p>${result.existing ? 'Cette fiche avait deja genere ces commandes.' : `${count} commande(s) creee(s).`}</p>
    ${orderLinksHtml(orders)}
    ${result.existing ? '<div class="action-preview-actions"><button class="btn btn-secondary" type="button" data-action="confirm-generate-orders">Verifier le regroupement cote serveur</button></div>' : ''}
  `);
}

function generateOrders() {
  if (generatedOrderIds.length) {
    renderGeneratedOrders({ existing: true, orders: generatedOrders });
    showFeedback(`Commandes deja generees pour cette fiche : ${generatedOrderIds.length}.`, 'error');
    return;
  }
  const lines = enteredOrderLines();
  if (!lines.length) {
    showFeedback('Aucune saisie Colis x Kg a transformer en commande.', 'error');
    return;
  }
  renderActionPreview('Recapitulatif generation commandes', orderSummaryHtml(lines));
}

function renderRegeneratePrompt(errorData = {}) {
  const orders = Array.isArray(errorData.orders) ? errorData.orders : [];
  renderActionPreview('Regeneration requise', `
    <p>${escapeHtml(errorData.error || 'Cette fiche a deja genere des commandes avec un ancien regroupement.')}</p>
    ${orderLinksHtml(orders)}
    <div class="action-preview-actions">
      <button class="btn btn-primary" type="button" data-action="force-regenerate-orders">Recreer proprement les commandes brouillon</button>
    </div>
  `);
}

async function confirmGenerateOrders(forceRegenerate = false) {
  try {
    const result = await apiSend('/api/quick-order-sheets/generate-orders', {
      ...buildSheetPayload(),
      confirm_generate: true,
      force_regenerate: forceRegenerate,
    });
    generatedOrderIds = Array.isArray(result.order_ids) ? result.order_ids : [];
    generatedOrders = Array.isArray(result.orders) ? result.orders : [];
    saveDraft();
    renderGeneratedOrders(result);
    showFeedback(result.existing ? 'Ces commandes avaient deja ete generees pour cette fiche.' : `${generatedOrderIds.length} commande(s) generee(s).`, 'success');
  } catch (error) {
    console.error('Erreur generation commandes :', error);
    if (error.status === 409 && error.data?.can_regenerate) {
      renderRegeneratePrompt(error.data);
    }
    showFeedback(error.message || 'Erreur generation commandes', 'error');
  }
}

async function refreshData() {
  showFeedback('Chargement clients...', '');
  try {
    await Promise.all([loadClients(), loadSuppliers()]);
    await loadSheetFromServer();
    showFeedback('Clients actifs charges.', 'success');
  } catch (error) {
    console.error('Erreur chargement fiche appel :', error);
    showFeedback(error.message || 'Erreur chargement', 'error');
  }
}

function printSheet() {
  updatePreview();
  window.print();
}

function initEvents() {
  backHomeBtn?.addEventListener('click', () => { window.location.href = './home.html'; });
  logoutBtn?.addEventListener('click', () => {
    localStorage.removeItem('gc_token');
    localStorage.removeItem('gc_user');
    localStorage.removeItem('gc_active_department');
    localStorage.removeItem('grv2_token');
    localStorage.removeItem('grv2_user');
    localStorage.removeItem('grv2_active_department');
    window.location.href = './login.html';
  });
  refreshDataBtn?.addEventListener('click', refreshData);
  printSheetBtn?.addEventListener('click', printSheet);
  printSheetBtnSecondary?.addEventListener('click', printSheet);
  clearEntriesBtn?.addEventListener('click', clearEntries);
  newSheetBtn?.addEventListener('click', newSheet);
  emailPreviewBtn?.addEventListener('click', previewSupplierEmail);
  sendSupplierEmailBtn?.addEventListener('click', sendSupplierEmail);
  generateOrdersBtn?.addEventListener('click', generateOrders);
  actionPreviewPanel?.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'confirm-generate-orders') confirmGenerateOrders();
    if (action === 'force-regenerate-orders') {
      const confirmed = window.confirm('Supprimer les anciennes commandes brouillon de cette fiche et les recreer proprement ?');
      if (confirmed) confirmGenerateOrders(true);
    }
    if (action === 'open-sales-orders') {
      localStorage.setItem('gc_sales_section', 'orders');
      window.location.href = './sales.html';
    }
  });
  supplierSelect?.addEventListener('change', () => {
    draftSupplierId = supplierSelect.value || '';
    updateSupplierEmailOutput();
    saveDraft();
    saveSheetToServerDebounced();
  });
  [sheetTitleInput, sheetNoteInput].forEach((input) => input?.addEventListener('input', () => {
    updatePreview();
    invalidateEmailPreview();
    saveDraft();
    saveSheetToServerDebounced();
  }));
  sheetDateInput?.addEventListener('change', async () => {
    resetGenerationState();
    const loaded = await loadSheetFromServer().catch((error) => {
      console.error('Erreur chargement fiche date :', error);
      showFeedback(error.message || 'Erreur chargement fiche date', 'error');
      return false;
    });
    if (!loaded) {
      orderEntries = {};
      productColumns = Array.from({ length: DEFAULT_PRODUCT_COLUMNS }, emptyProductColumn);
      renderProductColumns();
      updatePreview();
      saveDraft();
      saveSheetToServerDebounced();
    }
  });
  [marginLevel1Input, marginLevel2Input, marginLevel3Input].forEach((input) => input?.addEventListener('change', () => {
    recalculateAllPrices(false);
  }));
  recalculateAllPricesBtn?.addEventListener('click', () => recalculateAllPrices(true));
  clientSearchInput?.addEventListener('input', renderClients);
  selectAllClientsBtn?.addEventListener('click', () => {
    selectedClientIds = new Set(clients.map((client) => String(client.id)));
    renderClients();
    invalidateEmailPreview();
    saveDraft();
    saveSheetToServerDebounced();
  });
  clearClientsBtn?.addEventListener('click', () => {
    selectedClientIds = new Set();
    renderClients();
    invalidateEmailPreview();
    saveDraft();
    saveSheetToServerDebounced();
  });
  clientsList?.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-client-id]');
    if (!checkbox) return;
    if (checkbox.checked) selectedClientIds.add(String(checkbox.dataset.clientId));
    else selectedClientIds.delete(String(checkbox.dataset.clientId));
    renderClients();
    invalidateEmailPreview();
    saveDraft();
    saveSheetToServerDebounced();
  });
  addProductColumnBtn?.addEventListener('click', () => {
    if (productColumns.length < MAX_PRODUCT_COLUMNS) productColumns.push(emptyProductColumn());
    renderProductColumns();
    invalidateEmailPreview();
    saveDraft();
    saveSheetToServerDebounced();
  });
  productColumnsEl?.addEventListener('click', (event) => {
    const editor = event.target.closest('[data-product-index]');
    if (!editor) return;
    const index = Number(editor.dataset.productIndex);
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'pick-product') openArticleModal(index);
    if (action === 'duplicate-product') duplicateProduct(index);
    if (action === 'remove-product') removeProduct(index);
    if (action === 'recalculate-product') {
      recalculateColumnPrices(productColumns[index], true);
      renderProductColumns();
    }
    if (action === 'duplicate-product' || action === 'remove-product') invalidateEmailPreview();
    if (['duplicate-product', 'remove-product', 'recalculate-product'].includes(action)) {
      saveDraft();
      saveSheetToServerDebounced();
    }
  });
  productColumnsEl?.addEventListener('input', (event) => {
    const input = event.target.closest('[data-field]');
    const editor = event.target.closest('[data-product-index]');
    if (!input || !editor) return;
    const index = Number(editor.dataset.productIndex);
    productColumns[index][input.dataset.field] = input.value;
    if (input.dataset.field === 'purchase_price_ht') {
      recalculateColumnPrices(productColumns[index], false);
      renderProductColumns();
    }
    if (input.dataset.priceLevel) {
      productColumns[index][`manual_price_level_${input.dataset.priceLevel}`] = true;
      renderProductColumns();
    }
    updatePreview();
    invalidateEmailPreview();
    saveDraft();
    saveSheetToServerDebounced();
  });
  printTableWrap?.addEventListener('input', (event) => {
    const input = event.target.closest('[data-order-field]');
    if (!input) return;
    setEntryValue(input.dataset.clientId, input.dataset.columnId, input.dataset.orderField, input.value);
    updateProductTotalsInPlace();
    invalidateEmailPreview();
    saveDraft();
    saveSheetToServerDebounced();
  });
  printTableWrap?.addEventListener('keydown', (event) => {
    const input = event.target.closest('[data-order-field]');
    if (!input || event.key !== 'Enter') return;
    event.preventDefault();
    const inputs = Array.from(printTableWrap.querySelectorAll('.order-cell-input'));
    const currentIndex = inputs.indexOf(input);
    const next = inputs[currentIndex + 1] || inputs[0];
    next?.focus();
    next?.select();
  });
  closeArticleModalBtn?.addEventListener('click', closeArticleModal);
  articleModal?.addEventListener('click', (event) => {
    if (event.target === articleModal) closeArticleModal();
  });
  articleSearchBtn?.addEventListener('click', runArticleSearch);
  articleSearchInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runArticleSearch();
    }
    if (event.key === 'Escape') closeArticleModal();
  });
  articleResults?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-result-index]');
    if (!row) return;
    applyArticleResult(Number(row.dataset.resultIndex));
    saveSheetToServerDebounced();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'F9') {
      event.preventDefault();
      const firstEmpty = productColumns.findIndex((column) => !column.article_id);
      openArticleModal(firstEmpty >= 0 ? firstEmpty : 0);
    }
  });
}

function init() {
  if (userNameEl) userNameEl.textContent = sessionUser.email || 'Utilisateur';
  sheetDateInput.value = todayIso();
  sheetNoteInput.value = 'Arrivage du jour';
  loadDraft();
  ensureValidSheetId();
  persistSheetIdInDraft();
  updateSheetReferenceLabel();
  ensureProductColumns();
  initEvents();
  renderProductColumns();
  refreshData();
}

init();
