const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
const activeDepartment = JSON.parse(localStorage.getItem('gc_active_department') || localStorage.getItem('grv2_active_department') || 'null');
if (!token || !sessionUser) window.location.href = './login.html';
const API_BASE = window.APP_CONFIG.API_BASE_URL;
const saleId = new URLSearchParams(window.location.search).get('id');
if (!saleId) window.location.href = './sales.html';
const $ = (id) => document.getElementById(id);
const els = { user: $('user-name'), logout: $('logout-btn'), back: $('back-sales-btn'), dep: $('topbar-department-select'), depName: $('current-department-name'), save: $('save-sale-btn'), validateBl: $('validate-bl-btn'), printOrder: $('print-order-btn'), add: $('add-line-btn'), hf: $('sale-header-feedback'), lf: $('sale-lines-feedback'), client: $('sale-client-id'), tariff: $('sale-tariff-level'), vat: $('sale-vat-context'), date: $('sale-document-date'), type: $('sale-document-type'), status: $('sale-status'), ref: $('sale-reference-number'), notes: $('sale-notes'), body: $('sale-lines-table-body'), stockModal: $('stock-article-modal'), stockTitle: $('stock-article-modal-title'), stockSubtitle: $('stock-article-modal-subtitle'), closeStock: $('close-stock-article-modal-btn'), stockSearch: $('stock-article-search-input'), stockHead: $('stock-article-modal-table-head'), stockBody: $('stock-article-modal-table-body'), lotModal: $('lot-modal'), closeLot: $('close-lot-modal-btn'), lotBody: $('lot-modal-table-body') };
let sale = null;
let lines = [];
let clients = [];
let affiliates = [];
let stockItems = [];
let lotItems = [];
let editingLineId = null;
const pluSearchTimers = new Map();
const stockOnlyToggleId = 'stock-article-available-only-toggle';

