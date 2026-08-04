(function () {
  const user = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  if (!user || !token) { window.location.href = '../../login.html'; return; }

  const api = window.QualityOperationsApi;
  const $ = (id) => document.getElementById(id);
  const els = {
    feedback: $('quality-ddpp-feedback'),
    status: $('quality-ddpp-status'),
    summary: $('quality-ddpp-summary'),
    today: $('quality-ddpp-today'),
    completed: $('quality-ddpp-completed'),
    temperatures: $('quality-ddpp-temperatures'),
    cleaning: $('quality-ddpp-cleaning'),
    nc: $('quality-ddpp-nc'),
    actions: $('quality-ddpp-actions'),
    filters: $('quality-ddpp-filters'),
    modal: $('quality-ddpp-detail-modal'),
    modalTitle: $('quality-ddpp-detail-title'),
    modalType: $('quality-ddpp-detail-type'),
    modalBody: $('quality-ddpp-detail-body'),
    modalClose: $('quality-ddpp-detail-close'),
  };

  let currentData = null;

  const TRANSLATIONS = Object.freeze({
    planned: 'Planifie',
    due: 'A realiser',
    completed: 'Realise',
    late: 'En retard',
    overdue: 'En retard',
    skipped: 'Non applicable',
    cancelled: 'Annule',
    open: 'Ouverte',
    in_progress: 'En cours',
    closed: 'Cloturee',
    pending_review: 'A valider',
    active: 'Actif',
    paused: 'Suspendu',
    compliant: 'Conforme',
    conform: 'Conforme',
    non_compliant: 'Non conforme',
    non_conform: 'Non conforme',
    out_of_limits: 'Non conforme',
    warning: 'Vigilance',
    critical: 'Critique',
    high: 'Elevee',
    medium: 'Moyenne',
    low: 'Faible',
    manual: 'Manuel',
    api: 'Saisie ALTA',
    iot: 'Automatique',
    import: 'Importe',
    temperature: 'Temperature',
    cleaning: 'Nettoyage',
    manual_task: 'Tache manuelle',
    control: 'Controle',
    done: 'Realise',
    issue: 'Anomalie',
    not_done: 'Non realise',
    not_applicable: 'Non applicable',
    quality_temperature_record: 'Releve temperature',
    quality_cleaning_record: 'Nettoyage',
    quality_manual_task_record: 'Tache manuelle',
    today: 'A realiser',
    upcoming: 'A venir',
    event_controls: 'Controles evenementiels',
    completed_today: 'Realises',
    open_non_conformities: 'Non-conformites ouvertes',
    critical_missing: 'Retards critiques',
    expected_controls: 'Controles attendus',
    non_compliant: 'Non conformes',
    overdue_corrective_actions: 'Actions en retard',
  });

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function translate(value) {
    if (value === null || value === undefined || value === '') return '-';
    return TRANSLATIONS[String(value)] || String(value).replace(/_/g, ' ');
  }

  function setFeedback(message = '', type = '') {
    els.feedback.textContent = message;
    els.feedback.className = message ? `page-feedback ${type}`.trim() : 'page-feedback hidden';
  }

  function formatDate(value) {
    return value ? new Date(value).toLocaleString('fr-FR') : '-';
  }

  function formatList(items, field = 'name') {
    return (items || []).map((item) => item?.[field] || item?.code || item).filter(Boolean).join(', ') || '-';
  }

  function statusClass(value) {
    if (['red', 'critical', 'high', 'late', 'overdue', 'out_of_limits', 'non_conform', 'issue', 'not_done'].includes(String(value))) return 'quality-temperature-alert';
    if (['orange', 'warning', 'medium', 'due', 'in_progress'].includes(String(value))) return 'quality-temperature-warning';
    return 'quality-temperature-ok';
  }

  function detailButton(type, id, localKind = '') {
    if (!type || !id) return '';
    return `<button class="btn btn-secondary quality-ddpp-detail-btn" type="button" data-detail-type="${escapeHtml(type)}" data-detail-id="${escapeHtml(id)}" data-detail-kind="${escapeHtml(localKind)}">Voir le detail</button>`;
  }

  function table(headers, rows) {
    if (!rows.length) return '<div class="quality-empty-state">Aucune donnee.</div>';
    return `<table class="quality-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  function resultLabel(item) {
    return translate(item.conformity_status || item.result_status || item.status);
  }

  function temperatureValue(item) {
    if (item.type !== 'temperature' || item.value === null || item.value === undefined) return '-';
    return `${item.value} ${item.unit || 'C'}`.trim();
  }

  function recordContract(item = {}) {
    const recordType = item.detail_type || item.record_type || (item.type === 'manual' ? 'manual_task' : item.type);
    return {
      record_type: recordType,
      record_id: item.record_id || item.source_record_id || null,
      occurrence_id: item.occurrence_id || null,
      task_id: item.quality_task_id || item.task_id || null,
    };
  }

  function linkedRecordButton(item) {
    const contract = recordContract(item);
    return detailButton(contract.record_type, contract.record_id, 'record');
  }

  function renderSummary(data) {
    const summary = data.summary || {};
    const cards = [
      ['Controles attendus', summary.expected_controls, 'green'],
      ['Realises', summary.completed, 'green'],
      ['En retard', summary.overdue, summary.overdue ? 'red' : 'green'],
      ['Non conformes', summary.non_compliant, summary.non_compliant ? 'orange' : 'green'],
      ['Non-conformites ouvertes', summary.open_non_conformities, summary.open_non_conformities ? 'orange' : 'green'],
      ['Actions en retard', summary.overdue_corrective_actions, summary.overdue_corrective_actions ? 'red' : 'green'],
    ];
    els.summary.innerHTML = cards.map(([label, value, color]) => `<article class="quality-card ${statusClass(color)}"><span class="quality-badge">${escapeHtml(label)}</span><h3>${Number(value || 0)}</h3></article>`).join('');
    return `${summary.expected_controls || 0} controles attendus, ${summary.completed || 0} realises, ${summary.overdue || 0} en retard, ${summary.open_non_conformities || 0} non-conformites ouvertes.`;
  }

  function render(data) {
    currentData = data;
    const statusLabel = { green: 'A jour', orange: 'Vigilance', red: 'Action requise' }[data.status] || translate(data.status);
    const summaryText = renderSummary(data);
    els.status.innerHTML = `<span class="quality-badge">${escapeHtml(statusLabel)}</span><h3>Controle DDPP</h3><p>${escapeHtml(summaryText)}</p><p class="quality-muted">Periode : ${formatDate(data.period?.start)} - ${formatDate(data.period?.end)}. Edition : ${formatDate(data.today.generated_at)}</p>`;
    els.today.innerHTML = Object.entries(data.today.summary).map(([key, value]) => `<article class="quality-card"><span class="quality-badge">${escapeHtml(translate(key))}</span><h3>${value || 0}</h3></article>`).join('');
    els.completed.innerHTML = table(['Heure', 'Type', 'Titre', 'Zone', 'Operateur', 'Resultat', 'Temperature relevee', 'Observation', 'Detail'], (data.completed_items || []).map((item) => `<tr><td>${formatDate(item.next_due_at)}</td><td>${escapeHtml(translate(item.type))}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.zone_name || '-')}</td><td>${escapeHtml(item.operator_email || '-')}</td><td>${escapeHtml(resultLabel(item))}</td><td>${escapeHtml(temperatureValue(item))}</td><td>${escapeHtml(item.comment || item.corrective_action || '-')}</td><td>${linkedRecordButton(item)}</td></tr>`));
    els.temperatures.innerHTML = table(['Date', 'Type', 'Zone', 'Equipement', 'Valeur', 'Statut', 'Observation', 'Detail'], (data.temperature_records || []).map((record) => `<tr class="${statusClass(record.alert_status)}"><td>${formatDate(record.recorded_at)}</td><td>${escapeHtml(record.type_label || record.type_code)}</td><td>${escapeHtml(record.zone_name || '-')}</td><td>${escapeHtml(record.equipment_name || '-')}</td><td>${escapeHtml(record.value)} ${escapeHtml(record.unit || '')}</td><td>${escapeHtml(translate(record.alert_status))}</td><td>${escapeHtml(record.comment || record.exceptional_reason || '-')}</td><td>${detailButton(record.detail_type || 'temperature', record.record_id || record.id, 'record')}</td></tr>`));
    els.cleaning.innerHTML = table(['Date', 'Plan', 'Zones', 'Equipements', 'Resultat', 'Operateur', 'Observation', 'Detail'], (data.cleaning_records || []).map((record) => `<tr class="${statusClass(record.status)}"><td>${formatDate(record.performed_at)}</td><td>${escapeHtml(record.plan_title || '-')}</td><td>${escapeHtml(formatList(record.zones))}</td><td>${escapeHtml(formatList(record.equipments))}</td><td>${escapeHtml(translate(record.status || record.visual_check_status))}</td><td>${escapeHtml(record.performed_by_email || '-')}</td><td>${escapeHtml(record.comment || record.anomaly_comment || record.corrective_action || '-')}</td><td>${detailButton(record.detail_type || 'cleaning', record.record_id || record.id, 'record')}</td></tr>`));
    els.nc.innerHTML = (data.non_conformities || []).length ? data.non_conformities.map((item) => `<article class="quality-card ${statusClass(item.severity)}"><span class="quality-badge">${escapeHtml(translate(item.severity))}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><p class="quality-muted">Statut : ${escapeHtml(translate(item.status))} - Origine : ${escapeHtml(translate(item.record_type || item.source_record_type || item.origin_type))} - Zone : ${escapeHtml(item.zone_name || '-')}</p><p class="quality-muted">Action immediate : ${escapeHtml(item.immediate_action || '-')}</p><div class="quality-actions">${detailButton('non_conformity', item.id, 'non_conformity')}${detailButton(item.record_type, item.source_record_id, 'record')}</div></article>`).join('') : '<div class="quality-empty-state">Aucune non-conformite sur la periode.</div>';
    els.actions.innerHTML = (data.corrective_actions || []).length ? data.corrective_actions.map((item) => `<article class="quality-card ${statusClass(item.status)}"><span class="quality-badge">${escapeHtml(translate(item.status))}</span><h3>${escapeHtml(item.action)}</h3><p class="quality-muted">NC : ${escapeHtml(item.non_conformity_title || '-')} - Echeance : ${formatDate(item.due_at)} - Responsable : ${escapeHtml(item.responsible_email || '-')}</p><p class="quality-muted">Controle efficacite : ${escapeHtml(item.effectiveness_check || '-')}</p><div class="quality-actions">${detailButton('corrective_action', item.id, 'corrective_action')}${detailButton(item.record_type, item.source_record_id, 'record')}</div></article>`).join('') : '<div class="quality-empty-state">Aucune action corrective sur la periode.</div>';
  }

  function detailRows(rows) {
    return `<dl class="quality-ddpp-detail-grid">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value ?? '-')}</dd></div>`).join('')}</dl>`;
  }

  function linkedSection(title, items, renderer) {
    if (!items?.length) return `<section><h4>${escapeHtml(title)}</h4><p class="quality-muted">Aucun element lie.</p></section>`;
    return `<section><h4>${escapeHtml(title)}</h4><div class="quality-list-grid">${items.map(renderer).join('')}</div></section>`;
  }

  function renderRecordDetail(detail) {
    const record = detail.record || {};
    const isTemperature = detail.type === 'temperature';
    const isCleaning = detail.type === 'cleaning';
    const rows = isTemperature ? [
      ['Date et heure', formatDate(record.recorded_at)],
      ['Type', record.type_label || record.type_code],
      ['Parametre source', record.parameter_id || record.temperature_limit_id],
      ['Zone', record.zone_name],
      ['Equipement', record.equipment_name],
      ['Valeur mesuree', `${record.value ?? '-'} ${record.unit || ''}`],
      ['Seuil minimum', record.min_limit],
      ['Seuil maximum', record.max_limit],
      ['Conformite', translate(record.alert_status)],
      ['Ecart', record.alert_reason],
      ['Operateur', detail.operator],
      ['Observation', record.comment || record.exceptional_reason],
      ['Action corrective immediate', record.corrective_action],
      ['Origine de la saisie', translate(record.source)],
      ['Tache liee', detail.task?.title || detail.source?.quality_task_id],
      ['Occurrence liee', detail.source?.occurrence_id],
      ['Photo', detail.attachments?.photo_id],
      ['Piece jointe', detail.attachments?.document_id],
    ] : isCleaning ? [
      ['Plan', record.plan_title],
      ['Date et heure', formatDate(record.performed_at)],
      ['Debut reel', formatDate(record.started_at)],
      ['Fin reelle', formatDate(record.ended_at)],
      ['Duree', record.duration_minutes ? `${record.duration_minutes} min` : '-'],
      ['Zones', formatList(record.zones)],
      ['Equipements', formatList(record.equipments)],
      ['Methode', record.method],
      ['Produit', record.product_name],
      ['Dosage', record.dosage_concentration],
      ['Temps de contact', record.contact_time_minutes ? `${record.contact_time_minutes} min` : '-'],
      ['EPI', record.material_used],
      ['Statut', translate(record.status)],
      ['Controle visuel', translate(record.visual_check_status)],
      ['Operateur', detail.operator],
      ['Observation', record.comment],
      ['Anomalie constatee', record.anomaly_comment],
      ['Action corrective immediate', record.corrective_action],
      ['Preuve/photo', detail.attachments?.photo_id],
      ['Tache liee', detail.task?.title || detail.source?.quality_task_id],
      ['Occurrence liee', detail.source?.occurrence_id],
    ] : [
      ['Titre', detail.task?.title || record.task_title],
      ['Date et heure', formatDate(record.performed_at)],
      ['Operateur', detail.operator],
      ['Resultat', translate(record.result_status)],
      ['Conformite', translate(record.conformity_status)],
      ['Observation', record.observation],
      ['Action corrective immediate', record.corrective_action],
      ['Photo', detail.attachments?.photo_id],
      ['Piece jointe', detail.attachments?.document_id],
      ['Tache source', detail.task?.id],
      ['Occurrence', detail.source?.occurrence_id],
    ];
    return `${detailRows(rows)}
      ${linkedSection('Non-conformites liees', detail.non_conformities, renderNcCard)}
      ${linkedSection('Actions correctives liees', detail.corrective_actions, renderActionCard)}`;
  }

  function renderNcCard(item) {
    return `<article class="quality-card ${statusClass(item.severity)}"><span class="quality-badge">${escapeHtml(translate(item.status))}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><p class="quality-muted">Criticite : ${escapeHtml(translate(item.severity))} - Responsable : ${escapeHtml(item.responsible_email || '-')}</p><p class="quality-muted">Date limite : ${formatDate(item.due_at)} - Cloture : ${formatDate(item.closed_at)}</p></article>`;
  }

  function renderActionCard(item) {
    return `<article class="quality-card ${statusClass(item.status)}"><span class="quality-badge">${escapeHtml(translate(item.status))}</span><h3>${escapeHtml(item.action)}</h3><p class="quality-muted">Responsable : ${escapeHtml(item.responsible_email || '-')} - Echeance : ${formatDate(item.due_at)}</p><p class="quality-muted">Preuve : ${escapeHtml(item.proof_document_id || item.proof_photo_id || '-')} - Validation : ${escapeHtml(item.validation_comment || '-')}</p></article>`;
  }

  function renderNcDetail(item) {
    return detailRows([
      ['Titre', item.title],
      ['Description', item.description],
      ['Criticite', translate(item.severity)],
      ['Origine', translate(item.record_type || item.source_record_type || item.origin_type)],
      ['Enregistrement lie', item.source_record_id || item.origin_record_id],
      ['Zone', item.zone_name],
      ['Equipement', item.equipment_name],
      ['Action immediate', item.immediate_action],
      ['Responsable', item.responsible_email],
      ['Date limite', formatDate(item.due_at)],
      ['Statut', translate(item.status)],
      ['Preuve', item.proof_document_id || item.proof_photo_id],
      ['Creation', formatDate(item.created_at)],
      ['Cree par', item.created_by_email],
      ['Date de cloture', formatDate(item.closed_at)],
      ['Cloture par', item.closed_by_email],
      ['Commentaire cloture', item.closure_comment],
    ]);
  }

  function renderActionDetail(item) {
    return detailRows([
      ['Action', item.action],
      ['NC liee', item.non_conformity_title],
      ['Responsable', item.responsible_email],
      ['Echeance', formatDate(item.due_at)],
      ['Statut', translate(item.status)],
      ['Preuve document', item.proof_document_id],
      ['Preuve photo', item.proof_photo_id],
      ['Controle efficacite', item.effectiveness_check],
      ['Date de realisation', formatDate(item.completed_at)],
      ['Validateur', item.completed_by_email],
      ['Date de validation', formatDate(item.updated_at)],
      ['Commentaire validation', item.validation_comment],
    ]);
  }

  function showModal(title, typeLabel, html) {
    els.modalTitle.textContent = title;
    els.modalType.textContent = typeLabel;
    els.modalBody.innerHTML = html;
    els.modal.classList.remove('hidden');
  }

  async function openRecordDetail(type, id) {
    setFeedback('Chargement du detail...');
    const detail = await api.ddppRecordDetail(type, id);
    showModal('Detail du controle', translate(detail.type), renderRecordDetail(detail));
    setFeedback('');
  }

  function openLocalDetail(kind, id) {
    const source = kind === 'non_conformity'
      ? (currentData?.non_conformities || []).find((item) => String(item.id) === String(id))
      : (currentData?.corrective_actions || []).find((item) => String(item.id) === String(id));
    if (!source) return;
    showModal(kind === 'non_conformity' ? 'Detail de la non-conformite' : 'Detail de l action corrective', kind === 'non_conformity' ? 'Non-conformite' : 'Action corrective', kind === 'non_conformity' ? renderNcDetail(source) : renderActionDetail(source));
  }

  async function load() {
    setFeedback('Chargement...');
    const params = Object.fromEntries(new FormData(els.filters).entries());
    const data = await api.ddpp(params);
    render(data);
    setFeedback('');
  }

  els.filters.addEventListener('submit', (event) => {
    event.preventDefault();
    load().catch((error) => setFeedback(error.message, 'error'));
  });

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-detail-type]');
    if (!button) return;
    const { detailType, detailId, detailKind } = button.dataset;
    if (detailKind === 'non_conformity' || detailKind === 'corrective_action') {
      openLocalDetail(detailKind, detailId);
      return;
    }
    openRecordDetail(detailType, detailId).catch((error) => setFeedback(error.message, 'error'));
  });

  els.modalClose.addEventListener('click', () => els.modal.classList.add('hidden'));
  els.modal.addEventListener('click', (event) => {
    if (event.target === els.modal) els.modal.classList.add('hidden');
  });

  load().catch((error) => setFeedback(error.message, 'error'));
})();
