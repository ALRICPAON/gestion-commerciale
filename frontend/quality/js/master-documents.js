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
    referenceTargetSearch: $('master-reference-target-search'),
    referenceTargetId: $('master-reference-target-id'),
    referenceRelation: $('master-reference-relation'),
    referenceLabel: $('master-reference-label'),
    attachmentForm: $('master-attachment-form'),
    attachmentSearch: $('master-attachment-search'),
    attachmentId: $('master-attachment-id'),
  };

  let state = { documents: [], current: null, editMode: false, targets: [], attachments: [] };

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

  function formatSize(value) {
    const size = Number(value);
    if (!Number.isFinite(size) || size <= 0) return '-';
    if (size < 1024) return `${size} o`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} Ko`;
    return `${(size / 1024 / 1024).toFixed(1)} Mo`;
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
    loadReferenceTargets().catch((error) => setFeedback(error.message, 'error'));
    loadExistingAttachments().catch((error) => setFeedback(error.message, 'error'));
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
    const fileName = document.original_filename || document.storage_path || '';
    const activeRefs = (document.references || []).filter((reference) => !reference.archived_at);
    const archivedRefs = (document.references || []).filter((reference) => reference.archived_at);
    els.detail.innerHTML = `
      <section class="quality-card quality-master-section">
        <div class="quality-section-header">
          <h3>Informations du document</h3>
          <span class="quality-badge">${escapeHtml(statusLabel(document.status))}</span>
        </div>
        <dl class="quality-definition-grid">
          <div><dt>Titre</dt><dd>${escapeHtml(document.title || '-')}</dd></div>
          <div><dt>Type</dt><dd>${escapeHtml(typeLabel(document.document_type))}</dd></div>
          <div><dt>Reference</dt><dd>${escapeHtml(document.reference_number || '-')}</dd></div>
          <div><dt>Emetteur</dt><dd>${escapeHtml(document.issuer_name || document.source_type || '-')}</dd></div>
          <div><dt>Date</dt><dd>${escapeHtml(formatDate(document.issue_date))}</dd></div>
          <div><dt>Version</dt><dd>${escapeHtml(document.version || '-')}</dd></div>
        </dl>
      </section>
      <section class="quality-card quality-master-section">
        <h3>Fichier associe</h3>
        <dl class="quality-definition-grid">
          <div><dt>Fichier</dt><dd>${escapeHtml(fileName || 'Aucun fichier associe')}</dd></div>
          <div><dt>MIME</dt><dd>${escapeHtml(document.mime_type || '-')}</dd></div>
          <div><dt>Taille</dt><dd>${escapeHtml(formatSize(document.file_size))}</dd></div>
          <div><dt>Source</dt><dd>${escapeHtml(document.source_attachment_table ? 'Piece existante liee' : 'Fiche sans piece source')}</dd></div>
        </dl>
      </section>
      <section class="quality-card quality-master-section">
        <h3>Rattachements</h3>
        ${activeRefs.length ? `<div class="quality-list-grid">${activeRefs.map(renderReferenceCard).join('')}</div>` : '<div class="quality-empty-state">Aucun rattachement actif.</div>'}
      </section>
      <section class="quality-card quality-master-section">
        <h3>Historique / statut</h3>
        <p class="quality-muted">Cree le ${escapeHtml(formatDate(document.created_at))} - Mis a jour le ${escapeHtml(formatDate(document.updated_at))}${document.archived_at ? ` - Archive le ${escapeHtml(formatDate(document.archived_at))}` : ''}</p>
        ${archivedRefs.length ? `<p class="quality-muted">${archivedRefs.length} rattachement(s) retire(s) conserves dans l'historique.</p>` : ''}
      </section>
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

  function renderReferenceCard(reference) {
    return `
      <article class="quality-card quality-reference-card">
        <span class="quality-badge">${escapeHtml(reference.relation_type || 'reference')}</span>
        <h4>${escapeHtml(reference.target_label || reference.label || reference.target_type_label || reference.target_type || '-')}</h4>
        <p class="quality-muted">${escapeHtml(reference.target_type_label || reference.target_type || '-')} ${reference.label ? `- ${escapeHtml(reference.label)}` : ''}</p>
        <div class="quality-actions">
          ${reference.target_url ? `<button class="btn btn-secondary" type="button" data-open-reference="${escapeHtml(reference.target_url)}">Ouvrir</button>` : ''}
          ${state.editMode && canEdit && !reference.archived_at ? `<button class="btn btn-secondary" type="button" data-archive-reference="${escapeHtml(reference.id)}">Retirer le rattachement</button>` : ''}
        </div>
      </article>
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
    const active = references.filter((reference) => !reference.archived_at);
    els.references.innerHTML = active.length ? active.map(renderReferenceCard).join('') : '<div class="quality-empty-state">Aucun rattachement actif.</div>';
  }

  function renderTargetOptions(targets = []) {
    els.referenceTargetId.innerHTML = targets.length
      ? targets.map((target) => `<option value="${escapeHtml(target.id)}">${escapeHtml(target.target_label || target.label || target.title || target.name)}</option>`).join('')
      : '<option value="">Aucune cible trouvee</option>';
  }

  function renderAttachmentOptions(attachments = []) {
    els.attachmentId.innerHTML = attachments.length
      ? attachments.map((attachment) => `<option value="${escapeHtml(attachment.id)}" data-source-type="${escapeHtml(attachment.source_type)}">${escapeHtml(attachment.display_label || attachment.name || attachment.original_filename || 'Piece jointe')}</option>`).join('')
      : '<option value="">Aucune piece eligible trouvee</option>';
  }

  async function loadReferenceTargets() {
    const params = new URLSearchParams({
      target_type: els.referenceTargetType.value,
      limit: '75',
    });
    if (els.referenceTargetSearch.value.trim()) params.set('query', els.referenceTargetSearch.value.trim());
    const data = await request(`/reference-targets?${params.toString()}`);
    state.targets = data.targets || [];
    renderTargetOptions(state.targets);
  }

  async function loadExistingAttachments() {
    const params = new URLSearchParams({ limit: '75' });
    if (els.attachmentSearch.value.trim()) params.set('query', els.attachmentSearch.value.trim());
    const data = await request(`/existing-attachments?${params.toString()}`);
    state.attachments = data.attachments || [];
    renderAttachmentOptions(state.attachments);
  }

  async function load(selectedId = null) {
    setFeedback('Chargement...');
    const params = new URLSearchParams({ limit: '200' });
    if (els.filterStatus.value === 'archived') params.set('include_archived', 'true');
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
        target_id: els.referenceTargetId.value,
        relation_type: els.referenceRelation.value || 'reference',
        label: els.referenceLabel.value,
      }),
    });
    await load(state.current.id);
    els.referenceForm.reset();
    els.referenceRelation.value = 'reference';
    setFeedback('Rattachement ajoute.', 'success');
  });

  els.attachmentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canEdit || !state.current?.id || !els.attachmentId.value) return;
    const selected = els.attachmentId.selectedOptions[0];
    if (!window.confirm('Associer cette piece existante a la fiche ? Aucun fichier physique ne sera duplique.')) return;
    const saved = await request(`/${encodeURIComponent(state.current.id)}/file-from-attachment`, {
      method: 'PATCH',
      body: JSON.stringify({
        source_type: selected?.dataset.sourceType,
        source_id: els.attachmentId.value,
      }),
    });
    await load(saved.document.id);
    setFeedback('Fichier existant associe sans duplication.', 'success');
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
    if (!window.confirm('Retirer uniquement ce rattachement ? Le document, le fichier et les autres rattachements seront conserves.')) return;
    await request(`/references/${encodeURIComponent(button.dataset.archiveReference)}`, { method: 'DELETE' });
    await load(state.current?.id);
    setFeedback('Rattachement retire.', 'success');
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
  els.referenceTargetType.addEventListener('change', () => loadReferenceTargets().catch((error) => setFeedback(error.message, 'error')));
  els.referenceTargetSearch.addEventListener('input', () => loadReferenceTargets().catch((error) => setFeedback(error.message, 'error')));
  els.attachmentSearch.addEventListener('input', () => loadExistingAttachments().catch((error) => setFeedback(error.message, 'error')));
  [els.search, els.filterType, els.filterStatus, els.filterValidity, els.filterSource].forEach((element) => {
    element.addEventListener('input', () => load().catch((error) => setFeedback(error.message, 'error')));
    element.addEventListener('change', () => load().catch((error) => setFeedback(error.message, 'error')));
  });

  Array.from(els.form.elements).forEach((element) => { element.disabled = element.disabled || !canEdit; });
  Array.from(els.referenceForm.elements).forEach((element) => { element.disabled = element.disabled || !canEdit; });
  Array.from(els.attachmentForm.elements).forEach((element) => { element.disabled = element.disabled || !canEdit; });
  els.archiveButton.disabled = !canEdit;
  els.newButton.disabled = !canEdit;
  const searchParams = new URLSearchParams(window.location.search);
  const initialDocumentId = searchParams.get('document_id') || searchParams.get('id');
  load(initialDocumentId).catch((error) => setFeedback(error.message, 'error'));
})();
