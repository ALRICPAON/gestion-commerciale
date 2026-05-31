const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;
const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
const authToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
if (!sessionUser || !authToken) window.location.href = './login.html';

const $ = (id) => document.getElementById(id);
const userNameEl = $('user-name');
const ordersBody = $('orders-body');
const deliveryNotesBody = $('delivery-notes-body');
const pageFeedback = $('page-feedback');
const detailTitle = $('detail-title');
const detailSubtitle = $('detail-subtitle');
const detailContent = $('detail-content');
const validateBtn = $('validate-btn');
const printBtn = $('print-btn');
const labelsBtn = $('labels-btn');
const printArea = $('print-area');
let selectedDeliveryNote = null;

function logoutAndRedirect() {
  ['gc_token', 'gc_user', 'gc_active_department', 'grv2_token', 'grv2_user', 'grv2_active_department'].forEach((key) => localStorage.removeItem(key));
  window.location.href = './login.html';
}

function showFeedback(message, type = 'success') {
  if (!pageFeedback) return;
  pageFeedback.textContent = message;
  pageFeedback.className = `page-feedback ${type}`;
  setTimeout(() => { pageFeedback.className = 'page-feedback hidden'; pageFeedback.textContent = ''; }, 3500);
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${authToken}` } });
  if (response.status === 401) { logoutAndRedirect(); return null; }
  return response;
}

const money = (value) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
const fmtDate = (value) => (value ? new Intl.DateTimeFormat('fr-FR').format(new Date(value)) : '-');
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const statusLabel = (status) => ({ draft: 'Brouillon', validated: 'Validé', delivered: 'Livré' }[status] || status || '-');

function renderOrders(orders) {
  const candidates = orders.filter((order) => order.document_type === 'ORDER' && order.status === 'validated');
  ordersBody.innerHTML = candidates.length ? '' : '<tr><td colspan="5">Aucune commande validée en attente de BL.</td></tr>';
  candidates.forEach((order) => {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${esc(order.reference_number || order.id.slice(0, 8))}</td><td>${esc(order.client_name || '-')}</td><td>${fmtDate(order.document_date)}</td><td>${money(order.total_amount_ex_vat)}</td><td><button type="button" class="btn btn-primary" data-generate="${order.id}">Générer BL</button></td>`;
    ordersBody.appendChild(row);
  });
}

function renderDeliveryNotes(notes) {
  deliveryNotesBody.innerHTML = notes.length ? '' : '<tr><td colspan="5">Aucun BL.</td></tr>';
  notes.forEach((note) => {
    const row = document.createElement('tr');
    const storeId = note.client_store_identifier || note.delivered_client_store_identifier || '';
    row.innerHTML = `<td>${esc(note.reference_number || note.id.slice(0, 8))}</td><td>${esc(note.client_name || note.delivered_client_name_snapshot || '-')}<br><small>${esc(storeId)}</small></td><td>${esc(note.billed_client_name || note.billed_client_name_snapshot || '-')}</td><td><span class="status-pill ${esc(note.status)}">${statusLabel(note.status)}</span></td><td><button type="button" class="btn btn-secondary" data-open="${note.id}">Ouvrir</button></td>`;
    deliveryNotesBody.appendChild(row);
  });
}