function n(v, f = 0) { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : f; }
function clean(v) { return String(v ?? '').trim(); }
function money(v) { return n(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function qty(v) { return n(v).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }); }
function dinput(v) { if (!v) return ''; try { return new Date(v).toISOString().slice(0, 10); } catch { return ''; } }
function sdate(v) { if (!v) return '-'; try { return new Date(v).toLocaleDateString('fr-FR'); } catch { return v; } }
function esc(v) { return String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function fb(el, msg, err = false) { if (!el) return; el.textContent = msg; el.classList.remove('hidden'); el.classList.toggle('error', err); el.classList.toggle('success', !err); }
function clear(el) { if (!el) return; el.textContent = ''; el.classList.add('hidden'); el.classList.remove('error', 'success'); }
async function api(path, options = {}) { const r = await fetch(`${API_BASE}${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) } }); const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(data.error || 'Erreur API'); return data; }
function deps() { return Array.isArray(sessionUser.departments) ? sessionUser.departments : []; }
function currentDep() { return activeDepartment && deps().some((d) => d.id === activeDepartment.id) ? activeDepartment : deps()[0] || null; }
function saveDep(dep) { localStorage.setItem('gc_active_department', JSON.stringify(dep)); localStorage.setItem('grv2_active_department', JSON.stringify(dep)); }
function selectedClient() { return clients.find((c) => c.id === els.client.value) || null; }
function tariffLevel() { return n(selectedClient()?.tariff_level || sale?.client_tariff_level || sale?.tariff_level_snapshot || 1, 1); }
function vatRate() { const c = selectedClient(); if (c?.is_vat_exempt || sale?.client_is_vat_exempt || sale?.is_vat_exempt_snapshot) return 0; return n(c?.vat_rate ?? sale?.client_vat_rate ?? sale?.vat_rate_snapshot ?? 5.5, 5.5); }
function priceFor(a) { return n(a?.[`sale_price_level_${tariffLevel()}_ht`] ?? a?.sale_price_ex_vat ?? 0, 0); }
function trace(line) { return line.traceability_snapshot || {}; }
function traceText(t) { const parts = [t?.lot_code || t?.supplier_lot_number, t?.latin_name, t?.fao_zone, t?.sous_zone, t?.fishing_gear || t?.engin, t?.production_method || t?.category, t?.allergens || t?.allergenes].filter(Boolean); return parts.length ? parts.join(' | ') : '-'; }
function normalizeArticle(item) { return { ...item, article_id: item.article_id || item.id, plu: item.plu || item.code || '', designation: item.designation || item.display_name || '', family_name: item.family_name || item.family || item.category || '', sale_price_level_1_ht: item.sale_price_level_1_ht ?? item.sale_price_ex_vat ?? 0, sale_price_level_2_ht: item.sale_price_level_2_ht ?? 0, sale_price_level_3_ht: item.sale_price_level_3_ht ?? 0, stock_quantity: item.stock_quantity ?? 0, pma: item.pma ?? item.unit_cost_ex_vat ?? 0, sale_unit: item.sale_unit || item.unit || 'kg', lot_code: item.lot_code || item.next_lot_code || '', supplier_lot_number: item.supplier_lot_number || item.next_supplier_lot_number || '', next_dlc: item.next_dlc || item.next_lot_dlc || null, fishing_gear: item.fishing_gear || item.engin, allergens: item.allergens || item.allergenes, production_method: item.production_method || item.category }; }
function normalizeKind(value) { return String(value || '').trim().toLowerCase(); }
function isNegoce() { return normalizeKind(sale?.origin) === 'negoce'; }
function isFactured() { return normalizeKind(sale?.status) === 'invoiced' || !!sale?.invoice_id || !!sale?.invoice_reference || !!sale?.source_invoice_id || !!sale?.invoiced_at; }
function isNegoceDeliveryNoteShape() { return isNegoce() && ['delivered', 'delivery_note', 'validated'].includes(normalizeKind(sale?.status)); }
function isDeliveryNote() { return String(sale?.document_type || '').toUpperCase() === 'DELIVERY_NOTE' || isNegoceDeliveryNoteShape(); }
function editable() {
  if (isDeliveryNote()) return !isFactured();
  if (sale?.document_type === 'ORDER') return sale?.status === 'draft';
  return false;
}
function canValidateInBl() { return sale?.document_type === 'ORDER' && sale?.status === 'draft'; }
function stockOnlyArticles() { return els.stockOnly ? els.stockOnly.checked : true; }

function ensureAffiliateLineHeader() {
  const row = document.querySelector('.sale-lines-table thead tr');
  if (!row || row.dataset.affiliatesReady === 'true') return;
  row.insertAdjacentHTML('afterbegin', '<th>Magasin livré</th>');
  row.dataset.affiliatesReady = 'true';
}

function affiliateOptionLabelFromLine(line) {
  return optionLabel(
    clean(line?.delivered_client_name_snapshot) || clean(line?.delivered_client_name),
    clean(line?.delivered_client_code_snapshot) || clean(line?.delivered_client_code) || clean(line?.delivered_client_store_identifier_snapshot) || clean(line?.delivered_client_store_identifier)
  );
}

function optionLabel(name, code) {
  const label = clean(name) || 'Magasin livre';
  const suffix = clean(code);
  return suffix && suffix !== label ? `${label} - ${suffix}` : label;
}

function addOptionOnce(options, option) {
  if (!option?.id) return;
  if (!options.some((item) => String(item.id) === String(option.id))) options.push(option);
}

function deliveredLineOptions() {
  const options = [];
  lines.forEach((line) => {
    addOptionOnce(options, {
      id: line.delivered_client_id,
      label: affiliateOptionLabelFromLine(line),
    });
  });
  return options;
}

function affiliateOptions(line) {
  const selectedId = line?.delivered_client_id || '';
  const mainName = sale?.client_name || selectedClient()?.name || 'Client principal';
  const options = [{ id: sale?.client_id || '', label: `Client principal - ${mainName}` }];
  affiliates.forEach((client) => addOptionOnce(options, {
    id: client.id,
    label: optionLabel(client.name || client.legal_name, client.code || client.store_identifier || client.affiliate_store_number),
  }));
  deliveredLineOptions().forEach((option) => addOptionOnce(options, option));
  if (selectedId && !options.some((option) => String(option.id) === String(selectedId))) {
    options.push({ id: selectedId, label: affiliateOptionLabelFromLine(line) });
  }
  return options.map((option) => `<option value="${esc(option.id)}" ${String(option.id) === String(selectedId || '') ? 'selected' : ''}>${esc(option.label)}</option>`).join('');
}

function syncDeliveredClientSelects() {
  const lineById = new Map(lines.map((line) => [String(line.id), line]));
  els.body.querySelectorAll('tr[data-line-id]').forEach((row) => {
    const line = lineById.get(String(row.dataset.lineId));
    const select = row.querySelector('.line-delivered-client');
    const selectedId = clean(line?.delivered_client_id);
    if (!line || !select || !selectedId) return;
    if (![...select.options].some((option) => String(option.value) === selectedId)) {
      const option = document.createElement('option');
      option.value = selectedId;
      option.textContent = affiliateOptionLabelFromLine(line);
      select.appendChild(option);
    }
    select.value = selectedId;
    console.log('DELIVERED OPTIONS', {
      lineDeliveredId: line.delivered_client_id,
      options: [...select.options].map((option) => ({ value: option.value, text: option.textContent })),
      selected: select.value,
    });
  });
}

function lastDeliveredClientId() {
  const rows = Array.from(els.body?.querySelectorAll('tr[data-line-id]') || []);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const value = rows[index].querySelector('.line-delivered-client')?.value || '';
    if (value) return value;
  }
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]?.delivered_client_id) return lines[index].delivered_client_id;
  }
  return null;
}

function ensureStockSearchToggle() {
  if (!els.stockSearch || els.stockOnly) return;
  const existing = document.getElementById(stockOnlyToggleId);
  if (existing) {
    els.stockOnly = existing;
    return;
  }
  const wrapper = document.createElement('label');
  wrapper.className = 'helper-text';
  wrapper.style.display = 'inline-flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.gap = '8px';
  wrapper.style.marginTop = '8px';
  wrapper.innerHTML = `<input type="checkbox" id="${stockOnlyToggleId}" checked> Articles en stock uniquement`;
  els.stockSearch.closest('.form-group')?.appendChild(wrapper);
  els.stockOnly = wrapper.querySelector('input');
  els.stockOnly?.addEventListener('change', () => stockSearch(clean(els.stockSearch.value)).catch((e) => fb(els.lf, e.message, true)));
}

async function fetchStockArticles(search = '', availableOnly = true) {
  const q = new URLSearchParams({ limit: '1000', available_only: availableOnly ? 'true' : 'false' });
  if (search) q.set('search', search);
  const data = await api(`/api/stock?${q.toString()}`).catch(() => []);
  return (Array.isArray(data) ? data : []).map(normalizeArticle);
}

async function fetchActiveArticles(search = '') {
  const data = search
    ? await api(`/api/articles/search?q=${encodeURIComponent(search)}`).catch(() => [])
    : await api('/api/articles?active=true&limit=200').catch(() => []);
  return (Array.isArray(data) ? data : []).map(normalizeArticle);
}

async function fetchActiveArticlesWithStock(search = '') {
  const [articles, stockRows] = await Promise.all([
    fetchActiveArticles(search),
    fetchStockArticles(search, false),
  ]);
  const stockByArticle = new Map(stockRows.map((item) => [String(item.article_id), item]));
  return articles.map((article) => ({ ...article, ...(stockByArticle.get(String(article.article_id)) || {}) }));
}

function renderTopbar() {
  if (els.user) els.user.textContent = sessionUser.email || 'Utilisateur';
  const list = deps(); const dep = currentDep();
  els.dep.innerHTML = '';
  if (!list.length) { els.dep.innerHTML = '<option>Aucun service</option>'; els.dep.disabled = true; els.depName.textContent = 'Aucun service'; return; }
  list.forEach((d) => { const o = document.createElement('option'); o.value = d.id; o.textContent = `${d.name} (${d.code})`; els.dep.appendChild(o); });
  if (dep) { els.dep.value = dep.id; els.depName.textContent = dep.name || '-'; saveDep(dep); }
  els.dep.disabled = list.length === 1;
  els.dep.addEventListener('change', () => { const next = list.find((d) => d.id === els.dep.value); if (next) { saveDep(next); window.location.reload(); } });
}

async function loadClients() { clients = await api('/api/clients?status=active'); els.client.innerHTML = '<option value="">Sélectionner un client</option>' + clients.map((c) => `<option value="${c.id}">${esc(c.name || c.legal_name || c.code || 'Client')}</option>`).join(''); }
async function loadAffiliates() { affiliates = sale?.client_id ? await api(`/api/clients/${sale.client_id}/affiliates`).catch(() => []) : []; }
async function loadSale() { clear(els.hf); clear(els.lf); const data = await api(`/api/sales/${saleId}`); sale = data.sale; lines = Array.isArray(data.lines) ? data.lines : []; await loadAffiliates(); renderHeader(); renderLines(); }

function renderClientContext() {
  const c = selectedClient();
  const level = c?.tariff_level || sale?.client_tariff_level || sale?.tariff_level_snapshot || 1;
  const exempt = c?.is_vat_exempt || sale?.client_is_vat_exempt || sale?.is_vat_exempt_snapshot;
  const vat = exempt ? 0 : n(c?.vat_rate ?? sale?.client_vat_rate ?? sale?.vat_rate_snapshot ?? 5.5, 5.5);
  els.tariff.value = `Tarif ${level}`;
  els.vat.value = exempt ? 'Exonéré' : `${vat.toFixed(2)} %`;
}

function renderHeader() {
  els.client.value = sale.client_id || '';
  els.date.value = dinput(sale.document_date);
  els.type.value = sale.document_type || 'ORDER';
  els.status.value = sale.status || 'draft';
  els.ref.value = sale.reference_number || '';
  els.notes.value = sale.notes || '';
  renderClientContext();
  const locked = !editable();
  [els.client, els.date, els.ref, els.notes].forEach((el) => { if (el) el.disabled = locked; });
  els.type.disabled = true;
  els.status.disabled = true;
  els.save.disabled = locked;
  els.add.disabled = locked;
  els.validateBl.disabled = !canValidateInBl();
  els.validateBl.textContent = isNegoce() ? 'Valider BL Négoce' : 'Valider en BL';
  els.validateBl.classList.toggle('hidden', !canValidateInBl());
  if (isDeliveryNote() && editable()) fb(els.hf, 'BL modifiable tant qu il n est pas facturé. Les modifications d un BL validé réajustent le stock.', false);
}

function renderLines() {
  ensureAffiliateLineHeader();
  if (!lines.length) { els.body.innerHTML = '<tr><td colspan="14">Aucune ligne.</td></tr>'; return; }
  els.body.innerHTML = lines.map((line) => {
    const t = trace(line);
    const locked = !editable();
    const negoce = isNegoce();
    return `<tr data-line-id="${line.id}" data-article-id="${line.article_id || ''}" data-selected-lot-id="${line.selected_lot_id || ''}" data-sale-unit="${esc(line.sale_unit || 'kg')}">
      <td><select class="line-input line-delivered-client" ${locked ? 'disabled' : ''}>${affiliateOptions(line)}</select></td>
      <td><input class="line-input line-plu" value="${esc(line.article_plu || '')}" ${locked ? 'disabled' : ''}></td>
      <td><input class="line-input line-article-label" value="${esc(line.article_label || '')}" ${locked ? 'disabled' : ''}></td>
      <td><button type="button" class="btn btn-secondary" data-action="choose-lot" data-id="${line.id}" ${locked || !line.article_id || negoce ? 'disabled' : ''}>${esc(t.lot_code || t.supplier_lot_number || (negoce ? 'Négoce' : 'Lot'))}</button></td>
      <td><input class="line-input line-package-count" type="number" step="0.001" value="${n(line.package_count)}" ${locked ? 'disabled' : ''}></td>
      <td><input class="line-input line-weight-per-package" type="number" step="0.001" value="${n(line.weight_per_package)}" ${locked ? 'disabled' : ''}></td>
      <td><input class="line-input line-total-weight" type="number" step="0.001" value="${n(line.total_weight || line.sold_quantity)}" ${locked ? 'disabled' : ''}></td>
      <td><input class="line-input line-unit-price-ht" type="number" step="0.0001" value="${n(line.unit_sale_price_ht)}" ${locked ? 'disabled' : ''}></td>
      <td class="line-total-ht">${money(line.line_amount_ht)}</td>
      <td><input class="line-input line-vat-rate" type="number" step="0.01" value="${n(line.vat_rate, vatRate())}" ${locked ? 'disabled' : ''}></td>
      <td class="line-total-ttc">${money(line.line_amount_ttc)}</td>
      <td class="trace-cell">${esc(traceText(t) !== '-' ? traceText(t) : (negoce ? 'Négoce hors stock' : '-'))}</td>
      <td>${esc(line.line_status || '-')}</td>
      <td><button type="button" class="btn btn-primary" data-action="save-line" data-id="${line.id}" ${locked ? 'disabled' : ''}>OK</button><button type="button" class="btn btn-secondary" data-action="delete-line" data-id="${line.id}" ${locked ? 'disabled' : ''}>Suppr.</button></td>
    </tr>`;
  }).join('');
  syncDeliveredClientSelects();
}

function computeRow(row) {
  const packs = n(row.querySelector('.line-package-count')?.value);
  const weightPerPack = n(row.querySelector('.line-weight-per-package')?.value);
  const totalInput = row.querySelector('.line-total-weight');
  if (document.activeElement !== totalInput) totalInput.value = (packs * weightPerPack).toFixed(3);
  const totalWeight = n(totalInput.value);
  const unitPrice = n(row.querySelector('.line-unit-price-ht')?.value);
  const vat = n(row.querySelector('.line-vat-rate')?.value, vatRate());
  const ht = totalWeight * unitPrice;
  row.querySelector('.line-total-ht').textContent = money(ht);
  row.querySelector('.line-total-ttc').textContent = money(ht * (1 + vat / 100));
}

function renderStockSearchTable() {
  ensureStockSearchToggle();
  const onlyStock = stockOnlyArticles();
  if (els.stockTitle) els.stockTitle.textContent = 'Rechercher un article';
  if (els.stockSubtitle) els.stockSubtitle.textContent = onlyStock ? 'Articles avec stock positif, double clic pour choisir' : 'Tous les articles actifs, y compris hors stock';
  if (els.stockSearch) els.stockSearch.placeholder = 'PLU, désignation, référence, nom latin';
  if (els.stockHead) {
    els.stockHead.innerHTML = '<tr><th>PLU</th><th>Désignation</th><th>Stock</th><th>Statut</th><th>Lot FIFO</th><th>DLC FIFO</th><th>Tarif client</th><th>Tarif 1</th></tr>';
  }
  els.stockBody.innerHTML = stockItems.map((a) => {
    const hasStock = n(a.stock_quantity) > 0;
    return `<tr data-article-id="${a.article_id}"><td>${esc(a.plu)}</td><td>${esc(a.designation)}</td><td>${hasStock ? qty(a.stock_quantity) : '0,000'}</td><td>${hasStock ? 'En stock' : 'Hors stock'}</td><td>${esc(a.lot_code || a.supplier_lot_number || '-')}</td><td>${sdate(a.next_dlc || a.next_lot_dlc)}</td><td>${money(priceFor(a))}</td><td>${money(a.sale_price_level_1_ht ?? a.sale_price_ex_vat)}</td></tr>`;
  }).join('') || '<tr><td colspan="8">Aucun article.</td></tr>';
}

async function stockSearch(search = '') {
  ensureStockSearchToggle();
  const term = clean(search);
  stockItems = stockOnlyArticles()
    ? await fetchStockArticles(term, true)
    : await fetchActiveArticlesWithStock(term);
  renderStockSearchTable();
}
function openStock(lineId, initialSearch = '') { editingLineId = lineId; ensureStockSearchToggle(); if (els.stockSearch) els.stockSearch.value = clean(initialSearch); els.stockModal.classList.remove('hidden'); stockSearch(clean(initialSearch)).catch((e) => fb(els.lf, e.message, true)); setTimeout(() => els.stockSearch?.focus(), 50); }
function applyArticle(item) {
  const row = els.body.querySelector(`tr[data-line-id="${editingLineId}"]`);
  if (!row) return;
  row.dataset.articleId = item.article_id;
  row.dataset.saleUnit = item.sale_unit || item.unit || 'kg';
  row.querySelector('.line-plu').value = item.plu || '';
  row.querySelector('.line-article-label').value = item.designation || '';
  row.querySelector('.line-unit-price-ht').value = priceFor(item).toFixed(4);
  row.querySelector('.line-vat-rate').value = vatRate().toFixed(2);
  row.querySelector('[data-action="choose-lot"]').disabled = isNegoce();
  row.querySelector('.trace-cell').textContent = traceText(item);
  els.stockModal.classList.add('hidden');
  computeRow(row);
}
async function openLots(lineId) {
  editingLineId = lineId;
  const row = els.body.querySelector(`tr[data-line-id="${lineId}"]`);
  const articleId = row?.dataset.articleId;
  if (!articleId || isNegoce()) return;
  lotItems = await api(`/api/stock/lots?article_id=${encodeURIComponent(articleId)}&available_only=true&limit=200`);
  els.lotBody.innerHTML = lotItems.map((l) => `<tr data-lot-id="${l.id}"><td>${esc(l.lot_code || '')}</td><td>${esc(l.supplier_lot_number || '')}</td><td>${qty(l.qty_remaining)}</td><td>${sdate(l.dlc)}</td><td>${esc(l.latin_name || '')}</td><td>${esc(l.fao_zone || '')}</td><td>${esc(l.sous_zone || '')}</td><td>${esc(l.fishing_gear || '')}</td><td>${esc(l.production_method || '')}</td><td>${esc(l.allergens || '')}</td></tr>`).join('') || '<tr><td colspan="10">Aucun lot.</td></tr>';
  els.lotModal.classList.remove('hidden');
}
function applyLot(lot) {
  const row = els.body.querySelector(`tr[data-line-id="${editingLineId}"]`);
  if (!row) return;
  row.dataset.selectedLotId = lot.id;
  row.querySelector('[data-action="choose-lot"]').textContent = lot.lot_code || lot.supplier_lot_number || 'Lot';
  row.querySelector('.trace-cell').textContent = traceText(lot);
  els.lotModal.classList.add('hidden');
}
async function resolvePlu(row) {
  const plu = clean(row.querySelector('.line-plu')?.value);
  if (!plu || row.dataset.articleId) return;
  const found = await fetchActiveArticles(plu);
  const item = found.find((a) => String(a.plu) === plu) || found[0];
  if (!item) throw new Error(`Article introuvable pour le PLU ${plu}`);
  editingLineId = row.dataset.lineId;
  applyArticle(item);
}

async function searchNegocePlu(row, { applyFirst = false } = {}) {
  if (!isNegoce() || !row) return;
  const plu = clean(row.querySelector('.line-plu')?.value);
  if (!plu) return;
  const found = await fetchActiveArticles(plu);
  const exact = found.find((a) => String(a.plu) === plu);
  const item = exact || (applyFirst ? found[0] : null);
  if (!item) return;
  editingLineId = row.dataset.lineId;
  applyArticle(item);
}

function scheduleNegocePluSearch(row) {
  if (!isNegoce() || !row) return;
  window.clearTimeout(pluSearchTimers.get(row.dataset.lineId));
  const timer = window.setTimeout(() => {
    searchNegocePlu(row).catch((err) => fb(els.lf, err.message, true));
  }, 300);
  pluSearchTimers.set(row.dataset.lineId, timer);
}

async function saveHeader(reload = true) {
  clear(els.hf);
  await api(`/api/sales/${saleId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      client_id: els.client.value || null,
      document_date: els.date.value || null,
      document_type: sale?.document_type || 'ORDER',
      status: sale?.status || 'draft',
      origin: isNegoce() ? 'negoce' : (sale?.origin || 'manual'),
      reference_number: clean(els.ref.value) || null,
      notes: clean(els.notes.value) || null,
    }),
  });
  if (reload) { fb(els.hf, isDeliveryNote() ? 'BL enregistré' : 'En-tête enregistré'); await loadSale(); }
}
async function ensureHeader() { if ((sale?.client_id || '') === (els.client.value || '')) return; await saveHeader(false); const data = await api(`/api/sales/${saleId}`); sale = data.sale; lines = Array.isArray(data.lines) ? data.lines : []; await loadAffiliates(); }
async function addLine() { clear(els.lf); if (!editable()) return; if (!els.client.value) { fb(els.lf, "Sélectionne un client avant d'ajouter une ligne", true); return; } const deliveredClientId = affiliates.length ? lastDeliveredClientId() : null; await ensureHeader(); await api(`/api/sales/${saleId}/lines`, { method: 'POST', body: JSON.stringify({ delivered_client_id: deliveredClientId }) }); await loadSale(); els.body.querySelector('tr[data-line-id]:last-child .line-plu')?.focus(); }
async function saveLine(lineId) {
  clear(els.lf);
  await ensureHeader();
  const row = els.body.querySelector(`tr[data-line-id="${lineId}"]`);
  if (!row) return;
  if (!row.dataset.articleId) await (isNegoce() ? searchNegocePlu(row, { applyFirst: true }) : resolvePlu(row));
  if (!row.dataset.articleId) { fb(els.lf, 'Sélectionne un article', true); return; }
  const label = clean(row.querySelector('.line-article-label').value);
  if (isNegoce() && !label) { fb(els.lf, 'Saisis la désignation du produit négoce', true); return; }
  const payload = { article_id: row.dataset.articleId, article_plu: clean(row.querySelector('.line-plu').value), article_label: label, selected_lot_id: row.dataset.selectedLotId || null, delivered_client_id: row.querySelector('.line-delivered-client')?.value || null, package_count: n(row.querySelector('.line-package-count').value), weight_per_package: n(row.querySelector('.line-weight-per-package').value), total_weight: n(row.querySelector('.line-total-weight').value), sale_unit: row.dataset.saleUnit || 'kg', unit_sale_price_ht: n(row.querySelector('.line-unit-price-ht').value), vat_rate: n(row.querySelector('.line-vat-rate').value, vatRate()) };
  await api(`/api/sales/lines/${lineId}`, { method: 'PATCH', body: JSON.stringify(payload) });
  fb(els.lf, isDeliveryNote() && sale?.status === 'validated' ? 'Ligne enregistrée et stock réajusté' : 'Ligne enregistrée');
  await loadSale();
}
async function deleteLine(lineId) { clear(els.lf); if (!confirm('Supprimer cette ligne ?')) return; await api(`/api/sales/lines/${lineId}`, { method: 'DELETE' }); fb(els.lf, isDeliveryNote() && sale?.status === 'validated' ? 'Ligne supprimée et stock réajusté' : 'Ligne supprimée'); await loadSale(); }
async function validateInBl() { clear(els.lf); if (!canValidateInBl()) return; const text = isNegoce() ? 'Valider en BL négoce ? Les lots réceptionnés seront déstockés.' : 'Valider en BL ? Cette action génère le BL et déstocke les lots.'; if (!confirm(text)) return; await api(`/api/sales/${saleId}/validate-delivery-note`, { method: 'POST', body: JSON.stringify({}) }); fb(els.lf, isNegoce() ? 'Commande négoce validée en BL' : 'Commande validée en BL et stock déstocké'); await loadSale(); }
function printOrder() {
  const selected = selectedClient();
  const client = selected?.name || sale?.client_name || sale?.delivered_client_name_snapshot || '-';
  const storeIdentifier = selected?.store_identifier || sale?.client_store_identifier || sale?.delivered_client_store_identifier || '-';
  const rows = lines.map((line) => `<tr><td style="border-bottom:1px solid #ddd;padding:6px">${esc(line.article_plu || '')}</td><td style="border-bottom:1px solid #ddd;padding:6px">${esc(line.article_label || '')}</td><td style="border-bottom:1px solid #ddd;padding:6px">${n(line.package_count)}</td><td style="border-bottom:1px solid #ddd;padding:6px">${qty(line.total_weight || line.sold_quantity)} ${esc(line.sale_unit || 'kg')}</td><td style="border-bottom:1px solid #ddd;padding:6px">${esc(isNegoce() ? 'Produit négoce hors stock' : traceText(trace(line)))}</td></tr>`).join('');
  const title = isDeliveryNote() ? (isNegoce() ? 'BL Négoce' : 'Bon de livraison') : (isNegoce() ? 'Commande Négoce' : 'Commande client');
  const html = `<section style="font-family:Arial,sans-serif;color:#111"><h1>${title}</h1><p><strong>${esc(sale?.reference_number || saleId)}</strong></p><p>Date : ${sdate(sale?.document_date)}</p><p>Client livré : ${esc(client)}</p><p>Identifiant magasin : ${esc(storeIdentifier)}</p><table style="width:100%;border-collapse:collapse;margin-top:18px"><thead><tr><th style="text-align:left;border-bottom:1px solid #111;padding:6px">PLU</th><th style="text-align:left;border-bottom:1px solid #111;padding:6px">Désignation</th><th style="text-align:left;border-bottom:1px solid #111;padding:6px">Colis</th><th style="text-align:left;border-bottom:1px solid #111;padding:6px">Poids</th><th style="text-align:left;border-bottom:1px solid #111;padding:6px">Lot / traçabilité</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  const win = window.open('', '_blank');
  win.document.write(`<!doctype html><html><head><title>${title}</title></head><body>${html}<script>window.print();<\/script></body></html>`);
  win.document.close();
}

els.logout?.addEventListener('click', () => { ['gc_token', 'gc_user', 'gc_active_department', 'grv2_token', 'grv2_user', 'grv2_active_department'].forEach((key) => localStorage.removeItem(key)); window.location.href = './login.html'; });
els.back?.addEventListener('click', () => { window.location.href = './sales.html'; });
els.save?.addEventListener('click', () => saveHeader(true));
els.add?.addEventListener('click', addLine);
els.validateBl?.addEventListener('click', validateInBl);
els.printOrder?.addEventListener('click', printOrder);
els.client?.addEventListener('change', async () => { renderClientContext(); affiliates = els.client.value ? await api(`/api/clients/${els.client.value}/affiliates`).catch(() => []) : []; renderLines(); });
els.closeStock?.addEventListener('click', () => els.stockModal.classList.add('hidden'));
els.closeLot?.addEventListener('click', () => els.lotModal.classList.add('hidden'));
els.stockSearch?.addEventListener('input', () => stockSearch(clean(els.stockSearch.value)).catch((e) => fb(els.lf, e.message, true)));
els.stockBody?.addEventListener('dblclick', (e) => { const row = e.target.closest('tr[data-article-id]'); const item = stockItems.find((a) => String(a.article_id) === String(row?.dataset.articleId)); if (item) applyArticle(item); });
els.lotBody?.addEventListener('dblclick', (e) => { const row = e.target.closest('tr[data-lot-id]'); const lot = lotItems.find((l) => l.id === row?.dataset.lotId); if (lot) applyLot(lot); });
els.body?.addEventListener('click', async (e) => { const b = e.target.closest('[data-action]'); if (!b) return; if (b.dataset.action === 'save-line') await saveLine(b.dataset.id); if (b.dataset.action === 'delete-line') await deleteLine(b.dataset.id); if (b.dataset.action === 'choose-lot') await openLots(b.dataset.id); });
els.body?.addEventListener('keydown', async (e) => {
  const row = e.target.closest('tr[data-line-id]');
  if (!row) return;
  const isArticleField = e.target.classList.contains('line-plu') || e.target.classList.contains('line-article-label');
  if (e.key === 'F9' && isArticleField) {
    e.preventDefault();
    const initialSearch = clean(e.target.value) || clean(row.querySelector('.line-plu')?.value) || clean(row.querySelector('.line-article-label')?.value);
    openStock(row.dataset.lineId, initialSearch);
    return;
  }
  if (e.key !== 'Enter' || !e.target.classList.contains('line-input')) return;
  e.preventDefault();
  await saveLine(row.dataset.lineId);
  await addLine();
});
els.body?.addEventListener('blur', async (e) => { if (!e.target.classList.contains('line-plu')) return; const row = e.target.closest('tr[data-line-id]'); if (!row) return; await (isNegoce() ? searchNegocePlu(row, { applyFirst: true }) : resolvePlu(row)).catch((err) => fb(els.lf, err.message, true)); }, true);
els.body?.addEventListener('change', async (e) => { if (!e.target.classList.contains('line-plu')) return; const row = e.target.closest('tr[data-line-id]'); if (!row || !isNegoce()) return; await searchNegocePlu(row, { applyFirst: true }).catch((err) => fb(els.lf, err.message, true)); });
els.body?.addEventListener('input', (e) => { const row = e.target.closest('tr[data-line-id]'); if (!row) return; if (e.target.classList.contains('line-plu') && isNegoce()) { row.dataset.articleId = ''; row.dataset.selectedLotId = ''; scheduleNegocePluSearch(row); return; } if (['line-package-count', 'line-weight-per-package', 'line-total-weight', 'line-unit-price-ht', 'line-vat-rate'].some((c) => e.target.classList.contains(c))) computeRow(row); });
async function init() { try { renderTopbar(); ensureStockSearchToggle(); ensureAffiliateLineHeader(); await loadClients(); await loadSale(); } catch (e) { console.error('Erreur init détail vente :', e); fb(els.lf, e.message || 'Erreur chargement vente', true); } }
init();
