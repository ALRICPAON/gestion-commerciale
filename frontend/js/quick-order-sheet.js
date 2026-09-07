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

function ensureQuickOrderDomShell() {
  if (document.getElementById('selector-title')) return;

  const main = document.querySelector('main');
  if (!main) {
    throw new Error("Fiche d'appel clients: conteneur principal introuvable.");
  }

  main.className = 'main-content quick-order-layout';
  main.innerHTML = `
    <section class="quick-topbar no-print" aria-label="Pilotage fiche d'appel">
      <div class="quick-date-block">
        <label for="sheet-date-input">Date</label>
        <input id="sheet-date-input" type="date" />
      </div>
      <div class="quick-title-block">
        <label for="sheet-note-input">Note</label>
        <input id="sheet-note-input" type="text" placeholder="Arrivage du jour" />
      </div>
      <div class="quick-ref-block">
        <span>Fiche</span>
        <strong id="sheet-reference-label">-</strong>
      </div>
      <div class="quick-save-state" id="autosave-status">Chargement</div>
      <div class="page-actions-right">
        <button id="refresh-data-btn" class="btn btn-secondary" type="button">Actualiser</button>
        <button id="download-pdf-btn" class="btn btn-secondary" type="button">PDF</button>
        <button id="print-sheet-btn" class="btn btn-secondary" type="button">Imprimer</button>
        <button id="generate-orders-btn" class="btn btn-primary" type="button">Generer les commandes</button>
      </div>
    </section>

    <div id="page-feedback" class="page-feedback hidden no-print"></div>

    <section class="quick-mode-bar no-print" aria-label="Mode de saisie">
      <div class="segmented-control" role="tablist" aria-label="Vue fiche d'appel">
        <button id="client-view-btn" class="segment-button active" type="button" data-view="client">Vue Clients</button>
        <button id="article-view-btn" class="segment-button" type="button" data-view="article">Vue Articles</button>
        <button id="supplier-view-btn" class="segment-button" type="button" data-view="supplier">Vue Fournisseurs</button>
      </div>
      <div id="quick-summary" class="quick-summary"></div>
    </section>

    <section class="quick-workspace no-print" aria-label="Saisie des commandes">
      <aside class="quick-selector-panel">
        <div class="selector-header">
          <h2 id="selector-title">Clients</h2>
          <span id="selector-count">0</span>
        </div>
        <input id="primary-search-input" type="search" placeholder="Rechercher" />
        <div class="quick-filter-tabs" id="primary-filter-tabs">
          <button class="filter-chip active" type="button" data-filter="all">Tous</button>
          <button class="filter-chip" type="button" data-filter="with">Avec commande</button>
          <button class="filter-chip" type="button" data-filter="without">Sans commande</button>
        </div>
        <div id="primary-list" class="quick-selector-list" aria-live="polite"></div>
      </aside>

      <section class="quick-entry-panel">
        <div class="entry-header">
          <div>
            <h2 id="entry-title">Selection</h2>
            <p id="entry-subtitle">Tous les articles tarifes du jour sont disponibles.</p>
          </div>
          <div class="entry-actions">
            <button id="add-out-of-tariff-btn" class="btn btn-secondary" type="button">Ajouter un article hors tarif</button>
          </div>
        </div>
        <div class="entry-tools">
          <input id="secondary-search-input" type="search" placeholder="Rechercher" />
          <div class="quick-filter-tabs" id="secondary-filter-tabs">
            <button class="filter-chip active" type="button" data-filter="all">Tous</button>
            <button class="filter-chip" type="button" data-filter="with">Commandes</button>
            <button class="filter-chip" type="button" data-filter="without">Non commandes</button>
          </div>
        </div>
        <div id="entry-table-wrap" class="entry-table-wrap"></div>
      </section>
    </section>

    <section id="action-preview-panel" class="action-preview-panel hidden no-print"></section>

    <section class="print-only print-sheet" id="print-sheet" aria-label="Apercu imprimable">
      <div class="print-sheet-header">
        <div>
          <h1 id="print-title">Fiche d'appel clients</h1>
          <p id="print-note">Arrivage du jour</p>
        </div>
        <div class="print-date-block">
          <span>Date</span>
          <strong id="print-date"></strong>
        </div>
      </div>
      <div id="print-table-wrap" class="print-table-wrap"></div>
    </section>
  `;
}

ensureQuickOrderDomShell();

const els = {
  userName: document.getElementById('user-name'),
  backHome: document.getElementById('back-home-btn'),
  logout: document.getElementById('logout-btn'),
  refresh: document.getElementById('refresh-data-btn'),
  print: document.getElementById('print-sheet-btn'),
  pdf: document.getElementById('download-pdf-btn'),
  generate: document.getElementById('generate-orders-btn'),
  feedback: document.getElementById('page-feedback'),
  date: document.getElementById('sheet-date-input'),
  note: document.getElementById('sheet-note-input'),
  reference: document.getElementById('sheet-reference-label'),
  saveStatus: document.getElementById('autosave-status'),
  clientView: document.getElementById('client-view-btn'),
  articleView: document.getElementById('article-view-btn'),
  supplierView: document.getElementById('supplier-view-btn'),
  summary: document.getElementById('quick-summary'),
  selectorTitle: document.getElementById('selector-title'),
  selectorCount: document.getElementById('selector-count'),
  primarySearch: document.getElementById('primary-search-input'),
  secondarySearch: document.getElementById('secondary-search-input'),
  primaryFilters: document.getElementById('primary-filter-tabs'),
  secondaryFilters: document.getElementById('secondary-filter-tabs'),
  primaryList: document.getElementById('primary-list'),
  entryTitle: document.getElementById('entry-title'),
  entrySubtitle: document.getElementById('entry-subtitle'),
  entryTable: document.getElementById('entry-table-wrap'),
  actionPreview: document.getElementById('action-preview-panel'),
  printTitle: document.getElementById('print-title'),
  printNote: document.getElementById('print-note'),
  printDate: document.getElementById('print-date'),
  printTable: document.getElementById('print-table-wrap'),
  addOutOfTariff: document.getElementById('add-out-of-tariff-btn'),
  articleModal: document.getElementById('article-modal'),
  closeArticleModal: document.getElementById('close-article-modal-btn'),
  articleSearch: document.getElementById('article-search-input'),
  articleSearchBtn: document.getElementById('article-search-btn'),
  articleResults: document.getElementById('article-results'),
};

