(function () {
  const user = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  if (!user || !token) { window.location.href = '../../login.html'; return; }

  const api = window.QualityTemperatureApi;
  const twin = window.QualityDigitalTwinApi;
  const tasksApi = window.QualityTasksApi;
  const canManage = window.hasQualityPermission?.(user, 'quality.equipment.manage');
  const $ = (id) => document.getElementById(id);
  const els = {
    feedback: $('temperature-settings-feedback'),
    list: $('temperature-setting-list'),
    addBtn: $('temperature-setting-add-btn'),
    formCard: $('temperature-setting-form-card'),
    form: $('temperature-setting-form'),
    title: $('temperature-setting-form-title'),
    id: $('temperature-setting-id'),
    type: $('temperature-setting-type'),
    min: $('temperature-setting-min'),
    max: $('temperature-setting-max'),
    unit: $('temperature-setting-unit'),
    zoneId: $('temperature-setting-zone-id'),
    equipmentId: $('temperature-setting-equipment-id'),
    from: $('temperature-setting-from'),
    until: $('temperature-setting-until'),
    active: $('temperature-setting-active'),
    planningMode: $('temperature-setting-planning-mode'),
    taskId: $('temperature-setting-quality-task-id'),
    taskTitle: $('temperature-setting-task-title'),
    taskResponsible: $('temperature-setting-task-responsible'),
    frequencyValue: $('temperature-setting-frequency-value'),
    frequencyUnit: $('temperature-setting-frequency-unit'),
    targetTime: $('temperature-setting-target-time'),
    cancelBtn: $('temperature-setting-cancel-btn'),
  };

  let types = [];
  let zones = [];
  let equipments = [];
  let settings = [];
  let tasks = [];
  let users = [];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));
  }

  function setFeedback(message = '', type = '') {
    els.feedback.textContent = message;
    els.feedback.className = message ? `page-feedback ${type}`.trim() : 'page-feedback hidden';
  }

  function formatDate(value) {
    return value ? new Date(value).toLocaleString('fr-FR') : '-';
  }

  function typeOptions() {
    return types.map((type) => `<option value="${escapeHtml(type.code)}">${escapeHtml(type.label)}</option>`).join('');
  }

  function zoneOptions() {
    return `<option value="">Toutes zones</option>${zones.map((zone) => `<option value="${escapeHtml(zone.id)}">${escapeHtml(zone.code)} - ${escapeHtml(zone.name)}</option>`).join('')}`;
  }

  function equipmentOptions() {
    return `<option value="">Tous équipements</option>${equipments.map((equipment) => `<option value="${escapeHtml(equipment.id)}">${escapeHtml(equipment.code)} - ${escapeHtml(equipment.name)}</option>`).join('')}`;
  }

  function taskFrequencyLabel(task) {
    if (!task?.frequency_value || !task?.frequency_unit) return '-';
    const units = { hours: 'h', days: 'j', weeks: 'sem.', months: 'mois', events: 'événement(s)' };
    return `${task.frequency_value} ${units[task.frequency_unit] || task.frequency_unit}`;
  }

  function taskStatusLabel(task) {
    if (!task) return 'Non planifié';
    const status = task.computed_status || task.status;
    return { planned: 'Planifiée', due: 'Du jour', overdue: 'En retard', completed: 'Terminée', paused: 'Suspendue', cancelled: 'Annulée' }[status] || status;
  }

  function statusLabel(status) {
    return { compliant: 'Conforme', warning: 'À surveiller', missing: 'Relevé manquant', out_of_limits: 'Hors limite', inactive: 'Inactif', unplanned: 'Non planifié' }[status] || 'À surveiller';
  }

  function statusClass(status) {
    if (status === 'compliant') return 'quality-temperature-ok';
    if (status === 'out_of_limits') return 'quality-temperature-alert';
    if (status === 'missing') return 'quality-temperature-missing';
    if (status === 'unplanned') return '';
    return 'quality-temperature-warning';
  }

  function objectName() {
    const equipment = equipments.find((item) => item.id === els.equipmentId.value);
    if (equipment) return equipment.name || equipment.code;
    const zone = zones.find((item) => item.id === els.zoneId.value);
    if (zone) return zone.name || zone.code;
    const type = types.find((item) => item.code === els.type.value);
    return type?.label || 'Tous';
  }

  function taskEntity() {
    if (els.equipmentId.value) return { entity_type: 'equipment', entity_id: els.equipmentId.value };
    if (els.zoneId.value) return { entity_type: 'zone', entity_id: els.zoneId.value };
    return { entity_type: null, entity_id: null };
  }

  function refreshTaskTitle() {
    if (els.planningMode.value !== 'new' || els.taskTitle.dataset.touched === 'true') return;
    els.taskTitle.value = `Relevé température - ${objectName()}`;
  }

  function fillSelects() {
    els.type.innerHTML = typeOptions();
    els.zoneId.innerHTML = zoneOptions();
    els.equipmentId.innerHTML = equipmentOptions();
    els.taskResponsible.innerHTML = '<option value="">Non assigné</option>';
    users.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.email;
      els.taskResponsible.appendChild(option);
    });
    refreshTaskOptions();
  }

  function refreshTaskOptions(selectedId = '') {
    els.taskId.innerHTML = '<option value="">Aucune tâche sélectionnée</option>';
    tasks.forEach((task) => {
      const option = document.createElement('option');
      option.value = task.id;
      option.textContent = `${task.title} · ${taskFrequencyLabel(task)} · ${formatDate(task.next_due_at)}`;
      els.taskId.appendChild(option);
    });
    if (selectedId && !tasks.some((task) => task.id === selectedId)) {
      const option = document.createElement('option');
      option.value = selectedId;
      option.textContent = `Tâche liée (${selectedId})`;
      els.taskId.appendChild(option);
    }
    els.taskId.value = selectedId || '';
  }

  function refreshPlanningMode() {
    const mode = els.planningMode.value;
    const existingVisible = mode === 'existing';
    const newVisible = mode === 'new';
    $('temperature-setting-existing-task-label').classList.toggle('hidden', !existingVisible);
    $('temperature-setting-task-title-label').classList.toggle('hidden', !newVisible);
    $('temperature-setting-task-responsible-label').classList.toggle('hidden', !newVisible);
    $('temperature-setting-task-frequency-value-label').classList.toggle('hidden', !newVisible);
    $('temperature-setting-task-frequency-unit-label').classList.toggle('hidden', !newVisible);
    $('temperature-setting-task-target-time-label').classList.toggle('hidden', !newVisible);
    refreshTaskTitle();
  }

  function legacyFrequencyFromTask(task) {
    if (!task || !['hours', 'days', 'events'].includes(task.frequency_unit)) {
      return { expected_frequency_value: null, expected_frequency_unit: null, target_time: null };
    }
    return {
      expected_frequency_value: task.frequency_value,
      expected_frequency_unit: task.frequency_unit,
      target_time: task.target_time,
    };
  }

  function basePayload(qualityTaskId, linkedTask = null) {
    return {
      type_code: els.type.value,
      min_value: els.min.value,
      max_value: els.max.value,
      unit: els.unit.value || '°C',
      ...legacyFrequencyFromTask(linkedTask),
      quality_task_id: qualityTaskId,
      zone_id: els.zoneId.value,
      equipment_id: els.equipmentId.value,
      valid_from: els.from.value,
      valid_until: els.until.value,
      is_active: els.active.checked,
    };
  }

  async function createTaskIfNeeded() {
    if (els.planningMode.value === 'none') return { qualityTaskId: null, linkedTask: null };
    if (els.planningMode.value === 'existing') {
      const task = tasks.find((item) => item.id === els.taskId.value) || null;
      return { qualityTaskId: els.taskId.value || null, linkedTask: task };
    }
    const entity = taskEntity();
    const payload = {
      title: els.taskTitle.value || `Relevé température - ${objectName()}`,
      module_key: 'temperature',
      ...entity,
      responsible_user_id: els.taskResponsible.value || null,
      frequency_value: els.frequencyValue.value || null,
      frequency_unit: els.frequencyUnit.value || null,
      target_time: els.targetTime.value || null,
      status: 'planned',
      active: true,
      description: 'Tâche générée depuis les paramètres températures.',
    };
    const task = await tasksApi.save(payload);
    tasks.push(task);
    refreshTaskOptions(task.id);
    return { qualityTaskId: task.id, linkedTask: task };
  }

  function resetForm() {
    els.form.reset();
    els.id.value = '';
    els.unit.value = '°C';
    els.from.value = new Date().toISOString().slice(0, 10);
    els.active.checked = true;
    els.planningMode.value = 'new';
    els.taskTitle.dataset.touched = 'false';
    els.title.textContent = 'Nouveau paramétrage';
    refreshPlanningMode();
    refreshTaskTitle();
    els.formCard.classList.remove('hidden');
  }

  function fillForm(item) {
    els.id.value = item.id;
    els.type.value = item.type_code;
    els.min.value = item.min_value ?? '';
    els.max.value = item.max_value ?? '';
    els.unit.value = item.unit || '°C';
    els.zoneId.value = item.zone_id || '';
    els.equipmentId.value = item.equipment_id || '';
    els.from.value = item.valid_from || '';
    els.until.value = item.valid_until || '';
    els.active.checked = Boolean(item.is_active);
    els.planningMode.value = item.quality_task_id ? 'existing' : 'none';
    refreshTaskOptions(item.quality_task_id || '');
    els.taskTitle.dataset.touched = 'false';
    els.taskTitle.value = item.quality_task?.title || `Relevé température - ${objectName()}`;
    els.frequencyValue.value = item.quality_task?.frequency_value || item.expected_frequency_value || '';
    els.frequencyUnit.value = item.quality_task?.frequency_unit || item.expected_frequency_unit || '';
    els.targetTime.value = item.quality_task?.target_time ? String(item.quality_task.target_time).slice(0, 5) : (item.target_time || '');
    els.title.textContent = 'Modifier le paramétrage';
    refreshPlanningMode();
    els.formCard.classList.remove('hidden');
  }

  function render() {
    if (!settings.length) {
      els.list.innerHTML = '<div class="quality-empty-state">Aucun paramétrage température.</div>';
      return;
    }
    els.list.innerHTML = settings.map((item) => {
      const task = item.quality_task;
      const planning = task
        ? `<p class="quality-muted"><strong>Tâche :</strong> ${escapeHtml(task.title)} · ${taskFrequencyLabel(task)} · prochaine échéance ${formatDate(task.next_due_at)} · ${taskStatusLabel(task)}</p>`
        : '<p class="quality-muted"><strong>Tâche :</strong> Non planifié</p>';
      return `<article class="quality-card ${statusClass(item.followup_status)}"><span class="quality-badge">${statusLabel(item.followup_status)}</span><h3>${escapeHtml(item.equipment_name || item.zone_name || item.type_label)}</h3><p>${escapeHtml(item.type_label)} · ${item.min_value ?? '-'}${escapeHtml(item.unit)} à ${item.max_value ?? '-'}${escapeHtml(item.unit)}</p>${planning}<p class="quality-muted">Dernier relevé : ${formatDate(item.last_recorded_at)}</p><div class="quality-actions"><button class="btn btn-secondary" data-action="edit" data-id="${item.id}">Modifier</button><button class="btn btn-secondary" data-action="toggle" data-id="${item.id}">${item.is_active ? 'Désactiver' : 'Réactiver'}</button><button class="btn btn-secondary" data-action="archive" data-id="${item.id}">Archiver</button></div></article>`;
    }).join('');
    if (!canManage) els.list.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  }

  async function loadUsers() {
    const apiBase = window.APP_CONFIG?.API_BASE_URL || '';
    try {
      const response = await fetch(`${apiBase}/api/users`, { headers: { Authorization: `Bearer ${token}` } });
      users = response.ok ? await response.json() : [];
    } catch (error) {
      users = [];
    }
  }

  async function load() {
    setFeedback('Chargement des paramètres...');
    try {
      [tasks, settings] = await Promise.all([
        tasksApi.list({ module: 'temperature', active: 'true' }),
        api.listLimits({ active_only: 'false' }),
      ]);
      refreshTaskOptions();
      render();
      setFeedback('');
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  }

  async function init() {
    [types, zones, equipments] = await Promise.all([
      api.listTypes(),
      twin.listZones({ include_archived: 'false' }),
      twin.listEquipments({ include_archived: 'false' }),
      loadUsers(),
    ]).then(([loadedTypes, loadedZones, loadedEquipments]) => [loadedTypes, loadedZones, loadedEquipments]);
    fillSelects();
    els.addBtn.disabled = !canManage;
    await load();
  }

  els.addBtn.addEventListener('click', resetForm);
  els.cancelBtn.addEventListener('click', () => els.formCard.classList.add('hidden'));
  els.planningMode.addEventListener('change', refreshPlanningMode);
  els.taskTitle.addEventListener('input', () => { els.taskTitle.dataset.touched = 'true'; });
  [els.zoneId, els.equipmentId, els.type].forEach((input) => input.addEventListener('change', refreshTaskTitle));
  els.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canManage) return;
    try {
      const { qualityTaskId, linkedTask } = await createTaskIfNeeded();
      await api.saveLimit(basePayload(qualityTaskId, linkedTask), els.id.value || null);
      els.formCard.classList.add('hidden');
      await load();
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });
  els.list.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || !canManage) return;
    const item = settings.find((setting) => setting.id === button.dataset.id);
    if (!item) return;
    if (button.dataset.action === 'edit') return fillForm(item);
    try {
      if (button.dataset.action === 'toggle') await api.saveLimit({ ...item, is_active: !item.is_active }, item.id);
      if (button.dataset.action === 'archive') await api.deleteLimit(item.id);
      await load();
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });

  init().catch((error) => setFeedback(error.message, 'error'));
})();
