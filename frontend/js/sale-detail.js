const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
const activeDepartment = JSON.parse(localStorage.getItem('gc_active_department') || localStorage.getItem('grv2_active_department') || 'null');
if (!token || !sessionUser) window.location.href = './login.html';
const API_BASE = window.APP_CONFIG.API_BASE_URL;
const saleId = new URLSearchParams(window.location.search).get('id');
if (!saleId) window.location.href = './sales.html';
const $ = (id) => document.getElementById(id);
const els = { user: $('user-name'), logout: $('logout-btn'), back: $('back-sales-btn'), dep: $('topbar-department-select'), depName: $('current-department-name'), save: $('save-sale-btn'), validateBl: $('validate-bl-btn'), printOrder: $('print-order-btn'), add: $('add-line-btn'), hf: $('sale-header-feedback'), lf: $('sale-lines-feedback'), client: $('sale-client-id'), tariff: $('sale-tariff-level'), vat: $('sale-vat-context'), date: $('sale-document-date'), type: $('sale-document-type'), status: $('sale-status'), ref: $('sale-reference-number'), notes: $('sale-notes'), body: $('sale-lines-table-body'), stockModal: $('stock-article-modal'), closeStock: $('close-stock-article-modal-btn'), stockSearch: $('stock-article-search-input'), stockBody: $('stock-article-modal-table-body'), lotModal: $('lot-modal'), closeLot: $('close-lot-modal-btn'), lotBody: $('lot-modal-table-body') };
let sale = null;
let lines = [];
let clients = [];
let stockItems = [];
let lotItems = [];
let editingLineId = null;

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
function tariffLevel() { return n(selectedClient()?.tariff_level || sale?.client_tariff_level || 1, 1); }
function vatRate() { const c = selectedClient(); if (c?.is_vat_exempt || sale?.client_is_vat_exempt) return 0; return n(c?.vat_rate ?? sale?.client_vat_rate ?? 5.5, 5.5); }
function priceFor(a) { return n(a?.[`sale_price_level_${tariffLevel()}_ht`] ?? a?.sale_price_ex_vat ?? 0, 0); }
function trace(line) { return line.traceability_snapshot || {}; }
function traceText(t) { const parts = [t?.lot_code || t?.supplier_lot_number, t?.latin_name, t?.fao_zone, t?.sous_zone, t?.fishing_gear || t?.engin, t?.production_method || t?.category, t?.allergens || t?.allergenes].filter(Boolean); return parts.length ? parts.join(' | ') : '-'; }
function normalizeArticle(item) { return { ...item, article_id: item.article_id || item.id, designation: item.designation || item.display_name || '', sale_price_level_1_ht: item.sale_price_level_1_ht ?? item.sale_price_ex_vat ?? 0, stock_quantity: item.stock_quantity ?? 0, pma: item.pma ?? item.unit_cost_ex_vat ?? 0, sale_unit: item.sale_unit || item.unit || 'kg', fishing_gear: item.fishing_gear || item.engin, allergens: item.allergens || item.allergenes, production_method: item.production_method || item.category }; }
function isNegoce() { return sale?.origin === 'negoce'; }
function editable() { return sale?.status === 'draft' && sale?.document_type === 'ORDER'; }

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
async function loadSale() { clear(els.hf); clear(els.lf); const data = await api(`/api/sales/${saleId}`); sale = data.sale; lines = Array.isArray(data.lines) ? data.lines : []; renderHeader(); renderLines(); }

function renderClientContext() {
  const c = selectedClient();
  const level = c?.tariff_level || sale?.client_tariff_level || 1;
  const exempt = c?.is_vat_exempt || sale?.client_is_vat_exempt;
  const vat = exempt ? 0 : n(c?.vat_rate ?? sale?.client_vat_rate ?? 5.5, 5.5);
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
  [els.client, els.date, els.type, els.status, els.ref, els.notes].forEach((el) => { if (el) el.disabled = locked; });
  els.type.disabled = true;
  els.save.disabled = locked;
  els.add.disabled = locked;
  els.validateBl.disabled = !editable();
  els.validateBl.textContent = isNegoce() ? 'Valider BL Négoce' : 'Valider en BL';
  els.validateBl.classList.toggle('hidden', !editable());
}

