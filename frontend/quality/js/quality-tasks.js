(function () {
  const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const authToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';

  if (!sessionUser || !authToken) {
    window.location.href = '../../login.html';
    return;
  }

  const els = {
    userName: document.getElementById('user-name'),
    dashboardBtn: document.getElementById('dashboard-btn'),
    logoutBtn: document.getElementById('logout-btn'),
    filterModule: document.getElementById('filter-module'),
    filterResponsible: document.getElementById('filter-responsible'),
    filterActive: document.getElementById('filter-active'),
    tasksList: document.getElementById('tasks-list'),
    newTaskBtn: document.getElementById('new-task-btn'),
    formCard: document.getElementById('task-form-card'),
    form: document.getElementById('task-form'),
    formTitle: document.getElementById('task-form-title'),
    formMessage: document.getElementById('task-form-message'),
    cancelBtn: document.getElementById('cancel-task-btn'),
    title: document.getElementById('task-title'),
    module: document.getElementById('task-module'),
    responsible: document.getElementById('task-responsible'),
    frequencyValue: document.getElementById('task-frequency-value'),
    frequencyUnit: document.getElementById('task-frequency-unit'),
    targetTime: document.getElementById('task-target-time'),
    nextDueAt: document.getElementById('task-next-due-at'),
    status: document.getElementById('task-status'),
    active: document.getElementById('task-active'),
    entityType: document.getElementById('task-entity-type'),
    entityId: document.getElementById('task-entity-id'),
    description: document.getElementById('task-description'),
  };

  let tasks = [];
  let users = [];
  let editingTaskId = null;

  if (els.userName) els.userName.textContent = sessionUser.email || 'Utilisateur';
  els.dashboardBtn?.addEventListener('click', () => { window.location.href = './dashboard.html'; });
  els.logoutBtn?.addEventListener('click', () => {
    ['grv2_token', 'grv2_user', 'grv2_active_department', 'gc_token', 'gc_user', 'gc_active_department'].forEach((key) => localStorage.removeItem(key));
    window.location.href = '../../login.html';
  });

  function formatDate(value) {
    if (!value) return '-';
    return new Date(value).toLocaleString('fr-FR');
  }

  function toDatetimeLocal(value) {
    if (!value) return '';
    const date = new Date(value);
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function fromDatetimeLocal(value) {
    return value ? new Date(value).toISOString() : null;
  }

  function frequencyLabel(task) {
    if (!task.frequency_value || !task.frequency_unit) return '-';
    const labels = { hours: 'heure(s)', days: 'jour(s)', weeks: 'semaine(s)', months: 'mois', events: 'événement(s)' };
    return `${task.frequency_value} ${labels[task.frequency_unit] || task.frequency_unit}`;
  }

  function statusLabel(task) {
    const status = task.computed_status || task.status;
    return { planned: 'Planifiée', due: 'Du jour', overdue: 'En retard', completed: 'Terminée', paused: 'Suspendue', cancelled: 'Annulée' }[status] || status;
  }

  function ensureOption(select, value, label) {
    if (!select || !value || Array.from(select.options).some((option) => option.value === value)) return;
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label || value;
    select.appendChild(option);
  }

  function refreshFilterOptions() {
    const selectedModule = els.filterModule.value;
    const selectedResponsible = els.filterResponsible.value;
    els.filterModule.innerHTML = '<option value="">Tous</option>';
    els.filterResponsible.innerHTML = '<option value="">Tous</option>';
    [...new Set(tasks.map((task) => task.module_key).filter(Boolean))].sort().forEach((moduleKey) => ensureOption(els.filterModule, moduleKey, moduleKey));
    users.forEach((user) => ensureOption(els.filterResponsible, user.id, user.email));
    tasks.forEach((task) => ensureOption(els.filterResponsible, task.responsible_user_id, task.responsible_email));
    els.filterModule.value = selectedModule;
    els.filterResponsible.value = selectedResponsible;
  }

  function refreshResponsibleSelect() {
    els.responsible.innerHTML = '<option value="">Non assigné</option>';
    users.forEach((user) => ensureOption(els.responsible, user.id, user.email));
    tasks.forEach((task) => ensureOption(els.responsible, task.responsible_user_id, task.responsible_email));
    ensureOption(els.responsible, sessionUser.id, sessionUser.email || 'Utilisateur courant');
  }

  function renderTasks() {
    if (!tasks.length) {
      els.tasksList.innerHTML = '<tr><td colspan="8">Aucune tâche qualité.</td></tr>';
      return;
    }
    els.tasksList.innerHTML = tasks.map((task) => `
      <tr>
        <td>${task.title || '-'}</td>
        <td>${task.module_key || '-'}</td>
        <td>${task.responsible_email || '-'}</td>
        <td>${frequencyLabel(task)}</td>
        <td>${formatDate(task.next_due_at)}</td>
        <td>${statusLabel(task)}</td>
        <td>${task.active ? 'Oui' : 'Non'}</td>
        <td><button class="btn btn-secondary" data-edit="${task.id}">Modifier</button> <button class="btn btn-secondary" data-toggle="${task.id}">${task.active ? 'Désactiver' : 'Réactiver'}</button></td>
      </tr>
    `).join('');
  }

  function currentFilters() {
    return {
      module: els.filterModule.value,
      responsible: els.filterResponsible.value,
      active: els.filterActive.value,
    };
  }

  async function loadUsers() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/users`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (!response.ok) return;
      users = await response.json();
    } catch (error) {
      users = [];
    }
  }

  async function loadTasks() {
    els.tasksList.innerHTML = '<tr><td colspan="8">Chargement...</td></tr>';
    try {
      tasks = await window.QualityTasksApi.list(currentFilters());
      refreshFilterOptions();
      refreshResponsibleSelect();
      renderTasks();
    } catch (error) {
      els.tasksList.innerHTML = `<tr><td colspan="8">${error.message}</td></tr>`;
    }
  }

  function openForm(task = null) {
    editingTaskId = task?.id || null;
    els.formTitle.textContent = editingTaskId ? 'Modifier la tâche' : 'Nouvelle tâche';
    els.title.value = task?.title || '';
    els.module.value = task?.module_key || '';
    els.responsible.value = task?.responsible_user_id || sessionUser.id || '';
    els.frequencyValue.value = task?.frequency_value || '';
    els.frequencyUnit.value = task?.frequency_unit || '';
    els.targetTime.value = task?.target_time ? String(task.target_time).slice(0, 5) : '';
    els.nextDueAt.value = toDatetimeLocal(task?.next_due_at);
    els.status.value = task?.status || 'planned';
    els.active.value = task?.active === false ? 'false' : 'true';
    els.entityType.value = task?.entity_type || '';
    els.entityId.value = task?.entity_id || '';
    els.description.value = task?.description || '';
    els.formMessage.textContent = '';
    els.formCard.classList.remove('hidden');
  }

  function buildPayload() {
    return {
      title: els.title.value,
      module_key: els.module.value,
      responsible_user_id: els.responsible.value || null,
      frequency_value: els.frequencyValue.value || null,
      frequency_unit: els.frequencyUnit.value || null,
      target_time: els.targetTime.value || null,
      next_due_at: fromDatetimeLocal(els.nextDueAt.value),
      status: els.status.value,
      active: els.active.value === 'true',
      entity_type: els.entityType.value || null,
      entity_id: els.entityId.value || null,
      description: els.description.value || null,
    };
  }

  els.newTaskBtn?.addEventListener('click', () => openForm());
  els.cancelBtn?.addEventListener('click', () => els.formCard.classList.add('hidden'));
  [els.filterModule, els.filterResponsible, els.filterActive].forEach((filter) => filter?.addEventListener('change', loadTasks));

  els.tasksList?.addEventListener('click', async (event) => {
    const editId = event.target.dataset.edit;
    const toggleId = event.target.dataset.toggle;
    if (editId) openForm(tasks.find((task) => task.id === editId));
    if (toggleId) {
      const task = tasks.find((item) => item.id === toggleId);
      if (!task) return;
      if (task.active) await window.QualityTasksApi.deactivate(toggleId);
      else await window.QualityTasksApi.save({ ...task, active: true, status: 'planned' }, toggleId);
      await loadTasks();
    }
  });

  els.form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await window.QualityTasksApi.save(buildPayload(), editingTaskId);
      els.formCard.classList.add('hidden');
      await loadTasks();
    } catch (error) {
      els.formMessage.textContent = error.message;
    }
  });

  loadUsers().finally(loadTasks);
})();
