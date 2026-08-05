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
    list: $('master-document-list'),
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
    newButton: $('master-document-new'),
    archiveButton: $('master-document-archive'),
    references: $('master-document-references'),
    referenceForm: $('master-reference-form'),
    referenceTargetType: $('master-reference-target-type'),
    referenceTargetId: $('master-reference-target-id'),
    referenceRelation: $('master-reference-relation'),
    referenceLabel: $('master-reference-label'),
  };

  let state = { documents: [], current: null };

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

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}/api/quality/master-documents${path}`, {
      ...options,
      headers: { ...headers(), ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur referentiel documentaire');
    return data;
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
      description: els.description.value,
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
    els.description.value = document?.description || '';
    renderReferences(document?.references || []);
  }

  function renderList() {
    const query = els.search.value.trim().toLowerCase();
    const rows = state.documents.filter((document) => !query || [document.title, document.reference_number, document.issuer_name].some((value) => String(value || '').toLowerCase().includes(query)));
    els.list.innerHTML = rows.length ? rows.map((document) => `
      <button class="quality-doc-tree-item ${state.current?.id === document.id ? 'active' : ''}" type="button" data-document-id="${escapeHtml(document.id)}">
        <strong>${escapeHtml(document.title)}</strong>
        <span>${escapeHtml(document.document_type)} - ${escapeHtml(document.status)} - ${document.active_reference_count || 0} ref.</span>
      </button>
    `).join('') : '<div class="quality-empty-state">Aucun document maitre.</div>';
  }

  function renderReferences(references = []) {
    els.references.innerHTML = references.length ? references.map((reference) => `
      <article class="quality-card">
        <span class="quality-badge">${escapeHtml(reference.relation_type)}</span>
        <h3>${escapeHtml(reference.label || reference.target_type)}</h3>
        <p class="quality-muted">${escapeHtml(reference.target_type)} ${escapeHtml(reference.target_id || '')}</p>
        <button class="btn btn-secondary" type="button" data-archive-reference="${escapeHtml(reference.id)}">Archiver</button>
      </article>
    `).join('') : '<div class="quality-empty-state">Aucune reference entrante.</div>';
  }

  async function load(selectedId = null) {
    setFeedback('Chargement...');
    const data = await request('/?include_archived=true&limit=200');
    state.documents = data.documents || [];
    const id = selectedId || state.current?.id || state.documents[0]?.id;
    if (id) {
      const detail = await request(`/${encodeURIComponent(id)}`);
      fillForm(detail.document);
    } else {
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
    fillForm(detail.document);
    renderList();
  });
  els.references.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-archive-reference]');
    if (!button || !canEdit) return;
    await request(`/references/${encodeURIComponent(button.dataset.archiveReference)}`, { method: 'DELETE' });
    await load(state.current?.id);
    setFeedback('Reference archivee.', 'success');
  });
  els.newButton.addEventListener('click', () => { fillForm(null); renderList(); });
  els.archiveButton.addEventListener('click', async () => {
    if (!canEdit || !state.current?.id || !window.confirm('Archiver cette fiche maitre ? Le fichier physique ne sera pas supprime.')) return;
    const archived = await request(`/${encodeURIComponent(state.current.id)}`, { method: 'DELETE' });
    await load(archived.document.id);
    setFeedback('Document maitre archive.', 'success');
  });
  els.refresh.addEventListener('click', () => load().catch((error) => setFeedback(error.message, 'error')));
  els.search.addEventListener('input', renderList);

  Array.from(els.form.elements).forEach((element) => { element.disabled = element.disabled || !canEdit; });
  Array.from(els.referenceForm.elements).forEach((element) => { element.disabled = element.disabled || !canEdit; });
  els.archiveButton.disabled = !canEdit;
  els.newButton.disabled = !canEdit;
  load().catch((error) => setFeedback(error.message, 'error'));
})();
