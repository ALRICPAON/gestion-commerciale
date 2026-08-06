(function () {
  const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';
  const user = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  if (!user || !token) { window.location.href = '../../login.html'; return; }
  const canRead = window.hasQualityPermission?.(user, 'quality.document.read') || window.hasQualityPermission?.(user, 'quality.read');
  const canEdit = window.hasQualityPermission?.(user, 'quality.document.edit') || window.hasQualityPermission?.(user, 'quality.document.manage');
  if (!canRead) { window.location.href = '../../home.html'; return; }

  const $ = (id) => document.getElementById(id);
  const els = {
    feedback: $('master-documents-feedback'),
    refresh: $('master-document-refresh'),
    search: $('master-document-search'),
    filterType: $('master-document-filter-type'),
    filterStatus: $('master-document-filter-status'),
    filterValidity: $('master-document-filter-validity'),
    filterSource: $('master-document-filter-source'),
    list: $('master-document-list'),
    detail: $('master-document-detail'),
    form: $('master-document-form'),
    id: $('master-document-id'),
    heading: $('master-document-heading'),
    statusBadge: $('master-document-status'),
    title: $('master-document-title'),
    documentType: $('master-document-type'),
    category: $('master-document-category'),
    source: $('master-document-source'),
    issuer: $('master-document-issuer'),
    reference: $('master-document-reference'),
    issueDate: $('master-document-issue-date'),
    validFrom: $('master-document-valid-from'),
    validUntil: $('master-document-valid-until'),
    version: $('master-document-version'),
    status: $('master-document-status-input'),
    filename: $('master-document-filename'),
    storage: $('master-document-storage'),
    mime: $('master-document-mime'),
    size: $('master-document-size'),
    checksum: $('master-document-checksum'),
    description: $('master-document-description'),
    object: $('master-document-object'),
    scope: $('master-document-scope'),
    responsibilities: $('master-document-responsibilities'),
    method: $('master-document-method'),
    frequency: $('master-document-frequency'),
    limits: $('master-document-limits'),
    deviation: $('master-document-deviation'),
    records: $('master-document-records'),
    documents: $('master-document-documents'),
    editButton: $('master-document-edit'),
    pdfButton: $('master-document-pdf'),
    newButton: $('master-document-new'),
    archiveButton: $('master-document-archive'),
    references: $('master-document-references'),
    referenceForm: $('master-reference-form'),
    referenceTargetType: $('master-reference-target-type'),
    referenceTargetId: $('master-reference-target-id'),
    referenceRelation: $('master-reference-relation'),
    referenceLabel: $('master-reference-label'),
  };

  let state = { documents: [], current: null, editMode: false };

  function setFeedback(message = '', type = '') {
    els.feedback.textContent = message;
    els.feedback.className = message ? `page-feedback ${type}`.trim() : 'page-feedback hidden';
  }

  function escapeHtml(value = '') {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function headers() {
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

  function typeLabel(value) {
    return {
      procedure: 'Procedure',
      record_form: 'Formulaire',
      external_evidence: 'Preuve externe',
      technical_sheet: 'Fiche technique',
    }[value] || value || '-';
  }

  function statusLabel(value) {
    return {
      draft: 'Brouillon',
      valid: 'Valide',
      expired: 'Expire',
      replaced: 'Remplace',
      archived: 'Archive',
    }[value] || value || '-';
  }

  function formatDate(value) {
    return value ? new Date(value).toLocaleDateString('fr-FR') : '-';
  }

  function structuredDescription() {
    const content = {
      object: els.object.value,
      scope: els.scope.value,
      responsibilities: els.responsibilities.value,
      method: els.method.value,
      frequency: els.frequency.value,
      limits_objectives: els.limits.value,
      deviation_handling: els.deviation.value,
      associated_records: els.records.value,
      associated_documents: els.documents.value,
      raw_description: els.description.value,
    };
    return Object.values(content).some((value) => String(value || '').trim())
      ? JSON.stringify(content)
      : '';
  }

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}/api/quality/master-documents${path}`, {
      ...options,
      headers: { ...headers(), ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur referentiel documentaire');
    return data;
  }

  async function requestPdf(path) {
    const response = await fetch(`${API_BASE_URL}/api/quality/master-documents${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      let message = 'Erreur generation PDF';
      if (response.status === 401) message = 'Session expiree ou token invalide. Reconnectez-vous.';
      else if (response.status === 403) message = 'Permission insuffisante pour exporter ce PDF.';
      else {
        const data = await response.json().catch(() => ({}));
        message = data.error || message;
      }
      throw new Error(message);
    }
    return response.blob();
  }

  function formPayload() {
    return {
      title: els.title.value,
      document_type: els.documentType.value,
      category: els.category.value,
      source_type: els.source.value,
      issuer_name: els.issuer.value,
      reference_number: els.reference.value,
      issue_date: els.issueDate.value,
      valid_from: els.validFrom.value,
      valid_until: els.validUntil.value,
      version: els.version.value,
      status: els.status.value,
      original_filename: els.filename.value,
      storage_path: els.storage.value,
      mime_type: els.mime.value,
      file_size: els.size.value ? Number(els.size.value) : null,
      checksum_sha256: els.checksum.value,
      description: structuredDescription() || els.description.value,
    };
  }

  function fillForm(document = null) {
    state.current = document;
    els.id.value = document?.id || '';
    els.heading.textContent = document?.title || 'Nouveau document maitre';
    els.statusBadge.textContent = document?.status || '-';
    els.title.value = document?.title || '';
    els.documentType.value = document?.document_type || 'external_evidence';
    els.category.value = document?.category || '';
    els.source.value = document?.source_type || 'interne';
    els.issuer.value = document?.issuer_name || '';
    els.reference.value = document?.reference_number || '';
    els.issueDate.value = document?.issue_date?.slice(0, 10) || '';
    els.validFrom.value = document?.valid_from?.slice(0, 10) || '';
    els.validUntil.value = document?.valid_until?.slice(0, 10) || '';
    els.version.value = document?.version || '1.0';
    els.status.value = document?.status || 'draft';
    els.filename.value = document?.original_filename || '';
    els.storage.value = document?.storage_path || '';
    els.mime.value = document?.mime_type || '';
    els.size.value = document?.file_size || '';
    els.checksum.value = document?.checksum_sha256 || '';
    const structured = document?.structured_content || {};
    els.object.value = structured.object || '';
    els.scope.value = structured.scope || '';
    els.responsibilities.value = structured.responsibilities || '';
    els.method.value = structured.method || '';
    els.frequency.value = structured.frequency || '';
    els.limits.value = structured.limits_objectives || '';
    els.deviation.value = structured.deviation_handling || '';
    els.records.value = structured.associated_records || '';
    els.documents.value = structured.associated_documents || '';
    els.description.value = structured.raw_description && !String(structured.raw_description).trim().startsWith('{') ? structured.raw_description : '';
    renderReferences(document?.references || []);
    renderDetail(document);
    refreshMode();
  }

  function refreshMode() {
    const editing = state.editMode || !state.current;
    els.form.classList.toggle('hidden', !editing);
    els.detail.classList.toggle('hidden', editing);
    els.editButton.disabled = !canEdit || !state.current;
    els.pdfButton.disabled = !state.current;
    renderReferences(state.current?.references || []);
  }

  function renderGroupItem(item) {
    const counts = [
      Number.isFinite(Number(item.occurrence_count)) ? `${Number(item.occurrence_count)} occurrence(s)` : null,
      Number.isFinite(Number(item.record_count)) ? `${Number(item.record_count)} record(s)` : null,
    ].filter(Boolean).join(' - ');
    return `
      <article class="quality-card">
        <span class="quality-badge">${escapeHtml(item.status || item.document_status || item.relation_type || '-')}</span>
        <h4>${escapeHtml(item.target_label || item.document_title || item.label || 'Document qualite')}</h4>
        <p class="quality-muted">${escapeHtml(item.target_type_label || typeLabel(item.document_type) || '-')} ${counts ? `- ${escapeHtml(counts)}` : ''}</p>
        ${item.target_url ? `<button class="btn btn-secondary" type="button" data-open-reference="${escapeHtml(item.target_url)}">Ouvrir</button>` : ''}
      </article>
    `;
  }

  function renderDetail(document) {
    if (!document) {
      els.detail.innerHTML = '<div class="quality-empty-state">Selectionnez un document ou creez une nouvelle fiche.</div>';
      return;
    }
    const content = document.structured_content || {};
    const sections = [
      ['Objet', content.object],
      ["Champ d'application", content.scope],
      ['Responsabilites', content.responsibilities],
      ['Methode', content.method],
      ['Frequence', content.frequency],
      ['Limites et objectifs', content.limits_objectives],
      ['Gestion des ecarts', content.deviation_handling],
      ['Enregistrements associes', content.associated_records],
      ['Documents associes', content.associated_documents],
    ].filter(([, value]) => String(value || '').trim());
    els.detail.innerHTML = `
      <article class="quality-card">
        <span class="quality-badge">${escapeHtml(statusLabel(document.status))}</span>
        <h3>${escapeHtml(document.reference_number || document.title)} - ${escapeHtml(document.title)}</h3>
        <p class="quality-muted">${escapeHtml(typeLabel(document.document_type))} | Version ${escapeHtml(document.version || '-')} | Application ${escapeHtml(formatDate(document.valid_from))}</p>
        <p><strong>Emetteur :</strong> ${escapeHtml(document.issuer_name || document.source_type || '-')}</p>
      </article>
      ${sections.map(([label, value]) => `<article class="quality-card"><h3>${escapeHtml(label)}</h3><p>${escapeHtml(value).replace(/\n/g, '<br>')}</p></article>`).join('')}
      ${sections.length ? '' : `<article class="quality-card"><h3>Contenu</h3><p>${escapeHtml(document.description || 'Aucun contenu renseigne.').replace(/\n/g, '<br>')}</p></article>`}
      ${(document.reference_groups || []).map((group) => `
        <section class="quality-card">
          <h3>${escapeHtml(group.title)}</h3>
          <div class="quality-list-grid">${group.items.map(renderGroupItem).join('')}</div>
        </section>
      `).join('')}
    `;
  }

  function renderList() {
    const query = els.search.value.trim().toLowerCase();
    const rows = state.documents.filter((document) => !query || [document.title, document.reference_number, document.issuer_name].some((value) => String(value || '').toLowerCase().includes(query)));
    els.list.innerHTML = rows.length ? rows.map((document) => `
      <button class="quality-doc-tree-item ${state.current?.id === document.id ? 'active' : ''}" type="button" data-document-id="${escapeHtml(document.id)}">
        <strong>${escapeHtml(document.title)}</strong>
        <span>${escapeHtml(typeLabel(document.document_type))} - ${escapeHtml(statusLabel(document.status))} - ${document.active_reference_count || 0} ref.</span>
      </button>
    `).join('') : '<div class="quality-empty-state">Aucun document maitre.</div>';
  }

  function renderReferences(references = []) {
    els.references.innerHTML = references.length ? references.map((reference) => `
      <article class="quality-card">
        <span class="quality-badge">${escapeHtml(reference.relation_type)}</span>
        <h3>${escapeHtml(reference.label || reference.target_type)}</h3>
        <p class="quality-muted">${escapeHtml(reference.target_type_label || reference.target_type)} - ${escapeHtml(reference.target_label || '-')}</p>
        ${reference.target_url ? `<button class="btn btn-secondary" type="button" data-open-reference="${escapeHtml(reference.target_url)}">Ouvrir</button>` : ''}
        ${state.editMode && canEdit ? `<button class="btn btn-secondary" type="button" data-archive-reference="${escapeHtml(reference.id)}">Archiver</button>` : ''}
      </article>
    `).join('') : '<div class="quality-empty-state">Aucune reference entrante.</div>';
  }

  async function load(selectedId = null) {
    setFeedback('Chargement...');
    const params = new URLSearchParams({ include_archived: 'true', limit: '200' });
    if (els.filterType.value) params.set('document_type', els.filterType.value);
    if (els.filterStatus.value) params.set('status', els.filterStatus.value);
    if (els.filterValidity.value) params.set('validity', els.filterValidity.value);
    if (els.filterSource.value) params.set('source_type', els.filterSource.value);
    if (els.search.value.trim()) params.set('query', els.search.value.trim());
    const data = await request(`/?${params.toString()}`);
    state.documents = data.documents || [];
    const id = selectedId || state.current?.id || state.documents[0]?.id;
    if (id) {
      const detail = await request(`/${encodeURIComponent(id)}`);
      fillForm(detail.document);
    } else {
      state.editMode = true;
      fillForm(null);
    }
    renderList();
    setFeedback('');
  }

  els.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canEdit) return;
    const id = els.id.value;
    const saved = await request(id ? `/${encodeURIComponent(id)}` : '/', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(formPayload()),
    });
    state.editMode = false;
    await load(saved.document.id);
    setFeedback('Document maitre enregistre.', 'success');
  });

  els.referenceForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canEdit || !state.current?.id) return;
    await request('/references', {
      method: 'POST',
      body: JSON.stringify({
        document_id: state.current.id,
        target_type: els.referenceTargetType.value,
        target_id: els.referenceTargetId.value || null,
        relation_type: els.referenceRelation.value || 'reference',
        label: els.referenceLabel.value,
      }),
    });
    await load(state.current.id);
    els.referenceForm.reset();
    els.referenceRelation.value = 'reference';
    setFeedback('Reference ajoutee.', 'success');
  });

  els.list.addEventListener('click', async (event) => {
    const item = event.target.closest('[data-document-id]');
    if (!item) return;
    const detail = await request(`/${encodeURIComponent(item.dataset.documentId)}`);
    state.editMode = false;
    fillForm(detail.document);
    renderList();
  });
  els.references.addEventListener('click', async (event) => {
    const openButton = event.target.closest('[data-open-reference]');
    if (openButton) {
      window.location.href = openButton.dataset.openReference;
      return;
    }
    const button = event.target.closest('[data-archive-reference]');
    if (!button || !canEdit) return;
    await request(`/references/${encodeURIComponent(button.dataset.archiveReference)}`, { method: 'DELETE' });
    await load(state.current?.id);
    setFeedback('Reference archivee.', 'success');
  });
  els.detail.addEventListener('click', (event) => {
    const openButton = event.target.closest('[data-open-reference]');
    if (openButton) window.location.href = openButton.dataset.openReference;
  });
  els.newButton.addEventListener('click', () => { state.editMode = true; fillForm(null); renderList(); });
  els.editButton.addEventListener('click', () => { state.editMode = true; refreshMode(); });
  els.pdfButton.addEventListener('click', async () => {
    if (!state.current?.id) return;
    try {
      const blob = await requestPdf(`/${encodeURIComponent(state.current.id)}/export-pdf`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });
  els.archiveButton.addEventListener('click', async () => {
    if (!canEdit || !state.current?.id || !window.confirm('Archiver cette fiche maitre ? Le fichier physique ne sera pas supprime.')) return;
    const archived = await request(`/${encodeURIComponent(state.current.id)}`, { method: 'DELETE' });
    await load(archived.document.id);
    setFeedback('Document maitre archive.', 'success');
  });
  els.refresh.addEventListener('click', () => load().catch((error) => setFeedback(error.message, 'error')));
  [els.search, els.filterType, els.filterStatus, els.filterValidity, els.filterSource].forEach((element) => {
    element.addEventListener('input', () => load().catch((error) => setFeedback(error.message, 'error')));
    element.addEventListener('change', () => load().catch((error) => setFeedback(error.message, 'error')));
  });

  Array.from(els.form.elements).forEach((element) => { element.disabled = element.disabled || !canEdit; });
  Array.from(els.referenceForm.elements).forEach((element) => { element.disabled = element.disabled || !canEdit; });
  els.archiveButton.disabled = !canEdit;
  els.newButton.disabled = !canEdit;
  const initialDocumentId = new URLSearchParams(window.location.search).get('document_id');
  load(initialDocumentId).catch((error) => setFeedback(error.message, 'error'));
})();
