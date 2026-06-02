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
const invoiceBtn = $('invoice-btn');
const printBtn = $('print-btn');
const labelsBtn = $('labels-btn');
const printArea = $('print-area');
let selectedDeliveryNote = null;

function logoutAndRedirect() { ['gc_token', 'gc_user', 'gc_active_department', 'grv2_token', 'grv2_user', 'grv2_active_department'].forEach((key) => localStorage.removeItem(key)); window.location.href = './login.html'; }
function showFeedback(message, type = 'success') { if (!pageFeedback) return; pageFeedback.textContent = message; pageFeedback.className = `page-feedback ${type}`; setTimeout(() => { pageFeedback.className = 'page-feedback hidden'; pageFeedback.textContent = ''; }, 3500); }
async function apiFetch(url, options = {}) { const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${authToken}` } }); if (response.status === 401) { logoutAndRedirect(); return null; } return response; }
const money = (value) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
const qty = (value) => Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fmtDate = (value) => (value ? new Intl.DateTimeFormat('fr-FR').format(new Date(value)) : '-');
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const statusLabel = (status) => ({ draft: 'Brouillon', validated: 'Validé BL', delivered: 'Livré', invoiced: 'Facturé' }[status] || status || '-');

function renderOrders(orders) {
  const candidates = orders.filter((order) => order.document_type === 'ORDER' && order.status === 'validated');
  ordersBody.innerHTML = candidates.length ? '' : '<tr><td colspan="5">Aucune commande validée en attente de BL.</td></tr>';
  candidates.forEach((order) => {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${esc(order.reference_number || order.id.slice(0, 8))}</td><td>${esc(order.client_name || '-')}</td><td>${fmtDate(order.document_date)}</td><td>${money(order.total_amount_ex_vat)}</td><td><button type="button" class="btn btn-primary" data-generate="${order.id}">Valider en BL</button></td>`;
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
  invoiceBtn.disabled = note.status !== 'validated';
  printBtn.disabled = false;
  labelsBtn.disabled = false;
  detailContent.classList.remove('empty-state');
  const rows = (note.lines || []).map((line) => `<tr><td>${line.line_number}</td><td>${esc(line.article_plu || '')} ${esc(line.article_label || '')}</td><td>${Number(line.package_count || 0)}</td><td>${qty(line.total_weight || line.sold_quantity)} ${esc(line.sale_unit || 'kg')}</td><td>${money(line.unit_sale_price_ht)}</td><td>${money(line.line_amount_ht)}</td><td>${Number(line.vat_rate || 0).toFixed(2)} %</td><td>${money(line.line_amount_ttc)}</td></tr>`).join('');
  detailContent.innerHTML = `<div class="summary-grid"><div class="summary-item"><span class="summary-label">Client livré</span><span class="summary-value">${esc(note.client_name || note.delivered_client_name_snapshot || '-')}</span></div><div class="summary-item"><span class="summary-label">Identifiant magasin</span><span class="summary-value">${esc(note.client_store_identifier || note.delivered_client_store_identifier || '-')}</span></div><div class="summary-item"><span class="summary-label">Client facturé</span><span class="summary-value">${esc(note.billed_client_name || note.billed_client_name_snapshot || '-')}</span></div><div class="summary-item"><span class="summary-label">Facture</span><span class="summary-value">${esc(note.invoice_reference || note.invoice_id || '-')}</span></div></div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Ligne</th><th>Article</th><th>Colis</th><th>Poids</th><th>Prix HT</th><th>Total HT</th><th>TVA</th><th>TTC</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function loadOrders() { const response = await apiFetch(`${API_BASE_URL}/api/sales?document_type=ORDER&status=validated`); if (!response) return; const data = await response.json().catch(() => []); if (!response.ok) throw new Error(data.error || 'Impossible de charger les commandes'); renderOrders(Array.isArray(data) ? data : []); }
async function loadDeliveryNotes() { const response = await apiFetch(`${API_BASE_URL}/api/delivery-notes`); if (!response) return; const data = await response.json().catch(() => []); if (!response.ok) throw new Error(data.error || 'Impossible de charger les BL'); renderDeliveryNotes(Array.isArray(data) ? data : []); }
async function refreshAll() { try { await Promise.all([loadOrders(), loadDeliveryNotes()]); } catch (err) { console.error('Erreur chargement BL :', err); showFeedback(err.message || 'Erreur chargement', 'error'); } }
async function generateDeliveryNote(orderId) { try { const response = await apiFetch(`${API_BASE_URL}/api/sales/${orderId}/validate-delivery-note`, { method: 'POST' }); if (!response) return; const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Erreur validation en BL'); showFeedback('Commande validée en BL et stock déstocké.'); await refreshAll(); if (data.delivery_note_id) await openDeliveryNote(data.delivery_note_id); } catch (err) { console.error('Erreur validation en BL :', err); showFeedback(err.message || 'Erreur validation en BL', 'error'); } }
async function openDeliveryNote(id) { try { const response = await apiFetch(`${API_BASE_URL}/api/delivery-notes/${id}`); if (!response) return; const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Impossible de charger le BL'); renderDetail(data); } catch (err) { console.error('Erreur ouverture BL :', err); showFeedback(err.message || 'Erreur ouverture BL', 'error'); } }
async function validateDeliveryNote() { if (!selectedDeliveryNote) return; try { const response = await apiFetch(`${API_BASE_URL}/api/delivery-notes/${selectedDeliveryNote.id}/validate`, { method: 'POST' }); if (!response) return; const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Erreur validation BL'); showFeedback('BL validé et stock déstocké.'); await refreshAll(); await openDeliveryNote(selectedDeliveryNote.id); } catch (err) { console.error('Erreur validation BL :', err); showFeedback(err.message || 'Erreur validation BL', 'error'); } }
async function validateInvoice() { if (!selectedDeliveryNote) return; try { const response = await apiFetch(`${API_BASE_URL}/api/delivery-notes/${selectedDeliveryNote.id}/validate-invoice`, { method: 'POST' }); if (!response) return; const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Erreur validation facture'); showFeedback(data.existing ? 'Facture déjà préparée.' : 'Facture préparée depuis le BL.'); await refreshAll(); await openDeliveryNote(selectedDeliveryNote.id); } catch (err) { console.error('Erreur validation facture :', err); showFeedback(err.message || 'Erreur validation facture', 'error'); } }

function lineLots(line) {
  return (line.allocations || [])
    .map((lot) => [lot.lot_code, lot.supplier_lot_number, lot.dlc ? `DLC ${fmtDate(lot.dlc)}` : null, lot.quantity ? `${qty(lot.quantity)} kg` : null].filter(Boolean).join(' - '))
    .filter(Boolean)
    .join('<br>');
}

function infoLine(label, value) {
  return value ? `<p><span>${esc(label)}</span>${esc(value)}</p>` : '';
}

function addressBlock(parts) {
  return parts.filter(Boolean).map((part) => `<p>${esc(part)}</p>`).join('');
}

function buildPrintHtml(document, lines, storeSettings = null) {
  const settings = storeSettings || {};
  const companyName = settings.company_name || 'Gestion Commerciale';
  const deliveredStoreId = document.client_store_identifier || document.delivered_client_store_identifier || '';
  const sourceOrder = document.source_order_reference || document.source_order_id || '';
  const rows = lines.map((line) => `<tr><td>${esc(line.line_number || '')}</td><td><strong>${esc(line.article_label || '-')}</strong><small>${esc(line.article_plu || '')}</small></td><td class="num">${Number(line.package_count || 0)}</td><td class="num">${qty(line.total_weight || line.sold_quantity)} ${esc(line.sale_unit || 'kg')}</td><td>${lineLots(line) || '-'}</td><td class="num">${money(line.unit_sale_price_ht)}</td><td class="num">${money(line.line_amount_ht)}</td><td class="num">${Number(line.vat_rate || 0).toFixed(2)} %</td><td class="num">${money(line.line_amount_ttc)}</td></tr>`).join('');

  return `<article class="bl-print-document">
    <header class="bl-print-header">
      <div class="bl-company">
        ${settings.logo_url ? `<img class="bl-logo" src="${esc(settings.logo_url)}" alt="Logo ${esc(companyName)}">` : ''}
        <div>
          <h1>${esc(companyName)}</h1>
          ${addressBlock([settings.address_line1, settings.address_line2, [settings.postal_code, settings.city].filter(Boolean).join(' '), settings.country])}
          <div class="bl-company-meta">
            ${infoLine('Tél.', settings.phone)}
            ${infoLine('Email', settings.email)}
            ${infoLine('SIRET', settings.siret)}
            ${infoLine('TVA', settings.vat_number)}
            ${infoLine('Agrément sanitaire', settings.sanitary_approval_number)}
          </div>
        </div>
      </div>
      <div class="bl-document-meta">
        <p class="bl-label">Bon de livraison</p>
        <h2>${esc(document.reference_number || document.id)}</h2>
        <p>Date : <strong>${fmtDate(document.document_date)}</strong></p>
        ${sourceOrder ? `<p>Commande : <strong>${esc(sourceOrder)}</strong></p>` : ''}
      </div>
    </header>

    <section class="bl-parties">
      <div class="bl-party-card">
        <h3>Client livré</h3>
        <p class="bl-party-name">${esc(document.client_name || document.delivered_client_name_snapshot || '-')}</p>
        ${deliveredStoreId ? `<p>Identifiant magasin : <strong>${esc(deliveredStoreId)}</strong></p>` : ''}
        ${addressBlock([document.address_line1, document.address_line2, [document.postal_code, document.city].filter(Boolean).join(' ')])}
      </div>
      <div class="bl-party-card">
        <h3>Client facturé</h3>
        <p class="bl-party-name">${esc(document.billed_client_name || document.billed_client_name_snapshot || '-')}</p>
        ${document.billed_client_code ? `<p>Code client : <strong>${esc(document.billed_client_code)}</strong></p>` : ''}
      </div>
    </section>

    <table class="print-table bl-lines-table">
      <thead><tr><th>Ligne</th><th>Désignation</th><th>Colis</th><th>Poids</th><th>Lots</th><th>Prix HT</th><th>Total HT</th><th>TVA</th><th>TTC</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="9">Aucune ligne.</td></tr>'}</tbody>
    </table>

    <section class="bl-bottom">
      <div class="bl-notes">
        ${document.notes ? `<h3>Notes</h3><p>${esc(document.notes)}</p>` : ''}
        ${settings.delivery_note_footer ? `<h3>Pied de bon de livraison</h3><p>${esc(settings.delivery_note_footer)}</p>` : ''}
      </div>
      <div class="bl-totals">
        <p><span>Total HT</span><strong>${money(document.total_amount_ex_vat)}</strong></p>
        <p><span>TVA</span><strong>${money(document.total_vat_amount)}</strong></p>
        <p class="grand-total"><span>Total TTC</span><strong>${money(document.total_amount_inc_vat)}</strong></p>
      </div>
    </section>

    <section class="bl-signature">
      <div><p>Date de réception</p></div>
      <div><p>Nom et signature du réceptionnaire</p></div>
      <div><p>Cachet client</p></div>
    </section>
  </article>`;
}
async function printDeliveryNote() { if (!selectedDeliveryNote) return; try { const response = await apiFetch(`${API_BASE_URL}/api/delivery-notes/${selectedDeliveryNote.id}/print-data`); if (!response) return; const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Erreur préparation impression'); printArea.innerHTML = buildPrintHtml(data.document, data.lines || [], data.store_settings); window.print(); } catch (err) { console.error('Erreur impression BL :', err); showFeedback(err.message || 'Erreur impression BL', 'error'); } }
async function loadLabels() { if (!selectedDeliveryNote) return; try { const response = await apiFetch(`${API_BASE_URL}/api/delivery-notes/${selectedDeliveryNote.id}/health-labels`); if (!response) return; const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Erreur préparation étiquettes'); detailContent.innerHTML = `<div class="label-preview">${(data.labels || []).map((label) => { const trace = label.traceability || {}; const lots = (label.lots || []).map((lot) => lot.lot_code || lot.supplier_lot_number).filter(Boolean).join(', '); return `<article class="health-label"><h4>${esc(label.article_label || 'Article')}</h4><p><strong>Client livré :</strong> ${esc(label.delivered_client_name || '-')}</p><p><strong>Identifiant magasin :</strong> ${esc(label.delivered_client_store_identifier || '-')}</p><p><strong>BL :</strong> ${esc(label.delivery_note_reference || '-')}</p><p><strong>Quantité :</strong> ${qty(label.quantity)} ${esc(label.unit || 'kg')}</p><p><strong>Lot :</strong> ${esc(lots || trace.lot_code || '-')}</p><p><strong>DLC :</strong> ${esc((label.lots || []).map((lot) => lot.dlc).filter(Boolean).join(', ') || trace.dlc || '-')}</p><p><strong>Zone FAO :</strong> ${esc(trace.fao_zone || '-')}</p><p><strong>Méthode :</strong> ${esc(trace.production_method || '-')}</p></article>`; }).join('')}</div>`; detailTitle.textContent = 'Étiquettes sanitaires'; detailSubtitle.textContent = `${(data.labels || []).length} étiquette(s) préparée(s)`; } catch (err) { console.error('Erreur étiquettes sanitaires :', err); showFeedback(err.message || 'Erreur étiquettes', 'error'); } }

function bindEvents() {
  if (userNameEl) userNameEl.textContent = sessionUser.email || 'Utilisateur';
  $('logout-btn')?.addEventListener('click', logoutAndRedirect);
  $('home-btn')?.addEventListener('click', () => { window.location.href = './home.html'; });
  $('sales-btn')?.addEventListener('click', () => { window.location.href = './sales.html'; });
  $('refresh-btn')?.addEventListener('click', refreshAll);
  validateBtn?.addEventListener('click', validateDeliveryNote);
  invoiceBtn?.addEventListener('click', validateInvoice);
  printBtn?.addEventListener('click', printDeliveryNote);
  labelsBtn?.addEventListener('click', loadLabels);
  ordersBody?.addEventListener('click', (event) => { const btn = event.target.closest('[data-generate]'); if (btn) generateDeliveryNote(btn.dataset.generate); });
  deliveryNotesBody?.addEventListener('click', (event) => { const btn = event.target.closest('[data-open]'); if (btn) openDeliveryNote(btn.dataset.open); });
}

bindEvents();
refreshAll().then(() => { const openId = new URLSearchParams(window.location.search).get('open'); if (openId) openDeliveryNote(openId); });