function renderDetail(note) {
  selectedDeliveryNote = note;
  detailTitle.textContent = note.reference_number || `BL ${note.id.slice(0, 8)}`;
  detailSubtitle.textContent = `${note.client_name || note.delivered_client_name_snapshot || 'Client livré'} • ${statusLabel(note.status)}`;
  validateBtn.disabled = note.status !== 'draft';
  printBtn.disabled = false;
  labelsBtn.disabled = false;
  detailContent.classList.remove('empty-state');
  detailContent.innerHTML = `<div class="summary-grid"><div class="summary-item"><span class="summary-label">Client livré</span><span class="summary-value">${esc(note.client_name || note.delivered_client_name_snapshot || '-')}</span></div><div class="summary-item"><span class="summary-label">Identifiant magasin</span><span class="summary-value">${esc(note.client_store_identifier || note.delivered_client_store_identifier || '-')}</span></div><div class="summary-item"><span class="summary-label">Client facturé</span><span class="summary-value">${esc(note.billed_client_name || note.billed_client_name_snapshot || '-')}</span></div><div class="summary-item"><span class="summary-label">Commande source</span><span class="summary-value">${esc(note.source_order_reference || note.source_order_id || '-')}</span></div></div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Ligne</th><th>Article</th><th>Colis</th><th>Poids</th><th>Lot</th><th>HT</th></tr></thead><tbody>${(note.lines || []).map((line) => { const trace = line.traceability_snapshot || {}; return `<tr><td>${line.line_number}</td><td>${esc(line.article_plu || '')} ${esc(line.article_label || '')}</td><td>${Number(line.package_count || 0)}</td><td>${Number(line.total_weight || line.sold_quantity || 0).toFixed(3)} ${esc(line.sale_unit || 'kg')}</td><td>${esc(trace.lot_code || trace.supplier_lot_number || 'FIFO')}</td><td>${money(line.line_amount_ht)}</td></tr>`; }).join('')}</tbody></table></div>`;
}

async function loadOrders() {
  const response = await apiFetch(`${API_BASE_URL}/api/sales?document_type=ORDER&status=validated`);
  if (!response) return;
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(data.error || 'Impossible de charger les commandes');
  renderOrders(Array.isArray(data) ? data : []);
}

async function loadDeliveryNotes() {
  const response = await apiFetch(`${API_BASE_URL}/api/delivery-notes`);
  if (!response) return;
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(data.error || 'Impossible de charger les BL');
  renderDeliveryNotes(Array.isArray(data) ? data : []);
}

async function refreshAll() {
  try { await Promise.all([loadOrders(), loadDeliveryNotes()]); }
  catch (err) { console.error('Erreur actualisation BL :', err); showFeedback(err.message || 'Erreur actualisation', 'error'); }
}

async function generateDeliveryNote(orderId) {
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/sales/${orderId}/delivery-note`, { method: 'POST' });
    if (!response) return;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur génération BL');
    showFeedback(data.existing ? 'BL déjà généré.' : 'BL généré.');
    await refreshAll();
    if (data.id) await openDeliveryNote(data.id);
  } catch (err) { console.error('Erreur génération BL :', err); showFeedback(err.message || 'Erreur génération BL', 'error'); }
}

async function openDeliveryNote(id) {
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/delivery-notes/${id}`);
    if (!response) return;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Impossible de charger le BL');
    renderDetail(data);
  } catch (err) { console.error('Erreur ouverture BL :', err); showFeedback(err.message || 'Erreur ouverture BL', 'error'); }
}

async function validateDeliveryNote() {
  if (!selectedDeliveryNote) return;
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/delivery-notes/${selectedDeliveryNote.id}/validate`, { method: 'POST' });
    if (!response) return;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur validation BL');
    showFeedback('BL validé et stock déstocké.');
    await refreshAll();
    await openDeliveryNote(selectedDeliveryNote.id);
  } catch (err) { console.error('Erreur validation BL :', err); showFeedback(err.message || 'Erreur validation BL', 'error'); }
}

function buildPrintHtml(document, lines) {
  return `<div class="print-header"><div><h1>Bon de livraison</h1><p><strong>${esc(document.reference_number || document.id)}</strong></p><p>Date : ${fmtDate(document.document_date)}</p></div><div><p><strong>Client livré</strong></p><p>${esc(document.client_name || document.delivered_client_name_snapshot || '-')}</p><p>${esc(document.client_store_identifier || document.delivered_client_store_identifier || '')}</p><p>${esc([document.address_line1, document.address_line2, document.postal_code, document.city].filter(Boolean).join(' '))}</p><p><strong>Client facturé :</strong> ${esc(document.billed_client_name || document.billed_client_name_snapshot || '-')}</p></div></div><table class="print-table"><thead><tr><th>PLU</th><th>Désignation</th><th>Colis</th><th>Poids</th><th>Traçabilité</th></tr></thead><tbody>${lines.map((line) => { const trace = line.traceability_snapshot || {}; const lots = Array.isArray(line.allocations) ? line.allocations.map((lot) => lot.lot_code || lot.supplier_lot_number).filter(Boolean).join(', ') : ''; return `<tr><td>${esc(line.article_plu || '')}</td><td>${esc(line.article_label || '')}</td><td>${Number(line.package_count || 0)}</td><td>${Number(line.total_weight || line.sold_quantity || 0).toFixed(3)} ${esc(line.sale_unit || 'kg')}</td><td>${esc(lots || trace.lot_code || trace.supplier_lot_number || '')}</td></tr>`; }).join('')}</tbody></table>`;
}

async function printDeliveryNote() {
  if (!selectedDeliveryNote) return;
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/delivery-notes/${selectedDeliveryNote.id}/print-data`);
    if (!response) return;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur préparation impression');
    printArea.innerHTML = buildPrintHtml(data.document, data.lines || []);
    window.print();
  } catch (err) { console.error('Erreur impression BL :', err); showFeedback(err.message || 'Erreur impression BL', 'error'); }
}

