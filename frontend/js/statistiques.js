const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;
const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');

if (!token || !sessionUser) window.location.href = './login.html';

const state = {
  tab: 'articles',
  rows: [],
  sortKey: null,
  sortDirection: 'desc',
  charts: [],
};

const els = {
  user: document.getElementById('user-name'),
  home: document.getElementById('home-btn'),
  logout: document.getElementById('logout-btn'),
  refresh: document.getElementById('refresh-statistics-btn'),
  feedback: document.getElementById('statistics-feedback'),
  warning: document.getElementById('statistics-warning'),
  period: document.getElementById('period-select'),
  from: document.getElementById('from-date'),
  to: document.getElementById('to-date'),
  apply: document.getElementById('apply-period-btn'),
  tabs: Array.from(document.querySelectorAll('.statistics-tab')),
  kpis: document.getElementById('kpi-grid'),
  charts: document.getElementById('chart-grid'),
  tableTitle: document.getElementById('main-table-title'),
  tableSubtitle: document.getElementById('main-table-subtitle'),
  tableHead: document.getElementById('main-table-head'),
  tableBody: document.getElementById('main-table-body'),
  secondarySection: document.getElementById('secondary-section'),
  secondaryTitle: document.getElementById('secondary-title'),
  secondarySubtitle: document.getElementById('secondary-subtitle'),
  secondaryContent: document.getElementById('secondary-content'),
};

const tabConfig = {
  articles: {
    endpoint: '/api/statistics/articles',
    title: 'Articles',
    subtitle: 'CA, poids, marge et prix moyen par article.',
    kpis: [
      ['CA HT', 'ca_ht', 'money'],
      ['Quantite vendue', 'quantity', 'qty'],
      ['Marge brute', 'margin_ht', 'money'],
      ['Marge %', 'margin_rate', 'percent'],
      ['Prix moyen', 'average_price_ht', 'money'],
      ['Evolution CA N/N-1', 'evolution_ca_rate', 'percent'],
    ],
    columns: [
      ['Article', 'article', 'text'],
      ['PLU', 'plu', 'text'],
      ['CA', 'ca_ht', 'money'],
      ['Poids', 'quantity', 'qty'],
      ['Marge', 'margin_ht', 'money'],
      ['Marge %', 'margin_rate', 'percent'],
      ['Prix moyen', 'average_price_ht', 'money'],
      ['Ventes', 'sales_count', 'number'],
    ],
  },
  clients: {
    endpoint: '/api/statistics/clients',
    title: 'Clients',
    subtitle: 'CA, marge, commandes, panier moyen et derniere commande.',
    kpis: [
      ['CA HT', 'ca_ht', 'money'],
      ['Marge brute', 'margin_ht', 'money'],
      ['Nombre BL', 'delivery_note_count', 'number'],
      ['Nombre factures', 'invoice_count', 'number'],
      ['Panier moyen', 'average_basket_ht', 'money'],
    ],
    columns: [
      ['Client', 'client', 'text'],
      ['CA', 'ca_ht', 'money'],
      ['Marge', 'margin_ht', 'money'],
      ['Marge %', 'margin_rate', 'percent'],
      ['Commandes', 'order_count', 'number'],
      ['BL', 'delivery_note_count', 'number'],
      ['Factures', 'invoice_count', 'number'],
      ['Panier moyen', 'average_basket_ht', 'money'],
      ['Derniere commande', 'last_order_date', 'date'],
    ],
  },
  suppliers: {
    endpoint: '/api/statistics/suppliers',
    title: 'Fournisseurs',
    subtitle: 'Achats, quantites, receptions, BL et factures fournisseurs.',
    kpis: [
      ['Achats HT', 'purchases_ht', 'money'],
      ['Quantite totale', 'quantity', 'qty'],
      ['Prix moyen', 'average_price_ht', 'money'],
      ['Receptions', 'reception_count', 'number'],
    ],
    columns: [
      ['Fournisseur', 'supplier', 'text'],
      ['Montant achats', 'purchases_ht', 'money'],
      ['Part %', 'purchase_share_rate', 'percent'],
      ['Quantite', 'quantity', 'qty'],
      ['Nombre BL', 'delivery_note_count', 'number'],
      ['Nombre factures', 'invoice_count', 'number'],
      ['Receptions', 'reception_count', 'number'],
    ],
  },
  margins: {
    endpoint: '/api/statistics/margins',
    title: 'Marges',
    subtitle: 'Marge globale, par article, client et fournisseur.',
    kpis: [
      ['CA HT', 'ca_ht', 'money'],
      ['Achats consommes', 'consumed_purchases_ht', 'money'],
      ['Marge brute', 'gross_margin_ht', 'money'],
      ['Marge %', 'margin_rate', 'percent'],
      ['Stock initial', 'stock_initial_ht', 'money'],
      ['Stock final', 'stock_final_ht', 'money'],
    ],
    columns: [
      ['Article', 'article', 'text'],
      ['CA', 'ca_ht', 'money'],
      ['Marge', 'margin_ht', 'money'],
      ['Marge %', 'margin_rate', 'percent'],
      ['Poids', 'quantity', 'qty'],
      ['Prix moyen', 'average_price_ht', 'money'],
    ],
  },
};

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
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

