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
  primarySearch: '',
  secondarySearch: '',
  primaryFilter: 'all',
  secondaryFilter: 'all',
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

function saveDraft() {
  const draft = {
    date: els.date?.value || todayIso(),
    note: els.note?.value || '',
    view: state.view,
    activeClientId: state.activeClientId,
    activeProductUid: state.activeProductUid,
    entries: state.entries,
    products: state.products.filter((product) => product.out_of_tariff),
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

function loadDraftForDate(date) {
  const draft = safeJsonParse(localStorage.getItem(DRAFT_STORAGE_KEY), {});
  if (!draft || draft.date !== date) return;
  state.entries = draft.entries && typeof draft.entries === 'object' ? draft.entries : state.entries;
  state.view = draft.view === 'article' ? 'article' : 'client';
  state.activeClientId = draft.activeClientId || state.activeClientId;
  state.activeProductUid = draft.activeProductUid || state.activeProductUid;
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
  setSaveStatus('Enregistrement', 'saving');
  const result = await apiSend('/api/quick-order-sheets/by-date', buildSheetPayload(), 'PUT');
  if (result.sheet) {
    state.sheet = result.sheet;
    state.entries = result.sheet.order_entries || state.entries;
  }
  setSaveStatus('Enregistre', 'saved');
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
  loadDraftForDate(date);
  if (!state.activeClientId || !state.clients.some((client) => String(client.id) === String(state.activeClientId))) {
    state.activeClientId = state.clients[0]?.id || null;
  }
  if (!state.activeProductUid || !state.products.some((product) => String(product.uid) === String(state.activeProductUid))) {
    state.activeProductUid = state.products[0]?.uid || null;
  }
  setSaveStatus('Enregistre', 'saved');
}

function itemMatchesSearch(item, search, type) {
  const haystack = type === 'client'
    ? [item.name, item.legal_name, item.code, item.city, item.store_identifier].join(' ')
    : [item.designation, item.plu, item.family_code, item.family_name].join(' ');
  return normalizeText(haystack).includes(normalizeText(search));
}

function filteredPrimaryItems() {
  const items = state.view === 'client' ? state.clients : state.products;
  const search = state.primarySearch;
  return items.filter((item) => {
    const has = state.view === 'client' ? clientHasOrders(item) : productHasOrders(item);
    if (state.primaryFilter === 'with' && !has) return false;
    if (state.primaryFilter === 'without' && has) return false;
    return itemMatchesSearch(item, search, state.view);
  });
}

function filteredSecondaryItems() {
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
  const generated = Array.isArray(state.sheet?.generated_order_ids) && state.sheet.generated_order_ids.length > 0;
  els.summary.innerHTML = `
    <span>${state.products.length} article(s) du jour</span>
    <span>${state.clients.length} client(s) actif(s)</span>
    <span>${lines.length} ligne(s) saisie(s)</span>
    <span>${clientsWithOrders} client(s) avec commande</span>
    <span>${productsWithOrders} article(s) commandes</span>
    <span class="${generated ? (state.isDirtySinceGeneration ? 'generation-dirty' : 'generation-done') : ''}">
      ${generated ? (state.isDirtySinceGeneration ? 'Modifie apres generation' : 'Commandes generees') : 'Non genere'}
    </span>
  `;
}

function renderModeButtons() {
  els.clientView?.classList.toggle('active', state.view === 'client');
  els.articleView?.classList.toggle('active', state.view === 'article');
  els.selectorTitle.textContent = state.view === 'client' ? 'Clients' : 'Articles';
  els.primarySearch.placeholder = state.view === 'client' ? 'Nom, code, ville' : 'Designation, code, PLU';
  els.secondarySearch.placeholder = state.view === 'client' ? 'Rechercher un article' : 'Rechercher un client';
}

function renderPrimaryList() {
  const items = filteredPrimaryItems();
  els.selectorCount.textContent = String(items.length);
  if (!items.length) {
    els.primaryList.innerHTML = '<div class="empty-list">Aucun resultat.</div>';
    return;
  }
  els.primaryList.innerHTML = items.map((item) => {
    const id = state.view === 'client' ? item.id : item.uid;
    const active = state.view === 'client'
      ? String(id) === String(state.activeClientId)
      : String(id) === String(state.activeProductUid);
    const has = state.view === 'client' ? clientHasOrders(item) : productHasOrders(item);
    const title = state.view === 'client' ? (item.name || item.legal_name || 'Client') : item.designation;
    const meta = state.view === 'client'
      ? [item.code, item.city, item.store_identifier].filter(Boolean).join(' - ')
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

function renderEntryTable() {
  if (state.view === 'client') {
    const client = state.clients.find((row) => String(row.id) === String(state.activeClientId));
    renderClientViewTable(client);
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
  state.view = view === 'article' ? 'article' : 'client';
  state.primarySearch = '';
  state.secondarySearch = '';
  els.primarySearch.value = '';
  els.secondarySearch.value = '';
  render();
  saveDraft();
}

function selectPrimary(id) {
  if (state.view === 'client') state.activeClientId = id;
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
  renderActionPreview(result.existing ? 'Commandes deja generees' : 'Commandes creees', `
    <p>${result.existing ? 'Aucun doublon cree : la generation existante est reutilisee.' : `${count} commande(s) creee(s).`}</p>
    ${orderLinksHtml(orders)}
  `);
}

async function generateOrders() {
  const lines = enteredOrderLines();
  if (!lines.length) {
    showFeedback('Aucune quantite a transformer en commande.', 'error');
    return;
  }
  const missingPrice = lines.find((line) => parseDecimal(priceForClient(line.product, line.client)) <= 0);
  if (missingPrice) {
    showFeedback(`Prix strictement positif requis pour ${productLabel(missingPrice.product)} / ${clientLabel(missingPrice.client)}.`, 'error');
    return;
  }
  if (state.sheet?.generated_order_ids?.length && !state.isDirtySinceGeneration) {
    renderGeneratedOrders({ existing: true, order_ids: state.sheet.generated_order_ids, orders: [] });
    showFeedback('Commandes deja generees pour cette fiche.', 'success');
    return;
  }
  const confirmed = window.confirm(`${lines.length} ligne(s) seront generees en commandes. Continuer ?`);
  if (!confirmed) return;
  try {
    await saveSheetToServer();
    const result = await apiSend('/api/quick-order-sheets/generate-orders', {
      ...buildSheetPayload(),
      confirm_generate: true,
    });
    state.sheet.generated_order_ids = result.order_ids || [];
    state.sheet.generated_at = new Date().toISOString();
    state.isDirtySinceGeneration = false;
    saveDraft();
    render();
    renderGeneratedOrders(result);
    showFeedback(result.existing ? 'Generation existante reutilisee.' : 'Commandes generees.', 'success');
  } catch (error) {
    console.error('Erreur generation commandes:', error);
    if (error.status === 409 && error.data?.can_regenerate) {
      renderActionPreview('Generation deja existante', `
        <p>${escapeHtml(error.data.error || 'Cette fiche a deja genere des commandes.')}</p>
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

function addOutOfTariffArticle(index) {
  const article = state.articleSearchResults[index];
  if (!article) return;
  const price = window.prompt(`Prix HT obligatoire pour ${article.designation || article.display_name || article.plu || 'article'} ?`);
  if (parseDecimal(price) <= 0) {
    showFeedback('Article hors tarif non ajoute : prix strictement positif obligatoire.', 'error');
    return;
  }
  const uid = `manual-${article.id}-${Date.now().toString(36)}`;
  state.products.push(normalizeProduct({
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
  }));
  state.activeProductUid = uid;
  closeArticleModal();
  render();
  queueSave(true);
  showFeedback('Article hors tarif ajoute.', 'success');
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
  els.generate?.addEventListener('click', generateOrders);
  els.clientView?.addEventListener('click', () => setView('client'));
  els.articleView?.addEventListener('click', () => setView('article'));
  els.date?.addEventListener('change', async () => {
    state.entries = {};
    state.products = [];
    state.activeClientId = null;
    state.activeProductUid = null;
    await refreshData();
  });
  els.note?.addEventListener('input', () => {
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
    renderSummary();
    renderPrintableSheet();
    queueSave(true);
  });
  els.entryTable?.addEventListener('keydown', (event) => {
    const input = event.target.closest('[data-field]');
    if (!input || event.key !== 'Enter') return;
    event.preventDefault();
    moveToNextInput(input);
  });
  els.actionPreview?.addEventListener('click', (event) => {
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