async function loadLabels() {
  if (!selectedDeliveryNote) return;
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/delivery-notes/${selectedDeliveryNote.id}/health-labels`);
    if (!response) return;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur préparation étiquettes');
    detailContent.innerHTML = `<div class="label-preview">${(data.labels || []).map((label) => { const trace = label.traceability || {}; const lots = (label.lots || []).map((lot) => lot.lot_code || lot.supplier_lot_number).filter(Boolean).join(', '); return `<article class="health-label"><h4>${esc(label.article_label || 'Article')}</h4><p><strong>Client livré :</strong> ${esc(label.delivered_client_name || '-')}</p><p><strong>Identifiant magasin :</strong> ${esc(label.delivered_client_store_identifier || '-')}</p><p><strong>BL :</strong> ${esc(label.delivery_note_reference || '-')}</p><p><strong>Quantité :</strong> ${Number(label.quantity || 0).toFixed(3)} ${esc(label.unit || 'kg')}</p><p><strong>Lot :</strong> ${esc(lots || trace.lot_code || '-')}</p><p><strong>DLC :</strong> ${esc((label.lots || []).map((lot) => lot.dlc).filter(Boolean).join(', ') || trace.dlc || '-')}</p><p><strong>Zone FAO :</strong> ${esc(trace.fao_zone || '-')}</p><p><strong>Méthode :</strong> ${esc(trace.production_method || '-')}</p></article>`; }).join('')}</div>`;
    detailTitle.textContent = 'Étiquettes sanitaires';
    detailSubtitle.textContent = `${(data.labels || []).length} étiquette(s) préparée(s)`;
  } catch (err) { console.error('Erreur étiquettes sanitaires :', err); showFeedback(err.message || 'Erreur étiquettes', 'error'); }
}

function bindEvents() {
  if (userNameEl) userNameEl.textContent = sessionUser.email || 'Utilisateur';
  $('logout-btn')?.addEventListener('click', logoutAndRedirect);
  $('home-btn')?.addEventListener('click', () => { window.location.href = './home.html'; });
  $('sales-btn')?.addEventListener('click', () => { window.location.href = './sales.html'; });
  $('refresh-btn')?.addEventListener('click', refreshAll);
  validateBtn?.addEventListener('click', validateDeliveryNote);
  printBtn?.addEventListener('click', printDeliveryNote);
  labelsBtn?.addEventListener('click', loadLabels);
  ordersBody?.addEventListener('click', (event) => { const btn = event.target.closest('[data-generate]'); if (btn) generateDeliveryNote(btn.dataset.generate); });
  deliveryNotesBody?.addEventListener('click', (event) => { const btn = event.target.closest('[data-open]'); if (btn) openDeliveryNote(btn.dataset.open); });
}

bindEvents();
refreshAll();
