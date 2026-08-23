(function () {
  const user = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  if (!user || !token) { window.location.href = '../../login.html'; return; }

  const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';
  const $ = (id) => document.getElementById(id);
  const els = {
    feedback: $('evidence-record-feedback'),
    summary: $('evidence-record-summary'),
    documentLinks: $('evidence-record-document-links'),
    search: $('evidence-record-search'),
    type: $('evidence-record-type'),
    status: $('evidence-record-status'),
    startDate: $('evidence-record-start-date'),
    endDate: $('evidence-record-end-date'),
    exportCsv: $('evidence-record-export-csv'),
    tableBody: $('evidence-record-table-body'),
    detail: $('evidence-record-detail'),
  };
  let records = [];

  const DOCUMENT_TARGETS_BY_TYPE = Object.freeze({
    reception_record: (record) => (record?.id ? {
      targetType: 'quality_evidence_record',
      targetId: record.id,
      title: 'Procedures et documents applicables',
    } : null),
  });

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));
  }
  function setFeedback(message = '', type = '') { els.feedback.textContent = message; els.feedback.className = message ? `page-feedback ${type}`.trim() : 'page-feedback hidden'; }
  function formatDate(value) { return value ? new Date(value).toLocaleString('fr-FR') : '-'; }
  function compact(values) { return values.filter((value) => value !== undefined && value !== null && value !== ''); }
  function humanize(value) { return String(value || '-').split(/[_:.-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '); }
  function typeLabel(type) { return { reception_record: 'Reception fournisseur', traceability_test_record: 'Test de tracabilite' }[type] || humanize(type); }
  function statusLabel(status) {
    return {
      draft: 'Brouillon',
      recorded: 'Enregistre',
      validated: 'Valide',
      rejected: 'Rejete',
      archived: 'Archive',
      direct_trade: 'Négoce',
      physical: 'Reception physique',
    }[status] || humanize(status);
  }
  function controlStatusLabel(status) {
    return {
      conform: 'Conforme',
      non_conform: 'Non conforme',
      direct_trade: 'Négoce',
      not_applicable: 'Non applicable',
      not_available_in_purchase_reception_flow: 'Non renseigne',
    }[status] || statusLabel(status);
  }
  function correctiveActionLabel(action) {
    return {
      supplier_return: 'Retour fournisseur',
      lot_isolation: 'Isolement du lot',
      accepted_with_reservation: 'Acceptation sous reserve',
      destruction: 'Destruction',
      other: 'Autre',
    }[action] || humanize(action);
  }
  function payload(record) { return record?.payload && typeof record.payload === 'object' ? record.payload : {}; }
  function identification(record) { return payload(record).identification || {}; }
  function products(record) { return Array.isArray(payload(record).received_products) ? payload(record).received_products : []; }
  function documents(record) { return payload(record).documents || {}; }
  function linkedDocuments(record) { return payload(record).linked_documents || {}; }
  function controls(record) { return payload(record).controls || {}; }
  function controlLabel(status) { return !status ? 'Non renseigne' : controlStatusLabel(status); }
  function testResultLabel(result) { return { conform: 'Conforme', non_conform: 'Non conforme' }[result] || humanize(result); }
  function formatDuration(seconds) {
    const total = Math.max(0, Number(seconds || 0));
    const minutes = Math.floor(total / 60);
    const remaining = total % 60;
    return minutes ? `${minutes} min ${remaining} s` : `${remaining} s`;
  }

  function productSummary(record) {
    if (record.evidence_type === 'traceability_test_record') {
      const data = payload(record);
      const article = data.article || {};
      const lot = data.lot || {};
      return compact([
        article.designation || article.plu,
        lot.lot_code,
        testResultLabel(data.result),
        data.duration_seconds !== undefined ? formatDuration(data.duration_seconds) : null,
      ]).join(' - ') || record.summary_label || '-';
    }
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
    return record.reference_label || id.bl_number || id.supplier_name || record.evidence_reference || '-';
  }

  function originLabel(record) {
    return record.origin_label || record.source_record_type || record.source_type || '-';
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

  function hasUnfilledControls(record) {
    const data = controls(record);
    return ['temperature', 'freshness', 'packaging', 'label_conformity'].some((key) => {
      const status = data[key]?.status;
      return !status || status === 'not_available_in_purchase_reception_flow';
    });
  }

  function renderSummary() {
    const typeCount = new Set(records.map((record) => record.evidence_type).filter(Boolean)).size;
    const incompleteCount = records.filter(hasUnfilledControls).length;
    els.summary.innerHTML = `
      <article class="quality-card">
        <span class="quality-badge">Periode</span>
        <h3>${records.length}</h3>
        <p class="quality-muted">Enregistrements filtres</p>
      </article>
      <article class="quality-card">
        <span class="quality-badge">Controles</span>
        <h3>${incompleteCount}</h3>
        <p class="quality-muted">Controles physiques non renseignes</p>
      </article>
      <article class="quality-card">
        <span class="quality-badge">Types</span>
        <h3>${typeCount}</h3>
        <p class="quality-muted">Types d'ENR representes</p>
      </article>
    `;
  }

  function renderRows() {
    renderSummary();
    if (!records.length) {
      els.tableBody.innerHTML = '<tr><td colspan="7">Aucun enregistrement trouve.</td></tr>';
      return;
    }
    els.tableBody.innerHTML = records.map((record) => `
      <tr>
        <td>${formatDate(record.evidence_at)}</td>
        <td>${escapeHtml(record.type_label || typeLabel(record.evidence_type))}</td>
        <td>${escapeHtml(referenceLabel(record))}</td>
        <td>${escapeHtml(originLabel(record))}</td>
        <td>${escapeHtml(productSummary(record))}</td>
        <td><span class="quality-badge">${escapeHtml(record.status_label || statusLabel(record.evidence_status))}</span></td>
        <td><button class="btn btn-secondary" type="button" data-action="detail" data-id="${escapeHtml(record.id)}">Voir</button></td>
      </tr>
    `).join('');
  }

  function detailRows(rows) {
    const html = rows
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
      .join('');
    return html ? `<dl class="quality-ddpp-detail-grid">${html}</dl>` : '<div class="quality-empty-state">Aucune donnee renseignee.</div>';
  }

  function renderProductsTable(record) {
    const rows = products(record);
    if (!rows.length) return '<div class="quality-empty-state">Aucun produit detaille dans le snapshot.</div>';
    return `
      <div class="quality-table-wrapper">
        <table class="quality-table">
          <thead>
            <tr>
              <th>Article</th>
              <th>PLU</th>
              <th>Colis</th>
              <th>Quantite / poids</th>
              <th>Lot ALTA</th>
              <th>Lot fournisseur</th>
              <th>DLC</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((product) => `
              <tr>
                <td>${escapeHtml(product.article_designation || product.supplier_label || '-')}</td>
                <td>${escapeHtml(product.article_plu || '-')}</td>
                <td>${escapeHtml(product.received_colis ?? '-')}</td>
                <td>${escapeHtml(product.received_quantity ?? product.stock_quantity ?? '-')}</td>
                <td>${escapeHtml(product.lot_code || '-')}</td>
                <td>${escapeHtml(product.supplier_lot_number || '-')}</td>
                <td>${escapeHtml(product.dlc || product.best_before_date || '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderTraceability(record) {
    const rows = products(record).flatMap((product) => {
      const trace = product.traceability || {};
      const label = product.article_designation || product.supplier_label || product.article_plu || 'Produit';
      const values = detailRows([
        ['Nom scientifique', trace.latin_name || trace.scientific_name],
        ['Methode de production', trace.production_method],
        ['Zone FAO', trace.fao_zone],
        ['Sous-zone', trace.sous_zone],
        ['Engin', trace.fishing_gear],
        ['Origine', trace.origin_label || trace.origin],
      ]);
      return values.includes('quality-empty-state') ? [] : [`<article class="quality-card"><h4>${escapeHtml(label)}</h4>${values}</article>`];
    });
    return rows.length ? `<div class="quality-list-grid">${rows.join('')}</div>` : '<div class="quality-empty-state">Aucune donnee de tracabilite detaillee dans le snapshot.</div>';
  }

  function renderControlItem(label, control) {
    const status = controlLabel(control?.status);
    const value = control?.value_c !== undefined && control?.value_c !== null ? `${control.value_c} C` : (control?.value || control?.comment || '');
    return `<div><dt>${escapeHtml(label)}</dt><dd><span class="quality-badge">${escapeHtml(status)}</span>${value ? ` ${escapeHtml(value)}` : ''}</dd></div>`;
  }

  function renderControls(record) {
    const data = controls(record);
    const observation = data.observation || data.observations?.value || null;
    const correctiveAction = data.corrective_action ? correctiveActionLabel(data.corrective_action) : null;
    return `
      <dl class="quality-ddpp-detail-grid">
        ${data.overall_status ? renderControlItem('Statut global', { status: data.overall_status }) : ''}
        ${renderControlItem('Temperature', data.temperature)}
        ${renderControlItem('Fraicheur', data.freshness)}
        ${renderControlItem('Emballage', data.packaging)}
        ${renderControlItem('Conformite etiquetage', data.label_conformity)}
        ${observation ? `<div><dt>Observation</dt><dd>${escapeHtml(observation)}</dd></div>` : ''}
        ${correctiveAction ? `<div><dt>Action corrective</dt><dd>${escapeHtml(correctiveAction)}</dd></div>` : ''}
        ${data.corrective_action_comment ? `<div><dt>Commentaire action</dt><dd>${escapeHtml(data.corrective_action_comment)}</dd></div>` : ''}
        ${!observation && data.observations ? renderControlItem('Observations', data.observations) : ''}
      </dl>
    `;
  }

  function proofButton(label, url, filename = '') {
    if (!url) return '';
    return `<button class="btn btn-secondary" type="button" data-open-proof="${escapeHtml(url)}" data-proof-name="${escapeHtml(filename)}">${escapeHtml(label)}</button>`;
  }

  function renderProofs(record) {
    const doc = documents(record);
    const photos = Array.isArray(doc.sanitary_photo_urls) ? doc.sanitary_photo_urls : [];
    const actions = [
      proofButton(doc.purchase_document_original_name || 'Document fournisseur', doc.purchase_document_url, doc.purchase_document_original_name),
      ...photos.map((url, index) => proofButton(`Photo sanitaire ${index + 1}`, url, `photo-sanitaire-${index + 1}`)),
    ].filter(Boolean);
    if (!actions.length) return '<div class="quality-empty-state">Aucun document ou photo rattache a cette preuve.</div>';
    return `<div class="quality-actions">${actions.join('')}</div>`;
  }

  function renderLinkedDocuments(record) {
    const data = linkedDocuments(record);
    const downstream = Array.isArray(data.downstream_delivery_notes) ? data.downstream_delivery_notes : [];
    const supplierBl = data.supplier_delivery_note || identification(record).bl_number || null;
    const supplierRows = detailRows([
      ['BL fournisseur', supplierBl],
    ]);
    const downstreamHtml = downstream.length ? `
      <div class="quality-table-wrapper">
        <table class="quality-table">
          <thead><tr><th>Destination</th><th>BL aval</th><th>Date livraison</th><th>Lot</th><th>Quantite livree</th></tr></thead>
          <tbody>${downstream.map((row) => `<tr>
            <td>${escapeHtml(compact([row.delivered_client_name, row.delivered_client_store_identifier]).join(' - ') || '-')}</td>
            <td>${escapeHtml(row.delivery_note_reference || '-')}</td>
            <td>${escapeHtml(row.delivery_date || '-')}</td>
            <td>${escapeHtml(compact([row.lot_code, row.supplier_lot_number]).join(' / ') || '-')}</td>
            <td>${escapeHtml(row.delivered_quantity ?? '-')}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    ` : '<div class="quality-empty-state">Aucun BL aval rattache a cette reception pour le moment.</div>';
    return `${supplierRows}<h4>Destination / BL aval</h4>${downstreamHtml}`;
  }

  function renderTraceabilityTestTransformations(record) {
    const rows = Array.isArray(payload(record).transformations) ? payload(record).transformations : [];
    if (!rows.length) return '<div class="quality-empty-state">Aucune transformation rattachee dans le snapshot du test.</div>';
    return `
      <div class="quality-table-wrapper">
        <table class="quality-table">
          <thead><tr><th>Date</th><th>Type</th><th>Quantite</th><th>Source</th><th>Note</th></tr></thead>
          <tbody>${rows.map((row) => `<tr>
            <td>${escapeHtml(formatDate(row.created_at))}</td>
            <td>${escapeHtml(humanize(row.movement_type))}</td>
            <td>${escapeHtml(row.quantity ?? '-')}</td>
            <td>${escapeHtml(row.source_table || row.source_id || '-')}</td>
            <td>${escapeHtml(row.notes || '-')}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  function renderTraceabilityTestDownstream(record) {
    const rows = Array.isArray(payload(record).downstream) ? payload(record).downstream : [];
    if (!rows.length) return '<div class="quality-empty-state">Aucun BL client dans le snapshot du test.</div>';
    return `
      <div class="quality-table-wrapper">
        <table class="quality-table">
          <thead><tr><th>BL</th><th>Date</th><th>Client livre</th><th>Client facture</th><th>Quantite</th></tr></thead>
          <tbody>${rows.map((row) => `<tr>
            <td>${escapeHtml(row.delivery_note_reference || row.delivery_note_id || '-')}</td>
            <td>${escapeHtml(formatDate(row.delivery_note_date))}</td>
            <td>${escapeHtml(row.delivered_client_name || '-')}</td>
            <td>${escapeHtml(row.billed_client_name || '-')}</td>
            <td>${escapeHtml(row.delivered_quantity ?? '-')}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  function renderTraceabilityTestDetail(record) {
    const data = payload(record);
    const lot = data.lot || {};
    const article = data.article || {};
    const upstream = data.upstream || {};
    const trace = upstream.traceability || {};
    const summary = data.summary || {};
    els.detail.classList.remove('hidden');
    els.detail.innerHTML = `
      <div class="quality-section-header">
        <div>
          <span class="quality-badge">${escapeHtml(testResultLabel(data.result))}</span>
          <h3>Test de tracabilite</h3>
          <p class="quality-muted">Lot ${escapeHtml(lot.lot_code || '-')} - ${escapeHtml(article.designation || article.plu || '-')}</p>
        </div>
        <button class="btn btn-secondary" type="button" data-action="close-detail">Fermer</button>
      </div>
      <section><h4>Identification</h4>${detailRows([
        ['Date', data.completed_at || record.evidence_at],
        ['Lot ALTA', lot.lot_code],
        ['Lot fournisseur', lot.supplier_lot_number],
        ['Article', article.designation || article.plu],
        ['Resultat', testResultLabel(data.result)],
        ['Duree', formatDuration(data.duration_seconds)],
      ])}</section>
      <section><h4>Tracabilite amont</h4>${detailRows([
        ['Fournisseur', upstream.supplier_name],
        ['BL fournisseur', upstream.bl_number],
        ['Date reception', upstream.receipt_date || upstream.purchase_date],
        ['Quantite receptionnee', upstream.received_quantity],
        ['Nom scientifique', trace.latin_name],
        ['Zone FAO', trace.fao_zone],
        ['Sous-zone', trace.sous_zone],
        ['Engin', trace.fishing_gear],
        ['Origine', trace.origin_label],
      ])}</section>
      <section><h4>Transformations</h4>${renderTraceabilityTestTransformations(record)}</section>
      <section><h4>Tracabilite aval</h4>${renderTraceabilityTestDownstream(record)}</section>
      <section><h4>Resultat du test</h4>${detailRows([
        ['Resultat', testResultLabel(data.result)],
        ['Clients livres', summary.clients_delivered_count],
        ['BL concernes', summary.delivery_notes_count],
        ['Quantite livree', summary.delivered_quantity],
        ['Stock initial', summary.stock_initial],
        ['Stock restant', summary.stock_remaining],
      ])}</section>
      <section><h4>Observation / action corrective</h4>${detailRows([
        ['Observation', data.observation],
        ['Action corrective', data.corrective_action],
      ])}</section>
      <section><h4>Realise par / date / duree</h4>${detailRows([
        ['Realise par', record.recorded_by_email || data.user_id],
        ['Debut', data.started_at],
        ['Fin', data.completed_at],
        ['Duree', formatDuration(data.duration_seconds)],
      ])}</section>
    `;
    renderApplicableDocuments(record).catch(() => {});
    els.detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function documentTargetForRecord(record) {
    const resolver = DOCUMENT_TARGETS_BY_TYPE[record?.evidence_type];
    if (resolver) return resolver(record);
    return record?.id ? { targetType: 'quality_evidence_record', targetId: record.id, title: 'Procedures et documents applicables' } : null;
  }

  async function renderApplicableDocuments(record = null) {
    if (!els.documentLinks) return;
    if (!record) {
      els.documentLinks.innerHTML = `
        <h3>Procedures et documents applicables</h3>
        <div class="quality-empty-state">Selectionner un enregistrement pour afficher les documents applicables rattaches par le referentiel qualite. Aucun numero PROC/ENR n'est code en dur.</div>
      `;
      return;
    }
    const target = documentTargetForRecord(record);
    if (!target || !window.QualityDocumentLinks?.render) {
      els.documentLinks.innerHTML = `
        <h3>Procedures et documents applicables</h3>
        <div class="quality-empty-state">Aucun mapping documentaire exploitable pour ce type d'enregistrement.</div>
      `;
      return;
    }
    await window.QualityDocumentLinks.render(target.targetType, target.targetId, els.documentLinks, { title: target.title });
  }

  function renderDetail(record) {
    if (record.evidence_type === 'traceability_test_record') {
      renderTraceabilityTestDetail(record);
      return;
    }
    const id = identification(record);
    const data = payload(record);
    els.detail.classList.remove('hidden');
    els.detail.innerHTML = `
      <div class="quality-section-header">
        <div>
          <span class="quality-badge">${escapeHtml(record.status_label || statusLabel(record.evidence_status))}</span>
          <h3>${escapeHtml(record.type_label || typeLabel(record.evidence_type))}</h3>
          <p class="quality-muted">${escapeHtml(referenceLabel(record))}</p>
        </div>
        <button class="btn btn-secondary" type="button" data-action="close-detail">Fermer</button>
      </div>
      <section>
        <h4>Identification</h4>
        ${detailRows([
          ['Type', record.type_label || typeLabel(record.evidence_type)],
          ['Mode', id.reception_mode_label || data.reception_mode_label],
          ['Mention', id.reception_mode_notice || data.reception_mode_notice],
          ['Date/heure reelle', id.received_at || record.occurred_at || record.evidence_at],
          ['Date metier reception', id.receipt_date],
          ['Fournisseur', id.supplier_name],
          ['Code fournisseur', id.supplier_code],
          ['BL fournisseur', id.bl_number],
          ['Operateur / validateur', record.recorded_by_email || id.validated_by],
        ])}
      </section>
      <section>
        <h4>Documents lies</h4>
        ${renderLinkedDocuments(record)}
      </section>
      <section>
        <h4>Produits recus</h4>
        ${renderProductsTable(record)}
      </section>
      <section>
        <h4>Tracabilite</h4>
        ${renderTraceability(record)}
      </section>
      <section>
        <h4>Controles</h4>
        ${renderControls(record)}
      </section>
      <section>
        <h4>Documents / preuves</h4>
        ${renderProofs(record)}
      </section>
    `;
    renderApplicableDocuments(record).catch(() => {});
    els.detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function openProtectedUrl(url, fallbackName = '') {
    if (!url) return;
    const absoluteUrl = /^https?:\/\//i.test(url) ? url : `${API_BASE_URL}${url}`;
    const response = await fetch(absoluteUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Document indisponible.');
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.target = '_blank';
    if (fallbackName) link.download = fallbackName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
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

  function exportCsv() {
    const header = ['date_heure', 'type', 'reference', 'origine', 'resume', 'statut'];
    const lines = records.map((record) => [
      record.evidence_at || '',
      record.type_label || typeLabel(record.evidence_type),
      referenceLabel(record),
      originLabel(record),
      productSummary(record),
      record.status_label || statusLabel(record.evidence_status),
    ].map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';'));
    const blob = new Blob([[header.join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `enregistrements-qualite-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  els.exportCsv.addEventListener('click', exportCsv);
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
    const closeButton = event.target.closest('[data-action="close-detail"]');
    const proofButtonEl = event.target.closest('[data-open-proof]');
    if (closeButton) els.detail.classList.add('hidden');
    if (proofButtonEl) {
      openProtectedUrl(proofButtonEl.dataset.openProof, proofButtonEl.dataset.proofName).catch((error) => setFeedback(error.message, 'error'));
    }
  });
  [els.search, els.type, els.status, els.startDate, els.endDate].forEach((el) => {
    el.addEventListener('input', load);
    el.addEventListener('change', load);
  });

  renderApplicableDocuments().catch(() => {});
  load();
})();
