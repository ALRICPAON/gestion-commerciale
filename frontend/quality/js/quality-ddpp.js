(function () {
  const user = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  if (!user || !token) { window.location.href = '../../login.html'; return; }

  const api = window.QualityOperationsApi;
  const $ = (id) => document.getElementById(id);
  const els = {
    feedback: $('quality-ddpp-feedback'),
    status: $('quality-ddpp-status'),
    today: $('quality-ddpp-today'),
    completed: $('quality-ddpp-completed'),
    temperatures: $('quality-ddpp-temperatures'),
    cleaning: $('quality-ddpp-cleaning'),
    nc: $('quality-ddpp-nc'),
    actions: $('quality-ddpp-actions'),
    filters: $('quality-ddpp-filters'),
  };

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

  function table(headers, rows) {
    if (!rows.length) return '<div class="quality-empty-state">Aucune donnee.</div>';
    return `<table class="quality-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  function resultLabel(item) {
    if (item.type === 'temperature' && item.value !== null && item.value !== undefined) return `${item.value} ${item.unit || ''}`;
    return item.conformity_status || item.result_status || '-';
  }

  function render(data) {
    const statusLabel = { green: 'Controles a jour', orange: 'Point a surveiller', red: 'Action immediate requise' }[data.status] || data.status;
    els.status.innerHTML = `<span class="quality-badge">${escapeHtml(String(data.status).toUpperCase())}</span><h3>${escapeHtml(statusLabel)}</h3><p class="quality-muted">Genere le ${formatDate(data.today.generated_at)}</p>`;
    els.today.innerHTML = Object.entries(data.today.summary).map(([key, value]) => `<article class="quality-card"><span class="quality-badge">${escapeHtml(key)}</span><h3>${value || 0}</h3></article>`).join('');
    els.completed.innerHTML = table(['Heure', 'Type', 'Titre', 'Zone', 'Operateur', 'Resultat', 'Observation'], (data.completed_items || []).map((item) => `<tr><td>${formatDate(item.next_due_at)}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.zone_name || '-')}</td><td>${escapeHtml(item.operator_email || '-')}</td><td>${escapeHtml(resultLabel(item))}</td><td>${escapeHtml(item.comment || '-')}</td></tr>`));
    els.temperatures.innerHTML = table(['Date', 'Type', 'Zone', 'Equipement', 'Valeur', 'Statut'], data.temperature_records.map((record) => `<tr><td>${formatDate(record.recorded_at)}</td><td>${escapeHtml(record.type_label || record.type_code)}</td><td>${escapeHtml(record.zone_name || '-')}</td><td>${escapeHtml(record.equipment_name || '-')}</td><td>${escapeHtml(record.value)} ${escapeHtml(record.unit || '')}</td><td>${escapeHtml(record.alert_status)}</td></tr>`));
    els.cleaning.innerHTML = table(['Date', 'Plan', 'Zones', 'Equipements', 'Resultat', 'Operateur'], data.cleaning_records.map((record) => `<tr><td>${formatDate(record.performed_at)}</td><td>${escapeHtml(record.plan_title || '-')}</td><td>${escapeHtml((record.zones || []).map((zone) => zone.name).join(', ') || '-')}</td><td>${escapeHtml((record.equipments || []).map((equipment) => equipment.name).join(', ') || '-')}</td><td>${escapeHtml(record.status)}</td><td>${escapeHtml(record.performed_by_email || '-')}</td></tr>`));
    els.nc.innerHTML = data.today.sections.non_conformities.length ? data.today.sections.non_conformities.map((item) => `<article class="quality-card quality-temperature-alert"><span class="quality-badge">${escapeHtml(item.severity)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><p class="quality-muted">${formatDate(item.created_at)}</p></article>`).join('') : '<div class="quality-empty-state">Aucune non-conformite ouverte.</div>';
    els.actions.innerHTML = data.corrective_actions.length ? data.corrective_actions.map((item) => `<article class="quality-card"><span class="quality-badge">${escapeHtml(item.status)}</span><h3>${escapeHtml(item.action)}</h3><p class="quality-muted">Echeance : ${formatDate(item.due_at)} - Responsable : ${escapeHtml(item.responsible_email || '-')}</p></article>`).join('') : '<div class="quality-empty-state">Aucune action corrective ouverte.</div>';
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
  load().catch((error) => setFeedback(error.message, 'error'));
})();
