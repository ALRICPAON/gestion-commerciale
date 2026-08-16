(function () {
  const user = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  if (!user || !token) { window.location.href = '../../login.html'; return; }

  const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';
  const $ = (id) => document.getElementById(id);
  const els = {
    feedback: $('evidence-record-feedback'),
    search: $('evidence-record-search'),
    type: $('evidence-record-type'),
    status: $('evidence-record-status'),
    startDate: $('evidence-record-start-date'),
    endDate: $('evidence-record-end-date'),
    tableBody: $('evidence-record-table-body'),
    detail: $('evidence-record-detail'),
  };
  let records = [];

  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  function setFeedback(message = '', type = '') { els.feedback.textContent = message; els.feedback.className = message ? `page-feedback ${type}`.trim() : 'page-feedback hidden'; }
  function formatDate(value) { return value ? new Date(value).toLocaleString('fr-FR') : '-'; }
  function compact(values) { return values.filter((value) => value !== undefined && value !== null && value !== ''); }
  function humanize(value) { return String(value || '-').split(/[_:.-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '); }
  function typeLabel(type) { return { reception_record: 'Reception fournisseur' }[type] || humanize(type); }
  function statusLabel(status) { return { draft: 'Brouillon', recorded: 'Enregistre', validated: 'Valide', rejected: 'Rejete', archived: 'Archive' }[status] || humanize(status); }
  function controlLabel(status) {
    if (!status || status === 'not_available_in_purchase_reception_flow') return 'Non renseigne';
    return statusLabel(status);
  }
  function payload(record) { return record?.payload && typeof record.payload === 'object' ? record.payload : {}; }
  function identification(record) { return payload(record).identification || {}; }
  function products(record) { return Array.isArray(payload(record).received_products) ? payload(record).received_products : []; }
  function documents(record) { return payload(record).documents || {}; }
  function controls(record) { return payload(record).controls || {}; }
  function productSummary(record) {
    const product = products(record)[0];
    if (!product) return record.summary_label || '-';
    const label = product.article_designation || product.supplier_label || product.article_plu || product.supplier_reference || '-';
    const qty = product.received_quantity ?? product.stock_quantity;
    const unit = product.price_unit === 'piece' ? 'piece(s)' : product.price_unit === 'colis' ? 'colis' : 'kg';
    const extra = products(record).length > 1 ? ` +${products(record).length - 1}` : '';
    return compact([label, qty !== undefined && qty !== null ? `${qty} ${unit}` : null]).join(' - ') + extra;
  }
  function referenceLabel(record) {
    const id = identification(record);
    return record.reference_label || id.supplier_name || id.bl_number || record.evidence_reference || '-';
  }

  function queryString(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
    const query = params.toString();
    return query ? `?${query}` : '';
  }

  async function request(path) {
    const response = await fetch(`${API_BASE_URL}/api/quality/evidence-records${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur enregistrements qualite');
    return data;
  }

  function filters() {
    return {
      search: els.search.value,
      evidence_type: els.type.value,
      status: els.status.value,
      start_date: els.startDate.value,
      end_date: els.endDate.value,
      limit: 100,
    };
  }

  function renderRows() {
    if (!records.length) {
      els.tableBody.innerHTML = '<tr><td colspan="7">Aucun enregistrement trouve.</td></tr>';
      return;
    }
    els.tableBody.innerHTML = records.map((record) => `<tr><td>${formatDate(record.evidence_at)}</td><td>${escapeHtml(record.type_label || typeLabel(record.evidence_type))}</td><td>${escapeHtml(referenceLabel(record))}</td><td>${escapeHtml(record.origin_label || '-')}</td><td>${escapeHtml(productSummary(record))}</td><td>${escapeHtml(record.status_label || statusLabel(record.evidence_status))}</td><td><button class="btn btn-secondary" type="button" data-action="detail" data-id="${escapeHtml(record.id)}">Voir</button></td></tr>`).join('');
  }

  function detailRows(rows) {
    return `<dl class="quality-ddpp-detail-grid">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || '-')}</dd></div>`).join('')}</dl>`;
  }

  function renderProduct(product) {
    const trace = product.traceability || {};
    return `<article class="quality-card"><h4>${escapeHtml(product.article_designation || product.supplier_label || product.article_plu || 'Produit')}</h4>${detailRows([
      ['PLU', product.article_plu],
      ['Colis', product.received_colis],
      ['Pieces', product.received_pieces],
      ['Poids / quantite', product.received_quantity ?? product.stock_quantity],
      ['Lot ALTA', product.lot_code],
      ['Lot fournisseur', product.supplier_lot_number],
      ['DLC/DDM', product.dlc],
      ['Nom scientifique', trace.latin_name],
      ['Methode', trace.production_method],
      ['FAO', trace.fao_zone],
      ['Sous-zone', trace.sous_zone],
      ['Engin', trace.fishing_gear],
      ['Origine', trace.origin_label],
    ])}</article>`;
  }

  function renderDocuments(record) {
    const doc = documents(record);
    const photos = Array.isArray(doc.sanitary_photo_urls) ? doc.sanitary_photo_urls : [];
    const rows = [
      ['Document fournisseur', doc.purchase_document_original_name || doc.purchase_document_url],
      ['Photos sanitaires', photos.length ? photos.join(', ') : null],
    ];
    return detailRows(rows);
  }

  function renderControls(record) {
    const data = controls(record);
    return detailRows([
      ['Temperature', controlLabel(data.temperature?.status)],
      ['Fraicheur', controlLabel(data.freshness?.status)],
      ['Emballage', controlLabel(data.packaging?.status)],
      ['Etiquette', controlLabel(data.label_conformity?.status)],
      ['Observations', data.observations?.value || controlLabel(data.observations?.status)],
    ]);
  }

  function renderDetail(record) {
    const id = identification(record);
    els.detail.classList.remove('hidden');
    els.detail.innerHTML = `<div class="quality-section-header"><div><span class="quality-badge">${escapeHtml(record.status_label || statusLabel(record.evidence_status))}</span><h3>${escapeHtml(record.type_label || typeLabel(record.evidence_type))}</h3><p class="quality-muted">${escapeHtml(referenceLabel(record))}</p></div><button class="btn btn-secondary" type="button" data-action="close-detail">Fermer</button></div>
      <section><h4>Identification</h4>${detailRows([
        ['Date/heure reception', id.received_at || record.evidence_at],
        ['Fournisseur', id.supplier_name],
        ['Code fournisseur', id.supplier_code],
        ['BL fournisseur', id.bl_number],
        ['Date metier reception', id.receipt_date],
        ['Validateur', record.recorded_by_email || id.validated_by],
      ])}</section>
      <section><h4>Produits recus</h4><div class="quality-list-grid">${products(record).length ? products(record).map(renderProduct).join('') : '<div class="quality-empty-state">Aucun produit detaille dans le snapshot.</div>'}</div></section>
      <section><h4>Documents</h4>${renderDocuments(record)}</section>
      <section><h4>Controles</h4>${renderControls(record)}</section>`;
    els.detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function load() {
    setFeedback('Chargement des enregistrements...');
    try {
      records = await request(queryString(filters()));
      renderRows();
      setFeedback('');
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  }

  els.tableBody.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action="detail"]');
    if (!button) return;
    try {
      setFeedback('Chargement du detail...');
      const detail = await request(`/${encodeURIComponent(button.dataset.id)}`);
      renderDetail(detail);
      setFeedback('');
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });
  els.detail.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="close-detail"]')) els.detail.classList.add('hidden');
  });
  [els.search, els.type, els.status, els.startDate, els.endDate].forEach((el) => {
    el.addEventListener('input', load);
    el.addEventListener('change', load);
  });

  load();
})();
