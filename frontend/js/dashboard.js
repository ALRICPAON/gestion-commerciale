const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;
const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');

if (!token || !sessionUser) window.location.href = './login.html';

const els = {
  user: document.getElementById('user-name'),
  home: document.getElementById('home-btn'),
  logout: document.getElementById('logout-btn'),
  feedback: document.getElementById('dashboard-feedback'),
  capture: document.getElementById('capture-stock-btn'),
  refresh: document.getElementById('refresh-dashboard-btn'),
  period: document.getElementById('period-select'),
  from: document.getElementById('from-date'),
  to: document.getElementById('to-date'),
  apply: document.getElementById('apply-period-btn'),
  warning: document.getElementById('snapshot-warning'),
  summary: document.getElementById('summary-body'),
  chart: document.getElementById('dashboard-chart'),
  snapshots: document.getElementById('snapshots-body'),
  kpis: {
    caHt: document.getElementById('kpi-ca-ht'),
    caTtc: document.getElementById('kpi-ca-ttc'),
    purchases: document.getElementById('kpi-purchases'),
    stockInitial: document.getElementById('kpi-stock-initial'),
    stockFinal: document.getElementById('kpi-stock-final'),
    consumed: document.getElementById('kpi-consumed'),
    margin: document.getElementById('kpi-margin'),
    marginRate: document.getElementById('kpi-margin-rate'),
  },
};

function authHeaders(json = false) {
  const headers = { Authorization: `Bearer ${token}` };
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]));
}

function showFeedback(message = '', type = 'success') {
  if (!els.feedback) return;
  els.feedback.textContent = message;
  els.feedback.className = message ? `page-feedback ${type}` : 'page-feedback hidden';
}

function money(value) {
  if (value === null || value === undefined) return '-';
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function percent(value) {
  if (value === null || value === undefined) return '-';
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return `${number.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}

function dateText(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('fr-FR');
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function setDefaultDates() {
  const now = new Date();
  els.from.value = isoDate(now);
  els.to.value = isoDate(now);
}

function applyPresetDates() {
  const now = new Date();
  if (els.period.value === 'day') {
    els.from.value = isoDate(now);
    els.to.value = isoDate(now);
  } else if (els.period.value === 'week') {
    const day = now.getDay() || 7;
    const monday = addDays(now, 1 - day);
    els.from.value = isoDate(monday);
    els.to.value = isoDate(addDays(monday, 6));
  } else if (els.period.value === 'month') {
    els.from.value = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
    els.to.value = isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  }
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders(false) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur API');
  return data;
}

async function apiPost(path, payload = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur API');
  return data;
}

function dashboardQuery() {
  const params = new URLSearchParams({ period: els.period.value || 'day' });
  if (els.period.value === 'custom') {
    if (els.from.value) params.set('from', els.from.value);
    if (els.to.value) params.set('to', els.to.value);
  }
  return params.toString();
}

function setKpis(kpis = {}) {
  els.kpis.caHt.textContent = money(kpis.ca_ht);
  els.kpis.caTtc.textContent = money(kpis.ca_ttc);
  els.kpis.purchases.textContent = money(kpis.purchases_ht);
  els.kpis.stockInitial.textContent = money(kpis.stock_initial_ht);
  els.kpis.stockFinal.textContent = money(kpis.stock_final_ht);
  els.kpis.consumed.textContent = money(kpis.consumed_purchases_ht);
  els.kpis.margin.textContent = money(kpis.gross_margin_ht);
  els.kpis.marginRate.textContent = percent(kpis.margin_rate);
}

function renderSummary(data) {
  const k = data.kpis || {};
  const rows = [
    ['Periode', `${escapeHtml(data.from)} au ${escapeHtml(data.to)}`],
    ['CA HT', money(k.ca_ht)],
    ['CA TTC', money(k.ca_ttc)],
    ['Achats HT periode', money(k.purchases_ht)],
    ['Stock initial HT', money(k.stock_initial_ht)],
    ['Stock final HT', money(k.stock_final_ht)],
    ['Achats consommes HT', money(k.consumed_purchases_ht)],
    ['Marge brute HT', money(k.gross_margin_ht)],
    ['Marge %', percent(k.margin_rate)],
  ];
  els.summary.innerHTML = rows.map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`).join('');
}

function renderWarning(data) {
  const message = data.snapshots?.message || '';
  els.warning.textContent = message;
  els.warning.className = message ? 'page-feedback warning' : 'page-feedback warning hidden';
}

function renderChart(items = []) {
  const max = Math.max(...items.map((item) => Math.abs(Number(item.value || 0))), 1);
  els.chart.innerHTML = items.map((item) => {
    const value = Number(item.value || 0);
    const width = Math.max((Math.abs(value) / max) * 100, value === 0 ? 0 : 4);
    return `<div class="chart-row">
      <span>${escapeHtml(item.label)}</span>
      <div class="chart-track"><div class="chart-bar ${value < 0 ? 'negative' : ''}" style="width:${width}%"></div></div>
      <strong>${money(value)}</strong>
    </div>`;
  }).join('');
}

function renderSnapshots(rows = []) {
  els.snapshots.innerHTML = rows.length ? rows.map((row) => `<tr>
    <td>${dateText(row.snapshot_date)}</td>
    <td>${row.snapshot_type === 'automatic' ? 'Automatique' : 'Manuelle'}</td>
    <td>${money(row.total_value_ht)}</td>
  </tr>`).join('') : '<tr><td colspan="3">Aucune capture de stock.</td></tr>';
}

async function loadDashboard() {
  showFeedback('');
  const [dashboard, snapshots] = await Promise.all([
    apiGet(`/api/dashboard?${dashboardQuery()}`),
    apiGet('/api/stock-snapshots?limit=10'),
  ]);
  setKpis(dashboard.kpis);
  renderSummary(dashboard);
  renderWarning(dashboard);
  renderChart(dashboard.chart || []);
  renderSnapshots(Array.isArray(snapshots) ? snapshots : []);
}

async function captureStock() {
  if (!confirm('Capturer la valeur du stock maintenant ?')) return;
  els.capture.disabled = true;
  try {
    const data = await apiPost('/api/stock-snapshots', { snapshot_type: 'manual' });
    showFeedback(`Capture creee : ${money(data.snapshot?.total_value_ht)}`);
    await loadDashboard();
  } catch (error) {
    showFeedback(error.message || 'Erreur capture stock', 'error');
  } finally {
    els.capture.disabled = false;
  }
}

function logout() {
  ['gc_token', 'gc_user', 'gc_active_department', 'grv2_token', 'grv2_user', 'grv2_active_department'].forEach((key) => localStorage.removeItem(key));
  window.location.href = './login.html';
}

els.user.textContent = sessionUser.email || 'Utilisateur';
els.home.addEventListener('click', () => { window.location.href = './home.html'; });
els.logout.addEventListener('click', logout);
els.capture.addEventListener('click', captureStock);
els.refresh.addEventListener('click', () => loadDashboard().catch((error) => showFeedback(error.message, 'error')));
els.apply.addEventListener('click', () => loadDashboard().catch((error) => showFeedback(error.message, 'error')));
els.period.addEventListener('change', () => {
  applyPresetDates();
  const custom = els.period.value === 'custom';
  els.from.disabled = !custom;
  els.to.disabled = !custom;
});

setDefaultDates();
applyPresetDates();
els.from.disabled = true;
els.to.disabled = true;
loadDashboard().catch((error) => showFeedback(error.message, 'error'));
