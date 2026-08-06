(function () {
  const user = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  if (!user || !token) { window.location.href = '../../login.html'; return; }

  const api = window.QualityOperationsApi;
  const temperatureApi = window.QualityTemperatureApi;
  const cleaningApi = window.QualityCleaningApi;
  const formHelper = window.QualityExecutionForms;
  const canRecord = window.hasQualityPermission?.(user, 'quality.record.create');
  const $ = (id) => document.getElementById(id);
  const els = {
    feedback: $('quality-today-feedback'),
    summary: $('quality-today-summary'),
    today: $('quality-work-today'),
    overdue: $('quality-work-overdue'),
    upcoming: $('quality-work-upcoming'),
    events: $('quality-work-events'),
    completed: $('quality-work-completed'),
    nc: $('quality-work-nc'),
    panel: $('quality-execution-panel'),
    temperatureForm: $('quality-temperature-execution-form'),
    cleaningForm: $('quality-cleaning-execution-form'),
    documentLinks: $('quality-today-document-links'),
    manualForm: $('quality-manual-execution-form'),
    title: $('quality-execution-title'),
    context: $('quality-execution-context'),
    manualOccurrenceId: $('quality-manual-occurrence-id'),
    manualTaskId: $('quality-manual-task-id'),
    manualResult: $('quality-manual-result'),
    manualConformity: $('quality-manual-conformity'),
    manualAt: $('quality-manual-at'),
    manualOperator: $('quality-manual-operator'),
    manualComment: $('quality-manual-comment'),
    manualCorrective: $('quality-manual-corrective'),
    manualEvidencePhotoId: $('quality-manual-evidence-photo-id'),
    manualEvidenceDocumentId: $('quality-manual-evidence-document-id'),
    manualEvidencePhotoFile: $('quality-manual-evidence-photo-file'),
    manualEvidenceDocumentFile: $('quality-manual-evidence-document-file'),
    manualEvidencePhotoPreview: $('quality-manual-evidence-photo-preview'),
    manualEvidenceDocumentPreview: $('quality-manual-evidence-document-preview'),
    manualAlert: $('quality-manual-alert'),
    cancel: $('quality-execution-panel-cancel'),
  };
  let work = null;
  let temperatureForm = null;
  let cleaningForm = null;
  let currentItem = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function setFeedback(message = '', type = '') {
    els.feedback.textContent = message;
    els.feedback.className = message ? `page-feedback ${type}`.trim() : 'page-feedback hidden';
  }

  function formatDate(value) {
    return value ? new Date(value).toLocaleString('fr-FR') : '-';
  }

  function statusClass(status, conformity) {
    if (['overdue', 'late'].includes(status) || conformity === 'non_conform') return 'quality-temperature-alert';
    if (status === 'due') return 'quality-temperature-warning';
    if (status === 'completed') return 'quality-temperature-ok';
    return '';
  }

  function typeLabel(type) {
    return { temperature: 'Temperature', cleaning: 'Nettoyage', manual: 'Tache manuelle', control: 'Controle' }[type] || 'Controle';
  }

  function resultLabel(item) {
    if (item.type === 'temperature' && item.value !== null && item.value !== undefined) return `${item.value} ${item.unit || ''} - ${item.conformity_status || item.result_status || ''}`;
    return item.conformity_status || item.result_status || item.status || '-';
  }

  function detailType(item) {
    return item.detail_type || item.record_type || (item.type === 'manual' ? 'manual_task' : item.type);
  }

  function sectionHtml(items, emptyText) {
    if (!items?.length) return `<div class="quality-empty-state">${escapeHtml(emptyText)}</div>`;
    return items.map((item) => `
      <article class="quality-card ${statusClass(item.status, item.conformity_status)}">
        <span class="quality-badge">${escapeHtml(typeLabel(item.type))}</span>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.zone_name || '-')} - ${escapeHtml(item.equipment_name || '-')} - ${escapeHtml(item.target_time || 'Evenement')}</p>
        <p class="quality-muted">${item.status === 'completed' ? `Resultat : ${escapeHtml(resultLabel(item))} - Operateur : ${escapeHtml(item.operator_email || '-')}` : `Echeance : ${formatDate(item.next_due_at)} - Criticite : ${escapeHtml(item.criticality || '-')}`}</p>
        <div class="quality-actions">${item.status === 'completed'
          ? (item.record_id ? `<button class="btn btn-secondary" type="button" data-action="view-record" data-record-type="${escapeHtml(detailType(item))}" data-record-id="${escapeHtml(item.record_id)}">Voir</button>` : '<button class="btn btn-secondary" type="button" disabled>Voir</button>')
          : `<button class="btn btn-primary" data-action="execute" data-id="${escapeHtml(item.id)}">${escapeHtml(item.primary_action)}</button>`}</div>
      </article>
    `).join('');
  }

  function renderSummary(summary) {
    const done = summary.completed_today || 0;
    const total = done + (summary.today || 0) + (summary.overdue || 0);
    els.summary.innerHTML = [
      ['Progression', total ? `${done}/${total}` : '0/0'],
      ['A faire', summary.today],
      ['En retard', summary.overdue],
      ['Realises', summary.completed_today],
      ['Non-conformites', summary.open_non_conformities],
    ].map(([label, value]) => `<article class="quality-card"><span class="quality-badge">${escapeHtml(label)}</span><h3>${value || 0}</h3></article>`).join('');
  }

  function render() {
    renderSummary(work.summary || {});
    els.today.innerHTML = sectionHtml(work.sections.today, 'Aucun controle a faire maintenant.');
    els.overdue.innerHTML = sectionHtml(work.sections.overdue, 'Aucun retard.');
    els.upcoming.innerHTML = sectionHtml(work.sections.upcoming, 'Aucun controle a venir.');
    els.events.innerHTML = sectionHtml(work.sections.event_controls, 'Aucun controle evenementiel.');
    els.completed.innerHTML = sectionHtml(work.sections.completed_today, 'Aucun controle realise aujourd hui.');
    els.nc.innerHTML = work.sections.non_conformities?.length
      ? work.sections.non_conformities.map((item) => `<article class="quality-card quality-temperature-alert"><span class="quality-badge">${escapeHtml(item.severity)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><p class="quality-muted">${formatDate(item.created_at)}</p></article>`).join('')
      : '<div class="quality-empty-state">Aucune non-conformite ouverte.</div>';
    if (!canRecord) document.querySelectorAll('button[data-action="execute"]').forEach((button) => { button.disabled = true; });
  }

  function findItem(id) {
    return ['today', 'overdue', 'upcoming', 'event_controls'].flatMap((key) => work.sections[key] || []).find((item) => String(item.id) === String(id));
  }

  function toDatetimeLocal(value) {
    const date = value ? new Date(value) : new Date();
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function showOnlyForm(type) {
    els.temperatureForm.classList.toggle('hidden', type !== 'temperature');
    els.cleaningForm.classList.toggle('hidden', type !== 'cleaning');
    els.manualForm.classList.toggle('hidden', !['manual', 'control'].includes(type));
  }

  function openExecution(item) {
    currentItem = item;
    els.title.textContent = item.primary_action;
    els.context.textContent = `${item.title} - ${item.zone_name || '-'} - ${item.equipment_name || '-'} - ${formatDate(item.next_due_at)}`;
    showOnlyForm(item.type);
    if (item.type === 'temperature') {
      temperatureForm.setContext({
        ...item.raw,
        locked: Boolean(item.source_entity_id),
        quality_task_id: item.quality_task_id,
        occurrence_id: item.occurrence_id,
        parameter_id: item.source_entity_id,
        type_code: item.raw?.type_code,
        zone_id: item.zone_id || item.raw?.zone_id,
        equipment_id: item.equipment_id || item.raw?.equipment_id,
        min_limit: item.raw?.min_value ?? item.raw?.min_limit,
        max_limit: item.raw?.max_value ?? item.raw?.max_limit,
        unit: item.raw?.unit || item.unit || 'C',
        recorded_at: new Date().toISOString(),
        comment: item.task_title ? `Controle attendu : ${item.task_title}` : '',
      });
    } else if (item.type === 'cleaning') {
      cleaningForm.setContext({
        ...item.raw,
        locked: true,
        plan: item.raw,
        cleaning_plan_id: item.source_entity_id,
        quality_task_id: item.quality_task_id,
        occurrence_id: item.occurrence_id,
        ended_at: new Date().toISOString(),
        comment: item.task_title ? `Controle attendu : ${item.task_title}` : '',
      });
    } else {
      els.manualForm.reset();
      els.manualOccurrenceId.value = item.occurrence_id || '';
      els.manualTaskId.value = item.quality_task_id || '';
      els.manualAt.value = toDatetimeLocal();
      els.manualOperator.value = user.email || user.name || 'Utilisateur connecte';
      els.manualEvidencePhotoId.value = '';
      els.manualEvidenceDocumentId.value = '';
      els.manualEvidencePhotoFile.value = '';
      els.manualEvidenceDocumentFile.value = '';
      els.manualEvidencePhotoPreview.textContent = 'Aucune photo selectionnee.';
      els.manualEvidenceDocumentPreview.textContent = 'Aucun document selectionne.';
      els.manualAlert.className = 'page-feedback hidden quality-form-wide';
    }
    els.panel.classList.remove('hidden');
    const recordType = detail.type === 'cleaning' ? 'cleaning_record' : detail.type === 'temperature' ? 'temperature_record' : null;
    if (recordType) {
      window.QualityDocumentLinks?.render(recordType, detail.source?.record_id || id, els.documentLinks, { title: 'Procedures et documents applicables' }).catch(() => {});
    } else {
      els.documentLinks.innerHTML = '';
    }
    els.panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function uploadManualEvidence() {
    const owner = window.QualityProofUploader.ownerFromContext({
      equipment_id: currentItem?.equipment_id || currentItem?.raw?.equipment_id || '',
      zone_id: currentItem?.zone_id || currentItem?.raw?.zone_id || '',
      quality_task_id: currentItem?.quality_task_id || '',
      occurrence_id: currentItem?.occurrence_id || '',
      source_entity_type: currentItem?.source_entity_type || '',
      source_entity_id: currentItem?.source_entity_id || '',
    });
    const result = await window.QualityProofUploader.uploadAll({
      operationsApi: api,
      photoInput: els.manualEvidencePhotoFile,
      documentInput: els.manualEvidenceDocumentFile,
      owner,
      caption: `Preuve ${currentItem?.title || 'controle manuel'}`,
    });
    els.manualEvidencePhotoId.value = result.evidence_photo_id || '';
    els.manualEvidenceDocumentId.value = result.evidence_document_id || '';
    return result.uploaded;
  }

  function showManualAlert(message) {
    els.manualAlert.textContent = message;
    els.manualAlert.className = message ? 'page-feedback error quality-form-wide' : 'page-feedback hidden quality-form-wide';
  }

  async function submitManualExecution(event) {
    event.preventDefault();
    const payload = {
      occurrence_id: els.manualOccurrenceId.value || null,
      quality_task_id: els.manualTaskId.value || null,
      completed_at: els.manualAt.value,
      result_status: els.manualResult.value,
      conformity_status: els.manualConformity.value,
      comment: els.manualComment.value || null,
      corrective_action: els.manualCorrective.value || null,
      evidence_photo_id: els.manualEvidencePhotoId.value || null,
      evidence_document_id: els.manualEvidenceDocumentId.value || null,
    };
    let uploaded = null;
    try {
      uploaded = await uploadManualEvidence();
      payload.evidence_photo_id = els.manualEvidencePhotoId.value || null;
      payload.evidence_document_id = els.manualEvidenceDocumentId.value || null;
      await api.executeManual(payload);
      els.panel.classList.add('hidden');
      await load();
    } catch (error) {
      if (uploaded) await window.QualityProofUploader.cleanupUploaded({ operationsApi: api, uploaded });
      showManualAlert(error.message);
    }
  }

  async function showRecordDetail(type, id) {
    const detail = await api.ddppRecordDetail(type, id);
    showOnlyForm('none');
    els.title.textContent = 'Detail du controle';
    els.context.innerHTML = [
      `Type : ${escapeHtml(detail.type || type)}`,
      `Record : ${escapeHtml(detail.source?.record_id || id)}`,
      detail.task?.title ? `Tache : ${escapeHtml(detail.task.title)}` : null,
      detail.operator ? `Operateur : ${escapeHtml(detail.operator)}` : null,
    ].filter(Boolean).join('<br>');
    els.panel.classList.remove('hidden');
    els.panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function load() {
    setFeedback('Chargement...');
    work = await api.today({ include_upcoming: 'true' });
    render();
    setFeedback('');
  }

  async function initForms() {
    const [types, plans] = await Promise.all([
      temperatureApi.listTypes(),
      cleaningApi.listPlans({ active: 'true' }),
    ]);
    temperatureForm = formHelper.createTemperatureExecutionForm({
      form: els.temperatureForm,
      titleEl: els.title,
      types,
      zones: [],
      equipments: [],
      operationsApi: api,
      user,
      onSubmitted: async () => { els.panel.classList.add('hidden'); await load(); },
      onError: (message) => setFeedback(message, 'error'),
    });
    cleaningForm = formHelper.createCleaningExecutionForm({
      form: els.cleaningForm,
      titleEl: els.title,
      plans,
      operationsApi: api,
      user,
      onSubmitted: async () => { els.panel.classList.add('hidden'); await load(); },
      onError: (message) => setFeedback(message, 'error'),
    });
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action="execute"]');
    const viewButton = event.target.closest('button[data-action="view-record"]');
    if (button) {
      const item = findItem(button.dataset.id);
      if (item) openExecution(item);
    }
    if (viewButton) showRecordDetail(viewButton.dataset.recordType, viewButton.dataset.recordId).catch((error) => setFeedback(error.message, 'error'));
  });
  els.cancel.addEventListener('click', () => els.panel.classList.add('hidden'));
  els.manualForm.addEventListener('submit', submitManualExecution);
  window.QualityProofUploader.bindPreview({
    photoInput: els.manualEvidencePhotoFile,
    photoPreview: els.manualEvidencePhotoPreview,
    documentInput: els.manualEvidenceDocumentFile,
    documentPreview: els.manualEvidenceDocumentPreview,
  });

  initForms().then(load).catch((error) => setFeedback(error.message, 'error'));
})();