function qty(value) {
  const number = Number(value || 0);
  return `${number.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} kg`;
}

function dateText(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('fr-FR');
}

function format(value, type) {
  if (type === 'money') return money(value);
  if (type === 'percent') return percent(value);
  if (type === 'qty') return qty(value);
  if (type === 'date') return dateText(value);
  if (type === 'number') return Number(value || 0).toLocaleString('fr-FR');
  return escapeHtml(value ?? '-');
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
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
  } else if (els.period.value === 'year') {
    els.from.value = isoDate(new Date(now.getFullYear(), 0, 1));
    els.to.value = isoDate(new Date(now.getFullYear(), 11, 31));
  } else if (els.period.value === 'month') {
    els.from.value = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
    els.to.value = isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  }
}

function queryString() {
  const params = new URLSearchParams({ period: els.period.value || 'month' });
  if (els.period.value === 'custom') {
    if (els.from.value) params.set('from', els.from.value);
    if (els.to.value) params.set('to', els.to.value);
  }
  return params.toString();
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur API');
  return data;
}

function renderKpis(kpis = {}, config) {
  els.kpis.innerHTML = config.kpis.map(([label, key, type]) => `
    <article class="statistics-kpi">
      <span>${escapeHtml(label)}</span>
      <strong>${format(kpis[key], type)}</strong>
    </article>
  `).join('');
}

function destroyCharts() {
  state.charts.forEach((chart) => chart?.destroy?.());
  state.charts = [];
}

function renderChartCard(title, type, items, valueKey = 'value') {
  const id = `chart-${Math.random().toString(36).slice(2)}`;
  const html = `<article class="card statistics-chart-card"><h3>${escapeHtml(title)}</h3><div class="statistics-chart-wrap"><canvas id="${id}"></canvas></div></article>`;
  els.charts.insertAdjacentHTML('beforeend', html);
  const canvas = document.getElementById(id);
  const labels = items.map((item) => item.label || item.date || '');
  const values = items.map((item) => Number(item[valueKey] ?? item.value ?? 0));
  state.charts.push(new Chart(canvas, {
    type,
    data: { labels, datasets: [{ label: title, data: values }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: title } } },
  }));
}

function renderCharts(data) {
  destroyCharts();
  els.charts.innerHTML = '';
  const charts = data.charts || {};
  if (state.tab === 'articles') {
    renderChartCard('Top 10 CA articles', 'bar', charts.top_ca || []);
    renderChartCard('Top 10 marge articles', 'bar', charts.top_margin || []);
  } else if (state.tab === 'clients') {
    renderChartCard('Top 10 clients CA', 'bar', charts.top_ca || []);
    renderChartCard('Top 10 clients marge', 'bar', charts.top_margin || []);
  } else if (state.tab === 'suppliers') {
    renderChartCard('Repartition achats fournisseurs', 'bar', charts.purchase_share || []);
    renderChartCard('Top fournisseurs achats', 'bar', charts.top_purchases || []);
  } else if (state.tab === 'margins') {
    renderChartCard('Evolution marge', 'line', charts.margin_evolution || [], 'margin_ht');
    renderChartCard('Top marges articles', 'bar', charts.top_articles || []);
    renderChartCard('Top marges clients', 'bar', charts.top_clients || []);
  }
}

function compareRows(a, b, key) {
  const av = a[key];
  const bv = b[key];
  const an = Number(av);
  const bn = Number(bv);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return String(av ?? '').localeCompare(String(bv ?? ''), 'fr');
}

