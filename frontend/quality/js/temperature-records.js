(function () {
  const user = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  if (!user || !token) { window.location.href = '../../login.html'; return; }

  const api = window.QualityTemperatureApi;
  const operationsApi = window.QualityOperationsApi;
  const twin = window.QualityDigitalTwinApi;
  const formHelper = window.QualityExecutionForms;
  const canRecord = window.hasQualityPermission?.(user, 'quality.record.create');
  const canManage = window.hasQualityPermission?.(user, 'quality.equipment.manage');
  const $ = (id) => document.getElementById(id);
  const els = {
    feedback: $('temperature-record-feedback'),
    summary: $('temperature-record-summary'),
    dueReadings: $('temperature-due-readings'),
    includeUpcoming: $('temperature-due-include-upcoming'),
    form: $('temperature-record-form'),
    formTitle: $('temperature-record-form-title'),
    search: $('temperature-record-search'),
    filterType: $('temperature-record-filter-type'),
    filterZone: $('temperature-record-filter-zone'),
    filterEquipment: $('temperature-record-filter-equipment'),
    filterAlert: $('temperature-record-filter-alert'),
    startDate: $('temperature-record-start-date'),
    endDate: $('temperature-record-end-date'),
    exportCsv: $('temperature-record-export-csv'),
    chart: $('temperature-record-chart'),
    tableBody: $('temperature-record-table-body'),
  };
  let types = [];
  let zones = [];
  let equipments = [];
  let records = [];
  let dueReadings = [];
  let executionForm = null;

  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  function setFeedback(message = '', type = '') { els.feedback.textContent = message; els.feedback.className = message ? `page-feedback ${type}`.trim() : 'page-feedback hidden'; }
  function formatDate(value) { return value ? new Date(value).toLocaleString('fr-FR') : '-'; }
  function toDatetimeLocal(value) { const date = value ? new Date(value) : new Date(); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  function statusLabel(status) { return status === 'compliant' ? 'Conforme' : status === 'out_of_limits' ? 'Hors limite' : 'Surveillance'; }
  function dueStatusLabel(status) { return { overdue: 'En retard', due: 'A faire aujourd hui', planned: 'A venir' }[status] || status; }
  function statusClass(status) { if (status === 'compliant') return 'quality-temperature-ok'; if (status === 'out_of_limits') return 'quality-temperature-alert'; return 'quality-temperature-warning'; }
  function dueStatusClass(status) { if (status === 'overdue' || status === 'late') return 'quality-temperature-alert'; if (status === 'due') return 'quality-temperature-warning'; return ''; }
  function typeOptions(empty = false) { return `${empty ? '<option value="">Tous types</option>' : ''}${types.map((type) => `<option value="${escapeHtml(type.code)}">${escapeHtml(type.label)}</option>`).join('')}`; }
  function zoneOptions() { return `<option value="">Toutes zones</option>${zones.map((zone) => `<option value="${escapeHtml(zone.id)}">${escapeHtml(zone.code)} - ${escapeHtml(zone.name)}</option>`).join('')}`; }
  function equipmentOptions() { return `<option value="">Tous equipements</option>${equipments.map((equipment) => `<option value="${escapeHtml(equipment.id)}">${escapeHtml(equipment.code)} - ${escapeHtml(equipment.name)}</option>`).join('')}`; }

  function fillSelects() {
    els.filterType.innerHTML = typeOptions(true);
    els.filterZone.innerHTML = zoneOptions();
    els.filterEquipment.innerHTML = equipmentOptions();
  }

  function filters() {
    return { search: els.search.value, type_code: els.filterType.value, zone_id: els.filterZone.value, equipment_id: els.filterEquipment.value, alert_status: els.filterAlert.value, start_date: els.startDate.value, end_date: els.endDate.value };
  }

  function resetForm() {
    executionForm.setContext({ recorded_at: new Date().toISOString() });
  }

  function fillDueReading(reading) {
    executionForm.setContext({
      ...reading,
      locked: true,
      parameter_id: reading.parameter_id || reading.limit_id,
      min_limit: reading.min_value,
      max_limit: reading.max_value,
      recorded_at: new Date().toISOString(),
      comment: reading.task_title ? `Controle attendu : ${reading.task_title}` : '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderSummary(summary) {
    els.summary.innerHTML = `<article class="quality-card quality-temperature-alert"><span class="quality-badge">Alertes</span><h3>${summary.alert_count || 0}</h3><p class="quality-muted">Hors limites et manquants</p></article><article class="quality-card quality-temperature-missing"><span class="quality-badge">Manquants</span><h3>${summary.missing_count || 0}</h3><p class="quality-muted">Parametrages en retard ou sans releve</p></article><article class="quality-card quality-temperature-alert"><span class="quality-badge">Critique</span><h3>${summary.latest_critical ? formatDate(summary.latest_critical.recorded_at) : '-'}</h3><p class="quality-muted">Dernier releve hors limite</p></article>`;
  }

  function renderDueReadings() {
    if (!dueReadings.length) { els.dueReadings.innerHTML = '<div class="quality-empty-state">Aucun releve attendu pour le moment.</div>'; return; }
    els.dueReadings.innerHTML = dueReadings.map((reading) => {
      const place = reading.equipment_name || reading.zone_name || 'Tous emplacements';
      const limits = `${reading.min_value ?? '-'} / ${reading.max_value ?? '-'} ${reading.unit || 'C'}`;
      return `<article class="quality-card ${dueStatusClass(reading.computed_status)}"><span class="quality-badge">${dueStatusLabel(reading.computed_status)}</span><h3>${escapeHtml(reading.task_title || reading.type_label)}</h3><p><strong>${escapeHtml(reading.type_label)}</strong> - ${escapeHtml(place)}</p><p class="quality-muted">Seuils : ${escapeHtml(limits)} - Heure cible : ${escapeHtml(reading.target_time || 'Evenement')}</p><p class="quality-muted">Echeance : ${formatDate(reading.next_due_at)}</p><div class="quality-actions"><button class="btn btn-primary" data-action="fill-due" data-task-id="${escapeHtml(reading.quality_task_id)}">Faire le releve</button></div></article>`;
    }).join('');
  }

  function renderChart() {
    const recent = records.slice().reverse().slice(-20);
    if (!recent.length) { els.chart.innerHTML = '<div class="quality-empty-state">Aucune donnee pour le graphique.</div>'; return; }
    const values = recent.map((record) => Number(record.value));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(max - min, 1);
    els.chart.innerHTML = recent.map((record) => `<div class="quality-temperature-bar ${statusClass(record.alert_status)}" style="height:${20 + ((Number(record.value) - min) / range) * 120}px" title="${escapeHtml(record.type_label)} - ${escapeHtml(record.value)}${escapeHtml(record.unit)} - ${formatDate(record.recorded_at)}"></div>`).join('');
  }

  function renderRecords() {
    if (!records.length) { els.tableBody.innerHTML = '<tr><td colspan="10">Aucun releve trouve.</td></tr>'; renderChart(); return; }
    els.tableBody.innerHTML = records.map((record) => `<tr class="${statusClass(record.alert_status)}"><td>${formatDate(record.recorded_at)}</td><td>${escapeHtml(record.zone_name || '-')}</td><td>${escapeHtml(record.equipment_name || '-')}</td><td>${escapeHtml(record.type_label)}</td><td><strong>${escapeHtml(record.value)}${escapeHtml(record.unit || 'C')}</strong></td><td>${record.min_limit ?? '-'} / ${record.max_limit ?? '-'}</td><td>${statusLabel(record.alert_status)}${record.source === 'exceptional' ? '<br><small>Saisie exceptionnelle</small>' : ''}</td><td>${escapeHtml(record.operator_email || '-')}</td><td>${escapeHtml(record.comment || record.exceptional_reason || '')}</td><td><button class="btn btn-secondary" data-action="delete" data-id="${record.id}">Archiver</button></td></tr>`).join('');
    if (!canManage) els.tableBody.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    renderChart();
  }

  async function load() {
    setFeedback('Chargement des releves...');
    try {
      const [summary, loadedDueReadings, loadedRecords] = await Promise.all([api.getSummary(), api.listDueReadings({ include_upcoming: els.includeUpcoming.checked ? 'true' : '' }), api.listRecords(filters())]);
      dueReadings = loadedDueReadings;
      records = loadedRecords;
      renderSummary(summary);
      renderDueReadings();
      renderRecords();
      setFeedback('');
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  }

  function exportCsv() {
    const header = ['date', 'zone', 'equipement', 'type', 'valeur', 'unite', 'mini', 'maxi', 'statut', 'operateur', 'commentaire'];
    const lines = records.map((record) => [record.recorded_at, record.zone_name || '', record.equipment_name || '', record.type_label, record.value, record.unit, record.min_limit ?? '', record.max_limit ?? '', record.alert_status, record.operator_email || '', record.comment || ''].map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';'));
    const blob = new Blob([[header.join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `temperatures-qms-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function init() {
    types = await api.listTypes();
    zones = await twin.listZones({ include_archived: 'false' });
    equipments = await twin.listEquipments({ include_archived: 'false' });
    fillSelects();
    executionForm = formHelper.createTemperatureExecutionForm({
      form: els.form,
      titleEl: els.formTitle,
      types,
      zones,
      equipments,
      operationsApi,
      user,
      onSubmitted: async () => { resetForm(); await load(); },
      onError: (message) => setFeedback(message, 'error'),
    });
    if (!canRecord) executionForm.field('submit').disabled = true;
    resetForm();
    await load();
  }

  els.exportCsv.addEventListener('click', exportCsv);
  els.includeUpcoming.addEventListener('change', load);
  [els.search, els.filterType, els.filterZone, els.filterEquipment, els.filterAlert, els.startDate, els.endDate].forEach((el) => { el.addEventListener('input', load); el.addEventListener('change', load); });
  els.dueReadings.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action="fill-due"]');
    if (!button) return;
    const reading = dueReadings.find((item) => item.quality_task_id === button.dataset.taskId);
    if (reading) fillDueReading(reading);
  });
  els.tableBody.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || !canManage) return;
    const record = records.find((item) => item.id === button.dataset.id);
    if (!record) return;
    if (button.dataset.action === 'delete' && !window.confirm('Archiver ce releve ?')) return;
    try { await api.deleteRecord(record.id); await load(); } catch (error) { setFeedback(error.message, 'error'); }
  });

  init().catch((error) => setFeedback(error.message, 'error'));
})();