const DRAFT_STORAGE_KEY = `alta-maree:quick-order-sheet:v4:${sessionUser.store_id || sessionUser.client_key || sessionUser.email || 'default'}`;
const AUTOSAVE_DELAY_MS = 650;

let state = {
  sheet: null,
  clients: [],
  products: [],
  entries: {},
  view: 'client',
  activeClientId: null,
  activeProductUid: null,
  activeSupplierKey: null,
  primarySearch: '',
  secondarySearch: '',
  primaryFilter: 'all',
  secondaryFilter: 'all',
  dirtyEntries: {},
  dirtyMetadata: false,
  isSaving: false,
  savePromise: null,
  saveTimer: null,
  isLoading: false,
  isDirtySinceGeneration: false,
  articleSearchResults: [],
};

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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateFr(value) {
  if (!value) return '';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('fr-FR');
}

function parseDecimal(value) {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactNumber(value, digits = 3) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString('fr-FR', { maximumFractionDigits: digits });
}

function money(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return number.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function showFeedback(message = '', type = '') {
  if (!els.feedback) return;
  els.feedback.textContent = message;
  els.feedback.className = 'page-feedback';
  if (!message) els.feedback.classList.add('hidden');
  if (type) els.feedback.classList.add(type);
}

function setSaveStatus(label, tone = '') {
  if (!els.saveStatus) return;
  els.saveStatus.textContent = label;
  els.saveStatus.dataset.tone = tone;
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

async function apiDownload(path, payload) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Erreur telechargement PDF');
  }
  return response.blob();
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function productUid(product) {
  return String(product.column_uid || product.uid || product.id || product.pricing_line_id || product.article_id);
}

function normalizeProduct(product = {}) {
  return {
    uid: productUid(product),
    column_uid: product.column_uid || productUid(product),
    article_id: product.article_id || null,
    plu: product.plu || product.plu_snapshot || '',
    designation: product.designation_snapshot || product.designation || product.article_designation || 'Article',
    family_code: product.family_code || '',
    family_name: product.family_name || '',
    sale_unit: product.sale_unit || product.price_unit || 'kg',
    price_unit: product.price_unit || product.sale_unit || 'kg',
    stock: product.supplier_available_quantity ?? product.stock ?? '',
    supplier_id: product.supplier_id || null,
    supplier_code: product.supplier_code || '',
    supplier_name: product.supplier_name || '',
    purchase_price_ht: product.purchase_price_ht ?? '',
    transport_cost_ht: product.transport_cost_ht ?? 0,
    cost_rendered_ht: product.cost_rendered_ht ?? '',
    sale_price_level_1_ht: product.sale_price_level_1_ht ?? '',
    sale_price_level_2_ht: product.sale_price_level_2_ht ?? '',
    sale_price_level_3_ht: product.sale_price_level_3_ht ?? '',
    pricing_session_id: product.pricing_session_id || null,
    pricing_line_id: product.pricing_line_id || null,
    tariff_prices: Array.isArray(product.tariff_prices) ? product.tariff_prices : [],
    removed_from_current_pricing: product.removed_from_current_pricing === true,
    out_of_tariff: product.out_of_tariff === true || product.removed_from_current_pricing === true || !product.pricing_line_id,
    price: product.price ?? product.sale_price_level_1_ht ?? '',
    display_order: Number(product.display_order || 0),
  };
}

function clientLabel(client) {
  return [client.code, client.name || client.legal_name, client.city || client.store_identifier]
    .filter(Boolean)
    .join(' - ');
}

function productLabel(product) {
  return [product.plu, product.designation].filter(Boolean).join(' - ');
}

function priceForClient(product, client) {
  if (product.out_of_tariff) return product.price || product.sale_price_level_1_ht || '';
  const level = [1, 2, 3].includes(Number(client?.tariff_level)) ? Number(client.tariff_level) : 1;
  return product[`sale_price_level_${level}_ht`] || '';
}

function entryFor(clientId, productId) {
  return state.entries[String(clientId)]?.[String(productId)] || {};
}

function setEntryValue(clientId, productId, field, value) {
  const safeClient = String(clientId);
  const safeProduct = String(productId);
  if (!state.entries[safeClient]) state.entries[safeClient] = {};
  if (!state.entries[safeClient][safeProduct]) state.entries[safeClient][safeProduct] = {};
  state.entries[safeClient][safeProduct][field] = value;
}

function dirtyEntryKey(clientId, productId) {
  return `${String(clientId)}::${String(productId)}`;
}

function markEntryDirty(clientId, productId) {
  const entry = entryFor(clientId, productId);
  state.dirtyEntries[dirtyEntryKey(clientId, productId)] = {
    client_id: String(clientId),
    column_uid: String(productId),
    colis: entry.colis || '',
    kg: entry.kg || '',
    pieces: entry.pieces || '',
  };
}

function entryQuantity(entry = {}) {
  const colis = parseDecimal(entry.colis);
  const kg = parseDecimal(entry.kg);
  const pieces = parseDecimal(entry.pieces);
  if (colis > 0 && kg > 0) return Number((colis * kg).toFixed(3));
  return Number((kg || pieces || 0).toFixed(3));
}

function productHasOrders(product) {
  return state.clients.some((client) => entryQuantity(entryFor(client.id, product.uid)) > 0);
}

function clientHasOrders(client) {
  return state.products.some((product) => entryQuantity(entryFor(client.id, product.uid)) > 0);
}

function enteredOrderLines() {
  const lines = [];
  for (const client of state.clients) {
    for (const product of state.products) {
      const entry = entryFor(client.id, product.uid);
      const quantity = entryQuantity(entry);
      if (quantity <= 0 || !product.article_id) continue;
      lines.push({ client, product, entry, quantity });
    }
  }
  return lines;
}

function supplierKey(product = {}) {
  return product.supplier_id ? String(product.supplier_id) : '__no_supplier__';
}

function supplierTitle(product = {}) {
  if (product.supplier_name || product.supplier_code) {
    return [product.supplier_code, product.supplier_name].filter(Boolean).join(' - ');
  }
  return 'Sans fournisseur';
}

function supplierGroups() {
  const groups = new Map();
  for (const product of state.products) {
    const key = supplierKey(product);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        supplier_id: product.supplier_id || null,
        supplier_code: product.supplier_code || '',
        supplier_name: product.supplier_name || '',
        label: supplierTitle(product),
        products: [],
        ordered_products: 0,
        total_quantity: 0,
      });
    }
    const group = groups.get(key);
    group.products.push(product);
    const total = productClientTotals(product);
    if (total.quantity > 0) group.ordered_products += 1;
    group.total_quantity = Number((group.total_quantity + total.quantity).toFixed(3));
  }
  return Array.from(groups.values()).sort((a, b) => {
    if (a.key === '__no_supplier__') return 1;
    if (b.key === '__no_supplier__') return -1;
    return a.label.localeCompare(b.label, 'fr');
  });
}

