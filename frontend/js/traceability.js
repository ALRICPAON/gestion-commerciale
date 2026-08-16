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
  startTraceabilityTest: document.getElementById('start-traceability-test-btn'),
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
  currentLotId: null,
  recallAnalysis: null,
  recallCampaign: null,
  recallPreviewRecipientId: null,
  pendingRecallPayload: null,
  sendingRecall: false,
  traceabilityTest: null,
};

const RECALL_TYPES = [
  ['supplier_recall', 'Rappel fournisseur'],
  ['health_alert', 'Alerte sanitaire'],
  ['quality_suspicion', 'Suspicion qualite'],
  ['authority_request', 'Demande autorite'],
  ['traceability_issue', 'Probleme tracabilite'],
  ['other', 'Autre'],
];

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

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('fr-FR');
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

async function apiFetch(path, options = {}) {
  const headers = { Authorization: `Bearer ${authToken}`, ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    logoutAndRedirect();
    return null;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Erreur API');
    error.code = data.code || null;
    error.details = data.details || null;
    throw error;
  }
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

function qualityStatusBadge(quality = {}) {
  if (quality.status === 'blocked') return '<span class="trace-badge trace-badge-closed">Qualite bloque</span>';
  return '<span class="trace-badge trace-badge-open">Qualite disponible</span>';
}

function lotIdentifier(lot) {
  return lot?.lot_id || lot?.id || lot?.uuid || '';
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
  const lotId = lotIdentifier(lot);
  return `<article class="trace-card" data-lot-id="${escapeHtml(lotId)}">
    <div class="trace-card-header">
      <div><h3>${escapeHtml(lot.article_plu || '-')} - ${escapeHtml(lot.article_label || '-')}</h3><p>Lot ${escapeHtml(lot.lot_code || '-')} · ${escapeHtml(sourceLabel(lot.source_type))}</p></div>
      <div>${statusBadge(lot.status)} ${qualityStatusBadge(lot.quality)}</div>
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
    <div class="trace-card-actions"><button type="button" class="btn btn-primary btn-detail" data-lot-id="${escapeHtml(lotId)}">Détail lot</button>${lot.purchase_id ? `<a class="btn btn-secondary" href="./purchase-detail.html?id=${encodeURIComponent(lot.purchase_id)}">Achat source</a>` : ''}</div>
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
      <dt>Statut qualite</dt><dd>${qualityStatusBadge(lot.quality)}</dd>
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

function qualityReasonTypeLabel(value) {
  const labels = {
    supplier_recall: 'Rappel fournisseur',
    health_alert: 'Alerte sanitaire',
    quality_suspicion: 'Suspicion qualite',
    traceability_issue: 'Probleme tracabilite',
    authority_request: 'Demande autorite',
    other: 'Autre',
    lot_isolation: 'Isolement du lot',
    release: 'Liberation',
  };
  return labels[value] || value || '-';
}

function recallTypeLabel(value) {
  return RECALL_TYPES.find(([key]) => key === value)?.[1] || value || '-';
}

function contactSourceLabel(value) {
  const labels = {
    delivery_note_contact: 'Contact BL',
    primary_contact: 'Contact principal',
    client_email: 'Email client',
  };
  return labels[value] || value || '-';
}

function recallStatusLabel(value) {
  const labels = {
    draft: 'Brouillon',
    ready: 'Pret',
    sending: 'En preparation',
    sent: 'Envoye',
    partial: 'Partiel',
    closed: 'Cloture',
    cancelled: 'Annule',
  };
  return labels[value] || value || '-';
}

function recallRecipientStatusLabel(value) {
  const labels = {
    pending: 'Envoi en cours / a verifier',
    ready: 'Pret',
    contact_required: 'Contact a effectuer',
    sent: 'Envoye',
    failed: 'Echec',
    skipped: 'Ignore',
  };
  return labels[value] || value || '-';
}

function recallRecipientBadgeClass(value) {
  if (value === 'sent') return 'trace-badge-open';
  if (value === 'failed' || value === 'contact_required') return 'trace-badge-partial';
  if (value === 'pending') return 'trace-badge-closed';
  return 'trace-badge-open';
}

function renderQualityHistory(history = []) {
  if (!history.length) return '<div class="trace-empty-small">Aucun historique de statut qualite.</div>';
  return `<div class="trace-movement-list">${history.map((item) => `<div class="trace-movement-line"><span>${escapeHtml(formatDate(item.changed_at))}</span><strong>${escapeHtml(item.previous_status || '-')} -> ${escapeHtml(item.new_status || '-')}</strong><span>${escapeHtml(qualityReasonTypeLabel(item.reason_type))}</span><span>${escapeHtml(item.reason || '')}</span></div>`).join('')}</div>`;
}

function renderQualityBlock(lot, history = []) {
  const quality = lot.quality || {};
  const isBlocked = quality.status === 'blocked';
  return `<section class="trace-detail-card" data-quality-lot-id="${escapeHtml(lotIdentifier(lot))}">
    <h3>Blocage qualite</h3>
    <dl class="trace-definition-list">
      <dt>Statut</dt><dd>${qualityStatusBadge(quality)}</dd>
      <dt>Motif</dt><dd>${escapeHtml(qualityReasonTypeLabel(quality.block_reason_type))}</dd>
      <dt>Detail</dt><dd>${escapeHtml(quality.block_reason || '-')}</dd>
      <dt>NC liee</dt><dd>${quality.non_conformity_id ? escapeHtml(quality.non_conformity_title || quality.non_conformity_id) : '-'}</dd>
      <dt>Dernier blocage</dt><dd>${escapeHtml(formatDate(quality.blocked_at))}</dd>
      <dt>Derniere liberation</dt><dd>${escapeHtml(formatDate(quality.released_at))}</dd>
    </dl>
    ${isBlocked ? `
      <div class="form-group"><label for="quality-release-reason">Motif liberation</label><input id="quality-release-reason" type="text" /></div>
      <div class="form-group"><label for="quality-release-comment">Commentaire liberation</label><textarea id="quality-release-comment" rows="3"></textarea></div>
      <button type="button" class="btn btn-primary" data-action="release-quality" data-lot-id="${escapeHtml(lotIdentifier(lot))}">Liberer le lot</button>
    ` : `
      <div class="form-group"><label for="quality-block-reason-type">Type blocage</label><select id="quality-block-reason-type">
        <option value="quality_suspicion">Suspicion qualite</option>
        <option value="supplier_recall">Rappel fournisseur</option>
        <option value="health_alert">Alerte sanitaire</option>
        <option value="traceability_issue">Probleme tracabilite</option>
        <option value="authority_request">Demande autorite</option>
        <option value="other">Autre</option>
      </select></div>
      <div class="form-group"><label for="quality-block-reason">Motif blocage</label><input id="quality-block-reason" type="text" /></div>
      <div class="form-group"><label for="quality-block-comment">Commentaire</label><textarea id="quality-block-comment" rows="3"></textarea></div>
      <button type="button" class="btn btn-primary" data-action="block-quality" data-lot-id="${escapeHtml(lotIdentifier(lot))}">Bloquer le lot</button>
    `}
    <h4>Historique</h4>
    ${renderQualityHistory(history)}
  </section>`;
}

function recallSummaryValues(source = {}) {
  const recipients = Array.isArray(source.recipients) ? source.recipients : [];
  const deliveryNotesCount = Number(source.delivery_notes_count ?? recipients.reduce((sum, recipient) => sum + Number(recipient.delivery_note_count || 0), 0));
  const deliveredQuantity = Number(source.total_delivered_quantity ?? recipients.reduce((sum, recipient) => sum + Number(recipient.delivered_quantity || 0), 0));
  return {
    clientsCount: Number(source.clients_count ?? recipients.length),
    deliveryNotesCount,
    deliveredQuantity,
  };
}

function renderRecallSummary(analysis) {
  const lot = analysis.lot || {};
  const article = analysis.article || {};
  const totals = recallSummaryValues(analysis);
  return `<div class="trace-recall-summary">
    <div><span>Article</span><strong>${escapeHtml(article.designation || '-')}</strong></div>
    <div><span>PLU</span><strong>${escapeHtml(article.plu || '-')}</strong></div>
    <div><span>Lot ALTA</span><strong>${escapeHtml(lot.lot_code || '-')}</strong></div>
    <div><span>Lot fournisseur</span><strong>${escapeHtml(lot.supplier_lot_number || '-')}</strong></div>
    <div><span>Stock restant</span><strong>${escapeHtml(qty(analysis.stock_remaining ?? lot.stock_remaining))}</strong></div>
    <div><span>Clients concernes</span><strong>${escapeHtml(totals.clientsCount)}</strong></div>
    <div><span>BL concernes</span><strong>${escapeHtml(totals.deliveryNotesCount)}</strong></div>
    <div><span>Quantite livree</span><strong>${escapeHtml(qty(totals.deliveredQuantity))}</strong></div>
  </div>`;
}

function deliveryNoteItems(recipient) {
  const notes = Array.isArray(recipient.delivery_notes) ? recipient.delivery_notes : [];
  if (!notes.length) return '<div class="trace-empty-small">Aucun BL detaille.</div>';
  return `<ul class="trace-recall-notes">${notes.map((note) => `<li><span>${escapeHtml(note.reference || note.delivery_note_reference || note.delivery_note_id || '-')}</span><span>${escapeHtml(formatDate(note.date || note.delivery_note_date))}</span><strong>${escapeHtml(qty(note.delivered_quantity))}</strong></li>`).join('')}</ul>`;
}

function renderRecallRecipients(recipients = [], { selectable = false } = {}) {
  if (!recipients.length) return '<div class="trace-empty-small">Aucun client livre concerne. La campagne peut quand meme bloquer le stock restant.</div>';
  return `<div class="trace-recall-recipient-list">${recipients.map((recipient, index) => {
    const canSelect = ['ready', 'failed'].includes(recipient.status) && recipient.email;
    const checked = canSelect ? 'checked' : '';
    const disabled = selectable && !canSelect ? 'disabled' : '';
    const recipientId = recipient.id || recipient.delivered_client_id || `recipient-${index}`;
    return `<article class="trace-recall-recipient" data-recipient-id="${escapeHtml(recipientId)}">
      <div class="trace-recall-recipient-head">
        <label class="trace-recall-check">
          ${selectable ? `<input type="checkbox" class="recall-recipient-checkbox" value="${escapeHtml(recipientId)}" ${checked} ${disabled} />` : ''}
          <span><strong>${escapeHtml(recipient.delivered_client_name || '-')}</strong><small>${escapeHtml(recipient.delivered_client_store_identifier || recipient.delivered_client_code || '')}</small></span>
        </label>
        <div><span class="trace-badge ${recallRecipientBadgeClass(recipient.status)}">${escapeHtml(recallRecipientStatusLabel(recipient.status))}</span></div>
      </div>
      <dl class="trace-recall-recipient-meta">
        <dt>Email</dt><dd>${recipient.email ? escapeHtml(recipient.email) : '<span class="muted">Aucun email disponible</span>'}</dd>
        <dt>Contact</dt><dd>${escapeHtml(recipient.contact_name || '-')} <span class="muted">${escapeHtml(contactSourceLabel(recipient.contact_source))}</span></dd>
        <dt>Total livre</dt><dd>${escapeHtml(qty(recipient.delivered_quantity))}</dd>
        <dt>BL</dt><dd>${escapeHtml(recipient.delivery_note_count || 0)}</dd>
        ${recipient.sent_at ? `<dt>Envoi</dt><dd>${escapeHtml(formatDateTime(recipient.sent_at))}</dd>` : ''}
        ${recipient.email_message_id ? `<dt>Message</dt><dd>${escapeHtml(recipient.email_message_id)}</dd>` : ''}
        ${recipient.error_message ? `<dt>Erreur</dt><dd>${escapeHtml(recipient.error_message)}</dd>` : ''}
      </dl>
      ${deliveryNoteItems(recipient)}
      <button type="button" class="btn btn-secondary btn-sm" data-action="preview-recall-recipient" data-recipient-id="${escapeHtml(recipientId)}">Apercu message</button>
    </article>`;
  }).join('')}</div>`;
}

function recallEmailSubject(source) {
  const article = source.article || {};
  const lot = source.lot || {};
  return `Rappel produit - ${article.designation || article.plu || 'Produit'} - Lot ${lot.lot_code || '-'}`;
}

function recallPreviewTextValue(value) {
  return String(value || '').trim();
}

function recallGreeting(recipient) {
  const name = recallPreviewTextValue(recipient?.contact_name || recipient?.delivered_client_name);
  return name ? `Bonjour ${name},` : 'Bonjour,';
}

function recallEmailBody(source, recipient, { reason = '', comment = '' } = {}) {
  const article = source.article || {};
  const lot = source.lot || {};
  const notes = Array.isArray(recipient?.delivery_notes) ? recipient.delivery_notes : [];
  const noteLines = notes.length
    ? notes.map((note) => `- ${note.reference || note.delivery_note_reference || note.delivery_note_id || '-'} - ${formatDate(note.date || note.delivery_note_date)} - ${qty(note.delivered_quantity)}`).join('\n')
    : '- Aucun BL detaille';
  const supplierLot = lot.supplier_lot_number ? `Lot fournisseur : ${lot.supplier_lot_number}\n` : '';
  const cleanReason = recallPreviewTextValue(reason) || '-';
  const cleanComment = recallPreviewTextValue(comment);
  const commentBlock = cleanComment ? `\nInformations complementaires :\n${cleanComment}\n` : '';
  return `${recallGreeting(recipient)}

Dans le cadre de notre procedure de retrait/rappel produit, nous vous informons qu'un rappel concerne le produit suivant :

Produit : ${article.designation || '-'}
Lot : ${lot.lot_code || '-'}
${supplierLot}
Livraisons concernees :
${noteLines}

Quantite totale livree : ${qty(recipient?.delivered_quantity)}

Motif :
${cleanReason}
${commentBlock}

Merci d'isoler immediatement le produit restant et de ne plus le commercialiser.

Merci de nous confirmer la quantite encore presente dans votre etablissement.

Cordialement,

ALTA MAREE`;
}

function selectedRecallRecipient(source) {
  const recipients = Array.isArray(source.recipients) ? source.recipients : [];
  return recipients.find((recipient) => (recipient.id || recipient.delivered_client_id) === state.recallPreviewRecipientId)
    || recipients.find((recipient) => recipient.status === 'ready' && recipient.email)
    || recipients[0]
    || null;
}

function renderRecallEmailPreview(source, preview = {}) {
  const recipient = selectedRecallRecipient(source);
  if (!recipient) return '<div class="trace-empty-small">Aucun destinataire pour generer un apercu.</div>';
  const contactName = recipient.contact_name || recipient.delivered_client_name || '-';
  const contactLine = recipient.email ? `${contactName} - ${recipient.email}` : contactName;
  return `<div class="trace-recall-preview">
    <div><span>Destinataire</span><strong>${escapeHtml(contactLine)}</strong></div>
    <div><span>Client</span><strong>${escapeHtml(recipient.delivered_client_name || '-')}</strong></div>
    <div><span>Objet</span><strong>${escapeHtml(recallEmailSubject(source))}</strong></div>
    <label>Apercu du message</label>
    <textarea readonly rows="13">${escapeHtml(recallEmailBody(source, recipient, preview))}</textarea>
    <p class="trace-warning">Apercu uniquement. Aucun email ne sera envoye a cette etape.</p>
  </div>`;
}

function renderRecallBlock(lot) {
  return `<section class="trace-detail-card">
    <h3>Retrait / Rappel produit</h3>
    <p class="trace-card-note">Analyse aval, preparation des destinataires et creation d'une campagne brouillon sans envoi email.</p>
    <button type="button" class="btn btn-secondary" data-action="start-recall" data-lot-id="${escapeHtml(lotIdentifier(lot))}">Retrait / Rappel produit</button>
  </section>`;
}

function pluralLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
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
  state.currentLotId = lotId;
  els.lotModal.classList.remove('hidden');
  els.lotModalBody.innerHTML = '<div class="trace-empty">Chargement...</div>';

  try {
    const data = await apiFetch(`/api/traceability/lots/${encodeURIComponent(lotId)}`);
    const lot = data.lot || {};
    els.lotModalTitle.textContent = `${lot.article_plu || '-'} - ${lot.article_label || 'Lot'}`;
    els.lotModalSubtitle.textContent = `Lot ${lot.lot_code || '-'}`;
    els.lotModalBody.innerHTML = `<div class="trace-detail-grid">${renderInfoBlock(lot)}${renderRecallBlock(lot)}${renderQualityBlock(lot, data.quality_history || [])}${renderDeliveredClients(lot.delivered_clients)}${renderMovements(data.movements || [])}</div>`;
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

async function blockQualityLot(lotId) {
  const reasonType = document.getElementById('quality-block-reason-type')?.value || 'quality_suspicion';
  const reason = document.getElementById('quality-block-reason')?.value.trim();
  const comment = document.getElementById('quality-block-comment')?.value.trim();
  await apiFetch(`/api/traceability/lots/${encodeURIComponent(lotId)}/block-quality`, {
    method: 'POST',
    body: JSON.stringify({ reason_type: reasonType, reason, comment }),
  });
  await openLotDetail(lotId);
  await loadLots({ append: false });
}

async function releaseQualityLot(lotId) {
  const reason = document.getElementById('quality-release-reason')?.value.trim();
  const comment = document.getElementById('quality-release-comment')?.value.trim();
  await apiFetch(`/api/traceability/lots/${encodeURIComponent(lotId)}/release-quality`, {
    method: 'POST',
    body: JSON.stringify({ reason, comment }),
  });
  await openLotDetail(lotId);
  await loadLots({ append: false });
}

function renderRecallAnalysisPanel(analysis) {
  const recipients = Array.isArray(analysis.recipients) ? analysis.recipients : [];
  const readyCount = recipients.filter((recipient) => recipient.status === 'ready' && recipient.email).length;
  const contactRequiredCount = recipients.filter((recipient) => recipient.status === 'contact_required' || !recipient.email).length;
  const lotId = state.currentLotId || analysis.lot?.lot_id || '';
  const emailLabel = pluralLabel(readyCount, 'email pret a etre envoye', 'emails prets a etre envoyes');
  const contactLabel = pluralLabel(contactRequiredCount, 'contact a effectuer', 'contacts a effectuer');
  return `<section class="trace-detail-card trace-recall-panel">
    <div class="trace-section-header">
      <div><h3>Retrait / Rappel produit</h3><p>Analyse aval avant creation de campagne.</p></div>
      <button type="button" class="btn btn-secondary" data-action="back-lot-detail" data-lot-id="${escapeHtml(lotId)}">Retour detail lot</button>
    </div>
    ${renderRecallSummary(analysis)}
    <div class="trace-recall-alert"><strong>${escapeHtml(emailLabel)} &middot; ${escapeHtml(contactLabel)}</strong><span>Aucun envoi n'est effectue a cette etape.</span></div>
    <h4>Clients impactes</h4>
    ${renderRecallRecipients(recipients)}
    <h4>Creation campagne</h4>
    <div class="trace-recall-form">
      <div class="form-group"><label for="recall-type">Type de rappel</label><select id="recall-type">${RECALL_TYPES.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('')}</select></div>
      <div class="form-group"><label for="recall-reason">Motif</label><input id="recall-reason" type="text" placeholder="Motif du rappel" /></div>
      <div class="form-group"><label for="recall-comment">Commentaire</label><textarea id="recall-comment" rows="3" placeholder="Obligatoire si type Autre"></textarea></div>
    </div>
    <h4>Apercu du futur email</h4>
    <div id="recall-email-preview">${renderRecallEmailPreview(analysis, { reason: '', comment: '' })}</div>
    <div class="trace-actions-row">
      <button type="button" class="btn btn-secondary" data-action="back-lot-detail" data-lot-id="${escapeHtml(lotId)}">Annuler</button>
      <button type="button" class="btn btn-primary" data-action="prepare-recall-confirm" data-lot-id="${escapeHtml(lotId)}">Creer le rappel et bloquer le lot</button>
    </div>
  </section>`;
}

function recallFormPayload() {
  const recallType = document.getElementById('recall-type')?.value || 'supplier_recall';
  const reason = document.getElementById('recall-reason')?.value.trim() || '';
  const comment = document.getElementById('recall-comment')?.value.trim() || '';
  if (!reason) throw new Error('Motif de rappel obligatoire.');
  if (recallType === 'other' && !comment) throw new Error('Commentaire obligatoire pour le type Autre.');
  return { recall_type: recallType, reason, comment };
}

function renderRecallConfirmPanel(lotId, payload) {
  const analysis = state.recallAnalysis || {};
  const lot = analysis.lot || {};
  const totals = recallSummaryValues(analysis);
  state.pendingRecallPayload = payload;
  els.lotModalTitle.textContent = 'Creer ce rappel produit ?';
  els.lotModalSubtitle.textContent = `Lot ${lot.lot_code || '-'}`;
  els.lotModalBody.innerHTML = `<section class="trace-detail-card trace-recall-panel">
    <h3>Creer ce rappel produit ?</h3>
    <dl class="trace-definition-list">
      <dt>Lot</dt><dd>${escapeHtml(lot.lot_code || '-')}</dd>
      <dt>Type</dt><dd>${escapeHtml(recallTypeLabel(payload.recall_type))}</dd>
      <dt>Motif</dt><dd>${escapeHtml(payload.reason)}</dd>
      <dt>Clients concernes</dt><dd>${escapeHtml(totals.clientsCount)}</dd>
      <dt>BL concernes</dt><dd>${escapeHtml(totals.deliveryNotesCount)}</dd>
      <dt>Quantite livree</dt><dd>${escapeHtml(qty(totals.deliveredQuantity))}</dd>
      <dt>Stock restant</dt><dd>${escapeHtml(qty(analysis.stock_remaining ?? lot.stock_remaining))}</dd>
    </dl>
    <p class="trace-warning">Le lot sera bloque immediatement. Aucun email ne sera envoye a cette etape.</p>
    <div class="trace-actions-row">
      <button type="button" class="btn btn-secondary" data-action="render-recall-analysis">Annuler</button>
      <button type="button" class="btn btn-primary" data-action="confirm-create-recall" data-lot-id="${escapeHtml(lotId)}">Creer le rappel</button>
    </div>
  </section>`;
}

function currentRecallPreviewPayload() {
  return {
    recall_type: document.getElementById('recall-type')?.value || 'supplier_recall',
    reason: document.getElementById('recall-reason')?.value.trim() || '',
    comment: document.getElementById('recall-comment')?.value.trim() || '',
  };
}

function updateRecallEmailPreview() {
  const container = document.getElementById('recall-email-preview');
  if (!container || !state.recallAnalysis) return;
  const payload = currentRecallPreviewPayload();
  container.innerHTML = renderRecallEmailPreview(state.recallAnalysis, {
    reason: payload.reason,
    comment: payload.comment,
  });
}

function renderActiveRecallError(error) {
  const campaignId = error?.details?.campaign_id;
  els.lotModalTitle.textContent = 'Rappel produit actif';
  els.lotModalSubtitle.textContent = '';
  els.lotModalBody.innerHTML = `<section class="trace-detail-card trace-recall-panel">
    <h3>Un rappel produit est deja actif pour ce lot.</h3>
    <p class="trace-warning">Aucune nouvelle campagne active ne peut etre creee tant que la campagne existante n'est pas cloturee ou annulee.</p>
    <div class="trace-actions-row">
      ${campaignId ? `<button type="button" class="btn btn-primary" data-action="open-recall-campaign" data-campaign-id="${escapeHtml(campaignId)}">Voir le rappel existant</button>` : ''}
      <button type="button" class="btn btn-secondary" data-action="back-lot-detail" data-lot-id="${escapeHtml(state.currentLotId || '')}">Retour detail lot</button>
    </div>
  </section>`;
}

function normalizeCampaignSource(data) {
  const campaign = data.campaign || {};
  const recipients = Array.isArray(data.recipients) ? data.recipients : [];
  return {
    campaign,
    lot: data.lot || {},
    article: data.article || {},
    recipients,
    clients_count: recipients.length,
    delivery_notes_count: recipients.reduce((sum, recipient) => sum + Number(recipient.delivery_note_count || 0), 0),
    total_delivered_quantity: recipients.reduce((sum, recipient) => sum + Number(recipient.delivered_quantity || 0), 0),
    stock_remaining: data.lot?.stock_remaining,
  };
}

function renderRecallCampaignPanel(data) {
  const source = normalizeCampaignSource(data);
  const campaign = source.campaign || {};
  state.recallCampaign = source;
  els.lotModalTitle.textContent = 'Rappel produit cree';
  els.lotModalSubtitle.textContent = `Campagne ${campaign.id || '-'}`;
  els.lotModalBody.innerHTML = `<section class="trace-detail-card trace-recall-panel">
    <div class="trace-section-header">
      <div><h3>Rappel produit cree</h3><p>${escapeHtml(recallStatusLabel(campaign.status))}</p></div>
      <span class="trace-badge trace-badge-closed">Lot bloque</span>
    </div>
    <dl class="trace-definition-list">
      <dt>Campagne</dt><dd>${escapeHtml(campaign.id || '-')}</dd>
      <dt>Date</dt><dd>${escapeHtml(formatDateTime(campaign.initiated_at || campaign.prepared_at))}</dd>
      <dt>Type</dt><dd>${escapeHtml(recallTypeLabel(campaign.recall_type))}</dd>
      <dt>Motif</dt><dd>${escapeHtml(campaign.reason || '-')}</dd>
      <dt>Initiateur</dt><dd>${escapeHtml(campaign.initiated_by_email || campaign.initiated_by || '-')}</dd>
    </dl>
    ${renderRecallSummary(source)}
    <h4>Destinataires prepares</h4>
    ${renderRecallRecipients(source.recipients, { selectable: true })}
    <div class="trace-actions-row">
      <button type="button" class="btn btn-primary" data-action="prepare-send-recall" data-campaign-id="${escapeHtml(campaign.id || '')}">Envoyer les rappels selectionnes</button>
      <span class="muted" id="recall-send-selection-count"></span>
    </div>
    <h4>Apercu du futur email</h4>
    <div id="recall-email-preview">${renderRecallEmailPreview(source, { reason: campaign.reason || '', comment: campaign.comment || '' })}</div>
    <div class="trace-actions-row">
      <button type="button" class="btn btn-secondary" data-action="back-lot-detail" data-lot-id="${escapeHtml(source.lot.lot_id || state.currentLotId || '')}">Retour detail lot</button>
    </div>
  </section>`;
  updateRecallSendButtonState();
}

function selectedSendableRecallRecipientIds() {
  return Array.from(document.querySelectorAll('.recall-recipient-checkbox:checked:not(:disabled)'))
    .map((input) => input.value)
    .filter(Boolean);
}

function updateRecallSendButtonState() {
  const button = document.querySelector('[data-action="prepare-send-recall"]');
  if (!button) return;
  const selectedIds = selectedSendableRecallRecipientIds();
  const label = document.getElementById('recall-send-selection-count');
  button.disabled = state.sendingRecall || selectedIds.length === 0;
  if (label) {
    const emailLabel = pluralLabel(selectedIds.length, 'email selectionne', 'emails selectionnes');
    label.textContent = selectedIds.length ? emailLabel : 'Aucun destinataire envoyable selectionne';
  }
}

function renderRecallSendConfirmPanel(campaignId, recipientIds) {
  const source = state.recallCampaign || {};
  const campaign = source.campaign || {};
  const lot = source.lot || {};
  const article = source.article || {};
  const selected = (source.recipients || []).filter((recipient) => recipientIds.includes(String(recipient.id || recipient.delivered_client_id)));
  const countLabel = pluralLabel(selected.length, 'email de rappel', 'emails de rappel');
  els.lotModalTitle.textContent = `Envoyer ${countLabel} ?`;
  els.lotModalSubtitle.textContent = `Campagne ${campaign.id || '-'}`;
  els.lotModalBody.innerHTML = `<section class="trace-detail-card trace-recall-panel">
    <h3>Envoyer ${escapeHtml(countLabel)} ?</h3>
    <dl class="trace-definition-list">
      <dt>Campagne</dt><dd>${escapeHtml(campaign.id || '-')}</dd>
      <dt>Lot</dt><dd>${escapeHtml(lot.lot_code || '-')}</dd>
      <dt>Article</dt><dd>${escapeHtml(article.designation || article.plu || '-')}</dd>
      <dt>Destinataires</dt><dd>${escapeHtml(selected.length)}</dd>
    </dl>
    <div class="trace-recall-recipient-list">${selected.map((recipient) => `<article class="trace-recall-recipient"><strong>${escapeHtml(recipient.delivered_client_name || '-')}</strong><div class="muted">${escapeHtml(recipient.contact_name || '')}${recipient.email ? ` - ${escapeHtml(recipient.email)}` : ''}</div></article>`).join('')}</div>
    <p class="trace-warning">Les emails seront envoyes immediatement via ALTA MAREE.</p>
    <div class="trace-actions-row">
      <button type="button" class="btn btn-secondary" data-action="open-recall-campaign" data-campaign-id="${escapeHtml(campaignId)}">Annuler</button>
      <button type="button" class="btn btn-primary" data-action="confirm-send-recall" data-campaign-id="${escapeHtml(campaignId)}" data-recipient-ids="${escapeHtml(recipientIds.join(','))}">Envoyer maintenant</button>
    </div>
  </section>`;
}

function renderRecallSendResultPanel(result) {
  const campaign = result.campaign || {};
  const recipients = Array.isArray(result.recipients) ? result.recipients : [];
  state.recallCampaign = normalizeCampaignSource(result);
  els.lotModalTitle.textContent = 'Envoi des rappels';
  els.lotModalSubtitle.textContent = `Campagne ${campaign.id || '-'}`;
  els.lotModalBody.innerHTML = `<section class="trace-detail-card trace-recall-panel">
    <div class="trace-section-header">
      <div><h3>Resultat d'envoi</h3><p>${escapeHtml(recallStatusLabel(campaign.status))}</p></div>
      <span class="trace-badge ${campaign.status === 'sent' ? 'trace-badge-open' : 'trace-badge-partial'}">${escapeHtml(recallStatusLabel(campaign.status))}</span>
    </div>
    <div class="trace-recall-alert">
      <strong>${escapeHtml(pluralLabel(result.summary?.sent || 0, 'email envoye', 'emails envoyes'))} &middot; ${escapeHtml(pluralLabel(result.summary?.failed || 0, 'echec', 'echecs'))} &middot; ${escapeHtml(pluralLabel(result.summary?.pending || 0, 'envoi a verifier', 'envois a verifier'))} &middot; ${escapeHtml(pluralLabel(result.summary?.contact_required || 0, 'contact manuel a effectuer', 'contacts manuels a effectuer'))}</strong>
      <span>Les statuts ont ete enregistres par destinataire.</span>
    </div>
    <h4>Destinataires</h4>
    ${renderRecallRecipients(recipients, { selectable: true })}
    <div class="trace-actions-row">
      <button type="button" class="btn btn-primary" data-action="prepare-send-recall" data-campaign-id="${escapeHtml(campaign.id || '')}">Envoyer les rappels selectionnes</button>
      <span class="muted" id="recall-send-selection-count"></span>
    </div>
    <div class="trace-actions-row">
      <button type="button" class="btn btn-secondary" data-action="back-lot-detail" data-lot-id="${escapeHtml(result.lot?.lot_id || state.currentLotId || '')}">Retour detail lot</button>
    </div>
  </section>`;
  updateRecallSendButtonState();
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return minutes ? `${minutes} min ${remaining} s` : `${remaining} s`;
}

function traceabilityResultLabel(value) {
  if (value === 'conform') return 'Conforme';
  if (value === 'non_conform') return 'Non conforme';
  return '-';
}

function renderTraceabilityTestSearchPanel() {
  els.lotModal.classList.remove('hidden');
  els.lotModalTitle.textContent = 'Test de tracabilite';
  els.lotModalSubtitle.textContent = 'Selection du lot';
  els.lotModalBody.innerHTML = `<section class="trace-detail-card trace-recall-panel">
    <div class="trace-section-header">
      <div><h3>Test de tracabilite</h3><p>Choisir un lot existant pour reconstruire la tracabilite ALTA.</p></div>
    </div>
    <div class="trace-recall-form">
      <div class="form-group"><label for="traceability-test-search">Recherche lot</label><input id="traceability-test-search" type="search" placeholder="Lot ALTA, lot fournisseur, PLU, article" /><small class="muted">F9 : afficher les lots</small></div>
      <div class="form-group trace-filter-actions"><label>&nbsp;</label><button type="button" class="btn btn-primary" data-action="search-traceability-test-lots">Rechercher</button></div>
    </div>
    <div id="traceability-test-results" class="trace-recall-recipient-list" style="max-height:52vh;overflow:auto;"></div>
  </section>`;
  document.getElementById('traceability-test-search')?.focus();
}

function renderTraceabilityTestLotResults(lots = []) {
  const container = document.getElementById('traceability-test-results');
  if (!container) return;
  if (!lots.length) {
    container.innerHTML = '<div class="trace-empty-small">Aucun lot trouve.</div>';
    return;
  }
  container.innerHTML = lots.map((lot) => `<article class="trace-recall-recipient">
    <div class="trace-recall-recipient-head">
      <div><strong>${escapeHtml([lot.article_plu, lot.article_label].filter(Boolean).join(' - ') || '-')}</strong><small>Lot ALTA : ${escapeHtml(lot.lot_code || '-')}</small></div>
      <button type="button" class="btn btn-primary btn-sm" data-action="select-traceability-test-lot" data-lot-id="${escapeHtml(lotIdentifier(lot))}">Selectionner</button>
    </div>
    <dl class="trace-recall-recipient-meta">
      <dt>Lot fourn.</dt><dd>${escapeHtml(lot.supplier_lot_number || '-')}</dd>
      <dt>Fournisseur</dt><dd>${escapeHtml(lot.supplier_name || '-')}</dd>
      <dt>Reception</dt><dd>${escapeHtml(formatDate(lot.receipt_date))}</dd>
      <dt>Restant</dt><dd>${escapeHtml(qty(lot.qty_remaining))}</dd>
    </dl>
  </article>`).join('');
}

async function searchTraceabilityTestLots({ consultation = false } = {}) {
  const search = document.getElementById('traceability-test-search')?.value.trim() || '';
  const params = new URLSearchParams({ limit: consultation && !search ? '50' : '20', offset: '0' });
  if (search) params.set('search', search);
  const lots = await apiFetch(`/api/traceability/traceability-tests/lots?${params.toString()}`);
  renderTraceabilityTestLotResults(Array.isArray(lots) ? lots : []);
}

function renderTraceabilityDownstream(rows = []) {
  if (!rows.length) return '<div class="trace-empty-small">Aucun BL client pour ce lot.</div>';
  return `<div class="trace-client-preview">${rows.map((item) => deliveredClientLine({
    ...item,
    sale_detail_url: item.delivery_note_id ? `./sale-detail.html?id=${item.delivery_note_id}` : null,
  })).join('')}</div>`;
}

function renderTraceabilityTransformations(rows = []) {
  if (!rows.length) return '<div class="trace-empty-small">Aucune transformation rattachee a ce lot.</div>';
  return `<div class="trace-movement-list">${rows.map((row) => `<div class="trace-movement-line"><span>${escapeHtml(formatDateTime(row.created_at))}</span><strong>${escapeHtml(movementLabel(row.movement_type))}</strong><span>${escapeHtml(qty(row.quantity))}</span><span>${escapeHtml(row.notes || row.source_table || '-')}</span></div>`).join('')}</div>`;
}

function renderTraceabilityTestPanel(data) {
  const lot = data.lot || {};
  const article = data.article || {};
  const upstream = data.upstream || {};
  const summary = data.summary || {};
  state.traceabilityTest = { ...data, started_at: data.started_at || new Date().toISOString() };
  els.lotModalTitle.textContent = 'Test de tracabilite';
  els.lotModalSubtitle.textContent = `Lot ${lot.lot_code || '-'}`;
  els.lotModalBody.innerHTML = `<section class="trace-detail-card trace-recall-panel">
    <div class="trace-section-header">
      <div><h3>Test de tracabilite</h3><p>Verifier la reconstruction avant validation humaine.</p></div>
      <button type="button" class="btn btn-secondary" data-action="open-traceability-test">Changer de lot</button>
    </div>
    <div class="trace-recall-summary">
      <div><span>Produit</span><strong>${escapeHtml(article.designation || article.plu || '-')}</strong></div>
      <div><span>Lot ALTA</span><strong>${escapeHtml(lot.lot_code || '-')}</strong></div>
      <div><span>Lot fournisseur</span><strong>${escapeHtml(lot.supplier_lot_number || '-')}</strong></div>
      <div><span>Reception</span><strong>${escapeHtml(upstream.supplier_name || '-')} ${escapeHtml(formatDate(upstream.receipt_date || upstream.purchase_date))}</strong></div>
      <div><span>Stock initial</span><strong>${escapeHtml(qty(summary.stock_initial))}</strong></div>
      <div><span>Stock restant</span><strong>${escapeHtml(qty(summary.stock_remaining))}</strong></div>
      <div><span>Clients livres</span><strong>${escapeHtml(summary.clients_delivered_count || 0)}</strong></div>
      <div><span>BL concernes</span><strong>${escapeHtml(summary.delivery_notes_count || 0)}</strong></div>
      <div><span>Quantite livree</span><strong>${escapeHtml(qty(summary.delivered_quantity))}</strong></div>
      <div><span>Transformation</span><strong>${escapeHtml(summary.transformations_count ? summary.transformations_count : 'Aucune')}</strong></div>
    </div>
    <h4>Tracabilite amont</h4>
    <dl class="trace-definition-list">
      <dt>Fournisseur</dt><dd>${escapeHtml(upstream.supplier_name || '-')}</dd>
      <dt>BL fournisseur</dt><dd>${escapeHtml(upstream.bl_number || '-')}</dd>
      <dt>Date reception</dt><dd>${escapeHtml(formatDate(upstream.receipt_date || upstream.purchase_date))}</dd>
      <dt>Quantite receptionnee</dt><dd>${escapeHtml(qty(upstream.received_quantity))}</dd>
      <dt>FAO</dt><dd>${escapeHtml(upstream.traceability?.fao_zone || '-')}</dd>
      <dt>Nom latin</dt><dd>${escapeHtml(upstream.traceability?.latin_name || '-')}</dd>
    </dl>
    <h4>Transformations</h4>
    ${renderTraceabilityTransformations(data.transformations || [])}
    <h4>Tracabilite aval</h4>
    ${renderTraceabilityDownstream(data.downstream || [])}
    <h4>Resultat du test</h4>
    <div class="trace-recall-form">
      <div class="form-group"><label for="traceability-test-result">Resultat</label><select id="traceability-test-result"><option value="">Choisir</option><option value="conform">Conforme</option><option value="non_conform">Non conforme</option></select></div>
      <div class="form-group"><label for="traceability-test-observation">Observation</label><textarea id="traceability-test-observation" rows="3"></textarea></div>
      <div class="form-group" id="traceability-test-corrective-group"><label for="traceability-test-corrective">Action corrective prevue ou engagee</label><textarea id="traceability-test-corrective" rows="3"></textarea></div>
    </div>
    <div class="trace-actions-row">
      <button type="button" class="btn btn-primary" data-action="validate-traceability-test" data-lot-id="${escapeHtml(lot.lot_id || '')}">Valider le test</button>
    </div>
  </section>`;
  updateTraceabilityTestFields();
}

function updateTraceabilityTestFields() {
  const result = document.getElementById('traceability-test-result')?.value || '';
  const group = document.getElementById('traceability-test-corrective-group');
  if (group) group.classList.toggle('hidden', result !== 'non_conform');
}

async function openTraceabilityTestLot(lotId) {
  els.lotModalBody.innerHTML = '<div class="trace-empty">Chargement du test...</div>';
  const data = await apiFetch(`/api/traceability/lots/${encodeURIComponent(lotId)}/traceability-test`);
  renderTraceabilityTestPanel(data);
}

async function validateTraceabilityTest(lotId) {
  const current = state.traceabilityTest || {};
  const payload = {
    started_at: current.started_at,
    result: document.getElementById('traceability-test-result')?.value || '',
    observation: document.getElementById('traceability-test-observation')?.value.trim() || '',
    corrective_action: document.getElementById('traceability-test-corrective')?.value.trim() || '',
  };
  if (!payload.result) throw new Error('Choisir Conforme ou Non conforme.');
  if (payload.result === 'non_conform' && !payload.observation) throw new Error('Observation obligatoire pour un test non conforme.');
  if (payload.result === 'non_conform' && !payload.corrective_action) throw new Error('Action corrective obligatoire pour un test non conforme.');
  const result = await apiFetch(`/api/traceability/lots/${encodeURIComponent(lotId)}/traceability-test`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const evidenceId = result.quality_evidence_record?.id;
  els.lotModalTitle.textContent = 'Test de tracabilite valide';
  els.lotModalSubtitle.textContent = `Lot ${current.lot?.lot_code || '-'}`;
  els.lotModalBody.innerHTML = `<section class="trace-detail-card trace-recall-panel">
    <h3>Test enregistre</h3>
    <dl class="trace-definition-list">
      <dt>Resultat</dt><dd>${escapeHtml(traceabilityResultLabel(payload.result))}</dd>
      <dt>Duree</dt><dd>${escapeHtml(formatDuration(result.quality_evidence_record?.payload?.duration_seconds || 0))}</dd>
      <dt>Observation</dt><dd>${escapeHtml(payload.observation || '-')}</dd>
      <dt>Action corrective</dt><dd>${escapeHtml(payload.corrective_action || '-')}</dd>
    </dl>
    <div class="trace-actions-row">
      ${evidenceId ? `<a class="btn btn-primary" href="./quality/pages/evidence-records.html">Voir les enregistrements qualite</a>` : ''}
      <button type="button" class="btn btn-secondary" data-action="open-traceability-test">Nouveau test</button>
    </div>
  </section>`;
}

async function startRecallWorkflow(lotId) {
  state.currentLotId = lotId;
  state.recallAnalysis = null;
  state.recallCampaign = null;
  state.recallPreviewRecipientId = null;
  els.lotModal.classList.remove('hidden');
  els.lotModalTitle.textContent = 'Retrait / Rappel produit';
  els.lotModalSubtitle.textContent = 'Analyse aval';
  els.lotModalBody.innerHTML = '<div class="trace-empty">Analyse en cours...</div>';
  try {
    const analysis = await apiFetch(`/api/traceability/lots/${encodeURIComponent(lotId)}/recall-analysis`);
    state.recallAnalysis = analysis;
    state.recallPreviewRecipientId = selectedRecallRecipient(analysis)?.delivered_client_id || null;
    els.lotModalBody.innerHTML = renderRecallAnalysisPanel(analysis);
  } catch (err) {
    els.lotModalBody.innerHTML = `<div class="trace-empty">${escapeHtml(err.message || 'Erreur analyse rappel')}</div>`;
  }
}

async function createRecallCampaign(lotId) {
  const payload = state.pendingRecallPayload;
  if (!payload) return;
  els.lotModalBody.innerHTML = '<div class="trace-empty">Creation du rappel...</div>';
  try {
    const result = await apiFetch(`/api/traceability/lots/${encodeURIComponent(lotId)}/recall`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    renderRecallCampaignPanel(result);
    await loadLots({ append: false });
  } catch (err) {
    if (err.code === 'PRODUCT_RECALL_ACTIVE_EXISTS') {
      renderActiveRecallError(err);
      return;
    }
    els.lotModalBody.innerHTML = `<div class="trace-empty">${escapeHtml(err.message || 'Erreur creation campagne')}</div>`;
  }
}

async function openRecallCampaign(campaignId) {
  els.lotModal.classList.remove('hidden');
  els.lotModalTitle.textContent = 'Rappel produit';
  els.lotModalSubtitle.textContent = 'Chargement campagne';
  els.lotModalBody.innerHTML = '<div class="trace-empty">Chargement...</div>';
  try {
    const data = await apiFetch(`/api/traceability/recalls/${encodeURIComponent(campaignId)}`);
    state.currentLotId = data.lot?.lot_id || state.currentLotId;
    state.recallPreviewRecipientId = selectedRecallRecipient(data)?.delivered_client_id || null;
    renderRecallCampaignPanel(data);
  } catch (err) {
    els.lotModalBody.innerHTML = `<div class="trace-empty">${escapeHtml(err.message || 'Erreur lecture rappel produit')}</div>`;
  }
}

async function sendRecallNotifications(campaignId, recipientIds) {
  if (state.sendingRecall) return;
  state.sendingRecall = true;
  els.lotModalBody.innerHTML = '<div class="trace-empty">Envoi des rappels en cours...</div>';
  try {
    const result = await apiFetch(`/api/traceability/recalls/${encodeURIComponent(campaignId)}/send`, {
      method: 'POST',
      body: JSON.stringify({ recipient_ids: recipientIds }),
    });
    renderRecallSendResultPanel(result);
  } catch (err) {
    els.lotModalBody.innerHTML = `<div class="trace-empty">${escapeHtml(err.message || 'Erreur envoi rappels')}</div>`;
  } finally {
    state.sendingRecall = false;
    updateRecallSendButtonState();
  }
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
  els.startTraceabilityTest.addEventListener('click', renderTraceabilityTestSearchPanel);
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
  els.lotModalBody.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]');
    if (!action?.dataset.lotId) return;
    if (action.dataset.action === 'block-quality') blockQualityLot(action.dataset.lotId).catch((err) => setState(err.message || 'Erreur blocage qualite', 'error'));
    if (action.dataset.action === 'release-quality') releaseQualityLot(action.dataset.lotId).catch((err) => setState(err.message || 'Erreur liberation qualite', 'error'));
    if (action.dataset.action === 'start-recall') startRecallWorkflow(action.dataset.lotId).catch((err) => setState(err.message || 'Erreur rappel produit', 'error'));
    if (action.dataset.action === 'back-lot-detail') openLotDetail(action.dataset.lotId).catch((err) => setState(err.message || 'Erreur detail lot', 'error'));
    if (action.dataset.action === 'prepare-recall-confirm') {
      try {
        renderRecallConfirmPanel(action.dataset.lotId, recallFormPayload());
      } catch (err) {
        setState(err.message || 'Formulaire rappel incomplet', 'error');
      }
    }
    if (action.dataset.action === 'confirm-create-recall') createRecallCampaign(action.dataset.lotId).catch((err) => setState(err.message || 'Erreur creation rappel', 'error'));
  });
  els.lotModalBody.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]');
    if (!action) return;
    if (action.dataset.action === 'render-recall-analysis' && state.recallAnalysis) {
      els.lotModalTitle.textContent = 'Retrait / Rappel produit';
      els.lotModalSubtitle.textContent = 'Analyse aval';
      els.lotModalBody.innerHTML = renderRecallAnalysisPanel(state.recallAnalysis);
    }
    if (action.dataset.action === 'open-recall-campaign' && action.dataset.campaignId) {
      openRecallCampaign(action.dataset.campaignId).catch((err) => setState(err.message || 'Erreur rappel existant', 'error'));
    }
    if (action.dataset.action === 'preview-recall-recipient' && action.dataset.recipientId) {
      state.recallPreviewRecipientId = action.dataset.recipientId;
      const container = document.getElementById('recall-email-preview');
      if (container && state.recallCampaign) {
        container.innerHTML = renderRecallEmailPreview(state.recallCampaign, {
          reason: state.recallCampaign.campaign?.reason || '',
          comment: state.recallCampaign.campaign?.comment || '',
        });
      } else {
        updateRecallEmailPreview();
      }
    }
    if (action.dataset.action === 'prepare-send-recall' && action.dataset.campaignId) {
      const selectedIds = selectedSendableRecallRecipientIds();
      if (!selectedIds.length) return;
      renderRecallSendConfirmPanel(action.dataset.campaignId, selectedIds);
    }
    if (action.dataset.action === 'confirm-send-recall' && action.dataset.campaignId) {
      const recipientIds = String(action.dataset.recipientIds || '').split(',').filter(Boolean);
      sendRecallNotifications(action.dataset.campaignId, recipientIds).catch((err) => setState(err.message || 'Erreur envoi rappels', 'error'));
    }
    if (action.dataset.action === 'open-traceability-test') {
      renderTraceabilityTestSearchPanel();
    }
    if (action.dataset.action === 'search-traceability-test-lots') {
      searchTraceabilityTestLots().catch((err) => setState(err.message || 'Erreur recherche lots test tracabilite', 'error'));
    }
    if (action.dataset.action === 'select-traceability-test-lot' && action.dataset.lotId) {
      openTraceabilityTestLot(action.dataset.lotId).catch((err) => setState(err.message || 'Erreur chargement test tracabilite', 'error'));
    }
    if (action.dataset.action === 'validate-traceability-test' && action.dataset.lotId) {
      validateTraceabilityTest(action.dataset.lotId).catch((err) => setState(err.message || 'Erreur validation test tracabilite', 'error'));
    }
  });
  els.lotModalBody.addEventListener('input', (event) => {
    if (event.target.matches('#recall-reason, #recall-comment')) updateRecallEmailPreview();
  });
  els.lotModalBody.addEventListener('keydown', (event) => {
    if (event.target.matches('#traceability-test-search') && event.key === 'F9') {
      event.preventDefault();
      searchTraceabilityTestLots({ consultation: true }).catch((err) => setState(err.message || 'Erreur recherche lots test tracabilite', 'error'));
    }
  });
  els.lotModalBody.addEventListener('change', (event) => {
    if (event.target.matches('#recall-type')) updateRecallEmailPreview();
    if (event.target.matches('.recall-recipient-checkbox')) updateRecallSendButtonState();
    if (event.target.matches('#traceability-test-result')) updateTraceabilityTestFields();
  });
  els.photoModalClose.addEventListener('click', closePhoto);
  els.photoModal.addEventListener('click', (event) => { if (event.target.dataset.closePhoto === 'true') closePhoto(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeLotModal(); closePhoto(); } });
}

bindEvents();
loadLots({ append: false });