function renderLines() {
  if (!lines.length) { els.body.innerHTML = '<tr><td colspan="13">Aucune ligne.</td></tr>'; return; }
  els.body.innerHTML = lines.map((line) => {
    const t = trace(line);
    const locked = !editable();
    const negoce = isNegoce();
    return `<tr data-line-id="${line.id}" data-article-id="${line.article_id || ''}" data-selected-lot-id="${line.selected_lot_id || ''}" data-sale-unit="${esc(line.sale_unit || 'kg')}">
      <td><input class="line-input line-plu" value="${esc(line.article_plu || '')}" ${locked ? 'disabled' : ''}></td>
      <td><input class="line-input line-article-label" value="${esc(line.article_label || '')}" ${locked ? 'disabled' : ''}></td>
      <td><button type="button" class="btn btn-secondary" data-action="choose-lot" data-id="${line.id}" ${locked || !line.article_id ? 'disabled' : ''}>${esc(t.lot_code || t.supplier_lot_number || (negoce ? 'Lot après réception' : 'Lot'))}</button></td>
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

async function stockSearch(search = '') {
  if (isNegoce()) {
    const data = search
      ? await api(`/api/articles/search?q=${encodeURIComponent(search)}`)
      : await api('/api/articles?active=true&limit=200');
    stockItems = (Array.isArray(data) ? data : []).map(normalizeArticle);
  } else {
    const q = new URLSearchParams({ limit: '200', available_only: 'true' });
    if (search) q.set('search', search);
    stockItems = await api(`/api/stock?${q.toString()}`);
  }
  els.stockBody.innerHTML = stockItems.map((a) => `<tr data-article-id="${a.article_id}"><td>${esc(a.plu)}</td><td>${esc(a.designation)}</td><td>${qty(a.stock_quantity)}</td><td>${money(a.pma)}</td><td>${money(a.sale_price_level_1_ht)}</td><td>${money(a.sale_price_level_2_ht)}</td><td>${money(a.sale_price_level_3_ht)}</td><td>${sdate(a.next_dlc || a.next_lot_dlc)}</td></tr>`).join('') || '<tr><td colspan="8">Aucun article.</td></tr>';
}
function openStock(lineId) { editingLineId = lineId; els.stockModal.classList.remove('hidden'); stockSearch('').catch((e) => fb(els.lf, e.message, true)); setTimeout(() => els.stockSearch?.focus(), 50); }
function applyArticle(item) {
  const row = els.body.querySelector(`tr[data-line-id="${editingLineId}"]`);
  if (!row) return;
  row.dataset.articleId = item.article_id;
  row.dataset.saleUnit = item.sale_unit || item.unit || 'kg';
  row.querySelector('.line-plu').value = item.plu || '';
  row.querySelector('.line-article-label').value = item.designation || '';
  row.querySelector('.line-unit-price-ht').value = priceFor(item).toFixed(4);
  row.querySelector('.line-vat-rate').value = vatRate().toFixed(2);
  row.querySelector('[data-action="choose-lot"]').disabled = false;
  row.querySelector('.trace-cell').textContent = traceText(item);
  els.stockModal.classList.add('hidden');
  computeRow(row);
}
async function openLots(lineId) {
  editingLineId = lineId;
  const row = els.body.querySelector(`tr[data-line-id="${lineId}"]`);
  const articleId = row?.dataset.articleId;
  if (!articleId) return;
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
  const found = isNegoce()
    ? (await api(`/api/articles/search?q=${encodeURIComponent(plu)}`)).map(normalizeArticle)
    : await api(`/api/stock?search=${encodeURIComponent(plu)}&available_only=true&limit=20`);
  const item = found.find((a) => String(a.plu) === plu) || found[0];
  if (!item) throw new Error(`Article introuvable pour le PLU ${plu}`);
  editingLineId = row.dataset.lineId;
  applyArticle(item);
}

async function saveHeader(reload = true) {
  clear(els.hf);
  await api(`/api/sales/${saleId}`, { method: 'PATCH', body: JSON.stringify({ client_id: els.client.value || null, document_date: els.date.value || null, document_type: 'ORDER', status: els.status.value || 'draft', origin: isNegoce() ? 'negoce' : 'manual', reference_number: clean(els.ref.value) || null, notes: clean(els.notes.value) || null }) });
  if (reload) { fb(els.hf, 'En-tête enregistré'); await loadSale(); }
}
async function ensureHeader() { if ((sale?.client_id || '') === (els.client.value || '')) return; await saveHeader(false); const data = await api(`/api/sales/${saleId}`); sale = data.sale; lines = Array.isArray(data.lines) ? data.lines : []; }
async function addLine() { clear(els.lf); if (!editable()) return; if (!els.client.value) { fb(els.lf, "Sélectionne un client avant d'ajouter une ligne", true); return; } await ensureHeader(); await api(`/api/sales/${saleId}/lines`, { method: 'POST', body: JSON.stringify({}) }); await loadSale(); els.body.querySelector('tr[data-line-id]:last-child .line-plu')?.focus(); }
async function saveLine(lineId) {
  clear(els.lf);
  await ensureHeader();
  const row = els.body.querySelector(`tr[data-line-id="${lineId}"]`);
  if (!row) return;
  if (!row.dataset.articleId) await resolvePlu(row);
  if (!row.dataset.articleId) { fb(els.lf, isNegoce() ? 'Sélectionne un article référencé' : 'Sélectionne un article en stock', true); return; }
  const label = clean(row.querySelector('.line-article-label').value);
  if (isNegoce() && !label) { fb(els.lf, 'Saisis la désignation du produit négoce', true); return; }
  const payload = { article_id: row.dataset.articleId, article_plu: clean(row.querySelector('.line-plu').value), article_label: label, selected_lot_id: row.dataset.selectedLotId || null, package_count: n(row.querySelector('.line-package-count').value), weight_per_package: n(row.querySelector('.line-weight-per-package').value), total_weight: n(row.querySelector('.line-total-weight').value), sale_unit: row.dataset.saleUnit || 'kg', unit_sale_price_ht: n(row.querySelector('.line-unit-price-ht').value), vat_rate: n(row.querySelector('.line-vat-rate').value, vatRate()) };
  await api(`/api/sales/lines/${lineId}`, { method: 'PATCH', body: JSON.stringify(payload) });
  fb(els.lf, 'Ligne enregistrée');
  await loadSale();
}
async function deleteLine(lineId) { clear(els.lf); if (!confirm('Supprimer cette ligne ?')) return; await api(`/api/sales/lines/${lineId}`, { method: 'DELETE' }); fb(els.lf, 'Ligne supprimée'); await loadSale(); }
async function validateInBl() { clear(els.lf); const text = isNegoce() ? 'Valider en BL négoce ? Les lots réceptionnés seront déstockés.' : 'Valider en BL ? Cette action génère le BL et déstocke les lots.'; if (!confirm(text)) return; await api(`/api/sales/${saleId}/validate-delivery-note`, { method: 'POST', body: JSON.stringify({}) }); fb(els.lf, isNegoce() ? 'Commande négoce validée en BL et stock déstocké' : 'Commande validée en BL et stock déstocké'); await loadSale(); }
function printOrder() {
  const selected = selectedClient();
  const client = selected?.name || sale?.client_name || '-';
  const storeIdentifier = selected?.store_identifier || sale?.client_store_identifier || sale?.delivered_client_store_identifier || '-';
  const rows = lines.map((line) => `<tr><td style="border-bottom:1px solid #ddd;padding:6px">${esc(line.article_plu || '')}</td><td style="border-bottom:1px solid #ddd;padding:6px">${esc(line.article_label || '')}</td><td style="border-bottom:1px solid #ddd;padding:6px">${n(line.package_count)}</td><td style="border-bottom:1px solid #ddd;padding:6px">${qty(line.total_weight || line.sold_quantity)} ${esc(line.sale_unit || 'kg')}</td><td style="border-bottom:1px solid #ddd;padding:6px">${esc(isNegoce() ? 'Produit négoce hors stock' : traceText(trace(line)))}</td></tr>`).join('');
  const title = isNegoce() ? 'Commande Négoce' : 'Commande client';
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
els.client?.addEventListener('change', renderClientContext);
els.closeStock?.addEventListener('click', () => els.stockModal.classList.add('hidden'));
els.closeLot?.addEventListener('click', () => els.lotModal.classList.add('hidden'));
els.stockSearch?.addEventListener('input', () => stockSearch(clean(els.stockSearch.value)).catch((e) => fb(els.lf, e.message, true)));
els.stockBody?.addEventListener('dblclick', (e) => { const row = e.target.closest('tr[data-article-id]'); const item = stockItems.find((a) => a.article_id === row?.dataset.articleId); if (item) applyArticle(item); });
els.lotBody?.addEventListener('dblclick', (e) => { const row = e.target.closest('tr[data-lot-id]'); const lot = lotItems.find((l) => l.id === row?.dataset.lotId); if (lot) applyLot(lot); });
els.body?.addEventListener('click', async (e) => { const b = e.target.closest('[data-action]'); if (!b) return; if (b.dataset.action === 'save-line') await saveLine(b.dataset.id); if (b.dataset.action === 'delete-line') await deleteLine(b.dataset.id); if (b.dataset.action === 'choose-lot') await openLots(b.dataset.id); });
els.body?.addEventListener('keydown', async (e) => { const row = e.target.closest('tr[data-line-id]'); if (!row) return; if (e.key === 'F9' && e.target.classList.contains('line-plu')) { e.preventDefault(); openStock(row.dataset.lineId); return; } if (e.key !== 'Enter' || !e.target.classList.contains('line-input')) return; e.preventDefault(); await saveLine(row.dataset.lineId); await addLine(); });
els.body?.addEventListener('blur', async (e) => { if (!e.target.classList.contains('line-plu')) return; const row = e.target.closest('tr[data-line-id]'); if (row) await resolvePlu(row).catch((err) => fb(els.lf, err.message, true)); }, true);
els.body?.addEventListener('input', (e) => { const row = e.target.closest('tr[data-line-id]'); if (!row) return; if (['line-package-count', 'line-weight-per-package', 'line-total-weight', 'line-unit-price-ht', 'line-vat-rate'].some((c) => e.target.classList.contains(c))) computeRow(row); });
async function init() { try { renderTopbar(); await loadClients(); await loadSale(); } catch (e) { console.error('Erreur init détail vente :', e); fb(els.lf, e.message || 'Erreur chargement vente', true); } }
init();
