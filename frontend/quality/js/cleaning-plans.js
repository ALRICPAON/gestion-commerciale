(function () {
  const user = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  if (!user || !token) { window.location.href = '../../login.html'; return; }

  const api = window.QualityCleaningApi;
  const twin = window.QualityDigitalTwinApi;
  const tasksApi = window.QualityTasksApi;
  const canManage = window.hasQualityPermission?.(user, 'quality.equipment.manage');
  const $ = (id) => document.getElementById(id);
  const els = {
    feedback: $('cleaning-plans-feedback'), list: $('cleaning-plan-list'), addBtn: $('cleaning-plan-add-btn'),
    formCard: $('cleaning-plan-form-card'), form: $('cleaning-plan-form'), formTitle: $('cleaning-plan-form-title'), id: $('cleaning-plan-id'),
    title: $('cleaning-plan-title'), zoneIds: $('cleaning-plan-zone-ids'), equipmentSearch: $('cleaning-plan-equipment-search'),
    equipmentOptions: $('cleaning-plan-equipment-options'), selectZoneEquipments: $('cleaning-plan-select-zone-equipments'), clearEquipments: $('cleaning-plan-clear-equipments'),
    product: $('cleaning-plan-product'), duration: $('cleaning-plan-duration'), active: $('cleaning-plan-active'), method: $('cleaning-plan-method'),
    safety: $('cleaning-plan-safety'), description: $('cleaning-plan-description'), planningMode: $('cleaning-plan-planning-mode'),
    taskId: $('cleaning-plan-quality-task-id'), taskTitle: $('cleaning-plan-task-title'), taskResponsible: $('cleaning-plan-task-responsible'),
    frequencyValue: $('cleaning-plan-frequency-value'), frequencyUnit: $('cleaning-plan-frequency-unit'), targetTime: $('cleaning-plan-target-time'), cancelBtn: $('cleaning-plan-cancel-btn'),
  };
  let plans = []; let zones = []; let equipments = []; let tasks = []; let users = []; let selectedEquipmentIds = new Set();

  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  function setFeedback(message = '', type = '') { els.feedback.textContent = message; els.feedback.className = message ? `page-feedback ${type}`.trim() : 'page-feedback hidden'; }
  function formatDate(value) { return value ? new Date(value).toLocaleString('fr-FR') : '-'; }
  function taskFrequency(task) { if (!task?.frequency_value) return '-'; const units = { hours: 'h', days: 'j', weeks: 'sem.', months: 'mois', events: 'evenement(s)' }; return `${task.frequency_value} ${units[task.frequency_unit] || task.frequency_unit}`; }
  function taskStatus(task) { const status = task?.computed_status || task?.status; return { planned: 'Planifiee', due: 'Du jour', overdue: 'En retard', completed: 'Terminee', paused: 'Suspendue', cancelled: 'Annulee' }[status] || 'Non planifie'; }
  function objectLabel(item) { if (!item) return ''; return `${item.code ? `${item.code} - ` : ''}${item.name || item.id}${item.zone_name ? ` (${item.zone_name})` : ''}`; }
  function selectedZoneIds() { return [...els.zoneIds.options].filter((option) => option.selected).map((option) => option.value).filter(Boolean); }
  function normalizeItems(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
  function resolveKnownId(item, collection) {
    if (!item) return null;
    const raw = typeof item === 'object' ? (item.id || item.zone_id || item.equipment_id || item.code) : item;
    if (!raw) return null;
    const value = String(raw);
    const direct = collection.find((entry) => String(entry.id) === value);
    if (direct) return direct.id;
    const byCode = collection.find((entry) => entry.code && String(entry.code) === value);
    return byCode?.id || null;
  }
  function uniqueIds(items, collection) {
    return [...new Set(normalizeItems(items).map((item) => resolveKnownId(item, collection)).filter(Boolean))];
  }
  function planZoneIds(plan) {
    const fromZones = uniqueIds(plan.zones, zones);
    if (fromZones.length) return fromZones;
    return uniqueIds([plan.zone_id || plan.zone_code], zones);
  }
  function planEquipmentIds(plan) {
    const fromEquipments = uniqueIds(plan.equipments, equipments);
    if (fromEquipments.length) return fromEquipments;
    return uniqueIds([plan.equipment_id || plan.equipment_code], equipments);
  }
  function planZones(plan) { const ids = planZoneIds(plan); return ids.map((id) => zones.find((zone) => zone.id === id)).filter(Boolean); }
  function planEquipments(plan) { const ids = planEquipmentIds(plan); return ids.map((id) => equipments.find((equipment) => equipment.id === id)).filter(Boolean); }
  function names(items) { return items.map((item) => item.name || item.code || item.id).filter(Boolean).join(', ') || '-'; }

  function refreshZones(selectedIds = []) {
    const selected = new Set(selectedIds.map(String));
    els.zoneIds.innerHTML = '';
    zones.forEach((zone) => {
      const option = document.createElement('option');
      option.value = zone.id;
      option.textContent = objectLabel(zone);
      option.selected = selected.has(String(zone.id));
      els.zoneIds.appendChild(option);
    });
  }

  function refreshEquipments() {
    const zoneFilter = new Set(selectedZoneIds());
    const search = String(els.equipmentSearch.value || '').trim().toLowerCase();
    const visible = equipments.filter((equipment) => {
      const inZone = !zoneFilter.size || zoneFilter.has(equipment.zone_id);
      const label = objectLabel(equipment).toLowerCase();
      return inZone && (!search || label.includes(search));
    });
    if (!visible.length) {
      els.equipmentOptions.innerHTML = '<div class="quality-muted">Aucun equipement.</div>';
      return;
    }
    els.equipmentOptions.innerHTML = visible.map((equipment) => `
      <label class="quality-checkbox-option">
        <input type="checkbox" value="${escapeHtml(equipment.id)}" ${selectedEquipmentIds.has(equipment.id) ? 'checked' : ''}>
        <span>${escapeHtml(objectLabel(equipment))}</span>
      </label>
    `).join('');
  }

  function refreshTaskOptions(selectedId = '') {
    els.taskId.innerHTML = '<option value="">Aucune tache selectionnee</option>';
    tasks.forEach((task) => {
      const option = document.createElement('option');
      option.value = task.id;
      option.textContent = `${task.title} - ${taskFrequency(task)} - ${formatDate(task.next_due_at)}`;
      els.taskId.appendChild(option);
    });
    if (selectedId && !tasks.some((task) => task.id === selectedId)) {
      const option = document.createElement('option');
      option.value = selectedId;
      option.textContent = `Tache liee (${selectedId})`;
      els.taskId.appendChild(option);
    }
    els.taskId.value = selectedId || '';
  }

  function refreshUsers() {
    els.taskResponsible.innerHTML = '<option value="">Non assigne</option>';
    users.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.email;
      els.taskResponsible.appendChild(option);
    });
  }

  function refreshPlanningMode() {
    const mode = els.planningMode.value;
    const existing = mode === 'existing';
    const create = mode === 'new';
    $('cleaning-plan-existing-task-label').classList.toggle('hidden', !existing);
    $('cleaning-plan-task-title-label').classList.toggle('hidden', !create);
    $('cleaning-plan-task-responsible-label').classList.toggle('hidden', !create);
    $('cleaning-plan-frequency-value-label').classList.toggle('hidden', !create);
    $('cleaning-plan-frequency-unit-label').classList.toggle('hidden', !create);
    $('cleaning-plan-target-time-label').classList.toggle('hidden', !create);
    if (create && els.taskTitle.dataset.touched !== 'true') els.taskTitle.value = `Nettoyage - ${els.title.value || 'Plan'}`;
  }

  function taskDescription() {
    const zoneLabels = zones.filter((zone) => selectedZoneIds().includes(zone.id)).map((zone) => zone.name || zone.code);
    const equipmentLabels = equipments.filter((equipment) => selectedEquipmentIds.has(equipment.id)).map((equipment) => equipment.name || equipment.code);
    return [
      'Tache generee depuis un plan de nettoyage.',
      zoneLabels.length ? `Zones: ${zoneLabels.join(', ')}` : null,
      equipmentLabels.length ? `Equipements: ${equipmentLabels.join(', ')}` : null,
    ].filter(Boolean).join(' ');
  }

  async function resolvePlanTaskId() {
    if (els.planningMode.value === 'none') return null;
    if (els.planningMode.value === 'existing') return els.taskId.value || null;
    return null;
  }

  function payload(taskId) {
    const zoneIds = selectedZoneIds();
    const equipmentIds = [...selectedEquipmentIds];
    return {
      title: els.title.value,
      description: els.description.value,
      zone_id: zoneIds[0] || null,
      equipment_id: equipmentIds[0] || null,
      zone_ids: zoneIds,
      equipment_ids: equipmentIds,
      product_name: els.product.value,
      method: els.method.value,
      safety_instructions: els.safety.value,
      expected_duration_minutes: els.duration.value || null,
      responsible_user_id: els.taskResponsible.value || null,
      frequency_value: els.frequencyValue.value || null,
      frequency_unit: els.frequencyUnit.value || null,
      target_time: els.targetTime.value || null,
      task_description: taskDescription(),
      quality_task_id: taskId,
      active: els.active.checked,
    };
  }

  function resetForm() {
    els.form.reset();
    els.id.value = '';
    selectedEquipmentIds = new Set();
    els.active.checked = true;
    els.planningMode.value = 'new';
    els.taskTitle.dataset.touched = 'false';
    els.formTitle.textContent = 'Nouveau plan';
    refreshZones();
    refreshEquipments();
    refreshPlanningMode();
    els.formCard.classList.remove('hidden');
  }

  function fillForm(plan) {
    const zoneIds = planZoneIds(plan);
    const equipmentIds = planEquipmentIds(plan);
    els.id.value = plan.id;
    els.title.value = plan.title || '';
    els.product.value = plan.product_name || '';
    els.duration.value = plan.expected_duration_minutes || '';
    els.method.value = plan.method || '';
    els.safety.value = plan.safety_instructions || '';
    els.description.value = plan.description || '';
    els.active.checked = Boolean(plan.active);
    selectedEquipmentIds = new Set(equipmentIds);
    refreshZones(zoneIds);
    refreshEquipments();
    els.planningMode.value = plan.quality_task_id ? 'existing' : 'none';
    refreshTaskOptions(plan.quality_task_id || '');
    els.taskTitle.value = plan.quality_task?.title || `Nettoyage - ${plan.title}`;
    els.frequencyValue.value = plan.quality_task?.frequency_value || '';
    els.frequencyUnit.value = plan.quality_task?.frequency_unit || '';
    els.targetTime.value = plan.quality_task?.target_time ? String(plan.quality_task.target_time).slice(0, 5) : '';
    els.formTitle.textContent = 'Modifier le plan';
    refreshPlanningMode();
    els.formCard.classList.remove('hidden');
  }

  async function openEditForm(planId) {
    setFeedback('Chargement du plan...');
    const plan = await api.getPlan(planId);
    fillForm(plan);
    setFeedback('');
  }

  function render() {
    if (!plans.length) {
      els.list.innerHTML = '<div class="quality-empty-state">Aucun plan de nettoyage.</div>';
      return;
    }
    els.list.innerHTML = plans.map((plan) => {
      const zoneNames = names(planZones(plan));
      const equipmentNames = names(planEquipments(plan));
      const task = plan.quality_task ? `${escapeHtml(plan.quality_task.title)} - ${taskFrequency(plan.quality_task)} - ${formatDate(plan.quality_task.next_due_at)} - ${taskStatus(plan.quality_task)}` : 'Non planifie';
      return `<article class="quality-card"><span class="quality-badge">${plan.active ? 'Actif' : 'Inactif'}</span><h3>${escapeHtml(plan.title)}</h3><p>Produit : ${escapeHtml(plan.product_name || '-')} - Duree : ${plan.expected_duration_minutes || '-'} min</p><p class="quality-muted"><strong>Zones concernees :</strong> ${escapeHtml(zoneNames)}</p><p class="quality-muted"><strong>Equipements concernes :</strong> ${escapeHtml(equipmentNames)}</p><p class="quality-muted"><strong>Tache :</strong> ${task}</p><p class="quality-muted">${escapeHtml(plan.method || '')}</p><div class="quality-actions"><button class="btn btn-secondary" data-action="edit" data-id="${plan.id}">Modifier</button><button class="btn btn-secondary" data-action="toggle" data-id="${plan.id}">${plan.active ? 'Desactiver' : 'Reactiver'}</button></div></article>`;
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
    setFeedback('Chargement des plans...');
    try {
      [tasks, plans] = await Promise.all([
        tasksApi.list({ module: 'cleaning', active: 'true' }),
        api.listPlans({ active: '' }),
      ]);
      refreshTaskOptions();
      render();
      setFeedback('');
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  }

  async function init() {
    [zones, equipments] = await Promise.all([
      twin.listZones({ include_archived: 'false' }),
      twin.listEquipments({ include_archived: 'false' }),
      loadUsers(),
    ]).then(([loadedZones, loadedEquipments]) => [loadedZones, loadedEquipments]);
    refreshUsers();
    refreshZones();
    refreshEquipments();
    els.addBtn.disabled = !canManage;
    await load();
  }

  els.addBtn.addEventListener('click', resetForm);
  els.cancelBtn.addEventListener('click', () => els.formCard.classList.add('hidden'));
  els.zoneIds.addEventListener('change', refreshEquipments);
  els.equipmentSearch.addEventListener('input', refreshEquipments);
  els.equipmentOptions.addEventListener('change', (event) => {
    const checkbox = event.target.closest('input[type="checkbox"]');
    if (!checkbox) return;
    if (checkbox.checked) selectedEquipmentIds.add(checkbox.value);
    else selectedEquipmentIds.delete(checkbox.value);
  });
  els.selectZoneEquipments.addEventListener('click', () => {
    const zoneFilter = new Set(selectedZoneIds());
    equipments.forEach((equipment) => {
      if (!zoneFilter.size || zoneFilter.has(equipment.zone_id)) selectedEquipmentIds.add(equipment.id);
    });
    refreshEquipments();
  });
  els.clearEquipments.addEventListener('click', () => {
    selectedEquipmentIds = new Set();
    refreshEquipments();
  });
  els.planningMode.addEventListener('change', refreshPlanningMode);
  els.title.addEventListener('input', refreshPlanningMode);
  els.taskTitle.addEventListener('input', () => { els.taskTitle.dataset.touched = 'true'; });
  els.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canManage) return;
    try {
      const taskId = await resolvePlanTaskId();
      await api.savePlan(payload(taskId), els.id.value || null);
      els.formCard.classList.add('hidden');
      await load();
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });
  els.list.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || !canManage) return;
    const plan = plans.find((item) => item.id === button.dataset.id);
    if (!plan) return;
    if (button.dataset.action === 'edit') {
      try {
        await openEditForm(plan.id);
      } catch (error) {
        setFeedback(error.message, 'error');
      }
      return;
    }
    try {
      await api.updatePlanStatus(plan.id, !plan.active);
      await load();
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });

  if (window.__QUALITY_CLEANING_PLANS_TEST_MODE__) {
    window.__QualityCleaningPlansTest = {
      fillForm,
      openEditForm,
      planEquipmentIds,
      planZoneIds,
      refreshZones,
      selectedZoneIds,
      setData: (data = {}) => {
        zones = data.zones || zones;
        equipments = data.equipments || equipments;
        plans = data.plans || plans;
        tasks = data.tasks || tasks;
        users = data.users || users;
        selectedEquipmentIds = new Set(data.selectedEquipmentIds || []);
      },
      state: () => ({ selectedEquipmentIds: [...selectedEquipmentIds] }),
    };
  } else {
    init().catch((error) => setFeedback(error.message, 'error'));
  }
})();
