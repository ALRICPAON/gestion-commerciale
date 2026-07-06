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
    title: $('cleaning-plan-title'), entityKind: $('cleaning-plan-entity-kind'), linkedLabel: $('cleaning-plan-linked-label'), linkedObject: $('cleaning-plan-linked-object'),
    product: $('cleaning-plan-product'), duration: $('cleaning-plan-duration'), active: $('cleaning-plan-active'), method: $('cleaning-plan-method'),
    safety: $('cleaning-plan-safety'), description: $('cleaning-plan-description'), planningMode: $('cleaning-plan-planning-mode'),
    taskId: $('cleaning-plan-quality-task-id'), taskTitle: $('cleaning-plan-task-title'), taskResponsible: $('cleaning-plan-task-responsible'),
    frequencyValue: $('cleaning-plan-frequency-value'), frequencyUnit: $('cleaning-plan-frequency-unit'), targetTime: $('cleaning-plan-target-time'), cancelBtn: $('cleaning-plan-cancel-btn'),
  };
  let plans = []; let zones = []; let equipments = []; let tasks = []; let users = [];

  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  function setFeedback(message = '', type = '') { els.feedback.textContent = message; els.feedback.className = message ? `page-feedback ${type}`.trim() : 'page-feedback hidden'; }
  function formatDate(value) { return value ? new Date(value).toLocaleString('fr-FR') : '-'; }
  function taskFrequency(task) { if (!task?.frequency_value) return '-'; const units = { hours: 'h', days: 'j', weeks: 'sem.', months: 'mois', events: 'événement(s)' }; return `${task.frequency_value} ${units[task.frequency_unit] || task.frequency_unit}`; }
  function taskStatus(task) { const status = task?.computed_status || task?.status; return { planned: 'Planifiée', due: 'Du jour', overdue: 'En retard', completed: 'Terminée', paused: 'Suspendue', cancelled: 'Annulée' }[status] || 'Non planifié'; }
  function objectLabel(item) { if (!item) return ''; return `${item.code ? `${item.code} - ` : ''}${item.name || item.id}${item.zone_name ? ` (${item.zone_name})` : ''}`; }

  function refreshLinkedObject(selectedId = '') {
    const kind = els.entityKind.value;
    const items = kind === 'zone' ? zones : kind === 'equipment' ? equipments : [];
    els.linkedLabel.firstChild.textContent = kind === 'zone' ? 'Zone' : kind === 'equipment' ? 'Équipement' : 'Zone / Équipement';
    els.linkedObject.innerHTML = '<option value="">Aucun objet lié</option>';
    els.linkedObject.disabled = !kind;
    items.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = objectLabel(item);
      els.linkedObject.appendChild(option);
    });
    els.linkedObject.value = selectedId || '';
  }

  function refreshTaskOptions(selectedId = '') {
    els.taskId.innerHTML = '<option value="">Aucune tâche sélectionnée</option>';
    tasks.forEach((task) => {
      const option = document.createElement('option');
      option.value = task.id;
      option.textContent = `${task.title} · ${taskFrequency(task)} · ${formatDate(task.next_due_at)}`;
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

  function refreshUsers() {
    els.taskResponsible.innerHTML = '<option value="">Non assigné</option>';
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

  function entityPayload() {
    if (els.entityKind.value === 'zone') return { zone_id: els.linkedObject.value || null, equipment_id: null };
    if (els.entityKind.value === 'equipment') return { zone_id: null, equipment_id: els.linkedObject.value || null };
    return { zone_id: null, equipment_id: null };
  }

  function taskEntity() {
    const entity = entityPayload();
    if (entity.equipment_id) return { entity_type: 'equipment', entity_id: entity.equipment_id };
    if (entity.zone_id) return { entity_type: 'zone', entity_id: entity.zone_id };
    return { entity_type: null, entity_id: null };
  }

  async function createTaskIfNeeded() {
    if (els.planningMode.value === 'none') return null;
    if (els.planningMode.value === 'existing') return els.taskId.value || null;
    const task = await tasksApi.save({
      title: els.taskTitle.value || `Nettoyage - ${els.title.value}`,
      module_key: 'cleaning',
      ...taskEntity(),
      responsible_user_id: els.taskResponsible.value || null,
      frequency_value: els.frequencyValue.value || null,
      frequency_unit: els.frequencyUnit.value || null,
      target_time: els.targetTime.value || null,
      status: 'planned',
      active: true,
      description: 'Tâche générée depuis un plan de nettoyage.',
    });
    tasks.push(task);
    refreshTaskOptions(task.id);
    return task.id;
  }

  function payload(taskId) {
    return {
      title: els.title.value,
      description: els.description.value,
      ...entityPayload(),
      product_name: els.product.value,
      method: els.method.value,
      safety_instructions: els.safety.value,
      expected_duration_minutes: els.duration.value || null,
      quality_task_id: taskId,
      active: els.active.checked,
    };
  }

  function resetForm() {
    els.form.reset();
    els.id.value = '';
    els.active.checked = true;
    els.planningMode.value = 'new';
    els.taskTitle.dataset.touched = 'false';
    els.formTitle.textContent = 'Nouveau plan';
    refreshLinkedObject();
    refreshPlanningMode();
    els.formCard.classList.remove('hidden');
  }

  function fillForm(plan) {
    els.id.value = plan.id;
    els.title.value = plan.title || '';
    els.product.value = plan.product_name || '';
    els.duration.value = plan.expected_duration_minutes || '';
    els.method.value = plan.method || '';
    els.safety.value = plan.safety_instructions || '';
    els.description.value = plan.description || '';
    els.active.checked = Boolean(plan.active);
    els.entityKind.value = plan.equipment_id ? 'equipment' : plan.zone_id ? 'zone' : '';
    refreshLinkedObject(plan.equipment_id || plan.zone_id || '');
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

  function render() {
    if (!plans.length) {
      els.list.innerHTML = '<div class="quality-empty-state">Aucun plan de nettoyage.</div>';
      return;
    }
    els.list.innerHTML = plans.map((plan) => {
      const place = plan.equipment_name || plan.zone_name || 'Non rattaché';
      const task = plan.quality_task ? `${escapeHtml(plan.quality_task.title)} · ${taskFrequency(plan.quality_task)} · ${formatDate(plan.quality_task.next_due_at)} · ${taskStatus(plan.quality_task)}` : 'Non planifié';
      return `<article class="quality-card"><span class="quality-badge">${plan.active ? 'Actif' : 'Inactif'}</span><h3>${escapeHtml(plan.title)}</h3><p>${escapeHtml(place)} · Produit : ${escapeHtml(plan.product_name || '-')} · Durée : ${plan.expected_duration_minutes || '-'} min</p><p class="quality-muted"><strong>Tâche :</strong> ${task}</p><p class="quality-muted">${escapeHtml(plan.method || '')}</p><div class="quality-actions"><button class="btn btn-secondary" data-action="edit" data-id="${plan.id}">Modifier</button><button class="btn btn-secondary" data-action="toggle" data-id="${plan.id}">${plan.active ? 'Désactiver' : 'Réactiver'}</button></div></article>`;
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
    refreshLinkedObject();
    els.addBtn.disabled = !canManage;
    await load();
  }

  els.addBtn.addEventListener('click', resetForm);
  els.cancelBtn.addEventListener('click', () => els.formCard.classList.add('hidden'));
  els.entityKind.addEventListener('change', () => refreshLinkedObject());
  els.planningMode.addEventListener('change', refreshPlanningMode);
  els.title.addEventListener('input', refreshPlanningMode);
  els.taskTitle.addEventListener('input', () => { els.taskTitle.dataset.touched = 'true'; });
  els.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canManage) return;
    try {
      const taskId = await createTaskIfNeeded();
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
    if (button.dataset.action === 'edit') return fillForm(plan);
    try {
      await api.updatePlanStatus(plan.id, !plan.active);
      await load();
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });

  init().catch((error) => setFeedback(error.message, 'error'));
})();
