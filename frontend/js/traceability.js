const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const els = {
  userName: document.getElementById('user-name'),
  backHomeBtn: document.getElementById('back-home-btn'),
  logoutBtn: document.getElementById('logout-btn'),

  from: document.getElementById('filter-from'),
  to: document.getElementById('filter-to'),
  plu: document.getElementById('filter-plu'),
  supplier: document.getElementById('filter-supplier'),
  status: document.getElementById('filter-status'),
  sourceType: document.getElementById('filter-source-type'),
  movementType: document.getElementById('filter-movement-type'),
  applyBtn: document.getElementById('btn-apply-filters'),

  list: document.getElementById('trace-list'),
  count: document.getElementById('trace-count'),
  loadingState: document.getElementById('trace-loading-state'),
  loadMoreBtn: document.getElementById('btn-load-more'),

  lotModal: document.getElementById('trace-lot-modal'),
  lotModalTitle: document.getElementById('trace-modal-title'),
  lotModalSubtitle: document.getElementById('trace-modal-subtitle'),
  lotModalBody: document.getElementById('trace-modal-body'),
  lotModalClose: document.getElementById('trace-modal-close'),

  imageModal: document.getElementById('trace-image-modal'),
  imagePreview: document.getElementById('trace-image-preview'),
  imageClose: document.getElementById('trace-image-close'),
};

const state = {
  sessionUser: null,
  activeDepartment: null,
  limit: 20,
  offset: 0,
  lastBatchSize: 0,
  loading: false,
};

function getStoredJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function logout() {
  localStorage.removeItem('grv2_token');
  localStorage.removeItem('grv2_user');
  localStorage.removeItem('grv2_active_department');
  window.location.href = './login.html';
}

function getToken() {
  return localStorage.getItem('grv2_token');
}

async function apiFetch(path, options = {}) {
  const token = getToken();

  if (!token) {
    logout();
    throw new Error('Token manquant');
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (response.status === 401) {
    logout();
    throw new Error('Session expirée');
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Erreur API');
  }

  return data;
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR');
}

function formatQty(value) {
  const n = Number(value || 0);
  return n.toFixed(3);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getStatusBadgeHtml(status) {
  if (status === 'closed') {
    return `<span class="trace-badge trace-badge-closed">ÉPUISÉ</span>`;
  }
  if (status === 'partial') {
    return `<span class="trace-badge trace-badge-partial">PARTIEL</span>`;
  }
  return `<span class="trace-badge trace-badge-open">EN STOCK</span>`;
}

function getSourceLabel(sourceType) {
  switch (sourceType) {
    case 'purchase':
      return 'ACHAT';
    case 'transformation':
      return 'TRANSFORMATION';
    case 'fabrication':
      return 'FABRICATION';
    default:
      return sourceType || 'LOT';
  }
}

function setLoadingState(text, mode = 'idle') {
  els.loadingState.textContent = text;
  els.loadingState.className = `trace-summary-value trace-loading-${mode}`;
}

function getFilters() {
  return {
    from: els.from.value || '',
    to: els.to.value || '',
    plu: els.plu.value.trim(),
    supplier: els.supplier.value.trim(),
    status: els.status.value,
    source_type: els.sourceType.value,
    movement_type: els.movementType.value,
  };
}

function buildTraceabilityUrl({ append = false } = {}) {
  const filters = getFilters();
  const params = new URLSearchParams();

  params.set('department_id', state.activeDepartment.id);
  params.set('limit', String(state.limit));
  params.set('offset', String(append ? state.offset : 0));

  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });

  return `/api/traceability/lots?${params.toString()}`;
}