function productClientTotals(product) {
  const clients = [];
  let quantity = 0;
  let colis = 0;
  let kg = 0;
  let pieces = 0;
  for (const client of state.clients) {
    const entry = entryFor(client.id, product.uid);
    const lineQuantity = entryQuantity(entry);
    if (lineQuantity <= 0) continue;
    const lineColis = parseDecimal(entry.colis);
    const lineKg = parseDecimal(entry.kg);
    const linePieces = parseDecimal(entry.pieces);
    quantity += lineQuantity;
    colis += lineColis;
    pieces += linePieces;
    kg += lineColis > 0 && lineKg > 0 ? lineColis * lineKg : lineKg;
    clients.push({
      client,
      entry,
      quantity: Number(lineQuantity.toFixed(3)),
      colis: lineColis,
      kg: Number((lineColis > 0 && lineKg > 0 ? lineColis * lineKg : lineKg).toFixed(3)),
      pieces: linePieces,
    });
  }
  return {
    quantity: Number(quantity.toFixed(3)),
    colis: Number(colis.toFixed(3)),
    kg: Number(kg.toFixed(3)),
    pieces: Number(pieces.toFixed(3)),
    clients,
  };
}

function saveDraft() {
  const draft = {
    date: els.date?.value || todayIso(),
    note: els.note?.value || '',
    view: state.view,
    activeClientId: state.activeClientId,
    activeProductUid: state.activeProductUid,
    activeSupplierKey: state.activeSupplierKey,
    entries: state.entries,
    products: state.products.filter((product) => product.out_of_tariff),
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

function loadDraftForDate(date, serverUpdatedAt = null) {
  const draft = safeJsonParse(localStorage.getItem(DRAFT_STORAGE_KEY), {});
  if (!draft || draft.date !== date) return;
  const draftSavedAt = Date.parse(draft.savedAt || '');
  const serverSavedAt = Date.parse(serverUpdatedAt || '');
  if (Number.isFinite(draftSavedAt) && Number.isFinite(serverSavedAt) && draftSavedAt <= serverSavedAt) return;
  state.entries = draft.entries && typeof draft.entries === 'object' ? draft.entries : state.entries;
  state.view = ['client', 'article', 'supplier'].includes(draft.view) ? draft.view : 'client';
  state.activeClientId = draft.activeClientId || state.activeClientId;
  state.activeProductUid = draft.activeProductUid || state.activeProductUid;
  state.activeSupplierKey = draft.activeSupplierKey || state.activeSupplierKey;
  if (Array.isArray(draft.products)) {
    const existing = new Set(state.products.map((product) => String(product.uid)));
    const extra = draft.products.map(normalizeProduct).filter((product) => !existing.has(String(product.uid)));
    state.products = [...state.products, ...extra];
  }
}

function buildSheetPayload() {
  return {
    sheet_id: state.sheet?.id,
    title: state.sheet?.title || "Fiche d'appel clients",
    date: els.date?.value || todayIso(),
    notes: els.note?.value || '',
    clients: state.clients.map((client) => ({
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
    products: state.products.map((product, index) => ({
      uid: product.uid,
      column_uid: product.column_uid || product.uid,
      article_id: product.article_id,
      plu: product.plu,
      designation: product.designation,
      price: product.out_of_tariff ? product.price : priceForClient(product, { tariff_level: 1 }),
      supplier_id: product.supplier_id,
      purchase_price_ht: product.purchase_price_ht,
      transport_cost_ht: product.transport_cost_ht,
      cost_rendered_ht: product.cost_rendered_ht,
      supplier_available_quantity: product.stock,
      stock: product.stock,
      sale_price_level_1_ht: product.sale_price_level_1_ht,
      sale_price_level_2_ht: product.sale_price_level_2_ht,
      sale_price_level_3_ht: product.sale_price_level_3_ht,
      family_code: product.family_code,
      family_name: product.family_name,
      sale_unit: product.sale_unit,
      unit: product.price_unit || product.sale_unit || 'kg',
      pricing_session_id: product.pricing_session_id,
      pricing_line_id: product.pricing_line_id,
      tariff_prices: product.tariff_prices,
      out_of_tariff: product.out_of_tariff === true,
      removed_from_current_pricing: product.removed_from_current_pricing === true,
      display_order: product.display_order || index + 1,
    })),
    entries: state.entries,
  };
}

async function saveSheetToServer() {
  if (state.isLoading || !state.sheet?.id) return;
  if (state.isSaving && state.savePromise) return state.savePromise;
  const dirtyEntryKeys = Object.keys(state.dirtyEntries || {});
  const metadataDirty = state.dirtyMetadata === true;
  if (!dirtyEntryKeys.length && !metadataDirty) {
    setSaveStatus('Enregistre', 'saved');
    return;
  }

  state.savePromise = (async () => {
    setSaveStatus('Enregistrement', 'saving');
    state.isSaving = true;
    const snapshotEntries = dirtyEntryKeys.map((key) => ({ key, entry: { ...state.dirtyEntries[key] } }));
    const snapshotNotes = els.note?.value || '';
    try {
      if (metadataDirty) {
        const result = await apiSend(`/api/quick-order-sheets/${encodeURIComponent(state.sheet.id)}/metadata`, {
          notes: snapshotNotes,
        }, 'PATCH');
        if (result.sheet) {
          state.sheet = { ...state.sheet, ...result.sheet };
        }
        if ((els.note?.value || '') === snapshotNotes) state.dirtyMetadata = false;
      }

      if (snapshotEntries.length) {
        const result = await apiSend(`/api/quick-order-sheets/${encodeURIComponent(state.sheet.id)}/entries`, {
          entries: snapshotEntries.map((item) => item.entry),
        }, 'PATCH');
        if (result.order_entries) state.entries = result.order_entries;
        for (const { key, entry } of snapshotEntries) {
          if (JSON.stringify(state.dirtyEntries[key]) === JSON.stringify(entry)) {
            delete state.dirtyEntries[key];
          }
        }
      }
      setSaveStatus('Enregistre', 'saved');
    } finally {
      state.isSaving = false;
      state.savePromise = null;
      if (Object.keys(state.dirtyEntries || {}).length || state.dirtyMetadata) {
        window.clearTimeout(state.saveTimer);
        state.saveTimer = window.setTimeout(() => {
          saveSheetToServer().catch((error) => {
            console.error('Erreur autosave fiche appel:', error);
            setSaveStatus('Erreur sauvegarde', 'error');
            showFeedback(error.message || 'Erreur sauvegarde fiche appel', 'error');
          });
        }, AUTOSAVE_DELAY_MS);
      }
    }
  })();

  return state.savePromise;
}

function queueSave(markDirty = true) {
  if (markDirty) state.isDirtySinceGeneration = true;
  saveDraft();
  window.clearTimeout(state.saveTimer);
  setSaveStatus('A enregistrer', 'pending');
  state.saveTimer = window.setTimeout(() => {
    saveSheetToServer().catch((error) => {
      console.error('Erreur autosave fiche appel:', error);
      setSaveStatus('Erreur sauvegarde', 'error');
      showFeedback(error.message || 'Erreur sauvegarde fiche appel', 'error');
    });
  }, AUTOSAVE_DELAY_MS);
}

async function flushPendingAutosave() {
  window.clearTimeout(state.saveTimer);
  if (state.savePromise) await state.savePromise;
  if (Object.keys(state.dirtyEntries || {}).length || state.dirtyMetadata) {
    await saveSheetToServer();
  }
  if (Object.keys(state.dirtyEntries || {}).length || state.dirtyMetadata) {
    throw new Error('Certaines saisies ne sont pas encore enregistrees');
  }
}

async function loadClients() {
  const data = await apiGet('/api/clients?status=active');
  state.clients = (Array.isArray(data) ? data : []).sort((a, b) => clientLabel(a).localeCompare(clientLabel(b), 'fr'));
}

async function loadSheet() {
  const date = els.date?.value || todayIso();
  const data = await apiGet(`/api/quick-order-sheets/by-date?date=${encodeURIComponent(date)}`);
  state.sheet = data.sheet;
  state.products = (Array.isArray(data.sheet?.products) ? data.sheet.products : [])
    .map(normalizeProduct)
    .sort((a, b) => (a.display_order - b.display_order) || productLabel(a).localeCompare(productLabel(b), 'fr'));
  state.entries = data.sheet?.order_entries && typeof data.sheet.order_entries === 'object' ? data.sheet.order_entries : {};
  state.isDirtySinceGeneration = false;
  if (els.note) els.note.value = data.sheet?.notes || '';
  if (els.reference) els.reference.textContent = String(data.sheet?.id || '-').slice(0, 8).toUpperCase();
  loadDraftForDate(date, data.sheet?.updated_at);
  if (!state.activeClientId || !state.clients.some((client) => String(client.id) === String(state.activeClientId))) {
    state.activeClientId = state.clients[0]?.id || null;
  }
  if (!state.activeProductUid || !state.products.some((product) => String(product.uid) === String(state.activeProductUid))) {
    state.activeProductUid = state.products[0]?.uid || null;
  }
  if (!state.activeSupplierKey || !supplierGroups().some((group) => String(group.key) === String(state.activeSupplierKey))) {
    state.activeSupplierKey = supplierGroups()[0]?.key || null;
  }
  state.dirtyEntries = {};
  state.dirtyMetadata = false;
  setSaveStatus('Enregistre', 'saved');
}

function itemMatchesSearch(item, search, type) {
  const haystack = type === 'client'
    ? [item.name, item.legal_name, item.code, item.city, item.store_identifier].join(' ')
    : type === 'supplier'
      ? [item.supplier_code, item.supplier_name, item.label].join(' ')
    : [item.designation, item.plu, item.family_code, item.family_name].join(' ');
  return normalizeText(haystack).includes(normalizeText(search));
}

function filteredPrimaryItems() {
  const items = state.view === 'client' ? state.clients : (state.view === 'supplier' ? supplierGroups() : state.products);
  const search = state.primarySearch;
  return items.filter((item) => {
    const has = state.view === 'client'
      ? clientHasOrders(item)
      : state.view === 'supplier'
        ? item.ordered_products > 0
        : productHasOrders(item);
    if (state.primaryFilter === 'with' && !has) return false;
    if (state.primaryFilter === 'without' && has) return false;
    return itemMatchesSearch(item, search, state.view);
  });
}

function filteredSecondaryItems() {
  if (state.view === 'supplier') {
    const group = supplierGroups().find((row) => String(row.key) === String(state.activeSupplierKey));
    const products = group?.products || [];
    return products
      .map((product) => ({ product, totals: productClientTotals(product) }))
      .filter((item) => {
        const has = item.totals.quantity > 0;
        if (state.secondaryFilter === 'with' && !has) return false;
        if (state.secondaryFilter === 'without' && has) return false;
        return itemMatchesSearch(item.product, state.secondarySearch, 'article');
      });
  }
  const items = state.view === 'client' ? state.products : state.clients;
  const search = state.secondarySearch;
  return items.filter((item) => {
    const has = state.view === 'client'
      ? entryQuantity(entryFor(state.activeClientId, item.uid)) > 0
      : entryQuantity(entryFor(item.id, state.activeProductUid)) > 0;
    if (state.secondaryFilter === 'with' && !has) return false;
    if (state.secondaryFilter === 'without' && has) return false;
    return itemMatchesSearch(item, search, state.view === 'client' ? 'article' : 'client');
  });
}

function renderSummary() {
  const lines = enteredOrderLines();
  const clientsWithOrders = state.clients.filter(clientHasOrders).length;
  const productsWithOrders = state.products.filter(productHasOrders).length;
  const suppliersWithOrders = supplierGroups().filter((group) => group.ordered_products > 0).length;
  const generated = Array.isArray(state.sheet?.generated_order_ids) && state.sheet.generated_order_ids.length > 0;
  els.summary.innerHTML = `
    <span>${state.products.length} article(s) du jour</span>
    <span>${state.clients.length} client(s) actif(s)</span>
    <span>${lines.length} ligne(s) saisie(s)</span>
    <span>${clientsWithOrders} client(s) avec commande</span>
    <span>${productsWithOrders} article(s) commandes</span>
    <span>${suppliersWithOrders} fournisseur(s)</span>
    <span class="${generated ? (state.isDirtySinceGeneration ? 'generation-dirty' : 'generation-done') : ''}">
      ${generated ? (state.isDirtySinceGeneration ? 'Modifie apres generation' : 'Commandes generees') : 'Non genere'}
    </span>
  `;
}

function renderModeButtons() {
  els.clientView?.classList.toggle('active', state.view === 'client');
  els.articleView?.classList.toggle('active', state.view === 'article');
  els.supplierView?.classList.toggle('active', state.view === 'supplier');
  els.selectorTitle.textContent = state.view === 'client' ? 'Clients' : (state.view === 'supplier' ? 'Fournisseurs' : 'Articles');
  els.primarySearch.placeholder = state.view === 'client'
    ? 'Nom, code, ville'
    : state.view === 'supplier'
      ? 'Nom ou code fournisseur'
      : 'Designation, code, PLU';
  els.secondarySearch.placeholder = state.view === 'client'
    ? 'Rechercher un article'
    : state.view === 'supplier'
      ? 'Rechercher un article fournisseur'
      : 'Rechercher un client';
  els.addOutOfTariff?.classList.toggle('hidden', state.view === 'supplier');
}

function renderPrimaryList() {
  const items = filteredPrimaryItems();
  els.selectorCount.textContent = String(items.length);
  if (!items.length) {
    els.primaryList.innerHTML = '<div class="empty-list">Aucun resultat.</div>';
    return;
  }
  els.primaryList.innerHTML = items.map((item) => {
    const id = state.view === 'client' ? item.id : (state.view === 'supplier' ? item.key : item.uid);
    const active = state.view === 'client'
      ? String(id) === String(state.activeClientId)
      : state.view === 'supplier'
        ? String(id) === String(state.activeSupplierKey)
        : String(id) === String(state.activeProductUid);
    const has = state.view === 'client'
      ? clientHasOrders(item)
      : state.view === 'supplier'
        ? item.ordered_products > 0
        : productHasOrders(item);
    const title = state.view === 'client' ? (item.name || item.legal_name || 'Client') : (state.view === 'supplier' ? item.label : item.designation);
    const meta = state.view === 'client'
      ? [item.code, item.city, item.store_identifier].filter(Boolean).join(' - ')
      : state.view === 'supplier'
        ? [
          `${item.products.length} article(s)`,
          item.ordered_products ? `${item.ordered_products} commande(s)` : 'sans commande',
        ].filter(Boolean).join(' - ')
        : [
          item.plu,
          item.removed_from_current_pricing ? 'retire de la tarification actuelle' : (item.out_of_tariff ? 'hors tarif' : 'tarification'),
          item.family_name,
        ].filter(Boolean).join(' - ');
    return `
      <button class="selector-row ${active ? 'active' : ''}" type="button" data-id="${escapeHtml(id)}">
        <span>
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(meta || '-')}</small>
        </span>
        <em class="${has ? 'has-order' : ''}">${has ? 'Saisi' : '-'}</em>
      </button>
    `;
  }).join('');
}

function quantityInput(clientId, productUidValue, field, label) {
  const entry = entryFor(clientId, productUidValue);
  return `
    <label class="qty-field">
      <span>${label}</span>
      <input class="qos-input" type="text" inputmode="decimal"
        data-client-id="${escapeHtml(clientId)}"
        data-product-uid="${escapeHtml(productUidValue)}"
        data-field="${field}"
        value="${escapeHtml(entry[field] || '')}" />
    </label>
  `;
}

function renderClientViewTable(client) {
  const products = filteredSecondaryItems();
  if (!client) {
    els.entryTable.innerHTML = '<div class="empty-list">Aucun client actif.</div>';
    return;
  }
  els.entryTitle.textContent = client.name || client.legal_name || 'Client';
  els.entrySubtitle.textContent = [client.code, client.city, `Tarif ${client.tariff_level || 1}`].filter(Boolean).join(' - ');
  if (!products.length) {
    els.entryTable.innerHTML = '<div class="empty-list">Aucun article pour cette recherche.</div>';
    return;
  }
  els.entryTable.innerHTML = `
    <table class="entry-table">
      <thead>
        <tr>
          <th>Article</th>
          <th>Prix client</th>
          <th>Dispo</th>
          <th>Colis</th>
          <th>Pieces</th>
          <th>Poids</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${products.map((product) => {
          const entry = entryFor(client.id, product.uid);
          return `
            <tr class="${entryQuantity(entry) > 0 ? 'row-has-order' : ''}">
              <th>
                <strong>${escapeHtml(product.designation)}</strong>
                <small>${escapeHtml([product.plu, product.removed_from_current_pricing ? 'retire de la tarification actuelle' : (product.out_of_tariff ? 'hors tarif' : 'tarif publie')].filter(Boolean).join(' - '))}</small>
              </th>
              <td class="num">${escapeHtml(money(priceForClient(product, client)) || '-')}</td>
              <td class="num">${escapeHtml(compactNumber(product.stock))}</td>
              <td>${quantityInput(client.id, product.uid, 'colis', 'Colis')}</td>
              <td>${quantityInput(client.id, product.uid, 'pieces', 'Pieces')}</td>
              <td>${quantityInput(client.id, product.uid, 'kg', 'Kg')}</td>
              <td class="num strong">${escapeHtml(compactNumber(entryQuantity(entry)))}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function renderArticleViewTable(product) {
  const clients = filteredSecondaryItems();
  if (!product) {
    els.entryTable.innerHTML = '<div class="empty-list">Aucun article tarifie pour cette date.</div>';
    return;
  }
  els.entryTitle.textContent = product.designation;
  els.entrySubtitle.textContent = [
    product.plu,
    product.removed_from_current_pricing ? 'Retire de la tarification actuelle' : (product.out_of_tariff ? 'Article hors tarif' : 'Tarification publiee'),
    product.family_name,
  ].filter(Boolean).join(' - ');
  if (!clients.length) {
    els.entryTable.innerHTML = '<div class="empty-list">Aucun client pour cette recherche.</div>';
    return;
  }
  els.entryTable.innerHTML = `
    <table class="entry-table">
      <thead>
        <tr>
          <th>Client</th>
          <th>Prix client</th>
          <th>Colis</th>
          <th>Pieces</th>
          <th>Poids</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${clients.map((client) => {
          const entry = entryFor(client.id, product.uid);
          return `
            <tr class="${entryQuantity(entry) > 0 ? 'row-has-order' : ''}">
              <th>
                <strong>${escapeHtml(client.name || client.legal_name || 'Client')}</strong>
                <small>${escapeHtml([client.code, client.city, client.store_identifier].filter(Boolean).join(' - '))}</small>
              </th>
              <td class="num">${escapeHtml(money(priceForClient(product, client)) || '-')}</td>
              <td>${quantityInput(client.id, product.uid, 'colis', 'Colis')}</td>
              <td>${quantityInput(client.id, product.uid, 'pieces', 'Pieces')}</td>
              <td>${quantityInput(client.id, product.uid, 'kg', 'Kg')}</td>
              <td class="num strong">${escapeHtml(compactNumber(entryQuantity(entry)))}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function renderSupplierViewTable(group) {
  if (!group) {
    els.entryTitle.textContent = 'Fournisseur';
    els.entrySubtitle.textContent = 'Aucun fournisseur disponible pour cette fiche.';
    els.entryTable.innerHTML = '<div class="empty-list">Aucun fournisseur pour cette recherche.</div>';
    return;
  }
  const products = filteredSecondaryItems();
  els.entryTitle.textContent = group.label;
  els.entrySubtitle.textContent = [
    `${group.products.length} article(s) du jour`,
    group.ordered_products ? `${group.ordered_products} article(s) avec commande` : 'Aucune commande saisie',
  ].join(' - ');
  if (!products.length) {
    els.entryTable.innerHTML = '<div class="empty-list">Aucun article fournisseur pour cette recherche.</div>';
    return;
  }
  els.entryTable.innerHTML = `
    <table class="entry-table supplier-total-table">
      <thead>
        <tr>
          <th>Article</th>
          <th>Total clients</th>
          <th>Colis</th>
          <th>Pieces</th>
          <th>Kg</th>
          <th>Detail clients</th>
        </tr>
      </thead>
      <tbody>
        ${products.map(({ product, totals }) => `
          <tr class="${totals.quantity > 0 ? 'row-has-order' : ''}">
            <th>
              <strong>${escapeHtml(product.designation)}</strong>
              <small>${escapeHtml([product.plu, product.family_name, product.sale_unit].filter(Boolean).join(' - '))}</small>
            </th>
            <td class="num strong">${escapeHtml(compactNumber(totals.quantity))}</td>
            <td class="num">${escapeHtml(compactNumber(totals.colis) || '-')}</td>
            <td class="num">${escapeHtml(compactNumber(totals.pieces) || '-')}</td>
            <td class="num">${escapeHtml(compactNumber(totals.kg) || '-')}</td>
            <td>
              ${totals.clients.length ? `
                <details class="supplier-detail">
                  <summary>${totals.clients.length} client(s)</summary>
                  <div class="supplier-detail-list">
                    ${totals.clients.map((line) => `
                      <div>
                        <strong>${escapeHtml(clientLabel(line.client))}</strong>
                        <span>${escapeHtml([
                          line.colis ? `${compactNumber(line.colis)} colis` : '',
                          line.pieces ? `${compactNumber(line.pieces)} pieces` : '',
                          line.kg ? `${compactNumber(line.kg)} kg` : '',
                        ].filter(Boolean).join(' - ') || compactNumber(line.quantity))}</span>
                      </div>
                    `).join('')}
                  </div>
                </details>
              ` : '-'}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderEntryTable() {
  if (state.view === 'client') {
    const client = state.clients.find((row) => String(row.id) === String(state.activeClientId));
    renderClientViewTable(client);
  } else if (state.view === 'supplier') {
    const group = supplierGroups().find((row) => String(row.key) === String(state.activeSupplierKey));
    renderSupplierViewTable(group);
  } else {
    const product = state.products.find((row) => String(row.uid) === String(state.activeProductUid));
    renderArticleViewTable(product);
  }
}

function renderPrintableSheet() {
  const lines = enteredOrderLines();
  els.printTitle.textContent = "Fiche d'appel clients";
  els.printNote.textContent = els.note?.value || 'Arrivage du jour';
  els.printDate.textContent = formatDateFr(els.date?.value || todayIso());
  els.printTable.innerHTML = `
    <table class="print-lines-table">
      <thead><tr><th>Client</th><th>Article</th><th>Colis</th><th>Pieces</th><th>Kg</th><th>Total</th><th>Prix</th></tr></thead>
      <tbody>
        ${lines.map((line) => `
          <tr>
            <td>${escapeHtml(clientLabel(line.client))}</td>
            <td>${escapeHtml(productLabel(line.product))}</td>
            <td>${escapeHtml(line.entry.colis || '')}</td>
            <td>${escapeHtml(line.entry.pieces || '')}</td>
            <td>${escapeHtml(line.entry.kg || '')}</td>
            <td>${escapeHtml(compactNumber(line.quantity))}</td>
            <td>${escapeHtml(money(priceForClient(line.product, line.client)) || '-')}</td>
          </tr>
        `).join('') || '<tr><td colspan="7">Aucune commande saisie.</td></tr>'}
      </tbody>
    </table>
  `;
}

function render() {
  renderModeButtons();
  renderSummary();
  renderPrimaryList();
  renderEntryTable();
  renderPrintableSheet();
}

async function refreshData() {
  state.isLoading = true;
  setSaveStatus('Chargement', 'saving');
  showFeedback('Chargement de la fiche...', '');
  try {
    await loadClients();
    await loadSheet();
    render();
    showFeedback(`Fiche du ${formatDateFr(els.date.value)} prete.`, 'success');
  } catch (error) {
    console.error('Erreur chargement fiche appel:', error);
    showFeedback(error.message || 'Erreur chargement fiche appel', 'error');
    setSaveStatus('Erreur chargement', 'error');
  } finally {
    state.isLoading = false;
  }
}

function setView(view) {
  state.view = ['client', 'article', 'supplier'].includes(view) ? view : 'client';
  state.primarySearch = '';
  state.secondarySearch = '';
  state.primaryFilter = 'all';
  state.secondaryFilter = state.view === 'supplier' ? 'with' : 'all';
  els.primarySearch.value = '';
  els.secondarySearch.value = '';
  els.primaryFilters?.querySelectorAll('.filter-chip').forEach((button) => {
    button.classList.toggle('active', button.dataset.filter === state.primaryFilter);
  });
  els.secondaryFilters?.querySelectorAll('.filter-chip').forEach((button) => {
    button.classList.toggle('active', button.dataset.filter === state.secondaryFilter);
  });
  render();
  saveDraft();
}

function selectPrimary(id) {
  if (state.view === 'client') state.activeClientId = id;
  else if (state.view === 'supplier') state.activeSupplierKey = id;
  else state.activeProductUid = id;
  render();
  saveDraft();
}

function setFilter(container, value, primary = true) {
  if (primary) state.primaryFilter = value;
  else state.secondaryFilter = value;
  container.querySelectorAll('.filter-chip').forEach((button) => {
    button.classList.toggle('active', button.dataset.filter === value);
  });
  render();
}

function moveToNextInput(current) {
  const inputs = Array.from(els.entryTable.querySelectorAll('.qos-input'));
  const index = inputs.indexOf(current);
  const next = inputs[index + 1] || inputs[0];
  next?.focus();
  next?.select();
}

function renderActionPreview(title, html) {
  els.actionPreview.classList.remove('hidden');
  els.actionPreview.innerHTML = `<h3>${escapeHtml(title)}</h3>${html}`;
}

function orderLinksHtml(orders = []) {
  if (!orders.length) return '';
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

function renderGeneratedOrders(result) {
  const orders = Array.isArray(result.orders) ? result.orders : [];
  const count = orders.length || result.order_ids?.length || 0;
  const delta = result.delta || {};
  const deltaText = result.noop
    ? 'Tout est deja genere.'
    : [
        delta.created ? `${delta.created} ligne(s) creee(s)` : null,
        delta.updated ? `${delta.updated} ligne(s) mise(s) a jour` : null,
        delta.moved ? `${delta.moved} ligne(s) deplacee(s)` : null,
        delta.deleted ? `${delta.deleted} ligne(s) supprimee(s)` : null,
      ].filter(Boolean).join(' - ');
  renderActionPreview(result.existing || result.noop ? 'Commandes deja generees' : 'Commandes mises a jour', `
    <p>${deltaText || `${count} commande(s) concernee(s).`}</p>
    ${orderLinksHtml(orders)}
  `);
}

async function generateOrders(forceRegenerate = false) {
  const lines = enteredOrderLines();
  const generatedCount = Array.isArray(state.sheet?.generated_order_ids) ? state.sheet.generated_order_ids.length : 0;
  if (!lines.length && !generatedCount) {
    showFeedback('Aucune quantite a transformer en commande.', 'success');
    return;
  }
  const missingPrice = lines.find((line) => parseDecimal(priceForClient(line.product, line.client)) <= 0);
  if (missingPrice) {
    showFeedback(`Prix strictement positif requis pour ${productLabel(missingPrice.product)} / ${clientLabel(missingPrice.client)}.`, 'error');
    return;
  }
  const confirmLabel = generatedCount
    ? `${lines.length} ligne(s) seront comparees avec les commandes deja generees. Synchroniser le delta ?`
    : `${lines.length} ligne(s) seront generees en commandes. Continuer ?`;
  const confirmed = window.confirm(confirmLabel);
  if (!confirmed) return;
  try {
    try {
      await flushPendingAutosave();
    } catch (saveError) {
      console.error('Flush autosave impossible avant generation:', saveError);
      showFeedback('Impossible de generer les commandes : certaines saisies ne sont pas encore enregistrees.', 'error');
      return;
    }
    const result = await apiSend('/api/quick-order-sheets/generate-orders', {
      sheet_id: state.sheet?.id,
      confirm_generate: true,
      force_regenerate: forceRegenerate,
    });
    state.sheet.generated_order_ids = result.order_ids || [];
    state.sheet.generated_at = new Date().toISOString();
    state.isDirtySinceGeneration = false;
    saveDraft();
    render();
    renderGeneratedOrders(result);
    showFeedback(result.noop ? 'Tout est deja genere.' : 'Commandes generees ou mises a jour.', 'success');
  } catch (error) {
    console.error('Erreur generation commandes:', error);
    if (error.status === 409 && error.data?.can_regenerate) {
      renderActionPreview('Generation deja existante', `
        <p>${escapeHtml(error.data.error || 'Cette fiche a deja genere des commandes.')}</p>
        ${orderLinksHtml(error.data.orders || [])}
        <div class="action-preview-actions">
          <button class="btn btn-primary btn-sm" type="button" data-action="force-regenerate-orders">Recreer les commandes brouillon</button>
        </div>
      `);
    } else if (error.status === 409 && Array.isArray(error.data?.conflicts)) {
      renderActionPreview('Commandes deja engagees', `
        <p>${escapeHtml(error.data.error || 'Certaines commandes ne peuvent pas etre modifiees automatiquement.')}</p>
        ${orderLinksHtml(error.data.orders || [])}
      `);
    }
    showFeedback(error.message || 'Erreur generation commandes', 'error');
  }
}

async function downloadSheetPdf() {
  try {
    await saveSheetToServer();
    const blob = await apiDownload('/api/quick-order-sheets/pdf', buildSheetPayload());
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Fiche_appel_ALTA_MAREE_${els.date.value || todayIso()}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showFeedback('PDF genere.', 'success');
  } catch (error) {
    showFeedback(error.message || 'Erreur generation PDF', 'error');
  }
}

async function searchArticles(term) {
  const query = new URLSearchParams({
    search: term,
    active: 'true',
    article_category: 'product',
    limit: '100',
  });
  if (activeDepartment?.id) query.set('department_id', activeDepartment.id);
  const data = await apiGet(`/api/articles?${query.toString()}`);
  return Array.isArray(data) ? data : [];
}

function openArticleModal() {
  els.articleModal.classList.remove('hidden');
  els.articleSearch.value = '';
  els.articleResults.innerHTML = '<div class="empty-list">Rechercher un article a ajouter hors tarif.</div>';
  els.articleSearch.focus();
}

function closeArticleModal() {
  els.articleModal.classList.add('hidden');
  state.articleSearchResults = [];
}

function renderArticleResults() {
  if (!state.articleSearchResults.length) {
    els.articleResults.innerHTML = '<div class="empty-list">Aucun article trouve.</div>';
    return;
  }
  els.articleResults.innerHTML = state.articleSearchResults.map((article, index) => `
    <button class="article-result-row" type="button" data-result-index="${index}">
      <span>
        <strong>${escapeHtml(article.designation || article.display_name || 'Article')}</strong>
        <small>${escapeHtml([article.plu, article.family_name].filter(Boolean).join(' - '))}</small>
      </span>
      <span class="article-result-meta">Hors tarif</span>
    </button>
  `).join('');
}

async function runArticleSearch() {
  const term = els.articleSearch.value.trim();
  if (term.length < 2) {
    els.articleResults.innerHTML = '<div class="empty-list">Saisir au moins 2 caracteres.</div>';
    return;
  }
  els.articleResults.innerHTML = '<div class="empty-list">Recherche...</div>';
  try {
    state.articleSearchResults = await searchArticles(term);
    renderArticleResults();
  } catch (error) {
    els.articleResults.innerHTML = `<div class="empty-list">${escapeHtml(error.message || 'Erreur recherche')}</div>`;
  }
}

async function addOutOfTariffArticle(index) {
  const article = state.articleSearchResults[index];
  if (!article) return;
  const price = window.prompt(`Prix HT obligatoire pour ${article.designation || article.display_name || article.plu || 'article'} ?`);
  if (parseDecimal(price) <= 0) {
    showFeedback('Article hors tarif non ajoute : prix strictement positif obligatoire.', 'error');
    return;
  }
  const uid = `manual-${article.id}-${Date.now().toString(36)}`;
  const product = normalizeProduct({
    uid,
    column_uid: uid,
    article_id: article.id,
    plu: article.plu || '',
    designation: article.designation || article.display_name || 'Article hors tarif',
    sale_unit: article.sale_unit || article.unit || 'kg',
    price_unit: article.unit || article.sale_unit || 'kg',
    sale_price_level_1_ht: price,
    sale_price_level_2_ht: price,
    sale_price_level_3_ht: price,
    price,
    out_of_tariff: true,
    display_order: state.products.length + 1,
  });
  state.products.push(product);
  state.activeProductUid = product.uid;
  state.activeSupplierKey = supplierKey(product);
  closeArticleModal();
  render();
  saveDraft();
  setSaveStatus('Enregistrement', 'saving');
  try {
    const result = await apiSend(`/api/quick-order-sheets/${encodeURIComponent(state.sheet.id)}/products/out-of-tariff`, { product }, 'POST');
    if (result.sheet) {
      state.sheet = result.sheet;
      state.products = (Array.isArray(result.sheet.products) ? result.sheet.products : [])
        .map(normalizeProduct)
        .sort((a, b) => (a.display_order - b.display_order) || productLabel(a).localeCompare(productLabel(b), 'fr'));
      state.entries = result.sheet.order_entries || state.entries;
    }
    setSaveStatus('Enregistre', 'saved');
    render();
    saveDraft();
    showFeedback('Article hors tarif ajoute.', 'success');
  } catch (error) {
    console.error('Erreur ajout article hors tarif:', error);
    setSaveStatus('Erreur sauvegarde', 'error');
    showFeedback(error.message || 'Erreur ajout article hors tarif', 'error');
  }
}

function initEvents() {
  els.backHome?.addEventListener('click', () => { window.location.href = './home.html'; });
  els.logout?.addEventListener('click', () => {
    ['gc_token', 'gc_user', 'gc_active_department', 'grv2_token', 'grv2_user', 'grv2_active_department'].forEach((key) => localStorage.removeItem(key));
    window.location.href = './login.html';
  });
  els.refresh?.addEventListener('click', refreshData);
  els.print?.addEventListener('click', () => {
    renderPrintableSheet();
    window.print();
  });
  els.pdf?.addEventListener('click', downloadSheetPdf);
  els.generate?.addEventListener('click', () => generateOrders(false));
  els.clientView?.addEventListener('click', () => setView('client'));
  els.articleView?.addEventListener('click', () => setView('article'));
  els.supplierView?.addEventListener('click', () => setView('supplier'));
  els.date?.addEventListener('change', async () => {
    state.entries = {};
    state.products = [];
    state.activeClientId = null;
    state.activeProductUid = null;
    await refreshData();
  });
  els.note?.addEventListener('input', () => {
    state.dirtyMetadata = true;
    renderPrintableSheet();
    queueSave(false);
  });
  els.primarySearch?.addEventListener('input', () => {
    state.primarySearch = els.primarySearch.value;
    renderPrimaryList();
  });
  els.secondarySearch?.addEventListener('input', () => {
    state.secondarySearch = els.secondarySearch.value;
    renderEntryTable();
  });
  els.primaryFilters?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (button) setFilter(els.primaryFilters, button.dataset.filter, true);
  });
  els.secondaryFilters?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (button) setFilter(els.secondaryFilters, button.dataset.filter, false);
  });
  els.primaryList?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-id]');
    if (row) selectPrimary(row.dataset.id);
  });
  els.entryTable?.addEventListener('input', (event) => {
    const input = event.target.closest('[data-field]');
    if (!input) return;
    setEntryValue(input.dataset.clientId, input.dataset.productUid, input.dataset.field, input.value);
    markEntryDirty(input.dataset.clientId, input.dataset.productUid);
    renderSummary();
    renderPrintableSheet();
    if (state.view === 'supplier') renderEntryTable();
    queueSave(true);
  });
  els.entryTable?.addEventListener('keydown', (event) => {
    const input = event.target.closest('[data-field]');
    if (!input || event.key !== 'Enter') return;
    event.preventDefault();
    moveToNextInput(input);
  });
  els.actionPreview?.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="force-regenerate-orders"]')) {
      const confirmed = window.confirm('Supprimer les commandes brouillon de cette fiche et regenerer avec les saisies actuelles ?');
      if (confirmed) generateOrders(true);
    }
    if (event.target.closest('[data-action="open-sales-orders"]')) {
      localStorage.setItem('gc_sales_section', 'orders');
      window.location.href = './sales.html';
    }
  });
  els.addOutOfTariff?.addEventListener('click', openArticleModal);
  els.closeArticleModal?.addEventListener('click', closeArticleModal);
  els.articleModal?.addEventListener('click', (event) => {
    if (event.target === els.articleModal) closeArticleModal();
  });
  els.articleSearchBtn?.addEventListener('click', runArticleSearch);
  els.articleSearch?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runArticleSearch();
    }
    if (event.key === 'Escape') closeArticleModal();
  });
  els.articleResults?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-result-index]');
    if (row) addOutOfTariffArticle(Number(row.dataset.resultIndex));
  });
}

function init() {
  if (els.userName) els.userName.textContent = sessionUser.email || 'Utilisateur';
  if (els.date) els.date.value = todayIso();
  if (els.note) els.note.value = 'Arrivage du jour';
  initEvents();
  refreshData();
}

init();
