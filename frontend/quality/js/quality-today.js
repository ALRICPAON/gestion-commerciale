(function () {
  const user = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  if (!user || !token) { window.location.href = '../../login.html'; return; }

  const api = window.QualityOperationsApi;
  const canRecord = window.hasQualityPermission?.(user, 'quality.record.create');
  const $ = (id) => document.getElementById(id);
  const els = {
    feedback: $('quality-today-feedback'),
    summary: $('quality-today-summary'),
    today: $('quality-work-today'),
    overdue: $('quality-work-overdue'),
    upcoming: $('quality-work-upcoming'),
    completed: $('quality-work-completed'),
    nc: $('quality-work-nc'),
    panel: $('quality-execution-panel'),
    form: $('quality-execution-form'),
    title: $('quality-execution-title'),
    context: $('quality-execution-context'),
    occurrenceId: $('quality-execution-occurrence-id'),
    taskId: $('quality-execution-task-id'),
    type: $('quality-execution-type'),
    sourceId: $('quality-execution-source-id'),
    typeCode: $('quality-execution-type-code'),
    details: $('quality-readonly-details'),
    tempValue: $('quality-temperature-value'),
    tempValueLabel: $('quality-temperature-value-label'),
    tempMethod: $('quality-temperature-method'),
    tempMethodLabel: $('quality-temperature-method-label'),
    cleaningStatus: $('quality-cleaning-status'),
    cleaningStatusLabel: $('quality-cleaning-status-label'),
    cleaningVisual: $('quality-cleaning-visual'),
    cleaningVisualLabel: $('quality-cleaning-visual-label'),
    cleaningAnomaly: $('quality-cleaning-anomaly'),
    cleaningAnomalyLabel: $('quality-cleaning-anomaly-label'),
    manualResult: $('quality-manual-result'),
    manualResultLabel: $('quality-manual-result-label'),
    manualConformity: $('quality-manual-conformity'),
    manualConformityLabel: $('quality-manual-conformity-label'),
    at: $('quality-execution-at'),
    operator: $('quality-execution-operator'),
    comment: $('quality-execution-comment'),
    corrective: $('quality-execution-corrective'),
    evidencePhotoId: $('quality-evidence-photo-id'),
    evidenceDocumentId: $('quality-evidence-document-id'),
    executionAlert: $('quality-execution-alert'),
    cancel: $('quality-execution-cancel'),
  };
  let work = null;

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

  function sectionHtml(items, emptyText) {
    if (!items?.length) return `<div class="quality-empty-state">${escapeHtml(emptyText)}</div>`;
    return items.map((item) => `
      <article class="quality-card ${statusClass(item.status, item.conformity_status)}">
        <span class="quality-badge">${escapeHtml(typeLabel(item.type))}</span>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.zone_name || '-')} - ${escapeHtml(item.equipment_name || '-')} - ${escapeHtml(item.target_time || 'Evenement')}</p>
        <p class="quality-muted">${item.status === 'completed' ? `Resultat : ${escapeHtml(resultLabel(item))} - Operateur : ${escapeHtml(item.operator_email || '-')}` : `Echeance : ${formatDate(item.next_due_at)} - Criticite : ${escapeHtml(item.criticality || '-')}`}</p>
        <div class="quality-actions">${item.status === 'completed' ? '<button class="btn btn-secondary" type="button" disabled>Voir</button>' : `<button class="btn btn-primary" data-action="execute" data-id="${escapeHtml(item.id)}">${escapeHtml(item.primary_action)}</button>`}</div>
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
    els.completed.innerHTML = sectionHtml(work.sections.completed_today, 'Aucun controle realise aujourd hui.');
    els.nc.innerHTML = work.sections.non_conformities?.length
      ? work.sections.non_conformities.map((item) => `<article class="quality-card quality-temperature-alert"><span class="quality-badge">${escapeHtml(item.severity)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><p class="quality-muted">${formatDate(item.created_at)}</p></article>`).join('')
      : '<div class="quality-empty-state">Aucune non-conformite ouverte.</div>';
    if (!canRecord) document.querySelectorAll('button[data-action="execute"]').forEach((button) => { button.disabled = true; });
  }

  function findItem(id) {
    return ['today', 'overdue', 'upcoming'].flatMap((key) => work.sections[key] || []).find((item) => String(item.id) === String(id));
  }

  function toggleFields(type) {
    els.tempValueLabel.classList.toggle('hidden', type !== 'temperature');
    els.tempMethodLabel.classList.toggle('hidden', type !== 'temperature');
    els.cleaningStatusLabel.classList.toggle('hidden', type !== 'cleaning');
    els.cleaningVisualLabel.classList.toggle('hidden', type !== 'cleaning');
    els.cleaningAnomalyLabel.classList.toggle('hidden', type !== 'cleaning');
    els.manualResultLabel.classList.toggle('hidden', !['manual', 'control'].includes(type));
    els.manualConformityLabel.classList.toggle('hidden', !['manual', 'control'].includes(type));
  }

  function openExecution(item) {
    els.form.reset();
    els.occurrenceId.value = item.occurrence_id || '';
    els.taskId.value = item.quality_task_id || '';
    els.type.value = item.type;
    els.sourceId.value = item.source_entity_id || '';
    els.typeCode.value = item.raw?.type_code || '';
    els.title.textContent = item.primary_action;
    els.context.textContent = `${item.title} - ${item.zone_name || '-'} - ${item.equipment_name || '-'} - ${formatDate(item.next_due_at)}`;
    els.details.innerHTML = [
      `Type : ${escapeHtml(typeLabel(item.type))}`,
      `Zone : ${escapeHtml(item.zone_name || '-')}`,
      `Equipement : ${escapeHtml(item.equipment_name || '-')}`,
      `Heure cible : ${escapeHtml(item.target_time || 'Evenement')}`,
      item.type === 'temperature' ? `Seuils : ${escapeHtml(item.raw?.min_value ?? item.raw?.min_limit ?? '-')} / ${escapeHtml(item.raw?.max_value ?? item.raw?.max_limit ?? '-')} ${escapeHtml(item.raw?.unit || '')}` : '',
      item.type === 'cleaning' ? `Methode : ${escapeHtml(item.raw?.method || '-')} - Produit : ${escapeHtml(item.raw?.product_name || '-')}` : '',
    ].filter(Boolean).join('<br>');
    els.at.value = new Date().toISOString().slice(0, 16);
    els.operator.value = user.email || user.name || 'Utilisateur connecte';
    els.executionAlert.className = 'page-feedback hidden quality-form-wide';
    toggleFields(item.type);
    els.panel.classList.remove('hidden');
    els.panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showExecutionAlert(message) {
    els.executionAlert.textContent = message;
    els.executionAlert.className = 'page-feedback error quality-form-wide';
  }

  async function submitExecution(event) {
    event.preventDefault();
    const payload = {
      occurrence_id: els.occurrenceId.value || null,
      quality_task_id: els.taskId.value || null,
      comment: els.comment.value || null,
      corrective_action: els.corrective.value || null,
      evidence_photo_id: els.evidencePhotoId.value || null,
      evidence_document_id: els.evidenceDocumentId.value || null,
    };
    if (els.type.value === 'temperature') {
      if (!els.tempValue.value) return showExecutionAlert('La temperature mesuree est obligatoire.');
      await api.executeTemperature({ ...payload, type_code: els.typeCode.value, value: Number(els.tempValue.value), recorded_at: els.at.value, method_used: els.tempMethod.value || null, source: 'manual' });
    } else if (els.type.value === 'cleaning') {
      if (['not_done', 'issue'].includes(els.cleaningStatus.value) && !els.comment.value && !els.cleaningAnomaly.value) return showExecutionAlert('Une observation est obligatoire pour un nettoyage non conforme ou non realise.');
      await api.executeCleaning({ ...payload, cleaning_plan_id: els.sourceId.value, performed_at: els.at.value, status: els.cleaningStatus.value, visual_check_status: els.cleaningVisual.value, anomaly_comment: els.cleaningAnomaly.value || null });
    } else {
      await api.executeManual({ ...payload, completed_at: els.at.value, result_status: els.manualResult.value, conformity_status: els.manualConformity.value });
    }
    els.panel.classList.add('hidden');
    await load();
  }

  async function load() {
    setFeedback('Chargement...');
    work = await api.today({ include_upcoming: 'true' });
    render();
    setFeedback('');
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action="execute"]');
    if (!button) return;
    const item = findItem(button.dataset.id);
    if (item) openExecution(item);
  });
  els.cancel.addEventListener('click', () => els.panel.classList.add('hidden'));
  els.form.addEventListener('submit', submitExecution);

  load().catch((error) => setFeedback(error.message, 'error'));
})();
