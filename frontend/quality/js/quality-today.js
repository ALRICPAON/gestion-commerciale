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
    tempValue: $('quality-temperature-value'),
    tempValueLabel: $('quality-temperature-value-label'),
    cleaningStatus: $('quality-cleaning-status'),
    cleaningStatusLabel: $('quality-cleaning-status-label'),
    at: $('quality-execution-at'),
    comment: $('quality-execution-comment'),
    corrective: $('quality-execution-corrective'),
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

  function statusClass(status) {
    if (['overdue', 'late'].includes(status)) return 'quality-temperature-alert';
    if (status === 'due') return 'quality-temperature-warning';
    if (status === 'completed') return 'quality-temperature-ok';
    return '';
  }

  function typeLabel(type) {
    return { temperature: 'Température', cleaning: 'Nettoyage', manual: 'Tâche manuelle', control: 'Contrôle' }[type] || 'Contrôle';
  }

  function sectionHtml(items, emptyText) {
    if (!items?.length) return `<div class="quality-empty-state">${escapeHtml(emptyText)}</div>`;
    return items.map((item) => `
      <article class="quality-card ${statusClass(item.status)}">
        <span class="quality-badge">${escapeHtml(typeLabel(item.type))}</span>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.zone_name || '-')} · ${escapeHtml(item.equipment_name || '-')} · ${escapeHtml(item.target_time || 'Événement')}</p>
        <p class="quality-muted">Échéance : ${formatDate(item.next_due_at)} · Criticité : ${escapeHtml(item.criticality || '-')} · Source : ${escapeHtml(item.source_entity_type || 'manuel')}</p>
        <div class="quality-actions">${item.status === 'completed' ? '' : `<button class="btn btn-primary" data-action="execute" data-id="${escapeHtml(item.id)}">${escapeHtml(item.primary_action)}</button>`}</div>
      </article>
    `).join('');
  }

  function renderSummary(summary) {
    els.summary.innerHTML = [
      ['À faire', summary.today],
      ['En retard', summary.overdue],
      ['Réalisés', summary.completed_today],
      ['Non-conformités', summary.open_non_conformities],
      ['Critiques manquants', summary.critical_missing],
    ].map(([label, value]) => `<article class="quality-card"><span class="quality-badge">${escapeHtml(label)}</span><h3>${value || 0}</h3></article>`).join('');
  }

  function render() {
    renderSummary(work.summary || {});
    els.today.innerHTML = sectionHtml(work.sections.today, 'Aucun contrôle à faire maintenant.');
    els.overdue.innerHTML = sectionHtml(work.sections.overdue, 'Aucun retard.');
    els.upcoming.innerHTML = sectionHtml(work.sections.upcoming, 'Aucun contrôle à venir.');
    els.completed.innerHTML = sectionHtml(work.sections.completed_today, 'Aucun contrôle réalisé aujourd’hui.');
    els.nc.innerHTML = work.sections.non_conformities?.length
      ? work.sections.non_conformities.map((item) => `<article class="quality-card quality-temperature-alert"><span class="quality-badge">${escapeHtml(item.severity)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><p class="quality-muted">${formatDate(item.created_at)}</p></article>`).join('')
      : '<div class="quality-empty-state">Aucune non-conformité ouverte.</div>';
    if (!canRecord) document.querySelectorAll('button[data-action="execute"]').forEach((button) => { button.disabled = true; });
  }

  function findItem(id) {
    return ['today', 'overdue', 'upcoming'].flatMap((key) => work.sections[key] || []).find((item) => String(item.id) === String(id));
  }

  function openExecution(item) {
    els.form.reset();
    els.occurrenceId.value = item.occurrence_id || '';
    els.taskId.value = item.quality_task_id || '';
    els.type.value = item.type;
    els.sourceId.value = item.source_entity_id || '';
    els.typeCode.value = item.raw?.type_code || '';
    els.title.textContent = item.primary_action;
    els.context.textContent = `${item.title} · ${item.zone_name || '-'} · ${item.equipment_name || '-'} · ${formatDate(item.next_due_at)}`;
    els.at.value = new Date().toISOString().slice(0, 16);
    els.tempValueLabel.classList.toggle('hidden', item.type !== 'temperature');
    els.cleaningStatusLabel.classList.toggle('hidden', item.type !== 'cleaning');
    els.panel.classList.remove('hidden');
    els.panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function submitExecution(event) {
    event.preventDefault();
    const payload = {
      occurrence_id: els.occurrenceId.value || null,
      quality_task_id: els.taskId.value || null,
      comment: els.comment.value || null,
      corrective_action: els.corrective.value || null,
    };
    if (els.type.value === 'temperature') {
      await api.executeTemperature({
        ...payload,
        type_code: els.typeCode.value,
        value: els.tempValue.value,
        recorded_at: els.at.value,
        source: 'manual',
      });
    } else if (els.type.value === 'cleaning') {
      await api.executeCleaning({
        ...payload,
        cleaning_plan_id: els.sourceId.value,
        performed_at: els.at.value,
        status: els.cleaningStatus.value,
        anomaly_comment: els.cleaningStatus.value === 'issue' ? els.comment.value : null,
      });
    } else {
      await api.executeManual({ ...payload, completed_at: els.at.value, result_status: 'completed' });
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
