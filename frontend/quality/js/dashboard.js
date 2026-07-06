(function () {
  const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const authToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');

  if (!sessionUser || !authToken) {
    window.location.href = '../../login.html';
    return;
  }

  const userNameEl = document.getElementById('user-name');
  const homeBtn = document.getElementById('home-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const temperatureSummaryEl = document.getElementById('quality-temperature-summary');
  const tasksTodayEl = document.getElementById('quality-tasks-today');
  const tasksOverdueEl = document.getElementById('quality-tasks-overdue');
  const tasksUpcomingEl = document.getElementById('quality-tasks-upcoming');
  const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';

  if (userNameEl) userNameEl.textContent = sessionUser.email || 'Utilisateur';
  if (homeBtn) homeBtn.addEventListener('click', () => { window.location.href = '../../home.html'; });
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('grv2_token');
      localStorage.removeItem('grv2_user');
      localStorage.removeItem('grv2_active_department');
      localStorage.removeItem('gc_token');
      localStorage.removeItem('gc_user');
      localStorage.removeItem('gc_active_department');
      window.location.href = '../../login.html';
    });
  }

  async function loadTemperatureSummary() {
    if (!temperatureSummaryEl || !window.hasQualityPermission?.(sessionUser, 'quality.read')) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/quality/temperatures/summary`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (!response.ok) return;
      const summary = await response.json();
      const critical = summary.latest_critical ? new Date(summary.latest_critical.recorded_at).toLocaleString('fr-FR') : '-';
      temperatureSummaryEl.textContent = `Alertes : ${summary.alert_count || 0} · Manquants : ${summary.missing_count || 0} · Critique : ${critical}`;
    } catch (error) {
      temperatureSummaryEl.textContent = 'Synthèse températures indisponible';
    }
  }

  async function loadTasksSummary() {
    if (!window.hasQualityPermission?.(sessionUser, 'quality.read')) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/quality/tasks/summary`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (!response.ok) return;
      const summary = await response.json();
      if (tasksTodayEl) tasksTodayEl.textContent = summary.today || 0;
      if (tasksOverdueEl) tasksOverdueEl.textContent = summary.overdue || 0;
      if (tasksUpcomingEl) tasksUpcomingEl.textContent = summary.upcoming || 0;
    } catch (error) {
      if (tasksTodayEl) tasksTodayEl.textContent = '0';
      if (tasksOverdueEl) tasksOverdueEl.textContent = '0';
      if (tasksUpcomingEl) tasksUpcomingEl.textContent = '0';
    }
  }

  loadTemperatureSummary();
  loadTasksSummary();
})();
