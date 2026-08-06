(function () {
  const user = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  if (!user || !token) { window.location.href = '../../login.html'; return; }

  const api = window.QualityCleaningApi;
  const operationsApi = window.QualityOperationsApi;
  const formHelper = window.QualityExecutionForms;
  const canRecord = window.hasQualityPermission?.(user, 'quality.record.create');
  const $ = (id) => document.getElementById(id);
  const els = {
    feedback: $('cleaning-record-feedback'),
    due: $('cleaning-due-records'),
    includeUpcoming: $('cleaning-due-include-upcoming'),
    form: $('cleaning-record-form'),
    formTitle: $('cleaning-record-form-title'),
    tableBody: $('cleaning-record-table-body'),
    documentLinks: $('cleaning-record-document-links'),
  };
  let plans = [];
  let dueRecords = [];
  let records = [];
  let executionForm = null;

  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  function setFeedback(message = '', type = '') { els.feedback.textContent = message; els.feedback.className = message ? `page-feedback ${type}`.trim() : 'page-feedback hidden'; }
  function formatDate(value) { return value ? new Date(value).toLocaleString('fr-FR') : '-'; }
  function toDatetimeLocal(value) { const date = value ? new Date(value) : new Date(); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  function statusLabel(status) { return { done: 'Realise', partial: 'Partiel', not_done: 'Non realise', issue: 'Incident' }[status] || status; }
  function dueStatusLabel(status) { return { overdue: 'En retard', due: 'A faire aujourd hui', planned: 'A venir' }[status] || status; }
  function dueClass(status) { if (status === 'overdue' || status === 'late') return 'quality-temperature-alert'; if (status === 'due') return 'quality-temperature-warning'; return ''; }
  function targetNames(items, fallback) { const names = (Array.isArray(items) ? items : []).map((item) => item.name || item.code || item.id).filter(Boolean); return names.join(', ') || fallback || '-'; }

  function resetForm() {
    executionForm.setContext({ ended_at: new Date().toISOString() });
  }

  function fillDue(record) {
    executionForm.setContext({
      ...record,
      locked: true,
      plan: record,
      cleaning_plan_id: record.cleaning_plan_id,
      ended_at: new Date().toISOString(),
      comment: record.task_title ? `Controle attendu : ${record.task_title}` : '',
    });
    window.QualityDocumentLinks?.render('cleaning_plan', record.cleaning_plan_id, els.documentLinks, { title: 'Procedures et documents applicables' }).catch(() => {});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderDue() {
    if (!dueRecords.length) { els.due.innerHTML = '<div class="quality-empty-state">Aucun nettoyage attendu.</div>'; return; }
    els.due.innerHTML = dueRecords.map((item) => {
      const zones = targetNames(item.zones, item.zone_name);
      const equipments = targetNames(item.equipments, item.equipment_name);
      return `<article class="quality-card ${dueClass(item.computed_status)}"><span class="quality-badge">${dueStatusLabel(item.computed_status)}</span><h3>${escapeHtml(item.task_title || item.title)}</h3><p>Produit : ${escapeHtml(item.product_name || '-')} - Duree : ${item.expected_duration_minutes || '-'} min</p><p class="quality-muted"><strong>Zones :</strong> ${escapeHtml(zones)}</p><p class="quality-muted"><strong>Equipements :</strong> ${escapeHtml(equipments)}</p><p class="quality-muted">Echeance : ${formatDate(item.next_due_at)} - Derniere realisation : ${formatDate(item.last_completed_at)}</p><p class="quality-muted">${escapeHtml(item.method || '')}</p><div class="quality-actions"><button class="btn btn-primary" data-action="fill" data-id="${item.cleaning_plan_id}">Realiser</button></div></article>`;
    }).join('');
  }

  function renderRecords() {
    if (!records.length) { els.tableBody.innerHTML = '<tr><td colspan="8">Aucun nettoyage enregistre.</td></tr>'; return; }
    els.tableBody.innerHTML = records.map((record) => `<tr><td>${formatDate(record.performed_at)}</td><td>${escapeHtml(record.plan_title)}</td><td>${escapeHtml(targetNames(record.zones, record.zone_name))}</td><td>${escapeHtml(targetNames(record.equipments, record.equipment_name))}</td><td>${statusLabel(record.status)}${record.source === 'exceptional' ? '<br><small>Saisie exceptionnelle</small>' : ''}</td><td>${escapeHtml(record.performed_by_email || '-')}</td><td>${escapeHtml(record.comment || record.exceptional_reason || '')}</td><td><button class="btn btn-secondary" data-action="documents" data-id="${escapeHtml(record.id)}">Documents</button></td></tr>`).join('');
  }

  async function load() {
    setFeedback('Chargement des nettoyages...');
    try {
      [plans, dueRecords, records] = await Promise.all([api.listPlans({ active: 'true' }), api.listDueRecords({ include_upcoming: els.includeUpcoming.checked ? 'true' : '' }), api.listRecords()]);
      if (!executionForm) {
        executionForm = formHelper.createCleaningExecutionForm({
          form: els.form,
          titleEl: els.formTitle,
          plans,
          operationsApi,
          user,
          onSubmitted: async () => { resetForm(); await load(); },
          onError: (message) => setFeedback(message, 'error'),
        });
        if (!canRecord) executionForm.field('submit').disabled = true;
      }
      renderDue();
      renderRecords();
      setFeedback('');
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  }

  els.includeUpcoming.addEventListener('change', load);
  els.due.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action="fill"]');
    if (!button) return;
    const record = dueRecords.find((item) => item.cleaning_plan_id === button.dataset.id);
    if (record) fillDue(record);
  });
  els.tableBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action="documents"]');
    if (!button) return;
    const record = records.find((item) => item.id === button.dataset.id);
    if (record) window.QualityDocumentLinks?.render('cleaning_record', record.id, els.documentLinks, { title: 'Procedures et documents applicables' }).catch(() => {});
  });
  load();
})();