function renderTable() {
  const config = tabConfig[state.tab];
  const rows = state.rows.slice();
  if (state.sortKey) {
    rows.sort((a, b) => compareRows(a, b, state.sortKey) * (state.sortDirection === 'asc' ? 1 : -1));
  }

  els.tableTitle.textContent = config.title;
  els.tableSubtitle.textContent = config.subtitle;
  els.tableHead.innerHTML = `<tr>${config.columns.map(([label, key, type]) => `<th data-key="${key}" class="${type !== 'text' ? 'numeric' : ''}">${escapeHtml(label)}</th>`).join('')}</tr>`;
  els.tableBody.innerHTML = rows.length ? rows.map((row) => `<tr>${config.columns.map(([, key, type]) => `<td class="${type !== 'text' ? 'numeric' : ''}">${format(row[key], type)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${config.columns.length}">Aucune donnee sur cette periode.</td></tr>`;

  Array.from(els.tableHead.querySelectorAll('th')).forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (state.sortKey === key) state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      else {
        state.sortKey = key;
        state.sortDirection = 'desc';
      }
      renderTable();
    });
  });
}

function renderInactive(data) {
  const inactive = data.inactive || {};
  const bucket = (title, rows) => `<div class="inactive-card"><strong>${escapeHtml(title)} (${rows.length})</strong><div class="inactive-list">${rows.slice(0, 40).map((row) => `<span>${escapeHtml(row.client)} - ${row.inactive_days} jours</span>`).join('') || '<span>Aucun client</span>'}</div></div>`;
  els.secondarySection.classList.remove('hidden');
  els.secondaryTitle.textContent = 'Clients inactifs';
  els.secondarySubtitle.textContent = 'Clients sans commande validee depuis 30, 60 ou 90 jours.';
  els.secondaryContent.innerHTML = `<div class="statistics-badges">${bucket('30 jours', inactive.days_30 || [])}${bucket('60 jours', inactive.days_60 || [])}${bucket('90 jours', inactive.days_90 || [])}</div>`;
}

function renderMarginDetails(data) {
  const suppliers = data.tables?.suppliers || [];
  els.secondarySection.classList.remove('hidden');
  els.secondaryTitle.textContent = 'Marge par fournisseur';
  els.secondarySubtitle.textContent = 'Calcul base sur les allocations de lots vendus lorsque le fournisseur du lot est connu.';
  els.secondaryContent.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Fournisseur</th><th class="numeric">CA</th><th class="numeric">Cout</th><th class="numeric">Marge</th><th class="numeric">Marge %</th></tr></thead><tbody>${suppliers.length ? suppliers.map((row) => `<tr><td>${escapeHtml(row.supplier)}</td><td class="numeric">${money(row.ca_ht)}</td><td class="numeric">${money(row.cost_ht)}</td><td class="numeric">${money(row.margin_ht)}</td><td class="numeric">${percent(row.margin_rate)}</td></tr>`).join('') : '<tr><td colspan="5">Aucune allocation fournisseur sur cette periode.</td></tr>'}</tbody></table></div>`;
}

function renderSecondary(data) {
  els.secondarySection.classList.add('hidden');
  els.secondaryContent.innerHTML = '';
  if (state.tab === 'clients') renderInactive(data);
  if (state.tab === 'margins') renderMarginDetails(data);
}

function renderWarning(data) {
  const message = data.snapshots?.message || '';
  els.warning.textContent = message;
  els.warning.className = message ? 'page-feedback warning' : 'page-feedback warning hidden';
}

async function loadStatistics() {
  showFeedback('');
  const config = tabConfig[state.tab];
  const data = await apiGet(`${config.endpoint}?${queryString()}`);
  renderKpis(data.kpis || {}, config);
  renderCharts(data);
  renderWarning(data);
  state.rows = state.tab === 'margins' ? (data.tables?.articles || []) : (data.table || []);
  state.sortKey = null;
  state.sortDirection = 'desc';
  renderTable();
  renderSecondary(data);
}

function setTab(tab) {
  state.tab = tab;
  els.tabs.forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  loadStatistics().catch((error) => showFeedback(error.message, 'error'));
}

function logout() {
  ['gc_token', 'gc_user', 'gc_active_department', 'grv2_token', 'grv2_user', 'grv2_active_department'].forEach((key) => localStorage.removeItem(key));
  window.location.href = './login.html';
}

els.user.textContent = sessionUser.email || 'Utilisateur';
els.home.addEventListener('click', () => { window.location.href = './home.html'; });
els.logout.addEventListener('click', logout);
els.refresh.addEventListener('click', () => loadStatistics().catch((error) => showFeedback(error.message, 'error')));
els.apply.addEventListener('click', () => loadStatistics().catch((error) => showFeedback(error.message, 'error')));
els.period.addEventListener('change', () => {
  applyPresetDates();
  const custom = els.period.value === 'custom';
  els.from.disabled = !custom;
  els.to.disabled = !custom;
});
els.tabs.forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));

applyPresetDates();
els.from.disabled = true;
els.to.disabled = true;
loadStatistics().catch((error) => showFeedback(error.message, 'error'));
