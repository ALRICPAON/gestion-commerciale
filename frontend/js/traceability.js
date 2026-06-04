const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
const authToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');

if (!sessionUser || !authToken) {
  window.location.href = './login.html';
}

const els = {
  userName: document.getElementById('user-name'),
  backHome: document.getElementById('back-home-btn'),
  logout: document.getElementById('logout-btn'),
  from: document.getElementById('filter-from'),
  to: document.getElementById('filter-to'),
  plu: document.getElementById('filter-plu'),
  lot: document.getElementById('filter-lot'),
  supplier: document.getElementById('filter-supplier'),
  client: document.getElementById('filter-client'),
  clientSuggestions: document.getElementById('trace-client-suggestions'),
  status: document.getElementById('filter-status'),
  sourceType: document.getElementById('filter-source-type'),
  movementType: document.getElementById('filter-movement-type'),
  apply: document.getElementById('apply-filters-btn'),
  count: document.getElementById('trace-count'),
  state: document.getElementById('trace-state'),
  list: document.getElementById('trace-list'),
  loadMore: document.getElementById('load-more-btn'),
  lotModal: document.getElementById('lot-modal'),
  lotModalTitle: document.getElementById('lot-modal-title'),
  lotModalSubtitle: document.getElementById('lot-modal-subtitle'),
  lotModalBody: document.getElementById('lot-modal-body'),
  lotModalClose: document.getElementById('lot-modal-close'),
  photoModal: document.getElementById('photo-modal'),
  photoPreview: document.getElementById('photo-preview'),
  photoModalClose: document.getElementById('photo-modal-close'),
};

const state = {
  limit: 30,
  offset: 0,
  loading: false,
  clientSearchTimer: null,
};

function logoutAndRedirect() {
  ['gc_token', 'gc_user', 'gc_active_department', 'grv2_token', 'grv2_user', 'grv2_active_department'].forEach((key) => localStorage.removeItem(key));
  window.location.href = './login.html';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('fr-FR');
}