function buildImageUrl(path) {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${API_BASE_URL}${path}`;
}

function getLotPhotoUrls(lot) {
  const urls = [];

  if (Array.isArray(lot.sanitary_photo_urls)) {
    lot.sanitary_photo_urls.forEach((url) => {
      if (url) {
        urls.push(buildImageUrl(url));
      }
    });
  }

  if (lot.sanitary_photo_url) {
    urls.unshift(buildImageUrl(lot.sanitary_photo_url));
  }

  return [...new Set(urls)];
}

function renderPhotoGallery(photoUrls) {
  if (!Array.isArray(photoUrls) || photoUrls.length === 0) {
    return '';
  }

  return `
    <div class="trace-photo-gallery">
      ${photoUrls.map((url) => `
        <img
          src="${escapeHtml(url)}"
          alt="Photo traçabilité"
          class="trace-photo"
          data-photo="${escapeHtml(url)}"
        />
      `).join('')}
    </div>
  `;
}

function renderMovementsPreview(movements) {
  if (!Array.isArray(movements) || movements.length === 0) {
    return `<div class="trace-empty-small">Aucun mouvement</div>`;
  }

  return movements
    .map((m) => {
      const qty = Number(m.quantity || 0);
      const sign = qty > 0 ? '+' : '';
      return `
        <div class="trace-movement-line">
          <span>${escapeHtml(formatDate(m.created_at))}</span>
          <span>${escapeHtml(m.movement_label || m.movement_type || 'Mouvement')}</span>
          <strong>${sign}${formatQty(qty)}</strong>
        </div>
      `;
    })
    .join('');
}

function renderTraceCard(lot) {
  const photoUrls = getLotPhotoUrls(lot);
  const trace = lot.traceability || {};

  return `
    <article class="card trace-card" data-lot-id="${escapeHtml(lot.lot_id)}">
      <div class="trace-card-header">
        <div>
          <div class="trace-card-title">
            ${escapeHtml(getSourceLabel(lot.source_type))} — ${escapeHtml(formatDate(lot.created_at))}
          </div>
          <div class="trace-card-subtitle">
            Lot ${escapeHtml(lot.lot_code || '—')}
          </div>
        </div>

        <div class="trace-card-badges">
          ${getStatusBadgeHtml(lot.status)}
        </div>
      </div>

      <div class="trace-card-body">
        <div class="trace-main-info">
          <div><strong>PLU :</strong> ${escapeHtml(lot.article_plu || '—')}</div>
          <div><strong>Désignation :</strong> ${escapeHtml(lot.article_label || '—')}</div>
          <div><strong>Fournisseur :</strong> ${escapeHtml(lot.supplier_name || '—')}</div>
          <div><strong>DLC :</strong> ${escapeHtml(formatDate(lot.dlc))}</div>
          <div><strong>FAO :</strong> ${escapeHtml(trace.fao_zone || '—')}</div>
          <div><strong>Sous-zone :</strong> ${escapeHtml(trace.sous_zone || '—')}</div>
          <div><strong>Engin :</strong> ${escapeHtml(trace.fishing_gear || '—')}</div>
          <div><strong>Espèce :</strong> ${escapeHtml(trace.latin_name || '—')}</div>
          <div><strong>Origine :</strong> ${escapeHtml(trace.origin_label || '—')}</div>
        </div>

        <div class="trace-qty-row">
          <div class="trace-qty-box">
            <span class="trace-qty-label">Initial</span>
            <strong>${escapeHtml(formatQty(lot.qty_initial))} kg</strong>
          </div>
          <div class="trace-qty-box">
            <span class="trace-qty-label">Restant</span>
            <strong>${escapeHtml(formatQty(lot.qty_remaining))} kg</strong>
          </div>
        </div>

       ${renderPhotoGallery(photoUrls)}

        <div class="trace-movements-block">
          <div class="trace-movements-title">Derniers mouvements</div>
          ${renderMovementsPreview(lot.movements_preview)}
        </div>

        <div class="trace-card-actions">
          <button class="btn btn-primary btn-trace-detail" data-lot-id="${escapeHtml(lot.lot_id)}">
            Voir détail
          </button>
          ${
            lot.purchase_id
              ? `<a class="btn btn-secondary" href="./purchase-detail.html?id=${encodeURIComponent(lot.purchase_id)}">Achat source</a>`
              : ''
          }
        </div>
      </div>
    </article>
  `;
}

function renderTraceList(items, { append = false } = {}) {
  if (!append) {
    els.list.innerHTML = '';
  }

  if (!append && items.length === 0) {
    els.list.innerHTML = `<div class="card trace-empty">Aucun lot trouvé.</div>`;
    els.count.textContent = '0';
    els.loadMoreBtn.style.display = 'none';
    return;
  }

  const html = items.map(renderTraceCard).join('');
  els.list.insertAdjacentHTML('beforeend', html);

  const currentCount = append
    ? Number(els.count.textContent || 0) + items.length
    : items.length;

  els.count.textContent = String(currentCount);
}

async function loadTraceability({ append = false } = {}) {
  if (state.loading) return;

  state.loading = true;
  els.applyBtn.disabled = true;
  els.loadMoreBtn.disabled = true;
  setLoadingState(append ? 'Chargement suite…' : 'Chargement…', 'loading');

  try {
    const data = await apiFetch(buildTraceabilityUrl({ append }));

    const items = Array.isArray(data) ? data : [];
    state.lastBatchSize = items.length;

    if (!append) {
      state.offset = 0;
    }

    renderTraceList(items, { append });

    state.offset += items.length;
    els.loadMoreBtn.style.display = items.length === state.limit ? 'inline-flex' : 'none';
    setLoadingState('Prêt', 'idle');
  } catch (err) {
    console.error(err);
    if (!append) {
      els.list.innerHTML = `<div class="card trace-empty">${escapeHtml(err.message || 'Erreur chargement')}</div>`;
      els.count.textContent = '0';
    }
    setLoadingState('Erreur', 'error');
  } finally {
    state.loading = false;
    els.applyBtn.disabled = false;
    els.loadMoreBtn.disabled = false;
  }
}

function renderDetailMovements(movements) {
  if (!Array.isArray(movements) || movements.length === 0) {
    return `<div class="trace-empty-small">Aucun mouvement</div>`;
  }

  return movements
    .map((m) => {
      const qty = Number(m.quantity || 0);
      const sign = qty > 0 ? '+' : '';
      return `
        <div class="trace-detail-line">
          <div><strong>${escapeHtml(formatDate(m.created_at))}</strong></div>
          <div>${escapeHtml(m.movement_label || m.movement_type || 'Mouvement')}</div>
          <div>${sign}${escapeHtml(formatQty(qty))} kg</div>
          <div class="trace-detail-notes">${escapeHtml(m.notes || '')}</div>
        </div>
      `;
    })
    .join('');
}

function renderFifoConsumption(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return `<div class="trace-empty-small">Aucune sortie FIFO liée à ce lot</div>`;
  }

  return items
    .map((item) => {
      const doc = item.document || null;
      const docLabel = doc
        ? `${doc.document_type || 'document'} ${doc.reference_number || doc.sales_document_id || ''}`
        : 'Document inconnu';

      const docLink = doc?.sales_document_id
        ? `<a class="btn btn-secondary btn-sm" href="./sale-detail.html?id=${encodeURIComponent(doc.sales_document_id)}">Ouvrir vente</a>`
        : '';

      return `
        <div class="trace-detail-line">
          <div><strong>${escapeHtml(formatDate(item.created_at))}</strong></div>
          <div>${escapeHtml(docLabel)}</div>
          <div>- ${escapeHtml(formatQty(item.quantity_out))} kg</div>
          <div>${docLink}</div>
        </div>
      `;
    })
    .join('');
}

function renderSourceLots(sourceLots) {
  if (!Array.isArray(sourceLots) || sourceLots.length === 0) {
    return `
      <div class="card trace-detail-card">
        <h3>Composition / lots sources</h3>
        <div class="trace-empty-small">Aucun lot source lié à ce lot.</div>
      </div>
    `;
  }

  return `
    <div class="card trace-detail-card trace-source-section">
      <h3>Composition / lots sources</h3>

      <div class="trace-source-lots">
        ${sourceLots.map((src) => {
          const sourcePhotoUrls = getLotPhotoUrls(src);

          return `
            <div class="trace-source-card">
              <h4>${escapeHtml(src.plu || '—')} — ${escapeHtml(src.designation || 'Produit source')}</h4>

              <div><strong>Lot source :</strong> ${escapeHtml(src.lot_code || '—')}</div>
              <div><strong>Quantité utilisée :</strong> ${escapeHtml(formatQty(src.quantity_used || 0))} kg</div>
              <div><strong>DLC :</strong> ${escapeHtml(formatDate(src.dlc))}</div>
              <div><strong>Allergènes :</strong> ${
                Array.isArray(src.allergens)
                  ? escapeHtml(src.allergens.join(', '))
                  : escapeHtml(src.allergens || '—')
              }</div>
              <div><strong>Nom scientifique :</strong> ${escapeHtml(src.latin_name || '—')}</div>
              <div><strong>FAO :</strong> ${escapeHtml(src.fao_zone || '—')}</div>
              <div><strong>Sous-zone :</strong> ${escapeHtml(src.sous_zone || '—')}</div>
              <div><strong>Engin :</strong> ${escapeHtml(src.fishing_gear || '—')}</div>
              <div><strong>Origine :</strong> ${escapeHtml(src.origin_label || '—')}</div>

              ${renderPhotoGallery(sourcePhotoUrls)}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

async function openLotDetail(lotId) {
  els.lotModal.classList.remove('hidden');
  els.lotModalBody.innerHTML = `<div class="trace-empty">Chargement…</div>`;
  els.lotModalTitle.textContent = 'Détail lot';
  els.lotModalSubtitle.textContent = '';

  try {
    const data = await apiFetch(`/api/traceability/lots/${encodeURIComponent(lotId)}`);
    const lot = data.lot || {};
    const photoUrls = getLotPhotoUrls(lot);
    const trace = lot.traceability || {};
    const sourceLots = trace.source_lots || [];
    const sourceLotsHtml = renderSourceLots(sourceLots);

    els.lotModalTitle.textContent = `${lot.article_plu || '—'} — ${lot.article_label || 'Lot'}`;
    els.lotModalSubtitle.textContent = `Lot ${lot.lot_code || '—'}`;

    els.lotModalBody.innerHTML = `
      <div class="trace-detail-grid">
        <div class="card trace-detail-card">
          <h3>Informations lot</h3>
          <div><strong>Origine :</strong> ${escapeHtml(getSourceLabel(lot.source_type))}</div>
          <div><strong>Fournisseur :</strong> ${escapeHtml(lot.supplier_name || '—')}</div>
          <div><strong>Date achat :</strong> ${escapeHtml(formatDate(lot.purchase_date))}</div>
          <div><strong>BL :</strong> ${escapeHtml(lot.bl_number || '—')}</div>
          <div><strong>Réf fournisseur :</strong> ${escapeHtml(lot.supplier_reference || '—')}</div>
          <div><strong>Qté initiale :</strong> ${escapeHtml(formatQty(lot.qty_initial))} kg</div>
          <div><strong>Qté restante :</strong> ${escapeHtml(formatQty(lot.qty_remaining))} kg</div>
          <div><strong>DLC :</strong> ${escapeHtml(formatDate(lot.dlc))}</div>
          <div><strong>FAO :</strong> ${escapeHtml(trace.fao_zone || '—')}</div>
          <div><strong>Sous-zone :</strong> ${escapeHtml(trace.sous_zone || '—')}</div>
          <div><strong>Engin :</strong> ${escapeHtml(trace.fishing_gear || '—')}</div>
          <div><strong>Espèce :</strong> ${escapeHtml(trace.latin_name || '—')}</div>
          <div><strong>Origine :</strong> ${escapeHtml(trace.origin_label || '—')}</div>

          ${
            lot.purchase_id
              ? `<div class="trace-detail-actions"><a class="btn btn-primary" href="./purchase-detail.html?id=${encodeURIComponent(lot.purchase_id)}">Ouvrir achat source</a></div>`
              : ''
          }

          ${renderPhotoGallery(photoUrls)}
        </div>

        <div class="card trace-detail-card">
          <h3>Mouvements du lot</h3>
          ${renderDetailMovements(data.movements || [])}
        </div>

        <div class="card trace-detail-card">
          <h3>Consommation FIFO</h3>
          ${renderFifoConsumption(data.fifo_consumption || [])}
        </div>

        ${sourceLotsHtml}

      </div>
    `;
  } catch (err) {
    els.lotModalBody.innerHTML = `<div class="trace-empty">${escapeHtml(err.message || 'Erreur chargement détail lot')}</div>`;
  }
}

function closeLotDetail() {
  els.lotModal.classList.add('hidden');
}

function openImage(src) {
  els.imagePreview.src = src;
  els.imageModal.classList.remove('hidden');
}

function closeImage() {
  els.imagePreview.src = '';
  els.imageModal.classList.add('hidden');
}

function bindEvents() {
  els.backHomeBtn.addEventListener('click', () => {
    window.location.href = './home.html';
  });

  els.logoutBtn.addEventListener('click', logout);

  els.applyBtn.addEventListener('click', () => {
    state.offset = 0;
    loadTraceability({ append: false });
  });

  els.loadMoreBtn.addEventListener('click', () => {
    loadTraceability({ append: true });
  });

  els.list.addEventListener('click', (event) => {
    const detailBtn = event.target.closest('.btn-trace-detail');
    if (detailBtn) {
      const lotId = detailBtn.dataset.lotId;
      if (lotId) openLotDetail(lotId);
      return;
    }

    const card = event.target.closest('.trace-card');
    if (card && !event.target.closest('a') && !event.target.closest('button') && !event.target.closest('.trace-photo')) {
      const lotId = card.dataset.lotId;
      if (lotId) openLotDetail(lotId);
      return;
    }

    const photo = event.target.closest('.trace-photo');
    if (photo && photo.dataset.photo) {
      openImage(photo.dataset.photo);
    }
  });

  els.lotModalClose.addEventListener('click', closeLotDetail);
  els.lotModal.addEventListener('click', (event) => {
    if (event.target.dataset.closeModal === 'true') {
      closeLotDetail();
    }

    const photo = event.target.closest('.trace-photo');
    if (photo && photo.dataset.photo) {
      openImage(photo.dataset.photo);
    }
  });

  els.imageClose.addEventListener('click', closeImage);
  els.imageModal.addEventListener('click', (event) => {
    if (event.target.dataset.closeImage === 'true') {
      closeImage();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeLotDetail();
      closeImage();
    }
  });
}

async function initPage() {
  state.sessionUser = getStoredJson('grv2_user');
  state.activeDepartment = getStoredJson('grv2_active_department');

  if (!state.sessionUser || !state.activeDepartment) {
    logout();
    return;
  }

  els.userName.textContent = state.sessionUser.email || 'Utilisateur';

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  els.to.value = `${yyyy}-${mm}-${dd}`;

  bindEvents();
  await loadTraceability({ append: false });
}

initPage().catch((err) => {
  console.error('Erreur init traceability:', err);
  setLoadingState('Erreur', 'error');
});