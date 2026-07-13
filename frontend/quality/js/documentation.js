(function () {
  const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';
  const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const authToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  if (!sessionUser || !authToken) {
    window.location.href = '../../login.html';
    return;
  }

  const canRead = window.hasQualityPermission?.(sessionUser, 'quality.document.read') || window.hasQualityPermission?.(sessionUser, 'quality.read');
  const canEdit = window.hasQualityPermission?.(sessionUser, 'quality.document.edit') || window.hasQualityPermission?.(sessionUser, 'quality.document.manage');
  const canExport = window.hasQualityPermission?.(sessionUser, 'quality.document.export') || window.hasQualityPermission?.(sessionUser, 'quality.inspection.export');
  if (!canRead) {
    window.location.href = '../../home.html';
    return;
  }

  const $ = (id) => document.getElementById(id);
  const els = {
    title: $('documentation-title'),
    feedback: $('documentation-feedback'),
    tree: $('section-tree'),
    search: $('doc-search'),
    add: $('add-section-btn'),
    code: $('section-code'),
    heading: $('section-title-heading'),
    statusBadge: $('section-status-badge'),
    titleInput: $('section-title'),
    editor: $('section-editor'),
    status: $('section-status'),
    version: $('section-version'),
    parent: $('section-parent'),
    order: $('section-order'),
    revision: $('section-revision'),
    includeExport: $('section-include-export'),
    references: $('section-references'),
    comment: $('section-comment'),
    moveUp: $('move-up-btn'),
    moveDown: $('move-down-btn'),
    deleteSection: $('delete-section-btn'),
    mergeTarget: $('merge-target'),
    mergeSection: $('merge-section-btn'),
    save: $('save-section-btn'),
    saveNext: $('save-next-btn'),
    review: $('review-section-btn'),
    validate: $('validate-section-btn'),
    markMissing: $('mark-missing-btn'),
    textColor: $('text-color-select'),
    preview: $('preview-pdf-btn'),
    exportPdf: $('export-pdf-btn'),
    missing: $('missing-list'),
    attachmentForm: $('attachment-form'),
    attachmentFile: $('attachment-file'),
    attachmentInclude: $('attachment-include'),
    attachments: $('attachment-list'),
  };

  let state = { collection: null, sections: [], missing: [], attachments: [], currentId: null, dirty: false, filter: 'all' };

  function setFeedback(message = '', type = '') {
    els.feedback.textContent = message;
    els.feedback.className = message ? `page-feedback ${type}`.trim() : 'page-feedback hidden';
  }

  function headers(extra = {}) {
    return { Authorization: `Bearer ${authToken}`, ...extra };
  }

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}/api/quality/documentation${path}`, {
      ...options,
      headers: headers(options.headers || {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur documentation qualite');
    return data;
  }

  async function requestPdf(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}/api/quality/documentation${path}`, {
      ...options,
      headers: headers({ 'Content-Type': 'application/json', ...(options.headers || {}) }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Erreur export PDF');
    }
    return response.blob();
  }

  function currentSection() {
    return state.sections.find((section) => section.id === state.currentId) || null;
  }

  function childrenOf(parentId) {
    return state.sections.filter((section) => section.parent_id === parentId && !section.archived_at);
  }

  function activeSections() {
    return state.sections.filter((section) => !section.archived_at);
  }

  function descendantsOf(sectionId) {
    const descendants = new Set();
    const visit = (parentId) => {
      childrenOf(parentId).forEach((child) => {
        descendants.add(child.id);
        visit(child.id);
      });
    };
    visit(sectionId);
    return descendants;
  }

  function sectionLabel(section) {
    return `${section.code} - ${section.title}`;
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    }[char]));
  }

  function renderMetrics(dashboard = {}) {
    $('metric-tomes').textContent = dashboard.tome_count ?? '-';
    $('metric-chapters').textContent = dashboard.chapter_count ?? '-';
    $('metric-validated').textContent = dashboard.validated_count ?? '-';
    $('metric-missing').textContent = dashboard.to_complete_count ?? '-';
    $('metric-attachments').textContent = dashboard.attachment_count ?? '-';
    $('metric-completion').textContent = `${dashboard.completion_percent ?? 0} %`;
  }

  function renderTree() {
    const query = els.search.value.trim().toLowerCase();
    const visible = state.sections.filter((section) => {
      const text = `${section.code} ${section.title} ${section.content_text || ''} ${section.regulatory_references || ''}`.toLowerCase();
      return !section.archived_at && (!query || text.includes(query));
    });
    const visibleIds = new Set(visible.map((section) => section.id));
    const html = state.sections
      .filter((section) => section.section_type === 'tome' && !section.archived_at && (!query || visibleIds.has(section.id) || childrenOf(section.id).some((child) => visibleIds.has(child.id))))
      .map((tome) => {
        const chapters = childrenOf(tome.id).filter((chapter) => !query || visibleIds.has(chapter.id));
        return `<div class="quality-doc-tome">
          <button class="${state.currentId === tome.id ? 'active' : ''}" data-section-id="${tome.id}" type="button"><strong>${tome.code}</strong> ${tome.title}</button>
          ${chapters.map((chapter) => `<button class="chapter ${state.currentId === chapter.id ? 'active' : ''}" data-section-id="${chapter.id}" type="button"><span>${chapter.code}</span> ${chapter.title}</button>`).join('')}
        </div>`;
      }).join('');
    els.tree.innerHTML = html || '<div class="quality-empty-state">Aucun chapitre trouve.</div>';
  }

  function renderMissing() {
    const now = new Date().toISOString().slice(0, 10);
    let items = state.missing.filter((item) => item.status !== 'resolved');
    if (state.filter === 'blocking') items = items.filter((item) => item.severity === 'blocking');
    if (state.filter === 'before_submission') items = items.filter((item) => item.severity === 'before_submission');
    if (state.filter === 'overdue') items = items.filter((item) => item.due_at && item.due_at < now);
    els.missing.innerHTML = items.map((item) => `<article class="quality-doc-mini ${item.section_id === state.currentId ? 'active' : ''}">
      <strong>${item.section_code || ''} ${item.section_title || ''}</strong>
      <p>${item.description}</p>
      <small>${item.severity} ${item.due_at ? `- ${item.due_at}` : ''}</small>
      <div class="quality-actions"><button class="btn btn-secondary" data-open-section="${item.section_id}" type="button">Ouvrir</button><button class="btn btn-secondary" data-resolve-missing="${item.id}" type="button">Resoudre</button></div>
    </article>`).join('') || '<p class="quality-muted">Aucune information manquante ouverte.</p>';
  }

  function renderAttachments() {
    const attachments = state.attachments.filter((item) => item.section_id === state.currentId && !item.archived_at);
    els.attachments.innerHTML = attachments.map((item) => `<article class="quality-doc-mini">
      <strong>${item.filename}</strong>
      <small>${item.mime_type || ''}</small>
      <div class="quality-actions"><button class="btn btn-secondary" data-download-attachment="${item.id}" type="button">Telecharger</button><button class="btn btn-secondary" data-delete-attachment="${item.id}" type="button">Archiver</button></div>
    </article>`).join('') || '<p class="quality-muted">Aucune piece jointe.</p>';
  }

  function renderStructureControls(section) {
    const descendants = descendantsOf(section.id);
    const parentOptions = activeSections()
      .filter((item) => item.id !== section.id && !descendants.has(item.id))
      .map((item) => `<option value="${item.id}">${sectionLabel(item)}</option>`)
      .join('');
    els.parent.innerHTML = `<option value="">Aucun parent / Tome racine</option>${parentOptions}`;
    els.parent.value = section.parent_id || '';
    els.parent.disabled = !canEdit;

    const mergeOptions = activeSections()
      .filter((item) => item.id !== section.id && item.collection_id === section.collection_id)
      .map((item) => `<option value="${item.id}">${sectionLabel(item)}</option>`)
      .join('');
    els.mergeTarget.innerHTML = mergeOptions || '<option value="">Aucun chapitre cible</option>';
    els.mergeTarget.disabled = !canEdit || !mergeOptions;
    els.mergeSection.disabled = !canEdit || !mergeOptions;
  }

  function renderEditor() {
    const section = currentSection();
    const disabled = !section || !canEdit;
    [els.titleInput, els.editor, els.status, els.version, els.parent, els.order, els.revision, els.includeExport, els.references, els.comment, els.textColor, els.save, els.saveNext, els.review, els.validate, els.markMissing, els.moveUp, els.moveDown, els.deleteSection].forEach((el) => {
      if (!el) return;
      if ('disabled' in el) el.disabled = disabled;
      if (el === els.editor) el.setAttribute('contenteditable', disabled ? 'false' : 'true');
    });
    document.querySelectorAll('[data-text-color]').forEach((button) => { button.disabled = disabled; });
    if (!section) return;
    els.code.textContent = section.code;
    els.heading.textContent = section.title;
    els.statusBadge.textContent = section.status;
    els.titleInput.value = section.title || '';
    els.editor.innerHTML = section.content_html || '';
    els.status.value = section.status || 'draft';
    els.version.value = section.version || '1.0';
    els.order.value = Number.isFinite(Number(section.display_order)) ? Number(section.display_order) : 0;
    els.revision.value = section.revision_due_at ? section.revision_due_at.slice(0, 10) : '';
    els.includeExport.checked = section.include_in_export !== false;
    els.references.value = section.regulatory_references || '';
    els.comment.value = section.comment_internal || '';
    renderStructureControls(section);
    state.dirty = false;
    renderMissing();
    renderAttachments();
  }

  async function load(selectId = null) {
    setFeedback('Chargement de la documentation...');
    const data = await request('/default');
    state.collection = data.collection;
    state.sections = data.sections;
    state.missing = data.missing_items;
    state.attachments = data.attachments;
    state.currentId = selectId || state.currentId || state.sections.find((section) => section.section_type !== 'tome')?.id || state.sections[0]?.id || null;
    els.title.textContent = state.collection.title;
    renderMetrics(data.dashboard);
    renderTree();
    renderEditor();
    setFeedback('');
  }

  function payload(extra = {}) {
    return {
      title: els.titleInput.value,
      content_html: els.editor.innerHTML,
      status: els.status.value,
      version: els.version.value,
      parent_id: els.parent.value || null,
      display_order: Number(els.order.value || 0),
      revision_due_at: els.revision.value || null,
      include_in_export: els.includeExport.checked,
      regulatory_references: els.references.value,
      comment_internal: els.comment.value,
      ...extra,
    };
  }

  async function save(extra = {}) {
    const section = currentSection();
    if (!section || !canEdit) return null;
    const updated = await request(`/sections/${section.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload(extra)),
    });
    await load(updated.id);
    return updated;
  }

  async function updateSectionOnly(sectionId, body) {
    return request(`/sections/${sectionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function moveCurrent(direction) {
    const section = currentSection();
    if (!section || !canEdit) return;
    const siblings = activeSections()
      .filter((item) => item.parent_id === section.parent_id && item.section_type === section.section_type)
      .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
    const index = siblings.findIndex((item) => item.id === section.id);
    const sibling = siblings[index + direction];
    if (!sibling) return;
    const currentOrder = section.display_order;
    await save({ display_order: sibling.display_order, change_summary: direction < 0 ? 'Deplacement du chapitre vers le haut' : 'Deplacement du chapitre vers le bas' });
    await updateSectionOnly(sibling.id, { display_order: currentOrder, change_summary: 'Reordonnancement documentaire' });
    await load(section.id);
  }

  async function openPdf(path, download = false) {
    const blob = await requestPdf(path, {
      method: 'POST',
      body: JSON.stringify({ export_type: 'full', include_missing: true, include_attachments: true }),
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    if (download) link.download = 'Manuel_Qualite_ALTA_MAREE.pdf';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function openProtectedAttachment(id) {
    const response = await fetch(`${API_BASE_URL}/api/quality/documentation/attachments/${id}/download`, { headers: headers() });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Piece jointe introuvable');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function applyTextColor(color) {
    if (!color || !canEdit) return;
    els.editor.focus();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('foreColor', false, color);
    state.dirty = true;
  }

  document.querySelectorAll('[data-command]').forEach((button) => {
    button.addEventListener('click', () => document.execCommand(button.dataset.command, false, null));
  });
  document.querySelectorAll('[data-text-color]').forEach((button) => {
    button.addEventListener('click', () => applyTextColor(button.dataset.textColor));
  });
  els.textColor.addEventListener('change', () => {
    applyTextColor(els.textColor.value);
    els.textColor.value = '';
  });
  [els.titleInput, els.editor, els.status, els.version, els.parent, els.order, els.revision, els.includeExport, els.references, els.comment].forEach((el) => {
    el.addEventListener('input', () => { state.dirty = true; });
    el.addEventListener('change', () => { state.dirty = true; });
  });
  els.tree.addEventListener('click', (event) => {
    const button = event.target.closest('[data-section-id]');
    if (!button) return;
    if (state.dirty && !window.confirm('Des modifications ne sont pas enregistrees. Continuer ?')) return;
    state.currentId = button.dataset.sectionId;
    renderTree();
    renderEditor();
  });
  els.search.addEventListener('input', renderTree);
  els.save.addEventListener('click', () => save().catch((error) => setFeedback(error.message, 'error')));
  els.saveNext.addEventListener('click', async () => {
    try {
      await save();
      const chapters = state.sections.filter((section) => section.section_type !== 'tome' && !section.archived_at);
      const index = chapters.findIndex((section) => section.id === state.currentId);
      state.currentId = chapters[index + 1]?.id || chapters[0]?.id || state.currentId;
      renderTree();
      renderEditor();
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });
  els.review.addEventListener('click', () => save({ status: 'ready_for_review', change_summary: 'Envoi en relecture' }).catch((error) => setFeedback(error.message, 'error')));
  els.validate.addEventListener('click', () => save({ status: 'validated', change_summary: 'Validation documentaire' }).catch((error) => setFeedback(error.message, 'error')));
  els.moveUp.addEventListener('click', () => moveCurrent(-1).catch((error) => setFeedback(error.message, 'error')));
  els.moveDown.addEventListener('click', () => moveCurrent(1).catch((error) => setFeedback(error.message, 'error')));
  els.deleteSection.addEventListener('click', async () => {
    const section = currentSection();
    if (!section || !canEdit || !window.confirm(`Supprimer le chapitre "${section.title}" ? Il sera archive et masque de l'export.`)) return;
    try {
      await request(`/sections/${section.id}`, { method: 'DELETE' });
      const next = activeSections().find((item) => item.id !== section.id)?.id || null;
      await load(next);
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });
  els.mergeSection.addEventListener('click', async () => {
    const section = currentSection();
    const targetId = els.mergeTarget.value;
    if (!section || !targetId || !canEdit) return;
    const target = state.sections.find((item) => item.id === targetId);
    if (!target || !window.confirm(`Fusionner "${section.title}" dans "${target.title}" ? Le chapitre source sera archive.`)) return;
    try {
      const merged = await request(`/sections/${section.id}/merge-into/${targetId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Fusion depuis l interface documentaire' }),
      });
      await load(merged.id);
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });
  els.markMissing.addEventListener('click', async () => {
    const selectedText = window.getSelection().toString().trim();
    const selection = selectedText || window.prompt('Information a completer');
    if (!selection) return;
    if (selectedText) {
      applyTextColor('#b42318');
    } else {
      els.editor.focus();
      document.execCommand('insertHTML', false, `<span class="missing-info" style="color: #b42318; font-weight: 700;">${escapeHtml(selection)}</span>`);
      state.dirty = true;
    }
    await request('/missing-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section_id: state.currentId, description: selection, severity: 'before_submission' }),
    });
    await save({ status: 'to_complete', change_summary: 'Ajout information a completer' });
  });
  els.add.addEventListener('click', async () => {
    const parent = currentSection();
    const title = window.prompt('Titre du nouveau chapitre');
    if (!title || !parent) return;
    const code = `${parent.code || 'DOC'}-${Date.now().toString().slice(-4)}`;
    try {
      const created = await request(`/${state.collection.id}/sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent_id: parent.section_type === 'tome' ? parent.id : parent.parent_id, title, code, section_type: 'chapter', status: 'draft', display_order: parent.display_order + 1 }),
      });
      await load(created.id);
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });
  document.querySelectorAll('[data-missing-filter]').forEach((button) => button.addEventListener('click', () => {
    state.filter = button.dataset.missingFilter;
    renderMissing();
  }));
  els.missing.addEventListener('click', async (event) => {
    const open = event.target.closest('[data-open-section]');
    const resolve = event.target.closest('[data-resolve-missing]');
    if (open) {
      state.currentId = open.dataset.openSection;
      renderTree();
      renderEditor();
    }
    if (resolve) {
      await request(`/missing-items/${resolve.dataset.resolveMissing}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      });
      await load(state.currentId);
    }
  });
  els.attachmentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canEdit || !state.currentId || !els.attachmentFile.files[0]) return;
    const formData = new FormData();
    formData.set('file', els.attachmentFile.files[0]);
    formData.set('include_in_export', els.attachmentInclude.checked ? 'true' : 'false');
    const response = await fetch(`${API_BASE_URL}/api/quality/documentation/sections/${state.currentId}/attachments`, { method: 'POST', headers: headers(), body: formData });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Erreur piece jointe');
    }
    els.attachmentForm.reset();
    els.attachmentInclude.checked = true;
    await load(state.currentId);
  });
  els.attachments.addEventListener('click', async (event) => {
    const download = event.target.closest('[data-download-attachment]');
    const archive = event.target.closest('[data-delete-attachment]');
    if (download) await openProtectedAttachment(download.dataset.downloadAttachment);
    if (archive && window.confirm('Archiver cette piece jointe ?')) {
      await request(`/attachments/${archive.dataset.deleteAttachment}`, { method: 'DELETE' });
      await load(state.currentId);
    }
  });
  els.preview.disabled = !canExport;
  els.exportPdf.disabled = !canExport;
  els.preview.addEventListener('click', () => openPdf(`/${state.collection.id}/preview`, false).catch((error) => setFeedback(error.message, 'error')));
  els.exportPdf.addEventListener('click', () => openPdf(`/${state.collection.id}/export-pdf`, true).catch((error) => setFeedback(error.message, 'error')));
  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  load().catch((error) => setFeedback(error.message, 'error'));
})();