function qty(value) {
  const number = Number(value || 0);
  return number.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function absoluteAssetUrl(url) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${API_BASE_URL}${url}`;
}

async function apiFetch(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });

  if (response.status === 401) {
    logoutAndRedirect();
    return null;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur API');
  return data;
}

function setState(text, mode = 'idle') {
  els.state.textContent = text;
  els.state.dataset.mode = mode;
}

function statusBadge(status) {
  if (status === 'closed') return '<span class="trace-badge trace-badge-closed">Fermé</span>';
  if (status === 'partial') return '<span class="trace-badge trace-badge-partial">Partiel</span>';
  return '<span class="trace-badge trace-badge-open">Ouvert</span>';
}

function sourceLabel(value) {
  if (value === 'purchase') return 'Achat';
  if (value === 'transformation') return 'Transformation';
  if (value === 'fabrication') return 'Fabrication';
  return value || 'Lot';
}

function movementLabel(value) {
  const labels = {
    purchase_in: 'Entrée achat',
    sale_out: 'Sortie vente',
    forced_stock_exit: 'Sortie forcée',
    inventory_sale_out: 'Sortie inventaire',
    transformation_in: 'Entrée transformation',
    transformation_out: 'Sortie transformation',
    fabrication_in: 'Entrée fabrication',
    fabrication_out: 'Sortie fabrication',
  };
  return labels[value] || value || 'Mouvement';
}

function filterParams({ append = false } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(state.limit));
  params.set('offset', String(append ? state.offset : 0));

  [
    ['from', els.from.value],
    ['to', els.to.value],
    ['plu', els.plu.value.trim()],
    ['lot', els.lot.value.trim()],
    ['supplier', els.supplier.value.trim()],
    ['client', els.client.value.trim()],
    ['status', els.status.value],
    ['source_type', els.sourceType.value],
    ['movement_type', els.movementType.value],
  ].forEach(([key, value]) => {
    if (value) params.set(key, value);
  });

  return params;
}

function deliveredClientLine(item) {
  const billedDifferent = item.billed_client_name && item.billed_client_name !== item.delivered_client_name;
  return `<div class="trace-client-line">
    <div><strong>${escapeHtml(item.delivered_client_name || '-')}</strong><span>${escapeHtml(item.delivered_store_identifier || item.delivered_client_code || '')}</span></div>
    <div>${billedDifferent ? escapeHtml(item.billed_client_name) : '<span class="muted">Même client facturé</span>'}</div>
    <div>${escapeHtml(item.delivery_note_reference || item.delivery_note_id || '-')}</div>
    <div>${escapeHtml(formatDate(item.delivery_note_date))}</div>
    <div class="num">${escapeHtml(qty(item.delivered_quantity))}</div>
    <div>${item.sale_detail_url ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(item.sale_detail_url)}">Ouvrir BL</a>` : ''}</div>
  </div>`;
}

function deliveredClientsPreview(lot) {
  if (!lot.delivered_clients?.length) return '<div class="trace-empty-small">Aucun client livré via allocation.</div>';
  return `<div class="trace-client-preview">${lot.delivered_clients.map(deliveredClientLine).join('')}</div>`;
}

function photoGallery(urls = []) {
  if (!urls.length) return '';
  return `<div class="trace-photo-gallery">${urls.map((url) => {
    const absolute = absoluteAssetUrl(url);
    return `<img class="trace-photo" src="${escapeHtml(absolute)}" alt="Photo sanitaire" data-photo="${escapeHtml(absolute)}" />`;
  }).join('')}</div>`;
}

function renderLotCard(lot) {
  const trace = lot.traceability || {};
  return `<article class="trace-card" data-lot-id="${escapeHtml(lot.lot_id)}">
    <div class="trace-card-header">
      <div><h3>${escapeHtml(lot.article_plu || '-')} - ${escapeHtml(lot.article_label || '-')}</h3><p>Lot ${escapeHtml(lot.lot_code || '-')} · ${escapeHtml(sourceLabel(lot.source_type))}</p></div>
      ${statusBadge(lot.status)}
    </div>
    <div class="trace-card-grid">
      <div><span>Fournisseur</span><strong>${escapeHtml(lot.supplier_name || '-')}</strong></div>
      <div><span>DLC</span><strong>${escapeHtml(formatDate(lot.dlc))}</strong></div>
      <div><span>Initial</span><strong>${escapeHtml(qty(lot.qty_initial))}</strong></div>
      <div><span>Restant</span><strong>${escapeHtml(qty(lot.qty_remaining))}</strong></div>
      <div><span>FAO</span><strong>${escapeHtml(trace.fao_zone || '-')}</strong></div>
      <div><span>Engin</span><strong>${escapeHtml(trace.fishing_gear || '-')}</strong></div>
    </div>
    <section class="trace-card-clients"><h4>Clients livrés</h4>${deliveredClientsPreview(lot)}</section>
    <div class="trace-card-actions"><button type="button" class="btn btn-primary btn-detail" data-lot-id="${escapeHtml(lot.lot_id)}">Détail lot</button>${lot.purchase_id ? `<a class="btn btn-secondary" href="./purchase-detail.html?id=${encodeURIComponent(lot.purchase_id)}">Achat source</a>` : ''}</div>
  </article>`;
}

function renderList(items, { append = false } = {}) {
  if (!append) els.list.innerHTML = '';
  if (!append && !items.length) {
    els.list.innerHTML = '<div class="trace-empty">Aucun lot trouvé.</div>';
    els.count.textContent = '0';
    els.loadMore.classList.add('hidden');
    return;
  }

  els.list.insertAdjacentHTML('beforeend', items.map(renderLotCard).join(''));
  els.count.textContent = String((append ? Number(els.count.textContent || 0) : 0) + items.length);
  els.loadMore.classList.toggle('hidden', items.length < state.limit);
}

async function loadLots({ append = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  els.apply.disabled = true;
  els.loadMore.disabled = true;
  setState('Chargement', 'loading');

  try {
    const data = await apiFetch(`/api/traceability/lots?${filterParams({ append }).toString()}`);
    const items = Array.isArray(data) ? data : [];
    if (!append) state.offset = 0;
    renderList(items, { append });
    state.offset += items.length;
    setState('Prêt', 'idle');
  } catch (err) {
    console.error('Erreur chargement traçabilité :', err);
    if (!append) els.list.innerHTML = `<div class="trace-empty">${escapeHtml(err.message || 'Erreur chargement')}</div>`;
    setState('Erreur', 'error');
  } finally {
    state.loading = false;
    els.apply.disabled = false;
    els.loadMore.disabled = false;
  }
}

function renderInfoBlock(lot) {
  const trace = lot.traceability || {};
  return `<section class="trace-detail-card"><h3>Lot</h3>
    <dl class="trace-definition-list">
      <dt>PLU</dt><dd>${escapeHtml(lot.article_plu || '-')}</dd>
      <dt>Désignation</dt><dd>${escapeHtml(lot.article_label || '-')}</dd>
      <dt>Fournisseur</dt><dd>${escapeHtml(lot.supplier_name || '-')}</dd>
      <dt>Date achat</dt><dd>${escapeHtml(formatDate(lot.purchase_date || lot.receipt_date))}</dd>
      <dt>BL fournisseur</dt><dd>${escapeHtml(lot.bl_number || '-')}</dd>
      <dt>DLC</dt><dd>${escapeHtml(formatDate(lot.dlc))}</dd>
      <dt>Lot</dt><dd>${escapeHtml(lot.lot_code || '-')}</dd>
      <dt>Quantité initiale</dt><dd>${escapeHtml(qty(lot.qty_initial))}</dd>
      <dt>Quantité restante</dt><dd>${escapeHtml(qty(lot.qty_remaining))}</dd>
      <dt>FAO</dt><dd>${escapeHtml(trace.fao_zone || '-')}</dd>
      <dt>Sous-zone</dt><dd>${escapeHtml(trace.sous_zone || '-')}</dd>
      <dt>Engin</dt><dd>${escapeHtml(trace.fishing_gear || '-')}</dd>
      <dt>Nom latin</dt><dd>${escapeHtml(trace.latin_name || '-')}</dd>
      <dt>Origine</dt><dd>${escapeHtml(trace.origin_label || '-')}</dd>
      <dt>Allergènes</dt><dd>${escapeHtml(trace.allergens || '-')}</dd>
    </dl>
    ${lot.purchase_id ? `<a class="btn btn-secondary" href="./purchase-detail.html?id=${encodeURIComponent(lot.purchase_id)}">Ouvrir achat source</a>` : ''}
    ${photoGallery(lot.sanitary_photo_urls)}
  </section>`;
}

function renderMovements(movements = []) {
  if (!movements.length) return '<section class="trace-detail-card"><h3>Mouvements</h3><div class="trace-empty-small">Aucun mouvement.</div></section>';
  return `<section class="trace-detail-card"><h3>Mouvements</h3><div class="trace-movement-list">${movements.map((movement) => `<div class="trace-movement-line"><span>${escapeHtml(formatDate(movement.created_at))}</span><strong>${escapeHtml(movement.movement_label || movementLabel(movement.movement_type))}</strong><span class="num">${escapeHtml(qty(movement.quantity))}</span><span>${escapeHtml(movement.notes || '')}</span></div>`).join('')}</div></section>`;
}

function renderDeliveredClients(clients = []) {
  if (!clients.length) return '<section class="trace-detail-card"><h3>Clients livrés</h3><div class="trace-empty-small">Aucun client livré via allocation. Voir les mouvements pour les sorties directes.</div></section>';
  return `<section class="trace-detail-card"><h3>Clients livrés</h3><div class="trace-client-table"><div class="trace-client-head"><span>Client livré</span><span>Identifiant magasin</span><span>Client facturé</span><span>BL</span><span>Date BL</span><span>Quantité</span><span></span></div>${clients.map((item) => `<div class="trace-client-row"><span><strong>${escapeHtml(item.delivered_client_name || '-')}</strong><small>${escapeHtml(item.delivered_client_code || '')}</small></span><span>${escapeHtml(item.delivered_store_identifier || '-')}</span><span>${escapeHtml(item.billed_client_name || '-')}</span><span>${escapeHtml(item.delivery_note_reference || item.delivery_note_id || '-')}</span><span>${escapeHtml(formatDate(item.delivery_note_date))}</span><span class="num">${escapeHtml(qty(item.delivered_quantity))}</span><span>${item.sale_detail_url ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(item.sale_detail_url)}">Ouvrir BL</a>` : ''}</span></div>`).join('')}</div></section>`;
}

async function openLotDetail(lotId) {
  els.lotModal.classList.remove('hidden');
  els.lotModalBody.innerHTML = '<div class="trace-empty">Chargement...</div>';

  try {
    const data = await apiFetch(`/api/traceability/lots/${encodeURIComponent(lotId)}`);
    const lot = data.lot || {};
    els.lotModalTitle.textContent = `${lot.article_plu || '-'} - ${lot.article_label || 'Lot'}`;
    els.lotModalSubtitle.textContent = `Lot ${lot.lot_code || '-'}`;
    els.lotModalBody.innerHTML = `<div class="trace-detail-grid">${renderInfoBlock(lot)}${renderDeliveredClients(lot.delivered_clients)}${renderMovements(data.movements || [])}</div>`;
  } catch (err) {
    els.lotModalBody.innerHTML = `<div class="trace-empty">${escapeHtml(err.message || 'Erreur détail lot')}</div>`;
  }
}

function closeLotModal() {
  els.lotModal.classList.add('hidden');
}

function openPhoto(src) {
  els.photoPreview.src = src;
  els.photoModal.classList.remove('hidden');
}

function closePhoto() {
  els.photoPreview.src = '';
  els.photoModal.classList.add('hidden');
}

async function refreshClientSuggestions() {
  const search = els.client.value.trim();
  if (search.length < 2) return;
  try {
    const clients = await apiFetch(`/api/traceability/clients?search=${encodeURIComponent(search)}&limit=10`);
    els.clientSuggestions.innerHTML = clients.map((client) => `<option value="${escapeHtml(client.name || client.code || '')}">${escapeHtml([client.code, client.store_identifier].filter(Boolean).join(' · '))}</option>`).join('');
  } catch (err) {
    console.error('Erreur suggestions clients :', err);
  }
}

function bindEvents() {
  els.userName.textContent = sessionUser.email || 'Utilisateur';
  els.backHome.addEventListener('click', () => { window.location.href = './home.html'; });
  els.logout.addEventListener('click', logoutAndRedirect);
  els.apply.addEventListener('click', () => loadLots({ append: false }));
  els.loadMore.addEventListener('click', () => loadLots({ append: true }));
  els.client.addEventListener('input', () => {
    window.clearTimeout(state.clientSearchTimer);
    state.clientSearchTimer = window.setTimeout(refreshClientSuggestions, 250);
  });
  els.list.addEventListener('click', (event) => {
    const detail = event.target.closest('.btn-detail');
    if (detail?.dataset.lotId) openLotDetail(detail.dataset.lotId);
  });
  document.addEventListener('click', (event) => {
    const photo = event.target.closest('.trace-photo');
    if (photo?.dataset.photo) openPhoto(photo.dataset.photo);
  });
  els.lotModalClose.addEventListener('click', closeLotModal);
  els.lotModal.addEventListener('click', (event) => { if (event.target.dataset.closeModal === 'true') closeLotModal(); });
  els.photoModalClose.addEventListener('click', closePhoto);
  els.photoModal.addEventListener('click', (event) => { if (event.target.dataset.closePhoto === 'true') closePhoto(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeLotModal(); closePhoto(); } });
}

bindEvents();
loadLots({ append: false });
